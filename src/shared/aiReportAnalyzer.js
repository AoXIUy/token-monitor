// @ts-check
'use strict';

const { num } = require('./history');
const { reportContentSignature } = require('./usageReport');

const AI_PROTOCOLS = Object.freeze(['openai-compatible', 'anthropic-messages']);
const AI_LANGUAGES = Object.freeze(['zh-CN', 'en', 'auto']);
const OPENCLAW_MODES = Object.freeze(['openclaw-agent', 'openclaw-wake', 'generic-webhook']);
const OPENCLAW_EVENT_TYPES = Object.freeze([
  'report',
  'session_completed',
  'approval_alert',
  'quota_alert',
  'service_incident',
  'query_digest',
  'test',
  'custom'
]);
const OPENCLAW_AGENT_PROMPT_PREFIXES = Object.freeze({
  report: '请将以下 Token Monitor 用量与项目分析简报清晰准确地整理并发送给微信用户（保留核心数字与结论，不要遗漏预警）：\n\n',
  session_completed: '请将以下 Token Monitor 会话完成通知清晰准确地整理并发送给微信用户（保留项目、模型、本轮增量与关键结论）：\n\n',
  approval_alert: '请立即将以下 Token Monitor 操作审批提醒准确发送给微信用户，提醒其尽快确认（保留工具、命令与设备信息）：\n\n',
  quota_alert: '请将以下 Token Monitor 额度告警/恢复通知清晰准确地发送给微信用户（保留渠道、剩余额度与重置时间）：\n\n',
  service_incident: '请将以下 Token Monitor 第三方服务状态异常/恢复通知清晰准确地发送给微信用户（保留服务名称、影响与状态页信息）：\n\n',
  query_digest: '请将以下 Token Monitor 数据查询摘要清晰准确地整理并发送给微信用户（保留关键指标与明细）：\n\n',
  test: '请将以下 Token Monitor 连通性测试消息原样或简洁清晰地发送给微信用户，用于确认通道可用：\n\n',
  custom: '请将以下 Token Monitor 通知消息清晰准确地发送给微信用户：\n\n'
});
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

const DEFAULT_AI_CONFIG = Object.freeze({
  enabled: false,
  protocol: 'openai-compatible',
  providerLabel: '',
  baseUrl: '',
  model: '',
  language: 'zh-CN',
  customPrompt: '',
  temperature: 0.3,
  maxTokens: 4096,
  autoAnalyzeOnRollover: false
});

const DEFAULT_OPENCLAW_CONFIG = Object.freeze({
  enabled: false,
  mode: 'openclaw-agent',
  webhookUrl: '',
  channel: 'openclaw-weixin',
  to: '',
  agentId: 'main',
  senderName: 'Token Monitor',
  deliver: true,
  pushOnRollover: false,
  pushGranularities: Object.freeze({
    daily: true,
    weekly: true,
    monthly: true
  }),
  includeAiAnalysis: true,
  includeLimits: true,
  events: Object.freeze({
    rollover: false,
    sessionCompleted: false,
    approvalAlerts: false,
    quotaAlerts: false,
    serviceIncidents: false
  }),
  sessionCompletion: Object.freeze({
    clients: Object.freeze([]),
    excludeSubagents: true,
    excludeBackgroundReview: true,
    minTurnTokens: 0,
    minTotalTokens: 0,
    debounceMs: 2500,
    cooldownMs: 0,
    includeDetailSummary: false,
    includeAiSummary: false
  }),
  quotaAlerts: Object.freeze({
    thresholdPercent: 20,
    notifyRecovery: true
  }),
  queryPermissions: Object.freeze({
    allowSessionDetail: false,
    allowConversationText: false
  }),
  localBridge: Object.freeze({
    enabled: false,
    port: 17322
  })
});

/**
 * @param {any} value
 * @returns {boolean}
 */
function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/**
 * @param {any} value
 * @param {number} [maxLen]
 * @returns {string}
 */
function cleanText(value, maxLen = 256) {
  const raw = typeof value === 'string' ? value.trim() : '';
  return maxLen > 0 ? raw.slice(0, maxLen) : raw;
}

/**
 * @param {any} value
 * @returns {string}
 */
function normalizeHttpUrl(value) {
  const raw = cleanText(value, 2048);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    if (parsed.username || parsed.password || parsed.hash) return '';
    parsed.pathname = parsed.pathname.replace(/\/+$/u, '') || '/';
    return parsed.toString().replace(/\/$/u, '');
  } catch {
    return '';
  }
}

/**
 * @param {string} urlString
 * @returns {boolean}
 */
function isLoopbackUrl(urlString) {
  try {
    const parsed = new URL(urlString);
    return LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * @param {string} text
 * @param {string[]} secrets
 * @returns {string}
 */
function redactSecrets(text, secrets = []) {
  let out = String(text || '');
  for (const secret of secrets) {
    const clean = typeof secret === 'string' ? secret.trim() : '';
    if (clean && clean.length >= 4) {
      out = out.split(clean).join('[REDACTED]');
    }
  }
  return out;
}

/**
 * @param {any} raw
 */
function normalizeAiIntegrationConfig(raw) {
  const src = isPlainObject(raw) ? raw : {};
  const rawProtocol = cleanText(src.protocol, 40).toLowerCase();
  const protocol = /** @type {'openai-compatible' | 'anthropic-messages'} */ (
    AI_PROTOCOLS.includes(rawProtocol) ? rawProtocol : DEFAULT_AI_CONFIG.protocol
  );
  const rawLang = cleanText(src.language, 16);
  const language = /** @type {'zh-CN' | 'en' | 'auto'} */ (
    AI_LANGUAGES.includes(rawLang) ? rawLang : DEFAULT_AI_CONFIG.language
  );
  const rawTemp = Number(src.temperature);
  const temperature = Number.isFinite(rawTemp)
    ? Math.max(0, Math.min(2, Number(rawTemp.toFixed(2))))
    : DEFAULT_AI_CONFIG.temperature;
  const rawMaxTokens = Number(src.maxTokens);
  const maxTokens = Number.isInteger(rawMaxTokens)
    ? Math.max(256, Math.min(32768, rawMaxTokens))
    : DEFAULT_AI_CONFIG.maxTokens;

  return {
    enabled: src.enabled === true,
    protocol,
    providerLabel: cleanText(src.providerLabel, 64),
    baseUrl: normalizeHttpUrl(src.baseUrl),
    model: cleanText(src.model, 160),
    language,
    customPrompt: cleanText(src.customPrompt, 2000),
    temperature,
    maxTokens,
    autoAnalyzeOnRollover: src.autoAnalyzeOnRollover === true
  };
}

/**
 * @param {any} value
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 * @returns {number}
 */
function clampInt(value, min, max, fallback) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

/**
 * @param {any} value
 * @returns {string[]}
 */
function normalizeClientList(value) {
  if (!Array.isArray(value)) return [];
  /** @type {Set<string>} */
  const seen = new Set();
  for (const item of value) {
    const clean = cleanText(item, 64).toLowerCase();
    if (clean) seen.add(clean);
    if (seen.size >= 64) break;
  }
  return Array.from(seen);
}

/**
 * @param {any} raw
 */
function normalizeOpenClawIntegrationConfig(raw) {
  const src = isPlainObject(raw) ? raw : {};
  const rawMode = cleanText(src.mode, 40).toLowerCase();
  const mode = /** @type {'openclaw-agent' | 'openclaw-wake' | 'generic-webhook'} */ (
    OPENCLAW_MODES.includes(rawMode) ? rawMode : DEFAULT_OPENCLAW_CONFIG.mode
  );
  const rawGran = isPlainObject(src.pushGranularities) ? src.pushGranularities : {};
  const rawEvents = isPlainObject(src.events) ? src.events : {};
  const rawSessionCompletion = isPlainObject(src.sessionCompletion) ? src.sessionCompletion : {};
  const rawQuotaAlerts = isPlainObject(src.quotaAlerts) ? src.quotaAlerts : {};
  const rawQueryPermissions = isPlainObject(src.queryPermissions) ? src.queryPermissions : {};
  const rawLocalBridge = isPlainObject(src.localBridge) ? src.localBridge : {};

  // Keep pushOnRollover and events.rollover consistent in both directions.
  const hasExplicitRollover = typeof rawEvents.rollover === 'boolean';
  const rollover = hasExplicitRollover
    ? rawEvents.rollover
    : src.pushOnRollover === true;

  return {
    enabled: src.enabled === true,
    mode,
    webhookUrl: normalizeHttpUrl(src.webhookUrl),
    channel: cleanText(src.channel, 64) || DEFAULT_OPENCLAW_CONFIG.channel,
    to: cleanText(src.to, 256),
    agentId: cleanText(src.agentId, 64) || DEFAULT_OPENCLAW_CONFIG.agentId,
    senderName: cleanText(src.senderName, 64) || DEFAULT_OPENCLAW_CONFIG.senderName,
    deliver: src.deliver !== false,
    pushOnRollover: rollover,
    pushGranularities: {
      daily: rawGran.daily !== false,
      weekly: rawGran.weekly !== false,
      monthly: rawGran.monthly !== false
    },
    includeAiAnalysis: src.includeAiAnalysis !== false,
    includeLimits: src.includeLimits !== false,
    events: {
      rollover,
      sessionCompleted: rawEvents.sessionCompleted === true,
      approvalAlerts: rawEvents.approvalAlerts === true,
      quotaAlerts: rawEvents.quotaAlerts === true,
      serviceIncidents: rawEvents.serviceIncidents === true
    },
    sessionCompletion: {
      clients: normalizeClientList(rawSessionCompletion.clients),
      excludeSubagents: rawSessionCompletion.excludeSubagents !== false,
      excludeBackgroundReview: rawSessionCompletion.excludeBackgroundReview !== false,
      minTurnTokens: clampInt(rawSessionCompletion.minTurnTokens, 0, Number.MAX_SAFE_INTEGER, DEFAULT_OPENCLAW_CONFIG.sessionCompletion.minTurnTokens),
      minTotalTokens: clampInt(rawSessionCompletion.minTotalTokens, 0, Number.MAX_SAFE_INTEGER, DEFAULT_OPENCLAW_CONFIG.sessionCompletion.minTotalTokens),
      debounceMs: clampInt(rawSessionCompletion.debounceMs, 0, 600_000, DEFAULT_OPENCLAW_CONFIG.sessionCompletion.debounceMs),
      cooldownMs: clampInt(rawSessionCompletion.cooldownMs, 0, 86_400_000, DEFAULT_OPENCLAW_CONFIG.sessionCompletion.cooldownMs),
      includeDetailSummary: rawSessionCompletion.includeDetailSummary === true,
      includeAiSummary: rawSessionCompletion.includeAiSummary === true
    },
    quotaAlerts: {
      thresholdPercent: clampInt(rawQuotaAlerts.thresholdPercent, 1, 99, DEFAULT_OPENCLAW_CONFIG.quotaAlerts.thresholdPercent),
      notifyRecovery: rawQuotaAlerts.notifyRecovery !== false
    },
    queryPermissions: {
      allowSessionDetail: rawQueryPermissions.allowSessionDetail === true,
      allowConversationText: rawQueryPermissions.allowConversationText === true
    },
    localBridge: {
      enabled: rawLocalBridge.enabled === true,
      port: clampInt(rawLocalBridge.port, 1, 65535, DEFAULT_OPENCLAW_CONFIG.localBridge.port)
    }
  };
}

/**
 * Deep-merge an OpenClaw integration patch onto an existing config while keeping
 * `pushOnRollover` and `events.rollover` synchronized.
 * @param {any} current
 * @param {any} patch
 */
function mergeOpenClawIntegrationConfig(current, patch) {
  const base = normalizeOpenClawIntegrationConfig(current);
  if (!isPlainObject(patch)) return base;

  const patchGran = isPlainObject(patch.pushGranularities) ? patch.pushGranularities : {};
  const patchEvents = isPlainObject(patch.events) ? patch.events : {};
  const patchSc = isPlainObject(patch.sessionCompletion) ? patch.sessionCompletion : {};
  const patchQa = isPlainObject(patch.quotaAlerts) ? patch.quotaAlerts : {};
  const patchQp = isPlainObject(patch.queryPermissions) ? patch.queryPermissions : {};
  const patchLb = isPlainObject(patch.localBridge) ? patch.localBridge : {};

  const hasPatchPushOnRollover = typeof patch.pushOnRollover === 'boolean';
  const hasPatchEventsRollover = typeof patchEvents.rollover === 'boolean';

  const mergedEvents = {
    ...base.events,
    ...patchEvents
  };
  let mergedPushOnRollover = hasPatchPushOnRollover ? patch.pushOnRollover : base.pushOnRollover;
  if (hasPatchPushOnRollover && !hasPatchEventsRollover) {
    mergedEvents.rollover = patch.pushOnRollover;
  } else if (hasPatchEventsRollover && !hasPatchPushOnRollover) {
    mergedPushOnRollover = patchEvents.rollover;
  }

  return normalizeOpenClawIntegrationConfig({
    ...base,
    ...patch,
    pushOnRollover: mergedPushOnRollover,
    pushGranularities: {
      ...base.pushGranularities,
      ...patchGran
    },
    events: mergedEvents,
    sessionCompletion: {
      ...base.sessionCompletion,
      ...patchSc
    },
    quotaAlerts: {
      ...base.quotaAlerts,
      ...patchQa
    },
    queryPermissions: {
      ...base.queryPermissions,
      ...patchQp
    },
    localBridge: {
      ...base.localBridge,
      ...patchLb
    }
  });
}

/**
 * @param {'openai-compatible' | 'anthropic-messages'} protocol
 * @param {string} baseUrl
 * @returns {string}
 */
function resolveAiCompletionEndpoint(protocol, baseUrl) {
  const normalized = normalizeHttpUrl(baseUrl);
  if (!normalized) return '';
  if (protocol === 'anthropic-messages') {
    if (/\/messages$/iu.test(normalized)) return normalized;
    if (/\/v\d+$/iu.test(normalized)) return `${normalized}/messages`;
    return `${normalized}/v1/messages`;
  }
  if (/\/chat\/completions$/iu.test(normalized)) return normalized;
  if (/\/v\d+$/iu.test(normalized) || /\/openai$/iu.test(normalized)) {
    return `${normalized}/chat/completions`;
  }
  return `${normalized}/v1/chat/completions`;
}

/**
 * @param {'openclaw-agent' | 'openclaw-wake' | 'generic-webhook'} mode
 * @param {string} webhookUrl
 * @returns {string}
 */
function resolveOpenClawWebhookEndpoint(mode, webhookUrl) {
  const normalized = normalizeHttpUrl(webhookUrl);
  if (!normalized) return '';
  try {
    const parsed = new URL(normalized);
    if (parsed.pathname === '/' || parsed.pathname === '') {
      if (mode === 'openclaw-agent') {
        parsed.pathname = '/hooks/agent';
        return parsed.toString();
      }
      if (mode === 'openclaw-wake') {
        parsed.pathname = '/hooks/wake';
        return parsed.toString();
      }
    }
    return normalized;
  } catch {
    return normalized;
  }
}

/**
 * Format token counts compactly for prompts and WeChat digests.
 * @param {number} count
 * @returns {string}
 */
function formatCompactTokens(count) {
  const n = Math.max(0, num(count));
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

/**
 * @param {number} amount
 * @param {string} [currency]
 * @returns {string}
 */
function formatMoney(amount, currency = 'USD') {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '—';
  const code = String(currency || 'USD').trim().toUpperCase();
  const symbol = code === 'CNY' || code === 'RMB' ? '¥' : '$';
  return `${symbol}${n.toFixed(n >= 100 ? 2 : n >= 1 ? 2 : 3)}`;
}

/**
 * @param {any} value
 * @returns {number | null}
 */
function optionalNum(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Extract sanitized provider & third-party API quota readings from Hub stats.
 * Never includes emails or credential strings.
 * @param {any} stats
 * @param {{ thirdPartyOnly?: boolean, maxProviders?: number }} [options]
 */
function extractLimitsSummary(stats, options = {}) {
  const thirdPartyOnly = options.thirdPartyOnly === true;
  const requestedMax = options.maxProviders;
  const maxProviders = typeof requestedMax === 'number' && Number.isInteger(requestedMax) && requestedMax > 0
    ? requestedMax
    : 32;
  const rawProviders = Array.isArray(stats?.limits?.providers) ? stats.limits.providers : [];
  /** @type {any[]} */
  const providers = [];
  let healthyAccounts = 0;
  let thirdPartyCount = 0;
  /** @type {number | null} */
  let tightestUsedPct = null;

  for (const row of rawProviders) {
    if (!isPlainObject(row)) continue;
    const provider = cleanText(row.provider, 48);
    if (!provider) continue;
    const isThirdParty = provider === 'thirdparty';
    if (thirdPartyOnly && !isThirdParty) continue;
    if (isThirdParty) thirdPartyCount += 1;

    const status = cleanText(row.status, 32) || 'unknown';
    const stale = row.stale === true;
    if (status === 'ok' && !stale) healthyAccounts += 1;

    const balance = isPlainObject(row.balance)
      ? {
          amount: optionalNum(row.balance.amount),
          currency: cleanText(row.balance.currency, 12) || 'USD',
          todaySpend: optionalNum(row.balance.todaySpend),
          monthSpend: optionalNum(row.balance.monthSpend),
          allTimeSpend: optionalNum(row.balance.allTimeSpend),
          limit: optionalNum(row.balance.limit)
        }
      : null;

    const windows = Array.isArray(row.windows)
      ? row.windows.slice(0, 4).map((/** @type {any} */ w) => {
          const rawUsed = optionalNum(w?.usedPercent);
          const rawRem = optionalNum(w?.remainingPercent);
          const usedPct = rawUsed !== null ? Number(rawUsed.toFixed(1)) : null;
          const remainingPct = rawRem !== null
            ? Number(rawRem.toFixed(1))
            : usedPct !== null
              ? Number(Math.max(0, 100 - usedPct).toFixed(1))
              : null;
          if (usedPct !== null && (tightestUsedPct === null || usedPct > tightestUsedPct)) {
            tightestUsedPct = usedPct;
          }
          return {
            label: cleanText(w?.label || w?.kind || w?.limitId, 64),
            metric: cleanText(w?.metric, 24) || 'percent',
            usedPercent: usedPct,
            remainingPercent: remainingPct,
            resetsAt: cleanText(w?.resetsAt, 48) || null
          };
        })
      : [];

    if (providers.length < maxProviders) {
      providers.push({
        provider,
        adapterId: cleanText(row.adapterId, 32) || null,
        label: safeDigestLabel([row.accountLabel, row.profileName, row.accountName, row.planLabel], provider),
        planLabel: safeDigestLabel([row.planLabel], '') || null,
        status,
        stale,
        isThirdParty,
        updatedAt: cleanText(row.updatedAt, 48) || null,
        balance,
        windows
      });
    }
  }

  return {
    totalAccounts: providers.length,
    healthyAccounts,
    thirdPartyCount,
    tightestUsedPct,
    providers
  };
}

/**
 * @param {any} stats
 * @param {any} limitsSummary
 */
function buildRealtimeOverviewSnapshot(stats, limitsSummary) {
  const today = stats?.periods?.today || {};
  const month = stats?.periods?.month || {};
  const allTime = stats?.periods?.allTime || {};
  const devices = Array.isArray(stats?.devices) ? stats.devices : [];
  return {
    updatedAt: cleanText(stats?.updatedAt || new Date().toISOString(), 48),
    deviceCount: devices.length,
    activeDeviceCount: devices.filter((/** @type {any} */ d) => d?.stale !== true).length,
    today: {
      totalTokens: Math.round(num(today.totalTokens)),
      knownCostUsd: Number(num(today.costUsd).toFixed(4)),
      sessionCount: today.sessions && typeof today.sessions === 'object' ? Object.keys(today.sessions).length : 0
    },
    month: {
      totalTokens: Math.round(num(month.totalTokens)),
      knownCostUsd: Number(num(month.costUsd).toFixed(4)),
      sessionCount: month.sessions && typeof month.sessions === 'object' ? Object.keys(month.sessions).length : 0
    },
    allTime: {
      totalTokens: Math.round(num(allTime.totalTokens)),
      knownCostUsd: Number(num(allTime.costUsd).toFixed(4))
    },
    limits: limitsSummary
  };
}

/**
 * Build system + user messages for third-party AI analysis.
 * @param {{
 *   report: any,
 *   stats?: any,
 *   limitsSummary?: any,
 *   question?: string,
 *   language?: string,
 *   customPrompt?: string
 * }} params
 */
function buildAiReportPromptPayload({
  report,
  stats = null,
  limitsSummary = null,
  question = '',
  language = 'zh-CN',
  customPrompt = ''
}) {
  const resolvedLimits = limitsSummary || (stats ? extractLimitsSummary(stats) : { providers: [], totalAccounts: 0 });
  const realtime = stats ? buildRealtimeOverviewSnapshot(stats, resolvedLimits) : null;
  const compactReport = {
    reportId: report?.reportId,
    granularity: report?.granularity,
    period: report?.period,
    hub: report?.hub,
    coverage: report?.coverage,
    summary: report?.summary,
    topProjects: Array.isArray(report?.projects) ? report.projects.slice(0, 12) : [],
    clients: Array.isArray(report?.clients) ? report.clients.slice(0, 10) : [],
    models: Array.isArray(report?.models) ? report.models.slice(0, 12) : [],
    devices: Array.isArray(report?.devices) ? report.devices.slice(0, 12) : [],
    signals: Array.isArray(report?.signals) ? report.signals : []
  };

  const isChinese = language === 'zh-CN' || (language === 'auto' && !question) || /[\u4e00-\u9fff]/u.test(String(question || ''));
  const baseSystem = isChinese
    ? [
        '你是 Token Monitor 的资深 AI 工程效能与成本分析师。',
        '请基于给定的标准化用量报告、实时设备汇总及第三方 API/订阅额度快照，输出清晰、客观、可执行的分析总结。',
        '规则：',
        '1. 严格以数据为准，不编造报告中不存在的数字、项目或账号。',
        '2. 输出结构化 Markdown，包含：核心结论、项目与研发重点、模型/缓存效率诊断、第三方 API 与额度健康度、优化建议。',
        '3. 控制篇幅在 450-900 中文字左右，适合在桌面端、Android 端及微信消息中阅读。'
      ].join('\n')
    : [
        'You are a senior AI engineering productivity and cost analyst for Token Monitor.',
        'Analyze the provided structured usage report, live device telemetry, and API/provider quota snapshot.',
        'Rules:',
        '1. Ground every statement strictly in the provided data; never invent metrics or accounts.',
        '2. Return concise Markdown covering: Executive Takeaways, Project Focus, Tool/Model & Cache Efficiency, Provider/Third-Party API Quotas, and Actionable Recommendations.',
        '3. Keep output concise (~250-500 words) so it reads cleanly in Desktop, Android, and WeChat.'
      ].join('\n');

  const systemPrompt = cleanText(customPrompt, 2000)
    ? `${baseSystem}\n\nAdditional operator instructions:\n${cleanText(customPrompt, 2000)}`
    : baseSystem;

  const cleanQuestion = cleanText(question, 1000);
  const contextPayload = {
    report: compactReport,
    ...(realtime ? { realtime } : {}),
    ...(!realtime && resolvedLimits ? { limits: resolvedLimits } : {})
  };

  const userPrompt = cleanQuestion
    ? `User question: ${cleanQuestion}\n\nReport & Telemetry JSON:\n${JSON.stringify(contextPayload, null, 2)}`
    : `Analyze this Token Monitor report and live telemetry:\n\n${JSON.stringify(contextPayload, null, 2)}`;

  return {
    systemPrompt,
    userPrompt,
    language: isChinese ? 'zh-CN' : 'en'
  };
}

/**
 * Extract assistant text, token usage, and reasoning-exhaustion metadata from an AI completion payload.
 * @param {'openai-compatible' | 'anthropic-messages'} protocol
 * @param {any} data
 */
function extractAiCompletionOutcome(protocol, data) {
  let summaryMarkdown = '';
  let tokenUsage = null;
  let reasoningExhausted = false;

  if (protocol === 'anthropic-messages') {
    const blocks = Array.isArray(data?.content) ? data.content : [];
    summaryMarkdown = blocks
      .filter((/** @type {any} */ b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((/** @type {any} */ b) => b.text)
      .join('\n')
      .trim();
    const hasThinking = blocks.some(
      (/** @type {any} */ b) => b && b.type === 'thinking' && typeof b.thinking === 'string' && b.thinking.trim()
    );
    if (!summaryMarkdown && data?.stop_reason === 'max_tokens' && hasThinking) {
      reasoningExhausted = true;
    }
    if (isPlainObject(data?.usage)) {
      const inTok = Math.max(0, Math.round(num(data.usage.input_tokens)));
      const outTok = Math.max(0, Math.round(num(data.usage.output_tokens)));
      tokenUsage = { inputTokens: inTok, outputTokens: outTok, totalTokens: inTok + outTok };
    }
  } else {
    const choice = Array.isArray(data?.choices) ? data.choices[0] : null;
    const msgContent = choice?.message?.content;
    if (typeof msgContent === 'string') {
      summaryMarkdown = msgContent.trim();
    } else if (Array.isArray(msgContent)) {
      summaryMarkdown = msgContent
        .filter((b) => b && typeof b.text === 'string')
        .map((b) => b.text)
        .join('\n')
        .trim();
    }
    const finishReason = cleanText(choice?.finish_reason, 32).toLowerCase();
    const reasoningContent = typeof choice?.message?.reasoning_content === 'string'
      ? choice.message.reasoning_content.trim()
      : '';
    if (!summaryMarkdown && finishReason === 'length' && reasoningContent) {
      reasoningExhausted = true;
    }
    if (isPlainObject(data?.usage)) {
      const inTok = Math.max(0, Math.round(num(data.usage.prompt_tokens ?? data.usage.input_tokens)));
      const outTok = Math.max(0, Math.round(num(data.usage.completion_tokens ?? data.usage.output_tokens)));
      const totalTok = Math.max(inTok + outTok, Math.round(num(data.usage.total_tokens)));
      tokenUsage = { inputTokens: inTok, outputTokens: outTok, totalTokens: totalTok };
    }
  }

  return { summaryMarkdown, tokenUsage, reasoningExhausted };
}

/**
 * Call a third-party AI API to analyze a report + live telemetry.
 * @param {{
 *   config: any,
 *   apiKey?: string,
 *   report: any,
 *   stats?: any,
 *   question?: string,
 *   language?: string,
 *   fetchImpl?: typeof fetch,
 *   timeoutMs?: number,
 *   now?: () => Date
 * }} options
 * @returns {Promise<{ ok: true, analysis: any } | { ok: false, error: string, message: string, statusCode?: number }>}
 */
async function invokeThirdPartyAiAnalysis({
  config,
  apiKey = '',
  report,
  stats = null,
  question = '',
  language,
  fetchImpl = globalThis.fetch,
  timeoutMs = 60_000,
  now = () => new Date()
}) {
  const norm = normalizeAiIntegrationConfig(config);
  if (!norm.enabled) {
    return { ok: false, error: 'ai_disabled', message: 'Third-party AI analysis is disabled.' };
  }
  if (!norm.baseUrl || !norm.model) {
    return { ok: false, error: 'ai_not_configured', message: 'Third-party AI base URL and model are required.' };
  }
  const endpoint = resolveAiCompletionEndpoint(norm.protocol, norm.baseUrl);
  if (!endpoint) {
    return { ok: false, error: 'ai_invalid_url', message: 'Invalid third-party AI base URL.' };
  }
  const trimmedKey = cleanText(apiKey, 2048);
  if (!trimmedKey && !isLoopbackUrl(endpoint)) {
    return { ok: false, error: 'ai_missing_key', message: 'Third-party AI API key is required for non-local endpoints.' };
  }
  if (typeof fetchImpl !== 'function') {
    return { ok: false, error: 'fetch_unavailable', message: 'HTTP fetch client is unavailable.' };
  }

  const limitsSummary = stats ? extractLimitsSummary(stats) : null;
  const prompt = buildAiReportPromptPayload({
    report,
    stats,
    limitsSummary,
    question,
    language: language || norm.language,
    customPrompt: norm.customPrompt
  });

  /** @type {Record<string, string>} */
  const headers = { 'content-type': 'application/json' };
  if (norm.protocol === 'anthropic-messages') {
    if (trimmedKey) headers['x-api-key'] = trimmedKey;
    headers['anthropic-version'] = '2023-06-01';
  } else if (trimmedKey) {
    headers.authorization = `Bearer ${trimmedKey}`;
  }

  const resolvedTimeoutMs = Math.max(2000, Number(timeoutMs) || 60_000);

  /**
   * @param {number} maxTokens
   * @returns {Promise<
   *   | { ok: true, data: any, summaryMarkdown: string, tokenUsage: any, reasoningExhausted: boolean }
   *   | { ok: false, error: string, message: string, statusCode?: number }
   * >}
   */
  async function executeCompletion(maxTokens) {
    const requestBody = norm.protocol === 'anthropic-messages'
      ? {
          model: norm.model,
          max_tokens: maxTokens,
          temperature: norm.temperature,
          system: prompt.systemPrompt,
          messages: [{ role: 'user', content: prompt.userPrompt }]
        }
      : {
          model: norm.model,
          temperature: norm.temperature,
          max_tokens: maxTokens,
          messages: [
            { role: 'system', content: prompt.systemPrompt },
            { role: 'user', content: prompt.userPrompt }
          ]
        };

    let response;
    let data;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(resolvedTimeoutMs)
      });
      const text = await response.text();
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = { rawText: text };
      }
    } catch (error) {
      return {
        ok: false,
        error: 'ai_network_error',
        message: redactSecrets(error instanceof Error ? error.message : String(error), [trimmedKey])
      };
    }

    if (!response.ok) {
      const remoteMsg = data?.error?.message || data?.message || data?.rawText || `HTTP ${response.status}`;
      return {
        ok: false,
        error: 'ai_http_error',
        statusCode: response.status,
        message: redactSecrets(String(remoteMsg).slice(0, 400), [trimmedKey])
      };
    }

    return {
      ok: true,
      data,
      ...extractAiCompletionOutcome(norm.protocol, data)
    };
  }

  let attempt = await executeCompletion(norm.maxTokens);
  if (!attempt.ok) return attempt;

  if (!attempt.summaryMarkdown && attempt.reasoningExhausted && norm.maxTokens < 8192) {
    const retryMaxTokens = Math.min(16384, Math.max(8192, norm.maxTokens * 2));
    const retryAttempt = await executeCompletion(retryMaxTokens);
    if (!retryAttempt.ok) return retryAttempt;
    attempt = retryAttempt;
  }

  if (!attempt.summaryMarkdown) {
    if (attempt.reasoningExhausted) {
      return {
        ok: false,
        error: 'ai_token_limit',
        message: 'Third-party AI reasoning exhausted max_tokens before generating output. Increase maxTokens or switch to a standard chat model.'
      };
    }
    return {
      ok: false,
      error: 'ai_empty_response',
      message: 'Third-party AI API returned no text content.'
    };
  }

  return {
    ok: true,
    analysis: {
      schemaVersion: 1,
      generatedAt: now().toISOString(),
      protocol: norm.protocol,
      providerLabel: norm.providerLabel || (norm.protocol === 'anthropic-messages' ? 'Anthropic API' : 'OpenAI-Compatible API'),
      model: cleanText(attempt.data?.model, 160) || norm.model,
      language: prompt.language,
      question: cleanText(question, 1000) || null,
      summaryMarkdown: attempt.summaryMarkdown.slice(0, 16_000),
      tokenUsage: attempt.tokenUsage,
      basedOnSignature: report ? reportContentSignature(report) : ''
    }
  };
}

/**
 * Format a compact WeChat-friendly digest for OpenClaw or WeChat bots.
 * Avoids wide markdown tables so messages stay readable inside WeChat chat bubbles.
 * @param {{
 *   report: any,
 *   analysis?: any,
 *   stats?: any,
 *   limitsSummary?: any,
 *   includeLimits?: boolean,
 *   includeAiAnalysis?: boolean,
 *   maxChars?: number
 * }} params
 * @returns {string}
 */
function formatOpenClawWeChatMessage({
  report,
  analysis = null,
  stats = null,
  limitsSummary = null,
  includeLimits = true,
  includeAiAnalysis = true,
  maxChars = 3500
}) {
  const granLabel = report?.granularity === 'daily'
    ? '日报'
    : report?.granularity === 'weekly'
      ? '周报'
      : '月报';
  const period = report?.period || {};
  const summary = report?.summary || {};
  const hub = report?.hub || {};
  const projects = Array.isArray(report?.projects) ? report.projects : [];
  const clients = Array.isArray(report?.clients) ? report.clients : [];
  const models = Array.isArray(report?.models) ? report.models : [];
  const signals = Array.isArray(report?.signals) ? report.signals : [];
  const limits = includeLimits
    ? (limitsSummary || (stats ? extractLimitsSummary(stats) : null))
    : null;

  /** @type {string[]} */
  const lines = [];
  lines.push(`📊 Token Monitor ${granLabel} (${period.label || period.key || report?.reportId || ''})`);
  if (period.startDate && period.endDate) {
    lines.push(`周期：${period.startDate} ~ ${period.endDate}${period.isCurrent ? '（当期实时）' : '（已归档）'} · 设备：${hub.activeDeviceCount ?? 0}/${hub.deviceCount ?? 0}`);
  }
  lines.push('');
  lines.push(`🔢 总用量：${formatCompactTokens(summary.totalTokens)} tokens · 已知费用 ${formatMoney(summary.knownCostUsd)} · 缓存命中 ${Number(summary.cacheHitRatePct || 0).toFixed(1)}%`);
  if (summary.comparison) {
    const c = summary.comparison;
    const pct = c.tokenDeltaPct === null || c.tokenDeltaPct === undefined ? '—' : `${c.tokenDeltaPct >= 0 ? '+' : ''}${c.tokenDeltaPct.toFixed(1)}%`;
    lines.push(`📈 较上期(${c.previousPeriodKey})：${c.tokenDelta >= 0 ? '+' : ''}${formatCompactTokens(c.tokenDelta)} tokens (${pct})`);
  }

  if (projects.length > 0) {
    lines.push('');
    lines.push('📁 项目 Top 5：');
    for (const [idx, proj] of projects.slice(0, 5).entries()) {
      const topTool = proj.clients?.[0]?.client ? ` · ${proj.clients[0].client}` : '';
      lines.push(`${idx + 1}. ${proj.label}: ${formatCompactTokens(proj.tokens)} (${Number(proj.tokenSharePct || 0).toFixed(1)}%, ${formatMoney(proj.costUsd)}${topTool})`);
    }
  }

  if (clients.length > 0 || models.length > 0) {
    lines.push('');
    if (clients.length > 0) {
      lines.push(`🛠 工具：${clients.slice(0, 4).map((/** @type {any} */ c) => `${c.client} ${Number(c.tokenSharePct || 0).toFixed(0)}%`).join(' / ')}`);
    }
    if (models.length > 0) {
      lines.push(`🤖 模型：${models.slice(0, 4).map((/** @type {any} */ m) => `${m.model} ${Number(m.tokenSharePct || 0).toFixed(0)}%`).join(' / ')}`);
    }
  }

  if (limits && Array.isArray(limits.providers) && limits.providers.length > 0) {
    lines.push('');
    lines.push('💳 第三方 API 与额度快照：');
    const sortedLimits = [...limits.providers].sort((a, b) => Number(b.isThirdParty) - Number(a.isThirdParty));
    for (const prov of sortedLimits.slice(0, 6)) {
      const tag = prov.isThirdParty ? `[三方API${prov.adapterId ? `/${prov.adapterId}` : ''}] ` : '';
      const bal = prov.balance?.amount !== null && prov.balance?.amount !== undefined
        ? `余额 ${formatMoney(prov.balance.amount, prov.balance.currency)}`
        : '';
      const spend = prov.balance?.monthSpend !== null && prov.balance?.monthSpend !== undefined
        ? `本月 ${formatMoney(prov.balance.monthSpend, prov.balance.currency)}`
        : '';
      const tightWin = prov.windows?.[0] && prov.windows[0].remainingPercent !== null
        ? `剩余 ${prov.windows[0].remainingPercent}%`
        : '';
      const detail = [bal, spend, tightWin].filter(Boolean).join(' · ') || prov.status;
      lines.push(`• ${tag}${prov.label}: ${detail}`);
    }
  }

  if (signals.length > 0) {
    lines.push('');
    lines.push('⚡ 异常与信号：');
    for (const sig of signals.slice(0, 4)) {
      lines.push(`• [${sig.severity === 'warning' ? '注意' : '提示'}] ${sig.summary}`);
    }
  }

  const aiBlock = includeAiAnalysis && analysis?.summaryMarkdown ? String(analysis.summaryMarkdown).trim() : '';
  if (aiBlock) {
    lines.push('');
    lines.push(`🧠 AI 智能分析 (${analysis.providerLabel || analysis.model || 'AI'})：`);
    lines.push(aiBlock);
  }

  const joined = lines.join('\n');
  if (joined.length <= maxChars) return joined;
  return `${joined.slice(0, Math.max(200, maxChars - 16))}\n…(内容过长已截断)`;
}

/**
 * Collapse newlines/control chars for single-line WeChat bullets.
 * @param {any} value
 * @param {number} [maxLen]
 * @returns {string}
 */
function cleanSingleLine(value, maxLen = 200) {
  if (typeof value !== 'string') return '';
  const cleaned = value.replace(/[\r\n\t\x00-\x1f\x7f]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  return maxLen > 0 ? cleaned.slice(0, maxLen) : cleaned;
}

/**
 * Bound a WeChat digest string strictly to `maxChars` (default 3500).
 * @param {string} text
 * @param {number} [maxChars]
 * @returns {string}
 */
function truncateWeChatMessage(text, maxChars = 3500) {
  const limit = typeof maxChars === 'number' && Number.isFinite(maxChars) && maxChars > 0
    ? Math.floor(maxChars)
    : 3500;
  const raw = String(text || '');
  if (raw.length <= limit) return raw;
  const suffix = '\n…(内容过长已截断)';
  if (limit <= 1) return raw.slice(0, limit);
  if (limit <= suffix.length + 8) {
    let head = raw.slice(0, limit - 1);
    if (/[\uD800-\uDBFF]$/u.test(head)) head = head.slice(0, -1);
    return `${head}…`;
  }
  let head = raw.slice(0, limit - suffix.length);
  if (/[\uD800-\uDBFF]$/u.test(head)) head = head.slice(0, -1);
  return `${head}${suffix}`;
}

/**
 * Parse ISO timestamp string, Date, or epoch milliseconds.
 * @param {any} value
 * @returns {number | null}
 */
function parseTimestampMs(value) {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) && ms > 0 ? ms : null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d{10,16}$/u.test(trimmed)) {
      const n = Number(trimmed);
      if (Number.isFinite(n) && n > 0) return n;
    }
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

/**
 * @param {any} value
 * @returns {string}
 */
function formatTimestampLabel(value) {
  if (typeof value === 'number' || value instanceof Date) {
    const ms = parseTimestampMs(value);
    return ms !== null ? new Date(ms).toISOString() : '';
  }
  if (typeof value === 'string') {
    const trimmed = cleanSingleLine(value, 64);
    if (!trimmed) return '';
    if (/^\d{10,16}$/u.test(trimmed)) {
      const ms = parseTimestampMs(trimmed);
      return ms !== null ? new Date(ms).toISOString() : '';
    }
    return parseTimestampMs(trimmed) !== null ? trimmed : '';
  }
  return '';
}

/**
 * @param {number} ms
 * @returns {string}
 */
function formatDurationCompact(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const totalMin = Math.floor(totalSec / 60);
  const remSec = totalSec % 60;
  if (totalMin < 60) return remSec > 0 ? `${totalMin}m ${remSec}s` : `${totalMin}m`;
  const hours = Math.floor(totalMin / 60);
  const remMin = totalMin % 60;
  return remMin > 0 ? `${hours}h ${remMin}m` : `${hours}h`;
}

/**
 * Detect email addresses, URLs with tokens/paths, or credential-shaped strings in display labels.
 * @param {any} value
 * @returns {boolean}
 */
function looksSensitiveDisplayText(value) {
  const text = cleanSingleLine(value, 256);
  if (!text) return false;
  const norm = text.normalize('NFKC');
  return norm.includes('@')
    || /https?:\/\//iu.test(norm)
    || /\b(?:bearer\s+[a-z0-9._~+/=-]{6,}|sk-[a-z0-9_-]{8,}|gh[pou]_[a-z0-9_-]{8,}|github_pat_[a-z0-9_]{8,}|xox[baprs]-[a-z0-9-]{8,}|AIza[a-z0-9_-]{16,}|ya29\.[a-z0-9._-]{8,}|eyJ[a-z0-9_-]{8,}\.[a-z0-9_-]{8,})\b/iu.test(norm);
}

/**
 * Pick the first safe non-sensitive display label from candidate values.
 * @param {any[]} candidates
 * @param {string} [fallback]
 * @returns {string}
 */
function safeDigestLabel(candidates, fallback = '') {
  for (const cand of candidates) {
    const clean = cleanSingleLine(cand, 80);
    if (clean && !looksSensitiveDisplayText(clean)) return clean;
  }
  return fallback;
}

/**
 * Scrub email addresses and token-like credentials from free-form digest text.
 * @param {string} value
 * @returns {string}
 */
function scrubSensitiveDigestText(value) {
  return String(value || '')
    .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/giu, '[REDACTED]')
    .replace(/\b(?:Bearer\s+[A-Za-z0-9._~+/=-]{6,}|sk-[A-Za-z0-9_-]{8,}|gh[pou]_[A-Za-z0-9_-]{8,}|github_pat_[A-Za-z0-9_]{8,}|xox[baprs]-[A-Za-z0-9-]{8,}|AIza[A-Za-z0-9_-]{16,}|ya29\.[A-Za-z0-9._-]{8,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})\b/giu, '[REDACTED]');
}

/**
 * Shorten opaque sha256 account identifiers to a compact 6-char fingerprint.
 * @param {any} value
 * @returns {string}
 */
function formatOpaqueAccountId(value) {
  const clean = cleanSingleLine(value, 80);
  if (!clean) return '';
  const shaMatch = /^sha256:([a-f0-9]{6,64})$/iu.exec(clean);
  if (shaMatch) return `#${shaMatch[1].slice(0, 6).toLowerCase()}`;
  return clean;
}

/**
 * Resolve sanitized display label for a provider/account without exposing email addresses.
 * @param {any} obj
 * @param {string} [fallback]
 * @returns {string}
 */
function safeAccountDisplayLabel(obj, fallback = '') {
  if (!isPlainObject(obj)) return fallback;
  const label = safeDigestLabel([
    obj.accountDisplayName,
    obj.accountLabel,
    obj.profileName,
    obj.accountName,
    obj.label,
    obj.planLabel,
    obj.accountId
  ], '');
  return label ? formatOpaqueAccountId(label) : fallback;
}

/**
 * Resolve AI summary text whether passed as a string or an analysis object.
 * @param {any} aiSummary
 * @returns {{ text: string, label: string }}
 */
function resolveAiSummaryBlock(aiSummary) {
  if (typeof aiSummary === 'string') {
    return { text: aiSummary.trim(), label: 'AI' };
  }
  if (isPlainObject(aiSummary)) {
    const label = cleanSingleLine(aiSummary.providerLabel || aiSummary.model || 'AI', 64) || 'AI';
    if (typeof aiSummary.summaryMarkdown === 'string' && aiSummary.summaryMarkdown.trim()) {
      return { text: aiSummary.summaryMarkdown.trim(), label };
    }
    if (typeof aiSummary.summary === 'string' && aiSummary.summary.trim()) {
      return { text: aiSummary.summary.trim(), label };
    }
  }
  return { text: '', label: 'AI' };
}

/**
 * Append WeChat-friendly limits snapshot bullet lines.
 * @param {string[]} lines
 * @param {any} limitsSummary
 * @param {number} [maxItems]
 */
function appendLimitsSnapshotBullets(lines, limitsSummary, maxItems = 6) {
  const providers = Array.isArray(limitsSummary?.providers) ? limitsSummary.providers : [];
  if (providers.length === 0) return;
  const sorted = [...providers].sort((a, b) => Number(b?.isThirdParty) - Number(a?.isThirdParty));
  for (const prov of sorted.slice(0, maxItems)) {
    const isThirdParty = prov?.isThirdParty === true || prov?.provider === 'thirdparty';
    const adapterId = cleanSingleLine(prov?.adapterId, 32);
    const tag = isThirdParty ? `[三方API${adapterId ? `/${adapterId}` : ''}] ` : '';
    const label = safeAccountDisplayLabel(prov, cleanSingleLine(prov?.providerLabel || prov?.provider, 64) || '未知渠道');
    const bal = optionalNum(prov?.balance?.amount);
    const cur = cleanSingleLine(prov?.balance?.currency, 12) || 'USD';
    const monthSpend = optionalNum(prov?.balance?.monthSpend);
    const tightWin = Array.isArray(prov?.windows) ? prov.windows[0] : null;
    const winRem = optionalNum(tightWin?.remainingPercent);
    const parts = [
      bal !== null ? `余额 ${formatMoney(bal, cur)}` : '',
      monthSpend !== null ? `本月 ${formatMoney(monthSpend, cur)}` : '',
      winRem !== null ? `剩余 ${Number(winRem.toFixed(1))}%` : ''
    ].filter(Boolean);
    const detail = parts.join(' · ') || cleanSingleLine(prov?.status, 32) || 'unknown';
    lines.push(`• ${tag}${label}: ${detail}`);
  }
}

/**
 * Format a WeChat-friendly digest for a completed agent session turn.
 * @param {{
 *   completion?: any,
 *   detailSummary?: any,
 *   aiSummary?: any,
 *   limitsSummary?: any,
 *   maxChars?: number
 * }} [params]
 * @returns {string}
 */
function formatOpenClawSessionCompletedMessage({
  completion = null,
  detailSummary = null,
  aiSummary = null,
  limitsSummary = null,
  maxChars = 3500
} = {}) {
  const c = isPlainObject(completion) ? completion : {};
  const client = cleanSingleLine(c.client, 48);
  const device = cleanSingleLine(c.deviceName || c.hostname || c.deviceId, 80);
  const project = cleanSingleLine(c.projectLabel || c.project, 120);
  // Respect sessionTitlesEnabled privacy gating: only read explicit string `title`, never fallback to hidden title keys.
  const sessionTitle = typeof c.title === 'string' ? cleanSingleLine(c.title, 160) : '';
  const sessionId = cleanSingleLine(c.sessionId || c.key, 96);
  const model = cleanSingleLine(c.model || c.latestModel, 80);
  const reasoningEffort = cleanSingleLine(c.reasoningEffort, 32);
  const modelDisplay = model ? (reasoningEffort ? `${model} (${reasoningEffort})` : model) : '';

  /** @type {string[]} */
  const lines = [];
  lines.push(`✅ Token Monitor 会话完成通知${client ? ` (${client})` : ''}`);

  const toolParts = [
    client ? `工具 ${client}` : '',
    modelDisplay ? `模型 ${modelDisplay}` : '',
    device ? `设备 ${device}` : ''
  ].filter(Boolean);
  if (toolParts.length > 0) {
    lines.push(`• ${toolParts.join(' · ')}`);
  }

  const contextParts = [
    project ? `项目 ${project}` : '',
    sessionTitle ? `标题 ${sessionTitle}` : (sessionId ? `会话 ${sessionId}` : '')
  ].filter(Boolean);
  if (contextParts.length > 0) {
    lines.push(`• ${contextParts.join(' · ')}`);
  }

  if (isPlainObject(c.turnDelta)) {
    const td = c.turnDelta;
    const tdTokens = optionalNum(td.totalTokens);
    const tdIn = optionalNum(td.inputTokens);
    const tdOut = optionalNum(td.outputTokens);
    const tdCost = optionalNum(td.costUsd);
    const tdMsgs = optionalNum(td.messageCount);
    const deltaParts = [
      tdTokens !== null ? `+${formatCompactTokens(tdTokens)} tokens` : '',
      (tdIn !== null || tdOut !== null)
        ? `输入 ${formatCompactTokens(tdIn ?? 0)} / 输出 ${formatCompactTokens(tdOut ?? 0)}`
        : '',
      tdCost !== null ? `费用 ${formatMoney(tdCost)}` : '',
      tdMsgs !== null && tdMsgs > 0 ? `+${Math.round(tdMsgs)} 条消息` : ''
    ].filter(Boolean);
    if (deltaParts.length > 0) {
      lines.push(`• 本轮增量：${deltaParts.join(' · ')}`);
    }
  }

  const totTokens = optionalNum(c.totalTokens);
  const totCost = optionalNum(c.costUsd);
  const cacheHit = optionalNum(c.cacheHitRatePct);
  const msgCount = optionalNum(c.messageCount);
  const totalParts = [
    totTokens !== null ? `${formatCompactTokens(totTokens)} tokens` : '',
    totCost !== null ? `费用 ${formatMoney(totCost)}` : '',
    cacheHit !== null ? `缓存命中 ${cacheHit.toFixed(1)}%` : '',
    msgCount !== null && msgCount > 0 ? `消息 ${Math.round(msgCount)} 条` : ''
  ].filter(Boolean);
  if (totalParts.length > 0) {
    lines.push(`• 会话累计：${totalParts.join(' · ')}`);
  }

  const ctxTokens = optionalNum(c.contextTokens);
  const ctxWindow = optionalNum(c.contextWindow);
  const ctxLeft = optionalNum(c.contextPercentLeft);
  if (ctxWindow !== null && ctxWindow > 0 && ctxTokens !== null) {
    const pctLeft = ctxLeft !== null
      ? Math.max(0, Math.round(ctxLeft))
      : Math.max(0, Math.round(((ctxWindow - ctxTokens) / ctxWindow) * 100));
    lines.push(`• 上下文窗口：${formatCompactTokens(ctxTokens)} / ${formatCompactTokens(ctxWindow)}（剩余 ${pctLeft}%）`);
  }

  const startedMs = parseTimestampMs(c.startedAt);
  const endedMs = parseTimestampMs(c.lastUsedAt);
  const durMs = optionalNum(c.durationMs)
    ?? (startedMs !== null && endedMs !== null && endedMs >= startedMs ? endedMs - startedMs : null);
  const lastUsedLabel = formatTimestampLabel(c.lastUsedAt);
  if (lastUsedLabel || durMs !== null) {
    const timeParts = [
      lastUsedLabel ? `完成于 ${lastUsedLabel}` : '',
      durMs !== null ? `耗时 ${formatDurationCompact(durMs)}` : ''
    ].filter(Boolean);
    lines.push(`• ${timeParts.join(' · ')}`);
  }

  if (lines.length === 1) {
    lines.push('• 状态：会话轮次已完成。');
  }

  if (typeof detailSummary === 'string' && detailSummary.trim()) {
    lines.push('');
    lines.push('📝 会话详情摘要：');
    lines.push(`• ${cleanSingleLine(detailSummary, 900)}`);
  } else if (isPlainObject(detailSummary)) {
    /** @type {string[]} */
    const detailLines = [];
    const summaryText = cleanSingleLine(detailSummary.summary || detailSummary.text, 700);
    if (summaryText) detailLines.push(`• ${summaryText}`);
    const exCount = optionalNum(detailSummary.exchangeCount ?? detailSummary.exchangesCount ?? detailSummary.turnCount);
    if (exCount !== null && exCount > 0) detailLines.push(`• 交互轮次：${Math.round(exCount)} 轮`);
    if (Array.isArray(detailSummary.tools) && detailSummary.tools.length > 0) {
      const toolNames = detailSummary.tools
        .map((/** @type {any} */ t) => cleanSingleLine(t, 48))
        .filter(Boolean)
        .slice(0, 8);
      if (toolNames.length > 0) detailLines.push(`• 调用工具：${toolNames.join('、')}`);
    }
    if (Array.isArray(detailSummary.highlights)) {
      for (const h of detailSummary.highlights.slice(0, 4)) {
        const cleanH = cleanSingleLine(h, 240);
        if (cleanH) detailLines.push(`• ${cleanH}`);
      }
    }
    const promptPreview = cleanSingleLine(detailSummary.lastPrompt || detailSummary.promptPreview, 240);
    if (promptPreview) detailLines.push(`• 最近指令：${promptPreview}`);
    if (detailLines.length > 0) {
      lines.push('');
      lines.push('📝 会话详情摘要：');
      lines.push(...detailLines);
    }
  }

  if (isPlainObject(limitsSummary) && Array.isArray(limitsSummary.providers) && limitsSummary.providers.length > 0) {
    lines.push('');
    lines.push('💳 额度快照：');
    appendLimitsSnapshotBullets(lines, limitsSummary, 4);
  }

  const ai = resolveAiSummaryBlock(aiSummary);
  if (ai.text) {
    lines.push('');
    lines.push(`🧠 AI 总结 (${ai.label})：`);
    lines.push(ai.text);
  }

  return truncateWeChatMessage(lines.join('\n'), maxChars);
}

/**
 * Format a WeChat-friendly digest for an agent tool approval alert.
 * @param {any} alert
 * @param {{ maxChars?: number }} [options]
 * @returns {string}
 */
function formatOpenClawApprovalAlertMessage(alert = {}, { maxChars = 3500 } = {}) {
  const a = isPlainObject(alert) ? alert : {};
  const client = cleanSingleLine(a.client, 48);
  const device = cleanSingleLine(a.deviceName || a.hostname || a.deviceId, 80);
  const project = cleanSingleLine(a.projectLabel || a.project, 120);
  const tool = cleanSingleLine(a.tool, 96);
  const description = cleanSingleLine(a.description || a.reason || a.summary, 400);
  const commandPreview = cleanSingleLine(a.command, 600);
  const sessionId = cleanSingleLine(a.sessionId, 96);
  const createdAtLabel = formatTimestampLabel(a.createdAt || a.timestamp);
  const expiresAtLabel = formatTimestampLabel(a.expiresAt);

  /** @type {string[]} */
  const lines = [];
  lines.push(`⚠️ Token Monitor 操作审批提醒${client ? ` (${client})` : ''}`);

  const originParts = [
    client ? `客户端 ${client}` : '',
    device ? `设备 ${device}` : ''
  ].filter(Boolean);
  if (originParts.length > 0) lines.push(`• 来源：${originParts.join(' · ')}`);
  if (project) lines.push(`• 项目：${project}`);
  if (tool) lines.push(`• 请求工具：${tool}`);
  if (description) lines.push(`• 操作说明：${description}`);
  if (commandPreview) lines.push(`• 执行内容：${commandPreview}`);
  if (sessionId) lines.push(`• 会话ID：${sessionId}`);
  if (createdAtLabel || expiresAtLabel) {
    const timeParts = [
      createdAtLabel ? `触发 ${createdAtLabel}` : '',
      expiresAtLabel ? `过期 ${expiresAtLabel}` : ''
    ].filter(Boolean);
    lines.push(`• 时间：${timeParts.join(' · ')}`);
  }
  lines.push('• 处理建议：请尽快在桌面端或终端确认是否批准执行。');

  return truncateWeChatMessage(lines.join('\n'), maxChars);
}

/**
 * Format a WeChat-friendly digest for a quota threshold alert or recovery event.
 * Never exposes raw account email addresses.
 * @param {any} alert
 * @param {{ maxChars?: number }} [options]
 * @returns {string}
 */
function formatOpenClawQuotaAlertMessage(alert = {}, { maxChars = 3500 } = {}) {
  const a = isPlainObject(alert) ? alert : {};
  const eventKind = cleanSingleLine(String(a.event || a.alertType || a.type || a.kind || a.status || 'low'), 32).toLowerCase();
  const isRecovery = eventKind === 'restored'
    || eventKind === 'recovered'
    || eventKind === 'recovery'
    || eventKind === 'full'
    || eventKind === 'ok';
  const provider = cleanSingleLine(a.provider, 48);
  const providerLabel = safeDigestLabel([a.providerLabel, a.label, a.provider], '未知渠道');
  const accountDisplay = safeAccountDisplayLabel(a);
  const adapterId = cleanSingleLine(a.adapterId, 48);
  const isThirdParty = a.isThirdParty === true || provider === 'thirdparty';

  const remainingPct = optionalNum(a.remainingPercent ?? a.remaining);
  const explicitUsedPct = optionalNum(a.usedPercent);
  const usedPct = explicitUsedPct !== null
    ? explicitUsedPct
    : (remainingPct !== null ? Number(Math.max(0, 100 - remainingPct).toFixed(1)) : null);
  const thresholdPct = optionalNum(a.thresholdPercent ?? a.threshold);
  const previousRemaining = optionalNum(a.previousRemaining ?? a.previousRemainingPercent);
  const windows = Array.isArray(a.windows) ? a.windows : [];
  const balance = isPlainObject(a.balance) ? a.balance : null;
  const observedAtLabel = formatTimestampLabel(a.observedAt || a.triggeredAt || a.updatedAt || a.timestamp);
  const summaryNote = cleanSingleLine(a.message || a.summary || a.reason, 300);

  /** @type {string[]} */
  const lines = [];
  lines.push(`${isRecovery ? '✅ Token Monitor 额度恢复通知' : '🚨 Token Monitor 额度预警'} (${providerLabel})`);

  const tag = isThirdParty ? `[三方API${adapterId ? `/${adapterId}` : ''}] ` : '';
  const acctSuffix = accountDisplay && accountDisplay !== providerLabel ? ` · 账号 ${accountDisplay}` : '';
  lines.push(`• 渠道：${tag}${providerLabel}${acctSuffix}`);

  const statusText = eventKind === 'full'
    ? '已恢复满额'
    : isRecovery
      ? '已恢复至阈值以上'
      : '低于预警阈值';
  const metricParts = [
    `状态 ${statusText}`,
    remainingPct !== null ? `剩余 ${Number(remainingPct.toFixed(1))}%` : '',
    usedPct !== null ? `已用 ${Number(usedPct.toFixed(1))}%` : '',
    thresholdPct !== null ? `阈值 ${Math.round(thresholdPct)}%` : '',
    previousRemaining !== null ? `先前 ${Number(previousRemaining.toFixed(1))}%` : ''
  ].filter(Boolean);
  lines.push(`• 额度概况：${metricParts.join(' · ')}`);

  if (balance) {
    const cur = cleanSingleLine(balance.currency, 12) || 'USD';
    const balAmt = optionalNum(balance.amount);
    const balLimit = optionalNum(balance.limit);
    const monthSpend = optionalNum(balance.monthSpend);
    const todaySpend = optionalNum(balance.todaySpend);
    const balParts = [
      balAmt !== null ? `余额 ${formatMoney(balAmt, cur)}` : '',
      balLimit !== null ? `总额度 ${formatMoney(balLimit, cur)}` : '',
      monthSpend !== null ? `本月 ${formatMoney(monthSpend, cur)}` : '',
      todaySpend !== null ? `今日 ${formatMoney(todaySpend, cur)}` : ''
    ].filter(Boolean);
    if (balParts.length > 0) {
      lines.push(`• 账户资金：${balParts.join(' · ')}`);
    }
  }

  for (const win of windows.slice(0, 6)) {
    const wLabel = cleanSingleLine(win?.displayLabel || win?.label || win?.kind || win?.limitId, 64) || '窗口';
    const wRem = optionalNum(win?.remainingPercent);
    const wUsed = optionalNum(win?.usedPercent);
    const wReset = formatTimestampLabel(win?.resetsAt);
    const wParts = [
      wRem !== null ? `剩余 ${Number(wRem.toFixed(1))}%` : '',
      wUsed !== null ? `已用 ${Number(wUsed.toFixed(1))}%` : '',
      wReset ? `重置 ${wReset}` : ''
    ].filter(Boolean);
    lines.push(`• 窗口 ${wLabel}：${wParts.join(' · ') || '状态未知'}`);
  }

  if (summaryNote) lines.push(`• 说明：${summaryNote}`);
  if (observedAtLabel) lines.push(`• 检测时间：${observedAtLabel}`);

  return truncateWeChatMessage(lines.join('\n'), maxChars);
}

/** @type {Record<string, string>} */
const SERVICE_STATUS_LABELS = Object.freeze(Object.assign(Object.create(null), {
  ok: '正常',
  operational: '正常',
  degraded: '性能降级',
  outage: '服务中断',
  major: '严重故障',
  critical: '严重中断',
  minor: '局部异常',
  maintenance: '维护中',
  unknown: '状态未知'
}));

/**
 * Format a WeChat-friendly digest for an upstream AI service status incident or recovery.
 * @param {any} incident
 * @param {{ maxChars?: number }} [options]
 * @returns {string}
 */
function formatOpenClawServiceIncidentMessage(incident = {}, { maxChars = 3500 } = {}) {
  const inc = isPlainObject(incident) ? incident : {};
  const hasExplicitService = Boolean(
    cleanSingleLine(inc.serviceName || inc.providerLabel || inc.label || inc.service || inc.provider, 80)
  );
  const serviceName = cleanSingleLine(
    inc.serviceName || inc.providerLabel || inc.label || inc.service || inc.provider || inc.id || inc.name,
    80
  ) || '未知服务';
  const status = cleanSingleLine(inc.status, 32).toLowerCase();
  const previousStatus = cleanSingleLine(inc.previousStatus, 32).toLowerCase();
  const indicator = cleanSingleLine(inc.indicator || inc.severity, 32).toLowerCase();
  const eventKind = cleanSingleLine(inc.event || inc.eventType, 32).toLowerCase();

  const isResolved = inc.resolved === true
    || eventKind === 'resolved'
    || status === 'ok'
    || status === 'operational'
    || indicator === 'none';
  const isOutage = !isResolved && (status === 'outage' || indicator === 'critical' || indicator === 'major');
  const icon = isResolved ? '🟢' : isOutage ? '🔴' : '🟠';
  const statusLabel = (Object.hasOwn(SERVICE_STATUS_LABELS, status) && SERVICE_STATUS_LABELS[status])
    || (Object.hasOwn(SERVICE_STATUS_LABELS, indicator) && SERVICE_STATUS_LABELS[indicator])
    || (isResolved ? '已恢复正常' : '服务异常');

  const rawTitle = cleanSingleLine(
    inc.incidentTitle || inc.title || inc.headline || (hasExplicitService ? inc.name : ''),
    200
  );
  const incidentTitle = rawTitle && rawTitle !== serviceName ? rawTitle : '';
  const description = cleanSingleLine(inc.description || inc.summary || inc.message, 400);
  const rawComponents = Array.isArray(inc.componentIssues)
    ? inc.componentIssues
    : Array.isArray(inc.affectedComponents)
      ? inc.affectedComponents
      : Array.isArray(inc.components)
        ? inc.components
        : [];
  const components = rawComponents
    .slice(0, 6)
    .map((/** @type {any} */ comp) => {
      if (typeof comp === 'string') return cleanSingleLine(comp, 64);
      if (!isPlainObject(comp)) return '';
      const name = cleanSingleLine(comp.name || comp.component || comp.id, 64);
      const compStatus = cleanSingleLine(comp.status, 32);
      if (!name) return '';
      return compStatus ? `${name} (${compStatus})` : name;
    })
    .filter(Boolean);

  const incidentCount = optionalNum(inc.incidentCount);
  const maintenanceCount = optionalNum(inc.maintenanceCount);
  const pageUrl = normalizeHttpUrl(inc.pageUrl || inc.url);
  const timeLabel = formatTimestampLabel(inc.updatedAt || inc.checkedAt || inc.timestamp);

  /** @type {string[]} */
  const lines = [];
  lines.push(`${icon} Token Monitor ${isResolved ? '服务状态恢复' : '服务故障告警'} (${serviceName})`);
  const prevLabel = Object.hasOwn(SERVICE_STATUS_LABELS, previousStatus)
    ? SERVICE_STATUS_LABELS[previousStatus]
    : previousStatus;
  const prevNote = previousStatus && previousStatus !== status
    ? `（原状态：${prevLabel}）`
    : '';
  lines.push(`• 服务与状态：${serviceName} · ${statusLabel}${prevNote}`);
  if (incidentTitle) lines.push(`• 事件标题：${incidentTitle}`);
  if (description && description !== incidentTitle) lines.push(`• 状态描述：${description}`);
  if (components.length > 0) lines.push(`• 受影响组件：${components.join('、')}`);
  if ((incidentCount !== null && incidentCount > 0) || (maintenanceCount !== null && maintenanceCount > 0)) {
    const countParts = [
      incidentCount !== null && incidentCount > 0 ? `活跃事件 ${Math.round(incidentCount)}` : '',
      maintenanceCount !== null && maintenanceCount > 0 ? `维护中 ${Math.round(maintenanceCount)}` : ''
    ].filter(Boolean);
    lines.push(`• 影响计数：${countParts.join(' · ')}`);
  }
  if (pageUrl) lines.push(`• 状态页：${pageUrl}`);
  if (timeLabel) lines.push(`• 更新时间：${timeLabel}`);

  return truncateWeChatMessage(lines.join('\n'), maxChars);
}

/**
 * Identify credential, token, or email keys to exclude from generic digest fallbacks
 * without suppressing legitimate token usage counter keys (`totalTokens`, `tokens`, etc.).
 * @param {string} key
 * @returns {boolean}
 */
function isSensitiveDigestKey(key) {
  const lower = String(key || '').trim().toLowerCase();
  if (!lower) return false;
  const compact = lower.replace(/[_-]+/gu, '');
  return compact === 'token'
    || compact.endsWith('bottoken')
    || compact.endsWith('hooktoken')
    || compact.endsWith('accesstoken')
    || compact.endsWith('refreshtoken')
    || compact.endsWith('authtoken')
    || compact.endsWith('bearertoken')
    || compact.endsWith('sessiontoken')
    || compact.endsWith('idtoken')
    || compact.endsWith('apitoken')
    || compact.endsWith('csrftoken')
    || compact.includes('email')
    || compact.includes('apikey')
    || compact.includes('accountkey')
    || compact.includes('secret')
    || compact.includes('password')
    || compact.includes('passwd')
    || compact.includes('credential')
    || compact.includes('authorization')
    || compact.includes('cookie')
    || compact.includes('privatekey');
}

/**
 * Format a WeChat-friendly digest for unified OpenClaw data query results.
 * Uses bullet lists only (no wide Markdown tables) and strips sensitive keys.
 * @param {{
 *   queryType?: string,
 *   result?: any,
 *   title?: string,
 *   aiSummary?: any,
 *   maxChars?: number
 * }} [params]
 * @returns {string}
 */
function formatOpenClawQueryDigestMessage({
  queryType = '',
  result = null,
  title = '',
  aiSummary = null,
  maxChars = 3500
} = {}) {
  const cleanQueryType = cleanSingleLine(queryType, 64);
  const cleanTitle = cleanSingleLine(title, 120);
  /** @type {string[]} */
  const lines = [];
  lines.push(cleanTitle ? `📋 ${cleanTitle}` : `📋 Token Monitor 查询摘要${cleanQueryType ? ` (${cleanQueryType})` : ''}`);

  if (result === null || result === undefined) {
    lines.push('• 暂无查询结果数据。');
  } else if (typeof result === 'string') {
    const text = scrubSensitiveDigestText(result.trim());
    if (text) lines.push(`• ${cleanSingleLine(text, 1200)}`);
    else lines.push('• 暂无查询结果数据。');
  } else if (Array.isArray(result)) {
    if (result.length === 0) {
      lines.push('• 列表为空。');
    } else {
      for (const [idx, item] of result.slice(0, 10).entries()) {
        if (isPlainObject(item)) {
          const itemLabel = safeAccountDisplayLabel(item)
            || safeDigestLabel([item.name, item.model, item.client, item.project, item.date, item.month, item.key, item.deviceId], '')
            || `条目 ${idx + 1}`;
          const toks = optionalNum(item.totalTokens ?? item.tokens);
          const cost = optionalNum(item.costUsd ?? item.knownCostUsd);
          const parts = [
            toks !== null ? `${formatCompactTokens(toks)} tokens` : '',
            cost !== null ? formatMoney(cost) : ''
          ].filter(Boolean);
          lines.push(`${idx + 1}. ${itemLabel}${parts.length ? `: ${parts.join(' · ')}` : ''}`);
        } else {
          lines.push(`${idx + 1}. ${cleanSingleLine(scrubSensitiveDigestText(String(item)), 200)}`);
        }
      }
    }
  } else if (isPlainObject(result)) {
    let renderedStructured = false;

    if (isPlainObject(result.period)) {
      const p = result.period;
      const pLabel = cleanSingleLine(p.label || p.key || p.range || p.period, 80);
      const pRange = p.startDate && p.endDate ? `${p.startDate} ~ ${p.endDate}` : '';
      const pLine = [pLabel, pRange].filter(Boolean).join(' · ');
      if (pLine) {
        lines.push(`• 统计周期：${pLine}`);
        renderedStructured = true;
      }
    } else if (isPlainObject(result.range) && (result.range.from || result.range.to)) {
      const rFrom = cleanSingleLine(result.range.from, 32) || '最早';
      const rTo = cleanSingleLine(result.range.to, 32) || '最新';
      lines.push(`• 查询范围：${rFrom} ~ ${rTo}`);
      renderedStructured = true;
    }

    const totals = isPlainObject(result.totals) ? result.totals : (
      optionalNum(result.totalTokens) !== null ? result : null
    );
    if (totals && optionalNum(totals.totalTokens ?? totals.tokens) !== null) {
      const tTokens = optionalNum(totals.totalTokens ?? totals.tokens) ?? 0;
      const tCost = optionalNum(totals.knownCostUsd ?? totals.costUsd);
      const tCache = optionalNum(totals.cacheHitRatePct);
      const tSpeed = optionalNum(totals.avgOutputTokensPerSec);
      const favModel = cleanSingleLine(totals.favoriteModel, 64);
      const tParts = [
        `总用量 ${formatCompactTokens(tTokens)} tokens`,
        tCost !== null ? `费用 ${formatMoney(tCost)}` : '',
        tCache !== null ? `缓存命中 ${tCache.toFixed(1)}%` : '',
        tSpeed !== null && tSpeed > 0 ? `均速 ${tSpeed.toFixed(1)} tok/s` : '',
        favModel ? `主力模型 ${favModel}` : ''
      ].filter(Boolean);
      lines.push(`• ${tParts.join(' · ')}`);
      renderedStructured = true;
    }

    const streaksObj = isPlainObject(result.streaks) ? result.streaks : result;
    if (optionalNum(result.activeDays) !== null || isPlainObject(result.peakDay)) {
      const curStreak = optionalNum(streaksObj.currentStreak);
      const longStreak = optionalNum(streaksObj.longestStreak);
      const histParts = [
        optionalNum(result.activeDays) !== null ? `活跃天数 ${Math.round(Number(result.activeDays))} 天` : '',
        curStreak !== null ? `当前连续 ${Math.round(curStreak)} 天` : '',
        longStreak !== null ? `最长连续 ${Math.round(longStreak)} 天` : ''
      ].filter(Boolean);
      if (histParts.length > 0) {
        lines.push(`• ${histParts.join(' · ')}`);
        renderedStructured = true;
      }
      if (isPlainObject(result.peakDay) && (result.peakDay.date || optionalNum(result.peakDay.totalTokens ?? result.peakDay.tokens) !== null)) {
        const pkDate = cleanSingleLine(result.peakDay.date, 32) || '峰值';
        const pkTokens = optionalNum(result.peakDay.totalTokens ?? result.peakDay.tokens);
        lines.push(`• 峰值日：${pkDate}${pkTokens !== null ? ` (${formatCompactTokens(pkTokens)} tokens)` : ''}`);
        renderedStructured = true;
      }
    }

    const isLiveRateShape = result.state === 'unavailable'
      || result.speed !== undefined
      || result.burn !== undefined
      || result.fallbackAvgOutputTokensPerSec !== undefined;
    if (isLiveRateShape && !Array.isArray(result.sessions)) {
      const rateState = cleanSingleLine(result.state, 32);
      const rateReason = cleanSingleLine(result.reason, 48);
      const speedVal = optionalNum(result.speed?.outputTokensPerSec ?? result.speed?.tokensPerSec ?? result.speed);
      const burnVal = optionalNum(result.burn?.costPerHour ?? result.burn?.usdPerHour ?? result.burn);
      const fallbackRate = optionalNum(result.fallbackAvgOutputTokensPerSec);
      const devCount = optionalNum(result.deviceCount);
      const rateParts = [
        rateState ? `状态 ${rateState}${rateReason ? ` (${rateReason})` : ''}` : '',
        speedVal !== null ? `输出速率 ${speedVal.toFixed(1)} tok/s` : '',
        burnVal !== null ? `消耗速率 ${formatMoney(burnVal)}/h` : '',
        fallbackRate !== null && fallbackRate > 0 ? `平均速率 ${fallbackRate.toFixed(1)} tok/s` : '',
        devCount !== null ? `设备 ${Math.round(devCount)} 台` : ''
      ].filter(Boolean);
      if (rateParts.length > 0) {
        lines.push(`• 实时速率：${rateParts.join(' · ')}`);
        renderedStructured = true;
      }
    }

    const breakdownRows = Array.isArray(result.rows) && result.rows.length > 0
      ? result.rows
      : Array.isArray(result.breakdown) && result.breakdown.length > 0
        ? result.breakdown
        : Array.isArray(result.items)
          ? result.items
          : Array.isArray(result.days)
            ? result.days
            : null;
    if (breakdownRows && breakdownRows.length > 0) {
      lines.push('');
      lines.push('📌 明细 Top 10：');
      for (const [idx, row] of breakdownRows.slice(0, 10).entries()) {
        const label = safeDigestLabel([
          row?.label,
          row?.hostname,
          row?.deviceName,
          row?.model,
          row?.client,
          row?.project,
          row?.date,
          row?.month,
          row?.key,
          row?.deviceId
        ], `第 ${idx + 1} 项`);
        const toks = optionalNum(row?.tokens ?? row?.totalTokens);
        const cost = optionalNum(row?.costUsd ?? row?.knownCostUsd);
        const share = optionalNum(row?.tokenSharePct ?? row?.sharePct);
        const rowParts = [
          toks !== null ? `${formatCompactTokens(toks)} tokens` : '',
          share !== null ? `${share.toFixed(1)}%` : '',
          cost !== null ? formatMoney(cost) : ''
        ].filter(Boolean);
        lines.push(`${idx + 1}. ${label}${rowParts.length ? `: ${rowParts.join(' · ')}` : ''}`);
      }
      renderedStructured = true;
    }

    if (Array.isArray(result.sessions) && result.sessions.length > 0) {
      lines.push('');
      lines.push(`💬 会话列表（展示 ${Math.min(10, result.sessions.length)}/${optionalNum(result.total) ?? result.sessions.length}）：`);
      for (const [idx, sess] of result.sessions.slice(0, 10).entries()) {
        const state = cleanSingleLine(sess?.activityState || sess?.state || sess?.sessionActivityState, 24);
        const client = cleanSingleLine(sess?.client, 32);
        const model = cleanSingleLine(sess?.latestModel || sess?.model, 64);
        const project = cleanSingleLine(sess?.projectLabel || sess?.project, 64);
        const sessTitle = typeof sess?.title === 'string' && !looksSensitiveDisplayText(sess.title)
          ? cleanSingleLine(sess.title, 80)
          : '';
        const toks = optionalNum(sess?.totalTokens ?? sess?.tokens);
        const cost = optionalNum(sess?.costUsd);
        const label = sessTitle || project || safeDigestLabel([sess?.sessionId, sess?.key], `会话 ${idx + 1}`);
        const meta = [
          state ? `[${state}]` : '',
          client,
          model,
          toks !== null ? `${formatCompactTokens(toks)} tokens` : '',
          cost !== null ? formatMoney(cost) : ''
        ].filter(Boolean).join(' · ');
        lines.push(`${idx + 1}. ${label}${meta ? ` — ${meta}` : ''}`);
      }
      renderedStructured = true;
    }

    if (Array.isArray(result.devices) && result.devices.length > 0) {
      lines.push('');
      const devTotal = optionalNum(result.deviceCount) ?? result.devices.length;
      const devActive = optionalNum(result.activeDeviceCount);
      const devHeader = devActive !== null
        ? `🖥 设备状态（在线 ${Math.round(devActive)}/${Math.round(devTotal)} 台）：`
        : `🖥 设备状态（${result.devices.length} 台）：`;
      lines.push(devHeader);
      for (const dev of result.devices.slice(0, 10)) {
        const name = safeDigestLabel([dev?.hostname, dev?.deviceName, dev?.deviceId], '未知设备');
        const platform = cleanSingleLine(dev?.osName || dev?.platform, 48);
        const statusText = dev?.stale === true ? '离线/过期' : '在线';
        const trackedCount = Array.isArray(dev?.trackedClients) ? dev.trackedClients.length : null;
        const attentionCount = optionalNum(dev?.clientHealthSummary?.attention);
        const devParts = [
          statusText,
          platform,
          trackedCount !== null ? `监控工具 ${trackedCount} 个` : '',
          attentionCount !== null && attentionCount > 0 ? `异常 ${Math.round(attentionCount)} 项` : ''
        ].filter(Boolean);
        lines.push(`• ${name}：${devParts.join(' · ')}`);
      }
      renderedStructured = true;
    }

    if (Array.isArray(result.providers) && result.providers.length > 0) {
      lines.push('');
      const healthy = optionalNum(result.healthyAccounts);
      const totalAcc = optionalNum(result.totalAccounts) ?? result.providers.length;
      const limitHeader = healthy !== null
        ? `💳 渠道与额度概览（正常 ${Math.round(healthy)}/${Math.round(totalAcc)}）：`
        : '💳 渠道与额度概览：';
      lines.push(limitHeader);
      appendLimitsSnapshotBullets(lines, result, 8);
      renderedStructured = true;
    }

    const monthlyTotal = optionalNum(result.monthlyTotalUsd ?? result.monthlyAmountUsd);
    if ((Array.isArray(result.subscriptions) && result.subscriptions.length > 0)
      || (Array.isArray(result.forecasts) && result.forecasts.length > 0)
      || monthlyTotal !== null) {
      if (monthlyTotal !== null) {
        const activeSub = optionalNum(result.activeCount);
        const totalSub = optionalNum(result.totalCount);
        const countSuffix = activeSub !== null && totalSub !== null
          ? `（生效 ${Math.round(activeSub)}/${Math.round(totalSub)}）`
          : '';
        lines.push(`• 月度订阅合计：${formatMoney(monthlyTotal)}${countSuffix}`);
      }
      if (Array.isArray(result.subscriptions) && result.subscriptions.length > 0) {
        lines.push('');
        lines.push('📅 订阅计划：');
        for (const sub of result.subscriptions.slice(0, 6)) {
          const providerDisp = safeDigestLabel([sub?.providerLabel, sub?.provider], '');
          const planDisp = safeDigestLabel([sub?.planName, sub?.name, sub?.label], '');
          const sName = providerDisp && planDisp && providerDisp !== planDisp
            ? `${providerDisp} (${planDisp})`
            : (planDisp || providerDisp || '订阅');
          const amt = optionalNum(sub?.amountUnits ?? sub?.amountUsd ?? sub?.amount);
          const subMonthly = optionalNum(sub?.monthlyAmountUsd);
          const cur = cleanSingleLine(sub?.currency, 12) || 'USD';
          const renew = cleanSingleLine(sub?.nextRenewalDate, 32);
          const daysLeft = optionalNum(sub?.daysUntilRenewal);
          const fc = isPlainObject(sub?.forecast) ? sub.forecast : null;
          const fcDays = optionalNum(fc?.daysRemaining);
          const fcBurn = optionalNum(fc?.dailyBurn);
          const fcExhaust = cleanSingleLine(fc?.exhaustDate, 32);
          const fcParts = fc && fc.status === 'available'
            ? [
                fcDays !== null ? `预计可用 ${Math.round(fcDays)} 天` : '',
                fcBurn !== null ? `日均 ${formatMoney(fcBurn, cleanSingleLine(fc.balanceCurrency, 12) || cur)}` : '',
                fcExhaust ? `耗尽 ${fcExhaust}` : ''
              ].filter(Boolean)
            : (fc && fc.status && fc.status !== 'notApplicable' ? [`预测 ${cleanSingleLine(fc.status, 24)}`] : []);
          const sParts = [
            amt !== null ? formatMoney(amt, cur) : '',
            subMonthly !== null && (cur !== 'USD' || amt === null) ? `折合月均 ${formatMoney(subMonthly)}` : '',
            renew ? `续费 ${renew}` : '',
            daysLeft !== null ? `距续费 ${Math.round(daysLeft)} 天` : '',
            ...fcParts
          ].filter(Boolean);
          lines.push(`• ${sName}${sParts.length ? `：${sParts.join(' · ')}` : ''}`);
        }
      }
      if (Array.isArray(result.forecasts) && result.forecasts.length > 0) {
        lines.push('');
        lines.push('⏳ 额度耗尽预测：');
        for (const fc of result.forecasts.slice(0, 6)) {
          const fName = safeAccountDisplayLabel(fc, cleanSingleLine(fc?.provider, 64) || '账户');
          const burn = optionalNum(fc?.dailyBurn);
          const days = optionalNum(fc?.daysRemaining);
          const exhaustDate = cleanSingleLine(fc?.exhaustDate, 32);
          const fStatus = cleanSingleLine(fc?.status, 32);
          const fParts = [
            burn !== null ? `日均 ${formatMoney(burn)}` : '',
            days !== null ? `预计可用 ${Math.round(days)} 天` : '',
            exhaustDate ? `预计耗尽 ${exhaustDate}` : '',
            fStatus
          ].filter(Boolean);
          lines.push(`• ${fName}${fParts.length ? `：${fParts.join(' · ')}` : ''}`);
        }
      }
      renderedStructured = true;
    }

    const summaryNote = cleanSingleLine(scrubSensitiveDigestText(String(result.summary || result.message || result.text || '')), 500);
    if (summaryNote) {
      lines.push(`• 摘要：${summaryNote}`);
      renderedStructured = true;
    }

    if (!renderedStructured) {
      const hasEmptyCollection = (Array.isArray(result.rows) && result.rows.length === 0)
        || (Array.isArray(result.items) && result.items.length === 0)
        || (Array.isArray(result.sessions) && result.sessions.length === 0)
        || (Array.isArray(result.devices) && result.devices.length === 0)
        || (Array.isArray(result.providers) && result.providers.length === 0)
        || (Array.isArray(result.subscriptions) && result.subscriptions.length === 0);
      if (hasEmptyCollection) {
        lines.push('• 查询结果为空（0 条记录）。');
      } else {
        for (const [k, v] of Object.entries(result)) {
          if (isSensitiveDigestKey(k)) continue;
          if (v === null || v === undefined || typeof v === 'object') continue;
          const cleanVal = cleanSingleLine(scrubSensitiveDigestText(String(v)), 200);
          lines.push(`• ${cleanSingleLine(k, 48)}: ${cleanVal}`);
          if (lines.length >= 16) break;
        }
        if (lines.length === 1) {
          lines.push('• 已完成查询（无可展示明细）。');
        }
      }
    }
  } else {
    lines.push(`• 结果：${cleanSingleLine(scrubSensitiveDigestText(String(result)), 500)}`);
  }

  const ai = resolveAiSummaryBlock(aiSummary);
  if (ai.text) {
    lines.push('');
    lines.push(`🧠 AI 智能解读 (${ai.label})：`);
    lines.push(ai.text);
  }

  return truncateWeChatMessage(lines.join('\n'), maxChars);
}

/**
 * Resolve normalized OpenClaw webhook eventType.
 * @param {any} eventType
 * @returns {'report' | 'session_completed' | 'approval_alert' | 'quota_alert' | 'service_incident' | 'query_digest' | 'test' | 'custom'}
 */
function resolveOpenClawEventType(eventType) {
  const clean = cleanText(eventType, 64).toLowerCase();
  if (!clean) return 'report';
  return /** @type {any} */ (OPENCLAW_EVENT_TYPES.includes(clean) ? clean : 'custom');
}

/**
 * Format event digest text for non-report events when `customMessage` is omitted.
 * @param {{
 *   eventType: string,
 *   eventPayload: any,
 *   analysis: any,
 *   limitsSummary: any
 * }} params
 * @returns {string}
 */
function formatOpenClawEventMessage({
  eventType,
  eventPayload,
  analysis,
  limitsSummary
}) {
  const payload = isPlainObject(eventPayload) ? eventPayload : {};
  if (eventType === 'session_completed') {
    const hasWrapper = Object.hasOwn(payload, 'completion')
      || Object.hasOwn(payload, 'detailSummary')
      || Object.hasOwn(payload, 'aiSummary');
    return formatOpenClawSessionCompletedMessage({
      completion: hasWrapper ? payload.completion : eventPayload,
      detailSummary: hasWrapper ? payload.detailSummary : null,
      aiSummary: (hasWrapper ? payload.aiSummary : null) ?? analysis,
      limitsSummary: (hasWrapper ? payload.limitsSummary : null) ?? limitsSummary
    });
  }
  if (eventType === 'approval_alert') {
    return formatOpenClawApprovalAlertMessage(payload.alert || eventPayload || {});
  }
  if (eventType === 'quota_alert') {
    return formatOpenClawQuotaAlertMessage(payload.alert || eventPayload || {});
  }
  if (eventType === 'service_incident') {
    return formatOpenClawServiceIncidentMessage(payload.incident || eventPayload || {});
  }
  if (eventType === 'query_digest') {
    return formatOpenClawQueryDigestMessage({
      queryType: payload.queryType || '',
      result: Object.hasOwn(payload, 'result') ? payload.result : eventPayload,
      title: payload.title || '',
      aiSummary: payload.aiSummary ?? analysis
    });
  }
  if (eventType === 'test') {
    const note = typeof eventPayload === 'string'
      ? cleanSingleLine(eventPayload, 500)
      : cleanSingleLine(payload.message || payload.text, 500);
    return truncateWeChatMessage(
      note
        ? `🔔 Token Monitor 连通性测试\n• ${note}`
        : '🔔 Token Monitor 连通性测试\n• 状态：OpenClaw 通知通道配置正常。'
    );
  }
  const customText = typeof eventPayload === 'string'
    ? eventPayload.trim()
    : cleanSingleLine(payload.text || payload.message || payload.summary, 2000);
  if (customText) {
    return truncateWeChatMessage(`🔔 Token Monitor 通知\n• ${customText}`);
  }
  if (isPlainObject(eventPayload)) {
    return formatOpenClawQueryDigestMessage({
      queryType: 'custom',
      result: eventPayload,
      title: payload.title || 'Token Monitor 自定义通知',
      aiSummary: analysis
    });
  }
  return '🔔 Token Monitor 通知\n• 状态：收到事件推送。';
}

/**
 * Build OpenClaw webhook HTTP request parameters.
 * Supports:
 * - openclaw-agent: POST /hooks/agent with { message, name, agentId, deliver, channel, to }
 * - openclaw-wake:  POST /hooks/wake with { text, mode: 'now' }
 * - generic-webhook: POST structured JSON event payload
 * @param {{
 *   config: any,
 *   hookToken?: string,
 *   report?: any,
 *   analysis?: any,
 *   stats?: any,
 *   limitsSummary?: any,
 *   eventType?: string,
 *   eventPayload?: any,
 *   promptPrefix?: string,
 *   customMessage?: string,
 *   idempotencyKey?: string
 * }} params
 */
function buildOpenClawWebhookRequest({
  config,
  hookToken = '',
  report = null,
  analysis = null,
  stats = null,
  limitsSummary = null,
  eventType = 'report',
  eventPayload = null,
  promptPrefix = '',
  customMessage = '',
  idempotencyKey = ''
}) {
  const norm = normalizeOpenClawIntegrationConfig(config);
  const endpoint = resolveOpenClawWebhookEndpoint(norm.mode, norm.webhookUrl);
  if (!endpoint) {
    return { ok: false, error: 'openclaw_invalid_url', message: 'Valid OpenClaw webhook URL is required.' };
  }
  const token = cleanText(hookToken, 2048);
  if (!token && norm.mode !== 'generic-webhook' && !isLoopbackUrl(endpoint)) {
    return { ok: false, error: 'openclaw_missing_token', message: 'OpenClaw hook token is required for non-local gateways.' };
  }

  const resolvedEventType = resolveOpenClawEventType(eventType);
  const resolvedLimits = norm.includeLimits
    ? (limitsSummary || (stats ? extractLimitsSummary(stats) : null))
    : null;
  const cleanCustomMessage = cleanText(customMessage, 4000);
  const briefText = cleanCustomMessage || (
    resolvedEventType === 'report'
      ? formatOpenClawWeChatMessage({
          report,
          analysis,
          stats,
          limitsSummary: resolvedLimits,
          includeLimits: norm.includeLimits,
          includeAiAnalysis: norm.includeAiAnalysis
        })
      : formatOpenClawEventMessage({
          eventType: resolvedEventType,
          eventPayload,
          analysis,
          limitsSummary: resolvedLimits
        })
  );

  const cleanIdempotencyKey = cleanText(idempotencyKey, 160);
  /** @type {Record<string, string>} */
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (cleanIdempotencyKey) headers['idempotency-key'] = cleanIdempotencyKey;

  let body;
  if (norm.mode === 'openclaw-agent') {
    if (norm.deliver && !norm.to) {
      return {
        ok: false,
        error: 'openclaw_missing_target',
        message: 'WeChat recipient target ("to") is required when deliver is enabled in OpenClaw agent mode.'
      };
    }
    const resolvedPrefix = typeof promptPrefix === 'string' && promptPrefix.length > 0
      ? promptPrefix
      : OPENCLAW_AGENT_PROMPT_PREFIXES[resolvedEventType] || OPENCLAW_AGENT_PROMPT_PREFIXES.custom;
    body = {
      message: `${resolvedPrefix}${briefText}`,
      name: norm.senderName,
      agentId: norm.agentId,
      deliver: norm.deliver,
      channel: norm.channel,
      ...(norm.to ? { to: norm.to } : {})
    };
  } else if (norm.mode === 'openclaw-wake') {
    body = {
      text: briefText,
      mode: 'now'
    };
  } else if (resolvedEventType === 'report' && (eventPayload === null || eventPayload === undefined)) {
    body = {
      event: 'token_monitor.report',
      reportId: report?.reportId || null,
      granularity: report?.granularity || null,
      periodKey: report?.period?.key || null,
      channel: norm.channel,
      to: norm.to || null,
      text: briefText,
      report: report || null,
      aiAnalysis: norm.includeAiAnalysis ? (analysis || null) : null,
      limitsSummary: resolvedLimits
    };
  } else {
    body = {
      event: `token_monitor.${resolvedEventType}`,
      eventType: resolvedEventType,
      eventId: cleanIdempotencyKey || null,
      channel: norm.channel,
      to: norm.to || null,
      text: briefText,
      payload: eventPayload ?? null
    };
  }

  return {
    ok: true,
    endpoint,
    mode: norm.mode,
    eventType: resolvedEventType,
    channel: norm.channel,
    to: norm.to,
    headers,
    body,
    briefText
  };
}

/**
 * Dispatch report, alert, or query digest to OpenClaw Gateway webhook.
 * @param {{
 *   config: any,
 *   hookToken?: string,
 *   report?: any,
 *   analysis?: any,
 *   stats?: any,
 *   limitsSummary?: any,
 *   eventType?: string,
 *   eventPayload?: any,
 *   promptPrefix?: string,
 *   customMessage?: string,
 *   idempotencyKey?: string,
 *   fetchImpl?: typeof fetch,
 *   timeoutMs?: number,
 *   now?: () => Date
 * }} options
 */
async function sendToOpenClawWebhook({
  config,
  hookToken = '',
  report = null,
  analysis = null,
  stats = null,
  limitsSummary = null,
  eventType = 'report',
  eventPayload = null,
  promptPrefix = '',
  customMessage = '',
  idempotencyKey = '',
  fetchImpl = globalThis.fetch,
  timeoutMs = 20_000,
  now = () => new Date()
}) {
  const norm = normalizeOpenClawIntegrationConfig(config);
  if (!norm.enabled) {
    return { ok: false, error: 'openclaw_disabled', message: 'OpenClaw WeChat integration is disabled.' };
  }
  const built = buildOpenClawWebhookRequest({
    config: norm,
    hookToken,
    report,
    analysis,
    stats,
    limitsSummary,
    eventType,
    eventPayload,
    promptPrefix,
    customMessage,
    idempotencyKey
  });
  if (!built.ok || !built.endpoint) return built;
  if (typeof fetchImpl !== 'function') {
    return { ok: false, error: 'fetch_unavailable', message: 'HTTP fetch client is unavailable.' };
  }

  const trimmedToken = cleanText(hookToken, 2048);
  try {
    const response = await fetchImpl(built.endpoint, {
      method: 'POST',
      headers: built.headers,
      body: JSON.stringify(built.body),
      signal: AbortSignal.timeout(Math.max(2000, Number(timeoutMs) || 20_000))
    });
    const text = await response.text().catch(() => '');
    if (!response.ok) {
      return {
        ok: false,
        error: 'openclaw_http_error',
        statusCode: response.status,
        message: redactSecrets(text.slice(0, 400) || `OpenClaw HTTP ${response.status}`, [trimmedToken])
      };
    }
    return {
      ok: true,
      sentAt: now().toISOString(),
      statusCode: response.status,
      mode: built.mode,
      eventType: built.eventType,
      channel: built.channel,
      to: built.to,
      reportId: report?.reportId || null,
      responsePreview: text.slice(0, 300)
    };
  } catch (error) {
    return {
      ok: false,
      error: 'openclaw_network_error',
      message: redactSecrets(error instanceof Error ? error.message : String(error), [trimmedToken])
    };
  }
}

module.exports = {
  AI_LANGUAGES,
  AI_PROTOCOLS,
  DEFAULT_AI_CONFIG,
  DEFAULT_OPENCLAW_CONFIG,
  OPENCLAW_EVENT_TYPES,
  OPENCLAW_MODES,
  buildAiReportPromptPayload,
  buildOpenClawWebhookRequest,
  buildRealtimeOverviewSnapshot,
  extractLimitsSummary,
  formatCompactTokens,
  formatOpenClawApprovalAlertMessage,
  formatOpenClawQueryDigestMessage,
  formatOpenClawQuotaAlertMessage,
  formatOpenClawServiceIncidentMessage,
  formatOpenClawSessionCompletedMessage,
  formatOpenClawWeChatMessage,
  invokeThirdPartyAiAnalysis,
  looksSensitiveDisplayText,
  mergeOpenClawIntegrationConfig,
  normalizeAiIntegrationConfig,
  normalizeHttpUrl,
  normalizeOpenClawIntegrationConfig,
  resolveAiCompletionEndpoint,
  resolveOpenClawWebhookEndpoint,
  safeAccountDisplayLabel,
  sendToOpenClawWebhook
};
