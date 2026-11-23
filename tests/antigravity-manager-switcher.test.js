'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAntigravityManagerStore } = require('../src/electron/antigravityManager/store');
const processManager = require('../src/electron/antigravityManager/processManager');
const switcher = require('../src/electron/antigravityManager/switcher');

test('resolveEffectiveTarget and classifyProcess honor safety exclusions and Classic-first priority', () => {
  assert.equal(
    processManager.classifyProcess('token-monitor', '/opt/token-monitor/token-monitor', 'token-monitor', ''),
    'manager'
  );
  assert.equal(
    processManager.classifyProcess('Antigravity Tools', '/Applications/Antigravity-Manager.app/Contents/MacOS/antigravity-tools', 'antigravity-tools', ''),
    'manager'
  );
  assert.equal(
    processManager.classifyProcess('language_server_linux_x64', '/usr/bin/antigravity/language_server', 'language_server', '--antigravity'),
    'language_server'
  );
  assert.equal(
    processManager.classifyProcess('agy', '/usr/local/bin/agy', 'agy', 'chat'),
    'agy'
  );

  assert.deepEqual(
    switcher.resolveEffectiveTarget('auto', { classicRunning: false, ideRunning: true, hasClassicExe: true, ideExePath: '/opt/antigravity-ide' }),
    { isIde: true, effectiveTarget: 'ide' }
  );
  assert.deepEqual(
    switcher.resolveEffectiveTarget('auto', { classicRunning: true, ideRunning: true, hasClassicExe: true, ideExePath: '/opt/antigravity-ide' }),
    { isIde: false, effectiveTarget: null }
  );
  assert.deepEqual(
    switcher.resolveEffectiveTarget('classic', { classicRunning: false, ideRunning: true, hasClassicExe: false }),
    { isIde: false, effectiveTarget: 'classic' }
  );
});

test('pickBestAccount filters abnormal accounts and selects highest average remaining quota', () => {
  const accounts = [
    { id: '1', email: 'banned@example.com', banned: true, hasToken: true, subscriptionTier: 'ULTRA', quota: { models: [{ percentage: 100 }] } },
    { id: '2', email: 'verify@example.com', validationBlocked: true, hasToken: true, subscriptionTier: 'ULTRA', quota: { models: [{ percentage: 100 }] } },
    { id: '3', email: 'low@example.com', hasToken: true, subscriptionTier: 'PRO', quota: { models: [{ percentage: 25 }] } },
    { id: '4', email: 'best@example.com', hasToken: true, subscriptionTier: 'PRO', quota: { models: [{ percentage: 90 }, { percentage: 80 }] } },
    { id: '5', email: 'best-tied@example.com', hasToken: true, subscriptionTier: 'ULTRA', quota: { models: [{ percentage: 85 }] } }
  ];
  const best = switcher.pickBestAccount(accounts);
  assert.equal(best.id, '5');
});

test('switchAccount performs hot-switch, fallback restart, AGY CLI, and ACP target writes with mocked deps', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agm-switch-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const store = createAntigravityManagerStore({ baseDir: path.join(dir, 'store') });
  const saved = store.upsertAccount(
    {
      email: 'alice@example.com',
      subscriptionTier: 'ULTRA',
      deviceProfile: {
        machineId: 'auth0|user_mock',
        macMachineId: 'mac-mock',
        devDeviceId: 'dev-mock',
        sqmId: '{SQM-MOCK}'
      }
    },
    {
      accessToken: 'ya29.fresh',
      refreshToken: '1//fresh-rt',
      expiryTimestamp: Math.floor(Date.now() / 1000) + 7200
    }
  );
  const tokenData = store.getAccountToken(saved.id);

  // Hot switch on running IDE
  const injectedCalls = [];
  let killedLsCount = 0;
  const hotRes = await switcher.switchAccount({
    account: saved,
    tokenData,
    targetClient: 'ide',
    store,
    deps: {
      oauth: { ensureFreshToken: async (tok) => tok },
      stateDb: {
        getDbPath: () => path.join(dir, 'ide', 'state.vscdb'),
        injectTokenToDb: (dbPath, payload) => injectedCalls.push({ dbPath, email: payload.email }),
        writeServiceMachineId: () => {}
      },
      deviceProfile: {
        getStoragePath: () => path.join(dir, 'ide', 'storage.json'),
        readDeviceProfile: () => null,
        writeDeviceProfile: () => {},
        generateDeviceProfile: () => saved.deviceProfile
      },
      keyring: { writeToSystemKeyring: () => {}, readFromSystemKeyring: () => tokenData },
      fileCredentials: { writeFileCredentials: () => {}, writeAcpCredentials: () => {} },
      processManager: {
        isAntigravityRunning: (target) => target === 'ide',
        getAntigravityExecutablePath: () => '/usr/bin/antigravity-ide',
        getArgsFromRunningProcess: () => ['--reuse-window'],
        killLanguageServer: () => { killedLsCount += 1; return 1; },
        waitForLanguageServerRespawn: async () => true
      }
    }
  });
  assert.equal(hotRes.ok, true);
  assert.equal(hotRes.target, 'ide');
  assert.equal(hotRes.mode, 'hot');
  assert.equal(killedLsCount, 1);
  assert.ok(injectedCalls.length >= 1);
  assert.equal(store.getStateForRenderer().activeAccounts.ide, saved.id);

  // AGY CLI switch
  let syncedCli = false;
  const agyRes = await switcher.switchAccount({
    account: saved,
    tokenData,
    targetClient: 'agy',
    store,
    deps: {
      oauth: { ensureFreshToken: async (tok) => tok },
      deviceProfile: { getStoragePath: () => '' },
      keyring: {
        writeToSystemKeyring: () => {},
        readFromSystemKeyring: () => ({ refreshToken: '1//fresh-rt' })
      },
      fileCredentials: {
        writeFileCredentials: (_tok, opts) => { syncedCli = Boolean(opts?.syncAgyCli); }
      }
    }
  });
  assert.equal(agyRes.ok, true);
  assert.equal(agyRes.target, 'agy');
  assert.equal(syncedCli, true);
  assert.equal(store.getStateForRenderer().activeAccounts.agy, saved.id);

  // ACP switch
  let acpKilled = 0;
  let acpFileWritten = false;
  const acpRes = await switcher.switchAccount({
    account: saved,
    tokenData,
    targetClient: 'acp',
    store,
    deps: {
      oauth: { ensureFreshToken: async (tok) => tok },
      deviceProfile: { getStoragePath: () => '' },
      keyring: { ACP_ACCOUNT: 'antigravity-acp', writeToSystemKeyring: () => {} },
      fileCredentials: { writeAcpCredentials: () => { acpFileWritten = true; } },
      processManager: { killAcpServers: () => { acpKilled = 2; return 2; } }
    }
  });
  assert.equal(acpRes.ok, true);
  assert.equal(acpRes.target, 'acp');
  assert.equal(acpFileWritten, true);
  assert.equal(acpKilled, 2);
  assert.equal(store.getStateForRenderer().activeAccounts.acp, saved.id);
});
