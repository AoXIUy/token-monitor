// @ts-check
'use strict';

const {
  dayKeyAddDays,
  localDayKey,
  num
} = require('./history');
const { canonicalProjectKey, deterministicProjectLabel } = require('./projectKey');
const { isReasonixSyntheticSession } = require('./providers/reasonix/sessionGuard');
const { normalizeClientName, normalizeModelName, normalizeModelNameForClient } = require('./usage');

const REPORT_SCHEMA_VERSION = 1;
const REPORT_SCHEMA = 'token-monitor-report/v1';
const REPORT_GRANULARITIES = Object.freeze(['daily', 'weekly', 'monthly']);

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const WEEK_KEY_RE = /^(\d{4})-W(\d{2})$/;
const MONTH_KEY_RE = /^(\d{4})-(\d{2})$/;

/**
 * @typedef {'daily' | 'weekly' | 'monthly'} ReportGranularity
 * @typedef {'live-period' | 'daily-snapshots' | 'session-window' | 'partial' | 'none'} ProjectAttributionSource
 *
 * @typedef {object} ReportConfig
 * @property {boolean} enabled
 * @property {boolean} daily
 * @property {boolean} weekly
 * @property {boolean} monthly
 *
 * @typedef {object} ResolvedReportPeriod
 * @property {ReportGranularity} granularity
 * @property {string} key
 * @property {string} label
 * @property {string} startDate
 * @property {string} endDate
 * @property {string} timeZone
 * @property {boolean} isCurrent
 * @property {string} previousPeriodKey
 *
 * @typedef {object} ReportClientBreakdown
 * @property {string} client
 * @property {number} tokens
 * @property {number} costUsd
 * @property {number} unpricedTokens
 * @property {number} tokenSharePct
 * @property {number} costSharePct
 * @property {number} cacheReadTokens
 * @property {number} cacheWriteTokens
 * @property {number} outputTokens
 * @property {number} inputTokens
 * @property {number} unclassifiedTokens
 * @property {number} cacheHitRatePct
 * @property {number} messageCount
 *
 * @typedef {object} ReportModelBreakdown
 * @property {string} model
 * @property {number} tokens
 * @property {number} costUsd
 * @property {number} unpricedTokens
 * @property {number} tokenSharePct
 * @property {number} costSharePct
 * @property {number} cacheReadTokens
 * @property {number} cacheWriteTokens
 * @property {number} outputTokens
 * @property {number} inputTokens
 * @property {number} unclassifiedTokens
 * @property {number} cacheHitRatePct
 * @property {number} avgOutputTokensPerSec
 *
 * @typedef {object} ReportProjectClientShare
 * @property {string} client
 * @property {number} tokens
 * @property {number} sharePct
 *
 * @typedef {object} ReportProjectModelShare
 * @property {string} model
 * @property {number} tokens
 * @property {number} sharePct
 *
 * @typedef {object} ReportProjectBreakdown
 * @property {string} key
 * @property {string} label
 * @property {number} tokens
 * @property {number} costUsd
 * @property {number} unpricedTokens
 * @property {number} tokenSharePct
 * @property {number} costSharePct
 * @property {number} sessionCount
 * @property {ReportProjectClientShare[]} clients
 * @property {ReportProjectModelShare[]} models
 *
 * @typedef {object} ReportDeviceBreakdown
 * @property {string} deviceId
 * @property {string} hostname
 * @property {string} platform
 * @property {boolean} stale
 * @property {number} tokens
 * @property {number} costUsd
 * @property {number} tokenSharePct
 * @property {number} projectCount
 *
 * @typedef {object} ReportTimelineEntry
 * @property {string} date
 * @property {number} tokens
 * @property {number} costUsd
 * @property {number} activeTimeMs
 * @property {string | null} topClient
 * @property {string | null} topModel
 *
 * @typedef {object} ReportSignal
 * @property {string} code
 * @property {'info' | 'warning'} severity
 * @property {string} summary
 * @property {string} [projectKey]
 * @property {string} [projectLabel]
 * @property {number} [tokenSharePct]
 * @property {number} [cacheHitRatePct]
 * @property {number} [measuredInputTokens]
 * @property {number} [tokenDeltaPct]
 * @property {number} [previousTokens]
 * @property {number} [totalTokens]
 * @property {number} [unpricedTokens]
 * @property {number} [unpricedSharePct]
 * @property {number} [staleDeviceCount]
 * @property {number} [deviceCount]
 * @property {ProjectAttributionSource} [projectAttributionSource]
 *
 * @typedef {object} UsageReport
 * @property {number} schemaVersion
 * @property {string} schema
 * @property {string} reportId
 * @property {ReportGranularity} granularity
 * @property {ResolvedReportPeriod & { generatedAt: string }} period
 * @property {{ runtime: string, deviceCount: number, activeDeviceCount: number, staleDeviceCount: number }} hub
 * @property {{ tokenComponentsComplete: boolean, projectsComplete: boolean, projectAttributionSource: ProjectAttributionSource, historyComplete: boolean }} coverage
 * @property {object} summary
 * @property {number} summary.totalTokens
 * @property {number} summary.knownCostUsd
 * @property {number} summary.unpricedTokens
 * @property {number} summary.inputTokens
 * @property {number} summary.outputTokens
 * @property {number} summary.cacheReadTokens
 * @property {number} summary.cacheWriteTokens
 * @property {number} summary.unclassifiedTokens
 * @property {number} summary.cacheHitRatePct
 * @property {number} summary.messageCount
 * @property {number} summary.sessionCount
 * @property {number} summary.projectCount
 * @property {number} summary.activeDays
 * @property {number} summary.activeTimeMs
 * @property {{ date: string, tokens: number, costUsd: number } | null} summary.peakDay
 * @property {{ timedTokens: number, timedOutputTokens: number, timedDurationMs: number, avgOutputTokensPerSec: number }} summary.throughput
 * @property {{ previousPeriodKey: string, previousTokens: number, previousCostUsd: number, tokenDelta: number, tokenDeltaPct: number | null, costDelta: number, costDeltaPct: number | null } | null} summary.comparison
 * @property {ReportProjectBreakdown[]} projects
 * @property {ReportClientBreakdown[]} clients
 * @property {ReportModelBreakdown[]} models
 * @property {ReportDeviceBreakdown[]} devices
 * @property {ReportTimelineEntry[]} timeline
 * @property {ReportSignal[]} signals
 */

/**
 * @param {any} object
 * @param {string} key
 * @returns {boolean}
 */
function hasOwn(object, key) {
  return Boolean(object && typeof object === 'object' && Object.prototype.hasOwnProperty.call(object, key));
}

/**
 * @param {number} value
 * @returns {number}
 */
function round2(value) {
  return Number.isFinite(value) ? Number(value.toFixed(2)) : 0;
}

/**
 * @param {number} value
 * @returns {number}
 */
function round6(value) {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : 0;
}

/**
 * @param {number} part
 * @param {number} whole
 * @returns {number}
 */
function pct(part, whole) {
  return whole > 0 && part > 0 ? round2((part / whole) * 100) : 0;
}

/**
 * @param {number} tokens
 * @param {any} rawUnpriced
 * @returns {number}
 */
function boundedUnpriced(tokens, rawUnpriced) {
  return Math.min(Math.max(0, Math.round(tokens)), Math.max(0, Math.round(num(rawUnpriced))));
}

/**
 * Normalize report generation configuration.
 * @param {any} raw
 * @returns {ReportConfig}
 */
function normalizeReportConfig(raw) {
  if (raw === true || raw === 1) {
    return { enabled: true, daily: true, weekly: true, monthly: true };
  }
  if (raw === null || raw === undefined || raw === false || raw === 0) {
    return { enabled: false, daily: true, weekly: true, monthly: true };
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim().toLowerCase();
    if (!trimmed || trimmed === '0' || trimmed === 'false' || trimmed === 'off' || trimmed === 'no') {
      return { enabled: false, daily: true, weekly: true, monthly: true };
    }
    if (trimmed === '1' || trimmed === 'true' || trimmed === 'on' || trimmed === 'yes' || trimmed === 'all') {
      return { enabled: true, daily: true, weekly: true, monthly: true };
    }
    if (trimmed === 'none') {
      return { enabled: false, daily: false, weekly: false, monthly: false };
    }
    const items = new Set(
      trimmed
        .split(',')
        .map((part) => part.trim())
        .filter((part) => REPORT_GRANULARITIES.includes(part))
    );
    if (items.size === 0) {
      return { enabled: false, daily: true, weekly: true, monthly: true };
    }
    return {
      enabled: true,
      daily: items.has('daily'),
      weekly: items.has('weekly'),
      monthly: items.has('monthly')
    };
  }
  if (Array.isArray(raw)) {
    const items = new Set(
      raw
        .map((item) => String(item || '').trim().toLowerCase())
        .filter((item) => REPORT_GRANULARITIES.includes(item))
    );
    return {
      enabled: items.size > 0,
      daily: items.has('daily'),
      weekly: items.has('weekly'),
      monthly: items.has('monthly')
    };
  }
  if (typeof raw === 'object') {
    const enabled = raw.enabled === true || raw.enabled === 'true' || raw.enabled === '1' || raw.enabled === 1;
    return {
      enabled,
      daily: raw.daily !== false && raw.daily !== 'false' && raw.daily !== '0',
      weekly: raw.weekly !== false && raw.weekly !== 'false' && raw.weekly !== '0',
      monthly: raw.monthly !== false && raw.monthly !== 'false' && raw.monthly !== '0'
    };
  }
  return { enabled: false, daily: true, weekly: true, monthly: true };
}

/**
 * @param {any} value
 * @returns {Date}
 */
function resolveNowDate(value) {
  if (value === undefined || value === null || value === '') return new Date();
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid report reference timestamp: ${String(value)}`);
  }
  return date;
}

/**
 * @param {any} timeZone
 * @returns {string}
 */
function resolveTimeZone(timeZone) {
  const candidate = typeof timeZone === 'string' ? timeZone.trim() : '';
  if (!candidate) {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  }
  try {
    new Intl.DateTimeFormat('en', { timeZone: candidate }).format(0);
    return candidate;
  } catch {
    throw new Error(`Invalid IANA timeZone: ${candidate}`);
  }
}

/**
 * @param {Date | number | string} value
 * @param {string} timeZone
 * @returns {string}
 */
function dayKeyInTimeZone(value, timeZone) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  try {
    const parts = new Intl.DateTimeFormat('en', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date);
    /** @type {Record<string, string>} */
    const map = {};
    for (const part of parts) map[part.type] = part.value;
    const key = `${map.year}-${map.month}-${map.day}`;
    return validateDateKey(key) ? key : '';
  } catch {
    return '';
  }
}

/**
 * @param {string} value
 * @returns {string}
 */
function validateDateKey(value) {
  const key = String(value || '').trim();
  if (!DATE_KEY_RE.test(key)) return '';
  const date = new Date(`${key}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10) === key ? key : '';
}

/**
 * Compute ISO-8601 week (year, week) for a valid YYYY-MM-DD date key.
 * @param {string} dateKey
 * @returns {{ isoYear: number, isoWeek: number, key: string }}
 */
function isoWeekOfDateKey(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  const dow = utcDate.getUTCDay() || 7;
  const thursday = new Date(utcDate);
  thursday.setUTCDate(utcDate.getUTCDate() + (4 - dow));
  const isoYear = thursday.getUTCFullYear();
  const jan1 = new Date(Date.UTC(isoYear, 0, 1));
  const days = Math.round((thursday.getTime() - jan1.getTime()) / 86400000);
  const isoWeek = Math.floor(days / 7) + 1;
  return {
    isoYear,
    isoWeek,
    key: `${String(isoYear).padStart(4, '0')}-W${String(isoWeek).padStart(2, '0')}`
  };
}

/**
 * Compute Monday..Sunday date keys for an ISO week YYYY-Www.
 * @param {string} weekKey
 * @returns {{ key: string, startDate: string, endDate: string, previousPeriodKey: string } | null}
 */
function parseIsoWeekKey(weekKey) {
  const match = WEEK_KEY_RE.exec(String(weekKey || '').trim());
  if (!match) return null;
  const isoYear = Number(match[1]);
  const isoWeek = Number(match[2]);
  if (!Number.isInteger(isoYear) || !Number.isInteger(isoWeek) || isoWeek < 1 || isoWeek > 53) {
    return null;
  }
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4Dow = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - (jan4Dow - 1));
  const monday = new Date(week1Monday);
  monday.setUTCDate(week1Monday.getUTCDate() + (isoWeek - 1) * 7);
  const startDate = monday.toISOString().slice(0, 10);
  const roundTrip = isoWeekOfDateKey(startDate);
  if (roundTrip.isoYear !== isoYear || roundTrip.isoWeek !== isoWeek) {
    return null;
  }
  const endDate = dayKeyAddDays(startDate, 6);
  const prevStartDate = dayKeyAddDays(startDate, -7);
  return {
    key: roundTrip.key,
    startDate,
    endDate,
    previousPeriodKey: isoWeekOfDateKey(prevStartDate).key
  };
}

/**
 * @param {string} monthKey
 * @returns {{ key: string, startDate: string, endDate: string, previousPeriodKey: string } | null}
 */
function parseMonthKey(monthKey) {
  const match = MONTH_KEY_RE.exec(String(monthKey || '').trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }
  const key = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
  const startDate = `${key}-01`;
  const endDate = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  const previousPeriodKey = `${String(prevYear).padStart(4, '0')}-${String(prevMonth).padStart(2, '0')}`;
  return { key, startDate, endDate, previousPeriodKey };
}

/**
 * Resolve a report granularity + periodKey into exact date bounds and metadata.
 * @param {ReportGranularity | string} granularity
 * @param {string | null | undefined} [periodKey]
 * @param {{ now?: Date | number | string, timeZone?: string }} [options]
 * @returns {ResolvedReportPeriod}
 */
function resolveReportPeriod(granularity, periodKey = 'latest', options = {}) {
  const normalizedGranularity = /** @type {ReportGranularity} */ (String(granularity || '').trim().toLowerCase());
  if (!REPORT_GRANULARITIES.includes(normalizedGranularity)) {
    throw new Error(`Invalid report granularity "${String(granularity || '')}". Expected one of: ${REPORT_GRANULARITIES.join(', ')}`);
  }

  const nowDate = resolveNowDate(options?.now);
  const timeZone = resolveTimeZone(options?.timeZone);
  const currentDayKey = dayKeyInTimeZone(nowDate, timeZone) || localDayKey(nowDate);
  const rawKey = periodKey === null || periodKey === undefined ? '' : String(periodKey).trim();
  const isAlias = rawKey === '' || rawKey.toLowerCase() === 'latest' || rawKey.toLowerCase() === 'current';

  if (normalizedGranularity === 'daily') {
    const key = isAlias ? currentDayKey : validateDateKey(rawKey);
    if (!key) {
      throw new Error(`Invalid daily periodKey "${rawKey}". Expected YYYY-MM-DD, "latest", or "current"`);
    }
    return {
      granularity: 'daily',
      key,
      label: key,
      startDate: key,
      endDate: key,
      timeZone,
      isCurrent: key === currentDayKey,
      previousPeriodKey: dayKeyAddDays(key, -1)
    };
  }

  if (normalizedGranularity === 'weekly') {
    const currentWeekKey = isoWeekOfDateKey(currentDayKey).key;
    const parsed = parseIsoWeekKey(isAlias ? currentWeekKey : rawKey);
    if (!parsed) {
      throw new Error(`Invalid weekly periodKey "${rawKey}". Expected ISO week YYYY-Www, "latest", or "current"`);
    }
    return {
      granularity: 'weekly',
      key: parsed.key,
      label: `${parsed.key} (${parsed.startDate}..${parsed.endDate})`,
      startDate: parsed.startDate,
      endDate: parsed.endDate,
      timeZone,
      isCurrent: parsed.key === currentWeekKey,
      previousPeriodKey: parsed.previousPeriodKey
    };
  }

  const currentMonthKey = currentDayKey.slice(0, 7);
  const parsedMonth = parseMonthKey(isAlias ? currentMonthKey : rawKey);
  if (!parsedMonth) {
    throw new Error(`Invalid monthly periodKey "${rawKey}". Expected YYYY-MM, "latest", or "current"`);
  }
  return {
    granularity: 'monthly',
    key: parsedMonth.key,
    label: parsedMonth.key,
    startDate: parsedMonth.startDate,
    endDate: parsedMonth.endDate,
    timeZone,
    isCurrent: parsedMonth.key === currentMonthKey,
    previousPeriodKey: parsedMonth.previousPeriodKey
  };
}

/**
 * @param {string} startDate
 * @param {string} endDate
 * @returns {string[]}
 */
function enumerateDateRange(startDate, endDate) {
  /** @type {string[]} */
  const dates = [];
  for (let d = startDate; d <= endDate; d = dayKeyAddDays(d, 1)) {
    dates.push(d);
  }
  return dates;
}

/**
 * @param {any} source
 * @param {number} totalTokens
 * @param {boolean} exact
 * @returns {{ inputTokens: number, outputTokens: number, cacheReadTokens: number, cacheWriteTokens: number, unclassifiedTokens: number, tokenComponentsComplete: boolean }}
 */
function computeTokenComponents(source, totalTokens, exact) {
  const total = Math.max(0, Math.round(num(totalTokens)));
  const cacheReadTokens = Math.max(0, Math.round(num(source?.cacheReadTokens)));
  const cacheWriteTokens = Math.max(0, Math.round(num(source?.cacheWriteTokens)));
  const outputTokens = Math.max(0, Math.round(num(source?.outputTokens)));
  const known = cacheReadTokens + cacheWriteTokens + outputTokens;

  if (known > total) {
    return {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      unclassifiedTokens: total,
      tokenComponentsComplete: total === 0
    };
  }

  const remaining = total - known;
  const hasExplicitUnclassified = hasOwn(source, 'unclassifiedTokens');
  const unclassifiedTokens = hasExplicitUnclassified
    ? Math.min(remaining, Math.max(0, Math.round(num(source.unclassifiedTokens))))
    : (exact ? 0 : remaining);
  const inputTokens = Math.max(0, remaining - unclassifiedTokens);

  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    unclassifiedTokens,
    tokenComponentsComplete: unclassifiedTokens === 0 && (exact || hasExplicitUnclassified || total === 0)
  };
}

/**
 * @param {number} cacheReadTokens
 * @param {number} inputTokens
 * @param {number} cacheWriteTokens
 * @returns {number}
 */
function computeCacheHitRatePct(cacheReadTokens, inputTokens, cacheWriteTokens) {
  const measuredInput = Math.max(0, inputTokens) + Math.max(0, cacheReadTokens) + Math.max(0, cacheWriteTokens);
  return measuredInput > 0 ? round2((Math.max(0, cacheReadTokens) / measuredInput) * 100) : 0;
}

/**
 * @param {any} dailySnapshots
 * @param {string} date
 * @returns {any}
 */
function getDailySnapshot(dailySnapshots, date) {
  if (!dailySnapshots) return null;
  if (dailySnapshots instanceof Map) return dailySnapshots.get(date) || null;
  if (typeof dailySnapshots === 'object') return dailySnapshots[date] || null;
  return null;
}

/**
 * @param {any} stats
 * @param {any[]} rawDevices
 * @returns {any[]}
 */
function collectMergedDevices(stats, rawDevices) {
  /** @type {Map<string, any>} */
  const byId = new Map();
  const statsDevices = Array.isArray(stats?.devices) ? stats.devices : [];
  const extraDevices = Array.isArray(rawDevices) ? rawDevices : [];

  for (const device of extraDevices) {
    if (!device || typeof device !== 'object') continue;
    const id = String(device.deviceId || device.id || '').trim();
    if (!id) continue;
    byId.set(id, { ...device, deviceId: id });
  }
  for (const device of statsDevices) {
    if (!device || typeof device !== 'object') continue;
    const id = String(device.deviceId || device.id || '').trim();
    if (!id) continue;
    const prev = byId.get(id) || {};
    byId.set(id, {
      ...prev,
      ...device,
      deviceId: id,
      periods: device.periods || prev.periods || {},
      ...(prev.history !== undefined && device.history === undefined ? { history: prev.history } : {}),
      ...(prev.historyAvailable !== undefined && device.historyAvailable === undefined ? { historyAvailable: prev.historyAvailable } : {})
    });
  }
  return Array.from(byId.values()).sort((a, b) => a.deviceId.localeCompare(b.deviceId));
}

/**
 * @param {any} device
 * @param {'today' | 'month'} periodName
 * @returns {any}
 */
function devicePeriod(device, periodName) {
  return device?.periods?.[periodName] || device?.[periodName] || null;
}

/**
 * @param {any} device
 * @param {'today' | 'month'} periodName
 * @param {number} nowMs
 * @returns {boolean}
 */
function isDevicePeriodExpired(device, periodName, nowMs) {
  const endsAt = device?.periodWindows?.[periodName]?.endsAt;
  if (endsAt) {
    const ms = Date.parse(endsAt);
    if (Number.isFinite(ms) && ms > 0) return nowMs >= ms;
  }
  return false;
}

/**
 * Check if stats.periods[periodName] matches the resolved period key.
 * @param {any} stats
 * @param {any[]} devices
 * @param {'today' | 'month'} periodName
 * @param {ResolvedReportPeriod} resolved
 * @param {number} nowMs
 * @returns {boolean}
 */
function doesLivePeriodMatch(stats, devices, periodName, resolved, nowMs) {
  if (!resolved.isCurrent) return false;
  const period = stats?.periods?.[periodName];
  if (!period || typeof period !== 'object') return false;
  const keys = devices
    .filter((d) => !isDevicePeriodExpired(d, periodName, nowMs))
    .map((d) => String(d?.periodWindows?.[periodName]?.key || '').trim())
    .filter(Boolean);
  if (keys.length === 0) return true;
  return keys.includes(resolved.key);
}

/**
 * @param {any} map
 * @returns {string | null}
 */
function pickTopName(map) {
  if (!map || typeof map !== 'object') return null;
  let bestName = null;
  let bestTokens = 0;
  for (const [rawName, rawVal] of Object.entries(map)) {
    const tokens = typeof rawVal === 'number' ? num(rawVal) : num(rawVal?.tokens);
    if (tokens <= 0) continue;
    if (tokens > bestTokens || (tokens === bestTokens && bestName !== null && rawName < bestName)) {
      bestName = rawName;
      bestTokens = tokens;
    }
  }
  return bestName;
}

/**
 * Convert a live `stats.periods[...]` object into a history-daily-like row for a single date.
 * @param {any} period
 * @param {string} date
 * @param {any} [historyRow]
 * @returns {any}
 */
function livePeriodToDailyRow(period, date, historyRow) {
  const exact = period?.capabilities?.tokenComponents === true;
  /** @type {Record<string, any>} */
  const perClient = {};
  const sessionMsgsByClient = new Map();
  let totalSessionMsgs = 0;
  for (const session of Object.values(period?.sessions || {})) {
    if (!session || typeof session !== 'object' || isReasonixSyntheticSession(session)) continue;
    const c = normalizeClientName(session.client) || String(session.client || '').trim();
    const msgs = Math.max(0, Math.round(num(session.messageCount)));
    totalSessionMsgs += msgs;
    if (c) sessionMsgsByClient.set(c, (sessionMsgsByClient.get(c) || 0) + msgs);
  }
  const clientKeys = new Set([
    ...Object.keys(period?.clients || {}),
    ...Object.keys(period?.clientCosts || {})
  ]);
  for (const rawClient of clientKeys) {
    const client = normalizeClientName(rawClient) || rawClient;
    const tokens = Math.max(0, Math.round(num(period?.clients?.[rawClient])));
    const cost = Math.max(0, num(period?.clientCosts?.[rawClient]));
    const comp = computeTokenComponents({
      cacheReadTokens: period?.clientCacheReads?.[rawClient],
      cacheWriteTokens: period?.clientCacheWrites?.[rawClient],
      outputTokens: period?.clientOutputs?.[rawClient],
      ...(hasOwn(period?.clientUnclassifiedTokens, rawClient)
        ? { unclassifiedTokens: period.clientUnclassifiedTokens[rawClient] }
        : {})
    }, tokens, exact);
    const unpriced = boundedUnpriced(tokens, period?.clientUnpricedTokens?.[rawClient]);
    const histMsgs = Math.max(0, Math.round(num(historyRow?.perClient?.[client]?.messages)));
    const sessMsgs = sessionMsgsByClient.get(client) || 0;
    const prev = perClient[client];
    perClient[client] = {
      tokens: (prev?.tokens || 0) + tokens,
      cost: (prev?.cost || 0) + cost,
      unpricedTokens: (prev?.unpricedTokens || 0) + unpriced,
      messages: prev ? prev.messages : Math.max(histMsgs, sessMsgs),
      cacheReadTokens: (prev?.cacheReadTokens || 0) + comp.cacheReadTokens,
      cacheWriteTokens: (prev?.cacheWriteTokens || 0) + comp.cacheWriteTokens,
      outputTokens: (prev?.outputTokens || 0) + comp.outputTokens,
      unclassifiedTokens: (prev?.unclassifiedTokens || 0) + comp.unclassifiedTokens
    };
  }

  /** @type {Record<string, any>} */
  const perModel = {};
  const modelKeys = new Set([
    ...Object.keys(period?.models || {}),
    ...Object.keys(period?.modelCosts || {})
  ]);
  for (const rawModel of modelKeys) {
    const model = normalizeModelName(rawModel) || rawModel;
    const tokens = Math.max(0, Math.round(num(period?.models?.[rawModel])));
    const cost = Math.max(0, num(period?.modelCosts?.[rawModel]));
    const comp = computeTokenComponents({
      cacheReadTokens: period?.modelCacheReads?.[rawModel],
      cacheWriteTokens: period?.modelCacheWrites?.[rawModel],
      outputTokens: period?.modelOutputs?.[rawModel],
      ...(hasOwn(period?.modelUnclassifiedTokens, rawModel)
        ? { unclassifiedTokens: period.modelUnclassifiedTokens[rawModel] }
        : {})
    }, tokens, exact);
    const unpriced = boundedUnpriced(tokens, period?.modelUnpricedTokens?.[rawModel]);
    const prev = perModel[model];
    perModel[model] = {
      tokens: (prev?.tokens || 0) + tokens,
      cost: (prev?.cost || 0) + cost,
      unpricedTokens: (prev?.unpricedTokens || 0) + unpriced,
      cacheReadTokens: (prev?.cacheReadTokens || 0) + comp.cacheReadTokens,
      cacheWriteTokens: (prev?.cacheWriteTokens || 0) + comp.cacheWriteTokens,
      outputTokens: (prev?.outputTokens || 0) + comp.outputTokens,
      unclassifiedTokens: (prev?.unclassifiedTokens || 0) + comp.unclassifiedTokens
    };
  }

  const totalTokens = Math.max(0, Math.round(num(period?.totalTokens)));
  const comp = computeTokenComponents(period, totalTokens, exact);
  const histMessages = Math.max(0, Math.round(num(historyRow?.messages)));
  const clientMsgSum = Object.values(perClient).reduce((s, c) => s + num(c.messages), 0);

  return {
    date,
    tokens: totalTokens,
    cost: Math.max(0, num(period?.costUsd)),
    unpricedTokens: boundedUnpriced(totalTokens, period?.unpricedTokens),
    messages: Math.max(histMessages, totalSessionMsgs, clientMsgSum, Math.round(num(period?.messageCount))),
    activeTimeMs: Math.max(
      Math.round(num(period?.activeTimeMs)),
      Math.round(num(historyRow?.activeTimeMs))
    ),
    cacheReadTokens: comp.cacheReadTokens,
    cacheWriteTokens: comp.cacheWriteTokens,
    outputTokens: comp.outputTokens,
    unclassifiedTokens: comp.unclassifiedTokens,
    tokenComponentsAvailable: comp.tokenComponentsComplete,
    timedTokens: Math.max(0, Math.round(num(period?.timedTokens))),
    timedOutputTokens: Math.max(0, Math.round(num(period?.timedOutputTokens))),
    timedDurationMs: Math.max(0, Math.round(num(period?.timedDurationMs))),
    modelThroughput: period?.modelThroughput || null,
    perClient,
    perModel
  };
}

/**
 * @param {any} snapshot
 * @param {string} date
 * @returns {any}
 */
function snapshotToDailyRow(snapshot, date) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const totalTokens = Math.max(0, Math.round(num(snapshot.totalTokens ?? snapshot.tokens)));
  const cost = Math.max(0, num(snapshot.costUsd ?? snapshot.cost));
  const activeTimeMs = Math.max(0, Math.round(num(snapshot.activeTimeMs)));
  const exact = snapshot.tokenComponentsAvailable === true || snapshot.capabilities?.tokenComponents === true;
  const comp = computeTokenComponents(snapshot, totalTokens, exact);
  /** @type {Record<string, any>} */
  const perClient = {};
  if (snapshot.perClient && typeof snapshot.perClient === 'object') {
    for (const [k, v] of Object.entries(snapshot.perClient)) {
      const client = normalizeClientName(k) || k;
      perClient[client] = { ...v, tokens: Math.max(0, Math.round(num(v?.tokens))), cost: Math.max(0, num(v?.cost)) };
    }
  } else if (snapshot.clients && typeof snapshot.clients === 'object') {
    for (const [k, v] of Object.entries(snapshot.clients)) {
      const client = normalizeClientName(k) || k;
      perClient[client] = {
        tokens: Math.max(0, Math.round(num(v))),
        cost: Math.max(0, num(snapshot.clientCosts?.[k]))
      };
    }
  }
  /** @type {Record<string, any>} */
  const perModel = {};
  if (snapshot.perModel && typeof snapshot.perModel === 'object') {
    for (const [k, v] of Object.entries(snapshot.perModel)) {
      const model = normalizeModelName(k) || k;
      perModel[model] = { ...v, tokens: Math.max(0, Math.round(num(v?.tokens))), cost: Math.max(0, num(v?.cost)) };
    }
  } else if (snapshot.models && typeof snapshot.models === 'object') {
    for (const [k, v] of Object.entries(snapshot.models)) {
      const model = normalizeModelName(k) || k;
      perModel[model] = {
        tokens: Math.max(0, Math.round(num(v))),
        cost: Math.max(0, num(snapshot.modelCosts?.[k]))
      };
    }
  }
  return {
    date,
    tokens: totalTokens,
    cost,
    unpricedTokens: boundedUnpriced(totalTokens, snapshot.unpricedTokens),
    messages: Math.max(0, Math.round(num(snapshot.messages ?? snapshot.messageCount))),
    activeTimeMs,
    cacheReadTokens: comp.cacheReadTokens,
    cacheWriteTokens: comp.cacheWriteTokens,
    outputTokens: comp.outputTokens,
    unclassifiedTokens: comp.unclassifiedTokens,
    tokenComponentsAvailable: comp.tokenComponentsComplete,
    perClient,
    perModel
  };
}

/**
 * @param {any} history
 * @returns {Map<string, any>}
 */
function indexHistoryDaily(history) {
  /** @type {Map<string, any>} */
  const map = new Map();
  for (const row of (Array.isArray(history?.dailyTotals) ? history.dailyTotals : [])) {
    const date = String(row?.date || '').slice(0, 10);
    if (!date) continue;
    map.set(date, {
      date,
      tokens: Math.max(0, Math.round(num(row.tokens))),
      cost: Math.max(0, num(row.cost)),
      activeTimeMs: Math.max(0, Math.round(num(row.activeTimeMs))),
      tokenComponentsAvailable: false,
      unclassifiedTokens: Math.max(0, Math.round(num(row.tokens))),
      perClient: {},
      perModel: {}
    });
  }
  for (const row of (Array.isArray(history?.daily) ? history.daily : [])) {
    const date = String(row?.date || '').slice(0, 10);
    if (!date) continue;
    map.set(date, row);
  }
  return map;
}

/**
 * Merge a project map or array into a canonicalized project accumulator map.
 * @param {Map<string, any>} target
 * @param {any} projectsInput
 * @param {Map<string, Set<string>>} [projectSessionKeys]
 * @param {any} [sessionsInput]
 * @param {string} [snapshotDay]
 */
function mergeProjectsInto(target, projectsInput, projectSessionKeys, sessionsInput, snapshotDay) {
  if (sessionsInput && typeof sessionsInput === 'object') {
    for (const [rawSessKey, session] of Object.entries(sessionsInput)) {
      if (!session || typeof session !== 'object' || isReasonixSyntheticSession(session, rawSessKey)) continue;
      const label = String(session.projectLabel || '').trim().normalize('NFC');
      const key = canonicalProjectKey(label);
      if (!key) continue;
      const sKey = session.client && session.sessionId
        ? `${session.client}:${session.sessionId}`
        : `${snapshotDay || 'snap'}:${rawSessKey}`;
      if (projectSessionKeys) {
        let set = projectSessionKeys.get(key);
        if (!set) {
          set = new Set();
          projectSessionKeys.set(key, set);
        }
        set.add(sKey);
      }
    }
  }

  /** @type {Array<[string, any]>} */
  const entries = Array.isArray(projectsInput)
    ? projectsInput.map((item) => [String(item?.key || item?.label || ''), item])
    : (projectsInput && typeof projectsInput === 'object' ? Object.entries(projectsInput) : []);

  for (const [rawKey, src] of entries) {
    if (!src || typeof src !== 'object') continue;
    const rawLabel = String(src.label || rawKey || '').trim().normalize('NFC');
    const key = canonicalProjectKey(rawLabel || rawKey);
    if (!key) continue;
    let acc = target.get(key);
    if (!acc) {
      acc = {
        key,
        label: rawLabel || key,
        tokens: 0,
        costUsd: 0,
        unpricedTokens: 0,
        sessionCount: 0,
        clients: new Map(),
        models: new Map()
      };
      target.set(key, acc);
    } else {
      acc.label = deterministicProjectLabel(acc.label, rawLabel || key);
    }
    const tokens = Math.max(0, Math.round(num(src.tokens ?? src.totalTokens)));
    acc.tokens += tokens;
    acc.costUsd += Math.max(0, num(src.costUsd ?? src.cost));
    acc.unpricedTokens += boundedUnpriced(tokens, src.unpricedTokens);
    if (!sessionsInput && Number.isFinite(Number(src.sessionCount))) {
      acc.sessionCount += Math.max(0, Math.round(Number(src.sessionCount)));
    }
    if (Array.isArray(src.clients)) {
      for (const item of src.clients) {
        const c = normalizeClientName(item?.client);
        const cTokens = Math.max(0, Math.round(num(item?.tokens)));
        if (c && cTokens > 0) acc.clients.set(c, (acc.clients.get(c) || 0) + cTokens);
      }
    } else if (src.clients && typeof src.clients === 'object') {
      for (const [rawClient, val] of Object.entries(src.clients)) {
        const c = normalizeClientName(rawClient);
        const cTokens = Math.max(0, Math.round(num(val)));
        if (c && cTokens > 0) acc.clients.set(c, (acc.clients.get(c) || 0) + cTokens);
      }
    }
    if (Array.isArray(src.models)) {
      for (const item of src.models) {
        const m = normalizeModelName(item?.model);
        const mTokens = Math.max(0, Math.round(num(item?.tokens)));
        if (m && mTokens > 0) acc.models.set(m, (acc.models.get(m) || 0) + mTokens);
      }
    } else if (src.models && typeof src.models === 'object') {
      for (const [rawModel, val] of Object.entries(src.models)) {
        const m = normalizeModelName(rawModel);
        const mTokens = Math.max(0, Math.round(num(val)));
        if (m && mTokens > 0) acc.models.set(m, (acc.models.get(m) || 0) + mTokens);
      }
    }
  }
}

/**
 * Collect deduplicated sessions from stats.periods.month.sessions and device records.
 * @param {any} stats
 * @param {any[]} devices
 * @returns {Map<string, any>}
 */
function collectFallbackSessions(stats, devices) {
  /** @type {Map<string, any>} */
  const sessions = new Map();
  /** @param {any} map */
  const addFrom = (map) => {
    if (!map || typeof map !== 'object') return;
    for (const [key, session] of Object.entries(map)) {
      if (!session || typeof session !== 'object' || isReasonixSyntheticSession(session, key)) continue;
      const normKey = session.client && session.sessionId
        ? `${normalizeClientName(session.client) || session.client}:${session.sessionId}`
        : key;
      if (!sessions.has(normKey)) sessions.set(normKey, session);
    }
  };
  addFrom(stats?.periods?.month?.sessions);
  addFrom(stats?.periods?.today?.sessions);
  for (const device of devices) {
    addFrom(devicePeriod(device, 'month')?.sessions);
    addFrom(devicePeriod(device, 'today')?.sessions);
  }
  return sessions;
}

/**
 * Roll up fallback sessions whose lastUsedAt falls on one of missingDates (within timeZone).
 * @param {Map<string, any>} projectAcc
 * @param {Map<string, Set<string>>} projectSessionKeys
 * @param {Map<string, any>} candidateSessions
 * @param {Set<string>} missingDates
 * @param {string} timeZone
 * @returns {number}
 */
function rollUpSessionFallback(projectAcc, projectSessionKeys, candidateSessions, missingDates, timeZone) {
  let matchedSessions = 0;
  for (const [sKey, session] of candidateSessions.entries()) {
    const lastUsedAt = String(session.lastUsedAt || '').trim();
    if (!lastUsedAt) continue;
    const sessionDay = dayKeyInTimeZone(lastUsedAt, timeZone);
    if (!sessionDay || !missingDates.has(sessionDay)) continue;
    const label = String(session.projectLabel || '').trim().normalize('NFC');
    const key = canonicalProjectKey(label);
    if (!key) continue;
    matchedSessions += 1;
    let acc = projectAcc.get(key);
    if (!acc) {
      acc = {
        key,
        label,
        tokens: 0,
        costUsd: 0,
        unpricedTokens: 0,
        sessionCount: 0,
        clients: new Map(),
        models: new Map()
      };
      projectAcc.set(key, acc);
    } else {
      acc.label = deterministicProjectLabel(acc.label, label);
    }
    const tokens = Math.max(0, Math.round(num(session.totalTokens)));
    acc.tokens += tokens;
    acc.costUsd += Math.max(0, num(session.costUsd));
    acc.unpricedTokens += boundedUnpriced(tokens, session.unpricedTokens);
    let set = projectSessionKeys.get(key);
    if (!set) {
      set = new Set();
      projectSessionKeys.set(key, set);
    }
    set.add(sKey);
    const client = normalizeClientName(session.client);
    if (client && tokens > 0) {
      acc.clients.set(client, (acc.clients.get(client) || 0) + tokens);
    }
    for (const [rawModel, val] of Object.entries(session.models || {})) {
      const m = normalizeModelNameForClient(rawModel, client || '');
      const mTokens = Math.max(0, Math.round(num(val)));
      if (m && mTokens > 0) acc.models.set(m, (acc.models.get(m) || 0) + mTokens);
    }
  }
  return matchedSessions;
}

/**
 * @param {any} period
 * @returns {number}
 */
function countValidSessions(period) {
  if (!period?.sessions || typeof period.sessions !== 'object') return 0;
  let count = 0;
  for (const [key, session] of Object.entries(period.sessions)) {
    if (session && typeof session === 'object' && !isReasonixSyntheticSession(session, key)) {
      count += 1;
    }
  }
  return count;
}

/**
 * Build a complete token-monitor-report/v1 usage report.
 * @param {object} params
 * @param {ReportGranularity | string} params.granularity
 * @param {string | null | undefined} [params.periodKey]
 * @param {any} [params.stats]
 * @param {any} [params.history]
 * @param {any[]} [params.devices]
 * @param {any} [params.dailySnapshots]
 * @param {Date | number | string} [params.now]
 * @param {string} [params.timeZone]
 * @returns {UsageReport}
 */
function buildUsageReport({
  granularity,
  periodKey = 'latest',
  stats = null,
  history = null,
  devices = [],
  dailySnapshots = null,
  now,
  timeZone
}) {
  const nowDate = resolveNowDate(now);
  const nowMs = nowDate.getTime();
  const resolved = resolveReportPeriod(granularity, periodKey, { now: nowDate, timeZone });
  const generatedAt = nowDate.toISOString();

  const mergedDevices = collectMergedDevices(stats, devices);
  const liveTodayMatches = doesLivePeriodMatch(stats, mergedDevices, 'today', resolved, nowMs);
  const liveMonthMatches = doesLivePeriodMatch(stats, mergedDevices, 'month', resolved, nowMs);

  const historyDailyByDate = indexHistoryDaily(history);
  const historyMonthlyList = /** @type {any[]} */ (Array.isArray(history?.monthly) ? history.monthly : []);
  const historyMonthlyByMonth = new Map(
    historyMonthlyList
      .filter((m) => m && typeof m.month === 'string')
      .map((m) => /** @type {[string, any]} */ ([m.month, m]))
  );

  const dateRange = enumerateDateRange(resolved.startDate, resolved.endDate);
  const todayKey = dayKeyInTimeZone(nowDate, resolved.timeZone) || localDayKey(nowDate);

  /** @type {any[]} */
  const dayRows = [];
  for (const date of dateRange) {
    const histRow = historyDailyByDate.get(date) || null;
    const snapRow = snapshotToDailyRow(getDailySnapshot(dailySnapshots, date), date);
    let chosen = histRow || snapRow;
    if (date === todayKey && doesLivePeriodMatch(stats, mergedDevices, 'today', { ...resolved, key: date, isCurrent: true }, nowMs)) {
      const liveRow = livePeriodToDailyRow(stats.periods.today, date, histRow || snapRow);
      if (!chosen || liveRow.tokens >= num(chosen.tokens)) {
        chosen = liveRow;
      }
    }
    dayRows.push(chosen || {
      date,
      tokens: 0,
      cost: 0,
      unpricedTokens: 0,
      messages: 0,
      activeTimeMs: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      unclassifiedTokens: 0,
      tokenComponentsAvailable: true,
      perClient: {},
      perModel: {}
    });
  }

  /** @type {ReportTimelineEntry[]} */
  const timeline = dayRows.map((row) => ({
    date: row.date,
    tokens: Math.max(0, Math.round(num(row.tokens))),
    costUsd: round6(Math.max(0, num(row.cost))),
    activeTimeMs: Math.max(0, Math.round(num(row.activeTimeMs))),
    topClient: pickTopName(row.perClient),
    topModel: pickTopName(row.perModel)
  }));

  // Determine aggregate period totals, clients, models, components, throughput
  let totalTokens = 0;
  let knownCostUsd = 0;
  let unpricedTokens = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let unclassifiedTokens = 0;
  let tokenComponentsComplete = true;
  let messageCount = 0;
  let activeTimeMs = 0;
  let timedTokens = 0;
  let timedOutputTokens = 0;
  let timedDurationMs = 0;
  /** @type {Record<string, { timedTokens: number, timedOutputTokens: number, timedDurationMs: number }>} */
  const modelThroughputMap = {};

  /** @type {Map<string, { client: string, tokens: number, costUsd: number, unpricedTokens: number, cacheReadTokens: number, cacheWriteTokens: number, outputTokens: number, inputTokens: number, unclassifiedTokens: number, messageCount: number }>} */
  const clientMap = new Map();
  /** @type {Map<string, { model: string, tokens: number, costUsd: number, unpricedTokens: number, cacheReadTokens: number, cacheWriteTokens: number, outputTokens: number, inputTokens: number, unclassifiedTokens: number }>} */
  const modelMap = new Map();

  /**
   * @param {string} rawClient
   * @param {number} tokens
   * @param {number} costUsd
   * @param {number} unpriced
   * @param {{ inputTokens: number, outputTokens: number, cacheReadTokens: number, cacheWriteTokens: number, unclassifiedTokens: number }} comp
   * @param {number} messages
   */
  const addClientEntry = (rawClient, tokens, costUsd, unpriced, comp, messages) => {
    const client = normalizeClientName(rawClient) || String(rawClient || '').trim();
    if (!client) return;
    let entry = clientMap.get(client);
    if (!entry) {
      entry = {
        client,
        tokens: 0,
        costUsd: 0,
        unpricedTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        inputTokens: 0,
        unclassifiedTokens: 0,
        messageCount: 0
      };
      clientMap.set(client, entry);
    }
    entry.tokens += tokens;
    entry.costUsd += costUsd;
    entry.unpricedTokens += unpriced;
    entry.cacheReadTokens += comp.cacheReadTokens;
    entry.cacheWriteTokens += comp.cacheWriteTokens;
    entry.outputTokens += comp.outputTokens;
    entry.inputTokens += comp.inputTokens;
    entry.unclassifiedTokens += comp.unclassifiedTokens;
    entry.messageCount += messages;
  };

  /**
   * @param {string} rawModel
   * @param {number} tokens
   * @param {number} costUsd
   * @param {number} unpriced
   * @param {{ inputTokens: number, outputTokens: number, cacheReadTokens: number, cacheWriteTokens: number, unclassifiedTokens: number }} comp
   */
  const addModelEntry = (rawModel, tokens, costUsd, unpriced, comp) => {
    const model = normalizeModelName(rawModel) || String(rawModel || '').trim();
    if (!model) return;
    let entry = modelMap.get(model);
    if (!entry) {
      entry = {
        model,
        tokens: 0,
        costUsd: 0,
        unpricedTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        inputTokens: 0,
        unclassifiedTokens: 0
      };
      modelMap.set(model, entry);
    }
    entry.tokens += tokens;
    entry.costUsd += costUsd;
    entry.unpricedTokens += unpriced;
    entry.cacheReadTokens += comp.cacheReadTokens;
    entry.cacheWriteTokens += comp.cacheWriteTokens;
    entry.outputTokens += comp.outputTokens;
    entry.inputTokens += comp.inputTokens;
    entry.unclassifiedTokens += comp.unclassifiedTokens;
  };

  /**
   * @param {any} period
   * @param {number} [extraHistoryMessages]
   * @param {number} [extraActiveTimeMs]
   */
  const accumulateFromPeriod = (period, extraHistoryMessages = 0, extraActiveTimeMs = 0) => {
    const exact = period?.capabilities?.tokenComponents === true;
    const pTokens = Math.max(0, Math.round(num(period?.totalTokens)));
    const comp = computeTokenComponents(period, pTokens, exact);
    totalTokens = pTokens;
    knownCostUsd = Math.max(0, num(period?.costUsd));
    unpricedTokens = boundedUnpriced(pTokens, period?.unpricedTokens);
    inputTokens = comp.inputTokens;
    outputTokens = comp.outputTokens;
    cacheReadTokens = comp.cacheReadTokens;
    cacheWriteTokens = comp.cacheWriteTokens;
    unclassifiedTokens = comp.unclassifiedTokens;
    tokenComponentsComplete = comp.tokenComponentsComplete;
    timedTokens = Math.max(0, Math.round(num(period?.timedTokens)));
    timedOutputTokens = Math.max(0, Math.round(num(period?.timedOutputTokens)));
    timedDurationMs = Math.max(0, Math.round(num(period?.timedDurationMs)));
    if (period?.modelThroughput && typeof period.modelThroughput === 'object') {
      for (const [rawModel, tp] of Object.entries(period.modelThroughput)) {
        const m = normalizeModelName(rawModel) || rawModel;
        if (!m || !tp) continue;
        const target = modelThroughputMap[m] || (modelThroughputMap[m] = { timedTokens: 0, timedOutputTokens: 0, timedDurationMs: 0 });
        target.timedTokens += Math.max(0, Math.round(num(tp.timedTokens)));
        target.timedOutputTokens += Math.max(0, Math.round(num(tp.timedOutputTokens)));
        target.timedDurationMs += Math.max(0, Math.round(num(tp.timedDurationMs)));
      }
    }

    const sessionMsgByClient = new Map();
    let sessionMsgsTotal = 0;
    for (const [sKey, session] of Object.entries(period?.sessions || {})) {
      if (!session || typeof session !== 'object' || isReasonixSyntheticSession(session, sKey)) continue;
      const c = normalizeClientName(session.client) || String(session.client || '').trim();
      const msgs = Math.max(0, Math.round(num(session.messageCount)));
      sessionMsgsTotal += msgs;
      if (c) sessionMsgByClient.set(c, (sessionMsgByClient.get(c) || 0) + msgs);
    }

    const clientKeys = new Set([
      ...Object.keys(period?.clients || {}),
      ...Object.keys(period?.clientCosts || {})
    ]);
    for (const rawClient of clientKeys) {
      const cTokens = Math.max(0, Math.round(num(period?.clients?.[rawClient])));
      const cCost = Math.max(0, num(period?.clientCosts?.[rawClient]));
      const cUnpriced = boundedUnpriced(cTokens, period?.clientUnpricedTokens?.[rawClient]);
      const cComp = computeTokenComponents({
        cacheReadTokens: period?.clientCacheReads?.[rawClient],
        cacheWriteTokens: period?.clientCacheWrites?.[rawClient],
        outputTokens: period?.clientOutputs?.[rawClient],
        ...(hasOwn(period?.clientUnclassifiedTokens, rawClient)
          ? { unclassifiedTokens: period.clientUnclassifiedTokens[rawClient] }
          : {})
      }, cTokens, exact);
      const normClient = normalizeClientName(rawClient) || rawClient;
      const msgs = sessionMsgByClient.get(normClient) || 0;
      addClientEntry(rawClient, cTokens, cCost, cUnpriced, cComp, msgs);
    }

    const modelKeys = new Set([
      ...Object.keys(period?.models || {}),
      ...Object.keys(period?.modelCosts || {})
    ]);
    for (const rawModel of modelKeys) {
      const mTokens = Math.max(0, Math.round(num(period?.models?.[rawModel])));
      const mCost = Math.max(0, num(period?.modelCosts?.[rawModel]));
      const mUnpriced = boundedUnpriced(mTokens, period?.modelUnpricedTokens?.[rawModel]);
      const mComp = computeTokenComponents({
        cacheReadTokens: period?.modelCacheReads?.[rawModel],
        cacheWriteTokens: period?.modelCacheWrites?.[rawModel],
        outputTokens: period?.modelOutputs?.[rawModel],
        ...(hasOwn(period?.modelUnclassifiedTokens, rawModel)
          ? { unclassifiedTokens: period.modelUnclassifiedTokens[rawModel] }
          : {})
      }, mTokens, exact);
      addModelEntry(rawModel, mTokens, mCost, mUnpriced, mComp);
    }

    messageCount = Math.max(sessionMsgsTotal, extraHistoryMessages, Math.round(num(period?.messageCount)));
    activeTimeMs = Math.max(Math.round(num(period?.activeTimeMs)), extraActiveTimeMs);
  };

  /** @param {any[]} rows */
  const accumulateFromDailyRows = (rows) => {
    for (const row of rows) {
      const rTokens = Math.max(0, Math.round(num(row.tokens)));
      const exact = row.tokenComponentsAvailable === true;
      const comp = computeTokenComponents(row, rTokens, exact);
      totalTokens += rTokens;
      knownCostUsd += Math.max(0, num(row.cost));
      unpricedTokens += boundedUnpriced(rTokens, row.unpricedTokens);
      inputTokens += comp.inputTokens;
      outputTokens += comp.outputTokens;
      cacheReadTokens += comp.cacheReadTokens;
      cacheWriteTokens += comp.cacheWriteTokens;
      unclassifiedTokens += comp.unclassifiedTokens;
      if (!comp.tokenComponentsComplete) tokenComponentsComplete = false;
      messageCount += Math.max(0, Math.round(num(row.messages)));
      activeTimeMs += Math.max(0, Math.round(num(row.activeTimeMs)));
      timedTokens += Math.max(0, Math.round(num(row.timedTokens)));
      timedOutputTokens += Math.max(0, Math.round(num(row.timedOutputTokens)));
      timedDurationMs += Math.max(0, Math.round(num(row.timedDurationMs)));
      if (row.modelThroughput && typeof row.modelThroughput === 'object') {
        for (const [rawModel, tp] of Object.entries(row.modelThroughput)) {
          const m = normalizeModelName(rawModel) || rawModel;
          if (!m || !tp) continue;
          const target = modelThroughputMap[m] || (modelThroughputMap[m] = { timedTokens: 0, timedOutputTokens: 0, timedDurationMs: 0 });
          target.timedTokens += Math.max(0, Math.round(num(tp.timedTokens)));
          target.timedOutputTokens += Math.max(0, Math.round(num(tp.timedOutputTokens)));
          target.timedDurationMs += Math.max(0, Math.round(num(tp.timedDurationMs)));
        }
      }
      for (const [rawClient, val] of Object.entries(row.perClient || {})) {
        const cTokens = Math.max(0, Math.round(num(val?.tokens)));
        const cCost = Math.max(0, num(val?.cost));
        const cUnpriced = boundedUnpriced(cTokens, val?.unpricedTokens);
        const cComp = computeTokenComponents(val, cTokens, exact);
        const cMsgs = Math.max(0, Math.round(num(val?.messages)));
        addClientEntry(rawClient, cTokens, cCost, cUnpriced, cComp, cMsgs);
      }
      for (const [rawModel, val] of Object.entries(row.perModel || {})) {
        const mTokens = Math.max(0, Math.round(num(val?.tokens)));
        const mCost = Math.max(0, num(val?.cost));
        const mUnpriced = boundedUnpriced(mTokens, val?.unpricedTokens);
        const mComp = computeTokenComponents(val, mTokens, exact);
        addModelEntry(rawModel, mTokens, mCost, mUnpriced, mComp);
      }
    }
  };

  if (resolved.granularity === 'daily') {
    if (liveTodayMatches && stats?.periods?.today) {
      const histRow = historyDailyByDate.get(resolved.key);
      accumulateFromPeriod(
        stats.periods.today,
        Math.round(num(histRow?.messages)),
        Math.round(num(histRow?.activeTimeMs))
      );
      if (histRow) {
        for (const [rawClient, val] of Object.entries(histRow.perClient || {})) {
          const client = normalizeClientName(rawClient) || rawClient;
          const existing = clientMap.get(client);
          if (existing) {
            existing.messageCount = Math.max(existing.messageCount, Math.round(num(val?.messages)));
          }
        }
      }
    } else {
      accumulateFromDailyRows(dayRows);
    }
  } else if (resolved.granularity === 'weekly') {
    accumulateFromDailyRows(dayRows);
  } else {
    const histMonth = historyMonthlyByMonth.get(resolved.key) || null;
    const timelineTokens = dayRows.reduce((s, r) => s + Math.round(num(r.tokens)), 0);
    const timelineMessages = dayRows.reduce((s, r) => s + Math.round(num(r.messages)), 0);
    const timelineActiveTimeMs = dayRows.reduce((s, r) => s + Math.round(num(r.activeTimeMs)), 0);
    const histMonthMessages = Object.values(histMonth?.perClient || {}).reduce((s, v) => s + Math.round(num(v?.messages)), 0);

    if (liveMonthMatches && stats?.periods?.month) {
      accumulateFromPeriod(
        stats.periods.month,
        Math.max(timelineMessages, histMonthMessages),
        Math.max(timelineActiveTimeMs, Math.round(num(histMonth?.activeTimeMs)))
      );
      for (const [rawClient, val] of Object.entries(histMonth?.perClient || {})) {
        const client = normalizeClientName(rawClient) || rawClient;
        const existing = clientMap.get(client);
        if (existing) {
          existing.messageCount = Math.max(existing.messageCount, Math.round(num(val?.messages)));
        }
      }
      for (const row of dayRows) {
        for (const [rawClient, val] of Object.entries(row.perClient || {})) {
          const client = normalizeClientName(rawClient) || rawClient;
          const existing = clientMap.get(client);
          if (existing) {
            existing.messageCount = Math.max(existing.messageCount, Math.round(num(val?.messages)));
          }
        }
      }
    } else if (timelineTokens > 0 || !histMonth) {
      accumulateFromDailyRows(dayRows);
    } else {
      // Uncapped historical month from history.monthly when rolling daily window has rolled past it
      const mTokens = Math.max(0, Math.round(num(histMonth.tokens)));
      totalTokens = mTokens;
      knownCostUsd = Math.max(0, num(histMonth.cost));
      unpricedTokens = boundedUnpriced(mTokens, histMonth.unpricedTokens);
      unclassifiedTokens = mTokens;
      tokenComponentsComplete = mTokens === 0;
      activeTimeMs = Math.max(0, Math.round(num(histMonth.activeTimeMs)));
      messageCount = histMonthMessages;
      for (const [rawClient, val] of Object.entries(histMonth.perClient || {})) {
        const cTokens = Math.max(0, Math.round(num(val?.tokens)));
        const comp = {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          unclassifiedTokens: cTokens,
          tokenComponentsComplete: cTokens === 0
        };
        addClientEntry(
          rawClient,
          cTokens,
          Math.max(0, num(val?.cost)),
          boundedUnpriced(cTokens, val?.unpricedTokens),
          comp,
          Math.max(0, Math.round(num(val?.messages)))
        );
      }
      for (const [rawModel, val] of Object.entries(histMonth.perModel || {})) {
        const mTok = Math.max(0, Math.round(num(val?.tokens)));
        const comp = {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          unclassifiedTokens: mTok,
          tokenComponentsComplete: mTok === 0
        };
        addModelEntry(
          rawModel,
          mTok,
          Math.max(0, num(val?.cost)),
          boundedUnpriced(mTok, val?.unpricedTokens),
          comp
        );
      }
    }
  }

  knownCostUsd = round6(knownCostUsd);

  // Project attribution
  /** @type {Map<string, any>} */
  const projectAcc = new Map();
  /** @type {Map<string, Set<string>>} */
  const projectSessionKeys = new Map();
  /** @type {ProjectAttributionSource} */
  let projectAttributionSource;
  let projectsComplete;
  let sessionCount = 0;

  const activeTimelineDates = new Set(timeline.filter((row) => row.tokens > 0).map((row) => row.date));
  const mergeSnapshotRange = () => {
    /** @type {Set<string>} */
    const snapshotDates = new Set();
    let totalSnapSessions = 0;
    for (const date of dateRange) {
      const snap = getDailySnapshot(dailySnapshots, date);
      if (snap && snap.projects && typeof snap.projects === 'object') {
        snapshotDates.add(date);
        mergeProjectsInto(projectAcc, snap.projects, projectSessionKeys, snap.sessions, date);
        if (snap.sessions && typeof snap.sessions === 'object') {
          totalSnapSessions += countValidSessions(snap);
        } else if (Number.isFinite(Number(snap.sessionCount))) {
          totalSnapSessions += Math.max(0, Math.round(Number(snap.sessionCount)));
        }
      }
    }
    return { snapshotDates, totalSnapSessions };
  };

  if (resolved.granularity === 'daily') {
    if (liveTodayMatches && stats?.periods?.today) {
      mergeProjectsInto(
        projectAcc,
        stats.periods.today.projects,
        projectSessionKeys,
        stats.periods.today.sessions,
        resolved.key
      );
      sessionCount = countValidSessions(stats.periods.today);
      const omitted = num(stats?.periodProjectsOmitted?.today) > 0;
      const allDisabled = mergedDevices.length > 0 && mergedDevices.every((d) => d.projectsEnabled === false);
      if (projectAcc.size > 0 || totalTokens === 0) {
        projectAttributionSource = 'live-period';
        projectsComplete = !omitted && !allDisabled;
      } else {
        projectAttributionSource = 'none';
        projectsComplete = false;
      }
    } else {
      const snap = getDailySnapshot(dailySnapshots, resolved.key);
      if (snap && snap.projects && typeof snap.projects === 'object') {
        mergeProjectsInto(projectAcc, snap.projects, projectSessionKeys, snap.sessions, resolved.key);
        sessionCount = snap.sessions
          ? countValidSessions(snap)
          : Math.max(0, Math.round(num(snap.sessionCount)));
        if (projectAcc.size > 0 || totalTokens === 0) {
          projectAttributionSource = 'daily-snapshots';
          projectsComplete = snap.projectsComplete !== false;
        } else {
          projectAttributionSource = 'none';
          projectsComplete = false;
        }
      } else {
        projectAttributionSource = 'none';
        projectsComplete = totalTokens === 0;
      }
    }
  } else if (resolved.granularity === 'weekly') {
    const { snapshotDates, totalSnapSessions } = mergeSnapshotRange();
    const missingDates = new Set(dateRange.filter((d) => !snapshotDates.has(d)));
    const candidateSessions = collectFallbackSessions(stats, mergedDevices);
    const fallbackMatched = missingDates.size > 0
      ? rollUpSessionFallback(projectAcc, projectSessionKeys, candidateSessions, missingDates, resolved.timeZone)
      : 0;

    const missingActiveDates = Array.from(activeTimelineDates).filter((d) => !snapshotDates.has(d));
    const totalDedupSessions = new Set();
    for (const set of projectSessionKeys.values()) {
      for (const k of set) totalDedupSessions.add(k);
    }
    sessionCount = Math.max(totalDedupSessions.size, totalSnapSessions);

    if (totalTokens === 0) {
      projectAttributionSource = snapshotDates.size > 0 ? 'daily-snapshots' : 'none';
      projectsComplete = true;
    } else if (snapshotDates.size > 0 && missingActiveDates.length === 0) {
      projectAttributionSource = 'daily-snapshots';
      projectsComplete = projectAcc.size > 0;
    } else if (snapshotDates.size > 0 && missingActiveDates.length > 0) {
      projectAttributionSource = 'partial';
      projectsComplete = false;
    } else if (fallbackMatched > 0) {
      projectAttributionSource = 'session-window';
      projectsComplete = false;
    } else {
      projectAttributionSource = 'none';
      projectsComplete = false;
    }
  } else {
    const liveMonthUsable = liveMonthMatches
      && stats?.periods?.month
      && stats?.projectsIncomplete !== true
      && !(num(stats?.periodProjectsOmitted?.month) > 0);
    if (liveMonthUsable) {
      mergeProjectsInto(
        projectAcc,
        stats.periods.month.projects,
        projectSessionKeys,
        stats.periods.month.sessions,
        resolved.key
      );
      sessionCount = countValidSessions(stats.periods.month);
      if (projectAcc.size > 0 || totalTokens === 0) {
        projectAttributionSource = 'live-period';
        projectsComplete = true;
      } else {
        projectAttributionSource = 'none';
        projectsComplete = false;
      }
    } else {
      const { snapshotDates, totalSnapSessions } = mergeSnapshotRange();
      if (snapshotDates.size > 0) {
        const missingActiveDates = Array.from(activeTimelineDates).filter((d) => !snapshotDates.has(d));
        const totalDedupSessions = new Set();
        for (const set of projectSessionKeys.values()) {
          for (const k of set) totalDedupSessions.add(k);
        }
        sessionCount = Math.max(totalDedupSessions.size, totalSnapSessions);
        if (totalTokens === 0 || (missingActiveDates.length === 0 && projectAcc.size > 0)) {
          projectAttributionSource = 'daily-snapshots';
          projectsComplete = true;
        } else {
          projectAttributionSource = 'partial';
          projectsComplete = false;
        }
      } else if (liveMonthMatches && stats?.periods?.month?.projects && Object.keys(stats.periods.month.projects).length > 0) {
        mergeProjectsInto(
          projectAcc,
          stats.periods.month.projects,
          projectSessionKeys,
          stats.periods.month.sessions,
          resolved.key
        );
        sessionCount = countValidSessions(stats.periods.month);
        projectAttributionSource = 'live-period';
        projectsComplete = false;
      } else {
        projectAttributionSource = 'none';
        projectsComplete = totalTokens === 0;
      }
    }
  }

  /** @type {ReportProjectBreakdown[]} */
  const projects = Array.from(projectAcc.values())
    .map((acc) => {
      const dedupCount = projectSessionKeys.get(acc.key)?.size || 0;
      const pSessionCount = Math.max(dedupCount, acc.sessionCount);
      /** @type {ReportProjectClientShare[]} */
      const clients = Array.from(acc.clients.entries())
        .map(([client, tokens]) => ({ client, tokens, sharePct: pct(tokens, acc.tokens) }))
        .sort((a, b) => b.tokens - a.tokens || a.client.localeCompare(b.client));
      /** @type {ReportProjectModelShare[]} */
      const models = Array.from(acc.models.entries())
        .map(([model, tokens]) => ({ model, tokens, sharePct: pct(tokens, acc.tokens) }))
        .sort((a, b) => b.tokens - a.tokens || a.model.localeCompare(b.model));
      return {
        key: acc.key,
        label: acc.label,
        tokens: acc.tokens,
        costUsd: round6(acc.costUsd),
        unpricedTokens: acc.unpricedTokens,
        tokenSharePct: pct(acc.tokens, totalTokens),
        costSharePct: pct(acc.costUsd, knownCostUsd),
        sessionCount: pSessionCount,
        clients,
        models
      };
    })
    .sort((a, b) => b.tokens - a.tokens || b.costUsd - a.costUsd || a.key.localeCompare(b.key));

  /** @type {ReportClientBreakdown[]} */
  const clients = Array.from(clientMap.values())
    .map((c) => ({
      client: c.client,
      tokens: c.tokens,
      costUsd: round6(c.costUsd),
      unpricedTokens: c.unpricedTokens,
      tokenSharePct: pct(c.tokens, totalTokens),
      costSharePct: pct(c.costUsd, knownCostUsd),
      cacheReadTokens: c.cacheReadTokens,
      cacheWriteTokens: c.cacheWriteTokens,
      outputTokens: c.outputTokens,
      inputTokens: c.inputTokens,
      unclassifiedTokens: c.unclassifiedTokens,
      cacheHitRatePct: computeCacheHitRatePct(c.cacheReadTokens, c.inputTokens, c.cacheWriteTokens),
      messageCount: c.messageCount
    }))
    .sort((a, b) => b.tokens - a.tokens || b.costUsd - a.costUsd || a.client.localeCompare(b.client));

  /** @type {ReportModelBreakdown[]} */
  const models = Array.from(modelMap.values())
    .map((m) => {
      const tp = modelThroughputMap[m.model];
      const avgRate = tp && tp.timedDurationMs > 0 && tp.timedOutputTokens > 0
        ? round2((tp.timedOutputTokens * 1000) / tp.timedDurationMs)
        : 0;
      return {
        model: m.model,
        tokens: m.tokens,
        costUsd: round6(m.costUsd),
        unpricedTokens: m.unpricedTokens,
        tokenSharePct: pct(m.tokens, totalTokens),
        costSharePct: pct(m.costUsd, knownCostUsd),
        cacheReadTokens: m.cacheReadTokens,
        cacheWriteTokens: m.cacheWriteTokens,
        outputTokens: m.outputTokens,
        inputTokens: m.inputTokens,
        unclassifiedTokens: m.unclassifiedTokens,
        cacheHitRatePct: computeCacheHitRatePct(m.cacheReadTokens, m.inputTokens, m.cacheWriteTokens),
        avgOutputTokensPerSec: avgRate
      };
    })
    .sort((a, b) => b.tokens - a.tokens || b.costUsd - a.costUsd || a.model.localeCompare(b.model));

  // Per-device breakdown
  /** @type {ReportDeviceBreakdown[]} */
  const deviceBreakdowns = mergedDevices.map((device) => {
    let dTokens = 0;
    let dCost = 0;
    let dProjectCount = 0;
    const devHistDaily = indexHistoryDaily(device.history);

    if (resolved.granularity === 'daily') {
      const liveToday = devicePeriod(device, 'today');
      const liveKey = String(device?.periodWindows?.today?.key || '').trim();
      const useLive = resolved.isCurrent
        && liveToday
        && !isDevicePeriodExpired(device, 'today', nowMs)
        && (!liveKey || liveKey === resolved.key);
      if (useLive) {
        dTokens = Math.max(0, Math.round(num(liveToday.totalTokens)));
        dCost = Math.max(0, num(liveToday.costUsd));
        dProjectCount = Object.keys(liveToday.projects || {}).length;
      } else {
        const row = devHistDaily.get(resolved.key);
        if (row) {
          dTokens = Math.max(0, Math.round(num(row.tokens)));
          dCost = Math.max(0, num(row.cost));
        }
      }
    } else if (resolved.granularity === 'weekly') {
      for (const date of dateRange) {
        const histRow = devHistDaily.get(date);
        const liveToday = devicePeriod(device, 'today');
        const liveKey = String(device?.periodWindows?.today?.key || '').trim();
        const useLive = date === todayKey
          && liveToday
          && !isDevicePeriodExpired(device, 'today', nowMs)
          && (!liveKey || liveKey === date);
        if (useLive && (!histRow || num(liveToday.totalTokens) >= num(histRow.tokens))) {
          dTokens += Math.max(0, Math.round(num(liveToday.totalTokens)));
          dCost += Math.max(0, num(liveToday.costUsd));
        } else if (histRow) {
          dTokens += Math.max(0, Math.round(num(histRow.tokens)));
          dCost += Math.max(0, num(histRow.cost));
        }
      }
      const snapProjects = new Set();
      for (const session of Object.values(devicePeriod(device, 'month')?.sessions || {})) {
        if (!session || typeof session !== 'object' || isReasonixSyntheticSession(session)) continue;
        const sDay = dayKeyInTimeZone(session.lastUsedAt || '', resolved.timeZone);
        if (sDay && sDay >= resolved.startDate && sDay <= resolved.endDate) {
          const pKey = canonicalProjectKey(session.projectLabel);
          if (pKey) snapProjects.add(pKey);
        }
      }
      dProjectCount = snapProjects.size;
    } else {
      const liveMonth = devicePeriod(device, 'month');
      const liveKey = String(device?.periodWindows?.month?.key || '').trim();
      const useLive = resolved.isCurrent
        && liveMonth
        && !isDevicePeriodExpired(device, 'month', nowMs)
        && (!liveKey || liveKey === resolved.key);
      if (useLive) {
        dTokens = Math.max(0, Math.round(num(liveMonth.totalTokens)));
        dCost = Math.max(0, num(liveMonth.costUsd));
        dProjectCount = Object.keys(liveMonth.projects || {}).length;
      } else {
        let summedDaily = false;
        for (const date of dateRange) {
          const histRow = devHistDaily.get(date);
          if (histRow) {
            summedDaily = true;
            dTokens += Math.max(0, Math.round(num(histRow.tokens)));
            dCost += Math.max(0, num(histRow.cost));
          }
        }
        if (!summedDaily) {
          const deviceMonthly = /** @type {any[]} */ (Array.isArray(device?.history?.monthly) ? device.history.monthly : []);
          const mRow = deviceMonthly.find((m) => m?.month === resolved.key);
          if (mRow) {
            dTokens = Math.max(0, Math.round(num(mRow.tokens)));
            dCost = Math.max(0, num(mRow.cost));
          }
        }
      }
    }

    return {
      deviceId: device.deviceId,
      hostname: String(device.hostname || ''),
      platform: String(device.platform || ''),
      stale: device.stale === true,
      tokens: dTokens,
      costUsd: round6(dCost),
      tokenSharePct: pct(dTokens, totalTokens),
      projectCount: dProjectCount
    };
  }).sort((a, b) => b.tokens - a.tokens || b.costUsd - a.costUsd || a.deviceId.localeCompare(b.deviceId));

  // Peak day & active days
  const activeDays = timeline.filter((row) => row.tokens > 0).length;
  /** @type {{ date: string, tokens: number, costUsd: number } | null} */
  let peakDay = null;
  for (const row of timeline) {
    if (row.tokens <= 0 && row.costUsd <= 0) continue;
    if (!peakDay || row.tokens > peakDay.tokens || (row.tokens === peakDay.tokens && row.costUsd > peakDay.costUsd)) {
      peakDay = { date: row.date, tokens: row.tokens, costUsd: row.costUsd };
    }
  }

  // Previous period comparison
  const comparison = computeComparison(resolved, totalTokens, knownCostUsd, historyDailyByDate, historyMonthlyByMonth, dailySnapshots, nowDate);

  // Coverage
  const anyDeviceMissingHistory = mergedDevices.some((d) => d?.historyAvailable === false);
  const hasHistoryObject = Boolean(history && (Array.isArray(history.daily) || Array.isArray(history.monthly)));
  const historyComplete = hasHistoryObject
    && history?.summary?.activeDaysComplete !== false
    && !anyDeviceMissingHistory;

  const cacheHitRatePct = computeCacheHitRatePct(cacheReadTokens, inputTokens, cacheWriteTokens);
  const avgOutputTokensPerSec = timedDurationMs > 0 && timedOutputTokens > 0
    ? round2((timedOutputTokens * 1000) / timedDurationMs)
    : 0;

  const staleDeviceCount = deviceBreakdowns.filter((d) => d.stale).length;
  const hub = {
    runtime: String(stats?.runtime || stats?.hubRuntime || 'hub'),
    deviceCount: deviceBreakdowns.length,
    activeDeviceCount: deviceBreakdowns.length - staleDeviceCount,
    staleDeviceCount
  };

  const summary = {
    totalTokens,
    knownCostUsd,
    unpricedTokens,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    unclassifiedTokens,
    cacheHitRatePct,
    messageCount,
    sessionCount,
    projectCount: projects.length,
    activeDays,
    activeTimeMs,
    peakDay,
    throughput: {
      timedTokens,
      timedOutputTokens,
      timedDurationMs,
      avgOutputTokensPerSec
    },
    comparison
  };

  const coverage = {
    tokenComponentsComplete,
    projectsComplete,
    projectAttributionSource,
    historyComplete
  };

  const signals = buildSignals({ summary, coverage, projects, hub });

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    schema: REPORT_SCHEMA,
    reportId: `${resolved.granularity}:${resolved.key}`,
    granularity: resolved.granularity,
    period: {
      ...resolved,
      generatedAt
    },
    hub,
    coverage,
    summary,
    projects,
    clients,
    models,
    devices: deviceBreakdowns,
    timeline,
    signals
  };
}

/**
 * @param {ResolvedReportPeriod} resolved
 * @param {number} totalTokens
 * @param {number} knownCostUsd
 * @param {Map<string, any>} historyDailyByDate
 * @param {Map<string, any>} historyMonthlyByMonth
 * @param {any} dailySnapshots
 * @param {Date} nowDate
 */
function computeComparison(resolved, totalTokens, knownCostUsd, historyDailyByDate, historyMonthlyByMonth, dailySnapshots, nowDate) {
  const prevKey = resolved.previousPeriodKey;
  let found = false;
  let previousTokens = 0;
  let previousCostUsd = 0;

  if (resolved.granularity === 'daily') {
    const row = historyDailyByDate.get(prevKey) || snapshotToDailyRow(getDailySnapshot(dailySnapshots, prevKey), prevKey);
    if (row) {
      found = true;
      previousTokens = Math.max(0, Math.round(num(row.tokens)));
      previousCostUsd = Math.max(0, num(row.cost));
    }
  } else if (resolved.granularity === 'weekly') {
    const prevPeriod = resolveReportPeriod('weekly', prevKey, { timeZone: resolved.timeZone, now: nowDate });
    for (const date of enumerateDateRange(prevPeriod.startDate, prevPeriod.endDate)) {
      const row = historyDailyByDate.get(date) || snapshotToDailyRow(getDailySnapshot(dailySnapshots, date), date);
      if (row) {
        found = true;
        previousTokens += Math.max(0, Math.round(num(row.tokens)));
        previousCostUsd += Math.max(0, num(row.cost));
      }
    }
  } else {
    const prevPeriod = resolveReportPeriod('monthly', prevKey, { timeZone: resolved.timeZone, now: nowDate });
    const monthRow = historyMonthlyByMonth.get(prevKey);
    let dailyFound = false;
    let dailyTokens = 0;
    let dailyCost = 0;
    for (const date of enumerateDateRange(prevPeriod.startDate, prevPeriod.endDate)) {
      const row = historyDailyByDate.get(date) || snapshotToDailyRow(getDailySnapshot(dailySnapshots, date), date);
      if (row) {
        dailyFound = true;
        dailyTokens += Math.max(0, Math.round(num(row.tokens)));
        dailyCost += Math.max(0, num(row.cost));
      }
    }
    if (monthRow && (!dailyFound || num(monthRow.tokens) > dailyTokens)) {
      found = true;
      previousTokens = Math.max(0, Math.round(num(monthRow.tokens)));
      previousCostUsd = Math.max(0, num(monthRow.cost));
    } else if (dailyFound) {
      found = true;
      previousTokens = dailyTokens;
      previousCostUsd = dailyCost;
    }
  }

  if (!found) return null;
  previousCostUsd = round6(previousCostUsd);
  const tokenDelta = totalTokens - previousTokens;
  const costDelta = round6(knownCostUsd - previousCostUsd);
  const tokenDeltaPct = previousTokens > 0 ? round2((tokenDelta / previousTokens) * 100) : null;
  const costDeltaPct = previousCostUsd > 0 ? round2((costDelta / previousCostUsd) * 100) : null;
  return {
    previousPeriodKey: prevKey,
    previousTokens,
    previousCostUsd,
    tokenDelta,
    tokenDeltaPct,
    costDelta,
    costDeltaPct
  };
}

/**
 * @param {object} input
 * @param {UsageReport['summary']} input.summary
 * @param {UsageReport['coverage']} input.coverage
 * @param {ReportProjectBreakdown[]} input.projects
 * @param {UsageReport['hub']} input.hub
 * @returns {ReportSignal[]}
 */
function buildSignals({ summary, coverage, projects, hub }) {
  /** @type {ReportSignal[]} */
  const signals = [];

  if (projects.length > 0 && summary.totalTokens > 0 && projects[0].tokenSharePct >= 50) {
    const top = projects[0];
    signals.push({
      code: 'top-project-concentration',
      severity: top.tokenSharePct >= 80 ? 'warning' : 'info',
      projectKey: top.key,
      projectLabel: top.label,
      tokenSharePct: top.tokenSharePct,
      summary: `Top project "${top.label}" accounts for ${top.tokenSharePct}% of total period tokens.`
    });
  }

  const measuredInput = summary.inputTokens + summary.cacheReadTokens + summary.cacheWriteTokens;
  if (measuredInput >= 10000 && summary.cacheHitRatePct < 30) {
    signals.push({
      code: 'low-cache-hit-rate',
      severity: summary.cacheHitRatePct < 10 ? 'warning' : 'info',
      cacheHitRatePct: summary.cacheHitRatePct,
      measuredInputTokens: measuredInput,
      summary: `Cache hit rate is ${summary.cacheHitRatePct}% across ${measuredInput.toLocaleString('en-US')} measured input tokens.`
    });
  }

  if (summary.comparison && summary.comparison.tokenDeltaPct !== null) {
    const deltaPct = summary.comparison.tokenDeltaPct;
    if (deltaPct >= 50 && summary.totalTokens >= 1000) {
      signals.push({
        code: 'period-usage-spike',
        severity: deltaPct >= 100 ? 'warning' : 'info',
        tokenDeltaPct: deltaPct,
        previousTokens: summary.comparison.previousTokens,
        totalTokens: summary.totalTokens,
        summary: `Token usage increased by ${deltaPct}% compared to ${summary.comparison.previousPeriodKey}.`
      });
    } else if (deltaPct <= -50 && summary.comparison.previousTokens >= 1000) {
      signals.push({
        code: 'period-usage-drop',
        severity: 'info',
        tokenDeltaPct: deltaPct,
        previousTokens: summary.comparison.previousTokens,
        totalTokens: summary.totalTokens,
        summary: `Token usage decreased by ${Math.abs(deltaPct)}% compared to ${summary.comparison.previousPeriodKey}.`
      });
    }
  }

  if (summary.unpricedTokens > 0) {
    const unpricedSharePct = pct(summary.unpricedTokens, summary.totalTokens);
    signals.push({
      code: 'unpriced-tokens-present',
      severity: unpricedSharePct >= 50 ? 'warning' : 'info',
      unpricedTokens: summary.unpricedTokens,
      unpricedSharePct,
      summary: `${summary.unpricedTokens.toLocaleString('en-US')} tokens (${unpricedSharePct}%) lack pricing data and are excluded from knownCostUsd.`
    });
  }

  if (hub.staleDeviceCount > 0) {
    signals.push({
      code: 'stale-devices-present',
      severity: 'warning',
      staleDeviceCount: hub.staleDeviceCount,
      deviceCount: hub.deviceCount,
      summary: `${hub.staleDeviceCount} of ${hub.deviceCount} devices are currently stale.`
    });
  }

  if (summary.totalTokens > 0 && !coverage.projectsComplete) {
    signals.push({
      code: 'incomplete-project-attribution',
      severity: 'info',
      projectAttributionSource: coverage.projectAttributionSource,
      summary: `Project attribution is incomplete (source: ${coverage.projectAttributionSource}).`
    });
  }

  return signals;
}

/**
 * @param {any} value
 * @returns {string}
 */
function mdCell(value) {
  return String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|');
}

/**
 * @param {number} value
 * @returns {string}
 */
function fmtInt(value) {
  return Math.round(num(value)).toLocaleString('en-US');
}

/**
 * @param {number} value
 * @returns {string}
 */
function fmtUsd(value) {
  return `$${num(value).toFixed(4)}`;
}

/**
 * @param {number} ms
 * @returns {string}
 */
function fmtDuration(ms) {
  const totalSec = Math.round(Math.max(0, num(ms)) / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  if (mins < 60) return `${mins}m ${secs}s`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}

/**
 * @param {string} value
 * @returns {string}
 */
function yamlString(value) {
  return JSON.stringify(String(value ?? ''));
}

/**
 * Render a UsageReport as clean Markdown with YAML frontmatter and 5 standard sections.
 * @param {UsageReport} report
 * @returns {string}
 */
function renderReportMarkdown(report) {
  const p = report.period;
  const s = report.summary;
  const lines = [
    '---',
    `schema: ${yamlString(report.schema)}`,
    `reportId: ${yamlString(report.reportId)}`,
    `granularity: ${yamlString(report.granularity)}`,
    `periodKey: ${yamlString(p.key)}`,
    `startDate: ${yamlString(p.startDate)}`,
    `endDate: ${yamlString(p.endDate)}`,
    `generatedAt: ${yamlString(p.generatedAt)}`,
    `totalTokens: ${Math.round(num(s.totalTokens))}`,
    `knownCostUsd: ${round6(num(s.knownCostUsd))}`,
    `projectCount: ${Math.round(num(s.projectCount))}`,
    '---',
    '',
    `# Token Monitor Usage Report — ${p.label}`,
    '',
    `Report ID: \`${report.reportId}\` · Timezone: \`${p.timeZone}\` · Devices: ${report.hub.activeDeviceCount}/${report.hub.deviceCount} active`,
    '',
    '## Executive Summary',
    '',
    '| Metric | Value |',
    '| --- | --- |',
    `| Total Tokens | ${fmtInt(s.totalTokens)} |`,
    `| Known Cost (USD) | ${fmtUsd(s.knownCostUsd)} |`,
    `| Unpriced Tokens | ${fmtInt(s.unpricedTokens)} |`,
    `| Input Tokens | ${fmtInt(s.inputTokens)} |`,
    `| Output Tokens | ${fmtInt(s.outputTokens)} |`,
    `| Cache Read Tokens | ${fmtInt(s.cacheReadTokens)} |`,
    `| Cache Write Tokens | ${fmtInt(s.cacheWriteTokens)} |`,
    `| Unclassified Tokens | ${fmtInt(s.unclassifiedTokens)} |`,
    `| Cache Hit Rate | ${s.cacheHitRatePct}% |`,
    `| Messages / Sessions | ${fmtInt(s.messageCount)} / ${fmtInt(s.sessionCount)} |`,
    `| Projects / Active Days | ${fmtInt(s.projectCount)} / ${fmtInt(s.activeDays)} |`,
    `| Active Time | ${fmtDuration(s.activeTimeMs)} |`,
    `| Throughput (Avg Output) | ${s.throughput.avgOutputTokensPerSec} tok/s |`,
    `| Peak Day | ${s.peakDay ? `${s.peakDay.date} (${fmtInt(s.peakDay.tokens)} tokens, ${fmtUsd(s.peakDay.costUsd)})` : 'N/A'} |`
  ];

  if (s.comparison) {
    const sign = s.comparison.tokenDelta >= 0 ? '+' : '';
    const pctText = s.comparison.tokenDeltaPct !== null ? ` (${sign}${s.comparison.tokenDeltaPct}%)` : '';
    lines.push(`| vs Previous (${s.comparison.previousPeriodKey}) | ${sign}${fmtInt(s.comparison.tokenDelta)} tokens${pctText} |`);
  }

  lines.push(
    '',
    '## Project Usage Analysis',
    '',
    `Attribution source: \`${report.coverage.projectAttributionSource}\` · Complete: \`${report.coverage.projectsComplete}\``,
    ''
  );

  if (report.projects.length === 0) {
    lines.push('_No project attribution recorded for this period._');
  } else {
    lines.push(
      '| Project | Tokens | Share | Known Cost | Sessions | Top Client | Top Model |',
      '| --- | ---: | ---: | ---: | ---: | --- | --- |'
    );
    for (const proj of report.projects) {
      lines.push(
        `| ${mdCell(proj.label)} | ${fmtInt(proj.tokens)} | ${proj.tokenSharePct}% | ${fmtUsd(proj.costUsd)} | ${fmtInt(proj.sessionCount)} | ${mdCell(proj.clients[0]?.client || '-')} | ${mdCell(proj.models[0]?.model || '-')} |`
      );
    }
  }

  lines.push(
    '',
    '## Tools & Models Efficiency',
    '',
    '### Clients',
    ''
  );

  if (report.clients.length === 0) {
    lines.push('_No client usage recorded for this period._');
  } else {
    lines.push(
      '| Client | Tokens | Share | Known Cost | Cache Hit | Output | Messages |',
      '| --- | ---: | ---: | ---: | ---: | ---: | ---: |'
    );
    for (const c of report.clients) {
      lines.push(
        `| ${mdCell(c.client)} | ${fmtInt(c.tokens)} | ${c.tokenSharePct}% | ${fmtUsd(c.costUsd)} | ${c.cacheHitRatePct}% | ${fmtInt(c.outputTokens)} | ${fmtInt(c.messageCount)} |`
      );
    }
  }

  lines.push('', '### Models', '');
  if (report.models.length === 0) {
    lines.push('_No model usage recorded for this period._');
  } else {
    lines.push(
      '| Model | Tokens | Share | Known Cost | Cache Hit | Output | Speed (tok/s) |',
      '| --- | ---: | ---: | ---: | ---: | ---: | ---: |'
    );
    for (const m of report.models) {
      lines.push(
        `| ${mdCell(m.model)} | ${fmtInt(m.tokens)} | ${m.tokenSharePct}% | ${fmtUsd(m.costUsd)} | ${m.cacheHitRatePct}% | ${fmtInt(m.outputTokens)} | ${m.avgOutputTokensPerSec} |`
      );
    }
  }

  lines.push('', '## Timeline & Multi-Device Breakdown', '', '### Daily Timeline', '');
  if (report.timeline.length === 0) {
    lines.push('_No timeline entries._');
  } else {
    lines.push(
      '| Date | Tokens | Cost (USD) | Active Time | Top Client | Top Model |',
      '| --- | ---: | ---: | ---: | --- | --- |'
    );
    for (const row of report.timeline) {
      lines.push(
        `| ${row.date} | ${fmtInt(row.tokens)} | ${fmtUsd(row.costUsd)} | ${fmtDuration(row.activeTimeMs)} | ${mdCell(row.topClient || '-')} | ${mdCell(row.topModel || '-')} |`
      );
    }
  }

  lines.push('', '### Devices', '');
  if (report.devices.length === 0) {
    lines.push('_No devices registered._');
  } else {
    lines.push(
      '| Device | Hostname | Platform | Status | Tokens | Share | Cost (USD) | Projects |',
      '| --- | --- | --- | --- | ---: | ---: | ---: | ---: |'
    );
    for (const d of report.devices) {
      lines.push(
        `| ${mdCell(d.deviceId)} | ${mdCell(d.hostname || '-')} | ${mdCell(d.platform || '-')} | ${d.stale ? 'stale' : 'active'} | ${fmtInt(d.tokens)} | ${d.tokenSharePct}% | ${fmtUsd(d.costUsd)} | ${fmtInt(d.projectCount)} |`
      );
    }
  }

  lines.push('', '## Automated Signals', '');
  if (report.signals.length === 0) {
    lines.push('_No notable automated signals detected for this period._');
  } else {
    for (const sig of report.signals) {
      lines.push(`- **[${sig.severity.toUpperCase()}] \`${sig.code}\`**: ${sig.summary}`);
    }
  }
  lines.push('');

  return lines.join('\n');
}

/**
 * Render a UsageReport as formatted JSON with trailing newline.
 * @param {UsageReport} report
 * @returns {string}
 */
function renderReportJson(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}

/**
 * @param {any} value
 * @returns {string}
 */
function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value === undefined ? null : value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const keys = Object.keys(value)
    .filter((k) => value[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

/**
 * Pure-JS 128-bit FNV-1a/Murmur-mixed deterministic hex hash (Node-free, portable).
 * @param {string} source
 * @returns {string}
 */
function deterministicHash128(source) {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  let h3 = 0x85ebca6b;
  let h4 = 0xc2b2ae35;
  for (let i = 0; i < source.length; i += 1) {
    const code = source.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193);
    h2 = Math.imul(h2 ^ (code + i), 0x85ebca6b);
    h3 = Math.imul(h3 ^ (code << 3), 0xc2b2ae35);
    h4 = Math.imul(h4 ^ (code >>> 1), 0x27d4eb2f);
  }
  return [h1, h2, h3, h4]
    .map((n) => (n >>> 0).toString(16).padStart(8, '0'))
    .join('');
}

/**
 * Compute a deterministic content signature excluding `period.generatedAt`
 * so identical reports do not trigger redundant disk rewrites.
 * @param {UsageReport} report
 * @returns {string}
 */
function reportContentSignature(report) {
  const withoutGeneratedAt = report && typeof report === 'object'
    ? {
        ...report,
        period: report.period && typeof report.period === 'object'
          ? { ...report.period, generatedAt: undefined }
          : report.period
      }
    : report;
  return deterministicHash128(stableStringify(withoutGeneratedAt));
}

/**
 * Produce a focused project breakdown and concentration analysis from a UsageReport.
 * @param {UsageReport} report
 * @param {{ project?: string, limit?: number }} [options]
 * @returns {object}
 */
function analyzeProjectUsage(report, options = {}) {
  const allProjects = Array.isArray(report?.projects) ? report.projects : [];
  const queryRaw = options?.project !== undefined && options?.project !== null
    ? String(options.project).trim()
    : '';
  const queryKey = queryRaw ? canonicalProjectKey(queryRaw) : '';
  const limitNum = Number(options?.limit);
  const limit = Number.isFinite(limitNum) && limitNum > 0 ? Math.floor(limitNum) : 20;

  const ranked = allProjects.map((proj, index) => ({
    rank: index + 1,
    ...proj,
    dominantClient: proj.clients?.[0]?.client || null,
    dominantModel: proj.models?.[0]?.model || null
  }));

  let matched = ranked;
  if (queryKey) {
    const exact = ranked.filter((p) => p.key === queryKey);
    matched = exact.length > 0
      ? exact
      : ranked.filter((p) => p.key.includes(queryKey) || p.label.toLowerCase().includes(queryKey));
  }

  const sliced = matched.slice(0, limit);
  const totalTokens = Math.max(0, Math.round(num(report?.summary?.totalTokens)));
  const top1Tokens = allProjects[0]?.tokens || 0;
  const top3Tokens = allProjects.slice(0, 3).reduce((sum, p) => sum + num(p.tokens), 0);
  const attributedTokens = allProjects.reduce((sum, p) => sum + num(p.tokens), 0);
  const unattributedTokens = Math.max(0, totalTokens - attributedTokens);

  return {
    reportId: report?.reportId || '',
    granularity: report?.granularity || 'daily',
    period: report?.period || null,
    coverage: report?.coverage || null,
    query: queryRaw || null,
    totalTokens,
    knownCostUsd: round6(num(report?.summary?.knownCostUsd)),
    projectCount: allProjects.length,
    matchedCount: matched.length,
    projects: sliced,
    topProject: ranked[0] || null,
    concentration: {
      top1SharePct: pct(top1Tokens, totalTokens),
      top3SharePct: pct(top3Tokens, totalTokens),
      attributedTokens,
      attributedSharePct: pct(attributedTokens, totalTokens),
      unattributedTokens,
      unattributedSharePct: pct(unattributedTokens, totalTokens)
    },
    comparison: report?.summary?.comparison || null,
    signals: Array.isArray(report?.signals) ? report.signals : []
  };
}

module.exports = {
  REPORT_SCHEMA_VERSION,
  REPORT_SCHEMA,
  REPORT_GRANULARITIES,
  normalizeReportConfig,
  resolveReportPeriod,
  buildUsageReport,
  renderReportMarkdown,
  renderReportJson,
  reportContentSignature,
  analyzeProjectUsage
};
