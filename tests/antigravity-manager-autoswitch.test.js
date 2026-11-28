'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const autoSwitch = require('../src/electron/antigravityManager/autoSwitch');
const { createAntigravityManagerStore } = require('../src/electron/antigravityManager/store');
const { createAntigravityManagerService } = require('../src/electron/antigravityManager');

test('evaluateLocalQuotaTrigger enforces rpc-only source, 5h/weekly windows, scopes, and thresholds', () => {
  const baseWindows = [
    { kind: 'session', label: 'Gemini 5-hour', usedPercent: 20, windowMinutes: 300, showMeter: true },
    { kind: 'weekly', label: 'Gemini weekly', usedPercent: 40, windowMinutes: 10080, showMeter: true },
    { kind: 'session', label: 'Claude/GPT 5-hour', usedPercent: 30, windowMinutes: 300, showMeter: true },
    { kind: 'weekly', label: 'Claude/GPT weekly', usedPercent: 50, windowMinutes: 10080, showMeter: true },
    { kind: 'weekly', label: 'Gemini 4 Argon weekly', usedPercent: 100, windowMinutes: 10080, showMeter: true }
  ];

  // OAuth rows or unavailable RPC rows never trigger local auto-switch
  assert.equal(
    autoSwitch.evaluateLocalQuotaTrigger({
      providers: [
        { provider: 'antigravity', source: 'oauth', status: 'ok', windows: [{ kind: 'session', label: 'Gemini 5-hour', usedPercent: 100 }] },
        { provider: 'antigravity', source: 'rpc', status: 'unavailable', windows: [{ kind: 'session', label: 'Gemini 5-hour', usedPercent: 100 }] }
      ]
    }).triggered,
    false
  );

  // Primary scope ignores Argon-only exhaustion when Gemini and Claude/GPT still have quota
  const primaryRes = autoSwitch.evaluateLocalQuotaTrigger(
    { providers: [{ provider: 'antigravity', source: 'rpc', sourceDetail: 'app', status: 'ok', accountEmail: 'a@b.com', windows: baseWindows }] },
    { autoSwitchScope: 'primary', autoSwitchThresholdPercent: 0 }
  );
  assert.equal(primaryRes.triggered, false);

  // Any scope triggers when Argon weekly is exhausted
  const anyRes = autoSwitch.evaluateLocalQuotaTrigger(
    { providers: [{ provider: 'antigravity', source: 'rpc', sourceDetail: 'ide', status: 'ok', accountEmail: 'A@B.com', windows: baseWindows }] },
    { autoSwitchScope: 'any', autoSwitchThresholdPercent: 0 }
  );
  assert.equal(anyRes.triggered, true);
  assert.equal(anyRes.accountEmail, 'a@b.com');
  assert.equal(anyRes.sourceDetail, 'ide');
  assert.equal(anyRes.hardExhausted, true);
  assert.deepEqual(anyRes.exhaustedFamilies, ['other']);

  // Primary scope triggers when Claude/GPT 5-hour hits limit (0% remaining) or custom threshold (<= 10% remaining)
  const claude5hHit = [
    ...baseWindows.slice(0, 2),
    { kind: 'session', label: 'Claude/GPT 5-hour', usedPercent: 92, windowMinutes: 300, showMeter: true },
    baseWindows[3]
  ];
  assert.equal(
    autoSwitch.evaluateLocalQuotaTrigger(
      { providers: [{ provider: 'antigravity', source: 'rpc', sourceDetail: 'cli', status: 'ok', windows: claude5hHit }] },
      { autoSwitchScope: 'primary', autoSwitchThresholdPercent: 5 }
    ).triggered,
    false
  );
  const thresholdTrigger = autoSwitch.evaluateLocalQuotaTrigger(
    { providers: [{ provider: 'antigravity', source: 'rpc', sourceDetail: 'cli', status: 'ok', windows: claude5hHit }] },
    { autoSwitchScope: 'primary', autoSwitchThresholdPercent: 10 }
  );
  assert.equal(thresholdTrigger.triggered, true);
  assert.equal(thresholdTrigger.hardExhausted, false);
  assert.deepEqual(thresholdTrigger.exhaustedFamilies, ['claude']);
  assert.equal(autoSwitch.resolveSwitchTargetForTrigger('auto', thresholdTrigger.sourceDetail), 'agy');
  assert.equal(autoSwitch.resolveSwitchTargetForTrigger('auto', 'cli', { classicRunning: true, ideRunning: false }), 'auto');
  assert.equal(autoSwitch.resolveSwitchTargetForTrigger('auto', 'ide'), 'auto');
  assert.equal(autoSwitch.resolveSwitchTargetForTrigger('auto', 'app'), 'auto');
  assert.equal(autoSwitch.resolveSwitchTargetForTrigger('acp', thresholdTrigger.sourceDetail), 'acp');

  // All scope requires every group to have at least one exhausted window
  assert.equal(
    autoSwitch.evaluateLocalQuotaTrigger(
      { providers: [{ provider: 'antigravity', source: 'rpc', status: 'ok', windows: claude5hHit }] },
      { autoSwitchScope: 'all', autoSwitchThresholdPercent: 10 }
    ).triggered,
    false
  );
  const allDepleted = [
    { kind: 'session', label: 'Gemini 5-hour', usedPercent: 100, windowMinutes: 300, showMeter: true },
    { kind: 'weekly', label: 'Claude/GPT weekly', usedPercent: 100, windowMinutes: 10080, showMeter: true }
  ];
  assert.equal(
    autoSwitch.evaluateLocalQuotaTrigger(
      { providers: [{ provider: 'antigravity', source: 'rpc', status: 'ok', windows: allDepleted }] },
      { autoSwitchScope: 'all', autoSwitchThresholdPercent: 0 }
    ).triggered,
    true
  );
});

test('selectReplacementAccount and store weights support both auto family-aware scoring and custom weight priority', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agm-weight-store-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const store = createAntigravityManagerStore({ baseDir: dir });
  const aCurrent = store.upsertAccount({
    email: 'current@example.com',
    subscriptionTier: 'ULTRA',
    weight: 100,
    quota: {
      lastUpdatedAt: 1000,
      groups: [
        { displayName: 'Gemini', buckets: [{ window: '5h', remainingFraction: 1 }] },
        { displayName: 'Claude/GPT', buckets: [{ window: '5h', remainingFraction: 0 }] }
      ]
    }
  }, { refreshToken: '1//cur' });

  const aGeminiHeavy = store.upsertAccount({
    email: 'gemini-heavy@example.com',
    subscriptionTier: 'ULTRA',
    weight: 80,
    quota: {
      lastUpdatedAt: 1000,
      groups: [
        { displayName: 'Gemini', buckets: [{ window: '5h', remainingFraction: 1 }, { window: 'weekly', remainingFraction: 1 }] },
        { displayName: 'Claude/GPT', buckets: [{ window: '5h', remainingFraction: 0.1 }, { window: 'weekly', remainingFraction: 0.2 }] }
      ]
    }
  }, { refreshToken: '1//gh' });

  const aClaudeReady = store.upsertAccount({
    email: 'claude-ready@example.com',
    subscriptionTier: 'PRO',
    weight: 40,
    quota: {
      lastUpdatedAt: 1000,
      groups: [
        { displayName: 'Gemini', buckets: [{ window: '5h', remainingFraction: 0.6 }, { window: 'weekly', remainingFraction: 0.6 }] },
        { displayName: 'Claude/GPT', buckets: [{ window: '5h', remainingFraction: 0.95 }, { window: 'weekly', remainingFraction: 0.9 }] }
      ]
    }
  }, { refreshToken: '1//cr' });

  const aExhaustedTopWeight = store.upsertAccount({
    email: 'exhausted-vip@example.com',
    subscriptionTier: 'ULTRA',
    weight: 99,
    quota: {
      lastUpdatedAt: 1000,
      groups: [
        { displayName: 'Gemini', buckets: [{ window: '5h', remainingFraction: 0.9 }] },
        { displayName: 'Claude/GPT', buckets: [{ window: '5h', remainingFraction: 0 }] }
      ]
    }
  }, { refreshToken: '1//vip' });

  // Custom weight persists across quota updates and clamps to [1, 100]
  store.updateAccountQuota(aClaudeReady.id, aClaudeReady.quota, { subscriptionTier: 'PRO' });
  assert.equal(store.getAccount(aClaudeReady.id).weight, 40);
  store.setAccountWeight(aClaudeReady.id, 150);
  assert.equal(store.getAccount(aClaudeReady.id).weight, 100);
  store.setAccountWeight(aClaudeReady.id, 40);
  assert.equal(store.getAccount(aClaudeReady.id).weight, 40);

  assert.equal(aExhaustedTopWeight.weight, 99);
  const pool = store.listAccounts();

  // Auto mode (Claude exhausted): skips current & exhausted-vip, prefers claude-ready (90% Claude) over gemini-heavy (10% Claude)
  const autoPick = autoSwitch.selectReplacementAccount(pool, {
    selectionMode: 'auto',
    scope: 'primary',
    thresholdPercent: 0,
    excludeEmails: ['current@example.com'],
    preferredFamilies: ['claude'],
    requireVerifiedQuota: true
  });
  assert.equal(autoPick?.id, aClaudeReady.id);

  // Weighted mode: skips current (excluded) and exhausted-vip (Claude 0%), picks gemini-heavy (weight 80 > weight 40)
  const weightedPick = autoSwitch.selectReplacementAccount(pool, {
    selectionMode: 'weighted',
    scope: 'primary',
    thresholdPercent: 0,
    excludeIds: [aCurrent.id],
    preferredFamilies: ['claude'],
    requireVerifiedQuota: true
  });
  assert.equal(weightedPick?.id, aGeminiHeavy.id);
});

test('service auto-switches on local 5h/weekly limit after refreshing pool, respects cooldown and running-session deferral', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agm-autoswitch-svc-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  let clockMs = 1_760_000_000_000;
  let sessionBusy = false;
  let quotaFetchCount = 0;
  let keyringStored = null;
  const completedEvents = [];

  const quotasByToken = {
    'ya29.cur': {
      tier: 'pro-tier',
      groups: [
        { displayName: 'Gemini', buckets: [{ window: '5h', remainingFraction: 0.8 }] },
        { displayName: 'Claude and GPT', buckets: [{ window: '5h', remainingFraction: 0, resetTime: '2026-11-27T04:00:00Z' }] }
      ]
    },
    'ya29.vip-depleted': {
      tier: 'ultra-tier',
      groups: [
        { displayName: 'Gemini', buckets: [{ window: '5h', remainingFraction: 0.9 }] },
        { displayName: 'Claude and GPT', buckets: [{ window: 'weekly', remainingFraction: 0, resetTime: '2026-11-30T00:00:00Z' }] }
      ]
    },
    'ya29.backup-high': {
      tier: 'pro-tier',
      groups: [
        { displayName: 'Gemini', buckets: [{ window: '5h', remainingFraction: 0.85 }] },
        { displayName: 'Claude and GPT', buckets: [{ window: '5h', remainingFraction: 0.9 }, { window: 'weekly', remainingFraction: 0.8 }] }
      ]
    },
    'ya29.backup-low-weight': {
      tier: 'ultra-tier',
      groups: [
        { displayName: 'Gemini', buckets: [{ window: '5h', remainingFraction: 1 }] },
        { displayName: 'Claude and GPT', buckets: [{ window: '5h', remainingFraction: 1 }, { window: 'weekly', remainingFraction: 1 }] }
      ]
    }
  };

  const service = createAntigravityManagerService({
    baseDir: path.join(dir, 'mgr'),
    nowMs: () => clockMs,
    isLocalAntigravityBusy: () => sessionBusy,
    onAutoSwitchCompleted: (ev) => completedEvents.push(ev),
    switcherDeps: {
      oauth: { ensureFreshToken: async (tok) => tok },
      deviceProfile: {
        getStoragePath: () => '',
        readDeviceProfile: () => null,
        generateDeviceProfile: () => ({
          machineId: 'auth0|user_mock',
          macMachineId: 'mac-mock',
          devDeviceId: 'dev-mock',
          sqmId: '{SQM-MOCK}'
        })
      },
      keyring: {
        writeToSystemKeyring: (payload) => { keyringStored = payload; },
        readFromSystemKeyring: () => keyringStored
      },
      fileCredentials: { writeFileCredentials: () => {} }
    },
    fetch: async (url, init) => {
      const auth = String(init?.headers?.authorization || '').replace(/^Bearer\s+/i, '');
      const mock = quotasByToken[auth] || quotasByToken['ya29.backup-high'];
      if (String(url).includes('loadCodeAssist')) {
        return new Response(JSON.stringify({ currentTier: { id: mock.tier } }), { status: 200 });
      }
      if (String(url).includes('fetchAvailableModels')) {
        quotaFetchCount += 1;
        return new Response(JSON.stringify({ models: {} }), { status: 200 });
      }
      if (String(url).includes('retrieveUserQuotaSummary')) {
        return new Response(JSON.stringify({ groups: mock.groups }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    }
  });
  t.after(() => service.stop());

  const seedDir = path.join(dir, 'seed');
  fs.mkdirSync(path.join(seedDir, 'accounts'), { recursive: true });
  const exp = Math.floor(clockMs / 1000) + 7200;
  const seedAccounts = [
    { file: 'a1.json', email: 'cur@example.com', access: 'ya29.cur', rt: '1//cur' },
    { file: 'a2.json', email: 'vip@example.com', access: 'ya29.vip-depleted', rt: '1//vip' },
    { file: 'a3.json', email: 'preferred@example.com', access: 'ya29.backup-high', rt: '1//pref' },
    { file: 'a4.json', email: 'full@example.com', access: 'ya29.backup-low-weight', rt: '1//full' }
  ];
  for (const item of seedAccounts) {
    fs.writeFileSync(path.join(seedDir, 'accounts', item.file), JSON.stringify({
      email: item.email,
      token: { access_token: item.access, refresh_token: item.rt, expiry_timestamp: exp }
    }));
  }
  service.importDataDir(seedDir);
  const byEmail = Object.fromEntries(service.getState().accounts.map((a) => [a.email, a.id]));
  service.setAccountWeight(byEmail['vip@example.com'], 95);
  service.setAccountWeight(byEmail['preferred@example.com'], 80);
  service.setAccountWeight(byEmail['full@example.com'], 30);

  const exhaustedPayload = {
    providers: [{
      provider: 'antigravity',
      source: 'rpc',
      sourceDetail: 'cli',
      status: 'ok',
      accountEmail: 'cur@example.com',
      windows: [
        { kind: 'session', label: 'Gemini 5-hour', usedPercent: 15, windowMinutes: 300, showMeter: true },
        { kind: 'session', label: 'Claude/GPT 5-hour', usedPercent: 100, windowMinutes: 300, showMeter: true }
      ]
    }]
  };

  // Disabled by default -> does nothing
  const offRes = await service.onLocalLimitsUpdated(exhaustedPayload);
  assert.equal(offRes.triggered, false);
  assert.equal(offRes.skipped, 'disabled');
  assert.equal(quotaFetchCount, 0);

  // Enable weighted auto-switch -> refreshes pool, discovers vip@ is weekly-exhausted, switches AGY CLI to preferred@ (weight 80)
  service.updateConfig({
    autoSwitchEnabled: true,
    selectionMode: 'weighted',
    autoSwitchCooldownSeconds: 120,
    refreshSlideDelaySecs: 0
  });
  const swRes = await service.onLocalLimitsUpdated(exhaustedPayload);
  assert.equal(swRes.triggered, true);
  assert.equal(swRes.ok, true);
  assert.equal(swRes.target, 'agy');
  assert.equal(swRes.account.email, 'preferred@example.com');
  assert.equal(quotaFetchCount, 4, 'refreshed all 4 pool accounts before picking replacement');
  assert.equal(service.getState().activeAccounts.agy, byEmail['preferred@example.com']);
  assert.equal(completedEvents.length, 1);
  assert.equal(completedEvents[0].toEmail, 'preferred@example.com');

  // Repeat event within 120s cooldown is suppressed
  clockMs += 30_000;
  const coolRes = await service.onLocalLimitsUpdated(exhaustedPayload);
  assert.equal(coolRes.skipped, 'cooldown');
  assert.equal(quotaFetchCount, 4);

  // Soft-threshold trigger while session is running defers until activity becomes idle
  clockMs += 150_000;
  service.updateConfig({
    selectionMode: 'auto',
    autoSwitchThresholdPercent: 10
  });
  sessionBusy = true;
  const softPayload = {
    providers: [{
      provider: 'antigravity',
      source: 'rpc',
      sourceDetail: 'cli',
      status: 'ok',
      accountEmail: 'preferred@example.com',
      windows: [
        { kind: 'session', label: 'Claude/GPT 5-hour', usedPercent: 93, windowMinutes: 300, showMeter: true }
      ]
    }]
  };
  const deferred = await service.onLocalLimitsUpdated(softPayload);
  assert.equal(deferred.skipped, 'session_busy');
  assert.equal(service.getState().activeAccounts.agy, byEmail['preferred@example.com']);

  sessionBusy = false;
  const resumed = await service.onLocalActivityChanged();
  assert.equal(resumed?.ok, true);
  assert.equal(resumed?.account?.email, 'full@example.com');
  assert.equal(service.getState().activeAccounts.agy, byEmail['full@example.com']);
});

test('Windows Antigravity.exe (sourceDetail=ide) targets Classic, writes keyring + DB, excludes keyring-detected account, and falls back from stale hot-switch to restart', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agm-win32-autoswitch-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const appDir = path.join(dir, 'Programs', 'Antigravity', 'resources', 'app');
  fs.mkdirSync(appDir, { recursive: true });
  fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({ version: '1.104.2' }));
  fs.writeFileSync(path.join(appDir, 'product.json'), JSON.stringify({ ideVersion: '2.34.0' }));
  const exePath = path.join(dir, 'Programs', 'Antigravity', 'Antigravity.exe');
  fs.writeFileSync(exePath, '');

  const processManager = require('../src/electron/antigravityManager/processManager');
  assert.equal(processManager.detectAntigravityVersion(exePath), '2.34.0');
  assert.equal(await processManager.detectAntigravityVersionAsync(exePath), '2.34.0');

  let keyringCalls = 0;
  const dbTargets = [];
  let closedCount = 0;
  let startedCount = 0;
  let liveRpcEmail = 'win-cur@example.com';

  const service = createAntigravityManagerService({
    baseDir: path.join(dir, 'mgr'),
    autoSwitchMonitorOptions: {
      pollMs: 60_000,
      activityDebounceMs: 25,
      activityMinIntervalMs: 50,
      turnEndDelayMs: 25,
      startupDelayMs: 60_000,
      hotSwitchVerifyDelayMs: 20
    },
    probeLocalLimits: async () => ({
      updatedAt: new Date().toISOString(),
      providers: [{
        provider: 'antigravity',
        source: 'rpc',
        sourceDetail: 'ide', // Windows Antigravity.exe extensions\antigravity\bin\language_server_windows_x64.exe
        status: 'ok',
        accountEmail: liveRpcEmail === 'win-cur@example.com' ? '' : liveRpcEmail, // simulate initial GetUserStatus timeout, then post-hot-switch check
        windows: [
          { kind: 'session', label: 'Gemini 5-hour', usedPercent: 100, windowMinutes: 300, showMeter: true }
        ]
      }]
    }),
    switcherDeps: {
      oauth: { ensureFreshToken: async (tok) => tok },
      stateDb: {
        getDbPath: (target) => {
          const slot = target === 'ide' ? 'Antigravity IDE' : 'Antigravity';
          return path.join(dir, 'Roaming', slot, 'User', 'globalStorage', 'state.vscdb');
        },
        injectTokenToDbAsync: async (dbPath, payload) => {
          dbTargets.push({ dbPath, email: payload.email });
        }
      },
      deviceProfile: {
        getStoragePath: () => path.join(dir, 'Roaming', 'Antigravity', 'User', 'globalStorage', 'storage.json'),
        readDeviceProfileAsync: async () => null,
        writeDeviceProfileAsync: async () => {},
        generateDeviceProfile: () => ({
          machineId: 'auth0|user_w',
          macMachineId: 'mac-w',
          devDeviceId: 'dev-w',
          sqmId: '{SQM-W}'
        })
      },
      keyring: {
        readFromSystemKeyringAsync: async () => ({ refreshToken: '1//win-cur', email: 'win-cur@example.com' }),
        writeToSystemKeyringAsync: async () => { keyringCalls += 1; }
      },
      fileCredentials: {
        readLocalCredentialFilesAsync: async () => [],
        writeFileCredentialsAsync: async () => {}
      },
      fs: { existsSync: () => true },
      processManager: {
        listProcessesAsync: async () => [{
          pid: 4100,
          name: 'Antigravity.exe',
          exePath,
          argv0: exePath,
          args: `"${exePath}"`
        }],
        isAntigravityRunning: (target) => target !== 'ide',
        getAntigravityExecutablePathAsync: async () => exePath,
        detectAntigravityVersionAsync: async () => '1.104.2', // Even if version < 2.0.0, keyring + DB both get written
        compareSemver: processManager.compareSemver,
        getArgsFromRunningProcess: () => [],
        getUserDataDirFromProcess: () => null,
        getLanguageServerPids: () => [4101],
        killLanguageServerAsync: async () => {
          // Simulate Electron keeping stale in-memory state.vscdb account across LS respawn
          liveRpcEmail = ' stale-old@example.com '.trim();
          return 1;
        },
        waitForLanguageServerRespawn: async () => true,
        closeAntigravity: async () => { closedCount += 1; },
        startAntigravity: () => {
          startedCount += 1;
          liveRpcEmail = 'win-fresh@example.com';
        }
      }
    },
    fetch: async (url, init) => {
      const auth = String(init?.headers?.authorization || '');
      const isFresh = auth.includes('ya29.win-fresh');
      if (String(url).includes('loadCodeAssist')) {
        return new Response(JSON.stringify({ currentTier: { id: 'pro-tier' } }), { status: 200 });
      }
      if (String(url).includes('retrieveUserQuotaSummary')) {
        return new Response(JSON.stringify({
          groups: [{
            displayName: 'Gemini',
            buckets: [{ window: '5h', remainingFraction: isFresh ? 0.95 : 0.9 }]
          }]
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ models: {} }), { status: 200 });
    }
  });
  t.after(() => service.stop());

  const seedDir = path.join(dir, 'seed');
  fs.mkdirSync(path.join(seedDir, 'accounts'), { recursive: true });
  const exp = Math.floor(Date.now() / 1000) + 7200;
  fs.writeFileSync(path.join(seedDir, 'accounts', 'cur.json'), JSON.stringify({
    email: 'win-cur@example.com',
    token: { access_token: 'ya29.win-cur', refresh_token: '1//win-cur', expiry_timestamp: exp }
  }));
  fs.writeFileSync(path.join(seedDir, 'accounts', 'fresh.json'), JSON.stringify({
    email: 'win-fresh@example.com',
    token: { access_token: 'ya29.win-fresh', refresh_token: '1//win-fresh', expiry_timestamp: exp }
  }));
  service.importDataDir(seedDir);

  const switchedPromise = new Promise((resolve) => {
    const check = setInterval(() => {
      const last = service.getState().lastAutoSwitch;
      if (last) {
        clearInterval(check);
        resolve(last);
      }
    }, 15);
  });

  // Enabling autoSwitchEnabled triggers immediate local RPC probe without manual widget Refresh click!
  service.updateConfig({ autoSwitchEnabled: true, refreshSlideDelaySecs: 0 });
  const last = await switchedPromise;

  assert.equal(last.ok, true);
  assert.equal(last.toEmail, 'win-fresh@example.com', 'excluded win-cur@example.com via Windows keyring hint');
  assert.equal(last.target, 'classic', 'targeted running Classic Antigravity.exe instead of nonexistent Antigravity IDE');
  assert.equal(last.mode, 'restart', 'fell back from stale hot-switch to full restart when live RPC email stayed mismatched');
  assert.equal(closedCount, 1);
  assert.equal(startedCount, 1);
  assert.ok(keyringCalls >= 2, 'wrote Windows Credential Manager even when package.json reported 1.104.2');
  assert.ok(dbTargets.every((d) => !d.dbPath.includes('Antigravity IDE')));
});

test('Linux / desktop turn-end session activity triggers standalone local RPC probe without manual Refresh click', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agm-linux-turnend-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  let probeCount = 0;
  let currentUsedPct = 40;
  let keyringPayload = null;

  const service = createAntigravityManagerService({
    baseDir: path.join(dir, 'mgr'),
    autoSwitchMonitorOptions: {
      pollMs: 60_000,
      activityDebounceMs: 25,
      activityMinIntervalMs: 5000,
      turnEndDelayMs: 25,
      startupDelayMs: 60_000
    },
    probeLocalLimits: async () => {
      probeCount += 1;
      return {
        updatedAt: new Date().toISOString(),
        providers: [{
          provider: 'antigravity',
          source: 'rpc',
          sourceDetail: 'cli',
          status: 'ok',
          accountEmail: 'linux-a@example.com',
          windows: [{ kind: 'session', label: 'Gemini 5-hour', usedPercent: currentUsedPct, windowMinutes: 300, showMeter: true }]
        }]
      };
    },
    switcherDeps: {
      oauth: { ensureFreshToken: async (tok) => tok },
      deviceProfile: {
        getStoragePath: () => '',
        readDeviceProfile: () => null,
        generateDeviceProfile: () => ({ machineId: 'm', macMachineId: 'mm', devDeviceId: 'd', sqmId: '{S}' })
      },
      keyring: {
        writeToSystemKeyring: (p) => { keyringPayload = p; },
        readFromSystemKeyring: () => keyringPayload
      },
      fileCredentials: { writeFileCredentials: () => {} }
    },
    fetch: async (url) => {
      if (String(url).includes('loadCodeAssist')) {
        return new Response(JSON.stringify({ currentTier: { id: 'pro-tier' } }), { status: 200 });
      }
      if (String(url).includes('retrieveUserQuotaSummary')) {
        return new Response(JSON.stringify({
          groups: [{ displayName: 'Gemini', buckets: [{ window: '5h', remainingFraction: 0.9 }] }]
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ models: {} }), { status: 200 });
    }
  });
  t.after(() => service.stop());

  const seedDir = path.join(dir, 'seed');
  fs.mkdirSync(path.join(seedDir, 'accounts'), { recursive: true });
  const exp = Math.floor(Date.now() / 1000) + 7200;
  fs.writeFileSync(path.join(seedDir, 'accounts', 'a.json'), JSON.stringify({
    email: 'linux-a@example.com',
    token: { access_token: 'ya29.la', refresh_token: '1//la', expiry_timestamp: exp }
  }));
  fs.writeFileSync(path.join(seedDir, 'accounts', 'b.json'), JSON.stringify({
    email: 'linux-b@example.com',
    token: { access_token: 'ya29.lb', refresh_token: '1//lb', expiry_timestamp: exp }
  }));
  service.importDataDir(seedDir);
  service.updateConfig({ autoSwitchEnabled: true, refreshSlideDelaySecs: 0 });

  await new Promise((r) => setTimeout(r, 60));
  assert.equal(probeCount, 1);
  assert.equal(service.getState().lastAutoSwitch, null);

  // Simulate session starting (busy=true), burning quota to 100%, then ending turn (busy=false) -> immediate turn_end probe
  service.onLocalActivityChanged({ busy: true });
  currentUsedPct = 100;
  service.onLocalActivityChanged({ busy: false });

  await new Promise((resolve) => {
    const check = setInterval(() => {
      if (service.getState().lastAutoSwitch) {
        clearInterval(check);
        resolve();
      }
    }, 15);
  });

  assert.equal(service.getState().lastAutoSwitch?.ok, true);
  assert.equal(service.getState().lastAutoSwitch?.toEmail, 'linux-b@example.com');
});

test('auto-resume snapshots mid-run and quota-stopped top-level conversations, ignores finished/subagent threads, and wakes idle threads via agentapi after switch', async (t) => {
  const http = require('node:http');
  const sqlite = require('node:sqlite');
  const taskResume = require('../src/electron/antigravityManager/taskResume');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agm-autoresume-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const agRoot = path.join(dir, '.gemini', 'antigravity');
  const daemonDir = path.join(agRoot, 'daemon');
  fs.mkdirSync(daemonDir, { recursive: true });
  const fakeLsExe = path.join(dir, 'Antigravity', 'resources', 'bin', 'language_server');
  fs.mkdirSync(path.dirname(fakeLsExe), { recursive: true });
  fs.writeFileSync(fakeLsExe, '');

  const dbPath = path.join(agRoot, 'conversation_summaries.db');
  const db = new sqlite.DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE conversation_summaries (
      conversation_id TEXT PRIMARY KEY,
      title TEXT,
      preview TEXT,
      status TEXT,
      not_fully_idle INTEGER,
      killed INTEGER,
      parent_conversation_id TEXT,
      nesting_depth INTEGER,
      last_modified_time TEXT,
      last_user_input_time TEXT
    );
  `);
  const nowIso = new Date().toISOString().replace('T', ' ').replace('Z', '+00:00');
  const insert = db.prepare(`
    INSERT INTO conversation_summaries
      (conversation_id, title, preview, status, not_fully_idle, killed, parent_conversation_id, nesting_depth, last_modified_time, last_user_input_time)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  // 1. Interrupted by quota mid-turn (IDLE in DB, last step in transcript.jsonl is GENERIC/SYSTEM_MESSAGE without final PLANNER_RESPONSE)
  insert.run('conv-quota-hit', 'Sync v0.99.0', '', 'CASCADE_RUN_STATUS_IDLE', 0, 0, '', 0, nowIso, nowIso);
  // 2. Actively running right before switch kills language_server
  insert.run('conv-mid-run', 'Refactor UI', '', 'CASCADE_RUN_STATUS_RUNNING', 1, 0, '', 0, nowIso, nowIso);
  // 3. Cleanly finished conversation (must NOT be resumed!)
  insert.run('conv-finished', 'Completed task', '', 'CASCADE_RUN_STATUS_IDLE', 0, 0, '', 0, nowIso, nowIso);
  // 4. Subagent child conversation (must NOT be resumed directly!)
  insert.run('conv-subagent', 'Subagent worker', '', 'CASCADE_RUN_STATUS_RUNNING', 1, 0, 'conv-quota-hit', 1, nowIso, '0001-01-01 00:00:00+00:00');
  // 5. Already recovered/running after switch (GetConversation returns RUN_STATE_RUNNING -> must skip duplicate send!)
  insert.run('conv-already-running', 'Already resumed', '', 'CASCADE_RUN_STATUS_RUNNING', 1, 0, '', 0, nowIso, nowIso);
  db.close();

  const writeTranscript = (cid, rows) => {
    const logDir = path.join(agRoot, 'brain', cid, '.system_generated', 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(path.join(logDir, 'transcript.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  };
  writeTranscript('conv-quota-hit', [
    { step_index: 0, type: 'USER_INPUT', source: 'USER_EXPLICIT', status: 'DONE' },
    { step_index: 1, type: 'PLANNER_RESPONSE', source: 'MODEL', status: 'DONE', tool_calls: [{ name: 'run_command' }] },
    { step_index: 2, type: 'GENERIC', source: 'MODEL', status: 'DONE' },
    { step_index: 3, type: 'SYSTEM_MESSAGE', source: 'SYSTEM', status: 'DONE' }
  ]);
  writeTranscript('conv-finished', [
    { step_index: 0, type: 'USER_INPUT', source: 'USER_EXPLICIT', status: 'DONE' },
    { step_index: 1, type: 'PLANNER_RESPONSE', source: 'MODEL', status: 'DONE' }
  ]);

  const snapped = taskResume.snapshotInterruptedConversations({ homeDir: dir, env: {}, maxResults: 5 });
  assert.deepEqual(
    snapped.map((s) => s.conversationId).sort(),
    ['conv-already-running', 'conv-mid-run', 'conv-quota-hit'],
    'must capture quota-stopped and mid-run top-level conversations while excluding finished and subagent threads'
  );

  // Start stub ConversationService HTTP server representing respawned language_server
  const server = http.createServer((req, res) => {
    assert.equal(req.headers['x-antigravity-csrf-token'], 'resume-csrf-123');
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      if (req.url === '/product.v1.ConversationService/ListConversations') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ conversations: [] }));
        return;
      }
      if (req.url === '/product.v1.ConversationService/GetConversation') {
        const state = body.conversationId === 'conv-already-running' ? 'RUN_STATE_RUNNING' : 'RUN_STATE_IDLE';
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id: body.conversationId, state: { runState: state } }));
        return;
      }
      res.writeHead(404);
      res.end('{}');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;

  fs.writeFileSync(path.join(daemonDir, `hub_${port}.json`), JSON.stringify({
    pid: 9901,
    httpPort: port,
    httpsPort: port + 1,
    lsVersion: '2.35.0',
    csrfToken: 'resume-csrf-123'
  }));

  const sentAgentApiCalls = [];
  let keyringPayload = null;

  const service = createAntigravityManagerService({
    baseDir: path.join(dir, 'mgr'),
    switcherDeps: {
      oauth: { ensureFreshToken: async (tok) => tok },
      deviceProfile: {
        getStoragePath: () => '',
        readDeviceProfile: () => null,
        generateDeviceProfile: () => ({ machineId: 'm', macMachineId: 'mm', devDeviceId: 'd', sqmId: '{S}' })
      },
      keyring: {
        writeToSystemKeyring: (p) => { keyringPayload = p; },
        readFromSystemKeyring: () => keyringPayload
      },
      fileCredentials: { writeFileCredentials: () => {} }
    },
    taskResumeDeps: {
      homeDir: dir,
      env: {},
      maxResults: 5,
      listProcessesAsync: async () => [{
        pid: 9901,
        name: 'language_server',
        exePath: fakeLsExe,
        argv0: fakeLsExe,
        args: `${fakeLsExe} --app_data_dir antigravity`
      }],
      execFile: (bin, args, opts, cb) => {
        sentAgentApiCalls.push({
          bin,
          args,
          lsAddress: opts.env.ANTIGRAVITY_LS_ADDRESS,
          csrf: opts.env.ANTIGRAVITY_CSRF_TOKEN
        });
        cb(null, '{}', '');
      }
    },
    fetch: async (url) => {
      if (String(url).includes('loadCodeAssist')) {
        return new Response(JSON.stringify({ currentTier: { id: 'ultra-tier' } }), { status: 200 });
      }
      if (String(url).includes('retrieveUserQuotaSummary')) {
        return new Response(JSON.stringify({
          groups: [{ displayName: 'Gemini', buckets: [{ window: '5h', remainingFraction: 0.95 }] }]
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ models: {} }), { status: 200 });
    }
  });
  t.after(() => service.stop());

  const seedDir = path.join(dir, 'seed');
  fs.mkdirSync(path.join(seedDir, 'accounts'), { recursive: true });
  const exp = Math.floor(Date.now() / 1000) + 7200;
  fs.writeFileSync(path.join(seedDir, 'accounts', 'a.json'), JSON.stringify({
    email: 'old@example.com',
    token: { access_token: 'ya29.old', refresh_token: '1//old', expiry_timestamp: exp }
  }));
  fs.writeFileSync(path.join(seedDir, 'accounts', 'b.json'), JSON.stringify({
    email: 'next@example.com',
    token: { access_token: 'ya29.next', refresh_token: '1//next', expiry_timestamp: exp }
  }));
  service.importDataDir(seedDir);
  service.updateConfig({
    autoSwitchEnabled: true,
    autoResumeEnabled: true,
    autoResumePrompt: '继续完成剩余步骤',
    refreshSlideDelaySecs: 0
  });

  const outcome = await service.onLocalLimitsUpdated({
    providers: [{
      provider: 'antigravity',
      source: 'rpc',
      sourceDetail: 'cli',
      status: 'ok',
      accountEmail: 'old@example.com',
      windows: [{ kind: 'session', label: 'Gemini 5-hour', usedPercent: 100, windowMinutes: 300, showMeter: true }]
    }]
  });

  assert.equal(outcome.ok, true);
  assert.equal(outcome.lastAutoSwitch.resumedCount, 2);
  assert.deepEqual(
    sentAgentApiCalls.map((c) => c.args[2]).sort(),
    ['conv-mid-run', 'conv-quota-hit'],
    'resumed idle interrupted conversations and skipped conv-already-running'
  );
  for (const call of sentAgentApiCalls) {
    assert.equal(call.bin, fakeLsExe);
    assert.deepEqual(call.args.slice(0, 2), ['agentapi', 'send-message']);
    assert.equal(call.args[3], '继续完成剩余步骤');
    assert.equal(call.lsAddress, `127.0.0.1:${port}`);
    assert.equal(call.csrf, 'resume-csrf-123');
  }

  // Disabling autoResumeEnabled skips sending resume messages on manual/auto switches
  sentAgentApiCalls.length = 0;
  service.updateConfig({ autoResumeEnabled: false });
  const manualRes = await service.switchBestAccount('agy');
  assert.equal(manualRes.ok, true);
  assert.equal(sentAgentApiCalls.length, 0);
});

test('summarizePoolAccountQuota and isPoolAccountExhausted ignore disabled buckets with null remainingFraction', () => {
  const account = {
    id: 'acc-disabled-bucket',
    email: 'disabled-bucket@example.com',
    hasToken: true,
    quota: {
      groups: [
        {
          displayName: 'Gemini Models',
          description: 'Models within this group: Gemini 4 Neon, Gemini 4 Carbon, Gemini 4 Argon, Gemini 4 Hydrogen',
          buckets: [
            { bucketId: 'gemini-5h', window: '5h', disabled: true, remainingFraction: null },
            { bucketId: 'gemini-weekly', window: 'weekly', disabled: false, remainingFraction: 0.85 }
          ]
        },
        {
          displayName: 'Claude and GPT models',
          buckets: [
            { bucketId: '3p-5h', window: '5h', disabled: false, remainingFraction: 0.9 },
            { bucketId: '3p-weekly', window: 'weekly', disabled: false, remainingFraction: 0.8 }
          ]
        }
      ],
      models: []
    }
  };

  const summary = autoSwitch.summarizePoolAccountQuota(account);
  assert.equal(summary.hasQuotaData, true);
  assert.equal(summary.entries[0].family, 'gemini');
  assert.equal(summary.entries[0].minPercent, 85);
  assert.equal(autoSwitch.isPoolAccountExhausted(account, { scope: 'primary', thresholdPercent: 0 }), false);
});

test('selectReplacementAccount rejects models-only candidates whose triggered family is exhausted, enforces maxQuotaAgeMs, and honors elapsed resetTime', () => {
  const nowMs = Date.parse('2026-11-27T12:00:00Z');
  const staleMs = nowMs - 30 * 60_000;
  const freshMs = nowMs - 2 * 60_000;

  // Models-only pool where every candidate has Claude=0% and Gemini=100% must NOT ping-pong under primary scope
  const modelsOnlyPool = [
    {
      id: 'm1',
      email: 'claude-zero@example.com',
      hasToken: true,
      quota: {
        lastUpdatedAt: freshMs,
        groups: [],
        models: [
          { name: 'gemini-3.1-pro-high', percentage: 100 },
          { name: 'claude-sonnet-4.5', percentage: 0 }
        ]
      }
    }
  ];
  assert.equal(
    autoSwitch.selectReplacementAccount(modelsOnlyPool, {
      scope: 'primary',
      thresholdPercent: 0,
      preferredFamilies: ['claude'],
      requireVerifiedQuota: true,
      maxQuotaAgeMs: 15 * 60_000,
      nowMs
    }),
    null,
    'must not switch into another Claude-depleted account under primary scope'
  );

  // Under `all` scope, when both Gemini and Claude are exhausted locally, a candidate with Gemini=100% is still eligible
  assert.equal(
    autoSwitch.selectReplacementAccount(modelsOnlyPool, {
      scope: 'all',
      thresholdPercent: 0,
      preferredFamilies: ['gemini', 'claude'],
      requireVerifiedQuota: true,
      maxQuotaAgeMs: 15 * 60_000,
      nowMs
    })?.id,
    'm1'
  );

  // Stale quota older than maxQuotaAgeMs is rejected when requireVerifiedQuota is true
  const stalePool = [
    {
      id: 'stale-1',
      email: 'stale@example.com',
      hasToken: true,
      quota: {
        lastUpdatedAt: staleMs,
        groups: [{ displayName: 'Gemini', buckets: [{ window: '5h', remainingFraction: 1 }] }]
      }
    }
  ];
  assert.equal(
    autoSwitch.selectReplacementAccount(stalePool, {
      scope: 'primary',
      requireVerifiedQuota: true,
      maxQuotaAgeMs: 15 * 60_000,
      nowMs
    }),
    null
  );

  // Elapsed resetTime (updatedAt < resetTime <= nowMs) treats previously depleted 0% bucket as replenished
  const resetAccount = {
    id: 'reset-1',
    email: 'reset@example.com',
    hasToken: true,
    quota: {
      lastUpdatedAt: nowMs - 10 * 60_000,
      groups: [{
        displayName: 'Claude/GPT',
        buckets: [{ window: '5h', remainingFraction: 0, resetTime: new Date(nowMs - 60_000).toISOString() }]
      }]
    }
  };
  assert.equal(
    autoSwitch.selectReplacementAccount([resetAccount], {
      scope: 'primary',
      preferredFamilies: ['claude'],
      requireVerifiedQuota: true,
      maxQuotaAgeMs: 15 * 60_000,
      nowMs
    })?.id,
    'reset-1'
  );

  // Dynamic G4 codenames map to 'other', while generic "Gemini Models" stays 'gemini' even with codename bucket IDs
  assert.equal(autoSwitch.classifyQuotaGroupFamily('Gemini 4 Xenon weekly'), 'other');
  assert.equal(autoSwitch.classifyQuotaGroupFamily('gemini-4-xenon-high'), 'other');
  assert.equal(autoSwitch.classifyQuotaGroupFamily('Gemini Models', 'gemini-4-neon-5h gemini-4-carbon-5h'), 'gemini');

  // Target-scoped RPC trigger filtering ignores non-matching sourceDetail rows
  const mixedLocalRows = {
    providers: [
      {
        provider: 'antigravity',
        source: 'rpc',
        sourceDetail: 'app',
        status: 'ok',
        accountEmail: 'desktop@example.com',
        windows: [{ kind: 'session', label: 'Gemini 5-hour', usedPercent: 100, windowMinutes: 300, showMeter: true }]
      },
      {
        provider: 'antigravity',
        source: 'rpc',
        sourceDetail: 'cli',
        status: 'ok',
        accountEmail: 'cli@example.com',
        windows: [{ kind: 'session', label: 'Gemini 5-hour', usedPercent: 20, windowMinutes: 300, showMeter: true }]
      }
    ]
  };
  assert.equal(
    autoSwitch.evaluateLocalQuotaTrigger(mixedLocalRows, { defaultSwitchTarget: 'agy', autoSwitchScope: 'primary' }).triggered,
    false,
    'explicit agy target must not trigger on desktop app exhaustion when cli is healthy'
  );
  assert.equal(autoSwitch.resolveSwitchTargetForTrigger('auto', 'app', { classicRunning: false, ideRunning: false, acpRunning: true }), 'acp');
});

test('hardExhausted defers while session is busy (with timeout fallback), manual switch clears pending limits, failed pool refresh rejects stale cache, and history persists', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agm-hardening-svc-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  let clockMs = 1_770_000_000_000;
  let sessionBusy = true;
  let networkDown = true;
  let syncedCliCount = 0;
  let keyringStored = null;

  const makeService = () => createAntigravityManagerService({
    baseDir: path.join(dir, 'mgr'),
    nowMs: () => clockMs,
    isLocalAntigravityBusy: () => sessionBusy,
    autoSwitchMonitorOptions: {
      maxBusyDeferralMs: 5000,
      maxQuotaAgeMs: 60_000,
      hotSwitchVerifyDelayMs: 20,
      hotSwitchVerifyAttempts: 3
    },
    switcherDeps: {
      oauth: { ensureFreshToken: async (tok) => tok },
      deviceProfile: {
        getStoragePath: () => '',
        readDeviceProfile: () => null,
        generateDeviceProfile: () => ({ machineId: 'm', macMachineId: 'mm', devDeviceId: 'd', sqmId: '{S}' })
      },
      keyring: {
        writeToSystemKeyring: (p) => { keyringStored = p; },
        readFromSystemKeyring: () => keyringStored
      },
      fileCredentials: {
        writeFileCredentials: (_tok, opts) => {
          if (opts?.syncAgyCli) syncedCliCount += 1;
        }
      },
      processManager: {
        listProcessesAsync: async () => [{
          pid: 8800,
          name: 'Antigravity',
          exePath: '/opt/Antigravity/antigravity',
          argv0: '/opt/Antigravity/antigravity',
          args: '/opt/Antigravity/antigravity'
        }],
        isAntigravityRunning: (target) => target !== 'ide',
        isProcessRunningByName: () => false,
        getAntigravityExecutablePathAsync: async () => '/opt/Antigravity/antigravity',
        detectAntigravityVersionAsync: async () => '2.35.0',
        compareSemver: (a, b) => (a >= b ? 1 : -1),
        getArgsFromRunningProcess: () => [],
        getUserDataDirFromProcess: () => null,
        getLanguageServerPids: () => [8801],
        killLanguageServerAsync: async () => 1,
        waitForLanguageServerRespawn: async () => true
      }
    },
    fetch: async (url) => {
      if (networkDown) {
        throw new Error('network unreachable');
      }
      if (String(url).includes('loadCodeAssist')) {
        return new Response(JSON.stringify({ currentTier: { id: 'ultra-tier' } }), { status: 200 });
      }
      if (String(url).includes('retrieveUserQuotaSummary')) {
        return new Response(JSON.stringify({
          groups: [
            { displayName: 'Gemini', buckets: [{ window: '5h', remainingFraction: 0.95 }] },
            { displayName: 'Claude/GPT', buckets: [{ window: '5h', remainingFraction: 0.95 }] }
          ]
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ models: {} }), { status: 200 });
    }
  });

  const service = makeService();
  t.after(() => service.stop());

  // Seed accounts with very old cached quota so failed refresh must NOT trust stale disk quota
  const seedDir = path.join(dir, 'seed');
  fs.mkdirSync(path.join(seedDir, 'accounts'), { recursive: true });
  const exp = Math.floor(clockMs / 1000) + 7200;
  for (const [idx, email] of ['a@example.com', 'b@example.com', 'c@example.com'].entries()) {
    fs.writeFileSync(path.join(seedDir, 'accounts', `a${idx}.json`), JSON.stringify({
      email,
      quota: {
        last_updated: Math.floor((clockMs - 3600_000) / 1000),
        groups: [{ displayName: 'Gemini', buckets: [{ window: '5h', remainingFraction: 1 }] }]
      },
      token: { access_token: `ya29.${idx}`, refresh_token: `1//rt-${idx}`, expiry_timestamp: exp }
    }));
  }
  service.importDataDir(seedDir);
  const byEmail = Object.fromEntries(service.getState().accounts.map((a) => [a.email, a.id]));
  service.setAccountWeight(byEmail['c@example.com'], 99);
  service.setAccountWeight(byEmail['b@example.com'], 50);

  service.updateConfig({
    autoSwitchEnabled: true,
    selectionMode: 'weighted',
    autoSwitchCooldownSeconds: 60,
    refreshSlideDelaySecs: 0
  });

  const hardPayload = {
    providers: [{
      provider: 'antigravity',
      source: 'rpc',
      sourceDetail: 'cli',
      status: 'ok',
      accountEmail: 'a@example.com',
      windows: [{ kind: 'session', label: 'Claude/GPT 5-hour', usedPercent: 100, windowMinutes: 300, showMeter: true }]
    }]
  };

  // 1. P1-1: Even hardExhausted (0% remaining) defers while local session is actively busy
  const busyRes = await service.onLocalLimitsUpdated(hardPayload);
  assert.equal(busyRes.triggered, true);
  assert.equal(busyRes.skipped, 'session_busy');

  // 2. P2-1: User manually switches to b@example.com while pendingAutoSwitchLimits was queued;
  // subsequent busy->false transition must NOT replay a@example.com's stale trigger and overwrite b@ with c@!
  const manualRes = await service.switchAccountTo(byEmail['b@example.com'], 'classic');
  assert.equal(manualRes.ok, true);
  assert.equal(service.getState().activeAccounts.classic, byEmail['b@example.com']);
  sessionBusy = false;
  const afterManualIdle = await service.onLocalActivityChanged({ busy: false });
  assert.equal(afterManualIdle, null);
  assert.equal(service.getState().activeAccounts.classic, byEmail['b@example.com']);

  // 3. P1-4: When pool refresh fails completely (networkDown=true), lastRefreshAt stays 0 and stale 1h-old quota is rejected
  const staleRes = await service.onLocalLimitsUpdated(hardPayload);
  assert.equal(staleRes.ok, false);
  assert.equal(service.getState().lastRefreshAt, 0, 'failed batch refresh must not advance lastRefreshAt');

  // 4. Network recovers + busy deferral timeout fallback + CLI-triggered desktop switch syncs AGY CLI token too
  networkDown = false;
  clockMs += 400_000;
  sessionBusy = true;
  assert.equal((await service.onLocalLimitsUpdated(hardPayload)).skipped, 'session_busy');
  clockMs += 6000; // exceeds maxBusyDeferralMs (5000ms)
  const timeoutSwitch = await service.onLocalLimitsUpdated(hardPayload);
  assert.equal(timeoutSwitch.ok, true);
  assert.equal(timeoutSwitch.account.email, 'c@example.com');
  assert.ok(syncedCliCount >= 1, 'CLI-triggered switch on running desktop also synced ~/.gemini/antigravity-cli');
  assert.equal(service.getState().activeAccounts.agy, byEmail['c@example.com']);

  // 5. P3-2: Auto-switch record and history persist across service restarts
  service.stop();
  const restartedService = makeService();
  t.after(() => restartedService.stop());
  assert.equal(restartedService.getState().lastAutoSwitch?.toEmail, 'c@example.com');
  assert.equal(restartedService.getState().autoSwitchHistory.length, 2);
});

test('hot-switch verification retries empty RPC email before succeeding/restarting, and taskResume ignores canceled/question-waiting/idle-manual threads', async (t) => {
  const sqlite = require('node:sqlite');
  const taskResume = require('../src/electron/antigravityManager/taskResume');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agm-verify-resume-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const classicRoot = path.join(dir, '.gemini', 'antigravity');
  const ideRoot = path.join(dir, '.gemini', 'antigravity-ide');
  fs.mkdirSync(classicRoot, { recursive: true });
  fs.mkdirSync(ideRoot, { recursive: true });

  const initDb = (rootDir, rows) => {
    const db = new sqlite.DatabaseSync(path.join(rootDir, 'conversation_summaries.db'));
    db.exec(`
      CREATE TABLE conversation_summaries (
        conversation_id TEXT PRIMARY KEY,
        title TEXT,
        preview TEXT,
        status TEXT,
        not_fully_idle INTEGER,
        killed INTEGER,
        parent_conversation_id TEXT,
        nesting_depth INTEGER,
        last_modified_time TEXT,
        last_user_input_time TEXT
      );
    `);
    const ins = db.prepare(`
      INSERT INTO conversation_summaries
        (conversation_id, title, preview, status, not_fully_idle, killed, parent_conversation_id, nesting_depth, last_modified_time, last_user_input_time)
      VALUES (?, ?, ?, ?, ?, ?, '', 0, ?, ?)
    `);
    for (const r of rows) ins.run(...r);
    db.close();
  };

  const nowIso = new Date().toISOString().replace('T', ' ').replace('Z', '+00:00');
  initDb(classicRoot, [
    ['conv-canceling-db', 'Canceling in DB', '', 'CASCADE_RUN_STATUS_CANCELING', 1, 0, nowIso, nowIso],
    ['conv-user-canceled', 'Stopped by user', '', 'CASCADE_RUN_STATUS_IDLE', 0, 0, nowIso, nowIso],
    ['conv-ask-question', 'Waiting on user', '', 'CASCADE_RUN_STATUS_IDLE', 0, 0, nowIso, nowIso],
    ['conv-done-with-checkpoint', 'Clean with trailing checkpoint', '', 'CASCADE_RUN_STATUS_IDLE', 0, 0, nowIso, nowIso],
    ['conv-real-quota-stop', 'Real quota stop', '', 'CASCADE_RUN_STATUS_IDLE', 0, 0, nowIso, nowIso]
  ]);
  initDb(ideRoot, [
    ['conv-ide-only', 'IDE running thread', '', 'CASCADE_RUN_STATUS_RUNNING', 1, 0, nowIso, nowIso]
  ]);

  const writeTranscript = (rootDir, cid, rows) => {
    const logDir = path.join(rootDir, 'brain', cid, '.system_generated', 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(path.join(logDir, 'transcript.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  };
  writeTranscript(classicRoot, 'conv-user-canceled', [
    { step_index: 0, type: 'USER_INPUT', status: 'DONE' },
    { step_index: 1, type: 'TOOL_CALL', status: 'CANCELED' }
  ]);
  writeTranscript(classicRoot, 'conv-ask-question', [
    { step_index: 0, type: 'USER_INPUT', status: 'DONE' },
    { step_index: 1, type: 'PLANNER_RESPONSE', status: 'DONE', tool_calls: [{ name: 'ask_question', arguments: {} }] }
  ]);
  writeTranscript(classicRoot, 'conv-done-with-checkpoint', [
    { step_index: 0, type: 'USER_INPUT', status: 'DONE' },
    { step_index: 1, type: 'PLANNER_RESPONSE', status: 'DONE' },
    { step_index: 2, type: 'CHECKPOINT', status: 'DONE' }
  ]);
  writeTranscript(classicRoot, 'conv-real-quota-stop', [
    { step_index: 0, type: 'USER_INPUT', status: 'DONE' },
    { step_index: 1, type: 'PLANNER_RESPONSE', status: 'DONE', tool_calls: [{ name: 'run_command' }] },
    { step_index: 2, type: 'SYSTEM_MESSAGE', status: 'DONE' }
  ]);

  // Classic target excludes IDE conversations, canceled turns, ask_question waits, and finished turns with trailing checkpoints
  const classicAutoSnap = taskResume.snapshotInterruptedConversations({
    homeDir: dir,
    env: {},
    targetClient: 'classic'
  });
  assert.deepEqual(classicAutoSnap.map((s) => s.conversationId), ['conv-real-quota-stop']);

  // Manual switch (`onlyActivelyRunning: true`) never resurrects historical IDLE conversations
  const classicManualSnap = taskResume.snapshotInterruptedConversations({
    homeDir: dir,
    env: {},
    targetClient: 'classic',
    onlyActivelyRunning: true
  });
  assert.deepEqual(classicManualSnap, []);

  // IDE target isolates to `.gemini/antigravity-ide`
  const ideSnap = taskResume.snapshotInterruptedConversations({
    homeDir: dir,
    env: {},
    targetClient: 'ide'
  });
  assert.deepEqual(ideSnap.map((s) => s.conversationId), ['conv-ide-only']);

  // Hot-switch verification retries when first post-respawn probe returns empty email, then catches stale email on 2nd attempt
  let verifyProbeCalls = 0;
  let restarted = 0;
  const svc = createAntigravityManagerService({
    baseDir: path.join(dir, 'mgr'),
    autoSwitchMonitorOptions: {
      hotSwitchVerifyDelayMs: 20,
      hotSwitchVerifyAttempts: 3
    },
    probeLocalLimits: async () => {
      verifyProbeCalls += 1;
      const email = verifyProbeCalls === 1 ? '' : (restarted > 0 ? 'target@example.com' : 'stale@example.com');
      return {
        providers: [{
          provider: 'antigravity',
          source: 'rpc',
          status: 'ok',
          accountEmail: email,
          windows: [{ kind: 'session', label: 'Gemini 5-hour', usedPercent: 10, windowMinutes: 300, showMeter: true }]
        }]
      };
    },
    switcherDeps: {
      oauth: { ensureFreshToken: async (tok) => tok },
      stateDb: { getDbPath: () => path.join(dir, 'state.vscdb'), injectTokenToDbAsync: async () => {} },
      deviceProfile: {
        getStoragePath: () => path.join(dir, 'storage.json'),
        readDeviceProfileAsync: async () => null,
        writeDeviceProfileAsync: async () => {},
        generateDeviceProfile: () => ({ machineId: 'm', macMachineId: 'mm', devDeviceId: 'd', sqmId: '{S}' })
      },
      keyring: { writeToSystemKeyringAsync: async () => {} },
      fileCredentials: { writeFileCredentialsAsync: async () => {} },
      fs: { existsSync: () => true },
      processManager: {
        listProcessesAsync: async () => [{
          pid: 5000,
          name: 'Antigravity',
          exePath: '/opt/Antigravity/antigravity',
          argv0: '/opt/Antigravity/antigravity',
          args: '/opt/Antigravity/antigravity'
        }],
        isAntigravityRunning: (target) => target !== 'ide',
        getAntigravityExecutablePathAsync: async () => '/opt/Antigravity/antigravity',
        detectAntigravityVersionAsync: async () => '2.35.0',
        compareSemver: () => 1,
        getArgsFromRunningProcess: () => [],
        getUserDataDirFromProcess: () => null,
        getLanguageServerPids: () => [5001],
        killLanguageServerAsync: async () => 1,
        waitForLanguageServerRespawn: async () => true,
        closeAntigravity: async () => {},
        startAntigravity: () => { restarted += 1; }
      }
    }
  });
  t.after(() => svc.stop());

  const seedDir = path.join(dir, 'seed');
  fs.mkdirSync(path.join(seedDir, 'accounts'), { recursive: true });
  fs.writeFileSync(path.join(seedDir, 'accounts', 't.json'), JSON.stringify({
    email: 'target@example.com',
    token: { access_token: 'ya29.t', refresh_token: '1//t', expiry_timestamp: Math.floor(Date.now() / 1000) + 7200 }
  }));
  svc.importDataDir(seedDir);
  const targetId = svc.getState().accounts[0].id;
  const sw = await svc.switchAccountTo(targetId, 'classic');
  assert.equal(sw.ok, true);
  assert.equal(sw.mode, 'restart');
  assert.equal(verifyProbeCalls, 2, 'retried after initial empty RPC email and caught stale hot-switch on attempt 2');
  assert.equal(restarted, 1);
});

test('Windows 0% quota bypasses background-only busy state, unverified Win32 hot-switch restarts, and manual switch resumes recent quota-stopped turns via agentapi.bat', async (t) => {
  const http = require('node:http');
  const sqlite = require('node:sqlite');
  const taskResume = require('../src/electron/antigravityManager/taskResume');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agm-win-deadlock-resume-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  // 1. Unix-second SQLite timestamps normalize to milliseconds
  assert.equal(taskResume.parseSqliteTimestampMs(1_770_000_000), 1_770_000_000_000);
  assert.equal(taskResume.parseSqliteTimestampMs('1770000000'), 1_770_000_000_000);
  assert.equal(taskResume.parseSqliteTimestampMs('1770000000.25'), 1_770_000_000_250);

  // 2. Setup classic conversation_summaries.db where turn crashed with quota error (`IDLE`),
  // while a background shell command keeps `not_fully_idle = 1`
  const agRoot = path.join(dir, '.gemini', 'antigravity');
  const binDir = path.join(agRoot, 'bin');
  const daemonDir = path.join(agRoot, 'daemon');
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(daemonDir, { recursive: true });

  const fakeLsExe = path.join(dir, 'Programs', 'antigravity', 'resources', 'bin', 'language_server.exe');
  fs.mkdirSync(path.dirname(fakeLsExe), { recursive: true });
  fs.writeFileSync(fakeLsExe, '');
  fs.writeFileSync(
    path.join(binDir, 'agentapi.bat'),
    `@echo off\r\n"${fakeLsExe}" agentapi %*\r\n`,
    'utf8'
  );

  // Verify resolveAgentApiCommand parses Windows agentapi.bat when no language_server is in procs yet
  const resolvedCmd = taskResume.resolveAgentApiCommand({
    platform: 'win32',
    homeDir: dir,
    env: {},
    procs: []
  });
  assert.deepEqual(resolvedCmd, { bin: fakeLsExe, prefixArgs: ['agentapi'] });

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString().replace('T', ' ').replace('Z', '+00:00');
  const dbPath = path.join(agRoot, 'conversation_summaries.db');
  const db = new sqlite.DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE conversation_summaries (
      conversation_id TEXT PRIMARY KEY,
      title TEXT,
      preview TEXT,
      status TEXT,
      not_fully_idle INTEGER,
      killed INTEGER,
      parent_conversation_id TEXT,
      nesting_depth INTEGER,
      last_modified_time TEXT,
      last_user_input_time TEXT
    );
  `);
  const ins = db.prepare(`
    INSERT INTO conversation_summaries
      (conversation_id, title, preview, status, not_fully_idle, killed, parent_conversation_id, nesting_depth, last_modified_time, last_user_input_time)
    VALUES (?, ?, ?, ?, ?, 0, '', 0, ?, ?)
  `);
  ins.run('conv-bg-task-stalled', 'Background test task', '', 'CASCADE_RUN_STATUS_IDLE', 1, nowIso, nowIso);
  ins.run('conv-manual-quota-err', 'Hit 429 quota', '', 'CASCADE_RUN_STATUS_IDLE', 0, nowIso, nowIso);
  ins.run('conv-old-idle', 'Finished cleanly', '', 'CASCADE_RUN_STATUS_IDLE', 0, nowIso, nowIso);
  ins.run('conv-discussed-429-done', 'Discussed 429 in prose', '', 'CASCADE_RUN_STATUS_IDLE', 0, nowIso, nowIso);
  db.close();

  const writeTranscript = (cid, rows) => {
    const logDir = path.join(agRoot, 'brain', cid, '.system_generated', 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(path.join(logDir, 'transcript.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  };
  writeTranscript('conv-manual-quota-err', [
    { step_index: 0, type: 'USER_INPUT', status: 'DONE' },
    { step_index: 1, type: 'ERROR', status: 'ERROR', error_message: 'Individual quota reached. Please upgrade your subscription.' }
  ]);
  writeTranscript('conv-old-idle', [
    { step_index: 0, type: 'USER_INPUT', status: 'DONE' },
    { step_index: 1, type: 'PLANNER_RESPONSE', status: 'DONE' }
  ]);
  writeTranscript('conv-discussed-429-done', [
    { step_index: 0, type: 'USER_INPUT', status: 'DONE', content: 'Why does HTTP 429 rate limit or Individual quota reached happen?' },
    { step_index: 1, type: 'PLANNER_RESPONSE', status: 'DONE', content: 'HTTP 429 too many requests means rate limited; fixed cleanly.' }
  ]);

  assert.equal(
    taskResume.hasActivelyGeneratingTurn({ homeDir: dir, env: {}, nowMs }),
    false,
    'IDLE conversation with not_fully_idle=1 background command is NOT actively generating LLM tokens'
  );

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      if (req.url === '/product.v1.ConversationService/ListConversations') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ conversations: [] }));
        return;
      }
      if (req.url === '/product.v1.ConversationService/GetConversation') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id: body.conversationId, state: { runState: 'RUN_STATE_IDLE' } }));
        return;
      }
      res.writeHead(404);
      res.end('{}');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
  fs.writeFileSync(path.join(daemonDir, `hub_${port}.json`), JSON.stringify({
    pid: 7788,
    httpPort: port,
    csrfToken: 'win-resume-csrf'
  }));

  let restarted = 0;
  const resumedCalls = [];
  const svc = createAntigravityManagerService({
    baseDir: path.join(dir, 'mgr'),
    isLocalAntigravityBusy: () => true, // Collector still sees not_fully_idle=1 / 30s lease
    isLocalAntigravityActivelyGenerating: () => taskResume.hasActivelyGeneratingTurn({ homeDir: dir, env: {}, nowMs }),
    autoSwitchMonitorOptions: {
      hotSwitchVerifyDelayMs: 15,
      hotSwitchVerifyAttempts: 2,
      maxBusyDeferralMs: 180_000
    },
    probeLocalLimits: async () => ({
      providers: [{
        provider: 'antigravity',
        source: 'rpc',
        sourceDetail: 'app',
        status: 'ok',
        accountEmail: '', // Unverified empty email on Windows after hot-switch must force full restart
        windows: [{ kind: 'session', label: 'Gemini 5-hour', usedPercent: 100, windowMinutes: 300, showMeter: true }]
      }]
    }),
    switcherDeps: {
      platform: 'win32',
      oauth: { ensureFreshToken: async (tok) => tok },
      stateDb: { getDbPath: () => path.join(dir, 'state.vscdb'), injectTokenToDbAsync: async () => {} },
      deviceProfile: {
        getStoragePath: () => path.join(dir, 'storage.json'),
        readDeviceProfileAsync: async () => null,
        writeDeviceProfileAsync: async () => {},
        generateDeviceProfile: () => ({ machineId: 'm', macMachineId: 'mm', devDeviceId: 'd', sqmId: '{S}' })
      },
      keyring: {
        readFromSystemKeyringAsync: async () => ({ refreshToken: '1//old', email: 'old@example.com' }),
        writeToSystemKeyringAsync: async () => {}
      },
      fileCredentials: {
        readLocalCredentialFilesAsync: async () => [],
        writeFileCredentialsAsync: async () => {}
      },
      fs: { existsSync: () => true },
      processManager: {
        listProcessesAsync: async () => [{
          pid: 7700,
          name: 'Antigravity.exe',
          exePath: 'C:\\Apps\\Antigravity\\Antigravity.exe',
          argv0: 'Antigravity.exe',
          args: '"C:\\Apps\\Antigravity\\Antigravity.exe"'
        }],
        isAntigravityRunning: (target) => target !== 'ide',
        getAntigravityExecutablePathAsync: async () => 'C:\\Apps\\Antigravity\\Antigravity.exe',
        detectAntigravityVersionAsync: async () => '2.36.0',
        compareSemver: () => 1,
        getArgsFromRunningProcess: () => [],
        getUserDataDirFromProcess: () => null,
        getLanguageServerPids: () => [7788],
        killLanguageServerAsync: async () => 1,
        waitForLanguageServerRespawn: async () => true,
        closeAntigravity: async () => {},
        startAntigravity: () => { restarted += 1; }
      }
    },
    taskResumeDeps: {
      platform: 'win32',
      homeDir: dir,
      env: {},
      listProcessesAsync: async () => [{
        pid: 7788,
        name: 'language_server.exe',
        exePath: '',
        argv0: 'language_server.exe',
        args: 'language_server.exe --app_data_dir antigravity'
      }],
      execFile: (bin, args, _opts, cb) => {
        resumedCalls.push({ bin, args });
        cb(null, '{}', '');
      }
    },
    fetch: async (url) => {
      if (String(url).includes('loadCodeAssist')) {
        return new Response(JSON.stringify({ currentTier: { id: 'pro-tier' } }), { status: 200 });
      }
      if (String(url).includes('retrieveUserQuotaSummary')) {
        return new Response(JSON.stringify({
          groups: [{ displayName: 'Gemini', buckets: [{ window: '5h', remainingFraction: 1 }] }]
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ models: {} }), { status: 200 });
    }
  });
  t.after(() => svc.stop());

  const seedDir = path.join(dir, 'seed');
  fs.mkdirSync(path.join(seedDir, 'accounts'), { recursive: true });
  const exp = Math.floor(nowMs / 1000) + 7200;
  fs.writeFileSync(path.join(seedDir, 'accounts', 'old.json'), JSON.stringify({
    email: 'old@example.com',
    token: { access_token: 'ya29.old', refresh_token: '1//old', expiry_timestamp: exp }
  }));
  fs.writeFileSync(path.join(seedDir, 'accounts', 'next.json'), JSON.stringify({
    email: 'next@example.com',
    token: { access_token: 'ya29.next', refresh_token: '1//next', expiry_timestamp: exp }
  }));
  fs.writeFileSync(path.join(seedDir, 'accounts', 'third.json'), JSON.stringify({
    email: 'third@example.com',
    token: { access_token: 'ya29.third', refresh_token: '1//third', expiry_timestamp: exp }
  }));
  svc.importDataDir(seedDir);
  const byEmail = Object.fromEntries(svc.getState().accounts.map((a) => [a.email, a.id]));
  svc.updateConfig({
    autoSwitchEnabled: true,
    autoResumeEnabled: true,
    autoResumePrompt: '继续',
    refreshSlideDelaySecs: 0
  });

  // Immediate auto-switch at 0% despite isLocalAntigravityBusy()===true + Win32 unverified email fallback to restart!
  const autoRes = await svc.onLocalLimitsUpdated({
    providers: [{
      provider: 'antigravity',
      source: 'rpc',
      sourceDetail: 'app',
      status: 'ok',
      accountEmail: 'old@example.com',
      windows: [{ kind: 'session', label: 'Gemini 5-hour', usedPercent: 100, windowMinutes: 300, showMeter: true }]
    }]
  });
  assert.equal(autoRes.ok, true);
  assert.equal(autoRes.mode, 'restart', 'unverified empty email on Windows fell back from hot-switch to full restart');
  assert.equal(restarted, 1);

  // Manual switch ALSO resumes conv-manual-quota-err (explicit 429 error) + conv-bg-task-stalled, while ignoring conv-old-idle!
  resumedCalls.length = 0;
  const manualSw = await svc.switchAccountTo(byEmail['third@example.com'], 'classic', { forceRestart: true });
  assert.equal(manualSw.ok, true);
  const resumedIds = resumedCalls.map((c) => c.args[2]).sort();
  assert.deepEqual(resumedIds, ['conv-bg-task-stalled', 'conv-manual-quota-err']);
  assert.equal(resumedCalls[0].bin, fakeLsExe);
});

test('evaluateLocalQuotaTrigger suppresses acknowledged exhausted windows and listLocalExhaustedWindowKeys extracts stable keys', () => {
  const claudeOnlyPayload = {
    providers: [{
      provider: 'antigravity',
      source: 'rpc',
      sourceDetail: 'cli',
      status: 'ok',
      accountEmail: 'x@example.com',
      windows: [
        { kind: 'session', label: 'Gemini 5-hour', usedPercent: 20, windowMinutes: 300, showMeter: true },
        { kind: 'session', label: 'Claude/GPT 5-hour', usedPercent: 100, windowMinutes: 300, showMeter: true }
      ]
    }]
  };

  assert.equal(
    autoSwitch.localWindowKey({ groupName: 'Claude/GPT', period: '5h' }),
    'claude/gpt|5h'
  );
  const listed = autoSwitch.listLocalExhaustedWindowKeys(claudeOnlyPayload, { autoSwitchScope: 'primary' });
  assert.equal(listed.length, 1);
  assert.equal(listed[0].email, 'x@example.com');
  assert.equal(listed[0].sourceDetail, 'cli');
  assert.deepEqual([...listed[0].keys], ['claude/gpt|5h']);

  const ack = { email: 'x@example.com', windowKeys: new Set(['claude/gpt|5h']) };
  const suppressed = autoSwitch.evaluateLocalQuotaTrigger(
    claudeOnlyPayload,
    { autoSwitchScope: 'primary' },
    { acknowledged: ack }
  );
  assert.equal(suppressed.triggered, false);
  assert.deepEqual(suppressed.acknowledgedWindows, []);

  // Different window (Gemini) exhausting on the same acknowledged account triggers and reports suppressed window label
  const bothExhaustedPayload = {
    providers: [{
      provider: 'antigravity',
      source: 'rpc',
      sourceDetail: 'cli',
      status: 'ok',
      accountEmail: 'x@example.com',
      windows: [
        { kind: 'session', label: 'Gemini 5-hour', usedPercent: 100, windowMinutes: 300, showMeter: true },
        { kind: 'session', label: 'Claude/GPT 5-hour', usedPercent: 100, windowMinutes: 300, showMeter: true }
      ]
    }]
  };
  const freshGemini = autoSwitch.evaluateLocalQuotaTrigger(
    bothExhaustedPayload,
    { autoSwitchScope: 'primary' },
    { acknowledged: ack }
  );
  assert.equal(freshGemini.triggered, true);
  assert.equal(freshGemini.hardExhausted, true);
  assert.deepEqual(freshGemini.acknowledgedWindows, ['Claude/GPT 5-hour']);
  assert.deepEqual(freshGemini.exhaustedFamilies.sort(), ['claude', 'gemini']);

  // hardExhausted is computed strictly from fresh (unacknowledged) windows
  const softGeminiPayload = {
    providers: [{
      provider: 'antigravity',
      source: 'rpc',
      sourceDetail: 'cli',
      status: 'ok',
      accountEmail: 'x@example.com',
      windows: [
        { kind: 'session', label: 'Gemini 5-hour', usedPercent: 92, windowMinutes: 300, showMeter: true },
        { kind: 'session', label: 'Claude/GPT 5-hour', usedPercent: 100, windowMinutes: 300, showMeter: true }
      ]
    }]
  };
  const softFresh = autoSwitch.evaluateLocalQuotaTrigger(
    softGeminiPayload,
    { autoSwitchScope: 'primary', autoSwitchThresholdPercent: 10 },
    { acknowledged: ack }
  );
  assert.equal(softFresh.triggered, true);
  assert.equal(softFresh.hardExhausted, false);
  assert.deepEqual(softFresh.acknowledgedWindows, ['Claude/GPT 5-hour']);

  // Different account email is never suppressed by x@'s acknowledgment
  const otherAccountPayload = {
    providers: [{
      ...claudeOnlyPayload.providers[0],
      accountEmail: 'y@example.com'
    }]
  };
  const otherRes = autoSwitch.evaluateLocalQuotaTrigger(
    otherAccountPayload,
    { autoSwitchScope: 'primary' },
    { acknowledged: ack }
  );
  assert.equal(otherRes.triggered, true);
  assert.equal(otherRes.accountEmail, 'y@example.com');
  assert.deepEqual(otherRes.acknowledgedWindows, []);
});

test('manual switch back to an account with an exhausted Claude pool suppresses re-switch until Gemini exhausts or Claude recovers', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agm-manual-ack-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  let clockMs = 1_760_000_000_000;
  let keyringStored = null;
  let yDepleted = false;

  const quotasByToken = {
    'ya29.x': {
      tier: 'pro-tier',
      groups: [
        { displayName: 'Gemini', buckets: [{ window: '5h', remainingFraction: 0.8 }] },
        { displayName: 'Claude and GPT', buckets: [{ window: '5h', remainingFraction: 0, resetTime: '2026-11-27T04:00:00Z' }] }
      ]
    },
    'ya29.y': {
      tier: 'pro-tier',
      groups: [
        { displayName: 'Gemini', buckets: [{ window: '5h', remainingFraction: 0.95 }] },
        { displayName: 'Claude and GPT', buckets: [{ window: '5h', remainingFraction: 0.95 }, { window: 'weekly', remainingFraction: 0.9 }] }
      ]
    },
    'ya29.z': {
      tier: 'pro-tier',
      groups: [
        { displayName: 'Gemini', buckets: [{ window: '5h', remainingFraction: 0.9 }] },
        { displayName: 'Claude and GPT', buckets: [{ window: '5h', remainingFraction: 0.9 }, { window: 'weekly', remainingFraction: 0.85 }] }
      ]
    }
  };

  const service = createAntigravityManagerService({
    baseDir: path.join(dir, 'mgr'),
    nowMs: () => clockMs,
    isLocalAntigravityBusy: () => false,
    switcherDeps: {
      oauth: { ensureFreshToken: async (tok) => tok },
      deviceProfile: {
        getStoragePath: () => '',
        readDeviceProfile: () => null,
        generateDeviceProfile: () => ({
          machineId: 'auth0|user_mock',
          macMachineId: 'mac-mock',
          devDeviceId: 'dev-mock',
          sqmId: '{SQM-MOCK}'
        })
      },
      keyring: {
        writeToSystemKeyring: (payload) => { keyringStored = payload; },
        readFromSystemKeyring: () => keyringStored
      },
      fileCredentials: { writeFileCredentials: () => {} }
    },
    fetch: async (url, init) => {
      const auth = String(init?.headers?.authorization || '').replace(/^Bearer\s+/i, '');
      const mock = auth === 'ya29.y' && yDepleted
        ? {
            tier: 'pro-tier',
            groups: [
              { displayName: 'Gemini', buckets: [{ window: '5h', remainingFraction: 0 }] },
              { displayName: 'Claude and GPT', buckets: [{ window: '5h', remainingFraction: 0 }] }
            ]
          }
        : (quotasByToken[auth] || quotasByToken['ya29.z']);
      if (String(url).includes('loadCodeAssist')) {
        return new Response(JSON.stringify({ currentTier: { id: mock.tier } }), { status: 200 });
      }
      if (String(url).includes('fetchAvailableModels')) {
        return new Response(JSON.stringify({ models: {} }), { status: 200 });
      }
      if (String(url).includes('retrieveUserQuotaSummary')) {
        return new Response(JSON.stringify({ groups: mock.groups }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    }
  });
  t.after(() => service.stop());

  const seedDir = path.join(dir, 'seed');
  fs.mkdirSync(path.join(seedDir, 'accounts'), { recursive: true });
  const exp = Math.floor(clockMs / 1000) + 7200;
  for (const item of [
    { file: 'x.json', email: 'x@example.com', access: 'ya29.x', rt: '1//x' },
    { file: 'y.json', email: 'y@example.com', access: 'ya29.y', rt: '1//y' },
    { file: 'z.json', email: 'z@example.com', access: 'ya29.z', rt: '1//z' }
  ]) {
    fs.writeFileSync(path.join(seedDir, 'accounts', item.file), JSON.stringify({
      email: item.email,
      token: { access_token: item.access, refresh_token: item.rt, expiry_timestamp: exp }
    }));
  }
  service.importDataDir(seedDir);
  const byEmail = Object.fromEntries(service.getState().accounts.map((a) => [a.email, a.id]));
  service.updateConfig({
    autoSwitchEnabled: true,
    autoSwitchScope: 'primary',
    autoSwitchCooldownSeconds: 60,
    refreshSlideDelaySecs: 0
  });

  const xClaudeExhausted = {
    providers: [{
      provider: 'antigravity',
      source: 'rpc',
      sourceDetail: 'cli',
      status: 'ok',
      accountEmail: 'x@example.com',
      windows: [
        { kind: 'session', label: 'Gemini 5-hour', usedPercent: 20, windowMinutes: 300, showMeter: true },
        { kind: 'session', label: 'Claude/GPT 5-hour', usedPercent: 100, windowMinutes: 300, showMeter: true }
      ]
    }]
  };

  // 1. x@ Claude exhausts -> auto-switches to y@
  const firstAuto = await service.onLocalLimitsUpdated(xClaudeExhausted);
  assert.equal(firstAuto.triggered, true);
  assert.equal(firstAuto.ok, true);
  assert.equal(firstAuto.account.email, 'y@example.com');
  assert.equal(service.getState().activeAccounts.agy, byEmail['y@example.com']);

  // 2. Advance past cooldown and manually switch back to x@ to use its Gemini quota
  clockMs += 90_000;
  yDepleted = true;
  const manualBack = await service.switchAccountTo(byEmail['x@example.com'], 'agy');
  assert.equal(manualBack.ok, true);
  assert.equal(service.getState().activeAccounts.agy, byEmail['x@example.com']);

  // 3. Subsequent RPC polls still reporting Claude 100% / Gemini 20% must NOT re-switch off x@
  const pollAfterManual1 = await service.onLocalLimitsUpdated(xClaudeExhausted);
  assert.equal(pollAfterManual1.triggered, false);
  assert.equal(service.getState().activeAccounts.agy, byEmail['x@example.com']);

  clockMs += 30_000;
  const pollAfterManual2 = await service.onLocalLimitsUpdated(xClaudeExhausted);
  assert.equal(pollAfterManual2.triggered, false);
  assert.equal(service.getState().activeAccounts.agy, byEmail['x@example.com']);

  // 4. Once Gemini also hits 0%, auto-switch fires immediately to z@
  const xGeminiExhausted = {
    providers: [{
      provider: 'antigravity',
      source: 'rpc',
      sourceDetail: 'cli',
      status: 'ok',
      accountEmail: 'x@example.com',
      windows: [
        { kind: 'session', label: 'Gemini 5-hour', usedPercent: 100, windowMinutes: 300, showMeter: true },
        { kind: 'session', label: 'Claude/GPT 5-hour', usedPercent: 100, windowMinutes: 300, showMeter: true }
      ]
    }]
  };
  const secondAuto = await service.onLocalLimitsUpdated(xGeminiExhausted);
  assert.equal(secondAuto.triggered, true);
  assert.equal(secondAuto.ok, true);
  assert.equal(secondAuto.account.email, 'z@example.com');
  assert.equal(service.getState().activeAccounts.agy, byEmail['z@example.com']);

  // 5. Manually switch back to x@, let Claude recover, then exhaust Claude again -> pruned ack triggers auto-switch
  clockMs += 90_000;
  const manualBackAgain = await service.switchAccountTo(byEmail['x@example.com'], 'agy');
  assert.equal(manualBackAgain.ok, true);
  assert.equal((await service.onLocalLimitsUpdated(xClaudeExhausted)).triggered, false);

  const xClaudeRecovered = {
    providers: [{
      provider: 'antigravity',
      source: 'rpc',
      sourceDetail: 'cli',
      status: 'ok',
      accountEmail: 'x@example.com',
      windows: [
        { kind: 'session', label: 'Gemini 5-hour', usedPercent: 20, windowMinutes: 300, showMeter: true },
        { kind: 'session', label: 'Claude/GPT 5-hour', usedPercent: 30, windowMinutes: 300, showMeter: true }
      ]
    }]
  };
  assert.equal((await service.onLocalLimitsUpdated(xClaudeRecovered)).triggered, false);

  // Exhausting Claude again after observing recovery triggers a fresh switch
  const reExhausted = await service.onLocalLimitsUpdated(xClaudeExhausted);
  assert.equal(reExhausted.triggered, true);
  assert.equal(reExhausted.ok, true);
  assert.equal(reExhausted.account.email, 'z@example.com');
});
