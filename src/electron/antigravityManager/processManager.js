// @ts-check
'use strict';

const { execFile, execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const IDE_MARKERS = ['antigravity ide', 'antigravity-ide', 'antigravity_ide', 'antigravityide', 'antigravity.ide'];
const MANAGER_MARKERS = [
  'antigravity-tools',
  'antigravity_tools',
  'antigravity-manager',
  'antigravity_manager',
  'antigravity-too',
  'antigravity_too',
  'token-monitor',
  'tokenmonitor'
];

/**
 * @param {string} s
 * @returns {boolean}
 */
function isAntigravityIdeStr(s) {
  const lower = String(s || '').toLowerCase();
  return IDE_MARKERS.some((marker) => lower.includes(marker));
}

/**
 * @param {string} p
 * @returns {boolean}
 */
function isAntigravityIdePath(p) {
  return isAntigravityIdeStr(String(p || ''));
}

/**
 * @param {string} name
 * @param {string} exePath
 * @param {string} argv0
 * @returns {boolean}
 */
function isManagerOrToolsProcess(name, exePath, argv0) {
  const combined = `${name} ${exePath} ${argv0}`.toLowerCase();
  return MANAGER_MARKERS.some((marker) => combined.includes(marker));
}

/**
 * Extract `--user-data-dir` value from command args string (preserving original casing).
 * @param {string} argsStr
 * @returns {string | null}
 */
function chromiumUserDataDir(argsStr) {
  const raw = String(argsStr || '');
  const lower = raw.toLowerCase();
  const needle = 'user-data-dir';
  const pos = lower.indexOf(needle);
  if (pos < 0) return null;
  let rest = raw.slice(pos + needle.length).replace(/^[=: ]+/, '');
  if (!rest) return null;
  if (rest.startsWith('"') || rest.startsWith("'")) {
    const quote = rest[0];
    const closeIdx = rest.indexOf(quote, 1);
    if (closeIdx >= 1) {
      return rest.slice(1, closeIdx).trim() || null;
    }
    rest = rest.slice(1);
  }
  const bareEnd = rest.indexOf(' --');
  const end = bareEnd >= 0 ? bareEnd : rest.length;
  return rest.slice(0, end).replace(/["' ]+$/, '') || null;
}

/**
 * Strict executable-based process classification matching Antigravity-Manager process.rs.
 * Never classifies unrelated VS Code / editor / terminal windows opening an antigravity folder.
 *
 * @param {string} name
 * @param {string} exePath
 * @param {string} argv0
 * @param {string} argsStr
 * @returns {'manager' | 'ide' | 'classic' | 'language_server' | 'acp_server' | 'agy' | 'unrelated'}
 */
function classifyProcess(name, exePath, argv0, argsStr) {
  const nameL = String(name || '').toLowerCase();
  const exeL = String(exePath || '').toLowerCase();
  const argvL = String(argv0 || '').toLowerCase();
  const argsL = String(argsStr || '').toLowerCase();

  if (isManagerOrToolsProcess(nameL, exeL, argvL)) {
    return 'manager';
  }
  if (nameL.includes('agy_acp_server') || exeL.includes('agy_acp_server')) {
    return 'acp_server';
  }
  if (
    (nameL.includes('language_server') || exeL.includes('language_server'))
    && (exeL.includes('antigravity') || argsL.includes('antigravity') || argsL.includes('jetski') || argsL.includes('cascade'))
  ) {
    return 'language_server';
  }
  if (nameL === 'agy' || nameL === 'agy.exe' || exeL.endsWith('/agy') || exeL.endsWith('\\agy.exe')) {
    return 'agy';
  }
  if (!exeL.includes('antigravity') && !nameL.includes('antigravity')) {
    return 'unrelated';
  }
  if (isAntigravityIdeStr(exeL) || isAntigravityIdeStr(nameL)) {
    return 'ide';
  }
  const userDataDir = chromiumUserDataDir(argsL);
  if (userDataDir && isAntigravityIdeStr(userDataDir)) {
    return 'ide';
  }
  return 'classic';
}

/**
 * Identify Chromium / VS Code / Antigravity child helper processes that must
 * never be treated as the primary GUI launcher process.
 *
 * @param {string} name
 * @param {string} argsStr
 * @param {string} exePath
 * @returns {boolean}
 */
function isHelperProcess(name, argsStr, exePath) {
  const nameL = String(name || '').toLowerCase();
  const argsL = String(argsStr || '').toLowerCase();
  const exeL = String(exePath || '').toLowerCase();
  return (
    argsL.includes('--type=')
    || argsL.includes('--ms-enable-electron-run-as-node')
    || argsL.includes('--utility-sub-type=')
    || argsL.includes('app.asar\\')
    || argsL.includes('app.asar/')
    || argsL.includes('node-ipc')
    || argsL.includes('nodeipc')
    || argsL.includes('max-old-space-size')
    || argsL.includes('node_modules')
    || argsL.includes('--standalone')
    || argsL.includes('--subclient_type')
    || argsL.includes('--override_ide_name')
    || nameL.includes('helper')
    || nameL.includes('plugin')
    || nameL.includes('renderer')
    || nameL.includes('gpu')
    || nameL.includes('crashpad')
    || nameL.includes('utility')
    || nameL.includes('audio')
    || nameL.includes('sandbox')
    || nameL.includes('language_server')
    || argsL.includes('language_server')
    || exeL.includes('crashpad')
    || exeL.includes('helper')
    || exeL.includes('language_server')
    || classifyProcess(name, exePath, '', argsStr) === 'language_server'
  );
}

/**
 * Strip Chromium internal / engine flags before forwarding args to a fresh launch.
 *
 * @param {string[]} args
 * @returns {string[]}
 */
function sanitizeRestartArgs(args) {
  return (Array.isArray(args) ? args : [])
    .map((a) => String(a || '').trim())
    .filter((arg) => {
      if (!arg) return false;
      const lower = arg.toLowerCase();
      return (
        !lower.startsWith('--type=')
        && !lower.startsWith('--standalone')
        && !lower.startsWith('--override_ide_name')
        && !lower.startsWith('--subclient_type')
        && !lower.startsWith('--mojo-platform-channel-handle')
        && !lower.startsWith('--field-trial-handle')
        && !lower.startsWith('--metrics-shmem-handle')
        && !lower.startsWith('--crashpad-handler')
        && !lower.startsWith('--enable-crash-reporter')
        && !lower.includes('language_server')
      );
    });
}

const WIN32_PS_LIST_SCRIPT = [
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  '$OutputEncoding = [System.Text.Encoding]::UTF8',
  'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress'
].join('; ');

const WIN32_PS_REGISTRY_SCRIPT = [
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  '$OutputEncoding = [System.Text.Encoding]::UTF8',
  '$roots = @("HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*","HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*","HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*")',
  'Get-ItemProperty $roots -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like "*Antigravity*" } | Select-Object DisplayName,InstallLocation,DisplayIcon | ConvertTo-Json -Compress'
].join('; ');

const WIN_REGISTRY_CACHE_TTL_MS = 60_000;
/** @type {Map<string, { value: string | null, expiresAt: number }>} */
const winRegistryCache = new Map();

/**
 * @param {typeof execFile} execAsyncFn
 * @param {string} cmd
 * @param {string[]} args
 * @param {import('node:child_process').ExecFileOptions} opts
 * @returns {Promise<string>}
 */
function execFileTextAsync(execAsyncFn, cmd, args, opts) {
  return new Promise((resolve, reject) => {
    execAsyncFn(cmd, args, { ...opts, encoding: 'utf8' }, (err, stdout) => {
      if (err) reject(err);
      else resolve(String(stdout || ''));
    });
  });
}

/**
 * @param {string} out
 */
function parseWin32ProcessOutput(out) {
  const cleanJson = String(out || '').replace(/^\uFEFF/, '').trim();
  const parsed = JSON.parse(cleanJson || '[]');
  const rows = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
  return rows.map((row) => {
    const cmd = String(row?.CommandLine || '');
    return {
      pid: Number(row?.ProcessId || 0),
      ppid: Number(row?.ParentProcessId || 0),
      name: String(row?.Name || ''),
      exePath: String(row?.ExecutablePath || ''),
      argv0: String(row?.ExecutablePath || row?.Name || ''),
      args: cmd
    };
  }).filter((p) => p.pid > 0 && p.pid !== process.pid);
}

/**
 * @param {string} commOut
 */
function parsePosixCommMap(commOut) {
  /** @type {Map<number, string>} */
  const commByPid = new Map();
  for (const line of String(commOut || '').split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(.+)$/);
    if (!m) continue;
    const pid = Number(m[1]);
    if (Number.isFinite(pid) && pid > 0) commByPid.set(pid, m[2].trim());
  }
  return commByPid;
}

/**
 * @param {number} pid
 * @param {string} fullArgs
 * @param {string} comm
 * @param {string} procExePath
 */
function buildPosixProcessRecord(pid, fullArgs, comm, procExePath) {
  let exePath = procExePath ? procExePath.replace(/ \(deleted\)$/, '') : '';
  if (!exePath && comm.startsWith('/')) {
    exePath = comm;
  }
  if (!exePath && fullArgs.startsWith('/')) {
    if (comm) {
      const suffix = `/${comm}`;
      const idx = fullArgs.indexOf(suffix);
      if (idx >= 0) {
        const after = fullArgs[idx + suffix.length];
        if (!after || /\s/.test(after)) {
          exePath = fullArgs.slice(0, idx + suffix.length);
        }
      }
    }
    if (!exePath) {
      exePath = fullArgs.split(/\s+/)[0] || '';
    }
  }
  if (!exePath) {
    exePath = comm || fullArgs.split(/\s+/)[0] || '';
  }
  const name = path.basename(comm || exePath);
  const argv0 = exePath || fullArgs.split(/\s+/)[0] || comm;
  return {
    pid,
    ppid: 0,
    name,
    exePath,
    argv0,
    args: fullArgs
  };
}

/**
 * @param {{ platform?: NodeJS.Platform, execFileSync?: typeof execFileSync, readlinkSync?: typeof fs.readlinkSync }} [deps]
 * @returns {Array<{ pid: number, ppid?: number, name: string, exePath: string, argv0: string, args: string }>}
 */
function listProcesses(deps = {}) {
  const platform = deps.platform || process.platform;
  const execFn = deps.execFileSync || execFileSync;

  try {
    if (platform === 'win32') {
      // Force UTF-8 output so localized Windows (e.g. CP936/GBK) does not corrupt non-ASCII paths.
      const out = execFn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WIN32_PS_LIST_SCRIPT], {
        encoding: 'utf8',
        timeout: 10_000,
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024
      });
      return parseWin32ProcessOutput(String(out || ''));
    }

    // Query comm= and args= separately as the final column so executable paths with
    // spaces (e.g. `/Applications/Antigravity IDE.app/...`) are never split mid-path.
    const commOut = execFn('ps', ['-eo', 'pid=,comm='], {
      encoding: 'utf8',
      timeout: 5000,
      maxBuffer: 8 * 1024 * 1024
    });
    const argsOut = execFn('ps', ['-eo', 'pid=,args='], {
      encoding: 'utf8',
      timeout: 5000,
      maxBuffer: 8 * 1024 * 1024
    });
    const commByPid = parsePosixCommMap(String(commOut || ''));

    const canReadProcExe = platform === 'linux' && (typeof deps.readlinkSync === 'function' || !deps.execFileSync);
    const readlinkFn = deps.readlinkSync || fs.readlinkSync;

    return String(argsOut || '').split('\n').flatMap((line) => {
      const match = line.trim().match(/^(\d+)\s+(.+)$/);
      if (!match) return [];
      const pid = Number(match[1]);
      if (!Number.isFinite(pid) || pid <= 0 || pid === process.pid) return [];
      const fullArgs = match[2].trim();
      const comm = commByPid.get(pid) || '';
      let procExe = '';
      if (canReadProcExe && !(fullArgs.startsWith('[') && fullArgs.endsWith(']'))) {
        try {
          procExe = String(readlinkFn(`/proc/${pid}/exe`) || '');
        } catch (_) {}
      }
      return [buildPosixProcessRecord(pid, fullArgs, comm, procExe)];
    });
  } catch (_) {
    return [];
  }
}

/**
 * Non-blocking process table enumeration for Electron main-thread IPC paths.
 *
 * @param {{
 *   platform?: NodeJS.Platform,
 *   execFile?: typeof execFile,
 *   execFileSync?: typeof execFileSync,
 *   readlink?: typeof fs.promises.readlink,
 *   readlinkSync?: typeof fs.readlinkSync,
 *   listProcesses?: () => ReturnType<typeof listProcesses> | Promise<ReturnType<typeof listProcesses>>
 * }} [deps]
 * @returns {Promise<Array<{ pid: number, ppid?: number, name: string, exePath: string, argv0: string, args: string }>>}
 */
async function listProcessesAsync(deps = {}) {
  if (deps.listProcesses) {
    return await deps.listProcesses();
  }
  if (deps.execFileSync) {
    return listProcesses(deps);
  }
  const platform = deps.platform || process.platform;
  const execAsyncFn = deps.execFile || execFile;

  try {
    if (platform === 'win32') {
      const out = await execFileTextAsync(
        execAsyncFn,
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', WIN32_PS_LIST_SCRIPT],
        {
          timeout: 10_000,
          windowsHide: true,
          maxBuffer: 16 * 1024 * 1024
        }
      );
      return parseWin32ProcessOutput(out);
    }

    const [commOut, argsOut] = await Promise.all([
      execFileTextAsync(execAsyncFn, 'ps', ['-eo', 'pid=,comm='], {
        timeout: 5000,
        maxBuffer: 8 * 1024 * 1024
      }),
      execFileTextAsync(execAsyncFn, 'ps', ['-eo', 'pid=,args='], {
        timeout: 5000,
        maxBuffer: 8 * 1024 * 1024
      })
    ]);
    const commByPid = parsePosixCommMap(commOut);
    const canReadProcExe = platform === 'linux' && (typeof deps.readlink === 'function' || !deps.execFile);
    const readlinkAsyncFn = deps.readlink || fs.promises.readlink;

    /** @type {Array<{ pid: number, fullArgs: string, comm: string }>} */
    const rawRows = [];
    for (const line of String(argsOut || '').split('\n')) {
      const match = line.trim().match(/^(\d+)\s+(.+)$/);
      if (!match) continue;
      const pid = Number(match[1]);
      if (!Number.isFinite(pid) || pid <= 0 || pid === process.pid) continue;
      const fullArgs = match[2].trim();
      rawRows.push({ pid, fullArgs, comm: commByPid.get(pid) || '' });
    }

    if (!canReadProcExe) {
      return rawRows.map((r) => buildPosixProcessRecord(r.pid, r.fullArgs, r.comm, ''));
    }

    return await Promise.all(rawRows.map(async (r) => {
      let procExe = '';
      if (!(r.fullArgs.startsWith('[') && r.fullArgs.endsWith(']'))) {
        try {
          procExe = String(await readlinkAsyncFn(`/proc/${r.pid}/exe`) || '');
        } catch (_) {}
      }
      return buildPosixProcessRecord(r.pid, r.fullArgs, r.comm, procExe);
    }));
  } catch (_) {
    return [];
  }
}

/**
 * @param {string | null} [targetIde]
 * @param {ReturnType<typeof listProcesses>} [procs]
 */
function getRunningInstances(targetIde = null, procs = listProcesses()) {
  const wantIde = targetIde === 'ide';
  return procs.filter((p) => {
    const kind = classifyProcess(p.name, p.exePath, p.argv0, p.args);
    if (wantIde) return kind === 'ide';
    return kind === 'classic';
  });
}

/**
 * Return non-helper primary GUI instances for the target client.
 *
 * @param {string | null} [targetIde]
 * @param {ReturnType<typeof listProcesses>} [procs]
 */
function getMainRunningInstances(targetIde = null, procs = listProcesses()) {
  const running = getRunningInstances(targetIde, procs);
  const runningPids = new Set(running.map((p) => p.pid));
  const nonHelpers = running.filter((p) => !isHelperProcess(p.name, p.args, p.exePath));
  if (nonHelpers.length <= 1) return nonHelpers;
  return [...nonHelpers].sort((a, b) => {
    const aChild = Number(a.ppid || 0) > 0 && runningPids.has(Number(a.ppid || 0));
    const bChild = Number(b.ppid || 0) > 0 && runningPids.has(Number(b.ppid || 0));
    if (aChild !== bChild) return aChild ? 1 : -1;
    return a.pid - b.pid;
  });
}

/**
 * @param {string | null} [targetIde]
 * @param {{ platform?: NodeJS.Platform, execFileSync?: typeof execFileSync, listProcesses?: () => ReturnType<typeof listProcesses> }} [deps]
 * @returns {boolean}
 */
function isAntigravityRunning(targetIde = null, deps = {}) {
  const procs = deps.listProcesses ? deps.listProcesses() : listProcesses(deps);
  return getRunningInstances(targetIde, procs).length > 0;
}

/**
 * @param {string} processName
 * @param {{ platform?: NodeJS.Platform, execFileSync?: typeof execFileSync, listProcesses?: () => ReturnType<typeof listProcesses> }} [deps]
 * @returns {boolean}
 */
function isProcessRunningByName(processName, deps = {}) {
  const needle = String(processName || '').trim().toLowerCase();
  if (!needle) return false;
  const procs = deps.listProcesses ? deps.listProcesses() : listProcesses(deps);
  return procs.some((p) => {
    const kind = classifyProcess(p.name, p.exePath, p.argv0, p.args);
    if (kind === 'manager') return false;
    return p.name.toLowerCase() === needle || p.name.toLowerCase() === `${needle}.exe` || kind === needle;
  });
}

/**
 * @param {string | null} [targetIde]
 * @param {{ platform?: NodeJS.Platform, execFileSync?: typeof execFileSync, listProcesses?: () => ReturnType<typeof listProcesses> }} [deps]
 * @returns {string | null}
 */
function getUserDataDirFromProcess(targetIde = null, deps = {}) {
  const procs = deps.listProcesses ? deps.listProcesses() : listProcesses(deps);
  const allMatching = getRunningInstances(targetIde, procs);
  const mainMatching = allMatching.filter((p) => !isHelperProcess(p.name, p.args, p.exePath));
  for (const proc of [...mainMatching, ...allMatching]) {
    const dir = chromiumUserDataDir(proc.args);
    if (dir) return dir;
  }
  return null;
}

/**
 * @param {string} out
 * @param {boolean} isIde
 * @param {string[]} exeNames
 * @param {(p: string) => boolean} existsSync
 * @returns {string | null}
 */
function parseWindowsRegistryExecutable(out, isIde, exeNames, existsSync) {
  const cleanJson = String(out || '').replace(/^\uFEFF/, '').trim();
  if (!cleanJson) return null;
  const parsed = JSON.parse(cleanJson);
  const rows = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
  for (const row of rows) {
    const displayName = String(row?.DisplayName || '');
    const installLoc = String(row?.InstallLocation || '').trim().replace(/^"|"$/g, '');
    const displayIcon = String(row?.DisplayIcon || '').trim().replace(/^"|"$/g, '').replace(/,\s*-?\d+$/, '').trim();
    if (isManagerOrToolsProcess(displayName, installLoc, displayIcon)) continue;
    const rowIsIde = isAntigravityIdeStr(displayName) || isAntigravityIdeStr(installLoc) || isAntigravityIdeStr(displayIcon);
    if (isIde !== rowIsIde) continue;

    if (displayIcon && /\.exe$/i.test(displayIcon) && existsSync(displayIcon)) {
      return displayIcon;
    }
    if (installLoc) {
      for (const exe of exeNames) {
        const candidate = path.win32.join(installLoc, exe);
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return null;
}

/**
 * Best-effort Windows Registry uninstall lookup for custom-drive installs
 * (e.g. D:\Programs\Antigravity\Antigravity.exe).
 *
 * @param {string | null} targetIde
 * @param {{ execFileSync?: typeof execFileSync, fs?: Pick<typeof fs, 'existsSync'> }} [deps]
 * @returns {string | null}
 */
function detectWindowsRegistryExecutable(targetIde, deps = {}) {
  const execFn = deps.execFileSync || execFileSync;
  const existsSync = deps.fs?.existsSync || fs.existsSync;
  const isIde = targetIde === 'ide';
  const cacheKey = isIde ? 'ide' : 'classic';
  const canCache = !deps.execFileSync && !deps.fs;
  if (canCache) {
    const cached = winRegistryCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      if (!cached.value || existsSync(cached.value)) return cached.value;
    }
  }
  const exeNames = isIde
    ? ['Antigravity IDE.exe', 'antigravity-ide.exe', 'antigravity_ide.exe', 'Antigravity.exe']
    : ['Antigravity.exe', 'antigravity.exe'];
  try {
    const out = execFn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WIN32_PS_REGISTRY_SCRIPT], {
      encoding: 'utf8',
      timeout: 6000,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024
    });
    const found = parseWindowsRegistryExecutable(String(out || ''), isIde, exeNames, existsSync);
    if (canCache) winRegistryCache.set(cacheKey, { value: found, expiresAt: Date.now() + WIN_REGISTRY_CACHE_TTL_MS });
    return found;
  } catch (_) {}
  if (canCache) winRegistryCache.set(cacheKey, { value: null, expiresAt: Date.now() + WIN_REGISTRY_CACHE_TTL_MS });
  return null;
}

/**
 * Async Windows Registry uninstall lookup with 60s result caching.
 *
 * @param {string | null} targetIde
 * @param {{ execFile?: typeof execFile, execFileSync?: typeof execFileSync, fs?: Pick<typeof fs, 'existsSync'> }} [deps]
 * @returns {Promise<string | null>}
 */
async function detectWindowsRegistryExecutableAsync(targetIde, deps = {}) {
  if (deps.execFileSync) {
    return detectWindowsRegistryExecutable(targetIde, deps);
  }
  const execAsyncFn = deps.execFile || execFile;
  const existsSync = deps.fs?.existsSync || fs.existsSync;
  const isIde = targetIde === 'ide';
  const cacheKey = isIde ? 'ide' : 'classic';
  const canCache = !deps.execFile && !deps.fs;
  if (canCache) {
    const cached = winRegistryCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      if (!cached.value || existsSync(cached.value)) return cached.value;
    }
  }
  const exeNames = isIde
    ? ['Antigravity IDE.exe', 'antigravity-ide.exe', 'antigravity_ide.exe', 'Antigravity.exe']
    : ['Antigravity.exe', 'antigravity.exe'];
  try {
    const out = await execFileTextAsync(
      execAsyncFn,
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', WIN32_PS_REGISTRY_SCRIPT],
      {
        timeout: 6000,
        windowsHide: true,
        maxBuffer: 2 * 1024 * 1024
      }
    );
    const found = parseWindowsRegistryExecutable(out, isIde, exeNames, existsSync);
    if (canCache) winRegistryCache.set(cacheKey, { value: found, expiresAt: Date.now() + WIN_REGISTRY_CACHE_TTL_MS });
    return found;
  } catch (_) {}
  if (canCache) winRegistryCache.set(cacheKey, { value: null, expiresAt: Date.now() + WIN_REGISTRY_CACHE_TTL_MS });
  return null;
}

/**
 * Build standard filesystem executable candidates for `classic` or `ide`.
 *
 * @param {string | null} targetIde
 * @param {{ platform?: NodeJS.Platform, home?: string, env?: NodeJS.ProcessEnv }} [deps]
 * @returns {string[]}
 */
function buildExecutableCandidates(targetIde = null, deps = {}) {
  const platform = deps.platform || process.platform;
  const home = deps.home || os.homedir();
  const env = deps.env || process.env;
  const isIde = targetIde === 'ide';
  const pathApi = platform === 'win32' ? path.win32 : path;
  /** @type {string[]} */
  const candidates = [];

  if (platform === 'darwin') {
    const names = isIde ? ['Antigravity IDE.app'] : ['Antigravity.app'];
    const roots = ['/Applications', pathApi.join(home, 'Applications')];
    for (const root of roots) {
      for (const appName of names) {
        const base = pathApi.join(root, appName, 'Contents', 'MacOS');
        candidates.push(pathApi.join(base, isIde ? 'Antigravity IDE' : 'Antigravity'), pathApi.join(base, 'Electron'));
      }
    }
  } else if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA || '';
    const programFiles = env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const programW6432 = env.ProgramW6432 || '';
    const folders = isIde ? ['Antigravity IDE', 'antigravity-ide', 'antigravity_ide'] : ['Antigravity'];
    const exes = isIde
      ? ['Antigravity IDE.exe', 'antigravity-ide.exe', 'antigravity_ide.exe', 'Antigravity.exe']
      : ['Antigravity.exe', 'antigravity.exe'];
    for (const folder of folders) {
      for (const exe of exes) {
        if (localAppData) {
          candidates.push(pathApi.join(localAppData, 'Programs', folder, exe));
          candidates.push(pathApi.join(localAppData, folder, exe));
        }
        candidates.push(pathApi.join(programFiles, folder, exe));
        candidates.push(pathApi.join(programFilesX86, folder, exe));
        if (programW6432) candidates.push(pathApi.join(programW6432, folder, exe));
      }
    }
    const pathVar = env.PATH || env.Path || '';
    const pathExes = isIde
      ? ['Antigravity IDE.exe', 'antigravity-ide.exe', 'antigravity_ide.exe']
      : ['Antigravity.exe', 'antigravity.exe'];
    for (const dir of String(pathVar).split(';').map((d) => d.trim()).filter(Boolean)) {
      for (const exe of pathExes) {
        const full = pathApi.join(dir, exe);
        if (!isIde && isAntigravityIdePath(full)) continue;
        if (isManagerOrToolsProcess('', full, '')) continue;
        candidates.push(full);
      }
    }
  } else {
    const names = isIde ? ['antigravity-ide', 'antigravity_ide', 'Antigravity IDE'] : ['antigravity', 'Antigravity'];
    for (const name of names) {
      candidates.push(`/usr/bin/${name}`, `/usr/local/bin/${name}`, `/opt/${name}/${name}`);
    }
    const pathVar = env.PATH || '';
    for (const dir of String(pathVar).split(':').map((d) => d.trim()).filter(Boolean)) {
      for (const name of names) {
        const full = pathApi.join(dir, name);
        if (!isIde && isAntigravityIdePath(full)) continue;
        if (isManagerOrToolsProcess('', full, '')) continue;
        candidates.push(full);
      }
    }
  }
  return candidates;
}

/**
 * @param {string | null} [targetIde]
 * @param {{
 *   platform?: NodeJS.Platform,
 *   home?: string,
 *   env?: NodeJS.ProcessEnv,
 *   customExecutablePaths?: { classic?: string, ide?: string },
 *   listProcesses?: () => ReturnType<typeof listProcesses>,
 *   execFileSync?: typeof execFileSync,
 *   fs?: Pick<typeof fs, 'existsSync'>
 * }} [deps]
 * @returns {string | null}
 */
function getAntigravityExecutablePath(targetIde = null, deps = {}) {
  const existsSync = deps.fs?.existsSync || fs.existsSync;
  const custom = targetIde === 'ide' ? deps.customExecutablePaths?.ide : deps.customExecutablePaths?.classic;
  if (custom && existsSync(custom)) return custom;

  const procs = deps.listProcesses ? deps.listProcesses() : listProcesses(deps);
  const running = getRunningInstances(targetIde, procs);
  const mainRunning = running.filter((p) => !isHelperProcess(p.name, p.args, p.exePath));
  for (const proc of [...mainRunning, ...running]) {
    if (proc.exePath && !isHelperProcess(proc.name, '', proc.exePath) && existsSync(proc.exePath)) {
      return proc.exePath;
    }
  }

  const platform = deps.platform || process.platform;
  const candidates = buildExecutableCandidates(targetIde, deps);
  const found = candidates.find((p) => existsSync(p));
  if (found) return found;
  if (platform === 'win32') {
    return detectWindowsRegistryExecutable(targetIde, deps);
  }
  return null;
}

/**
 * Async variant of `getAntigravityExecutablePath` avoiding main-thread process/registry spawns.
 *
 * @param {string | null} [targetIde]
 * @param {{
 *   platform?: NodeJS.Platform,
 *   home?: string,
 *   env?: NodeJS.ProcessEnv,
 *   customExecutablePaths?: { classic?: string, ide?: string },
 *   listProcesses?: () => ReturnType<typeof listProcesses> | Promise<ReturnType<typeof listProcesses>>,
 *   execFile?: typeof execFile,
 *   execFileSync?: typeof execFileSync,
 *   fs?: Pick<typeof fs, 'existsSync'>
 * }} [deps]
 * @returns {Promise<string | null>}
 */
async function getAntigravityExecutablePathAsync(targetIde = null, deps = {}) {
  const existsSync = deps.fs?.existsSync || fs.existsSync;
  const custom = targetIde === 'ide' ? deps.customExecutablePaths?.ide : deps.customExecutablePaths?.classic;
  if (custom && existsSync(custom)) return custom;

  const procs = await listProcessesAsync(deps);
  const running = getRunningInstances(targetIde, procs);
  const mainRunning = running.filter((p) => !isHelperProcess(p.name, p.args, p.exePath));
  for (const proc of [...mainRunning, ...running]) {
    if (proc.exePath && !isHelperProcess(proc.name, '', proc.exePath) && existsSync(proc.exePath)) {
      return proc.exePath;
    }
  }

  const platform = deps.platform || process.platform;
  const candidates = buildExecutableCandidates(targetIde, deps);
  const found = candidates.find((p) => existsSync(p));
  if (found) return found;
  if (platform === 'win32') {
    return await detectWindowsRegistryExecutableAsync(targetIde, deps);
  }
  return null;
}

/**
 * @param {any} parsed
 * @param {boolean} isProductJson
 * @returns {string | null}
 */
function extractManifestVersion(parsed, isProductJson) {
  const candidates = isProductJson
    ? [parsed?.antigravityVersion, parsed?.ideVersion, parsed?.applicationVersion, parsed?.version]
    : [parsed?.version];
  for (const raw of candidates) {
    const ver = String(raw || '').trim();
    if (/^\d+\.\d+/.test(ver)) return ver;
  }
  return null;
}

/**
 * Read a top-level JSON entry (`product.json` / `package.json`) directly from an Electron
 * `app.asar` Chromium Pickle header so version detection works both inside Electron and
 * under plain Node.js without external ASAR dependencies.
 *
 * @param {string} asarPath
 * @param {string} entryName
 * @returns {any | null}
 */
function readJsonFromAsarFileSync(asarPath, entryName) {
  let fd = -1;
  try {
    fd = fs.openSync(asarPath, 'r');
    const pre = Buffer.alloc(16);
    if (fs.readSync(fd, pre, 0, 16, 0) < 16) return null;
    const headerSize = pre.readUInt32LE(4);
    const jsonByteLen = pre.readUInt32LE(12);
    if (headerSize <= 0 || jsonByteLen <= 0 || jsonByteLen > 16 * 1024 * 1024 || jsonByteLen > headerSize) {
      return null;
    }
    const headerBuf = Buffer.alloc(jsonByteLen);
    if (fs.readSync(fd, headerBuf, 0, jsonByteLen, 16) < jsonByteLen) return null;
    const index = JSON.parse(headerBuf.toString('utf8'));
    const entry = index?.files?.[entryName];
    if (!entry || typeof entry !== 'object') return null;
    if (entry.unpacked === true) {
      const unpackedPath = path.join(`${asarPath}.unpacked`, entryName);
      if (!fs.existsSync(unpackedPath)) return null;
      return JSON.parse(fs.readFileSync(unpackedPath, 'utf8'));
    }
    const offset = Number(entry.offset);
    const size = Number(entry.size);
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(size) || size <= 0 || size > 1024 * 1024) {
      return null;
    }
    const contentBuf = Buffer.alloc(size);
    const dataOffset = 8 + headerSize + offset;
    if (fs.readSync(fd, contentBuf, 0, size, dataOffset) < size) return null;
    return JSON.parse(contentBuf.toString('utf8'));
  } catch (_) {
    return null;
  } finally {
    if (fd >= 0) {
      try { fs.closeSync(fd); } catch (_) {}
    }
  }
}

/**
 * Async variant of `readJsonFromAsarFileSync`.
 *
 * @param {string} asarPath
 * @param {string} entryName
 * @returns {Promise<any | null>}
 */
async function readJsonFromAsarFileAsync(asarPath, entryName) {
  /** @type {import('node:fs').promises.FileHandle | null} */
  let handle = null;
  try {
    handle = await fs.promises.open(asarPath, 'r');
    const pre = Buffer.alloc(16);
    const preRead = await handle.read(pre, 0, 16, 0);
    if (preRead.bytesRead < 16) return null;
    const headerSize = pre.readUInt32LE(4);
    const jsonByteLen = pre.readUInt32LE(12);
    if (headerSize <= 0 || jsonByteLen <= 0 || jsonByteLen > 16 * 1024 * 1024 || jsonByteLen > headerSize) {
      return null;
    }
    const headerBuf = Buffer.alloc(jsonByteLen);
    const headerRead = await handle.read(headerBuf, 0, jsonByteLen, 16);
    if (headerRead.bytesRead < jsonByteLen) return null;
    const index = JSON.parse(headerBuf.toString('utf8'));
    const entry = index?.files?.[entryName];
    if (!entry || typeof entry !== 'object') return null;
    if (entry.unpacked === true) {
      const unpackedPath = path.join(`${asarPath}.unpacked`, entryName);
      return JSON.parse(await fs.promises.readFile(unpackedPath, 'utf8'));
    }
    const offset = Number(entry.offset);
    const size = Number(entry.size);
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(size) || size <= 0 || size > 1024 * 1024) {
      return null;
    }
    const contentBuf = Buffer.alloc(size);
    const contentRead = await handle.read(contentBuf, 0, size, 8 + headerSize + offset);
    if (contentRead.bytesRead < size) return null;
    return JSON.parse(contentBuf.toString('utf8'));
  } catch (_) {
    return null;
  } finally {
    if (handle) {
      try { await handle.close(); } catch (_) {}
    }
  }
}

/**
 * @param {string | null} exePath
 * @returns {string | null}
 */
function detectAntigravityVersion(exePath) {
  if (!exePath) return null;
  const baseDir = path.dirname(exePath);
  const dirs = [
    baseDir,
    path.resolve(baseDir, '..'),
    path.resolve(baseDir, '..', 'Resources', 'app'),
    path.resolve(baseDir, 'resources', 'app'),
    path.resolve(baseDir, '..', 'Resources', 'app.asar'),
    path.resolve(baseDir, 'resources', 'app.asar')
  ];
  const asarFiles = [
    path.resolve(baseDir, '..', 'Resources', 'app.asar'),
    path.resolve(baseDir, 'resources', 'app.asar')
  ];
  for (const dir of dirs) {
    const productPath = path.join(dir, 'product.json');
    try {
      if (fs.existsSync(productPath)) {
        const ver = extractManifestVersion(JSON.parse(fs.readFileSync(productPath, 'utf8')), true);
        if (ver) return ver;
      }
    } catch (_) {}
  }
  for (const asarPath of asarFiles) {
    const parsed = readJsonFromAsarFileSync(asarPath, 'product.json');
    const ver = parsed ? extractManifestVersion(parsed, true) : null;
    if (ver) return ver;
  }
  for (const dir of dirs) {
    const pkgPath = path.join(dir, 'package.json');
    try {
      if (fs.existsSync(pkgPath)) {
        const ver = extractManifestVersion(JSON.parse(fs.readFileSync(pkgPath, 'utf8')), false);
        if (ver) return ver;
      }
    } catch (_) {}
  }
  for (const asarPath of asarFiles) {
    const parsed = readJsonFromAsarFileSync(asarPath, 'package.json');
    const ver = parsed ? extractManifestVersion(parsed, false) : null;
    if (ver) return ver;
  }
  return null;
}

/**
 * @param {string | null} exePath
 * @returns {Promise<string | null>}
 */
async function detectAntigravityVersionAsync(exePath) {
  if (!exePath) return null;
  const baseDir = path.dirname(exePath);
  const dirs = [
    baseDir,
    path.resolve(baseDir, '..'),
    path.resolve(baseDir, '..', 'Resources', 'app'),
    path.resolve(baseDir, 'resources', 'app'),
    path.resolve(baseDir, '..', 'Resources', 'app.asar'),
    path.resolve(baseDir, 'resources', 'app.asar')
  ];
  const asarFiles = [
    path.resolve(baseDir, '..', 'Resources', 'app.asar'),
    path.resolve(baseDir, 'resources', 'app.asar')
  ];
  for (const dir of dirs) {
    const productPath = path.join(dir, 'product.json');
    try {
      const ver = extractManifestVersion(JSON.parse(await fs.promises.readFile(productPath, 'utf8')), true);
      if (ver) return ver;
    } catch (_) {}
  }
  for (const asarPath of asarFiles) {
    const parsed = await readJsonFromAsarFileAsync(asarPath, 'product.json');
    const ver = parsed ? extractManifestVersion(parsed, true) : null;
    if (ver) return ver;
  }
  for (const dir of dirs) {
    const pkgPath = path.join(dir, 'package.json');
    try {
      const ver = extractManifestVersion(JSON.parse(await fs.promises.readFile(pkgPath, 'utf8')), false);
      if (ver) return ver;
    } catch (_) {}
  }
  for (const asarPath of asarFiles) {
    const parsed = await readJsonFromAsarFileAsync(asarPath, 'package.json');
    const ver = parsed ? extractManifestVersion(parsed, false) : null;
    if (ver) return ver;
  }
  return null;
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function compareSemver(a, b) {
  const pa = String(a || '').split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = String(b || '').split('.').map((n) => Number.parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va !== vb) return va > vb ? 1 : -1;
  }
  return 0;
}

/**
 * @param {number} pid
 * @param {boolean} [force]
 */
function terminatePid(pid, force = false) {
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', [...(force ? ['/F'] : []), '/T', '/PID', String(pid)], {
        timeout: 5000,
        windowsHide: true,
        stdio: 'ignore'
      });
    } else {
      process.kill(pid, force ? 'SIGKILL' : 'SIGTERM');
    }
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * @param {number} pid
 * @param {boolean} [force]
 * @param {{ platform?: NodeJS.Platform, execFile?: typeof execFile }} [deps]
 * @returns {Promise<boolean>}
 */
async function terminatePidAsync(pid, force = false, deps = {}) {
  const platform = deps.platform || process.platform;
  const execAsyncFn = deps.execFile || execFile;
  try {
    if (platform === 'win32') {
      await new Promise((resolve, reject) => {
        execAsyncFn('taskkill', [...(force ? ['/F'] : []), '/T', '/PID', String(pid)], {
          timeout: 5000,
          windowsHide: true
        }, (err) => (err ? reject(err) : resolve(undefined)));
      });
    } else {
      process.kill(pid, force ? 'SIGKILL' : 'SIGTERM');
    }
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * @param {{ name: string, exePath: string, argv0: string, args: string }} proc
 * @param {string | null} targetIde
 */
function matchesLanguageServerTarget(proc, targetIde) {
  if (classifyProcess(proc.name, proc.exePath, proc.argv0, proc.args) !== 'language_server') return false;
  if (targetIde === 'all') return true;
  const wantIde = targetIde === 'ide';
  const isIdeServer = isAntigravityIdeStr(proc.exePath) || isAntigravityIdeStr(proc.args);
  return wantIde === isIdeServer;
}

/**
 * Return PIDs of running language_server processes for the specified target (`classic`/`null` vs `ide`).
 *
 * @param {string | null} [targetIde]
 * @param {{ platform?: NodeJS.Platform, execFileSync?: typeof execFileSync, listProcesses?: () => ReturnType<typeof listProcesses> }} [deps]
 * @returns {number[]}
 */
function getLanguageServerPids(targetIde = null, deps = {}) {
  const procs = deps.listProcesses ? deps.listProcesses() : listProcesses(deps);
  return procs.filter((p) => matchesLanguageServerTarget(p, targetIde)).map((p) => p.pid);
}

/**
 * Detect whether the target's running `language_server` receives its host bridge token
 * over stdin (`--read_host_bridge_token_from_stdin`, Antigravity 2.x desktop), where
 * killing only `language_server` leaves the Electron host's cached OAuth bridge stale.
 *
 * @param {string | null} [targetIde]
 * @param {{ platform?: NodeJS.Platform, execFileSync?: typeof execFileSync, listProcesses?: () => ReturnType<typeof listProcesses> }} [deps]
 * @returns {boolean}
 */
function hasStdinBridgeLanguageServer(targetIde = null, deps = {}) {
  const procs = deps.listProcesses ? deps.listProcesses() : listProcesses(deps);
  return procs.some((p) => (
    matchesLanguageServerTarget(p, targetIde)
    && String(p.args || '').toLowerCase().includes('--read_host_bridge_token_from_stdin')
  ));
}

/**
 * @param {string | null} targetIde
 * @param {{ platform?: NodeJS.Platform, execFileSync?: typeof execFileSync, listProcesses?: () => ReturnType<typeof listProcesses>, terminatePid?: (pid: number, force?: boolean) => boolean }} [deps]
 */
function killLanguageServer(targetIde = null, deps = {}) {
  const procs = deps.listProcesses ? deps.listProcesses() : listProcesses(deps);
  const killFn = deps.terminatePid || terminatePid;
  let killed = 0;
  for (const p of procs) {
    if (!matchesLanguageServerTarget(p, targetIde)) continue;
    if (killFn(p.pid, true)) killed += 1;
  }
  return killed;
}

/**
 * @param {string | null} [targetIde]
 * @param {{
 *   platform?: NodeJS.Platform,
 *   execFile?: typeof execFile,
 *   execFileSync?: typeof execFileSync,
 *   listProcesses?: () => ReturnType<typeof listProcesses> | Promise<ReturnType<typeof listProcesses>>,
 *   terminatePid?: (pid: number, force?: boolean) => boolean | Promise<boolean>
 * }} [deps]
 */
async function killLanguageServerAsync(targetIde = null, deps = {}) {
  const procs = await listProcessesAsync(deps);
  const killFn = deps.terminatePid
    ? (/** @type {number} */ pid, /** @type {boolean | undefined} */ force) => Promise.resolve(deps.terminatePid?.(pid, force))
    : (/** @type {number} */ pid, /** @type {boolean | undefined} */ force) => terminatePidAsync(pid, force, deps);
  let killed = 0;
  for (const p of procs) {
    if (!matchesLanguageServerTarget(p, targetIde)) continue;
    if (await killFn(p.pid, true)) killed += 1;
  }
  return killed;
}

/**
 * @param {{ platform?: NodeJS.Platform, execFileSync?: typeof execFileSync, listProcesses?: () => ReturnType<typeof listProcesses>, terminatePid?: (pid: number, force?: boolean) => boolean }} [deps]
 */
function killAcpServers(deps = {}) {
  const procs = deps.listProcesses ? deps.listProcesses() : listProcesses(deps);
  const killFn = deps.terminatePid || terminatePid;
  let killed = 0;
  for (const p of procs) {
    if (classifyProcess(p.name, p.exePath, p.argv0, p.args) === 'acp_server') {
      if (killFn(p.pid, true)) killed += 1;
    }
  }
  return killed;
}

/**
 * @param {{
 *   platform?: NodeJS.Platform,
 *   execFile?: typeof execFile,
 *   execFileSync?: typeof execFileSync,
 *   listProcesses?: () => ReturnType<typeof listProcesses> | Promise<ReturnType<typeof listProcesses>>,
 *   terminatePid?: (pid: number, force?: boolean) => boolean | Promise<boolean>
 * }} [deps]
 */
async function killAcpServersAsync(deps = {}) {
  const procs = await listProcessesAsync(deps);
  const killFn = deps.terminatePid
    ? (/** @type {number} */ pid, /** @type {boolean | undefined} */ force) => Promise.resolve(deps.terminatePid?.(pid, force))
    : (/** @type {number} */ pid, /** @type {boolean | undefined} */ force) => terminatePidAsync(pid, force, deps);
  let killed = 0;
  for (const p of procs) {
    if (classifyProcess(p.name, p.exePath, p.argv0, p.args) === 'acp_server') {
      if (await killFn(p.pid, true)) killed += 1;
    }
  }
  return killed;
}

/**
 * @param {string | null} targetIde
 * @param {number} [timeoutMs]
 * @param {{
 *   platform?: NodeJS.Platform,
 *   execFile?: typeof execFile,
 *   execFileSync?: typeof execFileSync,
 *   listProcesses?: () => ReturnType<typeof listProcesses> | Promise<ReturnType<typeof listProcesses>>,
 *   sleep?: (ms: number) => Promise<void>,
 *   excludePids?: number[] | Set<number>
 * }} [deps]
 */
async function waitForLanguageServerRespawn(targetIde = null, timeoutMs = 15_000, deps = {}) {
  const sleepFn = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const deadline = Date.now() + timeoutMs;
  const excluded = deps.excludePids instanceof Set
    ? deps.excludePids
    : new Set(Array.isArray(deps.excludePids) ? deps.excludePids : []);
  let attempt = 0;
  while (Date.now() < deadline) {
    const procs = await listProcessesAsync(deps);
    const alive = procs.some((p) => !excluded.has(p.pid) && matchesLanguageServerTarget(p, targetIde));
    if (alive) return true;
    const delayMs = Math.min(500, 150 + attempt * 100);
    attempt += 1;
    await sleepFn(delayMs);
  }
  return false;
}

/**
 * @param {number} timeoutSec
 * @param {string | null} targetIde
 * @param {{
 *   platform?: NodeJS.Platform,
 *   execFile?: typeof execFile,
 *   execFileSync?: typeof execFileSync,
 *   listProcesses?: () => ReturnType<typeof listProcesses> | Promise<ReturnType<typeof listProcesses>>,
 *   terminatePid?: (pid: number, force?: boolean) => boolean | Promise<boolean>,
 *   sleep?: (ms: number) => Promise<void>
 * }} [deps]
 */
async function closeAntigravity(timeoutSec = 20, targetIde = null, deps = {}) {
  const platform = deps.platform || process.platform;
  const listFn = () => listProcessesAsync(deps);
  const killFn = deps.terminatePid
    ? (/** @type {number} */ pid, /** @type {boolean | undefined} */ force) => Promise.resolve(deps.terminatePid?.(pid, force))
    : (/** @type {number} */ pid, /** @type {boolean | undefined} */ force) => terminatePidAsync(pid, force, deps);
  const sleepFn = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));

  const initial = getRunningInstances(targetIde, await listFn());
  if (initial.length === 0) {
    await killLanguageServerAsync(targetIde, deps);
    const lsDeadline = Date.now() + 1500;
    for (let attempt = 0; attempt < 4 && Date.now() < lsDeadline; attempt += 1) {
      const remainingLs = (await listFn()).filter((p) => matchesLanguageServerTarget(p, targetIde));
      if (remainingLs.length === 0) break;
      await Promise.all(remainingLs.map((p) => killFn(p.pid, true)));
      await sleepFn(200);
    }
    return;
  }

  if (platform === 'win32') {
    // On Windows, Chromium tray/helper processes ignore WM_CLOSE; force-kill PID tree like Antigravity-Manager.
    await Promise.all(initial.map((proc) => killFn(proc.pid, true)));
    await sleepFn(300);
    const deadline = Date.now() + Math.min(Math.max(2, timeoutSec), 5) * 1000;
    while (Date.now() < deadline) {
      const remaining = getRunningInstances(targetIde, await listFn());
      if (remaining.length === 0) break;
      await Promise.all(remaining.map((proc) => killFn(proc.pid, true)));
      await sleepFn(250);
    }
    await killLanguageServerAsync(targetIde, deps);
    const lsDeadline = Date.now() + 1500;
    for (let attempt = 0; attempt < 4 && Date.now() < lsDeadline; attempt += 1) {
      const remainingLs = (await listFn()).filter((p) => matchesLanguageServerTarget(p, targetIde));
      if (remainingLs.length === 0) break;
      await Promise.all(remainingLs.map((p) => killFn(p.pid, true)));
      await sleepFn(200);
    }
    return;
  }

  for (const proc of initial) {
    await killFn(proc.pid, false);
  }
  const deadline = Date.now() + Math.max(2, timeoutSec) * 1000;
  while (Date.now() < deadline) {
    const remaining = getRunningInstances(targetIde, await listFn());
    if (remaining.length === 0) {
      await killLanguageServerAsync(targetIde, deps);
      return;
    }
    await sleepFn(400);
  }
  const survivors = getRunningInstances(targetIde, await listFn());
  for (const proc of survivors) {
    await killFn(proc.pid, true);
  }
  if (survivors.length > 0) {
    const reapDeadline = Date.now() + 2000;
    while (Date.now() < reapDeadline) {
      if (getRunningInstances(targetIde, await listFn()).length === 0) break;
      await sleepFn(150);
    }
  }
  await killLanguageServerAsync(targetIde, deps);
}

/**
 * Strip Token Monitor Electron / AppImage env vars before spawning Antigravity.
 *
 * @param {NodeJS.ProcessEnv} baseEnv
 * @param {NodeJS.Platform} platform
 * @returns {NodeJS.ProcessEnv}
 */
function cleanSpawnEnv(baseEnv, platform) {
  const env = { ...baseEnv };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  if (platform === 'linux') {
    delete env.APPIMAGE;
    delete env.APPDIR;
    delete env.OWD;
  }
  return env;
}

/**
 * @param {string | null} targetIde
 * @param {string | null} exePath
 * @param {string[]} [args]
 * @param {{
 *   platform?: NodeJS.Platform,
 *   env?: NodeJS.ProcessEnv,
 *   customExecutablePaths?: { classic?: string, ide?: string },
 *   spawn?: typeof spawn,
 *   fs?: Pick<typeof fs, 'existsSync'>
 * }} [deps]
 */
function startAntigravity(targetIde = null, exePath = null, args = [], deps = {}) {
  const platform = deps.platform || process.platform;
  const spawnFn = deps.spawn || spawn;
  const existsSync = deps.fs?.existsSync || fs.existsSync;
  const resolved = exePath || getAntigravityExecutablePath(targetIde, deps);
  if (!resolved) {
    const err = new Error('Antigravity executable not found');
    /** @type {any} */ (err).code = 'EXECUTABLE_NOT_FOUND';
    throw err;
  }

  const cleanArgs = sanitizeRestartArgs(args);
  const spawnEnv = cleanSpawnEnv(deps.env || process.env, platform);

  if (platform === 'darwin' && resolved.includes('.app/Contents/MacOS/')) {
    const markerIdx = resolved.indexOf('.app/Contents/MacOS/');
    const appBundle = resolved.slice(0, markerIdx + 4);
    const child = spawnFn('open', ['-a', appBundle, ...(cleanArgs.length > 0 ? ['--args', ...cleanArgs] : [])], {
      detached: true,
      stdio: 'ignore',
      env: spawnEnv
    });
    child?.on?.('error', () => {});
    child?.unref?.();
    return;
  }

  const pathApi = platform === 'win32' ? path.win32 : path;
  const parentDir = pathApi.dirname(resolved);
  /** @type {import('node:child_process').SpawnOptions} */
  const spawnOpts = {
    detached: true,
    stdio: 'ignore',
    env: spawnEnv,
    windowsHide: false
  };
  if (parentDir && (deps.spawn || existsSync(parentDir))) {
    spawnOpts.cwd = parentDir;
  }

  const child = spawnFn(resolved, cleanArgs, spawnOpts);
  child?.on?.('error', () => {});
  child?.unref?.();
}

/**
 * @param {string | null} [targetIde]
 * @param {{ platform?: NodeJS.Platform, execFileSync?: typeof execFileSync, listProcesses?: () => ReturnType<typeof listProcesses> }} [deps]
 * @returns {string[]}
 */
function getArgsFromRunningProcess(targetIde = null, deps = {}) {
  const procs = deps.listProcesses ? deps.listProcesses() : listProcesses(deps);
  const mainRunning = getMainRunningInstances(targetIde, procs);
  if (mainRunning.length === 0) return [];
  const main = mainRunning[0];
  let raw = String(main.args || '').trim();
  const exePath = String(main.exePath || '').trim();
  let strippedExe = false;
  if (exePath) {
    const quoted = `"${exePath}"`;
    if (raw === quoted || raw.startsWith(`${quoted} `) || raw.startsWith(`${quoted}\t`)) {
      raw = raw.slice(quoted.length).trim();
      strippedExe = true;
    } else if (raw === exePath || raw.startsWith(`${exePath} `) || raw.startsWith(`${exePath}\t`)) {
      raw = raw.slice(exePath.length).trim();
      strippedExe = true;
    }
  }
  const parts = raw.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  const argTokens = strippedExe ? parts : parts.slice(1);
  const extracted = argTokens
    .map((p) => p.replace(/^(--[^=]+=)"(.*)"$/, '$1$2').replace(/^"(.*)"$/, '$1'));
  return sanitizeRestartArgs(extracted);
}

module.exports = {
  buildExecutableCandidates,
  chromiumUserDataDir,
  classifyProcess,
  cleanSpawnEnv,
  closeAntigravity,
  compareSemver,
  detectAntigravityVersion,
  detectAntigravityVersionAsync,
  detectWindowsRegistryExecutable,
  detectWindowsRegistryExecutableAsync,
  getAntigravityExecutablePath,
  getAntigravityExecutablePathAsync,
  getArgsFromRunningProcess,
  getLanguageServerPids,
  getMainRunningInstances,
  getRunningInstances,
  getUserDataDirFromProcess,
  hasStdinBridgeLanguageServer,
  isAntigravityIdePath,
  isAntigravityIdeStr,
  isAntigravityRunning,
  isHelperProcess,
  isManagerOrToolsProcess,
  isProcessRunningByName,
  killAcpServers,
  killAcpServersAsync,
  killLanguageServer,
  killLanguageServerAsync,
  listProcesses,
  listProcessesAsync,
  sanitizeRestartArgs,
  startAntigravity,
  terminatePidAsync,
  waitForLanguageServerRespawn
};
