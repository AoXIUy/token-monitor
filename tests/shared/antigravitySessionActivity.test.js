'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const { isRunningSession, sessionActivityState, sessionWithActivity } = require('../../src/shared/sessionLive');
const { isSessionActivityClient } = require('../../src/shared/sessionActivityProviders');
const { materializeActivity } = require('../../src/shared/sessionActivityProjection');
const { createSessionCompletionTracker } = require('../../src/shared/sessionCompletion');
const {
  activityWatchTargets,
  parseSqliteTimestamp,
  projectActivity,
  readSessionActivity,
  readSummaryActivity
} = require('../../src/shared/providers/antigravity/sessionActivity');

let sqlite;
try { sqlite = require('node:sqlite'); } catch (_) { sqlite = null; }

function createSummaryFixture(t) {
  const temp = fs.realpathSync.native(os.tmpdir());
  const home = fs.mkdtempSync(path.join(temp, 'ag-activity-'));
  const root = path.join(home, '.gemini', 'antigravity');
  fs.mkdirSync(root, { recursive: true });
  const dbPath = path.join(root, 'conversation_summaries.db');
  const db = new sqlite.DatabaseSync(dbPath);
  let closed = false;
  const close = () => {
    if (closed) return;
    db.close();
    closed = true;
  };
  t.after(() => {
    close();
    fs.rmSync(home, { recursive: true, force: true });
  });
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(`
    CREATE TABLE conversation_summaries (
      conversation_id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT "",
      preview TEXT NOT NULL DEFAULT "",
      workspace_uris TEXT,
      last_modified_time TEXT,
      status TEXT NOT NULL DEFAULT "",
      not_fully_idle INTEGER NOT NULL DEFAULT 0,
      killed INTEGER NOT NULL DEFAULT 0,
      parent_conversation_id TEXT DEFAULT "",
      agent_name TEXT DEFAULT ""
    )
  `);
  const put = db.prepare(`
    INSERT OR REPLACE INTO conversation_summaries (
      conversation_id, title, preview, workspace_uris, last_modified_time,
      status, not_fully_idle, killed, parent_conversation_id, agent_name
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  return { home, root, db, dbPath, put };
}

test('isSessionActivityClient registers antigravity', () => {
  assert.equal(isSessionActivityClient('antigravity'), true);
});

test('parseSqliteTimestamp normalizes Antigravity nanosecond timestamps and rejects year-1 sentinels', () => {
  assert.equal(parseSqliteTimestamp('0001-01-01 00:00:00+00:00'), 0);
  assert.equal(parseSqliteTimestamp(''), 0);
  const parsed = parseSqliteTimestamp('2026-11-21 06:23:22.689019974+00:00');
  assert.equal(parsed, Date.parse('2026-11-21T06:23:22.689+00:00'));
});

test('Antigravity activity projects pre-token running nativeSessions and clears running immediately on IDLE', { skip: !sqlite }, async (t) => {
  const fixture = createSummaryFixture(t);
  const projectDir = path.join(fixture.home, 'demo-project');
  fs.mkdirSync(projectDir, { recursive: true });
  const workspaceUris = JSON.stringify([pathToFileURL(projectDir).href]);
  const transcriptDir = path.join(fixture.root, 'brain', 'sess-live', '.system_generated', 'logs');
  fs.mkdirSync(transcriptDir, { recursive: true });
  fs.writeFileSync(path.join(transcriptDir, 'transcript_full.jsonl'), '{}\n');

  const baseNow = Date.parse('2026-11-21T06:00:00.000Z');
  fixture.put.run(
    'sess-live',
    'Live Antigravity task',
    '',
    workspaceUris,
    '2026-11-21 05:59:55.123456789+00:00',
    'CASCADE_RUN_STATUS_RUNNING',
    1,
    0,
    'parent-conv',
    ''
  );
  // Stale crashed RUNNING row (>30m old) must be ignored.
  fixture.put.run(
    'sess-stale',
    'Stale crashed task',
    '',
    null,
    '2026-11-21 05:00:00.000000000+00:00',
    'CASCADE_RUN_STATUS_RUNNING',
    1,
    0,
    '',
    ''
  );

  const summary = {
    updatedAt: new Date(baseNow - 1000).toISOString(),
    today: { totalTokens: 0, sessions: {} },
    month: { sessions: {} },
    allTime: { sessions: {} }
  };

  const firstActivity = await readSummaryActivity(summary, {
    homeDir: fixture.home,
    env: {},
    sqlite,
    now: baseNow,
    resolveProjects: true
  });
  assert.equal(firstActivity.readings.get('sess-live')?.state, 'running');
  assert.equal(firstActivity.readings.has('sess-stale'), false);
  const nativeRow = firstActivity.sessions['antigravity:sess-live'];
  assert.ok(nativeRow);
  assert.equal(nativeRow.title, 'Live Antigravity task');
  assert.equal(nativeRow.projectLabel, 'demo-project');
  assert.equal(nativeRow.parentSessionId, 'parent-conv');
  assert.equal(nativeRow.sessionDetailAvailable, true);
  assert.equal(nativeRow.turnEnded, false);
  assert.equal(isRunningSession(nativeRow, baseNow), true);

  // Move session into today's accounting map (still missing turnEnded from scan) and mark IDLE in summary DB.
  const accountingSummary = {
    updatedAt: new Date(baseNow).toISOString(),
    today: {
      totalTokens: 1500,
      sessions: {
        'antigravity:sess-live': {
          client: 'antigravity',
          sessionId: 'sess-live',
          totalTokens: 1500,
          inputTokens: 1000,
          outputTokens: 500,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          costUsd: 0.01,
          messageCount: 1,
          lastUsedAt: new Date(baseNow - 5000).toISOString(),
          liveActivity: { state: 'running', observedAt: new Date(baseNow).toISOString() }
        }
      }
    },
    month: { sessions: {} },
    allTime: { sessions: {} }
  };

  const tDone = baseNow + 4000;
  fixture.put.run(
    'sess-live',
    'Live Antigravity task',
    '',
    workspaceUris,
    '2026-11-21 06:00:04.000000000+00:00',
    'CASCADE_RUN_STATUS_IDLE',
    0,
    0,
    'parent-conv',
    ''
  );
  const idleActivity = await readSummaryActivity(accountingSummary, {
    homeDir: fixture.home,
    env: {},
    sqlite,
    now: tDone
  });
  assert.equal(idleActivity.readings.get('sess-live')?.state, 'idle');
  assert.equal(Object.keys(idleActivity.sessions).length, 0);

  const projected = projectActivity(accountingSummary, idleActivity, tDone);
  const effectiveRow = sessionWithActivity(projected.today, 'antigravity:sess-live', undefined, tDone);
  assert.equal(sessionActivityState(effectiveRow, tDone), 'idle');
  assert.equal(isRunningSession(effectiveRow, tDone), false);
});

test('Antigravity activityWatchTargets respects env and scopedHome', () => {
  const home = path.join(os.tmpdir(), 'ag-watch-home');
  const custom = path.join(os.tmpdir(), 'ag-watch-custom');
  const targets = activityWatchTargets({ homeDir: home, env: { ANTIGRAVITY_HOME: custom } });
  assert.ok(targets.some((entry) => entry.target === path.join(custom, 'conversation_summaries.db') && entry.kind === 'sqlite'));
  assert.ok(targets.some((entry) => entry.target === path.join(home, '.gemini', 'antigravity', 'conversation_summaries.db')));
  assert.deepEqual(activityWatchTargets({ homeDir: home, scopedHome: true }), []);
});

test('readSessionActivity inspects explicit Antigravity session IDs and scopedHome returns empty', { skip: !sqlite }, async (t) => {
  const fixture = createSummaryFixture(t);
  const now = Date.parse('2026-11-21T06:00:00.000Z');
  fixture.put.run('s1', 'One', '', null, '2026-11-21 05:59:59+00:00', 'CASCADE_RUN_STATUS_RUNNING', 1, 0, '', '');
  fixture.put.run('s2', 'Two', '', null, '2026-11-21 05:58:00+00:00', 'CASCADE_RUN_STATUS_IDLE', 0, 0, '', '');

  const readings = await readSessionActivity(new Set(['s1', 's2']), {
    homeDir: fixture.home,
    env: {},
    sqlite,
    now
  });
  assert.equal(readings.get('s1')?.state, 'running');
  assert.equal(readings.get('s2')?.state, 'idle');

  const scoped = await readSessionActivity(new Set(['s1']), {
    homeDir: fixture.home,
    env: {},
    sqlite,
    scopedHome: true,
    now
  });
  assert.equal(scoped.size, 0);
});

test('Antigravity running -> idle + turnEnded completion flow emits a completion event', { skip: !sqlite }, async (t) => {
  const fixture = createSummaryFixture(t);
  const t0 = Date.parse('2026-11-21T06:00:00.000Z');
  const t1 = t0 + 3000;
  const t2 = t0 + 6000;
  fixture.put.run('conv-1', 'Fix bug', '', null, '2026-11-21 06:00:00.000+00:00', 'CASCADE_RUN_STATUS_RUNNING', 1, 0, '', '');

  const events = [];
  const tracker = createSessionCompletionTracker({
    debounceMs: 0,
    clients: ['antigravity'],
    onCompletion: (event) => events.push(event)
  });

  const baseDevice = (session) => ({
    devices: [{
      deviceId: 'dev-1',
      hostname: 'linux-host',
      updatedAt: new Date(t0).toISOString(),
      stale: false,
      periods: {
        today: { sessions: { 'antigravity:conv-1': session } },
        month: { sessions: { 'antigravity:conv-1': session } }
      }
    }]
  });

  // Baseline snapshot while idle at t0 - 1000 is silent, then active running arms tracker at t0.
  const act0 = await readSummaryActivity({
    today: { sessions: { 'antigravity:conv-1': { client: 'antigravity', sessionId: 'conv-1', lastUsedAt: new Date(t0 - 1000).toISOString() } } },
    month: { sessions: {} },
    allTime: { sessions: {} }
  }, { homeDir: fixture.home, env: {}, sqlite, now: t0 });

  const runningSummary = materializeActivity(projectActivity({
    updatedAt: new Date(t0).toISOString(),
    today: {
      sessions: {
        'antigravity:conv-1': {
          client: 'antigravity',
          sessionId: 'conv-1',
          title: 'Fix bug',
          totalTokens: 100,
          inputTokens: 80,
          outputTokens: 20,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          costUsd: 0.001,
          messageCount: 1,
          lastUsedAt: new Date(t0 - 500).toISOString(),
          turnEnded: false
        }
      }
    },
    month: { sessions: {} },
    allTime: { sessions: {} }
  }, act0, t0));

  tracker.accept(baseDevice(runningSummary.today.sessions['antigravity:conv-1']), t0);
  assert.equal(events.length, 0);

  // Transition to IDLE + turnEnded: true fires completion.
  fixture.put.run('conv-1', 'Fix bug', '', null, '2026-11-21 06:00:05.000+00:00', 'CASCADE_RUN_STATUS_IDLE', 0, 0, '', '');
  const act1 = await readSummaryActivity(runningSummary, { homeDir: fixture.home, env: {}, sqlite, now: t1 });
  const idleSummary = materializeActivity(projectActivity({
    ...runningSummary,
    updatedAt: new Date(t1).toISOString(),
    today: {
      sessions: {
        'antigravity:conv-1': {
          ...runningSummary.today.sessions['antigravity:conv-1'],
          totalTokens: 500,
          inputTokens: 300,
          outputTokens: 200,
          costUsd: 0.01,
          messageCount: 2,
          lastUsedAt: new Date(t1 - 100).toISOString(),
          turnEnded: true
        }
      }
    }
  }, act1, t1));

  tracker.accept({
    devices: [{
      deviceId: 'dev-1',
      hostname: 'linux-host',
      updatedAt: new Date(t2).toISOString(),
      stale: false,
      periods: {
        today: { sessions: { 'antigravity:conv-1': idleSummary.today.sessions['antigravity:conv-1'] } },
        month: { sessions: { 'antigravity:conv-1': idleSummary.today.sessions['antigravity:conv-1'] } }
      }
    }]
  }, t2);

  assert.equal(events.length, 1);
  assert.equal(events[0].client, 'antigravity');
  assert.equal(events[0].sessionId, 'conv-1');
  assert.equal(events[0].turnDelta.totalTokens, 400);
});
