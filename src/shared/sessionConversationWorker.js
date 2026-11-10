'use strict';

const { parentPort, workerData } = require('node:worker_threads');
const { readSessionConversation } = require('./sessionConversation');

const native = readSessionConversation(workerData.query, workerData.options);
if (native.error === 'source_unavailable' && process.platform === 'win32' && workerData.wslScanEnabled) {
  const { wslUsageHomes } = require('./wslUsage');
  let result = native;
  for (const home of wslUsageHomes()) {
    const candidate = readSessionConversation(workerData.query, { home, env: {} });
    if (candidate.error !== 'source_unavailable') { result = candidate; break; }
  }
  parentPort.postMessage(result);
} else parentPort.postMessage(native);
