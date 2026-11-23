'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const stateDb = require('../src/electron/antigravityManager/stateDb');
const deviceProfile = require('../src/electron/antigravityManager/deviceProfile');
const protobuf = require('../src/electron/antigravityManager/protobuf');

test('stateDb injectTokenToDb preserves unrelated topic entries and extracts OAuth state', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agm-db-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dbPath = path.join(dir, 'state.vscdb');

  // Seed DB with an unrelated topic entry inside unified oauthToken blob
  const initDb = new DatabaseSync(dbPath);
  initDb.exec('CREATE TABLE IF NOT EXISTS ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);');
  const existingTopic = protobuf.createUnifiedTopicEntry('unrelatedSentinel', Buffer.from('preserve-me'));
  initDb.prepare('INSERT INTO ItemTable (key, value) VALUES (?, ?)').run(
    'antigravityUnifiedStateSync.oauthToken',
    existingTopic.toString('base64')
  );
  initDb.prepare('INSERT INTO ItemTable (key, value) VALUES (?, ?)').run(
    'jetskiStateSync.agentManagerInitState',
    'stale-legacy'
  );
  initDb.close();

  const msg = stateDb.injectTokenToDb(dbPath, {
    accessToken: 'ya29.inject',
    refreshToken: '1//inject-rt',
    expiry: 1763942400,
    email: 'dev@acme-corp.com',
    isGcpTos: true,
    projectId: 'gcp-proj-1'
  });
  assert.match(msg, /Token injection successful/);
  assert.equal(fs.existsSync(`${dbPath}.backup`), true);

  const extracted = stateDb.extractOAuthStateFromDb(dbPath);
  assert.equal(extracted.refreshToken, '1//inject-rt');
  assert.equal(extracted.isGcpTos, true);
  assert.equal(extracted.projectId, 'gcp-proj-1');

  // Verify unrelated topic sentinel preserved & legacy key removed
  const checkDb = new DatabaseSync(dbPath, { readOnly: true });
  const oauthRaw = checkDb.prepare('SELECT value FROM ItemTable WHERE key = ?').get('antigravityUnifiedStateSync.oauthToken').value;
  const legacyRow = checkDb.prepare('SELECT value FROM ItemTable WHERE key = ?').get('jetskiStateSync.agentManagerInitState');
  const onboardRow = checkDb.prepare('SELECT value FROM ItemTable WHERE key = ?').get('antigravityOnboarding').value;
  checkDb.close();

  assert.equal(legacyRow, undefined);
  assert.equal(onboardRow, 'true');
  const kept = protobuf.decodeUnifiedStateEntryWithTarget(oauthRaw, 'unrelatedSentinel');
  assert.equal(kept.sentinelKey, 'unrelatedSentinel');
  assert.equal(kept.payload.toString('utf8'), 'preserve-me');
});

test('deviceProfile read/write updates nested+flat telemetry keys and sibling serviceMachineId', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agm-dev-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const storagePath = path.join(dir, 'storage.json');
  const dbPath = path.join(dir, 'state.vscdb');

  const initDb = new DatabaseSync(dbPath);
  initDb.exec('CREATE TABLE IF NOT EXISTS ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);');
  initDb.close();

  const generated = deviceProfile.generateDeviceProfile();
  deviceProfile.writeDeviceProfile(storagePath, generated);

  const loaded = deviceProfile.readDeviceProfile(storagePath);
  assert.deepEqual(loaded, generated);

  const rawStorage = JSON.parse(fs.readFileSync(storagePath, 'utf8'));
  assert.equal(rawStorage['telemetry.devDeviceId'], generated.devDeviceId);
  assert.equal(rawStorage.telemetry.sqmId, generated.sqmId);

  const db = new DatabaseSync(dbPath, { readOnly: true });
  const row = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get('storage.serviceMachineId');
  db.close();
  assert.equal(row.value, generated.devDeviceId);
});
