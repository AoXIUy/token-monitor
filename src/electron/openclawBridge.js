// @ts-check
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const { createIntegrationManager } = require('../hub/integrations');
const { createOpenClawEndpointSurface } = require('../hub/server');
const { createSessionCompletionTracker } = require('../shared/sessionCompletion');
const {
  extractLimitsSummary,
  formatOpenClawApprovalAlertMessage,
  formatOpenClawQuotaAlertMessage,
  formatOpenClawServiceIncidentMessage,
  formatOpenClawSessionCompletedMessage,
  invokeThirdPartyAiAnalysis,
  looksSensitiveDisplayText,
  mergeOpenClawIntegrationConfig,
  normalizeAiIntegrationConfig,
  normalizeOpenClawIntegrationConfig,
  safeAccountDisplayLabel
} = require('../shared/aiReportAnalyzer');
const { readRegularFileNoFollow, writePrivateJsonAtomic } = require('../shared/credentialStore');
const { accountSelectionKey } = require('../shared/limits/accountScope');
const { LIMIT_PROVIDER_LABELS } = require('../shared/limits/providers');
const { limitWindowLabel } = require('../shared/limits/windowLabels');
const { sanitizeLimitsHistoryPayload } = require('../shared/mcpReportProtocol');
const tokenRateApi = require('./renderer/tokenRatePresentation');
const defaultQuotaEvaluator = require('../../plugins/quota-alerts/evaluator.cjs');

const DEFAULT_LOCAL_BRIDGE_PORT = 17322;
const DEFAULT_SERVICE_POLL_INTERVAL_MS = 120_000;
const MAX_LOCAL_APPROVAL_ALERTS = 50;
const MAX_QUOTA_OBSERVATIONS = 2048;

/** @type {Record<string, number>} */
const SERVICE_SEVERITY = Object.freeze({
  operational: 0,
  degraded: 1,
  minor: 1,
  maintenance: 1,
  partial_outage: 2,
  major: 2,
  major_outage: 3,
  critical: 3,
  outage: 3
});

/**
 * @param {unknown} error
 * @returns {string}
 */
function errMessage(error) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return String(error ?? '');
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function errCodeOrMessage(error) {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && error.code) {
    return error.code;
  }
  return errMessage(error);
}

/**
 * @param {any} value
 * @returns {boolean}
 */
function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/**
 * @param {any} value
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 * @returns {number}
 */
function clampInt(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.round(num)));
}

/**
 * @param {string} providerId
 * @returns {string}
 */
function resolveProviderLabel(providerId) {
  const id = String(providerId || '').trim();
  if (!id) return '';
  if (LIMIT_PROVIDER_LABELS instanceof Map) {
    return LIMIT_PROVIDER_LABELS.get(id) || id;
  }
  if (LIMIT_PROVIDER_LABELS && typeof LIMIT_PROVIDER_LABELS === 'object' && Object.hasOwn(LIMIT_PROVIDER_LABELS, id)) {
    return String(LIMIT_PROVIDER_LABELS[id] || id);
  }
  return id;
}

/**
 * @param {string} value
 * @returns {string}
 */
function maskToken(value) {
  const clean = typeof value === 'string' ? value.trim() : '';
  if (!clean) return '';
  if (clean.length <= 4) return '••••';
  return `••••${clean.slice(-4)}`;
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function timingSafeEqualText(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const hashA = crypto.createHash('sha256').update(a, 'utf8').digest();
  const hashB = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

/**
 * @param {http.IncomingMessage} req
 * @returns {string}
 */
function readBearerTokenFromRequest(req) {
  const auth = typeof req.headers?.authorization === 'string' ? req.headers.authorization.trim() : '';
  if (auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  const hubHeader = typeof req.headers?.['x-hub-secret'] === 'string' ? req.headers['x-hub-secret'].trim() : '';
  return hubHeader;
}

/**
 * @param {http.ServerResponse} res
 * @param {number} statusCode
 * @param {any} payload
 */
function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body)
  });
  res.end(body);
}

/**
 * @param {string} value
 * @returns {string}
 */
function stripEmailFromIdentifier(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return '';
  if (text.includes('@')) {
    const [local, domain] = text.split('@');
    const prefix = local ? `${local.slice(0, 2)}***` : '***';
    return domain ? `${prefix}@${domain}` : prefix;
  }
  return text;
}

/**
 * @param {any} value
 * @returns {string}
 */
function sanitizeQuotaDisplayField(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || looksSensitiveDisplayText(text)) return '';
  return text;
}

/**
 * @param {any} stats
 * @param {Record<string, { labels?: Record<string, string> }> | null} [limitAccountPresentation]
 * @returns {any[]}
 */
function extractQuotaRowsFromStats(stats, limitAccountPresentation = null) {
  const providers = Array.isArray(stats?.limits?.providers) ? stats.limits.providers : [];
  /** @type {any[]} */
  const rows = [];
  for (const p of providers) {
    if (!isPlainObject(p)) continue;
    const accountId = typeof p.accountKey === 'string' && p.accountKey.trim()
      ? p.accountKey.trim()
      : (typeof p.accountId === 'string' ? p.accountId.trim() : '');
    const provider = typeof p.provider === 'string' ? p.provider.trim() : '';
    const rawWindows = Array.isArray(p.windows) ? p.windows : [];
    const selectionKey = accountSelectionKey(provider, accountId, p.region);
    const presentationLabels = isPlainObject(limitAccountPresentation?.[provider]?.labels)
      ? limitAccountPresentation?.[provider]?.labels
      : null;
    const customLabel = presentationLabels && selectionKey && Object.hasOwn(presentationLabels, selectionKey)
      ? presentationLabels[selectionKey]
      : undefined;
    const accountDisplayName = sanitizeQuotaDisplayField(
      typeof customLabel === 'string' ? customLabel : p.accountDisplayName
    );
    const accountLabel = sanitizeQuotaDisplayField(p.accountLabel);
    const profileName = sanitizeQuotaDisplayField(p.profileName);
    const accountName = sanitizeQuotaDisplayField(p.accountName);
    const planLabel = sanitizeQuotaDisplayField(p.planLabel);
    const label = sanitizeQuotaDisplayField(p.label);
    rows.push({
      identityAvailable: Boolean(accountId),
      accountId,
      ...(accountDisplayName ? { accountDisplayName } : {}),
      ...(accountLabel ? { accountLabel } : {}),
      ...(profileName ? { profileName } : {}),
      ...(accountName ? { accountName } : {}),
      ...(planLabel ? { planLabel } : {}),
      ...(label ? { label } : {}),
      provider,
      providerLabel: resolveProviderLabel(provider),
      status: p.status || 'unknown',
      updatedAt: p.updatedAt || null,
      windows: rawWindows.map((/** @type {any} */ w) => ({
        kind: w?.kind,
        metric: w?.metric ?? null,
        displayLabel: limitWindowLabel(provider, w, w?.label || 'Quota') || String(w?.kind || 'Quota'),
        windowMinutes: w?.windowMinutes ?? null,
        remainingPercent: w?.remainingPercent,
        resetsAt: w?.resetsAt ?? null
      }))
    });
  }
  return rows;
}

/**
 * @param {any} detail
 * @param {{ sessionTitlesEnabled?: boolean, allowConversationText?: boolean }} [options]
 * @returns {any | null}
 */
function summarizeDetailForCompletion(detail, options = {}) {
  if (!isPlainObject(detail) || detail.found === false) return null;
  const allowTitles = options.sessionTitlesEnabled !== false;
  const allowConversationText = options.allowConversationText === true;
  const exchanges = Array.isArray(detail.exchanges) ? detail.exchanges : [];
  const lastExchange = exchanges.length > 0 ? exchanges[exchanges.length - 1] : null;
  const toolSet = new Set();
  if (Array.isArray(lastExchange?.tools)) {
    for (const tool of lastExchange.tools) {
      const name = typeof tool === 'string' ? tool.trim() : String(tool?.name || '').trim();
      if (name) toolSet.add(name);
    }
  }
  if (Array.isArray(lastExchange?.toolCalls)) {
    for (const tc of lastExchange.toolCalls) {
      const name = typeof tc === 'string' ? tc.trim() : String(tc?.name || tc?.toolName || '').trim();
      if (name) toolSet.add(name);
    }
  }
  const rawPreview = allowConversationText
    ? (lastExchange?.prompt || lastExchange?.userPrompt || detail.summary || '')
    : (allowTitles ? (detail.title || '') : '');
  const promptPreview = typeof rawPreview === 'string' ? rawPreview.replace(/\s+/g, ' ').trim().slice(0, 140) : '';
  return {
    turnCount: Number.isFinite(Number(detail.totalExchanges)) ? Number(detail.totalExchanges) : exchanges.length,
    toolNames: [...toolSet].slice(0, 8),
    ...(promptPreview ? { promptPreview } : {})
  };
}

/**
 * Create Desktop Main Process OpenClaw integration bridge managing local/host/client
 * event detection, push routing, persistent state, and loopback local MCP/query serving.
 *
 * @param {{
 *   userDataDir: string,
 *   getSettings: () => any,
 *   getEmbeddedHub?: () => any,
 *   getCredentialStore?: () => any,
 *   fetchImpl?: typeof fetch,
 *   clipboardWriteText?: (text: string) => void,
 *   getStats?: () => any,
 *   getHistory?: () => any,
 *   getSubscriptions?: () => any,
 *   getEnhancedQueryContext?: (() => Promise<any> | any) | null,
 *   serviceStatusClient?: { getServiceStatus: (opts?: any) => Promise<any> } | null,
 *   codexResetForecastClient?: { getForecast: (opts?: any) => Promise<any> } | null,
 *   readSessionDetail?: ((args: any) => Promise<any> | any) | null,
 *   invokeThirdPartyAi?: typeof invokeThirdPartyAiAnalysis,
 *   quotaEvaluator?: { evaluate: typeof defaultQuotaEvaluator.evaluate },
 *   createSurface?: typeof createOpenClawEndpointSurface,
 *   createManager?: typeof createIntegrationManager,
 *   createTracker?: typeof createSessionCompletionTracker,
 *   servicePollIntervalMs?: number,
 *   now?: () => number,
 *   logger?: { log?: (...args: any[]) => void, warn?: (...args: any[]) => void, error?: (...args: any[]) => void }
 * }} options
 */
function createOpenClawBridge({
  userDataDir,
  getSettings,
  getEmbeddedHub = () => null,
  getCredentialStore = () => null,
  fetchImpl,
  clipboardWriteText = () => {},
  getStats = () => ({}),
  getHistory = () => null,
  getSubscriptions = () => null,
  getEnhancedQueryContext = null,
  serviceStatusClient = null,
  codexResetForecastClient = null,
  readSessionDetail = null,
  invokeThirdPartyAi = invokeThirdPartyAiAnalysis,
  quotaEvaluator = defaultQuotaEvaluator,
  createSurface = createOpenClawEndpointSurface,
  createManager = createIntegrationManager,
  createTracker = createSessionCompletionTracker,
  servicePollIntervalMs = DEFAULT_SERVICE_POLL_INTERVAL_MS,
  now = () => Date.now(),
  logger = console
}) {
  const cleanUserDataDir = String(userDataDir || '').trim();
  const quotaStatePath = path.join(cleanUserDataDir, 'openclaw-quota-state.json');
  const logWarn = typeof logger?.warn === 'function' ? logger.warn.bind(logger) : console.warn;

  let stopped = false;
  /** @type {ReturnType<typeof createIntegrationManager> | null} */
  let localManager = null;
  let localManagerReportsDir = '';
  /** @type {ReturnType<typeof createOpenClawEndpointSurface> | null} */
  let localSurface = null;

  /** @type {Set<Promise<any>>} */
  const pendingAsyncTasks = new Set();
  /** @type {Map<string, Promise<any>>} */
  const localInFlightDedup = new Map();
  /** @type {any[]} */
  const localApprovalAlerts = [];

  // Fallback live-rate tracker so /api/query/live-rate returns live tok/s & TPM
  // even when Edge Dock live-rate widgets are hidden.
  const bridgeLiveRateTracker = tokenRateApi.createLiveTokenRateGroupTracker({
    now: () => now(),
    activeMs: 15_000,
    clearMs: 30_000
  });
  let bridgeLiveRateContextKey = '';

  // Quota alerts persistent evaluation ledger (0o600 in userDataDir)
  let quotaStateLoaded = false;
  let quotaPolicy = '';
  /** @type {Set<string>} */
  let quotaAlerted = new Set();
  /** @type {Map<string, any>} */
  let quotaObservations = new Map();

  // Service status transition state (quiet initial baseline)
  let serviceBaselineInitialized = false;
  /** @type {Map<string, { status: string, level: number, name: string }>} */
  const serviceProviderStates = new Map();
  /** @type {ReturnType<typeof setInterval> | null} */
  let servicePollTimer = null;
  let servicePollInFlight = false;

  // Local Loopback HTTP/MCP Server state
  let fallbackBridgeToken = '';
  /** @type {http.Server | null} */
  let bridgeServer = null;
  let bridgeListening = false;
  let bridgeListeningPort = DEFAULT_LOCAL_BRIDGE_PORT;
  /** @type {string | null} */
  let bridgeError = null;
  /** @type {Promise<any>} */
  let bridgeChain = Promise.resolve();

  /**
   * @template T
   * @param {Promise<T> | T} promise
   * @returns {Promise<T>}
   */
  function trackTask(promise) {
    const p = Promise.resolve(promise).finally(() => pendingAsyncTasks.delete(p));
    pendingAsyncTasks.add(p);
    return p;
  }

  function currentMode() {
    return String(getSettings()?.hubMode || 'local').trim() || 'local';
  }

  function isActiveMonitorMode() {
    const mode = currentMode();
    return mode === 'local' || mode === 'host';
  }

  function resolveSessionTitlesAllowed() {
    const s = getSettings() || {};
    if (s.hubMode === 'host') {
      return Boolean(s.sessionTitlesEnabled !== false && s.hubSyncSessionTitles === true);
    }
    return Boolean(s.sessionTitlesEnabled !== false);
  }

  function readStoredSecrets() {
    const store = getCredentialStore?.();
    if (!store || typeof store.readIntegrationSecrets !== 'function') {
      return { aiApiKey: '', openclawHookToken: '', weixinBotToken: '' };
    }
    try {
      return store.readIntegrationSecrets();
    } catch (_) {
      return { aiApiKey: '', openclawHookToken: '', weixinBotToken: '' };
    }
  }

  function readLocalBridgeToken() {
    const store = getCredentialStore?.();
    if (store && typeof store.readOpenClawLocalBridgeToken === 'function') {
      try {
        const stored = store.readOpenClawLocalBridgeToken();
        if (stored) return stored;
      } catch (_) {}
    }
    return fallbackBridgeToken;
  }

  /**
   * @param {any} token
   * @returns {string}
   */
  function writeLocalBridgeToken(token) {
    const cleaned = String(token || '').trim();
    fallbackBridgeToken = cleaned;
    const store = getCredentialStore?.();
    if (store && typeof store.writeOpenClawLocalBridgeToken === 'function') {
      try {
        store.writeOpenClawLocalBridgeToken(cleaned);
      } catch (error) {
        logWarn(`[openclaw] failed to persist local bridge token: ${errMessage(error)}`);
      }
    }
    return cleaned;
  }

  function ensureLocalBridgeToken() {
    const existing = readLocalBridgeToken();
    if (existing) return existing;
    const generated = crypto.randomBytes(32).toString('hex');
    return writeLocalBridgeToken(generated);
  }

  function resolveReportsDir() {
    const custom = String(getSettings()?.reportsDir || '').trim();
    return custom || path.join(cleanUserDataDir, 'reports');
  }

  function getActiveHubManager() {
    if (currentMode() !== 'host') return null;
    const hub = getEmbeddedHub()?.hub;
    if (!hub) return null;
    if (hub.integrationManager) return hub.integrationManager;
    if (typeof hub.dispatchOpenClawEvent === 'function') {
      return {
        getStatus: () => hub.getIntegrationsStatus(),
        updateConfig: (/** @type {any} */ patch) => hub.updateIntegrationsConfig(patch),
        dispatchEvent: (/** @type {any} */ opts) => hub.dispatchOpenClawEvent(opts),
        getPushHistory: () => hub.getOpenClawPushHistory(),
        sendTestNotification: (/** @type {any} */ opts) => hub.sendOpenClawTestPush(opts),
        pushQueryToOpenClaw: (/** @type {any} */ opts) => hub.pushQueryToOpenClaw(opts),
        analyzeReport: (/** @type {any} */ opts) => hub.analyzeReportWithAi(opts),
        pushToOpenClaw: (/** @type {any} */ opts) => hub.pushReportToOpenClaw(opts)
      };
    }
    return null;
  }

  function resolveEffectiveConfigs() {
    const hubMgr = getActiveHubManager();
    if (hubMgr && typeof hubMgr.getStatus === 'function') {
      const status = hubMgr.getStatus();
      return {
        ai: normalizeAiIntegrationConfig(status?.ai),
        openclaw: normalizeOpenClawIntegrationConfig(status?.openclaw)
      };
    }
    if (localManager && typeof localManager.getStatus === 'function') {
      const status = localManager.getStatus();
      return {
        ai: normalizeAiIntegrationConfig(status?.ai),
        openclaw: normalizeOpenClawIntegrationConfig(status?.openclaw)
      };
    }
    const s = getSettings() || {};
    return {
      ai: normalizeAiIntegrationConfig(s.reportIntegrations?.ai),
      openclaw: normalizeOpenClawIntegrationConfig(s.reportIntegrations?.openclaw)
    };
  }

  async function buildEnhancedQueryContext() {
    const raw = typeof getEnhancedQueryContext === 'function'
      ? await getEnhancedQueryContext()
      : {};
    const ctx = isPlainObject(raw) ? { ...raw } : {};
    if (ctx.stats === undefined) ctx.stats = getStats();
    if (typeof ctx.sessionTitlesEnabled !== 'boolean') {
      ctx.sessionTitlesEnabled = resolveSessionTitlesAllowed();
    }
    if (!ctx.liveRateSnapshot) {
      ctx.liveRateSnapshot = bridgeLiveRateTracker.getSample();
    }
    if (typeof ctx.listApprovalAlerts !== 'function') {
      ctx.listApprovalAlerts = listApprovalAlerts;
    }
    if (typeof ctx.getServiceStatus !== 'function' && serviceStatusClient && typeof serviceStatusClient.getServiceStatus === 'function') {
      ctx.getServiceStatus = (/** @type {any} */ opts) => serviceStatusClient.getServiceStatus(opts);
    }
    if (typeof ctx.getCodexResetForecast !== 'function' && codexResetForecastClient && typeof codexResetForecastClient.getForecast === 'function') {
      ctx.getCodexResetForecast = (/** @type {any} */ opts) => codexResetForecastClient.getForecast(opts);
    }
    return ctx;
  }

  function ensureLocalSurface() {
    if (!localSurface) {
      localSurface = createSurface({
        getStats,
        getHistory,
        getSubscriptions,
        getEnhancedQueryContext: buildEnhancedQueryContext,
        serverTitlesEnabled: resolveSessionTitlesAllowed(),
        listApprovalAlerts,
        getOpenClawConfig: () => resolveEffectiveConfigs().openclaw,
        getIntegrationsStatus: () => getLocalManager().getStatus(),
        updateIntegrationsConfig: (/** @type {any} */ patch) => saveLocalIntegrations(patch),
        analyzeReportWithAi: (/** @type {any} */ opts) => getLocalManager().analyzeReport(opts),
        pushReportToOpenClaw: (/** @type {any} */ opts) => getLocalManager().pushToOpenClaw(opts),
        pushQueryToOpenClaw: (/** @type {any} */ opts) => getLocalManager().pushQueryToOpenClaw(opts),
        sendTestNotification: (/** @type {any} */ opts) => getLocalManager().sendTestNotification(opts),
        getPushHistory: () => getLocalManager().getPushHistory(),
        buildWeChatBrief: (/** @type {any} */ opts) => getLocalManager().buildWeChatBrief(opts),
        getOpenClawEnv: () => getLocalManager().getOpenClawEnv(),
        mcpServerInfo: { name: 'token-monitor-desktop', version: '1.0.0' }
      });
    }
    return localSurface;
  }

  function getLocalManager() {
    const reportsDir = resolveReportsDir();
    if (localManager && localManagerReportsDir === reportsDir) {
      return localManager;
    }
    if (localManager) {
      try {
        localManager.stop?.();
      } catch (_) {}
      localManager = null;
    }
    const settingsIntegrations = getSettings()?.reportIntegrations;
    const manager = createManager({
      dataFile: path.join(cleanUserDataDir, 'openclaw-bridge-data.json'),
      reportsDir,
      reportManager: null,
      getStats,
      getHistory,
      getSubscriptions,
      getQueryContext: buildEnhancedQueryContext,
      executeQuery: (queryType, params, openclawCfg) => ensureLocalSurface().queryService.execute(queryType, params, openclawCfg),
      sessionTitlesEnabled: resolveSessionTitlesAllowed(),
      initialConfig: settingsIntegrations || null,
      initialSecrets: readStoredSecrets(),
      ...(typeof fetchImpl === 'function' ? { fetchImpl } : {}),
      now: () => new Date(now()),
      logger
    });
    localManager = manager;
    localManagerReportsDir = reportsDir;
    return manager;
  }

  function resolveDispatchManager() {
    return getActiveHubManager() || getLocalManager();
  }

  function listApprovalAlerts() {
    const hubHub = getEmbeddedHub()?.hub;
    if (currentMode() === 'host' && typeof hubHub?.listApprovalAlerts === 'function') {
      return hubHub.listApprovalAlerts();
    }
    if (typeof getSettings === 'function' && getSettings()?.approvalAlertsEnabled !== true) {
      return { ok: false, error: 'disabled', alerts: [] };
    }
    return {
      ok: true,
      alerts: localApprovalAlerts.map((item) => ({ ...item }))
    };
  }

  function loadQuotaStateIfNeeded() {
    if (quotaStateLoaded) return;
    quotaStateLoaded = true;
    try {
      if (!fs.existsSync(quotaStatePath)) return;
      const raw = readRegularFileNoFollow(quotaStatePath);
      const parsed = JSON.parse(raw);
      if (!isPlainObject(parsed)) return;
      quotaPolicy = typeof parsed.policy === 'string' ? parsed.policy : '';
      quotaAlerted = new Set(Array.isArray(parsed.keys) ? parsed.keys.filter((/** @type {any} */ k) => typeof k === 'string') : []);
      quotaObservations = new Map();
      if (isPlainObject(parsed.observations)) {
        for (const [key, val] of Object.entries(parsed.observations)) {
          if (isPlainObject(val)) quotaObservations.set(key, val);
        }
      }
    } catch (_) {
      quotaPolicy = '';
      quotaAlerted = new Set();
      quotaObservations = new Map();
    }
  }

  /**
   * @param {string} policy
   */
  function saveQuotaState(policy) {
    if (quotaObservations.size > MAX_QUOTA_OBSERVATIONS) {
      const overflow = quotaObservations.size - MAX_QUOTA_OBSERVATIONS;
      let removed = 0;
      for (const k of quotaObservations.keys()) {
        quotaObservations.delete(k);
        removed += 1;
        if (removed >= overflow) break;
      }
    }
    quotaPolicy = policy;
    try {
      writePrivateJsonAtomic(quotaStatePath, {
        version: 1,
        policy,
        keys: [...quotaAlerted],
        observations: Object.fromEntries(quotaObservations.entries())
      });
    } catch (error) {
      logWarn(`[openclaw] failed to persist quota alert state: ${errMessage(error)}`);
    }
  }

  /**
   * @param {any} spec
   */
  async function dispatchBridgeEvent(spec) {
    if (stopped) return { ok: false, error: 'bridge_stopped' };
    const cleanKey = typeof spec?.idempotencyKey === 'string' ? spec.idempotencyKey.trim() : '';
    if (cleanKey && localInFlightDedup.has(cleanKey)) {
      return localInFlightDedup.get(cleanKey);
    }
    const mgr = resolveDispatchManager();
    const run = Promise.resolve(mgr.dispatchEvent(spec));
    if (cleanKey) {
      localInFlightDedup.set(cleanKey, run);
      run.finally(() => {
        if (localInFlightDedup.get(cleanKey) === run) {
          localInFlightDedup.delete(cleanKey);
        }
      }).catch(() => {});
    }
    return run;
  }

  /**
   * @param {any} completion
   */
  async function handleCompletionEvent(completion) {
    if (stopped || !isActiveMonitorMode()) return;
    const { ai, openclaw } = resolveEffectiveConfigs();
    if (openclaw.enabled !== true || openclaw.events?.sessionCompleted !== true) return;

    const titlesAllowed = resolveSessionTitlesAllowed();
    const safeCompletion = {
      ...completion,
      ...(titlesAllowed ? {} : { title: null })
    };

    let detailSummary = null;
    if (
      openclaw.sessionCompletion?.includeDetailSummary === true
      && openclaw.queryPermissions?.allowSessionDetail === true
      && typeof readSessionDetail === 'function'
    ) {
      try {
        const detail = await readSessionDetail({
          client: safeCompletion.client,
          sessionId: safeCompletion.sessionId,
          period: 'today',
          sessionCost: safeCompletion.costUsd
        });
        detailSummary = summarizeDetailForCompletion(detail, {
          sessionTitlesEnabled: titlesAllowed,
          allowConversationText: openclaw.queryPermissions?.allowConversationText === true
        });
      } catch (error) {
        logWarn(`[openclaw] detail summary lookup failed: ${errMessage(error)}`);
      }
    }

    let aiSummary = '';
    if (openclaw.sessionCompletion?.includeAiSummary === true && ai.enabled === true) {
      const secrets = readStoredSecrets();
      if (secrets.aiApiKey) {
        try {
          const aiConfigForCompletion = {
            ...ai,
            customPrompt: '请仅用一句话总结本次会话消耗特点或是否需要注意上下文/成本控制，不要使用表格，控制在80字以内。'
          };
          const syntheticReport = {
            reportId: `session:${safeCompletion.client}:${safeCompletion.sessionId}`,
            granularity: 'daily',
            period: { key: new Date(now()).toISOString().slice(0, 10), label: 'Session' },
            totals: {
              tokens: safeCompletion.turnDelta?.totalTokens ?? safeCompletion.totalTokens ?? 0,
              costUsd: safeCompletion.turnDelta?.costUsd ?? safeCompletion.costUsd ?? 0,
              sessions: 1
            },
            byClient: [{
              client: safeCompletion.client,
              tokens: safeCompletion.turnDelta?.totalTokens ?? safeCompletion.totalTokens ?? 0,
              costUsd: safeCompletion.turnDelta?.costUsd ?? safeCompletion.costUsd ?? 0,
              sessions: 1
            }],
            byModel: safeCompletion.model ? [{
              model: safeCompletion.model,
              tokens: safeCompletion.turnDelta?.totalTokens ?? safeCompletion.totalTokens ?? 0,
              costUsd: safeCompletion.turnDelta?.costUsd ?? safeCompletion.costUsd ?? 0
            }] : [],
            projects: safeCompletion.projectLabel ? [{
              project: safeCompletion.projectLabel,
              tokens: safeCompletion.turnDelta?.totalTokens ?? safeCompletion.totalTokens ?? 0,
              costUsd: safeCompletion.turnDelta?.costUsd ?? safeCompletion.costUsd ?? 0
            }] : []
          };
          const aiRes = await invokeThirdPartyAi({
            config: aiConfigForCompletion,
            apiKey: secrets.aiApiKey,
            report: syntheticReport,
            stats: getStats(),
            ...(typeof fetchImpl === 'function' ? { fetchImpl } : {}),
            timeoutMs: 8000,
            now: () => new Date(now())
          });
          if (aiRes?.ok && aiRes.analysis) {
            const candidate = aiRes.analysis.summary || aiRes.analysis.headline || aiRes.analysis.bullets?.[0] || '';
            if (typeof candidate === 'string' && candidate.trim()) {
              aiSummary = candidate.trim().slice(0, 240);
            }
          }
        } catch (error) {
          logWarn(`[openclaw] AI completion summary failed: ${errMessage(error)}`);
        }
      }
    }

    const limitsSummary = openclaw.includeLimits !== false ? extractLimitsSummary(getStats()) : null;
    const text = formatOpenClawSessionCompletedMessage({
      completion: safeCompletion,
      detailSummary,
      aiSummary: aiSummary || null,
      limitsSummary
    });

    await dispatchBridgeEvent({
      eventType: 'session_completed',
      text,
      payload: {
        completion: safeCompletion,
        ...(detailSummary ? { detailSummary } : {}),
        ...(aiSummary ? { aiSummary } : {})
      },
      idempotencyKey: `completion:${safeCompletion.eventId}`,
      source: 'desktop-completion',
      summary: [safeCompletion.client, safeCompletion.model, safeCompletion.projectLabel].filter(Boolean).join(' · ')
    });
  }

  function buildTrackerOptions() {
    const { openclaw } = resolveEffectiveConfigs();
    const sc = openclaw.sessionCompletion || {};
    return {
      clients: Array.isArray(sc.clients) ? sc.clients : [],
      excludeSubagents: sc.excludeSubagents !== false,
      excludeBackgroundReview: sc.excludeBackgroundReview !== false,
      minTurnTokens: clampInt(sc.minTurnTokens, 0, 100_000_000, 0),
      minTotalTokens: clampInt(sc.minTotalTokens, 0, 100_000_000, 0),
      debounceMs: clampInt(sc.debounceMs, 0, 60_000, 2500),
      cooldownMs: clampInt(sc.cooldownMs, 0, 3_600_000, 0),
      sessionTitlesEnabled: resolveSessionTitlesAllowed()
    };
  }

  const completionTracker = createTracker({
    ...buildTrackerOptions(),
    now: () => now(),
    onComplete: (event) => trackTask(handleCompletionEvent(event))
  });

  function syncTrackerConfig() {
    const { openclaw } = resolveEffectiveConfigs();
    completionTracker.updateOptions(buildTrackerOptions());
    if (!isActiveMonitorMode() || openclaw.enabled !== true || openclaw.events?.sessionCompleted !== true) {
      completionTracker.reset();
    }
  }

  /**
   * @param {any} stats
   */
  function updateLiveRateTracker(stats) {
    if (!isPlainObject(stats)) return;
    const s = getSettings() || {};
    const hubMode = s.hubMode || 'local';
    const syncMode = tokenRateApi.isSharedSyncMode(hubMode);
    const scope = syncMode && s.liveTokenRateScope !== 'device' ? 'all' : 'device';
    const selection = tokenRateApi.selectLiveTokenRatePeriods(stats, s.deviceId, hubMode, scope);
    const ctxKey = [hubMode, s.hubUrl || '', s.deviceId || '', s.clients || '', scope, selection.source].join('|');
    if (ctxKey !== bridgeLiveRateContextKey) {
      bridgeLiveRateContextKey = ctxKey;
      bridgeLiveRateTracker.reset(selection.entries);
    } else {
      bridgeLiveRateTracker.observe(selection.entries);
    }
  }

  /**
   * @param {any} stats
   */
  async function evaluateQuotaAlerts(stats) {
    if (stopped || !isActiveMonitorMode()) return;
    const { openclaw } = resolveEffectiveConfigs();
    if (openclaw.enabled !== true || openclaw.events?.quotaAlerts !== true) return;
    const rows = extractQuotaRowsFromStats(stats, getSettings()?.limitAccountPresentation);
    if (rows.length === 0) return;

    loadQuotaStateIfNeeded();
    const threshold = clampInt(openclaw.quotaAlerts?.thresholdPercent, 1, 99, 20);
    const notifyRecovery = openclaw.quotaAlerts?.notifyRecovery !== false;
    const nextPolicy = JSON.stringify({ threshold });
    const nextObservations = quotaPolicy === nextPolicy ? new Map(quotaObservations) : new Map();

    let evalResult;
    try {
      evalResult = quotaEvaluator.evaluate(rows, threshold, quotaAlerted, now(), nextObservations);
    } catch (error) {
      logWarn(`[openclaw] quota alert evaluation failed: ${errMessage(error)}`);
      return;
    }

    quotaObservations = nextObservations;
    saveQuotaState(nextPolicy);

    const rowMetadataByKey = new Map();
    for (const row of rows) {
      if (!row.provider || !row.accountId) continue;
      const metaKey = `${row.provider}\0${row.accountId}`;
      const existing = rowMetadataByKey.get(metaKey) || {};
      rowMetadataByKey.set(metaKey, {
        accountDisplayName: existing.accountDisplayName || row.accountDisplayName || '',
        accountLabel: existing.accountLabel || row.accountLabel || '',
        profileName: existing.profileName || row.profileName || '',
        accountName: existing.accountName || row.accountName || '',
        planLabel: existing.planLabel || row.planLabel || '',
        label: existing.label || row.label || ''
      });
    }

    const triggered = Array.isArray(evalResult?.triggered) ? evalResult.triggered : [];
    const notifications = triggered.filter((item) => (item.event === 'low' ? true : notifyRecovery));
    for (const alert of notifications) {
      const sanitizedAccountId = stripEmailFromIdentifier(alert.accountId);
      const rowMeta = rowMetadataByKey.get(`${String(alert.provider || '')}\0${String(alert.accountId || '')}`) || {};
      /** @type {Record<string, any>} */
      const safeAlert = {
        ...(rowMeta.accountDisplayName ? { accountDisplayName: rowMeta.accountDisplayName } : {}),
        ...(rowMeta.accountLabel ? { accountLabel: rowMeta.accountLabel } : {}),
        ...(rowMeta.profileName ? { profileName: rowMeta.profileName } : {}),
        ...(rowMeta.accountName ? { accountName: rowMeta.accountName } : {}),
        ...(rowMeta.planLabel ? { planLabel: rowMeta.planLabel } : {}),
        ...(rowMeta.label ? { label: rowMeta.label } : {}),
        ...alert,
        key: `${String(alert.provider || '')}:${sanitizedAccountId || 'account'}`,
        accountId: sanitizedAccountId,
        thresholdPercent: threshold
      };
      const accountDisplay = safeAccountDisplayLabel(safeAlert);
      if (accountDisplay) {
        safeAlert.accountDisplay = accountDisplay;
      }
      const text = formatOpenClawQuotaAlertMessage(safeAlert);
      const obsTime = quotaObservations.get(alert.key)?.latestAt || now();
      const idempotencyKey = `quota:${crypto
        .createHash('sha256')
        .update(`${alert.key}\n${alert.event}\n${obsTime}`)
        .digest('hex')
        .slice(0, 24)}`;
      await dispatchBridgeEvent({
        eventType: 'quota_alert',
        text,
        payload: { alert: safeAlert },
        idempotencyKey,
        source: 'desktop-quota',
        summary: `${safeAlert.providerLabel || safeAlert.provider} (${safeAlert.event})`
      });
    }
  }

  /**
   * @param {any} statusResult
   */
  async function processServiceStatusSnapshot(statusResult) {
    if (stopped || !isActiveMonitorMode()) return;
    const { openclaw } = resolveEffectiveConfigs();
    if (openclaw.enabled !== true || openclaw.events?.serviceIncidents !== true) return;
    const providers = Array.isArray(statusResult?.providers) ? statusResult.providers : [];
    if (providers.length === 0) return;

    /** @type {any[]} */
    const transitions = [];
    for (const provider of providers) {
      if (!isPlainObject(provider)) continue;
      const id = String(provider.id || provider.provider || '').trim();
      if (!id) continue;
      const rawStatus = String(provider.status || '').trim().toLowerCase();
      if (!Object.hasOwn(SERVICE_SEVERITY, rawStatus)) continue;
      const level = SERVICE_SEVERITY[rawStatus];
      const name = String(provider.name || provider.label || id).trim();
      const prev = serviceProviderStates.get(id);
      if (serviceBaselineInitialized && prev && prev.level !== level) {
        const recovered = prev.level > 0 && level === 0;
        const degraded = level > prev.level;
        if (recovered || degraded) {
          transitions.push({
            id,
            name,
            status: rawStatus,
            previousStatus: prev.status,
            description: typeof provider.description === 'string' ? provider.description : '',
            url: typeof provider.url === 'string' ? provider.url : '',
            updatedAt: provider.updatedAt || statusResult?.checkedAt || new Date(now()).toISOString()
          });
        }
      }
      serviceProviderStates.set(id, { status: rawStatus, level, name });
    }
    serviceBaselineInitialized = true;

    for (const incident of transitions) {
      const text = formatOpenClawServiceIncidentMessage(incident);
      const idempotencyKey = `service:${crypto
        .createHash('sha256')
        .update(`${incident.id}\n${incident.status}\n${incident.updatedAt}`)
        .digest('hex')
        .slice(0, 24)}`;
      await dispatchBridgeEvent({
        eventType: 'service_incident',
        text,
        payload: { incident },
        idempotencyKey,
        source: 'desktop-service-status',
        summary: `${incident.name}: ${incident.previousStatus} -> ${incident.status}`
      });
    }
  }

  async function pollServiceStatusOnce() {
    if (stopped || servicePollInFlight || typeof serviceStatusClient?.getServiceStatus !== 'function') return;
    servicePollInFlight = true;
    try {
      const result = await serviceStatusClient.getServiceStatus({ force: false });
      await processServiceStatusSnapshot(result);
    } catch (error) {
      logWarn(`[openclaw] service status poll failed: ${errMessage(error)}`);
    } finally {
      servicePollInFlight = false;
    }
  }

  function reconcileServicePolling() {
    const { openclaw } = resolveEffectiveConfigs();
    const shouldPoll = Boolean(
      !stopped
      && isActiveMonitorMode()
      && openclaw.enabled === true
      && openclaw.events?.serviceIncidents === true
      && typeof serviceStatusClient?.getServiceStatus === 'function'
    );
    if (!shouldPoll) {
      if (servicePollTimer) {
        clearInterval(servicePollTimer);
        servicePollTimer = null;
      }
      serviceBaselineInitialized = false;
      serviceProviderStates.clear();
      return;
    }
    if (!servicePollTimer) {
      void trackTask(pollServiceStatusOnce());
      const interval = clampInt(servicePollIntervalMs, 1000, 3_600_000, DEFAULT_SERVICE_POLL_INTERVAL_MS);
      servicePollTimer = setInterval(() => {
        void trackTask(pollServiceStatusOnce());
      }, interval);
      servicePollTimer.unref?.();
    }
  }

  async function closeBridgeServer() {
    const srv = bridgeServer;
    bridgeServer = null;
    bridgeListening = false;
    if (!srv) return;
    await new Promise((resolve) => {
      try {
        srv.closeAllConnections?.();
        srv.close(() => resolve(undefined));
      } catch (_) {
        resolve(undefined);
      }
    });
  }

  /**
   * @param {http.IncomingMessage} req
   * @param {http.ServerResponse} res
   */
  async function handleLocalBridgeHttpRequest(req, res) {
    const presented = readBearerTokenFromRequest(req);
    const expected = ensureLocalBridgeToken();
    if (!timingSafeEqualText(presented, expected)) {
      sendJson(res, 401, { ok: false, error: 'unauthorized' });
      return;
    }
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (url.pathname === '/api/health') {
      if (req.method !== 'GET') {
        sendJson(res, 405, { ok: false, error: 'invalid_request' });
        return;
      }
      sendJson(res, 200, { ok: true, mode: 'local-bridge', service: 'token-monitor' });
      return;
    }
    try {
      const handled = await ensureLocalSurface().handleRequest(req, res, url);
      if (!handled && !res.headersSent) {
        sendJson(res, 404, { ok: false, error: 'not_found' });
      }
    } catch (error) {
      if (!res.headersSent) {
        sendJson(res, 500, { ok: false, error: 'internal_error', message: errMessage(error) || 'Request failed' });
      }
    }
  }

  async function applyLocalBridgeReconcile() {
    const mode = currentMode();
    const { openclaw } = resolveEffectiveConfigs();
    const wantEnabled = !stopped && mode === 'local' && openclaw.localBridge?.enabled === true;
    const wantPort = clampInt(openclaw.localBridge?.port, 1, 65535, DEFAULT_LOCAL_BRIDGE_PORT);

    if (!wantEnabled) {
      bridgeError = null;
      await closeBridgeServer();
      return getLocalBridgeStatus();
    }

    ensureLocalBridgeToken();
    if (bridgeServer && bridgeListening && bridgeListeningPort === wantPort) {
      bridgeError = null;
      return getLocalBridgeStatus();
    }

    await closeBridgeServer();
    bridgeError = null;

    const srv = http.createServer((req, res) => {
      void handleLocalBridgeHttpRequest(req, res);
    });
    srv.on('error', (error) => {
      bridgeError = errCodeOrMessage(error) || 'bridge_error';
      bridgeListening = false;
      logWarn(`[openclaw] local bridge error: ${errMessage(error)}`);
    });

    try {
      await new Promise((resolve, reject) => {
        /** @param {any} err */
        const onError = (err) => {
          srv.off('listening', onListening);
          reject(err);
        };
        const onListening = () => {
          srv.off('error', onError);
          resolve(undefined);
        };
        srv.once('error', onError);
        srv.once('listening', onListening);
        srv.listen(wantPort, '127.0.0.1');
      });
      const addr = srv.address();
      bridgeServer = srv;
      bridgeListening = true;
      bridgeListeningPort = (addr && typeof addr === 'object' && Number.isInteger(addr.port)) ? addr.port : wantPort;
      bridgeError = null;
    } catch (error) {
      bridgeServer = null;
      bridgeListening = false;
      bridgeError = errCodeOrMessage(error) || 'bridge_listen_failed';
      try { srv.close(); } catch (_) {}
    }
    return getLocalBridgeStatus();
  }

  function reconcileLocalBridge() {
    bridgeChain = bridgeChain.then(() => applyLocalBridgeReconcile()).catch((error) => {
      bridgeError = errMessage(error) || 'bridge_reconcile_failed';
      return getLocalBridgeStatus();
    });
    return bridgeChain;
  }

  function getLocalBridgeStatus() {
    const mode = currentMode();
    const { openclaw } = resolveEffectiveConfigs();
    const enabled = mode === 'local' && openclaw.localBridge?.enabled === true;
    const configuredPort = clampInt(openclaw.localBridge?.port, 1, 65535, DEFAULT_LOCAL_BRIDGE_PORT);
    const activePort = bridgeListening ? bridgeListeningPort : configuredPort;
    const rawToken = readLocalBridgeToken();
    const baseUrl = `http://127.0.0.1:${activePort}`;
    return {
      ok: true,
      enabled,
      running: Boolean(bridgeListening),
      host: '127.0.0.1',
      port: activePort,
      baseUrl,
      endpointUrl: `${baseUrl}/api/mcp`,
      tokenConfigured: Boolean(rawToken),
      maskedToken: maskToken(rawToken),
      ...(bridgeError ? { error: bridgeError } : {})
    };
  }

  /**
   * @param {{ kind?: string }} [options]
   */
  function copyLocalBridgeConfig(options = {}) {
    const kind = options?.kind === 'token' ? 'token' : 'mcpConfig';
    const token = ensureLocalBridgeToken();
    const status = getLocalBridgeStatus();
    const valueToCopy = kind === 'token'
      ? token
      : JSON.stringify({
          mcpServers: {
            'token-monitor': {
              type: 'http',
              url: status.endpointUrl,
              headers: {
                Authorization: `Bearer ${token}`
              }
            }
          }
        }, null, 2);
    try {
      clipboardWriteText(valueToCopy);
      return { ok: true, copied: kind };
    } catch (error) {
      return { ok: false, error: errMessage(error) || 'clipboard_failed' };
    }
  }

  async function regenerateLocalBridgeToken() {
    const nextToken = crypto.randomBytes(32).toString('hex');
    writeLocalBridgeToken(nextToken);
    await reconcileLocalBridge();
    return getLocalBridgeStatus();
  }

  /**
   * Synchronize non-secret OpenClaw/AI settings into local manager and active listeners.
   *
   * @param {any} [reportIntegrations]
   */
  function reconcile(reportIntegrations = null) {
    if (stopped) return bridgeChain;
    if (localManager && reportIntegrations && isPlainObject(reportIntegrations)) {
      const current = localManager.getStatus();
      const nextAi = reportIntegrations.ai !== undefined
        ? normalizeAiIntegrationConfig(reportIntegrations.ai)
        : current.ai;
      const nextOpenClaw = reportIntegrations.openclaw !== undefined
        ? mergeOpenClawIntegrationConfig(current.openclaw, reportIntegrations.openclaw)
        : current.openclaw;
      if (
        JSON.stringify(nextAi) !== JSON.stringify(current.ai)
        || JSON.stringify(nextOpenClaw) !== JSON.stringify(current.openclaw)
      ) {
        localManager.updateConfig({ ai: nextAi, openclaw: nextOpenClaw });
      }
    }
    if (localManager) {
      localManager.setSecrets(readStoredSecrets());
    }
    syncTrackerConfig();
    reconcileServicePolling();
    return reconcileLocalBridge();
  }

  /**
   * Handle saving AI/OpenClaw settings + secrets in `local` mode cleanly.
   *
   * @param {any} patch
   */
  function saveLocalIntegrations(patch = {}) {
    const store = getCredentialStore?.();
    const secretPatch = {};
    if (patch?.ai?.clearApiKey === true) secretPatch.aiApiKey = '';
    else if (typeof patch?.ai?.apiKey === 'string' && patch.ai.apiKey.trim()) secretPatch.aiApiKey = patch.ai.apiKey.trim();
    if (patch?.openclaw?.clearHookToken === true) secretPatch.openclawHookToken = '';
    else if (typeof patch?.openclaw?.hookToken === 'string' && patch.openclaw.hookToken.trim()) secretPatch.openclawHookToken = patch.openclaw.hookToken.trim();
    if (patch?.openclaw?.clearWeixinBotToken === true) secretPatch.weixinBotToken = '';
    else if (typeof patch?.openclaw?.weixinBotToken === 'string' && patch.openclaw.weixinBotToken.trim()) secretPatch.weixinBotToken = patch.openclaw.weixinBotToken.trim();

    if (store && typeof store.writeIntegrationSecrets === 'function' && Object.keys(secretPatch).length > 0) {
      store.writeIntegrationSecrets(secretPatch);
    }

    const sanitizedPatch = {
      ...(isPlainObject(patch?.ai) ? { ai: { ...patch.ai } } : {}),
      ...(isPlainObject(patch?.openclaw) ? { openclaw: { ...patch.openclaw } } : {})
    };
    if (sanitizedPatch.ai) {
      delete sanitizedPatch.ai.apiKey;
      delete sanitizedPatch.ai.clearApiKey;
      delete sanitizedPatch.ai.apiKeyConfigured;
    }
    if (sanitizedPatch.openclaw) {
      delete sanitizedPatch.openclaw.hookToken;
      delete sanitizedPatch.openclaw.clearHookToken;
      delete sanitizedPatch.openclaw.hookTokenConfigured;
      delete sanitizedPatch.openclaw.weixinBotToken;
      delete sanitizedPatch.openclaw.clearWeixinBotToken;
      delete sanitizedPatch.openclaw.weixinBotConfigured;
    }

    const mgr = getLocalManager();
    if (Object.keys(secretPatch).length > 0) {
      mgr.setSecrets(readStoredSecrets());
    }
    const updated = mgr.updateConfig(sanitizedPatch);
    if (updated?.ok === false) return updated;
    syncTrackerConfig();
    reconcileServicePolling();
    void reconcileLocalBridge();
    return { ok: true, ...mgr.getStatus() };
  }

  function getLocalIntegrationsStatus() {
    const mgr = getLocalManager();
    mgr.setSecrets(readStoredSecrets());
    return mgr.getStatus();
  }

  /**
   * @param {any} stats
   */
  function onStats(stats) {
    if (stopped || !isPlainObject(stats)) return;
    updateLiveRateTracker(stats);
    const { openclaw } = resolveEffectiveConfigs();
    if (!isActiveMonitorMode() || openclaw.enabled !== true) return;
    if (openclaw.events?.sessionCompleted === true) {
      completionTracker.accept(stats);
    }
    if (openclaw.events?.quotaAlerts === true) {
      void trackTask(evaluateQuotaAlerts(stats));
    }
  }

  /**
   * @param {any} patch
   */
  function onLocalSessionActivity(patch) {
    if (stopped || !isPlainObject(patch)) return;
    const { openclaw } = resolveEffectiveConfigs();
    if (!isActiveMonitorMode() || openclaw.enabled !== true || openclaw.events?.sessionCompleted !== true) {
      return;
    }
    const stats = getStats();
    if (isPlainObject(stats)) {
      completionTracker.accept(stats);
    }
  }

  /**
   * @param {any} alert
   */
  async function onApprovalAlert(alert) {
    if (!isPlainObject(alert)) return;
    localApprovalAlerts.unshift({
      ...alert,
      observedAt: alert.observedAt || new Date(now()).toISOString()
    });
    if (localApprovalAlerts.length > MAX_LOCAL_APPROVAL_ALERTS) {
      localApprovalAlerts.length = MAX_LOCAL_APPROVAL_ALERTS;
    }
    if (stopped || !isActiveMonitorMode()) return;
    const { openclaw } = resolveEffectiveConfigs();
    if (openclaw.enabled !== true || openclaw.events?.approvalAlerts !== true) return;

    const text = formatOpenClawApprovalAlertMessage(alert);
    const idempotencyKey = alert.id ? `approval:${alert.id}` : '';
    await dispatchBridgeEvent({
      eventType: 'approval_alert',
      text,
      payload: { alert },
      idempotencyKey,
      source: 'desktop-approval',
      summary: [alert.client, alert.projectLabel].filter(Boolean).join(' · ')
    });
  }

  function getPushHistory() {
    const mgr = resolveDispatchManager();
    return {
      ok: true,
      ...mgr.getPushHistory()
    };
  }

  /**
   * @param {any} [payload]
   */
  async function testPush(payload = {}) {
    const mgr = resolveDispatchManager();
    if (mgr === localManager) {
      mgr.setSecrets(readStoredSecrets());
    }
    return mgr.sendTestNotification({
      ...(typeof payload?.message === 'string' ? { message: payload.message } : {}),
      source: 'desktop'
    });
  }

  /**
   * @param {any} [payload]
   */
  async function pushQuery(payload = {}) {
    const mgr = resolveDispatchManager();
    if (mgr === localManager) {
      mgr.setSecrets(readStoredSecrets());
    }
    return mgr.pushQueryToOpenClaw({
      type: payload?.type || 'usage',
      params: isPlainObject(payload?.params) ? payload.params : {},
      includeAi: payload?.includeAi === true,
      ...(typeof payload?.customMessage === 'string' ? { customMessage: payload.customMessage } : {}),
      ...(typeof payload?.idempotencyKey === 'string' ? { idempotencyKey: payload.idempotencyKey } : {}),
      source: 'desktop'
    });
  }

  /**
   * @param {any} [options]
   */
  async function analyzeWithAi(options = {}) {
    const mgr = resolveDispatchManager();
    if (mgr === localManager) {
      mgr.setSecrets(readStoredSecrets());
    }
    return mgr.analyzeReport(options || {});
  }

  /**
   * @param {any} [options]
   */
  async function pushReport(options = {}) {
    const mgr = resolveDispatchManager();
    if (mgr === localManager) {
      mgr.setSecrets(readStoredSecrets());
    }
    const res = await mgr.pushToOpenClaw(options || {});
    if (res?.ok === false && res?.error === 'report_manager_unavailable') {
      const granularity = String(options?.granularity || 'daily').trim().toLowerCase();
      const period = granularity === 'monthly'
        ? 'month'
        : (granularity === 'weekly' ? 'week' : 'today');
      return mgr.pushQueryToOpenClaw({
        type: 'usage',
        params: { period, groupBy: 'summary' },
        includeAi: options?.includeAi === true,
        ...(typeof options?.customMessage === 'string' ? { customMessage: options.customMessage } : {}),
        ...(typeof options?.idempotencyKey === 'string' ? { idempotencyKey: options.idempotencyKey } : {}),
        source: 'desktop'
      });
    }
    return res;
  }

  function getLiveRateSnapshot() {
    return bridgeLiveRateTracker.getSample();
  }

  async function flush() {
    completionTracker.flush();
    await Promise.allSettled([...pendingAsyncTasks]);
    if (localManager && typeof localManager.stop === 'function') {
      // IntegrationManager keeps trackTasks internal; pendingAsyncTasks already covers bridge dispatches
    }
  }

  async function stop() {
    stopped = true;
    completionTracker.stop();
    if (servicePollTimer) {
      clearInterval(servicePollTimer);
      servicePollTimer = null;
    }
    await closeBridgeServer();
    await Promise.allSettled([...pendingAsyncTasks]);
    if (localManager) {
      try {
        await localManager.stop();
      } catch (_) {}
      localManager = null;
    }
  }

  return {
    analyzeWithAi,
    copyLocalBridgeConfig,
    flush,
    getLiveRateSnapshot,
    getLocalBridgeStatus,
    getLocalIntegrationsStatus,
    getPushHistory,
    listApprovalAlerts,
    onApprovalAlert,
    onLocalSessionActivity,
    onStats,
    processServiceStatusSnapshot,
    pushQuery,
    pushReport,
    reconcile,
    regenerateLocalBridgeToken,
    saveLocalIntegrations,
    stop,
    testPush
  };
}

/**
 * Normalize and sanitize limits history query output across Desktop providers.
 *
 * @param {{
 *   stats: any,
 *   scope: any,
 *   historyStore: { query: (scope: any, provider: any, range?: any) => Promise<any> },
 *   params?: { accountKey?: string, provider?: string, windowName?: string, hours?: number }
 * }} input
 */
async function queryLimitsHistoryForOpenClaw({ stats, scope, historyStore, params = {} }) {
  if (!historyStore || typeof historyStore.query !== 'function') {
    return { available: false, reason: 'desktop_only', series: [] };
  }
  const providers = Array.isArray(stats?.limits?.providers) ? stats.limits.providers : [];
  const filterProvider = typeof params.provider === 'string' ? params.provider.trim().toLowerCase() : '';
  const filterAccountKey = typeof params.accountKey === 'string' ? params.accountKey.trim() : '';
  const filterWindow = typeof params.windowName === 'string' ? params.windowName.trim().toLowerCase() : '';
  const hours = clampInt(params.hours, 1, 24 * 30, 24);
  const cutoffMs = Date.now() - hours * 3600_000;

  const matched = providers.filter((/** @type {any} */ p) => {
    if (!p || typeof p !== 'object') return false;
    if (filterProvider && String(p.provider || '').toLowerCase() !== filterProvider) return false;
    if (filterAccountKey && String(p.accountKey || '') !== filterAccountKey) return false;
    return true;
  });

  /** @type {any[]} */
  const series = [];
  for (const provider of matched) {
    const res = await historyStore.query(scope, provider);
    const windows = Array.isArray(res?.windows) ? res.windows : [];
    for (const w of windows) {
      const label = String(w?.window?.label || w?.window?.kind || w?.key || '');
      if (filterWindow && !label.toLowerCase().includes(filterWindow)) continue;
      const points = Array.isArray(w?.points) ? w.points : [];
      for (const pt of points) {
        const tsMs = typeof pt?.at === 'number'
          ? pt.at
          : (typeof pt?.recordedAt === 'string' ? Date.parse(pt.recordedAt) : Date.parse(String(pt?.timestamp || '')));
        if (Number.isFinite(tsMs) && tsMs < cutoffMs) continue;
        const iso = Number.isFinite(tsMs)
          ? new Date(tsMs).toISOString()
          : (pt?.recordedAt || pt?.observedAt || null);
        let remainingPercent = pt?.remainingPercent ?? null;
        if (remainingPercent === null && w?.unit === 'pp' && Number.isFinite(Number(pt?.value))) {
          remainingPercent = Math.max(0, Math.min(100, Math.round((100 - Number(pt.value)) * 10) / 10));
        } else if (remainingPercent === null && w?.balance && Number.isFinite(Number(pt?.value)) && Number(pt?.basis) > 0) {
          remainingPercent = Math.max(0, Math.min(100, Math.round((Number(pt.value) / Number(pt.basis)) * 1000) / 10));
        }
        series.push({
          provider: provider.provider,
          providerLabel: resolveProviderLabel(provider.provider),
          windowName: label,
          unit: w?.unit || 'pp',
          remainingPercent,
          ...(w?.balance && Number.isFinite(Number(pt?.value)) ? { remaining: Number(pt.value) } : {}),
          recordedAt: iso
        });
      }
    }
  }

  return sanitizeLimitsHistoryPayload({
    available: true,
    hours,
    series: series.slice(-200)
  });
}

module.exports = {
  createOpenClawBridge,
  extractQuotaRowsFromStats,
  queryLimitsHistoryForOpenClaw
};
