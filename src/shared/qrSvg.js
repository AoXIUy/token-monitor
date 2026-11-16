// @ts-check
'use strict';

/**
 * Pure-JS QR Code Model 2 encoder & SVG renderer (Byte mode UTF-8, EC level M, Versions 1..20).
 * Zero dependencies, zero Node built-ins; works in both CommonJS and browser globals.
 */
(function exposeQrSvg(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) /** @type {any} */ (root).TokenMonitorQrSvg = api;
})(typeof globalThis !== 'undefined' ? globalThis : null, function createQrSvgApi() {
  // ISO/IEC 18004 Table 9 — Error Correction Level M parameters for Versions 1..20.
  // [version, ecPerBlock, g1Blocks, g1DataBytes, g2Blocks, g2DataBytes, alignmentCenters]
  /** @type {ReadonlyArray<readonly [number, number, number, number, number, number, readonly number[]]>} */
  const VERSION_SPECS = Object.freeze([
    [1, 10, 1, 16, 0, 0, []],
    [2, 16, 1, 28, 0, 0, [6, 18]],
    [3, 26, 1, 44, 0, 0, [6, 22]],
    [4, 18, 2, 32, 0, 0, [6, 26]],
    [5, 24, 2, 43, 0, 0, [6, 30]],
    [6, 16, 4, 27, 0, 0, [6, 34]],
    [7, 18, 4, 31, 0, 0, [6, 22, 38]],
    [8, 22, 2, 38, 2, 39, [6, 24, 42]],
    [9, 22, 3, 36, 2, 37, [6, 26, 46]],
    [10, 26, 4, 43, 1, 44, [6, 28, 50]],
    [11, 30, 1, 50, 4, 51, [6, 30, 54]],
    [12, 22, 6, 36, 2, 37, [6, 32, 58]],
    [13, 22, 8, 37, 1, 38, [6, 34, 62]],
    [14, 24, 4, 40, 5, 41, [6, 26, 46, 66]],
    [15, 24, 5, 41, 5, 42, [6, 26, 48, 70]],
    [16, 28, 7, 45, 3, 46, [6, 26, 50, 74]],
    [17, 28, 10, 46, 1, 47, [6, 30, 54, 78]],
    [18, 26, 9, 43, 4, 44, [6, 30, 56, 82]],
    [19, 26, 3, 44, 11, 45, [6, 30, 58, 86]],
    [20, 26, 3, 41, 13, 42, [6, 34, 62, 90]]
  ]);

  // GF(256) log / exp tables with primitive polynomial 0x11d.
  const GF_EXP = new Uint8Array(512);
  const GF_LOG = new Uint8Array(256);
  {
    let val = 1;
    for (let i = 0; i < 255; i += 1) {
      GF_EXP[i] = val;
      GF_EXP[i + 255] = val;
      GF_LOG[val] = i;
      val <<= 1;
      if (val & 0x100) val ^= 0x11d;
    }
    GF_EXP[510] = GF_EXP[0];
  }

  /**
   * @param {number} a
   * @param {number} b
   * @returns {number}
   */
  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return GF_EXP[GF_LOG[a] + GF_LOG[b]];
  }

  /** @type {Map<number, Uint8Array>} */
  const rsGeneratorCache = new Map();

  /**
   * @param {number} degree
   * @returns {Uint8Array}
   */
  function rsGeneratorPoly(degree) {
    const cached = rsGeneratorCache.get(degree);
    if (cached) return cached;
    let poly = new Uint8Array([1]);
    for (let i = 0; i < degree; i += 1) {
      const next = new Uint8Array(poly.length + 1);
      const factor = GF_EXP[i];
      for (let j = 0; j < poly.length; j += 1) {
        next[j] ^= poly[j];
        next[j + 1] ^= gfMul(poly[j], factor);
      }
      poly = next;
    }
    rsGeneratorCache.set(degree, poly);
    return poly;
  }

  /**
   * @param {Uint8Array} data
   * @param {number} ecCount
   * @returns {Uint8Array}
   */
  function rsComputeEc(data, ecCount) {
    const gen = rsGeneratorPoly(ecCount);
    const buf = new Uint8Array(data.length + ecCount);
    buf.set(data, 0);
    for (let i = 0; i < data.length; i += 1) {
      const coef = buf[i];
      if (coef === 0) continue;
      for (let j = 0; j < gen.length; j += 1) {
        buf[i + j] ^= gfMul(gen[j], coef);
      }
    }
    return buf.slice(data.length);
  }

  /**
   * @param {number} byteLen
   */
  function selectVersionSpec(byteLen) {
    for (const spec of VERSION_SPECS) {
      const version = spec[0];
      const totalDataBytes = spec[2] * spec[3] + spec[4] * spec[5];
      const countBits = version <= 9 ? 8 : 16;
      const headerBits = 4 + countBits;
      const requiredBits = headerBits + byteLen * 8;
      if (requiredBits <= totalDataBytes * 8) {
        return spec;
      }
    }
    throw new Error(`QR payload too large (${byteLen} bytes; max supported ~666 bytes)`);
  }

  /**
   * @param {Uint8Array} bytes
   * @param {readonly [number, number, number, number, number, number, readonly number[]]} spec
   * @returns {Uint8Array}
   */
  function encodeCodewords(bytes, spec) {
    const [version, ecPerBlock, g1Blocks, g1DataBytes, g2Blocks, g2DataBytes] = spec;
    const totalDataBytes = g1Blocks * g1DataBytes + g2Blocks * g2DataBytes;
    const capacityBits = totalDataBytes * 8;

    /** @type {number[]} */
    const bits = [];
    /**
     * @param {number} value
     * @param {number} length
     */
    const pushBits = (value, length) => {
      for (let i = length - 1; i >= 0; i -= 1) {
        bits.push((value >>> i) & 1);
      }
    };

    // Byte mode indicator (0100) + byte length.
    pushBits(0b0100, 4);
    pushBits(bytes.length, version <= 9 ? 8 : 16);
    for (let i = 0; i < bytes.length; i += 1) {
      pushBits(bytes[i], 8);
    }

    // Terminator (up to 4 zero bits) + pad to byte boundary.
    const terminatorLen = Math.min(4, capacityBits - bits.length);
    for (let i = 0; i < terminatorLen; i += 1) bits.push(0);
    while (bits.length % 8 !== 0) bits.push(0);

    const dataCodewords = new Uint8Array(totalDataBytes);
    let byteIndex = 0;
    for (let i = 0; i < bits.length; i += 8) {
      let b = 0;
      for (let j = 0; j < 8; j += 1) b = (b << 1) | bits[i + j];
      dataCodewords[byteIndex++] = b;
    }

    const padBytes = [0xec, 0x11];
    let padIdx = 0;
    while (byteIndex < totalDataBytes) {
      dataCodewords[byteIndex++] = padBytes[padIdx % 2];
      padIdx += 1;
    }

    // Split into blocks and compute Reed-Solomon EC codewords.
    /** @type {Uint8Array[]} */
    const dataBlocks = [];
    /** @type {Uint8Array[]} */
    const ecBlocks = [];
    let offset = 0;
    for (let i = 0; i < g1Blocks; i += 1) {
      const blk = dataCodewords.slice(offset, offset + g1DataBytes);
      offset += g1DataBytes;
      dataBlocks.push(blk);
      ecBlocks.push(rsComputeEc(blk, ecPerBlock));
    }
    for (let i = 0; i < g2Blocks; i += 1) {
      const blk = dataCodewords.slice(offset, offset + g2DataBytes);
      offset += g2DataBytes;
      dataBlocks.push(blk);
      ecBlocks.push(rsComputeEc(blk, ecPerBlock));
    }

    const maxDataLen = Math.max(g1DataBytes, g2DataBytes);
    const totalCodewords = totalDataBytes + (g1Blocks + g2Blocks) * ecPerBlock;
    const interleaved = new Uint8Array(totalCodewords);
    let outIdx = 0;

    for (let col = 0; col < maxDataLen; col += 1) {
      for (let blkIdx = 0; blkIdx < dataBlocks.length; blkIdx += 1) {
        if (col < dataBlocks[blkIdx].length) {
          interleaved[outIdx++] = dataBlocks[blkIdx][col];
        }
      }
    }
    for (let col = 0; col < ecPerBlock; col += 1) {
      for (let blkIdx = 0; blkIdx < ecBlocks.length; blkIdx += 1) {
        interleaved[outIdx++] = ecBlocks[blkIdx][col];
      }
    }

    return interleaved;
  }

  /**
   * @param {number} value
   * @param {number} poly
   * @param {number} polyDegree
   * @returns {number}
   */
  function bchRemainder(value, poly, polyDegree) {
    let rem = value << polyDegree;
    const topBit = 1 << polyDegree;
    for (let shift = 16; shift >= 0; shift -= 1) {
      if (rem & (topBit << shift)) {
        rem ^= poly << shift;
      }
    }
    return rem;
  }

  /**
   * 15-bit format bits for EC Level M (00) + mask (0..7), masked with 0x5412.
   * @param {number} mask
   * @returns {number}
   */
  function formatInfoBits(mask) {
    const data = mask & 0x7; // EC M = 00
    const rem = bchRemainder(data, 0x537, 10);
    return ((data << 10) | rem) ^ 0x5412;
  }

  /**
   * 18-bit version info bits for version >= 7.
   * @param {number} version
   * @returns {number}
   */
  function versionInfoBits(version) {
    const rem = bchRemainder(version, 0x1f25, 12);
    return (version << 12) | rem;
  }

  /**
   * @param {number} size
   * @returns {{ grid: number[][], reserved: boolean[][] }}
   */
  function createEmptyGrid(size) {
    const grid = Array.from({ length: size }, () => Array(size).fill(0));
    const reserved = Array.from({ length: size }, () => Array(size).fill(false));
    return { grid, reserved };
  }

  /**
   * @param {number[][]} grid
   * @param {boolean[][]} reserved
   * @param {number} top
   * @param {number} left
   */
  function placeFinderPattern(grid, reserved, top, left) {
    const size = grid.length;
    for (let dr = -1; dr <= 7; dr += 1) {
      const r = top + dr;
      if (r < 0 || r >= size) continue;
      for (let dc = -1; dc <= 7; dc += 1) {
        const c = left + dc;
        if (c < 0 || c >= size) continue;
        reserved[r][c] = true;
        if (dr === -1 || dr === 7 || dc === -1 || dc === 7) {
          grid[r][c] = 0;
        } else if (
          dr === 0 || dr === 6 || dc === 0 || dc === 6
          || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4)
        ) {
          grid[r][c] = 1;
        } else {
          grid[r][c] = 0;
        }
      }
    }
  }

  /**
   * @param {number[][]} grid
   * @param {boolean[][]} reserved
   * @param {number} cr
   * @param {number} cc
   */
  function placeAlignmentPattern(grid, reserved, cr, cc) {
    for (let dr = -2; dr <= 2; dr += 1) {
      for (let dc = -2; dc <= 2; dc += 1) {
        const r = cr + dr;
        const c = cc + dc;
        reserved[r][c] = true;
        const dist = Math.max(Math.abs(dr), Math.abs(dc));
        grid[r][c] = dist === 2 || dist === 0 ? 1 : 0;
      }
    }
  }

  /**
   * @param {number[][]} grid
   * @param {boolean[][]} reserved
   * @param {number} version
   * @param {readonly number[]} alignCenters
   */
  function placeFunctionPatterns(grid, reserved, version, alignCenters) {
    const size = grid.length;

    placeFinderPattern(grid, reserved, 0, 0);
    placeFinderPattern(grid, reserved, 0, size - 7);
    placeFinderPattern(grid, reserved, size - 7, 0);

    // Timing patterns on row 6 and col 6.
    for (let i = 8; i < size - 8; i += 1) {
      const bit = i % 2 === 0 ? 1 : 0;
      if (!reserved[6][i]) {
        reserved[6][i] = true;
        grid[6][i] = bit;
      }
      if (!reserved[i][6]) {
        reserved[i][6] = true;
        grid[i][6] = bit;
      }
    }

    // Alignment patterns.
    for (let i = 0; i < alignCenters.length; i += 1) {
      for (let j = 0; j < alignCenters.length; j += 1) {
        const cr = alignCenters[i];
        const cc = alignCenters[j];
        if (reserved[cr][cc]) continue;
        placeAlignmentPattern(grid, reserved, cr, cc);
      }
    }

    // Reserve format information strips + dark module.
    for (let i = 0; i <= 8; i += 1) {
      if (i !== 6) {
        reserved[8][i] = true;
        reserved[i][8] = true;
      }
    }
    for (let i = size - 8; i < size; i += 1) {
      reserved[8][i] = true;
    }
    for (let i = size - 7; i < size; i += 1) {
      reserved[i][8] = true;
    }
    reserved[4 * version + 9][8] = true;
    grid[4 * version + 9][8] = 1;

    // Version information blocks for version >= 7.
    if (version >= 7) {
      const vBits = versionInfoBits(version);
      for (let i = 0; i < 18; i += 1) {
        const bit = (vBits >>> i) & 1;
        const r = size - 11 + (i % 3);
        const c = Math.floor(i / 3);
        reserved[r][c] = true;
        grid[r][c] = bit;
        reserved[c][r] = true;
        grid[c][r] = bit;
      }
    }
  }

  /**
   * @param {number[][]} grid
   * @param {boolean[][]} reserved
   * @param {Uint8Array} codewords
   */
  function placeDataBits(grid, reserved, codewords) {
    const size = grid.length;
    const totalBits = codewords.length * 8;
    let bitIdx = 0;
    let upward = true;

    for (let rightCol = size - 1; rightCol > 0; rightCol -= 2) {
      if (rightCol === 6) rightCol -= 1;
      for (let step = 0; step < size; step += 1) {
        const r = upward ? size - 1 - step : step;
        for (let offset = 0; offset < 2; offset += 1) {
          const c = rightCol - offset;
          if (reserved[r][c]) continue;
          let bit = 0;
          if (bitIdx < totalBits) {
            const byte = codewords[bitIdx >>> 3];
            bit = (byte >>> (7 - (bitIdx & 7))) & 1;
            bitIdx += 1;
          }
          grid[r][c] = bit;
        }
      }
      upward = !upward;
    }
  }

  /**
   * @param {number} maskId
   * @param {number} r
   * @param {number} c
   * @returns {boolean}
   */
  function maskCondition(maskId, r, c) {
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

  /**
   * @param {number[][]} grid
   * @param {number} maskId
   */
  function writeFormatInfo(grid, maskId) {
    const size = grid.length;
    const bits = formatInfoBits(maskId);

    for (let i = 0; i < 15; i += 1) {
      const bit = (bits >>> i) & 1;
      // Vertical strip: bits 0..5 top-to-bottom at col 8, rows 0..5; bit 6 at (7,8); bit 7 at (8,8); bits 8..14 bottom-left.
      if (i < 6) {
        grid[i][8] = bit;
      } else if (i < 8) {
        grid[i + 1][8] = bit;
      } else {
        grid[size - 15 + i][8] = bit;
      }

      // Horizontal strip: bits 0..7 right-to-left at row 8, cols size-1..size-8; bit 8 at (8,7); bits 9..14 at (8,5..0).
      if (i < 8) {
        grid[8][size - 1 - i] = bit;
      } else if (i < 9) {
        grid[8][7] = bit;
      } else {
        grid[8][14 - i] = bit;
      }
    }
  }

  /**
   * ISO/IEC 18004 Section 6.8.3 mask penalty evaluation.
   * @param {number[][]} grid
   * @returns {number}
   */
  function evaluatePenalty(grid) {
    const size = grid.length;
    let penalty = 0;

    // Rule 1: 5+ consecutive same-color modules in rows and columns.
    for (let r = 0; r < size; r += 1) {
      let rowRun = 1;
      let colRun = 1;
      for (let i = 1; i < size; i += 1) {
        if (grid[r][i] === grid[r][i - 1]) {
          rowRun += 1;
        } else {
          if (rowRun >= 5) penalty += 3 + (rowRun - 5);
          rowRun = 1;
        }
        if (grid[i][r] === grid[i - 1][r]) {
          colRun += 1;
        } else {
          if (colRun >= 5) penalty += 3 + (colRun - 5);
          colRun = 1;
        }
      }
      if (rowRun >= 5) penalty += 3 + (rowRun - 5);
      if (colRun >= 5) penalty += 3 + (colRun - 5);
    }

    // Rule 2: 2x2 blocks of same color.
    for (let r = 0; r < size - 1; r += 1) {
      for (let c = 0; c < size - 1; c += 1) {
        const val = grid[r][c];
        if (val === grid[r][c + 1] && val === grid[r + 1][c] && val === grid[r + 1][c + 1]) {
          penalty += 3;
        }
      }
    }

    // Rule 3: 1:1:3:1:1 finder-like pattern with 4 light modules on either side.
    const isPatternA = (/** @type {number[]} */ seq, /** @type {number} */ idx) => (
      seq[idx] === 1 && seq[idx + 1] === 0 && seq[idx + 2] === 1
      && seq[idx + 3] === 1 && seq[idx + 4] === 1 && seq[idx + 5] === 0
      && seq[idx + 6] === 1
    );
    const hasLightRun = (/** @type {number[]} */ seq, /** @type {number} */ start, /** @type {number} */ count) => {
      for (let k = 0; k < count; k += 1) {
        if (seq[start + k] !== 0) return false;
      }
      return true;
    };
    for (let i = 0; i < size; i += 1) {
      const row = grid[i];
      const col = new Array(size);
      for (let r = 0; r < size; r += 1) col[r] = grid[r][i];
      for (let j = 0; j <= size - 11; j += 1) {
        if (
          (isPatternA(row, j) && hasLightRun(row, j + 7, 4))
          || (hasLightRun(row, j, 4) && isPatternA(row, j + 4))
        ) {
          penalty += 40;
        }
        if (
          (isPatternA(col, j) && hasLightRun(col, j + 7, 4))
          || (hasLightRun(col, j, 4) && isPatternA(col, j + 4))
        ) {
          penalty += 40;
        }
      }
    }

    // Rule 4: Balance of dark modules vs 50%.
    let darkCount = 0;
    for (let r = 0; r < size; r += 1) {
      for (let c = 0; c < size; c += 1) {
        if (grid[r][c] === 1) darkCount += 1;
      }
    }
    const percent = (darkCount * 100) / (size * size);
    const prevMultiple = Math.floor(Math.abs(percent - 50) / 5);
    penalty += prevMultiple * 10;

    return penalty;
  }

  /**
   * Encode UTF-8 text into a QR Model 2 module matrix (`1` = dark, `0` = light).
   * @param {string} text
   * @returns {{ version: number, size: number, mask: number, modules: number[][] }}
   */
  function encodeQrMatrix(text) {
    const str = String(text ?? '');
    if (!str) throw new Error('QR text cannot be empty');
    const bytes = new TextEncoder().encode(str);
    const spec = selectVersionSpec(bytes.length);
    const version = spec[0];
    const alignCenters = spec[6];
    const size = 17 + version * 4;
    const codewords = encodeCodewords(bytes, spec);

    const base = createEmptyGrid(size);
    placeFunctionPatterns(base.grid, base.reserved, version, alignCenters);
    placeDataBits(base.grid, base.reserved, codewords);

    let bestMask = 0;
    let bestPenalty = Infinity;
    /** @type {number[][] | null} */
    let bestGrid = null;

    for (let mask = 0; mask < 8; mask += 1) {
      const candidate = base.grid.map((row) => row.slice());
      for (let r = 0; r < size; r += 1) {
        for (let c = 0; c < size; c += 1) {
          if (!base.reserved[r][c] && maskCondition(mask, r, c)) {
            candidate[r][c] ^= 1;
          }
        }
      }
      writeFormatInfo(candidate, mask);
      const penalty = evaluatePenalty(candidate);
      if (penalty < bestPenalty) {
        bestPenalty = penalty;
        bestMask = mask;
        bestGrid = candidate;
      }
    }

    return {
      version,
      size,
      mask: bestMask,
      modules: /** @type {number[][]} */ (bestGrid)
    };
  }

  /**
   * Convert a QR matrix (or encodeQrMatrix result) into a merged SVG `<path>` string.
   * @param {{ size?: number, modules?: number[][] } | number[][]} matrixOrResult
   * @param {number} [quietZone]
   * @returns {{ size: number, totalSize: number, quietZone: number, path: string }}
   */
  function qrPathData(matrixOrResult, quietZone = 4) {
    const modules = Array.isArray(matrixOrResult) ? matrixOrResult : matrixOrResult?.modules;
    if (!Array.isArray(modules) || modules.length === 0) {
      throw new Error('QR matrix must be a non-empty 2D array');
    }
    const size = modules.length;
    const qz = Number.isInteger(quietZone) && quietZone >= 0 ? quietZone : 4;
    const totalSize = size + qz * 2;
    /** @type {string[]} */
    const cmds = [];

    for (let r = 0; r < size; r += 1) {
      const row = modules[r];
      let c = 0;
      while (c < size) {
        if (!row[c]) {
          c += 1;
          continue;
        }
        const start = c;
        while (c < size && row[c]) c += 1;
        const width = c - start;
        cmds.push(`M${start + qz} ${r + qz}h${width}v1h-${width}z`);
      }
    }

    return {
      size,
      totalSize,
      quietZone: qz,
      path: cmds.join('')
    };
  }

  /**
   * Escape minimal XML attribute text.
   * @param {string} value
   * @returns {string}
   */
  function escapeAttr(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('"', '&quot;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
  }

  /**
   * Render a crisp SVG string for the given QR payload (dark modules on white quiet zone).
   * @param {string} text
   * @param {{ quietZone?: number, darkColor?: string, lightColor?: string, sizePx?: number }} [options]
   * @returns {string}
   */
  function renderQrSvgMarkup(text, options = {}) {
    const matrix = encodeQrMatrix(text);
    const qz = options.quietZone ?? 4;
    const { totalSize, path } = qrPathData(matrix, qz);
    const dark = escapeAttr(options.darkColor || '#111111');
    const light = escapeAttr(options.lightColor || '#ffffff');
    const sizeAttr = Number.isFinite(Number(options.sizePx)) && Number(options.sizePx) > 0
      ? ` width="${Math.round(Number(options.sizePx))}" height="${Math.round(Number(options.sizePx))}"`
      : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalSize} ${totalSize}"${sizeAttr} shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${totalSize}" height="${totalSize}" fill="${light}"/><path d="${path}" fill="${dark}"/></svg>`;
  }

  return {
    encodeQrMatrix,
    qrPathData,
    renderQrSvgMarkup
  };
});
