// @ts-check
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { readJson, writeJsonAtomic } = require('../shared/config');
const { createOutboundFetch } = require('../shared/outboundFetch');
const { REPORT_GRANULARITIES, reportContentSignature, resolveReportPeriod } = require('../shared/usageReport');
const {
  buildRealtimeOverviewSnapshot,
  extractLimitsSummary,
  formatOpenClawApprovalAlertMessage,
  formatOpenClawQueryDigestMessage,
  formatOpenClawSessionCompletedMessage,
  formatOpenClawWeChatMessage,
  invokeThirdPartyAiAnalysis,
  mergeOpenClawIntegrationConfig,
  normalizeAiIntegrationConfig,
  normalizeOpenClawIntegrationConfig,
  sendToOpenClawWebhook
} = require('../shared/aiReportAnalyzer');
const { createSessionCompletionTracker } = require('../shared/sessionCompletion');
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
const { createWeixinQrLoginManager } = require('../shared/openclawWeixinQr');
const {
  configureOpenClawHost,
  detectOpenClawEnvironment,
  persistWeixinBinding,
  readLocalWeixinTokens,
  readOpenClawHookSecrets
} = require('./openclawProvisioner');

const INTEGRATIONS_CONFIG_VERSION = 1;
const SECRETS_VERSION = 1;
const ANALYSIS_KEY_RE = /^[A-Za-z0-9._-]+$/;
const MAX_PUSH_HISTORY = 50;
const MAX_IDEMPOTENCY_KEYS = 512;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CONCURRENT_OUTBOUND = 4;
const MAX_CUSTOM_MESSAGE_CHARS = 2000;
const MAX_CUSTOM_RESULT_BYTES = 32 * 1024;
const DEFAULT_APPROVAL_WEBHOOK_WINDOW_MS = 60_000;
const DEFAULT_APPROVAL_WEBHOOK_PER_DEVICE = 5;
const DEFAULT_APPROVAL_WEBHOOK_GLOBAL = 20;

/**
 * Extract normalized `scheme://host[:port]` origin from an HTTP(S) URL, or empty string.
 * @param {any} rawUrl
 * @returns {string}
 */
function urlOrigin(rawUrl) {
  const s = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  if (!s) return '';
  try {
    return new URL(s).origin.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Truncate arbitrary `params.result` payloads to `<= maxBytes` UTF-8 before redaction or forwarding.
 * @param {any} value
 * @param {number} [maxBytes]
 * @returns {any}
 */
function boundCustomResultPayload(value, maxBytes = MAX_CUSTOM_RESULT_BYTES) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return Buffer.byteLength(value, 'utf8') > maxBytes
      ? value.slice(0, maxBytes)
      : value;
  }
  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized !== 'string' || Buffer.byteLength(serialized, 'utf8') <= maxBytes) {
      return value;
    }
    return {
      truncated: true,
      preview: serialized.slice(0, Math.min(2000, maxBytes))
    };
  } catch {
    return { truncated: true, preview: String(value).slice(0, 2000) };
  }
}
const QUERY_PUSH_TYPES = new Set([
  'report',
  'usage',
  'sessions',
  'session_detail',
  'history',
  'devices',
  'limits',
  'subscriptions',
  'live_rate',
  'service_status',
  'test',
  'custom'
]);
/** @type {readonly ('aiApiKey' | 'openclawHookToken' | 'weixinBotToken')[]} */
const SECRET_KEYS = Object.freeze(['aiApiKey', 'openclawHookToken', 'weixinBotToken']);

/**
 * @param {string} filePath
 * @returns {string}
 */
function readPrivateTextNoFollow(filePath) {
  const noFollow = fs.constants.O_NOFOLLOW || 0;
  let fd = null;
  try {
    if (!noFollow) {
      const stat = fs.lstatSync(filePath);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Integration secrets must be a regular file');
    }
    fd = fs.openSync(filePath, fs.constants.O_RDONLY | noFollow);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new Error('Integration secrets must be a regular file');
    if (process.platform !== 'win32') {
      try { fs.fchmodSync(fd, 0o600); } catch (_) {}
    }
    return fs.readFileSync(fd, 'utf8');
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch (_) {}
    }
  }
}

/**
 * @param {string} filePath
 * @param {any} value
 */
function writePrivateJson(filePath, value) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true, ...(process.platform === 'win32' ? {} : { mode: 0o700 }) });
  if (process.platform !== 'win32') {
    try { fs.chmodSync(dir, 0o700); } catch (_) {}
  }
  const tmpPath = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  let fd = -1;
  try {
    if (process.platform === 'win32') {
      fs.writeFileSync(tmpPath, payload, { encoding: 'utf8', flag: 'wx' });
    } else {
      fd = fs.openSync(tmpPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
      fs.writeFileSync(fd, payload, 'utf8');
      try { fs.fchmodSync(fd, 0o600); } catch (_) {}
      try { fs.fsyncSync(fd); } catch (_) {}
      fs.closeSync(fd);
      fd = -1;
    }
    fs.renameSync(tmpPath, filePath);
  } catch (error) {
    if (fd >= 0) {
      try { fs.closeSync(fd); } catch (_) {}
    }
    try { fs.unlinkSync(tmpPath); } catch (_) {}
    throw error;
  }
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
 * @returns {string}
 */
function cleanSecret(value) {
  return typeof value === 'string' ? value.trim().slice(0, 4096) : '';
}

/**
 * @param {string} secretsPath
 * @param {{ error?: (...args: any[]) => void }} [logger]
 * @returns {{ aiApiKey: string, openclawHookToken: string, weixinBotToken: string }}
 */
function readIntegrationSecretsFile(secretsPath, logger = console) {
  try {
    const raw = readPrivateTextNoFollow(secretsPath);
    const parsed = JSON.parse(raw);
    return {
      aiApiKey: cleanSecret(parsed?.aiApiKey),
      openclawHookToken: cleanSecret(parsed?.openclawHookToken),
      weixinBotToken: cleanSecret(parsed?.weixinBotToken)
    };
  } catch (error) {
    if (/** @type {any} */ (error)?.code === 'ENOENT') {
      return { aiApiKey: '', openclawHookToken: '', weixinBotToken: '' };
    }
    (typeof logger?.error === 'function' ? logger.error.bind(logger) : console.error)(
      error,
      'failed to read integration secrets'
    );
    return { aiApiKey: '', openclawHookToken: '', weixinBotToken: '' };
  }
}

/**
 * Synchronize secret updates/clears into `<reportsDir>/integrations.secrets.json` even when the
 * embedded Hub is stopped (e.g., so cleared keys do not resurrect when the Hub starts later).
 * @param {string} dataFile
 * @param {{ aiApiKey?: string, openclawHookToken?: string, weixinBotToken?: string }} [secretPatch]
 * @param {string} [reportsDir]
 * @param {{ error?: (...args: any[]) => void }} [logger]
 */
function syncIntegrationSecretsFile(dataFile, secretPatch = {}, reportsDir = '', logger = console) {
  const resolvedReportsDir = String(reportsDir || '').trim() || path.join(path.dirname(dataFile), 'reports');
  const secretsPath = path.join(resolvedReportsDir, 'integrations.secrets.json');
  const current = readIntegrationSecretsFile(secretsPath, logger);
  if (!isPlainObject(secretPatch)) return current;

  let changed = false;
  const next = { ...current };
  for (const key of SECRET_KEYS) {
    if (!Object.hasOwn(secretPatch, key)) continue;
    const val = cleanSecret(/** @type {any} */ (secretPatch)[key]);
    if (val !== next[key]) {
      next[key] = val;
      changed = true;
    }
  }
  if (changed) {
    writePrivateJson(secretsPath, {
      version: SECRETS_VERSION,
      ...next
    });
  }
  return next;
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
function readEnvIntegrationsDefaults(env = process.env) {
  return {
    config: {
      ai: {
        enabled: /^(?:1|true|yes|on)$/i.test(String(env.TOKEN_MONITOR_AI_ENABLED || '')),
        protocol: env.TOKEN_MONITOR_AI_PROTOCOL || undefined,
        providerLabel: env.TOKEN_MONITOR_AI_PROVIDER || undefined,
        baseUrl: env.TOKEN_MONITOR_AI_BASE_URL || undefined,
        model: env.TOKEN_MONITOR_AI_MODEL || undefined,
        language: env.TOKEN_MONITOR_AI_LANGUAGE || undefined,
        customPrompt: env.TOKEN_MONITOR_AI_PROMPT || undefined,
        autoAnalyzeOnRollover: /^(?:1|true|yes|on)$/i.test(String(env.TOKEN_MONITOR_AI_AUTO_ANALYZE || ''))
      },
      openclaw: {
        enabled: /^(?:1|true|yes|on)$/i.test(String(env.TOKEN_MONITOR_OPENCLAW_ENABLED || '')),
        mode: env.TOKEN_MONITOR_OPENCLAW_MODE || undefined,
        webhookUrl: env.TOKEN_MONITOR_OPENCLAW_WEBHOOK_URL || undefined,
        channel: env.TOKEN_MONITOR_OPENCLAW_CHANNEL || undefined,
        to: env.TOKEN_MONITOR_OPENCLAW_TO || undefined,
        agentId: env.TOKEN_MONITOR_OPENCLAW_AGENT_ID || undefined,
        senderName: env.TOKEN_MONITOR_OPENCLAW_SENDER_NAME || undefined,
        deliver: env.TOKEN_MONITOR_OPENCLAW_DELIVER === undefined
          ? undefined
          : !/^(?:0|false|no|off)$/i.test(String(env.TOKEN_MONITOR_OPENCLAW_DELIVER)),
        pushOnRollover: /^(?:1|true|yes|on)$/i.test(String(env.TOKEN_MONITOR_OPENCLAW_PUSH_ON_ROLLOVER || ''))
      }
    },
    secrets: {
      aiApiKey: cleanSecret(env.TOKEN_MONITOR_AI_API_KEY),
      openclawHookToken: cleanSecret(env.TOKEN_MONITOR_OPENCLAW_TOKEN || env.TOKEN_MONITOR_OPENCLAW_HOOK_TOKEN),
      weixinBotToken: ''
    }
  };
}

/**
 * @param {any} value
 * @param {string[]} [secretValues]
 * @returns {string}
 */
function redactPushText(value, secretValues = []) {
  if (typeof value !== 'string' || !value) return '';
  let out = value;
  for (const sec of secretValues) {
    if (typeof sec === 'string' && sec.length >= 4) {
      out = out.split(sec).join('[REDACTED]');
    }
  }
  out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]');
  out = out.replace(/\b(?:Bearer\s+[A-Za-z0-9._-]{6,}|sk-[A-Za-z0-9_-]{8,}|gh[pou]_[A-Za-z0-9_-]{8,}|github_pat_[A-Za-z0-9_]{8,}|xox[baprs]-[A-Za-z0-9-]{8,}|AIza[A-Za-z0-9_-]{16,}|ya29\.[A-Za-z0-9._-]{8,})\b/gi, '[REDACTED]');
  return out.replace(/[\x00-\x1f\x7f]+/g, ' ').trim();
}

/**
 * @param {string} eventType
 * @param {string} text
 * @param {any} payload
 * @param {string} explicitSummary
 * @param {string[]} secretValues
 * @returns {string}
 */
function derivePushSummary(eventType, text, payload, explicitSummary, secretValues) {
  if (typeof explicitSummary === 'string' && explicitSummary.trim()) {
    return redactPushText(explicitSummary, secretValues).slice(0, 200);
  }
  if (typeof text === 'string' && text.trim()) {
    const firstLine = text.trim().split(/\r?\n/)[0] || '';
    return redactPushText(firstLine, secretValues).slice(0, 200);
  }
  if (isPlainObject(payload)) {
    const candidate = payload.summary || payload.message || payload.title || payload.queryType || '';
    if (typeof candidate === 'string' && candidate.trim()) {
      return redactPushText(candidate, secretValues).slice(0, 200);
    }
  }
  return eventType;
}

/**
 * @param {any} raw
 * @param {string[]} secretValues
 */
function normalizePushHistoryEntry(raw, secretValues) {
  if (!isPlainObject(raw) || typeof raw.at !== 'string' || !raw.at) return null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : crypto.randomUUID(),
    at: raw.at,
    eventType: typeof raw.eventType === 'string' && raw.eventType ? raw.eventType : 'custom',
    ok: raw.ok === true,
    statusCode: Number.isInteger(raw.statusCode) ? raw.statusCode : null,
    error: raw.ok === true ? null : (typeof raw.error === 'string' && raw.error ? raw.error : 'push_failed'),
    message: raw.ok === true ? null : (typeof raw.message === 'string' && raw.message ? redactPushText(raw.message, secretValues).slice(0, 300) : null),
    channel: typeof raw.channel === 'string' ? raw.channel : '',
    mode: typeof raw.mode === 'string' ? raw.mode : '',
    source: typeof raw.source === 'string' && raw.source ? raw.source : 'hub',
    summary: typeof raw.summary === 'string' && raw.summary ? redactPushText(raw.summary, secretValues).slice(0, 200) : null,
    idempotencyKey: typeof raw.idempotencyKey === 'string' && raw.idempotencyKey ? raw.idempotencyKey.slice(0, 160) : null
  };
}

/**
 * Strip title fields from a session detail response when sessionTitlesEnabled is false.
 * @param {any} detail
 * @param {boolean} sessionTitlesEnabled
 */
function sanitizeSessionDetailForTitles(detail, sessionTitlesEnabled) {
  if (!isPlainObject(detail) || sessionTitlesEnabled !== false) return detail;
  const copy = { ...detail };
  delete copy.title;
  delete copy.sessionTitle;
  delete copy.rawTitle;
  if (typeof copy.label === 'string') {
    copy.label = copy.projectLabel || copy.sessionId || '';
  }
  return copy;
}

/**
 * Extract a sanitized summary object from readSessionDetail output for completion notifications.
 * @param {any} detail
 * @param {string[]} secretValues
 */
function buildCompletionDetailSummary(detail, secretValues) {
  if (!isPlainObject(detail) || detail.found === false) return null;
  const exchanges = Array.isArray(detail.exchanges) ? detail.exchanges : [];
  const lastEx = exchanges.at(-1) || null;
  const tools = Array.isArray(lastEx?.tools)
    ? lastEx.tools.map((/** @type {any} */ t) => String(t || '').trim()).filter(Boolean).slice(0, 8)
    : [];
  const lastPrompt = typeof lastEx?.promptPreview === 'string' && lastEx.promptPreview.trim()
    ? redactPushText(lastEx.promptPreview, secretValues).slice(0, 240)
    : '';
  if (exchanges.length === 0 && tools.length === 0 && !lastPrompt) return null;
  return {
    exchangeCount: exchanges.length,
    tools,
    ...(lastPrompt ? { lastPrompt } : {})
  };
}

/**
 * Create Hub integration manager for Third-Party AI API & OpenClaw WeChat delivery.
 * @param {{
 *   dataFile: string,
 *   reportsDir?: string,
 *   reportManager: any,
 *   getStats: () => any,
 *   getHistory?: (() => any) | null,
 *   getSubscriptions?: (() => any) | null,
 *   getQueryContext?: (() => Promise<any> | any) | null,
 *   executeQuery?: ((queryType: string, params: any, openclawConfig: any) => Promise<any> | any) | null,
 *   sessionTitlesEnabled?: boolean | (() => boolean),
 *   initialConfig?: any,
 *   initialSecrets?: { aiApiKey?: string, openclawHookToken?: string, weixinBotToken?: string } | null,
 *   openclawOptions?: any,
 *   fetchImpl?: typeof fetch,
 *   allowPrivateTargets?: boolean,
 *   dnsLookup?: (hostname: string, options: { all: true, verbatim: true }) => Promise<Array<{ address: string, family?: number }>>,
 *   maxConcurrentOutbound?: number,
 *   approvalWebhookRateLimit?: { windowMs?: number, perDevice?: number, global?: number },
 *   now?: () => Date,
 *   logger?: { error?: (...args: any[]) => void, warn?: (...args: any[]) => void, log?: (...args: any[]) => void }
 * }} options
 */
function createIntegrationManager({
  dataFile,
  reportsDir,
  reportManager,
  getStats,
  getHistory = null,
  getSubscriptions = null,
  getQueryContext = null,
  executeQuery = null,
  sessionTitlesEnabled = true,
  initialConfig = null,
  initialSecrets = null,
  openclawOptions = null,
  fetchImpl,
  allowPrivateTargets = undefined,
  dnsLookup = undefined,
  maxConcurrentOutbound = MAX_CONCURRENT_OUTBOUND,
  approvalWebhookRateLimit = undefined,
  now = () => new Date(),
  logger = console
}) {
  const resolvedReportsDir = String(reportsDir || '').trim() || path.join(path.dirname(dataFile), 'reports');
  const configPath = path.join(resolvedReportsDir, 'integrations.json');
  const secretsPath = path.join(resolvedReportsDir, 'integrations.secrets.json');
  const statePath = path.join(resolvedReportsDir, 'integrations-state.json');
  const aiAnalysisDir = path.join(resolvedReportsDir, 'ai-analysis');
  const logError = typeof logger?.error === 'function' ? logger.error.bind(logger) : console.error;
  const hasCustomFetch = typeof fetchImpl === 'function';
  const httpFetch = hasCustomFetch ? fetchImpl : createOutboundFetch();
  const outboundSafetyOptions = {
    allowPrivateTargets,
    dnsLookup,
    enforceDnsLookup: typeof dnsLookup === 'function' || !hasCustomFetch
  };
  const resolvedMaxOutbound = Number.isInteger(maxConcurrentOutbound) && maxConcurrentOutbound >= 1
    ? maxConcurrentOutbound
    : MAX_CONCURRENT_OUTBOUND;
  const rateLimitInput = isPlainObject(approvalWebhookRateLimit) ? approvalWebhookRateLimit : {};
  const rawWindowMs = Number(rateLimitInput?.windowMs);
  const rawPerDevice = Number(rateLimitInput?.perDevice);
  const rawGlobal = Number(rateLimitInput?.global);
  const webhookRateCfg = {
    windowMs: Number.isFinite(rawWindowMs) && rawWindowMs > 0
      ? rawWindowMs
      : DEFAULT_APPROVAL_WEBHOOK_WINDOW_MS,
    perDevice: Number.isInteger(rawPerDevice) && rawPerDevice >= 1
      ? rawPerDevice
      : DEFAULT_APPROVAL_WEBHOOK_PER_DEVICE,
    global: Number.isInteger(rawGlobal) && rawGlobal >= 1
      ? rawGlobal
      : DEFAULT_APPROVAL_WEBHOOK_GLOBAL
  };
  let activeOutbound = 0;
  /** @type {Map<string, number[]>} */
  const approvalWebhookByDevice = new Map();
  /** @type {number[]} */
  let approvalWebhookGlobal = [];
  const resolvedOpenClawOpts = isPlainObject(openclawOptions) ? openclawOptions : {};

  const envDefaults = readEnvIntegrationsDefaults();
  const persistedConfig = readJson(configPath, null);
  const persistedState = readJson(statePath, null);

  const fileSecrets = readIntegrationSecretsFile(secretsPath, logger);
  const initSecretsObj = isPlainObject(initialSecrets) ? initialSecrets : null;
  const hasExplicitInitSecret = (/** @type {'aiApiKey' | 'openclawHookToken' | 'weixinBotToken'} */ key) => (
    Boolean(initSecretsObj && Object.hasOwn(initSecretsObj, key))
  );
  let secrets = {
    aiApiKey: hasExplicitInitSecret('aiApiKey')
      ? cleanSecret(initSecretsObj?.aiApiKey)
      : (fileSecrets.aiApiKey || envDefaults.secrets.aiApiKey),
    openclawHookToken: hasExplicitInitSecret('openclawHookToken')
      ? cleanSecret(initSecretsObj?.openclawHookToken)
      : (fileSecrets.openclawHookToken || envDefaults.secrets.openclawHookToken),
    weixinBotToken: hasExplicitInitSecret('weixinBotToken')
      ? cleanSecret(initSecretsObj?.weixinBotToken)
      : fileSecrets.weixinBotToken
  };

  const currentSecretValues = () => [secrets.aiApiKey, secrets.openclawHookToken, secrets.weixinBotToken].filter(Boolean);

  let config = {
    ai: normalizeAiIntegrationConfig(initialConfig?.ai ?? persistedConfig?.ai ?? envDefaults.config.ai),
    openclaw: normalizeOpenClawIntegrationConfig(initialConfig?.openclaw ?? persistedConfig?.openclaw ?? envDefaults.config.openclaw)
  };

  const initialHistory = Array.isArray(persistedState?.pushHistory)
    ? persistedState.pushHistory
      .map((/** @type {any} */ entry) => normalizePushHistoryEntry(entry, currentSecretValues()))
      .filter(Boolean)
      .slice(0, MAX_PUSH_HISTORY)
    : [];

  let state = {
    lastPush: isPlainObject(persistedState?.lastPush) ? persistedState.lastPush : (initialHistory[0] || null),
    pushHistory: initialHistory
  };

  /** @type {Map<string, number>} */
  const succeededIdempotency = new Map();
  /** @type {Map<string, Promise<any>>} */
  const inFlightDispatches = new Map();
  const startupNowMs = now().getTime();
  for (let i = state.pushHistory.length - 1; i >= 0; i -= 1) {
    const entry = state.pushHistory[i];
    if (entry.ok === true && entry.idempotencyKey) {
      const parsedAt = Date.parse(entry.at);
      const ts = Number.isFinite(parsedAt) ? parsedAt : startupNowMs;
      if (startupNowMs - ts <= IDEMPOTENCY_TTL_MS) {
        succeededIdempotency.set(entry.idempotencyKey, ts);
      }
    }
  }

  /**
   * @param {number} currentMs
   */
  function pruneIdempotencyWindow(currentMs) {
    for (const [key, ts] of succeededIdempotency.entries()) {
      if (currentMs - ts > IDEMPOTENCY_TTL_MS) {
        succeededIdempotency.delete(key);
      }
    }
    while (succeededIdempotency.size > MAX_IDEMPOTENCY_KEYS) {
      const oldestKey = succeededIdempotency.keys().next().value;
      if (oldestKey === undefined) break;
      succeededIdempotency.delete(oldestKey);
    }
  }

  /** @type {Set<Promise<any>>} */
  const pendingTasks = new Set();
  /** @type {any} */
  let completionTracker = null;
  let stopped = false;

  /**
   * @template T
   * @param {Promise<T>} promise
   * @returns {Promise<T>}
   */
  function trackTask(promise) {
    pendingTasks.add(promise);
    return promise.finally(() => {
      pendingTasks.delete(promise);
    });
  }

  function saveConfig() {
    writeJsonAtomic(configPath, {
      version: INTEGRATIONS_CONFIG_VERSION,
      ai: config.ai,
      openclaw: config.openclaw
    }, 2);
  }

  function saveSecrets() {
    writePrivateJson(secretsPath, {
      version: SECRETS_VERSION,
      aiApiKey: secrets.aiApiKey,
      openclawHookToken: secrets.openclawHookToken,
      weixinBotToken: secrets.weixinBotToken
    });
  }

  // Keep disk secrets aligned if initialSecrets explicitly cleared stale persisted keys.
  if (
    isPlainObject(initialSecrets)
    && SECRET_KEYS.some((key) => hasExplicitInitSecret(key) && secrets[key] !== fileSecrets[key])
  ) {
    try {
      saveSecrets();
    } catch (error) {
      logError(error, 'failed to synchronize initial integration secrets');
    }
  }

  function saveState() {
    writeJsonAtomic(statePath, {
      version: 1,
      lastPush: state.lastPush,
      pushHistory: state.pushHistory
    }, 2);
  }

  const qrManager = createWeixinQrLoginManager({
    fetchImpl: httpFetch,
    getLocalTokens: () => {
      const fromOpenClaw = readLocalWeixinTokens(resolvedOpenClawOpts);
      return secrets.weixinBotToken
        ? [...fromOpenClaw, secrets.weixinBotToken]
        : fromOpenClaw;
    },
    logger,
    now,
    ...(typeof resolvedOpenClawOpts.ilinkBaseUrl === 'string' ? { ilinkBaseUrl: resolvedOpenClawOpts.ilinkBaseUrl } : {}),
    ...(typeof resolvedOpenClawOpts.botType === 'string' ? { botType: resolvedOpenClawOpts.botType } : {}),
    ...(resolvedOpenClawOpts.pollTimeoutMs ? { pollTimeoutMs: resolvedOpenClawOpts.pollTimeoutMs } : {})
  });

  /**
   * @param {string} granularity
   * @param {string} periodKey
   */
  function analysisFilePath(granularity, periodKey) {
    if (!REPORT_GRANULARITIES.includes(/** @type {any} */ (granularity)) || !ANALYSIS_KEY_RE.test(String(periodKey || ''))) {
      return '';
    }
    return path.join(aiAnalysisDir, granularity, `${periodKey}.json`);
  }

  /**
   * @param {string} granularity
   * @param {string} periodKey
   * @param {any} [reportObj]
   */
  function readCachedAnalysis(granularity, periodKey, reportObj = null) {
    const filePath = analysisFilePath(granularity, periodKey);
    if (!filePath || !fs.existsSync(filePath)) return null;
    const parsed = readJson(filePath, null);
    if (!isPlainObject(parsed) || typeof parsed.summaryMarkdown !== 'string' || !parsed.summaryMarkdown.trim()) {
      return null;
    }
    const currentSignature = reportObj ? reportContentSignature(reportObj) : '';
    return {
      ...parsed,
      ...(currentSignature && parsed.basedOnSignature
        ? { stale: parsed.basedOnSignature !== currentSignature }
        : { stale: false })
    };
  }

  /**
   * @param {string} granularity
   * @param {string} periodKey
   * @param {any} analysis
   */
  function writeCachedAnalysis(granularity, periodKey, analysis) {
    const filePath = analysisFilePath(granularity, periodKey);
    if (!filePath) return;
    writeJsonAtomic(filePath, analysis, 2);
  }

  function getStatus() {
    return {
      ai: {
        ...config.ai,
        apiKeyConfigured: Boolean(secrets.aiApiKey)
      },
      openclaw: {
        ...config.openclaw,
        hookTokenConfigured: Boolean(secrets.openclawHookToken),
        weixinBotConfigured: Boolean(secrets.weixinBotToken)
      },
      lastPush: state.lastPush
    };
  }

  /**
   * In-process only for Desktop Host CredentialStore synchronization. Never expose over HTTP.
   */
  function getSecrets() {
    return { ...secrets };
  }

  /**
   * Run an outbound AI/webhook call under the bounded concurrency semaphore.
   * @template T
   * @param {() => Promise<T>} fn
   * @returns {Promise<T | { ok: false, statusCode: number, error: string, message: string }>}
   */
  async function runWithOutboundSlot(fn) {
    if (activeOutbound >= resolvedMaxOutbound) {
      return {
        ok: false,
        statusCode: 429,
        error: 'too_many_outbound_requests',
        message: `Too many concurrent outbound integration requests (max ${resolvedMaxOutbound}).`
      };
    }
    activeOutbound += 1;
    try {
      return await fn();
    } finally {
      activeOutbound -= 1;
    }
  }

  /**
   * Sliding-window rate limit check for approval-alert outbound webhooks.
   * @param {string} deviceId
   * @param {number} currentMs
   * @returns {boolean}
   */
  function consumeApprovalWebhookQuota(deviceId, currentMs) {
    const cutoff = currentMs - webhookRateCfg.windowMs;
    approvalWebhookGlobal = approvalWebhookGlobal.filter((ts) => ts > cutoff);
    if (approvalWebhookGlobal.length >= webhookRateCfg.global) {
      return false;
    }
    const key = String(deviceId || 'unknown').trim() || 'unknown';
    const prevList = approvalWebhookByDevice.get(key) || [];
    const recent = prevList.filter((ts) => ts > cutoff);
    if (recent.length >= webhookRateCfg.perDevice) {
      approvalWebhookByDevice.set(key, recent);
      return false;
    }
    recent.push(currentMs);
    approvalWebhookByDevice.set(key, recent);
    approvalWebhookGlobal.push(currentMs);
    // Keep device map bounded even under high churn.
    if (approvalWebhookByDevice.size > 256) {
      for (const [dev, list] of approvalWebhookByDevice) {
        const active = list.filter((ts) => ts > cutoff);
        if (active.length === 0) approvalWebhookByDevice.delete(dev);
        else approvalWebhookByDevice.set(dev, active);
      }
    }
    return true;
  }

  /**
   * @param {any} patch
   * @param {{ allowQueryPermissionMutation?: boolean }} [options]
   */
  function updateConfig(patch = {}, options = {}) {
    if (!isPlainObject(patch)) {
      return { ok: false, error: 'invalid_request', message: 'Integrations patch must be an object' };
    }

    const allowQueryPermissionMutation = options?.allowQueryPermissionMutation === true;
    let configChanged = false;
    let secretsChanged = false;

    if (isPlainObject(patch.ai)) {
      const prevAiOrigin = urlOrigin(config.ai.baseUrl);
      const mergedAi = { ...config.ai, ...patch.ai };
      delete mergedAi.apiKey;
      delete mergedAi.apiKeyConfigured;
      delete mergedAi.clearApiKey;
      config.ai = normalizeAiIntegrationConfig(mergedAi);
      const nextAiOrigin = urlOrigin(config.ai.baseUrl);
      configChanged = true;

      const hasNewApiKey = typeof patch.ai.apiKey === 'string' && patch.ai.apiKey.trim().length > 0;
      if (patch.ai.clearApiKey === true) {
        if (secrets.aiApiKey) {
          secrets.aiApiKey = '';
          secretsChanged = true;
        }
      } else if (hasNewApiKey) {
        secrets.aiApiKey = cleanSecret(patch.ai.apiKey);
        secretsChanged = true;
      } else if (nextAiOrigin !== prevAiOrigin && secrets.aiApiKey) {
        // Clear stored API key whenever the destination origin changes without a new explicit key.
        secrets.aiApiKey = '';
        secretsChanged = true;
      }
    }

    if (isPlainObject(patch.openclaw)) {
      const prevOcOrigin = urlOrigin(config.openclaw.webhookUrl);
      const sanitizedPatch = { ...patch.openclaw };
      delete sanitizedPatch.hookToken;
      delete sanitizedPatch.hookTokenConfigured;
      delete sanitizedPatch.weixinBotConfigured;
      delete sanitizedPatch.clearHookToken;
      delete sanitizedPatch.localBridgeToken;
      delete sanitizedPatch.localBridgeTokenConfigured;
      if (!allowQueryPermissionMutation) {
        delete sanitizedPatch.queryPermissions;
      }
      config.openclaw = mergeOpenClawIntegrationConfig(config.openclaw, sanitizedPatch);
      const nextOcOrigin = urlOrigin(config.openclaw.webhookUrl);
      configChanged = true;

      const hasNewHookToken = typeof patch.openclaw.hookToken === 'string' && patch.openclaw.hookToken.trim().length > 0;
      if (patch.openclaw.clearHookToken === true) {
        if (secrets.openclawHookToken) {
          secrets.openclawHookToken = '';
          secretsChanged = true;
        }
      } else if (hasNewHookToken) {
        secrets.openclawHookToken = cleanSecret(patch.openclaw.hookToken);
        secretsChanged = true;
      } else if (nextOcOrigin !== prevOcOrigin && secrets.openclawHookToken) {
        // Clear stored hook token whenever the destination origin changes without a new explicit token.
        secrets.openclawHookToken = '';
        secretsChanged = true;
      }
      syncCompletionTrackerOptions();
    }

    if (configChanged) saveConfig();
    if (secretsChanged) saveSecrets();

    return { ok: true, ...getStatus() };
  }

  /**
   * Synchronize in-memory/persisted secrets from Desktop CredentialStore on startup or save.
   * @param {{ aiApiKey?: string | null, openclawHookToken?: string | null, weixinBotToken?: string | null }} nextSecrets
   */
  function setSecrets(nextSecrets = {}) {
    if (!isPlainObject(nextSecrets)) return;
    let changed = false;
    for (const key of SECRET_KEYS) {
      if (nextSecrets[key] === undefined) continue;
      const val = cleanSecret(nextSecrets[key]);
      if (val !== secrets[key]) {
        secrets[key] = val;
        changed = true;
      }
    }
    if (changed) saveSecrets();
  }

  /**
   * @param {{
   *   granularity?: string,
   *   periodKey?: string,
   *   question?: string,
   *   language?: string,
   *   refresh?: boolean
   * }} [options]
   */
  async function analyzeReport({
    granularity = 'daily',
    periodKey = 'latest',
    question = '',
    language,
    refresh = false
  } = {}) {
    if (stopped) {
      return { ok: false, error: 'hub_stopped', message: 'Hub is stopping.' };
    }
    if (!config.ai.enabled) {
      return { ok: false, error: 'ai_disabled', message: 'Third-party AI analysis is disabled.' };
    }
    if (!reportManager || typeof reportManager.getReport !== 'function') {
      return { ok: false, error: 'report_manager_unavailable', message: 'Report archive is unavailable.' };
    }
    const fetched = reportManager.getReport(granularity, periodKey, { format: 'json' });
    if (!fetched || fetched.ok === false || !fetched.report) {
      return {
        ok: false,
        error: fetched?.error || 'not_found',
        message: fetched?.message || 'No usage data or persisted report is available yet for this period.'
      };
    }

    const report = fetched.report;
    const cleanQuestion = typeof question === 'string' ? question.trim() : '';
    const resolvedKey = report.period?.key || periodKey;

    if (!refresh && !cleanQuestion) {
      const cached = readCachedAnalysis(report.granularity, resolvedKey, report);
      if (cached && !cached.stale) {
        return {
          ok: true,
          cached: true,
          reportId: report.reportId,
          aiAnalysis: cached
        };
      }
    }

    const stats = getStats();
    const result = await trackTask(runWithOutboundSlot(() => invokeThirdPartyAiAnalysis({
      config: config.ai,
      apiKey: secrets.aiApiKey,
      report,
      stats,
      question: cleanQuestion,
      language: language || config.ai.language,
      fetchImpl: httpFetch,
      ...outboundSafetyOptions,
      now
    })));

    if (!result.ok) return result;
    if (!cleanQuestion) {
      try {
        writeCachedAnalysis(report.granularity, resolvedKey, result.analysis);
      } catch (error) {
        logError(error, `failed to cache AI analysis for ${report.reportId}`);
      }
    }
    return {
      ok: true,
      cached: false,
      reportId: report.reportId,
      aiAnalysis: {
        ...result.analysis,
        stale: false
      }
    };
  }

  /**
   * @param {{
   *   granularity?: string,
   *   periodKey?: string,
   *   includeAi?: boolean,
   *   includeLimits?: boolean
   * }} [options]
   */
  function buildWeChatBrief({
    granularity = 'daily',
    periodKey = 'latest',
    includeAi = true,
    includeLimits = true
  } = {}) {
    const stats = getStats();
    const limitsSummary = includeLimits ? extractLimitsSummary(stats) : null;
    const fetched = reportManager.getReport(granularity, periodKey, { format: 'json' });
    if (!fetched || fetched.ok === false || !fetched.report) {
      return {
        ok: false,
        error: fetched?.error || 'not_found',
        ...(fetched?.message ? { message: fetched.message } : {}),
        realtime: buildRealtimeOverviewSnapshot(stats, limitsSummary || extractLimitsSummary(stats))
      };
    }

    const report = fetched.report;
    const resolvedKey = report.period?.key || periodKey;
    const analysis = includeAi ? readCachedAnalysis(report.granularity, resolvedKey, report) : null;
    const text = formatOpenClawWeChatMessage({
      report,
      analysis,
      stats,
      limitsSummary,
      includeLimits,
      includeAiAnalysis: includeAi
    });

    return {
      ok: true,
      reportId: report.reportId,
      granularity: report.granularity,
      periodKey: resolvedKey,
      text,
      report,
      aiAnalysis: analysis,
      realtime: buildRealtimeOverviewSnapshot(stats, limitsSummary || extractLimitsSummary(stats))
    };
  }

  function isBaseTitlesEnabled() {
    return typeof sessionTitlesEnabled === 'function'
      ? Boolean(sessionTitlesEnabled())
      : sessionTitlesEnabled !== false;
  }

  /**
   * Resolve optional enhanced query context and effective sessionTitlesEnabled flag.
   */
  async function resolveQueryContext() {
    const ctx = typeof getQueryContext === 'function' ? await getQueryContext() : null;
    const resolvedCtx = isPlainObject(ctx) ? ctx : {};
    const effectiveTitles = typeof resolvedCtx.sessionTitlesEnabled === 'boolean'
      ? resolvedCtx.sessionTitlesEnabled
      : isBaseTitlesEnabled();
    return { ctx: resolvedCtx, sessionTitlesEnabled: effectiveTitles };
  }

  /**
   * @param {boolean} effectiveTitles
   */
  function buildCompletionTrackerOptions(effectiveTitles) {
    const sc = config.openclaw.sessionCompletion || {};
    const extraOpts = isPlainObject(resolvedOpenClawOpts.sessionCompletionOptions)
      ? resolvedOpenClawOpts.sessionCompletionOptions
      : {};
    return {
      clients: Array.isArray(sc.clients) ? sc.clients : [],
      excludeSubagents: sc.excludeSubagents !== false,
      excludeBackgroundReview: sc.excludeBackgroundReview !== false,
      minTurnTokens: Number.isFinite(Number(sc.minTurnTokens)) ? Number(sc.minTurnTokens) : 0,
      minTotalTokens: Number.isFinite(Number(sc.minTotalTokens)) ? Number(sc.minTotalTokens) : 0,
      debounceMs: Number.isFinite(Number(sc.debounceMs)) ? Number(sc.debounceMs) : 2500,
      cooldownMs: Number.isFinite(Number(sc.cooldownMs)) ? Number(sc.cooldownMs) : 0,
      sessionTitlesEnabled: effectiveTitles,
      now,
      ...(typeof extraOpts.setTimer === 'function' ? { setTimer: extraOpts.setTimer } : {}),
      ...(typeof extraOpts.clearTimer === 'function' ? { clearTimer: extraOpts.clearTimer } : {})
    };
  }

  function syncCompletionTrackerOptions() {
    if (!config.openclaw.enabled || !config.openclaw.events?.sessionCompleted) {
      if (completionTracker) {
        completionTracker.stop();
        completionTracker = null;
      }
      return;
    }
    if (completionTracker) {
      completionTracker.updateOptions(buildCompletionTrackerOptions(isBaseTitlesEnabled()));
    }
  }

  /**
   * Dispatch a generic OpenClaw event with sliding-window idempotency dedup (only on ok: true)
   * and bounded 50-entry pushHistory persistence.
   * @param {{
   *   eventType?: string,
   *   text?: string,
   *   payload?: any,
   *   promptPrefix?: string,
   *   idempotencyKey?: string,
   *   source?: string,
   *   summary?: string,
   *   report?: any,
   *   analysis?: any,
   *   stats?: any,
   *   limitsSummary?: any
   * }} [options]
   */
  async function dispatchEvent({
    eventType = 'custom',
    text = '',
    payload = null,
    promptPrefix = '',
    idempotencyKey = '',
    source = 'hub',
    summary = '',
    report = null,
    analysis = null,
    stats = null,
    limitsSummary = null
  } = {}) {
    if (stopped) {
      return { ok: false, error: 'hub_stopped', message: 'Hub is stopping.' };
    }

    const cleanEventType = typeof eventType === 'string' && eventType.trim()
      ? eventType.trim().toLowerCase()
      : 'custom';
    const cleanKey = typeof idempotencyKey === 'string' ? idempotencyKey.trim().slice(0, 160) : '';
    const cleanSource = typeof source === 'string' && source.trim() ? source.trim().slice(0, 48) : 'hub';
    const secretVals = currentSecretValues();

    const clockMs = now().getTime();
    pruneIdempotencyWindow(clockMs);
    if (cleanKey && succeededIdempotency.has(cleanKey)) {
      return {
        ok: true,
        deduplicated: true,
        skipped: true,
        eventType: cleanEventType,
        idempotencyKey: cleanKey,
        channel: config.openclaw.channel,
        mode: config.openclaw.mode,
        lastPush: state.lastPush
      };
    }

    if (cleanKey && inFlightDispatches.has(cleanKey)) {
      const existingResult = await inFlightDispatches.get(cleanKey);
      if (existingResult && existingResult.ok === true) {
        return {
          ...existingResult,
          deduplicated: true,
          skipped: true
        };
      }
      return existingResult;
    }

    const executeDispatch = async () => {
      /** @type {any} */
      const pushResult = await trackTask(runWithOutboundSlot(() => sendToOpenClawWebhook({
        config: config.openclaw,
        hookToken: secrets.openclawHookToken,
        report,
        analysis,
        stats,
        limitsSummary,
        eventType: cleanEventType,
        eventPayload: payload,
        promptPrefix: typeof promptPrefix === 'string' ? promptPrefix : '',
        customMessage: typeof text === 'string' ? text.slice(0, MAX_CUSTOM_MESSAGE_CHARS) : '',
        idempotencyKey: cleanKey,
        fetchImpl: httpFetch,
        ...outboundSafetyOptions,
        now
      })));

      const atIso = now().toISOString();
      const ok = pushResult.ok === true;
      const cleanError = ok ? null : (pushResult.error || 'push_failed');
      const cleanMessage = ok ? null : (redactPushText(pushResult.message || '', secretVals).slice(0, 300) || null);
      const cleanSummary = derivePushSummary(cleanEventType, text, payload, summary, secretVals);

      const entry = {
        id: crypto.randomUUID(),
        at: atIso,
        eventType: cleanEventType,
        ok,
        statusCode: Number.isInteger(pushResult.statusCode) ? pushResult.statusCode : null,
        error: cleanError,
        message: cleanMessage,
        channel: config.openclaw.channel,
        mode: config.openclaw.mode,
        source: cleanSource,
        summary: cleanSummary || null,
        idempotencyKey: cleanKey || null
      };

      state.lastPush = {
        at: atIso,
        ok,
        error: cleanError,
        message: cleanMessage,
        statusCode: entry.statusCode,
        reportId: report?.reportId || null,
        eventType: cleanEventType,
        channel: config.openclaw.channel,
        mode: config.openclaw.mode,
        source: cleanSource,
        summary: entry.summary
      };
      state.pushHistory = [entry, ...state.pushHistory].slice(0, MAX_PUSH_HISTORY);

      if (ok && cleanKey) {
        succeededIdempotency.delete(cleanKey);
        succeededIdempotency.set(cleanKey, now().getTime());
        pruneIdempotencyWindow(now().getTime());
      }

      try {
        saveState();
      } catch (error) {
        logError(error, 'failed to persist OpenClaw push state');
      }

      return {
        ...pushResult,
        eventType: cleanEventType,
        lastPush: state.lastPush,
        entry
      };
    };

    const dispatchPromise = executeDispatch();
    if (cleanKey) {
      inFlightDispatches.set(cleanKey, dispatchPromise);
    }
    try {
      return await dispatchPromise;
    } finally {
      if (cleanKey && inFlightDispatches.get(cleanKey) === dispatchPromise) {
        inFlightDispatches.delete(cleanKey);
      }
    }
  }

  function getPushHistory() {
    return {
      count: state.pushHistory.length,
      lastPush: state.lastPush,
      history: state.pushHistory.map((/** @type {any} */ item) => ({ ...item }))
    };
  }

  /**
   * Send a connectivity test notification to OpenClaw without requiring a report.
   * @param {{ message?: string, source?: string }} [options]
   */
  async function sendTestNotification({ message = '', source = 'test' } = {}) {
    const cleanMessage = typeof message === 'string' ? message.trim() : '';
    return dispatchEvent({
      eventType: 'test',
      payload: cleanMessage ? { message: cleanMessage } : null,
      source: source || 'test',
      summary: cleanMessage ? `Test: ${cleanMessage}` : 'Connectivity test notification'
    });
  }

  /**
   * Fallback built-in query execution when Hub server does not inject `executeQuery`.
   * @param {string} queryType
   * @param {any} params
   */
  async function runFallbackQuery(queryType, params = {}) {
    const { ctx, sessionTitlesEnabled: titlesAllowed } = await resolveQueryContext();
    const stats = ctx.stats ?? getStats();
    const history = ctx.history ?? (typeof getHistory === 'function' ? getHistory() : null);
    const subscriptionsDoc = ctx.subscriptions ?? (typeof getSubscriptions === 'function' ? getSubscriptions() : null);
    const perms = config.openclaw.queryPermissions || { allowSessionDetail: false, allowConversationText: false };
    const p = isPlainObject(params) ? params : {};

    if (queryType === 'usage') {
      return {
        ok: true,
        ...queryUsageBreakdown({
          stats,
          history,
          devices: ctx.devices,
          dailySnapshots: ctx.dailySnapshots,
          period: p.period,
          range: p.range,
          groupBy: p.groupBy,
          deviceId: p.deviceId,
          limit: p.limit,
          modelAliases: ctx.modelAliases,
          modelAliasGrouping: ctx.modelAliasGrouping ?? p.modelAliasGrouping,
          timeZone: p.timeZone
        })
      };
    }

    if (queryType === 'sessions') {
      return {
        ok: true,
        ...listSessionsQuery({
          stats,
          allTimeSessions: ctx.allTimeSessions,
          period: p.period,
          state: p.state,
          client: p.client,
          project: p.project,
          deviceId: p.deviceId,
          search: p.search,
          sort: p.sort,
          sortDirection: p.sortDirection,
          limit: p.limit,
          cursor: p.cursor,
          sessionTitlesEnabled: titlesAllowed
        })
      };
    }

    if (queryType === 'session_detail') {
      if (perms.allowSessionDetail !== true) {
        return {
          ok: false,
          statusCode: 403,
          error: 'session_detail_disabled',
          message: 'Session detail queries are disabled by privacy settings (queryPermissions.allowSessionDetail).'
        };
      }
      const includeConversation = Boolean(p.includeConversation);
      if (includeConversation && perms.allowConversationText !== true) {
        return {
          ok: false,
          statusCode: 403,
          error: 'conversation_text_disabled',
          message: 'Conversation text queries are disabled by privacy settings (queryPermissions.allowConversationText).'
        };
      }
      const rawClient = typeof p.client === 'string' ? p.client.trim() : '';
      const client = rawClient ? (normalizeClientName(rawClient) || rawClient.toLowerCase()) : '';
      const sessionId = typeof p.sessionId === 'string' ? p.sessionId.trim() : '';
      if (!client || !sessionId) {
        return { ok: false, statusCode: 400, error: 'invalid_request', message: 'client and sessionId are required.' };
      }
      const reader = ctx.readSessionDetail || resolvedOpenClawOpts.readSessionDetail;
      if (typeof reader !== 'function') {
        return {
          ok: false,
          statusCode: 501,
          error: 'session_detail_unavailable',
          message: 'Session detail reader is not available in this runtime.'
        };
      }
      const detail = await reader({
        client,
        sessionId,
        deviceId: typeof p.deviceId === 'string' ? p.deviceId.trim() : '',
        period: p.period || 'total',
        includeConversation,
        limit: p.limit,
        offset: p.offset,
        cursor: p.cursor
      });
      if (!detail || detail.found === false) {
        return { ok: false, statusCode: 404, error: 'not_found', message: 'Session detail not found.' };
      }
      const sanitized = sanitizeSessionDetailForTitles(detail, titlesAllowed);
      if (!includeConversation || perms.allowConversationText !== true) {
        if (isPlainObject(sanitized)) {
          delete sanitized.conversation;
          delete sanitized.messages;
          delete sanitized.conversationMessages;
        }
      }
      return { ok: true, ...sanitized };
    }

    if (queryType === 'history') {
      return {
        ok: true,
        ...queryUsageHistory({
          history,
          resolution: p.resolution,
          from: p.from,
          to: p.to,
          groupBy: p.groupBy,
          limit: p.limit
        })
      };
    }

    if (queryType === 'devices') {
      return {
        ok: true,
        ...getDevicesAndHealthQuery({
          stats,
          deviceId: p.deviceId,
          includeDiagnostics: p.includeDiagnostics !== false
        })
      };
    }

    if (queryType === 'limits') {
      const overview = getLimitsOverviewQuery({
        stats,
        thirdPartyOnly: Boolean(p.thirdPartyOnly),
        provider: p.provider,
        status: p.status,
        maxProviders: p.maxProviders
      });
      if (p.includeHistory && typeof ctx.getLimitsHistory === 'function') {
        const limitsHistory = await ctx.getLimitsHistory({
          accountKey: p.accountKey,
          provider: p.provider,
          windowName: p.windowName,
          hours: p.hours
        });
        return { ok: true, ...overview, limitsHistory };
      }
      return { ok: true, ...overview };
    }

    if (queryType === 'subscriptions') {
      return {
        ok: true,
        ...getSubscriptionsAndForecastsQuery({
          subscriptionsDoc,
          stats,
          rates: ctx.rates,
          date: p.date,
          includeForecasts: p.includeForecasts !== false,
          activeOnly: Boolean(p.activeOnly)
        })
      };
    }

    if (queryType === 'live_rate') {
      return {
        ok: true,
        ...getLiveTokenRateSummary({
          stats,
          liveRateSnapshot: ctx.liveRateSnapshot,
          deviceId: p.deviceId
        })
      };
    }

    if (queryType === 'service_status') {
      const serviceStatus = typeof ctx.getServiceStatus === 'function'
        ? { available: true, ...(await ctx.getServiceStatus({ force: Boolean(p.force), providerIds: p.providerIds })) }
        : { available: false, reason: 'desktop_only', providers: [] };
      const codexResetForecast = typeof ctx.getCodexResetForecast === 'function'
        ? { available: true, ...(await ctx.getCodexResetForecast({ force: Boolean(p.force) })) }
        : { available: false, reason: 'desktop_only' };
      const rawAlerts = typeof ctx.listApprovalAlerts === 'function' ? await ctx.listApprovalAlerts() : null;
      const approvalAlerts = rawAlerts && rawAlerts.ok
        ? { available: true, enabled: true, alerts: rawAlerts.alerts || [] }
        : { available: false, enabled: false, alerts: [] };
      return {
        ok: true,
        checkedAt: now().toISOString(),
        serviceStatus,
        codexResetForecast,
        approvalAlerts
      };
    }

    return { ok: false, statusCode: 400, error: 'invalid_request', message: `Unsupported query type: ${queryType}` };
  }

  /**
   * Generate an optional concise AI summary for a query or session completion payload.
   * @param {string} question
   * @param {any} stats
   * @param {string} [syntheticId]
   */
  async function invokeQueryAiSummary(question, stats, syntheticId = 'openclaw-digest') {
    if (!config.ai.enabled) return null;
    try {
      const syntheticReport = {
        reportId: syntheticId,
        granularity: 'daily',
        period: { key: now().toISOString().slice(0, 10), label: syntheticId },
        summary: { totalTokens: 0, knownCostUsd: 0 },
        projects: [],
        clients: [],
        models: [],
        signals: []
      };
      const aiRes = await trackTask(runWithOutboundSlot(() => invokeThirdPartyAiAnalysis({
        config: config.ai,
        apiKey: secrets.aiApiKey,
        report: syntheticReport,
        stats,
        question,
        language: config.ai.language,
        fetchImpl: httpFetch,
        ...outboundSafetyOptions,
        now
      })));
      return aiRes?.ok && aiRes.analysis ? aiRes.analysis : null;
    } catch (error) {
      logError(error, 'optional AI summary failed');
      return null;
    }
  }

  /**
   * Push a report, query digest, test notification, or custom message to OpenClaw.
   * @param {{
   *   type?: string,
   *   params?: any,
   *   includeAi?: boolean,
   *   customMessage?: string,
   *   idempotencyKey?: string,
   *   source?: string
   * }} [options]
   */
  async function pushQueryToOpenClaw({
    type = 'usage',
    params = {},
    includeAi = false,
    customMessage = '',
    idempotencyKey = '',
    source = 'query_push'
  } = {}) {
    if (stopped) {
      return { ok: false, error: 'hub_stopped', message: 'Hub is stopping.' };
    }

    const rawType = typeof type === 'string' && type.trim()
      ? type.trim().toLowerCase().replace(/-/g, '_')
      : 'usage';
    if (!QUERY_PUSH_TYPES.has(rawType)) {
      return {
        ok: false,
        statusCode: 400,
        error: 'invalid_request',
        message: `Unsupported OpenClaw push type: ${String(type)}`
      };
    }

    const p = isPlainObject(params) ? params : {};
    const cleanCustom = typeof customMessage === 'string'
      ? customMessage.trim().slice(0, MAX_CUSTOM_MESSAGE_CHARS)
      : '';

    if (rawType === 'test') {
      const testMsg = cleanCustom
        || (typeof p.message === 'string' ? p.message.trim().slice(0, MAX_CUSTOM_MESSAGE_CHARS) : '');
      return sendTestNotification({ message: testMsg, source: source || 'query_push' });
    }

    if (rawType === 'report') {
      return pushToOpenClaw({
        granularity: p.granularity,
        periodKey: p.periodKey,
        includeAi: includeAi !== undefined ? Boolean(includeAi) : p.includeAi,
        includeLimits: p.includeLimits,
        refreshAi: Boolean(p.refreshAi),
        question: p.question || '',
        customMessage: cleanCustom,
        idempotencyKey,
        source: source || 'query_push'
      });
    }

    if (rawType === 'custom') {
      const customText = cleanCustom
        || (typeof p.message === 'string' ? p.message.trim().slice(0, MAX_CUSTOM_MESSAGE_CHARS) : '')
        || (typeof p.text === 'string' ? p.text.trim().slice(0, MAX_CUSTOM_MESSAGE_CHARS) : '');
      const boundedResult = p.result !== undefined ? boundCustomResultPayload(p.result, MAX_CUSTOM_RESULT_BYTES) : undefined;
      const customPayload = boundedResult ?? (customText ? { message: customText } : null);
      if (!customText && !customPayload) {
        return {
          ok: false,
          statusCode: 400,
          error: 'invalid_request',
          message: 'customMessage or payload is required for custom push.'
        };
      }
      return dispatchEvent({
        eventType: 'custom',
        text: customText,
        payload: customPayload,
        idempotencyKey,
        source: source || 'query_push',
        summary: customText || 'Custom OpenClaw notification'
      });
    }

    /** @type {any} */
    let queryRes;
    try {
      queryRes = typeof executeQuery === 'function'
        ? await executeQuery(rawType, p, config.openclaw)
        : await runFallbackQuery(rawType, p);
    } catch (error) {
      return {
        ok: false,
        statusCode: 400,
        error: 'invalid_request',
        message: error instanceof Error ? error.message : String(error)
      };
    }

    if (!queryRes || queryRes.ok === false) {
      return {
        ok: false,
        statusCode: queryRes?.statusCode || 400,
        error: queryRes?.error || 'query_failed',
        message: queryRes?.message || 'Query execution failed.'
      };
    }

    const { ok: _omitOk, statusCode: _omitCode, ...digestPayload } = queryRes;
    let aiSummary = null;
    if (includeAi === true && config.ai.enabled) {
      const secretVals = currentSecretValues();
      const serialized = redactPushText(JSON.stringify(digestPayload), secretVals).slice(0, 6000);
      aiSummary = await invokeQueryAiSummary(
        `Summarize this Token Monitor "${rawType}" query snapshot concisely in bullet points for WeChat:\n${serialized}`,
        getStats(),
        `query-${rawType}`
      );
    }

    const formattedDigest = formatOpenClawQueryDigestMessage({
      queryType: rawType,
      result: digestPayload,
      title: typeof p.title === 'string' ? p.title : '',
      aiSummary
    });
    const combinedText = cleanCustom
      ? `${cleanCustom}\n\n${formattedDigest}`.slice(0, 3500)
      : formattedDigest;

    return dispatchEvent({
      eventType: 'query_digest',
      text: combinedText,
      payload: {
        queryType: rawType,
        result: digestPayload,
        ...(typeof p.title === 'string' && p.title ? { title: p.title } : {}),
        ...(aiSummary ? { aiSummary } : {})
      },
      idempotencyKey,
      source: source || 'query_push',
      summary: `Query digest (${rawType})`
    });
  }

  /**
   * Dispatch a newly created approval alert when OpenClaw approvalAlerts is enabled.
   * @param {any} alert
   */
  async function onApprovalAlertCreated(alert) {
    if (stopped || !isPlainObject(alert)) {
      return { ok: false, skipped: true, reason: 'invalid_alert' };
    }
    if (!config.openclaw.enabled || !config.openclaw.events?.approvalAlerts) {
      return { ok: false, skipped: true, reason: 'disabled' };
    }
    const alertId = typeof alert.id === 'string' ? alert.id.trim() : '';
    const idempotencyKey = alertId ? `approval:${alertId}` : '';
    const clockMs = now().getTime();
    pruneIdempotencyWindow(clockMs);
    if (idempotencyKey && succeededIdempotency.has(idempotencyKey)) {
      return {
        ok: true,
        deduplicated: true,
        skipped: true,
        eventType: 'approval_alert',
        idempotencyKey,
        channel: config.openclaw.channel,
        mode: config.openclaw.mode,
        lastPush: state.lastPush
      };
    }
    if (!consumeApprovalWebhookQuota(String(alert.deviceId || ''), clockMs)) {
      return {
        ok: false,
        skipped: true,
        rateLimited: true,
        statusCode: 429,
        error: 'rate_limited',
        reason: 'rate_limited',
        message: 'Approval alert outbound webhook rate limit exceeded.'
      };
    }
    const text = formatOpenClawApprovalAlertMessage(alert);
    return dispatchEvent({
      eventType: 'approval_alert',
      text,
      payload: alert,
      idempotencyKey,
      source: 'approval_alert',
      summary: `Approval alert (${alert.tool || alert.client || 'tool'})`
    });
  }

  /**
   * @param {any} completion
   * @param {any} latestStats
   */
  async function handleSessionCompletionEvent(completion, latestStats) {
    if (stopped || !config.openclaw.enabled || !config.openclaw.events?.sessionCompleted) return;
    const { ctx, sessionTitlesEnabled: titlesAllowed } = await resolveQueryContext();
    const safeCompletion = titlesAllowed
      ? completion
      : {
          ...completion,
          title: null,
          label: completion.projectLabel || completion.sessionId || completion.key
        };

    const secretVals = currentSecretValues();
    let detailSummary = null;
    if (
      config.openclaw.sessionCompletion?.includeDetailSummary === true
      && config.openclaw.queryPermissions?.allowSessionDetail === true
    ) {
      const reader = ctx.readSessionDetail || resolvedOpenClawOpts.readSessionDetail;
      if (typeof reader === 'function') {
        try {
          const detail = await reader({
            client: safeCompletion.client,
            sessionId: safeCompletion.sessionId,
            deviceId: safeCompletion.deviceId,
            period: 'today',
            sessionCost: safeCompletion.costUsd
          });
          detailSummary = buildCompletionDetailSummary(
            sanitizeSessionDetailForTitles(detail, titlesAllowed),
            secretVals
          );
        } catch (error) {
          logError(error, `failed to read session detail for completion ${safeCompletion.key}`);
        }
      }
    }

    let aiSummary = null;
    if (config.openclaw.sessionCompletion?.includeAiSummary === true && config.ai.enabled) {
      const promptStats = ctx.stats ?? latestStats ?? getStats();
      const completionSnapshot = {
        client: safeCompletion.client,
        model: safeCompletion.model,
        projectLabel: safeCompletion.projectLabel,
        ...(safeCompletion.title ? { title: safeCompletion.title } : {}),
        turnDelta: safeCompletion.turnDelta,
        totalTokens: safeCompletion.totalTokens,
        costUsd: safeCompletion.costUsd,
        cacheHitRatePct: safeCompletion.cacheHitRatePct,
        ...(detailSummary ? { detailSummary } : {})
      };
      aiSummary = await invokeQueryAiSummary(
        `Summarize this completed AI coding turn in 1-2 concise sentences for WeChat:\n${JSON.stringify(completionSnapshot)}`,
        promptStats,
        `completion-${safeCompletion.sessionId}`
      );
    }

    const limitsSummary = config.openclaw.includeLimits
      ? extractLimitsSummary(ctx.stats ?? latestStats ?? getStats())
      : null;

    const text = formatOpenClawSessionCompletedMessage({
      completion: safeCompletion,
      detailSummary,
      aiSummary,
      limitsSummary
    });

    await dispatchEvent({
      eventType: 'session_completed',
      text,
      payload: {
        completion: safeCompletion,
        ...(detailSummary ? { detailSummary } : {}),
        ...(aiSummary ? { aiSummary } : {}),
        ...(limitsSummary ? { limitsSummary } : {})
      },
      idempotencyKey: `completion:${safeCompletion.eventId}`,
      source: 'session_completion',
      summary: `Session completed (${safeCompletion.client || 'session'}${safeCompletion.projectLabel ? `: ${safeCompletion.projectLabel}` : ''})`
    });
  }

  /**
   * Observe a stats snapshot to detect session turn completions via sessionCompletionTracker.
   * @param {any} stats
   */
  function onStatsSnapshot(stats) {
    if (stopped || !isPlainObject(stats)) return [];
    if (!config.openclaw.enabled || !config.openclaw.events?.sessionCompleted) {
      if (completionTracker) {
        completionTracker.stop();
        completionTracker = null;
      }
      return [];
    }

    const effectiveTitles = isBaseTitlesEnabled();
    const trackerOpts = buildCompletionTrackerOptions(effectiveTitles);
    if (!completionTracker) {
      completionTracker = createSessionCompletionTracker({
        ...trackerOpts,
        onCompletion: (completion) => {
          trackTask(handleSessionCompletionEvent(completion, stats));
        },
        onError: (error) => {
          logError(error, 'session completion tracker error');
        }
      });
    } else {
      completionTracker.updateOptions(trackerOpts);
    }

    return completionTracker.accept(stats, now());
  }

  /**
   * Push report + AI insights + limits snapshot to OpenClaw Gateway for WeChat delivery.
   * @param {{
   *   target?: string,
   *   granularity?: string,
   *   periodKey?: string,
   *   includeAi?: boolean,
   *   includeLimits?: boolean,
   *   refreshAi?: boolean,
   *   question?: string,
   *   customMessage?: string,
   *   idempotencyKey?: string,
   *   source?: string
   * }} [options]
   */
  async function pushToOpenClaw({
    target = 'openclaw',
    granularity = 'daily',
    periodKey = 'latest',
    includeAi,
    includeLimits,
    refreshAi = false,
    question = '',
    customMessage = '',
    idempotencyKey = '',
    source = 'report'
  } = {}) {
    if (stopped) {
      return { ok: false, error: 'hub_stopped', message: 'Hub is stopping.' };
    }
    if (target && target !== 'openclaw') {
      return { ok: false, error: 'invalid_request', message: `Unsupported push target: ${target}` };
    }

    if (!reportManager || typeof reportManager.getReport !== 'function') {
      return { ok: false, error: 'report_manager_unavailable', message: 'Report archive is unavailable.' };
    }
    const stats = getStats();
    const fetched = reportManager.getReport(granularity, periodKey, { format: 'json' });
    if (!fetched || fetched.ok === false || !fetched.report) {
      return {
        ok: false,
        error: fetched?.error || 'not_found',
        ...(fetched?.message ? { message: fetched.message } : {})
      };
    }

    const report = fetched.report;
    const resolvedKey = report.period?.key || periodKey;
    const wantAi = includeAi !== undefined ? Boolean(includeAi) : config.openclaw.includeAiAnalysis;
    const wantLimits = includeLimits !== undefined ? Boolean(includeLimits) : config.openclaw.includeLimits;
    let analysis = wantAi ? readCachedAnalysis(report.granularity, resolvedKey, report) : null;

    if (wantAi && config.ai.enabled && (refreshAi || question || !analysis || analysis.stale)) {
      /** @type {any} */
      const aiRes = await analyzeReport({
        granularity: report.granularity,
        periodKey: resolvedKey,
        question,
        refresh: Boolean(refreshAi)
      });
      if (aiRes?.ok && aiRes.aiAnalysis) {
        analysis = aiRes.aiAnalysis;
      }
    }

    const limitsSummary = wantLimits ? extractLimitsSummary(stats) : null;
    const pushResult = await dispatchEvent({
      eventType: 'report',
      report,
      analysis,
      stats,
      limitsSummary,
      text: customMessage,
      idempotencyKey,
      source: source || 'report',
      summary: `Report ${report.reportId}`
    });

    return {
      ...pushResult,
      ...(analysis ? { aiAnalysis: analysis } : {})
    };
  }

  /**
   * @param {{ includePaths?: boolean }} [options]
   */
  async function getOpenClawEnv(options = {}) {
    return detectOpenClawEnvironment({
      ...resolvedOpenClawOpts,
      includePaths: options?.includePaths === true
    });
  }

  async function startOpenClawWeixinQr() {
    if (stopped) {
      return { ok: false, error: 'hub_stopped', message: 'Hub is stopping.' };
    }
    return trackTask(qrManager.start());
  }

  /**
   * Persist confirmed WeChat QR binding into OpenClaw state & Token Monitor config/secrets.
   * Never returns raw botToken or hookToken.
   * @param {any} qrResult
   */
  async function finalizeWeixinQrResult(qrResult) {
    /** @type {string[]} */
    const warnings = [];
    let secretsChanged = false;

    if (qrResult.status === 'confirmed') {
      const botToken = cleanSecret(qrResult.botToken);
      if (botToken && botToken !== secrets.weixinBotToken) {
        secrets.weixinBotToken = botToken;
        secretsChanged = true;
      }
      if (botToken && qrResult.accountId) {
        try {
          persistWeixinBinding({
            accountId: qrResult.accountId,
            rawAccountId: qrResult.rawAccountId,
            botToken,
            baseUrl: qrResult.baseUrl,
            userId: qrResult.userId
          }, { ...resolvedOpenClawOpts, now });
        } catch (error) {
          warnings.push(`Failed to write ~/.openclaw/openclaw-weixin credentials: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    const hookSecrets = readOpenClawHookSecrets(resolvedOpenClawOpts);
    let provisionRes = null;
    try {
      provisionRes = await configureOpenClawHost({
        ensureHooks: true,
        installSkill: true,
        restartGateway: false,
        bumpChannelReload: true,
        hookToken: secrets.openclawHookToken || hookSecrets.hookToken || undefined,
        agentId: config.openclaw.agentId || 'main'
      }, { ...resolvedOpenClawOpts, now });
      if (Array.isArray(provisionRes.warnings) && provisionRes.warnings.length > 0) {
        warnings.push(...provisionRes.warnings);
      }
    } catch (error) {
      warnings.push(`Failed to configure OpenClaw host files: ${error instanceof Error ? error.message : String(error)}`);
    }

    const nextHookToken = cleanSecret(secrets.openclawHookToken || provisionRes?.resolvedHookToken || hookSecrets.hookToken);
    if (nextHookToken && nextHookToken !== secrets.openclawHookToken) {
      secrets.openclawHookToken = nextHookToken;
      secretsChanged = true;
    }
    if (secretsChanged) {
      try {
        saveSecrets();
      } catch (error) {
        logError(error, 'failed to persist WeChat QR secrets');
      }
    }

    const openclawEnv = provisionRes?.env || await getOpenClawEnv();
    const matchedUserId = qrResult.userId
      || openclawEnv.accounts?.find((/** @type {any} */ a) => a.userId)?.userId
      || config.openclaw.to;
    const resolvedWebhookUrl = config.openclaw.webhookUrl
      || provisionRes?.webhookUrl
      || openclawEnv.suggestedWebhookUrl
      || 'http://127.0.0.1:18789/hooks/agent';

    config.openclaw = mergeOpenClawIntegrationConfig(config.openclaw, {
      enabled: true,
      mode: 'openclaw-agent',
      channel: 'openclaw-weixin',
      to: matchedUserId || config.openclaw.to,
      webhookUrl: resolvedWebhookUrl,
      agentId: config.openclaw.agentId || 'main'
    });
    try {
      saveConfig();
    } catch (error) {
      logError(error, 'failed to persist OpenClaw QR integration config');
    }

    const { botToken: _omitBotToken, rawAccountId: _omitRawId, ...safeQr } = qrResult;
    return {
      ...safeQr,
      accountId: qrResult.accountId || openclawEnv.accounts?.at(-1)?.accountId || '',
      userId: matchedUserId || '',
      autoConfigured: Boolean(provisionRes?.steps?.hooksConfigured),
      steps: provisionRes?.steps || null,
      warnings,
      openclawEnv,
      ...getStatus()
    };
  }

  /**
   * @param {string} sessionId
   * @param {{ signal?: AbortSignal }} [options]
   */
  async function pollOpenClawWeixinQrStatus(sessionId, options = {}) {
    if (stopped) {
      return { ok: false, error: 'hub_stopped', message: 'Hub is stopping.' };
    }
    const result = await trackTask(qrManager.pollStatus(sessionId, { signal: options?.signal }));
    if (result?.ok && (result.status === 'confirmed' || result.status === 'binded_redirect')) {
      return finalizeWeixinQrResult(result);
    }
    return result;
  }

  /**
   * @param {string} sessionId
   * @param {string} verifyCode
   */
  async function submitOpenClawWeixinVerifyCode(sessionId, verifyCode) {
    if (stopped) {
      return { ok: false, error: 'hub_stopped', message: 'Hub is stopping.' };
    }
    const queued = qrManager.submitVerifyCode(sessionId, verifyCode);
    if (!queued.ok) return queued;
    return pollOpenClawWeixinQrStatus(sessionId);
  }

  /**
   * @param {string} sessionId
   */
  function cancelOpenClawWeixinQr(sessionId) {
    return qrManager.cancel(sessionId);
  }

  /**
   * @param {{
   *   ensureHooks?: boolean,
   *   installSkill?: boolean,
   *   restartGateway?: boolean,
   *   bumpChannelReload?: boolean,
   *   enableIntegration?: boolean
   * }} [options]
   */
  async function provisionOpenClaw(options = {}) {
    if (stopped) {
      return { ok: false, error: 'hub_stopped', message: 'Hub is stopping.' };
    }
    const ensureHooks = options?.ensureHooks !== false;
    const hookSecrets = ensureHooks ? readOpenClawHookSecrets(resolvedOpenClawOpts) : { hookToken: '' };
    const provisionRes = await trackTask(configureOpenClawHost({
      ensureHooks,
      installSkill: options?.installSkill !== false,
      restartGateway: options?.restartGateway === true,
      bumpChannelReload: options?.bumpChannelReload !== false,
      hookToken: ensureHooks ? (secrets.openclawHookToken || hookSecrets.hookToken || undefined) : undefined,
      agentId: config.openclaw.agentId || 'main'
    }, { ...resolvedOpenClawOpts, now }));

    if (provisionRes.ok === false) {
      const { resolvedHookToken: _omitHookToken, ...safeProvision } = provisionRes;
      return {
        ...safeProvision,
        ...getStatus()
      };
    }

    if (ensureHooks) {
      const nextHookToken = cleanSecret(provisionRes.resolvedHookToken || hookSecrets.hookToken);
      if (nextHookToken && nextHookToken !== secrets.openclawHookToken) {
        secrets.openclawHookToken = nextHookToken;
        saveSecrets();
      }
    }

    const nextWebhookUrl = config.openclaw.webhookUrl || provisionRes.webhookUrl;
    const nextChannel = config.openclaw.channel || 'openclaw-weixin';
    const nextEnabled = options?.enableIntegration === true ? true : config.openclaw.enabled;
    const nextTo = config.openclaw.to || provisionRes.env?.accounts?.find((/** @type {any} */ a) => a.userId)?.userId || '';
    if (
      nextWebhookUrl !== config.openclaw.webhookUrl
      || nextChannel !== config.openclaw.channel
      || nextEnabled !== config.openclaw.enabled
      || nextTo !== config.openclaw.to
    ) {
      config.openclaw = mergeOpenClawIntegrationConfig(config.openclaw, {
        enabled: nextEnabled,
        webhookUrl: nextWebhookUrl,
        channel: nextChannel,
        to: nextTo
      });
      saveConfig();
    }

    const { resolvedHookToken: _omitHookToken, ...safeProvision } = provisionRes;
    return {
      ...safeProvision,
      ...getStatus()
    };
  }

  /**
   * Called automatically when a period rolls over and is archived by reportManager.
   * Never throws or blocks ingest.
   * @param {{ granularity: 'daily' | 'weekly' | 'monthly', periodKey: string }} event
   */
  function onReportArchived({ granularity, periodKey }) {
    if (stopped) return;
    if (!REPORT_GRANULARITIES.includes(granularity) || !periodKey) return;

    const rolloverEnabled = config.openclaw.events?.rollover ?? config.openclaw.pushOnRollover;
    const shouldAnalyze = config.ai.enabled && config.ai.autoAnalyzeOnRollover;
    const shouldPush = config.openclaw.enabled
      && Boolean(rolloverEnabled)
      && config.openclaw.pushGranularities[granularity] !== false;

    if (!shouldAnalyze && !shouldPush) return;

    const job = (async () => {
      try {
        if (shouldAnalyze && !stopped) {
          await analyzeReport({ granularity, periodKey, refresh: false });
        }
        if (shouldPush && !stopped) {
          const resolved = resolveReportPeriod(granularity, periodKey, { now: now() });
          await pushToOpenClaw({
            granularity,
            periodKey: resolved.key,
            idempotencyKey: `token-monitor-${granularity}-${resolved.key}`,
            source: 'rollover'
          });
        }
      } catch (error) {
        logError(error, `failed rollover integration task for ${granularity}:${periodKey}`);
      }
    })();

    trackTask(job);
  }

  async function flush() {
    if (stopped) return;
    if (completionTracker && typeof completionTracker.flush === 'function') {
      completionTracker.flush(now());
    }
    while (pendingTasks.size > 0) {
      await Promise.allSettled([...pendingTasks]);
    }
  }

  async function stop() {
    stopped = true;
    completionTracker?.stop();
    completionTracker = null;
    qrManager.cancelAll();
    if (pendingTasks.size > 0) {
      await Promise.allSettled([...pendingTasks]);
    }
  }

  return {
    getStatus,
    getSecrets,
    updateConfig,
    setSecrets,
    readCachedAnalysis,
    analyzeReport,
    buildWeChatBrief,
    dispatchEvent,
    getPushHistory,
    sendTestNotification,
    pushQueryToOpenClaw,
    pushToOpenClaw,
    getOpenClawEnv,
    startOpenClawWeixinQr,
    pollOpenClawWeixinQrStatus,
    submitOpenClawWeixinVerifyCode,
    cancelOpenClawWeixinQr,
    provisionOpenClaw,
    onApprovalAlertCreated,
    onStatsSnapshot,
    onReportArchived,
    flush,
    stop
  };
}

module.exports = {
  createIntegrationManager,
  syncIntegrationSecretsFile
};
