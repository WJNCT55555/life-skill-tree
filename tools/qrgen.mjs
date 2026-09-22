/**
 * 二维码生成器（零依赖）
 * =====================================================================
 * 用法：
 *   node tools/qrgen.mjs https://你的地址
 *   node tools/qrgen.mjs https://你的地址 --title "人生技能树"
 *   node tools/qrgen.mjs https://你的地址 --only svg     # 只出矢量图
 *
 * 产出（tools/out/）：
 *   qr.svg         矢量图，印刷首选，放大不糊
 *   qr.png         位图，发微信 / 贴 PPT
 *   qr-print.png   高清位图，印刷用
 *   poster.html    A4 海报，浏览器打开后 Ctrl+P 打印或存 PDF
 *   qr.txt         终端文本版
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { deflateSync } from 'node:zlib';
import QR from './qr.js';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'out');

const argv = process.argv.slice(2);
const flags = { title: '扫码打开' };
const rest = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--title') flags.title = argv[++i];
  else if (argv[i] === '--sub') flags.sub = argv[++i];
  else if (argv[i] === '--only') flags.only = argv[++i];
  else rest.push(argv[i]);
}
const target = rest[0];
if (!target) {
  console.error(`
用法：node tools/qrgen.mjs <网址> [选项]

  --title "标题"      海报上的大标题
  --sub "副标题"      海报上的说明文字
  --only svg|png|poster|txt    只生成某一种（默认全部）

例子：
  node tools/qrgen.mjs https://life-skill-tree.pages.dev/
`);
  process.exit(1);
}

const qr = QR.encode(target, { ec: 'M' });
fs.mkdirSync(OUT, { recursive: true });
const want = (k) => !flags.only || flags.only === k;

console.log(`\n目标：${target}`);
console.log(`编码：v${qr.version} / ${qr.ec} 级纠错 / ${qr.size}×${qr.size} 模块`);
console.log(`内容 ${Buffer.byteLength(target, 'utf8')} 字节\n`);

/* ---------- 终端文本码 ---------- */
if (want('txt')) {
  const M = 2, n = qr.size + M * 2, lines = [];
  for (let r = 0; r < n; r++) {
    let line = '';
    for (let c = 0; c < n; c++) {
      const rr = r - M, cc = c - M;
      const dark = rr >= 0 && cc >= 0 && rr < qr.size && cc < qr.size && qr.modules[rr][cc] === 1;
      line += dark ? '  ' : '\u2588\u2588';
    }
    lines.push(line);
  }
  fs.writeFileSync(path.join(OUT, 'qr.txt'), lines.join('\n') + '\n\n' + target + '\n', 'utf8');
  console.log(lines.join('\n'));
  console.log('\n  ↑ 也可以直接把这个贴到聊天窗口，对方能扫\n');
}

/* ---------- SVG ---------- */
if (want('svg')) {
  fs.writeFileSync(path.join(OUT, 'qr.svg'),
    QR.toSVG(qr, { scale: 12, margin: 4, dark: '#05070a', light: '#ffffff' }), 'utf8');
  console.log('  ✓ tools/out/qr.svg          矢量图（印刷首选，放大不糊）');
}

/* ---------- PNG ---------- */
function makePng(scale, margin) {
  const n = qr.size + margin * 2, W = n * scale;
  const px = Buffer.alloc(W * W * 3);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const rr = Math.floor(y / scale) - margin, cc = Math.floor(x / scale) - margin;
    const dark = rr >= 0 && cc >= 0 && rr < qr.size && cc < qr.size && qr.modules[rr][cc] === 1;
    const i = (y * W + x) * 3;
    px[i] = dark ? 5 : 255; px[i + 1] = dark ? 7 : 255; px[i + 2] = dark ? 10 : 255;
  }
  const raw = Buffer.alloc((W * 3 + 1) * W);
  for (let y = 0; y < W; y++) {
    raw[y * (W * 3 + 1)] = 0;
    px.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
  }
  const T = (() => { const t = []; for (let n2 = 0; n2 < 256; n2++) { let c = n2; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n2] = c >>> 0; } return t; })();
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = T[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(W, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
if (want('png')) {
  fs.writeFileSync(path.join(OUT, 'qr.png'), makePng(10, 4));
  fs.writeFileSync(path.join(OUT, 'qr-print.png'), makePng(20, 4));
  console.log('  ✓ tools/out/qr.png          位图（发微信、贴 PPT）');
  console.log('  ✓ tools/out/qr-print.png    高清位图（印刷用）');
}

/* ---------- A4 海报 ---------- */
if (want('poster')) {
  const svg = QR.toSVG(qr, { scale: 10, margin: 3, dark: '#05070a', light: '#ffffff' });
  const sub = flags.sub || target;
  fs.writeFileSync(path.join(OUT, 'poster.html'), `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${flags.title} · 二维码</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body { margin:0; font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
         background:#05070a; color:#e6f0ea; }
  .page { width:210mm; height:297mm; padding:24mm 22mm; display:flex; flex-direction:column;
          align-items:center; justify-content:center; gap:9mm; }
  .brand { font-family:ui-monospace,Menlo,Consolas,monospace; font-size:13px; letter-spacing:4px;
           color:#3ddc84; border:1px solid rgba(61,220,132,.4); padding:5px 14px; border-radius:4px; }
  h1 { font-size:38px; margin:0; text-align:center; line-height:1.35; font-weight:800; letter-spacing:1px; }
  .sub { color:#8ca79b; font-size:15px; text-align:center; max-width:150mm; line-height:1.8; }
  .qrwrap { background:#fff; padding:8mm; border-radius:8px; box-shadow:0 0 0 1px rgba(61,220,132,.4); }
  .qrwrap svg { width:104mm; height:104mm; display:block; }
  .step { font-size:16px; color:#c7d8d0; text-align:center; line-height:2.1; }
  .step b { color:#3ddc84; font-family:ui-monospace,monospace; }
  .url { font-family:ui-monospace,Menlo,Consolas,monospace; font-size:12.5px; color:#5a6f66;
         word-break:break-all; text-align:center; max-width:150mm; }
  .foot { font-size:12px; color:#5a6f66; font-family:ui-monospace,monospace; letter-spacing:1px; }
  @media print { body { -webkit-print-color-adjust:exact; print-color-adjust:exact; } }
</style></head>
<body><div class="page">
  <div class="brand">&gt;_ 人生技能树</div>
  <h1>${flags.title}</h1>
  <div class="sub">${sub}</div>
  <div class="qrwrap">${svg}</div>
  <div class="step">用相机或微信 <b>扫一扫</b><br>不用下载、不用注册，点开就能用</div>
  <div class="url">${target}</div>
  <div class="foot">301 件从没做过的事 · 9 个领域 · 27 条分支</div>
</div></body></html>`, 'utf8');
  console.log('  ✓ tools/out/poster.html     A4 海报（浏览器打开 → Ctrl+P 打印或存 PDF）');
}

console.log(`
提醒：
  · 打印时二维码边长至少 4 cm，四周留白别裁掉
  · 微信朋友圈不支持识别图片里的二维码，所以二维码贴在能被看到的地方（海报/桌牌/PPT）
  · 微信里发给朋友请直接发链接
`);
