// @ts-check
'use strict';

const {
  REPORT_GRANULARITIES,
  REPORT_SCHEMA,
  analyzeProjectUsage,
  renderReportMarkdown
} = require('./usageReport');
const {
  buildRealtimeOverviewSnapshot,
  extractLimitsSummary
} = require('./aiReportAnalyzer');
const {
  BREAKDOWN_GROUPS,
  BREAKDOWN_PERIODS,
  HISTORY_GROUPS,
  HISTORY_RESOLUTIONS,
  SESSION_PERIODS,
  SESSION_SORTS,
  SESSION_STATES,
  getDevicesAndHealthQuery,
  getLimitsOverviewQuery,
  getLiveTokenRateSummary,
  getSubscriptionsAndForecastsQuery,
  listSessionsQuery,
  queryUsageBreakdown,
  queryUsageHistory
} = require('./openclawQueries');

const MCP_SUPPORTED_VERSIONS = Object.freeze(['2025-06-18', '2025-03-26', '2024-11-05']);
const PUSH_TO_OPENCLAW_TYPES = Object.freeze([
  'report',
  'usage',
  'sessions',
  'session_detail',
  'history',
  'devices',
  'limits',
  'subscriptions',
  'live_rate',
  'service_status',
  'test',
  'custom'
]);

const JSON_RPC_ERRORS = Object.freeze({
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603
});

const MAX_BATCH_SIZE = 20;
const MAX_BATCH_CONCURRENCY = 4;
const MAX_PROMPT_ARG_LENGTH = 1024;
const MAX_REPORT_LIST_LIMIT = 200;
const ABSOLUTE_PATH_RE = /^(?:\/|[a-zA-Z]:[\\/]|\\\\)/;

/**
 * @typedef {string | number | null} JsonRpcId
 * @typedef {{ jsonrpc: '2.0', id: JsonRpcId, result: any }} JsonRpcSuccess
 * @typedef {{ jsonrpc: '2.0', id: JsonRpcId, error: { code: number, message: string, data?: any } }} JsonRpcError
 * @typedef {JsonRpcSuccess | JsonRpcError} JsonRpcResponse
 */

const MCP_TOOLS = Object.freeze([
  {
    name: 'list_usage_reports',
    description: 'List available Token Monitor usage and project analysis reports.',
    inputSchema: {
      type: 'object',
      properties: {
        granularity: {
          type: 'string',
          enum: ['daily', 'weekly', 'monthly'],
          description: 'Optional granularity filter.'
        },
        limit: {
          type: 'integer',
          minimum: 1,
          description: 'Maximum number of report summaries to return.'
        }
      },
      additionalProperties: false
    }
  },
  {
    name: 'get_usage_report',
    description: 'Fetch a daily, weekly, or monthly Token Monitor usage report in JSON or Markdown format.',
    inputSchema: {
      type: 'object',
      properties: {
        granularity: {
          type: 'string',
          enum: ['daily', 'weekly', 'monthly'],
          description: 'Report granularity.'
        },
        periodKey: {
          type: 'string',
          description: 'Period key (YYYY-MM-DD, YYYY-Www, YYYY-MM) or "latest" / "current".'
        },
        format: {
          type: 'string',
          enum: ['json', 'markdown'],
          description: 'Output format (defaults to json).'
        }
      },
      required: ['granularity'],
      additionalProperties: false
    }
  },
  {
    name: 'generate_usage_report',
    description: 'Generate or refresh Token Monitor usage reports from current Hub state.',
    inputSchema: {
      type: 'object',
      properties: {
        granularity: {
          type: 'string',
          enum: ['daily', 'weekly', 'monthly'],
          description: 'Optional granularity to generate ("daily", "weekly", or "monthly"); omits to default to "all" (generating all granularities).'
        },
        periodKey: {
          type: 'string',
          description: 'Target period key or "latest".'
        },
        force: {
          type: 'boolean',
          description: 'Force writing report files even when content signature is unchanged.'
        }
      },
      additionalProperties: false
    }
  },
  {
    name: 'analyze_project_usage',
    description: 'Analyze project token share, cost attribution, and tool/model breakdown for a report period.',
    inputSchema: {
      type: 'object',
      properties: {
        granularity: {
          type: 'string',
          enum: ['daily', 'weekly', 'monthly'],
          description: 'Report granularity (defaults to weekly).'
        },
        periodKey: {
          type: 'string',
          description: 'Target period key or "latest".'
        },
        project: {
          type: 'string',
          description: 'Optional project name or canonical key filter.'
        },
        limit: {
          type: 'integer',
          minimum: 1,
          description: 'Maximum number of matching projects to return.'
        }
      },
      additionalProperties: false
    }
  },
  {
    name: 'get_realtime_usage_and_limits',
    description: 'Fetch live today/month/all-time usage telemetry, active devices, and third-party API & provider quota balances.',
    inputSchema: {
      type: 'object',
      properties: {
        thirdPartyOnly: {
          type: 'boolean',
          description: 'When true, filter limits to third-party API providers (New API, Sub2API, Custom).'
        },
        maxProviders: {
          type: 'integer',
          minimum: 1,
          maximum: 100,
          description: 'Maximum provider/quota entries to return.'
        }
      },
      additionalProperties: false
    }
  },
  {
    name: 'analyze_report_with_ai',
    description: 'Analyze a usage report and live quota snapshot using the configured third-party AI API, or answer a focused question about the data.',
    inputSchema: {
      type: 'object',
      properties: {
        granularity: {
          type: 'string',
          enum: ['daily', 'weekly', 'monthly'],
          description: 'Report granularity (defaults to daily).'
        },
        periodKey: {
          type: 'string',
          description: 'Period key or "latest" / "current".'
        },
        question: {
          type: 'string',
          description: 'Optional focused question about project cost, trends, or third-party quotas.'
        },
        language: {
          type: 'string',
          enum: ['zh-CN', 'en', 'auto'],
          description: 'Preferred analysis output language.'
        },
        refresh: {
          type: 'boolean',
          description: 'Bypass cached AI analysis and regenerate from the third-party AI API.'
        }
      },
      additionalProperties: false
    }
  },
  {
    name: 'push_report_to_openclaw',
    description: 'Format a usage report, live third-party API balances, and optional AI summary and deliver it via OpenClaw Gateway Webhook (e.g. to WeChat).',
    inputSchema: {
      type: 'object',
      properties: {
        granularity: {
          type: 'string',
          enum: ['daily', 'weekly', 'monthly'],
          description: 'Report granularity (defaults to daily).'
        },
        periodKey: {
          type: 'string',
          description: 'Period key or "latest" / "current".'
        },
        includeAi: {
          type: 'boolean',
          description: 'Include third-party AI analysis summary when available.'
        },
        includeLimits: {
          type: 'boolean',
          description: 'Include provider & third-party API quota balances.'
        },
        question: {
          type: 'string',
          description: 'Optional custom focus before delivery.'
        }
      },
      additionalProperties: false
    }
  },
  {
    name: 'query_usage_breakdown',
    description: 'Query token usage, known cost, unpriced tokens, cache hit rate, and throughput broken down by summary, model, client, project, or device.',
    inputSchema: {
      type: 'object',
      properties: {
        period: {
          type: 'string',
          enum: [...BREAKDOWN_PERIODS],
          description: 'Target usage period (today, month, week, last7, last30, allTime).'
        },
        range: {
          type: 'string',
          enum: [...BREAKDOWN_PERIODS],
          description: 'Alias for period.'
        },
        groupBy: {
          type: 'string',
          enum: [...BREAKDOWN_GROUPS],
          description: 'Breakdown dimension (summary, model, client, project, device).'
        },
        deviceId: {
          type: 'string',
          description: 'Optional device ID filter.'
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 500,
          description: 'Maximum breakdown rows to return (1..500).'
        },
        modelAliasGrouping: {
          type: 'string',
          description: 'Optional model alias grouping mode.'
        }
      },
      additionalProperties: false
    }
  },
  {
    name: 'list_sessions',
    description: 'List and filter coding sessions with live activity state, context window usage, prompt cache status, model, and project metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        period: {
          type: 'string',
          enum: [...SESSION_PERIODS],
          description: 'Session period (today, month, allTime).'
        },
        state: {
          type: 'string',
          enum: [...SESSION_STATES],
          description: 'Activity state filter (all, running, waiting, ended, idle).'
        },
        client: {
          type: 'string',
          description: 'Optional client filter (e.g. codex, claude, cursor).'
        },
        project: {
          type: 'string',
          description: 'Optional project name or key filter.'
        },
        deviceId: {
          type: 'string',
          description: 'Optional device ID filter.'
        },
        search: {
          type: 'string',
          description: 'Optional case-insensitive text search across allowed session fields.'
        },
        sort: {
          type: 'string',
          enum: [...SESSION_SORTS],
          description: 'Sort field (lastUsedAt, totalTokens, costUsd).'
        },
        sortDirection: {
          type: 'string',
          enum: ['asc', 'desc'],
          description: 'Sort direction (asc or desc).'
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 500,
          description: 'Maximum sessions per page (1..500).'
        },
        cursor: {
          type: 'string',
          description: 'Pagination cursor returned by a previous call.'
        }
      },
      additionalProperties: false
    }
  },
  {
    name: 'get_session_detail',
    description: 'Fetch per-turn exchange breakdown and optional conversation transcript for a session (gated by queryPermissions.allowSessionDetail and allowConversationText).',
    inputSchema: {
      type: 'object',
      properties: {
        client: {
          type: 'string',
          description: 'Client identifier (e.g. codex, claude, codebuddy).'
        },
        sessionId: {
          type: 'string',
          description: 'Session identifier.'
        },
        deviceId: {
          type: 'string',
          description: 'Optional device identifier.'
        },
        period: {
          type: 'string',
          enum: ['today', 'month', 'total', 'allTime'],
          description: 'Exchange filter period (defaults to total).'
        },
        includeConversation: {
          type: 'boolean',
          description: 'Include full conversation messages (requires allowConversationText).'
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 200,
          description: 'Maximum exchanges to return.'
        },
        offset: {
          type: 'integer',
          minimum: 0,
          description: 'Zero-based exchange offset for pagination.'
        },
        cursor: {
          type: 'string',
          description: 'Optional conversation pagination cursor.'
        }
      },
      required: ['client', 'sessionId'],
      additionalProperties: false
    }
  },
  {
    name: 'get_usage_history',
    description: 'Query daily, monthly, or summary historical usage trends, active days, streaks, peak day, and client/model breakdowns.',
    inputSchema: {
      type: 'object',
      properties: {
        resolution: {
          type: 'string',
          enum: [...HISTORY_RESOLUTIONS],
          description: 'History resolution (daily, monthly, summary).'
        },
        from: {
          type: 'string',
          description: 'Optional start date (YYYY-MM-DD or YYYY-MM).'
        },
        to: {
          type: 'string',
          description: 'Optional end date (YYYY-MM-DD or YYYY-MM).'
        },
        groupBy: {
          type: 'string',
          enum: [...HISTORY_GROUPS],
          description: 'Optional breakdown group (none, client, model).'
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 500,
          description: 'Maximum rows/breakdown items to return (1..500).'
        }
      },
      additionalProperties: false
    }
  },
  {
    name: 'get_devices_and_health',
    description: 'Query connected/stale devices, tracked clients, clientStatus, sanitized clientHealth diagnostics, and WSL status.',
    inputSchema: {
      type: 'object',
      properties: {
        deviceId: {
          type: 'string',
          description: 'Optional device ID filter.'
        },
        includeDiagnostics: {
          type: 'boolean',
          description: 'Include sanitized clientHealth diagnostic codes (defaults to true).'
        }
      },
      additionalProperties: false
    }
  },
  {
    name: 'get_limits_history',
    description: 'Query current provider & third-party API quota limits along with historical quota snapshots when available from the Desktop host.',
    inputSchema: {
      type: 'object',
      properties: {
        thirdPartyOnly: {
          type: 'boolean',
          description: 'Filter to third-party API providers only.'
        },
        provider: {
          type: 'string',
          description: 'Optional comma-separated provider ID filter.'
        },
        status: {
          type: 'string',
          description: 'Optional comma-separated status filter.'
        },
        accountKey: {
          type: 'string',
          description: 'Optional account key filter for quota history.'
        },
        windowName: {
          type: 'string',
          description: 'Optional quota window name filter for quota history.'
        },
        hours: {
          type: 'number',
          minimum: 1,
          maximum: 720,
          description: 'History lookback hours (1..720, defaults to 24).'
        },
        maxProviders: {
          type: 'integer',
          minimum: 1,
          maximum: 100,
          description: 'Maximum provider accounts to return (1..100).'
        },
        includeHistory: {
          type: 'boolean',
          description: 'Include historical quota series when available (defaults to true).'
        }
      },
      additionalProperties: false
    }
  },
  {
    name: 'get_subscriptions_and_forecasts',
    description: 'Query active subscriptions, normalized monthly USD spend, renewal countdowns, and top-up balance exhaustion forecasts.',
    inputSchema: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description: 'Optional evaluation date YYYY-MM-DD.'
        },
        includeForecasts: {
          type: 'boolean',
          description: 'Include top-up exhaustion forecasts (defaults to true).'
        },
        activeOnly: {
          type: 'boolean',
          description: 'Return only currently active subscriptions.'
        }
      },
      additionalProperties: false
    }
  },
  {
    name: 'get_live_token_rate',
    description: 'Query current live output token speed (tok/s) and cost burn rate, falling back to period throughput counters when idle.',
    inputSchema: {
      type: 'object',
      properties: {
        deviceId: {
          type: 'string',
          description: 'Optional device ID filter.'
        }
      },
      additionalProperties: false
    }
  },
  {
    name: 'get_service_status_and_approvals',
    description: 'Query official upstream AI service status incidents, Codex reset forecast, and pending Desktop tool approval alerts.',
    inputSchema: {
      type: 'object',
      properties: {
        force: {
          type: 'boolean',
          description: 'Bypass cached status checks when supported by the Desktop host.'
        },
        providerIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of upstream service status provider IDs.'
        },
        includeResetForecast: {
          type: 'boolean',
          description: 'Include Codex reset forecast section (defaults to true).'
        },
        includeApprovals: {
          type: 'boolean',
          description: 'Include pending approval alerts section (defaults to true).'
        }
      },
      additionalProperties: false
    }
  },
  {
    name: 'push_to_openclaw',
    description: 'Format and push a report, live query digest, connectivity test, or custom notification via OpenClaw Gateway (e.g. WeChat).',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: [...PUSH_TO_OPENCLAW_TYPES],
          description: 'Push payload type (report, usage, sessions, session_detail, history, devices, limits, subscriptions, live_rate, service_status, test, custom).'
        },
        params: {
          type: 'object',
          description: 'Optional query or report parameters matching the chosen type.'
        },
        includeAi: {
          type: 'boolean',
          description: 'Include optional third-party AI summary when enabled.'
        },
        customMessage: {
          type: 'string',
          description: 'Optional custom message body or prefix.'
        },
        idempotencyKey: {
          type: 'string',
          description: 'Optional idempotency key for sliding-window duplicate prevention.'
        },
        test: {
          type: 'boolean',
          description: 'Shortcut to send a connectivity test notification.'
        }
      },
      additionalProperties: false
    }
  }
]);

const MCP_STATIC_RESOURCES = Object.freeze([
  {
    uri: 'report://latest/daily',
    name: 'Latest Daily Usage Report',
    description: 'Current daily Token Monitor usage & project analysis report (JSON).',
    mimeType: 'application/json'
  },
  {
    uri: 'report://latest/weekly',
    name: 'Latest Weekly Usage Report',
    description: 'Current ISO weekly Token Monitor usage & project analysis report (JSON).',
    mimeType: 'application/json'
  },
  {
    uri: 'report://latest/monthly',
    name: 'Latest Monthly Usage Report',
    description: 'Current monthly Token Monitor usage & project analysis report (JSON).',
    mimeType: 'application/json'
  },
  {
    uri: 'usage://today',
    name: 'Today Usage Breakdown',
    description: 'Live today token usage, known cost, cache efficiency, and throughput summary (JSON).',
    mimeType: 'application/json'
  },
  {
    uri: 'sessions://active',
    name: 'Active and Recent Sessions',
    description: 'Live session list with activity state, context window usage, model, and project metadata (JSON).',
    mimeType: 'application/json'
  },
  {
    uri: 'limits://current',
    name: 'Current Quota Limits',
    description: 'Sanitized provider and third-party API quota balances and reset countdowns (JSON).',
    mimeType: 'application/json'
  },
  {
    uri: 'devices://health',
    name: 'Devices and Client Health',
    description: 'Connected/stale devices, tracked clients, clientHealth diagnostics, and WSL status (JSON).',
    mimeType: 'application/json'
  },
  {
    uri: 'subscriptions://summary',
    name: 'Subscriptions and Top-Up Forecasts',
    description: 'Active subscriptions, monthly USD total, renewal dates, and top-up exhaustion forecasts (JSON).',
    mimeType: 'application/json'
  },
  {
    uri: 'service-status://current',
    name: 'Upstream Service Status and Approvals',
    description: 'Combined AI provider service status, Codex reset forecast, and pending approval alerts (JSON).',
    mimeType: 'application/json'
  }
]);

const MCP_RESOURCE_TEMPLATES = Object.freeze([
  {
    uriTemplate: 'report://{granularity}/{periodKey}',
    name: 'Usage Report by Period',
    description: 'Read a daily, weekly, or monthly Token Monitor report (optional ?format=markdown).',
    mimeType: 'application/json'
  }
]);

const MCP_PROMPTS = Object.freeze([
  {
    name: 'analyze-daily-report',
    description: 'Analyze a daily Token Monitor usage report for anomalies, project concentration, and cache efficiency.',
    arguments: [
      {
        name: 'periodKey',
        description: 'Target date YYYY-MM-DD or "latest".',
        required: false
      }
    ]
  },
  {
    name: 'analyze-weekly-report',
    description: 'Analyze a weekly Token Monitor usage report across projects, tools, models, and devices.',
    arguments: [
      {
        name: 'periodKey',
        description: 'Target ISO week YYYY-Www or "latest".',
        required: false
      }
    ]
  },
  {
    name: 'analyze-monthly-report',
    description: 'Analyze a monthly Token Monitor usage report for cost trends, model mix, and project share.',
    arguments: [
      {
        name: 'periodKey',
        description: 'Target month YYYY-MM or "latest".',
        required: false
      }
    ]
  },
  {
    name: 'project-deep-dive',
    description: 'Perform a deep dive into token usage, cost, and tool/model efficiency for a specific project.',
    arguments: [
      {
        name: 'project',
        description: 'Project name or canonical key.',
        required: true
      },
      {
        name: 'granularity',
        description: 'Report granularity: daily, weekly, or monthly.',
        required: false
      },
      {
        name: 'periodKey',
        description: 'Period key or "latest".',
        required: false
      }
    ]
  },
  {
    name: 'wechat-digest',
    description: 'Produce a concise mobile/WeChat-ready digest combining today/period usage, top projects, third-party API balances, and AI insights.',
    arguments: [
      {
        name: 'granularity',
        description: 'Report granularity: daily, weekly, or monthly.',
        required: false
      },
      {
        name: 'periodKey',
        description: 'Period key or "latest".',
        required: false
      }
    ]
  },
  {
    name: 'session-summary',
    description: 'Summarize active or recent coding sessions, token/cost breakdown, context remaining, and optional turn details.',
    arguments: [
      {
        name: 'sessionId',
        description: 'Optional session ID (omit to inspect active/recent sessions).',
        required: false
      },
      {
        name: 'client',
        description: 'Optional client identifier (e.g. codex, claude, cursor).',
        required: false
      },
      {
        name: 'period',
        description: 'Session period: today, month, or allTime.',
        required: false
      }
    ]
  },
  {
    name: 'quota-check',
    description: 'Check provider and third-party API quota balances, reset countdowns, top-up exhaustion forecasts, and service incidents.',
    arguments: [
      {
        name: 'provider',
        description: 'Optional provider filter (e.g. claude, codex, thirdparty).',
        required: false
      },
      {
        name: 'includeHistory',
        description: 'Set "true" to inspect recent quota history trends.',
        required: false
      }
    ]
  },
  {
    name: 'daily-standup-usage',
    description: 'Prepare a concise engineering standup summary of today/recent usage, active projects, quota health, and live throughput.',
    arguments: [
      {
        name: 'date',
        description: 'Target calendar date YYYY-MM-DD (defaults to today).',
        required: false
      }
    ]
  }
]);

/**
 * @param {JsonRpcId} id
 * @param {any} result
 * @returns {JsonRpcSuccess}
 */
function jsonRpcOk(id, result) {
  return { jsonrpc: '2.0', id, result };
}

/**
 * @param {JsonRpcId} id
 * @param {number} code
 * @param {string} message
 * @param {any} [data]
 * @returns {JsonRpcError}
 */
function jsonRpcErr(id, code, message, data) {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
      ...(data !== undefined ? { data } : {})
    }
  };
}

/**
 * @param {any} value
 * @returns {boolean}
 */
function isValidJsonRpcId(value) {
  return value === null
    || typeof value === 'string'
    || (typeof value === 'number' && Number.isFinite(value));
}

/**
 * @param {any} message
 * @returns {JsonRpcId}
 */
function fallbackId(message) {
  return message && typeof message === 'object' && isValidJsonRpcId(message.id) ? message.id : null;
}

/**
 * @param {string} text
 * @returns {{ content: Array<{ type: 'text', text: string }>, isError: true }}
 */
function toolErrorResult(text) {
  return {
    content: [{ type: 'text', text: String(text || 'Tool execution failed') }],
    isError: true
  };
}

/**
 * @param {any} result
 * @returns {string | null}
 */
function extractBackendError(result) {
  if (!result || typeof result !== 'object') return null;
  if (result.ok === false) {
    const err = typeof result.error === 'string' ? result.error.trim() : '';
    const msg = typeof result.message === 'string' ? result.message.trim() : '';
    if (err && msg && msg !== err) return `${err}: ${msg}`;
    return String(err || msg || 'Operation failed');
  }
  if (typeof result.error === 'string' && result.error) {
    const msg = typeof result.message === 'string' ? result.message.trim() : '';
    return msg && msg !== result.error ? `${result.error}: ${msg}` : result.error;
  }
  return null;
}

/**
 * Convert an absolute report file path into a host-path-free relative identifier.
 * @param {string} value
 * @returns {string}
 */
function toRelativeReportFile(value) {
  const normalized = value.replace(/\\/g, '/');
  if (!ABSOLUTE_PATH_RE.test(value)) return normalized;
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length >= 2 && REPORT_GRANULARITIES.includes(parts[parts.length - 2])) {
    return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
  }
  return parts[parts.length - 1] || '';
}

/**
 * Strip host filesystem paths (`reportsDir`, `stateDir`, `cliPath`, absolute `files.*`)
 * from MCP tool responses so remote callers cannot enumerate host directories.
 * @param {any} payload
 * @param {number} [depth]
 * @returns {any}
 */
function stripHostPathsFromPayload(payload, depth = 0) {
  if (depth > 8 || payload === null || payload === undefined || typeof payload !== 'object') {
    return payload;
  }
  if (Array.isArray(payload)) {
    return payload.map((item) => stripHostPathsFromPayload(item, depth + 1));
  }
  /** @type {Record<string, any>} */
  const copy = {};
  for (const [key, value] of Object.entries(payload)) {
    if (key === 'reportsDir' || key === 'stateDir' || key === 'cliPath') continue;
    if (key === 'files' && value && typeof value === 'object' && !Array.isArray(value)) {
      /** @type {Record<string, any>} */
      const cleanFiles = {};
      for (const [fk, fv] of Object.entries(value)) {
        cleanFiles[fk] = typeof fv === 'string' ? toRelativeReportFile(fv) : fv;
      }
      copy.files = cleanFiles;
      continue;
    }
    copy[key] = stripHostPathsFromPayload(value, depth + 1);
  }
  return copy;
}

/**
 * Format a JSON-capable tool result cleanly.
 * @param {any} payload
 */
function jsonToolResult(payload) {
  const safePayload = stripHostPathsFromPayload(payload);
  return {
    content: [{ type: 'text', text: JSON.stringify(safePayload, null, 2) }],
    ...(safePayload && typeof safePayload === 'object' && !Array.isArray(safePayload) ? { structuredContent: safePayload } : {})
  };
}

/**
 * @param {any} result
 * @returns {any}
 */
function unwrapReportObject(result) {
  if (!result || typeof result !== 'object') return null;
  if (result.report && typeof result.report === 'object') return result.report;
  if (result.schema === REPORT_SCHEMA || (result.summary && result.period)) return result;
  return null;
}

/**
 * @param {string} uriString
 * @returns {{ granularity: 'daily' | 'weekly' | 'monthly', periodKey: string, format: 'json' | 'markdown' } | null}
 */
function parseReportUri(uriString) {
  let parsed;
  try {
    parsed = new URL(uriString);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'report:') return null;
  let host;
  let segments;
  try {
    host = decodeURIComponent(parsed.hostname || '');
    segments = parsed.pathname
      .split('/')
      .filter(Boolean)
      .map((part) => decodeURIComponent(part));
  } catch {
    return null;
  }
  if (segments.length !== 1) return null;

  let granularity;
  let periodKey;
  if (host === 'latest') {
    granularity = segments[0];
    periodKey = 'latest';
  } else {
    granularity = host;
    periodKey = segments[0];
  }
  if (!REPORT_GRANULARITIES.includes(granularity) || !periodKey) return null;

  const formatParam = parsed.searchParams.get('format') || 'json';
  if (formatParam !== 'json' && formatParam !== 'markdown') return null;

  return {
    granularity: /** @type {'daily' | 'weekly' | 'monthly'} */ (granularity),
    periodKey,
    format: formatParam
  };
}

/**
 * Create a zero-dependency MCP JSON-RPC 2.0 report & query server.
 * @param {object} options
 * @param {(args: { granularity?: string, limit?: number }) => Promise<any> | any} [options.listReports]
 * @param {(args: { granularity: string, periodKey?: string, format?: string }) => Promise<any> | any} [options.getReport]
 * @param {(args: { granularity?: string, periodKey?: string, force?: boolean }) => Promise<any> | any} [options.generateReport]
 * @param {(args: { granularity?: string, periodKey?: string, project?: string, limit?: number }) => Promise<any> | any} [options.analyzeProjects]
 * @param {() => Promise<any> | any} [options.getStats]
 * @param {() => Promise<any> | any} [options.getHistory]
 * @param {() => Promise<any> | any} [options.getSubscriptions]
 * @param {(args: { granularity?: string, periodKey?: string, question?: string, language?: string, refresh?: boolean }) => Promise<any> | any} [options.analyzeWithAi]
 * @param {(args: { granularity?: string, periodKey?: string, includeAi?: boolean, includeLimits?: boolean, question?: string }) => Promise<any> | any} [options.pushToOpenClaw]
 * @param {(args: { type?: string, test?: boolean, params?: any, includeAi?: boolean, customMessage?: string, idempotencyKey?: string }) => Promise<any> | any} [options.pushEventToOpenClaw]
 * @param {(args: any) => Promise<any> | any} [options.queryUsageBreakdown]
 * @param {(args: any) => Promise<any> | any} [options.listSessions]
 * @param {(args: any) => Promise<any> | any} [options.getSessionDetail]
 * @param {(args: any) => Promise<any> | any} [options.getUsageHistory]
 * @param {(args: any) => Promise<any> | any} [options.getDevicesAndHealth]
 * @param {(args: any) => Promise<any> | any} [options.getLimitsHistory]
 * @param {(args: any) => Promise<any> | any} [options.getSubscriptionsAndForecasts]
 * @param {(args: any) => Promise<any> | any} [options.getLiveTokenRate]
 * @param {(args: any) => Promise<any> | any} [options.getServiceStatusAndApprovals]
 * @param {() => Promise<any> | any} [options.listApprovalAlerts]
 * @param {boolean} [options.sessionTitlesEnabled]
 * @param {{ name?: string, version?: string }} [options.serverInfo]
 * @returns {{ handleMessage: (message: any) => Promise<JsonRpcResponse | null>, handlePayload: (payload: any) => Promise<JsonRpcResponse | JsonRpcResponse[] | null> }}
 */
function createMcpReportServer({
  listReports,
  getReport,
  generateReport,
  analyzeProjects,
  getStats,
  getHistory,
  getSubscriptions,
  analyzeWithAi,
  pushToOpenClaw,
  pushEventToOpenClaw,
  queryUsageBreakdown: queryUsageBreakdownFn,
  listSessions: listSessionsFn,
  getSessionDetail: getSessionDetailFn,
  getUsageHistory: getUsageHistoryFn,
  getDevicesAndHealth: getDevicesAndHealthFn,
  getLimitsHistory: getLimitsHistoryFn,
  getSubscriptionsAndForecasts: getSubscriptionsAndForecastsFn,
  getLiveTokenRate: getLiveTokenRateFn,
  getServiceStatusAndApprovals: getServiceStatusAndApprovalsFn,
  listApprovalAlerts,
  sessionTitlesEnabled = false,
  serverInfo
} = {}) {
  const resolvedServerInfo = {
    name: String(serverInfo?.name || 'token-monitor-reports'),
    version: String(serverInfo?.version || '1.0.0')
  };

  /**
   * @param {string} name
   * @param {Record<string, any>} args
   */
  async function executeTool(name, args) {
    if (name === 'list_usage_reports') {
      if (typeof listReports !== 'function') {
        return toolErrorResult('list_usage_reports backend is not configured.');
      }
      if (args.granularity !== undefined && !REPORT_GRANULARITIES.includes(String(args.granularity))) {
        return toolErrorResult(`Invalid granularity: ${String(args.granularity)}`);
      }
      if (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1)) {
        return toolErrorResult('limit must be a positive integer.');
      }
      const clampedLimit = args.limit !== undefined ? Math.min(MAX_REPORT_LIST_LIMIT, args.limit) : undefined;
      const result = await listReports({
        ...(args.granularity !== undefined ? { granularity: String(args.granularity) } : {}),
        ...(clampedLimit !== undefined ? { limit: clampedLimit } : {})
      });
      const backendErr = extractBackendError(result);
      if (backendErr) return toolErrorResult(backendErr);
      const safeResult = stripHostPathsFromPayload(result);
      return {
        content: [{ type: 'text', text: JSON.stringify(safeResult, null, 2) }],
        ...(safeResult && typeof safeResult === 'object' && !Array.isArray(safeResult) ? { structuredContent: safeResult } : {})
      };
    }

    if (name === 'get_usage_report') {
      if (typeof getReport !== 'function') {
        return toolErrorResult('get_usage_report backend is not configured.');
      }
      const granularity = String(args.granularity || '').trim();
      if (!REPORT_GRANULARITIES.includes(granularity)) {
        return toolErrorResult(`Invalid or missing granularity "${granularity}". Expected daily, weekly, or monthly.`);
      }
      const periodKey = args.periodKey !== undefined ? String(args.periodKey) : 'latest';
      const format = args.format !== undefined ? String(args.format) : 'json';
      if (format !== 'json' && format !== 'markdown') {
        return toolErrorResult(`Unsupported report format "${format}". Expected json or markdown.`);
      }
      const result = await getReport({ granularity, periodKey, format });
      const backendErr = extractBackendError(result);
      if (backendErr) return toolErrorResult(backendErr);
      if (!result) return toolErrorResult(`Report not found for ${granularity}:${periodKey}.`);

      if (format === 'markdown') {
        let md;
        if (typeof result === 'string') {
          md = result;
        } else if (typeof result.markdown === 'string') {
          md = result.markdown;
        } else {
          const reportObj = unwrapReportObject(result);
          md = reportObj ? renderReportMarkdown(reportObj) : JSON.stringify(result, null, 2);
        }
        return { content: [{ type: 'text', text: md }] };
      }

      const reportObj = unwrapReportObject(result) || result;
      const rawPayloadObj = reportObj && typeof reportObj === 'object' && !Array.isArray(reportObj) && result.aiAnalysis && !reportObj.aiAnalysis
        ? { ...reportObj, aiAnalysis: result.aiAnalysis }
        : reportObj;
      const payloadObj = stripHostPathsFromPayload(rawPayloadObj);
      return {
        content: [{
          type: 'text',
          text: typeof payloadObj === 'string' ? payloadObj : JSON.stringify(payloadObj, null, 2)
        }],
        ...(payloadObj && typeof payloadObj === 'object' && !Array.isArray(payloadObj)
          ? { structuredContent: payloadObj }
          : {})
      };
    }

    if (name === 'generate_usage_report') {
      if (typeof generateReport !== 'function') {
        return toolErrorResult('generate_usage_report backend is not configured.');
      }
      if (args.granularity !== undefined && !REPORT_GRANULARITIES.includes(String(args.granularity))) {
        return toolErrorResult(`Invalid granularity: ${String(args.granularity)}`);
      }
      const result = await generateReport({
        ...(args.granularity !== undefined ? { granularity: String(args.granularity) } : {}),
        ...(args.periodKey !== undefined ? { periodKey: String(args.periodKey) } : {}),
        ...(args.force !== undefined ? { force: Boolean(args.force) } : {})
      });
      const backendErr = extractBackendError(result);
      if (backendErr) return toolErrorResult(backendErr);
      const safeResult = stripHostPathsFromPayload(result);
      return {
        content: [{ type: 'text', text: JSON.stringify(safeResult, null, 2) }],
        ...(safeResult && typeof safeResult === 'object' && !Array.isArray(safeResult) ? { structuredContent: safeResult } : {})
      };
    }

    if (name === 'analyze_project_usage') {
      const granularity = args.granularity !== undefined ? String(args.granularity) : 'weekly';
      if (!REPORT_GRANULARITIES.includes(granularity)) {
        return toolErrorResult(`Invalid granularity: ${granularity}`);
      }
      const periodKey = args.periodKey !== undefined ? String(args.periodKey) : 'latest';
      const project = args.project !== undefined ? String(args.project) : undefined;
      if (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1)) {
        return toolErrorResult('limit must be a positive integer.');
      }
      const limit = args.limit !== undefined ? Math.min(MAX_REPORT_LIST_LIMIT, args.limit) : undefined;

      let analysis;
      if (typeof analyzeProjects === 'function') {
        analysis = await analyzeProjects({ granularity, periodKey, project, limit });
        const backendErr = extractBackendError(analysis);
        if (backendErr) return toolErrorResult(backendErr);
      } else if (typeof getReport === 'function') {
        const fetched = await getReport({ granularity, periodKey, format: 'json' });
        const backendErr = extractBackendError(fetched);
        if (backendErr) return toolErrorResult(backendErr);
        const reportObj = unwrapReportObject(fetched);
        if (!reportObj) return toolErrorResult(`Report not found for ${granularity}:${periodKey}.`);
        analysis = analyzeProjectUsage(reportObj, { project, limit });
      } else {
        return toolErrorResult('analyze_project_usage backend is not configured.');
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(analysis, null, 2) }],
        ...(analysis && typeof analysis === 'object' && !Array.isArray(analysis)
          ? { structuredContent: analysis }
          : {})
      };
    }

    if (name === 'get_realtime_usage_and_limits') {
      if (typeof getStats !== 'function') {
        return toolErrorResult('get_realtime_usage_and_limits backend is not configured.');
      }
      if (args.maxProviders !== undefined && (!Number.isInteger(args.maxProviders) || args.maxProviders < 1 || args.maxProviders > 100)) {
        return toolErrorResult('maxProviders must be an integer between 1 and 100.');
      }
      const stats = await getStats();
      const backendErr = extractBackendError(stats);
      if (backendErr) return toolErrorResult(backendErr);
      const limitsSummary = extractLimitsSummary(stats, {
        thirdPartyOnly: Boolean(args.thirdPartyOnly),
        maxProviders: args.maxProviders
      });
      const overview = buildRealtimeOverviewSnapshot(stats, limitsSummary);
      return {
        content: [{ type: 'text', text: JSON.stringify(overview, null, 2) }],
        structuredContent: overview
      };
    }

    if (name === 'analyze_report_with_ai') {
      if (typeof analyzeWithAi !== 'function') {
        return toolErrorResult('analyze_report_with_ai backend is not configured.');
      }
      const granularity = args.granularity !== undefined ? String(args.granularity).trim() : 'daily';
      if (!REPORT_GRANULARITIES.includes(granularity)) {
        return toolErrorResult(`Invalid granularity: ${granularity}`);
      }
      const result = await analyzeWithAi({
        granularity,
        periodKey: args.periodKey !== undefined ? String(args.periodKey) : 'latest',
        ...(args.question !== undefined ? { question: String(args.question) } : {}),
        ...(args.language !== undefined ? { language: String(args.language) } : {}),
        ...(args.refresh !== undefined ? { refresh: Boolean(args.refresh) } : {})
      });
      const backendErr = extractBackendError(result);
      if (backendErr) return toolErrorResult(backendErr);
      return {
        content: [{
          type: 'text',
          text: result?.aiAnalysis?.summaryMarkdown || JSON.stringify(result, null, 2)
        }],
        ...(result && typeof result === 'object' && !Array.isArray(result) ? { structuredContent: result } : {})
      };
    }

    if (name === 'push_report_to_openclaw') {
      if (typeof pushToOpenClaw !== 'function') {
        return toolErrorResult('push_report_to_openclaw backend is not configured.');
      }
      const granularity = args.granularity !== undefined ? String(args.granularity).trim() : 'daily';
      if (!REPORT_GRANULARITIES.includes(granularity)) {
        return toolErrorResult(`Invalid granularity: ${granularity}`);
      }
      const result = await pushToOpenClaw({
        granularity,
        periodKey: args.periodKey !== undefined ? String(args.periodKey) : 'latest',
        ...(args.includeAi !== undefined ? { includeAi: Boolean(args.includeAi) } : {}),
        ...(args.includeLimits !== undefined ? { includeLimits: Boolean(args.includeLimits) } : {}),
        ...(args.question !== undefined ? { question: String(args.question) } : {})
      });
      const backendErr = extractBackendError(result);
      if (backendErr) return toolErrorResult(backendErr);
      return jsonToolResult(result);
    }

    if (name === 'query_usage_breakdown') {
      if (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 500)) {
        return toolErrorResult('limit must be an integer between 1 and 500.');
      }
      const normPeriod = args.period !== undefined
        ? (String(args.period).trim().toLowerCase() === 'alltime' ? 'allTime' : String(args.period).trim().toLowerCase())
        : undefined;
      if (normPeriod !== undefined && !BREAKDOWN_PERIODS.includes(normPeriod)) {
        return toolErrorResult(`Invalid period: ${String(args.period)}`);
      }
      const normRange = args.range !== undefined
        ? (String(args.range).trim().toLowerCase() === 'alltime' ? 'allTime' : String(args.range).trim().toLowerCase())
        : undefined;
      if (normRange !== undefined && !BREAKDOWN_PERIODS.includes(normRange)) {
        return toolErrorResult(`Invalid range: ${String(args.range)}`);
      }
      const normGroup = args.groupBy !== undefined ? String(args.groupBy).trim().toLowerCase() : undefined;
      if (normGroup !== undefined && !BREAKDOWN_GROUPS.includes(normGroup)) {
        return toolErrorResult(`Invalid groupBy: ${String(args.groupBy)}`);
      }
      const queryArgs = {
        ...(normPeriod !== undefined ? { period: normPeriod } : {}),
        ...(normRange !== undefined ? { range: normRange } : {}),
        ...(normGroup !== undefined ? { groupBy: normGroup } : {}),
        ...(args.deviceId !== undefined ? { deviceId: String(args.deviceId) } : {}),
        ...(args.limit !== undefined ? { limit: args.limit } : {}),
        ...(args.modelAliasGrouping !== undefined ? { modelAliasGrouping: String(args.modelAliasGrouping) } : {})
      };
      let result;
      if (typeof queryUsageBreakdownFn === 'function') {
        result = await queryUsageBreakdownFn(queryArgs);
      } else if (typeof getStats === 'function') {
        const stats = await getStats();
        const statsErr = extractBackendError(stats);
        if (statsErr) return toolErrorResult(statsErr);
        const history = typeof getHistory === 'function' ? await getHistory() : stats?.history;
        result = queryUsageBreakdown({ stats, history, ...queryArgs });
      } else {
        return toolErrorResult('query_usage_breakdown backend is not configured.');
      }
      const backendErr = extractBackendError(result);
      if (backendErr) return toolErrorResult(backendErr);
      return jsonToolResult(result);
    }

    if (name === 'list_sessions') {
      if (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 500)) {
        return toolErrorResult('limit must be an integer between 1 and 500.');
      }
      const normPeriod = args.period !== undefined
        ? (String(args.period).trim().toLowerCase() === 'alltime' ? 'allTime' : String(args.period).trim().toLowerCase())
        : undefined;
      if (normPeriod !== undefined && !SESSION_PERIODS.includes(normPeriod)) {
        return toolErrorResult(`Invalid session period: ${String(args.period)}`);
      }
      const normState = args.state !== undefined ? String(args.state).trim().toLowerCase() : undefined;
      if (normState !== undefined && !SESSION_STATES.includes(normState)) {
        return toolErrorResult(`Invalid session state: ${String(args.state)}`);
      }
      const normSort = args.sort !== undefined
        ? SESSION_SORTS.find((item) => item.toLowerCase() === String(args.sort).trim().toLowerCase())
        : undefined;
      if (args.sort !== undefined && !normSort) {
        return toolErrorResult(`Invalid session sort: ${String(args.sort)}`);
      }
      const normDir = args.sortDirection !== undefined ? String(args.sortDirection).trim().toLowerCase() : undefined;
      if (normDir !== undefined && normDir !== 'asc' && normDir !== 'desc') {
        return toolErrorResult(`Invalid sortDirection: ${String(args.sortDirection)}`);
      }
      const queryArgs = {
        ...(normPeriod !== undefined ? { period: normPeriod } : {}),
        ...(normState !== undefined ? { state: normState } : {}),
        ...(args.client !== undefined ? { client: String(args.client) } : {}),
        ...(args.project !== undefined ? { project: String(args.project) } : {}),
        ...(args.deviceId !== undefined ? { deviceId: String(args.deviceId) } : {}),
        ...(args.search !== undefined ? { search: String(args.search) } : {}),
        ...(normSort !== undefined ? { sort: normSort } : {}),
        ...(normDir !== undefined ? { sortDirection: normDir } : {}),
        ...(args.limit !== undefined ? { limit: args.limit } : {}),
        ...(args.cursor !== undefined ? { cursor: String(args.cursor) } : {})
      };
      let result;
      if (typeof listSessionsFn === 'function') {
        result = await listSessionsFn(queryArgs);
      } else if (typeof getStats === 'function') {
        const stats = await getStats();
        const statsErr = extractBackendError(stats);
        if (statsErr) return toolErrorResult(statsErr);
        result = listSessionsQuery({
          stats,
          sessionTitlesEnabled: sessionTitlesEnabled === true,
          ...queryArgs
        });
      } else {
        return toolErrorResult('list_sessions backend is not configured.');
      }
      const backendErr = extractBackendError(result);
      if (backendErr) return toolErrorResult(backendErr);
      return jsonToolResult(result);
    }

    if (name === 'get_session_detail') {
      if (typeof getSessionDetailFn !== 'function') {
        return toolErrorResult('get_session_detail backend is not configured.');
      }
      const client = typeof args.client === 'string' ? args.client.trim() : '';
      const sessionId = typeof args.sessionId === 'string' ? args.sessionId.trim() : '';
      if (!client || !sessionId) {
        return toolErrorResult('client and sessionId are required.');
      }
      if (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 200)) {
        return toolErrorResult('limit must be an integer between 1 and 200.');
      }
      if (args.offset !== undefined && (!Number.isInteger(args.offset) || args.offset < 0)) {
        return toolErrorResult('offset must be a non-negative integer.');
      }
      const period = args.period !== undefined ? String(args.period).trim() : 'total';
      if (!['today', 'month', 'total', 'allTime'].includes(period)) {
        return toolErrorResult(`Invalid period: ${period}`);
      }
      const result = await getSessionDetailFn({
        client,
        sessionId,
        ...(args.deviceId !== undefined ? { deviceId: String(args.deviceId) } : {}),
        period,
        ...(args.includeConversation !== undefined ? { includeConversation: Boolean(args.includeConversation) } : {}),
        ...(args.limit !== undefined ? { limit: args.limit } : {}),
        ...(args.offset !== undefined ? { offset: args.offset } : {}),
        ...(args.cursor !== undefined ? { cursor: String(args.cursor) } : {})
      });
      const backendErr = extractBackendError(result);
      if (backendErr) return toolErrorResult(backendErr);
      return jsonToolResult(result);
    }

    if (name === 'get_usage_history') {
      if (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 500)) {
        return toolErrorResult('limit must be an integer between 1 and 500.');
      }
      const resolution = args.resolution !== undefined ? String(args.resolution).trim().toLowerCase() : undefined;
      if (resolution !== undefined && !HISTORY_RESOLUTIONS.includes(resolution)) {
        return toolErrorResult(`Invalid history resolution: ${String(args.resolution)}`);
      }
      const groupBy = args.groupBy !== undefined ? String(args.groupBy).trim().toLowerCase() : undefined;
      if (groupBy !== undefined && !HISTORY_GROUPS.includes(groupBy)) {
        return toolErrorResult(`Invalid history groupBy: ${String(args.groupBy)}`);
      }
      const queryArgs = {
        ...(resolution !== undefined ? { resolution } : {}),
        ...(args.from !== undefined ? { from: String(args.from) } : {}),
        ...(args.to !== undefined ? { to: String(args.to) } : {}),
        ...(groupBy !== undefined ? { groupBy } : {}),
        ...(args.limit !== undefined ? { limit: args.limit } : {})
      };
      let result;
      if (typeof getUsageHistoryFn === 'function') {
        result = await getUsageHistoryFn(queryArgs);
      } else if (typeof getHistory === 'function' || typeof getStats === 'function') {
        const history = typeof getHistory === 'function'
          ? await getHistory()
          : (typeof getStats === 'function' ? (await getStats())?.history : null);
        result = queryUsageHistory({ history, ...queryArgs });
      } else {
        return toolErrorResult('get_usage_history backend is not configured.');
      }
      const backendErr = extractBackendError(result);
      if (backendErr) return toolErrorResult(backendErr);
      return jsonToolResult(result);
    }

    if (name === 'get_devices_and_health') {
      const queryArgs = {
        ...(args.deviceId !== undefined ? { deviceId: String(args.deviceId) } : {}),
        ...(args.includeDiagnostics !== undefined ? { includeDiagnostics: Boolean(args.includeDiagnostics) } : {})
      };
      let result;
      if (typeof getDevicesAndHealthFn === 'function') {
        result = await getDevicesAndHealthFn(queryArgs);
      } else if (typeof getStats === 'function') {
        const stats = await getStats();
        const statsErr = extractBackendError(stats);
        if (statsErr) return toolErrorResult(statsErr);
        result = getDevicesAndHealthQuery({ stats, ...queryArgs });
      } else {
        return toolErrorResult('get_devices_and_health backend is not configured.');
      }
      const backendErr = extractBackendError(result);
      if (backendErr) return toolErrorResult(backendErr);
      return jsonToolResult(result);
    }

    if (name === 'get_limits_history') {
      if (args.maxProviders !== undefined && (!Number.isInteger(args.maxProviders) || args.maxProviders < 1 || args.maxProviders > 100)) {
        return toolErrorResult('maxProviders must be an integer between 1 and 100.');
      }
      if (args.hours !== undefined && (!Number.isFinite(Number(args.hours)) || Number(args.hours) < 1 || Number(args.hours) > 720)) {
        return toolErrorResult('hours must be a number between 1 and 720.');
      }
      const queryArgs = {
        ...(args.thirdPartyOnly !== undefined ? { thirdPartyOnly: Boolean(args.thirdPartyOnly) } : {}),
        ...(args.provider !== undefined ? { provider: String(args.provider) } : {}),
        ...(args.status !== undefined ? { status: String(args.status) } : {}),
        ...(args.accountKey !== undefined ? { accountKey: String(args.accountKey) } : {}),
        ...(args.windowName !== undefined ? { windowName: String(args.windowName) } : {}),
        ...(args.hours !== undefined ? { hours: Number(args.hours) } : {}),
        ...(args.maxProviders !== undefined ? { maxProviders: args.maxProviders } : {}),
        includeHistory: args.includeHistory !== undefined ? Boolean(args.includeHistory) : true
      };
      let result;
      if (typeof getLimitsHistoryFn === 'function') {
        result = await getLimitsHistoryFn(queryArgs);
      } else if (typeof getStats === 'function') {
        const stats = await getStats();
        const statsErr = extractBackendError(stats);
        if (statsErr) return toolErrorResult(statsErr);
        result = {
          ...getLimitsOverviewQuery({
            stats,
            thirdPartyOnly: Boolean(queryArgs.thirdPartyOnly),
            provider: queryArgs.provider,
            status: queryArgs.status,
            maxProviders: queryArgs.maxProviders
          }),
          ...(queryArgs.includeHistory ? { limitsHistory: { available: false, reason: 'unavailable', series: [] } } : {})
        };
      } else {
        return toolErrorResult('get_limits_history backend is not configured.');
      }
      const backendErr = extractBackendError(result);
      if (backendErr) return toolErrorResult(backendErr);
      return jsonToolResult(result);
    }

    if (name === 'get_subscriptions_and_forecasts') {
      const queryArgs = {
        ...(args.date !== undefined ? { date: String(args.date) } : {}),
        ...(args.includeForecasts !== undefined ? { includeForecasts: Boolean(args.includeForecasts) } : {}),
        ...(args.activeOnly !== undefined ? { activeOnly: Boolean(args.activeOnly) } : {})
      };
      let result;
      if (typeof getSubscriptionsAndForecastsFn === 'function') {
        result = await getSubscriptionsAndForecastsFn(queryArgs);
      } else if (typeof getStats === 'function') {
        const stats = await getStats();
        const statsErr = extractBackendError(stats);
        if (statsErr) return toolErrorResult(statsErr);
        const subscriptionsDoc = typeof getSubscriptions === 'function' ? await getSubscriptions() : stats?.subscriptions;
        result = getSubscriptionsAndForecastsQuery({ subscriptionsDoc, stats, ...queryArgs });
      } else {
        return toolErrorResult('get_subscriptions_and_forecasts backend is not configured.');
      }
      const backendErr = extractBackendError(result);
      if (backendErr) return toolErrorResult(backendErr);
      return jsonToolResult(result);
    }

    if (name === 'get_live_token_rate') {
      const queryArgs = {
        ...(args.deviceId !== undefined ? { deviceId: String(args.deviceId) } : {})
      };
      let result;
      if (typeof getLiveTokenRateFn === 'function') {
        result = await getLiveTokenRateFn(queryArgs);
      } else if (typeof getStats === 'function') {
        const stats = await getStats();
        const statsErr = extractBackendError(stats);
        if (statsErr) return toolErrorResult(statsErr);
        result = getLiveTokenRateSummary({ stats, ...queryArgs });
      } else {
        return toolErrorResult('get_live_token_rate backend is not configured.');
      }
      const backendErr = extractBackendError(result);
      if (backendErr) return toolErrorResult(backendErr);
      return jsonToolResult(result);
    }

    if (name === 'get_service_status_and_approvals') {
      if (args.providerIds !== undefined && !Array.isArray(args.providerIds)) {
        return toolErrorResult('providerIds must be an array of provider IDs.');
      }
      const queryArgs = {
        ...(args.force !== undefined ? { force: Boolean(args.force) } : {}),
        ...(Array.isArray(args.providerIds) ? { providerIds: args.providerIds.map((/** @type {any} */ p) => String(p)) } : {}),
        includeResetForecast: args.includeResetForecast !== false,
        includeApprovals: args.includeApprovals !== false
      };
      let result;
      if (typeof getServiceStatusAndApprovalsFn === 'function') {
        result = await getServiceStatusAndApprovalsFn(queryArgs);
      } else {
        const rawAlerts = queryArgs.includeApprovals && typeof listApprovalAlerts === 'function'
          ? await listApprovalAlerts()
          : null;
        result = {
          ok: true,
          checkedAt: new Date().toISOString(),
          serviceStatus: { available: false, reason: 'unavailable', providers: [] },
          ...(queryArgs.includeResetForecast ? { codexResetForecast: { available: false, reason: 'unavailable' } } : {}),
          ...(queryArgs.includeApprovals
            ? {
                approvalAlerts: rawAlerts && rawAlerts.ok
                  ? { available: true, enabled: true, alerts: rawAlerts.alerts || [] }
                  : { available: false, enabled: false, alerts: [] }
              }
            : {})
        };
      }
      const backendErr = extractBackendError(result);
      if (backendErr) return toolErrorResult(backendErr);
      return jsonToolResult(result);
    }

    if (name === 'push_to_openclaw') {
      const resolvedType = args.test === true
        ? 'test'
        : (args.type !== undefined ? String(args.type).trim().toLowerCase().replace(/-/g, '_') : 'usage');
      if (!PUSH_TO_OPENCLAW_TYPES.includes(resolvedType)) {
        return toolErrorResult(`Unsupported push type "${String(args.type)}".`);
      }
      if (args.params !== undefined && (typeof args.params !== 'object' || args.params === null || Array.isArray(args.params))) {
        return toolErrorResult('params must be an object.');
      }
      let result;
      if (typeof pushEventToOpenClaw === 'function') {
        result = await pushEventToOpenClaw({
          type: resolvedType,
          test: args.test === true,
          params: args.params || {},
          ...(args.includeAi !== undefined ? { includeAi: Boolean(args.includeAi) } : {}),
          ...(args.customMessage !== undefined ? { customMessage: String(args.customMessage) } : {}),
          ...(args.idempotencyKey !== undefined ? { idempotencyKey: String(args.idempotencyKey) } : {})
        });
      } else if (resolvedType === 'report' && typeof pushToOpenClaw === 'function') {
        const p = args.params || {};
        result = await pushToOpenClaw({
          granularity: p.granularity !== undefined ? String(p.granularity) : 'daily',
          periodKey: p.periodKey !== undefined ? String(p.periodKey) : 'latest',
          ...(args.includeAi !== undefined ? { includeAi: Boolean(args.includeAi) } : {}),
          ...(p.includeLimits !== undefined ? { includeLimits: Boolean(p.includeLimits) } : {}),
          ...(p.question !== undefined ? { question: String(p.question) } : {})
        });
      } else {
        return toolErrorResult('push_to_openclaw backend is not configured.');
      }
      const backendErr = extractBackendError(result);
      if (backendErr) return toolErrorResult(backendErr);
      return jsonToolResult(result);
    }

    return null;
  }

  /**
   * @param {any} message
   * @returns {Promise<JsonRpcResponse | null>}
   */
  async function handleMessage(message) {
    if (
      !message
      || typeof message !== 'object'
      || Array.isArray(message)
      || message.jsonrpc !== '2.0'
      || typeof message.method !== 'string'
      || !message.method
    ) {
      return jsonRpcErr(fallbackId(message), JSON_RPC_ERRORS.INVALID_REQUEST, 'Invalid Request');
    }

    const hasId = Object.prototype.hasOwnProperty.call(message, 'id') && message.id !== undefined;
    if (hasId && !isValidJsonRpcId(message.id)) {
      return jsonRpcErr(null, JSON_RPC_ERRORS.INVALID_REQUEST, 'Invalid Request');
    }

    // Notifications (requests without id) must never produce a response.
    if (!hasId) {
      return null;
    }

    /** @type {JsonRpcId} */
    const id = message.id;
    const method = message.method;
    const params = message.params;

    if (params !== undefined && (typeof params !== 'object' || params === null || Array.isArray(params))) {
      return jsonRpcErr(id, JSON_RPC_ERRORS.INVALID_PARAMS, 'Invalid params: expected object');
    }

    try {
      if (method === 'initialize') {
        const clientVersion = typeof params?.protocolVersion === 'string' ? params.protocolVersion : '';
        const protocolVersion = MCP_SUPPORTED_VERSIONS.includes(clientVersion)
          ? clientVersion
          : MCP_SUPPORTED_VERSIONS[0];
        return jsonRpcOk(id, {
          protocolVersion,
          capabilities: {
            tools: {},
            resources: {},
            prompts: {}
          },
          serverInfo: resolvedServerInfo
        });
      }

      if (method === 'ping') {
        return jsonRpcOk(id, {});
      }

      if (method === 'tools/list') {
        return jsonRpcOk(id, { tools: MCP_TOOLS });
      }

      if (method === 'tools/call') {
        const toolName = typeof params?.name === 'string' ? params.name.trim() : '';
        if (!toolName) {
          return jsonRpcErr(id, JSON_RPC_ERRORS.INVALID_PARAMS, 'Invalid params: missing tool name');
        }
        const toolDef = MCP_TOOLS.find((t) => t.name === toolName);
        if (!toolDef) {
          return jsonRpcErr(id, JSON_RPC_ERRORS.INVALID_PARAMS, `Unknown tool: ${toolName}`);
        }
        const rawArgs = params?.arguments;
        if (rawArgs !== undefined && (typeof rawArgs !== 'object' || rawArgs === null || Array.isArray(rawArgs))) {
          return jsonRpcErr(id, JSON_RPC_ERRORS.INVALID_PARAMS, 'Invalid params: arguments must be an object');
        }
        try {
          const result = await executeTool(toolName, rawArgs || {});
          return jsonRpcOk(id, result);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return jsonRpcOk(id, toolErrorResult(msg));
        }
      }

      if (method === 'resources/list') {
        return jsonRpcOk(id, { resources: MCP_STATIC_RESOURCES });
      }

      if (method === 'resources/templates/list') {
        return jsonRpcOk(id, { resourceTemplates: MCP_RESOURCE_TEMPLATES });
      }

      if (method === 'resources/read') {
        const uri = typeof params?.uri === 'string' ? params.uri.trim() : '';
        if (!uri) {
          return jsonRpcErr(id, JSON_RPC_ERRORS.INVALID_PARAMS, 'Invalid params: missing resource uri');
        }

        if (uri === 'usage://today' || uri === 'sessions://active' || uri === 'limits://current'
          || uri === 'devices://health' || uri === 'subscriptions://summary' || uri === 'service-status://current') {
          let payload;
          if (uri === 'usage://today') {
            if (typeof queryUsageBreakdownFn === 'function') {
              payload = await queryUsageBreakdownFn({ period: 'today', groupBy: 'summary' });
            } else if (typeof getStats === 'function') {
              const stats = await getStats();
              const statsErr = extractBackendError(stats);
              if (statsErr) return jsonRpcErr(id, JSON_RPC_ERRORS.INTERNAL_ERROR, statsErr);
              const history = typeof getHistory === 'function' ? await getHistory() : stats?.history;
              payload = queryUsageBreakdown({ stats, history, period: 'today', groupBy: 'summary' });
            } else {
              return jsonRpcErr(id, JSON_RPC_ERRORS.INTERNAL_ERROR, 'Resource backend queryUsageBreakdown is not configured');
            }
          } else if (uri === 'sessions://active') {
            if (typeof listSessionsFn === 'function') {
              payload = await listSessionsFn({ period: 'today', state: 'all', limit: 30 });
            } else if (typeof getStats === 'function') {
              const stats = await getStats();
              const statsErr = extractBackendError(stats);
              if (statsErr) return jsonRpcErr(id, JSON_RPC_ERRORS.INTERNAL_ERROR, statsErr);
              payload = listSessionsQuery({
                stats,
                period: 'today',
                state: 'all',
                limit: 30,
                sessionTitlesEnabled: sessionTitlesEnabled === true
              });
            } else {
              return jsonRpcErr(id, JSON_RPC_ERRORS.INTERNAL_ERROR, 'Resource backend listSessions is not configured');
            }
          } else if (uri === 'limits://current') {
            if (typeof getLimitsHistoryFn === 'function') {
              payload = await getLimitsHistoryFn({ includeHistory: false });
            } else if (typeof getStats === 'function') {
              const stats = await getStats();
              const statsErr = extractBackendError(stats);
              if (statsErr) return jsonRpcErr(id, JSON_RPC_ERRORS.INTERNAL_ERROR, statsErr);
              payload = getLimitsOverviewQuery({ stats });
            } else {
              return jsonRpcErr(id, JSON_RPC_ERRORS.INTERNAL_ERROR, 'Resource backend getLimitsHistory is not configured');
            }
          } else if (uri === 'devices://health') {
            if (typeof getDevicesAndHealthFn === 'function') {
              payload = await getDevicesAndHealthFn({ includeDiagnostics: true });
            } else if (typeof getStats === 'function') {
              const stats = await getStats();
              const statsErr = extractBackendError(stats);
              if (statsErr) return jsonRpcErr(id, JSON_RPC_ERRORS.INTERNAL_ERROR, statsErr);
              payload = getDevicesAndHealthQuery({ stats, includeDiagnostics: true });
            } else {
              return jsonRpcErr(id, JSON_RPC_ERRORS.INTERNAL_ERROR, 'Resource backend getDevicesAndHealth is not configured');
            }
          } else if (uri === 'subscriptions://summary') {
            if (typeof getSubscriptionsAndForecastsFn === 'function') {
              payload = await getSubscriptionsAndForecastsFn({ includeForecasts: true });
            } else if (typeof getStats === 'function') {
              const stats = await getStats();
              const statsErr = extractBackendError(stats);
              if (statsErr) return jsonRpcErr(id, JSON_RPC_ERRORS.INTERNAL_ERROR, statsErr);
              const subscriptionsDoc = typeof getSubscriptions === 'function' ? await getSubscriptions() : stats?.subscriptions;
              payload = getSubscriptionsAndForecastsQuery({ subscriptionsDoc, stats, includeForecasts: true });
            } else {
              return jsonRpcErr(id, JSON_RPC_ERRORS.INTERNAL_ERROR, 'Resource backend getSubscriptionsAndForecasts is not configured');
            }
          } else {
            if (typeof getServiceStatusAndApprovalsFn === 'function') {
              payload = await getServiceStatusAndApprovalsFn({ includeResetForecast: true, includeApprovals: true });
            } else {
              const rawAlerts = typeof listApprovalAlerts === 'function' ? await listApprovalAlerts() : null;
              payload = {
                ok: true,
                checkedAt: new Date().toISOString(),
                serviceStatus: { available: false, reason: 'unavailable', providers: [] },
                codexResetForecast: { available: false, reason: 'unavailable' },
                approvalAlerts: rawAlerts && rawAlerts.ok
                  ? { available: true, enabled: true, alerts: rawAlerts.alerts || [] }
                  : { available: false, enabled: false, alerts: [] }
              };
            }
          }
          const backendErr = extractBackendError(payload);
          if (backendErr) {
            return jsonRpcErr(id, JSON_RPC_ERRORS.INTERNAL_ERROR, backendErr);
          }
          return jsonRpcOk(id, {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(payload, null, 2)
              }
            ]
          });
        }

        const target = parseReportUri(uri);
        if (!target) {
          return jsonRpcErr(id, JSON_RPC_ERRORS.INVALID_PARAMS, `Invalid report resource URI: ${uri}`);
        }
        if (typeof getReport !== 'function') {
          return jsonRpcErr(id, JSON_RPC_ERRORS.INTERNAL_ERROR, 'Resource backend getReport is not configured');
        }
        const fetched = await getReport({
          granularity: target.granularity,
          periodKey: target.periodKey,
          format: target.format
        });
        const backendErr = extractBackendError(fetched);
        if (backendErr || !fetched) {
          return jsonRpcErr(id, JSON_RPC_ERRORS.INVALID_PARAMS, backendErr || `Resource not found: ${uri}`);
        }
        let text;
        if (target.format === 'markdown') {
          if (typeof fetched === 'string') text = fetched;
          else if (typeof fetched.markdown === 'string') text = fetched.markdown;
          else {
            const reportObj = unwrapReportObject(fetched);
            text = reportObj ? renderReportMarkdown(reportObj) : JSON.stringify(fetched, null, 2);
          }
        } else {
          const reportObj = unwrapReportObject(fetched) || fetched;
          text = typeof reportObj === 'string' ? reportObj : JSON.stringify(reportObj, null, 2);
        }
        return jsonRpcOk(id, {
          contents: [
            {
              uri,
              mimeType: target.format === 'markdown' ? 'text/markdown' : 'application/json',
              text
            }
          ]
        });
      }

      if (method === 'prompts/list') {
        return jsonRpcOk(id, { prompts: MCP_PROMPTS });
      }

      if (method === 'prompts/get') {
        const promptName = typeof params?.name === 'string' ? params.name.trim() : '';
        if (!promptName) {
          return jsonRpcErr(id, JSON_RPC_ERRORS.INVALID_PARAMS, 'Invalid params: missing prompt name');
        }
        const promptDef = MCP_PROMPTS.find((p) => p.name === promptName);
        if (!promptDef) {
          return jsonRpcErr(id, JSON_RPC_ERRORS.INVALID_PARAMS, `Unknown prompt: ${promptName}`);
        }
        const rawArgs = params?.arguments;
        if (rawArgs !== undefined && (typeof rawArgs !== 'object' || rawArgs === null || Array.isArray(rawArgs))) {
          return jsonRpcErr(id, JSON_RPC_ERRORS.INVALID_PARAMS, 'Invalid params: prompt arguments must be an object');
        }
        const args = rawArgs || {};
        for (const [argKey, argVal] of Object.entries(args)) {
          if (typeof argVal === 'string' && argVal.length > MAX_PROMPT_ARG_LENGTH) {
            return jsonRpcErr(
              id,
              JSON_RPC_ERRORS.INVALID_PARAMS,
              `Invalid params: prompt argument "${argKey}" exceeds maximum length of ${MAX_PROMPT_ARG_LENGTH} characters`
            );
          }
        }

        if (promptName === 'project-deep-dive') {
          const project = typeof args.project === 'string' ? args.project.trim() : '';
          if (!project) {
            return jsonRpcErr(id, JSON_RPC_ERRORS.INVALID_PARAMS, 'Missing required prompt argument: project');
          }
          const granularity = typeof args.granularity === 'string' && REPORT_GRANULARITIES.includes(args.granularity)
            ? args.granularity
            : 'weekly';
          const periodKey = typeof args.periodKey === 'string' && args.periodKey.trim()
            ? args.periodKey.trim()
            : 'latest';
          return jsonRpcOk(id, {
            description: promptDef.description,
            messages: [
              {
                role: 'user',
                content: {
                  type: 'text',
                  text: `Analyze Token Monitor usage for project "${project}" during ${granularity} period "${periodKey}". Call analyze_project_usage with { granularity: "${granularity}", periodKey: "${periodKey}", project: "${project}" } and inspect report://${granularity}/${periodKey} to summarize token share, known cost, unpriced tokens, dominant clients and models, cache efficiency, and automated signals.`
                }
              }
            ]
          });
        }

        if (promptName === 'wechat-digest') {
          const granularity = typeof args.granularity === 'string' && REPORT_GRANULARITIES.includes(args.granularity)
            ? args.granularity
            : 'daily';
          const periodKey = typeof args.periodKey === 'string' && args.periodKey.trim()
            ? args.periodKey.trim()
            : 'latest';
          return jsonRpcOk(id, {
            description: promptDef.description,
            messages: [
              {
                role: 'user',
                content: {
                  type: 'text',
                  text: `Prepare a concise Chinese WeChat-ready digest for Token Monitor (${granularity} period "${periodKey}"). Call get_usage_report({ granularity: "${granularity}", periodKey: "${periodKey}" }) and get_realtime_usage_and_limits({}). Summarize today/period tokens, known cost, top projects, cache hit rate, and third-party API / subscription quota balances using short bullet points (avoid wide markdown tables so it renders cleanly in WeChat).`
                }
              }
            ]
          });
        }

        if (promptName === 'session-summary') {
          const sessionId = typeof args.sessionId === 'string' ? args.sessionId.trim() : '';
          const client = typeof args.client === 'string' ? args.client.trim() : '';
          const rawPeriod = typeof args.period === 'string' ? args.period.trim() : 'today';
          const period = SESSION_PERIODS.includes(rawPeriod) ? rawPeriod : 'today';
          const text = sessionId && client
            ? `Summarize Token Monitor session "${sessionId}" (${client}, period "${period}"). Call list_sessions({ period: "${period}", client: "${client}" }) and (if queryPermissions.allowSessionDetail is enabled) get_session_detail({ client: "${client}", sessionId: "${sessionId}", period: "${period}" }). Highlight active state, model, total/turn tokens, known cost, cache hit rate, context remaining, and recent tools without leaking disabled titles or private transcript text.`
            : `Summarize active and recent coding sessions for Token Monitor (${client ? `client "${client}", ` : ''}period "${period}"). Call list_sessions({ period: "${period}"${client ? `, client: "${client}"` : ''}, state: "all", limit: 20 }) or read sessions://active. Highlight running/waiting sessions, top token/cost sessions, context window pressure, and cache hit efficiency using concise bullets.`;
          return jsonRpcOk(id, {
            description: promptDef.description,
            messages: [
              {
                role: 'user',
                content: { type: 'text', text }
              }
            ]
          });
        }

        if (promptName === 'quota-check') {
          const provider = typeof args.provider === 'string' ? args.provider.trim() : '';
          const includeHistory = args.includeHistory === true || String(args.includeHistory || '').toLowerCase() === 'true';
          return jsonRpcOk(id, {
            description: promptDef.description,
            messages: [
              {
                role: 'user',
                content: {
                  type: 'text',
                  text: `Check Token Monitor provider and third-party API quotas${provider ? ` for "${provider}"` : ''}. Call get_limits_history({${provider ? ` provider: "${provider}",` : ''} includeHistory: ${includeHistory} }), get_subscriptions_and_forecasts({ includeForecasts: true }), and get_service_status_and_approvals({}). Summarize remaining percentage, reset countdowns, top-up exhaustion dates, and any degraded AI provider services or pending approval alerts.`
                }
              }
            ]
          });
        }

        if (promptName === 'daily-standup-usage') {
          const date = typeof args.date === 'string' ? args.date.trim() : '';
          return jsonRpcOk(id, {
            description: promptDef.description,
            messages: [
              {
                role: 'user',
                content: {
                  type: 'text',
                  text: `Prepare a concise daily engineering standup update from Token Monitor${date ? ` anchored on ${date}` : ''}. Call query_usage_breakdown({ period: "today", groupBy: "project" }), query_usage_breakdown({ period: "today", groupBy: "model" }), get_usage_history({ resolution: "daily", limit: 7 }), list_sessions({ period: "today", state: "all", limit: 15 }), get_live_token_rate({}), and get_limits_history({ includeHistory: false }). Present key metrics, top projects, active work, streaks, and quota headroom in short WeChat/Slack-friendly bullet points.`
                }
              }
            ]
          });
        }

        const granularity = promptName === 'analyze-daily-report'
          ? 'daily'
          : promptName === 'analyze-weekly-report'
            ? 'weekly'
            : 'monthly';
        const periodKey = typeof args.periodKey === 'string' && args.periodKey.trim()
          ? args.periodKey.trim()
          : 'latest';

        return jsonRpcOk(id, {
          description: promptDef.description,
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `Review the ${granularity} Token Monitor usage report for "${periodKey}" (resource report://${granularity}/${periodKey} or tool get_usage_report). Summarize total tokens, known cost, unpriced tokens, top projects, client/model cache hit rate and throughput, multi-device distribution, period-over-period changes, and any triggered signals.`
              }
            }
          ]
        });
      }

      return jsonRpcErr(id, JSON_RPC_ERRORS.METHOD_NOT_FOUND, `Method not found: ${method}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return jsonRpcErr(id, JSON_RPC_ERRORS.INTERNAL_ERROR, msg || 'Internal error');
    }
  }

  /**
   * @param {any} payload
   * @returns {Promise<JsonRpcResponse | JsonRpcResponse[] | null>}
   */
  async function handlePayload(payload) {
    let parsed = payload;
    if (typeof payload === 'string' || payload instanceof Uint8Array) {
      try {
        const rawText = typeof payload === 'string'
          ? payload
          : new TextDecoder().decode(payload);
        parsed = JSON.parse(rawText);
      } catch {
        return jsonRpcErr(null, JSON_RPC_ERRORS.PARSE_ERROR, 'Parse error');
      }
    }
    if (Array.isArray(parsed)) {
      if (parsed.length === 0) {
        return jsonRpcErr(null, JSON_RPC_ERRORS.INVALID_REQUEST, 'Invalid Request');
      }
      if (parsed.length > MAX_BATCH_SIZE) {
        return jsonRpcErr(
          null,
          JSON_RPC_ERRORS.INVALID_REQUEST,
          `Invalid Request: batch size exceeds maximum of ${MAX_BATCH_SIZE}`
        );
      }
      /** @type {Array<JsonRpcResponse | null>} */
      const results = new Array(parsed.length);
      let cursor = 0;
      const workerCount = Math.min(MAX_BATCH_CONCURRENCY, parsed.length);
      const workers = Array.from({ length: workerCount }, async () => {
        while (cursor < parsed.length) {
          const idx = cursor;
          cursor += 1;
          results[idx] = await handleMessage(parsed[idx]);
        }
      });
      await Promise.all(workers);
      const responses = results.filter(/** @returns {r is JsonRpcResponse} */ (r) => r !== null);
      return responses.length > 0 ? responses : null;
    }
    return handleMessage(parsed);
  }

  return {
    handleMessage,
    handlePayload
  };
}

/**
 * Strip session title fields from a session-detail payload when title sharing is disabled.
 * @param {any} detail
 * @returns {any}
 */
function stripSessionDetailTitles(detail) {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return detail;
  const copy = { ...detail };
  delete copy.title;
  delete copy.sessionTitle;
  delete copy.rawTitle;
  if (typeof copy.label === 'string') {
    copy.label = copy.projectLabel || copy.sessionId || '';
  }
  return copy;
}

/**
 * Strip account email PII from a limits-history payload object and any nested history items.
 * @param {any} rawHistory
 * @returns {any}
 */
function sanitizeLimitsHistoryPayload(rawHistory) {
  if (Array.isArray(rawHistory)) {
    return rawHistory.map((item) => sanitizeLimitsHistoryPayload(item));
  }
  if (!rawHistory || typeof rawHistory !== 'object') return rawHistory;
  const copy = { ...rawHistory };
  delete copy.accountEmail;
  delete copy.email;
  if (typeof copy.account === 'string' && copy.account.includes('@')) {
    delete copy.account;
  }
  for (const key of ['series', 'snapshots', 'entries', 'history']) {
    if (Array.isArray(copy[key])) {
      copy[key] = copy[key].map((item) => sanitizeLimitsHistoryPayload(item));
    }
  }
  return copy;
}

module.exports = {
  MCP_PROMPTS,
  MCP_RESOURCE_TEMPLATES,
  MCP_STATIC_RESOURCES,
  MCP_SUPPORTED_VERSIONS,
  MCP_TOOLS,
  JSON_RPC_ERRORS,
  createMcpReportServer,
  sanitizeLimitsHistoryPayload,
  stripSessionDetailTitles
};
