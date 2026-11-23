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
  confirmDeleteId: '',
  toastTimer: null,
  oauthBusy: false
};

let nativeMaterialState = glassRenderingApi?.normalizeNativeMaterialState?.() || { type: 'transparent', reducedTransparency: false, highContrast: false };
let nativeMaterialRevision = 0;

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
  document.documentElement.lang = state.locale;
}

function applyAppearance(settings) {
  glassRenderingApi?.applyNativeMaterialClasses?.(nativeMaterialState);
  const opacity = Math.min(100, Math.max(0, settings?.glassOpacity ?? 68)) / 100;
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
  els.body.classList.toggle('flat', state.flat);
}

function showToast(text, isError = false) {
  if (!els.toast) return;
  els.toast.textContent = String(text || '');
  els.toast.classList.toggle('is-error', Boolean(isError));
  els.toast.classList.toggle('hidden', !text);
  if (state.toastTimer) clearTimeout(state.toastTimer);
  if (text) {
    state.toastTimer = setTimeout(() => {
      els.toast.classList.add('hidden');
    }, 4000);
  }
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

function makePill(text, tone = '') {
  const span = document.createElement('span');
  span.className = `agm-pill${tone ? ` agm-pill-${tone}` : ''}`;
  span.textContent = text;
  return span;
}

function renderSummaryAndControls() {
  const mgr = state.manager;
  if (!mgr) return;
  const accounts = mgr.accounts || [];
  const cfg = mgr.config || {};
  const active = mgr.activeAccounts || {};

  const counts = { total: accounts.length, ULTRA: 0, PRO: 0, FREE: 0, abnormal: 0 };
  for (const a of accounts) {
    if (a.subscriptionTier === 'ULTRA') counts.ULTRA += 1;
    else if (a.subscriptionTier === 'PRO') counts.PRO += 1;
    else if (a.subscriptionTier === 'FREE') counts.FREE += 1;
    if (isAbnormalAccount(a)) counts.abnormal += 1;
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
      return found ? `${slot.toUpperCase()}: ${found.email}` : '';
    })
    .filter(Boolean);
  if (activeSummary.length > 0) {
    metaParts.push(activeSummary.join(' · '));
  }
  els.runtimeMeta.textContent = metaParts.join('  |  ');

  els.targetClient.value = cfg.defaultSwitchTarget || 'auto';
  els.startupRefreshInput.checked = cfg.startupRefresh === true;
  els.autoRefreshInput.checked = cfg.autoRefresh === true;
  if (document.activeElement !== els.intervalInput) els.intervalInput.value = String(cfg.refreshIntervalMinutes || 10);
  if (document.activeElement !== els.concurrencyInput) els.concurrencyInput.value = String(cfg.refreshConcurrency || 5);
  if (document.activeElement !== els.slideDelayInput) els.slideDelayInput.value = String(cfg.refreshSlideDelaySecs ?? 0.2);
  els.syncToHubInput.checked = cfg.syncToHub !== false;
  els.restoreDeviceBtn.classList.toggle('hidden', !mgr.hasOriginalDeviceBackup);

  const refreshing = mgr.isRefreshing === true;
  const selectedCount = state.selectedIds.size;
  els.refreshNowBtn.disabled = refreshing || accounts.length === 0;
  els.refreshNowLabel.textContent = refreshing
    ? t('agManager.refreshing')
    : (selectedCount > 0 ? t('agManager.refreshSelected', { count: selectedCount }) : t('agManager.refreshAll'));
  els.cancelRefreshBtn.classList.toggle('hidden', !refreshing);
  els.batchDeleteBtn.classList.toggle('hidden', selectedCount === 0);
  els.batchDeleteBtn.textContent = t('agManager.deleteSelectedCount', { count: selectedCount });
}

function renderQuotaGroups(acc) {
  const groups = Array.isArray(acc?.quota?.groups) ? acc.quota.groups : [];
  if (groups.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'agm-hint';
    empty.textContent = t('agManager.noQuotaData');
    return empty;
  }
  const wrap = document.createElement('div');
  wrap.className = 'agm-groups';
  for (const g of groups) {
    const groupEl = document.createElement('div');
    groupEl.className = 'agm-group';
    const title = document.createElement('div');
    title.className = 'agm-group-title';
    title.textContent = g.displayName || 'Quota';
    groupEl.appendChild(title);

    for (const b of g.buckets || []) {
      const pct = Math.max(0, Math.min(100, Math.round(Number(b.remainingFraction || 0) * 100)));
      const row = document.createElement('div');
      row.className = 'agm-bucket-row';

      const win = document.createElement('span');
      win.className = 'agm-bucket-win';
      win.textContent = b.window || b.bucketId || '—';

      const meter = document.createElement('div');
      meter.className = 'agm-meter';
      const fill = document.createElement('div');
      fill.className = `agm-meter-fill${pct <= 15 ? ' is-low' : (pct <= 40 ? ' is-warn' : '')}`;
      fill.style.width = `${pct}%`;
      meter.appendChild(fill);

      const pctText = document.createElement('span');
      pctText.className = 'agm-bucket-pct';
      pctText.textContent = `${pct}% · ${formatResetCountdown(b.resetTime)}`;

      row.append(win, meter, pctText);
      groupEl.appendChild(row);
    }
    wrap.appendChild(groupEl);
  }
  return wrap;
}

function renderAccountCard(acc, activeAccounts) {
  const activeSlots = Object.entries(activeAccounts || {})
    .filter(([, id]) => id === acc.id)
    .map(([slot]) => slot.toUpperCase());

  const card = document.createElement('article');
  card.className = `agm-card${activeSlots.length > 0 ? ' is-active' : ''}`;

  const head = document.createElement('div');
  head.className = 'agm-card-head';

  const identity = document.createElement('div');
  identity.className = 'agm-card-identity';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = state.selectedIds.has(acc.id);
  checkbox.setAttribute('aria-label', `Select ${acc.email}`);
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) state.selectedIds.add(acc.id);
    else state.selectedIds.delete(acc.id);
    renderSummaryAndControls();
  });

  const emailWrap = document.createElement('div');
  emailWrap.className = 'agm-card-email-wrap';
  const emailEl = document.createElement('div');
  emailEl.className = 'agm-card-email';
  emailEl.textContent = acc.email || acc.id;
  emailWrap.appendChild(emailEl);
  if (acc.name) {
    const nameEl = document.createElement('div');
    nameEl.className = 'agm-card-name';
    nameEl.textContent = acc.name;
    emailWrap.appendChild(nameEl);
  }
  identity.append(checkbox, emailWrap);

  const badges = document.createElement('div');
  badges.className = 'agm-card-badges';
  const tierTone = acc.subscriptionTier === 'ULTRA' ? 'accent' : (acc.subscriptionTier === 'PRO' ? 'ok' : 'muted');
  badges.appendChild(makePill(acc.subscriptionTier || 'UNKNOWN', tierTone));
  for (const slot of activeSlots) {
    badges.appendChild(makePill(`Active · ${slot}`, 'ok'));
  }
  if (acc.banned) badges.appendChild(makePill(t('agManager.badge.banned'), 'danger'));
  else if (acc.validationBlocked) badges.appendChild(makePill(t('agManager.badge.validation'), 'warn'));
  else if (acc.disabled) badges.appendChild(makePill(t('agManager.badge.disabled'), 'danger'));
  else if (acc.quota?.isForbidden) badges.appendChild(makePill('403', 'warn'));

  head.append(identity, badges);
  card.appendChild(head);

  if (acc.validationBlocked && acc.validationMessage) {
    const msg = document.createElement('div');
    msg.className = 'agm-hint';
    msg.textContent = acc.validationMessage;
    card.appendChild(msg);
  } else if (acc.banned && acc.banInfo?.message) {
    const msg = document.createElement('div');
    msg.className = 'agm-hint';
    msg.textContent = acc.banInfo.message;
    card.appendChild(msg);
  }

  card.appendChild(renderQuotaGroups(acc));

  const models = Array.isArray(acc?.quota?.models) ? acc.quota.models : [];
  if (models.length > 0) {
    const expanded = state.expandedModels.has(acc.id);
    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'agm-models-toggle';
    toggleBtn.textContent = expanded
      ? t('agManager.hideModels', { count: models.length })
      : t('agManager.showModels', { count: models.length });
    toggleBtn.addEventListener('click', () => {
      if (state.expandedModels.has(acc.id)) state.expandedModels.delete(acc.id);
      else state.expandedModels.add(acc.id);
      renderAccounts();
    });
    card.appendChild(toggleBtn);

    if (expanded) {
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
  }

  const actions = document.createElement('div');
  actions.className = 'agm-card-actions';
  const left = document.createElement('div');
  left.className = 'agm-card-actions-left';
  const right = document.createElement('div');
  right.className = 'agm-card-actions-right';

  const switchBtn = document.createElement('button');
  switchBtn.type = 'button';
  switchBtn.className = 'agm-btn agm-btn-sm agm-btn-accent';
  switchBtn.textContent = t('agManager.switchAccount');
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
  refreshBtn.className = 'agm-btn agm-btn-sm';
  refreshBtn.textContent = t('agManager.refreshOne');
  refreshBtn.disabled = !acc.hasToken;
  refreshBtn.addEventListener('click', async () => {
    refreshBtn.disabled = true;
    const res = await agmApi().refreshAccount(acc.id);
    if (!res?.ok) showToast(res?.error || 'Refresh failed', true);
    else showToast(t('agManager.toast.refreshOneOk', { email: acc.email }));
    await loadState();
  });

  const deviceBtn = document.createElement('button');
  deviceBtn.type = 'button';
  deviceBtn.className = 'agm-btn agm-btn-sm';
  deviceBtn.textContent = t('agManager.deviceBtn');
  deviceBtn.addEventListener('click', () => openDeviceDialog(acc));

  left.append(switchBtn, refreshBtn, deviceBtn);

  const toggleDisableBtn = document.createElement('button');
  toggleDisableBtn.type = 'button';
  toggleDisableBtn.className = 'agm-btn agm-btn-sm';
  toggleDisableBtn.textContent = acc.disabled ? t('agManager.enable') : t('agManager.disable');
  toggleDisableBtn.addEventListener('click', async () => {
    await agmApi().setAccountDisabled(acc.id, !acc.disabled);
    await loadState();
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'agm-btn agm-btn-sm agm-btn-danger';
  deleteBtn.textContent = state.confirmDeleteId === acc.id ? t('agManager.confirmDelete') : t('agManager.delete');
  deleteBtn.addEventListener('click', async () => {
    if (state.confirmDeleteId !== acc.id) {
      state.confirmDeleteId = acc.id;
      renderAccounts();
      return;
    }
    state.confirmDeleteId = '';
    state.selectedIds.delete(acc.id);
    await agmApi().deleteAccounts([acc.id]);
    await loadState();
  });

  right.append(toggleDisableBtn, deleteBtn);
  actions.append(left, right);
  card.appendChild(actions);

  return card;
}

function renderAccounts() {
  const list = filteredAccounts();
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
}

function renderAll() {
  renderSummaryAndControls();
  renderAccounts();
}

function openDeviceDialog(acc) {
  els.deviceBody.replaceChildren();
  const info = document.createElement('p');
  info.className = 'agm-hint';
  info.textContent = `${acc.email}`;
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
    const res = await agmApi().bindDeviceProfile(acc.id, 'generate');
    if (res?.ok) {
      pre.textContent = JSON.stringify(res.deviceProfile, null, 2);
      showToast(t('agManager.toast.deviceUpdated'));
      await loadState();
    }
  });

  const capBtn = document.createElement('button');
  capBtn.type = 'button';
  capBtn.className = 'agm-btn';
  capBtn.textContent = t('agManager.captureDevice');
  capBtn.addEventListener('click', async () => {
    const res = await agmApi().bindDeviceProfile(acc.id, 'capture');
    if (res?.ok) {
      pre.textContent = JSON.stringify(res.deviceProfile, null, 2);
      showToast(t('agManager.toast.deviceUpdated'));
      await loadState();
    }
  });

  actions.append(capBtn, genBtn);
  els.deviceBody.append(info, pre, actions);
  els.deviceDialog.showModal();
}

async function loadState() {
  try {
    state.manager = await agmApi().getState();
    const validIds = new Set((state.manager?.accounts || []).map((a) => a.id));
    for (const id of [...state.selectedIds]) {
      if (!validIds.has(id)) state.selectedIds.delete(id);
    }
    renderAll();
  } catch (err) {
    showToast(err?.message || 'Failed to load state', true);
  }
}

async function persistConfigPatch(patch) {
  const res = await agmApi().updateConfig(patch);
  if (res?.ok && state.manager) {
    state.manager.config = res.config;
    renderSummaryAndControls();
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

  els.targetClient.addEventListener('change', () => {
    void persistConfigPatch({ defaultSwitchTarget: els.targetClient.value });
  });

  els.switchBestBtn.addEventListener('click', async () => {
    els.switchBestBtn.disabled = true;
    try {
      const res = await agmApi().switchBestAccount(els.targetClient.value);
      if (res?.ok) {
        showToast(t('agManager.toast.switchBestOk', { target: res.target, mode: res.mode }));
      } else {
        showToast(res?.error || t('agManager.toast.switchFailed'), true);
      }
    } finally {
      els.switchBestBtn.disabled = false;
      await loadState();
    }
  });

  els.refreshNowBtn.addEventListener('click', async () => {
    const ids = state.selectedIds.size > 0 ? Array.from(state.selectedIds) : [];
    const res = ids.length > 0 ? await agmApi().refreshAccounts(ids) : await agmApi().refreshAll();
    els.progressBar.classList.add('hidden');
    if (res?.ok) {
      showToast(t('agManager.toast.refreshBatchDone', { success: res.success, failed: res.failed }));
    } else if (res?.error) {
      showToast(res.error, true);
    }
    await loadState();
  });

  els.cancelRefreshBtn.addEventListener('click', () => {
    void agmApi().cancelRefresh();
  });

  els.refreshMenuBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const open = els.refreshPopover.classList.toggle('hidden');
    els.refreshMenuBtn.setAttribute('aria-expanded', String(!open));
  });
  document.addEventListener('click', (ev) => {
    if (!els.refreshSplit.contains(ev.target)) {
      els.refreshPopover.classList.add('hidden');
      els.refreshMenuBtn.setAttribute('aria-expanded', 'false');
    }
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
    void persistConfigPatch({ refreshIntervalMinutes: Number(els.intervalInput.value || 10) });
  });
  els.concurrencyInput.addEventListener('change', () => {
    void persistConfigPatch({ refreshConcurrency: Number(els.concurrencyInput.value || 5) });
  });
  els.slideDelayInput.addEventListener('change', () => {
    void persistConfigPatch({ refreshSlideDelaySecs: Number(els.slideDelayInput.value || 0.2) });
  });

  els.searchInput.addEventListener('input', () => {
    state.search = els.searchInput.value;
    renderAccounts();
  });

  for (const chip of els.filterChips) {
    chip.addEventListener('click', () => {
      state.filter = chip.dataset.filter || 'all';
      for (const c of els.filterChips) c.classList.toggle('active', c === chip);
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
    renderAll();
  });

  els.batchDeleteBtn.addEventListener('click', async () => {
    const ids = Array.from(state.selectedIds);
    if (ids.length === 0) return;
    await agmApi().deleteAccounts(ids);
    state.selectedIds.clear();
    await loadState();
  });

  els.exportBtn.addEventListener('click', async () => {
    const ids = state.selectedIds.size > 0 ? Array.from(state.selectedIds) : [];
    const res = await agmApi().exportAccounts(ids);
    if (res?.canceled) return;
    if (res?.ok) showToast(t('agManager.toast.exportOk', { count: res.count }));
    else showToast(res?.error || 'Export failed', true);
  });

  els.restoreDeviceBtn.addEventListener('click', async () => {
    const res = await agmApi().restoreOriginalDevice();
    if (res?.ok) showToast(t('agManager.toast.restoreOk'));
    else showToast(res?.error || 'Restore failed', true);
  });

  // Import dialog
  els.openImportBtn.addEventListener('click', () => els.importDialog.showModal());
  els.closeImportDialog.addEventListener('click', () => els.importDialog.close());
  els.closeDeviceDialog.addEventListener('click', () => els.deviceDialog.close());

  for (const tab of els.importTabs) {
    tab.addEventListener('click', () => {
      const target = tab.dataset.importTab;
      for (const btn of els.importTabs) btn.classList.toggle('active', btn === tab);
      els.importTabJson.classList.toggle('hidden', target !== 'json');
      els.importTabDb.classList.toggle('hidden', target !== 'db');
      els.importTabOauth.classList.toggle('hidden', target !== 'oauth');
    });
  }

  els.pickJsonFileBtn.addEventListener('click', async () => {
    const res = await agmApi().pickAndImportJson({ refreshAfterImport: els.refreshAfterImportInput.checked });
    els.progressBar.classList.add('hidden');
    if (res?.canceled) return;
    if (res?.ok) {
      showToast(t('agManager.toast.importDone', { success: res.success, failed: res.failed }));
      els.importDialog.close();
    } else {
      showToast(res?.error || 'Import failed', true);
    }
    await loadState();
  });

  els.submitPasteBtn.addEventListener('click', async () => {
    const text = els.tokenPasteInput.value.trim();
    if (!text) return;
    els.submitPasteBtn.disabled = true;
    try {
      const res = await agmApi().importFromString(text, { refreshAfterImport: els.refreshAfterImportInput.checked });
      els.progressBar.classList.add('hidden');
      if (res?.ok) {
        els.tokenPasteInput.value = '';
        showToast(t('agManager.toast.importDone', { success: res.success, failed: res.failed }));
        els.importDialog.close();
      } else {
        showToast(res?.error || 'Import failed', true);
      }
    } finally {
      els.submitPasteBtn.disabled = false;
      await loadState();
    }
  });

  els.importDefaultDirBtn.addEventListener('click', async () => {
    const res = await agmApi().importDefaultDataDir();
    if (res?.ok) {
      showToast(t('agManager.toast.importDirDone', { count: res.imported }));
      els.importDialog.close();
    } else {
      showToast(res?.error || 'Import failed', true);
    }
    await loadState();
  });

  els.pickDataDirBtn.addEventListener('click', async () => {
    const res = await agmApi().pickAndImportDataDir();
    if (res?.canceled) return;
    if (res?.ok) {
      showToast(t('agManager.toast.importDirDone', { count: res.imported }));
      els.importDialog.close();
    } else {
      showToast(res?.error || 'Import failed', true);
    }
    await loadState();
  });

  els.scanLocalBtn.addEventListener('click', async () => {
    els.scanLocalBtn.disabled = true;
    try {
      const res = await agmApi().scanLocalAccounts();
      els.progressBar.classList.add('hidden');
      if (res?.ok) {
        showToast(t('agManager.toast.importDone', { success: res.success, failed: res.failed }));
        els.importDialog.close();
      } else {
        showToast(res?.error || 'Scan failed', true);
      }
    } finally {
      els.scanLocalBtn.disabled = false;
      await loadState();
    }
  });

  els.pickStateDbBtn.addEventListener('click', async () => {
    const res = await agmApi().pickAndImportStateDb();
    if (res?.canceled) return;
    if (res?.ok) {
      showToast(t('agManager.toast.importSingleOk', { email: res.account?.email || '' }));
      els.importDialog.close();
    } else {
      showToast(res?.error || 'Import DB failed', true);
    }
    await loadState();
  });

  els.pickV1DirBtn.addEventListener('click', async () => {
    const res = await agmApi().pickAndImportV1Dir();
    if (res?.canceled) return;
    if (res?.ok) {
      showToast(t('agManager.toast.importDone', { success: res.success, failed: res.failed }));
      els.importDialog.close();
    } else {
      showToast(res?.error || 'V1 import failed', true);
    }
    await loadState();
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
        showToast(res?.error || 'OAuth login failed', true);
      }
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

  agmApi().onState?.((nextState) => {
    state.manager = nextState;
    renderAll();
  });
  agmApi().onRefreshProgress?.((p) => {
    if (!p || !p.total) return;
    els.progressBar.classList.remove('hidden');
    els.progressBar.textContent = t('agManager.refreshProgress', {
      current: p.current,
      total: p.total,
      email: p.currentEmail || ''
    });
  });
  agmApi().onImportProgress?.((p) => {
    if (!p || !p.total) return;
    els.progressBar.classList.remove('hidden');
    els.progressBar.textContent = t('agManager.importProgress', {
      current: p.current,
      total: p.total,
      email: p.email || ''
    });
  });
}

async function boot() {
  if (typeof window.tokenMonitor.onNativeMaterialState === 'function') {
    window.tokenMonitor.onNativeMaterialState((next) => {
      nativeMaterialRevision += 1;
      nativeMaterialState = glassRenderingApi.normalizeNativeMaterialState(next);
      applyAppearance(state.settings || {});
    });
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

  window.tokenMonitor.onSettingsPush?.((next) => {
    if (!next) return;
    state.settings = { ...(state.settings || {}), ...next };
    if ('dashboardFlat' in next) state.flat = next.dashboardFlat === true;
    const nextLocale = i18n.resolveLocale(next.locale || next.language, navigator.languages);
    if (state.locale !== nextLocale) {
      state.locale = nextLocale;
      applyTranslations();
      renderAll();
    }
    applyAppearance(state.settings);
  });

  reducedMotionMedia?.addEventListener?.('change', () => applyAppearance(state.settings));

  applyAppearance(settings);
  applyTranslations();
  wireEvents();
  await loadState();
  agmApi().windowReady();
}

void boot();
