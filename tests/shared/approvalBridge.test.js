'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApprovalBridge } = require('../../src/shared/approvalBridge');
const { sendAlertToBridge } = require('../../src/shared/approvalHook');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('bridge authenticates token, dispatches alerts without blocking, and isolates ownership', async (t) => {
  const dir = tmpDir('tm-bridge-');
  const seen = [];
  const pendingTimers = new Set();
  let mode = 'slow';

  const bridge = createApprovalBridge({
    dataDir: dir,
    onAlert: async (alert) => {
      seen.push(alert);
      if (mode === 'error') throw new Error('boom');
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          pendingTimers.delete(timer);
          resolve();
        }, 2000);
        pendingTimers.add(timer);
      });
    }
  });
  const started = await bridge.start();
  assert.equal(started.started, true);
  t.after(async () => {
    for (const timer of pendingTimers) clearTimeout(timer);
    pendingTimers.clear();
    await bridge.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const meta = JSON.parse(fs.readFileSync(bridge.metadataPath, 'utf8'));
  assert.equal(meta.endpoint, bridge.endpoint);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(bridge.metadataPath).mode & 0o777, 0o600);
    assert.equal(fs.statSync(bridge.endpoint).mode & 0o777, 0o600);
  }

  // Wrong token is rejected and never reaches onAlert
  const unauth = await sendAlertToBridge(meta.endpoint, {
    token: 'wrong', client: 'codex', sessionId: 's1', tool: 'Bash', command: 'ls'
  });
  assert.equal(unauth.ok, false);
  assert.equal(seen.length, 0);

  // Valid alert acks immediately without waiting for slow async delivery
  const t0 = Date.now();
  const ok = await sendAlertToBridge(meta.endpoint, {
    token: meta.token, client: 'codex', sessionId: 's1', tool: 'Bash', command: 'ls'
  });
  assert.equal(ok.ok, true);
  assert.ok(Date.now() - t0 < 1000, 'IPC must ack before delivery finishes');
  assert.equal(seen.length, 1);

  // Delivery error still returns ok ack without blocking
  mode = 'error';
  const errReply = await sendAlertToBridge(meta.endpoint, {
    token: meta.token, client: 'antigravity', sessionId: 's2', tool: 'run_command', command: 'pwd'
  });
  assert.equal(errReply.ok, true);
  assert.equal(seen.length, 2);

  // Second bridge in same dir refuses to steal active endpoint
  const rival = createApprovalBridge({ dataDir: dir, onAlert: () => {} });
  const rivalStarted = await rival.start();
  assert.equal(rivalStarted.started, false);
  assert.equal(rivalStarted.reason, 'already_owned');
  await rival.stop();
  assert.equal(fs.existsSync(bridge.metadataPath), true);

  await bridge.stop();
  assert.equal(fs.existsSync(bridge.metadataPath), false);
});
