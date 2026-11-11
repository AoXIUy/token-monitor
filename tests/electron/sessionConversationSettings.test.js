'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '../..');
const renderer = fs.readFileSync(path.join(root, 'src/electron/renderer/app.js'), 'utf8');

function controls() {
  const field = () => ({ classList: { toggle() {} } });
  const els = {
    sessionConversationsRow: {}, sessionConversationsInput: {}, hubModeOptions: {},
    hubClientFields: field(), hubHostFields: field(), hubSecretInput: {}
  };
  const state = { settings: { hubMode: 'host' } };
  const noop = () => {};
  const context = { els, state, syncContentForm: null, syncModeSelect: null,
    SYNC_MODE_DESCRIPTIONS: {}, t: key => key, renderHubStatus: noop, renderIcloudStatus: noop,
    renderSyncPanel: noop, renderHubBuildStatus: noop, syncHubConnectionUi: noop, syncHubSaveButton: noop };
  const start = renderer.indexOf('function syncHubModeUi() {');
  const end = renderer.indexOf('\nfunction renderIcloudStatus()', start);
  const sync = vm.runInNewContext(renderer.slice(start, end) + '\nsyncHubModeUi', context);
  return { els, state, sync };
}

test('conversation switch defaults on, preserves saved off and is shown for Host and Client', () => {
  const { els, state, sync } = controls();
  for (const mode of ['host', 'client', 'local', 'icloud']) {
    state.settings.hubMode = mode;
    sync();
    assert.equal(els.sessionConversationsInput.checked, true);
    assert.equal(els.sessionConversationsRow.hidden, !['host', 'client'].includes(mode));
    assert.equal(els.sessionConversationsRow.inert, els.sessionConversationsRow.hidden);
  }
  state.settings.sessionConversationsEnabled = false;
  sync();
  assert.equal(els.sessionConversationsInput.checked, false);
  const main = fs.readFileSync(path.join(root, 'src/electron/main.js'), 'utf8');
  assert.match(main, /sessionConversationsEnabled: parseBoolean\(process\.env\.TOKEN_MONITOR_SESSION_CONVERSATIONS, true\)/);
  assert.match(main, /sessionConversations: settings\.sessionConversationsEnabled !== false/);
});

test('switch autosaves a boolean, blocks duplicate edits while saving and restores failed edits', async () => {
  const { els, state } = controls();
  let change, reject = false;
  const saved = [];
  els.sessionConversationsInput.addEventListener = (_event, handler) => { change = handler; };
  const start = renderer.indexOf("els.sessionConversationsInput?.addEventListener('change'");
  const end = renderer.indexOf("els.syncUploadIntervalInput?.addEventListener('change'", start);
  vm.runInNewContext(renderer.slice(start, end), { els, state,
    saveSettings: async patch => {
      assert.equal(els.sessionConversationsInput.disabled, true);
      if (reject) throw Error('save failed');
      saved.push(patch.sessionConversationsEnabled);
      Object.assign(state.settings, patch);
    } });
  els.sessionConversationsInput.checked = false;
  await change();
  assert.deepEqual(saved, [false]);
  assert.equal(state.settings.sessionConversationsEnabled, false);
  assert.equal(els.sessionConversationsInput.disabled, false);
  reject = true;
  els.sessionConversationsInput.checked = true;
  await change();
  assert.equal(els.sessionConversationsInput.checked, false);
  assert.equal(els.sessionConversationsInput.disabled, false);
});
