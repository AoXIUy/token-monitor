'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_CONFIG } = require('../src/electron/antigravityManager/store');
const {
  shouldTriggerAutoRefresh,
  createAntigravityManagerScheduler
} = require('../src/electron/antigravityManager/scheduler');

test('DEFAULT_CONFIG disables both startupRefresh and autoRefresh with 10-minute default interval', () => {
  assert.equal(DEFAULT_CONFIG.startupRefresh, false);
  assert.equal(DEFAULT_CONFIG.autoRefresh, false);
  assert.equal(DEFAULT_CONFIG.refreshIntervalMinutes, 10);
});

test('shouldTriggerAutoRefresh respects off switch, interval boundary, and single-flight lock', () => {
  assert.equal(shouldTriggerAutoRefresh(false, 10, 1000, 0, false), false);
  assert.equal(shouldTriggerAutoRefresh(true, 10, 1000, 1000 - 599, false), false);
  assert.equal(shouldTriggerAutoRefresh(true, 10, 1000, 1000 - 600, false), true);
  assert.equal(shouldTriggerAutoRefresh(true, 10, 1000, 1000 - 600, true), false);
  assert.equal(shouldTriggerAutoRefresh(true, 0, 1000, 0, false), false);
});

test('scheduler skips startup refresh when startupRefresh is false and triggers once when enabled', async () => {
  let runs = 0;
  const offScheduler = createAntigravityManagerScheduler({
    getConfig: () => ({ startupRefresh: false, autoRefresh: false, refreshIntervalMinutes: 10 }),
    getAccountCount: () => 2,
    onRefreshAll: async () => { runs += 1; },
    pollMs: 1000,
    startupDelayMs: 5
  });
  offScheduler.start();
  await new Promise((r) => setTimeout(r, 30));
  offScheduler.stop();
  assert.equal(runs, 0);

  let startupReasons = [];
  const onScheduler = createAntigravityManagerScheduler({
    getConfig: () => ({ startupRefresh: true, autoRefresh: false, refreshIntervalMinutes: 10 }),
    getAccountCount: () => 2,
    onRefreshAll: async (reason) => { startupReasons.push(reason); },
    pollMs: 1000,
    startupDelayMs: 5
  });
  onScheduler.start();
  await new Promise((r) => setTimeout(r, 30));
  onScheduler.stop();
  assert.deepEqual(startupReasons, ['startup']);
});

test('scheduler tryAcquireLock enforces single-flight exclusion', () => {
  const scheduler = createAntigravityManagerScheduler({
    getConfig: () => ({ startupRefresh: false, autoRefresh: false, refreshIntervalMinutes: 10 }),
    getAccountCount: () => 0,
    onRefreshAll: async () => {}
  });
  assert.equal(scheduler.isRefreshing(), false);
  assert.equal(scheduler.tryAcquireLock(), true);
  assert.equal(scheduler.isRefreshing(), true);
  assert.equal(scheduler.tryAcquireLock(), false);
  scheduler.releaseLock();
  assert.equal(scheduler.isRefreshing(), false);
});
