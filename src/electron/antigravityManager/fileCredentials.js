// @ts-check
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const AICODE_SCOPE = 'https://www.googleapis.com/auth/aicode';
const DEFAULT_SCOPES = Object.freeze([
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/cclog',
  'https://www.googleapis.com/auth/experimentsandconfigs',
  AICODE_SCOPE
]);

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [home]
 */
function resolveGeminiDir(env = process.env, home = os.homedir()) {
  const override = String(env?.GEMINI_HOME || '').trim();
  if (override) return path.resolve(override);
  return path.join(home, '.gemini');
}

/**
 * @param {string} filePath
 * @param {unknown} value
 */
function writePrivateJsonFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const text = `${JSON.stringify(value, null, 2)}\n`;
  fs.writeFileSync(filePath, text, { encoding: 'utf8', ...(process.platform !== 'win32' ? { mode: 0o600 } : {}) });
  if (process.platform !== 'win32') {
    try { fs.chmodSync(filePath, 0o600); } catch (_) {}
  }
}

/**
 * @param {{
 *   accessToken: string,
 *   refreshToken: string,
 *   expiryTimestamp: number,
 *   email?: string,
 *   idToken?: string | null
 * }} tokenData
 */
function buildAgyTokenObject(tokenData) {
  const expiryRaw = Number(tokenData.expiryTimestamp || 0);
  const expiryMs = expiryRaw > 10_000_000_000 ? expiryRaw : expiryRaw * 1000;
  const iso = (expiryMs > 0 ? new Date(expiryMs) : new Date()).toISOString();
  const microIso = iso.replace(/\.(\d{3})Z$/, '.$1000Z');
  return {
    token: {
      access_token: String(tokenData.accessToken || ''),
      token_type: 'Bearer',
      refresh_token: String(tokenData.refreshToken || ''),
      expiry: microIso,
      expires_in: 3599
    },
    auth_method: 'consumer',
    ...(tokenData.email ? { id_token_email: String(tokenData.email) } : {}),
    ...(tokenData.idToken ? { id_token: String(tokenData.idToken) } : {})
  };
}

/**
 * Write fallback file credentials matching integration.rs `write_to_file_credentials_to_dir`.
 * Only writes ~/.gemini/antigravity-cli/antigravity-oauth-token when `syncAgyCli` is true.
 *
 * @param {{
 *   accessToken: string,
 *   refreshToken: string,
 *   expiryTimestamp: number,
 *   email?: string,
 *   idToken?: string | null
 * }} tokenData
 * @param {{ syncAgyCli?: boolean, geminiDir?: string, env?: NodeJS.ProcessEnv, home?: string }} [options]
 */
function writeFileCredentials(tokenData, options = {}) {
  const geminiDir = options.geminiDir || resolveGeminiDir(options.env, options.home);
  const agyToken = buildAgyTokenObject(tokenData);

  // 1. Standalone / IDE fallback
  writePrivateJsonFile(path.join(geminiDir, 'jetski-standalone-oauth-token'), agyToken);

  // 2. CLI-specific file (only when switching AGY CLI)
  if (options.syncAgyCli) {
    writePrivateJsonFile(path.join(geminiDir, 'antigravity-cli', 'antigravity-oauth-token'), agyToken);
  }

  // 3. Gemini CLI compatible files
  const expiryRaw = Number(tokenData.expiryTimestamp || 0);
  const expiryMs = expiryRaw > 10_000_000_000 ? expiryRaw : expiryRaw * 1000;
  writePrivateJsonFile(path.join(geminiDir, 'oauth_creds.json'), {
    access_token: String(tokenData.accessToken || ''),
    refresh_token: String(tokenData.refreshToken || ''),
    scope: DEFAULT_SCOPES.join(' '),
    token_type: 'Bearer',
    expiry_date: expiryMs,
    ...(tokenData.idToken ? { id_token: String(tokenData.idToken) } : {})
  });
  if (tokenData.email) {
    writePrivateJsonFile(path.join(geminiDir, 'google_accounts.json'), {
      active: String(tokenData.email),
      old: []
    });
  }
}

/**
 * Write ACP IDE Plugin credentials (~/.gemini/antigravity-acp/acp_token.json).
 * Preserves existing project_id when the refreshToken matches.
 *
 * @param {{
 *   accessToken: string,
 *   refreshToken: string,
 *   expiryTimestamp: number,
 *   email?: string,
 *   projectId?: string | null,
 *   idToken?: string | null
 * }} tokenData
 * @param {{ geminiDir?: string, env?: NodeJS.ProcessEnv, home?: string }} [options]
 */
function writeAcpCredentials(tokenData, options = {}) {
  const geminiDir = options.geminiDir || resolveGeminiDir(options.env, options.home);
  const acpDir = path.join(geminiDir, 'antigravity-acp');
  const acpFile = path.join(acpDir, 'acp_token.json');

  let preservedProjectId = String(tokenData.projectId || '').trim();
  if (!preservedProjectId && fs.existsSync(acpFile)) {
    try {
      const existing = JSON.parse(fs.readFileSync(acpFile, 'utf8'));
      const existingRt = String(existing?.refresh_token || existing?.token?.refresh_token || '').trim();
      if (existingRt && existingRt === String(tokenData.refreshToken || '').trim() && typeof existing?.project_id === 'string') {
        preservedProjectId = existing.project_id.trim();
      }
    } catch (_) {}
  }

  const base = buildAgyTokenObject(tokenData);
  const acpPayload = {
    ...base,
    access_token: String(tokenData.accessToken || ''),
    refresh_token: String(tokenData.refreshToken || ''),
    token_type: 'Bearer',
    scopes: [...DEFAULT_SCOPES],
    ...(preservedProjectId ? { project_id: preservedProjectId } : {})
  };
  writePrivateJsonFile(acpFile, acpPayload);
  return acpFile;
}

/**
 * Read local credential files (for scanning local logged-in accounts).
 * @param {{ geminiDir?: string, env?: NodeJS.ProcessEnv, home?: string }} [options]
 * @returns {Array<{ source: string, refreshToken: string, email: string, projectId: string }>}
 */
function readLocalCredentialFiles(options = {}) {
  const geminiDir = options.geminiDir || resolveGeminiDir(options.env, options.home);
  const candidates = [
    { source: 'standalone-file', file: path.join(geminiDir, 'jetski-standalone-oauth-token') },
    { source: 'cli-file', file: path.join(geminiDir, 'antigravity-cli', 'antigravity-oauth-token') },
    { source: 'acp-file', file: path.join(geminiDir, 'antigravity-acp', 'acp_token.json') },
    { source: 'oauth-creds', file: path.join(geminiDir, 'oauth_creds.json') }
  ];
  /** @type {Array<{ source: string, refreshToken: string, email: string, projectId: string }>} */
  const found = [];
  for (const item of candidates) {
    try {
      if (!fs.existsSync(item.file)) continue;
      const parsed = JSON.parse(fs.readFileSync(item.file, 'utf8'));
      const rt = String(parsed?.token?.refresh_token || parsed?.refresh_token || '').trim();
      if (!rt) continue;
      found.push({
        source: item.source,
        refreshToken: rt,
        email: String(parsed?.id_token_email || parsed?.email || '').trim().toLowerCase(),
        projectId: String(parsed?.project_id || '').trim()
      });
    } catch (_) {}
  }
  return found;
}

module.exports = {
  AICODE_SCOPE,
  DEFAULT_SCOPES,
  buildAgyTokenObject,
  readLocalCredentialFiles,
  resolveGeminiDir,
  writeAcpCredentials,
  writeFileCredentials
};
