// @ts-check
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { normalizeWeixinAccountId } = require('../shared/openclawWeixinQr');

const DEFAULT_OPENCLAW_GATEWAY_PORT = 18789;
const DEFAULT_OPENCLAW_HOOKS_PATH = '/hooks';
const DEFAULT_OPENCLAW_CHANNEL = 'openclaw-weixin';
const AGENT_ID_RE = /^[a-zA-Z0-9._-]{1,64}$/;
const UNSAFE_WIN_PATH_RE = /[&|<>^()%!\r\n"]/;

/**
 * Validate OpenClaw agentId strictly against a safe identifier allowlist.
 * @param {any} value
 * @returns {string | null}
 */
function normalizeAgentId(value) {
  if (value === undefined || value === null || value === '') return 'main';
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return 'main';
  return AGENT_ID_RE.test(trimmed) ? trimmed : null;
}

/**
 * Scrub secret tokens or raw CLI details from provisioning warnings.
 * @param {string} text
 * @param {string[]} [secrets]
 * @returns {string}
 */
function sanitizeProvisionWarning(text, secrets = []) {
  let out = String(text || '').replace(/[\r\n]+/g, ' ').trim();
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.trim().length >= 4) {
      out = out.split(secret.trim()).join('[REDACTED]');
    }
  }
  out = out
    .replace(/\bBearer\s+[^\s,'";]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(sk-[a-zA-Z0-9_-]{6,})\b/g, '[REDACTED]')
    .replace(/("token"\s*:\s*")[^"]+(")/gi, '$1[REDACTED]$2');
  return out.length > 200 ? `${out.slice(0, 197)}...` : out;
}

/**
 * @param {any} value
 * @returns {boolean}
 */
function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/**
 * Resolve OpenClaw state directory (`$OPENCLAW_STATE_DIR || $CLAWDBOT_STATE_DIR || ~/.openclaw`).
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [homeDir]
 * @returns {string}
 */
function resolveOpenClawStateDir(env = process.env, homeDir = os.homedir()) {
  const override = String(env?.OPENCLAW_STATE_DIR || env?.CLAWDBOT_STATE_DIR || '').trim();
  if (override) return path.resolve(override);
  return path.join(homeDir || os.homedir(), '.openclaw');
}

/**
 * Reverse normalized accountId (`xxx-im-bot` -> `xxx@im.bot`) for legacy compatibility reads.
 * @param {string} normalizedId
 * @returns {string | undefined}
 */
function deriveRawAccountId(normalizedId) {
  if (normalizedId.endsWith('-im-bot')) {
    return `${normalizedId.slice(0, -7)}@im.bot`;
  }
  if (normalizedId.endsWith('-im-wechat')) {
    return `${normalizedId.slice(0, -10)}@im.wechat`;
  }
  return undefined;
}

/**
 * Normalize a JSON5-like OpenClaw config string (comments, trailing commas, single-quoted strings,
 * unquoted object keys) into standard JSON while preserving string contents intact.
 * @param {string} rawText
 * @returns {string}
 */
function normalizeJson5ToJson(rawText) {
  const input = String(rawText || '').replace(/^\uFEFF/u, '');
  let out = '';
  let i = 0;

  while (i < input.length) {
    const ch = input[i];
    const next = input[i + 1];

    // Double-quoted JSON string
    if (ch === '"') {
      const start = i;
      i += 1;
      while (i < input.length) {
        if (input[i] === '\\') {
          i += 2;
        } else if (input[i] === '"') {
          i += 1;
          break;
        } else {
          i += 1;
        }
      }
      out += input.slice(start, i);
      continue;
    }

    // Single-quoted JSON5 string -> double-quoted JSON string
    if (ch === '\'') {
      i += 1;
      let inner = '';
      while (i < input.length) {
        if (input[i] === '\\' && i + 1 < input.length) {
          const esc = input[i + 1];
          if (esc === '\'') {
            inner += '\'';
          } else if (esc === '"') {
            inner += '\\"';
          } else {
            inner += input[i] + esc;
          }
          i += 2;
        } else if (input[i] === '\'') {
          i += 1;
          break;
        } else if (input[i] === '"') {
          inner += '\\"';
          i += 1;
        } else {
          inner += input[i];
          i += 1;
        }
      }
      out += `"${inner}"`;
      continue;
    }

    // Line comment
    if (ch === '/' && next === '/') {
      i += 2;
      while (i < input.length && input[i] !== '\n' && input[i] !== '\r') i += 1;
      continue;
    }

    // Block comment
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < input.length && !(input[i] === '*' && input[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }

    // Trailing comma before } or ]
    if (ch === ',') {
      let j = i + 1;
      while (j < input.length) {
        const look = input[j];
        if (/\s/.test(look)) {
          j += 1;
          continue;
        }
        if (look === '/' && input[j + 1] === '/') {
          j += 2;
          while (j < input.length && input[j] !== '\n' && input[j] !== '\r') j += 1;
          continue;
        }
        if (look === '/' && input[j + 1] === '*') {
          j += 2;
          while (j < input.length && !(input[j] === '*' && input[j + 1] === '/')) j += 1;
          j += 2;
          continue;
        }
        break;
      }
      if (input[j] === '}' || input[j] === ']') {
        i += 1;
        continue;
      }
    }

    // Unquoted identifier object key (after { or ,)
    if (/[A-Za-z_$]/.test(ch)) {
      let prevIdx = out.length - 1;
      while (prevIdx >= 0 && /\s/.test(out[prevIdx])) prevIdx -= 1;
      const prevChar = prevIdx >= 0 ? out[prevIdx] : '';
      if (prevChar === '{' || prevChar === ',') {
        let end = i + 1;
        while (end < input.length && /[A-Za-z0-9_$-]/.test(input[end])) end += 1;
        let colonIdx = end;
        while (colonIdx < input.length && /\s/.test(input[colonIdx])) colonIdx += 1;
        if (input[colonIdx] === ':') {
          out += `"${input.slice(i, end)}"`;
          i = end;
          continue;
        }
      }
    }

    out += ch;
    i += 1;
  }

  return out;
}

/**
 * @param {string} rawText
 * @returns {any}
 */
function parseOpenClawJson5(rawText) {
  try {
    return JSON.parse(rawText);
  } catch {
    return JSON.parse(normalizeJson5ToJson(rawText));
  }
}

/**
 * @param {string} filePath
 * @param {any} value
 * @param {typeof import('node:fs')} [fsApi]
 */
function writePrivateJsonAtomic(filePath, value, fsApi = fs) {
  const dir = path.dirname(filePath);
  fsApi.mkdirSync(dir, { recursive: true, ...(process.platform === 'win32' ? {} : { mode: 0o700 }) });
  if (process.platform !== 'win32' && typeof fsApi.chmodSync === 'function') {
    try { fsApi.chmodSync(dir, 0o700); } catch {}
  }
  const tmpPath = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  const content = `${JSON.stringify(value, null, 2)}\n`;
  let fd = -1;
  try {
    if (process.platform === 'win32') {
      fsApi.writeFileSync(tmpPath, content, { encoding: 'utf8', flag: 'wx' });
    } else {
      const flags = (fsApi.constants?.O_WRONLY ?? 0) | (fsApi.constants?.O_CREAT ?? 0) | (fsApi.constants?.O_EXCL ?? 0);
      fd = fsApi.openSync(tmpPath, flags || 'wx', 0o600);
      fsApi.writeFileSync(fd, content, 'utf8');
      if (typeof fsApi.fchmodSync === 'function') {
        try { fsApi.fchmodSync(fd, 0o600); } catch {}
      }
      if (typeof fsApi.fsyncSync === 'function') {
        try { fsApi.fsyncSync(fd); } catch {}
      }
      fsApi.closeSync(fd);
      fd = -1;
    }
    fsApi.renameSync(tmpPath, filePath);
  } catch (error) {
    if (fd >= 0) {
      try { fsApi.closeSync(fd); } catch {}
    }
    try { fsApi.unlinkSync(tmpPath); } catch {}
    throw error;
  }
}

/**
 * @param {string} stateDir
 * @param {typeof fs} [fsApi]
 */
function readOpenClawConfigFile(stateDir, fsApi = fs) {
  const configPath = path.join(stateDir, 'openclaw.json');
  try {
    if (!fsApi.existsSync(configPath)) {
      return { exists: false, path: configPath, parsed: null, parseError: null };
    }
    const raw = fsApi.readFileSync(configPath, 'utf8');
    const parsed = parseOpenClawJson5(raw);
    return {
      exists: true,
      path: configPath,
      parsed: isPlainObject(parsed) ? parsed : {},
      parseError: null
    };
  } catch (error) {
    return {
      exists: true,
      path: configPath,
      parsed: null,
      parseError: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * @param {string} stateDir
 * @param {string} accountId
 * @param {typeof fs} [fsApi]
 */
function readWeixinAccountRecord(stateDir, accountId, fsApi = fs) {
  const accountsDir = path.join(stateDir, DEFAULT_OPENCLAW_CHANNEL, 'accounts');
  const candidates = [path.join(accountsDir, `${accountId}.json`)];
  const rawCompat = deriveRawAccountId(accountId);
  if (rawCompat) candidates.push(path.join(accountsDir, `${rawCompat}.json`));
  for (const filePath of candidates) {
    try {
      if (!fsApi.existsSync(filePath)) continue;
      const parsed = JSON.parse(fsApi.readFileSync(filePath, 'utf8'));
      if (isPlainObject(parsed)) return parsed;
    } catch {}
  }
  return null;
}

/**
 * @param {string} stateDir
 * @param {typeof fs} [fsApi]
 */
function readIndexedWeixinAccountIds(stateDir, fsApi = fs) {
  const indexPath = path.join(stateDir, DEFAULT_OPENCLAW_CHANNEL, 'accounts.json');
  try {
    if (!fsApi.existsSync(indexPath)) return [];
    const parsed = JSON.parse(fsApi.readFileSync(indexPath, 'utf8'));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id) => typeof id === 'string' && id.trim() !== '').map((id) => id.trim());
  } catch {
    return [];
  }
}

/**
 * List bound WeChat accounts from `~/.openclaw/openclaw-weixin/` without exposing tokens.
 * @param {string} stateDir
 * @param {typeof fs} [fsApi]
 */
function listBoundWeixinAccounts(stateDir, fsApi = fs) {
  const ids = readIndexedWeixinAccountIds(stateDir, fsApi);
  return ids.map((accountId) => {
    const record = readWeixinAccountRecord(stateDir, accountId, fsApi);
    return {
      accountId,
      userId: typeof record?.userId === 'string' ? record.userId.trim() : '',
      baseUrl: typeof record?.baseUrl === 'string' ? record.baseUrl.trim() : '',
      savedAt: typeof record?.savedAt === 'string' ? record.savedAt.trim() : '',
      hasToken: Boolean(typeof record?.token === 'string' && record.token.trim())
    };
  });
}

/**
 * Read up to 10 most recent bot tokens from `~/.openclaw/openclaw-weixin/` for `local_token_list`.
 * Internal use only; never expose over HTTP or IPC.
 * @param {{ env?: NodeJS.ProcessEnv, fsApi?: typeof fs, homeDir?: string }} [options]
 * @returns {string[]}
 */
function readLocalWeixinTokens(options = {}) {
  const fsApi = options.fsApi || fs;
  const stateDir = resolveOpenClawStateDir(options.env, options.homeDir);
  const ids = readIndexedWeixinAccountIds(stateDir, fsApi);
  /** @type {string[]} */
  const tokens = [];
  for (let i = ids.length - 1; i >= 0 && tokens.length < 10; i -= 1) {
    const rec = readWeixinAccountRecord(stateDir, ids[i], fsApi);
    const tok = typeof rec?.token === 'string' ? rec.token.trim() : '';
    if (tok) tokens.push(tok);
  }
  return tokens;
}

/**
 * Search PATH for the `openclaw` executable without spawning a shell.
 * @param {NodeJS.ProcessEnv} [env]
 * @param {typeof fs} [fsApi]
 * @param {string} [platform]
 * @returns {string | null}
 */
function findOpenClawCli(env = process.env, fsApi = fs, platform = process.platform) {
  const pathEnv = String(env?.PATH || env?.Path || '');
  if (!pathEnv) return null;
  const dirs = pathEnv.split(path.delimiter).map((d) => d.trim()).filter(Boolean);
  const candidates = platform === 'win32'
    ? ['openclaw.cmd', 'openclaw.exe', 'openclaw.bat', 'openclaw']
    : ['openclaw'];

  for (const dir of dirs) {
    for (const fileName of candidates) {
      const candidate = path.join(dir, fileName);
      try {
        const stat = fsApi.statSync(candidate);
        if (stat.isFile()) return candidate;
      } catch {}
    }
  }
  return null;
}

/**
 * Probe whether a local TCP port accepts connections.
 * @param {number} port
 * @param {string} [host]
 * @param {number} [timeoutMs]
 * @returns {Promise<boolean>}
 */
function probeGatewayPort(port, host = '127.0.0.1', timeoutMs = 450) {
  return new Promise((resolve) => {
    let settled = false;
    const socket = net.createConnection({ host, port });
    const done = (/** @type {boolean} */ ok) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch {}
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

/**
 * @param {any} rawPath
 * @returns {string}
 */
function normalizeHooksPath(rawPath) {
  const clean = typeof rawPath === 'string' ? rawPath.trim() : '';
  if (!clean) return DEFAULT_OPENCLAW_HOOKS_PATH;
  const prefixed = clean.startsWith('/') ? clean : `/${clean}`;
  return prefixed.replace(/\/+$/u, '') || DEFAULT_OPENCLAW_HOOKS_PATH;
}

/**
 * @param {any} rawPort
 * @returns {number}
 */
function normalizeGatewayPort(rawPort) {
  const port = Number(rawPort);
  return Number.isInteger(port) && port >= 1 && port <= 65535
    ? port
    : DEFAULT_OPENCLAW_GATEWAY_PORT;
}

/**
 * Sanitize optional local bridge / MCP endpoint status so secrets never leak.
 * @param {any} info
 * @returns {{ enabled: boolean, running: boolean, port: number | null, baseUrl: string | null, endpointUrl: string | null, tokenConfigured: boolean } | null}
 */
function sanitizeLocalBridgeDetection(info) {
  if (!isPlainObject(info)) return null;
  const port = Number.isInteger(info.port) && info.port >= 1 && info.port <= 65535 ? info.port : null;
  const baseUrl = typeof info.baseUrl === 'string' && info.baseUrl.trim() ? info.baseUrl.trim() : null;
  const endpointUrl = typeof info.endpointUrl === 'string' && info.endpointUrl.trim()
    ? info.endpointUrl.trim()
    : (typeof info.mcpUrl === 'string' && info.mcpUrl.trim()
      ? info.mcpUrl.trim()
      : (baseUrl ? `${baseUrl.replace(/\/+$/u, '')}/api/mcp` : null));
  return {
    enabled: info.enabled === true,
    running: info.running === true,
    port,
    baseUrl,
    endpointUrl,
    tokenConfigured: Boolean(info.tokenConfigured)
  };
}

/**
 * Inspect local OpenClaw installation, plugin status, hooks, gateway reachability,
 * and bound WeChat accounts. Never returns raw tokens. Absolute host paths
 * (`stateDir`, `cliPath`) are omitted unless `includePaths: true` is explicitly passed.
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   fsApi?: typeof import('node:fs'),
 *   homeDir?: string,
 *   probeGateway?: boolean,
 *   probePort?: (port: number) => Promise<boolean>,
 *   cliPath?: string | null,
 *   localBridge?: any,
 *   mcpEndpoint?: string | null,
 *   includePaths?: boolean
 * }} [options]
 */
async function detectOpenClawEnvironment(options = {}) {
  const env = options.env || process.env;
  const fsApi = options.fsApi || fs;
  const homeDir = options.homeDir || os.homedir();
  const includePaths = options.includePaths === true;
  const stateDir = resolveOpenClawStateDir(env, homeDir);
  const stateDirExists = fsApi.existsSync(stateDir);
  const cfgInfo = readOpenClawConfigFile(stateDir, fsApi);
  const cfg = cfgInfo.parsed || {};

  const pluginEntry = isPlainObject(cfg?.plugins?.entries?.[DEFAULT_OPENCLAW_CHANNEL])
    ? cfg.plugins.entries[DEFAULT_OPENCLAW_CHANNEL]
    : null;
  const pluginInstall = isPlainObject(cfg?.plugins?.installs?.[DEFAULT_OPENCLAW_CHANNEL])
    ? cfg.plugins.installs[DEFAULT_OPENCLAW_CHANNEL]
    : null;
  const extDirInstalled = fsApi.existsSync(path.join(stateDir, 'extensions', DEFAULT_OPENCLAW_CHANNEL, 'package.json'))
    || fsApi.existsSync(path.join(stateDir, 'npm', 'node_modules', '@tencent-weixin', DEFAULT_OPENCLAW_CHANNEL, 'package.json'));

  const pluginInstalled = Boolean(pluginInstall || extDirInstalled);
  const pluginEnabled = pluginEntry ? pluginEntry.enabled !== false : false;

  const hooksCfg = isPlainObject(cfg?.hooks) ? cfg.hooks : {};
  const hooksEnabled = hooksCfg.enabled === true;
  const hooksTokenConfigured = Boolean(typeof hooksCfg.token === 'string' && hooksCfg.token.trim());
  const hooksPath = normalizeHooksPath(hooksCfg.path);

  const gatewayPort = normalizeGatewayPort(cfg?.gateway?.port);
  const suggestedWebhookUrl = `http://127.0.0.1:${gatewayPort}${hooksPath}/agent`;

  const resolvedCli = options.cliPath !== undefined
    ? options.cliPath
    : findOpenClawCli(env, fsApi);
  const cliInstalled = Boolean(resolvedCli);

  let gatewayReachable = null;
  if (options.probeGateway !== false) {
    const prober = typeof options.probePort === 'function'
      ? options.probePort
      : (/** @type {number} */ p) => probeGatewayPort(p);
    try {
      gatewayReachable = Boolean(await prober(gatewayPort));
    } catch {
      gatewayReachable = false;
    }
  }

  const skillDir = path.join(stateDir, 'skills', 'openclaw-token-monitor');
  const skillInstalled = fsApi.existsSync(path.join(skillDir, 'SKILL.md'));
  const skillHelperInstalled = fsApi.existsSync(path.join(skillDir, 'scripts', 'query-token-monitor.mjs'));
  const accounts = listBoundWeixinAccounts(stateDir, fsApi);
  const localBridge = sanitizeLocalBridgeDetection(options.localBridge);
  const mcpEndpoint = typeof options.mcpEndpoint === 'string' && options.mcpEndpoint.trim()
    ? options.mcpEndpoint.trim()
    : (localBridge?.endpointUrl || null);

  return {
    ok: true,
    ...(includePaths ? { stateDir } : {}),
    stateDirExists,
    configExists: cfgInfo.exists,
    configParseError: cfgInfo.parseError ? 'invalid_openclaw_config' : null,
    cliInstalled,
    ...(includePaths ? { cliPath: resolvedCli || null } : {}),
    pluginInstalled,
    pluginEnabled,
    hooksEnabled,
    hooksTokenConfigured,
    hooksPath,
    gatewayPort,
    gatewayReachable,
    suggestedWebhookUrl,
    skillInstalled,
    skillHelperInstalled,
    accounts,
    ...(localBridge ? { localBridge } : {}),
    ...(mcpEndpoint ? { mcpEndpoint } : {})
  };
}

/**
 * Sync the bundled `skills/openclaw-token-monitor/` (`SKILL.md` and
 * `scripts/query-token-monitor.mjs`) into `<stateDir>/skills/openclaw-token-monitor/`.
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   fsApi?: typeof import('node:fs'),
 *   homeDir?: string,
 *   stateDir?: string,
 *   skillSourceDir?: string
 * }} [options]
 */
function installOpenClawSkill(options = {}) {
  const env = options.env || process.env;
  const fsApi = options.fsApi || fs;
  const homeDir = options.homeDir || os.homedir();
  const stateDir = options.stateDir || resolveOpenClawStateDir(env, homeDir);
  const sourceRoot = options.skillSourceDir
    || path.resolve(__dirname, '../../skills/openclaw-token-monitor');
  const sourceSkillMd = path.join(sourceRoot, 'SKILL.md');
  const sourceHelper = path.join(sourceRoot, 'scripts', 'query-token-monitor.mjs');

  if (!fsApi.existsSync(sourceSkillMd)) {
    return {
      ok: false,
      skillInstalled: false,
      helperInstalled: false,
      destRoot: path.join(stateDir, 'skills', 'openclaw-token-monitor'),
      files: /** @type {string[]} */ ([]),
      warning: 'Bundled skills/openclaw-token-monitor was not found; skipped skill install.'
    };
  }

  const destRoot = path.join(stateDir, 'skills', 'openclaw-token-monitor');
  const destScripts = path.join(destRoot, 'scripts');
  const destSkillMd = path.join(destRoot, 'SKILL.md');
  const destHelper = path.join(destScripts, 'query-token-monitor.mjs');
  fsApi.mkdirSync(destScripts, { recursive: true });
  // Read+write instead of copyFileSync so copying out of Electron app.asar stays portable across platforms.
  fsApi.writeFileSync(destSkillMd, fsApi.readFileSync(sourceSkillMd));
  const files = [destSkillMd];
  let helperInstalled = false;
  if (fsApi.existsSync(sourceHelper)) {
    fsApi.writeFileSync(destHelper, fsApi.readFileSync(sourceHelper));
    if (process.platform !== 'win32' && typeof fsApi.chmodSync === 'function') {
      try { fsApi.chmodSync(destHelper, 0o755); } catch {}
    }
    files.push(destHelper);
    helperInstalled = true;
  }

  return {
    ok: true,
    skillInstalled: true,
    helperInstalled,
    destRoot,
    files,
    warning: null
  };
}

/**
 * Internal-only read of hooks.token / port / path from `openclaw.json`.
 * Never expose return value over HTTP or IPC.
 * @param {{ env?: NodeJS.ProcessEnv, fsApi?: typeof fs, homeDir?: string }} [options]
 */
function readOpenClawHookSecrets(options = {}) {
  const fsApi = options.fsApi || fs;
  const stateDir = resolveOpenClawStateDir(options.env, options.homeDir);
  const cfgInfo = readOpenClawConfigFile(stateDir, fsApi);
  const cfg = cfgInfo.parsed || {};
  const hooksCfg = isPlainObject(cfg?.hooks) ? cfg.hooks : {};
  const gatewayPort = normalizeGatewayPort(cfg?.gateway?.port);
  const hooksPath = normalizeHooksPath(hooksCfg.path);
  return {
    hookToken: typeof hooksCfg.token === 'string' ? hooksCfg.token.trim() : '',
    hooksEnabled: hooksCfg.enabled === true,
    hooksPath,
    gatewayPort,
    suggestedWebhookUrl: `http://127.0.0.1:${gatewayPort}${hooksPath}/agent`
  };
}

/**
 * Persist QR-authenticated WeChat bot credentials into OpenClaw's plugin state directory
 * (`~/.openclaw/openclaw-weixin/accounts.json` and `accounts/<id>.json`), matching
 * `@tencent-weixin/openclaw-weixin` on-disk schema.
 * @param {{
 *   accountId: string,
 *   rawAccountId?: string,
 *   botToken: string,
 *   baseUrl?: string,
 *   userId?: string
 * }} binding
 * @param {{ env?: NodeJS.ProcessEnv, fsApi?: typeof fs, homeDir?: string, now?: () => Date }} [options]
 */
function persistWeixinBinding(binding, options = {}) {
  const fsApi = options.fsApi || fs;
  const now = options.now || (() => new Date());
  const stateDir = resolveOpenClawStateDir(options.env, options.homeDir);
  const accountId = normalizeWeixinAccountId(binding?.accountId || binding?.rawAccountId);
  const token = typeof binding?.botToken === 'string' ? binding.botToken.trim() : '';
  const baseUrl = typeof binding?.baseUrl === 'string' ? binding.baseUrl.trim() : '';
  const userId = typeof binding?.userId === 'string' ? binding.userId.trim() : '';

  if (!accountId || !token) {
    throw new Error('accountId and botToken are required to persist WeChat binding');
  }

  const weixinDir = path.join(stateDir, DEFAULT_OPENCLAW_CHANNEL);
  const accountsDir = path.join(weixinDir, 'accounts');
  const indexPath = path.join(weixinDir, 'accounts.json');
  const accountPath = path.join(accountsDir, `${accountId}.json`);

  fsApi.mkdirSync(accountsDir, { recursive: true, ...(process.platform === 'win32' ? {} : { mode: 0o700 }) });

  // Prune stale accounts bound to the same WeChat userId so OpenClaw outbound routing stays unambiguous.
  const existingIds = readIndexedWeixinAccountIds(stateDir, fsApi);
  /** @type {string[]} */
  const removedStaleAccounts = [];
  const remainingIds = [];
  for (const id of existingIds) {
    if (id === accountId) {
      remainingIds.push(id);
      continue;
    }
    const existingData = readWeixinAccountRecord(stateDir, id, fsApi);
    const existingUser = typeof existingData?.userId === 'string' ? existingData.userId.trim() : '';
    if (userId && existingUser && existingUser === userId) {
      removedStaleAccounts.push(id);
      for (const suffix of ['.json', '.sync.json', '.context-tokens.json']) {
        try { fsApi.rmSync(path.join(accountsDir, `${id}${suffix}`), { force: true }); } catch {}
      }
      continue;
    }
    remainingIds.push(id);
  }
  if (!remainingIds.includes(accountId)) {
    remainingIds.push(accountId);
  }

  const existingRecord = readWeixinAccountRecord(stateDir, accountId, fsApi) || {};
  const payload = {
    token,
    savedAt: now().toISOString(),
    ...(baseUrl || existingRecord.baseUrl ? { baseUrl: baseUrl || existingRecord.baseUrl } : {}),
    ...(userId || existingRecord.userId ? { userId: userId || existingRecord.userId } : {})
  };

  writePrivateJsonAtomic(accountPath, payload, fsApi);
  writePrivateJsonAtomic(indexPath, remainingIds, fsApi);

  return {
    accountId,
    accountPath,
    indexPath,
    removedStaleAccounts
  };
}

/**
 * Invoke the OpenClaw CLI strictly with fixed, non-user-controlled arguments
 * (only `gateway restart` is supported). Never interpolates user strings or secrets.
 * @param {string} cliPath
 * @param {string[]} args
 * @param {{ env?: NodeJS.ProcessEnv, timeoutMs?: number }} [options]
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
function defaultExecFile(cliPath, args, options = {}) {
  const safeArgs = args.every((arg) => typeof arg === 'string' && /^[a-z0-9-]+$/i.test(arg));
  if (!safeArgs) {
    return Promise.reject(new Error('Refused to execute OpenClaw CLI with non-allowlisted arguments'));
  }
  const isWinBatch = process.platform === 'win32' && /\.(cmd|bat)$/i.test(cliPath);
  return new Promise((resolve, reject) => {
    if (isWinBatch) {
      if (UNSAFE_WIN_PATH_RE.test(cliPath)) {
        reject(new Error('Refused to invoke Windows batch CLI path containing shell metacharacters'));
        return;
      }
      const cmdLine = `"${cliPath}" ${args.join(' ')}`;
      execFile(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', cmdLine], {
        env: options.env || process.env,
        timeout: options.timeoutMs || 15_000,
        windowsHide: true,
        windowsVerbatimArguments: true
      }, (error, stdout, stderr) => {
        if (error) {
          error.stderr = stderr;
          error.stdout = stdout;
          reject(error);
        } else {
          resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
        }
      });
      return;
    }
    execFile(cliPath, args, {
      env: options.env || process.env,
      timeout: options.timeoutMs || 15_000,
      windowsHide: true
    }, (error, stdout, stderr) => {
      if (error) {
        error.stderr = stderr;
        error.stdout = stdout;
        reject(error);
      } else {
        resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
      }
    });
  });
}

/**
 * Configure local OpenClaw `openclaw.json` directly via private atomic write
 * (never passing secrets or user strings through CLI/shell arguments), install
 * the bundled `skills/openclaw-token-monitor/` skill, and optionally restart Gateway.
 * @param {{
 *   ensureHooks?: boolean,
 *   installSkill?: boolean,
 *   restartGateway?: boolean,
 *   bumpChannelReload?: boolean,
 *   hookToken?: string,
 *   agentId?: string
 * }} [configOptions]
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   fsApi?: typeof import('node:fs'),
 *   homeDir?: string,
 *   now?: () => Date,
 *   execFileImpl?: (cli: string, args: string[], opts?: any) => Promise<{ stdout?: string, stderr?: string }>,
 *   skillSourceDir?: string,
 *   probeGateway?: boolean,
 *   probePort?: (port: number) => Promise<boolean>,
 *   cliPath?: string | null,
 *   localBridge?: any,
 *   mcpEndpoint?: string | null,
 *   includePaths?: boolean
 * }} [runtimeOptions]
 */
async function configureOpenClawHost(configOptions = {}, runtimeOptions = {}) {
  const env = runtimeOptions.env || process.env;
  const fsApi = runtimeOptions.fsApi || fs;
  const homeDir = runtimeOptions.homeDir || os.homedir();
  const now = runtimeOptions.now || (() => new Date());
  const execImpl = runtimeOptions.execFileImpl || defaultExecFile;
  const stateDir = resolveOpenClawStateDir(env, homeDir);

  const ensureHooks = configOptions.ensureHooks !== false;
  const installSkill = configOptions.installSkill !== false;
  const restartGateway = configOptions.restartGateway === true;
  const bumpChannelReload = configOptions.bumpChannelReload !== false;
  const targetAgentId = normalizeAgentId(configOptions.agentId);
  if (!targetAgentId) {
    return {
      ok: false,
      error: 'invalid_agent_id',
      message: 'Invalid agentId: expected 1-64 alphanumeric, dot, underscore, or hyphen characters.',
      env: null,
      resolvedHookToken: '',
      webhookUrl: '',
      steps: {
        hooksConfigured: false,
        pluginEnabled: false,
        channelReloadBumped: false,
        skillInstalled: false,
        gatewayRestarted: false
      },
      warnings: []
    };
  }

  /** @type {string[]} */
  const warnings = [];
  const steps = {
    hooksConfigured: false,
    pluginEnabled: false,
    channelReloadBumped: false,
    skillInstalled: false,
    gatewayRestarted: false
  };

  const resolvedCli = runtimeOptions.cliPath !== undefined
    ? runtimeOptions.cliPath
    : findOpenClawCli(env, fsApi);

  const cfgInfo = readOpenClawConfigFile(stateDir, fsApi);
  const existingCfg = cfgInfo.parsed || {};
  const existingHooks = isPlainObject(existingCfg.hooks) ? existingCfg.hooks : {};
  const existingToken = typeof existingHooks.token === 'string' ? existingHooks.token.trim() : '';
  const requestedToken = typeof configOptions.hookToken === 'string' ? configOptions.hookToken.trim() : '';
  const resolvedHookToken = requestedToken || existingToken || crypto.randomBytes(24).toString('hex');
  const secretsToScrub = [requestedToken, existingToken, resolvedHookToken].filter(Boolean);
  const hooksPath = normalizeHooksPath(existingHooks.path);
  const existingAllowed = Array.isArray(existingHooks.allowedAgentIds)
    ? existingHooks.allowedAgentIds
      .filter((/** @type {any} */ id) => typeof id === 'string' && AGENT_ID_RE.test(id.trim()))
      .map((/** @type {string} */ id) => id.trim())
    : [];
  const mergedAllowed = existingAllowed.includes(targetAgentId)
    ? existingAllowed
    : [...existingAllowed, targetAgentId];

  if (ensureHooks || bumpChannelReload) {
    const updatedTimestamp = now().toISOString();
    if (cfgInfo.exists && cfgInfo.parseError) {
      warnings.push('Could not parse existing openclaw.json; left untouched.');
    } else {
      const nextCfg = isPlainObject(cfgInfo.parsed) ? JSON.parse(JSON.stringify(cfgInfo.parsed)) : {};
      if (bumpChannelReload) {
        nextCfg.channels = isPlainObject(nextCfg.channels) ? nextCfg.channels : {};
        const ch = isPlainObject(nextCfg.channels[DEFAULT_OPENCLAW_CHANNEL])
          ? nextCfg.channels[DEFAULT_OPENCLAW_CHANNEL]
          : {};
        ch.channelConfigUpdatedAt = updatedTimestamp;
        nextCfg.channels[DEFAULT_OPENCLAW_CHANNEL] = ch;
        steps.channelReloadBumped = true;
      }
      if (ensureHooks) {
        nextCfg.plugins = isPlainObject(nextCfg.plugins) ? nextCfg.plugins : {};
        nextCfg.plugins.entries = isPlainObject(nextCfg.plugins.entries) ? nextCfg.plugins.entries : {};
        const entry = isPlainObject(nextCfg.plugins.entries[DEFAULT_OPENCLAW_CHANNEL])
          ? nextCfg.plugins.entries[DEFAULT_OPENCLAW_CHANNEL]
          : {};
        entry.enabled = true;
        nextCfg.plugins.entries[DEFAULT_OPENCLAW_CHANNEL] = entry;

        nextCfg.hooks = isPlainObject(nextCfg.hooks) ? nextCfg.hooks : {};
        nextCfg.hooks.enabled = true;
        nextCfg.hooks.path = hooksPath;
        nextCfg.hooks.token = resolvedHookToken;
        nextCfg.hooks.allowedAgentIds = mergedAllowed;

        steps.hooksConfigured = true;
        steps.pluginEnabled = true;
      }
      writePrivateJsonAtomic(cfgInfo.path, nextCfg, fsApi);
    }
  }

  if (installSkill) {
    const skillRes = installOpenClawSkill({
      env,
      fsApi,
      homeDir,
      stateDir,
      skillSourceDir: runtimeOptions.skillSourceDir
    });
    if (skillRes.skillInstalled) {
      steps.skillInstalled = true;
    } else if (skillRes.warning) {
      warnings.push(sanitizeProvisionWarning(skillRes.warning, secretsToScrub));
    }
  }

  if (restartGateway) {
    if (resolvedCli) {
      try {
        await execImpl(resolvedCli, ['gateway', 'restart'], { env, timeoutMs: 15_000 });
        steps.gatewayRestarted = true;
      } catch (error) {
        const code = typeof (/** @type {any} */ (error)?.code) === 'string' ? /** @type {any} */ (error).code : '';
        warnings.push(sanitizeProvisionWarning(
          code ? `openclaw gateway restart failed (${code})` : 'openclaw gateway restart failed',
          secretsToScrub
        ));
      }
    } else {
      warnings.push('openclaw CLI was not found on PATH; cannot restart OpenClaw Gateway automatically.');
    }
  }

  const nextEnv = await detectOpenClawEnvironment({
    env,
    fsApi,
    homeDir,
    probeGateway: runtimeOptions.probeGateway,
    probePort: runtimeOptions.probePort,
    cliPath: resolvedCli,
    localBridge: runtimeOptions.localBridge,
    mcpEndpoint: runtimeOptions.mcpEndpoint,
    includePaths: runtimeOptions.includePaths === true
  });

  return {
    ok: true,
    env: nextEnv,
    resolvedHookToken: ensureHooks ? resolvedHookToken : '',
    webhookUrl: nextEnv.suggestedWebhookUrl,
    steps,
    warnings
  };
}

const inspectOpenClawEnvironment = detectOpenClawEnvironment;

module.exports = {
  AGENT_ID_RE,
  DEFAULT_OPENCLAW_CHANNEL,
  DEFAULT_OPENCLAW_GATEWAY_PORT,
  DEFAULT_OPENCLAW_HOOKS_PATH,
  configureOpenClawHost,
  deriveRawAccountId,
  detectOpenClawEnvironment,
  findOpenClawCli,
  inspectOpenClawEnvironment,
  installOpenClawSkill,
  listBoundWeixinAccounts,
  normalizeAgentId,
  normalizeJson5ToJson,
  parseOpenClawJson5,
  persistWeixinBinding,
  probeGatewayPort,
  readLocalWeixinTokens,
  readOpenClawHookSecrets,
  resolveOpenClawStateDir,
  sanitizeProvisionWarning
};
