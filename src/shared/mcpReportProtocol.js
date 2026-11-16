// @ts-check
'use strict';

const {
  REPORT_GRANULARITIES,
  REPORT_SCHEMA,
  analyzeProjectUsage,
  renderReportMarkdown
} = require('./usageReport');

const MCP_SUPPORTED_VERSIONS = Object.freeze(['2025-06-18', '2025-03-26', '2024-11-05']);

const JSON_RPC_ERRORS = Object.freeze({
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603
});

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
  if (result.ok === false) return String(result.error || result.message || 'Operation failed');
  if (typeof result.error === 'string' && result.error) return result.error;
  return null;
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
  const host = decodeURIComponent(parsed.hostname || '');
  const segments = parsed.pathname
    .split('/')
    .filter(Boolean)
    .map((part) => decodeURIComponent(part));
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
 * Create a zero-dependency MCP JSON-RPC 2.0 report server.
 * @param {object} options
 * @param {(args: { granularity?: string, limit?: number }) => Promise<any> | any} [options.listReports]
 * @param {(args: { granularity: string, periodKey?: string, format?: string }) => Promise<any> | any} [options.getReport]
 * @param {(args: { granularity?: string, periodKey?: string, force?: boolean }) => Promise<any> | any} [options.generateReport]
 * @param {(args: { granularity?: string, periodKey?: string, project?: string, limit?: number }) => Promise<any> | any} [options.analyzeProjects]
 * @param {{ name?: string, version?: string }} [options.serverInfo]
 * @returns {{ handleMessage: (message: any) => Promise<JsonRpcResponse | null>, handlePayload: (payload: any) => Promise<JsonRpcResponse | JsonRpcResponse[] | null> }}
 */
function createMcpReportServer({
  listReports,
  getReport,
  generateReport,
  analyzeProjects,
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
      const result = await listReports({
        ...(args.granularity !== undefined ? { granularity: String(args.granularity) } : {}),
        ...(args.limit !== undefined ? { limit: args.limit } : {})
      });
      const backendErr = extractBackendError(result);
      if (backendErr) return toolErrorResult(backendErr);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        ...(result && typeof result === 'object' && !Array.isArray(result) ? { structuredContent: result } : {})
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
      return {
        content: [{
          type: 'text',
          text: typeof reportObj === 'string' ? reportObj : JSON.stringify(reportObj, null, 2)
        }],
        ...(reportObj && typeof reportObj === 'object' && !Array.isArray(reportObj)
          ? { structuredContent: reportObj }
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
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        ...(result && typeof result === 'object' && !Array.isArray(result) ? { structuredContent: result } : {})
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
      const limit = args.limit;

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
      const results = await Promise.all(parsed.map((item) => handleMessage(item)));
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

module.exports = {
  MCP_SUPPORTED_VERSIONS,
  JSON_RPC_ERRORS,
  createMcpReportServer
};
