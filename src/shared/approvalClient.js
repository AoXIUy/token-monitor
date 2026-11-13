'use strict';

const { APPROVAL_ALERT_BASE } = require('./approvalProtocol');

const MAX_RESPONSE_BYTES = 4096;
const MAX_IN_FLIGHT = 8;

function createApprovalClient({
  hubUrl,
  secret = '',
  deviceId,
  fetchFn = fetch,
  timeoutMs = 5000,
  onError
} = {}) {
  const controller = new AbortController();
  const endpoint = `${String(hubUrl || '').replace(/\/$/, '')}${APPROVAL_ALERT_BASE}`;
  const headers = {
    'content-type': 'application/json',
    ...(secret ? { authorization: `Bearer ${secret}` } : {})
  };
  let inFlight = 0;
  let stopped = false;

  async function readJsonBounded(response) {
    if (!response.body) return {};
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_RESPONSE_BYTES) throw new Error('approval_response_too_large');
        chunks.push(value);
      }
      const text = Buffer.concat(chunks).toString('utf8');
      return text ? JSON.parse(text) : {};
    } finally {
      await reader.cancel().catch(() => {});
    }
  }

  async function sendAlert(req) {
    if (stopped || controller.signal.aborted || inFlight >= MAX_IN_FLIGHT) {
      return { ok: false, reason: 'skipped' };
    }
    inFlight += 1;
    try {
      const response = await fetchFn(endpoint, {
        method: 'POST',
        headers,
        redirect: 'error',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)]),
        body: JSON.stringify({ ...req, deviceId })
      });
      if (!response.ok) {
        const error = new Error(`approval_http_${response.status}`);
        onError?.(error);
        return { ok: false, reason: error.message };
      }
      const payload = await readJsonBounded(response);
      if (!payload?.ok) {
        return { ok: false, reason: payload?.error || 'rejected' };
      }
      return { ok: true, id: payload.id, expiresAt: payload.expiresAt };
    } catch (error) {
      if (!stopped && !controller.signal.aborted) onError?.(error);
      return { ok: false, reason: 'unreachable' };
    } finally {
      inFlight -= 1;
    }
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    controller.abort();
  }

  return { sendAlert, stop };
}

module.exports = { createApprovalClient };
