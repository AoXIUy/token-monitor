'use strict';

const APPROVAL_ALERT_BASE = '/api/approval-alerts';
const APPROVAL_CLIENTS = new Set(['codex', 'antigravity']);

const MAX_APPROVAL_BODY_BYTES = 16 * 1024;
const MAX_APPROVAL_IPC_BYTES = 64 * 1024;
const MAX_APPROVAL_STDIN_BYTES = 1024 * 1024;
const APPROVAL_ALERT_TTL_MS = 2 * 60 * 1000;
const MAX_APPROVAL_ALERTS_GLOBAL = 32;
const MAX_APPROVAL_ALERTS_PER_DEVICE = 8;

const LIMITS = {
  deviceId: 256,
  sessionId: 256,
  tool: 128,
  command: 4000,
  description: 500,
  project: 160
};

function truncateCodePoints(value, max) {
  const chars = Array.from(value);
  return chars.length <= max ? value : chars.slice(0, max).join('');
}

function cleanSingleLine(value, max) {
  if (typeof value !== 'string') return '';
  const cleaned = value.replace(/[\x00-\x1f\x7f]+/g, ' ').trim();
  return truncateCodePoints(cleaned, max);
}

function cleanMultiline(value, max) {
  if (typeof value !== 'string') return '';
  const normalized = value.replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
  return truncateCodePoints(normalized, max);
}

// Ephemeral alert wire surface. Never add to DeviceRecord, stats, SSE or disk.
function approvalAlertInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_request');
  const deviceId = cleanSingleLine(value.deviceId, LIMITS.deviceId);
  const client = typeof value.client === 'string' ? value.client.trim() : '';
  const sessionId = cleanSingleLine(value.sessionId, LIMITS.sessionId);
  const tool = cleanSingleLine(value.tool, LIMITS.tool);
  if (!deviceId || !APPROVAL_CLIENTS.has(client) || !sessionId || !tool) {
    throw new Error('invalid_request');
  }
  const command = cleanMultiline(value.command, LIMITS.command);
  const description = cleanSingleLine(value.description, LIMITS.description);
  const projectLabel = cleanSingleLine(value.projectLabel, LIMITS.project);
  return { deviceId, client, sessionId, tool, command, description, projectLabel };
}

function hookFallbackOutput(client) {
  if (client === 'antigravity') {
    return JSON.stringify({ decision: 'ask' });
  }
  return '';
}

module.exports = {
  APPROVAL_ALERT_BASE,
  APPROVAL_ALERT_TTL_MS,
  APPROVAL_CLIENTS,
  LIMITS,
  MAX_APPROVAL_ALERTS_GLOBAL,
  MAX_APPROVAL_ALERTS_PER_DEVICE,
  MAX_APPROVAL_BODY_BYTES,
  MAX_APPROVAL_IPC_BYTES,
  MAX_APPROVAL_STDIN_BYTES,
  approvalAlertInput,
  cleanMultiline,
  cleanSingleLine,
  hookFallbackOutput
};
