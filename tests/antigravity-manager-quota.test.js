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

test('fetchQuotaSummary retains proto3-omitted 0% depleted buckets and AbortError does not poison EndpointHealthTracker', async () => {
  const tracker = new quota.EndpointHealthTracker(60_000, () => 1000);
  const groups = await quota.fetchQuotaSummary('ya29.tok', 'proj-1', {
    healthTracker: tracker,
    fetch: async () => new Response(JSON.stringify({
      groups: [
        {
          displayName: 'Gemini',
          buckets: [
            { bucketId: 'gemini-5h', window: '5h', resetTime: '2026-11-23T12:00:00Z' },
            { bucketId: 'gemini-weekly', window: '7d', remainingFraction: 0.4, resetTime: '2026-11-28T00:00:00Z' },
            { bucketId: 'bad-empty', window: '5h', remainingFraction: '' }
          ]
        }
      ]
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].buckets.length, 2);
  assert.equal(groups[0].buckets[0].bucketId, 'gemini-5h');
  assert.equal(groups[0].buckets[0].remainingFraction, 0);

  // AbortError must rethrow without marking endpoints unhealthy or hitting Sandbox
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(() => quota.fetchQuotaSummary('ya29.tok', 'proj-1', {
    healthTracker: tracker,
    signal: controller.signal,
    fetch: async () => {
      calls += 1;
      const err = new Error('Aborted');
      err.name = 'AbortError';
      throw err;
    }
  }), /Aborted/);
  assert.equal(calls, 1);
  assert.equal(tracker.failedAt.size, 0);

  // 401 stops immediately without hitting Sandbox
  let unauthCalls = 0;
  const unauthRes = await quota.fetchQuotaSummary('ya29.bad', 'proj-1', {
    healthTracker: tracker,
    fetch: async () => {
      unauthCalls += 1;
      return new Response('unauthorized', { status: 401 });
    }
  });
  assert.equal(unauthRes, null);
  assert.equal(unauthCalls, 1);

  // Plain-text ban 403 still extracts appeal URL
  const plainBan = quota.classify403Response(403, 'Account has been suspended. Visit https://support.google.com/appeal/123 for help.');
  assert.equal(plainBan.kind, 'banned');
  assert.equal(plainBan.banInfo.appealUrl, 'https://support.google.com/appeal/123');
});

test('fetchAccountQuota preserves UNKNOWN tier when loadCodeAssist fails', async () => {
  const res = await quota.fetchAccountQuota(
    { id: 'acc-1', email: 'u@example.com', subscriptionTier: 'UNKNOWN' },
    { accessToken: 'ya29.valid', refreshToken: '1//rt', expiryTimestamp: Math.floor(Date.now() / 1000) + 7200 },
    {
      fetch: async (url) => {
        if (String(url).includes('loadCodeAssist')) {
          return new Response('error', { status: 500 });
        }
        if (String(url).includes('fetchAvailableModels')) {
          return new Response(JSON.stringify({ models: {} }), { status: 200 });
        }
        return new Response(JSON.stringify({ groups: [] }), { status: 200 });
      }
    }
  );
  assert.equal(res.ok, true);
  assert.equal(res.subscriptionTier, 'UNKNOWN');
});
