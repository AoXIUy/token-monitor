// @ts-check
'use strict';

const {
  computeStreaks,
  dayKeyAddDays,
  localDayKey,
  num
} = require('./history');
const {
  canonicalProjectKey,
  deterministicProjectLabel
} = require('./projectKey');
const { isReasonixSyntheticSession } = require('./providers/reasonix/sessionGuard');
const { isSessionActivityClient } = require('./sessionActivityProviders');
const {
  canReplaceLiveActivity,
  contextTone,
  isArchivedSession,
  isSessionReasoningEffortClient,
  normalizeLiveActivity,
  normalizeReasoningEffort,
  sessionActivityState,
  sessionContextWindow,
  sessionPromptCacheForRow
} = require('./sessionLive');
const {
  normalizeClientName,
  normalizeModelName,
  normalizeModelNameForClient
} = require('./usage');
const {
  buildUsageReport,
  resolveReportPeriod
} = require('./usageReport');
const {
  countOverall,
  normalizeClientHealth
} = require('./clientHealth');
const {
  CURRENCY_CODES,
  normalizeCurrency,
  resolveEffectiveRates
} = require('./currency');
const subscriptionDisplay = require('./subscriptionDisplay');
const balanceDisplay = require('./limits/balanceDisplay');
const { LIMIT_PROVIDER_CATALOG } = require('./limits/providers');
const { limitWindowLabel } = require('./limits/windowLabels');
const { extractLimitsSummary } = require('./aiReportAnalyzer');

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;
const DEFAULT_MAX_PROVIDERS = 32;
const MAX_PROVIDERS = 100;
const MAX_DISPLAY_RATE = 1e12;
const MAX_MODEL_ALIASES = 4096;
const MAX_DISCOVERED_MODELS = 16384;
const MAX_MODEL_ID_LENGTH = 256;
const MAX_SESSION_TITLE_LENGTH = 160;

const BREAKDOWN_PERIODS = Object.freeze(['today', 'month', 'week', 'last7', 'last30', 'allTime']);
const BREAKDOWN_GROUPS = Object.freeze(['summary', 'model', 'client', 'project', 'device']);
const SESSION_PERIODS = Object.freeze(['today', 'month', 'allTime']);
const SESSION_STATES = Object.freeze(['all', 'running', 'waiting', 'ended', 'idle']);
const SESSION_SORTS = Object.freeze(['lastUsedAt', 'totalTokens', 'costUsd']);
const HISTORY_RESOLUTIONS = Object.freeze(['daily', 'monthly', 'summary']);
const HISTORY_GROUPS = Object.freeze(['none', 'client', 'model']);

const SESSION_TEXT_FIELDS = Object.freeze([
  'title', 'sessionTitle', 'session_title',
  'name', 'preview', 'firstUserMessage', 'first_user_message',
  'customTitle', 'custom_title', 'aiTitle', 'ai_title'
]);
const PROTOTYPE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const CLIENT_STATUS_VALUES = new Set(['active', 'waiting', 'missing']);
const WSL_STATUS_STATES = new Set(['active', 'no-data', 'not-running', 'not-installed', 'disabled']);
const LIMIT_PROVIDER_LABELS = new Map(
  LIMIT_PROVIDER_CATALOG.map((entry) => [entry.id, entry.settingsLabel || entry.label])
);
const MODEL_MAP_FIELDS = [
  'models',
  'modelCosts',
  'modelUnpricedTokens',
  'modelCacheReads',
  'modelCacheWrites',
  'modelOutputs',
  'modelUnclassifiedTokens'
];

/**
 * @param {any} obj
 * @param {string} key
 * @returns {boolean}
 */
function hasOwn(obj, key) {
  return Boolean(obj && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, key));
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
 * @param {number} [maxLen]
 * @returns {string}
 */
function cleanText(value, maxLen = 256) {
  const raw = typeof value === 'string' ? value.trim() : '';
  return maxLen > 0 ? raw.slice(0, maxLen) : raw;
}

/**
 * @param {any} value
 * @returns {number | null}
 */
function optionalNum(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * @param {any} value
 * @returns {number}
 */
function nonNegInt(value) {
  return Math.max(0, Math.round(num(value)));
}

/**
 * @param {any} value
 * @returns {number}
 */
function nonNegFloat(value) {
  return Math.max(0, num(value));
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
  return Math.min(nonNegInt(tokens), nonNegInt(rawUnpriced));
}

/**
 * @param {any} value
 * @param {number} [fallback]
 * @param {number} [max]
 * @returns {number}
 */
function clampLimit(value, fallback = DEFAULT_LIMIT, max = MAX_LIMIT) {
  const parsed = optionalNum(value);
  if (parsed === null) return fallback;
  return Math.max(1, Math.min(max, Math.floor(parsed)));
}

/**
 * @param {any} value
 * @returns {string}
 */
function validateDateKey(value) {
  const key = cleanText(value, 16);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return '';
  const date = new Date(`${key}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10) === key ? key : '';
}

/**
 * @param {any} value
 * @returns {string}
 */
function validateMonthKey(value) {
  const key = cleanText(value, 16);
  if (!/^\d{4}-\d{2}$/.test(key)) return '';
  const month = Number(key.slice(5, 7));
  return month >= 1 && month <= 12 ? key : '';
}

/**
 * @param {Date | number | string | undefined} value
 * @returns {Date}
 */
function resolveNowDate(value) {
  if (value === undefined || value === null || value === '') return new Date();
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid timestamp: ${String(value)}`);
  }
  return date;
}

/**
 * @param {any} timeZone
 * @returns {string}
 */
function resolveTimeZone(timeZone) {
  const candidate = cleanText(timeZone, 128);
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
    const map = Object.create(null);
    for (const part of parts) map[part.type] = part.value;
    const key = `${map.year}-${map.month}-${map.day}`;
    return validateDateKey(key);
  } catch {
    return '';
  }
}

/**
 * @param {any} source
 * @param {number} totalTokens
 * @param {boolean} exact
 * @returns {{ inputTokens: number, outputTokens: number, cacheReadTokens: number, cacheWriteTokens: number, unclassifiedTokens: number, tokenComponentsComplete: boolean }}
 */
function computeTokenComponents(source, totalTokens, exact) {
  const total = nonNegInt(totalTokens);
  const cacheReadTokens = nonNegInt(source?.cacheReadTokens);
  const cacheWriteTokens = nonNegInt(source?.cacheWriteTokens);
  const outputTokens = nonNegInt(source?.outputTokens);
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
    ? Math.min(remaining, nonNegInt(source.unclassifiedTokens))
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
 * @param {number} timedOutputTokens
 * @param {number} timedDurationMs
 * @returns {number}
 */
function computeAvgOutputTokensPerSec(timedOutputTokens, timedDurationMs) {
  if (!(timedDurationMs > 0) || !(timedOutputTokens > 0)) return 0;
  return round2(Math.min(MAX_DISPLAY_RATE, (timedOutputTokens * 1000) / timedDurationMs));
}

// ---------------------------------------------------------------------------
// Portable model alias resolution (mirrors renderer/modelAliases.js +
// modelAliasPresentation.js without requiring src/electron/*)
// ---------------------------------------------------------------------------

/**
 * @param {any} model
 * @returns {string}
 */
function aliasMatchKey(model) {
  return cleanText(model, MAX_MODEL_ID_LENGTH)
    .toLowerCase()
    .replace(/[._\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * @param {any} model
 * @returns {string}
 */
function modelLeaf(model) {
  const raw = cleanText(model, MAX_MODEL_ID_LENGTH);
  if (!raw) return '';
  const parts = raw.split('/').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : raw;
}

/**
 * @param {any} model
 * @returns {string}
 */
function modelIdentityKey(model) {
  return aliasMatchKey(modelLeaf(model));
}

/**
 * @param {any} value
 * @returns {'off' | 'duplicates' | 'prefix'}
 */
function normalizeModelAliasGrouping(value) {
  const mode = cleanText(value, 24).toLowerCase();
  if (mode === 'duplicates' || mode === 'prefix') return mode;
  return 'off';
}

/**
 * @param {any} value
 * @returns {Record<string, string>}
 */
function normalizeModelAliases(value) {
  if (!isPlainObject(value)) return {};
  /** @type {Array<[string, string]>} */
  const entries = [];
  const seen = new Set();
  for (const [source, target] of Object.entries(value)) {
    if (typeof target !== 'string') continue;
    const alias = source.trim();
    const canonical = target.trim();
    const aliasKey = aliasMatchKey(alias);
    if (
      !alias
      || !canonical
      || alias.length > MAX_MODEL_ID_LENGTH
      || canonical.length > MAX_MODEL_ID_LENGTH
      || aliasKey === aliasMatchKey(canonical)
      || seen.has(aliasKey)
    ) {
      continue;
    }
    seen.add(aliasKey);
    entries.push([alias, canonical]);
    if (entries.length === MAX_MODEL_ALIASES) break;
  }
  return Object.fromEntries(entries);
}

/**
 * @param {string} left
 * @param {string} right
 * @param {string} identity
 * @returns {number}
 */
function compareCanonicalCandidates(left, right, identity) {
  /** @param {string} model */
  const rank = (model) => {
    const leaf = modelLeaf(model);
    const leafKey = modelIdentityKey(model);
    return [
      leafKey === identity ? 0 : 1,
      model === leaf ? 0 : 1,
      leaf === leaf.toLowerCase() ? 0 : 1,
      /[._\s]/.test(leaf) ? 1 : 0,
      leaf.length,
      leaf.toLowerCase(),
      leaf
    ];
  };
  const a = rank(left);
  const b = rank(right);
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}

/**
 * @param {string[]} modelIds
 * @param {'off' | 'duplicates' | 'prefix'} grouping
 * @returns {Record<string, string>}
 */
function inferModelAliases(modelIds, grouping) {
  const mode = normalizeModelAliasGrouping(grouping);
  if (mode === 'off') return {};
  /** @type {string[]} */
  const models = [];
  const seen = new Set();
  for (const value of Array.isArray(modelIds) ? modelIds : []) {
    const model = cleanText(value, MAX_MODEL_ID_LENGTH);
    if (!model || seen.has(model)) continue;
    seen.add(model);
    models.push(model);
    if (models.length === MAX_DISCOVERED_MODELS) break;
  }
  if (models.length < (mode === 'prefix' ? 1 : 2)) return {};

  /** @type {Map<string, string[]>} */
  const groups = new Map();
  for (const model of models) {
    const key = modelIdentityKey(model);
    if (!key) continue;
    const group = groups.get(key) || [];
    group.push(model);
    groups.set(key, group);
  }

  /** @type {Array<[string, string]>} */
  const aliases = [];
  for (const [identity, group] of groups) {
    if (mode !== 'prefix' && group.length < 2) continue;
    const canonical = modelLeaf(
      [...group].sort((a, b) => compareCanonicalCandidates(a, b, identity))[0]
    );
    for (const model of group) {
      if (model === canonical) continue;
      aliases.push([model, canonical]);
      if (aliases.length === MAX_MODEL_ALIASES) return Object.fromEntries(aliases);
    }
  }
  return Object.fromEntries(aliases);
}

/**
 * @param {any} modelIds
 * @param {Set<string>} target
 */
function collectModelMapIds(modelIds, target) {
  if (!modelIds || typeof modelIds !== 'object') return;
  for (const model of Object.keys(modelIds)) {
    const clean = cleanText(model, MAX_MODEL_ID_LENGTH);
    if (clean) target.add(clean);
  }
}

/**
 * @param {any} period
 * @param {Set<string>} target
 */
function collectPeriodModelIds(period, target) {
  if (!period || typeof period !== 'object') return;
  if (typeof period.model === 'string' && period.model.trim()) target.add(period.model.trim());
  if (typeof period.latestModel === 'string' && period.latestModel.trim()) target.add(period.latestModel.trim());
  for (const field of MODEL_MAP_FIELDS) collectModelMapIds(period[field], target);
  collectModelMapIds(period.modelThroughput, target);
  for (const field of ['clientModels', 'clientModelCosts', 'clientModelUnpricedTokens']) {
    if (!period[field] || typeof period[field] !== 'object') continue;
    for (const nested of Object.values(period[field])) collectModelMapIds(nested, target);
  }
  for (const field of ['sessions', 'projects']) {
    if (!period[field] || typeof period[field] !== 'object') continue;
    for (const row of Object.values(period[field])) collectPeriodModelIds(row, target);
  }
}

/**
 * @param {any} history
 * @param {Set<string>} target
 */
function collectHistoryModelIds(history, target) {
  if (!history || typeof history !== 'object') return;
  for (const field of ['daily', 'monthly']) {
    for (const row of Array.isArray(history[field]) ? history[field] : []) {
      collectModelMapIds(row?.perModel, target);
      if (row?.clientModelCosts && typeof row.clientModelCosts === 'object') {
        for (const nested of Object.values(row.clientModelCosts)) collectModelMapIds(nested, target);
      }
    }
  }
  if (typeof history.summary?.favoriteModel === 'string' && history.summary.favoriteModel.trim()) {
    target.add(history.summary.favoriteModel.trim());
  }
}

/**
 * @param {any} stats
 * @param {any} history
 * @param {any} modelAliases
 * @param {any} modelAliasGrouping
 * @returns {{ active: boolean, resolve: (model: string) => string }}
 */
function createAliasResolver(stats, history, modelAliases, modelAliasGrouping) {
  const grouping = normalizeModelAliasGrouping(modelAliasGrouping);
  const explicitObj = normalizeModelAliases(modelAliases);
  /** @type {Set<string>} */
  const observed = new Set();
  if (grouping !== 'off') {
    if (stats && typeof stats === 'object') {
      for (const p of Object.values(stats.periods || {})) collectPeriodModelIds(p, observed);
      for (const field of ['today', 'month', 'allTime']) collectPeriodModelIds(stats[field], observed);
      for (const device of Array.isArray(stats.devices) ? stats.devices : []) {
        for (const p of Object.values(device?.periods || {})) collectPeriodModelIds(p, observed);
        for (const field of ['today', 'month', 'allTime']) collectPeriodModelIds(device?.[field], observed);
        collectHistoryModelIds(device?.history, observed);
      }
      collectHistoryModelIds(stats.history, observed);
    }
    collectHistoryModelIds(history, observed);
  }
  const automaticObj = inferModelAliases([...observed], grouping);
  const active = Object.keys(explicitObj).length > 0 || Object.keys(automaticObj).length > 0;
  if (!active) {
    return { active: false, resolve: (model) => model };
  }
  const explicit = new Map(
    Object.entries(explicitObj).map(([alias, canonical]) => [aliasMatchKey(alias), canonical])
  );
  const automatic = new Map(
    Object.entries(automaticObj).map(([alias, canonical]) => [aliasMatchKey(alias), canonical])
  );
  /** @type {Map<string, string>} */
  const cache = new Map();
  return {
    active: true,
    resolve(model) {
      if (typeof model !== 'string') return model;
      const hit = cache.get(model);
      if (hit !== undefined) return hit;
      const key = aliasMatchKey(model);
      let resolved = explicit.get(key);
      if (resolved === undefined) {
        const inferred = automatic.get(key);
        resolved = inferred === undefined ? model : (explicit.get(aliasMatchKey(inferred)) ?? inferred);
      }
      cache.set(model, resolved);
      return resolved;
    }
  };
}

/**
 * @param {any} map
 * @param {(model: string) => string} resolve
 * @returns {any}
 */
function foldModelNumericMap(map, resolve) {
  if (!map || typeof map !== 'object') return map;
  const keys = Object.keys(map);
  if (!keys.some((model) => resolve(model) !== model)) return map;
  /** @type {Map<string, number>} */
  const out = new Map();
  for (const model of keys) {
    const key = resolve(model);
    if (PROTOTYPE_KEYS.has(key)) continue;
    out.set(key, (out.get(key) || 0) + num(map[model]));
  }
  return Object.fromEntries(out);
}

/**
 * @param {any} map
 * @param {(model: string) => string} resolve
 * @returns {any}
 */
function foldModelThroughputMap(map, resolve) {
  if (!map || typeof map !== 'object') return map;
  const keys = Object.keys(map);
  if (!keys.some((model) => resolve(model) !== model)) return map;
  /** @type {Map<string, { timedTokens: number, timedOutputTokens: number, timedDurationMs: number }>} */
  const out = new Map();
  for (const model of keys) {
    const key = resolve(model);
    if (PROTOTYPE_KEYS.has(key)) continue;
    const prev = out.get(key) || { timedTokens: 0, timedOutputTokens: 0, timedDurationMs: 0 };
    const src = map[model];
    prev.timedTokens += nonNegInt(src?.timedTokens);
    prev.timedOutputTokens += nonNegInt(src?.timedOutputTokens);
    prev.timedDurationMs += nonNegInt(src?.timedDurationMs);
    out.set(key, prev);
  }
  return Object.fromEntries(out);
}

/**
 * @param {any} period
 * @param {(model: string) => string} resolve
 * @returns {any}
 */
function projectPeriodAliases(period, resolve) {
  if (!period || typeof period !== 'object') return period;
  let result = period;
  /**
   * @param {string} field
   * @param {any} nextVal
   */
  const set = (field, nextVal) => {
    if (nextVal === period[field]) return;
    if (result === period) result = { ...period };
    result[field] = nextVal;
  };
  for (const field of MODEL_MAP_FIELDS) {
    if (period[field]) set(field, foldModelNumericMap(period[field], resolve));
  }
  if (period.modelThroughput) set('modelThroughput', foldModelThroughputMap(period.modelThroughput, resolve));
  if (period.projects && typeof period.projects === 'object') {
    let projects = period.projects;
    for (const [k, proj] of Object.entries(period.projects)) {
      if (!proj?.models) continue;
      const nextModels = foldModelNumericMap(proj.models, resolve);
      if (nextModels !== proj.models) {
        if (projects === period.projects) projects = { ...period.projects };
        projects[k] = { ...proj, models: nextModels };
      }
    }
    set('projects', projects);
  }
  if (period.sessions && typeof period.sessions === 'object') {
    let sessions = period.sessions;
    for (const [k, sess] of Object.entries(period.sessions)) {
      if (!sess || typeof sess !== 'object') continue;
      let nextSess = sess;
      if (sess.models) {
        const nextModels = foldModelNumericMap(sess.models, resolve);
        if (nextModels !== sess.models) nextSess = { ...nextSess, models: nextModels };
      }
      if (typeof sess.latestModel === 'string') {
        const nextLatest = resolve(sess.latestModel);
        if (nextLatest !== sess.latestModel) {
          if (nextSess === sess) nextSess = { ...sess };
          nextSess.latestModel = nextLatest;
        }
      }
      if (nextSess !== sess) {
        if (sessions === period.sessions) sessions = { ...period.sessions };
        sessions[k] = nextSess;
      }
    }
    set('sessions', sessions);
  }
  return result;
}

/**
 * @param {any} row
 * @param {(model: string) => string} resolve
 * @returns {any}
 */
function projectHistoryRowAliases(row, resolve) {
  if (!row || typeof row !== 'object' || !row.perModel) return row;
  const keys = Object.keys(row.perModel);
  if (!keys.some((model) => resolve(model) !== model)) return row;
  /** @type {Map<string, any>} */
  const grouped = new Map();
  for (const [model, bucket] of Object.entries(row.perModel)) {
    const key = resolve(model);
    if (PROTOTYPE_KEYS.has(key)) continue;
    const prev = grouped.get(key);
    if (!prev) {
      grouped.set(key, { ...bucket });
      continue;
    }
    const merged = { ...prev };
    for (const [f, v] of Object.entries(bucket || {})) {
      if (typeof v === 'number') merged[f] = num(prev[f]) + num(v);
      else if (f === 'tokenComponentsAvailable') merged[f] = v === true && prev[f] !== false;
      else if (!hasOwn(merged, f)) merged[f] = v;
    }
    const prevUnc = hasOwn(prev, 'unclassifiedTokens')
      ? num(prev.unclassifiedTokens)
      : (prev.tokenComponentsAvailable === true ? 0 : num(prev.tokens));
    const curUnc = hasOwn(bucket, 'unclassifiedTokens')
      ? num(bucket?.unclassifiedTokens)
      : (bucket?.tokenComponentsAvailable === true ? 0 : num(bucket?.tokens));
    merged.unclassifiedTokens = prevUnc + curUnc;
    grouped.set(key, merged);
  }
  return { ...row, perModel: Object.fromEntries(grouped) };
}

/**
 * @param {any} history
 * @param {(model: string) => string} resolve
 * @returns {any}
 */
function projectHistoryAliases(history, resolve) {
  if (!history || typeof history !== 'object') return history;
  let result = history;
  for (const field of ['daily', 'monthly']) {
    if (!Array.isArray(history[field])) continue;
    let changed = false;
    const nextArr = history[field].map((/** @type {any} */ row) => {
      const projected = projectHistoryRowAliases(row, resolve);
      if (projected !== row) changed = true;
      return projected;
    });
    if (changed) {
      if (result === history) result = { ...history };
      result[field] = nextArr;
    }
  }
  return result;
}

/**
 * @param {any} stats
 * @param {(model: string) => string} resolve
 * @returns {any}
 */
function projectStatsAliases(stats, resolve) {
  if (!stats || typeof stats !== 'object') return stats;
  let result = stats;
  if (stats.periods && typeof stats.periods === 'object') {
    let periods = stats.periods;
    for (const pName of ['today', 'month', 'allTime']) {
      if (!stats.periods[pName]) continue;
      const nextP = projectPeriodAliases(stats.periods[pName], resolve);
      if (nextP !== stats.periods[pName]) {
        if (periods === stats.periods) periods = { ...stats.periods };
        periods[pName] = nextP;
      }
    }
    if (periods !== stats.periods) {
      result = { ...result, periods };
    }
  }
  if (Array.isArray(stats.devices)) {
    let devChanged = false;
    const nextDevices = stats.devices.map((/** @type {any} */ d) => {
      if (!d || typeof d !== 'object') return d;
      let nextD = d;
      if (d.periods && typeof d.periods === 'object') {
        let periods = d.periods;
        for (const pName of ['today', 'month', 'allTime']) {
          if (!d.periods[pName]) continue;
          const nextP = projectPeriodAliases(d.periods[pName], resolve);
          if (nextP !== d.periods[pName]) {
            if (periods === d.periods) periods = { ...d.periods };
            periods[pName] = nextP;
          }
        }
        if (periods !== d.periods) nextD = { ...nextD, periods };
      }
      if (d.history) {
        const nextH = projectHistoryAliases(d.history, resolve);
        if (nextH !== d.history) nextD = { ...nextD, history: nextH };
      }
      if (nextD !== d) devChanged = true;
      return nextD;
    });
    if (devChanged) {
      if (result === stats) result = { ...stats };
      result.devices = nextDevices;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// 1. queryUsageBreakdown
// ---------------------------------------------------------------------------

/**
 * @param {any} period
 * @returns {number}
 */
function countPeriodSessions(period) {
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
 * @param {any} period
 * @param {(model: string) => string} resolveModel
 * @param {number} totalTokens
 * @param {number} knownCostUsd
 * @returns {any[]}
 */
function buildModelRowsFromPeriod(period, resolveModel, totalTokens, knownCostUsd) {
  const exact = period?.capabilities?.tokenComponents === true;
  /** @type {Map<string, any>} */
  const map = new Map();
  const modelKeys = new Set([
    ...Object.keys(period?.models || {}),
    ...Object.keys(period?.modelCosts || {}),
    ...Object.keys(period?.modelThroughput || {})
  ]);

  for (const rawModel of modelKeys) {
    const baseName = normalizeModelName(rawModel) || cleanText(rawModel, MAX_MODEL_ID_LENGTH);
    if (!baseName || PROTOTYPE_KEYS.has(baseName)) continue;
    const resolved = resolveModel(baseName);
    if (!resolved || PROTOTYPE_KEYS.has(resolved)) continue;
    const tokens = nonNegInt(period?.models?.[rawModel]);
    const cost = nonNegFloat(period?.modelCosts?.[rawModel]);
    const unpriced = boundedUnpriced(tokens, period?.modelUnpricedTokens?.[rawModel]);
    const comp = computeTokenComponents({
      cacheReadTokens: period?.modelCacheReads?.[rawModel],
      cacheWriteTokens: period?.modelCacheWrites?.[rawModel],
      outputTokens: period?.modelOutputs?.[rawModel],
      ...(hasOwn(period?.modelUnclassifiedTokens, rawModel)
        ? { unclassifiedTokens: period.modelUnclassifiedTokens[rawModel] }
        : {})
    }, tokens, exact);
    const tp = period?.modelThroughput?.[rawModel];
    let acc = map.get(resolved);
    if (!acc) {
      acc = {
        model: resolved,
        totalTokens: 0,
        knownCostUsd: 0,
        unpricedTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        unclassifiedTokens: 0,
        timedTokens: 0,
        timedOutputTokens: 0,
        timedDurationMs: 0
      };
      map.set(resolved, acc);
    }
    acc.totalTokens += tokens;
    acc.knownCostUsd += cost;
    acc.unpricedTokens += unpriced;
    acc.inputTokens += comp.inputTokens;
    acc.outputTokens += comp.outputTokens;
    acc.cacheReadTokens += comp.cacheReadTokens;
    acc.cacheWriteTokens += comp.cacheWriteTokens;
    acc.unclassifiedTokens += comp.unclassifiedTokens;
    acc.timedTokens += nonNegInt(tp?.timedTokens);
    acc.timedOutputTokens += nonNegInt(tp?.timedOutputTokens);
    acc.timedDurationMs += nonNegInt(tp?.timedDurationMs);
  }

  return Array.from(map.values())
    .filter((entry) => entry.totalTokens > 0 || entry.knownCostUsd > 0)
    .map((entry) => ({
      model: entry.model,
      totalTokens: entry.totalTokens,
      knownCostUsd: round6(entry.knownCostUsd),
      unpricedTokens: entry.unpricedTokens,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      cacheReadTokens: entry.cacheReadTokens,
      cacheWriteTokens: entry.cacheWriteTokens,
      unclassifiedTokens: entry.unclassifiedTokens,
      cacheHitRatePct: computeCacheHitRatePct(entry.cacheReadTokens, entry.inputTokens, entry.cacheWriteTokens),
      avgOutputTokensPerSec: computeAvgOutputTokensPerSec(entry.timedOutputTokens, entry.timedDurationMs),
      tokenSharePct: pct(entry.totalTokens, totalTokens),
      costSharePct: pct(entry.knownCostUsd, knownCostUsd)
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens || b.knownCostUsd - a.knownCostUsd || a.model.localeCompare(b.model));
}

/**
 * @param {any} period
 * @param {number} totalTokens
 * @param {number} knownCostUsd
 * @returns {any[]}
 */
function buildClientRowsFromPeriod(period, totalTokens, knownCostUsd) {
  const exact = period?.capabilities?.tokenComponents === true;
  /** @type {Map<string, number>} */
  const sessionMsgs = new Map();
  for (const [sKey, session] of Object.entries(period?.sessions || {})) {
    if (!session || typeof session !== 'object' || isReasonixSyntheticSession(session, sKey)) continue;
    const c = normalizeClientName(session.client) || cleanText(session.client, 64).toLowerCase();
    if (c) sessionMsgs.set(c, (sessionMsgs.get(c) || 0) + nonNegInt(session.messageCount));
  }

  /** @type {Map<string, any>} */
  const map = new Map();
  const clientKeys = new Set([
    ...Object.keys(period?.clients || {}),
    ...Object.keys(period?.clientCosts || {})
  ]);
  for (const rawClient of clientKeys) {
    const client = normalizeClientName(rawClient) || cleanText(rawClient, 64).toLowerCase();
    if (!client || PROTOTYPE_KEYS.has(client)) continue;
    const tokens = nonNegInt(period?.clients?.[rawClient]);
    const cost = nonNegFloat(period?.clientCosts?.[rawClient]);
    const unpriced = boundedUnpriced(tokens, period?.clientUnpricedTokens?.[rawClient]);
    const comp = computeTokenComponents({
      cacheReadTokens: period?.clientCacheReads?.[rawClient],
      cacheWriteTokens: period?.clientCacheWrites?.[rawClient],
      outputTokens: period?.clientOutputs?.[rawClient],
      ...(hasOwn(period?.clientUnclassifiedTokens, rawClient)
        ? { unclassifiedTokens: period.clientUnclassifiedTokens[rawClient] }
        : {})
    }, tokens, exact);

    let acc = map.get(client);
    if (!acc) {
      acc = {
        client,
        totalTokens: 0,
        knownCostUsd: 0,
        unpricedTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        unclassifiedTokens: 0,
        messageCount: sessionMsgs.get(client) || 0
      };
      map.set(client, acc);
    }
    acc.totalTokens += tokens;
    acc.knownCostUsd += cost;
    acc.unpricedTokens += unpriced;
    acc.inputTokens += comp.inputTokens;
    acc.outputTokens += comp.outputTokens;
    acc.cacheReadTokens += comp.cacheReadTokens;
    acc.cacheWriteTokens += comp.cacheWriteTokens;
    acc.unclassifiedTokens += comp.unclassifiedTokens;
  }

  return Array.from(map.values())
    .filter((entry) => entry.totalTokens > 0 || entry.knownCostUsd > 0)
    .map((entry) => ({
      client: entry.client,
      totalTokens: entry.totalTokens,
      knownCostUsd: round6(entry.knownCostUsd),
      unpricedTokens: entry.unpricedTokens,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      cacheReadTokens: entry.cacheReadTokens,
      cacheWriteTokens: entry.cacheWriteTokens,
      unclassifiedTokens: entry.unclassifiedTokens,
      cacheHitRatePct: computeCacheHitRatePct(entry.cacheReadTokens, entry.inputTokens, entry.cacheWriteTokens),
      messageCount: entry.messageCount,
      tokenSharePct: pct(entry.totalTokens, totalTokens),
      costSharePct: pct(entry.knownCostUsd, knownCostUsd)
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens || b.knownCostUsd - a.knownCostUsd || a.client.localeCompare(b.client));
}

/**
 * @param {any} period
 * @param {(model: string) => string} resolveModel
 * @param {number} totalTokens
 * @param {number} knownCostUsd
 * @returns {any[]}
 */
function buildProjectRowsFromPeriod(period, resolveModel, totalTokens, knownCostUsd) {
  /** @type {Map<string, Set<string>>} */
  const sessionKeysByProj = new Map();
  for (const [sKey, session] of Object.entries(period?.sessions || {})) {
    if (!session || typeof session !== 'object' || isReasonixSyntheticSession(session, sKey)) continue;
    const label = String(session.projectLabel || '').trim().normalize('NFC');
    const key = canonicalProjectKey(label);
    if (!key) continue;
    const dedupKey = session.client && session.sessionId ? `${session.client}:${session.sessionId}` : sKey;
    let set = sessionKeysByProj.get(key);
    if (!set) {
      set = new Set();
      sessionKeysByProj.set(key, set);
    }
    set.add(dedupKey);
  }

  /** @type {Map<string, any>} */
  const projectMap = new Map();
  const hasExplicitProjects = period?.projects && typeof period.projects === 'object' && Object.keys(period.projects).length > 0;
  if (hasExplicitProjects) {
    for (const [rawKey, src] of Object.entries(period.projects)) {
      if (!src || typeof src !== 'object') continue;
      const rawLabel = String(src.label || rawKey || '').trim().normalize('NFC');
      const key = canonicalProjectKey(rawLabel || rawKey);
      if (!key || PROTOTYPE_KEYS.has(key)) continue;
      let acc = projectMap.get(key);
      if (!acc) {
        acc = {
          key,
          label: rawLabel || key,
          totalTokens: 0,
          knownCostUsd: 0,
          unpricedTokens: 0,
          sessionCount: 0,
          clients: new Map(),
          models: new Map()
        };
        projectMap.set(key, acc);
      } else {
        acc.label = deterministicProjectLabel(acc.label, rawLabel || key);
      }
      const pTokens = nonNegInt(src.tokens ?? src.totalTokens);
      acc.totalTokens += pTokens;
      acc.knownCostUsd += nonNegFloat(src.costUsd ?? src.cost);
      acc.unpricedTokens += boundedUnpriced(pTokens, src.unpricedTokens);
      if (!period?.sessions && Number.isFinite(Number(src.sessionCount))) {
        acc.sessionCount += nonNegInt(src.sessionCount);
      }
      for (const [rawC, val] of Object.entries(src.clients || {})) {
        const c = normalizeClientName(rawC);
        const cTok = nonNegInt(val);
        if (c && cTok > 0) acc.clients.set(c, (acc.clients.get(c) || 0) + cTok);
      }
      for (const [rawM, val] of Object.entries(src.models || {})) {
        const baseM = normalizeModelName(rawM) || cleanText(rawM, MAX_MODEL_ID_LENGTH);
        const m = baseM ? resolveModel(baseM) : '';
        const mTok = nonNegInt(val);
        if (m && mTok > 0) acc.models.set(m, (acc.models.get(m) || 0) + mTok);
      }
    }
  } else {
    for (const [sKey, session] of Object.entries(period?.sessions || {})) {
      if (!session || typeof session !== 'object' || isReasonixSyntheticSession(session, sKey)) continue;
      const label = String(session.projectLabel || '').trim().normalize('NFC');
      const key = canonicalProjectKey(label);
      if (!key || PROTOTYPE_KEYS.has(key)) continue;
      let acc = projectMap.get(key);
      if (!acc) {
        acc = {
          key,
          label,
          totalTokens: 0,
          knownCostUsd: 0,
          unpricedTokens: 0,
          sessionCount: 0,
          clients: new Map(),
          models: new Map()
        };
        projectMap.set(key, acc);
      } else {
        acc.label = deterministicProjectLabel(acc.label, label);
      }
      const sTokens = nonNegInt(session.totalTokens);
      acc.totalTokens += sTokens;
      acc.knownCostUsd += nonNegFloat(session.costUsd);
      acc.unpricedTokens += boundedUnpriced(sTokens, session.unpricedTokens);
      const c = normalizeClientName(session.client);
      if (c && sTokens > 0) acc.clients.set(c, (acc.clients.get(c) || 0) + sTokens);
      for (const [rawM, val] of Object.entries(session.models || {})) {
        const baseM = normalizeModelNameForClient(rawM, c || '') || cleanText(rawM, MAX_MODEL_ID_LENGTH);
        const m = baseM ? resolveModel(baseM) : '';
        const mTok = nonNegInt(val);
        if (m && mTok > 0) acc.models.set(m, (acc.models.get(m) || 0) + mTok);
      }
    }
  }

  return Array.from(projectMap.values())
    .map((acc) => {
      const clients = Array.from(acc.clients.entries())
        .map(([client, tokens]) => ({ client, tokens, sharePct: pct(tokens, acc.totalTokens) }))
        .sort((a, b) => b.tokens - a.tokens || a.client.localeCompare(b.client));
      const models = Array.from(acc.models.entries())
        .map(([model, tokens]) => ({ model, tokens, sharePct: pct(tokens, acc.totalTokens) }))
        .sort((a, b) => b.tokens - a.tokens || a.model.localeCompare(b.model));
      return {
        key: acc.key,
        label: acc.label,
        totalTokens: acc.totalTokens,
        knownCostUsd: round6(acc.knownCostUsd),
        unpricedTokens: acc.unpricedTokens,
        tokenSharePct: pct(acc.totalTokens, totalTokens),
        costSharePct: pct(acc.knownCostUsd, knownCostUsd),
        sessionCount: Math.max(sessionKeysByProj.get(acc.key)?.size || 0, acc.sessionCount),
        clients,
        models
      };
    })
    .sort((a, b) => b.totalTokens - a.totalTokens || b.knownCostUsd - a.knownCostUsd || a.key.localeCompare(b.key));
}

/**
 * @param {any} period
 * @returns {{
 *   totalTokens: number,
 *   knownCostUsd: number,
 *   unpricedTokens: number,
 *   inputTokens: number,
 *   outputTokens: number,
 *   cacheReadTokens: number,
 *   cacheWriteTokens: number,
 *   unclassifiedTokens: number,
 *   cacheHitRatePct: number,
 *   avgOutputTokensPerSec: number,
 *   messageCount: number,
 *   sessionCount: number,
 *   activeDays: number,
 *   activeTimeMs: number,
 *   tokenComponentsComplete: boolean
 * }}
 */
function buildTotalsFromPeriod(period) {
  const totalTokens = nonNegInt(period?.totalTokens);
  const knownCostUsd = round6(nonNegFloat(period?.costUsd));
  const unpricedTokens = boundedUnpriced(totalTokens, period?.unpricedTokens);
  const exact = period?.capabilities?.tokenComponents === true;
  const comp = computeTokenComponents(period, totalTokens, exact);
  let sessionMsgs = 0;
  for (const [key, session] of Object.entries(period?.sessions || {})) {
    if (!session || typeof session !== 'object' || isReasonixSyntheticSession(session, key)) continue;
    sessionMsgs += nonNegInt(session.messageCount);
  }
  const timedOutputTokens = nonNegInt(period?.timedOutputTokens);
  const timedDurationMs = nonNegInt(period?.timedDurationMs);
  return {
    totalTokens,
    knownCostUsd,
    unpricedTokens,
    inputTokens: comp.inputTokens,
    outputTokens: comp.outputTokens,
    cacheReadTokens: comp.cacheReadTokens,
    cacheWriteTokens: comp.cacheWriteTokens,
    unclassifiedTokens: comp.unclassifiedTokens,
    cacheHitRatePct: computeCacheHitRatePct(comp.cacheReadTokens, comp.inputTokens, comp.cacheWriteTokens),
    avgOutputTokensPerSec: computeAvgOutputTokensPerSec(timedOutputTokens, timedDurationMs),
    messageCount: Math.max(sessionMsgs, nonNegInt(period?.messageCount)),
    sessionCount: countPeriodSessions(period),
    activeDays: totalTokens > 0 ? 1 : 0,
    activeTimeMs: nonNegInt(period?.activeTimeMs),
    tokenComponentsComplete: comp.tokenComponentsComplete
  };
}

/**
 * @param {any[]} devices
 * @param {'today' | 'month' | 'allTime'} periodName
 * @param {number} totalTokens
 * @param {number} knownCostUsd
 * @returns {any[]}
 */
function buildDeviceRowsForNativePeriod(devices, periodName, totalTokens, knownCostUsd) {
  return devices
    .map((device) => {
      const p = device?.periods?.[periodName] || device?.[periodName] || null;
      const dTotals = buildTotalsFromPeriod(p);
      return {
        deviceId: cleanText(device.deviceId || device.id, 128),
        hostname: cleanText(device.hostname, 256),
        osName: cleanText(device.osName, 64) || null,
        osVersion: cleanText(device.osVersion, 128) || null,
        platform: cleanText(device.platform, 64) || null,
        stale: device.stale === true,
        totalTokens: dTotals.totalTokens,
        knownCostUsd: dTotals.knownCostUsd,
        unpricedTokens: dTotals.unpricedTokens,
        inputTokens: dTotals.inputTokens,
        outputTokens: dTotals.outputTokens,
        cacheReadTokens: dTotals.cacheReadTokens,
        cacheWriteTokens: dTotals.cacheWriteTokens,
        unclassifiedTokens: dTotals.unclassifiedTokens,
        cacheHitRatePct: dTotals.cacheHitRatePct,
        avgOutputTokensPerSec: dTotals.avgOutputTokensPerSec,
        tokenSharePct: pct(dTotals.totalTokens, totalTokens),
        costSharePct: pct(dTotals.knownCostUsd, knownCostUsd),
        projectCount: Object.keys(p?.projects || {}).length
      };
    })
    .sort((a, b) => b.totalTokens - a.totalTokens || b.knownCostUsd - a.knownCostUsd || a.deviceId.localeCompare(b.deviceId));
}

/**
 * @param {any} period
 * @param {string} date
 * @param {any} [historyRow]
 * @returns {any}
 */
function livePeriodToDailyRowLocal(period, date, historyRow) {
  const exact = period?.capabilities?.tokenComponents === true;
  /** @type {Record<string, any>} */
  const perClient = Object.create(null);
  /** @type {Map<string, number>} */
  const sessionMsgsByClient = new Map();
  let totalSessionMsgs = 0;
  for (const [sKey, session] of Object.entries(period?.sessions || {})) {
    if (!session || typeof session !== 'object' || isReasonixSyntheticSession(session, sKey)) continue;
    const c = normalizeClientName(session.client) || cleanText(session.client, 64).toLowerCase();
    const msgs = nonNegInt(session.messageCount);
    totalSessionMsgs += msgs;
    if (c) sessionMsgsByClient.set(c, (sessionMsgsByClient.get(c) || 0) + msgs);
  }
  const clientKeys = new Set([
    ...Object.keys(period?.clients || {}),
    ...Object.keys(period?.clientCosts || {})
  ]);
  for (const rawClient of clientKeys) {
    const client = normalizeClientName(rawClient) || cleanText(rawClient, 64).toLowerCase();
    if (!client || PROTOTYPE_KEYS.has(client)) continue;
    const tokens = nonNegInt(period?.clients?.[rawClient]);
    const cost = nonNegFloat(period?.clientCosts?.[rawClient]);
    const comp = computeTokenComponents({
      cacheReadTokens: period?.clientCacheReads?.[rawClient],
      cacheWriteTokens: period?.clientCacheWrites?.[rawClient],
      outputTokens: period?.clientOutputs?.[rawClient],
      ...(hasOwn(period?.clientUnclassifiedTokens, rawClient)
        ? { unclassifiedTokens: period.clientUnclassifiedTokens[rawClient] }
        : {})
    }, tokens, exact);
    const unpriced = boundedUnpriced(tokens, period?.clientUnpricedTokens?.[rawClient]);
    const histMsgs = nonNegInt(historyRow?.perClient?.[client]?.messages);
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
  const perModel = Object.create(null);
  const modelKeys = new Set([
    ...Object.keys(period?.models || {}),
    ...Object.keys(period?.modelCosts || {})
  ]);
  for (const rawModel of modelKeys) {
    const model = normalizeModelName(rawModel) || cleanText(rawModel, MAX_MODEL_ID_LENGTH);
    if (!model || PROTOTYPE_KEYS.has(model)) continue;
    const tokens = nonNegInt(period?.models?.[rawModel]);
    const cost = nonNegFloat(period?.modelCosts?.[rawModel]);
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

  const totalTokens = nonNegInt(period?.totalTokens);
  const comp = computeTokenComponents(period, totalTokens, exact);
  const histMessages = nonNegInt(historyRow?.messages);
  const clientMsgSum = Object.values(perClient).reduce((sum, c) => sum + nonNegInt(c.messages), 0);

  return {
    date,
    tokens: totalTokens,
    cost: nonNegFloat(period?.costUsd),
    unpricedTokens: boundedUnpriced(totalTokens, period?.unpricedTokens),
    messages: Math.max(histMessages, totalSessionMsgs, clientMsgSum, nonNegInt(period?.messageCount)),
    activeTimeMs: Math.max(nonNegInt(period?.activeTimeMs), nonNegInt(historyRow?.activeTimeMs)),
    cacheReadTokens: comp.cacheReadTokens,
    cacheWriteTokens: comp.cacheWriteTokens,
    outputTokens: comp.outputTokens,
    unclassifiedTokens: comp.unclassifiedTokens,
    tokenComponentsAvailable: comp.tokenComponentsComplete,
    timedTokens: nonNegInt(period?.timedTokens),
    timedOutputTokens: nonNegInt(period?.timedOutputTokens),
    timedDurationMs: nonNegInt(period?.timedDurationMs),
    modelThroughput: period?.modelThroughput || null,
    perClient,
    perModel
  };
}

/**
 * @param {any} history
 * @returns {Map<string, any>}
 */
function indexHistoryDailyRows(history) {
  /** @type {Map<string, any>} */
  const map = new Map();
  for (const row of Array.isArray(history?.dailyTotals) ? history.dailyTotals : []) {
    const date = validateDateKey(String(row?.date || '').slice(0, 10));
    if (!date) continue;
    const tokens = nonNegInt(row.tokens);
    map.set(date, {
      date,
      tokens,
      cost: nonNegFloat(row.cost),
      activeTimeMs: nonNegInt(row.activeTimeMs),
      tokenComponentsAvailable: false,
      unclassifiedTokens: tokens,
      perClient: {},
      perModel: {}
    });
  }
  for (const row of Array.isArray(history?.daily) ? history.daily : []) {
    const date = validateDateKey(String(row?.date || '').slice(0, 10));
    if (!date) continue;
    map.set(date, row);
  }
  return map;
}

/**
 * @param {any} device
 * @param {number} nowMs
 * @param {string} targetDate
 * @returns {boolean}
 */
function doesDeviceTodayMatchDate(device, nowMs, targetDate) {
  const todayPeriod = device?.periods?.today || device?.today;
  if (!todayPeriod || typeof todayPeriod !== 'object') return false;
  const endsAt = device?.periodWindows?.today?.endsAt;
  if (endsAt) {
    const endMs = Date.parse(endsAt);
    if (Number.isFinite(endMs) && endMs > 0 && nowMs >= endMs) return false;
  }
  const key = validateDateKey(device?.periodWindows?.today?.key);
  return !key || key === targetDate;
}

/**
 * @param {any} stats
 * @param {any[]} devices
 * @param {number} nowMs
 * @param {string} todayKey
 * @returns {boolean}
 */
function doesAggregateTodayMatch(stats, devices, nowMs, todayKey) {
  const period = stats?.periods?.today || stats?.today;
  if (!period || typeof period !== 'object') return false;
  if (devices.length === 0) {
    const topKey = validateDateKey(stats?.periodWindows?.today?.key);
    const endsAt = stats?.periodWindows?.today?.endsAt;
    if (endsAt) {
      const endMs = Date.parse(endsAt);
      if (Number.isFinite(endMs) && endMs > 0 && nowMs >= endMs) return false;
    }
    return !topKey || topKey === todayKey;
  }
  const activeKeys = devices
    .filter((d) => {
      const endsAt = d?.periodWindows?.today?.endsAt;
      if (!endsAt) return true;
      const ms = Date.parse(endsAt);
      return !(Number.isFinite(ms) && ms > 0 && nowMs >= ms);
    })
    .map((d) => validateDateKey(d?.periodWindows?.today?.key))
    .filter(Boolean);
  if (activeKeys.length === 0) return true;
  return activeKeys.includes(todayKey);
}

/**
 * @param {any} stats
 * @param {any[]} extraDevices
 * @returns {any[]}
 */
function mergeDeviceLists(stats, extraDevices) {
  /** @type {Map<string, any>} */
  const byId = new Map();
  for (const raw of Array.isArray(extraDevices) ? extraDevices : []) {
    if (!raw || typeof raw !== 'object') continue;
    const id = cleanText(raw.deviceId || raw.id, 128);
    if (!id || PROTOTYPE_KEYS.has(id)) continue;
    byId.set(id, { ...raw, deviceId: id });
  }
  for (const raw of Array.isArray(stats?.devices) ? stats.devices : []) {
    if (!raw || typeof raw !== 'object') continue;
    const id = cleanText(raw.deviceId || raw.id, 128);
    if (!id || PROTOTYPE_KEYS.has(id)) continue;
    const prev = byId.get(id) || {};
    byId.set(id, {
      ...prev,
      ...raw,
      deviceId: id,
      periods: raw.periods || prev.periods || {},
      ...(prev.history !== undefined && raw.history === undefined ? { history: prev.history } : {}),
      ...(prev.historyAvailable !== undefined && raw.historyAvailable === undefined
        ? { historyAvailable: prev.historyAvailable }
        : {})
    });
  }
  return Array.from(byId.values()).sort((a, b) => a.deviceId.localeCompare(b.deviceId));
}

/**
 * @param {any} history
 * @param {string} deviceId
 * @returns {any}
 */
function findDeviceHistory(history, deviceId) {
  if (!history || typeof history !== 'object') return null;
  if (Array.isArray(history.deviceHistories)) {
    const match = history.deviceHistories.find((/** @type {any} */ entry) => (
      entry && (entry.deviceId === deviceId || entry.id === deviceId) && entry.history
    ));
    if (match?.history) return match.history;
  }
  return null;
}

/**
 * Query usage breakdown across native and rolling periods with optional
 * device filtering, model alias grouping, and bounded sorted rows.
 *
 * @param {{
 *   stats?: any,
 *   history?: any,
 *   devices?: any[],
 *   dailySnapshots?: any,
 *   period?: string,
 *   range?: string,
 *   groupBy?: string,
 *   deviceId?: string,
 *   limit?: number,
 *   modelAliases?: Record<string, string> | null,
 *   modelAliasGrouping?: string,
 *   now?: Date | number | string,
 *   timeZone?: string,
 *   todayKey?: string
 * }} [params]
 */
function queryUsageBreakdown({
  stats = null,
  history = null,
  devices = [],
  dailySnapshots = null,
  period,
  range,
  groupBy = 'summary',
  deviceId = '',
  limit = DEFAULT_LIMIT,
  modelAliases = null,
  modelAliasGrouping = 'off',
  now,
  timeZone,
  todayKey: explicitTodayKey
} = {}) {
  const rawPeriodInput = period !== undefined && period !== null && String(period).trim() !== ''
    ? String(period).trim()
    : (range !== undefined && range !== null && String(range).trim() !== '' ? String(range).trim() : 'today');
  const normPeriod = rawPeriodInput.toLowerCase() === 'alltime' ? 'allTime' : rawPeriodInput.toLowerCase();
  if (!BREAKDOWN_PERIODS.includes(normPeriod)) {
    throw new Error(`Invalid period "${rawPeriodInput}". Expected one of: ${BREAKDOWN_PERIODS.join(', ')}`);
  }

  const rawGroupInput = groupBy === undefined || groupBy === null || String(groupBy).trim() === ''
    ? 'summary'
    : String(groupBy).trim().toLowerCase();
  if (!BREAKDOWN_GROUPS.includes(rawGroupInput)) {
    throw new Error(`Invalid groupBy "${String(groupBy)}". Expected one of: ${BREAKDOWN_GROUPS.join(', ')}`);
  }
  const normGroupBy = /** @type {'summary' | 'model' | 'client' | 'project' | 'device'} */ (rawGroupInput);
  const cleanDeviceId = cleanText(deviceId, 128);
  const boundedLimit = clampLimit(limit, DEFAULT_LIMIT, MAX_LIMIT);

  const nowDate = resolveNowDate(now);
  const nowMs = nowDate.getTime();
  const resolvedTimeZone = resolveTimeZone(timeZone);
  const todayKey = validateDateKey(explicitTodayKey)
    || dayKeyInTimeZone(nowDate, resolvedTimeZone)
    || localDayKey(nowDate);

  const resolvedHistory = history ?? stats?.history ?? null;
  const aliasResolver = createAliasResolver(stats, resolvedHistory, modelAliases, modelAliasGrouping);

  const mergedDevices = mergeDeviceLists(stats, devices);
  const selectedDevice = cleanDeviceId
    ? mergedDevices.find((d) => d.deviceId === cleanDeviceId) || null
    : null;

  if (cleanDeviceId && !selectedDevice) {
    return {
      period: {
        id: normPeriod,
        key: normPeriod,
        label: normPeriod,
        startDate: null,
        endDate: null,
        timeZone: resolvedTimeZone,
        deviceId: cleanDeviceId,
        deviceFound: false,
        available: false,
        incomplete: false
      },
      groupBy: normGroupBy,
      totals: buildTotalsFromPeriod(null),
      totalRows: 0,
      truncated: false,
      rows: []
    };
  }

  // Native periods: today | month | allTime
  if (normPeriod === 'today' || normPeriod === 'month' || normPeriod === 'allTime') {
    const rawPeriodObj = cleanDeviceId
      ? (selectedDevice.periods?.[normPeriod] || selectedDevice[normPeriod] || null)
      : (stats?.periods?.[normPeriod] || stats?.[normPeriod] || null);
    const periodObj = rawPeriodObj && aliasResolver.active
      ? projectPeriodAliases(rawPeriodObj, aliasResolver.resolve)
      : rawPeriodObj;

    let totals;
    /** @type {any[]} */
    let allRows = [];
    let available = Boolean(periodObj);

    if (periodObj) {
      totals = buildTotalsFromPeriod(periodObj);
      if (normPeriod === 'today') {
        totals.activeDays = totals.totalTokens > 0 ? 1 : 0;
      } else if (!cleanDeviceId && resolvedHistory?.summary) {
        if (normPeriod === 'allTime' && Number.isFinite(Number(resolvedHistory.summary.activeDays))) {
          totals.activeDays = nonNegInt(resolvedHistory.summary.activeDays);
        }
      }
      if (normPeriod === 'month' && !cleanDeviceId) {
        const monthPrefix = todayKey.slice(0, 7);
        const dailyRows = Array.isArray(resolvedHistory?.daily) ? resolvedHistory.daily : [];
        const monthActive = dailyRows.filter((/** @type {any} */ d) => (
          String(d?.date || '').startsWith(monthPrefix) && nonNegInt(d.tokens) > 0
        )).length;
        if (monthActive > 0) totals.activeDays = monthActive;
        else if (totals.totalTokens > 0) totals.activeDays = Math.max(totals.activeDays, 1);
      }

      if (normGroupBy === 'model') {
        allRows = buildModelRowsFromPeriod(periodObj, aliasResolver.resolve, totals.totalTokens, totals.knownCostUsd);
      } else if (normGroupBy === 'client') {
        allRows = buildClientRowsFromPeriod(periodObj, totals.totalTokens, totals.knownCostUsd);
      } else if (normGroupBy === 'project') {
        allRows = buildProjectRowsFromPeriod(periodObj, aliasResolver.resolve, totals.totalTokens, totals.knownCostUsd);
      } else if (normGroupBy === 'device') {
        const scopedDevices = cleanDeviceId ? [selectedDevice] : mergedDevices;
        allRows = buildDeviceRowsForNativePeriod(scopedDevices, normPeriod, totals.totalTokens, totals.knownCostUsd);
      }
    } else if (!cleanDeviceId && resolvedHistory) {
      // Fallback from history when live stats period is absent
      if (normPeriod === 'today') {
        const row = indexHistoryDailyRows(resolvedHistory).get(todayKey) || null;
        available = Boolean(row);
        const projected = row && aliasResolver.active ? projectHistoryRowAliases(row, aliasResolver.resolve) : row;
        return buildDailyRowsQueryResult({
          periodId: 'today',
          key: todayKey,
          label: todayKey,
          startDate: todayKey,
          endDate: todayKey,
          timeZone: resolvedTimeZone,
          deviceId: null,
          available,
          incomplete: !available,
          dayRows: projected ? [projected] : [],
          groupBy: normGroupBy,
          limit: boundedLimit,
          resolveModel: aliasResolver.resolve,
          projectRows: [],
          deviceRows: []
        });
      }
      if (normPeriod === 'allTime') {
        const summary = resolvedHistory.summary || {};
        /** @type {any[]} */
        const monthly = Array.isArray(resolvedHistory.monthly) ? resolvedHistory.monthly : [];
        available = Boolean(resolvedHistory.summary || monthly.length > 0);
        const totalTokens = nonNegInt(
          summary.totalTokens ?? monthly.reduce((/** @type {number} */ s, /** @type {any} */ m) => s + nonNegInt(m.tokens), 0)
        );
        const knownCostUsd = round6(nonNegFloat(
          summary.totalCost ?? monthly.reduce((/** @type {number} */ s, /** @type {any} */ m) => s + nonNegFloat(m.cost), 0)
        ));
        const unpricedTokens = boundedUnpriced(
          totalTokens,
          summary.unpricedTokens ?? monthly.reduce((/** @type {number} */ s, /** @type {any} */ m) => s + nonNegInt(m.unpricedTokens), 0)
        );
        totals = {
          totalTokens,
          knownCostUsd,
          unpricedTokens,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          unclassifiedTokens: totalTokens,
          cacheHitRatePct: 0,
          avgOutputTokensPerSec: 0,
          messageCount: nonNegInt(summary.messages),
          sessionCount: 0,
          activeDays: nonNegInt(summary.activeDays),
          activeTimeMs: nonNegInt(summary.activeTimeMs),
          tokenComponentsComplete: totalTokens === 0
        };
        if (normGroupBy === 'client' || normGroupBy === 'model') {
          allRows = aggregateHistoryBreakdown(monthly, normGroupBy, totalTokens, knownCostUsd, aliasResolver.resolve);
        }
      } else {
        totals = buildTotalsFromPeriod(null);
      }
    } else {
      totals = buildTotalsFromPeriod(null);
    }

    const metaKey = cleanDeviceId
      ? (cleanText(selectedDevice?.periodWindows?.[normPeriod]?.key, 32) || (normPeriod === 'today' ? todayKey : normPeriod === 'month' ? todayKey.slice(0, 7) : 'allTime'))
      : (normPeriod === 'today' ? todayKey : normPeriod === 'month' ? todayKey.slice(0, 7) : 'allTime');

    return {
      period: {
        id: normPeriod,
        key: metaKey,
        label: metaKey,
        startDate: normPeriod === 'today' ? metaKey : normPeriod === 'month' && /^\d{4}-\d{2}$/.test(metaKey) ? `${metaKey}-01` : null,
        endDate: normPeriod === 'today' ? metaKey : normPeriod === 'month' && /^\d{4}-\d{2}$/.test(metaKey)
          ? new Date(Date.UTC(Number(metaKey.slice(0, 4)), Number(metaKey.slice(5, 7)), 0)).toISOString().slice(0, 10)
          : null,
        timeZone: resolvedTimeZone,
        deviceId: cleanDeviceId || null,
        deviceFound: true,
        available,
        incomplete: Boolean(
          normGroupBy === 'project'
          && (stats?.projectsIncomplete || stats?.periodProjectsOmitted?.[normPeriod] || selectedDevice?.projectsEnabled === false)
        )
      },
      groupBy: normGroupBy,
      totals,
      totalRows: allRows.length,
      truncated: allRows.length > boundedLimit,
      rows: allRows.slice(0, boundedLimit)
    };
  }

  // Rolling / calendar derived periods: week | last7 | last30
  const scopedHistory = cleanDeviceId
    ? (selectedDevice.history
      || findDeviceHistory(resolvedHistory, cleanDeviceId)
      || (mergedDevices.length === 1 ? resolvedHistory : null)
      || selectedDevice.historyPreview
      || null)
    : resolvedHistory;

  const aliasedHistory = scopedHistory && aliasResolver.active
    ? projectHistoryAliases(scopedHistory, aliasResolver.resolve)
    : scopedHistory;
  const scopedBaseStats = cleanDeviceId
    ? {
        ...(stats || {}),
        periods: selectedDevice.periods || {},
        devices: [selectedDevice]
      }
    : stats;
  const aliasedStats = scopedBaseStats && aliasResolver.active
    ? projectStatsAliases(scopedBaseStats, aliasResolver.resolve)
    : scopedBaseStats;
  const scopedDevices = cleanDeviceId ? [selectedDevice] : mergedDevices;

  if (normPeriod === 'week') {
    const resolved = resolveReportPeriod('weekly', 'latest', {
      now: nowDate,
      timeZone: resolvedTimeZone
    });
    const report = buildUsageReport({
      granularity: 'weekly',
      periodKey: resolved.key,
      stats: aliasedStats,
      history: aliasedHistory,
      devices: cleanDeviceId ? [selectedDevice] : devices,
      dailySnapshots,
      now: nowDate,
      timeZone: resolvedTimeZone
    });
    const s = report.summary;
    const totals = {
      totalTokens: s.totalTokens,
      knownCostUsd: s.knownCostUsd,
      unpricedTokens: s.unpricedTokens,
      inputTokens: s.inputTokens,
      outputTokens: s.outputTokens,
      cacheReadTokens: s.cacheReadTokens,
      cacheWriteTokens: s.cacheWriteTokens,
      unclassifiedTokens: s.unclassifiedTokens,
      cacheHitRatePct: s.cacheHitRatePct,
      avgOutputTokensPerSec: s.throughput.avgOutputTokensPerSec,
      messageCount: s.messageCount,
      sessionCount: s.sessionCount,
      activeDays: s.activeDays,
      activeTimeMs: s.activeTimeMs,
      tokenComponentsComplete: report.coverage.tokenComponentsComplete
    };
    /** @type {any[]} */
    let allRows = [];
    if (normGroupBy === 'model') {
      allRows = report.models.map((m) => ({
        model: m.model,
        totalTokens: m.tokens,
        knownCostUsd: m.costUsd,
        unpricedTokens: m.unpricedTokens,
        inputTokens: m.inputTokens,
        outputTokens: m.outputTokens,
        cacheReadTokens: m.cacheReadTokens,
        cacheWriteTokens: m.cacheWriteTokens,
        unclassifiedTokens: m.unclassifiedTokens,
        cacheHitRatePct: m.cacheHitRatePct,
        avgOutputTokensPerSec: m.avgOutputTokensPerSec,
        tokenSharePct: m.tokenSharePct,
        costSharePct: m.costSharePct
      }));
    } else if (normGroupBy === 'client') {
      allRows = report.clients.map((c) => ({
        client: c.client,
        totalTokens: c.tokens,
        knownCostUsd: c.costUsd,
        unpricedTokens: c.unpricedTokens,
        inputTokens: c.inputTokens,
        outputTokens: c.outputTokens,
        cacheReadTokens: c.cacheReadTokens,
        cacheWriteTokens: c.cacheWriteTokens,
        unclassifiedTokens: c.unclassifiedTokens,
        cacheHitRatePct: c.cacheHitRatePct,
        messageCount: c.messageCount,
        tokenSharePct: c.tokenSharePct,
        costSharePct: c.costSharePct
      }));
    } else if (normGroupBy === 'project') {
      allRows = report.projects.map((p) => ({
        key: p.key,
        label: p.label,
        totalTokens: p.tokens,
        knownCostUsd: p.costUsd,
        unpricedTokens: p.unpricedTokens,
        tokenSharePct: p.tokenSharePct,
        costSharePct: p.costSharePct,
        sessionCount: p.sessionCount,
        clients: p.clients,
        models: p.models
      }));
    } else if (normGroupBy === 'device') {
      const deviceMetaById = new Map(scopedDevices.map((d) => [d.deviceId, d]));
      allRows = report.devices.map((d) => {
        const meta = deviceMetaById.get(d.deviceId);
        return {
          deviceId: d.deviceId,
          hostname: d.hostname,
          osName: cleanText(meta?.osName, 64) || null,
          osVersion: cleanText(meta?.osVersion, 128) || null,
          platform: d.platform || null,
          stale: d.stale,
          totalTokens: d.tokens,
          knownCostUsd: d.costUsd,
          tokenSharePct: d.tokenSharePct,
          costSharePct: pct(d.costUsd, totals.knownCostUsd),
          projectCount: d.projectCount
        };
      });
    }
    return {
      period: {
        id: 'week',
        key: resolved.key,
        label: resolved.label,
        startDate: resolved.startDate,
        endDate: resolved.endDate,
        timeZone: resolved.timeZone,
        deviceId: cleanDeviceId || null,
        deviceFound: true,
        available: Boolean(aliasedHistory || report.summary.totalTokens > 0),
        incomplete: !report.coverage.historyComplete || (normGroupBy === 'project' && !report.coverage.projectsComplete)
      },
      groupBy: normGroupBy,
      totals,
      totalRows: allRows.length,
      truncated: allRows.length > boundedLimit,
      rows: allRows.slice(0, boundedLimit)
    };
  }

  // last7 / last30
  const daysBack = normPeriod === 'last7' ? 6 : 29;
  const startDate = dayKeyAddDays(todayKey, -daysBack);
  const endDate = todayKey;
  const dailyMap = indexHistoryDailyRows(aliasedHistory);
  const liveTodayPeriod = aliasedStats?.periods?.today || aliasedStats?.today || null;
  const liveTodayValid = cleanDeviceId
    ? doesDeviceTodayMatchDate(selectedDevice, nowMs, todayKey)
    : doesAggregateTodayMatch(aliasedStats, scopedDevices, nowMs, todayKey);

  /** @type {any[]} */
  const dayRows = [];
  for (let d = startDate; d <= endDate; d = dayKeyAddDays(d, 1)) {
    const histRow = dailyMap.get(d) || null;
    let chosen = histRow;
    if (d === todayKey && liveTodayPeriod && liveTodayValid) {
      const liveRow = livePeriodToDailyRowLocal(liveTodayPeriod, d, histRow);
      if (!chosen || liveRow.tokens >= nonNegInt(chosen.tokens)) {
        chosen = liveRow;
      }
    }
    if (chosen) dayRows.push(chosen);
  }

  const projectRows = normGroupBy === 'project'
    ? buildProjectRowsForDateRange(aliasedStats, scopedDevices, dailySnapshots, startDate, endDate, resolvedTimeZone, aliasResolver.resolve)
    : [];

  const deviceRows = normGroupBy === 'device'
    ? buildDeviceRowsForDateRange(scopedDevices, resolvedHistory, startDate, endDate, todayKey, nowMs)
    : [];

  const available = Boolean(aliasedHistory || (liveTodayValid && liveTodayPeriod));
  const incomplete = Boolean(!aliasedHistory || (cleanDeviceId && !selectedDevice.history && mergedDevices.length > 1));

  return buildDailyRowsQueryResult({
    periodId: normPeriod,
    key: normPeriod,
    label: `${normPeriod} (${startDate}..${endDate})`,
    startDate,
    endDate,
    timeZone: resolvedTimeZone,
    deviceId: cleanDeviceId || null,
    available,
    incomplete,
    dayRows,
    groupBy: normGroupBy,
    limit: boundedLimit,
    resolveModel: aliasResolver.resolve,
    projectRows,
    deviceRows
  });
}

/**
 * @param {object} params
 * @param {string} params.periodId
 * @param {string} params.key
 * @param {string} params.label
 * @param {string} params.startDate
 * @param {string} params.endDate
 * @param {string} params.timeZone
 * @param {string | null} params.deviceId
 * @param {boolean} params.available
 * @param {boolean} params.incomplete
 * @param {any[]} params.dayRows
 * @param {'summary' | 'model' | 'client' | 'project' | 'device'} params.groupBy
 * @param {number} params.limit
 * @param {(model: string) => string} params.resolveModel
 * @param {any[]} params.projectRows
 * @param {any[]} params.deviceRows
 */
function buildDailyRowsQueryResult({
  periodId,
  key,
  label,
  startDate,
  endDate,
  timeZone,
  deviceId,
  available,
  incomplete,
  dayRows,
  groupBy,
  limit,
  resolveModel,
  projectRows,
  deviceRows
}) {
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
  let activeDays = 0;
  let timedOutputTokens = 0;
  let timedDurationMs = 0;
  /** @type {Map<string, { timedTokens: number, timedOutputTokens: number, timedDurationMs: number }>} */
  const modelThroughput = new Map();
  /** @type {Map<string, any>} */
  const clientMap = new Map();
  /** @type {Map<string, any>} */
  const modelMap = new Map();

  for (const row of dayRows) {
    const rTokens = nonNegInt(row.tokens);
    if (rTokens > 0) activeDays += 1;
    const exact = row.tokenComponentsAvailable === true;
    const comp = computeTokenComponents(row, rTokens, exact);
    totalTokens += rTokens;
    knownCostUsd += nonNegFloat(row.cost);
    unpricedTokens += boundedUnpriced(rTokens, row.unpricedTokens);
    inputTokens += comp.inputTokens;
    outputTokens += comp.outputTokens;
    cacheReadTokens += comp.cacheReadTokens;
    cacheWriteTokens += comp.cacheWriteTokens;
    unclassifiedTokens += comp.unclassifiedTokens;
    if (!comp.tokenComponentsComplete) tokenComponentsComplete = false;
    messageCount += nonNegInt(row.messages);
    activeTimeMs += nonNegInt(row.activeTimeMs);
    timedOutputTokens += nonNegInt(row.timedOutputTokens);
    timedDurationMs += nonNegInt(row.timedDurationMs);

    if (row.modelThroughput && typeof row.modelThroughput === 'object') {
      for (const [rawModel, tp] of Object.entries(row.modelThroughput)) {
        const m = resolveModel(normalizeModelName(rawModel) || cleanText(rawModel, MAX_MODEL_ID_LENGTH));
        if (!m || PROTOTYPE_KEYS.has(m)) continue;
        const prev = modelThroughput.get(m) || { timedTokens: 0, timedOutputTokens: 0, timedDurationMs: 0 };
        prev.timedTokens += nonNegInt(tp?.timedTokens);
        prev.timedOutputTokens += nonNegInt(tp?.timedOutputTokens);
        prev.timedDurationMs += nonNegInt(tp?.timedDurationMs);
        modelThroughput.set(m, prev);
      }
    }

    for (const [rawClient, val] of Object.entries(row.perClient || {})) {
      const client = normalizeClientName(rawClient) || cleanText(rawClient, 64).toLowerCase();
      if (!client || PROTOTYPE_KEYS.has(client)) continue;
      const cTokens = nonNegInt(val?.tokens);
      const cComp = computeTokenComponents(val, cTokens, exact);
      let acc = clientMap.get(client);
      if (!acc) {
        acc = {
          client,
          totalTokens: 0,
          knownCostUsd: 0,
          unpricedTokens: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          unclassifiedTokens: 0,
          messageCount: 0
        };
        clientMap.set(client, acc);
      }
      acc.totalTokens += cTokens;
      acc.knownCostUsd += nonNegFloat(val?.cost);
      acc.unpricedTokens += boundedUnpriced(cTokens, val?.unpricedTokens);
      acc.inputTokens += cComp.inputTokens;
      acc.outputTokens += cComp.outputTokens;
      acc.cacheReadTokens += cComp.cacheReadTokens;
      acc.cacheWriteTokens += cComp.cacheWriteTokens;
      acc.unclassifiedTokens += cComp.unclassifiedTokens;
      acc.messageCount += nonNegInt(val?.messages);
    }

    for (const [rawModel, val] of Object.entries(row.perModel || {})) {
      const base = normalizeModelName(rawModel) || cleanText(rawModel, MAX_MODEL_ID_LENGTH);
      const model = base ? resolveModel(base) : '';
      if (!model || PROTOTYPE_KEYS.has(model)) continue;
      const mTokens = nonNegInt(val?.tokens);
      const mComp = computeTokenComponents(val, mTokens, exact);
      let acc = modelMap.get(model);
      if (!acc) {
        acc = {
          model,
          totalTokens: 0,
          knownCostUsd: 0,
          unpricedTokens: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          unclassifiedTokens: 0
        };
        modelMap.set(model, acc);
      }
      acc.totalTokens += mTokens;
      acc.knownCostUsd += nonNegFloat(val?.cost);
      acc.unpricedTokens += boundedUnpriced(mTokens, val?.unpricedTokens);
      acc.inputTokens += mComp.inputTokens;
      acc.outputTokens += mComp.outputTokens;
      acc.cacheReadTokens += mComp.cacheReadTokens;
      acc.cacheWriteTokens += mComp.cacheWriteTokens;
      acc.unclassifiedTokens += mComp.unclassifiedTokens;
    }
  }

  knownCostUsd = round6(knownCostUsd);
  const totals = {
    totalTokens,
    knownCostUsd,
    unpricedTokens,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    unclassifiedTokens,
    cacheHitRatePct: computeCacheHitRatePct(cacheReadTokens, inputTokens, cacheWriteTokens),
    avgOutputTokensPerSec: computeAvgOutputTokensPerSec(timedOutputTokens, timedDurationMs),
    messageCount,
    sessionCount: 0,
    activeDays,
    activeTimeMs,
    tokenComponentsComplete
  };

  /** @type {any[]} */
  let allRows = [];
  if (groupBy === 'model') {
    allRows = Array.from(modelMap.values())
      .filter((entry) => entry.totalTokens > 0 || entry.knownCostUsd > 0)
      .map((entry) => {
        const tp = modelThroughput.get(entry.model);
        return {
          model: entry.model,
          totalTokens: entry.totalTokens,
          knownCostUsd: round6(entry.knownCostUsd),
          unpricedTokens: entry.unpricedTokens,
          inputTokens: entry.inputTokens,
          outputTokens: entry.outputTokens,
          cacheReadTokens: entry.cacheReadTokens,
          cacheWriteTokens: entry.cacheWriteTokens,
          unclassifiedTokens: entry.unclassifiedTokens,
          cacheHitRatePct: computeCacheHitRatePct(entry.cacheReadTokens, entry.inputTokens, entry.cacheWriteTokens),
          avgOutputTokensPerSec: tp ? computeAvgOutputTokensPerSec(tp.timedOutputTokens, tp.timedDurationMs) : 0,
          tokenSharePct: pct(entry.totalTokens, totalTokens),
          costSharePct: pct(entry.knownCostUsd, knownCostUsd)
        };
      })
      .sort((a, b) => b.totalTokens - a.totalTokens || b.knownCostUsd - a.knownCostUsd || a.model.localeCompare(b.model));
  } else if (groupBy === 'client') {
    allRows = Array.from(clientMap.values())
      .filter((entry) => entry.totalTokens > 0 || entry.knownCostUsd > 0)
      .map((entry) => ({
        client: entry.client,
        totalTokens: entry.totalTokens,
        knownCostUsd: round6(entry.knownCostUsd),
        unpricedTokens: entry.unpricedTokens,
        inputTokens: entry.inputTokens,
        outputTokens: entry.outputTokens,
        cacheReadTokens: entry.cacheReadTokens,
        cacheWriteTokens: entry.cacheWriteTokens,
        unclassifiedTokens: entry.unclassifiedTokens,
        cacheHitRatePct: computeCacheHitRatePct(entry.cacheReadTokens, entry.inputTokens, entry.cacheWriteTokens),
        messageCount: entry.messageCount,
        tokenSharePct: pct(entry.totalTokens, totalTokens),
        costSharePct: pct(entry.knownCostUsd, knownCostUsd)
      }))
      .sort((a, b) => b.totalTokens - a.totalTokens || b.knownCostUsd - a.knownCostUsd || a.client.localeCompare(b.client));
  } else if (groupBy === 'project') {
    allRows = projectRows.map((p) => ({
      ...p,
      tokenSharePct: pct(p.totalTokens, totalTokens),
      costSharePct: pct(p.knownCostUsd, knownCostUsd)
    }));
  } else if (groupBy === 'device') {
    allRows = deviceRows.map((d) => ({
      ...d,
      tokenSharePct: pct(d.totalTokens, totalTokens),
      costSharePct: pct(d.knownCostUsd, knownCostUsd)
    }));
  }

  return {
    period: {
      id: periodId,
      key,
      label,
      startDate,
      endDate,
      timeZone,
      deviceId,
      deviceFound: true,
      available,
      incomplete
    },
    groupBy,
    totals,
    totalRows: allRows.length,
    truncated: allRows.length > limit,
    rows: allRows.slice(0, limit)
  };
}

/**
 * @param {any} stats
 * @param {any[]} devices
 * @param {any} dailySnapshots
 * @param {string} startDate
 * @param {string} endDate
 * @param {string} timeZone
 * @param {(model: string) => string} resolveModel
 * @returns {any[]}
 */
function buildProjectRowsForDateRange(stats, devices, dailySnapshots, startDate, endDate, timeZone, resolveModel) {
  /** @type {Map<string, any>} */
  const projectMap = new Map();
  /** @type {Map<string, Set<string>>} */
  const sessionKeys = new Map();
  /** @type {Set<string>} */
  const snapshotDates = new Set();

  for (let d = startDate; d <= endDate; d = dayKeyAddDays(d, 1)) {
    const snap = dailySnapshots instanceof Map ? dailySnapshots.get(d) : dailySnapshots?.[d];
    if (!snap?.projects || typeof snap.projects !== 'object') continue;
    snapshotDates.add(d);
    for (const [rawKey, src] of Object.entries(snap.projects)) {
      if (!src || typeof src !== 'object') continue;
      const rawLabel = String(src.label || rawKey || '').trim().normalize('NFC');
      const key = canonicalProjectKey(rawLabel || rawKey);
      if (!key || PROTOTYPE_KEYS.has(key)) continue;
      let acc = projectMap.get(key);
      if (!acc) {
        acc = {
          key,
          label: rawLabel || key,
          totalTokens: 0,
          knownCostUsd: 0,
          unpricedTokens: 0,
          sessionCount: 0,
          clients: new Map(),
          models: new Map()
        };
        projectMap.set(key, acc);
      } else {
        acc.label = deterministicProjectLabel(acc.label, rawLabel || key);
      }
      const pTok = nonNegInt(src.tokens ?? src.totalTokens);
      acc.totalTokens += pTok;
      acc.knownCostUsd += nonNegFloat(src.costUsd ?? src.cost);
      acc.unpricedTokens += boundedUnpriced(pTok, src.unpricedTokens);
      if (Number.isFinite(Number(src.sessionCount))) acc.sessionCount += nonNegInt(src.sessionCount);
      for (const [rawC, val] of Object.entries(src.clients || {})) {
        const c = normalizeClientName(rawC);
        const cTok = nonNegInt(val);
        if (c && cTok > 0) acc.clients.set(c, (acc.clients.get(c) || 0) + cTok);
      }
      for (const [rawM, val] of Object.entries(src.models || {})) {
        const baseM = normalizeModelName(rawM) || cleanText(rawM, MAX_MODEL_ID_LENGTH);
        const m = baseM ? resolveModel(baseM) : '';
        const mTok = nonNegInt(val);
        if (m && mTok > 0) acc.models.set(m, (acc.models.get(m) || 0) + mTok);
      }
    }
  }

  // Fallback to sessions on missing dates
  /** @type {Map<string, any>} */
  const candidates = new Map();
  /** @param {any} map */
  const collect = (map) => {
    if (!map || typeof map !== 'object') return;
    for (const [k, s] of Object.entries(map)) {
      if (!s || typeof s !== 'object' || isReasonixSyntheticSession(s, k)) continue;
      const normKey = s.client && s.sessionId ? `${normalizeClientName(s.client) || s.client}:${s.sessionId}` : k;
      if (!candidates.has(normKey)) candidates.set(normKey, s);
    }
  };
  collect(stats?.periods?.month?.sessions);
  collect(stats?.periods?.today?.sessions);
  for (const device of devices) {
    collect(device?.periods?.month?.sessions);
    collect(device?.periods?.today?.sessions);
  }

  for (const [sKey, s] of candidates.entries()) {
    const sDay = dayKeyInTimeZone(String(s.lastUsedAt || '').trim(), timeZone);
    if (!sDay || sDay < startDate || sDay > endDate || snapshotDates.has(sDay)) continue;
    const label = String(s.projectLabel || '').trim().normalize('NFC');
    const key = canonicalProjectKey(label);
    if (!key || PROTOTYPE_KEYS.has(key)) continue;
    let acc = projectMap.get(key);
    if (!acc) {
      acc = {
        key,
        label,
        totalTokens: 0,
        knownCostUsd: 0,
        unpricedTokens: 0,
        sessionCount: 0,
        clients: new Map(),
        models: new Map()
      };
      projectMap.set(key, acc);
    } else {
      acc.label = deterministicProjectLabel(acc.label, label);
    }
    const sTok = nonNegInt(s.totalTokens);
    acc.totalTokens += sTok;
    acc.knownCostUsd += nonNegFloat(s.costUsd);
    acc.unpricedTokens += boundedUnpriced(sTok, s.unpricedTokens);
    let set = sessionKeys.get(key);
    if (!set) {
      set = new Set();
      sessionKeys.set(key, set);
    }
    set.add(sKey);
    const c = normalizeClientName(s.client);
    if (c && sTok > 0) acc.clients.set(c, (acc.clients.get(c) || 0) + sTok);
    for (const [rawM, val] of Object.entries(s.models || {})) {
      const baseM = normalizeModelNameForClient(rawM, c || '') || cleanText(rawM, MAX_MODEL_ID_LENGTH);
      const m = baseM ? resolveModel(baseM) : '';
      const mTok = nonNegInt(val);
      if (m && mTok > 0) acc.models.set(m, (acc.models.get(m) || 0) + mTok);
    }
  }

  return Array.from(projectMap.values())
    .map((acc) => ({
      key: acc.key,
      label: acc.label,
      totalTokens: acc.totalTokens,
      knownCostUsd: round6(acc.knownCostUsd),
      unpricedTokens: acc.unpricedTokens,
      sessionCount: Math.max(sessionKeys.get(acc.key)?.size || 0, acc.sessionCount),
      clients: Array.from(acc.clients.entries())
        .map(([client, tokens]) => ({ client, tokens, sharePct: pct(tokens, acc.totalTokens) }))
        .sort((a, b) => b.tokens - a.tokens || a.client.localeCompare(b.client)),
      models: Array.from(acc.models.entries())
        .map(([model, tokens]) => ({ model, tokens, sharePct: pct(tokens, acc.totalTokens) }))
        .sort((a, b) => b.tokens - a.tokens || a.model.localeCompare(b.model))
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens || b.knownCostUsd - a.knownCostUsd || a.key.localeCompare(b.key));
}

/**
 * @param {any[]} devices
 * @param {any} history
 * @param {string} startDate
 * @param {string} endDate
 * @param {string} todayKey
 * @param {number} nowMs
 * @returns {any[]}
 */
function buildDeviceRowsForDateRange(devices, history, startDate, endDate, todayKey, nowMs) {
  return devices
    .map((device) => {
      const devHistory = device.history || findDeviceHistory(history, device.deviceId) || device.historyPreview || null;
      const dailyMap = indexHistoryDailyRows(devHistory);
      const liveToday = device?.periods?.today || device?.today || null;
      const liveValid = doesDeviceTodayMatchDate(device, nowMs, todayKey);
      let dTokens = 0;
      let dCost = 0;
      for (let d = startDate; d <= endDate; d = dayKeyAddDays(d, 1)) {
        const histRow = dailyMap.get(d);
        if (d === todayKey && liveValid && liveToday && (!histRow || nonNegInt(liveToday.totalTokens) >= nonNegInt(histRow.tokens))) {
          dTokens += nonNegInt(liveToday.totalTokens);
          dCost += nonNegFloat(liveToday.costUsd);
        } else if (histRow) {
          dTokens += nonNegInt(histRow.tokens);
          dCost += nonNegFloat(histRow.cost);
        }
      }
      return {
        deviceId: device.deviceId,
        hostname: cleanText(device.hostname, 256),
        osName: cleanText(device.osName, 64) || null,
        osVersion: cleanText(device.osVersion, 128) || null,
        platform: cleanText(device.platform, 64) || null,
        stale: device.stale === true,
        totalTokens: dTokens,
        knownCostUsd: round6(dCost),
        projectCount: 0
      };
    })
    .sort((a, b) => b.totalTokens - a.totalTokens || b.knownCostUsd - a.knownCostUsd || a.deviceId.localeCompare(b.deviceId));
}

/**
 * @param {any[]} rows
 * @param {'client' | 'model'} groupBy
 * @param {number} totalTokens
 * @param {number} knownCostUsd
 * @param {(model: string) => string} resolveModel
 * @returns {any[]}
 */
function aggregateHistoryBreakdown(rows, groupBy, totalTokens, knownCostUsd, resolveModel) {
  /** @type {Map<string, any>} */
  const map = new Map();
  const sourceField = groupBy === 'client' ? 'perClient' : 'perModel';
  for (const row of rows) {
    const exact = row?.tokenComponentsAvailable === true;
    for (const [rawKey, bucket] of Object.entries(row?.[sourceField] || {})) {
      const key = groupBy === 'client'
        ? (normalizeClientName(rawKey) || cleanText(rawKey, 64).toLowerCase())
        : resolveModel(normalizeModelName(rawKey) || cleanText(rawKey, MAX_MODEL_ID_LENGTH));
      if (!key || PROTOTYPE_KEYS.has(key)) continue;
      const bTokens = nonNegInt(bucket?.tokens);
      const bCost = nonNegFloat(bucket?.cost);
      const bUnpriced = boundedUnpriced(bTokens, bucket?.unpricedTokens);
      const comp = computeTokenComponents(bucket, bTokens, exact);
      let acc = map.get(key);
      if (!acc) {
        acc = {
          [groupBy]: key,
          totalTokens: 0,
          knownCostUsd: 0,
          unpricedTokens: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          unclassifiedTokens: 0,
          ...(groupBy === 'client' ? { messageCount: 0 } : {})
        };
        map.set(key, acc);
      }
      acc.totalTokens += bTokens;
      acc.knownCostUsd += bCost;
      acc.unpricedTokens += bUnpriced;
      acc.inputTokens += comp.inputTokens;
      acc.outputTokens += comp.outputTokens;
      acc.cacheReadTokens += comp.cacheReadTokens;
      acc.cacheWriteTokens += comp.cacheWriteTokens;
      acc.unclassifiedTokens += comp.unclassifiedTokens;
      if (groupBy === 'client') acc.messageCount += nonNegInt(bucket?.messages);
    }
  }
  return Array.from(map.values())
    .filter((entry) => entry.totalTokens > 0 || entry.knownCostUsd > 0)
    .map((entry) => ({
      ...entry,
      knownCostUsd: round6(entry.knownCostUsd),
      cacheHitRatePct: computeCacheHitRatePct(entry.cacheReadTokens, entry.inputTokens, entry.cacheWriteTokens),
      tokenSharePct: pct(entry.totalTokens, totalTokens),
      costSharePct: pct(entry.knownCostUsd, knownCostUsd)
    }))
    .sort((a, b) => (
      b.totalTokens - a.totalTokens
      || b.knownCostUsd - a.knownCostUsd
      || String(a[groupBy]).localeCompare(String(b[groupBy]))
    ));
}

// ---------------------------------------------------------------------------
// 2. listSessionsQuery
// ---------------------------------------------------------------------------

/**
 * @param {number} offset
 * @returns {string}
 */
function encodeCursor(offset) {
  const json = JSON.stringify({ o: offset });
  return btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

/**
 * @param {any} cursor
 * @returns {number}
 */
function decodeCursor(cursor) {
  if (cursor === null || cursor === undefined || cursor === '') return 0;
  if (typeof cursor === 'number') {
    if (!Number.isInteger(cursor) || cursor < 0) throw new Error('Invalid pagination cursor');
    return cursor;
  }
  const raw = String(cursor).trim();
  if (!raw) return 0;
  if (/^\d+$/.test(raw)) {
    const numOffset = Number(raw);
    if (!Number.isSafeInteger(numOffset) || numOffset < 0) throw new Error('Invalid pagination cursor');
    return numOffset;
  }
  try {
    const base64 = raw.replace(/-/g, '+').replace(/_/g, '/');
    const padLen = (4 - (base64.length % 4)) % 4;
    const normalized = padLen ? `${base64}${'='.repeat(padLen)}` : base64;
    const decoded = atob(normalized);
    const parsed = JSON.parse(decoded);
    const offset = parsed?.o ?? parsed?.offset;
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid cursor offset');
    return offset;
  } catch {
    throw new Error('Invalid pagination cursor');
  }
}

/**
 * Attach liveActivity from periodObj onto rawSession using explicit nowMs
 * so historical snapshots and deterministic test clocks evaluate accurately.
 *
 * @param {any} periodObj
 * @param {string} key
 * @param {any} rawSession
 * @param {number} nowMs
 * @returns {any}
 */
function attachSessionLiveActivity(periodObj, key, rawSession, nowMs) {
  if (!rawSession || typeof rawSession !== 'object' || isArchivedSession(rawSession)) return rawSession;
  const observation = normalizeLiveActivity(periodObj?.sessionActivity?.[key]);
  if (!observation || !isSessionActivityClient(rawSession.client)
    || !canReplaceLiveActivity(rawSession.liveActivity, observation, nowMs)) {
    return rawSession;
  }
  return { ...rawSession, liveActivity: observation };
}

/**
 * @param {any} arr
 * @returns {string[]}
 */
function normalizeClientIdList(arr) {
  if (!Array.isArray(arr)) return [];
  /** @type {Set<string>} */
  const out = new Set();
  for (const item of arr) {
    const id = normalizeClientName(item);
    if (id) out.add(id);
  }
  return Array.from(out);
}

/**
 * Aggregate token, cost, unpriced, activeTime, and message totals across history buckets.
 *
 * @param {any[]} rows
 * @param {boolean} isMonthly
 * @returns {{ totalTokens: number, knownCostUsd: number, unpricedTokens: number, messages: number, activeTimeMs: number }}
 */
function sumHistoryBuckets(rows, isMonthly) {
  let totalTokens = 0;
  let knownCostRaw = 0;
  let unpricedRaw = 0;
  let messages = 0;
  let activeTimeMs = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    totalTokens += nonNegInt(row?.tokens);
    knownCostRaw += nonNegFloat(row?.cost);
    unpricedRaw += nonNegInt(row?.unpricedTokens);
    activeTimeMs += nonNegInt(row?.activeTimeMs);
    if (isMonthly) {
      for (const clientTotals of Object.values(row?.perClient || {})) {
        messages += nonNegInt(/** @type {any} */ (clientTotals)?.messages);
      }
    } else {
      messages += nonNegInt(row?.messages);
    }
  }
  return {
    totalTokens,
    knownCostUsd: round6(knownCostRaw),
    unpricedTokens: boundedUnpriced(totalTokens, unpricedRaw),
    messages,
    activeTimeMs
  };
}

/**
 * @param {any} value
 * @returns {string | null}
 */
function normalizeIsoOrNull(value) {
  if (!value) return null;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
}

/**
 * @param {any} value
 * @returns {string | null}
 */
function sanitizeSessionTitleText(value) {
  if (typeof value !== 'string') return null;
  const cleaned = Array.from(value.replace(/\s+/g, ' ').trim())
    .slice(0, MAX_SESSION_TITLE_LENGTH)
    .join('');
  return cleaned || null;
}

/**
 * List and filter sessions with live activity, context window, prompt cache,
 * sorting, pagination, and strict sessionTitlesEnabled privacy gating.
 *
 * @param {{
 *   stats?: any,
 *   allTimeSessions?: Record<string, any> | { sessions?: Record<string, any> } | null,
 *   period?: string,
 *   state?: string,
 *   client?: string,
 *   project?: string,
 *   deviceId?: string,
 *   search?: string,
 *   sort?: string | { field?: string, direction?: string },
 *   sortDirection?: string,
 *   limit?: number,
 *   cursor?: string | number | null,
 *   sessionTitlesEnabled?: boolean,
 *   now?: Date | number | string
 * }} [params]
 */
function listSessionsQuery({
  stats = null,
  allTimeSessions = null,
  period = 'today',
  state = 'all',
  client = '',
  project = '',
  deviceId = '',
  search = '',
  sort = 'lastUsedAt',
  sortDirection = 'desc',
  limit = DEFAULT_LIMIT,
  cursor = null,
  sessionTitlesEnabled = true,
  now
} = {}) {
  const rawPeriod = period === undefined || period === null || String(period).trim() === ''
    ? 'today'
    : String(period).trim();
  const normPeriod = rawPeriod.toLowerCase() === 'alltime' ? 'allTime' : rawPeriod.toLowerCase();
  if (!SESSION_PERIODS.includes(normPeriod)) {
    throw new Error(`Invalid session period "${rawPeriod}". Expected one of: ${SESSION_PERIODS.join(', ')}`);
  }

  const normState = state === undefined || state === null || String(state).trim() === ''
    ? 'all'
    : String(state).trim().toLowerCase();
  if (!SESSION_STATES.includes(normState)) {
    throw new Error(`Invalid session state "${String(state)}". Expected one of: ${SESSION_STATES.join(', ')}`);
  }

  /** @type {Record<string, any> | null} */
  const sortObj = isPlainObject(sort) ? /** @type {any} */ (sort) : null;
  const sortFieldRaw = sortObj ? String(sortObj.field || 'lastUsedAt').trim() : String(sort || 'lastUsedAt').trim();
  const normSort = SESSION_SORTS.find((item) => item.toLowerCase() === sortFieldRaw.toLowerCase()) || '';
  if (!normSort) {
    throw new Error(`Invalid session sort "${sortFieldRaw}". Expected one of: ${SESSION_SORTS.join(', ')}`);
  }
  const rawDir = sortObj && sortObj.direction ? String(sortObj.direction).trim().toLowerCase() : String(sortDirection || 'desc').trim().toLowerCase();
  const normDir = rawDir === 'asc' ? 'asc' : 'desc';

  const boundedLimit = clampLimit(limit, DEFAULT_LIMIT, MAX_LIMIT);
  const offset = decodeCursor(cursor);
  const titlesAllowed = sessionTitlesEnabled !== false;
  const nowDate = resolveNowDate(now);
  const nowMs = nowDate.getTime();

  const cleanDeviceId = cleanText(deviceId, 128);
  const targetClient = client ? (normalizeClientName(client) || cleanText(client, 64).toLowerCase()) : '';
  const rawProjectFilter = cleanText(project, 256);
  const targetProjectKey = rawProjectFilter ? canonicalProjectKey(rawProjectFilter) : '';
  const searchTerms = cleanText(search, 256).toLowerCase().split(/\s+/).filter(Boolean);

  const devices = Array.isArray(stats?.devices) ? stats.devices : [];
  const selectedDevice = cleanDeviceId
    ? devices.find((/** @type {any} */ d) => (d?.deviceId || d?.id) === cleanDeviceId) || null
    : null;

  if (cleanDeviceId && !selectedDevice) {
    return {
      period: normPeriod,
      state: normState,
      sort: { field: normSort, direction: normDir },
      sessionTitlesEnabled: titlesAllowed,
      total: 0,
      limit: boundedLimit,
      offset,
      hasMore: false,
      nextCursor: null,
      deviceId: cleanDeviceId,
      deviceFound: false,
      sessions: []
    };
  }

  /** @type {Record<string, any> | null} */
  const allTimeInput = isPlainObject(allTimeSessions) ? /** @type {any} */ (allTimeSessions) : null;
  /** @type {Record<string, any> | null} */
  const rawAllTimeMap = allTimeInput
    ? (isPlainObject(allTimeInput.sessions) ? allTimeInput.sessions : allTimeInput)
    : null;

  /** @type {any} */
  let periodObj;
  /** @type {Record<string, any>} */
  let sessionsSource;
  if (cleanDeviceId) {
    periodObj = selectedDevice.periods?.[normPeriod] || selectedDevice[normPeriod] || null;
    if (normPeriod === 'allTime') {
      const deviceSessions = periodObj?.sessions || {};
      /** @type {Record<string, any>} */
      const extraFiltered = {};
      if (rawAllTimeMap) {
        for (const [k, s] of Object.entries(rawAllTimeMap)) {
          if (!s || typeof s !== 'object') continue;
          const srcDev = cleanText(s.sourceDevice || s.deviceId, 128);
          if (srcDev ? srcDev === cleanDeviceId : devices.length === 1) {
            extraFiltered[k] = s;
          }
        }
      }
      sessionsSource = { ...deviceSessions, ...extraFiltered };
    } else {
      sessionsSource = periodObj?.sessions || {};
    }
  } else {
    periodObj = stats?.periods?.[normPeriod] || stats?.[normPeriod] || null;
    if (normPeriod === 'allTime') {
      sessionsSource = {
        ...(periodObj?.sessions || {}),
        ...(rawAllTimeMap || {})
      };
    } else {
      sessionsSource = periodObj?.sessions || {};
    }
  }

  /** @type {any[]} */
  const matched = [];
  for (const [key, rawSession] of Object.entries(sessionsSource)) {
    if (!rawSession || typeof rawSession !== 'object' || Array.isArray(rawSession)) continue;
    if (isReasonixSyntheticSession(rawSession, key)) continue;

    const session = attachSessionLiveActivity(periodObj, key, rawSession, nowMs);
    const normClient = normalizeClientName(session.client) || cleanText(session.client, 64).toLowerCase();
    if (!normClient) continue;

    if (targetClient && normClient !== targetClient) continue;

    const rawProjLabel = cleanText(session.projectLabel, 256);
    const projKey = rawProjLabel ? canonicalProjectKey(rawProjLabel) : '';
    if (rawProjectFilter) {
      const matchesProject = (targetProjectKey && projKey === targetProjectKey)
        || (session.projectId && String(session.projectId) === rawProjectFilter)
        || (rawProjLabel && rawProjLabel.toLowerCase() === rawProjectFilter.toLowerCase());
      if (!matchesProject) continue;
    }

    const actState = sessionActivityState(session, nowMs);
    if (normState !== 'all' && actState !== normState) continue;

    // Strip all title text fields when sessionTitlesEnabled === false,
    // including excluding them from search matching so titles never leak.
    let title = null;
    if (titlesAllowed) {
      for (const field of ['title', 'sessionTitle', 'session_title', 'customTitle', 'custom_title', 'aiTitle', 'ai_title']) {
        const candidate = sanitizeSessionTitleText(session[field]);
        if (candidate) {
          title = candidate;
          break;
        }
      }
    }

    const sessionId = cleanText(session.sessionId || session.session_id || key, 256);
    const latestModel = typeof session.latestModel === 'string' && session.latestModel.trim()
      ? (normalizeModelNameForClient(session.latestModel, normClient) || cleanText(session.latestModel, MAX_MODEL_ID_LENGTH))
      : null;
    const reasoningEffort = isSessionReasoningEffortClient(normClient)
      ? normalizeReasoningEffort(session.reasoningEffort)
      : null;
    const parentSessionId = cleanText(session.parentSessionId ?? session.parent_session_id, 256) || null;
    const parentClient = parentSessionId
      ? (normalizeClientName(session.parentClient ?? session.parent_client)
        || cleanText(session.parentClient ?? session.parent_client, 64).toLowerCase()
        || normClient)
      : null;
    const sessionKind = cleanText(session.sessionKind ?? session.session_kind, 64) || null;

    /** @type {Record<string, number>} */
    const models = {};
    for (const [rawModel, tok] of Object.entries(session.models || {})) {
      const m = normalizeModelNameForClient(rawModel, normClient) || cleanText(rawModel, MAX_MODEL_ID_LENGTH);
      if (!m || PROTOTYPE_KEYS.has(m)) continue;
      const val = nonNegInt(tok);
      if (val > 0) models[m] = (models[m] || 0) + val;
    }

    if (searchTerms.length > 0) {
      const haystackParts = [
        normClient,
        sessionId,
        key,
        rawProjLabel,
        latestModel,
        reasoningEffort,
        sessionKind,
        ...Object.keys(models),
        ...(titlesAllowed ? [title] : [])
      ].filter(Boolean);
      const haystack = haystackParts.join('\n').toLowerCase();
      if (!searchTerms.every((term) => haystack.includes(term))) continue;
    }

    const totalTokens = nonNegInt(session.totalTokens ?? session.tokens);
    const costUsd = round6(nonNegFloat(session.costUsd ?? session.cost ?? session.totalCost));
    const unpricedTokens = boundedUnpriced(totalTokens, session.unpricedTokens);
    const inputTokens = nonNegInt(session.inputTokens);
    const outputTokens = nonNegInt(session.outputTokens);
    const cacheReadTokens = nonNegInt(session.cacheReadTokens);
    const cacheWriteTokens = nonNegInt(session.cacheWriteTokens);
    const messageCount = nonNegInt(session.messageCount);
    const hasCacheData = cacheReadTokens > 0 || cacheWriteTokens > 0 || session.cacheReported === true;
    const measuredInput = inputTokens + cacheReadTokens + cacheWriteTokens;
    const cacheHitRatePct = hasCacheData && measuredInput > 0
      ? round2((cacheReadTokens / measuredInput) * 100)
      : null;
    const timedDurationMs = nonNegInt(session.timedDurationMs);
    const rawTimedOut = nonNegInt(session.timedOutputTokens);
    const timedOutputTokens = hasOwn(session, 'outputTokens') ? Math.min(outputTokens, rawTimedOut) : rawTimedOut;
    const avgOutputTokensPerSec = computeAvgOutputTokensPerSec(timedOutputTokens, timedDurationMs);

    const rawContext = sessionContextWindow(session);
    const context = rawContext ? { ...rawContext, tone: contextTone(rawContext.percentLeft) } : null;
    const promptCache = sessionPromptCacheForRow(session, nowMs);

    const startedAt = normalizeIsoOrNull(session.startedAt ?? session.started_at ?? session.createdAt);
    const lastUsedAt = normalizeIsoOrNull(session.lastUsedAt ?? session.last_used_at ?? session.updatedAt);
    const sortTimeMs = Date.parse(lastUsedAt || startedAt || '') || 0;

    /** @type {any} */
    const projected = {
      key,
      sessionId,
      client: normClient,
      title: titlesAllowed ? title : null,
      projectKey: projKey || null,
      projectLabel: rawProjLabel || null,
      deviceId: cleanText(session.sourceDevice || session.deviceId || cleanDeviceId, 128) || null,
      activityState: actState,
      archived: isArchivedSession(session),
      startedAt,
      lastUsedAt,
      totalTokens,
      costUsd,
      unpricedTokens,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      cacheHitRatePct,
      messageCount,
      avgOutputTokensPerSec,
      latestModel,
      models,
      reasoningEffort,
      context,
      promptCache,
      parentSessionId,
      parentClient,
      sessionKind,
      turnEnded: typeof session.turnEnded === 'boolean' ? session.turnEnded : null,
      waitingForInput: normClient === 'codex' && typeof session.waitingForInput === 'boolean' ? session.waitingForInput : null,
      _sortTimeMs: sortTimeMs
    };

    // Defensive safeguard: ensure no extra title-text fields ever exist when disabled
    if (!titlesAllowed) {
      for (const field of SESSION_TEXT_FIELDS) {
        if (field === 'title') projected.title = null;
        else delete projected[field];
      }
    }

    matched.push(projected);
  }

  matched.sort((a, b) => {
    /** @type {number} */
    let diff;
    if (normSort === 'totalTokens') diff = a.totalTokens - b.totalTokens;
    else if (normSort === 'costUsd') diff = a.costUsd - b.costUsd;
    else diff = a._sortTimeMs - b._sortTimeMs;
    if (diff !== 0) return normDir === 'asc' ? diff : -diff;
    if (b._sortTimeMs !== a._sortTimeMs) return b._sortTimeMs - a._sortTimeMs;
    if (b.totalTokens !== a.totalTokens) return b.totalTokens - a.totalTokens;
    return a.key.localeCompare(b.key);
  });

  const total = matched.length;
  const page = matched.slice(offset, offset + boundedLimit).map(({ _sortTimeMs: _ignored, ...row }) => row);
  const hasMore = offset + page.length < total;
  const nextCursor = hasMore ? encodeCursor(offset + page.length) : null;

  return {
    period: normPeriod,
    state: normState,
    sort: { field: normSort, direction: normDir },
    sessionTitlesEnabled: titlesAllowed,
    total,
    limit: boundedLimit,
    offset,
    hasMore,
    nextCursor,
    deviceId: cleanDeviceId || null,
    deviceFound: true,
    sessions: page
  };
}

// ---------------------------------------------------------------------------
// 3. queryUsageHistory
// ---------------------------------------------------------------------------

/**
 * @param {any} value
 * @param {'start' | 'end'} boundKind
 * @returns {string}
 */
function parseHistoryDateBound(value, boundKind) {
  if (value === null || value === undefined || String(value).trim() === '') return '';
  const raw = String(value).trim();
  const exactDay = validateDateKey(raw);
  if (exactDay) return exactDay;
  const exactMonth = validateMonthKey(raw);
  if (exactMonth) {
    if (boundKind === 'start') return `${exactMonth}-01`;
    const year = Number(exactMonth.slice(0, 4));
    const month = Number(exactMonth.slice(5, 7));
    return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  }
  throw new Error(`Invalid history date bound "${raw}". Expected YYYY-MM-DD or YYYY-MM`);
}

/**
 * @param {any[]} dailyRows
 * @returns {{ date: string, totalTokens: number, knownCostUsd: number } | null}
 */
function findPeakDay(dailyRows) {
  /** @type {{ date: string, totalTokens: number, knownCostUsd: number } | null} */
  let peak = null;
  for (const row of dailyRows) {
    const date = validateDateKey(String(row?.date || '').slice(0, 10));
    if (!date) continue;
    const totalTokens = nonNegInt(row?.tokens ?? row?.totalTokens);
    const knownCostUsd = round6(nonNegFloat(row?.cost ?? row?.knownCostUsd));
    if (totalTokens <= 0 && knownCostUsd <= 0) continue;
    if (!peak || totalTokens > peak.totalTokens || (totalTokens === peak.totalTokens && knownCostUsd > peak.knownCostUsd)) {
      peak = { date, totalTokens, knownCostUsd };
    }
  }
  return peak;
}

/**
 * @param {any[]} rows
 * @returns {string | null}
 */
function topFavoriteModel(rows) {
  /** @type {Map<string, number>} */
  const totals = new Map();
  for (const row of rows) {
    for (const [model, val] of Object.entries(row?.perModel || {})) {
      const m = normalizeModelName(model) || cleanText(model, MAX_MODEL_ID_LENGTH);
      if (!m || PROTOTYPE_KEYS.has(m)) continue;
      totals.set(m, (totals.get(m) || 0) + nonNegInt(val?.tokens));
    }
  }
  let best = null;
  let bestTokens = 0;
  for (const [model, tok] of totals.entries()) {
    if (tok > bestTokens || (tok === bestTokens && best !== null && model < best)) {
      best = model;
      bestTokens = tok;
    }
  }
  return best;
}

/**
 * @param {any} row
 * @param {'none' | 'client' | 'model'} groupBy
 * @returns {any}
 */
function formatHistoryDailyRow(row, groupBy) {
  const tokens = nonNegInt(row?.tokens);
  const exact = row?.tokenComponentsAvailable === true;
  const comp = computeTokenComponents(row, tokens, exact);
  /** @type {any} */
  const out = {
    date: String(row?.date || '').slice(0, 10),
    totalTokens: tokens,
    knownCostUsd: round6(nonNegFloat(row?.cost)),
    unpricedTokens: boundedUnpriced(tokens, row?.unpricedTokens),
    inputTokens: comp.inputTokens,
    outputTokens: comp.outputTokens,
    cacheReadTokens: comp.cacheReadTokens,
    cacheWriteTokens: comp.cacheWriteTokens,
    unclassifiedTokens: comp.unclassifiedTokens,
    messages: nonNegInt(row?.messages),
    activeTimeMs: nonNegInt(row?.activeTimeMs),
    ...(row?.intensity !== undefined ? { intensity: nonNegInt(row.intensity) } : {}),
    ...(row?.tokenIntensity !== undefined ? { tokenIntensity: nonNegInt(row.tokenIntensity) } : {}),
    ...(row?.costIntensity !== undefined ? { costIntensity: nonNegInt(row.costIntensity) } : {})
  };
  if (groupBy === 'client') out.perClient = row?.perClient || {};
  if (groupBy === 'model') out.perModel = row?.perModel || {};
  return out;
}

/**
 * @param {any} row
 * @param {'none' | 'client' | 'model'} groupBy
 * @returns {any}
 */
function formatHistoryMonthlyRow(row, groupBy) {
  const tokens = nonNegInt(row?.tokens);
  const messages = Object.values(row?.perClient || {}).reduce((sum, c) => sum + nonNegInt(c?.messages), 0);
  /** @type {any} */
  const out = {
    month: String(row?.month || '').slice(0, 7),
    totalTokens: tokens,
    knownCostUsd: round6(nonNegFloat(row?.cost)),
    unpricedTokens: boundedUnpriced(tokens, row?.unpricedTokens),
    messages,
    activeTimeMs: nonNegInt(row?.activeTimeMs)
  };
  if (groupBy === 'client') out.perClient = row?.perClient || {};
  if (groupBy === 'model') out.perModel = row?.perModel || {};
  return out;
}

/**
 * Query daily, monthly, or summary history with date range filtering,
 * activeDays, streaks, peakDay, and perClient/perModel breakdown.
 *
 * @param {{
 *   history?: any,
 *   resolution?: string,
 *   from?: string | null,
 *   to?: string | null,
 *   groupBy?: string,
 *   limit?: number,
 *   now?: Date | number | string,
 *   todayKey?: string
 * }} [params]
 */
function queryUsageHistory({
  history = null,
  resolution = 'daily',
  from = null,
  to = null,
  groupBy = 'none',
  limit = DEFAULT_LIMIT,
  now,
  todayKey: explicitTodayKey
} = {}) {
  const normResolution = resolution === undefined || resolution === null || String(resolution).trim() === ''
    ? 'daily'
    : String(resolution).trim().toLowerCase();
  if (!HISTORY_RESOLUTIONS.includes(normResolution)) {
    throw new Error(`Invalid history resolution "${String(resolution)}". Expected one of: ${HISTORY_RESOLUTIONS.join(', ')}`);
  }

  const rawGroup = groupBy === undefined || groupBy === null || String(groupBy).trim() === ''
    ? 'none'
    : String(groupBy).trim().toLowerCase();
  if (!HISTORY_GROUPS.includes(rawGroup)) {
    throw new Error(`Invalid history groupBy "${String(groupBy)}". Expected one of: ${HISTORY_GROUPS.join(', ')}`);
  }
  const normGroupBy = /** @type {'none' | 'client' | 'model'} */ (rawGroup);

  const fromDate = parseHistoryDateBound(from, 'start');
  const toDate = parseHistoryDateBound(to, 'end');
  if (fromDate && toDate && fromDate > toDate) {
    throw new Error(`Invalid date range: from (${fromDate}) is after to (${toDate})`);
  }
  const fromMonth = fromDate ? fromDate.slice(0, 7) : '';
  const toMonth = toDate ? toDate.slice(0, 7) : '';
  const boundedLimit = clampLimit(limit, DEFAULT_LIMIT, MAX_LIMIT);

  const hasExplicitToday = Boolean(validateDateKey(explicitTodayKey) || now !== undefined);
  const nowDate = resolveNowDate(now);
  const anchorTodayKey = validateDateKey(explicitTodayKey) || localDayKey(nowDate);

  const srcDaily = Array.isArray(history?.daily) && history.daily.length > 0
    ? history.daily
    : (Array.isArray(history?.dailyTotals) ? history.dailyTotals : []);
  const srcMonthly = Array.isArray(history?.monthly) ? history.monthly : [];
  const srcDailyTotals = Array.isArray(history?.dailyTotals) && history.dailyTotals.length > 0
    ? history.dailyTotals
    : srcDaily;

  const filteredDaily = srcDaily
    .filter((/** @type {any} */ d) => {
      const date = validateDateKey(String(d?.date || '').slice(0, 10));
      if (!date) return false;
      if (fromDate && date < fromDate) return false;
      if (toDate && date > toDate) return false;
      return true;
    })
    .slice()
    .sort((/** @type {any} */ a, /** @type {any} */ b) => String(a.date).localeCompare(String(b.date)));

  const filteredDailyTotals = srcDailyTotals
    .filter((/** @type {any} */ d) => {
      const date = validateDateKey(String(d?.date || '').slice(0, 10));
      if (!date) return false;
      if (fromDate && date < fromDate) return false;
      if (toDate && date > toDate) return false;
      return true;
    })
    .slice()
    .sort((/** @type {any} */ a, /** @type {any} */ b) => String(a.date).localeCompare(String(b.date)));

  const filteredMonthly = srcMonthly
    .filter((/** @type {any} */ m) => {
      const month = validateMonthKey(String(m?.month || '').slice(0, 7));
      if (!month) return false;
      if (fromMonth && month < fromMonth) return false;
      if (toMonth && month > toMonth) return false;
      return true;
    })
    .slice()
    .sort((/** @type {any} */ a, /** @type {any} */ b) => String(a.month).localeCompare(String(b.month)));

  const isFiltered = Boolean(fromDate || toDate);

  if (normResolution === 'daily') {
    const {
      totalTokens,
      knownCostUsd,
      unpricedTokens,
      activeTimeMs,
      messages
    } = sumHistoryBuckets(filteredDaily, false);
    const activeDays = filteredDaily.filter((/** @type {any} */ d) => nonNegInt(d.tokens) > 0).length;
    const streaks = !isFiltered && !hasExplicitToday && Number.isFinite(Number(history?.summary?.currentStreak))
      ? {
          currentStreak: nonNegInt(history.summary.currentStreak),
          longestStreak: Math.max(
            nonNegInt(history.summary.longestStreak),
            computeStreaks(filteredDaily, toDate || anchorTodayKey).longestStreak
          )
        }
      : computeStreaks(filteredDaily, toDate || anchorTodayKey);
    const peakDay = findPeakDay(filteredDaily);
    const breakdown = normGroupBy === 'none'
      ? null
      : aggregateHistoryBreakdown(filteredDaily, normGroupBy, totalTokens, knownCostUsd, (m) => m).slice(0, boundedLimit);
    const rows = filteredDaily.slice(-boundedLimit).map((/** @type {any} */ d) => formatHistoryDailyRow(d, normGroupBy));

    return {
      resolution: 'daily',
      groupBy: normGroupBy,
      range: { from: fromDate || null, to: toDate || null },
      activeDays,
      streaks,
      peakDay,
      totals: {
        totalTokens,
        knownCostUsd,
        unpricedTokens,
        messages,
        activeTimeMs,
        favoriteModel: topFavoriteModel(filteredDaily) || (!isFiltered ? (cleanText(history?.summary?.favoriteModel, 256) || null) : null)
      },
      totalRows: filteredDaily.length,
      truncated: filteredDaily.length > boundedLimit,
      rows,
      breakdown
    };
  }

  if (normResolution === 'monthly') {
    const {
      totalTokens,
      knownCostUsd,
      unpricedTokens,
      activeTimeMs,
      messages
    } = sumHistoryBuckets(filteredMonthly, true);

    const activeDays = filteredDailyTotals.length > 0
      ? filteredDailyTotals.filter((/** @type {any} */ d) => nonNegInt(d.tokens) > 0).length
      : (!isFiltered && Number.isFinite(Number(history?.summary?.activeDays)) ? nonNegInt(history.summary.activeDays) : 0);
    const streaks = !isFiltered && !hasExplicitToday && Number.isFinite(Number(history?.summary?.currentStreak))
      ? {
          currentStreak: nonNegInt(history.summary.currentStreak),
          longestStreak: nonNegInt(history.summary.longestStreak)
        }
      : computeStreaks(filteredDailyTotals, toDate || anchorTodayKey);
    const peakDay = findPeakDay(filteredDailyTotals);
    const breakdown = normGroupBy === 'none'
      ? null
      : aggregateHistoryBreakdown(filteredMonthly, normGroupBy, totalTokens, knownCostUsd, (/** @type {any} */ m) => m).slice(0, boundedLimit);
    const rows = filteredMonthly.slice(-boundedLimit).map((/** @type {any} */ m) => formatHistoryMonthlyRow(m, normGroupBy));

    return {
      resolution: 'monthly',
      groupBy: normGroupBy,
      range: { from: fromMonth || null, to: toMonth || null },
      activeDays,
      streaks,
      peakDay,
      totals: {
        totalTokens,
        knownCostUsd,
        unpricedTokens,
        messages,
        activeTimeMs,
        favoriteModel: topFavoriteModel(filteredMonthly) || (!isFiltered ? (cleanText(history?.summary?.favoriteModel, 256) || null) : null)
      },
      totalRows: filteredMonthly.length,
      truncated: filteredMonthly.length > boundedLimit,
      rows,
      breakdown
    };
  }

  // summary resolution
  const summarySource = history?.summary || {};
  const useDailyForSummary = isFiltered && filteredDaily.length > 0;
  const useMonthlyForSummary = isFiltered && !useDailyForSummary && filteredMonthly.length > 0;

  /** @type {number} */
  let totalTokens;
  /** @type {number} */
  let knownCostUsd;
  /** @type {number} */
  let unpricedTokens;
  /** @type {number} */
  let messages;
  /** @type {number} */
  let activeTimeMs;
  /** @type {number} */
  let activeDays;
  /** @type {{ currentStreak: number, longestStreak: number }} */
  let streaks;
  /** @type {any} */
  let peakDay;
  /** @type {string | null} */
  let favoriteModel;
  /** @type {any[]} */
  let breakdownSource;

  if (!isFiltered && (hasOwn(summarySource, 'totalTokens') || hasOwn(summarySource, 'totalCost'))) {
    totalTokens = nonNegInt(summarySource.totalTokens);
    knownCostUsd = round6(nonNegFloat(summarySource.totalCost));
    unpricedTokens = boundedUnpriced(totalTokens, summarySource.unpricedTokens);
    messages = nonNegInt(summarySource.messages);
    activeTimeMs = nonNegInt(summarySource.activeTimeMs);
    activeDays = Number.isFinite(Number(summarySource.activeDays))
      ? nonNegInt(summarySource.activeDays)
      : filteredDailyTotals.filter((/** @type {any} */ d) => nonNegInt(d.tokens) > 0).length;
    streaks = !hasExplicitToday && Number.isFinite(Number(summarySource.currentStreak))
      ? {
          currentStreak: nonNegInt(summarySource.currentStreak),
          longestStreak: nonNegInt(summarySource.longestStreak)
        }
      : computeStreaks(filteredDailyTotals, anchorTodayKey);
    peakDay = findPeakDay(filteredDailyTotals)
      || (nonNegInt(summarySource.peakDayTokens) > 0
        ? { date: '', totalTokens: nonNegInt(summarySource.peakDayTokens), knownCostUsd: 0 }
        : null);
    breakdownSource = srcMonthly.length > 0 ? srcMonthly : srcDaily;
    favoriteModel = cleanText(summarySource.favoriteModel, MAX_MODEL_ID_LENGTH)
      || topFavoriteModel(breakdownSource);
  } else if (useDailyForSummary) {
    ({ totalTokens, knownCostUsd, unpricedTokens, messages, activeTimeMs } = sumHistoryBuckets(filteredDaily, false));
    activeDays = filteredDaily.filter((/** @type {any} */ d) => nonNegInt(d.tokens) > 0).length;
    streaks = computeStreaks(filteredDaily, toDate || anchorTodayKey);
    peakDay = findPeakDay(filteredDaily);
    breakdownSource = filteredDaily;
    favoriteModel = topFavoriteModel(filteredDaily);
  } else {
    const rows = useMonthlyForSummary ? filteredMonthly : srcMonthly;
    ({ totalTokens, knownCostUsd, unpricedTokens, messages, activeTimeMs } = sumHistoryBuckets(rows, true));
    activeDays = filteredDailyTotals.filter((/** @type {any} */ d) => nonNegInt(d.tokens) > 0).length;
    streaks = computeStreaks(filteredDailyTotals, toDate || anchorTodayKey);
    peakDay = findPeakDay(filteredDailyTotals);
    breakdownSource = rows;
    favoriteModel = topFavoriteModel(rows);
  }

  const breakdown = normGroupBy === 'none'
    ? null
    : aggregateHistoryBreakdown(breakdownSource, normGroupBy, totalTokens, knownCostUsd, (/** @type {any} */ m) => m).slice(0, boundedLimit);

  return {
    resolution: 'summary',
    groupBy: normGroupBy,
    range: { from: fromDate || null, to: toDate || null },
    activeDays,
    streaks,
    peakDay,
    totals: {
      totalTokens,
      knownCostUsd,
      unpricedTokens,
      messages,
      activeTimeMs,
      favoriteModel
    },
    totalRows: breakdown ? breakdown.length : 0,
    truncated: false,
    rows: breakdown || [],
    breakdown
  };
}

// ---------------------------------------------------------------------------
// 4. getDevicesAndHealthQuery
// ---------------------------------------------------------------------------

/**
 * @param {any} value
 * @returns {{ state: string, detected: string[], withData: string[] } | null}
 */
function sanitizeWslStatus(value) {
  if (!isPlainObject(value) || !WSL_STATUS_STATES.has(value.state)) return null;
  /** @param {any} arr */
  const cleanIds = normalizeClientIdList;
  return {
    state: value.state,
    detected: cleanIds(value.detected),
    withData: cleanIds(value.withData)
  };
}

/**
 * @param {any} value
 * @returns {Record<string, string>}
 */
function sanitizeClientStatus(value) {
  /** @type {Record<string, string>} */
  const out = {};
  if (!isPlainObject(value)) return out;
  for (const [rawClient, state] of Object.entries(value)) {
    const client = normalizeClientName(rawClient);
    if (client && !PROTOTYPE_KEYS.has(client) && CLIENT_STATUS_VALUES.has(state)) {
      out[client] = state;
    }
  }
  return out;
}

/**
 * @param {any} health
 * @param {boolean} includeDiagnostics
 */
function sanitizeClientHealthForQuery(health, includeDiagnostics) {
  /** @type {any} */
  const normalized = normalizeClientHealth(health, (/** @type {any} */ c) => normalizeClientName(c) || '');
  if (!normalized) return null;
  if (includeDiagnostics) return normalized;
  /** @type {Record<string, any>} */
  const compactClients = {};
  for (const [clientId, entry] of Object.entries(normalized.clients || {})) {
    if (!entry || typeof entry !== 'object') continue;
    compactClients[clientId] = {
      source: {
        state: entry.source.state,
        detectedCount: entry.source.detectedCount,
        checkedCount: entry.source.checkedCount
      },
      collection: {
        state: entry.collection.state,
        ...(entry.collection.lastAttemptAt ? { lastAttemptAt: entry.collection.lastAttemptAt } : {}),
        ...(entry.collection.lastSuccessAt ? { lastSuccessAt: entry.collection.lastSuccessAt } : {})
      },
      data: { ...entry.data },
      overall: entry.overall
    };
  }
  const normalizedObservedAt = /** @type {any} */ (normalized).observedAt;
  return {
    version: normalized.version,
    ...(normalizedObservedAt ? { observedAt: normalizedObservedAt } : {}),
    clients: compactClients
  };
}

/**
 * Return sanitized device metadata and per-client health diagnostics (no paths or stderr).
 *
 * @param {{
 *   stats?: any,
 *   deviceId?: string,
 *   includeDiagnostics?: boolean
 * }} [params]
 */
function getDevicesAndHealthQuery({
  stats = null,
  deviceId = '',
  includeDiagnostics = true
} = {}) {
  const cleanDeviceId = cleanText(deviceId, 128);
  const withDiagnostics = includeDiagnostics !== false;
  const rawDevices = Array.isArray(stats?.devices) ? stats.devices : [];

  const filtered = cleanDeviceId
    ? rawDevices.filter((/** @type {any} */ d) => (d?.deviceId || d?.id) === cleanDeviceId)
    : rawDevices;

  const devices = filtered
    .filter((/** @type {any} */ d) => d && typeof d === 'object')
    .map((/** @type {any} */ d) => {
      const clientHealth = sanitizeClientHealthForQuery(d.clientHealth, withDiagnostics);
      const trackedClients = normalizeClientIdList(d.trackedClients);
      return {
        deviceId: cleanText(d.deviceId || d.id, 128),
        hostname: cleanText(d.hostname, 256),
        osName: cleanText(d.osName, 64) || null,
        osVersion: cleanText(d.osVersion, 128) || null,
        platform: cleanText(d.platform, 64) || null,
        deviceKind: cleanText(d.deviceKind, 32) || null,
        agentVersion: cleanText(d.agentVersion, 64) || null,
        agentRuntime: cleanText(d.agentRuntime, 64) || null,
        stale: d.stale === true,
        ageMs: optionalNum(d.ageMs),
        updatedAt: normalizeIsoOrNull(d.updatedAt),
        receivedAt: normalizeIsoOrNull(d.receivedAt),
        syncUploadIntervalMs: optionalNum(d.syncUploadIntervalMs) ?? 0,
        trackedClients,
        clientStatus: sanitizeClientStatus(d.clientStatus),
        clientHealth,
        clientHealthSummary: clientHealth ? countOverall(clientHealth) : null,
        wslStatus: sanitizeWslStatus(d.wslStatus),
        projectsEnabled: d.projectsEnabled !== false,
        historyAvailable: typeof d.historyAvailable === 'boolean' ? d.historyAvailable : null
      };
    })
    .sort((/** @type {any} */ a, /** @type {any} */ b) => a.deviceId.localeCompare(b.deviceId));

  return {
    deviceCount: devices.length,
    activeDeviceCount: devices.filter((/** @type {any} */ d) => !d.stale).length,
    staleDeviceCount: devices.filter((/** @type {any} */ d) => d.stale).length,
    deviceFound: !cleanDeviceId || devices.length > 0,
    devices
  };
}

// ---------------------------------------------------------------------------
// 5. getLimitsOverviewQuery
// ---------------------------------------------------------------------------

/**
 * @param {any} value
 * @returns {boolean}
 */
function looksSensitiveLabel(value) {
  const text = cleanText(value, 256);
  if (!text) return false;
  const norm = text.normalize('NFKC');
  return norm.includes('@')
    || /https?:\/\//i.test(norm)
    || /\b(?:bearer|sk-[a-z0-9_-]{10,}|gh[pou]_[a-z0-9_-]{10,}|github_pat_[a-z0-9_]{10,}|xox[baprs]-[a-z0-9-]{10,}|AIza[a-z0-9_-]{20,}|ya29\.[a-z0-9._-]{10,}|eyJ[a-z0-9_-]{10,}\.[a-z0-9_-]{10,})\b/i.test(norm);
}

/**
 * @param {any} row
 * @returns {any}
 */
function sanitizeLimitProviderInputForSummary(row) {
  if (!isPlainObject(row)) return row;
  const copy = { ...row };
  delete copy.accountEmail;
  delete copy.email;
  delete copy.accountKey;
  delete copy.relatedAccountKey;
  delete copy.webAccountKey;
  delete copy.accountKeyAliases;
  for (const field of ['accountLabel', 'profileName', 'accountName', 'accountLogin', 'login', 'planLabel']) {
    if (looksSensitiveLabel(copy[field])) delete copy[field];
  }
  return copy;
}

/**
 * @param {string | string[] | undefined | null} value
 * @returns {Set<string> | null}
 */
function parseFilterSet(value) {
  if (value === null || value === undefined) return null;
  const items = Array.isArray(value) ? value : String(value).split(',');
  const cleaned = items.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean);
  return cleaned.length > 0 ? new Set(cleaned) : null;
}

/**
 * Extract sanitized provider & API quota overview enriched with reset countdowns
 * and balance/credits display metadata, never leaking emails or raw credentials.
 *
 * @param {{
 *   stats?: any,
 *   thirdPartyOnly?: boolean,
 *   provider?: string | string[],
 *   status?: string | string[],
 *   maxProviders?: number,
 *   now?: Date | number | string
 * }} [params]
 */
function getLimitsOverviewQuery({
  stats = null,
  thirdPartyOnly = false,
  provider = '',
  status = '',
  maxProviders = DEFAULT_MAX_PROVIDERS,
  now
} = {}) {
  const nowDate = resolveNowDate(now);
  const nowMs = nowDate.getTime();
  const boundedMax = clampLimit(maxProviders, DEFAULT_MAX_PROVIDERS, MAX_PROVIDERS);
  const providerSet = parseFilterSet(provider);
  const statusSet = parseFilterSet(status);

  const rawList = Array.isArray(stats?.limits?.providers) ? stats.limits.providers : [];
  const filteredRaw = rawList
    .filter((/** @type {any} */ row) => {
      if (!isPlainObject(row)) return false;
      const pId = cleanText(row.provider, 48).toLowerCase();
      if (!pId) return false;
      if (thirdPartyOnly === true && pId !== 'thirdparty') return false;
      if (providerSet && !providerSet.has(pId)) return false;
      if (statusSet) {
        const rowStatus = cleanText(row.status, 32).toLowerCase() || 'unknown';
        const matchesStale = statusSet.has('stale') && row.stale === true;
        if (!matchesStale && !statusSet.has(rowStatus)) return false;
      }
      return true;
    })
    .map(sanitizeLimitProviderInputForSummary);

  const scopedStats = {
    ...(stats && typeof stats === 'object' ? stats : {}),
    limits: {
      ...(isPlainObject(stats?.limits) ? stats.limits : {}),
      providers: filteredRaw
    }
  };

  const summary = extractLimitsSummary(scopedStats, {
    thirdPartyOnly: thirdPartyOnly === true,
    maxProviders: boundedMax
  });

  const enrichedProviders = summary.providers.map((entry, idx) => {
    const rawRow = filteredRaw[idx] || {};
    const rawWindows = Array.isArray(rawRow.windows) ? rawRow.windows : [];
    const creditsWin = rawWindows.find(balanceDisplay.isCreditsWindow) || null;
    const providerLabel = LIMIT_PROVIDER_LABELS.get(entry.provider) || entry.provider;
    const safeLabel = looksSensitiveLabel(entry.label) ? (entry.planLabel || providerLabel) : entry.label;

    const windows = entry.windows.map((/** @type {any} */ w, /** @type {number} */ wIdx) => {
      const rawWin = rawWindows[wIdx] || {};
      const resetsAt = w.resetsAt || normalizeIsoOrNull(rawWin.resetsAt ?? rawWin.resetAt);
      const resetMs = resetsAt ? Date.parse(resetsAt) : NaN;
      const resetsInMs = Number.isFinite(resetMs) ? Math.max(0, resetMs - nowMs) : null;
      const isCredits = balanceDisplay.isCreditsWindow(rawWin) || w.metric === 'credits';
      const isSpend = w.metric === 'spend' || rawWin?.metric === 'spend';
      const currency = isCredits
        ? balanceDisplay.creditsCurrency(rawRow, rawWin)
        : (cleanText(rawWin?.currency, 12).toUpperCase() || null);
      const remaining = isCredits
        ? balanceDisplay.creditsAmount(rawRow, rawWin)
        : optionalNum(rawWin?.remaining);
      const meterPercent = isCredits
        ? balanceDisplay.creditsMeterPercent(rawRow, rawWin)
        : null;

      return {
        kind: cleanText(rawWin?.kind, 24) || null,
        label: limitWindowLabel(entry.provider, rawWin, w.label || 'Quota'),
        metric: w.metric,
        usedPercent: w.usedPercent,
        remainingPercent: w.remainingPercent,
        resetsAt,
        resetsInMs,
        windowMinutes: optionalNum(rawWin?.windowMinutes),
        boundaryKind: cleanText(rawWin?.boundaryKind, 24) || null,
        isCredits,
        ...(isCredits || isSpend || remaining !== null ? {
          used: optionalNum(rawWin?.used),
          limit: optionalNum(rawWin?.limit),
          remaining,
          currency,
          meterPercent,
          formattedRemaining: remaining !== null && currency ? balanceDisplay.formatMoney(remaining, currency) : null
        } : {})
      };
    });

    const balance = entry.balance
      ? {
          ...entry.balance,
          weekSpend: optionalNum(rawRow.balance?.weekSpend),
          meterPercent: balanceDisplay.creditsMeterPercent(rawRow, creditsWin),
          formattedAmount: entry.balance.amount !== null
            ? balanceDisplay.formatMoney(entry.balance.amount, entry.balance.currency)
            : null,
          planStatus: cleanText(rawRow.balance?.planStatus, 24) || null,
          expiresAt: normalizeIsoOrNull(rawRow.balance?.expiresAt)
        }
      : null;

    return {
      provider: entry.provider,
      providerLabel,
      adapterId: entry.adapterId,
      label: safeLabel,
      planLabel: entry.planLabel,
      status: entry.status,
      stale: entry.stale,
      isThirdParty: entry.isThirdParty,
      isBalanceOnly: subscriptionDisplay.isBalanceOnlyAccount(rawRow),
      workspaceKind: cleanText(rawRow.workspaceKind, 32) || null,
      region: cleanText(rawRow.region, 16) || null,
      source: cleanText(rawRow.source, 24) || null,
      actionRequired: cleanText(rawRow.actionRequired, 48) || null,
      updatedAt: entry.updatedAt,
      balance,
      windows
    };
  });

  return {
    updatedAt: normalizeIsoOrNull(stats?.limits?.updatedAt || stats?.updatedAt),
    totalAccounts: enrichedProviders.length,
    totalMatching: filteredRaw.length,
    truncated: filteredRaw.length > enrichedProviders.length,
    healthyAccounts: summary.healthyAccounts,
    staleAccounts: enrichedProviders.filter((p) => p.stale).length,
    thirdPartyCount: summary.thirdPartyCount,
    tightestUsedPct: summary.tightestUsedPct,
    providers: enrichedProviders
  };
}

// ---------------------------------------------------------------------------
// 6. getSubscriptionsAndForecastsQuery
// ---------------------------------------------------------------------------

/**
 * @param {any} subscription
 * @param {any} stats
 * @param {string} today
 * @param {{ normalizeCurrency: (value: any, fallback?: string) => string, convertUsd: (value: number, code: string) => number }} currencyApi
 */
function computeTopUpForecast(subscription, stats, today, currencyApi) {
  const base = {
    status: 'unavailable',
    reason: /** @type {string | null} */ (null),
    balanceAmount: /** @type {number | null} */ (null),
    balanceCurrency: /** @type {string | null} */ (null),
    formattedBalance: /** @type {string | null} */ (null),
    dailyBurn: /** @type {number | null} */ (null),
    daysRemaining: /** @type {number | null} */ (null),
    exhaustDate: /** @type {string | null} */ (null)
  };
  if (subscription.kind !== 'topup') {
    return { ...base, status: 'notApplicable', reason: 'notTopUp' };
  }
  const providers = stats?.limits?.providers;
  if (!Array.isArray(providers)) {
    return { ...base, status: 'unavailable', reason: 'missingLimits' };
  }
  const account = subscriptionDisplay.matchProviderAccount(subscription, providers);
  if (!account) {
    return {
      ...base,
      status: subscriptionDisplay.needsRebinding(subscription, providers) ? 'ambiguous' : 'unmatched',
      reason: 'accountMatch'
    };
  }
  const reversed = [...providers].reverse();
  if (subscriptionDisplay.matchProviderAccount(subscription, reversed) !== account) {
    return { ...base, status: 'ambiguous', reason: 'accountMatch' };
  }
  if (stats?.stale === true || stats?.limits?.stale === true || account.stale === true || account.status === 'stale') {
    return { ...base, status: 'stale', reason: 'markedStale' };
  }
  if (account.status !== 'ok') {
    return { ...base, status: 'unavailable', reason: 'providerStatus' };
  }
  const creditsWin = (Array.isArray(account.windows) ? account.windows : [])
    .find(balanceDisplay.isCreditsWindow) || null;
  const amount = balanceDisplay.creditsAmount(account, creditsWin);
  if (amount === null) {
    return { ...base, status: 'unavailable', reason: 'missingBalance' };
  }
  const rawCurrency = cleanText(creditsWin?.currency || account.balance?.currency, 12).toUpperCase();
  if (!CURRENCY_CODES.includes(rawCurrency) || !CURRENCY_CODES.includes(subscription.currency)) {
    return { ...base, status: 'unavailable', reason: 'unsupportedCurrency' };
  }
  const code = balanceDisplay.creditsCurrency(account, creditsWin);
  const projection = subscriptionDisplay.topUpProjection(subscription, amount, today, {
    balanceCurrency: code,
    currencyApi
  });
  if (!projection) {
    return {
      ...base,
      status: 'unavailable',
      reason: 'insufficientHistory',
      balanceAmount: amount,
      balanceCurrency: code,
      formattedBalance: balanceDisplay.formatMoney(amount, code)
    };
  }
  return {
    status: 'available',
    reason: null,
    balanceAmount: amount,
    balanceCurrency: code,
    formattedBalance: balanceDisplay.formatMoney(amount, code),
    dailyBurn: round6(projection.dailyBurn),
    daysRemaining: projection.daysRemaining,
    exhaustDate: projection.exhaustDate || null
  };
}

/**
 * Compute active subscriptions, normalized monthly USD costs, renewal dates,
 * and top-up exhaustion forecasts without mutating global currency rates.
 *
 * @param {{
 *   subscriptionsDoc?: any,
 *   stats?: any,
 *   rates?: Record<string, number> | null,
 *   date?: string | Date,
 *   includeForecasts?: boolean,
 *   activeOnly?: boolean
 * }} [params]
 */
function getSubscriptionsAndForecastsQuery({
  subscriptionsDoc = null,
  stats = null,
  rates = null,
  date = '',
  includeForecasts = true,
  activeOnly = false
} = {}) {
  let today;
  if (date instanceof Date) {
    if (Number.isNaN(date.getTime())) throw new Error('Invalid calendar date');
    today = subscriptionDisplay.todayString(date);
  } else if (date !== undefined && date !== null && String(date).trim() !== '') {
    const candidate = String(date).trim();
    if (subscriptionDisplay.daysBetween(candidate, candidate) !== 0) {
      throw new Error(`Invalid calendar date "${candidate}". Expected YYYY-MM-DD`);
    }
    today = candidate;
  } else {
    today = subscriptionDisplay.todayString();
  }

  /** @type {Record<string, number>} */
  const effectiveRates = resolveEffectiveRates({}, isPlainObject(rates) ? /** @type {any} */ (rates) : {});
  const currencyApi = {
    /** @param {any} code @param {string} [fallback] */
    normalizeCurrency: (code, fallback = 'USD') => normalizeCurrency(code, fallback),
    /** @param {number} value @param {string} code */
    convertUsd: (value, code) => {
      const normalizedCode = normalizeCurrency(code, 'USD');
      const rate = effectiveRates[normalizedCode];
      return Number.isFinite(rate) && rate > 0 ? Number((Number(value || 0) * rate).toFixed(6)) : NaN;
    }
  };

  const rawList = Array.isArray(subscriptionsDoc)
    ? subscriptionsDoc
    : Array.isArray(subscriptionsDoc?.subscriptions)
      ? subscriptionsDoc.subscriptions
      : Array.isArray(stats?.subscriptions?.subscriptions)
        ? stats.subscriptions.subscriptions
        : Array.isArray(stats?.subscriptions)
          ? stats.subscriptions
          : [];

  const normalized = subscriptionDisplay.normalizeSubscriptions(rawList, { currencyApi });
  const activeSet = new Set(subscriptionDisplay.activeSubscriptions(normalized, today).map((/** @type {any} */ s) => s.id));
  const limitProviders = Array.isArray(stats?.limits?.providers) ? stats.limits.providers : [];

  const allItems = normalized.map((sub) => {
    const active = activeSet.has(sub.id);
    const monthlyUsd = round6(subscriptionDisplay.monthlyAmountUsd(sub, currencyApi, today));
    const nextRenewal = subscriptionDisplay.nextRenewalDate(sub, today) || null;
    const coverageEnd = subscriptionDisplay.coverageEndDate(sub, today) || null;
    const daysUntil = subscriptionDisplay.daysUntilRenewal(sub, today);
    const forecast = includeForecasts !== false
      ? computeTopUpForecast(sub, stats, today, currencyApi)
      : null;

    return {
      id: sub.id,
      provider: sub.provider,
      providerLabel: LIMIT_PROVIDER_LABELS.get(sub.provider) || sub.provider,
      kind: sub.kind,
      planName: sub.planName || null,
      active,
      amountMinor: sub.amountMinor,
      amountUnits: subscriptionDisplay.amountUnits(sub),
      currency: sub.currency,
      interval: sub.interval,
      intervalCount: sub.intervalCount,
      startDate: sub.startDate,
      endDate: sub.endDate,
      nextRenewalOverride: sub.nextRenewalOverride,
      autoRenew: sub.autoRenew,
      monthlyAmountUsd: monthlyUsd,
      nextRenewalDate: nextRenewal,
      coverageEndDate: coverageEnd,
      daysUntilRenewal: daysUntil,
      paidToDateMinor: subscriptionDisplay.paidToDateMinor(sub, today),
      topUpTotalMinor: subscriptionDisplay.topUpTotalMinor(sub),
      topUpMonthMinor: subscriptionDisplay.topUpMonthMinor(sub, today),
      lastTopUp: subscriptionDisplay.lastTopUp(sub),
      firstTopUpDate: subscriptionDisplay.firstTopUpDate(sub) || null,
      profileName: sub.binding?.profileName || null,
      needsRebinding: limitProviders.length > 0 ? subscriptionDisplay.needsRebinding(sub, limitProviders) : false,
      note: sub.note || null,
      updatedAt: sub.updatedAt || null,
      forecast
    };
  });

  const activeItems = allItems.filter((item) => item.active);
  const subscriptions = activeOnly === true ? activeItems : allItems;

  return {
    asOfDate: today,
    updatedAt: normalizeIsoOrNull(subscriptionsDoc?.updatedAt || stats?.subscriptionsUpdatedAt),
    totalCount: allItems.length,
    activeCount: activeItems.length,
    monthlyTotalUsd: round6(subscriptionDisplay.monthlyTotalUsd(normalized, currencyApi, today)),
    subscriptions
  };
}

// ---------------------------------------------------------------------------
// 7. getLiveTokenRateSummary
// ---------------------------------------------------------------------------

/**
 * @param {any} value
 * @returns {number | null}
 */
function cappedRateOrNull(value) {
  const n = optionalNum(value);
  if (n === null || n < 0) return null;
  return Math.min(MAX_DISPLAY_RATE, n);
}

/**
 * @param {any} period
 * @returns {boolean}
 */
function hasValidThroughputShape(period) {
  if (!period || typeof period !== 'object' || period.capabilities?.throughput === false) return false;
  return ['timedTokens', 'timedOutputTokens', 'timedDurationMs'].every((field) => {
    const val = optionalNum(period[field]);
    return val !== null && val >= 0;
  });
}

/**
 * @param {any} period
 * @returns {number | null}
 */
function fallbackAvgOutputTokensPerSecFromPeriod(period) {
  if (!period || typeof period !== 'object' || period.capabilities?.throughput === false) return null;
  const durationMs = optionalNum(period.timedDurationMs);
  const timedOutput = optionalNum(period.timedOutputTokens);
  if (durationMs === null || durationMs <= 0 || timedOutput === null || timedOutput < 0) return null;
  const boundedOutput = hasOwn(period, 'outputTokens') && optionalNum(period.outputTokens) !== null && Number(period.outputTokens) >= 0
    ? Math.min(timedOutput, Math.max(0, Number(period.outputTokens)))
    : timedOutput;
  return computeAvgOutputTokensPerSec(boundedOutput, durationMs);
}

/**
 * Return structured live token rate summary using liveRateSnapshot when
 * available or safely computing fallback throughput from period counters.
 *
 * @param {{
 *   stats?: any,
 *   liveRateSnapshot?: any,
 *   deviceId?: string,
 *   now?: Date | number | string
 * }} [params]
 */
function getLiveTokenRateSummary({
  stats = null,
  liveRateSnapshot = null,
  deviceId = '',
  now
} = {}) {
  const cleanDeviceId = cleanText(deviceId, 128) || null;
  const hasExplicitNow = now !== undefined && now !== null && now !== '';
  const nowMs = hasExplicitNow ? resolveNowDate(now).getTime() : Date.now();
  const devices = Array.isArray(stats?.devices) ? stats.devices : [];
  const selectedDevice = cleanDeviceId
    ? devices.find((/** @type {any} */ d) => (d?.deviceId || d?.id) === cleanDeviceId) || null
    : null;

  let targetPeriod = cleanDeviceId
    ? (selectedDevice?.periods?.today || selectedDevice?.today || null)
    : (stats?.periods?.today || stats?.today || null);

  if (!targetPeriod && !cleanDeviceId && devices.length > 0) {
    const activeTodayPeriods = devices
      .filter((/** @type {any} */ d) => d?.stale !== true && (d?.periods?.today || d?.today))
      .map((/** @type {any} */ d) => d.periods?.today || d.today);
    if (activeTodayPeriods.length > 0 && activeTodayPeriods.every((/** @type {any} */ p) => p?.capabilities?.throughput !== false)) {
      let timedTokens = 0;
      let timedOutputTokens = 0;
      let timedDurationMs = 0;
      let outputTokens = 0;
      for (const p of activeTodayPeriods) {
        timedTokens += nonNegInt(p.timedTokens);
        timedOutputTokens += nonNegInt(p.timedOutputTokens);
        timedDurationMs += nonNegInt(p.timedDurationMs);
        outputTokens += nonNegInt(p.outputTokens);
      }
      targetPeriod = {
        capabilities: { throughput: true },
        timedTokens,
        timedOutputTokens,
        timedDurationMs,
        outputTokens
      };
    }
  }

  const fallbackAvgOutputTokensPerSec = fallbackAvgOutputTokensPerSecFromPeriod(targetPeriod);

  // Check if a matching liveRateSnapshot was supplied
  if (isPlainObject(liveRateSnapshot)) {
    const snapDeviceId = cleanText(liveRateSnapshot.deviceId, 128) || null;
    const deviceMatches = !cleanDeviceId
      || (snapDeviceId ? snapDeviceId === cleanDeviceId : Array.isArray(liveRateSnapshot.devices)
        && liveRateSnapshot.devices.some((/** @type {any} */ d) => d?.id === `device:${cleanDeviceId}` || d?.deviceId === cleanDeviceId));

    if (deviceMatches) {
      const expiresAt = optionalNum(liveRateSnapshot.expiresAt);
      const sampledAt = optionalNum(liveRateSnapshot.sampledAt);
      const expiredAtNow = hasExplicitNow && expiresAt !== null && expiresAt <= nowMs;

      if (typeof liveRateSnapshot.state === 'string') {
        const rawState = liveRateSnapshot.state.trim().toLowerCase();
        if (rawState === 'live' || rawState === 'idle') {
          if (expiredAtNow) {
            return {
              deviceId: cleanDeviceId,
              state: 'unavailable',
              reason: 'expired',
              speed: null,
              burn: null,
              sampledAt: null,
              expiresAt: null,
              deviceCount: 0,
              fallbackAvgOutputTokensPerSec
            };
          }
          return {
            deviceId: cleanDeviceId,
            state: rawState,
            reason: null,
            speed: cappedRateOrNull(liveRateSnapshot.speed),
            burn: cappedRateOrNull(liveRateSnapshot.burn),
            sampledAt,
            expiresAt,
            deviceCount: Math.max(0, Math.trunc(optionalNum(liveRateSnapshot.deviceCount) ?? (cleanDeviceId ? 1 : 0))),
            fallbackAvgOutputTokensPerSec
          };
        }
        return {
          deviceId: cleanDeviceId,
          state: 'unavailable',
          reason: cleanText(liveRateSnapshot.reason, 48) || 'waitingForSample',
          speed: null,
          burn: null,
          sampledAt: null,
          expiresAt: null,
          deviceCount: Math.max(0, Math.trunc(optionalNum(liveRateSnapshot.deviceCount) ?? 0)),
          fallbackAvgOutputTokensPerSec
        };
      }

      if (optionalNum(liveRateSnapshot.speed) !== null) {
        if (expiredAtNow) {
          return {
            deviceId: cleanDeviceId,
            state: 'unavailable',
            reason: 'expired',
            speed: null,
            burn: null,
            sampledAt: null,
            expiresAt: null,
            deviceCount: 0,
            fallbackAvgOutputTokensPerSec
          };
        }
        const inferredDeviceCount = optionalNum(liveRateSnapshot.deviceCount)
          ?? (Array.isArray(liveRateSnapshot.devices) ? liveRateSnapshot.devices.length : 1);
        return {
          deviceId: cleanDeviceId,
          state: liveRateSnapshot.idle === true ? 'idle' : 'live',
          reason: null,
          speed: cappedRateOrNull(liveRateSnapshot.speed),
          burn: cappedRateOrNull(liveRateSnapshot.burn),
          sampledAt,
          expiresAt,
          deviceCount: Math.max(0, Math.trunc(inferredDeviceCount)),
          fallbackAvgOutputTokensPerSec
        };
      }
    }
  }

  // No usable liveRateSnapshot -> unavailable with explicit diagnostic reason
  /** @type {string} */
  let reason;
  if (stats?.stale === true) {
    reason = 'stale';
  } else if (cleanDeviceId) {
    if (!selectedDevice) reason = 'missingData';
    else if (selectedDevice.stale === true) reason = 'stale';
    else if (!targetPeriod) reason = 'missingData';
    else if (!hasValidThroughputShape(targetPeriod)) reason = 'unsupportedTiming';
    else reason = 'waitingForSample';
  } else if (devices.length > 0 && devices.every((/** @type {any} */ d) => d?.stale === true)) {
    reason = 'stale';
  } else if (!targetPeriod) {
    reason = 'missingData';
  } else if (!hasValidThroughputShape(targetPeriod)) {
    reason = 'unsupportedTiming';
  } else {
    reason = 'waitingForSample';
  }

  return {
    deviceId: cleanDeviceId,
    state: 'unavailable',
    reason,
    speed: null,
    burn: null,
    sampledAt: null,
    expiresAt: null,
    deviceCount: 0,
    fallbackAvgOutputTokensPerSec
  };
}

module.exports = {
  BREAKDOWN_PERIODS,
  BREAKDOWN_GROUPS,
  SESSION_PERIODS,
  SESSION_STATES,
  SESSION_SORTS,
  HISTORY_RESOLUTIONS,
  HISTORY_GROUPS,
  queryUsageBreakdown,
  listSessionsQuery,
  queryUsageHistory,
  getDevicesAndHealthQuery,
  getLimitsOverviewQuery,
  getSubscriptionsAndForecastsQuery,
  getLiveTokenRateSummary
};
