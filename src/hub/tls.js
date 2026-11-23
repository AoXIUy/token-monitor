// @ts-check
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const tls = require('node:tls');

const {
  EXPIRY_CRITICAL_DAYS,
  EXPIRY_WARN_DAYS,
  MAX_CERT_BYTES,
  MAX_KEY_BYTES,
  TLS_ERROR_CODES,
  TLS_MIN_VERSIONS,
  classifyTlsError,
  hostMatchesCertSan,
  loadPassphraseFromFile,
  makeTlsError,
  readBoundedFile,
  validatePemBundle,
  validatePkcs12Bundle
} = require('../shared/tlsCert');

const DEFAULT_TLS_MIN_VERSION = 'TLSv1.2';
const TLS_CIPHERS = [
  'TLS_AES_256_GCM_SHA384',
  'TLS_CHACHA20_POLY1305_SHA256',
  'TLS_AES_128_GCM_SHA256',
  'ECDHE-ECDSA-AES256-GCM-SHA384',
  'ECDHE-RSA-AES256-GCM-SHA384',
  'ECDHE-ECDSA-CHACHA20-POLY1305',
  'ECDHE-RSA-CHACHA20-POLY1305',
  'ECDHE-ECDSA-AES128-GCM-SHA256',
  'ECDHE-RSA-AES128-GCM-SHA256'
].join(':');
const TLS_ECDH_CURVE = 'X25519:P-256:P-384';
const TLS_SECURE_OPTIONS = (crypto.constants.SSL_OP_NO_SSLv2 || 0)
  | (crypto.constants.SSL_OP_NO_SSLv3 || 0)
  | (crypto.constants.SSL_OP_NO_TLSv1 || 0)
  | (crypto.constants.SSL_OP_NO_TLSv1_1 || 0)
  | (crypto.constants.SSL_OP_NO_COMPRESSION || 0)
  | (crypto.constants.SSL_OP_NO_RENEGOTIATION || 0);

const TLS_HANDSHAKE_TIMEOUT_MS = 10_000;
const TLS_WATCH_DEBOUNCE_MS = 1500;
const TLS_RELOAD_RETRY_MS = 3000;
const TLS_EXPIRY_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MANAGED_TLS_FILES = Object.freeze(['cert.pem', 'key.pem', 'ca.pem', 'bundle.pfx']);

/**
 * @param {unknown} value
 * @param {boolean} fallback
 * @returns {boolean}
 */
function parseOptionalBool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const lower = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(lower)) return true;
  if (['0', 'false', 'no', 'off'].includes(lower)) return false;
  return fallback;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Normalize an explicit public host (hostname or bare IPv4/IPv6 without port/scheme).
 *
 * @param {unknown} raw
 * @returns {string}
 */
function normalizePublicHost(raw) {
  const text = cleanString(raw);
  if (!text) return '';
  if (/[\r\n\s/\\@?]/.test(text) || text.includes('://')) {
    throw makeTlsError(TLS_ERROR_CODES.INVALID_CONFIG, 'Invalid tlsPublicHost value');
  }
  const stripped = text.replace(/^\[|\]$/g, '').toLowerCase();
  if (!stripped || stripped.length > 253) {
    throw makeTlsError(TLS_ERROR_CODES.INVALID_CONFIG, 'Invalid tlsPublicHost value');
  }
  if (net.isIP(stripped)) return stripped;
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(stripped) || stripped.includes('..')) {
    throw makeTlsError(TLS_ERROR_CODES.INVALID_CONFIG, 'Invalid tlsPublicHost hostname');
  }
  return stripped;
}

/**
 * Extract the hostname (without port) from an HTTP Host header.
 * Returns empty string on invalid Host syntax.
 *
 * @param {unknown} rawHost
 * @returns {string}
 */
function parseHostHeaderHostname(rawHost) {
  if (typeof rawHost !== 'string') return '';
  const trimmed = rawHost.trim();
  if (!trimmed || trimmed.length > 260 || /[\r\n\s/\\@?]/.test(trimmed)) return '';
  try {
    const parsed = new URL(`http://${trimmed}`);
    if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
      return '';
    }
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (!hostname) return '';
    return hostname;
  } catch (_) {
    return '';
  }
}

/**
 * @param {string} storageDir
 * @returns {string}
 */
function managedTlsDir(storageDir) {
  return path.join(storageDir, 'hub-tls');
}

/**
 * Atomically write private binary/text content with 0700 directory and 0600 file permissions.
 *
 * @param {string} filePath
 * @param {Buffer | string} content
 * @param {{ mode?: number, fsApi?: typeof fs }} [options]
 */
function writePrivateBytesAtomic(filePath, content, options = {}) {
  const fsApi = options.fsApi || fs;
  const mode = options.mode !== undefined ? options.mode : 0o600;
  const constants = fsApi.constants || fs.constants;
  const directory = path.dirname(filePath);
  const tempPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  /** @type {number | null} */
  let fd = null;
  /** @type {number | null} */
  let dirFd = null;
  fsApi.mkdirSync(directory, { recursive: true, ...(process.platform === 'win32' ? {} : { mode: 0o700 }) });
  if (process.platform !== 'win32') {
    try { fsApi.chmodSync(directory, 0o700); } catch (_) {}
  }
  try {
    fd = fsApi.openSync(tempPath, 'wx', mode);
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');
    fsApi.writeFileSync(fd, buf);
    if (process.platform !== 'win32') fsApi.fchmodSync(fd, mode);
    fsApi.fsyncSync(fd);
    fsApi.closeSync(fd);
    fd = null;
    fsApi.renameSync(tempPath, filePath);
    if (process.platform !== 'win32') {
      try {
        dirFd = fsApi.openSync(directory, constants.O_RDONLY);
        fsApi.fsyncSync(dirFd);
        fsApi.closeSync(dirFd);
        dirFd = null;
      } catch (_) {}
    }
  } catch (error) {
    if (fd !== null) {
      try { fsApi.closeSync(fd); } catch (_) {}
    }
    if (dirFd !== null) {
      try { fsApi.closeSync(dirFd); } catch (_) {}
    }
    try { fsApi.rmSync(tempPath, { force: true }); } catch (_) {}
    throw error;
  }
}

/**
 * Parse standalone Hub CLI flags and environment variables for TLS.
 *
 * @param {Record<string, any>} args
 * @param {NodeJS.ProcessEnv} [env]
 */
function parseHubTlsCliEnv(args = {}, env = process.env) {
  if (args['tls-passphrase'] !== undefined || args.tlsPassphrase !== undefined) {
    throw makeTlsError(
      TLS_ERROR_CODES.INVALID_CONFIG,
      'Do not pass TLS passphrase via CLI flags; use --tls-passphrase-file or TOKEN_MONITOR_TLS_PASSPHRASE'
    );
  }
  const tlsRaw = args.tls !== undefined ? args.tls : env.TOKEN_MONITOR_TLS;
  const certPath = cleanString(args['tls-cert'] ?? args.tlsCert ?? env.TOKEN_MONITOR_TLS_CERT);
  const keyPath = cleanString(args['tls-key'] ?? args.tlsKey ?? env.TOKEN_MONITOR_TLS_KEY);
  const caPath = cleanString(args['tls-ca'] ?? args.tlsCa ?? env.TOKEN_MONITOR_TLS_CA);
  const pfxPath = cleanString(args['tls-pfx'] ?? args.tlsPfx ?? env.TOKEN_MONITOR_TLS_PFX);
  const passphraseFile = cleanString(
    args['tls-passphrase-file'] ?? args.tlsPassphraseFile ?? env.TOKEN_MONITOR_TLS_PASSPHRASE_FILE
  );
  const passphrase = typeof env.TOKEN_MONITOR_TLS_PASSPHRASE === 'string' && env.TOKEN_MONITOR_TLS_PASSPHRASE.length > 0
    ? env.TOKEN_MONITOR_TLS_PASSPHRASE
    : undefined;
  const minVersion = cleanString(args['tls-min-version'] ?? args.tlsMinVersion ?? env.TOKEN_MONITOR_TLS_MIN_VERSION) || DEFAULT_TLS_MIN_VERSION;
  const hsts = parseOptionalBool(args['tls-hsts'] ?? args.tlsHsts ?? env.TOKEN_MONITOR_TLS_HSTS, true);
  const watch = parseOptionalBool(args['tls-watch'] ?? args.tlsWatch ?? env.TOKEN_MONITOR_TLS_WATCH, true);
  const rawRedirectPort = args['tls-http-redirect-port'] ?? args.tlsHttpRedirectPort ?? env.TOKEN_MONITOR_TLS_HTTP_REDIRECT_PORT;
  const publicHost = cleanString(args['tls-public-host'] ?? args.tlsPublicHost ?? env.TOKEN_MONITOR_TLS_PUBLIC_HOST);
  const requireTls = parseOptionalBool(args['require-tls'] ?? args.requireTls ?? env.TOKEN_MONITOR_REQUIRE_TLS, false);

  return {
    tls: tlsRaw !== undefined && tlsRaw !== '' ? parseOptionalBool(tlsRaw, false) : undefined,
    mode: /** @type {'path'} */ ('path'),
    certPath,
    keyPath,
    caPath,
    pfxPath,
    passphrase,
    passphraseFile,
    minVersion,
    hsts,
    watch,
    httpRedirectPort: rawRedirectPort !== undefined && rawRedirectPort !== '' ? Number(rawRedirectPort) : null,
    publicHost,
    requireTls
  };
}

/**
 * Validate and normalize Hub TLS configuration.
 *
 * @param {Record<string, any> | boolean | null | undefined} input
 */
function resolveHubTlsConfig(input) {
  if (!input) {
    return {
      enabled: false,
      mode: /** @type {'path'} */ ('path'),
      format: /** @type {'pem' | 'pfx' | null} */ (null),
      certPath: '',
      keyPath: '',
      caPath: '',
      pfxPath: '',
      passphrase: /** @type {string | undefined} */ (undefined),
      passphraseFile: '',
      minVersion: DEFAULT_TLS_MIN_VERSION,
      hsts: true,
      watch: true,
      httpRedirectPort: /** @type {number | null} */ (null),
      publicHost: '',
      requireTls: false,
      noFollow: false
    };
  }
  const cfg = typeof input === 'object' ? input : {};
  const mode = cfg.mode === 'managed' ? 'managed' : 'path';
  const certPath = cleanString(cfg.certPath);
  const keyPath = cleanString(cfg.keyPath);
  const caPath = cleanString(cfg.caPath);
  const pfxPath = cleanString(cfg.pfxPath);
  const passphraseFile = cleanString(cfg.passphraseFile);
  const passphrase = typeof cfg.passphrase === 'string' && cfg.passphrase.length > 0
    ? cfg.passphrase
    : undefined;
  const requireTls = Boolean(cfg.requireTls);
  const hasAnyMaterial = Boolean(certPath || keyPath || caPath || pfxPath);
  const enabled = cfg.tls === false
    ? false
    : (cfg.tls === true || cfg.enabled === true || hasAnyMaterial);

  const minVersion = cleanString(cfg.minVersion) || DEFAULT_TLS_MIN_VERSION;
  if (!TLS_MIN_VERSIONS.includes(/** @type {any} */ (minVersion))) {
    throw makeTlsError(TLS_ERROR_CODES.INVALID_CONFIG, `Unsupported TLS minVersion "${minVersion}"; expected TLSv1.2 or TLSv1.3`);
  }

  let httpRedirectPort = /** @type {number | null} */ (null);
  if (cfg.httpRedirectPort !== undefined && cfg.httpRedirectPort !== null && cfg.httpRedirectPort !== '') {
    const parsedPort = Number(cfg.httpRedirectPort);
    if (!Number.isInteger(parsedPort) || parsedPort < 0 || parsedPort > 65535) {
      throw makeTlsError(TLS_ERROR_CODES.INVALID_CONFIG, 'httpRedirectPort must be an integer between 0 and 65535');
    }
    httpRedirectPort = parsedPort;
  }

  const publicHost = normalizePublicHost(cfg.publicHost);
  const hsts = cfg.hsts !== false;
  const watch = cfg.watch !== false;

  if (!enabled) {
    return {
      enabled: false,
      mode,
      format: /** @type {'pem' | 'pfx' | null} */ (null),
      certPath: '',
      keyPath: '',
      caPath: '',
      pfxPath: '',
      passphrase: /** @type {string | undefined} */ (undefined),
      passphraseFile: '',
      minVersion,
      hsts,
      watch,
      httpRedirectPort: null,
      publicHost,
      requireTls,
      noFollow: mode === 'managed'
    };
  }

  const hasPem = Boolean(certPath || keyPath || caPath);
  const hasPfx = Boolean(pfxPath);
  if (hasPem && hasPfx) {
    throw makeTlsError(TLS_ERROR_CODES.INVALID_CONFIG, 'PEM certificate/key paths and PKCS#12 PFX path are mutually exclusive');
  }
  if (!hasPem && !hasPfx) {
    throw makeTlsError(TLS_ERROR_CODES.INVALID_CONFIG, 'TLS is enabled but no certificate/key or PKCS#12 file was configured');
  }
  if (hasPem && (!certPath || !keyPath)) {
    throw makeTlsError(TLS_ERROR_CODES.INVALID_CONFIG, 'PEM TLS requires both certPath and keyPath');
  }

  return {
    enabled: true,
    mode,
    format: /** @type {'pem' | 'pfx'} */ (hasPfx ? 'pfx' : 'pem'),
    certPath,
    keyPath,
    caPath,
    pfxPath,
    passphrase,
    passphraseFile,
    minVersion,
    hsts,
    watch,
    httpRedirectPort,
    publicHost,
    requireTls,
    noFollow: mode === 'managed'
  };
}

/**
 * Resolve passphrase from inline value or passphraseFile.
 *
 * @param {{ passphrase?: string, passphraseFile?: string, noFollow?: boolean }} config
 * @param {{ logger?: { warn?: (msg: string) => void } | null, fsApi?: typeof fs }} [options]
 * @returns {string | undefined}
 */
function resolvePassphraseValue(config, options = {}) {
  if (typeof config.passphrase === 'string' && config.passphrase.length > 0) {
    return config.passphrase;
  }
  if (config.passphraseFile) {
    return loadPassphraseFromFile(config.passphraseFile, {
      noFollow: config.noFollow !== false,
      checkPrivateKeyPerms: true,
      logger: options.logger || null,
      fsApi: options.fsApi
    });
  }
  return undefined;
}

/**
 * Load and cryptographically validate TLS materials from disk.
 *
 * @param {ReturnType<typeof resolveHubTlsConfig>} config
 * @param {{
 *   noFollow?: boolean,
 *   checkPrivateKeyPerms?: boolean,
 *   logger?: { warn?: (msg: string) => void } | null,
 *   now?: Date,
 *   fsApi?: typeof fs
 * }} [options]
 */
async function loadAndValidateTlsMaterials(config, options = {}) {
  const noFollow = options.noFollow !== undefined ? options.noFollow : config.noFollow;
  const checkPrivateKeyPerms = options.checkPrivateKeyPerms !== false;
  const logger = options.logger || null;
  const now = options.now instanceof Date ? options.now : new Date();
  const fsApi = options.fsApi || fs;
  const passphrase = resolvePassphraseValue(config, { logger, fsApi });

  if (config.format === 'pfx') {
    const pfxBuffer = readBoundedFile(config.pfxPath, {
      maxBytes: MAX_CERT_BYTES,
      noFollow,
      checkPrivateKeyPerms,
      logger,
      fsApi
    });
    const validated = await validatePkcs12Bundle({
      pfxBuffer,
      passphrase,
      now,
      sourceBasename: path.basename(config.pfxPath)
    });
    /** @type {tls.SecureContextOptions} */
    const secureContextOptions = {
      pfx: validated.pfxBuffer,
      ...(passphrase !== undefined && passphrase !== '' ? { passphrase } : {}),
      minVersion: /** @type {'TLSv1.2' | 'TLSv1.3'} */ (config.minVersion),
      maxVersion: 'TLSv1.3',
      ciphers: TLS_CIPHERS,
      ecdhCurve: TLS_ECDH_CURVE,
      honorCipherOrder: true,
      secureOptions: TLS_SECURE_OPTIONS
    };
    // Verify OpenSSL accepts the hardened SecureContext options offline before swapping.
    tls.createSecureContext(secureContextOptions);
    return {
      ...validated,
      secureContextOptions,
      httpsOptions: {
        ...secureContextOptions,
        handshakeTimeout: TLS_HANDSHAKE_TIMEOUT_MS
      }
    };
  }

  const certBuffer = readBoundedFile(config.certPath, {
    maxBytes: MAX_CERT_BYTES,
    noFollow,
    checkPrivateKeyPerms: false,
    logger,
    fsApi
  });
  const keyBuffer = readBoundedFile(config.keyPath, {
    maxBytes: MAX_KEY_BYTES,
    noFollow,
    checkPrivateKeyPerms,
    logger,
    fsApi
  });
  const caBuffer = config.caPath
    ? readBoundedFile(config.caPath, {
        maxBytes: MAX_CERT_BYTES,
        noFollow,
        checkPrivateKeyPerms: false,
        logger,
        fsApi
      })
    : null;

  const validated = validatePemBundle({
    certBuffer,
    keyBuffer,
    caBuffer,
    passphrase,
    now,
    sourceBasename: path.basename(config.certPath)
  });

  /** @type {tls.SecureContextOptions} */
  const secureContextOptions = {
    cert: validated.certPem,
    key: validated.keyPem,
    ...(validated.caPem ? { ca: validated.caPem } : {}),
    ...(passphrase !== undefined && passphrase !== '' ? { passphrase } : {}),
    minVersion: /** @type {'TLSv1.2' | 'TLSv1.3'} */ (config.minVersion),
    maxVersion: 'TLSv1.3',
    ciphers: TLS_CIPHERS,
    ecdhCurve: TLS_ECDH_CURVE,
    honorCipherOrder: true,
    secureOptions: TLS_SECURE_OPTIONS
  };
  tls.createSecureContext(secureContextOptions);
  return {
    ...validated,
    secureContextOptions,
    httpsOptions: {
      ...secureContextOptions,
      handshakeTimeout: TLS_HANDSHAKE_TIMEOUT_MS
    }
  };
}

/**
 * Validate external ACME / operator-managed TLS paths without copying them.
 * Allows symlinks (e.g. /etc/letsencrypt/live/...) while enforcing fstatSync().isFile(),
 * bounded sizes, and private key permissions.
 *
 * @param {{
 *   certPath?: string,
 *   keyPath?: string,
 *   caPath?: string,
 *   pfxPath?: string,
 *   passphrase?: string,
 *   passphraseFile?: string,
 *   minVersion?: string,
 *   logger?: { warn?: (msg: string) => void } | null,
 *   now?: Date
 * }} params
 */
async function validateExternalTlsPaths(params) {
  const config = resolveHubTlsConfig({
    ...params,
    enabled: true,
    mode: 'path'
  });
  const loaded = await loadAndValidateTlsMaterials(config, {
    noFollow: false,
    checkPrivateKeyPerms: true,
    logger: params.logger || null,
    now: params.now
  });
  return {
    ok: true,
    mode: /** @type {'path'} */ ('path'),
    format: loaded.format,
    certPath: config.certPath,
    keyPath: config.keyPath,
    caPath: config.caPath,
    pfxPath: config.pfxPath,
    metadata: loaded.metadata,
    exportablePublicCertPem: loaded.exportablePublicCertPem,
    warnings: loaded.warnings
  };
}

/**
 * Import user-selected PEM or PKCS#12 materials into an isolated 0o700/0o600 managed directory.
 * Always enforces O_NOFOLLOW when reading source files and validates completely before writing.
 *
 * @param {{
 *   storageDir: string,
 *   certPath?: string,
 *   keyPath?: string,
 *   caPath?: string,
 *   pfxPath?: string,
 *   passphrase?: string,
 *   passphraseFile?: string,
 *   minVersion?: string,
 *   logger?: { warn?: (msg: string) => void } | null,
 *   now?: Date
 * }} params
 */
async function importManagedTlsMaterials(params) {
  if (!params || typeof params.storageDir !== 'string' || !params.storageDir.trim()) {
    throw makeTlsError(TLS_ERROR_CODES.INVALID_CONFIG, 'storageDir is required for managed TLS import');
  }
  const config = resolveHubTlsConfig({
    ...params,
    enabled: true,
    mode: 'managed'
  });
  // Managed imports always enforce O_NOFOLLOW; source files chosen from user folders
  // (e.g. Downloads) may have default umask before copying into 0600 managed storage.
  const loaded = await loadAndValidateTlsMaterials(config, {
    noFollow: true,
    checkPrivateKeyPerms: false,
    logger: params.logger || null,
    now: params.now
  });

  const targetDir = managedTlsDir(params.storageDir);
  if (loaded.format === 'pfx') {
    const destPfx = path.join(targetDir, 'bundle.pfx');
    writePrivateBytesAtomic(destPfx, loaded.pfxBuffer, { mode: 0o600 });
    for (const stale of ['cert.pem', 'key.pem', 'ca.pem']) {
      try { fs.rmSync(path.join(targetDir, stale), { force: true }); } catch (_) {}
    }
    return {
      ok: true,
      mode: /** @type {'managed'} */ ('managed'),
      format: /** @type {'pfx'} */ ('pfx'),
      certPath: '',
      keyPath: '',
      caPath: '',
      pfxPath: destPfx,
      metadata: loaded.metadata,
      exportablePublicCertPem: loaded.exportablePublicCertPem,
      warnings: loaded.warnings
    };
  }

  const destCert = path.join(targetDir, 'cert.pem');
  const destKey = path.join(targetDir, 'key.pem');
  const destCa = loaded.caPem ? path.join(targetDir, 'ca.pem') : '';
  writePrivateBytesAtomic(destCert, loaded.certPem, { mode: 0o600 });
  writePrivateBytesAtomic(destKey, loaded.keyPem, { mode: 0o600 });
  if (destCa) {
    writePrivateBytesAtomic(destCa, loaded.caPem, { mode: 0o600 });
  } else {
    try { fs.rmSync(path.join(targetDir, 'ca.pem'), { force: true }); } catch (_) {}
  }
  try { fs.rmSync(path.join(targetDir, 'bundle.pfx'), { force: true }); } catch (_) {}

  return {
    ok: true,
    mode: /** @type {'managed'} */ ('managed'),
    format: /** @type {'pem'} */ ('pem'),
    certPath: destCert,
    keyPath: destKey,
    caPath: destCa,
    pfxPath: '',
    metadata: loaded.metadata,
    exportablePublicCertPem: loaded.exportablePublicCertPem,
    warnings: loaded.warnings
  };
}

/**
 * Remove all managed TLS files from storageDir/hub-tls.
 *
 * @param {string} storageDir
 */
function clearManagedTlsMaterials(storageDir) {
  if (typeof storageDir !== 'string' || !storageDir.trim()) return;
  const dir = managedTlsDir(storageDir);
  for (const name of MANAGED_TLS_FILES) {
    try { fs.rmSync(path.join(dir, name), { force: true }); } catch (_) {}
  }
}

/**
 * Export ONLY the public certificate PEM (CA cert in chain if present, otherwise leaf)
 * suitable for importing into desktop/Android clients. Never exports private key material.
 *
 * @param {Record<string, any>} rawTlsConfig
 * @param {{ logger?: { warn?: (msg: string) => void } | null }} [options]
 */
async function exportPublicCertPem(rawTlsConfig, options = {}) {
  const config = resolveHubTlsConfig({ ...rawTlsConfig, enabled: true });
  const loaded = await loadAndValidateTlsMaterials(config, {
    noFollow: config.noFollow,
    checkPrivateKeyPerms: false,
    logger: options.logger || null
  });
  return {
    ok: true,
    pem: loaded.exportablePublicCertPem,
    metadata: loaded.metadata
  };
}

/**
 * Runtime TLS controller managing initial SecureContext loading, hot reloads
 * via server.setSecureContext(), debounced fs.watch, SIGHUP, and expiry alerts.
 *
 * @param {Record<string, any>} rawTlsConfig
 * @param {{
 *   logger?: { log?: (msg: string) => void, warn?: (msg: string) => void, error?: (...args: any[]) => void },
 *   onReload?: (status: any) => void,
 *   onError?: (code: string, error: unknown) => void,
 *   watchDebounceMs?: number,
 *   reloadRetryMs?: number,
 *   expiryCheckIntervalMs?: number,
 *   registerSighup?: boolean
 * }} [options]
 */
function createHubTlsController(rawTlsConfig, options = {}) {
  const config = resolveHubTlsConfig(rawTlsConfig);
  const logger = options.logger || console;
  const watchDebounceMs = Number.isFinite(options.watchDebounceMs) ? Number(options.watchDebounceMs) : TLS_WATCH_DEBOUNCE_MS;
  const reloadRetryMs = Number.isFinite(options.reloadRetryMs) ? Number(options.reloadRetryMs) : TLS_RELOAD_RETRY_MS;
  const expiryCheckIntervalMs = Number.isFinite(options.expiryCheckIntervalMs)
    ? Number(options.expiryCheckIntervalMs)
    : TLS_EXPIRY_CHECK_INTERVAL_MS;
  const registerSighup = options.registerSighup !== false;

  /** @type {Awaited<ReturnType<typeof loadAndValidateTlsMaterials>> | null} */
  let current = null;
  /** @type {import('node:https').Server | null} */
  let attachedServer = null;
  /** @type {fs.FSWatcher[]} */
  const watchers = [];
  /** @type {NodeJS.Timeout | null} */
  let debounceTimer = null;
  /** @type {NodeJS.Timeout | null} */
  let retryTimer = null;
  /** @type {NodeJS.Timeout | null} */
  let expiryTimer = null;
  /** @type {(() => void) | null} */
  let sighupHandler = null;
  /** @type {Promise<any> | null} */
  let reloadInFlight = null;
  let stopped = false;
  let lastReloadAt = '';
  let lastReloadError = '';

  function logExpiryStatus() {
    if (!current?.metadata?.validTo) return;
    const toMs = Date.parse(current.metadata.validTo);
    if (!Number.isFinite(toMs)) return;
    const daysRemaining = Math.floor((toMs - Date.now()) / 86400000);
    if (daysRemaining <= 0) {
      (logger.error || console.error)('[tls] CRITICAL: Hub TLS certificate has expired! Renew and reload immediately.');
    } else if (daysRemaining <= EXPIRY_CRITICAL_DAYS) {
      (logger.error || console.error)(`[tls] CRITICAL: Hub TLS certificate expires in ${daysRemaining} day(s).`);
    } else if (daysRemaining <= EXPIRY_WARN_DAYS) {
      (logger.warn || console.warn)(`[tls] Warning: Hub TLS certificate expires in ${daysRemaining} day(s).`);
    }
  }

  async function loadInitial() {
    if (!config.enabled) return null;
    const loaded = await loadAndValidateTlsMaterials(config, {
      noFollow: config.noFollow,
      checkPrivateKeyPerms: true,
      logger
    });
    current = loaded;
    lastReloadAt = new Date().toISOString();
    lastReloadError = '';
    logExpiryStatus();
    return loaded;
  }

  /**
   * @param {{ isRetry?: boolean }} [opts]
   */
  async function reload(opts = {}) {
    if (!config.enabled) return { ok: false, error: TLS_ERROR_CODES.INVALID_CONFIG, message: 'TLS is not enabled' };
    if (stopped) return { ok: false, error: 'hub_stopped', message: 'Hub TLS controller is stopped' };
    if (reloadInFlight) return reloadInFlight;

    reloadInFlight = (async () => {
      try {
        const next = await loadAndValidateTlsMaterials(config, {
          noFollow: config.noFollow,
          checkPrivateKeyPerms: true,
          logger
        });
        if (attachedServer && typeof attachedServer.setSecureContext === 'function') {
          attachedServer.setSecureContext(next.secureContextOptions);
        }
        current = next;
        lastReloadAt = new Date().toISOString();
        lastReloadError = '';
        if (retryTimer) {
          clearTimeout(retryTimer);
          retryTimer = null;
        }
        logExpiryStatus();
        const status = getStatus();
        try { options.onReload?.(status); } catch (_) {}
        return {
          ok: true,
          metadata: next.metadata,
          reloadedAt: lastReloadAt,
          warnings: next.warnings
        };
      } catch (error) {
        const code = classifyTlsError(error);
        lastReloadError = code;
        (logger.warn || console.warn)(`[tls] Certificate reload failed (${code}); keeping existing certificate active.`);
        try { options.onError?.(code, error); } catch (_) {}
        if (!opts.isRetry && !stopped && reloadRetryMs > 0 && !retryTimer) {
          retryTimer = setTimeout(() => {
            retryTimer = null;
            void reload({ isRetry: true });
          }, reloadRetryMs);
          retryTimer.unref();
        }
        return {
          ok: false,
          error: code,
          message: 'Certificate reload failed; existing certificate remains active'
        };
      } finally {
        reloadInFlight = null;
      }
    })();
    return reloadInFlight;
  }

  function scheduleDebouncedReload() {
    if (stopped) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void reload();
    }, Math.max(50, watchDebounceMs));
    debounceTimer.unref();
  }

  function setupWatchers() {
    if (!config.enabled || !config.watch) return;
    const watchedFiles = [config.certPath, config.keyPath, config.caPath, config.pfxPath, config.passphraseFile]
      .filter(Boolean)
      .map((filePath) => path.resolve(filePath));
    /** @type {Map<string, Set<string>>} */
    const byDir = new Map();
    for (const fullPath of watchedFiles) {
      const dir = path.dirname(fullPath);
      const base = path.basename(fullPath);
      if (!byDir.has(dir)) byDir.set(dir, new Set());
      byDir.get(dir)?.add(base);
    }
    for (const [dir, basenames] of byDir.entries()) {
      try {
        const watcher = fs.watch(dir, { persistent: false }, (_eventType, filename) => {
          if (!filename || basenames.has(String(filename))) {
            scheduleDebouncedReload();
          }
        });
        watcher.on('error', (err) => {
          (logger.warn || console.warn)(`[tls] Watcher warning on ${path.basename(dir)}: ${err?.message || 'watch_error'}`);
        });
        watchers.push(watcher);
      } catch (err) {
        (logger.warn || console.warn)(`[tls] Could not watch TLS directory: ${/** @type {any} */ (err)?.code || 'watch_failed'}`);
      }
    }
  }

  /**
   * @param {import('node:https').Server} httpsServer
   */
  function attachServer(httpsServer) {
    attachedServer = httpsServer;
    httpsServer.on('tlsClientError', (err, tlsSocket) => {
      const code = classifyTlsError(err);
      (logger.warn || console.warn)(`[tls] Handshake rejected (${code})`);
      try { tlsSocket.destroy(); } catch (_) {}
    });
    setupWatchers();
    if (registerSighup && process.platform !== 'win32' && !sighupHandler) {
      sighupHandler = () => { void reload(); };
      process.on('SIGHUP', sighupHandler);
    }
    if (expiryCheckIntervalMs > 0 && !expiryTimer) {
      expiryTimer = setInterval(logExpiryStatus, expiryCheckIntervalMs);
      expiryTimer.unref();
    }
  }

  function getStatus() {
    if (!config.enabled) {
      return {
        enabled: false,
        mode: config.mode,
        format: null,
        minVersion: config.minVersion,
        hsts: false,
        watch: false,
        cert: null,
        lastReloadAt: '',
        lastReloadError: '',
        warnings: []
      };
    }
    const certMeta = current?.metadata
      ? {
          ...current.metadata,
          daysRemaining: current.metadata.validTo
            ? Math.floor((Date.parse(current.metadata.validTo) - Date.now()) / 86400000)
            : current.metadata.daysRemaining
        }
      : null;
    if (certMeta) {
      certMeta.expiringSoon = certMeta.daysRemaining <= EXPIRY_WARN_DAYS;
      certMeta.expiringCritical = certMeta.daysRemaining <= EXPIRY_CRITICAL_DAYS;
    }
    return {
      enabled: true,
      mode: config.mode,
      format: current?.format || config.format,
      minVersion: config.minVersion,
      hsts: config.hsts,
      watch: config.watch,
      cert: certMeta,
      lastReloadAt,
      lastReloadError,
      warnings: current?.warnings ? [...current.warnings] : []
    };
  }

  /**
   * @param {string} hostname
   * @returns {boolean}
   */
  function isAllowedRedirectHost(hostname) {
    const clean = cleanString(hostname).replace(/^\[|\]$/g, '').toLowerCase();
    if (!clean) return false;
    if (config.publicHost) {
      return clean === config.publicHost;
    }
    return hostMatchesCertSan(clean, current?.metadata?.san);
  }

  function stop() {
    stopped = true;
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    if (expiryTimer) { clearInterval(expiryTimer); expiryTimer = null; }
    while (watchers.length > 0) {
      const watcher = watchers.pop();
      try { watcher?.close(); } catch (_) {}
    }
    if (sighupHandler) {
      process.off('SIGHUP', sighupHandler);
      sighupHandler = null;
    }
    attachedServer = null;
  }

  return {
    config,
    loadInitial,
    getHttpsServerOptions: () => current?.httpsOptions || null,
    attachServer,
    reload,
    getStatus,
    getExportablePublicCertPem: () => current?.exportablePublicCertPem || '',
    isAllowedRedirectHost,
    stop
  };
}

/**
 * Guarded HTTP -> HTTPS 308 redirect server.
 * Refuses missing, malformed, or non-allowlisted Host headers (preventing open redirect).
 *
 * @param {{
 *   httpsPort: number,
 *   tlsController: ReturnType<typeof createHubTlsController>,
 *   publicHost?: string
 * }} params
 */
function createHttpRedirectServer({ httpsPort, tlsController, publicHost = '' }) {
  const configuredHost = publicHost ? normalizePublicHost(publicHost) : '';
  const server = http.createServer((req, res) => {
    const hostname = parseHostHeaderHostname(req.headers.host);
    const allowed = hostname
      && (configuredHost ? hostname === configuredHost : tlsController.isAllowedRedirectHost(hostname));
    if (!allowed) {
      res.writeHead(400, {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        connection: 'close'
      });
      res.end('Bad Request\n');
      return;
    }
    const rawUrl = typeof req.url === 'string' ? req.url : '/';
    // Reject protocol-relative paths (//evil.com) or CR/LF injection.
    if (!rawUrl.startsWith('/') || rawUrl.startsWith('//') || /[\r\n]/.test(rawUrl)) {
      res.writeHead(400, {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        connection: 'close'
      });
      res.end('Bad Request\n');
      return;
    }
    const hostAuthority = net.isIPv6(hostname) ? `[${hostname}]` : hostname;
    const portSuffix = httpsPort === 443 ? '' : `:${httpsPort}`;
    const location = `https://${hostAuthority}${portSuffix}${rawUrl}`;
    res.writeHead(308, {
      location,
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer'
    });
    res.end('Permanent Redirect\n');
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 100;
  server.maxConnections = 128;
  return server;
}

module.exports = {
  DEFAULT_TLS_MIN_VERSION,
  TLS_CIPHERS,
  TLS_ECDH_CURVE,
  TLS_EXPIRY_CHECK_INTERVAL_MS,
  TLS_HANDSHAKE_TIMEOUT_MS,
  TLS_RELOAD_RETRY_MS,
  TLS_SECURE_OPTIONS,
  TLS_WATCH_DEBOUNCE_MS,
  clearManagedTlsMaterials,
  createHttpRedirectServer,
  createHubTlsController,
  exportPublicCertPem,
  importManagedTlsMaterials,
  loadAndValidateTlsMaterials,
  managedTlsDir,
  normalizePublicHost,
  parseHostHeaderHostname,
  parseHubTlsCliEnv,
  resolveHubTlsConfig,
  validateExternalTlsPaths,
  writePrivateBytesAtomic
};
