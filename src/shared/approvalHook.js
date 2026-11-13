'use strict';

// Standalone script copied to <sharedDataDir>/bin/approval-hook.js; keep free of relative requires.
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const MAX_STDIN_BYTES = 1024 * 1024;
const MAX_IPC_BYTES = 64 * 1024;
const CONNECT_TIMEOUT_MS = 300;
const ACK_TIMEOUT_MS = 500;

function resolveSharedDataDir(env = process.env, platform = process.platform, homeDir = os.homedir()) {
  if (env.TOKEN_MONITOR_SHARED_DIR) return env.TOKEN_MONITOR_SHARED_DIR;
  const productName = 'Token Monitor';
  if (platform === 'darwin') return path.join(homeDir, 'Library', 'Application Support', productName);
  if (platform === 'win32') return path.join(env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'), productName);
  return path.join(env.XDG_CONFIG_HOME || path.join(homeDir, '.config'), productName);
}

function folderLabel(rawPath) {
  if (typeof rawPath !== 'string') return '';
  const trimmed = rawPath.trim().replace(/[\\/]+$/, '');
  if (!trimmed) return '';
  const winIdx = trimmed.lastIndexOf('\\');
  const posixIdx = trimmed.lastIndexOf('/');
  const idx = Math.max(winIdx, posixIdx);
  return idx >= 0 ? (trimmed.slice(idx + 1) || trimmed) : trimmed;
}

function cleanLine(value, max) {
  if (typeof value !== 'string') return '';
  const cleaned = value.replace(/[\x00-\x1f\x7f]+/g, ' ').trim();
  const chars = Array.from(cleaned);
  return chars.length <= max ? cleaned : chars.slice(0, max).join('');
}

function cleanMulti(value, max) {
  if (typeof value !== 'string') return '';
  const normalized = value.replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
  const chars = Array.from(normalized);
  return chars.length <= max ? normalized : chars.slice(0, max).join('');
}

function parseCliArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const body = token.slice(2);
    const eq = body.indexOf('=');
    if (eq !== -1) {
      out[body.slice(0, eq)] = body.slice(eq + 1);
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      out[body] = argv[i + 1];
      i += 1;
    } else {
      out[body] = 'true';
    }
  }
  return out;
}

function formatHookFallbackOutput(client) {
  if (client === 'antigravity') {
    return JSON.stringify({ decision: 'ask' });
  }
  return '';
}

function extractRequest(client, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  if (client === 'codex') {
    const tool = cleanLine(typeof payload.tool_name === 'string' ? payload.tool_name : '', 128) || 'Bash';
    const sessionId = cleanLine(
      typeof payload.session_id === 'string' ? payload.session_id
        : (typeof payload.turn_id === 'string' ? payload.turn_id : ''),
      256
    ) || 'codex-session';
    const input = payload.tool_input && typeof payload.tool_input === 'object' ? payload.tool_input : null;
    let command = '';
    if (typeof input?.command === 'string') command = input.command;
    else if (input) command = JSON.stringify(input, null, 2);
    const description = typeof input?.description === 'string' ? input.description : '';
    const projectLabel = folderLabel(payload.cwd);
    return {
      client,
      sessionId,
      tool,
      command: cleanMulti(command, 4000),
      description: cleanLine(description, 500),
      projectLabel: cleanLine(projectLabel, 160)
    };
  }
  if (client === 'antigravity') {
    const toolCall = payload.toolCall && typeof payload.toolCall === 'object' ? payload.toolCall : null;
    const tool = cleanLine(typeof toolCall?.name === 'string' ? toolCall.name : '', 128) || 'run_command';
    const sessionId = cleanLine(typeof payload.conversationId === 'string' ? payload.conversationId : '', 256) || 'antigravity-session';
    const args = toolCall?.args && typeof toolCall.args === 'object' ? toolCall.args : null;
    let command = '';
    if (typeof args?.CommandLine === 'string') command = args.CommandLine;
    else if (typeof args?.command === 'string') command = args.command;
    else if (args) command = JSON.stringify(args, null, 2);
    const description = typeof args?.Description === 'string' ? args.Description : '';
    const workspace = Array.isArray(payload.workspacePaths) ? payload.workspacePaths[0] : '';
    const projectLabel = folderLabel(workspace) || folderLabel(args?.Cwd);
    return {
      client,
      sessionId,
      tool,
      command: cleanMulti(command, 4000),
      description: cleanLine(description, 500),
      projectLabel: cleanLine(projectLabel, 160)
    };
  }
  return null;
}

function readStdinBounded(stream = process.stdin, maxBytes = MAX_STDIN_BYTES) {
  return new Promise((resolve) => {
    const chunks = [];
    let bytes = 0;
    let done = false;
    const finish = (text) => {
      if (done) return;
      done = true;
      resolve(text);
    };
    stream.on('data', (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8');
      bytes += buf.byteLength;
      if (bytes > maxBytes) {
        stream.destroy();
        finish('');
        return;
      }
      chunks.push(buf);
    });
    stream.on('end', () => finish(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', () => finish(''));
  });
}

function sendAlertToBridge(endpoint, payload, { connectTimeoutMs = CONNECT_TIMEOUT_MS, ackTimeoutMs = ACK_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    const socket = net.createConnection(endpoint);
    let settled = false;
    let connected = false;
    let buffer = Buffer.alloc(0);
    let expectedLength = null;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimer);
      clearTimeout(ackTimer);
      socket.destroy();
      resolve(result);
    };

    const connectTimer = setTimeout(() => {
      if (!connected) finish({ ok: false, reason: 'connect_timeout' });
    }, connectTimeoutMs);

    const ackTimer = setTimeout(() => {
      finish({ ok: false, reason: 'ack_timeout' });
    }, ackTimeoutMs);

    socket.once('connect', () => {
      connected = true;
      clearTimeout(connectTimer);
      const body = Buffer.from(JSON.stringify(payload), 'utf8');
      const frame = Buffer.allocUnsafe(4 + body.byteLength);
      frame.writeUInt32BE(body.byteLength, 0);
      body.copy(frame, 4);
      socket.write(frame);
    });

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (expectedLength === null && buffer.byteLength >= 4) {
        expectedLength = buffer.readUInt32BE(0);
        if (expectedLength === 0 || expectedLength > MAX_IPC_BYTES) {
          finish({ ok: false, reason: 'invalid_frame' });
          return;
        }
      }
      if (expectedLength !== null && buffer.byteLength >= 4 + expectedLength) {
        const text = buffer.subarray(4, 4 + expectedLength).toString('utf8');
        try {
          finish(JSON.parse(text));
        } catch (_) {
          finish({ ok: false, reason: 'invalid_json' });
        }
      }
    });

    socket.once('error', () => finish({ ok: false, reason: 'socket_error' }));
    socket.once('close', () => finish({ ok: false, reason: 'socket_closed' }));
  });
}

async function runHook({ argv = process.argv.slice(2), env = process.env, stdin = process.stdin, stdout = process.stdout } = {}) {
  const args = parseCliArgs(argv);
  const client = args.client === 'codex' || args.client === 'antigravity' ? args.client : '';
  if (!client) return 0;

  const writeFallback = () => {
    const out = formatHookFallbackOutput(client);
    if (out) stdout.write(out);
    return 0;
  };

  const dataDir = args['data-dir'] || resolveSharedDataDir(env);
  const metadataPath = path.join(dataDir, 'approval-bridge.json');
  let metadata;
  try {
    metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  } catch (_) {
    return writeFallback();
  }
  if (!metadata || typeof metadata.endpoint !== 'string' || !metadata.endpoint || typeof metadata.token !== 'string' || !metadata.token) {
    return writeFallback();
  }

  const rawStdin = await readStdinBounded(stdin);
  if (!rawStdin.trim()) return writeFallback();
  let parsedStdin;
  try {
    parsedStdin = JSON.parse(rawStdin);
  } catch (_) {
    return writeFallback();
  }
  const req = extractRequest(client, parsedStdin);
  if (!req) return writeFallback();

  await sendAlertToBridge(metadata.endpoint, { token: metadata.token, ...req });
  return writeFallback();
}

if (require.main === module) {
  runHook().then((code) => {
    process.exitCode = code;
  }).catch(() => {
    process.exitCode = 0;
  });
}

module.exports = {
  extractRequest,
  formatHookFallbackOutput,
  resolveSharedDataDir,
  runHook,
  sendAlertToBridge
};
