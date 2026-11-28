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
  sort: 'default',
  selectedIds: new Set(),
  expandedModels: new Set(),
  collapsedModels: new Set(),
  allModelsExpanded: false,
  openMoreId: '',
  confirmDeleteId: '',
  batchDeleteConfirm: false,
  toastTimer: null,
  searchTimer: null,
  liveTimer: 0,
  rafStateId: 0,
  pendingPushedState: null,
  stateRevision: 0,
  oauthBusy: false,
  importBusy: false,
  switchBestBusy: false,
  switchingId: '',
  refreshingIds: new Set(),
  refreshClickBusy: false,
  lastAutoSwitchSeenAt: null
};

const cardCache = new Map();

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
  autoSwitchWrap: document.getElementById('agmAutoSwitchWrap'),
  autoSwitchMenuBtn: document.getElementById('agmAutoSwitchMenuBtn'),
  autoSwitchBtnLabel: document.getElementById('agmAutoSwitchBtnLabel'),
  autoSwitchPopover: document.getElementById('agmAutoSwitchPopover'),
  autoSwitchEnabledInput: document.getElementById('agmAutoSwitchEnabledInput'),
  selectionModeSelect: document.getElementById('agmSelectionModeSelect'),
  autoSwitchScopeSelect: document.getElementById('agmAutoSwitchScopeSelect'),
  autoSwitchThresholdInput: document.getElementById('agmAutoSwitchThresholdInput'),
  autoSwitchCooldownInput: document.getElementById('agmAutoSwitchCooldownInput'),
  autoResumeEnabledInput: document.getElementById('agmAutoResumeEnabledInput'),
  autoResumePromptInput: document.getElementById('agmAutoResumePromptInput'),
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
  chipCounts: Array.from(document.querySelectorAll('[data-count-for]')),
  sortSelect: document.getElementById('agmSortSelect'),
  toggleModelsBtn: document.getElementById('agmToggleModelsBtn'),
  toggleModelsLabel: document.getElementById('agmToggleModelsLabel'),
  selectAllInput: document.getElementById('agmSelectAllInput'),
  selectedCount: document.getElementById('agmSelectedCount'),
  clearSelectionBtn: document.getElementById('agmClearSelectionBtn'),
  batchDeleteBtn: document.getElementById('agmBatchDeleteBtn'),
  progressBar: document.getElementById('agmProgressBar'),
  toast: document.getElementById('agmToast'),
  accountList: document.getElementById('agmAccountList'),
  autoSwitchHistory: document.getElementById('agmAutoSwitchHistory'),
  importDialog: document.getElementById('agmImportDialog'),
  closeImportDialog: document.getElementById('agmCloseImportDialog'),
  importStatus: document.getElementById('agmImportStatus'),
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

const importButtons = [
  els.pickJsonFileBtn,
  els.submitPasteBtn,
  els.importDefaultDirBtn,
  els.pickDataDirBtn,
  els.scanLocalBtn,
  els.pickStateDbBtn,
  els.pickV1DirBtn
].filter(Boolean);

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

function hideToast() {
  if (state.toastTimer) {
    clearTimeout(state.toastTimer);
    state.toastTimer = null;
  }
  if (!els.toast) return;
  if (typeof els.toast.hidePopover === 'function') {
    try {
      if (els.toast.matches(':popover-open')) els.toast.hidePopover();
    } catch (_) {}
  } else {
    els.toast.classList.add('hidden');
  }
}

function showToast(text, isError = false) {
  if (!els.toast) return;
  if (state.toastTimer) {
    clearTimeout(state.toastTimer);
    state.toastTimer = null;
  }
  const msg = String(text || '');
  if (!msg) {
    hideToast();
    return;
  }
  els.toast.textContent = msg;
  els.toast.classList.toggle('is-error', Boolean(isError));
  els.toast.setAttribute('role', isError ? 'alert' : 'status');
  if (typeof els.toast.showPopover === 'function') {
    try {
      if (els.toast.matches(':popover-open')) els.toast.hidePopover();
      els.toast.showPopover();
    } catch (_) {
      els.toast.classList.remove('hidden');
    }
  } else {
    els.toast.classList.remove('hidden');
  }
  state.toastTimer = setTimeout(() => {
    state.toastTimer = null;
    hideToast();
  }, isError ? 8000 : 4000);
}

function hideProgressBar() {
  if (!els.progressBar) return;
  els.progressBar.classList.add('hidden');
  els.progressBar.textContent = '';
}

function showProgress(text, current, total) {
  if (!els.progressBar) return;
  const totalNum = Number(total);
  const curNum = Number(current);
  const pct = Number.isFinite(totalNum) && totalNum > 0 && Number.isFinite(curNum)
    ? Math.max(0, Math.min(100, Math.round((curNum / totalNum) * 100)))
    : 0;
  const label = document.createElement('span');
  label.className = 'agm-progress-text';
  label.textContent = String(text || '');
  const track = document.createElement('span');
  track.className = 'agm-progress-track';
  const fill = document.createElement('span');
  fill.className = 'agm-progress-fill';
  fill.style.width = `${pct}%`;
  track.appendChild(fill);
  els.progressBar.classList.remove('hidden');
  els.progressBar.replaceChildren(label, track);
  if (state.importBusy && els.importDialog?.open) {
    setImportStatus(text);
  }
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
  const filtered = accounts.filter((acc) => {
    if (q) {
      const email = String(acc.email || '').toLowerCase();
      const name = String(acc.name || '').toLowerCase();
      if (!email.includes(q) && !name.includes(q)) return false;
    }
    if (state.filter === 'abnormal') return isAbnormalAccount(acc);
    if (state.filter !== 'all') return acc.subscriptionTier === state.filter;
    return true;
  });
  return sortAccounts(filtered);
}

function accountQuotaScore(acc) {
  if (acc?.hasToken === false || isAbnormalAccount(acc)) return -2;
  const groups = Array.isArray(acc?.quota?.groups) ? acc.quota.groups : [];
  let bestGroupScore = -1;
  for (const g of groups) {
    const buckets = Array.isArray(g?.buckets) ? g.buckets : [];
    let groupMin = Infinity;
    let hasBucket = false;
    for (const b of buckets) {
      if (b?.disabled !== true && typeof b?.remainingFraction === 'number' && Number.isFinite(b.remainingFraction)) {
        hasBucket = true;
        if (b.remainingFraction < groupMin) groupMin = b.remainingFraction;
      }
    }
    if (hasBucket) {
      const clamped = Math.max(0, Math.min(1, groupMin));
      if (clamped > bestGroupScore) bestGroupScore = clamped;
    }
  }
  if (bestGroupScore >= 0) return bestGroupScore;

  const models = Array.isArray(acc?.quota?.models) ? acc.quota.models : [];
  let bestModelScore = -1;
  for (const m of models) {
    if (typeof m?.percentage === 'number' && Number.isFinite(m.percentage)) {
      const frac = Math.max(0, Math.min(1, m.percentage / 100));
      if (frac > bestModelScore) bestModelScore = frac;
    }
  }
  return bestModelScore;
}

function accountUpdatedMs(acc) {
  const raw = Number(acc?.quota?.lastUpdatedAt || acc?.lastUsedAt || 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return raw < 1e12 ? raw * 1000 : raw;
}

function sortAccounts(list) {
  const mode = state.sort || 'default';
  if (mode === 'default' || list.length <= 1) return list;
  const tierRank = (tier) => (tier === 'ULTRA' ? 3 : (tier === 'PRO' ? 2 : (tier === 'FREE' ? 1 : 0)));
  const compareEmail = (a, b) => String(a?.email || a?.id || '').localeCompare(String(b?.email || b?.id || ''));
  return [...list].sort((a, b) => {
    if (mode === 'quota') {
      const diff = accountQuotaScore(b) - accountQuotaScore(a);
      if (diff !== 0) return diff;
      return compareEmail(a, b);
    }
    if (mode === 'tier') {
      const diff = tierRank(b?.subscriptionTier) - tierRank(a?.subscriptionTier);
      if (diff !== 0) return diff;
      return compareEmail(a, b);
    }
    if (mode === 'email') {
      return compareEmail(a, b);
    }
    if (mode === 'updated') {
      const diff = accountUpdatedMs(b) - accountUpdatedMs(a);
      if (diff !== 0) return diff;
      return compareEmail(a, b);
    }
    return 0;
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

function iconRefresh(extraClass = '') {
  return makeSvgIcon([
    ['path', { d: 'M21 12a9 9 0 1 1-2.64-6.36' }],
    ['polyline', { points: '21 3 21 9 15 9' }]
  ], 12, extraClass);
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

function iconOtherQuota() {
  return makeSvgIcon([
    ['circle', { cx: 12, cy: 12, r: 4.5 }]
  ], 10, 'agm-quota-family-icon is-other', true);
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

function formatRelativeAge(rawTs) {
  const num = Number(rawTs || 0);
  if (!Number.isFinite(num) || num <= 0) return '';
  const ms = num < 1e12 ? num * 1000 : num;
  if (!Number.isFinite(ms)) return '';
  const diffSec = Math.round((ms - Date.now()) / 1000);
  const absSec = Math.abs(diffSec);
  const locale = state.locale || 'en';
  try {
    if (!formatRelativeAge.cache) formatRelativeAge.cache = new Map();
    let rtf = formatRelativeAge.cache.get(locale);
    if (!rtf) {
      rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'narrow' });
      formatRelativeAge.cache.set(locale, rtf);
    }
    if (absSec < 60) return rtf.format(0, 'second');
    if (absSec < 3600) return rtf.format(Math.trunc(diffSec / 60), 'minute');
    if (absSec < 86400) return rtf.format(Math.trunc(diffSec / 3600), 'hour');
    return rtf.format(Math.trunc(diffSec / 86400), 'day');
  } catch (_) {
    return formatCompactTimestamp(rawTs);
  }
}

function inferCapabilityPills(acc) {
  const models = Array.isArray(acc?.quota?.models) ? acc.quota.models : [];
  const groups = Array.isArray(acc?.quota?.groups) ? acc.quota.groups : [];
  if (models.length === 0 && groups.length === 0) return [];
  const pills = [];
  const g4Priority = ['neon', 'carbon', 'hydrogen', 'argon'];

  const texts = [];
  for (const m of models) {
    if (m?.name) texts.push(String(m.name).trim().toLowerCase());
    if (m?.displayName) texts.push(String(m.displayName).trim().toLowerCase());
  }
  for (const g of groups) {
    if (g?.displayName) texts.push(String(g.displayName).trim().toLowerCase());
    if (g?.description) texts.push(String(g.description).trim().toLowerCase());
  }

  const g4Codes = [];
  const addG4Code = (candidate) => {
    const clean = String(candidate || '').trim().toLowerCase();
    if (clean && !GENERIC_CAPABILITY_WORDS.has(clean) && !g4Codes.includes(clean)) {
      g4Codes.push(clean);
    }
  };

  let bestClaude = null;
  let sawClaude = false;
  let gptLabel = '';

  for (const text of texts) {
    if (!text) continue;

    if (text.includes('orchestrator-g1-pro') || (text.includes('argon') && (text.includes('gemini') || text.includes('orchestrator')))) {
      addG4Code('argon');
    }
    for (const match of text.matchAll(/gemini-(\d+)(?:\.\d+)?-([a-z]+)/g)) {
      if (Number.parseInt(match[1], 10) >= 4) addG4Code(match[2]);
    }
    for (const match of text.matchAll(/gemini\s+(\d+)(?:\.\d+)?\s+([a-z]+)/g)) {
      if (Number.parseInt(match[1], 10) >= 4) addG4Code(match[2]);
    }
    for (const match of text.matchAll(/gemini-pro-orchestrator-([a-z]+)/g)) {
      addG4Code(match[1] === 'g1' ? 'argon' : match[1]);
    }
    for (const match of text.matchAll(/orchestrator\s*\(([a-z]+)\)/g)) {
      addG4Code(match[1]);
    }

    if (/\bclaude\b|claude-/.test(text)) {
      sawClaude = true;
      for (const verMatch of text.matchAll(/claude(?:[-_\s]+(?:sonnet|opus|haiku))?[-_\s]*(\d+)(?:[.-](\d+))?/g)) {
        const major = Number.parseInt(verMatch[1], 10);
        const minor = verMatch[2] ? Number.parseInt(verMatch[2], 10) : 0;
        const score = major * 1000 + minor;
        const label = verMatch[2] ? `Claude ${major}.${minor}` : `Claude ${major}`;
        if (!bestClaude || score > bestClaude.score) {
          bestClaude = { score, label };
        }
      }
    }

    if (/\bgpt\b|gpt-/.test(text)) {
      const sizeMatch = text.match(/(\d+[abkm])\b/i);
      const nextGpt = sizeMatch ? `GPT-${sizeMatch[1].toUpperCase()}` : 'GPT';
      if (!gptLabel || (gptLabel === 'GPT' && nextGpt !== 'GPT')) {
        gptLabel = nextGpt;
      }
    }
  }

  const bestG4 = g4Priority.find((code) => g4Codes.includes(code)) || g4Codes[0] || '';
  if (bestG4) pills.push({ label: bestG4.charAt(0).toUpperCase() + bestG4.slice(1), tone: 'violet' });
  if (bestClaude?.label) pills.push({ label: bestClaude.label, tone: 'amber' });
  else if (sawClaude) pills.push({ label: 'Claude', tone: 'amber' });
  if (gptLabel) pills.push({ label: gptLabel, tone: 'ok' });
  return pills.slice(0, 3);
}

function renderSummaryAndControls() {
  const mgr = state.manager;
  if (!mgr) return;
  const accounts = mgr.accounts || [];
  const cfg = mgr.config || {};
  const active = mgr.activeAccounts || {};

  const counts = { total: accounts.length, ULTRA: 0, PRO: 0, FREE: 0, abnormal: 0, available: 0, lowQuota: 0 };
  let hasSwitchable = false;
  for (const a of accounts) {
    if (a.subscriptionTier === 'ULTRA') counts.ULTRA += 1;
    else if (a.subscriptionTier === 'PRO') counts.PRO += 1;
    else if (a.subscriptionTier === 'FREE') counts.FREE += 1;
    const abnormal = isAbnormalAccount(a);
    if (abnormal) counts.abnormal += 1;
    if (a.hasToken !== false && !abnormal) {
      counts.available += 1;
      const score = accountQuotaScore(a);
      if (score >= 0 && score <= 0.15) counts.lowQuota += 1;
    }
    if (a.hasToken && !a.disabled && !a.banned && !a.validationBlocked) hasSwitchable = true;
  }

  els.statsPills.replaceChildren(
    makePill(`${t('agManager.statTotal')}: ${counts.total}`),
    makePill(`${t('agManager.statAvailable')}: ${counts.available}`, 'ok'),
    ...(counts.lowQuota > 0 ? [makePill(`${t('agManager.statLowQuota')}: ${counts.lowQuota}`, 'danger')] : [])
  );

  const chipCountMap = {
    all: counts.total,
    ULTRA: counts.ULTRA,
    PRO: counts.PRO,
    FREE: counts.FREE,
    abnormal: counts.abnormal
  };
  for (const node of els.chipCounts || []) {
    const key = node.dataset.countFor;
    const val = chipCountMap[key];
    node.textContent = counts.total > 0 && typeof val === 'number' ? String(val) : '';
  }
  for (const chip of els.filterChips) {
    if (chip.dataset.filter === 'abnormal') {
      chip.classList.toggle('has-alert', counts.abnormal > 0);
    }
  }

  const metaNodes = [];
  const makeMetaItem = (text, tone = '') => {
    const span = document.createElement('span');
    span.className = `agm-meta-item${tone ? ` is-${tone}` : ''}`;
    span.textContent = text;
    return span;
  };
  if (cfg.autoRefresh) {
    metaNodes.push(makeMetaItem(t('agManager.autoRefreshOn', { minutes: cfg.refreshIntervalMinutes || 10 }), 'on'));
  } else {
    metaNodes.push(makeMetaItem(t('agManager.autoRefreshOff')));
  }
  const autoSwitchOn = cfg.autoSwitchEnabled === true;
  const selectionMode = cfg.selectionMode === 'weighted' ? 'weighted' : 'auto';
  if (autoSwitchOn) {
    metaNodes.push(makeMetaItem(selectionMode === 'weighted' ? t('agManager.autoSwitchMetaWeighted') : t('agManager.autoSwitchMetaAuto'), 'on'));
  }
  if (mgr.lastAutoSwitch?.ok && mgr.lastAutoSwitch?.toEmail) {
    metaNodes.push(makeMetaItem(t('agManager.lastAutoSwitchMeta', { email: mgr.lastAutoSwitch.toEmail })));
  } else if (mgr.lastAutoSwitch && mgr.lastAutoSwitch.ok === false && mgr.lastAutoSwitch.error) {
    metaNodes.push(makeMetaItem(t('agManager.autoSwitchHistoryFailed', { error: mgr.lastAutoSwitch.error }), 'warn'));
  }
  if (mgr.lastRefreshAt > 0) {
    let timeStr;
    try {
      timeStr = new Date(mgr.lastRefreshAt * 1000).toLocaleTimeString(state.locale || undefined);
    } catch (_) {
      timeStr = new Date(mgr.lastRefreshAt * 1000).toLocaleTimeString();
    }
    metaNodes.push(makeMetaItem(`${t('agManager.lastRefresh')}: ${timeStr}`));
  }
  for (const [slot, id] of Object.entries(active)) {
    if (!id) continue;
    const found = accounts.find((a) => a.id === id);
    if (found) metaNodes.push(makeMetaItem(`${formatSlotLabel(slot)}: ${found.email}`));
  }
  els.runtimeMeta.replaceChildren(...metaNodes);

  renderAutoSwitchHistory(mgr.autoSwitchHistory);

  const latestAuto = mgr.lastAutoSwitch || null;
  const latestAutoAt = Number(latestAuto?.at || 0);
  if (state.lastAutoSwitchSeenAt === null) {
    state.lastAutoSwitchSeenAt = latestAutoAt;
  } else if (latestAutoAt > state.lastAutoSwitchSeenAt) {
    state.lastAutoSwitchSeenAt = latestAutoAt;
    if (latestAuto?.ok) {
      const resumedCount = Number(latestAuto.resumedCount || 0);
      showToast(resumedCount > 0
        ? t('agManager.toast.autoSwitchOkResumed', {
            trigger: latestAuto.triggerLabel || 'Quota',
            email: latestAuto.toEmail || '',
            target: latestAuto.target || 'auto',
            count: resumedCount
          })
        : t('agManager.toast.autoSwitchOk', {
            trigger: latestAuto.triggerLabel || 'Quota',
            email: latestAuto.toEmail || '',
            target: latestAuto.target || 'auto'
          }));
    } else if (latestAuto?.error) {
      showToast(t('agManager.toast.autoSwitchFailed', { error: latestAuto.error }), true);
    }
  }

  els.targetClient.value = cfg.defaultSwitchTarget || 'auto';
  els.autoSwitchMenuBtn.classList.toggle('is-enabled', autoSwitchOn);
  els.autoSwitchBtnLabel.textContent = autoSwitchOn ? t('agManager.autoSwitchBtnOn') : t('agManager.autoSwitchBtn');
  els.autoSwitchEnabledInput.checked = autoSwitchOn;
  els.selectionModeSelect.value = selectionMode;
  els.autoSwitchScopeSelect.value = cfg.autoSwitchScope || 'primary';
  if (document.activeElement !== els.autoSwitchThresholdInput) {
    els.autoSwitchThresholdInput.value = String(cfg.autoSwitchThresholdPercent ?? 0);
  }
  if (document.activeElement !== els.autoSwitchCooldownInput) {
    els.autoSwitchCooldownInput.value = String(cfg.autoSwitchCooldownSeconds || 180);
  }
  if (els.autoResumeEnabledInput) {
    els.autoResumeEnabledInput.checked = cfg.autoResumeEnabled !== false;
  }
  if (els.autoResumePromptInput && document.activeElement !== els.autoResumePromptInput) {
    els.autoResumePromptInput.value = String(cfg.autoResumePrompt || '继续');
  }
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
  const switchingBest = state.switchBestBusy || mgr.isAutoSwitching === true || (mgr.isSwitching === true && !state.switchingId);
  els.switchBestBtn.disabled = Boolean(state.switchBestBusy || state.switchingId || mgr.isSwitching || mgr.isAutoSwitching || !hasSwitchable);
  els.switchBestBtn.textContent = switchingBest ? t('agManager.switching') : t('agManager.switchBest');
  els.exportBtn.disabled = accounts.length === 0;
  els.exportBtn.textContent = selectedCount > 0
    ? t('agManager.exportSelected', { count: selectedCount })
    : t('agManager.exportJson');

  if (els.selectedCount) {
    els.selectedCount.textContent = selectedCount > 0 ? t('agManager.selectedCount', { count: selectedCount }) : '';
    els.selectedCount.classList.toggle('hidden', selectedCount === 0);
  }
  els.clearSelectionBtn?.classList.toggle('hidden', selectedCount === 0);

  if (selectedCount === 0) state.batchDeleteConfirm = false;
  els.batchDeleteBtn.classList.toggle('hidden', selectedCount === 0);
  els.batchDeleteBtn.classList.toggle('is-confirm', state.batchDeleteConfirm && selectedCount > 0);
  els.batchDeleteBtn.textContent = state.batchDeleteConfirm && selectedCount > 0
    ? t('agManager.confirmDeleteSelected', { count: selectedCount })
    : t('agManager.deleteSelectedCount', { count: selectedCount });
}

function renderAutoSwitchHistory(historyList) {
  if (!els.autoSwitchHistory) return;
  const entries = Array.isArray(historyList) ? historyList.slice(0, 5) : [];
  if (entries.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'agm-history-empty';
    empty.textContent = t('agManager.autoSwitchHistoryEmpty');
    els.autoSwitchHistory.replaceChildren(empty);
    return;
  }
  const nodes = entries.map((item) => {
    const li = document.createElement('li');
    li.className = `agm-history-item ${item?.ok ? 'is-ok' : 'is-failed'}`;

    const main = document.createElement('div');
    main.className = 'agm-history-main';
    main.textContent = `${item?.fromEmail || '—'} → ${item?.toEmail || '—'}`;
    li.appendChild(main);

    const sub = document.createElement('div');
    sub.className = 'agm-history-sub';
    if (item?.at) {
      const ageSpan = document.createElement('span');
      ageSpan.dataset.ageTs = String(item.at);
      ageSpan.textContent = formatRelativeAge(item.at) || formatCompactTimestamp(item.at);
      sub.appendChild(ageSpan);
    }
    const tailParts = [];
    if (item?.triggerLabel) tailParts.push(item.triggerLabel);
    if (item?.target) tailParts.push(item.target);
    const errMsg = item?.error || item?.resumeError || '';
    if (!item?.ok && errMsg) {
      tailParts.push(t('agManager.autoSwitchHistoryFailed', { error: errMsg }));
    }
    if (tailParts.length > 0) {
      if (sub.childNodes.length > 0) sub.appendChild(document.createTextNode(' '));
      const detail = document.createElement('span');
      detail.textContent = tailParts.join(' ');
      sub.appendChild(detail);
    }
    if (sub.childNodes.length > 0) li.appendChild(sub);
    return li;
  });
  els.autoSwitchHistory.replaceChildren(...nodes);
}

function is5hBucket(b) {
  const win = String(b?.window || '').trim().toLowerCase();
  if (win === 'session') return true;
  const text = `${win} ${b?.bucketId || ''} ${b?.displayName || ''}`.toLowerCase();
  return text.includes('5h') || text.includes('5-hour') || text.includes('five-hour') || text.includes('five hour') || text.includes('hour');
}

function isWeeklyBucket(b) {
  const text = `${b?.window || ''} ${b?.bucketId || ''} ${b?.displayName || ''}`.toLowerCase();
  return text.includes('week') || text.includes('7d');
}

function isClaudeOr3pGroup(g) {
  const text = `${g?.displayName || ''} ${(g?.buckets || []).map((b) => `${b.bucketId || ''} ${b.displayName || ''}`).join(' ')}`.toLowerCase();
  return text.includes('claude') || text.includes('gpt') || text.includes('3p');
}

function isDedicatedCodenameGroup(g) {
  const text = `${g?.displayName || ''} ${(g?.buckets || []).map((b) => `${b.bucketId || ''} ${b.displayName || ''}`).join(' ')}`.toLowerCase();
  return /\b(argon|neon|hydrogen|carbon|helium|wtu)\b/.test(text);
}

function normalizeQuotaGroupTitle(group) {
  const raw = String(group?.displayName || '').trim().replace(/\s+/g, ' ');
  const lower = raw.toLowerCase();
  if (/^gemini(?:\s+models)?$/.test(lower)) return 'Gemini';
  if (/^claude\s*(?:and|&|\/)\s*gpt(?:\s+models)?$/.test(lower)) return 'Claude / GPT';
  if (/^gemini\s+4\s+argon$/.test(lower)) return 'Gemini 4 Argon';
  return raw || 'Quota';
}

function extractQuotaGroupModelsHint(group) {
  const desc = String(group?.description || '').trim();
  const match = desc.match(/models within this group:\s*(.+)$/i);
  if (!match) return '';
  const seen = new Set();
  const labels = [];
  for (const part of match[1].split(',')) {
    const clean = part.trim().replace(/[.。]+$/, '');
    if (!clean) continue;
    let label = clean;
    const orchMatch = clean.match(/^orchestrator\s*\(([^)]+)\)$/i);
    if (orchMatch) {
      label = orchMatch[1].trim();
    } else if (/^gemini\s+4(?:\.\d+)?\s+/i.test(clean)) {
      label = clean.replace(/^gemini\s+4(?:\.\d+)?\s+/i, '').trim();
    } else if (/^gemini\s+/i.test(clean)) {
      label = clean.replace(/^gemini\s+/i, '').trim();
    } else if (/^claude\s+(?:opus|sonnet|haiku)\s+(.+)$/i.test(clean)) {
      label = `Claude ${clean.replace(/^claude\s+(?:opus|sonnet|haiku)\s+/i, '').trim()}`;
    } else if (/^gpt-oss\s+/i.test(clean)) {
      label = clean.replace(/^gpt-oss\s+/i, 'GPT-').trim();
    }
    const dedupeKey = label.toLowerCase();
    if (label && !seen.has(dedupeKey)) {
      seen.add(dedupeKey);
      labels.push(label);
    }
  }
  return labels.join(' · ');
}

function pctToneClass(pct) {
  if (pct <= 15) return 'is-low';
  if (pct <= 50) return 'is-warn';
  return '';
}

function renderQuotaGridCell({
  icon = null,
  periodLabel = '',
  title = '',
  resetText = '—',
  resetIso = '',
  resetTone = '',
  pct = 0,
  disabled = false,
  superseded = false,
  stateTag = '',
  isFull = false,
  ariaLabel = '',
  ariaBase = ''
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(Number(pct || 0))));
  const toneCls = disabled ? 'is-disabled' : pctToneClass(clamped);

  const cell = document.createElement('div');
  cell.className = `agm-quota-cell${isFull ? ' is-full' : ''}${disabled ? ' is-disabled' : ''}${superseded ? ' is-superseded' : ''}`;
  if (resetIso) cell.dataset.resetIso = resetIso;
  if (ariaBase) {
    cell.dataset.ariaBase = ariaBase;
    cell.setAttribute('aria-label', `${ariaBase} (${resetText})`);
  } else if (ariaLabel) {
    cell.setAttribute('aria-label', ariaLabel);
  }

  const top = document.createElement('div');
  top.className = 'agm-quota-cell-top';

  const label = document.createElement('div');
  label.className = 'agm-quota-cell-label';
  if (icon) label.appendChild(icon);
  const labelText = periodLabel || title;
  if (labelText) {
    const titleEl = document.createElement('span');
    titleEl.className = 'agm-quota-cell-title';
    titleEl.textContent = labelText;
    label.appendChild(titleEl);
  }

  const pctEl = document.createElement('span');
  pctEl.className = `agm-quota-pct${toneCls ? ` ${toneCls}` : ''}`;
  pctEl.textContent = disabled ? t('agManager.bucketDisabled') : `${clamped}%`;

  top.append(label, pctEl);
  cell.appendChild(top);

  if (!disabled) {
    const meter = document.createElement('div');
    meter.className = 'agm-meter';
    const fill = document.createElement('div');
    fill.className = `agm-meter-fill${toneCls ? ` ${toneCls}` : ''}`;
    fill.style.width = `${clamped}%`;
    meter.appendChild(fill);
    cell.appendChild(meter);
  }

  const foot = document.createElement('div');
  foot.className = 'agm-quota-cell-foot';

  const effectiveResetTone = disabled || clamped >= 100 || resetText === '—'
    ? 'muted'
    : (clamped <= 15 ? 'low' : resetTone);
  const reset = document.createElement('span');
  reset.className = `agm-quota-reset${effectiveResetTone ? ` is-${effectiveResetTone}` : ''}`;
  reset.appendChild(iconClock());
  const resetVal = document.createElement('span');
  resetVal.className = 'agm-quota-reset-value';
  resetVal.textContent = resetText;
  reset.appendChild(resetVal);
  foot.appendChild(reset);

  if (stateTag) {
    const tagEl = document.createElement('span');
    tagEl.className = 'agm-quota-state-tag';
    tagEl.textContent = stateTag;
    foot.appendChild(tagEl);
  }

  cell.appendChild(foot);
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
      || null;
    const argonGroup = nonClaude.find((g) => g !== geminiGroup && `${g.displayName || ''} ${(g.buckets || []).map((b) => b.bucketId || '').join(' ')}`.toLowerCase().includes('argon'))
      || null;
    const extraGroups = groups.filter((g) => g !== geminiGroup && g !== claudeGroup && g !== argonGroup);
    const orderedGroups = [geminiGroup, claudeGroup, argonGroup, ...extraGroups].filter(Boolean);

    const splitBuckets = (group) => {
      const buckets = Array.isArray(group?.buckets) ? group.buckets : [];
      const b5h = buckets.find((b) => is5hBucket(b)) || null;
      const bWeekly = buckets.find((b) => b !== b5h && isWeeklyBucket(b)) || null;
      const others = buckets.filter((b) => b !== b5h && b !== bWeekly);
      return { b5h, bWeekly, others };
    };

    const toPct = (b) => {
      if (b?.disabled === true || typeof b?.remainingFraction !== 'number' || !Number.isFinite(b.remainingFraction)) {
        return null;
      }
      return Math.max(0, Math.min(100, Math.round(b.remainingFraction * 100)));
    };

    const groupNodes = [];
    for (const group of orderedGroups) {
      const { b5h, bWeekly, others } = splitBuckets(group);
      const bucketEntries = [];
      if (b5h) bucketEntries.push({ bucket: b5h, periodKind: '5h', periodLabel: t('agManager.window.5h') });
      if (bWeekly) bucketEntries.push({ bucket: bWeekly, periodKind: 'weekly', periodLabel: t('agManager.window.weekly') });
      for (const b of others) {
        bucketEntries.push({
          bucket: b,
          periodKind: is5hBucket(b) ? '5h' : (isWeeklyBucket(b) ? 'weekly' : ''),
          periodLabel: String(b.displayName || b.window || b.bucketId || 'Quota')
        });
      }
      if (bucketEntries.length === 0) continue;

      const groupTitle = normalizeQuotaGroupTitle(group);
      const modelsHint = extractQuotaGroupModelsHint(group);
      const isClaude = group === claudeGroup || isClaudeOr3pGroup(group);
      const isGemini = !isClaude && (group === geminiGroup || isDedicatedCodenameGroup(group) || groupTitle.toLowerCase().includes('gemini'));
      const b5hPct = b5h ? toPct(b5h) : null;
      const fiveHourExhausted = Boolean(b5h && b5h.disabled !== true && b5hPct === 0);

      const groupEl = document.createElement('section');
      groupEl.className = 'agm-quota-group';

      const headEl = document.createElement('div');
      headEl.className = 'agm-quota-group-head';

      const titleWrap = document.createElement('div');
      titleWrap.className = 'agm-quota-group-title-wrap';
      titleWrap.appendChild(isClaude ? iconClaude() : (isGemini ? iconGemini() : iconOtherQuota()));
      const nameEl = document.createElement('span');
      nameEl.className = 'agm-quota-group-name';
      nameEl.textContent = groupTitle;
      titleWrap.appendChild(nameEl);
      headEl.appendChild(titleWrap);

      if (modelsHint) {
        const hintEl = document.createElement('span');
        hintEl.className = 'agm-quota-group-models';
        hintEl.textContent = modelsHint;
        headEl.appendChild(hintEl);
      }

      groupEl.appendChild(headEl);

      const gridEl = document.createElement('div');
      gridEl.className = 'agm-quota-group-grid';

      bucketEntries.forEach(({ bucket, periodKind, periodLabel }, idx) => {
        const pct = toPct(bucket);
        const disabled = bucket.disabled === true || pct === null;
        const resetText = bucket.resetTime ? formatResetCountdown(bucket.resetTime) : '—';
        const superseded = !disabled && periodKind === 'weekly' && fiveHourExhausted && pct > 0;
        const stateTag = superseded ? t('agManager.weeklyPausedBy5h') : '';
        const isLastOdd = bucketEntries.length % 2 === 1 && idx === bucketEntries.length - 1;
        gridEl.appendChild(renderQuotaGridCell({
          periodLabel,
          resetText,
          resetIso: bucket.resetTime || '',
          resetTone: periodKind,
          pct: pct ?? 0,
          disabled,
          superseded,
          stateTag,
          isFull: bucketEntries.length === 1 || isLastOdd,
          ariaBase: `${groupTitle} ${periodLabel}: ${disabled ? t('agManager.bucketDisabled') : `${pct}%`}`
        }));
      });

      groupEl.appendChild(gridEl);
      groupNodes.push(groupEl);
    }

    if (groupNodes.length > 0) {
      const container = document.createElement('div');
      container.className = 'agm-quota-groups';
      container.append(...groupNodes);
      return container;
    }
  }

  if (models.length > 0) {
    const grid = document.createElement('div');
    grid.className = 'agm-quota-grid';
    const slice = models.slice(0, 4);
    slice.forEach((m, idx) => {
      const name = String(m.displayName || m.name || 'Model');
      const resetText = m.resetTime ? formatResetCountdown(m.resetTime) : '—';
      const pct = Math.max(0, Math.min(100, Math.round(Number(m.percentage || 0))));
      const useClaudeIcon = String(m.name || '').toLowerCase().startsWith('claude')
        || String(m.name || '').toLowerCase().startsWith('gpt');
      const isLastOdd = slice.length % 2 === 1 && idx === slice.length - 1;
      grid.appendChild(renderQuotaGridCell({
        icon: useClaudeIcon ? iconClaude() : iconGemini(),
        periodLabel: name,
        resetText,
        resetIso: m.resetTime || '',
        resetTone: 'weekly',
        pct,
        isFull: slice.length === 1 || isLastOdd,
        ariaBase: `${name}: ${pct}%`
      }));
    });
    return grid;
  }

  if (hasStatusMessage) return null;

  const empty = document.createElement('div');
  empty.className = 'agm-card-hint';
  empty.textContent = acc?.hasToken === false ? t('agManager.noToken') : t('agManager.noQuotaData');
  return empty;
}

function effectiveSwitchingId() {
  return state.switchingId || state.manager?.switchingAccountId || '';
}

function isAnySwitchInFlight() {
  return Boolean(state.switchBestBusy || state.switchingId || state.manager?.isSwitching || state.manager?.isAutoSwitching);
}

function accountHasModels(acc) {
  return Array.isArray(acc?.quota?.models) && acc.quota.models.length > 0;
}

function isAccountModelsExpanded(accountId) {
  if (state.allModelsExpanded) {
    return !state.collapsedModels?.has(accountId);
  }
  return Boolean(state.expandedModels?.has(accountId));
}

function setAccountModelsExpanded(accountId, expanded) {
  if (state.allModelsExpanded) {
    if (!state.collapsedModels) state.collapsedModels = new Set();
    if (expanded) state.collapsedModels.delete(accountId);
    else state.collapsedModels.add(accountId);
    const allExpandable = (state.manager?.accounts || []).filter(accountHasModels);
    if (allExpandable.length > 0 && allExpandable.every((a) => state.collapsedModels.has(a.id))) {
      state.allModelsExpanded = false;
      state.collapsedModels.clear();
      state.expandedModels?.clear();
    }
    return;
  }
  if (!state.expandedModels) state.expandedModels = new Set();
  if (expanded) state.expandedModels.add(accountId);
  else state.expandedModels.delete(accountId);
}

function toggleAllVisibleModels() {
  const visible = filteredAccounts();
  const expandable = visible.filter(accountHasModels);
  if (expandable.length === 0) return;
  const nextExpand = !expandable.every((acc) => isAccountModelsExpanded(acc.id));
  state.allModelsExpanded = nextExpand;
  state.expandedModels?.clear();
  state.collapsedModels?.clear();
  renderAccounts();
}

function syncToggleAllModelsButton(visibleList) {
  if (!els.toggleModelsBtn) return;
  const expandable = visibleList.filter(accountHasModels);
  const hasExpandable = expandable.length > 0;
  const allExpanded = hasExpandable && expandable.every((acc) => isAccountModelsExpanded(acc.id));
  els.toggleModelsBtn.disabled = !hasExpandable;
  els.toggleModelsBtn.classList.toggle('is-active', allExpanded);
  els.toggleModelsBtn.setAttribute('aria-pressed', String(allExpanded));
  if (els.toggleModelsLabel) {
    els.toggleModelsLabel.textContent = allExpanded
      ? t('agManager.collapseAllModels')
      : t('agManager.expandAllModels');
  }
}

function modelSectionDomId(accountId) {
  return `agm-models-${Array.from(String(accountId || ''), (ch) => (/[a-zA-Z0-9_-]/.test(ch) ? ch : `_${ch.codePointAt(0).toString(16)}_`)).join('')}`;
}

function buildCardSignature(acc, activeSlots) {
  const groups = Array.isArray(acc?.quota?.groups) ? acc.quota.groups : [];
  const models = Array.isArray(acc?.quota?.models) ? acc.quota.models : [];
  const groupsKey = groups.map((g) => (
    `${g?.displayName || ''}|${g?.description || ''}:${(Array.isArray(g?.buckets) ? g.buckets : []).map((b) => (
      `${b?.bucketId || ''}|${b?.window || ''}|${b?.disabled ? 1 : 0}|${b?.remainingFraction ?? ''}|${b?.resetTime || ''}|${b?.description || ''}`
    )).join(';')}`
  )).join('/');
  const modelsKey = models.map((m) => (
    `${m?.name || ''}|${m?.displayName || ''}|${m?.percentage ?? ''}|${m?.resetTime || ''}`
  )).join('/');
  const switchingId = effectiveSwitchingId();
  return [
    state.locale,
    acc.id,
    acc.email || '',
    acc.name || '',
    acc.subscriptionTier || '',
    acc.weight ?? 50,
    state.manager?.config?.selectionMode || 'auto',
    acc.disabled ? 1 : 0,
    acc.disabledReason || '',
    acc.banned ? 1 : 0,
    acc.banInfo?.message || '',
    acc.validationBlocked ? 1 : 0,
    acc.validationMessage || '',
    acc.hasToken === false ? 0 : 1,
    acc.hasDeviceProfile ? 1 : 0,
    acc.lastUsedAt || 0,
    acc.quota?.lastUpdatedAt || 0,
    acc.quota?.isForbidden ? 1 : 0,
    acc.quota?.forbiddenReason || '',
    activeSlots.join(','),
    state.selectedIds.has(acc.id) ? 1 : 0,
    models.length > 0 && isAccountModelsExpanded(acc.id) ? 1 : 0,
    state.openMoreId === acc.id ? 1 : 0,
    state.confirmDeleteId === acc.id ? 1 : 0,
    switchingId === acc.id ? 1 : 0,
    isAnySwitchInFlight() ? 1 : 0,
    state.refreshingIds.has(acc.id) ? 1 : 0,
    groupsKey,
    modelsKey
  ].join('\x1f');
}

function syncCachedCardSignature(accountId) {
  const cached = cardCache.get(accountId);
  if (!cached) return;
  const acc = (state.manager?.accounts || []).find((a) => a.id === accountId);
  if (!acc) return;
  const activeSlots = Object.entries(state.manager?.activeAccounts || {})
    .filter(([, id]) => id === acc.id)
    .map(([slot]) => slot);
  cached.sig = buildCardSignature(acc, activeSlots);
}

async function deleteSingleAccount(acc) {
  state.confirmDeleteId = '';
  state.openMoreId = '';
  const revBefore = state.stateRevision;
  try {
    const res = await agmApi().deleteAccounts([acc.id]);
    if (res && res.ok === false) {
      showToast(res.error || t('agManager.toast.actionFailed'), true);
      return;
    }
    state.selectedIds.delete(acc.id);
    state.expandedModels.delete(acc.id);
    state.collapsedModels.delete(acc.id);
    cardCache.delete(acc.id);
    showToast(t('agManager.toast.deletedCount', { count: 1 }));
  } catch (err) {
    showToast(err?.message || t('agManager.toast.actionFailed'), true);
  } finally {
    if (state.stateRevision === revBefore) await loadState();
    else renderAll();
  }
}

function renderAccountCard(acc, activeAccounts) {
  const activeSlots = Object.entries(activeAccounts || {})
    .filter(([, id]) => id === acc.id)
    .map(([slot]) => slot);
  const isMenuOpen = state.openMoreId === acc.id;
  const isSwitchingThis = effectiveSwitchingId() === acc.id;
  const isRefreshingThis = state.refreshingIds.has(acc.id);

  const card = document.createElement('article');
  const isSelected = state.selectedIds.has(acc.id);
  card.className = `agm-card${activeSlots.length > 0 ? ' is-active' : ''}${isSelected ? ' is-selected' : ''}${acc.disabled ? ' is-disabled' : ''}${isMenuOpen ? ' has-menu-open' : ''}${isSwitchingThis ? ' is-switching' : ''}`;
  card.dataset.accountId = acc.id;

  const head = document.createElement('div');
  head.className = 'agm-card-head';

  const identity = document.createElement('div');
  identity.className = 'agm-card-identity';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'agm-card-check';
  checkbox.checked = isSelected;
  checkbox.setAttribute('aria-label', t('agManager.aria.selectAccount', { email: acc.email || acc.id }));
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) state.selectedIds.add(acc.id);
    else state.selectedIds.delete(acc.id);
    card.classList.toggle('is-selected', checkbox.checked);
    state.batchDeleteConfirm = false;
    syncCachedCardSignature(acc.id);
    renderSummaryAndControls();
    const visible = filteredAccounts();
    const allChecked = visible.length > 0 && visible.every((item) => state.selectedIds.has(item.id));
    const someChecked = visible.some((item) => state.selectedIds.has(item.id));
    els.selectAllInput.checked = allChecked;
    els.selectAllInput.indeterminate = !allChecked && someChecked;
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

  const rawWeight = Number(acc.weight);
  const accountWeight = Number.isFinite(rawWeight) ? Math.max(1, Math.min(100, Math.round(rawWeight))) : 50;
  if (state.manager?.config?.selectionMode === 'weighted') {
    const weightControl = document.createElement('label');
    weightControl.className = 'agm-weight-control';
    const weightPrefix = document.createElement('span');
    weightPrefix.className = 'agm-weight-prefix';
    weightPrefix.textContent = t('agManager.weightLabel');
    const weightInput = document.createElement('input');
    weightInput.type = 'number';
    weightInput.className = 'agm-weight-input';
    weightInput.min = '1';
    weightInput.max = '100';
    weightInput.step = '1';
    weightInput.value = String(accountWeight);
    weightInput.setAttribute('aria-label', t('agManager.aria.accountWeight', { email: acc.email || acc.id }));
    weightInput.addEventListener('click', (ev) => ev.stopPropagation());
    weightInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        weightInput.blur();
      }
    });
    weightInput.addEventListener('change', async () => {
      const parsed = Number(weightInput.value);
      const clamped = Number.isFinite(parsed) ? Math.max(1, Math.min(100, Math.round(parsed))) : accountWeight;
      weightInput.value = String(clamped);
      if (clamped === accountWeight) return;
      const revBefore = state.stateRevision;
      try {
        const res = await agmApi().setAccountWeight(acc.id, clamped);
        if (res?.ok) {
          showToast(t('agManager.toast.weightSaved', { email: acc.email || acc.id, weight: clamped }));
        } else {
          showToast(res?.error || t('agManager.toast.actionFailed'), true);
        }
      } catch (err) {
        showToast(err?.message || t('agManager.toast.actionFailed'), true);
      } finally {
        if (state.stateRevision === revBefore) await loadState();
        else renderAll();
      }
    });
    weightControl.append(weightPrefix, weightInput);
    pills.appendChild(weightControl);
  } else if (accountWeight !== 50) {
    pills.appendChild(makePill(t('agManager.weightBadge', { weight: accountWeight }), 'violet', true));
  }

  if (acc.hasDeviceProfile) {
    pills.appendChild(makePill(t('agManager.isolatedBadge'), 'muted', true));
  }
  for (const cap of inferCapabilityPills(acc)) {
    pills.appendChild(makePill(cap.label, cap.tone, true));
  }

  metaRow.appendChild(pills);

  const tsRaw = acc.quota?.lastUpdatedAt || acc.lastUsedAt;
  const tsText = formatCompactTimestamp(tsRaw);
  if (tsText) {
    const timeEl = document.createElement('span');
    timeEl.className = 'agm-card-time';
    timeEl.dataset.ageTs = String(tsRaw);
    timeEl.textContent = formatRelativeAge(tsRaw) || tsText;
    timeEl.setAttribute('aria-label', `${t('agManager.lastRefresh')}: ${tsText}`);
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
  const modelsExpanded = models.length > 0 && isAccountModelsExpanded(acc.id);
  if (models.length > 0) {
    const modelsSection = document.createElement('div');
    modelsSection.className = `agm-models-section${modelsExpanded ? ' is-expanded' : ''}`;

    const modelsGridId = modelSectionDomId(acc.id);
    const modelsToggleBtn = document.createElement('button');
    modelsToggleBtn.type = 'button';
    modelsToggleBtn.className = 'agm-models-toggle';
    modelsToggleBtn.setAttribute('aria-expanded', String(modelsExpanded));
    if (modelsExpanded) modelsToggleBtn.setAttribute('aria-controls', modelsGridId);

    const toggleText = document.createElement('span');
    toggleText.className = 'agm-models-toggle-label';
    toggleText.textContent = modelsExpanded
      ? t('agManager.hideModels', { count: models.length })
      : t('agManager.showModels', { count: models.length });
    const toggleChevron = document.createElement('span');
    toggleChevron.className = 'agm-models-toggle-chevron';
    toggleChevron.setAttribute('aria-hidden', 'true');
    toggleChevron.textContent = '▾';
    modelsToggleBtn.append(toggleText, toggleChevron);
    modelsToggleBtn.addEventListener('click', (ev) => {
      setAccountModelsExpanded(acc.id, !modelsExpanded);
      renderAccounts();
      if (ev.detail === 0) {
        const nextToggle = els.accountList.querySelector(`.agm-card[data-account-id="${CSS.escape(acc.id)}"] .agm-models-toggle`);
        nextToggle?.focus();
      }
    });
    modelsSection.appendChild(modelsToggleBtn);

    if (modelsExpanded) {
      const grid = document.createElement('div');
      grid.id = modelsGridId;
      grid.className = 'agm-models-grid';
      for (const m of models) {
        const mRow = document.createElement('div');
        mRow.className = 'agm-model-row';
        const mName = document.createElement('span');
        mName.className = 'agm-model-name';
        mName.textContent = m.displayName || m.name;
        const mRight = document.createElement('span');
        mRight.className = 'agm-model-meta';
        if (m.resetTime) {
          const mReset = document.createElement('span');
          mReset.className = 'agm-model-reset';
          mReset.dataset.resetIso = m.resetTime;
          mReset.textContent = formatResetCountdown(m.resetTime);
          mRight.appendChild(mReset);
        }
        const mPctVal = Math.max(0, Math.min(100, Math.round(Number(m.percentage || 0))));
        const mTone = pctToneClass(mPctVal);
        const mPct = document.createElement('span');
        mPct.className = `agm-model-pct${mTone ? ` ${mTone}` : ''}`;
        mPct.textContent = `${mPctVal}%`;
        mRight.appendChild(mPct);
        mRow.append(mName, mRight);
        grid.appendChild(mRow);
      }
      modelsSection.appendChild(grid);
    }

    card.appendChild(modelsSection);
  }

  const actions = document.createElement('div');
  actions.className = 'agm-card-actions-grid';

  const switchBtn = document.createElement('button');
  switchBtn.type = 'button';
  switchBtn.className = `agm-action-btn agm-action-switch${isSwitchingThis ? ' is-busy' : ''}`;
  const switchLabel = document.createElement('span');
  switchLabel.textContent = isSwitchingThis ? t('agManager.switching') : t('agManager.switchAccount');
  switchBtn.append(isSwitchingThis ? iconRefresh('agm-spin') : iconSwitch(), switchLabel);
  switchBtn.disabled = !acc.hasToken || isAnySwitchInFlight();
  switchBtn.addEventListener('click', async () => {
    if (isAnySwitchInFlight()) return;
    state.switchingId = acc.id;
    renderAll();
    const revBefore = state.stateRevision;
    try {
      const res = await agmApi().switchAccount(acc.id, els.targetClient.value);
      if (res?.ok) {
        const resumedCount = Number(res.resumedCount || 0);
        showToast(resumedCount > 0
          ? t('agManager.toast.switchOkResumed', { email: acc.email, target: res.target, mode: res.mode, count: resumedCount })
          : t('agManager.toast.switchSuccess', { email: acc.email, target: res.target, mode: res.mode }));
      } else {
        showToast(res?.error || t('agManager.toast.switchFailed'), true);
      }
    } catch (err) {
      showToast(err?.message || t('agManager.toast.switchFailed'), true);
    } finally {
      state.switchingId = '';
      if (state.stateRevision === revBefore) await loadState();
      else renderAll();
    }
  });

  const refreshBtn = document.createElement('button');
  refreshBtn.type = 'button';
  refreshBtn.className = `agm-action-btn${isRefreshingThis ? ' is-busy' : ''}`;
  const refreshLabel = document.createElement('span');
  refreshLabel.textContent = isRefreshingThis ? t('agManager.refreshing') : t('agManager.refreshOne');
  refreshBtn.append(iconRefresh(isRefreshingThis ? 'agm-spin' : ''), refreshLabel);
  refreshBtn.disabled = !acc.hasToken || isRefreshingThis;
  refreshBtn.addEventListener('click', async () => {
    if (state.refreshingIds.has(acc.id)) return;
    state.refreshingIds.add(acc.id);
    renderAccounts();
    const revBefore = state.stateRevision;
    try {
      const res = await agmApi().refreshAccount(acc.id);
      if (!res?.ok) showToast(res?.error || t('agManager.toast.refreshFailed'), true);
      else showToast(t('agManager.toast.refreshOneOk', { email: acc.email }));
    } catch (err) {
      showToast(err?.message || t('agManager.toast.refreshFailed'), true);
    } finally {
      state.refreshingIds.delete(acc.id);
      if (state.stateRevision === revBefore) await loadState();
      else renderAll();
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
    const revBefore = state.stateRevision;
    try {
      const res = await agmApi().setAccountDisabled(acc.id, !acc.disabled);
      if (res && res.ok === false) {
        showToast(res.error || t('agManager.toast.actionFailed'), true);
      }
    } catch (err) {
      showToast(err?.message || t('agManager.toast.actionFailed'), true);
    } finally {
      if (state.stateRevision === revBefore) await loadState();
      else renderAll();
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
      const expanded = isAccountModelsExpanded(acc.id);
      const modelsItem = document.createElement('button');
      modelsItem.type = 'button';
      modelsItem.className = 'agm-more-item';
      modelsItem.setAttribute('role', 'menuitem');
      modelsItem.textContent = expanded
        ? t('agManager.hideModels', { count: models.length })
        : t('agManager.showModels', { count: models.length });
      modelsItem.addEventListener('click', () => {
        setAccountModelsExpanded(acc.id, !expanded);
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
  const top = els.refreshPopover.getBoundingClientRect().top;
  els.refreshPopover.style.maxHeight = `${Math.max(180, Math.floor(window.innerHeight - top - 12))}px`;
}

function positionAutoSwitchPopover() {
  if (!els.autoSwitchPopover || els.autoSwitchPopover.classList.contains('hidden')) return;
  els.autoSwitchPopover.classList.add('align-left');
  const rect = els.autoSwitchPopover.getBoundingClientRect();
  if (rect.right > window.innerWidth - 14) {
    els.autoSwitchPopover.classList.remove('align-left');
  }
  const top = els.autoSwitchPopover.getBoundingClientRect().top;
  els.autoSwitchPopover.style.maxHeight = `${Math.max(180, Math.floor(window.innerHeight - top - 12))}px`;
}

function renderAccounts() {
  const list = filteredAccounts();
  syncToggleAllModelsButton(list);
  els.selectAllInput.disabled = list.length === 0;
  if (list.length === 0) {
    const isPoolEmpty = (state.manager?.accounts || []).length === 0;
    const empty = document.createElement('div');
    empty.className = 'agm-empty';
    const msg = document.createElement('p');
    msg.textContent = isPoolEmpty
      ? t('agManager.emptyPool')
      : t('agManager.emptyFilter');
    const cta = document.createElement('button');
    cta.type = 'button';
    cta.className = isPoolEmpty ? 'agm-btn agm-btn-primary' : 'agm-btn';
    cta.textContent = isPoolEmpty ? t('agManager.openImport') : t('agManager.clearFilters');
    cta.addEventListener('click', () => {
      if (isPoolEmpty) openImportModal();
      else clearAccountFilters();
    });
    empty.append(msg, cta);
    els.accountList.replaceChildren(empty);
    els.selectAllInput.checked = false;
    els.selectAllInput.indeterminate = false;
    return;
  }
  const active = state.manager?.activeAccounts || {};
  const nextCards = list.map((acc) => {
    const activeSlots = Object.entries(active)
      .filter(([, id]) => id === acc.id)
      .map(([slot]) => slot);
    const sig = buildCardSignature(acc, activeSlots);
    const cached = cardCache.get(acc.id);
    if (cached && cached.sig === sig) {
      return cached.el;
    }
    const el = renderAccountCard(acc, active);
    cardCache.set(acc.id, { sig, el });
    return el;
  });

  if (els.accountList.firstElementChild?.classList?.contains('agm-empty')) {
    els.accountList.replaceChildren();
  }
  const nextSet = new Set(nextCards);
  for (const child of Array.from(els.accountList.children)) {
    if (!nextSet.has(child)) {
      child.remove();
    }
  }
  for (let i = 0; i < nextCards.length; i += 1) {
    const desired = nextCards[i];
    const currentAtIdx = els.accountList.children[i];
    if (currentAtIdx !== desired) {
      els.accountList.insertBefore(desired, currentAtIdx || null);
    }
  }

  const allChecked = list.length > 0 && list.every((acc) => state.selectedIds.has(acc.id));
  const someChecked = list.some((acc) => state.selectedIds.has(acc.id));
  els.selectAllInput.checked = allChecked;
  els.selectAllInput.indeterminate = !allChecked && someChecked;
  if (state.openMoreId) positionOpenMoreMenu();
  refreshLiveTimes();
}

function renderAll() {
  renderSummaryAndControls();
  renderAccounts();
}

function refreshLiveTimes() {
  for (const el of document.querySelectorAll('[data-reset-iso]')) {
    const iso = el.dataset.resetIso;
    if (!iso) continue;
    const nextText = formatResetCountdown(iso);
    const target = el.querySelector('.agm-quota-reset-value') || el;
    if (target.textContent !== nextText) {
      target.textContent = nextText;
    }
    if (el.dataset.ariaBase) {
      const nextAria = `${el.dataset.ariaBase} (${nextText})`;
      if (el.getAttribute('aria-label') !== nextAria) {
        el.setAttribute('aria-label', nextAria);
      }
    }
  }
  for (const el of document.querySelectorAll('[data-age-ts]')) {
    const nextAge = formatRelativeAge(el.dataset.ageTs);
    if (nextAge && el.textContent !== nextAge) {
      el.textContent = nextAge;
    }
  }
}

function clearAccountFilters() {
  if (state.searchTimer) {
    clearTimeout(state.searchTimer);
    state.searchTimer = null;
  }
  state.search = '';
  if (els.searchInput) els.searchInput.value = '';
  state.filter = 'all';
  for (const c of els.filterChips) {
    const active = (c.dataset.filter || 'all') === 'all';
    c.classList.toggle('active', active);
    c.setAttribute('aria-pressed', String(active));
  }
  state.sort = 'default';
  if (els.sortSelect) els.sortSelect.value = 'default';
  renderAccounts();
}

function openImportModal() {
  closeRefreshPopover();
  closeAutoSwitchPopover();
  setImportStatus('');
  els.importDialog.showModal();
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
  state.stateRevision = (state.stateRevision || 0) + 1;
  const validIds = new Set((state.manager?.accounts || []).map((a) => a.id));
  for (const id of [...state.selectedIds]) {
    if (!validIds.has(id)) state.selectedIds.delete(id);
  }
  for (const id of [...state.expandedModels]) {
    if (!validIds.has(id)) state.expandedModels.delete(id);
  }
  if (state.collapsedModels) {
    for (const id of [...state.collapsedModels]) {
      if (!validIds.has(id)) state.collapsedModels.delete(id);
    }
  }
  if (validIds.size === 0) state.allModelsExpanded = false;
  if (state.refreshingIds) {
    for (const id of [...state.refreshingIds]) {
      if (!validIds.has(id)) state.refreshingIds.delete(id);
    }
  }
  if (typeof cardCache !== 'undefined') {
    for (const id of [...cardCache.keys()]) {
      if (!validIds.has(id)) cardCache.delete(id);
    }
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
  if (state.rafStateId) {
    cancelAnimationFrame(state.rafStateId);
    state.rafStateId = 0;
    state.pendingPushedState = null;
  }
  try {
    const nextState = await agmApi().getState();
    applyManagerState(nextState);
  } catch (err) {
    showToast(err?.message || t('agManager.toast.actionFailed'), true);
  }
}

function schedulePushedManagerState(nextState) {
  state.pendingPushedState = nextState;
  if (state.rafStateId) return;
  state.rafStateId = requestAnimationFrame(() => {
    state.rafStateId = 0;
    const pending = state.pendingPushedState;
    state.pendingPushedState = null;
    if (pending) applyManagerState(pending);
  });
}

async function persistConfigPatch(patch) {
  try {
    const res = await agmApi().updateConfig(patch);
    if (res?.ok && state.manager) {
      state.manager.config = res.config;
      renderAll();
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

function closeAutoSwitchPopover({ restoreFocus = false } = {}) {
  if (!els.autoSwitchPopover || els.autoSwitchPopover.classList.contains('hidden')) return false;
  els.autoSwitchPopover.classList.add('hidden');
  els.autoSwitchMenuBtn.setAttribute('aria-expanded', 'false');
  if (restoreFocus) els.autoSwitchMenuBtn.focus();
  return true;
}

function setImportStatus(text, isError = false) {
  if (!els.importStatus) return;
  const msg = String(text || '');
  els.importStatus.textContent = msg;
  els.importStatus.classList.toggle('is-error', Boolean(isError && msg));
  els.importStatus.classList.toggle('hidden', !msg);
  els.importStatus.setAttribute('role', isError ? 'alert' : 'status');
}

function setImportControlsBusy(busy) {
  const locked = Boolean(busy || state.oauthBusy);
  for (const btn of importButtons) {
    btn.disabled = locked;
  }
  if (els.startOAuthBtn) {
    els.startOAuthBtn.disabled = locked;
  }
  if (els.importDialog) {
    els.importDialog.setAttribute('aria-busy', String(locked));
  }
}

async function runImportAction(button, invoke, successText) {
  if (state.importBusy || state.oauthBusy) return;
  state.importBusy = true;
  setImportControlsBusy(true);
  button?.classList.add('is-busy');
  setImportStatus('');
  try {
    const res = await invoke();
    if (res?.canceled) return;
    if (res?.ok) {
      showToast(successText(res));
      els.importDialog.close();
    } else {
      const msg = res?.error || t('agManager.toast.actionFailed');
      setImportStatus(msg, true);
      showToast(msg, true);
    }
  } catch (err) {
    const msg = err?.message || t('agManager.toast.actionFailed');
    setImportStatus(msg, true);
    showToast(msg, true);
  } finally {
    state.importBusy = false;
    setImportControlsBusy(false);
    button?.classList.remove('is-busy');
    hideProgressBar();
    await loadState();
  }
}

function wireEvents() {
  els.themeToggle.addEventListener('click', () => {
    state.flat = !state.flat;
    els.body.classList.toggle('flat', state.flat);
    window.tokenMonitor.updateSettings?.({ dashboardFlat: state.flat });
  });
  els.minBtn.addEventListener('click', () => agmApi().minimize());
  els.closeBtn.addEventListener('click', () => agmApi().close());
  els.toast?.addEventListener('click', () => hideToast());

  els.targetClient.addEventListener('change', () => {
    void persistConfigPatch({ defaultSwitchTarget: els.targetClient.value });
  });

  els.switchBestBtn.addEventListener('click', async () => {
    if (isAnySwitchInFlight()) return;
    state.switchBestBusy = true;
    renderAll();
    const revBefore = state.stateRevision;
    try {
      const res = await agmApi().switchBestAccount(els.targetClient.value);
      if (res?.ok) {
        const resumedCount = Number(res.resumedCount || 0);
        showToast(resumedCount > 0
          ? t('agManager.toast.switchBestOkResumed', { target: res.target, mode: res.mode, count: resumedCount })
          : t('agManager.toast.switchBestOk', { target: res.target, mode: res.mode }));
      } else {
        showToast(res?.error || t('agManager.toast.switchFailed'), true);
      }
    } catch (err) {
      showToast(err?.message || t('agManager.toast.switchFailed'), true);
    } finally {
      state.switchBestBusy = false;
      if (state.stateRevision === revBefore) await loadState();
      else renderAll();
    }
  });

  els.refreshNowBtn.addEventListener('click', async () => {
    state.refreshClickBusy = true;
    renderSummaryAndControls();
    const revBefore = state.stateRevision;
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
      if (state.stateRevision === revBefore) await loadState();
      else renderAll();
    }
  });

  els.cancelRefreshBtn.addEventListener('click', () => {
    void agmApi().cancelRefresh();
  });

  els.refreshMenuBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    closeAutoSwitchPopover();
    const isHidden = els.refreshPopover.classList.toggle('hidden');
    els.refreshMenuBtn.setAttribute('aria-expanded', String(!isHidden));
    if (!isHidden) positionRefreshPopover();
  });

  els.autoSwitchMenuBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    closeRefreshPopover();
    const isHidden = els.autoSwitchPopover.classList.toggle('hidden');
    els.autoSwitchMenuBtn.setAttribute('aria-expanded', String(!isHidden));
    if (!isHidden) positionAutoSwitchPopover();
  });

  const onDocumentClick = (ev) => {
    const targetEl = ev.target instanceof Element ? ev.target : null;
    if (!els.refreshSplit.contains(ev.target)) {
      closeRefreshPopover();
    }
    if (els.autoSwitchWrap && !els.autoSwitchWrap.contains(ev.target)) {
      closeAutoSwitchPopover();
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
    const targetEl = ev.target instanceof Element ? ev.target : null;
    const isEditable = Boolean(
      targetEl?.closest?.('input, textarea, select')
      || (targetEl instanceof HTMLElement && targetEl.isContentEditable)
    );
    const hasOpenDialog = Boolean(els.importDialog?.open || els.deviceDialog?.open);
    const isFindShortcut = (ev.key === '/' && !ev.ctrlKey && !ev.metaKey && !ev.altKey)
      || ((ev.ctrlKey || ev.metaKey) && !ev.altKey && String(ev.key || '').toLowerCase() === 'f');
    if (isFindShortcut && !isEditable && !hasOpenDialog && !ev.isComposing) {
      ev.preventDefault();
      els.searchInput?.focus();
      els.searchInput?.select();
      return;
    }
    if (ev.key !== 'Escape') return;
    if (closeAutoSwitchPopover({ restoreFocus: true })) {
      ev.preventDefault();
      return;
    }
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
    positionAutoSwitchPopover();
    if (state.openMoreId) positionOpenMoreMenu();
  };
  window.addEventListener('resize', onWindowResize);
  registerCleanup(() => window.removeEventListener('resize', onWindowResize));

  els.autoSwitchEnabledInput.addEventListener('change', () => {
    void persistConfigPatch({ autoSwitchEnabled: els.autoSwitchEnabledInput.checked });
  });
  els.selectionModeSelect.addEventListener('change', () => {
    void persistConfigPatch({ selectionMode: els.selectionModeSelect.value });
  });
  els.autoSwitchScopeSelect.addEventListener('change', () => {
    void persistConfigPatch({ autoSwitchScope: els.autoSwitchScopeSelect.value });
  });
  els.autoSwitchThresholdInput.addEventListener('change', () => {
    const parsed = Number(els.autoSwitchThresholdInput.value);
    const val = Number.isFinite(parsed) ? Math.max(0, Math.min(50, Math.round(parsed))) : 0;
    els.autoSwitchThresholdInput.value = String(val);
    void persistConfigPatch({ autoSwitchThresholdPercent: val });
  });
  els.autoSwitchCooldownInput.addEventListener('change', () => {
    const parsed = Number(els.autoSwitchCooldownInput.value);
    const val = Number.isFinite(parsed) ? Math.max(30, Math.min(3600, Math.round(parsed))) : 180;
    els.autoSwitchCooldownInput.value = String(val);
    void persistConfigPatch({ autoSwitchCooldownSeconds: val });
  });
  els.autoResumeEnabledInput?.addEventListener('change', () => {
    void persistConfigPatch({ autoResumeEnabled: els.autoResumeEnabledInput.checked });
  });
  els.autoResumePromptInput?.addEventListener('change', () => {
    const cleaned = els.autoResumePromptInput.value.replace(/[\r\n]+/g, ' ').trim().slice(0, 500) || '继续';
    els.autoResumePromptInput.value = cleaned;
    void persistConfigPatch({ autoResumePrompt: cleaned });
  });

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
    const nextSearch = els.searchInput.value;
    if (state.searchTimer) {
      clearTimeout(state.searchTimer);
      state.searchTimer = null;
    }
    if (!nextSearch) {
      state.search = '';
      renderAccounts();
      return;
    }
    state.searchTimer = setTimeout(() => {
      state.searchTimer = null;
      state.search = els.searchInput.value;
      renderAccounts();
    }, 100);
  });

  els.searchInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && (els.searchInput.value || state.search)) {
      ev.preventDefault();
      ev.stopPropagation();
      if (state.searchTimer) {
        clearTimeout(state.searchTimer);
        state.searchTimer = null;
      }
      els.searchInput.value = '';
      state.search = '';
      renderAccounts();
    }
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

  els.sortSelect?.addEventListener('change', () => {
    state.sort = els.sortSelect.value || 'default';
    renderAccounts();
  });

  els.toggleModelsBtn?.addEventListener('click', () => {
    toggleAllVisibleModels();
  });

  els.clearSelectionBtn?.addEventListener('click', () => {
    state.selectedIds.clear();
    state.batchDeleteConfirm = false;
    renderAll();
  });

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
  els.openImportBtn.addEventListener('click', () => openImportModal());
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

  els.pickJsonFileBtn.addEventListener('click', () => {
    void runImportAction(
      els.pickJsonFileBtn,
      () => agmApi().pickAndImportJson({ refreshAfterImport: els.refreshAfterImportInput.checked }),
      (res) => t('agManager.toast.importDone', { success: res.success, failed: res.failed })
    );
  });

  els.submitPasteBtn.addEventListener('click', () => {
    const text = els.tokenPasteInput.value.trim();
    if (!text) return;
    void runImportAction(
      els.submitPasteBtn,
      () => agmApi().importFromString(text, { refreshAfterImport: els.refreshAfterImportInput.checked }),
      (res) => {
        els.tokenPasteInput.value = '';
        return t('agManager.toast.importDone', { success: res.success, failed: res.failed });
      }
    );
  });

  els.importDefaultDirBtn.addEventListener('click', () => {
    void runImportAction(
      els.importDefaultDirBtn,
      () => agmApi().importDefaultDataDir(),
      (res) => t('agManager.toast.importDirDone', { count: res.imported })
    );
  });

  els.pickDataDirBtn.addEventListener('click', () => {
    void runImportAction(
      els.pickDataDirBtn,
      () => agmApi().pickAndImportDataDir(),
      (res) => t('agManager.toast.importDirDone', { count: res.imported })
    );
  });

  els.scanLocalBtn.addEventListener('click', () => {
    void runImportAction(
      els.scanLocalBtn,
      () => agmApi().scanLocalAccounts(),
      (res) => t('agManager.toast.importDone', { success: res.success, failed: res.failed })
    );
  });

  els.pickStateDbBtn.addEventListener('click', () => {
    void runImportAction(
      els.pickStateDbBtn,
      () => agmApi().pickAndImportStateDb(),
      (res) => t('agManager.toast.importSingleOk', { email: res.account?.email || '' })
    );
  });

  els.pickV1DirBtn.addEventListener('click', () => {
    void runImportAction(
      els.pickV1DirBtn,
      () => agmApi().pickAndImportV1Dir(),
      (res) => t('agManager.toast.importDone', { success: res.success, failed: res.failed })
    );
  });

  els.startOAuthBtn.addEventListener('click', async () => {
    if (state.importBusy || state.oauthBusy) return;
    setImportStatus('');
    state.oauthBusy = true;
    setImportControlsBusy(false);
    els.cancelOAuthBtn.classList.remove('hidden');
    try {
      const res = await agmApi().startOAuthLogin(els.oauthClientSelect.value);
      if (res?.ok) {
        showToast(t('agManager.toast.importSingleOk', { email: res.account?.email || '' }));
        els.importDialog.close();
      } else {
        const msg = res?.error || t('agManager.toast.actionFailed');
        setImportStatus(msg, true);
        showToast(msg, true);
      }
    } catch (err) {
      const msg = err?.message || t('agManager.toast.actionFailed');
      setImportStatus(msg, true);
      showToast(msg, true);
    } finally {
      state.oauthBusy = false;
      setImportControlsBusy(false);
      els.cancelOAuthBtn.classList.add('hidden');
      await loadState();
    }
  });

  els.cancelOAuthBtn.addEventListener('click', () => {
    void agmApi().cancelOAuthLogin();
  });

  registerCleanup(agmApi().onState?.((nextState) => {
    schedulePushedManagerState(nextState);
  }));
  registerCleanup(agmApi().onRefreshProgress?.((p) => {
    if (!p || !p.total) return;
    showProgress(t('agManager.refreshProgress', {
      current: p.current,
      total: p.total,
      email: p.currentEmail || ''
    }), p.current, p.total);
  }));
  registerCleanup(agmApi().onImportProgress?.((p) => {
    if (!p || !p.total) return;
    showProgress(t('agManager.importProgress', {
      current: p.current,
      total: p.total,
      email: p.email || ''
    }), p.current, p.total);
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
  const [initialMat, fetchedSettings, initialManagerState] = await Promise.all([
    Promise.resolve(window.tokenMonitor.getNativeMaterialState?.()).catch(() => null),
    Promise.resolve(window.tokenMonitor.getSettings?.()).catch(() => ({})),
    Promise.resolve(agmApi()?.getState?.()).catch(() => null)
  ]);
  if (rev === nativeMaterialRevision && initialMat) {
    nativeMaterialState = glassRenderingApi.normalizeNativeMaterialState(initialMat);
  }

  const settings = fetchedSettings || {};
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

  state.liveTimer = setInterval(() => {
    if (document.visibilityState === 'visible') refreshLiveTimes();
  }, 30000);
  registerCleanup(() => {
    if (state.liveTimer) {
      clearInterval(state.liveTimer);
      state.liveTimer = 0;
    }
  });
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') refreshLiveTimes();
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
  registerCleanup(() => document.removeEventListener('visibilitychange', onVisibilityChange));

  window.addEventListener('beforeunload', () => {
    if (state.toastTimer) {
      clearTimeout(state.toastTimer);
      state.toastTimer = null;
    }
    if (state.searchTimer) {
      clearTimeout(state.searchTimer);
      state.searchTimer = null;
    }
    if (state.rafStateId) {
      cancelAnimationFrame(state.rafStateId);
      state.rafStateId = 0;
      state.pendingPushedState = null;
    }
    if (state.oauthBusy) void agmApi()?.cancelOAuthLogin?.();
    for (const fn of cleanupFns.splice(0)) {
      try { fn(); } catch (_) {}
    }
  }, { once: true });

  applyAppearance(settings);
  applyTranslations();
  wireEvents();
  if (initialManagerState) applyManagerState(initialManagerState);
  else await loadState();
  agmApi().windowReady();
}

void boot();
