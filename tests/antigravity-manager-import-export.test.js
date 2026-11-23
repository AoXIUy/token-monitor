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

test('importExport rejects path traversal, normalizes Rust quota timestamps, preserves rotated refresh tokens, and recovers disabled accounts', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agm-io-sec-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  // Outside secret file that path traversal must NEVER read
  const outsideFile = path.join(dir, 'outside.json');
  fs.writeFileSync(outsideFile, JSON.stringify({
    email: 'escape@example.com',
    token: { refresh_token: '1//escaped-secret' }
  }));

  const dataDir = path.join(dir, 'data_dir');
  const accountsDir = path.join(dataDir, 'accounts');
  fs.mkdirSync(accountsDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'accounts.json'), JSON.stringify({
    accounts: [{ id: '../../outside' }, { id: 'valid-1' }]
  }));
  fs.writeFileSync(path.join(accountsDir, 'valid-1.json'), JSON.stringify({
    email: 'ok@example.com',
    token: { refresh_token: '1//valid-rt' },
    quota: {
      last_updated: 1763942400,
      quota_groups: [{ display_name: 'Gemini', buckets: [{ bucket_id: '5h', remaining_fraction: 1.5 }] }],
      models: []
    }
  }));

  const store = createAntigravityManagerStore({ baseDir: path.join(dir, 'store') });
  const dirRes = importExport.importFromManagerDataDir(dataDir, { store });
  assert.equal(dirRes.imported, 1);
  assert.equal(store.findAccountByEmail('escape@example.com'), null);
  const okAcc = store.findAccountByEmail('ok@example.com');
  assert.equal(okAcc.quota.lastUpdatedAt, 1763942400 * 1000);
  assert.equal(okAcc.quota.groups[0].buckets[0].remainingFraction, 1);

  // V1 import rejects backup_file escaping v1Dir
  const v1Dir = path.join(dir, 'v1');
  fs.mkdirSync(v1Dir, { recursive: true });
  fs.writeFileSync(path.join(v1Dir, 'accounts.json'), JSON.stringify({
    accounts: {
      evil: { email: 'escape@example.com', backup_file: outsideFile }
    }
  }));
  const v1Res = await importExport.importFromV1Dir(v1Dir, {
    store,
    oauth: {
      refreshAccessToken: async () => { throw new Error('should not be called'); },
      fetchUserInfo: async () => { throw new Error('should not be called'); }
    }
  });
  assert.equal(v1Res.total, 0);

  // Re-importing a previously invalid_grant-disabled account keeps saved name, clears disabled, and stores rotated refresh token
  store.upsertAccount({
    email: 'recover@example.com',
    name: 'Saved Display Name',
    disabled: true,
    disabledReason: 'invalid_grant',
    disabledAt: 1763942000
  }, { accessToken: 'ya29.old', refreshToken: '1//old-rt', expiryTimestamp: 100 });

  const recovered = await importExport.importSingleRefreshToken(
    { refreshToken: '1//input-rt' },
    {
      store,
      oauth: {
        BUILTIN_GCP_CLIENT_KEY: 'antigravity_gcp',
        refreshAccessToken: async () => ({
          accessToken: 'ya29.new',
          refreshToken: '1//rotated-rt',
          expiresIn: 3600,
          expiryTimestamp: 1800000000,
          idToken: '',
          oauthClientKey: 'antigravity_enterprise'
        }),
        fetchUserInfo: async () => ({ email: 'recover@example.com', name: '' })
      }
    }
  );
  assert.equal(recovered.name, 'Saved Display Name');
  assert.equal(recovered.disabled, false);
  assert.equal(recovered.disabledReason, '');
  assert.equal(recovered.disabledAt, null);
  assert.equal(store.getAccountToken(recovered.id).refreshToken, '1//rotated-rt');

  // Mixed JSON array with raw token strings & non-email names
  const mixed = importExport.parseImportEntriesFromString(JSON.stringify([
    { name: 'Not An Email', refresh_token: '1//mixed-1' },
    '1//mixed-2'
  ]));
  assert.deepEqual(mixed, [
    { refreshToken: '1//mixed-1' },
    { refreshToken: '1//mixed-2' }
  ]);
});
