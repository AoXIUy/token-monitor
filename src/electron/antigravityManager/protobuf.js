// @ts-check
'use strict';

const PERSONAL_DOMAINS = ['@gmail.com', '@outlook.com', '@hotmail.com', '@qq.com', '@163.com'];

/**
 * Encode an unsigned integer/BigInt as Protobuf varint.
 * @param {number | bigint} value
 * @returns {Buffer}
 */
function encodeVarint(value) {
  let v = typeof value === 'bigint' ? BigInt.asUintN(64, value) : BigInt.asUintN(64, BigInt(Math.trunc(Number(value) || 0)));
  /** @type {number[]} */
  const bytes = [];
  while (v >= 0x80n) {
    bytes.push(Number((v & 0x7fn) | 0x80n));
    v >>= 7n;
  }
  bytes.push(Number(v));
  return Buffer.from(bytes);
}

/**
 * Read a Protobuf varint starting at offset.
 * @param {Buffer} data
 * @param {number} offset
 * @returns {{ value: bigint, nextOffset: number }}
 */
function readVarint(data, offset) {
  let result = 0n;
  let shift = 0n;
  let pos = offset;
  while (true) {
    if (pos >= data.length) {
      throw new Error('incomplete_data');
    }
    const byte = data[pos];
    result |= BigInt(byte & 0x7f) << shift;
    pos += 1;
    if ((byte & 0x80) === 0) break;
    shift += 7n;
    if (shift > 63n) {
      throw new Error('varint_overflow');
    }
  }
  return { value: result, nextOffset: pos };
}

/**
 * Skip a Protobuf field value according to wireType.
 * @param {Buffer} data
 * @param {number} offset
 * @param {number} wireType
 * @returns {number}
 */
function skipField(data, offset, wireType) {
  if (wireType === 0) {
    return readVarint(data, offset).nextOffset;
  }
  if (wireType === 1) {
    if (offset + 8 > data.length) throw new Error('incomplete_64bit');
    return offset + 8;
  }
  if (wireType === 2) {
    const { value: length, nextOffset } = readVarint(data, offset);
    const end = nextOffset + Number(length);
    if (end > data.length) throw new Error('incomplete_len_delim');
    return end;
  }
  if (wireType === 5) {
    if (offset + 4 > data.length) throw new Error('incomplete_32bit');
    return offset + 4;
  }
  throw new Error(`unknown_wire_type: ${wireType}`);
}

/**
 * Remove all occurrences of a field number from a Protobuf message.
 * @param {Buffer} data
 * @param {number} fieldNum
 * @returns {Buffer}
 */
function removeField(data, fieldNum) {
  /** @type {Buffer[]} */
  const chunks = [];
  let offset = 0;
  while (offset < data.length) {
    const start = offset;
    const { value: tag, nextOffset } = readVarint(data, offset);
    const wireType = Number(tag & 7n);
    const currentField = Number(tag >> 3n);
    const endOffset = skipField(data, nextOffset, wireType);
    if (currentField !== fieldNum) {
      chunks.push(data.subarray(start, endOffset));
    }
    offset = endOffset;
  }
  return Buffer.concat(chunks);
}

/**
 * Find the first length-delimited field matching targetField.
 * @param {Buffer} data
 * @param {number} targetField
 * @returns {Buffer | null}
 */
function findField(data, targetField) {
  let offset = 0;
  while (offset < data.length) {
    let parsed;
    try {
      parsed = readVarint(data, offset);
    } catch (_) {
      break;
    }
    const wireType = Number(parsed.value & 7n);
    const fieldNum = Number(parsed.value >> 3n);
    if (fieldNum === targetField && wireType === 2) {
      const lenParsed = readVarint(data, parsed.nextOffset);
      const len = Number(lenParsed.value);
      const end = lenParsed.nextOffset + len;
      if (end > data.length) throw new Error('incomplete_len_delim');
      return Buffer.from(data.subarray(lenParsed.nextOffset, end));
    }
    offset = skipField(data, parsed.nextOffset, wireType);
  }
  return null;
}

/**
 * Find all length-delimited fields matching targetField.
 * @param {Buffer} data
 * @param {number} targetField
 * @returns {Buffer[]}
 */
function findAllFields(data, targetField) {
  /** @type {Buffer[]} */
  const results = [];
  let offset = 0;
  while (offset < data.length) {
    let parsed;
    try {
      parsed = readVarint(data, offset);
    } catch (_) {
      break;
    }
    const wireType = Number(parsed.value & 7n);
    const fieldNum = Number(parsed.value >> 3n);
    if (fieldNum === targetField && wireType === 2) {
      const lenParsed = readVarint(data, parsed.nextOffset);
      const len = Number(lenParsed.value);
      const end = lenParsed.nextOffset + len;
      if (end <= data.length) {
        results.push(Buffer.from(data.subarray(lenParsed.nextOffset, end)));
      }
      offset = end;
    } else {
      offset = skipField(data, parsed.nextOffset, wireType);
    }
  }
  return results;
}

/**
 * Find the first varint field matching targetField.
 * @param {Buffer} data
 * @param {number} targetField
 * @returns {bigint | null}
 */
function findVarintField(data, targetField) {
  let offset = 0;
  while (offset < data.length) {
    const { value: tag, nextOffset } = readVarint(data, offset);
    const wireType = Number(tag & 7n);
    const fieldNum = Number(tag >> 3n);
    if (fieldNum === targetField && wireType === 0) {
      return readVarint(data, nextOffset).value;
    }
    offset = skipField(data, nextOffset, wireType);
  }
  return null;
}

/**
 * @param {number} fieldNum
 * @param {Buffer} data
 * @returns {Buffer}
 */
function encodeLenDelimField(fieldNum, data) {
  const tag = (BigInt(fieldNum) << 3n) | 2n;
  return Buffer.concat([encodeVarint(tag), encodeVarint(data.length), data]);
}

/**
 * @param {number} fieldNum
 * @param {string} value
 * @returns {Buffer}
 */
function encodeStringField(fieldNum, value) {
  return encodeLenDelimField(fieldNum, Buffer.from(String(value || ''), 'utf8'));
}

/**
 * @param {number} fieldNum
 * @param {number | bigint} value
 * @returns {Buffer}
 */
function encodeVarintField(fieldNum, value) {
  const tag = (BigInt(fieldNum) << 3n) | 0n;
  return Buffer.concat([encodeVarint(tag), encodeVarint(value)]);
}

/**
 * Create OAuthTokenInfo message (new unified format without outer Field 6 wrapper).
 * @param {{
 *   accessToken: string,
 *   refreshToken: string,
 *   expiry: number,
 *   isGcpTos?: boolean,
 *   idToken?: string | null,
 *   email?: string | null
 * }} input
 * @returns {Buffer}
 */
function createOAuthInfo({ accessToken, refreshToken, expiry, isGcpTos = false, idToken = null, email = null }) {
  let gcpTos = Boolean(isGcpTos);
  if (email) {
    const lower = String(email).trim().toLowerCase();
    if (PERSONAL_DOMAINS.some((domain) => lower.endsWith(domain)) && gcpTos) {
      gcpTos = false;
    }
  }
  const expirySecs = Number(expiry) > 10_000_000_000 ? Math.trunc(Number(expiry) / 1000) : Math.trunc(Number(expiry) || 0);
  const timestampMsg = Buffer.concat([
    encodeVarintField(1, expirySecs),
    encodeVarintField(2, 0)
  ]);

  /** @type {Buffer[]} */
  const parts = [
    encodeStringField(1, accessToken),
    encodeStringField(2, 'Bearer'),
    encodeStringField(3, refreshToken),
    encodeLenDelimField(4, timestampMsg)
  ];
  if (idToken) parts.push(encodeStringField(5, idToken));
  if (gcpTos) parts.push(encodeVarintField(6, 1));
  return Buffer.concat(parts);
}

/**
 * @param {string} value
 * @returns {Buffer}
 */
function createStringValuePayload(value) {
  return encodeStringField(3, value);
}

/**
 * @param {string} email
 * @returns {Buffer}
 */
function createMinimalUserStatusPayload(email) {
  return Buffer.concat([
    encodeStringField(3, email),
    encodeStringField(7, email)
  ]);
}

/**
 * @param {string} sentinelKey
 * @param {Buffer} payload
 * @returns {Buffer}
 */
function createUnifiedTopicEntry(sentinelKey, payload) {
  const row = encodeStringField(1, payload.toString('base64'));
  const entry = Buffer.concat([
    encodeStringField(1, sentinelKey),
    encodeLenDelimField(2, row)
  ]);
  return encodeLenDelimField(1, entry);
}

/**
 * @param {string} sentinelKey
 * @param {Buffer} payload
 * @returns {string}
 */
function createUnifiedStateEntry(sentinelKey, payload) {
  return createUnifiedTopicEntry(sentinelKey, payload).toString('base64');
}

/**
 * @param {Buffer} entryBuf
 * @returns {string | null}
 */
function unifiedTopicEntryKey(entryBuf) {
  const keyBuf = findField(entryBuf, 1);
  return keyBuf ? keyBuf.toString('utf8') : null;
}

/**
 * Remove a sentinel entry from Topic.data while preserving other sentinel rows.
 * @param {Buffer} data
 * @param {string} targetKey
 * @returns {Buffer}
 */
function removeUnifiedTopicEntry(data, targetKey) {
  /** @type {Buffer[]} */
  const chunks = [];
  let offset = 0;
  while (offset < data.length) {
    const start = offset;
    const { value: tag, nextOffset } = readVarint(data, offset);
    const wireType = Number(tag & 7n);
    const fieldNum = Number(tag >> 3n);
    const endOffset = skipField(data, nextOffset, wireType);
    let shouldRemove = false;
    if (fieldNum === 1 && wireType === 2) {
      const lenParsed = readVarint(data, nextOffset);
      const entry = data.subarray(lenParsed.nextOffset, lenParsed.nextOffset + Number(lenParsed.value));
      shouldRemove = unifiedTopicEntryKey(entry) === targetKey;
    }
    if (!shouldRemove) {
      chunks.push(data.subarray(start, endOffset));
    }
    offset = endOffset;
  }
  return Buffer.concat(chunks);
}

/**
 * @param {Buffer} payload
 * @returns {Buffer}
 */
function decodeLegacyBase64PayloadIfNeeded(payload) {
  if (payload.length === 0 || payload.length % 4 !== 0) return payload;
  const text = payload.toString('ascii');
  if (!/^[A-Za-z0-9+/=]+$/.test(text)) return payload;
  const decoded = Buffer.from(text, 'base64');
  return decoded.length > 0 ? decoded : payload;
}

/**
 * @param {Buffer} topicBlob
 * @param {string | null} [preferredKey]
 * @returns {{ sentinelKey: string, payload: Buffer }}
 */
function decodeTopicRowPayloadWithTarget(topicBlob, preferredKey = null) {
  const entries = findAllFields(topicBlob, 1);
  if (entries.length === 0) throw new Error('Topic data entry not found');
  /** @type {{ sentinelKey: string, payload: Buffer } | null} */
  let firstValid = null;
  for (const dataEntry of entries) {
    const keyBuf = findField(dataEntry, 1);
    const rowBlob = findField(dataEntry, 2);
    if (!keyBuf || !rowBlob) continue;
    const sentinelKey = keyBuf.toString('utf8');
    const encodedPayload = findField(rowBlob, 1);
    if (!encodedPayload) continue;
    const encodedText = encodedPayload.toString('utf8');
    /** @type {Buffer} */
    let payload = Buffer.from(encodedText, 'base64');
    if (payload.length === 0 && encodedText.length > 0) {
      payload = Buffer.from(encodedPayload);
    }
    if (preferredKey && sentinelKey === preferredKey) {
      return { sentinelKey, payload };
    }
    if (!firstValid) firstValid = { sentinelKey, payload };
  }
  if (!firstValid) throw new Error('No valid topic row payload decoded');
  return firstValid;
}

/**
 * @param {Buffer} outerBlob
 * @returns {{ sentinelKey: string, payload: Buffer }}
 */
function decodeLegacyUnifiedStateEntry(outerBlob) {
  const innerBlob = findField(outerBlob, 1);
  if (!innerBlob) throw new Error('Outer Field 1 not found');
  const keyBuf = findField(innerBlob, 1);
  if (!keyBuf) throw new Error('Inner Field 1 not found');
  const payload = findField(innerBlob, 2);
  if (!payload) throw new Error('Inner Field 2 not found');
  return {
    sentinelKey: keyBuf.toString('utf8'),
    payload: decodeLegacyBase64PayloadIfNeeded(payload)
  };
}

/**
 * Decode unified state sync entry, returning sentinelKey and raw payload Buffer.
 * @param {string} outerB64
 * @param {string | null} [preferredKey]
 * @returns {{ sentinelKey: string, payload: Buffer }}
 */
function decodeUnifiedStateEntryWithTarget(outerB64, preferredKey = null) {
  const outerBlob = Buffer.from(String(outerB64 || ''), 'base64');
  if (outerBlob.length === 0) throw new Error('Outer Base64 decoding failed');
  try {
    return decodeTopicRowPayloadWithTarget(outerBlob, preferredKey);
  } catch (_) {
    return decodeLegacyUnifiedStateEntry(outerBlob);
  }
}

module.exports = {
  createMinimalUserStatusPayload,
  createOAuthInfo,
  createStringValuePayload,
  createUnifiedStateEntry,
  createUnifiedTopicEntry,
  decodeUnifiedStateEntryWithTarget,
  encodeLenDelimField,
  encodeStringField,
  encodeVarint,
  encodeVarintField,
  findAllFields,
  findField,
  findVarintField,
  readVarint,
  removeField,
  removeUnifiedTopicEntry,
  skipField
};
