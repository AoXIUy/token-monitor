'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createAntigravitySelfSync } = require('../../src/shared/providers/antigravity/selfSync');
const { createSelfSyncThrottle } = require('../../src/shared/selfSyncThrottle');

function fakeSpawn({ exitCode = 0, stdout = '', stderr = '' }) {
  return () => {
    const child = new EventEmitter();
    child.pid = 424242;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { end: () => {} };
    child.kill = () => {};
    setImmediate(() => {
      if (stdout) child.stdout.emit('data', Buffer.from(stdout));
      if (stderr) child.stderr.emit('data', Buffer.from(stderr));
      child.emit('close', exitCode);
    });
    return child;
  };
}

test('maybeSyncAntigravity drains stdout and logs diagnostic note when 0 RPC connections are detected', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-selfsync-'));
  fs.mkdirSync(path.join(home, '.gemini', 'antigravity'), { recursive: true });
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));

  t.mock.method(childProcess, 'spawn', fakeSpawn({
    exitCode: 0,
    stdout: [
      'Antigravity sync',
      '  detected connections: 0',
      '  export candidates: 197',
      '  cached sessions after sync: 0'
    ].join('\n')
  }));

  const throttle = createSelfSyncThrottle();
  const logs = [];
  let failures = 0;
  const { maybeSyncAntigravity } = createAntigravitySelfSync({
    selfSyncThrottle: throttle,
    tokscaleCommand: () => ({ bin: 'tokscale', prefixArgs: [], env: {} })
  });

  await maybeSyncAntigravity('antigravity', (msg) => logs.push(msg), home, {
    onFailure: () => { failures += 1; }
  });

  assert.equal(failures, 0);
  assert.equal(throttle.syncStatus('antigravity').state, 'ok');
  assert.equal(logs.length, 1);
  assert.match(logs[0], /0 RPC connections/);
});
