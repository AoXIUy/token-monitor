// @ts-check
'use strict';

const { num } = require('./history');
const { reportContentSignature } = require('./usageReport');

const AI_PROTOCOLS = Object.freeze(['openai-compatible', 'anthropic-messages']);
const AI_LANGUAGES = Object.freeze(['zh-CN', 'en', 'auto']);
const OPENCLAW_MODES = Object.freeze(['openclaw-agent', 'openclaw-wake', 'generic-webhook']);
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
  maxTokens: 1500,
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
  includeLimits: true
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
    ? Math.max(256, Math.min(8192, rawMaxTokens))
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
 * @param {any} raw
 */
function normalizeOpenClawIntegrationConfig(raw) {
  const src = isPlainObject(raw) ? raw : {};
  const rawMode = cleanText(src.mode, 40).toLowerCase();
  const mode = /** @type {'openclaw-agent' | 'openclaw-wake' | 'generic-webhook'} */ (
    OPENCLAW_MODES.includes(rawMode) ? rawMode : DEFAULT_OPENCLAW_CONFIG.mode
  );
  const rawGran = isPlainObject(src.pushGranularities) ? src.pushGranularities : {};
  return {
    enabled: src.enabled === true,
    mode,
    webhookUrl: normalizeHttpUrl(src.webhookUrl),
    channel: cleanText(src.channel, 64) || DEFAULT_OPENCLAW_CONFIG.channel,
    to: cleanText(src.to, 256),
    agentId: cleanText(src.agentId, 64) || DEFAULT_OPENCLAW_CONFIG.agentId,
    senderName: cleanText(src.senderName, 64) || DEFAULT_OPENCLAW_CONFIG.senderName,
    deliver: src.deliver !== false,
    pushOnRollover: src.pushOnRollover === true,
    pushGranularities: {
      daily: rawGran.daily !== false,
      weekly: rawGran.weekly !== false,
      monthly: rawGran.monthly !== false
    },
    includeAiAnalysis: src.includeAiAnalysis !== false,
    includeLimits: src.includeLimits !== false
  };
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
        label: cleanText(row.accountLabel || row.profileName || row.accountName || row.planLabel || provider, 80),
        planLabel: cleanText(row.planLabel, 48) || null,
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
 */
async function invokeThirdPartyAiAnalysis({
  config,
  apiKey = '',
  report,
  stats = null,
  question = '',
  language,
  fetchImpl = globalThis.fetch,
  timeoutMs = 45_000,
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
  let requestBody;
  if (norm.protocol === 'anthropic-messages') {
    if (trimmedKey) headers['x-api-key'] = trimmedKey;
    headers['anthropic-version'] = '2023-06-01';
    requestBody = {
      model: norm.model,
      max_tokens: norm.maxTokens,
      temperature: norm.temperature,
      system: prompt.systemPrompt,
      messages: [{ role: 'user', content: prompt.userPrompt }]
    };
  } else {
    if (trimmedKey) headers.authorization = `Bearer ${trimmedKey}`;
    requestBody = {
      model: norm.model,
      temperature: norm.temperature,
      max_tokens: norm.maxTokens,
      messages: [
        { role: 'system', content: prompt.systemPrompt },
        { role: 'user', content: prompt.userPrompt }
      ]
    };
  }

  let response;
  let data;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(Math.max(2000, Number(timeoutMs) || 45_000))
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

  let summaryMarkdown = '';
  let tokenUsage = null;
  if (norm.protocol === 'anthropic-messages') {
    const blocks = Array.isArray(data?.content) ? data.content : [];
    summaryMarkdown = blocks
      .filter((/** @type {any} */ b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((/** @type {any} */ b) => b.text)
      .join('\n')
      .trim();
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
    if (isPlainObject(data?.usage)) {
      const inTok = Math.max(0, Math.round(num(data.usage.prompt_tokens ?? data.usage.input_tokens)));
      const outTok = Math.max(0, Math.round(num(data.usage.completion_tokens ?? data.usage.output_tokens)));
      const totalTok = Math.max(inTok + outTok, Math.round(num(data.usage.total_tokens)));
      tokenUsage = { inputTokens: inTok, outputTokens: outTok, totalTokens: totalTok };
    }
  }

  if (!summaryMarkdown) {
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
      model: cleanText(data?.model, 160) || norm.model,
      language: prompt.language,
      question: cleanText(question, 1000) || null,
      summaryMarkdown: summaryMarkdown.slice(0, 16_000),
      tokenUsage,
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

  const resolvedLimits = norm.includeLimits
    ? (limitsSummary || (stats ? extractLimitsSummary(stats) : null))
    : null;
  const briefText = cleanText(customMessage, 4000) || formatOpenClawWeChatMessage({
    report,
    analysis,
    stats,
    limitsSummary: resolvedLimits,
    includeLimits: norm.includeLimits,
    includeAiAnalysis: norm.includeAiAnalysis
  });

  /** @type {Record<string, string>} */
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (idempotencyKey) headers['idempotency-key'] = cleanText(idempotencyKey, 160);

  let body;
  if (norm.mode === 'openclaw-agent') {
    if (norm.deliver && !norm.to) {
      return {
        ok: false,
        error: 'openclaw_missing_target',
        message: 'WeChat recipient target ("to") is required when deliver is enabled in OpenClaw agent mode.'
      };
    }
    const promptPrefix = '请将以下 Token Monitor 用量与项目分析简报清晰准确地整理并发送给微信用户（保留核心数字与结论，不要遗漏预警）：\n\n';
    body = {
      message: `${promptPrefix}${briefText}`,
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
  } else {
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
  }

  return {
    ok: true,
    endpoint,
    mode: norm.mode,
    channel: norm.channel,
    to: norm.to,
    headers,
    body,
    briefText
  };
}

/**
 * Dispatch report + telemetry digest to OpenClaw Gateway webhook.
 * @param {{
 *   config: any,
 *   hookToken?: string,
 *   report?: any,
 *   analysis?: any,
 *   stats?: any,
 *   limitsSummary?: any,
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
  OPENCLAW_MODES,
  buildAiReportPromptPayload,
  buildOpenClawWebhookRequest,
  buildRealtimeOverviewSnapshot,
  extractLimitsSummary,
  formatCompactTokens,
  formatOpenClawWeChatMessage,
  invokeThirdPartyAiAnalysis,
  normalizeAiIntegrationConfig,
  normalizeHttpUrl,
  normalizeOpenClawIntegrationConfig,
  resolveAiCompletionEndpoint,
  resolveOpenClawWebhookEndpoint,
  sendToOpenClawWebhook
};
