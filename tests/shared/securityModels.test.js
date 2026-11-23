'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  aggregateDevices,
  aggregateHistory,
  applyPeriodDelta,
  mergePeriods,
  normalizeClientName,
  normalizeModelName,
  normalizePeriod
} = require('../../src/shared/usage');
const {
  coerceHistory,
  dayKeyAddDays,
  mergeDailyMaps,
  mergeHistories,
  parseGraphResult
} = require('../../src/shared/history');
const { publicLimits } = require('../../src/shared/limits/core');
const { normalizeSubscriptions } = require('../../src/shared/subscriptionDisplay');
const {
  buildUsageReport,
  resolveReportPeriod
} = require('../../src/shared/usageReport');
const { queryUsageHistory } = require('../../src/shared/openclawQueries');
const {
  JSON_RPC_ERRORS,
  createMcpReportServer
} = require('../../src/shared/mcpReportProtocol');
const {
  MAX_ACTIVE_QR_SESSIONS,
  createWeixinQrLoginManager,
  normalizeAllowedRedirectHost
} = require('../../src/shared/openclawWeixinQr');
const { buildWindowsLauncher } = require('../../src/shared/approvalHooks');
const { createApprovalBridge } = require('../../src/shared/approvalBridge');

test('V-01: usage and history normalizers block prototype pollution and handle Object.prototype keys safely', () => {
  assert.equal(normalizeClientName('__proto__'), null);
  assert.equal(normalizeClientName('constructor'), null);
  assert.equal(normalizeClientName('prototype'), null);
  assert.equal(normalizeModelName('__proto__'), null);
  assert.equal(normalizeModelName('constructor'), null);
  assert.equal(normalizeModelName('prototype'), null);

  const maliciousPeriod = JSON.parse(
    '{"totalTokens":100,"clients":{"__proto__":10,"constructor":20,"toString":30,"codex":40},'
    + '"models":{"__proto__":10,"prototype":20,"valueOf":30,"gpt-5":40},'
    + '"clientModels":{"__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":2}},"codex":{"__proto__":5,"gpt-5":40}},'
    + '"clientModelCosts":{"__proto__":{"polluted":1.5},"codex":{"gpt-5":0.5}}}'
  );

  const normalized = normalizePeriod(maliciousPeriod);
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(({}).polluted, undefined);
  assert.equal(Object.hasOwn(normalized.clients, '__proto__'), false);
  assert.equal(Object.hasOwn(normalized.clients, 'constructor'), false);
  assert.equal(normalized.clients.tostring, 30);
  assert.equal(normalized.clients.codex, 40);
  assert.equal(normalized.models.valueof, 30);
  assert.equal(normalized.clientModels.codex['gpt-5'], 40);

  const merged = mergePeriods(maliciousPeriod, maliciousPeriod);
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(merged.clients.tostring, 60);
  assert.equal(merged.clientModels.codex['gpt-5'], 80);

  const delta = applyPeriodDelta(normalized, maliciousPeriod, normalized);
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(Object.hasOwn(delta.clients, '__proto__'), false);

  const agg = aggregateDevices([{ deviceId: 'd1', today: maliciousPeriod, month: maliciousPeriod, allTime: maliciousPeriod }]);
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(agg.periods.today.clients.codex, 40);

  // History perClient / perModel pollution attempts
  const maliciousHistory = JSON.parse(
    '{"daily":[{"date":"2026-11-20","tokens":50,"cost":1,'
    + '"perClient":{"__proto__":{"tokens":999,"polluted":1},"constructor":{"tokens":1},"codex":{"tokens":50,"cost":1,"messages":1}},'
    + '"perModel":{"__proto__":{"tokens":999,"polluted":1},"gpt-5":{"tokens":50,"cost":1}}}],'
    + '"monthly":[{"month":"2026-11","tokens":50,"cost":1,'
    + '"perClient":{"__proto__":{"tokens":999}},"perModel":{"constructor":{"tokens":999}}}],'
    + '"summary":{"__proto__":{"polluted":1},"totalTokens":50}}'
  );

  const coerced = coerceHistory(maliciousHistory);
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(Object.hasOwn(coerced.daily[0].perClient, '__proto__'), false);
  assert.equal(Object.hasOwn(coerced.daily[0].perClient, 'constructor'), false);

  const mergedHist = mergeHistories([coerced], { todayKey: '2026-11-20' });
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(mergedHist.daily[0].perClient.codex.tokens, 50);

  const directDaily = mergeDailyMaps([maliciousHistory]);
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(Object.hasOwn(directDaily[0].perClient, '__proto__'), false);

  const parsedGraph = parseGraphResult({
    contributions: [{
      date: '2026-11-20',
      clients: [
        { client: '__proto__', modelId: 'constructor', tokens: { input: 10 }, cost: 0.1, messages: 1 }
      ]
    }]
  });
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(parsedGraph.contributions[0].perClient.unknown.tokens, 10);
});

test('V-06: coerceHistory, mergeHistories, aggregateHistory, and dayKeyAddDays survive poison-pill malformed rows', () => {
  assert.equal(dayKeyAddDays('2026-99-99', 1), '');
  assert.equal(dayKeyAddDays('not-a-date', -1), '');
  assert.equal(dayKeyAddDays('', 1), '');
  assert.equal(dayKeyAddDays('2026-11-20', Number.NaN), '');

  const poison = {
    daily: [
      null,
      undefined,
      42,
      'bad',
      [],
      {},
      { date: null, tokens: 10 },
      { date: 'invalid-date', tokens: 10 },
      { date: '2026-99-99', tokens: 10, perClient: 'bad', perModel: null },
      { date: '2026-11-20', tokens: 100, cost: 0.5, perClient: { codex: { tokens: 100, cost: 0.5, messages: 2 } }, perModel: { 'gpt-5': { tokens: 100, cost: 0.5 } } }
    ],
    monthly: [null, { month: 'bad' }, { month: '2026-11', tokens: 100, cost: 0.5 }],
    dailyTotals: [null, { date: 123 }, { date: '2026-11-20', tokens: 100, cost: 0.5, activeTimeMs: 1000 }],
    summary: null
  };

  const coerced = coerceHistory(poison);
  assert.equal(coerced.daily.length, 2);
  assert.equal(coerced.monthly.length, 1);
  assert.equal(coerced.dailyTotals.length, 1);

  const merged = mergeHistories([coerced], { todayKey: '2026-11-20' });
  assert.equal(merged.daily.length, 1);
  assert.equal(merged.daily[0].date, '2026-11-20');
  assert.equal(merged.summary.totalTokens, 100);

  const aggHist = aggregateHistory([
    { deviceId: 'poison-dev', history: poison, today: { totalTokens: 100 }, month: { totalTokens: 100 }, allTime: { totalTokens: 100 } }
  ], { todayKey: '2026-11-20' });
  assert.equal(aggHist.summary.totalTokens, 100);
});

test('V-22: publicLimits uses an explicit allowlist and strips private/unknown fields', () => {
  const pub = publicLimits({
    updatedAt: '2026-11-20T00:00:00.000Z',
    multiAccountProviders: ['claude'],
    providers: [{
      provider: 'thirdparty',
      adapterId: 'newapi',
      accountKey: 'sha256:secretkey',
      accountEmail: 'owner@example.com',
      accountName: 'Owner',
      accountLabel: 'Private Label',
      planLabel: 'Enterprise',
      workspaceKind: 'personal',
      usageSummary: { period: 'month', actualCost: 99 },
      futurePrivateSecret: 'MUST_NOT_LEAK',
      status: 'ok',
      source: 'api',
      updatedAt: '2026-11-20T00:00:00.000Z',
      windows: [{ kind: 'billing', metric: 'credits', label: 'Balance', remaining: 50, currency: 'USD' }],
      balance: {
        amount: 50,
        currency: 'USD',
        quotaGroup: 'vip-internal',
        tranches: [{ amount: 50, currency: 'USD', expiresAt: '2027-01-01T00:00:00.000Z' }],
        searchSpend: 1.2,
        fetchSpend: 0.4,
        futureBalanceSecret: 'MUST_NOT_LEAK'
      }
    }]
  });

  const p = pub.providers[0];
  assert.equal(p.provider, 'thirdparty');
  assert.equal(p.adapterId, 'newapi');
  assert.equal(p.balance.amount, 50);
  for (const forbidden of [
    'accountKey', 'accountEmail', 'accountName', 'accountLabel',
    'planLabel', 'workspaceKind', 'usageSummary', 'futurePrivateSecret'
  ]) {
    assert.equal(Object.hasOwn(p, forbidden), false, `public provider must not contain ${forbidden}`);
  }
  for (const forbiddenBal of ['quotaGroup', 'tranches', 'searchSpend', 'fetchSpend', 'futureBalanceSecret']) {
    assert.equal(Object.hasOwn(p.balance, forbiddenBal), false, `public balance must not contain ${forbiddenBal}`);
  }
});

test('V-13: normalizeSubscriptions caps array count, top-ups, and text lengths', () => {
  const hugeInput = Array.from({ length: 250 }, (_, i) => ({
    id: `sub-${i}-${'x'.repeat(300)}`,
    provider: `codex-${'p'.repeat(200)}`,
    planName: 'A'.repeat(1000),
    note: 'N'.repeat(1000),
    startDate: '2026-01-01',
    amountMinor: 2000,
    binding: {
      profileName: 'P'.repeat(500),
      accountKey: 'K'.repeat(500),
      accountEmail: `${'e'.repeat(400)}@example.com`
    },
    topUps: Array.from({ length: 650 }, (_, j) => ({
      id: `top-${j}-${'t'.repeat(200)}`,
      date: '2026-01-01',
      amountMinor: 100
    }))
  }));

  const normalized = normalizeSubscriptions(hugeInput);
  assert.equal(normalized.length, 100);
  assert.ok(normalized[0].id.length <= 128);
  assert.ok(normalized[0].provider.length <= 64);
  assert.ok(normalized[0].planName.length <= 256);
  assert.ok(normalized[0].note.length <= 256);
  assert.ok(normalized[0].binding.profileName.length <= 256);
  assert.ok(normalized[0].binding.accountKey.length <= 256);
  assert.ok(normalized[0].binding.accountEmail.length <= 256);
  assert.equal(normalized[0].topUps.length, 500);
});

test('V-11: Date.UTC(0..99) year expansion DoS is blocked across usageReport and openclawQueries', () => {
  for (const badMonth of ['0001-01', '0099-12', '1999-12', '2101-01']) {
    assert.throws(() => resolveReportPeriod('monthly', badMonth), /Invalid monthly periodKey/);
  }
  for (const badWeek of ['0001-W01', '1999-W52', '2101-W01']) {
    assert.throws(() => resolveReportPeriod('weekly', badWeek), /Invalid weekly periodKey/);
  }
  for (const badDay of ['0001-01-01', '1999-12-31', '2101-01-01']) {
    assert.throws(() => resolveReportPeriod('daily', badDay), /Invalid daily periodKey/);
  }
  assert.throws(
    () => buildUsageReport({ granularity: 'monthly', periodKey: '0001-01', stats: {}, history: {}, devices: [] }),
    /Invalid monthly periodKey/
  );
  assert.throws(
    () => queryUsageHistory({ history: { daily: [], monthly: [] }, from: '0001-01', to: '0001-01' }),
    /Invalid history date bound/
  );
});

test('V-12 & V-14: MCP caps batch size/concurrency, prompt arg length, URI decoding, and strips host paths', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const server = createMcpReportServer({
    listReports: async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 15));
      inFlight -= 1;
      return {
        ok: true,
        config: { enabled: true, reportsDir: '/home/secretuser/reports' },
        reports: [{
          reportId: 'daily:2026-11-20',
          granularity: 'daily',
          periodKey: '2026-11-20',
          files: {
            json: '/home/secretuser/reports/daily/2026-11-20.json',
            markdown: '/home/secretuser/reports/daily/2026-11-20.md'
          }
        }]
      };
    }
  });

  // Oversized batch (> 20) rejected with -32600
  const oversized = Array.from({ length: 21 }, (_, i) => ({ jsonrpc: '2.0', id: i + 1, method: 'ping' }));
  const overRes = await server.handlePayload(oversized);
  assert.equal(overRes.error.code, JSON_RPC_ERRORS.INVALID_REQUEST);

  // Bounded batch concurrency (<= 4) + path stripping
  const batch = Array.from({ length: 12 }, (_, i) => ({
    jsonrpc: '2.0',
    id: i + 1,
    method: 'tools/call',
    params: { name: 'list_usage_reports', arguments: {} }
  }));
  const batchRes = await server.handlePayload(batch);
  assert.equal(batchRes.length, 12);
  assert.ok(maxInFlight <= 4, `expected max concurrency <= 4, got ${maxInFlight}`);

  const serialized = JSON.stringify(batchRes[0]);
  assert.equal(serialized.includes('/home/secretuser'), false);
  assert.equal(batchRes[0].result.structuredContent.config.reportsDir, undefined);
  assert.equal(batchRes[0].result.structuredContent.reports[0].files.json, 'daily/2026-11-20.json');
  assert.equal(batchRes[0].result.structuredContent.reports[0].files.markdown, 'daily/2026-11-20.md');

  // Oversized prompt argument rejected with -32602
  const bigPrompt = await server.handleMessage({
    jsonrpc: '2.0',
    id: 50,
    method: 'prompts/get',
    params: { name: 'project-deep-dive', arguments: { project: 'x'.repeat(1025) } }
  });
  assert.equal(bigPrompt.error.code, JSON_RPC_ERRORS.INVALID_PARAMS);

  // Malformed percent-encoded URI returns -32602 instead of -32603
  const badUri = await server.handleMessage({
    jsonrpc: '2.0',
    id: 51,
    method: 'resources/read',
    params: { uri: 'report://daily/%ZZ' }
  });
  assert.equal(badUri.error.code, JSON_RPC_ERRORS.INVALID_PARAMS);
});

test('V-20: openclawWeixinQr caps sessions <= 4, allowlists *.weixin.qq.com redirect_host, and aborts on caller signal', async () => {
  assert.equal(normalizeAllowedRedirectHost('idc2.weixin.qq.com'), 'idc2.weixin.qq.com');
  for (const bad of ['127.0.0.1', '127.0.0.1:18789', '[::1]', 'evil.com', 'weixin.qq.com.evil.com', 'idc.weixin.qq.com:8443', 'weixin.qq.com']) {
    assert.equal(normalizeAllowedRedirectHost(bad), '', `expected ${bad} to be rejected`);
  }

  let clock = Date.parse('2026-11-24T00:00:00.000Z');
  let abortedObserved = false;
  let statusResp = { status: 'scaned_but_redirect', redirect_host: '127.0.0.1:18789' };
  let hangPoll = false;
  const seenUrls = [];

  const mgr = createWeixinQrLoginManager({
    now: () => new Date(clock),
    sessionTtlMs: 10_000,
    fetchImpl: async (url, init = {}) => {
      const u = String(url);
      seenUrls.push(u);
      assert.equal(init.redirect, 'error');
      if (u.includes('get_bot_qrcode')) {
        return new Response(JSON.stringify({ qrcode: `q-${seenUrls.length}`, qrcode_img_content: 'https://liteapp.weixin.qq.com/q' }), { status: 200 });
      }
      if (hangPoll) {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            abortedObserved = true;
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          }, { once: true });
        });
      }
      return new Response(JSON.stringify(statusResp), { status: 200 });
    }
  });

  // Cap active sessions at MAX_ACTIVE_QR_SESSIONS (4)
  const ids = [];
  for (let i = 0; i < MAX_ACTIVE_QR_SESSIONS; i += 1) {
    const res = await mgr.start();
    assert.equal(res.ok, true);
    ids.push(res.sessionId);
  }
  const fifth = await mgr.start();
  assert.equal(fifth.ok, false);
  assert.equal(fifth.statusCode, 429);
  assert.equal(fifth.error, 'too_many_qr_sessions');

  // Disallowed redirect_host is rejected; base URL stays ilinkai.weixin.qq.com
  const redirBlocked = await mgr.getStatus(ids[0]);
  assert.equal(redirBlocked.redirected, false);
  statusResp = { status: 'wait' };
  await mgr.getStatus(ids[0]);
  assert.ok(seenUrls.at(-1).startsWith('https://ilinkai.weixin.qq.com/'));

  // Caller AbortSignal cancels in-flight long poll
  hangPoll = true;
  const callerAc = new AbortController();
  const pending = mgr.getStatus(ids[1], { signal: callerAc.signal });
  callerAc.abort();
  const abortRes = await pending;
  assert.equal(abortedObserved, true);
  assert.equal(abortRes.ok, true);

  // Expired sessions are evicted so new sessions can start
  clock += 20_000;
  hangPoll = false;
  const afterExpiry = await mgr.start();
  assert.equal(afterExpiry.ok, true);
  mgr.cancelAll();
});

test('V-24: Windows approval hook launcher removes unquoted echo|findstr and approvalBridge enforces 0700 dir before listen', async (t) => {
  const bat = buildWindowsLauncher({
    scriptPath: 'C:\\Users\\demo\\approval-hook.js"%TEMP%&calc',
    execPath: 'C:\\Program Files\\Token Monitor\\app.exe"!BOOM!'
  });
  assert.equal(bat.includes('echo %*'), false);
  assert.equal(bat.includes('findstr'), false);
  assert.equal(bat.includes('&calc'), false);
  assert.equal(bat.includes('!BOOM!'), false);
  assert.match(bat, /if \/i "%~1"=="--client"/);

  if (process.platform !== 'win32') {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-bridge-sec-'));
    t.after(() => fs.rmSync(baseDir, { recursive: true, force: true }));
    const dataDir = path.join(baseDir, 'nested-bridge');
    const bridge = createApprovalBridge({ dataDir, onAlert: () => {} });
    const started = await bridge.start();
    t.after(() => bridge.stop());
    assert.equal(started.started, true);
    const dirMode = fs.statSync(dataDir).mode & 0o777;
    const metaMode = fs.statSync(bridge.metadataPath).mode & 0o777;
    assert.equal(dirMode, 0o700);
    assert.equal(metaMode, 0o600);
  }
});
