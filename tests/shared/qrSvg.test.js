'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const {
  encodeQrMatrix,
  qrPathData,
  renderQrSvgMarkup
} = require('../../src/shared/qrSvg');

// Minimal ISO/IEC 18004 EC-M decoder to verify generated QR matrices round-trip mathematically.
const VERSION_EC_M = {
  1: [10, 1, 16, 0, 0],
  2: [16, 1, 28, 0, 0],
  3: [26, 1, 44, 0, 0],
  4: [18, 2, 32, 0, 0],
  5: [24, 2, 43, 0, 0],
  6: [16, 4, 27, 0, 0],
  7: [18, 4, 31, 0, 0],
  8: [22, 2, 38, 2, 39],
  9: [22, 3, 36, 2, 37],
  10: [26, 4, 43, 1, 44],
  11: [30, 1, 50, 4, 51],
  12: [22, 6, 36, 2, 37],
  13: [22, 8, 37, 1, 38],
  14: [24, 4, 40, 5, 41],
  15: [24, 5, 41, 5, 42]
};

const ALIGN_CENTERS = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
  11: [6, 30, 54],
  12: [6, 32, 58],
  13: [6, 34, 62],
  14: [6, 26, 46, 66],
  15: [6, 26, 48, 70]
};

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
{
  let v = 1;
  for (let i = 0; i < 255; i += 1) {
    GF_EXP[i] = v;
    GF_EXP[i + 255] = v;
    GF_LOG[v] = i;
    v <<= 1;
    if (v & 0x100) v ^= 0x11d;
  }
}

function gfMul(a, b) {
  return (a === 0 || b === 0) ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsSyndromeZero(block, ecCount) {
  for (let root = 0; root < ecCount; root += 1) {
    const x = GF_EXP[root];
    let sum = 0;
    for (let i = 0; i < block.length; i += 1) {
      sum = gfMul(sum, x) ^ block[i];
    }
    if (sum !== 0) return false;
  }
  return true;
}

function maskBit(maskId, r, c) {
  switch (maskId) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    case 7: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    default: return false;
  }
}

function buildReservedGrid(version, size) {
  const reserved = Array.from({ length: size }, () => Array(size).fill(false));
  const markRect = (r0, c0, h, w) => {
    for (let r = Math.max(0, r0); r < Math.min(size, r0 + h); r += 1) {
      for (let c = Math.max(0, c0); c < Math.min(size, c0 + w); c += 1) {
        reserved[r][c] = true;
      }
    }
  };
  markRect(0, 0, 9, 9);
  markRect(0, size - 8, 9, 8);
  markRect(size - 8, 0, 8, 9);
  for (let i = 8; i < size - 8; i += 1) {
    reserved[6][i] = true;
    reserved[i][6] = true;
  }
  const centers = ALIGN_CENTERS[version];
  for (const cr of centers) {
    for (const cc of centers) {
      if (!reserved[cr][cc]) markRect(cr - 2, cc - 2, 5, 5);
    }
  }
  if (version >= 7) {
    markRect(size - 11, 0, 3, 6);
    markRect(0, size - 11, 6, 3);
  }
  return reserved;
}

function decodeQrMatrix(result) {
  const { version, size, modules } = result;
  assert.equal(size, 17 + version * 4);
  assert.equal(modules[4 * version + 9][8], 1, 'dark module must be set');

  // Read format info from top-left strip and unmask with 0x5412.
  let rawFormat = 0;
  for (let i = 0; i < 6; i += 1) rawFormat = (rawFormat << 1) | modules[8][i];
  rawFormat = (rawFormat << 1) | modules[8][7];
  rawFormat = (rawFormat << 1) | modules[8][8];
  rawFormat = (rawFormat << 1) | modules[7][8];
  for (let i = 5; i >= 0; i -= 1) rawFormat = (rawFormat << 1) | modules[i][8];
  // Top-left reads bit 14..0 from (8,0)..(0,8) — reverse check against top-right/bottom-left copy.
  let fmt = 0;
  for (let i = 0; i < 6; i += 1) fmt |= (modules[i][8] << i);
  fmt |= (modules[7][8] << 6);
  fmt |= (modules[8][8] << 7);
  fmt |= (modules[8][7] << 8);
  for (let i = 9; i < 15; i += 1) fmt |= (modules[8][14 - i] << i);
  const unmaskedFmt = fmt ^ 0x5412;
  const ecLevelBits = (unmaskedFmt >>> 13) & 0x3;
  const maskId = (unmaskedFmt >>> 10) & 0x7;
  assert.equal(ecLevelBits, 0, 'EC level M must encode as 00');
  assert.equal(maskId, result.mask);

  // Read zigzag data bits.
  const reserved = buildReservedGrid(version, size);
  const bits = [];
  let upward = true;
  for (let rightCol = size - 1; rightCol > 0; rightCol -= 2) {
    if (rightCol === 6) rightCol -= 1;
    for (let step = 0; step < size; step += 1) {
      const r = upward ? size - 1 - step : step;
      for (let off = 0; off < 2; off += 1) {
        const c = rightCol - off;
        if (reserved[r][c]) continue;
        const bit = modules[r][c] ^ (maskBit(maskId, r, c) ? 1 : 0);
        bits.push(bit);
      }
    }
    upward = !upward;
  }

  const [ecPerBlock, g1Blocks, g1Data, g2Blocks, g2Data] = VERSION_EC_M[version];
  const totalDataBytes = g1Blocks * g1Data + g2Blocks * g2Data;
  const totalCodewords = totalDataBytes + (g1Blocks + g2Blocks) * ecPerBlock;
  assert.ok(bits.length >= totalCodewords * 8, 'matrix must hold all codewords');

  const codewords = new Uint8Array(totalCodewords);
  for (let i = 0; i < totalCodewords; i += 1) {
    let b = 0;
    for (let j = 0; j < 8; j += 1) b = (b << 1) | bits[i * 8 + j];
    codewords[i] = b;
  }

  // De-interleave blocks and verify Reed-Solomon syndromes.
  const totalBlocks = g1Blocks + g2Blocks;
  const blockDataLens = [
    ...Array(g1Blocks).fill(g1Data),
    ...Array(g2Blocks).fill(g2Data)
  ];
  const dataBlocks = blockDataLens.map((len) => new Uint8Array(len));
  const ecBlocks = Array.from({ length: totalBlocks }, () => new Uint8Array(ecPerBlock));
  let idx = 0;
  const maxDataLen = Math.max(g1Data, g2Data);
  for (let col = 0; col < maxDataLen; col += 1) {
    for (let b = 0; b < totalBlocks; b += 1) {
      if (col < blockDataLens[b]) dataBlocks[b][col] = codewords[idx++];
    }
  }
  for (let col = 0; col < ecPerBlock; col += 1) {
    for (let b = 0; b < totalBlocks; b += 1) {
      ecBlocks[b][col] = codewords[idx++];
    }
  }

  for (let b = 0; b < totalBlocks; b += 1) {
    const full = new Uint8Array(blockDataLens[b] + ecPerBlock);
    full.set(dataBlocks[b], 0);
    full.set(ecBlocks[b], blockDataLens[b]);
    assert.equal(rsSyndromeZero(full, ecPerBlock), true, `RS syndrome must be zero for block ${b}`);
  }

  const stream = new Uint8Array(totalDataBytes);
  let pos = 0;
  for (const blk of dataBlocks) {
    stream.set(blk, pos);
    pos += blk.length;
  }
  const streamBits = [];
  for (const byte of stream) {
    for (let b = 7; b >= 0; b -= 1) streamBits.push((byte >>> b) & 1);
  }
  const readBits = (start, len) => {
    let val = 0;
    for (let i = 0; i < len; i += 1) val = (val << 1) | streamBits[start + i];
    return val;
  };
  const mode = readBits(0, 4);
  assert.equal(mode, 0b0100, 'must be byte mode');
  const countBits = version <= 9 ? 8 : 16;
  const charCount = readBits(4, countBits);
  const outBytes = new Uint8Array(charCount);
  let bitCursor = 4 + countBits;
  for (let i = 0; i < charCount; i += 1) {
    outBytes[i] = readBits(bitCursor, 8);
    bitCursor += 8;
  }
  return new TextDecoder().decode(outBytes);
}

test('qrSvg encodes WeChat URLs, UTF-8 text, and large payloads with valid Reed-Solomon blocks', () => {
  const samples = [
    'hello',
    'https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=34e57804cc094652cb8068e093be6eb4&bot_type=3',
    'Token Monitor 微信扫码绑定测试-2026',
    `https://liteapp.weixin.qq.com/q/${'a'.repeat(300)}`
  ];

  for (const sample of samples) {
    const encoded = encodeQrMatrix(sample);
    assert.equal(decodeQrMatrix(encoded), sample);
  }
});

test('qrPathData and renderQrSvgMarkup handle matrix objects, raw arrays, and browser global UMD', () => {
  const url = 'https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=34e57804cc094652cb8068e093be6eb4&bot_type=3';
  const matrix = encodeQrMatrix(url);

  const fromObj = qrPathData(matrix, 4);
  const fromArr = qrPathData(matrix.modules, 4);
  assert.equal(fromObj.size, matrix.size);
  assert.equal(fromObj.totalSize, matrix.size + 8);
  assert.equal(fromObj.path, fromArr.path);
  assert.match(fromObj.path, /^M\d+ \d+h\d+v1h-\d+z/);

  const svg = renderQrSvgMarkup(url, { sizePx: 180 });
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 \d+ \d+" width="180" height="180"/);
  assert.match(svg, /fill="#ffffff"/);
  assert.match(svg, /fill="#111111"/);

  // Verify browser-global script loading (no Node built-ins).
  const source = fs.readFileSync(path.join(__dirname, '../../src/shared/qrSvg.js'), 'utf8');
  const sandbox = { globalThis: {}, TextEncoder };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  assert.equal(typeof sandbox.globalThis.TokenMonitorQrSvg?.encodeQrMatrix, 'function');
  assert.equal(typeof sandbox.globalThis.TokenMonitorQrSvg?.qrPathData, 'function');
  assert.equal(sandbox.globalThis.TokenMonitorQrSvg.encodeQrMatrix(url).size, matrix.size);
});
