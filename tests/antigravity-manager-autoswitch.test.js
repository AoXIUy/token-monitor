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
