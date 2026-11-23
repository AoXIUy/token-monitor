'use strict';

const { compareHubBuild } = require('../shared/hubBuildComparison');
const { normalizeRuntime } = require('../shared/hubBuildIdentity');
const { createHubClientFetch } = require('../shared/hubClientFetch');

function healthRuntime(payload) {
  return normalizeRuntime(payload?.hubBuild?.runtime || payload?.runtime || '');
}

async function probeHubBuild(hubUrl, options = {}) {
  const base = String(hubUrl || '').trim().replace(/\/$/, '');
  if (!base) return { status: 'notConfigured', runtime: '', hubUrl: '' };
  const timeoutMs = Math.max(250, Number(options.timeoutMs) || 5000);
  const fetchImpl = options.fetchImpl || createHubClientFetch({
    caCertPem: options.caCertPem || '',
    defaultTimeoutMs: timeoutMs
  });
  const signal = options.signal || AbortSignal.timeout(timeoutMs);
  const secret = String(options.secret || '').trim();
  const headers = secret ? { authorization: `Bearer ${secret}` } : undefined;
  try {
    const response = await fetchImpl(`${base}/api/health`, {
      signal,
      redirect: 'error',
      ...(headers ? { headers } : {})
    });
    if (!response.ok) return { status: 'unavailable', runtime: '', hubUrl: base };
    const payload = await response.json();
    if (payload?.role !== 'hub') return { status: 'unavailable', runtime: '', hubUrl: base };
    const compared = compareHubBuild(payload?.hubBuild);
    const runtime = compared.status === 'legacy' ? healthRuntime(payload) : compared.runtime;
    const deployment = payload.deployment;
    return {
      ...compared,
      runtime,
      ...(runtime === 'node-hub' && (deployment === 'app' || deployment === 'standalone') ? { deployment } : {}),
      hubUrl: base
    };
  } catch (_) {
    return { status: 'unavailable', runtime: '', hubUrl: base };
  }
}

module.exports = { healthRuntime, probeHubBuild };
