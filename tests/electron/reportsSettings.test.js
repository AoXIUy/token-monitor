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

function createElementStub() {
  const listeners = new Map();
  const classes = new Set();
  return {
    checked: false,
    disabled: false,
    hidden: false,
    inert: false,
    textContent: '',
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
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    async trigger(type) {
      const handler = listeners.get(type);
      if (handler) return handler();
      return undefined;
    }
  };
}

function createRendererReportsHarness() {
  const els = {
    reportsSettingsGroup: createElementStub(),
    reportsHostRequiredNote: createElementStub(),
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
    reportsStatusText: createElementStub()
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

  const tokenMonitor = {
    async pickReportsDir() {
      return pickDirResult;
    },
    async openReportsDir() {
      return openDirResult;
    },
    async generateReportsNow() {
      return generateResult;
    }
  };

  const start = rendererSource.indexOf('let reportsGenerating = false;');
  const end = rendererSource.indexOf('\nels.resetClientDisplayOrderButton?.addEventListener', start);
  assert.ok(start >= 0 && end > start, 'could not locate reports UI section in app.js');

  const context = {
    els,
    state,
    window: { tokenMonitor },
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

  vm.runInNewContext(`${rendererSource.slice(start, end)}\nthis.renderReportsSettings = renderReportsSettings;`, context);

  return {
    els,
    state,
    context,
    savedPatches,
    setRejectSave(value) { rejectSave = value; },
    setGenerateResult(value) { generateResult = value; },
    setPickDirResult(value) { pickDirResult = value; },
    setOpenDirResult(value) { openDirResult = value; }
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
    'reportsEnabledInput',
    'reportsDailyInput',
    'reportsWeeklyInput',
    'reportsMonthlyInput',
    'reportsDirLabel',
    'reportsPickDirButton',
    'reportsOpenDirButton',
    'reportsGenerateNowButton',
    'reportsStatusText'
  ]) {
    assert.match(htmlSource, new RegExp(`id="${id}"`), `index.html missing #${id}`);
  }

  const section = htmlSource.split('id="reportsSettingsGroup"')[1].split('id="syncDevicePanel"')[0];
  const keys = [...section.matchAll(/data-i18n="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(keys.length >= 8);
  for (const locale of LANGUAGE_OPTIONS.map((opt) => opt.value).filter((value) => value !== 'auto')) {
    for (const key of keys) {
      assert.ok(MESSAGES[locale][key]?.trim(), `${locale} missing ${key}`);
    }
  }
});

test('renderReportsSettings adapts visibility, disabled states, and MCP status across hub modes', () => {
  const { els, state, context } = createRendererReportsHarness();

  state.settings.hubMode = 'local';
  context.renderReportsSettings();
  assert.equal(els.reportsHostRequiredNote.hidden, false);
  assert.equal(els.reportsHostControls.hidden, true);
  assert.equal(els.reportsHostControls.inert, true);
  assert.equal(els.reportsActionsRow.hidden, true);
  assert.equal(els.reportsGenerateNowButton.disabled, true);

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
