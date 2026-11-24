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

test('stateDb preserves isGcpTos=false on personal accounts, recovers corrupt oauth blob, and rolls back failed transactions', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agm-db-reg-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dbPath = path.join(dir, 'state.vscdb');

  // Seed DB with corrupt oauthToken blob to verify recovery during injection
  const initDb = new DatabaseSync(dbPath);
  initDb.exec('CREATE TABLE IF NOT EXISTS ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);');
  initDb.prepare('INSERT INTO ItemTable (key, value) VALUES (?, ?)').run(
    'antigravityUnifiedStateSync.oauthToken',
    Buffer.from([0x0a, 0xff, 0xff, 0xff, 0xff, 0x0f]).toString('base64')
  );
  initDb.close();

  stateDb.injectTokenToDb(dbPath, {
    accessToken: 'ya29.personal',
    refreshToken: '1//personal-rt',
    expiry: 1763942400,
    email: 'user@gmail.com',
    isGcpTos: false
  });

  // Personal account has Field 6 omitted (proto3 false) and must NOT invert to isGcpTos=true
  const extracted = stateDb.extractOAuthStateFromDb(dbPath);
  assert.equal(extracted.refreshToken, '1//personal-rt');
  assert.equal(extracted.isGcpTos, false);
  assert.equal(extracted.projectId, null);

  // Simulated mid-transaction SQLite failure must trigger ROLLBACK so DB is not half-updated
  let rolledBack = false;
  let beganImmediate = false;
  let runCalls = 0;
  class MockDatabaseSync {
    exec(sql) {
      if (/BEGIN IMMEDIATE/i.test(sql)) beganImmediate = true;
      if (/ROLLBACK/i.test(sql)) rolledBack = true;
    }
    prepare() {
      return {
        get: () => undefined,
        run: () => {
          runCalls += 1;
          if (runCalls === 3) throw new Error('SQLITE_FULL');
        }
      };
    }
    close() {}
  }
  assert.throws(() => stateDb.injectTokenToDb(dbPath, {
    accessToken: 'ya29.fail',
    refreshToken: '1//fail-rt',
    expiry: 1763942400,
    email: 'fail@example.com'
  }, { sqlite: { DatabaseSync: MockDatabaseSync }, createBackup: false }), /SQLITE_FULL/);
  assert.equal(beganImmediate, true);
  assert.equal(rolledBack, true);

  // Windows path candidates use win32 separators even when evaluated on Linux/macOS
  const winPaths = stateDb.getAllCandidateDbPaths('classic', {
    platform: 'win32',
    env: { APPDATA: 'C:\\Users\\Alice\\AppData\\Roaming' },
    executablePath: 'D:\\Apps\\Antigravity\\Antigravity.exe'
  });
  assert.ok(winPaths.includes('D:\\Apps\\Antigravity\\data\\user-data\\User\\globalStorage\\state.vscdb'));
  assert.ok(winPaths.includes('C:\\Users\\Alice\\AppData\\Roaming\\Antigravity\\User\\globalStorage\\state.vscdb'));
});

test('stateDb injectTokenToDbAsync writes token and machine IDs in one transaction and skips redundant fresh backups', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agm-db-async-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dbPath = path.join(dir, 'state.vscdb');

  const initDb = new DatabaseSync(dbPath);
  initDb.exec('CREATE TABLE IF NOT EXISTS ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);');
  initDb.prepare('INSERT INTO ItemTable (key, value) VALUES (?, ?)').run('initialKey', 'v1');
  initDb.close();

  await stateDb.injectTokenToDbAsync(dbPath, {
    accessToken: 'ya29.first',
    refreshToken: '1//first-rt',
    expiry: 1763942400,
    email: 'one@example.com',
    serviceMachineId: 'mac-id-1',
    storageServiceMachineId: 'dev-id-1'
  });

  const backupPath = `${dbPath}.backup`;
  assert.equal(fs.existsSync(backupPath), true);
  const firstBackupStat = fs.statSync(backupPath);

  // Immediate second switch reuses the fresh backup without re-copying state.vscdb
  await stateDb.injectTokenToDbAsync(dbPath, {
    accessToken: 'ya29.second',
    refreshToken: '1//second-rt',
    expiry: 1763942400,
    email: 'two@example.com',
    serviceMachineId: 'mac-id-2',
    storageServiceMachineId: 'dev-id-2'
  });
  const secondBackupStat = fs.statSync(backupPath);
  assert.equal(secondBackupStat.mtimeMs, firstBackupStat.mtimeMs);

  const checkDb = new DatabaseSync(dbPath, { readOnly: true });
  const svcMachine = checkDb.prepare('SELECT value FROM ItemTable WHERE key = ?').get('telemetry.serviceMachineId').value;
  const storMachine = checkDb.prepare('SELECT value FROM ItemTable WHERE key = ?').get('storage.serviceMachineId').value;
  checkDb.close();
  assert.equal(svcMachine, 'mac-id-2');
  assert.equal(storMachine, 'dev-id-2');
});
