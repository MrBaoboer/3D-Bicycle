/**
 * core/bom.js 的单测：对角配对、拓扑排序、向量冻结。
 * 三者出错都不在浏览器里报错，只表现为画面异常，必须在 Node 里钉住。
 *
 *   node --test tools/bom.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Bom } from '../src/core/bom.js';

const ROOT = resolve(import.meta.dirname, '..');
const real = JSON.parse(await readFile(resolve(ROOT, 'assets/bike.manifest.json'), 'utf8'));

/** 一份最小的合法清单，按需改字段来触发某一条断言 */
const seed = (over = {}) => ({
  schema: 1,
  parts: [{
    id: 'p1', name: '件一', nodes: ['A'],
    install: { kind: 'slide', dir: [0, 1, 0], gap: 0.1, snap: 0.005 },
    fasten: [], needs: [],
  }],
  fasteners: [],
  ...over,
});

test('schema 对不上就当场抛，不往下猜字段含义', () => {
  assert.throws(() => new Bom({ schema: 2, parts: [], fasteners: [] }), /schema 期望 1/);
  assert.throws(() => new Bom(null), /schema 期望 1/);
  assert.throws(() => new Bom({ parts: [] }), /schema 期望 1/);
});

test('取不到的 id 抛错，并把有哪些 id 一并说出来', () => {
  const bom = new Bom(seed());
  assert.throws(() => bom.part('p9'), /没有 id 为 "p9" 的件.*p1/s);
  assert.throws(() => bom.fastener('f9'), /没有 id 为 "f9" 的紧固件/);
  assert.throws(() => bom.groupOf('不存在'), /没有名为 "不存在" 的紧固件分组/);
});

test('裸数组变成冻结的 Vector3，原始 JSON 一个字节都不动', () => {
  const src = seed();
  const bom = new Bom(src);
  const p = bom.part('p1');
  assert.equal(p.install.v.dir.y, 1);
  assert.ok(Object.isFrozen(p.install.v.dir));
  // 冻结防止共享实例被某处 negate 后，别处的装配方向跟着反
  assert.throws(() => { p.install.v.dir.y = -1; }, TypeError);
  assert.deepEqual(src.parts[0].install.dir, [0, 1, 0]);
});

test('nodesOf 发的是副本 —— 调用方排序或 push 不该改到清单', () => {
  const bom = new Bom(seed());
  const a = bom.nodesOf('p1');
  a.push('B');
  assert.deepEqual(bom.nodesOf('p1'), ['A']);
});

test('order() 只为满足 needs 而动，互不相干的两件保持清单书写顺序', () => {
  const bom = new Bom(seed({
    parts: [
      { id: 'c', name: 'c', nodes: ['A'], install: { dir: [0, 1, 0], gap: 1, snap: 0.1 }, needs: ['a'] },
      { id: 'a', name: 'a', nodes: ['A'], install: { dir: [0, 1, 0], gap: 1, snap: 0.1 }, needs: [] },
      { id: 'b', name: 'b', nodes: ['A'], install: { dir: [0, 1, 0], gap: 1, snap: 0.1 }, needs: [] },
    ],
  }));
  /*
   * 清单序 c、a、b，c 需要 a：只有 a 被提前，c 与 b 保持书写先后。
   * 书写顺序是作者定的讲述顺序，没有约束逼迫时不该被排序打乱。
   */
  assert.deepEqual(bom.order(), ['a', 'c', 'b']);
});

test('order() 发的是副本，且真实清单排得出一条合法序', () => {
  const bom = new Bom(real);
  const first = bom.order();
  first.length = 0;
  assert.equal(bom.order().length, bom.parts.length);
});

test('真实清单：装配序尊重每一条 needs —— 这是课程顺序的唯一约束', () => {
  const bom = new Bom(real);
  const at = new Map(bom.order().map((id, i) => [id, i]));
  for (const p of bom.parts) {
    for (const n of p.needs ?? []) {
      assert.ok(at.get(n) < at.get(p.id), `${p.id} 需要 ${n}，但排在了它前面`);
    }
  }
});

test('真实清单：课程里几条硬顺序确实成立', () => {
  const bom = new Bom(real);
  const at = new Map(bom.order().map((id, i) => [id, i]));
  const before = (a, b) => assert.ok(at.get(a) < at.get(b), `${a} 应当排在 ${b} 之前`);
  before('headset-lower', 'fork');       // 没压头碗，前叉无处可穿
  before('fork', 'stem');                // 没有舵管，把立套不上
  before('stem', 'handlebar');           // 没有把立，车把没有托座
  before('handlebar', 'grip-left');      // 没有车把，把套套在空气上
  before('rear-pivot', 'swingarm-left'); // 没有转点轴，摇臂挂不住
  before('crank-right', 'pedal-right');  // 没有曲柄，脚踏拧不进去
  before('chainring', 'chain');          // 链条要绕过牙盘
  before('rear-wheel', 'chain');         // 也要绕过飞轮
  before('caliper-front', 'front-wheel'); // 卡钳先在座上，碟片才有来令片可穿
  before('caliper-rear', 'rear-wheel');   // 后轮同一条出厂顺序
});

test('needs 成环时抛错并点名是谁在互相等', () => {
  const bom = new Bom(seed({
    parts: [
      { id: 'x', name: 'x', nodes: ['A'], install: { dir: [0, 1, 0], gap: 1, snap: 0.1 }, needs: ['y'] },
      { id: 'y', name: 'y', nodes: ['A'], install: { dir: [0, 1, 0], gap: 1, snap: 0.1 }, needs: ['x'] },
    ],
  }));
  assert.throws(() => bom.order(), /成环.*x.*y/s);
});

test('needs 指向不存在的件时抛错', () => {
  const bom = new Bom(seed({
    parts: [{ id: 'x', name: 'x', nodes: ['A'], install: { dir: [0, 1, 0], gap: 1, snap: 0.1 }, needs: ['无'] }],
  }));
  assert.throws(() => bom.order(), /needs 指向 "无"/);
});

// ── 对角配对：交叉拧紧的判定基础 ──

const cross = (points) => seed({
  fasteners: points.map((point, i) => ({
    id: `b${i}`, name: `b${i}`, group: 'g', order: 'cross',
    axis: [1, 0, 0], point,
  })),
});

test('crossPairs 把中心对称的两颗配成一对', () => {
  // 一个正方形：上左↔下右、上右↔下左
  const bom = new Bom(cross([[0, 1, 1], [0, -1, -1], [0, 1, -1], [0, -1, 1]]));
  const pairs = bom.crossPairs('g').map((p) => [...p].sort().join('+')).sort();
  assert.deepEqual(pairs, ['b0+b1', 'b2+b3']);
});

/*
 * crossPairs 必须发 id：调用方（interact/screw.js 的 _mate）拿它与 id 字符串比，
 * 发成对象则恒不相等，对角判定静默失效。见 docs/DEVELOPMENT.md「容易写反的签名」。
 */
test('crossPairs 发出的是 id，不是紧固件对象', () => {
  const bom = new Bom(cross([[0, 1, 1], [0, -1, -1], [0, 1, -1], [0, -1, 1]]));
  for (const pair of bom.crossPairs('g')) {
    for (const x of pair) assert.equal(typeof x, 'string', `对角配对发出了 ${typeof x}`);
  }
});

test('crossPairs 对真实清单给出上左↔下右、上右↔下左', () => {
  const bom = new Bom(real);
  const pairs = bom.crossPairs('stem-face').map((p) => [...p].sort().join('+')).sort();
  assert.deepEqual(pairs, ['stem-face-a+stem-face-b', 'stem-face-c+stem-face-d']);
});

test('crossMate 双向都问得出，问组外的那颗返回 null', () => {
  const bom = new Bom(real);
  assert.equal(bom.crossMate('stem-face', 'stem-face-a'), 'stem-face-b');
  assert.equal(bom.crossMate('stem-face', 'stem-face-b'), 'stem-face-a');
  assert.equal(bom.crossMate('stem-face', 'stem-face-c'), 'stem-face-d');
  assert.equal(bom.crossMate('stem-face', 'stem-face-d'), 'stem-face-c');
  assert.equal(bom.crossMate('stem-face', 'axle-front'), null);
});

test('不是对角布置时不硬配，抛错说清差了多少', () => {
  // 四颗挤在一条线上，谁也不是谁的对角
  const bom = new Bom(cross([[0, 0, 0], [0, 0, 1], [0, 0, 2], [0, 0, 5]]));
  assert.throws(() => bom.crossPairs('g'), /找不到对角的那一颗.*组半径/s);
});

test('组里有一颗 order 不是 cross，就不谈对角', () => {
  const src = cross([[0, 1, 1], [0, -1, -1], [0, 1, -1], [0, -1, 1]]);
  src.fasteners[2].order = 'any';
  assert.throws(() => new Bom(src).crossPairs('g'), /order 不是 cross/);
});

test('奇数颗或不足四颗都不谈对角', () => {
  assert.throws(() => new Bom(cross([[0, 1, 1], [0, -1, -1]])).crossPairs('g'), /偶数颗且不少于 4 颗/);
  assert.throws(
    () => new Bom(cross([[0, 1, 1], [0, -1, -1], [0, 1, -1]])).crossPairs('g'),
    /偶数颗且不少于 4 颗/,
  );
});

// ── 真实清单：内容层依赖的那几条 ──

test('真实清单：二十六个件、七颗紧固件，id 与步骤脚本写死的常量对得上', () => {
  const bom = new Bom(real);
  assert.deepEqual(bom.counts, { parts: 27, fasteners: 7 });
  for (const id of ['rear-pivot', 'swingarm-left', 'swingarm-right', 'shock', 'bash-guard',
    'headset-lower', 'headset-upper', 'fork', 'stem', 'handlebar',
    'grip-left', 'grip-right', 'lever-left', 'lever-right',
    'chainring', 'crank-left', 'crank-right', 'derailleur', 'chain',
    'rear-wheel', 'front-wheel', 'caliper-front', 'caliper-rear',
    'hoses', 'seatpost', 'pedal-left', 'pedal-right']) {
    assert.equal(bom.part(id).id, id, `步骤脚本用到的件 ${id} 不在清单里`);
  }
  for (const id of ['axle-front', 'pedal-left-spindle', 'pedal-right-spindle',
    'stem-face-a', 'stem-face-b', 'stem-face-c', 'stem-face-d']) {
    assert.equal(bom.fastener(id).id, id, `步骤脚本用到的紧固件 ${id} 不在清单里`);
  }
});

test('真实清单：左脚踏是反牙，右脚踏是正牙 —— 这是本项目要教的那一课', () => {
  const bom = new Bom(real);
  assert.equal(bom.fastener('pedal-left-spindle').thread, 'left');
  assert.equal(bom.fastener('pedal-right-spindle').thread, 'right');
});

test('真实清单：两只脚踏是旋入（thread），三件是推入（slide）', () => {
  const bom = new Bom(real);
  const kinds = Object.fromEntries(bom.parts.map((p) => [p.id, p.install.kind]));
  assert.equal(kinds['pedal-left'], 'thread');
  assert.equal(kinds['pedal-right'], 'thread');
  assert.equal(kinds['front-wheel'], 'slide');
  assert.equal(kinds.handlebar, 'slide');
  assert.equal(kinds.seatpost, 'slide');
  assert.equal(kinds.fork, 'slide');
});

test('groupOf 传 id 或组名都认，且发的是副本', () => {
  const bom = new Bom(real);
  const byId = bom.groupOf('stem-face-a').map((f) => f.id);
  const byGroup = bom.groupOf('stem-face').map((f) => f.id);
  assert.deepEqual(byId, byGroup);
  assert.equal(byId.length, 4);
  bom.groupOf('stem-face').length = 0;
  assert.equal(bom.groupOf('stem-face').length, 4);
});
