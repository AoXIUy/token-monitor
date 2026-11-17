// @ts-check
'use strict';

const { createHash } = require('node:crypto');
const { isSessionActivityClient } = require('./sessionActivityProviders');
const {
  LIVE_ACTIVITY_TTL_MS,
  canReplaceLiveActivity,
  isArchivedSession,
  normalizeLiveActivity,
  normalizeReasoningEffort,
  sessionContextWindow
} = require('./sessionLive');
const {
  isPeriodExpired,
  normalizeClientName,
  normalizeLatestModel
} = require('./usage');

const MAX_GAP_MS = 120_000;
const MAX_END_AGE_MS = 600_000;
const MAX_SESSIONS = 2048;
const DEFAULT_DEBOUNCE_MS = 2500;
const MAX_RECENT_EVENTS = MAX_SESSIONS;
const SCAN_PERIODS = /** @type {const} */ (['month', 'today']);

/**
 * @typedef {object} CompletionCounters
 * @property {number} totalTokens
 * @property {number} inputTokens
 * @property {number} outputTokens
 * @property {number} cacheReadTokens
 * @property {number} cacheWriteTokens
 * @property {number} costUsd
 * @property {number} messageCount
 * @property {string | null} startedAt
 *
 * @typedef {object} TurnDelta
 * @property {number} totalTokens
 * @property {number} inputTokens
 * @property {number} outputTokens
 * @property {number} cacheReadTokens
 * @property {number} cacheWriteTokens
 * @property {number} costUsd
 * @property {number} messageCount
 *
 * @typedef {object} CompletionObservation
 * @property {string} key
 * @property {string} deviceId
 * @property {string} deviceName
 * @property {string} client
 * @property {string} sessionId
 * @property {string | null} title
 * @property {string} label
 * @property {string | null} projectLabel
 * @property {string | null} model
 * @property {string | null} reasoningEffort
 * @property {number} totalTokens
 * @property {number} inputTokens
 * @property {number} outputTokens
 * @property {number} cacheReadTokens
 * @property {number} cacheWriteTokens
 * @property {number} costUsd
 * @property {number} cacheHitRatePct
 * @property {number} contextTokens
 * @property {number} contextWindow
 * @property {number | null} contextPercentLeft
 * @property {number} messageCount
 * @property {string | null} startedAt
 * @property {number} lastUsedAt
 * @property {number} evidenceAt
 * @property {number} completionFloor
 * @property {boolean} active
 * @property {boolean} ended
 * @property {string | null} sessionKind
 * @property {string | null} parentSessionId
 * @property {boolean} hasCounters
 *
 * @typedef {object} SessionCompletionEvent
 * @property {string} eventId
 * @property {string} deviceId
 * @property {string} deviceName
 * @property {string} key
 * @property {string} client
 * @property {string} sessionId
 * @property {string | null} title
 * @property {string} label
 * @property {string | null} projectLabel
 * @property {string | null} model
 * @property {string | null} reasoningEffort
 * @property {number} totalTokens
 * @property {number} costUsd
 * @property {number} cacheHitRatePct
 * @property {number} contextTokens
 * @property {number} contextWindow
 * @property {number | null} contextPercentLeft
 * @property {number} messageCount
 * @property {string | null} startedAt
 * @property {string} lastUsedAt
 * @property {TurnDelta | null} turnDelta
 * @property {string | null} sessionKind
 * @property {string | null} parentSessionId
 *
 * @typedef {object} TrackerState
 * @property {number} armedAt
 * @property {number} floor
 * @property {number} latestEvidence
 * @property {number} latestAccount
 * @property {number} endedAt
 * @property {CompletionCounters | null} baseline
 *
 * @typedef {object} PendingCompletion
 * @property {string} key
 * @property {any} timer
 * @property {symbol} token
 * @property {number} scheduledAt
 * @property {number} debounceMs
 * @property {SessionCompletionEvent} completion
 */

/**
 * @param {any} value
 * @returns {number}
 */
function nowMs(value) {
  if (value === undefined || value === null) return Date.now();
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : Date.now();
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : Date.now();
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : Date.now();
  }
  return Date.now();
}

/**
 * @param {any} value
 * @returns {number}
 */
function timestampMs(value) {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) && ms > 0 ? ms : 0;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : 0;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return 0;
    if (/^\d+$/.test(trimmed)) {
      const n = Number(trimmed);
      return Number.isFinite(n) && n > 0 ? n : 0;
    }
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }
  return 0;
}

/**
 * @param {any} value
 * @returns {string}
 */
function normalizeEventTimestampPart(value) {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? String(ms) : '';
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(Math.trunc(value)) : '';
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (/^-?\d+$/.test(trimmed)) {
      const n = Number(trimmed);
      return Number.isFinite(n) ? String(Math.trunc(n)) : trimmed;
    }
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? String(parsed) : trimmed;
  }
  return '';
}

/**
 * Compute a stable SHA-256 event identifier for a session completion.
 * @param {string} deviceId
 * @param {string} key
 * @param {string | number | Date} lastUsedAt
 * @returns {string}
 */
function sessionCompletionEventId(deviceId, key, lastUsedAt) {
  const payload = `${String(deviceId ?? '')}\n${String(key ?? '')}\n${normalizeEventTimestampPart(lastUsedAt)}`;
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

/**
 * @param {any} value
 * @param {number} [maxLen]
 * @returns {string}
 */
function cleanSingleLine(value, maxLen = 160) {
  if (typeof value !== 'string') return '';
  const cleaned = value.replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  const chars = Array.from(cleaned);
  return chars.length <= maxLen ? cleaned : chars.slice(0, maxLen).join('');
}

/**
 * @param {any} value
 * @returns {number | null}
 */
function optionalNonNegInt(value) {
  if (value === undefined || value === null || value === '' || typeof value === 'boolean') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

/**
 * @param {any} value
 * @returns {number}
 */
function nonNegInt(value) {
  return optionalNonNegInt(value) ?? 0;
}

/**
 * @param {any} value
 * @returns {number}
 */
function nonNegFloat(value) {
  if (value === undefined || value === null || value === '' || typeof value === 'boolean') return 0;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * @param {number} cacheReadTokens
 * @param {number} inputTokens
 * @param {number} cacheWriteTokens
 * @returns {number}
 */
function computeCacheHitRatePct(cacheReadTokens, inputTokens, cacheWriteTokens) {
  const read = Math.max(0, cacheReadTokens);
  const measuredInput = Math.max(0, inputTokens) + read + Math.max(0, cacheWriteTokens);
  if (measuredInput <= 0) return 0;
  return Math.round((read / measuredInput) * 10_000) / 100;
}

/**
 * @param {any} session
 * @param {string} client
 * @returns {string | null}
 */
function pickSessionModel(session, client) {
  const normalizedClient = normalizeClientName(client) || client;
  const latest = normalizeLatestModel(session?.latestModel, normalizedClient);
  if (latest && latest !== '<synthetic>') return latest;
  if (session?.models && typeof session.models === 'object' && !Array.isArray(session.models)) {
    /** @type {string | null} */
    let bestModel = null;
    let bestTokens = 0;
    for (const [rawName, rawTokens] of Object.entries(session.models)) {
      const name = normalizeLatestModel(rawName, normalizedClient);
      if (!name || name === '<synthetic>') continue;
      const tokens = Number(rawTokens);
      if (!Number.isFinite(tokens) || tokens <= 0) continue;
      if (tokens > bestTokens || (tokens === bestTokens && bestModel !== null && name < bestModel)) {
        bestModel = name;
        bestTokens = tokens;
      }
    }
    if (bestModel) return bestModel;
  }
  const fallback = normalizeLatestModel(session?.model, normalizedClient);
  return fallback && fallback !== '<synthetic>' ? fallback : null;
}

/**
 * @param {any} value
 * @returns {string | null}
 */
function normalizeIsoOrNull(value) {
  const ms = timestampMs(value);
  return ms > 0 ? new Date(ms).toISOString() : null;
}

/**
 * Extract per-session completion observations from aggregated stats across
 * non-stale devices and active 'month' / 'today' period windows.
 *
 * @param {any} stats
 * @param {number | Date | string} [now]
 * @param {{ sessionTitlesEnabled?: boolean }} [options]
 * @returns {CompletionObservation[]}
 */
function extractCompletionObservations(stats, now = Date.now(), options = {}) {
  const clock = nowMs(now);
  const sessionTitlesEnabled = options?.sessionTitlesEnabled !== false;
  const devices = Array.isArray(stats?.devices) ? stats.devices : [];
  /** @type {Map<string, CompletionObservation>} */
  const rows = new Map();

  for (const device of devices) {
    if (!device || typeof device !== 'object' || device.stale === true) continue;
    const periods = device.periods;
    if (!periods || typeof periods !== 'object' || Array.isArray(periods)) continue;

    const deviceId = cleanSingleLine(String(device.deviceId || device.id || 'unknown'), 256) || 'unknown';
    const deviceName = cleanSingleLine(String(device.deviceName || device.hostname || deviceId), 128) || deviceId;

    for (const periodName of SCAN_PERIODS) {
      if (isPeriodExpired(device, periodName, clock)) continue;
      const periodData = periods[periodName];
      const sessions = periodData?.sessions;
      if (!sessions || typeof sessions !== 'object' || Array.isArray(sessions)) continue;

      for (const [key, rawSession] of Object.entries(sessions)) {
        if (!key || !rawSession || typeof rawSession !== 'object' || Array.isArray(rawSession)) continue;
        if (isArchivedSession(rawSession)) continue;

        const rawClient = typeof rawSession.client === 'string' ? rawSession.client.trim() : '';
        const client = normalizeClientName(rawClient) || rawClient.toLowerCase();
        const activityMap = periodData?.sessionActivity;
        let session = rawSession;
        if (activityMap && typeof activityMap === 'object' && !Array.isArray(activityMap)
          && Object.hasOwn(activityMap, key)) {
          const overlay = normalizeLiveActivity(activityMap[key]);
          if (overlay && isSessionActivityClient(client)
            && canReplaceLiveActivity(rawSession.liveActivity, overlay, clock)) {
            session = { ...rawSession, liveActivity: overlay };
          }
        }

        const lastUsedMs = timestampMs(session.lastUsedAt);
        if (lastUsedMs <= 0 || lastUsedMs > clock) continue;
        const sessionId = cleanSingleLine(
          typeof session.sessionId === 'string' && session.sessionId.trim()
            ? session.sessionId
            : (client && key.startsWith(`${client}:`) ? key.slice(client.length + 1) : key),
          256
        ) || key;

        const live = normalizeLiveActivity(session.liveActivity);
        const observedMs = live ? timestampMs(live.observedAt) : 0;
        const liveState = live ? live.state : 'unknown';
        const validLive = isSessionActivityClient(client)
          && observedMs > 0
          && observedMs <= clock
          && clock - observedMs < LIVE_ACTIVITY_TTL_MS
          && (liveState === 'running' || liveState === 'waiting' || liveState === 'idle');

        if (!validLive && clock - lastUsedMs > MAX_END_AGE_MS) continue;

        const openTurn = session.turnEnded === false;
        const questionWaiting = client === 'codex'
          && session.waitingForInput === true
          && session.turnEnded !== true;
        const active = validLive
          ? (liveState === 'running' || liveState === 'waiting')
          : (openTurn || questionWaiting);
        const ended = session.turnEnded === true && !active;

        const evidenceAt = validLive ? Math.max(lastUsedMs, observedMs) : lastUsedMs;
        const completionFloor = openTurn || questionWaiting
          ? lastUsedMs
          : Math.max(lastUsedMs, validLive ? observedMs : 0);

        const rawTitle = sessionTitlesEnabled
          ? (cleanSingleLine(session.title || session.sessionTitle || '', 160) || null)
          : null;
        const projectLabel = cleanSingleLine(session.projectLabel || session.project_label || '', 160) || null;
        const label = rawTitle || projectLabel || sessionId || key;

        const parsedTotal = optionalNonNegInt(session.totalTokens);
        const hasCounters = parsedTotal !== null;
        const totalTokens = parsedTotal ?? 0;
        const inputTokens = nonNegInt(session.inputTokens);
        const outputTokens = nonNegInt(session.outputTokens);
        const cacheReadTokens = nonNegInt(session.cacheReadTokens);
        const cacheWriteTokens = nonNegInt(session.cacheWriteTokens);
        const costUsd = Number(nonNegFloat(session.costUsd).toFixed(6));
        const messageCount = nonNegInt(session.messageCount);

        const ctx = sessionContextWindow(session);
        const contextTokens = ctx ? ctx.contextTokens : nonNegInt(session.contextTokens);
        const contextWindow = ctx ? ctx.contextWindow : nonNegInt(session.contextWindow);
        const contextPercentLeft = ctx ? ctx.percentLeft : null;

        const rawKind = cleanSingleLine(session.sessionKind || session.session_kind || '', 64);
        const sessionKind = rawKind || null;
        const rawParent = cleanSingleLine(session.parentSessionId || session.parent_session_id || '', 256);
        const parentClient = cleanSingleLine(session.parentClient || session.parent_client || '', 64);
        const parentSessionId = rawParent && (rawParent !== sessionId || (parentClient && parentClient !== client))
          ? rawParent
          : null;

        /** @type {CompletionObservation} */
        const candidate = {
          key,
          deviceId,
          deviceName,
          client,
          sessionId,
          title: rawTitle,
          label,
          projectLabel,
          model: pickSessionModel(session, client),
          reasoningEffort: normalizeReasoningEffort(session.reasoningEffort) ?? null,
          totalTokens,
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheWriteTokens,
          costUsd,
          cacheHitRatePct: computeCacheHitRatePct(cacheReadTokens, inputTokens, cacheWriteTokens),
          contextTokens,
          contextWindow,
          contextPercentLeft,
          messageCount,
          startedAt: normalizeIsoOrNull(session.startedAt),
          lastUsedAt: lastUsedMs,
          evidenceAt,
          completionFloor,
          active,
          ended,
          sessionKind,
          parentSessionId,
          hasCounters
        };

        const previous = rows.get(key);
        if (!previous
          || evidenceAt > previous.evidenceAt
          || (evidenceAt === previous.evidenceAt && ended && !previous.ended)) {
          rows.set(key, candidate);
        }
      }
    }
  }

  return Array.from(rows.values());
}

/**
 * @param {any} obs
 * @returns {CompletionCounters | null}
 */
function extractCounters(obs) {
  if (!obs || obs.hasCounters === false) return null;
  const totalTokens = optionalNonNegInt(obs.totalTokens);
  if (totalTokens === null) return null;
  return {
    totalTokens,
    inputTokens: nonNegInt(obs.inputTokens),
    outputTokens: nonNegInt(obs.outputTokens),
    cacheReadTokens: nonNegInt(obs.cacheReadTokens),
    cacheWriteTokens: nonNegInt(obs.cacheWriteTokens),
    costUsd: nonNegFloat(obs.costUsd),
    messageCount: nonNegInt(obs.messageCount),
    startedAt: normalizeIsoOrNull(obs.startedAt)
  };
}

/**
 * @param {CompletionCounters | null} baseline
 * @param {CompletionCounters | null} current
 * @returns {TurnDelta | null}
 */
function computeTurnDelta(baseline, current) {
  if (!baseline || !current) return null;
  if (baseline.startedAt && current.startedAt && baseline.startedAt !== current.startedAt) return null;
  if (current.totalTokens < baseline.totalTokens
    || current.inputTokens < baseline.inputTokens
    || current.outputTokens < baseline.outputTokens
    || current.cacheReadTokens < baseline.cacheReadTokens
    || current.cacheWriteTokens < baseline.cacheWriteTokens
    || current.messageCount < baseline.messageCount
    || current.costUsd + 1e-9 < baseline.costUsd) {
    return null;
  }
  return {
    totalTokens: current.totalTokens - baseline.totalTokens,
    inputTokens: current.inputTokens - baseline.inputTokens,
    outputTokens: current.outputTokens - baseline.outputTokens,
    cacheReadTokens: current.cacheReadTokens - baseline.cacheReadTokens,
    cacheWriteTokens: current.cacheWriteTokens - baseline.cacheWriteTokens,
    costUsd: Number(Math.max(0, current.costUsd - baseline.costUsd).toFixed(6)),
    messageCount: current.messageCount - baseline.messageCount
  };
}

/**
 * @param {any} rawClients
 * @returns {Set<string> | null}
 */
function buildClientSet(rawClients) {
  if (!Array.isArray(rawClients) || rawClients.length === 0) return null;
  const normalized = rawClients
    .map((entry) => {
      const text = typeof entry === 'string' ? entry.trim() : '';
      return text ? (normalizeClientName(text) || text.toLowerCase()) : '';
    })
    .filter(Boolean);
  return normalized.length > 0 ? new Set(normalized) : null;
}

/**
 * Create a stateful session completion tracker with debounce, filtering,
 * turn delta computation, cooldown throttling, and bounded deduplication.
 *
 * @param {{
 *   debounceMs?: number,
 *   setTimer?: (fn: () => void, ms: number) => any,
 *   clearTimer?: (timer: any) => void,
 *   clients?: string[],
 *   excludeSubagents?: boolean,
 *   excludeBackgroundReview?: boolean,
 *   minTurnTokens?: number,
 *   minTotalTokens?: number,
 *   cooldownMs?: number,
 *   sessionTitlesEnabled?: boolean,
 *   maxRecentEvents?: number,
 *   now?: () => number | Date | string,
 *   onCompletion?: (event: SessionCompletionEvent) => void,
 *   onCompleted?: (event: SessionCompletionEvent) => void,
 *   onComplete?: (event: SessionCompletionEvent) => void,
 *   onError?: (error: any) => void
 * }} [options]
 */
function createSessionCompletionTracker(options = {}) {
  /** @type {Map<string, TrackerState>} */
  const states = new Map();
  /** @type {Map<string, PendingCompletion>} */
  const pending = new Map();
  /** @type {Set<string>} */
  const recentEventIds = new Set();
  /** @type {Map<string, number>} */
  const lastEmittedAt = new Map();

  let initialized = false;
  let lastSuccess = 0;
  let lastAcceptedNow = 0;
  let usedExplicitClock = false;
  let stopped = false;

  /** @type {number} */
  let debounceMs = DEFAULT_DEBOUNCE_MS;
  /** @type {(fn: () => void, ms: number) => any} */
  let setTimer = (fn, ms) => {
    /** @type {any} */
    const timer = setTimeout(fn, ms);
    if (typeof timer?.unref === 'function') timer.unref();
    return timer;
  };
  /** @type {(timer: any) => void} */
  let clearTimer = (timer) => clearTimeout(timer);
  /** @type {Set<string> | null} */
  let clientSet = null;
  let excludeSubagents = true;
  let excludeBackgroundReview = true;
  let minTurnTokens = 0;
  let minTotalTokens = 0;
  let cooldownMs = 0;
  let sessionTitlesEnabled = true;
  let maxRecentEvents = MAX_RECENT_EVENTS;
  /** @type {(() => number | Date | string) | null} */
  let clockProvider = null;
  /** @type {((event: SessionCompletionEvent) => any) | null} */
  let onCompletion = null;
  /** @type {((error: any) => void) | null} */
  let onError = null;

  /**
   * @param {any} opts
   */
  function applyOptions(opts) {
    const src = opts && typeof opts === 'object' ? opts : {};
    if (Object.prototype.hasOwnProperty.call(src, 'debounceMs')) {
      const parsed = Number(src.debounceMs);
      debounceMs = Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : DEFAULT_DEBOUNCE_MS;
    }
    if (typeof src.setTimer === 'function') setTimer = src.setTimer;
    else if (typeof src.setTimeout === 'function') setTimer = src.setTimeout;
    if (typeof src.clearTimer === 'function') clearTimer = src.clearTimer;
    else if (typeof src.clearTimeout === 'function') clearTimer = src.clearTimeout;
    if (Object.prototype.hasOwnProperty.call(src, 'clients')) clientSet = buildClientSet(src.clients);
    if (Object.prototype.hasOwnProperty.call(src, 'excludeSubagents')) excludeSubagents = src.excludeSubagents !== false;
    if (Object.prototype.hasOwnProperty.call(src, 'excludeBackgroundReview')) {
      excludeBackgroundReview = src.excludeBackgroundReview !== false;
    }
    if (Object.prototype.hasOwnProperty.call(src, 'minTurnTokens')) minTurnTokens = nonNegInt(src.minTurnTokens);
    if (Object.prototype.hasOwnProperty.call(src, 'minTotalTokens')) minTotalTokens = nonNegInt(src.minTotalTokens);
    if (Object.prototype.hasOwnProperty.call(src, 'cooldownMs')) cooldownMs = nonNegInt(src.cooldownMs);
    if (Object.prototype.hasOwnProperty.call(src, 'sessionTitlesEnabled')) {
      sessionTitlesEnabled = src.sessionTitlesEnabled !== false;
    }
    if (Object.prototype.hasOwnProperty.call(src, 'maxRecentEvents')) {
      const max = Number(src.maxRecentEvents);
      maxRecentEvents = Number.isInteger(max) && max > 0 ? max : MAX_RECENT_EVENTS;
    }
    if (Object.prototype.hasOwnProperty.call(src, 'now')) {
      clockProvider = typeof src.now === 'function' ? src.now : null;
    }
    if (Object.prototype.hasOwnProperty.call(src, 'onCompletion')
      || Object.prototype.hasOwnProperty.call(src, 'onCompleted')
      || Object.prototype.hasOwnProperty.call(src, 'onComplete')) {
      const cb = src.onCompletion || src.onCompleted || src.onComplete;
      onCompletion = typeof cb === 'function' ? cb : null;
    }
    if (Object.prototype.hasOwnProperty.call(src, 'onError')) {
      onError = typeof src.onError === 'function' ? src.onError : null;
    }
  }

  applyOptions(options);

  /**
   * @param {string} key
   */
  function cancelPending(key) {
    const existing = pending.get(key);
    if (!existing) return;
    pending.delete(key);
    if (existing.timer !== null && existing.timer !== undefined) {
      clearTimer(existing.timer);
    }
  }

  function clearAllPending() {
    for (const entry of pending.values()) {
      if (entry.timer !== null && entry.timer !== undefined) {
        clearTimer(entry.timer);
      }
    }
    pending.clear();
  }

  /**
   * @param {string} eventId
   */
  function rememberEventId(eventId) {
    recentEventIds.delete(eventId);
    recentEventIds.add(eventId);
    while (recentEventIds.size > maxRecentEvents) {
      const oldest = recentEventIds.values().next().value;
      if (oldest === undefined) break;
      recentEventIds.delete(oldest);
    }
  }

  /**
   * @param {string} key
   * @param {number} at
   */
  function rememberCooldown(key, at) {
    lastEmittedAt.delete(key);
    lastEmittedAt.set(key, at);
    while (lastEmittedAt.size > MAX_SESSIONS) {
      const oldest = lastEmittedAt.keys().next().value;
      if (oldest === undefined) break;
      lastEmittedAt.delete(oldest);
    }
  }

  /**
   * @param {any} obs
   * @param {number} lastUsedMs
   * @param {TurnDelta | null} turnDelta
   * @returns {SessionCompletionEvent}
   */
  function buildCompletionEvent(obs, lastUsedMs, turnDelta) {
    const key = String(obs.key);
    const deviceId = String(obs.deviceId || 'unknown');
    const deviceName = cleanSingleLine(String(obs.deviceName || deviceId), 128) || deviceId;
    const client = String(obs.client || '');
    const sessionId = String(obs.sessionId || key);
    const projectLabel = obs.projectLabel ? cleanSingleLine(String(obs.projectLabel), 160) || null : null;
    const title = sessionTitlesEnabled && obs.title ? cleanSingleLine(String(obs.title), 160) || null : null;
    const label = title || projectLabel || sessionId || key;

    return {
      eventId: sessionCompletionEventId(deviceId, key, lastUsedMs),
      deviceId,
      deviceName,
      key,
      client,
      sessionId,
      title,
      label,
      projectLabel,
      model: typeof obs.model === 'string' && obs.model ? obs.model : null,
      reasoningEffort: normalizeReasoningEffort(obs.reasoningEffort) ?? null,
      totalTokens: nonNegInt(obs.totalTokens),
      costUsd: Number(nonNegFloat(obs.costUsd).toFixed(6)),
      cacheHitRatePct: typeof obs.cacheHitRatePct === 'number' && Number.isFinite(obs.cacheHitRatePct)
        ? obs.cacheHitRatePct
        : computeCacheHitRatePct(nonNegInt(obs.cacheReadTokens), nonNegInt(obs.inputTokens), nonNegInt(obs.cacheWriteTokens)),
      contextTokens: nonNegInt(obs.contextTokens),
      contextWindow: nonNegInt(obs.contextWindow),
      contextPercentLeft: typeof obs.contextPercentLeft === 'number' && Number.isFinite(obs.contextPercentLeft)
        ? obs.contextPercentLeft
        : null,
      messageCount: nonNegInt(obs.messageCount),
      startedAt: normalizeIsoOrNull(obs.startedAt),
      lastUsedAt: new Date(lastUsedMs).toISOString(),
      turnDelta,
      sessionKind: typeof obs.sessionKind === 'string' && obs.sessionKind ? obs.sessionKind : null,
      parentSessionId: typeof obs.parentSessionId === 'string' && obs.parentSessionId ? obs.parentSessionId : null
    };
  }

  /**
   * @param {SessionCompletionEvent} event
   * @returns {boolean}
   */
  function passesStaticFilters(event) {
    if (clientSet) {
      const normClient = normalizeClientName(event.client) || event.client.toLowerCase();
      if (!clientSet.has(normClient)) return false;
    }
    if (excludeSubagents && event.parentSessionId) return false;
    if (excludeBackgroundReview && event.sessionKind === 'background-review') return false;
    if (minTotalTokens > 0 && event.totalTokens < minTotalTokens) return false;
    if (minTurnTokens > 0 && (event.turnDelta ? event.turnDelta.totalTokens : 0) < minTurnTokens) return false;
    return true;
  }

  /**
   * @param {SessionCompletionEvent} event
   * @param {string} key
   * @param {number} emitAt
   * @returns {SessionCompletionEvent | null}
   */
  function tryEmitCompletion(event, key, emitAt) {
    if (stopped) return null;
    if (recentEventIds.has(event.eventId)) return null;
    if (cooldownMs > 0) {
      const prevAt = lastEmittedAt.get(key);
      if (prevAt !== undefined && emitAt - prevAt < cooldownMs) return null;
    }
    rememberEventId(event.eventId);
    rememberCooldown(key, emitAt);
    if (onCompletion) {
      try {
        const maybePromise = onCompletion(event);
        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise.catch((/** @type {any} */ error) => onError?.(error));
        }
      } catch (error) {
        onError?.(error);
      }
    }
    return event;
  }

  /**
   * @param {any} statsOrObservations
   * @param {number | Date | string} [now]
   * @returns {SessionCompletionEvent[]}
   */
  function accept(statsOrObservations, now) {
    if (stopped) return [];
    const hasExplicitNow = now !== undefined && now !== null;
    if (hasExplicitNow) usedExplicitClock = true;
    const clock = hasExplicitNow
      ? nowMs(now)
      : (clockProvider ? nowMs(clockProvider()) : Date.now());
    lastAcceptedNow = clock;

    const baseline = !initialized || clock < lastSuccess || clock - lastSuccess > MAX_GAP_MS;
    if (baseline) {
      states.clear();
      clearAllPending();
    }
    initialized = true;
    lastSuccess = clock;

    const observations = Array.isArray(statsOrObservations)
      ? statsOrObservations
      : extractCompletionObservations(statsOrObservations, clock, { sessionTitlesEnabled });

    /** @type {SessionCompletionEvent[]} */
    const emitted = [];
    /** @type {Set<string>} */
    const present = new Set();

    for (const obs of observations) {
      if (!obs || typeof obs !== 'object') continue;
      const key = typeof obs.key === 'string' ? obs.key : '';
      const lastUsedMs = timestampMs(obs.lastUsedAt);
      const evidenceAt = timestampMs(obs.evidenceAt) || lastUsedMs;
      const completionFloor = timestampMs(obs.completionFloor) || lastUsedMs;
      if (!key || lastUsedMs <= 0 || lastUsedMs > clock || evidenceAt > clock) continue;

      present.add(key);
      let state = states.get(key);
      if (!state) {
        state = {
          armedAt: 0,
          floor: 0,
          latestEvidence: 0,
          latestAccount: 0,
          endedAt: 0,
          baseline: null
        };
      } else {
        states.delete(key);
      }
      states.set(key, state);

      if (lastUsedMs < state.latestAccount || (evidenceAt < state.latestEvidence && !obs.ended)) {
        continue;
      }
      state.latestEvidence = Math.max(state.latestEvidence, evidenceAt);
      state.latestAccount = Math.max(state.latestAccount, lastUsedMs);

      if (obs.active) {
        cancelPending(key);
        const wasArmed = state.armedAt > 0;
        state.armedAt = clock;
        state.floor = Math.max(state.floor, Math.max(completionFloor, state.endedAt + 1));
        const counters = extractCounters(obs);
        if (!wasArmed) {
          state.baseline = counters;
        } else if (state.baseline && counters?.startedAt && state.baseline.startedAt
          && counters.startedAt !== state.baseline.startedAt) {
          state.baseline = counters;
        }
      } else if (obs.ended) {
        // A fresh active reading raises floor above older end markers so stale
        // transcript boundaries cannot disarm or falsely complete the turn.
        if (state.armedAt > 0 && lastUsedMs < state.floor) continue;

        const eligible = !baseline
          && state.armedAt > 0
          && clock - state.armedAt <= MAX_GAP_MS
          && lastUsedMs >= state.floor
          && lastUsedMs > state.endedAt
          && clock - lastUsedMs <= MAX_END_AGE_MS;

        const turnDelta = eligible ? computeTurnDelta(state.baseline, extractCounters(obs)) : null;
        state.armedAt = 0;
        state.baseline = null;
        state.endedAt = Math.max(state.endedAt, lastUsedMs);

        if (!eligible) continue;

        const event = buildCompletionEvent(obs, lastUsedMs, turnDelta);
        if (!passesStaticFilters(event)) continue;
        if (recentEventIds.has(event.eventId)) continue;

        if (debounceMs <= 0) {
          const sent = tryEmitCompletion(event, key, clock);
          if (sent) emitted.push(sent);
        } else {
          cancelPending(key);
          const token = Symbol(key);
          const scheduledDebounceMs = debounceMs;
          const timer = setTimer(() => {
            const current = pending.get(key);
            if (!current || current.token !== token || stopped) return;
            pending.delete(key);
            const emitAt = clockProvider
              ? nowMs(clockProvider())
              : (hasExplicitNow ? current.scheduledAt + current.debounceMs : Date.now());
            tryEmitCompletion(current.completion, key, emitAt);
          }, scheduledDebounceMs);
          pending.set(key, {
            key,
            timer,
            token,
            scheduledAt: clock,
            debounceMs: scheduledDebounceMs,
            completion: event
          });
        }
      } else if (state.armedAt > 0 && clock - state.armedAt > MAX_GAP_MS) {
        state.armedAt = 0;
        state.baseline = null;
      }
    }

    for (const key of Array.from(states.keys())) {
      if (!present.has(key)) states.delete(key);
    }
    while (states.size > MAX_SESSIONS) {
      const oldestKey = states.keys().next().value;
      if (oldestKey === undefined) break;
      states.delete(oldestKey);
    }

    return emitted;
  }

  /**
   * @param {number | Date | string} [now]
   * @returns {SessionCompletionEvent[]}
   */
  function flush(now) {
    if (stopped) return [];
    const entries = Array.from(pending.values());
    pending.clear();
    /** @type {SessionCompletionEvent[]} */
    const emitted = [];
    const hasExplicitNow = now !== undefined && now !== null;
    for (const entry of entries) {
      if (entry.timer !== null && entry.timer !== undefined) {
        clearTimer(entry.timer);
      }
      const emitAt = hasExplicitNow
        ? nowMs(now)
        : (clockProvider ? nowMs(clockProvider()) : (usedExplicitClock ? (lastAcceptedNow || entry.scheduledAt) : Date.now()));
      const sent = tryEmitCompletion(entry.completion, entry.key, emitAt);
      if (sent) emitted.push(sent);
    }
    return emitted;
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    clearAllPending();
    states.clear();
  }

  function reset() {
    stopped = false;
    initialized = false;
    lastSuccess = 0;
    lastAcceptedNow = 0;
    usedExplicitClock = false;
    clearAllPending();
    states.clear();
    recentEventIds.clear();
    lastEmittedAt.clear();
  }

  /**
   * @param {any} nextOptions
   */
  function updateOptions(nextOptions) {
    applyOptions(nextOptions);
  }

  return {
    accept,
    observe: accept,
    flush,
    stop,
    reset,
    updateOptions
  };
}

module.exports = {
  DEFAULT_DEBOUNCE_MS,
  LIVE_ACTIVITY_TTL_MS,
  MAX_END_AGE_MS,
  MAX_GAP_MS,
  MAX_SESSIONS,
  createSessionCompletionTracker,
  extractCompletionObservations,
  sessionCompletionEventId
};
