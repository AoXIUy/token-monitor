'use strict';

// Portable (Node-free) usage-history core. Mirrors usage.js conventions so the
// Cloudflare Worker can import it. Pure functions only — no I/O.
const { REASONIX_CLIENT } = require('./providers/reasonix/paths');

const PROTOTYPE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_KEY_RE = /^\d{4}-\d{2}$/;

function isSafeKey(key) {
  return typeof key === 'string' && key.length > 0 && !PROTOTYPE_KEYS.has(key) && !PROTOTYPE_KEYS.has(key.toLowerCase());
}

function hasOwn(obj, key) {
  return Boolean(obj) && Object.prototype.hasOwnProperty.call(obj, key);
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function toPlainSafeObject(map) {
  const out = {};
  for (const key of Object.keys(map || {})) {
    if (isSafeKey(key)) out[key] = map[key];
  }
  return out;
}

const TOKSCALE_CLIENT_ALIASES = new Map([
  ['antigravity-cli', 'antigravity'],
  ['antigravity-extension', 'antigravity'],
  // `micode` is tokscale's id for MiMo Code, a fossil of the path typo its PR
  // #784 fixed. Token Monitor's id is `mimo`, so both upstream spellings fold
  // onto it — including plain `micode`, which is what every device and stored
  // history record written before the rename still says.
  ['micode', 'mimo'],
  ['micode-desktop', 'mimo'],
  ['kilocode', 'kilo'],
  ['devin-cli', 'devin'],
  ['devin-desktop', 'devin'],
  ['vibe', 'mistral']
]);

// Canonical Token Monitor identity for client ids emitted by Tokscale. Keep
// this small and exact: product-name heuristics still belong to usage.js, while
// history and the durable archive need the same raw-id aliases as live usage.
function normalizeTokscaleClientName(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw || !isSafeKey(raw)) return null;
  const mapped = TOKSCALE_CLIENT_ALIASES.get(raw) || raw;
  return isSafeKey(mapped) ? mapped : null;
}

function normalizeTokscaleModelNameForClient(value, client) {
  const model = String(value ?? '').trim();
  if (!isSafeKey(model)) return '';
  if (normalizeTokscaleClientName(client) === 'cursor' && /^(?:auto|default)$/i.test(model)) {
    return 'cursor-auto';
  }
  return model;
}

// A graph/day component summary is keyed by the source model labels. Its
// per-model buckets can follow a Cursor rename only if no other client shares
// the old label; otherwise the aggregate has no client split to recover.
function normalizeTokscaleModelComponentSummary(summary, rows) {
  if (!summary?.perModel || !isPlainObject(summary.perModel)) return summary;
  const renames = new Map();
  for (const row of rows || []) {
    const model = String(row?.modelId || row?.model || row?.model_id || 'unknown');
    const canonical = normalizeTokscaleModelNameForClient(model, row?.client) || 'unknown';
    if (renames.has(model) && renames.get(model) !== canonical) return null;
    renames.set(model, canonical);
  }
  if (![...renames].some(([before, after]) => before !== after)) return summary;
  const perModel = Object.create(null);
  for (const [model, components] of Object.entries(summary.perModel)) {
    const key = renames.get(model) || model;
    if (!isSafeKey(key)) continue;
    const previous = hasOwn(perModel, key) ? perModel[key] : null;
    perModel[key] = previous ? {
      cacheReadTokens: num(previous.cacheReadTokens) + num(components?.cacheReadTokens),
      cacheWriteTokens: num(previous.cacheWriteTokens) + num(components?.cacheWriteTokens),
      outputTokens: num(previous.outputTokens) + num(components?.outputTokens),
      unclassifiedTokens: num(previous.unclassifiedTokens) + num(components?.unclassifiedTokens)
    } : components;
  }
  return { ...summary, perModel: toPlainSafeObject(perModel) };
}

function num(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.replace(/[$,]/g, ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function unpricedTokensFor(value) {
  return Math.min(Math.max(0, num(value?.tokens)), Math.max(0, Math.round(num(value?.unpricedTokens))));
}

function addUnpricedTokens(target, source) {
  const count = unpricedTokensFor(source);
  if (count > 0) target.unpricedTokens = num(target.unpricedTokens) + count;
}

function normalizeTimeMetrics(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    totalActiveTimeMs: num(value.totalActiveTimeMs ?? value.total_active_time_ms),
    longestContinuousMs: num(value.longestContinuousMs ?? value.longest_continuous_ms),
    maxConcurrentSessions: num(value.maxConcurrentSessions ?? value.max_concurrent_sessions),
    sessionCount: num(value.sessionCount ?? value.session_count)
  };
}

// Tokscale emits these clients' reasoning as a disjoint JSON bucket. History
// uses the same reasoning-inclusive public output convention as usage.js.
// zcode/opencode/muse: tokscale subtracts the reasoning overlap out of
// `output` (their sources are reasoning-inclusive), so add it back here.
// hermes: same shape — `state.db.reasoning_tokens` is a subset of
// `output_tokens`, and tokscale only started subtracting that overlap out in
// junhoyeo/tokscale#1411, so this entry is only correct once the vendored pin
// carries that fix. On an older pin, whose `output` is already
// reasoning-inclusive, folding reasoning back in here counts it twice.
// Grok, Tencent Buddy and Cherry Studio chat ledgers also emit independent reasoning.
// Gemini CLI `thoughts` are a separate additive bucket; `output` is candidates only.
const TOKSCALE_DISJOINT_REASONING_CLIENTS = new Set([REASONIX_CLIENT, 'antigravity', 'codex', 'droid', 'dsh', 'grok', 'gemini', 'zcode', 'opencode', 'muse', 'codebuddy', 'workbuddy', 'cherrystudio', 'hermes', 'jcode', 'junie', 'qoder', 'qodercn']);

function hasDisjointReasoning(client) {
  return TOKSCALE_DISJOINT_REASONING_CLIENTS.has(normalizeTokscaleClientName(client));
}

function sumTokens(breakdown, client = '') {
  if (!breakdown || typeof breakdown !== 'object') return 0;
  return num(breakdown.input) + num(breakdown.output)
    + num(breakdown.cacheRead) + num(breakdown.cacheWrite)
    + (hasDisjointReasoning(client) ? num(breakdown.reasoning) : 0);
}

function sumOutputTokens(breakdown, client = '') {
  if (!breakdown || typeof breakdown !== 'object') return 0;
  return num(breakdown.output)
    + (hasDisjointReasoning(client) ? num(breakdown.reasoning) : 0);
}

function componentValues(value, totalTokens, exact) {
  const cacheReadTokens = Math.max(0, num(value?.cacheReadTokens));
  const cacheWriteTokens = Math.max(0, num(value?.cacheWriteTokens));
  const outputTokens = Math.max(0, num(value?.outputTokens));
  if (cacheReadTokens + cacheWriteTokens + outputTokens > totalTokens) return null;
  const unclassifiedTokens = Math.min(
    totalTokens - cacheReadTokens - cacheWriteTokens - outputTokens,
    Math.max(0, num(value?.unclassifiedTokens
      ?? (exact ? 0 : totalTokens - cacheReadTokens - cacheWriteTokens - outputTokens)))
  );
  return { cacheReadTokens, cacheWriteTokens, outputTokens, unclassifiedTokens };
}

function applyComponentSummary(summary, totalTokens, perClient, perModel) {
  if (!summary || typeof summary !== 'object') return null;
  const exact = summary.tokenComponentsAvailable === true;
  const totals = componentValues(summary, totalTokens, exact);
  if (!totals) return null;
  const clients = Object.create(null);
  for (const [key, value] of Object.entries(perClient)) {
    if (!isSafeKey(key)) continue;
    const components = componentValues(hasOwn(summary.perClient, key) ? summary.perClient[key] : undefined, num(value.tokens), exact);
    if (!components) return null;
    clients[key] = components;
  }
  const models = Object.create(null);
  for (const [key, value] of Object.entries(perModel)) {
    if (!isSafeKey(key)) continue;
    const components = componentValues(hasOwn(summary.perModel, key) ? summary.perModel[key] : undefined, num(value.tokens), exact);
    if (!components) return null;
    models[key] = components;
  }
  return { totals, clients, models };
}

// Folds tokscale `graph` output (contributions[].clients[]) into a per-day shape where a
// day's total always equals the sum of its perClient and perModel stacks.
function parseGraphResult(raw) {
  const contributions = [];
  const rows = raw && Array.isArray(raw.contributions) ? raw.contributions : [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const date = String(row.date || '').slice(0, 10);
    if (!date) continue;
    const perClient = Object.create(null);
    const perModel = Object.create(null);
    let tokens = 0;
    let cost = 0;
    let unpricedTokens = 0;
    let messages = 0;
    let cacheReadTokens = 0;
    let cacheWriteTokens = 0;
    let outputTokens = 0;
    let unclassifiedTokens = 0;
    let tokenComponentsAvailable = true;
    const clientRows = Array.isArray(row.clients) ? row.clients : [];
    for (const c of clientRows) {
      if (!c || typeof c !== 'object') continue;
      const client = normalizeTokscaleClientName(c.client) || 'unknown';
      const model = normalizeTokscaleModelNameForClient(c.modelId || c.model || c.model_id || 'unknown', client) || 'unknown';
      const t = sumTokens(c.tokens, client);
      const cst = num(c.cost);
      const unpriced = unpricedTokensFor({ tokens: t, unpricedTokens: c.unpricedTokens });
      const cacheRead = num(c.tokens?.cacheRead ?? c.tokens?.cache_read);
      const cacheWrite = num(c.tokens?.cacheWrite ?? c.tokens?.cache_write);
      const output = sumOutputTokens(c.tokens, client);
      const componentsAvailable = c.tokenComponentsAvailable !== false;
      const hasExplicitUnclassified = Object.prototype.hasOwnProperty.call(c, 'unclassifiedTokens')
        || Object.prototype.hasOwnProperty.call(c, 'unclassified_tokens');
      const unclassified = Math.min(t, Math.max(0, hasExplicitUnclassified
        ? num(c.unclassifiedTokens ?? c.unclassified_tokens)
        : (t > 0 && !componentsAvailable ? t : 0)));
      // Reasonix's `messages` field is a provider request count, not user turns.
      // Keep it out of Token Monitor's message/activity semantics; its tokens and
      // cost still contribute normally to the history totals.
      const msg = String(client).trim().toLowerCase() === REASONIX_CLIENT ? 0 : num(c.messages);
      tokens += t;
      cost += cst;
      unpricedTokens += unpriced;
      messages += msg;
      cacheReadTokens += cacheRead;
      cacheWriteTokens += cacheWrite;
      outputTokens += output;
      unclassifiedTokens += unclassified;
      tokenComponentsAvailable = tokenComponentsAvailable
        && (t === 0 || (componentsAvailable && unclassified === 0));
      const pc = hasOwn(perClient, client) ? perClient[client] : (perClient[client] = {
        tokens: 0, cost: 0, messages: 0, unclassifiedTokens: 0
      });
      pc.tokens += t; pc.cost += cst; pc.messages += msg;
      addUnpricedTokens(pc, { tokens: t, unpricedTokens: unpriced });
      if (cacheRead > 0) pc.cacheReadTokens = num(pc.cacheReadTokens) + cacheRead;
      if (cacheWrite > 0) pc.cacheWriteTokens = num(pc.cacheWriteTokens) + cacheWrite;
      if (output > 0) pc.outputTokens = num(pc.outputTokens) + output;
      pc.unclassifiedTokens += unclassified;
      const pm = hasOwn(perModel, model) ? perModel[model] : (perModel[model] = {
        tokens: 0, cost: 0, unclassifiedTokens: 0
      });
      pm.tokens += t; pm.cost += cst;
      addUnpricedTokens(pm, { tokens: t, unpricedTokens: unpriced });
      if (cacheRead > 0) pm.cacheReadTokens = num(pm.cacheReadTokens) + cacheRead;
      if (cacheWrite > 0) pm.cacheWriteTokens = num(pm.cacheWriteTokens) + cacheWrite;
      if (output > 0) pm.outputTokens = num(pm.outputTokens) + output;
      pm.unclassifiedTokens += unclassified;
    }
    const componentSummary = applyComponentSummary(
      normalizeTokscaleModelComponentSummary(row.tokenComponentSummary, clientRows),
      tokens,
      perClient,
      perModel
    );
    if (componentSummary) {
      cacheReadTokens = componentSummary.totals.cacheReadTokens;
      cacheWriteTokens = componentSummary.totals.cacheWriteTokens;
      outputTokens = componentSummary.totals.outputTokens;
      unclassifiedTokens = componentSummary.totals.unclassifiedTokens;
      tokenComponentsAvailable = unclassifiedTokens === 0;
      for (const [client, value] of Object.entries(perClient)) {
        value.cacheReadTokens = componentSummary.clients[client].cacheReadTokens;
        value.cacheWriteTokens = componentSummary.clients[client].cacheWriteTokens;
        value.outputTokens = componentSummary.clients[client].outputTokens;
        value.unclassifiedTokens = componentSummary.clients[client].unclassifiedTokens;
        tokenComponentsAvailable = tokenComponentsAvailable && value.unclassifiedTokens === 0;
      }
      for (const [model, value] of Object.entries(perModel)) {
        value.cacheReadTokens = componentSummary.models[model].cacheReadTokens;
        value.cacheWriteTokens = componentSummary.models[model].cacheWriteTokens;
        value.outputTokens = componentSummary.models[model].outputTokens;
        value.unclassifiedTokens = componentSummary.models[model].unclassifiedTokens;
        tokenComponentsAvailable = tokenComponentsAvailable && value.unclassifiedTokens === 0;
      }
    }
    contributions.push({
      date,
      tokens,
      cost,
      ...(unpricedTokens > 0 ? { unpricedTokens } : {}),
      messages,
      cacheReadTokens,
      cacheWriteTokens,
      outputTokens,
      unclassifiedTokens,
      tokenComponentsAvailable,
      activeTimeMs: num(row.activeTimeMs ?? row.active_time_ms),
      perClient: toPlainSafeObject(perClient),
      perModel: toPlainSafeObject(perModel)
    });
  }
  const timeMetrics = normalizeTimeMetrics(raw?.timeMetrics ?? raw?.time_metrics);
  return timeMetrics ? { contributions, timeMetrics } : { contributions };
}

function intensityBucket(value, max) {
  if (max <= 0) return 0;
  const ratio = num(value) / max;
  return ratio >= 0.75 ? 4 : ratio >= 0.5 ? 3 : ratio >= 0.25 ? 2 : ratio > 0 ? 1 : 0;
}

// Preserve the legacy cost-based .intensity field for mixed-version hubs/widgets,
// while exposing explicit fields for new metric-aware renderers. Mutates and returns
// the same array.
function computeIntensities(days) {
  const list = Array.isArray(days) ? days : [];
  let maxTokens = 0;
  let maxCost = 0;
  for (const d of list) {
    if (!isPlainObject(d)) continue;
    maxTokens = Math.max(maxTokens, num(d.tokens));
    maxCost = Math.max(maxCost, num(d.cost));
  }
  for (const d of list) {
    if (!isPlainObject(d)) continue;
    d.tokenIntensity = intensityBucket(d.tokens, maxTokens);
    d.costIntensity = intensityBucket(d.cost, maxCost);
    d.intensity = d.costIntensity;
  }
  return list;
}

function dayKeyAddDays(key, delta) {
  if (typeof key !== 'string' || !DAY_KEY_RE.test(key) || !Number.isFinite(delta)) return '';
  const baseMs = Date.parse(`${key}T00:00:00Z`);
  if (!Number.isFinite(baseMs)) return '';
  const ms = baseMs + delta * 86400000;
  if (!Number.isFinite(ms)) return '';
  const date = new Date(ms);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : '';
}

// Every day key reaching this module is a local calendar day: the collector stamps
// contributions with `localTodayKey()` and `computePeriodWindows` ends each window at
// the next *local* midnight. Resolving "today" from `toISOString()` instead keys the
// boundary in UTC, which east of UTC drops the current local day out of the rolling
// window and west of UTC starts the streak walk on a day that holds no data.
function localDayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// A day is "active" when tokens > 0. currentStreak = consecutive active days ending at
// todayKey (0 if today is inactive). longestStreak = longest run anywhere.
function computeStreaks(days, todayKey) {
  const active = new Set();
  for (const d of (Array.isArray(days) ? days : [])) {
    if (!isPlainObject(d) || typeof d.date !== 'string') continue;
    const key = d.date.slice(0, 10);
    if (DAY_KEY_RE.test(key) && num(d.tokens) > 0) active.add(key);
  }
  // current: walk back from todayKey while active
  let currentStreak = 0;
  let cursor = typeof todayKey === 'string' ? todayKey.slice(0, 10) : '';
  while (cursor && active.has(cursor)) {
    currentStreak += 1;
    cursor = dayKeyAddDays(cursor, -1);
  }
  // longest: scan sorted active dates for consecutive runs
  const sorted = [...active].sort();
  let longestStreak = 0;
  let run = 0;
  let prev = null;
  for (const key of sorted) {
    const expectedNext = prev !== null ? dayKeyAddDays(prev, 1) : '';
    run = (expectedNext && key === expectedNext) ? run + 1 : 1;
    longestStreak = Math.max(longestStreak, run);
    prev = key;
  }
  return { currentStreak, longestStreak };
}

function addPerClient(target, source, includeTokenComponents = false) {
  if (!isPlainObject(source) || !target || typeof target !== 'object') return;
  for (const [rawClient, v] of Object.entries(source)) {
    if (!isPlainObject(v)) continue;
    const client = normalizeTokscaleClientName(rawClient);
    if (!isSafeKey(client)) continue;
    const t = hasOwn(target, client) ? target[client] : (target[client] = { tokens: 0, cost: 0, messages: 0 });
    t.tokens += num(v.tokens); t.cost += num(v.cost); t.messages += num(v.messages);
    addUnpricedTokens(t, v);
    if (includeTokenComponents) {
      if (num(v.cacheReadTokens) > 0) t.cacheReadTokens = num(t.cacheReadTokens) + num(v.cacheReadTokens);
      if (num(v.cacheWriteTokens) > 0) t.cacheWriteTokens = num(t.cacheWriteTokens) + num(v.cacheWriteTokens);
      if (num(v.outputTokens) > 0) t.outputTokens = num(t.outputTokens) + num(v.outputTokens);
      const unclassifiedTokens = unclassifiedTokensFor(v);
      // Keep explicit zero provenance through repeated merges, just as for models.
      t.unclassifiedTokens = num(t.unclassifiedTokens) + unclassifiedTokens;
    }
  }
}

function addPerModel(target, source, includeTokenComponents = false) {
  if (!isPlainObject(source) || !target || typeof target !== 'object') return;
  for (const [model, v] of Object.entries(source)) {
    if (!isSafeKey(model) || !isPlainObject(v)) continue;
    const t = hasOwn(target, model) ? target[model] : (target[model] = { tokens: 0, cost: 0 });
    t.tokens += num(v.tokens); t.cost += num(v.cost);
    addUnpricedTokens(t, v);
    if (includeTokenComponents) {
      if (num(v.cacheReadTokens) > 0) t.cacheReadTokens = num(t.cacheReadTokens) + num(v.cacheReadTokens);
      if (num(v.cacheWriteTokens) > 0) t.cacheWriteTokens = num(t.cacheWriteTokens) + num(v.cacheWriteTokens);
      if (num(v.outputTokens) > 0) t.outputTokens = num(t.outputTokens) + num(v.outputTokens);
      const unclassifiedTokens = unclassifiedTokensFor(v);
      // Zero is provenance: it distinguishes a known input remainder from an
      // unknown one when another model makes the merged day inexact.
      t.unclassifiedTokens = num(t.unclassifiedTokens) + unclassifiedTokens;
    }
  }
}

function unclassifiedTokensFor(value) {
  if (!value || typeof value !== 'object') return 0;
  if (Object.prototype.hasOwnProperty.call(value, 'unclassifiedTokens')) {
    return Math.min(
      Math.max(0, num(value.tokens)),
      Math.max(0, num(value.unclassifiedTokens))
    );
  }
  return value.tokenComponentsAvailable === true ? 0 : Math.max(0, num(value.tokens));
}

function activeTimeTotal(days) {
  return (Array.isArray(days) ? days : []).reduce((sum, day) => sum + (isPlainObject(day) ? num(day.activeTimeMs) : 0), 0);
}

// Full-history daily totals stay intentionally compact: they carry exactly what
// an all-time active-day count and a future year heatmap need, without repeating
// the per-client/per-model maps retained in the rolling `daily` tier.
function compactDailyTotals(days) {
  const byDate = new Map();
  for (const day of (Array.isArray(days) ? days : [])) {
    if (!isPlainObject(day) || typeof day.date !== 'string') continue;
    const date = day.date.slice(0, 10);
    if (!DAY_KEY_RE.test(date)) continue;
    const current = byDate.get(date) || { date, tokens: 0, cost: 0, activeTimeMs: 0 };
    current.tokens += num(day.tokens);
    current.cost += num(day.cost);
    current.activeTimeMs += num(day.activeTimeMs);
    byDate.set(date, current);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function monthlyRollup(days) {
  const byMonth = new Map();
  for (const d of (Array.isArray(days) ? days : [])) {
    if (!isPlainObject(d) || typeof d.date !== 'string') continue;
    const month = d.date.slice(0, 7);
    if (!MONTH_KEY_RE.test(month)) continue;
    const m = byMonth.get(month) || {
      month, tokens: 0, cost: 0, activeTimeMs: 0,
      perClient: Object.create(null), perModel: Object.create(null)
    };
    m.tokens += num(d.tokens); m.cost += num(d.cost); m.activeTimeMs += num(d.activeTimeMs);
    addUnpricedTokens(m, d);
    addPerClient(m.perClient, d.perClient);
    addPerModel(m.perModel, d.perModel);
    byMonth.set(month, m);
  }
  return [...byMonth.values()]
    .map((m) => ({ ...m, perClient: toPlainSafeObject(m.perClient), perModel: toPlainSafeObject(m.perModel) }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

const DEFAULT_CAP_DAYS = 370;

function rollingDailyWindow(days, todayKey, capDays = DEFAULT_CAP_DAYS) {
  const count = Math.max(0, Math.floor(num(capDays)));
  if (count === 0) return [];
  const startKey = dayKeyAddDays(todayKey, -(count - 1));
  if (!startKey) return [];
  return (Array.isArray(days) ? days : []).filter((d) => {
    if (!isPlainObject(d) || typeof d.date !== 'string') return false;
    const key = d.date.slice(0, 10);
    return key >= startKey && key <= todayKey;
  });
}

function favoriteModelOf(contributions) {
  const totals = Object.create(null);
  for (const d of (Array.isArray(contributions) ? contributions : [])) {
    if (!isPlainObject(d) || !isPlainObject(d.perModel)) continue;
    for (const [model, v] of Object.entries(d.perModel)) {
      if (!isSafeKey(model) || !isPlainObject(v)) continue;
      totals[model] = (hasOwn(totals, model) ? totals[model] : 0) + num(v.tokens);
    }
  }
  let best = '';
  let bestTokens = -1;
  for (const [model, t] of Object.entries(totals)) {
    if (t > bestTokens) { best = model; bestTokens = t; }
  }
  return best;
}

// Three-tier output. The daily tier is capped to capDays (default 370) ending at todayKey;
// monthly and summary are derived from the FULL (uncapped) contribution set, so the cap
// never affects lifetime totals.
function normalizeHistory(graphData, options = {}) {
  const capDays = Number.isFinite(options.capDays) ? options.capDays : DEFAULT_CAP_DAYS;
  const todayKey = String(options.todayKey || localDayKey()).slice(0, 10);
  const full = (graphData && Array.isArray(graphData.contributions) ? graphData.contributions : [])
    .filter((d) => isPlainObject(d) && typeof d.date === 'string' && DAY_KEY_RE.test(d.date.slice(0, 10)))
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
  const dailyTotals = compactDailyTotals(full);

  const daily = rollingDailyWindow(full, todayKey, capDays).map((d) => ({ ...d }));
  computeIntensities(daily);

  const monthly = monthlyRollup(full);
  const totalTokens = full.reduce((s, d) => s + num(d.tokens), 0);
  const totalCost = full.reduce((s, d) => s + num(d.cost), 0);
  const unpricedTokens = full.reduce((s, d) => s + unpricedTokensFor(d), 0);
  const messages = full.reduce((s, d) => s + num(d.messages), 0);
  const activeDays = dailyTotals.reduce((s, d) => s + (num(d.tokens) > 0 ? 1 : 0), 0);
  const peakDayTokens = dailyTotals.reduce((m, d) => Math.max(m, num(d.tokens)), 0);
  const { currentStreak, longestStreak } = computeStreaks(dailyTotals, todayKey);
  const timeMetrics = normalizeTimeMetrics(graphData?.timeMetrics);
  const activeTimeMs = timeMetrics ? timeMetrics.totalActiveTimeMs : activeTimeTotal(dailyTotals);

  return {
    daily,
    dailyTotals,
    monthly,
    summary: {
      totalTokens, totalCost, activeDays, activeDaysComplete: true, currentStreak, longestStreak,
      ...(unpricedTokens > 0 ? { unpricedTokens } : {}),
      peakDayTokens, favoriteModel: favoriteModelOf(full), messages,
      activeTimeMs,
      ...(timeMetrics ? { timeMetrics } : {})
    }
  };
}

function mergeDailyMaps(histories) {
  const byDate = new Map();
  for (const h of histories) {
    for (const d of (h && Array.isArray(h.daily) ? h.daily : [])) {
      if (!isPlainObject(d) || typeof d.date !== 'string') continue;
      const dateKey = d.date.slice(0, 10);
      if (!DAY_KEY_RE.test(dateKey)) continue;
      const cur = byDate.get(dateKey)
        || {
          date: dateKey, tokens: 0, cost: 0, messages: 0, activeTimeMs: 0,
          cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, unclassifiedTokens: 0,
          tokenComponentsAvailable: true,
          perClient: Object.create(null), perModel: Object.create(null)
        };
      cur.tokens += num(d.tokens); cur.cost += num(d.cost); cur.messages += num(d.messages); cur.activeTimeMs += num(d.activeTimeMs);
      addUnpricedTokens(cur, d);
      cur.cacheReadTokens += num(d.cacheReadTokens);
      cur.cacheWriteTokens += num(d.cacheWriteTokens);
      cur.outputTokens += num(d.outputTokens);
      cur.unclassifiedTokens += unclassifiedTokensFor(d);
      cur.tokenComponentsAvailable = cur.tokenComponentsAvailable && d.tokenComponentsAvailable === true;
      addPerClient(cur.perClient, d.perClient, true);
      addPerModel(cur.perModel, d.perModel, true);
      byDate.set(dateKey, cur);
    }
  }
  return [...byDate.values()]
    .map((cur) => ({ ...cur, perClient: toPlainSafeObject(cur.perClient), perModel: toPlainSafeObject(cur.perModel) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function mergeMonthlyMaps(histories) {
  const byMonth = new Map();
  for (const h of histories) {
    for (const m of (h && Array.isArray(h.monthly) ? h.monthly : [])) {
      if (!isPlainObject(m) || typeof m.month !== 'string') continue;
      const monthKey = m.month.slice(0, 7);
      if (!MONTH_KEY_RE.test(monthKey)) continue;
      const cur = byMonth.get(monthKey) || {
        month: monthKey, tokens: 0, cost: 0, activeTimeMs: 0,
        perClient: Object.create(null), perModel: Object.create(null)
      };
      cur.tokens += num(m.tokens); cur.cost += num(m.cost); cur.activeTimeMs += num(m.activeTimeMs);
      addUnpricedTokens(cur, m);
      addPerClient(cur.perClient, m.perClient);
      addPerModel(cur.perModel, m.perModel);
      byMonth.set(monthKey, cur);
    }
  }
  return [...byMonth.values()]
    .map((cur) => ({ ...cur, perClient: toPlainSafeObject(cur.perClient), perModel: toPlainSafeObject(cur.perModel) }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

function mergeDailyTotalMaps(histories) {
  const days = [];
  for (const history of histories) {
    if (!Array.isArray(history?.dailyTotals)) continue;
    for (const day of history.dailyTotals) {
      if (isPlainObject(day)) days.push(day);
    }
  }
  return compactDailyTotals(days);
}

// Combine per-device histories. daily unions by date (sum + recompute intensity); monthly
// unions by month. New devices also provide compact all-time dailyTotals, which lets the
// hub deduplicate dates exactly across devices. Mixed-version aggregates fail closed to
// the rolling daily window instead of treating partial lifetime dates as complete.
function mergeHistories(histories, options = {}) {
  const list = Array.isArray(histories) ? histories : [];
  const todayKey = String(options.todayKey || localDayKey()).slice(0, 10);
  const capDays = Number.isFinite(options.capDays) ? options.capDays : DEFAULT_CAP_DAYS;

  // Re-cap after merging: an offline device's persisted daily tier no longer
  // advances at collection time, but the aggregate must keep a rolling window.
  // Monthly/lifetime data remains durable and uncapped.
  const daily = rollingDailyWindow(mergeDailyMaps(list), todayKey, capDays);
  computeIntensities(daily);
  const monthly = mergeMonthlyMaps(list);
  const activeDaysComplete = list.length > 0 && list.every((history) => (
    Array.isArray(history?.dailyTotals)
    && history?.summary?.activeDaysComplete === true
  ));
  const dailyTotals = activeDaysComplete ? mergeDailyTotalMaps(list) : null;
  const dailyDerived = dailyTotals || daily;

  const totalTokens = monthly.reduce((s, m) => s + num(m.tokens), 0);
  const totalCost = monthly.reduce((s, m) => s + num(m.cost), 0);
  const unpricedTokens = monthly.reduce((s, m) => s + unpricedTokensFor(m), 0);
  const messages = monthly.reduce((s, m) => {
    for (const v of Object.values(m.perClient || {})) s += num(v?.messages);
    return s;
  }, 0);
  const activeDays = dailyDerived.reduce((s, d) => s + (num(d.tokens) > 0 ? 1 : 0), 0);
  const peakDayTokens = dailyDerived.reduce((mx, d) => Math.max(mx, num(d.tokens)), 0);
  const { currentStreak, longestStreak } = computeStreaks(dailyDerived, todayKey);
  const favoriteModel = favoriteModelOf(daily);
  const activeTimeMs = activeTimeTotal(monthly.length ? monthly : daily);

  return {
    daily,
    ...(dailyTotals ? { dailyTotals } : {}),
    monthly,
    summary: {
      totalTokens, totalCost, activeDays, activeDaysComplete, currentStreak, longestStreak,
      ...(unpricedTokens > 0 ? { unpricedTokens } : {}),
      peakDayTokens, favoriteModel, messages, activeTimeMs
    }
  };
}

function sanitizeBreakdownEntry(entry) {
  if (!isPlainObject(entry)) return null;
  const out = {};
  for (const [k, v] of Object.entries(entry)) {
    if (!isSafeKey(k)) continue;
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
  }
  return out;
}

function sanitizeBreakdownMap(rawMap, normalizeKey) {
  if (!isPlainObject(rawMap)) return {};
  const out = {};
  for (const [rawKey, entry] of Object.entries(rawMap)) {
    const key = normalizeKey ? normalizeKey(rawKey) : rawKey;
    if (!isSafeKey(key)) continue;
    const clean = sanitizeBreakdownEntry(entry);
    if (clean) out[key] = clean;
  }
  return out;
}

function sanitizeHistoryRow(row, keyField, keyRe) {
  if (!isPlainObject(row) || typeof row[keyField] !== 'string') return null;
  const key = row[keyField].slice(0, keyField === 'date' ? 10 : 7);
  if (!keyRe.test(key)) return null;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (!isSafeKey(k)) continue;
    if (k === keyField) {
      out[k] = key;
    } else if (k === 'perClient') {
      out.perClient = sanitizeBreakdownMap(v, normalizeTokscaleClientName);
    } else if (k === 'perModel') {
      out.perModel = sanitizeBreakdownMap(v, null);
    } else if (typeof v === 'number' && Number.isFinite(v)) {
      out[k] = v;
    } else if (typeof v === 'boolean') {
      out[k] = v;
    }
  }
  return out;
}

function sanitizeSafePlainObject(rawObj, depth = 0) {
  if (!isPlainObject(rawObj) || depth > 4) return {};
  const out = {};
  for (const [k, v] of Object.entries(rawObj)) {
    if (!isSafeKey(k)) continue;
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean' || typeof v === 'string') out[k] = v;
    else if (isPlainObject(v)) out[k] = sanitizeSafePlainObject(v, depth + 1);
  }
  return out;
}

function sanitizeSummary(rawSummary) {
  if (!isPlainObject(rawSummary)) return {};
  const out = {};
  for (const [k, v] of Object.entries(rawSummary)) {
    if (!isSafeKey(k)) continue;
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string') out[k] = v;
    else if (k === 'timeMetrics' && isPlainObject(v)) {
      const tm = normalizeTimeMetrics(v);
      if (tm) out.timeMetrics = tm;
    } else if (isPlainObject(v)) {
      out[k] = sanitizeSafePlainObject(v, 1);
    }
  }
  return out;
}

// Defensively normalize arbitrary wire JSON to the { daily, monthly, summary } shape.
function coerceHistory(raw) {
  const src = isPlainObject(raw) ? raw : {};
  const daily = Array.isArray(src.daily)
    ? src.daily.map((row) => sanitizeHistoryRow(row, 'date', DAY_KEY_RE)).filter(Boolean)
    : [];
  const monthly = Array.isArray(src.monthly)
    ? src.monthly.map((row) => sanitizeHistoryRow(row, 'month', MONTH_KEY_RE)).filter(Boolean)
    : [];
  const history = {
    daily,
    monthly,
    summary: sanitizeSummary(src.summary)
  };
  if (Array.isArray(src.dailyTotals)) {
    history.dailyTotals = src.dailyTotals
      .map((row) => sanitizeHistoryRow(row, 'date', DAY_KEY_RE))
      .filter(Boolean);
  }
  if (Number.isFinite(src.dailyTotalsOmitted)) history.dailyTotalsOmitted = src.dailyTotalsOmitted;
  return history;
}

// Trim a full History to a compact, per-client-free payload for /api/stats.
function historyPreview(history, options = {}) {
  const dailyDays = Number.isFinite(options.dailyDays) ? options.dailyDays : 30;
  const monthlyMonths = Number.isFinite(options.monthlyMonths) ? options.monthlyMonths : 12;
  const h = coerceHistory(history);
  const missingPrice = (row) => unpricedTokensFor(row) > 0 ? { unpricedTokens: unpricedTokensFor(row) } : {};
  const daily = h.daily.slice(-dailyDays).map((d) => ({ date: d.date, tokens: num(d.tokens), cost: num(d.cost), activeTimeMs: num(d.activeTimeMs), ...missingPrice(d) }));
  const monthly = h.monthly.slice(-monthlyMonths).map((m) => ({ month: m.month, tokens: num(m.tokens), cost: num(m.cost), activeTimeMs: num(m.activeTimeMs), ...missingPrice(m) }));
  return { daily, monthly, summary: h.summary };
}

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const entries = Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`);
  return `{${entries.join(',')}}`;
}

// Compact, deterministic invalidation token for the full history payload. This
// includes daily/monthly breakdowns (not just headline totals), stays portable
// to the Worker runtime, and keeps /api/stats small.
function stableRevision(value) {
  const source = stableJson(value);
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let i = 0; i < source.length; i += 1) {
    const code = source.charCodeAt(i);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
}

function historyRevision(history) {
  return stableRevision(coerceHistory(history));
}

// The aggregate History hash cannot detect attribution-only changes such as two
// devices exchanging otherwise identical daily rows. Keep the public stats
// payload small while ensuring renderer caches follow the per-device source of
// each History record, including explicit missing/unavailable states.
function deviceHistoryRevision(devices) {
  const entries = (Array.isArray(devices) ? devices : [])
    .map((record) => {
      const deviceId = String(record?.deviceId || record?.id || '').trim();
      if (!deviceId) return null;
      const hasHistory = Object.prototype.hasOwnProperty.call(record || {}, 'history');
      const hasAvailability = Object.prototype.hasOwnProperty.call(record || {}, 'historyAvailable');
      return {
        deviceId,
        historyAvailable: hasAvailability ? record.historyAvailable === true : 'missing',
        history: !hasHistory
          ? 'missing'
          : record.history === null
            ? 'unavailable'
            : historyRevision(record.history)
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.deviceId.localeCompare(right.deviceId));
  return stableRevision(entries);
}

module.exports = {
  hasDisjointReasoning, num, normalizeTokscaleClientName, normalizeTokscaleModelNameForClient,
  normalizeTokscaleModelComponentSummary, sumOutputTokens, sumTokens,
  parseGraphResult, computeIntensities, localDayKey, dayKeyAddDays,
  computeStreaks, monthlyRollup, normalizeHistory, mergeHistories, mergeDailyMaps,
  coerceHistory, historyPreview, historyRevision, deviceHistoryRevision
};
