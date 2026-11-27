// @ts-check
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const protobuf = require('./protobuf');
const oauth = require('./oauth');
const stateDb = require('./stateDb');
const keyring = require('./keyring');
const fileCredentials = require('./fileCredentials');
const { normalizeSubscriptionTier } = require('../../shared/antigravityManagerProtocol');

/**
 * Resolve `candidate` and return its absolute path only if it stays strictly inside `baseDir`.
 *
 * @param {string} baseDir
 * @param {string} candidate
 * @returns {string | null}
 */
function resolvePathInsideDir(baseDir, candidate) {
  const root = path.resolve(String(baseDir || ''));
  const resolved = path.resolve(root, String(candidate || ''));
  const rel = path.relative(root, resolved);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return resolved;
}

/**
 * Parse Antigravity-Manager export JSON, account object, or raw refresh tokens (`1//...`).
 * @param {string} content
 * @returns {Array<{ email?: string, refreshToken: string }>}
 */
function parseImportEntriesFromString(content) {
  const text = String(content || '').trim();
  if (!text) return [];

  /** @type {Array<{ email?: string, refreshToken: string }>} */
  const entries = [];
  const seenRt = new Set();

  /**
   * @param {string} rt
   * @param {string} [email]
   */
  const pushEntry = (rt, email = '') => {
    const cleanRt = String(rt || '').trim();
    if (!cleanRt || !cleanRt.startsWith('1//') || seenRt.has(cleanRt)) return;
    seenRt.add(cleanRt);
    const cleanEmail = String(email || '').trim().toLowerCase();
    entries.push({
      ...(cleanEmail ? { email: cleanEmail } : {}),
      refreshToken: cleanRt
    });
  };

  try {
    const val = JSON.parse(text);
    /** @type {any[]} */
    let rawItems = [];
    if (Array.isArray(val)) {
      rawItems = val;
    } else if (val && typeof val === 'object') {
      if (Array.isArray(val.accounts)) rawItems = val.accounts;
      else if (val.accounts && typeof val.accounts === 'object') rawItems = Object.values(val.accounts);
      else if (typeof val.refresh_token === 'string' || typeof val.refreshToken === 'string' || val.token) {
        rawItems = [val];
      } else {
        rawItems = Object.values(val);
      }
    }
    for (const item of rawItems) {
      if (typeof item === 'string') {
        pushEntry(item);
        continue;
      }
      if (!item || typeof item !== 'object') continue;
      const email = String(
        item.email
        || (typeof item.name === 'string' && item.name.includes('@') ? item.name : '')
      ).trim();
      const rt = String(
        item.refresh_token
        || item.refreshToken
        || item.token?.refresh_token
        || item.token?.refreshToken
        || ''
      ).trim();
      pushEntry(rt, email);
    }
    if (entries.length > 0) return entries;
  } catch (_) {}

  // Fallback: raw text lines containing `1//...` tokens
  for (const line of text.split(/[\r\n,;\s]+/)) {
    const tokenMatch = line.match(/(1\/\/[A-Za-z0-9._-]+)/);
    if (tokenMatch) {
      pushEntry(tokenMatch[1]);
    }
  }
  return entries;
}

/**
 * Normalize Antigravity-Manager Rust QuotaData into store quota shape.
 * @param {any} rawQuota
 */
function convertRustQuota(rawQuota) {
  if (!rawQuota || typeof rawQuota !== 'object') return null;
  const groupsRaw = Array.isArray(rawQuota.quota_groups) ? rawQuota.quota_groups : (Array.isArray(rawQuota.groups) ? rawQuota.groups : []);
  const groups = groupsRaw.map((/** @type {any} */ g) => ({
    displayName: String(g?.display_name ?? g?.displayName ?? ''),
    description: g?.description ? String(g.description) : '',
    buckets: (Array.isArray(g?.buckets) ? g.buckets : []).map((/** @type {any} */ b) => {
      const disabled = b?.disabled === true;
      const rfRaw = b?.remaining_fraction ?? b?.remainingFraction;
      const rfNum = rfRaw === null || rfRaw === undefined || rfRaw === '' || typeof rfRaw === 'boolean'
        ? NaN
        : Number(rfRaw);
      const remainingFraction = disabled
        ? (Number.isFinite(rfNum) ? Math.max(0, Math.min(1, rfNum)) : null)
        : (Number.isFinite(rfNum) ? Math.max(0, Math.min(1, rfNum)) : 0);
      return {
        bucketId: String(b?.bucket_id ?? b?.bucketId ?? ''),
        window: String(b?.window ?? ''),
        remainingFraction,
        disabled,
        resetTime: String(b?.reset_time ?? b?.resetTime ?? ''),
        displayName: String(b?.display_name ?? b?.displayName ?? ''),
        description: String(b?.description ?? '')
      };
    })
  }));
  const modelsRaw = Array.isArray(rawQuota.models) ? rawQuota.models : [];
  const models = modelsRaw.map((/** @type {any} */ m) => ({
    name: String(m?.name || ''),
    displayName: String(m?.display_name ?? m?.displayName ?? m?.name ?? ''),
    percentage: Math.max(0, Math.min(100, Math.round(Number(m?.percentage || 0)))),
    resetTime: String(m?.reset_time ?? m?.resetTime ?? '')
  })).filter((/** @type {any} */ m) => m.name);

  const rawUpdated = Number(rawQuota.last_updated ?? rawQuota.lastUpdatedAt ?? 0);
  const lastUpdatedAt = Number.isFinite(rawUpdated) && rawUpdated > 0
    ? (rawUpdated < 10_000_000_000 ? Math.round(rawUpdated * 1000) : Math.round(rawUpdated))
    : 0;

  return {
    lastUpdatedAt,
    isForbidden: rawQuota.is_forbidden === true || rawQuota.isForbidden === true,
    forbiddenReason: String(rawQuota.forbidden_reason ?? rawQuota.forbiddenReason ?? ''),
    subscriptionTier: normalizeSubscriptionTier(rawQuota.subscription_tier ?? rawQuota.subscriptionTier ?? 'UNKNOWN'),
    rawTier: String(rawQuota.raw_tier ?? rawQuota.rawTier ?? ''),
    groups,
    models
  };
}

/**
 * Convert Rust DeviceProfile snake_case to camelCase.
 * @param {any} rawProfile
 */
function convertRustDeviceProfile(rawProfile) {
  if (!rawProfile || typeof rawProfile !== 'object') return null;
  const machineId = String(rawProfile.machine_id || rawProfile.machineId || '').trim();
  const macMachineId = String(rawProfile.mac_machine_id || rawProfile.macMachineId || '').trim();
  const devDeviceId = String(rawProfile.dev_device_id || rawProfile.devDeviceId || '').trim();
  const sqmId = String(rawProfile.sqm_id || rawProfile.sqmId || '').trim();
  if (!machineId && !macMachineId && !devDeviceId && !sqmId) return null;
  return { machineId, macMachineId, devDeviceId, sqmId };
}

/**
 * Resolve default Antigravity-Manager data directory (~/.antigravity_tools).
 * @param {string} [home]
 * @param {NodeJS.ProcessEnv} [env]
 */
function defaultManagerDataDir(home = os.homedir(), env = process.env) {
  if (env.ABV_DATA_DIR && fs.existsSync(env.ABV_DATA_DIR)) return env.ABV_DATA_DIR;
  const pointerFile = path.join(home, '.antigravity_tools', '.data_dir_location');
  try {
    if (fs.existsSync(pointerFile)) {
      const target = fs.readFileSync(pointerFile, 'utf8').trim();
      if (target && fs.existsSync(target)) return target;
    }
  } catch (_) {}
  return path.join(home, '.antigravity_tools');
}

/**
 * Import accounts and cached quotas directly from an Antigravity-Manager data dir
 * (`accounts.json` + `accounts/*.json`) without requiring network calls.
 *
 * @param {string} dirPath
 * @param {{ store: any }} deps
 */
function importFromManagerDataDir(dirPath, { store }) {
  const rootDir = path.resolve(String(dirPath || ''));
  if (!fs.existsSync(rootDir)) {
    throw new Error(`Directory does not exist: ${rootDir}`);
  }
  const indexPath = path.join(rootDir, 'accounts.json');
  const accountsDir = path.join(rootDir, 'accounts');
  if (!fs.existsSync(indexPath) && !fs.existsSync(accountsDir)) {
    throw new Error('Not a valid Antigravity-Manager data directory (missing accounts.json / accounts/)');
  }

  /** @type {string[]} */
  const errors = [];

  let indexDoc = null;
  if (fs.existsSync(indexPath)) {
    try {
      indexDoc = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    } catch (error) {
      errors.push(`accounts.json: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** @type {Set<string>} */
  const idList = new Set();
  for (const s of Array.isArray(indexDoc?.accounts) ? indexDoc.accounts : []) {
    if (s?.id) idList.add(String(s.id));
  }
  if (fs.existsSync(accountsDir)) {
    for (const file of fs.readdirSync(accountsDir)) {
      if (file.endsWith('.json')) idList.add(file.slice(0, -'.json'.length));
    }
  }

  /** @type {Map<string, string>} */
  const oldIdToNewId = new Map();
  let imported = 0;
  let skipped = 0;

  for (const rawId of idList) {
    if (!rawId || /[/\\]/.test(rawId) || rawId === '.' || rawId === '..') {
      skipped += 1;
      errors.push(`${rawId}: invalid account id`);
      continue;
    }
    const filePath = resolvePathInsideDir(accountsDir, `${rawId}.json`);
    if (!filePath) {
      skipped += 1;
      errors.push(`${rawId}: path traversal rejected`);
      continue;
    }
    if (!fs.existsSync(filePath)) {
      skipped += 1;
      continue;
    }
    try {
      const rawAcc = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const email = String(rawAcc?.email || '').trim().toLowerCase();
      const rawToken = rawAcc?.token;
      if (!email || !rawToken || (!rawToken.refresh_token && !rawToken.access_token)) {
        skipped += 1;
        continue;
      }

      const quota = convertRustQuota(rawAcc.quota);
      const saved = store.upsertAccount({
        email,
        name: rawAcc.name || '',
        subscriptionTier: quota?.subscriptionTier || 'UNKNOWN',
        disabled: rawAcc.disabled === true,
        disabledReason: rawAcc.disabled_reason || '',
        disabledAt: rawAcc.disabled_at ?? null,
        banned: rawAcc.banned === true,
        banInfo: rawAcc.ban_info
          ? {
              code: String(rawAcc.ban_info.code || ''),
              message: String(rawAcc.ban_info.message || ''),
              appealUrl: String(rawAcc.ban_info.appeal_url || '')
            }
          : null,
        validationBlocked: rawAcc.validation_blocked === true,
        validationMessage: rawAcc.validation_blocked_reason || '',
        forbiddenModels: Array.isArray(rawAcc.forbidden_models) ? rawAcc.forbidden_models : [],
        deviceProfile: convertRustDeviceProfile(rawAcc.device_profile),
        quota,
        createdAt: rawAcc.created_at,
        lastUsedAt: rawAcc.last_used
      }, {
        accessToken: rawToken.access_token || '',
        refreshToken: rawToken.refresh_token || '',
        expiresIn: rawToken.expires_in || 3599,
        expiryTimestamp: rawToken.expiry_timestamp || 0,
        email,
        projectId: rawToken.project_id || '',
        idToken: rawToken.id_token || '',
        isGcpTos: rawToken.is_gcp_tos === true,
        oauthClientKey: rawToken.oauth_client_key || ''
      });
      if (saved?.id) {
        oldIdToNewId.set(rawId, saved.id);
        imported += 1;
      }
    } catch (error) {
      errors.push(`${rawId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (indexDoc) {
    /** @type {Array<[string, 'classic' | 'ide' | 'agy' | 'acp']>} */
    const activeMappings = [
      ['current_account_id', 'classic'],
      ['current_ide_account_id', 'ide'],
      ['current_agy_account_id', 'agy'],
      ['current_acp_account_id', 'acp']
    ];
    for (const [oldKey, slot] of activeMappings) {
      const oldTargetId = indexDoc[oldKey];
      const mapped = oldTargetId ? oldIdToNewId.get(String(oldTargetId)) : null;
      if (mapped) store.setActiveAccount(slot, mapped);
    }
  }

  return {
    total: idList.size,
    imported,
    skipped,
    errors,
    accountIds: Array.from(oldIdToNewId.values())
  };
}

/**
 * Exchange a single refresh token entry with Google OAuth, look up userinfo, and persist.
 * @param {{ email?: string, refreshToken: string, isGcpTos?: boolean, projectId?: string | null, preferredClientKey?: string | null }} entry
 * @param {{ store: any, oauth?: any, fetch?: typeof fetch, env?: NodeJS.ProcessEnv, signal?: AbortSignal }} deps
 */
async function importSingleRefreshToken(entry, deps) {
  const oauthApi = deps.oauth || oauth;
  const preferredKey = entry.preferredClientKey || (entry.isGcpTos ? oauthApi.BUILTIN_GCP_CLIENT_KEY : null);
  const tokenRes = await oauthApi.refreshAccessToken(entry.refreshToken, preferredKey, {
    fetch: deps.fetch,
    env: deps.env,
    signal: deps.signal
  });
  const userInfo = await oauthApi.fetchUserInfo(tokenRes.accessToken, {
    fetch: deps.fetch,
    signal: deps.signal
  });
  const saved = deps.store.upsertAccount({
    email: userInfo.email,
    name: userInfo.name || '',
    disabled: false,
    disabledReason: '',
    disabledAt: null
  }, {
    accessToken: tokenRes.accessToken,
    refreshToken: tokenRes.refreshToken || entry.refreshToken,
    expiresIn: tokenRes.expiresIn,
    expiryTimestamp: tokenRes.expiryTimestamp,
    email: userInfo.email,
    projectId: entry.projectId || '',
    idToken: tokenRes.idToken || '',
    isGcpTos: Boolean(entry.isGcpTos),
    oauthClientKey: tokenRes.oauthClientKey || ''
  });
  return saved;
}

/**
 * Batch import refresh tokens (from JSON export or raw token paste) with concurrency 6.
 * @param {Array<{ email?: string, refreshToken: string, isGcpTos?: boolean, projectId?: string | null }>} entries
 * @param {{
 *   store: any,
 *   oauth?: any,
 *   fetch?: typeof fetch,
 *   env?: NodeJS.ProcessEnv,
 *   signal?: AbortSignal,
 *   onProgress?: (p: { current: number, total: number, success: number, failed: number, email?: string }) => void
 * }} deps
 */
async function batchImportRefreshTokens(entries, deps) {
  const total = entries.length;
  if (total === 0) return { total: 0, success: 0, failed: 0, errors: [], accountIds: [] };

  let nextIdx = 0;
  let current = 0;
  let success = 0;
  let failed = 0;
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const accountIds = [];

  async function worker() {
    while (nextIdx < total) {
      if (deps.signal?.aborted) break;
      const idx = nextIdx;
      nextIdx += 1;
      const item = entries[idx];
      let email = item.email || '';
      try {
        const saved = await importSingleRefreshToken(item, deps);
        email = saved.email || email;
        accountIds.push(saved.id);
        success += 1;
      } catch (error) {
        failed += 1;
        errors.push(`${email || 'unknown'}: ${error instanceof Error ? error.message : String(error)}`);
      }
      current += 1;
      deps.onProgress?.({ current, total, success, failed, email });
    }
  }

  const concurrency = Math.min(6, total);
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return { total, success, failed, errors, accountIds };
}

/**
 * Import from a single Antigravity SQLite state.vscdb file.
 * @param {string} dbPath
 * @param {{ store: any, stateDb?: any, oauth?: any, fetch?: typeof fetch, env?: NodeJS.ProcessEnv, signal?: AbortSignal }} deps
 */
async function importFromStateDbFile(dbPath, deps) {
  const sdb = deps.stateDb || stateDb;
  const extracted = sdb.extractOAuthStateFromDb(dbPath, deps);
  return await importSingleRefreshToken({
    refreshToken: extracted.refreshToken,
    isGcpTos: extracted.isGcpTos,
    projectId: extracted.projectId
  }, deps);
}

/**
 * Scan local OS Keyring, Classic & IDE state.vscdb, and ~/.gemini credential files.
 * @param {{
 *   store: any,
 *   keyring?: any,
 *   stateDb?: any,
 *   fileCredentials?: any,
 *   oauth?: any,
 *   fetch?: typeof fetch,
 *   home?: string,
 *   env?: NodeJS.ProcessEnv,
 *   platform?: NodeJS.Platform,
 *   signal?: AbortSignal,
 *   onProgress?: (p: { current: number, total: number, success: number, failed: number, email?: string }) => void
 * }} deps
 */
async function scanAndImportLocalAccounts(deps) {
  const kr = deps.keyring || keyring;
  const sdb = deps.stateDb || stateDb;
  const fc = deps.fileCredentials || fileCredentials;

  /** @type {Map<string, { email?: string, refreshToken: string, isGcpTos?: boolean, projectId?: string | null }>} */
  const foundByRt = new Map();

  const keyringAccounts = [
    kr.DEFAULT_ACCOUNT || keyring.DEFAULT_ACCOUNT,
    kr.ACP_ACCOUNT || keyring.ACP_ACCOUNT
  ];
  for (const acc of keyringAccounts) {
    try {
      const krOpts = { ...deps, account: acc };
      const res = typeof kr.readFromSystemKeyringAsync === 'function'
        ? await kr.readFromSystemKeyringAsync(krOpts)
        : kr.readFromSystemKeyring(krOpts);
      if (res?.refreshToken && !foundByRt.has(res.refreshToken)) {
        foundByRt.set(res.refreshToken, { email: res.email, refreshToken: res.refreshToken });
      }
    } catch (_) {}
  }

  /** @type {string[]} */
  let dbPaths = [];
  try {
    const candidatePaths = sdb.getAllAntigravityDbPaths(deps);
    dbPaths = Array.isArray(candidatePaths) ? candidatePaths : [];
  } catch (_) {}

  for (const dbPath of dbPaths) {
    try {
      await fs.promises.access(dbPath);
    } catch (_) {
      continue;
    }
    try {
      const state = typeof sdb.extractOAuthStateFromDbAsync === 'function'
        ? await sdb.extractOAuthStateFromDbAsync(dbPath, deps)
        : sdb.extractOAuthStateFromDb(dbPath, deps);
      if (state?.refreshToken && !foundByRt.has(state.refreshToken)) {
        foundByRt.set(state.refreshToken, {
          refreshToken: state.refreshToken,
          isGcpTos: state.isGcpTos,
          projectId: state.projectId
        });
      }
    } catch (_) {}
  }

  try {
    const fileEntries = typeof fc.readLocalCredentialFilesAsync === 'function'
      ? await fc.readLocalCredentialFilesAsync(deps)
      : fc.readLocalCredentialFiles(deps);
    for (const fileEntry of Array.isArray(fileEntries) ? fileEntries : []) {
      if (fileEntry?.refreshToken && !foundByRt.has(fileEntry.refreshToken)) {
        foundByRt.set(fileEntry.refreshToken, {
          email: fileEntry.email,
          refreshToken: fileEntry.refreshToken,
          projectId: fileEntry.projectId || null
        });
      }
    }
  } catch (_) {}

  return await batchImportRefreshTokens(Array.from(foundByRt.values()), deps);
}

/**
 * Import from V1 ~/.antigravity-agent directory (matching migration.rs import_from_v1).
 * @param {string} v1Dir
 * @param {{
 *   store: any,
 *   oauth?: any,
 *   fetch?: typeof fetch,
 *   env?: NodeJS.ProcessEnv,
 *   signal?: AbortSignal,
 *   onProgress?: (p: { current: number, total: number, success: number, failed: number, email?: string }) => void
 * }} deps
 */
async function importFromV1Dir(v1Dir, deps) {
  if (!fs.existsSync(v1Dir)) {
    throw new Error(`V1 directory not found: ${v1Dir}`);
  }
  /** @type {Array<{ email?: string, refreshToken: string }>} */
  const entries = [];
  const seenRt = new Set();

  for (const filename of ['antigravity_accounts.json', 'accounts.json']) {
    const indexPath = path.join(v1Dir, filename);
    if (!fs.existsSync(indexPath)) continue;
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    } catch (_) {
      continue;
    }
    const accountsObj = raw?.accounts && typeof raw.accounts === 'object' && !Array.isArray(raw.accounts)
      ? raw.accounts
      : (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {});

    for (const accInfo of Object.values(accountsObj)) {
      if (!accInfo || typeof accInfo !== 'object') continue;
      const email = String(accInfo.email || '').trim().toLowerCase();
      const target = accInfo.backup_file || accInfo.data_file;
      if (!target) continue;
      const baseName = path.basename(String(target));
      const candidates = [
        resolvePathInsideDir(v1Dir, String(target)),
        resolvePathInsideDir(v1Dir, baseName),
        resolvePathInsideDir(v1Dir, path.join('backups', baseName)),
        resolvePathInsideDir(v1Dir, path.join('accounts', baseName))
      ].filter((c) => Boolean(c));
      const backupFile = candidates.find((c) => c && fs.existsSync(c));
      if (!backupFile) continue;

      try {
        const backupJson = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
        let rt = String(backupJson?.token?.refresh_token || backupJson?.refresh_token || '').trim();
        if (!rt && typeof backupJson?.['jetskiStateSync.agentManagerInitState'] === 'string') {
          const blob = Buffer.from(backupJson['jetskiStateSync.agentManagerInitState'], 'base64');
          const oauthData = protobuf.findField(blob, 6);
          const rtBytes = oauthData ? protobuf.findField(oauthData, 3) : null;
          if (rtBytes) rt = rtBytes.toString('utf8').trim();
        }
        if (rt && !seenRt.has(rt)) {
          seenRt.add(rt);
          entries.push({ ...(email ? { email } : {}), refreshToken: rt });
        }
      } catch (_) {}
    }
  }

  return await batchImportRefreshTokens(entries, deps);
}

/**
 * Export accounts to Antigravity-Manager compatible JSON (`[{ email, refresh_token }]`).
 * @param {any} store
 * @param {string[]} [accountIds]
 * @returns {Array<{ email: string, refresh_token: string }>}
 */
function exportAccountsToJson(store, accountIds = []) {
  const list = store.listAccounts();
  const targetSet = Array.isArray(accountIds) && accountIds.length > 0 ? new Set(accountIds) : null;
  /** @type {Array<{ email: string, refresh_token: string }>} */
  const items = [];
  for (const acc of list) {
    if (targetSet && !targetSet.has(acc.id)) continue;
    const token = store.getAccountToken(acc.id);
    if (!token?.refreshToken) continue;
    items.push({
      email: acc.email,
      refresh_token: token.refreshToken
    });
  }
  return items;
}

module.exports = {
  batchImportRefreshTokens,
  convertRustDeviceProfile,
  convertRustQuota,
  defaultManagerDataDir,
  exportAccountsToJson,
  importFromManagerDataDir,
  importFromStateDbFile,
  importFromV1Dir,
  importSingleRefreshToken,
  parseImportEntriesFromString,
  scanAndImportLocalAccounts
};
