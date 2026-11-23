'use strict';

const themePresetsApi = window.TokenMonitorThemePresets;
const i18n = window.TokenMonitorI18n;
const motionPreferenceApi = window.TokenMonitorMotionPreference;
const fontSettingsApi = window.TokenMonitorFontSettings;
const glassRenderingApi = window.TokenMonitorGlassRendering;
const reducedMotionMedia = window.matchMedia?.('(prefers-reduced-motion: reduce)');

const state = {
  locale: 'en',
  flat: false,
  settings: {},
  manager: null,
  activeClients: null,
  search: '',
  filter: 'all',
  selectedIds: new Set(),
  expandedModels: new Set(),
  openMoreId: '',
  confirmDeleteId: '',
  batchDeleteConfirm: false,
  toastTimer: null,
  oauthBusy: false,
  importBusy: false,
  switchBestBusy: false,
  refreshClickBusy: false
};

let nativeMaterialState = glassRenderingApi?.normalizeNativeMaterialState?.() || { type: 'transparent', reducedTransparency: false, highContrast: false };
let nativeMaterialRevision = 0;
const cleanupFns = [];

const els = {
  body: document.body,
  themeToggle: document.getElementById('agmThemeToggle'),
  minBtn: document.getElementById('agmMinBtn'),
  closeBtn: document.getElementById('agmCloseBtn'),
  statsPills: document.getElementById('agmStatsPills'),
  runtimeMeta: document.getElementById('agmRuntimeMeta'),
  targetClient: document.getElementById('agmTargetClient'),
  switchBestBtn: document.getElementById('agmSwitchBestBtn'),
  refreshSplit: document.getElementById('agmRefreshSplit'),
  refreshNowBtn: document.getElementById('agmRefreshNowBtn'),
  refreshNowLabel: document.getElementById('agmRefreshNowLabel'),
  cancelRefreshBtn: document.getElementById('agmCancelRefreshBtn'),
  refreshMenuBtn: document.getElementById('agmRefreshMenuBtn'),
  refreshPopover: document.getElementById('agmRefreshPopover'),
  startupRefreshInput: document.getElementById('agmStartupRefreshInput'),
  autoRefreshInput: document.getElementById('agmAutoRefreshInput'),
  intervalInput: document.getElementById('agmIntervalInput'),
  concurrencyInput: document.getElementById('agmConcurrencyInput'),
  slideDelayInput: document.getElementById('agmSlideDelayInput'),
  syncToHubInput: document.getElementById('agmSyncToHubInput'),
  openImportBtn: document.getElementById('agmOpenImportBtn'),
  exportBtn: document.getElementById('agmExportBtn'),
  restoreDeviceBtn: document.getElementById('agmRestoreDeviceBtn'),
  searchInput: document.getElementById('agmSearchInput'),
  filterChips: Array.from(document.querySelectorAll('#agmFilterChips .agm-chip')),
  selectAllInput: document.getElementById('agmSelectAllInput'),
  batchDeleteBtn: document.getElementById('agmBatchDeleteBtn'),
  progressBar: document.getElementById('agmProgressBar'),
  toast: document.getElementById('agmToast'),
  accountList: document.getElementById('agmAccountList'),
  importDialog: document.getElementById('agmImportDialog'),
  closeImportDialog: document.getElementById('agmCloseImportDialog'),
  importTabs: Array.from(document.querySelectorAll('[data-import-tab]')),
  importTabJson: document.getElementById('agmImportTabJson'),
  importTabDb: document.getElementById('agmImportTabDb'),
  importTabOauth: document.getElementById('agmImportTabOauth'),
  pickJsonFileBtn: document.getElementById('agmPickJsonFileBtn'),
  tokenPasteInput: document.getElementById('agmTokenPasteInput'),
  refreshAfterImportInput: document.getElementById('agmRefreshAfterImportInput'),
  submitPasteBtn: document.getElementById('agmSubmitPasteBtn'),
  importDefaultDirBtn: document.getElementById('agmImportDefaultDirBtn'),
  pickDataDirBtn: document.getElementById('agmPickDataDirBtn'),
  scanLocalBtn: document.getElementById('agmScanLocalBtn'),
  pickStateDbBtn: document.getElementById('agmPickStateDbBtn'),
  pickV1DirBtn: document.getElementById('agmPickV1DirBtn'),
  oauthClientSelect: document.getElementById('agmOAuthClientSelect'),
  startOAuthBtn: document.getElementById('agmStartOAuthBtn'),
  cancelOAuthBtn: document.getElementById('agmCancelOAuthBtn'),
  deviceDialog: document.getElementById('agmDeviceDialog'),
  closeDeviceDialog: document.getElementById('agmCloseDeviceDialog'),
  deviceBody: document.getElementById('agmDeviceBody')
};

function agmApi() {
  return window.tokenMonitor?.antigravityManager;
}

function t(key, params) {
  const value = i18n?.translate?.(state.locale, key, params);
  return value || key;
}

function registerCleanup(fn) {
  if (typeof fn === 'function') cleanupFns.push(fn);
}

function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach((node) => {
    const key = node.getAttribute('data-i18n');
    const translated = t(key);
    if (translated && translated !== key) node.textContent = translated;
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((node) => {
    const key = node.getAttribute('data-i18n-placeholder');
    const translated = t(key);
    if (translated && translated !== key) node.setAttribute('placeholder', translated);
  });
  document.querySelectorAll('[data-i18n-aria-label]').forEach((node) => {
    const key = node.getAttribute('data-i18n-aria-label');
    const translated = t(key);
    if (translated && translated !== key) node.setAttribute('aria-label', translated);
  });
  document.documentElement.lang = state.locale;
  document.title = t('agManager.title');
}

function applyAppearance(settings) {
  glassRenderingApi?.applyNativeMaterialClasses?.(nativeMaterialState);
  const opacity = glassRenderingApi?.renderedGlassOpacity
    ? glassRenderingApi.renderedGlassOpacity(settings, { userAgent: navigator.userAgent })
    : Math.min(100, Math.max(0, settings?.glassOpacity ?? 68)) / 100;
  const depth = (glassRenderingApi?.usesNativeMaterial?.(nativeMaterialState) ? 32 : Math.min(100, Math.max(0, settings?.glassBlur ?? 32))) / 100;
  const root = document.documentElement.style;
  root.setProperty('--glass-alpha', opacity.toFixed(2));
  root.setProperty('--line-alpha', (0.1 + depth * 0.09).toFixed(3));
  const reduce = motionPreferenceApi?.normalize?.(settings?.reduceMotion) || 'system';
  document.documentElement.dataset.reduceMotion = reduce;
  if (fontSettingsApi?.resolveEffectiveFontSettings) {
    const fonts = fontSettingsApi.resolveEffectiveFontSettings(settings, {
      ...settings?.fontContext,
      interfaceDefault: fontSettingsApi.DEFAULT_DASHBOARD_INTERFACE_FONT
    });
    root.setProperty('--ui-font', fonts.interfaceFont);
    root.setProperty('--display-font', fonts.displayFont);
  }
  if (themePresetsApi?.themeCssVarEntries) {
    for (const { name, value } of themePresetsApi.themeCssVarEntries(settings?.themeColors)) {
      if (value) root.setProperty(name, value);
      else root.removeProperty(name);
    }
  }
  const isLight = Boolean(themePresetsApi?.isLightHex?.(settings?.themeColors?.bg));
  document.documentElement.classList.toggle('agm-light', isLight);
  els.body.classList.toggle('flat', state.flat);
}

function showToast(text, isError = false) {
  if (!els.toast) return;
  els.toast.textContent = String(text || '');
  els.toast.classList.toggle('is-error', Boolean(isError));
  els.toast.classList.toggle('hidden', !text);
  if (state.toastTimer) {
    clearTimeout(state.toastTimer);
    state.toastTimer = null;
  }
  if (text) {
    state.toastTimer = setTimeout(() => {
      state.toastTimer = null;
      els.toast.classList.add('hidden');
    }, 4000);
  }
}

function hideProgressBar() {
  if (!els.progressBar) return;
  els.progressBar.classList.add('hidden');
  els.progressBar.textContent = '';
}

async function copyEmailText(text) {
  if (typeof window.tokenMonitor?.copyText === 'function') {
    await window.tokenMonitor.copyText(text);
    return;
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  throw new Error(t('agManager.toast.copyFailed'));
}

function formatResetCountdown(resetIso) {
  if (!resetIso) return '—';
  const targetMs = Date.parse(resetIso);
  if (!Number.isFinite(targetMs)) return '—';
  const diffSec = Math.max(0, Math.floor((targetMs - Date.now()) / 1000));
  if (diffSec === 0) return t('agManager.resetReady') !== 'agManager.resetReady' ? t('agManager.resetReady') : 'Ready';
  const days = Math.floor(diffSec / 86400);
  const hours = Math.floor((diffSec % 86400) / 3600);
  const mins = Math.floor((diffSec % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${Math.max(1, mins)}m`;
}

function isAbnormalAccount(acc) {
  return Boolean(acc?.disabled || acc?.banned || acc?.validationBlocked || acc?.quota?.isForbidden);
}

function filteredAccounts() {
  const accounts = state.manager?.accounts || [];
  const q = state.search.trim().toLowerCase();
  return accounts.filter((acc) => {
    if (q) {
      const email = String(acc.email || '').toLowerCase();
      const name = String(acc.name || '').toLowerCase();
      if (!email.includes(q) && !name.includes(q)) return false;
    }
    if (state.filter === 'abnormal') return isAbnormalAccount(acc);
    if (state.filter !== 'all') return acc.subscriptionTier === state.filter;
    return true;
  });
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const GENERIC_CAPABILITY_WORDS = new Set([
  'pro', 'flash', 'lite', 'ultra', 'high', 'medium', 'low', 'xhigh',
  'image', 'exp', 'preview', 'disabled', 'thinking', 'tiered', 'models',
  'model', 'wtu', 'weekly', '5h', '7d', 'hour', 'quota', 'pool', 'default', 'standard'
]);

function makeSvgIcon(shapes, size = 12, className = '', filled = false) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  if (className) svg.setAttribute('class', className);
  if (filled) {
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('stroke', 'none');
  } else {
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
  }
  for (const [tag, attrs] of shapes) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) {
      el.setAttribute(k, String(v));
    }
    svg.appendChild(el);
  }
  return svg;
}

function iconCopy() {
  return makeSvgIcon([
    ['rect', { x: 9, y: 9, width: 13, height: 13, rx: 2, ry: 2 }],
    ['path', { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' }]
  ], 12);
}

function iconTrash() {
  return makeSvgIcon([
    ['polyline', { points: '3 6 5 6 21 6' }],
    ['path', { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' }]
  ], 12);
}

function iconSwitch() {
  return makeSvgIcon([
    ['polyline', { points: '17 2 21 6 17 10' }],
    ['path', { d: 'M3 6h18' }],
    ['polyline', { points: '7 22 3 18 7 14' }],
    ['path', { d: 'M21 18H3' }]
  ], 12);
}

function iconRefresh() {
  return makeSvgIcon([
    ['path', { d: 'M21 12a9 9 0 1 1-2.64-6.36' }],
    ['polyline', { points: '21 3 21 9 15 9' }]
  ], 12);
}

function iconPower() {
  return makeSvgIcon([
    ['path', { d: 'M12 2v10' }],
    ['path', { d: 'M18.36 6.64a9 9 0 1 1-12.73 0' }]
  ], 12);
}

function iconMore() {
  return makeSvgIcon([
    ['circle', { cx: 5, cy: 12, r: 1.5 }],
    ['circle', { cx: 12, cy: 12, r: 1.5 }],
    ['circle', { cx: 19, cy: 12, r: 1.5 }]
  ], 12, '', true);
}

function iconClock() {
  return makeSvgIcon([
    ['circle', { cx: 12, cy: 12, r: 9 }],
    ['polyline', { points: '12 7 12 12 15.5 14' }]
  ], 10);
}

function iconGemini() {
  return makeSvgIcon([
    ['path', { d: 'M12 2L14.6 9.4L22 12L14.6 14.6L12 22L9.4 14.6L2 12L9.4 9.4Z' }]
  ], 11, 'agm-quota-family-icon', true);
}

function iconClaude() {
  return makeSvgIcon([
    ['path', { d: 'M12 3v18' }],
    ['path', { d: 'M4.5 7.5l15 9' }],
    ['path', { d: 'M19.5 7.5l-15 9' }]
  ], 11, 'agm-quota-family-icon is-claude');
}

function makePill(text, tone = '', small = false) {
  const span = document.createElement('span');
  span.className = `agm-pill${small ? ' agm-pill-sm' : ''}${tone ? ` agm-pill-${tone}` : ''}`;
  span.textContent = text;
  return span;
}

function formatSlotLabel(slot) {
  const key = `agManager.slot.${String(slot || '').toLowerCase()}`;
  const translated = t(key);
  return translated !== key ? translated : String(slot || '').toUpperCase();
}

function formatCompactTimestamp(rawTs) {
  const num = Number(rawTs || 0);
  if (!Number.isFinite(num) || num <= 0) return '';
  const ms = num < 1e12 ? num * 1000 : num;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function inferCapabilityPills(acc) {
  const models = Array.isArray(acc?.quota?.models) ? acc.quota.models : [];
  if (models.length === 0) return [];
  const pills = [];

  let g4Code = '';
  let claudeLabel = '';
  let gptLabel = '';

  for (const m of models) {
    const rawName = String(m?.name || '').trim().toLowerCase();
    if (!rawName) continue;

    if (!g4Code) {
      if (rawName.includes('argon') || rawName.includes('orchestrator-g1-pro')) {
        g4Code = 'Argon';
      } else if (rawName.startsWith('gemini-')) {
        const match = rawName.match(/^gemini-(\d+)(?:\.\d+)?-([a-z]+)/);
        if (match) {
          const major = Number.parseInt(match[1], 10);
          const candidate = match[2];
          if (major >= 4 && candidate && !GENERIC_CAPABILITY_WORDS.has(candidate)) {
            g4Code = candidate.charAt(0).toUpperCase() + candidate.slice(1);
          }
        }
      }
    }

    if (!claudeLabel && rawName.startsWith('claude')) {
      const verMatch = rawName.match(/claude-(?:sonnet|opus|haiku)?-?(\d+)(?:[-.](\d+))?/);
      if (verMatch) {
        claudeLabel = verMatch[2] ? `Claude ${verMatch[1]}.${verMatch[2]}` : `Claude ${verMatch[1]}`;
      } else {
        claudeLabel = 'Claude';
      }
    }

    if (!gptLabel && rawName.startsWith('gpt')) {
      const sizeMatch = rawName.match(/(\d+[abkm])\b/i);
      gptLabel = sizeMatch ? `GPT-${sizeMatch[1].toUpperCase()}` : 'GPT';
    }
  }

  if (g4Code) pills.push({ label: g4Code, tone: 'violet' });
  if (claudeLabel) pills.push({ label: claudeLabel, tone: 'amber' });
  if (gptLabel) pills.push({ label: gptLabel, tone: 'ok' });
  return pills.slice(0, 3);
}

function renderSummaryAndControls() {
  const mgr = state.manager;
  if (!mgr) return;
  const accounts = mgr.accounts || [];
  const cfg = mgr.config || {};
  const active = mgr.activeAccounts || {};

  const counts = { total: accounts.length, ULTRA: 0, PRO: 0, FREE: 0, abnormal: 0 };
  let hasSwitchable = false;
  for (const a of accounts) {
    if (a.subscriptionTier === 'ULTRA') counts.ULTRA += 1;
    else if (a.subscriptionTier === 'PRO') counts.PRO += 1;
    else if (a.subscriptionTier === 'FREE') counts.FREE += 1;
    if (isAbnormalAccount(a)) counts.abnormal += 1;
    if (a.hasToken && !a.disabled && !a.banned && !a.validationBlocked) hasSwitchable = true;
  }

  els.statsPills.replaceChildren(
    makePill(`${t('agManager.statTotal')}: ${counts.total}`),
    makePill(`Ultra: ${counts.ULTRA}`, 'accent'),
    makePill(`Pro: ${counts.PRO}`, 'ok'),
    makePill(`Free: ${counts.FREE}`, 'muted'),
    ...(counts.abnormal > 0 ? [makePill(`${t('agManager.filter.abnormal')}: ${counts.abnormal}`, 'warn')] : [])
  );

  const metaParts = [];
  if (cfg.autoRefresh) {
    metaParts.push(t('agManager.autoRefreshOn', { minutes: cfg.refreshIntervalMinutes || 10 }));
  } else {
    metaParts.push(t('agManager.autoRefreshOff'));
  }
  if (mgr.lastRefreshAt > 0) {
    metaParts.push(`${t('agManager.lastRefresh')}: ${new Date(mgr.lastRefreshAt * 1000).toLocaleTimeString()}`);
  }
  const activeSummary = Object.entries(active)
    .filter(([, id]) => Boolean(id))
    .map(([slot, id]) => {
      const found = accounts.find((a) => a.id === id);
      return found ? `${formatSlotLabel(slot)}: ${found.email}` : '';
    })
    .filter(Boolean);
  if (activeSummary.length > 0) {
    metaParts.push(activeSummary.join(' · '));
  }
  els.runtimeMeta.textContent = metaParts.join(' · ');

  els.targetClient.value = cfg.defaultSwitchTarget || 'auto';
  els.startupRefreshInput.checked = cfg.startupRefresh === true;
  els.autoRefreshInput.checked = cfg.autoRefresh === true;
  if (document.activeElement !== els.intervalInput) els.intervalInput.value = String(cfg.refreshIntervalMinutes || 10);
  if (document.activeElement !== els.concurrencyInput) els.concurrencyInput.value = String(cfg.refreshConcurrency || 5);
  if (document.activeElement !== els.slideDelayInput) els.slideDelayInput.value = String(cfg.refreshSlideDelaySecs ?? 0.2);
  els.syncToHubInput.checked = cfg.syncToHub !== false;
  els.restoreDeviceBtn.classList.toggle('hidden', !mgr.hasOriginalDeviceBackup);

  const refreshing = mgr.isRefreshing === true || state.refreshClickBusy;
  const selectedCount = state.selectedIds.size;
  els.refreshNowBtn.disabled = refreshing || accounts.length === 0;
  els.refreshNowLabel.textContent = refreshing
    ? t('agManager.refreshing')
    : (selectedCount > 0 ? t('agManager.refreshSelected', { count: selectedCount }) : t('agManager.refreshAll'));
  els.cancelRefreshBtn.classList.toggle('hidden', mgr.isRefreshing !== true);
  els.switchBestBtn.disabled = state.switchBestBusy || !hasSwitchable;
  els.exportBtn.disabled = accounts.length === 0;

  if (selectedCount === 0) state.batchDeleteConfirm = false;
  els.batchDeleteBtn.classList.toggle('hidden', selectedCount === 0);
  els.batchDeleteBtn.classList.toggle('is-confirm', state.batchDeleteConfirm && selectedCount > 0);
  els.batchDeleteBtn.textContent = state.batchDeleteConfirm && selectedCount > 0
    ? t('agManager.confirmDeleteSelected', { count: selectedCount })
    : t('agManager.deleteSelectedCount', { count: selectedCount });
}

function is5hBucket(b) {
  const text = `${b?.window || ''} ${b?.bucketId || ''}`.toLowerCase();
  return text.includes('5h') || text.includes('hour');
}

function isWeeklyBucket(b) {
  const text = `${b?.window || ''} ${b?.bucketId || ''}`.toLowerCase();
  return text.includes('week') || text.includes('7d');
}

function isClaudeOr3pGroup(g) {
  const text = `${g?.displayName || ''} ${(g?.buckets || []).map((b) => `${b.bucketId || ''} ${b.displayName || ''}`).join(' ')}`.toLowerCase();
  return text.includes('claude') || text.includes('gpt') || text.includes('3p');
}

function isDedicatedCodenameGroup(g) {
  const text = `${g?.displayName || ''} ${(g?.buckets || []).map((b) => `${b.bucketId || ''} ${b.displayName || ''}`).join(' ')}`.toLowerCase();
  return /\b(argon|hydrogen|carbon|helium|wtu)\b/.test(text);
}

function pctToneClass(pct) {
  if (pct <= 15) return 'is-low';
  if (pct <= 50) return 'is-warn';
  return '';
}

function renderQuotaGridCell({ icon, title = '', resetText = '—', resetTone = '', pct = 0, isFull = false, ariaLabel = '' }) {
  const clamped = Math.max(0, Math.min(100, Math.round(Number(pct || 0))));
  const toneCls = pctToneClass(clamped);

  const cell = document.createElement('div');
  cell.className = `agm-quota-cell${isFull ? ' is-full' : ''}`;
  if (ariaLabel) cell.setAttribute('aria-label', ariaLabel);

  const top = document.createElement('div');
  top.className = 'agm-quota-cell-top';

  const label = document.createElement('div');
  label.className = 'agm-quota-cell-label';
  if (icon) label.appendChild(icon);
  if (title) {
    const titleEl = document.createElement('span');
    titleEl.className = 'agm-quota-cell-title';
    titleEl.textContent = title;
    label.appendChild(titleEl);
  }
  const reset = document.createElement('span');
  reset.className = `agm-quota-reset${resetTone ? ` is-${resetTone}` : ''}`;
  reset.appendChild(iconClock());
  const resetVal = document.createElement('span');
  resetVal.textContent = resetText;
  reset.appendChild(resetVal);
  label.appendChild(reset);

  const pctEl = document.createElement('span');
  pctEl.className = `agm-quota-pct${toneCls ? ` ${toneCls}` : ''}`;
  pctEl.textContent = `${clamped}%`;

  top.append(label, pctEl);

  const meter = document.createElement('div');
  meter.className = 'agm-meter';
  const fill = document.createElement('div');
  fill.className = `agm-meter-fill${toneCls ? ` ${toneCls}` : ''}`;
  fill.style.width = `${clamped}%`;
  meter.appendChild(fill);

  cell.append(top, meter);
  return cell;
}

function renderQuotaGroups(acc, hasStatusMessage = false) {
  const groups = Array.isArray(acc?.quota?.groups) ? acc.quota.groups : [];
  const models = Array.isArray(acc?.quota?.models) ? acc.quota.models : [];

  if (groups.length > 0) {
    const claudeGroup = groups.find((g) => isClaudeOr3pGroup(g)) || null;
    const nonClaude = groups.filter((g) => g !== claudeGroup);
    const geminiGroup = nonClaude.find((g) => !isDedicatedCodenameGroup(g) && String(g.displayName || '').toLowerCase().includes('gemini'))
      || nonClaude.find((g) => !isDedicatedCodenameGroup(g))
      || nonClaude[0]
      || null;
    const extraGroups = nonClaude.filter((g) => g !== geminiGroup);

    const splitBuckets = (group) => {
      const buckets = Array.isArray(group?.buckets) ? group.buckets : [];
      const b5h = buckets.find((b) => is5hBucket(b)) || null;
      const bWeekly = buckets.find((b) => b !== b5h && isWeeklyBucket(b)) || null;
      const others = buckets.filter((b) => b !== b5h && b !== bWeekly);
      return { b5h, bWeekly, others };
    };

    const gBuckets = splitBuckets(geminiGroup);
    const cBuckets = splitBuckets(claudeGroup);

    const toPct = (b) => Math.max(0, Math.min(100, Math.round(Number(b?.remainingFraction || 0) * 100)));
    const cells = [];

    if (gBuckets.b5h) {
      const pct = toPct(gBuckets.b5h);
      const resetText = formatResetCountdown(gBuckets.b5h.resetTime);
      cells.push(renderQuotaGridCell({
        icon: iconGemini(),
        resetText,
        resetTone: '5h',
        pct,
        ariaLabel: `Gemini 5h: ${pct}% (${resetText})`
      }));
    }
    if (cBuckets.b5h) {
      const pct = toPct(cBuckets.b5h);
      const resetText = formatResetCountdown(cBuckets.b5h.resetTime);
      cells.push(renderQuotaGridCell({
        icon: iconClaude(),
        resetText,
        resetTone: '5h',
        pct,
        ariaLabel: `Claude / GPT 5h: ${pct}% (${resetText})`
      }));
    }
    if (gBuckets.bWeekly) {
      const pct = toPct(gBuckets.bWeekly);
      const resetText = formatResetCountdown(gBuckets.bWeekly.resetTime);
      cells.push(renderQuotaGridCell({
        icon: iconGemini(),
        resetText,
        resetTone: 'weekly',
        pct,
        ariaLabel: `Gemini weekly: ${pct}% (${resetText})`
      }));
    }
    if (cBuckets.bWeekly) {
      const pct = toPct(cBuckets.bWeekly);
      const resetText = formatResetCountdown(cBuckets.bWeekly.resetTime);
      cells.push(renderQuotaGridCell({
        icon: iconClaude(),
        resetText,
        resetTone: 'weekly',
        pct,
        ariaLabel: `Claude / GPT weekly: ${pct}% (${resetText})`
      }));
    }

    const pushExtra = (groupTitle, b, useGeminiIcon) => {
      const pct = toPct(b);
      const resetText = formatResetCountdown(b.resetTime);
      const label = [groupTitle, b.window || b.bucketId].filter(Boolean).join(' · ');
      cells.push(renderQuotaGridCell({
        icon: useGeminiIcon ? iconGemini() : iconClaude(),
        title: label,
        resetText,
        resetTone: is5hBucket(b) ? '5h' : (isWeeklyBucket(b) ? 'weekly' : ''),
        pct,
        isFull: true,
        ariaLabel: `${label}: ${pct}% (${resetText})`
      }));
    };

    for (const b of gBuckets.others) pushExtra(geminiGroup?.displayName || 'Gemini', b, true);
    for (const b of cBuckets.others) pushExtra(claudeGroup?.displayName || 'Claude', b, false);
    for (const g of extraGroups) {
      for (const b of g.buckets || []) {
        pushExtra(g.displayName || b.displayName || 'Quota', b, true);
      }
    }

    if (cells.length > 0) {
      const grid = document.createElement('div');
      grid.className = 'agm-quota-grid';
      grid.append(...cells);
      return grid;
    }
  }

  if (models.length > 0) {
    const grid = document.createElement('div');
    grid.className = 'agm-quota-grid';
    for (const m of models.slice(0, 4)) {
      const name = String(m.displayName || m.name || 'Model');
      const resetText = m.resetTime ? formatResetCountdown(m.resetTime) : '—';
      const pct = Math.max(0, Math.min(100, Math.round(Number(m.percentage || 0))));
      const useClaudeIcon = String(m.name || '').toLowerCase().startsWith('claude')
        || String(m.name || '').toLowerCase().startsWith('gpt');
      grid.appendChild(renderQuotaGridCell({
        icon: useClaudeIcon ? iconClaude() : iconGemini(),
        title: name,
        resetText,
        resetTone: 'weekly',
        pct,
        isFull: true,
        ariaLabel: `${name}: ${pct}% (${resetText})`
      }));
    }
    return grid;
  }

  if (hasStatusMessage) return null;

  const empty = document.createElement('div');
  empty.className = 'agm-card-hint';
  empty.textContent = acc?.hasToken === false ? t('agManager.noToken') : t('agManager.noQuotaData');
  return empty;
}

async function deleteSingleAccount(acc) {
  state.confirmDeleteId = '';
  state.openMoreId = '';
  try {
    const res = await agmApi().deleteAccounts([acc.id]);
    if (res && res.ok === false) {
      showToast(res.error || t('agManager.toast.actionFailed'), true);
      return;
    }
    state.selectedIds.delete(acc.id);
    showToast(t('agManager.toast.deletedCount', { count: 1 }));
  } catch (err) {
    showToast(err?.message || t('agManager.toast.actionFailed'), true);
  } finally {
    await loadState();
  }
}

function renderAccountCard(acc, activeAccounts) {
  const activeSlots = Object.entries(activeAccounts || {})
    .filter(([, id]) => id === acc.id)
    .map(([slot]) => slot);
  const isMenuOpen = state.openMoreId === acc.id;

  const card = document.createElement('article');
  card.className = `agm-card${activeSlots.length > 0 ? ' is-active' : ''}${acc.disabled ? ' is-disabled' : ''}${isMenuOpen ? ' has-menu-open' : ''}`;
  card.dataset.accountId = acc.id;

  const head = document.createElement('div');
  head.className = 'agm-card-head';

  const identity = document.createElement('div');
  identity.className = 'agm-card-identity';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'agm-card-check';
  checkbox.checked = state.selectedIds.has(acc.id);
  checkbox.setAttribute('aria-label', t('agManager.aria.selectAccount', { email: acc.email || acc.id }));
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) state.selectedIds.add(acc.id);
    else state.selectedIds.delete(acc.id);
    state.batchDeleteConfirm = false;
    renderSummaryAndControls();
    const visible = filteredAccounts();
    els.selectAllInput.checked = visible.length > 0 && visible.every((item) => state.selectedIds.has(item.id));
  });

  const emailEl = document.createElement('div');
  emailEl.className = 'agm-card-email';
  emailEl.textContent = acc.email || acc.id;
  identity.append(checkbox, emailEl);

  const headActions = document.createElement('div');
  headActions.className = 'agm-card-head-actions';

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'agm-icon-btn';
  copyBtn.setAttribute('aria-label', t('agManager.copyEmail'));
  copyBtn.appendChild(iconCopy());
  copyBtn.addEventListener('click', async () => {
    const emailText = acc.email || acc.id;
    try {
      await copyEmailText(emailText);
      showToast(t('agManager.toast.emailCopied', { email: emailText }));
    } catch (err) {
      showToast(err?.message || t('agManager.toast.copyFailed'), true);
    }
  });

  const isConfirmHead = state.confirmDeleteId === acc.id && state.openMoreId !== acc.id;
  const headDeleteBtn = document.createElement('button');
  headDeleteBtn.type = 'button';
  headDeleteBtn.className = `agm-icon-btn agm-icon-btn-danger agm-delete-confirm-trigger${isConfirmHead ? ' is-confirm' : ''}`;
  headDeleteBtn.setAttribute('aria-label', isConfirmHead ? t('agManager.confirmDelete') : t('agManager.delete'));
  if (isConfirmHead) {
    headDeleteBtn.textContent = t('agManager.confirmDelete');
  } else {
    headDeleteBtn.appendChild(iconTrash());
  }
  headDeleteBtn.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    if (state.confirmDeleteId !== acc.id) {
      state.confirmDeleteId = acc.id;
      state.openMoreId = '';
      renderAccounts();
      return;
    }
    headDeleteBtn.disabled = true;
    await deleteSingleAccount(acc);
  });

  headActions.append(copyBtn, headDeleteBtn);
  head.append(identity, headActions);
  card.appendChild(head);

  const metaRow = document.createElement('div');
  metaRow.className = 'agm-card-meta-row';

  const pills = document.createElement('div');
  pills.className = 'agm-card-pills';
  for (const slot of activeSlots) {
    pills.appendChild(makePill(formatSlotLabel(slot), 'accent', true));
  }
  if (acc.banned) pills.appendChild(makePill(t('agManager.badge.banned'), 'danger', true));
  else if (acc.validationBlocked) pills.appendChild(makePill(t('agManager.badge.validation'), 'warn', true));
  else if (acc.disabled) pills.appendChild(makePill(t('agManager.badge.disabled'), 'warn', true));
  else if (acc.quota?.isForbidden) pills.appendChild(makePill('403', 'warn', true));

  const tier = acc.subscriptionTier || 'UNKNOWN';
  if (tier === 'ULTRA') pills.appendChild(makePill('◆ ULTRA', 'tier-ultra', true));
  else if (tier === 'PRO') pills.appendChild(makePill('◆ PRO', 'tier-pro', true));
  else pills.appendChild(makePill(tier, 'muted', true));

  if (acc.hasDeviceProfile) {
    pills.appendChild(makePill(t('agManager.isolatedBadge'), 'muted', true));
  }
  for (const cap of inferCapabilityPills(acc)) {
    pills.appendChild(makePill(cap.label, cap.tone, true));
  }

  metaRow.appendChild(pills);

  const tsText = formatCompactTimestamp(acc.quota?.lastUpdatedAt || acc.lastUsedAt);
  if (tsText) {
    const timeEl = document.createElement('span');
    timeEl.className = 'agm-card-time';
    timeEl.textContent = tsText;
    metaRow.appendChild(timeEl);
  }
  card.appendChild(metaRow);

  let hasStatusMessage = false;
  if (acc.validationBlocked && acc.validationMessage) {
    const msg = document.createElement('div');
    msg.className = 'agm-card-hint is-error';
    msg.textContent = acc.validationMessage;
    card.appendChild(msg);
    hasStatusMessage = true;
  } else if (acc.banned && acc.banInfo?.message) {
    const msg = document.createElement('div');
    msg.className = 'agm-card-hint is-error';
    msg.textContent = acc.banInfo.message;
    card.appendChild(msg);
    hasStatusMessage = true;
  } else if (acc.quota?.isForbidden && acc.quota?.forbiddenReason) {
    const msg = document.createElement('div');
    msg.className = 'agm-card-hint is-error';
    msg.textContent = acc.quota.forbiddenReason;
    card.appendChild(msg);
    hasStatusMessage = true;
  } else if (acc.disabled && acc.disabledReason && acc.disabledReason !== 'Manually disabled') {
    const msg = document.createElement('div');
    msg.className = 'agm-card-hint is-error';
    msg.textContent = acc.disabledReason;
    card.appendChild(msg);
    hasStatusMessage = true;
  }

  const quotaNode = renderQuotaGroups(acc, hasStatusMessage);
  if (quotaNode) card.appendChild(quotaNode);

  const models = Array.isArray(acc?.quota?.models) ? acc.quota.models : [];
  if (models.length > 0 && state.expandedModels.has(acc.id)) {
    const grid = document.createElement('div');
    grid.className = 'agm-models-grid';
    for (const m of models) {
      const mRow = document.createElement('div');
      mRow.className = 'agm-model-row';
      const mName = document.createElement('span');
      mName.textContent = m.displayName || m.name;
      const mPct = document.createElement('span');
      mPct.textContent = `${m.percentage}%${m.resetTime ? ` · ${formatResetCountdown(m.resetTime)}` : ''}`;
      mRow.append(mName, mPct);
      grid.appendChild(mRow);
    }
    card.appendChild(grid);
  }

  const actions = document.createElement('div');
  actions.className = 'agm-card-actions-grid';

  const switchBtn = document.createElement('button');
  switchBtn.type = 'button';
  switchBtn.className = 'agm-action-btn agm-action-switch';
  const switchLabel = document.createElement('span');
  switchLabel.textContent = t('agManager.switchAccount');
  switchBtn.append(iconSwitch(), switchLabel);
  switchBtn.disabled = !acc.hasToken;
  switchBtn.addEventListener('click', async () => {
    switchBtn.disabled = true;
    try {
      const res = await agmApi().switchAccount(acc.id, els.targetClient.value);
      if (res?.ok) {
        showToast(t('agManager.toast.switchSuccess', { email: acc.email, target: res.target, mode: res.mode }));
      } else {
        showToast(res?.error || t('agManager.toast.switchFailed'), true);
      }
    } catch (err) {
      showToast(err?.message || t('agManager.toast.switchFailed'), true);
    } finally {
      await loadState();
    }
  });

  const refreshBtn = document.createElement('button');
  refreshBtn.type = 'button';
  refreshBtn.className = 'agm-action-btn';
  const refreshLabel = document.createElement('span');
  refreshLabel.textContent = t('agManager.refreshOne');
  refreshBtn.append(iconRefresh(), refreshLabel);
  refreshBtn.disabled = !acc.hasToken;
  refreshBtn.addEventListener('click', async () => {
    refreshBtn.disabled = true;
    try {
      const res = await agmApi().refreshAccount(acc.id);
      if (!res?.ok) showToast(res?.error || t('agManager.toast.refreshFailed'), true);
      else showToast(t('agManager.toast.refreshOneOk', { email: acc.email }));
    } catch (err) {
      showToast(err?.message || t('agManager.toast.refreshFailed'), true);
    } finally {
      await loadState();
    }
  });

  const toggleDisableBtn = document.createElement('button');
  toggleDisableBtn.type = 'button';
  toggleDisableBtn.className = `agm-action-btn agm-action-toggle ${acc.disabled ? 'is-enable' : 'is-disable'}`;
  const toggleLabel = document.createElement('span');
  toggleLabel.textContent = acc.disabled ? t('agManager.enable') : t('agManager.disable');
  toggleDisableBtn.append(iconPower(), toggleLabel);
  toggleDisableBtn.addEventListener('click', async () => {
    toggleDisableBtn.disabled = true;
    try {
      const res = await agmApi().setAccountDisabled(acc.id, !acc.disabled);
      if (res && res.ok === false) {
        showToast(res.error || t('agManager.toast.actionFailed'), true);
      }
    } catch (err) {
      showToast(err?.message || t('agManager.toast.actionFailed'), true);
    } finally {
      await loadState();
    }
  });

  const moreWrap = document.createElement('div');
  moreWrap.className = 'agm-more-wrap';

  const moreBtn = document.createElement('button');
  moreBtn.type = 'button';
  moreBtn.className = 'agm-action-btn agm-more-trigger';
  moreBtn.setAttribute('aria-haspopup', 'menu');
  moreBtn.setAttribute('aria-expanded', String(isMenuOpen));
  const moreLabel = document.createElement('span');
  moreLabel.textContent = t('agManager.moreActions');
  moreBtn.append(iconMore(), moreLabel);
  moreBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const opening = state.openMoreId !== acc.id;
    state.openMoreId = opening ? acc.id : '';
    if (!opening && state.confirmDeleteId === acc.id) state.confirmDeleteId = '';
    renderAccounts();
    if (opening) {
      const firstItem = els.accountList.querySelector(`.agm-card[data-account-id="${CSS.escape(acc.id)}"] .agm-more-item`);
      if (ev.detail === 0) firstItem?.focus();
    }
  });
  moreWrap.appendChild(moreBtn);

  if (isMenuOpen) {
    const menu = document.createElement('div');
    menu.className = 'agm-more-menu';
    menu.setAttribute('role', 'menu');
    menu.addEventListener('keydown', (ev) => {
      const items = Array.from(menu.querySelectorAll('.agm-more-item'));
      if (items.length === 0) return;
      const idx = items.indexOf(document.activeElement);
      if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        items[(idx + 1 + items.length) % items.length]?.focus();
      } else if (ev.key === 'ArrowUp') {
        ev.preventDefault();
        items[(idx - 1 + items.length) % items.length]?.focus();
      } else if (ev.key === 'Home') {
        ev.preventDefault();
        items[0]?.focus();
      } else if (ev.key === 'End') {
        ev.preventDefault();
        items[items.length - 1]?.focus();
      }
    });

    if (models.length > 0) {
      const expanded = state.expandedModels.has(acc.id);
      const modelsItem = document.createElement('button');
      modelsItem.type = 'button';
      modelsItem.className = 'agm-more-item';
      modelsItem.setAttribute('role', 'menuitem');
      modelsItem.textContent = expanded
        ? t('agManager.hideModels', { count: models.length })
        : t('agManager.showModels', { count: models.length });
      modelsItem.addEventListener('click', () => {
        if (state.expandedModels.has(acc.id)) state.expandedModels.delete(acc.id);
        else state.expandedModels.add(acc.id);
        state.openMoreId = '';
        renderAccounts();
      });
      menu.appendChild(modelsItem);
    }

    const deviceItem = document.createElement('button');
    deviceItem.type = 'button';
    deviceItem.className = 'agm-more-item';
    deviceItem.setAttribute('role', 'menuitem');
    deviceItem.textContent = t('agManager.deviceBtn');
    deviceItem.addEventListener('click', () => {
      state.openMoreId = '';
      renderAccounts();
      openDeviceDialog(acc);
    });
    menu.appendChild(deviceItem);

    const isConfirmMenu = state.confirmDeleteId === acc.id;
    const deleteItem = document.createElement('button');
    deleteItem.type = 'button';
    deleteItem.className = `agm-more-item is-danger agm-delete-confirm-trigger${isConfirmMenu ? ' is-confirm' : ''}`;
    deleteItem.setAttribute('role', 'menuitem');
    deleteItem.textContent = isConfirmMenu
      ? t('agManager.confirmDelete')
      : t('agManager.delete');
    deleteItem.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      if (state.confirmDeleteId !== acc.id) {
        state.confirmDeleteId = acc.id;
        state.openMoreId = acc.id;
        renderAccounts();
        const nextConfirm = els.accountList.querySelector(`.agm-card[data-account-id="${CSS.escape(acc.id)}"] .agm-more-menu .agm-delete-confirm-trigger`);
        nextConfirm?.focus();
        return;
      }
      deleteItem.disabled = true;
      await deleteSingleAccount(acc);
    });
    menu.appendChild(deleteItem);

    moreWrap.appendChild(menu);
  }

  actions.append(switchBtn, refreshBtn, toggleDisableBtn, moreWrap);
  card.appendChild(actions);

  return card;
}

function positionOpenMoreMenu() {
  const menu = els.accountList?.querySelector('.agm-more-menu');
  if (!menu) return;
  menu.classList.remove('is-below');
  const listRect = els.accountList.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  if (menuRect.top < listRect.top + 4) {
    const triggerRect = menu.parentElement?.getBoundingClientRect();
    const spaceBelow = triggerRect ? (listRect.bottom - triggerRect.bottom) : 0;
    const spaceAbove = triggerRect ? (triggerRect.top - listRect.top) : 0;
    if (spaceBelow > spaceAbove) {
      menu.classList.add('is-below');
    }
  }
}

function positionRefreshPopover() {
  if (!els.refreshPopover || els.refreshPopover.classList.contains('hidden')) return;
  els.refreshPopover.classList.remove('align-left');
  const rect = els.refreshPopover.getBoundingClientRect();
  if (rect.left < 14) {
    els.refreshPopover.classList.add('align-left');
  }
}

function renderAccounts() {
  const list = filteredAccounts();
  els.selectAllInput.disabled = list.length === 0;
  if (list.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'agm-empty';
    empty.textContent = (state.manager?.accounts || []).length === 0
      ? t('agManager.emptyPool')
      : t('agManager.emptyFilter');
    els.accountList.replaceChildren(empty);
    els.selectAllInput.checked = false;
    return;
  }
  const active = state.manager?.activeAccounts || {};
  els.accountList.replaceChildren(...list.map((acc) => renderAccountCard(acc, active)));
  els.selectAllInput.checked = list.every((acc) => state.selectedIds.has(acc.id));
  if (state.openMoreId) positionOpenMoreMenu();
}

function renderAll() {
  renderSummaryAndControls();
  renderAccounts();
}

function openDeviceDialog(acc) {
  els.deviceBody.replaceChildren();
  const info = document.createElement('p');
  info.className = 'agm-hint';
  info.textContent = `${acc.email || acc.id}`;
  const pre = document.createElement('pre');
  pre.className = 'agm-mono-pre';
  pre.textContent = acc.deviceProfile
    ? JSON.stringify(acc.deviceProfile, null, 2)
    : t('agManager.noDeviceProfile');

  const actions = document.createElement('div');
  actions.className = 'agm-dialog-actions';

  const genBtn = document.createElement('button');
  genBtn.type = 'button';
  genBtn.className = 'agm-btn agm-btn-primary';
  genBtn.textContent = t('agManager.generateDevice');
  genBtn.addEventListener('click', async () => {
    genBtn.disabled = true;
    capBtn.disabled = true;
    try {
      const res = await agmApi().bindDeviceProfile(acc.id, 'generate');
      if (res?.ok) {
        pre.textContent = JSON.stringify(res.deviceProfile, null, 2);
        showToast(t('agManager.toast.deviceUpdated'));
        await loadState();
      } else {
        showToast(res?.error || t('agManager.toast.actionFailed'), true);
      }
    } catch (err) {
      showToast(err?.message || t('agManager.toast.actionFailed'), true);
    } finally {
      genBtn.disabled = false;
      capBtn.disabled = false;
    }
  });

  const capBtn = document.createElement('button');
  capBtn.type = 'button';
  capBtn.className = 'agm-btn';
  capBtn.textContent = t('agManager.captureDevice');
  capBtn.addEventListener('click', async () => {
    genBtn.disabled = true;
    capBtn.disabled = true;
    try {
      const res = await agmApi().bindDeviceProfile(acc.id, 'capture');
      if (res?.ok) {
        pre.textContent = JSON.stringify(res.deviceProfile, null, 2);
        showToast(t('agManager.toast.deviceUpdated'));
        await loadState();
      } else {
        showToast(res?.error || t('agManager.toast.actionFailed'), true);
      }
    } catch (err) {
      showToast(err?.message || t('agManager.toast.actionFailed'), true);
    } finally {
      genBtn.disabled = false;
      capBtn.disabled = false;
    }
  });

  actions.append(capBtn, genBtn);
  els.deviceBody.append(info, pre, actions);
  els.deviceDialog.showModal();
}

function applyManagerState(nextState) {
  state.manager = nextState;
  const validIds = new Set((state.manager?.accounts || []).map((a) => a.id));
  for (const id of [...state.selectedIds]) {
    if (!validIds.has(id)) state.selectedIds.delete(id);
  }
  for (const id of [...state.expandedModels]) {
    if (!validIds.has(id)) state.expandedModels.delete(id);
  }
  if (state.openMoreId && !validIds.has(state.openMoreId)) state.openMoreId = '';
  if (state.confirmDeleteId && !validIds.has(state.confirmDeleteId)) state.confirmDeleteId = '';
  if (state.selectedIds.size === 0) state.batchDeleteConfirm = false;
  if (state.manager?.isRefreshing !== true && !state.importBusy) {
    hideProgressBar();
  }
  renderAll();
}

async function loadState() {
  try {
    const nextState = await agmApi().getState();
    applyManagerState(nextState);
  } catch (err) {
    showToast(err?.message || t('agManager.toast.actionFailed'), true);
  }
}

async function persistConfigPatch(patch) {
  try {
    const res = await agmApi().updateConfig(patch);
    if (res?.ok && state.manager) {
      state.manager.config = res.config;
      renderSummaryAndControls();
    } else if (res && res.ok === false) {
      showToast(res.error || t('agManager.toast.actionFailed'), true);
    }
  } catch (err) {
    showToast(err?.message || t('agManager.toast.actionFailed'), true);
  }
}

function setImportTab(target, { focus = false } = {}) {
  for (const btn of els.importTabs) {
    const active = btn.dataset.importTab === target;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
    btn.tabIndex = active ? 0 : -1;
    if (active && focus) btn.focus();
  }
  els.importTabJson.classList.toggle('hidden', target !== 'json');
  els.importTabDb.classList.toggle('hidden', target !== 'db');
  els.importTabOauth.classList.toggle('hidden', target !== 'oauth');
}

function closeRefreshPopover({ restoreFocus = false } = {}) {
  if (els.refreshPopover.classList.contains('hidden')) return false;
  els.refreshPopover.classList.add('hidden');
  els.refreshMenuBtn.setAttribute('aria-expanded', 'false');
  if (restoreFocus) els.refreshMenuBtn.focus();
  return true;
}

function wireEvents() {
  els.themeToggle.addEventListener('click', () => {
    state.flat = !state.flat;
    els.body.classList.toggle('flat', state.flat);
    window.tokenMonitor.updateSettings?.({ dashboardFlat: state.flat });
  });
  els.minBtn.addEventListener('click', () => agmApi().minimize());
  els.closeBtn.addEventListener('click', () => agmApi().close());

  els.targetClient.addEventListener('change', () => {
    void persistConfigPatch({ defaultSwitchTarget: els.targetClient.value });
  });

  els.switchBestBtn.addEventListener('click', async () => {
    state.switchBestBusy = true;
    els.switchBestBtn.disabled = true;
    try {
      const res = await agmApi().switchBestAccount(els.targetClient.value);
      if (res?.ok) {
        showToast(t('agManager.toast.switchBestOk', { target: res.target, mode: res.mode }));
      } else {
        showToast(res?.error || t('agManager.toast.switchFailed'), true);
      }
    } catch (err) {
      showToast(err?.message || t('agManager.toast.switchFailed'), true);
    } finally {
      state.switchBestBusy = false;
      await loadState();
    }
  });

  els.refreshNowBtn.addEventListener('click', async () => {
    state.refreshClickBusy = true;
    renderSummaryAndControls();
    try {
      const ids = state.selectedIds.size > 0 ? Array.from(state.selectedIds) : [];
      const res = ids.length > 0 ? await agmApi().refreshAccounts(ids) : await agmApi().refreshAll();
      if (res?.ok) {
        showToast(t('agManager.toast.refreshBatchDone', { success: res.success, failed: res.failed }));
      } else if (res?.error) {
        showToast(res.error, true);
      }
    } catch (err) {
      showToast(err?.message || t('agManager.toast.refreshFailed'), true);
    } finally {
      state.refreshClickBusy = false;
      hideProgressBar();
      await loadState();
    }
  });

  els.cancelRefreshBtn.addEventListener('click', () => {
    void agmApi().cancelRefresh();
  });

  els.refreshMenuBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const isHidden = els.refreshPopover.classList.toggle('hidden');
    els.refreshMenuBtn.setAttribute('aria-expanded', String(!isHidden));
    if (!isHidden) positionRefreshPopover();
  });

  const onDocumentClick = (ev) => {
    const targetEl = ev.target instanceof Element ? ev.target : null;
    if (!els.refreshSplit.contains(ev.target)) {
      closeRefreshPopover();
    }
    let shouldRenderCards = false;
    if (state.openMoreId && !targetEl?.closest?.('.agm-more-wrap')) {
      state.openMoreId = '';
      shouldRenderCards = true;
    }
    if (state.confirmDeleteId && !targetEl?.closest?.('.agm-delete-confirm-trigger')) {
      state.confirmDeleteId = '';
      shouldRenderCards = true;
    }
    if (state.batchDeleteConfirm && !els.batchDeleteBtn.contains(ev.target)) {
      state.batchDeleteConfirm = false;
      renderSummaryAndControls();
    }
    if (shouldRenderCards) renderAccounts();
  };
  document.addEventListener('click', onDocumentClick);
  registerCleanup(() => document.removeEventListener('click', onDocumentClick));

  const onDocumentKeyDown = (ev) => {
    if (ev.key !== 'Escape') return;
    if (closeRefreshPopover({ restoreFocus: true })) {
      ev.preventDefault();
      return;
    }
    if (state.openMoreId) {
      const prevId = state.openMoreId;
      state.openMoreId = '';
      state.confirmDeleteId = '';
      renderAccounts();
      const trigger = els.accountList.querySelector(`.agm-card[data-account-id="${CSS.escape(prevId)}"] .agm-more-trigger`);
      trigger?.focus();
      ev.preventDefault();
      return;
    }
    let handled = false;
    if (state.confirmDeleteId) {
      state.confirmDeleteId = '';
      renderAccounts();
      handled = true;
    }
    if (state.batchDeleteConfirm) {
      state.batchDeleteConfirm = false;
      renderSummaryAndControls();
      handled = true;
    }
    if (handled) ev.preventDefault();
  };
  document.addEventListener('keydown', onDocumentKeyDown);
  registerCleanup(() => document.removeEventListener('keydown', onDocumentKeyDown));

  const onWindowResize = () => {
    positionRefreshPopover();
    if (state.openMoreId) positionOpenMoreMenu();
  };
  window.addEventListener('resize', onWindowResize);
  registerCleanup(() => window.removeEventListener('resize', onWindowResize));

  els.startupRefreshInput.addEventListener('change', () => {
    void persistConfigPatch({ startupRefresh: els.startupRefreshInput.checked });
  });
  els.autoRefreshInput.addEventListener('change', () => {
    void persistConfigPatch({ autoRefresh: els.autoRefreshInput.checked });
  });
  els.syncToHubInput.addEventListener('change', () => {
    void persistConfigPatch({ syncToHub: els.syncToHubInput.checked });
  });
  els.intervalInput.addEventListener('change', () => {
    const parsed = Number(els.intervalInput.value);
    const val = Number.isFinite(parsed) ? Math.max(1, Math.min(1440, Math.round(parsed))) : 10;
    els.intervalInput.value = String(val);
    void persistConfigPatch({ refreshIntervalMinutes: val });
  });
  els.concurrencyInput.addEventListener('change', () => {
    const parsed = Number(els.concurrencyInput.value);
    const val = Number.isFinite(parsed) ? Math.max(1, Math.min(20, Math.round(parsed))) : 5;
    els.concurrencyInput.value = String(val);
    void persistConfigPatch({ refreshConcurrency: val });
  });
  els.slideDelayInput.addEventListener('change', () => {
    const parsed = Number(els.slideDelayInput.value);
    const val = Number.isFinite(parsed) ? Math.max(0, Math.min(10, Math.round(parsed * 100) / 100)) : 0.2;
    els.slideDelayInput.value = String(val);
    void persistConfigPatch({ refreshSlideDelaySecs: val });
  });

  els.searchInput.addEventListener('input', () => {
    state.search = els.searchInput.value;
    renderAccounts();
  });

  for (const chip of els.filterChips) {
    chip.addEventListener('click', () => {
      state.filter = chip.dataset.filter || 'all';
      for (const c of els.filterChips) {
        const active = c === chip;
        c.classList.toggle('active', active);
        c.setAttribute('aria-pressed', String(active));
      }
      renderAccounts();
    });
  }

  els.selectAllInput.addEventListener('change', () => {
    const visible = filteredAccounts();
    if (els.selectAllInput.checked) {
      for (const a of visible) state.selectedIds.add(a.id);
    } else {
      for (const a of visible) state.selectedIds.delete(a.id);
    }
    state.batchDeleteConfirm = false;
    renderAll();
  });

  els.batchDeleteBtn.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    const ids = Array.from(state.selectedIds);
    if (ids.length === 0) return;
    if (!state.batchDeleteConfirm) {
      state.batchDeleteConfirm = true;
      renderSummaryAndControls();
      return;
    }
    state.batchDeleteConfirm = false;
    els.batchDeleteBtn.disabled = true;
    try {
      const res = await agmApi().deleteAccounts(ids);
      if (res && res.ok === false) {
        showToast(res.error || t('agManager.toast.actionFailed'), true);
        return;
      }
      state.selectedIds.clear();
      showToast(t('agManager.toast.deletedCount', { count: ids.length }));
    } catch (err) {
      showToast(err?.message || t('agManager.toast.actionFailed'), true);
    } finally {
      els.batchDeleteBtn.disabled = false;
      await loadState();
    }
  });

  els.exportBtn.addEventListener('click', async () => {
    els.exportBtn.disabled = true;
    try {
      const ids = state.selectedIds.size > 0 ? Array.from(state.selectedIds) : [];
      const res = await agmApi().exportAccounts(ids);
      if (res?.canceled) return;
      if (res?.ok) showToast(t('agManager.toast.exportOk', { count: res.count }));
      else showToast(res?.error || t('agManager.toast.actionFailed'), true);
    } catch (err) {
      showToast(err?.message || t('agManager.toast.actionFailed'), true);
    } finally {
      renderSummaryAndControls();
    }
  });

  els.restoreDeviceBtn.addEventListener('click', async () => {
    els.restoreDeviceBtn.disabled = true;
    try {
      const res = await agmApi().restoreOriginalDevice();
      if (res?.ok) showToast(t('agManager.toast.restoreOk'));
      else showToast(res?.error || t('agManager.toast.actionFailed'), true);
    } catch (err) {
      showToast(err?.message || t('agManager.toast.actionFailed'), true);
    } finally {
      els.restoreDeviceBtn.disabled = false;
    }
  });

  // Import and device dialogs
  els.openImportBtn.addEventListener('click', () => {
    closeRefreshPopover();
    els.importDialog.showModal();
  });
  els.closeImportDialog.addEventListener('click', () => els.importDialog.close());
  els.closeDeviceDialog.addEventListener('click', () => els.deviceDialog.close());

  els.importDialog.addEventListener('close', () => {
    if (state.oauthBusy) void agmApi().cancelOAuthLogin();
  });
  els.importDialog.addEventListener('click', (ev) => {
    if (ev.target === els.importDialog) els.importDialog.close();
  });
  els.deviceDialog.addEventListener('click', (ev) => {
    if (ev.target === els.deviceDialog) els.deviceDialog.close();
  });

  for (const tab of els.importTabs) {
    tab.addEventListener('click', () => {
      setImportTab(tab.dataset.importTab || 'json');
    });
    tab.addEventListener('keydown', (ev) => {
      const idx = els.importTabs.indexOf(tab);
      if (ev.key === 'ArrowRight') {
        ev.preventDefault();
        const next = els.importTabs[(idx + 1) % els.importTabs.length];
        setImportTab(next.dataset.importTab || 'json', { focus: true });
      } else if (ev.key === 'ArrowLeft') {
        ev.preventDefault();
        const prev = els.importTabs[(idx - 1 + els.importTabs.length) % els.importTabs.length];
        setImportTab(prev.dataset.importTab || 'json', { focus: true });
      } else if (ev.key === 'Home') {
        ev.preventDefault();
        setImportTab(els.importTabs[0].dataset.importTab || 'json', { focus: true });
      } else if (ev.key === 'End') {
        ev.preventDefault();
        setImportTab(els.importTabs[els.importTabs.length - 1].dataset.importTab || 'json', { focus: true });
      }
    });
  }

  els.pickJsonFileBtn.addEventListener('click', async () => {
    state.importBusy = true;
    els.pickJsonFileBtn.disabled = true;
    try {
      const res = await agmApi().pickAndImportJson({ refreshAfterImport: els.refreshAfterImportInput.checked });
      if (res?.canceled) return;
      if (res?.ok) {
        showToast(t('agManager.toast.importDone', { success: res.success, failed: res.failed }));
        els.importDialog.close();
      } else {
        showToast(res?.error || t('agManager.toast.actionFailed'), true);
      }
    } catch (err) {
      showToast(err?.message || t('agManager.toast.actionFailed'), true);
    } finally {
      state.importBusy = false;
      els.pickJsonFileBtn.disabled = false;
      hideProgressBar();
      await loadState();
    }
  });

  els.submitPasteBtn.addEventListener('click', async () => {
    const text = els.tokenPasteInput.value.trim();
    if (!text) return;
    state.importBusy = true;
    els.submitPasteBtn.disabled = true;
    try {
      const res = await agmApi().importFromString(text, { refreshAfterImport: els.refreshAfterImportInput.checked });
      if (res?.ok) {
        els.tokenPasteInput.value = '';
        showToast(t('agManager.toast.importDone', { success: res.success, failed: res.failed }));
        els.importDialog.close();
      } else {
        showToast(res?.error || t('agManager.toast.actionFailed'), true);
      }
    } catch (err) {
      showToast(err?.message || t('agManager.toast.actionFailed'), true);
    } finally {
      state.importBusy = false;
      els.submitPasteBtn.disabled = false;
      hideProgressBar();
      await loadState();
    }
  });

  els.importDefaultDirBtn.addEventListener('click', async () => {
    els.importDefaultDirBtn.disabled = true;
    try {
      const res = await agmApi().importDefaultDataDir();
      if (res?.ok) {
        showToast(t('agManager.toast.importDirDone', { count: res.imported }));
        els.importDialog.close();
      } else {
        showToast(res?.error || t('agManager.toast.actionFailed'), true);
      }
    } catch (err) {
      showToast(err?.message || t('agManager.toast.actionFailed'), true);
    } finally {
      els.importDefaultDirBtn.disabled = false;
      await loadState();
    }
  });

  els.pickDataDirBtn.addEventListener('click', async () => {
    els.pickDataDirBtn.disabled = true;
    try {
      const res = await agmApi().pickAndImportDataDir();
      if (res?.canceled) return;
      if (res?.ok) {
        showToast(t('agManager.toast.importDirDone', { count: res.imported }));
        els.importDialog.close();
      } else {
        showToast(res?.error || t('agManager.toast.actionFailed'), true);
      }
    } catch (err) {
      showToast(err?.message || t('agManager.toast.actionFailed'), true);
    } finally {
      els.pickDataDirBtn.disabled = false;
      await loadState();
    }
  });

  els.scanLocalBtn.addEventListener('click', async () => {
    state.importBusy = true;
    els.scanLocalBtn.disabled = true;
    try {
      const res = await agmApi().scanLocalAccounts();
      if (res?.ok) {
        showToast(t('agManager.toast.importDone', { success: res.success, failed: res.failed }));
        els.importDialog.close();
      } else {
        showToast(res?.error || t('agManager.toast.actionFailed'), true);
      }
    } catch (err) {
      showToast(err?.message || t('agManager.toast.actionFailed'), true);
    } finally {
      state.importBusy = false;
      els.scanLocalBtn.disabled = false;
      hideProgressBar();
      await loadState();
    }
  });

  els.pickStateDbBtn.addEventListener('click', async () => {
    els.pickStateDbBtn.disabled = true;
    try {
      const res = await agmApi().pickAndImportStateDb();
      if (res?.canceled) return;
      if (res?.ok) {
        showToast(t('agManager.toast.importSingleOk', { email: res.account?.email || '' }));
        els.importDialog.close();
      } else {
        showToast(res?.error || t('agManager.toast.actionFailed'), true);
      }
    } catch (err) {
      showToast(err?.message || t('agManager.toast.actionFailed'), true);
    } finally {
      els.pickStateDbBtn.disabled = false;
      await loadState();
    }
  });

  els.pickV1DirBtn.addEventListener('click', async () => {
    state.importBusy = true;
    els.pickV1DirBtn.disabled = true;
    try {
      const res = await agmApi().pickAndImportV1Dir();
      if (res?.canceled) return;
      if (res?.ok) {
        showToast(t('agManager.toast.importDone', { success: res.success, failed: res.failed }));
        els.importDialog.close();
      } else {
        showToast(res?.error || t('agManager.toast.actionFailed'), true);
      }
    } catch (err) {
      showToast(err?.message || t('agManager.toast.actionFailed'), true);
    } finally {
      state.importBusy = false;
      els.pickV1DirBtn.disabled = false;
      hideProgressBar();
      await loadState();
    }
  });

  els.startOAuthBtn.addEventListener('click', async () => {
    state.oauthBusy = true;
    els.startOAuthBtn.disabled = true;
    els.cancelOAuthBtn.classList.remove('hidden');
    try {
      const res = await agmApi().startOAuthLogin(els.oauthClientSelect.value);
      if (res?.ok) {
        showToast(t('agManager.toast.importSingleOk', { email: res.account?.email || '' }));
        els.importDialog.close();
      } else {
        showToast(res?.error || t('agManager.toast.actionFailed'), true);
      }
    } catch (err) {
      showToast(err?.message || t('agManager.toast.actionFailed'), true);
    } finally {
      state.oauthBusy = false;
      els.startOAuthBtn.disabled = false;
      els.cancelOAuthBtn.classList.add('hidden');
      await loadState();
    }
  });

  els.cancelOAuthBtn.addEventListener('click', () => {
    void agmApi().cancelOAuthLogin();
  });

  registerCleanup(agmApi().onState?.((nextState) => {
    applyManagerState(nextState);
  }));
  registerCleanup(agmApi().onRefreshProgress?.((p) => {
    if (!p || !p.total) return;
    els.progressBar.classList.remove('hidden');
    els.progressBar.textContent = t('agManager.refreshProgress', {
      current: p.current,
      total: p.total,
      email: p.currentEmail || ''
    });
  }));
  registerCleanup(agmApi().onImportProgress?.((p) => {
    if (!p || !p.total) return;
    els.progressBar.classList.remove('hidden');
    els.progressBar.textContent = t('agManager.importProgress', {
      current: p.current,
      total: p.total,
      email: p.email || ''
    });
  }));
}

async function boot() {
  if (typeof window.tokenMonitor.onNativeMaterialState === 'function') {
    registerCleanup(window.tokenMonitor.onNativeMaterialState((next) => {
      nativeMaterialRevision += 1;
      nativeMaterialState = glassRenderingApi.normalizeNativeMaterialState(next);
      applyAppearance(state.settings || {});
    }));
  }
  const rev = nativeMaterialRevision;
  try {
    const initialMat = await window.tokenMonitor.getNativeMaterialState?.();
    if (rev === nativeMaterialRevision && initialMat) {
      nativeMaterialState = glassRenderingApi.normalizeNativeMaterialState(initialMat);
    }
  } catch (_) {}

  let settings = {};
  try { settings = await window.tokenMonitor.getSettings(); } catch (_) {}
  state.settings = settings;
  state.locale = i18n.resolveLocale(settings.locale || settings.language, navigator.languages);
  state.flat = settings.dashboardFlat === true;

  registerCleanup(window.tokenMonitor.onSettingsPush?.((next) => {
    if (!next) return;
    state.settings = { ...(state.settings || {}), ...next };
    if ('dashboardFlat' in next) state.flat = next.dashboardFlat === true;
    const nextLocale = i18n.resolveLocale(state.settings.locale || state.settings.language, navigator.languages);
    if (state.locale !== nextLocale) {
      state.locale = nextLocale;
      applyTranslations();
      renderAll();
    }
    applyAppearance(state.settings);
  }));

  const onReducedMotionChange = () => applyAppearance(state.settings);
  reducedMotionMedia?.addEventListener?.('change', onReducedMotionChange);
  registerCleanup(() => reducedMotionMedia?.removeEventListener?.('change', onReducedMotionChange));

  window.addEventListener('beforeunload', () => {
    if (state.toastTimer) {
      clearTimeout(state.toastTimer);
      state.toastTimer = null;
    }
    if (state.oauthBusy) void agmApi()?.cancelOAuthLogin?.();
    for (const fn of cleanupFns.splice(0)) {
      try { fn(); } catch (_) {}
    }
  }, { once: true });

  applyAppearance(settings);
  applyTranslations();
  wireEvents();
  await loadState();
  agmApi().windowReady();
}

void boot();
