'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '../..');
const mainSource = fs.readFileSync(path.join(root, 'src/electron/main.js'), 'utf8');
const preloadSource = fs.readFileSync(path.join(root, 'src/electron/preload.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(root, 'src/electron/renderer/index.html'), 'utf8');
const rendererSource = fs.readFileSync(path.join(root, 'src/electron/renderer/app.js'), 'utf8');
const { LANGUAGE_OPTIONS, MESSAGES } = require('../../src/electron/renderer/i18n');

function createSvgNodeStub(tagName) {
  const attributes = new Map();
  const children = [];
  return {
    tagName,
    attributes,
    children,
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
    getAttribute(name) {
      return attributes.get(name);
    },
    append(...nodes) {
      children.push(...nodes);
    },
    appendChild(node) {
      children.push(node);
      return node;
    },
    replaceChildren(...nodes) {
      children.splice(0, children.length, ...nodes);
    }
  };
}

function createElementStub(tagName = 'div') {
  const listeners = new Map();
  const classes = new Set();
  const attributes = new Map();
  const children = [];
  let classNameValue = '';
  const stub = {
    tagName,
    checked: false,
    disabled: false,
    hidden: false,
    inert: false,
    type: '',
    value: '',
    placeholder: '',
    textContent: '',
    dataset: {},
    style: {},
    _focused: false,
    attributes,
    children,
    get className() {
      return classNameValue;
    },
    set className(val) {
      classNameValue = String(val || '');
      classes.clear();
      for (const cls of classNameValue.split(/\s+/).filter(Boolean)) classes.add(cls);
    },
    classList: {
      toggle(name, force) {
        if (force === undefined) {
          if (classes.has(name)) classes.delete(name);
          else classes.add(name);
          return;
        }
        if (force) classes.add(name);
        else classes.delete(name);
      },
      add(...names) {
        for (const name of names) classes.add(name);
      },
      remove(...names) {
        for (const name of names) classes.delete(name);
      },
      contains(name) {
        return classes.has(name);
      }
    },
    matches(selector) {
      if (selector === ':focus') return stub._focused === true;
      return false;
    },
    focus() {
      stub._focused = true;
    },
    blur() {
      stub._focused = false;
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
    getAttribute(name) {
      return attributes.get(name);
    },
    append(...nodes) {
      children.push(...nodes);
    },
    appendChild(node) {
      children.push(node);
      return node;
    },
    replaceChildren(...nodes) {
      children.splice(0, children.length, ...nodes);
    },
    querySelector(selector) {
      const cls = selector.startsWith('.') ? selector.slice(1) : '';
      for (const child of children) {
        if (cls && child?.classList?.contains?.(cls)) return child;
        const found = child?.querySelector?.(selector);
        if (found) return found;
      }
      return null;
    },
    addEventListener(type, handler) {
      const existing = listeners.get(type);
      if (existing) existing.push(handler);
      else listeners.set(type, [handler]);
    },
    async trigger(type, event = {}) {
      const handlers = listeners.get(type) || [];
      let lastResult;
      for (const handler of handlers) {
        lastResult = await handler(event);
      }
      return lastResult;
    }
  };
  return stub;
}

function createRendererReportsHarness() {
  const els = {
    reportsSettingsGroup: createElementStub(),
    reportsHostRequiredNote: createElementStub(),
    reportsEnableHostButton: createElementStub(),
    reportsHostControls: createElementStub(),
    reportsScheduleList: createElementStub(),
    reportsEnabledInput: createElementStub(),
    reportsDailyInput: createElementStub(),
    reportsWeeklyInput: createElementStub(),
    reportsMonthlyInput: createElementStub(),
    reportsDirLabel: createElementStub(),
    reportsPickDirButton: createElementStub(),
    reportsOpenDirButton: createElementStub(),
    reportsActionsRow: createElementStub(),
    reportsGenerateNowButton: createElementStub(),
    reportsStatusText: createElementStub(),
    reportsIntegrationsControls: createElementStub(),
    reportsAiPanel: createElementStub(),
    reportsAiEnabledInput: createElementStub(),
    reportsAiProtocolInput: createElementStub(),
    reportsAiProviderLabelInput: createElementStub(),
    reportsAiBaseUrlInput: createElementStub(),
    reportsAiModelInput: createElementStub(),
    reportsAiApiKeyInput: createElementStub(),
    reportsAiClearKeyButton: createElementStub(),
    reportsAiLanguageInput: createElementStub(),
    reportsAiAutoAnalyzeInput: createElementStub(),
    reportsAiStatusText: createElementStub(),
    reportsAiSaveButton: createElementStub(),
    reportsAiAnalyzeNowButton: createElementStub(),
    reportsAiPreview: createElementStub(),
    reportsOpenClawPanel: createElementStub(),
    reportsOpenClawEnabledInput: createElementStub(),
    reportsOpenClawModeInput: createElementStub(),
    reportsOpenClawWebhookUrlInput: createElementStub(),
    reportsOpenClawHookTokenInput: createElementStub(),
    reportsOpenClawClearTokenButton: createElementStub(),
    reportsOpenClawChannelInput: createElementStub(),
    reportsOpenClawToInput: createElementStub(),
    reportsOpenClawAgentIdInput: createElementStub(),
    reportsOpenClawPushOnRolloverInput: createElementStub(),
    reportsOpenClawEventSessionCompletedInput: createElementStub(),
    reportsOpenClawEventApprovalAlertsInput: createElementStub(),
    reportsOpenClawEventQuotaAlertsInput: createElementStub(),
    reportsOpenClawQuotaOptions: createElementStub(),
    reportsOpenClawQuotaThresholdInput: createElementStub(),
    reportsOpenClawQuotaNotifyRecoveryInput: createElementStub(),
    reportsOpenClawEventServiceIncidentsInput: createElementStub(),
    reportsOpenClawSessionToggle: createElementStub(),
    reportsOpenClawSessionDetails: createElementStub(),
    reportsOpenClawExcludeSubagentsInput: createElementStub(),
    reportsOpenClawExcludeBackgroundReviewInput: createElementStub(),
    reportsOpenClawSessionIncludeDetailInput: createElementStub(),
    reportsOpenClawSessionIncludeAiInput: createElementStub(),
    reportsOpenClawMinTurnTokensInput: createElementStub(),
    reportsOpenClawMinTotalTokensInput: createElementStub(),
    reportsOpenClawDebounceMsInput: createElementStub(),
    reportsOpenClawCooldownMsInput: createElementStub(),
    reportsOpenClawClientsInput: createElementStub(),
    reportsOpenClawAllowSessionDetailInput: createElementStub(),
    reportsOpenClawAllowConversationTextInput: createElementStub(),
    reportsOpenClawLocalBridgeSection: createElementStub(),
    reportsOpenClawLocalBridgeEnabledInput: createElementStub(),
    reportsOpenClawLocalBridgePortInput: createElementStub(),
    reportsOpenClawLocalBridgeEndpoint: createElementStub(),
    reportsOpenClawLocalBridgeStatusText: createElementStub(),
    reportsOpenClawLocalBridgeCopyTokenButton: createElementStub(),
    reportsOpenClawLocalBridgeCopyMcpButton: createElementStub(),
    reportsOpenClawLocalBridgeRegenTokenButton: createElementStub(),
    reportsOpenClawIncludeAiInput: createElementStub(),
    reportsOpenClawIncludeLimitsInput: createElementStub(),
    reportsOpenClawEnvSummary: createElementStub(),
    reportsOpenClawQrScanButton: createElementStub(),
    reportsOpenClawProvisionButton: createElementStub(),
    reportsOpenClawQrCard: createElementStub(),
    reportsOpenClawQrBox: createElementStub(),
    reportsOpenClawQrStatusText: createElementStub(),
    reportsOpenClawQrVerifyRow: createElementStub(),
    reportsOpenClawQrVerifyInput: createElementStub(),
    reportsOpenClawQrVerifyButton: createElementStub(),
    reportsOpenClawQrRefreshButton: createElementStub(),
    reportsOpenClawQrCopyLinkButton: createElementStub(),
    reportsOpenClawQrCancelButton: createElementStub(),
    reportsOpenClawQrGuideText: createElementStub(),
    reportsOpenClawStatusText: createElementStub(),
    reportsOpenClawSaveButton: createElementStub(),
    reportsOpenClawTestPushButton: createElementStub(),
    reportsOpenClawPushUsageButton: createElementStub(),
    reportsOpenClawPushNowButton: createElementStub(),
    reportsOpenClawHistorySection: createElementStub(),
    reportsOpenClawHistoryRefreshButton: createElementStub(),
    reportsOpenClawHistoryEmpty: createElementStub(),
    reportsOpenClawHistoryList: createElementStub(),
    openClawQuickPushButton: createElementStub(),
    openClawToast: createElementStub()
  };
  const state = {
    period: 'today',
    breakdown: 'home',
    openSession: null,
    settings: {
      hubMode: 'host',
      hubHostPort: 17321,
      reportsEnabled: false,
      reportsDaily: true,
      reportsWeekly: true,
      reportsMonthly: true,
      reportsDir: ''
    }
  };
  const savedPatches = [];
  let rejectSave = false;
  let generateResult = { ok: true, reports: [{ reportId: 'daily:2026-11-16' }, { reportId: 'weekly:2026-W47' }] };
  let pickDirResult = { ok: true, dir: '/tmp/custom-reports' };
  let openDirResult = { ok: true, dir: '/tmp/custom-reports' };
  const savedIntegrationsPatches = [];
  const analyzeCalls = [];
  const pushCalls = [];
  const testPushCalls = [];
  const queryPushCalls = [];
  const copyBridgeCalls = [];
  let regenBridgeCalls = 0;
  let historyCalls = 0;
  const cancelledQrSessions = [];
  const provisionCalls = [];
  const copiedTexts = [];
  let integrationsState = {
    ok: true,
    ai: { enabled: false, protocol: 'openai-compatible', providerLabel: '', baseUrl: '', model: '', language: 'zh-CN', apiKeyConfigured: false, autoAnalyzeOnRollover: false },
    openclaw: {
      enabled: false,
      mode: 'openclaw-agent',
      webhookUrl: '',
      channel: 'openclaw-weixin',
      to: '',
      agentId: 'main',
      hookTokenConfigured: false,
      pushOnRollover: false,
      includeAiAnalysis: true,
      includeLimits: true,
      events: { rollover: false, sessionCompleted: false, approvalAlerts: false, quotaAlerts: false, serviceIncidents: false },
      sessionCompletion: {
        clients: [],
        excludeSubagents: true,
        excludeBackgroundReview: true,
        minTurnTokens: 0,
        minTotalTokens: 0,
        debounceMs: 2500,
        cooldownMs: 0,
        includeDetailSummary: false,
        includeAiSummary: false
      },
      quotaAlerts: { thresholdPercent: 20, notifyRecovery: true },
      queryPermissions: { allowSessionDetail: false, allowConversationText: false },
      localBridge: { enabled: false, port: 17322 }
    },
    lastPush: null
  };
  let analyzeResult = { ok: true, aiAnalysis: { model: 'deepseek-chat', summaryMarkdown: 'AI OK' } };
  let pushResult = { ok: true, channel: 'openclaw-weixin', lastPush: { ok: true, at: '2026-11-16T22:00:00Z' } };
  let testPushResult = { ok: true, eventType: 'test', channel: 'openclaw-weixin', lastPush: { ok: true, at: '2026-11-17T08:00:00Z' } };
  let queryPushResult = { ok: true, eventType: 'query_digest', channel: 'openclaw-weixin', lastPush: { ok: true, at: '2026-11-17T08:05:00Z' } };
  let pushHistoryState = { ok: true, count: 0, lastPush: null, history: [] };
  let localBridgeStatusState = {
    ok: true,
    enabled: false,
    running: false,
    port: 17322,
    endpointUrl: 'http://127.0.0.1:17322/api/mcp',
    baseUrl: 'http://127.0.0.1:17322',
    tokenConfigured: false,
    maskedToken: ''
  };
  let regenBridgeResult = {
    ok: true,
    enabled: true,
    running: true,
    port: 17322,
    endpointUrl: 'http://127.0.0.1:17322/api/mcp',
    tokenConfigured: true,
    maskedToken: '••••new1'
  };
  let copyBridgeResult = { ok: true, copied: true };
  let testPushHandler = null;
  let queryPushHandler = null;
  let saveIntegrationsHandler = null;
  let openclawEnvResult = {
    ok: true,
    cliInstalled: true,
    pluginInstalled: true,
    pluginEnabled: true,
    hooksEnabled: true,
    hooksTokenConfigured: true,
    gatewayPort: 18789,
    gatewayReachable: true,
    suggestedWebhookUrl: 'http://127.0.0.1:18789/hooks/agent',
    skillInstalled: true,
    accounts: []
  };
  let qrStartHandler = async () => ({
    ok: true,
    sessionId: 'qr-session-1',
    qrcodeImgContent: 'https://liteapp.weixin.qq.com/q/7?qrcode=demo',
    status: 'wait'
  });
  let qrPollHandler = async (sessionId) => ({ ok: true, sessionId, status: 'wait' });
  let qrVerifyHandler = async (sessionId) => ({ ok: true, sessionId, status: 'confirmed' });
  let provisionHandler = async () => ({ ok: true, webhookUrl: 'http://127.0.0.1:18789/hooks/agent', env: openclawEnvResult });

  const scheduledTimers = new Map();
  let nextTimerId = 1;
  const windowListeners = new Map();

  const tokenMonitor = {
    async pickReportsDir() {
      return pickDirResult;
    },
    async openReportsDir() {
      return openDirResult;
    },
    async generateReportsNow() {
      return generateResult;
    },
    async getReportIntegrations() {
      return integrationsState;
    },
    async saveReportIntegrations(patch) {
      if (saveIntegrationsHandler) {
        return saveIntegrationsHandler(patch);
      }
      savedIntegrationsPatches.push(patch);
      integrationsState = {
        ...integrationsState,
        ai: {
          ...integrationsState.ai,
          ...(patch.ai || {}),
          apiKeyConfigured: Boolean(patch.ai?.apiKey || (integrationsState.ai.apiKeyConfigured && !patch.ai?.clearApiKey))
        },
        openclaw: {
          ...integrationsState.openclaw,
          ...(patch.openclaw || {}),
          hookTokenConfigured: Boolean(patch.openclaw?.hookToken || (integrationsState.openclaw.hookTokenConfigured && !patch.openclaw?.clearHookToken))
        }
      };
      return integrationsState;
    },
    async analyzeReportWithAi(payload) {
      analyzeCalls.push(payload);
      return analyzeResult;
    },
    async pushReportToOpenClaw(payload) {
      pushCalls.push(payload);
      return pushResult;
    },
    async getOpenClawPushHistory() {
      historyCalls += 1;
      return pushHistoryState;
    },
    async testOpenClawPush(payload) {
      testPushCalls.push(payload);
      if (testPushHandler) return testPushHandler(payload);
      return testPushResult;
    },
    async pushQueryToOpenClaw(payload) {
      queryPushCalls.push(payload);
      if (queryPushHandler) return queryPushHandler(payload);
      return queryPushResult;
    },
    async getOpenClawLocalBridgeStatus() {
      return localBridgeStatusState;
    },
    async copyLocalBridgeConfig(payload) {
      copyBridgeCalls.push(payload);
      return copyBridgeResult;
    },
    async regenerateOpenClawLocalBridgeToken() {
      regenBridgeCalls += 1;
      localBridgeStatusState = { ...regenBridgeResult };
      return regenBridgeResult;
    },
    async getOpenClawEnv() {
      return openclawEnvResult;
    },
    async startOpenClawWeixinQr() {
      return qrStartHandler();
    },
    async pollOpenClawWeixinQrStatus(sessionId) {
      return qrPollHandler(sessionId);
    },
    async submitOpenClawWeixinVerifyCode(sessionId, verifyCode) {
      return qrVerifyHandler(sessionId, verifyCode);
    },
    async cancelOpenClawWeixinQr(sessionId) {
      cancelledQrSessions.push(sessionId);
      return { ok: true, sessionId, status: 'cancelled' };
    },
    async provisionOpenClaw(options) {
      provisionCalls.push(options);
      return provisionHandler(options);
    },
    async copyText(text) {
      copiedTexts.push(text);
      return { ok: true };
    }
  };

  const qrSvg = require('../../src/shared/qrSvg');
  const start = rendererSource.indexOf('let reportsGenerating = false;');
  const end = rendererSource.indexOf('\nels.resetClientDisplayOrderButton?.addEventListener', start);
  assert.ok(start >= 0 && end > start, 'could not locate reports UI section in app.js');

  const windowObj = {
    tokenMonitor,
    TokenMonitorQrSvg: qrSvg,
    addEventListener(type, handler) {
      const existing = windowListeners.get(type);
      if (existing) existing.push(handler);
      else windowListeners.set(type, [handler]);
    },
    async trigger(type, event = {}) {
      const handlers = windowListeners.get(type) || [];
      for (const handler of handlers) {
        await handler(event);
      }
    }
  };

  const context = {
    els,
    state,
    URL,
    TokenMonitorQrSvg: qrSvg,
    document: {
      createElement(tagName) {
        return createElementStub(tagName);
      },
      createElementNS(ns, tagName) {
        const node = createSvgNodeStub(tagName);
        node.namespaceURI = ns;
        return node;
      }
    },
    setTimeout(fn, ms) {
      const id = nextTimerId++;
      scheduledTimers.set(id, { fn, ms });
      return id;
    },
    clearTimeout(id) {
      scheduledTimers.delete(id);
    },
    window: windowObj,
    t: (key, params = {}) => {
      let text = MESSAGES.en[key] || key;
      for (const [k, v] of Object.entries(params)) {
        text = text.replaceAll(`{${k}}`, String(v));
      }
      return text;
    },
    saveSettings: async (patch) => {
      if (rejectSave) throw new Error('save failed');
      savedPatches.push(patch);
      Object.assign(state.settings, patch);
      context.renderReportsSettings();
    }
  };

  vm.runInNewContext(
    `${rendererSource.slice(start, end)}
this.renderReportsSettings = renderReportsSettings;
this.formatReportsError = formatReportsError;
this.cancelOpenClawQrIfActive = cancelOpenClawQrIfActive;
this.isOpenClawQuickPushAvailable = isOpenClawQuickPushAvailable;
this.syncOpenClawQuickPushButton = syncOpenClawQuickPushButton;
this.triggerOpenClawQuickPush = triggerOpenClawQuickPush;
this.createSessionDetailOpenClawPushButton = createSessionDetailOpenClawPushButton;
this.quickPushQueryForCurrentView = quickPushQueryForCurrentView;
this.syncReportIntegrationsFromSettings = syncReportIntegrationsFromSettings;`,
    context
  );

  return {
    els,
    state,
    tokenMonitor,
    context,
    savedPatches,
    savedIntegrationsPatches,
    analyzeCalls,
    pushCalls,
    testPushCalls,
    queryPushCalls,
    copyBridgeCalls,
    getRegenBridgeCalls: () => regenBridgeCalls,
    getHistoryCalls: () => historyCalls,
    cancelledQrSessions,
    provisionCalls,
    copiedTexts,
    scheduledTimers,
    async flushNextTimer() {
      const entries = [...scheduledTimers.entries()].sort((a, b) => a[1].ms - b[1].ms);
      if (entries.length === 0) return false;
      const [id, entry] = entries[0];
      scheduledTimers.delete(id);
      await entry.fn();
      return true;
    },
    setRejectSave(value) { rejectSave = value; },
    setGenerateResult(value) { generateResult = value; },
    setPickDirResult(value) { pickDirResult = value; },
    setOpenDirResult(value) { openDirResult = value; },
    setIntegrationsState(value) { integrationsState = value; },
    setSaveIntegrationsHandler(fn) { saveIntegrationsHandler = fn; },
    setAnalyzeResult(value) { analyzeResult = value; },
    setPushResult(value) { pushResult = value; },
    setTestPushResult(value) { testPushResult = value; },
    setTestPushHandler(fn) { testPushHandler = fn; },
    setQueryPushResult(value) { queryPushResult = value; },
    setQueryPushHandler(fn) { queryPushHandler = fn; },
    setPushHistoryState(value) { pushHistoryState = value; },
    setLocalBridgeStatusState(value) { localBridgeStatusState = value; },
    setRegenBridgeResult(value) { regenBridgeResult = value; },
    setCopyBridgeResult(value) { copyBridgeResult = value; },
    setOpenClawEnvResult(value) { openclawEnvResult = value; },
    setQrStartHandler(fn) { qrStartHandler = fn; },
    setQrPollHandler(fn) { qrPollHandler = fn; },
    setQrVerifyHandler(fn) { qrVerifyHandler = fn; },
    setProvisionHandler(fn) { provisionHandler = fn; }
  };
}

test('main.js and preload.js wire report settings, hub options, and IPC channels', () => {
  assert.match(mainSource, /reportsEnabled: parseBoolean\(process\.env\.TOKEN_MONITOR_REPORTS_ENABLED, false\)/);
  assert.match(mainSource, /reportsDaily: parseBoolean\(process\.env\.TOKEN_MONITOR_REPORTS_DAILY, true\)/);
  assert.match(mainSource, /reportsWeekly: parseBoolean\(process\.env\.TOKEN_MONITOR_REPORTS_WEEKLY, true\)/);
  assert.match(mainSource, /reportsMonthly: parseBoolean\(process\.env\.TOKEN_MONITOR_REPORTS_MONTHLY, true\)/);
  assert.match(mainSource, /reports:\s*\{\s*enabled:\s*settings\.reportsEnabled === true/);
  assert.match(mainSource, /reportsDir:\s*settings\.reportsDir \|\| ''/);
  assert.match(mainSource, /embeddedHub\?\.hub\?\.setReportConfig\?\.\(reportsConfigFromSettings\(settings\)\)/);
  assert.match(mainSource, /\(receiverPermissionChanged \|\| reportsDirChanged\) && settings\.hubMode === 'host'/);

  for (const channel of ['reports:pickDir', 'reports:openDir', 'reports:generateNow', 'reports:list']) {
    assert.match(mainSource, new RegExp(`ipcMain\\.handle\\('${channel}'`), `${channel} handler missing`);
  }
  for (const [method, channel] of [
    ['pickReportsDir', 'reports:pickDir'],
    ['generateReportsNow', 'reports:generateNow'],
    ['listReports', 'reports:list'],
    ['openReportsDir', 'reports:openDir']
  ]) {
    assert.match(preloadSource, new RegExp(`${method}:\\s*\\([^)]*\\)\\s*=>\\s*ipcRenderer\\.invoke\\('${channel}'`), `${method} missing in preload.js`);
  }
});

test('index.html exposes all required report control IDs and localized keys', () => {
  for (const id of [
    'reportsSettingsGroup',
    'reportsHostRequiredNote',
    'reportsEnableHostButton',
    'reportsEnabledInput',
    'reportsDailyInput',
    'reportsWeeklyInput',
    'reportsMonthlyInput',
    'reportsDirLabel',
    'reportsPickDirButton',
    'reportsOpenDirButton',
    'reportsGenerateNowButton',
    'reportsStatusText',
    'reportsAiPanel',
    'reportsAiEnabledInput',
    'reportsOpenClawPanel',
    'reportsOpenClawEnabledInput',
    'reportsOpenClawEnvSummary',
    'reportsOpenClawQrScanButton',
    'reportsOpenClawProvisionButton',
    'reportsOpenClawQrCard',
    'reportsOpenClawQrBox',
    'reportsOpenClawQrStatusText',
    'reportsOpenClawQrVerifyRow',
    'reportsOpenClawQrVerifyInput',
    'reportsOpenClawQrVerifyButton',
    'reportsOpenClawQrRefreshButton',
    'reportsOpenClawQrCopyLinkButton',
    'reportsOpenClawQrCancelButton',
    'reportsOpenClawQrGuideText',
    'reportsOpenClawEventsSection',
    'reportsOpenClawEventSessionCompletedInput',
    'reportsOpenClawEventApprovalAlertsInput',
    'reportsOpenClawEventQuotaAlertsInput',
    'reportsOpenClawQuotaThresholdInput',
    'reportsOpenClawQuotaNotifyRecoveryInput',
    'reportsOpenClawEventServiceIncidentsInput',
    'reportsOpenClawSessionSection',
    'reportsOpenClawSessionToggle',
    'reportsOpenClawSessionDetails',
    'reportsOpenClawExcludeSubagentsInput',
    'reportsOpenClawExcludeBackgroundReviewInput',
    'reportsOpenClawSessionIncludeDetailInput',
    'reportsOpenClawSessionIncludeAiInput',
    'reportsOpenClawMinTurnTokensInput',
    'reportsOpenClawMinTotalTokensInput',
    'reportsOpenClawDebounceMsInput',
    'reportsOpenClawCooldownMsInput',
    'reportsOpenClawClientsInput',
    'reportsOpenClawPrivacySection',
    'reportsOpenClawAllowSessionDetailInput',
    'reportsOpenClawAllowConversationTextInput',
    'reportsOpenClawLocalBridgeSection',
    'reportsOpenClawLocalBridgeEnabledInput',
    'reportsOpenClawLocalBridgePortInput',
    'reportsOpenClawLocalBridgeEndpoint',
    'reportsOpenClawLocalBridgeStatusText',
    'reportsOpenClawLocalBridgeCopyTokenButton',
    'reportsOpenClawLocalBridgeCopyMcpButton',
    'reportsOpenClawLocalBridgeRegenTokenButton',
    'reportsOpenClawTestPushButton',
    'reportsOpenClawPushUsageButton',
    'reportsOpenClawHistorySection',
    'reportsOpenClawHistoryRefreshButton',
    'reportsOpenClawHistoryEmpty',
    'reportsOpenClawHistoryList',
    'openClawQuickPushButton',
    'openClawToast'
  ]) {
    assert.match(htmlSource, new RegExp(`id="${id}"`), `index.html missing #${id}`);
  }

  const qrScriptPos = htmlSource.indexOf('<script src="../../shared/qrSvg.js"></script>');
  const appScriptPos = htmlSource.indexOf('<script src="app.js"></script>');
  assert.ok(qrScriptPos >= 0 && appScriptPos > qrScriptPos, 'qrSvg.js must load before app.js');

  const section = htmlSource.split('id="reportsSettingsGroup"')[1].split('id="syncDevicePanel"')[0];
  assert.match(section, /:18789\/hooks\/agent/);
  assert.doesNotMatch(section, /:19001\/hooks\/agent/);

  const attrKeys = [
    ...section.matchAll(/data-i18n(?:-(?:aria-label|placeholder))?="([^"]+)"/g)
  ].map((match) => match[1]);
  const enReportKeys = Object.keys(MESSAGES.en).filter((key) => key.startsWith('settings.reports.') || key.startsWith('openclaw.quickPush.'));
  const allKeys = [...new Set([...attrKeys, ...enReportKeys])];
  assert.ok(allKeys.length >= 60);
  for (const locale of LANGUAGE_OPTIONS.map((opt) => opt.value).filter((value) => value !== 'auto')) {
    for (const key of allKeys) {
      assert.ok(MESSAGES[locale][key]?.trim(), `${locale} missing ${key}`);
    }
  }
});

test('renderReportsSettings adapts visibility, disabled states, and MCP status across hub modes', async () => {
  const { els, state, context, savedPatches } = createRendererReportsHarness();

  state.settings.hubMode = 'local';
  context.renderReportsSettings();
  assert.equal(els.reportsHostRequiredNote.hidden, false);
  assert.equal(els.reportsEnableHostButton.disabled, false);
  assert.equal(els.reportsHostControls.hidden, true);
  assert.equal(els.reportsHostControls.inert, true);
  assert.equal(els.reportsActionsRow.hidden, true);
  assert.equal(els.reportsGenerateNowButton.disabled, true);
  assert.equal(els.reportsIntegrationsControls.hidden, false);
  assert.equal(els.reportsAiPanel.hidden, true);
  assert.equal(els.reportsAiPanel.inert, true);
  assert.equal(els.reportsOpenClawPanel.hidden, false);
  assert.equal(els.reportsOpenClawPanel.inert, false);
  assert.equal(els.reportsOpenClawLocalBridgeSection.hidden, false);
  assert.equal(els.reportsOpenClawLocalBridgeSection.inert, false);
  assert.equal(els.reportsOpenClawSaveButton.disabled, false);
  assert.equal(els.reportsOpenClawTestPushButton.disabled, false);
  assert.equal(els.reportsOpenClawPushUsageButton.disabled, false);
  assert.equal(els.reportsOpenClawPushNowButton.disabled, false);
  assert.equal(els.reportsOpenClawQrScanButton.disabled, false);

  await els.reportsEnableHostButton.trigger('click');
  assert.deepEqual({ ...savedPatches.at(-1) }, { hubMode: 'host' });
  assert.equal(state.settings.hubMode, 'host');
  assert.equal(els.reportsHostControls.hidden, false);
  assert.equal(els.reportsAiPanel.hidden, false);
  assert.equal(els.reportsAiPanel.inert, false);
  assert.equal(els.reportsOpenClawLocalBridgeSection.hidden, true);
  assert.equal(els.reportsOpenClawLocalBridgeSection.inert, true);

  state.settings.hubMode = 'icloud';
  context.renderReportsSettings();
  assert.equal(els.reportsIntegrationsControls.hidden, true);
  assert.equal(els.reportsIntegrationsControls.inert, true);
  assert.equal(els.reportsOpenClawPanel.hidden, true);
  assert.equal(els.reportsOpenClawPanel.inert, true);
  assert.equal(els.reportsOpenClawSaveButton.disabled, true);
  assert.equal(els.reportsOpenClawTestPushButton.disabled, true);
  assert.equal(els.reportsOpenClawPushUsageButton.disabled, true);
  assert.equal(els.reportsOpenClawPushNowButton.disabled, true);
  assert.equal(els.reportsOpenClawQrScanButton.disabled, true);

  state.settings.hubMode = 'local';
  context.renderReportsSettings();

  state.settings.hubMode = 'client';
  context.renderReportsSettings();
  assert.equal(els.reportsHostRequiredNote.hidden, true);
  assert.equal(els.reportsHostControls.hidden, true);
  assert.equal(els.reportsActionsRow.hidden, false);
  assert.equal(els.reportsGenerateNowButton.disabled, false);
  assert.equal(els.reportsOpenClawSaveButton.disabled, false);
  assert.equal(els.reportsOpenClawLocalBridgeSection.hidden, true);
  assert.match(els.reportsStatusText.textContent, /\/api\/mcp/);

  state.settings.hubMode = 'host';
  state.settings.hubHostPort = 18443;
  context.renderReportsSettings();
  assert.equal(els.reportsHostRequiredNote.hidden, true);
  assert.equal(els.reportsHostControls.hidden, false);
  assert.equal(els.reportsActionsRow.hidden, false);
  assert.equal(els.reportsEnabledInput.checked, false);
  assert.equal(els.reportsDailyInput.disabled, true);
  assert.equal(els.reportsWeeklyInput.disabled, true);
  assert.equal(els.reportsMonthlyInput.disabled, true);
  assert.equal(els.reportsScheduleList.classList.contains('is-disabled'), true);
  assert.equal(els.reportsDirLabel.textContent, 'Default (Hub reports directory)');
  assert.equal(els.reportsStatusText.textContent, 'MCP endpoint: http://127.0.0.1:18443/api/mcp');

  state.settings.reportsEnabled = true;
  state.settings.reportsDir = '/tmp/my-reports';
  context.renderReportsSettings();
  assert.equal(els.reportsEnabledInput.checked, true);
  assert.equal(els.reportsDailyInput.disabled, false);
  assert.equal(els.reportsWeeklyInput.disabled, false);
  assert.equal(els.reportsMonthlyInput.disabled, false);
  assert.equal(els.reportsScheduleList.classList.contains('is-disabled'), false);
  assert.equal(els.reportsDirLabel.textContent, '/tmp/my-reports');
});

test('report toggles, directory picker, open folder, and generate now update settings and status', async () => {
  const { els, state, context, savedPatches, setRejectSave, setGenerateResult, setOpenDirResult } = createRendererReportsHarness();
  context.renderReportsSettings();

  els.reportsEnabledInput.checked = true;
  await els.reportsEnabledInput.trigger('change');
  assert.deepEqual({ ...savedPatches.at(-1) }, { reportsEnabled: true });
  assert.equal(state.settings.reportsEnabled, true);
  assert.equal(els.reportsDailyInput.disabled, false);

  els.reportsWeeklyInput.checked = false;
  await els.reportsWeeklyInput.trigger('change');
  assert.deepEqual({ ...savedPatches.at(-1) }, { reportsWeekly: false });
  assert.equal(state.settings.reportsWeekly, false);

  setRejectSave(true);
  els.reportsMonthlyInput.checked = false;
  await els.reportsMonthlyInput.trigger('change');
  assert.equal(els.reportsMonthlyInput.checked, true);
  assert.equal(els.reportsMonthlyInput.disabled, false);
  setRejectSave(false);

  await els.reportsPickDirButton.trigger('click');
  assert.deepEqual({ ...savedPatches.at(-1) }, { reportsDir: '/tmp/custom-reports' });
  assert.equal(els.reportsDirLabel.textContent, '/tmp/custom-reports');

  await els.reportsGenerateNowButton.trigger('click');
  assert.equal(els.reportsStatusText.textContent, 'Generated 2 report(s)');
  assert.equal(els.reportsGenerateNowButton.disabled, false);

  setGenerateResult({ ok: false, error: 'hub_not_running' });
  await els.reportsGenerateNowButton.trigger('click');
  assert.equal(els.reportsStatusText.textContent, 'Main Hub is not running');

  setOpenDirResult({ ok: false, error: 'permission denied' });
  await els.reportsOpenDirButton.trigger('click');
  assert.equal(els.reportsStatusText.textContent, 'permission denied');
});

test('AI API and OpenClaw WeChat integration controls save, redact secrets, analyze, and push', async () => {
  const { els, state, context, savedIntegrationsPatches } = createRendererReportsHarness();
  state.settings.hubMode = 'host';
  context.renderReportsSettings();
  assert.equal(els.reportsIntegrationsControls.hidden, false);

  els.reportsAiEnabledInput.checked = true;
  els.reportsAiProtocolInput.value = 'openai-compatible';
  els.reportsAiProviderLabelInput.value = 'DeepSeek';
  els.reportsAiBaseUrlInput.value = 'https://api.deepseek.com/v1';
  els.reportsAiModelInput.value = 'deepseek-chat';
  els.reportsAiApiKeyInput.value = 'sk-ui-secret';
  await els.reportsAiSaveButton.trigger('click');
  assert.equal(savedIntegrationsPatches.at(-1).ai.apiKey, 'sk-ui-secret');
  assert.equal(els.reportsAiApiKeyInput.value, '');
  assert.equal(els.reportsAiStatusText.textContent, 'AI settings saved');

  await els.reportsAiAnalyzeNowButton.trigger('click');
  assert.equal(els.reportsAiPreview.textContent, 'AI OK');
  assert.equal(els.reportsAiStatusText.textContent, 'AI analysis updated (deepseek-chat)');

  els.reportsOpenClawEnabledInput.checked = true;
  els.reportsOpenClawModeInput.value = 'openclaw-agent';
  els.reportsOpenClawWebhookUrlInput.value = 'http://127.0.0.1:18789/hooks/agent';
  els.reportsOpenClawChannelInput.value = 'openclaw-weixin';
  els.reportsOpenClawToInput.value = 'wxid_demo';
  els.reportsOpenClawHookTokenInput.value = 'oc-token';
  await els.reportsOpenClawSaveButton.trigger('click');
  assert.equal(savedIntegrationsPatches.at(-1).openclaw.hookToken, 'oc-token');
  assert.equal(els.reportsOpenClawHookTokenInput.value, '');
  assert.equal(els.reportsOpenClawStatusText.textContent, 'OpenClaw settings saved');

  await els.reportsOpenClawPushNowButton.trigger('click');
  assert.equal(els.reportsOpenClawStatusText.textContent, 'Delivered to OpenClaw (openclaw-weixin)');
});

test('Host mode preserves dirty unfocused AI edits across Save, finally, and background settings:push', async () => {
  const harness = createRendererReportsHarness();
  const { els, state, context, savedIntegrationsPatches } = harness;
  const staleDisabledSnapshot = {
    ai: {
      enabled: false,
      protocol: 'openai-compatible',
      providerLabel: '',
      baseUrl: '',
      model: '',
      language: 'zh-CN',
      apiKeyConfigured: false,
      autoAnalyzeOnRollover: false
    },
    openclaw: {
      enabled: false,
      mode: 'openclaw-agent',
      webhookUrl: '',
      channel: 'openclaw-weixin',
      to: '',
      agentId: 'main',
      hookTokenConfigured: false,
      pushOnRollover: false,
      includeAiSummary: true,
      includeLimitsSnapshot: true
    }
  };
  harness.setIntegrationsState({ ok: true, ...staleDisabledSnapshot, lastPush: null });
  state.settings.hubMode = 'host';
  state.settings.reportIntegrations = structuredClone(staleDisabledSnapshot);
  context.renderReportsSettings();
  await Promise.resolve();

  // Simulate user editing fields without keeping any element focused when clicking Save
  els.reportsAiEnabledInput.checked = true;
  await els.reportsAiEnabledInput.trigger('change');
  els.reportsAiBaseUrlInput.value = 'https://api.deepseek.com/v1';
  await els.reportsAiBaseUrlInput.trigger('input');
  els.reportsAiModelInput.value = 'deepseek-chat';
  await els.reportsAiModelInput.trigger('input');
  els.reportsAiApiKeyInput.value = 'sk-ui-dirty-secret';
  await els.reportsAiApiKeyInput.trigger('input');
  els.reportsAiLanguageInput.value = 'en';
  await els.reportsAiLanguageInput.trigger('change');
  els.reportsAiAutoAnalyzeInput.checked = true;
  await els.reportsAiAutoAnalyzeInput.trigger('change');
  for (const el of Object.values(els)) {
    el.blur();
    assert.equal(el.matches(':focus'), false);
  }

  harness.setSaveIntegrationsHandler(async (patch) => {
    savedIntegrationsPatches.push(patch);
    // Simulate a concurrent background settings:push arriving mid-save with stale snapshot
    state.settings.reportIntegrations = structuredClone(staleDisabledSnapshot);
    context.renderReportsSettings();
    assert.equal(els.reportsAiEnabledInput.checked, true);
    assert.equal(els.reportsAiBaseUrlInput.value, 'https://api.deepseek.com/v1');

    return {
      ok: true,
      ai: {
        ...staleDisabledSnapshot.ai,
        ...(patch.ai || {}),
        apiKeyConfigured: true
      },
      openclaw: staleDisabledSnapshot.openclaw,
      lastPush: null
    };
  });

  await els.reportsAiSaveButton.trigger('click');

  const savedAi = savedIntegrationsPatches.at(-1).ai;
  assert.equal(savedAi.enabled, true);
  assert.equal(savedAi.baseUrl, 'https://api.deepseek.com/v1');
  assert.equal(savedAi.model, 'deepseek-chat');
  assert.equal(savedAi.apiKey, 'sk-ui-dirty-secret');
  assert.equal(savedAi.language, 'en');
  assert.equal(savedAi.autoAnalyzeOnRollover, true);

  // Verify finally + subsequent settings render keep saved values intact
  context.renderReportsSettings();
  assert.equal(els.reportsAiEnabledInput.checked, true);
  assert.equal(els.reportsAiBaseUrlInput.value, 'https://api.deepseek.com/v1');
  assert.equal(els.reportsAiModelInput.value, 'deepseek-chat');
  assert.equal(els.reportsAiLanguageInput.value, 'en');
  assert.equal(els.reportsAiAutoAnalyzeInput.checked, true);
  assert.equal(els.reportsAiApiKeyInput.value, '');
  assert.equal(state.settings.reportIntegrations.ai.enabled, true);
});

test('AI validation blocks invalid enabled saves cleanly and Analyze Now auto-saves dirty valid config', async () => {
  const harness = createRendererReportsHarness();
  const { els, state, context, savedIntegrationsPatches, analyzeCalls } = harness;
  state.settings.hubMode = 'host';
  context.renderReportsSettings();

  // Invalid URL when enabled must not save and must not wipe user input
  els.reportsAiEnabledInput.checked = true;
  await els.reportsAiEnabledInput.trigger('change');
  els.reportsAiBaseUrlInput.value = 'ftp://not-http.example/v1';
  await els.reportsAiBaseUrlInput.trigger('input');
  els.reportsAiModelInput.value = 'deepseek-chat';
  await els.reportsAiModelInput.trigger('input');
  els.reportsAiApiKeyInput.value = 'sk-keep-me';
  await els.reportsAiApiKeyInput.trigger('input');

  await els.reportsAiSaveButton.trigger('click');
  assert.equal(savedIntegrationsPatches.length, 0);
  assert.equal(els.reportsAiStatusText.textContent, MESSAGES.en['settings.reports.errAiInvalidUrl']);
  assert.equal(els.reportsAiBaseUrlInput.value, 'ftp://not-http.example/v1');
  assert.equal(els.reportsAiApiKeyInput.value, 'sk-keep-me');

  // Dirty analyze click with invalid config must abort before calling analyzeReportWithAi
  await els.reportsAiAnalyzeNowButton.trigger('click');
  assert.equal(analyzeCalls.length, 0);
  assert.equal(els.reportsAiStatusText.textContent, MESSAGES.en['settings.reports.errAiInvalidUrl']);

  // Fix URL without clicking Save first -> Analyze Now must auto-save then analyze
  els.reportsAiBaseUrlInput.value = 'https://api.deepseek.com/v1';
  await els.reportsAiBaseUrlInput.trigger('input');
  await els.reportsAiAnalyzeNowButton.trigger('click');

  assert.equal(savedIntegrationsPatches.length, 1);
  assert.equal(savedIntegrationsPatches[0].ai.enabled, true);
  assert.equal(savedIntegrationsPatches[0].ai.baseUrl, 'https://api.deepseek.com/v1');
  assert.equal(savedIntegrationsPatches[0].ai.apiKey, 'sk-keep-me');
  assert.equal(els.reportsAiApiKeyInput.value, '');
  assert.equal(analyzeCalls.length, 1);
  assert.equal(els.reportsAiPreview.textContent, 'AI OK');
});

test('clear buttons report errors safely and formatReportsError localizes documented error codes', async () => {
  const harness = createRendererReportsHarness();
  const { els, state, context } = harness;
  state.settings.hubMode = 'host';
  context.renderReportsSettings();

  harness.setSaveIntegrationsHandler(async () => ({ ok: false, error: 'ai_missing_key' }));
  await els.reportsAiClearKeyButton.trigger('click');
  assert.equal(els.reportsAiStatusText.textContent, MESSAGES.en['settings.reports.errAiMissingKey']);
  assert.equal(els.reportsAiClearKeyButton.disabled, false);

  harness.setSaveIntegrationsHandler(async () => {
    throw new Error('openclaw_invalid_url');
  });
  await els.reportsOpenClawClearTokenButton.trigger('click');
  assert.equal(els.reportsOpenClawStatusText.textContent, MESSAGES.en['settings.reports.errOpenClawInvalidUrl']);
  assert.equal(els.reportsOpenClawClearTokenButton.disabled, false);

  const expectedMappings = [
    ['ai_disabled', 'settings.reports.errAiDisabled'],
    ['ai_not_configured', 'settings.reports.errAiNotConfigured'],
    ['ai_invalid_url', 'settings.reports.errAiInvalidUrl'],
    ['ai_missing_key', 'settings.reports.errAiMissingKey'],
    ['ai_token_limit', 'settings.reports.errAiTokenLimit'],
    ['ai_empty_response', 'settings.reports.errAiEmptyResponse'],
    ['not_found', 'settings.reports.errReportNotFound'],
    ['openclaw_disabled', 'settings.reports.errOpenClawDisabled'],
    ['openclaw_invalid_url', 'settings.reports.errOpenClawInvalidUrl'],
    ['openclaw_missing_recipient', 'settings.reports.errOpenClawMissingTarget'],
    ['openclaw_missing_target', 'settings.reports.errOpenClawMissingTarget']
  ];
  for (const [code, i18nKey] of expectedMappings) {
    assert.equal(context.formatReportsError(code), MESSAGES.en[i18nKey]);
    assert.notEqual(context.formatReportsError(code), code);
  }
});

test('OpenClaw WeChat QR onboarding renders SVG, polls through verify code and confirmation, copies link, provisions, and cancels cleanly', async () => {
  const harness = createRendererReportsHarness();
  const {
    els,
    state,
    context,
    cancelledQrSessions,
    provisionCalls,
    copiedTexts,
    scheduledTimers,
    flushNextTimer
  } = harness;
  state.settings.hubMode = 'host';
  context.renderReportsSettings();

  let pollStep = 0;
  const pollResponses = [
    { ok: true, sessionId: 'qr-session-1', status: 'wait' },
    { ok: true, sessionId: 'qr-session-1', status: 'scaned' },
    { ok: true, sessionId: 'qr-session-1', status: 'need_verifycode' }
  ];
  harness.setQrPollHandler(async (sessionId) => pollResponses[pollStep++] || { ok: true, sessionId, status: 'wait' });
  harness.setQrVerifyHandler(async (sessionId, verifyCode) => {
    assert.equal(sessionId, 'qr-session-1');
    assert.equal(verifyCode, '654321');
    return {
      ok: true,
      sessionId,
      status: 'confirmed',
      accountId: 'acc-1',
      userId: 'wxid_bound_user',
      openclaw: {
        enabled: true,
        mode: 'openclaw-agent',
        webhookUrl: 'http://127.0.0.1:18789/hooks/agent',
        channel: 'openclaw-weixin',
        to: 'wxid_bound_user',
        agentId: 'main',
        hookTokenConfigured: true
      },
      openclawEnv: {
        ok: true,
        cliInstalled: true,
        pluginInstalled: true,
        pluginEnabled: true,
        hooksEnabled: true,
        hooksTokenConfigured: true,
        gatewayPort: 18789,
        gatewayReachable: true,
        suggestedWebhookUrl: 'http://127.0.0.1:18789/hooks/agent',
        skillInstalled: true,
        accounts: [{ accountId: 'acc-1', userId: 'wxid_bound_user' }]
      }
    };
  });

  await els.reportsOpenClawQrScanButton.trigger('click');
  assert.equal(els.reportsOpenClawQrCard.hidden, false);
  assert.equal(els.reportsOpenClawQrBox.children.length, 1);
  const svgNode = els.reportsOpenClawQrBox.children[0];
  assert.equal(svgNode.tagName, 'svg');
  assert.equal(svgNode.getAttribute('shape-rendering'), 'crispEdges');
  assert.equal(svgNode.children.some((node) => node.tagName === 'rect' && node.getAttribute('fill') === '#ffffff'), true);
  assert.equal(
    svgNode.children.some(
      (node) => node.tagName === 'path' && node.getAttribute('fill') === '#111111' && Boolean(node.getAttribute('d'))
    ),
    true
  );

  await els.reportsOpenClawQrCopyLinkButton.trigger('click');
  assert.equal(copiedTexts.at(-1), 'https://liteapp.weixin.qq.com/q/7?qrcode=demo');

  const flushMicrotasks = async () => {
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
  };

  const pollTimerCount = () => [...scheduledTimers.values()].filter((entry) => entry.ms < 1000).length;

  // First immediate poll saw 'wait' and scheduled timer for next poll (plus copy-link 1500ms timer)
  await flushMicrotasks();
  assert.equal(pollTimerCount(), 1);
  assert.equal(await flushNextTimer(), true); // 'scaned'
  await flushMicrotasks();
  assert.equal(pollTimerCount(), 1);
  assert.equal(await flushNextTimer(), true); // 'need_verifycode'
  await flushMicrotasks();
  assert.equal(els.reportsOpenClawQrVerifyRow.hidden, false);
  assert.equal(pollTimerCount(), 0);
  // Flush the 1500ms copy-link feedback reset timer
  assert.equal(await flushNextTimer(), true);
  assert.equal(els.reportsOpenClawQrCopyLinkButton.textContent, MESSAGES.en['settings.reports.openclawQrCopyLink']);
  assert.equal(scheduledTimers.size, 0);

  // Dirty openclaw input prior to verify should be replaced with confirmed binding and cleared
  els.reportsOpenClawToInput.value = 'stale_recipient';
  await els.reportsOpenClawToInput.trigger('input');
  els.reportsOpenClawQrVerifyInput.value = '654321';
  await els.reportsOpenClawQrVerifyInput.trigger('keydown', { key: 'Enter', preventDefault() {} });

  assert.equal(els.reportsOpenClawEnabledInput.checked, true);
  assert.equal(els.reportsOpenClawToInput.value, 'wxid_bound_user');
  assert.equal(els.reportsOpenClawWebhookUrlInput.value, 'http://127.0.0.1:18789/hooks/agent');
  assert.equal(els.reportsOpenClawQrGuideText.hidden, false);
  assert.ok(els.reportsOpenClawQrGuideText.textContent.trim().length > 0);
  assert.equal(els.reportsOpenClawQrVerifyRow.hidden, true);
  context.renderReportsSettings();
  assert.equal(els.reportsOpenClawToInput.value, 'wxid_bound_user');

  // Start another QR session and verify Cancel halts polling and notifies backend
  harness.setQrStartHandler(async () => ({
    ok: true,
    sessionId: 'qr-session-cancel',
    qrcodeImgContent: 'https://liteapp.weixin.qq.com/q/7?qrcode=cancel',
    status: 'wait'
  }));
  harness.setQrPollHandler(async (sessionId) => ({ ok: true, sessionId, status: 'wait' }));
  await els.reportsOpenClawQrScanButton.trigger('click');
  await flushMicrotasks();
  assert.equal(scheduledTimers.size, 1);
  await els.reportsOpenClawQrCancelButton.trigger('click');
  assert.equal(cancelledQrSessions.includes('qr-session-cancel'), true);
  assert.equal(scheduledTimers.size, 0);
  assert.equal(els.reportsOpenClawQrCard.hidden, true);

  // Provision button invokes provisionOpenClaw and updates webhook/status
  els.reportsOpenClawAgentIdInput.value = 'ops-agent';
  await els.reportsOpenClawProvisionButton.trigger('click');
  assert.equal(provisionCalls.length, 1);
  assert.equal(provisionCalls[0].agentId, 'ops-agent');
  assert.equal(els.reportsOpenClawWebhookUrlInput.value, 'http://127.0.0.1:18789/hooks/agent');
  assert.ok(els.reportsOpenClawStatusText.textContent.trim().length > 0);
});

test('local mode persists nested OpenClaw config, collapsible filters, and dirty unfocused edits', async () => {
  const harness = createRendererReportsHarness();
  const { els, state, context, savedIntegrationsPatches } = harness;
  state.settings.hubMode = 'local';
  context.renderReportsSettings();
  await Promise.resolve();

  // Collapsible Session completion & filters starts collapsed and toggles cleanly
  assert.equal(els.reportsOpenClawSessionToggle.getAttribute('aria-expanded'), 'false');
  assert.equal(els.reportsOpenClawSessionDetails.hidden, true);
  assert.equal(els.reportsOpenClawSessionDetails.inert, true);
  await els.reportsOpenClawSessionToggle.trigger('click');
  assert.equal(els.reportsOpenClawSessionToggle.getAttribute('aria-expanded'), 'true');
  assert.equal(els.reportsOpenClawSessionDetails.hidden, false);
  assert.equal(els.reportsOpenClawSessionDetails.inert, false);

  // Edit top-level, event matrix, sessionCompletion filters, quotaAlerts, and localBridge
  els.reportsOpenClawEnabledInput.checked = true;
  await els.reportsOpenClawEnabledInput.trigger('change');
  els.reportsOpenClawWebhookUrlInput.value = 'http://127.0.0.1:18789/hooks/agent';
  await els.reportsOpenClawWebhookUrlInput.trigger('input');
  els.reportsOpenClawToInput.value = 'wxid_local_user';
  await els.reportsOpenClawToInput.trigger('input');

  els.reportsOpenClawPushOnRolloverInput.checked = true;
  await els.reportsOpenClawPushOnRolloverInput.trigger('change');
  els.reportsOpenClawEventSessionCompletedInput.checked = true;
  await els.reportsOpenClawEventSessionCompletedInput.trigger('change');
  els.reportsOpenClawEventApprovalAlertsInput.checked = true;
  await els.reportsOpenClawEventApprovalAlertsInput.trigger('change');
  els.reportsOpenClawEventQuotaAlertsInput.checked = true;
  await els.reportsOpenClawEventQuotaAlertsInput.trigger('change');
  els.reportsOpenClawEventServiceIncidentsInput.checked = true;
  await els.reportsOpenClawEventServiceIncidentsInput.trigger('change');

  els.reportsOpenClawQuotaThresholdInput.value = '15';
  await els.reportsOpenClawQuotaThresholdInput.trigger('input');
  els.reportsOpenClawQuotaNotifyRecoveryInput.checked = false;
  await els.reportsOpenClawQuotaNotifyRecoveryInput.trigger('change');

  els.reportsOpenClawExcludeSubagentsInput.checked = false;
  await els.reportsOpenClawExcludeSubagentsInput.trigger('change');
  els.reportsOpenClawExcludeBackgroundReviewInput.checked = false;
  await els.reportsOpenClawExcludeBackgroundReviewInput.trigger('change');
  els.reportsOpenClawSessionIncludeDetailInput.checked = true;
  await els.reportsOpenClawSessionIncludeDetailInput.trigger('change');
  els.reportsOpenClawSessionIncludeAiInput.checked = true;
  await els.reportsOpenClawSessionIncludeAiInput.trigger('change');
  els.reportsOpenClawMinTurnTokensInput.value = '500';
  await els.reportsOpenClawMinTurnTokensInput.trigger('input');
  els.reportsOpenClawMinTotalTokensInput.value = '1500';
  await els.reportsOpenClawMinTotalTokensInput.trigger('input');
  els.reportsOpenClawDebounceMsInput.value = '4000';
  await els.reportsOpenClawDebounceMsInput.trigger('input');
  els.reportsOpenClawCooldownMsInput.value = '60000';
  await els.reportsOpenClawCooldownMsInput.trigger('input');
  els.reportsOpenClawClientsInput.value = 'codex, Claude, codex';
  await els.reportsOpenClawClientsInput.trigger('input');

  els.reportsOpenClawLocalBridgeEnabledInput.checked = true;
  await els.reportsOpenClawLocalBridgeEnabledInput.trigger('change');
  els.reportsOpenClawLocalBridgePortInput.value = '18422';
  await els.reportsOpenClawLocalBridgePortInput.trigger('input');
  assert.equal(els.reportsOpenClawLocalBridgeEndpoint.textContent, 'http://127.0.0.1:18422/api/mcp');

  // Unfocused dirty edits survive background settings render before Save
  for (const el of Object.values(els)) el.blur();
  state.settings.reportIntegrations = {
    openclaw: { enabled: false, events: { rollover: false, sessionCompleted: false }, localBridge: { enabled: false, port: 17322 } }
  };
  context.renderReportsSettings();
  assert.equal(els.reportsOpenClawEnabledInput.checked, true);
  assert.equal(els.reportsOpenClawEventSessionCompletedInput.checked, true);
  assert.equal(els.reportsOpenClawLocalBridgePortInput.value, '18422');

  await els.reportsOpenClawSaveButton.trigger('click');
  assert.equal(savedIntegrationsPatches.length, 1);
  const saved = JSON.parse(JSON.stringify(savedIntegrationsPatches[0].openclaw));
  assert.equal(saved.enabled, true);
  assert.equal(saved.pushOnRollover, true);
  assert.deepEqual(saved.events, {
    rollover: true,
    sessionCompleted: true,
    approvalAlerts: true,
    quotaAlerts: true,
    serviceIncidents: true
  });
  assert.deepEqual(saved.sessionCompletion, {
    clients: ['codex', 'claude'],
    excludeSubagents: false,
    excludeBackgroundReview: false,
    minTurnTokens: 500,
    minTotalTokens: 1500,
    debounceMs: 4000,
    cooldownMs: 60000,
    includeDetailSummary: true,
    includeAiSummary: true
  });
  assert.deepEqual(saved.quotaAlerts, { thresholdPercent: 15, notifyRecovery: false });
  assert.deepEqual(saved.queryPermissions, { allowSessionDetail: false, allowConversationText: false });
  assert.deepEqual(saved.localBridge, { enabled: true, port: 18422 });
  assert.equal(els.reportsOpenClawStatusText.textContent, MESSAGES.en['settings.reports.openclawSaved']);
});

test('privacy query permissions gate allowConversationText behind allowSessionDetail', async () => {
  const harness = createRendererReportsHarness();
  const { els, state, context, savedIntegrationsPatches } = harness;
  state.settings.hubMode = 'local';
  context.renderReportsSettings();

  // Default state keeps conversation text disabled
  assert.equal(els.reportsOpenClawAllowSessionDetailInput.checked, false);
  assert.equal(els.reportsOpenClawAllowConversationTextInput.disabled, true);
  assert.equal(els.reportsOpenClawAllowConversationTextInput.checked, false);

  // Even if conversation text checked flag is forced while detail is off, save clamps it false
  els.reportsOpenClawAllowConversationTextInput.checked = true;
  await els.reportsOpenClawSaveButton.trigger('click');
  assert.deepEqual(JSON.parse(JSON.stringify(savedIntegrationsPatches.at(-1).openclaw.queryPermissions)), {
    allowSessionDetail: false,
    allowConversationText: false
  });

  // Enabling allowSessionDetail unlocks allowConversationText
  els.reportsOpenClawAllowSessionDetailInput.checked = true;
  await els.reportsOpenClawAllowSessionDetailInput.trigger('change');
  assert.equal(els.reportsOpenClawAllowConversationTextInput.disabled, false);

  els.reportsOpenClawAllowConversationTextInput.checked = true;
  await els.reportsOpenClawAllowConversationTextInput.trigger('change');
  await els.reportsOpenClawSaveButton.trigger('click');
  assert.deepEqual(JSON.parse(JSON.stringify(savedIntegrationsPatches.at(-1).openclaw.queryPermissions)), {
    allowSessionDetail: true,
    allowConversationText: true
  });

  // Disabling allowSessionDetail immediately clears and disables allowConversationText
  els.reportsOpenClawAllowSessionDetailInput.checked = false;
  await els.reportsOpenClawAllowSessionDetailInput.trigger('change');
  assert.equal(els.reportsOpenClawAllowConversationTextInput.disabled, true);
  assert.equal(els.reportsOpenClawAllowConversationTextInput.checked, false);
});

test('local bridge status displays masked token without exposing raw secrets, copies config, and regenerates token', async () => {
  const harness = createRendererReportsHarness();
  const { els, state, context, copyBridgeCalls, getRegenBridgeCalls, flushNextTimer } = harness;
  const flushMicrotasks = async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  };
  harness.setLocalBridgeStatusState({
    ok: true,
    enabled: true,
    running: true,
    port: 17322,
    endpointUrl: 'http://127.0.0.1:17322/api/mcp',
    baseUrl: 'http://127.0.0.1:17322',
    tokenConfigured: true,
    maskedToken: '••••9f2a',
    token: 'raw-secret-never-display',
    secret: 'raw-secret-never-display'
  });
  harness.setRegenBridgeResult({
    ok: true,
    enabled: true,
    running: true,
    port: 17322,
    endpointUrl: 'http://127.0.0.1:17322/api/mcp',
    tokenConfigured: true,
    maskedToken: '••••b3c4',
    token: 'raw-regen-never-display'
  });

  state.settings.hubMode = 'local';
  context.renderReportsSettings();
  await flushMicrotasks();

  assert.equal(els.reportsOpenClawLocalBridgeEndpoint.textContent, 'http://127.0.0.1:17322/api/mcp');
  assert.match(els.reportsOpenClawLocalBridgeStatusText.textContent, /••••9f2a/);
  assert.equal(els.reportsOpenClawLocalBridgeCopyTokenButton.disabled, false);
  assert.equal(els.reportsOpenClawLocalBridgeCopyMcpButton.disabled, false);
  assert.equal(els.reportsOpenClawLocalBridgeRegenTokenButton.disabled, false);
  assert.equal(JSON.stringify(els).includes('raw-secret-never-display'), false);
  assert.equal(JSON.stringify(state).includes('raw-secret-never-display'), false);

  await els.reportsOpenClawLocalBridgeCopyTokenButton.trigger('click');
  await els.reportsOpenClawLocalBridgeCopyMcpButton.trigger('click');
  assert.deepEqual(copyBridgeCalls.map((c) => JSON.parse(JSON.stringify(c))), [{ kind: 'token' }, { kind: 'mcpConfig' }]);
  assert.equal(els.reportsOpenClawLocalBridgeCopyMcpButton.textContent, MESSAGES.en['settings.reports.openclawQrCopied']);
  assert.equal(await flushNextTimer(), true);
  assert.equal(els.reportsOpenClawLocalBridgeCopyMcpButton.textContent, MESSAGES.en['settings.reports.openclawLocalBridgeCopyMcp']);

  await els.reportsOpenClawLocalBridgeRegenTokenButton.trigger('click');
  assert.equal(getRegenBridgeCalls(), 1);
  assert.match(els.reportsOpenClawLocalBridgeStatusText.textContent, /••••b3c4/);
  assert.equal(els.reportsOpenClawStatusText.textContent, MESSAGES.en['settings.reports.openclawLocalBridgeTokenRegenerated']);
  assert.equal(JSON.stringify(els).includes('raw-regen-never-display'), false);
});

test('test push, push usage now, error codes, and recent push history (last 5) render accurately', async () => {
  const harness = createRendererReportsHarness();
  const { els, state, context, testPushCalls, queryPushCalls, savedIntegrationsPatches } = harness;
  const flushMicrotasks = async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  };
  harness.setPushHistoryState({
    ok: true,
    count: 6,
    lastPush: { ok: true, at: '2026-11-17T08:10:00Z' },
    history: [
      { id: '1', at: '2026-11-17T08:10:00Z', eventType: 'session_completed', ok: true, channel: 'openclaw-weixin', summary: 'Codex · 1.2K' },
      { id: '2', at: '2026-11-17T08:09:00Z', eventType: 'query_digest', ok: false, error: 'session_detail_disabled', channel: 'openclaw-weixin' },
      { id: '3', at: '2026-11-17T08:08:00Z', eventType: 'quota_alert', ok: true, channel: 'openclaw-weixin', summary: '15% left' },
      { id: '4', at: '2026-11-17T08:07:00Z', eventType: 'approval_alert', ok: true, channel: 'openclaw-weixin' },
      { id: '5', at: '2026-11-17T08:06:00Z', eventType: 'service_incident', ok: true, channel: 'openclaw-weixin' },
      { id: '6', at: '2026-11-17T08:05:00Z', eventType: 'test', ok: true, channel: 'openclaw-weixin' }
    ]
  });

  state.settings.hubMode = 'local';
  context.renderReportsSettings();
  await flushMicrotasks();

  assert.equal(els.reportsOpenClawHistoryEmpty.hidden, true);
  assert.equal(els.reportsOpenClawHistoryList.hidden, false);
  assert.equal(els.reportsOpenClawHistoryList.children.length, 5);
  assert.equal(els.reportsOpenClawHistoryList.children[0].querySelector('.reports-openclaw-history-badge').textContent, 'OK');
  assert.equal(els.reportsOpenClawHistoryList.children[0].querySelector('.reports-openclaw-history-type').textContent, 'Session done');
  assert.equal(els.reportsOpenClawHistoryList.children[1].querySelector('.reports-openclaw-history-badge').textContent, 'Failed');
  assert.match(
    els.reportsOpenClawHistoryList.children[1].querySelector('.reports-openclaw-history-detail').textContent,
    /privacy permissions/
  );

  // Dirty edit auto-saves before running test push
  els.reportsOpenClawEnabledInput.checked = true;
  await els.reportsOpenClawEnabledInput.trigger('change');
  await els.reportsOpenClawTestPushButton.trigger('click');
  assert.equal(savedIntegrationsPatches.length, 1);
  assert.equal(testPushCalls.length, 1);
  assert.equal(testPushCalls[0].message, MESSAGES.en['settings.reports.openclawTestPushMessage']);
  assert.equal(els.reportsOpenClawStatusText.textContent, 'Test message sent to OpenClaw (openclaw-weixin)');

  // Push Usage Now calls pushQueryToOpenClaw with current period
  state.period = 'month';
  await els.reportsOpenClawPushUsageButton.trigger('click');
  assert.equal(queryPushCalls.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(queryPushCalls[0])), {
    type: 'usage',
    params: { period: 'month', groupBy: 'summary' },
    includeAi: true
  });
  assert.equal(els.reportsOpenClawStatusText.textContent, 'Delivered to OpenClaw (openclaw-weixin)');

  // Privacy/bridge error codes localize properly
  for (const [code, key] of [
    ['session_detail_disabled', 'settings.reports.errSessionDetailDisabled'],
    ['conversation_text_disabled', 'settings.reports.errConversationTextDisabled'],
    ['bridge_unavailable', 'settings.reports.errBridgeUnavailable']
  ]) {
    assert.equal(context.formatReportsError(code), MESSAGES.en[key]);
  }
});

test('main-view quick push buttons respect OpenClaw enabled state, IPC guards, view params, and toast feedback', async () => {
  const harness = createRendererReportsHarness();
  const { els, state, tokenMonitor, context, queryPushCalls, flushNextTimer } = harness;

  // Disabled initially -> quick push hidden and unavailable
  state.settings.hubMode = 'local';
  context.renderReportsSettings();
  assert.equal(context.isOpenClawQuickPushAvailable(), false);
  assert.equal(els.openClawQuickPushButton.hidden, true);
  const disabledResult = await context.triggerOpenClawQuickPush({ type: 'usage' });
  assert.equal(disabledResult.ok, false);
  assert.equal(queryPushCalls.length, 0);

  // Enable OpenClaw via background settings push
  context.syncReportIntegrationsFromSettings({
    hubMode: 'local',
    reportIntegrations: { openclaw: { enabled: true, includeAiAnalysis: false, channel: 'openclaw-weixin' } }
  });
  assert.equal(context.isOpenClawQuickPushAvailable(), true);
  assert.equal(els.openClawQuickPushButton.hidden, false);

  // Home overview quick push
  state.breakdown = 'home';
  state.period = 'today';
  context.syncOpenClawQuickPushButton();
  await els.openClawQuickPushButton.trigger('click');
  assert.equal(queryPushCalls.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(queryPushCalls[0])), {
    type: 'usage',
    params: { period: 'today', groupBy: 'summary' },
    includeAi: false
  });
  assert.equal(els.openClawToast.hidden, false);
  assert.equal(els.openClawToast.textContent, 'Sent to OpenClaw (openclaw-weixin)');
  assert.equal(await flushNextTimer(), true);
  assert.equal(els.openClawToast.hidden, true);

  // Limits header quick push
  state.breakdown = 'limits';
  context.syncOpenClawQuickPushButton();
  await els.openClawQuickPushButton.trigger('click');
  assert.deepEqual(JSON.parse(JSON.stringify(queryPushCalls.at(-1))), {
    type: 'limits',
    params: {},
    includeAi: false
  });
  assert.equal(await flushNextTimer(), true);

  // Session detail header button
  const detailBtn = context.createSessionDetailOpenClawPushButton({
    client: 'codex',
    sessionId: 'sess-123',
    period: 'month'
  });
  harness.setQueryPushResult({ ok: false, error: 'session_detail_disabled' });
  await detailBtn.trigger('click');
  assert.deepEqual(JSON.parse(JSON.stringify(queryPushCalls.at(-1))), {
    type: 'session_detail',
    params: { client: 'codex', sessionId: 'sess-123', period: 'month' },
    includeAi: false
  });
  assert.equal(els.openClawToast.hidden, false);
  assert.match(els.openClawToast.textContent, /Session detail queries are disabled/);
  assert.equal(await flushNextTimer(), true);

  // iCloud hides quick push
  state.settings.hubMode = 'icloud';
  context.syncOpenClawQuickPushButton();
  assert.equal(context.isOpenClawQuickPushAvailable(), false);
  assert.equal(els.openClawQuickPushButton.hidden, true);

  // Guardrail when preload helper pushQueryToOpenClaw is absent
  state.settings.hubMode = 'local';
  delete tokenMonitor.pushQueryToOpenClaw;
  context.syncOpenClawQuickPushButton();
  assert.equal(context.isOpenClawQuickPushAvailable(), false);
  assert.equal(els.openClawQuickPushButton.hidden, true);
});
