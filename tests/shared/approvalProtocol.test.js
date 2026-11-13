'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const protocol = require('../../src/shared/approvalProtocol');

test('approvalAlertInput validates required fields, strips control chars, and truncates long text', () => {
  assert.throws(() => protocol.approvalAlertInput(null), /invalid_request/);
  assert.throws(() => protocol.approvalAlertInput({ deviceId: 'pc', client: 'claude', sessionId: 's', tool: 'Bash' }), /invalid_request/);
  assert.throws(() => protocol.approvalAlertInput({ deviceId: 'pc', client: 'codex', sessionId: '', tool: 'Bash' }), /invalid_request/);
  assert.throws(() => protocol.approvalAlertInput({ deviceId: '', client: 'codex', sessionId: 's', tool: 'Bash' }), /invalid_request/);

  const req = protocol.approvalAlertInput({
    deviceId: 'pc\u0000one',
    client: 'codex',
    sessionId: 'sess\n1',
    tool: 'Bash\tcmd',
    command: `line1\r\nline2\u0007${'a'.repeat(protocol.LIMITS.command + 50)}`,
    description: 'run\ntests',
    projectLabel: 'my\rproject'
  });
  assert.equal(req.deviceId, 'pc one');
  assert.equal(req.sessionId, 'sess 1');
  assert.equal(req.tool, 'Bash cmd');
  assert.ok(req.command.startsWith('line1\nline2'));
  assert.equal(Array.from(req.command).length, protocol.LIMITS.command);
  assert.equal(req.description, 'run tests');
  assert.equal(req.projectLabel, 'my project');
});

test('hookFallbackOutput never emits allow/deny decisions', () => {
  assert.equal('approvalDecision' in protocol, false);
  assert.equal('APPROVAL_DECISIONS' in protocol, false);
  assert.equal(protocol.hookFallbackOutput('codex'), '');
  assert.deepEqual(JSON.parse(protocol.hookFallbackOutput('antigravity')), {
    decision: 'ask'
  });
});
