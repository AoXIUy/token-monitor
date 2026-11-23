'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAntigravityManagerStore } = require('../src/electron/antigravityManager/store');
const keyring = require('../src/electron/antigravityManager/keyring');
const processManager = require('../src/electron/antigravityManager/processManager');
const switcher = require('../src/electron/antigravityManager/switcher');

test('resolveEffectiveTarget and classifyProcess honor safety exclusions and Classic-first priority', () => {
  assert.equal(
    processManager.classifyProcess('token-monitor', '/opt/token-monitor/token-monitor', 'token-monitor', ''),
    'manager'
  );
  assert.equal(
    processManager.classifyProcess('Antigravity Tools', '/Applications/Antigravity-Manager.app/Contents/MacOS/antigravity-tools', 'antigravity-tools', ''),
    'manager'
  );
  assert.equal(
    processManager.classifyProcess('language_server_linux_x64', '/usr/bin/antigravity/language_server', 'language_server', '--antigravity'),
    'language_server'
  );
  assert.equal(
    processManager.classifyProcess('agy', '/usr/local/bin/agy', 'agy', 'chat'),
    'agy'
  );

  assert.deepEqual(
    switcher.resolveEffectiveTarget('auto', { classicRunning: false, ideRunning: true, hasClassicExe: true, ideExePath: '/opt/antigravity-ide' }),
    { isIde: true, effectiveTarget: 'ide' }
  );
  assert.deepEqual(
    switcher.resolveEffectiveTarget('auto', { classicRunning: true, ideRunning: true, hasClassicExe: true, ideExePath: '/opt/antigravity-ide' }),
    { isIde: false, effectiveTarget: null }
  );
  assert.deepEqual(
    switcher.resolveEffectiveTarget('classic', { classicRunning: false, ideRunning: true, hasClassicExe: false }),
    { isIde: false, effectiveTarget: 'classic' }
  );
});

test('pickBestAccount filters abnormal accounts and selects highest average remaining quota', () => {
  const accounts = [
    { id: '1', email: 'banned@example.com', banned: true, hasToken: true, subscriptionTier: 'ULTRA', quota: { models: [{ percentage: 100 }] } },
    { id: '2', email: 'verify@example.com', validationBlocked: true, hasToken: true, subscriptionTier: 'ULTRA', quota: { models: [{ percentage: 100 }] } },
    { id: '3', email: 'low@example.com', hasToken: true, subscriptionTier: 'PRO', quota: { models: [{ percentage: 25 }] } },
    { id: '4', email: 'best@example.com', hasToken: true, subscriptionTier: 'PRO', quota: { models: [{ percentage: 90 }, { percentage: 80 }] } },
    { id: '5', email: 'best-tied@example.com', hasToken: true, subscriptionTier: 'ULTRA', quota: { models: [{ percentage: 85 }] } }
  ];
  const best = switcher.pickBestAccount(accounts);
  assert.equal(best.id, '5');
});

test('switchAccount performs hot-switch, fallback restart, AGY CLI, and ACP target writes with mocked deps', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agm-switch-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const store = createAntigravityManagerStore({ baseDir: path.join(dir, 'store') });
  const saved = store.upsertAccount(
    {
      email: 'alice@example.com',
      subscriptionTier: 'ULTRA',
      deviceProfile: {
        machineId: 'auth0|user_mock',
        macMachineId: 'mac-mock',
        devDeviceId: 'dev-mock',
        sqmId: '{SQM-MOCK}'
      }
    },
    {
      accessToken: 'ya29.fresh',
      refreshToken: '1//fresh-rt',
      expiryTimestamp: Math.floor(Date.now() / 1000) + 7200
    }
  );
  const tokenData = store.getAccountToken(saved.id);

  // Hot switch on running IDE
  const injectedCalls = [];
  let killedLsCount = 0;
  const hotRes = await switcher.switchAccount({
    account: saved,
    tokenData,
    targetClient: 'ide',
    store,
    deps: {
      oauth: { ensureFreshToken: async (tok) => tok },
      stateDb: {
        getDbPath: () => path.join(dir, 'ide', 'state.vscdb'),
        injectTokenToDb: (dbPath, payload) => injectedCalls.push({ dbPath, email: payload.email }),
        writeServiceMachineId: () => {}
      },
      deviceProfile: {
        getStoragePath: () => path.join(dir, 'ide', 'storage.json'),
        readDeviceProfile: () => null,
        writeDeviceProfile: () => {},
        generateDeviceProfile: () => saved.deviceProfile
      },
      keyring: { writeToSystemKeyring: () => {}, readFromSystemKeyring: () => tokenData },
      fileCredentials: { writeFileCredentials: () => {}, writeAcpCredentials: () => {} },
      processManager: {
        isAntigravityRunning: (target) => target === 'ide',
        getAntigravityExecutablePath: () => '/usr/bin/antigravity-ide',
        getArgsFromRunningProcess: () => ['--reuse-window'],
        killLanguageServer: () => { killedLsCount += 1; return 1; },
        waitForLanguageServerRespawn: async () => true
      }
    }
  });
  assert.equal(hotRes.ok, true);
  assert.equal(hotRes.target, 'ide');
  assert.equal(hotRes.mode, 'hot');
  assert.equal(killedLsCount, 1);
  assert.ok(injectedCalls.length >= 1);
  assert.equal(store.getStateForRenderer().activeAccounts.ide, saved.id);

  // AGY CLI switch
  let syncedCli = false;
  const agyRes = await switcher.switchAccount({
    account: saved,
    tokenData,
    targetClient: 'agy',
    store,
    deps: {
      oauth: { ensureFreshToken: async (tok) => tok },
      deviceProfile: { getStoragePath: () => '' },
      keyring: {
        writeToSystemKeyring: () => {},
        readFromSystemKeyring: () => ({ refreshToken: '1//fresh-rt' })
      },
      fileCredentials: {
        writeFileCredentials: (_tok, opts) => { syncedCli = Boolean(opts?.syncAgyCli); }
      }
    }
  });
  assert.equal(agyRes.ok, true);
  assert.equal(agyRes.target, 'agy');
  assert.equal(syncedCli, true);
  assert.equal(store.getStateForRenderer().activeAccounts.agy, saved.id);

  // ACP switch
  let acpKilled = 0;
  let acpFileWritten = false;
  const acpRes = await switcher.switchAccount({
    account: saved,
    tokenData,
    targetClient: 'acp',
    store,
    deps: {
      oauth: { ensureFreshToken: async (tok) => tok },
      deviceProfile: { getStoragePath: () => '' },
      keyring: { ACP_ACCOUNT: 'antigravity-acp', writeToSystemKeyring: () => {} },
      fileCredentials: { writeAcpCredentials: () => { acpFileWritten = true; } },
      processManager: { killAcpServers: () => { acpKilled = 2; return 2; } }
    }
  });
  assert.equal(acpRes.ok, true);
  assert.equal(acpRes.target, 'acp');
  assert.equal(acpFileWritten, true);
  assert.equal(acpKilled, 2);
  assert.equal(store.getStateForRenderer().activeAccounts.acp, saved.id);
});

test('Windows keyring Koffi bindings use anonymous structs and never collide with global FILETIME / CREDENTIALW', () => {
  const realKoffi = require('koffi');
  try {
    realKoffi.struct('FILETIME', { dwLowDateTime: 'uint32_t', dwHighDateTime: 'uint32_t' });
  } catch (_) {}
  try {
    realKoffi.struct('CREDENTIALW', { Flags: 'uint32_t' });
  } catch (_) {}

  const registeredCalls = [];
  const wrappedKoffi = {
    struct: (...args) => realKoffi.struct(...args),
    pointer: (...args) => realKoffi.pointer(...args),
    out: (...args) => realKoffi.out(...args),
    sizeof: (...args) => realKoffi.sizeof(...args),
    encode: (...args) => realKoffi.encode(...args),
    decode: (...args) => realKoffi.decode(...args),
    load: (dllName) => ({
      func: (conv, name, ret, params) => {
        registeredCalls.push({ dllName, conv, name, ret, params });
        return () => 1;
      }
    })
  };

  const api = keyring.createWin32CredApi(wrappedKoffi);
  assert.ok(api.CREDENTIALW);
  assert.equal(realKoffi.sizeof(api.CREDENTIALW), 80);
  assert.ok(registeredCalls.some((c) => c.dllName === 'advapi32.dll' && c.name === 'CredWriteW' && c.conv === '__stdcall'));
  assert.ok(registeredCalls.some((c) => c.dllName === 'advapi32.dll' && c.name === 'CredReadW' && c.conv === '__stdcall'));

  const secretBuf = Buffer.from(keyring.serializeKeyringPayload({
    accessToken: 'ya29.win',
    refreshToken: '1//win-rt',
    expiryTimestamp: 1800000000,
    email: 'win@example.com'
  }), 'utf8');
  const rawStruct = Buffer.alloc(realKoffi.sizeof(api.CREDENTIALW));
  realKoffi.encode(rawStruct, api.CREDENTIALW, {
    Flags: 0,
    Type: 1,
    TargetName: 'gemini:antigravity',
    Comment: null,
    LastWritten: { dwLowDateTime: 0, dwHighDateTime: 0 },
    CredentialBlobSize: secretBuf.length,
    CredentialBlob: secretBuf,
    Persist: 2,
    AttributeCount: 0,
    Attributes: null,
    TargetAlias: null,
    UserName: 'antigravity'
  });
  const decoded = realKoffi.decode(rawStruct, api.CREDENTIALW);
  assert.equal(decoded.TargetName, 'gemini:antigravity');
  assert.equal(decoded.UserName, 'antigravity');
  assert.equal(decoded.CredentialBlobSize, secretBuf.length);

  // Oversized idToken (> 2560 bytes) drops optional id_token on Windows CredWriteW
  let writtenBuf = null;
  keyring.writeToSystemKeyring(
    {
      accessToken: 'ya29.win',
      refreshToken: '1//win-rt',
      expiryTimestamp: 1800000000,
      email: 'win@example.com',
      idToken: 'x'.repeat(3000)
    },
    {
      platform: 'win32',
      win32Cred: {
        write: (_target, _user, buf) => {
          writtenBuf = buf;
        }
      }
    }
  );
  assert.ok(writtenBuf && writtenBuf.length <= keyring.WIN32_CRED_MAX_BLOB_BYTES);
  const parsed = keyring.parseKeyringPayload(writtenBuf.toString('utf8'));
  assert.equal(parsed?.refreshToken, '1//win-rt');
});

test('Windows processManager uses UTF-8 PowerShell, filters Chromium helpers, finds custom paths, and cleans launch env', async () => {
  let psCommand = '';
  const winProcs = processManager.listProcesses({
    platform: 'win32',
    execFileSync: (_cmd, args) => {
      psCommand = String(args?.[3] || '');
      return '\uFEFF' + JSON.stringify([
        {
          ProcessId: 2001,
          Name: 'Antigravity.exe',
          ExecutablePath: 'C:\\Users\\雨娇\\AppData\\Local\\Programs\\Antigravity\\Antigravity.exe',
          CommandLine: '"C:\\Users\\雨娇\\AppData\\Local\\Programs\\Antigravity\\Antigravity.exe" --type=renderer --mojo-platform-channel-handle=42 --field-trial-handle=99'
        },
        {
          ProcessId: 2000,
          Name: 'Antigravity.exe',
          ExecutablePath: 'C:\\Users\\雨娇\\AppData\\Local\\Programs\\Antigravity\\Antigravity.exe',
          CommandLine: '"C:\\Users\\雨娇\\AppData\\Local\\Programs\\Antigravity\\Antigravity.exe" --user-data-dir="C:\\Users\\雨娇\\AppData\\Roaming\\Antigravity"'
        },
        {
          ProcessId: 2003,
          Name: 'Antigravity.exe',
          ExecutablePath: 'C:\\Users\\雨娇\\AppData\\Local\\Programs\\Antigravity\\Antigravity.exe',
          CommandLine: '"C:\\Users\\雨娇\\AppData\\Local\\Programs\\Antigravity\\Antigravity.exe" --standalone'
        },
        {
          ProcessId: 2002,
          Name: 'language_server_windows_x64.exe',
          ExecutablePath: 'C:\\Users\\雨娇\\AppData\\Local\\Programs\\Antigravity\\resources\\language_server_windows_x64.exe',
          CommandLine: '"language_server_windows_x64.exe" --antigravity'
        }
      ]);
    }
  });
  assert.ok(psCommand.includes('OutputEncoding = [System.Text.Encoding]::UTF8'));
  assert.equal(winProcs.length, 4);

  // Renderer & --standalone engine helpers are skipped; main process args are preserved with clean quotes
  const launchArgs = processManager.getArgsFromRunningProcess('classic', { listProcesses: () => winProcs });
  assert.deepEqual(launchArgs, ['--user-data-dir=C:\\Users\\雨娇\\AppData\\Roaming\\Antigravity']);
  assert.deepEqual(processManager.sanitizeRestartArgs(['--standalone', '--type=gpu-process', '--reuse-window']), ['--reuse-window']);

  // Registry fallback finds custom-drive Windows install when standard folders miss
  const regExe = processManager.getAntigravityExecutablePath('classic', {
    platform: 'win32',
    env: { LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local', ProgramFiles: 'C:\\Program Files', PATH: '' },
    listProcesses: () => [],
    fs: { existsSync: (p) => p === 'D:\\Apps\\Antigravity\\Antigravity.exe' },
    execFileSync: () => JSON.stringify([{
      DisplayName: 'Antigravity',
      InstallLocation: 'D:\\Apps\\Antigravity',
      DisplayIcon: '"D:\\Apps\\Antigravity\\Antigravity.exe",0'
    }])
  });
  assert.equal(regExe, 'D:\\Apps\\Antigravity\\Antigravity.exe');

  // startAntigravity sets cwd, strips ELECTRON_RUN_AS_NODE / NODE_OPTIONS, and sanitizes Chromium flags
  const spawned = [];
  processManager.startAntigravity(
    'classic',
    'D:\\Apps\\Antigravity\\Antigravity.exe',
    ['--type=renderer', '--mojo-platform-channel-handle=7', '--reuse-window'],
    {
      platform: 'win32',
      env: { PATH: 'C:\\Windows', ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '--inspect' },
      spawn: (cmd, args, opts) => {
        spawned.push({ cmd, args, opts });
        return { on: () => {}, unref: () => {} };
      }
    }
  );
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].cmd, 'D:\\Apps\\Antigravity\\Antigravity.exe');
  assert.deepEqual(spawned[0].args, ['--reuse-window']);
  assert.equal(spawned[0].opts.cwd, 'D:\\Apps\\Antigravity');
  assert.equal(spawned[0].opts.detached, true);
  assert.equal(spawned[0].opts.windowsHide, false);
  assert.equal(spawned[0].opts.env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(spawned[0].opts.env.NODE_OPTIONS, undefined);

  // closeAntigravity on Windows force-kills PIDs and sweeps orphan language_server
  const killed = [];
  let listCount = 0;
  await processManager.closeAntigravity(20, 'classic', {
    platform: 'win32',
    listProcesses: () => {
      listCount += 1;
      if (listCount === 1) return winProcs;
      if (listCount === 2) return [];
      return [winProcs[3]];
    },
    terminatePid: (pid, force) => {
      killed.push({ pid, force });
      return true;
    },
    sleep: async () => {}
  });
  assert.ok(killed.some((k) => k.pid === 2000 && k.force === true));
  assert.ok(killed.some((k) => k.pid === 2001 && k.force === true));
  assert.ok(killed.some((k) => k.pid === 2002 && k.force === true));
});

test('POSIX processManager parses spaced executable paths, isolates Classic/IDE language servers, and ignores unreaped killed PIDs', async (t) => {
  const fileCredentials = require('../src/electron/antigravityManager/fileCredentials');

  // macOS ps with spaced `Antigravity IDE.app` path in both comm= and args=
  const macProcs = processManager.listProcesses({
    platform: 'darwin',
    execFileSync: (_cmd, args) => {
      if (args?.[1] === 'pid=,comm=') {
        return [
          '  501 /Applications/Antigravity IDE.app/Contents/MacOS/Antigravity IDE',
          '  502 /Applications/Antigravity IDE.app/Contents/Frameworks/Antigravity IDE Helper (Renderer).app/Contents/MacOS/Antigravity IDE Helper (Renderer)',
          '  503 /Applications/Antigravity.app/Contents/Resources/app/extensions/antigravity/bin/language_server_macos_arm',
          '  504 /Applications/Antigravity IDE.app/Contents/Resources/app/extensions/antigravity/bin/language_server_macos_arm'
        ].join('\n');
      }
      return [
        '  501 /Applications/Antigravity IDE.app/Contents/MacOS/Antigravity IDE --reuse-window --user-data-dir="/Users/me/Library/Application Support/Antigravity IDE" "/Users/me/project"',
        '  502 /Applications/Antigravity IDE.app/Contents/Frameworks/Antigravity IDE Helper (Renderer).app/Contents/MacOS/Antigravity IDE Helper (Renderer) --type=renderer',
        '  503 /Applications/Antigravity.app/Contents/Resources/app/extensions/antigravity/bin/language_server_macos_arm --antigravity',
        '  504 /Applications/Antigravity IDE.app/Contents/Resources/app/extensions/antigravity/bin/language_server_macos_arm --antigravity'
      ].join('\n');
    }
  });
  const ideMain = macProcs.find((p) => p.pid === 501);
  assert.equal(ideMain.exePath, '/Applications/Antigravity IDE.app/Contents/MacOS/Antigravity IDE');
  assert.equal(processManager.classifyProcess(ideMain.name, ideMain.exePath, ideMain.argv0, ideMain.args), 'ide');
  assert.equal(
    processManager.getUserDataDirFromProcess('ide', { listProcesses: () => macProcs }),
    '/Users/me/Library/Application Support/Antigravity IDE'
  );
  // Stripping spaced exePath must not leak `IDE.app/...` or `IDE` as positional restart args
  const ideRestartArgs = processManager.getArgsFromRunningProcess('ide', { listProcesses: () => macProcs });
  assert.deepEqual(ideRestartArgs, [
    '--reuse-window',
    '--user-data-dir=/Users/me/Library/Application Support/Antigravity IDE',
    '/Users/me/project'
  ]);

  // killLanguageServer(null) targets Classic ONLY and must NOT kill IDE's language server (504)
  const killedPids = [];
  const killedClassic = processManager.killLanguageServer(null, {
    listProcesses: () => macProcs,
    terminatePid: (pid) => {
      killedPids.push(pid);
      return true;
    }
  });
  assert.equal(killedClassic, 1);
  assert.deepEqual(killedPids, [503]);

  // waitForLanguageServerRespawn ignores unreaped old PID 503 and resolves only when new PID 600 spawns
  let poll = 0;
  const respawned = await processManager.waitForLanguageServerRespawn(null, 2000, {
    excludePids: [503],
    listProcesses: () => {
      poll += 1;
      if (poll === 1) return [macProcs[2], macProcs[3]]; // old Classic 503 still unreaped + IDE 504
      return [{ ...macProcs[2], pid: 600 }, macProcs[3]];
    },
    sleep: async () => {}
  });
  assert.equal(respawned, true);
  assert.equal(poll, 2);

  // macOS startAntigravity resolves .app bundle even when an ancestor dir contains `.app`
  const macSpawned = [];
  processManager.startAntigravity(
    'ide',
    '/Users/dev/my.app.bundle/Antigravity IDE.app/Contents/MacOS/Antigravity IDE',
    ['--reuse-window'],
    {
      platform: 'darwin',
      spawn: (cmd, args) => {
        macSpawned.push({ cmd, args });
        return { on: () => {}, unref: () => {} };
      }
    }
  );
  assert.equal(macSpawned[0].cmd, 'open');
  assert.deepEqual(macSpawned[0].args, ['-a', '/Users/dev/my.app.bundle/Antigravity IDE.app', '--args', '--reuse-window']);

  // Windows keyring decodes UTF-16LE + trailing NUL buffers
  const utf16Payload = Buffer.from(
    `${keyring.serializeKeyringPayload({ accessToken: 'ya29.u16', refreshToken: '1//u16-rt', expiryTimestamp: 1800000000, email: 'u16@example.com' })}\0\0`,
    'utf16le'
  );
  const parsedU16 = keyring.readFromSystemKeyring({
    platform: 'win32',
    win32Cred: { read: () => utf16Payload }
  });
  assert.equal(parsedU16?.refreshToken, '1//u16-rt');
  assert.equal(parsedU16?.email, 'u16@example.com');

  // fileCredentials preserves prior active email in google_accounts.json `old` array and handles non-finite expiry
  const gemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agm-fc-'));
  t.after(() => fs.rmSync(gemDir, { recursive: true, force: true }));
  fileCredentials.writeFileCredentials(
    { accessToken: 'ya29.1', refreshToken: '1//r1', expiryTimestamp: Number.POSITIVE_INFINITY, email: 'first@example.com' },
    { geminiDir: gemDir }
  );
  fileCredentials.writeFileCredentials(
    { accessToken: 'ya29.2', refreshToken: '1//r2', expiryTimestamp: 1800000000, email: 'second@example.com' },
    { geminiDir: gemDir }
  );
  const googleAccounts = JSON.parse(fs.readFileSync(path.join(gemDir, 'google_accounts.json'), 'utf8'));
  assert.deepEqual(googleAccounts, { active: 'second@example.com', old: ['first@example.com'] });
});
