'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHub } = require('../../src/hub/server');
const { createSessionConversationRelay } = require('../../src/hub/sessionConversations');
const { createSessionConversationClient } = require('../../src/shared/sessionConversationClient');

const id = '00000000-0000-0000-0000-000000000000';
const sessions = { 'codex:example': { client: 'codex', sessionId: 'example', totalTokens: 10 } };
const page = { messages: [{ id: '0', role: 'assistant', text: 'Requested private reply', kind: 'message', timestamp: '', continued: false }],
  revision: 'a'.repeat(24), nextCursor: '', incomplete: false };
const record = { deviceId: 'pc', hostname: 'PC', updatedAt: new Date().toISOString(),
  today: { totalTokens: 10, sessions }, month: { totalTokens: 10, sessions }, allTime: { totalTokens: 10 } };

test('relay admits only online registered readers and a known session, validates result identity and forgets it', async () => {
  const device = { periods: { today: { sessions } } };
  const relay = createSessionConversationRelay({ enabled: true, getDevice: key => key === 'pc' ? device : null });
  const query = { deviceId: 'pc', key: 'codex:example', cursor: '' };
  assert.equal((await relay.query(query)).error, 'device_offline');
  assert.equal((await relay.query({ ...query, key: 'codex:unknown' })).error, 'not_found');
  const poll = relay.poll('pc', id);
  const response = relay.query(query);
  const { request } = await poll;
  assert.equal((await relay.query(query)).error, 'reader_busy');
  assert.equal(relay.result({ ...request, instance: 'wrong', page }).error, 'not_found');
  assert.deepEqual(relay.result({ ...request, instance: id, page }), { ok: true });
  assert.deepEqual(await response, page);
  assert.equal(relay.result({ ...request, instance: id, page }).error, 'not_found');
  relay.stop();
});

test('relay timeout, viewer cancellation and deletion discard pending results and shutdown closes polls', async () => {
  const relay = createSessionConversationRelay({ enabled: true, getDevice: () => ({ periods: { today: { sessions } } }), queryMs: 15 });
  const query = { deviceId: 'pc', key: 'codex:example', cursor: '' };
  let poll = relay.poll('pc', id), result = relay.query(query);
  await poll;
  assert.equal((await result).error, 'query_timeout');
  poll = relay.poll('pc', id);
  const controller = new AbortController();
  result = relay.query(query, controller.signal);
  const { request } = await poll;
  controller.abort();
  assert.equal((await result).error, 'device_offline');
  assert.equal(relay.result({ ...request, instance: id, page }).error, 'not_found');
  poll = relay.poll('pc', id);
  result = relay.query(query);
  await poll;
  relay.remove('pc');
  assert.equal((await result).error, 'device_offline');
  poll = relay.poll('pc', id);
  relay.stop();
  assert.equal((await poll).error, 'device_offline');
});

test('HTTP producer reads nothing until a viewer requests one page; stats, disk and restart contain no text', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-conversation-hub-'));
  const dataFile = path.join(dir, 'devices.json');
  const hub = createHub({ host: '127.0.0.1', port: 0, secret: 'test-secret', sessionConversations: true, dataFile });
  await hub.start();
  let reader;
  t.after(async () => { reader?.stop(); await hub.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  const url = `http://127.0.0.1:${hub.server.address().port}`;
  hub.ingest(record);
  const target = `${url}/api/session-conversations?deviceId=pc&key=codex%3Aexample&cursor=`;
  assert.equal((await fetch(target)).status, 401);
  let reads = 0, polled;
  const started = new Promise(resolve => { polled = resolve; });
  reader = createSessionConversationClient({ hubUrl: url, secret: 'test-secret', deviceId: 'pc',
    fetchFn: (target, options) => { const result = fetch(target, options); if (target.includes('/poll?')) setImmediate(polled); return result; },
    read: async () => { reads++; return page; }, retryMs: 10 });
  reader.update(record);
  reader.start();
  await started;
  assert.equal(reads, 0);
  // The long poll has crossed HTTP admission before its response is held open.
  let result;
  for (let attempt = 0; attempt < 10; attempt++) {
    result = await (await fetch(target, { headers: { authorization: 'Bearer test-secret' } })).json();
    if (!result.error) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(result.messages[0].text, page.messages[0].text);
  assert.equal(reads, 1);
  assert.ok(!JSON.stringify(hub.getStats()).includes('Requested private reply'));
  assert.ok(!fs.readFileSync(dataFile, 'utf8').includes('Requested private reply'));
  reader.stop();
  await hub.stop();
  const restarted = createHub({ host: '127.0.0.1', port: 0, secret: 'test-secret', sessionConversations: true, dataFile });
  await restarted.start();
  const unavailable = await (await fetch(`http://127.0.0.1:${restarted.server.address().port}/api/session-conversations?deviceId=pc&key=codex%3Aexample`,
    { headers: { authorization: 'Bearer test-secret' } })).json();
  assert.equal(unavailable.error, 'device_offline');
  await restarted.stop();
});

test('feature remains off without explicit Hub opt-in', async () => {
  const relay = createSessionConversationRelay({ enabled: false, getDevice: () => ({}) });
  assert.deepEqual(await relay.query({}), { error: 'disabled' });
  assert.deepEqual(await relay.poll('pc', id), { error: 'disabled' });
  assert.deepEqual(relay.result({}), { error: 'disabled' });
});
