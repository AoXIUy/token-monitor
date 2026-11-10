'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { parseCodexConversation, parseAntigravityConversation, readSessionConversation } = require('../../src/shared/sessionConversation');
const { conversationQuery, conversationPage } = require('../../src/shared/sessionConversationProtocol');
const { readConversationInWorker } = require('../../src/shared/sessionConversationClient');

function home(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-conversation-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function write(file, records) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, records.map(record => JSON.stringify(record)).join('\n') + '\n');
}
function record(type, payload) { return { type, payload, timestamp: '2026-11-11T00:00:00Z' }; }
const query = (key, cursor = '') => ({ deviceId: 'pc', key, cursor });

test('Codex preserves full text, context, tool input/results and only readable reasoning summaries', () => {
  const records = [record('event_msg', { type: 'user_message', message: 'repeat' }),
    record('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'repeat' }] }),
    record('response_item', { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'context' }] }),
    record('response_item', { type: 'function_call', name: 'exec_command', arguments: '{"cmd":"pwd"}' }),
    record('response_item', { type: 'function_call_output', output: '/work' }),
    record('response_item', { type: 'reasoning', encrypted_content: 'private-opaque', summary: [{ text: 'Recorded summary' }] }),
    record('response_item', { type: 'message', role: 'assistant', content: [{ text: 'done' }] }),
    record('event_msg', { type: 'agent_message', message: 'done' }),
    record('event_msg', { type: 'task_complete' }),
    record('event_msg', { type: 'user_message', message: 'repeat' }),
    record('response_item', { type: 'message', role: 'user', content: [{ text: 'repeat' }, { type: 'input_image', image_url: 'data:private' }] })];
  const messages = parseCodexConversation(records);
  assert.equal(messages.filter(message => message.text === 'done').length, 1);
  assert.equal(messages.filter(message => message.role === 'user').length, 2);
  assert.ok(messages.some(message => message.role === 'system' && message.text === 'context'));
  assert.ok(messages.some(message => message.role === 'tool' && message.text === '/work'));
  assert.ok(messages.some(message => message.text.includes('[图片附件]')));
  assert.ok(!JSON.stringify(messages).includes('private'));
});

test('Antigravity exports keep the latest step, source order, prompt context, tools and readable summaries', () => {
  const messages = parseAntigravityConversation([
    { step_index: 8, type: 'PLANNER_RESPONSE', content: 'draft' },
    { step_index: 2, type: 'USER_INPUT', content: '<USER_REQUEST>hello</USER_REQUEST>context' },
    { step_index: 8, type: 'PLANNER_RESPONSE', content: 'final', thinking: 'saved summary', tool_calls: [{ name: 'read_file', arguments: { file: 'readme' } }] },
    { step_index: 9, type: 'RUN_COMMAND', source: 'TOOL', content: 'tool output' }]);
  assert.equal(messages[0].role, 'user');
  assert.equal(messages[1].text, 'final');
  assert.equal(messages[2].kind, 'reasoning_summary');
  assert.equal(messages[3].role, 'tool');
  assert.ok(!JSON.stringify(messages).includes('draft'));
});

test('on-demand pagination round trips long Unicode messages without truncating or splitting surrogate pairs', (t) => {
  const root = home(t);
  const file = path.join(root, '.gemini/antigravity/brain/sample/.system_generated/logs/transcript_full.jsonl');
  const original = '你😀'.repeat(100000);
  write(file, [{ step_index: 0, type: 'USER_INPUT', content: original }]);
  let cursor = '', joined = '', pages = 0;
  do {
    const page = conversationPage(readSessionConversation(query('antigravity:sample', cursor), { home: root, env: {} }));
    assert.ok(!page.error);
    joined += page.messages.map(message => message.text).join('');
    cursor = page.nextCursor;
    pages++;
  } while (cursor);
  assert.equal(joined, original);
  assert.ok(pages > 1);
  const before = readSessionConversation(query('antigravity:sample'), { home: root, env: {} });
  fs.appendFileSync(file, '{"step_index":2,"type":"PLANNER_RESPONSE","content":"new"}\n');
  assert.equal(readSessionConversation(query('antigravity:sample', before.nextCursor), { home: root, env: {} }).error, 'source_changed');
});

test('Codex supports compressed/archived rollouts and refuses a mismatched native identity', async (t) => {
  const root = home(t);
  const id = 'rollout-2026-11-11T00-00-00-test';
  const file = path.join(root, `.codex/archived_sessions/${id}.jsonl`);
  write(file, [record('session_meta', { id: 'native-id', base_instructions: 'not conversation text' }),
    record('response_item', { type: 'message', role: 'assistant', content: [{ text: 'compressed reply' }] })]);
  fs.writeFileSync(`${file}.zst`, zlib.zstdCompressSync(fs.readFileSync(file)));
  fs.unlinkSync(file);
  const result = await readConversationInWorker(query(`codex:${id}`), { options: { home: root, env: {} } });
  assert.equal(result.messages[0].text, 'compressed reply');
  assert.ok(!JSON.stringify(result).includes('not conversation text'));
  const sqlite = require('node:sqlite');
  const db = new sqlite.DatabaseSync(path.join(root, '.codex/state_5.sqlite'));
  db.exec('CREATE TABLE threads(id TEXT, rollout_path TEXT)');
  const thread = '00000000-0000-0000-0000-000000000000';
  db.prepare('INSERT INTO threads VALUES (?, ?)').run(thread, `${file}.zst`);
  db.close();
  assert.equal(readSessionConversation(query(`codex:${thread}`), { home: root, env: {} }).error, 'source_unavailable');
});

test('configured Antigravity/CC Switch roots, missing exports and partial tails remain honest', (t) => {
  const root = home(t);
  const logs = path.join(root, '.cc-switch/agy/provider/antigravity-cli/brain/chat/.system_generated/logs/transcript_full.jsonl');
  write(logs, [{ step_index: 1, type: 'USER_INPUT', content: 'from profile' }]);
  fs.appendFileSync(logs, '{');
  const page = readSessionConversation(query('antigravity:chat'), { home: root, env: {} });
  assert.equal(page.messages[0].text, 'from profile');
  assert.equal(page.incomplete, true);
  assert.equal(readSessionConversation(query('antigravity:missing'), { home: root, env: {} }).error, 'source_unavailable');
});

test('query and page boundaries reject traversal, unsupported clients, oversized data and outside-root links', (t) => {
  for (const key of ['claude:abc', 'codex:../../secret', 'antigravity:..', 'codex:a\\secret', 'codex:a\0']) {
    assert.throws(() => conversationQuery(query(key)), /invalid_request/);
  }
  assert.throws(() => conversationQuery(query('codex:abc', 'arbitrary-url')), /invalid_request/);
  assert.throws(() => conversationPage({ messages: [{ id: 'x', role: 'user', kind: 'message', timestamp: '', text: 'x'.repeat(12001) }], revision: 'a'.repeat(24), nextCursor: '' }));
  const root = home(t), outside = home(t);
  const file = path.join(outside, 'transcript_full.jsonl');
  write(file, [{ step_index: 0, type: 'USER_INPUT', content: 'outside' }]);
  const dir = path.join(root, '.gemini/antigravity/brain/chat/.system_generated');
  fs.mkdirSync(dir, { recursive: true });
  fs.symlinkSync(outside, path.join(dir, 'logs'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(readSessionConversation(query('antigravity:chat'), { home: root, env: {} }).error, 'source_unavailable');
});
