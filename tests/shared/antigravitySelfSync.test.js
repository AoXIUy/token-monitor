'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  ANTIGRAVITY_BACKGROUND_SYNC_TIMEOUT_MS,
  ANTIGRAVITY_EXPLICIT_SYNC_TIMEOUT_MS,
  createAntigravitySelfSync
} = require('../../src/shared/providers/antigravity/selfSync');
const { createSelfSyncThrottle, SYNC_SOURCE_EVENT_MIN_INTERVAL_MS } = require('../../src/shared/selfSyncThrottle');
const { installSourceEnvGuard } = require('../helpers/sourceEnv');
const { installInProcessWatchHost } = require('../helpers/watchHost');

installSourceEnvGuard(test);
installInProcessWatchHost(test);

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

test('collector routes forced Antigravity rescans to the explicit budget while keeping background syncs at 150s', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-sync-budget-'));
  fs.mkdirSync(path.join(home, '.gemini', 'antigravity'), { recursive: true });
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));

  const collectorPath = require.resolve('../../src/shared/collector');
  delete require.cache[collectorPath];
  t.after(() => { delete require.cache[collectorPath]; });
  const { collectUsageOnce } = require(collectorPath);

  const budgets = [];
  const baseOptions = {
    clients: 'antigravity',
    homeDir: home,
    osInfo: {},
    env: {},
    deviceId: 'test',
    agentVersion: 'test',
    historyEnabled: false,
    includeHistory: false,
    projectsEnabled: false,
    wslScanEnabled: false,
    codexLocalUsageEnabled: false,
    runTokscale: async () => ({ entries: [] }),
    runAntigravitySync: async (syncOpts) => { budgets.push(syncOpts.timeoutMs); }
  };

  for (const selection of [
    {},
    { sourceSelfSync: ['antigravity'] },
    { forceSelfSync: ['antigravity'] },
    { forceSelfSync: true },
    { forceSelfSync: ['cursor'], sourceSelfSync: ['antigravity'] },
    { forceSelfSync: ['antigravity'], selfSyncTimeoutMs: 4321 }
  ]) {
    t.mock.method(Date, 'now', () => 5_000_000 + budgets.length * 1_000_000);
    await collectUsageOnce({ ...baseOptions, ...selection });
  }

  assert.equal(ANTIGRAVITY_BACKGROUND_SYNC_TIMEOUT_MS, 150_000);
  assert.equal(ANTIGRAVITY_EXPLICIT_SYNC_TIMEOUT_MS, 300_000);
  assert.deepEqual(budgets, [
    ANTIGRAVITY_BACKGROUND_SYNC_TIMEOUT_MS,
    ANTIGRAVITY_BACKGROUND_SYNC_TIMEOUT_MS,
    ANTIGRAVITY_EXPLICIT_SYNC_TIMEOUT_MS,
    ANTIGRAVITY_EXPLICIT_SYNC_TIMEOUT_MS,
    ANTIGRAVITY_BACKGROUND_SYNC_TIMEOUT_MS,
    4321
  ]);
});

test('maybeSyncAntigravity lets a 50-second subprocess complete under the default background budget', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-50s-sync-'));
  fs.mkdirSync(path.join(home, '.gemini', 'antigravity'), { recursive: true });
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));

  t.mock.timers.enable({ apis: ['setTimeout'] });
  let spawnedChild = null;
  t.mock.method(childProcess, 'spawn', () => {
    const child = new EventEmitter();
    child.pid = 424299;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { end: () => {} };
    child.signals = [];
    child.kill = (sig) => { child.signals.push(sig); return true; };
    spawnedChild = child;
    return child;
  });

  const throttle = createSelfSyncThrottle();
  let failures = 0;
  const { maybeSyncAntigravity } = createAntigravitySelfSync({
    selfSyncThrottle: throttle,
    tokscaleCommand: () => ({ bin: 'tokscale', prefixArgs: [], env: {} })
  });

  const syncPromise = maybeSyncAntigravity('antigravity', null, home, {
    onFailure: () => { failures += 1; }
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(spawnedChild);

  // Past the old 30s timeout: a 50s multi-hundred-session export must still be alive.
  t.mock.timers.tick(50_000);
  assert.deepEqual(spawnedChild.signals, []);
  spawnedChild.emit('close', 0);
  await syncPromise;

  assert.equal(failures, 0);
  assert.equal(throttle.syncStatus('antigravity').state, 'ok');
});

test('an anchored Antigravity sync runs outside tickInFlight so watch scans do not stall behind it', async () => {
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'ag-nonblocking-'));
  fs.mkdirSync(path.join(tmp, '.gemini', 'antigravity', 'conversations'), { recursive: true });
  fs.mkdirSync(path.join(tmp, '.claude', 'projects', 'proj-a'), { recursive: true });

  const chokidar = require('../../src/shared/fileWatcher');
  const originalWatch = chokidar.watch;
  const originalHomedir = os.homedir;
  const originalSharedDir = process.env.TOKEN_MONITOR_SHARED_DIR;
  const originalNow = Date.now;
  let watchHandler = null;
  chokidar.watch = () => {
    const watcher = {
      on(event, handler) {
        if (event === 'all') watchHandler = handler;
        return watcher;
      },
      close() {}
    };
    return watcher;
  };
  os.homedir = () => tmp;
  process.env.TOKEN_MONITOR_SHARED_DIR = tmp;

  const baseNow = originalNow();
  let clockOffsetMs = 0;
  Date.now = () => baseNow + clockOffsetMs;

  const collectorPath = require.resolve('../../src/shared/collector');
  delete require.cache[collectorPath];

  let handle = null;
  let syncCalls = 0;
  let releaseSecondSync = null;
  let secondSyncStarted = false;
  let claudeTokens = 10;
  let antigravityDbTokens = 100;
  let antigravityRpcBonusTokens = 0;
  const updates = [];

  const waitFor = async (predicate, timeoutMs = 4000) => {
    const deadline = performance.now() + timeoutMs;
    while (!predicate()) {
      if (performance.now() >= deadline) throw new Error('timed out waiting for condition');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };

  try {
    const { startCollector } = require(collectorPath);
    handle = startCollector({
      clients: 'claude,antigravity',
      allTimeSince: '2024-01-01',
      commandTimeoutMs: 2000,
      homeDir: tmp,
      deviceId: 'test-device',
      agentVersion: 'test',
      intervalMs: 60 * 60 * 1000,
      watchEnabled: true,
      watchUsePolling: false,
      watchTriggersCollection: true,
      watchDebounceMs: 10,
      limitsEnabled: false,
      historyEnabled: false,
      dailyHistoryArchiveEnabled: false,
      anchorPersistenceEnabled: false,
      codexLocalUsageEnabled: false,
      wslScanEnabled: false,
      runAntigravitySync: async () => {
        syncCalls += 1;
        if (syncCalls === 2) {
          secondSyncStarted = true;
          await new Promise((resolve) => { releaseSecondSync = resolve; });
          antigravityRpcBonusTokens = 50;
        }
      },
      runTokscale: async ({ clients }) => {
        const requested = String(clients).split(',');
        const entries = [];
        if (requested.includes('claude')) {
          entries.push({ client: 'claude', sessionId: 'c1', model: 'claude-sonnet-4', input: claudeTokens, output: 0, cost: 0.01 });
        }
        if (requested.includes('antigravity')) {
          entries.push({
            client: 'antigravity',
            sessionId: 'ag1',
            model: 'gemini-2.5-pro',
            input: antigravityDbTokens + antigravityRpcBonusTokens,
            output: 0,
            cost: 0.02
          });
        }
        return { entries };
      },
      onUpdate: (summary, reason) => updates.push({ summary, reason })
    });

    await waitFor(() => updates.length === 1);
    assert.equal(syncCalls, 1);

    // Trigger an anchored Antigravity source sync that stays in flight (e.g. ~50s RPC export).
    clockOffsetMs = SYNC_SOURCE_EVENT_MIN_INTERVAL_MS + 1000;
    watchHandler('change', path.join(tmp, '.gemini', 'antigravity', 'conversations', 'ag1.db-wal'));
    await waitFor(() => secondSyncStarted);
    assert.equal(handle.getDiagnostics().tickInFlight, false, 'RPC sync runs outside tickInFlight');

    // While the RPC sync is still running, both Claude and direct Antigravity .db updates remain live.
    claudeTokens = 25;
    watchHandler('change', path.join(tmp, '.claude', 'projects', 'proj-a', 'c1.jsonl'));
    await waitFor(() => updates.at(-1)?.summary.today.clients.claude === 25);

    antigravityDbTokens = 140;
    watchHandler('change', path.join(tmp, '.gemini', 'antigravity', 'conversations', 'ag1.db-wal'));
    await waitFor(() => updates.at(-1)?.summary.today.clients.antigravity === 140);

    // Finishing the RPC sync scans behind it and publishes the synced result cleanly.
    releaseSecondSync();
    await waitFor(() => updates.at(-1)?.summary.today.clients.antigravity === 190);
    assert.equal(updates.at(-1).summary.clientHealth.clients.antigravity.collection.state, 'ok');
  } finally {
    Date.now = originalNow;
    if (handle) handle.stop();
    chokidar.watch = originalWatch;
    os.homedir = originalHomedir;
    if (originalSharedDir === undefined) delete process.env.TOKEN_MONITOR_SHARED_DIR;
    else process.env.TOKEN_MONITOR_SHARED_DIR = originalSharedDir;
    delete require.cache[collectorPath];
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
