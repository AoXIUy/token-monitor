// @ts-check
'use strict';

const VALID_AUTO_SWITCH_SCOPES = new Set(['primary', 'any', 'all']);
const VALID_SELECTION_MODES = new Set(['auto', 'weighted']);

const DEFAULT_ACCOUNT_WEIGHT = 50;
const MIN_ACCOUNT_WEIGHT = 1;
const MAX_ACCOUNT_WEIGHT = 100;

const DEDICATED_CODENAME_RE = /\b(argon|neon|hydrogen|carbon|helium|wtu)\b/i;
const CLAUDE_3P_RE = /\b(claude|gpt|3p)\b/i;
const WINDOW_5H_RE = /\b(5h|5-hour|five-hour|five hour|session|hour)\b/i;
const WINDOW_WEEKLY_RE = /\b(weekly|7d|week)\b/i;

/** @type {Record<string, number>} */
const TIER_RANK = Object.freeze({
  ULTRA: 4,
  PRO: 3,
  ENTERPRISE: 2,
  FREE: 1,
  UNKNOWN: 0
});

/**
 * Normalize per-account custom weight to an integer in [1, 100].
 * @param {unknown} value
 * @param {number} [fallback]
 * @returns {number}
 */
function normalizeAccountWeight(value, fallback = DEFAULT_ACCOUNT_WEIGHT) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') {
    return fallback;
  }
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(MIN_ACCOUNT_WEIGHT, Math.min(MAX_ACCOUNT_WEIGHT, Math.round(num)));
}

/**
 * Classify a quota group or model name into `'gemini'`, `'claude'`, or `'other'`.
 * Dedicated Gemini 4 codename pools (e.g. Argon) map to `'other'` so `'primary'`
 * scope focuses on general Gemini and Claude/GPT pools.
 *
 * @param {string} label
 * @param {string} [extraText]
 * @returns {'gemini' | 'claude' | 'other'}
 */
function classifyQuotaGroupFamily(label, extraText = '') {
  const combined = `${label || ''} ${extraText || ''}`.toLowerCase();
  if (DEDICATED_CODENAME_RE.test(combined)) return 'other';
  if (CLAUDE_3P_RE.test(combined)) return 'claude';
  if (combined.includes('gemini')) return 'gemini';
  return 'other';
}

/**
 * Classify a normalized LimitsRuntime window into `'5h'` or `'weekly'`.
 * @param {Record<string, any>} win
 * @returns {'5h' | 'weekly' | null}
 */
function classifyLimitWindowPeriod(win) {
  if (!win || typeof win !== 'object') return null;
  if (win.kind === 'session' || win.windowMinutes === 300) return '5h';
  if (win.kind === 'weekly' || win.windowMinutes === 10_080) return 'weekly';
  const label = String(win.label || '').trim();
  if (WINDOW_5H_RE.test(label)) return '5h';
  if (WINDOW_WEEKLY_RE.test(label)) return 'weekly';
  return null;
}

/**
 * Derive a stable group name from a normalized limit window label (e.g. `"Gemini 5-hour"` -> `"Gemini"`).
 * @param {Record<string, any>} win
 * @returns {string}
 */
function extractLimitWindowGroupName(win) {
  const raw = String(win?.label || '').trim();
  if (!raw) return 'Quota';
  return raw.replace(/\s+(?:5-hour|5h|five-hour|session|weekly|7d)$/i, '').trim() || raw;
}

/**
 * Map a local RPC `sourceDetail` (`'app' | 'cli' | 'ide'`) to a switcher target client
 * when the user's configured `defaultSwitchTarget` is `'auto'`.
 *
 * Note: `probe.js` labels standard `Antigravity.exe` builds whose language server lives under
 * `resources/app/extensions/antigravity/bin/language_server*` as `sourceDetail = 'ide'`, whereas
 * `switcher.js` reserves `'ide'` strictly for the separate `Antigravity IDE` product and uses
 * `'classic'` for standard `Antigravity`. Returning `'auto'` for desktop/IDE sources lets
 * `switcher.switchAccount` inspect actual running processes via `processManager`.
 *
 * @param {string | undefined | null} defaultSwitchTarget
 * @param {string | undefined | null} sourceDetail
 * @param {{ classicRunning?: boolean, ideRunning?: boolean } | null} [activeClients]
 * @returns {'auto' | 'classic' | 'ide' | 'agy' | 'acp'}
 */
function resolveSwitchTargetForTrigger(defaultSwitchTarget, sourceDetail, activeClients = null) {
  const configured = String(defaultSwitchTarget || 'auto').trim().toLowerCase();
  if (configured === 'classic' || configured === 'ide' || configured === 'agy' || configured === 'acp') {
    return configured;
  }
  const detail = String(sourceDetail || '').trim().toLowerCase();
  if (detail === 'cli') {
    if (activeClients && (activeClients.classicRunning || activeClients.ideRunning)) {
      return 'auto';
    }
    return 'agy';
  }
  return 'auto';
}

/**
 * Evaluate whether local Antigravity RPC quota limits have hit the 5-hour or weekly threshold.
 * Strictly inspects `provider === 'antigravity' && source === 'rpc' && status === 'ok'` rows.
 *
 * @param {unknown} limitsPayload
 * @param {{
 *   autoSwitchScope?: string,
 *   autoSwitchThresholdPercent?: number
 * }} [rawConfig]
 */
function evaluateLocalQuotaTrigger(limitsPayload, rawConfig = {}) {
  const empty = {
    triggered: false,
    accountKey: '',
    accountEmail: '',
    sourceDetail: '',
    exhaustedWindows: /** @type {Array<{ label: string, period: '5h' | 'weekly', groupName: string, family: 'gemini' | 'claude' | 'other', remainingPercent: number, resetsAt: string | null }>} */ ([]),
    exhaustedFamilies: /** @type {Array<'gemini' | 'claude' | 'other'>} */ ([]),
    hardExhausted: false,
    triggerLabel: ''
  };

  const providers = Array.isArray(limitsPayload)
    ? limitsPayload
    : (limitsPayload && typeof limitsPayload === 'object' && Array.isArray(/** @type {any} */ (limitsPayload).providers)
        ? /** @type {any} */ (limitsPayload).providers
        : []);
  if (providers.length === 0) return empty;

  const scope = VALID_AUTO_SWITCH_SCOPES.has(String(rawConfig?.autoSwitchScope || ''))
    ? /** @type {'primary' | 'any' | 'all'} */ (rawConfig.autoSwitchScope)
    : 'primary';
  const rawThreshold = Number(rawConfig?.autoSwitchThresholdPercent);
  const threshold = Number.isFinite(rawThreshold) ? Math.max(0, Math.min(50, Math.round(rawThreshold))) : 0;
  const thresholdLimit = threshold + 1e-6;

  for (const row of providers) {
    if (!row || typeof row !== 'object') continue;
    if (row.provider !== 'antigravity' || row.source !== 'rpc' || row.status !== 'ok') continue;
    if (!Array.isArray(row.windows) || row.windows.length === 0) continue;

    /** @type {Array<{ label: string, period: '5h' | 'weekly', groupName: string, family: 'gemini' | 'claude' | 'other', remainingPercent: number, resetsAt: string | null }>} */
    const meteredWindows = [];
    for (const win of row.windows) {
      if (!win || win.showMeter === false) continue;
      if (typeof win.usedPercent !== 'number' || !Number.isFinite(win.usedPercent)) continue;
      const period = classifyLimitWindowPeriod(win);
      if (!period) continue;
      const groupName = extractLimitWindowGroupName(win);
      const family = classifyQuotaGroupFamily(groupName);
      const remainingPercent = Math.max(0, Math.min(100, 100 - win.usedPercent));
      meteredWindows.push({
        label: String(win.label || `${groupName} ${period}`),
        period,
        groupName,
        family,
        remainingPercent,
        resetsAt: typeof win.resetsAt === 'string' && win.resetsAt ? win.resetsAt : null
      });
    }
    if (meteredWindows.length === 0) continue;

    /** @type {typeof meteredWindows} */
    let exhaustedWindows = [];

    if (scope === 'primary') {
      const primaryWindows = meteredWindows.filter((w) => w.family === 'gemini' || w.family === 'claude');
      const candidates = primaryWindows.length > 0 ? primaryWindows : meteredWindows;
      exhaustedWindows = candidates.filter((w) => w.remainingPercent <= thresholdLimit);
    } else if (scope === 'any') {
      exhaustedWindows = meteredWindows.filter((w) => w.remainingPercent <= thresholdLimit);
    } else {
      /** @type {Map<string, typeof meteredWindows>} */
      const byGroup = new Map();
      for (const win of meteredWindows) {
        const key = win.groupName.toLowerCase();
        const list = byGroup.get(key) || [];
        list.push(win);
        byGroup.set(key, list);
      }
      const allGroupsExhausted = byGroup.size > 0
        && [...byGroup.values()].every((groupWins) => groupWins.some((w) => w.remainingPercent <= thresholdLimit));
      if (allGroupsExhausted) {
        exhaustedWindows = meteredWindows.filter((w) => w.remainingPercent <= thresholdLimit);
      }
    }

    if (exhaustedWindows.length > 0) {
      const exhaustedFamilies = [...new Set(exhaustedWindows.map((w) => w.family))];
      const hardExhausted = exhaustedWindows.some((w) => w.remainingPercent <= 1e-6);
      return {
        triggered: true,
        accountKey: String(row.accountKey || '').trim(),
        accountEmail: String(row.accountEmail || '').trim().toLowerCase(),
        sourceDetail: String(row.sourceDetail || '').trim().toLowerCase(),
        exhaustedWindows,
        exhaustedFamilies,
        hardExhausted,
        triggerLabel: exhaustedWindows.map((w) => w.label).join(', ')
      };
    }
  }

  return empty;
}

/**
 * Summarize an Antigravity Manager pool account's group/model remaining percentages.
 * @param {Record<string, any>} account
 * @returns {{
 *   hasQuotaData: boolean,
 *   entries: Array<{ name: string, family: 'gemini' | 'claude' | 'other', minPercent: number }>
 * }}
 */
function summarizePoolAccountQuota(account) {
  const groups = Array.isArray(account?.quota?.groups) ? account.quota.groups : [];
  const models = Array.isArray(account?.quota?.models) ? account.quota.models : [];

  if (groups.length > 0) {
    /** @type {Array<{ name: string, family: 'gemini' | 'claude' | 'other', minPercent: number }>} */
    const entries = [];
    for (const group of groups) {
      const buckets = Array.isArray(group?.buckets) ? group.buckets : [];
      const activeBuckets = buckets.filter((/** @type {any} */ b) => (
        b && b.disabled !== true && typeof b.remainingFraction === 'number' && Number.isFinite(b.remainingFraction)
      ));
      if (activeBuckets.length === 0) continue;
      const relevantBuckets = activeBuckets.filter((/** @type {any} */ b) => {
        const text = `${b?.window || ''} ${b?.bucketId || ''}`;
        return WINDOW_5H_RE.test(text) || WINDOW_WEEKLY_RE.test(text);
      });
      const targetBuckets = relevantBuckets.length > 0 ? relevantBuckets : activeBuckets;
      const fractions = targetBuckets
        .map((/** @type {any} */ b) => Number(b?.remainingFraction))
        .filter((/** @type {number} */ n) => Number.isFinite(n));
      if (fractions.length === 0) continue;
      const minPct = Math.max(0, Math.min(100, Math.min(...fractions) * 100));
      const extraText = activeBuckets.map((/** @type {any} */ b) => `${b?.bucketId || ''} ${b?.displayName || ''}`).join(' ');
      const name = String(group?.displayName || 'Quota');
      entries.push({
        name,
        family: classifyQuotaGroupFamily(name, extraText),
        minPercent: minPct
      });
    }
    if (entries.length > 0) {
      return { hasQuotaData: true, entries };
    }
  }

  if (models.length > 0) {
    /** @type {Array<{ name: string, family: 'gemini' | 'claude' | 'other', minPercent: number }>} */
    const entries = models.map((/** @type {any} */ m) => {
      const name = String(m?.name || m?.displayName || 'Model');
      const pct = Number(m?.percentage);
      return {
        name,
        family: classifyQuotaGroupFamily(name, String(m?.displayName || '')),
        minPercent: Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0
      };
    });
    return { hasQuotaData: true, entries };
  }

  return { hasQuotaData: false, entries: [] };
}

/**
 * Determine whether a candidate pool account is already exhausted under the configured scope/threshold
 * or in the specific quota family that triggered the switch.
 *
 * @param {Record<string, any>} account
 * @param {{
 *   scope?: 'primary' | 'any' | 'all' | string,
 *   thresholdPercent?: number,
 *   preferredFamilies?: Array<'gemini' | 'claude' | 'other'>,
 *   requireVerifiedQuota?: boolean
 * }} [options]
 * @returns {boolean}
 */
function isPoolAccountExhausted(account, options = {}) {
  const { hasQuotaData, entries } = summarizePoolAccountQuota(account);
  if (!hasQuotaData) {
    return options.requireVerifiedQuota === true;
  }

  const rawThreshold = Number(options.thresholdPercent);
  const threshold = Number.isFinite(rawThreshold) ? Math.max(0, Math.min(50, Math.round(rawThreshold))) : 0;
  const thresholdLimit = threshold + 1e-6;
  const scope = VALID_AUTO_SWITCH_SCOPES.has(String(options.scope || ''))
    ? /** @type {'primary' | 'any' | 'all'} */ (options.scope)
    : 'primary';

  const preferred = Array.isArray(options.preferredFamilies) ? options.preferredFamilies : [];
  for (const fam of preferred) {
    const famEntries = entries.filter((e) => e.family === fam);
    if (famEntries.length > 0 && famEntries.every((e) => e.minPercent <= thresholdLimit)) {
      return true;
    }
  }

  if (scope === 'any') {
    return entries.some((e) => e.minPercent <= thresholdLimit);
  }
  if (scope === 'all') {
    return entries.every((e) => e.minPercent <= thresholdLimit);
  }

  const primaryEntries = entries.filter((e) => e.family === 'gemini' || e.family === 'claude');
  const target = primaryEntries.length > 0 ? primaryEntries : entries;
  if (Array.isArray(account?.quota?.groups) && account.quota.groups.length > 0) {
    return target.some((e) => e.minPercent <= thresholdLimit);
  }
  // Model-only fallback: treat account as exhausted only when all target models are depleted.
  return target.every((e) => e.minPercent <= thresholdLimit);
}

/**
 * Score a candidate account's remaining quota availability (0..100).
 * When `preferredFamilies` is provided (e.g. Claude hit limit), weights that family at 65%
 * and overall average at 35%; otherwise returns overall average matching `pickBestAccount`.
 *
 * @param {Record<string, any>} account
 * @param {{ preferredFamilies?: Array<'gemini' | 'claude' | 'other'> }} [options]
 * @returns {number}
 */
function scoreCandidateAccount(account, options = {}) {
  const { hasQuotaData, entries } = summarizePoolAccountQuota(account);
  if (!hasQuotaData || entries.length === 0) return 0;

  const overallAvg = entries.reduce((sum, item) => sum + item.minPercent, 0) / entries.length;
  const preferred = Array.isArray(options.preferredFamilies) ? options.preferredFamilies.filter(Boolean) : [];
  if (preferred.length === 0) {
    return overallAvg;
  }

  const matched = entries.filter((item) => preferred.includes(item.family));
  if (matched.length === 0) {
    return overallAvg;
  }
  const preferredAvg = matched.reduce((sum, item) => sum + item.minPercent, 0) / matched.length;
  return preferredAvg * 0.65 + overallAvg * 0.35;
}

/**
 * Select the best eligible replacement account from the AGY pool.
 * Supports `'auto'` (pure quota + tier) and `'weighted'` (custom weight priority -> quota -> tier).
 *
 * @param {Array<Record<string, any>>} accounts
 * @param {{
 *   selectionMode?: 'auto' | 'weighted' | string,
 *   thresholdPercent?: number,
 *   scope?: 'primary' | 'any' | 'all' | string,
 *   excludeIds?: Iterable<string>,
 *   excludeEmails?: Iterable<string>,
 *   excludeAccountKeys?: Iterable<string>,
 *   preferredFamilies?: Array<'gemini' | 'claude' | 'other'>,
 *   requireVerifiedQuota?: boolean,
 *   skipExhaustedCheck?: boolean
 * }} [options]
 * @returns {Record<string, any> | null}
 */
function selectReplacementAccount(accounts, options = {}) {
  const list = Array.isArray(accounts) ? accounts : [];
  const excludedIds = new Set(Array.from(options.excludeIds || [], (v) => String(v || '').trim()).filter(Boolean));
  const excludedEmails = new Set(Array.from(options.excludeEmails || [], (v) => String(v || '').trim().toLowerCase()).filter(Boolean));
  const excludedKeys = new Set(Array.from(options.excludeAccountKeys || [], (v) => String(v || '').trim()).filter(Boolean));
  const selectionMode = VALID_SELECTION_MODES.has(String(options.selectionMode || ''))
    ? /** @type {'auto' | 'weighted'} */ (options.selectionMode)
    : 'auto';

  const baseEligible = list.filter((acc) => {
    if (!acc || acc.hasToken === false || acc.disabled || acc.banned || acc.validationBlocked || acc.quota?.isForbidden) {
      return false;
    }
    const id = String(acc.id || '').trim();
    const email = String(acc.email || '').trim().toLowerCase();
    const key = String(acc.accountKey || '').trim();
    if (id && excludedIds.has(id)) return false;
    if (email && excludedEmails.has(email)) return false;
    if (key && excludedKeys.has(key)) return false;
    return true;
  });

  if (baseEligible.length === 0) return null;

  let candidates = options.skipExhaustedCheck
    ? baseEligible
    : baseEligible.filter((acc) => !isPoolAccountExhausted(acc, {
        scope: options.scope,
        thresholdPercent: options.thresholdPercent,
        preferredFamilies: options.preferredFamilies,
        requireVerifiedQuota: options.requireVerifiedQuota
      }));

  // If preferredFamilies filtered out every otherwise-unexhausted account (e.g. a pool account lacks that family),
  // retry with scope-only exhaustion check unless requireVerifiedQuota rejected all exhausted accounts.
  if (
    candidates.length === 0
    && !options.skipExhaustedCheck
    && Array.isArray(options.preferredFamilies)
    && options.preferredFamilies.length > 0
  ) {
    candidates = baseEligible.filter((acc) => !isPoolAccountExhausted(acc, {
      scope: options.scope,
      thresholdPercent: options.thresholdPercent,
      preferredFamilies: [],
      requireVerifiedQuota: options.requireVerifiedQuota
    }));
  }

  if (candidates.length === 0) return null;

  return [...candidates].sort((a, b) => {
    if (selectionMode === 'weighted') {
      const weightDiff = normalizeAccountWeight(b.weight) - normalizeAccountWeight(a.weight);
      if (weightDiff !== 0) return weightDiff;
    }
    const scoreDiff = scoreCandidateAccount(b, options) - scoreCandidateAccount(a, options);
    if (Math.abs(scoreDiff) > 0.01) return scoreDiff;
    const tierDiff = (TIER_RANK[b.subscriptionTier] || 0) - (TIER_RANK[a.subscriptionTier] || 0);
    if (tierDiff !== 0) return tierDiff;
    return Number(a.lastUsedAt || 0) - Number(b.lastUsedAt || 0);
  })[0] || null;
}

module.exports = {
  DEFAULT_ACCOUNT_WEIGHT,
  MAX_ACCOUNT_WEIGHT,
  MIN_ACCOUNT_WEIGHT,
  VALID_AUTO_SWITCH_SCOPES,
  VALID_SELECTION_MODES,
  classifyLimitWindowPeriod,
  classifyQuotaGroupFamily,
  evaluateLocalQuotaTrigger,
  isPoolAccountExhausted,
  normalizeAccountWeight,
  resolveSwitchTargetForTrigger,
  scoreCandidateAccount,
  selectReplacementAccount,
  summarizePoolAccountQuota
};
