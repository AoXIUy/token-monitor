'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { sharedDataDir } = require('./config');
const { timingSafeEqualText } = require('./http');
const {
  MAX_APPROVAL_IPC_BYTES,
  approvalAlertInput
} = require('./approvalProtocol');

const MAX_ACTIVE_IPC_SOCKETS = 16;

function bridgeEndpoint(dataDir, platform = process.platform) {
  if (platform === 'win32') {
    const hash = crypto.createHash('sha256').update(String(dataDir), 'utf8').digest('hex').slice(0, 16);
    return `\\\\.\\pipe\\token-monitor-approval-${hash}`;
  }
  return path.join(dataDir, 'approval.sock');
}

function bridgeMetadataPath(dataDir) {
  return path.join(dataDir, 'approval-bridge.json');
}

function encodeFrame(payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const frame = Buffer.allocUnsafe(4 + body.byteLength);
  frame.writeUInt32BE(body.byteLength, 0);
  body.copy(frame, 4);
  return frame;
}

function writePrivateJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  try { fs.chmodSync(tempPath, 0o600); } catch (_) {}
  fs.renameSync(tempPath, filePath);
}

function probeUnixSocket(socketPath, timeoutMs = 250) {
  return new Promise((resolve) => {
    const client = net.createConnection(socketPath);
    let done = false;
    const finish = (active) => {
      if (done) return;
      done = true;
      client.destroy();
      resolve(active);
    };
    const timer = setTimeout(() => finish(true), timeoutMs);
    client.once('connect', () => { clearTimeout(timer); finish(true); });
    client.once('error', () => { clearTimeout(timer); finish(false); });
  });
}

function createApprovalBridge({
  dataDir = sharedDataDir(),
  platform = process.platform,
  onAlert,
  maxActive = MAX_ACTIVE_IPC_SOCKETS
} = {}) {
  const endpoint = bridgeEndpoint(dataDir, platform);
  const metadataPath = bridgeMetadataPath(dataDir);
  const token = crypto.randomBytes(32).toString('hex');
  const activeSockets = new Set();
  let server = null;
  let owned = false;
  let stopped = false;

  function sendAndClose(socket, payload) {
    if (socket.destroyed || socket.writableEnded) return;
    try {
      socket.end(encodeFrame(payload));
    } catch (_) {
      socket.destroy();
    }
  }

  function handleConnection(socket) {
    if (stopped || activeSockets.size >= maxActive) {
      socket.destroy();
      return;
    }
    activeSockets.add(socket);
    const cleanupSocket = () => activeSockets.delete(socket);
    socket.once('close', cleanupSocket);
    socket.once('error', cleanupSocket);

    let buffer = Buffer.alloc(0);
    let expectedLength = null;
    let handling = false;

    const readTimeout = setTimeout(() => {
      if (!handling) socket.destroy();
    }, 2000);

    const onData = (chunk) => {
      if (handling) return;
      buffer = Buffer.concat([buffer, chunk]);
      if (expectedLength === null && buffer.byteLength >= 4) {
        expectedLength = buffer.readUInt32BE(0);
        if (expectedLength === 0 || expectedLength > MAX_APPROVAL_IPC_BYTES) {
          clearTimeout(readTimeout);
          socket.destroy();
          return;
        }
      }
      if (expectedLength !== null && buffer.byteLength >= 4 + expectedLength) {
        clearTimeout(readTimeout);
        handling = true;
        socket.off('data', onData);
        const body = buffer.subarray(4, 4 + expectedLength).toString('utf8');
        buffer = Buffer.alloc(0);
        processPayload(body);
      } else if (buffer.byteLength > 4 + MAX_APPROVAL_IPC_BYTES) {
        clearTimeout(readTimeout);
        socket.destroy();
      }
    };

    function processPayload(raw) {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch (_) {
        return sendAndClose(socket, { ok: false, reason: 'invalid_json' });
      }
      if (!msg || typeof msg.token !== 'string' || !timingSafeEqualText(msg.token, token)) {
        return sendAndClose(socket, { ok: false, reason: 'unauthorized' });
      }
      let normalized;
      try {
        normalized = approvalAlertInput({
          deviceId: 'local',
          client: msg.client,
          sessionId: msg.sessionId,
          tool: msg.tool,
          command: msg.command,
          description: msg.description,
          projectLabel: msg.projectLabel
        });
      } catch (_) {
        return sendAndClose(socket, { ok: false, reason: 'invalid_request' });
      }

      // Enqueue fire-and-forget alert delivery before acking so the desktop prompt never blocks.
      try {
        if (typeof onAlert === 'function') {
          void Promise.resolve(onAlert({
            client: normalized.client,
            sessionId: normalized.sessionId,
            tool: normalized.tool,
            command: normalized.command,
            description: normalized.description,
            projectLabel: normalized.projectLabel
          })).catch(() => {});
        }
      } catch (_) {}
      sendAndClose(socket, { ok: true });
    }

    socket.on('data', onData);
  }

  async function start() {
    if (stopped) return { started: false, reason: 'stopped' };
    if (server && owned) return { started: true, endpoint };
    fs.mkdirSync(dataDir, { recursive: true });
    if (platform !== 'win32' && fs.existsSync(endpoint)) {
      const active = await probeUnixSocket(endpoint);
      if (active) return { started: false, reason: 'already_owned' };
      try { fs.unlinkSync(endpoint); } catch (err) {
        if (err.code !== 'ENOENT') return { started: false, reason: err.code || 'unlink_failed' };
      }
    }
    const nextServer = net.createServer(handleConnection);
    return new Promise((resolve) => {
      const onError = (err) => {
        nextServer.close();
        resolve({ started: false, reason: err.code || 'listen_failed' });
      };
      nextServer.once('error', onError);
      nextServer.listen(endpoint, () => {
        nextServer.off('error', onError);
        if (stopped) {
          nextServer.close();
          if (platform !== 'win32') {
            try { fs.unlinkSync(endpoint); } catch (_) {}
          }
          return resolve({ started: false, reason: 'stopped' });
        }
        server = nextServer;
        owned = true;
        if (platform !== 'win32') {
          try { fs.chmodSync(endpoint, 0o600); } catch (_) {}
        }
        writePrivateJsonAtomic(metadataPath, { endpoint, token, pid: process.pid });
        resolve({ started: true, endpoint });
      });
    });
  }

  function stop() {
    if (stopped) return Promise.resolve();
    stopped = true;
    for (const socket of activeSockets) {
      sendAndClose(socket, { ok: false, reason: 'stopped' });
    }
    if (owned) {
      try {
        const current = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
        if (current?.token === token) fs.unlinkSync(metadataPath);
      } catch (_) {}
      if (platform !== 'win32') {
        try { fs.unlinkSync(endpoint); } catch (_) {}
      }
      owned = false;
    }
    if (!server) return Promise.resolve();
    const closing = server;
    server = null;
    return new Promise((resolve) => {
      closing.close(() => resolve());
    });
  }

  return { endpoint, metadataPath, start, stop, isOwned: () => owned };
}

module.exports = {
  bridgeEndpoint,
  bridgeMetadataPath,
  createApprovalBridge,
  encodeFrame
};
