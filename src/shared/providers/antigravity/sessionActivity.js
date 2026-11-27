'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readT3Activity } = require('../../t3/sessionActivity');
const { nativeAccountingId } = require('../../t3/sessionIdentity');
const {
  LIVE_ACTIVITY_TTL_MS,
  RUNNING_WINDOW_MS,
  isArchivedSession,
  liveActivityExpiryAt,
  sessionActivityState
} = require('../../sessionLive');
const {
  activityEntries,
  applyActivityPatch,
  hasKnownSession,
  projectNativeActivitySessions,
  rememberProjection
} = require('../../sessionActivityProjection');
const {
  antigravityConversationSummaryCandidates,
  antigravityTurnEndedFromRow,
  cleanTitle,
  projectFromWorkspaceUris,
  resolveSqlite
} = require('./sessionMetadata');

const CLIENT = 'antigravity';
const RENEW_INTERVAL_MS = 10_000;
const MAX_SESSIONS = 256;
const ACTIVE_FRESHNESS_WINDOW_MS = 30 * 60 * 1000;

let cachedProjectIdentity;
function getProjectIdentity() {
  if (!cachedProjectIdentity) {
    cachedProjectIdentity = require('../../sessionMetadata').projectIdentity;
  }
  return cachedProjectIdentity;
}

function parseSqliteTimestamp(value) {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) && ms > 0 ? ms : 0;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? msOrZero(value) : 0;
  }
  const raw = String(value || '').trim();
  if (!raw) return 0;
  if (/^\d+$/.test(raw)) {
    const ms = Number(raw);
    return Number.isFinite(ms) && ms > 0 ? ms : 0;
  }
  // Antigravity Go timestamps use space separator and up to nanosecond precision.
  const isoLike = raw
    .replace(/^(\d{4}-\d{2}-\d{2})\s+/, '$1T')
    .replace(/(\.\d{3})\d+(?=[+-Z]|$)/, '$1');
  const ms = Date.parse(isoLike);
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}

function msOrZero(value) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function readDbActivityRows(dbPath, sqlite, wantedIds, { discoverActive = false } = {}) {
  let db;
  try {
    db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
    try { db.exec('PRAGMA busy_timeout = 250'); } catch (_) {}

    const hasTable = Boolean(
      db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'conversation_summaries'").get()
    );
    if (!hasTable) return [];

    const columns = new Set(
      db.prepare('PRAGMA table_info(conversation_summaries)').all().map((column) => String(column.name))
    );
    if (!columns.has('conversation_id') || !columns.has('status')) return [];

    const optional = [
      'title',
      'preview',
      'workspace_uris',
      'last_modified_time',
      'parent_conversation_id',
      'agent_name',
      'not_fully_idle',
      'killed'
    ].filter((name) => columns.has(name));
    const selectCols = ['conversation_id', 'status', ...optional].join(', ');
    const rowsById = new Map();

    if (discoverActive) {
      const notKilled = columns.has('killed') ? ' AND (killed IS NULL OR killed = 0)' : '';
      const activeCond = columns.has('not_fully_idle')
        ? "(status IN ('CASCADE_RUN_STATUS_RUNNING', 'CASCADE_RUN_STATUS_BUSY', 'CASCADE_RUN_STATUS_CANCELING') OR not_fully_idle = 1)"
        : "status IN ('CASCADE_RUN_STATUS_RUNNING', 'CASCADE_RUN_STATUS_BUSY', 'CASCADE_RUN_STATUS_CANCELING')";
      const orderBy = columns.has('last_modified_time') ? ' ORDER BY last_modified_time DESC' : '';
      const activeRows = db.prepare(
        `SELECT ${selectCols} FROM conversation_summaries WHERE ${activeCond}${notKilled}${orderBy} LIMIT ?`
      ).all(MAX_SESSIONS);
      for (const row of activeRows) {
        const id = typeof row?.conversation_id === 'string' ? row.conversation_id.trim() : '';
        if (id) rowsById.set(id, row);
      }
    }

    const ids = [...(wantedIds || [])]
      .filter((id) => typeof id === 'string' && id && !rowsById.has(id))
      .slice(0, MAX_SESSIONS);
    if (ids.length > 0) {
      const placeholders = ids.map(() => '?').join(', ');
      const knownRows = db.prepare(
        `SELECT ${selectCols} FROM conversation_summaries WHERE conversation_id IN (${placeholders})`
      ).all(...ids);
      for (const row of knownRows) {
        const id = typeof row?.conversation_id === 'string' ? row.conversation_id.trim() : '';
        if (id) rowsById.set(id, row);
      }
    }

    return [...rowsById.entries()];
  } catch (_) {
    return [];
  } finally {
    try { db?.close(); } catch (_) {}
  }
}

function summaryState(row, clock, { forceIdleClock = false, allowIdle = false } = {}) {
  const turnEnded = antigravityTurnEndedFromRow(row);
  if (turnEnded === undefined) return null;
  const modifiedMs = parseSqliteTimestamp(row?.last_modified_time);
  if (turnEnded === false) {
    if (modifiedMs > 0 && clock - modifiedMs > ACTIVE_FRESHNESS_WINDOW_MS) return null;
    return {
      state: 'running',
      turnEnded: false,
      modifiedMs,
      observedAt: new Date(clock).toISOString()
    };
  }
  if (!allowIdle) return null;
  let observedAt;
  if (forceIdleClock) {
    observedAt = new Date(clock).toISOString();
  } else if (modifiedMs > 0 && modifiedMs <= clock && clock - modifiedMs < LIVE_ACTIVITY_TTL_MS) {
    observedAt = new Date(modifiedMs).toISOString();
  } else {
    observedAt = new Date(modifiedMs > 0 && modifiedMs <= clock ? modifiedMs : clock).toISOString();
  }
  return { state: 'idle', turnEnded: true, modifiedMs, observedAt };
}

function collectKnownStates(summary, clock) {
  const known = new Map();
  const periods = summary?.periods || summary;
  const checkRow = (session) => {
    if (!session || session.client !== CLIENT || !session.sessionId || isArchivedSession(session)) return;
    const id = session.sessionId;
    const withoutLease = sessionActivityState({ ...session, liveActivity: undefined }, clock);
    const needsIdleOverride = withoutLease === 'running'
      || withoutLease === 'waiting'
      || session.liveActivity?.state === 'running'
      || session.turnEnded === false;
    const prev = known.get(id);
    if (!prev || needsIdleOverride) {
      known.set(id, {
        needsIdleOverride: Boolean(prev?.needsIdleOverride || needsIdleOverride),
        lastUsedAt: session.lastUsedAt || prev?.lastUsedAt || ''
      });
    }
  };
  for (const { session } of activityEntries(summary, CLIENT, [], true)) {
    checkRow(session);
  }
  for (const periodName of ['today', 'month']) {
    for (const session of Object.values(periods?.[periodName]?.sessions || {})) {
      if (session?.client !== CLIENT) continue;
      const last = parseSqliteTimestamp(session.lastUsedAt);
      if (session.turnEnded === false || session.liveActivity?.state === 'running'
        || (last > 0 && clock - last <= RUNNING_WINDOW_MS)) {
        checkRow(session);
      }
    }
  }
  for (const session of Object.values(summary?.nativeSessions?.today || {})) {
    checkRow(session);
  }
  return known;
}

function localSummaryCandidates(options = {}) {
  const home = options.homeDir || os.homedir();
  const env = options.env || process.env;
  // T3 Code ACP live runs are validated against T3's own statev2.sqlite + server PID;
  // restrict direct catalog fast-lane polling to Desktop and CLI roots (excluding backup).
  return antigravityConversationSummaryCandidates({
    home,
    env,
    useEnvRoot: !options.scopedHome,
    antigravityAcpPaths: []
  }).filter((dbPath) => path.basename(path.dirname(dbPath)) !== 'antigravity-backup');
}

function collectSummaryRows(options, wantedIds, discoverActive) {
  const sqlite = resolveSqlite(options);
  if (typeof sqlite?.DatabaseSync !== 'function') return [];
  const candidates = localSummaryCandidates(options);
  const merged = new Map();
  for (const dbPath of candidates) {
    for (const [id, row] of readDbActivityRows(dbPath, sqlite, wantedIds, { discoverActive })) {
      const existing = merged.get(id);
      if (!existing) {
        merged.set(id, { dbPath, row, modifiedMs: parseSqliteTimestamp(row?.last_modified_time) });
        continue;
      }
      const nextMs = parseSqliteTimestamp(row?.last_modified_time);
      if (nextMs > existing.modifiedMs) {
        merged.set(id, { dbPath, row, modifiedMs: nextMs });
      }
    }
  }
  return [...merged.entries()].map(([id, entry]) => ({ id, ...entry }));
}

async function readSessionActivity(sessionIds, options = {}) {
  const result = new Map();
  if (sessionIds?.size === 0 || options.scopedHome) return result;
  const clock = Number(new Date(options.now ?? Date.now()));
  const entries = collectSummaryRows(options, sessionIds, !sessionIds);
  for (const { id, row } of entries) {
    const parsed = summaryState(row, clock, {
      allowIdle: Boolean(sessionIds?.has(id)),
      forceIdleClock: Boolean(sessionIds?.has(id))
    });
    if (!parsed) continue;
    result.set(id, { state: parsed.state, observedAt: parsed.observedAt });
  }
  return result;
}

async function readSummaryActivity(summary, options = {}) {
  const readings = new Map();
  const sessions = {};
  if (options.scopedHome) return { readings, sessions };
  const clock = Number(new Date(options.now ?? Date.now()));
  const known = collectKnownStates(summary, clock);
  const entries = collectSummaryRows(options, new Set(known.keys()), true);
  const resolveProjects = options.resolveProjects !== false;
  const projectIdentityFn = resolveProjects ? (options.projectIdentity || getProjectIdentity()) : null;

  for (const { id, dbPath, row } of entries) {
    const knownMeta = known.get(id);
    const parsed = summaryState(row, clock, {
      allowIdle: Boolean(knownMeta?.needsIdleOverride),
      forceIdleClock: Boolean(knownMeta?.needsIdleOverride)
    });
    if (!parsed) continue;
    const reading = { state: parsed.state, observedAt: parsed.observedAt };
    readings.set(id, reading);

    if (parsed.state !== 'running' || hasKnownSession(summary, CLIENT, id, 'today', false)) {
      continue;
    }
    const title = cleanTitle(row?.title) || cleanTitle(row?.preview) || cleanTitle(row?.agent_name);
    const parentSessionId = typeof row?.parent_conversation_id === 'string'
      ? row.parent_conversation_id.trim()
      : '';
    const identity = resolveProjects
      ? projectFromWorkspaceUris(row?.workspace_uris, {
          resolveProjects,
          projectIdentity: projectIdentityFn,
          deps: options
        })
      : null;
    let sessionDetailAvailable = false;
    try {
      const transcriptFile = path.join(path.dirname(dbPath), 'brain', id, '.system_generated', 'logs', 'transcript_full.jsonl');
      sessionDetailAvailable = fs.lstatSync(transcriptFile).isFile();
    } catch (_) {}
    const existingNative = summary?.nativeSessions?.today?.[`${CLIENT}:${id}`];
    sessions[`${CLIENT}:${id}`] = {
      client: CLIENT,
      sessionId: id,
      native: true,
      totalTokens: 0,
      costUsd: 0,
      models: {},
      tokenDataUnavailable: true,
      sessionDetailAvailable,
      ...(title ? { title } : {}),
      ...(parentSessionId && parentSessionId !== id ? { parentSessionId } : {}),
      ...(identity || {}),
      lastUsedAt: parsed.modifiedMs > 0 && parsed.modifiedMs <= clock
        ? new Date(parsed.modifiedMs).toISOString()
        : existingNative?.lastUsedAt || reading.observedAt,
      turnEnded: false,
      liveActivity: reading
    };
  }
  return { readings, sessions };
}

async function readActivity(summary, options = {}) {
  const [t3Readings, local] = await Promise.all([
    readT3Activity(options, CLIENT),
    readSummaryActivity(summary, options)
  ]);
  const readings = new Map(local.readings);
  const sessions = { ...local.sessions };
  for (const [sessionId, liveActivity] of t3Readings) {
    readings.set(sessionId, liveActivity);
    if (liveActivity.state !== 'running' || nativeAccountingId(CLIENT, sessionId) !== sessionId) continue;
    const key = `${CLIENT}:${sessionId}`;
    sessions[key] = sessions[key]
      ? { ...sessions[key], liveActivity }
      : {
          client: CLIENT,
          sessionId,
          native: true,
          totalTokens: 0,
          costUsd: 0,
          models: {},
          tokenDataUnavailable: true,
          lastUsedAt: summary?.nativeSessions?.today?.[key]?.lastUsedAt || liveActivity.observedAt,
          liveActivity
        };
  }
  return { readings, sessions };
}

function projectActivity(summary, { readings, sessions = {} }, now = Date.now()) {
  const observations = new Map();
  for (const { session } of activityEntries(summary, CLIENT, readings.keys())) {
    const { sessionId, liveActivity: previous } = session;
    if (observations.has(sessionId)) continue;
    const reading = readings.get(sessionId);
    // Keep permission and input prompts outside this adapter's running/idle
    // scope. In the absence of live evidence, restore the ordinary turn state.
    const hasLiveReading = (reading?.state === 'running' || reading?.state === 'idle')
      && liveActivityExpiryAt({ ...session, liveActivity: reading }, now);
    let liveActivity = hasLiveReading
      ? reading
      : { state: 'unknown', observedAt: new Date(now).toISOString() };
    // T3 only returns recent completions. A recovered completion can replace
    // the clearance once without advancing its clock on subsequent reads.
    if (liveActivity.state === 'idle' && previous?.state === 'unknown') {
      const clearedAt = Date.parse(previous.observedAt);
      if (clearedAt <= now && Date.parse(liveActivity.observedAt) < clearedAt) {
        liveActivity = { ...liveActivity, observedAt: previous.observedAt };
      }
    }
    if (!previous && liveActivity.state === 'unknown') continue;
    if (previous?.state === liveActivity.state && (liveActivity.state === 'unknown'
      || Date.parse(liveActivity.observedAt) - Date.parse(previous.observedAt) < RENEW_INTERVAL_MS)) continue;
    observations.set(sessionId, { client: CLIENT, sessionId, liveActivity });
  }
  const next = applyActivityPatch(summary, { observations: [...observations.values()] });
  // The lease can expire between reading SQLite and publishing the view.
  const activeSessions = Object.fromEntries(
    Object.entries(sessions).filter(([, row]) => liveActivityExpiryAt(row, now))
  );
  const nativeSessions = projectNativeActivitySessions(next, CLIENT, activeSessions, now, RENEW_INTERVAL_MS);
  if (!nativeSessions) return next;
  const projected = { ...next, nativeSessions };
  rememberProjection(next, projected);
  return projected;
}

function projectSessionActivity(summary, readings, now = Date.now(), nativeSessions = {}) {
  return projectActivity(summary, { readings, sessions: nativeSessions || {} }, now);
}

function activityWatchTargets(options = {}) {
  if (options.scopedHome) return [];
  return localSummaryCandidates(options).map((dbPath) => ({
    target: dbPath,
    floor: path.dirname(dbPath),
    kind: 'sqlite'
  }));
}

module.exports = {
  parseSqliteTimestamp,
  readSessionActivity,
  readSummaryActivity,
  readActivity,
  projectSessionActivity,
  projectActivity,
  activityWatchTargets
};
