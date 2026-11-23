'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAntigravityManagerStore } = require('../src/electron/antigravityManager/store');
const { createAntigravityManagerService } = require('../src/electron/antigravityManager');
const oauth = require('../src/electron/antigravityManager/oauth');

test('store fails closed without overwriting unreadable or symlinked tokens.enc and keeps disabledAt null', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agm-store-safe-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const baseDir = path.join(dir, 'mgr');
  fs.mkdirSync(baseDir, { recursive: true });
  const tokensPath = path.join(baseDir, 'tokens.enc');
  const originalCiphertext = JSON.stringify({
    version: 1,
    mode: 'safeStorage',
    data: Buffer.from('encrypted-blob-bytes').toString('base64')
  });
  fs.writeFileSync(tokensPath, originalCiphertext, 'utf8');

  // Decrypt fails on startup -> store must refuse to overwrite tokens.enc
  const store = createAntigravityManagerStore({
    baseDir,
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (s) => Buffer.from(s, 'utf8'),
      decryptString: () => { throw new Error('keyring locked'); }
    },
    logger: { warn: () => {}, error: () => {} }
  });
  assert.throws(
    () => store.upsertAccount({ email: 'new@example.com' }, { refreshToken: '1//new-rt', accessToken: 'ya29.new' }),
    /Refusing to overwrite unreadable tokens store/
  );
  assert.equal(fs.readFileSync(tokensPath, 'utf8'), originalCiphertext);
  assert.equal(store.listAccounts().length, 0);

  // Healthy store: disabledAt must stay null (not 0), and blank name must not overwrite saved name
  const healthyStore = createAntigravityManagerStore({ baseDir: path.join(dir, 'healthy') });
  const acc = healthyStore.upsertAccount({ email: 'alice@example.com', name: 'Alice' }, { refreshToken: '1//a' });
  assert.equal(acc.disabledAt, null);
  const updated = healthyStore.upsertAccount({ email: 'alice@example.com', name: '' });
  assert.equal(updated.name, 'Alice');

  // Symlinked tokens.enc must fail closed without touching symlink target
  const linkBase = path.join(dir, 'symlink-mgr');
  fs.mkdirSync(linkBase, { recursive: true });
  const targetFile = path.join(dir, 'target-secret.txt');
  fs.writeFileSync(targetFile, 'do-not-overwrite', 'utf8');
  fs.symlinkSync(targetFile, path.join(linkBase, 'tokens.enc'));
  const symlinkStore = createAntigravityManagerStore({
    baseDir: linkBase,
    logger: { warn: () => {}, error: () => {} }
  });
  assert.throws(
    () => symlinkStore.saveAccountToken('id-1', { refreshToken: '1//x' }),
    /Refusing to overwrite unreadable tokens store/
  );
  assert.equal(fs.readFileSync(targetFile, 'utf8'), 'do-not-overwrite');
});

test('oauth ensureFreshToken adopts working fallback oauthClientKey and runOAuthLogin enforces GET/state/timeout', async () => {
  const env = {
    ANTIGRAVITY_OAUTH_CLIENT_ID: 'std-id',
    ANTIGRAVITY_OAUTH_CLIENT_SECRET: 'std-secret',
    ANTIGRAVITY_GCP_OAUTH_CLIENT_ID: 'gcp-id',
    ANTIGRAVITY_GCP_OAUTH_CLIENT_SECRET: 'gcp-secret'
  };
  let attempt = 0;
  const renewed = await oauth.ensureFreshToken(
    {
      accessToken: 'ya29.expired',
      refreshToken: '1//rt',
      expiryTimestamp: 1,
      oauthClientKey: oauth.BUILTIN_GCP_CLIENT_KEY
    },
    {
      env,
      nowSec: () => 10_000,
      fetch: async () => {
        attempt += 1;
        if (attempt === 1) {
          return new Response(JSON.stringify({ error: 'unauthorized_client' }), { status: 401 });
        }
        return new Response(JSON.stringify({ access_token: 'ya29.ok', expires_in: 3600 }), { status: 200 });
      }
    }
  );
  assert.equal(renewed.accessToken, 'ya29.ok');
  assert.equal(renewed.oauthClientKey, oauth.BUILTIN_ENTERPRISE_CLIENT_KEY);

  // runOAuthLogin times out cleanly and closes loopback server
  await assert.rejects(
    () => oauth.runOAuthLogin({
      env,
      timeoutMs: 30,
      openExternal: () => {}
    }),
    /OAuth login timed out/
  );

  // runOAuthLogin rejects POST (405), bad state (400), accepts valid state + code with Cache-Control: no-store
  let capturedAuthUrl = '';
  let callbackResult;
  const loginPromise = oauth.runOAuthLogin({
    env,
    timeoutMs: 5000,
    onAuthUrl: (url) => { capturedAuthUrl = url; },
    openExternal: async (urlStr) => {
      const parsed = new URL(urlStr);
      const redirectUri = parsed.searchParams.get('redirect_uri');
      const state = parsed.searchParams.get('state');
      const postRes = await fetch(redirectUri, { method: 'POST' });
      assert.equal(postRes.status, 405);
      const badStateRes = await fetch(`${redirectUri}?state=wrong&code=abc`);
      assert.equal(badStateRes.status, 400);
      const okRes = await fetch(`${redirectUri}?state=${encodeURIComponent(state)}&code=good-code`);
      assert.equal(okRes.status, 200);
      assert.equal(okRes.headers.get('cache-control'), 'no-store');
    },
    fetch: async (url) => {
      if (String(url).includes('/token')) {
        return new Response(JSON.stringify({
          access_token: 'ya29.login',
          refresh_token: '1//login-rt',
          expires_in: 3600
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ email: 'oauth@example.com', name: 'OAuth User' }), { status: 200 });
    }
  });
  callbackResult = await loginPromise;
  assert.ok(capturedAuthUrl.includes('code_challenge_method=S256'));
  assert.equal(callbackResult.identity.email, 'oauth@example.com');
  assert.equal(callbackResult.token.refreshToken, '1//login-rt');
});

test('service hub sync uses separate hubFetch with redirect:error, publishes banCode, and refreshes notify state cleanly', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agm-svc-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const providerCalls = [];
  const hubCalls = [];
  const stateUpdates = [];

  const service = createAntigravityManagerService({
    baseDir: path.join(dir, 'mgr'),
    fetch: async (url) => {
      providerCalls.push(String(url));
      if (String(url).includes('loadCodeAssist')) {
        return new Response(JSON.stringify({ currentTier: { id: 'pro-tier' } }), { status: 200 });
      }
      if (String(url).includes('fetchAvailableModels')) {
        return new Response(JSON.stringify({
          error: { message: 'Account suspended due to TOS_VIOLATION' }
        }), { status: 403 });
      }
      return new Response(JSON.stringify({ groups: [] }), { status: 200 });
    },
    hubFetch: async (url, init) => {
      hubCalls.push({ url: String(url), init });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
    getDeviceIdentity: () => ({ deviceId: 'dev-1', hostname: 'box' }),
    getHubSyncTarget: () => ({ mode: 'client', hubUrl: 'http://127.0.0.1:17321', secret: 'sec' }),
    onStateChanged: (nextState) => {
      stateUpdates.push({
        isRefreshing: nextState.isRefreshing,
        lastRefreshAt: nextState.lastRefreshAt
      });
    }
  });
  t.after(() => service.stop());

  // Seed one account via store-compatible import
  const seedDir = path.join(dir, 'seed');
  fs.mkdirSync(path.join(seedDir, 'accounts'), { recursive: true });
  fs.writeFileSync(path.join(seedDir, 'accounts', 'a1.json'), JSON.stringify({
    email: 'user@example.com',
    token: {
      access_token: 'ya29.valid',
      refresh_token: '1//valid-rt',
      expiry_timestamp: Math.floor(Date.now() / 1000) + 7200
    }
  }));
  service.importDataDir(seedDir);
  stateUpdates.length = 0;

  // Refresh triggers 403 ban classification and notifies isRefreshing: true -> false with updated lastRefreshAt
  const refreshRes = await service.refreshAccounts();
  assert.equal(refreshRes.ok, true);
  assert.equal(stateUpdates[0].isRefreshing, true);
  assert.equal(stateUpdates.at(-1).isRefreshing, false);
  assert.ok(stateUpdates.at(-1).lastRefreshAt > 0);
  assert.ok(providerCalls.some((u) => u.includes('fetchAvailableModels')));

  // Hub snapshot push uses hubFetch (NOT provider fetch), enforces redirect: 'error', and includes banCode without tokens
  const pushRes = await service.pushSnapshotToHubNow();
  assert.equal(pushRes.ok, true);
  assert.equal(hubCalls.length, 1);
  assert.equal(hubCalls[0].init.redirect, 'error');
  const body = JSON.parse(hubCalls[0].init.body);
  assert.equal(body.accounts[0].banned, true);
  assert.equal(body.accounts[0].banCode, 'TOS_VIOLATION');
  assert.equal(hubCalls[0].init.body.includes('1//valid-rt'), false);

  // detectActiveClients returns a boolean defaultDataDirExists
  const active = service.detectActiveClients();
  assert.equal(typeof active.defaultDataDirExists, 'boolean');

  // setAccountDisabled sets and clears disabledAt cleanly
  const accountId = service.getState().accounts[0].id;
  const disRes = service.setAccountDisabled(accountId, true);
  assert.equal(disRes.ok, true);
  assert.equal(disRes.account.disabled, true);
  assert.ok(Number.isFinite(disRes.account.disabledAt) && disRes.account.disabledAt > 0);
  const enRes = service.setAccountDisabled(accountId, false);
  assert.equal(enRes.ok, true);
  assert.equal(enRes.account.disabled, false);
  assert.equal(enRes.account.disabledAt, null);
});

test('service switchAccountTo enforces single-flight lock against concurrent switches', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agm-svc-lock-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  /** @type {() => void} */
  let releaseFetch = () => {};
  const fetchGate = new Promise((resolve) => { releaseFetch = resolve; });

  const service = createAntigravityManagerService({
    baseDir: path.join(dir, 'mgr'),
    fetch: async () => {
      await fetchGate;
      return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
    }
  });
  t.after(() => service.stop());

  // Import an expired token so switchAccountTo awaits OAuth refresh in-flight
  const seedDir = path.join(dir, 'seed');
  fs.mkdirSync(path.join(seedDir, 'accounts'), { recursive: true });
  fs.writeFileSync(path.join(seedDir, 'accounts', 'a1.json'), JSON.stringify({
    email: 'lock@example.com',
    token: { access_token: 'ya29.old', refresh_token: '1//old-rt', expiry_timestamp: 1 }
  }));
  service.importDataDir(seedDir);
  const id = service.getState().accounts[0].id;

  const first = service.switchAccountTo(id, 'classic');
  const second = await service.switchAccountTo(id, 'classic');
  assert.equal(second.ok, false);
  assert.match(second.error, /already in progress/i);

  releaseFetch();
  const firstRes = await first;
  assert.equal(firstRes.ok, false);
});
