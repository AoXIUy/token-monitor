// @ts-check
'use strict';

const oauth = require('./oauth');
const stateDb = require('./stateDb');
const keyring = require('./keyring');
const fileCredentials = require('./fileCredentials');
const deviceProfile = require('./deviceProfile');
const processManager = require('./processManager');

/**
 * Target environment resolver matching Antigravity-Manager integration.rs.
 * Classic desktop app takes priority when targetIde is omitted.
 *
 * @param {string | null | undefined} targetIde
 * @param {{
 *   classicRunning: boolean,
 *   ideRunning: boolean,
 *   hasClassicExe: boolean,
 *   ideExePath?: string | null
 * }} state
 * @returns {{ isIde: boolean, effectiveTarget: 'classic' | 'ide' | null }}
 */
function resolveEffectiveTarget(targetIde, state) {
  if (targetIde === 'ide') return { isIde: true, effectiveTarget: 'ide' };
  if (targetIde === 'classic') return { isIde: false, effectiveTarget: 'classic' };

  let isIde = false;
  if (state.classicRunning) isIde = false;
  else if (state.ideRunning) isIde = true;
  else if (state.hasClassicExe) isIde = false;
  else if (state.ideExePath && processManager.isAntigravityIdeStr(state.ideExePath)) isIde = true;

  return { isIde, effectiveTarget: isIde ? 'ide' : null };
}

/**
 * Write credentials + device profile + state.vscdb according to Classic vs IDE rules.
 *
 * @param {Record<string, any>} account
 * @param {Record<string, any>} tokenData
 * @param {{
 *   isIde: boolean,
 *   effectiveTarget: 'classic' | 'ide' | null,
 *   activeExePath: string | null,
 *   deps?: Record<string, any>
 * }} ctx
 */
function applyAccountCredentials(account, tokenData, { isIde, effectiveTarget, activeExePath, deps = {} }) {
  const isTargetIde = isIde
    || effectiveTarget === 'ide'
    || (effectiveTarget !== 'classic' && Boolean(activeExePath && processManager.isAntigravityIdePath(activeExePath)));

  const dbPath = (deps.stateDb || stateDb).getDbPath(effectiveTarget, deps);
  const storagePath = (deps.deviceProfile || deviceProfile).getStoragePath(effectiveTarget, deps);

  if (account.deviceProfile && storagePath) {
    try {
      (deps.deviceProfile || deviceProfile).writeDeviceProfile(storagePath, account.deviceProfile, deps);
    } catch (_) {}
  }

  if (isTargetIde) {
    (deps.stateDb || stateDb).injectTokenToDb(dbPath, {
      accessToken: tokenData.accessToken,
      refreshToken: tokenData.refreshToken,
      expiry: tokenData.expiryTimestamp,
      email: account.email,
      isGcpTos: tokenData.isGcpTos,
      projectId: tokenData.projectId,
      idToken: tokenData.idToken,
      oauthClientKey: tokenData.oauthClientKey
    }, deps);

    if (account.deviceProfile?.macMachineId) {
      try {
        (deps.stateDb || stateDb).writeServiceMachineId(dbPath, account.deviceProfile.macMachineId, deps);
      } catch (_) {}
    }

    try {
      (deps.keyring || keyring).writeToSystemKeyring({
        accessToken: tokenData.accessToken,
        refreshToken: tokenData.refreshToken,
        expiryTimestamp: tokenData.expiryTimestamp,
        email: account.email,
        idToken: tokenData.idToken
      }, deps);
    } catch (_) {}

    try {
      (deps.fileCredentials || fileCredentials).writeFileCredentials({
        accessToken: tokenData.accessToken,
        refreshToken: tokenData.refreshToken,
        expiryTimestamp: tokenData.expiryTimestamp,
        email: account.email,
        idToken: tokenData.idToken
      }, { ...deps, syncAgyCli: false });
    } catch (_) {}

    return;
  }

  // Classic desktop target: >= 2.0.0 uses keyring (+ file fallback), < 2.0.0 uses SQLite.
  const version = (deps.processManager || processManager).detectAntigravityVersion(activeExePath);
  const useKeyring = version
    ? (deps.processManager || processManager).compareSemver(version, '2.0.0') >= 0
    : !(deps.fs ? deps.fs.existsSync(dbPath) : require('node:fs').existsSync(dbPath));

  if (useKeyring) {
    (deps.keyring || keyring).writeToSystemKeyring({
      accessToken: tokenData.accessToken,
      refreshToken: tokenData.refreshToken,
      expiryTimestamp: tokenData.expiryTimestamp,
      email: account.email,
      idToken: tokenData.idToken
    }, deps);
    if (deps.fs ? deps.fs.existsSync(dbPath) : require('node:fs').existsSync(dbPath)) {
      try {
        (deps.stateDb || stateDb).injectTokenToDb(dbPath, {
          accessToken: tokenData.accessToken,
          refreshToken: tokenData.refreshToken,
          expiry: tokenData.expiryTimestamp,
          email: account.email,
          isGcpTos: tokenData.isGcpTos,
          projectId: tokenData.projectId,
          idToken: tokenData.idToken,
          oauthClientKey: tokenData.oauthClientKey
        }, deps);
      } catch (_) {}
    }
  } else {
    (deps.stateDb || stateDb).injectTokenToDb(dbPath, {
      accessToken: tokenData.accessToken,
      refreshToken: tokenData.refreshToken,
      expiry: tokenData.expiryTimestamp,
      email: account.email,
      isGcpTos: tokenData.isGcpTos,
      projectId: tokenData.projectId,
      idToken: tokenData.idToken,
      oauthClientKey: tokenData.oauthClientKey
    }, deps);
  }

  if (account.deviceProfile?.macMachineId && (deps.fs ? deps.fs.existsSync(dbPath) : require('node:fs').existsSync(dbPath))) {
    try {
      (deps.stateDb || stateDb).writeServiceMachineId(dbPath, account.deviceProfile.macMachineId, deps);
    } catch (_) {}
  }

  try {
    (deps.fileCredentials || fileCredentials).writeFileCredentials({
      accessToken: tokenData.accessToken,
      refreshToken: tokenData.refreshToken,
      expiryTimestamp: tokenData.expiryTimestamp,
      email: account.email,
      idToken: tokenData.idToken
    }, { ...deps, syncAgyCli: false });
  } catch (_) {}
}

/**
 * Async variant of `applyAccountCredentials` that consolidates SQLite writes into a single
 * transaction and runs file/keyring/backup I/O without blocking Electron's main thread.
 *
 * @param {Record<string, any>} account
 * @param {Record<string, any>} tokenData
 * @param {{
 *   isIde: boolean,
 *   effectiveTarget: 'classic' | 'ide' | null,
 *   activeExePath: string | null,
 *   deps?: Record<string, any>
 * }} ctx
 */
async function applyAccountCredentialsAsync(account, tokenData, { isIde, effectiveTarget, activeExePath, deps = {} }) {
  const pm = deps.processManager || processManager;
  const sdb = deps.stateDb || stateDb;
  const dp = deps.deviceProfile || deviceProfile;
  const kr = deps.keyring || keyring;
  const fc = deps.fileCredentials || fileCredentials;
  const fsApi = deps.fs || require('node:fs');

  const isTargetIde = isIde
    || effectiveTarget === 'ide'
    || (effectiveTarget !== 'classic' && Boolean(activeExePath && processManager.isAntigravityIdePath(activeExePath)));

  const dbPath = sdb.getDbPath(effectiveTarget, deps);
  const storagePath = dp.getStoragePath(effectiveTarget, deps);
  const hasAsyncInject = typeof sdb.injectTokenToDbAsync === 'function';

  /** @param {string} p */
  const pathExists = async (p) => {
    if (!p) return false;
    if (deps.fs?.existsSync) return Boolean(deps.fs.existsSync(p));
    try {
      await fsApi.promises.access(p);
      return true;
    } catch (_) {
      return false;
    }
  };

  const writeKeyringSafe = async () => {
    const payload = {
      accessToken: tokenData.accessToken,
      refreshToken: tokenData.refreshToken,
      expiryTimestamp: tokenData.expiryTimestamp,
      email: account.email,
      idToken: tokenData.idToken
    };
    if (typeof kr.writeToSystemKeyringAsync === 'function') {
      await kr.writeToSystemKeyringAsync(payload, deps);
    } else {
      kr.writeToSystemKeyring(payload, deps);
    }
  };

  const writeFilesSafe = async () => {
    const payload = {
      accessToken: tokenData.accessToken,
      refreshToken: tokenData.refreshToken,
      expiryTimestamp: tokenData.expiryTimestamp,
      email: account.email,
      idToken: tokenData.idToken
    };
    const fileOpts = { ...deps, syncAgyCli: false };
    try {
      if (typeof fc.writeFileCredentialsAsync === 'function') {
        await fc.writeFileCredentialsAsync(payload, fileOpts);
      } else {
        fc.writeFileCredentials(payload, fileOpts);
      }
    } catch (_) {}
  };

  /** @param {boolean} includeStorageMachineId */
  const injectDb = async (includeStorageMachineId) => {
    const dbPayload = {
      accessToken: tokenData.accessToken,
      refreshToken: tokenData.refreshToken,
      expiry: tokenData.expiryTimestamp,
      email: account.email,
      isGcpTos: tokenData.isGcpTos,
      projectId: tokenData.projectId,
      idToken: tokenData.idToken,
      oauthClientKey: tokenData.oauthClientKey,
      ...(hasAsyncInject && account.deviceProfile?.macMachineId
        ? { serviceMachineId: account.deviceProfile.macMachineId }
        : {}),
      ...(hasAsyncInject && includeStorageMachineId && account.deviceProfile?.devDeviceId
        ? { storageServiceMachineId: account.deviceProfile.devDeviceId }
        : {})
    };
    if (hasAsyncInject) {
      await sdb.injectTokenToDbAsync(dbPath, dbPayload, deps);
    } else {
      sdb.injectTokenToDb(dbPath, dbPayload, deps);
      if (account.deviceProfile?.macMachineId && typeof sdb.writeServiceMachineId === 'function') {
        try { sdb.writeServiceMachineId(dbPath, account.deviceProfile.macMachineId, deps); } catch (_) {}
      }
    }
  };

  if (isTargetIde) {
    if (account.deviceProfile && storagePath) {
      try {
        if (typeof dp.writeDeviceProfileAsync === 'function') {
          await dp.writeDeviceProfileAsync(storagePath, account.deviceProfile, { ...deps, skipDbSync: hasAsyncInject });
        } else {
          dp.writeDeviceProfile(storagePath, account.deviceProfile, { ...deps, skipDbSync: hasAsyncInject });
        }
      } catch (_) {}
    }

    await injectDb(Boolean(account.deviceProfile && storagePath));

    await Promise.all([
      writeKeyringSafe().catch(() => {}),
      writeFilesSafe()
    ]);
    return;
  }

  // Classic desktop target: >= 2.0.0 uses keyring (+ file fallback), < 2.0.0 uses SQLite.
  const version = typeof pm.detectAntigravityVersionAsync === 'function'
    ? await pm.detectAntigravityVersionAsync(activeExePath)
    : pm.detectAntigravityVersion(activeExePath);
  const dbExists = await pathExists(dbPath);
  const useKeyring = version
    ? pm.compareSemver(version, '2.0.0') >= 0
    : !dbExists;
  const willInjectClassicDb = !useKeyring || dbExists;

  if (account.deviceProfile && storagePath) {
    try {
      const skipDbSync = hasAsyncInject && willInjectClassicDb;
      if (typeof dp.writeDeviceProfileAsync === 'function') {
        await dp.writeDeviceProfileAsync(storagePath, account.deviceProfile, { ...deps, skipDbSync });
      } else {
        dp.writeDeviceProfile(storagePath, account.deviceProfile, { ...deps, skipDbSync });
      }
    } catch (_) {}
  }

  if (useKeyring) {
    await writeKeyringSafe();
    if (dbExists) {
      try {
        await injectDb(Boolean(account.deviceProfile && storagePath));
      } catch (_) {}
    }
  } else {
    await injectDb(Boolean(account.deviceProfile && storagePath));
  }

  if (!hasAsyncInject && account.deviceProfile?.macMachineId && dbExists && typeof sdb.writeServiceMachineId === 'function') {
    try {
      sdb.writeServiceMachineId(dbPath, account.deviceProfile.macMachineId, deps);
    } catch (_) {}
  }

  await writeFilesSafe();
}

/**
 * Switch account for Classic, IDE, AGY CLI, ACP, or Auto.
 *
 * @param {{
 *   account: Record<string, any>,
 *   tokenData: Record<string, any>,
 *   targetClient?: string | null,
 *   store: {
 *     upsertAccount: (meta: any, token?: any) => any,
 *     saveAccountToken: (id: string, token: any) => boolean,
 *     setActiveAccount: (target: 'classic' | 'ide' | 'agy' | 'acp', id: string) => any,
 *     saveOriginalDeviceProfileIfMissing: (profile: any) => any
 *   },
 *   deps?: Record<string, any>
 * }} params
 */
async function switchAccount({ account, tokenData, targetClient = 'auto', store, deps = {} }) {
  const oauthApi = deps.oauth || oauth;
  const pm = deps.processManager || processManager;
  const kr = deps.keyring || keyring;
  const fc = deps.fileCredentials || fileCredentials;
  const dp = deps.deviceProfile || deviceProfile;

  // 1. Refresh token before switch
  const freshToken = await oauthApi.ensureFreshToken(tokenData, {
    fetch: deps.fetch,
    env: deps.env,
    signal: deps.signal,
    nowSec: deps.nowSec
  });
  if (
    freshToken.accessToken !== tokenData.accessToken
    || freshToken.refreshToken !== tokenData.refreshToken
    || freshToken.oauthClientKey !== tokenData.oauthClientKey
  ) {
    store.saveAccountToken(account.id, freshToken);
  }

  let activeAccount = account;
  /**
   * Ensure device profile isolation + backup original device profile from the effective target.
   * @param {'classic' | 'ide' | null} profileTarget
   * @param {Record<string, any>} profileDeps
   */
  const ensureDeviceProfile = async (profileTarget, profileDeps) => {
    if (activeAccount.deviceProfile) return;
    try {
      const candidates = profileTarget === 'ide' ? ['ide', 'classic'] : ['classic', 'ide'];
      for (const candidate of candidates) {
        const storagePath = dp.getStoragePath(candidate, profileDeps);
        const original = typeof dp.readDeviceProfileAsync === 'function'
          ? await dp.readDeviceProfileAsync(storagePath)
          : dp.readDeviceProfile(storagePath);
        if (original) {
          store.saveOriginalDeviceProfileIfMissing(original);
          break;
        }
      }
    } catch (_) {}
    const generated = dp.generateDeviceProfile();
    activeAccount = store.upsertAccount({ ...activeAccount, deviceProfile: generated }) || { ...activeAccount, deviceProfile: generated };
  };

  const normalizedTarget = String(targetClient || 'auto').trim().toLowerCase();

  // 3a. AGY CLI target
  if (normalizedTarget === 'agy') {
    await ensureDeviceProfile('classic', deps);
    const credPayload = {
      accessToken: freshToken.accessToken,
      refreshToken: freshToken.refreshToken,
      expiryTimestamp: freshToken.expiryTimestamp,
      email: activeAccount.email,
      idToken: freshToken.idToken
    };
    await Promise.all([
      typeof kr.writeToSystemKeyringAsync === 'function'
        ? kr.writeToSystemKeyringAsync(credPayload, deps)
        : Promise.resolve().then(() => kr.writeToSystemKeyring(credPayload, deps)),
      typeof fc.writeFileCredentialsAsync === 'function'
        ? fc.writeFileCredentialsAsync(credPayload, { ...deps, syncAgyCli: true })
        : Promise.resolve().then(() => fc.writeFileCredentials(credPayload, { ...deps, syncAgyCli: true }))
    ]);

    const stored = typeof kr.readFromSystemKeyringAsync === 'function'
      ? await kr.readFromSystemKeyringAsync(deps)
      : kr.readFromSystemKeyring(deps);
    if (!stored || stored.refreshToken !== freshToken.refreshToken) {
      throw new Error('Could not verify AGY CLI keyring credential write');
    }
    store.setActiveAccount('agy', activeAccount.id);
    return { ok: true, target: 'agy', mode: 'cli', accountId: activeAccount.id };
  }

  // 3b. ACP IDE Plugin target
  if (normalizedTarget === 'acp' || normalizedTarget === 'plugin' || normalizedTarget === 'ide-plugin') {
    await ensureDeviceProfile('classic', deps);
    const acpKeyringOpts = { ...deps, account: kr.ACP_ACCOUNT };
    const acpKeyringPayload = {
      accessToken: freshToken.accessToken,
      refreshToken: freshToken.refreshToken,
      expiryTimestamp: freshToken.expiryTimestamp,
      email: activeAccount.email,
      idToken: freshToken.idToken
    };
    const acpFilePayload = {
      ...acpKeyringPayload,
      projectId: freshToken.projectId
    };
    await Promise.all([
      (typeof kr.writeToSystemKeyringAsync === 'function'
        ? kr.writeToSystemKeyringAsync(acpKeyringPayload, acpKeyringOpts)
        : Promise.resolve().then(() => kr.writeToSystemKeyring(acpKeyringPayload, acpKeyringOpts))
      ).catch(() => {}),
      typeof fc.writeAcpCredentialsAsync === 'function'
        ? fc.writeAcpCredentialsAsync(acpFilePayload, deps)
        : Promise.resolve().then(() => fc.writeAcpCredentials(acpFilePayload, deps))
    ]);

    const killedAcp = typeof pm.killAcpServersAsync === 'function'
      ? await pm.killAcpServersAsync(deps)
      : pm.killAcpServers(deps);
    store.setActiveAccount('acp', activeAccount.id);
    return { ok: true, target: 'acp', mode: 'acp', restartedProcesses: killedAcp, accountId: activeAccount.id };
  }

  // 3c. Desktop Classic / IDE target (lazy executable lookup avoids scanning uninstalled variants)
  const explicitTarget = normalizedTarget === 'ide' ? 'ide' : (normalizedTarget === 'classic' ? 'classic' : null);
  const initialProcs = !deps.listProcesses
    ? (typeof pm.listProcessesAsync === 'function'
        ? await pm.listProcessesAsync(deps)
        : (typeof pm.listProcesses === 'function' ? pm.listProcesses(deps) : null))
    : null;
  const snapshotDeps = initialProcs ? { ...deps, listProcesses: () => initialProcs } : deps;

  /** @param {string | null} t */
  const resolveExe = async (t) => (typeof pm.getAntigravityExecutablePathAsync === 'function'
    ? await pm.getAntigravityExecutablePathAsync(t, snapshotDeps)
    : pm.getAntigravityExecutablePath(t, snapshotDeps));

  const classicRunning = pm.isAntigravityRunning(null, snapshotDeps);
  const ideRunning = pm.isAntigravityRunning('ide', snapshotDeps);

  /** @type {boolean} */
  let isIde;
  /** @type {'classic' | 'ide' | null} */
  let effectiveTarget;
  /** @type {string | null} */
  let activeExePath;

  if (explicitTarget === 'ide') {
    isIde = true;
    effectiveTarget = 'ide';
    activeExePath = await resolveExe('ide');
  } else if (explicitTarget === 'classic') {
    isIde = false;
    effectiveTarget = 'classic';
    activeExePath = await resolveExe('classic');
  } else if (classicRunning) {
    isIde = false;
    effectiveTarget = null;
    activeExePath = await resolveExe(null);
  } else if (ideRunning) {
    isIde = true;
    effectiveTarget = 'ide';
    activeExePath = await resolveExe('ide');
  } else {
    const classicExe = await resolveExe('classic');
    const ideExe = classicExe ? null : await resolveExe('ide');
    ({ isIde, effectiveTarget } = resolveEffectiveTarget(null, {
      classicRunning: false,
      ideRunning: false,
      hasClassicExe: Boolean(classicExe),
      ideExePath: ideExe
    }));
    activeExePath = isIde ? ideExe : classicExe;
  }

  const activeArgs = pm.getArgsFromRunningProcess(effectiveTarget, snapshotDeps);
  const runningUserDataDir = typeof pm.getUserDataDirFromProcess === 'function'
    ? pm.getUserDataDirFromProcess(effectiveTarget, snapshotDeps)
    : null;
  const running = effectiveTarget === 'ide'
    ? ideRunning
    : (effectiveTarget === 'classic' ? classicRunning : pm.isAntigravityRunning(effectiveTarget, snapshotDeps));
  const credDeps = {
    ...deps,
    ...(runningUserDataDir ? { userDataDir: runningUserDataDir } : {}),
    ...(activeExePath ? { executablePath: activeExePath } : {})
  };
  await ensureDeviceProfile(isIde ? 'ide' : 'classic', credDeps);

  let hotSwitched = false;
  let launched = false;

  if (running) {
    try {
      // Pre-write credentials once before killing language_server so supervisor respawns with new account
      await applyAccountCredentialsAsync(activeAccount, freshToken, { isIde, effectiveTarget, activeExePath, deps: credDeps });
      const previousLsPids = typeof pm.getLanguageServerPids === 'function'
        ? pm.getLanguageServerPids(effectiveTarget, snapshotDeps)
        : [];
      const killedLs = typeof pm.killLanguageServerAsync === 'function'
        ? await pm.killLanguageServerAsync(effectiveTarget, snapshotDeps)
        : pm.killLanguageServer(effectiveTarget, snapshotDeps);
      if (killedLs > 0) {
        const respawned = await pm.waitForLanguageServerRespawn(
          effectiveTarget,
          deps.respawnTimeoutMs || 15_000,
          { ...deps, excludePids: previousLsPids }
        );
        if (respawned) {
          hotSwitched = true;
          launched = true;
        }
      }
    } catch (_) {
      hotSwitched = false;
    }
  }

  if (!hotSwitched) {
    if (running) {
      await pm.closeAntigravity(20, effectiveTarget, deps);
    }
    await applyAccountCredentialsAsync(activeAccount, freshToken, { isIde, effectiveTarget, activeExePath, deps: credDeps });

    try {
      pm.startAntigravity(effectiveTarget, activeExePath, activeArgs, deps);
      launched = true;
    } catch (error) {
      if (running || /** @type {any} */ (error)?.code !== 'EXECUTABLE_NOT_FOUND') {
        throw error;
      }
    }
  }

  const activeSlot = isIde ? 'ide' : 'classic';
  store.setActiveAccount(activeSlot, activeAccount.id);
  return {
    ok: true,
    target: activeSlot,
    mode: hotSwitched ? 'hot' : (running ? 'restart' : 'offline'),
    launched,
    accountId: activeAccount.id
  };
}

/**
 * Score and pick the best available account (Gemini + Claude average remaining fraction, tier tiebreaker).
 * @param {Array<Record<string, any>>} accounts
 */
function pickBestAccount(accounts) {
  const candidates = (Array.isArray(accounts) ? accounts : []).filter((a) => (
    a && a.hasToken !== false && !a.disabled && !a.banned && !a.validationBlocked && !a.quota?.isForbidden
  ));
  if (candidates.length === 0) return null;

  /** @type {Record<string, number>} */
  const tierRank = { ULTRA: 4, PRO: 3, ENTERPRISE: 2, FREE: 1, UNKNOWN: 0 };

  /** @param {Record<string, any>} acc */
  function scoreAccount(acc) {
    const groups = Array.isArray(acc?.quota?.groups) ? acc.quota.groups : [];
    const models = Array.isArray(acc?.quota?.models) ? acc.quota.models : [];
    if (groups.length > 0) {
      const vals = groups.flatMap((/** @type {any} */ g) => {
        const buckets = Array.isArray(g?.buckets) ? g.buckets : [];
        if (buckets.length === 0) return [];
        const minRf = Math.min(...buckets.map((/** @type {any} */ b) => Number(b?.remainingFraction ?? 0)));
        return [Math.max(0, Math.min(1, minRf)) * 100];
      });
      if (vals.length > 0) return vals.reduce((/** @type {number} */ s, /** @type {number} */ v) => s + v, 0) / vals.length;
    }
    if (models.length > 0) {
      const avg = models.reduce((/** @type {number} */ s, /** @type {any} */ m) => s + Number(m?.percentage || 0), 0) / models.length;
      return avg;
    }
    return 0;
  }

  return [...candidates].sort((a, b) => {
    const diff = scoreAccount(b) - scoreAccount(a);
    if (Math.abs(diff) > 0.01) return diff;
    return (tierRank[b.subscriptionTier] || 0) - (tierRank[a.subscriptionTier] || 0);
  })[0];
}

module.exports = {
  applyAccountCredentials,
  applyAccountCredentialsAsync,
  pickBestAccount,
  resolveEffectiveTarget,
  switchAccount
};
