// @ts-check
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const stream = require('node:stream');
const tls = require('node:tls');

const MAX_CERT_BYTES = 256 * 1024;
const MAX_KEY_BYTES = 64 * 1024;
const MAX_PASSPHRASE_BYTES = 1024;
const MAX_CERT_CHAIN_BLOCKS = 10;
const EXPIRY_WARN_DAYS = 30;
const EXPIRY_CRITICAL_DAYS = 7;
const PKCS12_EXTRACT_TIMEOUT_MS = 200;

const TLS_MIN_VERSIONS = Object.freeze(['TLSv1.2', 'TLSv1.3']);
const ALLOWED_EC_CURVES = new Set([
  'prime256v1',
  'P-256',
  'secp256r1',
  'secp384r1',
  'P-384',
  'secp521r1',
  'P-521'
]);

const TLS_ERROR_CODES = Object.freeze({
  FILE_NOT_FOUND: 'tls_file_not_found',
  FILE_UNREADABLE: 'tls_file_unreadable',
  FILE_NOT_REGULAR: 'tls_file_not_regular',
  FILE_TOO_LARGE: 'tls_file_too_large',
  KEY_PERMISSIONS_TOO_OPEN: 'tls_key_permissions_too_open',
  INVALID_FORMAT: 'tls_invalid_format',
  PRIVATE_KEY_IN_CERT: 'tls_private_key_in_cert',
  MISSING_PRIVATE_KEY: 'tls_missing_private_key',
  MULTIPLE_PRIVATE_KEYS: 'tls_multiple_private_keys',
  TOO_MANY_CERTS: 'tls_too_many_certs',
  BAD_PASSPHRASE: 'tls_bad_passphrase',
  KEY_MISMATCH: 'tls_key_mismatch',
  WEAK_KEY: 'tls_weak_key',
  CERT_EXPIRED: 'tls_cert_expired',
  CERT_NOT_YET_VALID: 'tls_cert_not_yet_valid',
  BROKEN_CHAIN: 'tls_broken_chain',
  INVALID_CONFIG: 'tls_invalid_config',
  PKCS12_TIMEOUT: 'tls_pkcs12_timeout',
  PASSPHRASE_DECRYPT_FAILED: 'tls_passphrase_decrypt_failed'
});

const PRIVATE_KEY_MARKER_RE = /-----\s*BEGIN\s+[^\r\n-]*PRIVATE\s+KEY\s*-----/i;
const CERT_PEM_BLOCK_RE = /-----BEGIN CERTIFICATE-----[\r\n]+[\s\S]+?-----END CERTIFICATE-----/g;
const PRIVATE_KEY_PEM_BLOCK_RE = /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----[\r\n]+[\s\S]+?-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/g;

/**
 * @typedef {Error & { code?: string }} TlsError
 */

/**
 * @param {string} code
 * @param {string} message
 * @returns {TlsError}
 */
function makeTlsError(code, message) {
  /** @type {TlsError} */
  const error = new Error(message);
  error.code = code;
  return error;
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function classifyTlsError(error) {
  const errObj = /** @type {any} */ (error);
  const code = typeof errObj?.code === 'string' ? errObj.code : '';
  if (Object.values(TLS_ERROR_CODES).includes(/** @type {any} */ (code))) return code;
  const msg = String(errObj?.message || '').toLowerCase();
  const reason = String(errObj?.reason || '').toLowerCase();
  const combined = `${code.toLowerCase()} ${reason} ${msg}`;
  if (
    combined.includes('bad decrypt')
    || combined.includes('mac verify failure')
    || combined.includes('bad password')
    || combined.includes('wrong password')
    || combined.includes('passphrase')
    || combined.includes('err_ossl_evp_bad_decrypt')
    || combined.includes('err_ossl_pkcs12_mac_verify_failure')
    || combined.includes('err_ossl_pem_bad_password_read')
  ) {
    return TLS_ERROR_CODES.BAD_PASSPHRASE;
  }
  if (combined.includes('key values mismatch') || combined.includes('err_ossl_x509_key_values_mismatch')) {
    return TLS_ERROR_CODES.KEY_MISMATCH;
  }
  if (combined.includes('enoent')) return TLS_ERROR_CODES.FILE_NOT_FOUND;
  if (combined.includes('eloop')) return TLS_ERROR_CODES.FILE_NOT_REGULAR;
  if (combined.includes('eacces') || combined.includes('eperm')) return TLS_ERROR_CODES.FILE_UNREADABLE;
  return TLS_ERROR_CODES.INVALID_FORMAT;
}

/**
 * @param {string} filePath
 * @param {{
 *   maxBytes: number,
 *   noFollow?: boolean,
 *   checkPrivateKeyPerms?: boolean,
 *   logger?: { warn?: (msg: string) => void } | null,
 *   fsApi?: typeof fs,
 *   platform?: string
 * }} options
 * @returns {Buffer}
 */
function readBoundedFile(filePath, options) {
  const {
    maxBytes,
    noFollow = false,
    checkPrivateKeyPerms = false,
    logger = null,
    fsApi = fs,
    platform = process.platform
  } = options;
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw makeTlsError(TLS_ERROR_CODES.INVALID_CONFIG, 'TLS file path must be a non-empty string');
  }
  const constants = fsApi.constants || fs.constants;
  const flags = constants.O_RDONLY | (noFollow && constants.O_NOFOLLOW ? constants.O_NOFOLLOW : 0);
  /** @type {number | null} */
  let fd = null;
  let preStat = null;
  try {
    if (noFollow && !constants.O_NOFOLLOW) {
      preStat = fsApi.lstatSync(filePath);
      if (!preStat.isFile() || preStat.isSymbolicLink()) {
        throw makeTlsError(TLS_ERROR_CODES.FILE_NOT_REGULAR, 'TLS file must be a regular file');
      }
    }
    fd = fsApi.openSync(filePath, flags);
    const stat = fsApi.fstatSync(fd);
    if (!stat.isFile()) {
      throw makeTlsError(TLS_ERROR_CODES.FILE_NOT_REGULAR, 'TLS file must be a regular file');
    }
    if (preStat && (preStat.dev !== stat.dev || preStat.ino !== stat.ino)) {
      throw makeTlsError(TLS_ERROR_CODES.FILE_NOT_REGULAR, 'TLS file changed while opening');
    }
    if (stat.size > maxBytes) {
      throw makeTlsError(TLS_ERROR_CODES.FILE_TOO_LARGE, `TLS file exceeds ${maxBytes} byte limit`);
    }
    if (checkPrivateKeyPerms && platform !== 'win32') {
      if ((stat.mode & 0o007) !== 0) {
        throw makeTlsError(
          TLS_ERROR_CODES.KEY_PERMISSIONS_TOO_OPEN,
          `Private key file "${path.basename(filePath)}" is accessible to other users; set mode 0600`
        );
      }
      if ((stat.mode & 0o070) !== 0) {
        logger?.warn?.(
          `[tls] Warning: private key file "${path.basename(filePath)}" is group-readable (mode ${(stat.mode & 0o777).toString(8)}); 0600 is recommended.`
        );
      }
    }
    const buf = Buffer.allocUnsafe(maxBytes + 1);
    let total = 0;
    while (total < buf.length) {
      const n = fsApi.readSync(fd, buf, total, buf.length - total, null);
      if (n === 0) break;
      total += n;
    }
    if (total > maxBytes) {
      throw makeTlsError(TLS_ERROR_CODES.FILE_TOO_LARGE, `TLS file exceeds ${maxBytes} byte limit`);
    }
    return Buffer.from(buf.subarray(0, total));
  } catch (error) {
    const errObj = /** @type {any} */ (error);
    if (errObj && Object.values(TLS_ERROR_CODES).includes(errObj.code)) throw error;
    if (errObj?.code === 'ENOENT') {
      throw makeTlsError(TLS_ERROR_CODES.FILE_NOT_FOUND, `TLS file not found: ${path.basename(filePath)}`);
    }
    if (errObj?.code === 'ELOOP' || errObj?.code === 'EISDIR') {
      throw makeTlsError(TLS_ERROR_CODES.FILE_NOT_REGULAR, `TLS file must be a regular file: ${path.basename(filePath)}`);
    }
    throw makeTlsError(TLS_ERROR_CODES.FILE_UNREADABLE, `Could not read TLS file: ${path.basename(filePath)}`);
  } finally {
    if (fd !== null) {
      try { fsApi.closeSync(fd); } catch (_) {}
    }
  }
}

/**
 * @param {Buffer | string} input
 * @returns {boolean}
 */
function hasPrivateKeyMarker(input) {
  const text = Buffer.isBuffer(input) ? input.toString('utf8') : String(input || '');
  return PRIVATE_KEY_MARKER_RE.test(text);
}

/**
 * @param {crypto.X509Certificate} cert
 * @returns {string}
 */
function certSha256Fingerprint(cert) {
  return crypto.createHash('sha256').update(cert.raw).digest('hex');
}

/**
 * @param {string | undefined} subjectAltName
 * @returns {{ dns: string[], ips: string[] }}
 */
function parseSanEntries(subjectAltName) {
  /** @type {string[]} */
  const dns = [];
  /** @type {string[]} */
  const ips = [];
  if (typeof subjectAltName !== 'string' || !subjectAltName.trim()) {
    return { dns, ips };
  }
  for (const part of subjectAltName.split(',')) {
    const entry = part.trim();
    if (!entry) continue;
    if (entry.startsWith('DNS:')) {
      const value = entry.slice(4).trim().toLowerCase();
      if (value && !dns.includes(value)) dns.push(value);
    } else if (entry.startsWith('IP Address:')) {
      const value = entry.slice('IP Address:'.length).trim().toLowerCase();
      if (value && !ips.includes(value)) ips.push(value);
    }
  }
  return { dns, ips };
}

/**
 * @param {string} host
 * @param {{ dns?: string[], ips?: string[] } | null | undefined} san
 * @returns {boolean}
 */
function hostMatchesCertSan(host, san) {
  if (!san || typeof host !== 'string') return false;
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!normalized) return false;
  if (net.isIP(normalized)) {
    const ips = Array.isArray(san.ips) ? san.ips : [];
    return ips.some((ip) => ip.toLowerCase() === normalized);
  }
  const dnsList = Array.isArray(san.dns) ? san.dns : [];
  for (const pattern of dnsList) {
    const target = String(pattern || '').trim().toLowerCase();
    if (!target) continue;
    if (target === normalized) return true;
    if (target.startsWith('*.') && target.length > 2) {
      const suffix = target.slice(1); // '.example.com'
      if (normalized.endsWith(suffix)) {
        const prefix = normalized.slice(0, normalized.length - suffix.length);
        if (prefix && !prefix.includes('.')) return true;
      }
    }
  }
  return false;
}

/**
 * @param {crypto.KeyObject} publicKey
 */
function validateKeyStrength(publicKey) {
  const keyType = publicKey?.asymmetricKeyType;
  if (keyType === 'rsa' || keyType === 'rsa-pss') {
    const bits = publicKey.asymmetricKeyDetails?.modulusLength || 0;
    if (bits < 2048) {
      throw makeTlsError(TLS_ERROR_CODES.WEAK_KEY, `RSA key size ${bits} bits is below the 2048-bit minimum`);
    }
    return;
  }
  if (keyType === 'ec') {
    const curve = publicKey.asymmetricKeyDetails?.namedCurve || '';
    if (!ALLOWED_EC_CURVES.has(curve)) {
      throw makeTlsError(TLS_ERROR_CODES.WEAK_KEY, `Unsupported or weak EC curve: ${curve || 'unknown'}`);
    }
    return;
  }
  if (keyType === 'ed25519' || keyType === 'ed448') {
    return;
  }
  throw makeTlsError(TLS_ERROR_CODES.WEAK_KEY, `Unsupported certificate key type: ${String(keyType || 'unknown')}`);
}

/**
 * @param {crypto.X509Certificate} cert
 * @param {{ now?: Date, allowExpired?: boolean }} [options]
 * @returns {{ validFromIso: string, validToIso: string, daysRemaining: number }}
 */
function validateCertValidity(cert, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const nowMs = now.getTime();
  const fromMs = Date.parse(cert.validFrom);
  const toMs = Date.parse(cert.validTo);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
    throw makeTlsError(TLS_ERROR_CODES.INVALID_FORMAT, 'Certificate has invalid validity dates');
  }
  if (nowMs < fromMs) {
    throw makeTlsError(TLS_ERROR_CODES.CERT_NOT_YET_VALID, 'Certificate is not yet valid');
  }
  if (!options.allowExpired && nowMs > toMs) {
    throw makeTlsError(TLS_ERROR_CODES.CERT_EXPIRED, 'Certificate has expired');
  }
  const daysRemaining = Math.floor((toMs - nowMs) / 86400000);
  return {
    validFromIso: new Date(fromMs).toISOString(),
    validToIso: new Date(toMs).toISOString(),
    daysRemaining
  };
}

/**
 * @param {crypto.X509Certificate} cert
 * @param {{ chainLength?: number, now?: Date, sourceBasename?: string }} [options]
 */
function projectCertMetadata(cert, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const fromMs = Date.parse(cert.validFrom);
  const toMs = Date.parse(cert.validTo);
  const daysRemaining = Number.isFinite(toMs) ? Math.floor((toMs - now.getTime()) / 86400000) : 0;
  let selfSigned;
  try {
    selfSigned = Boolean(cert.subject && cert.subject === cert.issuer && cert.verify(cert.publicKey));
  } catch (_) {
    selfSigned = false;
  }
  const sourceBasename = typeof options.sourceBasename === 'string' && options.sourceBasename
    ? path.basename(options.sourceBasename)
    : '';
  return {
    subject: String(cert.subject || ''),
    issuer: String(cert.issuer || ''),
    validFrom: Number.isFinite(fromMs) ? new Date(fromMs).toISOString() : '',
    validTo: Number.isFinite(toMs) ? new Date(toMs).toISOString() : '',
    daysRemaining,
    expiringSoon: daysRemaining <= EXPIRY_WARN_DAYS,
    expiringCritical: daysRemaining <= EXPIRY_CRITICAL_DAYS,
    sha256: certSha256Fingerprint(cert),
    fingerprint256: String(cert.fingerprint256 || ''),
    serialNumber: String(cert.serialNumber || ''),
    isCa: Boolean(cert.ca),
    selfSigned,
    san: parseSanEntries(cert.subjectAltName),
    keyType: String(cert.publicKey?.asymmetricKeyType || ''),
    keySize: cert.publicKey?.asymmetricKeyDetails?.modulusLength || null,
    keyCurve: cert.publicKey?.asymmetricKeyDetails?.namedCurve || null,
    chainLength: Number.isInteger(options.chainLength) && (options.chainLength || 0) > 0 ? options.chainLength : 1,
    ...(sourceBasename ? { sourceBasename } : {})
  };
}

/**
 * @param {Buffer | string} input
 * @param {{ maxBytes?: number, maxBlocks?: number }} [options]
 * @returns {{ certs: crypto.X509Certificate[], pemBlocks: string[], pem: string }}
 */
function parseCertificatesFromBuffer(input, options = {}) {
  const maxBytes = Number.isFinite(options.maxBytes) ? Number(options.maxBytes) : MAX_CERT_BYTES;
  const maxBlocks = Number.isFinite(options.maxBlocks) ? Number(options.maxBlocks) : MAX_CERT_CHAIN_BLOCKS;
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input || ''), 'utf8');
  if (buf.byteLength === 0) {
    throw makeTlsError(TLS_ERROR_CODES.INVALID_FORMAT, 'Certificate input is empty');
  }
  if (buf.byteLength > maxBytes) {
    throw makeTlsError(TLS_ERROR_CODES.FILE_TOO_LARGE, `Certificate exceeds ${maxBytes} byte limit`);
  }
  const text = buf.toString('utf8');
  if (hasPrivateKeyMarker(text)) {
    throw makeTlsError(TLS_ERROR_CODES.PRIVATE_KEY_IN_CERT, 'Certificate file must not contain a private key');
  }

  /** @type {crypto.X509Certificate[]} */
  const certs = [];
  if (text.includes('-----BEGIN CERTIFICATE-----')) {
    const matches = text.match(CERT_PEM_BLOCK_RE) || [];
    if (matches.length === 0) {
      throw makeTlsError(TLS_ERROR_CODES.INVALID_FORMAT, 'Malformed PEM certificate block');
    }
    if (matches.length > maxBlocks) {
      throw makeTlsError(TLS_ERROR_CODES.TOO_MANY_CERTS, `Certificate chain exceeds maximum of ${maxBlocks} certificates`);
    }
    for (const block of matches) {
      try {
        certs.push(new crypto.X509Certificate(block));
      } catch (_) {
        throw makeTlsError(TLS_ERROR_CODES.INVALID_FORMAT, 'Invalid PEM X.509 certificate');
      }
    }
  } else {
    try {
      certs.push(new crypto.X509Certificate(buf));
    } catch (_) {
      throw makeTlsError(TLS_ERROR_CODES.INVALID_FORMAT, 'Input is neither a valid PEM nor DER X.509 certificate');
    }
  }

  const pemBlocks = certs.map((cert) => cert.toString().trim());
  return {
    certs,
    pemBlocks,
    pem: `${pemBlocks.join('\n')}\n`
  };
}

/**
 * @param {crypto.X509Certificate[]} certs
 * @param {{ now?: Date, allowExpired?: boolean }} [options]
 * @returns {{ warnings: string[] }}
 */
function validateCertificateChain(certs, options = {}) {
  if (!Array.isArray(certs) || certs.length === 0) {
    throw makeTlsError(TLS_ERROR_CODES.INVALID_FORMAT, 'Certificate chain is empty');
  }
  if (certs.length > MAX_CERT_CHAIN_BLOCKS) {
    throw makeTlsError(TLS_ERROR_CODES.TOO_MANY_CERTS, `Certificate chain exceeds maximum of ${MAX_CERT_CHAIN_BLOCKS} certificates`);
  }
  /** @type {string[]} */
  const warnings = [];
  for (let i = 0; i < certs.length; i += 1) {
    const cert = certs[i];
    validateKeyStrength(cert.publicKey);
    const validity = validateCertValidity(cert, options);
    if (i === 0 && validity.daysRemaining <= EXPIRY_WARN_DAYS) {
      warnings.push(
        validity.daysRemaining <= EXPIRY_CRITICAL_DAYS
          ? `Certificate expires critically soon (${validity.daysRemaining} day(s) remaining)`
          : `Certificate expires soon (${validity.daysRemaining} day(s) remaining)`
      );
    }
    if (i > 0) {
      if (!cert.ca) {
        throw makeTlsError(TLS_ERROR_CODES.BROKEN_CHAIN, 'Intermediate or root certificate in chain does not have CA basic constraint');
      }
      const subjectCert = certs[i - 1];
      let issued;
      let verified;
      try {
        issued = subjectCert.checkIssued(cert);
        verified = subjectCert.verify(cert.publicKey);
      } catch (_) {
        issued = false;
        verified = false;
      }
      if (!issued || !verified) {
        throw makeTlsError(TLS_ERROR_CODES.BROKEN_CHAIN, 'Certificate chain signature or issuer check failed');
      }
    }
  }
  return { warnings };
}

/**
 * Select the public certificate to export for client trust pinning:
 * prefer the highest CA certificate in the chain when present, otherwise the leaf.
 *
 * @param {crypto.X509Certificate[]} certs
 * @returns {string}
 */
function selectExportablePublicCertPem(certs) {
  if (!Array.isArray(certs) || certs.length === 0) return '';
  for (let i = certs.length - 1; i >= 0; i -= 1) {
    if (certs[i].ca) return `${certs[i].toString().trim()}\n`;
  }
  return `${certs[0].toString().trim()}\n`;
}

/**
 * Validate PEM certificate(s), private key, and optional intermediate CA chain.
 *
 * @param {{
 *   certBuffer: Buffer | string,
 *   keyBuffer: Buffer | string,
 *   caBuffer?: Buffer | string | null,
 *   passphrase?: string,
 *   now?: Date,
 *   sourceBasename?: string
 * }} params
 */
function validatePemBundle({
  certBuffer,
  keyBuffer,
  caBuffer = null,
  passphrase = undefined,
  now = new Date(),
  sourceBasename = ''
}) {
  const certParsed = parseCertificatesFromBuffer(certBuffer, { maxBytes: MAX_CERT_BYTES, maxBlocks: MAX_CERT_CHAIN_BLOCKS });
  const caParsed = caBuffer !== null && caBuffer !== undefined && (Buffer.isBuffer(caBuffer) ? caBuffer.byteLength > 0 : String(caBuffer).trim().length > 0)
    ? parseCertificatesFromBuffer(caBuffer, { maxBytes: MAX_CERT_BYTES, maxBlocks: MAX_CERT_CHAIN_BLOCKS })
    : null;

  const chain = [...certParsed.certs, ...(caParsed ? caParsed.certs : [])];
  if (chain.length > MAX_CERT_CHAIN_BLOCKS) {
    throw makeTlsError(TLS_ERROR_CODES.TOO_MANY_CERTS, `Combined certificate chain exceeds ${MAX_CERT_CHAIN_BLOCKS} certificates`);
  }

  const keyBuf = Buffer.isBuffer(keyBuffer) ? keyBuffer : Buffer.from(String(keyBuffer || ''), 'utf8');
  if (keyBuf.byteLength === 0) {
    throw makeTlsError(TLS_ERROR_CODES.MISSING_PRIVATE_KEY, 'Private key input is empty');
  }
  if (keyBuf.byteLength > MAX_KEY_BYTES) {
    throw makeTlsError(TLS_ERROR_CODES.FILE_TOO_LARGE, `Private key exceeds ${MAX_KEY_BYTES} byte limit`);
  }
  const keyText = keyBuf.toString('utf8');
  const keyBlocks = keyText.match(PRIVATE_KEY_PEM_BLOCK_RE) || [];
  if (keyBlocks.length === 0) {
    throw makeTlsError(TLS_ERROR_CODES.MISSING_PRIVATE_KEY, 'Private key file must contain a PEM private key block');
  }
  if (keyBlocks.length > 1) {
    throw makeTlsError(TLS_ERROR_CODES.MULTIPLE_PRIVATE_KEYS, 'Private key file must contain exactly one private key block');
  }
  const keyPem = `${String(keyBlocks[0] || '').trim()}\n`;

  /** @type {crypto.KeyObject} */
  let privateKey;
  try {
    privateKey = crypto.createPrivateKey({
      key: keyPem,
      format: 'pem',
      ...(passphrase !== undefined && passphrase !== '' ? { passphrase } : {})
    });
  } catch (error) {
    const code = classifyTlsError(error);
    if (code === TLS_ERROR_CODES.BAD_PASSPHRASE || keyPem.includes('ENCRYPTED')) {
      throw makeTlsError(TLS_ERROR_CODES.BAD_PASSPHRASE, 'Private key passphrase is missing or incorrect');
    }
    throw makeTlsError(TLS_ERROR_CODES.INVALID_FORMAT, 'Private key could not be parsed');
  }

  let matched;
  try {
    matched = chain[0].checkPrivateKey(privateKey);
  } catch (_) {
    matched = false;
  }
  if (!matched) {
    throw makeTlsError(TLS_ERROR_CODES.KEY_MISMATCH, 'Certificate public key does not match private key');
  }

  const { warnings } = validateCertificateChain(chain, { now });
  const fullchainPem = `${[...certParsed.pemBlocks, ...(caParsed ? caParsed.pemBlocks : [])].join('\n')}\n`;
  const metadata = projectCertMetadata(chain[0], {
    chainLength: chain.length,
    now,
    sourceBasename
  });

  return {
    format: /** @type {'pem'} */ ('pem'),
    certPem: fullchainPem,
    keyPem,
    caPem: caParsed ? caParsed.pem : '',
    certs: chain,
    exportablePublicCertPem: selectExportablePublicCertPem(chain),
    metadata,
    warnings
  };
}

function createInMemoryDuplexPair() {
  /** @type {stream.Duplex} */
  let right;
  const left = new stream.Duplex({
    read() {},
    write(chunk, _encoding, callback) {
      if (!right.destroyed) right.push(chunk);
      callback();
    },
    final(callback) {
      if (!right.destroyed) right.push(null);
      callback();
    }
  });
  right = new stream.Duplex({
    read() {},
    write(chunk, _encoding, callback) {
      if (!left.destroyed) left.push(chunk);
      callback();
    },
    final(callback) {
      if (!left.destroyed) left.push(null);
      callback();
    }
  });
  return { left, right };
}

/**
 * Extract X.509 certificate chain from a PKCS#12 buffer using an in-memory TLS
 * socket pair (never listening on any network or filesystem socket).
 *
 * @param {{
 *   pfxBuffer: Buffer,
 *   passphrase?: string,
 *   timeoutMs?: number
 * }} params
 * @returns {Promise<crypto.X509Certificate[]>}
 */
async function extractCertChainFromPkcs12({
  pfxBuffer,
  passphrase = undefined,
  timeoutMs = PKCS12_EXTRACT_TIMEOUT_MS
}) {
  if (!Buffer.isBuffer(pfxBuffer) || pfxBuffer.byteLength === 0) {
    throw makeTlsError(TLS_ERROR_CODES.INVALID_FORMAT, 'PKCS#12 buffer is empty');
  }
  if (pfxBuffer.byteLength > MAX_CERT_BYTES) {
    throw makeTlsError(TLS_ERROR_CODES.FILE_TOO_LARGE, `PKCS#12 bundle exceeds ${MAX_CERT_BYTES} byte limit`);
  }

  /** @type {tls.SecureContext} */
  let secureContext;
  try {
    secureContext = tls.createSecureContext({
      pfx: pfxBuffer,
      ...(passphrase !== undefined && passphrase !== '' ? { passphrase } : {}),
      minVersion: 'TLSv1.2',
      maxVersion: 'TLSv1.3'
    });
  } catch (error) {
    const code = classifyTlsError(error);
    throw makeTlsError(
      code,
      code === TLS_ERROR_CODES.BAD_PASSPHRASE
        ? 'PKCS#12 passphrase is missing or incorrect'
        : 'PKCS#12 bundle is invalid or missing a matching key pair'
    );
  }

  const { left, right } = createInMemoryDuplexPair();
  const serverTls = new tls.TLSSocket(left, {
    isServer: true,
    secureContext
  });
  // Strictly in-memory inspection of the just-loaded PKCS#12 SecureContext;
  // no network peer or external connection is involved.
  const clientTls = tls.connect({
    socket: right,
    rejectUnauthorized: false,
    minVersion: 'TLSv1.2',
    maxVersion: 'TLSv1.3'
  });

  const effectiveTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? Math.min(timeoutMs, 2000)
    : PKCS12_EXTRACT_TIMEOUT_MS;

  try {
    const certs = await new Promise((resolve, reject) => {
      let settled = false;
      /** @param {Error} err */
      const fail = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      };
      /** @param {crypto.X509Certificate[]} chain */
      const succeed = (chain) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(chain);
      };

      const timer = setTimeout(() => {
        fail(makeTlsError(TLS_ERROR_CODES.PKCS12_TIMEOUT, 'PKCS#12 certificate extraction timed out'));
      }, effectiveTimeout);
      timer.unref();

      serverTls.once('error', (err) => fail(makeTlsError(classifyTlsError(err), 'PKCS#12 inspection handshake failed')));
      clientTls.once('error', (err) => fail(makeTlsError(classifyTlsError(err), 'PKCS#12 inspection handshake failed')));

      clientTls.once('secure', () => {
        try {
          /** @type {any} */
          let cursor = clientTls.getPeerCertificate(true);
          /** @type {crypto.X509Certificate[]} */
          const collected = [];
          const seen = new Set();
          while (cursor && Buffer.isBuffer(cursor.raw) && cursor.raw.byteLength > 0) {
            const fp = String(cursor.fingerprint256 || crypto.createHash('sha256').update(cursor.raw).digest('hex'));
            if (seen.has(fp)) break;
            seen.add(fp);
            if (collected.length >= MAX_CERT_CHAIN_BLOCKS) {
              fail(makeTlsError(TLS_ERROR_CODES.TOO_MANY_CERTS, `PKCS#12 chain exceeds ${MAX_CERT_CHAIN_BLOCKS} certificates`));
              return;
            }
            collected.push(new crypto.X509Certificate(cursor.raw));
            if (!cursor.issuerCertificate || cursor.issuerCertificate === cursor) break;
            cursor = cursor.issuerCertificate;
          }
          if (collected.length === 0) {
            fail(makeTlsError(TLS_ERROR_CODES.INVALID_FORMAT, 'PKCS#12 bundle contains no X.509 certificate'));
            return;
          }
          succeed(collected);
        } catch (err) {
          fail(makeTlsError(classifyTlsError(err), 'Failed to extract X.509 certificates from PKCS#12 bundle'));
        }
      });
    });
    return certs;
  } finally {
    try { clientTls.destroy(); } catch (_) {}
    try { serverTls.destroy(); } catch (_) {}
    try { left.destroy(); } catch (_) {}
    try { right.destroy(); } catch (_) {}
  }
}

/**
 * Validate a PKCS#12 (.p12 / .pfx) bundle and extract sanitized metadata + exportable public cert.
 *
 * @param {{
 *   pfxBuffer: Buffer,
 *   passphrase?: string,
 *   now?: Date,
 *   timeoutMs?: number,
 *   sourceBasename?: string
 * }} params
 */
async function validatePkcs12Bundle({
  pfxBuffer,
  passphrase = undefined,
  now = new Date(),
  timeoutMs = PKCS12_EXTRACT_TIMEOUT_MS,
  sourceBasename = ''
}) {
  const certs = await extractCertChainFromPkcs12({ pfxBuffer, passphrase, timeoutMs });
  const { warnings } = validateCertificateChain(certs, { now });
  const metadata = projectCertMetadata(certs[0], {
    chainLength: certs.length,
    now,
    sourceBasename
  });
  return {
    format: /** @type {'pfx'} */ ('pfx'),
    pfxBuffer: Buffer.from(pfxBuffer),
    certs,
    exportablePublicCertPem: selectExportablePublicCertPem(certs),
    metadata,
    warnings
  };
}

/**
 * Validate a client-imported CA or self-signed certificate bundle (PEM or DER).
 * Rejects private keys, weak keys, expired/not-yet-valid certs, and oversized inputs.
 *
 * @param {Buffer | string} input
 * @param {{
 *   maxBytes?: number,
 *   maxBlocks?: number,
 *   now?: Date,
 *   sourceBasename?: string
 * }} [options]
 */
function validateClientCaCertBuffer(input, options = {}) {
  const maxBytes = Number.isFinite(options.maxBytes) ? Number(options.maxBytes) : MAX_CERT_BYTES;
  const maxBlocks = Number.isFinite(options.maxBlocks) ? Number(options.maxBlocks) : MAX_CERT_CHAIN_BLOCKS;
  const now = options.now instanceof Date ? options.now : new Date();
  const parsed = parseCertificatesFromBuffer(input, { maxBytes, maxBlocks });

  for (const cert of parsed.certs) {
    validateKeyStrength(cert.publicKey);
    validateCertValidity(cert, { now });
  }

  const primary = parsed.certs[0];
  const caFingerprintSha256 = crypto
    .createHash('sha256')
    .update(Buffer.concat(parsed.certs.map((c) => c.raw)))
    .digest('hex');
  const primaryMeta = projectCertMetadata(primary, {
    chainLength: parsed.certs.length,
    now,
    sourceBasename: options.sourceBasename || ''
  });

  return {
    caCertPem: parsed.pem,
    caFingerprintSha256,
    certs: parsed.certs,
    summary: {
      hasCustomCa: true,
      sha256: caFingerprintSha256,
      fingerprint256: primaryMeta.fingerprint256,
      subject: primaryMeta.subject,
      issuer: primaryMeta.issuer,
      validFrom: primaryMeta.validFrom,
      validTo: primaryMeta.validTo,
      daysRemaining: primaryMeta.daysRemaining,
      expiringSoon: primaryMeta.expiringSoon,
      expiringCritical: primaryMeta.expiringCritical,
      isCa: primaryMeta.isCa,
      selfSigned: primaryMeta.selfSigned,
      san: primaryMeta.san,
      certCount: parsed.certs.length,
      ...(primaryMeta.sourceBasename ? { sourceBasename: primaryMeta.sourceBasename } : {})
    }
  };
}

/**
 * Read and validate a client CA / self-signed cert file using O_NOFOLLOW + bounded reads.
 *
 * @param {string} filePath
 * @param {{
 *   maxBytes?: number,
 *   maxBlocks?: number,
 *   now?: Date,
 *   fsApi?: typeof fs
 * }} [options]
 */
function validateClientCaCertFile(filePath, options = {}) {
  const maxBytes = Number.isFinite(options.maxBytes) ? Number(options.maxBytes) : MAX_CERT_BYTES;
  const buf = readBoundedFile(filePath, {
    maxBytes,
    noFollow: true,
    fsApi: options.fsApi
  });
  return validateClientCaCertBuffer(buf, {
    ...options,
    sourceBasename: path.basename(filePath)
  });
}

/**
 * Read a passphrase from a private file (<= 1 KiB, stripping only trailing newline).
 *
 * @param {string} filePath
 * @param {{
 *   noFollow?: boolean,
 *   checkPrivateKeyPerms?: boolean,
 *   logger?: { warn?: (msg: string) => void } | null,
 *   fsApi?: typeof fs
 * }} [options]
 * @returns {string}
 */
function loadPassphraseFromFile(filePath, options = {}) {
  const buf = readBoundedFile(filePath, {
    maxBytes: MAX_PASSPHRASE_BYTES,
    noFollow: options.noFollow !== false,
    checkPrivateKeyPerms: options.checkPrivateKeyPerms !== false,
    logger: options.logger || null,
    fsApi: options.fsApi
  });
  return buf.toString('utf8').replace(/\r?\n$/, '');
}

module.exports = {
  EXPIRY_CRITICAL_DAYS,
  EXPIRY_WARN_DAYS,
  MAX_CERT_BYTES,
  MAX_CERT_CHAIN_BLOCKS,
  MAX_KEY_BYTES,
  MAX_PASSPHRASE_BYTES,
  PKCS12_EXTRACT_TIMEOUT_MS,
  TLS_ERROR_CODES,
  TLS_MIN_VERSIONS,
  certSha256Fingerprint,
  classifyTlsError,
  extractCertChainFromPkcs12,
  hasPrivateKeyMarker,
  hostMatchesCertSan,
  loadPassphraseFromFile,
  makeTlsError,
  parseCertificatesFromBuffer,
  parseSanEntries,
  projectCertMetadata,
  selectExportablePublicCertPem,
  readBoundedFile,
  validateCertValidity,
  validateCertificateChain,
  validateClientCaCertBuffer,
  validateClientCaCertFile,
  validateKeyStrength,
  validatePemBundle,
  validatePkcs12Bundle
};
