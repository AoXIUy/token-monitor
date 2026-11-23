// @ts-check
'use strict';

const { execFileSync, spawnSync } = require('node:child_process');

const DEFAULT_SERVICE = 'gemini';
const DEFAULT_ACCOUNT = 'antigravity';
const ACP_ACCOUNT = 'antigravity-acp';
const KEYRING_B64_PREFIX = 'go-keyring-base64:';

/**
 * @param {{
 *   accessToken: string,
 *   refreshToken: string,
 *   expiryTimestamp: number,
 *   email?: string,
 *   idToken?: string | null
 * }} tokenData
 * @returns {string}
 */
function serializeKeyringPayload(tokenData) {
  const expiryRaw = Number(tokenData.expiryTimestamp || 0);
  const expiryMs = expiryRaw > 10_000_000_000 ? expiryRaw : expiryRaw * 1000;
  const iso = (expiryMs > 0 ? new Date(expiryMs) : new Date()).toISOString();
  const microIso = iso.replace(/\.(\d{3})Z$/, '.$1000Z');
  const payload = {
    token: {
      access_token: String(tokenData.accessToken || ''),
      token_type: 'Bearer',
      refresh_token: String(tokenData.refreshToken || ''),
      expiry: microIso,
      expires_in: 3599
    },
    auth_method: 'consumer',
    ...(tokenData.email ? { id_token_email: String(tokenData.email) } : {}),
    ...(tokenData.idToken ? { id_token: String(tokenData.idToken) } : {})
  };
  return JSON.stringify(payload);
}

/**
 * Parse raw keyring secret (handles plain JSON and `go-keyring-base64:...`).
 * @param {string} raw
 * @returns {{ refreshToken: string, email: string } | null}
 */
function parseKeyringPayload(raw) {
  let text = String(raw || '').trim();
  if (!text) return null;
  if (text.startsWith(KEYRING_B64_PREFIX)) {
    text = Buffer.from(text.slice(KEYRING_B64_PREFIX.length), 'base64').toString('utf8');
  }
  try {
    const parsed = JSON.parse(text);
    const refreshToken = String(parsed?.token?.refresh_token || parsed?.refresh_token || '').trim();
    if (!refreshToken) return null;
    const email = String(parsed?.id_token_email || parsed?.email || '').trim().toLowerCase();
    return { refreshToken, email };
  } catch (_) {
    return null;
  }
}

/** @type {any} */
let win32Bindings = null;
function getWin32CredApi() {
  if (win32Bindings) return win32Bindings;
  const koffi = require('koffi');
  const advapi32 = koffi.load('advapi32.dll');
  const FILETIME = koffi.struct('FILETIME', {
    dwLowDateTime: 'uint32',
    dwHighDateTime: 'uint32'
  });
  const CREDENTIALW = koffi.struct('CREDENTIALW', {
    Flags: 'uint32',
    Type: 'uint32',
    TargetName: 'str16',
    Comment: 'void*',
    LastWritten: FILETIME,
    CredentialBlobSize: 'uint32',
    CredentialBlob: 'uint8*',
    Persist: 'uint32',
    AttributeCount: 'uint32',
    Attributes: 'void*',
    TargetAlias: 'void*',
    UserName: 'str16'
  });
  koffi.pointer('PCREDENTIALW', CREDENTIALW);
  const CredWriteW = advapi32.func('int __stdcall CredWriteW(CREDENTIALW *Credential, uint32 Flags)');
  const CredReadW = advapi32.func('int __stdcall CredReadW(str16 TargetName, uint32 Type, uint32 Flags, _Out_ PCREDENTIALW *Credential)');
  const CredDeleteW = advapi32.func('int __stdcall CredDeleteW(str16 TargetName, uint32 Type, uint32 Flags)');
  const CredFree = advapi32.func('void __stdcall CredFree(void *Buffer)');
  win32Bindings = { koffi, CredWriteW, CredReadW, CredDeleteW, CredFree, CREDENTIALW };
  return win32Bindings;
}

/**
 * Write credential to OS keyring (macOS Keychain / Windows Credential Manager / Linux secret-tool).
 *
 * @param {{
 *   accessToken: string,
 *   refreshToken: string,
 *   expiryTimestamp: number,
 *   email?: string,
 *   idToken?: string | null
 * }} tokenData
 * @param {{
 *   service?: string,
 *   account?: string,
 *   platform?: NodeJS.Platform,
 *   execFileSync?: typeof execFileSync,
 *   spawnSync?: typeof spawnSync,
 *   win32Cred?: { write: (target: string, user: string, secretBuf: Buffer) => void }
 * }} [options]
 */
function writeToSystemKeyring(tokenData, options = {}) {
  const service = options.service || DEFAULT_SERVICE;
  const account = options.account || DEFAULT_ACCOUNT;
  const platform = options.platform || process.platform;
  const payloadJson = serializeKeyringPayload(tokenData);
  const execFn = options.execFileSync || execFileSync;
  const spawnFn = options.spawnSync || spawnSync;

  if (platform === 'darwin') {
    const encoded = `${KEYRING_B64_PREFIX}${Buffer.from(payloadJson, 'utf8').toString('base64')}`;
    try {
      execFn('security', ['delete-generic-password', '-s', service, '-a', account], { timeout: 10_000, stdio: 'pipe' });
    } catch (_) {}
    execFn('security', ['add-generic-password', '-s', service, '-a', account, '-w', encoded, '-A'], {
      timeout: 10_000,
      stdio: 'pipe'
    });
    return;
  }

  if (platform === 'win32') {
    const target = `${service}:${account}`;
    const secretBuf = Buffer.from(payloadJson, 'utf8');
    if (options.win32Cred) {
      options.win32Cred.write(target, account, secretBuf);
      return;
    }
    const api = getWin32CredApi();
    try { api.CredDeleteW(target, 1, 0); } catch (_) {}
    const ok = api.CredWriteW({
      Flags: 0,
      Type: 1,
      TargetName: target,
      Comment: null,
      LastWritten: { dwLowDateTime: 0, dwHighDateTime: 0 },
      CredentialBlobSize: secretBuf.length,
      CredentialBlob: secretBuf,
      Persist: 2,
      AttributeCount: 0,
      Attributes: null,
      TargetAlias: null,
      UserName: account
    }, 0);
    if (!ok) throw new Error('Windows CredWriteW failed');
    return;
  }

  // Linux Secret Service (write both 'login' collection and default collection for agy compatibility)
  /** @param {string | null} collection */
  const store = (collection) => {
    const args = ['store'];
    if (collection) {
      args.push(`--collection=${collection}`, `--label=Password for '${account}' on '${service}'`);
    } else {
      args.push(`--label=${service}`);
    }
    args.push('service', service, 'username', account);
    const res = spawnFn('secret-tool', args, {
      input: payloadJson,
      encoding: 'utf8',
      timeout: 10_000
    });
    if (res.error) {
      if (/** @type {any} */ (res.error).code === 'ENOENT') {
        throw new Error("Linux Secret Service utility 'secret-tool' not found");
      }
      throw res.error;
    }
    if (res.status !== 0) {
      throw new Error(`Linux secret-tool failed: ${(res.stderr || '').trim() || `exit ${res.status}`}`);
    }
  };

  let loginErr = null;
  let defaultErr = null;
  try { store('/org/freedesktop/secrets/collection/login'); } catch (err) { loginErr = err; }
  try { store(null); } catch (err) { defaultErr = err; }
  if (loginErr && defaultErr) throw loginErr;
}

/**
 * Read credential from OS keyring.
 *
 * @param {{
 *   service?: string,
 *   account?: string,
 *   platform?: NodeJS.Platform,
 *   execFileSync?: typeof execFileSync,
 *   win32Cred?: { read: (target: string) => Buffer | null }
 * }} [options]
 * @returns {{ refreshToken: string, email: string } | null}
 */
function readFromSystemKeyring(options = {}) {
  const service = options.service || DEFAULT_SERVICE;
  const account = options.account || DEFAULT_ACCOUNT;
  const platform = options.platform || process.platform;
  const execFn = options.execFileSync || execFileSync;

  try {
    if (platform === 'darwin') {
      const out = execFn('security', ['find-generic-password', '-s', service, '-a', account, '-w'], {
        encoding: 'utf8',
        timeout: 10_000,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      return parseKeyringPayload(String(out || ''));
    }

    if (platform === 'win32') {
      const target = `${service}:${account}`;
      if (options.win32Cred) {
        const buf = options.win32Cred.read(target);
        return buf ? parseKeyringPayload(buf.toString('utf8')) : null;
      }
      const api = getWin32CredApi();
      const outPtr = [null];
      const ok = api.CredReadW(target, 1, 0, outPtr);
      if (!ok || !outPtr[0]) return null;
      try {
        const cred = api.koffi.decode(outPtr[0], api.CREDENTIALW);
        if (!cred?.CredentialBlob || !cred.CredentialBlobSize) return null;
        const rawBytes = api.koffi.decode(cred.CredentialBlob, 'uint8', cred.CredentialBlobSize);
        return parseKeyringPayload(Buffer.from(rawBytes).toString('utf8'));
      } finally {
        api.CredFree(outPtr[0]);
      }
    }

    const out = execFn('secret-tool', ['lookup', 'service', service, 'username', account], {
      encoding: 'utf8',
      timeout: 10_000,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return parseKeyringPayload(String(out || ''));
  } catch (_) {
    return null;
  }
}

module.exports = {
  ACP_ACCOUNT,
  DEFAULT_ACCOUNT,
  DEFAULT_SERVICE,
  KEYRING_B64_PREFIX,
  parseKeyringPayload,
  readFromSystemKeyring,
  serializeKeyringPayload,
  writeToSystemKeyring
};
