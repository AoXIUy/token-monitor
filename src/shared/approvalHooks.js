'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sharedDataDir } = require('./config');

const ANTIGRAVITY_HOOK_NAME = 'token-monitor-approval-alert';
const LEGACY_ANTIGRAVITY_HOOK_NAMES = Object.freeze(['token-monitor-remote-approval']);
const DEFAULT_ANTIGRAVITY_MATCHER = 'run_command';
const HOOK_TIMEOUT_SECONDS = 10;
const LAUNCHER_BASENAME = 'token-monitor-approval-hook';

function normalizeAntigravityMatcher(value) {
  const trimmed = typeof value === 'string' ? value.replace(/[\r\n\x00-\x1f\x7f]+/g, '').trim() : '';
  return trimmed ? trimmed.slice(0, 256) : DEFAULT_ANTIGRAVITY_MATCHER;
}

function resolveCodexHooksPath({ env = process.env, homeDir = os.homedir() } = {}) {
  const codexHome = env.CODEX_HOME || path.join(homeDir, '.codex');
  return path.join(codexHome, 'hooks.json');
}

function resolveAntigravityHooksPath({ homeDir = os.homedir() } = {}) {
  return path.join(homeDir, '.gemini', 'config', 'hooks.json');
}

function resolveLauncherPaths({ dataDir = sharedDataDir(), platform = process.platform } = {}) {
  const binDir = path.join(dataDir, 'bin');
  const scriptPath = path.join(binDir, 'approval-hook.js');
  const launcherPath = path.join(binDir, platform === 'win32' ? `${LAUNCHER_BASENAME}.cmd` : LAUNCHER_BASENAME);
  return { binDir, scriptPath, launcherPath };
}

function shSingleQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function buildUnixLauncher({ scriptPath, execPath }) {
  return [
    '#!/bin/sh',
    `SCRIPT=${shSingleQuote(scriptPath)}`,
    'if command -v node >/dev/null 2>&1; then',
    '  exec node "$SCRIPT" "$@"',
    'fi',
    `APP_EXEC=${shSingleQuote(execPath)}`,
    'if [ -x "$APP_EXEC" ]; then',
    '  ELECTRON_RUN_AS_NODE=1 exec "$APP_EXEC" "$SCRIPT" "$@"',
    'fi',
    'prev=""',
    'for arg in "$@"; do',
    '  if [ "$prev" = "--client" ] && [ "$arg" = "antigravity" ]; then',
    '    printf \'{"decision":"ask"}\'',
    '    exit 0',
    '  fi',
    '  if [ "$arg" = "--client=antigravity" ]; then',
    '    printf \'{"decision":"ask"}\'',
    '    exit 0',
    '  fi',
    '  prev="$arg"',
    'done',
    'exit 0',
    ''
  ].join('\n');
}

function buildWindowsLauncher({ scriptPath, execPath }) {
  const safeScript = String(scriptPath).replace(/"/g, '');
  const safeExec = String(execPath).replace(/"/g, '');
  return [
    '@echo off',
    'setlocal',
    `set "SCRIPT=${safeScript}"`,
    'where node.exe >nul 2>nul',
    'if %ERRORLEVEL%==0 (',
    '  node.exe "%SCRIPT%" %*',
    '  exit /b %ERRORLEVEL%',
    ')',
    `set "APP_EXEC=${safeExec}"`,
    'if exist "%APP_EXEC%" (',
    '  set "ELECTRON_RUN_AS_NODE=1"',
    '  "%APP_EXEC%" "%SCRIPT%" %*',
    '  exit /b %ERRORLEVEL%',
    ')',
    'echo %* | findstr /C:"antigravity" >nul',
    'if %ERRORLEVEL%==0 (',
    '  echo {"decision":"ask"}',
    ')',
    'exit /b 0',
    ''
  ].join('\r\n');
}

function writeFileIfChangedAtomic(filePath, content, mode) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  let existing = null;
  try { existing = fs.readFileSync(filePath, 'utf8'); } catch (_) {}
  if (existing === content) {
    if (mode !== undefined) {
      try { fs.chmodSync(filePath, mode); } catch (_) {}
    }
    return false;
  }
  const tempPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tempPath, content, { encoding: 'utf8', ...(mode !== undefined ? { mode } : {}) });
  if (mode !== undefined) {
    try { fs.chmodSync(tempPath, mode); } catch (_) {}
  }
  fs.renameSync(tempPath, filePath);
  return true;
}

function ensureApprovalHookLauncher({
  dataDir = sharedDataDir(),
  execPath = process.execPath,
  platform = process.platform,
  env = process.env
} = {}) {
  const { binDir, scriptPath, launcherPath } = resolveLauncherPaths({ dataDir, platform });
  fs.mkdirSync(binDir, { recursive: true });
  const sourcePath = path.join(__dirname, 'approvalHook.js');
  const sourceBody = fs.readFileSync(sourcePath, 'utf8');
  writeFileIfChangedAtomic(scriptPath, sourceBody, 0o644);
  const resolvedExec = (platform === 'linux' && env.APPIMAGE) ? env.APPIMAGE : execPath;
  const launcherBody = platform === 'win32'
    ? buildWindowsLauncher({ scriptPath, execPath: resolvedExec })
    : buildUnixLauncher({ scriptPath, execPath: resolvedExec });
  writeFileIfChangedAtomic(launcherPath, launcherBody, platform === 'win32' ? undefined : 0o755);
  return { scriptPath, launcherPath };
}

function hookCommandString(launcherPath, client) {
  const escaped = String(launcherPath).replace(/"/g, '\\"');
  return `"${escaped}" --client ${client}`;
}

function isManagedHookCommand(command, client) {
  if (typeof command !== 'string') return false;
  return command.includes(LAUNCHER_BASENAME) && command.includes(`--client ${client}`);
}

function readHooksJsonStrict(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { exists: false, data: {} };
    throw error;
  }
  if (!raw.trim()) return { exists: true, data: {} };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_) {
    const err = new Error(`Invalid JSON in ${filePath}`);
    err.code = 'invalid_hooks_json';
    throw err;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const err = new Error(`Expected JSON object in ${filePath}`);
    err.code = 'invalid_hooks_json';
    throw err;
  }
  return { exists: true, data: parsed };
}

function writeHooksJsonAtomic(filePath, data) {
  const content = `${JSON.stringify(data, null, 2)}\n`;
  writeFileIfChangedAtomic(filePath, content);
}

function inspectCodexHook(options = {}) {
  const filePath = options.filePath || resolveCodexHooksPath(options);
  try {
    const { exists, data } = readHooksJsonStrict(filePath);
    const groups = Array.isArray(data?.hooks?.PermissionRequest) ? data.hooks.PermissionRequest : [];
    let installed = false;
    let command = '';
    for (const group of groups) {
      const list = Array.isArray(group?.hooks) ? group.hooks : [];
      for (const handler of list) {
        if (handler?.type === 'command' && isManagedHookCommand(handler.command, 'codex')) {
          installed = true;
          command = handler.command;
          break;
        }
      }
      if (installed) break;
    }
    return { client: 'codex', filePath, exists, installed, command, invalidJson: false };
  } catch (error) {
    if (error.code === 'invalid_hooks_json') {
      return { client: 'codex', filePath, exists: true, installed: false, command: '', invalidJson: true };
    }
    throw error;
  }
}

function installCodexHook(options = {}) {
  const filePath = options.filePath || resolveCodexHooksPath(options);
  const { launcherPath } = ensureApprovalHookLauncher(options);
  const command = hookCommandString(launcherPath, 'codex');
  const { data } = readHooksJsonStrict(filePath);
  const hooks = (data.hooks && typeof data.hooks === 'object' && !Array.isArray(data.hooks))
    ? { ...data.hooks }
    : {};
  if (data.hooks !== undefined && (typeof data.hooks !== 'object' || Array.isArray(data.hooks))) {
    const err = new Error(`Expected hooks object in ${filePath}`);
    err.code = 'invalid_hooks_json';
    throw err;
  }
  const existingGroups = Array.isArray(hooks.PermissionRequest) ? hooks.PermissionRequest : [];
  const filteredGroups = [];
  for (const group of existingGroups) {
    if (!group || typeof group !== 'object' || Array.isArray(group)) {
      filteredGroups.push(group);
      continue;
    }
    const handlers = Array.isArray(group.hooks) ? group.hooks : [];
    const kept = handlers.filter((h) => !(h?.type === 'command' && isManagedHookCommand(h.command, 'codex')));
    if (kept.length > 0 || handlers.length === 0) {
      filteredGroups.push(kept.length === handlers.length ? group : { ...group, hooks: kept });
    }
  }
  filteredGroups.push({
    hooks: [
      {
        type: 'command',
        command,
        timeout: HOOK_TIMEOUT_SECONDS
      }
    ]
  });
  const next = {
    ...data,
    hooks: {
      ...hooks,
      PermissionRequest: filteredGroups
    }
  };
  writeHooksJsonAtomic(filePath, next);
  return inspectCodexHook({ ...options, filePath });
}

function uninstallCodexHook(options = {}) {
  const filePath = options.filePath || resolveCodexHooksPath(options);
  const { exists, data } = readHooksJsonStrict(filePath);
  if (!exists) return inspectCodexHook({ ...options, filePath });
  const existingGroups = Array.isArray(data?.hooks?.PermissionRequest) ? data.hooks.PermissionRequest : null;
  if (!existingGroups) return inspectCodexHook({ ...options, filePath });
  const filteredGroups = [];
  let changed = false;
  for (const group of existingGroups) {
    if (!group || typeof group !== 'object' || Array.isArray(group) || !Array.isArray(group.hooks)) {
      filteredGroups.push(group);
      continue;
    }
    const kept = group.hooks.filter((h) => !(h?.type === 'command' && isManagedHookCommand(h.command, 'codex')));
    if (kept.length !== group.hooks.length) changed = true;
    if (kept.length > 0) filteredGroups.push({ ...group, hooks: kept });
  }
  if (!changed) return inspectCodexHook({ ...options, filePath });
  const nextHooks = { ...data.hooks };
  if (filteredGroups.length > 0) nextHooks.PermissionRequest = filteredGroups;
  else delete nextHooks.PermissionRequest;
  const next = { ...data };
  if (Object.keys(nextHooks).length > 0) next.hooks = nextHooks;
  else delete next.hooks;
  writeHooksJsonAtomic(filePath, next);
  return inspectCodexHook({ ...options, filePath });
}

function findAntigravityManagedEntry(data) {
  const candidateNames = [ANTIGRAVITY_HOOK_NAME, ...LEGACY_ANTIGRAVITY_HOOK_NAMES];
  for (const hookName of candidateNames) {
    const entry = data?.[hookName];
    const groups = Array.isArray(entry?.PreToolUse) ? entry.PreToolUse : [];
    for (const group of groups) {
      const list = Array.isArray(group?.hooks) ? group.hooks : [];
      for (const handler of list) {
        if ((handler?.type === undefined || handler?.type === 'command') && isManagedHookCommand(handler?.command, 'antigravity')) {
          return {
            installed: true,
            command: handler.command,
            matcher: typeof group.matcher === 'string' ? group.matcher : ''
          };
        }
      }
    }
  }
  return { installed: false, command: '', matcher: '' };
}

function inspectAntigravityHook(options = {}) {
  const filePath = options.filePath || resolveAntigravityHooksPath(options);
  try {
    const { exists, data } = readHooksJsonStrict(filePath);
    const match = findAntigravityManagedEntry(data);
    return { client: 'antigravity', filePath, exists, ...match, invalidJson: false };
  } catch (error) {
    if (error.code === 'invalid_hooks_json') {
      return { client: 'antigravity', filePath, exists: true, installed: false, command: '', matcher: '', invalidJson: true };
    }
    throw error;
  }
}

function installAntigravityHook(options = {}) {
  const filePath = options.filePath || resolveAntigravityHooksPath(options);
  const matcher = normalizeAntigravityMatcher(options.matcher);
  const { launcherPath } = ensureApprovalHookLauncher(options);
  const command = hookCommandString(launcherPath, 'antigravity');
  const { data } = readHooksJsonStrict(filePath);
  const next = { ...data };
  for (const legacyName of LEGACY_ANTIGRAVITY_HOOK_NAMES) {
    delete next[legacyName];
  }
  next[ANTIGRAVITY_HOOK_NAME] = {
    PreToolUse: [
      {
        matcher,
        hooks: [
          {
            type: 'command',
            command,
            timeout: HOOK_TIMEOUT_SECONDS
          }
        ]
      }
    ]
  };
  writeHooksJsonAtomic(filePath, next);
  return inspectAntigravityHook({ ...options, filePath });
}

function uninstallAntigravityHook(options = {}) {
  const filePath = options.filePath || resolveAntigravityHooksPath(options);
  const { exists, data } = readHooksJsonStrict(filePath);
  const keysToRemove = [ANTIGRAVITY_HOOK_NAME, ...LEGACY_ANTIGRAVITY_HOOK_NAMES].filter((k) => Object.hasOwn(data, k));
  if (!exists || keysToRemove.length === 0) {
    return inspectAntigravityHook({ ...options, filePath });
  }
  const next = { ...data };
  for (const key of keysToRemove) delete next[key];
  writeHooksJsonAtomic(filePath, next);
  return inspectAntigravityHook({ ...options, filePath });
}

function inspectApprovalHooks(options = {}) {
  return {
    codex: inspectCodexHook(options.codex ? { ...options, ...options.codex } : options),
    antigravity: inspectAntigravityHook(options.antigravity ? { ...options, ...options.antigravity } : options)
  };
}

module.exports = {
  ANTIGRAVITY_HOOK_NAME,
  DEFAULT_ANTIGRAVITY_MATCHER,
  HOOK_TIMEOUT_SECONDS,
  ensureApprovalHookLauncher,
  hookCommandString,
  inspectAntigravityHook,
  inspectApprovalHooks,
  inspectCodexHook,
  installAntigravityHook,
  installCodexHook,
  isManagedHookCommand,
  normalizeAntigravityMatcher,
  resolveAntigravityHooksPath,
  resolveCodexHooksPath,
  resolveLauncherPaths,
  uninstallAntigravityHook,
  uninstallCodexHook
};
