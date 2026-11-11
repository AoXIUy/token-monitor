'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { resolveSessionFile } = require('./sessionFiles');
const { antigravityDataRoots } = require('./providers/antigravity/selfSync');
const { antigravityCliDataDir } = require('./clientSources');
const { isCompressedCodexTranscript, readCompressedCodexTranscript } = require('./providers/codex/transcript');
const { conversationQuery, MAX_CONVERSATION_BYTES, MAX_MESSAGE_TEXT } = require('./sessionConversationProtocol');

const MAX_FILE_BYTES = 64 * 1024 * 1024;

function textContent(value) {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.map((part) => {
    if (typeof part === 'string') return part;
    if (!part || typeof part !== 'object') return '';
    if (typeof part.text === 'string') return part.text;
    if (['input_image', 'image', 'image_url'].includes(part.type)) return '[图片附件]';
    return '';
  }).filter(Boolean).join('\n');
}

function printable(value) {
  return typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value, null, 2);
}

function parseCodexConversation(records) {
  const messages = [];
  const last = new Map();
  let turnId = '';
  function push(record, role, text, kind, origin) {
    if (!text.trim()) return;
    if (role === 'assistant') last.delete('user');
    const previous = last.get(role);
    // Native UI events and model-history items can describe the same message.
    // Deduplicate only across those two representations, within the same turn.
    const sameText = previous && previous.text.replace(/\n?\[图片附件\]/g, '') === text.replace(/\n?\[图片附件\]/g, '');
    if (previous && previous.turnId === turnId && sameText && previous.origin !== origin
      && ['event', 'message'].includes(origin) && ['event', 'message'].includes(previous.origin)) {
      if (origin === 'message') messages[previous.index].text = text;
      previous.origin = 'message';
      return;
    }
    const message = { id: String(messages.length), role, text, kind,
      timestamp: typeof record.timestamp === 'string' ? record.timestamp.slice(0, 40) : '' };
    messages.push(message);
    last.set(role, { text, turnId, origin, index: messages.length - 1 });
  }
  for (const record of records) {
    const payload = record.payload || {};
    if (record.type === 'turn_context' || (record.type === 'event_msg' && payload.type === 'task_started')) {
      if (payload.turn_id && payload.turn_id !== turnId) { turnId = payload.turn_id; last.clear(); }
    }
    if (record.type === 'response_item') {
      if (payload.type === 'message') {
        const role = ['user', 'assistant'].includes(payload.role) ? payload.role : 'system';
        push(record, role, textContent(payload.content), role === 'system' ? 'context' : 'message', 'message');
      } else if (['function_call', 'custom_tool_call', 'local_shell_call'].includes(payload.type)) {
        push(record, 'tool', printable(payload.arguments ?? payload.input ?? payload.action), String(payload.name || 'tool_call').slice(0, 80), 'tool');
      } else if (['function_call_output', 'custom_tool_call_output'].includes(payload.type)) {
        push(record, 'tool', printable(payload.output), 'tool_result', 'tool');
      } else if (payload.type === 'reasoning') {
        // Only persisted readable summaries; encrypted reasoning is never decoded.
        push(record, 'assistant', textContent(payload.summary), 'reasoning_summary', 'summary');
      }
    } else if (record.type === 'event_msg') {
      if (['task_complete', 'turn_aborted'].includes(payload.type)) last.clear();
      if (['user_message', 'agent_message'].includes(payload.type)) {
        push(record, payload.type === 'user_message' ? 'user' : 'assistant', textContent(payload.message ?? payload.text), 'message', 'event');
      } else if (payload.type === 'item_completed' && payload.item) {
        const item = payload.item;
        if (['agentMessage', 'agent_message', 'userMessage', 'user_message'].includes(item.type)) {
          push(record, item.type.startsWith('user') ? 'user' : 'assistant', textContent(item.text ?? item.content), 'message', 'event');
        } else if (['commandExecution', 'command_execution'].includes(item.type)) {
          push(record, 'tool', [printable(item.command), printable(item.aggregatedOutput ?? item.aggregated_output)].filter(Boolean).join('\n'), 'command', 'tool');
        } else if (['fileChange', 'file_change'].includes(item.type)) {
          push(record, 'tool', printable(item.changes), 'file_change', 'tool');
        } else if (['mcpToolCall', 'mcp_tool_call'].includes(item.type)) {
          push(record, 'tool', [printable(item.arguments), printable(item.result ?? item.error)].filter(Boolean).join('\n'), String(item.tool || 'mcp_tool').slice(0, 80), 'tool');
        }
      }
    } else if (record.type === 'compacted') {
      push(record, 'system', textContent(payload.message), 'compaction', 'context');
    }
  }
  return messages;
}

function antigravityUserInput(content) {
  const match = /^\s*<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>([\s\S]*)$/.exec(content);
  if (!match) return null;
  let remaining = match[2].trim();
  if (!remaining) return null;
  // Recognize the export envelope, not arbitrary XML in a user's message.
  // Unknown/partial suffixes retain the original text instead of losing data.
  while (remaining) {
    const opening = /^<(ADDITIONAL_METADATA|USER_SETTINGS_CHANGE)>/.exec(remaining);
    if (!opening) return null;
    const closing = `</${opening[1]}>`;
    const end = remaining.indexOf(closing, opening[0].length);
    if (end < 0) return null;
    remaining = remaining.slice(end + closing.length).trimStart();
  }
  return {
    request: match[1].replace(/^\r?\n/, '').replace(/\r?\n$/, ''),
    context: match[2].trim()
  };
}

function parseAntigravityConversation(records) {
  const steps = new Map();
  for (const row of records) if (Number.isSafeInteger(row.step_index) && row.step_index >= 0) steps.set(row.step_index, row);
  const messages = [];
  for (const [index, row] of [...steps].sort(([a], [b]) => a - b)) {
    const role = row.type === 'USER_INPUT' ? 'user' : row.type === 'PLANNER_RESPONSE' || row.source === 'MODEL' ? 'assistant'
      : row.source === 'TOOL' ? 'tool' : 'system';
    const timestamp = typeof row.created_at === 'string' ? row.created_at.slice(0, 40) : '';
    const add = (text, kind, messageRole = role) => {
      if (text.trim()) messages.push({ id: `${index}.${messages.length}`, role: messageRole, text, timestamp, kind });
    };
    const content = textContent(row.content);
    const userInput = row.type === 'USER_INPUT' ? antigravityUserInput(content) : null;
    if (userInput) {
      add(userInput.request, 'message', 'user');
      add(userInput.context, 'context', 'system');
    } else {
      add(content, row.type === 'USER_INPUT' || row.type === 'PLANNER_RESPONSE' ? 'message' : String(row.type || 'event').slice(0, 80));
    }
    add(textContent(row.thinking), 'reasoning_summary', 'assistant');
    if (Array.isArray(row.tool_calls)) for (const call of row.tool_calls) {
      if (!call || typeof call !== 'object') continue;
      const name = String(call.name || call.function?.name || 'tool_call').slice(0, 80);
      add(printable(call.arguments ?? call.input ?? call.function?.arguments) || name, name, 'tool');
    }
  }
  return messages;
}

function inside(root, file) {
  const relative = path.relative(fs.realpathSync(root), fs.realpathSync(file));
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function antigravityRoots(home, env) {
  const roots = [env.ANTIGRAVITY_HOME, env.ANTIGRAVITY_DATA_DIR, ...antigravityDataRoots(home),
    path.dirname(antigravityCliDataDir({ homeDir: home, env }))].filter(Boolean);
  // CC Switch launches API-key profiles in their own --gemini_dir.
  const profiles = path.join(home, '.cc-switch', 'agy');
  try {
    for (const entry of fs.readdirSync(profiles, { withFileTypes: true }).slice(0, 256)) {
      if (entry.isDirectory()) roots.push(path.join(profiles, entry.name, 'antigravity-cli'));
    }
  } catch (_) { /* Optional profile root. */ }
  return [...new Set(roots)];
}

function sourceFile(client, sessionId, home, env) {
  if (client === 'antigravity') {
    for (const root of antigravityRoots(home, env)) {
      const file = path.join(root, 'brain', sessionId, '.system_generated', 'logs', 'transcript_full.jsonl');
      try { if (fs.statSync(file).isFile() && inside(root, file)) return file; } catch (_) {}
    }
    return '';
  }
  const root = env.CODEX_HOME || path.join(home, '.codex');
  const file = resolveSessionFile('codex', sessionId, home, { env });
  if (file && inside(root, file)) return file;
  // Dots/native thread identities can be bare UUIDs rather than rollout names.
  if (!/^[a-f0-9-]{36}$/i.test(sessionId)) return '';
  const { discoverDbPaths } = require('./providers/codex/sessionMetadata');
  const { resolveSqlite, openDb } = require('./sqliteReadOnly');
  const sqlite = resolveSqlite({});
  if (!sqlite) return '';
  for (const dbPath of discoverDbPaths({ homeDir: home, env })) {
    let db;
    try {
      db = openDb(dbPath, sqlite);
      const row = db.prepare('SELECT rollout_path FROM threads WHERE id = ?').get(sessionId);
      if (!row?.rollout_path) continue;
      const candidate = path.isAbsolute(row.rollout_path) ? row.rollout_path : path.join(root, row.rollout_path);
      if (inside(root, candidate)) return candidate;
    } catch (_) {} finally { db?.close(); }
  }
  return '';
}

function readBytes(file) {
  if (isCompressedCodexTranscript(file)) return readCompressedCodexTranscript(file);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error('file_too_large');
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const read = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (!read) break;
      offset += read;
    }
    return bytes.subarray(0, offset);
  } finally { fs.closeSync(fd); }
}

function pageOf(messages, revision, cursor, incomplete) {
  if (cursor && cursor.split(':')[0] !== revision) return { error: 'source_changed' };
  const offset = cursor ? Number(cursor.split(':')[1]) : 0;
  const page = [];
  let index = 0;
  let bytes = 1024;
  for (const message of messages) {
    for (let start = 0, part = 0; start < message.text.length; part++) {
      let end = Math.min(message.text.length, start + MAX_MESSAGE_TEXT);
      // Keep Unicode surrogate pairs together across page boundaries.
      if (end < message.text.length && /[\uD800-\uDBFF]/.test(message.text[end - 1])) end--;
      const item = { ...message, id: `${message.id}.${part}`, text: message.text.slice(start, end), continued: part > 0 };
      start = end;
      if (index++ < offset) continue;
      const size = Buffer.byteLength(JSON.stringify(item)) + 1;
      if (page.length >= 40 || bytes + size > MAX_CONVERSATION_BYTES - 1024) {
        return { messages: page, revision, nextCursor: `${revision}:${index - 1}`, incomplete };
      }
      bytes += size;
      page.push(item);
    }
  }
  if (offset > index) return { error: 'invalid_request' };
  return { messages: page, revision, nextCursor: '', incomplete };
}

function readSessionConversation(query, { home = os.homedir(), env = process.env } = {}) {
  let input;
  try { input = conversationQuery(query); } catch (_) { return { error: 'invalid_request' }; }
  const split = input.key.indexOf(':');
  const client = input.key.slice(0, split);
  const sessionId = input.key.slice(split + 1);
  try {
    const file = sourceFile(client, sessionId, home, env);
    if (!file) return { error: 'source_unavailable' };
    const bytes = readBytes(file);
    const hash = createHash('sha256');
    // Separating user input from metadata changes fragment offsets even when
    // the file is unchanged. Old cursors must request a fresh first page.
    if (client === 'antigravity') hash.update('antigravity-user-request-v1\0');
    const revision = hash.update(bytes).digest('hex').slice(0, 24);
    const lines = bytes.toString('utf8').split(/\r?\n/);
    const records = [];
    let incomplete = false;
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line);
        if (record && typeof record === 'object' && !Array.isArray(record)) records.push(record);
        else incomplete = true;
      } catch (_) { incomplete = true; }
    }
    if (client === 'codex') {
      const header = records[0];
      if (header?.type !== 'session_meta' || !header.payload?.id
        || (/^[a-f0-9-]{36}$/i.test(sessionId) && header.payload.id !== sessionId)) return { error: 'source_unavailable' };
    }
    return pageOf(client === 'codex' ? parseCodexConversation(records) : parseAntigravityConversation(records), revision, input.cursor, incomplete);
  } catch (error) {
    return { error: error.message === 'file_too_large' ? 'file_too_large' : 'read_failed' };
  }
}

module.exports = { readSessionConversation, parseCodexConversation, parseAntigravityConversation };
