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
 *   onStateChanged?: (state: any) => void,
 *   onRefreshProgress?: (progress: any) => void,
 *   onImportProgress?: (progress: any) => void,
 *   logger?: { log?: Function, warn?: Function, error?: Function },
 *   schedulerOptions?: { pollMs?: number, startupDelayMs?: number }
 * }} options
 */
function createAntigravityManagerService(options) {
  const logger = options.logger || console;
  const store = createAntigravityManagerStore({
    baseDir: options.baseDir,
    safeStorage: options.safeStorage || null,
    logger
  });
  const healthTracker = new quota.EndpointHealthTracker();
  const REFRESH_STATE_THROTTLE_MS = 280;
  /** @type {AbortController | null} */
  let activeRefreshAbort = null;
  /** @type {AbortController | null} */
  let activeOAuthAbort = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let hubSyncTimer = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let refreshStateTimer = null;
  let lastRefreshStateEmitMs = 0;
  let switching = false;
  /** @type {string | null} */
  let switchingAccountId = null;
  let stopped = false;

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
    pollMs: options.schedulerOptions?.pollMs,
    startupDelayMs: options.schedulerOptions?.startupDelayMs
  });

  function getState() {
    return {
      ...store.getStateForRenderer(),
      isRefreshing: scheduler.isRefreshing(),
      lastRefreshAt: scheduler.getLastRefreshTimestamp(),
      isSwitching: switching,
      switchingAccountId
    };
  }

  /**
   * @param {Record<string, any>} patch
   */
  function updateConfig(patch) {
    const updated = store.updateConfig(patch);
    notifyStateChanged(true);
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
   * @param {string} accountId
   * @param {string} [targetClient]
   */
  async function switchAccountTo(accountId, targetClient) {
    if (switching) return { ok: false, error: 'Account switch already in progress' };
    const account = store.getAccount(accountId);
    if (!account) return { ok: false, error: 'Account not found' };
    const tokenData = store.getAccountToken(accountId);
    if (!tokenData) return { ok: false, error: 'Account has no stored token' };
    const cfg = store.getConfig();
    const target = targetClient || cfg.defaultSwitchTarget || 'auto';
    switching = true;
    switchingAccountId = account.id;
    notifyStateChanged(false);
    let switchedOk = false;
    try {
      const res = await switcher.switchAccount({
        account,
        tokenData,
        targetClient: target,
        store,
        deps: {
          fetch: options.fetch,
          customExecutablePaths: cfg.customExecutablePaths
        }
      });
      switchedOk = Boolean(res?.ok);
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
    const best = switcher.pickBestAccount(store.listAccounts());
    if (!best) return { ok: false, error: 'No eligible active account found' };
    return await switchAccountTo(best.id, targetClient);
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
    notifyStateChanged(true);
    return { ok: true, account: store.getAccount(id) };
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
    scheduler.start();
    scheduleHubSync();
  }

  function stop() {
    stopped = true;
    scheduler.stop();
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
    deleteAccounts,
    setAccountDisabled,
    bindDeviceProfile,
    restoreOriginalDevice,
    detectActiveClients,
    detectActiveClientsAsync,
    pushSnapshotToHubNow
  };
}

module.exports = { createAntigravityManagerService };
