'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAntigravityManagerStore } = require('../src/electron/antigravityManager/store');
const importExport = require('../src/electron/antigravityManager/importExport');

test('parseImportEntriesFromString supports Antigravity-Manager JSON and raw 1// tokens', () => {
  const fromJson = importExport.parseImportEntriesFromString(JSON.stringify([
    { email: 'Alice@Example.com', refresh_token: '1//token-a' },
    { email: 'bad', refresh_token: 'not-a-refresh-token' },
    { email: 'Bob@Example.com', refreshToken: '1//token-b' },
    { email: 'dup@example.com', refresh_token: '1//token-a' }
  ]));
  assert.deepEqual(fromJson, [
    { email: 'alice@example.com', refreshToken: '1//token-a' },
    { email: 'bob@example.com', refreshToken: '1//token-b' }
  ]);

  const fromText = importExport.parseImportEntriesFromString('1//raw-1\n1//raw-2,1//raw-1');
  assert.deepEqual(fromText, [
    { refreshToken: '1//raw-1' },
    { refreshToken: '1//raw-2' }
  ]);
});

test('importFromManagerDataDir imports ~/.antigravity_tools format, exports JSON, and strips tokens from renderer state', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agm-io-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const dataDir = path.join(dir, 'antigravity_tools');
  const accountsDir = path.join(dataDir, 'accounts');
  fs.mkdirSync(accountsDir, { recursive: true });

  fs.writeFileSync(path.join(dataDir, 'accounts.json'), JSON.stringify({
    current_account_id: 'rust-id-1',
    current_agy_account_id: 'rust-id-2',
    accounts: [{ id: 'rust-id-1' }, { id: 'rust-id-2' }]
  }));

  fs.writeFileSync(path.join(accountsDir, 'rust-id-1.json'), JSON.stringify({
    email: 'alice@example.com',
    name: 'Alice Ultra',
    token: {
      access_token: 'ya29.secret-alice',
      refresh_token: '1//secret-alice',
      expires_in: 3599,
      expiry_timestamp: 1763942400
    },
    device_profile: {
      machine_id: 'auth0|user_abc',
      mac_machine_id: 'mac-uuid',
      dev_device_id: 'dev-uuid',
      sqm_id: '{SQM}'
    },
    quota: {
      subscription_tier: 'ULTRA',
      models: [
        { name: 'claude-sonnet-4-6', percentage: 90, reset_time: '2026-11-23T15:00:00Z' }
      ]
    }
  }));

  fs.writeFileSync(path.join(accountsDir, 'rust-id-2.json'), JSON.stringify({
    email: 'bob@example.com',
    token: {
      access_token: 'ya29.secret-bob',
      refresh_token: '1//secret-bob'
    },
    quota: { subscription_tier: 'PRO', models: [] }
  }));

  const store = createAntigravityManagerStore({ baseDir: path.join(dir, 'store') });
  const res = importExport.importFromManagerDataDir(dataDir, { store });
  assert.equal(res.imported, 2);
  assert.equal(res.skipped, 0);

  const rendererState = store.getStateForRenderer();
  assert.equal(rendererState.accounts.length, 2);
  const serializedRenderer = JSON.stringify(rendererState);
  assert.equal(serializedRenderer.includes('1//secret-alice'), false);
  assert.equal(serializedRenderer.includes('ya29.secret-alice'), false);
  const alice = rendererState.accounts.find((a) => a.email === 'alice@example.com');
  const bob = rendererState.accounts.find((a) => a.email === 'bob@example.com');
  assert.equal(rendererState.activeAccounts.classic, alice.id);
  assert.equal(rendererState.activeAccounts.agy, bob.id);
  assert.equal(alice.subscriptionTier, 'ULTRA');
  assert.equal(alice.hasDeviceProfile, true);

  const exported = importExport.exportAccountsToJson(store, [alice.id]);
  assert.deepEqual(exported, [
    { email: 'alice@example.com', refresh_token: '1//secret-alice' }
  ]);
});
