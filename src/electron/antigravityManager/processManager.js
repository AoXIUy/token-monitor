// @ts-check
'use strict';

const { execFileSync, spawn } = require('node:child_process');
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
 * Extract `--user-data-dir` value from lowered command args string.
 * @param {string} argsStr
 * @returns {string | null}
 */
function chromiumUserDataDir(argsStr) {
  const needle = 'user-data-dir';
  const pos = argsStr.indexOf(needle);
  if (pos < 0) return null;
  let rest = argsStr.slice(pos + needle.length).replace(/^[=: ]+/, '');
  if (rest.startsWith('"')) rest = rest.slice(1);
  const quotedEnd = rest.indexOf('" --');
  const bareEnd = rest.indexOf(' --');
  const end = quotedEnd >= 0 ? quotedEnd : (bareEnd >= 0 ? bareEnd : rest.length);
  return rest.slice(0, end).replace(/[" ]+$/, '');
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
 * @param {{ platform?: NodeJS.Platform, execFileSync?: typeof execFileSync }} [deps]
 * @returns {Array<{ pid: number, name: string, exePath: string, argv0: string, args: string }>}
 */
function listProcesses(deps = {}) {
  const platform = deps.platform || process.platform;
  const execFn = deps.execFileSync || execFileSync;

  try {
    if (platform === 'win32') {
      const psScript = 'Get-CimInstance Win32_Process | Select-Object ProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress';
      const out = execFn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], {
        encoding: 'utf8',
        timeout: 8000,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024
      });
      const parsed = JSON.parse(String(out || '[]'));
      const rows = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
      return rows.map((row) => {
        const cmd = String(row?.CommandLine || '');
        return {
          pid: Number(row?.ProcessId || 0),
          name: String(row?.Name || ''),
          exePath: String(row?.ExecutablePath || ''),
          argv0: String(row?.ExecutablePath || row?.Name || ''),
          args: cmd
        };
      }).filter((p) => p.pid > 0 && p.pid !== process.pid);
    }

    const out = execFn('ps', ['-eo', 'pid=,comm=,args='], {
      encoding: 'utf8',
      timeout: 5000,
      maxBuffer: 8 * 1024 * 1024
    });
    return String(out || '').split('\n').flatMap((line) => {
      const match = line.trim().match(/^(\d+)\s+(\S+)\s*(.*)$/);
      if (!match) return [];
      const pid = Number(match[1]);
      if (!Number.isFinite(pid) || pid <= 0 || pid === process.pid) return [];
      const comm = match[2];
      const fullArgs = match[3] || comm;
      const argv0 = fullArgs.split(/\s+/)[0] || comm;
      return [{
        pid,
        name: path.basename(comm),
        exePath: argv0.startsWith('/') ? argv0 : comm,
        argv0,
        args: fullArgs
      }];
    });
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
 * @param {string | null} [targetIde]
 * @param {{ listProcesses?: () => ReturnType<typeof listProcesses> }} [deps]
 * @returns {boolean}
 */
function isAntigravityRunning(targetIde = null, deps = {}) {
  const procs = deps.listProcesses ? deps.listProcesses() : listProcesses();
  return getRunningInstances(targetIde, procs).length > 0;
}

/**
 * @param {string} processName
 * @param {{ listProcesses?: () => ReturnType<typeof listProcesses> }} [deps]
 * @returns {boolean}
 */
function isProcessRunningByName(processName, deps = {}) {
  const needle = String(processName || '').trim().toLowerCase();
  if (!needle) return false;
  const procs = deps.listProcesses ? deps.listProcesses() : listProcesses();
  return procs.some((p) => {
    const kind = classifyProcess(p.name, p.exePath, p.argv0, p.args);
    if (kind === 'manager') return false;
    return p.name.toLowerCase() === needle || p.name.toLowerCase() === `${needle}.exe` || kind === needle;
  });
}

/**
 * @param {string | null} [targetIde]
 * @param {{ listProcesses?: () => ReturnType<typeof listProcesses> }} [deps]
 * @returns {string | null}
 */
function getUserDataDirFromProcess(targetIde = null, deps = {}) {
  const procs = deps.listProcesses ? deps.listProcesses() : listProcesses();
  const matching = getRunningInstances(targetIde, procs);
  for (const proc of matching) {
    const dir = chromiumUserDataDir(proc.args.toLowerCase());
    if (dir) {
      // Preserve original casing by matching index in original args
      const idx = proc.args.toLowerCase().indexOf('user-data-dir');
      if (idx >= 0) {
        let rest = proc.args.slice(idx + 'user-data-dir'.length).replace(/^[=: ]+/, '');
        if (rest.startsWith('"')) rest = rest.slice(1);
        const end = rest.indexOf('" --') >= 0 ? rest.indexOf('" --') : (rest.indexOf(' --') >= 0 ? rest.indexOf(' --') : rest.length);
        const rawDir = rest.slice(0, end).replace(/[" ]+$/, '');
        if (rawDir) return rawDir;
      }
      return dir;
    }
  }
  return null;
}

/**
 * @param {string | null} [targetIde]
 * @param {{
 *   platform?: NodeJS.Platform,
 *   home?: string,
 *   env?: NodeJS.ProcessEnv,
 *   customExecutablePaths?: { classic?: string, ide?: string },
 *   listProcesses?: () => ReturnType<typeof listProcesses>
 * }} [deps]
 * @returns {string | null}
 */
function getAntigravityExecutablePath(targetIde = null, deps = {}) {
  const custom = targetIde === 'ide' ? deps.customExecutablePaths?.ide : deps.customExecutablePaths?.classic;
  if (custom && fs.existsSync(custom)) return custom;

  const procs = deps.listProcesses ? deps.listProcesses() : listProcesses();
  const running = getRunningInstances(targetIde, procs);
  for (const proc of running) {
    if (proc.exePath && fs.existsSync(proc.exePath)) return proc.exePath;
  }

  const platform = deps.platform || process.platform;
  const home = deps.home || os.homedir();
  const env = deps.env || process.env;
  const isIde = targetIde === 'ide';
  /** @type {string[]} */
  const candidates = [];

  if (platform === 'darwin') {
    const names = isIde ? ['Antigravity IDE.app'] : ['Antigravity.app'];
    const roots = ['/Applications', path.join(home, 'Applications')];
    for (const root of roots) {
      for (const appName of names) {
        const base = path.join(root, appName, 'Contents', 'MacOS');
        candidates.push(path.join(base, isIde ? 'Antigravity IDE' : 'Antigravity'), path.join(base, 'Electron'));
      }
    }
  } else if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA || '';
    const programFiles = env.ProgramFiles || 'C:\\Program Files';
    const names = isIde ? ['Antigravity IDE', 'AntigravityIDE'] : ['Antigravity'];
    for (const name of names) {
      const exe = isIde ? 'Antigravity IDE.exe' : 'Antigravity.exe';
      if (localAppData) candidates.push(path.join(localAppData, 'Programs', name, exe));
      candidates.push(path.join(programFiles, name, exe));
    }
  } else {
    const names = isIde ? ['antigravity-ide', 'Antigravity IDE'] : ['antigravity', 'Antigravity'];
    for (const name of names) {
      candidates.push(`/usr/bin/${name}`, `/usr/local/bin/${name}`, `/opt/${name}/${name}`);
    }
  }

  return candidates.find((p) => fs.existsSync(p)) || null;
}

/**
 * @param {string | null} exePath
 * @returns {string | null}
 */
function detectAntigravityVersion(exePath) {
  if (!exePath) return null;
  const dirs = [
    path.dirname(exePath),
    path.resolve(path.dirname(exePath), '..'),
    path.resolve(path.dirname(exePath), '..', 'Resources', 'app'),
    path.resolve(path.dirname(exePath), 'resources', 'app')
  ];
  for (const dir of dirs) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        const ver = String(pkg?.version || '').trim();
        if (/^\d+\.\d+/.test(ver)) return ver;
      } catch (_) {}
    }
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
 * @param {string | null} targetIde
 * @param {{ listProcesses?: () => ReturnType<typeof listProcesses>, terminatePid?: (pid: number, force?: boolean) => boolean }} [deps]
 */
function killLanguageServer(targetIde = null, deps = {}) {
  const procs = deps.listProcesses ? deps.listProcesses() : listProcesses();
  const killFn = deps.terminatePid || terminatePid;
  const wantIde = targetIde === 'ide';
  let killed = 0;
  for (const p of procs) {
    if (classifyProcess(p.name, p.exePath, p.argv0, p.args) !== 'language_server') continue;
    const isIdeServer = isAntigravityIdeStr(p.exePath) || isAntigravityIdeStr(p.args);
    if (wantIde !== isIdeServer && targetIde !== null) continue;
    if (killFn(p.pid, true)) killed += 1;
  }
  return killed;
}

/**
 * @param {{ listProcesses?: () => ReturnType<typeof listProcesses>, terminatePid?: (pid: number, force?: boolean) => boolean }} [deps]
 */
function killAcpServers(deps = {}) {
  const procs = deps.listProcesses ? deps.listProcesses() : listProcesses();
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
 * @param {string | null} targetIde
 * @param {number} [timeoutMs]
 * @param {{ listProcesses?: () => ReturnType<typeof listProcesses>, sleep?: (ms: number) => Promise<void> }} [deps]
 */
async function waitForLanguageServerRespawn(targetIde = null, timeoutMs = 15_000, deps = {}) {
  const sleepFn = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const deadline = Date.now() + timeoutMs;
  const wantIde = targetIde === 'ide';
  while (Date.now() < deadline) {
    const procs = deps.listProcesses ? deps.listProcesses() : listProcesses();
    const alive = procs.some((p) => {
      if (classifyProcess(p.name, p.exePath, p.argv0, p.args) !== 'language_server') return false;
      const isIdeServer = isAntigravityIdeStr(p.exePath) || isAntigravityIdeStr(p.args);
      return targetIde === null || wantIde === isIdeServer;
    });
    if (alive) return true;
    await sleepFn(500);
  }
  return false;
}

/**
 * @param {number} timeoutSec
 * @param {string | null} targetIde
 * @param {{ listProcesses?: () => ReturnType<typeof listProcesses>, terminatePid?: (pid: number, force?: boolean) => boolean, sleep?: (ms: number) => Promise<void> }} [deps]
 */
async function closeAntigravity(timeoutSec = 20, targetIde = null, deps = {}) {
  const listFn = deps.listProcesses || listProcesses;
  const killFn = deps.terminatePid || terminatePid;
  const sleepFn = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));

  const initial = getRunningInstances(targetIde, listFn());
  if (initial.length === 0) return;

  for (const proc of initial) {
    killFn(proc.pid, false);
  }
  const deadline = Date.now() + Math.max(2, timeoutSec) * 1000;
  while (Date.now() < deadline) {
    const remaining = getRunningInstances(targetIde, listFn());
    if (remaining.length === 0) return;
    await sleepFn(400);
  }
  for (const proc of getRunningInstances(targetIde, listFn())) {
    killFn(proc.pid, true);
  }
}

/**
 * @param {string | null} targetIde
 * @param {string | null} exePath
 * @param {string[]} [args]
 * @param {{ platform?: NodeJS.Platform, customExecutablePaths?: { classic?: string, ide?: string } }} [deps]
 */
function startAntigravity(targetIde = null, exePath = null, args = [], deps = {}) {
  const platform = deps.platform || process.platform;
  const resolved = exePath || getAntigravityExecutablePath(targetIde, deps);
  if (!resolved) {
    const err = new Error('Antigravity executable not found');
    /** @type {any} */ (err).code = 'EXECUTABLE_NOT_FOUND';
    throw err;
  }

  if (platform === 'darwin' && resolved.includes('.app/Contents/MacOS/')) {
    const appBundle = resolved.slice(0, resolved.indexOf('.app') + 4);
    const child = spawn('open', ['-a', appBundle, ...(args.length > 0 ? ['--args', ...args] : [])], {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();
    return;
  }

  const child = spawn(resolved, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: false
  });
  child.unref();
}

/**
 * @param {string | null} [targetIde]
 * @param {{ listProcesses?: () => ReturnType<typeof listProcesses> }} [deps]
 * @returns {string[]}
 */
function getArgsFromRunningProcess(targetIde = null, deps = {}) {
  const procs = deps.listProcesses ? deps.listProcesses() : listProcesses();
  const running = getRunningInstances(targetIde, procs);
  if (running.length === 0) return [];
  const raw = running[0].args || '';
  const parts = raw.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  return parts.slice(1).map((p) => p.replace(/^"|"$/g, '')).filter((arg) => !arg.startsWith('--type='));
}

module.exports = {
  chromiumUserDataDir,
  classifyProcess,
  closeAntigravity,
  compareSemver,
  detectAntigravityVersion,
  getAntigravityExecutablePath,
  getArgsFromRunningProcess,
  getRunningInstances,
  getUserDataDirFromProcess,
  isAntigravityIdePath,
  isAntigravityIdeStr,
  isAntigravityRunning,
  isManagerOrToolsProcess,
  isProcessRunningByName,
  killAcpServers,
  killLanguageServer,
  listProcesses,
  startAntigravity,
  waitForLanguageServerRespawn
};
