'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { CredentialStore } = require('../../src/shared/credentialStore');
const { resetHubClientFetchCache } = require('../../src/shared/hubClientFetch');
const {
  activeHubProfile,
  hubProfilesForRenderer,
  initializeHubProfiles,
  prepareHubProfilePatch
} = require('../../src/electron/hubProfiles');
const { classifySettingsChange } = require('../../src/electron/runtimeConfig');
const { destinationBinding, sameDestination } = require('../../src/electron/syncContentRuntime');
const { classifyStreamFailure } = require('../../src/electron/syncConnection');
const {
  createDiagnosticSnapshotBuilder,
  diagnosticStreamDetailCode
} = require('../../src/electron/diagnosticSnapshot');
const { formatDiagnosticReport, sanitizeDiagnosticSnapshot } = require('../../src/shared/diagnosticReport');
const { probeHubBuild } = require('../../src/electron/hubBuildStatus');
const { resolveCompleteHistory } = require('../../src/electron/historySource');
const { createOpenClawBridge } = require('../../src/electron/openclawBridge');
const { currentHubBuild } = require('../../src/shared/hubBuildIdentity');
const { OPENSSL_BIN } = require('../helpers/opensslBin');

function runOpenssl(args, cwd) {
  execFileSync(OPENSSL_BIN, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

function generateLocalPki(dir) {
  const caKey = path.join(dir, 'ca.key');
  const caCert = path.join(dir, 'ca.pem');
  const leafKey = path.join(dir, 'leaf.key');
  const leafCsr = path.join(dir, 'leaf.csr');
  const leafCert = path.join(dir, 'leaf.pem');
  const extFile = path.join(dir, 'leaf.ext');

  runOpenssl(['genrsa', '-out', caKey, '2048'], dir);
  runOpenssl([
    'req', '-x509', '-new', '-nodes', '-key', caKey,
    '-sha256', '-days', '30', '-subj', '/CN=Electron Test CA',
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
    caCertPem: fs.readFileSync(caCert, 'utf8'),
    leafCertPem: fs.readFileSync(leafCert, 'utf8'),
    leafKeyPem: fs.readFileSync(leafKey, 'utf8')
  };
}

test('CredentialStore encrypts TLS passphrase via injected safeStorage adapter and fails closed on decrypt errors', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-cred-tls-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  // Ensure credentialStore.js stays pure Node (zero electron imports)
  const credSource = fs.readFileSync(path.join(__dirname, '../../src/shared/credentialStore.js'), 'utf8');
  assert.equal(/require\(\s*['"]electron['"]\s*\)/.test(credSource), false);

  const mockSafeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (plain) => Buffer.from(`ENC:${plain}`, 'utf8'),
    decryptString: (buf) => {
      const s = buf.toString('utf8');
      if (!s.startsWith('ENC:')) throw new Error('corrupt');
      return s.slice(4);
    }
  };

  const store = new CredentialStore(dir);
  const written = store.writeHubTlsPassphrase('my-pfx-secret-pass', { safeStorage: mockSafeStorage });
  assert.equal(written.mode, 'safeStorage');

  const rawDisk = fs.readFileSync(path.join(dir, 'credentials.json'), 'utf8');
  assert.equal(rawDisk.includes('my-pfx-secret-pass'), false, 'plaintext passphrase must never appear on disk when safeStorage is active');

  assert.equal(store.readHubTlsPassphrase({ safeStorage: mockSafeStorage }), 'my-pfx-secret-pass');

  // Fail closed when safeStorage is unavailable or decryption fails
  assert.throws(
    () => store.readHubTlsPassphrase({}),
    (error) => error?.code === 'tls_passphrase_decrypt_failed'
  );
  assert.throws(
    () => store.readHubTlsPassphrase({
      safeStorage: {
        isEncryptionAvailable: () => true,
        decryptString: () => { throw new Error('keychain locked'); }
      }
    }),
    (error) => error?.code === 'tls_passphrase_decrypt_failed'
  );

  // Fallback plain-private mode works when safeStorage is unavailable
  const plainWritten = store.writeHubTlsPassphrase('fallback-pass', {});
  assert.equal(plainWritten.mode, 'plain-private');
  assert.equal(store.readHubTlsPassphrase({}), 'fallback-pass');

  // Validation rejects NUL bytes and oversize passphrases
  assert.throws(
    () => store.writeHubTlsPassphrase('bad\0pass', {}),
    (error) => error?.code === 'tls_invalid_passphrase'
  );
  assert.throws(
    () => store.writeHubTlsPassphrase('a'.repeat(2000), {}),
    (error) => error?.code === 'tls_invalid_passphrase'
  );

  // Clear removes stored envelope
  store.writeHubTlsPassphrase('', {});
  assert.equal(store.readHubTlsPassphrase({}), '');
});

test('hubProfiles enforces custom CA draft tokens, strips raw CA PEMs, and requires secret on trust changes', () => {
  const base = {
    hubMode: 'client',
    hubUrl: 'https://hub-a.example:17321',
    secret: 'secret-a',
    deviceId: 'laptop'
  };
  let settings = { ...base, ...initializeHubProfiles(base) };

  // Raw CA fields in renderer input are ignored
  const forged = prepareHubProfilePatch(settings, {
    caCertPem: '-----BEGIN CERTIFICATE-----\nFORGED\n-----END CERTIFICATE-----',
    caFingerprintSha256: 'deadbeef',
    language: 'en'
  });
  assert.deepEqual(forged, { language: 'en' });

  // Attaching CA to plain http:// fails closed
  assert.throws(
    () => prepareHubProfilePatch(settings, {
      hubProfileAction: { type: 'add', name: 'Plain', caMode: 'replace', caDraftToken: 'tok-1' },
      hubUrl: 'http://192.168.1.10:17321',
      secret: 'plain-secret'
    }, {
      resolveCaDraft: () => ({ caCertPem: 'PEM', caFingerprintSha256: 'a'.repeat(64), summary: { subject: 'CN=Test' } })
    }),
    /ca_requires_https/
  );

  // Changing CA on existing profile WITHOUT re-entering secret fails closed
  assert.throws(
    () => prepareHubProfilePatch(settings, {
      hubProfileAction: { type: 'save', name: 'Hub A', caMode: 'replace', caDraftToken: 'tok-1' }
    }, {
      resolveCaDraft: () => ({ caCertPem: '-----BEGIN CERTIFICATE-----\nVALID\n-----END CERTIFICATE-----', caFingerprintSha256: 'b'.repeat(64), summary: { subject: 'CN=Custom CA', validTo: '2027-01-01T00:00:00.000Z', fingerprint256: 'BB:BB' } })
    }),
    /secret_required_on_trust_change/
  );

  // Changing URL origin on existing profile WITHOUT re-entering secret fails closed
  assert.throws(
    () => prepareHubProfilePatch(settings, {
      hubProfileAction: { type: 'save', name: 'Hub A' },
      hubUrl: 'https://hub-evil.example:17321'
    }),
    /secret_required_on_trust_change/
  );

  // Supplying explicit secret succeeds and exposes ONLY sanitized metadata to renderer
  const patched = prepareHubProfilePatch(settings, {
    hubProfileAction: { type: 'save', name: 'Hub A', caMode: 'replace', caDraftToken: 'tok-1' },
    secret: 'secret-a-verified'
  }, {
    resolveCaDraft: (token) => token === 'tok-1'
      ? {
          caCertPem: '-----BEGIN CERTIFICATE-----\nVALID_CA_PEM_BODY\n-----END CERTIFICATE-----',
          caFingerprintSha256: 'c'.repeat(64),
          summary: { subject: 'CN=Custom CA', issuer: 'CN=Custom CA', validTo: '2027-01-01T00:00:00.000Z', fingerprint256: 'CC:CC', certCount: 1 }
        }
      : null
  });
  settings = { ...settings, ...patched };
  assert.equal(activeHubProfile(settings).caFingerprintSha256, 'c'.repeat(64));

  const visible = hubProfilesForRenderer(settings);
  assert.equal(visible[0].hasCustomCa, true);
  assert.equal(visible[0].caSummary.subject, 'CN=Custom CA');
  assert.equal(JSON.stringify(visible).includes('VALID_CA_PEM_BODY'), false);
  assert.equal(JSON.stringify(visible).includes('secret-a-verified'), false);
});

test('runtimeConfig and syncContentRuntime treat TLS and CA fingerprint changes as structural trust transitions', () => {
  assert.equal(classifySettingsChange({ hubHostBind: '0.0.0.0' }, { hubHostBind: '127.0.0.1' }).modeStructural, true);
  assert.equal(classifySettingsChange({ hubHostTlsEnabled: false }, { hubHostTlsEnabled: true }).modeStructural, true);
  assert.equal(classifySettingsChange({ hubHostTlsMinVersion: 'TLSv1.2' }, { hubHostTlsMinVersion: 'TLSv1.3' }).modeStructural, true);
  assert.equal(classifySettingsChange({ caFingerprintSha256: '' }, { caFingerprintSha256: 'a'.repeat(64) }).modeStructural, true);

  const ctxA = { mode: 'client', url: 'https://hub.example:17321', secret: 's', deviceId: 'dev', caFingerprintSha256: 'a'.repeat(64) };
  const ctxB = { ...ctxA, caFingerprintSha256: 'b'.repeat(64) };
  assert.equal(sameDestination(ctxA, ctxB), false);
  assert.equal(destinationBinding(ctxA).caFingerprintSha256, 'a'.repeat(64));
});

test('TLS stream errors and diagnostic snapshots expose closed enums only without leaking paths, CNs, or secrets', () => {
  assert.deepEqual(classifyStreamFailure({ errorCode: 'DEPTH_ZERO_SELF_SIGNED_CERT' }), { reason: 'tls_untrusted', detail: null });
  assert.deepEqual(classifyStreamFailure({ errorCode: 'CERT_HAS_EXPIRED' }), { reason: 'tls_expired', detail: null });
  assert.deepEqual(classifyStreamFailure({ errorCode: 'ERR_TLS_CERT_ALTNAME_INVALID' }), { reason: 'tls_hostname_mismatch', detail: null });
  assert.deepEqual(classifyStreamFailure({ errorCode: 'ERR_SSL_WRONG_VERSION_NUMBER' }), { reason: 'tls_error', detail: null });

  assert.equal(diagnosticStreamDetailCode({ reason: 'tls_untrusted' }), 'tls-untrusted-cert');
  assert.equal(diagnosticStreamDetailCode({ reason: 'tls_expired' }), 'tls-expired-cert');
  assert.equal(diagnosticStreamDetailCode({ reason: 'tls_hostname_mismatch' }), 'tls-hostname-mismatch');
  assert.equal(diagnosticStreamDetailCode({ reason: 'tls_error' }), 'tls-handshake-failed');

  const nowMs = Date.parse('2026-11-24T12:00:00.000Z');
  const builder = createDiagnosticSnapshotBuilder({
    getSettings: () => ({
      hubMode: 'host',
      hubHostTlsEnabled: true,
      hubHostTlsMode: 'managed',
      hubHostTlsMinVersion: 'TLSv1.3',
      hubHostTlsCertPath: '/home/alice/secret-private-cert.pem',
      hubHostTlsKeyPath: '/home/alice/secret-private.key',
      hubHostTlsCertMetadata: {
        subject: 'CN=internal-corp.secret.local',
        validTo: '2026-12-05T00:00:00.000Z'
      }
    }),
    getEffectiveHubConfig: () => ({ url: 'https://127.0.0.1:17321', caCertPem: '' }),
    getEmbeddedHub: () => ({
      hub: {
        tlsStatus: () => ({
          enabled: true,
          mode: 'managed',
          minVersion: 'TLSv1.3',
          cert: { subject: 'CN=internal-corp.secret.local', validTo: '2026-12-05T00:00:00.000Z' },
          lastReloadError: ''
        })
      }
    }),
    getNowMs: () => nowMs
  });

  const snapshot = builder.build(new Date(nowMs));
  assert.equal(snapshot.hub.runtime.hubHostTlsEnabled, true);
  assert.equal(snapshot.hub.runtime.hubHostTlsMode, 'managed');
  assert.equal(snapshot.hub.runtime.hubHostTlsMinVersion, 'TLSv1.3');
  assert.equal(snapshot.hub.runtime.hubHostTlsCertState, 'expiring-soon');
  assert.equal(snapshot.hub.runtime.hubClientCustomCaConfigured, false);

  const sanitized = sanitizeDiagnosticSnapshot({
    ...snapshot,
    hub: {
      ...snapshot.hub,
      runtime: {
        ...snapshot.hub.runtime,
        hubHostTlsCertPath: '/etc/letsencrypt/live/corp.internal/fullchain.pem',
        hubHostTlsMode: 'evil-injected-value'
      }
    }
  });
  assert.equal(sanitized.hub.runtime.hubHostTlsMode, 'none');
  const report = formatDiagnosticReport(sanitized);
  assert.equal(report.text.includes('secret-private'), false);
  assert.equal(report.text.includes('internal-corp'), false);
  assert.equal(report.text.includes('letsencrypt'), false);
  assert.match(report.text, /hubHostTlsEnabled: true/);
  assert.match(report.text, /hubHostTlsMinVersion: TLSv1\.3/);
  assert.match(report.text, /hubHostTlsCertState: expiring-soon/);
});

test('probeHubBuild sends Bearer authorization and historySource honors custom CA over HTTPS', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-probe-https-'));
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    return resetHubClientFetchCache();
  });

  const pki = generateLocalPki(dir);
  const server = https.createServer({
    cert: pki.leafCertPem,
    key: pki.leafKeyPem,
    minVersion: 'TLSv1.2'
  }, (req, res) => {
    const authed = req.headers.authorization === 'Bearer probe-secret';
    if (req.url === '/api/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(authed
        ? { ok: true, role: 'hub', hubBuild: currentHubBuild('node-hub'), deployment: 'standalone' }
        : { ok: true }));
      return;
    }
    if (req.url === '/api/history') {
      if (!authed) { res.writeHead(401); res.end(); return; }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ daily: [{ date: '2026-11-24', tokens: 42 }], monthly: [], summary: {} }));
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

  const hubUrl = `https://127.0.0.1:${port}`;
  // Authenticated probe with custom CA reads full hubBuild
  const authedProbe = await probeHubBuild(hubUrl, { secret: 'probe-secret', caCertPem: pki.caCertPem });
  assert.equal(authedProbe.status, 'current');
  assert.equal(authedProbe.runtime, 'node-hub');

  // Unauthenticated probe gets minimal { ok: true } -> unavailable
  const unauthedProbe = await probeHubBuild(hubUrl, { caCertPem: pki.caCertPem });
  assert.equal(unauthedProbe.status, 'unavailable');

  // History resolver succeeds with custom CA and fails without it
  const history = await resolveCompleteHistory({ hubUrl, secret: 'probe-secret', caCertPem: pki.caCertPem });
  assert.equal(history.daily.length, 1);
  assert.equal(history.daily[0].tokens, 42);
  await assert.rejects(() => resolveCompleteHistory({ hubUrl, secret: 'probe-secret' }));
});

test('Local Bridge HTTP PUT /api/reports/integrations locks openclaw.queryPermissions while local IPC permits it', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-bridge-lock-'));
  let bridge = null;
  t.after(async () => {
    await bridge?.stop?.();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const net = require('node:net');
  const freePort = await new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });

  const credStore = new CredentialStore(dir);
  const settings = {
    hubMode: 'local',
    reportIntegrations: {
      ai: { enabled: false },
      openclaw: {
        enabled: true,
        localBridge: { enabled: true, port: freePort },
        queryPermissions: {
          allowSessionDetail: false,
          allowConversationText: false
        }
      }
    }
  };
  bridge = createOpenClawBridge({
    userDataDir: dir,
    getSettings: () => settings,
    getCredentialStore: () => credStore,
    getStats: () => ({ devices: [] })
  });

  // Local IPC update permits changing queryPermissions
  const localSaved = bridge.saveLocalIntegrations({
    openclaw: {
      enabled: true,
      localBridge: { enabled: true, port: freePort },
      queryPermissions: {
        allowSessionDetail: false,
        allowConversationText: false
      }
    }
  }, { allowQueryPermissionMutation: true });
  assert.equal(localSaved.ok, true);
  assert.equal(localSaved.openclaw.queryPermissions.allowSessionDetail, false);

  const status = await bridge.reconcile(settings.reportIntegrations);
  assert.equal(status.running, true);
  const token = credStore.readOpenClawLocalBridgeToken();

  // Remote/local HTTP attempt to escalate queryPermissions is rejected
  const res = await fetch(`${status.baseUrl}/api/reports/integrations`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      openclaw: {
        queryPermissions: {
          allowSessionDetail: true,
          allowConversationText: true
        }
      }
    })
  });
  assert.ok(res.status === 400 || res.status === 403, `expected 400/403, got ${res.status}`);
  const payload = await res.json();
  assert.equal(payload.ok, false);
  assert.equal(payload.error, 'query_permissions_locked');

  // Verify permissions stayed locked
  const current = bridge.getLocalIntegrationsStatus();
  assert.equal(current.openclaw.queryPermissions.allowSessionDetail, false);
  assert.equal(current.openclaw.queryPermissions.allowConversationText, false);
});

test('Electron preload, main window sandbox, and renderer TLS isolation contracts hold', () => {
  const preload = fs.readFileSync(path.join(__dirname, '../../src/electron/preload.js'), 'utf8');
  for (const field of [
    'hubHostTlsCertPath', 'hubHostTlsKeyPath', 'hubHostTlsCaPath', 'hubHostTlsPfxPath',
    'hubHostTlsMode', 'hubHostTlsCertMetadata', 'hubHostTlsPassphrase',
    'caCertPem', 'caFingerprintSha256', 'caSummary'
  ]) {
    assert.ok(preload.includes(field), `preload.js must strip ${field}`);
  }

  const main = fs.readFileSync(path.join(__dirname, '../../src/electron/main.js'), 'utf8');
  // All three main BrowserWindow definitions must enable sandbox: true
  const sandboxMatches = main.match(/contextIsolation:\s*true,\s*\n\s*nodeIntegration:\s*false,\s*\n\s*sandbox:\s*true/g) || [];
  assert.equal(sandboxMatches.length, 3, 'mainWindow, dashboardWindow, and antigravityManagerWindow must all set sandbox: true');

  // requestClientHubJson must not use hubReportsFetch (which uses Chromium net stack)
  const reqClientStart = main.indexOf('async function requestClientHubJson(');
  const reqClientEnd = main.indexOf('let localWeixinQrManager =', reqClientStart);
  const reqClientSrc = main.slice(reqClientStart, reqClientEnd);
  assert.equal(reqClientSrc.includes('hubReportsFetch'), false);
  assert.equal(reqClientSrc.includes('hubClientFetchFor'), true);

  // applySettingsPatch must re-source host TLS paths after spread
  assert.match(main, /hubHostTlsCertPath:\s*String\(settings\.hubHostTlsCertPath/);
  assert.match(main, /hubHostTlsKeyPath:\s*String\(settings\.hubHostTlsKeyPath/);
  assert.match(main, /hubHostTlsPfxPath:\s*String\(settings\.hubHostTlsPfxPath/);

  // Renderer app.js supports https:// scheme in hubAddressRow and maps TLS stream failures
  const appJs = fs.readFileSync(path.join(__dirname, '../../src/electron/renderer/app.js'), 'utf8');
  assert.match(appJs, /tls_untrusted:\s*'settings\.sync\.offline\.tlsUntrusted'/);
  assert.match(appJs, /const proto = scheme === 'https' \? 'https' : 'http'/);
});
