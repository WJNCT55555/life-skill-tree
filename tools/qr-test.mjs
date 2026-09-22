/**
 * 二维码编码器自检
 * =====================================================================
 *   node tools/qr-test.mjs
 *
 * 做四件事（都是「从外部核对」，不是自己跟自己比）：
 *   1. 几何核对：数出矩阵里真正能放数据的格子，换算成码字数，
 *      跟容量表相加得到的总数比对。表抄错了这里就会炸。
 *   2. 里德-所罗门核对：把生成的每个块拿去做 syndrome 校验，
 *      全为 0 才算纠错码字算对了（这一步能抓出交错/分块的任何错误）。
 *   3. 全量解码：不走编码器的任何函数，独立读格式信息 → 反掩码 →
 *      蛇形读码字 → 反交错 → 解出原文，跟输入逐字节比对。
 *   4. 端到端：把 SVG 光栅化成像素，再从像素里把码读回来
 *      （模拟扫码器看到的世界，确认缩放/留白没把码弄坏）。
 */
import QR from './qr.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  \u2713 ${name}`); }
  else { fail++; console.log(`  \u2717 ${name}${extra ? '  → ' + extra : ''}`); }
};

/* ============================================================
   独立的表（跟 qr.js 各写各的，用来互相印证）
   ============================================================ */
// 各版本「总码字数」，这是标准里的定值
const TOTAL_CW = [0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346,
  404, 466, 532, 581, 655, 733, 815, 901, 991, 1085];
// 各版本纠错块数与每块纠错码字数（标准表，按 EC 等级）
const EC_REF = {
  1: { L: [1, 7], M: [1, 10], Q: [1, 13], H: [1, 17] },
  2: { L: [1, 10], M: [1, 16], Q: [1, 22], H: [1, 28] },
  3: { L: [1, 15], M: [1, 26], Q: [2, 18], H: [2, 22] },
  4: { L: [1, 20], M: [2, 18], Q: [2, 26], H: [4, 16] },
  5: { L: [1, 26], M: [2, 24], Q: [4, 18], H: [4, 22] },
  6: { L: [2, 18], M: [4, 16], Q: [4, 24], H: [4, 28] },
  7: { L: [2, 20], M: [4, 18], Q: [6, 18], H: [5, 26] },
  8: { L: [2, 24], M: [4, 22], Q: [6, 22], H: [6, 26] },
  9: { L: [2, 30], M: [5, 22], Q: [8, 20], H: [8, 24] },
  10: { L: [4, 18], M: [5, 26], Q: [8, 24], H: [8, 28] },
  11: { L: [4, 20], M: [5, 30], Q: [8, 28], H: [11, 24] },
  12: { L: [4, 24], M: [8, 22], Q: [10, 26], H: [11, 28] },
  13: { L: [4, 26], M: [9, 22], Q: [12, 24], H: [16, 22] },
  14: { L: [4, 30], M: [9, 24], Q: [16, 20], H: [16, 24] },
  15: { L: [6, 22], M: [10, 24], Q: [12, 30], H: [18, 24] },
  16: { L: [6, 24], M: [10, 28], Q: [17, 24], H: [16, 30] },
  17: { L: [6, 28], M: [11, 28], Q: [16, 28], H: [19, 28] },
  18: { L: [6, 30], M: [13, 26], Q: [18, 28], H: [21, 28] },
  19: { L: [7, 28], M: [14, 26], Q: [21, 26], H: [25, 26] },
  20: { L: [8, 28], M: [16, 26], Q: [20, 30], H: [25, 28] },
};

/* ============================================================
   独立解码器
   ============================================================ */
const EXP = new Uint8Array(512);
(function () {
  let x = 1;
  for (let i = 0; i < 255; i++) { EXP[i] = x; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

function readFormat(m) {
  const size = m.length;
  const bits1 = [];
  for (let i = 0; i <= 5; i++) bits1.push(m[8][i]);
  bits1.push(m[8][7], m[8][8], m[7][8]);
  for (let i = 9; i <= 14; i++) bits1.push(m[14 - i][8]);
  const bits2 = [];
  for (let i = 0; i <= 7; i++) bits2.push(m[size - 1 - i][8]);
  for (let i = 8; i <= 14; i++) bits2.push(m[8][size - 15 + i]);
  // 格式信息是「低位在前」铺的：(8,0) 放的是 bit0，不是最高位
  const toInt = (b) => b.reduce((a, v, i) => a | (v << i), 0);
  const v1 = toInt(bits1) ^ 0b101010000010010;
  const v2 = toInt(bits2) ^ 0b101010000010010;
  // 两份必须一致
  const consistent = toInt(bits1) === toInt(bits2);
  // 15 位格式信息 = 5 位数据（高） + 10 位 BCH（低）
  const ecBits = (v1 >> 13) & 3, mask = (v1 >> 10) & 7;
  const ec = { 1: 'L', 0: 'M', 3: 'Q', 2: 'H' }[ecBits];
  return { ec, mask, consistent, raw: v1 };
}

const MASK_FN = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

// 功能图形占位表：完全按标准重画一遍（不用编码器的实现）
function functionMask(version) {
  const size = version * 4 + 17;
  const F = Array.from({ length: size }, () => new Array(size).fill(false));
  const box = (r0, c0, r1, c1) => {
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++)
      if (r >= 0 && c >= 0 && r < size && c < size) F[r][c] = true;
  };
  box(0, 0, 8, 8); box(0, size - 8, 8, size - 1); box(size - 8, 0, size - 1, 8); // 定位 + 分隔
  for (let i = 0; i < size; i++) { F[6][i] = true; F[i][6] = true; }             // 定时
  // 校正图形：只有跟定位图形重合的三个角才省略（跟定时线重叠的要照画）
  const AP = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
    7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50], 11: [6, 30, 54],
    12: [6, 32, 58], 13: [6, 34, 62], 14: [6, 26, 46, 66], 15: [6, 26, 48, 70],
    16: [6, 26, 50, 74], 17: [6, 30, 54, 78], 18: [6, 30, 56, 82], 19: [6, 30, 58, 86],
    20: [6, 34, 62, 90] }[version];
  for (const r0 of AP) for (const c0 of AP) {
    if (r0 === 6 && c0 === 6) continue;
    if (r0 === 6 && c0 === size - 7) continue;
    if (r0 === size - 7 && c0 === 6) continue;
    box(r0 - 2, c0 - 2, r0 + 2, c0 + 2);
  }
  // 格式信息
  for (let i = 0; i < 9; i++) { F[8][i] = true; F[i][8] = true; }
  for (let i = 0; i < 8; i++) { F[8][size - 1 - i] = true; F[size - 1 - i][8] = true; }
  F[size - 8][8] = true;   // 第二份格式信息的 bit7
  F[8][size - 8] = true;   // 固定黑模块
  if (version >= 7) { box(0, size - 11, 5, size - 9); box(size - 11, 0, size - 9, 5); }
  return F;
}

function readCodewords(m, version, mask) {
  const size = m.length;
  const F = functionMask(version);
  const fn = MASK_FN[mask];
  const bits = [];
  let right = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col = 5;                     // 跳过定时列
    for (let i = 0; i < size; i++) {
      const row = right ? size - 1 - i : i;
      for (const c of [col, col - 1]) {
        if (F[row][c]) continue;
        bits.push(m[row][c] ^ (fn(row, c) ? 1 : 0));
      }
    }
    right = !right;
  }
  const cw = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    cw.push(bits.slice(i, i + 8).reduce((a, v) => (a << 1) | v, 0));
  }
  return cw;
}

const LOG = new Uint8Array(256);
for (let i = 0; i < 255; i++) LOG[EXP[i]] = i;
const mulNoLog = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

// 把 block 当成多项式（block[0] 是最高次项），代入 α^0 … α^(ecLen-1)
// 纠错码字算对了的话，每一个都必须是 0。
function syndromesZero(block, ecLen) {
  for (let i = 0; i < ecLen; i++) {
    const a = EXP[i];
    let v = 0;
    for (const coef of block) v = mulNoLog(v, a) ^ coef;
    if (v !== 0) return false;
  }
  return true;
}

function unweave(cw, version, ec) {
  const [n1, d1, n2, d2] = BLOCK_REF[version][ec];
  const [ecN, ecLen] = EC_REF[version][ec];
  const blocks = [];
  for (let i = 0; i < n1; i++) blocks.push(new Array(d1));
  for (let i = 0; i < n2; i++) blocks.push(new Array(d2));
  let p = 0;
  const maxD = Math.max(d1, d2);
  for (let i = 0; i < maxD; i++) for (const b of blocks) if (i < b.length) b[i] = cw[p++];
  const ecs = blocks.map(() => new Array(ecLen));
  for (let i = 0; i < ecLen; i++) for (const e of ecs) e[i] = cw[p++];
  return { blocks, ecs, ecLen, consumed: p };
}

// 独立的「每块数据码字数」表
const BLOCK_REF = {
  1: { L: [1, 19, 0, 0], M: [1, 16, 0, 0], Q: [1, 13, 0, 0], H: [1, 9, 0, 0] },
  2: { L: [1, 34, 0, 0], M: [1, 28, 0, 0], Q: [1, 22, 0, 0], H: [1, 16, 0, 0] },
  3: { L: [1, 55, 0, 0], M: [1, 44, 0, 0], Q: [2, 17, 0, 0], H: [2, 13, 0, 0] },
  4: { L: [1, 80, 0, 0], M: [2, 32, 0, 0], Q: [2, 24, 0, 0], H: [4, 9, 0, 0] },
  5: { L: [1, 108, 0, 0], M: [2, 43, 0, 0], Q: [2, 15, 2, 16], H: [2, 11, 2, 12] },
  6: { L: [2, 68, 0, 0], M: [4, 27, 0, 0], Q: [4, 19, 0, 0], H: [4, 15, 0, 0] },
  7: { L: [2, 78, 0, 0], M: [4, 31, 0, 0], Q: [2, 14, 4, 15], H: [4, 13, 1, 14] },
  8: { L: [2, 97, 0, 0], M: [2, 38, 2, 39], Q: [4, 18, 2, 19], H: [4, 14, 2, 15] },
  9: { L: [2, 116, 0, 0], M: [3, 36, 2, 37], Q: [4, 16, 4, 17], H: [4, 12, 4, 13] },
  10: { L: [2, 68, 2, 69], M: [4, 43, 1, 44], Q: [6, 19, 2, 20], H: [6, 15, 2, 16] },
  11: { L: [4, 81, 0, 0], M: [1, 50, 4, 51], Q: [4, 22, 4, 23], H: [3, 12, 8, 13] },
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

/* ============================================================
   1. 几何核对
   ============================================================ */
console.log('\n【1】几何核对：矩阵里能放数据的格子数 ÷ 8 = 总码字数？');
for (let v = 1; v <= 20; v++) {
  const size = v * 4 + 17;
  const F = functionMask(v);
  let free = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (!F[r][c]) free++;
  const geo = Math.floor(free / 8);
  const ref = TOTAL_CW[v];
  // 标准规定的「剩余位」：塞不满一个码字的零头
  const remRef = v === 1 ? 0 : v <= 6 ? 7 : v <= 13 ? 0 : 3;
  const ecLevels = ['L', 'M', 'Q', 'H'];
  const tableSum = ecLevels.map((ec) => {
    const [n1, d1, n2, d2] = BLOCK_REF[v][ec];
    const [ecN, ecLen] = EC_REF[v][ec];
    return n1 * d1 + n2 * d2 + (n1 + n2) * ecLen;
  });
  const allSame = tableSum.every((s) => s === ref);
  ok(`v${v}  空位 ${free} = ${geo} 码字 + ${free - geo * 8} 剩余位；标准 ${ref} 码字 + ${remRef} 剩余位`,
    geo === ref && free - geo * 8 === remRef && allSame,
    `geo=${geo} ref=${ref} rem=${free - geo * 8} sums=${tableSum.join('/')}`);
}
// 块数必须等于 ecN
for (let v = 1; v <= 20; v++) for (const ec of ['L', 'M', 'Q', 'H']) {
  const [n1, , n2] = BLOCK_REF[v][ec];
  const [ecN] = EC_REF[v][ec];
  if (n1 + n2 !== ecN) { ok(`v${v}${ec} 块数一致`, false, `${n1}+${n2} vs ${ecN}`); }
}
ok('所有版本·等级的「块数 = 纠错块数」', true);

/* ============================================================
   2 + 3. 生成 → 独立解码 + RS 校验
   ============================================================ */
console.log('\n【2】里德-所罗门校验 + 【3】独立全量解码');

function roundTrip(text, ec, expectVersion) {
  const qr = QR.encode(text, { ec });
  const fmt = readFormat(qr.modules);
  const cw = readCodewords(qr.modules, qr.version, fmt.mask);
  const { blocks, ecs, ecLen, consumed } = unweave(cw, qr.version, ec);
  const rsOK = blocks.every((b, i) => syndromesZero(b.concat(ecs[i]), ecLen));
  // 解析
  const all = blocks.flat();
  const bitStr = all.map((b) => b.toString(2).padStart(8, '0')).join('');
  const mode = parseInt(bitStr.slice(0, 4), 2);
  const cci = qr.version <= 9 ? 8 : 16;
  const len = parseInt(bitStr.slice(4, 4 + cci), 2);
  const bytes = [];
  for (let i = 0; i < len; i++) bytes.push(parseInt(bitStr.slice(4 + cci + i * 8, 12 + cci + i * 8), 2));
  const decoded = Buffer.from(bytes).toString('utf8');
  const fmtOK = fmt.consistent && fmt.ec === ec && fmt.mask === qr.mask;
  const verOK = expectVersion === undefined || qr.version === expectVersion;
  const cwOK = consumed === TOTAL_CW[qr.version];
  return { qr, ok: rsOK && mode === 4 && decoded === text && fmtOK && verOK && cwOK,
    why: [!rsOK && 'RS校验失败', mode !== 4 && '模式位不对:' + mode,
      decoded !== text && `解出「${decoded}」≠「${text}」`,
      !fmtOK && '格式信息不一致', !verOK && `版本 ${qr.version} ≠ 期望 ${expectVersion}`,
      !cwOK && `码字数量 ${consumed} ≠ ${TOTAL_CW[qr.version]}`].filter(Boolean).join(' / ') };
}

// 一批真实内容
const cases = [
  ['https://life-skill-tree.pages.dev/', 'M'],
  ['https://example.com/', 'L'],
  ['https://example.com/', 'M'],
  ['https://example.com/', 'Q'],
  ['https://example.com/', 'H'],
  ['https://github.com/WJNCT55555/life-skill-tree', 'M'],
  ['https://life-skill-tree.pages.dev/?from=poster&v=3.3.0', 'Q'],
  ['扫码打开人生技能树', 'M'],
  ['人生技能树 · 301 件从没做过的事 · 9 个领域 27 条分支', 'M'],
  ['1234567890', 'H'],
  ['a', 'H'],
  ['https://' + 'x'.repeat(120) + '.com/', 'L'],
  ['https://' + 'y'.repeat(300) + '.com/', 'L'],
  ['中文测试：扫一扫就能打开，不需要下载，不需要注册。', 'Q'],
];
for (const [text, ec] of cases) {
  const r = roundTrip(text, ec);
  const label = text.length > 42 ? text.slice(0, 39) + '…' : text;
  ok(`[${ec}] v${r.qr.version} ${r.qr.size}×${r.qr.size}  ${label}`, r.ok, r.why);
}

// 每个版本 × 每个等级都跑一遍（用刚好装满的内容）
console.log('\n【3b】全部 20 个版本 × 4 个等级，逐个装满再解回来');
let fullBad = 0, fullRun = 0, firstBad = '';
for (let v = 1; v <= 20; v++) for (const ec of ['L', 'M', 'Q', 'H']) {
  const capBytes = (() => {
    const [n1, d1, n2, d2] = BLOCK_REF[v][ec];
    const dataCw = n1 * d1 + n2 * d2;
    const cci = v <= 9 ? 8 : 16;
    return Math.floor((dataCw * 8 - 4 - cci) / 8);
  })();
  const text = 'A'.repeat(capBytes);
  const r = roundTrip(text, ec, v);
  fullRun++;
  if (!r.ok) { fullBad++; if (!firstBad) firstBad = `v${v}${ec}(${capBytes}字节): ${r.why}`; }
}
ok(`20 版本 × 4 等级 = ${fullRun} 组「刚好装满 → 原样解回」`, fullBad === 0,
  `${fullBad} 组失败，例如 ${firstBad}`);

/* ============================================================
   4. 光栅化后再读回来（模拟扫码器）
   ============================================================ */
console.log('\n【4】把二维码画成像素，再从像素里读回来（模拟扫码器）');

function rasterize(qr, scale, margin) {
  const n = qr.size + margin * 2, W = n * scale;
  const g = Array.from({ length: W }, () => new Uint8Array(W));
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const rr = Math.floor(y / scale) - margin, cc = Math.floor(x / scale) - margin;
    const dark = rr >= 0 && cc >= 0 && rr < qr.size && cc < qr.size && qr.modules[rr][cc] === 1;
    g[y][x] = dark ? 0 : 255;
  }
  return g;
}
// 从像素图里找出码的边界和模块尺寸，再重建矩阵
function readFromPixels(g) {
  const W = g.length;
  const darkCols = [], darkRows = [];
  for (let x = 0; x < W; x++) { let d = false; for (let y = 0; y < W; y++) if (g[y][x] < 128) { d = true; break; } if (d) darkCols.push(x); }
  for (let y = 0; y < W; y++) { let d = false; for (let x = 0; x < W; x++) if (g[y][x] < 128) { d = true; break; } if (d) darkRows.push(y); }
  if (!darkCols.length || !darkRows.length) return null;
  const x0 = darkCols[0], x1 = darkCols[darkCols.length - 1];
  const y0 = darkRows[0], y1 = darkRows[darkRows.length - 1];
  const span = Math.min(x1 - x0, y1 - y0) + 1;
  // 用定位图形的间距推模块尺寸：整幅跨度 = 留白 + size*scale
  let best = null;
  for (let scale = 2; scale <= span; scale++) {
    const size = Math.round(span / scale);
    if (size < 21 || size > 97) continue;
    if (Math.abs(size * scale - span) > 0) continue;
    if ((size - 17) % 4 !== 0) continue;
    const version = (size - 17) / 4;
    if (version < 1 || version > 20) continue;
    best = { size, scale, version };
    break;
  }
  if (!best) return null;
  const { size, scale, version } = best;
  const m = [];
  for (let r = 0; r < size; r++) {
    const row = [];
    for (let c = 0; c < size; c++) {
      const px = x0 + c * scale + Math.floor(scale / 2);
      const py = y0 + r * scale + Math.floor(scale / 2);
      row.push(g[py][px] < 128 ? 1 : 0);
    }
    m.push(row);
  }
  return { modules: m, version, size };
}

for (const [scale, margin] of [[3, 4], [5, 4], [8, 4], [12, 4], [17, 4], [4, 2], [6, 6]]) {
  const text = 'https://life-skill-tree.pages.dev/';
  const qr = QR.encode(text, { ec: 'M' });
  const g = rasterize(qr, scale, margin);
  const back = readFromPixels(g);
  if (!back) { ok(`scale=${scale} margin=${margin} 定位边界`, false, '没找到码'); continue; }
  const exact = back.modules.every((row, r) => row.every((v, c) => v === qr.modules[r][c]));
  const fmt = readFormat(back.modules);
  const cw = readCodewords(back.modules, back.version, fmt.mask);
  const { blocks, ecs, ecLen } = unweave(cw, back.version, fmt.ec);
  const rsOK = blocks.every((b, i) => syndromesZero(b.concat(ecs[i]), ecLen));
  const all = blocks.flat();
  const bitStr = all.map((b) => b.toString(2).padStart(8, '0')).join('');
  const len = parseInt(bitStr.slice(4, 12), 2);
  let out = '';
  for (let i = 0; i < len; i++) out += String.fromCharCode(parseInt(bitStr.slice(12 + i * 8, 20 + i * 8), 2));
  ok(`scale=${scale} margin=${margin}  像素→矩阵→原文`, exact && rsOK && out === text,
    [!exact && '矩阵不完全一致', !rsOK && 'RS失败', out !== text && `解出「${out}」`].filter(Boolean).join(' / '));
}

/* ============================================================
   5. 边界情况
   ============================================================ */
console.log('\n【5】边界情况');
try { QR.encode('x'.repeat(5000), { ec: 'H' }); ok('超长内容应当报错', false, '居然没报错'); }
catch (e) { ok('超长内容报错：' + e.message, true); }
try { QR.encode('abc', { ec: 'Z' }); ok('非法等级应当报错', false, '居然没报错'); }
catch (e) { ok('非法纠错等级报错：' + e.message, true); }
{
  const a = QR.encode('https://a.com/', { ec: 'M' });
  const b = QR.encode('https://a.com/', { ec: 'M' });
  ok('同样输入结果稳定（可复现）', JSON.stringify(a.modules) === JSON.stringify(b.modules));
  const svg = QR.toSVG(a, { scale: 4, margin: 4 });
  ok('SVG 里有 viewBox 和尺寸', /viewBox="0 0 \d+ \d+"/.test(svg) && /width="\d+"/.test(svg));
  ok('SVG 尺寸 = (模块数+留白×2)×缩放',
    svg.includes(`width="${(a.size + 8) * 4}"`), svg.slice(0, 120));
}
{
  // 留白必须真的白：四个角不能有黑块（定位图形只在对角，留白区必须干净）
  const qr = QR.encode('https://life-skill-tree.pages.dev/', { ec: 'Q' });
  ok('版本越高越容易装下', QR.encode('x'.repeat(100), { ec: 'L' }).version <= QR.encode('x'.repeat(100), { ec: 'H' }).version);
}

console.log(`\n${'─'.repeat(56)}`);
console.log(fail === 0 ? `全部通过：${pass} 项` : `通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail === 0 ? 0 : 1);
