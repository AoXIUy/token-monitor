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
  if (freshToken.accessToken !== tokenData.accessToken) {
    store.saveAccountToken(account.id, freshToken);
  }

  // 2. Ensure device profile isolation + backup original device profile if missing
  let activeAccount = account;
  if (!activeAccount.deviceProfile) {
    try {
      const existingStoragePath = dp.getStoragePath(targetClient === 'ide' ? 'ide' : 'classic', deps);
      const original = dp.readDeviceProfile(existingStoragePath);
      if (original) store.saveOriginalDeviceProfileIfMissing(original);
    } catch (_) {}
    const generated = dp.generateDeviceProfile();
    activeAccount = store.upsertAccount({ ...activeAccount, deviceProfile: generated }) || { ...activeAccount, deviceProfile: generated };
  }

  const normalizedTarget = String(targetClient || 'auto').trim().toLowerCase();

  // 3a. AGY CLI target
  if (normalizedTarget === 'agy') {
    kr.writeToSystemKeyring({
      accessToken: freshToken.accessToken,
      refreshToken: freshToken.refreshToken,
      expiryTimestamp: freshToken.expiryTimestamp,
      email: activeAccount.email,
      idToken: freshToken.idToken
    }, deps);
    fc.writeFileCredentials({
      accessToken: freshToken.accessToken,
      refreshToken: freshToken.refreshToken,
      expiryTimestamp: freshToken.expiryTimestamp,
      email: activeAccount.email,
      idToken: freshToken.idToken
    }, { ...deps, syncAgyCli: true });

    const stored = kr.readFromSystemKeyring(deps);
    if (!stored || stored.refreshToken !== freshToken.refreshToken) {
      throw new Error('Could not verify AGY CLI keyring credential write');
    }
    store.setActiveAccount('agy', activeAccount.id);
    return { ok: true, target: 'agy', mode: 'cli', accountId: activeAccount.id };
  }

  // 3b. ACP IDE Plugin target
  if (normalizedTarget === 'acp' || normalizedTarget === 'plugin' || normalizedTarget === 'ide-plugin') {
    try {
      kr.writeToSystemKeyring({
        accessToken: freshToken.accessToken,
        refreshToken: freshToken.refreshToken,
        expiryTimestamp: freshToken.expiryTimestamp,
        email: activeAccount.email,
        idToken: freshToken.idToken
      }, { ...deps, account: kr.ACP_ACCOUNT });
    } catch (_) {}

    fc.writeAcpCredentials({
      accessToken: freshToken.accessToken,
      refreshToken: freshToken.refreshToken,
      expiryTimestamp: freshToken.expiryTimestamp,
      email: activeAccount.email,
      projectId: freshToken.projectId,
      idToken: freshToken.idToken
    }, deps);

    const killedAcp = pm.killAcpServers(deps);
    store.setActiveAccount('acp', activeAccount.id);
    return { ok: true, target: 'acp', mode: 'acp', restartedProcesses: killedAcp, accountId: activeAccount.id };
  }

  // 3c. Desktop Classic / IDE target
  const explicitTarget = normalizedTarget === 'ide' ? 'ide' : (normalizedTarget === 'classic' ? 'classic' : null);
  const classicRunning = pm.isAntigravityRunning(null, deps);
  const ideRunning = pm.isAntigravityRunning('ide', deps);
  const classicExe = pm.getAntigravityExecutablePath('classic', deps);
  const ideExe = pm.getAntigravityExecutablePath('ide', deps);

  const { isIde, effectiveTarget } = resolveEffectiveTarget(explicitTarget, {
    classicRunning,
    ideRunning,
    hasClassicExe: Boolean(classicExe),
    ideExePath: ideExe
  });

  const activeExePath = pm.getAntigravityExecutablePath(effectiveTarget, deps);
  const activeArgs = pm.getArgsFromRunningProcess(effectiveTarget, deps);
  const running = pm.isAntigravityRunning(effectiveTarget, deps);

  let hotSwitched = false;

  if (running) {
    try {
      // Pre-write credentials before killing language_server so supervisor respawns with new account
      applyAccountCredentials(activeAccount, freshToken, { isIde, effectiveTarget, activeExePath, deps });
      const killedLs = pm.killLanguageServer(effectiveTarget, deps);
      if (killedLs > 0) {
        try {
          applyAccountCredentials(activeAccount, freshToken, { isIde, effectiveTarget, activeExePath, deps });
        } catch (_) {}
        const respawned = await pm.waitForLanguageServerRespawn(effectiveTarget, deps.respawnTimeoutMs || 15_000, deps);
        if (respawned) {
          hotSwitched = true;
        }
      }
    } catch (_) {
      hotSwitched = false;
    }
  }

  if (!hotSwitched) {
    if (running) {
      await pm.closeAntigravity(20, effectiveTarget, deps);
      applyAccountCredentials(activeAccount, freshToken, { isIde, effectiveTarget, activeExePath, deps });
    } else {
      applyAccountCredentials(activeAccount, freshToken, { isIde, effectiveTarget, activeExePath, deps });
    }

    try {
      pm.startAntigravity(effectiveTarget, activeExePath, activeArgs, deps);
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
  pickBestAccount,
  resolveEffectiveTarget,
  switchAccount
};
