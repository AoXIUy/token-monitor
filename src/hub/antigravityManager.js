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
 * @param {{ dataFile?: string, now?: () => number, logger?: { warn?: Function, error?: Function } }} [options]
 */
function createAntigravityManagerStore({ dataFile = '', now = Date.now, logger = console } = {}) {
  const persistFile = typeof dataFile === 'string' && dataFile.trim()
    ? path.join(path.dirname(dataFile), 'antigravity-manager-snapshots.json')
    : '';

  /** @type {Map<string, { snapshot: ReturnType<typeof sanitizeAntigravityManagerSnapshot>, receivedAt: number }>} */
  const snapshots = new Map();
  let updatedAt = '';
  let lastReceivedAt = 0;

  /**
   * Monotonic server-assigned arrival timestamp in ms (immune to client-forged `updatedAt`).
   * @param {number} [candidate]
   * @returns {number}
   */
  function nextServerReceivedAt(candidate) {
    const base = typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0
      ? Math.floor(candidate)
      : now();
    const next = base > lastReceivedAt ? base : lastReceivedAt + 1;
    lastReceivedAt = next;
    return next;
  }

  function loadInitial() {
    if (!persistFile) return;
    const saved = readJson(persistFile, null);
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return;
    const list = Array.isArray(saved.devices) ? saved.devices : [];
    for (const raw of list) {
      if (snapshots.size >= MAX_AG_MANAGER_DEVICES) break;
      try {
        const clean = sanitizeAntigravityManagerSnapshot(raw);
        const rawReceived = typeof raw?.receivedAt === 'number' && Number.isFinite(raw.receivedAt)
          ? raw.receivedAt
          : (typeof raw?.receivedAt === 'string' ? Date.parse(raw.receivedAt) : NaN);
        const receivedAt = nextServerReceivedAt(Number.isFinite(rawReceived) ? rawReceived : undefined);
        snapshots.set(clean.deviceId, { snapshot: clean, receivedAt });
      } catch (_) {}
    }
    if (typeof saved.updatedAt === 'string') updatedAt = saved.updatedAt;
  }

  function persistOrThrow() {
    if (!persistFile) return;
    writeJsonAtomic(persistFile, {
      version: 1,
      updatedAt,
      devices: Array.from(snapshots.values()).map(({ snapshot, receivedAt }) => ({
        ...snapshot,
        receivedAt
      }))
    });
  }

  /** @param {string} incomingDeviceId */
  function evictOldestIfNeeded(incomingDeviceId) {
    if (snapshots.has(incomingDeviceId)) return;
    while (snapshots.size >= MAX_AG_MANAGER_DEVICES) {
      let oldestId = '';
      let oldestTime = Infinity;
      for (const [id, entry] of snapshots) {
        if (entry.receivedAt < oldestTime) {
          oldestTime = entry.receivedAt;
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
    const previousLastReceivedAt = lastReceivedAt;
    evictOldestIfNeeded(clean.deviceId);
    const receivedAt = nextServerReceivedAt();
    snapshots.set(clean.deviceId, { snapshot: clean, receivedAt });
    updatedAt = new Date(now()).toISOString();
    try {
      persistOrThrow();
    } catch (error) {
      snapshots.clear();
      for (const [id, entry] of previousEntries) snapshots.set(id, entry);
      updatedAt = previousUpdatedAt;
      lastReceivedAt = previousLastReceivedAt;
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
      .sort((a, b) => b.receivedAt - a.receivedAt)
      .map(({ snapshot }) => structuredClone(snapshot));
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
