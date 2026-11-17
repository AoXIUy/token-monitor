'use strict';

const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const { promisify } = require('node:util');

const {
  CORE_SOURCE_FILES,
  NODE_RUNTIME_SOURCE_FILES,
  WORKER_SHARED_MODULES
} = require('../../scripts/hub-build-manifest');

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CLI_PATH = path.join(REPO_ROOT, 'skills', 'openclaw-token-monitor', 'scripts', 'query-token-monitor.mjs');

/**
 * Execute the Skill CLI script with custom argv and environment variables.
 * @param {string[]} args
 * @param {Record<string, string | undefined>} [envOverrides]
 */
async function runCli(args, envOverrides = {}) {
  const env = { ...process.env };
  delete env.TOKEN_MONITOR_HUB_URL;
  delete env.TOKEN_MONITOR_LOCAL_BRIDGE_URL;
  delete env.TOKEN_MONITOR_HUB_SECRET;
  delete env.TOKEN_MONITOR_SECRET;
  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }

  try {
    const res = await execFileAsync(process.execPath, [CLI_PATH, ...args], {
      cwd: REPO_ROOT,
      env,
      timeout: 10_000
    });
    return { code: 0, stdout: res.stdout, stderr: res.stderr };
  } catch (err) {
    return {
      code: typeof err.code === 'number' ? err.code : 1,
      stdout: String(err.stdout || ''),
      stderr: String(err.stderr || '')
    };
  }
}

/**
 * Resolve transitive local `require('./...')` dependencies under `src/`.
 * @param {string[]} entryFiles
 * @returns {string[]}
 */
function resolveTransitiveLocalDeps(entryFiles) {
  const visited = new Set();
  const queue = [...entryFiles];
  const requireRe = /\brequire\(\s*['"](\.[^'"]+)['"]\s*\)/g;

  while (queue.length > 0) {
    const file = queue.pop();
    if (!file || visited.has(file)) continue;
    visited.add(file);
    if (file.endsWith('.json')) continue;

    const abs = path.join(REPO_ROOT, file);
    const source = fs.readFileSync(abs, 'utf8');
    let match;
    while ((match = requireRe.exec(source)) !== null) {
      const targetBase = path.resolve(path.dirname(abs), match[1]);
      const candidates = path.extname(targetBase)
        ? [targetBase]
        : [`${targetBase}.js`, `${targetBase}.json`, path.join(targetBase, 'index.js')];
      const resolved = candidates.find((cand) => fs.existsSync(cand) && fs.statSync(cand).isFile());
      assert.ok(resolved, `cannot resolve ${match[1]} required by ${file}`);
      const rel = path.relative(REPO_ROOT, resolved).split(path.sep).join('/');
      if (!visited.has(rel)) queue.push(rel);
    }
  }
  return [...visited].sort();
}

test('OpenClaw Skill CLI executes all query, legacy, push, and privacy-gate flows against Hub HTTP API', async (t) => {
  /** @type {Array<{ method: string, pathname: string, searchParams: URLSearchParams, auth: string | undefined, body: any }>} */
  const requests = [];
  let detailGateMode = 'allow'; // 'allow' | 'detail_disabled' | 'conversation_disabled'

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf8');
      const body = rawBody ? JSON.parse(rawBody) : null;
      const parsedUrl = new URL(req.url || '/', 'http://127.0.0.1');
      requests.push({
        method: req.method || '',
        pathname: parsedUrl.pathname,
        searchParams: parsedUrl.searchParams,
        auth: req.headers.authorization,
        body
      });

      const authHeader = req.headers.authorization;
      if (authHeader !== 'Bearer test-hub-secret' && authHeader !== 'Bearer legacy-secret' && authHeader !== 'Bearer cli-secret') {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }

      if (req.method === 'GET' && parsedUrl.pathname === '/api/query/usage') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          period: {
            id: parsedUrl.searchParams.get('period') || 'today',
            key: '2026-11-17',
            label: '2026-11-17',
            startDate: '2026-11-17',
            endDate: '2026-11-17',
            deviceId: parsedUrl.searchParams.get('deviceId') || null,
            deviceFound: true,
            available: true,
            incomplete: false
          },
          groupBy: parsedUrl.searchParams.get('groupBy') || 'summary',
          totals: {
            totalTokens: 125_000,
            knownCostUsd: 1.45,
            unpricedTokens: 0,
            inputTokens: 50_000,
            outputTokens: 25_000,
            cacheReadTokens: 45_000,
            cacheWriteTokens: 5_000,
            cacheHitRatePct: 45.0,
            avgOutputTokensPerSec: 38.4
          },
          totalRows: 1,
          truncated: false,
          rows: [
            {
              model: 'gpt-5',
              totalTokens: 125_000,
              knownCostUsd: 1.45,
              tokenSharePct: 100,
              avgOutputTokensPerSec: 38.4
            }
          ]
        }));
        return;
      }

      if (req.method === 'GET' && parsedUrl.pathname === '/api/query/sessions') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          period: parsedUrl.searchParams.get('period') || 'today',
          state: parsedUrl.searchParams.get('state') || 'all',
          sessionTitlesEnabled: false,
          total: 2,
          hasMore: true,
          nextCursor: 'cur_next_2',
          sessions: [
            {
              key: 'codex:s1',
              sessionId: 's1',
              client: 'codex',
              title: null,
              projectLabel: 'token-monitor',
              activityState: 'running',
              latestModel: 'gpt-5',
              totalTokens: 84_000,
              costUsd: 0.92,
              context: { percentLeft: 76 }
            }
          ]
        }));
        return;
      }

      if (req.method === 'GET' && parsedUrl.pathname === '/api/query/session-detail') {
        if (detailGateMode === 'detail_disabled') {
          res.writeHead(403, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'session_detail_disabled', message: 'Session detail disabled' }));
          return;
        }
        if (detailGateMode === 'conversation_disabled' && parsedUrl.searchParams.get('includeConversation') === 'true') {
          res.writeHead(403, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'conversation_text_disabled', message: 'Conversation text disabled' }));
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          found: true,
          client: parsedUrl.searchParams.get('client'),
          sessionId: parsedUrl.searchParams.get('sessionId'),
          title: null,
          totals: { totalTokens: 18_500, costUsd: 0.24 },
          exchanges: [
            { prompt: 'Fix OpenClaw query handler', tools: ['read_file', 'edit_file'], tokens: { total: 18_500 } }
          ],
          ...(parsedUrl.searchParams.get('includeConversation') === 'true'
            ? { conversation: { messages: [{ role: 'user', text: 'Please check limits' }] } }
            : {})
        }));
        return;
      }

      if (req.method === 'GET' && parsedUrl.pathname === '/api/query/history') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          resolution: parsedUrl.searchParams.get('resolution') || 'daily',
          groupBy: parsedUrl.searchParams.get('groupBy') || 'none',
          range: { from: '2026-11-10', to: '2026-11-17' },
          activeDays: 6,
          streaks: { currentStreak: 4, longestStreak: 12 },
          peakDay: { date: '2026-11-16', totalTokens: 210_000 },
          totals: { totalTokens: 650_000, knownCostUsd: 7.8, favoriteModel: 'claude-sonnet-4-5' },
          rows: [{ date: '2026-11-17', tokens: 125_000, costUsd: 1.45 }],
          breakdown: null
        }));
        return;
      }

      if (req.method === 'GET' && parsedUrl.pathname === '/api/query/devices') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          deviceCount: 1,
          activeDeviceCount: 1,
          staleDeviceCount: 0,
          devices: [
            {
              deviceId: 'mac-1',
              hostname: 'MacBook-Pro',
              osName: 'macOS',
              osVersion: '15.2',
              stale: false,
              trackedClients: ['codex', 'claude'],
              clientHealthSummary: { attention: 0 },
              wslStatus: { state: 'disabled' }
            }
          ]
        }));
        return;
      }

      if (req.method === 'GET' && parsedUrl.pathname === '/api/query/limits') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          totalAccounts: 1,
          healthyAccounts: 1,
          providers: [
            {
              provider: 'thirdparty',
              providerLabel: 'Third-party API',
              adapterId: 'newapi-account',
              label: 'Team Relay',
              accountEmail: 'hidden@example.com',
              isThirdParty: true,
              status: 'ok',
              stale: false,
              balance: { amount: 42.5, currency: 'USD', monthSpend: 12.0, formattedAmount: '$42.50' },
              windows: [{ label: 'Quota', remainingPercent: 78.0, resetsInMs: 7_200_000 }]
            }
          ],
          ...(parsedUrl.searchParams.get('includeHistory') === 'true'
            ? { history: [{ recordedAt: '2026-11-17T01:00:00Z', windowName: '5h', remainingPercent: 80 }] }
            : {})
        }));
        return;
      }

      if (req.method === 'GET' && parsedUrl.pathname === '/api/query/subscriptions') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          activeCount: 1,
          totalCount: 1,
          monthlyTotalUsd: 20,
          subscriptions: [
            {
              provider: 'codex',
              providerLabel: 'Codex',
              planName: 'Plus',
              amountUnits: 20,
              currency: 'USD',
              nextRenewalDate: '2026-12-01',
              daysUntilRenewal: 14,
              forecast: { status: 'available', dailyBurn: 1.5, daysRemaining: 10, exhaustDate: '2026-11-27', balanceCurrency: 'USD' }
            }
          ]
        }));
        return;
      }

      if (req.method === 'GET' && parsedUrl.pathname === '/api/query/live-rate') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          state: 'live',
          reason: null,
          speed: { outputTokensPerSec: 64.2 },
          burn: { costPerHour: 0.48 },
          deviceCount: 1,
          fallbackAvgOutputTokensPerSec: 32.0
        }));
        return;
      }

      if (req.method === 'GET' && parsedUrl.pathname === '/api/query/service-status') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          serviceStatus: {
            providers: [{ id: 'openai', name: 'OpenAI', status: 'operational' }]
          },
          codexResetForecast: { status: 'active', chancePercent: 72, scheduledFor: '2026-11-17T06:00:00Z' },
          approvals: { alerts: [] }
        }));
        return;
      }

      if (req.method === 'GET' && parsedUrl.pathname === '/api/approval-alerts') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          alerts: [
            {
              id: 'alert-1',
              client: 'codex',
              deviceName: 'MacBook-Pro',
              projectLabel: 'token-monitor',
              tool: 'exec_command',
              command: 'npm test'
            }
          ]
        }));
        return;
      }

      if (req.method === 'GET' && parsedUrl.pathname === '/api/integrations/openclaw/brief') {
        const fmt = parsedUrl.searchParams.get('format') || 'json';
        if (fmt === 'text') {
          res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('📊 Token Monitor 日报\n• 总用量：125K tokens');
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, text: '📊 Token Monitor 日报' }));
        return;
      }

      if (req.method === 'GET' && parsedUrl.pathname === '/api/reports') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          reports: [{ reportId: 'weekly:2026-W47', startDate: '2026-11-16', endDate: '2026-11-22', totalTokens: 500_000, knownCostUsd: 5.5 }]
        }));
        return;
      }

      if (req.method === 'GET' && parsedUrl.pathname === '/api/reports/weekly/latest') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, report: { reportId: 'weekly:2026-W47', summary: { totalTokens: 500_000 } } }));
        return;
      }

      if (req.method === 'POST' && parsedUrl.pathname === '/api/mcp') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: body?.id ?? 1,
          result: { structuredContent: { today: { totalTokens: 125_000, knownCostUsd: 1.45 }, limits: { providers: [] } } }
        }));
        return;
      }

      if (req.method === 'POST' && parsedUrl.pathname === '/api/reports/ai-analyze') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, aiAnalysis: { summaryMarkdown: 'AI结论：缓存命中率良好。' } }));
        return;
      }

      if (req.method === 'POST' && parsedUrl.pathname === '/api/reports/push') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, eventType: 'report', mode: 'openclaw-agent', channel: 'openclaw-weixin' }));
        return;
      }

      if (req.method === 'POST' && parsedUrl.pathname === '/api/integrations/openclaw/push') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          eventType: body?.test ? 'test' : (body?.type === 'custom' ? 'custom' : 'query_digest'),
          mode: 'openclaw-agent',
          channel: 'openclaw-weixin'
        }));
        return;
      }

      if (req.method === 'GET' && parsedUrl.pathname === '/api/integrations/openclaw/history') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          count: 1,
          lastPush: { at: '2026-11-17T02:00:00Z', ok: true, eventType: 'session_completed' },
          history: [{ id: 'h1', at: '2026-11-17T02:00:00Z', eventType: 'session_completed', ok: true, summary: 'codex finished' }]
        }));
        return;
      }

      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found' }));
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const addr = /** @type {import('node:net').AddressInfo} */ (server.address());
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  const defaultEnv = {
    TOKEN_MONITOR_HUB_URL: baseUrl,
    TOKEN_MONITOR_HUB_SECRET: 'test-hub-secret'
  };

  await t.test('--help prints usage and exits 0', async () => {
    const res = await runCli(['--help']);
    assert.equal(res.code, 0);
    assert.match(res.stdout, /TOKEN_MONITOR_HUB_URL/);
    assert.match(res.stdout, /TOKEN_MONITOR_HUB_SECRET/);
    assert.match(res.stdout, /session-detail/);
  });

  await t.test('normalizes loopback bridge /api/mcp URL and accepts legacy TOKEN_MONITOR_SECRET', async () => {
    requests.length = 0;
    const res = await runCli(['live-rate', '--format', 'json'], {
      TOKEN_MONITOR_HUB_URL: `${baseUrl}/api/mcp/`,
      TOKEN_MONITOR_SECRET: 'legacy-secret'
    });
    assert.equal(res.code, 0);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].pathname, '/api/query/live-rate');
    assert.equal(requests[0].auth, 'Bearer legacy-secret');
    assert.equal(JSON.parse(res.stdout).state, 'live');
  });

  await t.test('usage, today, and month subcommands pass expected query params and format WeChat text without tables', async () => {
    requests.length = 0;
    const usageText = await runCli(
      ['usage', '--period', 'last7', '--group-by', 'model', '--device', 'mac-1', '--limit', '10', '--format', 'text'],
      defaultEnv
    );
    assert.equal(usageText.code, 0);
    assert.equal(requests[0].pathname, '/api/query/usage');
    assert.equal(requests[0].searchParams.get('period'), 'last7');
    assert.equal(requests[0].searchParams.get('groupBy'), 'model');
    assert.equal(requests[0].searchParams.get('deviceId'), 'mac-1');
    assert.equal(requests[0].searchParams.get('limit'), '10');
    assert.match(usageText.stdout, /125K tokens/);
    assert.match(usageText.stdout, /gpt-5/);
    assert.doesNotMatch(usageText.stdout, /\|.*\|/);

    const todayJson = await runCli(['today', '--format', 'json'], defaultEnv);
    assert.equal(todayJson.code, 0);
    assert.equal(requests[1].searchParams.get('period'), 'today');

    const monthJson = await runCli(['month'], defaultEnv);
    assert.equal(monthJson.code, 0);
    assert.equal(requests[2].searchParams.get('period'), 'month');
    assert.equal(JSON.parse(monthJson.stdout).totals.totalTokens, 125_000);
  });

  await t.test('sessions, history, devices, limits, subscriptions, live-rate, service-status, and approvals work in text and json', async () => {
    requests.length = 0;

    const sessRes = await runCli([
      'sessions', '--period', 'today', '--state', 'running', '--client', 'codex',
      '--project', 'token-monitor', '--search', 'gpt', '--sort', 'totalTokens', '--limit', '5', '--cursor', 'cur_1', '--format', 'text'
    ], defaultEnv);
    assert.equal(sessRes.code, 0);
    assert.equal(requests.at(-1).pathname, '/api/query/sessions');
    assert.equal(requests.at(-1).searchParams.get('state'), 'running');
    assert.equal(requests.at(-1).searchParams.get('cursor'), 'cur_1');
    assert.match(sessRes.stdout, /token-monitor/);
    assert.match(sessRes.stdout, /cur_next_2/);
    assert.doesNotMatch(sessRes.stdout, /\|.*\|/);

    const histRes = await runCli(
      ['history', '--resolution', 'daily', '--from', '2026-11-10', '--to', '2026-11-17', '--group-by', 'client', '--limit', '20', '--format', 'text'],
      defaultEnv
    );
    assert.equal(histRes.code, 0);
    assert.equal(requests.at(-1).pathname, '/api/query/history');
    assert.equal(requests.at(-1).searchParams.get('from'), '2026-11-10');
    assert.match(histRes.stdout, /2026-11-16/);

    const devRes = await runCli(['devices', '--device', 'mac-1', '--no-diagnostics', '--format', 'text'], defaultEnv);
    assert.equal(devRes.code, 0);
    assert.equal(requests.at(-1).pathname, '/api/query/devices');
    assert.equal(requests.at(-1).searchParams.get('includeDiagnostics'), 'false');
    assert.match(devRes.stdout, /MacBook-Pro/);

    const limRes = await runCli([
      'limits', '--third-party-only', '--provider', 'thirdparty', '--status', 'ok',
      '--history', '--account-key', 'acc-1', '--window-name', '5h', '--hours', '24', '--format', 'text'
    ], defaultEnv);
    assert.equal(limRes.code, 0);
    assert.equal(requests.at(-1).pathname, '/api/query/limits');
    assert.equal(requests.at(-1).searchParams.get('thirdPartyOnly'), 'true');
    assert.equal(requests.at(-1).searchParams.get('includeHistory'), 'true');
    assert.equal(requests.at(-1).searchParams.get('hours'), '24');
    assert.match(limRes.stdout, /Team Relay/);
    assert.doesNotMatch(limRes.stdout, /hidden@example\.com/);

    const subRes = await runCli(['subscriptions', '--date', '2026-11-17', '--no-forecasts', '--active-only', '--format', 'text'], defaultEnv);
    assert.equal(subRes.code, 0);
    assert.equal(requests.at(-1).pathname, '/api/query/subscriptions');
    assert.equal(requests.at(-1).searchParams.get('includeForecasts'), 'false');
    assert.equal(requests.at(-1).searchParams.get('activeOnly'), 'true');
    assert.match(subRes.stdout, /Codex \(Plus\)/);

    const svcRes = await runCli(['service-status', '--no-reset-forecast', '--no-approvals', '--format', 'text'], defaultEnv);
    assert.equal(svcRes.code, 0);
    assert.equal(requests.at(-1).pathname, '/api/query/service-status');
    assert.equal(requests.at(-1).searchParams.get('includeResetForecast'), 'false');
    assert.equal(requests.at(-1).searchParams.get('includeApprovals'), 'false');
    assert.match(svcRes.stdout, /OpenAI/);

    const appRes = await runCli(['approvals', '--format', 'text'], defaultEnv);
    assert.equal(appRes.code, 0);
    assert.equal(requests.at(-1).pathname, '/api/approval-alerts');
    assert.match(appRes.stdout, /exec_command/);
  });

  await t.test('session-detail enforces required flags and handles 403 privacy gates cleanly', async () => {
    const missingArgs = await runCli(['session-detail', '--client', 'codex'], defaultEnv);
    assert.notEqual(missingArgs.code, 0);
    assert.match(missingArgs.stderr, /--session-id/);

    detailGateMode = 'detail_disabled';
    const deniedDetail = await runCli(['session-detail', '--client', 'codex', '--session-id', 's1'], defaultEnv);
    assert.notEqual(deniedDetail.code, 0);
    assert.match(deniedDetail.stderr, /403/);
    assert.match(deniedDetail.stderr, /allowSessionDetail/);

    detailGateMode = 'conversation_disabled';
    const deniedConv = await runCli(
      ['session-detail', '--client', 'codex', '--session-id', 's1', '--include-conversation'],
      defaultEnv
    );
    assert.notEqual(deniedConv.code, 0);
    assert.match(deniedConv.stderr, /403/);
    assert.match(deniedConv.stderr, /allowConversationText/);

    detailGateMode = 'allow';
    const allowedConv = await runCli(
      ['session-detail', '--client', 'codex', '--session-id', 's1', '--include-conversation', '--limit', '10', '--offset', '0', '--format', 'text'],
      defaultEnv
    );
    assert.equal(allowedConv.code, 0);
    assert.match(allowedConv.stdout, /Fix OpenClaw query handler/);
    assert.match(allowedConv.stdout, /Please check limits/);
  });

  await t.test('legacy brief/realtime/reports/ai-analyze/push and new push/push-history endpoints work', async () => {
    requests.length = 0;

    const briefRes = await runCli(['brief', '--granularity', 'daily', '--period', 'latest'], defaultEnv);
    assert.equal(briefRes.code, 0);
    assert.equal(requests.at(-1).pathname, '/api/integrations/openclaw/brief');
    assert.match(briefRes.stdout, /Token Monitor 日报/);

    const rtRes = await runCli(['realtime', '--third-party-only'], defaultEnv);
    assert.equal(rtRes.code, 0);
    assert.equal(requests.at(-1).pathname, '/api/mcp');
    assert.equal(JSON.parse(rtRes.stdout).today.totalTokens, 125_000);

    const reportsList = await runCli(['reports', '--format', 'text'], defaultEnv);
    assert.equal(reportsList.code, 0);
    assert.equal(requests.at(-1).pathname, '/api/reports');
    assert.match(reportsList.stdout, /weekly:2026-W47/);

    const singleReport = await runCli(['report', '--granularity', 'weekly', '--period', 'latest'], defaultEnv);
    assert.equal(singleReport.code, 0);
    assert.equal(requests.at(-1).pathname, '/api/reports/weekly/latest');

    const aiRes = await runCli(['ai-analyze', '--granularity', 'daily', '--question', 'status?'], defaultEnv);
    assert.equal(aiRes.code, 0);
    assert.equal(requests.at(-1).pathname, '/api/reports/ai-analyze');
    assert.match(aiRes.stdout, /缓存命中率良好/);

    // Legacy push remains compatible with /api/reports/push
    const legacyPush = await runCli(['push', '--granularity', 'daily', '--period', 'latest'], defaultEnv);
    assert.equal(legacyPush.code, 0);
    assert.equal(requests.at(-1).pathname, '/api/reports/push');
    assert.equal(requests.at(-1).body.target, 'openclaw');

    // Unified test push
    const testPush = await runCli(['push', '--test'], defaultEnv);
    assert.equal(testPush.code, 0);
    assert.equal(requests.at(-1).pathname, '/api/integrations/openclaw/push');
    assert.equal(requests.at(-1).body.test, true);

    // Unified query push
    const queryPush = await runCli(
      ['push', '--type', 'usage', '--period', 'today', '--group-by', 'model', '--include-ai'],
      defaultEnv
    );
    assert.equal(queryPush.code, 0);
    assert.equal(requests.at(-1).pathname, '/api/integrations/openclaw/push');
    assert.equal(requests.at(-1).body.type, 'usage');
    assert.equal(requests.at(-1).body.params.period, 'today');
    assert.equal(requests.at(-1).body.params.groupBy, 'model');
    assert.equal(requests.at(-1).body.includeAi, true);

    // Push history
    const histRes = await runCli(['push-history', '--format', 'text'], defaultEnv);
    assert.equal(histRes.code, 0);
    assert.equal(requests.at(-1).pathname, '/api/integrations/openclaw/history');
    assert.match(histRes.stdout, /session_completed/);
  });

  await t.test('reports clear 401 guidance when secret mismatches', async () => {
    const res = await runCli(['usage'], {
      TOKEN_MONITOR_HUB_URL: baseUrl,
      TOKEN_MONITOR_HUB_SECRET: 'wrong-secret'
    });
    assert.notEqual(res.code, 0);
    assert.match(res.stderr, /401/);
    assert.match(res.stderr, /TOKEN_MONITOR_HUB_SECRET/);
  });
});

test('hub-build-manifest registers sessionCompletion, openclawQueries, and all transitive deps in NODE_RUNTIME_SOURCE_FILES only', () => {
  assert.equal(WORKER_SHARED_MODULES.includes('sessionCompletion.js'), false);
  assert.equal(WORKER_SHARED_MODULES.includes('openclawQueries.js'), false);

  const closure = resolveTransitiveLocalDeps([
    'src/shared/sessionCompletion.js',
    'src/shared/openclawQueries.js'
  ]);
  const nodeAllowed = new Set([...CORE_SOURCE_FILES, ...NODE_RUNTIME_SOURCE_FILES]);

  for (const file of closure) {
    assert.ok(
      nodeAllowed.has(file),
      `${file} is reachable from sessionCompletion/openclawQueries and must be registered in CORE_SOURCE_FILES or NODE_RUNTIME_SOURCE_FILES`
    );
  }
  assert.ok(NODE_RUNTIME_SOURCE_FILES.includes('src/shared/sessionCompletion.js'));
  assert.ok(NODE_RUNTIME_SOURCE_FILES.includes('src/shared/openclawQueries.js'));
});
