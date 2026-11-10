'use strict';

const CONVERSATION_BASE = '/api/session-conversations';
const MAX_CONVERSATION_BYTES = 384 * 1024;
const MAX_MESSAGE_TEXT = 12000;
const CONVERSATION_ERRORS = new Set([
  'device_offline', 'reader_busy', 'not_found', 'unsupported_client', 'invalid_request',
  'source_unavailable', 'source_changed', 'file_too_large', 'read_failed', 'query_timeout', 'disabled'
]);

function conversationQuery(value) {
  if (!value || typeof value !== 'object') throw new Error('invalid_request');
  const { deviceId, key, cursor = '' } = value;
  if (typeof deviceId !== 'string' || !deviceId || deviceId.length > 256
    || typeof key !== 'string' || key.length > 512
    || !/^(codex|antigravity):[^\s\\/\x00-\x1f]+$/.test(key)
    || ['.', '..'].includes(key.slice(key.indexOf(':') + 1))
    || typeof cursor !== 'string' || (cursor !== '' && !/^[a-f0-9]{24}:[0-9]{1,7}$/.test(cursor))) {
    throw new Error('invalid_request');
  }
  return { deviceId, key, cursor };
}

// This is a separate, ephemeral wire surface. Never add it to DeviceRecord.
function conversationPage(value) {
  if (!value || typeof value !== 'object') throw new Error('invalid_request');
  if (value.error) return { error: CONVERSATION_ERRORS.has(value.error) ? value.error : 'read_failed' };
  if (!Array.isArray(value.messages) || value.messages.length > 40
    || typeof value.revision !== 'string' || !/^[a-f0-9]{24}$/.test(value.revision)
    || typeof value.nextCursor !== 'string'
    || (value.nextCursor && (!/^[a-f0-9]{24}:[0-9]{1,7}$/.test(value.nextCursor)
      || value.nextCursor.split(':')[0] !== value.revision))) throw new Error('invalid_request');
  const messages = value.messages.map((message) => {
    if (!message || !['user', 'assistant', 'tool', 'system'].includes(message.role)
      || typeof message.id !== 'string' || message.id.length > 100
      || typeof message.text !== 'string' || message.text.length > MAX_MESSAGE_TEXT
      || typeof message.timestamp !== 'string' || message.timestamp.length > 40
      || typeof message.kind !== 'string' || message.kind.length > 80) throw new Error('invalid_request');
    return { id: message.id, role: message.role, text: message.text, timestamp: message.timestamp,
      kind: message.kind, continued: message.continued === true };
  });
  const page = { messages, revision: value.revision, nextCursor: value.nextCursor, incomplete: value.incomplete === true };
  if (Buffer.byteLength(JSON.stringify(page)) > MAX_CONVERSATION_BYTES) throw new Error('invalid_request');
  return page;
}

module.exports = { CONVERSATION_BASE, MAX_CONVERSATION_BYTES, MAX_MESSAGE_TEXT, conversationQuery, conversationPage };
