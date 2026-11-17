'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DEFAULT_OPENCLAW_CONFIG,
  OPENCLAW_EVENT_TYPES,
  buildOpenClawWebhookRequest,
  extractLimitsSummary,
  formatOpenClawApprovalAlertMessage,
  formatOpenClawQueryDigestMessage,
  formatOpenClawQuotaAlertMessage,
  formatOpenClawServiceIncidentMessage,
  formatOpenClawSessionCompletedMessage,
  formatOpenClawWeChatMessage,
  mergeOpenClawIntegrationConfig,
  normalizeOpenClawIntegrationConfig,
  sendToOpenClawWebhook
} = require('../../src/shared/aiReportAnalyzer');

function hasMarkdownTable(text) {
  return /^\s*\|.*\|\s*\r?\n\s*\|[\s:-]*-{2,}[\s:|-]*\|/mu.test(String(text || ''));
}

test('OPENCLAW_EVENT_TYPES and DEFAULT_OPENCLAW_CONFIG preserve legacy fields and expose new defaults', () => {
  assert.deepEqual(OPENCLAW_EVENT_TYPES, [
    'report',
    'session_completed',
    'approval_alert',
    'quota_alert',
    'service_incident',
    'query_digest',
    'test',
    'custom'
  ]);
  assert.equal(Object.isFrozen(OPENCLAW_EVENT_TYPES), true);

  // Legacy fields remain intact
  assert.equal(DEFAULT_OPENCLAW_CONFIG.enabled, false);
  assert.equal(DEFAULT_OPENCLAW_CONFIG.mode, 'openclaw-agent');
  assert.equal(DEFAULT_OPENCLAW_CONFIG.webhookUrl, '');
  assert.equal(DEFAULT_OPENCLAW_CONFIG.channel, 'openclaw-weixin');
  assert.equal(DEFAULT_OPENCLAW_CONFIG.to, '');
  assert.equal(DEFAULT_OPENCLAW_CONFIG.agentId, 'main');
  assert.equal(DEFAULT_OPENCLAW_CONFIG.senderName, 'Token Monitor');
  assert.equal(DEFAULT_OPENCLAW_CONFIG.deliver, true);
  assert.equal(DEFAULT_OPENCLAW_CONFIG.pushOnRollover, false);
  assert.deepEqual(DEFAULT_OPENCLAW_CONFIG.pushGranularities, {
    daily: true,
    weekly: true,
    monthly: true
  });
  assert.equal(DEFAULT_OPENCLAW_CONFIG.includeAiAnalysis, true);
  assert.equal(DEFAULT_OPENCLAW_CONFIG.includeLimits, true);

  // Extended defaults
  assert.deepEqual(DEFAULT_OPENCLAW_CONFIG.events, {
    rollover: false,
    sessionCompleted: false,
    approvalAlerts: false,
    quotaAlerts: false,
    serviceIncidents: false
  });
  assert.deepEqual(DEFAULT_OPENCLAW_CONFIG.sessionCompletion, {
    clients: [],
    excludeSubagents: true,
    excludeBackgroundReview: true,
    minTurnTokens: 0,
    minTotalTokens: 0,
    debounceMs: 2500,
    cooldownMs: 0,
    includeDetailSummary: false,
    includeAiSummary: false
  });
  assert.deepEqual(DEFAULT_OPENCLAW_CONFIG.quotaAlerts, {
    thresholdPercent: 20,
    notifyRecovery: true
  });
  assert.deepEqual(DEFAULT_OPENCLAW_CONFIG.queryPermissions, {
    allowSessionDetail: false,
    allowConversationText: false
  });
  assert.deepEqual(DEFAULT_OPENCLAW_CONFIG.localBridge, {
    enabled: false,
    port: 17322
  });
  assert.equal(Object.isFrozen(DEFAULT_OPENCLAW_CONFIG.events), true);
  assert.equal(Object.isFrozen(DEFAULT_OPENCLAW_CONFIG.sessionCompletion.clients), true);
});

test('normalizeOpenClawIntegrationConfig syncs pushOnRollover <-> events.rollover and clamps nested fields', () => {
  const baseline = normalizeOpenClawIntegrationConfig(null);
  assert.deepEqual(baseline, DEFAULT_OPENCLAW_CONFIG);
  // Output objects are fresh mutable instances, not frozen default references
  baseline.events.sessionCompleted = true;
  assert.equal(DEFAULT_OPENCLAW_CONFIG.events.sessionCompleted, false);

  // 1. Legacy pushOnRollover=true without events.rollover -> sets events.rollover=true
  const legacyRollover = normalizeOpenClawIntegrationConfig({
    pushOnRollover: true,
    events: { sessionCompleted: true }
  });
  assert.equal(legacyRollover.pushOnRollover, true);
  assert.equal(legacyRollover.events.rollover, true);
  assert.equal(legacyRollover.events.sessionCompleted, true);

  // 2. pushOnRollover=true with explicit events.rollover=false -> syncs both to false
  const explicitDisable = normalizeOpenClawIntegrationConfig({
    pushOnRollover: true,
    events: { rollover: false }
  });
  assert.equal(explicitDisable.pushOnRollover, false);
  assert.equal(explicitDisable.events.rollover, false);

  // 3. events.rollover=true without pushOnRollover (or with pushOnRollover=false) -> syncs pushOnRollover=true
  const fromEventsOnly = normalizeOpenClawIntegrationConfig({ events: { rollover: true } });
  assert.equal(fromEventsOnly.pushOnRollover, true);
  assert.equal(fromEventsOnly.events.rollover, true);

  const eventsOverridesFalse = normalizeOpenClawIntegrationConfig({
    pushOnRollover: false,
    events: { rollover: true }
  });
  assert.equal(eventsOverridesFalse.pushOnRollover, true);
  assert.equal(eventsOverridesFalse.events.rollover, true);

  // 4. Nested field clamping, deduplication, and invalid fallback
  const customized = normalizeOpenClawIntegrationConfig({
    events: {
      rollover: true,
      sessionCompleted: true,
      approvalAlerts: true,
      quotaAlerts: true,
      serviceIncidents: true
    },
    sessionCompletion: {
      clients: [' Codex ', 'claude', 'codex', '', 123, 'OpenCode'],
      excludeSubagents: false,
      excludeBackgroundReview: false,
      minTurnTokens: -50,
      minTotalTokens: 1500.4,
      debounceMs: -1,
      cooldownMs: 30_000,
      includeDetailSummary: true,
      includeAiSummary: true
    },
    quotaAlerts: {
      thresholdPercent: 0,
      notifyRecovery: false
    },
    queryPermissions: {
      allowSessionDetail: true,
      allowConversationText: true
    },
    localBridge: {
      enabled: true,
      port: 70000
    }
  });

  assert.deepEqual(customized.sessionCompletion, {
    clients: ['codex', 'claude', 'opencode'],
    excludeSubagents: false,
    excludeBackgroundReview: false,
    minTurnTokens: 0,
    minTotalTokens: 1500,
    debounceMs: 0,
    cooldownMs: 30_000,
    includeDetailSummary: true,
    includeAiSummary: true
  });
  assert.deepEqual(customized.quotaAlerts, {
    thresholdPercent: 1,
    notifyRecovery: false
  });
  assert.deepEqual(customized.queryPermissions, {
    allowSessionDetail: true,
    allowConversationText: true
  });
  assert.deepEqual(customized.localBridge, {
    enabled: true,
    port: 65535
  });

  const upperQuotaAndLowPort = normalizeOpenClawIntegrationConfig({
    sessionCompletion: { clients: 'not-an-array', debounceMs: 'bad', minTurnTokens: null },
    quotaAlerts: { thresholdPercent: 120 },
    localBridge: { port: 0 }
  });
  assert.deepEqual(upperQuotaAndLowPort.sessionCompletion.clients, []);
  assert.equal(upperQuotaAndLowPort.sessionCompletion.debounceMs, 2500);
  assert.equal(upperQuotaAndLowPort.sessionCompletion.minTurnTokens, 0);
  assert.equal(upperQuotaAndLowPort.quotaAlerts.thresholdPercent, 99);
  assert.equal(upperQuotaAndLowPort.localBridge.port, 1);

  // Idempotency
  assert.deepEqual(normalizeOpenClawIntegrationConfig(customized), customized);
});

test('mergeOpenClawIntegrationConfig deep-merges nested configs and keeps pushOnRollover in sync', () => {
  const initial = normalizeOpenClawIntegrationConfig({
    enabled: true,
    webhookUrl: 'http://127.0.0.1:18789',
    to: 'wx_1',
    events: { sessionCompleted: true },
    sessionCompletion: { clients: ['codex'], debounceMs: 4000 },
    quotaAlerts: { thresholdPercent: 15 },
    localBridge: { enabled: true, port: 18000 }
  });

  // 1. Legacy patch enabling pushOnRollover without touching events preserves other event flags and flips rollover
  const legacyEnable = mergeOpenClawIntegrationConfig(initial, { pushOnRollover: true });
  assert.equal(legacyEnable.pushOnRollover, true);
  assert.equal(legacyEnable.events.rollover, true);
  assert.equal(legacyEnable.events.sessionCompleted, true);
  assert.deepEqual(legacyEnable.sessionCompletion.clients, ['codex']);
  assert.equal(legacyEnable.sessionCompletion.debounceMs, 4000);

  // 2. Legacy patch disabling pushOnRollover without touching events flips both to false
  const legacyDisable = mergeOpenClawIntegrationConfig(legacyEnable, { pushOnRollover: false });
  assert.equal(legacyDisable.pushOnRollover, false);
  assert.equal(legacyDisable.events.rollover, false);
  assert.equal(legacyDisable.events.sessionCompleted, true);

  // 3. New patch setting events.rollover without pushOnRollover syncs pushOnRollover
  const eventsEnable = mergeOpenClawIntegrationConfig(legacyDisable, { events: { rollover: true } });
  assert.equal(eventsEnable.pushOnRollover, true);
  assert.equal(eventsEnable.events.rollover, true);
  assert.equal(eventsEnable.events.sessionCompleted, true);

  const eventsDisable = mergeOpenClawIntegrationConfig(eventsEnable, { events: { rollover: false } });
  assert.equal(eventsDisable.pushOnRollover, false);
  assert.equal(eventsDisable.events.rollover, false);

  // 4. Nested objects deep-merge and invalid non-object subpatches don't clobber existing nested config
  const nestedUpdated = mergeOpenClawIntegrationConfig(eventsDisable, {
    pushGranularities: { weekly: false },
    sessionCompletion: { includeAiSummary: true },
    quotaAlerts: { notifyRecovery: false },
    queryPermissions: { allowSessionDetail: true },
    localBridge: { port: 99999 },
    events: 'invalid'
  });
  assert.deepEqual(nestedUpdated.pushGranularities, { daily: true, weekly: false, monthly: true });
  assert.deepEqual(nestedUpdated.sessionCompletion.clients, ['codex']);
  assert.equal(nestedUpdated.sessionCompletion.debounceMs, 4000);
  assert.equal(nestedUpdated.sessionCompletion.includeAiSummary, true);
  assert.equal(nestedUpdated.quotaAlerts.thresholdPercent, 15);
  assert.equal(nestedUpdated.quotaAlerts.notifyRecovery, false);
  assert.equal(nestedUpdated.queryPermissions.allowSessionDetail, true);
  assert.equal(nestedUpdated.localBridge.enabled, true);
  assert.equal(nestedUpdated.localBridge.port, 65535);
  assert.equal(nestedUpdated.events.sessionCompleted, true);

  // 5. Non-object patch returns normalized base
  assert.deepEqual(mergeOpenClawIntegrationConfig(initial, null), initial);
});

test('formatOpenClawSessionCompletedMessage produces WeChat bullets, respects null titles, and bounds maxChars', () => {
  const full = formatOpenClawSessionCompletedMessage({
    completion: {
      deviceId: 'dev-1',
      deviceName: 'MacBook-Pro',
      client: 'codex',
      sessionId: 'sess-abc-123',
      title: 'Implement OpenClaw event formatters',
      projectLabel: 'token-monitor',
      model: 'gpt-5',
      reasoningEffort: 'high',
      totalTokens: 125_000,
      costUsd: 1.42,
      cacheHitRatePct: 48.5,
      contextTokens: 64_000,
      contextWindow: 200_000,
      contextPercentLeft: 68,
      messageCount: 16,
      startedAt: '2026-11-17T09:00:00.000Z',
      lastUsedAt: '2026-11-17T09:02:30.000Z',
      turnDelta: {
        totalTokens: 18_500,
        inputTokens: 12_000,
        outputTokens: 6_500,
        costUsd: 0.21,
        messageCount: 2
      }
    },
    detailSummary: {
      exchangeCount: 4,
      tools: ['read_file', 'edit_file', 'run_command'],
      summary: 'Updated analyzer defaults and verified unit tests.'
    },
    aiSummary: {
      providerLabel: 'DeepSeek',
      summaryMarkdown: '• 本轮变更聚焦配置标准化与格式化。\n• 缓存命中率良好。'
    },
    limitsSummary: {
      providers: [
        {
          provider: 'thirdparty',
          adapterId: 'newapi-account',
          label: 'Team NewAPI',
          status: 'ok',
          isThirdParty: true,
          balance: { amount: 38.5, currency: 'USD', monthSpend: 12.1 },
          windows: [{ remainingPercent: 80 }]
        }
      ]
    }
  });

  assert.match(full, /会话完成通知 \(codex\)/);
  assert.match(full, /gpt-5 \(high\)/);
  assert.match(full, /MacBook-Pro/);
  assert.match(full, /Implement OpenClaw event formatters/);
  assert.match(full, /\+18\.5K tokens/);
  assert.match(full, /125\.0K tokens/);
  assert.match(full, /64\.0K \/ 200\.0K（剩余 68%）/);
  assert.match(full, /耗时 2m 30s/);
  assert.match(full, /read_file、edit_file、run_command/);
  assert.match(full, /Team NewAPI/);
  assert.match(full, /AI 总结 \(DeepSeek\)/);
  assert.equal(hasMarkdownTable(full), false);
  assert.ok(full.length <= 3500);

  // Privacy: title === null must not print "null" or fallback to hidden sessionTitle/name
  const redacted = formatOpenClawSessionCompletedMessage({
    completion: {
      client: 'claude',
      sessionId: 'sess-private',
      title: null,
      sessionTitle: 'SECRET_TITLE_SHOULD_NOT_LEAK',
      name: 'SECRET_NAME_SHOULD_NOT_LEAK',
      projectLabel: 'secret-proj',
      totalTokens: 5000
    }
  });
  assert.equal(redacted.includes('SECRET_TITLE_SHOULD_NOT_LEAK'), false);
  assert.equal(redacted.includes('SECRET_NAME_SHOULD_NOT_LEAK'), false);
  assert.equal(redacted.includes('null'), false);
  assert.match(redacted, /sess-private/);

  // Empty fallback + tight maxChars bound
  const minimal = formatOpenClawSessionCompletedMessage({});
  assert.match(minimal, /会话完成通知/);
  const bounded = formatOpenClawSessionCompletedMessage({
    completion: { client: 'codex', projectLabel: 'p' },
    aiSummary: 'A'.repeat(600),
    maxChars: 120
  });
  assert.ok(bounded.length <= 120);
});

test('formatOpenClawApprovalAlertMessage formats approval fields without tables and respects maxChars', () => {
  const msg = formatOpenClawApprovalAlertMessage({
    client: 'codex',
    deviceName: 'workstation-1',
    projectLabel: 'token-monitor',
    tool: 'Bash',
    description: 'Run deployment script',
    command: 'npm test\n| col1 | col2 |\n| --- | --- |',
    sessionId: 'sess-app-1',
    createdAt: Date.parse('2026-11-17T09:10:00.000Z'),
    expiresAt: Date.parse('2026-11-17T09:12:00.000Z')
  });

  assert.match(msg, /操作审批提醒 \(codex\)/);
  assert.match(msg, /workstation-1/);
  assert.match(msg, /Bash/);
  assert.match(msg, /Run deployment script/);
  assert.match(msg, /sess-app-1/);
  assert.equal(hasMarkdownTable(msg), false);
  assert.ok(msg.length <= 3500);

  const bounded = formatOpenClawApprovalAlertMessage({ command: 'x'.repeat(1000) }, { maxChars: 90 });
  assert.ok(bounded.length <= 90);
});

test('formatOpenClawQuotaAlertMessage handles low/restored/full alerts and never leaks email', () => {
  const lowMsg = formatOpenClawQuotaAlertMessage({
    event: 'low',
    provider: 'thirdparty',
    adapterId: 'newapi-account',
    providerLabel: 'Team NewAPI',
    accountEmail: 'sensitive@example.com',
    accountId: 'sensitive@example.com',
    accountLabel: 'Prod Key',
    remainingPercent: 12.4,
    thresholdPercent: 20,
    balance: { amount: 6.2, currency: 'USD', limit: 50, monthSpend: 43.8 },
    windows: [
      { displayLabel: '5h Session', remainingPercent: 12.4, usedPercent: 87.6, resetsAt: '2026-11-17T14:00:00.000Z' }
    ],
    observedAt: '2026-11-17T09:15:00.000Z'
  });

  assert.match(lowMsg, /额度预警 \(Team NewAPI\)/);
  assert.match(lowMsg, /\[三方API\/newapi-account\]/);
  assert.match(lowMsg, /Prod Key/);
  assert.match(lowMsg, /剩余 12\.4%/);
  assert.match(lowMsg, /阈值 20%/);
  assert.match(lowMsg, /余额 \$6\.20/);
  assert.match(lowMsg, /窗口 5h Session/);
  assert.equal(lowMsg.includes('sensitive@example.com'), false);
  assert.equal(hasMarkdownTable(lowMsg), false);

  const restoredMsg = formatOpenClawQuotaAlertMessage({
    event: 'restored',
    provider: 'codex',
    providerLabel: 'Codex Plus',
    remainingPercent: 75,
    previousRemaining: 10,
    thresholdPercent: 20
  });
  assert.match(restoredMsg, /额度恢复通知 \(Codex Plus\)/);
  assert.match(restoredMsg, /已恢复至阈值以上/);
  assert.match(restoredMsg, /先前 10%/);

  const fullMsg = formatOpenClawQuotaAlertMessage({
    event: 'full',
    provider: 'claude',
    providerLabel: 'Claude Max',
    remaining: 100
  });
  assert.match(fullMsg, /额度恢复通知/);
  assert.match(fullMsg, /已恢复满额/);

  const bounded = formatOpenClawQuotaAlertMessage({ providerLabel: 'P', message: 'm'.repeat(500) }, { maxChars: 100 });
  assert.ok(bounded.length <= 100);
});

test('formatOpenClawServiceIncidentMessage formats outages and recoveries safely', () => {
  const outageMsg = formatOpenClawServiceIncidentMessage({
    id: 'claude',
    label: 'Claude',
    status: 'outage',
    previousStatus: 'ok',
    indicator: 'major',
    incidentTitle: 'Elevated API 5xx error rates',
    description: 'Requests to Messages API are experiencing intermittent failures.',
    componentIssues: [{ name: 'Claude API', status: 'partial_outage' }],
    incidentCount: 1,
    pageUrl: 'https://status.claude.com',
    updatedAt: '2026-11-17T09:20:00.000Z'
  });
  assert.match(outageMsg, /🔴 Token Monitor 服务故障告警 \(Claude\)/);
  assert.match(outageMsg, /服务中断（原状态：正常）/);
  assert.match(outageMsg, /Elevated API 5xx error rates/);
  assert.match(outageMsg, /Claude API \(partial_outage\)/);
  assert.match(outageMsg, /https:\/\/status\.claude\.com/);
  assert.equal(hasMarkdownTable(outageMsg), false);

  const resolvedMsg = formatOpenClawServiceIncidentMessage({
    service: 'OpenAI',
    name: 'Latencies normalized',
    status: 'ok',
    resolved: true,
    pageUrl: 'javascript:alert(1)'
  });
  assert.match(resolvedMsg, /🟢 Token Monitor 服务状态恢复 \(OpenAI\)/);
  assert.match(resolvedMsg, /Latencies normalized/);
  assert.equal(resolvedMsg.includes('javascript:'), false);

  const bounded = formatOpenClawServiceIncidentMessage({ label: 'S', description: 'd'.repeat(500) }, { maxChars: 110 });
  assert.ok(bounded.length <= 110);
});

test('formatOpenClawQueryDigestMessage formats usage, sessions, limits, devices, and strips secrets', () => {
  const usageDigest = formatOpenClawQueryDigestMessage({
    queryType: 'usage_breakdown',
    result: {
      period: { label: '最近7天', startDate: '2026-11-11', endDate: '2026-11-17' },
      totals: { totalTokens: 450_000, knownCostUsd: 4.5, cacheHitRatePct: 62.3, avgOutputTokensPerSec: 45.2 },
      rows: [
        { model: 'gpt-5', tokens: 300_000, costUsd: 3.0, sharePct: 66.7 },
        { model: 'claude-sonnet-4-5', tokens: 150_000, costUsd: 1.5, sharePct: 33.3 }
      ]
    },
    aiSummary: '本周主力模型为 gpt-5。'
  });
  assert.match(usageDigest, /查询摘要 \(usage_breakdown\)/);
  assert.match(usageDigest, /最近7天 · 2026-11-11 ~ 2026-11-17/);
  assert.match(usageDigest, /450\.0K tokens/);
  assert.match(usageDigest, /1\. gpt-5: 300\.0K tokens · 66\.7% · \$3\.00/);
  assert.match(usageDigest, /AI 智能解读/);
  assert.equal(hasMarkdownTable(usageDigest), false);

  const sessionsDigest = formatOpenClawQueryDigestMessage({
    queryType: 'sessions',
    result: {
      total: 1,
      sessions: [
        { state: 'running', client: 'codex', latestModel: 'gpt-5', projectLabel: 'tm', title: null, sessionId: 's-1', totalTokens: 9000, costUsd: 0.1 }
      ]
    }
  });
  assert.match(sessionsDigest, /tm — \[running\] · codex · gpt-5/);
  assert.equal(sessionsDigest.includes('null'), false);

  const limitsAndSubscriptions = formatOpenClawQueryDigestMessage({
    queryType: 'subscriptions',
    result: {
      monthlyAmountUsd: 40,
      subscriptions: [{ name: 'Claude Max', amountUsd: 20, nextRenewalDate: '2026-12-01', daysUntilRenewal: 14 }],
      forecasts: [{ provider: 'thirdparty', accountLabel: 'Relay A', dailyBurn: 2.5, daysRemaining: 10, exhaustDate: '2026-11-27', status: 'warning' }],
      providers: [{ provider: 'codex', accountLabel: 'Work', accountEmail: 'hidden@example.com', status: 'ok', windows: [{ remainingPercent: 60 }] }],
      devices: [{ hostname: 'dev-box', platform: 'linux', stale: false, trackedClients: ['codex', 'claude'] }]
    }
  });
  assert.match(limitsAndSubscriptions, /月度订阅合计：\$40\.00/);
  assert.match(limitsAndSubscriptions, /Claude Max/);
  assert.match(limitsAndSubscriptions, /Relay A/);
  assert.match(limitsAndSubscriptions, /dev-box/);
  assert.equal(limitsAndSubscriptions.includes('hidden@example.com'), false);

  const genericWithSecret = formatOpenClawQueryDigestMessage({
    queryType: 'custom_check',
    result: { status: 'healthy', apiKey: 'sk-should-not-appear', email: 'no@example.com', count: 3 },
    maxChars: 150
  });
  assert.match(genericWithSecret, /status: healthy/);
  assert.equal(genericWithSecret.includes('sk-should-not-appear'), false);
  assert.equal(genericWithSecret.includes('no@example.com'), false);
  assert.ok(genericWithSecret.length <= 150);
});

test('buildOpenClawWebhookRequest and sendToOpenClawWebhook preserve legacy report output and handle non-report events', async () => {
  const report = {
    reportId: 'daily:2026-11-17',
    granularity: 'daily',
    period: { key: '2026-11-17', label: '2026-11-17', startDate: '2026-11-17', endDate: '2026-11-17', isCurrent: true },
    hub: { deviceCount: 1, activeDeviceCount: 1 },
    summary: { totalTokens: 80_000, knownCostUsd: 0.8, cacheHitRatePct: 25 },
    projects: [],
    clients: [],
    models: [],
    signals: []
  };

  // 1. Legacy report output in generic-webhook & openclaw-agent modes
  const legacyGeneric = buildOpenClawWebhookRequest({
    config: {
      enabled: true,
      mode: 'generic-webhook',
      webhookUrl: 'https://hooks.example.com/ingest',
      channel: 'openclaw-weixin',
      to: 'wx_1',
      includeLimits: false,
      includeAiAnalysis: false
    },
    report,
    idempotencyKey: 'rep-1'
  });
  assert.equal(legacyGeneric.ok, true);
  assert.deepEqual(legacyGeneric.body, {
    event: 'token_monitor.report',
    reportId: 'daily:2026-11-17',
    granularity: 'daily',
    periodKey: '2026-11-17',
    channel: 'openclaw-weixin',
    to: 'wx_1',
    text: formatOpenClawWeChatMessage({ report, includeLimits: false, includeAiAnalysis: false }),
    report,
    aiAnalysis: null,
    limitsSummary: null
  });

  const legacyAgent = buildOpenClawWebhookRequest({
    config: {
      enabled: true,
      mode: 'openclaw-agent',
      webhookUrl: 'http://127.0.0.1:18789',
      to: 'wx_1'
    },
    report
  });
  assert.equal(legacyAgent.ok, true);
  assert.match(legacyAgent.body.message, /^请将以下 Token Monitor 用量与项目分析简报清晰准确地整理并发送给微信用户（保留核心数字与结论，不要遗漏预警）：\n\n/);

  // 2. Non-report event in openclaw-agent mode uses event-specific promptPrefix and auto-formats eventPayload
  const sessionCompletionPayload = {
    completion: {
      eventId: 'evt-sc-1',
      client: 'codex',
      projectLabel: 'token-monitor',
      model: 'gpt-5',
      totalTokens: 50_000,
      costUsd: 0.5
    }
  };
  const agentSessionReq = buildOpenClawWebhookRequest({
    config: {
      enabled: true,
      mode: 'openclaw-agent',
      webhookUrl: 'http://127.0.0.1:18789',
      to: 'wx_1'
    },
    eventType: 'session_completed',
    eventPayload: sessionCompletionPayload,
    idempotencyKey: 'evt-sc-1'
  });
  assert.equal(agentSessionReq.ok, true);
  assert.equal(agentSessionReq.eventType, 'session_completed');
  assert.match(agentSessionReq.body.message, /^请将以下 Token Monitor 会话完成通知/);
  assert.match(agentSessionReq.body.message, /token-monitor/);
  assert.equal(agentSessionReq.headers['idempotency-key'], 'evt-sc-1');

  // Custom promptPrefix + customMessage override
  const customPrefixReq = buildOpenClawWebhookRequest({
    config: {
      enabled: true,
      mode: 'openclaw-agent',
      webhookUrl: 'http://127.0.0.1:18789',
      to: 'wx_1'
    },
    eventType: 'approval_alert',
    promptPrefix: 'URGENT:\n',
    customMessage: 'Approve rm -rf?'
  });
  assert.equal(customPrefixReq.body.message, 'URGENT:\nApprove rm -rf?');

  // 3. Non-report event in openclaw-wake mode sends plain digest text
  const wakeAlertReq = buildOpenClawWebhookRequest({
    config: {
      enabled: true,
      mode: 'openclaw-wake',
      webhookUrl: 'http://127.0.0.1:18789'
    },
    eventType: 'quota_alert',
    eventPayload: { provider: 'codex', providerLabel: 'Codex', remainingPercent: 15, thresholdPercent: 20 }
  });
  assert.equal(wakeAlertReq.ok, true);
  assert.equal(wakeAlertReq.body.mode, 'now');
  assert.match(wakeAlertReq.body.text, /额度预警 \(Codex\)/);
  assert.equal(wakeAlertReq.body.text.includes('请将以下'), false);

  // 4. Non-report event in generic-webhook mode sends exact structured payload
  const incidentPayload = { id: 'openai', label: 'OpenAI', status: 'degraded', incidentTitle: 'Slow responses' };
  const genericIncidentReq = buildOpenClawWebhookRequest({
    config: {
      enabled: true,
      mode: 'generic-webhook',
      webhookUrl: 'https://hooks.example.com/events',
      channel: 'openclaw-weixin',
      to: 'wx_group_1'
    },
    eventType: 'service_incident',
    eventPayload: incidentPayload,
    idempotencyKey: 'inc-openai-1'
  });
  assert.equal(genericIncidentReq.ok, true);
  assert.deepEqual(genericIncidentReq.body, {
    event: 'token_monitor.service_incident',
    eventType: 'service_incident',
    eventId: 'inc-openai-1',
    channel: 'openclaw-weixin',
    to: 'wx_group_1',
    text: genericIncidentReq.briefText,
    payload: incidentPayload
  });
  assert.match(genericIncidentReq.body.text, /OpenAI/);

  // Generic-webhook without idempotencyKey sets eventId: null, and unknown eventType maps to 'custom'
  const genericCustomReq = buildOpenClawWebhookRequest({
    config: {
      enabled: true,
      mode: 'generic-webhook',
      webhookUrl: 'https://hooks.example.com/events'
    },
    eventType: 'unexpected_kind',
    eventPayload: { message: 'hello world' }
  });
  assert.equal(genericCustomReq.body.event, 'token_monitor.custom');
  assert.equal(genericCustomReq.body.eventType, 'custom');
  assert.equal(genericCustomReq.body.eventId, null);
  assert.equal(genericCustomReq.body.to, null);
  assert.deepEqual(genericCustomReq.body.payload, { message: 'hello world' });

  // 5. sendToOpenClawWebhook forwards eventType/eventPayload and redacts token on HTTP errors
  const seenRequests = [];
  const sent = await sendToOpenClawWebhook({
    config: {
      enabled: true,
      mode: 'generic-webhook',
      webhookUrl: 'https://hooks.example.com/events',
      channel: 'openclaw-weixin',
      to: 'wx_1'
    },
    hookToken: 'secret-hook-token-999',
    eventType: 'test',
    eventPayload: { message: 'ping test' },
    idempotencyKey: 'test-1',
    fetchImpl: async (url, init) => {
      seenRequests.push({ url, headers: init.headers, body: JSON.parse(init.body) });
      return new Response('{"accepted":true}', { status: 202 });
    },
    now: () => new Date('2026-11-17T09:30:00.000Z')
  });
  assert.equal(sent.ok, true);
  assert.equal(sent.eventType, 'test');
  assert.equal(sent.sentAt, '2026-11-17T09:30:00.000Z');
  assert.equal(seenRequests[0].headers['idempotency-key'], 'test-1');
  assert.equal(seenRequests[0].body.event, 'token_monitor.test');
  assert.match(seenRequests[0].body.text, /连通性测试/);

  const errRes = await sendToOpenClawWebhook({
    config: {
      enabled: true,
      mode: 'openclaw-wake',
      webhookUrl: 'https://hooks.example.com/wake'
    },
    hookToken: 'secret-hook-token-999',
    eventType: 'query_digest',
    eventPayload: { queryType: 'live_rate', result: { state: 'live', speed: 42 } },
    fetchImpl: async () => new Response('Rejected token secret-hook-token-999', { status: 401 })
  });
  assert.equal(errRes.ok, false);
  assert.equal(errRes.error, 'openclaw_http_error');
  assert.equal(errRes.message.includes('secret-hook-token-999'), false);
  assert.match(errRes.message, /\[REDACTED\]/);
});

test('Phase 1 verifier regressions: prototype keys, email/secret redaction, query schema alignment, and numeric timestamps', () => {
  // 1. Prototype-key safety in SERVICE_STATUS_LABELS
  const protoIncident = formatOpenClawServiceIncidentMessage({
    label: 'Claude',
    status: 'toString',
    previousStatus: 'constructor',
    indicator: '__proto__'
  });
  assert.equal(protoIncident.includes('function toString'), false);
  assert.equal(protoIncident.includes('function Object'), false);
  assert.match(protoIncident, /服务异常/);
  assert.match(protoIncident, /原状态：constructor/);

  // 2. extractLimitsSummary omits @-email labels and falls back safely
  const limitsWithEmailLabel = extractLimitsSummary({
    limits: {
      providers: [
        {
          provider: 'codex',
          accountLabel: 'owner@example.com',
          profileName: 'secondary@example.com',
          planLabel: 'Plus',
          status: 'ok',
          windows: [{ label: '5h', remainingPercent: 50 }]
        },
        {
          provider: 'claude',
          accountName: 'claude.user@example.com',
          status: 'ok',
          windows: [{ label: '5h', remainingPercent: 80 }]
        }
      ]
    }
  });
  assert.equal(limitsWithEmailLabel.providers[0].label, 'Plus');
  assert.equal(limitsWithEmailLabel.providers[1].label, 'claude');
  assert.equal(JSON.stringify(limitsWithEmailLabel).includes('@'), false);

  // 3. formatOpenClawQueryDigestMessage redacts @-email labels, expanded secret keys, and inline secret patterns
  const arrayWithEmailLabel = formatOpenClawQueryDigestMessage({
    queryType: 'accounts',
    result: [{ label: 'leak-array@example.com', name: 'Safe Account', totalTokens: 1200 }]
  });
  assert.equal(arrayWithEmailLabel.includes('leak-array@example.com'), false);
  assert.match(arrayWithEmailLabel, /Safe Account/);

  const rowsWithEmailLabel = formatOpenClawQueryDigestMessage({
    queryType: 'breakdown',
    result: {
      rows: [{ label: 'leak-row@example.com', project: 'clean-proj', totalTokens: 3400 }]
    }
  });
  assert.equal(rowsWithEmailLabel.includes('leak-row@example.com'), false);
  assert.match(rowsWithEmailLabel, /clean-proj/);

  const genericSensitive = formatOpenClawQueryDigestMessage({
    queryType: 'diag',
    result: {
      status: 'ok',
      token: 'tok-raw-1',
      accessToken: 'acc-raw-2',
      refreshToken: 'ref-raw-3',
      aiApiKey: 'sk-1234567890abcdef',
      openclawHookToken: 'hook-raw-4',
      accountKey: 'acct-key-5',
      api_key: 'api-key-6',
      bot_token: 'bot-tok-7',
      account_email: 'hidden_snake@example.com',
      note: 'Reach admin@example.com using sk-9876543210abcdef'
    }
  });
  for (const leaked of [
    'tok-raw-1', 'acc-raw-2', 'ref-raw-3', 'sk-1234567890abcdef',
    'hook-raw-4', 'acct-key-5', 'api-key-6', 'bot-tok-7',
    'hidden_snake@example.com', 'admin@example.com', 'sk-9876543210abcdef'
  ]) {
    assert.equal(genericSensitive.includes(leaked), false, `Expected ${leaked} to be redacted`);
  }
  assert.match(genericSensitive, /status: ok/);
  assert.match(genericSensitive, /\[REDACTED\]/);

  // 4. Schema alignment with src/shared/openclawQueries.js
  // 4a. getSubscriptionsAndForecastsQuery
  const subDigest = formatOpenClawQueryDigestMessage({
    queryType: 'subscriptions',
    result: {
      asOfDate: '2026-11-17',
      totalCount: 2,
      activeCount: 2,
      monthlyTotalUsd: 45,
      subscriptions: [
        {
          provider: 'claude',
          providerLabel: 'Claude',
          planName: 'Max',
          amountUnits: 20,
          currency: 'USD',
          monthlyAmountUsd: 20,
          nextRenewalDate: '2026-12-01',
          daysUntilRenewal: 14,
          forecast: { status: 'notApplicable' }
        },
        {
          provider: 'thirdparty',
          providerLabel: 'NewAPI',
          planName: 'TopUp Pool',
          amountUnits: 25,
          currency: 'USD',
          monthlyAmountUsd: 25,
          forecast: {
            status: 'available',
            balanceCurrency: 'USD',
            dailyBurn: 2.5,
            daysRemaining: 8,
            exhaustDate: '2026-11-25'
          }
        }
      ]
    }
  });
  assert.match(subDigest, /月度订阅合计：\$45\.00（生效 2\/2）/);
  assert.match(subDigest, /Claude \(Max\)：\$20\.00 · 续费 2026-12-01 · 距续费 14 天/);
  assert.match(subDigest, /NewAPI \(TopUp Pool\)：\$25\.00 · 预计可用 8 天 · 日均 \$2\.50 · 耗尽 2026-11-25/);

  // 4b. queryUsageHistory (monthly + streaks + range + favoriteModel)
  const historyDigest = formatOpenClawQueryDigestMessage({
    queryType: 'history',
    result: {
      resolution: 'monthly',
      range: { from: '2026-10', to: '2026-11' },
      activeDays: 22,
      streaks: { currentStreak: 5, longestStreak: 12 },
      peakDay: { date: '2026-11-15', totalTokens: 210_000, knownCostUsd: 2.1 },
      totals: { totalTokens: 980_000, knownCostUsd: 9.8, favoriteModel: 'gpt-5' },
      rows: [
        { month: '2026-10', totalTokens: 400_000, knownCostUsd: 4.0 },
        { month: '2026-11', totalTokens: 580_000, knownCostUsd: 5.8 }
      ]
    }
  });
  assert.match(historyDigest, /查询范围：2026-10 ~ 2026-11/);
  assert.match(historyDigest, /主力模型 gpt-5/);
  assert.match(historyDigest, /活跃天数 22 天 · 当前连续 5 天 · 最长连续 12 天/);
  assert.match(historyDigest, /峰值日：2026-11-15 \(210\.0K tokens\)/);
  assert.match(historyDigest, /1\. 2026-10: 400\.0K tokens · \$4\.00/);
  assert.match(historyDigest, /2\. 2026-11: 580\.0K tokens · \$5\.80/);

  // 4c. listSessionsQuery (activityState) & getDevicesAndHealthQuery & getLiveTokenRateSummary (unavailable)
  const sessionsQueryDigest = formatOpenClawQueryDigestMessage({
    queryType: 'sessions',
    result: {
      total: 1,
      sessions: [
        { activityState: 'waiting', client: 'codex', latestModel: 'gpt-5', projectLabel: 'tm', title: null, totalTokens: 15_000, costUsd: 0.2 }
      ]
    }
  });
  assert.match(sessionsQueryDigest, /tm — \[waiting\] · codex · gpt-5/);

  const devicesDigest = formatOpenClawQueryDigestMessage({
    queryType: 'devices',
    result: {
      deviceCount: 2,
      activeDeviceCount: 1,
      devices: [
        { hostname: 'box-1', osName: 'Ubuntu', stale: false, trackedClients: ['codex'], clientHealthSummary: { attention: 1 } }
      ]
    }
  });
  assert.match(devicesDigest, /在线 1\/2 台/);
  assert.match(devicesDigest, /异常 1 项/);

  const unavailableRateDigest = formatOpenClawQueryDigestMessage({
    queryType: 'live_rate',
    result: {
      state: 'unavailable',
      reason: 'waitingForSample',
      speed: null,
      burn: null,
      deviceCount: 1,
      fallbackAvgOutputTokensPerSec: 38.4
    }
  });
  assert.match(unavailableRateDigest, /状态 unavailable \(waitingForSample\)/);
  assert.match(unavailableRateDigest, /平均速率 38\.4 tok\/s/);

  // 5. Numeric epoch ms timestamps in formatOpenClawSessionCompletedMessage
  const startMs = Date.parse('2026-11-17T10:00:00.000Z');
  const endMs = startMs + 95_000;
  const numericTsMsg = formatOpenClawSessionCompletedMessage({
    completion: {
      client: 'codex',
      projectLabel: 'token-monitor',
      startedAt: startMs,
      lastUsedAt: String(endMs)
    }
  });
  assert.match(numericTsMsg, /完成于 2026-11-17T10:01:35\.000Z · 耗时 1m 35s/);
});
