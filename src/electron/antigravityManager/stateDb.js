// @ts-check
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const protobuf = require('./protobuf');
const { isGcpEnterpriseClient } = require('./oauth');

/** @type {any} */
let defaultSqlite = null;
function getSqlite() {
  if (defaultSqlite !== null) return defaultSqlite;
  try {
    defaultSqlite = require('node:sqlite');
  } catch (_) {
    defaultSqlite = null;
  }
  return defaultSqlite;
}

/**
 * Candidate state.vscdb paths matching Antigravity-Manager db.rs.
 * Strictly isolates `ide` and `classic`.
 *
 * @param {string | null} [targetIde]
 * @param {{
 *   platform?: NodeJS.Platform,
 *   home?: string,
 *   env?: NodeJS.ProcessEnv,
 *   userDataDir?: string | null,
 *   executablePath?: string | null
 * }} [deps]
 * @returns {string[]}
 */
function getAllCandidateDbPaths(targetIde = null, deps = {}) {
  const platform = deps.platform || process.platform;
  const pathApi = platform === 'win32' ? path.win32 : path;
  const home = deps.home || os.homedir();
  const env = deps.env || process.env;
  /** @type {string[]} */
  const paths = [];

  if (deps.userDataDir) {
    paths.push(pathApi.join(deps.userDataDir, 'User', 'globalStorage', 'state.vscdb'));
  }
  if (deps.executablePath) {
    paths.push(pathApi.join(pathApi.dirname(deps.executablePath), 'data', 'user-data', 'User', 'globalStorage', 'state.vscdb'));
  }

  const folderNames = targetIde === 'ide'
    ? ['Antigravity IDE', 'antigravity-ide', 'antigravity_ide']
    : ['Antigravity'];

  if (platform === 'darwin' && home) {
    for (const folder of folderNames) {
      paths.push(pathApi.join(home, 'Library', 'Application Support', folder, 'User', 'globalStorage', 'state.vscdb'));
    }
  } else if (platform === 'win32') {
    const appData = env.APPDATA || '';
    if (appData) {
      for (const folder of folderNames) {
        paths.push(pathApi.join(appData, folder, 'User', 'globalStorage', 'state.vscdb'));
      }
    }
  } else if (home) {
    for (const folder of folderNames) {
      paths.push(pathApi.join(home, '.config', folder, 'User', 'globalStorage', 'state.vscdb'));
    }
  }

  return [...new Set(paths)];
}

/**
 * @param {{ platform?: NodeJS.Platform, home?: string, env?: NodeJS.ProcessEnv }} [deps]
 */
function getAllAntigravityDbPaths(deps = {}) {
  return [...new Set([
    ...getAllCandidateDbPaths('classic', deps),
    ...getAllCandidateDbPaths('ide', deps)
  ])];
}

/**
 * @param {string | null} [targetIde]
 * @param {object} [deps]
 */
function getDbPath(targetIde = null, deps = {}) {
  const candidates = getAllCandidateDbPaths(targetIde, deps);
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  if (candidates.length > 0) return candidates[0];
  throw new Error('Failed to locate Antigravity database path');
}

/**
 * @param {any} db
 * @param {string} key
 * @returns {string | null}
 */
function readItemValue(db, key) {
  const row = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get(key);
  if (!row || row.value === undefined || row.value === null) return null;
  if (Buffer.isBuffer(row.value) || row.value instanceof Uint8Array) {
    return Buffer.from(row.value).toString('utf8');
  }
  return String(row.value);
}

/**
 * @param {any} db
 * @returns {string | null}
 */
function extractEnterpriseProjectIdFromDb(db) {
  const raw = readItemValue(db, 'antigravityUnifiedStateSync.enterprisePreferences');
  if (!raw) return null;
  try {
    const decoded = protobuf.decodeUnifiedStateEntryWithTarget(raw, 'enterpriseGcpProjectId');
    if (decoded.sentinelKey !== 'enterpriseGcpProjectId') return null;
    const valueBuf = protobuf.findField(decoded.payload, 3);
    if (!valueBuf) return null;
    const pid = valueBuf.toString('utf8').trim();
    return pid || null;
  } catch (_) {
    return null;
  }
}

/**
 * @param {any} db
 * @returns {boolean}
 */
function readOnboardingIsGcpTos(db) {
  const agyFlag = readItemValue(db, 'agy.onboarding.lastLoginIsGcpTos');
  if (agyFlag !== null) return agyFlag.trim().toLowerCase() === 'true';
  const jetskiFlag = readItemValue(db, 'jetski.onboarding.lastLoginIsGcpTos');
  if (jetskiFlag !== null) return jetskiFlag.trim().toLowerCase() === 'true';
  return false;
}

/**
 * Extract OAuth refresh_token, isGcpTos, and optional projectId from state.vscdb.
 * Supports both unified state sync format and legacy jetskiStateSync format.
 *
 * @param {string} dbPath
 * @param {{ sqlite?: any }} [deps]
 * @returns {{ refreshToken: string, isGcpTos: boolean, projectId: string | null }}
 */
function extractOAuthStateFromDb(dbPath, deps = {}) {
  const sqlite = deps.sqlite || getSqlite();
  if (!sqlite || typeof sqlite.DatabaseSync !== 'function') {
    throw new Error('node:sqlite is unavailable in this runtime');
  }
  const db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
  try {
    const unifiedVal = readItemValue(db, 'antigravityUnifiedStateSync.oauthToken');
    if (unifiedVal) {
      const { sentinelKey, payload } = protobuf.decodeUnifiedStateEntryWithTarget(
        unifiedVal,
        'oauthTokenInfoSentinelKey'
      );
      if (sentinelKey !== 'oauthTokenInfoSentinelKey') {
        throw new Error(`Unexpected OAuth sentinel key: ${sentinelKey}`);
      }
      const rtBytes = protobuf.findField(payload, 3);
      if (!rtBytes) throw new Error('Refresh Token not found in OAuthInfo (Field 3)');
      const refreshToken = rtBytes.toString('utf8').trim();
      if (!refreshToken) throw new Error('Refresh Token in OAuthInfo is empty');
      const field6 = protobuf.findVarintField(payload, 6);
      const isGcpTos = field6 !== null ? field6 !== 0n : readOnboardingIsGcpTos(db);
      const projectId = extractEnterpriseProjectIdFromDb(db);
      return { refreshToken, isGcpTos, projectId };
    }

    const legacyVal = readItemValue(db, 'jetskiStateSync.agentManagerInitState');
    if (!legacyVal) {
      throw new Error('Login state data not found in either format');
    }
    const blob = Buffer.from(legacyVal, 'base64');
    const oauthData = protobuf.findField(blob, 6);
    if (!oauthData) throw new Error('OAuth data not found (Field 6)');
    const rtBytes = protobuf.findField(oauthData, 3);
    if (!rtBytes) throw new Error('Refresh Token not included in data (Field 3)');
    const refreshToken = rtBytes.toString('utf8').trim();
    if (!refreshToken) throw new Error('Refresh Token in legacy data is empty');
    const projectId = extractEnterpriseProjectIdFromDb(db);
    return { refreshToken, isGcpTos: readOnboardingIsGcpTos(db), projectId };
  } finally {
    try { db.close(); } catch (_) {}
  }
}

const BACKUP_FRESH_MS = 60_000;

/**
 * Execute the SQLite ItemTable transaction for OAuth token + optional machine IDs.
 *
 * @param {string} dbPath
 * @param {{
 *   accessToken: string,
 *   refreshToken: string,
 *   expiry: number,
 *   email: string,
 *   isGcpTos?: boolean,
 *   projectId?: string | null,
 *   idToken?: string | null,
 *   oauthClientKey?: string | null,
 *   serviceMachineId?: string | null,
 *   storageServiceMachineId?: string | null
 * }} payload
 * @param {{ sqlite?: any }} [deps]
 */
function runInjectTokenTransaction(dbPath, payload, deps = {}) {
  const sqlite = deps.sqlite || getSqlite();
  if (!sqlite || typeof sqlite.DatabaseSync !== 'function') {
    throw new Error('node:sqlite is unavailable in this runtime');
  }

  let isGcpTos = Boolean(payload.isGcpTos);
  const clientKey = String(payload.oauthClientKey || '').trim().toLowerCase();
  if (clientKey) {
    if (isGcpEnterpriseClient(clientKey)) isGcpTos = true;
    else if (clientKey === 'antigravity_enterprise' || clientKey === 'antigravity_personal') isGcpTos = false;
  }

  const db = new sqlite.DatabaseSync(dbPath);
  let inTx = false;
  try {
    db.exec('PRAGMA busy_timeout = 2000;');
    db.exec('CREATE TABLE IF NOT EXISTS ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);');

    const oauthInfo = protobuf.createOAuthInfo({
      accessToken: payload.accessToken,
      refreshToken: payload.refreshToken,
      expiry: payload.expiry,
      isGcpTos,
      idToken: payload.idToken || null,
      email: payload.email
    });

    db.exec('BEGIN IMMEDIATE;');
    inTx = true;

    const existingTopicVal = readItemValue(db, 'antigravityUnifiedStateSync.oauthToken');
    const currentTopic = existingTopicVal ? Buffer.from(existingTopicVal, 'base64') : Buffer.alloc(0);
    /** @type {Buffer} */
    let topic = Buffer.alloc(0);
    if (currentTopic.length > 0) {
      try {
        topic = protobuf.removeUnifiedTopicEntry(currentTopic, 'oauthTokenInfoSentinelKey');
      } catch (_) {
        topic = Buffer.alloc(0);
      }
    }
    topic = Buffer.concat([topic, protobuf.createUnifiedTopicEntry('oauthTokenInfoSentinelKey', oauthInfo)]);

    const upsert = db.prepare('INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)');
    upsert.run('antigravityUnifiedStateSync.oauthToken', topic.toString('base64'));

    const userStatusPayload = protobuf.createMinimalUserStatusPayload(payload.email);
    upsert.run(
      'antigravityUnifiedStateSync.userStatus',
      protobuf.createUnifiedStateEntry('userStatusSentinelKey', userStatusPayload)
    );

    const pid = String(payload.projectId || '').trim();
    if (pid) {
      const prefPayload = protobuf.createStringValuePayload(pid);
      upsert.run(
        'antigravityUnifiedStateSync.enterprisePreferences',
        protobuf.createUnifiedStateEntry('enterpriseGcpProjectId', prefPayload)
      );
    } else {
      db.prepare('DELETE FROM ItemTable WHERE key = ?').run('antigravityUnifiedStateSync.enterprisePreferences');
    }

    upsert.run('antigravityOnboarding', 'true');
    upsert.run('agy.onboarding.lastLoginUsername', payload.email);
    upsert.run('agy.onboarding.lastLoginIsGcpTos', isGcpTos ? 'true' : 'false');
    upsert.run('jetski.onboarding.lastLoginUsername', payload.email);
    upsert.run('jetski.onboarding.lastLoginIsGcpTos', isGcpTos ? 'true' : 'false');
    if (payload.storageServiceMachineId) {
      upsert.run('storage.serviceMachineId', String(payload.storageServiceMachineId));
    }
    if (payload.serviceMachineId) {
      upsert.run('telemetry.serviceMachineId', String(payload.serviceMachineId));
    }
    db.prepare('DELETE FROM ItemTable WHERE key = ?').run('jetskiStateSync.agentManagerInitState');

    db.exec('COMMIT;');
    inTx = false;

    return 'Token injection successful (new format)';
  } catch (error) {
    if (inTx) {
      try { db.exec('ROLLBACK;'); } catch (_) {}
    }
    throw error;
  } finally {
    try { db.close(); } catch (_) {}
  }
}

/**
 * Inject OAuth token and email into state.vscdb (new unified format), preserving unrelated topic entries.
 *
 * @param {string} dbPath
 * @param {{
 *   accessToken: string,
 *   refreshToken: string,
 *   expiry: number,
 *   email: string,
 *   isGcpTos?: boolean,
 *   projectId?: string | null,
 *   idToken?: string | null,
 *   oauthClientKey?: string | null,
 *   serviceMachineId?: string | null,
 *   storageServiceMachineId?: string | null
 * }} payload
 * @param {{ sqlite?: any, createBackup?: boolean }} [deps]
 */
function injectTokenToDb(dbPath, payload, deps = {}) {
  const sqlite = deps.sqlite || getSqlite();
  if (!sqlite || typeof sqlite.DatabaseSync !== 'function') {
    throw new Error('node:sqlite is unavailable in this runtime');
  }

  if (deps.createBackup !== false && fs.existsSync(dbPath)) {
    const backupTmp = `${dbPath}.backup.${process.pid}.${Date.now()}.tmp`;
    try {
      fs.copyFileSync(dbPath, backupTmp);
      fs.renameSync(backupTmp, `${dbPath}.backup`);
    } catch (_) {
      try { fs.unlinkSync(backupTmp); } catch (_) {}
    }
  }

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  return runInjectTokenTransaction(dbPath, payload, deps);
}

/**
 * Non-blocking backup + single-transaction token & machineId injection for UI switches.
 * Offloads large `state.vscdb` file copies to libuv's threadpool and skips redundant
 * copies when a fresh backup (< 60s old) already exists.
 *
 * @param {string} dbPath
 * @param {{
 *   accessToken: string,
 *   refreshToken: string,
 *   expiry: number,
 *   email: string,
 *   isGcpTos?: boolean,
 *   projectId?: string | null,
 *   idToken?: string | null,
 *   oauthClientKey?: string | null,
 *   serviceMachineId?: string | null,
 *   storageServiceMachineId?: string | null
 * }} payload
 * @param {{ sqlite?: any, createBackup?: boolean, forceBackup?: boolean }} [deps]
 */
async function injectTokenToDbAsync(dbPath, payload, deps = {}) {
  const sqlite = deps.sqlite || getSqlite();
  if (!sqlite || typeof sqlite.DatabaseSync !== 'function') {
    throw new Error('node:sqlite is unavailable in this runtime');
  }

  if (deps.createBackup !== false) {
    let dbExists = false;
    try {
      await fs.promises.access(dbPath);
      dbExists = true;
    } catch (_) {}

    if (dbExists) {
      const backupPath = `${dbPath}.backup`;
      let shouldCopy = deps.forceBackup === true;
      if (!shouldCopy) {
        try {
          const st = await fs.promises.stat(backupPath);
          shouldCopy = Date.now() - st.mtimeMs >= BACKUP_FRESH_MS;
        } catch (_) {
          shouldCopy = true;
        }
      }
      if (shouldCopy) {
        const backupTmp = `${dbPath}.backup.${process.pid}.${Date.now()}.tmp`;
        try {
          await fs.promises.copyFile(dbPath, backupTmp);
          await fs.promises.rename(backupTmp, backupPath);
        } catch (_) {
          try { await fs.promises.unlink(backupTmp); } catch (_) {}
        }
      }
    }
  }

  await fs.promises.mkdir(path.dirname(dbPath), { recursive: true });
  return runInjectTokenTransaction(dbPath, payload, deps);
}

/**
 * @param {string} dbPath
 * @param {string} key
 * @param {string} value
 * @param {{ sqlite?: any }} [deps]
 */
function writeItemTableValue(dbPath, key, value, deps = {}) {
  const sqlite = deps.sqlite || getSqlite();
  if (!sqlite || typeof sqlite.DatabaseSync !== 'function') {
    throw new Error('node:sqlite is unavailable in this runtime');
  }
  const db = new sqlite.DatabaseSync(dbPath);
  try {
    db.exec('PRAGMA busy_timeout = 2000;');
    db.exec('CREATE TABLE IF NOT EXISTS ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);');
    db.prepare('INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)').run(key, value);
  } finally {
    try { db.close(); } catch (_) {}
  }
}

/**
 * @param {string} dbPath
 * @param {string} serviceMachineId
 * @param {{ sqlite?: any }} [deps]
 */
function writeServiceMachineId(dbPath, serviceMachineId, deps = {}) {
  writeItemTableValue(dbPath, 'telemetry.serviceMachineId', serviceMachineId, deps);
}

module.exports = {
  extractOAuthStateFromDb,
  getAllAntigravityDbPaths,
  getAllCandidateDbPaths,
  getDbPath,
  injectTokenToDb,
  injectTokenToDbAsync,
  writeItemTableValue,
  writeServiceMachineId
};
