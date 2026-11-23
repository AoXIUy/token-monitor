// @ts-check
'use strict';

const { ensureFreshToken } = require('./oauth');
const { normalizeSubscriptionTier } = require('../../shared/antigravityManagerProtocol');

const KNOWN_STABLE_VERSION = '4.3.0';

const CLOUD_CODE_LOAD_PROJECT_ENDPOINTS = Object.freeze([
  'https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist',
  'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:loadCodeAssist',
  'https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist'
]);

// Prod returns inconsistent Gemini quota for the same account; keep Daily -> Sandbox only.
const QUOTA_API_ENDPOINTS = Object.freeze([
  'https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels',
  'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:fetchAvailableModels'
]);

const QUOTA_SUMMARY_ENDPOINTS = Object.freeze([
  'https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary',
  'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:retrieveUserQuotaSummary'
]);

const BAN_REASON_CODES = Object.freeze([
  'tos_violation',
  'terms_of_service_violation',
  'policy_violation',
  'abuse_detected',
  'account_suspended',
  'account_banned',
  'user_disabled',
  'account_disabled'
]);

const BAN_PHRASES = Object.freeze([
  'violation of terms of service',
  'violation of the terms of service',
  'service has been disabled in this account',
  'account has been suspended',
  'account is suspended',
  'account has been disabled'
]);

const GENERIC_GEMINI_ROLE_TOKENS = new Set([
  'pro', 'flash', 'lite', 'ultra', 'high', 'medium', 'low', 'xhigh',
  'image', 'exp', 'preview', 'disabled', 'thinking', 'tiered', 'models',
  'model', 'wtu', 'weekly', '5h', '7d', 'hour', 'quota', 'pool', 'default', 'standard'
]);

/**
 * @param {NodeJS.Platform} [platform]
 * @param {string} [arch]
 */
function defaultEgressUserAgent(platform = process.platform, arch = process.arch) {
  const osPart = platform === 'win32' ? 'windows' : platform;
  const archPart = arch === 'x64' ? 'amd64' : arch;
  return `antigravity/${KNOWN_STABLE_VERSION} ${osPart}/${archPart}`;
}

/**
 * Isolated 60s endpoint health tracker matching Antigravity-Manager quota.rs.
 */
class EndpointHealthTracker {
  /**
   * @param {number} [cooldownMs]
   * @param {() => number} [nowMs]
   */
  constructor(cooldownMs = 60_000, nowMs = Date.now) {
    this.cooldownMs = cooldownMs;
    this.nowMs = nowMs;
    /** @type {Map<string, number>} */
    this.failedAt = new Map();
  }

  /**
   * @param {string} url
   */
  markFailure(url) {
    this.failedAt.set(url, this.nowMs());
  }

  /**
   * @param {string} url
   */
  markSuccess(url) {
    this.failedAt.delete(url);
  }

  /**
   * @param {readonly string[]} endpoints
   * @returns {string[]}
   */
  getOrderedEndpoints(endpoints) {
    const now = this.nowMs();
    /** @type {string[]} */
    const healthy = [];
    /** @type {string[]} */
    const cooling = [];
    for (const url of endpoints) {
      const failedTime = this.failedAt.get(url);
      if (failedTime !== undefined && now - failedTime < this.cooldownMs) {
        cooling.push(url);
      } else {
        if (failedTime !== undefined) this.failedAt.delete(url);
        healthy.push(url);
      }
    }
    return [...healthy, ...cooling];
  }
}

/**
 * @param {number} status
 * @param {string} url
 */
function shouldTryNextEndpointForUrl(status, url) {
  if (status === 403 || status === 401) return false;
  if (status === 404 || status === 408 || status === 429 || status >= 500) return true;
  if (url.includes('sandbox') && status >= 400) return true;
  return false;
}

/**
 * Classify 403 body into validation, model-scoped, or high-confidence account ban.
 * Never classifies 429/5xx/network errors as banned.
 * @param {number} status
 * @param {string} bodyText
 */
function classify403Response(status, bodyText) {
  if (status !== 403) return { kind: 'other' };
  const text = String(bodyText || '');
  const lower = text.toLowerCase();

  if (lower.includes('validation_required') || lower.includes('verify your account') || lower.includes('validation_url')) {
    return {
      kind: 'validationRequired',
      message: 'Google requires account verification. Open Antigravity and complete verification, then refresh.'
    };
  }

  // Model-scoped 403 (e.g. model unavailable/forbidden for tier)
  const modelScopeMatch = lower.match(/\b(claude[a-z0-9._-]*|gemini-[a-z0-9._-]+|gpt-[a-z0-9._-]+)\b/);
  if (modelScopeMatch && !BAN_REASON_CODES.some((c) => lower.includes(c)) && !BAN_PHRASES.some((p) => lower.includes(p))) {
    return {
      kind: 'modelForbidden',
      modelScope: modelScopeMatch[1]
    };
  }

  const reasonCode = BAN_REASON_CODES.find((code) => lower.includes(code)) || '';
  const hasPhrase = BAN_PHRASES.some((phrase) => lower.includes(phrase));
  if (reasonCode || hasPhrase) {
    let message = '';
    try {
      const parsed = JSON.parse(text);
      message = String(parsed?.error?.message || parsed?.message || '');
      if (typeof parsed?.error === 'string') {
        try {
          const inner = JSON.parse(parsed.error);
          message = String(inner?.error?.message || inner?.message || message);
        } catch (_) {}
      }
    } catch (_) {}
    const urls = text.match(/https?:\/\/[^\s"'<>]+/g) || [];
    const appealUrl = urls.find((u) => /appeal|support\.google\.com/i.test(u)) || '';
    return {
      kind: 'banned',
      banInfo: {
        code: reasonCode ? reasonCode.toUpperCase() : 'ACCOUNT_BANNED',
        message: message || text.slice(0, 800) || 'Upstream account ban detected',
        appealUrl
      }
    };
  }

  return { kind: 'forbidden', message: text.slice(0, 512) };
}

/**
 * @param {string} modelName
 * @returns {string}
 */
function stripTierSuffix(modelName) {
  return modelName.replace(/-(high|medium|low|xhigh|minimal)$/i, '');
}

/**
 * Extract Gemini 4+ codename (e.g., "argon", "hydrogen", "carbon", "helium").
 * Skips pure numeric segments and generic role tokens.
 * @param {string} modelName
 * @returns {string | null}
 */
function extractGemini4Codename(modelName) {
  const lower = String(modelName || '').trim().toLowerCase();
  const stripped = stripTierSuffix(lower);
  if (stripped.startsWith('gemini-')) {
    const afterGemini = stripped.slice('gemini-'.length);
    const dashIdx = afterGemini.indexOf('-');
    if (dashIdx > 0) {
      const verPart = afterGemini.slice(0, dashIdx);
      const rest = afterGemini.slice(dashIdx + 1);
      const major = Number.parseInt(verPart.split('.')[0], 10);
      if (Number.isFinite(major) && major >= 4) {
        const code = (rest.split('-')[0] || '').trim();
        if (code && /[a-z]/.test(code) && !GENERIC_GEMINI_ROLE_TOKENS.has(code)) {
          return code;
        }
      }
    }
  }
  if (lower.includes('argon') || stripped === 'gemini-pro-orchestrator-g1-pro') {
    return 'argon';
  }
  return null;
}

/**
 * @param {string} displayNameLower
 * @param {string} bucketIdLower
 * @param {string[]} knownCodenames
 * @returns {string | null}
 */
function extractGroupG4Codename(displayNameLower, bucketIdLower, knownCodenames = []) {
  if (displayNameLower.includes('argon') || bucketIdLower.includes('argon')) return 'argon';
  for (const text of [displayNameLower, bucketIdLower]) {
    const normalized = text.replace(/[_ ]+/g, '-');
    const parts = normalized.split('-').filter(Boolean);
    for (let i = 0; i + 2 < parts.length; i += 1) {
      if (parts[i] === 'gemini') {
        const major = Number.parseInt(parts[i + 1].split('.')[0], 10);
        if (Number.isFinite(major) && major >= 4 && /[a-z]/.test(parts[i + 2]) && !GENERIC_GEMINI_ROLE_TOKENS.has(parts[i + 2])) {
          return parts[i + 2];
        }
        if (parts[i + 2] === 'wtu' && /[a-z]/.test(parts[i + 1]) && !GENERIC_GEMINI_ROLE_TOKENS.has(parts[i + 1])) {
          return parts[i + 1];
        }
      }
    }
    for (const code of knownCodenames) {
      if (code && parts.includes(code)) return code;
    }
  }
  return null;
}

/**
 * @param {any} group
 * @param {string} code
 */
function groupMatchesCodename(group, code) {
  const gname = String(group?.displayName || '').toLowerCase();
  if (gname.includes(code)) return true;
  return (group?.buckets || []).some((/** @type {any} */ b) => {
    const bid = String(b?.bucketId || '').toLowerCase();
    const bname = String(b?.displayName || '').toLowerCase();
    return bid.includes(code) || bname.includes(code);
  });
}

/**
 * @param {any} group
 */
function isClaudeOr3pGroup(group) {
  const gname = String(group?.displayName || '').toLowerCase();
  return gname.includes('claude') || gname.includes('gpt') || gname.includes('3p');
}

/**
 * @param {any} group
 * @param {string[]} knownCodenames
 */
function isDedicatedG4Group(group, knownCodenames) {
  const gname = String(group?.displayName || '').toLowerCase();
  if (extractGroupG4Codename(gname, '', knownCodenames)) return true;
  return (group?.buckets || []).some((/** @type {any} */ b) => (
    Boolean(extractGroupG4Codename(String(b?.displayName || '').toLowerCase(), String(b?.bucketId || '').toLowerCase(), knownCodenames))
  ));
}

/**
 * @param {any[]} groups
 * @param {string[]} knownCodenames
 */
function findGeneralGeminiGroup(groups, knownCodenames) {
  return groups.find((g) => (
    !isDedicatedG4Group(g, knownCodenames)
    && !isClaudeOr3pGroup(g)
    && (String(g.displayName || '').toLowerCase().includes('gemini')
      || (g.buckets || []).some((/** @type {any} */ b) => String(b.bucketId || '').toLowerCase().includes('gemini')))
  )) || groups.find((g) => !isDedicatedG4Group(g, knownCodenames) && !isClaudeOr3pGroup(g)) || null;
}

/**
 * @param {any[]} groups
 * @param {string} nameLower
 * @param {boolean} isUltra
 * @param {string[]} knownCodenames
 */
function matchQuotaGroupForModel(groups, nameLower, isUltra, knownCodenames) {
  const g4Codename = extractGemini4Codename(nameLower);
  const isArgon = g4Codename === 'argon';
  const isClaudeOrGpt = !g4Codename && (nameLower.startsWith('claude') || nameLower.startsWith('gpt'));

  if (isClaudeOrGpt) {
    const matched = groups.find((g) => !isDedicatedG4Group(g, knownCodenames) && isClaudeOr3pGroup(g));
    return matched ? { kind: 'matched', group: matched } : { kind: 'none' };
  }

  if (g4Codename) {
    const specific = groups.find((g) => groupMatchesCodename(g, g4Codename));
    if (specific) return { kind: 'matched', group: specific };
    if (isArgon && !isUltra) return { kind: 'skipUnauthorized' };
    const general = findGeneralGeminiGroup(groups, knownCodenames);
    if (!general) return isArgon ? { kind: 'skipUnauthorized' } : { kind: 'none' };
    return { kind: 'matched', group: general };
  }

  const general = findGeneralGeminiGroup(groups, knownCodenames);
  return general ? { kind: 'matched', group: general } : { kind: 'none' };
}

/**
 * @param {string} name
 */
function isModelCompliantWithBaseline(name) {
  const m = String(name || '').trim().toLowerCase();
  if (!m) return false;
  if (
    m.includes('-disabled')
    || m.endsWith('_disabled')
    || m.startsWith('chat_')
    || m.startsWith('tab_')
    || m.includes('internal')
    || m.includes('-exp')
    || m.endsWith('-agent')
    || m === 'gemini-3-flash'
    || m === 'gemini-flash-worker-agy'
  ) {
    return false;
  }
  if (m.startsWith('gemini-')) {
    const verMatch = m.slice('gemini-'.length).match(/^(\d+)(?:\.(\d+))?/);
    if (verMatch) {
      const major = Number.parseInt(verMatch[1], 10);
      if (major < 3) return false;
    }
  }
  return true;
}

/**
 * Proto3 JSON omits 0 remainingFraction when resetTime is present -> treat as 0%.
 * @param {any} quotaInfo
 * @returns {number | null}
 */
function modelQuotaPercentage(quotaInfo) {
  if (!quotaInfo || typeof quotaInfo !== 'object') return null;
  if (typeof quotaInfo.remainingFraction === 'number' && Number.isFinite(quotaInfo.remainingFraction)) {
    return Math.max(0, Math.min(100, Math.round(quotaInfo.remainingFraction * 100)));
  }
  if (typeof quotaInfo.resetTime === 'string' && quotaInfo.resetTime.trim()) {
    return 0;
  }
  return null;
}

/**
 * @param {any[]} buckets
 */
function pickMostRestrictiveBucket(buckets) {
  if (!Array.isArray(buckets) || buckets.length === 0) return null;
  const bucket5h = buckets.find((b) => {
    const w = String(b.window || '').toLowerCase();
    const bid = String(b.bucketId || '').toLowerCase();
    return w.includes('5h') || bid.includes('5h') || w.includes('hour') || bid.includes('hour');
  });
  const bucketWeekly = buckets.find((b) => {
    const w = String(b.window || '').toLowerCase();
    const bid = String(b.bucketId || '').toLowerCase();
    return w.includes('week') || bid.includes('week') || w.includes('7d') || bid.includes('7d');
  });
  if (bucket5h && bucketWeekly) {
    if (bucketWeekly.remainingFraction <= 0.001) return bucketWeekly;
    if (bucket5h.remainingFraction < bucketWeekly.remainingFraction) return bucket5h;
    if (bucketWeekly.remainingFraction < bucket5h.remainingFraction) return bucketWeekly;
    return bucketWeekly.resetTime ? bucketWeekly : bucket5h;
  }
  return bucket5h || bucketWeekly || buckets[0];
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function parseRemainingFraction(value) {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : null;
}

/**
 * @param {unknown} error
 * @param {AbortSignal | undefined} signal
 */
function isAbortError(error, signal) {
  return Boolean(signal?.aborted) || (error instanceof Error && error.name === 'AbortError');
}

/**
 * @param {string} accessToken
 * @param {{ fetch?: typeof fetch, healthTracker?: EndpointHealthTracker, signal?: AbortSignal, userAgent?: string }} deps
 */
async function fetchProjectAndTier(accessToken, deps) {
  const fetchFn = deps.fetch || fetch;
  const tracker = deps.healthTracker || new EndpointHealthTracker();
  const ua = deps.userAgent || defaultEgressUserAgent();
  const endpoints = tracker.getOrderedEndpoints(CLOUD_CODE_LOAD_PROJECT_ENDPOINTS);

  for (const url of endpoints) {
    try {
      const response = await fetchFn(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
          'user-agent': ua
        },
        body: JSON.stringify({ metadata: { ideType: 'ANTIGRAVITY' } }),
        signal: deps.signal
      });
      if (response.ok) {
        tracker.markSuccess(url);
        const data = await response.json().catch(() => ({}));
        const projectId = typeof data?.cloudaicompanionProject === 'string'
          ? data.cloudaicompanionProject.trim()
          : '';
        const allowedDefault = Array.isArray(data?.allowedTiers)
          ? data.allowedTiers.find((/** @type {any} */ t) => t?.id === 'free-tier' || t?.isDefault === true)
          : null;
        const rawTier = String(
          data?.paidTier?.id || data?.paidTier?.name
          || data?.currentTier?.id || data?.currentTier?.name
          || allowedDefault?.id || allowedDefault?.name
          || 'free-tier'
        ).trim();
        return {
          projectId,
          rawTier,
          subscriptionTier: normalizeSubscriptionTier(rawTier)
        };
      }
      if (shouldTryNextEndpointForUrl(response.status, url)) {
        tracker.markFailure(url);
      } else {
        break;
      }
    } catch (error) {
      if (isAbortError(error, deps.signal)) throw error;
      tracker.markFailure(url);
    }
  }
  return { projectId: '', rawTier: '', subscriptionTier: '' };
}

/**
 * @param {string} accessToken
 * @param {string} projectId
 * @param {{ fetch?: typeof fetch, healthTracker?: EndpointHealthTracker, signal?: AbortSignal, userAgent?: string }} deps
 */
async function fetchQuotaSummary(accessToken, projectId, deps) {
  const fetchFn = deps.fetch || fetch;
  const tracker = deps.healthTracker || new EndpointHealthTracker();
  const ua = deps.userAgent || defaultEgressUserAgent();
  const endpoints = tracker.getOrderedEndpoints(QUOTA_SUMMARY_ENDPOINTS);
  const body = JSON.stringify(projectId ? { project: projectId } : {});

  for (const url of endpoints) {
    try {
      const response = await fetchFn(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
          'user-agent': ua
        },
        body,
        signal: deps.signal
      });
      if (!response.ok) {
        if (shouldTryNextEndpointForUrl(response.status, url)) {
          tracker.markFailure(url);
          continue;
        }
        break;
      }
      tracker.markSuccess(url);
      const data = await response.json().catch(() => null);
      if (!Array.isArray(data?.groups)) return null;
      return data.groups.map((/** @type {any} */ g) => ({
        displayName: String(g?.displayName || ''),
        description: g?.description ? String(g.description) : '',
        buckets: (Array.isArray(g?.buckets) ? g.buckets : []).flatMap((/** @type {any} */ b) => {
          const resetTime = String(b?.resetTime || '').trim();
          let rf = parseRemainingFraction(b?.remainingFraction);
          if (rf === null && (b?.remainingFraction === undefined || b?.remainingFraction === null) && resetTime) {
            // Proto3 JSON omits 0 remainingFraction on depleted buckets when resetTime is present.
            rf = 0;
          }
          if (rf === null) return [];
          return [{
            bucketId: String(b?.bucketId || ''),
            window: String(b?.window || ''),
            remainingFraction: rf,
            resetTime,
            displayName: b?.displayName ? String(b.displayName) : '',
            description: b?.description ? String(b.description) : ''
          }];
        })
      }));
    } catch (error) {
      if (isAbortError(error, deps.signal)) throw error;
      tracker.markFailure(url);
    }
  }
  return null;
}

/**
 * Fetch complete quota snapshot for a single account.
 * @param {Record<string, any>} account
 * @param {Record<string, any>} tokenData
 * @param {{
 *   fetch?: typeof fetch,
 *   healthTracker?: EndpointHealthTracker,
 *   signal?: AbortSignal,
 *   nowMs?: () => number,
 *   nowSec?: () => number,
 *   env?: NodeJS.ProcessEnv,
 *   userAgent?: string,
 *   onTokenRefreshed?: (token: any) => void
 * }} [deps]
 */
async function fetchAccountQuota(account, tokenData, deps = {}) {
  const tracker = deps.healthTracker || new EndpointHealthTracker();
  const fetchFn = deps.fetch || fetch;
  const ua = deps.userAgent || defaultEgressUserAgent();
  const nowMs = deps.nowMs || Date.now;

  // 1. Ensure fresh token
  /** @type {any} */
  let activeToken;
  try {
    activeToken = await ensureFreshToken(/** @type {any} */ (tokenData), {
      fetch: fetchFn,
      signal: deps.signal,
      nowSec: deps.nowSec,
      env: deps.env
    });
  } catch (error) {
    const msg = String(error instanceof Error ? error.message : error);
    if (msg.toLowerCase().includes('invalid_grant')) {
      return {
        ok: false,
        invalidGrant: true,
        error: msg
      };
    }
    throw error;
  }

  if (activeToken.accessToken !== tokenData.accessToken) {
    deps.onTokenRefreshed?.(activeToken);
  }

  // 2. loadCodeAssist (authoritative tier + project_id)
  const loadRes = await fetchProjectAndTier(String(activeToken.accessToken || ''), {
    fetch: fetchFn,
    healthTracker: tracker,
    signal: deps.signal,
    userAgent: ua
  });
  const projectId = loadRes.projectId || activeToken.projectId || '';
  if (projectId && projectId !== activeToken.projectId) {
    activeToken = { ...activeToken, projectId };
    deps.onTokenRefreshed?.(activeToken);
  }
  const existingTier = account?.subscriptionTier && account.subscriptionTier !== 'UNKNOWN'
    ? account.subscriptionTier
    : 'UNKNOWN';
  const subscriptionTier = loadRes.subscriptionTier || existingTier;
  const rawTier = loadRes.rawTier || account?.quota?.rawTier || '';
  const isUltra = subscriptionTier === 'ULTRA';

  // 3. fetchAvailableModels (Daily -> Sandbox only)
  const modelEndpoints = tracker.getOrderedEndpoints(QUOTA_API_ENDPOINTS);
  const reqBody = JSON.stringify(projectId ? { project: projectId } : {});
  let lastError = null;

  for (const url of modelEndpoints) {
    try {
      const response = await fetchFn(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${activeToken.accessToken}`,
          'content-type': 'application/json',
          'user-agent': ua
        },
        body: reqBody,
        signal: deps.signal
      });
      if (!response.ok) {
        if (response.status === 403) {
          const text = await response.text().catch(() => '');
          const classified = classify403Response(403, text);
          const quota = {
            lastUpdatedAt: nowMs(),
            isForbidden: true,
            forbiddenReason: classified.message || text.slice(0, 512),
            subscriptionTier,
            rawTier,
            groups: account?.quota?.groups || [],
            models: account?.quota?.models || []
          };
          return { ok: true, quota, subscriptionTier, classification: classified, token: activeToken };
        }
        lastError = new Error(`Quota API ${url} returned HTTP ${response.status}`);
        if (shouldTryNextEndpointForUrl(response.status, url)) {
          tracker.markFailure(url);
          continue;
        }
        break;
      }

      tracker.markSuccess(url);
      const modelsPayload = await response.json();
      const rawModels = modelsPayload?.models && typeof modelsPayload.models === 'object' ? modelsPayload.models : {};

      // Official supported IDs from agentModelSorts + imageGenerationModelIds + tieredModelIds
      const officialSupported = new Set();
      for (const sort of Array.isArray(modelsPayload?.agentModelSorts) ? modelsPayload.agentModelSorts : []) {
        for (const group of Array.isArray(sort?.groups) ? sort.groups : []) {
          for (const id of Array.isArray(group?.modelIds) ? group.modelIds : []) {
            officialSupported.add(String(id || '').trim().toLowerCase());
          }
        }
      }
      for (const id of Array.isArray(modelsPayload?.imageGenerationModelIds) ? modelsPayload.imageGenerationModelIds : []) {
        officialSupported.add(String(id || '').trim().toLowerCase());
      }
      if (modelsPayload?.tieredModelIds && typeof modelsPayload.tieredModelIds === 'object') {
        for (const ids of Object.values(modelsPayload.tieredModelIds)) {
          for (const id of Array.isArray(ids) ? ids : []) {
            officialSupported.add(String(id || '').trim().toLowerCase());
          }
        }
      }

      const groups = (await fetchQuotaSummary(String(activeToken.accessToken || ''), projectId, {
        fetch: fetchFn,
        healthTracker: tracker,
        signal: deps.signal,
        userAgent: ua
      })) || [];

      /** @type {string[]} */
      const knownG4Codenames = [];
      for (const [name, info] of Object.entries(rawModels)) {
        const nl = name.trim().toLowerCase();
        if (info?.disabled === true || info?.isDisabled === true || nl.includes('-disabled') || nl.endsWith('_disabled')) continue;
        const code = extractGemini4Codename(nl);
        if (code && !knownG4Codenames.includes(code)) knownG4Codenames.push(code);
      }

      /** @type {Array<{ name: string, displayName: string, percentage: number, resetTime: string }>} */
      const models = [];
      for (const [name, info] of Object.entries(rawModels)) {
        const nameLower = name.trim().toLowerCase();
        if (info?.disabled === true || info?.isDisabled === true) continue;
        if (!isModelCompliantWithBaseline(name)) continue;
        if (officialSupported.size > 0 && !officialSupported.has(nameLower)) continue;

        const match = matchQuotaGroupForModel(groups, nameLower, isUltra, knownG4Codenames);
        if (match.kind === 'skipUnauthorized') continue;

        const modelPct = modelQuotaPercentage(info?.quotaInfo);
        const modelReset = String(info?.quotaInfo?.resetTime || '').trim();
        let groupPct = null;
        let groupReset = '';
        if (match.kind === 'matched') {
          const chosen = pickMostRestrictiveBucket(match.group.buckets);
          if (chosen) {
            groupPct = Math.round(chosen.remainingFraction * 100);
            groupReset = String(chosen.resetTime || '').trim();
          }
        }

        let percentage = 100;
        let resetTime = '';
        if (modelPct !== null && groupPct !== null) {
          if (modelPct <= 0) {
            percentage = 0;
            resetTime = modelReset || groupReset;
          } else {
            percentage = Math.min(modelPct, groupPct);
            resetTime = percentage === groupPct ? (groupReset || modelReset) : (modelReset || groupReset);
          }
        } else if (modelPct !== null) {
          percentage = modelPct;
          resetTime = modelReset;
        } else if (groupPct !== null) {
          percentage = groupPct;
          resetTime = groupReset;
        }

        models.push({
          name,
          displayName: String(info?.displayName || name),
          percentage: Math.max(0, Math.min(100, percentage)),
          resetTime
        });
      }

      models.sort((a, b) => a.name.localeCompare(b.name));

      const quota = {
        lastUpdatedAt: nowMs(),
        isForbidden: false,
        forbiddenReason: '',
        subscriptionTier,
        rawTier,
        groups,
        models
      };
      return { ok: true, quota, subscriptionTier, classification: { kind: 'ok' }, token: activeToken };
    } catch (error) {
      if (isAbortError(error, deps.signal)) throw error;
      tracker.markFailure(url);
      lastError = error;
    }
  }

  throw lastError || new Error('All quota endpoints failed');
}

/**
 * Sliding-window concurrent batch runner matching Antigravity-Manager's refresh_all_quotas_logic.
 * @template T
 * @param {T[]} items
 * @param {{
 *   concurrency?: number,
 *   slideDelaySecs?: number,
 *   signal?: AbortSignal,
 *   sleep?: (ms: number, signal?: AbortSignal) => Promise<void>,
 *   onProgress?: (progress: { current: number, total: number, success: number, failed: number, item: T }) => void,
 *   worker: (item: T, index: number) => Promise<boolean>
 * }} options
 */
async function runSlidingWindowBatch(items, options) {
  const list = Array.isArray(items) ? items : [];
  const total = list.length;
  if (total === 0) return { total: 0, success: 0, failed: 0 };

  const concurrency = Math.max(1, Math.min(20, Math.round(Number(options.concurrency) || 5)));
  const slideMs = Math.max(0, Math.round((Number(options.slideDelaySecs) || 0) * 1000));
  const sleepFn = options.sleep || ((ms, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })); return; }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(timer); reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })); };
    signal?.addEventListener('abort', onAbort, { once: true });
  }));

  let nextIndex = 0;
  let current = 0;
  let success = 0;
  let failed = 0;

  async function runWorker() {
    while (nextIndex < total) {
      if (options.signal?.aborted) break;
      const idx = nextIndex;
      nextIndex += 1;
      const item = list[idx];
      let ok = false;
      try {
        ok = await options.worker(item, idx) === true;
      } catch (_) {}
      current += 1;
      if (ok) success += 1;
      else failed += 1;
      options.onProgress?.({ current, total, success, failed, item });
      if (slideMs > 0 && nextIndex < total && !options.signal?.aborted) {
        try { await sleepFn(slideMs, options.signal); } catch (_) { break; }
      }
    }
  }

  const runners = Array.from({ length: Math.min(concurrency, total) }, () => runWorker());
  await Promise.all(runners);
  return { total, success, failed };
}

module.exports = {
  CLOUD_CODE_LOAD_PROJECT_ENDPOINTS,
  EndpointHealthTracker,
  KNOWN_STABLE_VERSION,
  QUOTA_API_ENDPOINTS,
  QUOTA_SUMMARY_ENDPOINTS,
  classify403Response,
  defaultEgressUserAgent,
  extractGemini4Codename,
  fetchAccountQuota,
  fetchProjectAndTier,
  fetchQuotaSummary,
  isModelCompliantWithBaseline,
  matchQuotaGroupForModel,
  modelQuotaPercentage,
  pickMostRestrictiveBucket,
  runSlidingWindowBatch
};
