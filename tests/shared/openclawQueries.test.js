'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  BREAKDOWN_PERIODS,
  BREAKDOWN_GROUPS,
  SESSION_PERIODS,
  SESSION_STATES,
  SESSION_SORTS,
  HISTORY_RESOLUTIONS,
  HISTORY_GROUPS,
  queryUsageBreakdown,
  listSessionsQuery,
  queryUsageHistory,
  getDevicesAndHealthQuery,
  getLimitsOverviewQuery,
  getSubscriptionsAndForecastsQuery,
  getLiveTokenRateSummary
} = require('../../src/shared/openclawQueries');

// ---------------------------------------------------------------------------
// 1. queryUsageBreakdown
// ---------------------------------------------------------------------------

test('queryUsageBreakdown computes native today/month/allTime totals and grouped rows with limit', () => {
  const stats = {
    periods: {
      today: {
        capabilities: { tokenComponents: true, throughput: true },
        totalTokens: 100_000,
        costUsd: 1.5,
        unpricedTokens: 10_000,
        cacheReadTokens: 20_000,
        cacheWriteTokens: 5_000,
        outputTokens: 15_000,
        unclassifiedTokens: 0,
        timedTokens: 50_000,
        timedOutputTokens: 10_000,
        timedDurationMs: 5_000,
        modelThroughput: {
          'claude-sonnet-4-5': { timedTokens: 40_000, timedOutputTokens: 8_000, timedDurationMs: 4_000 },
          'gpt-5': { timedTokens: 10_000, timedOutputTokens: 2_000, timedDurationMs: 1_000 }
        },
        clients: { claude: 80_000, codex: 20_000 },
        clientCosts: { claude: 1.2, codex: 0.3 },
        clientUnpricedTokens: { codex: 10_000 },
        clientCacheReads: { claude: 20_000, codex: 0 },
        clientCacheWrites: { claude: 5_000, codex: 0 },
        clientOutputs: { claude: 12_000, codex: 3_000 },
        models: { 'claude-sonnet-4-5': 80_000, 'gpt-5': 20_000 },
        modelCosts: { 'claude-sonnet-4-5': 1.2, 'gpt-5': 0.3 },
        modelUnpricedTokens: { 'gpt-5': 10_000 },
        modelCacheReads: { 'claude-sonnet-4-5': 20_000, 'gpt-5': 0 },
        modelCacheWrites: { 'claude-sonnet-4-5': 5_000, 'gpt-5': 0 },
        modelOutputs: { 'claude-sonnet-4-5': 12_000, 'gpt-5': 3_000 },
        projects: {
          'Alpha Repo': { label: 'Alpha Repo', tokens: 70_000, costUsd: 1.05, clients: { claude: 70_000 }, models: { 'claude-sonnet-4-5': 70_000 } },
          'Beta App': { label: 'Beta App', tokens: 30_000, costUsd: 0.45, clients: { claude: 10_000, codex: 20_000 }, models: { 'claude-sonnet-4-5': 10_000, 'gpt-5': 20_000 } }
        },
        sessions: {
          'claude:s1': { client: 'claude', sessionId: 's1', projectLabel: 'Alpha Repo', messageCount: 10 },
          'codex:s2': { client: 'codex', sessionId: 's2', projectLabel: 'Beta App', messageCount: 4 }
        }
      }
    },
    devices: [
      {
        deviceId: 'mac-1',
        hostname: 'macbook.local',
        osName: 'macOS',
        osVersion: '15.2',
        platform: 'darwin-arm64',
        stale: false,
        periods: {
          today: {
            capabilities: { tokenComponents: true, throughput: true },
            totalTokens: 70_000,
            costUsd: 1.05,
            cacheReadTokens: 15_000,
            cacheWriteTokens: 5_000,
            outputTokens: 10_000,
            timedOutputTokens: 8_000,
            timedDurationMs: 4_000,
            models: { 'claude-sonnet-4-5': 70_000 },
            modelCosts: { 'claude-sonnet-4-5': 1.05 },
            projects: { 'alpha repo': { label: 'Alpha Repo', tokens: 70_000, costUsd: 1.05 } }
          }
        }
      },
      {
        deviceId: 'linux-1',
        hostname: 'devbox',
        platform: 'linux-x64',
        stale: true,
        periods: {
          today: {
            capabilities: { tokenComponents: true, throughput: true },
            totalTokens: 30_000,
            costUsd: 0.45,
            cacheReadTokens: 5_000,
            cacheWriteTokens: 0,
            outputTokens: 5_000,
            timedOutputTokens: 2_000,
            timedDurationMs: 1_000,
            models: { 'claude-sonnet-4-5': 10_000, 'gpt-5': 20_000 },
            modelCosts: { 'claude-sonnet-4-5': 0.15, 'gpt-5': 0.30 }
          }
        }
      }
    ]
  };

  assert.deepEqual(BREAKDOWN_PERIODS, ['today', 'month', 'week', 'last7', 'last30', 'allTime']);
  assert.deepEqual(BREAKDOWN_GROUPS, ['summary', 'model', 'client', 'project', 'device']);

  const summary = queryUsageBreakdown({ stats, period: 'today', groupBy: 'summary', now: '2026-11-17T12:00:00Z' });
  assert.equal(summary.period.id, 'today');
  assert.equal(summary.totals.totalTokens, 100_000);
  assert.equal(summary.totals.knownCostUsd, 1.5);
  assert.equal(summary.totals.unpricedTokens, 10_000);
  assert.equal(summary.totals.inputTokens, 60_000);
  assert.equal(summary.totals.outputTokens, 15_000);
  assert.equal(summary.totals.cacheReadTokens, 20_000);
  assert.equal(summary.totals.cacheWriteTokens, 5_000);
  assert.equal(summary.totals.unclassifiedTokens, 0);
  // cacheHit = 20000 / (60000 + 20000 + 5000) = 23.53%
  assert.equal(summary.totals.cacheHitRatePct, 23.53);
  assert.equal(summary.totals.avgOutputTokensPerSec, 2000);
  assert.deepEqual(summary.rows, []);

  const byModel = queryUsageBreakdown({ stats, period: 'today', groupBy: 'model', limit: 1 });
  assert.equal(byModel.totalRows, 2);
  assert.equal(byModel.truncated, true);
  assert.equal(byModel.rows.length, 1);
  assert.equal(byModel.rows[0].model, 'claude-sonnet-4-5');
  assert.equal(byModel.rows[0].avgOutputTokensPerSec, 2000);

  const byClient = queryUsageBreakdown({ stats, period: 'today', groupBy: 'client' });
  assert.equal(byClient.rows.length, 2);
  assert.equal(byClient.rows[0].client, 'claude');
  assert.equal(byClient.rows[0].messageCount, 10);

  const byProject = queryUsageBreakdown({ stats, period: 'today', groupBy: 'project' });
  assert.equal(byProject.rows[0].key, 'alpha repo');
  assert.equal(byProject.rows[0].sessionCount, 1);

  const byDevice = queryUsageBreakdown({ stats, period: 'today', groupBy: 'device' });
  assert.equal(byDevice.rows.length, 2);
  assert.equal(byDevice.rows[0].deviceId, 'mac-1');
  assert.equal(byDevice.rows[1].stale, true);

  // Device filter
  const singleDev = queryUsageBreakdown({ stats, period: 'today', groupBy: 'model', deviceId: 'mac-1' });
  assert.equal(singleDev.period.deviceFound, true);
  assert.equal(singleDev.totals.totalTokens, 70_000);
  assert.equal(singleDev.rows.length, 1);

  const missingDev = queryUsageBreakdown({ stats, period: 'today', deviceId: 'nonexistent' });
  assert.equal(missingDev.period.deviceFound, false);
  assert.equal(missingDev.period.available, false);
  assert.equal(missingDev.totals.totalTokens, 0);
});

test('queryUsageBreakdown supports modelAliases and modelAliasGrouping with duration-weighted throughput', () => {
  const stats = {
    periods: {
      today: {
        capabilities: { tokenComponents: true, throughput: true },
        totalTokens: 30_000,
        costUsd: 0.9,
        cacheReadTokens: 6_000,
        cacheWriteTokens: 0,
        outputTokens: 6_000,
        timedOutputTokens: 6_000,
        timedDurationMs: 3_000,
        models: {
          'anthropic/claude-opus-4': 10_000,
          'claude-opus-4': 10_000,
          'openai/gpt-5': 10_000
        },
        modelCosts: {
          'anthropic/claude-opus-4': 0.3,
          'claude-opus-4': 0.4,
          'openai/gpt-5': 0.2
        },
        modelOutputs: {
          'anthropic/claude-opus-4': 2_000,
          'claude-opus-4': 2_000,
          'openai/gpt-5': 2_000
        },
        modelCacheReads: {
          'anthropic/claude-opus-4': 3_000,
          'claude-opus-4': 3_000,
          'openai/gpt-5': 0
        },
        modelThroughput: {
          'anthropic/claude-opus-4': { timedTokens: 10_000, timedOutputTokens: 1_000, timedDurationMs: 1_000 },
          'claude-opus-4': { timedTokens: 10_000, timedOutputTokens: 3_000, timedDurationMs: 1_000 },
          'openai/gpt-5': { timedTokens: 10_000, timedOutputTokens: 2_000, timedDurationMs: 1_000 }
        }
      }
    }
  };

  // 'duplicates' collapses anthropic/claude-opus-4 + claude-opus-4, keeps standalone openai/gpt-5
  const dupGrouped = queryUsageBreakdown({
    stats,
    period: 'today',
    groupBy: 'model',
    modelAliasGrouping: 'duplicates'
  });
  assert.equal(dupGrouped.rows.length, 2);
  const opus = dupGrouped.rows.find((r) => r.model === 'claude-opus-4');
  assert.ok(opus);
  assert.equal(opus.totalTokens, 20_000);
  assert.equal(opus.knownCostUsd, 0.7);
  // (1000 + 3000) * 1000 / (1000 + 1000) = 2000 tok/s
  assert.equal(opus.avgOutputTokensPerSec, 2000);
  assert.ok(dupGrouped.rows.some((r) => r.model === 'openai/gpt-5'));

  // 'prefix' also strips openai/ from standalone openai/gpt-5 + explicit alias
  const prefixGrouped = queryUsageBreakdown({
    stats,
    period: 'today',
    groupBy: 'model',
    modelAliases: { 'openai/gpt-5': 'gpt-5-canonical' },
    modelAliasGrouping: 'prefix'
  });
  assert.ok(prefixGrouped.rows.some((r) => r.model === 'gpt-5-canonical'));
  assert.ok(prefixGrouped.rows.some((r) => r.model === 'claude-opus-4'));

  // Folding aliased models in a history.daily row inherits row.tokenComponentsAvailable === true
  const historyDayAlias = queryUsageBreakdown({
    stats: {},
    history: {
      daily: [
        {
          date: '2026-11-16',
          tokens: 1_500,
          cost: 0.15,
          tokenComponentsAvailable: true,
          inputTokens: 900,
          outputTokens: 600,
          perModel: {
            'claude-sonnet-4-5-20250929': { tokens: 1_000, cost: 0.1, inputTokens: 600, outputTokens: 400 },
            'claude-sonnet-4-5': { tokens: 500, cost: 0.05, inputTokens: 300, outputTokens: 200 }
          }
        }
      ]
    },
    period: 'week',
    groupBy: 'model',
    modelAliases: {
      'claude-sonnet-4-5-20250929': 'sonnet-4.5-folded',
      'claude-sonnet-4-5': 'sonnet-4.5-folded'
    },
    now: '2026-11-17T12:00:00Z'
  });
  assert.equal(historyDayAlias.rows.length, 1);
  assert.equal(historyDayAlias.rows[0].model, 'sonnet-4.5-folded');
  assert.equal(historyDayAlias.rows[0].totalTokens, 1_500);
  assert.equal(historyDayAlias.rows[0].unclassifiedTokens, 0);

  // Prototype-key safety inside projectPeriodAliases (projects + sessions)
  const protoAliasStats = {
    periods: {
      today: {
        models: { 'alias-a': 100 },
        projects: Object.assign(JSON.parse('{"__proto__":{"models":{"alias-a":10}}}'), {
          constructor: { models: { 'alias-a': 20 } },
          projA: { models: { 'alias-a': 100 } }
        }),
        sessions: Object.assign(JSON.parse('{"__proto__":{"latestModel":"alias-a"}}'), {
          prototype: { latestModel: 'alias-a', models: { 'alias-a': 50 } },
          'claude:s1': { latestModel: 'alias-a', models: { 'alias-a': 100 } }
        })
      }
    }
  };
  const safeAliasResult = queryUsageBreakdown({
    stats: protoAliasStats,
    period: 'today',
    groupBy: 'model',
    modelAliases: { 'alias-a': 'canonical-a' }
  });
  assert.equal(safeAliasResult.rows[0].model, 'canonical-a');
  assert.equal(/** @type {any} */ ({}).models, undefined);
});

test('queryUsageBreakdown combines history + live today for week, last7, and last30', () => {
  // Now = Tuesday 2026-11-17 UTC -> ISO week 2026-W47 (2026-11-16..2026-11-22)
  const now = '2026-11-17T12:00:00Z';
  const history = {
    daily: [
      {
        date: '2026-10-15', // outside last30
        tokens: 99_000,
        cost: 9.9,
        tokenComponentsAvailable: true,
        perClient: { codex: { tokens: 99_000, cost: 9.9, outputTokens: 9_000, unclassifiedTokens: 0 } },
        perModel: { 'gpt-5': { tokens: 99_000, cost: 9.9, outputTokens: 9_000, unclassifiedTokens: 0 } }
      },
      {
        date: '2026-11-01', // inside last30, outside last7 & week
        tokens: 5_000,
        cost: 0.25,
        tokenComponentsAvailable: true,
        perClient: { codex: { tokens: 5_000, cost: 0.25, outputTokens: 500, unclassifiedTokens: 0 } },
        perModel: { 'gpt-5': { tokens: 5_000, cost: 0.25, outputTokens: 500, unclassifiedTokens: 0 } }
      },
      {
        date: '2026-11-12', // inside last7 & last30, outside week
        tokens: 10_000,
        cost: 0.5,
        tokenComponentsAvailable: true,
        perClient: { claude: { tokens: 10_000, cost: 0.5, cacheReadTokens: 2_000, outputTokens: 1_000, unclassifiedTokens: 0 } },
        perModel: { 'claude-sonnet-4-5': { tokens: 10_000, cost: 0.5, cacheReadTokens: 2_000, outputTokens: 1_000, unclassifiedTokens: 0 } }
      },
      {
        date: '2026-11-16', // Monday of current ISO week
        tokens: 20_000,
        cost: 1.0,
        tokenComponentsAvailable: true,
        perClient: { claude: { tokens: 20_000, cost: 1.0, cacheReadTokens: 4_000, outputTokens: 2_000, unclassifiedTokens: 0 } },
        perModel: { 'claude-sonnet-4-5': { tokens: 20_000, cost: 1.0, cacheReadTokens: 4_000, outputTokens: 2_000, unclassifiedTokens: 0 } }
      },
      {
        date: '2026-11-17', // stale history row for today, should be superseded by higher live today
        tokens: 2_000,
        cost: 0.1,
        tokenComponentsAvailable: true,
        perClient: { claude: { tokens: 2_000, cost: 0.1 } },
        perModel: { 'claude-sonnet-4-5': { tokens: 2_000, cost: 0.1 } }
      }
    ],
    summary: { activeDaysComplete: true }
  };

  const stats = {
    periods: {
      today: {
        capabilities: { tokenComponents: true, throughput: true },
        totalTokens: 15_000,
        costUsd: 0.75,
        cacheReadTokens: 3_000,
        cacheWriteTokens: 0,
        outputTokens: 1_500,
        timedOutputTokens: 1_500,
        timedDurationMs: 1_500,
        clients: { claude: 15_000 },
        clientCosts: { claude: 0.75 },
        clientCacheReads: { claude: 3_000 },
        clientOutputs: { claude: 1_500 },
        models: { 'claude-sonnet-4-5': 15_000 },
        modelCosts: { 'claude-sonnet-4-5': 0.75 },
        modelCacheReads: { 'claude-sonnet-4-5': 3_000 },
        modelOutputs: { 'claude-sonnet-4-5': 1_500 },
        modelThroughput: {
          'claude-sonnet-4-5': { timedTokens: 15_000, timedOutputTokens: 1_500, timedDurationMs: 1_500 }
        },
        projects: {
          'token-monitor': { label: 'token-monitor', tokens: 15_000, costUsd: 0.75, clients: { claude: 15_000 } }
        },
        sessions: {
          'claude:live-1': {
            client: 'claude',
            sessionId: 'live-1',
            projectLabel: 'token-monitor',
            lastUsedAt: '2026-11-17T11:30:00Z',
            totalTokens: 15_000,
            costUsd: 0.75
          }
        }
      }
    },
    devices: [
      {
        deviceId: 'dev-a',
        hostname: 'host-a',
        platform: 'linux',
        stale: false,
        periodWindows: { today: { key: '2026-11-17', endsAt: '2026-11-18T00:00:00Z' } },
        periods: {
          today: { totalTokens: 15_000, costUsd: 0.75 }
        },
        history: {
          daily: [
            { date: '2026-11-12', tokens: 10_000, cost: 0.5 },
            { date: '2026-11-16', tokens: 20_000, cost: 1.0 }
          ]
        }
      }
    ]
  };

  const weekRes = queryUsageBreakdown({ stats, history, period: 'week', groupBy: 'model', now, timeZone: 'UTC' });
  assert.equal(weekRes.period.id, 'week');
  assert.equal(weekRes.period.key, '2026-W47');
  assert.equal(weekRes.totals.totalTokens, 35_000); // 20000 + 15000
  assert.equal(weekRes.totals.knownCostUsd, 1.75);
  assert.equal(weekRes.totals.activeDays, 2);
  assert.equal(weekRes.rows[0].model, 'claude-sonnet-4-5');
  assert.equal(weekRes.rows[0].avgOutputTokensPerSec, 1000);

  const last7Res = queryUsageBreakdown({ stats, history, range: 'last7', groupBy: 'client', now, timeZone: 'UTC' });
  assert.equal(last7Res.period.id, 'last7');
  assert.equal(last7Res.period.startDate, '2026-11-11');
  assert.equal(last7Res.period.endDate, '2026-11-17');
  assert.equal(last7Res.totals.totalTokens, 45_000); // 10000 + 20000 + 15000
  assert.equal(last7Res.totals.activeDays, 3);
  assert.equal(last7Res.rows[0].client, 'claude');
  assert.equal(last7Res.rows[0].totalTokens, 45_000);

  const last30Res = queryUsageBreakdown({ stats, history, range: 'last30', groupBy: 'device', now, timeZone: 'UTC' });
  assert.equal(last30Res.period.startDate, '2026-10-19');
  assert.equal(last30Res.totals.totalTokens, 50_000); // 5000 + 10000 + 20000 + 15000 (excludes 2026-10-15)
  assert.equal(last30Res.rows[0].deviceId, 'dev-a');
  assert.equal(last30Res.rows[0].totalTokens, 45_000);

  assert.throws(() => queryUsageBreakdown({ stats, period: 'quarter' }), /Invalid period/);
  assert.throws(() => queryUsageBreakdown({ stats, groupBy: 'region' }), /Invalid groupBy/);
});

// ---------------------------------------------------------------------------
// 2. listSessionsQuery
// ---------------------------------------------------------------------------

test('listSessionsQuery supports state, filters, sorting, pagination, live projections, and privacy stripping', () => {
  const now = Date.parse('2026-11-17T12:00:00Z');
  const stats = {
    periods: {
      today: {
        sessionActivity: {
          'claude:run-overlay': { state: 'waiting', observedAt: '2026-11-17T11:59:50Z' }
        },
        sessions: {
          'claude:run-overlay': {
            client: 'claude',
            sessionId: 'run-overlay',
            title: 'Secret Architecture Plan',
            sessionTitle: 'Secret Architecture Plan',
            preview: 'Do not leak this preview text',
            firstUserMessage: 'Confidential user prompt',
            projectLabel: 'Token Monitor',
            projectId: '/Users/alice/secret/token-monitor',
            lastUsedAt: '2026-11-17T11:59:40Z',
            startedAt: '2026-11-17T11:00:00Z',
            totalTokens: 5_000,
            costUsd: 0.12,
            inputTokens: 1_000,
            outputTokens: 500,
            cacheReadTokens: 3_000,
            cacheWriteTokens: 500,
            messageCount: 8,
            latestModel: 'claude-sonnet-4-5',
            reasoningEffort: 'high',
            contextTokens: 50_000,
            contextWindow: 200_000,
            promptCache: { observedAt: '2026-11-17T11:58:00Z', ttlSeconds: 300 },
            models: { 'claude-sonnet-4-5': 5_000 }
          },
          'codex:sub-1': {
            client: 'codex',
            sessionId: 'sub-1',
            title: 'Subagent Task',
            projectLabel: 'Token Monitor',
            lastUsedAt: '2026-11-17T11:55:00Z',
            totalTokens: 12_000,
            costUsd: 0.45,
            turnEnded: true,
            latestModel: 'gpt-5',
            reasoningEffort: 'medium',
            parentSessionId: 'parent-1',
            sessionKind: 'background-review',
            models: { 'gpt-5': 12_000 }
          },
          'claude:archived-1': {
            client: 'claude',
            sessionId: 'archived-1',
            title: 'Deleted Session',
            projectLabel: 'Other Repo',
            lastUsedAt: '2026-11-17T11:59:55Z',
            archived: true,
            totalTokens: 9_000,
            costUsd: 0.25,
            models: { 'claude-haiku-4': 9_000 }
          },
          'reasonix:synth': {
            client: 'reasonix',
            sessionId: 'synth',
            usageSource: 'reasonix-stats',
            totalTokens: 999_999
          }
        }
      },
      allTime: {
        sessions: {
          'claude:run-overlay': {
            client: 'claude',
            sessionId: 'run-overlay',
            title: 'Secret Architecture Plan',
            lastUsedAt: '2026-11-17T11:59:40Z',
            totalTokens: 5_000,
            costUsd: 0.12
          }
        }
      }
    }
  };

  assert.deepEqual(SESSION_PERIODS, ['today', 'month', 'allTime']);
  assert.deepEqual(SESSION_STATES, ['all', 'running', 'waiting', 'ended', 'idle']);
  assert.deepEqual(SESSION_SORTS, ['lastUsedAt', 'totalTokens', 'costUsd']);

  // State filtering + projections
  const waitingRes = listSessionsQuery({ stats, period: 'today', state: 'waiting', now });
  assert.equal(waitingRes.total, 1);
  const row = waitingRes.sessions[0];
  assert.equal(row.activityState, 'waiting');
  assert.equal(row.title, 'Secret Architecture Plan');
  assert.equal(row.latestModel, 'claude-sonnet-4-5');
  assert.equal(row.reasoningEffort, 'high');
  assert.deepEqual(row.context, {
    contextTokens: 50_000,
    contextWindow: 200_000,
    percentLeft: 75,
    percentUsed: 25,
    tone: ''
  });
  assert.deepEqual(row.promptCache, {
    expiresAt: Date.parse('2026-11-17T12:03:00Z'),
    ttlSeconds: 300,
    minutes: 3
  });
  // Never leaks raw local path projectId
  assert.equal(row.projectId, undefined);
  assert.equal(row.preview, undefined);
  assert.equal(row.firstUserMessage, undefined);

  const endedRes = listSessionsQuery({ stats, period: 'today', state: 'ended', now });
  assert.equal(endedRes.total, 1);
  assert.equal(endedRes.sessions[0].parentSessionId, 'parent-1');
  assert.equal(endedRes.sessions[0].sessionKind, 'background-review');

  // Archived session resolves to idle despite recent timestamp
  const idleRes = listSessionsQuery({ stats, period: 'today', state: 'idle', now });
  assert.equal(idleRes.total, 1);
  assert.equal(idleRes.sessions[0].sessionId, 'archived-1');
  assert.equal(idleRes.sessions[0].archived, true);

  // Privacy gating: sessionTitlesEnabled === false strips all titles & excludes from search
  const privateRes = listSessionsQuery({
    stats,
    period: 'today',
    sessionTitlesEnabled: false,
    now
  });
  assert.equal(privateRes.total, 3); // Reasonix synthetic excluded
  for (const s of privateRes.sessions) {
    assert.equal(s.title, null);
    assert.equal('sessionTitle' in s, false);
    assert.equal('preview' in s, false);
    assert.equal('firstUserMessage' in s, false);
    assert.equal('name' in s, false);
  }
  const searchPrivateTitle = listSessionsQuery({
    stats,
    period: 'today',
    search: 'Architecture',
    sessionTitlesEnabled: false,
    now
  });
  assert.equal(searchPrivateTitle.total, 0);

  // Sorting + pagination
  const page1 = listSessionsQuery({ stats, period: 'today', sort: 'totalTokens', limit: 2, now });
  assert.equal(page1.total, 3);
  assert.equal(page1.hasMore, true);
  assert.ok(page1.nextCursor);
  assert.deepEqual(page1.sessions.map((s) => s.sessionId), ['sub-1', 'archived-1']);

  const page2 = listSessionsQuery({ stats, period: 'today', sort: 'totalTokens', limit: 2, cursor: page1.nextCursor, now });
  assert.equal(page2.hasMore, false);
  assert.equal(page2.nextCursor, null);
  assert.deepEqual(page2.sessions.map((s) => s.sessionId), ['run-overlay']);

  // allTimeSessions overlay
  const allTimeRes = listSessionsQuery({
    stats,
    period: 'allTime',
    allTimeSessions: {
      'hermes:old-1': {
        client: 'hermes',
        sessionId: 'old-1',
        lastUsedAt: '2026-09-01T10:00:00Z',
        totalTokens: 42_000,
        costUsd: 1.1
      }
    },
    now
  });
  assert.equal(allTimeRes.total, 2);
  assert.ok(allTimeRes.sessions.some((s) => s.sessionId === 'old-1'));

  // Device-scoped allTimeSessions ignores prototype-polluting keys
  const protoDeviceRes = listSessionsQuery({
    stats: { devices: [{ deviceId: 'dev-1', periods: { allTime: { sessions: {} } } }] },
    deviceId: 'dev-1',
    period: 'allTime',
    allTimeSessions: Object.assign(JSON.parse('{"__proto__":{"client":"codex","sessionId":"evil","sourceDevice":"dev-1","totalTokens":99}}'), {
      constructor: { client: 'codex', sessionId: 'ctor', sourceDevice: 'dev-1', totalTokens: 88 },
      'codex:safe': { client: 'codex', sessionId: 'safe', sourceDevice: 'dev-1', lastUsedAt: '2026-11-17T11:00:00Z', totalTokens: 10 }
    }),
    now
  });
  assert.deepEqual(protoDeviceRes.sessions.map((s) => s.sessionId), ['safe']);

  assert.throws(() => listSessionsQuery({ stats, cursor: 'not-valid-base64!!!' }), /Invalid pagination cursor/);
});

// ---------------------------------------------------------------------------
// 3. queryUsageHistory
// ---------------------------------------------------------------------------

test('queryUsageHistory handles daily, monthly, summary, date bounds, streaks, peakDay, and groupBy', () => {
  const history = {
    daily: [
      {
        date: '2026-10-31',
        tokens: 4_000,
        cost: 0.2,
        messages: 5,
        activeTimeMs: 60_000,
        tokenComponentsAvailable: true,
        outputTokens: 400,
        perClient: { codex: { tokens: 4_000, cost: 0.2, messages: 5 } },
        perModel: { 'gpt-5': { tokens: 4_000, cost: 0.2 } }
      },
      {
        date: '2026-11-15',
        tokens: 8_000,
        cost: 0.4,
        messages: 8,
        activeTimeMs: 120_000,
        tokenComponentsAvailable: true,
        outputTokens: 800,
        perClient: { claude: { tokens: 8_000, cost: 0.4, messages: 8 } },
        perModel: { 'claude-sonnet-4-5': { tokens: 8_000, cost: 0.4 } }
      },
      {
        date: '2026-11-16',
        tokens: 16_000,
        cost: 0.8,
        messages: 12,
        activeTimeMs: 180_000,
        tokenComponentsAvailable: true,
        outputTokens: 1_600,
        perClient: { claude: { tokens: 12_000, cost: 0.6, messages: 9 }, codex: { tokens: 4_000, cost: 0.2, messages: 3 } },
        perModel: { 'claude-sonnet-4-5': { tokens: 12_000, cost: 0.6 }, 'gpt-5': { tokens: 4_000, cost: 0.2 } }
      },
      {
        date: '2026-11-17',
        tokens: 6_000,
        cost: 0.3,
        messages: 4,
        activeTimeMs: 90_000,
        tokenComponentsAvailable: true,
        outputTokens: 600,
        perClient: { claude: { tokens: 6_000, cost: 0.3, messages: 4 } },
        perModel: { 'claude-sonnet-4-5': { tokens: 6_000, cost: 0.3 } }
      }
    ],
    monthly: [
      {
        month: '2026-10',
        tokens: 4_000,
        cost: 0.2,
        activeTimeMs: 60_000,
        perClient: { codex: { tokens: 4_000, cost: 0.2, messages: 5 } },
        perModel: { 'gpt-5': { tokens: 4_000, cost: 0.2 } }
      },
      {
        month: '2026-11',
        tokens: 30_000,
        cost: 1.5,
        activeTimeMs: 390_000,
        perClient: { claude: { tokens: 26_000, cost: 1.3, messages: 21 }, codex: { tokens: 4_000, cost: 0.2, messages: 3 } },
        perModel: { 'claude-sonnet-4-5': { tokens: 26_000, cost: 1.3 }, 'gpt-5': { tokens: 4_000, cost: 0.2 } }
      }
    ],
    summary: {
      totalTokens: 34_000,
      totalCost: 1.7,
      activeDays: 4,
      currentStreak: 3,
      longestStreak: 3,
      peakDayTokens: 16_000,
      favoriteModel: 'claude-sonnet-4-5',
      messages: 29,
      activeTimeMs: 450_000
    }
  };

  assert.deepEqual(HISTORY_RESOLUTIONS, ['daily', 'monthly', 'summary']);
  assert.deepEqual(HISTORY_GROUPS, ['none', 'client', 'model']);

  const novDaily = queryUsageHistory({
    history,
    resolution: 'daily',
    from: '2026-11-01',
    to: '2026-11-17',
    groupBy: 'client',
    limit: 2
  });
  assert.equal(novDaily.activeDays, 3);
  assert.deepEqual(novDaily.streaks, { currentStreak: 3, longestStreak: 3 });
  assert.deepEqual(novDaily.peakDay, { date: '2026-11-16', totalTokens: 16_000, knownCostUsd: 0.8 });
  assert.equal(novDaily.totals.totalTokens, 30_000);
  assert.equal(novDaily.totalRows, 3);
  assert.equal(novDaily.truncated, true);
  assert.deepEqual(novDaily.rows.map((r) => r.date), ['2026-11-16', '2026-11-17']);
  assert.ok(novDaily.rows[0].perClient);
  assert.equal(novDaily.rows[0].perModel, undefined);
  assert.equal(novDaily.breakdown[0].client, 'claude');
  assert.equal(novDaily.breakdown[0].totalTokens, 26_000);

  const monthly = queryUsageHistory({ history, resolution: 'monthly', groupBy: 'model' });
  assert.equal(monthly.rows.length, 2);
  assert.equal(monthly.breakdown[0].model, 'claude-sonnet-4-5');
  assert.equal(monthly.breakdown[0].totalTokens, 26_000);

  const summary = queryUsageHistory({ history, resolution: 'summary', groupBy: 'client' });
  assert.equal(summary.totals.totalTokens, 34_000);
  assert.equal(summary.activeDays, 4);
  assert.deepEqual(summary.streaks, { currentStreak: 3, longestStreak: 3 });
  assert.equal(summary.peakDay.date, '2026-11-16');
  assert.equal(summary.breakdown[0].client, 'claude');
  assert.equal(summary.totalRows, 2);
  assert.equal(summary.truncated, false);

  const limitedSummary = queryUsageHistory({ history, resolution: 'summary', groupBy: 'model', limit: 1 });
  assert.equal(limitedSummary.totalRows, 2);
  assert.equal(limitedSummary.truncated, true);
  assert.equal(limitedSummary.rows.length, 1);
  assert.equal(limitedSummary.breakdown.length, 1);
  assert.equal(limitedSummary.rows[0].model, 'claude-sonnet-4-5');

  assert.throws(() => queryUsageHistory({ history, from: '2026-11-20', to: '2026-11-10' }), /from.*after to/);
});

// ---------------------------------------------------------------------------
// 4. getDevicesAndHealthQuery
// ---------------------------------------------------------------------------

test('getDevicesAndHealthQuery returns sanitized device health with no paths or stderr', () => {
  const stats = {
    devices: [
      {
        deviceId: 'laptop-1',
        hostname: 'macbook-pro',
        osName: 'macOS',
        osVersion: '15.2',
        platform: 'darwin-arm64',
        stale: false,
        updatedAt: '2026-11-17T11:55:00Z',
        receivedAt: '2026-11-17T11:55:02Z',
        syncUploadIntervalMs: 600_000,
        trackedClients: ['claude', 'antigravity-cli'],
        clientStatus: { claude: 'active', antigravity: 'waiting', bogus: 'broken' },
        clientHealth: {
          version: 1,
          observedAt: '2026-11-17T11:55:00Z',
          clients: {
            antigravity: {
              source: {
                state: 'detected',
                detectedCount: 1,
                checkedCount: 2,
                checks: [
                  { id: 'antigravity-ide-source', exists: true, path: '/Users/alice/.antigravity' },
                  { id: 'antigravity-cli-data', exists: false }
                ]
              },
              collection: {
                state: 'failed',
                syncFailureStage: 'timeout',
                syncDetailCode: 'network-timeout',
                stderr: 'FATAL: /Users/alice/secret/key failed'
              },
              data: { liveTokens: 0 },
              diagnostics: [{ code: 'sync-timeout', message: 'secret path /Users/alice' }],
              overall: 'healthy' // poisoned claim: must be recomputed to 'attention'
            }
          }
        },
        wslStatus: { state: 'active', detected: ['claude', 'codex'], withData: ['claude'], distroPath: '\\\\wsl$\\Ubuntu' }
      }
    ]
  };

  const full = getDevicesAndHealthQuery({ stats });
  assert.equal(full.deviceCount, 1);
  assert.equal(full.activeDeviceCount, 1);
  assert.equal(full.staleDeviceCount, 0);
  const d = full.devices[0];
  assert.deepEqual(d.trackedClients, ['claude', 'antigravity']);
  assert.deepEqual(d.clientStatus, { claude: 'active', antigravity: 'waiting' });
  assert.equal(d.clientHealth.clients.antigravity.overall, 'attention');
  assert.deepEqual(d.clientHealthSummary, {
    healthy: 0, waiting: 0, attention: 1, unavailable: 0, unknown: 0
  });
  const json = JSON.stringify(full);
  assert.equal(json.includes('/Users/alice'), false);
  assert.equal(json.includes('stderr'), false);
  assert.equal(json.includes('distroPath'), false);

  const compact = getDevicesAndHealthQuery({ stats, includeDiagnostics: false });
  assert.equal(compact.devices[0].clientHealth.clients.antigravity.diagnostics, undefined);
  assert.equal(compact.devices[0].clientHealth.clients.antigravity.source.checks, undefined);
  assert.equal(compact.devices[0].clientHealth.clients.antigravity.overall, 'attention');

  const missing = getDevicesAndHealthQuery({ stats, deviceId: 'missing' });
  assert.equal(missing.deviceFound, false);
  assert.equal(missing.deviceCount, 0);

  // Prototype-key safety in clientHealth.clients (including trim-surviving '__proto__' / 'constructor')
  const protoHealthRes = getDevicesAndHealthQuery({
    stats: {
      devices: [
        {
          deviceId: 'dev-proto',
          clientHealth: {
            version: 1,
            clients: Object.assign(JSON.parse('{"__proto__":{"overall":"healthy","data":{"liveTokens":5}}}'), {
              constructor: { overall: 'healthy', data: { liveTokens: 5 } },
              claude: { source: { state: 'detected', detectedCount: 1, checkedCount: 1 }, collection: { state: 'ok' }, data: { liveTokens: 10 }, overall: 'healthy' }
            })
          }
        }
      ]
    },
    includeDiagnostics: false
  });
  assert.deepEqual(Object.keys(protoHealthRes.devices[0].clientHealth.clients), ['claude']);
  assert.equal(/** @type {any} */ ({}).overall, undefined);
});

// ---------------------------------------------------------------------------
// 5. getLimitsOverviewQuery
// ---------------------------------------------------------------------------

test('getLimitsOverviewQuery enriches reset countdowns and credits while never leaking emails or secrets', () => {
  const now = '2026-11-17T12:00:00Z';
  const stats = {
    limits: {
      updatedAt: '2026-11-17T11:59:00Z',
      providers: [
        {
          provider: 'claude',
          accountKey: 'sha256:secret-account-hash',
          accountEmail: 'alice@example.com',
          accountLabel: 'alice@example.com', // raw unnormalized email in label must be scrubbed!
          planLabel: 'Max',
          status: 'ok',
          stale: false,
          updatedAt: '2026-11-17T11:59:00Z',
          windows: [
            {
              kind: 'session',
              usedPercent: 40,
              resetsAt: '2026-11-17T14:00:00Z',
              windowMinutes: 300,
              boundaryKind: 'reset'
            }
          ]
        },
        {
          provider: 'thirdparty',
          adapterId: 'new-api',
          accountKey: 'sha256:tp-hash',
          accountEmail: 'bob@corp.example',
          accountName: 'sk-ant-api03-verysecretkey123456',
          planLabel: 'NewAPI Pool',
          status: 'ok',
          stale: false,
          balance: { amount: 24.5, currency: 'USD', todaySpend: 1.2, monthSpend: 25.5 },
          windows: [
            {
              kind: 'billing',
              metric: 'credits',
              label: 'Balance',
              remaining: 24.5,
              currency: 'USD'
            }
          ]
        },
        {
          provider: 'codex',
          accountKey: 'sha256:codex-hash',
          accountEmail: 'codex@example.com',
          status: 'rateLimited',
          stale: true,
          windows: [
            { kind: 'session', usedPercent: 100, resetsAt: '2026-11-17T11:00:00Z' }
          ]
        }
      ]
    }
  };

  const overview = getLimitsOverviewQuery({ stats, now });
  assert.equal(overview.totalAccounts, 3);
  assert.equal(overview.healthyAccounts, 2);
  assert.equal(overview.staleAccounts, 1);
  assert.equal(overview.thirdPartyCount, 1);
  assert.equal(overview.tightestUsedPct, 100);

  const claude = overview.providers.find((p) => p.provider === 'claude');
  assert.equal(claude.providerLabel, 'Claude Code');
  assert.equal(claude.label, 'Max');
  assert.equal(claude.windows[0].label, 'Session');
  assert.equal(claude.windows[0].resetsInMs, 2 * 60 * 60 * 1000);

  const tp = overview.providers.find((p) => p.provider === 'thirdparty');
  assert.equal(tp.isThirdParty, true);
  assert.equal(tp.isBalanceOnly, true);
  assert.equal(tp.balance.formattedAmount, '$24.50');
  assert.equal(tp.windows[0].isCredits, true);
  assert.equal(tp.windows[0].formattedRemaining, '$24.50');
  // 24.5 / (24.5 + 25.5) = 49%
  assert.equal(tp.windows[0].meterPercent, 49);

  // Expired reset clamps resetsInMs to 0
  const codexOnly = getLimitsOverviewQuery({ stats, provider: 'codex', maxProviders: 1, now });
  assert.equal(codexOnly.totalAccounts, 1);
  assert.equal(codexOnly.providers[0].windows[0].resetsInMs, 0);

  const thirdPartyOnly = getLimitsOverviewQuery({ stats, thirdPartyOnly: true, now });
  assert.equal(thirdPartyOnly.totalAccounts, 1);
  assert.equal(thirdPartyOnly.providers[0].provider, 'thirdparty');

  const staleFilter = getLimitsOverviewQuery({ stats, status: 'stale', now });
  assert.equal(staleFilter.totalAccounts, 1);
  assert.equal(staleFilter.providers[0].provider, 'codex');

  // Privacy: never leak emails, accountKey hashes, or credentials
  const serialized = JSON.stringify(overview);
  assert.equal(serialized.includes('alice@example.com'), false);
  assert.equal(serialized.includes('bob@corp.example'), false);
  assert.equal(serialized.includes('codex@example.com'), false);
  assert.equal(serialized.includes('secret-account-hash'), false);
  assert.equal(serialized.includes('sk-ant-api03'), false);
});

// ---------------------------------------------------------------------------
// 6. getSubscriptionsAndForecastsQuery
// ---------------------------------------------------------------------------

test('getSubscriptionsAndForecastsQuery computes monthly totals, renewals, and top-up exhaustion forecasts', () => {
  const subscriptionsDoc = {
    version: 1,
    updatedAt: '2026-11-17T10:00:00Z',
    subscriptions: [
      {
        id: 'sub-claude',
        provider: 'claude',
        kind: 'subscription',
        planName: 'Claude Max',
        amountMinor: 10_000, // $100/mo
        currency: 'USD',
        interval: 'month',
        intervalCount: 1,
        startDate: '2026-10-20',
        autoRenew: true,
        binding: { profileName: 'work', accountEmail: 'private@example.com', accountKey: 'sha256:secret' }
      },
      {
        id: 'sub-expired',
        provider: 'cursor',
        kind: 'subscription',
        planName: 'Cursor Old',
        amountMinor: 2_000,
        currency: 'USD',
        interval: 'month',
        intervalCount: 1,
        startDate: '2026-09-01',
        endDate: '2026-10-01',
        autoRenew: false
      },
      {
        id: 'topup-deepseek',
        provider: 'deepseek',
        kind: 'topup',
        planName: 'DeepSeek Credits',
        currency: 'CNY',
        topUps: [
          { id: 't1', date: '2026-11-07', amountMinor: 10_000 } // 100 CNY
        ],
        binding: { accountKey: 'sha256:ds-1' }
      },
      {
        id: 'topup-openrouter-stale',
        provider: 'openrouter',
        kind: 'topup',
        currency: 'USD',
        topUps: [{ id: 't2', date: '2026-11-01', amountMinor: 5_000 }],
        binding: { accountKey: 'sha256:or-1' }
      }
    ]
  };

  const stats = {
    limits: {
      providers: [
        {
          provider: 'deepseek',
          accountKey: 'sha256:ds-1',
          status: 'ok',
          stale: false,
          balance: { amount: 60, currency: 'CNY' },
          windows: [{ kind: 'billing', metric: 'credits', remaining: 60, currency: 'CNY' }]
        },
        {
          provider: 'openrouter',
          accountKey: 'sha256:or-1',
          status: 'ok',
          stale: true,
          balance: { amount: 20, currency: 'USD' },
          windows: [{ kind: 'billing', metric: 'credits', remaining: 20, currency: 'USD' }]
        }
      ]
    }
  };

  const result = getSubscriptionsAndForecastsQuery({
    subscriptionsDoc,
    stats,
    rates: { CNY: 7 },
    date: '2026-11-17'
  });

  assert.equal(result.asOfDate, '2026-11-17');
  assert.equal(result.totalCount, 4);
  assert.equal(result.activeCount, 3);
  // Active: $100 (claude) + 100 CNY / 7 (deepseek top-up in Nov) + $50 (openrouter top-up in Nov)
  assert.equal(result.monthlyTotalUsd, Number((100 + 100 / 7 + 50).toFixed(6)));

  const claude = result.subscriptions.find((s) => s.id === 'sub-claude');
  assert.equal(claude.active, true);
  assert.equal(claude.monthlyAmountUsd, 100);
  assert.equal(claude.nextRenewalDate, '2026-11-20');
  assert.equal(claude.daysUntilRenewal, 3);
  assert.equal(claude.forecast.status, 'notApplicable');

  const expired = result.subscriptions.find((s) => s.id === 'sub-expired');
  assert.equal(expired.active, false);

  const deepseek = result.subscriptions.find((s) => s.id === 'topup-deepseek');
  // Elapsed = 10 days (Nov 7 -> Nov 17), poured = 100, remaining = 60 -> spent = 40 -> burn = 4/day -> 15 days -> 2026-12-02
  assert.equal(deepseek.forecast.status, 'available');
  assert.equal(deepseek.forecast.dailyBurn, 4);
  assert.equal(deepseek.forecast.daysRemaining, 15);
  assert.equal(deepseek.forecast.exhaustDate, '2026-12-02');
  assert.equal(deepseek.forecast.formattedBalance, '¥60.00');

  const orStale = result.subscriptions.find((s) => s.id === 'topup-openrouter-stale');
  assert.equal(orStale.forecast.status, 'stale');

  // Privacy: never leak accountEmail or accountKey
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('private@example.com'), false);
  assert.equal(serialized.includes('sha256:ds-1'), false);

  const noForecasts = getSubscriptionsAndForecastsQuery({
    subscriptionsDoc,
    stats,
    date: '2026-11-17',
    includeForecasts: false,
    activeOnly: true
  });
  assert.equal(noForecasts.subscriptions.length, 3);
  assert.equal(noForecasts.subscriptions[0].forecast, null);
});

// ---------------------------------------------------------------------------
// 7. getLiveTokenRateSummary
// ---------------------------------------------------------------------------

test('getLiveTokenRateSummary uses liveRateSnapshot and falls back safely to period counters', () => {
  const stats = {
    periods: {
      today: {
        capabilities: { throughput: true },
        outputTokens: 6_000,
        timedTokens: 40_000,
        timedOutputTokens: 4_000,
        timedDurationMs: 2_000
      }
    },
    devices: [
      {
        deviceId: 'dev-1',
        stale: false,
        periods: {
          today: {
            capabilities: { throughput: true },
            outputTokens: 6_000,
            timedTokens: 40_000,
            timedOutputTokens: 4_000,
            timedDurationMs: 2_000
          }
        }
      },
      {
        deviceId: 'dev-unsupported',
        stale: false,
        periods: {
          today: {
            capabilities: { throughput: false },
            totalTokens: 1_000
          }
        }
      }
    ]
  };

  // With liveRateSnapshot (plugin liveRate.js shape)
  const live = getLiveTokenRateSummary({
    stats,
    liveRateSnapshot: {
      state: 'live',
      speed: 142.5,
      burn: 12_400,
      sampledAt: 1_700_000_000_000,
      expiresAt: 1_700_000_008_000,
      deviceCount: 1
    },
    now: 1_700_000_002_000
  });
  assert.deepEqual(live, {
    deviceId: null,
    state: 'live',
    reason: null,
    speed: 142.5,
    burn: 12_400,
    sampledAt: 1_700_000_000_000,
    expiresAt: 1_700_000_008_000,
    deviceCount: 1,
    fallbackAvgOutputTokensPerSec: 2000
  });

  // Expired snapshot falls back gracefully while retaining fallbackAvgOutputTokensPerSec
  const expired = getLiveTokenRateSummary({
    stats,
    liveRateSnapshot: {
      speed: 88,
      burn: 4_000,
      idle: false,
      sampledAt: 1_700_000_000_000,
      expiresAt: 1_700_000_008_000,
      deviceCount: 1
    },
    now: 1_700_000_010_000
  });
  assert.equal(expired.state, 'unavailable');
  assert.equal(expired.reason, 'expired');
  assert.equal(expired.speed, null);
  assert.equal(expired.fallbackAvgOutputTokensPerSec, 2000);

  // Without snapshot -> waitingForSample + safe fallback throughput
  const waiting = getLiveTokenRateSummary({ stats, deviceId: 'dev-1' });
  assert.equal(waiting.state, 'unavailable');
  assert.equal(waiting.reason, 'waitingForSample');
  assert.equal(waiting.fallbackAvgOutputTokensPerSec, 2000);

  // Device with capabilities.throughput === false -> unsupportedTiming + null fallback
  const unsupported = getLiveTokenRateSummary({ stats, deviceId: 'dev-unsupported' });
  assert.equal(unsupported.state, 'unavailable');
  assert.equal(unsupported.reason, 'unsupportedTiming');
  assert.equal(unsupported.fallbackAvgOutputTokensPerSec, null);

  // Expired snapshot falls back gracefully when now is omitted (checked against Date.now())
  const expiredNoNow = getLiveTokenRateSummary({
    stats,
    liveRateSnapshot: {
      state: 'live',
      speed: 88,
      burn: 4_000,
      sampledAt: 1_700_000_000_000,
      expiresAt: 1_700_000_008_000,
      deviceCount: 1
    }
  });
  assert.equal(expiredNoNow.state, 'unavailable');
  assert.equal(expiredNoNow.reason, 'expired');
  assert.equal(expiredNoNow.fallbackAvgOutputTokensPerSec, 2000);

  // Active future snapshot stays live even when now is omitted
  const futureNoNow = getLiveTokenRateSummary({
    stats,
    liveRateSnapshot: {
      state: 'live',
      speed: 95,
      burn: 5_000,
      sampledAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      deviceCount: 1
    }
  });
  assert.equal(futureNoNow.state, 'live');
  assert.equal(futureNoNow.speed, 95);

  // Missing device -> missingData
  const missing = getLiveTokenRateSummary({ stats, deviceId: 'nope' });
  assert.equal(missing.state, 'unavailable');
  assert.equal(missing.reason, 'missingData');
  assert.equal(missing.fallbackAvgOutputTokensPerSec, null);
});
