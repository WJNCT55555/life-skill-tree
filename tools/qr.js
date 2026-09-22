/**
 * 零依赖二维码编码器（QR Code, ISO/IEC 18004）
 * =====================================================================
 * 只实现「字节模式（byte mode）」，够用：一条网址、一句中文都能编。
 * 支持版本 1-20、纠错等级 L/M/Q/H，自动选最小能装下的版本。
 *
 * 用法（浏览器和 Node 都能用）：
 *   const qr = QR.encode('https://example.com');       // → { size, modules, version }
 *   const svg = QR.toSVG(qr, { scale: 4, margin: 4 }); // 字符串，可直接塞进 DOM
 *   const dim = QR.toCanvas(qr, ctx, { scale: 4 });    // 画到 canvas，返回边长
 *
 * 为什么不引第三方库：网页、离线单文件、小程序都要用同一份代码，
 * 而且不能依赖网络。这份实现只用到语言本身的能力。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QR = factory();
})(typeof globalThis !== 'undefined' ? globalThis
  : typeof self !== 'undefined' ? self
  : typeof window !== 'undefined' ? window
  : this, function () {
  'use strict';

  /* ============================================================
     1. 码字容量表（版本 1-20）
     ============================================================ */
  // [每块纠错码字数, 总块数]
  const EC_TABLE = {
    1:  { L: [7, 1],  M: [10, 1], Q: [13, 1],  H: [17, 1] },
    2:  { L: [10, 1], M: [16, 1], Q: [22, 1],  H: [28, 1] },
    3:  { L: [15, 1], M: [26, 1], Q: [18, 2],  H: [22, 2] },
    4:  { L: [20, 1], M: [18, 2], Q: [26, 2],  H: [16, 4] },
    5:  { L: [26, 1], M: [24, 2], Q: [18, 4],  H: [22, 4] },
    6:  { L: [18, 2], M: [16, 4], Q: [24, 4],  H: [28, 4] },
    7:  { L: [20, 2], M: [18, 4], Q: [18, 6],  H: [26, 5] },
    8:  { L: [24, 2], M: [22, 4], Q: [22, 6],  H: [26, 6] },
    9:  { L: [30, 2], M: [22, 5], Q: [20, 8],  H: [24, 8] },
    10: { L: [18, 4], M: [26, 5], Q: [24, 8],  H: [28, 8] },
    11: { L: [20, 4], M: [30, 5], Q: [28, 8],  H: [24, 11] },
    12: { L: [24, 4], M: [22, 8], Q: [26, 10], H: [28, 11] },
    13: { L: [26, 4], M: [22, 9], Q: [24, 12], H: [22, 16] },
    14: { L: [30, 4], M: [24, 9], Q: [20, 16], H: [24, 16] },
    15: { L: [22, 6], M: [24, 10], Q: [30, 12], H: [24, 18] },
    16: { L: [24, 6], M: [28, 10], Q: [24, 17], H: [30, 16] },
    17: { L: [28, 6], M: [28, 11], Q: [28, 16], H: [28, 19] },
    18: { L: [30, 6], M: [26, 13], Q: [28, 18], H: [28, 21] },
    19: { L: [28, 7], M: [26, 14], Q: [26, 21], H: [26, 25] },
    20: { L: [28, 8], M: [26, 16], Q: [30, 20], H: [28, 25] },
  };
  // [group1 块数, 每块数据码字, group2 块数, 每块数据码字]
  const BLOCK_TABLE = {
    1:  { L: [1, 19, 0, 0],  M: [1, 16, 0, 0],  Q: [1, 13, 0, 0],  H: [1, 9, 0, 0] },
    2:  { L: [1, 34, 0, 0],  M: [1, 28, 0, 0],  Q: [1, 22, 0, 0],  H: [1, 16, 0, 0] },
    3:  { L: [1, 55, 0, 0],  M: [1, 44, 0, 0],  Q: [2, 17, 0, 0],  H: [2, 13, 0, 0] },
    4:  { L: [1, 80, 0, 0],  M: [2, 32, 0, 0],  Q: [2, 24, 0, 0],  H: [4, 9, 0, 0] },
    5:  { L: [1, 108, 0, 0], M: [2, 43, 0, 0],  Q: [2, 15, 2, 16], H: [2, 11, 2, 12] },
    6:  { L: [2, 68, 0, 0],  M: [4, 27, 0, 0],  Q: [4, 19, 0, 0],  H: [4, 15, 0, 0] },
    7:  { L: [2, 78, 0, 0],  M: [4, 31, 0, 0],  Q: [2, 14, 4, 15], H: [4, 13, 1, 14] },
    8:  { L: [2, 97, 0, 0],  M: [2, 38, 2, 39], Q: [4, 18, 2, 19], H: [4, 14, 2, 15] },
    9:  { L: [2, 116, 0, 0], M: [3, 36, 2, 37], Q: [4, 16, 4, 17], H: [4, 12, 4, 13] },
    10: { L: [2, 68, 2, 69], M: [4, 43, 1, 44], Q: [6, 19, 2, 20], H: [6, 15, 2, 16] },
    11: { L: [4, 81, 0, 0],  M: [1, 50, 4, 51], Q: [4, 22, 4, 23], H: [3, 12, 8, 13] },
    12: { L: [2, 92, 2, 93], M: [6, 36, 2, 37], Q: [4, 20, 6, 21], H: [7, 14, 4, 15] },
    13: { L: [4, 107, 0, 0], M: [8, 37, 1, 38], Q: [8, 20, 4, 21], H: [12, 11, 4, 12] },
    14: { L: [3, 115, 1, 116], M: [4, 40, 5, 41], Q: [11, 16, 5, 17], H: [11, 12, 5, 13] },
    15: { L: [5, 87, 1, 88], M: [5, 41, 5, 42], Q: [5, 24, 7, 25], H: [11, 12, 7, 13] },
    16: { L: [5, 98, 1, 99], M: [7, 45, 3, 46], Q: [15, 19, 2, 20], H: [3, 15, 13, 16] },
    17: { L: [1, 107, 5, 108], M: [10, 46, 1, 47], Q: [1, 22, 15, 23], H: [2, 14, 17, 15] },
    18: { L: [5, 120, 1, 121], M: [9, 43, 4, 44], Q: [17, 22, 1, 23], H: [2, 14, 19, 15] },
    19: { L: [3, 113, 4, 114], M: [3, 44, 11, 45], Q: [17, 21, 4, 22], H: [9, 13, 16, 14] },
    20: { L: [3, 107, 5, 108], M: [3, 41, 13, 42], Q: [15, 24, 5, 25], H: [15, 15, 10, 16] },
  };
  const ALIGN_POS = [
    [], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
    [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54],
    [6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70],
    [6, 26, 50, 74], [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90],
  ];
  const EC_BITS = { L: 1, M: 0, Q: 3, H: 2 };

  /* ============================================================
     2. GF(256) 与 Reed-Solomon
     ============================================================ */
  const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  (function () {
    let x = 1;
    for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();
  const gmul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];

  function rsGenPoly(deg) {
    let poly = [1];
    for (let i = 0; i < deg; i++) {
      const next = new Array(poly.length + 1).fill(0);
      for (let j = 0; j < poly.length; j++) {
        next[j] ^= gmul(poly[j], 1);
        next[j + 1] ^= gmul(poly[j], EXP[i]);
      }
      poly = next;
    }
    return poly;
  }
  function rsEncode(data, ecLen) {
    const gen = rsGenPoly(ecLen);
    const res = new Uint8Array(data.length + ecLen);
    res.set(data, 0);
    for (let i = 0; i < data.length; i++) {
      const coef = res[i];
      if (coef === 0) continue;
      for (let j = 0; j < gen.length; j++) res[i + j] ^= gmul(gen[j], coef);
    }
    return res.slice(data.length);
  }

  /* ============================================================
     3. BCH：格式信息 / 版本信息
     ============================================================ */
  function bch(data, poly, bits) {
    let d = data << bits;
    const polyBits = poly.toString(2).length;
    while (d.toString(2).length >= polyBits) d ^= poly << (d.toString(2).length - polyBits);
    return (data << bits) | d;
  }
  function formatInfo(ecLevel, mask) {
    const data = (EC_BITS[ecLevel] << 3) | mask;
    return bch(data, 0b10100110111, 10) ^ 0b101010000010010;
  }
  function versionInfo(version) {
    return bch(version, 0b1111100100101, 12);
  }

  /* ============================================================
     4. 编码：字节模式
     ============================================================ */
  function utf8Bytes(str) {
    const out = [];
    for (let i = 0; i < str.length; i++) {
      let c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) { out.push(0xc0 | (c >> 6), 0x80 | (c & 63)); }
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
        const c2 = str.charCodeAt(++i);
        const cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      } else { out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); }
    }
    return out;
  }
  const cciBits = (version) => (version <= 9 ? 8 : 16);

  function dataCapacity(version, ec) {
    const [g1n, g1d, g2n, g2d] = BLOCK_TABLE[version][ec];
    return g1n * g1d + g2n * g2d;
  }
  function pickVersion(byteLen, ec) {
    for (let v = 1; v <= 20; v++) {
      if (4 + cciBits(v) + byteLen * 8 <= dataCapacity(v, ec) * 8) return v;
    }
    return -1;
  }

  function buildCodewords(bytes, version, ec) {
    const bits = [];
    const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); };
    push(0b0100, 4);
    push(bytes.length, cciBits(version));
    bytes.forEach((b) => push(b, 8));
    const capBits = dataCapacity(version, ec) * 8;
    for (let i = 0; i < 4 && bits.length < capBits; i++) bits.push(0);
    while (bits.length % 8) bits.push(0);
    const pads = [0xEC, 0x11];
    let pi = 0;
    while (bits.length < capBits) push(pads[pi++ % 2], 8);
    const dc = [];
    for (let i = 0; i < bits.length; i += 8) {
      let v = 0;
      for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
      dc.push(v);
    }
    const [g1n, g1d, g2n, g2d] = BLOCK_TABLE[version][ec];
    const ecPerBlock = EC_TABLE[version][ec][0];
    const blocks = [];
    let off = 0;
    for (let i = 0; i < g1n; i++) { blocks.push(dc.slice(off, off + g1d)); off += g1d; }
    for (let i = 0; i < g2n; i++) { blocks.push(dc.slice(off, off + g2d)); off += g2d; }
    const ecBlocks = blocks.map((b) => rsEncode(Uint8Array.from(b), ecPerBlock));
    const out = [];
    const maxData = Math.max(...blocks.map((b) => b.length));
    for (let i = 0; i < maxData; i++) for (const b of blocks) if (i < b.length) out.push(b[i]);
    for (let i = 0; i < ecPerBlock; i++) for (const b of ecBlocks) out.push(b[i]);
    return out;
  }

  /* ============================================================
     5. 矩阵
     ============================================================ */
  function buildMatrix(version) {
    const size = version * 4 + 17;
    const m = Array.from({ length: size }, () => new Array(size).fill(null));
    const setF = (r, c, v) => { if (r >= 0 && c >= 0 && r < size && c < size) m[r][c] = v; };
    const finder = (r0, c0) => {
      for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
        const inRing = (r >= 0 && r <= 6 && (c === 0 || c === 6)) || (c >= 0 && c <= 6 && (r === 0 || r === 6));
        const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        setF(r0 + r, c0 + c, (inRing || inCore) ? 1 : 0);
      }
    };
    finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
    const pos = ALIGN_POS[version];
    for (const r0 of pos) for (const c0 of pos) {
      if ((r0 <= 8 && c0 <= 8) || (r0 <= 8 && c0 >= size - 9) || (r0 >= size - 9 && c0 <= 8)) continue;
      for (let r = -2; r <= 2; r++) for (let c = -2; c <= 2; c++) {
        const ring = Math.max(Math.abs(r), Math.abs(c));
        setF(r0 + r, c0 + c, (ring === 2 || ring === 0) ? 1 : 0);
      }
    }
    for (let i = 8; i < size - 8; i++) {
      if (m[6][i] === null) setF(6, i, i % 2 === 0 ? 1 : 0);
      if (m[i][6] === null) setF(i, 6, i % 2 === 0 ? 1 : 0);
    }
    if (version >= 2) setF(size - 8, 8, 1);
    return m;
  }

  function reservedMap(version) {
    const size = version * 4 + 17;
    const R = Array.from({ length: size }, () => new Array(size).fill(false));
    const mark = (r, c) => { if (r >= 0 && c >= 0 && r < size && c < size) R[r][c] = true; };
    for (let i = 0; i < 9; i++) { mark(8, i); mark(i, 8); }
    for (let i = 0; i < 8; i++) { mark(8, size - 1 - i); mark(size - 1 - i, 8); }
    mark(size - 8, 8);
    if (version >= 7) {
      for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) { mark(size - 11 + j, i); mark(i, size - 11 + j); }
    }
    return R;
  }

  const MASKS = [
    (r, c) => (r + c) % 2 === 0,
    (r) => r % 2 === 0,
    (r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
  ];

  function placeData(matrix, reserved, codewords, maskId) {
    const size = matrix.length;
    const bits = [];
    codewords.forEach((b) => { for (let i = 7; i >= 0; i--) bits.push((b >> i) & 1); });
    let bi = 0, up = true;
    for (let col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      for (let k = 0; k < size; k++) {
        const row = up ? size - 1 - k : k;
        for (const c of [col, col - 1]) {
          if (reserved[row][c]) continue;
          let bit = bi < bits.length ? bits[bi++] : 0;
          if (MASKS[maskId](row, c)) bit ^= 1;
          matrix[row][c] = bit;
        }
      }
      up = !up;
    }
  }

  function placeFormat(matrix, ec, maskId, version) {
    const size = matrix.length;
    const fmt = formatInfo(ec, maskId);
    const bit = (i) => (fmt >> i) & 1;
    for (let i = 0; i <= 5; i++) matrix[8][i] = bit(i);
    matrix[8][7] = bit(6);
    matrix[8][8] = bit(7);
    matrix[7][8] = bit(8);
    for (let i = 9; i <= 14; i++) matrix[14 - i][8] = bit(i);
    for (let i = 0; i <= 7; i++) matrix[size - 1 - i][8] = bit(i);
    for (let i = 8; i <= 14; i++) matrix[8][size - 15 + i] = bit(i);
    matrix[8][size - 8] = 1;   // 固定黑模块，就在第 8 行最右边
    if (version >= 7) {
      const vi = versionInfo(version);
      for (let i = 0; i < 18; i++) {
        const b = (vi >> i) & 1;
        matrix[Math.floor(i / 3)][size - 11 + (i % 3)] = b;
        matrix[size - 11 + (i % 3)][Math.floor(i / 3)] = b;
      }
    }
  }

  function penalty(m) {
    const size = m.length;
    let score = 0;
    for (let i = 0; i < size; i++) {
      for (const dir of [0, 1]) {
        let run = 1;
        for (let j = 1; j < size; j++) {
          const a = dir ? m[j][i] : m[i][j], b = dir ? m[j - 1][i] : m[i][j - 1];
          if (a === b) { run++; if (run === 5) score += 3; else if (run > 5) score += 1; }
          else run = 1;
        }
      }
    }
    for (let r = 0; r < size - 1; r++) for (let c = 0; c < size - 1; c++) {
      const v = m[r][c];
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
    }
    const pat = [1, 0, 1, 1, 1, 0, 1];
    const check = (get) => {
      for (let i = 0; i + 7 <= size; i++) {
        let ok = true;
        for (let k = 0; k < 7; k++) if (get(i + k) !== pat[k]) { ok = false; break; }
        if (!ok) continue;
        const before = i >= 4 && [0, 1, 2, 3].every((k) => get(i - 4 + k) === 0);
        const after = i + 11 <= size && [0, 1, 2, 3].every((k) => get(i + 7 + k) === 0);
        if (before || after) score += 40;
      }
    };
    for (let r = 0; r < size; r++) check((i) => m[r][i]);
    for (let c = 0; c < size; c++) check((i) => m[i][c]);
    let dark = 0;
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (m[r][c]) dark++;
    score += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
    return score;
  }

  /* ============================================================
     6. 对外接口
     ============================================================ */
  function encode(text, opts) {
    const ec = (opts && opts.ec) || 'M';
    if (!Object.prototype.hasOwnProperty.call(EC_BITS, ec)) throw new Error('纠错等级只能是 L/M/Q/H');
    const bytes = utf8Bytes(String(text));
    const version = pickVersion(bytes.length, ec);
    if (version < 0) throw new Error('内容太长，超出本编码器支持的上限（版本 20）');
    const codewords = buildCodewords(bytes, version, ec);
    const base = buildMatrix(version);
    const reserved = reservedMap(version);
    for (let r = 0; r < base.length; r++) for (let c = 0; c < base.length; c++) {
      if (base[r][c] !== null) reserved[r][c] = true;
    }
    let best = null;
    for (let maskId = 0; maskId < 8; maskId++) {
      const m = base.map((row) => row.slice());
      placeData(m, reserved, codewords, maskId);
      placeFormat(m, ec, maskId, version);
      const p = penalty(m);
      if (!best || p < best.p) best = { m, maskId, p };
    }
    return { size: base.length, modules: best.m, version, ec, mask: best.maskId };
  }

  function toSVG(qr, opts) {
    const o = Object.assign({ scale: 4, margin: 4, dark: '#000000', light: '#ffffff' }, opts || {});
    const dim = (qr.size + o.margin * 2) * o.scale;
    let path = '';
    for (let r = 0; r < qr.size; r++) for (let c = 0; c < qr.size; c++) {
      if (qr.modules[r][c]) {
        path += `M${(c + o.margin) * o.scale} ${(r + o.margin) * o.scale}h${o.scale}v${o.scale}h-${o.scale}z`;
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${dim}" height="${dim}" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges">`
      + `<rect width="${dim}" height="${dim}" fill="${o.light}"/>`
      + `<path d="${path}" fill="${o.dark}"/></svg>`;
  }

  function toCanvas(qr, ctx, opts) {
    const o = Object.assign({ scale: 4, margin: 4, dark: '#000000', light: '#ffffff' }, opts || {});
    const dim = (qr.size + o.margin * 2) * o.scale;
    ctx.fillStyle = o.light;
    ctx.fillRect(0, 0, dim, dim);
    ctx.fillStyle = o.dark;
    for (let r = 0; r < qr.size; r++) for (let c = 0; c < qr.size; c++) {
      if (qr.modules[r][c]) ctx.fillRect((c + o.margin) * o.scale, (r + o.margin) * o.scale, o.scale, o.scale);
    }
    return dim;
  }

  return { encode, toSVG, toCanvas };
});
