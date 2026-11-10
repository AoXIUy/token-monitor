'use strict';

const { randomUUID } = require('node:crypto');
const { Worker } = require('node:worker_threads');
const { setTimeout: delay } = require('node:timers/promises');
const { CONVERSATION_BASE, conversationQuery, conversationPage } = require('./sessionConversationProtocol');

function readConversationInWorker(query, { signal, wslScanEnabled = false, options } = {}) {
  return new Promise((resolve) => {
    const worker = new Worker(require.resolve('./sessionConversationWorker'), { workerData: { query, wslScanEnabled, options } });
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancelled);
      worker.terminate().catch(() => {});
      resolve(result);
    };
    const cancelled = () => finish({ error: 'device_offline' });
    const timer = setTimeout(() => finish({ error: 'query_timeout' }), 10000);
    worker.once('message', finish);
    worker.once('error', () => finish({ error: 'read_failed' }));
    worker.once('exit', () => finish({ error: 'read_failed' }));
    signal?.addEventListener('abort', cancelled, { once: true });
    if (signal?.aborted) cancelled();
  });
}

function createSessionConversationClient({ hubUrl, secret, deviceId, fetchFn = fetch,
  read = readConversationInWorker, wslScanEnabled = false, retryMs = 3000 } = {}) {
  const controller = new AbortController();
  const instance = randomUUID();
  const base = `${hubUrl.replace(/\/$/, '')}${CONVERSATION_BASE}`;
  const headers = { authorization: `Bearer ${secret}`, 'content-type': 'application/json' };
  let allowed = new Set();
  let running = false;
  function update(summary) {
    allowed = new Set(['today', 'month'].flatMap((period) => Object.keys(summary?.[period]?.sessions || {})));
  }
  async function request(url, body) {
    const response = await fetchFn(url, { method: body ? 'POST' : 'GET', headers, redirect: 'error',
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25000)]), ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) throw new Error('conversation_transport');
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 8192) throw new Error('conversation_transport');
        chunks.push(value);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } finally { await reader.cancel().catch(() => {}); }
  }
  async function run() {
    if (running) return;
    running = true;
    while (!controller.signal.aborted) {
      try {
        const payload = await request(`${base}/poll?deviceId=${encodeURIComponent(deviceId)}&instance=${instance}`);
        if (payload.error) throw new Error('conversation_transport');
        if (!payload.request) continue;
        const query = conversationQuery(payload.request);
        if (query.deviceId !== deviceId || !allowed.has(query.key) || !/^[a-f0-9-]{36}$/.test(payload.request.id)) throw new Error('invalid_request');
        let page = await read(query, { signal: controller.signal, wslScanEnabled });
        // Snapshot replacement can revoke a session while the file read runs.
        if (!allowed.has(query.key)) page = { error: 'not_found' };
        if (controller.signal.aborted) break;
        await request(`${base}/result`, { id: payload.request.id, deviceId, instance, page: conversationPage(page) });
      } catch (_) {
        if (!controller.signal.aborted) await delay(retryMs, null, { signal: controller.signal }).catch(() => {});
      }
    }
  }
  return { update, start: () => { void run(); }, stop: () => { allowed.clear(); controller.abort(); } };
}

module.exports = { createSessionConversationClient, readConversationInWorker };
