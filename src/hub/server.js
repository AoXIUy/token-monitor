'use strict';

const http = require('node:http');
const { UPLOAD_HEADER, UPLOAD_VERSION, createUploadBaselines } = require('../shared/uploadDelta');
const path = require('node:path');
const { URL } = require('node:url');
const {
  aggregateDevices,
  mergeSyncDeviceRecord,
  aggregateHistory,
  stripSessionTextFromDeviceRecord
} = require('../shared/usage');
const {
  SHARED_SYNC_KINDS, emptySharedSyncDocument, nextSharedSyncDocument,
  syncContentCapability, syncSessionTitlesEnabled, normalizeTitlePolicy, nextTitlePolicy, acceptsSessionTitles
} = require('../shared/syncContent');
const { DEFAULT_STALE_AFTER_MS } = require('../shared/syncUploadInterval');
const { deviceHistoryRevision, historyPreview, historyRevision } = require('../shared/history');
const {
  emptySubscriptionDocument,
  isStaleSubscriptionWrite,
  subscriptionDocument
} = require('../shared/subscriptionDisplay');
const { CURRENCY_CODES, normalizeCurrency } = require('../shared/currency');
const { currentHubBuild } = require('../shared/hubBuildIdentity');
const {
  SSE_BACKLOG_LIMIT_BYTES,
  encodeSseEvent,
  prepareSseFanout,
  sseClientKinds,
  sseFrameForClient,
  hubStatsContentKey,
  wantsFreshnessEvents,
  wantsDeltaEvents,
  wantsMinimalResponse
} = require('../shared/hubProtocol');
const { MAX_JSON_BODY_BYTES, isAuthorized, readJsonBody, sendJson, sendText } = require('../shared/http');
const { loadDotEnv, parseArgs, projectRoot, readJson, writeJsonAtomic } = require('../shared/config');
const { CONVERSATION_BASE, MAX_CONVERSATION_BYTES } = require('../shared/sessionConversationProtocol');
const { createSessionConversationRelay } = require('./sessionConversations');
const { APPROVAL_ALERT_BASE, MAX_APPROVAL_BODY_BYTES } = require('../shared/approvalProtocol');
const { createApprovalAlertStore } = require('./approvalAlerts');
const {
  AG_MANAGER_BASE,
  AG_MANAGER_SNAPSHOT_PATH,
  MAX_AG_MANAGER_SNAPSHOT_BYTES
} = require('../shared/antigravityManagerProtocol');
const { createAntigravityManagerStore } = require('./antigravityManager');
const { REPORT_GRANULARITIES } = require('../shared/usageReport');
const {
  createMcpReportServer,
  sanitizeLimitsHistoryPayload,
  stripSessionDetailTitles
} = require('../shared/mcpReportProtocol');
const {
  queryUsageBreakdown,
  listSessionsQuery,
  queryUsageHistory,
  getDevicesAndHealthQuery,
  getLimitsOverviewQuery,
  getSubscriptionsAndForecastsQuery,
  getLiveTokenRateSummary
} = require('../shared/openclawQueries');
const { normalizeClientName } = require('../shared/usage');
const { createIntegrationManager } = require('./integrations');
const { createReportManager } = require('./reports');

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const SHUTDOWN_DRAIN_TIMEOUT_MS = 5000;
const ALLOWED_REPORT_CONFIG_KEYS = new Set(['enabled', 'daily', 'weekly', 'monthly']);

function readRawTextBody(req, maxBytes = MAX_JSON_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let body = '';
    let bytes = 0;
    let tooLarge = false;
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      if (tooLarge) return;
      bytes += Buffer.byteLength(chunk, 'utf8');
      if (bytes > maxBytes) {
        tooLarge = true;
        body = '';
        const error = new Error('Request body too large');
        error.code = 'payload_too_large';
        reject(error);
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      if (!tooLarge) resolve(body);
    });
    req.on('error', reject);
  });
}

// Without a secret the hub cannot tell its own widget from any other caller, so it
// must not expose account identity (email/plan/key) to the network. Binding to
// loopback keeps an unauthenticated hub usable locally while refusing LAN/remote
// reach; set a secret to bind a non-loopback address and accept other devices.
function resolveBindHost(host, secret) {
  const requested = String(host || '').trim() || '0.0.0.0';
  if (secret) return requested;
  return LOOPBACK_HOSTS.has(requested.toLowerCase()) ? requested : '127.0.0.1';
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function makeQueryParamError(message) {
  const err = new Error(message);
  err.code = 'invalid_request';
  err.statusCode = 400;
  return err;
}

function parseOptionalIntParam(raw, { min = 1, max = 500, name = 'limit' } = {}) {
  if (raw === null || raw === undefined || String(raw).trim() === '') return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw makeQueryParamError(`${name} must be an integer between ${min} and ${max}`);
  }
  return n;
}

function parseOptionalNumberParam(raw, { min = 1, max = 720, name = 'hours' } = {}) {
  if (raw === null || raw === undefined || String(raw).trim() === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw makeQueryParamError(`${name} must be a number between ${min} and ${max}`);
  }
  return n;
}

function parseOptionalBoolParam(raw, fallback) {
  if (raw === null || raw === undefined || String(raw).trim() === '') return fallback;
  const lower = String(raw).trim().toLowerCase();
  if (lower === 'true' || lower === '1' || lower === 'yes') return true;
  if (lower === 'false' || lower === '0' || lower === 'no') return false;
  throw makeQueryParamError(`Invalid boolean query parameter value: ${raw}`);
}

/**
 * Shared authenticated HTTP + MCP dispatcher for `/api/query/*`, `/api/reports*`,
 * `/api/integrations/openclaw/*`, `GET /api/approval-alerts`, and `POST /api/mcp`.
 * Reused identically by both `createHub()` and Desktop `openclawBridge.js` (`local` mode).
 *
 * @param {Record<string, any>} [options]
 */
function createOpenClawEndpointSurface({
  getStats = () => ({}),
  getHistory = () => null,
  getSubscriptions = () => null,
  getDevices = () => [],
  getModelAliasSettings = () => null,
  getEnhancedQueryContext = null,
  serverTitlesEnabled = false,
  integrationManager = null,
  reportManager = null,
  listApprovalAlerts = null,
  getOpenClawConfig = null,
  getIntegrationsStatus = null,
  updateIntegrationsConfig = null,
  analyzeReportWithAi = null,
  pushReportToOpenClaw = null,
  pushQueryToOpenClaw = null,
  sendTestNotification = null,
  getPushHistory = null,
  buildWeChatBrief = null,
  getOpenClawEnv = null,
  startOpenClawWeixinQr = null,
  pollOpenClawWeixinQrStatus = null,
  submitOpenClawWeixinVerifyCode = null,
  cancelOpenClawWeixinQr = null,
  provisionOpenClaw = null,
  readCachedAnalysis = null,
  mcpServer = null,
  mcpServerInfo = { name: 'token-monitor-hub', version: '1.0.0' }
} = {}) {
  const resolvedGetStatus = getIntegrationsStatus || (integrationManager ? () => integrationManager.getStatus() : null);
  const resolvedUpdateConfig = updateIntegrationsConfig || (integrationManager ? (p) => integrationManager.updateConfig(p) : null);
  const resolvedAnalyzeAi = analyzeReportWithAi || (integrationManager ? (o) => integrationManager.analyzeReport(o) : null);
  const resolvedPushReport = pushReportToOpenClaw || (integrationManager ? (o) => integrationManager.pushToOpenClaw(o) : null);
  const resolvedPushQuery = pushQueryToOpenClaw || (integrationManager ? (o) => integrationManager.pushQueryToOpenClaw(o) : null);
  const resolvedSendTest = sendTestNotification || (integrationManager ? (o) => integrationManager.sendTestNotification(o) : null);
  const resolvedGetPushHistory = getPushHistory || (integrationManager ? () => integrationManager.getPushHistory() : null);
  const resolvedBuildBrief = buildWeChatBrief || (integrationManager ? (o) => integrationManager.buildWeChatBrief(o) : null);
  const resolvedGetEnv = getOpenClawEnv || (integrationManager ? () => integrationManager.getOpenClawEnv() : null);
  const resolvedQrStart = startOpenClawWeixinQr || (integrationManager ? () => integrationManager.startOpenClawWeixinQr() : null);
  const resolvedQrStatus = pollOpenClawWeixinQrStatus || (integrationManager ? (id) => integrationManager.pollOpenClawWeixinQrStatus(id) : null);
  const resolvedQrVerify = submitOpenClawWeixinVerifyCode || (integrationManager ? (id, code) => integrationManager.submitOpenClawWeixinVerifyCode(id, code) : null);
  const resolvedQrCancel = cancelOpenClawWeixinQr || (integrationManager ? (id) => integrationManager.cancelOpenClawWeixinQr(id) : null);
  const resolvedProvision = provisionOpenClaw || (integrationManager ? (o) => integrationManager.provisionOpenClaw(o) : null);
  const resolvedReadCachedAnalysis = readCachedAnalysis || (integrationManager ? (g, k, r) => integrationManager.readCachedAnalysis(g, k, r) : null);

  function resolveOpenClawConfig(overrideConfig = null) {
    if (isPlainObject(overrideConfig)) return overrideConfig;
    if (typeof getOpenClawConfig === 'function') {
      const cfg = getOpenClawConfig();
      if (isPlainObject(cfg)) return cfg;
    }
    if (typeof resolvedGetStatus === 'function') {
      const status = resolvedGetStatus();
      if (isPlainObject(status?.openclaw)) return status.openclaw;
    }
    return {};
  }

  async function resolveContext() {
    const enhanced = typeof getEnhancedQueryContext === 'function'
      ? await getEnhancedQueryContext()
      : null;
    const ctx = isPlainObject(enhanced) ? enhanced : {};
    const stats = ctx.stats ?? getStats();
    const history = ctx.history ?? getHistory();
    const subscriptionsDoc = ctx.subscriptions ?? getSubscriptions();
    const aliasSettings = typeof getModelAliasSettings === 'function' ? getModelAliasSettings() : null;
    const modelAliases = ctx.modelAliases ?? aliasSettings?.modelAliases ?? null;
    const modelAliasGrouping = ctx.modelAliasGrouping ?? aliasSettings?.modelAliasGrouping ?? 'off';
    const titlesAllowed = typeof ctx.sessionTitlesEnabled === 'boolean'
      ? ctx.sessionTitlesEnabled
      : Boolean(serverTitlesEnabled);
    return {
      ctx,
      stats,
      history,
      subscriptionsDoc,
      modelAliases,
      modelAliasGrouping,
      titlesAllowed
    };
  }

  const queryService = {
    async usage(params = {}) {
      const { ctx, stats, history, modelAliases, modelAliasGrouping } = await resolveContext();
      return {
        ok: true,
        ...queryUsageBreakdown({
          stats,
          history,
          devices: ctx.devices ?? getDevices(),
          dailySnapshots: ctx.dailySnapshots,
          period: params.period,
          range: params.range,
          groupBy: params.groupBy,
          deviceId: params.deviceId,
          limit: params.limit,
          modelAliases,
          modelAliasGrouping: params.modelAliasGrouping ?? modelAliasGrouping,
          timeZone: params.timeZone
        })
      };
    },

    async sessions(params = {}) {
      const { ctx, stats, titlesAllowed } = await resolveContext();
      return {
        ok: true,
        ...listSessionsQuery({
          stats,
          allTimeSessions: ctx.allTimeSessions,
          period: params.period,
          state: params.state,
          client: params.client,
          project: params.project,
          deviceId: params.deviceId,
          search: params.search,
          sort: params.sort,
          sortDirection: params.sortDirection,
          limit: params.limit,
          cursor: params.cursor,
          sessionTitlesEnabled: titlesAllowed
        })
      };
    },

    async sessionDetail(params = {}, openclawCfgOverride = null) {
      const ocCfg = resolveOpenClawConfig(openclawCfgOverride);
      const perms = isPlainObject(ocCfg?.queryPermissions) ? ocCfg.queryPermissions : {};
      if (perms.allowSessionDetail !== true) {
        return {
          ok: false,
          statusCode: 403,
          error: 'session_detail_disabled',
          message: 'Session detail queries are disabled by privacy settings (queryPermissions.allowSessionDetail).'
        };
      }
      const includeConversation = Boolean(params.includeConversation);
      if (includeConversation && perms.allowConversationText !== true) {
        return {
          ok: false,
          statusCode: 403,
          error: 'conversation_text_disabled',
          message: 'Conversation text queries are disabled by privacy settings (queryPermissions.allowConversationText).'
        };
      }

      const rawClient = typeof params.client === 'string' ? params.client.trim() : '';
      const client = rawClient ? (normalizeClientName(rawClient) || rawClient.toLowerCase()) : '';
      const sessionId = typeof params.sessionId === 'string' ? params.sessionId.trim() : '';
      if (!client || !sessionId) {
        return {
          ok: false,
          statusCode: 400,
          error: 'invalid_request',
          message: 'client and sessionId query parameters are required.'
        };
      }

      const { ctx, titlesAllowed } = await resolveContext();
      if (typeof ctx.readSessionDetail !== 'function') {
        return {
          ok: false,
          statusCode: 501,
          error: 'session_detail_unavailable',
          message: 'Session detail reader is not available on standalone Hub.'
        };
      }

      const periodRaw = typeof params.period === 'string' ? params.period.trim() : 'total';
      const period = periodRaw === 'allTime' ? 'total' : (periodRaw || 'total');
      if (!['today', 'month', 'total'].includes(period)) {
        return {
          ok: false,
          statusCode: 400,
          error: 'invalid_request',
          message: `Invalid period "${periodRaw}". Expected today, month, total, or allTime.`
        };
      }

      const detail = await ctx.readSessionDetail({
        client,
        sessionId,
        deviceId: typeof params.deviceId === 'string' ? params.deviceId.trim() : '',
        period,
        includeConversation,
        limit: params.limit,
        offset: params.offset,
        cursor: params.cursor
      });

      if (!detail || (detail.found === false && !detail.error)) {
        return {
          ok: false,
          statusCode: 404,
          error: 'not_found',
          message: `Session detail not found for ${client}:${sessionId}.`
        };
      }
      if (detail.found === false && detail.error) {
        return {
          ok: false,
          statusCode: detail.error === 'line-too-large' ? 413 : 500,
          error: detail.error,
          message: `Failed to read session detail (${detail.error}).`
        };
      }

      const sanitized = stripSessionDetailTitles(detail);
      if (titlesAllowed) {
        Object.assign(sanitized, detail);
      }
      if (!includeConversation || perms.allowConversationText !== true) {
        delete sanitized.conversation;
        delete sanitized.messages;
        delete sanitized.conversationMessages;
      }

      if (Array.isArray(sanitized.exchanges) && sanitized.totalExchanges === undefined) {
        const totalExchanges = sanitized.exchanges.length;
        const offset = Number.isInteger(params.offset) && params.offset >= 0 ? params.offset : 0;
        const limit = Number.isInteger(params.limit) && params.limit > 0 ? params.limit : 50;
        sanitized.exchanges = sanitized.exchanges.slice(offset, offset + limit);
        sanitized.totalExchanges = totalExchanges;
        sanitized.offset = offset;
        sanitized.limit = limit;
        sanitized.truncated = offset + sanitized.exchanges.length < totalExchanges;
      }

      return { ok: true, ...sanitized };
    },

    async history(params = {}) {
      const { history } = await resolveContext();
      return {
        ok: true,
        ...queryUsageHistory({
          history,
          resolution: params.resolution,
          from: params.from,
          to: params.to,
          groupBy: params.groupBy,
          limit: params.limit
        })
      };
    },

    async devices(params = {}) {
      const { stats } = await resolveContext();
      return {
        ok: true,
        ...getDevicesAndHealthQuery({
          stats,
          deviceId: params.deviceId,
          includeDiagnostics: params.includeDiagnostics !== false
        })
      };
    },

    async limits(params = {}) {
      const { ctx, stats } = await resolveContext();
      const overview = getLimitsOverviewQuery({
        stats,
        thirdPartyOnly: Boolean(params.thirdPartyOnly),
        provider: params.provider,
        status: params.status,
        maxProviders: params.maxProviders
      });
      if (!params.includeHistory) {
        return { ok: true, ...overview };
      }
      if (typeof ctx.getLimitsHistory !== 'function') {
        return {
          ok: true,
          ...overview,
          limitsHistory: {
            available: false,
            reason: 'desktop_only',
            series: []
          }
        };
      }
      try {
        const rawHistory = await ctx.getLimitsHistory({
          accountKey: params.accountKey,
          provider: params.provider,
          windowName: params.windowName,
          hours: params.hours
        });
        return {
          ok: true,
          ...overview,
          limitsHistory: sanitizeLimitsHistoryPayload({
            available: true,
            ...(isPlainObject(rawHistory) ? rawHistory : { series: rawHistory || [] })
          })
        };
      } catch (error) {
        return {
          ok: true,
          ...overview,
          limitsHistory: {
            available: false,
            reason: 'query_failed',
            error: error instanceof Error ? error.message : String(error),
            series: []
          }
        };
      }
    },

    async subscriptions(params = {}) {
      const { ctx, stats, subscriptionsDoc } = await resolveContext();
      return {
        ok: true,
        ...getSubscriptionsAndForecastsQuery({
          subscriptionsDoc,
          stats,
          rates: ctx.rates,
          date: params.date,
          includeForecasts: params.includeForecasts !== false,
          activeOnly: Boolean(params.activeOnly)
        })
      };
    },

    async liveRate(params = {}) {
      const { ctx, stats } = await resolveContext();
      return {
        ok: true,
        ...getLiveTokenRateSummary({
          stats,
          liveRateSnapshot: ctx.liveRateSnapshot,
          deviceId: params.deviceId
        })
      };
    },

    async serviceStatus(params = {}) {
      const { ctx } = await resolveContext();
      const includeResetForecast = params.includeResetForecast !== false;
      const includeApprovals = params.includeApprovals !== false;

      let serviceStatus;
      if (typeof ctx.getServiceStatus === 'function') {
        try {
          const data = await ctx.getServiceStatus({
            force: Boolean(params.force),
            providerIds: Array.isArray(params.providerIds) ? params.providerIds : null
          });
          serviceStatus = {
            available: true,
            ...(isPlainObject(data) ? data : { data })
          };
        } catch (error) {
          serviceStatus = {
            available: false,
            reason: 'error',
            error: error instanceof Error ? error.message : String(error),
            providers: []
          };
        }
      } else {
        serviceStatus = { available: false, reason: 'desktop_only', providers: [] };
      }

      let codexResetForecast;
      if (includeResetForecast) {
        if (typeof ctx.getCodexResetForecast === 'function') {
          try {
            const data = await ctx.getCodexResetForecast({ force: Boolean(params.force) });
            codexResetForecast = {
              available: true,
              ...(isPlainObject(data) ? data : { data })
            };
          } catch (error) {
            codexResetForecast = {
              available: false,
              reason: 'error',
              error: error instanceof Error ? error.message : String(error)
            };
          }
        } else {
          codexResetForecast = { available: false, reason: 'desktop_only' };
        }
      }

      let approvalAlerts;
      if (includeApprovals) {
        const alertFn = typeof ctx.listApprovalAlerts === 'function'
          ? ctx.listApprovalAlerts
          : (typeof listApprovalAlerts === 'function' ? listApprovalAlerts : null);
        if (alertFn) {
          try {
            const rawAlerts = await alertFn();
            if (rawAlerts && rawAlerts.ok) {
              approvalAlerts = { available: true, enabled: true, alerts: rawAlerts.alerts || [] };
            } else if (rawAlerts?.error === 'disabled') {
              approvalAlerts = { available: true, enabled: false, alerts: [] };
            } else {
              approvalAlerts = {
                available: false,
                enabled: false,
                alerts: [],
                ...(rawAlerts?.error ? { reason: rawAlerts.error } : {})
              };
            }
          } catch (error) {
            approvalAlerts = {
              available: false,
              enabled: false,
              alerts: [],
              error: error instanceof Error ? error.message : String(error)
            };
          }
        } else {
          approvalAlerts = { available: false, enabled: false, alerts: [] };
        }
      }

      return {
        ok: true,
        checkedAt: new Date().toISOString(),
        serviceStatus,
        ...(includeResetForecast ? { codexResetForecast } : {}),
        ...(includeApprovals ? { approvalAlerts } : {})
      };
    },

    async execute(queryType, params = {}, openclawCfgOverride = null) {
      switch (queryType) {
        case 'usage':
          return this.usage(params);
        case 'sessions':
          return this.sessions(params);
        case 'session_detail':
          return this.sessionDetail(params, openclawCfgOverride);
        case 'history':
          return this.history(params);
        case 'devices':
          return this.devices(params);
        case 'limits':
          return this.limits(params);
        case 'subscriptions':
          return this.subscriptions(params);
        case 'live_rate':
          return this.liveRate(params);
        case 'service_status':
          return this.serviceStatus(params);
        default:
          return {
            ok: false,
            statusCode: 400,
            error: 'invalid_request',
            message: `Unsupported query type: ${queryType}`
          };
      }
    }
  };

  const resolvedMcpServer = mcpServer || createMcpReportServer({
    listReports: reportManager ? (args) => reportManager.listReports(args) : undefined,
    getReport: reportManager
      ? (args) => {
          const res = reportManager.getReport(args);
          if (res?.ok && res.report && args?.format !== 'markdown' && typeof resolvedReadCachedAnalysis === 'function') {
            const aiAnalysis = resolvedReadCachedAnalysis(
              res.report.granularity,
              res.report.period?.key,
              res.report
            );
            if (aiAnalysis) return { ...res, aiAnalysis };
          }
          return res;
        }
      : undefined,
    generateReport: reportManager ? (args) => reportManager.generateReport(args) : undefined,
    analyzeProjects: reportManager ? (args) => reportManager.analyzeProjects(args) : undefined,
    getStats: () => getStats(),
    getHistory: () => getHistory(),
    getSubscriptions: () => getSubscriptions(),
    analyzeWithAi: resolvedAnalyzeAi ? (args) => resolvedAnalyzeAi(args) : undefined,
    pushToOpenClaw: resolvedPushReport ? (args) => resolvedPushReport(args) : undefined,
    pushEventToOpenClaw: resolvedPushQuery
      ? (args) => (args?.test === true
        ? (resolvedSendTest ? resolvedSendTest({ message: args.customMessage || args.params?.message || '', source: 'mcp_test' }) : resolvedPushQuery(args))
        : resolvedPushQuery({ ...args, source: 'mcp' }))
      : undefined,
    queryUsageBreakdown: (args) => queryService.usage(args),
    listSessions: (args) => queryService.sessions(args),
    getSessionDetail: (args) => queryService.sessionDetail(args),
    getUsageHistory: (args) => queryService.history(args),
    getDevicesAndHealth: (args) => queryService.devices(args),
    getLimitsHistory: (args) => queryService.limits(args),
    getSubscriptionsAndForecasts: (args) => queryService.subscriptions(args),
    getLiveTokenRate: (args) => queryService.liveRate(args),
    getServiceStatusAndApprovals: (args) => queryService.serviceStatus(args),
    listApprovalAlerts: typeof listApprovalAlerts === 'function' ? () => listApprovalAlerts() : undefined,
    sessionTitlesEnabled: Boolean(serverTitlesEnabled),
    serverInfo: mcpServerInfo
  });

  function mapErrorStatus(result) {
    if (Number.isInteger(result?.statusCode) && result.statusCode >= 400) return result.statusCode;
    if (result?.error === 'session_detail_disabled' || result?.error === 'conversation_text_disabled') return 403;
    if (result?.error === 'not_found') return 404;
    if (result?.error === 'session_detail_unavailable' || result?.error === 'not_implemented') return 501;
    if (result?.error === 'openclaw_http_error' || result?.error === 'openclaw_network_error'
      || result?.error === 'ai_http_error' || result?.error === 'ai_network_error'
      || result?.error === 'ai_empty_response' || result?.error === 'ai_token_limit'
      || result?.error === 'qr_poll_failed' || result?.error === 'qr_refresh_failed') return 502;
    if (result?.error === 'hub_stopped') return 503;
    return 400;
  }

  async function runQueryHttp(res, fn) {
    try {
      const result = await fn();
      if (result && result.ok === false) {
        return sendJson(res, mapErrorStatus(result), result);
      }
      return sendJson(res, 200, result);
    } catch (error) {
      const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 400;
      return sendJson(res, statusCode, {
        ok: false,
        error: error?.code || 'invalid_request',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * @param {http.IncomingMessage} req
   * @param {http.ServerResponse} res
   * @param {URL | null} [urlInput]
   * @returns {Promise<boolean>}
   */
  async function handleRequest(req, res, urlInput = null) {
    const url = urlInput || new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === APPROVAL_ALERT_BASE) {
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'invalid_request' });
        return true;
      }
      const alertFn = typeof listApprovalAlerts === 'function' ? listApprovalAlerts : null;
      if (!alertFn) {
        const { ctx } = await resolveContext();
        if (typeof ctx.listApprovalAlerts === 'function') {
          sendJson(res, 200, await ctx.listApprovalAlerts());
          return true;
        }
        sendJson(res, 200, { error: 'disabled' });
        return true;
      }
      sendJson(res, 200, await alertFn());
      return true;
    }

    if (url.pathname.startsWith('/api/query/')) {
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'invalid_request' });
        return true;
      }
      const sp = url.searchParams;

      if (url.pathname === '/api/query/usage') {
        await runQueryHttp(res, () => queryService.usage({
          period: sp.get('period') || undefined,
          range: sp.get('range') || undefined,
          groupBy: sp.get('groupBy') ?? sp.get('group_by') ?? undefined,
          deviceId: sp.get('deviceId') ?? sp.get('device') ?? undefined,
          limit: parseOptionalIntParam(sp.get('limit'), { min: 1, max: 500, name: 'limit' }),
          modelAliasGrouping: sp.get('modelAliasGrouping') || undefined,
          timeZone: sp.get('timeZone') || undefined
        }));
        return true;
      }

      if (url.pathname === '/api/query/sessions') {
        await runQueryHttp(res, () => queryService.sessions({
          period: sp.get('period') || undefined,
          state: sp.get('state') || undefined,
          client: sp.get('client') || undefined,
          project: sp.get('project') || undefined,
          deviceId: sp.get('deviceId') ?? sp.get('device') ?? undefined,
          search: sp.get('search') || undefined,
          sort: sp.get('sort') || undefined,
          sortDirection: sp.get('sortDirection') || undefined,
          limit: parseOptionalIntParam(sp.get('limit'), { min: 1, max: 500, name: 'limit' }),
          cursor: sp.get('cursor') || undefined
        }));
        return true;
      }

      if (url.pathname === '/api/query/session-detail') {
        await runQueryHttp(res, () => queryService.sessionDetail({
          client: sp.get('client') || '',
          sessionId: sp.get('sessionId') ?? sp.get('session_id') ?? '',
          deviceId: sp.get('deviceId') ?? sp.get('device') ?? '',
          period: sp.get('period') || 'total',
          includeConversation: parseOptionalBoolParam(sp.get('includeConversation') ?? sp.get('include_conversation'), false),
          limit: parseOptionalIntParam(sp.get('limit'), { min: 1, max: 200, name: 'limit' }),
          offset: parseOptionalIntParam(sp.get('offset'), { min: 0, max: 100000, name: 'offset' }),
          cursor: sp.get('cursor') || undefined
        }));
        return true;
      }

      if (url.pathname === '/api/query/history') {
        await runQueryHttp(res, () => queryService.history({
          resolution: sp.get('resolution') || undefined,
          from: sp.get('from') || undefined,
          to: sp.get('to') || undefined,
          groupBy: sp.get('groupBy') ?? sp.get('group_by') ?? undefined,
          limit: parseOptionalIntParam(sp.get('limit'), { min: 1, max: 500, name: 'limit' })
        }));
        return true;
      }

      if (url.pathname === '/api/query/devices') {
        await runQueryHttp(res, () => queryService.devices({
          deviceId: sp.get('deviceId') ?? sp.get('device') ?? undefined,
          includeDiagnostics: parseOptionalBoolParam(sp.get('includeDiagnostics') ?? sp.get('include_diagnostics'), true)
        }));
        return true;
      }

      if (url.pathname === '/api/query/limits') {
        await runQueryHttp(res, () => queryService.limits({
          thirdPartyOnly: parseOptionalBoolParam(sp.get('thirdPartyOnly'), false),
          provider: sp.get('provider') || undefined,
          status: sp.get('status') || undefined,
          maxProviders: parseOptionalIntParam(sp.get('maxProviders'), { min: 1, max: 100, name: 'maxProviders' }),
          includeHistory: parseOptionalBoolParam(sp.get('includeHistory') ?? sp.get('history'), false),
          accountKey: sp.get('accountKey') || undefined,
          windowName: sp.get('windowName') || undefined,
          hours: parseOptionalNumberParam(sp.get('hours'), { min: 1, max: 720, name: 'hours' })
        }));
        return true;
      }

      if (url.pathname === '/api/query/subscriptions') {
        await runQueryHttp(res, () => queryService.subscriptions({
          date: sp.get('date') || undefined,
          includeForecasts: parseOptionalBoolParam(sp.get('includeForecasts'), true),
          activeOnly: parseOptionalBoolParam(sp.get('activeOnly'), false)
        }));
        return true;
      }

      if (url.pathname === '/api/query/live-rate') {
        await runQueryHttp(res, () => queryService.liveRate({
          deviceId: sp.get('deviceId') ?? sp.get('device') ?? undefined
        }));
        return true;
      }

      if (url.pathname === '/api/query/service-status') {
        const rawProviderIds = sp.get('providerIds');
        const providerIds = rawProviderIds
          ? rawProviderIds.split(',').map((s) => s.trim()).filter(Boolean)
          : null;
        await runQueryHttp(res, () => queryService.serviceStatus({
          force: parseOptionalBoolParam(sp.get('force'), false),
          providerIds,
          includeResetForecast: parseOptionalBoolParam(sp.get('includeResetForecast'), true),
          includeApprovals: parseOptionalBoolParam(sp.get('includeApprovals'), true)
        }));
        return true;
      }

      return false;
    }

    if (url.pathname === '/api/reports' && req.method === 'GET') {
      if (!reportManager) {
        sendJson(res, 501, { ok: false, error: 'not_implemented', message: 'Report manager is not enabled on this endpoint.' });
        return true;
      }
      const granularityParam = url.searchParams.get('granularity');
      const limitParam = url.searchParams.get('limit');
      let limit;
      if (limitParam !== null && limitParam !== '') {
        const parsedLimit = Number(limitParam);
        if (!Number.isInteger(parsedLimit) || parsedLimit < 1) {
          sendJson(res, 400, { error: 'invalid_request', message: 'limit must be a positive integer' });
          return true;
        }
        limit = parsedLimit;
      }
      const result = reportManager.listReports({
        ...(granularityParam ? { granularity: granularityParam } : {}),
        ...(limit !== undefined ? { limit } : {})
      });
      if (result.ok === false) {
        sendJson(res, 400, result);
        return true;
      }
      const reports = Array.isArray(result.reports)
        ? result.reports.map((item) => ({
            ...item,
            hasAiAnalysis: typeof resolvedReadCachedAnalysis === 'function'
              ? Boolean(resolvedReadCachedAnalysis(item.granularity, item.periodKey))
              : false
          }))
        : [];
      sendJson(res, 200, {
        ...result,
        reports,
        ...(typeof resolvedGetStatus === 'function' ? { integrations: resolvedGetStatus() } : {})
      });
      return true;
    }

    if (url.pathname === '/api/reports/integrations') {
      if (req.method === 'GET') {
        if (typeof resolvedGetStatus !== 'function') {
          sendJson(res, 501, { ok: false, error: 'not_implemented' });
          return true;
        }
        sendJson(res, 200, { ok: true, ...resolvedGetStatus() });
        return true;
      }
      if (req.method === 'PUT') {
        if (typeof resolvedUpdateConfig !== 'function') {
          sendJson(res, 501, { ok: false, error: 'not_implemented' });
          return true;
        }
        try {
          const payload = await readJsonBody(req);
          if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            sendJson(res, 400, { error: 'bad_request', message: 'Integrations payload must be an object' });
            return true;
          }
          const updated = resolvedUpdateConfig(payload);
          if (updated.ok === false) {
            sendJson(res, 400, updated);
            return true;
          }
          sendJson(res, 200, updated);
          return true;
        } catch (error) {
          if (error.code === 'payload_too_large') {
            res.shouldKeepAlive = false;
            sendJson(res, 413, { error: 'payload_too_large', message: error.message }, { connection: 'close' });
            return true;
          }
          sendJson(res, 400, { error: 'bad_request', message: error.message });
          return true;
        }
      }
      sendJson(res, 405, { error: 'invalid_request' });
      return true;
    }

    if (url.pathname === '/api/reports/ai-analyze' && req.method === 'POST') {
      if (typeof resolvedAnalyzeAi !== 'function') {
        sendJson(res, 501, { ok: false, error: 'not_implemented' });
        return true;
      }
      try {
        const payload = await readJsonBody(req);
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
          sendJson(res, 400, { error: 'invalid_request', message: 'Request body must be an object' });
          return true;
        }
        const result = await resolvedAnalyzeAi({
          granularity: payload.granularity,
          periodKey: payload.periodKey,
          question: payload.question,
          language: payload.language,
          refresh: Boolean(payload.refresh)
        });
        if (!result.ok) {
          sendJson(res, mapErrorStatus(result), result);
          return true;
        }
        sendJson(res, 200, result);
        return true;
      } catch (error) {
        if (error.code === 'payload_too_large') {
          res.shouldKeepAlive = false;
          sendJson(res, 413, { error: 'payload_too_large', message: error.message }, { connection: 'close' });
          return true;
        }
        sendJson(res, 400, { error: 'bad_request', message: error.message });
        return true;
      }
    }

    if (url.pathname === '/api/reports/push' && req.method === 'POST') {
      if (typeof resolvedPushReport !== 'function') {
        sendJson(res, 501, { ok: false, error: 'not_implemented' });
        return true;
      }
      try {
        const payload = await readJsonBody(req);
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
          sendJson(res, 400, { error: 'invalid_request', message: 'Request body must be an object' });
          return true;
        }
        const result = await resolvedPushReport({
          target: payload.target,
          granularity: payload.granularity,
          periodKey: payload.periodKey,
          includeAi: payload.includeAi,
          includeLimits: payload.includeLimits,
          refreshAi: Boolean(payload.refreshAi),
          question: payload.question,
          customMessage: payload.customMessage,
          idempotencyKey: payload.idempotencyKey
        });
        if (!result.ok) {
          sendJson(res, mapErrorStatus(result), result);
          return true;
        }
        sendJson(res, 200, result);
        return true;
      } catch (error) {
        if (error.code === 'payload_too_large') {
          res.shouldKeepAlive = false;
          sendJson(res, 413, { error: 'payload_too_large', message: error.message }, { connection: 'close' });
          return true;
        }
        sendJson(res, 400, { error: 'bad_request', message: error.message });
        return true;
      }
    }

    if (url.pathname === '/api/integrations/openclaw/push') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'invalid_request' });
        return true;
      }
      try {
        const payload = await readJsonBody(req);
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
          sendJson(res, 400, { ok: false, error: 'invalid_request', message: 'Request body must be an object' });
          return true;
        }
        const isTest = payload.test === true || String(payload.type || '').trim().toLowerCase() === 'test';
        let result;
        if (isTest) {
          if (typeof resolvedSendTest !== 'function') {
            sendJson(res, 501, { ok: false, error: 'not_implemented', message: 'OpenClaw test push is unavailable.' });
            return true;
          }
          result = await resolvedSendTest({
            message: payload.message ?? payload.customMessage ?? '',
            source: payload.source || 'api_test'
          });
        } else {
          if (typeof resolvedPushQuery !== 'function') {
            sendJson(res, 501, { ok: false, error: 'not_implemented', message: 'OpenClaw query push is unavailable.' });
            return true;
          }
          result = await resolvedPushQuery({
            type: payload.type || 'usage',
            params: isPlainObject(payload.params) ? payload.params : {},
            includeAi: payload.includeAi,
            customMessage: payload.customMessage ?? payload.message ?? '',
            idempotencyKey: payload.idempotencyKey || '',
            source: payload.source || 'api_push'
          });
        }
        if (!result.ok) {
          sendJson(res, mapErrorStatus(result), result);
          return true;
        }
        sendJson(res, 200, result);
        return true;
      } catch (error) {
        if (error.code === 'payload_too_large') {
          res.shouldKeepAlive = false;
          sendJson(res, 413, { error: 'payload_too_large', message: error.message }, { connection: 'close' });
          return true;
        }
        sendJson(res, 400, { error: 'bad_request', message: error.message });
        return true;
      }
    }

    if (url.pathname === '/api/integrations/openclaw/history') {
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'invalid_request' });
        return true;
      }
      if (typeof resolvedGetPushHistory !== 'function') {
        sendJson(res, 200, { ok: true, count: 0, lastPush: null, history: [] });
        return true;
      }
      sendJson(res, 200, { ok: true, ...(await resolvedGetPushHistory()) });
      return true;
    }

    if (url.pathname === '/api/integrations/openclaw/brief' && req.method === 'GET') {
      if (typeof resolvedBuildBrief !== 'function') {
        sendJson(res, 501, { ok: false, error: 'not_implemented' });
        return true;
      }
      const granularity = url.searchParams.get('granularity') || 'daily';
      const periodKey = url.searchParams.get('periodKey') || 'latest';
      const includeAi = url.searchParams.get('includeAi') !== 'false';
      const includeLimits = url.searchParams.get('includeLimits') !== 'false';
      const format = (url.searchParams.get('format') || 'json').toLowerCase();
      const result = resolvedBuildBrief({
        granularity,
        periodKey,
        includeAi,
        includeLimits
      });
      if (!result.ok) {
        sendJson(res, mapErrorStatus(result), result);
        return true;
      }
      if (format === 'text' || format === 'markdown') {
        sendText(res, 200, result.text || '');
        return true;
      }
      sendJson(res, 200, result);
      return true;
    }

    if (url.pathname === '/api/integrations/openclaw/env') {
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'invalid_request' });
        return true;
      }
      if (typeof resolvedGetEnv !== 'function') {
        sendJson(res, 501, { ok: false, error: 'not_implemented' });
        return true;
      }
      const env = await resolvedGetEnv();
      sendJson(res, 200, env);
      return true;
    }

    if (url.pathname === '/api/integrations/openclaw/qr/start') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'invalid_request' });
        return true;
      }
      if (typeof resolvedQrStart !== 'function') {
        sendJson(res, 501, { ok: false, error: 'not_implemented' });
        return true;
      }
      const result = await resolvedQrStart();
      if (!result.ok) {
        const status = result.error === 'hub_stopped' ? 503 : 502;
        sendJson(res, status, result);
        return true;
      }
      sendJson(res, 200, result);
      return true;
    }

    if (url.pathname === '/api/integrations/openclaw/qr/status') {
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'invalid_request' });
        return true;
      }
      if (typeof resolvedQrStatus !== 'function') {
        sendJson(res, 501, { ok: false, error: 'not_implemented' });
        return true;
      }
      const sessionId = url.searchParams.get('sessionId') || '';
      if (!sessionId.trim()) {
        sendJson(res, 400, { ok: false, error: 'invalid_request', message: 'sessionId query parameter is required' });
        return true;
      }
      const result = await resolvedQrStatus(sessionId);
      if (!result.ok && result.error === 'qr_session_not_found') {
        sendJson(res, 404, result);
        return true;
      }
      if (!result.ok && (result.error === 'qr_poll_failed' || result.error === 'qr_refresh_failed')) {
        sendJson(res, 502, result);
        return true;
      }
      sendJson(res, 200, result);
      return true;
    }

    if (url.pathname === '/api/integrations/openclaw/qr/verify') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'invalid_request' });
        return true;
      }
      if (typeof resolvedQrVerify !== 'function') {
        sendJson(res, 501, { ok: false, error: 'not_implemented' });
        return true;
      }
      try {
        const payload = await readJsonBody(req);
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
          sendJson(res, 400, { ok: false, error: 'invalid_request', message: 'Request body must be an object' });
          return true;
        }
        const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId.trim() : '';
        const verifyCode = typeof payload.verifyCode === 'string' ? payload.verifyCode.trim() : '';
        if (!sessionId || !verifyCode) {
          sendJson(res, 400, { ok: false, error: 'invalid_request', message: 'sessionId and verifyCode are required' });
          return true;
        }
        const result = await resolvedQrVerify(sessionId, verifyCode);
        if (!result.ok && result.error === 'qr_session_not_found') {
          sendJson(res, 404, result);
          return true;
        }
        if (!result.ok && (result.error === 'qr_poll_failed' || result.error === 'qr_refresh_failed')) {
          sendJson(res, 502, result);
          return true;
        }
        sendJson(res, 200, result);
        return true;
      } catch (error) {
        if (error.code === 'payload_too_large') {
          res.shouldKeepAlive = false;
          sendJson(res, 413, { error: 'payload_too_large', message: error.message }, { connection: 'close' });
          return true;
        }
        sendJson(res, 400, { error: 'bad_request', message: error.message });
        return true;
      }
    }

    if (url.pathname === '/api/integrations/openclaw/qr/cancel') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'invalid_request' });
        return true;
      }
      if (typeof resolvedQrCancel !== 'function') {
        sendJson(res, 501, { ok: false, error: 'not_implemented' });
        return true;
      }
      try {
        const raw = await readRawTextBody(req);
        const payload = raw.trim() ? JSON.parse(raw) : {};
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
          sendJson(res, 400, { ok: false, error: 'invalid_request', message: 'Request body must be an object' });
          return true;
        }
        const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId.trim() : '';
        sendJson(res, 200, resolvedQrCancel(sessionId));
        return true;
      } catch (error) {
        if (error.code === 'payload_too_large') {
          res.shouldKeepAlive = false;
          sendJson(res, 413, { error: 'payload_too_large', message: error.message }, { connection: 'close' });
          return true;
        }
        sendJson(res, 400, { error: 'bad_request', message: error.message });
        return true;
      }
    }

    if (url.pathname === '/api/integrations/openclaw/provision') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'invalid_request' });
        return true;
      }
      if (typeof resolvedProvision !== 'function') {
        sendJson(res, 501, { ok: false, error: 'not_implemented' });
        return true;
      }
      try {
        const raw = await readRawTextBody(req);
        const payload = raw.trim() ? JSON.parse(raw) : {};
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
          sendJson(res, 400, { ok: false, error: 'invalid_request', message: 'Request body must be an object' });
          return true;
        }
        const result = await resolvedProvision(payload);
        if (!result.ok) {
          const status = result.error === 'hub_stopped' ? 503 : 400;
          sendJson(res, status, result);
          return true;
        }
        sendJson(res, 200, result);
        return true;
      } catch (error) {
        if (error.code === 'payload_too_large') {
          res.shouldKeepAlive = false;
          sendJson(res, 413, { error: 'payload_too_large', message: error.message }, { connection: 'close' });
          return true;
        }
        sendJson(res, 400, { error: 'bad_request', message: error.message });
        return true;
      }
    }

    if (url.pathname === '/api/reports/config') {
      if (!reportManager) {
        sendJson(res, 501, { ok: false, error: 'not_implemented' });
        return true;
      }
      if (req.method === 'GET') {
        sendJson(res, 200, { ok: true, ...reportManager.getConfig() });
        return true;
      }
      if (req.method === 'PUT') {
        try {
          const payload = await readJsonBody(req);
          if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).length === 0) {
            sendJson(res, 400, { error: 'bad_request', message: 'Report config must be a non-empty object' });
            return true;
          }
          for (const [key, value] of Object.entries(payload)) {
            if (!ALLOWED_REPORT_CONFIG_KEYS.has(key)) {
              sendJson(res, 400, { error: 'bad_request', message: `Unsupported report config field: ${key}` });
              return true;
            }
            if (typeof value !== 'boolean') {
              sendJson(res, 400, { error: 'bad_request', message: `${key} must be a boolean` });
              return true;
            }
          }
          const updated = reportManager.setConfig(payload);
          sendJson(res, 200, { ok: true, ...updated });
          return true;
        } catch (error) {
          if (error.code === 'payload_too_large') {
            res.shouldKeepAlive = false;
            sendJson(res, 413, { error: 'payload_too_large', message: error.message }, { connection: 'close' });
            return true;
          }
          sendJson(res, 400, { error: 'bad_request', message: error.message });
          return true;
        }
      }
      sendJson(res, 405, { error: 'invalid_request' });
      return true;
    }

    if (url.pathname === '/api/reports/generate' && req.method === 'POST') {
      if (!reportManager) {
        sendJson(res, 501, { ok: false, error: 'not_implemented' });
        return true;
      }
      try {
        const payload = await readJsonBody(req);
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
          sendJson(res, 400, { error: 'invalid_request', message: 'Request body must be an object' });
          return true;
        }
        if (payload.granularity !== undefined && typeof payload.granularity !== 'string') {
          sendJson(res, 400, { error: 'invalid_request', message: 'granularity must be a string' });
          return true;
        }
        if (payload.periodKey !== undefined && typeof payload.periodKey !== 'string') {
          sendJson(res, 400, { error: 'invalid_request', message: 'periodKey must be a string' });
          return true;
        }
        if (payload.force !== undefined && typeof payload.force !== 'boolean') {
          sendJson(res, 400, { error: 'invalid_request', message: 'force must be a boolean' });
          return true;
        }
        if (payload.timeZone !== undefined && typeof payload.timeZone !== 'string') {
          sendJson(res, 400, { error: 'invalid_request', message: 'timeZone must be a string' });
          return true;
        }
        const result = reportManager.generateReport(payload);
        if (result.ok === false) {
          sendJson(res, 400, result);
          return true;
        }
        sendJson(res, 200, result);
        return true;
      } catch (error) {
        if (error.code === 'payload_too_large') {
          res.shouldKeepAlive = false;
          sendJson(res, 413, { error: 'payload_too_large', message: error.message }, { connection: 'close' });
          return true;
        }
        sendJson(res, 400, { error: 'bad_request', message: error.message });
        return true;
      }
    }

    const reportMatch = url.pathname.match(/^\/api\/reports\/([^/]+)\/([^/]+)$/);
    if (reportMatch && req.method === 'GET') {
      if (!reportManager) {
        sendJson(res, 501, { ok: false, error: 'not_implemented' });
        return true;
      }
      const granularity = decodeURIComponent(reportMatch[1]);
      const periodKey = decodeURIComponent(reportMatch[2]);
      if (!REPORT_GRANULARITIES.includes(granularity)) {
        sendJson(res, 400, { error: 'invalid_request', message: `Invalid granularity: ${granularity}` });
        return true;
      }
      const format = url.searchParams.get('format') || 'both';
      const timeZone = url.searchParams.get('timeZone') || undefined;
      const result = reportManager.getReport(granularity, periodKey, { format, timeZone });
      if (result?.error === 'not_found') {
        sendJson(res, 404, { error: 'not_found' });
        return true;
      }
      if (result?.error === 'invalid_request') {
        sendJson(res, 400, result);
        return true;
      }
      if (result?.ok && result.report && format !== 'markdown' && typeof resolvedReadCachedAnalysis === 'function') {
        const aiAnalysis = resolvedReadCachedAnalysis(
          result.report.granularity,
          result.report.period?.key,
          result.report
        );
        if (aiAnalysis) {
          sendJson(res, 200, { ...result, aiAnalysis });
          return true;
        }
      }
      sendJson(res, 200, result);
      return true;
    }

    if (url.pathname === '/api/mcp') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'invalid_request' });
        return true;
      }
      try {
        const rawBody = await readRawTextBody(req);
        const rpcResponse = await resolvedMcpServer.handlePayload(rawBody);
        if (rpcResponse === null) {
          sendText(res, 204, '');
          return true;
        }
        sendJson(res, 200, rpcResponse);
        return true;
      } catch (error) {
        if (error.code === 'payload_too_large') {
          res.shouldKeepAlive = false;
          sendJson(res, 413, { error: 'payload_too_large', message: error.message }, { connection: 'close' });
          return true;
        }
        sendJson(res, 400, { error: 'bad_request', message: error.message });
        return true;
      }
    }

    return false;
  }

  return {
    handleRequest,
    queryService,
    mcpServer: resolvedMcpServer
  };
}

function createHub({
  port = 17321,
  deployment,
  host = '0.0.0.0',
  secret = '',
  syncSessionTitles = false,
  sessionConversations = false,
  approvalAlerts = false,
  reports = undefined,
  reportsDir = '',
  integrations = undefined,
  integrationSecrets = null,
  integrationFetch = undefined,
  openclawOptions = undefined,
  getEnhancedQueryContext = null,
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
  broadcastDelayMs = 100,
  persistIntervalMs = 0,
  dataFile = path.join(projectRoot(), 'data', 'devices.json'),
  logger = console
} = {}) {
  if (!Number.isFinite(persistIntervalMs) || persistIntervalMs < 0 || persistIntervalMs > 2147483647) {
    throw new RangeError('persistIntervalMs must be a finite number between 0 and 2147483647 milliseconds');
  }
  const store = readJson(dataFile, { version: 1, devices: {} }) || { version: 1, devices: {} };
  if (!store.devices || typeof store.devices !== 'object') store.devices = {};
  // Subscriptions are shared by every device on this hub rather than owned by one
  // of them, so they sit beside the device map rather than inside it.
  if (!store.subscriptions || typeof store.subscriptions !== 'object') {
    store.subscriptions = emptySubscriptionDocument();
  }
  const serverTitlesEnabled = syncSessionTitlesEnabled(syncSessionTitles);
  store.devices = Object.assign(Object.create(null), store.devices);
  store.syncTitlePolicies = Object.assign(Object.create(null), store.syncTitlePolicies || {});
  store.syncSettings = Object.assign(Object.create(null), store.syncSettings || {});
  const bindHost = resolveBindHost(host, secret);
  const uploadBaselines = createUploadBaselines();
  const conversationRelay = createSessionConversationRelay({ enabled: sessionConversations === true,
    getDevice: (id) => store.devices[id] });
  const approvalAlertStore = createApprovalAlertStore({ enabled: approvalAlerts === true,
    getDevice: (id) => store.devices[id] });
  const antigravityManagerStore = createAntigravityManagerStore({ dataFile, logger });
  let integrationManager = null;
  let openclawSurface = null;
  const reportManager = createReportManager({
    dataFile,
    reportsDir,
    config: reports,
    getStats,
    getHistory,
    getDevices,
    hubRuntime: 'node-hub',
    onReportArchived: (event) => integrationManager?.onReportArchived(event),
    logger
  });
  integrationManager = createIntegrationManager({
    dataFile,
    reportsDir,
    reportManager,
    getStats,
    getHistory,
    getSubscriptions,
    getQueryContext: getEnhancedQueryContext,
    executeQuery: (queryType, params, openclawCfg) => openclawSurface.queryService.execute(queryType, params, openclawCfg),
    sessionTitlesEnabled: serverTitlesEnabled,
    initialConfig: integrations,
    initialSecrets: integrationSecrets,
    openclawOptions,
    fetchImpl: integrationFetch,
    logger
  });
  openclawSurface = createOpenClawEndpointSurface({
    getStats,
    getHistory,
    getSubscriptions,
    getDevices,
    getModelAliasSettings: () => getSyncSettings('modelAliases')?.value || null,
    getEnhancedQueryContext,
    serverTitlesEnabled,
    integrationManager,
    reportManager,
    listApprovalAlerts: () => approvalAlertStore.list(),
    mcpServerInfo: { name: 'token-monitor-hub', version: '1.0.0' }
  });
  let persistTimer = null;
  let persistPending = false;
  let stopping = false;
  let stopPromise = null;

  // Apply the permission at startup, including records from offline devices.
  // Keep disabled policies as tombstones so re-enabling cannot reuse old tokens.
  const beforeCleanup = JSON.stringify([store.devices, store.syncTitlePolicies]);
  for (const [id, policy] of Object.entries(store.syncTitlePolicies)) {
    if (!serverTitlesEnabled && policy?.enabled === true) store.syncTitlePolicies[id] = nextTitlePolicy(policy, false);
  }
  for (const [id, record] of Object.entries(store.devices)) {
    store.devices[id] = stripSessionTextFromDeviceRecord(record, {
      preserveSessionTitles: serverTitlesEnabled && normalizeTitlePolicy(store.syncTitlePolicies[id]).enabled
    });
  }
  if (JSON.stringify([store.devices, store.syncTitlePolicies]) !== beforeCleanup) persist();

  function persist() {
    store.version = 1;
    store.savedAt = new Date().toISOString();
    writeJsonAtomic(dataFile, store, 0);
    clearTimeout(persistTimer);
    persistTimer = null;
    persistPending = false;
  }

  function queuePersist() {
    if (persistIntervalMs === 0) return persist();
    persistPending = true;
    // Admitted HTTP uploads can finish during stop; its final flush owns them.
    if (stopping) return;
    // Keep the first deadline: continuous uploads must not postpone saving.
    if (persistTimer) return;
    persistTimer = setTimeout(() => {
      persistTimer = null;
      try { persist(); } catch (error) {
        (logger.error || console.error)('Hub failed to save pending device records:', error);
      }
    }, persistIntervalMs);
    persistTimer.unref();
  }

  function getStats() {
    const stats = aggregateDevices(Object.values(store.devices), staleAfterMs);
    stats.staleAfterMs = staleAfterMs;
    const history = aggregateHistory(Object.values(store.devices));
    stats.historyPreview = historyPreview(history);
    stats.historyRevision = historyRevision(history);
    stats.deviceHistoryRevision = deviceHistoryRevision(Object.values(store.devices));
    // The version of the shared subscription list, never the list itself. A
    // device compares it against the copy it holds and re-reads only when it has
    // been overtaken, so learning about another device's edit costs nothing in
    // the steady state and does not put what the user pays into every frame.
    stats.subscriptionsUpdatedAt = store.subscriptions?.updatedAt || '';
    stats.syncSettingsRevisions = Object.fromEntries(SHARED_SYNC_KINDS.map((kind) => [kind, getSyncSettings(kind).revision]));
    return stats;
  }

  function getHistory() {
    return aggregateHistory(Object.values(store.devices));
  }

  function getDevices() {
    return Object.values(store.devices);
  }

  const sseClients = new Set();
  const statsListeners = new Set();
  let broadcastTimer = null;
  let lastSseContentKey = '';
  let lastSseStats = null;
  let streamRevision = 0;
  const unsubscribeIntegrationStats = onStats((stats) => integrationManager.onStatsSnapshot(stats));

  // Once write() reports backpressure, later frames still queue in order behind
  // the frame in flight, up to SSE_BACKLOG_LIMIT_BYTES. Past that budget the
  // connection skips frames and resyncs once its transport drains.
  function writeSseFrame(client, frame) {
    if (!frame) return false;
    if (client.blocked && (client.needsSnapshot || client.res.writableLength + Buffer.byteLength(frame) > client.backlogLimit)) {
      client.needsSnapshot = true;
      return false;
    }
    try {
      if (client.res.write(frame) === false && !client.blocked) {
        client.blocked = true;
        client.backlogLimit = client.res.writableLength + SSE_BACKLOG_LIMIT_BYTES;
        client.res.once('drain', client.onDrain);
      }
      return true;
    } catch (_) {
      client.cleanup();
      return false;
    }
  }

  function fanoutSseFrames(frames) {
    for (const client of sseClients) {
      if (writeSseFrame(client, sseFrameForClient(frames, client)) && client.deltaEvents) client.streamRevision = frames.revision;
    }
  }

  function notifyStatsListeners(reason, stats = getStats(), at = new Date().toISOString()) {
    for (const listener of statsListeners) {
      try { listener(stats, reason, at); } catch (_) { /* listener errors must not break ingest */ }
    }
  }

  function broadcastStats(reason = 'update') {
    if (broadcastTimer) {
      clearTimeout(broadcastTimer);
      broadcastTimer = null;
    }
    if (sseClients.size === 0 && statsListeners.size === 0) return;
    const stats = getStats();
    const at = new Date().toISOString();
    if (sseClients.size > 0) {
      const frames = prepareSseFanout({
        reason,
        stats,
        at,
        lastContentKey: lastSseContentKey,
        previousStats: lastSseStats,
        revision: ++streamRevision,
        ...sseClientKinds(sseClients),
        allowFreshness: false
      });
      lastSseContentKey = frames.contentKey;
      lastSseStats = stats;
      fanoutSseFrames(frames);
    }
    // Embedded widgets add local presentation metadata to their snapshot. Do
    // not expose the immutable SSE delta baseline to those observers.
    notifyStatsListeners(reason, sseClients.size > 0 && statsListeners.size > 0 ? getStats() : stats, at);
  }

  function flushQueuedStatsBroadcast() {
    broadcastTimer = null;
    if (sseClients.size === 0) return;
    const stats = getStats();
    const at = new Date().toISOString();
    const frames = prepareSseFanout({
      reason: 'ingest',
      stats,
      at,
      lastContentKey: lastSseContentKey,
      previousStats: lastSseStats,
      revision: ++streamRevision,
      ...sseClientKinds(sseClients)
    });
    lastSseContentKey = frames.contentKey;
    lastSseStats = stats;
    fanoutSseFrames(frames);
  }

  function queueStatsBroadcast() {
    if (sseClients.size === 0 || broadcastTimer) return;
    broadcastTimer = setTimeout(flushQueuedStatsBroadcast, Math.max(0, Number(broadcastDelayMs) || 0));
  }

  // Transport-agnostic core: both the HTTP POST handler and the same-process
  // widget call these, so a host-mode widget never has to loopback to itself.
  function ingest(payload) {
    if (stopping) throw Object.assign(new Error('Hub is stopping'), { code: 'hub_stopping' });
    return ingestRecord(payload);
  }

  function ingestRecord(payload) {
    if (!payload || (!payload.deviceId && !payload.id)) {
      throw new Error('deviceId_required');
    }
    const deviceId = String(payload.deviceId || payload.id);
    uploadBaselines.forget(deviceId);
    const record = mergeSyncDeviceRecord(store.devices[deviceId], { ...payload, receivedAt: new Date().toISOString() }, {
      preserveSessionTitles: acceptsSessionTitles(serverTitlesEnabled, store.syncTitlePolicies[deviceId], payload.sessionTitleSyncGeneration)
    });
    store.devices[record.deviceId] = record;
    queuePersist();
    if (statsListeners.size > 0) notifyStatsListeners('ingest');
    queueStatsBroadcast();
    try { reportManager.onStatsChanged(); } catch (error) {
      (logger.error || console.error)('Hub failed to update report snapshot on ingest:', error);
    }
    return record;
  }

  function deleteDevice(deviceId) {
    uploadBaselines.forget(deviceId);
    // Commit deletion and revocation together, keeping a generation tombstone.
    const previousPolicy = store.syncTitlePolicies[deviceId];
    const previousDevice = store.devices[deviceId];
    const previousSavedAt = store.savedAt;
    store.syncTitlePolicies[deviceId] = nextTitlePolicy(previousPolicy, false);
    delete store.devices[deviceId];
    try { persist(); } catch (error) {
      if (previousPolicy) store.syncTitlePolicies[deviceId] = previousPolicy;
      else delete store.syncTitlePolicies[deviceId];
      if (previousDevice) store.devices[deviceId] = previousDevice;
      store.savedAt = previousSavedAt;
      throw error;
    }
    conversationRelay.remove(deviceId);
    approvalAlertStore.remove(deviceId);
    antigravityManagerStore.removeDevice(deviceId);
    broadcastStats('delete');
    try { reportManager.onStatsChanged(); } catch (error) {
      (logger.error || console.error)('Hub failed to update report snapshot on delete:', error);
    }
  }

  function getSyncContent() {
    return syncContentCapability(serverTitlesEnabled);
  }

  function getSyncSettings(kind) {
    if (!SHARED_SYNC_KINDS.includes(kind)) {
      const error = new Error('unknown shared settings kind');
      error.code = 'bad_request';
      throw error;
    }
    return store.syncSettings[kind] || emptySharedSyncDocument();
  }

  function setSyncSettings(kind, payload) {
    const next = nextSharedSyncDocument(kind, getSyncSettings(kind), payload);
    const previous = store.syncSettings[kind];
    const previousSavedAt = store.savedAt;
    store.syncSettings[kind] = next;
    try { persist(); } catch (error) {
      if (previous) store.syncSettings[kind] = previous;
      else delete store.syncSettings[kind];
      store.savedAt = previousSavedAt;
      throw error;
    }
    broadcastStats('sync-settings');
    return next;
  }

  function setSyncTitlePolicy(deviceId, enabled) {
    if (enabled === true && !serverTitlesEnabled) {
      const error = new Error('session title sync is disabled on the server');
      error.code = 'forbidden';
      throw error;
    }
    const previous = store.syncTitlePolicies[deviceId];
    const next = nextTitlePolicy(previous, enabled);
    if (enabled && normalizeTitlePolicy(previous).enabled) return next;
    uploadBaselines.forget(deviceId);
    const previousDevice = store.devices[deviceId];
    const previousSavedAt = store.savedAt;
    store.syncTitlePolicies[deviceId] = next;
    if (!enabled && previousDevice) store.devices[deviceId] = stripSessionTextFromDeviceRecord(previousDevice);
    try { persist(); } catch (error) {
      if (previous) store.syncTitlePolicies[deviceId] = previous;
      else delete store.syncTitlePolicies[deviceId];
      if (previousDevice) store.devices[deviceId] = previousDevice;
      store.savedAt = previousSavedAt;
      throw error;
    }
    broadcastStats('sync-titles');
    return next;
  }

  function getSubscriptions() {
    return store.subscriptions;
  }

  // Transport-agnostic like ingest(), so a host-mode widget writes its own hub
  // in-process instead of looping back over HTTP to itself.
  function setSubscriptions(subscriptions, baseUpdatedAt) {
    // A non-array would normalize to an empty list and be stored as a perfectly
    // successful replacement, wiping records that exist nowhere else. An
    // intentional clear still sends [].
    if (!Array.isArray(subscriptions)) {
      const error = new Error('subscriptions must be an array');
      error.code = 'bad_subscriptions';
      throw error;
    }
    if (isStaleSubscriptionWrite(store.subscriptions, baseUpdatedAt)) {
      const error = new Error('stale_write');
      error.code = 'stale_write';
      error.current = store.subscriptions;
      throw error;
    }
    // A currency with no exchange rate would be coerced to USD and reported as
    // an amount the user never entered. The endpoint says it validates, so it
    // refuses rather than quietly rewriting what somebody pays.
    const unsupported = subscriptions.find(
      (entry) => entry?.currency && !CURRENCY_CODES.includes(String(entry.currency).trim().toUpperCase())
    );
    if (unsupported) {
      const error = new Error(`unsupported currency: ${String(unsupported.currency).trim().toUpperCase()}`);
      error.code = 'bad_subscriptions';
      throw error;
    }
    const next = subscriptionDocument(subscriptions, {
      previousUpdatedAt: store.subscriptions?.updatedAt,
      currencyApi: { normalizeCurrency }
    });
    // Persist before the in-memory list moves. Otherwise a failed write leaves
    // this process serving records the file does not have, and a restart quietly
    // reverts to the old ones — the worst shape for data that exists nowhere else.
    const previous = store.subscriptions;
    const previousSavedAt = store.savedAt;
    store.subscriptions = next;
    try {
      persist();
    } catch (error) {
      store.subscriptions = previous;
      store.savedAt = previousSavedAt;
      throw error;
    }
    // Same reason ingest() broadcasts: the other devices are holding a copy that
    // has just been overtaken, and without this they only find out on their next
    // poll — which is five minutes apart while the stream is up.
    broadcastStats('subscriptions');
    return store.subscriptions;
  }

  function onStats(listener) {
    statsListeners.add(listener);
    return () => statsListeners.delete(listener);
  }

  async function handleRequest(req, res) {
    // Existing sockets can finish their headers after server.close(). In
    // particular, do not admit a new SSE stream after ending the old streams.
    if (stopping) {
      res.shouldKeepAlive = false;
      return sendJson(res, 503, { error: 'hub_stopping' }, { connection: 'close' });
    }
    if (req.method === 'OPTIONS') return sendText(res, 204, '');
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/api/health') {
      return sendJson(res, 200, {
        ok: true,
        role: 'hub',
        runtime: 'node-hub',
        ...(deployment ? { deployment } : {}),
        version: store.version || 1,
        hubBuild: currentHubBuild('node-hub'),
        deviceCount: Object.keys(store.devices).length,
        secretRequired: Boolean(secret),
        now: new Date().toISOString()
      });
    }

    if (!isAuthorized(req, secret)) return sendJson(res, 401, { error: 'unauthorized' });

    if (url.pathname === CONVERSATION_BASE || url.pathname === `${CONVERSATION_BASE}/poll`) {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'invalid_request' });
      const controller = new AbortController();
      const cancel = () => controller.abort();
      res.once('close', cancel);
      try {
        const result = url.pathname.endsWith('/poll')
          ? await conversationRelay.poll(url.searchParams.get('deviceId'), url.searchParams.get('instance'), controller.signal)
          : await conversationRelay.query({ deviceId: url.searchParams.get('deviceId'), key: url.searchParams.get('key'),
            cursor: url.searchParams.get('cursor') || '' }, controller.signal);
        if (!res.destroyed) return sendJson(res, 200, result);
        return;
      } finally { res.off('close', cancel); }
    }
    if (req.method === 'POST' && url.pathname === `${CONVERSATION_BASE}/result`) {
      try {
        const payload = await readJsonBody(req, MAX_CONVERSATION_BYTES + 4096);
        return sendJson(res, 200, conversationRelay.result(payload));
      } catch (error) {
        if (error.code === 'payload_too_large') {
          res.shouldKeepAlive = false;
          return sendJson(res, 413, { error: 'invalid_request' }, { connection: 'close' });
        }
        return sendJson(res, 400, { error: 'invalid_request' });
      }
    }

    if (url.pathname === APPROVAL_ALERT_BASE && req.method === 'POST') {
      try {
        const payload = await readJsonBody(req, MAX_APPROVAL_BODY_BYTES);
        const created = approvalAlertStore.create(payload);
        if (created?.ok && created.id) {
          const listed = approvalAlertStore.list();
          const record = Array.isArray(listed?.alerts)
            ? listed.alerts.find((item) => item.id === created.id)
            : null;
          if (record) {
            Promise.resolve(integrationManager.onApprovalAlertCreated(record)).catch((error) => {
              (logger.error || console.error)('Hub failed to dispatch approval alert to OpenClaw:', error);
            });
          }
        }
        return sendJson(res, 200, created);
      } catch (error) {
        if (error.code === 'payload_too_large') {
          res.shouldKeepAlive = false;
          return sendJson(res, 413, { error: 'invalid_request' }, { connection: 'close' });
        }
        return sendJson(res, 400, { error: 'invalid_request' });
      }
    }

    if (url.pathname === AG_MANAGER_SNAPSHOT_PATH && req.method === 'PUT') {
      try {
        const payload = await readJsonBody(req, MAX_AG_MANAGER_SNAPSHOT_BYTES);
        return sendJson(res, 200, antigravityManagerStore.putSnapshot(payload));
      } catch (error) {
        if (error.code === 'payload_too_large') {
          res.shouldKeepAlive = false;
          return sendJson(res, 413, { error: 'payload_too_large', message: error.message }, { connection: 'close' });
        }
        return sendJson(res, 400, { error: 'invalid_request', message: error.message });
      }
    }

    if (url.pathname === AG_MANAGER_BASE && req.method === 'GET') {
      return sendJson(res, 200, antigravityManagerStore.getSnapshots());
    }

    if (req.method === 'GET' && url.pathname === '/api/sync/content') return sendJson(res, 200, getSyncContent());

    const settingsMatch = url.pathname.match(/^\/api\/sync\/settings\/(modelAliases|customPricing|limitAccountPresentation)$/);
    if (settingsMatch && req.method === 'GET') return sendJson(res, 200, { ok: true, ...getSyncSettings(settingsMatch[1]) });
    const titlesMatch = url.pathname.match(/^\/api\/sync\/titles\/([^/]+)$/);
    if (req.method === 'PUT' && (settingsMatch || titlesMatch)) {
      try {
        const payload = await readJsonBody(req);
        if (settingsMatch) return sendJson(res, 200, { ok: true, ...setSyncSettings(settingsMatch[1], payload) });
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)
          || Object.keys(payload).some((key) => key !== 'enabled') || typeof payload.enabled !== 'boolean') {
          return sendJson(res, 400, { error: 'bad_request', message: 'enabled must be a boolean' });
        }
        const policy = setSyncTitlePolicy(decodeURIComponent(titlesMatch[1]), payload.enabled);
        return sendJson(res, 200, { ok: true, ...policy });
      } catch (error) {
        if (error.code === 'stale_write') return sendJson(res, 409, { error: 'stale_write', ...error.current });
        if (error.code === 'forbidden') return sendJson(res, 403, { error: 'forbidden', message: error.message });
        if (error.code === 'payload_too_large') {
          res.shouldKeepAlive = false;
          return sendJson(res, 413, { error: 'payload_too_large' }, { connection: 'close' });
        }
        return sendJson(res, 400, { error: 'bad_request', message: error.message });
      }
    }

    if (req.method === 'GET' && url.pathname === '/api/stats') return sendJson(res, 200, getStats());
    if (req.method === 'GET' && url.pathname === '/api/devices') return sendJson(res, 200, { devices: getDevices() });
    if (req.method === 'GET' && url.pathname === '/api/history') return sendJson(res, 200, getHistory());

    if (req.method === 'GET' && url.pathname === '/api/stats/stream') {
      const stats = getStats();
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        'connection': 'keep-alive',
        'x-accel-buffering': 'no'
      });
      const client = { res, freshnessEvents: wantsFreshnessEvents(req), deltaEvents: wantsDeltaEvents(req), streamRevision: null, blocked: false, backlogLimit: 0, needsSnapshot: false };
      let heartbeat = null;
      client.cleanup = () => {
        clearInterval(heartbeat);
        res.off('drain', client.onDrain);
        sseClients.delete(client);
        if (sseClients.size === 0) {
          lastSseContentKey = '';
          lastSseStats = null;
          if (broadcastTimer) clearTimeout(broadcastTimer);
          broadcastTimer = null;
        }
      };
      client.onDrain = () => {
        client.blocked = false;
        if (!client.needsSnapshot) return;
        client.needsSnapshot = false;
        // Resync to the baseline the last fan-out established, so the next
        // update resumes with freshness or delta frames, not another snapshot.
        client.streamRevision = null;
        try {
          if (writeSseFrame(client, encodeSseEvent('stats', {
            type: 'stats', reason: 'snapshot', stats: lastSseStats, at: new Date().toISOString(),
            ...(client.deltaEvents ? { revision: streamRevision } : {})
          })) && client.deltaEvents) client.streamRevision = streamRevision;
        } catch (_) { client.cleanup(); }
      };
      res.on('close', client.cleanup);
      res.on('error', client.cleanup);
      if (sseClients.size === 0) {
        lastSseContentKey = hubStatsContentKey(stats);
        lastSseStats = stats;
        if (client.deltaEvents) client.streamRevision = streamRevision;
      }
      sseClients.add(client);
      heartbeat = setInterval(() => {
        if (!client.blocked) writeSseFrame(client, ': hb\n\n');
      }, 30000);
      writeSseFrame(client, encodeSseEvent('snapshot', { type: 'stats', reason: 'snapshot', stats, at: new Date().toISOString(),
        ...(Number.isSafeInteger(client.streamRevision) ? { revision: client.streamRevision } : {}) }));
      return;
    }

    if (req.method === 'POST' && ['/api/ingest', '/api/ingest/delta'].includes(url.pathname)) {
      try {
        const incoming = await readJsonBody(req);
        const delta = url.pathname === '/api/ingest/delta';
        const payload = delta ? uploadBaselines.prepare(incoming) : incoming;
        const record = ingestRecord(payload);
        const upload = delta || req.headers[UPLOAD_HEADER] === UPLOAD_VERSION
          ? uploadBaselines.commit(record.deviceId, stripSessionTextFromDeviceRecord(payload, {
              preserveSessionTitles: acceptsSessionTitles(serverTitlesEnabled, store.syncTitlePolicies[record.deviceId], payload.sessionTitleSyncGeneration)
            })) : undefined;
        const response = { ok: true, deviceId: record.deviceId, ...(upload ? { upload } : {}) };
        return sendJson(res, 200, wantsMinimalResponse(req) ? response : { ...response, stats: getStats() });
      } catch (error) {
        if (error.status) return sendJson(res, error.status, { error: error.code });
        if (error.message === 'deviceId_required') return sendJson(res, 400, { error: 'deviceId_required' });
        if (error.code === 'payload_too_large') {
          res.shouldKeepAlive = false;
          return sendJson(res, 413, { error: 'payload_too_large', message: error.message }, { connection: 'close' });
        }
        return sendJson(res, 400, { error: 'bad_request', message: error.message });
      }
    }

    // Shared, and deliberately behind the same secret gate as every other data
    // route: this is the one place the user records money.
    if (req.method === 'GET' && url.pathname === '/api/subscriptions') {
      return sendJson(res, 200, { ok: true, ...getSubscriptions() });
    }

    if (req.method === 'PUT' && url.pathname === '/api/subscriptions') {
      try {
        const payload = await readJsonBody(req);
        const stored = setSubscriptions(payload?.subscriptions, payload?.baseUpdatedAt);
        return sendJson(res, 200, { ok: true, ...stored });
      } catch (error) {
        if (error.code === 'stale_write') {
          return sendJson(res, 409, { error: 'stale_write', ...error.current });
        }
        if (error.code === 'bad_subscriptions') {
          return sendJson(res, 400, { error: 'bad_request', message: error.message });
        }
        if (error.code === 'payload_too_large') {
          res.shouldKeepAlive = false;
          return sendJson(res, 413, { error: 'payload_too_large', message: error.message }, { connection: 'close' });
        }
        return sendJson(res, 400, { error: 'bad_request', message: error.message });
      }
    }

    if (req.method === 'DELETE' && url.pathname.startsWith('/api/devices/')) {
      const deviceId = decodeURIComponent(url.pathname.slice('/api/devices/'.length));
      deleteDevice(deviceId);
      return sendJson(res, 200, { ok: true, deviceId });
    }

    if (await openclawSurface.handleRequest(req, res, url)) {
      return;
    }

    return sendJson(res, 404, { error: 'not_found' });
  }

  const server = http.createServer((req, res) => {
    res.once('finish', () => {
      // A request can become idle after close() has already swept idle sockets.
      if (stopping) server.closeIdleConnections();
    });
    handleRequest(req, res).catch((error) => {
      (logger.error || console.error)(error);
      sendJson(res, 500, { error: 'internal_error', message: error.message });
    });
  });

  function start() {
    if (stopPromise) return Promise.reject(new Error('Hub is stopping'));
    stopping = false;
    return new Promise((resolve, reject) => {
      const onError = (err) => { server.off('listening', onListening); reject(err); };
      const onListening = () => {
        server.off('error', onError);
        if (persistPending) queuePersist();
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, bindHost);
    });
  }

  function stop() {
    if (stopPromise) return stopPromise;
    stopping = true;
    unsubscribeIntegrationStats();
    conversationRelay.stop();
    approvalAlertStore.stop();
    reportManager.stop();
    const operation = new Promise((resolve, reject) => {
      clearTimeout(persistTimer);
      persistTimer = null;
      if (broadcastTimer) clearTimeout(broadcastTimer);
      broadcastTimer = null;
      for (const client of sseClients) {
        client.cleanup();
        try { client.res.end(); } catch (_) {}
      }
      // Save acknowledged uploads even if another request never finishes.
      // A transient failure still gets a second attempt after draining.
      try { if (persistPending) persist(); } catch (error) {
        (logger.error || console.error)('Hub failed to save before draining requests:', error);
      }
      const deadline = setTimeout(() => server.closeAllConnections(), SHUTDOWN_DRAIN_TIMEOUT_MS);
      deadline.unref();
      server.close((error) => {
        clearTimeout(deadline);
        try {
          // Include uploads whose bodies completed while connections drained.
          if (persistPending) persist();
          if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') throw error;
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    }).finally(() => integrationManager.stop().catch(() => {}));
    stopPromise = operation.finally(() => { stopPromise = null; });
    return stopPromise;
  }

  return {
    start, stop, server, getStats, getHistory, getDevices, ingest, deleteDevice, onStats, bindHost,
    getSubscriptions, setSubscriptions, getSyncContent, getSyncSettings, setSyncSettings, setSyncTitlePolicy,
    setSessionConversationsEnabled: (enabled) => conversationRelay.setEnabled(enabled),
    setApprovalAlertsEnabled: (enabled) => approvalAlertStore.setEnabled(enabled),
    setAntigravityManagerSnapshot: (payload) => antigravityManagerStore.putSnapshot(payload),
    getAntigravityManagerSnapshot: () => antigravityManagerStore.getSnapshots(),
    getReportConfig: () => reportManager.getConfig(),
    setReportConfig: (patch) => reportManager.setConfig(patch),
    listReports: (options) => reportManager.listReports(options),
    getReport: (granularity, periodKey, options) => reportManager.getReport(granularity, periodKey, options),
    generateReport: (options) => reportManager.generateReport(options),
    getIntegrationsStatus: () => integrationManager.getStatus(),
    getIntegrationSecrets: () => integrationManager.getSecrets(),
    updateIntegrationsConfig: (patch) => integrationManager.updateConfig(patch),
    setIntegrationSecrets: (secrets) => integrationManager.setSecrets(secrets),
    analyzeReportWithAi: (options) => integrationManager.analyzeReport(options),
    pushReportToOpenClaw: (options) => integrationManager.pushToOpenClaw(options),
    pushQueryToOpenClaw: (options) => integrationManager.pushQueryToOpenClaw(options),
    sendOpenClawTestPush: (options) => integrationManager.sendTestNotification(options),
    getOpenClawPushHistory: () => integrationManager.getPushHistory(),
    dispatchOpenClawEvent: (options) => integrationManager.dispatchEvent(options),
    onApprovalAlertCreated: (alert) => integrationManager.onApprovalAlertCreated(alert),
    onStatsSnapshot: (stats) => integrationManager.onStatsSnapshot(stats),
    buildWeChatBrief: (options) => integrationManager.buildWeChatBrief(options),
    getOpenClawEnv: () => integrationManager.getOpenClawEnv(),
    startOpenClawWeixinQr: () => integrationManager.startOpenClawWeixinQr(),
    pollOpenClawWeixinQrStatus: (sessionId) => integrationManager.pollOpenClawWeixinQrStatus(sessionId),
    submitOpenClawWeixinVerifyCode: (sessionId, verifyCode) => integrationManager.submitOpenClawWeixinVerifyCode(sessionId, verifyCode),
    cancelOpenClawWeixinQr: (sessionId) => integrationManager.cancelOpenClawWeixinQr(sessionId),
    provisionOpenClaw: (options) => integrationManager.provisionOpenClaw(options),
    queryService: openclawSurface.queryService
  };
}

if (require.main === module) {
  loadDotEnv();
  const args = parseArgs(process.argv.slice(2));
  if (args.persistIntervalMs === true || (typeof args.persistIntervalMs === 'string' && !args.persistIntervalMs.trim())) {
    console.error('Hub failed to start: --persistIntervalMs requires a numeric value');
    process.exit(1);
  }
  const port = Number(args.port || process.env.TOKEN_MONITOR_PORT || 17321);
  const host = String(args.host || process.env.TOKEN_MONITOR_HOST || '0.0.0.0');
  const secret = String(args.secret || process.env.TOKEN_MONITOR_SECRET || '').trim();
  const staleAfterMs = Number(args.staleAfterMs || process.env.TOKEN_MONITOR_STALE_AFTER_MS || DEFAULT_STALE_AFTER_MS);
  const persistIntervalMs = Number(args.persistIntervalMs ?? process.env.TOKEN_MONITOR_PERSIST_INTERVAL_MS ?? 0);
  const dataFile = String(args.dataFile || process.env.TOKEN_MONITOR_DATA_FILE || path.join(projectRoot(), 'data', 'devices.json'));

  const syncSessionTitles = syncSessionTitlesEnabled(args.syncSessionTitles ?? args['sync-session-titles'] ?? process.env.TOKEN_MONITOR_SYNC_SESSION_TITLES);
  const sessionConversations = syncSessionTitlesEnabled(args.sessionConversations ?? args['session-conversations'] ?? process.env.TOKEN_MONITOR_SESSION_CONVERSATIONS);
  const approvalAlerts = syncSessionTitlesEnabled(args.approvalAlerts ?? args['approval-alerts'] ?? process.env.TOKEN_MONITOR_APPROVAL_ALERTS);
  const reportsArg = args.reports ?? process.env.TOKEN_MONITOR_REPORTS;
  const reportsDir = String(args.reportsDir ?? args['reports-dir'] ?? process.env.TOKEN_MONITOR_REPORTS_DIR ?? '').trim();
  const hub = createHub({
    port, deployment: 'standalone', host, secret, staleAfterMs, dataFile, syncSessionTitles, sessionConversations, approvalAlerts,
    persistIntervalMs, reportsDir, ...(reportsArg !== undefined ? { reports: reportsArg } : {})
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      hub.stop().catch((error) => {
        console.error(`Hub failed to stop: ${error.message}`);
        process.exitCode = 1;
      });
    });
  }
  hub.start().then(() => {
    console.log(`Token Monitor hub listening on http://${hub.bindHost}:${port}`);
    console.log(`Data file: ${dataFile}`);
    console.log(`Persistence interval: ${persistIntervalMs}ms`);
    if (!secret) {
      console.warn(`Warning: TOKEN_MONITOR_SECRET is not set, so the hub is bound to ${hub.bindHost} (localhost only) to keep account identity off the network. Set a secret to accept connections from other devices.`);
    }
  }).catch((err) => {
    console.error(`Hub failed to start: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { createHub, createOpenClawEndpointSurface, resolveBindHost };
