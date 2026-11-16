'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { dayKeyAddDays, localDayKey, num } = require('../shared/history');
const { canonicalProjectKey, deterministicProjectLabel } = require('../shared/projectKey');
const { isReasonixSyntheticSession } = require('../shared/providers/reasonix/sessionGuard');
const { normalizeClientName, normalizeModelName } = require('../shared/usage');
const { projectRoot, readJson, writeJsonAtomic } = require('../shared/config');
const {
  REPORT_GRANULARITIES,
  REPORT_SCHEMA,
  analyzeProjectUsage,
  buildUsageReport,
  normalizeReportConfig,
  renderReportJson,
  renderReportMarkdown,
  reportContentSignature,
  resolveReportPeriod
} = require('../shared/usageReport');

const MAX_SNAPSHOT_DAYS = 400;
const DEFAULT_DEBOUNCE_MS = 100;
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @param {any} value
 * @returns {boolean}
 */
function isValidDateKey(value) {
  return typeof value === 'string' && DATE_KEY_RE.test(value);
}

/**
 * @param {number} value
 * @returns {number}
 */
function round6(value) {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : 0;
}

/**
 * @param {string} filePath
 * @param {string} content
 */
function writeTextAtomic(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, content, 'utf8');
  fs.renameSync(tempPath, filePath);
}

/**
 * @param {any} value
 * @returns {boolean}
 */
function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/**
 * @param {Date} date
 * @param {string} [timeZone]
 * @returns {string}
 */
function dayKeyForDate(date, timeZone) {
  if (!timeZone) return localDayKey(date);
  try {
    const parts = new Intl.DateTimeFormat('en', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date);
    /** @type {Record<string, string>} */
    const map = {};
    for (const part of parts) map[part.type] = part.value;
    const key = `${map.year}-${map.month}-${map.day}`;
    return isValidDateKey(key) ? key : localDayKey(date);
  } catch {
    return localDayKey(date);
  }
}

/**
 * @param {string} dateKey
 * @returns {string}
 */
function isoWeekKeyForDateKey(dateKey) {
  return resolveReportPeriod('weekly', 'current', {
    now: `${dateKey}T12:00:00.000Z`,
    timeZone: 'UTC'
  }).key;
}

/**
 * @param {any} stats
 * @param {Date} nowDate
 * @param {string} [timeZone]
 * @returns {string}
 */
function extractTodayKey(stats, nowDate, timeZone) {
  const topKey = String(stats?.periodWindows?.today?.key || '').trim();
  if (isValidDateKey(topKey)) return topKey;

  const hubDayKey = dayKeyForDate(nowDate, timeZone);
  const nowMs = nowDate.getTime();
  const devices = Array.isArray(stats?.devices) ? stats.devices : [];
  /** @type {string[]} */
  const activeKeys = [];
  for (const device of devices) {
    const endsAt = device?.periodWindows?.today?.endsAt;
    if (endsAt) {
      const endsAtMs = Date.parse(endsAt);
      if (Number.isFinite(endsAtMs) && endsAtMs <= nowMs) continue;
    }
    const key = String(device?.periodWindows?.today?.key || '').trim();
    if (isValidDateKey(key)) activeKeys.push(key);
  }
  if (activeKeys.length === 0 || activeKeys.includes(hubDayKey)) {
    return hubDayKey;
  }
  activeKeys.sort();
  return activeKeys[activeKeys.length - 1];
}

/**
 * @param {any} map
 * @param {boolean} [isFloat]
 * @returns {Record<string, number>}
 */
function copyNumericMap(map, isFloat = false) {
  /** @type {Record<string, number>} */
  const out = Object.create(null);
  if (!isPlainObject(map)) return out;
  for (const key of Object.keys(map).sort()) {
    const val = Math.max(0, num(map[key]));
    out[key] = isFloat ? round6(val) : Math.round(val);
  }
  return out;
}

/**
 * @param {any} projectsInput
 * @param {Map<string, number>} sessionCountsByProject
 * @returns {Record<string, any>}
 */
function copySnapshotProjects(projectsInput, sessionCountsByProject) {
  /** @type {Record<string, any>} */
  const out = Object.create(null);
  if (!isPlainObject(projectsInput)) return out;

  for (const [rawKey, src] of Object.entries(projectsInput)) {
    if (!isPlainObject(src)) continue;
    const label = String(src.label || rawKey || '').trim().normalize('NFC');
    const key = canonicalProjectKey(label || rawKey);
    if (!key) continue;
    const tokens = Math.max(0, Math.round(num(src.tokens ?? src.totalTokens)));
    const costUsd = round6(Math.max(0, num(src.costUsd ?? src.cost)));
    const unpricedTokens = Math.min(tokens, Math.max(0, Math.round(num(src.unpricedTokens))));
    const prev = Object.hasOwn(out, key) ? out[key] : null;
    const entry = prev || {
      label: label || key,
      tokens: 0,
      costUsd: 0,
      unpricedTokens: 0,
      sessionCount: sessionCountsByProject.get(key) || 0,
      clients: /** @type {Record<string, number>} */ (Object.create(null)),
      models: /** @type {Record<string, number>} */ (Object.create(null))
    };
    if (prev) {
      entry.label = deterministicProjectLabel(prev.label, label || key);
    }
    entry.tokens += tokens;
    entry.costUsd = round6(entry.costUsd + costUsd);
    entry.unpricedTokens += unpricedTokens;
    if (sessionCountsByProject.size === 0 && Number.isFinite(Number(src.sessionCount))) {
      entry.sessionCount += Math.max(0, Math.round(Number(src.sessionCount)));
    }
    if (isPlainObject(src.clients)) {
      for (const [rawClient, val] of Object.entries(src.clients)) {
        const client = normalizeClientName(rawClient) || String(rawClient || '').trim();
        const cTokens = Math.max(0, Math.round(num(val)));
        if (client && cTokens > 0) {
          entry.clients[client] = (Object.hasOwn(entry.clients, client) ? entry.clients[client] : 0) + cTokens;
        }
      }
    }
    if (isPlainObject(src.models)) {
      for (const [rawModel, val] of Object.entries(src.models)) {
        const model = normalizeModelName(rawModel) || String(rawModel || '').trim();
        const mTokens = Math.max(0, Math.round(num(val)));
        if (model && mTokens > 0) {
          entry.models[model] = (Object.hasOwn(entry.models, model) ? entry.models[model] : 0) + mTokens;
        }
      }
    }
    out[key] = entry;
  }

  /** @type {Record<string, any>} */
  const sorted = Object.create(null);
  for (const key of Object.keys(out).sort()) {
    const p = out[key];
    /** @type {Record<string, number>} */
    const clients = Object.create(null);
    for (const cKey of Object.keys(p.clients).sort()) clients[cKey] = p.clients[cKey];
    /** @type {Record<string, number>} */
    const models = Object.create(null);
    for (const mKey of Object.keys(p.models).sort()) models[mKey] = p.models[mKey];
    sorted[key] = {
      label: p.label,
      tokens: p.tokens,
      costUsd: p.costUsd,
      unpricedTokens: p.unpricedTokens,
      sessionCount: p.sessionCount,
      clients,
      models
    };
  }
  return sorted;
}

/**
 * @param {any} stats
 * @param {string} todayKey
 * @param {Date} nowDate
 * @returns {Record<string, any>}
 */
function buildDailySnapshotEntry(stats, todayKey, nowDate) {
  const period = stats?.periods?.today || {};
  const totalTokens = Math.max(0, Math.round(num(period.totalTokens)));
  const costUsd = round6(Math.max(0, num(period.costUsd)));
  const unpricedTokens = Math.min(totalTokens, Math.max(0, Math.round(num(period.unpricedTokens))));
  const cacheReadTokens = Math.max(0, Math.round(num(period.cacheReadTokens)));
  const cacheWriteTokens = Math.max(0, Math.round(num(period.cacheWriteTokens)));
  const outputTokens = Math.max(0, Math.round(num(period.outputTokens)));
  const unclassifiedTokens = Math.max(0, Math.round(num(period.unclassifiedTokens)));
  const timedTokens = Math.max(0, Math.round(num(period.timedTokens)));
  const timedOutputTokens = Math.max(0, Math.round(num(period.timedOutputTokens)));
  const timedDurationMs = Math.max(0, Math.round(num(period.timedDurationMs)));
  const activeTimeMs = Math.max(0, Math.round(num(period.activeTimeMs)));
  const tokenComponentsAvailable = period?.capabilities?.tokenComponents === true;

  /** @type {Map<string, number>} */
  const sessionCountsByProject = new Map();
  /** @type {Map<string, number>} */
  const sessionMsgsByClient = new Map();
  let sessionCount = 0;
  let sessionMsgsTotal = 0;
  for (const [sKey, session] of Object.entries(period?.sessions || {})) {
    if (!session || typeof session !== 'object' || isReasonixSyntheticSession(session, sKey)) continue;
    sessionCount += 1;
    const msgs = Math.max(0, Math.round(num(session.messageCount)));
    sessionMsgsTotal += msgs;
    const client = normalizeClientName(session.client) || String(session.client || '').trim();
    if (client) sessionMsgsByClient.set(client, (sessionMsgsByClient.get(client) || 0) + msgs);
    const pKey = canonicalProjectKey(String(session.projectLabel || '').trim().normalize('NFC'));
    if (pKey) sessionCountsByProject.set(pKey, (sessionCountsByProject.get(pKey) || 0) + 1);
  }

  const messageCount = Math.max(sessionMsgsTotal, Math.round(num(period.messageCount)));
  const projects = copySnapshotProjects(period.projects, sessionCountsByProject);
  const clients = copyNumericMap(period.clients, false);
  const clientCosts = copyNumericMap(period.clientCosts, true);
  const models = copyNumericMap(period.models, false);
  const modelCosts = copyNumericMap(period.modelCosts, true);

  /** @type {Record<string, any>} */
  const perClient = Object.create(null);
  const clientKeys = new Set([...Object.keys(clients), ...Object.keys(clientCosts)]);
  for (const rawClient of Array.from(clientKeys).sort()) {
    const client = normalizeClientName(rawClient) || rawClient;
    const cTokens = Math.max(0, Math.round(num(clients[rawClient])));
    const prev = Object.hasOwn(perClient, client) ? perClient[client] : null;
    perClient[client] = {
      tokens: (prev?.tokens || 0) + cTokens,
      cost: round6((prev?.cost || 0) + Math.max(0, num(clientCosts[rawClient]))),
      unpricedTokens: (prev?.unpricedTokens || 0) + Math.min(cTokens, Math.max(0, Math.round(num(period?.clientUnpricedTokens?.[rawClient])))),
      cacheReadTokens: (prev?.cacheReadTokens || 0) + Math.max(0, Math.round(num(period?.clientCacheReads?.[rawClient]))),
      cacheWriteTokens: (prev?.cacheWriteTokens || 0) + Math.max(0, Math.round(num(period?.clientCacheWrites?.[rawClient]))),
      outputTokens: (prev?.outputTokens || 0) + Math.max(0, Math.round(num(period?.clientOutputs?.[rawClient]))),
      messages: prev ? prev.messages : (sessionMsgsByClient.get(client) || 0)
    };
  }

  /** @type {Record<string, any>} */
  const perModel = Object.create(null);
  const modelKeys = new Set([...Object.keys(models), ...Object.keys(modelCosts)]);
  for (const rawModel of Array.from(modelKeys).sort()) {
    const model = normalizeModelName(rawModel) || rawModel;
    const mTokens = Math.max(0, Math.round(num(models[rawModel])));
    const prev = Object.hasOwn(perModel, model) ? perModel[model] : null;
    perModel[model] = {
      tokens: (prev?.tokens || 0) + mTokens,
      cost: round6((prev?.cost || 0) + Math.max(0, num(modelCosts[rawModel]))),
      unpricedTokens: (prev?.unpricedTokens || 0) + Math.min(mTokens, Math.max(0, Math.round(num(period?.modelUnpricedTokens?.[rawModel])))),
      cacheReadTokens: (prev?.cacheReadTokens || 0) + Math.max(0, Math.round(num(period?.modelCacheReads?.[rawModel]))),
      cacheWriteTokens: (prev?.cacheWriteTokens || 0) + Math.max(0, Math.round(num(period?.modelCacheWrites?.[rawModel]))),
      outputTokens: (prev?.outputTokens || 0) + Math.max(0, Math.round(num(period?.modelOutputs?.[rawModel])))
    };
  }

  const devices = Array.isArray(stats?.devices) ? stats.devices : [];
  const omitted = num(stats?.periodProjectsOmitted?.today) > 0;
  const allDisabled = devices.length > 0 && devices.every((d) => d?.projectsEnabled === false);
  const projectsComplete = !omitted && !allDisabled;

  return {
    date: todayKey,
    updatedAt: nowDate.toISOString(),
    totalTokens,
    costUsd,
    unpricedTokens,
    cacheReadTokens,
    cacheWriteTokens,
    outputTokens,
    unclassifiedTokens,
    tokenComponentsAvailable,
    timedTokens,
    timedOutputTokens,
    timedDurationMs,
    activeTimeMs,
    messageCount,
    sessionCount,
    projectsComplete,
    projects,
    clients,
    clientCosts,
    models,
    modelCosts,
    perClient,
    perModel
  };
}

/**
 * @param {any} snapshot
 * @returns {string}
 */
function snapshotContentKey(snapshot) {
  if (!isPlainObject(snapshot)) return '';
  const { updatedAt: _updatedAt, ...rest } = snapshot;
  return JSON.stringify(rest);
}

/**
 * @param {any} snapshot
 * @returns {boolean}
 */
function isSnapshotEmpty(snapshot) {
  return !snapshot
    || (
      num(snapshot.totalTokens) === 0
      && num(snapshot.costUsd) === 0
      && num(snapshot.activeTimeMs) === 0
      && num(snapshot.messageCount) === 0
      && Object.keys(snapshot.projects || {}).length === 0
    );
}

/**
 * @param {Record<string, any>} snapshots
 */
function pruneSnapshots(snapshots) {
  const validKeys = Object.keys(snapshots).filter(isValidDateKey).sort();
  if (validKeys.length <= MAX_SNAPSHOT_DAYS) return;
  const toDelete = validKeys.length - MAX_SNAPSHOT_DAYS;
  for (let i = 0; i < toDelete; i += 1) {
    delete snapshots[validKeys[i]];
  }
}

/**
 * @param {object} [options]
 * @param {string} [options.dataFile]
 * @param {string} [options.reportsDir]
 * @param {any} [options.config]
 * @param {() => any} [options.getStats]
 * @param {() => any} [options.getHistory]
 * @param {() => any[]} [options.getDevices]
 * @param {string} [options.hubRuntime]
 * @param {number} [options.debounceMs]
 * @param {() => Date} [options.now]
 * @param {{ error?: Function, warn?: Function, log?: Function }} [options.logger]
 */
function createReportManager({
  dataFile,
  reportsDir = '',
  config = undefined,
  getStats = () => ({}),
  getHistory = () => ({}),
  getDevices = () => [],
  hubRuntime = 'node-hub',
  debounceMs = DEFAULT_DEBOUNCE_MS,
  now = () => new Date(),
  logger = console
} = {}) {
  const resolvedDataFile = dataFile || path.join(projectRoot(), 'data', 'devices.json');
  const resolvedReportsDir = typeof reportsDir === 'string' && reportsDir.trim()
    ? path.resolve(reportsDir.trim())
    : path.join(path.dirname(resolvedDataFile), 'reports');

  const configPath = path.join(resolvedReportsDir, 'config.json');
  const snapshotsPath = path.join(resolvedReportsDir, 'daily-snapshots.json');

  const storedConfig = readJson(configPath, null);
  let currentConfig = config !== undefined
    ? normalizeReportConfig(config)
    : normalizeReportConfig(storedConfig);

  const storedSnapshotsDoc = readJson(snapshotsPath, null);
  /** @type {Record<string, any>} */
  const snapshots = {};
  if (isPlainObject(storedSnapshotsDoc?.snapshots)) {
    for (const [key, val] of Object.entries(storedSnapshotsDoc.snapshots)) {
      if (isValidDateKey(key) && isPlainObject(val)) {
        snapshots[key] = val;
      }
    }
    pruneSnapshots(snapshots);
  }

  let lastTrackedDay = Object.keys(snapshots).sort().at(-1) || '';
  /** @type {NodeJS.Timeout | null} */
  let snapshotTimer = null;
  /** @type {NodeJS.Timeout | null} */
  let reportTimer = null;
  let snapshotDirty = false;
  let reportDirty = false;
  let stopped = false;

  const normalizedDebounceMs = Number.isFinite(Number(debounceMs)) && Number(debounceMs) >= 0
    ? Number(debounceMs)
    : DEFAULT_DEBOUNCE_MS;

  /**
   * @param {any} error
   * @param {string} context
   */
  function logError(error, context) {
    (logger?.error || console.error)(`[reports] ${context}:`, error);
  }

  function writeSnapshotsNow() {
    snapshotDirty = false;
    if (snapshotTimer) {
      clearTimeout(snapshotTimer);
      snapshotTimer = null;
    }
    pruneSnapshots(snapshots);
    writeJsonAtomic(snapshotsPath, { version: 1, snapshots }, 2);
  }

  function scheduleSnapshotWrite() {
    snapshotDirty = true;
    if (stopped) return;
    if (normalizedDebounceMs === 0) {
      writeSnapshotsNow();
      return;
    }
    if (snapshotTimer) return;
    snapshotTimer = setTimeout(() => {
      snapshotTimer = null;
      if (!snapshotDirty) return;
      try {
        writeSnapshotsNow();
      } catch (error) {
        logError(error, 'failed to write daily-snapshots.json');
      }
    }, normalizedDebounceMs);
    snapshotTimer.unref();
  }

  /**
   * @param {any} stats
   * @returns {any}
   */
  function statsWithRuntime(stats) {
    if (!stats || typeof stats !== 'object') return { runtime: hubRuntime };
    if (stats.runtime || stats.hubRuntime) return stats;
    return { ...stats, runtime: hubRuntime };
  }

  /**
   * @param {import('../shared/usageReport').ReportGranularity} granularity
   * @param {string} periodKey
   * @returns {{ jsonPath: string, mdPath: string }}
   */
  function reportFilePaths(granularity, periodKey) {
    const dir = path.join(resolvedReportsDir, granularity);
    return {
      jsonPath: path.join(dir, `${periodKey}.json`),
      mdPath: path.join(dir, `${periodKey}.md`)
    };
  }

  /**
   * @param {any} report
   * @param {string} jsonPath
   * @param {string} mdPath
   * @returns {any}
   */
  function toReportSummary(report, jsonPath, mdPath) {
    return {
      reportId: String(report.reportId || ''),
      granularity: report.granularity,
      periodKey: String(report.period?.key || ''),
      label: String(report.period?.label || report.period?.key || ''),
      startDate: String(report.period?.startDate || ''),
      endDate: String(report.period?.endDate || ''),
      generatedAt: String(report.period?.generatedAt || ''),
      totalTokens: Math.max(0, Math.round(num(report.summary?.totalTokens))),
      knownCostUsd: round6(Math.max(0, num(report.summary?.knownCostUsd))),
      projectCount: Math.max(0, Math.round(num(report.summary?.projectCount))),
      files: {
        json: jsonPath,
        markdown: fs.existsSync(mdPath) ? mdPath : null
      }
    };
  }

  /**
   * @param {import('../shared/usageReport').ReportGranularity} granularity
   * @param {string} periodKey
   * @param {{ force?: boolean, timeZone?: string, nowDate?: Date }} [options]
   * @returns {any}
   */
  function persistSingleReport(granularity, periodKey, { force = false, timeZone, nowDate } = {}) {
    const refDate = nowDate || now();
    const stats = statsWithRuntime(getStats());
    const history = getHistory();
    const devices = getDevices();
    const report = buildUsageReport({
      granularity,
      periodKey,
      stats,
      history,
      devices,
      dailySnapshots: snapshots,
      now: refDate,
      timeZone
    });

    const { jsonPath, mdPath } = reportFilePaths(granularity, report.period.key);
    const nextSignature = reportContentSignature(report);

    if (!force && fs.existsSync(jsonPath) && fs.existsSync(mdPath)) {
      const existing = readJson(jsonPath, null);
      if (existing && typeof existing === 'object') {
        const existingSignature = reportContentSignature(existing);
        if (existingSignature === nextSignature) {
          return {
            ...toReportSummary(existing, jsonPath, mdPath),
            signature: existingSignature,
            written: false
          };
        }
      }
    }

    writeTextAtomic(jsonPath, renderReportJson(report));
    writeTextAtomic(mdPath, renderReportMarkdown(report));

    return {
      ...toReportSummary(report, jsonPath, mdPath),
      signature: nextSignature,
      written: true
    };
  }

  /**
   * @param {string} prevDayKey
   * @param {string} nextDayKey
   * @param {Date} refDate
   */
  function archiveRolledOverPeriods(prevDayKey, nextDayKey, refDate) {
    if (!currentConfig.enabled || !isValidDateKey(prevDayKey) || !isValidDateKey(nextDayKey)) return;
    if (nextDayKey <= prevDayKey) return;

    if (currentConfig.daily) {
      try {
        persistSingleReport('daily', prevDayKey, { force: false, nowDate: refDate });
      } catch (error) {
        logError(error, `failed to archive daily report ${prevDayKey}`);
      }
    }

    const prevWeek = isoWeekKeyForDateKey(prevDayKey);
    const nextWeek = isoWeekKeyForDateKey(nextDayKey);
    if (currentConfig.weekly && prevWeek !== nextWeek) {
      try {
        persistSingleReport('weekly', prevWeek, { force: false, nowDate: refDate });
      } catch (error) {
        logError(error, `failed to archive weekly report ${prevWeek}`);
      }
    }

    const prevMonth = prevDayKey.slice(0, 7);
    const nextMonth = nextDayKey.slice(0, 7);
    if (currentConfig.monthly && prevMonth !== nextMonth) {
      try {
        persistSingleReport('monthly', prevMonth, { force: false, nowDate: refDate });
      } catch (error) {
        logError(error, `failed to archive monthly report ${prevMonth}`);
      }
    }
  }

  function generateEnabledCurrentReports() {
    reportDirty = false;
    if (reportTimer) {
      clearTimeout(reportTimer);
      reportTimer = null;
    }
    if (!currentConfig.enabled) return [];
    const refDate = now();
    const todayKey = lastTrackedDay || dayKeyForDate(refDate);
    /** @type {any[]} */
    const results = [];
    /** @type {Array<{ granularity: import('../shared/usageReport').ReportGranularity, key: string }>} */
    const targets = [];
    if (currentConfig.daily) targets.push({ granularity: 'daily', key: todayKey });
    if (currentConfig.weekly) targets.push({ granularity: 'weekly', key: isoWeekKeyForDateKey(todayKey) });
    if (currentConfig.monthly) targets.push({ granularity: 'monthly', key: todayKey.slice(0, 7) });
    for (const target of targets) {
      results.push(persistSingleReport(target.granularity, target.key, { force: false, nowDate: refDate }));
    }
    return results;
  }

  function scheduleEnabledReportGeneration() {
    if (!currentConfig.enabled || stopped) return;
    reportDirty = true;
    if (normalizedDebounceMs === 0) {
      generateEnabledCurrentReports();
      return;
    }
    if (reportTimer) return;
    reportTimer = setTimeout(() => {
      reportTimer = null;
      if (!reportDirty || !currentConfig.enabled) return;
      try {
        generateEnabledCurrentReports();
      } catch (error) {
        logError(error, 'failed to generate scheduled reports');
      }
    }, normalizedDebounceMs);
    reportTimer.unref();
  }

  function getConfig() {
    return {
      ...currentConfig,
      reportsDir: resolvedReportsDir
    };
  }

  /**
   * @param {any} patch
   */
  function setConfig(patch) {
    const merged = isPlainObject(patch) ? { ...currentConfig, ...patch } : patch;
    currentConfig = normalizeReportConfig(merged);
    writeJsonAtomic(configPath, currentConfig, 2);
    if (currentConfig.enabled) {
      if (snapshotDirty) {
        try { writeSnapshotsNow(); } catch (error) { logError(error, 'failed to flush snapshots'); }
      }
      try {
        generateEnabledCurrentReports();
      } catch (error) {
        logError(error, 'failed to generate reports on config update');
      }
    } else {
      reportDirty = false;
      if (reportTimer) {
        clearTimeout(reportTimer);
        reportTimer = null;
      }
    }
    return getConfig();
  }

  /**
   * @param {any} [stats]
   */
  function recordIngestSnapshot(stats = getStats()) {
    const refDate = now();
    const todayKey = extractTodayKey(stats, refDate);
    if (!isValidDateKey(todayKey)) return { changed: false, todayKey: '' };

    const rolledOver = Boolean(lastTrackedDay && todayKey > lastTrackedDay);
    const previousDay = lastTrackedDay;

    const nextSnapshot = buildDailySnapshotEntry(stats, todayKey, refDate);
    const prevSnapshot = snapshots[todayKey];
    const hasExisting = Boolean(prevSnapshot);
    const changed = hasExisting
      ? snapshotContentKey(prevSnapshot) !== snapshotContentKey(nextSnapshot)
      : !isSnapshotEmpty(nextSnapshot);

    if (rolledOver) {
      if (snapshotDirty) {
        try { writeSnapshotsNow(); } catch (error) { logError(error, 'failed to flush snapshot before rollover'); }
      }
      archiveRolledOverPeriods(previousDay, todayKey, refDate);
    }

    if (changed) {
      snapshots[todayKey] = nextSnapshot;
      pruneSnapshots(snapshots);
      scheduleSnapshotWrite();
    }

    if (!lastTrackedDay || todayKey > lastTrackedDay) {
      lastTrackedDay = todayKey;
    }

    if (currentConfig.enabled && (changed || rolledOver)) {
      scheduleEnabledReportGeneration();
    }

    return { changed, rolledOver, todayKey };
  }

  function onStatsChanged() {
    try {
      return recordIngestSnapshot(getStats());
    } catch (error) {
      logError(error, 'failed to process stats update');
      return { changed: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * @param {{ granularity?: string, limit?: number }} [options]
   */
  function listReports({ granularity, limit = 50 } = {}) {
    if (snapshotDirty || reportDirty) {
      try { flush(); } catch (error) { logError(error, 'failed to flush pending reports before list'); }
    }
    if (granularity !== undefined && granularity !== '') {
      const norm = String(granularity).trim().toLowerCase();
      if (!REPORT_GRANULARITIES.includes(/** @type {any} */ (norm))) {
        return {
          ok: false,
          error: 'invalid_request',
          message: `Invalid granularity "${granularity}". Expected daily, weekly, or monthly.`
        };
      }
    }

    const parsedLimit = Number(limit);
    const maxItems = Number.isInteger(parsedLimit) && parsedLimit >= 1 ? parsedLimit : 50;
    const targetGranularities = granularity
      ? [/** @type {import('../shared/usageReport').ReportGranularity} */ (String(granularity).trim().toLowerCase())]
      : REPORT_GRANULARITIES;

    /** @type {any[]} */
    const items = [];
    for (const gran of targetGranularities) {
      const dir = path.join(resolvedReportsDir, gran);
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (error) {
        if (/** @type {any} */ (error).code === 'ENOENT') continue;
        throw error;
      }
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        const jsonPath = path.join(dir, entry.name);
        const parsed = readJson(jsonPath, null);
        if (!isPlainObject(parsed) || !isPlainObject(parsed.period) || !isPlainObject(parsed.summary)) continue;
        if (parsed.schema && parsed.schema !== REPORT_SCHEMA) continue;
        const mdPath = path.join(dir, `${entry.name.slice(0, -5)}.md`);
        items.push(toReportSummary(parsed, jsonPath, mdPath));
      }
    }

    items.sort((a, b) => (
      b.startDate.localeCompare(a.startDate)
      || b.endDate.localeCompare(a.endDate)
      || b.generatedAt.localeCompare(a.generatedAt)
      || b.periodKey.localeCompare(a.periodKey)
      || a.granularity.localeCompare(b.granularity)
    ));

    return {
      ok: true,
      config: getConfig(),
      reports: items.slice(0, maxItems)
    };
  }

  /**
   * @param {import('../shared/usageReport').ResolvedReportPeriod} resolved
   * @param {any} stats
   * @param {any} history
   * @param {any[]} devices
   * @returns {boolean}
   */
  function hasDataForPeriod(resolved, stats, history, devices) {
    if (devices.length > 0) return true;
    for (let d = resolved.startDate; d <= resolved.endDate; d = dayKeyAddDays(d, 1)) {
      if (snapshots[d]) return true;
    }
    if (Array.isArray(history?.daily)) {
      for (const row of history.daily) {
        const d = String(row?.date || '').slice(0, 10);
        if (d >= resolved.startDate && d <= resolved.endDate && num(row?.tokens) > 0) return true;
      }
    }
    if (resolved.granularity === 'monthly' && Array.isArray(history?.monthly)) {
      if (history.monthly.some((/** @type {any} */ m) => m?.month === resolved.key && num(m?.tokens) > 0)) return true;
    }
    if (resolved.isCurrent) {
      const livePeriod = resolved.granularity === 'daily'
        ? stats?.periods?.today
        : resolved.granularity === 'monthly'
          ? stats?.periods?.month
          : stats?.periods?.month || stats?.periods?.today;
      if (num(livePeriod?.totalTokens) > 0) return true;
    }
    return false;
  }

  /**
   * @param {import('../shared/usageReport').ReportGranularity} granularity
   * @param {string} periodKey
   * @param {'json' | 'markdown' | 'both'} format
   * @returns {any | null}
   */
  function readPersistedReport(granularity, periodKey, format) {
    const { jsonPath, mdPath } = reportFilePaths(granularity, periodKey);
    if (!fs.existsSync(jsonPath)) return null;
    const report = readJson(jsonPath, null);
    if (!isPlainObject(report)) return null;

    let markdown;
    if (format === 'markdown' || format === 'both') {
      try {
        markdown = fs.readFileSync(mdPath, 'utf8');
      } catch {
        markdown = renderReportMarkdown(/** @type {any} */ (report));
      }
    }

    const files = {
      json: jsonPath,
      markdown: fs.existsSync(mdPath) ? mdPath : null
    };

    if (format === 'json') return { ok: true, report, files };
    if (format === 'markdown') return { ok: true, markdown, files };
    return { ok: true, report, markdown, files };
  }

  /**
   * Supports both `getReport(granularity, periodKey, options)` and
   * `getReport({ granularity, periodKey, format, timeZone })`.
   * @param {any} granularityOrOptions
   * @param {string} [periodKeyArg]
   * @param {{ format?: string, timeZone?: string }} [optionsArg]
   */
  function getReport(granularityOrOptions, periodKeyArg = 'latest', optionsArg = {}) {
    let granularity;
    let periodKey;
    let format;
    let timeZone;

    if (isPlainObject(granularityOrOptions)) {
      granularity = granularityOrOptions.granularity;
      periodKey = granularityOrOptions.periodKey ?? 'latest';
      format = granularityOrOptions.format ?? 'both';
      timeZone = granularityOrOptions.timeZone;
    } else {
      granularity = granularityOrOptions;
      periodKey = periodKeyArg ?? 'latest';
      format = optionsArg?.format ?? 'both';
      timeZone = optionsArg?.timeZone;
    }

    const normGran = /** @type {import('../shared/usageReport').ReportGranularity} */ (String(granularity || '').trim().toLowerCase());
    if (!REPORT_GRANULARITIES.includes(normGran)) {
      return {
        ok: false,
        error: 'invalid_request',
        message: `Invalid report granularity "${String(granularity || '')}". Expected daily, weekly, or monthly.`
      };
    }

    const normFormat = String(format || 'both').trim().toLowerCase();
    if (normFormat !== 'json' && normFormat !== 'markdown' && normFormat !== 'both') {
      return {
        ok: false,
        error: 'invalid_request',
        message: `Invalid report format "${String(format)}". Expected json, markdown, or both.`
      };
    }

    const rawKey = periodKey === null || periodKey === undefined ? '' : String(periodKey).trim();
    const isLatestAlias = rawKey === '' || rawKey.toLowerCase() === 'latest';
    const isCurrentAlias = rawKey.toLowerCase() === 'current';
    const refDate = now();

    /** @type {import('../shared/usageReport').ResolvedReportPeriod} */
    let resolved;
    try {
      resolved = resolveReportPeriod(normGran, rawKey || 'latest', { now: refDate, timeZone });
    } catch (error) {
      return {
        ok: false,
        error: 'invalid_request',
        message: error instanceof Error ? error.message : String(error)
      };
    }

    if (snapshotDirty || reportDirty) {
      try { flush(); } catch (error) { logError(error, 'failed to flush pending reports before read'); }
    }

    // 1. Check disk for the resolved period key first.
    const persisted = readPersistedReport(normGran, resolved.key, /** @type {any} */ (normFormat));
    if (persisted) return persisted;

    // 2. For 'latest', fall back to the newest persisted report if current period has no data,
    //    or build live current period on demand when live/snapshot/history data exists.
    const stats = statsWithRuntime(getStats());
    const history = getHistory();
    const devices = getDevices();
    const liveDataExists = hasDataForPeriod(resolved, stats, history, devices);

    if (isLatestAlias) {
      const listed = listReports({ granularity: normGran, limit: 1 });
      const latestOnDisk = listed.ok && Array.isArray(listed.reports) ? listed.reports[0] : null;
      if (latestOnDisk && !liveDataExists) {
        const fallback = readPersistedReport(normGran, latestOnDisk.periodKey, /** @type {any} */ (normFormat));
        if (fallback) return fallback;
      }
      if (liveDataExists) {
        const report = buildUsageReport({
          granularity: normGran,
          periodKey: resolved.key,
          stats,
          history,
          devices,
          dailySnapshots: snapshots,
          now: refDate,
          timeZone
        });
        if (report.summary.totalTokens === 0 && latestOnDisk) {
          const fallback = readPersistedReport(normGran, latestOnDisk.periodKey, /** @type {any} */ (normFormat));
          if (fallback) return fallback;
        }
        const markdown = normFormat === 'json' ? undefined : renderReportMarkdown(report);
        if (normFormat === 'json') return { ok: true, report };
        if (normFormat === 'markdown') return { ok: true, markdown };
        return { ok: true, report, markdown };
      }
      if (latestOnDisk) {
        const fallback = readPersistedReport(normGran, latestOnDisk.periodKey, /** @type {any} */ (normFormat));
        if (fallback) return fallback;
      }
      return { ok: false, error: 'not_found' };
    }

    if (isCurrentAlias && liveDataExists) {
      const report = buildUsageReport({
        granularity: normGran,
        periodKey: resolved.key,
        stats,
        history,
        devices,
        dailySnapshots: snapshots,
        now: refDate,
        timeZone
      });
      const markdown = normFormat === 'json' ? undefined : renderReportMarkdown(report);
      if (normFormat === 'json') return { ok: true, report };
      if (normFormat === 'markdown') return { ok: true, markdown };
      return { ok: true, report, markdown };
    }

    return { ok: false, error: 'not_found' };
  }

  /**
   * @param {{ granularity?: string, periodKey?: string, force?: boolean, timeZone?: string }} [options]
   */
  function generateReport({
    granularity = 'all',
    periodKey = 'current',
    force = false,
    timeZone
  } = {}) {
    const normGran = String(granularity || 'all').trim().toLowerCase();
    if (normGran !== 'all' && !REPORT_GRANULARITIES.includes(/** @type {any} */ (normGran))) {
      return {
        ok: false,
        error: 'invalid_request',
        message: `Invalid granularity "${granularity}". Expected daily, weekly, monthly, or all.`
      };
    }

    const targets = normGran === 'all'
      ? [...REPORT_GRANULARITIES]
      : [/** @type {import('../shared/usageReport').ReportGranularity} */ (normGran)];

    const refDate = now();
    const rawKey = periodKey === null || periodKey === undefined || String(periodKey).trim() === ''
      ? 'current'
      : String(periodKey).trim();

    if (snapshotDirty) {
      try { writeSnapshotsNow(); } catch (error) { logError(error, 'failed to flush snapshots before generation'); }
    }

    // Validate all requested periods up front so partial writes do not occur on bad input.
    /** @type {import('../shared/usageReport').ResolvedReportPeriod[]} */
    const resolvedTargets = [];
    for (const gran of targets) {
      try {
        resolvedTargets.push(resolveReportPeriod(gran, rawKey, { now: refDate, timeZone }));
      } catch (error) {
        return {
          ok: false,
          error: 'invalid_request',
          message: error instanceof Error ? error.message : String(error)
        };
      }
    }

    const generated = resolvedTargets.map((resolved) => (
      persistSingleReport(resolved.granularity, resolved.key, {
        force: Boolean(force),
        timeZone,
        nowDate: refDate
      })
    ));

    return {
      ok: true,
      generatedAt: refDate.toISOString(),
      reports: generated
    };
  }

  /**
   * @param {{ granularity?: string, periodKey?: string, project?: string, limit?: number }} [options]
   */
  function analyzeProjects({
    granularity = 'monthly',
    periodKey = 'latest',
    project = '',
    limit = 20
  } = {}) {
    const fetched = getReport(granularity, periodKey, { format: 'json' });
    if (!fetched || fetched.ok === false || !fetched.report) {
      return {
        ok: false,
        error: fetched?.error || 'not_found',
        ...(fetched?.message ? { message: fetched.message } : {})
      };
    }
    return analyzeProjectUsage(fetched.report, { project, limit });
  }

  function flush() {
    if (snapshotTimer) {
      clearTimeout(snapshotTimer);
      snapshotTimer = null;
    }
    if (reportTimer) {
      clearTimeout(reportTimer);
      reportTimer = null;
    }
    if (snapshotDirty) {
      writeSnapshotsNow();
    }
    if (reportDirty && currentConfig.enabled) {
      generateEnabledCurrentReports();
    }
  }

  function stop() {
    stopped = true;
    try {
      flush();
    } catch (error) {
      logError(error, 'failed to flush reports on stop');
    }
  }

  return {
    getConfig,
    setConfig,
    recordIngestSnapshot,
    onStatsChanged,
    listReports,
    getReport,
    generateReport,
    analyzeProjects,
    flush,
    stop
  };
}

module.exports = {
  MAX_SNAPSHOT_DAYS,
  createReportManager
};
