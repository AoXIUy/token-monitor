'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const protobuf = require('../src/electron/antigravityManager/protobuf');

test('protobuf varint roundtrip and field encoding/removal', () => {
  for (const num of [0, 1, 127, 128, 16384, 1763942400]) {
    const encoded = protobuf.encodeVarint(num);
    const decoded = protobuf.readVarint(encoded, 0);
    assert.equal(decoded.value, BigInt(num));
    assert.equal(decoded.nextOffset, encoded.length);
  }

  const msg = Buffer.concat([
    protobuf.encodeStringField(1, 'hello'),
    protobuf.encodeVarintField(2, 42),
    protobuf.encodeStringField(3, 'drop-me')
  ]);
  assert.equal(protobuf.findField(msg, 1).toString('utf8'), 'hello');
  assert.equal(protobuf.findVarintField(msg, 2), 42n);
  const stripped = protobuf.removeField(msg, 3);
  assert.equal(protobuf.findField(stripped, 3), null);
  assert.equal(protobuf.findField(stripped, 1).toString('utf8'), 'hello');
});

test('createOAuthInfo clears isGcpTos on personal Gmail domains and preserves it on enterprise domains', () => {
  const gmailInfo = protobuf.createOAuthInfo({
    accessToken: 'ya29.test',
    refreshToken: '1//gmail-rt',
    expiry: 1763942400,
    isGcpTos: true,
    email: 'user@gmail.com'
  });
  assert.equal(protobuf.findField(gmailInfo, 3).toString('utf8'), '1//gmail-rt');
  assert.equal(protobuf.findVarintField(gmailInfo, 6), null);

  const corpInfo = protobuf.createOAuthInfo({
    accessToken: 'ya29.corp',
    refreshToken: '1//corp-rt',
    expiry: 1763942400000,
    isGcpTos: true,
    email: 'dev@acme-corp.com'
  });
  assert.equal(protobuf.findField(corpInfo, 3).toString('utf8'), '1//corp-rt');
  assert.equal(protobuf.findVarintField(corpInfo, 6), 1n);
});

test('unified state entry roundtrip and removeUnifiedTopicEntry preserve unrelated keys', () => {
  const oauthInfo = protobuf.createOAuthInfo({
    accessToken: 'ya29.abc',
    refreshToken: '1//rt-abc',
    expiry: 1763942400,
    isGcpTos: false,
    email: 'alice@gmail.com'
  });
  const encoded = protobuf.createUnifiedStateEntry('oauthTokenInfoSentinelKey', oauthInfo);
  const decoded = protobuf.decodeUnifiedStateEntryWithTarget(encoded, 'oauthTokenInfoSentinelKey');
  assert.equal(decoded.sentinelKey, 'oauthTokenInfoSentinelKey');
  assert.equal(protobuf.findField(decoded.payload, 3).toString('utf8'), '1//rt-abc');

  const combinedTopic = Buffer.concat([
    protobuf.createUnifiedTopicEntry('otherKey', Buffer.from('keep')),
    protobuf.createUnifiedTopicEntry('oauthTokenInfoSentinelKey', oauthInfo)
  ]);
  const afterRemove = protobuf.removeUnifiedTopicEntry(combinedTopic, 'oauthTokenInfoSentinelKey');
  const remaining = protobuf.decodeUnifiedStateEntryWithTarget(afterRemove.toString('base64'), 'otherKey');
  assert.equal(remaining.sentinelKey, 'otherKey');
  assert.equal(remaining.payload.toString('utf8'), 'keep');
});
