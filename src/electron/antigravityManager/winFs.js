// @ts-check
'use strict';

const fs = require('node:fs');

const WIN32_RETRYABLE_RENAME_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
const DEFAULT_RETRY_DELAYS_MS = [20, 40, 80, 140, 220];

/** @type {Int32Array | null} */
let syncSleepCell = null;

/**
 * Best-effort short synchronous pause on Node main/worker threads when Windows AV
 * or an exiting Chromium process transiently locks a rename target.
 * @param {number} ms
 */
function sleepSyncBestEffort(ms) {
  if (!(ms > 0)) return;
  try {
    if (!syncSleepCell) {
      syncSleepCell = new Int32Array(new SharedArrayBuffer(4));
    }
    Atomics.wait(syncSleepCell, 0, 0, ms);
  } catch (_) {
    // Renderer or restricted threads disallow Atomics.wait; retry immediately.
  }
}

/**
 * @param {unknown} error
 * @param {NodeJS.Platform} platform
 * @returns {boolean}
 */
function isRetryableWin32RenameError(error, platform) {
  if (platform !== 'win32') return false;
  const code = String(/** @type {any} */ (error)?.code || '');
  return WIN32_RETRYABLE_RENAME_CODES.has(code);
}

/**
 * Atomic file rename with bounded Windows retry on transient `EPERM`/`EACCES`/`EBUSY`.
 *
 * @param {string} tempPath
 * @param {string} targetPath
 * @param {{
 *   platform?: NodeJS.Platform,
 *   fs?: Pick<typeof fs, 'renameSync'>,
 *   retryDelaysMs?: number[],
 *   sleepSync?: (ms: number) => void
 * }} [options]
 */
function renameAtomicSync(tempPath, targetPath, options = {}) {
  const platform = options.platform || process.platform;
  const renameFn = options.fs?.renameSync || fs.renameSync;
  const delays = options.retryDelaysMs || DEFAULT_RETRY_DELAYS_MS;
  const sleepFn = options.sleepSync || sleepSyncBestEffort;

  for (let attempt = 0; ; attempt += 1) {
    try {
      renameFn(tempPath, targetPath);
      return;
    } catch (error) {
      if (!isRetryableWin32RenameError(error, platform) || attempt >= delays.length) {
        throw error;
      }
      sleepFn(delays[attempt]);
    }
  }
}

/**
 * Async atomic file rename with bounded Windows retry on transient `EPERM`/`EACCES`/`EBUSY`.
 *
 * @param {string} tempPath
 * @param {string} targetPath
 * @param {{
 *   platform?: NodeJS.Platform,
 *   rename?: (oldPath: string, newPath: string) => Promise<void>,
 *   retryDelaysMs?: number[],
 *   sleep?: (ms: number) => Promise<void>
 * }} [options]
 */
async function renameAtomicAsync(tempPath, targetPath, options = {}) {
  const platform = options.platform || process.platform;
  const renameFn = options.rename || fs.promises.rename;
  const delays = options.retryDelaysMs || DEFAULT_RETRY_DELAYS_MS;
  const sleepFn = options.sleep || ((ms) => new Promise((resolve) => {
    setTimeout(resolve, ms);
  }));

  for (let attempt = 0; ; attempt += 1) {
    try {
      await renameFn(tempPath, targetPath);
      return;
    } catch (error) {
      if (!isRetryableWin32RenameError(error, platform) || attempt >= delays.length) {
        throw error;
      }
      await sleepFn(delays[attempt]);
    }
  }
}

module.exports = {
  WIN32_RETRYABLE_RENAME_CODES,
  isRetryableWin32RenameError,
  renameAtomicAsync,
  renameAtomicSync
};
