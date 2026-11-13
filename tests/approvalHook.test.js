'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApprovalBridge } = require('../src/shared/approvalBridge');

const HOOK_SCRIPT = path.resolve(__dirname, '..', 'src', 'shared', 'approvalHook.js');

function runHookProcess(args, stdinText, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK_SCRIPT, ...args], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
    child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(stdinText);
  });
}

test('hook subprocess returns desktop fallback immediately when bridge is absent', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-hook-empty-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const codex = await runHookProcess(
    ['--client', 'codex', '--data-dir', dir],
    JSON.stringify({ session_id: 's1', tool_name: 'Bash', tool_input: { command: 'ls' }, cwd: '/tmp/proj' })
  );
  assert.equal(codex.code, 0);
  assert.equal(codex.stdout, '');

  const agy = await runHookProcess(
    ['--client', 'antigravity', '--data-dir', dir],
    JSON.stringify({ conversationId: 'c1', toolCall: { name: 'run_command', args: { CommandLine: 'npm test' } }, workspacePaths: ['/tmp/proj'] })
  );
  assert.equal(agy.code, 0);
  assert.deepEqual(JSON.parse(agy.stdout), { decision: 'ask' });
});

test('hook subprocess dispatches read-only alerts and returns desktop fallback without waiting', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-hook-live-'));
  const observed = [];
  const bridge = createApprovalBridge({
    dataDir: dir,
    onAlert: async (alert) => {
      observed.push(alert);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  });
  await bridge.start();
  t.after(async () => {
    await bridge.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const t0 = Date.now();
  const codex = await runHookProcess(
    ['--client', 'codex', '--data-dir', dir],
    JSON.stringify({
      session_id: 'codex-1',
      turn_id: 'turn-1',
      tool_name: 'Bash',
      tool_input: { command: 'git push', description: 'Push branch' },
      cwd: '/home/user/workspace/my-app'
    })
  );
  assert.ok(Date.now() - t0 < 1500, 'Codex hook must not block on alert delivery');
  assert.equal(codex.code, 0);
  assert.equal(codex.stdout, '');
  assert.deepEqual(observed[0], {
    client: 'codex',
    sessionId: 'codex-1',
    tool: 'Bash',
    command: 'git push',
    description: 'Push branch',
    projectLabel: 'my-app'
  });

  const t1 = Date.now();
  const agy = await runHookProcess(
    ['--client', 'antigravity', '--data-dir', dir],
    JSON.stringify({
      conversationId: 'agy-1',
      toolCall: { name: 'run_command', args: { CommandLine: 'rm -rf dist', Cwd: '/home/user/workspace/my-app' } },
      workspacePaths: ['/home/user/workspace/my-app']
    })
  );
  assert.ok(Date.now() - t1 < 1500, 'Antigravity hook must not block on alert delivery');
  assert.equal(agy.code, 0);
  assert.deepEqual(JSON.parse(agy.stdout), { decision: 'ask' });
  assert.deepEqual(observed[1], {
    client: 'antigravity',
    sessionId: 'agy-1',
    tool: 'run_command',
    command: 'rm -rf dist',
    description: '',
    projectLabel: 'my-app'
  });
});
