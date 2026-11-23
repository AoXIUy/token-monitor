// @ts-check
'use strict';

/**
 * Scoped Hub client HTTP(S) transport for Desktop Electron, Headless Agent, and MCP.
 *
 * Client-only module (not imported by `src/hub/server.js`, not in `WORKER_SHARED_MODULES`):
 *   - Pairs `undici.Agent` with `undici.fetch` from `require('undici')` to avoid
 *     Node built-in undici vs npm undici dispatcher symbol mismatches.
 *   - Scopes optional custom CA certificates strictly per Hub connection without
 *     modifying global Node/Electron TLS trust or disabling hostname verification.
 *   - Enforces `redirect: 'error'`, `minVersion: 'TLSv1.2'`, `rejectUnauthorized: true`,
 *     and bounded default request timeouts (disableable for long-lived SSE streams).
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const { Agent: UndiciAgent, fetch: undiciFetch } = require('undici');
const { readRegularFileNoFollow } = require('./credentialStore');

const DEFAULT_HUB_TIMEOUT_MS = 15_000;
const MAX_CLIENT_CA_BYTES = 256 * 1024;
const MAX_CLIENT_CA_CERTS = 10;
const MAX_SECRET_FILE_BYTES = 8 * 1024;
const PRIVATE_KEY_HEADER_RE = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i;
const PEM_CERT_BLOCK_RE = /-----BEGIN CERTIFICATE-----[\r\n]+([A-Za-z0-9+/=\r\n]+)-----END CERTIFICATE-----/g;
const MIN_RSA_BITS = 2048;
const ALLOWED_EC_CURVES = new Set(['prime256v1', 'secp384r1', 'secp521r1', 'P-256', 'P-384', 'P-521']);

/** @type {Map<string, { Ctor: any, agent: any }>} */
const agentCache = new Map();

/**
 * @param {string} code
 * @param {string} message
 * @param {unknown} [cause]
 * @returns {Error & { code: string }}
 */
function tlsClientError(code, message, cause) {
  const err = /** @type {Error & { code: string }} */ (
    cause !== undefined ? new Error(message, { cause }) : new Error(message)
  );
  err.code = code;
  return err;
}

/**
 * @param {string} hostname
 * @returns {boolean}
 */
function isLoopbackHost(hostname) {
  let host = String(hostname || '').trim().toLowerCase().replace(/\.$/, '');
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (!host) return false;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
  if (net.isIP(host) === 4 && host.startsWith('127.')) return true;
  if (host.startsWith('::ffff:127.')) return true;
  return false;
}

/**
 * @param {string} urlInput
 * @returns {boolean}
 */
function isInsecureRemoteHttpUrl(urlInput) {
  const raw = String(urlInput || '').trim();
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' && !isLoopbackHost(parsed.hostname);
  } catch (_) {
    return false;
  }
}

/**
 * @param {string | Buffer} pem
 * @returns {string}
 */
function caFingerprintSha256(pem) {
  const text = Buffer.isBuffer(pem) ? pem.toString('utf8').trim() : String(pem || '').trim();
  if (!text) return '';
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * @param {crypto.X509Certificate} cert
 */
function assertClientCaKeyStrength(cert) {
  const pub = cert.publicKey;
  if (!pub) throw tlsClientError('tls_weak_key', 'Certificate has no public key');
  const type = pub.asymmetricKeyType;
  if (type === 'rsa' || type === 'rsa-pss') {
    const bits = pub.asymmetricKeyDetails?.modulusLength || 0;
    if (bits < MIN_RSA_BITS) {
      throw tlsClientError('tls_weak_key', `Certificate RSA key too small (${bits} bits; minimum ${MIN_RSA_BITS})`);
    }
    return;
  }
  if (type === 'ec') {
    const curve = String(pub.asymmetricKeyDetails?.namedCurve || '');
    if (!ALLOWED_EC_CURVES.has(curve)) {
      throw tlsClientError('tls_weak_key', `Unsupported EC curve: ${curve || 'unknown'}`);
    }
    return;
  }
  if (type === 'ed25519' || type === 'ed448') return;
  throw tlsClientError('tls_weak_key', `Unsupported certificate key type: ${String(type || 'unknown')}`);
}

/**
 * @param {string} field
 * @returns {string}
 */
function cleanCertText(field) {
  return String(field || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 256);
}

/**
 * Parse and validate a PEM or DER client CA / self-signed certificate bundle.
 * Rejects private key material, oversized payloads, weak keys, and expired certs.
 *
 * @param {string | Buffer} input
 * @param {{ now?: Date, allowExpired?: boolean }} [options]
 * @returns {{
 *   caCertPem: string,
 *   caFingerprintSha256: string,
 *   summary: {
 *     sha256: string,
 *     fingerprint256: string,
 *     subject: string,
 *     issuer: string,
 *     validFrom: string,
 *     validTo: string,
 *     sans: string[],
 *     isCa: boolean,
 *     certCount: number
 *   }
 * }}
 */
function parseClientCaBundle(input, options = {}) {
  const rawBuf = Buffer.isBuffer(input)
    ? input
    : Buffer.from(String(input ?? ''), 'utf8');
  if (rawBuf.byteLength === 0) {
    throw tlsClientError('tls_invalid_format', 'Certificate input is empty');
  }
  if (rawBuf.byteLength > MAX_CLIENT_CA_BYTES) {
    throw tlsClientError('tls_file_too_large', `Certificate exceeds ${MAX_CLIENT_CA_BYTES} bytes`);
  }

  const text = rawBuf.toString('utf8');
  if (PRIVATE_KEY_HEADER_RE.test(text)) {
    throw tlsClientError('tls_private_key_not_allowed', 'Private key material cannot be imported as a CA certificate');
  }

  /** @type {crypto.X509Certificate[]} */
  const certs = [];
  if (text.includes('-----BEGIN CERTIFICATE-----')) {
    const matches = [...text.matchAll(PEM_CERT_BLOCK_RE)];
    if (matches.length === 0) {
      throw tlsClientError('tls_invalid_format', 'Malformed PEM certificate block');
    }
    if (matches.length > MAX_CLIENT_CA_CERTS) {
      throw tlsClientError('tls_invalid_format', `Certificate bundle exceeds maximum of ${MAX_CLIENT_CA_CERTS} certificates`);
    }
    const remainder = text.replace(PEM_CERT_BLOCK_RE, '').trim();
    if (remainder.includes('-----BEGIN ')) {
      throw tlsClientError('tls_invalid_format', 'Unsupported PEM block in CA certificate bundle');
    }
    for (const match of matches) {
      try {
        certs.push(new crypto.X509Certificate(match[0]));
      } catch (cause) {
        throw tlsClientError('tls_invalid_format', 'Failed to parse PEM certificate', cause);
      }
    }
  } else {
    try {
      certs.push(new crypto.X509Certificate(rawBuf));
    } catch (cause) {
      throw tlsClientError('tls_invalid_format', 'Unsupported or corrupt X.509 certificate', cause);
    }
  }

  const nowMs = (options.now instanceof Date ? options.now : new Date()).getTime();
  for (const cert of certs) {
    assertClientCaKeyStrength(cert);
    const validFromMs = Date.parse(cert.validFrom);
    const validToMs = Date.parse(cert.validTo);
    if (!Number.isFinite(validFromMs) || !Number.isFinite(validToMs)) {
      throw tlsClientError('tls_invalid_format', 'Certificate has invalid validity dates');
    }
    if (options.allowExpired !== true) {
      if (nowMs > validToMs) {
        throw tlsClientError('tls_cert_expired', 'Certificate has expired');
      }
      if (nowMs < validFromMs) {
        throw tlsClientError('tls_cert_not_yet_valid', 'Certificate is not yet valid');
      }
    }
  }

  const canonicalPem = certs.map((cert) => cert.toString().trim()).join('\n') + '\n';
  const derHash = crypto.createHash('sha256');
  for (const cert of certs) {
    derHash.update(cert.raw);
  }
  const sha256 = derHash.digest('hex');
  const primary = certs[0];
  const sans = primary.subjectAltName
    ? primary.subjectAltName.split(',').map((entry) => entry.trim()).filter(Boolean).slice(0, 32)
    : [];

  return {
    caCertPem: canonicalPem,
    caFingerprintSha256: sha256,
    summary: {
      sha256,
      fingerprint256: cleanCertText(primary.fingerprint256),
      subject: cleanCertText(primary.subject),
      issuer: cleanCertText(primary.issuer),
      validFrom: new Date(Date.parse(primary.validFrom)).toISOString(),
      validTo: new Date(Date.parse(primary.validTo)).toISOString(),
      sans,
      isCa: Boolean(primary.ca),
      certCount: certs.length
    }
  };
}

/**
 * Safely read and validate a client CA certificate file from disk (`O_NOFOLLOW`, bounded bytes).
 *
 * @param {string} filePath
 * @param {{ fs?: typeof fs, now?: Date, allowExpired?: boolean }} [options]
 */
function readClientCaFile(filePath, options = {}) {
  const raw = readRegularFileNoFollow(filePath, {
    fs: options.fs,
    description: 'CA certificate file',
    maxBytes: MAX_CLIENT_CA_BYTES,
    encoding: 'buffer'
  });
  return parseClientCaBundle(raw, options);
}

/**
 * Safely read a shared secret from a private file (`O_NOFOLLOW`, bounded bytes, POSIX `0o600` check).
 *
 * @param {string} filePath
 * @param {{ fs?: typeof fs, platform?: NodeJS.Platform, allowGroupRead?: boolean }} [options]
 * @returns {string}
 */
function readPrivateSecretFile(filePath, options = {}) {
  const fsApi = options.fs || fs;
  const platform = options.platform || process.platform;
  const raw = readRegularFileNoFollow(filePath, {
    fs: fsApi,
    description: 'Secret file',
    maxBytes: MAX_SECRET_FILE_BYTES,
    encoding: 'utf8'
  });
  if (platform !== 'win32') {
    const stat = fsApi.lstatSync(filePath);
    const forbiddenMask = options.allowGroupRead === true ? 0o007 : 0o077;
    if ((stat.mode & forbiddenMask) !== 0) {
      throw tlsClientError(
        'insecure_secret_file_permissions',
        `Secret file ${filePath} has overly permissive mode (${(stat.mode & 0o777).toString(8)}); expected 0600`
      );
    }
  }
  const secret = String(raw || '').trim();
  if (!secret) {
    throw tlsClientError('empty_secret_file', 'Secret file is empty');
  }
  if (/[\r\n\0]/.test(secret)) {
    throw tlsClientError('invalid_secret_file', 'Secret file must contain a single-line secret without control characters');
  }
  return secret;
}

/**
 * @param {string} caCertPem
 * @param {any} AgentCtor
 * @param {boolean} useCache
 */
function resolveHubAgent(caCertPem, AgentCtor, useCache) {
  const trimmedCa = String(caCertPem || '').trim();
  const key = trimmedCa ? `ca:${caFingerprintSha256(trimmedCa)}` : 'system:tls12';
  if (useCache) {
    const hit = agentCache.get(key);
    if (hit && hit.Ctor === AgentCtor) return hit.agent;
  }
  const connect = {
    minVersion: 'TLSv1.2',
    rejectUnauthorized: true,
    ...(trimmedCa ? { ca: Buffer.from(trimmedCa, 'utf8') } : {})
  };
  // Keep bodyTimeout disabled on the shared dispatcher so long-lived SSE streams
  // rely on their own explicit activity timers, while every ordinary request is
  // bounded by AbortSignal.timeout(defaultTimeoutMs).
  const agent = new AgentCtor({
    connect,
    headersTimeout: 30_000,
    bodyTimeout: 0
  });
  if (useCache) {
    agentCache.set(key, { Ctor: AgentCtor, agent });
  }
  return agent;
}

/**
 * Create a scoped Hub HTTP(S) fetch function.
 *
 * @param {{
 *   caCertPem?: string | Buffer,
 *   defaultTimeoutMs?: number | null,
 *   requireHttps?: boolean,
 *   cache?: boolean,
 *   fetchImpl?: typeof fetch,
 *   AgentCtor?: any,
 *   undiciFetchImpl?: typeof undiciFetch
 * }} [options]
 * @returns {((input: string | URL, init?: Record<string, any>) => Promise<any>) & {
 *   caFingerprintSha256: string,
 *   destroy: () => Promise<void>
 * }}
 */
function createHubClientFetch(options = {}) {
  const rawCa = options.caCertPem
    ? (Buffer.isBuffer(options.caCertPem) ? options.caCertPem.toString('utf8') : String(options.caCertPem))
    : '';
  const trimmedCa = rawCa.trim();
  const fingerprint = trimmedCa ? caFingerprintSha256(trimmedCa) : '';
  const defaultTimeoutMs = options.defaultTimeoutMs === null || options.defaultTimeoutMs === 0
    ? 0
    : (Number.isFinite(Number(options.defaultTimeoutMs)) && Number(options.defaultTimeoutMs) > 0
      ? Number(options.defaultTimeoutMs)
      : DEFAULT_HUB_TIMEOUT_MS);
  const requireHttps = options.requireHttps === true;
  const useCache = options.cache !== false;
  const AgentCtor = options.AgentCtor || UndiciAgent;
  const fetchViaUndici = options.undiciFetchImpl || undiciFetch;
  const customFetch = typeof options.fetchImpl === 'function' ? options.fetchImpl : null;

  /** @type {any} */
  let ownedAgent = null;

  function getAgent() {
    if (customFetch) return null;
    if (!ownedAgent) {
      ownedAgent = resolveHubAgent(trimmedCa, AgentCtor, useCache);
    }
    return ownedAgent;
  }

  /**
   * @param {string | URL} input
   * @param {Record<string, any>} [init]
   */
  async function hubFetch(input, init = {}) {
    const urlStr = typeof input === 'string' ? input : String(input);
    let parsed;
    try {
      parsed = new URL(urlStr);
    } catch (cause) {
      throw tlsClientError('invalid_hub_url', 'Invalid Hub URL', cause);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw tlsClientError('invalid_hub_url', `Unsupported Hub URL protocol: ${parsed.protocol}`);
    }
    if (requireHttps && parsed.protocol === 'http:' && !isLoopbackHost(parsed.hostname)) {
      throw tlsClientError(
        'insecure_http_blocked',
        'Refusing plaintext HTTP connection to non-loopback Hub while HTTPS is required'
      );
    }

    const { timeoutMs: explicitTimeout, ...restInit } = init && typeof init === 'object' ? init : {};
    const effectiveTimeout = explicitTimeout === 0 || explicitTimeout === null
      ? 0
      : (Number.isFinite(Number(explicitTimeout)) && Number(explicitTimeout) > 0
        ? Number(explicitTimeout)
        : defaultTimeoutMs);

    /** @type {Record<string, any>} */
    const nextInit = {
      ...restInit,
      redirect: 'error'
    };

    if (effectiveTimeout > 0) {
      const timeoutSignal = AbortSignal.timeout(effectiveTimeout);
      nextInit.signal = nextInit.signal
        ? AbortSignal.any([nextInit.signal, timeoutSignal])
        : timeoutSignal;
    }

    if (Buffer.isBuffer(nextInit.body)) {
      nextInit.body = new Uint8Array(
        nextInit.body.buffer,
        nextInit.body.byteOffset,
        nextInit.body.byteLength
      );
    }

    if (customFetch) {
      return customFetch(urlStr, nextInit);
    }

    const agent = getAgent();
    if (nextInit.dispatcher == null && agent) {
      nextInit.dispatcher = agent;
    }
    return fetchViaUndici(urlStr, nextInit);
  }

  hubFetch.caFingerprintSha256 = fingerprint;
  hubFetch.destroy = async () => {
    const target = ownedAgent;
    ownedAgent = null;
    if (!target || useCache) return;
    if (typeof target.destroy === 'function') {
      try { await target.destroy(); } catch (_) {}
    } else if (typeof target.close === 'function') {
      try { await target.close(); } catch (_) {}
    }
  };

  return hubFetch;
}

/**
 * Destroy and evict all cached Hub client undici Agents (on Hub switch, shutdown, or tests).
 */
async function resetHubClientFetchCache() {
  const closing = [];
  for (const { agent } of agentCache.values()) {
    if (typeof agent?.destroy === 'function') {
      try { closing.push(agent.destroy()); } catch (_) {}
    } else if (typeof agent?.close === 'function') {
      try { closing.push(agent.close()); } catch (_) {}
    }
  }
  agentCache.clear();
  await Promise.allSettled(closing);
}

module.exports = {
  DEFAULT_HUB_TIMEOUT_MS,
  MAX_CLIENT_CA_BYTES,
  MAX_CLIENT_CA_CERTS,
  caFingerprintSha256,
  createHubClientFetch,
  isInsecureRemoteHttpUrl,
  isLoopbackHost,
  parseClientCaBundle,
  readClientCaFile,
  readPrivateSecretFile,
  resetHubClientFetchCache
};
