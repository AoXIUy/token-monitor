'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createHubBackendAdapter,
  resolveMcpServerOptions
} = require('../../src/mcp/server');
const { resetHubClientFetchCache } = require('../../src/shared/hubClientFetch');
const { OPENSSL_BIN } = require('../helpers/opensslBin');

function runOpenssl(args, cwd) {
  execFileSync(OPENSSL_BIN, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

function generateLocalHttpsPki(dir) {
  const caKey = path.join(dir, 'ca.key');
  const caCert = path.join(dir, 'ca.pem');
  const leafKey = path.join(dir, 'leaf.key');
  const leafCsr = path.join(dir, 'leaf.csr');
  const leafCert = path.join(dir, 'leaf.pem');
  const extFile = path.join(dir, 'leaf.ext');

  runOpenssl(['genrsa', '-out', caKey, '2048'], dir);
  runOpenssl([
    'req', '-x509', '-new', '-nodes', '-key', caKey,
    '-sha256', '-days', '30', '-subj', '/CN=MCP Test CA',
    '-addext', 'basicConstraints=critical,CA:TRUE', '-out', caCert
  ], dir);
  runOpenssl(['genrsa', '-out', leafKey, '2048'], dir);
  runOpenssl(['req', '-new', '-key', leafKey, '-subj', '/CN=127.0.0.1', '-out', leafCsr], dir);
  fs.writeFileSync(extFile, 'basicConstraints=critical,CA:FALSE\nsubjectAltName=IP:127.0.0.1\n', 'utf8');
  runOpenssl([
    'x509', '-req', '-in', leafCsr, '-CA', caCert, '-CAkey', caKey, '-CAcreateserial',
    '-out', leafCert, '-days', '30', '-sha256', '-extfile', extFile
  ], dir);

  return {
    caCertPath: caCert,
    caCertPem: fs.readFileSync(caCert, 'utf8'),
    leafCertPem: fs.readFileSync(leafCert, 'utf8'),
    leafKeyPem: fs.readFileSync(leafKey, 'utf8')
  };
}

test('resolveMcpServerOptions parses --ca-cert, --require-https, and 0600 --secret-file', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-mcp-opts-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const secretFile = path.join(dir, 'mcp-secret');
  fs.writeFileSync(secretFile, 'file-bearer-secret\n', { mode: 0o600 });

  const fromEnv = resolveMcpServerOptions({
    argv: [],
    env: {
      TOKEN_MONITOR_HUB_URL: 'https://hub.example.test:17321/',
      TOKEN_MONITOR_SECRET_FILE: secretFile,
      TOKEN_MONITOR_CA_CERT: '/etc/ssl/custom-ca.pem',
      TOKEN_MONITOR_REQUIRE_HTTPS: '1'
    }
  });
  assert.equal(fromEnv.mode, 'hub');
  assert.equal(fromEnv.hubUrl, 'https://hub.example.test:17321');
  assert.equal(fromEnv.secret, 'file-bearer-secret');
  assert.equal(fromEnv.secretFromArgv, false);
  assert.equal(fromEnv.caCertPath, '/etc/ssl/custom-ca.pem');
  assert.equal(fromEnv.requireHttps, true);

  const fromCli = resolveMcpServerOptions({
    argv: ['--hub-url', 'https://cli.example.test', '--secret', 'argv-secret', '--ca-cert', '/tmp/ca.pem', '--require-https'],
    env: { TOKEN_MONITOR_SECRET_FILE: secretFile }
  });
  assert.equal(fromCli.secret, 'argv-secret');
  assert.equal(fromCli.secretFromArgv, true);
  assert.equal(fromCli.caCertPath, '/tmp/ca.pem');
  assert.equal(fromCli.requireHttps, true);
});

test('createHubBackendAdapter validates requireHttps and connects over HTTPS using custom CA', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-mcp-https-'));
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    return resetHubClientFetchCache();
  });

  // Fail closed when requireHttps is set on non-loopback plain HTTP
  assert.throws(
    () => createHubBackendAdapter({ hubUrl: 'http://192.168.10.2:17321', requireHttps: true }),
    (error) => error?.code === 'insecure_http_blocked'
  );

  const pki = generateLocalHttpsPki(dir);
  let lastAuth = '';
  const server = https.createServer({
    cert: pki.leafCertPem,
    key: pki.leafKeyPem,
    minVersion: 'TLSv1.2'
  }, (req, res) => {
    lastAuth = String(req.headers.authorization || '');
    if (req.url === '/api/reports') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, reports: [{ granularity: 'daily', periodKey: '2026-11-24' }] }));
      return;
    }
    if (req.url === '/api/stats') {
      res.writeHead(302, { location: 'https://evil.example/steal' });
      res.end();
      return;
    }
    res.writeHead(404);
    res.end();
  });
  const port = await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
  t.after(() => new Promise((resolve) => server.close(() => resolve())));

  // Succeeds with custom CA file
  const adapter = createHubBackendAdapter({
    hubUrl: `https://127.0.0.1:${port}`,
    secret: 'mcp-secret-123',
    caCertPath: pki.caCertPath,
    requireHttps: true
  });
  t.after(() => adapter.destroy());

  const reports = await adapter.listReports();
  assert.equal(reports.ok, true);
  assert.equal(reports.reports.length, 1);
  assert.equal(lastAuth, 'Bearer mcp-secret-123');

  // Refuses 302 redirect (redirect: 'error')
  await assert.rejects(() => adapter.getStats());

  // Fails closed without custom CA
  const untrusted = createHubBackendAdapter({
    hubUrl: `https://127.0.0.1:${port}`,
    secret: 'mcp-secret-123'
  });
  t.after(() => untrusted.destroy());
  await assert.rejects(() => untrusted.listReports());
});
