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

test('fileCredentials strips leading UTF-8 BOM when reading local credential files (sync and async)', async (t) => {
  const fileCredentials = require('../src/electron/antigravityManager/fileCredentials');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agm-fc-bom-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  fs.mkdirSync(path.join(dir, 'antigravity-acp'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'jetski-standalone-oauth-token'),
    `\uFEFF${JSON.stringify({ token: { refresh_token: '1//bom-standalone' }, id_token_email: 'BomUser@Example.com' })}`,
    'utf8'
  );
  fs.writeFileSync(
    path.join(dir, 'antigravity-acp', 'acp_token.json'),
    `\uFEFF${JSON.stringify({ refresh_token: '1//bom-acp', email: 'acp@example.com', project_id: 'proj-bom' })}`,
    'utf8'
  );

  const expected = [
    { source: 'standalone-file', refreshToken: '1//bom-standalone', email: 'bomuser@example.com', projectId: '' },
    { source: 'acp-file', refreshToken: '1//bom-acp', email: 'acp@example.com', projectId: 'proj-bom' }
  ];
  assert.deepEqual(fileCredentials.readLocalCredentialFiles({ geminiDir: dir }), expected);
  assert.deepEqual(await fileCredentials.readLocalCredentialFilesAsync({ geminiDir: dir }), expected);
});

test('scanAndImportLocalAccounts aggregates keyring, stateDb, and fileCredentials and isolates per-source failures', async (t) => {
  const stateDb = require('../src/electron/antigravityManager/stateDb');
  const fileCredentials = require('../src/electron/antigravityManager/fileCredentials');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agm-scan-local-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const dbPath = path.join(dir, 'state.vscdb');
  stateDb.injectTokenToDb(dbPath, {
    accessToken: 'ya29.db',
    refreshToken: '1//db-rt',
    expiry: 1800000000,
    email: 'db@example.com',
    isGcpTos: true,
    projectId: 'proj-db'
  }, { createBackup: false });

  const geminiDir = path.join(dir, '.gemini');
  fs.mkdirSync(geminiDir, { recursive: true });
  fs.writeFileSync(
    path.join(geminiDir, 'jetski-standalone-oauth-token'),
    `\uFEFF${JSON.stringify({ token: { refresh_token: '1//file-rt' }, id_token_email: 'file@example.com' })}`,
    'utf8'
  );

  const mockOAuth = {
    BUILTIN_GCP_CLIENT_KEY: 'antigravity_gcp',
    refreshAccessToken: async (rt) => ({
      accessToken: `ya29.${rt}`,
      refreshToken: rt,
      expiresIn: 3600,
      expiryTimestamp: 1800000000,
      idToken: '',
      oauthClientKey: 'antigravity_enterprise'
    }),
    fetchUserInfo: async (accessToken) => {
      const tag = accessToken.replace('ya29.1//', '');
      return { email: `${tag}@example.com`, name: tag };
    }
  };

  // 1. Multi-source scan deduplicates shared tokens and uses async readers when available
  const store1 = createAntigravityManagerStore({ baseDir: path.join(dir, 'store1') });
  let usedAsyncKeyring = false;
  const fullRes = await importExport.scanAndImportLocalAccounts({
    store: store1,
    oauth: mockOAuth,
    geminiDir,
    keyring: {
      DEFAULT_ACCOUNT: 'antigravity',
      ACP_ACCOUNT: 'antigravity-acp',
      readFromSystemKeyringAsync: async ({ account }) => {
        usedAsyncKeyring = true;
        if (account === 'antigravity') return { refreshToken: '1//kr-rt', email: 'kr@example.com' };
        return { refreshToken: '1//db-rt', email: 'dup@example.com' };
      }
    },
    stateDb: {
      getAllAntigravityDbPaths: () => [dbPath, path.join(dir, 'missing.vscdb')],
      extractOAuthStateFromDb: (p, d) => stateDb.extractOAuthStateFromDb(p, d)
    },
    fileCredentials
  });
  assert.equal(usedAsyncKeyring, true);
  assert.equal(fullRes.total, 3);
  assert.equal(fullRes.success, 3);
  assert.equal(fullRes.failed, 0);
  const emails1 = store1.listAccounts().map((a) => a.email).sort();
  assert.deepEqual(emails1, ['db-rt@example.com', 'file-rt@example.com', 'kr-rt@example.com']);

  // 2. Per-source error isolation: throwing keyring does not prevent stateDb + fileCredentials import
  const store2 = createAntigravityManagerStore({ baseDir: path.join(dir, 'store2') });
  const isolatedRes = await importExport.scanAndImportLocalAccounts({
    store: store2,
    oauth: mockOAuth,
    geminiDir,
    keyring: {
      DEFAULT_ACCOUNT: 'antigravity',
      ACP_ACCOUNT: 'antigravity-acp',
      readFromSystemKeyring: () => { throw new Error('keyring unavailable'); }
    },
    stateDb: {
      getAllAntigravityDbPaths: () => [dbPath],
      extractOAuthStateFromDb: (p, d) => stateDb.extractOAuthStateFromDb(p, d)
    },
    fileCredentials
  });
  assert.equal(isolatedRes.total, 2);
  assert.equal(isolatedRes.success, 2);
  assert.deepEqual(store2.listAccounts().map((a) => a.email).sort(), ['db-rt@example.com', 'file-rt@example.com']);

  // 3. Throwing DB path discovery and throwing fileCredentials still allow keyring accounts through
  const store3 = createAntigravityManagerStore({ baseDir: path.join(dir, 'store3') });
  const isolatedRes2 = await importExport.scanAndImportLocalAccounts({
    store: store3,
    oauth: mockOAuth,
    keyring: {
      DEFAULT_ACCOUNT: 'antigravity',
      ACP_ACCOUNT: 'antigravity-acp',
      readFromSystemKeyring: ({ account }) => (account === 'antigravity' ? { refreshToken: '1//only-kr', email: 'only@example.com' } : null)
    },
    stateDb: {
      getAllAntigravityDbPaths: () => { throw new Error('db root failed'); },
      extractOAuthStateFromDb: () => { throw new Error('should not be called'); }
    },
    fileCredentials: {
      readLocalCredentialFilesAsync: async () => { throw new Error('fs failed'); }
    }
  });
  assert.equal(isolatedRes2.total, 1);
  assert.equal(isolatedRes2.success, 1);
  assert.deepEqual(store3.listAccounts().map((a) => a.email), ['only-kr@example.com']);
});
