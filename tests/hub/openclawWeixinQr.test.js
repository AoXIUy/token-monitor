'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createWeixinQrLoginManager,
  normalizeWeixinAccountId
} = require('../../src/shared/openclawWeixinQr');
const {
  configureOpenClawHost,
  detectOpenClawEnvironment,
  parseOpenClawJson5,
  persistWeixinBinding,
  readLocalWeixinTokens,
  readOpenClawHookSecrets
} = require('../../src/hub/openclawProvisioner');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('createWeixinQrLoginManager handles iLink headers, redirect, verify_code, refresh, binded_redirect, and confirmed', async () => {
  const requests = [];
  let statusQueue = [
    { status: 'wait' },
    { status: 'scaned' },
    { status: 'scaned_but_redirect', redirect_host: 'idc2.weixin.qq.com' },
    { status: 'need_verifycode' },
    { status: 'need_verifycode' },
    {
      status: 'confirmed',
      bot_token: 'bot-tok-secret-999',
      ilink_bot_id: 'B0F5860FDECB@im.bot',
      baseurl: 'https://idc2.weixin.qq.com',
      ilink_user_id: 'user_abc123@im.wechat'
    }
  ];

  const fetchImpl = async (url, init = {}) => {
    const target = String(url);
    requests.push({ url: target, method: init.method, headers: init.headers, body: init.body });
    if (target.includes('/ilink/bot/get_bot_qrcode')) {
      return new Response(JSON.stringify({
        qrcode: 'qrc-1',
        qrcode_img_content: 'https://liteapp.weixin.qq.com/q/test?qrcode=qrc-1&bot_type=3'
      }), { status: 200 });
    }
    if (target.includes('/ilink/bot/get_qrcode_status')) {
      const next = statusQueue.shift() || { status: 'wait' };
      return new Response(JSON.stringify(next), { status: 200 });
    }
    throw new Error(`Unexpected URL: ${target}`);
  };

  const manager = createWeixinQrLoginManager({
    fetchImpl,
    getLocalTokens: () => ['old-token-1'],
    pollTimeoutMs: 5000
  });

  const started = await manager.start();
  assert.equal(started.ok, true);
  assert.equal(started.status, 'wait');
  assert.equal(started.qrcodeImgContent, 'https://liteapp.weixin.qq.com/q/test?qrcode=qrc-1&bot_type=3');

  const qrPost = requests[0];
  assert.equal(qrPost.method, 'POST');
  assert.equal(qrPost.url, 'https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=3');
  assert.equal(qrPost.headers['iLink-App-Id'], 'bot');
  assert.ok(Number(qrPost.headers['iLink-App-ClientVersion']) > 0);
  assert.equal(qrPost.headers.AuthorizationType, 'ilink_bot_token');
  assert.ok(qrPost.headers['X-WECHAT-UIN']);
  assert.deepEqual(JSON.parse(qrPost.body), { local_token_list: ['old-token-1'] });

  assert.equal((await manager.pollStatus(started.sessionId)).status, 'wait');
  assert.equal((await manager.pollStatus(started.sessionId)).status, 'scaned');

  const redirected = await manager.pollStatus(started.sessionId);
  assert.equal(redirected.status, 'scaned_but_redirect');
  assert.equal(redirected.redirected, true);

  const needCode = await manager.pollStatus(started.sessionId);
  assert.equal(needCode.status, 'need_verifycode');
  assert.equal(needCode.verifyCodeIncorrect, false);
  // Previous poll targeted redirected IDC host.
  assert.ok(requests.at(-1).url.startsWith('https://idc2.weixin.qq.com/ilink/bot/get_qrcode_status?qrcode=qrc-1'));

  assert.equal(manager.submitVerifyCode(started.sessionId, '1111').ok, true);
  const wrongCode = await manager.pollStatus(started.sessionId);
  assert.equal(wrongCode.status, 'need_verifycode');
  assert.equal(wrongCode.verifyCodeIncorrect, true);
  assert.ok(requests.at(-1).url.includes('&verify_code=1111'));

  assert.equal(manager.submitVerifyCode(started.sessionId, '4321').ok, true);
  const confirmed = await manager.pollStatus(started.sessionId);
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.status, 'confirmed');
  assert.equal(confirmed.connected, true);
  assert.equal(confirmed.accountId, 'b0f5860fdecb-im-bot');
  assert.equal(confirmed.rawAccountId, 'B0F5860FDECB@im.bot');
  assert.equal(confirmed.userId, 'user_abc123@im.wechat');
  assert.equal(confirmed.botToken, 'bot-tok-secret-999');
  assert.equal(confirmed.baseUrl, 'https://idc2.weixin.qq.com');
});

test('createWeixinQrLoginManager handles AbortError/524 timeouts, bounded QR refresh, binded_redirect, and cancel', async () => {
  let qrCounter = 0;
  let pollMode = 'abort';
  const fetchImpl = async (url, init = {}) => {
    const target = String(url);
    if (target.includes('/ilink/bot/get_bot_qrcode')) {
      qrCounter += 1;
      return new Response(JSON.stringify({
        qrcode: `qrc-${qrCounter}`,
        qrcode_img_content: `https://liteapp.weixin.qq.com/q/${qrCounter}`
      }), { status: 200 });
    }
    if (pollMode === 'abort') {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    }
    if (pollMode === '524') {
      return new Response('gateway timeout', { status: 524 });
    }
    if (pollMode === 'expired') {
      return new Response(JSON.stringify({ status: 'expired' }), { status: 200 });
    }
    if (pollMode === 'binded') {
      return new Response(JSON.stringify({ status: 'binded_redirect' }), { status: 200 });
    }
    if (pollMode === 'hang') {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        }, { once: true });
      });
    }
    return new Response(JSON.stringify({ status: 'wait' }), { status: 200 });
  };

  const manager = createWeixinQrLoginManager({ fetchImpl, maxRefreshCount: 2 });
  const s1 = await manager.start();
  assert.equal((await manager.pollStatus(s1.sessionId)).status, 'wait');
  pollMode = '524';
  assert.equal((await manager.pollStatus(s1.sessionId)).status, 'wait');

  pollMode = 'expired';
  const r1 = await manager.pollStatus(s1.sessionId);
  assert.equal(r1.ok, true);
  assert.equal(r1.refreshed, true);
  assert.equal(r1.refreshCount, 1);
  assert.equal(r1.qrcodeImgContent, 'https://liteapp.weixin.qq.com/q/2');

  const r2 = await manager.pollStatus(s1.sessionId);
  assert.equal(r2.ok, true);
  assert.equal(r2.refreshCount, 2);

  const r3 = await manager.pollStatus(s1.sessionId);
  assert.equal(r3.ok, false);
  assert.equal(r3.error, 'qr_expired');

  pollMode = 'binded';
  const s2 = await manager.start();
  const binded = await manager.pollStatus(s2.sessionId);
  assert.equal(binded.ok, true);
  assert.equal(binded.status, 'binded_redirect');
  assert.equal(binded.alreadyConnected, true);

  pollMode = 'hang';
  const s3 = await manager.start();
  const pendingPoll = manager.pollStatus(s3.sessionId);
  manager.cancel(s3.sessionId);
  const cancelled = await pendingPoll;
  assert.equal(cancelled.ok, false);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(normalizeWeixinAccountId('Abc_12@im.bot'), 'abc_12-im-bot');
});

test('openclawProvisioner parses JSON5, persists WeChat bindings with stale-user pruning, and provisions hooks + skill', async () => {
  const rootDir = makeTempDir('tm-openclaw-prov-');
  const dir = path.join(rootDir, '.openclaw');
  const env = { OPENCLAW_STATE_DIR: dir };

  try {
    const emptyEnvDefault = await detectOpenClawEnvironment({ env, probeGateway: false, cliPath: null });
    assert.equal(emptyEnvDefault.stateDir, undefined);
    assert.equal(emptyEnvDefault.cliPath, undefined);
    const emptyEnv = await detectOpenClawEnvironment({ env, probeGateway: false, cliPath: null, includePaths: true });
    assert.equal(emptyEnv.stateDir, dir);
    assert.equal(emptyEnv.stateDirExists, false);
    assert.equal(emptyEnv.gatewayPort, 18789);
    assert.equal(emptyEnv.suggestedWebhookUrl, 'http://127.0.0.1:18789/hooks/agent');

    // Existing JSON5 openclaw.json with comments & trailing commas.
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'openclaw.json'), `{
      // Gateway port
      gateway: { port: 19123, },
      hooks: {
        enabled: true,
        path: '/custom-hooks/',
        token: 'secret-hook-123',
      },
    }`, 'utf8');

    const parsedJson5 = parseOpenClawJson5(fs.readFileSync(path.join(dir, 'openclaw.json'), 'utf8'));
    assert.equal(parsedJson5.gateway.port, 19123);

    // Persist first account, then re-bind same userId -> stale account pruned.
    persistWeixinBinding({
      accountId: 'old-bot-im-bot',
      botToken: 'tok-old',
      baseUrl: 'https://ilinkai.weixin.qq.com',
      userId: 'same-user@im.wechat'
    }, { env });
    persistWeixinBinding({
      accountId: 'new-bot-im-bot',
      botToken: 'tok-new',
      baseUrl: 'https://idc.example.com',
      userId: 'same-user@im.wechat'
    }, { env });

    const index = JSON.parse(fs.readFileSync(path.join(dir, 'openclaw-weixin', 'accounts.json'), 'utf8'));
    assert.deepEqual(index, ['new-bot-im-bot']);
    assert.equal(fs.existsSync(path.join(dir, 'openclaw-weixin', 'accounts', 'old-bot-im-bot.json')), false);
    assert.deepEqual(readLocalWeixinTokens({ env }), ['tok-new']);

    // Provision without CLI -> updates openclaw.json and copies bundled skill.
    const provNoCli = await configureOpenClawHost(
      { ensureHooks: true, installSkill: true, restartGateway: false },
      { env, probeGateway: false, cliPath: null }
    );
    assert.equal(provNoCli.ok, true);
    assert.equal(provNoCli.steps.hooksConfigured, true);
    assert.equal(provNoCli.steps.skillInstalled, true);
    assert.equal(provNoCli.resolvedHookToken, 'secret-hook-123');
    assert.equal(provNoCli.webhookUrl, 'http://127.0.0.1:19123/custom-hooks/agent');
    assert.equal(fs.existsSync(path.join(dir, 'skills', 'openclaw-token-monitor', 'SKILL.md')), true);
    assert.equal(fs.existsSync(path.join(dir, 'skills', 'openclaw-token-monitor', 'scripts', 'query-token-monitor.mjs')), true);

    // Detection never exposes raw tokens.
    const detected = await detectOpenClawEnvironment({ env, probeGateway: true, probePort: async () => true, cliPath: null });
    assert.equal(detected.hooksEnabled, true);
    assert.equal(detected.hooksTokenConfigured, true);
    assert.equal(detected.gatewayPort, 19123);
    assert.equal(detected.gatewayReachable, true);
    assert.equal(detected.accounts.length, 1);
    assert.equal(detected.accounts[0].accountId, 'new-bot-im-bot');
    assert.equal(detected.accounts[0].userId, 'same-user@im.wechat');
    assert.equal(JSON.stringify(detected).includes('tok-new'), false);
    assert.equal(JSON.stringify(detected).includes('secret-hook-123'), false);
    assert.equal(readOpenClawHookSecrets({ env }).hookToken, 'secret-hook-123');

    // Provision writes openclaw.json directly (never passing secrets via `config set` CLI argv) & invokes `gateway restart`.
    const cliCalls = [];
    const provWithCli = await configureOpenClawHost(
      { ensureHooks: true, installSkill: false, restartGateway: true },
      {
        env,
        probeGateway: false,
        cliPath: '/usr/local/bin/openclaw',
        execFileImpl: async (_cli, args) => {
          cliCalls.push(args);
          return { stdout: 'ok', stderr: '' };
        }
      }
    );
    assert.equal(provWithCli.steps.gatewayRestarted, true);
    assert.equal(provWithCli.steps.hooksConfigured, true);
    assert.equal(cliCalls.some((a) => a[0] === 'config' && a[1] === 'set'), false);
    assert.deepEqual(cliCalls, [['gateway', 'restart']]);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});
