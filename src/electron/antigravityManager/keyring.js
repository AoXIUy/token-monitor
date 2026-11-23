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
  const expiryRaw = Number(tokenData.expiryTimestamp);
  const expiryMs = Number.isFinite(expiryRaw) && expiryRaw > 0
    ? (expiryRaw > 10_000_000_000 ? Math.trunc(expiryRaw) : Math.trunc(expiryRaw * 1000))
    : 0;
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

const WIN32_CRED_MAX_BLOB_BYTES = 2560;

/**
 * Create Windows Credential Manager bindings using anonymous Koffi structs so
 * global type names (`FILETIME`, `CREDENTIALW`, `PCREDENTIALW`) never collide
 * with other modules (e.g. `src/shared/providers/claude/limits.js`).
 *
 * @param {any} koffi
 */
function createWin32CredApi(koffi) {
  const advapi32 = koffi.load('advapi32.dll');
  let GetLastError = null;
  try {
    const kernel32 = koffi.load('kernel32.dll');
    GetLastError = kernel32.func('__stdcall', 'GetLastError', 'uint32_t', []);
  } catch (_) {}
  const FILETIME = koffi.struct({
    dwLowDateTime: 'uint32_t',
    dwHighDateTime: 'uint32_t'
  });
  const CREDENTIALW = koffi.struct({
    Flags: 'uint32_t',
    Type: 'uint32_t',
    TargetName: 'str16',
    Comment: 'void *',
    LastWritten: FILETIME,
    CredentialBlobSize: 'uint32_t',
    CredentialBlob: 'uint8_t *',
    Persist: 'uint32_t',
    AttributeCount: 'uint32_t',
    Attributes: 'void *',
    TargetAlias: 'void *',
    UserName: 'str16'
  });
  const CredWriteW = advapi32.func('__stdcall', 'CredWriteW', 'int', [koffi.pointer(CREDENTIALW), 'uint32_t']);
  const CredReadW = advapi32.func('__stdcall', 'CredReadW', 'int', [
    'str16',
    'uint32_t',
    'uint32_t',
    koffi.out(koffi.pointer(koffi.pointer(CREDENTIALW)))
  ]);
  const CredDeleteW = advapi32.func('__stdcall', 'CredDeleteW', 'int', ['str16', 'uint32_t', 'uint32_t']);
  const CredFree = advapi32.func('__stdcall', 'CredFree', 'void', ['void *']);
  return { koffi, CredWriteW, CredReadW, CredDeleteW, CredFree, GetLastError, CREDENTIALW };
}

/** @type {any} */
let win32Bindings = null;
function getWin32CredApi() {
  if (win32Bindings) return win32Bindings;
  win32Bindings = createWin32CredApi(require('koffi'));
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
    let secretBuf = Buffer.from(payloadJson, 'utf8');
    if (secretBuf.length > WIN32_CRED_MAX_BLOB_BYTES && tokenData.idToken) {
      // Windows CRED_MAX_CREDENTIAL_BLOB_SIZE is 2560 bytes; omit optional id_token if needed.
      secretBuf = Buffer.from(serializeKeyringPayload({ ...tokenData, idToken: null }), 'utf8');
    }
    if (options.win32Cred) {
      options.win32Cred.write(target, account, secretBuf);
      return;
    }
    const api = getWin32CredApi();
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
    if (!ok) {
      const errCode = typeof api.GetLastError === 'function' ? api.GetLastError() : null;
      throw new Error(errCode ? `Windows CredWriteW failed (Win32 error ${errCode})` : 'Windows CredWriteW failed');
    }
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
 * Decode a raw Windows CredentialBlob buffer (UTF-8 or UTF-16LE, trimming trailing NUL bytes).
 *
 * @param {Buffer} rawBuf
 * @returns {{ refreshToken: string, email: string } | null}
 */
function parseWin32CredentialBuffer(rawBuf) {
  if (!rawBuf || rawBuf.length === 0) return null;
  const utf8Parsed = parseKeyringPayload(rawBuf.toString('utf8').replace(/\0+$/g, ''));
  if (utf8Parsed) return utf8Parsed;
  if (rawBuf.length % 2 === 0) {
    return parseKeyringPayload(rawBuf.toString('utf16le').replace(/\0+$/g, ''));
  }
  return null;
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
        return buf ? parseWin32CredentialBuffer(buf) : null;
      }
      const api = getWin32CredApi();
      const outPtr = [null];
      const ok = api.CredReadW(target, 1, 0, outPtr);
      if (!ok || !outPtr[0]) return null;
      try {
        const cred = api.koffi.decode(outPtr[0], api.CREDENTIALW);
        if (!cred?.CredentialBlob || !cred.CredentialBlobSize) return null;
        let rawBuf;
        try {
          rawBuf = Buffer.from(new Uint8Array(api.koffi.view(cred.CredentialBlob, cred.CredentialBlobSize)));
        } catch (_) {
          rawBuf = Buffer.from(api.koffi.decode(cred.CredentialBlob, 'uint8_t', cred.CredentialBlobSize));
        }
        return parseWin32CredentialBuffer(rawBuf);
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
  WIN32_CRED_MAX_BLOB_BYTES,
  createWin32CredApi,
  parseKeyringPayload,
  readFromSystemKeyring,
  serializeKeyringPayload,
  writeToSystemKeyring
};
