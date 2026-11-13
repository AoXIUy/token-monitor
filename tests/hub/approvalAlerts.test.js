'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHub } = require('../../src/hub/server');
const { createApprovalAlertStore } = require('../../src/hub/approvalAlerts');
const { createApprovalClient } = require('../../src/shared/approvalClient');

test('alert store stays disabled until enabled, enforces FIFO bounds, TTL expiry, and device removal', () => {
  let clock = 1000;
  const store = createApprovalAlertStore({
    enabled: false,
    getDevice: (id) => (id === 'pc' ? { hostname: 'Workstation' } : null),
    now: () => clock,
    ttlMs: 5000
  });

  assert.deepEqual(store.list(), { error: 'disabled' });
  assert.deepEqual(store.create({ client: 'codex', deviceId: 'pc', sessionId: 's1', tool: 'Bash' }), { error: 'disabled' });

  store.setEnabled(true);
  assert.deepEqual(store.list(), { ok: true, alerts: [] });

  // Evicts oldest per device above 8 without failing fresh alerts
  for (let i = 0; i < 10; i += 1) {
    const res = store.create({
      deviceId: 'pc', client: 'codex', sessionId: `s${i}`, tool: 'Bash', command: `echo ${i}`,
      description: 'Desc', projectLabel: 'repo'
    });
    assert.equal(res.ok, true);
    assert.equal(res.expiresAt, clock + 5000);
  }
  const listed = store.list();
  assert.equal(listed.ok, true);
  assert.equal(listed.alerts.length, 8);
  assert.equal(listed.alerts[0].deviceName, 'Workstation');
  assert.equal(listed.alerts[0].command, 'echo 2');
  assert.equal(listed.alerts[7].command, 'echo 9');

  // Enforces global cap of 32 across devices
  for (let d = 0; d < 4; d += 1) {
    for (let i = 0; i < 8; i += 1) {
      assert.equal(store.create({
        deviceId: `dev-${d}`, client: 'antigravity', sessionId: `g-${d}-${i}`, tool: 'run_command', command: `cmd-${d}-${i}`
      }).ok, true);
    }
  }
  assert.equal(store.list().alerts.length, 32);

  // Device disconnect cleanup
  store.remove('dev-0');
  assert.equal(store.list().alerts.filter((a) => a.deviceId === 'dev-0').length, 0);

  // Expiry
  clock += 6000;
  assert.deepEqual(store.list(), { ok: true, alerts: [] });

  // Disabling clears existing alerts
  assert.equal(store.create({ deviceId: 'pc', client: 'codex', sessionId: 'sx', tool: 'Bash' }).ok, true);
  store.setEnabled(false);
  assert.deepEqual(store.list(), { error: 'disabled' });
  store.setEnabled(true);
  assert.deepEqual(store.list(), { ok: true, alerts: [] });
  store.stop();
});

test('HTTP routes enforce secret, remove decision/poll/cancel endpoints, and keep alerts out of stats/disk', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-alert-hub-'));
  const dataFile = path.join(dir, 'devices.json');
  const hub = createHub({ host: '127.0.0.1', port: 0, secret: 'top-secret', approvalAlerts: true, dataFile });
  await hub.start();
  let client;
  t.after(async () => { client?.stop(); await hub.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  const baseUrl = `http://127.0.0.1:${hub.server.address().port}`;
  hub.ingest({
    deviceId: 'dev1', hostname: 'DevBox', updatedAt: new Date().toISOString(),
    today: { totalTokens: 1 }, month: { totalTokens: 1 }, allTime: { totalTokens: 1 }
  });

  // Auth, method, size, and removed-route checks
  assert.equal((await fetch(`${baseUrl}/api/approval-alerts`)).status, 401);
  assert.equal((await fetch(`${baseUrl}/api/approval-alerts`, {
    method: 'DELETE',
    headers: { authorization: 'Bearer top-secret' }
  })).status, 405);
  assert.equal((await fetch(`${baseUrl}/api/approval-alerts`, {
    method: 'POST',
    headers: { authorization: 'Bearer top-secret', 'content-type': 'application/json' },
    body: JSON.stringify({ huge: 'x'.repeat(20000) })
  })).status, 413);
  for (const legacyPath of ['/api/approvals', '/api/approvals/decision', '/api/approval-alerts/decision', '/api/approval-alerts/poll', '/api/approval-alerts/cancel']) {
    assert.equal((await fetch(`${baseUrl}${legacyPath}`, {
      method: 'POST',
      headers: { authorization: 'Bearer top-secret', 'content-type': 'application/json' },
      body: '{}'
    })).status, 404);
  }

  client = createApprovalClient({ hubUrl: baseUrl, secret: 'top-secret', deviceId: 'dev1' });
  const sent = await client.sendAlert({
    client: 'codex',
    sessionId: 'sess-1',
    tool: 'Bash',
    command: 'SECRET_COMMAND_MARKER=1 npm test',
    description: 'Run unit tests',
    projectLabel: 'token-monitor'
  });
  assert.equal(sent.ok, true);

  const listed = await (await fetch(`${baseUrl}/api/approval-alerts`, {
    headers: { authorization: 'Bearer top-secret' }
  })).json();
  assert.equal(listed.ok, true);
  assert.equal(listed.alerts.length, 1);
  assert.equal(listed.alerts[0].command, 'SECRET_COMMAND_MARKER=1 npm test');
  assert.equal(listed.alerts[0].deviceName, 'DevBox');

  // Verify stats and disk contain no command text
  assert.ok(!JSON.stringify(hub.getStats()).includes('SECRET_COMMAND_MARKER'));
  assert.ok(!fs.readFileSync(dataFile, 'utf8').includes('SECRET_COMMAND_MARKER'));
});
