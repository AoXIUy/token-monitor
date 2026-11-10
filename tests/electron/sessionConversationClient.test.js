'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('desktop readers are opt-in, reuse the same destination and stop before changing the binding', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../src/electron/main.js'), 'utf8');
  const start = source.indexOf('let sessionConversationClient = null;');
  const end = source.indexOf('\nasync function postToHub(summary)', start);
  let destination = { url: 'https://hub-one.test', secret: 'first-secret' };
  const calls = [];
  const process = { env: {} };
  const sandbox = vm.createContext({ process, settings: { wslScanEnabled: true },
    effectiveHubConfig: () => destination,
    createSessionConversationClient: options => {
      calls.push(['create', options.hubUrl, options.deviceId, options.wslScanEnabled]);
      return { update: summary => calls.push(['update', summary.deviceId]), start: () => calls.push(['start']), stop: () => calls.push(['stop']) };
    } });
  vm.runInContext(source.slice(start, end), sandbox);
  sandbox.serveSessionConversations({ deviceId: 'pc' });
  assert.deepEqual(calls, []);
  process.env.TOKEN_MONITOR_SESSION_CONVERSATIONS = '1';
  sandbox.serveSessionConversations({ deviceId: 'pc' });
  sandbox.serveSessionConversations({ deviceId: 'pc' });
  assert.equal(calls.filter(call => call[0] === 'create').length, 1);
  destination = { url: 'https://hub-two.test', secret: 'second-secret' };
  sandbox.serveSessionConversations({ deviceId: 'pc' });
  assert.deepEqual(calls.slice(-4), [['stop'], ['create', 'https://hub-two.test', 'pc', true], ['update', 'pc'], ['start']]);
  destination = { url: '', secret: '' };
  sandbox.serveSessionConversations({ deviceId: 'pc' });
  assert.deepEqual(calls.at(-1), ['stop']);
});
