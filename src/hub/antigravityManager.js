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

  function persistOrThrow() {
    if (!persistFile) return;
    writeJsonAtomic(persistFile, {
      version: 1,
      updatedAt,
      devices: Array.from(snapshots.values())
    });
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
    const previousEntries = Array.from(snapshots.entries());
    const previousUpdatedAt = updatedAt;
    evictOldestIfNeeded(clean.deviceId);
    snapshots.set(clean.deviceId, clean);
    updatedAt = new Date().toISOString();
    try {
      persistOrThrow();
    } catch (error) {
      snapshots.clear();
      for (const [id, entry] of previousEntries) snapshots.set(id, entry);
      updatedAt = previousUpdatedAt;
      (logger.warn || console.warn)(`[antigravity-manager-hub] failed to save snapshots: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
    return {
      ok: true,
      deviceId: clean.deviceId,
      accountCount: clean.accounts.length,
      updatedAt
    };
  }

  function getSnapshots() {
    const devices = Array.from(snapshots.values())
      .sort((a, b) => {
        const ta = Date.parse(a.updatedAt) || 0;
        const tb = Date.parse(b.updatedAt) || 0;
        return tb - ta;
      })
      .map((entry) => structuredClone(entry));
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
    const previousEntry = snapshots.get(key);
    const previousUpdatedAt = updatedAt;
    snapshots.delete(key);
    updatedAt = new Date().toISOString();
    try {
      persistOrThrow();
    } catch (error) {
      if (previousEntry) snapshots.set(key, previousEntry);
      updatedAt = previousUpdatedAt;
      (logger.warn || console.warn)(`[antigravity-manager-hub] failed to save snapshots after device removal: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
    return true;
  }

  function clear() {
    if (snapshots.size === 0) return;
    const previousEntries = Array.from(snapshots.entries());
    const previousUpdatedAt = updatedAt;
    snapshots.clear();
    updatedAt = '';
    try {
      persistOrThrow();
    } catch (error) {
      for (const [id, entry] of previousEntries) snapshots.set(id, entry);
      updatedAt = previousUpdatedAt;
      (logger.warn || console.warn)(`[antigravity-manager-hub] failed to clear snapshots: ${error instanceof Error ? error.message : String(error)}`);
    }
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
