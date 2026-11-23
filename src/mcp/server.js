#!/usr/bin/env node
// @ts-check
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { URLSearchParams } = require('node:url');

const { parseArgs, projectRoot, readJson } = require('../shared/config');
const {
  createHubClientFetch,
  isInsecureRemoteHttpUrl,
  readClientCaFile,
  readPrivateSecretFile
} = require('../shared/hubClientFetch');
const {
  createMcpReportServer,
  JSON_RPC_ERRORS,
  sanitizeLimitsHistoryPayload,
  stripSessionDetailTitles
} = require('../shared/mcpReportProtocol');
const { DEFAULT_STALE_AFTER_MS } = require('../shared/syncUploadInterval');
const { aggregateDevices, aggregateHistory, normalizeClientName } = require('../shared/usage');
const {
  queryUsageBreakdown,
  listSessionsQuery,
  queryUsageHistory,
  getDevicesAndHealthQuery,
  getLimitsOverviewQuery,
  getSubscriptionsAndForecastsQuery,
  getLiveTokenRateSummary
} = require('../shared/openclawQueries');
const {
  REPORT_GRANULARITIES,
  REPORT_SCHEMA,
  analyzeProjectUsage,
  buildUsageReport,
  renderReportJson,
  renderReportMarkdown,
  reportContentSignature,
  resolveReportPeriod
} = require('../shared/usageReport');

const DEFAULT_HUB_URL = 'http://127.0.0.1:17321';
const DEFAULT_REQUEST_TIMEOUT_MS = 15000;
const MAX_CONTENT_LENGTH_BYTES = 64 * 1024 * 1024;
const PERIOD_KEY_PATTERNS = Object.freeze({
  daily: /^\d{4}-\d{2}-\d{2}$/,
  weekly: /^\d{4}-W\d{2}$/,
  monthly: /^\d{4}-\d{2}$/
});

/**
 * @returns {string}
 */
function readPackageVersion() {
  const pkg = readJson(path.join(projectRoot(), 'package.json'), null);
  return pkg && typeof pkg.version === 'string' && pkg.version ? pkg.version : '1.0.0';
}

/**
 * @param {any} value
 * @returns {string}
 */
function nonEmptyString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * @param {string} filePath
 * @param {string} content
 */
function writeTextAtomic(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, content, 'utf8');
  fs.renameSync(tempPath, filePath);
}

/**
 * @param {any} result
 * @returns {any}
 */
function unwrapReportObject(result) {
  if (!result || typeof result !== 'object') return null;
  if (result.report && typeof result.report === 'object') return result.report;
  if (result.schema === REPORT_SCHEMA || (result.summary && result.period)) return result;
  return null;
}

/**
 * Resolve CLI flags and environment variables for the standalone MCP server.
 * @param {{ argv?: string[], env?: NodeJS.ProcessEnv }} [options]
 * @returns {{
 *   help: boolean,
 *   mode: 'hub' | 'local',
 *   hubUrl: string,
 *   secret: string,
 *   secretFile: string,
 *   secretFromArgv: boolean,
 *   caCertPath: string,
 *   requireHttps: boolean,
 *   dataFile: string,
 *   reportsDir: string,
 *   timeZone: string,
 *   staleAfterMs: number
 * }}
 */
function resolveMcpServerOptions(options = {}) {
  const argv = Array.isArray(options.argv) ? options.argv : process.argv.slice(2);
  const env = options.env || process.env;
  const args = /** @type {Record<string, any>} */ (parseArgs(argv));

  const help = Boolean(args.help === true || argv.includes('-h') || argv.includes('--help'));

  const cliHubUrl = nonEmptyString(args['hub-url'] ?? args.hubUrl);
  const envHubUrl = nonEmptyString(env.TOKEN_MONITOR_HUB_URL);
  const cliDataFile = nonEmptyString(args['data-file'] ?? args.dataFile);
  const envDataFile = nonEmptyString(env.TOKEN_MONITOR_DATA_FILE);
  const cliReportsDir = nonEmptyString(args['reports-dir'] ?? args.reportsDir);
  const envReportsDir = nonEmptyString(env.TOKEN_MONITOR_REPORTS_DIR);
  const cliSecret = nonEmptyString(args.secret);
  const cliSecretFile = nonEmptyString(args['secret-file'] ?? args.secretFile);
  const envSecret = nonEmptyString(env.TOKEN_MONITOR_SECRET);
  const envSecretFile = nonEmptyString(env.TOKEN_MONITOR_SECRET_FILE);
  const cliCaCertPath = nonEmptyString(args['ca-cert'] ?? args.caCert);
  const envCaCertPath = nonEmptyString(env.TOKEN_MONITOR_CA_CERT);
  const rawRequireHttps = args['require-https'] ?? args.requireHttps ?? env.TOKEN_MONITOR_REQUIRE_HTTPS;
  const requireHttps = rawRequireHttps === true
    || /^(?:1|true|yes|on)$/i.test(String(rawRequireHttps ?? '').trim());
  const cliTimeZone = nonEmptyString(args['time-zone'] ?? args.timeZone);
  const envTimeZone = nonEmptyString(env.TOKEN_MONITOR_TIME_ZONE);
  const cliLocal = args.local === true || String(args.local || '').toLowerCase() === 'true';

  const secretFile = cliSecretFile || envSecretFile;
  const secret = cliSecret
    || (cliSecretFile ? readPrivateSecretFile(cliSecretFile) : '')
    || envSecret
    || (envSecretFile ? readPrivateSecretFile(envSecretFile) : '');

  /** @type {'hub' | 'local'} */
  let mode;
  if (cliLocal || cliDataFile) {
    mode = 'local';
  } else if (cliHubUrl) {
    mode = 'hub';
  } else if (envDataFile && !envHubUrl) {
    mode = 'local';
  } else {
    mode = 'hub';
  }

  const resolvedDataFile = path.resolve(
    cliDataFile || envDataFile || path.join(projectRoot(), 'data', 'devices.json')
  );
  const resolvedReportsDir = cliReportsDir || envReportsDir
    ? path.resolve(cliReportsDir || envReportsDir)
    : path.join(path.dirname(resolvedDataFile), 'reports');

  const rawStale = Number(args['stale-after-ms'] ?? args.staleAfterMs ?? env.TOKEN_MONITOR_STALE_AFTER_MS);
  const staleAfterMs = Number.isFinite(rawStale) && rawStale > 0 ? rawStale : DEFAULT_STALE_AFTER_MS;

  return {
    help,
    mode,
    hubUrl: (cliHubUrl || envHubUrl || DEFAULT_HUB_URL).replace(/\/+$/, ''),
    secret,
    secretFile,
    secretFromArgv: Boolean(cliSecret),
    caCertPath: cliCaCertPath || envCaCertPath,
    requireHttps,
    dataFile: resolvedDataFile,
    reportsDir: resolvedReportsDir,
    timeZone: cliTimeZone || envTimeZone,
    staleAfterMs
  };
}

/**
 * Create a backend adapter targeting a running Token Monitor Hub over HTTP(S).
 * @param {object} [options]
 * @param {string} [options.hubUrl]
 * @param {string} [options.secret]
 * @param {string} [options.caCertPem]
 * @param {string} [options.caCertPath]
 * @param {boolean} [options.requireHttps]
 * @param {number} [options.requestTimeoutMs]
 * @param {typeof globalThis.fetch} [options.fetchImpl]
 */
function createHubBackendAdapter(options = {}) {
  const baseUrl = (nonEmptyString(options.hubUrl) || DEFAULT_HUB_URL).replace(/\/+$/, '');
  const secret = nonEmptyString(options.secret);
  const requireHttps = options.requireHttps === true;
  if (requireHttps && isInsecureRemoteHttpUrl(baseUrl)) {
    throw Object.assign(
      new Error('Refusing plain HTTP connection to non-loopback Hub because --require-https / TOKEN_MONITOR_REQUIRE_HTTPS is enabled.'),
      { code: 'insecure_http_blocked' }
    );
  }
  const timeoutMs = Number.isFinite(Number(options.requestTimeoutMs)) && Number(options.requestTimeoutMs) > 0
    ? Number(options.requestTimeoutMs)
    : DEFAULT_REQUEST_TIMEOUT_MS;
  const caCertPem = nonEmptyString(options.caCertPem)
    || (nonEmptyString(options.caCertPath) ? readClientCaFile(nonEmptyString(options.caCertPath)).caCertPem : '');
  const ownedFetch = options.fetchImpl
    ? null
    : createHubClientFetch({ caCertPem, requireHttps, defaultTimeoutMs: timeoutMs });
  const fetchImpl = options.fetchImpl || /** @type {any} */ (ownedFetch);

  if (typeof fetchImpl !== 'function') {
    throw new Error('Global fetch is unavailable; Node 22+ is required.');
  }

  /**
   * @param {string} method
   * @param {string} pathWithQuery
   * @param {any} [body]
   */
  async function requestJson(method, pathWithQuery, body) {
    const url = `${baseUrl}${pathWithQuery}`;
    /** @type {Record<string, string>} */
    const headers = {
      accept: 'application/json'
    };
    if (secret) {
      headers.authorization = `Bearer ${secret}`;
    }
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
    }

    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers,
        redirect: 'error',
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Hub request failed (${method} ${url}): ${msg}`, { cause: err });
    }

    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }

    return {
      status: response.status,
      ok: response.ok,
      data,
      text
    };
  }

  /**
   * @param {{ status: number, data: any, text: string }} res
   * @param {string} fallback
   * @returns {string}
   */
  function formatHttpError(res, fallback) {
    if (res.status === 401) {
      return `Hub authentication failed (HTTP ${res.status}): check TOKEN_MONITOR_SECRET / --secret`;
    }
    if (res.status === 403) {
      if (res.data && typeof res.data === 'object' && typeof res.data.error === 'string' && res.data.error) {
        const msg = typeof res.data.message === 'string' && res.data.message ? res.data.message : '';
        return msg && msg !== res.data.error ? `${res.data.error}: ${msg}` : res.data.error;
      }
      return `Hub authentication failed (HTTP ${res.status}): check TOKEN_MONITOR_SECRET / --secret`;
    }
    if (res.data && typeof res.data === 'object') {
      if (typeof res.data.error === 'string' && res.data.error) {
        const msg = typeof res.data.message === 'string' && res.data.message ? res.data.message : '';
        return msg && msg !== res.data.error ? `${res.data.error}: ${msg}` : res.data.error;
      }
      if (typeof res.data.message === 'string' && res.data.message) return res.data.message;
    }
    return fallback || `Hub HTTP ${res.status}`;
  }

  return {
    mode: /** @type {const} */ ('hub'),
    destroy: async () => {
      if (ownedFetch && typeof ownedFetch.destroy === 'function') {
        await ownedFetch.destroy();
      }
    },

    /**
     * @param {{ granularity?: string, limit?: number }} [args]
     */
    async listReports(args = {}) {
      const params = new URLSearchParams();
      if (args.granularity) params.set('granularity', String(args.granularity));
      if (args.limit !== undefined) params.set('limit', String(args.limit));
      const qs = params.toString();
      const res = await requestJson('GET', qs ? `/api/reports?${qs}` : '/api/reports');
      if (!res.ok) {
        return { ok: false, error: formatHttpError(res, `Failed to list reports (HTTP ${res.status})`) };
      }
      return res.data || { ok: true, reports: [] };
    },

    /**
     * @param {{ granularity: string, periodKey?: string, format?: string }} args
     */
    async getReport(args) {
      const granularity = String(args?.granularity || '').trim();
      if (!REPORT_GRANULARITIES.includes(granularity)) {
        return { ok: false, error: `Invalid granularity: ${granularity}` };
      }
      const periodKey = String(args?.periodKey || 'latest').trim() || 'latest';
      const format = String(args?.format || 'both').trim() || 'both';
      const res = await requestJson(
        'GET',
        `/api/reports/${encodeURIComponent(granularity)}/${encodeURIComponent(periodKey)}?format=${encodeURIComponent(format)}`
      );
      if (res.status === 404) {
        return {
          ok: false,
          error: (res.data && typeof res.data.error === 'string' && res.data.error)
            || `Report not found for ${granularity}:${periodKey}.`
        };
      }
      if (!res.ok) {
        return { ok: false, error: formatHttpError(res, `Failed to fetch report (HTTP ${res.status})`) };
      }
      return res.data;
    },

    /**
     * @param {{ granularity?: string, periodKey?: string, force?: boolean }} [args]
     */
    async generateReport(args = {}) {
      const payload = {
        ...(args.granularity !== undefined ? { granularity: String(args.granularity) } : {}),
        ...(args.periodKey !== undefined ? { periodKey: String(args.periodKey) } : {}),
        ...(args.force !== undefined ? { force: Boolean(args.force) } : {})
      };
      const res = await requestJson('POST', '/api/reports/generate', payload);
      if (!res.ok) {
        return { ok: false, error: formatHttpError(res, `Failed to generate report (HTTP ${res.status})`) };
      }
      return res.data || { ok: true, reports: [] };
    },

    /**
     * @param {{ granularity?: string, periodKey?: string, project?: string, limit?: number }} [args]
     */
    async analyzeProjects(args = {}) {
      const granularity = String(args.granularity || 'weekly').trim() || 'weekly';
      if (!REPORT_GRANULARITIES.includes(granularity)) {
        return { ok: false, error: `Invalid granularity: ${granularity}` };
      }
      const periodKey = String(args.periodKey || 'latest').trim() || 'latest';
      const pathWithQuery = `/api/reports/${encodeURIComponent(granularity)}/${encodeURIComponent(periodKey)}?format=json`;
      let res = await requestJson('GET', pathWithQuery);

      if (res.status === 404) {
        const genRes = await requestJson('POST', '/api/reports/generate', {
          granularity,
          periodKey
        });
        if (!genRes.ok) {
          return {
            ok: false,
            error: formatHttpError(genRes, `Report not found for ${granularity}:${periodKey}.`)
          };
        }
        const generatedList = Array.isArray(genRes.data?.reports) ? genRes.data.reports : [];
        const matchedGen = generatedList.find(
          (/** @type {any} */ entry) => entry && entry.granularity === granularity && unwrapReportObject(entry)
        );
        const directReport = unwrapReportObject(genRes.data) || (matchedGen ? unwrapReportObject(matchedGen) : null);
        if (directReport) {
          return analyzeProjectUsage(directReport, {
            project: args.project,
            limit: args.limit
          });
        }
        res = await requestJson('GET', pathWithQuery);
      }

      if (!res.ok) {
        return { ok: false, error: formatHttpError(res, `Failed to load report (HTTP ${res.status})`) };
      }

      const reportObj = unwrapReportObject(res.data);
      if (!reportObj) {
        return { ok: false, error: `Report not found for ${granularity}:${periodKey}.` };
      }

      return analyzeProjectUsage(reportObj, {
        project: args.project,
        limit: args.limit
      });
    },

    async getStats() {
      const res = await requestJson('GET', '/api/stats');
      if (!res.ok) {
        return { ok: false, error: formatHttpError(res, `Failed to load live stats (HTTP ${res.status})`) };
      }
      return res.data || {};
    },

    /**
     * @param {{ granularity?: string, periodKey?: string, question?: string, language?: string, refresh?: boolean }} [args]
     */
    async analyzeWithAi(args = {}) {
      const res = await requestJson('POST', '/api/reports/ai-analyze', {
        ...(args.granularity !== undefined ? { granularity: String(args.granularity) } : {}),
        ...(args.periodKey !== undefined ? { periodKey: String(args.periodKey) } : {}),
        ...(args.question !== undefined ? { question: String(args.question) } : {}),
        ...(args.language !== undefined ? { language: String(args.language) } : {}),
        ...(args.refresh !== undefined ? { refresh: Boolean(args.refresh) } : {})
      });
      if (!res.ok) {
        return { ok: false, error: formatHttpError(res, `AI analysis failed (HTTP ${res.status})`) };
      }
      return res.data || { ok: false, error: 'Empty AI response' };
    },

    /**
     * @param {{ granularity?: string, periodKey?: string, includeAi?: boolean, includeLimits?: boolean, question?: string }} [args]
     */
    async pushToOpenClaw(args = {}) {
      const res = await requestJson('POST', '/api/reports/push', {
        target: 'openclaw',
        ...(args.granularity !== undefined ? { granularity: String(args.granularity) } : {}),
        ...(args.periodKey !== undefined ? { periodKey: String(args.periodKey) } : {}),
        ...(args.includeAi !== undefined ? { includeAi: Boolean(args.includeAi) } : {}),
        ...(args.includeLimits !== undefined ? { includeLimits: Boolean(args.includeLimits) } : {}),
        ...(args.question !== undefined ? { question: String(args.question) } : {})
      });
      if (!res.ok) {
        return { ok: false, error: formatHttpError(res, `OpenClaw push failed (HTTP ${res.status})`) };
      }
      return res.data || { ok: false, error: 'Empty push response' };
    },

    /**
     * @param {{ type?: string, test?: boolean, params?: any, includeAi?: boolean, customMessage?: string, idempotencyKey?: string }} [args]
     */
    async pushEventToOpenClaw(args = {}) {
      const res = await requestJson('POST', '/api/integrations/openclaw/push', {
        ...(args.type !== undefined ? { type: String(args.type) } : {}),
        ...(args.test !== undefined ? { test: Boolean(args.test) } : {}),
        ...(args.params !== undefined ? { params: args.params } : {}),
        ...(args.includeAi !== undefined ? { includeAi: Boolean(args.includeAi) } : {}),
        ...(args.customMessage !== undefined ? { customMessage: String(args.customMessage) } : {}),
        ...(args.idempotencyKey !== undefined ? { idempotencyKey: String(args.idempotencyKey) } : {})
      });
      if (!res.ok) {
        return { ok: false, error: formatHttpError(res, `OpenClaw push failed (HTTP ${res.status})`) };
      }
      return res.data || { ok: false, error: 'Empty push response' };
    },

    /**
     * @param {Record<string, any>} [args]
     */
    async queryUsageBreakdown(args = {}) {
      const params = new URLSearchParams();
      for (const key of ['period', 'range', 'groupBy', 'deviceId', 'limit', 'modelAliasGrouping', 'timeZone']) {
        if (args[key] !== undefined && args[key] !== null && args[key] !== '') {
          params.set(key, String(args[key]));
        }
      }
      const qs = params.toString();
      const res = await requestJson('GET', qs ? `/api/query/usage?${qs}` : '/api/query/usage');
      if (!res.ok) return { ok: false, error: formatHttpError(res, `Usage query failed (HTTP ${res.status})`) };
      return res.data || {};
    },

    /**
     * @param {Record<string, any>} [args]
     */
    async listSessions(args = {}) {
      const params = new URLSearchParams();
      for (const key of ['period', 'state', 'client', 'project', 'deviceId', 'search', 'sort', 'sortDirection', 'limit', 'cursor']) {
        if (args[key] !== undefined && args[key] !== null && args[key] !== '') {
          params.set(key, String(args[key]));
        }
      }
      const qs = params.toString();
      const res = await requestJson('GET', qs ? `/api/query/sessions?${qs}` : '/api/query/sessions');
      if (!res.ok) return { ok: false, error: formatHttpError(res, `Sessions query failed (HTTP ${res.status})`) };
      return res.data || {};
    },

    /**
     * @param {Record<string, any>} [args]
     */
    async getSessionDetail(args = {}) {
      const params = new URLSearchParams();
      for (const key of ['client', 'sessionId', 'deviceId', 'period', 'includeConversation', 'limit', 'offset', 'cursor']) {
        if (args[key] !== undefined && args[key] !== null && args[key] !== '') {
          params.set(key, String(args[key]));
        }
      }
      const qs = params.toString();
      const res = await requestJson('GET', qs ? `/api/query/session-detail?${qs}` : '/api/query/session-detail');
      if (!res.ok) return { ok: false, error: formatHttpError(res, `Session detail query failed (HTTP ${res.status})`) };
      return res.data || {};
    },

    /**
     * @param {Record<string, any>} [args]
     */
    async getUsageHistory(args = {}) {
      const params = new URLSearchParams();
      for (const key of ['resolution', 'from', 'to', 'groupBy', 'limit']) {
        if (args[key] !== undefined && args[key] !== null && args[key] !== '') {
          params.set(key, String(args[key]));
        }
      }
      const qs = params.toString();
      const res = await requestJson('GET', qs ? `/api/query/history?${qs}` : '/api/query/history');
      if (!res.ok) return { ok: false, error: formatHttpError(res, `History query failed (HTTP ${res.status})`) };
      return res.data || {};
    },

    /**
     * @param {Record<string, any>} [args]
     */
    async getDevicesAndHealth(args = {}) {
      const params = new URLSearchParams();
      for (const key of ['deviceId', 'includeDiagnostics']) {
        if (args[key] !== undefined && args[key] !== null && args[key] !== '') {
          params.set(key, String(args[key]));
        }
      }
      const qs = params.toString();
      const res = await requestJson('GET', qs ? `/api/query/devices?${qs}` : '/api/query/devices');
      if (!res.ok) return { ok: false, error: formatHttpError(res, `Devices query failed (HTTP ${res.status})`) };
      return res.data || {};
    },

    /**
     * @param {Record<string, any>} [args]
     */
    async getLimitsHistory(args = {}) {
      const params = new URLSearchParams();
      for (const key of ['thirdPartyOnly', 'provider', 'status', 'accountKey', 'windowName', 'hours', 'maxProviders', 'includeHistory']) {
        if (args[key] !== undefined && args[key] !== null && args[key] !== '') {
          params.set(key, String(args[key]));
        }
      }
      const qs = params.toString();
      const res = await requestJson('GET', qs ? `/api/query/limits?${qs}` : '/api/query/limits');
      if (!res.ok) return { ok: false, error: formatHttpError(res, `Limits query failed (HTTP ${res.status})`) };
      return res.data || {};
    },

    /**
     * @param {Record<string, any>} [args]
     */
    async getSubscriptionsAndForecasts(args = {}) {
      const params = new URLSearchParams();
      for (const key of ['date', 'includeForecasts', 'activeOnly']) {
        if (args[key] !== undefined && args[key] !== null && args[key] !== '') {
          params.set(key, String(args[key]));
        }
      }
      const qs = params.toString();
      const res = await requestJson('GET', qs ? `/api/query/subscriptions?${qs}` : '/api/query/subscriptions');
      if (!res.ok) return { ok: false, error: formatHttpError(res, `Subscriptions query failed (HTTP ${res.status})`) };
      return res.data || {};
    },

    /**
     * @param {Record<string, any>} [args]
     */
    async getLiveTokenRate(args = {}) {
      const params = new URLSearchParams();
      if (args.deviceId) params.set('deviceId', String(args.deviceId));
      const qs = params.toString();
      const res = await requestJson('GET', qs ? `/api/query/live-rate?${qs}` : '/api/query/live-rate');
      if (!res.ok) return { ok: false, error: formatHttpError(res, `Live rate query failed (HTTP ${res.status})`) };
      return res.data || {};
    },

    /**
     * @param {Record<string, any>} [args]
     */
    async getServiceStatusAndApprovals(args = {}) {
      const params = new URLSearchParams();
      if (args.force !== undefined) params.set('force', String(Boolean(args.force)));
      if (Array.isArray(args.providerIds) && args.providerIds.length > 0) {
        params.set('providerIds', args.providerIds.map((/** @type {any} */ p) => String(p)).join(','));
      }
      if (args.includeResetForecast !== undefined) {
        params.set('includeResetForecast', String(Boolean(args.includeResetForecast)));
      }
      if (args.includeApprovals !== undefined) {
        params.set('includeApprovals', String(Boolean(args.includeApprovals)));
      }
      const qs = params.toString();
      const res = await requestJson('GET', qs ? `/api/query/service-status?${qs}` : '/api/query/service-status');
      if (!res.ok) return { ok: false, error: formatHttpError(res, `Service status query failed (HTTP ${res.status})`) };
      const data = res.data || {};
      if (args.includeApprovals !== false && !data.approvalAlerts) {
        const alertsRes = await requestJson('GET', '/api/approval-alerts').catch(() => null);
        if (alertsRes?.ok && alertsRes.data) {
          data.approvalAlerts = alertsRes.data.ok
            ? { available: true, enabled: true, alerts: alertsRes.data.alerts || [] }
            : { available: true, enabled: false, alerts: [] };
        }
      }
      return data;
    },

    async listApprovalAlerts() {
      const res = await requestJson('GET', '/api/approval-alerts');
      if (!res.ok) return { ok: false, error: formatHttpError(res, `Approval alerts query failed (HTTP ${res.status})`) };
      return res.data || { error: 'disabled' };
    }
  };
}

/**
 * Create a backend adapter reading `devices.json`, `daily-snapshots.json`, and
 * persisted reports directly from disk without a running Hub process.
 * @param {object} [options]
 * @param {string} [options.dataFile]
 * @param {string} [options.reportsDir]
 * @param {string} [options.timeZone]
 * @param {number} [options.staleAfterMs]
 * @param {boolean} [options.sessionTitlesEnabled]
 * @param {boolean} [options.allowSessionDetail]
 * @param {boolean} [options.allowConversationText]
 * @param {Record<string, any> | null} [options.allTimeSessions]
 * @param {any} [options.liveRateSnapshot]
 * @param {any} [options.subscriptionsDoc]
 * @param {Record<string, number> | null} [options.rates]
 * @param {(args: any) => Promise<any> | any} [options.readSessionDetail]
 * @param {(args: any) => Promise<any> | any} [options.getLimitsHistory]
 * @param {(args: any) => Promise<any> | any} [options.getServiceStatus]
 * @param {(args: any) => Promise<any> | any} [options.getCodexResetForecast]
 * @param {() => Promise<any> | any} [options.listApprovalAlerts]
 */
function createLocalBackendAdapter(options = {}) {
  const dataFile = path.resolve(
    nonEmptyString(options.dataFile) || path.join(projectRoot(), 'data', 'devices.json')
  );
  const reportsDir = nonEmptyString(options.reportsDir)
    ? path.resolve(nonEmptyString(options.reportsDir))
    : path.join(path.dirname(dataFile), 'reports');
  const defaultTimeZone = nonEmptyString(options.timeZone);
  const staleAfterMs = Number.isFinite(Number(options.staleAfterMs)) && Number(options.staleAfterMs) > 0
    ? Number(options.staleAfterMs)
    : DEFAULT_STALE_AFTER_MS;

  function loadSnapshot() {
    const store = /** @type {any} */ (readJson(dataFile, /** @type {any} */ ({ version: 1, devices: {} })))
      || { version: 1, devices: {} };
    const rawDevices = store.devices && typeof store.devices === 'object'
      ? Object.values(store.devices)
      : [];
    const stats = /** @type {any} */ (aggregateDevices(rawDevices, staleAfterMs));
    stats.runtime = 'local-store';
    const history = aggregateHistory(rawDevices);

    const rawSnapshots = readJson(path.join(reportsDir, 'daily-snapshots.json'), null);
    /** @type {Record<string, any>} */
    let dailySnapshots = {};
    if (rawSnapshots && typeof rawSnapshots === 'object') {
      dailySnapshots = rawSnapshots.snapshots && typeof rawSnapshots.snapshots === 'object'
        ? rawSnapshots.snapshots
        : rawSnapshots;
    }

    const integrationsCfg = /** @type {any} */ (readJson(path.join(reportsDir, 'integrations.json'), null));
    const standaloneSubscriptions = readJson(path.join(path.dirname(dataFile), 'subscriptions.json'), null);
    const subscriptionsDoc = options.subscriptionsDoc ?? store.subscriptions ?? standaloneSubscriptions ?? null;
    const aliasSettings = store.syncSettings?.modelAliases?.value || null;

    return {
      store,
      rawDevices,
      stats,
      history,
      dailySnapshots,
      integrationsCfg,
      subscriptionsDoc,
      modelAliases: aliasSettings?.modelAliases || null,
      modelAliasGrouping: aliasSettings?.modelAliasGrouping || 'off'
    };
  }

  /**
   * @param {any} integrationsCfg
   * @returns {boolean}
   */
  function resolveSessionTitlesEnabled(integrationsCfg) {
    if (typeof options.sessionTitlesEnabled === 'boolean') {
      return options.sessionTitlesEnabled;
    }
    if (typeof integrationsCfg?.openclaw?.sessionTitlesEnabled === 'boolean') {
      return integrationsCfg.openclaw.sessionTitlesEnabled;
    }
    return true;
  }

  /**
   * @param {string} granularity
   */
  function scanDiskReports(granularity) {
    const dirPath = path.join(reportsDir, granularity);
    /** @type {string[]} */
    let entries;
    try {
      entries = fs.readdirSync(dirPath);
    } catch (err) {
      if (/** @type {NodeJS.ErrnoException} */ (err)?.code === 'ENOENT') return [];
      throw err;
    }

    /** @type {Array<{
     *   reportId: string,
     *   granularity: string,
     *   periodKey: string,
     *   label: string,
     *   startDate: string,
     *   endDate: string,
     *   generatedAt: string,
     *   totalTokens: number,
     *   knownCostUsd: number,
     *   projectCount: number,
     *   files: { json: string, markdown: string | null },
     *   report: any
     * }>} */
    const out = [];
    const pattern = Object.hasOwn(PERIOD_KEY_PATTERNS, granularity)
      ? PERIOD_KEY_PATTERNS[/** @type {'daily' | 'weekly' | 'monthly'} */ (granularity)]
      : null;
    if (!pattern) return out;

    for (const fileName of entries) {
      if (!fileName.endsWith('.json')) continue;
      const baseKey = path.basename(fileName, '.json');
      if (!pattern.test(baseKey)) continue;
      const jsonPath = path.join(dirPath, fileName);
      const report = readJson(jsonPath, null);
      if (!report || typeof report !== 'object') continue;
      const rawPeriodKey = typeof report.period?.key === 'string' ? report.period.key.trim() : '';
      if (rawPeriodKey && !pattern.test(rawPeriodKey)) continue;
      const periodKey = rawPeriodKey || baseKey;
      const mdPath = path.join(dirPath, `${periodKey}.md`);
      out.push({
        reportId: String(report.reportId || `${granularity}:${periodKey}`),
        granularity,
        periodKey,
        label: String(report.period?.label || periodKey),
        startDate: String(report.period?.startDate || ''),
        endDate: String(report.period?.endDate || ''),
        generatedAt: String(report.period?.generatedAt || ''),
        totalTokens: Number(report.summary?.totalTokens || 0),
        knownCostUsd: Number(report.summary?.knownCostUsd || 0),
        projectCount: Number(report.summary?.projectCount || 0),
        files: {
          json: jsonPath,
          markdown: fs.existsSync(mdPath) ? mdPath : null
        },
        report
      });
    }
    return out;
  }

  /**
   * @param {any[]} items
   */
  function sortReportsNewestFirst(items) {
    return items.sort((a, b) => (
      String(b.startDate).localeCompare(String(a.startDate))
      || String(b.periodKey).localeCompare(String(a.periodKey))
      || String(b.generatedAt).localeCompare(String(a.generatedAt))
      || String(a.granularity).localeCompare(String(b.granularity))
    ));
  }

  /**
   * @param {Record<string, any>} dailySnapshots
   * @param {string} startDate
   * @param {string} endDate
   */
  function hasSnapshotInRange(dailySnapshots, startDate, endDate) {
    for (const dateKey of Object.keys(dailySnapshots || {})) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateKey) && dateKey >= startDate && dateKey <= endDate) {
        return true;
      }
    }
    return false;
  }

  return {
    mode: /** @type {const} */ ('local'),

    /**
     * @param {{ granularity?: string, limit?: number }} [args]
     */
    async listReports(args = {}) {
      if (args.granularity !== undefined && !REPORT_GRANULARITIES.includes(String(args.granularity))) {
        return { ok: false, error: `Invalid granularity: ${String(args.granularity)}` };
      }
      const targets = args.granularity ? [String(args.granularity)] : [...REPORT_GRANULARITIES];
      const limit = Number.isInteger(args.limit) && /** @type {number} */ (args.limit) > 0
        ? /** @type {number} */ (args.limit)
        : 50;

      const items = sortReportsNewestFirst(
        targets.flatMap((g) => scanDiskReports(g))
      )
        .slice(0, limit)
        .map(({ report: _ignored, ...summary }) => summary);

      return {
        ok: true,
        mode: 'local',
        dataFile,
        reportsDir,
        reports: items
      };
    },

    /**
     * @param {{ granularity: string, periodKey?: string, format?: string, timeZone?: string }} args
     */
    async getReport(args) {
      const granularity = String(args?.granularity || '').trim();
      if (!REPORT_GRANULARITIES.includes(granularity)) {
        return { ok: false, error: `Invalid granularity: ${granularity}` };
      }
      const rawKey = String(args?.periodKey || 'latest').trim() || 'latest';
      const format = String(args?.format || 'both').trim() || 'both';
      const timeZone = nonEmptyString(args?.timeZone) || defaultTimeZone || undefined;
      const isLatestAlias = rawKey.toLowerCase() === 'latest';

      let resolved;
      try {
        resolved = resolveReportPeriod(granularity, rawKey, { timeZone });
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }

      const jsonPath = path.join(reportsDir, granularity, `${resolved.key}.json`);
      const mdPath = path.join(reportsDir, granularity, `${resolved.key}.md`);
      const diskReport = fs.existsSync(jsonPath) ? readJson(jsonPath, null) : null;
      const diskMd = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf8') : null;

      if (diskReport) {
        if (format === 'markdown') {
          return {
            ok: true,
            markdown: diskMd ?? renderReportMarkdown(diskReport),
            files: { json: jsonPath, markdown: diskMd !== null ? mdPath : null }
          };
        }
        if (format === 'json') {
          return {
            ok: true,
            report: diskReport,
            files: { json: jsonPath, markdown: diskMd !== null ? mdPath : null }
          };
        }
        return {
          ok: true,
          report: diskReport,
          markdown: diskMd ?? renderReportMarkdown(diskReport),
          files: { json: jsonPath, markdown: diskMd !== null ? mdPath : null }
        };
      }

      if (format === 'markdown' && diskMd !== null) {
        return {
          ok: true,
          markdown: diskMd,
          files: { json: null, markdown: mdPath }
        };
      }

      const { rawDevices, stats, history, dailySnapshots } = loadSnapshot();
      const rangeHasSnapshots = hasSnapshotInRange(dailySnapshots, resolved.startDate, resolved.endDate);
      const built = buildUsageReport({
        granularity: resolved.granularity,
        periodKey: resolved.key,
        stats,
        history,
        devices: rawDevices,
        dailySnapshots,
        timeZone
      });

      const hasLiveOrHistoricalData = built.summary.totalTokens > 0
        || rangeHasSnapshots
        || (resolved.isCurrent && rawDevices.length > 0);

      if (!hasLiveOrHistoricalData) {
        if (isLatestAlias) {
          const existing = sortReportsNewestFirst(scanDiskReports(granularity));
          if (existing.length > 0) {
            const latest = existing[0];
            const latestMd = latest.files.markdown ? fs.readFileSync(latest.files.markdown, 'utf8') : null;
            if (format === 'markdown') {
              return {
                ok: true,
                markdown: latestMd ?? renderReportMarkdown(latest.report),
                files: latest.files
              };
            }
            if (format === 'json') {
              return { ok: true, report: latest.report, files: latest.files };
            }
            return {
              ok: true,
              report: latest.report,
              markdown: latestMd ?? renderReportMarkdown(latest.report),
              files: latest.files
            };
          }
        }
        return { ok: false, error: `Report not found for ${granularity}:${resolved.key}.` };
      }

      if (isLatestAlias && built.summary.totalTokens === 0) {
        const existing = sortReportsNewestFirst(scanDiskReports(granularity));
        if (existing.length > 0) {
          const latest = existing[0];
          const latestMd = latest.files.markdown ? fs.readFileSync(latest.files.markdown, 'utf8') : null;
          if (format === 'markdown') {
            return {
              ok: true,
              markdown: latestMd ?? renderReportMarkdown(latest.report),
              files: latest.files
            };
          }
          if (format === 'json') {
            return { ok: true, report: latest.report, files: latest.files };
          }
          return {
            ok: true,
            report: latest.report,
            markdown: latestMd ?? renderReportMarkdown(latest.report),
            files: latest.files
          };
        }
      }

      if (format === 'markdown') {
        return { ok: true, markdown: renderReportMarkdown(built) };
      }
      if (format === 'json') {
        return { ok: true, report: built };
      }
      return {
        ok: true,
        report: built,
        markdown: renderReportMarkdown(built)
      };
    },

    /**
     * @param {{ granularity?: string, periodKey?: string, force?: boolean, timeZone?: string }} [args]
     */
    async generateReport(args = {}) {
      const rawGranularity = args.granularity;
      /** @type {Array<'daily' | 'weekly' | 'monthly'>} */
      let targets;
      if (rawGranularity === undefined || rawGranularity === 'all') {
        targets = /** @type {Array<'daily' | 'weekly' | 'monthly'>} */ ([...REPORT_GRANULARITIES]);
      } else if (REPORT_GRANULARITIES.includes(String(rawGranularity))) {
        targets = [/** @type {'daily' | 'weekly' | 'monthly'} */ (String(rawGranularity))];
      } else {
        return { ok: false, error: `Invalid granularity: ${String(rawGranularity)}` };
      }

      const periodKey = args.periodKey !== undefined ? String(args.periodKey) : 'current';
      const force = Boolean(args.force);
      const timeZone = nonEmptyString(args.timeZone) || defaultTimeZone || undefined;
      const { rawDevices, stats, history, dailySnapshots } = loadSnapshot();

      /** @type {Array<{ granularity: 'daily' | 'weekly' | 'monthly', report: any }>} */
      const builtReports = [];
      try {
        for (const g of targets) {
          const report = buildUsageReport({
            granularity: g,
            periodKey,
            stats,
            history,
            devices: rawDevices,
            dailySnapshots,
            timeZone
          });
          builtReports.push({ granularity: g, report });
        }
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err)
        };
      }

      const generated = [];
      for (const { granularity: g, report } of builtReports) {
        const jsonPath = path.join(reportsDir, g, `${report.period.key}.json`);
        const mdPath = path.join(reportsDir, g, `${report.period.key}.md`);
        const sig = reportContentSignature(report);
        const existing = fs.existsSync(jsonPath) ? readJson(jsonPath, null) : null;
        const unchanged = !force
          && existing
          && reportContentSignature(existing) === sig
          && fs.existsSync(mdPath);

        if (!unchanged) {
          writeTextAtomic(jsonPath, renderReportJson(report));
          writeTextAtomic(mdPath, renderReportMarkdown(report));
        }

        generated.push({
          reportId: report.reportId,
          granularity: g,
          periodKey: report.period.key,
          written: !unchanged,
          totalTokens: report.summary.totalTokens,
          knownCostUsd: report.summary.knownCostUsd,
          projectCount: report.summary.projectCount,
          files: {
            json: jsonPath,
            markdown: mdPath
          }
        });
      }

      return {
        ok: true,
        generatedAt: new Date().toISOString(),
        reportsDir,
        reports: generated
      };
    },

    /**
     * @param {{ granularity?: string, periodKey?: string, project?: string, limit?: number }} [args]
     */
    async analyzeProjects(args = {}) {
      const granularity = String(args.granularity || 'weekly').trim() || 'weekly';
      if (!REPORT_GRANULARITIES.includes(granularity)) {
        return { ok: false, error: `Invalid granularity: ${granularity}` };
      }
      const periodKey = String(args.periodKey || 'latest').trim() || 'latest';
      const fetched = await this.getReport({ granularity, periodKey, format: 'json' });
      if (!fetched || fetched.ok === false || !fetched.report) {
        return {
          ok: false,
          error: fetched?.error || `Report not found for ${granularity}:${periodKey}.`
        };
      }
      return analyzeProjectUsage(fetched.report, {
        project: args.project,
        limit: args.limit
      });
    },

    async getStats() {
      return loadSnapshot().stats || {};
    },

    async analyzeWithAi() {
      return { ok: false, error: 'analyze_report_with_ai requires Hub HTTP mode or configured Main Hub.' };
    },

    async pushToOpenClaw() {
      return { ok: false, error: 'push_report_to_openclaw requires Hub HTTP mode or configured Main Hub.' };
    },

    async pushEventToOpenClaw() {
      return { ok: false, error: 'push_to_openclaw requires Hub HTTP mode or configured Main Hub.' };
    },

    /**
     * @param {Record<string, any>} [args]
     */
    async queryUsageBreakdown(args = {}) {
      const { rawDevices, stats, history, dailySnapshots, modelAliases, modelAliasGrouping } = loadSnapshot();
      return {
        ok: true,
        ...queryUsageBreakdown({
          stats,
          history,
          devices: rawDevices,
          dailySnapshots,
          period: args.period,
          range: args.range,
          groupBy: args.groupBy,
          deviceId: args.deviceId,
          limit: args.limit,
          modelAliases,
          modelAliasGrouping: args.modelAliasGrouping ?? modelAliasGrouping,
          timeZone: defaultTimeZone || undefined
        })
      };
    },

    /**
     * @param {Record<string, any>} [args]
     */
    async listSessions(args = {}) {
      const { store, stats, integrationsCfg } = loadSnapshot();
      const titlesEnabled = resolveSessionTitlesEnabled(integrationsCfg);
      return {
        ok: true,
        ...listSessionsQuery({
          stats,
          allTimeSessions: options.allTimeSessions ?? store.allTimeSessions ?? null,
          period: args.period,
          state: args.state,
          client: args.client,
          project: args.project,
          deviceId: args.deviceId,
          search: args.search,
          sort: args.sort,
          sortDirection: args.sortDirection,
          limit: args.limit,
          cursor: args.cursor,
          sessionTitlesEnabled: titlesEnabled
        })
      };
    },

    /**
     * @param {Record<string, any>} [args]
     */
    async getSessionDetail(args = {}) {
      const { integrationsCfg } = loadSnapshot();
      const perms = integrationsCfg?.openclaw?.queryPermissions || {};
      const allowDetail = typeof options.allowSessionDetail === 'boolean'
        ? options.allowSessionDetail
        : perms.allowSessionDetail === true;
      const allowConversation = typeof options.allowConversationText === 'boolean'
        ? options.allowConversationText
        : perms.allowConversationText === true;

      if (!allowDetail) {
        return {
          ok: false,
          error: 'session_detail_disabled',
          message: 'Session detail queries are disabled by privacy settings (queryPermissions.allowSessionDetail).'
        };
      }
      const includeConversation = Boolean(args.includeConversation);
      if (includeConversation && !allowConversation) {
        return {
          ok: false,
          error: 'conversation_text_disabled',
          message: 'Conversation text queries are disabled by privacy settings (queryPermissions.allowConversationText).'
        };
      }

      const rawClient = typeof args.client === 'string' ? args.client.trim() : '';
      const client = rawClient ? (normalizeClientName(rawClient) || rawClient.toLowerCase()) : '';
      const sessionId = typeof args.sessionId === 'string' ? args.sessionId.trim() : '';
      if (!client || !sessionId) {
        return { ok: false, error: 'invalid_request', message: 'client and sessionId are required.' };
      }

      const periodRaw = typeof args.period === 'string' ? args.period.trim() : 'total';
      const period = periodRaw === 'allTime' ? 'total' : (periodRaw || 'total');
      let detail;
      if (typeof options.readSessionDetail === 'function') {
        detail = await options.readSessionDetail({
          client,
          sessionId,
          deviceId: args.deviceId,
          period,
          includeConversation,
          limit: args.limit,
          offset: args.offset,
          cursor: args.cursor
        });
      } else {
        // Lazy-load SQLite-backed session readers only on detail requests so stdio startup stays warning-free on Node 22.
        const { resolveSessionDetailForPlatform } = require('../shared/sessionDetailResolver');
        detail = await resolveSessionDetailForPlatform({ client, sessionId, period });
        if (detail?.found && includeConversation && allowConversation) {
          const { readSessionConversation } = require('../shared/sessionConversation');
          const conv = readSessionConversation({ key: `${client}:${sessionId}`, cursor: args.cursor || '' });
          if (conv && !conv.error) detail = { ...detail, conversation: conv };
        }
      }
      if (!detail || detail.found === false) {
        return { ok: false, error: 'not_found', message: `Session detail not found for ${client}:${sessionId}.` };
      }

      const titlesEnabled = resolveSessionTitlesEnabled(integrationsCfg);
      const out = titlesEnabled
        ? { ...detail }
        : stripSessionDetailTitles(detail);
      if (!includeConversation || !allowConversation) {
        delete out.conversation;
        delete out.messages;
        delete out.conversationMessages;
      }
      if (Array.isArray(out.exchanges) && out.totalExchanges === undefined) {
        const totalExchanges = out.exchanges.length;
        const offset = Number.isInteger(args.offset) && args.offset >= 0 ? args.offset : 0;
        const limit = Number.isInteger(args.limit) && args.limit > 0 ? args.limit : 50;
        out.exchanges = out.exchanges.slice(offset, offset + limit);
        out.totalExchanges = totalExchanges;
        out.offset = offset;
        out.limit = limit;
        out.truncated = offset + out.exchanges.length < totalExchanges;
      }
      return { ok: true, ...out };
    },

    /**
     * @param {Record<string, any>} [args]
     */
    async getUsageHistory(args = {}) {
      const { history } = loadSnapshot();
      return {
        ok: true,
        ...queryUsageHistory({
          history,
          resolution: args.resolution,
          from: args.from,
          to: args.to,
          groupBy: args.groupBy,
          limit: args.limit
        })
      };
    },

    /**
     * @param {Record<string, any>} [args]
     */
    async getDevicesAndHealth(args = {}) {
      const { stats } = loadSnapshot();
      return {
        ok: true,
        ...getDevicesAndHealthQuery({
          stats,
          deviceId: args.deviceId,
          includeDiagnostics: args.includeDiagnostics !== false
        })
      };
    },

    /**
     * @param {Record<string, any>} [args]
     */
    async getLimitsHistory(args = {}) {
      const { stats } = loadSnapshot();
      const overview = getLimitsOverviewQuery({
        stats,
        thirdPartyOnly: Boolean(args.thirdPartyOnly),
        provider: args.provider,
        status: args.status,
        maxProviders: args.maxProviders
      });
      if (args.includeHistory === false) {
        return { ok: true, ...overview };
      }
      if (typeof options.getLimitsHistory === 'function') {
        const rawHistory = await options.getLimitsHistory({
          accountKey: args.accountKey,
          provider: args.provider,
          windowName: args.windowName,
          hours: args.hours
        });
        return {
          ok: true,
          ...overview,
          limitsHistory: sanitizeLimitsHistoryPayload({
            available: true,
            ...(rawHistory && typeof rawHistory === 'object' ? rawHistory : { series: rawHistory || [] })
          })
        };
      }
      return {
        ok: true,
        ...overview,
        limitsHistory: {
          available: false,
          reason: 'local_mode_unavailable',
          series: []
        }
      };
    },

    /**
     * @param {Record<string, any>} [args]
     */
    async getSubscriptionsAndForecasts(args = {}) {
      const { stats, subscriptionsDoc } = loadSnapshot();
      return {
        ok: true,
        ...getSubscriptionsAndForecastsQuery({
          subscriptionsDoc,
          stats,
          rates: options.rates,
          date: args.date,
          includeForecasts: args.includeForecasts !== false,
          activeOnly: Boolean(args.activeOnly)
        })
      };
    },

    /**
     * @param {Record<string, any>} [args]
     */
    async getLiveTokenRate(args = {}) {
      const { store, stats } = loadSnapshot();
      return {
        ok: true,
        ...getLiveTokenRateSummary({
          stats,
          liveRateSnapshot: options.liveRateSnapshot ?? store.liveRateSnapshot ?? null,
          deviceId: args.deviceId
        })
      };
    },

    /**
     * @param {Record<string, any>} [args]
     */
    async getServiceStatusAndApprovals(args = {}) {
      const includeResetForecast = args.includeResetForecast !== false;
      const includeApprovals = args.includeApprovals !== false;
      const serviceStatus = typeof options.getServiceStatus === 'function'
        ? { available: true, ...(await options.getServiceStatus({ force: Boolean(args.force), providerIds: args.providerIds })) }
        : { available: false, reason: 'local_mode_unavailable', providers: [] };
      const codexResetForecast = includeResetForecast
        ? (typeof options.getCodexResetForecast === 'function'
          ? { available: true, ...(await options.getCodexResetForecast({ force: Boolean(args.force) })) }
          : { available: false, reason: 'local_mode_unavailable' })
        : undefined;
      const rawAlerts = includeApprovals && typeof options.listApprovalAlerts === 'function'
        ? await options.listApprovalAlerts()
        : null;
      const approvalAlerts = includeApprovals
        ? (rawAlerts && rawAlerts.ok
          ? { available: true, enabled: true, alerts: rawAlerts.alerts || [] }
          : { available: false, enabled: false, alerts: [] })
        : undefined;
      return {
        ok: true,
        checkedAt: new Date().toISOString(),
        serviceStatus,
        ...(includeResetForecast ? { codexResetForecast } : {}),
        ...(includeApprovals ? { approvalAlerts } : {})
      };
    }
  };
}

/**
 * Create a backend adapter in either Hub HTTP mode or Local Store direct mode.
 * @param {object} [options]
 * @param {'hub' | 'local'} [options.mode]
 * @param {string} [options.hubUrl]
 * @param {string} [options.secret]
 * @param {string} [options.caCertPem]
 * @param {string} [options.caCertPath]
 * @param {boolean} [options.requireHttps]
 * @param {number} [options.requestTimeoutMs]
 * @param {typeof globalThis.fetch} [options.fetchImpl]
 * @param {string} [options.dataFile]
 * @param {string} [options.reportsDir]
 * @param {string} [options.timeZone]
 * @param {number} [options.staleAfterMs]
 * @param {boolean} [options.sessionTitlesEnabled]
 * @param {boolean} [options.allowSessionDetail]
 * @param {boolean} [options.allowConversationText]
 * @param {Record<string, any> | null} [options.allTimeSessions]
 * @param {any} [options.liveRateSnapshot]
 * @param {any} [options.subscriptionsDoc]
 * @param {Record<string, number> | null} [options.rates]
 * @param {(args: any) => Promise<any> | any} [options.readSessionDetail]
 * @param {(args: any) => Promise<any> | any} [options.getLimitsHistory]
 * @param {(args: any) => Promise<any> | any} [options.getServiceStatus]
 * @param {(args: any) => Promise<any> | any} [options.getCodexResetForecast]
 * @param {() => Promise<any> | any} [options.listApprovalAlerts]
 */
function createBackendAdapter(options = {}) {
  const mode = options.mode === 'local'
    || (!options.mode && (nonEmptyString(options.dataFile) || nonEmptyString(options.reportsDir)))
    ? 'local'
    : 'hub';

  if (mode === 'local') {
    return createLocalBackendAdapter({
      dataFile: options.dataFile,
      reportsDir: options.reportsDir,
      timeZone: options.timeZone,
      staleAfterMs: options.staleAfterMs,
      sessionTitlesEnabled: options.sessionTitlesEnabled,
      allowSessionDetail: options.allowSessionDetail,
      allowConversationText: options.allowConversationText,
      allTimeSessions: options.allTimeSessions,
      liveRateSnapshot: options.liveRateSnapshot,
      subscriptionsDoc: options.subscriptionsDoc,
      rates: options.rates,
      readSessionDetail: options.readSessionDetail,
      getLimitsHistory: options.getLimitsHistory,
      getServiceStatus: options.getServiceStatus,
      getCodexResetForecast: options.getCodexResetForecast,
      listApprovalAlerts: options.listApprovalAlerts
    });
  }

  return createHubBackendAdapter({
    hubUrl: options.hubUrl,
    secret: options.secret,
    caCertPem: /** @type {any} */ (options).caCertPem,
    caCertPath: /** @type {any} */ (options).caCertPath,
    requireHttps: /** @type {any} */ (options).requireHttps,
    requestTimeoutMs: options.requestTimeoutMs,
    fetchImpl: options.fetchImpl
  });
}

/**
 * Find the first `\r\n\r\n` or `\n\n` header separator in a buffer.
 * @param {Buffer} buf
 * @returns {{ index: number, sepLen: number } | null}
 */
function findHeaderEnd(buf) {
  const crlf = buf.indexOf('\r\n\r\n');
  const lf = buf.indexOf('\n\n');
  if (crlf === -1 && lf === -1) return null;
  if (crlf !== -1 && (lf === -1 || crlf < lf)) {
    return { index: crlf, sepLen: 4 };
  }
  return { index: lf, sepLen: 2 };
}

/**
 * Check whether the leading bytes look like (or could still become) an LSP-style
 * `Content-Length:` / `Content-Type:` header block rather than newline-delimited JSON.
 * @param {Buffer} buf
 * @returns {'header' | 'need_more' | 'ndjson'}
 */
function classifyLeadingFraming(buf) {
  let offset = 0;
  while (offset < buf.length && (buf[offset] === 0x20 || buf[offset] === 0x09)) {
    offset += 1;
  }
  if (offset >= buf.length) return 'need_more';
  const first = buf[offset];
  if (first === 0x7b || first === 0x5b) {
    return 'ndjson';
  }

  const probe = buf.subarray(offset, Math.min(buf.length, offset + 32)).toString('ascii').toLowerCase();
  if (/^(content-length|content-type)\s*:/.test(probe)) {
    return 'header';
  }
  const nlIdx = buf.indexOf(0x0a, offset);
  if (nlIdx === -1 && ('content-length:'.startsWith(probe) || 'content-type:'.startsWith(probe))) {
    return 'need_more';
  }
  return 'ndjson';
}

/**
 * Create a framed stdio transport supporting both newline-delimited JSON
 * (default MCP stdio framing) and `Content-Length: N\r\n\r\n` framing.
 * @param {object} options
 * @param {NodeJS.ReadableStream} [options.input]
 * @param {NodeJS.WritableStream} [options.output]
 * @param {NodeJS.WritableStream} [options.stderr]
 * @param {(payload: string) => Promise<any> | any} options.onPayload
 */
function createStdioMcpTransport({
  input = process.stdin,
  output = process.stdout,
  stderr = process.stderr,
  onPayload
}) {
  if (typeof onPayload !== 'function') {
    throw new TypeError('createStdioMcpTransport requires an onPayload handler.');
  }

  /** @type {Buffer} */
  let buffer = Buffer.alloc(0);
  let started = false;
  let stopped = false;
  let inputEnded = false;
  /** @type {'ndjson' | 'content-length'} */
  let defaultReplyFraming = 'ndjson';
  /** @type {Promise<void>} */
  let queue = Promise.resolve();
  /** @type {(value?: void) => void} */
  let resolveClosed = () => {};
  const closed = new Promise((resolve) => {
    resolveClosed = resolve;
  });

  /**
   * @param {string} text
   */
  function logError(text) {
    try {
      if (stderr && !/** @type {any} */ (stderr).destroyed) {
        stderr.write(`${text}\n`);
      }
    } catch (_) {}
  }

  /**
   * @param {any} payload
   * @param {'ndjson' | 'content-length'} [framing]
   */
  function send(payload, framing = defaultReplyFraming) {
    if (payload === null || payload === undefined || stopped) return;
    const jsonText = JSON.stringify(payload);
    try {
      if (framing === 'content-length') {
        const bodyBuf = Buffer.from(jsonText, 'utf8');
        const frame = Buffer.concat([
          Buffer.from(`Content-Length: ${bodyBuf.length}\r\n\r\n`, 'ascii'),
          bodyBuf
        ]);
        output.write(frame);
      } else {
        output.write(`${jsonText}\n`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logError(`[mcp] failed writing response: ${msg}`);
    }
  }

  /**
   * @param {string} rawPayload
   * @param {'ndjson' | 'content-length'} framing
   */
  function enqueuePayload(rawPayload, framing) {
    queue = queue.then(async () => {
      if (stopped) return;
      try {
        const response = await onPayload(rawPayload);
        if (response !== null && response !== undefined) {
          send(response, framing);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logError(`[mcp] unhandled payload error: ${msg}`);
        send({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: JSON_RPC_ERRORS.INTERNAL_ERROR,
            message: msg || 'Internal error'
          }
        }, framing);
      }
    });
  }

  /**
   * @param {boolean} flushTrailing
   */
  function drainBuffer(flushTrailing) {
    while (buffer.length > 0 && !stopped) {
      let skip = 0;
      while (skip < buffer.length && (buffer[skip] === 0x0d || buffer[skip] === 0x0a)) {
        skip += 1;
      }
      if (skip > 0) {
        buffer = buffer.subarray(skip);
      }
      if (buffer.length === 0) break;

      const kind = classifyLeadingFraming(buffer);
      if (kind === 'need_more') {
        if (!flushTrailing) break;
        const trailing = buffer.toString('utf8').trim();
        buffer = Buffer.alloc(0);
        if (trailing) {
          enqueuePayload(trailing, defaultReplyFraming);
        }
        break;
      }

      if (kind === 'header') {
        const headerEnd = findHeaderEnd(buffer);
        if (!headerEnd) break;
        const headerText = buffer.subarray(0, headerEnd.index).toString('ascii');
        const match = /^content-length:\s*(\d+)/im.exec(headerText);
        if (!match) {
          buffer = buffer.subarray(headerEnd.index + headerEnd.sepLen);
          defaultReplyFraming = 'content-length';
          send({
            jsonrpc: '2.0',
            id: null,
            error: {
              code: JSON_RPC_ERRORS.PARSE_ERROR,
              message: 'Missing or invalid Content-Length header'
            }
          }, 'content-length');
          continue;
        }
        const contentLength = Number(match[1]);
        if (!Number.isInteger(contentLength) || contentLength < 0 || contentLength > MAX_CONTENT_LENGTH_BYTES) {
          buffer = buffer.subarray(headerEnd.index + headerEnd.sepLen);
          defaultReplyFraming = 'content-length';
          send({
            jsonrpc: '2.0',
            id: null,
            error: {
              code: JSON_RPC_ERRORS.PARSE_ERROR,
              message: 'Invalid Content-Length size'
            }
          }, 'content-length');
          continue;
        }
        const bodyStart = headerEnd.index + headerEnd.sepLen;
        if (buffer.length < bodyStart + contentLength) {
          break;
        }
        const bodyText = buffer.subarray(bodyStart, bodyStart + contentLength).toString('utf8');
        buffer = buffer.subarray(bodyStart + contentLength);
        defaultReplyFraming = 'content-length';
        if (bodyText.trim()) {
          enqueuePayload(bodyText, 'content-length');
        }
        continue;
      }

      const nlIndex = buffer.indexOf(0x0a);
      if (nlIndex === -1) {
        if (!flushTrailing) break;
        const finalLine = buffer.toString('utf8').replace(/\r$/, '').trim();
        buffer = Buffer.alloc(0);
        if (finalLine) {
          defaultReplyFraming = 'ndjson';
          enqueuePayload(finalLine, 'ndjson');
        }
        break;
      }

      const line = buffer.subarray(0, nlIndex).toString('utf8').replace(/\r$/, '').trim();
      buffer = buffer.subarray(nlIndex + 1);
      if (line) {
        defaultReplyFraming = 'ndjson';
        enqueuePayload(line, 'ndjson');
      }
    }
  }

  /**
   * @param {Buffer | string} chunk
   */
  function onData(chunk) {
    if (stopped) return;
    const chunkBuf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8');
    if (chunkBuf.length === 0) return;
    buffer = buffer.length === 0 ? chunkBuf : Buffer.concat([buffer, chunkBuf]);
    drainBuffer(false);
  }

  function finish() {
    if (inputEnded) return;
    inputEnded = true;
    drainBuffer(true);
    queue.finally(() => {
      cleanupListeners();
      resolveClosed();
    });
  }

  /**
   * @param {Error} err
   */
  function onInputError(err) {
    logError(`[mcp] input stream error: ${err?.message || err}`);
    finish();
  }

  function cleanupListeners() {
    input.off('data', onData);
    input.off('end', finish);
    input.off('close', finish);
    input.off('error', onInputError);
  }

  function start() {
    if (started || stopped) return;
    started = true;
    input.on('data', onData);
    input.on('end', finish);
    input.on('close', finish);
    input.on('error', onInputError);
    if (typeof /** @type {any} */ (input).resume === 'function') {
      /** @type {any} */ (input).resume();
    }
  }

  async function stop() {
    if (stopped) return closed;
    stopped = true;
    cleanupListeners();
    await queue.catch(() => {});
    resolveClosed();
    return closed;
  }

  return {
    start,
    stop,
    send,
    closed
  };
}

/**
 * Start the standalone MCP stdio server.
 * @param {object} [options]
 * @param {string[]} [options.argv]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {'hub' | 'local'} [options.mode]
 * @param {string} [options.hubUrl]
 * @param {string} [options.secret]
 * @param {string} [options.caCertPem]
 * @param {string} [options.caCertPath]
 * @param {boolean} [options.requireHttps]
 * @param {number} [options.requestTimeoutMs]
 * @param {typeof globalThis.fetch} [options.fetchImpl]
 * @param {string} [options.dataFile]
 * @param {string} [options.reportsDir]
 * @param {string} [options.timeZone]
 * @param {number} [options.staleAfterMs]
 * @param {NodeJS.ReadableStream} [options.input]
 * @param {NodeJS.WritableStream} [options.output]
 * @param {NodeJS.WritableStream} [options.stderr]
 * @param {{ name?: string, version?: string }} [options.serverInfo]
 * @param {boolean} [options.installSignalHandlers]
 */
function startMcpServer(options = {}) {
  const resolved = resolveMcpServerOptions({
    argv: options.argv,
    env: options.env
  });

  const stderr = options.stderr || process.stderr;
  const mode = options.mode || resolved.mode;
  const effectiveHubUrl = options.hubUrl ?? resolved.hubUrl;
  const effectiveRequireHttps = options.requireHttps ?? resolved.requireHttps;
  if (resolved.secretFromArgv) {
    stderr.write('[mcp] Warning: passing --secret on the command line exposes it in process listings. Prefer TOKEN_MONITOR_SECRET or --secret-file.\n');
  }
  if (mode === 'hub' && isInsecureRemoteHttpUrl(effectiveHubUrl) && !effectiveRequireHttps) {
    stderr.write(`[mcp] Warning: Hub URL (${effectiveHubUrl}) uses plain HTTP on a non-loopback host. Use https:// (and --ca-cert if self-signed) or --require-https.\n`);
  }

  const backend = createBackendAdapter({
    mode,
    hubUrl: effectiveHubUrl,
    secret: options.secret ?? resolved.secret,
    caCertPem: options.caCertPem,
    caCertPath: options.caCertPath ?? resolved.caCertPath,
    requireHttps: effectiveRequireHttps,
    requestTimeoutMs: options.requestTimeoutMs,
    fetchImpl: options.fetchImpl,
    dataFile: options.dataFile ?? resolved.dataFile,
    reportsDir: options.reportsDir ?? resolved.reportsDir,
    timeZone: options.timeZone ?? resolved.timeZone,
    staleAfterMs: options.staleAfterMs ?? resolved.staleAfterMs,
    sessionTitlesEnabled: /** @type {any} */ (options).sessionTitlesEnabled,
    allowSessionDetail: /** @type {any} */ (options).allowSessionDetail,
    allowConversationText: /** @type {any} */ (options).allowConversationText,
    allTimeSessions: /** @type {any} */ (options).allTimeSessions,
    liveRateSnapshot: /** @type {any} */ (options).liveRateSnapshot,
    subscriptionsDoc: /** @type {any} */ (options).subscriptionsDoc,
    rates: /** @type {any} */ (options).rates,
    readSessionDetail: /** @type {any} */ (options).readSessionDetail,
    getLimitsHistory: /** @type {any} */ (options).getLimitsHistory,
    getServiceStatus: /** @type {any} */ (options).getServiceStatus,
    getCodexResetForecast: /** @type {any} */ (options).getCodexResetForecast,
    listApprovalAlerts: /** @type {any} */ (options).listApprovalAlerts
  });

  const mcpServer = createMcpReportServer({
    listReports: (args) => backend.listReports(args),
    getReport: (args) => backend.getReport(args),
    generateReport: (args) => backend.generateReport(args),
    analyzeProjects: (args) => backend.analyzeProjects(args),
    getStats: () => backend.getStats(),
    analyzeWithAi: (args) => backend.analyzeWithAi(args),
    pushToOpenClaw: (args) => backend.pushToOpenClaw(args),
    pushEventToOpenClaw: (args) => backend.pushEventToOpenClaw(args),
    queryUsageBreakdown: (args) => backend.queryUsageBreakdown(args),
    listSessions: (args) => backend.listSessions(args),
    getSessionDetail: (args) => backend.getSessionDetail(args),
    getUsageHistory: (args) => backend.getUsageHistory(args),
    getDevicesAndHealth: (args) => backend.getDevicesAndHealth(args),
    getLimitsHistory: (args) => backend.getLimitsHistory(args),
    getSubscriptionsAndForecasts: (args) => backend.getSubscriptionsAndForecasts(args),
    getLiveTokenRate: (args) => backend.getLiveTokenRate(args),
    getServiceStatusAndApprovals: (args) => backend.getServiceStatusAndApprovals(args),
    serverInfo: {
      name: 'token-monitor-reports',
      version: readPackageVersion(),
      ...options.serverInfo
    }
  });

  const transport = createStdioMcpTransport({
    input: options.input || process.stdin,
    output: options.output || process.stdout,
    stderr: options.stderr || process.stderr,
    onPayload: (raw) => mcpServer.handlePayload(raw)
  });

  /** @type {Array<{ signal: NodeJS.Signals, handler: () => void }>} */
  const signalListeners = [];
  let stopped = false;

  async function stop() {
    if (stopped) return transport.closed;
    stopped = true;
    for (const { signal, handler } of signalListeners) {
      process.off(signal, handler);
    }
    signalListeners.length = 0;
    try {
      await /** @type {any} */ (backend).destroy?.();
    } catch (_) {}
    return transport.stop();
  }

  if (options.installSignalHandlers) {
    for (const signal of /** @type {NodeJS.Signals[]} */ (['SIGINT', 'SIGTERM'])) {
      const handler = () => {
        stop().catch(() => {});
      };
      signalListeners.push({ signal, handler });
      process.once(signal, handler);
    }
  }

  transport.start();

  return {
    options: resolved,
    backend,
    mcpServer,
    transport,
    stop,
    closed: transport.closed
  };
}

/**
 * @param {NodeJS.WritableStream} [stderr]
 */
function printUsage(stderr = process.stderr) {
  const usage = [
    'Token Monitor MCP stdio server (usage & project reports)',
    '',
    'Usage:',
    '  node src/mcp/server.js [options]',
    '',
    'Hub HTTP mode (default):',
    '  --hub-url <url>        Hub base URL (default: TOKEN_MONITOR_HUB_URL or http://127.0.0.1:17321)',
    '  --secret <token>       Bearer secret (default: TOKEN_MONITOR_SECRET)',
    '  --secret-file <path>   Read bearer secret from a 0600 file (default: TOKEN_MONITOR_SECRET_FILE)',
    '  --ca-cert <path>       Custom CA certificate PEM/DER for HTTPS Hub (default: TOKEN_MONITOR_CA_CERT)',
    '  --require-https        Refuse plain HTTP to non-loopback Hub (default: TOKEN_MONITOR_REQUIRE_HTTPS)',
    '',
    'Local store direct mode:',
    '  --local              Read local devices.json and reports directory directly',
    '  --data-file <path>   Path to devices.json (default: TOKEN_MONITOR_DATA_FILE or data/devices.json)',
    '  --reports-dir <path> Path to reports directory (default: <dirname(dataFile)>/reports)',
    '  --time-zone <tz>     Optional IANA time zone (default: local system time zone)',
    '  --help, -h           Show this help on stderr and exit'
  ].join('\n');
  stderr.write(`${usage}\n`);
}

if (require.main === module) {
  const cliOptions = resolveMcpServerOptions();
  if (cliOptions.help) {
    printUsage(process.stderr);
    process.exit(0);
  }
  const instance = startMcpServer({ installSignalHandlers: true });
  instance.closed.catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[mcp] fatal error: ${msg}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_HUB_URL,
  resolveMcpServerOptions,
  createHubBackendAdapter,
  createLocalBackendAdapter,
  createBackendAdapter,
  createStdioMcpTransport,
  startMcpServer
};
