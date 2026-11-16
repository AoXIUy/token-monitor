// @ts-check
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { readJson, writeJsonAtomic } = require('../shared/config');
const { createOutboundFetch } = require('../shared/outboundFetch');
const { REPORT_GRANULARITIES, reportContentSignature, resolveReportPeriod } = require('../shared/usageReport');
const {
  buildRealtimeOverviewSnapshot,
  extractLimitsSummary,
  formatOpenClawWeChatMessage,
  invokeThirdPartyAiAnalysis,
  normalizeAiIntegrationConfig,
  normalizeOpenClawIntegrationConfig,
  sendToOpenClawWebhook
} = require('../shared/aiReportAnalyzer');

const INTEGRATIONS_CONFIG_VERSION = 1;
const SECRETS_VERSION = 1;
const ANALYSIS_KEY_RE = /^[A-Za-z0-9._-]+$/;

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
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  if (process.platform === 'win32') {
    fs.writeFileSync(tmpPath, payload, 'utf8');
  } else {
    const fd = fs.openSync(tmpPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC, 0o600);
    try {
      fs.writeFileSync(fd, payload, 'utf8');
      fs.fchmodSync(fd, 0o600);
    } finally {
      fs.closeSync(fd);
    }
  }
  fs.renameSync(tmpPath, filePath);
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
      openclawHookToken: cleanSecret(env.TOKEN_MONITOR_OPENCLAW_TOKEN || env.TOKEN_MONITOR_OPENCLAW_HOOK_TOKEN)
    }
  };
}

/**
 * Create Hub integration manager for Third-Party AI API & OpenClaw WeChat delivery.
 * @param {{
 *   dataFile: string,
 *   reportsDir?: string,
 *   reportManager: any,
 *   getStats: () => any,
 *   initialConfig?: any,
 *   initialSecrets?: { aiApiKey?: string, openclawHookToken?: string } | null,
 *   fetchImpl?: typeof fetch,
 *   now?: () => Date,
 *   logger?: { error?: (...args: any[]) => void, log?: (...args: any[]) => void }
 * }} options
 */
function createIntegrationManager({
  dataFile,
  reportsDir,
  reportManager,
  getStats,
  initialConfig = null,
  initialSecrets = null,
  fetchImpl,
  now = () => new Date(),
  logger = console
}) {
  const resolvedReportsDir = String(reportsDir || '').trim() || path.join(path.dirname(dataFile), 'reports');
  const configPath = path.join(resolvedReportsDir, 'integrations.json');
  const secretsPath = path.join(resolvedReportsDir, 'integrations.secrets.json');
  const statePath = path.join(resolvedReportsDir, 'integrations-state.json');
  const aiAnalysisDir = path.join(resolvedReportsDir, 'ai-analysis');
  const logError = typeof logger?.error === 'function' ? logger.error.bind(logger) : console.error;
  const httpFetch = typeof fetchImpl === 'function' ? fetchImpl : createOutboundFetch();

  const envDefaults = readEnvIntegrationsDefaults();
  const persistedConfig = readJson(configPath, null);
  const persistedState = readJson(statePath, null);

  function readPersistedSecrets() {
    try {
      const raw = readPrivateTextNoFollow(secretsPath);
      const parsed = JSON.parse(raw);
      return {
        aiApiKey: cleanSecret(parsed?.aiApiKey),
        openclawHookToken: cleanSecret(parsed?.openclawHookToken)
      };
    } catch (error) {
      if (/** @type {any} */ (error)?.code === 'ENOENT') {
        return { aiApiKey: '', openclawHookToken: '' };
      }
      logError(error, 'failed to read integration secrets');
      return { aiApiKey: '', openclawHookToken: '' };
    }
  }

  const fileSecrets = readPersistedSecrets();
  let secrets = {
    aiApiKey: cleanSecret(initialSecrets?.aiApiKey) || fileSecrets.aiApiKey || envDefaults.secrets.aiApiKey,
    openclawHookToken: cleanSecret(initialSecrets?.openclawHookToken) || fileSecrets.openclawHookToken || envDefaults.secrets.openclawHookToken
  };

  let config = {
    ai: normalizeAiIntegrationConfig(initialConfig?.ai ?? persistedConfig?.ai ?? envDefaults.config.ai),
    openclaw: normalizeOpenClawIntegrationConfig(initialConfig?.openclaw ?? persistedConfig?.openclaw ?? envDefaults.config.openclaw)
  };

  let state = {
    lastPush: isPlainObject(persistedState?.lastPush) ? persistedState.lastPush : null
  };

  /** @type {Set<Promise<any>>} */
  const pendingTasks = new Set();
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
      openclawHookToken: secrets.openclawHookToken
    });
  }

  function saveState() {
    writeJsonAtomic(statePath, {
      version: 1,
      lastPush: state.lastPush
    }, 2);
  }

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
        hookTokenConfigured: Boolean(secrets.openclawHookToken)
      },
      lastPush: state.lastPush
    };
  }

  /**
   * @param {any} patch
   */
  function updateConfig(patch = {}) {
    if (!isPlainObject(patch)) {
      return { ok: false, error: 'invalid_request', message: 'Integrations patch must be an object' };
    }

    let configChanged = false;
    let secretsChanged = false;

    if (isPlainObject(patch.ai)) {
      const mergedAi = { ...config.ai, ...patch.ai };
      delete mergedAi.apiKey;
      delete mergedAi.apiKeyConfigured;
      delete mergedAi.clearApiKey;
      config.ai = normalizeAiIntegrationConfig(mergedAi);
      configChanged = true;

      if (patch.ai.clearApiKey === true) {
        if (secrets.aiApiKey) {
          secrets.aiApiKey = '';
          secretsChanged = true;
        }
      } else if (typeof patch.ai.apiKey === 'string' && patch.ai.apiKey.trim()) {
        secrets.aiApiKey = cleanSecret(patch.ai.apiKey);
        secretsChanged = true;
      }
    }

    if (isPlainObject(patch.openclaw)) {
      const mergedOc = {
        ...config.openclaw,
        ...patch.openclaw,
        pushGranularities: {
          ...config.openclaw.pushGranularities,
          ...(isPlainObject(patch.openclaw.pushGranularities) ? patch.openclaw.pushGranularities : {})
        }
      };
      delete mergedOc.hookToken;
      delete mergedOc.hookTokenConfigured;
      delete mergedOc.clearHookToken;
      config.openclaw = normalizeOpenClawIntegrationConfig(mergedOc);
      configChanged = true;

      if (patch.openclaw.clearHookToken === true) {
        if (secrets.openclawHookToken) {
          secrets.openclawHookToken = '';
          secretsChanged = true;
        }
      } else if (typeof patch.openclaw.hookToken === 'string' && patch.openclaw.hookToken.trim()) {
        secrets.openclawHookToken = cleanSecret(patch.openclaw.hookToken);
        secretsChanged = true;
      }
    }

    if (configChanged) saveConfig();
    if (secretsChanged) saveSecrets();

    return { ok: true, ...getStatus() };
  }

  /**
   * Synchronize in-memory/persisted secrets from Desktop CredentialStore on startup or save.
   * @param {{ aiApiKey?: string | null, openclawHookToken?: string | null }} nextSecrets
   */
  function setSecrets(nextSecrets = {}) {
    if (!isPlainObject(nextSecrets)) return;
    let changed = false;
    if (nextSecrets.aiApiKey !== undefined) {
      const val = cleanSecret(nextSecrets.aiApiKey);
      if (val !== secrets.aiApiKey) {
        secrets.aiApiKey = val;
        changed = true;
      }
    }
    if (nextSecrets.openclawHookToken !== undefined) {
      const val = cleanSecret(nextSecrets.openclawHookToken);
      if (val !== secrets.openclawHookToken) {
        secrets.openclawHookToken = val;
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
    const fetched = reportManager.getReport(granularity, periodKey, { format: 'json' });
    if (!fetched || fetched.ok === false || !fetched.report) {
      return {
        ok: false,
        error: fetched?.error || 'not_found',
        ...(fetched?.message ? { message: fetched.message } : {})
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
    const result = await trackTask(invokeThirdPartyAiAnalysis({
      config: config.ai,
      apiKey: secrets.aiApiKey,
      report,
      stats,
      question: cleanQuestion,
      language: language || config.ai.language,
      fetchImpl: httpFetch,
      now
    }));

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
        ...(fetched?.message ? { message: fetched?.message } : {}),
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
   *   idempotencyKey?: string
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
    idempotencyKey = ''
  } = {}) {
    if (stopped) {
      return { ok: false, error: 'hub_stopped', message: 'Hub is stopping.' };
    }
    if (target && target !== 'openclaw') {
      return { ok: false, error: 'invalid_request', message: `Unsupported push target: ${target}` };
    }

    const stats = getStats();
    const fetched = reportManager.getReport(granularity, periodKey, { format: 'json' });
    if (!fetched || fetched.ok === false || !fetched.report) {
      return {
        ok: false,
        error: fetched?.error || 'not_found',
        ...(fetched?.message ? { message: fetched?.message } : {})
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
    /** @type {any} */
    const pushResult = await trackTask(sendToOpenClawWebhook({
      config: config.openclaw,
      hookToken: secrets.openclawHookToken,
      report,
      analysis,
      stats,
      limitsSummary,
      customMessage,
      idempotencyKey,
      fetchImpl: httpFetch,
      now
    }));

    state.lastPush = {
      at: now().toISOString(),
      ok: pushResult.ok === true,
      error: pushResult.ok ? null : (pushResult.error || 'push_failed'),
      message: pushResult.ok ? null : (pushResult.message || null),
      statusCode: pushResult.statusCode || null,
      reportId: report.reportId,
      channel: config.openclaw.channel,
      mode: config.openclaw.mode
    };
    try {
      saveState();
    } catch (error) {
      logError(error, 'failed to persist OpenClaw push state');
    }

    return {
      ...pushResult,
      lastPush: state.lastPush,
      ...(analysis ? { aiAnalysis: analysis } : {})
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

    const shouldAnalyze = config.ai.enabled && config.ai.autoAnalyzeOnRollover;
    const shouldPush = config.openclaw.enabled
      && config.openclaw.pushOnRollover
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
            idempotencyKey: `token-monitor-${granularity}-${resolved.key}`
          });
        }
      } catch (error) {
        logError(error, `failed rollover integration task for ${granularity}:${periodKey}`);
      }
    })();

    trackTask(job);
  }

  async function stop() {
    stopped = true;
    if (pendingTasks.size > 0) {
      await Promise.allSettled([...pendingTasks]);
    }
  }

  return {
    getStatus,
    updateConfig,
    setSecrets,
    readCachedAnalysis,
    analyzeReport,
    buildWeChatBrief,
    pushToOpenClaw,
    onReportArchived,
    stop
  };
}

module.exports = {
  createIntegrationManager
};
