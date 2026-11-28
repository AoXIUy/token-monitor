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
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw <= 0) return 0;
    return raw < 10_000_000_000 ? Math.trunc(raw * 1000) : Math.trunc(raw);
  }
  const text = String(raw || '').trim();
  if (!text) return 0;
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const n = Number(text);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return n < 10_000_000_000 ? Math.trunc(n * 1000) : Math.trunc(n);
  }
  const isoLike = text
    .replace(/^(\d{4}-\d{2}-\d{2})\s+/, '$1T')
    .replace(/(\.\d{3})\d+(?=[+-Z]|$)/, '$1');
  const ms = Date.parse(isoLike);
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}

const USER_CANCEL_MESSAGE_RE = /\b(cancel(?:l)?ed by user|user cancel(?:l)?ed|aborted by user|request cancel(?:l)?ed|turn cancel(?:l)?ed)\b/i;
const QUOTA_ERROR_MESSAGE_RE = /\b(individual quota reached|quota exceeded|quota exhausted|resource_exhausted|rate[ _-]?limit(?:ed)?|too many requests|http 429|status 429)\b|配额.{0,8}(?:上限|用尽|耗尽|不足)|触发.{0,6}限额/i;
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
function isStepQuotaExhausted(step) {
  if (!step || typeof step !== 'object') return false;
  const errFields = `${step.error || ''} ${step.error_message || ''} ${step.failure || ''}`.trim();
  if (errFields && QUOTA_ERROR_MESSAGE_RE.test(errFields)) return true;
  const typeUpper = String(step.type || '').trim().toUpperCase();
  const statusUpper = String(step.status || '').trim().toUpperCase();
  const isErrorStep = (
    typeUpper === 'ERROR'
    || statusUpper === 'ERROR'
    || statusUpper === 'FAILED'
  );
  if (!isErrorStep) return false;
  const stepText = `${step.message || ''} ${step.content || ''}`.trim();
  return Boolean(stepText && QUOTA_ERROR_MESSAGE_RE.test(stepText));
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
 * @returns {{ interrupted: boolean, definitive: boolean, reason: string, quotaExhausted?: boolean }}
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

    const unrecoveredSteps = lastPlannerIdx >= 0 ? turnSteps.slice(lastPlannerIdx) : turnSteps;
    if (unrecoveredSteps.some(isStepQuotaExhausted)) {
      return { interrupted: true, definitive: true, reason: 'quota_exhausted', quotaExhausted: true };
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
 * Check whether any local top-level Antigravity conversation is genuinely mid-LLM-generation
 * (`CASCADE_RUN_STATUS_RUNNING` / `CASCADE_RUN_STATUS_BUSY`), ignoring conversations whose
 * model turn already halted (`CASCADE_RUN_STATUS_IDLE`) while background shell tasks keep
 * `not_fully_idle = 1`.
 *
 * @param {{
 *   homeDir?: string,
 *   env?: NodeJS.ProcessEnv,
 *   sqlite?: any,
 *   fs?: typeof fs,
 *   nowMs?: number,
 *   maxAgeMs?: number,
 *   targetClient?: string | null
 * }} [options]
 * @returns {boolean}
 */
function hasActivelyGeneratingTurn(options = {}) {
  const sqlite = resolveSqlite(options);
  if (!sqlite || typeof sqlite.DatabaseSync !== 'function') return false;
  const fsApi = options.fs || fs;
  const nowMs = Number.isFinite(options.nowMs) ? Number(options.nowMs) : Date.now();
  const maxAgeMs = Number.isFinite(options.maxAgeMs) ? Number(options.maxAgeMs) : 5 * 60 * 1000;

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
      if (!columns.has('conversation_id') || !columns.has('status')) continue;
      const wantedCols = [
        'conversation_id',
        'status',
        'killed',
        'parent_conversation_id',
        'nesting_depth',
        'last_modified_time'
      ].filter((c) => columns.has(c));
      const orderClause = columns.has('last_modified_time') ? ' ORDER BY last_modified_time DESC' : '';
      const rows = db.prepare(`SELECT ${wantedCols.join(', ')} FROM conversation_summaries${orderClause} LIMIT 24`).all();
      for (const row of rows) {
        if (row?.killed === 1 || row?.killed === true) continue;
        if (String(row?.parent_conversation_id || '').trim()) continue;
        if (columns.has('nesting_depth') && Number(row?.nesting_depth || 0) > 0) continue;
        const modifiedMs = parseSqliteTimestampMs(row?.last_modified_time);
        if (modifiedMs > 0 && nowMs - modifiedMs > maxAgeMs) continue;
        const statusUpper = String(row?.status || '').trim().toUpperCase();
        if (statusUpper === 'CASCADE_RUN_STATUS_RUNNING' || statusUpper === 'CASCADE_RUN_STATUS_BUSY') {
          return true;
        }
      }
    } catch (_) {
      // Ignore locked or unreadable summary DBs.
    } finally {
      try { db?.close(); } catch (_) {}
    }
  }
  return false;
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
 *   allowRecentQuotaExhausted?: boolean,
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
  const allowRecentQuotaExhausted = options.allowRecentQuotaExhausted === true;
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
        } else if (allowRecentQuotaExhausted && modifiedMs > 0 && nowMs - modifiedMs <= 5 * 60 * 1000) {
          const tailCheck = inspectTranscriptTailInterruption(rootDir, id, fsApi);
          if (tailCheck.quotaExhausted) {
            interrupted = true;
            reason = tailCheck.reason || 'quota_exhausted';
          } else if (recentRunning.has(id) && modifiedMs > 0 && nowMs - modifiedMs <= 3 * 60 * 1000 && tailCheck.interrupted) {
            interrupted = true;
            reason = tailCheck.reason || 'recent_running_turn';
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
 *   env?: NodeJS.ProcessEnv,
 *   procs?: Array<{ pid: number, name: string, exePath: string, argv0: string, args: string }>,
 *   fs?: Pick<typeof fs, 'existsSync'> & Partial<Pick<typeof fs, 'readFileSync'>>,
 *   customExecutablePaths?: { classic?: string, ide?: string, cli?: string },
 *   targetClient?: string | null
 * }} [opts]
 * @returns {{ bin: string, prefixArgs: string[] } | null}
 */
function resolveAgentApiCommand(opts = {}) {
  const platform = opts.platform || process.platform;
  const home = opts.homeDir || os.homedir();
  const rawExistsSync = opts.fs?.existsSync || fs.existsSync;
  const rawReadFileSync = opts.fs?.readFileSync || (!opts.fs ? fs.readFileSync : null);
  const normalizeHostFsPath = (/** @type {string} */ p) => (
    (!opts.fs && process.platform !== 'win32') ? String(p).replace(/\\/g, '/') : p
  );
  const existsSync = (/** @type {string} */ p) => rawExistsSync(normalizeHostFsPath(p));
  const readFileSync = typeof rawReadFileSync === 'function'
    ? (/** @type {string} */ p, /** @type {BufferEncoding} */ enc) => rawReadFileSync(normalizeHostFsPath(p), enc)
    : null;
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
      return { bin: normalizeHostFsPath(proc.exePath), prefixArgs: ['agentapi'] };
    }
  }

  // 2. Check `~/.gemini/antigravity/bin/agentapi(.exe/.bat/.cmd)` wrapper installed by Antigravity.
  const binDir = pathApi.join(home, '.gemini', 'antigravity', 'bin');
  const wrapperCandidates = platform === 'win32'
    ? [pathApi.join(binDir, 'agentapi.exe')]
    : [pathApi.join(binDir, 'agentapi')];
  for (const candidate of wrapperCandidates) {
    if (existsSync(candidate)) {
      return { bin: normalizeHostFsPath(candidate), prefixArgs: [] };
    }
  }
  if (platform === 'win32' && typeof readFileSync === 'function') {
    for (const scriptName of ['agentapi.bat', 'agentapi.cmd']) {
      const scriptPath = pathApi.join(binDir, scriptName);
      if (!existsSync(scriptPath)) continue;
      try {
        const rawScript = String(readFileSync(scriptPath, 'utf8') || '');
        const match = rawScript.match(/"([^"\r\n]*language[_-]server[^"\r\n]*\.exe)"\s+agentapi\b/i)
          || rawScript.match(/(?:^|[\s@])([^\s"\r\n]*language[_-]server[^\s"\r\n]*\.exe)\s+agentapi\b/im);
        const rawCandidate = match?.[1]
          ? match[1].replace(/^%~dp0[\\/]?/i, `${binDir}${pathApi.sep}`)
          : '';
        if (rawCandidate && existsSync(rawCandidate)) {
          return { bin: normalizeHostFsPath(rawCandidate), prefixArgs: ['agentapi'] };
        }
      } catch (_) {}
    }
  }

  // 3. Derive language_server path relative to Classic/IDE executable if running or installed.
  const lsNames = platform === 'win32'
    ? ['language_server_windows_x64.exe', 'language_server.exe']
    : ['language_server', 'language_server_linux_x64', 'language_server_macos_arm', 'language_server_macos_x64'];
  /** @type {string[]} */
  const candidateExes = [];
  for (const proc of orderedProcs) {
    const kind = processManager.classifyProcess(proc.name, proc.exePath, proc.argv0, proc.args);
    if ((kind === 'classic' || kind === 'ide') && proc.exePath) {
      candidateExes.push(proc.exePath);
    }
  }
  if (opts.customExecutablePaths) {
    if (target === 'ide' && opts.customExecutablePaths.ide) candidateExes.push(opts.customExecutablePaths.ide);
    else if (opts.customExecutablePaths.classic) candidateExes.push(opts.customExecutablePaths.classic);
  }
  if (typeof processManager.buildExecutableCandidates === 'function') {
    const targetOrder = target === 'ide' ? ['ide'] : (target === 'classic' ? ['classic'] : ['classic', 'ide']);
    for (const slot of targetOrder) {
      candidateExes.push(...processManager.buildExecutableCandidates(slot === 'ide' ? 'ide' : null, {
        platform,
        home,
        env: opts.env
      }));
    }
  }

  const checkedAppDirs = new Set();
  for (const exe of candidateExes) {
    if (!exe) continue;
    const appDir = pathApi.dirname(exe);
    if (!appDir || checkedAppDirs.has(appDir)) continue;
    checkedAppDirs.add(appDir);
    for (const lsName of lsNames) {
      const relatives = [
        pathApi.join(appDir, 'resources', 'bin', lsName),
        pathApi.join(appDir, 'resources', 'app', 'extensions', 'antigravity', 'bin', lsName),
        pathApi.join(appDir, '..', 'Resources', 'bin', lsName),
        pathApi.join(appDir, '..', 'Resources', 'app', 'extensions', 'antigravity', 'bin', lsName)
      ];
      for (const rel of relatives) {
        if (existsSync(rel)) {
          return { bin: normalizeHostFsPath(rel), prefixArgs: ['agentapi'] };
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
 *   customExecutablePaths?: { classic?: string, ide?: string, cli?: string },
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
        env: options.env,
        procs,
        fs: options.fs,
        customExecutablePaths: options.customExecutablePaths,
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
 *   customExecutablePaths?: { classic?: string, ide?: string, cli?: string },
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
  QUOTA_ERROR_MESSAGE_RE,
  callConversationServiceHttp,
  candidateAntigravityRoots,
  discoverLiveAgentApiEndpoint,
  hasActivelyGeneratingTurn,
  inspectTranscriptTailInterruption,
  normalizeAutoResumePrompt,
  parseSqliteTimestampMs,
  resolveAgentApiCommand,
  resolveSqlite,
  resumeInterruptedConversations,
  snapshotInterruptedConversations
};
