// @ts-check
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const taskResume = require('./taskResume');

const TRANSCRIPT_TAIL_MAX_BYTES = 256 * 1024;
const ACTIVE_CONVERSATION_MAX_AGE_MS = 10 * 60 * 1000;
const RECENT_CONVERSATION_MAX_AGE_MS = 30 * 60 * 1000;
const PBTXT_MAX_BYTES = 256 * 1024;

const SETTINGS_CHANGE_BLOCK_RE = /<USER_SETTINGS_CHANGE>([\s\S]*?)<\/USER_SETTINGS_CHANGE>/gi;
const MODEL_SELECTION_CHANGE_RE = /Model Selection[`'"]?\s+from\s+.+?\s+to\s+([^\r\n<]+?)(?:\.(?:\s|$)|[\r\n<]|$)/i;
const PBTXT_SELECTED_MODEL_RE = /^\s*last_selected_agent_model\s*:\s*"?([A-Za-z0-9_.:/-]+)"?/m;
const OPAQUE_PLACEHOLDER_RE = /^MODEL_PLACEHOLDER_/i;

/**
 * Extract `last_selected_agent_model` from `antigravity_state.pbtxt`.
 * @param {string} text
 * @returns {string}
 */
function parseSelectedAgentModelFromPbtxt(text) {
  const match = PBTXT_SELECTED_MODEL_RE.exec(String(text || ''));
  return match?.[1] ? match[1].trim() : '';
}

/**
 * Extract the newly selected model name from `<USER_SETTINGS_CHANGE>` tags inside a `USER_INPUT` step.
 * @param {unknown} content
 * @returns {string}
 */
function extractModelChangeFromUserInput(content) {
  const raw = typeof content === 'string' ? content : '';
  if (!raw || !raw.includes('USER_SETTINGS_CHANGE')) return '';
  let latest = '';
  for (const blockMatch of raw.matchAll(SETTINGS_CHANGE_BLOCK_RE)) {
    const inner = blockMatch[1] || '';
    const modelMatch = MODEL_SELECTION_CHANGE_RE.exec(inner);
    if (modelMatch?.[1]) {
      const candidate = modelMatch[1].trim();
      if (candidate && candidate.toLowerCase() !== 'none') {
        latest = candidate;
      }
    }
  }
  return latest;
}

/**
 * Resolve an Antigravity model ID or placeholder (e.g. `MODEL_PLACEHOLDER_M535`) to a concrete label
 * using the sanitized `modelCatalog` captured from local RPC `GetUserStatus`.
 * Returns `''` when the input is an opaque placeholder that cannot yet be resolved.
 *
 * @param {unknown} rawModel
 * @param {{ models?: Array<{ id?: string, label?: string, resetTime?: string | null }> } | null | undefined} [modelCatalog]
 * @returns {string}
 */
function resolveModelPlaceholder(rawModel, modelCatalog = null) {
  const trimmed = String(rawModel || '').trim();
  if (!trimmed) return '';
  const catalogModels = Array.isArray(modelCatalog?.models) ? modelCatalog.models : [];
  if (catalogModels.length > 0) {
    const lower = trimmed.toLowerCase();
    for (const entry of catalogModels) {
      const id = String(entry?.id || '').trim().toLowerCase();
      const label = String(entry?.label || '').trim();
      if (id && id === lower && label) {
        return label;
      }
    }
  }
  if (OPAQUE_PLACEHOLDER_RE.test(trimmed)) {
    return '';
  }
  return trimmed;
}

/**
 * Inspect the tail of a conversation's `transcript.jsonl` / `transcript_full.jsonl`
 * to find the latest concrete model used by `PLANNER_RESPONSE` or selected via `USER_INPUT`.
 *
 * @param {string} rootDir
 * @param {string} conversationId
 * @param {Pick<typeof fs, 'existsSync' | 'openSync' | 'fstatSync' | 'readSync' | 'closeSync'>} [fsApi]
 * @returns {{ model: string, timestampMs: number, source: 'planner_response' | 'user_settings_change' } | null}
 */
function inspectTranscriptTailModel(rootDir, conversationId, fsApi = fs) {
  const logsDir = path.join(rootDir, 'brain', conversationId, '.system_generated', 'logs');
  const candidates = [
    path.join(logsDir, 'transcript.jsonl'),
    path.join(logsDir, 'transcript_full.jsonl')
  ];
  const filePath = candidates.find((p) => {
    try { return fsApi.existsSync(p); } catch (_) { return false; }
  });
  if (!filePath) return null;

  let fd = -1;
  try {
    fd = fsApi.openSync(filePath, 'r');
    const stat = fsApi.fstatSync(fd);
    if (!stat.isFile() || stat.size <= 0) return null;
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

    /** @type {Array<{ order: number, step: Record<string, any> }>} */
    const parsedSteps = [];
    let fallbackOrder = 0;
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (!parsed || typeof parsed !== 'object') continue;
        const idx = Number.isSafeInteger(parsed.step_index) && parsed.step_index >= 0
          ? parsed.step_index
          : fallbackOrder;
        fallbackOrder = Math.max(fallbackOrder + 1, idx + 1);
        parsedSteps.push({ order: idx, step: parsed });
      } catch (_) {}
    }
    if (parsedSteps.length === 0) return null;

    // Deduplicate by order (keeping the later line in the file) and sort ascending.
    /** @type {Map<number, Record<string, any>>} */
    const byOrder = new Map();
    for (const item of parsedSteps) {
      byOrder.set(item.order, item.step);
    }
    const ordered = [...byOrder.entries()].sort((a, b) => a[0] - b[0]).map(([, step]) => step);

    for (let i = ordered.length - 1; i >= 0; i -= 1) {
      const step = ordered[i];
      const typeUpper = String(step?.type || '').trim().toUpperCase();
      if (typeUpper === 'USER_INPUT') {
        const changedModel = extractModelChangeFromUserInput(step.content);
        if (changedModel) {
          const ts = taskResume.parseSqliteTimestampMs(step.created_at) || Math.trunc(stat.mtimeMs || 0);
          return { model: changedModel, timestampMs: ts, source: 'user_settings_change' };
        }
      } else if (typeUpper === 'PLANNER_RESPONSE') {
        const model = typeof step.model === 'string' ? step.model.trim() : '';
        if (model) {
          const ts = taskResume.parseSqliteTimestampMs(step.created_at) || Math.trunc(stat.mtimeMs || 0);
          return { model, timestampMs: ts, source: 'planner_response' };
        }
      }
    }
    return null;
  } catch (_) {
    return null;
  } finally {
    if (fd >= 0) {
      try { fsApi.closeSync(fd); } catch (_) {}
    }
  }
}

/**
 * Read `antigravity_state.pbtxt` under `rootDir` and resolve `last_selected_agent_model`.
 *
 * @param {string} rootDir
 * @param {{
 *   fs?: typeof fs,
 *   modelCatalog?: { models?: Array<{ id?: string, label?: string, resetTime?: string | null }> } | null
 * }} [options]
 * @returns {{ model: string, timestampMs: number } | null}
 */
function readSelectedModelFromPbtxt(rootDir, options = {}) {
  const fsApi = options.fs || fs;
  const pbtxtPath = path.join(rootDir, 'antigravity_state.pbtxt');
  try {
    if (!fsApi.existsSync(pbtxtPath)) return null;
    const stat = fsApi.statSync(pbtxtPath);
    if (!stat.isFile() || stat.size <= 0 || stat.size > PBTXT_MAX_BYTES) return null;
    const raw = fsApi.readFileSync(pbtxtPath, 'utf8');
    const rawId = parseSelectedAgentModelFromPbtxt(raw);
    const resolved = resolveModelPlaceholder(rawId, options.modelCatalog);
    if (!resolved) return null;
    return { model: resolved, timestampMs: Math.trunc(stat.mtimeMs || 0) };
  } catch (_) {
    return null;
  }
}

/**
 * Detect the model(s) currently in use by local Antigravity conversations (or selected in the UI).
 *
 * Priority:
 * 1. Actively running top-level conversations (`CASCADE_RUN_STATUS_RUNNING` / `BUSY`, `not_fully_idle = 1`,
 *    or listed in `runningConversationIds`) -> union of their latest transcript models.
 * 2. When idle, compare `antigravity_state.pbtxt` (`last_selected_agent_model`, resolved via `modelCatalog`)
 *    against the most recent top-level conversation's latest transcript model and return the newer one.
 * 3. Returns empty `models` when no concrete model can be determined (allowing callers to fall back cleanly).
 *
 * @param {{
 *   homeDir?: string,
 *   env?: NodeJS.ProcessEnv,
 *   sqlite?: any,
 *   fs?: typeof fs,
 *   nowMs?: number,
 *   targetClient?: string | null,
 *   runningConversationIds?: Iterable<string>,
 *   activeMaxAgeMs?: number,
 *   recentMaxAgeMs?: number,
 *   modelCatalog?: {
 *     groups?: Array<{ groupName?: string, displayName?: string, description?: string, resetTimes?: string[] }>,
 *     models?: Array<{ id?: string, label?: string, resetTime?: string | null }>
 *   } | null
 * }} [options]
 * @returns {{
 *   models: string[],
 *   source: 'running_conversations' | 'pbtxt' | 'recent_conversation' | 'none',
 *   conversationIds: string[]
 * }}
 */
function detectActiveLocalModels(options = {}) {
  const fsApi = options.fs || fs;
  const sqlite = taskResume.resolveSqlite(options);
  const nowMs = Number.isFinite(options.nowMs) ? Number(options.nowMs) : Date.now();
  const activeMaxAgeMs = Number.isFinite(options.activeMaxAgeMs)
    ? Math.max(1000, Number(options.activeMaxAgeMs))
    : ACTIVE_CONVERSATION_MAX_AGE_MS;
  const recentMaxAgeMs = Number.isFinite(options.recentMaxAgeMs)
    ? Math.max(1000, Number(options.recentMaxAgeMs))
    : RECENT_CONVERSATION_MAX_AGE_MS;
  const runningIdSet = new Set(
    Array.from(options.runningConversationIds || [], (id) => String(id || '').trim()).filter(Boolean)
  );

  /** @type {Set<string>} */
  const runningModels = new Set();
  /** @type {string[]} */
  const runningConvIds = [];
  /** @type {{ model: string, timestampMs: number, conversationId: string } | null} */
  let bestRecentConv = null;
  /** @type {{ model: string, timestampMs: number } | null} */
  let bestPbtxt = null;

  for (const rootDir of taskResume.candidateAntigravityRoots(options)) {
    if (path.basename(rootDir) === 'antigravity-backup') continue;

    const pbtxtEntry = readSelectedModelFromPbtxt(rootDir, {
      fs: fsApi,
      modelCatalog: options.modelCatalog
    });
    if (pbtxtEntry && (!bestPbtxt || pbtxtEntry.timestampMs > bestPbtxt.timestampMs)) {
      bestPbtxt = pbtxtEntry;
    }

    if (!sqlite || typeof sqlite.DatabaseSync !== 'function') continue;
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
        'status',
        'not_fully_idle',
        'killed',
        'parent_conversation_id',
        'nesting_depth',
        'last_modified_time'
      ].filter((c) => columns.has(c));
      const orderClause = columns.has('last_modified_time') ? ' ORDER BY last_modified_time DESC' : '';
      const rows = db.prepare(`SELECT ${wantedCols.join(', ')} FROM conversation_summaries${orderClause} LIMIT 24`).all();

      let recentInspected = 0;
      for (const row of rows) {
        const cid = String(row?.conversation_id || '').trim();
        if (!cid) continue;
        if (row?.killed === 1 || row?.killed === true) continue;
        if (String(row?.parent_conversation_id || '').trim()) continue;
        if (columns.has('nesting_depth') && Number(row?.nesting_depth || 0) > 0) continue;

        const modifiedMs = taskResume.parseSqliteTimestampMs(row?.last_modified_time);
        const statusUpper = String(row?.status || '').trim().toUpperCase();
        const isRunningStatus = statusUpper === 'CASCADE_RUN_STATUS_RUNNING'
          || statusUpper === 'CASCADE_RUN_STATUS_BUSY'
          || row?.not_fully_idle === 1
          || row?.not_fully_idle === true
          || runningIdSet.has(cid);
        const withinActiveAge = modifiedMs <= 0 || nowMs - modifiedMs <= activeMaxAgeMs;
        const withinRecentAge = modifiedMs <= 0 || nowMs - modifiedMs <= recentMaxAgeMs;

        if (isRunningStatus && withinActiveAge) {
          const tail = inspectTranscriptTailModel(rootDir, cid, fsApi);
          const resolved = resolveModelPlaceholder(tail?.model, options.modelCatalog);
          if (resolved) {
            runningModels.add(resolved);
            if (!runningConvIds.includes(cid)) runningConvIds.push(cid);
          }
          continue;
        }

        if (withinRecentAge && (recentInspected < 4 || !bestRecentConv || modifiedMs > bestRecentConv.timestampMs)) {
          recentInspected += 1;
          const tail = inspectTranscriptTailModel(rootDir, cid, fsApi);
          const resolved = resolveModelPlaceholder(tail?.model, options.modelCatalog);
          if (resolved) {
            const effectiveTs = Math.max(modifiedMs, tail?.timestampMs || 0);
            if (!bestRecentConv || effectiveTs > bestRecentConv.timestampMs) {
              bestRecentConv = { model: resolved, timestampMs: effectiveTs, conversationId: cid };
            }
          }
        }
      }
    } catch (_) {
      // Ignore locked or unreadable conversation summary DBs.
    } finally {
      try { db?.close(); } catch (_) {}
    }
  }

  if (runningModels.size > 0) {
    return {
      models: [...runningModels],
      source: 'running_conversations',
      conversationIds: runningConvIds
    };
  }

  if (bestPbtxt && bestRecentConv) {
    if (bestPbtxt.timestampMs >= bestRecentConv.timestampMs) {
      return { models: [bestPbtxt.model], source: 'pbtxt', conversationIds: [] };
    }
    return {
      models: [bestRecentConv.model],
      source: 'recent_conversation',
      conversationIds: [bestRecentConv.conversationId]
    };
  }
  if (bestPbtxt) {
    return { models: [bestPbtxt.model], source: 'pbtxt', conversationIds: [] };
  }
  if (bestRecentConv) {
    return {
      models: [bestRecentConv.model],
      source: 'recent_conversation',
      conversationIds: [bestRecentConv.conversationId]
    };
  }

  return { models: [], source: 'none', conversationIds: [] };
}

module.exports = {
  detectActiveLocalModels,
  extractModelChangeFromUserInput,
  inspectTranscriptTailModel,
  parseSelectedAgentModelFromPbtxt,
  readSelectedModelFromPbtxt,
  resolveModelPlaceholder
};
