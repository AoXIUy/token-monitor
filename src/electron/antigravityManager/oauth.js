// @ts-check
'use strict';

const crypto = require('node:crypto');
const http = require('node:http');
const { _officialOAuthClient } = require('../../shared/providers/antigravity/oauth');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
const TOKEN_REFRESH_SKEW_SECONDS = 900;
const DEFAULT_OAUTH_TIMEOUT_MS = 5 * 60_000;

const BUILTIN_PERSONAL_CLIENT_KEY = 'antigravity_personal';
const BUILTIN_ENTERPRISE_CLIENT_KEY = 'antigravity_enterprise';
const BUILTIN_GCP_CLIENT_KEY = 'antigravity_gcp';

const SCOPES = Object.freeze([
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/cclog',
  'https://www.googleapis.com/auth/experimentsandconfigs',
  'https://www.googleapis.com/auth/aicode'
]);

/**
 * @param {string | null | undefined} clientKey
 * @returns {boolean}
 */
function isGcpEnterpriseClient(clientKey) {
  const key = String(clientKey || '').trim().toLowerCase();
  if (!key) return false;
  return key === BUILTIN_GCP_CLIENT_KEY || key.includes('gcp') || key.includes('vertex');
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
function buildOAuthClients(env = process.env) {
  /** @type {Array<{ key: string, label: string, clientId: string, clientSecret: string, isBuiltin: boolean }>} */
  const clients = [];

  const envStdId = String(env?.ANTIGRAVITY_OAUTH_CLIENT_ID || '').trim();
  const envStdSecret = String(env?.ANTIGRAVITY_OAUTH_CLIENT_SECRET || '').trim();
  const fallbackStd = _officialOAuthClient();
  const stdId = (envStdId && envStdSecret) ? envStdId : String(fallbackStd?.clientId || '').trim();
  const stdSecret = (envStdId && envStdSecret) ? envStdSecret : String(fallbackStd?.clientSecret || '').trim();
  if (stdId && stdSecret) {
    clients.push({
      key: BUILTIN_ENTERPRISE_CLIENT_KEY,
      label: 'Antigravity (Standard)',
      clientId: stdId,
      clientSecret: stdSecret,
      isBuiltin: !(envStdId && envStdSecret)
    });
  }

  const envGcpId = String(env?.ANTIGRAVITY_GCP_OAUTH_CLIENT_ID || '').trim();
  const envGcpSecret = String(env?.ANTIGRAVITY_GCP_OAUTH_CLIENT_SECRET || '').trim();
  if (envGcpId && envGcpSecret) {
    clients.push({
      key: BUILTIN_GCP_CLIENT_KEY,
      label: 'Google Cloud / Vertex AI (Enterprise)',
      clientId: envGcpId,
      clientSecret: envGcpSecret,
      isBuiltin: false
    });
  }

  const rawExtra = String(env?.ANTIGRAVITY_OAUTH_CLIENTS || '').trim();
  if (rawExtra) {
    for (const entry of rawExtra.split(';')) {
      const trimmed = entry.trim();
      if (!trimmed) continue;
      const parts = trimmed.split('|').map((v) => v.trim());
      if (parts.length < 3 || !parts[0] || !parts[1] || !parts[2]) continue;
      const key = parts[0].toLowerCase();
      const custom = {
        key,
        label: parts[3] || key,
        clientId: parts[1],
        clientSecret: parts[2],
        isBuiltin: false
      };
      const existingIdx = clients.findIndex((c) => c.key === key);
      if (existingIdx >= 0) clients[existingIdx] = custom;
      else clients.push(custom);
    }
  }
  return clients;
}

/**
 * @param {string | null | undefined} preferredKey
 * @param {NodeJS.ProcessEnv} [env]
 */
function getCandidateClients(preferredKey, env = process.env) {
  const all = buildOAuthClients(env);
  const norm = String(preferredKey || '').trim().toLowerCase();
  const mappedKey = norm === BUILTIN_PERSONAL_CLIENT_KEY ? BUILTIN_ENTERPRISE_CLIENT_KEY : norm;
  if (!mappedKey) return all;
  const preferred = all.find((c) => c.key === mappedKey);
  if (!preferred) return all;
  return [preferred, ...all.filter((c) => c.key !== preferred.key)];
}

/**
 * @param {string | null | undefined} clientKey
 * @param {NodeJS.ProcessEnv} [env]
 */
function selectAuthClient(clientKey, env = process.env) {
  const all = buildOAuthClients(env);
  const norm = String(clientKey || '').trim().toLowerCase();
  const activeKey = norm === BUILTIN_PERSONAL_CLIENT_KEY
    ? BUILTIN_ENTERPRISE_CLIENT_KEY
    : (norm || String(env?.ANTIGRAVITY_OAUTH_CLIENT_KEY || '').trim().toLowerCase() || BUILTIN_ENTERPRISE_CLIENT_KEY);
  const matched = all.find((c) => c.key === activeKey);
  if (matched) return matched;
  if (isGcpEnterpriseClient(activeKey)) {
    throw new Error('Enterprise/GCP OAuth client is not configured. Set ANTIGRAVITY_GCP_OAUTH_CLIENT_ID and ANTIGRAVITY_GCP_OAUTH_CLIENT_SECRET (or ANTIGRAVITY_OAUTH_CLIENTS).');
  }
  if (all.length === 0) {
    throw new Error('No Google OAuth client is configured');
  }
  return all[0];
}

/**
 * @param {Record<string, string>} params
 */
function formEncode(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && String(v) !== '') sp.set(k, String(v));
  }
  return sp.toString();
}

/**
 * @param {Response} response
 * @param {string} action
 */
async function parseOAuthResponse(response, action) {
  const text = await response.text().catch(() => '');
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (_) {}
  if (response.ok) return body || {};
  const errCode = String(body?.error || '').trim();
  const detail = String(body?.error_description || body?.error?.message || errCode || text || `HTTP ${response.status}`).trim();
  const error = new Error(`${action}: ${detail}`);
  /** @type {any} */ (error).httpStatus = response.status;
  /** @type {any} */ (error).oauthError = errCode;
  throw error;
}

/**
 * @param {string} refreshToken
 * @param {string | null | undefined} preferredClientKey
 * @param {{ fetch?: typeof fetch, env?: NodeJS.ProcessEnv, signal?: AbortSignal, nowSec?: () => number }} [deps]
 */
async function refreshAccessToken(refreshToken, preferredClientKey = null, deps = {}) {
  const rt = String(refreshToken || '').trim();
  if (!rt) throw new Error('Refresh token is empty');
  const fetchFn = deps.fetch || fetch;
  const candidates = getCandidateClients(preferredClientKey, deps.env);
  let lastError = null;

  for (let i = 0; i < candidates.length; i += 1) {
    const client = candidates[i];
    try {
      const response = await fetchFn(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: formEncode({
          client_id: client.clientId,
          client_secret: client.clientSecret,
          refresh_token: rt,
          grant_type: 'refresh_token'
        }),
        signal: deps.signal
      });
      const payload = await parseOAuthResponse(response, 'Google OAuth refresh failed');
      const accessToken = String(payload.access_token || '').trim();
      if (!accessToken) throw new Error('Google OAuth refresh returned no access_token');
      const expiresIn = Math.max(60, Number(payload.expires_in) || 3599);
      const nowSec = deps.nowSec ? deps.nowSec() : Math.floor(Date.now() / 1000);
      return {
        accessToken,
        refreshToken: String(payload.refresh_token || '').trim() || rt,
        expiresIn,
        expiryTimestamp: nowSec + expiresIn,
        idToken: String(payload.id_token || '').trim(),
        oauthClientKey: client.key
      };
    } catch (error) {
      lastError = error;
      const msg = String(error instanceof Error ? error.message : error).toLowerCase();
      const oauthErr = String(/** @type {any} */ (error)?.oauthError || '').toLowerCase();
      if (oauthErr === 'invalid_grant' || msg.includes('invalid_grant')) {
        throw error;
      }
      const isClientError = oauthErr === 'invalid_client' || oauthErr === 'unauthorized_client' || msg.includes('invalid_client') || msg.includes('unauthorized_client');
      if (!isClientError && i < candidates.length - 1) {
        // Also retry fallback client on 400/401 client mismatch
        const status = Number(/** @type {any} */ (error)?.httpStatus || 0);
        if (status !== 400 && status !== 401) throw error;
      }
    }
  }
  throw lastError || new Error('Google OAuth refresh failed');
}

/**
 * @param {{
 *   accessToken?: string,
 *   refreshToken: string,
 *   expiryTimestamp?: number,
 *   expiresIn?: number,
 *   email?: string,
 *   projectId?: string,
 *   idToken?: string,
 *   isGcpTos?: boolean,
 *   oauthClientKey?: string
 * }} currentToken
 * @param {{ fetch?: typeof fetch, env?: NodeJS.ProcessEnv, signal?: AbortSignal, nowSec?: () => number }} [deps]
 */
async function ensureFreshToken(currentToken, deps = {}) {
  const nowSec = deps.nowSec ? deps.nowSec() : Math.floor(Date.now() / 1000);
  const expiry = Number(currentToken?.expiryTimestamp || 0);
  if (currentToken?.accessToken && expiry > nowSec + TOKEN_REFRESH_SKEW_SECONDS) {
    return { ...currentToken };
  }
  const refreshed = await refreshAccessToken(currentToken?.refreshToken, currentToken?.oauthClientKey, deps);
  return {
    ...currentToken,
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken || currentToken.refreshToken,
    expiresIn: refreshed.expiresIn,
    expiryTimestamp: refreshed.expiryTimestamp,
    idToken: refreshed.idToken || currentToken.idToken || '',
    oauthClientKey: refreshed.oauthClientKey || currentToken.oauthClientKey || ''
  };
}

/**
 * @param {string} accessToken
 * @param {{ fetch?: typeof fetch, signal?: AbortSignal }} [deps]
 */
async function fetchUserInfo(accessToken, deps = {}) {
  const response = await (deps.fetch || fetch)(USERINFO_URL, {
    headers: { authorization: `Bearer ${String(accessToken || '').trim()}` },
    signal: deps.signal
  });
  const data = await parseOAuthResponse(response, 'Failed to fetch Google userinfo');
  const email = String(data.email || '').trim().toLowerCase();
  if (!email) throw new Error('Google userinfo response missing email');
  const given = String(data.given_name || '').trim();
  const family = String(data.family_name || '').trim();
  const name = String(data.name || '').trim() || [given, family].filter(Boolean).join(' ');
  return {
    email,
    name,
    picture: String(data.picture || '').trim()
  };
}

/**
 * @param {{ code: string, redirectUri: string, codeVerifier: string, clientKey?: string }} params
 * @param {{ fetch?: typeof fetch, env?: NodeJS.ProcessEnv, signal?: AbortSignal, nowSec?: () => number }} [deps]
 */
async function exchangeAuthorizationCode({ code, redirectUri, codeVerifier, clientKey }, deps = {}) {
  const client = selectAuthClient(clientKey, deps.env);
  const response = await (deps.fetch || fetch)(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: formEncode({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      code,
      code_verifier: codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri
    }),
    signal: deps.signal
  });
  const payload = await parseOAuthResponse(response, 'Google OAuth code exchange failed');
  const accessToken = String(payload.access_token || '').trim();
  const refreshToken = String(payload.refresh_token || '').trim();
  if (!accessToken) throw new Error('Google OAuth returned no access_token');
  if (!refreshToken) throw new Error('Google OAuth did not return a refresh_token (please ensure offline consent)');
  const expiresIn = Math.max(60, Number(payload.expires_in) || 3599);
  const nowSec = deps.nowSec ? deps.nowSec() : Math.floor(Date.now() / 1000);
  const userInfo = await fetchUserInfo(accessToken, deps);
  return {
    identity: userInfo,
    token: {
      accessToken,
      refreshToken,
      expiresIn,
      expiryTimestamp: nowSec + expiresIn,
      email: userInfo.email,
      projectId: '',
      idToken: String(payload.id_token || '').trim(),
      isGcpTos: isGcpEnterpriseClient(client.key),
      oauthClientKey: client.key
    }
  };
}

/**
 * @param {string} a
 * @param {string} b
 */
function timingSafeEqualStr(a, b) {
  const ha = crypto.createHash('sha256').update(String(a || ''), 'utf8').digest();
  const hb = crypto.createHash('sha256').update(String(b || ''), 'utf8').digest();
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * Run loopback browser OAuth flow on 127.0.0.1 ephemeral port with PKCE + 32-byte state.
 * @param {{
 *   clientKey?: string,
 *   fetch?: typeof fetch,
 *   openExternal: (url: string) => unknown,
 *   signal?: AbortSignal,
 *   env?: NodeJS.ProcessEnv,
 *   timeoutMs?: number,
 *   onAuthUrl?: (url: string) => void
 * }} options
 */
async function runOAuthLogin(options) {
  const { clientKey, fetch: fetchFn, openExternal, signal, env, onAuthUrl } = options;
  const timeoutMs = Number.isFinite(Number(options.timeoutMs)) ? Math.max(0, Number(options.timeoutMs)) : DEFAULT_OAUTH_TIMEOUT_MS;
  const client = selectAuthClient(clientKey, env);
  const state = crypto.randomBytes(32).toString('base64url');
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

  /** @type {http.Server | null} */
  let server = null;
  let redirectUri = '';
  /** @type {string} */
  let code;
  try {
    code = await new Promise((resolve, reject) => {
      let settled = false;
      /** @type {ReturnType<typeof setTimeout> | null} */
      let timer = null;
      /**
       * @param {any} err
       * @param {string} [value]
       */
      const finish = (err, value) => {
        if (settled) return;
        settled = true;
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        signal?.removeEventListener('abort', onAbort);
        if (err) reject(err);
        else resolve(String(value || ''));
      };
      const onAbort = () => {
        const err = new Error('OAuth login cancelled');
        err.name = 'AbortError';
        finish(err);
      };
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });

      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          const err = new Error('OAuth login timed out');
          err.name = 'TimeoutError';
          finish(err);
        }, timeoutMs);
        timer.unref?.();
      }

      const activeServer = http.createServer((req, res) => {
        const baseHeaders = {
          'cache-control': 'no-store',
          connection: 'close'
        };
        if (req.method !== 'GET') {
          res.writeHead(405, { ...baseHeaders, 'content-type': 'text/plain; charset=utf-8' });
          res.end('Method not allowed');
          return;
        }
        /** @type {URL} */
        let reqUrl;
        try {
          reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
        } catch (_) {
          res.writeHead(400, { ...baseHeaders, 'content-type': 'text/plain; charset=utf-8' });
          res.end('Invalid request URL');
          return;
        }
        if (reqUrl.pathname !== '/callback' && reqUrl.pathname !== '/oauth-callback') {
          res.writeHead(404, { ...baseHeaders, 'content-type': 'text/plain; charset=utf-8' });
          res.end('Not found');
          return;
        }
        const incomingState = reqUrl.searchParams.get('state') || '';
        if (!incomingState || !timingSafeEqualStr(incomingState, state)) {
          res.writeHead(400, { ...baseHeaders, 'content-type': 'text/html; charset=utf-8' });
          res.end('<html><body><h3>Invalid OAuth state</h3></body></html>');
          return;
        }
        const oauthError = reqUrl.searchParams.get('error');
        if (oauthError) {
          res.writeHead(400, { ...baseHeaders, 'content-type': 'text/html; charset=utf-8' });
          res.end('<html><body><h3>Authorization failed. You may close this tab.</h3></body></html>');
          finish(new Error(`Google OAuth denied: ${oauthError}`));
          return;
        }
        const authCode = reqUrl.searchParams.get('code') || '';
        if (!authCode) {
          res.writeHead(400, { ...baseHeaders, 'content-type': 'text/html; charset=utf-8' });
          res.end('<html><body><h3>Missing authorization code</h3></body></html>');
          return;
        }
        res.writeHead(200, { ...baseHeaders, 'content-type': 'text/html; charset=utf-8' });
        res.end('<html><body><h3>Login complete. You may close this window and return to Token Monitor.</h3></body></html>');
        finish(null, authCode);
      });
      server = activeServer;

      activeServer.on('error', (err) => finish(err));
      activeServer.listen(0, '127.0.0.1', () => {
        const addr = activeServer.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        redirectUri = `http://127.0.0.1:${port}/callback`;
        const authUrl = new URL(AUTH_URL);
        authUrl.searchParams.set('client_id', client.clientId);
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('scope', SCOPES.join(' '));
        authUrl.searchParams.set('access_type', 'offline');
        authUrl.searchParams.set('prompt', 'select_account consent');
        authUrl.searchParams.set('state', state);
        authUrl.searchParams.set('code_challenge', codeChallenge);
        authUrl.searchParams.set('code_challenge_method', 'S256');
        const urlStr = authUrl.toString();
        onAuthUrl?.(urlStr);
        Promise.resolve(openExternal(urlStr)).catch((err) => finish(err));
      });
    });
  } finally {
    const active = /** @type {http.Server | null} */ (server);
    try { active?.closeAllConnections?.(); } catch (_) {}
    try { active?.close(); } catch (_) {}
  }

  return await exchangeAuthorizationCode({ code, redirectUri, codeVerifier, clientKey: client.key }, { fetch: fetchFn, env, signal });
}

module.exports = {
  BUILTIN_ENTERPRISE_CLIENT_KEY,
  BUILTIN_GCP_CLIENT_KEY,
  BUILTIN_PERSONAL_CLIENT_KEY,
  DEFAULT_OAUTH_TIMEOUT_MS,
  SCOPES,
  TOKEN_REFRESH_SKEW_SECONDS,
  buildOAuthClients,
  ensureFreshToken,
  exchangeAuthorizationCode,
  fetchUserInfo,
  getCandidateClients,
  isGcpEnterpriseClient,
  refreshAccessToken,
  runOAuthLogin,
  selectAuthClient
};
