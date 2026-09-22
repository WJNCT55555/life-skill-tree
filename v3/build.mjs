#!/usr/bin/env node
/**
 * 人生技能树 v3.1 · 构建
 * =====================================================================
 * 数据：nodes.mjs（208 个节点）+ data.mjs（领域/分支/主题周/元数据）
 * 界面：template.html
 * 本脚本：校验 → 派生标签 → 分配 15 个主题周（105 天）→ 合成单文件
 *
 * 用法：node v3/build.mjs
 * 产出：index.html（双击即用，也是网站首页） + docs/科技树总览.md（可打印）
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import * as D from './data.mjs';
import { NODES } from './nodes.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const STAMP = new Date().toISOString().slice(0, 10);
const { DOMAINS, BRANCHES, WEEKS, TIER_NAME, UNLOCK_NEED, TOTAL_DAYS, VERSION, DAILY_POWER, POWER_LEVELS, powerOfMinutes } = D;

/* ============================================================
   1. 校验 + 组装
   ============================================================ */
const problems = [];
const BR = {};
BRANCHES.forEach((b) => {
  BR[b.key] = b;
  if (!DOMAINS.some((d) => d.key === b.dm)) problems.push(`分支 ${b.key} 的领域非法：${b.dm}`);
  // 属性层已移除：分支名本身就承担"这条线在练什么"的表达
});
if (BRANCHES.length !== 27) problems.push(`分支数为 ${BRANCHES.length}，应为 27`);
if (DOMAINS.length !== 9) problems.push(`领域数为 ${DOMAINS.length}，应为 9`);
const brKeys0 = new Set(BRANCHES.map((b) => b.key));
for (const k of Object.keys(NODES)) if (!brKeys0.has(k)) problems.push(`NODES 里有未知分支 ${k}`);
for (const k of Object.keys(NODES)) if (!BR[k]) problems.push(`NODES 里有未知分支 ${k}`);
if (WEEKS.length !== 15) problems.push(`主题周数为 ${WEEKS.length}，应为 15`);
if (WEEKS.length * 7 !== TOTAL_DAYS) problems.push(`主题周 × 7 ≠ ${TOTAL_DAYS} 天`);

// 每个主题周从哪些分支取节点（构建时按顺序分配，每条 7 个）
const WEEK_POOLS = [
  ['n1', 'n2', 'n3', 'o3'],                        // 1 把自己找回来
  ['n3'],                                          // 2 数字断食
  ['n2', 'n1'],                                    // 3 心性训练
  ['n1', 'n2'],                                    // 4 睡眠修复
  ['b1', 'b2', 'b3'],                              // 5 身体与胆量
  ['m1', 'o3'],                                    // 6 把脑子拆开
  ['m2', 'm1'],                                    // 7 知识边界
  ['m3'],                                          // 8 能力边界
  ['c1', 'c2', 'c3'],                              // 9 生存工具箱
  ['t2', 't1'],                                    // 10 一个人也过得好
  ['t3', 't2'],                                    // 11 打开地图
  ['x1', 'x2', 'x3'],                              // 12 留下痕迹
  ['s1', 's2', 's3'],                              // 13 把话说清楚
  ['o1', 'o2', 'c1'],                              // 14 秩序与资产
  ['f1', 'f2', 'f3', 't1'],                        // 15 重新做人（信仰收束）
];

if (BRANCHES.length !== 27) problems.push(`分支数为 ${BRANCHES.length}，应为 27`);
if (DOMAINS.length !== 9) problems.push(`领域数为 ${DOMAINS.length}，应为 9`);

const all = [];
let seq = 0;
for (const br of BRANCHES) {
  const list = NODES[br.key];
  if (!list || !list.length) { problems.push(`分支 ${br.key} 没有节点`); continue; }
  const tiers = list.map((x) => x[1]).sort((a, b) => a - b);
  if (tiers.length < 3 || tiers.length > 15) problems.push(`分支 ${br.key} 有 ${tiers.length} 个节点（应 3-15）`);
  if (tiers[0] !== 1) problems.push(`分支 ${br.key} 缺第 1 层入口`);
  const maxT = tiers[tiers.length - 1];
  // 允许最多一个断层：那是给"史诗分支"追加更高层级时留的（如 探索 t3 从 T6 跳到 T8）
  const gaps = [];
  for (let i = 1; i <= maxT; i++) if (!tiers.includes(i)) gaps.push(i);
  if (gaps.length > 1) problems.push(`分支 ${br.key} 缺第 ${gaps.join('、')} 层（最多允许 1 个断层）`);
  if (gaps.length === 1 && maxT < 8) problems.push(`分支 ${br.key} 有断层但最高只到第 ${maxT} 层（断层只允许出现在远征级分支）`);
  for (let i = 1; i <= maxT; i++) {
    const c = tiers.filter((x) => x === i).length;
    if (c > 2) problems.push(`分支 ${br.key} 第 ${i} 层有 ${c} 个节点（最多 2 个）`);
  }

  const seen = new Set();
  for (const [title, tier, min, doo, win, place, when, ppl, phys] of list) {
    seq++;
    if (seen.has(title)) problems.push(`分支 ${br.key} 内重复标题：${title}`);
    seen.add(title);
    if (!title || !doo || !win) { problems.push(`${br.key} 有一条节点字段缺失`); continue; }
    // 任务名：简洁有趣（6-16 字）
    if (title.length < 4 || title.length > 16) problems.push(`任务名长度不合适（${title.length} 字）：${title}`);
    if (/[，。！？；：]/.test(title)) problems.push(`任务名不该带标点：${title}`);
    // 描述：具体可执行。25 字是底线（防"看一场电影"这种愿望级条目）
    if (doo.length < 25) problems.push(`描述太笼统（${doo.length} 字）：${title}`);
    if (win.length < 8) problems.push(`"为什么"太短：${title}`);
    if (!(min > 0)) problems.push(`时长非法：${title}`);
    const pw = powerOfMinutes(min);
    if (!POWER_LEVELS.includes(pw)) problems.push(`体力值不在允许档位：${title} = ${pw}`);
    if (doo === win) problems.push(`描述与为什么重复：${title}`);
    const cost = (D.COST && D.COST[title]) || 0;
    const tags = [...new Set([
      D.PEOPLE_TAGS[ppl], D.PLACE_TAGS[place], D.TIME_TAGS[when], D.COST_TAGS[cost],
      phys >= 4 ? '体力活' : '',
    ].filter(Boolean))];
    all.push({
      id: 'T' + String(seq).padStart(3, '0'), idx: seq, t: title, dm: br.dm, tier, br: br.key,
      min, cost, place, when, ppl, phys, power: powerOfMinutes(min), do: doo, win,
      q: (D.QSET_FALLBACK || null) ? [] : [],
      tags, brName: br.name, brIcon: br.icon, week: null,
    });
  }
}
if (all.length < 301) problems.push(`节点总数 ${all.length}，题库应 ≥301 个`);
const dupAll = new Set();
for (const t of all) {
  if (dupAll.has(t.t)) problems.push(`全局重复标题：${t.t}`);
  dupAll.add(t.t);
}
DOMAINS.forEach((d) => {
  if (BRANCHES.filter((b) => b.dm === d.key).length !== 3) problems.push(`领域 ${d.key} 分支数不是 3`);
});

/* ============================================================
   2. 追问（按领域模板生成，标题嵌进去）
   ============================================================ */
const QSET = {
  craft: [
    { t: '手感在哪', q: '「{T}」这件事，你手上的感觉和事先想的一样吗？哪个动作比你以为的更别扭？' },
    { t: '卡在哪一步', q: '哪一步差点让你放弃或想找人代做？如果明天再做一遍，你会先改哪一步？' },
    { t: '迁移', q: '这种"先量、再试、再修"的手感，还能用在生活里哪件你一直拖着不肯动手的事上？' },
  ],
  body: [
    { t: '身体的反应', q: '做「{T}」的时候，身体在哪一刻明确说了"不行"？你当时是听它的，还是越过去了？' },
    { t: '恐惧的真身', q: '真正让你犹豫的是危险本身，还是"别人会怎么看我"？事后回看，这个犹豫值多少？' },
    { t: '迁移', q: '这种"怕但照做"的经验，有没有改变你对自己胆量的判断？下次什么场合你会用上它？' },
  ],
  mind: [
    { t: '你原来的假设', q: '开始「{T}」之前，你心里其实已经有答案了吗？动手之后，它被证实还是被推翻？' },
    { t: '认知更新', q: '有什么是你今天才第一次真正搞懂的？用一句你自己的话讲出来（不许用术语）。' },
    { t: '迁移', q: '这个思路能解释你生活里哪个反复出现的麻烦？如果用它做决定，你会改变哪一件事？' },
  ],
  aesthetic: [
    { t: '最想删掉的部分', q: '回头看「{T}」的成果，你最想删掉或重做的是哪一部分？为什么当时没看出来？' },
    { t: '真正的阻力', q: '今天阻碍你的，是技巧不够，还是"怕做出来难看"？这两者你分得清吗？' },
    { t: '迁移', q: '如果你允许自己做得更差、但更快完成，下一个作品会是什么？' },
  ],
  order: [
    { t: '最刺眼的数字', q: '整理「{T}」的过程中，哪个数字或哪条记录最让你不舒服？它说明了什么？' },
    { t: '真正的成本', q: '这件事拖到现在才做，你付出的代价是什么？（钱、时间、机会、还是情绪）' },
    { t: '迁移', q: '如果只能保留今天建立的其中一条规则，你会留哪一条？为什么是它？' },
  ],
  aesthetic: [
    { t: '感官记录', q: '做「{T}」的时候，你注意到哪一个具体的感官细节（味道、光、声音、触感）是以前忽略的？' },
    { t: '为什么以前不做', q: '这件并不难、也不贵的事，你为什么到今天才第一次做？真正的原因是什么？' },
    { t: '迁移', q: '如果每周固定留出两小时"只做这种没用但舒服的事"，你愿意从哪一天开始？' },
  ],
  night: [
    { t: '身体的变化', q: '做「{T}」前后，你的身体状态（困意、心跳、肩颈、呼吸）有什么具体的不同？' },
    { t: '失去的那段', q: '省下来的这段时间，如果之前是被手机吃掉的，你现在更清楚它是怎么被吃掉的了么？' },
    { t: '迁移', q: '这件事里哪一部分可以变成你每天晚上不假思索就执行的固定动作？' },
  ],
  taste: [
    { t: '感官记录', q: '做「{T}」的时候，你注意到哪一个具体的感官细节（味道、光、声音、触感）是以前忽略的？' },
    { t: '为什么以前不做', q: '这件并不难、也不贵的事，你为什么到今天才第一次做？真正的原因是什么？' },
    { t: '迁移', q: '如果每周固定留出两小时"只做这种没用但舒服的事"，你愿意从哪一天开始？' },
  ],
  charm: [
    { t: '对方的反应', q: '在「{T}」里，对方的反应和你预演的一样吗？你原来担心会发生什么，实际发生了什么？' },
    { t: '你的不适阈值', q: '你感到不舒服的那一秒在想什么？那个念头是真的，还是你替对方想的？' },
    { t: '迁移', q: '这次之后，你愿意把哪一段关系往前推一步？具体到下一步动作是什么？' },
  ],
  faith: [
    { t: '你真的相信吗', q: '做「{T}」的时候，有没有哪一刻你只是在完成动作、心里其实不信？那一刻你察觉到了什么？' },
    { t: '最难面对的部分', q: '这件事里最让你想回避的是哪一段？你回避的到底是它，还是它引出来的某个念头？' },
    { t: '迁移', q: '如果今天想的这些是真的，你明天会少做哪件事、多做哪件事？' },
  ],
};
all.forEach((t) => { t.q = QSET[t.dm].map((x) => ({ t: x.t, q: x.q.replace('{T}', t.t) })); });

/* ============================================================
   3. 分配 15 个主题周（105 天）
   ============================================================ */
const slots = WEEKS.map(() => []);
const assigned = new Set();
// 第一轮：按主题周的指定分支，每条分支内部按层级从低到高分配
for (let w = 0; w < WEEKS.length; w++) {
  const pool = WEEK_POOLS[w] || [];
  for (const brKey of pool) {
    if (slots[w].length >= 7) break;
    const list = all.filter((t) => t.br === brKey && !assigned.has(t.id))
      .sort((a, b) => a.tier - b.tier || a.min - b.min);
    for (const t of list) {
      if (slots[w].length >= 7) break;
      slots[w].push(t.id); assigned.add(t.id);
    }
  }
}
// 第二轮：没分到周的节点，补进还不满 7 个的周（按周顺序）
const leftover = all.filter((t) => !assigned.has(t.id));
for (const t of leftover) {
  const w = slots.findIndex((s) => s.length < 7);
  if (w < 0) break;
  slots[w].push(t.id); assigned.add(t.id);
}
slots.forEach((s, i) => {
  if (s.length !== 7) problems.push(`第 ${i + 1} 周只有 ${s.length} 个节点（应为 7）`);
});
const assignedCount = slots.reduce((a, b) => a + b.length, 0);
if (assignedCount !== TOTAL_DAYS) problems.push(`已分配 ${assignedCount} 个节点，应为 ${TOTAL_DAYS}`);
// 回写 week 字段
const idToTask = {};
all.forEach((t) => { idToTask[t.id] = t; });
slots.forEach((s, i) => s.forEach((id) => { idToTask[id].week = i + 1; }));

const unassigned = all.filter((t) => !t.week);
console.log(`题库 ${all.length} 个节点 → 105 个进入 15 周主线，${unassigned.length} 个留作备选池`);

/* ============================================================
   4. 成就
   ============================================================ */
const ACHS = [
  { id: 'a1',   ic: '🔥', n: '启程',       d: '点亮第 1 个节点',            k: 'done>=1' },
  { id: 'a3',   ic: '⚡', n: '三分钟热度也没关系', d: '连续 3 天点亮',        k: 'streak>=3' },
  { id: 'a7',   ic: '🗓️', n: '一周了',     d: '连续 7 天点亮',              k: 'streak>=7' },
  { id: 'a14',  ic: '🌗', n: '半个月',     d: '连续 14 天点亮',             k: 'streak>=14' },
  { id: 'a21',  ic: '🧠', n: '习惯成形',   d: '连续 21 天点亮',             k: 'streak>=21' },
  { id: 'a30',  ic: '🏅', n: '一个月',     d: '累计打卡 30 天',             k: 'days>=30' },
  { id: 'a50',  ic: '💎', n: '半程',       d: '累计打卡 50 天',             k: 'days>=50' },
  { id: 'a105', ic: '🐉', n: '105 天毕业', d: '走完 15 个主题周',           k: 'weekDone>=15' },
  { id: 'w1',   ic: '🌅', n: '第一周通关', d: '第 1 周 7 个节点全部完成',   k: 'weekDone>=1' },
  { id: 'w3',   ic: '🧭', n: '三周通关',   d: '3 个主题周全部完成',         k: 'weekDone>=3' },
  { id: 'w7',   ic: '🗺️', n: '半程线',     d: '7 个主题周全部完成',         k: 'weekDone>=7' },
  { id: 'w11',  ic: '🌌', n: '十一周',     d: '11 个主题周全部完成',        k: 'weekDone>=11' },
  { id: 't2',   ic: '🌱', n: '第一层通关', d: '任意领域解锁第 2 层',        k: 'tier2>=1' },
  { id: 't3',   ic: '🌿', n: '第二层通关', d: '任意领域解锁第 3 层',        k: 'tier3>=1' },
  { id: 't4',   ic: '🌳', n: '第三层通关', d: '任意领域解锁第 4 层',        k: 'tier4>=1' },
  { id: 't8',   ic: '🏔️', n: '四条线到顶', d: '4 个领域解锁第 4 层',        k: 'tier4>=4' },
  { id: 'end1',  ic: '🧭', n: '世界尽头',    d: '抵达火地岛或勘察加（任一个）',  k: 'worldEnds>=1' },
  { id: 'end2',  ic: '🌐', n: '两端都到了',  d: '火地岛与勘察加都抵达',        k: 'worldEnds>=2' },
  { id: 'br3',  ic: '🧭', n: '走通一条线', d: '任意分支全部完成',           k: 'brDone>=1' },
  { id: 'pw1',   ic: '⚡', n: '超额完成',    d: '单日体力消耗超过 15 点',      k: 'over>=1' },
  { id: 'pw5',   ic: '🔋', n: '停不下来',    d: '累计 5 天超额完成',          k: 'over>=5' },
  { id: 'pw20',  ic: '🌊', n: '体力怪物',    d: '累计 20 天超额完成',         k: 'over>=20' },
  { id: 'max1',  ic: '🧨', n: '一天干完三天', d: '单日消耗达到 45 点（15×3）', k: 'maxDay>=45' },
  { id: 'br9',   ic: '🎯', n: '九线九通',   d: '9 条分支全部完成',           k: 'brDone>=9' },
  { id: 'br18',  ic: '🌗', n: '十八线',     d: '18 条分支全部完成',          k: 'brDone>=18' },
  { id: 'br27',  ic: '✨', n: '全图点亮',   d: '27 条分支全部完成',          k: 'brDone>=27' },
  { id: 'q10',  ic: '✍️', n: '开始思考了', d: '认真写完 10 组追问',         k: 'qDone>=10' },
  { id: 'q30',  ic: '🔍', n: '自我审讯',   d: '认真写完 30 组追问',         k: 'qDone>=30' },
  { id: 'q60',  ic: '🧭', n: '把自己看穿了', d: '认真写完 60 组追问',       k: 'qDone>=60' },
  { id: 'dom9', ic: '🌍', n: '九域开光',   d: '9 个领域各有至少 1 个节点',  k: 'allDom1' },
  { id: 'dom5', ic: '📐', n: '均衡之人',   d: '9 个领域各有至少 5 个节点',  k: 'allDom5' },
  { id: 'faith1', ic: '🕯️', n: '问过终点',  d: '完成 3 个「信仰」领域节点',  k: 'faith3' },
  { id: 'faith2', ic: '🤍', n: '利他者',    d: '完成 6 个「信仰」领域节点',  k: 'faith6' },
  { id: 'free', ic: '🪙', n: '零成本也能活', d: '完成 10 个"零成本"节点',   k: 'free10' },
  { id: 'solo', ic: '🌙', n: '独处者',     d: '完成 15 个"独自一人"节点',   k: 'solo15' },
  { id: 'brave',ic: '🔥', n: '硬着头皮',   d: '完成 10 个"勇气"属性节点',   k: 'courage10' },
  { id: 'c1',   ic: '🛡️', n: '不动如山',   d: '最长连续 30 天',             k: 'best>=30' },
  { id: 'c2',   ic: '🧗', n: '不死鸟',     d: '最长连续 66 天',             k: 'best>=66' },
  { id: 'p1',   ic: '📄', n: '有一份档案了', d: '导出一次能力档案',         k: 'profileExported' },
];

const achIds = new Set(), achKeys = new Set();
for (const a of ACHS) {
  if (achIds.has(a.id)) problems.push(`成就 id 重复：${a.id}`);
  if (achKeys.has(a.k)) problems.push(`成就条件重复：${a.k}`);
  achIds.add(a.id); achKeys.add(a.k);
}
if (problems.length) {
  console.error('❌ v3 数据自检失败：');
  problems.forEach((p) => console.error('   - ' + p));
  process.exit(1);
}

/* ============================================================
   5. 生成 HTML
   ============================================================ */
const weeks = WEEKS.map((w, i) => ({ ...w, key: 'w' + w.n, ids: slots[i] }));
const DATA = { VERSION, STAMP, TOTAL_DAYS, DAILY_POWER, POWER_LEVELS, POWER_LABEL: D.POWER_LABEL, DOMAINS, BRANCHES, WEEKS: weeks, TASKS: all, ACHS,
  UNLOCK_NEED, TIER_NAME, PEOPLE_TAGS: D.PEOPLE_TAGS, PLACE_TAGS: D.PLACE_TAGS, TIME_TAGS: D.TIME_TAGS, COST_TAGS: D.COST_TAGS };
let html = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf8')
  .replaceAll('{{DATA_JSON}}', JSON.stringify(DATA))
  .replaceAll('{{STAMP}}', STAMP)
  .replaceAll('{{VERSION}}', VERSION)
  .replaceAll('{{NODE_COUNT}}', String(all.length))
  .replaceAll('{{BRANCH_COUNT}}', String(BRANCHES.length))
  .replaceAll('{{DOMAIN_COUNT}}', String(DOMAINS.length))
  .replaceAll('{{WEEK_COUNT}}', String(WEEKS.length))
  .replaceAll('{{DAY_COUNT}}', String(TOTAL_DAYS));
const left = html.match(/\{\{[A-Z_]+\}\}/g);
if (left) { console.error('❌ 模板占位符未替换：' + [...new Set(left)].join(', ')); process.exit(1); }

// 血的教训：标题、简介、分享文案里的数字以前是手写的，题库从 100 涨到 301、
// 分支从 24 涨到 27，这些地方没人记得改，页签上一直挂着「100 个节点」。
// 所以现在模板里不许再出现写死的规模数字，一律用 {{NODE_COUNT}} 这类占位符。
const tpl = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf8');
const SCALE_WORDS = '个节点|条路线|条分支|个领域|个主题周|个任务|个成就|天主线';
const hardcoded = [];
tpl.split('\n').forEach((line, i) => {
  const re = new RegExp(`\\d+\\s*(?:${SCALE_WORDS})`, 'g');
  const m = line.match(re);
  if (m) hardcoded.push(`第 ${i + 1} 行：${m.join('、')}  →  ${line.trim().slice(0, 90)}`);
});
if (hardcoded.length) {
  console.error('❌ 模板里有写死的规模数字，请改用 {{NODE_COUNT}} / {{BRANCH_COUNT}} / {{DOMAIN_COUNT}}：');
  hardcoded.forEach((h) => console.error('   - ' + h));
  process.exit(1);
}
fs.writeFileSync(path.join(ROOT, 'index.html'), html, 'utf8');

/* ============================================================
   6. 生成技能树清单
   ============================================================ */
const md = ['# 人生技能树 · 题库总览', '',
  `> 生成 ${STAMP} · ${DOMAINS.length} 领域 × 3 分支 = ${BRANCHES.length} 条路线`,
  `> 题库 ${all.length} 个节点；其中 105 个构成 15 个主题周（105 天主线），其余留作备选池`,
  `> 解锁规则：领域内第 N 层，需要第 N-1 层点亮 ${UNLOCK_NEED} 个`, '',
  '## 15 个主题周', '', '| 周 | 主题 | 节点 |', '|---|---|---|'];
weeks.forEach((w) => { md.push(`| 第 ${w.n} 周 | ${w.icon} ${w.name} | ${w.ids.length} 个 |`); });
md.push('');
for (const d of DOMAINS) {
  md.push(`## ${d.icon} ${d.name}（${all.filter((t) => t.dm === d.key).length} 个）`, '', `*${d.creed}*`, '');
  for (const b of BRANCHES.filter((x) => x.dm === d.key)) {
    md.push(`### ${b.icon} ${b.name}`, '', b.desc, '');
    for (const t of all.filter((x) => x.br === b.key)) {
      md.push(`- **${TIER_NAME[t.tier]}｜${t.t}**（${t.id} · 约 ${t.min} 分钟 · ${t.tags.join(' · ')}${t.week ? ' · 第 ' + t.week + ' 周' : ' · 备选池'}）`);
      md.push(`  - ${t.do}`);
      md.push(`  - *${t.win}*`);
    }
    md.push('');
  }
}
const allTags = {};
all.forEach((t) => t.tags.forEach((g) => { allTags[g] = (allTags[g] || 0) + 1; }));
md.push('## 标签索引', '', '| 标签 | 节点数 |', '|---|---|');
Object.entries(allTags).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => md.push(`| ${k} | ${v} |`));
fs.writeFileSync(path.join(ROOT, 'docs', '科技树总览.md'), md.join('\n'), 'utf8');

/* ============================================================
   7. 报告
   ============================================================ */
const byTier = [1, 2, 3, 4].map((k) => all.filter((t) => t.tier === k).length);
const kb = (fs.statSync(path.join(ROOT, 'index.html')).size / 1024).toFixed(1);
const avgNameLen = (all.reduce((a, b) => a + b.t.length, 0) / all.length).toFixed(1);
const avgDoLen = Math.round(all.reduce((a, b) => a + b.do.length, 0) / all.length);
console.log(`✅ v${VERSION} 构建完成`);
console.log(`   产物     : index.html (${kb} KB) + docs/科技树总览.md`);
console.log(`   题库     : ${all.length} 个节点 · ${BRANCHES.length} 条分支 · 每条 ${Object.values(NODES).map(n=>n.length).join('/')} 个`);
console.log(`   主线     : 15 个主题周 × 7 天 = ${TOTAL_DAYS} 天 · 备选池 ${unassigned.length} 个`);
console.log(`   层级分布 : 第1层 ${byTier[0]} · 第2层 ${byTier[1]} · 第3层 ${byTier[2]} · 第4层 ${byTier[3]}`);
console.log(`   任务名   : 平均 ${avgNameLen} 字 · 描述平均 ${avgDoLen} 字`);
console.log(`   标签     : ${Object.keys(allTags).length} 种 · 追问 ${all.reduce((a, b) => a + b.q.length, 0)} 个 · 成就 ${ACHS.length} 个`);
