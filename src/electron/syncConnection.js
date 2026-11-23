'use strict';

// Classify why the sync stream is offline into a stable machine code. The main
// process knows the raw HTTP status / network errno; the renderer maps the code
// to a localized string. Pure and dependency-free so it is trivially testable.
const ERRNO_REASONS = {
  ECONNREFUSED: 'refused',
  ETIMEDOUT: 'timeout',
  ENOTFOUND: 'dns',
  EAI_AGAIN: 'dns',
  EHOSTUNREACH: 'unreachable',
  ENETUNREACH: 'unreachable',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'tls_untrusted',
  SELF_SIGNED_CERT_IN_CHAIN: 'tls_untrusted',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'tls_untrusted',
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'tls_untrusted',
  UNABLE_TO_GET_ISSUER_CERT: 'tls_untrusted',
  CERT_UNTRUSTED: 'tls_untrusted',
  CERT_HAS_EXPIRED: 'tls_expired',
  CERT_NOT_YET_VALID: 'tls_expired',
  ERR_TLS_CERT_ALTNAME_INVALID: 'tls_hostname_mismatch',
  HOSTNAME_MISMATCH: 'tls_hostname_mismatch'
};

function classifyStreamFailure({ status = null, errorCode = null, message = null, eof = false } = {}) {
  if (eof) return { reason: 'disconnected', detail: null };
  if (errorCode) {
    if (ERRNO_REASONS[errorCode]) return { reason: ERRNO_REASONS[errorCode], detail: null };
    if (/^(?:ERR_TLS_|ERR_SSL_|EPROTO$)/.test(String(errorCode))) {
      return { reason: 'tls_error', detail: null };
    }
    return { reason: 'network', detail: errorCode };
  }
  if (status != null) {
    if (status === 401 || status === 403) return { reason: 'unauthorized', detail: null };
    return { reason: 'server_error', detail: String(status) };
  }
  return { reason: 'network', detail: message || null };
}

module.exports = { classifyStreamFailure };
