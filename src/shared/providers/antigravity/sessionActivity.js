'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  LIVE_ACTIVITY_TTL_MS,
  RUNNING_WINDOW_MS,
  isArchivedSession,
  sessionActivityState
} = require('../../sessionLive');
const {
  activityEntries,
  compactActivity,
  hasKnownSession,
  nativeSessionsForPeriod,
  rememberProjection
} = require('../../sessionActivityProjection');
const {
  antigravityConversationSummaryCandidates,
  antigravityTurnEndedFromRow,
  cleanTitle,
  projectFromWorkspaceUris,
  resolveSqlite
} = require('./sessionMetadata');

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
    return Number.isFinite(value) && value > 0 ? value : 0;
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
  const withinWindow = modifiedMs > 0 && modifiedMs <= clock && clock - modifiedMs <= RUNNING_WINDOW_MS;
  if (!allowIdle && !withinWindow) return null;
  let observedAt;
  if (modifiedMs > 0 && modifiedMs <= clock && clock - modifiedMs < LIVE_ACTIVITY_TTL_MS) {
    observedAt = new Date(modifiedMs).toISOString();
  } else if (forceIdleClock) {
    observedAt = new Date(clock).toISOString();
  } else {
    observedAt = new Date(modifiedMs > 0 && modifiedMs <= clock ? modifiedMs : clock).toISOString();
  }
  return { state: 'idle', turnEnded: true, modifiedMs, observedAt };
}

function collectKnownStates(summary, clock) {
  const known = new Map();
  const periods = summary?.periods || summary;
  const checkRow = (session) => {
    if (!session || session.client !== 'antigravity' || !session.sessionId || isArchivedSession(session)) return;
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
  for (const { session } of activityEntries(summary, 'antigravity', [], true)) {
    checkRow(session);
  }
  for (const periodName of ['today', 'month']) {
    for (const session of Object.values(periods?.[periodName]?.sessions || {})) {
      if (session?.client !== 'antigravity') continue;
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

function collectSummaryRows(options, wantedIds, discoverActive) {
  const home = options.homeDir || os.homedir();
  const env = options.env || process.env;
  const sqlite = resolveSqlite(options);
  if (typeof sqlite?.DatabaseSync !== 'function') return [];
  const candidates = antigravityConversationSummaryCandidates({ home, env });
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
      allowIdle: Boolean(knownMeta),
      forceIdleClock: Boolean(knownMeta?.needsIdleOverride)
    });
    if (!parsed) continue;
    const reading = { state: parsed.state, observedAt: parsed.observedAt };
    readings.set(id, reading);

    if (parsed.state !== 'running' || hasKnownSession(summary, 'antigravity', id, 'today', false)) {
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
    const existingNative = summary?.nativeSessions?.today?.[`antigravity:${id}`];
    sessions[`antigravity:${id}`] = {
      client: 'antigravity',
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

function nextObservation(session, readings, now, renew) {
  if (session.client !== 'antigravity' || isArchivedSession(session)) return null;
  const previous = session.liveActivity;
  const reading = readings.get(session.sessionId);
  if (!reading && (!previous || previous.state === 'unknown')) return null;
  const state = reading?.state || 'unknown';
  const observedAt = state === 'idle' && reading ? reading.observedAt : new Date(now).toISOString();
  if (previous?.state === state && previous.observedAt === observedAt) return null;
  if (previous?.state === state && (!renew || state === 'unknown'
    || now - Date.parse(previous.observedAt) < RENEW_INTERVAL_MS)) return null;
  return { state, observedAt };
}

function projectSessionActivity(summary, readings, now = Date.now(), nativeSessions) {
  const sourcePeriods = summary?.periods || summary;
  let next = null;
  const observations = [];
  const entries = activityEntries(summary, 'antigravity', readings.keys());
  for (const name of ['today', 'month', 'allTime']) {
    let sessions = null;
    for (const { key, session } of entries.filter((row) => row.name === name)) {
      const observation = nextObservation(session, readings, now, true);
      if (!observation) continue;
      sessions ||= compactActivity(sourcePeriods?.[name], now);
      sessions[key] = observation;
      observations.push({ client: 'antigravity', sessionId: session.sessionId, liveActivity: observation });
    }
    if (!sessions) continue;
    next ||= summary?.periods
      ? { ...summary, periods: { ...summary.periods }, updatedAt: new Date(now).toISOString() }
      : { ...summary, updatedAt: new Date(now).toISOString() };
    const targetPeriods = next.periods || next;
    targetPeriods[name] = { ...sourcePeriods[name], sessionActivity: sessions };
  }
  if (nativeSessions) {
    const oldNative = summary?.nativeSessions || {};
    const antigravityOnly = (view) => Object.fromEntries(
      Object.entries(view || {}).filter(([, session]) => session.client === 'antigravity')
    );
    const withoutClock = (view) => JSON.stringify(view, (key, value) => (key === 'observedAt' ? undefined : value));
    const byPeriod = Object.fromEntries(['today', 'month', 'allTime'].map((name) => [
      name,
      nativeSessionsForPeriod(summary, 'antigravity', nativeSessions, name)
    ]));
    const changed = ['today', 'month', 'allTime'].some(
      (name) => withoutClock(antigravityOnly(oldNative[name])) !== withoutClock(byPeriod[name])
    );
    const renew = Object.values(antigravityOnly(oldNative.today)).some(
      (session) => now - Date.parse(session.liveActivity?.observedAt) >= RENEW_INTERVAL_MS
    );
    if (changed || renew) {
      next ||= summary?.periods
        ? { ...summary, periods: { ...summary.periods }, updatedAt: new Date(now).toISOString() }
        : { ...summary, updatedAt: new Date(now).toISOString() };
      next.nativeSessions = { ...oldNative };
      for (const name of ['today', 'month', 'allTime']) {
        const existing = Object.fromEntries(
          Object.entries(oldNative[name] || {}).filter(([, session]) => session.client !== 'antigravity')
        );
        next.nativeSessions[name] = { ...existing, ...byPeriod[name] };
      }
    }
  }
  rememberProjection(summary, next, observations);
  return next;
}

function projectActivity(summary, activity, now) {
  return projectSessionActivity(summary, activity.readings, now, activity.sessions);
}

function activityWatchTargets(options = {}) {
  if (options.scopedHome) return [];
  const home = options.homeDir || os.homedir();
  const env = options.env || process.env;
  return antigravityConversationSummaryCandidates({ home, env }).map((dbPath) => ({
    target: dbPath,
    floor: path.dirname(dbPath),
    kind: 'sqlite'
  }));
}

module.exports = {
  parseSqliteTimestamp,
  readSessionActivity,
  readSummaryActivity,
  readActivity: readSummaryActivity,
  projectSessionActivity,
  projectActivity,
  activityWatchTargets
};
