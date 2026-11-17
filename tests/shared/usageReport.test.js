'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  REPORT_SCHEMA_VERSION,
  REPORT_SCHEMA,
  REPORT_GRANULARITIES,
  normalizeReportConfig,
  resolveReportPeriod,
  buildUsageReport,
  renderReportMarkdown,
  renderReportJson,
  reportContentSignature,
  analyzeProjectUsage
} = require('../../src/shared/usageReport');

const {
  MCP_SUPPORTED_VERSIONS,
  JSON_RPC_ERRORS,
  createMcpReportServer
} = require('../../src/shared/mcpReportProtocol');

test('report constants and normalizeReportConfig cover defaults, booleans, strings, arrays, and objects', () => {
  assert.equal(REPORT_SCHEMA_VERSION, 1);
  assert.equal(REPORT_SCHEMA, 'token-monitor-report/v1');
  assert.deepEqual(REPORT_GRANULARITIES, ['daily', 'weekly', 'monthly']);

  assert.deepEqual(normalizeReportConfig(undefined), {
    enabled: false, daily: true, weekly: true, monthly: true
  });
  assert.deepEqual(normalizeReportConfig(null), {
    enabled: false, daily: true, weekly: true, monthly: true
  });
  assert.deepEqual(normalizeReportConfig(false), {
    enabled: false, daily: true, weekly: true, monthly: true
  });
  assert.deepEqual(normalizeReportConfig(true), {
    enabled: true, daily: true, weekly: true, monthly: true
  });
  assert.deepEqual(normalizeReportConfig('daily,weekly'), {
    enabled: true, daily: true, weekly: true, monthly: false
  });
  assert.deepEqual(normalizeReportConfig('monthly'), {
    enabled: true, daily: false, weekly: false, monthly: true
  });
  assert.deepEqual(normalizeReportConfig('1'), {
    enabled: true, daily: true, weekly: true, monthly: true
  });
  assert.deepEqual(normalizeReportConfig('true'), {
    enabled: true, daily: true, weekly: true, monthly: true
  });
  assert.deepEqual(normalizeReportConfig('all'), {
    enabled: true, daily: true, weekly: true, monthly: true
  });
  assert.deepEqual(normalizeReportConfig('false'), {
    enabled: false, daily: true, weekly: true, monthly: true
  });
  assert.deepEqual(normalizeReportConfig(['daily', 'monthly']), {
    enabled: true, daily: true, weekly: false, monthly: true
  });
  assert.deepEqual(normalizeReportConfig({ enabled: true, weekly: false }), {
    enabled: true, daily: true, weekly: false, monthly: true
  });
});

test('resolveReportPeriod handles daily, ISO week year boundaries, monthly, timeZones, and validation errors', () => {
  // Timezone boundary: 2026-11-16T23:30:00Z is 2026-11-17 in Asia/Shanghai, 2026-11-16 in America/Los_Angeles
  const shanghaiDay = resolveReportPeriod('daily', 'latest', {
    now: '2026-11-16T23:30:00Z',
    timeZone: 'Asia/Shanghai'
  });
  assert.deepEqual(shanghaiDay, {
    granularity: 'daily',
    key: '2026-11-17',
    label: '2026-11-17',
    startDate: '2026-11-17',
    endDate: '2026-11-17',
    timeZone: 'Asia/Shanghai',
    isCurrent: true,
    previousPeriodKey: '2026-11-16'
  });

  const laDay = resolveReportPeriod('daily', 'current', {
    now: '2026-11-16T23:30:00Z',
    timeZone: 'America/Los_Angeles'
  });
  assert.equal(laDay.key, '2026-11-16');
  assert.equal(laDay.isCurrent, true);

  // Explicit ISO week 2026-W01 spans 2025-12-29..2026-01-04
  const w01 = resolveReportPeriod('weekly', '2026-W01', {
    now: '2025-12-30T12:00:00Z',
    timeZone: 'UTC'
  });
  assert.deepEqual(w01, {
    granularity: 'weekly',
    key: '2026-W01',
    label: '2026-W01 (2025-12-29..2026-01-04)',
    startDate: '2025-12-29',
    endDate: '2026-01-04',
    timeZone: 'UTC',
    isCurrent: true,
    previousPeriodKey: '2025-W52'
  });

  // Alias on 2026-01-04 resolves to 2026-W01
  const jan4Week = resolveReportPeriod('weekly', '', {
    now: '2026-01-04T18:00:00Z',
    timeZone: 'UTC'
  });
  assert.equal(jan4Week.key, '2026-W01');
  assert.equal(jan4Week.startDate, '2025-12-29');
  assert.equal(jan4Week.endDate, '2026-01-04');

  // 2026-W47
  const w47 = resolveReportPeriod('weekly', '2026-W47', {
    now: '2026-11-16T10:00:00Z',
    timeZone: 'UTC'
  });
  assert.equal(w47.startDate, '2026-11-16');
  assert.equal(w47.endDate, '2026-11-22');
  assert.equal(w47.previousPeriodKey, '2026-W46');
  assert.equal(w47.isCurrent, true);

  // 2020 has 53 ISO weeks
  const w53Valid = resolveReportPeriod('weekly', '2020-W53', {
    now: '2026-11-16T10:00:00Z',
    timeZone: 'UTC'
  });
  assert.equal(w53Valid.startDate, '2020-12-28');
  assert.equal(w53Valid.endDate, '2021-01-03');

  // Monthly leap year & year rollover
  const febLeap = resolveReportPeriod('monthly', '2024-02', {
    now: '2026-11-16T10:00:00Z',
    timeZone: 'UTC'
  });
  assert.equal(febLeap.startDate, '2024-02-01');
  assert.equal(febLeap.endDate, '2024-02-29');
  assert.equal(febLeap.previousPeriodKey, '2024-01');
  assert.equal(febLeap.isCurrent, false);

  const jan = resolveReportPeriod('monthly', '2026-01', {
    now: '2026-01-10T10:00:00Z',
    timeZone: 'UTC'
  });
  assert.equal(jan.previousPeriodKey, '2025-12');
  assert.equal(jan.isCurrent, true);

  // Invalid inputs reject with descriptive Errors
  assert.throws(() => resolveReportPeriod('yearly', '2026'), /granularity/i);
  assert.throws(() => resolveReportPeriod('daily', '2026-02-30'), /daily/i);
  assert.throws(() => resolveReportPeriod('weekly', '2026-W00'), /weekly/i);
  assert.throws(() => resolveReportPeriod('weekly', '2026-W54'), /weekly/i);
  assert.throws(() => resolveReportPeriod('weekly', '2025-W53'), /weekly/i);
  assert.throws(() => resolveReportPeriod('monthly', '2026-13'), /monthly/i);
  assert.throws(() => resolveReportPeriod('daily', 'latest', { timeZone: 'Mars/Olympus' }), /timeZone/i);
});

test('buildUsageReport builds live daily report with project canonicalization, components, throughput, devices, and signals', () => {
  const stats = {
    runtime: 'node-hub',
    periods: {
      today: {
        capabilities: { tokenComponents: true, throughput: true },
        totalTokens: 100000,
        costUsd: 1.5,
        unpricedTokens: 10000,
        cacheReadTokens: 15000,
        cacheWriteTokens: 5000,
        outputTokens: 10000,
        unclassifiedTokens: 0,
        timedTokens: 40000,
        timedOutputTokens: 8000,
        timedDurationMs: 4000,
        modelThroughput: {
          'claude-sonnet-4-5': { timedTokens: 40000, timedOutputTokens: 8000, timedDurationMs: 4000 }
        },
        clients: { claude: 80000, codex: 20000 },
        clientCosts: { claude: 1.2, codex: 0.3 },
        clientUnpricedTokens: { codex: 10000 },
        clientCacheReads: { claude: 15000, codex: 0 },
        clientCacheWrites: { claude: 5000, codex: 0 },
        clientOutputs: { claude: 8000, codex: 2000 },
        models: { 'claude-sonnet-4-5': 80000, 'gpt-5': 20000 },
        modelCosts: { 'claude-sonnet-4-5': 1.2, 'gpt-5': 0.3 },
        modelUnpricedTokens: { 'gpt-5': 10000 },
        modelCacheReads: { 'claude-sonnet-4-5': 15000, 'gpt-5': 0 },
        modelCacheWrites: { 'claude-sonnet-4-5': 5000, 'gpt-5': 0 },
        modelOutputs: { 'claude-sonnet-4-5': 8000, 'gpt-5': 2000 },
        projects: {
          'Alpha|Repo': {
            label: 'Alpha|Repo',
            tokens: 60000,
            costUsd: 0.9,
            clients: { claude: 60000 },
            models: { 'claude-sonnet-4-5': 60000 }
          },
          'alpha|repo': {
            label: 'alpha|repo',
            tokens: 20000,
            costUsd: 0.3,
            clients: { codex: 20000 },
            models: { 'gpt-5': 20000 }
          },
          Beta: {
            label: 'Beta',
            tokens: 20000,
            costUsd: 0.3,
            unpricedTokens: 10000,
            clients: { claude: 20000 },
            models: { 'claude-sonnet-4-5': 20000 }
          }
        },
        sessions: {
          'claude:s1': { client: 'claude', sessionId: 's1', projectLabel: 'Alpha|Repo', messageCount: 12 },
          'codex:s2': { client: 'codex', sessionId: 's2', projectLabel: 'alpha|repo', messageCount: 4 },
          'claude:s3': { client: 'claude', sessionId: 's3', projectLabel: 'Beta', messageCount: 5 },
          'reasonix:synth': { client: 'reasonix', sessionId: 'synth', usageSource: 'reasonix-stats', messageCount: 99 }
        }
      }
    },
    devices: [
      {
        deviceId: 'laptop',
        hostname: 'macbook',
        platform: 'darwin',
        stale: false,
        periodWindows: { today: { key: '2026-11-16', endsAt: '2026-11-17T00:00:00Z' } },
        periods: {
          today: { totalTokens: 75000, costUsd: 1.1, projects: { 'alpha|repo': {}, beta: {} } }
        }
      },
      {
        deviceId: 'workstation',
        hostname: 'linux-box',
        platform: 'linux',
        stale: true,
        periodWindows: { today: { key: '2026-11-16', endsAt: '2026-11-17T00:00:00Z' } },
        periods: {
          today: { totalTokens: 25000, costUsd: 0.4, projects: { 'alpha|repo': {} } }
        }
      }
    ]
  };

  const history = {
    daily: [
      {
        date: '2026-11-15',
        tokens: 25000,
        cost: 0.5,
        activeTimeMs: 60000,
        messages: 6,
        cacheReadTokens: 10000,
        cacheWriteTokens: 0,
        outputTokens: 5000,
        unclassifiedTokens: 0,
        tokenComponentsAvailable: true,
        perClient: { claude: { tokens: 25000, cost: 0.5, messages: 6 } },
        perModel: { 'claude-sonnet-4-5': { tokens: 25000, cost: 0.5 } }
      },
      {
        date: '2026-11-16',
        tokens: 90000,
        cost: 1.4,
        activeTimeMs: 180000,
        messages: 10,
        cacheReadTokens: 12000,
        cacheWriteTokens: 4000,
        outputTokens: 9000,
        unclassifiedTokens: 0,
        tokenComponentsAvailable: true,
        perClient: { claude: { tokens: 90000, cost: 1.4, messages: 10 } },
        perModel: { 'claude-sonnet-4-5': { tokens: 90000, cost: 1.4 } }
      }
    ],
    monthly: [],
    summary: { activeDaysComplete: true }
  };

  const report = buildUsageReport({
    granularity: 'daily',
    periodKey: '2026-11-16',
    stats,
    history,
    now: '2026-11-16T15:00:00Z',
    timeZone: 'UTC'
  });

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.schema, 'token-monitor-report/v1');
  assert.equal(report.reportId, 'daily:2026-11-16');
  assert.equal(report.hub.runtime, 'node-hub');
  assert.equal(report.hub.deviceCount, 2);
  assert.equal(report.hub.activeDeviceCount, 1);
  assert.equal(report.hub.staleDeviceCount, 1);

  assert.deepEqual(report.coverage, {
    tokenComponentsComplete: true,
    projectsComplete: true,
    projectAttributionSource: 'live-period',
    historyComplete: true
  });

  // inputTokens = 100000 - 15000 - 5000 - 10000 = 70000; measuredInput = 70000 + 15000 + 5000 = 90000
  // cacheHitRatePct = 15000 / 90000 * 100 = 16.67%
  assert.equal(report.summary.totalTokens, 100000);
  assert.equal(report.summary.knownCostUsd, 1.5);
  assert.equal(report.summary.unpricedTokens, 10000);
  assert.equal(report.summary.inputTokens, 70000);
  assert.equal(report.summary.outputTokens, 10000);
  assert.equal(report.summary.cacheReadTokens, 15000);
  assert.equal(report.summary.cacheWriteTokens, 5000);
  assert.equal(report.summary.unclassifiedTokens, 0);
  assert.equal(report.summary.cacheHitRatePct, 16.67);
  assert.equal(report.summary.messageCount, 21);
  assert.equal(report.summary.sessionCount, 3);
  assert.equal(report.summary.projectCount, 2);
  assert.equal(report.summary.activeDays, 1);
  assert.equal(report.summary.activeTimeMs, 180000);
  assert.deepEqual(report.summary.peakDay, { date: '2026-11-16', tokens: 100000, costUsd: 1.5 });
  assert.deepEqual(report.summary.throughput, {
    timedTokens: 40000,
    timedOutputTokens: 8000,
    timedDurationMs: 4000,
    avgOutputTokensPerSec: 2000
  });
  assert.deepEqual(report.summary.comparison, {
    previousPeriodKey: '2026-11-15',
    previousTokens: 25000,
    previousCostUsd: 0.5,
    tokenDelta: 75000,
    tokenDeltaPct: 300,
    costDelta: 1,
    costDeltaPct: 200
  });

  // Projects merged canonically ('Alpha|Repo' < 'alpha|repo' in deterministicProjectLabel)
  assert.equal(report.projects.length, 2);
  assert.equal(report.projects[0].key, 'alpha|repo');
  assert.equal(report.projects[0].label, 'Alpha|Repo');
  assert.equal(report.projects[0].tokens, 80000);
  assert.equal(report.projects[0].tokenSharePct, 80);
  assert.equal(report.projects[0].sessionCount, 2);
  assert.deepEqual(report.projects[0].clients, [
    { client: 'claude', tokens: 60000, sharePct: 75 },
    { client: 'codex', tokens: 20000, sharePct: 25 }
  ]);

  assert.equal(report.models[0].model, 'claude-sonnet-4-5');
  assert.equal(report.models[0].avgOutputTokensPerSec, 2000);

  assert.equal(report.devices[0].deviceId, 'laptop');
  assert.equal(report.devices[0].tokenSharePct, 75);
  assert.equal(report.devices[1].stale, true);

  const signalCodes = new Set(report.signals.map((s) => s.code));
  assert.ok(signalCodes.has('top-project-concentration'));
  assert.ok(signalCodes.has('low-cache-hit-rate'));
  assert.ok(signalCodes.has('period-usage-spike'));
  assert.ok(signalCodes.has('unpriced-tokens-present'));
  assert.ok(signalCodes.has('stale-devices-present'));

  // Markdown + JSON + Signature
  const md = renderReportMarkdown(report);
  assert.match(md, /^---\nschema: "token-monitor-report\/v1"/);
  assert.match(md, /## Executive Summary/);
  assert.match(md, /## Project Usage Analysis/);
  assert.match(md, /## Tools & Models Efficiency/);
  assert.match(md, /## Timeline & Multi-Device Breakdown/);
  assert.match(md, /## Automated Signals/);
  assert.ok(md.includes('Alpha\\|Repo'));

  const jsonText = renderReportJson(report);
  assert.ok(jsonText.endsWith('\n'));
  assert.equal(JSON.parse(jsonText).reportId, 'daily:2026-11-16');

  const sig1 = reportContentSignature(report);
  const laterReport = {
    ...report,
    period: { ...report.period, generatedAt: '2026-11-16T23:59:59.000Z' }
  };
  assert.equal(reportContentSignature(laterReport), sig1);
  const changedReport = {
    ...report,
    summary: { ...report.summary, totalTokens: 100001 }
  };
  assert.notEqual(reportContentSignature(changedReport), sig1);

  // analyzeProjectUsage
  const focused = analyzeProjectUsage(report, { project: 'beta', limit: 5 });
  assert.equal(focused.matchedCount, 1);
  assert.equal(focused.projects[0].key, 'beta');
  assert.equal(focused.projects[0].rank, 2);
  assert.equal(focused.projects[0].dominantClient, 'claude');
  assert.equal(focused.concentration.top1SharePct, 80);
});

test('buildUsageReport handles weekly dailySnapshots, partial + session fallback, and monthly incomplete fallback', () => {
  const history = {
    daily: [
      {
        date: '2026-11-16',
        tokens: 1000,
        cost: 0.1,
        activeTimeMs: 1000,
        messages: 2,
        cacheReadTokens: 400,
        cacheWriteTokens: 0,
        outputTokens: 200,
        unclassifiedTokens: 0,
        tokenComponentsAvailable: true,
        perClient: { claude: { tokens: 1000, cost: 0.1, messages: 2 } },
        perModel: { 'claude-sonnet-4-5': { tokens: 1000, cost: 0.1 } }
      },
      {
        date: '2026-11-17',
        tokens: 2000,
        cost: 0.2,
        activeTimeMs: 2000,
        messages: 3,
        cacheReadTokens: 1000,
        cacheWriteTokens: 0,
        outputTokens: 400,
        unclassifiedTokens: 0,
        tokenComponentsAvailable: true,
        perClient: { codex: { tokens: 2000, cost: 0.2, messages: 3 } },
        perModel: { 'gpt-5': { tokens: 2000, cost: 0.2 } }
      }
    ],
    monthly: [
      {
        month: '2025-01',
        tokens: 50000,
        cost: 2.5,
        activeTimeMs: 90000,
        perClient: { claude: { tokens: 50000, cost: 2.5, messages: 40 } },
        perModel: { 'claude-3-5-sonnet': { tokens: 50000, cost: 2.5 } }
      }
    ],
    summary: { activeDaysComplete: true }
  };

  // 1. Weekly with complete dailySnapshots for all active days
  const fullWeekly = buildUsageReport({
    granularity: 'weekly',
    periodKey: '2026-W47',
    history,
    dailySnapshots: {
      '2026-11-16': {
        projects: {
          'proj-a': { label: 'Proj A', tokens: 1000, costUsd: 0.1, sessionCount: 1, clients: { claude: 1000 } }
        }
      },
      '2026-11-17': {
        projects: {
          'proj-a': { label: 'Proj A', tokens: 2000, costUsd: 0.2, sessionCount: 2, clients: { codex: 2000 } }
        }
      }
    },
    now: '2026-11-18T12:00:00Z',
    timeZone: 'UTC'
  });
  assert.equal(fullWeekly.timeline.length, 7);
  assert.equal(fullWeekly.coverage.projectAttributionSource, 'daily-snapshots');
  assert.equal(fullWeekly.coverage.projectsComplete, true);
  assert.equal(fullWeekly.summary.totalTokens, 3000);
  assert.equal(fullWeekly.summary.activeDays, 2);
  assert.deepEqual(fullWeekly.summary.peakDay, { date: '2026-11-17', tokens: 2000, costUsd: 0.2 });
  assert.equal(fullWeekly.projects[0].tokens, 3000);
  assert.equal(fullWeekly.projects[0].sessionCount, 3);

  // 2. Weekly with partial snapshots + session-window fallback for missing active day
  const partialWeekly = buildUsageReport({
    granularity: 'weekly',
    periodKey: '2026-W47',
    history,
    dailySnapshots: {
      '2026-11-16': {
        projects: {
          'proj-a': { label: 'Proj A', tokens: 1000, costUsd: 0.1, sessionCount: 1, clients: { claude: 1000 } }
        }
      }
    },
    stats: {
      periods: {
        month: {
          sessions: {
            'codex:s2': {
              client: 'codex',
              sessionId: 's2',
              projectLabel: 'Proj B',
              totalTokens: 2000,
              costUsd: 0.2,
              lastUsedAt: '2026-11-17T10:00:00Z',
              models: { 'gpt-5': 2000 }
            }
          }
        }
      }
    },
    now: '2026-11-18T12:00:00Z',
    timeZone: 'UTC'
  });
  assert.equal(partialWeekly.coverage.projectAttributionSource, 'partial');
  assert.equal(partialWeekly.coverage.projectsComplete, false);
  assert.equal(partialWeekly.projects.length, 2);

  // 3. Weekly with session-window fallback only
  const sessionOnlyWeekly = buildUsageReport({
    granularity: 'weekly',
    periodKey: '2026-W47',
    history,
    stats: {
      periods: {
        month: {
          sessions: {
            'codex:s2': {
              client: 'codex',
              sessionId: 's2',
              projectLabel: 'Proj B',
              totalTokens: 2000,
              costUsd: 0.2,
              lastUsedAt: '2026-11-17T10:00:00Z',
              models: { 'gpt-5': 2000 }
            }
          }
        }
      }
    },
    now: '2026-11-18T12:00:00Z',
    timeZone: 'UTC'
  });
  assert.equal(sessionOnlyWeekly.coverage.projectAttributionSource, 'session-window');
  assert.equal(sessionOnlyWeekly.coverage.projectsComplete, false);
  assert.equal(sessionOnlyWeekly.projects[0].key, 'proj b');

  // 4. Monthly fallback to dailySnapshots when live month has periodProjectsOmitted
  const monthlyIncompleteFallback = buildUsageReport({
    granularity: 'monthly',
    periodKey: '2026-11',
    history,
    stats: {
      projectsIncomplete: true,
      periodProjectsOmitted: { month: 3 },
      periods: {
        month: {
          capabilities: { tokenComponents: true, throughput: false },
          totalTokens: 3000,
          costUsd: 0.3,
          cacheReadTokens: 1400,
          cacheWriteTokens: 0,
          outputTokens: 600,
          clients: { claude: 1000, codex: 2000 },
          clientCosts: { claude: 0.1, codex: 0.2 },
          models: { 'claude-sonnet-4-5': 1000, 'gpt-5': 2000 },
          modelCosts: { 'claude-sonnet-4-5': 0.1, 'gpt-5': 0.2 },
          projects: {}
        }
      }
    },
    dailySnapshots: {
      '2026-11-16': { projects: { p1: { label: 'P1', tokens: 1000, costUsd: 0.1 } } },
      '2026-11-17': { projects: { p2: { label: 'P2', tokens: 2000, costUsd: 0.2 } } }
    },
    now: '2026-11-18T12:00:00Z',
    timeZone: 'UTC'
  });
  assert.equal(monthlyIncompleteFallback.coverage.projectAttributionSource, 'daily-snapshots');
  assert.equal(monthlyIncompleteFallback.coverage.projectsComplete, true);
  assert.equal(monthlyIncompleteFallback.projects.length, 2);

  // 5. Historical uncapped month from history.monthly
  const historicalMonth = buildUsageReport({
    granularity: 'monthly',
    periodKey: '2025-01',
    history,
    now: '2026-11-18T12:00:00Z',
    timeZone: 'UTC'
  });
  assert.equal(historicalMonth.summary.totalTokens, 50000);
  assert.equal(historicalMonth.summary.unclassifiedTokens, 50000);
  assert.equal(historicalMonth.coverage.tokenComponentsComplete, false);
  assert.equal(historicalMonth.coverage.projectAttributionSource, 'none');
});

test('createMcpReportServer implements MCP JSON-RPC 2.0 lifecycle, tools, resources, prompts, and errors', async () => {
  assert.deepEqual(MCP_SUPPORTED_VERSIONS, ['2025-06-18', '2025-03-26', '2024-11-05']);

  const sampleReport = buildUsageReport({
    granularity: 'daily',
    periodKey: '2026-11-16',
    stats: {
      periods: {
        today: {
          capabilities: { tokenComponents: true, throughput: true },
          totalTokens: 5000,
          costUsd: 0.25,
          cacheReadTokens: 2000,
          cacheWriteTokens: 0,
          outputTokens: 1000,
          clients: { claude: 5000 },
          clientCosts: { claude: 0.25 },
          models: { 'claude-sonnet-4-5': 5000 },
          modelCosts: { 'claude-sonnet-4-5': 0.25 },
          projects: {
            'token-monitor': { label: 'token-monitor', tokens: 5000, costUsd: 0.25, clients: { claude: 5000 }, models: { 'claude-sonnet-4-5': 5000 } }
          },
          sessions: { 'claude:s1': { client: 'claude', sessionId: 's1', projectLabel: 'token-monitor', messageCount: 5 } }
        }
      }
    },
    now: '2026-11-16T12:00:00Z',
    timeZone: 'UTC'
  });

  const server = createMcpReportServer({
    serverInfo: { name: 'token-monitor-test', version: '0.95.1' },
    listReports: async ({ granularity, limit }) => ({
      reports: [{ reportId: sampleReport.reportId, granularity: granularity || 'daily', limit: limit || 20 }]
    }),
    getReport: async ({ granularity, periodKey }) => {
      if (periodKey === 'missing') return { ok: false, error: 'Report not found' };
      if (granularity === 'weekly' && periodKey === 'throws') throw new Error('Disk read failure');
      return { ok: true, report: sampleReport, markdown: renderReportMarkdown(sampleReport) };
    },
    generateReport: async ({ granularity, force }) => ({
      ok: true,
      generated: [{ reportId: `${granularity || 'daily'}:2026-11-16`, force: Boolean(force) }]
    })
  });

  // initialize negotiates supported version or falls back to latest
  const initKnown = await server.handleMessage({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-03-26' }
  });
  assert.equal(initKnown?.result.protocolVersion, '2025-03-26');
  assert.deepEqual(initKnown?.result.capabilities, { tools: {}, resources: {}, prompts: {} });
  assert.deepEqual(initKnown?.result.serverInfo, { name: 'token-monitor-test', version: '0.95.1' });

  const initFallback = await server.handleMessage({
    jsonrpc: '2.0',
    id: 2,
    method: 'initialize',
    params: { protocolVersion: '1999-01-01' }
  });
  assert.equal(initFallback?.result.protocolVersion, '2025-06-18');

  // notifications/initialized returns null
  const notif = await server.handleMessage({
    jsonrpc: '2.0',
    method: 'notifications/initialized'
  });
  assert.equal(notif, null);

  // ping
  const ping = await server.handleMessage({ jsonrpc: '2.0', id: 3, method: 'ping' });
  assert.deepEqual(ping, { jsonrpc: '2.0', id: 3, result: {} });

  // tools/list & tools/call
  const toolsList = await server.handleMessage({ jsonrpc: '2.0', id: 4, method: 'tools/list' });
  assert.deepEqual(
    toolsList?.result.tools.map((t) => t.name),
    [
      'list_usage_reports',
      'get_usage_report',
      'generate_usage_report',
      'analyze_project_usage',
      'get_realtime_usage_and_limits',
      'analyze_report_with_ai',
      'push_report_to_openclaw',
      'query_usage_breakdown',
      'list_sessions',
      'get_session_detail',
      'get_usage_history',
      'get_devices_and_health',
      'get_limits_history',
      'get_subscriptions_and_forecasts',
      'get_live_token_rate',
      'get_service_status_and_approvals',
      'push_to_openclaw'
    ]
  );

  const listCall = await server.handleMessage({
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: { name: 'list_usage_reports', arguments: { granularity: 'daily', limit: 5 } }
  });
  assert.equal(JSON.parse(listCall?.result.content[0].text).reports[0].limit, 5);

  const getMdCall = await server.handleMessage({
    jsonrpc: '2.0',
    id: 6,
    method: 'tools/call',
    params: { name: 'get_usage_report', arguments: { granularity: 'daily', periodKey: 'latest', format: 'markdown' } }
  });
  assert.match(getMdCall?.result.content[0].text, /## Executive Summary/);

  const genCall = await server.handleMessage({
    jsonrpc: '2.0',
    id: 7,
    method: 'tools/call',
    params: { name: 'generate_usage_report', arguments: { granularity: 'weekly', force: true } }
  });
  assert.equal(JSON.parse(genCall?.result.content[0].text).generated[0].force, true);

  // analyze_project_usage falls back to getReport + analyzeProjectUsage when analyzeProjects callback omitted
  const analyzeCall = await server.handleMessage({
    jsonrpc: '2.0',
    id: 8,
    method: 'tools/call',
    params: { name: 'analyze_project_usage', arguments: { granularity: 'daily', project: 'token-monitor' } }
  });
  const analyzed = JSON.parse(analyzeCall?.result.content[0].text);
  assert.equal(analyzed.matchedCount, 1);
  assert.equal(analyzed.projects[0].key, 'token-monitor');

  // Tool execution failures set isError: true
  const missingCall = await server.handleMessage({
    jsonrpc: '2.0',
    id: 9,
    method: 'tools/call',
    params: { name: 'get_usage_report', arguments: { granularity: 'daily', periodKey: 'missing' } }
  });
  assert.equal(missingCall?.result.isError, true);

  const throwingCall = await server.handleMessage({
    jsonrpc: '2.0',
    id: 10,
    method: 'tools/call',
    params: { name: 'get_usage_report', arguments: { granularity: 'weekly', periodKey: 'throws' } }
  });
  assert.equal(throwingCall?.result.isError, true);
  assert.match(throwingCall?.result.content[0].text, /Disk read failure/);

  // resources
  const resList = await server.handleMessage({ jsonrpc: '2.0', id: 11, method: 'resources/list' });
  assert.deepEqual(
    resList?.result.resources.map((r) => r.uri),
    [
      'report://latest/daily',
      'report://latest/weekly',
      'report://latest/monthly',
      'usage://today',
      'sessions://active',
      'limits://current',
      'devices://health',
      'subscriptions://summary',
      'service-status://current'
    ]
  );

  const tmplList = await server.handleMessage({ jsonrpc: '2.0', id: 12, method: 'resources/templates/list' });
  assert.equal(tmplList?.result.resourceTemplates[0].uriTemplate, 'report://{granularity}/{periodKey}');

  const resRead = await server.handleMessage({
    jsonrpc: '2.0',
    id: 13,
    method: 'resources/read',
    params: { uri: 'report://daily/2026-11-16?format=markdown' }
  });
  assert.equal(resRead?.result.contents[0].mimeType, 'text/markdown');
  assert.match(resRead?.result.contents[0].text, /# Token Monitor Usage Report/);

  // prompts
  const promptsList = await server.handleMessage({ jsonrpc: '2.0', id: 14, method: 'prompts/list' });
  assert.deepEqual(
    promptsList?.result.prompts.map((p) => p.name),
    [
      'analyze-daily-report',
      'analyze-weekly-report',
      'analyze-monthly-report',
      'project-deep-dive',
      'wechat-digest',
      'session-summary',
      'quota-check',
      'daily-standup-usage'
    ]
  );

  const promptDeepDive = await server.handleMessage({
    jsonrpc: '2.0',
    id: 15,
    method: 'prompts/get',
    params: { name: 'project-deep-dive', arguments: { project: 'token-monitor', granularity: 'monthly' } }
  });
  assert.match(promptDeepDive?.result.messages[0].content.text, /token-monitor/);

  // JSON-RPC error codes: -32700, -32600, -32601, -32602
  const parseErr = await server.handlePayload('{bad json');
  assert.equal(parseErr?.error.code, JSON_RPC_ERRORS.PARSE_ERROR);

  const invalidReq = await server.handlePayload([]);
  assert.equal(invalidReq?.error.code, JSON_RPC_ERRORS.INVALID_REQUEST);

  const methodNotFound = await server.handleMessage({ jsonrpc: '2.0', id: 16, method: 'unknown/method' });
  assert.equal(methodNotFound?.error.code, JSON_RPC_ERRORS.METHOD_NOT_FOUND);

  const invalidTool = await server.handleMessage({
    jsonrpc: '2.0',
    id: 17,
    method: 'tools/call',
    params: { name: 'no_such_tool' }
  });
  assert.equal(invalidTool?.error.code, JSON_RPC_ERRORS.INVALID_PARAMS);

  const missingPromptArg = await server.handleMessage({
    jsonrpc: '2.0',
    id: 18,
    method: 'prompts/get',
    params: { name: 'project-deep-dive', arguments: {} }
  });
  assert.equal(missingPromptArg?.error.code, JSON_RPC_ERRORS.INVALID_PARAMS);

  // Batch payload drops notifications and returns responses for requests
  const batch = await server.handlePayload(JSON.stringify([
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 'b1', method: 'ping' }
  ]));
  assert.deepEqual(batch, [{ jsonrpc: '2.0', id: 'b1', result: {} }]);

  // Uint8Array/Buffer payload and -32603 internal error when resources/read throws
  const bufPing = await server.handlePayload(Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 'buf', method: 'ping' })));
  assert.deepEqual(bufPing, { jsonrpc: '2.0', id: 'buf', result: {} });

  const resInternalErr = await server.handleMessage({
    jsonrpc: '2.0',
    id: 19,
    method: 'resources/read',
    params: { uri: 'report://weekly/throws' }
  });
  assert.equal(resInternalErr?.error.code, JSON_RPC_ERRORS.INTERNAL_ERROR);

  // Custom analyzeProjects callback
  const customServer = createMcpReportServer({
    analyzeProjects: async ({ project, limit }) => ({ custom: true, project, limit })
  });
  const customAnalyze = await customServer.handleMessage({
    jsonrpc: '2.0',
    id: 20,
    method: 'tools/call',
    params: { name: 'analyze_project_usage', arguments: { project: 'foo', limit: 3 } }
  });
  assert.deepEqual(JSON.parse(customAnalyze?.result.content[0].text), { custom: true, project: 'foo', limit: 3 });
});

test('buildUsageReport covers historical daily snapshots, live monthly, usage-drop signal, and separate devices array', () => {
  const history = {
    daily: [
      {
        date: '2026-11-14',
        tokens: 10000,
        cost: 0.4,
        activeTimeMs: 5000,
        messages: 5,
        tokenComponentsAvailable: false,
        unclassifiedTokens: 10000,
        perClient: { claude: { tokens: 10000, cost: 0.4, messages: 5 } },
        perModel: { 'claude-sonnet-4-5': { tokens: 10000, cost: 0.4 } }
      },
      {
        date: '2026-11-15',
        tokens: 2000,
        cost: 0.1,
        activeTimeMs: 1000,
        messages: 2,
        tokenComponentsAvailable: false,
        unclassifiedTokens: 2000,
        perClient: { claude: { tokens: 2000, cost: 0.1, messages: 2 } },
        perModel: { 'claude-sonnet-4-5': { tokens: 2000, cost: 0.1 } }
      }
    ],
    monthly: [],
    summary: { activeDaysComplete: true }
  };

  // Historical daily with dailySnapshots and usage-drop signal + incomplete token components (no false low-cache-hit-rate)
  const histDaily = buildUsageReport({
    granularity: 'daily',
    periodKey: '2026-11-15',
    history,
    dailySnapshots: {
      '2026-11-15': {
        projects: {
          docs: { label: 'Docs', tokens: 2000, costUsd: 0.1, sessionCount: 1, clients: { claude: 2000 } }
        }
      }
    },
    devices: [
      {
        deviceId: 'dev-a',
        hostname: 'host-a',
        platform: 'linux',
        history: {
          daily: [{ date: '2026-11-15', tokens: 2000, cost: 0.1 }],
          monthly: []
        }
      }
    ],
    now: '2026-11-16T12:00:00Z',
    timeZone: 'UTC'
  });

  assert.equal(histDaily.coverage.projectAttributionSource, 'daily-snapshots');
  assert.equal(histDaily.coverage.projectsComplete, true);
  assert.equal(histDaily.coverage.tokenComponentsComplete, false);
  assert.equal(histDaily.summary.unclassifiedTokens, 2000);
  assert.equal(histDaily.devices[0].tokens, 2000);
  assert.equal(histDaily.summary.comparison?.tokenDeltaPct, -80);
  const dropCodes = new Set(histDaily.signals.map((s) => s.code));
  assert.ok(dropCodes.has('period-usage-drop'));
  assert.ok(!dropCodes.has('low-cache-hit-rate'));

  // Historical daily with missing snapshot -> attribution 'none'
  const missingSnapDaily = buildUsageReport({
    granularity: 'daily',
    periodKey: '2026-11-14',
    history,
    now: '2026-11-16T12:00:00Z',
    timeZone: 'UTC'
  });
  assert.equal(missingSnapDaily.coverage.projectAttributionSource, 'none');
  assert.equal(missingSnapDaily.coverage.projectsComplete, false);

  // Live current month with complete live projects
  const liveMonthly = buildUsageReport({
    granularity: 'monthly',
    periodKey: '2026-11',
    history,
    stats: {
      projectsIncomplete: false,
      periods: {
        month: {
          capabilities: { tokenComponents: true, throughput: false },
          totalTokens: 12000,
          costUsd: 0.5,
          cacheReadTokens: 6000,
          cacheWriteTokens: 0,
          outputTokens: 2000,
          clients: { claude: 12000 },
          clientCosts: { claude: 0.5 },
          models: { 'claude-sonnet-4-5': 12000 },
          modelCosts: { 'claude-sonnet-4-5': 0.5 },
          projects: {
            core: { label: 'Core', tokens: 12000, costUsd: 0.5, clients: { claude: 12000 }, models: { 'claude-sonnet-4-5': 12000 } }
          },
          sessions: {
            'claude:m1': { client: 'claude', sessionId: 'm1', projectLabel: 'Core', messageCount: 7 }
          }
        }
      }
    },
    now: '2026-11-16T12:00:00Z',
    timeZone: 'UTC'
  });
  assert.equal(liveMonthly.coverage.projectAttributionSource, 'live-period');
  assert.equal(liveMonthly.coverage.projectsComplete, true);
  assert.equal(liveMonthly.projects[0].sessionCount, 1);
  assert.equal(liveMonthly.summary.cacheHitRatePct, 60);
});

test('buildUsageReport and MCP tool schema handle prototype keys safely and document generate_usage_report default', async () => {
  const report = buildUsageReport({
    granularity: 'daily',
    periodKey: '2026-11-16',
    stats: {
      periods: {
        today: {
          capabilities: { tokenComponents: true, throughput: true },
          totalTokens: 1000,
          costUsd: 0.1,
          outputTokens: 200,
          timedTokens: 1000,
          timedOutputTokens: 200,
          timedDurationMs: 1000,
          modelThroughput: {
            constructor: { timedTokens: 500, timedOutputTokens: 100, timedDurationMs: 500 },
            toString: { timedTokens: 500, timedOutputTokens: 100, timedDurationMs: 500 }
          },
          clients: { constructor: 500, toString: 500 },
          clientCosts: { constructor: 0.05, toString: 0.05 },
          clientOutputs: { constructor: 100, toString: 100 },
          models: { constructor: 500, toString: 500 },
          modelCosts: { constructor: 0.05, toString: 0.05 },
          modelOutputs: { constructor: 100, toString: 100 }
        }
      }
    },
    now: '2026-11-16T12:00:00Z',
    timeZone: 'UTC'
  });

  assert.equal(report.clients.length, 2);
  assert.equal(report.models.length, 2);
  assert.equal(report.models[0].avgOutputTokensPerSec, 200);
  assert.equal(report.models[1].avgOutputTokensPerSec, 200);

  const server = createMcpReportServer({});
  const toolsList = await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  const genTool = toolsList?.result.tools.find((t) => t.name === 'generate_usage_report');
  assert.match(genTool.inputSchema.properties.granularity.description, /"all"/);
});
