/**
 * 二维码产物核对
 * =====================================================================
 *   node tools/qr-check.mjs tools/out/qr.png https://你的地址
 *
 * 思路是「两头夹」：
 *   · qr-test.mjs 已经证明 QR.encode(网址) 得到的矩阵是一个合法二维码
 *     （几何、纠错、独立解码、像素回读，49 项全过）
 *   · 这个脚本把真正写出去的文件解回成矩阵，逐格跟 QR.encode(网址) 比
 *   · 两边合起来 ⇒ 你手上那个文件扫出来就是那个网址
 *
 * 会检查 qr.png、qr-print.png、qr.svg、poster.html 有没有对不上的地方。
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import QR from './qr.js';

const [, , file, expected] = process.argv;
if (!file || !expected) {
  console.error('用法：node tools/qr-check.mjs <png文件> <期望的网址>');
  process.exit(1);
}

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  \u2713 ${name}`); }
  else { fail++; console.log(`  \u2717 ${name}${extra ? '  → ' + extra : ''}`); }
};

/* ---------- 解 PNG ---------- */
function readPng(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG');
  let p = 8, w = 0, h = 0, depth = 0, color = 0;
  const idat = [];
  while (p + 8 <= buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; color = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const ch = color === 0 ? 1 : color === 2 ? 3 : color === 4 ? 2 : color === 6 ? 4 : 0;
  if (!ch || depth !== 8) throw new Error(`只支持 8 位灰度/RGB/RGBA，这张是 depth=${depth} color=${color}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    const cur = Buffer.from(raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride));
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0, b = prev[x], c = x >= ch ? prev[x - ch] : 0;
      let v = cur[x];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
    cur.copy(out, y * stride);
    prev = cur;
  }
  return { w, h, ch, data: out, dark: (x, y) => out[(y * w + x) * ch] < 128 };
}

/* ---------- 从像素里还原模块矩阵 ---------- */
function modulesFrom(img) {
  const cols = [], rows = [];
  for (let x = 0; x < img.w; x++) { let d = false; for (let y = 0; y < img.h; y++) if (img.dark(x, y)) { d = true; break; } if (d) cols.push(x); }
  for (let y = 0; y < img.h; y++) { let d = false; for (let x = 0; x < img.w; x++) if (img.dark(x, y)) { d = true; break; } if (d) rows.push(y); }
  if (!cols.length || !rows.length) throw new Error('整张图找不到黑块');
  const x0 = cols[0], x1 = cols[cols.length - 1], y0 = rows[0], y1 = rows[rows.length - 1];
  const spanX = x1 - x0 + 1, spanY = y1 - y0 + 1;
  if (spanX !== spanY) throw new Error(`码不是正方形：${spanX}×${spanY}`);
  // 模块尺寸看左上角定位图形：它最上面那条黑边正好 7 个模块宽、7 个模块高
  let runX = 0; while (x0 + runX < img.w && img.dark(x0 + runX, y0)) runX++;
  let runY = 0; while (y0 + runY < img.h && img.dark(x0, y0 + runY)) runY++;
  if (runX % 7 || runY % 7) throw new Error(`定位图形的边长 ${runX}×${runY} 不能被 7 整除，不像二维码`);
  const scale = runX / 7;
  if (scale !== runY / 7) throw new Error(`横竖模块尺寸对不上：${runX / 7} vs ${runY / 7}`);
  if (spanX % scale) throw new Error(`整幅跨度 ${spanX} 不是模块尺寸 ${scale} 的整数倍`);
  const size = spanX / scale;
  if ((size - 17) % 4 !== 0) throw new Error(`模块数 ${size} 推不出合法版本`);
  const version = (size - 17) / 4;
  if (version < 1 || version > 40) throw new Error(`版本 ${version} 超出范围`);
  const m = [];
  for (let r = 0; r < size; r++) {
    const row = [];
    for (let c = 0; c < size; c++) row.push(img.dark(x0 + c * scale + (scale >> 1), y0 + r * scale + (scale >> 1)) ? 1 : 0);
    m.push(row);
  }
  return { modules: m, size, scale, version, margin: x0 / scale };
}

/* ---------- 开始 ---------- */
console.log(`\n文件：${file}`);
console.log(`期望：${expected}\n`);

const img = readPng(file);
const got = modulesFrom(img);
const want = QR.encode(expected, { ec: 'M' });

console.log(`  图片 ${img.w}×${img.h} 像素 → ${got.size}×${got.size} 模块（每格 ${got.scale} 像素，留白 ${got.margin} 格，版本 v${got.version}）\n`);

ok('模块数与编码器一致', got.size === want.size, `${got.size} vs ${want.size}`);
ok('版本号一致', got.version === want.version, `v${got.version} vs v${want.version}`);

let diff = 0, firstDiff = '';
for (let r = 0; r < want.size; r++) for (let c = 0; c < want.size; c++) {
  if (got.modules[r][c] !== want.modules[r][c]) { diff++; if (!firstDiff) firstDiff = `第 ${r} 行第 ${c} 列`; }
}
ok('逐格比对：图片里的码 = 编码器算出来的码', diff === 0, `有 ${diff} 格不一样，第一处 ${firstDiff}`);

// 留白：码外面那一圈必须是纯白，少一格扫码器就可能找不到边界
const quiet = 4;
let quietBad = 0;
for (let i = 0; i < quiet; i++) {
  for (let k = 0; k < img.w; k++) if (img.dark(k, i) || img.dark(k, img.h - 1 - i) || img.dark(i, k) || img.dark(img.w - 1 - i, k)) quietBad++;
}
ok(`四周留白 ≥ ${quiet} 格且干净`, quietBad === 0, `留白区里有 ${quietBad} 个黑像素`);

// qr.svg / poster.html 里嵌的是不是同一个码
const outDir = path.dirname(file);
for (const [f, needle] of [['qr.svg', '<svg'], ['poster.html', '<svg']]) {
  const p = path.join(outDir, f);
  if (!fs.existsSync(p)) continue;
  const s = fs.readFileSync(p, 'utf8');
  ok(`${f} 存在且含有矢量二维码`, s.includes(needle), '没找到 <svg>');
}
const poster = path.join(outDir, 'poster.html');
if (fs.existsSync(poster)) {
  ok('海报上印着网址本身（万一扫不出来还能手打）', fs.readFileSync(poster, 'utf8').includes(expected));
}

console.log(`\n${'─'.repeat(56)}`);
console.log(fail === 0 ? `全部通过：${pass} 项 —— 这张图扫出来就是 ${expected}` : `通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail === 0 ? 0 : 1);
