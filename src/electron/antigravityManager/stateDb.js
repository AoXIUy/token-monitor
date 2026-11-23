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
  const home = deps.home || os.homedir();
  const env = deps.env || process.env;
  /** @type {string[]} */
  const paths = [];

  if (deps.userDataDir) {
    paths.push(path.join(deps.userDataDir, 'User', 'globalStorage', 'state.vscdb'));
  }
  if (deps.executablePath) {
    paths.push(path.join(path.dirname(deps.executablePath), 'data', 'user-data', 'User', 'globalStorage', 'state.vscdb'));
  }

  const folderNames = targetIde === 'ide'
    ? ['Antigravity IDE', 'antigravity-ide', 'antigravity_ide']
    : ['Antigravity'];

  if (platform === 'darwin' && home) {
    for (const folder of folderNames) {
      paths.push(path.join(home, 'Library', 'Application Support', folder, 'User', 'globalStorage', 'state.vscdb'));
    }
  } else if (platform === 'win32') {
    const appData = env.APPDATA || '';
    if (appData) {
      for (const folder of folderNames) {
        paths.push(path.join(appData, folder, 'User', 'globalStorage', 'state.vscdb'));
      }
    }
  } else if (home) {
    for (const folder of folderNames) {
      paths.push(path.join(home, '.config', folder, 'User', 'globalStorage', 'state.vscdb'));
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
      const isGcpTos = field6 === null ? true : field6 !== 0n;
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
    return { refreshToken, isGcpTos: true, projectId };
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
 *   oauthClientKey?: string | null
 * }} payload
 * @param {{ sqlite?: any, createBackup?: boolean }} [deps]
 */
function injectTokenToDb(dbPath, payload, deps = {}) {
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

  if (deps.createBackup !== false && fs.existsSync(dbPath)) {
    try {
      fs.copyFileSync(dbPath, `${dbPath}.backup`);
    } catch (_) {}
  }

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new sqlite.DatabaseSync(dbPath);
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

    const existingTopicVal = readItemValue(db, 'antigravityUnifiedStateSync.oauthToken');
    const currentTopic = existingTopicVal ? Buffer.from(existingTopicVal, 'base64') : Buffer.alloc(0);
    let topic = currentTopic.length > 0
      ? protobuf.removeUnifiedTopicEntry(currentTopic, 'oauthTokenInfoSentinelKey')
      : Buffer.alloc(0);
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
    db.prepare('DELETE FROM ItemTable WHERE key = ?').run('jetskiStateSync.agentManagerInitState');

    return 'Token injection successful (new format)';
  } finally {
    try { db.close(); } catch (_) {}
  }
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
  writeItemTableValue,
  writeServiceMachineId
};
