'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  ANTIGRAVITY_HOOK_NAME,
  HOOK_TIMEOUT_SECONDS,
  inspectAntigravityHook,
  inspectCodexHook,
  installAntigravityHook,
  installCodexHook,
  uninstallAntigravityHook,
  uninstallCodexHook
} = require('../../src/shared/approvalHooks');

test('Codex hook install/uninstall preserves existing entries, uses short timeout without wait message, and refuses invalid JSON', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-codex-hooks-'));
  const dataDir = path.join(dir, 'data');
  const hooksFile = path.join(dir, 'hooks.json');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  fs.writeFileSync(hooksFile, JSON.stringify({
    description: 'User hooks',
    hooks: {
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo pre' }] }],
      PermissionRequest: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo existing' }] }]
    }
  }), 'utf8');

  const status1 = installCodexHook({ filePath: hooksFile, dataDir });
  assert.equal(status1.installed, true);
  assert.equal(fs.existsSync(path.join(dataDir, 'bin', 'approval-hook.js')), true);

  // Idempotent second install doesn't duplicate entry
  installCodexHook({ filePath: hooksFile, dataDir });
  const written = JSON.parse(fs.readFileSync(hooksFile, 'utf8'));
  assert.equal(written.description, 'User hooks');
  assert.equal(written.hooks.PreToolUse.length, 1);
  assert.equal(written.hooks.PermissionRequest.length, 2);
  const installedEntry = written.hooks.PermissionRequest[1].hooks[0];
  assert.equal(installedEntry.timeout, HOOK_TIMEOUT_SECONDS);
  assert.equal(installedEntry.statusMessage, undefined);

  // Uninstall removes only our entry
  const status2 = uninstallCodexHook({ filePath: hooksFile, dataDir });
  assert.equal(status2.installed, false);
  const afterRemove = JSON.parse(fs.readFileSync(hooksFile, 'utf8'));
  assert.equal(afterRemove.hooks.PermissionRequest.length, 1);
  assert.equal(afterRemove.hooks.PermissionRequest[0].hooks[0].command, 'echo existing');

  // Corrupt JSON refuses overwrite
  fs.writeFileSync(hooksFile, '{broken json', 'utf8');
  assert.throws(() => installCodexHook({ filePath: hooksFile, dataDir }), /Invalid JSON/);
  assert.equal(inspectCodexHook({ filePath: hooksFile, dataDir }).invalidJson, true);
});

test('Antigravity hook install/uninstall preserves unrelated hooks, updates matcher, and migrates legacy hook key', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-agy-hooks-'));
  const dataDir = path.join(dir, 'data');
  const hooksFile = path.join(dir, 'hooks.json');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  fs.writeFileSync(hooksFile, JSON.stringify({
    'user-linter': { PostToolUse: [{ matcher: 'write_to_file', hooks: [{ type: 'command', command: 'echo lint' }] }] },
    'token-monitor-remote-approval': { PreToolUse: [{ matcher: 'run_command', hooks: [{ type: 'command', command: '"/tmp/token-monitor-approval-hook" --client antigravity' }] }] }
  }), 'utf8');

  assert.equal(inspectAntigravityHook({ filePath: hooksFile, dataDir }).installed, true);

  const st1 = installAntigravityHook({ filePath: hooksFile, dataDir });
  assert.equal(st1.installed, true);
  assert.equal(st1.matcher, 'run_command');
  const afterMigrate = JSON.parse(fs.readFileSync(hooksFile, 'utf8'));
  assert.equal(afterMigrate['token-monitor-remote-approval'], undefined);
  assert.ok(afterMigrate[ANTIGRAVITY_HOOK_NAME]);

  const st2 = installAntigravityHook({ filePath: hooksFile, dataDir, matcher: 'run_command|write_to_file' });
  assert.equal(st2.matcher, 'run_command|write_to_file');

  const st3 = uninstallAntigravityHook({ filePath: hooksFile, dataDir });
  assert.equal(st3.installed, false);
  const after = JSON.parse(fs.readFileSync(hooksFile, 'utf8'));
  assert.ok(after['user-linter']);
  assert.equal(after[ANTIGRAVITY_HOOK_NAME], undefined);

  fs.writeFileSync(hooksFile, '[]', 'utf8');
  assert.throws(() => installAntigravityHook({ filePath: hooksFile, dataDir }), /Expected JSON object/);
  assert.equal(inspectAntigravityHook({ filePath: hooksFile, dataDir }).invalidJson, true);
});
