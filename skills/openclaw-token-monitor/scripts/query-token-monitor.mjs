#!/usr/bin/env node
'use strict';

/**
 * Zero-dependency OpenClaw Skill helper for Token Monitor Main Hub.
 * Reads TOKEN_MONITOR_HUB_URL and TOKEN_MONITOR_SECRET from environment variables.
 */

const hubUrl = (process.env.TOKEN_MONITOR_HUB_URL || 'http://127.0.0.1:17321').replace(/\/+$/, '');
const secret = (process.env.TOKEN_MONITOR_SECRET || '').trim();

function parseCliArgs(argv) {
  const positionals = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const eq = token.indexOf('=');
    if (eq !== -1) {
      flags[token.slice(2, eq)] = token.slice(eq + 1);
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      flags[token.slice(2)] = argv[i + 1];
      i += 1;
    } else {
      flags[token.slice(2)] = true;
    }
  }
  return { command: positionals[0] || 'brief', flags };
}

async function callHub(method, pathWithQuery, body) {
  const headers = { accept: 'application/json' };
  if (secret) headers.authorization = `Bearer ${secret}`;
  if (body !== undefined) headers['content-type'] = 'application/json';

  const res = await fetch(`${hubUrl}${pathWithQuery}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(45_000)
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    const errMsg = typeof parsed === 'object' && parsed ? (parsed.message || parsed.error) : text;
    throw new Error(`Hub ${res.status}: ${errMsg || 'request failed'}`);
  }
  return parsed;
}

async function main() {
  const { command, flags } = parseCliArgs(process.argv.slice(2));
  const granularity = String(flags.granularity || 'daily');
  const periodKey = String(flags.period || flags['period-key'] || 'latest');

  if (command === 'brief') {
    const format = String(flags.format || 'text');
    const res = await callHub(
      'GET',
      `/api/integrations/openclaw/brief?granularity=${encodeURIComponent(granularity)}&periodKey=${encodeURIComponent(periodKey)}&format=${encodeURIComponent(format)}`
    );
    if (typeof res === 'string') {
      process.stdout.write(`${res}\n`);
    } else {
      process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
    }
    return;
  }

  if (command === 'realtime') {
    const res = await callHub('POST', '/api/mcp', {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'get_realtime_usage_and_limits',
        arguments: {
          thirdPartyOnly: Boolean(flags['third-party-only'])
        }
      }
    });
    const structured = res?.result?.structuredContent || res;
    process.stdout.write(`${JSON.stringify(structured, null, 2)}\n`);
    return;
  }

  if (command === 'report') {
    const format = String(flags.format || 'json');
    const res = await callHub(
      'GET',
      `/api/reports/${encodeURIComponent(granularity)}/${encodeURIComponent(periodKey)}?format=${encodeURIComponent(format)}`
    );
    process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
    return;
  }

  if (command === 'ai-analyze') {
    const res = await callHub('POST', '/api/reports/ai-analyze', {
      granularity,
      periodKey,
      ...(flags.question ? { question: String(flags.question) } : {}),
      ...(flags.language ? { language: String(flags.language) } : {}),
      ...(flags.refresh ? { refresh: true } : {})
    });
    if (res?.aiAnalysis?.summaryMarkdown && !flags.json) {
      process.stdout.write(`${res.aiAnalysis.summaryMarkdown}\n`);
    } else {
      process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
    }
    return;
  }

  if (command === 'push') {
    const res = await callHub('POST', '/api/reports/push', {
      target: 'openclaw',
      granularity,
      periodKey,
      ...(flags.refresh ? { refreshAi: true } : {}),
      ...(flags.question ? { question: String(flags.question) } : {})
    });
    process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
    return;
  }

  throw new Error(`Unknown command "${command}". Expected: brief, realtime, report, ai-analyze, push.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
