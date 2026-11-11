'use strict';

const { randomUUID } = require('node:crypto');
const { conversationQuery, conversationPage } = require('../shared/sessionConversationProtocol');

// Response-owned long polls and queries only. No transcript cache or disk writes.
function createSessionConversationRelay({ enabled, getDevice, now = Date.now, pollMs = 20000, queryMs = 12000 } = {}) {
  const readers = new Map();
  const pending = new Map();

  function online(reader) { return reader && now() - reader.seenAt < 30000; }
  function finish(id, result) {
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    clearTimeout(request.timer);
    if (request.reader.requestId === id) request.reader.requestId = '';
    request.resolve(result);
  }
  function poll(deviceId, instance, signal) {
    if (!enabled) return Promise.resolve({ error: 'disabled' });
    if (typeof deviceId !== 'string' || deviceId.length > 256 || !getDevice(deviceId)
      || !/^[a-f0-9-]{36}$/.test(instance)) return Promise.resolve({ error: 'invalid_request' });
    let reader = readers.get(deviceId);
    if (reader && online(reader) && (reader.instance !== instance || reader.deliver)) return Promise.resolve({ error: 'reader_busy' });
    if (!reader || reader.instance !== instance) {
      if (reader?.requestId) finish(reader.requestId, { error: 'device_offline' });
      if (readers.size >= 64) {
        for (const [id, previous] of readers) if (!online(previous) && !previous.deliver) readers.delete(id);
        if (readers.size >= 64) return Promise.resolve({ error: 'reader_busy' });
      }
      reader = { instance, seenAt: now(), requestId: '' };
      readers.set(deviceId, reader);
    }
    reader.seenAt = now();
    return new Promise((resolve) => {
      let timer;
      const deliver = (payload) => {
        if (reader.deliver !== deliver) return;
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancelled);
        reader.deliver = null;
        resolve(payload);
      };
      const cancelled = () => { reader.seenAt = -Infinity; deliver({ error: 'device_offline' }); };
      reader.deliver = deliver;
      timer = setTimeout(() => deliver({ request: null }), pollMs);
      signal?.addEventListener('abort', cancelled, { once: true });
      if (signal?.aborted) cancelled();
    });
  }
  function query(value, signal) {
    if (!enabled) return Promise.resolve({ error: 'disabled' });
    let query;
    try { query = conversationQuery(value); } catch (_) { return Promise.resolve({ error: 'invalid_request' }); }
    const device = getDevice(query.deviceId);
    if (!device) return Promise.resolve({ error: 'not_found' });
    if (!['today', 'month'].some((period) => Object.hasOwn(device.periods?.[period]?.sessions || {}, query.key))) {
      return Promise.resolve({ error: 'not_found' });
    }
    const reader = readers.get(query.deviceId);
    if (!online(reader) || !reader.deliver) return Promise.resolve({ error: reader?.requestId ? 'reader_busy' : 'device_offline' });
    if (pending.size >= 16) return Promise.resolve({ error: 'reader_busy' });
    const id = randomUUID();
    return new Promise((resolve) => {
      const cancelled = () => finish(id, { error: 'device_offline' });
      const complete = (result) => { signal?.removeEventListener('abort', cancelled); resolve(result); };
      const timer = setTimeout(() => finish(id, { error: 'query_timeout' }), queryMs);
      pending.set(id, { query, reader, resolve: complete, timer });
      reader.requestId = id;
      signal?.addEventListener('abort', cancelled, { once: true });
      if (signal?.aborted) cancelled();
      else reader.deliver({ request: { id, ...query } });
    });
  }
  function result(value) {
    if (!enabled) return { error: 'disabled' };
    const request = pending.get(value?.id);
    if (!request || request.query.deviceId !== value.deviceId || request.reader.instance !== value.instance
      || !getDevice(value.deviceId)) return { error: 'not_found' };
    let page;
    try { page = conversationPage(value.page); } catch (_) { return { error: 'invalid_request' }; }
    request.reader.seenAt = now();
    finish(value.id, page);
    return { ok: true };
  }
  function remove(deviceId) {
    const reader = readers.get(deviceId);
    if (reader?.requestId) finish(reader.requestId, { error: 'device_offline' });
    reader?.deliver?.({ error: 'device_offline' });
    readers.delete(deviceId);
  }
  function stop() {
    for (const id of readers.keys()) remove(id);
  }
  function setEnabled(value) {
    enabled = value === true;
    if (enabled) return;
    for (const id of pending.keys()) finish(id, { error: 'disabled' });
    for (const reader of readers.values()) reader.deliver?.({ error: 'disabled' });
    readers.clear();
  }
  return { poll, query, result, remove, stop, setEnabled };
}

module.exports = { createSessionConversationRelay };
