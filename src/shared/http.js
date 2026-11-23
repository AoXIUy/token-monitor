'use strict';

const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { acceptsEncoding } = require('./hubProtocol');
const { MAX_UPLOAD_BYTES } = require('./uploadDelta');

const MAX_JSON_BODY_BYTES = MAX_UPLOAD_BYTES;
const JSON_COMPRESSION_MIN_BYTES = 1024;

const SECURITY_HEADERS = Object.freeze({
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin'
});

function securityHeaders(extraHeaders = {}) {
  return {
    ...SECURITY_HEADERS,
    ...extraHeaders
  };
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const req = res?.req || null;
  const compressed = req && acceptsEncoding(req, 'gzip') && body.byteLength >= JSON_COMPRESSION_MIN_BYTES
    ? zlib.gzipSync(body, { level: zlib.constants.Z_BEST_SPEED })
    : null;
  const wire = compressed || body;
  res.writeHead(statusCode, securityHeaders({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': String(wire.byteLength),
    ...(compressed ? { 'content-encoding': 'gzip', vary: 'accept-encoding' } : {}),
    ...extraHeaders
  }));
  if (req && req.method === 'HEAD') {
    res.end();
    return;
  }
  res.end(wire);
}

function sendText(res, statusCode, body, contentType = 'text/plain; charset=utf-8', extraHeaders = {}) {
  const req = res?.req || null;
  const text = String(body ?? '');
  res.writeHead(statusCode, securityHeaders({
    'content-type': contentType,
    'cache-control': 'no-store',
    ...extraHeaders
  }));
  if (req && req.method === 'HEAD') {
    res.end();
    return;
  }
  res.end(text);
}

function makePayloadTooLargeError() {
  const error = new Error('Request body too large');
  error.code = 'payload_too_large';
  return error;
}

function declaredContentLength(req) {
  const raw = req?.headers?.['content-length'];
  if (raw === undefined || raw === null || raw === '') return null;
  const text = Array.isArray(raw) ? raw[0] : String(raw);
  if (!/^\d+$/.test(text.trim())) return null;
  const parsed = Number(text.trim());
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function readRawTextBody(req, maxBytes = MAX_JSON_BODY_BYTES) {
  const declared = declaredContentLength(req);
  if (declared !== null && declared > maxBytes) {
    try { req.pause?.(); } catch (_) {}
    return Promise.reject(makePayloadTooLargeError());
  }
  return new Promise((resolve, reject) => {
    let body = '';
    let bytes = 0;
    let settled = false;

    const cleanup = () => {
      req.off?.('data', onData);
      req.off?.('end', onEnd);
      req.off?.('error', onError);
      req.off?.('aborted', onAborted);
    };

    const fail = (error) => {
      if (settled) return;
      settled = true;
      body = '';
      cleanup();
      reject(error);
    };

    const onData = (chunk) => {
      if (settled) return;
      bytes += Buffer.byteLength(chunk, 'utf8');
      if (bytes > maxBytes) {
        try { req.pause?.(); } catch (_) {}
        fail(makePayloadTooLargeError());
        return;
      }
      body += chunk;
    };

    const onEnd = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(body);
    };

    const onError = (error) => fail(error);
    const onAborted = () => {
      const error = new Error('Request aborted');
      error.code = 'request_aborted';
      fail(error);
    };

    req.setEncoding?.('utf8');
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    req.on('aborted', onAborted);
  });
}

async function readJsonBody(req, maxBytes = MAX_JSON_BODY_BYTES) {
  const body = await readRawTextBody(req, maxBytes);
  if (!body.trim()) return {};
  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error(`Invalid JSON body: ${error.message}`, { cause: error });
  }
}

function requestSecret(req) {
  const auth = req?.headers?.authorization || '';
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  const header = req?.headers?.['x-token-monitor-secret'];
  return typeof header === 'string' ? header.trim() : '';
}

// Compare SHA-256 digests rather than the raw strings: timingSafeEqual needs
// equal-length inputs, and hashing both sides first gives it that without
// leaking the secret's length through a padded compare.
function timingSafeEqualText(actual, expected) {
  const digest = (value) => crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest();
  return crypto.timingSafeEqual(digest(actual), digest(expected));
}

function isAuthorized(req, expectedSecret) {
  if (!expectedSecret) return true;
  return timingSafeEqualText(requestSecret(req), expectedSecret);
}

module.exports = {
  MAX_JSON_BODY_BYTES,
  SECURITY_HEADERS,
  isAuthorized,
  readJsonBody,
  readRawTextBody,
  requestSecret,
  securityHeaders,
  sendJson,
  sendText,
  timingSafeEqualText
};
