'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { isAuthorized, sendJson } = require('../../src/shared/http');
const { createHub, createOpenClawEndpointSurface } = require('../../src/hub/server');
const { detectOpenClawEnvironment, installOpenClawSkill } = require('../../src/hub/openclawProvisioner');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function localDayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function makeRichDevice(deviceId, dayKey, { nowIso, endsAtIso, startedAtIso, turnEnded = true, liveState = 'idle', tokens = 80_000 } = {}) {
  const updatedIso = nowIso || new Date().toISOString();
  const expiresIso = endsAtIso || new Date(Date.now() + 3_600_000).toISOString();
  const startedIso = startedAtIso || new Date(Date.now() - 20_000).toISOString();
  return {
    deviceId,
    hostname: `${deviceId}.local`,
    osName: 'macOS',
    osVersion: '15.2',
    platform: 'darwin',
    updatedAt: updatedIso,
    clientStatus: { codex: 'active', claude: 'active' },
    clientHealth: {
      version: 1,
      clients: {
        codex: {
          source: { state: 'detected', detectedCount: 1, checkedCount: 1 },
          collection: { state: 'ok', lastAttemptAt: updatedIso, lastSuccessAt: updatedIso },
          data: { liveTokens: tokens },
          overall: 'healthy'
        }
      }
    },
    wslStatus: { state: 'not-installed', detected: [], withData: [] },
    periodWindows: {
      today: { key: dayKey, start: `${dayKey}T00:00:00.000Z`, endsAt: expiresIso },
      month: { key: dayKey.slice(0, 7), start: `${dayKey.slice(0, 7)}-01T00:00:00.000Z` }
    },
    periods: {
      today: {
        totalTokens: tokens,
        costUsd: Number((tokens * 0.00001).toFixed(4)),
        inputTokens: Math.round(tokens * 0.5),
        outputTokens: Math.round(tokens * 0.25),
        cacheReadTokens: Math.round(tokens * 0.25),
        cacheWriteTokens: 0,
        timedTokens: tokens,
        timedOutputTokens: Math.round(tokens * 0.25),
        timedDurationMs: 1000,
        capabilities: { tokenComponents: true, throughput: true },
        clients: { codex: tokens },
        clientCosts: { codex: Number((tokens * 0.00001).toFixed(4)) },
        models: { 'gpt-5': tokens },
        modelCosts: { 'gpt-5': Number((tokens * 0.00001).toFixed(4)) },
        projects: {
          'token-monitor': {
            label: 'token-monitor',
            tokens,
            costUsd: Number((tokens * 0.00001).toFixed(4)),
            clients: { codex: tokens },
            models: { 'gpt-5': tokens }
          }
        },
        sessions: {
          'codex:sess-main': {
            client: 'codex',
            sessionId: 'sess-main',
            title: 'Confidential Prompt Title',
            projectLabel: 'token-monitor',
            latestModel: 'gpt-5',
            totalTokens: tokens,
            inputTokens: Math.round(tokens * 0.5),
            outputTokens: Math.round(tokens * 0.25),
            cacheReadTokens: Math.round(tokens * 0.25),
            cacheWriteTokens: 0,
            costUsd: Number((tokens * 0.00001).toFixed(4)),
            messageCount: turnEnded ? 4 : 2,
            startedAt: startedIso,
            lastUsedAt: updatedIso,
            turnEnded,
            liveActivity: { state: liveState, observedAt: updatedIso }
          }
        }
      },
      month: {
        totalTokens: tokens,
        costUsd: Number((tokens * 0.00001).toFixed(4)),
        clients: { codex: tokens },
        models: { 'gpt-5': tokens },
        projects: {
          'token-monitor': {
            label: 'token-monitor',
            tokens,
            costUsd: Number((tokens * 0.00001).toFixed(4)),
            clients: { codex: tokens },
            models: { 'gpt-5': tokens }
          }
        }
      }
    },
    history: {
      daily: [
        {
          date: dayKey,
          tokens,
          cost: Number((tokens * 0.00001).toFixed(4)),
          messages: 4,
          activeTimeMs: 1000,
          tokenComponentsAvailable: true,
          cacheReadTokens: Math.round(tokens * 0.25),
          cacheWriteTokens: 0,
          outputTokens: Math.round(tokens * 0.25),
          unclassifiedTokens: 0,
          perClient: { codex: { tokens, cost: Number((tokens * 0.00001).toFixed(4)), messages: 4 } },
          perModel: { 'gpt-5': { tokens, cost: Number((tokens * 0.00001).toFixed(4)) } }
        }
      ],
      monthly: []
    },
    limits: {
      providers: [
        {
          provider: 'thirdparty',
          adapterId: 'newapi',
          accountLabel: 'Team NewAPI',
          accountEmail: 'secret-owner@example.com',
          status: 'ok',
          stale: false,
          balance: { amount: 55.25, currency: 'USD', limit: 100 },
          windows: [{ label: 'Quota', metric: 'credits', usedPercent: 44.75, remainingPercent: 55.25 }]
        }
      ]
    }
  };
}

test('Hub /api/query/*, privacy gates, OpenClaw push/history, approval alerts, and session completion routes', async (t) => {
  const dir = makeTempDir('tm-openclaw-routes-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const dayKey = localDayKey();
  const webhookCalls = [];
  let desktopDetailReader = null;
  let enhancedLimitsHistory = null;
  let enhancedServiceStatus = null;
  let enhancedForecast = null;
  let contextTitlesEnabled = false;

  const hub = createHub({
    port: 0,
    host: '127.0.0.1',
    secret: 'route-secret',
    syncSessionTitles: true,
    approvalAlerts: true,
    dataFile: path.join(dir, 'devices.json'),
    reportsDir: path.join(dir, 'reports'),
    integrationFetch: async (url, init) => {
      webhookCalls.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
    getEnhancedQueryContext: () => ({
      sessionTitlesEnabled: contextTitlesEnabled,
      liveRateSnapshot: {
        state: 'live',
        sampledAt: Date.now(),
        expiresAt: Date.now() + 30_000,
        speed: 88.5,
        burn: 120,
        deviceCount: 1
      },
      ...(desktopDetailReader ? { readSessionDetail: desktopDetailReader } : {}),
      ...(enhancedLimitsHistory ? { getLimitsHistory: enhancedLimitsHistory } : {}),
      ...(enhancedServiceStatus ? { getServiceStatus: enhancedServiceStatus } : {}),
      ...(enhancedForecast ? { getCodexResetForecast: enhancedForecast } : {})
    }),
    logger: { error() {}, warn() {}, log() {} }
  });

  await hub.start();
  t.after(() => hub.stop());

  const baseUrl = `http://127.0.0.1:${hub.server.address().port}`;
  const auth = { authorization: 'Bearer route-secret' };

  // 1. Auth required across all new endpoints
  for (const [method, endpoint] of [
    ['GET', '/api/query/usage'],
    ['GET', '/api/query/sessions'],
    ['GET', '/api/query/session-detail?client=codex&sessionId=sess-main'],
    ['GET', '/api/query/history'],
    ['GET', '/api/query/devices'],
    ['GET', '/api/query/limits'],
    ['GET', '/api/query/subscriptions'],
    ['GET', '/api/query/live-rate'],
    ['GET', '/api/query/service-status'],
    ['GET', '/api/integrations/openclaw/history'],
    ['POST', '/api/integrations/openclaw/push']
  ]) {
    const res = await fetch(`${baseUrl}${endpoint}`, { method });
    assert.equal(res.status, 401, `${method} ${endpoint} must require auth`);
  }

  // 2. Enable OpenClaw with sessionCompleted + approvalAlerts + zero debounce for deterministic testing
  await fetch(`${baseUrl}/api/reports/integrations`, {
    method: 'PUT',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({
      openclaw: {
        enabled: true,
        mode: 'generic-webhook',
        webhookUrl: 'https://oc.mock.local/events',
        hookToken: 'oc-route-tok',
        events: {
          rollover: false,
          sessionCompleted: true,
          approvalAlerts: true
        },
        sessionCompletion: { debounceMs: 0 },
        queryPermissions: { allowSessionDetail: false, allowConversationText: false }
      }
    })
  });

  // 3. Ingest active snapshot (baseline) then ended snapshot -> triggers session_completed event
  const sessionStartedIso = new Date(Date.now() - 30_000).toISOString();
  const activeIngest = await fetch(`${baseUrl}/api/ingest`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify(makeRichDevice('mac-1', dayKey, {
      nowIso: new Date(Date.now() - 4000).toISOString(),
      startedAtIso: sessionStartedIso,
      turnEnded: false,
      liveState: 'running',
      tokens: 60_000
    }))
  });
  assert.equal(activeIngest.status, 200);

  const endedIngest = await fetch(`${baseUrl}/api/ingest`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify(makeRichDevice('mac-1', dayKey, {
      nowIso: new Date().toISOString(),
      startedAtIso: sessionStartedIso,
      turnEnded: true,
      liveState: 'idle',
      tokens: 80_000
    }))
  });
  assert.equal(endedIngest.status, 200);

  // 4. POST /api/approval-alerts triggers onApprovalAlertCreated
  const alertRes = await fetch(`${baseUrl}/api/approval-alerts`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({
      deviceId: 'mac-1',
      client: 'codex',
      sessionId: 'sess-main',
      tool: 'run_command',
      command: 'git status',
      projectLabel: 'token-monitor'
    })
  });
  assert.equal(alertRes.status, 200);
  for (
    let i = 0;
    i < 80
    && (!webhookCalls.some((c) => c.body.event === 'token_monitor.session_completed')
      || !webhookCalls.some((c) => c.body.event === 'token_monitor.approval_alert'));
    i += 1
  ) {
    await new Promise((r) => setTimeout(r, 25));
  }

  assert.ok(webhookCalls.some((c) => c.body.event === 'token_monitor.session_completed'));
  assert.ok(webhookCalls.some((c) => c.body.event === 'token_monitor.approval_alert'));
  const completionCall = webhookCalls.find((c) => c.body.event === 'token_monitor.session_completed');
  assert.equal(completionCall.body.payload.completion.title, null);
  assert.equal(completionCall.body.payload.completion.turnDelta.totalTokens, 20_000);

  // 5. Query endpoints
  const usageRes = await (await fetch(`${baseUrl}/api/query/usage?period=today&groupBy=model`, { headers: auth })).json();
  assert.equal(usageRes.ok, true);
  assert.equal(usageRes.totals.totalTokens, 80_000);
  assert.equal(usageRes.rows[0].model, 'gpt-5');

  const badUsage = await fetch(`${baseUrl}/api/query/usage?limit=nope`, { headers: auth });
  assert.equal(badUsage.status, 400);

  const sessionsRes = await (await fetch(`${baseUrl}/api/query/sessions?period=today&state=all`, { headers: auth })).json();
  assert.equal(sessionsRes.ok, true);
  assert.equal(sessionsRes.sessions.length, 1);
  assert.equal(sessionsRes.sessions[0].title, null);

  const histRes = await (await fetch(`${baseUrl}/api/query/history?resolution=daily&groupBy=client`, { headers: auth })).json();
  assert.equal(histRes.ok, true);
  assert.equal(histRes.totals.totalTokens, 80_000);

  const devRes = await (await fetch(`${baseUrl}/api/query/devices`, { headers: auth })).json();
  assert.equal(devRes.ok, true);
  assert.equal(devRes.deviceCount, 1);
  assert.equal(devRes.devices[0].clientHealth.clients.codex.overall, 'healthy');

  const limRes = await (await fetch(`${baseUrl}/api/query/limits?includeHistory=true`, { headers: auth })).json();
  assert.equal(limRes.ok, true);
  assert.equal(limRes.thirdPartyCount, 1);
  assert.equal(JSON.stringify(limRes).includes('secret-owner@example.com'), false);
  assert.equal(limRes.limitsHistory.available, false);

  await fetch(`${baseUrl}/api/subscriptions`, {
    method: 'PUT',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({
      subscriptions: [{
        id: 'sub-1',
        provider: 'codex',
        kind: 'subscription',
        planName: 'ChatGPT Plus',
        amountMinor: 2000,
        currency: 'USD',
        interval: 'monthly',
        startDate: '2026-01-01',
        autoRenew: true
      }]
    })
  });
  const subRes = await (await fetch(`${baseUrl}/api/query/subscriptions`, { headers: auth })).json();
  assert.equal(subRes.ok, true);
  assert.equal(subRes.activeCount, 1);
  assert.equal(subRes.monthlyTotalUsd, 20);

  const rateRes = await (await fetch(`${baseUrl}/api/query/live-rate`, { headers: auth })).json();
  assert.equal(rateRes.ok, true);
  assert.equal(rateRes.state, 'live');
  assert.equal(rateRes.speed, 88.5);
  assert.equal(rateRes.burn, 120);

  const svcUnavailable = await (await fetch(`${baseUrl}/api/query/service-status`, { headers: auth })).json();
  assert.equal(svcUnavailable.ok, true);
  assert.equal(svcUnavailable.serviceStatus.available, false);
  assert.equal(svcUnavailable.codexResetForecast.available, false);
  assert.equal(svcUnavailable.approvalAlerts.available, true);
  assert.equal(svcUnavailable.approvalAlerts.alerts.length, 1);

  // Inject desktop hooks dynamically
  enhancedLimitsHistory = async () => ({
    accountEmail: 'leak@example.com',
    series: [{ ts: new Date().toISOString(), remainingPercent: 60 }]
  });
  enhancedServiceStatus = async () => ({ overall: 'operational', providers: [{ id: 'openai', status: 'operational' }] });
  enhancedForecast = async () => ({ status: 'active', scheduledResetType: 'weekly' });

  const limWithHist = await (await fetch(`${baseUrl}/api/query/limits?includeHistory=true`, { headers: auth })).json();
  assert.equal(limWithHist.limitsHistory.available, true);
  assert.equal(JSON.stringify(limWithHist).includes('leak@example.com'), false);

  const svcAvailable = await (await fetch(`${baseUrl}/api/query/service-status`, { headers: auth })).json();
  assert.equal(svcAvailable.serviceStatus.available, true);
  assert.equal(svcAvailable.serviceStatus.overall, 'operational');
  assert.equal(svcAvailable.codexResetForecast.available, true);

  // 6. Session detail privacy gates + 501 / 404 / 200
  const detailBlocked = await fetch(`${baseUrl}/api/query/session-detail?client=codex&sessionId=sess-main`, { headers: auth });
  assert.equal(detailBlocked.status, 403);
  assert.equal((await detailBlocked.json()).error, 'session_detail_disabled');

  // Remote HTTP PUT /api/reports/integrations cannot mutate queryPermissions (V-10)
  await fetch(`${baseUrl}/api/reports/integrations`, {
    method: 'PUT',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ openclaw: { queryPermissions: { allowSessionDetail: true, allowConversationText: true } } })
  });
  const stillBlocked = await fetch(`${baseUrl}/api/query/session-detail?client=codex&sessionId=sess-main`, { headers: auth });
  assert.equal(stillBlocked.status, 403);
  assert.equal((await stillBlocked.json()).error, 'session_detail_disabled');

  // Trusted host-side call updates queryPermissions explicitly
  hub.updateIntegrationsConfig(
    { openclaw: { queryPermissions: { allowSessionDetail: true, allowConversationText: false } } },
    { allowQueryPermissionMutation: true }
  );

  const convBlocked = await fetch(`${baseUrl}/api/query/session-detail?client=codex&sessionId=sess-main&includeConversation=true`, { headers: auth });
  assert.equal(convBlocked.status, 403);
  assert.equal((await convBlocked.json()).error, 'conversation_text_disabled');

  const detailNoReader = await fetch(`${baseUrl}/api/query/session-detail?client=codex&sessionId=sess-main`, { headers: auth });
  assert.equal(detailNoReader.status, 501);
  assert.equal((await detailNoReader.json()).error, 'session_detail_unavailable');

  desktopDetailReader = async ({ sessionId }) => {
    if (sessionId === 'missing') return { found: false };
    return {
      found: true,
      client: 'codex',
      sessionId,
      title: 'Private Detail Title',
      exchanges: [{ promptPreview: 'Step 1', tools: ['read_file'], turnCount: 1 }],
      conversation: { messages: [{ role: 'user', text: 'full chat text' }] }
    };
  };

  const detailNotFound = await fetch(`${baseUrl}/api/query/session-detail?client=codex&sessionId=missing`, { headers: auth });
  assert.equal(detailNotFound.status, 404);

  const detailOk = await (await fetch(`${baseUrl}/api/query/session-detail?client=codex&sessionId=sess-main`, { headers: auth })).json();
  assert.equal(detailOk.ok, true);
  assert.equal(detailOk.title, undefined);
  assert.equal(detailOk.conversation, undefined);
  assert.equal(detailOk.exchanges.length, 1);

  hub.updateIntegrationsConfig(
    { openclaw: { queryPermissions: { allowConversationText: true } } },
    { allowQueryPermissionMutation: true }
  );
  contextTitlesEnabled = true;
  const detailWithConv = await (await fetch(`${baseUrl}/api/query/session-detail?client=codex&sessionId=sess-main&includeConversation=true`, { headers: auth })).json();
  assert.equal(detailWithConv.title, 'Private Detail Title');
  assert.equal(detailWithConv.conversation.messages[0].text, 'full chat text');

  // 7. POST /api/integrations/openclaw/push & GET /api/integrations/openclaw/history
  const testPushRes = await fetch(`${baseUrl}/api/integrations/openclaw/push`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ test: true, message: 'Hello WeChat!' })
  });
  assert.equal(testPushRes.status, 200);
  const testPushData = await testPushRes.json();
  assert.equal(testPushData.ok, true);
  assert.equal(testPushData.eventType, 'test');

  const queryPushRes = await fetch(`${baseUrl}/api/integrations/openclaw/push`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'usage', params: { period: 'today', groupBy: 'model' } })
  });
  assert.equal(queryPushRes.status, 200);
  const queryPushData = await queryPushRes.json();
  assert.equal(queryPushData.ok, true);
  assert.equal(queryPushData.eventType, 'query_digest');

  const historyRes = await (await fetch(`${baseUrl}/api/integrations/openclaw/history`, { headers: auth })).json();
  assert.equal(historyRes.ok, true);
  assert.ok(historyRes.count >= 4);
  assert.equal(historyRes.history[0].eventType, 'query_digest');
});

test('createOpenClawEndpointSurface works standalone on loopback for Desktop local mode', async (t) => {
  const dayKey = localDayKey();
  const sampleStats = {
    devices: [makeRichDevice('local-mac', dayKey, { tokens: 42_000 })],
    periods: {
      today: makeRichDevice('local-mac', dayKey, { tokens: 42_000 }).periods.today
    }
  };
  const pushed = [];

  const surface = createOpenClawEndpointSurface({
    getStats: () => sampleStats,
    getOpenClawConfig: () => ({
      enabled: true,
      queryPermissions: { allowSessionDetail: false, allowConversationText: false }
    }),
    getEnhancedQueryContext: () => ({
      sessionTitlesEnabled: false,
      getServiceStatus: async () => ({ overall: 'operational', providers: [] })
    }),
    listApprovalAlerts: () => ({ ok: true, alerts: [{ id: 'a1', client: 'claude', tool: 'run_command' }] }),
    sendTestNotification: async ({ message }) => {
      pushed.push({ kind: 'test', message });
      return { ok: true, eventType: 'test', channel: 'openclaw-weixin', mode: 'openclaw-agent' };
    },
    pushQueryToOpenClaw: async (opts) => {
      pushed.push({ kind: 'query', ...opts });
      return { ok: true, eventType: 'query_digest', channel: 'openclaw-weixin', mode: 'openclaw-agent' };
    },
    getPushHistory: () => ({ count: pushed.length, lastPush: null, history: pushed }),
    mcpServerInfo: { name: 'token-monitor-local-bridge', version: '1.0.0' }
  });

  const bridgeSecret = 'local-bridge-secret';
  const server = http.createServer(async (req, res) => {
    if (!isAuthorized(req, bridgeSecret)) {
      sendJson(res, 401, { error: 'unauthorized' });
      return;
    }
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (await surface.handleRequest(req, res, url)) return;
    sendJson(res, 404, { error: 'not_found' });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const auth = { authorization: `Bearer ${bridgeSecret}` };

  const usageRes = await (await fetch(`${baseUrl}/api/query/usage?period=today`, { headers: auth })).json();
  assert.equal(usageRes.ok, true);
  assert.equal(usageRes.totals.totalTokens, 42_000);

  const alertsGet = await (await fetch(`${baseUrl}/api/approval-alerts`, { headers: auth })).json();
  assert.equal(alertsGet.ok, true);
  assert.equal(alertsGet.alerts[0].id, 'a1');

  const alertsPost = await fetch(`${baseUrl}/api/approval-alerts`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: '{}'
  });
  assert.equal(alertsPost.status, 405);

  const pushRes = await (await fetch(`${baseUrl}/api/integrations/openclaw/push`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ test: true, message: 'Local ping' })
  })).json();
  assert.equal(pushRes.ok, true);
  assert.equal(pushed.length, 1);

  const mcpCall = await (await fetch(`${baseUrl}/api/mcp`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'get_service_status_and_approvals', arguments: {} }
    })
  })).json();
  assert.equal(mcpCall.result.structuredContent.serviceStatus.available, true);
  assert.equal(mcpCall.result.structuredContent.approvalAlerts.alerts[0].id, 'a1');
});

test('installOpenClawSkill syncs SKILL.md + helper script and detectOpenClawEnvironment exposes sanitized localBridge', async (t) => {
  const dir = makeTempDir('tm-openclaw-prov-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const stateDir = path.join(dir, '.openclaw');
  const sourceDir = path.join(dir, 'skill-src');
  fs.mkdirSync(path.join(sourceDir, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(sourceDir, 'SKILL.md'), '# Token Monitor Skill\n');
  fs.writeFileSync(path.join(sourceDir, 'scripts', 'query-token-monitor.mjs'), 'console.log("ok");\n');

  const installRes = installOpenClawSkill({
    stateDir,
    skillSourceDir: sourceDir
  });
  assert.equal(installRes.ok, true);
  assert.equal(installRes.skillInstalled, true);
  assert.equal(installRes.helperInstalled, true);
  assert.equal(fs.existsSync(path.join(stateDir, 'skills', 'openclaw-token-monitor', 'SKILL.md')), true);
  assert.equal(fs.existsSync(path.join(stateDir, 'skills', 'openclaw-token-monitor', 'scripts', 'query-token-monitor.mjs')), true);

  const detected = await detectOpenClawEnvironment({
    env: { OPENCLAW_STATE_DIR: stateDir },
    homeDir: dir,
    probeGateway: false,
    cliPath: null,
    localBridge: {
      enabled: true,
      running: true,
      port: 17325,
      baseUrl: 'http://127.0.0.1:17325',
      tokenConfigured: true,
      token: 'DO_NOT_LEAK_TOKEN',
      secret: 'DO_NOT_LEAK_SECRET'
    }
  });

  assert.equal(detected.ok, true);
  assert.equal(detected.skillInstalled, true);
  assert.equal(detected.skillHelperInstalled, true);
  assert.equal(detected.mcpEndpoint, 'http://127.0.0.1:17325/api/mcp');
  assert.deepEqual(detected.localBridge, {
    enabled: true,
    running: true,
    port: 17325,
    baseUrl: 'http://127.0.0.1:17325',
    endpointUrl: 'http://127.0.0.1:17325/api/mcp',
    tokenConfigured: true
  });
  assert.equal(JSON.stringify(detected).includes('DO_NOT_LEAK'), false);
});
