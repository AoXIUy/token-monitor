'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  MAX_CERT_BYTES,
  MAX_KEY_BYTES,
  TLS_ERROR_CODES,
  extractCertChainFromPkcs12,
  hostMatchesCertSan,
  loadPassphraseFromFile,
  parseCertificatesFromBuffer,
  readBoundedFile,
  selectExportablePublicCertPem,
  validateClientCaCertBuffer,
  validateClientCaCertFile,
  validatePemBundle,
  validatePkcs12Bundle
} = require('../../src/shared/tlsCert');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tm-tlscert-test-'));
}

function generateCertMaterial(dir) {
  const caKey = path.join(dir, 'ca.key.pem');
  const caCert = path.join(dir, 'ca.cert.pem');
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1',
    '-nodes', '-keyout', caKey, '-out', caCert,
    '-days', '365', '-subj', '/CN=Token Monitor Test Root CA',
    '-addext', 'basicConstraints=critical,CA:TRUE'
  ]);

  const leafKey = path.join(dir, 'leaf.key.pem');
  const leafCsr = path.join(dir, 'leaf.csr.pem');
  const leafCert = path.join(dir, 'leaf.cert.pem');
  const extFile = path.join(dir, 'leaf.ext');
  fs.writeFileSync(extFile, [
    'basicConstraints=critical,CA:FALSE',
    'subjectAltName=DNS:hub.example.test,DNS:*.wild.test,IP:127.0.0.1'
  ].join('\n'));
  execFileSync('openssl', [
    'req', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', leafKey, '-out', leafCsr,
    '-subj', '/CN=hub.example.test'
  ]);
  execFileSync('openssl', [
    'x509', '-req', '-in', leafCsr, '-CA', caCert, '-CAkey', caKey,
    '-CAcreateserial', '-out', leafCert, '-days', '60', '-extfile', extFile
  ]);

  const encKey = path.join(dir, 'leaf.enc.key.pem');
  execFileSync('openssl', [
    'rsa', '-in', leafKey, '-aes256', '-passout', 'pass:s3cret-pass', '-out', encKey
  ]);

  const pfxFile = path.join(dir, 'bundle.p12');
  execFileSync('openssl', [
    'pkcs12', '-export', '-inkey', leafKey, '-in', leafCert, '-certfile', caCert,
    '-passout', 'pass:p12-pass', '-out', pfxFile
  ]);

  const selfLeafKey = path.join(dir, 'self.key.pem');
  const selfLeafCert = path.join(dir, 'self.cert.pem');
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1',
    '-nodes', '-keyout', selfLeafKey, '-out', selfLeafCert,
    '-days', '60', '-subj', '/CN=127.0.0.1',
    '-addext', 'basicConstraints=critical,CA:FALSE',
    '-addext', 'subjectAltName=IP:127.0.0.1'
  ]);

  const weakKey = path.join(dir, 'weak.key.pem');
  const weakCert = path.join(dir, 'weak.cert.pem');
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:1024', '-nodes',
    '-keyout', weakKey, '-out', weakCert,
    '-days', '30', '-subj', '/CN=weak.test'
  ]);

  const certDer = path.join(dir, 'ca.cert.der');
  execFileSync('openssl', ['x509', '-in', caCert, '-outform', 'DER', '-out', certDer]);

  fs.chmodSync(leafKey, 0o600);
  fs.chmodSync(encKey, 0o600);
  fs.chmodSync(pfxFile, 0o600);

  return {
    caKey,
    caCert,
    leafKey,
    leafCert,
    encKey,
    pfxFile,
    selfLeafKey,
    selfLeafCert,
    weakKey,
    weakCert,
    certDer
  };
}

test('validatePemBundle validates leaf+CA chain, encrypted keys, SAN matching, and exportable CA selection', () => {
  const dir = makeTempDir();
  try {
    const m = generateCertMaterial(dir);
    const certBuf = fs.readFileSync(m.leafCert);
    const caBuf = fs.readFileSync(m.caCert);
    const keyBuf = fs.readFileSync(m.leafKey);
    const encKeyBuf = fs.readFileSync(m.encKey);

    const validated = validatePemBundle({
      certBuffer: certBuf,
      keyBuffer: keyBuf,
      caBuffer: caBuf,
      sourceBasename: 'leaf.cert.pem'
    });
    assert.equal(validated.format, 'pem');
    assert.equal(validated.certs.length, 2);
    assert.equal(validated.metadata.chainLength, 2);
    assert.equal(validated.metadata.sourceBasename, 'leaf.cert.pem');
    assert.equal(hostMatchesCertSan('hub.example.test', validated.metadata.san), true);
    assert.equal(hostMatchesCertSan('api.wild.test', validated.metadata.san), true);
    assert.equal(hostMatchesCertSan('deep.api.wild.test', validated.metadata.san), false);
    assert.equal(hostMatchesCertSan('127.0.0.1', validated.metadata.san), true);
    assert.equal(hostMatchesCertSan('192.168.1.1', validated.metadata.san), false);

    // Exportable cert selects the CA anchor when a chain is present
    const exported = selectExportablePublicCertPem(validated.certs);
    const exportedX509 = new crypto.X509Certificate(exported);
    assert.equal(exportedX509.ca, true);

    // Encrypted key succeeds with passphrase and fails with bad passphrase
    const encValidated = validatePemBundle({
      certBuffer: certBuf,
      keyBuffer: encKeyBuf,
      caBuffer: caBuf,
      passphrase: 's3cret-pass'
    });
    assert.equal(encValidated.format, 'pem');

    assert.throws(
      () => validatePemBundle({ certBuffer: certBuf, keyBuffer: encKeyBuf, passphrase: 'wrong' }),
      (err) => err.code === TLS_ERROR_CODES.BAD_PASSPHRASE
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('validatePemBundle rejects mismatched key, weak RSA-1024, expired/not-yet-valid, broken chain, and private key in cert', () => {
  const dir = makeTempDir();
  try {
    const m = generateCertMaterial(dir);
    const leafCertBuf = fs.readFileSync(m.leafCert);
    const caKeyBuf = fs.readFileSync(m.caKey);
    const leafKeyBuf = fs.readFileSync(m.leafKey);

    // Key mismatch (CA key paired with leaf cert)
    assert.throws(
      () => validatePemBundle({ certBuffer: leafCertBuf, keyBuffer: caKeyBuf }),
      (err) => err.code === TLS_ERROR_CODES.KEY_MISMATCH
    );

    // Weak RSA-1024 rejected
    assert.throws(
      () => validatePemBundle({
        certBuffer: fs.readFileSync(m.weakCert),
        keyBuffer: fs.readFileSync(m.weakKey)
      }),
      (err) => err.code === TLS_ERROR_CODES.WEAK_KEY
    );

    // Private key inside cert buffer rejected
    assert.throws(
      () => validatePemBundle({
        certBuffer: Buffer.concat([leafCertBuf, Buffer.from('\n'), leafKeyBuf]),
        keyBuffer: leafKeyBuf
      }),
      (err) => err.code === TLS_ERROR_CODES.PRIVATE_KEY_IN_CERT
    );

    // Expired cert rejected
    assert.throws(
      () => validatePemBundle({
        certBuffer: leafCertBuf,
        keyBuffer: leafKeyBuf,
        now: new Date('2099-01-01T00:00:00Z')
      }),
      (err) => err.code === TLS_ERROR_CODES.CERT_EXPIRED
    );

    // Not-yet-valid cert rejected
    assert.throws(
      () => validatePemBundle({
        certBuffer: leafCertBuf,
        keyBuffer: leafKeyBuf,
        now: new Date('2000-01-01T00:00:00Z')
      }),
      (err) => err.code === TLS_ERROR_CODES.CERT_NOT_YET_VALID
    );

    // Broken chain (leaf followed by unrelated CA:FALSE self-signed cert)
    assert.throws(
      () => validatePemBundle({
        certBuffer: leafCertBuf,
        keyBuffer: leafKeyBuf,
        caBuffer: fs.readFileSync(m.selfLeafCert)
      }),
      (err) => err.code === TLS_ERROR_CODES.BROKEN_CHAIN
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('validatePkcs12Bundle extracts cert chain in memory and rejects wrong passphrase', async () => {
  const dir = makeTempDir();
  try {
    const m = generateCertMaterial(dir);
    const pfxBuffer = fs.readFileSync(m.pfxFile);

    const certs = await extractCertChainFromPkcs12({ pfxBuffer, passphrase: 'p12-pass' });
    assert.equal(certs.length >= 1, true);

    const validated = await validatePkcs12Bundle({
      pfxBuffer,
      passphrase: 'p12-pass',
      sourceBasename: 'bundle.p12'
    });
    assert.equal(validated.format, 'pfx');
    assert.equal(validated.metadata.sourceBasename, 'bundle.p12');
    assert.equal(hostMatchesCertSan('127.0.0.1', validated.metadata.san), true);

    await assert.rejects(
      () => validatePkcs12Bundle({ pfxBuffer, passphrase: 'wrong-password' }),
      (err) => err.code === TLS_ERROR_CODES.BAD_PASSPHRASE
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('validateClientCaCertBuffer/File accepts PEM & DER, enforces size/block caps, and blocks symlinks & world-readable keys', () => {
  const dir = makeTempDir();
  try {
    const m = generateCertMaterial(dir);
    const pemResult = validateClientCaCertFile(m.caCert);
    const derResult = validateClientCaCertBuffer(fs.readFileSync(m.certDer));
    assert.equal(pemResult.caFingerprintSha256, derResult.caFingerprintSha256);
    assert.equal(pemResult.summary.isCa, true);

    // Reject private key in CA import
    assert.throws(
      () => validateClientCaCertBuffer(fs.readFileSync(m.caKey)),
      (err) => err.code === TLS_ERROR_CODES.PRIVATE_KEY_IN_CERT
    );

    // Reject >10 certificate blocks
    const elevenCerts = Array.from({ length: 11 }, () => fs.readFileSync(m.caCert, 'utf8')).join('\n');
    assert.throws(
      () => parseCertificatesFromBuffer(Buffer.from(elevenCerts, 'utf8')),
      (err) => err.code === TLS_ERROR_CODES.TOO_MANY_CERTS
    );

    // Reject oversized buffer
    assert.throws(
      () => validateClientCaCertBuffer(Buffer.alloc(MAX_CERT_BYTES + 1, 0x41)),
      (err) => err.code === TLS_ERROR_CODES.FILE_TOO_LARGE
    );

    // Symlink rejected when noFollow: true
    const symlinkPath = path.join(dir, 'ca-link.pem');
    fs.symlinkSync(m.caCert, symlinkPath);
    assert.throws(
      () => validateClientCaCertFile(symlinkPath),
      (err) => err.code === TLS_ERROR_CODES.FILE_NOT_REGULAR
    );

    if (process.platform !== 'win32') {
      const worldKey = path.join(dir, 'world.key');
      fs.writeFileSync(worldKey, 'secret\n', { mode: 0o644 });
      fs.chmodSync(worldKey, 0o644);
      assert.throws(
        () => readBoundedFile(worldKey, { maxBytes: MAX_KEY_BYTES, checkPrivateKeyPerms: true }),
        (err) => err.code === TLS_ERROR_CODES.KEY_PERMISSIONS_TOO_OPEN
      );

      const passFile = path.join(dir, 'pass.txt');
      fs.writeFileSync(passFile, 'my-passphrase\n', { mode: 0o600 });
      fs.chmodSync(passFile, 0o600);
      assert.equal(loadPassphraseFromFile(passFile), 'my-passphrase');
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
