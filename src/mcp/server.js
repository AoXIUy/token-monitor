#!/usr/bin/env node
// @ts-check
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { URLSearchParams } = require('node:url');

const { parseArgs, projectRoot, readJson } = require('../shared/config');
const { createMcpReportServer, JSON_RPC_ERRORS } = require('../shared/mcpReportProtocol');
const { DEFAULT_STALE_AFTER_MS } = require('../shared/syncUploadInterval');
const { aggregateDevices, aggregateHistory } = require('../shared/usage');
const {
  REPORT_GRANULARITIES,
  REPORT_SCHEMA,
  analyzeProjectUsage,
  buildUsageReport,
  renderReportJson,
  renderReportMarkdown,
  reportContentSignature,
  resolveReportPeriod
} = require('../shared/usageReport');

const DEFAULT_HUB_URL = 'http://127.0.0.1:17321';
const DEFAULT_REQUEST_TIMEOUT_MS = 15000;
const MAX_CONTENT_LENGTH_BYTES = 64 * 1024 * 1024;
const PERIOD_KEY_PATTERNS = Object.freeze({
  daily: /^\d{4}-\d{2}-\d{2}$/,
  weekly: /^\d{4}-W\d{2}$/,
  monthly: /^\d{4}-\d{2}$/
});

/**
 * @returns {string}
 */
function readPackageVersion() {
  const pkg = readJson(path.join(projectRoot(), 'package.json'), null);
  return pkg && typeof pkg.version === 'string' && pkg.version ? pkg.version : '1.0.0';
}

/**
 * @param {any} value
 * @returns {string}
 */
function nonEmptyString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * @param {string} filePath
 * @param {string} content
 */
function writeTextAtomic(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, content, 'utf8');
  fs.renameSync(tempPath, filePath);
}

/**
 * @param {any} result
 * @returns {any}
 */
function unwrapReportObject(result) {
  if (!result || typeof result !== 'object') return null;
  if (result.report && typeof result.report === 'object') return result.report;
  if (result.schema === REPORT_SCHEMA || (result.summary && result.period)) return result;
  return null;
}

/**
 * Resolve CLI flags and environment variables for the standalone MCP server.
 * @param {{ argv?: string[], env?: NodeJS.ProcessEnv }} [options]
 * @returns {{
 *   help: boolean,
 *   mode: 'hub' | 'local',
 *   hubUrl: string,
 *   secret: string,
 *   dataFile: string,
 *   reportsDir: string,
 *   timeZone: string,
 *   staleAfterMs: number
 * }}
 */
function resolveMcpServerOptions(options = {}) {
  const argv = Array.isArray(options.argv) ? options.argv : process.argv.slice(2);
  const env = options.env || process.env;
  const args = /** @type {Record<string, any>} */ (parseArgs(argv));

  const help = Boolean(args.help === true || argv.includes('-h') || argv.includes('--help'));

  const cliHubUrl = nonEmptyString(args['hub-url'] ?? args.hubUrl);
  const envHubUrl = nonEmptyString(env.TOKEN_MONITOR_HUB_URL);
  const cliDataFile = nonEmptyString(args['data-file'] ?? args.dataFile);
  const envDataFile = nonEmptyString(env.TOKEN_MONITOR_DATA_FILE);
  const cliReportsDir = nonEmptyString(args['reports-dir'] ?? args.reportsDir);
  const envReportsDir = nonEmptyString(env.TOKEN_MONITOR_REPORTS_DIR);
  const cliSecret = nonEmptyString(args.secret);
  const envSecret = nonEmptyString(env.TOKEN_MONITOR_SECRET);
  const cliTimeZone = nonEmptyString(args['time-zone'] ?? args.timeZone);
  const envTimeZone = nonEmptyString(env.TOKEN_MONITOR_TIME_ZONE);
  const cliLocal = args.local === true || String(args.local || '').toLowerCase() === 'true';

  /** @type {'hub' | 'local'} */
  let mode;
  if (cliLocal || cliDataFile) {
    mode = 'local';
  } else if (cliHubUrl) {
    mode = 'hub';
  } else if (envDataFile && !envHubUrl) {
    mode = 'local';
  } else {
    mode = 'hub';
  }

  const resolvedDataFile = path.resolve(
    cliDataFile || envDataFile || path.join(projectRoot(), 'data', 'devices.json')
  );
  const resolvedReportsDir = cliReportsDir || envReportsDir
    ? path.resolve(cliReportsDir || envReportsDir)
    : path.join(path.dirname(resolvedDataFile), 'reports');

  const rawStale = Number(args['stale-after-ms'] ?? args.staleAfterMs ?? env.TOKEN_MONITOR_STALE_AFTER_MS);
  const staleAfterMs = Number.isFinite(rawStale) && rawStale > 0 ? rawStale : DEFAULT_STALE_AFTER_MS;

  return {
    help,
    mode,
    hubUrl: (cliHubUrl || envHubUrl || DEFAULT_HUB_URL).replace(/\/+$/, ''),
    secret: cliSecret || envSecret,
    dataFile: resolvedDataFile,
    reportsDir: resolvedReportsDir,
    timeZone: cliTimeZone || envTimeZone,
    staleAfterMs
  };
}

/**
 * Create a backend adapter targeting a running Token Monitor Hub over HTTP(S).
 * @param {object} [options]
 * @param {string} [options.hubUrl]
 * @param {string} [options.secret]
 * @param {number} [options.requestTimeoutMs]
 * @param {typeof globalThis.fetch} [options.fetchImpl]
 */
function createHubBackendAdapter(options = {}) {
  const baseUrl = (nonEmptyString(options.hubUrl) || DEFAULT_HUB_URL).replace(/\/+$/, '');
  const secret = nonEmptyString(options.secret);
  const timeoutMs = Number.isFinite(Number(options.requestTimeoutMs)) && Number(options.requestTimeoutMs) > 0
    ? Number(options.requestTimeoutMs)
    : DEFAULT_REQUEST_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  if (typeof fetchImpl !== 'function') {
    throw new Error('Global fetch is unavailable; Node 22+ is required.');
  }

  /**
   * @param {string} method
   * @param {string} pathWithQuery
   * @param {any} [body]
   */
  async function requestJson(method, pathWithQuery, body) {
    const url = `${baseUrl}${pathWithQuery}`;
    /** @type {Record<string, string>} */
    const headers = {
      accept: 'application/json'
    };
    if (secret) {
      headers.authorization = `Bearer ${secret}`;
    }
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
    }

    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Hub request failed (${method} ${url}): ${msg}`, { cause: err });
    }

    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }

    return {
      status: response.status,
      ok: response.ok,
      data,
      text
    };
  }

  /**
   * @param {{ status: number, data: any, text: string }} res
   * @param {string} fallback
   * @returns {string}
   */
  function formatHttpError(res, fallback) {
    if (res.status === 401 || res.status === 403) {
      return `Hub authentication failed (HTTP ${res.status}): check TOKEN_MONITOR_SECRET / --secret`;
    }
    if (res.data && typeof res.data === 'object') {
      if (typeof res.data.error === 'string' && res.data.error) return res.data.error;
      if (typeof res.data.message === 'string' && res.data.message) return res.data.message;
    }
    return fallback || `Hub HTTP ${res.status}`;
  }

  return {
    mode: /** @type {const} */ ('hub'),

    /**
     * @param {{ granularity?: string, limit?: number }} [args]
     */
    async listReports(args = {}) {
      const params = new URLSearchParams();
      if (args.granularity) params.set('granularity', String(args.granularity));
      if (args.limit !== undefined) params.set('limit', String(args.limit));
      const qs = params.toString();
      const res = await requestJson('GET', qs ? `/api/reports?${qs}` : '/api/reports');
      if (!res.ok) {
        return { ok: false, error: formatHttpError(res, `Failed to list reports (HTTP ${res.status})`) };
      }
      return res.data || { ok: true, reports: [] };
    },

    /**
     * @param {{ granularity: string, periodKey?: string, format?: string }} args
     */
    async getReport(args) {
      const granularity = String(args?.granularity || '').trim();
      if (!REPORT_GRANULARITIES.includes(granularity)) {
        return { ok: false, error: `Invalid granularity: ${granularity}` };
      }
      const periodKey = String(args?.periodKey || 'latest').trim() || 'latest';
      const format = String(args?.format || 'both').trim() || 'both';
      const res = await requestJson(
        'GET',
        `/api/reports/${encodeURIComponent(granularity)}/${encodeURIComponent(periodKey)}?format=${encodeURIComponent(format)}`
      );
      if (res.status === 404) {
        return {
          ok: false,
          error: (res.data && typeof res.data.error === 'string' && res.data.error)
            || `Report not found for ${granularity}:${periodKey}.`
        };
      }
      if (!res.ok) {
        return { ok: false, error: formatHttpError(res, `Failed to fetch report (HTTP ${res.status})`) };
      }
      return res.data;
    },

    /**
     * @param {{ granularity?: string, periodKey?: string, force?: boolean }} [args]
     */
    async generateReport(args = {}) {
      const payload = {
        ...(args.granularity !== undefined ? { granularity: String(args.granularity) } : {}),
        ...(args.periodKey !== undefined ? { periodKey: String(args.periodKey) } : {}),
        ...(args.force !== undefined ? { force: Boolean(args.force) } : {})
      };
      const res = await requestJson('POST', '/api/reports/generate', payload);
      if (!res.ok) {
        return { ok: false, error: formatHttpError(res, `Failed to generate report (HTTP ${res.status})`) };
      }
      return res.data || { ok: true, reports: [] };
    },

    /**
     * @param {{ granularity?: string, periodKey?: string, project?: string, limit?: number }} [args]
     */
    async analyzeProjects(args = {}) {
      const granularity = String(args.granularity || 'weekly').trim() || 'weekly';
      if (!REPORT_GRANULARITIES.includes(granularity)) {
        return { ok: false, error: `Invalid granularity: ${granularity}` };
      }
      const periodKey = String(args.periodKey || 'latest').trim() || 'latest';
      const pathWithQuery = `/api/reports/${encodeURIComponent(granularity)}/${encodeURIComponent(periodKey)}?format=json`;
      let res = await requestJson('GET', pathWithQuery);

      if (res.status === 404) {
        const genRes = await requestJson('POST', '/api/reports/generate', {
          granularity,
          periodKey
        });
        if (!genRes.ok) {
          return {
            ok: false,
            error: formatHttpError(genRes, `Report not found for ${granularity}:${periodKey}.`)
          };
        }
        const generatedList = Array.isArray(genRes.data?.reports) ? genRes.data.reports : [];
        const matchedGen = generatedList.find(
          (/** @type {any} */ entry) => entry && entry.granularity === granularity && unwrapReportObject(entry)
        );
        const directReport = unwrapReportObject(genRes.data) || (matchedGen ? unwrapReportObject(matchedGen) : null);
        if (directReport) {
          return analyzeProjectUsage(directReport, {
            project: args.project,
            limit: args.limit
          });
        }
        res = await requestJson('GET', pathWithQuery);
      }

      if (!res.ok) {
        return { ok: false, error: formatHttpError(res, `Failed to load report (HTTP ${res.status})`) };
      }

      const reportObj = unwrapReportObject(res.data);
      if (!reportObj) {
        return { ok: false, error: `Report not found for ${granularity}:${periodKey}.` };
      }

      return analyzeProjectUsage(reportObj, {
        project: args.project,
        limit: args.limit
      });
    },

    async getStats() {
      const res = await requestJson('GET', '/api/stats');
      if (!res.ok) {
        return { ok: false, error: formatHttpError(res, `Failed to load live stats (HTTP ${res.status})`) };
      }
      return res.data || {};
    },

    /**
     * @param {{ granularity?: string, periodKey?: string, question?: string, language?: string, refresh?: boolean }} [args]
     */
    async analyzeWithAi(args = {}) {
      const res = await requestJson('POST', '/api/reports/ai-analyze', {
        ...(args.granularity !== undefined ? { granularity: String(args.granularity) } : {}),
        ...(args.periodKey !== undefined ? { periodKey: String(args.periodKey) } : {}),
        ...(args.question !== undefined ? { question: String(args.question) } : {}),
        ...(args.language !== undefined ? { language: String(args.language) } : {}),
        ...(args.refresh !== undefined ? { refresh: Boolean(args.refresh) } : {})
      });
      if (!res.ok) {
        return { ok: false, error: formatHttpError(res, `AI analysis failed (HTTP ${res.status})`) };
      }
      return res.data || { ok: false, error: 'Empty AI response' };
    },

    /**
     * @param {{ granularity?: string, periodKey?: string, includeAi?: boolean, includeLimits?: boolean, question?: string }} [args]
     */
    async pushToOpenClaw(args = {}) {
      const res = await requestJson('POST', '/api/reports/push', {
        target: 'openclaw',
        ...(args.granularity !== undefined ? { granularity: String(args.granularity) } : {}),
        ...(args.periodKey !== undefined ? { periodKey: String(args.periodKey) } : {}),
        ...(args.includeAi !== undefined ? { includeAi: Boolean(args.includeAi) } : {}),
        ...(args.includeLimits !== undefined ? { includeLimits: Boolean(args.includeLimits) } : {}),
        ...(args.question !== undefined ? { question: String(args.question) } : {})
      });
      if (!res.ok) {
        return { ok: false, error: formatHttpError(res, `OpenClaw push failed (HTTP ${res.status})`) };
      }
      return res.data || { ok: false, error: 'Empty push response' };
    }
  };
}

/**
 * Create a backend adapter reading `devices.json`, `daily-snapshots.json`, and
 * persisted reports directly from disk without a running Hub process.
 * @param {object} [options]
 * @param {string} [options.dataFile]
 * @param {string} [options.reportsDir]
 * @param {string} [options.timeZone]
 * @param {number} [options.staleAfterMs]
 */
function createLocalBackendAdapter(options = {}) {
  const dataFile = path.resolve(
    nonEmptyString(options.dataFile) || path.join(projectRoot(), 'data', 'devices.json')
  );
  const reportsDir = nonEmptyString(options.reportsDir)
    ? path.resolve(nonEmptyString(options.reportsDir))
    : path.join(path.dirname(dataFile), 'reports');
  const defaultTimeZone = nonEmptyString(options.timeZone);
  const staleAfterMs = Number.isFinite(Number(options.staleAfterMs)) && Number(options.staleAfterMs) > 0
    ? Number(options.staleAfterMs)
    : DEFAULT_STALE_AFTER_MS;

  function loadSnapshot() {
    const store = /** @type {any} */ (readJson(dataFile, /** @type {any} */ ({ version: 1, devices: {} })))
      || { version: 1, devices: {} };
    const rawDevices = store.devices && typeof store.devices === 'object'
      ? Object.values(store.devices)
      : [];
    const stats = /** @type {any} */ (aggregateDevices(rawDevices, staleAfterMs));
    stats.runtime = 'local-store';
    const history = aggregateHistory(rawDevices);

    const rawSnapshots = readJson(path.join(reportsDir, 'daily-snapshots.json'), null);
    /** @type {Record<string, any>} */
    let dailySnapshots = {};
    if (rawSnapshots && typeof rawSnapshots === 'object') {
      dailySnapshots = rawSnapshots.snapshots && typeof rawSnapshots.snapshots === 'object'
        ? rawSnapshots.snapshots
        : rawSnapshots;
    }

    return { rawDevices, stats, history, dailySnapshots };
  }

  /**
   * @param {string} granularity
   */
  function scanDiskReports(granularity) {
    const dirPath = path.join(reportsDir, granularity);
    /** @type {string[]} */
    let entries;
    try {
      entries = fs.readdirSync(dirPath);
    } catch (err) {
      if (/** @type {NodeJS.ErrnoException} */ (err)?.code === 'ENOENT') return [];
      throw err;
    }

    /** @type {Array<{
     *   reportId: string,
     *   granularity: string,
     *   periodKey: string,
     *   label: string,
     *   startDate: string,
     *   endDate: string,
     *   generatedAt: string,
     *   totalTokens: number,
     *   knownCostUsd: number,
     *   projectCount: number,
     *   files: { json: string, markdown: string | null },
     *   report: any
     * }>} */
    const out = [];
    const pattern = Object.hasOwn(PERIOD_KEY_PATTERNS, granularity)
      ? PERIOD_KEY_PATTERNS[/** @type {'daily' | 'weekly' | 'monthly'} */ (granularity)]
      : null;
    if (!pattern) return out;

    for (const fileName of entries) {
      if (!fileName.endsWith('.json')) continue;
      const baseKey = path.basename(fileName, '.json');
      if (!pattern.test(baseKey)) continue;
      const jsonPath = path.join(dirPath, fileName);
      const report = readJson(jsonPath, null);
      if (!report || typeof report !== 'object') continue;
      const rawPeriodKey = typeof report.period?.key === 'string' ? report.period.key.trim() : '';
      if (rawPeriodKey && !pattern.test(rawPeriodKey)) continue;
      const periodKey = rawPeriodKey || baseKey;
      const mdPath = path.join(dirPath, `${periodKey}.md`);
      out.push({
        reportId: String(report.reportId || `${granularity}:${periodKey}`),
        granularity,
        periodKey,
        label: String(report.period?.label || periodKey),
        startDate: String(report.period?.startDate || ''),
        endDate: String(report.period?.endDate || ''),
        generatedAt: String(report.period?.generatedAt || ''),
        totalTokens: Number(report.summary?.totalTokens || 0),
        knownCostUsd: Number(report.summary?.knownCostUsd || 0),
        projectCount: Number(report.summary?.projectCount || 0),
        files: {
          json: jsonPath,
          markdown: fs.existsSync(mdPath) ? mdPath : null
        },
        report
      });
    }
    return out;
  }

  /**
   * @param {any[]} items
   */
  function sortReportsNewestFirst(items) {
    return items.sort((a, b) => (
      String(b.startDate).localeCompare(String(a.startDate))
      || String(b.periodKey).localeCompare(String(a.periodKey))
      || String(b.generatedAt).localeCompare(String(a.generatedAt))
      || String(a.granularity).localeCompare(String(b.granularity))
    ));
  }

  /**
   * @param {Record<string, any>} dailySnapshots
   * @param {string} startDate
   * @param {string} endDate
   */
  function hasSnapshotInRange(dailySnapshots, startDate, endDate) {
    for (const dateKey of Object.keys(dailySnapshots || {})) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateKey) && dateKey >= startDate && dateKey <= endDate) {
        return true;
      }
    }
    return false;
  }

  return {
    mode: /** @type {const} */ ('local'),

    /**
     * @param {{ granularity?: string, limit?: number }} [args]
     */
    async listReports(args = {}) {
      if (args.granularity !== undefined && !REPORT_GRANULARITIES.includes(String(args.granularity))) {
        return { ok: false, error: `Invalid granularity: ${String(args.granularity)}` };
      }
      const targets = args.granularity ? [String(args.granularity)] : [...REPORT_GRANULARITIES];
      const limit = Number.isInteger(args.limit) && /** @type {number} */ (args.limit) > 0
        ? /** @type {number} */ (args.limit)
        : 50;

      const items = sortReportsNewestFirst(
        targets.flatMap((g) => scanDiskReports(g))
      )
        .slice(0, limit)
        .map(({ report: _ignored, ...summary }) => summary);

      return {
        ok: true,
        mode: 'local',
        dataFile,
        reportsDir,
        reports: items
      };
    },

    /**
     * @param {{ granularity: string, periodKey?: string, format?: string, timeZone?: string }} args
     */
    async getReport(args) {
      const granularity = String(args?.granularity || '').trim();
      if (!REPORT_GRANULARITIES.includes(granularity)) {
        return { ok: false, error: `Invalid granularity: ${granularity}` };
      }
      const rawKey = String(args?.periodKey || 'latest').trim() || 'latest';
      const format = String(args?.format || 'both').trim() || 'both';
      const timeZone = nonEmptyString(args?.timeZone) || defaultTimeZone || undefined;
      const isLatestAlias = rawKey.toLowerCase() === 'latest';

      let resolved;
      try {
        resolved = resolveReportPeriod(granularity, rawKey, { timeZone });
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }

      const jsonPath = path.join(reportsDir, granularity, `${resolved.key}.json`);
      const mdPath = path.join(reportsDir, granularity, `${resolved.key}.md`);
      const diskReport = fs.existsSync(jsonPath) ? readJson(jsonPath, null) : null;
      const diskMd = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf8') : null;

      if (diskReport) {
        if (format === 'markdown') {
          return {
            ok: true,
            markdown: diskMd ?? renderReportMarkdown(diskReport),
            files: { json: jsonPath, markdown: diskMd !== null ? mdPath : null }
          };
        }
        if (format === 'json') {
          return {
            ok: true,
            report: diskReport,
            files: { json: jsonPath, markdown: diskMd !== null ? mdPath : null }
          };
        }
        return {
          ok: true,
          report: diskReport,
          markdown: diskMd ?? renderReportMarkdown(diskReport),
          files: { json: jsonPath, markdown: diskMd !== null ? mdPath : null }
        };
      }

      if (format === 'markdown' && diskMd !== null) {
        return {
          ok: true,
          markdown: diskMd,
          files: { json: null, markdown: mdPath }
        };
      }

      const { rawDevices, stats, history, dailySnapshots } = loadSnapshot();
      const rangeHasSnapshots = hasSnapshotInRange(dailySnapshots, resolved.startDate, resolved.endDate);
      const built = buildUsageReport({
        granularity: resolved.granularity,
        periodKey: resolved.key,
        stats,
        history,
        devices: rawDevices,
        dailySnapshots,
        timeZone
      });

      const hasLiveOrHistoricalData = built.summary.totalTokens > 0
        || rangeHasSnapshots
        || (resolved.isCurrent && rawDevices.length > 0);

      if (!hasLiveOrHistoricalData) {
        if (isLatestAlias) {
          const existing = sortReportsNewestFirst(scanDiskReports(granularity));
          if (existing.length > 0) {
            const latest = existing[0];
            const latestMd = latest.files.markdown ? fs.readFileSync(latest.files.markdown, 'utf8') : null;
            if (format === 'markdown') {
              return {
                ok: true,
                markdown: latestMd ?? renderReportMarkdown(latest.report),
                files: latest.files
              };
            }
            if (format === 'json') {
              return { ok: true, report: latest.report, files: latest.files };
            }
            return {
              ok: true,
              report: latest.report,
              markdown: latestMd ?? renderReportMarkdown(latest.report),
              files: latest.files
            };
          }
        }
        return { ok: false, error: `Report not found for ${granularity}:${resolved.key}.` };
      }

      if (isLatestAlias && built.summary.totalTokens === 0) {
        const existing = sortReportsNewestFirst(scanDiskReports(granularity));
        if (existing.length > 0) {
          const latest = existing[0];
          const latestMd = latest.files.markdown ? fs.readFileSync(latest.files.markdown, 'utf8') : null;
          if (format === 'markdown') {
            return {
              ok: true,
              markdown: latestMd ?? renderReportMarkdown(latest.report),
              files: latest.files
            };
          }
          if (format === 'json') {
            return { ok: true, report: latest.report, files: latest.files };
          }
          return {
            ok: true,
            report: latest.report,
            markdown: latestMd ?? renderReportMarkdown(latest.report),
            files: latest.files
          };
        }
      }

      if (format === 'markdown') {
        return { ok: true, markdown: renderReportMarkdown(built) };
      }
      if (format === 'json') {
        return { ok: true, report: built };
      }
      return {
        ok: true,
        report: built,
        markdown: renderReportMarkdown(built)
      };
    },

    /**
     * @param {{ granularity?: string, periodKey?: string, force?: boolean, timeZone?: string }} [args]
     */
    async generateReport(args = {}) {
      const rawGranularity = args.granularity;
      /** @type {Array<'daily' | 'weekly' | 'monthly'>} */
      let targets;
      if (rawGranularity === undefined || rawGranularity === 'all') {
        targets = /** @type {Array<'daily' | 'weekly' | 'monthly'>} */ ([...REPORT_GRANULARITIES]);
      } else if (REPORT_GRANULARITIES.includes(String(rawGranularity))) {
        targets = [/** @type {'daily' | 'weekly' | 'monthly'} */ (String(rawGranularity))];
      } else {
        return { ok: false, error: `Invalid granularity: ${String(rawGranularity)}` };
      }

      const periodKey = args.periodKey !== undefined ? String(args.periodKey) : 'current';
      const force = Boolean(args.force);
      const timeZone = nonEmptyString(args.timeZone) || defaultTimeZone || undefined;
      const { rawDevices, stats, history, dailySnapshots } = loadSnapshot();

      /** @type {Array<{ granularity: 'daily' | 'weekly' | 'monthly', report: any }>} */
      const builtReports = [];
      try {
        for (const g of targets) {
          const report = buildUsageReport({
            granularity: g,
            periodKey,
            stats,
            history,
            devices: rawDevices,
            dailySnapshots,
            timeZone
          });
          builtReports.push({ granularity: g, report });
        }
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err)
        };
      }

      const generated = [];
      for (const { granularity: g, report } of builtReports) {
        const jsonPath = path.join(reportsDir, g, `${report.period.key}.json`);
        const mdPath = path.join(reportsDir, g, `${report.period.key}.md`);
        const sig = reportContentSignature(report);
        const existing = fs.existsSync(jsonPath) ? readJson(jsonPath, null) : null;
        const unchanged = !force
          && existing
          && reportContentSignature(existing) === sig
          && fs.existsSync(mdPath);

        if (!unchanged) {
          writeTextAtomic(jsonPath, renderReportJson(report));
          writeTextAtomic(mdPath, renderReportMarkdown(report));
        }

        generated.push({
          reportId: report.reportId,
          granularity: g,
          periodKey: report.period.key,
          written: !unchanged,
          totalTokens: report.summary.totalTokens,
          knownCostUsd: report.summary.knownCostUsd,
          projectCount: report.summary.projectCount,
          files: {
            json: jsonPath,
            markdown: mdPath
          }
        });
      }

      return {
        ok: true,
        generatedAt: new Date().toISOString(),
        reportsDir,
        reports: generated
      };
    },

    /**
     * @param {{ granularity?: string, periodKey?: string, project?: string, limit?: number }} [args]
     */
    async analyzeProjects(args = {}) {
      const granularity = String(args.granularity || 'weekly').trim() || 'weekly';
      if (!REPORT_GRANULARITIES.includes(granularity)) {
        return { ok: false, error: `Invalid granularity: ${granularity}` };
      }
      const periodKey = String(args.periodKey || 'latest').trim() || 'latest';
      const fetched = await this.getReport({ granularity, periodKey, format: 'json' });
      if (!fetched || fetched.ok === false || !fetched.report) {
        return {
          ok: false,
          error: fetched?.error || `Report not found for ${granularity}:${periodKey}.`
        };
      }
      return analyzeProjectUsage(fetched.report, {
        project: args.project,
        limit: args.limit
      });
    },

    async getStats() {
      return loadSnapshot().stats || {};
    },

    async analyzeWithAi() {
      return { ok: false, error: 'analyze_report_with_ai requires Hub HTTP mode or configured Main Hub.' };
    },

    async pushToOpenClaw() {
      return { ok: false, error: 'push_report_to_openclaw requires Hub HTTP mode or configured Main Hub.' };
    }
  };
}

/**
 * Create a backend adapter in either Hub HTTP mode or Local Store direct mode.
 * @param {object} [options]
 * @param {'hub' | 'local'} [options.mode]
 * @param {string} [options.hubUrl]
 * @param {string} [options.secret]
 * @param {number} [options.requestTimeoutMs]
 * @param {typeof globalThis.fetch} [options.fetchImpl]
 * @param {string} [options.dataFile]
 * @param {string} [options.reportsDir]
 * @param {string} [options.timeZone]
 * @param {number} [options.staleAfterMs]
 */
function createBackendAdapter(options = {}) {
  const mode = options.mode === 'local'
    || (!options.mode && (nonEmptyString(options.dataFile) || nonEmptyString(options.reportsDir)))
    ? 'local'
    : 'hub';

  if (mode === 'local') {
    return createLocalBackendAdapter({
      dataFile: options.dataFile,
      reportsDir: options.reportsDir,
      timeZone: options.timeZone,
      staleAfterMs: options.staleAfterMs
    });
  }

  return createHubBackendAdapter({
    hubUrl: options.hubUrl,
    secret: options.secret,
    requestTimeoutMs: options.requestTimeoutMs,
    fetchImpl: options.fetchImpl
  });
}

/**
 * Find the first `\r\n\r\n` or `\n\n` header separator in a buffer.
 * @param {Buffer} buf
 * @returns {{ index: number, sepLen: number } | null}
 */
function findHeaderEnd(buf) {
  const crlf = buf.indexOf('\r\n\r\n');
  const lf = buf.indexOf('\n\n');
  if (crlf === -1 && lf === -1) return null;
  if (crlf !== -1 && (lf === -1 || crlf < lf)) {
    return { index: crlf, sepLen: 4 };
  }
  return { index: lf, sepLen: 2 };
}

/**
 * Check whether the leading bytes look like (or could still become) an LSP-style
 * `Content-Length:` / `Content-Type:` header block rather than newline-delimited JSON.
 * @param {Buffer} buf
 * @returns {'header' | 'need_more' | 'ndjson'}
 */
function classifyLeadingFraming(buf) {
  let offset = 0;
  while (offset < buf.length && (buf[offset] === 0x20 || buf[offset] === 0x09)) {
    offset += 1;
  }
  if (offset >= buf.length) return 'need_more';
  const first = buf[offset];
  if (first === 0x7b || first === 0x5b) {
    return 'ndjson';
  }

  const probe = buf.subarray(offset, Math.min(buf.length, offset + 32)).toString('ascii').toLowerCase();
  if (/^(content-length|content-type)\s*:/.test(probe)) {
    return 'header';
  }
  const nlIdx = buf.indexOf(0x0a, offset);
  if (nlIdx === -1 && ('content-length:'.startsWith(probe) || 'content-type:'.startsWith(probe))) {
    return 'need_more';
  }
  return 'ndjson';
}

/**
 * Create a framed stdio transport supporting both newline-delimited JSON
 * (default MCP stdio framing) and `Content-Length: N\r\n\r\n` framing.
 * @param {object} options
 * @param {NodeJS.ReadableStream} [options.input]
 * @param {NodeJS.WritableStream} [options.output]
 * @param {NodeJS.WritableStream} [options.stderr]
 * @param {(payload: string) => Promise<any> | any} options.onPayload
 */
function createStdioMcpTransport({
  input = process.stdin,
  output = process.stdout,
  stderr = process.stderr,
  onPayload
}) {
  if (typeof onPayload !== 'function') {
    throw new TypeError('createStdioMcpTransport requires an onPayload handler.');
  }

  /** @type {Buffer} */
  let buffer = Buffer.alloc(0);
  let started = false;
  let stopped = false;
  let inputEnded = false;
  /** @type {'ndjson' | 'content-length'} */
  let defaultReplyFraming = 'ndjson';
  /** @type {Promise<void>} */
  let queue = Promise.resolve();
  /** @type {(value?: void) => void} */
  let resolveClosed = () => {};
  const closed = new Promise((resolve) => {
    resolveClosed = resolve;
  });

  /**
   * @param {string} text
   */
  function logError(text) {
    try {
      if (stderr && !/** @type {any} */ (stderr).destroyed) {
        stderr.write(`${text}\n`);
      }
    } catch (_) {}
  }

  /**
   * @param {any} payload
   * @param {'ndjson' | 'content-length'} [framing]
   */
  function send(payload, framing = defaultReplyFraming) {
    if (payload === null || payload === undefined || stopped) return;
    const jsonText = JSON.stringify(payload);
    try {
      if (framing === 'content-length') {
        const bodyBuf = Buffer.from(jsonText, 'utf8');
        const frame = Buffer.concat([
          Buffer.from(`Content-Length: ${bodyBuf.length}\r\n\r\n`, 'ascii'),
          bodyBuf
        ]);
        output.write(frame);
      } else {
        output.write(`${jsonText}\n`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logError(`[mcp] failed writing response: ${msg}`);
    }
  }

  /**
   * @param {string} rawPayload
   * @param {'ndjson' | 'content-length'} framing
   */
  function enqueuePayload(rawPayload, framing) {
    queue = queue.then(async () => {
      if (stopped) return;
      try {
        const response = await onPayload(rawPayload);
        if (response !== null && response !== undefined) {
          send(response, framing);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logError(`[mcp] unhandled payload error: ${msg}`);
        send({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: JSON_RPC_ERRORS.INTERNAL_ERROR,
            message: msg || 'Internal error'
          }
        }, framing);
      }
    });
  }

  /**
   * @param {boolean} flushTrailing
   */
  function drainBuffer(flushTrailing) {
    while (buffer.length > 0 && !stopped) {
      let skip = 0;
      while (skip < buffer.length && (buffer[skip] === 0x0d || buffer[skip] === 0x0a)) {
        skip += 1;
      }
      if (skip > 0) {
        buffer = buffer.subarray(skip);
      }
      if (buffer.length === 0) break;

      const kind = classifyLeadingFraming(buffer);
      if (kind === 'need_more') {
        if (!flushTrailing) break;
        const trailing = buffer.toString('utf8').trim();
        buffer = Buffer.alloc(0);
        if (trailing) {
          enqueuePayload(trailing, defaultReplyFraming);
        }
        break;
      }

      if (kind === 'header') {
        const headerEnd = findHeaderEnd(buffer);
        if (!headerEnd) break;
        const headerText = buffer.subarray(0, headerEnd.index).toString('ascii');
        const match = /^content-length:\s*(\d+)/im.exec(headerText);
        if (!match) {
          buffer = buffer.subarray(headerEnd.index + headerEnd.sepLen);
          defaultReplyFraming = 'content-length';
          send({
            jsonrpc: '2.0',
            id: null,
            error: {
              code: JSON_RPC_ERRORS.PARSE_ERROR,
              message: 'Missing or invalid Content-Length header'
            }
          }, 'content-length');
          continue;
        }
        const contentLength = Number(match[1]);
        if (!Number.isInteger(contentLength) || contentLength < 0 || contentLength > MAX_CONTENT_LENGTH_BYTES) {
          buffer = buffer.subarray(headerEnd.index + headerEnd.sepLen);
          defaultReplyFraming = 'content-length';
          send({
            jsonrpc: '2.0',
            id: null,
            error: {
              code: JSON_RPC_ERRORS.PARSE_ERROR,
              message: 'Invalid Content-Length size'
            }
          }, 'content-length');
          continue;
        }
        const bodyStart = headerEnd.index + headerEnd.sepLen;
        if (buffer.length < bodyStart + contentLength) {
          break;
        }
        const bodyText = buffer.subarray(bodyStart, bodyStart + contentLength).toString('utf8');
        buffer = buffer.subarray(bodyStart + contentLength);
        defaultReplyFraming = 'content-length';
        if (bodyText.trim()) {
          enqueuePayload(bodyText, 'content-length');
        }
        continue;
      }

      const nlIndex = buffer.indexOf(0x0a);
      if (nlIndex === -1) {
        if (!flushTrailing) break;
        const finalLine = buffer.toString('utf8').replace(/\r$/, '').trim();
        buffer = Buffer.alloc(0);
        if (finalLine) {
          defaultReplyFraming = 'ndjson';
          enqueuePayload(finalLine, 'ndjson');
        }
        break;
      }

      const line = buffer.subarray(0, nlIndex).toString('utf8').replace(/\r$/, '').trim();
      buffer = buffer.subarray(nlIndex + 1);
      if (line) {
        defaultReplyFraming = 'ndjson';
        enqueuePayload(line, 'ndjson');
      }
    }
  }

  /**
   * @param {Buffer | string} chunk
   */
  function onData(chunk) {
    if (stopped) return;
    const chunkBuf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8');
    if (chunkBuf.length === 0) return;
    buffer = buffer.length === 0 ? chunkBuf : Buffer.concat([buffer, chunkBuf]);
    drainBuffer(false);
  }

  function finish() {
    if (inputEnded) return;
    inputEnded = true;
    drainBuffer(true);
    queue.finally(() => {
      cleanupListeners();
      resolveClosed();
    });
  }

  /**
   * @param {Error} err
   */
  function onInputError(err) {
    logError(`[mcp] input stream error: ${err?.message || err}`);
    finish();
  }

  function cleanupListeners() {
    input.off('data', onData);
    input.off('end', finish);
    input.off('close', finish);
    input.off('error', onInputError);
  }

  function start() {
    if (started || stopped) return;
    started = true;
    input.on('data', onData);
    input.on('end', finish);
    input.on('close', finish);
    input.on('error', onInputError);
    if (typeof /** @type {any} */ (input).resume === 'function') {
      /** @type {any} */ (input).resume();
    }
  }

  async function stop() {
    if (stopped) return closed;
    stopped = true;
    cleanupListeners();
    await queue.catch(() => {});
    resolveClosed();
    return closed;
  }

  return {
    start,
    stop,
    send,
    closed
  };
}

/**
 * Start the standalone MCP stdio server.
 * @param {object} [options]
 * @param {string[]} [options.argv]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {'hub' | 'local'} [options.mode]
 * @param {string} [options.hubUrl]
 * @param {string} [options.secret]
 * @param {number} [options.requestTimeoutMs]
 * @param {typeof globalThis.fetch} [options.fetchImpl]
 * @param {string} [options.dataFile]
 * @param {string} [options.reportsDir]
 * @param {string} [options.timeZone]
 * @param {number} [options.staleAfterMs]
 * @param {NodeJS.ReadableStream} [options.input]
 * @param {NodeJS.WritableStream} [options.output]
 * @param {NodeJS.WritableStream} [options.stderr]
 * @param {{ name?: string, version?: string }} [options.serverInfo]
 * @param {boolean} [options.installSignalHandlers]
 */
function startMcpServer(options = {}) {
  const resolved = resolveMcpServerOptions({
    argv: options.argv,
    env: options.env
  });

  const mode = options.mode || resolved.mode;
  const backend = createBackendAdapter({
    mode,
    hubUrl: options.hubUrl ?? resolved.hubUrl,
    secret: options.secret ?? resolved.secret,
    requestTimeoutMs: options.requestTimeoutMs,
    fetchImpl: options.fetchImpl,
    dataFile: options.dataFile ?? resolved.dataFile,
    reportsDir: options.reportsDir ?? resolved.reportsDir,
    timeZone: options.timeZone ?? resolved.timeZone,
    staleAfterMs: options.staleAfterMs ?? resolved.staleAfterMs
  });

  const mcpServer = createMcpReportServer({
    listReports: (args) => backend.listReports(args),
    getReport: (args) => backend.getReport(args),
    generateReport: (args) => backend.generateReport(args),
    analyzeProjects: (args) => backend.analyzeProjects(args),
    getStats: () => backend.getStats(),
    analyzeWithAi: (args) => backend.analyzeWithAi(args),
    pushToOpenClaw: (args) => backend.pushToOpenClaw(args),
    serverInfo: {
      name: 'token-monitor-reports',
      version: readPackageVersion(),
      ...options.serverInfo
    }
  });

  const transport = createStdioMcpTransport({
    input: options.input || process.stdin,
    output: options.output || process.stdout,
    stderr: options.stderr || process.stderr,
    onPayload: (raw) => mcpServer.handlePayload(raw)
  });

  /** @type {Array<{ signal: NodeJS.Signals, handler: () => void }>} */
  const signalListeners = [];
  let stopped = false;

  async function stop() {
    if (stopped) return transport.closed;
    stopped = true;
    for (const { signal, handler } of signalListeners) {
      process.off(signal, handler);
    }
    signalListeners.length = 0;
    return transport.stop();
  }

  if (options.installSignalHandlers) {
    for (const signal of /** @type {NodeJS.Signals[]} */ (['SIGINT', 'SIGTERM'])) {
      const handler = () => {
        stop().catch(() => {});
      };
      signalListeners.push({ signal, handler });
      process.once(signal, handler);
    }
  }

  transport.start();

  return {
    options: resolved,
    backend,
    mcpServer,
    transport,
    stop,
    closed: transport.closed
  };
}

/**
 * @param {NodeJS.WritableStream} [stderr]
 */
function printUsage(stderr = process.stderr) {
  const usage = [
    'Token Monitor MCP stdio server (usage & project reports)',
    '',
    'Usage:',
    '  node src/mcp/server.js [options]',
    '',
    'Hub HTTP mode (default):',
    '  --hub-url <url>      Hub base URL (default: TOKEN_MONITOR_HUB_URL or http://127.0.0.1:17321)',
    '  --secret <token>     Bearer secret (default: TOKEN_MONITOR_SECRET)',
    '',
    'Local store direct mode:',
    '  --local              Read local devices.json and reports directory directly',
    '  --data-file <path>   Path to devices.json (default: TOKEN_MONITOR_DATA_FILE or data/devices.json)',
    '  --reports-dir <path> Path to reports directory (default: <dirname(dataFile)>/reports)',
    '  --time-zone <tz>     Optional IANA time zone (default: local system time zone)',
    '  --help, -h           Show this help on stderr and exit'
  ].join('\n');
  stderr.write(`${usage}\n`);
}

if (require.main === module) {
  const cliOptions = resolveMcpServerOptions();
  if (cliOptions.help) {
    printUsage(process.stderr);
    process.exit(0);
  }
  const instance = startMcpServer({ installSignalHandlers: true });
  instance.closed.catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[mcp] fatal error: ${msg}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_HUB_URL,
  resolveMcpServerOptions,
  createHubBackendAdapter,
  createLocalBackendAdapter,
  createBackendAdapter,
  createStdioMcpTransport,
  startMcpServer
};
