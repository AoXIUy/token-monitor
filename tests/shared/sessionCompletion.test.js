'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  DEFAULT_DEBOUNCE_MS,
  LIVE_ACTIVITY_TTL_MS,
  MAX_END_AGE_MS,
  MAX_GAP_MS,
  MAX_SESSIONS,
  createSessionCompletionTracker,
  extractCompletionObservations,
  sessionCompletionEventId
} = require('../../src/shared/sessionCompletion');

const BASE_NOW = Date.parse('2026-11-17T10:00:00.000Z');

function iso(ms) {
  return new Date(ms).toISOString();
}

function makeSession(overrides = {}) {
  return {
    client: 'codex',
    sessionId: 'sess-1',
    title: 'Fix completion tracker',
    projectLabel: 'token-monitor',
    startedAt: iso(BASE_NOW - 300_000),
    lastUsedAt: iso(BASE_NOW - 1000),
    totalTokens: 1000,
    inputTokens: 600,
    outputTokens: 200,
    cacheReadTokens: 150,
    cacheWriteTokens: 50,
    costUsd: 0.025,
    messageCount: 4,
    contextTokens: 50_000,
    contextWindow: 200_000,
    ...overrides
  };
}

function makeDevice(deviceId, sessions, overrides = {}) {
  const period = overrides.periodData || { sessions };
  return {
    deviceId,
    hostname: `${deviceId}.local`,
    updatedAt: iso(overrides.now ?? BASE_NOW),
    stale: false,
    periodWindows: {
      today: { key: '2026-11-17', endsAt: iso(BASE_NOW + 3_600_000) },
      month: { key: '2026-11', endsAt: iso(BASE_NOW + 86_400_000) }
    },
    periods: overrides.periods || {
      month: period,
      today: period
    },
    ...overrides
  };
}

function makeStats(devices) {
  return { devices: Array.isArray(devices) ? devices : [devices] };
}

function createFakeTimers() {
  let nextId = 1;
  const timers = new Map();
  const cleared = [];

  function setTimer(fn, ms) {
    const id = nextId++;
    timers.set(id, { id, fn, ms });
    return id;
  }

  function clearTimer(id) {
    cleared.push(id);
    timers.delete(id);
  }

  function fire(id) {
    const entry = timers.get(id);
    if (!entry) return false;
    timers.delete(id);
    entry.fn();
    return true;
  }

  function fireAll() {
    for (const id of Array.from(timers.keys())) {
      fire(id);
    }
  }

  return {
    setTimer,
    clearTimer,
    timers,
    cleared,
    fire,
    fireAll
  };
}

test('exports required constants and stays pure Node CommonJS outside worker/', () => {
  assert.equal(MAX_GAP_MS, 120_000);
  assert.equal(MAX_END_AGE_MS, 600_000);
  assert.equal(MAX_SESSIONS, 2048);
  assert.equal(DEFAULT_DEBOUNCE_MS, 2500);
  assert.equal(LIVE_ACTIVITY_TTL_MS, 30_000);

  const workerCopy = path.join(__dirname, '..', '..', 'worker', 'src', 'shared', 'sessionCompletion.js');
  assert.equal(fs.existsSync(workerCopy), false);

  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'shared', 'sessionCompletion.js'), 'utf8');
  assert.match(source, /^\/\/ @ts-check/);
  assert.doesNotMatch(source, /require\(['"]electron['"]\)/);
});

test('sessionCompletionEventId is deterministic across timestamp formats and differentiates inputs', () => {
  const ts = BASE_NOW - 1000;
  const fromMs = sessionCompletionEventId('dev-a', 'codex:sess-1', ts);
  const fromIso = sessionCompletionEventId('dev-a', 'codex:sess-1', iso(ts));
  const fromNoMillisIso = sessionCompletionEventId('dev-a', 'codex:sess-1', iso(ts).replace('.000Z', 'Z'));
  const fromDate = sessionCompletionEventId('dev-a', 'codex:sess-1', new Date(ts));

  assert.equal(fromMs.length, 64);
  assert.match(fromMs, /^[0-9a-f]{64}$/);
  assert.equal(fromMs, fromIso);
  assert.equal(fromMs, fromNoMillisIso);
  assert.equal(fromMs, fromDate);

  assert.notEqual(fromMs, sessionCompletionEventId('dev-b', 'codex:sess-1', ts));
  assert.notEqual(fromMs, sessionCompletionEventId('dev-a', 'codex:sess-2', ts));
  assert.notEqual(fromMs, sessionCompletionEventId('dev-a', 'codex:sess-1', ts + 1));
});

test('extractCompletionObservations skips stale devices, expired windows, archived/deleted, future/missing timestamps', () => {
  const stale = makeDevice('stale-dev', { 'codex:a': makeSession({ sessionId: 'a', turnEnded: true }) }, { stale: true });
  const expiredAll = makeDevice('expired-dev', { 'codex:b': makeSession({ sessionId: 'b', turnEnded: true }) }, {
    periodWindows: {
      today: { endsAt: iso(BASE_NOW) },
      month: { endsAt: iso(BASE_NOW - 1) }
    }
  });
  const expiredTodayOnly = makeDevice('partial-dev', {}, {
    periodWindows: {
      today: { endsAt: iso(BASE_NOW - 1) },
      month: { endsAt: iso(BASE_NOW + 60_000) }
    },
    periods: {
      month: { sessions: { 'codex:m': makeSession({ sessionId: 'm', turnEnded: true }) } },
      today: { sessions: { 'codex:t': makeSession({ sessionId: 't', turnEnded: true }) } }
    }
  });
  const badSessions = makeDevice('pc', {
    'codex:arch': makeSession({ sessionId: 'arch', archived: true, turnEnded: true }),
    'codex:del': makeSession({ sessionId: 'del', deleted: true, turnEnded: true }),
    'codex:sdel': makeSession({ sessionId: 'sdel', sourceDeleted: true, turnEnded: true }),
    'codex:missing': makeSession({ sessionId: 'missing', lastUsedAt: '', turnEnded: true }),
    'codex:future': makeSession({ sessionId: 'future', lastUsedAt: iso(BASE_NOW + 1), turnEnded: true }),
    'codex:old': makeSession({ sessionId: 'old', lastUsedAt: iso(BASE_NOW - MAX_END_AGE_MS - 1), turnEnded: true })
  });

  const rows = extractCompletionObservations(makeStats([stale, expiredAll, expiredTodayOnly, badSessions]), BASE_NOW);
  assert.deepEqual(rows.map((r) => r.key), ['codex:m']);
});

test('extractCompletionObservations dedupes across month/today and devices (latest evidenceAt wins, ended wins tie)', () => {
  const older = makeDevice('old-pc', {
    'codex:s1': makeSession({ sessionId: 's1', lastUsedAt: iso(BASE_NOW - 10_000), turnEnded: false })
  });
  const newer = makeDevice('new-pc', {
    'codex:s1': makeSession({ sessionId: 's1', lastUsedAt: iso(BASE_NOW - 1000), turnEnded: true })
  });
  const crossDevice = extractCompletionObservations(makeStats([older, newer]), BASE_NOW);
  assert.equal(crossDevice.length, 1);
  assert.equal(crossDevice[0].deviceId, 'new-pc');
  assert.equal(crossDevice[0].ended, true);
  assert.equal(crossDevice[0].active, false);

  // Tie on evidenceAt: ended wins over non-ended; if tied on both, month stays ahead of today.
  const tieDevice = makeDevice('pc', {}, {
    periods: {
      month: {
        sessions: {
          'codex:tie1': makeSession({ sessionId: 'tie1', totalTokens: 5000, lastUsedAt: iso(BASE_NOW - 2000), turnEnded: false }),
          'codex:tie2': makeSession({ sessionId: 'tie2', totalTokens: 8000, lastUsedAt: iso(BASE_NOW - 2000), turnEnded: true })
        }
      },
      today: {
        sessions: {
          'codex:tie1': makeSession({ sessionId: 'tie1', totalTokens: 200, lastUsedAt: iso(BASE_NOW - 2000), turnEnded: true }),
          'codex:tie2': makeSession({ sessionId: 'tie2', totalTokens: 300, lastUsedAt: iso(BASE_NOW - 2000), turnEnded: true })
        }
      }
    }
  });
  const tied = extractCompletionObservations(makeStats([tieDevice]), BASE_NOW);
  const byKey = new Map(tied.map((r) => [r.key, r]));
  assert.equal(byKey.get('codex:tie1').ended, true);
  assert.equal(byKey.get('codex:tie1').totalTokens, 200);
  assert.equal(byKey.get('codex:tie2').totalTokens, 8000);
});

test('extractCompletionObservations active arming rules and liveActivity TTL/overlay', () => {
  const dev = makeDevice('pc', {}, {
    periods: {
      month: { sessions: {} },
      today: {
        sessions: {
          'claude:live-run': makeSession({
            client: 'claude',
            sessionId: 'live-run',
            lastUsedAt: iso(BASE_NOW - MAX_END_AGE_MS - 60_000),
            turnEnded: true,
            liveActivity: { state: 'running', observedAt: iso(BASE_NOW - 1000) }
          }),
          'claude:live-wait': makeSession({
            client: 'claude',
            sessionId: 'live-wait',
            liveActivity: { state: 'waiting', observedAt: iso(BASE_NOW - 29_999) }
          }),
          'claude:live-expired': makeSession({
            client: 'claude',
            sessionId: 'live-expired',
            lastUsedAt: iso(BASE_NOW - MAX_END_AGE_MS - 1000),
            turnEnded: true,
            liveActivity: { state: 'running', observedAt: iso(BASE_NOW - LIVE_ACTIVITY_TTL_MS) }
          }),
          'claude:live-idle': makeSession({
            client: 'claude',
            sessionId: 'live-idle',
            turnEnded: false,
            liveActivity: { state: 'idle', observedAt: iso(BASE_NOW - 1000) }
          }),
          'codex:waiting-open': makeSession({
            client: 'codex',
            sessionId: 'waiting-open',
            waitingForInput: true
          }),
          'codex:waiting-ended': makeSession({
            client: 'codex',
            sessionId: 'waiting-ended',
            waitingForInput: true,
            turnEnded: true
          }),
          'opencode:open': makeSession({
            client: 'opencode',
            sessionId: 'open',
            turnEnded: false
          }),
          'opencode:no-boundary': makeSession({
            client: 'opencode',
            sessionId: 'no-boundary',
            waitingForInput: true
          }),
          'codex:overlay': makeSession({
            client: 'codex',
            sessionId: 'overlay',
            turnEnded: true
          })
        },
        sessionActivity: {
          'codex:overlay': { state: 'running', observedAt: iso(BASE_NOW - 500) }
        }
      }
    }
  });

  const rows = extractCompletionObservations(makeStats([dev]), BASE_NOW);
  const byKey = new Map(rows.map((r) => [r.key, r]));

  assert.equal(byKey.has('claude:live-expired'), false);

  const liveRun = byKey.get('claude:live-run');
  assert.equal(liveRun.active, true);
  assert.equal(liveRun.ended, false);
  assert.equal(liveRun.completionFloor, BASE_NOW - 1000);

  assert.equal(byKey.get('claude:live-wait').active, true);
  assert.equal(byKey.get('claude:live-idle').active, false);
  assert.equal(byKey.get('codex:waiting-open').active, true);
  assert.equal(byKey.get('codex:waiting-ended').active, false);
  assert.equal(byKey.get('codex:waiting-ended').ended, true);
  assert.equal(byKey.get('opencode:open').active, true);
  assert.equal(byKey.get('opencode:no-boundary').active, false);
  assert.equal(byKey.get('opencode:no-boundary').ended, false);
  assert.equal(byKey.get('codex:overlay').active, true);
});

test('tracker never emits on initial baseline snapshot or idle timeout alone, and emits rich completion with turnDelta', () => {
  const emittedEvents = [];
  const tracker = createSessionCompletionTracker({
    debounceMs: 0,
    onCompletion: (event) => emittedEvents.push(event)
  });

  // Initial baseline snapshot: ended session must NOT fire; already-active session arms.
  const t0 = BASE_NOW;
  const initOut = tracker.accept(makeStats(makeDevice('pc', {
    'codex:already-ended': makeSession({ sessionId: 'already-ended', turnEnded: true, lastUsedAt: iso(t0 - 1000) }),
    'claude:started-active': makeSession({
      client: 'claude',
      sessionId: 'started-active',
      title: 'Implement OAuth',
      projectLabel: 'auth-service',
      latestModel: 'claude-sonnet-4-6',
      models: { 'claude-haiku-4-5': 5000, 'claude-sonnet-4-6': 2000 },
      reasoningEffort: 'high',
      totalTokens: 1000,
      inputTokens: 500,
      outputTokens: 200,
      cacheReadTokens: 200,
      cacheWriteTokens: 100,
      costUsd: 0.02,
      messageCount: 2,
      contextTokens: 50_000,
      contextWindow: 200_000,
      lastUsedAt: iso(t0 - 2000),
      turnEnded: false
    }),
    'codex:idle-only': makeSession({
      client: 'codex',
      sessionId: 'idle-only',
      turnEnded: false,
      lastUsedAt: iso(t0 - 2000)
    })
  }, { now: t0 })), t0);

  assert.deepEqual(initOut, []);
  assert.equal(emittedEvents.length, 0);

  // Mid-turn active update for claude:started-active must keep original baseline counters (1000 tokens).
  const t1 = t0 + 10_000;
  assert.deepEqual(tracker.accept(makeStats(makeDevice('pc', {
    'codex:already-ended': makeSession({ sessionId: 'already-ended', turnEnded: true, lastUsedAt: iso(t0 - 1000) }),
    'claude:started-active': makeSession({
      client: 'claude',
      sessionId: 'started-active',
      title: 'Implement OAuth',
      projectLabel: 'auth-service',
      latestModel: 'claude-sonnet-4-6',
      models: { 'claude-haiku-4-5': 5000, 'claude-sonnet-4-6': 2500 },
      reasoningEffort: 'high',
      totalTokens: 1500,
      inputTokens: 700,
      outputTokens: 400,
      cacheReadTokens: 300,
      cacheWriteTokens: 100,
      costUsd: 0.035,
      messageCount: 3,
      lastUsedAt: iso(t1 - 1000),
      turnEnded: false
    }),
    // idle-only loses turnEnded:false without turnEnded:true -> never emits.
    'codex:idle-only': makeSession({
      client: 'codex',
      sessionId: 'idle-only',
      lastUsedAt: iso(t0 - 2000)
    })
  }, { now: t1 })), t1), []);

  // Completion tick: claude finishes turn, codex:idle-only stays without turnEnded:true.
  const t2 = t1 + 10_000;
  const endOut = tracker.accept(makeStats(makeDevice('pc', {
    'codex:already-ended': makeSession({ sessionId: 'already-ended', turnEnded: true, lastUsedAt: iso(t0 - 1000) }),
    'claude:started-active': makeSession({
      client: 'claude',
      sessionId: 'started-active',
      title: 'Implement OAuth',
      projectLabel: 'auth-service',
      latestModel: 'claude-sonnet-4-6',
      models: { 'claude-haiku-4-5': 5000, 'claude-sonnet-4-6': 3000 },
      reasoningEffort: 'high',
      totalTokens: 2000,
      inputTokens: 900,
      outputTokens: 600,
      cacheReadTokens: 400,
      cacheWriteTokens: 100,
      costUsd: 0.05,
      messageCount: 4,
      contextTokens: 80_000,
      contextWindow: 200_000,
      lastUsedAt: iso(t2 - 500),
      turnEnded: true
    }),
    'codex:idle-only': makeSession({
      client: 'codex',
      sessionId: 'idle-only',
      lastUsedAt: iso(t0 - 2000),
      liveActivity: { state: 'idle', observedAt: iso(t2 - 500) }
    })
  }, { now: t2 })), t2);

  assert.equal(endOut.length, 1);
  assert.equal(emittedEvents.length, 1);
  const ev = endOut[0];
  assert.equal(ev.eventId, sessionCompletionEventId('pc', 'claude:started-active', t2 - 500));
  assert.equal(ev.deviceId, 'pc');
  assert.equal(ev.deviceName, 'pc.local');
  assert.equal(ev.key, 'claude:started-active');
  assert.equal(ev.client, 'claude');
  assert.equal(ev.sessionId, 'started-active');
  assert.equal(ev.title, 'Implement OAuth');
  assert.equal(ev.label, 'Implement OAuth');
  assert.equal(ev.projectLabel, 'auth-service');
  assert.equal(ev.model, 'claude-sonnet-4-6');
  assert.equal(ev.reasoningEffort, 'high');
  assert.equal(ev.totalTokens, 2000);
  assert.equal(ev.costUsd, 0.05);
  assert.equal(ev.cacheHitRatePct, 28.57);
  assert.equal(ev.contextTokens, 80_000);
  assert.equal(ev.contextWindow, 200_000);
  assert.equal(ev.contextPercentLeft, 60);
  assert.equal(ev.messageCount, 4);
  assert.equal(ev.startedAt, iso(BASE_NOW - 300_000));
  assert.equal(ev.lastUsedAt, iso(t2 - 500));
  assert.equal(ev.sessionKind, null);
  assert.equal(ev.parentSessionId, null);
  assert.deepEqual(ev.turnDelta, {
    totalTokens: 1000,
    inputTokens: 400,
    outputTokens: 400,
    cacheReadTokens: 200,
    cacheWriteTokens: 0,
    costUsd: 0.03,
    messageCount: 2
  });

  // Repeated snapshot with same lastUsedAt must not re-emit.
  const t3 = t2 + 5000;
  assert.deepEqual(tracker.accept(makeStats(makeDevice('pc', {
    'claude:started-active': makeSession({
      client: 'claude',
      sessionId: 'started-active',
      totalTokens: 2000,
      lastUsedAt: iso(t2 - 500),
      turnEnded: true
    })
  }, { now: t3 })), t3), []);
});

test('model falls back to top model from models map, ignoring <synthetic>, and handles missing context', () => {
  const tracker = createSessionCompletionTracker({ debounceMs: 0 });
  const t0 = BASE_NOW;
  tracker.accept(makeStats(makeDevice('pc', {
    'codex:m1': makeSession({
      sessionId: 'm1',
      models: { '<synthetic>': 99_999, 'gpt-5.3-codex': 400, 'gpt-5.4': 900 },
      contextTokens: 0,
      contextWindow: 0,
      turnEnded: false,
      lastUsedAt: iso(t0 - 1000)
    })
  }, { now: t0 })), t0);

  const t1 = t0 + 3000;
  const [ev] = tracker.accept(makeStats(makeDevice('pc', {
    'codex:m1': makeSession({
      sessionId: 'm1',
      models: { '<synthetic>': 99_999, 'gpt-5.3-codex': 400, 'gpt-5.4': 1400 },
      contextTokens: 0,
      contextWindow: 0,
      turnEnded: true,
      lastUsedAt: iso(t1 - 500)
    })
  }, { now: t1 })), t1);

  assert.equal(ev.model, 'gpt-5.4');
  assert.equal(ev.contextPercentLeft, null);
});

test('turnDelta is null when baseline/completion counters are missing, regressed, or startedAt changed', () => {
  const tracker = createSessionCompletionTracker({ debounceMs: 0 });
  const t0 = BASE_NOW;

  tracker.accept(makeStats(makeDevice('pc', {
    'codex:missing': { client: 'codex', sessionId: 'missing', lastUsedAt: iso(t0 - 1000), turnEnded: false },
    'codex:regressed': makeSession({ sessionId: 'regressed', totalTokens: 500, lastUsedAt: iso(t0 - 1000), turnEnded: false }),
    'codex:restarted': makeSession({ sessionId: 'restarted', totalTokens: 500, startedAt: iso(t0 - 50_000), lastUsedAt: iso(t0 - 1000), turnEnded: false })
  }, { now: t0 })), t0);

  const t1 = t0 + 5000;
  const out = tracker.accept(makeStats(makeDevice('pc', {
    'codex:missing': { client: 'codex', sessionId: 'missing', lastUsedAt: iso(t1 - 100), turnEnded: true },
    'codex:regressed': makeSession({ sessionId: 'regressed', totalTokens: 400, lastUsedAt: iso(t1 - 100), turnEnded: true }),
    'codex:restarted': makeSession({ sessionId: 'restarted', totalTokens: 800, startedAt: iso(t0), lastUsedAt: iso(t1 - 100), turnEnded: true })
  }, { now: t1 })), t1);

  assert.equal(out.length, 3);
  for (const ev of out) assert.equal(ev.turnDelta, null);
});

test('floor blocks stale turnEnded and monotonic endedAt requires newer lastUsedAt on subsequent turn', () => {
  const tracker = createSessionCompletionTracker({ debounceMs: 0 });
  const t0 = BASE_NOW;

  // Turn 1 ends at t0 - 5000 (armed first via active, then ended)
  tracker.accept(makeStats(makeDevice('pc', {
    'codex:s': makeSession({ sessionId: 's', totalTokens: 100, lastUsedAt: iso(t0 - 10_000), turnEnded: false })
  }, { now: t0 })), t0);

  const t1 = t0 + 1000;
  const first = tracker.accept(makeStats(makeDevice('pc', {
    'codex:s': makeSession({ sessionId: 's', totalTokens: 200, lastUsedAt: iso(t0 - 5000), turnEnded: true })
  }, { now: t1 })), t1);
  assert.equal(first.length, 1);

  // Turn 2 starts with liveActivity while lastUsedAt is still t0 - 5000, and old turnEnded:true lingers.
  const t2 = t1 + 2000;
  assert.deepEqual(tracker.accept(makeStats(makeDevice('pc', {
    'codex:s': makeSession({
      sessionId: 's',
      totalTokens: 200,
      lastUsedAt: iso(t0 - 5000),
      turnEnded: true,
      liveActivity: { state: 'running', observedAt: iso(t2 - 500) }
    })
  }, { now: t2 })), t2), []);

  // liveActivity expires (30s later) while lastUsedAt is STILL t0 - 5000 (< floor t2 - 500): must NOT disarm or emit!
  const t3 = t2 + LIVE_ACTIVITY_TTL_MS + 1000;
  assert.deepEqual(tracker.accept(makeStats(makeDevice('pc', {
    'codex:s': makeSession({
      sessionId: 's',
      totalTokens: 200,
      lastUsedAt: iso(t0 - 5000),
      turnEnded: true
    })
  }, { now: t3 })), t3), []);

  // Finally Turn 2 writes transcript end with new lastUsedAt >= floor.
  const t4 = t3 + 2000;
  const second = tracker.accept(makeStats(makeDevice('pc', {
    'codex:s': makeSession({
      sessionId: 's',
      totalTokens: 350,
      lastUsedAt: iso(t4 - 200),
      turnEnded: true
    })
  }, { now: t4 })), t4);
  assert.equal(second.length, 1);
  assert.equal(second[0].turnDelta.totalTokens, 150);
});

test('gap > MAX_GAP_MS resets arming state without re-emitting deduped eventIds', () => {
  const tracker = createSessionCompletionTracker({ debounceMs: 0 });
  const t0 = BASE_NOW;

  tracker.accept(makeStats(makeDevice('pc', {
    'codex:a': makeSession({ sessionId: 'a', lastUsedAt: iso(t0 - 2000), turnEnded: false })
  }, { now: t0 })), t0);

  const t1 = t0 + 5000;
  const out1 = tracker.accept(makeStats(makeDevice('pc', {
    'codex:a': makeSession({ sessionId: 'a', lastUsedAt: iso(t1 - 500), turnEnded: true })
  }, { now: t1 })), t1);
  assert.equal(out1.length, 1);

  // Gap > MAX_GAP_MS: treated as new baseline; old ended session does not emit.
  const t2 = t1 + MAX_GAP_MS + 1;
  assert.deepEqual(tracker.accept(makeStats(makeDevice('pc', {
    'codex:a': makeSession({ sessionId: 'a', lastUsedAt: iso(t1 - 500), turnEnded: true }),
    'codex:b': makeSession({ sessionId: 'b', lastUsedAt: iso(t2 - 500), turnEnded: true })
  }, { now: t2 })), t2), []);

  // Even if 'codex:a' re-arms and somehow produces the exact same lastUsedAt (deduped eventId), it cannot re-emit.
  const t3 = t2 + 2000;
  tracker.accept(makeStats(makeDevice('pc', {
    'codex:a': makeSession({
      sessionId: 'a',
      lastUsedAt: iso(t1 - 500),
      liveActivity: { state: 'running', observedAt: iso(t3 - 100) }
    })
  }, { now: t3 })), t3);
  const t4 = t3 + 2000;
  assert.deepEqual(tracker.accept(makeStats(makeDevice('pc', {
    'codex:a': makeSession({ sessionId: 'a', lastUsedAt: iso(t1 - 500), turnEnded: true })
  }, { now: t4 })), t4), []);
});

test('debounce settle window cancels on re-arm and supports flush() and stop()', () => {
  const timers = createFakeTimers();
  const emitted = [];
  const tracker = createSessionCompletionTracker({
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    onCompletion: (ev) => emitted.push(ev)
  });

  const t0 = BASE_NOW;
  tracker.observe(makeStats(makeDevice('pc', {
    'codex:s1': makeSession({ sessionId: 's1', totalTokens: 100, lastUsedAt: iso(t0 - 1000), turnEnded: false }),
    'codex:s2': makeSession({ sessionId: 's2', totalTokens: 100, lastUsedAt: iso(t0 - 1000), turnEnded: false })
  }, { now: t0 })), t0);

  // Both complete at t1 -> timers scheduled for 2500ms, nothing emitted yet.
  const t1 = t0 + 2000;
  assert.deepEqual(tracker.observe(makeStats(makeDevice('pc', {
    'codex:s1': makeSession({ sessionId: 's1', totalTokens: 200, lastUsedAt: iso(t1 - 500), turnEnded: true }),
    'codex:s2': makeSession({ sessionId: 's2', totalTokens: 250, lastUsedAt: iso(t1 - 500), turnEnded: true })
  }, { now: t1 })), t1), []);
  assert.equal(timers.timers.size, 2);
  assert.equal(emitted.length, 0);
  const timerEntries = Array.from(timers.timers.values());
  assert.equal(timerEntries[0].ms, DEFAULT_DEBOUNCE_MS);

  // s1 re-arms active before timer fires -> s1 timer is cancelled.
  const t2 = t1 + 1000;
  tracker.observe(makeStats(makeDevice('pc', {
    'codex:s1': makeSession({ sessionId: 's1', totalTokens: 250, lastUsedAt: iso(t2 - 200), turnEnded: false }),
    'codex:s2': makeSession({ sessionId: 's2', totalTokens: 250, lastUsedAt: iso(t1 - 500), turnEnded: true })
  }, { now: t2 })), t2);
  assert.equal(timers.timers.size, 1);
  assert.equal(timers.cleared.length, 1);

  // Timer fires for s2 -> s2 emits; s1 was cancelled.
  timers.fireAll();
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].sessionId, 's2');

  // s1 completes again, then flush() emits immediately and clears its timer.
  const t3 = t2 + 1000;
  tracker.observe(makeStats(makeDevice('pc', {
    'codex:s1': makeSession({ sessionId: 's1', totalTokens: 400, lastUsedAt: iso(t3 - 100), turnEnded: true })
  }, { now: t3 })), t3);
  assert.equal(timers.timers.size, 1);
  const flushed = tracker.flush(t3);
  assert.equal(flushed.length, 1);
  assert.equal(flushed[0].sessionId, 's1');
  assert.equal(flushed[0].turnDelta.totalTokens, 150);
  assert.equal(timers.timers.size, 0);
  assert.equal(emitted.length, 2);

  // Pending timer cleared without emission on stop().
  const t4 = t3 + 1000;
  tracker.observe(makeStats(makeDevice('pc', {
    'codex:s1': makeSession({ sessionId: 's1', totalTokens: 400, lastUsedAt: iso(t4 - 100), turnEnded: false })
  }, { now: t4 })), t4);
  const t5 = t4 + 1000;
  tracker.observe(makeStats(makeDevice('pc', {
    'codex:s1': makeSession({ sessionId: 's1', totalTokens: 500, lastUsedAt: iso(t5 - 100), turnEnded: true })
  }, { now: t5 })), t5);
  assert.equal(timers.timers.size, 1);
  tracker.stop();
  assert.equal(timers.timers.size, 0);
  assert.equal(emitted.length, 2);
  assert.deepEqual(tracker.flush(), []);
});

test('filters (clients, excludeSubagents, excludeBackgroundReview, minTurnTokens, minTotalTokens, cooldownMs, sessionTitlesEnabled)', () => {
  const t0 = BASE_NOW;
  const activeStats = (now) => makeStats(makeDevice('pc', {
    'codex:main': makeSession({
      client: 'codex',
      sessionId: 'main',
      title: 'Secret Prompt Title',
      projectLabel: 'secret-proj',
      totalTokens: 1000,
      lastUsedAt: iso(now - 500),
      turnEnded: false
    }),
    'claude:sub': makeSession({
      client: 'claude',
      sessionId: 'sub',
      parentSessionId: 'main',
      totalTokens: 1000,
      lastUsedAt: iso(now - 500),
      turnEnded: false
    }),
    'codex:review': makeSession({
      client: 'codex',
      sessionId: 'review',
      sessionKind: 'background-review',
      totalTokens: 1000,
      lastUsedAt: iso(now - 500),
      turnEnded: false
    }),
    'codex:tiny': makeSession({
      client: 'codex',
      sessionId: 'tiny',
      totalTokens: 200,
      lastUsedAt: iso(now - 500),
      turnEnded: false
    }),
    'opencode:other': makeSession({
      client: 'opencode',
      sessionId: 'other',
      totalTokens: 5000,
      lastUsedAt: iso(now - 500),
      turnEnded: false
    })
  }, { now }));

  const endedStats = (now, bump = 500) => makeStats(makeDevice('pc', {
    'codex:main': makeSession({
      client: 'codex',
      sessionId: 'main',
      title: 'Secret Prompt Title',
      projectLabel: 'secret-proj',
      totalTokens: 1000 + bump,
      lastUsedAt: iso(now - 100),
      turnEnded: true
    }),
    'claude:sub': makeSession({
      client: 'claude',
      sessionId: 'sub',
      parentSessionId: 'main',
      totalTokens: 1000 + bump,
      lastUsedAt: iso(now - 100),
      turnEnded: true
    }),
    'codex:review': makeSession({
      client: 'codex',
      sessionId: 'review',
      sessionKind: 'background-review',
      totalTokens: 1000 + bump,
      lastUsedAt: iso(now - 100),
      turnEnded: true
    }),
    'codex:tiny': makeSession({
      client: 'codex',
      sessionId: 'tiny',
      totalTokens: 200 + 20,
      lastUsedAt: iso(now - 100),
      turnEnded: true
    }),
    'opencode:other': makeSession({
      client: 'opencode',
      sessionId: 'other',
      totalTokens: 5000 + bump,
      lastUsedAt: iso(now - 100),
      turnEnded: true
    })
  }, { now }));

  const filteredTracker = createSessionCompletionTracker({
    debounceMs: 0,
    clients: ['codex', 'claude'],
    excludeSubagents: true,
    excludeBackgroundReview: true,
    minTurnTokens: 100,
    minTotalTokens: 1200,
    cooldownMs: 30_000,
    sessionTitlesEnabled: false
  });

  filteredTracker.accept(activeStats(t0), t0);
  const t1 = t0 + 5000;
  const out1 = filteredTracker.accept(endedStats(t1, 500), t1);
  assert.equal(out1.length, 1);
  assert.equal(out1[0].key, 'codex:main');
  assert.equal(out1[0].title, null);
  assert.equal(out1[0].label, 'secret-proj');

  // Cooldown blocks rapid second turn on codex:main within 30s
  const t2 = t1 + 5000;
  filteredTracker.accept(makeStats(makeDevice('pc', {
    'codex:main': makeSession({ sessionId: 'main', totalTokens: 1500, lastUsedAt: iso(t2 - 200), turnEnded: false })
  }, { now: t2 })), t2);
  const t3 = t2 + 5000;
  assert.deepEqual(filteredTracker.accept(makeStats(makeDevice('pc', {
    'codex:main': makeSession({ sessionId: 'main', totalTokens: 2500, lastUsedAt: iso(t3 - 100), turnEnded: true })
  }, { now: t3 })), t3), []);

  // After cooldown expires, codex:main emits again
  const t4 = t1 + 31_000;
  filteredTracker.accept(makeStats(makeDevice('pc', {
    'codex:main': makeSession({ sessionId: 'main', totalTokens: 2500, lastUsedAt: iso(t4 - 200), turnEnded: false })
  }, { now: t4 })), t4);
  const t5 = t4 + 5000;
  const out2 = filteredTracker.accept(makeStats(makeDevice('pc', {
    'codex:main': makeSession({ sessionId: 'main', totalTokens: 3100, lastUsedAt: iso(t5 - 100), turnEnded: true })
  }, { now: t5 })), t5);
  assert.equal(out2.length, 1);
  assert.equal(out2[0].turnDelta.totalTokens, 600);

  // Permitting subagents + background reviews + empty projectLabel title fallback
  const permissiveTracker = createSessionCompletionTracker({
    debounceMs: 0,
    excludeSubagents: false,
    excludeBackgroundReview: false,
    sessionTitlesEnabled: false
  });
  permissiveTracker.accept(makeStats(makeDevice('pc', {
    'claude:sub': makeSession({ client: 'claude', sessionId: 'sub', parentSessionId: 'main', title: 'Hidden', projectLabel: '', lastUsedAt: iso(t0 - 100), turnEnded: false }),
    'codex:review': makeSession({ client: 'codex', sessionId: 'review', sessionKind: 'background-review', title: 'Review', projectLabel: '', lastUsedAt: iso(t0 - 100), turnEnded: false })
  }, { now: t0 })), t0);
  const out3 = permissiveTracker.accept(makeStats(makeDevice('pc', {
    'claude:sub': makeSession({ client: 'claude', sessionId: 'sub', parentSessionId: 'main', title: 'Hidden', projectLabel: '', lastUsedAt: iso(t1 - 50), turnEnded: true }),
    'codex:review': makeSession({ client: 'codex', sessionId: 'review', sessionKind: 'background-review', title: 'Review', projectLabel: '', lastUsedAt: iso(t1 - 50), turnEnded: true })
  }, { now: t1 })), t1);
  assert.equal(out3.length, 2);
  assert.equal(out3[0].title, null);
  assert.equal(out3[0].label, 'sub');
});

test('bounded recent eventId deduplication evicts oldest beyond maxRecentEvents', () => {
  const tracker = createSessionCompletionTracker({ debounceMs: 0, maxRecentEvents: 2 });
  const t0 = BASE_NOW;

  const fireTurn = (step, key) => {
    const sessId = key.split(':')[1];
    const start = t0 + step * 10_000;
    const end = start + 5000;
    tracker.accept(makeStats(makeDevice('pc', {
      [key]: makeSession({ sessionId: sessId, lastUsedAt: iso(start), turnEnded: false })
    }, { now: start })), start);
    return tracker.accept(makeStats(makeDevice('pc', {
      [key]: makeSession({ sessionId: sessId, lastUsedAt: iso(end), turnEnded: true })
    }, { now: end })), end);
  };

  assert.equal(fireTurn(0, 'codex:s1').length, 1);
  assert.equal(fireTurn(1, 'codex:s2').length, 1);
  assert.equal(fireTurn(2, 'codex:s3').length, 1);

  // s2 and s3 remain deduped across a gap reset; s1 (evicted) is no longer in recentEventIds.
  const afterGap = t0 + 30_000 + MAX_GAP_MS + 1000;
  tracker.accept(makeStats(makeDevice('pc', {
    'codex:s2': makeSession({ sessionId: 's2', lastUsedAt: iso(t0 + 15_000), turnEnded: false }),
    'codex:s1': makeSession({ sessionId: 's1', lastUsedAt: iso(t0 + 5000), turnEnded: false })
  }, { now: afterGap })), afterGap);

  const replayAt = afterGap + 5000;
  const replayed = tracker.accept(makeStats(makeDevice('pc', {
    'codex:s2': makeSession({ sessionId: 's2', lastUsedAt: iso(t0 + 15_000), turnEnded: true }),
    'codex:s1': makeSession({ sessionId: 's1', lastUsedAt: iso(t0 + 5000), turnEnded: true })
  }, { now: replayAt })), replayAt);

  assert.deepEqual(replayed.map((e) => e.sessionId), ['s1']);
});

test('cancelled debounced completion does not consume cooldown and supports raw observations, updateOptions, and reset', () => {
  const timers = createFakeTimers();
  const emitted = [];
  const tracker = createSessionCompletionTracker({
    debounceMs: 2500,
    cooldownMs: 10_000,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    onCompletion: (ev) => emitted.push(ev)
  });

  const t0 = BASE_NOW;
  tracker.accept(extractCompletionObservations(makeStats(makeDevice('pc', {
    'codex:c1': makeSession({ sessionId: 'c1', totalTokens: 100, lastUsedAt: iso(t0 - 100), turnEnded: false })
  }, { now: t0 })), t0), t0);

  // Turn 1 ends -> pending timer scheduled, then cancelled by re-arming active.
  const t1 = t0 + 1000;
  tracker.accept(extractCompletionObservations(makeStats(makeDevice('pc', {
    'codex:c1': makeSession({ sessionId: 'c1', totalTokens: 200, lastUsedAt: iso(t1 - 50), turnEnded: true })
  }, { now: t1 })), t1), t1);
  assert.equal(timers.timers.size, 1);

  const t2 = t1 + 500;
  tracker.accept(extractCompletionObservations(makeStats(makeDevice('pc', {
    'codex:c1': makeSession({ sessionId: 'c1', totalTokens: 250, lastUsedAt: iso(t2 - 50), turnEnded: false })
  }, { now: t2 })), t2), t2);
  assert.equal(timers.timers.size, 0);

  // Turn 2 ends immediately after -> NOT blocked by cooldown because Turn 1 never emitted.
  const t3 = t2 + 1000;
  tracker.accept(extractCompletionObservations(makeStats(makeDevice('pc', {
    'codex:c1': makeSession({ sessionId: 'c1', totalTokens: 400, lastUsedAt: iso(t3 - 50), turnEnded: true })
  }, { now: t3 })), t3), t3);
  timers.fireAll();
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].turnDelta.totalTokens, 150);

  // Turn 3 ends inside cooldown (emitAt = t4 + 2500 = t3 + 6500, within 10s of t3 + 2500): suppressed.
  const t4 = t3 + 4000;
  tracker.accept(makeStats(makeDevice('pc', {
    'codex:c1': makeSession({ sessionId: 'c1', totalTokens: 400, lastUsedAt: iso(t4 - 100), turnEnded: false })
  }, { now: t4 })), t4);
  const t5 = t4 + 1000;
  tracker.accept(makeStats(makeDevice('pc', {
    'codex:c1': makeSession({ sessionId: 'c1', totalTokens: 600, lastUsedAt: iso(t5 - 50), turnEnded: true })
  }, { now: t5 })), t5);
  timers.fireAll();
  assert.equal(emitted.length, 1);

  // updateOptions changes debounceMs to 0 and reset() clears cooldown + dedup history.
  tracker.updateOptions({ debounceMs: 0, cooldownMs: 0 });
  tracker.reset();
  const t6 = t5 + 1000;
  tracker.accept(makeStats(makeDevice('pc', {
    'codex:c1': makeSession({ sessionId: 'c1', totalTokens: 600, lastUsedAt: iso(t6 - 100), turnEnded: false })
  }, { now: t6 })), t6);
  const t7 = t6 + 1000;
  const syncOut = tracker.accept(makeStats(makeDevice('pc', {
    'codex:c1': makeSession({ sessionId: 'c1', totalTokens: 800, lastUsedAt: iso(t7 - 50), turnEnded: true })
  }, { now: t7 })), t7);
  assert.equal(syncOut.length, 1);
  assert.equal(emitted.length, 2);
});

test('states map is bounded by MAX_SESSIONS (2048)', () => {
  const tracker = createSessionCompletionTracker({ debounceMs: 0 });
  const sessions = {};
  for (let i = 0; i < MAX_SESSIONS + 25; i++) {
    sessions[`codex:s-${i}`] = makeSession({
      sessionId: `s-${i}`,
      lastUsedAt: iso(BASE_NOW - 1000),
      turnEnded: false
    });
  }
  const t0 = BASE_NOW;
  tracker.accept(makeStats(makeDevice('pc', sessions, { now: t0 })), t0);

  const endedSessions = {};
  for (let i = 0; i < MAX_SESSIONS + 25; i++) {
    endedSessions[`codex:s-${i}`] = makeSession({
      sessionId: `s-${i}`,
      lastUsedAt: iso(t0 + 1000),
      turnEnded: true
    });
  }
  const t1 = t0 + 2000;
  const out = tracker.accept(makeStats(makeDevice('pc', endedSessions, { now: t1 })), t1);
  assert.equal(out.length, MAX_SESSIONS);
  assert.equal(out[0].sessionId, 's-25');
});
