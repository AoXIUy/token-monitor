'use strict';

const { randomUUID } = require('node:crypto');
const {
  APPROVAL_ALERT_TTL_MS,
  MAX_APPROVAL_ALERTS_GLOBAL,
  MAX_APPROVAL_ALERTS_PER_DEVICE,
  approvalAlertInput,
  cleanSingleLine
} = require('../shared/approvalProtocol');

const APPROVAL_WEBHOOK_WINDOW_MS = 60_000;
const MAX_APPROVAL_WEBHOOKS_PER_DEVICE = 5;
const MAX_APPROVAL_WEBHOOKS_GLOBAL = 20;
const MAX_APPROVAL_DEVICES = 128;
const PROTOTYPE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function createApprovalAlertStore({
  enabled = false,
  getDevice = () => null,
  now = Date.now,
  ttlMs = APPROVAL_ALERT_TTL_MS,
  webhookWindowMs = APPROVAL_WEBHOOK_WINDOW_MS,
  maxWebhooksPerDevice = MAX_APPROVAL_WEBHOOKS_PER_DEVICE,
  maxWebhooksGlobal = MAX_APPROVAL_WEBHOOKS_GLOBAL,
  maxDevices = MAX_APPROVAL_DEVICES
} = {}) {
  const items = new Map();
  const webhookByDevice = new Map();
  let webhookGlobal = [];

  function prune(t = now()) {
    for (const [id, item] of items) {
      if (t >= item.expiresAt) items.delete(id);
    }
  }

  function consumeWebhookQuota(deviceId, t = now()) {
    const cutoff = t - webhookWindowMs;
    webhookGlobal = webhookGlobal.filter((ts) => ts > cutoff);
    if (webhookGlobal.length >= maxWebhooksGlobal) {
      return false;
    }
    const key = String(deviceId || '').trim();
    if (!key || PROTOTYPE_KEYS.has(key)) return false;
    const prev = webhookByDevice.get(key) || [];
    const recent = prev.filter((ts) => ts > cutoff);
    if (recent.length >= maxWebhooksPerDevice) {
      webhookByDevice.set(key, recent);
      return false;
    }
    recent.push(t);
    webhookByDevice.set(key, recent);
    webhookGlobal.push(t);
    if (webhookByDevice.size > maxDevices * 2) {
      for (const [dev, list] of webhookByDevice) {
        const active = list.filter((ts) => ts > cutoff);
        if (active.length === 0) webhookByDevice.delete(dev);
        else webhookByDevice.set(dev, active);
      }
    }
    return true;
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
    if (!parsed.deviceId || PROTOTYPE_KEYS.has(parsed.deviceId) || PROTOTYPE_KEYS.has(parsed.deviceId.toLowerCase())) {
      return { error: 'invalid_request' };
    }
    const t = now();
    prune(t);

    const distinctDevices = new Set();
    let perDevice = 0;
    for (const item of items.values()) {
      distinctDevices.add(item.deviceId);
      if (item.deviceId === parsed.deviceId) perDevice += 1;
    }
    if (!distinctDevices.has(parsed.deviceId) && distinctDevices.size >= maxDevices) {
      evictOldest();
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
    const webhookAllowed = consumeWebhookQuota(parsed.deviceId, t);
    return { ok: true, id, expiresAt, webhookAllowed };
  }

  function remove(deviceId) {
    for (const [id, item] of items) {
      if (item.deviceId === deviceId) items.delete(id);
    }
    webhookByDevice.delete(deviceId);
  }

  function stop() {
    items.clear();
    webhookByDevice.clear();
    webhookGlobal = [];
  }

  function setEnabled(value) {
    enabled = value === true;
    if (!enabled) {
      items.clear();
      webhookByDevice.clear();
      webhookGlobal = [];
    }
  }

  return {
    consumeWebhookQuota,
    create,
    list,
    remove,
    setEnabled,
    stop
  };
}

module.exports = {
  APPROVAL_WEBHOOK_WINDOW_MS,
  MAX_APPROVAL_DEVICES,
  MAX_APPROVAL_WEBHOOKS_GLOBAL,
  MAX_APPROVAL_WEBHOOKS_PER_DEVICE,
  createApprovalAlertStore
};
