'use strict';

const { randomUUID } = require('node:crypto');

function endpoint(url) {
  try { return new URL(url).host; } catch (_) { return ''; }
}

function originOf(url) {
  try { return new URL(url).origin; } catch (_) { return ''; }
}

function sanitizeCaSummary(summary) {
  if (!summary || typeof summary !== 'object') return null;
  const certCount = Number(summary.certCount);
  return {
    subject: String(summary.subject || '').slice(0, 256),
    issuer: String(summary.issuer || '').slice(0, 256),
    validFrom: String(summary.validFrom || '').slice(0, 64),
    validTo: String(summary.validTo || '').slice(0, 64),
    fingerprint256: String(summary.fingerprint256 || '').slice(0, 128),
    certCount: Number.isFinite(certCount) ? Math.max(1, Math.min(10, Math.round(certCount))) : 1
  };
}

function normalizeStoredProfile(profile) {
  const base = {
    id: profile.id,
    name: profile.name,
    hubUrl: profile.hubUrl,
    secret: profile.secret,
    deviceId: profile.deviceId
  };
  const caCertPem = typeof profile.caCertPem === 'string' ? profile.caCertPem.trim() : '';
  if (caCertPem) {
    base.caCertPem = caCertPem;
    if (typeof profile.caFingerprintSha256 === 'string' && profile.caFingerprintSha256.trim()) {
      base.caFingerprintSha256 = profile.caFingerprintSha256.trim().toLowerCase();
    }
    const caSummary = sanitizeCaSummary(profile.caSummary);
    if (caSummary) base.caSummary = caSummary;
  }
  return base;
}

function activeHubProfile(settings = {}) {
  const profiles = Array.isArray(settings.hubProfiles) ? settings.hubProfiles : [];
  if (!profiles.length) return null;
  const activeId = String(settings.activeHubProfileId || '');
  return profiles.find((profile) => profile && profile.id === activeId) || null;
}

function initializeHubProfiles(settings) {
  const hubProfiles = Array.isArray(settings.hubProfiles) ? settings.hubProfiles.filter(profile =>
    profile && typeof profile.id === 'string' && typeof profile.name === 'string'
    && typeof profile.hubUrl === 'string' && typeof profile.secret === 'string'
    && typeof profile.deviceId === 'string').map(normalizeStoredProfile) : [];
  let activeHubProfileId = hubProfiles.some(profile => profile.id === settings.activeHubProfileId)
    ? settings.activeHubProfileId : '';
  // The live connection is the truth: on upgrade (including env-configured Hubs)
  // or when the active id no longer resolves, adopt the profile that matches it,
  // or save it as a new one.
  if (!activeHubProfileId && String(settings.hubUrl || '').trim()) {
    const current = hubProfiles.find(profile => profile.hubUrl === settings.hubUrl
      && profile.secret === (settings.secret || '') && profile.deviceId === settings.deviceId);
    if (current) activeHubProfileId = current.id;
    else {
      const id = randomUUID();
      hubProfiles.push({ id, name: endpoint(settings.hubUrl), hubUrl: settings.hubUrl,
        secret: settings.secret || '', deviceId: settings.deviceId });
      activeHubProfileId = id;
    }
  }
  return { hubProfiles, activeHubProfileId };
}

function hubProfilesForRenderer(settings) {
  return (settings.hubProfiles || []).map(({ id, name, hubUrl, caCertPem, caSummary }) => {
    const visible = { id, name, endpoint: endpoint(hubUrl) };
    if (typeof caCertPem === 'string' && caCertPem.trim()) {
      visible.hasCustomCa = true;
      const summary = sanitizeCaSummary(caSummary);
      if (summary) visible.caSummary = summary;
    }
    return visible;
  });
}

// Resolve commands in main so inactive credentials never cross renderer IPC.
// The resulting connection fields use the normal settings/consent transition.
function prepareHubProfilePatch(settings, input, options = {}) {
  const patch = { ...input };
  delete patch.hubProfiles;
  delete patch.activeHubProfileId;
  delete patch.hubProfileAction;
  delete patch.caCertPem;
  delete patch.caFingerprintSha256;
  delete patch.caSummary;
  const action = input.hubProfileAction;
  const profiles = (settings.hubProfiles || []).map(profile => ({ ...profile }));
  let activeId = settings.activeHubProfileId || '';
  let touched = false;
  let caChanged = false;
  if (action && !['save', 'add', 'select', 'delete'].includes(action.type)) throw new Error('invalid_hub_profile_action');
  if (action?.type === 'select' || action?.type === 'delete') {
    const index = profiles.findIndex(profile => profile.id === action.id);
    if (index < 0) throw new Error('hub_profile_not_found');
    let selected = profiles[index];
    touched = true;
    if (action.type === 'delete') {
      profiles.splice(index, 1);
      if (selected.id !== activeId) selected = null;
      else selected = profiles[0] || { id: '', hubUrl: '', secret: '', deviceId: settings.deviceId };
    }
    if (selected) {
      activeId = selected.id;
      const nextCaFp = selected.caFingerprintSha256 || '';
      caChanged = nextCaFp !== String(settings.caFingerprintSha256 || '');
      Object.assign(patch, {
        hubMode: 'client',
        hubUrl: selected.hubUrl,
        secret: selected.secret,
        deviceId: selected.deviceId,
        caFingerprintSha256: nextCaFp
      });
    }
  } else if (action || ((patch.hubMode ?? settings.hubMode) === 'client'
    && ['hubUrl', 'secret', 'deviceId'].some(key => Object.hasOwn(patch, key)))) {
    const hubUrl = String(patch.hubUrl ?? settings.hubUrl ?? '').trim();
    if (action || hubUrl) {
      touched = true;
      let parsed;
      try { parsed = new URL(hubUrl); } catch (cause) { throw new Error('invalid_hub_url', { cause }); }
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('invalid_hub_url');
      const existing = action?.type === 'add' ? null : profiles.find(profile => profile.id === activeId);
      const caMode = action?.caMode || 'keep';
      if (!['keep', 'replace', 'clear'].includes(caMode)) throw new Error('invalid_ca_mode');
      let nextCa = null;
      if (caMode === 'replace') {
        if (parsed.protocol !== 'https:') throw new Error('ca_requires_https');
        const resolved = typeof options.resolveCaDraft === 'function'
          ? options.resolveCaDraft(action?.caDraftToken)
          : null;
        if (!resolved || typeof resolved.caCertPem !== 'string' || !resolved.caCertPem.trim()
          || typeof resolved.caFingerprintSha256 !== 'string' || !resolved.caFingerprintSha256.trim()) {
          throw new Error('invalid_ca_draft');
        }
        nextCa = {
          caCertPem: resolved.caCertPem.trim(),
          caFingerprintSha256: resolved.caFingerprintSha256.trim().toLowerCase(),
          ...(sanitizeCaSummary(resolved.summary || resolved.caSummary)
            ? { caSummary: sanitizeCaSummary(resolved.summary || resolved.caSummary) }
            : {})
        };
      } else if (caMode === 'keep' && existing?.caCertPem && parsed.protocol === 'https:') {
        nextCa = {
          caCertPem: existing.caCertPem,
          ...(existing.caFingerprintSha256 ? { caFingerprintSha256: existing.caFingerprintSha256 } : {}),
          ...(sanitizeCaSummary(existing.caSummary) ? { caSummary: sanitizeCaSummary(existing.caSummary) } : {})
        };
      }
      const existingOrigin = existing ? originOf(existing.hubUrl) : '';
      const existingCaFp = existing?.caFingerprintSha256 || '';
      const nextCaFp = nextCa?.caFingerprintSha256 || '';
      if (existing && (existingOrigin !== parsed.origin || existingCaFp !== nextCaFp)
        && existing.secret && !Object.hasOwn(input, 'secret')) {
        throw new Error('secret_required_on_trust_change');
      }
      caChanged = nextCaFp !== existingCaFp;
      const secret = action?.type === 'add'
        ? String(patch.secret ?? '')
        : String(Object.hasOwn(patch, 'secret') ? (patch.secret ?? '') : (existing?.secret ?? settings.secret ?? ''));
      const profile = { id: existing?.id || randomUUID(),
        name: String(action?.name ?? existing?.name ?? parsed.host).trim().slice(0, 120) || parsed.host,
        hubUrl, secret,
        deviceId: String(patch.deviceId ?? settings.deviceId).trim() || settings.deviceId,
        ...(nextCa || {}) };
      if (existing) profiles[profiles.indexOf(existing)] = profile;
      else profiles.push(profile);
      activeId = profile.id;
      Object.assign(patch, {
        hubUrl,
        secret: profile.secret,
        deviceId: profile.deviceId,
        caFingerprintSha256: nextCaFp
      });
    }
  } else if (patch.hubMode === 'client' && settings.hubMode !== 'client') {
    // Another mode may have changed the shared Device ID; returning to client
    // mode reconnects as the active Hub's own saved identity.
    const active = profiles.find(profile => profile.id === activeId);
    if (active) {
      touched = true;
      const nextCaFp = active.caFingerprintSha256 || '';
      caChanged = nextCaFp !== String(settings.caFingerprintSha256 || '');
      Object.assign(patch, {
        hubUrl: active.hubUrl,
        secret: active.secret,
        deviceId: active.deviceId,
        caFingerprintSha256: nextCaFp
      });
    }
  }
  // lastPostedDeviceId names a device on the previous destination (the hosted
  // Hub in host mode, the connected Hub in client mode); cleaning it up on a
  // different one could delete an unrelated device there.
  const hubBase = value => {
    const text = String(value || '').trim();
    try {
      const url = new URL(text);
      return `${url.origin}${url.pathname.replace(/\/$/, '')}`;
    } catch (_) { return text.replace(/\/$/, ''); }
  };
  if ((patch.hubMode !== undefined && patch.hubMode !== settings.hubMode)
    || (touched && (hubBase(patch.hubUrl ?? settings.hubUrl) !== hubBase(settings.hubUrl) || caChanged))) {
    patch.lastPostedDeviceId = '';
  }
  // Untouched patches stay as sent: some settings commands (plugin skins) must
  // arrive as standalone patches.
  if (!touched) return patch;
  return { ...patch, hubProfiles: profiles, activeHubProfileId: activeId };
}

module.exports = {
  activeHubProfile,
  initializeHubProfiles,
  hubProfilesForRenderer,
  prepareHubProfilePatch,
  sanitizeCaSummary
};
