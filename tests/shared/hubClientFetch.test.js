'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  caFingerprintSha256,
  createHubClientFetch,
  isInsecureRemoteHttpUrl,
  isLoopbackHost,
  parseClientCaBundle,
  readClientCaFile,
  readPrivateSecretFile,
  resetHubClientFetchCache
} = require('../../src/shared/hubClientFetch');

function runOpenssl(args, cwd) {
  execFileSync('openssl', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

function generateTestPki(dir, options = {}) {
  const cn = options.cn || '127.0.0.1';
  const san = options.san || 'IP:127.0.0.1';
  const bits = options.bits || 2048;
  const caKey = path.join(dir, 'ca.key');
  const caCert = path.join(dir, 'ca.pem');
  const leafKey = path.join(dir, 'leaf.key');
  const leafCsr = path.join(dir, 'leaf.csr');
  const leafCert = path.join(dir, 'leaf.pem');
  const extFile = path.join(dir, 'leaf.ext');

  runOpenssl(['genrsa', '-out', caKey, String(bits)], dir);
  runOpenssl([
    'req', '-x509', '-new', '-nodes', '-key', caKey,
    '-sha256', '-days', '30',
    '-subj', `/CN=Test Root CA ${cn}`,
    '-addext', 'basicConstraints=critical,CA:TRUE',
    '-out', caCert
  ], dir);

  runOpenssl(['genrsa', '-out', leafKey, String(bits)], dir);
  runOpenssl([
    'req', '-new', '-key', leafKey,
    '-subj', `/CN=${cn}`,
    '-out', leafCsr
  ], dir);

  fs.writeFileSync(extFile, [
    'basicConstraints=critical,CA:FALSE',
    `subjectAltName=${san}`
  ].join('\n'), 'utf8');

  runOpenssl([
    'x509', '-req', '-in', leafCsr,
    '-CA', caCert, '-CAkey', caKey, '-CAcreateserial',
    '-out', leafCert, '-days', '30', '-sha256',
    '-extfile', extFile
  ], dir);

  const caDer = path.join(dir, 'ca.der');
  runOpenssl(['x509', '-in', caCert, '-outform', 'DER', '-out', caDer], dir);

  return {
    caCertPath: caCert,
    caDerPath: caDer,
    caCertPem: fs.readFileSync(caCert, 'utf8'),
    leafCertPem: fs.readFileSync(leafCert, 'utf8'),
    leafKeyPem: fs.readFileSync(leafKey, 'utf8')
  };
}

function listenServer(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve(addr && typeof addr === 'object' ? addr.port : 0);
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

test('isLoopbackHost and isInsecureRemoteHttpUrl distinguish loopback from remote HTTP', () => {
  assert.equal(isLoopbackHost('127.0.0.1'), true);
  assert.equal(isLoopbackHost('localhost'), true);
  assert.equal(isLoopbackHost('::1'), true);
  assert.equal(isLoopbackHost('[::1]'), true);
  assert.equal(isLoopbackHost('192.168.1.50'), false);
  assert.equal(isLoopbackHost('hub.example.com'), false);

  assert.equal(isInsecureRemoteHttpUrl('http://127.0.0.1:17321'), false);
  assert.equal(isInsecureRemoteHttpUrl('http://localhost:17321'), false);
  assert.equal(isInsecureRemoteHttpUrl('http://[::1]:17321'), false);
  assert.equal(isInsecureRemoteHttpUrl('https://192.168.1.50:17321'), false);
  assert.equal(isInsecureRemoteHttpUrl('http://192.168.1.50:17321'), true);
  assert.equal(isInsecureRemoteHttpUrl('http://hub.example.com:17321'), true);
});

test('createHubClientFetch enforces pinned custom CA, SAN verification, Buffer bodies, and no-redirect', async (t) => {
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-ca-a-'));
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-ca-b-'));
  t.after(() => {
    fs.rmSync(dirA, { recursive: true, force: true });
    fs.rmSync(dirB, { recursive: true, force: true });
    return resetHubClientFetchCache();
  });

  const pkiA = generateTestPki(dirA, { cn: '127.0.0.1', san: 'IP:127.0.0.1' });
  const pkiB = generateTestPki(dirB, { cn: '127.0.0.1', san: 'IP:127.0.0.1' });

  let redirectTargetHit = false;
  const redirectTarget = http.createServer((req, res) => {
    redirectTargetHit = Boolean(req.headers.authorization);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ leaked: redirectTargetHit }));
  });
  const redirectTargetPort = await listenServer(redirectTarget);
  t.after(() => closeServer(redirectTarget));

  const server = https.createServer({
    cert: pkiA.leafCertPem,
    key: pkiA.leafKeyPem,
    minVersion: 'TLSv1.2'
  }, (req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(302, { location: `http://127.0.0.1:${redirectTargetPort}/steal` });
      res.end();
      return;
    }
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        auth: req.headers.authorization || '',
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });
  });
  const port = await listenServer(server);
  t.after(() => closeServer(server));

  // 1. Trusted pinned CA succeeds and delivers Buffer payload intact
  const trustedFetch = createHubClientFetch({ caCertPem: pkiA.caCertPem, defaultTimeoutMs: 5000 });
  const okRes = await trustedFetch(`https://127.0.0.1:${port}/echo`, {
    method: 'POST',
    headers: { authorization: 'Bearer secret-token', 'content-type': 'application/json' },
    body: Buffer.from(JSON.stringify({ hello: 'tls' }), 'utf8')
  });
  assert.equal(okRes.status, 200);
  const okJson = await okRes.json();
  assert.equal(okJson.ok, true);
  assert.equal(okJson.auth, 'Bearer secret-token');
  assert.equal(okJson.body, '{"hello":"tls"}');

  // 2. Without custom CA fails closed against self-signed CA
  const defaultFetch = createHubClientFetch({ defaultTimeoutMs: 5000 });
  await assert.rejects(() => defaultFetch(`https://127.0.0.1:${port}/echo`));

  // 3. Wrong custom CA fails closed (strict pinning)
  const wrongCaFetch = createHubClientFetch({ caCertPem: pkiB.caCertPem, defaultTimeoutMs: 5000 });
  await assert.rejects(() => wrongCaFetch(`https://127.0.0.1:${port}/echo`));

  // 4. Hostname mismatch fails closed (cert only lists IP:127.0.0.1, not DNS:localhost)
  await assert.rejects(
    () => trustedFetch(`https://localhost:${port}/echo`),
    (error) => {
      const code = error?.cause?.code || error?.code || '';
      return code === 'ERR_TLS_CERT_ALTNAME_INVALID' || /altname|hostname/i.test(String(error?.cause?.message || error?.message || ''));
    }
  );

  // 5. Redirect is rejected and never leaks Authorization header to target
  await assert.rejects(
    () => trustedFetch(`https://127.0.0.1:${port}/redirect`, {
      headers: { authorization: 'Bearer super-secret' }
    })
  );
  assert.equal(redirectTargetHit, false);

  // 6. requireHttps blocks non-loopback HTTP while permitting loopback HTTP
  const strictFetch = createHubClientFetch({ requireHttps: true, defaultTimeoutMs: 5000 });
  await assert.rejects(
    () => strictFetch('http://192.168.1.50:17321/api/stats'),
    (error) => error?.code === 'insecure_http_blocked'
  );
  const localOk = await strictFetch(`http://127.0.0.1:${redirectTargetPort}/ok`);
  assert.equal(localOk.status, 200);
});

test('parseClientCaBundle and readClientCaFile validate PEM/DER, reject private keys, weak keys, and symlinks', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-ca-parse-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const pki = generateTestPki(dir, { cn: 'ca.example.test', san: 'DNS:ca.example.test' });
  const parsedPem = parseClientCaBundle(pki.caCertPem);
  assert.match(parsedPem.caFingerprintSha256, /^[0-9a-f]{64}$/);
  assert.ok(parsedPem.summary.fingerprint256.includes(':'));
  assert.equal(caFingerprintSha256(parsedPem.caCertPem), caFingerprintSha256(parsedPem.caCertPem.trim()));
  assert.equal(parsedPem.summary.certCount, 1);
  assert.match(parsedPem.summary.subject, /Test Root CA/);

  // DER certificate converts cleanly to canonical PEM with identical fingerprint
  const parsedDer = readClientCaFile(pki.caDerPath);
  assert.equal(parsedDer.caFingerprintSha256, parsedPem.caFingerprintSha256);

  // Rejects files containing private keys
  assert.throws(
    () => parseClientCaBundle(`${pki.caCertPem}\n${pki.leafKeyPem}`),
    (error) => error?.code === 'tls_private_key_not_allowed'
  );

  // Rejects oversized CA bundle
  assert.throws(
    () => parseClientCaBundle(Buffer.alloc(300 * 1024, 0x41)),
    (error) => error?.code === 'tls_file_too_large'
  );

  // Rejects weak RSA 1024-bit CA
  const weakDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-ca-weak-'));
  t.after(() => fs.rmSync(weakDir, { recursive: true, force: true }));
  const weakPki = generateTestPki(weakDir, { cn: 'weak.test', san: 'DNS:weak.test', bits: 1024 });
  assert.throws(
    () => parseClientCaBundle(weakPki.caCertPem),
    (error) => error?.code === 'tls_weak_key'
  );

  // Rejects symlinks (O_NOFOLLOW) on POSIX
  if (process.platform !== 'win32') {
    const symlinkPath = path.join(dir, 'ca-link.pem');
    fs.symlinkSync(pki.caCertPath, symlinkPath);
    assert.throws(() => readClientCaFile(symlinkPath));
  }
});

test('readPrivateSecretFile enforces 0600 permissions, no-follow, and size bounds on POSIX', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-secret-file-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const secretPath = path.join(dir, 'secret.txt');
  fs.writeFileSync(secretPath, 'my-private-hub-secret\n', { mode: 0o600 });
  assert.equal(readPrivateSecretFile(secretPath), 'my-private-hub-secret');

  if (process.platform !== 'win32') {
    fs.chmodSync(secretPath, 0o644);
    assert.throws(
      () => readPrivateSecretFile(secretPath),
      (error) => error?.code === 'insecure_secret_file_permissions'
    );
    fs.chmodSync(secretPath, 0o600);

    const linkPath = path.join(dir, 'secret-link.txt');
    fs.symlinkSync(secretPath, linkPath);
    assert.throws(() => readPrivateSecretFile(linkPath));
  }
});
