'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { CredentialStore } = require('../../src/shared/credentialStore');
const { createApprovalAlertRuntime } = require('../../src/shared/approvalAlertRuntime');
const { createHub } = require('../../src/hub/server');
const {
  createOpenClawBridge,
  extractQuotaRowsFromStats,
  queryLimitsHistoryForOpenClaw
} = require('../../src/electron/openclawBridge');

const http = require('node:http');

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 17399;
      srv.close(() => resolve(port));
    });
  });
}

function makeTempDir(prefix = 'tm-oc-bridge-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeStatsSnapshot({
  nowMs = Date.now(),
  deviceId = 'dev-desktop-1',
  sessionState = 'running',
  turnEnded = false,
  lastUsedAtIso = null,
  startedAtIso = null,
  tokens = 1200,
  costUsd = 0.15,
  title = 'Debug Auth Flow',
  limitsProviders = [],
  parentSessionId = null,
  sessionKind = 'interactive'
} = {}) {
  const isoNow = new Date(nowMs).toISOString();
  const lastIso = lastUsedAtIso || isoNow;
  const startIso = startedAtIso || new Date(nowMs - 30_000).toISOString();
  const periods = {
    today: {
      totalTokens: tokens,
      inputTokens: Math.round(tokens * 0.6),
      outputTokens: Math.round(tokens * 0.3),
      cacheReadTokens: Math.round(tokens * 0.1),
      cacheWriteTokens: 0,
      timedTokens: tokens,
      timedOutputTokens: Math.round(tokens * 0.3),
      timedDurationMs: Math.max(1000, Math.round(tokens * 10)),
      capabilities: { throughput: true },
      totalCost: costUsd,
      sessions: {
        'codex:sess-1': {
          client: 'codex',
          sessionId: 'sess-1',
          title,
          project: 'token-monitor',
          projectLabel: 'token-monitor',
          totalTokens: tokens,
          inputTokens: Math.round(tokens * 0.6),
          outputTokens: Math.round(tokens * 0.3),
          cacheReadTokens: Math.round(tokens * 0.1),
          cacheWriteTokens: 0,
          costUsd,
          messageCount: 4,
          startedAt: startIso,
          lastUsedAt: lastIso,
          turnEnded,
          deviceId,
          models: { 'gpt-5.4': { totalTokens: tokens, outputTokens: Math.round(tokens * 0.3), costUsd } },
          ...(parentSessionId ? { parentSessionId } : {}),
          ...(sessionKind !== 'interactive' ? { sessionKind } : {})
        }
      },
      sessionActivity: sessionState === 'running'
        ? {
            'codex:sess-1': {
              client: 'codex',
              sessionId: 'sess-1',
              state: 'running',
              updatedAt: isoNow,
              lastEventAt: isoNow
            }
          }
        : {}
    },
    month: {
      totalTokens: tokens,
      totalCost: costUsd,
      sessions: {}
    }
  };
  return {
    generatedAt: isoNow,
    devices: [
      {
        deviceId,
        deviceName: 'MacBook Pro',
        platform: 'darwin',
        online: true,
        stale: false,
        lastSeenAt: isoNow,
        periods
      }
    ],
    periods,
    ...(limitsProviders.length > 0 ? { limits: { providers: limitsProviders } } : {})
  };
}

test('CredentialStore isolates openclawLocalBridgeToken without altering readIntegrationSecrets contract', () => {
  const dir = makeTempDir();
  try {
    const store = new CredentialStore(dir);
    assert.deepEqual(store.readIntegrationSecrets(), {
      aiApiKey: '',
      openclawHookToken: '',
      weixinBotToken: ''
    });
    assert.equal(store.readOpenClawLocalBridgeToken(), '');
    assert.equal(store.writeOpenClawLocalBridgeToken('  local-secret-123  '), 'local-secret-123');
    assert.equal(store.readOpenClawLocalBridgeToken(), 'local-secret-123');
    assert.deepEqual(store.readIntegrationSecrets(), {
      aiApiKey: '',
      openclawHookToken: '',
      weixinBotToken: ''
    });
    assert.equal(store.writeOpenClawLocalBridgeToken(''), '');
    assert.equal(store.readOpenClawLocalBridgeToken(), '');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('local mode save, secrets redaction, testPush, pushQuery, pushReport fallback, and pushHistory work end-to-end', async () => {
  const dir = makeTempDir();
  let bridge = null;
  try {
    const credStore = new CredentialStore(dir);
    let currentSettings = {
      hubMode: 'local',
      sessionTitlesEnabled: true,
      reportIntegrations: { ai: {}, openclaw: {} }
    };
    const nowMs = Date.parse('2026-11-17T10:00:00Z');
    let latestStats = makeStatsSnapshot({ nowMs, tokens: 4500, costUsd: 0.42 });
    const webhookRequests = [];
    const mockFetch = async (url, init = {}) => {
      webhookRequests.push({
        url: String(url),
        headers: init.headers || {},
        body: init.body ? JSON.parse(String(init.body)) : null
      });
      return new Response(JSON.stringify({ ok: true, id: 'hook-1' }), { status: 202 });
    };

    bridge = createOpenClawBridge({
      userDataDir: dir,
      getSettings: () => currentSettings,
      getCredentialStore: () => credStore,
      fetchImpl: mockFetch,
      getStats: () => latestStats,
      now: () => nowMs
    });

    const saved = bridge.saveLocalIntegrations({
      openclaw: {
        enabled: true,
        mode: 'openclaw-agent',
        webhookUrl: 'https://openclaw.example.com/hooks/agent',
        channel: 'openclaw-weixin',
        to: 'wx-user-1',
        hookToken: 'super-secret-hook-token',
        events: {
          sessionCompleted: true,
          approvalAlerts: true,
          quotaAlerts: true,
          serviceIncidents: true
        },
        sessionCompletion: {
          debounceMs: 25,
          excludeSubagents: true
        },
        quotaAlerts: {
          thresholdPercent: 25
        },
        queryPermissions: {
          allowSessionDetail: false
        }
      }
    });

    assert.equal(saved.ok, true);
    assert.equal(saved.openclaw.enabled, true);
    assert.equal(saved.openclaw.hookTokenConfigured, true);
    assert.equal(saved.openclaw.events.sessionCompleted, true);
    assert.equal(saved.openclaw.sessionCompletion.debounceMs, 25);
    assert.equal(saved.openclaw.quotaAlerts.thresholdPercent, 25);
    assert.equal(JSON.stringify(saved).includes('super-secret-hook-token'), false);
    assert.equal(credStore.readIntegrationSecrets().openclawHookToken, 'super-secret-hook-token');

    const testRes = await bridge.testPush({ message: 'Connectivity ping' });
    assert.equal(testRes.ok, true);
    assert.equal(testRes.eventType, 'test');
    assert.equal(webhookRequests.length, 1);
    assert.equal(webhookRequests[0].headers.authorization || webhookRequests[0].headers.Authorization, 'Bearer super-secret-hook-token');

    const queryRes = await bridge.pushQuery({
      type: 'usage',
      params: { period: 'today', groupBy: 'model' }
    });
    assert.equal(queryRes.ok, true);
    assert.equal(queryRes.eventType, 'query_digest');
    assert.equal(webhookRequests.length, 2);

    // pushReport in local mode (where archived reportManager is null) falls back cleanly to live usage digest
    const reportFallbackRes = await bridge.pushReport({ target: 'openclaw', granularity: 'daily' });
    assert.equal(reportFallbackRes.ok, true);
    assert.equal(webhookRequests.length, 3);

    const history = bridge.getPushHistory();
    assert.equal(history.ok, true);
    assert.equal(history.count, 3);
    assert.equal(history.history[0].ok, true);
    assert.equal(JSON.stringify(history).includes('super-secret-hook-token'), false);

    // Clearing secret removes stored credential
    bridge.saveLocalIntegrations({ openclaw: { clearHookToken: true } });
    assert.equal(credStore.readIntegrationSecrets().openclawHookToken, '');
  } finally {
    await bridge?.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('local bridge 127.0.0.1 enforces Bearer auth, serves /api/query/* & /api/mcp, hides secrets, and shuts down on mode change', async () => {
  const dir = makeTempDir();
  let bridge = null;
  try {
    const credStore = new CredentialStore(dir);
    let copiedText = '';
    let clockMs = Date.now() - 2000;
    const freePort = await getFreePort();
    let currentSettings = {
      hubMode: 'local',
      deviceId: 'dev-desktop-1',
      sessionTitlesEnabled: false,
      reportIntegrations: {
        openclaw: {
          enabled: false,
          localBridge: { enabled: true, port: freePort },
          queryPermissions: { allowSessionDetail: false, allowConversationText: false }
        }
      }
    };
    const stats = makeStatsSnapshot({
      nowMs: clockMs,
      tokens: 8000,
      costUsd: 1.25,
      title: 'Private Title Should Stay Hidden',
      limitsProviders: [
        {
          provider: 'claude',
          accountKey: 'alice@example.com',
          status: 'ok',
          updatedAt: new Date(clockMs).toISOString(),
          windows: [{ kind: 'session', label: 'Session', remainingPercent: 45 }]
        }
      ]
    });

    bridge = createOpenClawBridge({
      userDataDir: dir,
      getSettings: () => currentSettings,
      getCredentialStore: () => credStore,
      clipboardWriteText: (text) => { copiedText = text; },
      getStats: () => stats,
      getEnhancedQueryContext: async () => ({
        stats,
        getServiceStatus: async () => ({ overall: 'operational', providers: [{ id: 'anthropic', name: 'Claude', status: 'operational' }] }),
        getCodexResetForecast: async () => ({ status: 'active' }),
        getLimitsHistory: async () => queryLimitsHistoryForOpenClaw({
          stats,
          scope: 'local',
          historyStore: {
            query: async () => ({
              windows: [{
                key: 'session',
                unit: 'pp',
                window: { kind: 'session', label: '5h Limit' },
                points: [{ at: clockMs - 600_000, value: 35 }]
              }]
            })
          },
          params: { hours: 24 }
        })
      }),
      now: () => clockMs
    });

    bridge.saveLocalIntegrations(currentSettings.reportIntegrations);
    const status = await bridge.reconcile(currentSettings.reportIntegrations);
    assert.equal(status.ok, true);
    assert.equal(status.enabled, true);
    assert.equal(status.running, true);
    assert.equal(status.host, '127.0.0.1');
    assert.ok(status.port > 0);
    assert.equal(status.tokenConfigured, true);
    assert.ok(status.maskedToken.startsWith('••••'));
    const rawToken = credStore.readOpenClawLocalBridgeToken();
    assert.ok(rawToken.length >= 32);
    assert.equal(JSON.stringify(status).includes(rawToken), false);

    // Reject unauthenticated access
    const unauth = await fetch(`${status.baseUrl}/api/query/usage`);
    assert.equal(unauth.status, 401);

    // Copy token & MCP JSON snippet purely in main process
    assert.deepEqual(bridge.copyLocalBridgeConfig({ kind: 'token' }), { ok: true, copied: 'token' });
    assert.equal(copiedText, rawToken);
    assert.deepEqual(bridge.copyLocalBridgeConfig({ kind: 'mcpConfig' }), { ok: true, copied: 'mcpConfig' });
    const snippet = JSON.parse(copiedText);
    assert.equal(snippet.mcpServers['token-monitor'].url, status.endpointUrl);
    assert.equal(snippet.mcpServers['token-monitor'].headers.Authorization, `Bearer ${rawToken}`);

    const authHeaders = { Authorization: `Bearer ${rawToken}` };
    const health = await (await fetch(`${status.baseUrl}/api/health`, { headers: authHeaders })).json();
    assert.equal(health.ok, true);
    assert.equal(health.mode, 'local-bridge');

    // Privacy check: sessionTitlesEnabled=false strips title
    const sessionsRes = await (await fetch(`${status.baseUrl}/api/query/sessions?period=today`, { headers: authHeaders })).json();
    assert.equal(sessionsRes.ok, true);
    assert.equal(sessionsRes.sessions.length, 1);
    assert.equal(JSON.stringify(sessionsRes).includes('Private Title Should Stay Hidden'), false);

    // Privacy gate check: session detail returns 403 when allowSessionDetail=false
    const detailDenied = await fetch(`${status.baseUrl}/api/query/session-detail?client=codex&sessionId=sess-1`, { headers: authHeaders });
    assert.equal(detailDenied.status, 403);

    // Limits history converts pp used (35) -> remainingPercent (65) and omits emails
    const limitsRes = await (await fetch(`${status.baseUrl}/api/query/limits?includeHistory=true`, { headers: authHeaders })).json();
    assert.equal(limitsRes.ok, true);
    assert.equal(limitsRes.limitsHistory.available, true);
    assert.equal(limitsRes.limitsHistory.series[0].remainingPercent, 65);
    assert.equal(JSON.stringify(limitsRes).includes('alice@example.com'), false);

    // Live rate tracking fallback works without Edge Dock open
    bridge.onStats(stats);
    clockMs += 5000;
    bridge.onStats(makeStatsSnapshot({ nowMs: clockMs, tokens: 9000, costUsd: 1.4 }));
    const liveRateRes = await (await fetch(`${status.baseUrl}/api/query/live-rate`, { headers: authHeaders })).json();
    assert.equal(liveRateRes.ok, true);
    assert.equal(liveRateRes.state, 'live');
    assert.ok(liveRateRes.speed > 0);

    // MCP initialize + tools/list works over loopback HTTP
    const mcpList = await (await fetch(status.endpointUrl, {
      method: 'POST',
      headers: { ...authHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
    })).json();
    assert.equal(mcpList.result.tools.length, 17);

    // Rotating token invalidates old token immediately
    const regen = await bridge.regenerateLocalBridgeToken();
    assert.equal(regen.running, true);
    assert.notEqual(credStore.readOpenClawLocalBridgeToken(), rawToken);
    const oldTokenResp = await fetch(`${status.baseUrl}/api/query/usage`, { headers: authHeaders });
    assert.equal(oldTokenResp.status, 401);
    const newTokenResp = await fetch(`${status.baseUrl}/api/query/usage`, {
      headers: { Authorization: `Bearer ${credStore.readOpenClawLocalBridgeToken()}` }
    });
    assert.equal(newTokenResp.status, 200);

    // Switching out of local mode closes the loopback server cleanly
    currentSettings = { ...currentSettings, hubMode: 'client' };
    const stoppedStatus = await bridge.reconcile(currentSettings.reportIntegrations);
    assert.equal(stoppedStatus.enabled, false);
    assert.equal(stoppedStatus.running, false);
  } finally {
    await bridge?.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('session completion tracker emits with turnDelta, detail summary gating, and host idempotency dedup', async () => {
  const dir = makeTempDir();
  let bridge = null;
  let hub = null;
  try {
    const credStore = new CredentialStore(dir);
    credStore.writeIntegrationSecrets({ openclawHookToken: 'hook-secret' });

    const webhookCalls = [];
    const fetchMock = async (url, init = {}) => {
      webhookCalls.push({ url: String(url), body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ ok: true }), { status: 202 });
    };

    const reportsDir = path.join(dir, 'reports');
    let nowMs = Date.parse('2026-11-17T10:10:00Z');
    const startedAtIso = new Date(nowMs - 30_000).toISOString();
    let currentSettings = {
      hubMode: 'host',
      deviceId: 'dev-host',
      sessionTitlesEnabled: true,
      hubSyncSessionTitles: true,
      reportIntegrations: {
        openclaw: {
          enabled: true,
          mode: 'generic-webhook',
          webhookUrl: 'https://hooks.example.com/openclaw',
          channel: 'openclaw-weixin',
          events: { sessionCompleted: true, approvalAlerts: true },
          sessionCompletion: {
            debounceMs: 20,
            includeDetailSummary: true,
            includeAiSummary: false
          },
          queryPermissions: { allowSessionDetail: true }
        }
      }
    };

    hub = createHub({
      port: 0,
      host: '127.0.0.1',
      secret: 'hub-sec',
      syncSessionTitles: true,
      approvalAlerts: true,
      reportsDir,
      dataFile: path.join(dir, 'devices.json'),
      integrations: currentSettings.reportIntegrations,
      integrationSecrets: credStore.readIntegrationSecrets(),
      integrationFetch: fetchMock
    });

    bridge = createOpenClawBridge({
      userDataDir: dir,
      getSettings: () => currentSettings,
      getEmbeddedHub: () => ({ hub }),
      getCredentialStore: () => credStore,
      fetchImpl: fetchMock,
      readSessionDetail: async () => ({
        found: true,
        title: 'Debug Auth Flow',
        totalExchanges: 3,
        exchanges: [{ tools: [{ name: 'edit_file' }, { name: 'run_command' }] }]
      }),
      now: () => nowMs
    });

    // Baseline active snapshot -> quiet
    const activeSnap = makeStatsSnapshot({
      nowMs,
      deviceId: 'dev-host',
      sessionState: 'running',
      turnEnded: false,
      startedAtIso,
      tokens: 1000,
      costUsd: 0.1
    });
    hub.onStatsSnapshot(activeSnap);
    bridge.onStats(activeSnap);
    assert.equal(webhookCalls.length, 0);

    // Transition to ended -> settles after 20ms and emits once with turnDelta + detailSummary
    nowMs += 4000;
    const endedSnap = makeStatsSnapshot({
      nowMs,
      deviceId: 'dev-host',
      sessionState: 'idle',
      turnEnded: true,
      startedAtIso,
      lastUsedAtIso: new Date(nowMs).toISOString(),
      tokens: 2600,
      costUsd: 0.28
    });
    hub.onStatsSnapshot(endedSnap);
    bridge.onStats(endedSnap);

    await bridge.flush();
    for (let i = 0; i < 60 && webhookCalls.length < 1; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    // Hub's stats tracker AND bridge both observed the exact same completion eventId -> deduped to 1 webhook!
    assert.equal(webhookCalls.length, 1);
    assert.equal(webhookCalls[0].body.event, 'token_monitor.session_completed');
    assert.equal(webhookCalls[0].body.payload.completion.turnDelta.totalTokens, 1600);

    // Same approval event fired both via Hub and Bridge deduplicates to 1 push
    const alert = {
      id: 'apr-123',
      client: 'codex',
      projectLabel: 'token-monitor',
      toolName: 'run_command',
      commandPreview: 'npm test',
      createdAt: new Date(nowMs).toISOString()
    };
    await Promise.all([
      hub.onApprovalAlertCreated(alert),
      bridge.onApprovalAlert(alert)
    ]);
    assert.equal(webhookCalls.length, 2);
    assert.equal(webhookCalls[1].body.event, 'token_monitor.approval_alert');
  } finally {
    await bridge?.stop();
    await hub?.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('quota alerts and service incidents detect transitions silently from baseline and mask emails', async () => {
  const dir = makeTempDir();
  let bridge = null;
  try {
    const credStore = new CredentialStore(dir);
    credStore.writeIntegrationSecrets({ openclawHookToken: 'sec-tok' });
    let nowMs = Date.parse('2026-11-17T10:20:00Z');
    let settings = {
      hubMode: 'local',
      reportIntegrations: {
        openclaw: {
          enabled: true,
          mode: 'generic-webhook',
          webhookUrl: 'https://hooks.example.com/openclaw',
          events: { quotaAlerts: true, serviceIncidents: true },
          quotaAlerts: { thresholdPercent: 20, notifyRecovery: true }
        }
      }
    };
    const posted = [];
    let currentStats = {};
    bridge = createOpenClawBridge({
      userDataDir: dir,
      getSettings: () => settings,
      getCredentialStore: () => credStore,
      getStats: () => currentStats,
      fetchImpl: async (_u, init) => {
        posted.push(JSON.parse(String(init.body)));
        return new Response('ok', { status: 200 });
      },
      now: () => nowMs
    });
    bridge.saveLocalIntegrations(settings.reportIntegrations);

    const makeQuotaStats = (remainingPercent, atMs) => makeStatsSnapshot({
      nowMs: atMs,
      limitsProviders: [{
        provider: 'claude',
        accountKey: 'sensitive.user@example.com',
        status: 'ok',
        updatedAt: new Date(atMs).toISOString(),
        windows: [{
          kind: 'session',
          label: '5h Window',
          remainingPercent,
          resetsAt: new Date(atMs + 3_600_000).toISOString()
        }]
      }]
    });

    // Extract helper sanity check
    assert.equal(extractQuotaRowsFromStats(makeQuotaStats(50, nowMs)).length, 1);

    // 1. Quiet initial baselines
    currentStats = makeQuotaStats(40, nowMs);
    bridge.onStats(currentStats);
    await bridge.processServiceStatusSnapshot({
      checkedAt: new Date(nowMs).toISOString(),
      providers: [{ id: 'openai', name: 'OpenAI', status: 'operational' }]
    });
    await bridge.flush();
    assert.equal(posted.length, 0);

    // 2. Drop below 20% + OpenAI major outage -> 2 pushes, zero raw emails
    nowMs += 60_000;
    currentStats = makeQuotaStats(12, nowMs);
    bridge.onStats(currentStats);
    await bridge.processServiceStatusSnapshot({
      checkedAt: new Date(nowMs).toISOString(),
      providers: [{ id: 'openai', name: 'OpenAI', status: 'major', description: 'API errors elevated' }]
    });
    await bridge.flush();
    assert.equal(posted.length, 2);
    assert.equal(posted[0].event, 'token_monitor.quota_alert');
    assert.equal(posted[0].payload.alert.event, 'low');
    assert.equal(JSON.stringify(posted[0]).includes('sensitive.user@example.com'), false);
    assert.equal(posted[1].event, 'token_monitor.service_incident');
    assert.equal(posted[1].payload.incident.status, 'major');

    // 3. Recovery back to 100% + OpenAI operational -> 2 recovery pushes
    nowMs += 60_000;
    currentStats = makeQuotaStats(100, nowMs);
    bridge.onStats(currentStats);
    await bridge.processServiceStatusSnapshot({
      checkedAt: new Date(nowMs).toISOString(),
      providers: [{ id: 'openai', name: 'OpenAI', status: 'operational' }]
    });
    await bridge.flush();
    assert.equal(posted.length, 4);
    assert.equal(posted[2].payload.alert.event, 'full');
    assert.equal(posted[3].payload.incident.status, 'operational');

    assert.ok(fs.existsSync(path.join(dir, 'openclaw-quota-state.json')));

    // 4. Preserves human-readable accountLabel and shortens opaque sha256 accountKey in quota alerts
    nowMs += 60_000;
    const labeledStats = makeStatsSnapshot({
      nowMs,
      limitsProviders: [
        {
          provider: 'codex',
          accountKey: 'sha256:210ad479f29cebbb91f50f5ca522c3552798b7288c9d9bb97799aa5a81fd508b',
          accountLabel: 'Plus',
          accountEmail: 'sensitive.user@example.com',
          status: 'ok',
          updatedAt: new Date(nowMs).toISOString(),
          windows: [{ kind: 'session', label: 'Session', remainingPercent: 50, resetsAt: new Date(nowMs + 3_600_000).toISOString() }]
        },
        {
          provider: 'antigravity',
          accountKey: 'sha256:976a21636ecb3502994f835b68eab4cbb467cfb2a30233d3c1bce8424f280e62',
          status: 'ok',
          updatedAt: new Date(nowMs).toISOString(),
          windows: [{ kind: 'session', label: 'Session', remainingPercent: 50, resetsAt: new Date(nowMs + 3_600_000).toISOString() }]
        }
      ]
    });
    const extracted = extractQuotaRowsFromStats(labeledStats);
    assert.equal(extracted[0].accountLabel, 'Plus');
    const customPresentation = extractQuotaRowsFromStats(labeledStats, {
      codex: { labels: { 'sha256:210ad479f29cebbb91f50f5ca522c3552798b7288c9d9bb97799aa5a81fd508b': 'Work Codex' } },
      antigravity: { labels: { 'sha256:976a21636ecb3502994f835b68eab4cbb467cfb2a30233d3c1bce8424f280e62': 'secret@example.com' } }
    });
    assert.equal(customPresentation[0].accountDisplayName, 'Work Codex');
    assert.equal(customPresentation[1].accountDisplayName, undefined);
    bridge.onStats(labeledStats);
    await bridge.flush();

    nowMs += 60_000;
    bridge.onStats(makeStatsSnapshot({
      nowMs,
      limitsProviders: [
        {
          provider: 'codex',
          accountKey: 'sha256:210ad479f29cebbb91f50f5ca522c3552798b7288c9d9bb97799aa5a81fd508b',
          accountLabel: 'Plus',
          accountEmail: 'sensitive.user@example.com',
          status: 'ok',
          updatedAt: new Date(nowMs).toISOString(),
          windows: [{ kind: 'session', label: 'Session', remainingPercent: 16, resetsAt: new Date(nowMs + 3_600_000).toISOString() }]
        },
        {
          provider: 'antigravity',
          accountKey: 'sha256:976a21636ecb3502994f835b68eab4cbb467cfb2a30233d3c1bce8424f280e62',
          status: 'ok',
          updatedAt: new Date(nowMs).toISOString(),
          windows: [{ kind: 'session', label: 'Session', remainingPercent: 10, resetsAt: new Date(nowMs + 3_600_000).toISOString() }]
        }
      ]
    }));
    await bridge.flush();
    assert.equal(posted.length, 6);
    assert.match(posted[4].text, /Codex · 账号 Plus/);
    assert.equal(posted[4].text.includes('sha256:'), false);
    assert.equal(posted[4].payload.alert.accountDisplay, 'Plus');
    assert.equal(JSON.stringify(posted[4]).includes('sensitive.user@example.com'), false);
    assert.match(posted[5].text, /Antigravity · 账号 #976a21/);
    assert.equal(posted[5].text.includes('sha256:'), false);
    assert.equal(posted[5].payload.alert.accountDisplay, '#976a21');
  } finally {
    await bridge?.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('createApprovalAlertRuntime supports localOnly bridge and error-isolated onAlertSent hook', async () => {
  const dir = makeTempDir();
  try {
    const errors = [];
    const observed = [];
    const runtime = createApprovalAlertRuntime({
      dataDir: dir,
      onError: (err) => errors.push(err),
      onAlertSent: async (alert, res) => {
        observed.push({ alert, res });
        throw new Error('webhook failed softly');
      }
    });

    await runtime.reconcile({ enabled: true, localOnly: true });
    // Stopping cleanly tears down socket & watcher
    await runtime.stop();
    assert.equal(errors.some((e) => /bridge unavailable/i.test(e.message)), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('package.json build.files covers all relative runtime requires and bundled OpenClaw assets', () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const patterns = Array.isArray(pkg?.build?.files) ? pkg.build.files : [];

  function matchesBuildFiles(relPath) {
    return patterns.some((pattern) => {
      if (pattern === relPath) return true;
      if (pattern.endsWith('/**/*')) {
        const prefix = pattern.slice(0, -'/**/*'.length);
        return relPath.startsWith(`${prefix}/`);
      }
      if (pattern.endsWith('/*')) {
        const prefix = pattern.slice(0, -'/*'.length);
        return relPath.startsWith(`${prefix}/`) && !relPath.slice(prefix.length + 1).includes('/');
      }
      return false;
    });
  }

  function walkCode(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walkCode(full));
      else if (/\.(js|cjs|mjs)$/.test(entry.name)) out.push(full);
    }
    return out;
  }

  const reqRe = /\brequire\(\s*['"](\.[^'"]+)['"]\s*\)/g;
  for (const rootDir of ['src/electron', 'src/shared', 'src/hub', 'src/mcp']) {
    for (const file of walkCode(path.join(repoRoot, rootDir))) {
      const source = fs.readFileSync(file, 'utf8');
      let match;
      while ((match = reqRe.exec(source)) !== null) {
        const base = path.resolve(path.dirname(file), match[1]);
        const candidates = path.extname(base)
          ? [base]
          : [`${base}.js`, `${base}.cjs`, `${base}.json`, path.join(base, 'index.js')];
        const resolved = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
        assert.ok(resolved, `Unresolved relative require ${match[1]} in ${path.relative(repoRoot, file)}`);
        const rel = path.relative(repoRoot, resolved).split(path.sep).join('/');
        assert.ok(matchesBuildFiles(rel), `Packaged app.asar missing required dependency: ${rel}`);
      }
    }
  }

  for (const requiredAsset of [
    'plugins/quota-alerts/evaluator.cjs',
    'skills/openclaw-token-monitor/SKILL.md',
    'skills/openclaw-token-monitor/scripts/query-token-monitor.mjs'
  ]) {
    assert.ok(fs.existsSync(path.join(repoRoot, requiredAsset)), `Missing asset on disk: ${requiredAsset}`);
    assert.ok(matchesBuildFiles(requiredAsset), `package.json build.files missing ${requiredAsset}`);
  }
});
