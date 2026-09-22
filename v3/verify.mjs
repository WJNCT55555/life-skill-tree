/** 构建后自检：体力系统关键数据 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.resolve(__dirname, '..', '人生成就系统.html'), 'utf8');
const i = html.indexOf('<script id="appdata"');
const j = html.indexOf('>', i) + 1;
const k = html.indexOf('</script>', j);
const D = JSON.parse(html.slice(j, k));

const h = {};
D.TASKS.forEach((t) => { h[t.power] = (h[t.power] || 0) + 1; });
console.log('每日体力     :', D.DAILY_POWER);
console.log('体力档位     :', D.POWER_LEVELS.join(' / '), '| 档位名:', JSON.stringify(D.POWER_LABEL));
console.log('体力分布     :', Object.keys(h).sort((a, b) => a - b).map((x) => x + '点=' + h[x] + '个').join('  '));
console.log('单节点范围   :', Math.min(...D.TASKS.map((t) => t.power)), '-', Math.max(...D.TASKS.map((t) => t.power)));
console.log('全在档位内   :', D.TASKS.every((t) => D.POWER_LEVELS.includes(t.power)));
console.log('成就         :', D.ACHS.length, '个 | 超额相关:',
  D.ACHS.filter((a) => /over|maxDay/.test(a.k)).map((a) => a.n).join('、'));
console.log('领域/分支/节点:', D.DOMAINS.length, '/', D.BRANCHES.length, '/', D.TASKS.length);
console.log('主题周       :', D.WEEKS.length, '周 ×', D.WEEKS[0].ids.length, '天');
console.log('追问总数     :', D.TASKS.reduce((a, b) => a + b.q.length, 0));

// 一天能凑出的组合（用真实节点验证）
const byPow = (p) => D.TASKS.filter((t) => t.power === p);
const combos = [
  ['15', [byPow(15)[0]]],
  ['10+5', [byPow(10)[0], byPow(5)[0]]],
  ['5+5+5', byPow(5).slice(0, 3)],
  ['10+3', [byPow(10)[0], byPow(3)[0]]],
  ['5+5+3', [byPow(5)[0], byPow(5)[1], byPow(3)[0]]],
];
console.log('\n每日 15 点的真实组合:');
for (const [label, cs] of combos) {
  const sum = cs.reduce((a, b) => a + b.power, 0);
  console.log(`  ${label.padEnd(7)} = ${String(sum).padStart(2)} 点  ${sum === 15 ? '✓ 正好达标' : sum > 15 ? '🎉 超额 ' + (sum - 15) : '差 ' + (15 - sum) + ' 点'}  ${cs.map((x) => x.t).join(' + ')}`);
}
