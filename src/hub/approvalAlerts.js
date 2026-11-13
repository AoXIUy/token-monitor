'use strict';

const { randomUUID } = require('node:crypto');
const {
  APPROVAL_ALERT_TTL_MS,
  MAX_APPROVAL_ALERTS_GLOBAL,
  MAX_APPROVAL_ALERTS_PER_DEVICE,
  approvalAlertInput,
  cleanSingleLine
} = require('../shared/approvalProtocol');

function createApprovalAlertStore({
  enabled = false,
  getDevice = () => null,
  now = Date.now,
  ttlMs = APPROVAL_ALERT_TTL_MS
} = {}) {
  const items = new Map();

  function prune(t = now()) {
    for (const [id, item] of items) {
      if (t >= item.expiresAt) items.delete(id);
    }
  }

  function evictOldest(predicate = null) {
    for (const [id, item] of items) {
      if (!predicate || predicate(item)) {
        items.delete(id);
        return true;
      }
    }
    return false;
  }

  function list() {
    if (!enabled) return { error: 'disabled' };
    const t = now();
    prune(t);
    const alerts = [];
    for (const item of items.values()) {
      const device = getDevice(item.deviceId);
      const deviceName = cleanSingleLine(device?.hostname || device?.deviceName || item.deviceId, 128) || item.deviceId;
      alerts.push({
        id: item.id,
        deviceId: item.deviceId,
        deviceName,
        client: item.client,
        sessionId: item.sessionId,
        tool: item.tool,
        command: item.command,
        description: item.description,
        projectLabel: item.projectLabel,
        createdAt: item.createdAt,
        expiresAt: item.expiresAt
      });
    }
    alerts.sort((a, b) => a.createdAt - b.createdAt);
    return { ok: true, alerts };
  }

  function create(value) {
    if (!enabled) return { error: 'disabled' };
    let parsed;
    try { parsed = approvalAlertInput(value); } catch (_) { return { error: 'invalid_request' }; }
    const t = now();
    prune(t);

    let perDevice = 0;
    for (const item of items.values()) {
      if (item.deviceId === parsed.deviceId) perDevice += 1;
    }
    while (perDevice >= MAX_APPROVAL_ALERTS_PER_DEVICE) {
      if (!evictOldest((item) => item.deviceId === parsed.deviceId)) break;
      perDevice -= 1;
    }
    while (items.size >= MAX_APPROVAL_ALERTS_GLOBAL) {
      if (!evictOldest()) break;
    }

    const id = randomUUID();
    const expiresAt = t + ttlMs;
    items.set(id, { id, ...parsed, createdAt: t, expiresAt });
    return { ok: true, id, expiresAt };
  }

  function remove(deviceId) {
    for (const [id, item] of items) {
      if (item.deviceId === deviceId) items.delete(id);
    }
  }

  function stop() {
    items.clear();
  }

  function setEnabled(value) {
    enabled = value === true;
    if (!enabled) items.clear();
  }

  return {
    create,
    list,
    remove,
    setEnabled,
    stop
  };
}

module.exports = { createApprovalAlertStore };
