'use strict';

const { createApprovalBridge } = require('./approvalBridge');
const { createApprovalClient } = require('./approvalClient');
const { ensureApprovalHookLauncher } = require('./approvalHooks');

function createApprovalAlertRuntime({ dataDir, onError, onAlertSent } = {}) {
  let epoch = 0;
  let binding = '';
  let client = null;
  let bridge = null;
  let chain = Promise.resolve();

  function stopCurrent() {
    binding = '';
    const activeClient = client;
    const activeBridge = bridge;
    client = null;
    bridge = null;
    activeClient?.stop();
    return activeBridge ? activeBridge.stop() : Promise.resolve();
  }

  function reconcile({ enabled, hubUrl, secret = '', deviceId, localOnly = false } = {}) {
    const isLocalOnly = Boolean(localOnly);
    const active = Boolean(enabled && (isLocalOnly || (hubUrl && deviceId)));
    const nextBinding = active
      ? JSON.stringify([isLocalOnly, isLocalOnly ? '' : hubUrl, secret || '', deviceId || ''])
      : '';
    if (nextBinding === binding) return chain;
    epoch += 1;
    const currentEpoch = epoch;
    chain = chain.then(async () => {
      if (currentEpoch !== epoch) return;
      if (!active) {
        await stopCurrent();
        return;
      }
      await stopCurrent();
      if (currentEpoch !== epoch) return;
      try {
        ensureApprovalHookLauncher({ ...(dataDir ? { dataDir } : {}) });
      } catch (error) {
        onError?.(error);
      }
      const nextClient = !isLocalOnly && hubUrl && deviceId
        ? createApprovalClient({ hubUrl, secret, deviceId, onError })
        : null;
      const nextBridge = createApprovalBridge({
        ...(dataDir ? { dataDir } : {}),
        onAlert: async (alert) => {
          const result = nextClient
            ? await nextClient.sendAlert(alert)
            : { ok: false, localOnly: true, reason: 'local_only' };
          if (typeof onAlertSent === 'function') {
            try {
              await onAlertSent(alert, result);
            } catch (error) {
              onError?.(error);
            }
          }
          return result;
        }
      });
      const started = await nextBridge.start();
      if (currentEpoch !== epoch) {
        nextClient?.stop();
        await nextBridge.stop();
        return;
      }
      if (!started.started) {
        nextClient?.stop();
        await nextBridge.stop();
        onError?.(new Error(`Approval alert bridge unavailable: ${started.reason || 'unknown'}`));
        return;
      }
      binding = nextBinding;
      client = nextClient;
      bridge = nextBridge;
    }).catch((error) => {
      onError?.(error);
    });
    return chain;
  }

  function stop() {
    epoch += 1;
    chain = chain.then(() => stopCurrent()).catch(() => {});
    return chain;
  }

  return { reconcile, stop };
}

module.exports = { createApprovalAlertRuntime };
