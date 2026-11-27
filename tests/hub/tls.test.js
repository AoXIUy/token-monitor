'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const tls = require('node:tls');

const { createHub } = require('../../src/hub/server');
const { importManagedTlsMaterials } = require('../../src/hub/tls');
const { createHubClientFetch } = require('../../src/shared/hubClientFetch');
const { OPENSSL_BIN } = require('../helpers/opensslBin');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tm-hub-tls-test-'));
}

function generateTlsFixtures(dir) {
  const caKey = path.join(dir, 'ca.key.pem');
  const caCert = path.join(dir, 'ca.cert.pem');
  execFileSync(OPENSSL_BIN, [
    'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1',
    '-nodes', '-keyout', caKey, '-out', caCert,
    '-days', '365', '-subj', '/CN=Hub Test CA',
    '-addext', 'basicConstraints=critical,CA:TRUE'
  ]);

  function issueLeaf(name, sanLine) {
    const keyPath = path.join(dir, `${name}.key.pem`);
    const csrPath = path.join(dir, `${name}.csr.pem`);
    const certPath = path.join(dir, `${name}.cert.pem`);
    const extPath = path.join(dir, `${name}.ext`);
    fs.writeFileSync(extPath, `basicConstraints=critical,CA:FALSE\nsubjectAltName=${sanLine}\n`);
    execFileSync(OPENSSL_BIN, [
      'req', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1',
      '-nodes', '-keyout', keyPath, '-out', csrPath, '-subj', `/CN=${name}`
    ]);
    execFileSync(OPENSSL_BIN, [
      'x509', '-req', '-in', csrPath, '-CA', caCert, '-CAkey', caKey,
      '-CAcreateserial', '-out', certPath, '-days', '90', '-extfile', extPath
    ]);
    fs.chmodSync(keyPath, 0o600);
    return { keyPath, certPath };
  }

  const leaf1 = issueLeaf('leaf1', 'DNS:localhost,IP:127.0.0.1');
  const leaf2 = issueLeaf('leaf2', 'DNS:localhost,DNS:rotated.local,IP:127.0.0.1');

  const pfxPath = path.join(dir, 'server.p12');
  execFileSync(OPENSSL_BIN, [
    'pkcs12', '-export', '-inkey', leaf1.keyPath, '-in', leaf1.certPath, '-certfile', caCert,
    '-passout', 'pass:pfx-secret-123', '-out', pfxPath
  ]);
  fs.chmodSync(pfxPath, 0o600);

  return { caCert, leaf1, leaf2, pfxPath };
}

function httpGetRaw(port, hostHeader) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: '/api/stats?x=1',
      method: 'GET',
      headers: { host: hostHeader }
    }, (res) => {
      res.resume();
      resolve({ statusCode: res.statusCode, headers: res.headers });
    });
    req.on('error', reject);
    req.end();
  });
}

test('createHub serves native HTTPS with PEM, HSTS, security headers, zero-downtime reloadTls, and rollback on invalid cert', async () => {
  const dir = makeTempDir();
  const dataFile = path.join(dir, 'devices.json');
  const f = generateTlsFixtures(dir);
  const caPem = fs.readFileSync(f.caCert, 'utf8');
  const secret = 'tls-test-secret-0123456789abcdef';
  const liveCert = path.join(dir, 'live.cert.pem');
  const liveKey = path.join(dir, 'live.key.pem');
  fs.copyFileSync(f.leaf1.certPath, liveCert);
  fs.copyFileSync(f.leaf1.keyPath, liveKey);
  fs.chmodSync(liveKey, 0o600);

  const hub = createHub({
    port: 0,
    host: '127.0.0.1',
    secret,
    dataFile,
    tls: {
      enabled: true,
      mode: 'path',
      certPath: liveCert,
      keyPath: liveKey,
      caPath: f.caCert,
      minVersion: 'TLSv1.2',
      hsts: true,
      watch: false
    },
    logger: { error() {}, warn() {} }
  });
  await hub.start();
  const client = createHubClientFetch({ caCertPem: caPem });
  try {
    assert.equal(hub.scheme, 'https');
    assert.equal(hub.server instanceof https.Server, true);
    const { port } = hub.server.address();
    const base = `https://127.0.0.1:${port}`;

    // Unauthenticated health returns minimal { ok: true } + HSTS + security headers
    const unauthHealth = await client(`${base}/api/health`);
    assert.equal(unauthHealth.status, 200);
    assert.equal(unauthHealth.headers.get('strict-transport-security'), 'max-age=31536000');
    assert.equal(unauthHealth.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(unauthHealth.headers.get('x-frame-options'), 'DENY');
    assert.equal(unauthHealth.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(unauthHealth.headers.get('access-control-allow-origin'), null);
    assert.deepEqual(await unauthHealth.json(), { ok: true });

    // Authenticated health exposes tls.enabled and build metadata
    const authHealth = await client(`${base}/api/health`, {
      headers: { authorization: `Bearer ${secret}` }
    });
    const authHealthBody = await authHealth.json();
    assert.equal(authHealthBody.tls?.enabled, true);
    assert.equal(Boolean(authHealthBody.hubBuild), true);

    const beforeFp = hub.tlsStatus().cert.sha256;

    // Hot-reload to leaf2
    fs.copyFileSync(f.leaf2.certPath, liveCert);
    fs.copyFileSync(f.leaf2.keyPath, liveKey);
    fs.chmodSync(liveKey, 0o600);
    const reloadOk = await hub.reloadTls();
    assert.equal(reloadOk.ok, true);
    assert.notEqual(hub.tlsStatus().cert.sha256, beforeFp);
    assert.equal(hub.tlsStatus().cert.san.dns.includes('rotated.local'), true);

    // Hot-reload with corrupted cert fails safely and retains previous live context
    const activeFp = hub.tlsStatus().cert.sha256;
    fs.writeFileSync(liveCert, 'corrupted-not-a-cert');
    const reloadBad = await hub.reloadTls();
    assert.equal(reloadBad.ok, false);
    assert.equal(hub.tlsStatus().cert.sha256, activeFp);

    // Live HTTPS traffic still succeeds with the retained context
    const statsRes = await client(`${base}/api/stats`, {
      headers: { authorization: `Bearer ${secret}` }
    });
    assert.equal(statsRes.status, 200);
  } finally {
    await client.destroy();
    await hub.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('createHub serves native HTTPS from managed PKCS#12 bundle, blocks TLS < 1.2, and guards HTTP->HTTPS 308 redirector', async () => {
  const dir = makeTempDir();
  const dataFile = path.join(dir, 'devices.json');
  const f = generateTlsFixtures(dir);
  const caPem = fs.readFileSync(f.caCert, 'utf8');
  const secret = 'tls-p12-secret-0123456789abcdef';

  const imported = await importManagedTlsMaterials({
    storageDir: dir,
    pfxPath: f.pfxPath,
    passphrase: 'pfx-secret-123'
  });
  assert.equal(imported.ok, true);
  assert.equal(imported.format, 'pfx');

  const hub = createHub({
    port: 0,
    host: '127.0.0.1',
    secret,
    dataFile,
    tls: {
      enabled: true,
      mode: 'managed',
      storageDir: dir,
      pfxPath: imported.pfxPath,
      passphrase: 'pfx-secret-123',
      minVersion: 'TLSv1.3',
      httpRedirectPort: 0
    },
    logger: { error() {}, warn() {} }
  });
  await hub.start();
  const client = createHubClientFetch({ caCertPem: caPem });
  try {
    const httpsPort = hub.server.address().port;
    const redirectPort = hub.redirectServer.address().port;

    // TLS 1.2 client rejected when minVersion is TLSv1.3
    await assert.rejects(
      () => new Promise((resolve, reject) => {
        const sock = tls.connect({
          host: '127.0.0.1',
          port: httpsPort,
          ca: caPem,
          minVersion: 'TLSv1.2',
          maxVersion: 'TLSv1.2'
        }, () => {
          sock.end();
          resolve();
        });
        sock.on('error', reject);
      })
    );

    // TLS 1.3 client succeeds
    const res = await client(`https://127.0.0.1:${httpsPort}/api/stats`, {
      headers: { authorization: `Bearer ${secret}` }
    });
    assert.equal(res.status, 200);

    // Guarded HTTP->HTTPS redirector allows SAN-matched Host and rejects forged Host
    const validRedirect = await httpGetRaw(redirectPort, `127.0.0.1:${redirectPort}`);
    assert.equal(validRedirect.statusCode, 308);
    assert.equal(validRedirect.headers.location, `https://127.0.0.1:${httpsPort}/api/stats?x=1`);

    const forgedRedirect = await httpGetRaw(redirectPort, 'evil.attacker.example');
    assert.equal(forgedRedirect.statusCode, 400);
    assert.equal(forgedRedirect.headers.location, undefined);
  } finally {
    await client.destroy();
    await hub.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('createHub enforces --require-tls on non-loopback plain HTTP', () => {
  const dir = makeTempDir();
  try {
    assert.throws(
      () => createHub({
        port: 0,
        host: '0.0.0.0',
        secret: 'strong-secret-at-least-24-chars-long',
        requireTls: true,
        dataFile: path.join(dir, 'devices.json'),
        logger: { error() {}, warn() {} }
      }),
      /TLS is required when binding to a non-loopback address/
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
