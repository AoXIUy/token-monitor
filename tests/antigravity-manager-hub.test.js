'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHub } = require('../src/hub/server');
const {
  AG_MANAGER_BASE,
  AG_MANAGER_SNAPSHOT_PATH,
  sanitizeAntigravityManagerSnapshot
} = require('../src/shared/antigravityManagerProtocol');

test('sanitizeAntigravityManagerSnapshot drops secrets, refresh tokens, and device identifiers', () => {
  const clean = sanitizeAntigravityManagerSnapshot({
    version: 1,
    deviceId: 'host-1',
    hostname: 'Workstation',
    updatedAt: '2026-11-23T10:00:00Z',
    secret: 'leaked',
    settings: { startupRefresh: false, autoRefresh: false, refreshIntervalMinutes: 10 },
    activeAccounts: { classic: 'alice@example.com', ide: '', agy: '', acp: '' },
    accounts: [
      {
        id: 'id-1',
        email: 'alice@example.com',
        subscriptionTier: 'ULTRA',
        refresh_token: '1//should-not-pass',
        accessToken: 'ya29.should-not-pass',
        deviceProfile: { machineId: 'auth0|secret' },
        hasDeviceProfile: true,
        quota: {
          models: [
            { name: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6', percentage: 85, resetTime: '2026-11-23T12:00:00Z' }
          ]
        }
      }
    ]
  });

  const text = JSON.stringify(clean);
  assert.equal(text.includes('1//should-not-pass'), false);
  assert.equal(text.includes('ya29.should-not-pass'), false);
  assert.equal(text.includes('auth0|secret'), false);
  assert.equal(text.includes('leaked'), false);
  assert.equal(clean.accounts[0].subscriptionTier, 'ULTRA');
  assert.equal(clean.accounts[0].hasDeviceProfile, true);
});

test('Node Hub antigravity-manager endpoints require auth, persist snapshots, and clean up on device removal', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agm-hub-'));
  const dataFile = path.join(dir, 'devices.json');
  const hub = createHub({ host: '127.0.0.1', port: 0, secret: 'hub-secret', dataFile });
  await hub.start();
  t.after(async () => {
    await hub.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${hub.server.address().port}`;

  // Unauthorized requests must fail cleanly
  assert.equal((await fetch(`${baseUrl}${AG_MANAGER_BASE}`)).status, 401);
  assert.equal((await fetch(`${baseUrl}${AG_MANAGER_SNAPSHOT_PATH}`, { method: 'PUT', body: '{}' })).status, 401);

  // Register device so DELETE /api/devices/:id later cleans it up
  hub.ingest({
    deviceId: 'host-1',
    hostname: 'Workstation',
    updatedAt: new Date().toISOString(),
    today: { totalTokens: 1 },
    month: { totalTokens: 1 },
    allTime: { totalTokens: 1 }
  });

  const putRes = await fetch(`${baseUrl}${AG_MANAGER_SNAPSHOT_PATH}`, {
    method: 'PUT',
    headers: {
      authorization: 'Bearer hub-secret',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      version: 1,
      deviceId: 'host-1',
      hostname: 'Workstation',
      updatedAt: '2026-11-23T10:00:00Z',
      settings: { startupRefresh: false, autoRefresh: false, refreshIntervalMinutes: 10 },
      activeAccounts: { classic: 'alice@example.com' },
      accounts: [
        {
          id: 'id-1',
          email: 'alice@example.com',
          subscriptionTier: 'PRO',
          refreshToken: '1//leak-test',
          quota: { models: [{ name: 'gemini-3-pro', percentage: 60 }] }
        }
      ]
    })
  });
  assert.equal(putRes.status, 200);
  assert.equal(putRes.headers.get('cache-control'), 'no-store');
  const putJson = await putRes.json();
  assert.equal(putJson.ok, true);
  assert.equal(putJson.deviceId, 'host-1');
  assert.equal(putJson.accountCount, 1);

  const getRes = await fetch(`${baseUrl}${AG_MANAGER_BASE}`, {
    headers: { authorization: 'Bearer hub-secret' }
  });
  assert.equal(getRes.status, 200);
  assert.equal(getRes.headers.get('cache-control'), 'no-store');
  const getJson = await getRes.json();
  assert.equal(getJson.ok, true);
  assert.equal(getJson.devices.length, 1);
  assert.equal(getJson.devices[0].accounts[0].email, 'alice@example.com');
  assert.equal(JSON.stringify(getJson).includes('1//leak-test'), false);

  // Malformed non-array accounts must fail with 400 instead of wiping stored accounts
  const badRes = await fetch(`${baseUrl}${AG_MANAGER_SNAPSHOT_PATH}`, {
    method: 'PUT',
    headers: {
      authorization: 'Bearer hub-secret',
      'content-type': 'application/json'
    },
    body: JSON.stringify({ deviceId: 'host-1', accounts: 'not-an-array' })
  });
  assert.equal(badRes.status, 400);
  const stillThere = await (await fetch(`${baseUrl}${AG_MANAGER_BASE}`, {
    headers: { authorization: 'Bearer hub-secret' }
  })).json();
  assert.equal(stillThere.devices[0].accounts.length, 1);

  // Verify persistence file on disk contains snapshot and ZERO credentials
  const persisted = fs.readFileSync(path.join(dir, 'antigravity-manager-snapshots.json'), 'utf8');
  assert.equal(persisted.includes('alice@example.com'), true);
  assert.equal(persisted.includes('1//leak-test'), false);

  // Removing device also cleans its Antigravity Manager snapshot
  const delRes = await fetch(`${baseUrl}/api/devices/host-1`, {
    method: 'DELETE',
    headers: { authorization: 'Bearer hub-secret' }
  });
  assert.equal(delRes.status, 200);

  const afterDel = await (await fetch(`${baseUrl}${AG_MANAGER_BASE}`, {
    headers: { authorization: 'Bearer hub-secret' }
  })).json();
  assert.equal(afterDel.devices.length, 0);
});

test('sanitizeAntigravityManagerSnapshot maps banInfo.code, preserves depleted 0% buckets, and store rolls back failed writes', (t) => {
  const { createAntigravityManagerStore } = require('../src/hub/antigravityManager');
  const clean = sanitizeAntigravityManagerSnapshot({
    deviceId: 'host-2',
    accounts: [
      {
        id: 'acc-1',
        email: 'banned@example.com',
        banned: true,
        banInfo: { code: 'TOS_VIOLATION', message: 'private detail', appealUrl: 'https://example.com/appeal' },
        quota: {
          groups: [
            {
              displayName: 'Gemini',
              buckets: [
                { bucketId: 'gemini-5h', window: '5h', resetTime: '2026-11-23T12:00:00Z' },
                { bucketId: 'bad-bool', window: '5h', remainingFraction: false },
                { bucketId: 'bad-empty', window: '5h', remainingFraction: '' }
              ]
            }
          ]
        }
      }
    ]
  });
  assert.equal(clean.accounts[0].banCode, 'TOS_VIOLATION');
  assert.equal(JSON.stringify(clean).includes('appeal'), false);
  assert.equal(clean.accounts[0].quota.groups[0].buckets.length, 1);
  assert.equal(clean.accounts[0].quota.groups[0].buckets[0].bucketId, 'gemini-5h');
  assert.equal(clean.accounts[0].quota.groups[0].buckets[0].remainingFraction, 0);

  assert.throws(
    () => sanitizeAntigravityManagerSnapshot({ deviceId: 'host-2', accounts: {} }),
    (err) => err?.code === 'invalid_request'
  );

  // Store returns cloned snapshots so caller mutation cannot corrupt stored data
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agm-hub-store-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = createAntigravityManagerStore({ dataFile: path.join(dir, 'devices.json') });
  const put = store.putSnapshot({ deviceId: 'host-2', accounts: [{ id: 'a1', email: 'a@example.com' }] });
  assert.equal(put.accountCount, 1);
  const snap1 = store.getSnapshots();
  snap1.devices[0].hostname = 'MUTATED';
  assert.equal(store.getSnapshots().devices[0].hostname, '');

  // If persistence fails (e.g. target path is a directory), putSnapshot rolls back in-memory state
  const badDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agm-hub-fail-'));
  t.after(() => fs.rmSync(badDir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(badDir, 'antigravity-manager-snapshots.json'));
  const failingStore = createAntigravityManagerStore({
    dataFile: path.join(badDir, 'devices.json'),
    logger: { warn: () => {}, error: () => {} }
  });
  assert.throws(() => failingStore.putSnapshot({ deviceId: 'host-fail', accounts: [] }));
  assert.equal(failingStore.getSnapshots().devices.length, 0);
});
