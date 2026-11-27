// @ts-check
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAntigravityManagerStore } = require('./store');
const oauth = require('./oauth');
const quota = require('./quota');
const { createAntigravityManagerScheduler } = require('./scheduler');
const switcher = require('./switcher');
const importExport = require('./importExport');
const deviceProfile = require('./deviceProfile');
const processManager = require('./processManager');
const keyring = require('./keyring');
const fileCredentials = require('./fileCredentials');
const autoSwitch = require('./autoSwitch');
const taskResume = require('./taskResume');
const {
  AG_MANAGER_SNAPSHOT_PATH,
  sanitizeAntigravityManagerSnapshot
} = require('../../shared/antigravityManagerProtocol');

/**
 * Standalone Antigravity Manager service, strictly isolated from main collector & LimitsRuntime.
 *
 * @param {{
 *   baseDir: string,
 *   safeStorage?: any,
 *   fetch?: typeof fetch,
 *   hubFetch?: typeof fetch,
 *   openExternal?: (url: string) => unknown,
 *   getDeviceIdentity?: () => { deviceId: string, hostname: string },
 *   getHubSyncTarget?: () => { mode: string, hubUrl?: string, secret?: string, embeddedHub?: any } | null,
 *   isLocalAntigravityBusy?: () => boolean,
 *   probeLocalLimits?: (opts?: { signal?: AbortSignal }) => Promise<any>,
 *   getLatestLocalLimits?: () => any,
 *   onAutoSwitchCompleted?: (result: any) => void,
 *   nowMs?: () => number,
 *   switcherDeps?: Record<string, any>,
 *   taskResumeDeps?: Record<string, any>,
 *   onStateChanged?: (state: any) => void,
 *   onRefreshProgress?: (progress: any) => void,
 *   onImportProgress?: (progress: any) => void,
 *   logger?: { log?: Function, warn?: Function, error?: Function },
 *   schedulerOptions?: { pollMs?: number, startupDelayMs?: number },
 *   autoSwitchMonitorOptions?: {
 *     pollMs?: number,
 *     activityDebounceMs?: number,
 *     activityMinIntervalMs?: number,
 *     turnEndDelayMs?: number,
 *     startupDelayMs?: number,
 *     hotSwitchVerifyDelayMs?: number
 *   }
 * }} options
 */
function createAntigravityManagerService(options) {
  const logger = options.logger || console;
  const nowMsFn = options.nowMs || Date.now;
  const nowSecFn = () => Math.floor(nowMsFn() / 1000);
  const store = createAntigravityManagerStore({
    baseDir: options.baseDir,
    safeStorage: options.safeStorage || null,
    logger
  });
  const healthTracker = new quota.EndpointHealthTracker();
  const REFRESH_STATE_THROTTLE_MS = 280;
  const AUTO_SWITCH_MONITOR_POLL_MS = Math.max(200, Number(options.autoSwitchMonitorOptions?.pollMs || 25_000));
  const AUTO_SWITCH_ACTIVITY_DEBOUNCE_MS = Math.max(20, Number(options.autoSwitchMonitorOptions?.activityDebounceMs || 1200));
  const AUTO_SWITCH_ACTIVITY_MIN_INTERVAL_MS = Math.max(50, Number(options.autoSwitchMonitorOptions?.activityMinIntervalMs || 8000));
  const AUTO_SWITCH_TURN_END_DELAY_MS = Math.max(20, Number(options.autoSwitchMonitorOptions?.turnEndDelayMs || 600));
  const AUTO_SWITCH_STARTUP_DELAY_MS = Math.max(20, Number(options.autoSwitchMonitorOptions?.startupDelayMs || 2500));
  const HOT_SWITCH_VERIFY_DELAY_MS = Math.max(20, Number(options.autoSwitchMonitorOptions?.hotSwitchVerifyDelayMs || 1800));
  const AUTO_SWITCH_CONFIG_KEYS = [
    'autoSwitchEnabled',
    'autoSwitchScope',
    'autoSwitchThresholdPercent',
    'selectionMode',
    'autoSwitchCooldownSeconds',
    'defaultSwitchTarget'
  ];
  /** @type {AbortController | null} */
  let activeRefreshAbort = null;
  /** @type {AbortController | null} */
  let activeOAuthAbort = null;
  /** @type {AbortController | null} */
  let activeLocalProbeAbort = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let hubSyncTimer = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let refreshStateTimer = null;
  /** @type {ReturnType<typeof setInterval> | null} */
  let autoSwitchMonitorTimer = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let localProbeDebounceTimer = null;
  let lastRefreshStateEmitMs = 0;
  let switching = false;
  /** @type {string | null} */
  let switchingAccountId = null;
  let autoSwitchInFlight = false;
  let localProbeInFlight = false;
  let lastLocalProbeAtMs = 0;
  let wasLocalAntigravityBusy = false;
  /** @type {Map<string, number>} */
  const recentRunningConversations = new Map();
  /** @type {unknown} */
  let pendingAutoSwitchLimits = null;
  let lastAutoSwitchAttemptMs = 0;
  let lastAutoSwitchWasEmptyPool = false;
  /** @type {Record<string, any> | null} */
  let lastAutoSwitch = null;
  /** @type {Array<() => void>} */
  const refreshWaiters = [];
  let started = false;
  let stopped = false;

  function resolveRefreshWaiters() {
    while (refreshWaiters.length > 0) {
      const next = refreshWaiters.shift();
      try { next?.(); } catch (_) {}
    }
  }

  /**
   * @returns {Promise<void>}
   */
  function waitForActiveRefresh() {
    if (!scheduler.isRefreshing()) return Promise.resolve();
    return new Promise((resolve) => {
      refreshWaiters.push(() => resolve());
    });
  }

  function resetEmptyPoolBackoff() {
    if (lastAutoSwitchWasEmptyPool) {
      lastAutoSwitchWasEmptyPool = false;
      lastAutoSwitchAttemptMs = 0;
    }
  }

  function resetAutoSwitchCooldown() {
    lastAutoSwitchWasEmptyPool = false;
    lastAutoSwitchAttemptMs = 0;
  }

  function clearLocalProbeDebounceTimer() {
    if (localProbeDebounceTimer) {
      clearTimeout(localProbeDebounceTimer);
      localProbeDebounceTimer = null;
    }
  }

  function clearAutoSwitchMonitorTimers() {
    clearLocalProbeDebounceTimer();
    if (autoSwitchMonitorTimer) {
      clearInterval(autoSwitchMonitorTimer);
      autoSwitchMonitorTimer = null;
    }
    if (activeLocalProbeAbort) {
      activeLocalProbeAbort.abort();
      activeLocalProbeAbort = null;
    }
  }

  function clearRefreshStateTimer() {
    if (refreshStateTimer) {
      clearTimeout(refreshStateTimer);
      refreshStateTimer = null;
    }
  }

  /**
   * @param {boolean} [syncToHub]
   */
  function notifyStateChanged(syncToHub = true) {
    clearRefreshStateTimer();
    lastRefreshStateEmitMs = Date.now();
    const state = getState();
    try {
      options.onStateChanged?.(state);
    } catch (_) {}
    if (syncToHub) scheduleHubSync();
  }

  function notifyBatchRefreshStateThrottled() {
    if (stopped) return;
    const elapsed = Date.now() - lastRefreshStateEmitMs;
    if (elapsed >= REFRESH_STATE_THROTTLE_MS) {
      notifyStateChanged(false);
      return;
    }
    if (refreshStateTimer) return;
    refreshStateTimer = setTimeout(() => {
      refreshStateTimer = null;
      if (!stopped) notifyStateChanged(false);
    }, REFRESH_STATE_THROTTLE_MS - elapsed);
    refreshStateTimer.unref?.();
  }

  function buildSanitizedHubSnapshot() {
    const identity = options.getDeviceIdentity?.() || {
      deviceId: os.hostname() || 'desktop',
      hostname: os.hostname() || 'desktop'
    };
    const state = store.getStateForRenderer();
    return sanitizeAntigravityManagerSnapshot({
      version: 1,
      deviceId: identity.deviceId,
      hostname: identity.hostname,
      updatedAt: new Date().toISOString(),
      settings: {
        startupRefresh: state.config.startupRefresh,
        autoRefresh: state.config.autoRefresh,
        refreshIntervalMinutes: state.config.refreshIntervalMinutes
      },
      activeAccounts: state.activeAccounts,
      accounts: state.accounts
    });
  }

  async function pushSnapshotToHubNow() {
    if (stopped) return { ok: false, skipped: 'stopped' };
    const cfg = store.getConfig();
    if (!cfg.syncToHub) return { ok: false, skipped: 'disabled' };
    const target = options.getHubSyncTarget?.();
    if (!target) return { ok: false, skipped: 'no_hub' };

    let payload;
    try {
      payload = buildSanitizedHubSnapshot();
    } catch (_) {
      return { ok: false, skipped: 'invalid_snapshot' };
    }

    if (target.mode === 'host' && target.embeddedHub?.hub?.setAntigravityManagerSnapshot) {
      try {
        target.embeddedHub.hub.setAntigravityManagerSnapshot(payload);
        return { ok: true, mode: 'host' };
      } catch (_) {
        return { ok: false, mode: 'host' };
      }
    }

    if (target.mode === 'client' && target.hubUrl) {
      try {
        const baseUrl = String(target.hubUrl).replace(/\/+$/, '');
        const headers = /** @type {Record<string, string>} */ ({
          'content-type': 'application/json'
        });
        if (target.secret) {
          headers.authorization = `Bearer ${target.secret}`;
        }
        const fetchFn = options.hubFetch || options.fetch || fetch;
        const response = await fetchFn(`${baseUrl}${AG_MANAGER_SNAPSHOT_PATH}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify(payload),
          redirect: 'error',
          signal: AbortSignal.timeout(10_000)
        });
        return { ok: response.ok, mode: 'client', status: response.status };
      } catch (_) {
        return { ok: false, mode: 'client' };
      }
    }

    return { ok: false, skipped: 'local_mode' };
  }

  function scheduleHubSync() {
    if (stopped) return;
    if (hubSyncTimer) clearTimeout(hubSyncTimer);
    hubSyncTimer = setTimeout(() => {
      hubSyncTimer = null;
      void pushSnapshotToHubNow();
    }, 600);
    hubSyncTimer.unref?.();
  }

  /**
   * Refresh a single account's quota and persist classification / token renewal.
   * @param {string} accountId
   * @param {AbortSignal} [signal]
   */
  async function refreshSingleAccountInternal(accountId, signal) {
    const account = store.getAccount(accountId);
    if (!account) throw new Error('Account not found');
    const token = store.getAccountToken(accountId);
    if (!token) throw new Error('Account has no stored token');

    const result = await quota.fetchAccountQuota(account, token, {
      fetch: options.fetch,
      healthTracker,
      signal,
      nowMs: nowMsFn,
      nowSec: nowSecFn,
      onTokenRefreshed: (updated) => {
        store.saveAccountToken(accountId, updated);
      }
    });

    if (result.invalidGrant) {
      store.updateAccountQuota(accountId, account.quota || {}, {
        disabled: true,
        disabledReason: result.error || 'invalid_grant',
        disabledAt: Math.floor(Date.now() / 1000)
      });
      throw new Error(result.error || 'invalid_grant');
    }

    const extra = /** @type {Record<string, any>} */ ({
      subscriptionTier: result.subscriptionTier
    });
    const cls = result.classification;
    if (cls?.kind === 'validationRequired') {
      extra.validationBlocked = true;
      extra.validationMessage = cls.message || '';
    } else if (cls?.kind === 'banned') {
      extra.banned = true;
      extra.banInfo = cls.banInfo;
    } else if (cls?.kind === 'modelForbidden' && cls.modelScope) {
      extra.forbiddenModels = [...new Set([...(account.forbiddenModels || []), cls.modelScope])];
    } else if (cls?.kind === 'ok') {
      extra.validationBlocked = false;
      extra.validationMessage = '';
      extra.banned = false;
      extra.banInfo = null;
      extra.forbiddenModels = [];
    }

    store.updateAccountQuota(accountId, result.quota || {}, extra);
    return store.getAccount(accountId);
  }

  /**
   * @param {string[]} [targetIds]
   */
  async function refreshAccounts(targetIds = []) {
    if (!scheduler.tryAcquireLock()) {
      return { ok: false, error: 'refresh_in_progress' };
    }
    const cfg = store.getConfig();
    const all = store.listAccounts();
    const idSet = Array.isArray(targetIds) && targetIds.length > 0 ? new Set(targetIds) : null;
    const targets = all.filter((a) => (!idSet || idSet.has(a.id)) && !a.disabled && !a.banned && a.hasToken);

    const controller = new AbortController();
    activeRefreshAbort = controller;
    notifyStateChanged(false);

    try {
      const stats = await quota.runSlidingWindowBatch(targets, {
        concurrency: cfg.refreshConcurrency,
        slideDelaySecs: cfg.refreshSlideDelaySecs,
        signal: controller.signal,
        onProgress: (p) => {
          try {
            options.onRefreshProgress?.({
              current: p.current,
              total: p.total,
              success: p.success,
              failed: p.failed,
              currentEmail: p.item?.email || ''
            });
          } catch (_) {}
          notifyBatchRefreshStateThrottled();
        },
        worker: async (acc) => {
          await refreshSingleAccountInternal(acc.id, controller.signal);
          return true;
        }
      });
      scheduler.recordRefreshTimestamp();
      return { ok: true, ...stats };
    } finally {
      if (activeRefreshAbort === controller) activeRefreshAbort = null;
      scheduler.releaseLock();
      resolveRefreshWaiters();
      notifyStateChanged(true);
    }
  }

  /** @param {string} accountId */
  async function refreshAccount(accountId) {
    try {
      const account = await refreshSingleAccountInternal(accountId);
      notifyStateChanged(true);
      return { ok: true, account };
    } catch (error) {
      notifyStateChanged(true);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  function cancelRefresh() {
    if (!activeRefreshAbort) return false;
    activeRefreshAbort.abort();
    return true;
  }

  const scheduler = createAntigravityManagerScheduler({
    getConfig: () => store.getConfig(),
    getAccountCount: () => store.listAccounts().filter((a) => !a.disabled && !a.banned && a.hasToken).length,
    onRefreshStateChange: (isNowRefreshing) => {
      if (!isNowRefreshing) resolveRefreshWaiters();
      notifyStateChanged(!isNowRefreshing);
    },
    onRefreshAll: async () => {
      const cfg = store.getConfig();
      const targets = store.listAccounts().filter((a) => !a.disabled && !a.banned && a.hasToken);
      const controller = new AbortController();
      activeRefreshAbort = controller;
      try {
        await quota.runSlidingWindowBatch(targets, {
          concurrency: cfg.refreshConcurrency,
          slideDelaySecs: cfg.refreshSlideDelaySecs,
          signal: controller.signal,
          onProgress: (p) => {
            try {
              options.onRefreshProgress?.({
                current: p.current,
                total: p.total,
                success: p.success,
                failed: p.failed,
                currentEmail: p.item?.email || ''
              });
            } catch (_) {}
            notifyBatchRefreshStateThrottled();
          },
          worker: async (acc) => {
            await refreshSingleAccountInternal(acc.id, controller.signal);
            return true;
          }
        });
      } finally {
        if (activeRefreshAbort === controller) activeRefreshAbort = null;
      }
    },
    logger,
    nowSec: nowSecFn,
    pollMs: options.schedulerOptions?.pollMs,
    startupDelayMs: options.schedulerOptions?.startupDelayMs
  });

  function getState() {
    return {
      ...store.getStateForRenderer(),
      isRefreshing: scheduler.isRefreshing(),
      lastRefreshAt: scheduler.getLastRefreshTimestamp(),
      isSwitching: switching,
      switchingAccountId,
      isAutoSwitching: autoSwitchInFlight,
      lastAutoSwitch
    };
  }

  /**
   * @param {string} _reason
   * @param {{ bypassMinInterval?: boolean }} [opts]
   */
  async function probeAndEvaluateLocalQuota(_reason, opts = {}) {
    if (stopped || typeof options.probeLocalLimits !== 'function') return null;
    if (!store.getConfig().autoSwitchEnabled) return null;
    if (localProbeInFlight || autoSwitchInFlight || switching) return null;
    const now = nowMsFn();
    if (!opts.bypassMinInterval && lastLocalProbeAtMs > 0 && now - lastLocalProbeAtMs < AUTO_SWITCH_ACTIVITY_MIN_INTERVAL_MS) {
      return null;
    }
    localProbeInFlight = true;
    const controller = new AbortController();
    activeLocalProbeAbort = controller;
    try {
      const probed = await options.probeLocalLimits({ signal: controller.signal });
      lastLocalProbeAtMs = nowMsFn();
      if (stopped || controller.signal.aborted || !probed) return null;
      return await onLocalLimitsUpdated(probed);
    } catch (_) {
      lastLocalProbeAtMs = nowMsFn();
      return null;
    } finally {
      if (activeLocalProbeAbort === controller) activeLocalProbeAbort = null;
      localProbeInFlight = false;
    }
  }

  /**
   * @param {number} delayMs
   * @param {string} reason
   * @param {boolean} [bypassMinInterval]
   */
  function scheduleLocalQuotaProbe(delayMs, reason, bypassMinInterval = false) {
    if (stopped || typeof options.probeLocalLimits !== 'function' || !store.getConfig().autoSwitchEnabled) return;
    if (localProbeDebounceTimer && !bypassMinInterval) return;
    clearLocalProbeDebounceTimer();
    localProbeDebounceTimer = setTimeout(() => {
      localProbeDebounceTimer = null;
      void probeAndEvaluateLocalQuota(reason, { bypassMinInterval });
    }, delayMs);
    localProbeDebounceTimer.unref?.();
  }

  function reconcileAutoSwitchMonitor() {
    if (stopped || !started || typeof options.probeLocalLimits !== 'function' || !store.getConfig().autoSwitchEnabled) {
      clearAutoSwitchMonitorTimers();
      return;
    }
    if (!autoSwitchMonitorTimer) {
      autoSwitchMonitorTimer = setInterval(() => {
        void probeAndEvaluateLocalQuota('interval');
      }, AUTO_SWITCH_MONITOR_POLL_MS);
      autoSwitchMonitorTimer.unref?.();
    }
  }

  /**
   * @param {unknown} limitsPayload
   * @param {number} maxAgeMs
   */
  function hasFreshLocalRpcRow(limitsPayload, maxAgeMs) {
    const providers = Array.isArray(limitsPayload)
      ? limitsPayload
      : (limitsPayload && typeof limitsPayload === 'object' && Array.isArray(/** @type {any} */ (limitsPayload).providers)
          ? /** @type {any} */ (limitsPayload).providers
          : []);
    const now = nowMsFn();
    return providers.some((/** @type {any} */ row) => {
      if (!row || row.provider !== 'antigravity' || row.source !== 'rpc' || row.status !== 'ok') return false;
      const ts = Date.parse(String(row.updatedAt || ''));
      return Number.isFinite(ts) && ts > 0 && now - ts <= maxAgeMs;
    });
  }

  /**
   * @param {Record<string, any>} patch
   */
  function updateConfig(patch) {
    const src = patch && typeof patch === 'object' ? patch : {};
    const touchedAutoSwitch = AUTO_SWITCH_CONFIG_KEYS.some((key) => Object.prototype.hasOwnProperty.call(src, key));
    const updated = store.updateConfig(src);
    resetEmptyPoolBackoff();
    if (touchedAutoSwitch) {
      resetAutoSwitchCooldown();
    }
    reconcileAutoSwitchMonitor();
    notifyStateChanged(true);
    if (touchedAutoSwitch && updated.autoSwitchEnabled) {
      const cachedLimits = options.getLatestLocalLimits?.();
      if (cachedLimits && hasFreshLocalRpcRow(cachedLimits, 15_000) && autoSwitch.evaluateLocalQuotaTrigger(cachedLimits, updated).triggered) {
        void Promise.resolve(onLocalLimitsUpdated(cachedLimits)).catch(() => {});
      } else if (typeof options.probeLocalLimits === 'function') {
        void probeAndEvaluateLocalQuota('config_change', { bypassMinInterval: true });
      }
    }
    return { ok: true, config: updated };
  }

  /**
   * @param {string} [clientKey]
   */
  async function startOAuthLogin(clientKey) {
    if (activeOAuthAbort) return { ok: false, error: 'OAuth login already in progress' };
    if (typeof options.openExternal !== 'function') return { ok: false, error: 'openExternal unavailable' };
    const controller = new AbortController();
    activeOAuthAbort = controller;
    try {
      const { identity, token } = await oauth.runOAuthLogin({
        clientKey,
        fetch: options.fetch,
        openExternal: options.openExternal,
        signal: controller.signal
      });
      const saved = store.upsertAccount({
        email: identity.email,
        name: identity.name,
        disabled: false,
        disabledReason: '',
        disabledAt: null
      }, token);
      if (!saved?.id) return { ok: false, error: 'Failed to store OAuth account' };
      resetEmptyPoolBackoff();
      try {
        await refreshSingleAccountInternal(saved.id);
      } catch (_) {}
      notifyStateChanged(true);
      return { ok: true, account: store.getAccount(saved.id) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      if (activeOAuthAbort === controller) activeOAuthAbort = null;
    }
  }

  function cancelOAuthLogin() {
    if (!activeOAuthAbort) return false;
    activeOAuthAbort.abort();
    return true;
  }

  /**
   * @param {string} content
   * @param {{ refreshAfterImport?: boolean }} [opts]
   */
  async function importFromString(content, opts = {}) {
    const entries = importExport.parseImportEntriesFromString(content);
    if (entries.length === 0) {
      return { ok: false, error: 'No valid refresh tokens (1//...) or exported JSON accounts found' };
    }
    const result = await importExport.batchImportRefreshTokens(entries, {
      store,
      fetch: options.fetch,
      onProgress: (p) => {
        try { options.onImportProgress?.(p); } catch (_) {}
      }
    });
    if (result.accountIds.length > 0) resetEmptyPoolBackoff();
    notifyStateChanged(true);
    if (opts.refreshAfterImport && result.accountIds.length > 0) {
      await refreshAccounts(result.accountIds);
    }
    return { ok: true, ...result };
  }

  /**
   * @param {string} dirPath
   */
  function importDataDir(dirPath) {
    const targetDir = dirPath || importExport.defaultManagerDataDir();
    const res = importExport.importFromManagerDataDir(targetDir, { store });
    if (res.imported > 0) resetEmptyPoolBackoff();
    notifyStateChanged(true);
    return { ok: true, ...res };
  }

  /**
   * @param {string} dbPath
   * @param {{ refreshAfterImport?: boolean }} [opts]
   */
  async function importStateDb(dbPath, opts = {}) {
    const saved = await importExport.importFromStateDbFile(dbPath, {
      store,
      fetch: options.fetch
    });
    if (saved?.id) resetEmptyPoolBackoff();
    if (opts.refreshAfterImport !== false && saved?.id) {
      try { await refreshSingleAccountInternal(saved.id); } catch (_) {}
    }
    notifyStateChanged(true);
    return { ok: true, account: store.getAccount(saved.id) };
  }

  async function scanLocalAccounts() {
    const result = await importExport.scanAndImportLocalAccounts({
      store,
      fetch: options.fetch,
      onProgress: (/** @type {any} */ p) => {
        try { options.onImportProgress?.(p); } catch (_) {}
      }
    });
    if (result.accountIds.length > 0) resetEmptyPoolBackoff();
    notifyStateChanged(true);
    if (result.accountIds.length > 0) {
      await refreshAccounts(result.accountIds);
    }
    return { ok: true, ...result };
  }

  /**
   * @param {string} [v1Dir]
   */
  async function importV1Dir(v1Dir) {
    const dir = v1Dir || path.join(os.homedir(), '.antigravity-agent');
    const result = await importExport.importFromV1Dir(dir, {
      store,
      fetch: options.fetch,
      onProgress: (/** @type {any} */ p) => {
        try { options.onImportProgress?.(p); } catch (_) {}
      }
    });
    if (result.accountIds.length > 0) resetEmptyPoolBackoff();
    notifyStateChanged(true);
    if (result.accountIds.length > 0) {
      await refreshAccounts(result.accountIds);
    }
    return { ok: true, ...result };
  }

  /**
   * @param {string[]} [accountIds]
   */
  function exportJson(accountIds = []) {
    return importExport.exportAccountsToJson(store, accountIds);
  }

  /**
   * @param {unknown} limitsPayload
   * @returns {string}
   */
  function extractLocalRpcAccountEmail(limitsPayload) {
    const providers = Array.isArray(limitsPayload)
      ? limitsPayload
      : (limitsPayload && typeof limitsPayload === 'object' && Array.isArray(/** @type {any} */ (limitsPayload).providers)
          ? /** @type {any} */ (limitsPayload).providers
          : []);
    for (const row of providers) {
      if (row && row.provider === 'antigravity' && row.source === 'rpc' && row.status === 'ok') {
        const email = String(row.accountEmail || '').trim().toLowerCase();
        if (email) return email;
      }
    }
    return '';
  }

  /**
   * @param {number} ms
   * @returns {Promise<void>}
   */
  function waitUnref(ms) {
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(), ms);
      t.unref?.();
    });
  }

  /**
   * @param {string} accountId
   * @param {string} [targetClient]
   * @param {{ forceRestart?: boolean, verifyHotSwitch?: boolean, autoResume?: boolean }} [switchOpts]
   */
  async function switchAccountTo(accountId, targetClient, switchOpts = {}) {
    if (switching) return { ok: false, error: 'Account switch already in progress' };
    const account = store.getAccount(accountId);
    if (!account) return { ok: false, error: 'Account not found' };
    const tokenData = store.getAccountToken(accountId);
    if (!tokenData) return { ok: false, error: 'Account has no stored token' };
    const cfg = store.getConfig();
    const target = targetClient || cfg.defaultSwitchTarget || 'auto';
    const switcherDepsObj = {
      nowSec: nowSecFn,
      ...(options.switcherDeps || {}),
      fetch: options.fetch,
      customExecutablePaths: cfg.customExecutablePaths
    };
    const shouldAutoResume = (
      cfg.autoResumeEnabled !== false
      && switchOpts?.autoResume !== false
      && (!options.switcherDeps || Boolean(options.taskResumeDeps))
    );
    const nowForRecent = nowMsFn();
    for (const [cid, seenAt] of recentRunningConversations) {
      if (nowForRecent - seenAt > 5 * 60_000) recentRunningConversations.delete(cid);
    }
    const resumeApi = /** @type {typeof taskResume} */ (options.taskResumeDeps?.api || taskResume);
    const interruptedBeforeSwitch = shouldAutoResume
      ? resumeApi.snapshotInterruptedConversations({
          ...(options.taskResumeDeps || {}),
          recentlyRunningIds: recentRunningConversations.keys(),
          nowMs: nowForRecent
        })
      : [];

    switching = true;
    switchingAccountId = account.id;
    notifyStateChanged(false);
    let switchedOk = false;
    try {
      /** @type {any} */
      let res = await switcher.switchAccount({
        account,
        tokenData,
        targetClient: target,
        forceRestart: Boolean(switchOpts?.forceRestart),
        store,
        deps: switcherDepsObj
      });
      // On Windows / Electron builds where `Antigravity.exe` caches `state.vscdb` OAuth in memory
      // and re-injects the previous account into a respawned language_server, verify the live RPC
      // identity after a hot-switch and fall back to a clean full restart when still mismatched.
      if (
        res?.ok
        && res?.mode === 'hot'
        && !switchOpts?.forceRestart
        && switchOpts?.verifyHotSwitch !== false
        && typeof options.probeLocalLimits === 'function'
        && account.email
      ) {
        try {
          await waitUnref(HOT_SWITCH_VERIFY_DELAY_MS);
          if (!stopped) {
            const verifySnapshot = await options.probeLocalLimits();
            const liveEmail = extractLocalRpcAccountEmail(verifySnapshot);
            const expectedEmail = String(account.email || '').trim().toLowerCase();
            if (liveEmail && expectedEmail && liveEmail !== expectedEmail) {
              logger.warn?.(`Hot-switch kept ${liveEmail} instead of ${expectedEmail}; falling back to full restart`);
              res = await switcher.switchAccount({
                account,
                tokenData,
                targetClient: target,
                forceRestart: true,
                store,
                deps: switcherDepsObj
              });
            }
          }
        } catch (_) {}
      }
      switchedOk = Boolean(res?.ok);
      if (switchedOk && !autoSwitchInFlight) {
        resetAutoSwitchCooldown();
      }
      if (switchedOk && shouldAutoResume && interruptedBeforeSwitch.length > 0 && !stopped) {
        try {
          const resumeOutcome = await resumeApi.resumeInterruptedConversations(interruptedBeforeSwitch, {
            ...(options.taskResumeDeps || {}),
            prompt: cfg.autoResumePrompt
          });
          if (resumeOutcome.resumedIds.length > 0) {
            for (const cid of resumeOutcome.resumedIds) recentRunningConversations.delete(cid);
          }
          res = {
            ...res,
            resumedConversations: resumeOutcome.resumedIds,
            resumedCount: resumeOutcome.resumedIds.length,
            ...(resumeOutcome.error ? { resumeError: resumeOutcome.error } : {})
          };
        } catch (resumeErr) {
          res = {
            ...res,
            resumedConversations: [],
            resumedCount: 0,
            resumeError: resumeErr instanceof Error ? resumeErr.message : String(resumeErr)
          };
        }
      }
      return res;
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      switching = false;
      switchingAccountId = null;
      notifyStateChanged(switchedOk);
    }
  }

  /**
   * @param {string} [targetClient]
   */
  async function switchBestAccount(targetClient) {
    const cfg = store.getConfig();
    const target = targetClient || cfg.defaultSwitchTarget || 'auto';
    const active = store.getActiveAccounts();
    const activeIdForTarget = target === 'classic' || target === 'ide' || target === 'agy' || target === 'acp'
      ? active[target]
      : null;
    const allAccounts = store.listAccounts();
    let best = switcher.pickBestAccount(allAccounts, {
      selectionMode: cfg.selectionMode,
      thresholdPercent: cfg.autoSwitchThresholdPercent,
      scope: cfg.autoSwitchScope,
      ...(activeIdForTarget ? { excludeIds: [activeIdForTarget] } : {})
    });
    if (!best && activeIdForTarget) {
      best = switcher.pickBestAccount(allAccounts, {
        selectionMode: cfg.selectionMode,
        thresholdPercent: cfg.autoSwitchThresholdPercent,
        scope: cfg.autoSwitchScope
      });
    }
    if (!best) {
      best = switcher.pickBestAccount(allAccounts);
    }
    if (!best) return { ok: false, error: 'No eligible active account found' };
    return await switchAccountTo(best.id, target);
  }

  /**
   * Best-effort local credential inspection when RPC `GetUserStatus` omits `accountEmail`
   * (e.g. timeout on Windows socket check), so the currently logged-in account is never re-picked.
   * @returns {Promise<{ emails: string[], accountIds: string[] }>}
   */
  async function detectLocalLoggedInAccountHints() {
    /** @type {Set<string>} */
    const emails = new Set();
    /** @type {Set<string>} */
    const refreshTokens = new Set();
    const canInspectRealHost = !options.switcherDeps;
    const krApi = options.switcherDeps?.keyring || (canInspectRealHost ? keyring : null);
    const fcApi = options.switcherDeps?.fileCredentials || (canInspectRealHost ? fileCredentials : null);

    if (krApi) {
      try {
        const kr = typeof krApi.readFromSystemKeyringAsync === 'function'
          ? await krApi.readFromSystemKeyringAsync(options.switcherDeps || {})
          : (typeof krApi.readFromSystemKeyring === 'function' ? krApi.readFromSystemKeyring(options.switcherDeps || {}) : null);
        if (kr?.email) emails.add(String(kr.email).trim().toLowerCase());
        if (kr?.refreshToken) refreshTokens.add(String(kr.refreshToken).trim());
      } catch (_) {}
    }
    if (fcApi) {
      try {
        const files = typeof fcApi.readLocalCredentialFilesAsync === 'function'
          ? await fcApi.readLocalCredentialFilesAsync(options.switcherDeps || {})
          : (typeof fcApi.readLocalCredentialFiles === 'function' ? fcApi.readLocalCredentialFiles(options.switcherDeps || {}) : []);
        for (const item of Array.isArray(files) ? files : []) {
          if (item?.email) emails.add(String(item.email).trim().toLowerCase());
          if (item?.refreshToken) refreshTokens.add(String(item.refreshToken).trim());
        }
      } catch (_) {}
    }

    /** @type {Set<string>} */
    const accountIds = new Set();
    if (emails.size > 0 || refreshTokens.size > 0) {
      for (const acc of store.listAccounts()) {
        if (acc.email && emails.has(acc.email.toLowerCase())) {
          accountIds.add(acc.id);
          continue;
        }
        if (refreshTokens.size > 0) {
          const tok = store.getAccountToken(acc.id);
          if (tok?.refreshToken && refreshTokens.has(tok.refreshToken)) {
            accountIds.add(acc.id);
            if (acc.email) emails.add(acc.email.toLowerCase());
          }
        }
      }
    }
    return { emails: [...emails], accountIds: [...accountIds] };
  }

  /**
   * @param {ReturnType<typeof autoSwitch.evaluateLocalQuotaTrigger>} evalRes
   */
  async function runAutoSwitchFlow(evalRes) {
    if (stopped || autoSwitchInFlight || switching) {
      return { ok: false, skipped: 'busy' };
    }
    autoSwitchInFlight = true;
    pendingAutoSwitchLimits = null;
    notifyStateChanged(false);

    const initialCfg = store.getConfig();
    /** @type {{ classicRunning: boolean, ideRunning: boolean } | null} */
    let activeClients = null;
    if (!options.switcherDeps || options.switcherDeps.processManager) {
      try {
        const pmApi = options.switcherDeps?.processManager || processManager;
        const procs = typeof pmApi.listProcessesAsync === 'function'
          ? await pmApi.listProcessesAsync(options.switcherDeps || {})
          : (typeof pmApi.listProcesses === 'function' ? pmApi.listProcesses(options.switcherDeps || {}) : null);
        const procDeps = procs ? { ...(options.switcherDeps || {}), listProcesses: () => procs } : (options.switcherDeps || {});
        if (typeof pmApi.isAntigravityRunning === 'function') {
          activeClients = {
            classicRunning: Boolean(pmApi.isAntigravityRunning('classic', procDeps)),
            ideRunning: Boolean(pmApi.isAntigravityRunning('ide', procDeps))
          };
        }
      } catch (_) {}
    }
    const targetClient = autoSwitch.resolveSwitchTargetForTrigger(
      initialCfg.defaultSwitchTarget,
      evalRes.sourceDetail,
      activeClients
    );

    try {
      if (scheduler.isRefreshing()) {
        await waitForActiveRefresh();
      } else {
        const nowSec = Math.floor(nowMsFn() / 1000);
        const lastSec = scheduler.getLastRefreshTimestamp();
        const candidates = store.listAccounts().filter((a) => !a.disabled && !a.banned && a.hasToken);
        const hasUnfetchedCandidate = candidates.some((a) => !a.quota?.lastUpdatedAt);
        if (candidates.length > 0 && (lastSec <= 0 || nowSec - lastSec >= 45 || hasUnfetchedCandidate)) {
          await refreshAccounts([]);
        }
      }

      if (stopped) return { ok: false, skipped: 'stopped' };
      const freshCfg = store.getConfig();
      if (!freshCfg.autoSwitchEnabled) {
        return { ok: false, skipped: 'disabled' };
      }

      const active = store.getActiveAccounts();
      /** @type {Set<string>} */
      const excludeIdSet = new Set();
      /** @type {Set<string>} */
      const excludeEmailSet = new Set();
      if (evalRes.accountEmail) {
        excludeEmailSet.add(evalRes.accountEmail);
        const matched = store.findAccountByEmail(evalRes.accountEmail);
        if (matched?.id) excludeIdSet.add(matched.id);
      } else {
        const slot = targetClient === 'ide' || (targetClient === 'auto' && activeClients?.ideRunning && !activeClients?.classicRunning)
          ? 'ide'
          : (targetClient === 'agy' ? 'agy' : (targetClient === 'acp' ? 'acp' : 'classic'));
        const slotId = active[slot];
        if (slotId) excludeIdSet.add(slotId);
        const localHints = await detectLocalLoggedInAccountHints();
        for (const id of localHints.accountIds) excludeIdSet.add(id);
        for (const em of localHints.emails) excludeEmailSet.add(em);
      }

      const best = autoSwitch.selectReplacementAccount(store.listAccounts(), {
        selectionMode: freshCfg.selectionMode,
        thresholdPercent: freshCfg.autoSwitchThresholdPercent,
        scope: freshCfg.autoSwitchScope,
        excludeIds: excludeIdSet,
        excludeEmails: excludeEmailSet,
        excludeAccountKeys: evalRes.accountKey ? [evalRes.accountKey] : [],
        preferredFamilies: evalRes.exhaustedFamilies,
        requireVerifiedQuota: true
      });

      if (!best) {
        const emptyRecord = {
          at: nowMsFn(),
          fromEmail: evalRes.accountEmail || '',
          toEmail: '',
          target: targetClient,
          mode: '',
          triggerLabel: evalRes.triggerLabel,
          ok: false,
          error: 'No eligible unexhausted account in pool'
        };
        lastAutoSwitch = emptyRecord;
        lastAutoSwitchAttemptMs = nowMsFn();
        lastAutoSwitchWasEmptyPool = true;
        try { options.onAutoSwitchCompleted?.(emptyRecord); } catch (_) {}
        return { ok: false, error: emptyRecord.error, lastAutoSwitch: emptyRecord };
      }

      lastAutoSwitchAttemptMs = nowMsFn();
      lastAutoSwitchWasEmptyPool = false;
      /** @type {any} */
      const switchRes = await switchAccountTo(best.id, targetClient);
      const record = {
        at: nowMsFn(),
        fromEmail: evalRes.accountEmail || '',
        toEmail: best.email || best.id,
        target: String(switchRes?.target || targetClient),
        mode: String(switchRes?.mode || ''),
        triggerLabel: evalRes.triggerLabel,
        ok: Boolean(switchRes?.ok),
        resumedCount: Number(switchRes?.resumedCount || 0),
        resumedConversations: Array.isArray(switchRes?.resumedConversations) ? switchRes.resumedConversations : [],
        ...(switchRes?.resumeError ? { resumeError: String(switchRes.resumeError) } : {}),
        ...(switchRes?.error ? { error: String(switchRes.error) } : {})
      };
      lastAutoSwitch = record;
      try { options.onAutoSwitchCompleted?.(record); } catch (_) {}
      return { ...switchRes, account: best, lastAutoSwitch: record };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const errRecord = {
        at: nowMsFn(),
        fromEmail: evalRes.accountEmail || '',
        toEmail: '',
        target: targetClient,
        mode: '',
        triggerLabel: evalRes.triggerLabel,
        ok: false,
        error: errMsg
      };
      lastAutoSwitch = errRecord;
      lastAutoSwitchAttemptMs = nowMsFn();
      try { options.onAutoSwitchCompleted?.(errRecord); } catch (_) {}
      return { ok: false, error: errMsg, lastAutoSwitch: errRecord };
    } finally {
      autoSwitchInFlight = false;
      notifyStateChanged(false);
    }
  }

  /**
   * Evaluate a read-only local Antigravity RPC limits snapshot and trigger auto-switch when exhausted.
   * @param {unknown} limits
   */
  async function onLocalLimitsUpdated(limits) {
    if (stopped) return { triggered: false, skipped: 'stopped' };
    const cfg = store.getConfig();
    if (!cfg.autoSwitchEnabled) {
      pendingAutoSwitchLimits = null;
      return { triggered: false, skipped: 'disabled' };
    }
    const evalRes = autoSwitch.evaluateLocalQuotaTrigger(limits, cfg);
    if (!evalRes.triggered) {
      pendingAutoSwitchLimits = null;
      return { triggered: false, skipped: 'within_quota' };
    }
    if (autoSwitchInFlight || switching) {
      return { triggered: true, skipped: 'in_flight' };
    }
    const now = nowMsFn();
    const baseCooldownMs = Math.max(30, Number(cfg.autoSwitchCooldownSeconds || 180)) * 1000;
    const effectiveCooldownMs = lastAutoSwitchWasEmptyPool
      ? Math.max(baseCooldownMs, 300_000)
      : baseCooldownMs;
    if (lastAutoSwitchAttemptMs > 0 && now - lastAutoSwitchAttemptMs < effectiveCooldownMs) {
      return { triggered: true, skipped: 'cooldown' };
    }
    if (!evalRes.hardExhausted && options.isLocalAntigravityBusy?.() === true) {
      pendingAutoSwitchLimits = limits;
      return { triggered: true, skipped: 'session_busy' };
    }
    const outcome = await runAutoSwitchFlow(evalRes);
    return { triggered: true, ...outcome };
  }

  /**
   * @param {{ busy?: boolean, runningConversationIds?: string[] }} [activityInfo]
   */
  function onLocalActivityChanged(activityInfo) {
    if (stopped) return null;
    const now = nowMsFn();
    if (Array.isArray(activityInfo?.runningConversationIds)) {
      for (const rawId of activityInfo.runningConversationIds) {
        const cid = String(rawId || '').trim();
        if (cid) recentRunningConversations.set(cid, now);
      }
    }
    const isNowBusy = typeof activityInfo?.busy === 'boolean'
      ? activityInfo.busy
      : options.isLocalAntigravityBusy?.() === true;
    const previouslyBusy = wasLocalAntigravityBusy;
    wasLocalAntigravityBusy = isNowBusy;

    if (!isNowBusy && pendingAutoSwitchLimits) {
      const queued = pendingAutoSwitchLimits;
      pendingAutoSwitchLimits = null;
      return onLocalLimitsUpdated(queued);
    }

    if (store.getConfig().autoSwitchEnabled && typeof options.probeLocalLimits === 'function') {
      if (previouslyBusy && !isNowBusy) {
        scheduleLocalQuotaProbe(AUTO_SWITCH_TURN_END_DELAY_MS, 'turn_end', true);
      } else {
        scheduleLocalQuotaProbe(AUTO_SWITCH_ACTIVITY_DEBOUNCE_MS, 'activity', false);
      }
    }
    return null;
  }

  /**
   * @param {string[]} ids
   */
  function deleteAccounts(ids) {
    const removed = store.deleteAccounts(ids);
    notifyStateChanged(true);
    return { ok: true, removed };
  }

  /**
   * @param {string} id
   * @param {boolean} disabled
   */
  function setAccountDisabled(id, disabled) {
    const acc = store.getAccount(id);
    if (!acc) return { ok: false, error: 'Account not found' };
    const nextDisabled = Boolean(disabled);
    store.upsertAccount({
      ...acc,
      disabled: nextDisabled,
      disabledReason: nextDisabled ? 'Manually disabled' : '',
      disabledAt: nextDisabled ? Math.floor(Date.now() / 1000) : null
    });
    if (!nextDisabled) resetEmptyPoolBackoff();
    notifyStateChanged(true);
    return { ok: true, account: store.getAccount(id) };
  }

  /**
   * @param {string} id
   * @param {unknown} weight
   */
  function setAccountWeight(id, weight) {
    const updated = store.setAccountWeight(id, weight);
    if (!updated) return { ok: false, error: 'Account not found' };
    resetEmptyPoolBackoff();
    notifyStateChanged(false);
    return { ok: true, account: updated };
  }

  function resolveExistingDesktopStoragePath() {
    const classicPath = deviceProfile.getStoragePath('classic');
    if (classicPath && fs.existsSync(classicPath)) return classicPath;
    const idePath = deviceProfile.getStoragePath('ide');
    if (idePath && fs.existsSync(idePath)) return idePath;
    return classicPath || idePath || '';
  }

  /**
   * @param {string} id
   * @param {'generate' | 'capture'} [mode]
   */
  function bindDeviceProfile(id, mode = 'generate') {
    const acc = store.getAccount(id);
    if (!acc) return { ok: false, error: 'Account not found' };
    try {
      const existingStorage = resolveExistingDesktopStoragePath();
      const orig = existingStorage ? deviceProfile.readDeviceProfile(existingStorage) : null;
      if (orig) store.saveOriginalDeviceProfileIfMissing(orig);
      const profile = mode === 'capture'
        ? (orig || deviceProfile.generateDeviceProfile())
        : deviceProfile.generateDeviceProfile();
      const updated = store.upsertAccount({ ...acc, deviceProfile: profile });
      notifyStateChanged(true);
      return { ok: true, account: updated, deviceProfile: profile };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  function restoreOriginalDevice() {
    const orig = store.getOriginalDeviceProfile();
    if (!orig) return { ok: false, error: 'No original device backup found' };
    const storagePath = resolveExistingDesktopStoragePath();
    if (!storagePath) return { ok: false, error: 'storage.json not found' };
    try {
      deviceProfile.writeDeviceProfile(storagePath, orig);
      return { ok: true, storagePath };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  function detectActiveClients() {
    const procs = processManager.listProcesses();
    const procDeps = { listProcesses: () => procs };
    const defaultDataDir = importExport.defaultManagerDataDir();
    return {
      classicRunning: processManager.isAntigravityRunning('classic', procDeps),
      ideRunning: processManager.isAntigravityRunning('ide', procDeps),
      agyRunning: processManager.isProcessRunningByName('agy', procDeps),
      acpRunning: processManager.isProcessRunningByName('agy_acp_server', procDeps),
      defaultDataDir,
      defaultDataDirExists: Boolean(defaultDataDir && fs.existsSync(defaultDataDir))
    };
  }

  async function detectActiveClientsAsync() {
    const procs = await processManager.listProcessesAsync();
    const procDeps = { listProcesses: () => procs };
    const defaultDataDir = importExport.defaultManagerDataDir();
    let defaultDataDirExists = false;
    if (defaultDataDir) {
      try {
        await fs.promises.access(defaultDataDir);
        defaultDataDirExists = true;
      } catch (_) {}
    }
    return {
      classicRunning: processManager.isAntigravityRunning('classic', procDeps),
      ideRunning: processManager.isAntigravityRunning('ide', procDeps),
      agyRunning: processManager.isProcessRunningByName('agy', procDeps),
      acpRunning: processManager.isProcessRunningByName('agy_acp_server', procDeps),
      defaultDataDir,
      defaultDataDirExists
    };
  }

  function start() {
    started = true;
    scheduler.start();
    reconcileAutoSwitchMonitor();
    if (store.getConfig().autoSwitchEnabled && typeof options.probeLocalLimits === 'function') {
      scheduleLocalQuotaProbe(AUTO_SWITCH_STARTUP_DELAY_MS, 'startup', true);
    }
    scheduleHubSync();
  }

  function stop() {
    stopped = true;
    started = false;
    pendingAutoSwitchLimits = null;
    clearAutoSwitchMonitorTimers();
    scheduler.stop();
    resolveRefreshWaiters();
    clearRefreshStateTimer();
    if (hubSyncTimer) {
      clearTimeout(hubSyncTimer);
      hubSyncTimer = null;
    }
    activeRefreshAbort?.abort();
    activeOAuthAbort?.abort();
  }

  return {
    start,
    stop,
    getState,
    updateConfig,
    refreshAccounts,
    refreshAccount,
    cancelRefresh,
    startOAuthLogin,
    cancelOAuthLogin,
    importFromString,
    importDataDir,
    importStateDb,
    scanLocalAccounts,
    importV1Dir,
    exportJson,
    switchAccountTo,
    switchBestAccount,
    onLocalLimitsUpdated,
    onLocalActivityChanged,
    deleteAccounts,
    setAccountDisabled,
    setAccountWeight,
    bindDeviceProfile,
    restoreOriginalDevice,
    detectActiveClients,
    detectActiveClientsAsync,
    pushSnapshotToHubNow
  };
}

module.exports = { createAntigravityManagerService };
