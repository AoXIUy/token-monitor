// @ts-check
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { renameAtomicSync } = require('./winFs');
const { normalizeSubscriptionTier } = require('../../shared/antigravityManagerProtocol');
const {
  DEFAULT_ACCOUNT_WEIGHT,
  VALID_AUTO_SWITCH_SCOPES,
  VALID_SELECTION_MODES,
  normalizeAccountWeight
} = require('./autoSwitch');
const {
  DEFAULT_AUTO_RESUME_PROMPT,
  normalizeAutoResumePrompt
} = require('./taskResume');

const DEFAULT_CONFIG = Object.freeze({
  startupRefresh: false,
  autoRefresh: false,
  refreshIntervalMinutes: 10,
  refreshConcurrency: 5,
  refreshSlideDelaySecs: 0.2,
  syncToHub: true,
  defaultSwitchTarget: 'auto',
  autoSwitchEnabled: false,
  autoSwitchScope: 'primary',
  autoSwitchThresholdPercent: 0,
  selectionMode: 'auto',
  autoSwitchCooldownSeconds: 180,
  autoResumeEnabled: true,
  autoResumePrompt: DEFAULT_AUTO_RESUME_PROMPT,
  customExecutablePaths: { classic: '', ide: '', cli: '' }
});

const VALID_SWITCH_TARGETS = new Set(['auto', 'classic', 'ide', 'agy', 'acp']);
const MAX_AUTO_SWITCH_HISTORY = 20;

/**
 * @param {unknown} raw
 * @returns {Record<string, any> | null}
 */
function sanitizeAutoSwitchRecord(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const src = /** @type {Record<string, any>} */ (raw);
  const at = nonNegativeTimestamp(src.at);
  if (at <= 0) return null;
  const resumedConversations = Array.isArray(src.resumedConversations)
    ? src.resumedConversations.map((id) => String(id || '').trim()).filter(Boolean).slice(0, 10)
    : [];
  return {
    at,
    fromEmail: typeof src.fromEmail === 'string' ? src.fromEmail.trim().toLowerCase().slice(0, 256) : '',
    toEmail: typeof src.toEmail === 'string' ? src.toEmail.trim().slice(0, 256) : '',
    target: typeof src.target === 'string' ? src.target.trim().slice(0, 32) : '',
    mode: typeof src.mode === 'string' ? src.mode.trim().slice(0, 32) : '',
    triggerLabel: typeof src.triggerLabel === 'string' ? src.triggerLabel.trim().slice(0, 256) : '',
    ok: src.ok === true,
    ...(typeof src.resumedCount === 'number' && Number.isFinite(src.resumedCount)
      ? { resumedCount: Math.max(0, Math.round(src.resumedCount)), resumedConversations }
      : {}),
    ...(typeof src.resumeError === 'string' && src.resumeError.trim()
      ? { resumeError: src.resumeError.trim().slice(0, 512) }
      : {}),
    ...(typeof src.error === 'string' && src.error.trim()
      ? { error: src.error.trim().slice(0, 512) }
      : {})
  };
}

/**
 * @param {string} email
 * @returns {string}
 */
function accountKeyForEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return '';
  return `sha256:${crypto.createHash('sha256').update('antigravity').update('\0').update(normalized).update('\0').digest('hex')}`;
}

/**
 * @param {string} filePath
 * @param {unknown} fallback
 */
function readJsonSafe(filePath, fallback) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}

/**
 * @param {string} filePath
 * @param {unknown} value
 * @param {boolean} [privateMode]
 */
function writeJsonAtomic(filePath, value, privateMode = false) {
  try {
    if (fs.lstatSync(filePath).isSymbolicLink()) {
      throw new Error(`Refusing to overwrite symlinked file: ${filePath}`);
    }
  } catch (error) {
    if (/** @type {any} */ (error)?.code !== 'ENOENT') throw error;
  }
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true, ...(privateMode && process.platform !== 'win32' ? { mode: 0o700 } : {}) });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  try {
    fs.writeFileSync(tempPath, payload, {
      encoding: 'utf8',
      ...(privateMode && process.platform !== 'win32' ? { mode: 0o600 } : {})
    });
    renameAtomicSync(tempPath, filePath);
    if (privateMode && process.platform !== 'win32') {
      try { fs.chmodSync(filePath, 0o600); } catch (_) {}
    }
  } catch (error) {
    try { fs.unlinkSync(tempPath); } catch (_) {}
    throw error;
  }
}

/**
 * @param {Record<string, any>} raw
 */
function normalizeConfig(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const intervalRaw = Number(src.refreshIntervalMinutes);
  const concurrencyRaw = Number(src.refreshConcurrency);
  const slideRaw = Number(src.refreshSlideDelaySecs);
  const targetRaw = typeof src.defaultSwitchTarget === 'string' ? src.defaultSwitchTarget.trim().toLowerCase() : 'auto';
  const scopeRaw = typeof src.autoSwitchScope === 'string' ? src.autoSwitchScope.trim().toLowerCase() : 'primary';
  const thresholdRaw = Number(src.autoSwitchThresholdPercent);
  const modeRaw = typeof src.selectionMode === 'string' ? src.selectionMode.trim().toLowerCase() : 'auto';
  const cooldownRaw = Number(src.autoSwitchCooldownSeconds);
  const customPathsRaw = src.customExecutablePaths && typeof src.customExecutablePaths === 'object' ? src.customExecutablePaths : {};

  return {
    startupRefresh: src.startupRefresh === true,
    autoRefresh: src.autoRefresh === true,
    refreshIntervalMinutes: Number.isFinite(intervalRaw) ? Math.max(1, Math.min(1440, Math.round(intervalRaw))) : DEFAULT_CONFIG.refreshIntervalMinutes,
    refreshConcurrency: Number.isFinite(concurrencyRaw) ? Math.max(1, Math.min(20, Math.round(concurrencyRaw))) : DEFAULT_CONFIG.refreshConcurrency,
    refreshSlideDelaySecs: Number.isFinite(slideRaw) ? Math.max(0, Math.min(10, Math.round(slideRaw * 100) / 100)) : DEFAULT_CONFIG.refreshSlideDelaySecs,
    syncToHub: src.syncToHub !== false,
    defaultSwitchTarget: VALID_SWITCH_TARGETS.has(targetRaw) ? targetRaw : 'auto',
    autoSwitchEnabled: src.autoSwitchEnabled === true,
    autoSwitchScope: VALID_AUTO_SWITCH_SCOPES.has(scopeRaw) ? scopeRaw : DEFAULT_CONFIG.autoSwitchScope,
    autoSwitchThresholdPercent: Number.isFinite(thresholdRaw) ? Math.max(0, Math.min(50, Math.round(thresholdRaw))) : DEFAULT_CONFIG.autoSwitchThresholdPercent,
    selectionMode: VALID_SELECTION_MODES.has(modeRaw) ? modeRaw : DEFAULT_CONFIG.selectionMode,
    autoSwitchCooldownSeconds: Number.isFinite(cooldownRaw) ? Math.max(30, Math.min(3600, Math.round(cooldownRaw))) : DEFAULT_CONFIG.autoSwitchCooldownSeconds,
    autoResumeEnabled: src.autoResumeEnabled !== false,
    autoResumePrompt: normalizeAutoResumePrompt(src.autoResumePrompt, DEFAULT_CONFIG.autoResumePrompt),
    customExecutablePaths: {
      classic: typeof customPathsRaw.classic === 'string' ? customPathsRaw.classic.trim() : '',
      ide: typeof customPathsRaw.ide === 'string' ? customPathsRaw.ide.trim() : '',
      cli: typeof customPathsRaw.cli === 'string' ? customPathsRaw.cli.trim() : ''
    }
  };
}

/**
 * @param {Record<string, any>} raw
 */
function sanitizeTokenRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const refreshToken = String(raw.refreshToken || raw.refresh_token || '').trim();
  const accessToken = String(raw.accessToken || raw.access_token || '').trim();
  if (!refreshToken && !accessToken) return null;
  const expiresInRaw = Number(raw.expiresIn ?? raw.expires_in);
  const expiryRaw = Number(raw.expiryTimestamp ?? raw.expiry_timestamp);
  const nowSec = Math.floor(Date.now() / 1000);
  const expiryTimestamp = Number.isFinite(expiryRaw) && expiryRaw > 0
    ? (expiryRaw > 10_000_000_000 ? Math.floor(expiryRaw / 1000) : Math.floor(expiryRaw))
    : (Number.isFinite(expiresInRaw) && expiresInRaw > 0 ? nowSec + Math.floor(expiresInRaw) : 0);

  return {
    accessToken,
    refreshToken,
    expiresIn: Number.isFinite(expiresInRaw) && expiresInRaw > 0 ? Math.floor(expiresInRaw) : 3599,
    expiryTimestamp,
    email: typeof raw.email === 'string' ? raw.email.trim().toLowerCase() : '',
    projectId: typeof raw.projectId === 'string'
      ? raw.projectId.trim()
      : (typeof raw.project_id === 'string' ? raw.project_id.trim() : ''),
    idToken: typeof raw.idToken === 'string'
      ? raw.idToken.trim()
      : (typeof raw.id_token === 'string' ? raw.id_token.trim() : ''),
    isGcpTos: raw.isGcpTos === true || raw.is_gcp_tos === true,
    oauthClientKey: typeof raw.oauthClientKey === 'string'
      ? raw.oauthClientKey.trim()
      : (typeof raw.oauth_client_key === 'string' ? raw.oauth_client_key.trim() : '')
  };
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function optionalPositiveNumber(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function nonNegativeTimestamp(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return 0;
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : 0;
}

/**
 * @param {Record<string, any>} raw
 */
function sanitizeAccountMeta(raw) {
  const email = String(raw?.email || '').trim().toLowerCase();
  const id = String(raw?.id || '').trim() || `agm-${crypto.randomUUID()}`;
  const quota = raw?.quota && typeof raw.quota === 'object' ? raw.quota : null;
  const subscriptionTier = normalizeSubscriptionTier(
    raw?.subscriptionTier || quota?.subscriptionTier || quota?.subscription_tier || 'UNKNOWN'
  );
  return {
    id,
    accountKey: String(raw?.accountKey || '').trim() || accountKeyForEmail(email),
    email,
    name: typeof raw?.name === 'string' ? raw.name.trim() : '',
    subscriptionTier,
    weight: normalizeAccountWeight(raw?.weight, DEFAULT_ACCOUNT_WEIGHT),
    disabled: raw?.disabled === true,
    disabledReason: typeof raw?.disabledReason === 'string' ? raw.disabledReason : '',
    disabledAt: optionalPositiveNumber(raw?.disabledAt),
    banned: raw?.banned === true,
    banInfo: raw?.banInfo && typeof raw.banInfo === 'object'
      ? {
          code: String(raw.banInfo.code || ''),
          message: String(raw.banInfo.message || ''),
          appealUrl: raw.banInfo.appealUrl ? String(raw.banInfo.appealUrl) : ''
        }
      : null,
    validationBlocked: raw?.validationBlocked === true,
    validationMessage: typeof raw?.validationMessage === 'string' ? raw.validationMessage : '',
    forbiddenModels: Array.isArray(raw?.forbiddenModels)
      ? [...new Set(raw.forbiddenModels.map((m) => String(m || '').trim()).filter(Boolean))]
      : [],
    deviceProfile: raw?.deviceProfile && typeof raw.deviceProfile === 'object' ? { ...raw.deviceProfile } : null,
    deviceVersions: Array.isArray(raw?.deviceVersions) ? raw.deviceVersions.slice(0, 20) : [],
    quota,
    createdAt: optionalPositiveNumber(raw?.createdAt) ?? Math.floor(Date.now() / 1000),
    lastUsedAt: nonNegativeTimestamp(raw?.lastUsedAt)
  };
}

/**
 * Create isolated Antigravity Manager store under <userData>/antigravity-manager/.
 * @param {{
 *   baseDir: string,
 *   safeStorage?: { isEncryptionAvailable?: () => boolean, encryptString?: (text: string) => Buffer, decryptString?: (buf: Buffer) => string } | null,
 *   logger?: { warn?: Function, error?: Function }
 * }} options
 */
function createAntigravityManagerStore({ baseDir, safeStorage = null, logger = console }) {
  const dir = path.resolve(String(baseDir || ''));
  const configFile = path.join(dir, 'config.json');
  const accountsFile = path.join(dir, 'accounts.json');
  const tokensFile = path.join(dir, 'tokens.enc');
  const originalDeviceFile = path.join(dir, 'device_original.json');

  let config = normalizeConfig(readJsonSafe(configFile, DEFAULT_CONFIG));

  /** @type {{ version: number, activeAccounts: { classic: string | null, ide: string | null, agy: string | null, acp: string | null }, accounts: ReturnType<typeof sanitizeAccountMeta>[], lastAutoSwitch: Record<string, any> | null, autoSwitchHistory: Record<string, any>[] }} */
  let accountsDoc = (() => {
    const loaded = readJsonSafe(accountsFile, null);
    const active = loaded?.activeAccounts && typeof loaded.activeAccounts === 'object' ? loaded.activeAccounts : {};
    const list = Array.isArray(loaded?.accounts) ? loaded.accounts.map(sanitizeAccountMeta) : [];
    const history = Array.isArray(loaded?.autoSwitchHistory)
      ? /** @type {Record<string, any>[]} */ (loaded.autoSwitchHistory.map(sanitizeAutoSwitchRecord).filter(Boolean)).slice(0, MAX_AUTO_SWITCH_HISTORY)
      : [];
    const lastAutoSwitch = sanitizeAutoSwitchRecord(loaded?.lastAutoSwitch) || history[0] || null;
    return {
      version: 1,
      activeAccounts: {
        classic: typeof active.classic === 'string' && active.classic ? active.classic : null,
        ide: typeof active.ide === 'string' && active.ide ? active.ide : null,
        agy: typeof active.agy === 'string' && active.agy ? active.agy : null,
        acp: typeof active.acp === 'string' && active.acp ? active.acp : null
      },
      accounts: list,
      lastAutoSwitch,
      autoSwitchHistory: history
    };
  })();

  function canEncrypt() {
    try {
      return Boolean(
        safeStorage
        && typeof safeStorage.isEncryptionAvailable === 'function'
        && safeStorage.isEncryptionAvailable()
        && typeof safeStorage.encryptString === 'function'
        && typeof safeStorage.decryptString === 'function'
      );
    } catch (_) {
      return false;
    }
  }

  /** @type {Error | null} */
  let tokensLoadError = null;

  /** @returns {Record<string, NonNullable<ReturnType<typeof sanitizeTokenRecord>>>} */
  function loadTokensMap() {
    tokensLoadError = null;
    try {
      const stat = fs.lstatSync(tokensFile);
      if (stat.isSymbolicLink()) {
        throw new Error('Refusing to load symlinked tokens store');
      }
      if (!stat.isFile()) {
        throw new Error('Tokens store path is not a regular file');
      }
    } catch (error) {
      if (/** @type {any} */ (error)?.code === 'ENOENT') return {};
      tokensLoadError = error instanceof Error ? error : new Error(String(error));
      (logger.warn || console.warn)(`[antigravity-manager] could not read tokens store: ${tokensLoadError.message}`);
      return {};
    }

    try {
      const rawFile = fs.readFileSync(tokensFile, 'utf8');
      if (!rawFile.trim()) return {};
      const envelope = JSON.parse(rawFile);
      if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
        throw new Error('Invalid tokens store envelope');
      }
      let jsonStr = '';
      if (envelope.mode === 'safeStorage' && typeof envelope.data === 'string') {
        if (!safeStorage || typeof safeStorage.decryptString !== 'function') {
          throw new Error('safeStorage decryptor unavailable');
        }
        jsonStr = safeStorage.decryptString(Buffer.from(envelope.data, 'base64'));
      } else if (envelope.mode === 'plain-private' && typeof envelope.data === 'string') {
        jsonStr = Buffer.from(envelope.data, 'base64').toString('utf8');
      } else {
        throw new Error(`Unsupported tokens store mode: ${String(envelope.mode || 'unknown')}`);
      }
      const parsed = JSON.parse(jsonStr);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Invalid decrypted tokens payload');
      }
      /** @type {Record<string, NonNullable<ReturnType<typeof sanitizeTokenRecord>>>} */
      const out = {};
      for (const [id, rawToken] of Object.entries(parsed)) {
        const clean = sanitizeTokenRecord(rawToken);
        if (clean) out[id] = clean;
      }
      return out;
    } catch (error) {
      tokensLoadError = error instanceof Error ? error : new Error(String(error));
      (logger.warn || console.warn)(`[antigravity-manager] could not read tokens store: ${tokensLoadError.message}`);
      return {};
    }
  }

  /** @type {Record<string, NonNullable<ReturnType<typeof sanitizeTokenRecord>>>} */
  let tokensMap = loadTokensMap();

  function saveConfig() {
    writeJsonAtomic(configFile, config, false);
  }

  function saveAccountsDoc() {
    writeJsonAtomic(accountsFile, accountsDoc, false);
  }

  function saveTokensMap() {
    if (tokensLoadError) {
      throw new Error(`Refusing to overwrite unreadable tokens store: ${tokensLoadError.message}`);
    }
    const rawJson = JSON.stringify(tokensMap);
    const envelope = canEncrypt() && safeStorage && typeof safeStorage.encryptString === 'function'
      ? {
          version: 1,
          mode: 'safeStorage',
          data: safeStorage.encryptString(rawJson).toString('base64')
        }
      : {
          version: 1,
          mode: 'plain-private',
          data: Buffer.from(rawJson, 'utf8').toString('base64')
        };
    writeJsonAtomic(tokensFile, envelope, true);
  }

  function getConfig() {
    return {
      ...config,
      customExecutablePaths: { ...config.customExecutablePaths }
    };
  }

  /**
   * @param {Record<string, any>} patch
   */
  function updateConfig(patch) {
    const src = patch && typeof patch === 'object' ? patch : {};
    config = normalizeConfig({
      ...config,
      ...src,
      customExecutablePaths: {
        ...config.customExecutablePaths,
        ...(src.customExecutablePaths && typeof src.customExecutablePaths === 'object' ? src.customExecutablePaths : {})
      }
    });
    saveConfig();
    return getConfig();
  }

  function listAccounts() {
    return accountsDoc.accounts.map((item) => ({
      ...item,
      hasDeviceProfile: Boolean(item.deviceProfile),
      hasToken: Boolean(tokensMap[item.id]?.refreshToken || tokensMap[item.id]?.accessToken)
    }));
  }

  function getActiveAccounts() {
    return { ...accountsDoc.activeAccounts };
  }

  /**
   * @param {string} id
   */
  function getAccount(id) {
    const found = accountsDoc.accounts.find((a) => a.id === id);
    return found ? { ...found, hasToken: Boolean(tokensMap[found.id]?.refreshToken || tokensMap[found.id]?.accessToken) } : null;
  }

  /**
   * @param {string} email
   */
  function findAccountByEmail(email) {
    const norm = String(email || '').trim().toLowerCase();
    if (!norm) return null;
    const found = accountsDoc.accounts.find((a) => a.email === norm);
    return found ? { ...found } : null;
  }

  /**
   * @param {string} id
   */
  function getAccountToken(id) {
    const t = tokensMap[id];
    return t ? { ...t } : null;
  }

  /**
   * Upsert account metadata and optional token data. Deduplicates by id or normalized email.
   * @param {Record<string, any>} meta
   * @param {Record<string, any> | null} [tokenData]
   */
  function upsertAccount(meta, tokenData = null) {
    const emailNorm = String(meta?.email || tokenData?.email || '').trim().toLowerCase();
    const incomingId = String(meta?.id || '').trim();
    const existing = accountsDoc.accounts.find(
      (a) => (incomingId && a.id === incomingId) || (emailNorm && a.email === emailNorm)
    );
    const incomingName = typeof meta?.name === 'string' ? meta.name.trim() : '';
    const merged = sanitizeAccountMeta({
      ...(existing || {}),
      ...meta,
      id: existing?.id || incomingId || `agm-${crypto.randomUUID()}`,
      email: emailNorm || existing?.email || '',
      name: incomingName || existing?.name || '',
      weight: meta?.weight !== undefined ? meta.weight : (existing?.weight ?? DEFAULT_ACCOUNT_WEIGHT),
      quota: meta?.quota !== undefined ? meta.quota : (existing?.quota || null),
      deviceProfile: meta?.deviceProfile !== undefined ? meta.deviceProfile : (existing?.deviceProfile || null),
      deviceVersions: meta?.deviceVersions !== undefined ? meta.deviceVersions : (existing?.deviceVersions || []),
      createdAt: existing?.createdAt || meta?.createdAt || Math.floor(Date.now() / 1000)
    });

    if (tokenData) {
      const cleanToken = sanitizeTokenRecord({
        ...(tokensMap[merged.id] || {}),
        ...tokenData,
        email: merged.email || tokenData.email || ''
      });
      if (cleanToken) {
        const hadPrev = Object.hasOwn(tokensMap, merged.id);
        const prevToken = tokensMap[merged.id];
        tokensMap[merged.id] = cleanToken;
        try {
          saveTokensMap();
        } catch (error) {
          if (hadPrev) tokensMap[merged.id] = prevToken;
          else delete tokensMap[merged.id];
          throw error;
        }
      }
    }

    const idx = accountsDoc.accounts.findIndex((a) => a.id === merged.id);
    if (idx >= 0) {
      accountsDoc.accounts[idx] = merged;
    } else {
      accountsDoc.accounts.push(merged);
    }

    saveAccountsDoc();
    return getAccount(merged.id);
  }

  /**
   * @param {string} id
   * @param {Record<string, any>} tokenData
   */
  function saveAccountToken(id, tokenData) {
    const clean = sanitizeTokenRecord({
      ...(tokensMap[id] || {}),
      ...tokenData
    });
    if (!clean) return false;
    const hadPrev = Object.hasOwn(tokensMap, id);
    const prevToken = tokensMap[id];
    tokensMap[id] = clean;
    try {
      saveTokensMap();
    } catch (error) {
      if (hadPrev) tokensMap[id] = prevToken;
      else delete tokensMap[id];
      throw error;
    }
    return true;
  }

  /**
   * @param {string[]} ids
   */
  function deleteAccounts(ids) {
    const idSet = new Set((Array.isArray(ids) ? ids : []).map((x) => String(x || '').trim()).filter(Boolean));
    if (idSet.size === 0) return 0;
    const before = accountsDoc.accounts.length;
    accountsDoc.accounts = accountsDoc.accounts.filter((a) => !idSet.has(a.id));
    let tokenChanged = false;
    for (const id of idSet) {
      if (Object.hasOwn(tokensMap, id)) {
        delete tokensMap[id];
        tokenChanged = true;
      }
      for (const target of /** @type {const} */ (['classic', 'ide', 'agy', 'acp'])) {
        if (accountsDoc.activeAccounts[target] === id) {
          accountsDoc.activeAccounts[target] = null;
        }
      }
    }
    if (tokenChanged) saveTokensMap();
    saveAccountsDoc();
    return before - accountsDoc.accounts.length;
  }

  /**
   * @param {'classic' | 'ide' | 'agy' | 'acp'} target
   * @param {string | null} accountId
   */
  function setActiveAccount(target, accountId) {
    if (!['classic', 'ide', 'agy', 'acp'].includes(target)) return getActiveAccounts();
    accountsDoc.activeAccounts[target] = accountId ? String(accountId) : null;
    if (accountId) {
      const acc = accountsDoc.accounts.find((a) => a.id === accountId);
      if (acc) acc.lastUsedAt = Math.floor(Date.now() / 1000);
    }
    saveAccountsDoc();
    return getActiveAccounts();
  }

  /**
   * @param {string} id
   * @param {Record<string, any>} quota
   * @param {{ subscriptionTier?: string, name?: string, validationBlocked?: boolean, validationMessage?: string, banned?: boolean, banInfo?: any, forbiddenModels?: string[], disabled?: boolean, disabledReason?: string, disabledAt?: number | null }} [extra]
   */
  function updateAccountQuota(id, quota, extra = {}) {
    const idx = accountsDoc.accounts.findIndex((a) => a.id === id);
    if (idx < 0) return null;
    const current = accountsDoc.accounts[idx];
    const next = sanitizeAccountMeta({
      ...current,
      ...extra,
      quota,
      subscriptionTier: extra.subscriptionTier || quota?.subscriptionTier || quota?.subscription_tier || current.subscriptionTier
    });
    accountsDoc.accounts[idx] = next;
    saveAccountsDoc();
    return getAccount(id);
  }

  /**
   * @param {string} id
   * @param {unknown} weight
   */
  function setAccountWeight(id, weight) {
    const idx = accountsDoc.accounts.findIndex((a) => a.id === id);
    if (idx < 0) return null;
    const current = accountsDoc.accounts[idx];
    accountsDoc.accounts[idx] = sanitizeAccountMeta({
      ...current,
      weight: normalizeAccountWeight(weight, current.weight)
    });
    saveAccountsDoc();
    return getAccount(id);
  }

  function getOriginalDeviceProfile() {
    return readJsonSafe(originalDeviceFile, null);
  }

  /**
   * @param {Record<string, any>} profile
   */
  function saveOriginalDeviceProfileIfMissing(profile) {
    if (fs.existsSync(originalDeviceFile)) return getOriginalDeviceProfile();
    writeJsonAtomic(originalDeviceFile, profile, false);
    return profile;
  }

  /**
   * Persist the latest auto-switch audit record and prepend to bounded local history.
   * @param {Record<string, any>} rawRecord
   */
  function recordAutoSwitch(rawRecord) {
    const clean = sanitizeAutoSwitchRecord(rawRecord);
    if (!clean) return null;
    accountsDoc.lastAutoSwitch = clean;
    accountsDoc.autoSwitchHistory = [clean, ...(accountsDoc.autoSwitchHistory || [])].slice(0, MAX_AUTO_SWITCH_HISTORY);
    saveAccountsDoc();
    return { ...clean };
  }

  function getLastAutoSwitch() {
    return accountsDoc.lastAutoSwitch ? { ...accountsDoc.lastAutoSwitch } : null;
  }

  function getAutoSwitchHistory() {
    return (accountsDoc.autoSwitchHistory || []).map((item) => ({ ...item }));
  }

  function getStateForRenderer() {
    return {
      config: getConfig(),
      accounts: listAccounts(),
      activeAccounts: getActiveAccounts(),
      lastAutoSwitch: getLastAutoSwitch(),
      autoSwitchHistory: getAutoSwitchHistory(),
      hasOriginalDeviceBackup: fs.existsSync(originalDeviceFile),
      encryptionMode: canEncrypt() ? 'safeStorage' : 'privateFile'
    };
  }

  return {
    baseDir: dir,
    accountKeyForEmail,
    getConfig,
    updateConfig,
    listAccounts,
    getActiveAccounts,
    getAccount,
    findAccountByEmail,
    getAccountToken,
    upsertAccount,
    saveAccountToken,
    deleteAccounts,
    setActiveAccount,
    setAccountWeight,
    updateAccountQuota,
    recordAutoSwitch,
    getLastAutoSwitch,
    getAutoSwitchHistory,
    getOriginalDeviceProfile,
    saveOriginalDeviceProfileIfMissing,
    getStateForRenderer
  };
}

module.exports = {
  DEFAULT_CONFIG,
  accountKeyForEmail,
  createAntigravityManagerStore,
  normalizeConfig,
  sanitizeAccountMeta,
  sanitizeTokenRecord
};
