// @ts-check
'use strict';

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const processManager = require('./processManager');
const antigravityProbe = require('../../shared/providers/antigravity/probe');

const DEFAULT_AUTO_RESUME_PROMPT = '继续';
const MAX_AUTO_RESUME_PROMPT_LENGTH = 500;
const MAX_INTERRUPTED_CONVERSATION_AGE_MS = 20 * 60 * 1000;
const MAX_CONVERSATIONS_TO_RESUME = 3;
const TRANSCRIPT_TAIL_MAX_BYTES = 128 * 1024;
const MIN_VALID_USER_INPUT_MS = Date.UTC(2020, 0, 1);

/** @type {any} */
let cachedSqlite = undefined;
/**
 * @param {{ sqlite?: any }} [deps]
 */
function resolveSqlite(deps = {}) {
  if (deps?.sqlite !== undefined) return deps.sqlite;
  if (cachedSqlite === undefined) {
    try {
      cachedSqlite = require('node:sqlite');
    } catch (_) {
      cachedSqlite = null;
    }
  }
  return cachedSqlite;
}

/**
 * Normalize customizable post-switch auto-resume prompt.
 * @param {unknown} value
 * @param {string} [fallback]
 * @returns {string}
 */
function normalizeAutoResumePrompt(value, fallback = DEFAULT_AUTO_RESUME_PROMPT) {
  if (typeof value !== 'string') return fallback;
  const cleaned = value.replace(/[\r\n]+/g, ' ').trim().slice(0, MAX_AUTO_RESUME_PROMPT_LENGTH);
  return cleaned || fallback;
}

/**
 * @param {unknown} raw
 * @returns {number}
 */
function parseSqliteTimestampMs(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : 0;
  const text = String(raw || '').trim();
  if (!text) return 0;
  if (/^\d+$/.test(text)) {
    const n = Number(text);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }
  const isoLike = text
    .replace(/^(\d{4}-\d{2}-\d{2})\s+/, '$1T')
    .replace(/(\.\d{3})\d+(?=[+-Z]|$)/, '$1');
  const ms = Date.parse(isoLike);
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}

const USER_CANCEL_MESSAGE_RE = /\b(cancel(?:l)?ed by user|user cancel(?:l)?ed|aborted by user|request cancel(?:l)?ed|turn cancel(?:l)?ed)\b/i;
const INTERACTIVE_USER_WAIT_TOOLS = new Set([
  'ask_question',
  'ask_user',
  'request_user_input',
  'confirm_action'
]);

/**
 * @param {{ homeDir?: string, env?: NodeJS.ProcessEnv, targetClient?: string | null }} [opts]
 * @returns {string[]}
 */
function candidateAntigravityRoots(opts = {}) {
  const home = opts.homeDir || os.homedir();
  const env = opts.env || process.env;
  const target = String(opts.targetClient || '').trim().toLowerCase();
  const includeClassic = !target || target === 'auto' || target === 'classic' || target === 'agy' || target === 'acp';
  const includeIde = !target || target === 'auto' || target === 'ide';
  const includeCli = !target || target === 'auto' || target === 'agy';
  const roots = [
    typeof env.ANTIGRAVITY_HOME === 'string' ? env.ANTIGRAVITY_HOME.trim() : '',
    typeof env.ANTIGRAVITY_DATA_DIR === 'string' ? env.ANTIGRAVITY_DATA_DIR.trim() : '',
    includeClassic ? path.join(home, '.gemini', 'antigravity') : '',
    includeIde ? path.join(home, '.gemini', 'antigravity-ide') : '',
    includeCli ? path.join(home, '.gemini', 'antigravity-cli') : ''
  ].filter(Boolean);
  return [...new Set(roots)];
}

/**
 * @param {Record<string, any>} step
 * @returns {boolean}
 */
function isStepUserCanceled(step) {
  if (!step || typeof step !== 'object') return false;
  if (step.canceled === true || step.cancelled === true || step.userCanceled === true || step.user_canceled === true) {
    return true;
  }
  const status = String(step.status || '').trim().toUpperCase();
  if (status === 'CANCELED' || status === 'CANCELLED' || status === 'ABORTED' || status === 'INTERRUPTED_BY_USER') {
    return true;
  }
  const text = `${step.error || ''} ${step.error_message || ''} ${step.message || ''} ${step.content || ''}`;
  return USER_CANCEL_MESSAGE_RE.test(text);
}

/**
 * @param {Record<string, any>} step
 * @returns {boolean}
 */
function isStepWaitingOnUserPrompt(step) {
  if (!step || typeof step !== 'object' || !Array.isArray(step.tool_calls)) return false;
  return step.tool_calls.some((/** @type {any} */ tc) => {
    const toolName = String(tc?.name || tc?.tool_name || '').trim().toLowerCase();
    if (INTERACTIVE_USER_WAIT_TOOLS.has(toolName)) return true;
    const args = tc?.arguments && typeof tc.arguments === 'object' ? tc.arguments : null;
    if (args?.ArtifactMetadata?.RequestFeedback === true) return true;
    return false;
  });
}

/**
 * Inspect the tail of a conversation's `transcript.jsonl` / `transcript_full.jsonl`
 * to determine whether its latest user turn ended cleanly (`PLANNER_RESPONSE` `DONE`
 * without pending tool calls) or stopped mid-task (e.g. quota exhaustion / LS restart).
 *
 * @param {string} rootDir
 * @param {string} conversationId
 * @param {Pick<typeof fs, 'existsSync' | 'openSync' | 'fstatSync' | 'readSync' | 'closeSync'>} [fsApi]
 * @returns {{ interrupted: boolean, definitive: boolean, reason: string }}
 */
function inspectTranscriptTailInterruption(rootDir, conversationId, fsApi = fs) {
  const logsDir = path.join(rootDir, 'brain', conversationId, '.system_generated', 'logs');
  const candidates = [
    path.join(logsDir, 'transcript.jsonl'),
    path.join(logsDir, 'transcript_full.jsonl')
  ];
  const filePath = candidates.find((p) => {
    try { return fsApi.existsSync(p); } catch (_) { return false; }
  });
  if (!filePath) {
    return { interrupted: false, definitive: false, reason: '' };
  }

  let fd = -1;
  try {
    fd = fsApi.openSync(filePath, 'r');
    const stat = fsApi.fstatSync(fd);
    if (!stat.isFile() || stat.size <= 0) {
      return { interrupted: false, definitive: false, reason: '' };
    }
    const readLen = Math.min(stat.size, TRANSCRIPT_TAIL_MAX_BYTES);
    const offset = Math.max(0, stat.size - readLen);
    const buf = Buffer.alloc(readLen);
    const bytesRead = fsApi.readSync(fd, buf, 0, readLen, offset);
    let text = buf.subarray(0, bytesRead).toString('utf8');
    if (offset > 0) {
      const firstNewline = text.indexOf('\n');
      if (firstNewline >= 0) {
        text = text.slice(firstNewline + 1);
      }
    }

    /** @type {Map<number, any>} */
    const stepsByIndex = new Map();
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object' && Number.isSafeInteger(parsed.step_index) && parsed.step_index >= 0) {
          stepsByIndex.set(parsed.step_index, parsed);
        }
      } catch (_) {}
    }

    if (stepsByIndex.size === 0) {
      return { interrupted: false, definitive: false, reason: '' };
    }

    const ordered = [...stepsByIndex.entries()].sort((a, b) => a[0] - b[0]).map(([, row]) => row);
    const lastStep = ordered[ordered.length - 1];
    if (!lastStep) {
      return { interrupted: false, definitive: false, reason: '' };
    }

    let lastUserIdx = -1;
    for (let i = ordered.length - 1; i >= 0; i -= 1) {
      if (ordered[i].type === 'USER_INPUT') {
        lastUserIdx = i;
        break;
      }
    }
    const turnSteps = lastUserIdx >= 0 ? ordered.slice(lastUserIdx) : ordered;
    if (turnSteps.some((step) => step.status === 'RUNNING' || step.status === 'ACTIVE')) {
      return { interrupted: true, definitive: true, reason: 'step_still_running' };
    }
    if (turnSteps.some(isStepUserCanceled)) {
      return { interrupted: false, definitive: true, reason: '' };
    }

    let lastPlannerIdx = -1;
    for (let i = turnSteps.length - 1; i >= 0; i -= 1) {
      if (turnSteps[i].type === 'PLANNER_RESPONSE') {
        lastPlannerIdx = i;
        break;
      }
    }
    if (lastPlannerIdx >= 0) {
      const lastPlanner = turnSteps[lastPlannerIdx];
      if (isStepWaitingOnUserPrompt(lastPlanner)) {
        return { interrupted: false, definitive: true, reason: '' };
      }
      const plannerHasToolCalls = Array.isArray(lastPlanner.tool_calls) && lastPlanner.tool_calls.length > 0;
      const plannerHasError = Boolean(lastPlanner.error || lastPlanner.error_message || lastPlanner.failure);
      const trailingSteps = turnSteps.slice(lastPlannerIdx + 1);
      const trailingIndicatesInterruption = trailingSteps.some((step) => (
        Boolean(step.error || step.error_message || step.failure)
        || step.type === 'SYSTEM_MESSAGE'
        || step.type === 'ERROR'
        || step.type === 'USER_INPUT'
      ));
      if (lastPlanner.status === 'DONE' && !plannerHasToolCalls && !plannerHasError && !trailingIndicatesInterruption) {
        return { interrupted: false, definitive: true, reason: '' };
      }
    }

    const hasToolCalls = Array.isArray(lastStep.tool_calls) && lastStep.tool_calls.length > 0;
    const hasError = Boolean(lastStep.error || lastStep.error_message || lastStep.failure);
    const finishedCleanly = (
      lastStep.type === 'PLANNER_RESPONSE'
      && lastStep.status === 'DONE'
      && !hasToolCalls
      && !hasError
    );

    if (finishedCleanly) {
      return { interrupted: false, definitive: true, reason: '' };
    }
    return { interrupted: true, definitive: true, reason: `incomplete_tail_${String(lastStep.type || 'step').toLowerCase()}` };
  } catch (_) {
    return { interrupted: false, definitive: false, reason: '' };
  } finally {
    if (fd >= 0) {
      try { fsApi.closeSync(fd); } catch (_) {}
    }
  }
}

/**
 * Capture top-level interactive Antigravity conversations that were either mid-run right
 * before an account switch or stopped mid-turn (e.g. `Individual quota reached`).
 *
 * @param {{
 *   homeDir?: string,
 *   env?: NodeJS.ProcessEnv,
 *   sqlite?: any,
 *   fs?: typeof fs,
 *   recentlyRunningIds?: Iterable<string>,
 *   nowMs?: number,
 *   maxAgeMs?: number,
 *   maxResults?: number,
 *   onlyActivelyRunning?: boolean,
 *   targetClient?: string | null
 * }} [options]
 * @returns {Array<{ conversationId: string, title: string, reason: string, modifiedMs: number, rootDir: string }>}
 */
function snapshotInterruptedConversations(options = {}) {
  const sqlite = resolveSqlite(options);
  if (!sqlite || typeof sqlite.DatabaseSync !== 'function') return [];
  const fsApi = options.fs || fs;
  const nowMs = Number.isFinite(options.nowMs) ? Number(options.nowMs) : Date.now();
  const maxAgeMs = Number.isFinite(options.maxAgeMs) ? Number(options.maxAgeMs) : MAX_INTERRUPTED_CONVERSATION_AGE_MS;
  const maxResults = Number.isFinite(options.maxResults) ? Math.max(1, Number(options.maxResults)) : MAX_CONVERSATIONS_TO_RESUME;
  const onlyActivelyRunning = options.onlyActivelyRunning === true;
  const recentRunning = new Set(Array.from(options.recentlyRunningIds || [], (id) => String(id || '').trim()).filter(Boolean));

  /** @type {Map<string, { conversationId: string, title: string, reason: string, modifiedMs: number, rootDir: string }>} */
  const found = new Map();

  for (const rootDir of candidateAntigravityRoots(options)) {
    if (path.basename(rootDir) === 'antigravity-backup') continue;
    const dbPath = path.join(rootDir, 'conversation_summaries.db');
    try {
      if (!fsApi.existsSync(dbPath)) continue;
    } catch (_) {
      continue;
    }

    let db = null;
    try {
      db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
      try { db.exec('PRAGMA busy_timeout = 250;'); } catch (_) {}
      const hasTable = Boolean(
        db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'conversation_summaries'").get()
      );
      if (!hasTable) continue;

      const columns = new Set(
        db.prepare('PRAGMA table_info(conversation_summaries)').all().map((/** @type {any} */ c) => String(c.name))
      );
      if (!columns.has('conversation_id')) continue;

      const wantedCols = [
        'conversation_id',
        'title',
        'preview',
        'status',
        'not_fully_idle',
        'killed',
        'parent_conversation_id',
        'nesting_depth',
        'last_modified_time',
        'last_user_input_time'
      ].filter((c) => columns.has(c));

      const orderClause = columns.has('last_modified_time') ? ' ORDER BY last_modified_time DESC' : '';
      const rows = db.prepare(`SELECT ${wantedCols.join(', ')} FROM conversation_summaries${orderClause} LIMIT 32`).all();

      for (const row of rows) {
        const id = String(row?.conversation_id || '').trim();
        if (!id) continue;
        if (row?.killed === 1 || row?.killed === true) continue;
        const parentId = String(row?.parent_conversation_id || '').trim();
        if (parentId) continue;
        if (columns.has('nesting_depth') && Number(row?.nesting_depth || 0) > 0) continue;

        const modifiedMs = parseSqliteTimestampMs(row?.last_modified_time);
        if (modifiedMs > 0 && nowMs - modifiedMs > maxAgeMs) continue;

        if (columns.has('last_user_input_time')) {
          const inputMs = parseSqliteTimestampMs(row?.last_user_input_time);
          if (inputMs < MIN_VALID_USER_INPUT_MS) continue;
        }

        const statusUpper = String(row?.status || '').trim().toUpperCase();
        if (
          statusUpper.includes('CANCEL')
          || statusUpper.includes('WAIT')
          || statusUpper.includes('APPROV')
          || statusUpper.includes('CONFIRM')
        ) {
          continue;
        }
        const notFullyIdle = row?.not_fully_idle === 1 || row?.not_fully_idle === true;
        const isRunningInDb = (
          statusUpper === 'CASCADE_RUN_STATUS_RUNNING'
          || statusUpper === 'CASCADE_RUN_STATUS_BUSY'
          || notFullyIdle
        );

        let interrupted = false;
        let reason = '';
        if (isRunningInDb) {
          interrupted = true;
          reason = 'running_before_switch';
        } else if (!onlyActivelyRunning) {
          const tailCheck = inspectTranscriptTailInterruption(rootDir, id, fsApi);
          if (tailCheck.definitive) {
            interrupted = tailCheck.interrupted;
            reason = tailCheck.reason;
          } else if (recentRunning.has(id) && modifiedMs > 0 && nowMs - modifiedMs <= 3 * 60 * 1000) {
            interrupted = true;
            reason = 'recent_running_turn';
          }
        }

        if (!interrupted) continue;
        const existing = found.get(id);
        if (!existing || modifiedMs > existing.modifiedMs) {
          found.set(id, {
            conversationId: id,
            title: String(row?.title || row?.preview || '').trim().slice(0, 96),
            reason,
            modifiedMs: modifiedMs || nowMs,
            rootDir
          });
        }
      }
    } catch (_) {
      // Ignore unreadable or locked summary DBs.
    } finally {
      try { db?.close(); } catch (_) {}
    }
  }

  return [...found.values()]
    .sort((a, b) => b.modifiedMs - a.modifiedMs)
    .slice(0, maxResults);
}

/**
 * Call Connect HTTP+JSON `product.v1.ConversationService/<method>` on loopback.
 *
 * @param {{
 *   port: number,
 *   csrfToken: string,
 *   method: string,
 *   body: Record<string, any>,
 *   timeoutMs?: number
 * }} params
 * @returns {Promise<any>}
 */
function callConversationServiceHttp({ port, csrfToken, method, body, timeoutMs = 3000 }) {
  const payload = Buffer.from(JSON.stringify(body || {}), 'utf8');
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      method: 'POST',
      path: `/product.v1.ConversationService/${method}`,
      headers: {
        'content-type': 'application/json',
        'content-length': payload.length,
        'connect-protocol-version': '1',
        'x-antigravity-csrf-token': csrfToken
      },
      timeout: timeoutMs
    }, (res) => {
      /** @type {Buffer[]} */
      const chunks = [];
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(raw || '{}'));
          } catch (err) {
            reject(err);
          }
          return;
        }
        reject(new Error(`ConversationService/${method} returned HTTP ${res.statusCode}`));
      });
    });
    req.on('timeout', () => req.destroy(new Error(`ConversationService/${method} timed out`)));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Resolve the official `agentapi` CLI command (`language_server agentapi ...` or `~/.gemini/antigravity/bin/agentapi`).
 *
 * @param {{
 *   platform?: NodeJS.Platform,
 *   homeDir?: string,
 *   procs?: Array<{ pid: number, name: string, exePath: string, argv0: string, args: string }>,
 *   fs?: Pick<typeof fs, 'existsSync'>,
 *   targetClient?: string | null
 * }} [opts]
 * @returns {{ bin: string, prefixArgs: string[] } | null}
 */
function resolveAgentApiCommand(opts = {}) {
  const platform = opts.platform || process.platform;
  const home = opts.homeDir || os.homedir();
  const existsSync = opts.fs?.existsSync || fs.existsSync;
  const pathApi = platform === 'win32' ? path.win32 : path;
  const target = String(opts.targetClient || '').trim().toLowerCase();
  const rawProcs = opts.procs || [];
  const orderedProcs = (target === 'ide' || target === 'classic')
    ? [...rawProcs].sort((a, b) => {
        const aIde = processManager.isAntigravityIdeStr(a.exePath) || processManager.isAntigravityIdeStr(a.args);
        const bIde = processManager.isAntigravityIdeStr(b.exePath) || processManager.isAntigravityIdeStr(b.args);
        const wantIde = target === 'ide';
        return Number(bIde === wantIde) - Number(aIde === wantIde);
      })
    : rawProcs;

  // 1. Prefer the live running Antigravity language_server binary (`<ls_exe> agentapi ...`),
  // which works identically across Windows, macOS, and Linux without shell wrapper scripts.
  for (const proc of orderedProcs) {
    if (
      proc.exePath
      && processManager.classifyProcess(proc.name, proc.exePath, proc.argv0, proc.args) === 'language_server'
      && existsSync(proc.exePath)
    ) {
      return { bin: proc.exePath, prefixArgs: ['agentapi'] };
    }
  }

  // 2. Check `~/.gemini/antigravity/bin/agentapi(.exe)` wrapper installed by Antigravity.
  const binDir = pathApi.join(home, '.gemini', 'antigravity', 'bin');
  const wrapperCandidates = platform === 'win32'
    ? [pathApi.join(binDir, 'agentapi.exe')]
    : [pathApi.join(binDir, 'agentapi')];
  for (const candidate of wrapperCandidates) {
    if (existsSync(candidate)) {
      return { bin: candidate, prefixArgs: [] };
    }
  }

  // 3. Derive language_server path relative to Classic/IDE executable if running or installed.
  for (const proc of orderedProcs) {
    const kind = processManager.classifyProcess(proc.name, proc.exePath, proc.argv0, proc.args);
    if ((kind === 'classic' || kind === 'ide') && proc.exePath) {
      const appDir = pathApi.dirname(proc.exePath);
      const lsNames = platform === 'win32'
        ? ['language_server_windows_x64.exe', 'language_server.exe']
        : ['language_server', 'language_server_linux_x64', 'language_server_macos_arm', 'language_server_macos_x64'];
      for (const lsName of lsNames) {
        const relatives = [
          pathApi.join(appDir, 'resources', 'bin', lsName),
          pathApi.join(appDir, 'resources', 'app', 'extensions', 'antigravity', 'bin', lsName),
          pathApi.join(appDir, '..', 'Resources', 'bin', lsName),
          pathApi.join(appDir, '..', 'Resources', 'app', 'extensions', 'antigravity', 'bin', lsName)
        ];
        for (const rel of relatives) {
          if (existsSync(rel)) {
            return { bin: rel, prefixArgs: ['agentapi'] };
          }
        }
      }
    }
  }

  return null;
}

/**
 * Read newest daemon JSON descriptors (`hub_*.json`, `ls_*.json`) exposing an `httpPort` + `csrfToken`.
 *
 * @param {{ homeDir?: string, env?: NodeJS.ProcessEnv, fs?: typeof fs, livePids?: Set<number>, targetClient?: string | null }} [opts]
 * @returns {Array<{ pid: number, port: number, csrfToken: string, mtimeMs: number }>}
 */
function readCandidateHttpEndpointsFromDaemonDirs(opts = {}) {
  const fsApi = opts.fs || fs;
  /** @type {Array<{ pid: number, port: number, csrfToken: string, mtimeMs: number }>} */
  const candidates = [];
  const targetRoots = candidateAntigravityRoots(opts);
  const roots = targetRoots.length > 0 ? targetRoots : candidateAntigravityRoots({ ...opts, targetClient: 'auto' });
  for (const rootDir of roots) {
    const daemonDir = path.join(rootDir, 'daemon');
    let names;
    try { names = fsApi.readdirSync(daemonDir); } catch (_) { continue; }
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const fullPath = path.join(daemonDir, name);
      try {
        const stat = fsApi.lstatSync(fullPath);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024) continue;
        const parsed = JSON.parse(fsApi.readFileSync(fullPath, 'utf8'));
        const pid = Number(parsed?.pid || 0);
        const port = Number(parsed?.httpPort || 0);
        const csrfToken = typeof parsed?.csrfToken === 'string' ? parsed.csrfToken.trim() : '';
        if (!Number.isSafeInteger(port) || port <= 0 || port >= 65536 || !csrfToken) continue;
        if (opts.livePids && opts.livePids.size > 0 && (!Number.isSafeInteger(pid) || !opts.livePids.has(pid))) {
          continue;
        }
        candidates.push({ pid, port, csrfToken, mtimeMs: stat.mtimeMs });
      } catch (_) {}
    }
  }
  return candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/**
 * Poll until the newly switched Antigravity `language_server` exposes a reachable
 * `ConversationService` HTTP endpoint and `agentapi` binary.
 *
 * @param {{
 *   timeoutMs?: number,
 *   pollIntervalMs?: number,
 *   platform?: NodeJS.Platform,
 *   homeDir?: string,
 *   env?: NodeJS.ProcessEnv,
 *   fs?: typeof fs,
 *   listProcessesAsync?: () => Promise<Array<{ pid: number, name: string, exePath: string, argv0: string, args: string }>>,
 *   callConversationService?: typeof callConversationServiceHttp,
 *   sleep?: (ms: number) => Promise<void>,
 *   targetClient?: string | null
 * }} [options]
 * @returns {Promise<{ port: number, csrfToken: string, command: { bin: string, prefixArgs: string[] } } | null>}
 */
async function discoverLiveAgentApiEndpoint(options = {}) {
  const timeoutMs = Math.max(500, Number(options.timeoutMs || 18_000));
  const pollIntervalMs = Math.max(50, Number(options.pollIntervalMs || 1200));
  const sleepFn = options.sleep || ((ms) => new Promise((resolve) => {
    setTimeout(resolve, ms);
  }));
  const listProcsFn = options.listProcessesAsync || (() => processManager.listProcessesAsync({ platform: options.platform }));
  const callConv = options.callConversationService || callConversationServiceHttp;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const procs = await listProcsFn();
      const livePids = new Set(procs.map((p) => p.pid).filter((n) => n > 0));
      const command = resolveAgentApiCommand({
        platform: options.platform,
        homeDir: options.homeDir,
        procs,
        fs: options.fs,
        targetClient: options.targetClient
      });

      if (command) {
        const daemonEndpoints = readCandidateHttpEndpointsFromDaemonDirs({
          homeDir: options.homeDir,
          env: options.env,
          fs: options.fs,
          livePids,
          targetClient: options.targetClient
        });

        /** @type {Array<{ port: number, csrfToken: string }>} */
        const httpCandidates = daemonEndpoints.map((d) => ({ port: d.port, csrfToken: d.csrfToken }));

        if (httpCandidates.length === 0) {
          try {
            const infos = await antigravityProbe.detectProcessInfos({
              platform: options.platform,
              homeDir: options.homeDir,
              env: options.env,
              timeoutMs: 3000
            });
            for (const info of infos) {
              if (!info.csrfToken) continue;
              if (info.desktopRpcPort) httpCandidates.push({ port: info.desktopRpcPort, csrfToken: info.csrfToken });
              if (info.daemonHttpPort) httpCandidates.push({ port: info.daemonHttpPort, csrfToken: info.csrfToken });
              if (httpCandidates.length === 0) {
                try {
                  const ports = await antigravityProbe.listeningPorts(info.pid, { platform: options.platform, timeoutMs: 2500 });
                  for (const port of ports) httpCandidates.push({ port, csrfToken: info.csrfToken });
                } catch (_) {}
              }
            }
          } catch (_) {}
        }

        const seen = new Set();
        for (const cand of httpCandidates) {
          const key = `${cand.port}:${cand.csrfToken}`;
          if (seen.has(key)) continue;
          seen.add(key);
          try {
            await callConv({
              port: cand.port,
              csrfToken: cand.csrfToken,
              method: 'ListConversations',
              body: { pageSize: 1, includeArchived: false },
              timeoutMs: 2500
            });
            return { port: cand.port, csrfToken: cand.csrfToken, command };
          } catch (_) {}
        }
      }
    } catch (_) {}

    if (Date.now() + pollIntervalMs > deadline) break;
    await sleepFn(pollIntervalMs);
  }

  return null;
}

/**
 * Execute `agentapi send-message <conversationId> <prompt>` via `execFile`.
 *
 * @param {{ bin: string, prefixArgs: string[] }} command
 * @param {string} conversationId
 * @param {string} prompt
 * @param {{ port: number, csrfToken: string, platform?: NodeJS.Platform, env?: NodeJS.ProcessEnv, execFile?: typeof execFile }} ctx
 * @returns {Promise<void>}
 */
function runAgentApiSendMessage(command, conversationId, prompt, ctx) {
  const execFn = ctx.execFile || execFile;
  const platform = ctx.platform || process.platform;
  const spawnEnv = {
    ...processManager.cleanSpawnEnv(ctx.env || process.env, platform),
    ANTIGRAVITY_LS_ADDRESS: `127.0.0.1:${ctx.port}`,
    ANTIGRAVITY_CSRF_TOKEN: ctx.csrfToken
  };
  const args = [...command.prefixArgs, 'send-message', conversationId, prompt];
  return new Promise((resolve, reject) => {
    execFn(command.bin, args, {
      env: spawnEnv,
      timeout: 15_000,
      windowsHide: true,
      encoding: 'utf8'
    }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error((stderr || stdout || err.message || 'agentapi send-message failed').trim()));
        return;
      }
      const trimmed = String(stdout || '').trim();
      if (trimmed.startsWith('{')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed?.error) {
            reject(new Error(String(parsed.error)));
            return;
          }
        } catch (_) {}
      }
      resolve();
    });
  });
}

/**
 * Resume captured interrupted Antigravity conversations using the documented `agentapi send-message`
 * command once the switched `language_server` is online and the conversation is idle.
 *
 * @param {Array<{ conversationId: string, title?: string, reason?: string }>} targets
 * @param {{
 *   prompt?: string,
 *   timeoutMs?: number,
 *   pollIntervalMs?: number,
 *   platform?: NodeJS.Platform,
 *   homeDir?: string,
 *   env?: NodeJS.ProcessEnv,
 *   fs?: typeof fs,
 *   execFile?: typeof execFile,
 *   listProcessesAsync?: () => Promise<Array<{ pid: number, name: string, exePath: string, argv0: string, args: string }>>,
 *   callConversationService?: typeof callConversationServiceHttp,
 *   discoverEndpoint?: typeof discoverLiveAgentApiEndpoint,
 *   sleep?: (ms: number) => Promise<void>,
 *   targetClient?: string | null
 * }} [options]
 * @returns {Promise<{ ok: boolean, resumedIds: string[], skippedIds: string[], error?: string }>}
 */
async function resumeInterruptedConversations(targets, options = {}) {
  const validTargets = (Array.isArray(targets) ? targets : [])
    .map((t) => String(t?.conversationId || '').trim())
    .filter(Boolean);
  if (validTargets.length === 0) {
    return { ok: true, resumedIds: [], skippedIds: [] };
  }

  const prompt = normalizeAutoResumePrompt(options.prompt);
  const discoverFn = options.discoverEndpoint || discoverLiveAgentApiEndpoint;
  const callConv = options.callConversationService || callConversationServiceHttp;

  const endpoint = await discoverFn(options);
  if (!endpoint) {
    return {
      ok: false,
      resumedIds: [],
      skippedIds: [],
      error: 'Antigravity ConversationService endpoint did not become ready after switch'
    };
  }

  /** @type {string[]} */
  const resumedIds = [];
  /** @type {string[]} */
  const skippedIds = [];
  /** @type {string[]} */
  const errors = [];

  for (const conversationId of validTargets) {
    try {
      try {
        const meta = await callConv({
          port: endpoint.port,
          csrfToken: endpoint.csrfToken,
          method: 'GetConversation',
          body: { conversationId },
          timeoutMs: 2500
        });
        const runState = String(meta?.state?.runState || meta?.conversation?.state?.runState || '').trim();
        if (runState === 'RUN_STATE_RUNNING') {
          skippedIds.push(conversationId);
          continue;
        }
      } catch (_) {
        // Proceed with send-message even if GetConversation metadata lookup is unsupported.
      }

      await runAgentApiSendMessage(endpoint.command, conversationId, prompt, {
        port: endpoint.port,
        csrfToken: endpoint.csrfToken,
        platform: options.platform,
        env: options.env,
        execFile: options.execFile
      });
      resumedIds.push(conversationId);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  return {
    ok: resumedIds.length > 0 || errors.length === 0,
    resumedIds,
    skippedIds,
    ...(errors.length > 0 ? { error: errors[0] } : {})
  };
}

module.exports = {
  DEFAULT_AUTO_RESUME_PROMPT,
  MAX_AUTO_RESUME_PROMPT_LENGTH,
  MAX_CONVERSATIONS_TO_RESUME,
  MAX_INTERRUPTED_CONVERSATION_AGE_MS,
  callConversationServiceHttp,
  discoverLiveAgentApiEndpoint,
  inspectTranscriptTailInterruption,
  normalizeAutoResumePrompt,
  resolveAgentApiCommand,
  resumeInterruptedConversations,
  snapshotInterruptedConversations
};
