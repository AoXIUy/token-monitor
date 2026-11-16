'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { CredentialStore } = require('../../src/shared/credentialStore');
const {
  buildOpenClawWebhookRequest,
  extractLimitsSummary,
  formatOpenClawWeChatMessage,
  invokeThirdPartyAiAnalysis,
  normalizeAiIntegrationConfig,
  normalizeOpenClawIntegrationConfig,
  resolveAiCompletionEndpoint,
  resolveOpenClawWebhookEndpoint
} = require('../../src/shared/aiReportAnalyzer');
const { createHub } = require('../../src/hub/server');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeSampleRecord(deviceId = 'mac-1', dayKey = '2026-11-16', totalTokens = 120_000, costUsd = 1.25) {
  return {
    deviceId,
    hostname: `${deviceId}.local`,
    platform: 'darwin',
    updatedAt: `${dayKey}T12:00:00.000Z`,
    periodWindows: {
      today: { key: dayKey, start: `${dayKey}T00:00:00.000Z`, endsAt: `${dayKey}T23:59:59.999Z` },
      month: { key: dayKey.slice(0, 7), start: `${dayKey.slice(0, 7)}-01T00:00:00.000Z` }
    },
    periods: {
      today: {
        totalTokens,
        costUsd,
        inputTokens: Math.round(totalTokens * 0.5),
        outputTokens: Math.round(totalTokens * 0.2),
        cacheReadTokens: Math.round(totalTokens * 0.3),
        cacheWriteTokens: 0,
        clients: { codex: totalTokens },
        clientCosts: { codex: costUsd },
        models: { 'gpt-5': totalTokens },
        modelCosts: { 'gpt-5': costUsd },
        projects: {
          'token-monitor': {
            label: 'token-monitor',
            tokens: totalTokens,
            costUsd,
            clients: { codex: totalTokens },
            models: { 'gpt-5': totalTokens }
          }
        },
        sessions: {
          s1: {
            client: 'codex',
            model: 'gpt-5',
            project: 'token-monitor',
            tokens: totalTokens,
            costUsd,
            lastUsedAt: `${dayKey}T11:59:00.000Z`
          }
        }
      },
      month: {
        totalTokens,
        costUsd,
        inputTokens: Math.round(totalTokens * 0.5),
        outputTokens: Math.round(totalTokens * 0.2),
        cacheReadTokens: Math.round(totalTokens * 0.3),
        cacheWriteTokens: 0,
        clients: { codex: totalTokens },
        clientCosts: { codex: costUsd },
        models: { 'gpt-5': totalTokens },
        modelCosts: { 'gpt-5': costUsd },
        projects: {
          'token-monitor': {
            label: 'token-monitor',
            tokens: totalTokens,
            costUsd,
            clients: { codex: totalTokens },
            models: { 'gpt-5': totalTokens }
          }
        }
      }
    },
    history: {
      daily: [
        { date: dayKey, tokens: totalTokens, costUsd, activeTimeMs: 900_000, clients: { codex: totalTokens }, models: { 'gpt-5': totalTokens } }
      ]
    },
    limits: {
      providers: [
        {
          provider: 'thirdparty',
          adapterId: 'newapi-account',
          accountLabel: 'Team NewAPI',
          accountEmail: 'private@example.com',
          status: 'ok',
          stale: false,
          balance: {
            amount: 42.5,
            currency: 'USD',
            todaySpend: 1.25,
            monthSpend: 18.4,
            allTimeSpend: 112.0,
            limit: 100
          },
          windows: [
            { label: 'Quota', metric: 'credits', usedPercent: 18.4, remainingPercent: 81.6 }
          ]
        },
        {
          provider: 'codex',
          accountName: 'Plus Workspace',
          planLabel: 'Plus',
          status: 'ok',
          stale: false,
          windows: [
            { label: '5h', metric: 'percent', usedPercent: 35, remainingPercent: 65, resetsAt: `${dayKey}T16:00:00.000Z` }
          ]
        }
      ]
    }
  };
}

test('aiReportAnalyzer endpoint resolution & sanitization never leak email/secrets', async () => {
  assert.equal(resolveAiCompletionEndpoint('openai-compatible', 'https://api.deepseek.com'), 'https://api.deepseek.com/v1/chat/completions');
  assert.equal(resolveAiCompletionEndpoint('openai-compatible', 'https://api.deepseek.com/v1'), 'https://api.deepseek.com/v1/chat/completions');
  assert.equal(resolveAiCompletionEndpoint('anthropic-messages', 'https://api.anthropic.com'), 'https://api.anthropic.com/v1/messages');
  assert.equal(resolveOpenClawWebhookEndpoint('openclaw-agent', 'http://127.0.0.1:19001'), 'http://127.0.0.1:19001/hooks/agent');
  assert.equal(resolveOpenClawWebhookEndpoint('openclaw-wake', 'http://127.0.0.1:19001'), 'http://127.0.0.1:19001/hooks/wake');

  const stats = makeSampleRecord();
  const limitsSummary = extractLimitsSummary(stats);
  assert.equal(limitsSummary.thirdPartyCount, 1);
  assert.equal(limitsSummary.totalAccounts, 2);
  assert.equal(JSON.stringify(limitsSummary).includes('private@example.com'), false);

  const report = {
    reportId: 'daily:2026-11-16',
    granularity: 'daily',
    period: { key: '2026-11-16', label: '2026-11-16', startDate: '2026-11-16', endDate: '2026-11-16', isCurrent: true },
    hub: { deviceCount: 1, activeDeviceCount: 1 },
    summary: { totalTokens: 120000, knownCostUsd: 1.25, cacheHitRatePct: 37.5 },
    projects: [{ label: 'token-monitor', tokens: 120000, costUsd: 1.25, tokenSharePct: 100, clients: [{ client: 'codex' }] }],
    clients: [{ client: 'codex', tokenSharePct: 100 }],
    models: [{ model: 'gpt-5', tokenSharePct: 100 }],
    signals: []
  };

  // Remote host requires key; error redacts secret if error text somehow echoed it
  const missingKey = await invokeThirdPartyAiAnalysis({
    config: normalizeAiIntegrationConfig({
      enabled: true,
      protocol: 'openai-compatible',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat'
    }),
    apiKey: '',
    report,
    stats
  });
  assert.equal(missingKey.ok, false);
  assert.equal(missingKey.error, 'ai_missing_key');

  // Anthropic Messages happy path
  let seenHeaders = null;
  let seenBody = null;
  const anthropicOk = await invokeThirdPartyAiAnalysis({
    config: normalizeAiIntegrationConfig({
      enabled: true,
      protocol: 'anthropic-messages',
      providerLabel: 'Claude Relay',
      baseUrl: 'https://relay.example.com',
      model: 'claude-sonnet-4-5',
      language: 'zh-CN'
    }),
    apiKey: 'sk-ant-secret-xyz',
    report,
    stats,
    fetchImpl: async (_url, init) => {
      seenHeaders = init.headers;
      seenBody = JSON.parse(init.body);
      return new Response(JSON.stringify({
        model: 'claude-sonnet-4-5',
        content: [{ type: 'text', text: '### AI 结论\n今日 token-monitor 项目占比 100%，Team NewAPI 余额充足。' }],
        usage: { input_tokens: 400, output_tokens: 80 }
      }), { status: 200 });
    }
  });
  assert.equal(anthropicOk.ok, true);
  assert.equal(seenHeaders['x-api-key'], 'sk-ant-secret-xyz');
  assert.equal(seenHeaders['anthropic-version'], '2023-06-01');
  assert.equal(seenBody.model, 'claude-sonnet-4-5');
  assert.match(anthropicOk.analysis.summaryMarkdown, /Team NewAPI/);

  const brief = formatOpenClawWeChatMessage({
    report,
    analysis: anthropicOk.analysis,
    limitsSummary
  });
  assert.match(brief, /Token Monitor 日报/);
  assert.match(brief, /\[三方API\/newapi-account\] Team NewAPI: 余额 \$42\.50/);
  assert.match(brief, /AI 智能分析/);

  const ocReq = buildOpenClawWebhookRequest({
    config: normalizeOpenClawIntegrationConfig({
      enabled: true,
      mode: 'openclaw-agent',
      webhookUrl: 'http://127.0.0.1:19001',
      channel: 'openclaw-weixin',
      to: 'wxid_target_123'
    }),
    hookToken: 'oc-hook-secret',
    report,
    analysis: anthropicOk.analysis,
    limitsSummary,
    idempotencyKey: 'token-monitor-daily-2026-11-16'
  });
  assert.equal(ocReq.ok, true);
  assert.equal(ocReq.endpoint, 'http://127.0.0.1:19001/hooks/agent');
  assert.equal(ocReq.headers.authorization, 'Bearer oc-hook-secret');
  assert.equal(ocReq.headers['idempotency-key'], 'token-monitor-daily-2026-11-16');
  assert.equal(ocReq.body.deliver, true);
  assert.equal(ocReq.body.channel, 'openclaw-weixin');
  assert.equal(ocReq.body.to, 'wxid_target_123');
});

test('CredentialStore isolates integration secrets cleanly without touching CREDENTIAL_SETTING_PATHS', () => {
  const dir = makeTempDir('tm-cred-integ-');
  try {
    const store = new CredentialStore(dir);
    assert.deepEqual(store.readIntegrationSecrets(), { aiApiKey: '', openclawHookToken: '' });

    store.writeIntegrationSecrets({ aiApiKey: 'sk-test-123', openclawHookToken: 'oc-tok-456' });
    assert.deepEqual(store.readIntegrationSecrets(), {
      aiApiKey: 'sk-test-123',
      openclawHookToken: 'oc-tok-456'
    });

    store.writeIntegrationSecrets({ aiApiKey: '' });
    assert.deepEqual(store.readIntegrationSecrets(), {
      aiApiKey: '',
      openclawHookToken: 'oc-tok-456'
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Hub API + MCP + OpenClaw rollover integration end-to-end', async () => {
  const dir = makeTempDir('tm-hub-integ-');
  const aiCalls = [];
  const openclawCalls = [];

  const integrationFetch = async (url, init) => {
    const targetUrl = String(url);
    const body = JSON.parse(init.body);
    if (targetUrl.startsWith('https://ai.mock.local')) {
      aiCalls.push({ url: targetUrl, headers: init.headers, body });
      return new Response(JSON.stringify({
        model: 'deepseek-chat',
        choices: [{ message: { content: 'AI分析：codex 表现稳定，建议保持缓存策略。' } }],
        usage: { prompt_tokens: 320, completion_tokens: 45, total_tokens: 365 }
      }), { status: 200 });
    }
    if (targetUrl.startsWith('https://oc.mock.local')) {
      openclawCalls.push({ url: targetUrl, headers: init.headers, body });
      return new Response(JSON.stringify({ ok: true, runId: 'run-wx-1' }), { status: 202 });
    }
    throw new Error(`Unexpected URL: ${targetUrl}`);
  };

  const hub = createHub({
    port: 0,
    host: '127.0.0.1',
    secret: 'hub-secret-test',
    dataFile: path.join(dir, 'devices.json'),
    reportsDir: path.join(dir, 'reports'),
    reports: { enabled: true, daily: true, weekly: true, monthly: true },
    integrationFetch,
    logger: { error() {}, warn() {}, log() {} }
  });

  await hub.start();
  const addr = hub.server.address();
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  const auth = { authorization: 'Bearer hub-secret-test' };

  try {
    // 1. Ingest usage + third-party API limits
    const ingestRes = await fetch(`${baseUrl}/api/ingest`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify(makeSampleRecord('dev-1', '2026-11-16', 250_000, 2.5))
    });
    assert.equal(ingestRes.status, 200);

    // 2. Configure AI API + OpenClaw Webhook
    const putInteg = await fetch(`${baseUrl}/api/reports/integrations`, {
      method: 'PUT',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({
        ai: {
          enabled: true,
          protocol: 'openai-compatible',
          providerLabel: 'DeepSeek',
          baseUrl: 'https://ai.mock.local/v1',
          model: 'deepseek-chat',
          apiKey: 'sk-ds-secret',
          autoAnalyzeOnRollover: true
        },
        openclaw: {
          enabled: true,
          mode: 'openclaw-agent',
          webhookUrl: 'https://oc.mock.local',
          hookToken: 'oc-secret-token',
          channel: 'openclaw-weixin',
          to: 'wx_user_001',
          agentId: 'main',
          pushOnRollover: true,
          includeAiAnalysis: true,
          includeLimits: true
        }
      })
    });
    assert.equal(putInteg.status, 200);
    const putData = await putInteg.json();
    assert.equal(putData.ok, true);
    assert.equal(putData.ai.apiKeyConfigured, true);
    assert.equal(putData.openclaw.hookTokenConfigured, true);
    // Secrets must NEVER come back over HTTP
    assert.equal(JSON.stringify(putData).includes('sk-ds-secret'), false);
    assert.equal(JSON.stringify(putData).includes('oc-secret-token'), false);

    // 3. Generate current daily report
    const genRes = await fetch(`${baseUrl}/api/reports/generate`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ granularity: 'daily', periodKey: '2026-11-16', force: true })
    });
    assert.equal(genRes.status, 200);

    // 4. Analyze via third-party AI API & verify caching
    const aiRes1 = await fetch(`${baseUrl}/api/reports/ai-analyze`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ granularity: 'daily', periodKey: '2026-11-16' })
    });
    assert.equal(aiRes1.status, 200);
    const aiData1 = await aiRes1.json();
    assert.equal(aiData1.ok, true);
    assert.equal(aiData1.cached, false);
    assert.equal(aiCalls.length, 1);

    const aiRes2 = await fetch(`${baseUrl}/api/reports/ai-analyze`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ granularity: 'daily', periodKey: '2026-11-16' })
    });
    const aiData2 = await aiRes2.json();
    assert.equal(aiData2.cached, true);
    assert.equal(aiCalls.length, 1);

    // 5. GET /api/reports & GET /api/reports/daily/2026-11-16 expose AI + integrations metadata
    const listRes = await fetch(`${baseUrl}/api/reports`, { headers: auth });
    const listData = await listRes.json();
    assert.equal(listData.integrations.ai.apiKeyConfigured, true);
    const dailySummary = listData.reports.find((item) => item.reportId === 'daily:2026-11-16');
    assert.ok(dailySummary);
    assert.equal(dailySummary.hasAiAnalysis, true);

    const detailRes = await fetch(`${baseUrl}/api/reports/daily/2026-11-16?format=both`, { headers: auth });
    const detailData = await detailRes.json();
    assert.equal(detailData.aiAnalysis.model, 'deepseek-chat');
    assert.match(detailData.aiAnalysis.summaryMarkdown, /AI分析/);

    // 6. Push to OpenClaw WeChat + check brief endpoint
    const pushRes = await fetch(`${baseUrl}/api/reports/push`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ granularity: 'daily', periodKey: '2026-11-16' })
    });
    assert.equal(pushRes.status, 200);
    assert.equal(openclawCalls.length, 1);
    assert.equal(openclawCalls[0].url, 'https://oc.mock.local/hooks/agent');
    assert.equal(openclawCalls[0].headers.authorization, 'Bearer oc-secret-token');
    assert.equal(openclawCalls[0].body.channel, 'openclaw-weixin');
    assert.equal(openclawCalls[0].body.to, 'wx_user_001');
    assert.match(openclawCalls[0].body.message, /Team NewAPI/);
    assert.match(openclawCalls[0].body.message, /AI分析/);

    const briefTextRes = await fetch(`${baseUrl}/api/integrations/openclaw/brief?granularity=daily&periodKey=2026-11-16&format=text`, {
      headers: auth
    });
    assert.equal(briefTextRes.status, 200);
    const briefText = await briefTextRes.text();
    assert.match(briefText, /Token Monitor 日报/);

    // 7. MCP tools (get_realtime_usage_and_limits, analyze_report_with_ai, push_report_to_openclaw)
    const mcpRealtimeRes = await fetch(`${baseUrl}/api/mcp`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/call',
        params: { name: 'get_realtime_usage_and_limits', arguments: { thirdPartyOnly: true } }
      })
    });
    const mcpRealtime = await mcpRealtimeRes.json();
    assert.equal(mcpRealtime.result.structuredContent.limits.thirdPartyCount, 1);
    assert.equal(mcpRealtime.result.structuredContent.limits.providers[0].provider, 'thirdparty');

    // 8. Rollover triggers automatic OpenClaw push for previous day
    await fetch(`${baseUrl}/api/ingest`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify(makeSampleRecord('dev-1', '2026-11-17', 50_000, 0.5))
    });
    // Wait briefly for rollover async hook before hub.stop() awaits pendingTasks
    await new Promise((r) => setTimeout(r, 150));
    await hub.stop();
    assert.ok(openclawCalls.length >= 2, 'rollover should have triggered automatic OpenClaw WeChat delivery');
    assert.equal(openclawCalls.at(-1).headers['idempotency-key'], 'token-monitor-daily-2026-11-16');
  } finally {
    await hub.stop().catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
