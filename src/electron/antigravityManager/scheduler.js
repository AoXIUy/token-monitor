// @ts-check
'use strict';

/**
 * Pure trigger check matching Antigravity-Manager auto_refresh.rs.
 *
 * @param {boolean} autoRefreshEnabled
 * @param {number} refreshIntervalMinutes
 * @param {number} nowSec
 * @param {number} lastRefreshSec
 * @param {boolean} currentlyRefreshing
 * @returns {boolean}
 */
function shouldTriggerAutoRefresh(
  autoRefreshEnabled,
  refreshIntervalMinutes,
  nowSec,
  lastRefreshSec,
  currentlyRefreshing
) {
  if (autoRefreshEnabled !== true) return false;
  if (!Number.isFinite(refreshIntervalMinutes) || refreshIntervalMinutes <= 0) return false;
  if (currentlyRefreshing === true) return false;
  if (!Number.isFinite(nowSec) || !Number.isFinite(lastRefreshSec)) return false;
  if (nowSec < lastRefreshSec) return false;
  const intervalSecs = Math.max(1, Math.trunc(refreshIntervalMinutes)) * 60;
  return nowSec - lastRefreshSec >= intervalSecs;
}

/**
 * Independent scheduler for Antigravity Manager.
 * Both startupRefresh and autoRefresh default to OFF (false) unless explicitly enabled.
 *
 * @param {{
 *   getConfig: () => { startupRefresh: boolean, autoRefresh: boolean, refreshIntervalMinutes: number },
 *   getAccountCount: () => number,
 *   onRefreshAll: (reason: 'startup' | 'interval') => Promise<unknown>,
 *   onRefreshStateChange?: (isRefreshing: boolean) => void,
 *   nowSec?: () => number,
 *   pollMs?: number,
 *   startupDelayMs?: number,
 *   logger?: { log?: Function, warn?: Function }
 * }} options
 */
function createAntigravityManagerScheduler({
  getConfig,
  getAccountCount,
  onRefreshAll,
  onRefreshStateChange,
  nowSec = () => Math.floor(Date.now() / 1000),
  pollMs = 10_000,
  startupDelayMs = 1500,
  logger = console
}) {
  let started = false;
  let stopped = false;
  let refreshing = false;
  let lastRefreshSec = 0;
  let intervalBaselineSec = 0;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let startupTimer = null;
  /** @type {ReturnType<typeof setInterval> | null} */
  let intervalHandle = null;

  function isRefreshing() {
    return refreshing;
  }

  function tryAcquireLock() {
    if (refreshing) return false;
    refreshing = true;
    return true;
  }

  function releaseLock() {
    refreshing = false;
  }

  /**
   * @param {number} [tsSec]
   */
  function recordRefreshTimestamp(tsSec = nowSec()) {
    if (Number.isFinite(tsSec)) {
      lastRefreshSec = tsSec;
      intervalBaselineSec = tsSec;
    }
  }

  function getLastRefreshTimestamp() {
    return lastRefreshSec;
  }

  /**
   * @param {'startup' | 'interval'} reason
   */
  async function runScheduledRefresh(reason) {
    if (stopped) return;
    if (!tryAcquireLock()) return;
    try { onRefreshStateChange?.(true); } catch (_) {}
    let refreshSucceeded = true;
    try {
      const outcome = await onRefreshAll(reason);
      if (outcome && typeof outcome === 'object' && /** @type {any} */ (outcome).ok === false) {
        refreshSucceeded = false;
      }
    } catch (error) {
      refreshSucceeded = false;
      (logger.warn || console.warn)(`[antigravity-manager-scheduler] ${reason} refresh failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      const finishedSec = nowSec();
      if (Number.isFinite(finishedSec)) {
        intervalBaselineSec = finishedSec;
      }
      if (refreshSucceeded) {
        recordRefreshTimestamp(finishedSec);
      }
      releaseLock();
      try { onRefreshStateChange?.(false); } catch (_) {}
    }
  }

  function start() {
    if (started || stopped) return;
    started = true;
    // Track interval pacing separately so lastRefreshSec stays 0 until a real refresh completes.
    intervalBaselineSec = nowSec();

    startupTimer = setTimeout(() => {
      startupTimer = null;
      if (stopped) return;
      const cfg = getConfig();
      if (cfg?.startupRefresh === true && getAccountCount() > 0) {
        void runScheduledRefresh('startup');
      }
    }, Math.max(0, startupDelayMs));
    startupTimer.unref?.();

    intervalHandle = setInterval(() => {
      if (stopped) return;
      const cfg = getConfig();
      if (getAccountCount() > 0 && shouldTriggerAutoRefresh(
        cfg?.autoRefresh === true,
        Number(cfg?.refreshIntervalMinutes || 0),
        nowSec(),
        intervalBaselineSec,
        refreshing
      )) {
        void runScheduledRefresh('interval');
      }
    }, Math.max(1000, pollMs));
    intervalHandle.unref?.();
  }

  function stop() {
    stopped = true;
    if (startupTimer) {
      clearTimeout(startupTimer);
      startupTimer = null;
    }
    if (intervalHandle) {
      clearInterval(intervalHandle);
      intervalHandle = null;
    }
  }

  return {
    start,
    stop,
    isRefreshing,
    tryAcquireLock,
    releaseLock,
    recordRefreshTimestamp,
    getLastRefreshTimestamp
  };
}

module.exports = {
  createAntigravityManagerScheduler,
  shouldTriggerAutoRefresh
};
