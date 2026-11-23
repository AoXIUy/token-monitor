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
  const putJson = await putRes.json();
  assert.equal(putJson.ok, true);
  assert.equal(putJson.deviceId, 'host-1');

  const getRes = await fetch(`${baseUrl}${AG_MANAGER_BASE}`, {
    headers: { authorization: 'Bearer hub-secret' }
  });
  assert.equal(getRes.status, 200);
  const getJson = await getRes.json();
  assert.equal(getJson.ok, true);
  assert.equal(getJson.devices.length, 1);
  assert.equal(getJson.devices[0].accounts[0].email, 'alice@example.com');
  assert.equal(JSON.stringify(getJson).includes('1//leak-test'), false);

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
