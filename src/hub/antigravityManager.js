// @ts-check
'use strict';

const path = require('node:path');
const { readJson, writeJsonAtomic } = require('../shared/config');
const {
  MAX_AG_MANAGER_DEVICES,
  sanitizeAntigravityManagerSnapshot
} = require('../shared/antigravityManagerProtocol');

/**
 * Node-Hub-only store for sanitized Antigravity Manager snapshots.
 * Stores zero credentials and never touches DeviceRecord, Worker, or public stats.
 *
 * @param {{ dataFile?: string, logger?: { warn?: Function, error?: Function } }} [options]
 */
function createAntigravityManagerStore({ dataFile = '', logger = console } = {}) {
  const persistFile = typeof dataFile === 'string' && dataFile.trim()
    ? path.join(path.dirname(dataFile), 'antigravity-manager-snapshots.json')
    : '';

  /** @type {Map<string, ReturnType<typeof sanitizeAntigravityManagerSnapshot>>} */
  const snapshots = new Map();
  let updatedAt = '';

  function loadInitial() {
    if (!persistFile) return;
    const saved = readJson(persistFile, null);
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return;
    const list = Array.isArray(saved.devices) ? saved.devices : [];
    for (const raw of list) {
      if (snapshots.size >= MAX_AG_MANAGER_DEVICES) break;
      try {
        const clean = sanitizeAntigravityManagerSnapshot(raw);
        snapshots.set(clean.deviceId, clean);
      } catch (_) {}
    }
    if (typeof saved.updatedAt === 'string') updatedAt = saved.updatedAt;
  }

  function persist() {
    if (!persistFile) return;
    try {
      writeJsonAtomic(persistFile, {
        version: 1,
        updatedAt,
        devices: Array.from(snapshots.values())
      });
    } catch (error) {
      (logger.warn || console.warn)(`[antigravity-manager-hub] failed to save snapshots: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** @param {string} incomingDeviceId */
  function evictOldestIfNeeded(incomingDeviceId) {
    if (snapshots.has(incomingDeviceId)) return;
    while (snapshots.size >= MAX_AG_MANAGER_DEVICES) {
      let oldestId = '';
      let oldestTime = Infinity;
      for (const [id, entry] of snapshots) {
        const ts = Date.parse(entry.updatedAt) || 0;
        if (ts < oldestTime) {
          oldestTime = ts;
          oldestId = id;
        }
      }
      if (!oldestId) {
        const first = snapshots.keys().next().value;
        if (first) snapshots.delete(first);
        else break;
      } else {
        snapshots.delete(oldestId);
      }
    }
  }

  /**
   * @param {unknown} raw
   */
  function putSnapshot(raw) {
    const clean = sanitizeAntigravityManagerSnapshot(raw);
    evictOldestIfNeeded(clean.deviceId);
    snapshots.set(clean.deviceId, clean);
    updatedAt = new Date().toISOString();
    persist();
    return { ok: true, updatedAt, deviceId: clean.deviceId };
  }

  function getSnapshots() {
    const devices = Array.from(snapshots.values()).sort((a, b) => {
      const ta = Date.parse(a.updatedAt) || 0;
      const tb = Date.parse(b.updatedAt) || 0;
      return tb - ta;
    });
    return {
      ok: true,
      version: 1,
      updatedAt,
      devices
    };
  }

  /**
   * @param {string} deviceId
   */
  function removeDevice(deviceId) {
    const key = String(deviceId || '').trim();
    if (!key || !snapshots.has(key)) return false;
    snapshots.delete(key);
    updatedAt = new Date().toISOString();
    persist();
    return true;
  }

  function clear() {
    if (snapshots.size === 0) return;
    snapshots.clear();
    updatedAt = '';
    persist();
  }

  loadInitial();

  return {
    putSnapshot,
    getSnapshots,
    removeDevice,
    clear
  };
}

module.exports = { createAntigravityManagerStore };
