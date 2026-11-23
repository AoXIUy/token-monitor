'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const test = require('node:test');

const {
  DEFAULT_HUB_URL,
  resolveMcpServerOptions,
  createLocalBackendAdapter,
  createStdioMcpTransport,
  startMcpServer
} = require('../../src/mcp/server');
const {
  REPORT_SCHEMA,
  buildUsageReport,
  renderReportJson,
  renderReportMarkdown,
  resolveReportPeriod
} = require('../../src/shared/usageReport');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MCP_SERVER_ENTRY = path.join(REPO_ROOT, 'src', 'mcp', 'server.js');

/**
 * @param {string} prefix
 */
function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * @param {string} todayKey
 * @param {string} yesterdayKey
 */
function createSampleDevicesStore(todayKey, yesterdayKey) {
  const nowIso = new Date().toISOString();
  const tomorrowKey = resolveReportPeriod('daily', todayKey, { timeZone: 'UTC' }).key;
  const endTs = new Date(Date.parse(`${tomorrowKey}T00:00:00Z`) + 86400000).toISOString();

  return {
    version: 1,
    savedAt: nowIso,
    devices: {
      'dev-laptop': {
        deviceId: 'dev-laptop',
        hostname: 'macbook-pro',
        platform: 'darwin',
        updatedAt: nowIso,
        receivedAt: nowIso,
        periodWindows: {
          today: { key: todayKey, endsAt: endTs },
          month: { key: todayKey.slice(0, 7) }
        },
        periods: {
          today: {
            totalTokens: 120000,
            costUsd: 1.8,
            unpricedTokens: 0,
            cacheReadTokens: 30000,
            cacheWriteTokens: 10000,
            outputTokens: 20000,
            unclassifiedTokens: 0,
            capabilities: { tokenComponents: true, throughput: true },
            clients: { claude: 90000, codex: 30000 },
            clientCosts: { claude: 1.35, codex: 0.45 },
            clientCacheReads: { claude: 25000, codex: 5000 },
            clientCacheWrites: { claude: 10000, codex: 0 },
            clientOutputs: { claude: 15000, codex: 5000 },
            models: { 'claude-sonnet-4-5': 90000, 'gpt-5': 30000 },
            modelCosts: { 'claude-sonnet-4-5': 1.35, 'gpt-5': 0.45 },
            projects: {
              'token-monitor': {
                label: 'token-monitor',
                tokens: 95000,
                costUsd: 1.45,
                clients: { claude: 90000, codex: 5000 },
                models: { 'claude-sonnet-4-5': 90000, 'gpt-5': 5000 }
              },
              'side-project': {
                label: 'side-project',
                tokens: 25000,
                costUsd: 0.35,
                clients: { codex: 25000 },
                models: { 'gpt-5': 25000 }
              }
            },
            sessions: {
              'claude:s1': {
                client: 'claude',
                sessionId: 's1',
                projectLabel: 'token-monitor',
                messageCount: 14,
                lastUsedAt: nowIso
              },
              'codex:s2': {
                client: 'codex',
                sessionId: 's2',
                projectLabel: 'side-project',
                messageCount: 6,
                lastUsedAt: nowIso
              }
            }
          },
          month: {
            totalTokens: 165000,
            costUsd: 2.5,
            capabilities: { tokenComponents: true, throughput: false },
            clients: { claude: 135000, codex: 30000 },
            clientCosts: { claude: 2.05, codex: 0.45 },
            models: { 'claude-sonnet-4-5': 135000, 'gpt-5': 30000 },
            modelCosts: { 'claude-sonnet-4-5': 2.05, 'gpt-5': 0.45 },
            projects: {
              'token-monitor': {
                label: 'token-monitor',
                tokens: 140000,
                costUsd: 2.15,
                clients: { claude: 135000, codex: 5000 },
                models: { 'claude-sonnet-4-5': 135000, 'gpt-5': 5000 }
              },
              'side-project': {
                label: 'side-project',
                tokens: 25000,
                costUsd: 0.35,
                clients: { codex: 25000 },
                models: { 'gpt-5': 25000 }
              }
            },
            sessions: {
              'claude:s1': {
                client: 'claude',
                sessionId: 's1',
                projectLabel: 'token-monitor',
                messageCount: 14,
                lastUsedAt: nowIso
              }
            }
          }
        },
        history: {
          daily: [
            {
              date: yesterdayKey,
              tokens: 45000,
              cost: 0.7,
              messages: 8,
              activeTimeMs: 90000,
              tokenComponentsAvailable: true,
              cacheReadTokens: 15000,
              cacheWriteTokens: 0,
              outputTokens: 6000,
              unclassifiedTokens: 0,
              perClient: { claude: { tokens: 45000, cost: 0.7, messages: 8 } },
              perModel: { 'claude-sonnet-4-5': { tokens: 45000, cost: 0.7 } }
            },
            {
              date: todayKey,
              tokens: 120000,
              cost: 1.8,
              messages: 20,
              activeTimeMs: 180000,
              tokenComponentsAvailable: true,
              cacheReadTokens: 30000,
              cacheWriteTokens: 10000,
              outputTokens: 20000,
              unclassifiedTokens: 0,
              perClient: {
                claude: { tokens: 90000, cost: 1.35, messages: 14 },
                codex: { tokens: 30000, cost: 0.45, messages: 6 }
              },
              perModel: {
                'claude-sonnet-4-5': { tokens: 90000, cost: 1.35 },
                'gpt-5': { tokens: 30000, cost: 0.45 }
              }
            }
          ],
          monthly: []
        }
      }
    }
  };
}

/**
 * @param {string} todayKey
 * @param {string} yesterdayKey
 */
function createSampleDailySnapshots(todayKey, yesterdayKey) {
  return {
    version: 1,
    snapshots: {
      [yesterdayKey]: {
        date: yesterdayKey,
        totalTokens: 45000,
        costUsd: 0.7,
        projects: {
          'token-monitor': {
            label: 'token-monitor',
            tokens: 45000,
            costUsd: 0.7,
            sessionCount: 3,
            clients: { claude: 45000 },
            models: { 'claude-sonnet-4-5': 45000 }
          }
        }
      },
      [todayKey]: {
        date: todayKey,
        totalTokens: 120000,
        costUsd: 1.8,
        projects: {
          'token-monitor': {
            label: 'token-monitor',
            tokens: 95000,
            costUsd: 1.45,
            sessionCount: 1,
            clients: { claude: 90000, codex: 5000 },
            models: { 'claude-sonnet-4-5': 90000, 'gpt-5': 5000 }
          },
          'side-project': {
            label: 'side-project',
            tokens: 25000,
            costUsd: 0.35,
            sessionCount: 1,
            clients: { codex: 25000 },
            models: { 'gpt-5': 25000 }
          }
        }
      }
    }
  };
}

/**
 * Collect NDJSON lines written to a stream until `predicate` matches or timeout expires.
 * @param {PassThrough} output
 * @param {(messages: any[]) => boolean} predicate
 * @param {number} [timeoutMs]
 */
function collectNdjsonMessages(output, predicate, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    /** @type {any[]} */
    const messages = [];
    let textBuffer = '';

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for NDJSON response (received ${messages.length}): ${textBuffer}`));
    }, timeoutMs);

    function onData(chunk) {
      textBuffer += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
      let idx;
      while ((idx = textBuffer.indexOf('\n')) !== -1) {
        const line = textBuffer.slice(0, idx).replace(/\r$/, '').trim();
        textBuffer = textBuffer.slice(idx + 1);
        if (!line) continue;
        messages.push(JSON.parse(line));
      }
      if (predicate(messages)) {
        cleanup();
        resolve(messages);
      }
    }

    function onError(err) {
      cleanup();
      reject(err);
    }

    function cleanup() {
      clearTimeout(timer);
      output.off('data', onData);
      output.off('error', onError);
    }

    output.on('data', onData);
    output.on('error', onError);
  });
}

/**
 * Encode an object using LSP-style Content-Length framing.
 * @param {any} msg
 */
function encodeContentLengthFrame(msg) {
  const body = Buffer.from(JSON.stringify(msg), 'utf8');
  return Buffer.concat([
    Buffer.from(`Content-Length: ${body.length}\r\nContent-Type: application/vscode-jsonrpc; charset=utf-8\r\n\r\n`, 'ascii'),
    body
  ]);
}

/**
 * Parse all Content-Length frames from a Buffer.
 * @param {Buffer} buf
 */
function parseContentLengthFrames(buf) {
  /** @type {any[]} */
  const messages = [];
  let offset = 0;
  while (offset < buf.length) {
    const headerEnd = buf.indexOf('\r\n\r\n', offset);
    if (headerEnd === -1) break;
    const header = buf.subarray(offset, headerEnd).toString('ascii');
    const match = /^content-length:\s*(\d+)/im.exec(header);
    if (!match) break;
    const len = Number(match[1]);
    const bodyStart = headerEnd + 4;
    if (buf.length < bodyStart + len) break;
    messages.push(JSON.parse(buf.subarray(bodyStart, bodyStart + len).toString('utf8')));
    offset = bodyStart + len;
  }
  return { messages, remaining: buf.subarray(offset) };
}

test('resolveMcpServerOptions selects hub or local mode with CLI > env > default precedence', () => {
  const defaultOpts = resolveMcpServerOptions({ argv: [], env: {} });
  assert.equal(defaultOpts.mode, 'hub');
  assert.equal(defaultOpts.hubUrl, DEFAULT_HUB_URL);
  assert.equal(defaultOpts.secret, '');

  const envHub = resolveMcpServerOptions({
    argv: [],
    env: {
      TOKEN_MONITOR_HUB_URL: 'http://192.168.1.50:17321/',
      TOKEN_MONITOR_SECRET: 's3cr3t'
    }
  });
  assert.equal(envHub.mode, 'hub');
  assert.equal(envHub.hubUrl, 'http://192.168.1.50:17321');
  assert.equal(envHub.secret, 's3cr3t');

  const cliHubCamel = resolveMcpServerOptions({
    argv: ['--hubUrl', 'https://hub.example.com/', '--secret', 'cli-sec'],
    env: { TOKEN_MONITOR_DATA_FILE: '/tmp/devices.json' }
  });
  assert.equal(cliHubCamel.mode, 'hub');
  assert.equal(cliHubCamel.hubUrl, 'https://hub.example.com');
  assert.equal(cliHubCamel.secret, 'cli-sec');

  const envLocal = resolveMcpServerOptions({
    argv: [],
    env: {
      TOKEN_MONITOR_DATA_FILE: '/tmp/tm/devices.json',
      TOKEN_MONITOR_REPORTS_DIR: '/tmp/tm/custom-reports'
    }
  });
  assert.equal(envLocal.mode, 'local');
  assert.equal(envLocal.dataFile, path.resolve('/tmp/tm/devices.json'));
  assert.equal(envLocal.reportsDir, path.resolve('/tmp/tm/custom-reports'));

  const cliLocalFlag = resolveMcpServerOptions({
    argv: ['--local'],
    env: { TOKEN_MONITOR_HUB_URL: 'http://127.0.0.1:17321' }
  });
  assert.equal(cliLocalFlag.mode, 'local');
});

test('Local Store direct mode serves reports, tools, resources, and prompts over stdio', async (t) => {
  const tmpDir = makeTempDir('tm-mcp-local-');
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const todayPeriod = resolveReportPeriod('daily', 'current', { timeZone: 'UTC' });
  const todayKey = todayPeriod.key;
  const yesterdayKey = todayPeriod.previousPeriodKey;
  const weekKey = resolveReportPeriod('weekly', 'current', { timeZone: 'UTC' }).key;

  const dataFile = path.join(tmpDir, 'devices.json');
  const reportsDir = path.join(tmpDir, 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });
  fs.writeFileSync(dataFile, JSON.stringify(createSampleDevicesStore(todayKey, yesterdayKey), null, 2));
  fs.writeFileSync(
    path.join(reportsDir, 'daily-snapshots.json'),
    JSON.stringify(createSampleDailySnapshots(todayKey, yesterdayKey), null, 2)
  );

  const input = new PassThrough();
  const output = new PassThrough();
  const stderr = new PassThrough();
  let stderrText = '';
  stderr.on('data', (chunk) => { stderrText += chunk.toString('utf8'); });

  const server = startMcpServer({
    mode: 'local',
    dataFile,
    reportsDir,
    timeZone: 'UTC',
    input,
    output,
    stderr
  });
  t.after(() => server.stop());

  assert.equal(server.backend.mode, 'local');

  const waitBatch1 = collectNdjsonMessages(output, (msgs) => msgs.length >= 6);
  const requests = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'generate_usage_report', arguments: { force: false } } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'generate_usage_report', arguments: { force: false } } },
    { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'list_usage_reports', arguments: { granularity: 'daily', limit: 5 } } },
    { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'get_usage_report', arguments: { granularity: 'daily', periodKey: todayKey, format: 'markdown' } } }
  ];
  // Send across split chunks to test buffering
  const wire = Buffer.from(`${requests.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8');
  input.write(wire.subarray(0, 45));
  input.write(wire.subarray(45, 190));
  input.write(wire.subarray(190));

  const batch1 = await waitBatch1;
  assert.equal(batch1.length, 6);

  assert.equal(batch1[0].id, 1);
  assert.equal(batch1[0].result.protocolVersion, '2025-06-18');
  assert.equal(batch1[0].result.serverInfo.name, 'token-monitor-reports');

  assert.equal(batch1[1].id, 2);
  assert.deepEqual(
    batch1[1].result.tools.map((tool) => tool.name),
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

  // First generate wrote daily/weekly/monthly files on disk
  const gen1 = JSON.parse(batch1[2].result.content[0].text);
  assert.equal(gen1.ok, true);
  assert.equal(gen1.reports.length, 3);
  assert.ok(gen1.reports.every((r) => r.written === true));
  assert.ok(fs.existsSync(path.join(reportsDir, 'daily', `${todayKey}.json`)));
  assert.ok(fs.existsSync(path.join(reportsDir, 'daily', `${todayKey}.md`)));
  assert.ok(fs.existsSync(path.join(reportsDir, 'weekly', `${weekKey}.json`)));

  // Second generate deduplicated via signature
  const gen2 = JSON.parse(batch1[3].result.content[0].text);
  assert.equal(gen2.ok, true);
  assert.ok(gen2.reports.every((r) => r.written === false));

  // list_usage_reports
  const listed = JSON.parse(batch1[4].result.content[0].text);
  assert.equal(listed.ok, true);
  assert.equal(listed.reports.length, 1);
  assert.equal(listed.reports[0].periodKey, todayKey);

  // get_usage_report markdown
  assert.match(batch1[5].result.content[0].text, /# Token Monitor Usage Report/);
  assert.match(batch1[5].result.content[0].text, /Token Monitor/);

  // Batch 2: analyze_project_usage, resources, prompts, missing report
  const waitBatch2 = collectNdjsonMessages(output, (msgs) => msgs.length >= 6);
  const requests2 = [
    { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'analyze_project_usage', arguments: { granularity: 'weekly', periodKey: 'latest', project: 'token-monitor', limit: 5 } } },
    { jsonrpc: '2.0', id: 8, method: 'resources/list' },
    { jsonrpc: '2.0', id: 9, method: 'resources/read', params: { uri: `report://daily/${todayKey}` } },
    { jsonrpc: '2.0', id: 10, method: 'prompts/list' },
    { jsonrpc: '2.0', id: 11, method: 'prompts/get', params: { name: 'project-deep-dive', arguments: { project: 'token-monitor', granularity: 'weekly' } } },
    { jsonrpc: '2.0', id: 12, method: 'tools/call', params: { name: 'get_usage_report', arguments: { granularity: 'daily', periodKey: '2019-01-01' } } }
  ];
  for (const r of requests2) {
    input.write(`${JSON.stringify(r)}\n`);
  }
  const batch2 = await waitBatch2;
  assert.equal(batch2.length, 6);

  const analysis = JSON.parse(batch2[0].result.content[0].text);
  assert.equal(analysis.matchedCount, 1);
  assert.equal(analysis.projects[0].key, 'token-monitor');
  assert.ok(analysis.projects[0].tokens >= 95000);

  assert.deepEqual(
    batch2[1].result.resources.map((r) => r.uri),
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

  const readRes = JSON.parse(batch2[2].result.contents[0].text);
  assert.equal(readRes.schema, REPORT_SCHEMA);
  assert.equal(readRes.reportId, `daily:${todayKey}`);

  assert.equal(batch2[3].result.prompts.length, 8);
  assert.match(batch2[4].result.messages[0].content.text, /token-monitor/);

  assert.equal(batch2[5].result.isError, true);
  assert.match(batch2[5].result.content[0].text, /not found/i);

  assert.equal(stderrText, '');
  input.end();
  await server.closed;
});

test('Hub HTTP API mode sends Bearer auth, calls all report routes, and falls back to generate on 404 for analyze', async (t) => {
  const todayPeriod = resolveReportPeriod('daily', 'current', { timeZone: 'UTC' });
  const todayKey = todayPeriod.key;
  const weekKey = resolveReportPeriod('weekly', 'current', { timeZone: 'UTC' }).key;

  const store = createSampleDevicesStore(todayKey, todayPeriod.previousPeriodKey);
  const devices = Object.values(store.devices);
  const dailyReport = buildUsageReport({
    granularity: 'daily',
    periodKey: todayKey,
    devices,
    now: `${todayKey}T12:00:00Z`,
    timeZone: 'UTC'
  });
  const weeklyReport = buildUsageReport({
    granularity: 'weekly',
    periodKey: weekKey,
    devices,
    dailySnapshots: createSampleDailySnapshots(todayKey, todayPeriod.previousPeriodKey).snapshots,
    now: `${todayKey}T12:00:00Z`,
    timeZone: 'UTC'
  });

  const expectedSecret = 'hub-secret-123';
  /** @type {Array<{ method: string, url: string, auth: string | undefined, body: any }>} */
  const requestLog = [];
  let weeklyPresent = false;

  const mockHub = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf8');
      const body = rawBody ? JSON.parse(rawBody) : null;
      requestLog.push({
        method: req.method || '',
        url: req.url || '',
        auth: req.headers.authorization,
        body
      });

      if (req.headers.authorization !== `Bearer ${expectedSecret}`) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }

      const parsedUrl = new URL(req.url || '/', 'http://127.0.0.1');
      if (req.method === 'GET' && parsedUrl.pathname === '/api/reports') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          reports: [
            {
              reportId: dailyReport.reportId,
              granularity: 'daily',
              periodKey: dailyReport.period.key,
              totalTokens: dailyReport.summary.totalTokens
            }
          ]
        }));
        return;
      }

      if (req.method === 'GET' && parsedUrl.pathname === `/api/reports/daily/${todayKey}`) {
        const fmt = parsedUrl.searchParams.get('format') || 'both';
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          ...(fmt !== 'markdown' ? { report: dailyReport } : {}),
          ...(fmt !== 'json' ? { markdown: renderReportMarkdown(dailyReport) } : {})
        }));
        return;
      }

      if (req.method === 'GET' && parsedUrl.pathname === '/api/reports/weekly/latest') {
        if (!weeklyPresent) {
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'not_found' }));
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, report: weeklyReport }));
        return;
      }

      if (req.method === 'POST' && parsedUrl.pathname === '/api/reports/generate') {
        if (body?.granularity === 'weekly') {
          weeklyPresent = true;
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            ok: true,
            reports: [{ reportId: weeklyReport.reportId, granularity: 'weekly', periodKey: weekKey, report: weeklyReport }]
          }));
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          reports: [{ reportId: dailyReport.reportId, granularity: 'daily', periodKey: todayKey }]
        }));
        return;
      }

      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found' }));
    });
  });

  await new Promise((resolve) => mockHub.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => mockHub.close(resolve)));

  const addr = /** @type {import('node:net').AddressInfo} */ (mockHub.address());
  const hubUrl = `http://127.0.0.1:${addr.port}`;

  // First check bad secret produces clear auth error
  const badInput = new PassThrough();
  const badOutput = new PassThrough();
  const badServer = startMcpServer({
    mode: 'hub',
    hubUrl,
    secret: 'wrong-secret',
    input: badInput,
    output: badOutput,
    stderr: new PassThrough()
  });
  const waitBad = collectNdjsonMessages(badOutput, (msgs) => msgs.length >= 1);
  badInput.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_usage_reports' } })}\n`);
  const [badResp] = await waitBad;
  assert.equal(badResp.result.isError, true);
  assert.match(badResp.result.content[0].text, /authentication failed|TOKEN_MONITOR_SECRET/i);
  badInput.end();
  await badServer.closed;

  // Now check full Hub HTTP flow with valid secret
  requestLog.length = 0;
  const input = new PassThrough();
  const output = new PassThrough();
  const server = startMcpServer({
    mode: 'hub',
    hubUrl,
    secret: expectedSecret,
    input,
    output,
    stderr: new PassThrough()
  });
  t.after(() => server.stop());

  const waitResps = collectNdjsonMessages(output, (msgs) => msgs.length >= 5);
  input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_usage_reports', arguments: { granularity: 'daily', limit: 10 } } })}\n`);
  input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_usage_report', arguments: { granularity: 'daily', periodKey: todayKey, format: 'json' } } })}\n`);
  input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'generate_usage_report', arguments: { granularity: 'daily', periodKey: todayKey, force: true } } })}\n`);
  input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'analyze_project_usage', arguments: { granularity: 'weekly', periodKey: 'latest', project: 'token-monitor' } } })}\n`);
  input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'resources/read', params: { uri: `report://daily/${todayKey}?format=markdown` } })}\n`);

  const resps = await waitResps;
  assert.equal(resps.length, 5);
  assert.equal(JSON.parse(resps[0].result.content[0].text).reports[0].reportId, dailyReport.reportId);
  assert.equal(JSON.parse(resps[1].result.content[0].text).reportId, dailyReport.reportId);
  assert.equal(JSON.parse(resps[2].result.content[0].text).ok, true);

  const analysis = JSON.parse(resps[3].result.content[0].text);
  assert.equal(analysis.reportId, weeklyReport.reportId);
  assert.equal(analysis.projects[0].key, 'token-monitor');

  assert.equal(resps[4].result.contents[0].mimeType, 'text/markdown');
  assert.match(resps[4].result.contents[0].text, /# Token Monitor Usage Report/);

  assert.ok(requestLog.every((r) => r.auth === `Bearer ${expectedSecret}`));
  assert.equal(requestLog[0].url, '/api/reports?granularity=daily&limit=10');
  assert.equal(requestLog[1].url, `/api/reports/daily/${todayKey}?format=json`);
  assert.equal(requestLog[2].url, '/api/reports/generate');
  assert.deepEqual(requestLog[2].body, { granularity: 'daily', periodKey: todayKey, force: true });
  assert.equal(requestLog[3].url, '/api/reports/weekly/latest?format=json');
  assert.equal(requestLog[4].url, '/api/reports/generate');
  assert.deepEqual(requestLog[4].body, { granularity: 'weekly', periodKey: 'latest' });

  input.end();
  await server.closed;
});

test('createStdioMcpTransport supports LSP-style Content-Length framing across split UTF-8 chunks', async () => {
  const input = new PassThrough();
  const output = new PassThrough();

  const received = [];
  const transport = createStdioMcpTransport({
    input,
    output,
    stderr: new PassThrough(),
    onPayload: async (raw) => {
      const parsed = JSON.parse(raw);
      received.push(parsed);
      return { jsonrpc: '2.0', id: parsed.id, result: { echo: parsed.params?.text || 'ok' } };
    }
  });
  transport.start();

  const outChunks = [];
  output.on('data', (c) => outChunks.push(c));

  const frame1 = encodeContentLengthFrame({ jsonrpc: '2.0', id: 1, method: 'ping', params: { text: '你好 MCP 🚀' } });
  const frame2 = encodeContentLengthFrame({ jsonrpc: '2.0', id: 2, method: 'ping', params: { text: 'second' } });
  const combined = Buffer.concat([frame1, frame2]);

  // Split right inside multi-byte UTF-8 and header boundaries
  input.write(combined.subarray(0, 18));
  input.write(combined.subarray(18, 95));
  input.write(combined.subarray(95));
  input.end();

  await transport.closed;
  assert.equal(received.length, 2);

  const parsedOut = parseContentLengthFrames(Buffer.concat(outChunks));
  assert.equal(parsedOut.remaining.length, 0);
  assert.deepEqual(parsedOut.messages, [
    { jsonrpc: '2.0', id: 1, result: { echo: '你好 MCP 🚀' } },
    { jsonrpc: '2.0', id: 2, result: { echo: 'second' } }
  ]);
});

test('spawned node src/mcp/server.js handles full MCP lifecycle over stdio in local mode', async (t) => {
  const tmpDir = makeTempDir('tm-mcp-spawn-local-');
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const todayPeriod = resolveReportPeriod('daily', 'current', { timeZone: 'UTC' });
  const todayKey = todayPeriod.key;
  const dataFile = path.join(tmpDir, 'devices.json');
  const reportsDir = path.join(tmpDir, 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });
  fs.writeFileSync(dataFile, JSON.stringify(createSampleDevicesStore(todayKey, todayPeriod.previousPeriodKey), null, 2));
  fs.writeFileSync(
    path.join(reportsDir, 'daily-snapshots.json'),
    JSON.stringify(createSampleDailySnapshots(todayKey, todayPeriod.previousPeriodKey), null, 2)
  );

  const child = spawn(process.execPath, [
    MCP_SERVER_ENTRY,
    '--data-file', dataFile,
    '--reports-dir', reportsDir,
    '--time-zone', 'UTC'
  ], {
    cwd: REPO_ROOT,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let stderrData = '';
  child.stderr.on('data', (c) => { stderrData += c.toString('utf8'); });

  const stdoutPass = new PassThrough();
  child.stdout.pipe(stdoutPass);

  const exitPromise = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code, signal) => resolve({ code, signal }));
  });

  const waitMsgs = collectNdjsonMessages(stdoutPass, (msgs) => msgs.length >= 10, 8000);
  const calls = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'generate_usage_report', arguments: { granularity: 'daily', periodKey: todayKey } } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'list_usage_reports', arguments: { granularity: 'daily' } } },
    { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'get_usage_report', arguments: { granularity: 'daily', periodKey: todayKey, format: 'json' } } },
    { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'analyze_project_usage', arguments: { granularity: 'daily', periodKey: todayKey, project: 'token-monitor' } } },
    { jsonrpc: '2.0', id: 7, method: 'resources/list' },
    { jsonrpc: '2.0', id: 8, method: 'resources/read', params: { uri: 'report://latest/daily' } },
    { jsonrpc: '2.0', id: 9, method: 'prompts/list' },
    { jsonrpc: '2.0', id: 10, method: 'prompts/get', params: { name: 'analyze-daily-report', arguments: { periodKey: todayKey } } }
  ];

  for (const call of calls) {
    child.stdin.write(`${JSON.stringify(call)}\n`);
  }
  child.stdin.end();

  const msgs = await waitMsgs;
  const exitResult = await exitPromise;

  assert.equal(exitResult.code, 0, `unexpected exit: ${JSON.stringify(exitResult)}, stderr: ${stderrData}`);
  assert.equal(stderrData, '');
  assert.equal(msgs.length, 10);
  assert.deepEqual(msgs.map((m) => m.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

  assert.equal(JSON.parse(msgs[2].result.content[0].text).reports[0].periodKey, todayKey);
  assert.equal(JSON.parse(msgs[3].result.content[0].text).reports.length, 1);
  assert.equal(JSON.parse(msgs[4].result.content[0].text).schema, REPORT_SCHEMA);
  assert.equal(JSON.parse(msgs[5].result.content[0].text).projects[0].key, 'token-monitor');
  assert.equal(msgs[6].result.resources.length, 9);
  assert.equal(JSON.parse(msgs[7].result.contents[0].text).reportId, `daily:${todayKey}`);
  assert.equal(msgs[8].result.prompts.length, 8);
  assert.match(msgs[9].result.messages[0].content.text, new RegExp(todayKey));
});

test('spawned node src/mcp/server.js works against Hub HTTP API using Content-Length framing', async (t) => {
  const todayKey = resolveReportPeriod('daily', 'current', { timeZone: 'UTC' }).key;
  const sampleReport = buildUsageReport({
    granularity: 'daily',
    periodKey: todayKey,
    devices: Object.values(createSampleDevicesStore(todayKey, '2026-11-15').devices),
    now: `${todayKey}T12:00:00Z`,
    timeZone: 'UTC'
  });

  const mockHub = http.createServer((req, res) => {
    if (req.headers.authorization !== 'Bearer spawn-secret') {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(renderReportJson({ ok: true, report: sampleReport }));
  });
  await new Promise((resolve) => mockHub.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => mockHub.close(resolve)));

  const addr = /** @type {import('node:net').AddressInfo} */ (mockHub.address());
  const child = spawn(process.execPath, [
    MCP_SERVER_ENTRY,
    '--hub-url', `http://127.0.0.1:${addr.port}`,
    '--secret', 'spawn-secret'
  ], {
    cwd: REPO_ROOT,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  const outChunks = [];
  child.stdout.on('data', (c) => outChunks.push(c));
  const exitPromise = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code, signal) => resolve({ code, signal }));
  });

  child.stdin.write(encodeContentLengthFrame({
    jsonrpc: '2.0',
    id: 'lsp-1',
    method: 'tools/call',
    params: { name: 'get_usage_report', arguments: { granularity: 'daily', periodKey: todayKey, format: 'json' } }
  }));
  child.stdin.end();

  const exitResult = await exitPromise;
  assert.equal(exitResult.code, 0);

  const parsed = parseContentLengthFrames(Buffer.concat(outChunks));
  assert.equal(parsed.remaining.length, 0);
  assert.equal(parsed.messages.length, 1);
  assert.equal(parsed.messages[0].id, 'lsp-1');
  assert.equal(JSON.parse(parsed.messages[0].result.content[0].text).reportId, `daily:${todayKey}`);
});

test('createLocalBackendAdapter returns structured error on invalid generateReport params and rejects unsafe disk periodKey', async (t) => {
  const tmpDir = makeTempDir('tm-mcp-guard-');
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const dataFile = path.join(tmpDir, 'devices.json');
  const reportsDir = path.join(tmpDir, 'reports');
  const dailyDir = path.join(reportsDir, 'daily');
  fs.mkdirSync(dailyDir, { recursive: true });
  fs.writeFileSync(dataFile, JSON.stringify({ version: 1, devices: {} }));
  fs.writeFileSync(path.join(tmpDir, 'outside.md'), 'SECRET_OUTSIDE');

  // Untrusted JSON attempting path traversal via period.key and non-matching filename
  fs.writeFileSync(path.join(dailyDir, '2026-11-10.json'), JSON.stringify({
    schema: REPORT_SCHEMA,
    reportId: 'daily:2026-11-10',
    granularity: 'daily',
    period: { key: '../../outside', startDate: '2026-11-10', endDate: '2026-11-10' },
    summary: { totalTokens: 100 }
  }));
  fs.writeFileSync(path.join(dailyDir, 'weird-name.json'), JSON.stringify({
    schema: REPORT_SCHEMA,
    period: { key: '2026-11-11' },
    summary: { totalTokens: 100 }
  }));
  fs.writeFileSync(path.join(dailyDir, '2026-11-12.json'), JSON.stringify({
    schema: REPORT_SCHEMA,
    reportId: 'daily:2026-11-12',
    granularity: 'daily',
    period: { key: '2026-11-12', label: '2026-11-12', startDate: '2026-11-12', endDate: '2026-11-12' },
    summary: { totalTokens: 500, knownCostUsd: 0.01, projectCount: 0 }
  }));

  const adapter = createLocalBackendAdapter({ dataFile, reportsDir, timeZone: 'UTC' });

  const badKeyRes = await adapter.generateReport({ granularity: 'daily', periodKey: 'not-a-date' });
  assert.equal(badKeyRes.ok, false);
  assert.match(badKeyRes.error, /Invalid daily periodKey/);

  const badTzRes = await adapter.generateReport({ timeZone: 'Invalid/Timezone' });
  assert.equal(badTzRes.ok, false);
  assert.match(badTzRes.error, /Invalid IANA timeZone/);

  const listed = await adapter.listReports({ granularity: 'daily' });
  assert.equal(listed.ok, true);
  assert.deepEqual(listed.reports.map((r) => r.periodKey), ['2026-11-12']);
  assert.equal(listed.reports[0].files.markdown, null);
});

test('Local Store direct mode serves all 9 query tools, 6 live resources, 3 prompts, and session privacy gates', async (t) => {
  const tmpDir = makeTempDir('tm-mcp-local-queries-');
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const now = new Date();
  const todayKey = now.toISOString().slice(0, 10);
  const yesterdayKey = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);

  const store = createSampleDevicesStore(todayKey, yesterdayKey);
  store.devices['dev-laptop'].periods.today.sessions['claude:s1'].title = 'Confidential Sprint Planning';
  store.devices['dev-laptop'].periods.today.sessions['claude:s1'].liveState = 'running';
  store.devices['dev-laptop'].limits = {
    providers: [{
      provider: 'codex',
      accountLabel: 'Main Codex',
      accountEmail: 'private@example.com',
      status: 'ok',
      stale: false,
      windows: [{ label: 'Session', usedPercent: 25, remainingPercent: 75 }]
    }]
  };

  const dataFile = path.join(tmpDir, 'devices.json');
  const reportsDir = path.join(tmpDir, 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });
  fs.writeFileSync(dataFile, JSON.stringify(store));
  fs.writeFileSync(path.join(tmpDir, 'subscriptions.json'), JSON.stringify({
    subscriptions: [{
      id: 'sub-local-1',
      provider: 'claude',
      kind: 'subscription',
      planName: 'Claude Pro',
      amountMinor: 2000,
      currency: 'USD',
      interval: 'monthly',
      startDate: '2026-01-01',
      autoRenew: true
    }]
  }));

  const writeIntegrationsPrivacy = (openclawPatch) => {
    fs.writeFileSync(path.join(reportsDir, 'integrations.json'), JSON.stringify({
      openclaw: {
        enabled: true,
        ...openclawPatch
      }
    }));
  };

  writeIntegrationsPrivacy({
    sessionTitlesEnabled: false,
    queryPermissions: { allowSessionDetail: false, allowConversationText: false }
  });

  const input = new PassThrough();
  const output = new PassThrough();
  const stderr = new PassThrough();

  const server = startMcpServer({
    mode: 'local',
    dataFile,
    reportsDir,
    timeZone: 'UTC',
    input,
    output,
    stderr,
    liveRateSnapshot: {
      state: 'live',
      sampledAt: Date.now(),
      expiresAt: Date.now() + 30_000,
      speed: 77.5,
      burn: 42,
      deviceCount: 1
    },
    readSessionDetail: async ({ client, sessionId }) => ({
      found: true,
      client,
      sessionId,
      projectLabel: 'token-monitor',
      title: 'Confidential Sprint Planning',
      exchanges: [{ promptPreview: 'Implement query tools', tools: ['edit_file'], turnCount: 1 }],
      conversation: { messages: [{ role: 'user', text: 'Raw prompt text' }] }
    }),
    getLimitsHistory: async () => ({
      accountEmail: 'private@example.com',
      series: [{ ts: new Date().toISOString(), remainingPercent: 75 }]
    }),
    getServiceStatus: async () => ({
      overall: 'operational',
      providers: [{ id: 'anthropic', status: 'operational' }]
    }),
    getCodexResetForecast: async () => ({ status: 'active', scheduledResetType: 'weekly' }),
    listApprovalAlerts: async () => ({
      ok: true,
      alerts: [{ id: 'alert-local-1', client: 'claude', tool: 'run_command' }]
    })
  });
  t.after(async () => {
    input.end();
    await server.stop();
  });

  const waitBatch1 = collectNdjsonMessages(output, (msgs) => msgs.length >= 17);
  const requests1 = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', clientInfo: { name: 'test', version: '1.0' } } },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'query_usage_breakdown', arguments: { period: 'today', groupBy: 'client' } } },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_sessions', arguments: { period: 'today', state: 'all' } } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_session_detail', arguments: { client: 'claude', sessionId: 's1' } } },
    { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'get_usage_history', arguments: { resolution: 'daily' } } },
    { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'get_devices_and_health', arguments: {} } },
    { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'get_limits_history', arguments: { includeHistory: true } } },
    { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'get_subscriptions_and_forecasts', arguments: {} } },
    { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'get_live_token_rate', arguments: {} } },
    { jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'get_service_status_and_approvals', arguments: {} } },
    { jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'push_to_openclaw', arguments: { type: 'test' } } },
    { jsonrpc: '2.0', id: 12, method: 'resources/read', params: { uri: 'usage://today' } },
    { jsonrpc: '2.0', id: 13, method: 'resources/read', params: { uri: 'sessions://active' } },
    { jsonrpc: '2.0', id: 14, method: 'resources/read', params: { uri: 'limits://current' } },
    { jsonrpc: '2.0', id: 15, method: 'resources/read', params: { uri: 'devices://health' } },
    { jsonrpc: '2.0', id: 16, method: 'resources/read', params: { uri: 'subscriptions://summary' } },
    { jsonrpc: '2.0', id: 17, method: 'resources/read', params: { uri: 'service-status://current' } }
  ];
  for (const msg of requests1) {
    input.write(`${JSON.stringify(msg)}\n`);
  }
  const res1 = await waitBatch1;
  const byId = new Map(res1.map((m) => [m.id, m]));

  assert.equal(byId.get(2).result.structuredContent.totals.totalTokens, 120000);
  const listedSessions = byId.get(3).result.structuredContent.sessions;
  assert.equal(listedSessions.length, 2);
  assert.equal(listedSessions[0].title, null);
  assert.equal(byId.get(4).result.isError, true);
  assert.match(byId.get(4).result.content[0].text, /session_detail_disabled/);
  assert.equal(byId.get(5).result.structuredContent.ok, true);
  assert.equal(byId.get(6).result.structuredContent.deviceCount, 1);
  assert.equal(byId.get(7).result.structuredContent.limitsHistory.available, true);
  assert.equal(JSON.stringify(byId.get(7)).includes('private@example.com'), false);
  assert.equal(byId.get(8).result.structuredContent.activeCount, 1);
  assert.equal(byId.get(9).result.structuredContent.speed, 77.5);
  assert.equal(byId.get(10).result.structuredContent.serviceStatus.available, true);
  assert.equal(byId.get(10).result.structuredContent.approvalAlerts.alerts[0].id, 'alert-local-1');
  assert.equal(byId.get(11).result.isError, true);
  assert.match(byId.get(11).result.content[0].text, /Hub HTTP mode/);

  assert.equal(JSON.parse(byId.get(12).result.contents[0].text).totals.totalTokens, 120000);
  assert.equal(JSON.parse(byId.get(13).result.contents[0].text).sessions.length, 2);
  assert.equal(JSON.parse(byId.get(14).result.contents[0].text).providers.length, 1);
  assert.equal(JSON.parse(byId.get(15).result.contents[0].text).deviceCount, 1);
  assert.equal(JSON.parse(byId.get(16).result.contents[0].text).activeCount, 1);
  assert.equal(JSON.parse(byId.get(17).result.contents[0].text).serviceStatus.overall, 'operational');

  // Enable session detail only -> conversation text still blocked, title stripped
  writeIntegrationsPrivacy({
    sessionTitlesEnabled: false,
    queryPermissions: { allowSessionDetail: true, allowConversationText: false }
  });
  const waitBatch2 = collectNdjsonMessages(output, (msgs) => msgs.length >= 5);
  for (const msg of [
    { jsonrpc: '2.0', id: 18, method: 'tools/call', params: { name: 'get_session_detail', arguments: { client: 'claude', sessionId: 's1', includeConversation: true } } },
    { jsonrpc: '2.0', id: 19, method: 'tools/call', params: { name: 'get_session_detail', arguments: { client: 'claude', sessionId: 's1', includeConversation: false } } },
    { jsonrpc: '2.0', id: 20, method: 'prompts/get', params: { name: 'session-summary', arguments: { sessionId: 's1', client: 'claude', period: 'today' } } },
    { jsonrpc: '2.0', id: 21, method: 'prompts/get', params: { name: 'quota-check', arguments: { provider: 'codex', includeHistory: 'true' } } },
    { jsonrpc: '2.0', id: 22, method: 'prompts/get', params: { name: 'daily-standup-usage', arguments: { date: todayKey } } }
  ]) {
    input.write(`${JSON.stringify(msg)}\n`);
  }
  const res2 = await waitBatch2;
  const byId2 = new Map(res2.map((m) => [m.id, m]));
  assert.equal(byId2.get(18).result.isError, true);
  assert.match(byId2.get(18).result.content[0].text, /conversation_text_disabled/);
  const detailNoConv = byId2.get(19).result.structuredContent;
  assert.equal(detailNoConv.ok, true);
  assert.equal(detailNoConv.title, undefined);
  assert.equal(detailNoConv.conversation, undefined);
  assert.equal(detailNoConv.exchanges.length, 1);
  assert.match(byId2.get(20).result.messages[0].content.text, /get_session_detail/);
  assert.match(byId2.get(21).result.messages[0].content.text, /get_limits_history/);
  assert.match(byId2.get(22).result.messages[0].content.text, new RegExp(todayKey));

  // Enable both conversation text and titles
  writeIntegrationsPrivacy({
    sessionTitlesEnabled: true,
    queryPermissions: { allowSessionDetail: true, allowConversationText: true }
  });
  const waitBatch3 = collectNdjsonMessages(output, (msgs) => msgs.length >= 1);
  input.write(`${JSON.stringify({
    jsonrpc: '2.0',
    id: 23,
    method: 'tools/call',
    params: { name: 'get_session_detail', arguments: { client: 'claude', sessionId: 's1', includeConversation: true } }
  })}\n`);
  const [res3] = await waitBatch3;
  assert.equal(res3.result.structuredContent.ok, true);
  assert.equal(res3.result.structuredContent.title, 'Confidential Sprint Planning');
  assert.equal(res3.result.structuredContent.conversation.messages[0].text, 'Raw prompt text');
});

test('Hub HTTP API mode forwards all 9 query tools, push_to_openclaw, and preserves HTTP 403 privacy errors', async (t) => {
  const { createHub } = require('../../src/hub/server');
  const tmpDir = makeTempDir('tm-mcp-hub-queries-');
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const now = new Date();
  const todayKey = now.toISOString().slice(0, 10);
  const webhookPosts = [];

  const hub = createHub({
    port: 0,
    host: '127.0.0.1',
    secret: 'mcp-hub-secret',
    approvalAlerts: true,
    dataFile: path.join(tmpDir, 'devices.json'),
    reportsDir: path.join(tmpDir, 'reports'),
    integrationFetch: async (url, init) => {
      webhookPosts.push({ url: String(url), body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
    getEnhancedQueryContext: () => ({
      sessionTitlesEnabled: false,
      liveRateSnapshot: {
        state: 'live',
        sampledAt: Date.now(),
        expiresAt: Date.now() + 30_000,
        speed: 91.2,
        burn: 15,
        deviceCount: 1
      },
      readSessionDetail: async ({ client, sessionId }) => ({
        found: true,
        client,
        sessionId,
        exchanges: [{ promptPreview: 'Hub turn', tools: ['read_file'], turnCount: 1 }],
        conversation: { messages: [{ role: 'user', text: 'Hub conversation' }] }
      }),
      getLimitsHistory: async () => ({ series: [{ ts: new Date().toISOString(), remainingPercent: 50 }] }),
      getServiceStatus: async () => ({ overall: 'operational', providers: [{ id: 'openai', status: 'operational' }] }),
      getCodexResetForecast: async () => ({ status: 'active', scheduledResetType: 'weekly' })
    }),
    logger: { error() {}, warn() {}, log() {} }
  });

  await hub.start();
  t.after(() => hub.stop());
  const baseUrl = `http://127.0.0.1:${hub.server.address().port}`;
  const auth = { authorization: 'Bearer mcp-hub-secret', 'content-type': 'application/json' };

  const store = createSampleDevicesStore(todayKey, todayKey);
  await fetch(`${baseUrl}/api/ingest`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify(store.devices['dev-laptop'])
  });
  const putIntegrations = await fetch(`${baseUrl}/api/reports/integrations`, {
    method: 'PUT',
    headers: auth,
    body: JSON.stringify({
      openclaw: {
        enabled: true,
        mode: 'generic-webhook',
        webhookUrl: 'https://oc.mock.local/hooks/agent',
        hookToken: 'mcp-oc-tok',
        queryPermissions: { allowSessionDetail: false, allowConversationText: false }
      }
    })
  });
  assert.equal(putIntegrations.status, 200);
  const alertPostRes = await fetch(`${baseUrl}/api/approval-alerts`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ deviceId: 'dev-laptop', client: 'codex', sessionId: 's1', tool: 'run_command', command: 'ls' })
  });
  assert.equal(alertPostRes.status, 200);
  const alertPostData = await alertPostRes.json();
  assert.equal(alertPostData.ok, true);

  const input = new PassThrough();
  const output = new PassThrough();
  const stderr = new PassThrough();
  const server = startMcpServer({
    mode: 'hub',
    hubUrl: baseUrl,
    secret: 'mcp-hub-secret',
    input,
    output,
    stderr
  });
  t.after(async () => {
    input.end();
    await server.stop();
  });

  const waitRes = collectNdjsonMessages(output, (msgs) => msgs.length >= 11);
  for (const msg of [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', clientInfo: { name: 'test', version: '1.0' } } },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'query_usage_breakdown', arguments: { period: 'today', groupBy: 'model' } } },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_sessions', arguments: { period: 'today' } } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_session_detail', arguments: { client: 'claude', sessionId: 's1' } } },
    { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'get_usage_history', arguments: { resolution: 'daily' } } },
    { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'get_devices_and_health', arguments: {} } },
    { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'get_limits_history', arguments: { includeHistory: true } } },
    { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'get_live_token_rate', arguments: {} } },
    { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'get_service_status_and_approvals', arguments: {} } },
    { jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'push_to_openclaw', arguments: { type: 'usage', params: { period: 'today' } } } },
    { jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'get_subscriptions_and_forecasts', arguments: {} } }
  ]) {
    input.write(`${JSON.stringify(msg)}\n`);
  }

  const msgs = await waitRes;
  const byId = new Map(msgs.map((m) => [m.id, m]));
  assert.equal(byId.get(2).result.structuredContent.totals.totalTokens, 120000);
  assert.equal(byId.get(3).result.structuredContent.sessions.length, 2);
  assert.equal(byId.get(4).result.isError, true);
  assert.match(byId.get(4).result.content[0].text, /session_detail_disabled/);
  assert.equal(byId.get(5).result.structuredContent.ok, true);
  assert.equal(byId.get(6).result.structuredContent.deviceCount, 1);
  assert.equal(byId.get(7).result.structuredContent.limitsHistory.available, true);
  assert.equal(byId.get(8).result.structuredContent.speed, 91.2);
  assert.equal(byId.get(9).result.structuredContent.serviceStatus.overall, 'operational');
  assert.equal(byId.get(9).result.structuredContent.approvalAlerts.alerts.length, 1);
  assert.equal(byId.get(10).result.structuredContent.ok, true);
  assert.equal(byId.get(10).result.structuredContent.eventType, 'query_digest');
  assert.equal(byId.get(11).result.structuredContent.ok, true);
  assert.ok(webhookPosts.some((p) => p.body.event === 'token_monitor.query_digest'));

  // Remote HTTP PUT cannot escalate queryPermissions; host-side config update enables allowSessionDetail.
  await fetch(`${baseUrl}/api/reports/integrations`, {
    method: 'PUT',
    headers: auth,
    body: JSON.stringify({ openclaw: { queryPermissions: { allowSessionDetail: true, allowConversationText: true } } })
  });
  hub.updateIntegrationsConfig(
    { openclaw: { queryPermissions: { allowSessionDetail: true, allowConversationText: false } } },
    { allowQueryPermissionMutation: true }
  );
  const waitConvDenied = collectNdjsonMessages(output, (m) => m.length >= 1);
  input.write(`${JSON.stringify({
    jsonrpc: '2.0',
    id: 12,
    method: 'tools/call',
    params: { name: 'get_session_detail', arguments: { client: 'claude', sessionId: 's1', includeConversation: true } }
  })}\n`);
  const [convDenied] = await waitConvDenied;
  assert.equal(convDenied.result.isError, true);
  assert.match(convDenied.result.content[0].text, /conversation_text_disabled/);
});
