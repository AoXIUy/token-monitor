'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const quota = require('../src/electron/antigravityManager/quota');

test('quota endpoints keep Daily->Sandbox only (excluding Prod) and EndpointHealthTracker respects 60s cooldown', () => {
  for (const url of [...quota.QUOTA_API_ENDPOINTS, ...quota.QUOTA_SUMMARY_ENDPOINTS]) {
    assert.equal(url.includes('daily-cloudcode-pa'), true);
    assert.equal(url.includes('https://cloudcode-pa.googleapis.com'), false);
  }

  let clock = 10_000;
  const tracker = new quota.EndpointHealthTracker(60_000, () => clock);
  tracker.markFailure(quota.QUOTA_API_ENDPOINTS[0]);
  assert.equal(
    tracker.getOrderedEndpoints(quota.QUOTA_API_ENDPOINTS)[0],
    quota.QUOTA_API_ENDPOINTS[1]
  );

  clock += 61_000;
  assert.equal(
    tracker.getOrderedEndpoints(quota.QUOTA_API_ENDPOINTS)[0],
    quota.QUOTA_API_ENDPOINTS[0]
  );
});

test('modelQuotaPercentage handles proto3 omitted remainingFraction=0 when resetTime exists', () => {
  assert.equal(quota.modelQuotaPercentage({ resetTime: '2026-11-23T12:00:00Z' }), 0);
  assert.equal(quota.modelQuotaPercentage({ remainingFraction: 0.425 }), 43);
  assert.equal(quota.modelQuotaPercentage({}), null);
});

test('classify403Response distinguishes validation_required, model_forbidden, and account ban', () => {
  const val = quota.classify403Response(403, '{"error":{"details":[{"reason":"VALIDATION_REQUIRED"}]}}');
  assert.equal(val.kind, 'validationRequired');

  const modelScoped = quota.classify403Response(403, '{"error":{"message":"Model gemini-3-pro-high unavailable for tier"}}');
  assert.equal(modelScoped.kind, 'modelForbidden');
  assert.equal(modelScoped.modelScope, 'gemini-3-pro-high');

  const ban = quota.classify403Response(403, '{"error":{"message":"Account suspended due to TOS_VIOLATION","status":"PERMISSION_DENIED"}}');
  assert.equal(ban.kind, 'banned');
  assert.equal(ban.banInfo.code, 'TOS_VIOLATION');
});

test('Gemini 4 codename extraction and group matching isolate argon from non-Ultra tiers', () => {
  assert.equal(quota.extractGemini4Codename('gemini-4.0-argon-high'), 'argon');
  assert.equal(quota.extractGemini4Codename('gemini-4-pro-high'), null);
  assert.equal(quota.isModelCompliantWithBaseline('gemini-2.5-pro'), false);
  assert.equal(quota.isModelCompliantWithBaseline('gemini-3.1-pro-high'), true);

  const groups = [
    { displayName: 'Claude & 3P', buckets: [{ bucketId: 'claude-5h', remainingFraction: 0.7 }] },
    { displayName: 'Gemini General', buckets: [{ bucketId: 'gemini-5h', remainingFraction: 0.9 }] }
  ];
  const freeArgon = quota.matchQuotaGroupForModel(groups, 'gemini-4.0-argon-high', false, ['argon']);
  assert.equal(freeArgon.kind, 'skipUnauthorized');
  const claudeMatch = quota.matchQuotaGroupForModel(groups, 'claude-sonnet-4-6', false, ['argon']);
  assert.equal(claudeMatch.kind, 'matched');
  assert.equal(claudeMatch.group.displayName, 'Claude & 3P');
});

test('runSlidingWindowBatch respects concurrency limit and AbortSignal cancellation', async () => {
  let active = 0;
  let maxActive = 0;
  const items = [1, 2, 3, 4, 5, 6];
  const controller = new AbortController();
  const seen = [];

  const res = await quota.runSlidingWindowBatch(items, {
    concurrency: 2,
    slideDelaySecs: 0,
    signal: controller.signal,
    worker: async (item) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      seen.push(item);
      await new Promise((r) => setTimeout(r, 10));
      active -= 1;
      if (seen.length >= 4) controller.abort();
      return true;
    }
  });

  assert.ok(maxActive <= 2);
  assert.ok(res.success >= 2 && res.total === 6);
});
