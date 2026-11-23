'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createHub } = require('../../src/hub/server');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tm-hub-sechard-'));
}

function rawHttp(port, payload) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port }, () => socket.write(payload));
    let out = '';
    socket.setEncoding('utf8');
    socket.setTimeout(3000, () => { socket.destroy(); resolve(out); });
    socket.on('data', (c) => { out += c; });
    socket.on('end', () => resolve(out));
    socket.on('error', reject);
  });
}

test('V-05 & V-14 & V-15 & V-17: empty secret fails closed 503 unless allowInsecureLocalNoAuth, blocks DNS rebinding Host, and hardens headers & /api/health', async () => {
  const dir = makeTempDir();
  const dataFile = path.join(dir, 'devices.json');
  const hub = createHub({ port: 0, host: '0.0.0.0', secret: '', dataFile, logger: { error() {}, warn() {} } });
  await hub.start();
  try {
    const { port } = hub.server.address();
    const base = `http://127.0.0.1:${port}`;
    assert.equal(hub.bindHost, '127.0.0.1');

    // Empty secret fails closed with 503 secret_required
    const statsRes = await fetch(`${base}/api/stats`);
    assert.equal(statsRes.status, 503);
    assert.equal((await statsRes.json()).error, 'secret_required');

    // Security headers present & no ACAO: *
    assert.equal(statsRes.headers.get('access-control-allow-origin'), null);
    assert.equal(statsRes.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(statsRes.headers.get('x-frame-options'), 'DENY');
    assert.equal(statsRes.headers.get('content-security-policy'), "default-src 'none'; frame-ancestors 'none'");
    assert.equal(statsRes.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(statsRes.headers.get('cross-origin-resource-policy'), 'same-origin');

    // /api/health restricts methods to GET/HEAD and returns minimal { ok: true }
    assert.equal((await fetch(`${base}/api/health`, { method: 'POST' })).status, 405);
    assert.deepEqual(await (await fetch(`${base}/api/health`)).json(), { ok: true });

    // Spoofed / DNS-rebinding Host header and malformed Host header return 400 (never 200 or 500)
    const rebindRaw = await rawHttp(port, `GET /api/health HTTP/1.1\r\nHost: evil.rebind.example:${port}\r\nConnection: close\r\n\r\n`);
    assert.match(rebindRaw.split('\r\n')[0], /HTTP\/1\.1 400/);

    const badHostRaw = await rawHttp(port, `GET /api/health HTTP/1.1\r\nHost: bad host:99999\r\nConnection: close\r\n\r\n`);
    assert.match(badHostRaw.split('\r\n')[0], /HTTP\/1\.1 400/);
  } finally {
    await hub.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('V-07 & V-08: non-loopback requires >=24-char secret, auth rate limiter returns 429 + logs failures, and scoped tokens enforce least privilege', async () => {
  const dir = makeTempDir();
  const dataFile = path.join(dir, 'devices.json');
  try {
    // Non-loopback rejects weak <24-char secret
    assert.throws(
      () => createHub({ port: 0, host: '0.0.0.0', secret: 'too-short', dataFile }),
      /at least 24 characters/
    );

    const warnings = [];
    const hub = createHub({
      port: 0,
      host: '127.0.0.1',
      readSecret: 'read-token-0123456789abcdef',
      ingestSecret: 'ingest-token-0123456789abcdef',
      adminSecret: 'admin-token-0123456789abcdef',
      authRateLimit: { maxFailures: 3, windowMs: 60_000 },
      dataFile,
      logger: { error() {}, warn: (...args) => warnings.push(args) }
    });
    await hub.start();
    try {
      const { port } = hub.server.address();
      const base = `http://127.0.0.1:${port}`;

      // Read token can GET /api/stats but cannot POST /api/ingest or PUT /api/reports/integrations
      assert.equal((await fetch(`${base}/api/stats`, {
        headers: { authorization: 'Bearer read-token-0123456789abcdef' }
      })).status, 200);
      assert.equal((await fetch(`${base}/api/ingest`, {
        method: 'POST',
        headers: { authorization: 'Bearer read-token-0123456789abcdef', 'content-type': 'application/json' },
        body: JSON.stringify({ deviceId: 'dev-1' })
      })).status, 403);

      // Ingest token can POST /api/ingest but cannot GET /api/stats or DELETE /api/devices/dev-1
      assert.equal((await fetch(`${base}/api/ingest`, {
        method: 'POST',
        headers: { authorization: 'Bearer ingest-token-0123456789abcdef', 'content-type': 'application/json' },
        body: JSON.stringify({ deviceId: 'dev-1', today: { totalTokens: 5 } })
      })).status, 200);
      assert.equal((await fetch(`${base}/api/stats`, {
        headers: { authorization: 'Bearer ingest-token-0123456789abcdef' }
      })).status, 403);
      assert.equal((await fetch(`${base}/api/devices/dev-1`, {
        method: 'DELETE',
        headers: { authorization: 'Bearer ingest-token-0123456789abcdef' }
      })).status, 403);

      // Admin token can DELETE /api/devices/dev-1
      assert.equal((await fetch(`${base}/api/devices/dev-1`, {
        method: 'DELETE',
        headers: { authorization: 'Bearer admin-token-0123456789abcdef' }
      })).status, 200);

      // 3 auth failures trigger 429 lockout on the 4th attempt and log warnings without leaking secret
      for (let i = 0; i < 3; i += 1) {
        const r = await fetch(`${base}/api/stats`, { headers: { authorization: 'Bearer bad-guess' } });
        assert.equal(r.status, 401);
      }
      assert.equal(warnings.length, 3);
      assert.equal(JSON.stringify(warnings).includes('bad-guess'), false);

      const locked = await fetch(`${base}/api/stats`, { headers: { authorization: 'Bearer read-token-0123456789abcdef' } });
      assert.equal(locked.status, 429);
      assert.equal(Number(locked.headers.get('retry-after')) >= 1, true);
    } finally {
      await hub.stop();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('V-09 & V-13 & V-14: hardened timeouts, SSE cap, upfront Content-Length 413, no ghost tombstones, 0600 files, and sanitized errors', async () => {
  const dir = makeTempDir();
  const dataFile = path.join(dir, 'devices.json');
  const secret = 'hardening-secret-0123456789abcdef';
  const hub = createHub({
    port: 0,
    host: '127.0.0.1',
    secret,
    maxSseClients: 2,
    approvalAlerts: true,
    dataFile,
    logger: { error() {}, warn() {} }
  });
  await hub.start();
  try {
    const { port } = hub.server.address();
    const base = `http://127.0.0.1:${port}`;
    const auth = { authorization: `Bearer ${secret}` };

    // Hardened server timeouts & caps
    assert.equal(hub.server.headersTimeout, 15_000);
    assert.equal(hub.server.requestTimeout, 30_000);
    assert.equal(hub.server.keepAliveTimeout, 60_000);
    assert.equal(hub.server.maxRequestsPerSocket, 1000);
    assert.equal(hub.server.maxConnections, 256);

    // SSE cap enforced at maxSseClients (2)
    const ac1 = new AbortController();
    const ac2 = new AbortController();
    const s1 = await fetch(`${base}/api/stats/stream`, { headers: auth, signal: ac1.signal });
    const s2 = await fetch(`${base}/api/stats/stream`, { headers: auth, signal: ac2.signal });
    const s3 = await fetch(`${base}/api/stats/stream`, { headers: auth });
    assert.equal(s1.status, 200);
    assert.equal(s2.status, 200);
    assert.equal(s3.status, 503);
    ac1.abort();
    ac2.abort();

    // Upfront Content-Length > 2 MiB rejected immediately with 413
    const clRaw = await rawHttp(port,
      `POST /api/ingest HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nAuthorization: Bearer ${secret}\r\nContent-Type: application/json\r\nContent-Length: 5000000\r\n\r\n{"a":1}`
    );
    assert.match(clRaw.split('\r\n')[0], /HTTP\/1\.1 413/);

    // Malformed % encoding returns 400 (never 500)
    assert.equal((await fetch(`${base}/api/devices/%E0%A4%A`, { method: 'DELETE', headers: auth })).status, 400);
    assert.equal((await fetch(`${base}/api/reports/%E0%A4%A/2026-01-01`, { headers: auth })).status, 400);

    // Deleting nonexistent devices does not create ghost tombstones, and valid ingest creates 0600 file
    await fetch(`${base}/api/devices/ghost-device`, { method: 'DELETE', headers: auth });
    await fetch(`${base}/api/ingest`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: 'real-dev', today: { totalTokens: 1 } })
    });
    const saved = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    assert.equal('ghost-device' in (saved.syncTitlePolicies || {}), false);
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(dataFile).mode & 0o077, 0);
    }

    // Unregistered device rejected on POST /api/approval-alerts
    const unregAlert = await fetch(`${base}/api/approval-alerts`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: 'unregistered-dev', client: 'codex', sessionId: 's1', tool: 'shell', command: 'ls' })
    });
    assert.equal(unregAlert.status, 400);

    // Remote admin routes disabled by default on standalone Hub
    assert.equal((await fetch(`${base}/api/integrations/openclaw/provision`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: '{}'
    })).status, 403);

    // Storage failure returns 500 storage_error without leaking raw filesystem path
    if (process.platform !== 'win32') {
      fs.chmodSync(dir, 0o555);
      try {
        const subErr = await fetch(`${base}/api/subscriptions`, {
          method: 'PUT',
          headers: { ...auth, 'content-type': 'application/json' },
          body: JSON.stringify({ subscriptions: [] })
        });
        assert.equal(subErr.status, 500);
        const subBody = await subErr.json();
        assert.equal(subBody.error, 'storage_error');
        assert.equal(String(subBody.message || '').includes(dir), false);
      } finally {
        fs.chmodSync(dir, 0o755);
      }
    }
  } finally {
    await hub.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
