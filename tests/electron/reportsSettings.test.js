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

function createElementStub() {
  const listeners = new Map();
  const classes = new Set();
  const attributes = new Map();
  const children = [];
  const stub = {
    checked: false,
    disabled: false,
    hidden: false,
    inert: false,
    value: '',
    placeholder: '',
    textContent: '',
    dataset: {},
    style: {},
    _focused: false,
    attributes,
    children,
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
    reportsOpenClawPushNowButton: createElementStub()
  };
  const state = {
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
  const cancelledQrSessions = [];
  const provisionCalls = [];
  const copiedTexts = [];
  let integrationsState = {
    ok: true,
    ai: { enabled: false, protocol: 'openai-compatible', providerLabel: '', baseUrl: '', model: '', language: 'zh-CN', apiKeyConfigured: false, autoAnalyzeOnRollover: false },
    openclaw: { enabled: false, mode: 'openclaw-agent', webhookUrl: '', channel: 'openclaw-weixin', to: '', agentId: 'main', hookTokenConfigured: false, pushOnRollover: false, includeAiSummary: true, includeLimitsSnapshot: true },
    lastPush: null
  };
  let analyzeResult = { ok: true, aiAnalysis: { model: 'deepseek-chat', summaryMarkdown: 'AI OK' } };
  let pushResult = { ok: true, channel: 'openclaw-weixin', lastPush: { ok: true, at: '2026-11-16T22:00:00Z' } };
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
    `${rendererSource.slice(start, end)}\nthis.renderReportsSettings = renderReportsSettings;\nthis.formatReportsError = formatReportsError;\nthis.cancelOpenClawQrIfActive = cancelOpenClawQrIfActive;`,
    context
  );

  return {
    els,
    state,
    context,
    savedPatches,
    savedIntegrationsPatches,
    analyzeCalls,
    pushCalls,
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
    'reportsOpenClawQrGuideText'
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
  const enReportKeys = Object.keys(MESSAGES.en).filter((key) => key.startsWith('settings.reports.'));
  const allKeys = [...new Set([...attrKeys, ...enReportKeys])];
  assert.ok(allKeys.length >= 25);
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
  assert.equal(els.reportsOpenClawSaveButton.disabled, true);
  assert.equal(els.reportsOpenClawPushNowButton.disabled, true);
  assert.equal(els.reportsOpenClawQrScanButton.disabled, false);

  await els.reportsEnableHostButton.trigger('click');
  assert.deepEqual({ ...savedPatches.at(-1) }, { hubMode: 'host' });
  assert.equal(state.settings.hubMode, 'host');
  assert.equal(els.reportsHostControls.hidden, false);
  assert.equal(els.reportsAiPanel.hidden, false);
  assert.equal(els.reportsAiPanel.inert, false);

  state.settings.hubMode = 'local';
  context.renderReportsSettings();

  state.settings.hubMode = 'client';
  context.renderReportsSettings();
  assert.equal(els.reportsHostRequiredNote.hidden, true);
  assert.equal(els.reportsHostControls.hidden, true);
  assert.equal(els.reportsActionsRow.hidden, false);
  assert.equal(els.reportsGenerateNowButton.disabled, false);
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
