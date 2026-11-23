// @ts-check
'use strict';

/**
 * Pure-JS WeChat ClawBot / @tencent-weixin/openclaw-weixin iLink QR login client.
 * Zero Node built-ins; uses injected fetchImpl for proxy & test compatibility.
 */

const DEFAULT_ILINK_BASE_URL = 'https://ilinkai.weixin.qq.com';
const DEFAULT_ILINK_BOT_TYPE = '3';
const ILINK_APP_ID = 'bot';
// Mirrors @tencent-weixin/openclaw-weixin 2.4.10 buildClientVersion(): (2<<16)|(4<<8)|10.
const ILINK_CLIENT_VERSION = String((2 << 16) | (4 << 8) | 10);
const ACTIVE_LOGIN_TTL_MS = 5 * 60_000;
const QR_LONG_POLL_TIMEOUT_MS = 35_000;
const MAX_QR_REFRESH_COUNT = 3;
const MAX_ACTIVE_QR_SESSIONS = 4;
const MAX_QR_RESPONSE_BYTES = 256 * 1024;

// Strict *.weixin.qq.com allowlist (no IP literals, no arbitrary domains, no custom ports).
const ALLOWED_REDIRECT_HOST_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+weixin\.qq\.com$/;

/**
 * Validate a `scaned_but_redirect` redirect_host strictly against `*.weixin.qq.com`.
 * @param {any} value
 * @returns {string}
 */
function normalizeAllowedRedirectHost(value) {
  if (typeof value !== 'string') return '';
  const lower = value.trim().toLowerCase();
  if (!lower || lower.length > 253) return '';
  return ALLOWED_REDIRECT_HOST_RE.test(lower) ? lower : '';
}

/**
 * Read a fetch Response body up to `maxBytes` without buffering unbounded streams.
 * @param {Response} response
 * @param {number} [maxBytes]
 * @returns {Promise<string>}
 */
async function readBoundedText(response, maxBytes = MAX_QR_RESPONSE_BYTES) {
  if (response?.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let totalBytes = 0;
    let out = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        const remaining = maxBytes - totalBytes;
        if (remaining <= 0) {
          try { await reader.cancel(); } catch {}
          break;
        }
        const slice = value.byteLength > remaining ? value.subarray(0, remaining) : value;
        totalBytes += slice.byteLength;
        out += decoder.decode(slice, { stream: true });
        if (totalBytes >= maxBytes) {
          try { await reader.cancel(); } catch {}
          break;
        }
      }
      out += decoder.decode();
      return out;
    } finally {
      try { reader.releaseLock(); } catch {}
    }
  }
  const text = await response.text();
  return text.length > maxBytes ? text.slice(0, maxBytes) : text;
}

/**
 * Normalize an iLink bot/user ID (e.g. `b0f5860fdecb@im.bot` -> `b0f5860fdecb-im-bot`)
 * to match OpenClaw's filesystem-safe `normalizeAccountId`.
 * @param {any} raw
 * @returns {string}
 */
function normalizeWeixinAccountId(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * @param {any} value
 * @returns {string}
 */
function normalizeIlinkBaseUrl(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
    if (parsed.username || parsed.password || parsed.hash) return '';
    return parsed.toString().replace(/\/+$/u, '');
  } catch {
    return '';
  }
}

/**
 * Generate a random UUID without importing node:crypto.
 * @returns {string}
 */
function generateSessionId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Generate X-WECHAT-UIN header: base64(decimal string of random uint32).
 * @returns {string}
 */
function randomWechatUin() {
  let uint32;
  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
    const arr = new Uint32Array(1);
    globalThis.crypto.getRandomValues(arr);
    uint32 = arr[0];
  } else {
    uint32 = Math.floor(Math.random() * 0xffffffff) >>> 0;
  }
  const decimal = String(uint32);
  if (typeof globalThis.btoa === 'function') {
    return globalThis.btoa(decimal);
  }
  return Buffer.from(decimal, 'utf8').toString('base64');
}

/**
 * @param {{ routeTag?: string }} [options]
 * @returns {Record<string, string>}
 */
function buildCommonHeaders(options = {}) {
  /** @type {Record<string, string>} */
  const headers = {
    'iLink-App-Id': ILINK_APP_ID,
    'iLink-App-ClientVersion': ILINK_CLIENT_VERSION
  };
  const routeTag = typeof options.routeTag === 'string' ? options.routeTag.trim() : '';
  if (routeTag) headers.SKRouteTag = routeTag;
  return headers;
}

/**
 * @param {{ routeTag?: string }} [options]
 * @returns {Record<string, string>}
 */
function buildPostHeaders(options = {}) {
  return {
    'Content-Type': 'application/json',
    AuthorizationType: 'ilink_bot_token',
    'X-WECHAT-UIN': randomWechatUin(),
    ...buildCommonHeaders(options)
  };
}

/**
 * @param {any} error
 * @returns {boolean}
 */
function isAbortError(error) {
  return Boolean(error && typeof error === 'object' && error.name === 'AbortError');
}

/**
 * Create an interactive QR login session manager for WeChat iLink Bot API.
 * @param {{
 *   fetchImpl?: typeof fetch,
 *   getLocalTokens?: () => Promise<string[]> | string[],
 *   getRouteTag?: () => string | undefined,
 *   logger?: { info?: (...args: any[]) => void, warn?: (...args: any[]) => void, error?: (...args: any[]) => void },
 *   now?: () => Date,
 *   ilinkBaseUrl?: string,
 *   botType?: string,
 *   pollTimeoutMs?: number,
 *   sessionTtlMs?: number,
 *   maxRefreshCount?: number
 * }} [options]
 */
function createWeixinQrLoginManager({
  fetchImpl,
  getLocalTokens = () => [],
  getRouteTag = () => undefined,
  logger = console,
  now = () => new Date(),
  ilinkBaseUrl = DEFAULT_ILINK_BASE_URL,
  botType = DEFAULT_ILINK_BOT_TYPE,
  pollTimeoutMs = QR_LONG_POLL_TIMEOUT_MS,
  sessionTtlMs = ACTIVE_LOGIN_TTL_MS,
  maxRefreshCount = MAX_QR_REFRESH_COUNT
} = {}) {
  const baseUrl = normalizeIlinkBaseUrl(ilinkBaseUrl) || DEFAULT_ILINK_BASE_URL;
  const resolvedBotType = String(botType || DEFAULT_ILINK_BOT_TYPE).trim() || DEFAULT_ILINK_BOT_TYPE;
  const resolvedPollTimeoutMs = Math.max(1000, Number(pollTimeoutMs) || QR_LONG_POLL_TIMEOUT_MS);
  const resolvedTtlMs = Math.max(5000, Number(sessionTtlMs) || ACTIVE_LOGIN_TTL_MS);
  const resolvedMaxRefresh = Math.max(0, Number.isInteger(maxRefreshCount) ? maxRefreshCount : MAX_QR_REFRESH_COUNT);

  /**
   * @typedef {{
   *   sessionId: string,
   *   qrcode: string,
   *   qrcodeImgContent: string,
   *   startedAt: number,
   *   currentApiBaseUrl: string,
   *   status: string,
   *   refreshCount: number,
   *   pendingVerifyCode: string,
   *   cancelled: boolean,
   *   activeAbort: AbortController | null,
   *   inFlightPoll: Promise<any> | null
   * }} QrSession
   */

  /** @type {Map<string, QrSession>} */
  const sessions = new Map();

  function getFetch() {
    const fn = typeof fetchImpl === 'function' ? fetchImpl : globalThis.fetch;
    if (typeof fn !== 'function') {
      throw new Error('HTTP fetch client is unavailable');
    }
    return fn;
  }

  function nowMs() {
    return now().getTime();
  }

  function purgeExpiredSessions() {
    const nowValue = nowMs();
    for (const [id, session] of sessions) {
      if (session.cancelled || (nowValue - session.startedAt >= resolvedTtlMs && !session.inFlightPoll)) {
        sessions.delete(id);
      }
    }
  }

  /**
   * @param {QrSession} session
   */
  function publicSessionView(session) {
    return {
      sessionId: session.sessionId,
      status: session.status,
      qrcodeImgContent: session.qrcodeImgContent,
      refreshCount: session.refreshCount,
      expiresAt: new Date(session.startedAt + resolvedTtlMs).toISOString()
    };
  }

  async function fetchQrCode() {
    const fn = getFetch();
    const rawTokens = await Promise.resolve(getLocalTokens());
    const localTokenList = Array.isArray(rawTokens)
      ? rawTokens.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim()).slice(0, 10)
      : [];

    const endpoint = `${baseUrl}/ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(resolvedBotType)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    let response;
    let rawText;
    try {
      response = await fn(endpoint, {
        method: 'POST',
        headers: buildPostHeaders({ routeTag: getRouteTag() }),
        body: JSON.stringify({ local_token_list: localTokenList }),
        redirect: 'error',
        signal: controller.signal
      });
      rawText = await readBoundedText(response, MAX_QR_RESPONSE_BYTES);
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new Error(`get_bot_qrcode HTTP ${response.status}: ${rawText.slice(0, 200)}`);
    }
    let parsed;
    try {
      parsed = rawText ? JSON.parse(rawText) : null;
    } catch {
      throw new Error('get_bot_qrcode returned invalid JSON');
    }
    const qrcode = typeof parsed?.qrcode === 'string' ? parsed.qrcode.trim() : '';
    const qrcodeImgContent = typeof parsed?.qrcode_img_content === 'string'
      ? parsed.qrcode_img_content.trim()
      : '';
    if (!qrcode || !qrcodeImgContent) {
      throw new Error('get_bot_qrcode response missing qrcode or qrcode_img_content');
    }
    return { qrcode, qrcodeImgContent };
  }

  /**
   * @param {string} pollBaseUrl
   * @param {string} qrcode
   * @param {string} verifyCode
   * @param {QrSession} session
   * @param {AbortSignal} [callerSignal]
   */
  async function requestQrStatus(pollBaseUrl, qrcode, verifyCode, session, callerSignal) {
    const fn = getFetch();
    let endpoint = `${pollBaseUrl}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`;
    if (verifyCode) {
      endpoint += `&verify_code=${encodeURIComponent(verifyCode)}`;
    }
    const controller = new AbortController();
    session.activeAbort = controller;
    const onCallerAbort = () => controller.abort();
    if (callerSignal) {
      if (callerSignal.aborted) {
        controller.abort();
      } else {
        callerSignal.addEventListener('abort', onCallerAbort, { once: true });
      }
    }
    const timer = setTimeout(() => controller.abort(), resolvedPollTimeoutMs);
    try {
      const response = await fn(endpoint, {
        method: 'GET',
        headers: buildCommonHeaders({ routeTag: getRouteTag() }),
        redirect: 'error',
        signal: controller.signal
      });
      const rawText = await readBoundedText(response, MAX_QR_RESPONSE_BYTES);
      if (!response.ok) {
        if (response.status === 502 || response.status === 504 || response.status === 524) {
          return { status: session.status === 'scaned' ? 'scaned' : 'wait', transientTimeout: true };
        }
        throw new Error(`get_qrcode_status HTTP ${response.status}: ${rawText.slice(0, 200)}`);
      }
      const parsed = rawText ? JSON.parse(rawText) : null;
      if (!parsed || typeof parsed !== 'object' || typeof parsed.status !== 'string') {
        throw new Error('get_qrcode_status returned invalid payload');
      }
      return parsed;
    } catch (error) {
      if (session.cancelled) {
        return { status: 'cancelled' };
      }
      if (isAbortError(error) || callerSignal?.aborted) {
        return { status: session.status === 'scaned' ? 'scaned' : 'wait', transientTimeout: true };
      }
      throw error;
    } finally {
      clearTimeout(timer);
      if (callerSignal) {
        try { callerSignal.removeEventListener('abort', onCallerAbort); } catch {}
      }
      if (session.activeAbort === controller) {
        session.activeAbort = null;
      }
    }
  }

  /**
   * Start a new WeChat QR login session.
   */
  async function start() {
    purgeExpiredSessions();
    if (sessions.size >= MAX_ACTIVE_QR_SESSIONS) {
      return {
        ok: false,
        statusCode: 429,
        error: 'too_many_qr_sessions',
        message: `Maximum concurrent QR login sessions (${MAX_ACTIVE_QR_SESSIONS}) reached.`
      };
    }
    try {
      const qr = await fetchQrCode();
      purgeExpiredSessions();
      if (sessions.size >= MAX_ACTIVE_QR_SESSIONS) {
        return {
          ok: false,
          statusCode: 429,
          error: 'too_many_qr_sessions',
          message: `Maximum concurrent QR login sessions (${MAX_ACTIVE_QR_SESSIONS}) reached.`
        };
      }
      const sessionId = generateSessionId();
      /** @type {QrSession} */
      const session = {
        sessionId,
        qrcode: qr.qrcode,
        qrcodeImgContent: qr.qrcodeImgContent,
        startedAt: nowMs(),
        currentApiBaseUrl: baseUrl,
        status: 'wait',
        refreshCount: 0,
        pendingVerifyCode: '',
        cancelled: false,
        activeAbort: null,
        inFlightPoll: null
      };
      sessions.set(sessionId, session);
      return {
        ok: true,
        ...publicSessionView(session)
      };
    } catch (error) {
      logger?.warn?.(
        '[openclaw-weixin-qr] failed to start QR login:',
        error instanceof Error ? error.message : String(error)
      );
      return {
        ok: false,
        error: 'qr_start_failed',
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * @param {QrSession} session
   * @param {'expired' | 'verify_code_blocked'} reason
   */
  async function handleRefreshableFailure(session, reason) {
    session.pendingVerifyCode = '';
    session.refreshCount += 1;
    if (session.refreshCount > resolvedMaxRefresh) {
      sessions.delete(session.sessionId);
      const isBlocked = reason === 'verify_code_blocked';
      return {
        ok: false,
        sessionId: session.sessionId,
        status: 'expired',
        error: isBlocked ? 'qr_verify_blocked' : 'qr_expired',
        message: isBlocked
          ? 'Too many incorrect verification attempts. Please start a new QR login.'
          : 'QR code expired multiple times. Please start a new QR login.'
      };
    }

    try {
      const nextQr = await fetchQrCode();
      session.qrcode = nextQr.qrcode;
      session.qrcodeImgContent = nextQr.qrcodeImgContent;
      session.startedAt = nowMs();
      session.currentApiBaseUrl = baseUrl;
      session.status = 'wait';
      return {
        ok: true,
        ...publicSessionView(session),
        refreshed: true,
        reason
      };
    } catch (error) {
      sessions.delete(session.sessionId);
      return {
        ok: false,
        sessionId: session.sessionId,
        status: 'error',
        error: 'qr_refresh_failed',
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Perform one long-poll status step for an active session.
   * @param {string} sessionId
   * @param {{ signal?: AbortSignal }} [options]
   */
  async function pollStatus(sessionId, options = {}) {
    const cleanId = typeof sessionId === 'string' ? sessionId.trim() : '';
    const session = cleanId ? sessions.get(cleanId) : null;
    if (!session || session.cancelled) {
      return {
        ok: false,
        sessionId: cleanId,
        status: session?.cancelled ? 'cancelled' : 'expired',
        error: 'qr_session_not_found',
        message: 'QR login session not found or already closed.'
      };
    }

    const callerSignal = options?.signal;
    if (session.inFlightPoll) {
      return session.inFlightPoll;
    }

    const run = (async () => {
      if (nowMs() - session.startedAt >= resolvedTtlMs) {
        return handleRefreshableFailure(session, 'expired');
      }

      const usedVerifyCode = session.pendingVerifyCode;
      let statusResp;
      try {
        statusResp = await requestQrStatus(
          session.currentApiBaseUrl,
          session.qrcode,
          usedVerifyCode,
          session,
          callerSignal
        );
      } catch (error) {
        logger?.warn?.(
          '[openclaw-weixin-qr] status poll failed:',
          error instanceof Error ? error.message : String(error)
        );
        return {
          ok: false,
          sessionId: session.sessionId,
          status: 'error',
          error: 'qr_poll_failed',
          message: error instanceof Error ? error.message : String(error)
        };
      }

      if (session.cancelled || statusResp.status === 'cancelled') {
        sessions.delete(session.sessionId);
        return {
          ok: false,
          sessionId: session.sessionId,
          status: 'cancelled',
          error: 'qr_cancelled',
          message: 'QR login cancelled.'
        };
      }

      switch (statusResp.status) {
        case 'wait':
          session.status = 'wait';
          return {
            ok: true,
            ...publicSessionView(session)
          };

        case 'scaned':
          if (usedVerifyCode && session.pendingVerifyCode === usedVerifyCode) {
            session.pendingVerifyCode = '';
          }
          session.status = 'scaned';
          return {
            ok: true,
            ...publicSessionView(session)
          };

        case 'scaned_but_redirect': {
          const allowedHost = normalizeAllowedRedirectHost(statusResp.redirect_host);
          if (allowedHost) {
            session.currentApiBaseUrl = `https://${allowedHost}`;
          }
          session.status = 'scaned_but_redirect';
          return {
            ok: true,
            ...publicSessionView(session),
            redirected: Boolean(allowedHost)
          };
        }

        case 'need_verifycode': {
          const verifyCodeIncorrect = Boolean(usedVerifyCode);
          if (session.pendingVerifyCode === usedVerifyCode) {
            session.pendingVerifyCode = '';
          }
          session.status = 'need_verifycode';
          return {
            ok: true,
            ...publicSessionView(session),
            verifyCodeIncorrect
          };
        }

        case 'expired':
          return handleRefreshableFailure(session, 'expired');

        case 'verify_code_blocked':
          return handleRefreshableFailure(session, 'verify_code_blocked');

        case 'binded_redirect':
          sessions.delete(session.sessionId);
          return {
            ok: true,
            sessionId: session.sessionId,
            status: 'binded_redirect',
            connected: true,
            alreadyConnected: true,
            message: 'This WeChat bot is already bound to OpenClaw.'
          };

        case 'confirmed': {
          sessions.delete(session.sessionId);
          const rawAccountId = typeof statusResp.ilink_bot_id === 'string' ? statusResp.ilink_bot_id.trim() : '';
          const accountId = normalizeWeixinAccountId(rawAccountId);
          if (!rawAccountId || !accountId) {
            return {
              ok: false,
              sessionId: session.sessionId,
              status: 'error',
              error: 'qr_missing_bot_id',
              message: 'WeChat login confirmed, but server response omitted ilink_bot_id.'
            };
          }
          return {
            ok: true,
            sessionId: session.sessionId,
            status: 'confirmed',
            connected: true,
            alreadyConnected: false,
            botToken: typeof statusResp.bot_token === 'string' ? statusResp.bot_token.trim() : '',
            accountId,
            rawAccountId,
            baseUrl: normalizeIlinkBaseUrl(statusResp.baseurl) || baseUrl,
            userId: typeof statusResp.ilink_user_id === 'string' ? statusResp.ilink_user_id.trim() : '',
            message: 'WeChat connected to OpenClaw.'
          };
        }

        default:
          return {
            ok: false,
            sessionId: session.sessionId,
            status: 'error',
            error: 'qr_unknown_status',
            message: `Unexpected QR status "${String(statusResp.status)}".`
          };
      }
    })();

    session.inFlightPoll = run;
    try {
      return await run;
    } finally {
      if (session.inFlightPoll === run) {
        session.inFlightPoll = null;
      }
    }
  }

  /**
   * Queue a mobile verification code for the next pollStatus() call.
   * @param {string} sessionId
   * @param {string} verifyCode
   */
  function submitVerifyCode(sessionId, verifyCode) {
    const cleanId = typeof sessionId === 'string' ? sessionId.trim() : '';
    const session = cleanId ? sessions.get(cleanId) : null;
    if (!session || session.cancelled) {
      return {
        ok: false,
        error: 'qr_session_not_found',
        message: 'QR login session not found or already closed.'
      };
    }
    const cleanCode = typeof verifyCode === 'string' ? verifyCode.trim().slice(0, 32) : '';
    if (!cleanCode) {
      return {
        ok: false,
        error: 'invalid_request',
        message: 'Verification code is required.'
      };
    }
    session.pendingVerifyCode = cleanCode;
    return {
      ok: true,
      sessionId: session.sessionId,
      queued: true
    };
  }

  /**
   * Cancel and clean up an active QR login session.
   * @param {string} sessionId
   */
  function cancel(sessionId) {
    const cleanId = typeof sessionId === 'string' ? sessionId.trim() : '';
    const session = cleanId ? sessions.get(cleanId) : null;
    if (!session) {
      return { ok: true, sessionId: cleanId, cancelled: false };
    }
    session.cancelled = true;
    try {
      session.activeAbort?.abort();
    } catch {}
    sessions.delete(cleanId);
    return { ok: true, sessionId: cleanId, cancelled: true };
  }

  /**
   * Cancel all active QR login sessions (e.g., on shutdown).
   */
  function cancelAll() {
    for (const sessionId of [...sessions.keys()]) {
      cancel(sessionId);
    }
  }

  /**
   * @param {string} sessionId
   */
  function getSession(sessionId) {
    const cleanId = typeof sessionId === 'string' ? sessionId.trim() : '';
    const session = cleanId ? sessions.get(cleanId) : null;
    return session ? publicSessionView(session) : null;
  }

  return {
    start,
    pollStatus,
    getStatus: pollStatus,
    submitVerifyCode,
    cancel,
    cancelAll,
    getSession
  };
}

module.exports = {
  ACTIVE_LOGIN_TTL_MS,
  DEFAULT_ILINK_BASE_URL,
  DEFAULT_ILINK_BOT_TYPE,
  ILINK_APP_ID,
  ILINK_CLIENT_VERSION,
  MAX_ACTIVE_QR_SESSIONS,
  MAX_QR_REFRESH_COUNT,
  MAX_QR_RESPONSE_BYTES,
  QR_LONG_POLL_TIMEOUT_MS,
  createWeixinQrLoginManager,
  normalizeAllowedRedirectHost,
  normalizeIlinkBaseUrl,
  normalizeWeixinAccountId
};
