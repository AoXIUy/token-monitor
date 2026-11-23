'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { createHub } = require('../../src/hub/server');
const { createReportManager, MAX_SNAPSHOT_DAYS } = require('../../src/hub/reports');
const { REPORT_SCHEMA, resolveReportPeriod } = require('../../src/shared/usageReport');

function localDayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDaysToKey(dayKey, deltaDays) {
  const dt = new Date(`${dayKey}T12:00:00.000Z`);
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().slice(0, 10);
}

function makeTempDir(prefix = 'tm-hub-reports-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeDevicePayload({
  deviceId,
  hostname = deviceId,
  platform = 'linux',
  dayKey,
  monthKey,
  tokens = 1000,
  costUsd = 0.25,
  projectLabel = '/workspace/alpha',
  client = 'codex',
  model = 'gpt-5',
  updatedAt = new Date().toISOString()
}) {
  const outputTokens = Math.round(tokens * 0.2);
  const cacheReadTokens = Math.round(tokens * 0.5);
  const inputTokens = tokens - outputTokens - cacheReadTokens;
  const sessionKey = `${client}:sess-${deviceId}-${dayKey || 'live'}`;
  const periodData = {
    totalTokens: tokens,
    costUsd,
    unpricedTokens: 0,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens: 0,
    unclassifiedTokens: 0,
    activeTimeMs: 120000,
    messageCount: 6,
    timedTokens: tokens,
    timedOutputTokens: outputTokens,
    timedDurationMs: 4000,
    capabilities: { tokenComponents: true },
    clients: { [client]: tokens },
    clientCosts: { [client]: costUsd },
    clientOutputs: { [client]: outputTokens },
    clientCacheReads: { [client]: cacheReadTokens },
    clientCacheWrites: { [client]: 0 },
    models: { [model]: tokens },
    modelCosts: { [model]: costUsd },
    modelOutputs: { [model]: outputTokens },
    modelCacheReads: { [model]: cacheReadTokens },
    modelCacheWrites: { [model]: 0 },
    sessions: {
      [sessionKey]: {
        client,
        sessionId: `sess-${deviceId}-${dayKey || 'live'}`,
        projectLabel,
        totalTokens: tokens,
        costUsd,
        outputTokens,
        cacheReadTokens,
        messageCount: 6,
        lastUsedAt: `${dayKey || updatedAt.slice(0, 10)}T12:00:00.000Z`,
        models: { [model]: tokens }
      }
    }
  };
  return {
    deviceId,
    hostname,
    platform,
    updatedAt,
    periodWindows: {
      ...(dayKey ? { today: { key: dayKey, endsAt: '2099-01-01T00:00:00.000Z' } } : {}),
      ...(monthKey ? { month: { key: monthKey, endsAt: '2099-01-01T00:00:00.000Z' } } : {})
    },
    today: periodData,
    month: periodData,
    allTime: periodData
  };
}

test('HTTP routes enforce secret, validate config, generate & deduplicate reports, and serve MCP JSON-RPC 2.0', async (t) => {
  const dir = makeTempDir();
  const dataFile = path.join(dir, 'devices.json');
  const reportsDir = path.join(dir, 'custom-reports');
  const secret = 'reports-secret';

  const hub = createHub({
    host: '127.0.0.1',
    port: 0,
    secret,
    dataFile,
    reportsDir,
    reports: false
  });
  await hub.start();
  t.after(async () => {
    await hub.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${hub.server.address().port}`;
  const authHeaders = { authorization: `Bearer ${secret}` };

  // 1. Auth checks (401 without secret)
  assert.equal((await fetch(`${baseUrl}/api/reports`)).status, 401);
  assert.equal((await fetch(`${baseUrl}/api/reports/config`)).status, 401);
  assert.equal((await fetch(`${baseUrl}/api/reports/config`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled: true })
  })).status, 401);
  assert.equal((await fetch(`${baseUrl}/api/reports/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}'
  })).status, 401);
  assert.equal((await fetch(`${baseUrl}/api/reports/daily/latest`)).status, 401);
  assert.equal((await fetch(`${baseUrl}/api/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })
  })).status, 401);

  // Empty hub returns 404 for latest/missing reports
  assert.equal((await fetch(`${baseUrl}/api/reports/daily/latest`, { headers: authHeaders })).status, 404);
  assert.equal((await fetch(`${baseUrl}/api/reports/daily/2020-01-01`, { headers: authHeaders })).status, 404);
  assert.equal((await fetch(`${baseUrl}/api/reports/invalid/latest`, { headers: authHeaders })).status, 400);

  // 2. Config GET & PUT validation + persistence
  const initialCfgRes = await fetch(`${baseUrl}/api/reports/config`, { headers: authHeaders });
  assert.equal(initialCfgRes.status, 200);
  const initialCfg = await initialCfgRes.json();
  assert.equal(initialCfg.ok, true);
  assert.equal(initialCfg.enabled, false);
  assert.equal(initialCfg.daily, true);
  assert.equal(initialCfg.weekly, true);
  assert.equal(initialCfg.monthly, true);
  assert.equal(initialCfg.reportsDir, undefined);

  for (const badBody of [{}, [], { enabled: 'yes' }, { unknown: true }, { daily: 1 }]) {
    const badRes = await fetch(`${baseUrl}/api/reports/config`, {
      method: 'PUT',
      headers: { ...authHeaders, 'content-type': 'application/json' },
      body: JSON.stringify(badBody)
    });
    assert.equal(badRes.status, 400);
  }

  // 3. Ingest across multiple devices while reports are disabled; on-demand latest works
  const todayKey = localDayKey();
  const monthKey = todayKey.slice(0, 7);
  await fetch(`${baseUrl}/api/ingest`, {
    method: 'POST',
    headers: { ...authHeaders, 'content-type': 'application/json' },
    body: JSON.stringify(makeDevicePayload({
      deviceId: 'dev-a',
      hostname: 'Laptop',
      dayKey: todayKey,
      monthKey,
      tokens: 1500,
      costUsd: 0.3,
      projectLabel: '/code/token-monitor',
      client: 'codex',
      model: 'gpt-5'
    }))
  });
  await fetch(`${baseUrl}/api/ingest`, {
    method: 'POST',
    headers: { ...authHeaders, 'content-type': 'application/json' },
    body: JSON.stringify(makeDevicePayload({
      deviceId: 'dev-b',
      hostname: 'Workstation',
      dayKey: todayKey,
      monthKey,
      tokens: 2500,
      costUsd: 0.5,
      projectLabel: '/code/other-app',
      client: 'claude-code',
      model: 'claude-sonnet-4-5'
    }))
  });

  // On-demand daily latest builds even before files are written
  const liveLatestRes = await fetch(`${baseUrl}/api/reports/daily/latest?format=json`, { headers: authHeaders });
  assert.equal(liveLatestRes.status, 200);
  const liveLatest = await liveLatestRes.json();
  assert.equal(liveLatest.ok, true);
  assert.equal(liveLatest.report.schema, REPORT_SCHEMA);
  assert.equal(liveLatest.report.summary.totalTokens, 4000);
  assert.equal(liveLatest.report.devices.length, 2);

  // Enable reports via PUT /api/reports/config -> persists config.json and generates enabled reports
  const putCfgRes = await fetch(`${baseUrl}/api/reports/config`, {
    method: 'PUT',
    headers: { ...authHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ enabled: true, daily: true, weekly: true, monthly: true })
  });
  assert.equal(putCfgRes.status, 200);
  const putCfg = await putCfgRes.json();
  assert.equal(putCfg.enabled, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(reportsDir, 'config.json'), 'utf8')).enabled, true);

  // Check generated .json and .md files on disk
  const listRes = await fetch(`${baseUrl}/api/reports`, { headers: authHeaders });
  assert.equal(listRes.status, 200);
  const listData = await listRes.json();
  assert.equal(listData.ok, true);
  assert.equal(listData.reports.length, 3);
  for (const item of listData.reports) {
    assert.equal(path.isAbsolute(item.files.json), false);
    assert.equal(path.isAbsolute(item.files.markdown), false);
    assert.ok(fs.existsSync(path.join(reportsDir, item.files.json)));
    assert.ok(fs.existsSync(path.join(reportsDir, item.files.markdown)));
  }

  // Verify daily-snapshots.json content
  const snapshotsDoc = JSON.parse(fs.readFileSync(path.join(reportsDir, 'daily-snapshots.json'), 'utf8'));
  assert.equal(snapshotsDoc.version, 1);
  assert.equal(snapshotsDoc.snapshots[todayKey].totalTokens, 4000);
  assert.ok(Object.keys(snapshotsDoc.snapshots[todayKey].projects).length >= 2);

  // 4. Signature deduplication on POST /api/reports/generate
  const gen1Res = await fetch(`${baseUrl}/api/reports/generate`, {
    method: 'POST',
    headers: { ...authHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ granularity: 'daily', periodKey: todayKey })
  });
  assert.equal(gen1Res.status, 200);
  const gen1 = await gen1Res.json();
  assert.equal(gen1.reports[0].written, false);

  const genForceRes = await fetch(`${baseUrl}/api/reports/generate`, {
    method: 'POST',
    headers: { ...authHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ granularity: 'daily', periodKey: todayKey, force: true })
  });
  assert.equal(genForceRes.status, 200);
  const genForce = await genForceRes.json();
  assert.equal(genForce.reports[0].written, true);

  // 5. GET /api/reports/:granularity/:periodKey?format=markdown
  const mdRes = await fetch(`${baseUrl}/api/reports/daily/${todayKey}?format=markdown`, { headers: authHeaders });
  assert.equal(mdRes.status, 200);
  const mdPayload = await mdRes.json();
  assert.equal(mdPayload.ok, true);
  assert.ok(mdPayload.markdown.includes('# Token Monitor Usage Report'));
  assert.ok(mdPayload.markdown.includes('## Project Usage Analysis'));
  assert.equal(mdPayload.report, undefined);

  // Filtered list
  const weeklyList = await (await fetch(`${baseUrl}/api/reports?granularity=weekly&limit=1`, { headers: authHeaders })).json();
  assert.equal(weeklyList.reports.length, 1);
  assert.equal(weeklyList.reports[0].granularity, 'weekly');

  // 6. Hub JS methods match main.js integration contract
  assert.equal(hub.getReportConfig().reportsDir, undefined);
  assert.equal((await hub.listReports({ granularity: 'monthly' })).reports.length, 1);
  assert.equal(hub.getReport('daily', 'latest', { format: 'json' }).report.summary.totalTokens, 4000);

  // 7. POST /api/mcp (initialize, tools/list, tools/call, resources/read, prompts/get, batch, notification-only)
  const mcpPost = async (body) => fetch(`${baseUrl}/api/mcp`, {
    method: 'POST',
    headers: { ...authHeaders, 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });

  const initRes = await (await mcpPost({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', clientInfo: { name: 'test-client', version: '1.0' } }
  })).json();
  assert.equal(initRes.result.protocolVersion, '2025-06-18');
  assert.equal(initRes.result.serverInfo.name, 'token-monitor-hub');

  // Notification-only payload returns 204 empty
  const notifRes = await mcpPost({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(notifRes.status, 204);
  assert.equal(await notifRes.text(), '');

  // Malformed JSON returns JSON-RPC Parse error (-32700)
  const parseErrRes = await (await mcpPost('{not-json')).json();
  assert.equal(parseErrRes.error.code, -32700);

  const toolsList = await (await mcpPost({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json();
  assert.deepEqual(
    toolsList.result.tools.map((tool) => tool.name),
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

  const callList = await (await mcpPost({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'list_usage_reports', arguments: { granularity: 'daily' } }
  })).json();
  assert.equal(callList.result.structuredContent.reports.length, 1);

  const callGet = await (await mcpPost({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: { name: 'get_usage_report', arguments: { granularity: 'daily', periodKey: 'latest', format: 'markdown' } }
  })).json();
  assert.ok(callGet.result.content[0].text.includes('Token Monitor Usage Report'));

  const callGenerate = await (await mcpPost({
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: { name: 'generate_usage_report', arguments: { granularity: 'weekly', force: true } }
  })).json();
  assert.equal(callGenerate.result.structuredContent.ok, true);
  assert.equal(callGenerate.result.structuredContent.reports[0].written, true);

  const callAnalyze = await (await mcpPost({
    jsonrpc: '2.0',
    id: 6,
    method: 'tools/call',
    params: { name: 'analyze_project_usage', arguments: { granularity: 'daily', project: 'token-monitor' } }
  })).json();
  assert.equal(callAnalyze.result.structuredContent.matchedCount, 1);
  assert.equal(callAnalyze.result.structuredContent.projects[0].tokens, 1500);

  const resRead = await (await mcpPost({
    jsonrpc: '2.0',
    id: 7,
    method: 'resources/read',
    params: { uri: 'report://latest/daily' }
  })).json();
  assert.equal(resRead.result.contents[0].mimeType, 'application/json');
  assert.equal(JSON.parse(resRead.result.contents[0].text).summary.totalTokens, 4000);

  const promptGet = await (await mcpPost({
    jsonrpc: '2.0',
    id: 8,
    method: 'prompts/get',
    params: { name: 'project-deep-dive', arguments: { project: 'token-monitor', granularity: 'daily' } }
  })).json();
  assert.ok(promptGet.result.messages[0].content.text.includes('token-monitor'));

  // Batch JSON-RPC request (1 notification + 1 request -> single-element array response)
  const batchRes = await (await mcpPost([
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 'b1', method: 'ping' }
  ])).json();
  assert.equal(Array.isArray(batchRes), true);
  assert.equal(batchRes.length, 1);
  assert.equal(batchRes[0].id, 'b1');
});

test('period rollover via Hub ingest archives previous day and week, and device delete updates snapshot', async (t) => {
  const dir = makeTempDir('tm-hub-rollover-');
  const dataFile = path.join(dir, 'devices.json');
  const reportsDir = path.join(dir, 'reports');
  const hub = createHub({
    host: '127.0.0.1',
    port: 0,
    secret: 'rollover-secret',
    dataFile,
    reportsDir,
    reports: true
  });
  await hub.start();
  t.after(async () => {
    await hub.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const todayKey = localDayKey();
  const dow = new Date(`${todayKey}T12:00:00.000Z`).getUTCDay();
  const sinceMonday = (dow + 6) % 7;
  const mondayKey = addDaysToKey(todayKey, -sinceMonday);
  const sundayKey = addDaysToKey(mondayKey, -1);
  const sundayWeekKey = resolveReportPeriod('weekly', 'current', {
    now: new Date(`${sundayKey}T12:00:00.000Z`),
    timeZone: 'UTC'
  }).key;

  // Sunday -> Monday -> should trigger daily & ISO weekly rollover archive
  hub.ingest(makeDevicePayload({
    deviceId: 'dev-1',
    dayKey: sundayKey,
    monthKey: sundayKey.slice(0, 7),
    tokens: 900,
    costUsd: 0.18,
    projectLabel: '/repo/sunday-work',
    updatedAt: `${sundayKey}T18:00:00.000Z`
  }));

  hub.ingest(makeDevicePayload({
    deviceId: 'dev-1',
    dayKey: mondayKey,
    monthKey: mondayKey.slice(0, 7),
    tokens: 1400,
    costUsd: 0.28,
    projectLabel: '/repo/monday-work',
    updatedAt: `${mondayKey}T10:00:00.000Z`
  }));

  const archivedDailyPath = path.join(reportsDir, 'daily', `${sundayKey}.json`);
  const archivedWeeklyPath = path.join(reportsDir, 'weekly', `${sundayWeekKey}.json`);
  assert.ok(fs.existsSync(archivedDailyPath), 'archived daily report should exist after rollover');
  assert.ok(fs.existsSync(path.join(reportsDir, 'daily', `${sundayKey}.md`)));
  assert.ok(fs.existsSync(archivedWeeklyPath), 'archived ISO weekly report should exist after week rollover');

  const archivedDaily = JSON.parse(fs.readFileSync(archivedDailyPath, 'utf8'));
  assert.equal(archivedDaily.summary.totalTokens, 900);
  assert.equal(archivedDaily.projects[0].label, '/repo/sunday-work');

  const archivedWeekly = JSON.parse(fs.readFileSync(archivedWeeklyPath, 'utf8'));
  assert.equal(archivedWeekly.period.key, sundayWeekKey);
  assert.equal(archivedWeekly.summary.totalTokens, 900);

  if (todayKey > mondayKey) {
    hub.ingest(makeDevicePayload({
      deviceId: 'dev-1',
      dayKey: todayKey,
      monthKey: todayKey.slice(0, 7),
      tokens: 1400,
      costUsd: 0.28,
      projectLabel: '/repo/today-work',
      updatedAt: new Date().toISOString()
    }));
  }

  // Deleting the device updates today's snapshot and regenerated current report
  hub.deleteDevice('dev-1');
  const currentDaily = hub.getReport('daily', todayKey, { format: 'json' });
  assert.equal(currentDaily.ok, true);
  assert.equal(currentDaily.report.summary.totalTokens, 0);
});

test('createReportManager persists config across restarts, rolls over across month boundary, and caps snapshots at 400 days', () => {
  const dir = makeTempDir('tm-mgr-');
  try {
    const dataFile = path.join(dir, 'devices.json');
    const reportsDir = path.join(dir, 'reports');
    let clock = new Date(2026, 10, 30, 12, 0, 0);
    let currentStats = {
      periods: {
        today: {
          totalTokens: 700,
          costUsd: 0.14,
          unpricedTokens: 0,
          cacheReadTokens: 200,
          cacheWriteTokens: 0,
          outputTokens: 150,
          unclassifiedTokens: 0,
          capabilities: { tokenComponents: true },
          clients: { claude: 700 },
          clientCosts: { claude: 0.14 },
          models: { 'claude-sonnet-4-5': 700 },
          modelCosts: { 'claude-sonnet-4-5': 0.14 },
          projects: { alpha: { label: 'alpha', tokens: 700, costUsd: 0.14 } }
        },
        month: {
          totalTokens: 700,
          costUsd: 0.14,
          clients: { claude: 700 },
          clientCosts: { claude: 0.14 },
          models: { 'claude-sonnet-4-5': 700 },
          modelCosts: { 'claude-sonnet-4-5': 0.14 },
          projects: { alpha: { label: 'alpha', tokens: 700, costUsd: 0.14 } }
        }
      },
      devices: [{ deviceId: 'host-1', hostname: 'Host', platform: 'linux', periods: { today: { totalTokens: 700, costUsd: 0.14 }, month: { totalTokens: 700, costUsd: 0.14 } } }]
    };

    const mgr1 = createReportManager({
      dataFile,
      reportsDir,
      debounceMs: 0,
      now: () => clock,
      getStats: () => currentStats,
      getHistory: () => ({ daily: [], monthly: [] }),
      getDevices: () => currentStats.devices
    });

    mgr1.setConfig({ enabled: true, daily: true, weekly: true, monthly: true });
    mgr1.recordIngestSnapshot(currentStats);

    // Advance to next month 2026-12-01 (same ISO week 2026-W49, new day & new month)
    clock = new Date(2026, 11, 1, 12, 0, 0);
    currentStats = {
      ...currentStats,
      periods: {
        ...currentStats.periods,
        today: {
          ...currentStats.periods.today,
          totalTokens: 300,
          costUsd: 0.06,
          clients: { claude: 300 },
          clientCosts: { claude: 0.06 },
          models: { 'claude-sonnet-4-5': 300 },
          modelCosts: { 'claude-sonnet-4-5': 0.06 },
          projects: { beta: { label: 'beta', tokens: 300, costUsd: 0.06 } }
        }
      }
    };
    mgr1.recordIngestSnapshot(currentStats);

    assert.ok(fs.existsSync(path.join(reportsDir, 'daily', '2026-11-30.json')));
    assert.ok(fs.existsSync(path.join(reportsDir, 'monthly', '2026-11.json')));
    const novReport = JSON.parse(fs.readFileSync(path.join(reportsDir, 'monthly', '2026-11.json'), 'utf8'));
    assert.equal(novReport.summary.totalTokens, 700);

    // Seed 410 days and ensure snapshot store retains only latest 400
    const startMs = Date.parse('2025-01-01T12:00:00.000Z');
    const seededSnapshots = {};
    for (let i = 0; i < MAX_SNAPSHOT_DAYS + 10; i += 1) {
      const d = new Date(startMs + i * 86400000).toISOString().slice(0, 10);
      seededSnapshots[d] = { date: d, totalTokens: i + 1, costUsd: 0.01, projects: {} };
    }
    fs.writeFileSync(
      path.join(reportsDir, 'daily-snapshots.json'),
      JSON.stringify({ version: 1, snapshots: seededSnapshots }, null, 2)
    );
    mgr1.stop();

    // Restart manager without explicit config -> loads persisted config.json & prunes snapshots to 400
    const mgr2 = createReportManager({
      dataFile,
      reportsDir,
      debounceMs: 0,
      now: () => clock,
      getStats: () => currentStats,
      getHistory: () => ({ daily: [], monthly: [] }),
      getDevices: () => currentStats.devices
    });
    assert.equal(mgr2.getConfig().enabled, true);
    mgr2.recordIngestSnapshot({
      ...currentStats,
      periods: { ...currentStats.periods, today: { ...currentStats.periods.today, totalTokens: 305 } }
    });
    mgr2.stop();

    const afterPrune = JSON.parse(fs.readFileSync(path.join(reportsDir, 'daily-snapshots.json'), 'utf8'));
    assert.equal(Object.keys(afterPrune.snapshots).length, MAX_SNAPSHOT_DAYS);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Node CLI parses --reports / --reports-dir flags and TOKEN_MONITOR_REPORTS env vars', async (t) => {
  const dir = makeTempDir('tm-hub-reports-cli-');
  const reportsDir = path.join(dir, 'cli-reports');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening', { signal: AbortSignal.timeout(5000) });
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));

  const child = spawn(process.execPath, [
    path.resolve(__dirname, '../../src/hub/server.js'),
    '--host=127.0.0.1',
    `--port=${port}`,
    `--dataFile=${path.join(dir, 'devices.json')}`,
    '--reports=daily,weekly',
    `--reports-dir=${reportsDir}`
  ], {
    env: { ...process.env, TOKEN_MONITOR_SECRET: 'cli-secret' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  t.after(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit', { signal: AbortSignal.timeout(5000) });
    child.kill();
    await exited;
  });

  await new Promise((resolve, reject) => {
    let output = '';
    let errors = '';
    const finish = (err) => {
      clearTimeout(timer);
      child.stdout.off('data', onOut);
      child.stderr.off('data', onErr);
      child.off('exit', onExit);
      if (err) reject(err); else resolve();
    };
    const onOut = (chunk) => { output += chunk; if (output.includes('hub listening')) finish(); };
    const onErr = (chunk) => { errors += chunk; };
    const onExit = (code) => finish(new Error(`CLI exited ${code}: ${errors}`));
    const timer = setTimeout(() => finish(new Error(`CLI startup timed out: ${errors}`)), 5000);
    child.stdout.on('data', onOut);
    child.stderr.on('data', onErr);
    child.on('exit', onExit);
  });

  const cfgRes = await fetch(`http://127.0.0.1:${port}/api/reports/config`, {
    headers: { authorization: 'Bearer cli-secret' }
  });
  assert.equal(cfgRes.status, 200);
  const cfg = await cfgRes.json();
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.daily, true);
  assert.equal(cfg.weekly, true);
  assert.equal(cfg.monthly, false);
  assert.equal(cfg.reportsDir, undefined);

  const genRes = await fetch(`http://127.0.0.1:${port}/api/reports/generate`, {
    method: 'POST',
    headers: { authorization: 'Bearer cli-secret', 'content-type': 'application/json' },
    body: JSON.stringify({ granularity: 'daily', periodKey: localDayKey(), force: true })
  });
  assert.equal(genRes.status, 200);
  assert.ok(fs.existsSync(path.join(reportsDir, 'daily', `${localDayKey()}.json`)));
});
