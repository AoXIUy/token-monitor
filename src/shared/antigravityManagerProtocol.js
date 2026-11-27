// @ts-check
'use strict';

const AG_MANAGER_BASE = '/api/antigravity-manager';
const AG_MANAGER_SNAPSHOT_PATH = '/api/antigravity-manager/snapshot';

const MAX_AG_MANAGER_SNAPSHOT_BYTES = 512 * 1024;
const MAX_AG_MANAGER_ACCOUNTS = 200;
const MAX_AG_MANAGER_DEVICES = 32;
const MAX_GROUPS_PER_ACCOUNT = 16;
const MAX_BUCKETS_PER_GROUP = 8;
const MAX_MODELS_PER_ACCOUNT = 64;
const MAX_FORBIDDEN_MODELS = 64;

const ALLOWED_TIERS = new Set(['FREE', 'PRO', 'ULTRA', 'ENTERPRISE', 'UNKNOWN']);

/**
 * @param {string} value
 * @param {number} max
 * @returns {string}
 */
function truncateCodePoints(value, max) {
  const chars = Array.from(value);
  return chars.length <= max ? value : chars.slice(0, max).join('');
}

/**
 * @param {unknown} value
 * @param {number} max
 * @returns {string}
 */
function cleanSingleLine(value, max) {
  if (typeof value !== 'string') return '';
  const cleaned = value.replace(/[\x00-\x1f\x7f]+/g, ' ').trim();
  return truncateCodePoints(cleaned, max);
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {'FREE' | 'PRO' | 'ULTRA' | 'ENTERPRISE' | 'UNKNOWN'}
 */
function normalizeSubscriptionTier(value) {
  const upper = cleanSingleLine(value, 32).toUpperCase();
  if (ALLOWED_TIERS.has(upper)) {
    return /** @type {'FREE' | 'PRO' | 'ULTRA' | 'ENTERPRISE' | 'UNKNOWN'} */ (upper);
  }
  if (upper.includes('ULTRA')) return 'ULTRA';
  if (upper.includes('PRO')) return 'PRO';
  if (upper.includes('ENTERPRISE') || upper.includes('BUSINESS') || upper.includes('TEAM')) return 'ENTERPRISE';
  if (upper.includes('FREE') || upper.includes('STANDARD')) return 'FREE';
  return 'UNKNOWN';
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function cleanIsoDate(value) {
  const text = cleanSingleLine(value, 64);
  if (!text) return '';
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function nonNegativeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * @param {string} [message]
 */
function invalidRequestError(message = 'invalid_request') {
  const err = new Error(message);
  /** @type {any} */ (err).code = 'invalid_request';
  return err;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function strictRemainingFraction(value) {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : null;
}

/**
 * @param {unknown} raw
 * @returns {{
 *   lastUpdatedAt: number,
 *   isForbidden: boolean,
 *   forbiddenReason: string,
 *   groups: Array<{ displayName: string, description: string, buckets: Array<{ bucketId: string, window: string, remainingFraction: number | null, disabled: boolean, resetTime: string, displayName: string, description: string }> }>,
 *   models: Array<{ name: string, displayName: string, percentage: number, resetTime: string }>
 * } | null}
 */
function sanitizeQuota(raw) {
  if (!isPlainObject(raw)) return null;
  const groups = Array.isArray(raw.groups)
    ? raw.groups.slice(0, MAX_GROUPS_PER_ACCOUNT).flatMap((group) => {
        if (!isPlainObject(group)) return [];
        const displayName = cleanSingleLine(group.displayName ?? group.display_name, 128);
        if (!displayName) return [];
        const description = cleanSingleLine(group.description, 256);
        const buckets = Array.isArray(group.buckets)
          ? group.buckets.slice(0, MAX_BUCKETS_PER_GROUP).flatMap((bucket) => {
              if (!isPlainObject(bucket)) return [];
              const resetTime = cleanIsoDate(bucket.resetTime ?? bucket.reset_time) || cleanSingleLine(bucket.resetTime ?? bucket.reset_time, 64);
              const disabled = bucket.disabled === true;
              const rawFraction = bucket.remainingFraction ?? bucket.remaining_fraction;
              let remainingFraction = strictRemainingFraction(rawFraction);
              if (!disabled && remainingFraction === null && (rawFraction === undefined || rawFraction === null) && resetTime) {
                remainingFraction = 0;
              }
              if (!disabled && remainingFraction === null) return [];
              return [{
                bucketId: cleanSingleLine(bucket.bucketId ?? bucket.bucket_id, 128),
                window: cleanSingleLine(bucket.window, 32),
                remainingFraction,
                disabled,
                resetTime,
                displayName: cleanSingleLine(bucket.displayName ?? bucket.display_name, 128),
                description: cleanSingleLine(bucket.description, 256)
              }];
            })
          : [];
        return [{ displayName, description, buckets }];
      })
    : [];

  const models = Array.isArray(raw.models)
    ? raw.models.slice(0, MAX_MODELS_PER_ACCOUNT).flatMap((model) => {
        if (!isPlainObject(model)) return [];
        const name = cleanSingleLine(model.name, 128);
        if (!name) return [];
        const pctRaw = Number(model.percentage);
        const percentage = Number.isFinite(pctRaw) ? Math.max(0, Math.min(100, Math.round(pctRaw))) : 0;
        return [{
          name,
          displayName: cleanSingleLine(model.displayName ?? model.display_name, 128),
          percentage,
          resetTime: cleanIsoDate(model.resetTime ?? model.reset_time) || cleanSingleLine(model.resetTime ?? model.reset_time, 64)
        }];
      })
    : [];

  return {
    lastUpdatedAt: nonNegativeNumber(raw.lastUpdatedAt ?? raw.last_updated),
    isForbidden: raw.isForbidden === true || raw.is_forbidden === true,
    forbiddenReason: cleanSingleLine(raw.forbiddenReason ?? raw.forbidden_reason, 512),
    groups,
    models
  };
}

/**
 * Strictly sanitize an Antigravity Manager snapshot payload.
 * Never retains tokens, credentials, device fingerprints, or arbitrary unallowlisted fields.
 *
 * @param {unknown} raw
 */
function sanitizeAntigravityManagerSnapshot(raw) {
  if (!isPlainObject(raw)) throw invalidRequestError('invalid_request');
  const deviceId = cleanSingleLine(raw.deviceId, 256);
  if (!deviceId) throw invalidRequestError('invalid_request');
  if (raw.accounts !== undefined && !Array.isArray(raw.accounts)) {
    throw invalidRequestError('accounts must be an array');
  }

  const hostname = cleanSingleLine(raw.hostname, 256);
  const updatedAt = cleanIsoDate(raw.updatedAt) || new Date().toISOString();

  const rawSettings = isPlainObject(raw.settings) ? raw.settings : {};
  const intervalRaw = Number(rawSettings.refreshIntervalMinutes);
  const refreshIntervalMinutes = Number.isFinite(intervalRaw)
    ? Math.max(1, Math.min(1440, Math.round(intervalRaw)))
    : 10;

  const settings = {
    startupRefresh: rawSettings.startupRefresh === true,
    autoRefresh: rawSettings.autoRefresh === true,
    refreshIntervalMinutes
  };

  const rawActive = isPlainObject(raw.activeAccounts) ? raw.activeAccounts : {};
  /** @param {unknown} val */
  const cleanActiveId = (val) => {
    const id = cleanSingleLine(val, 128);
    return id || null;
  };
  const activeAccounts = {
    classic: cleanActiveId(rawActive.classic),
    ide: cleanActiveId(rawActive.ide),
    agy: cleanActiveId(rawActive.agy),
    acp: cleanActiveId(rawActive.acp)
  };

  const rawAccounts = Array.isArray(raw.accounts) ? raw.accounts : [];
  const seenIds = new Set();
  /** @type {Array<Record<string, any>>} */
  const accounts = [];

  for (const item of rawAccounts) {
    if (accounts.length >= MAX_AG_MANAGER_ACCOUNTS) break;
    if (!isPlainObject(item)) continue;
    const id = cleanSingleLine(item.id, 128);
    if (!id || seenIds.has(id)) continue;
    seenIds.add(id);

    const forbiddenModels = Array.isArray(item.forbiddenModels)
      ? item.forbiddenModels
          .slice(0, MAX_FORBIDDEN_MODELS)
          .map((m) => cleanSingleLine(m, 128))
          .filter(Boolean)
      : [];

    accounts.push({
      id,
      accountKey: cleanSingleLine(item.accountKey, 128),
      email: cleanSingleLine(item.email, 256),
      name: cleanSingleLine(item.name, 256),
      subscriptionTier: normalizeSubscriptionTier(item.subscriptionTier ?? item.quota?.subscriptionTier ?? item.quota?.subscription_tier),
      disabled: item.disabled === true,
      disabledReason: cleanSingleLine(item.disabledReason, 512),
      banned: item.banned === true,
      banCode: cleanSingleLine(item.banCode ?? (isPlainObject(item.banInfo) ? item.banInfo.code : ''), 128),
      validationBlocked: item.validationBlocked === true,
      validationMessage: cleanSingleLine(item.validationMessage, 256),
      hasDeviceProfile: item.hasDeviceProfile === true,
      forbiddenModels,
      lastUsedAt: nonNegativeNumber(item.lastUsedAt),
      quota: sanitizeQuota(item.quota)
    });
  }

  return {
    version: 1,
    deviceId,
    hostname,
    updatedAt,
    settings,
    activeAccounts,
    accounts
  };
}

module.exports = {
  AG_MANAGER_BASE,
  AG_MANAGER_SNAPSHOT_PATH,
  MAX_AG_MANAGER_ACCOUNTS,
  MAX_AG_MANAGER_DEVICES,
  MAX_AG_MANAGER_SNAPSHOT_BYTES,
  cleanIsoDate,
  cleanSingleLine,
  normalizeSubscriptionTier,
  sanitizeAntigravityManagerSnapshot
};
