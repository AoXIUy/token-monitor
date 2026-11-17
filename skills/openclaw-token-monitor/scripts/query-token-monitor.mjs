#!/usr/bin/env node
'use strict';

/**
 * Zero-dependency OpenClaw Skill CLI helper for Token Monitor Main Hub & Local Bridge.
 * Supports TOKEN_MONITOR_HUB_URL (or local loopback bridge URL) and
 * TOKEN_MONITOR_HUB_SECRET / TOKEN_MONITOR_SECRET environment variables.
 */

const DEFAULT_HUB_URL = 'http://127.0.0.1:17321';
const MAX_TEXT_CHARS = 3500;

const BOOLEAN_FLAGS = new Set([
  'help',
  'json',
  'refresh',
  'force',
  'third-party-only',
  'thirdPartyOnly',
  'history',
  'include-history',
  'includeHistory',
  'include-conversation',
  'includeConversation',
  'include-ai',
  'includeAi',
  'include-limits',
  'includeLimits',
  'no-ai',
  'no-limits',
  'no-diagnostics',
  'no-forecasts',
  'active-only',
  'activeOnly',
  'no-reset-forecast',
  'no-approvals',
  'test'
]);

function parseCliArgs(argv) {
  const positionals = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '-h') {
      flags.help = true;
      continue;
    }
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const eq = token.indexOf('=');
    if (eq !== -1) {
      flags[token.slice(2, eq)] = token.slice(eq + 1);
      continue;
    }
    const key = token.slice(2);
    if (BOOLEAN_FLAGS.has(key)) {
      flags[key] = true;
      continue;
    }
    if (i + 1 < argv.length && !argv[i + 1].startsWith('--') && argv[i + 1] !== '-h') {
      flags[key] = argv[i + 1];
      i += 1;
    } else {
      flags[key] = true;
    }
  }
  return { command: positionals[0] || 'brief', positionals, flags };
}

function flagValue(flags, ...keys) {
  for (const key of keys) {
    if (Object.hasOwn(flags, key) && flags[key] !== undefined) {
      return flags[key];
    }
  }
  return undefined;
}

function flagString(flags, ...keys) {
  const val = flagValue(flags, ...keys);
  if (val === undefined || val === null || val === true || val === false) return '';
  return String(val).trim();
}

function flagBool(flags, keys, defaultValue) {
  for (const key of keys) {
    if (!Object.hasOwn(flags, key) || flags[key] === undefined) continue;
    const raw = flags[key];
    if (typeof raw === 'boolean') return raw;
    const norm = String(raw).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(norm)) return true;
    if (['0', 'false', 'no', 'off'].includes(norm)) return false;
  }
  return defaultValue;
}

function flagPositiveInt(flags, keys) {
  const raw = flagString(flags, ...keys);
  if (!raw) return undefined;
  const num = Number(raw);
  if (!Number.isInteger(num) || num < 1) {
    throw new Error(`Invalid positive integer for --${keys[0]}: ${raw}`);
  }
  return num;
}

function flagNonNegInt(flags, keys) {
  const raw = flagString(flags, ...keys);
  if (!raw) return undefined;
  const num = Number(raw);
  if (!Number.isInteger(num) || num < 0) {
    throw new Error(`Invalid non-negative integer for --${keys[0]}: ${raw}`);
  }
  return num;
}

function resolveFormat(flags, defaultFormat = 'json', allowed = ['text', 'json']) {
  if (flagBool(flags, ['json'], false)) return 'json';
  const raw = flagString(flags, 'format');
  if (!raw) return defaultFormat;
  const norm = raw.toLowerCase();
  if (!allowed.includes(norm)) {
    throw new Error(`Invalid --format "${raw}". Expected: ${allowed.join(' | ')}`);
  }
  return norm;
}

function normalizeHubUrl(rawUrl) {
  let urlStr = String(rawUrl || DEFAULT_HUB_URL).trim();
  if (!urlStr) urlStr = DEFAULT_HUB_URL;
  urlStr = urlStr.replace(/\/+$/, '');
  if (urlStr.endsWith('/api/mcp')) {
    urlStr = urlStr.slice(0, -'/api/mcp'.length);
  }
  let parsed;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error(`Invalid Hub URL "${rawUrl}". Expected http(s)://host[:port].`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported Hub URL protocol "${parsed.protocol}". Use http:// or https://.`);
  }
  return urlStr;
}

function resolveConnection(flags) {
  const rawUrl = flagString(flags, 'hub-url', 'hubUrl')
    || process.env.TOKEN_MONITOR_HUB_URL
    || process.env.TOKEN_MONITOR_LOCAL_BRIDGE_URL
    || DEFAULT_HUB_URL;
  const hubUrl = normalizeHubUrl(rawUrl);
  const secret = (
    flagString(flags, 'secret')
    || process.env.TOKEN_MONITOR_HUB_SECRET
    || process.env.TOKEN_MONITOR_SECRET
    || ''
  ).trim();
  return { hubUrl, secret };
}

function buildQueryPath(pathname, params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

function formatHubError(status, parsed, rawText, pathWithQuery) {
  const code = typeof parsed === 'object' && parsed ? String(parsed.error || '') : '';
  const serverMsg = typeof parsed === 'object' && parsed ? String(parsed.message || parsed.error || '') : String(rawText || '');

  if (status === 401) {
    return 'Hub 401: Unauthorized. Set TOKEN_MONITOR_HUB_SECRET (or TOKEN_MONITOR_SECRET / --secret) to match your Hub or Desktop local bridge token.';
  }

  if (status === 403) {
    if (code === 'conversation_text_disabled') {
      return 'Hub 403 (conversation_text_disabled): Conversation text queries are disabled by privacy settings. Enable "Allow conversation text queries" (openclaw.queryPermissions.allowConversationText) in Token Monitor OpenClaw settings, or omit --include-conversation.';
    }
    if (code === 'session_detail_disabled' || pathWithQuery.startsWith('/api/query/session-detail')) {
      return `Hub 403 (${code || 'session_detail_disabled'}): Session detail queries are disabled by privacy settings. Enable "Allow session detail queries" (openclaw.queryPermissions.allowSessionDetail) in Token Monitor OpenClaw settings.`;
    }
    return `Hub 403 (${code || 'forbidden'}): ${serverMsg || 'Access denied by server policy.'}`;
  }

  if (status === 501 && pathWithQuery.startsWith('/api/query/session-detail')) {
    return `Hub 501 (${code || 'unavailable'}): ${serverMsg || 'Session detail reader is only available on Desktop Host mode or Desktop Local Bridge.'}`;
  }

  return `Hub ${status}: ${serverMsg || 'request failed'}`;
}

async function callHub(connection, method, pathWithQuery, body) {
  const headers = { accept: 'application/json' };
  if (connection.secret) headers.authorization = `Bearer ${connection.secret}`;
  if (body !== undefined) headers['content-type'] = 'application/json';

  const res = await fetch(`${connection.hubUrl}${pathWithQuery}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(45_000)
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    throw new Error(formatHubError(res.status, parsed, text, pathWithQuery));
  }
  return parsed;
}

function optionalNum(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function cleanSingleLine(value, maxLen = 160) {
  const text = typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : '';
  return maxLen > 0 ? text.slice(0, maxLen) : text;
}

function looksSensitiveText(value) {
  const s = cleanSingleLine(value, 256);
  if (!s) return false;
  return s.includes('@') || /https?:\/\//i.test(s) || /\b(?:bearer|sk-[a-z0-9_-]{10,})\b/i.test(s);
}

function safeDisplayLabel(candidates, fallback) {
  for (const cand of candidates) {
    const clean = cleanSingleLine(cand, 120);
    if (clean && !looksSensitiveText(clean)) return clean;
  }
  return fallback;
}

function formatTokens(value) {
  const n = optionalNum(value);
  if (n === null) return '0';
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2).replace(/\.?0+$/u, '')}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2).replace(/\.?0+$/u, '')}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/u, '')}K`;
  return String(Math.round(n));
}

function formatMoney(amount, currency = 'USD') {
  const n = optionalNum(amount);
  if (n === null) return '—';
  const cur = cleanSingleLine(currency, 12).toUpperCase() || 'USD';
  if (cur === 'CREDITS') return `${n.toFixed(2)} credits`;
  if (cur === 'CNY') return `¥${n.toFixed(2)}`;
  if (cur === 'USD') return `$${n.toFixed(2)}`;
  return `${cur} ${n.toFixed(2)}`;
}

function formatDurationMs(ms) {
  const n = optionalNum(ms);
  if (n === null || n < 0) return '';
  const totalSec = Math.round(n / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const mins = Math.floor(totalSec / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours < 24) return remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remMins > 0 || remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}

function formatTimeShort(value) {
  if (value === null || value === undefined || value === '') return '';
  const ms = typeof value === 'number' ? value : (/^\d+$/u.test(String(value).trim()) ? Number(value) : Date.parse(String(value)));
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + 'Z';
}

function truncateText(text, maxChars = MAX_TEXT_CHARS) {
  const raw = String(text || '').trim();
  if (raw.length <= maxChars) return raw;
  return `${raw.slice(0, Math.max(0, maxChars - 16)).trimEnd()}\n…（内容已截断）`;
}

function formatUsageText(data) {
  const p = data?.period || {};
  const t = data?.totals || {};
  const rangeStr = p.startDate && p.endDate
    ? (p.startDate === p.endDate ? p.startDate : `${p.startDate} ~ ${p.endDate}`)
    : '';
  const headerLabel = cleanSingleLine(p.label || p.key || p.id || 'usage', 64);
  const lines = [`📊 Token Monitor 用量统计 (${headerLabel}${rangeStr && rangeStr !== headerLabel ? ` · ${rangeStr}` : ''})`];

  if (p.deviceId) {
    lines.push(`• 设备筛选：${cleanSingleLine(p.deviceId, 80)}${p.deviceFound === false ? '（未找到）' : ''}`);
  }
  const totalParts = [
    `总用量 ${formatTokens(t.totalTokens)} tokens`,
    optionalNum(t.knownCostUsd) !== null ? `费用 ${formatMoney(t.knownCostUsd)}` : '',
    optionalNum(t.cacheHitRatePct) !== null ? `缓存命中 ${Number(t.cacheHitRatePct).toFixed(1)}%` : '',
    optionalNum(t.avgOutputTokensPerSec) > 0 ? `均速 ${Number(t.avgOutputTokensPerSec).toFixed(1)} tok/s` : '',
    optionalNum(t.unpricedTokens) > 0 ? `未定价 ${formatTokens(t.unpricedTokens)}` : ''
  ].filter(Boolean);
  lines.push(`• ${totalParts.join(' · ')}`);

  const compParts = [
    optionalNum(t.inputTokens) > 0 ? `输入 ${formatTokens(t.inputTokens)}` : '',
    optionalNum(t.outputTokens) > 0 ? `输出 ${formatTokens(t.outputTokens)}` : '',
    optionalNum(t.cacheReadTokens) > 0 ? `缓存读取 ${formatTokens(t.cacheReadTokens)}` : '',
    optionalNum(t.cacheWriteTokens) > 0 ? `缓存写入 ${formatTokens(t.cacheWriteTokens)}` : '',
    optionalNum(t.activeDays) > 0 ? `活跃 ${Math.round(t.activeDays)} 天` : ''
  ].filter(Boolean);
  if (compParts.length > 0) lines.push(`• 明细构成：${compParts.join(' · ')}`);

  const rows = Array.isArray(data?.rows) ? data.rows : [];
  if (rows.length > 0) {
    lines.push('');
    lines.push(`📌 分组明细 (${cleanSingleLine(data.groupBy, 24) || 'rows'})：`);
    for (const [idx, row] of rows.slice(0, 12).entries()) {
      const label = safeDisplayLabel([
        row?.model,
        row?.client,
        row?.label,
        row?.hostname,
        row?.deviceName,
        row?.key,
        row?.deviceId
      ], `第 ${idx + 1} 项`);
      const toks = optionalNum(row?.totalTokens ?? row?.tokens);
      const cost = optionalNum(row?.knownCostUsd ?? row?.costUsd);
      const share = optionalNum(row?.tokenSharePct ?? row?.sharePct);
      const speed = optionalNum(row?.avgOutputTokensPerSec);
      const parts = [
        toks !== null ? `${formatTokens(toks)} tokens` : '',
        share !== null ? `${share.toFixed(1)}%` : '',
        cost !== null ? formatMoney(cost) : '',
        speed !== null && speed > 0 ? `${speed.toFixed(1)} tok/s` : '',
        row?.stale === true ? '离线' : ''
      ].filter(Boolean);
      lines.push(`${idx + 1}. ${label}${parts.length ? `: ${parts.join(' · ')}` : ''}`);
    }
    if (data.truncated) {
      lines.push(`• 共 ${data.totalRows} 项，当前展示前 ${rows.length} 项。`);
    }
  } else if (data?.groupBy && data.groupBy !== 'summary') {
    lines.push('• 该分组下暂无记录。');
  }
  if (p.incomplete) {
    lines.push('⚠️ 注意：部分历史或项目归因数据不完整。');
  }
  return truncateText(lines.join('\n'));
}

function formatSessionsText(data) {
  const sessions = Array.isArray(data?.sessions) ? data.sessions : [];
  const total = optionalNum(data?.total) ?? sessions.length;
  const lines = [`💬 会话列表 (${cleanSingleLine(data?.period, 16) || 'today'} · 状态 ${cleanSingleLine(data?.state, 16) || 'all'} · 共 ${total} 个)`];
  if (data?.sessionTitlesEnabled === false) {
    lines.push('• 隐私策略：当前未开启会话标题同步，仅展示项目与会话 ID。');
  }
  if (sessions.length === 0) {
    lines.push('• 暂无符合条件的会话。');
    return truncateText(lines.join('\n'));
  }
  for (const [idx, s] of sessions.slice(0, 15).entries()) {
    const state = cleanSingleLine(s?.activityState || s?.state, 20) || 'idle';
    const title = typeof s?.title === 'string' && !looksSensitiveText(s.title) ? cleanSingleLine(s.title, 80) : '';
    const project = cleanSingleLine(s?.projectLabel || s?.projectKey, 64);
    const sid = cleanSingleLine(s?.sessionId || s?.key, 48);
    const label = title || project || sid || `会话 ${idx + 1}`;
    const client = cleanSingleLine(s?.client, 32);
    const model = cleanSingleLine(s?.latestModel, 48);
    const toks = formatTokens(s?.totalTokens);
    const cost = optionalNum(s?.costUsd);
    const ctxLeft = optionalNum(s?.context?.percentLeft);
    const parts = [
      `[${state}]`,
      client,
      model,
      `${toks} tokens`,
      cost !== null ? formatMoney(cost) : '',
      ctxLeft !== null ? `上下文余 ${Math.round(ctxLeft)}%` : '',
      project && title ? `项目 ${project}` : '',
      sid && label !== sid ? `ID:${sid.slice(0, 18)}` : ''
    ].filter(Boolean);
    lines.push(`${idx + 1}. ${label} — ${parts.join(' · ')}`);
  }
  if (data?.hasMore && data?.nextCursor) {
    lines.push(`• 还有更多会话，下一页游标：--cursor ${data.nextCursor}`);
  }
  return truncateText(lines.join('\n'));
}

function formatSessionDetailText(data) {
  const client = cleanSingleLine(data?.client, 32);
  const sid = cleanSingleLine(data?.sessionId, 64);
  const title = typeof data?.title === 'string' && !looksSensitiveText(data.title) ? cleanSingleLine(data.title, 100) : '';
  const lines = [`🔍 会话详情 (${client || 'session'}${sid ? ` · ${sid}` : ''})`];
  if (title) lines.push(`• 标题：${title}`);
  if (data?.found === false) {
    lines.push('• 未找到该会话的本地明细记录。');
    return truncateText(lines.join('\n'));
  }
  const totals = data?.totals || {};
  const totalParts = [
    optionalNum(totals.total ?? totals.totalTokens) !== null ? `总用量 ${formatTokens(totals.total ?? totals.totalTokens)} tokens` : '',
    optionalNum(totals.costUsd) !== null ? `费用 ${formatMoney(totals.costUsd)}` : '',
    Array.isArray(data?.exchanges) ? `交互 ${data.exchanges.length} 轮` : ''
  ].filter(Boolean);
  if (totalParts.length > 0) lines.push(`• ${totalParts.join(' · ')}`);

  const exchanges = Array.isArray(data?.exchanges) ? data.exchanges : [];
  for (const [idx, ex] of exchanges.slice(0, 8).entries()) {
    const promptText = typeof ex?.prompt === 'string' ? cleanSingleLine(ex.prompt, 120) : '';
    const tools = Array.isArray(ex?.tools) ? ex.tools.slice(0, 5).map((t) => cleanSingleLine(t, 32)).filter(Boolean) : [];
    const exToks = optionalNum(ex?.tokens?.total ?? ex?.totalTokens);
    const meta = [
      exToks !== null ? `${formatTokens(exToks)} tokens` : '',
      tools.length > 0 ? `工具: ${tools.join(', ')}` : ''
    ].filter(Boolean);
    lines.push(`${idx + 1}. ${promptText || `第 ${idx + 1} 轮`}${meta.length ? ` (${meta.join(' · ')})` : ''}`);
  }
  const messages = Array.isArray(data?.conversation?.messages)
    ? data.conversation.messages
    : (Array.isArray(data?.messages) ? data.messages : []);
  if (messages.length > 0) {
    lines.push('');
    lines.push('💬 对话片段：');
    for (const msg of messages.slice(0, 6)) {
      const role = cleanSingleLine(msg?.role, 16) || 'msg';
      const content = cleanSingleLine(msg?.text || msg?.content, 160);
      if (content) lines.push(`• [${role}] ${content}`);
    }
  }
  return truncateText(lines.join('\n'));
}

function formatHistoryText(data) {
  const res = cleanSingleLine(data?.resolution, 24) || 'daily';
  const from = cleanSingleLine(data?.range?.from, 32) || '最早';
  const to = cleanSingleLine(data?.range?.to, 32) || '最新';
  const lines = [`📈 历史趋势 (${res} · ${from} ~ ${to})`];
  const t = data?.totals || {};
  const parts = [
    `总用量 ${formatTokens(t.totalTokens)} tokens`,
    optionalNum(t.knownCostUsd) !== null ? `费用 ${formatMoney(t.knownCostUsd)}` : '',
    optionalNum(data?.activeDays) !== null ? `活跃 ${Math.round(data.activeDays)} 天` : '',
    optionalNum(data?.streaks?.currentStreak) !== null ? `当前连续 ${Math.round(data.streaks.currentStreak)} 天` : '',
    optionalNum(data?.streaks?.longestStreak) !== null ? `最长连续 ${Math.round(data.streaks.longestStreak)} 天` : ''
  ].filter(Boolean);
  lines.push(`• ${parts.join(' · ')}`);
  if (data?.peakDay?.date) {
    lines.push(`• 峰值日：${data.peakDay.date} (${formatTokens(data.peakDay.totalTokens)} tokens)`);
  }
  if (t.favoriteModel) lines.push(`• 主力模型：${cleanSingleLine(t.favoriteModel, 80)}`);

  const breakdown = Array.isArray(data?.breakdown) && data.breakdown.length > 0 ? data.breakdown : null;
  const rows = breakdown || (Array.isArray(data?.rows) ? data.rows : []);
  if (rows.length > 0) {
    lines.push('');
    lines.push(breakdown ? `📌 分组汇总 (${data.groupBy})：` : '📌 近期记录：');
    for (const [idx, row] of rows.slice(-10).entries()) {
      const label = safeDisplayLabel([row?.client, row?.model, row?.date, row?.month], `#${idx + 1}`);
      const toks = formatTokens(row?.totalTokens ?? row?.tokens);
      const cost = optionalNum(row?.knownCostUsd ?? row?.costUsd);
      lines.push(`• ${label}: ${toks} tokens${cost !== null ? ` · ${formatMoney(cost)}` : ''}`);
    }
  }
  return truncateText(lines.join('\n'));
}

function formatDevicesText(data) {
  const devices = Array.isArray(data?.devices) ? data.devices : [];
  const lines = [`🖥 设备与采集健康 (在线 ${data?.activeDeviceCount ?? 0}/${data?.deviceCount ?? devices.length})`];
  if (devices.length === 0) {
    lines.push('• 暂无已连接设备记录。');
    return truncateText(lines.join('\n'));
  }
  for (const dev of devices.slice(0, 12)) {
    const name = safeDisplayLabel([dev?.hostname, dev?.deviceId], '未知设备');
    const osText = [cleanSingleLine(dev?.osName, 32), cleanSingleLine(dev?.osVersion, 32)].filter(Boolean).join(' ')
      || cleanSingleLine(dev?.platform, 32);
    const statusText = dev?.stale ? '离线/过期' : '在线';
    const tracked = Array.isArray(dev?.trackedClients) ? dev.trackedClients.join(', ') : '';
    const attention = optionalNum(dev?.clientHealthSummary?.attention);
    const parts = [
      statusText,
      osText,
      tracked ? `工具: ${tracked}` : '',
      attention !== null && attention > 0 ? `异常 ${Math.round(attention)} 项` : '',
      dev?.wslStatus?.state && dev.wslStatus.state !== 'disabled' ? `WSL:${dev.wslStatus.state}` : ''
    ].filter(Boolean);
    lines.push(`• ${name}：${parts.join(' · ')}`);
  }
  return truncateText(lines.join('\n'));
}

function formatLimitsText(data) {
  const providers = Array.isArray(data?.providers) ? data.providers : [];
  const totalAcc = optionalNum(data?.totalAccounts) ?? providers.length;
  const healthyAcc = optionalNum(data?.healthyAccounts);
  const headerCount = healthyAcc !== null ? `正常 ${Math.round(healthyAcc)}/${Math.round(totalAcc)}` : `${totalAcc} 个账户`;
  const lines = [`💳 配额与 API 余额 (${headerCount})`];
  if (providers.length === 0) {
    lines.push('• 暂无匹配的工具或三方 API 配额信息。');
    return truncateText(lines.join('\n'));
  }
  for (const prov of providers.slice(0, 15)) {
    const isThirdParty = prov?.isThirdParty === true || prov?.provider === 'thirdparty';
    const tag = isThirdParty ? `[三方API${prov.adapterId ? `/${prov.adapterId}` : ''}] ` : '';
    const label = safeDisplayLabel([prov?.label, prov?.planLabel, prov?.providerLabel, prov?.provider], '未知渠道');
    const parts = [];
    if (prov?.balance) {
      const cur = cleanSingleLine(prov.balance.currency, 12) || 'USD';
      if (optionalNum(prov.balance.amount) !== null) {
        parts.push(`余额 ${prov.balance.formattedAmount || formatMoney(prov.balance.amount, cur)}`);
      }
      if (optionalNum(prov.balance.monthSpend) !== null) {
        parts.push(`本月 ${formatMoney(prov.balance.monthSpend, cur)}`);
      }
    }
    const wins = Array.isArray(prov?.windows) ? prov.windows : [];
    for (const win of wins.slice(0, 3)) {
      const wLabel = cleanSingleLine(win?.label || win?.kind, 32) || '额度';
      const wRem = optionalNum(win?.remainingPercent);
      const resetWait = optionalNum(win?.resetsInMs);
      const resetStr = resetWait !== null && resetWait > 0 ? ` (${formatDurationMs(resetWait)}后重置)` : '';
      if (win?.isCredits && win?.formattedRemaining) {
        parts.push(`${wLabel} ${win.formattedRemaining}`);
      } else if (wRem !== null) {
        parts.push(`${wLabel} 剩 ${Number(wRem.toFixed(1))}%${resetStr}`);
      }
    }
    if (prov?.stale) parts.push('数据过期');
    if (parts.length === 0) parts.push(cleanSingleLine(prov?.status, 32) || 'unknown');
    lines.push(`• ${tag}${label}: ${parts.join(' · ')}`);
  }
  const histEntries = Array.isArray(data?.history)
    ? data.history
    : (Array.isArray(data?.history?.entries) ? data.history.entries : (Array.isArray(data?.history?.points) ? data.history.points : []));
  if (histEntries.length > 0) {
    lines.push('');
    lines.push(`📉 配额历史采样（最近 ${Math.min(6, histEntries.length)} 条）：`);
    for (const pt of histEntries.slice(-6)) {
      const ts = formatTimeShort(pt?.recordedAt || pt?.observedAt || pt?.at || pt?.timestamp);
      const rem = optionalNum(pt?.remainingPercent ?? pt?.remaining);
      const label = cleanSingleLine(pt?.windowName || pt?.label, 32);
      lines.push(`• ${ts || '采样'}${label ? ` · ${label}` : ''}${rem !== null ? ` · 剩余 ${rem.toFixed(1)}%` : ''}`);
    }
  }
  return truncateText(lines.join('\n'));
}

function formatSubscriptionsText(data) {
  const subs = Array.isArray(data?.subscriptions) ? data.subscriptions : [];
  const activeCount = optionalNum(data?.activeCount) ?? subs.filter((s) => s.active).length;
  const totalCount = optionalNum(data?.totalCount) ?? subs.length;
  const monthlyTotal = optionalNum(data?.monthlyTotalUsd);
  const lines = [
    `📅 订阅账单与充值预测 (生效 ${activeCount}/${totalCount}${monthlyTotal !== null ? ` · 月均 ${formatMoney(monthlyTotal)}` : ''})`
  ];
  if (subs.length === 0) {
    lines.push('• 暂无订阅记录。');
    return truncateText(lines.join('\n'));
  }
  for (const sub of subs.slice(0, 12)) {
    const prov = safeDisplayLabel([sub?.providerLabel, sub?.provider], '');
    const plan = safeDisplayLabel([sub?.planName], '');
    const title = prov && plan && prov !== plan ? `${prov} (${plan})` : (plan || prov || '订阅');
    const parts = [
      optionalNum(sub?.amountUnits) !== null ? formatMoney(sub.amountUnits, sub.currency) : '',
      sub?.nextRenewalDate ? `续费 ${sub.nextRenewalDate}` : '',
      optionalNum(sub?.daysUntilRenewal) !== null ? `距续费 ${Math.round(sub.daysUntilRenewal)} 天` : ''
    ].filter(Boolean);
    const fc = sub?.forecast;
    if (fc && fc.status === 'available') {
      if (optionalNum(fc.dailyBurn) !== null) parts.push(`日均 ${formatMoney(fc.dailyBurn, fc.balanceCurrency || sub.currency)}`);
      if (optionalNum(fc.daysRemaining) !== null) parts.push(`可用约 ${Math.round(fc.daysRemaining)} 天`);
      if (fc.exhaustDate) parts.push(`预计耗尽 ${fc.exhaustDate}`);
    }
    lines.push(`• ${title}${parts.length ? `：${parts.join(' · ')}` : ''}`);
  }
  return truncateText(lines.join('\n'));
}

function formatLiveRateText(data) {
  const lines = ['⚡ Token Monitor 实时速率'];
  const state = cleanSingleLine(data?.state, 32) || 'unavailable';
  const reason = cleanSingleLine(data?.reason, 48);
  const speed = optionalNum(data?.speed?.outputTokensPerSec ?? data?.speed?.tokensPerSec ?? data?.speed);
  const burn = optionalNum(data?.burn?.costPerHour ?? data?.burn?.usdPerHour ?? data?.burn);
  const fallback = optionalNum(data?.fallbackAvgOutputTokensPerSec);
  lines.push(`• 状态：${state}${reason ? ` (${reason})` : ''}`);
  if (speed !== null) lines.push(`• 输出速率：${speed.toFixed(1)} tok/s`);
  if (burn !== null) lines.push(`• 消耗速率：${formatMoney(burn)}/h`);
  if (fallback !== null && fallback > 0) lines.push(`• 当日平均输出速率：${fallback.toFixed(1)} tok/s`);
  if (optionalNum(data?.deviceCount) !== null) lines.push(`• 活跃设备数：${Math.round(data.deviceCount)} 台`);
  return truncateText(lines.join('\n'));
}

function formatServiceStatusText(data) {
  const lines = ['🌐 上游 AI 服务状态与重置预测'];
  const svc = data?.serviceStatus || data?.services || data;
  const providers = Array.isArray(svc?.providers) ? svc.providers : [];
  if (svc?.available === false) {
    lines.push(`• 服务状态：${cleanSingleLine(svc.reason || svc.message, 120) || '仅桌面端 Host / Local Bridge 可用'}`);
  } else if (providers.length > 0) {
    const abnormal = providers.filter((p) => p?.status && !['ok', 'operational'].includes(String(p.status).toLowerCase()));
    const okCount = providers.length - abnormal.length;
    lines.push(`• 上游服务：正常 ${okCount}/${providers.length}`);
    for (const p of (abnormal.length > 0 ? abnormal : providers).slice(0, 10)) {
      const name = safeDisplayLabel([p?.name, p?.label, p?.id], '服务');
      const status = cleanSingleLine(p?.status || p?.indicator, 32) || 'unknown';
      const detail = cleanSingleLine(p?.description || p?.incidentTitle || p?.error, 120);
      lines.push(`• ${name}：${status}${detail ? ` (${detail})` : ''}`);
    }
  } else {
    lines.push('• 上游服务：暂无状态数据。');
  }

  const forecast = data?.codexResetForecast;
  if (forecast) {
    if (forecast.available === false) {
      lines.push(`• Codex 重置预测：不可用 (${cleanSingleLine(forecast.reason, 80) || '未开启或非桌面端'})`);
    } else {
      const fcParts = [
        cleanSingleLine(forecast.status, 32) || 'unknown',
        optionalNum(forecast.chancePercent) !== null ? `概率 ${Math.round(forecast.chancePercent)}%` : '',
        forecast.scheduledFor ? `预计 ${formatTimeShort(forecast.scheduledFor)}` : ''
      ].filter(Boolean);
      lines.push(`• Codex 重置预测：${fcParts.join(' · ')}`);
    }
  }

  if (data?.approvals !== undefined) {
    const alerts = Array.isArray(data.approvals?.alerts) ? data.approvals.alerts : (Array.isArray(data.approvals) ? data.approvals : []);
    lines.push(`• 待确认审批：${alerts.length} 条`);
  }
  return truncateText(lines.join('\n'));
}

function formatApprovalsText(data) {
  const alerts = Array.isArray(data?.alerts) ? data.alerts : (Array.isArray(data) ? data : []);
  const lines = [`⚠️ 待确认操作审批 (${alerts.length})`];
  if (alerts.length === 0) {
    lines.push('• 当前无待确认审批提醒。');
    return truncateText(lines.join('\n'));
  }
  for (const [idx, a] of alerts.slice(0, 10).entries()) {
    const who = [cleanSingleLine(a?.client, 24), cleanSingleLine(a?.deviceName || a?.deviceId, 48)].filter(Boolean).join('@');
    const proj = cleanSingleLine(a?.projectLabel, 64);
    const tool = cleanSingleLine(a?.tool, 48);
    const cmd = cleanSingleLine(a?.command || a?.description, 120);
    lines.push(`${idx + 1}. ${who || 'agent'}${proj ? ` (${proj})` : ''}${tool ? ` · ${tool}` : ''}${cmd ? `: ${cmd}` : ''}`);
  }
  return truncateText(lines.join('\n'));
}

function formatPushText(data) {
  const ok = data?.ok === true;
  const lines = [`${ok ? '✅' : '❌'} OpenClaw 推送${ok ? '成功' : '失败'}`];
  if (data?.eventType) lines.push(`• 事件类型：${cleanSingleLine(data.eventType, 48)}`);
  if (data?.mode) lines.push(`• 推送模式：${cleanSingleLine(data.mode, 32)}`);
  if (data?.channel) lines.push(`• 目标渠道：${cleanSingleLine(data.channel, 48)}`);
  if (data?.sentAt || data?.lastPush?.at) lines.push(`• 时间：${formatTimeShort(data.sentAt || data.lastPush.at)}`);
  if (!ok && (data?.message || data?.error)) lines.push(`• 错误：${cleanSingleLine(data.message || data.error, 200)}`);
  return truncateText(lines.join('\n'));
}

function formatPushHistoryText(data) {
  const list = Array.isArray(data?.history) ? data.history : [];
  const lines = [`📜 OpenClaw 推送历史 (共 ${data?.count ?? list.length} 条)`];
  if (list.length === 0) {
    lines.push('• 暂无推送记录。');
    return truncateText(lines.join('\n'));
  }
  for (const item of list.slice(0, 15)) {
    const icon = item?.ok ? '✅' : '❌';
    const at = formatTimeShort(item?.at);
    const ev = cleanSingleLine(item?.eventType, 32) || 'report';
    const detail = cleanSingleLine(item?.summary || item?.error || item?.channel, 100);
    lines.push(`• ${icon} [${at || '-'}] ${ev}${detail ? ` — ${detail}` : ''}`);
  }
  return truncateText(lines.join('\n'));
}

function formatReportsListText(data) {
  const reports = Array.isArray(data?.reports) ? data.reports : [];
  const lines = [`🗂 已归档报表 (${reports.length})`];
  if (reports.length === 0) {
    lines.push('• 暂无已生成的报表。');
    return truncateText(lines.join('\n'));
  }
  for (const r of reports.slice(0, 12)) {
    const range = r?.startDate && r?.endDate ? `${r.startDate}..${r.endDate}` : '';
    lines.push(`• ${cleanSingleLine(r?.reportId, 48)} (${range}) — ${formatTokens(r?.totalTokens)} tokens · ${formatMoney(r?.knownCostUsd)}`);
  }
  return truncateText(lines.join('\n'));
}

function formatRealtimeText(data) {
  const lines = ['⚡ Token Monitor 实时概览'];
  for (const [label, bucket] of [['今日', data?.today], ['本月', data?.month], ['累计', data?.allTime]]) {
    if (!bucket) continue;
    lines.push(`• ${label}：${formatTokens(bucket.totalTokens)} tokens · ${formatMoney(bucket.knownCostUsd ?? bucket.costUsd)}`);
  }
  if (data?.limits) {
    lines.push('');
    lines.push(formatLimitsText(data.limits));
  }
  return truncateText(lines.join('\n'));
}

function formatSingleReportText(data) {
  const r = data?.report || data;
  const p = r?.period || {};
  const s = r?.summary || {};
  const lines = [`📊 Token Monitor 报表 (${cleanSingleLine(r?.reportId || p.key, 48)})`];
  if (p.startDate && p.endDate) lines.push(`• 周期：${p.startDate} ~ ${p.endDate}`);
  lines.push(`• 总用量：${formatTokens(s.totalTokens)} tokens · 费用 ${formatMoney(s.knownCostUsd)} · 缓存命中 ${optionalNum(s.cacheHitRatePct)?.toFixed(1) ?? '0'}%`);
  const projects = Array.isArray(r?.projects) ? r.projects : [];
  if (projects.length > 0) {
    lines.push('');
    lines.push('📌 Top 项目：');
    for (const [idx, proj] of projects.slice(0, 6).entries()) {
      lines.push(`${idx + 1}. ${safeDisplayLabel([proj?.label, proj?.key], '项目')}: ${formatTokens(proj?.tokens)} tokens (${optionalNum(proj?.tokenSharePct)?.toFixed(1) ?? '0'}%) · ${formatMoney(proj?.costUsd)}`);
    }
  }
  if (data?.aiAnalysis?.summaryMarkdown) {
    lines.push('');
    lines.push(cleanSingleLine(data.aiAnalysis.summaryMarkdown, 1000));
  }
  return truncateText(lines.join('\n'));
}

function writeOutput(format, data, textFormatter) {
  if (format === 'text') {
    const rendered = typeof data === 'string' ? data : textFormatter(data);
    process.stdout.write(`${rendered}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
  }
}

function collectPushParams(flags, granularity, periodKey) {
  const params = {};
  const setIf = (targetKey, val) => {
    if (val !== undefined && val !== '') params[targetKey] = val;
  };
  if (Object.hasOwn(flags, 'granularity')) setIf('granularity', granularity);
  if (Object.hasOwn(flags, 'period') || Object.hasOwn(flags, 'period-key')) {
    setIf('periodKey', periodKey);
    setIf('period', flagString(flags, 'period', 'range'));
  }
  setIf('range', flagString(flags, 'range'));
  setIf('groupBy', flagString(flags, 'group-by', 'groupBy'));
  setIf('deviceId', flagString(flags, 'device', 'device-id', 'deviceId'));
  setIf('limit', flagPositiveInt(flags, ['limit']));
  setIf('state', flagString(flags, 'state'));
  setIf('client', flagString(flags, 'client'));
  setIf('sessionId', flagString(flags, 'session-id', 'sessionId'));
  setIf('project', flagString(flags, 'project'));
  setIf('search', flagString(flags, 'search'));
  setIf('sort', flagString(flags, 'sort'));
  setIf('cursor', flagString(flags, 'cursor'));
  if (Object.hasOwn(flags, 'include-conversation') || Object.hasOwn(flags, 'includeConversation')) {
    params.includeConversation = flagBool(flags, ['include-conversation', 'includeConversation'], false);
  }
  setIf('offset', flagNonNegInt(flags, ['offset']));
  setIf('resolution', flagString(flags, 'resolution'));
  setIf('from', flagString(flags, 'from'));
  setIf('to', flagString(flags, 'to'));
  if (flagBool(flags, ['no-diagnostics'], false)) params.includeDiagnostics = false;
  if (flagBool(flags, ['third-party-only', 'thirdPartyOnly'], false)) params.thirdPartyOnly = true;
  setIf('provider', flagString(flags, 'provider'));
  setIf('status', flagString(flags, 'status'));
  if (flagBool(flags, ['history', 'include-history', 'includeHistory'], false)) params.includeHistory = true;
  setIf('accountKey', flagString(flags, 'account-key', 'accountKey'));
  setIf('windowName', flagString(flags, 'window-name', 'windowName'));
  setIf('hours', flagPositiveInt(flags, ['hours']));
  setIf('date', flagString(flags, 'date'));
  if (flagBool(flags, ['no-forecasts'], false)) params.includeForecasts = false;
  if (flagBool(flags, ['active-only', 'activeOnly'], false)) params.activeOnly = true;
  if (flagBool(flags, ['no-reset-forecast'], false)) params.includeResetForecast = false;
  if (flagBool(flags, ['no-approvals'], false)) params.includeApprovals = false;
  setIf('question', flagString(flags, 'question'));
  if (flagBool(flags, ['refresh'], false)) params.refresh = true;
  return params;
}

function printHelp() {
  const helpText = [
    'Token Monitor OpenClaw Skill CLI',
    '',
    'Environment variables:',
    '  TOKEN_MONITOR_HUB_URL     Main Hub or Desktop Local Bridge URL (default: http://127.0.0.1:17321)',
    '  TOKEN_MONITOR_HUB_SECRET  Bearer secret (also accepts TOKEN_MONITOR_SECRET)',
    '',
    'Commands:',
    '  brief [--granularity daily|weekly|monthly] [--period latest] [--format text|json]',
    '  usage|today|month [--period today|month|week|last7|last30|allTime] [--group-by summary|model|client|project|device] [--device <id>] [--limit <n>] [--format text|json]',
    '  sessions [--period today|month|allTime] [--state running|waiting|ended|idle|all] [--client <c>] [--project <p>] [--device <id>] [--search <s>] [--sort lastUsedAt|totalTokens|costUsd] [--limit <n>] [--cursor <c>] [--format text|json]',
    '  session-detail --client <c> --session-id <id> [--device <d>] [--include-conversation] [--limit <n>] [--offset <n>] [--format text|json]',
    '  history [--resolution daily|monthly|summary] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--group-by none|client|model] [--limit <n>] [--format text|json]',
    '  devices [--device <id>] [--no-diagnostics] [--format text|json]',
    '  limits [--third-party-only] [--provider <p>] [--status <s>] [--history] [--account-key <k>] [--window-name <w>] [--hours <n>] [--format text|json]',
    '  subscriptions [--date YYYY-MM-DD] [--no-forecasts] [--active-only] [--format text|json]',
    '  live-rate [--device <id>] [--format text|json]',
    '  service-status [--no-reset-forecast] [--no-approvals] [--format text|json]',
    '  approvals [--format text|json]',
    '  realtime [--third-party-only] [--format json|text]',
    '  report|reports [--granularity daily|weekly|monthly] [--period latest] [--format json|markdown|text]',
    '  ai-analyze [--granularity daily|weekly|monthly] [--period latest] [--question <text>] [--language zh-CN|en|auto] [--refresh] [--json]',
    '  push [--type report|usage|sessions|session_detail|limits|subscriptions|service_status|test|custom] [--message <text>] [--include-ai] [--test] [...query params]',
    '  push-history [--limit <n>] [--format json|text]'
  ].join('\n');
  process.stdout.write(`${helpText}\n`);
}

async function main() {
  const { command, flags } = parseCliArgs(process.argv.slice(2));
  if (command === 'help' || flagBool(flags, ['help'], false)) {
    printHelp();
    return;
  }

  const connection = resolveConnection(flags);
  const granularity = flagString(flags, 'granularity') || 'daily';
  const periodKey = flagString(flags, 'period', 'period-key', 'periodKey') || 'latest';

  if (command === 'brief') {
    const format = resolveFormat(flags, 'text');
    const pathWithQuery = buildQueryPath('/api/integrations/openclaw/brief', {
      granularity,
      periodKey,
      format,
      ...(flagBool(flags, ['no-ai'], false) ? { includeAi: 'false' } : {}),
      ...(flagBool(flags, ['no-limits'], false) ? { includeLimits: 'false' } : {})
    });
    const res = await callHub(connection, 'GET', pathWithQuery);
    if (typeof res === 'string') {
      process.stdout.write(`${res}\n`);
    } else {
      process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
    }
    return;
  }

  if (command === 'realtime') {
    const format = resolveFormat(flags, 'json');
    const maxProviders = flagPositiveInt(flags, ['max-providers', 'maxProviders']);
    const res = await callHub(connection, 'POST', '/api/mcp', {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'get_realtime_usage_and_limits',
        arguments: {
          thirdPartyOnly: flagBool(flags, ['third-party-only', 'thirdPartyOnly'], false),
          ...(maxProviders !== undefined ? { maxProviders } : {})
        }
      }
    });
    const structured = res?.result?.structuredContent || res;
    writeOutput(format, structured, formatRealtimeText);
    return;
  }

  if (command === 'report' || command === 'reports') {
    const hasPeriodSelector = Boolean(flagString(flags, 'period', 'period-key', 'periodKey'));
    if (command === 'reports' && !hasPeriodSelector) {
      const format = resolveFormat(flags, 'json');
      const limit = flagPositiveInt(flags, ['limit']);
      const explicitGranularity = flagString(flags, 'granularity');
      const pathWithQuery = buildQueryPath('/api/reports', {
        granularity: explicitGranularity || undefined,
        limit
      });
      const res = await callHub(connection, 'GET', pathWithQuery);
      writeOutput(format, res, formatReportsListText);
      return;
    }

    const format = resolveFormat(flags, 'json', ['text', 'json', 'markdown', 'both']);
    const apiFormat = format === 'text' ? 'json' : format;
    const res = await callHub(
      connection,
      'GET',
      `/api/reports/${encodeURIComponent(granularity)}/${encodeURIComponent(periodKey)}?format=${encodeURIComponent(apiFormat)}`
    );
    if (format === 'text') {
      writeOutput('text', res, formatSingleReportText);
    } else if (typeof res === 'string') {
      process.stdout.write(`${res}\n`);
    } else {
      process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
    }
    return;
  }

  if (command === 'ai-analyze') {
    const res = await callHub(connection, 'POST', '/api/reports/ai-analyze', {
      granularity,
      periodKey,
      ...(flagString(flags, 'question') ? { question: flagString(flags, 'question') } : {}),
      ...(flagString(flags, 'language') ? { language: flagString(flags, 'language') } : {}),
      ...(flagBool(flags, ['refresh'], false) ? { refresh: true } : {})
    });
    const wantJson = flagBool(flags, ['json'], false) || flagString(flags, 'format').toLowerCase() === 'json';
    if (res?.aiAnalysis?.summaryMarkdown && !wantJson) {
      process.stdout.write(`${res.aiAnalysis.summaryMarkdown}\n`);
    } else {
      process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
    }
    return;
  }

  if (command === 'usage' || command === 'today' || command === 'month') {
    const format = resolveFormat(flags, 'json');
    const period = command === 'today'
      ? 'today'
      : command === 'month'
        ? 'month'
        : (flagString(flags, 'period', 'range') || 'today');
    const groupBy = flagString(flags, 'group-by', 'groupBy');
    const deviceId = flagString(flags, 'device', 'device-id', 'deviceId');
    const limit = flagPositiveInt(flags, ['limit']);
    const pathWithQuery = buildQueryPath('/api/query/usage', {
      period,
      groupBy,
      deviceId,
      limit
    });
    const res = await callHub(connection, 'GET', pathWithQuery);
    writeOutput(format, res, formatUsageText);
    return;
  }

  if (command === 'sessions') {
    const format = resolveFormat(flags, 'json');
    const pathWithQuery = buildQueryPath('/api/query/sessions', {
      period: flagString(flags, 'period') || undefined,
      state: flagString(flags, 'state') || undefined,
      client: flagString(flags, 'client') || undefined,
      project: flagString(flags, 'project') || undefined,
      deviceId: flagString(flags, 'device', 'device-id', 'deviceId') || undefined,
      search: flagString(flags, 'search') || undefined,
      sort: flagString(flags, 'sort') || undefined,
      sortDirection: flagString(flags, 'sort-dir', 'sortDirection') || undefined,
      limit: flagPositiveInt(flags, ['limit']),
      cursor: flagString(flags, 'cursor') || undefined
    });
    const res = await callHub(connection, 'GET', pathWithQuery);
    writeOutput(format, res, formatSessionsText);
    return;
  }

  if (command === 'session-detail') {
    const format = resolveFormat(flags, 'json');
    const client = flagString(flags, 'client');
    const sessionId = flagString(flags, 'session-id', 'sessionId');
    if (!client || !sessionId) {
      throw new Error('session-detail requires --client <name> and --session-id <id>.');
    }
    const includeConversation = flagBool(flags, ['include-conversation', 'includeConversation'], false);
    const pathWithQuery = buildQueryPath('/api/query/session-detail', {
      client,
      sessionId,
      deviceId: flagString(flags, 'device', 'device-id', 'deviceId') || undefined,
      period: flagString(flags, 'period') || undefined,
      ...(includeConversation ? { includeConversation: 'true' } : {}),
      limit: flagPositiveInt(flags, ['limit']),
      offset: flagNonNegInt(flags, ['offset'])
    });
    const res = await callHub(connection, 'GET', pathWithQuery);
    writeOutput(format, res, formatSessionDetailText);
    return;
  }

  if (command === 'history') {
    const format = resolveFormat(flags, 'json');
    const pathWithQuery = buildQueryPath('/api/query/history', {
      resolution: flagString(flags, 'resolution') || undefined,
      from: flagString(flags, 'from') || undefined,
      to: flagString(flags, 'to') || undefined,
      groupBy: flagString(flags, 'group-by', 'groupBy') || undefined,
      limit: flagPositiveInt(flags, ['limit'])
    });
    const res = await callHub(connection, 'GET', pathWithQuery);
    writeOutput(format, res, formatHistoryText);
    return;
  }

  if (command === 'devices') {
    const format = resolveFormat(flags, 'json');
    const noDiagnostics = flagBool(flags, ['no-diagnostics'], false);
    const pathWithQuery = buildQueryPath('/api/query/devices', {
      deviceId: flagString(flags, 'device', 'device-id', 'deviceId') || undefined,
      ...(noDiagnostics ? { includeDiagnostics: 'false' } : {})
    });
    const res = await callHub(connection, 'GET', pathWithQuery);
    writeOutput(format, res, formatDevicesText);
    return;
  }

  if (command === 'limits') {
    const format = resolveFormat(flags, 'json');
    const thirdPartyOnly = flagBool(flags, ['third-party-only', 'thirdPartyOnly'], false);
    const includeHistory = flagBool(flags, ['history', 'include-history', 'includeHistory'], false);
    const pathWithQuery = buildQueryPath('/api/query/limits', {
      ...(thirdPartyOnly ? { thirdPartyOnly: 'true' } : {}),
      provider: flagString(flags, 'provider') || undefined,
      status: flagString(flags, 'status') || undefined,
      ...(includeHistory ? { includeHistory: 'true' } : {}),
      accountKey: flagString(flags, 'account-key', 'accountKey') || undefined,
      windowName: flagString(flags, 'window-name', 'windowName') || undefined,
      hours: flagPositiveInt(flags, ['hours']),
      maxProviders: flagPositiveInt(flags, ['max-providers', 'maxProviders'])
    });
    const res = await callHub(connection, 'GET', pathWithQuery);
    writeOutput(format, res, formatLimitsText);
    return;
  }

  if (command === 'subscriptions') {
    const format = resolveFormat(flags, 'json');
    const noForecasts = flagBool(flags, ['no-forecasts'], false);
    const activeOnly = flagBool(flags, ['active-only', 'activeOnly'], false);
    const pathWithQuery = buildQueryPath('/api/query/subscriptions', {
      date: flagString(flags, 'date') || undefined,
      ...(noForecasts ? { includeForecasts: 'false' } : {}),
      ...(activeOnly ? { activeOnly: 'true' } : {})
    });
    const res = await callHub(connection, 'GET', pathWithQuery);
    writeOutput(format, res, formatSubscriptionsText);
    return;
  }

  if (command === 'live-rate') {
    const format = resolveFormat(flags, 'json');
    const pathWithQuery = buildQueryPath('/api/query/live-rate', {
      deviceId: flagString(flags, 'device', 'device-id', 'deviceId') || undefined
    });
    const res = await callHub(connection, 'GET', pathWithQuery);
    writeOutput(format, res, formatLiveRateText);
    return;
  }

  if (command === 'service-status') {
    const format = resolveFormat(flags, 'json');
    const noResetForecast = flagBool(flags, ['no-reset-forecast'], false);
    const noApprovals = flagBool(flags, ['no-approvals'], false);
    const force = flagBool(flags, ['force'], false);
    const pathWithQuery = buildQueryPath('/api/query/service-status', {
      ...(noResetForecast ? { includeResetForecast: 'false' } : {}),
      ...(noApprovals ? { includeApprovals: 'false' } : {}),
      provider: flagString(flags, 'provider') || undefined,
      ...(force ? { force: 'true' } : {})
    });
    const res = await callHub(connection, 'GET', pathWithQuery);
    writeOutput(format, res, formatServiceStatusText);
    return;
  }

  if (command === 'approvals') {
    const format = resolveFormat(flags, 'json');
    const res = await callHub(connection, 'GET', '/api/approval-alerts');
    writeOutput(format, res, formatApprovalsText);
    return;
  }

  if (command === 'push') {
    const format = resolveFormat(flags, 'json');
    const pushType = flagString(flags, 'type').toLowerCase();
    const isTest = flagBool(flags, ['test'], false) || pushType === 'test';
    const customMessage = flagString(flags, 'message', 'custom-message', 'customMessage');
    const idempotencyKey = flagString(flags, 'idempotency-key', 'idempotencyKey');
    const hasIncludeAi = Object.hasOwn(flags, 'include-ai') || Object.hasOwn(flags, 'includeAi');
    const hasIncludeLimits = Object.hasOwn(flags, 'include-limits') || Object.hasOwn(flags, 'includeLimits');
    const includeAi = hasIncludeAi ? flagBool(flags, ['include-ai', 'includeAi'], true) : undefined;
    const includeLimits = hasIncludeLimits ? flagBool(flags, ['include-limits', 'includeLimits'], true) : undefined;

    if (isTest || pushType || customMessage) {
      const params = collectPushParams(flags, granularity, periodKey);
      const body = isTest
        ? {
            test: true,
            type: 'test',
            ...(customMessage ? { customMessage, message: customMessage } : {}),
            ...(idempotencyKey ? { idempotencyKey } : {})
          }
        : {
            type: pushType || 'custom',
            ...(Object.keys(params).length > 0 ? { params } : {}),
            ...(includeAi !== undefined ? { includeAi } : {}),
            ...(includeLimits !== undefined ? { includeLimits } : {}),
            ...(customMessage ? { customMessage } : {}),
            ...(flagString(flags, 'title') ? { title: flagString(flags, 'title') } : {}),
            ...(idempotencyKey ? { idempotencyKey } : {})
          };
      const res = await callHub(connection, 'POST', '/api/integrations/openclaw/push', body);
      writeOutput(format, res, formatPushText);
      return;
    }

    // Legacy report push path preserved when --type, --test, and --message are omitted.
    const res = await callHub(connection, 'POST', '/api/reports/push', {
      target: 'openclaw',
      granularity,
      periodKey,
      ...(includeAi !== undefined ? { includeAi } : {}),
      ...(includeLimits !== undefined ? { includeLimits } : {}),
      ...(flagBool(flags, ['refresh'], false) ? { refreshAi: true } : {}),
      ...(flagString(flags, 'question') ? { question: flagString(flags, 'question') } : {}),
      ...(idempotencyKey ? { idempotencyKey } : {})
    });
    writeOutput(format, res, formatPushText);
    return;
  }

  if (command === 'push-history') {
    const format = resolveFormat(flags, 'json');
    const limit = flagPositiveInt(flags, ['limit']);
    const pathWithQuery = buildQueryPath('/api/integrations/openclaw/history', { limit });
    const res = await callHub(connection, 'GET', pathWithQuery);
    writeOutput(format, res, formatPushHistoryText);
    return;
  }

  throw new Error(
    `Unknown command "${command}". Expected: brief, usage, today, month, sessions, session-detail, history, devices, limits, subscriptions, live-rate, service-status, approvals, realtime, report, reports, ai-analyze, push, push-history.`
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
