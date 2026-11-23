'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const rendererDir = path.resolve(__dirname, '../src/electron/renderer');
const i18n = require('../src/electron/renderer/i18n');

function readRenderer(name) {
  return fs.readFileSync(path.join(rendererDir, name), 'utf8');
}

function extractFunction(source, name, nextToken) {
  const start = source.indexOf(name);
  assert.notEqual(start, -1, `${name} should exist`);
  const end = source.indexOf(nextToken, start + name.length);
  assert.notEqual(end, -1, `${nextToken} should follow ${name}`);
  return source.slice(start, end);
}

test('antigravityManager.html loads every script dependency in valid order and on disk', () => {
  const html = readRenderer('antigravityManager.html');
  const scripts = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(scripts.length >= 8);

  for (const src of scripts) {
    const abs = path.resolve(rendererDir, src);
    assert.equal(fs.existsSync(abs), true, `script must exist on disk: ${src}`);
  }

  const idxCatalog = scripts.indexOf('../../shared/clientCatalog.js');
  const idxVendor = scripts.indexOf('../../shared/vendorPresentation.js');
  const idxTheme = scripts.indexOf('themePresets.js');
  const idxFont = scripts.indexOf('../../shared/fontSettings.js');
  const idxMain = scripts.indexOf('antigravityManager.js');

  assert.ok(idxCatalog >= 0 && idxVendor > idxCatalog && idxTheme > idxVendor,
    'clientCatalog and vendorPresentation must load before themePresets.js');
  assert.ok(idxFont >= 0 && idxFont < idxMain, '../../shared/fontSettings.js must load before antigravityManager.js');
});

test('antigravityManager HTML and JS i18n keys and placeholders have full 7-locale parity', () => {
  const html = readRenderer('antigravityManager.html');
  const js = readRenderer('antigravityManager.js');
  const indexHtml = readRenderer('index.html');
  const locales = Object.keys(i18n.MESSAGES);
  assert.deepEqual(locales.sort(), ['en', 'es', 'ja', 'ko', 'pt-BR', 'zh-CN', 'zh-TW']);

  const usedKeys = new Set();
  for (const match of html.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)) usedKeys.add(match[1]);
  for (const match of js.matchAll(/\bt\(\s*['"]([^'"]+)['"]/g)) usedKeys.add(match[1]);
  for (const match of indexHtml.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]*(?:antigravity|agManager)[^"]*)"/gi)) {
    usedKeys.add(match[1]);
  }
  for (const slot of ['classic', 'ide', 'agy', 'acp']) usedKeys.add(`agManager.slot.${slot}`);

  assert.ok(usedKeys.size > 80);
  const placeholders = (text) => [...String(text).matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]).sort();

  for (const key of usedKeys) {
    const enValue = i18n.MESSAGES.en[key];
    assert.equal(typeof enValue, 'string', `en must define ${key}`);
    assert.ok(enValue.trim().length > 0, `en ${key} must be non-empty`);
    const enVars = placeholders(enValue);
    for (const locale of locales) {
      const value = i18n.MESSAGES[locale][key];
      assert.equal(typeof value, 'string', `${locale} must define ${key}`);
      assert.ok(value.trim().length > 0, `${locale} ${key} must be non-empty`);
      assert.deepEqual(placeholders(value), enVars, `${locale} placeholder mismatch for ${key}`);
    }
  }
});

test('antigravityManager renderer avoids unsafe HTML injection and native tooltips', () => {
  const html = readRenderer('antigravityManager.html');
  const js = readRenderer('antigravityManager.js');

  assert.doesNotMatch(js, /\b(?:innerHTML|outerHTML|insertAdjacentHTML|document\.write)\b/);
  const jsWithoutDocTitle = js.replace(/\bdocument\.title\s*=/g, 'documentTitle =');
  assert.doesNotMatch(jsWithoutDocTitle, /\.title\s*=(?!=)|\.setAttribute\(\s*['"]title['"]/);
  assert.doesNotMatch(html, /\stitle=["']|data-i18n-title/);
});

test('antigravityManager.html exposes proper import label, localized aria-labels, and tab ARIA roles', () => {
  const html = readRenderer('antigravityManager.html');
  assert.match(html, /id="agmOpenImportBtn"[^>]*data-i18n="agManager\.openImport"/);
  assert.match(html, /id="agmTokenPasteInput"[^>]*data-i18n-placeholder="agManager\.tokenPastePlaceholder"/);
  for (const id of ['agmThemeToggle', 'agmMinBtn', 'agmCloseBtn', 'agmTargetClient', 'agmRefreshMenuBtn', 'agmRefreshPopover', 'agmSearchInput', 'agmFilterChips', 'agmCloseImportDialog', 'agmCloseDeviceDialog']) {
    assert.match(html, new RegExp(`id="${id}"[^>]*data-i18n-aria-label="agManager\\.aria\\.`));
  }
  const tabMatches = [...html.matchAll(/role="tab"[^>]*aria-selected="(true|false)"[^>]*aria-controls="agmImportTab/g)];
  assert.equal(tabMatches.length, 3);
  const panelMatches = [...html.matchAll(/role="tabpanel"[^>]*aria-labelledby="agmTabBtn/g)];
  assert.equal(panelMatches.length, 3);
});

test('antigravityManager.css supports light theme, keyboard focus, menu stacking, and cancel split styling', () => {
  const css = readRenderer('antigravityManager.css');
  assert.match(css, /:root\.agm-light\s*\{/);
  assert.match(css, /\.agm-select option\s*\{[^}]*rgb\(var\(--panel-rgb\)\)[^}]*var\(--text\)/);
  assert.match(css, /button:focus-visible/);
  assert.match(css, /\.agm-card\.has-menu-open\s*\{[^}]*z-index:\s*25/);
  assert.match(css, /\.agm-more-menu\.is-below\s*\{/);
  assert.match(css, /\.agm-refresh-split > #agmCancelRefreshBtn\s*\{[^}]*border-radius:\s*0/);
  assert.match(css, /\.agm-popover\.align-left\s*\{/);
  assert.doesNotMatch(css, /\.hidden\s*\{/);
});

test('main window limitsToolsBar hides in every non-limits path and limits-tool-btn uses theme tokens', () => {
  const css = readRenderer('styles.css');
  const app = readRenderer('app.js');

  assert.doesNotMatch(css, /var\(--ink\)/, 'styles.css must not reference undefined --ink');
  const btnRule = css.match(/\.limits-tool-btn\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(btnRule, /color:\s*var\(--text\)/);
  assert.match(btnRule, /border:\s*1px solid var\(--line\)/);
  assert.match(btnRule, /rgba\(var\(--overlay-rgb\)/);
  assert.match(css, /\.footer-ag-manager-button:focus-visible\s*\{/);
  assert.match(css, /\.footer:has\(\.footer-update-actions\.is-disclosed\) \.live-token-rate/);

  const hidePeriodFn = extractFunction(app, 'function hidePeriodContentForMessage(', '\nfunction periodMenuButtons(');
  assert.match(hidePeriodFn, /els\.limitsToolsBar\?\.classList\.add\('hidden'\)/);

  const renderAppFn = extractFunction(app, 'function renderAppContent(', '\nfunction setStatus(');
  const pluginBranch = renderAppFn.slice(renderAppFn.indexOf('if (pluginPage)'), renderAppFn.indexOf('if (!state.stats)'));
  assert.match(pluginBranch, /els\.limitsToolsBar/);
  const elseBranch = renderAppFn.slice(renderAppFn.lastIndexOf('} else {'));
  assert.match(elseBranch, /els\.limitsToolsBar\?\.classList\.add\('hidden'\)/);
});

test('antigravityManager formatting, capability inference, and bucket classification helpers work cleanly', () => {
  const js = readRenderer('antigravityManager.js');
  const snippet = [
    'const GENERIC_CAPABILITY_WORDS = new Set(["pro","flash","lite","ultra","high","medium","low","xhigh","image","exp","preview","disabled","thinking","tiered","models","model","wtu","weekly","5h","7d","hour","quota","pool","default","standard"]);',
    extractFunction(js, 'function formatResetCountdown(', '\nfunction isAbnormalAccount('),
    extractFunction(js, 'function isAbnormalAccount(', '\nfunction filteredAccounts('),
    extractFunction(js, 'function formatCompactTimestamp(', '\nfunction inferCapabilityPills('),
    extractFunction(js, 'function inferCapabilityPills(', '\nfunction renderSummaryAndControls('),
    extractFunction(js, 'function is5hBucket(', '\nfunction renderQuotaGridCell(')
  ].join('\n');

  const now = Date.UTC(2026, 10, 23, 12, 0, 0);
  const ctx = {
    Date: class MockDate extends Date {
      constructor(...args) {
        if (args.length === 0) super(now);
        else super(...args);
      }
      static now() { return now; }
      static parse(v) { return Date.parse(v); }
    },
    t: (key) => (key === 'agManager.resetReady' ? 'Ready' : key)
  };
  vm.runInNewContext(snippet, ctx);

  assert.equal(ctx.formatResetCountdown(''), '—');
  assert.equal(ctx.formatResetCountdown('not-a-date'), '—');
  assert.equal(ctx.formatResetCountdown(new Date(now - 5000).toISOString()), 'Ready');
  assert.equal(ctx.formatResetCountdown(new Date(now + 4 * 60 * 1000).toISOString()), '4m');
  assert.equal(ctx.formatResetCountdown(new Date(now + 3 * 3600 * 1000 + 25 * 60 * 1000).toISOString()), '3h 25m');
  assert.equal(ctx.formatResetCountdown(new Date(now + 2 * 86400 * 1000 + 5 * 3600 * 1000).toISOString()), '2d 5h');

  assert.equal(ctx.isAbnormalAccount({ disabled: false, banned: false, validationBlocked: false, quota: { isForbidden: false } }), false);
  assert.equal(ctx.isAbnormalAccount({ quota: { isForbidden: true } }), true);
  assert.equal(ctx.isAbnormalAccount({ banned: true }), true);

  assert.equal(ctx.pctToneClass(0), 'is-low');
  assert.equal(ctx.pctToneClass(15), 'is-low');
  assert.equal(ctx.pctToneClass(16), 'is-warn');
  assert.equal(ctx.pctToneClass(50), 'is-warn');
  assert.equal(ctx.pctToneClass(51), '');

  const pills = ctx.inferCapabilityPills({
    quota: {
      models: [
        { name: 'gemini-4.0-argon-high' },
        { name: 'claude-sonnet-4-6' },
        { name: 'gpt-oss-120b' }
      ]
    }
  });
  assert.deepEqual(JSON.parse(JSON.stringify(pills)), [
    { label: 'Argon', tone: 'violet' },
    { label: 'Claude 4.6', tone: 'amber' },
    { label: 'GPT-120B', tone: 'ok' }
  ]);

  assert.equal(ctx.is5hBucket({ window: '5h' }), true);
  assert.equal(ctx.isWeeklyBucket({ bucketId: 'gemini-7d' }), true);
  assert.equal(ctx.isClaudeOr3pGroup({ displayName: 'Claude & 3P', buckets: [] }), true);
  assert.equal(ctx.isDedicatedCodenameGroup({ displayName: 'Gemini Argon WTU', buckets: [] }), true);
});

test('antigravityManager state pruning, progress bar reset, clipboard IPC preference, and partial settings locale work properly', async () => {
  const js = readRenderer('antigravityManager.js');

  // 1. applyManagerState prunes stale IDs & hides progress bar when isRefreshing=false
  const applySnippet = [
    extractFunction(js, 'function hideProgressBar(', '\nasync function copyEmailText('),
    extractFunction(js, 'function applyManagerState(', '\nasync function loadState(')
  ].join('\n');
  let rendered = 0;
  const hiddenClasses = new Set();
  const stateCtx = {
    state: {
      manager: null,
      selectedIds: new Set(['a1', 'stale']),
      expandedModels: new Set(['a1', 'stale']),
      openMoreId: 'stale',
      confirmDeleteId: 'stale',
      batchDeleteConfirm: true,
      importBusy: false
    },
    els: {
      progressBar: {
        textContent: 'Refreshing 1/2',
        classList: {
          add: (c) => hiddenClasses.add(c),
          remove: (c) => hiddenClasses.delete(c)
        }
      }
    },
    renderAll: () => { rendered += 1; }
  };
  vm.runInNewContext(applySnippet, stateCtx);
  stateCtx.applyManagerState({ accounts: [{ id: 'a1' }], isRefreshing: false });
  assert.deepEqual([...stateCtx.state.selectedIds], ['a1']);
  assert.deepEqual([...stateCtx.state.expandedModels], ['a1']);
  assert.equal(stateCtx.state.openMoreId, '');
  assert.equal(stateCtx.state.confirmDeleteId, '');
  assert.equal(stateCtx.state.batchDeleteConfirm, true);
  assert.equal(hiddenClasses.has('hidden'), true);
  assert.equal(stateCtx.els.progressBar.textContent, '');
  assert.equal(rendered, 1);

  stateCtx.applyManagerState({ accounts: [], isRefreshing: false });
  assert.equal(stateCtx.state.selectedIds.size, 0);
  assert.equal(stateCtx.state.batchDeleteConfirm, false);

  // 2. copyEmailText prefers window.tokenMonitor.copyText before navigator.clipboard
  const copySnippet = extractFunction(js, 'async function copyEmailText(', '\nfunction formatResetCountdown(');
  const calls = [];
  const copyCtx = {
    window: { tokenMonitor: { copyText: async (txt) => { calls.push(['ipc', txt]); } } },
    navigator: { clipboard: { writeText: async (txt) => { calls.push(['web', txt]); } } },
    t: (k) => k
  };
  vm.runInNewContext(copySnippet, copyCtx);
  await copyCtx.copyEmailText('a@b.com');
  assert.deepEqual(calls, [['ipc', 'a@b.com']]);

  copyCtx.window.tokenMonitor.copyText = undefined;
  await copyCtx.copyEmailText('c@d.com');
  assert.deepEqual(calls, [['ipc', 'a@b.com'], ['web', 'c@d.com']]);

  // 3. Source invariants: onSettingsPush resolves from merged state.settings, batch delete is two-step, dialog close cancels OAuth, Escape key handled
  assert.match(js, /i18n\.resolveLocale\(state\.settings\.locale \|\| state\.settings\.language/);
  assert.match(js, /if \(!state\.batchDeleteConfirm\)/);
  assert.match(js, /els\.importDialog\.addEventListener\('close',[\s\S]*cancelOAuthLogin/);
  assert.match(js, /ev\.key !== 'Escape'/);
});
