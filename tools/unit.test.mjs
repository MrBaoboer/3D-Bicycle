/**
 * check-manifest.mjs 纯函数的单测，用 node:test，不引任何依赖。
 * npm run verify 验清单对不对得上模型；这里验底下纯函数的行为边界：
 * 拓扑排序的空图 / 自环 / 双向环、单位向量的容差边界、规格串拒猜、GLB 畸形输入。
 *
 *   npm test        # 或 node --test tools/unit.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  readGlbJson, collectNodeNames,
  vecLength, isUnitVector,
  groupBy, topoSort, missingRefs, formatCycle,
  parseSpec, isLeftPedalId, isRightPedalId,
  threadProblems, crossGroupProblems,
  runChecks, formatReport,
  INSTALL_KINDS, ORDERS, CROSS_MIN, DEFAULT_MODEL,
} from './check-manifest.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// ── 向量 ────────────────────────────────────────────────
test('vecLength 只认「3 个有限数」，其余一律 NaN', () => {
  assert.equal(vecLength([3, 4, 0]), 5);
  assert.equal(vecLength([0, 0, 0]), 0);
  assert.ok(Number.isNaN(vecLength([1, 0])));            // 少一维
  assert.ok(Number.isNaN(vecLength([1, 0, 0, 0])));      // 多一维
  assert.ok(Number.isNaN(vecLength([1, 0, '0'])));       // 字符串混进来
  assert.ok(Number.isNaN(vecLength([1, 0, NaN])));
  assert.ok(Number.isNaN(vecLength([1, 0, Infinity])));
  assert.ok(Number.isNaN(vecLength(null)));
  assert.ok(Number.isNaN(vecLength('0,0,1')));
});

test('isUnitVector 在 1±1e-4 这种「差一点」的地方仍算单位向量，1e-2 则不算', () => {
  assert.equal(isUnitVector([1, 0, 0]), true);
  assert.equal(isUnitVector([0.6, 0.8, 0]), true);       // 恰好 1
  assert.equal(isUnitVector([1.0001, 0, 0]), true);      // 长度 1+1e-4，在 1e-3 容差内
  assert.equal(isUnitVector([0.9999, 0, 0]), true);      // 长度 1−1e-4
  assert.equal(isUnitVector([1.01, 0, 0]), false);       // 长度 1+1e-2，超容差
  assert.equal(isUnitVector([0, 0, 1.2]), false);        // 手滑填成 1.2 —— 动画会 1.2 倍速飞过去
  assert.equal(isUnitVector([0, 0, 0]), false);
  assert.equal(isUnitVector([1, 0]), false);
  assert.equal(isUnitVector(undefined), false);
  // 容差可调：把关卡收紧到 1e-5 后，1+1e-4 就不再算数
  assert.equal(isUnitVector([1.0001, 0, 0], 1e-5), false);
  assert.equal(isUnitVector([1.0001, 0, 0], 1e-3), true);
});

// ── 拓扑排序 ────────────────────────────────────────────
test('空图：排出空序、报不出环（边界，别在这儿抛）', () => {
  assert.deepEqual(topoSort({}), { order: [], cycles: [] });
  assert.deepEqual(topoSort(new Map()), { order: [], cycles: [] });
  assert.deepEqual(topoSort(undefined), { order: [], cycles: [] });
  // 有点无边也一样，顺序按 id 稳定
  assert.deepEqual(topoSort({ b: [], a: [] }).order, ['a', 'b']);
});

test('链式依赖排成前置在前的一条序', () => {
  const { order, cycles } = topoSort({ 'front-wheel': ['fork'], fork: ['frame'], frame: [] });
  assert.deepEqual(order, ['frame', 'fork', 'front-wheel']);
  assert.deepEqual(cycles, []);
  // 同一层的两件按 id 稳定排序，两次跑结果一致
  const twice = topoSort({ a: [], c: ['a'], b: ['a'] });
  assert.deepEqual(twice.order, ['a', 'b', 'c']);
});

test('自环：a 需要 a —— 报成一条长度 2 的环，且一件都排不出来（边界）', () => {
  const { order, cycles } = topoSort({ a: ['a'] });
  assert.deepEqual(order, []);
  assert.equal(cycles.length, 1);
  assert.deepEqual(cycles[0], ['a', 'a']);
  assert.equal(formatCycle(cycles[0]), 'a 需要 a');
});

test('双向环：a↔b —— 报出一条回到起点的路径（边界）', () => {
  const { order, cycles } = topoSort({ a: ['b'], b: ['a'] });
  assert.deepEqual(order, []);
  assert.equal(cycles.length, 1);
  assert.equal(cycles[0][0], cycles[0].at(-1), '环路径应首尾同一个 id');
  assert.deepEqual(cycles[0], ['a', 'b', 'a']);
  assert.equal(formatCycle(cycles[0]), 'a 需要 b 需要 a');
});

test('三件成环时，环外那件照样排得出来，环单独报', () => {
  const { order, cycles } = topoSort({ a: ['b'], b: ['c'], c: ['a'], solo: [] });
  assert.deepEqual(order, ['solo']);
  assert.equal(cycles.length, 1);
  assert.equal(cycles[0].length, 4);                     // a → b → c → a
  assert.equal(cycles[0][0], cycles[0].at(-1));
  assert.deepEqual([...new Set(cycles[0])].sort(), ['a', 'b', 'c']);
});

test('两个互不相干的环各报一条，不会合成一条', () => {
  const { cycles } = topoSort({ a: ['b'], b: ['a'], x: ['y'], y: ['x'] });
  assert.equal(cycles.length, 2);
  assert.deepEqual(cycles.map((c) => c[0]), ['a', 'x']);
});

test('指向未知 id 的边被拓扑排序忽略，交给 missingRefs 单独报', () => {
  const deps = { a: ['ghost'], b: ['a'] };
  assert.deepEqual(topoSort(deps).order, ['a', 'b']);    // 不因悬空引用卡住
  assert.deepEqual(topoSort(deps).cycles, []);
  assert.deepEqual(missingRefs(deps), [{ from: 'a', to: 'ghost' }]);
  assert.deepEqual(missingRefs({ a: [], b: ['a'] }), []);
});

// ── 分组 ────────────────────────────────────────────────
test('groupBy 保持首次出现的组序', () => {
  const g = groupBy([{ k: 'b' }, { k: 'a' }, { k: 'b' }], (x) => x.k);
  assert.deepEqual([...g.keys()], ['b', 'a']);
  assert.equal(g.get('b').length, 2);
  assert.equal(groupBy(undefined, (x) => x).size, 0);
});

// ── 规格串 ──────────────────────────────────────────────
test('parseSpec 认得 M14x1.25 / M6×1 / M4，认不出就返回 null（不许瞎猜）', () => {
  assert.deepEqual(parseSpec('M14x1.25'), { nominal: 14, pitch: 1.25 });
  assert.deepEqual(parseSpec('M6×1'), { nominal: 6, pitch: 1 });        // 全角乘号
  assert.deepEqual(parseSpec('  m5 X 0.8 '), { nominal: 5, pitch: 0.8 }); // 大小写与空白
  assert.deepEqual(parseSpec('M4'), { nominal: 4, pitch: null });        // 只给公称直径
  assert.equal(parseSpec('M6x1.0x2'), null);
  assert.equal(parseSpec('1/2-20 UNF'), null);                           // 英制不认
  assert.equal(parseSpec('M'), null);
  assert.equal(parseSpec(''), null);
  assert.equal(parseSpec(null), null);
  assert.equal(parseSpec(6), null);
});

// ── 左右脚踏 ────────────────────────────────────────────
test('左脚踏识别：认 id 里成词的 left/li/l，不误伤 right 与别的零件', () => {
  for (const id of ['pedal-left', 'pedal_l', 'left-pedal', 'pedal-li', 'PEDAL-LEFT']) {
    assert.equal(isLeftPedalId(id), true, id);
  }
  for (const id of ['pedal-right', 'pedal-re', 'qr-front', 'stem-1', 'left-crank', '', null]) {
    assert.equal(isLeftPedalId(id), false, String(id));
  }
  assert.equal(isRightPedalId('pedal-right'), true);
  assert.equal(isRightPedalId('pedal_r'), true);
  assert.equal(isRightPedalId('pedal-left'), false);
});

// ── 旋合长度与交叉分组 ──────────────────────────────────
test('threadProblems：旋合长度 turns × pitch 要在常识范围内', () => {
  assert.deepEqual(threadProblems([{ id: 'a', turns: 6, pitch: 1.5 }]), []);   // 9 mm
  assert.deepEqual(threadProblems([]), []);
  assert.equal(threadProblems([{ id: 'a', turns: 1, pitch: 0.5 }]).length, 1); // 0.5 mm 夹不住
  assert.equal(threadProblems([{ id: 'a', turns: 40, pitch: 1 }]).length, 1);  // 40 mm 没这么长的孔
  assert.equal(threadProblems([{ id: 'a' }]).length, 1);
  assert.match(threadProblems([{ id: 'stem-1', turns: 2, pitch: 0.5 }])[0], /stem-1.*1.00/);
});
test('crossGroupProblems：cross 组必须偶数且不少于 4 颗，同组 order 还得一致', () => {
  const mk = (n, group, order) => Array.from({ length: n }, (_, i) => ({ id: `${group}-${i}`, group, order }));
  assert.equal(CROSS_MIN, 4);
  assert.deepEqual(crossGroupProblems(mk(4, 'stem-face', 'cross')), []);
  assert.deepEqual(crossGroupProblems(mk(6, 'stem-face', 'cross')), []);
  assert.equal(crossGroupProblems(mk(3, 'stem-face', 'cross')).length, 1);   // 奇数且不足
  assert.equal(crossGroupProblems(mk(2, 'stem-face', 'cross')).length, 1);   // 偶数但不足 4
  assert.equal(crossGroupProblems(mk(5, 'stem-face', 'cross')).length, 1);   // 够 4 但是奇数
  assert.match(crossGroupProblems(mk(5, 'stem-face', 'cross'))[0], /偶数/);
  // 非 cross 的组不受颗数约束
  assert.deepEqual(crossGroupProblems(mk(3, 'qr', 'seq')), []);
  assert.deepEqual(crossGroupProblems(mk(1, 'qr', 'any')), []);
  // 同组混着写 —— 装配时到底交叉不交叉说不清
  const mixed = [...mk(2, 'g', 'cross'), ...mk(2, 'g', 'any')];
  assert.ok(crossGroupProblems(mixed).some((s) => /order 一致/.test(s)));
  assert.deepEqual(crossGroupProblems([]), []);
});

// ── GLB 容器 ────────────────────────────────────────────
/** 拼一个只有 JSON 块的最小 GLB；extraChunk 为真时先塞一个 BIN 块 */
function makeGlb(json, extraChunk = false) {
  const body = new TextEncoder().encode(JSON.stringify(json));
  const pad = (4 - (body.length % 4)) % 4;
  const jsonLen = body.length + pad;
  const binLen = extraChunk ? 4 : 0;
  const total = 12 + (extraChunk ? 8 + binLen : 0) + 8 + jsonLen;
  const buf = new Uint8Array(total);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, 0x46546c67, true);                     // 'glTF'
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  let off = 12;
  if (extraChunk) {
    dv.setUint32(off, binLen, true);
    dv.setUint32(off + 4, 0x004e4942, true);             // 'BIN\0'
    off += 8 + binLen;
  }
  dv.setUint32(off, jsonLen, true);
  dv.setUint32(off + 4, 0x4e4f534a, true);               // 'JSON'
  buf.set(body, off + 8);
  buf.fill(0x20, off + 8 + body.length, off + 8 + jsonLen);  // 按规范用空格补齐
  return buf;
}

test('readGlbJson 解得出 JSON 块：4 字节对齐补空格、JSON 块排在 BIN 之后都认', () => {
  const g = { asset: { version: '2.0' }, nodes: [{ name: 'RadVorn' }] };
  assert.deepEqual(readGlbJson(makeGlb(g)), g);
  assert.deepEqual(readGlbJson(makeGlb(g, true)), g);    // JSON 块不在第一个
  // 带 byteOffset 的视图（readFileSync 返回的 Buffer 常常就是这样）
  const raw = makeGlb(g);
  const shifted = new Uint8Array(raw.length + 3);
  shifted.set(raw, 3);
  assert.deepEqual(readGlbJson(shifted.subarray(3)), g);
});

test('readGlbJson 对畸形输入当场抛，且说清哪儿不对', () => {
  assert.throws(() => readGlbJson(new Uint8Array(4)), /太短/);
  const bad = makeGlb({ nodes: [] });
  new DataView(bad.buffer).setUint32(0, 0x12345678, true);
  assert.throws(() => readGlbJson(bad), /不是 GLB/);
  const v1 = makeGlb({ nodes: [] });
  new DataView(v1.buffer).setUint32(4, 1, true);
  assert.throws(() => readGlbJson(v1), /版本 1.*期望 2/);
  const noJson = new Uint8Array(12);                     // 只有头，没有块
  const dv = new DataView(noJson.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, 12, true);
  assert.throws(() => readGlbJson(noJson), /没有 JSON 块/);
});

test('collectNodeNames 计次而不是去重 —— 这份模型里 Rahmen 之类是重名的', () => {
  const counts = collectNodeNames({
    nodes: [{ name: 'Rahmen' }, { name: 'Rahmen' }, { name: 'Lenker' }, { mesh: 0 }, { name: '' }],
  });
  assert.equal(counts.get('Rahmen'), 2);
  assert.equal(counts.get('Lenker'), 1);
  assert.equal(counts.size, 2, '无名节点与空名不该进表');
  assert.equal(collectNodeNames({}).size, 0);
  assert.equal(collectNodeNames(null).size, 0);
});

test('真实模型 CarbonFrameBike.glb 解得开，且认得出关键节点名', (t) => {
  if (!existsSync(DEFAULT_MODEL)) return t.skip('模型不在，跳过');
  const names = collectNodeNames(readGlbJson(readFileSync(DEFAULT_MODEL)));
  assert.ok(names.size > 100, `有名节点 ${names.size} 个，明显偏少`);
  for (const n of ['RadVorn', 'RadHinten', 'Lenker', 'Pedal_Funn_Bigfoot_le', 'Pedal_Funn_Bigfoot_re']) {
    assert.ok(names.has(n), `模型里应有节点 ${n}`);
  }
});

// ── 端到端：一份最小清单跑满全部断言 ───────────────────
const NODES = new Map([
  ['Federgabel', 1], ['RadVorn', 1], ['Vorbau_Hope_FR_35mm', 1],
  ['Pedal_Funn_Bigfoot_le', 1], ['Pedal_Funn_Bigfoot_re', 1],
]);

const bolt = (id, group, order) => ({
  id, name: `把立面盖螺栓 ${id.at(-1)}`, tool: 'hex-4', thread: 'right',
  pitch: 0.7, turns: 6,
  axis: [1, 0, 0], point: [0.5, 1, 0], group, order,
});

const fixture = () => ({
  schema: 1,
  model: 'public/models/CarbonFrameBike.glb',
  parts: [
    {
      id: 'fork', name: '前叉', nodes: ['Federgabel'],
      install: { kind: 'slide', dir: [0, 1, 0], gap: 0.2, snap: 0.005 },
      fasten: [], needs: [],
    },
    {
      id: 'front-wheel', name: '前轮', nodes: ['RadVorn'],
      install: { kind: 'drop', dir: [0, -1, 0], gap: 0.18, snap: 0.004 },
      fasten: ['qr-front'], needs: ['fork'],
    },
    {
      id: 'stem', name: '把立', nodes: ['Vorbau_Hope_FR_35mm'],
      install: { kind: 'drop', dir: [0, -1, 0], gap: 0.1, snap: 0.003 },
      fasten: ['stem-1', 'stem-2', 'stem-3', 'stem-4'], needs: ['fork'],
    },
    {
      id: 'pedal-l-part', name: '左脚踏', nodes: ['Pedal_Funn_Bigfoot_le'],
      install: { kind: 'thread', dir: [-1, 0, 0], gap: 0.06, snap: 0.002 },
      pivot: { point: [-0.17, 0.28, 0.07], axis: [1, 0, 0] },
      fasten: ['pedal-left'], needs: [],
    },
    {
      id: 'pedal-r-part', name: '右脚踏', nodes: ['Pedal_Funn_Bigfoot_re'],
      install: { kind: 'thread', dir: [1, 0, 0], gap: 0.06, snap: 0.002 },
      pivot: { point: [-0.17, 0.28, -0.07], axis: [1, 0, 0] },
      fasten: ['pedal-right'], needs: [],
    },
  ],
  fasteners: [
    {
      id: 'qr-front', name: '前轮快拆', tool: 'hand', thread: 'right',
      pitch: 1, turns: 6,
      axis: [0, 0, 1], point: [0.4, 0.35, 0], group: 'qr', order: 'any',
    },
    bolt('stem-1', 'stem-face', 'cross'), bolt('stem-2', 'stem-face', 'cross'),
    bolt('stem-3', 'stem-face', 'cross'), bolt('stem-4', 'stem-face', 'cross'),
    {
      id: 'pedal-left', name: '左脚踏轴', tool: 'hex-8', thread: 'left',
      spec: 'M14x1.25', pitch: 1.25, turns: 8,
      axis: [1, 0, 0], point: [-0.17, 0.28, 0.07], group: 'pedal', order: 'any',
    },
    {
      id: 'pedal-right', name: '右脚踏轴', tool: 'hex-8', thread: 'right',
      spec: 'M14x1.25', pitch: 1.25, turns: 8,
      axis: [1, 0, 0], point: [-0.17, 0.28, -0.07], group: 'pedal', order: 'any',
    },
  ],
});

const failed = (res) => res.filter((r) => !r.ok).map((r) => `${r.code} ${r.detail}`);

test('一份写对的清单：全部断言通过，formatReport 逐条列 ✓', () => {
  const res = runChecks(fixture(), NODES);
  assert.deepEqual(failed(res), []);
  const { pass, total, text } = formatReport(res);
  assert.equal(pass, total);
  assert.ok(total >= 10, `断言只有 ${total} 条，比预期少`);
  assert.ok(text.startsWith('✓ [M-01]'));
  assert.equal(text.includes('✗'), false);
});

test('每种错法各自触发对应的那一条断言，不会张冠李戴', () => {
  const only = (mutate) => {
    const m = fixture();
    mutate(m);
    return runChecks(m, NODES).filter((r) => !r.ok).map((r) => r.code);
  };
  assert.deepEqual(only((m) => { m.parts[0].nodes = ['Rahmen_不存在']; }), ['M-02']);
  assert.deepEqual(only((m) => { m.parts[1].install.dir = [0, 0, 1.2]; }), ['M-03']);
  assert.deepEqual(only((m) => { m.parts[3].pivot.axis = [1, 1, 0]; }), ['M-04']);
  assert.deepEqual(only((m) => { m.parts[1].needs = ['ghost']; }), ['M-05']);
  assert.deepEqual(only((m) => { m.parts[0].needs = ['front-wheel']; }), ['M-06']);
  assert.deepEqual(only((m) => { m.fasteners[0].turns = 40; }), ['M-07']);
  assert.deepEqual(only((m) => { m.fasteners[5].thread = 'right'; }), ['M-08']);
  // 面盖螺栓少一颗 —— 4 颗交叉变 3 颗，对角就配不成对了
  assert.deepEqual(only((m) => { m.fasteners.splice(4, 1); m.parts[2].fasten.pop(); }), ['M-09']);
  assert.deepEqual(only((m) => { m.parts[0].install.snap = 0.5; }), ['M-10']);
  assert.deepEqual(only((m) => { m.fasteners[5].pitch = 1; }), ['M-11']);
  assert.deepEqual(only((m) => { m.parts[0].install.kind = 'weld'; }), ['M-01']);
});

test('报错说得出「哪一条、期望什么、实得什么」', () => {
  const m = fixture();
  m.parts[1].install.dir = [0, 0, 1.2];
  m.parts[0].needs = ['front-wheel'];
  m.fasteners[3].order = 'any';
  const res = runChecks(m, NODES);
  const of = (code) => res.find((r) => r.code === code);
  assert.equal(of('M-03').ok, false);
  assert.match(of('M-03').detail, /front-wheel.*期望长度 1±1e-3.*实得 1\.2/);
  assert.equal(of('M-06').ok, false);
  assert.match(of('M-06').detail, /fork 需要 front-wheel 需要 fork/);
  assert.equal(of('M-09').ok, false);
  assert.match(of('M-09').detail, /stem-face/);
  // 剩下的照样通过 —— 一处错不会把整张表带塌
  assert.deepEqual(res.filter((r) => !r.ok).map((r) => r.code), ['M-03', 'M-06', 'M-09']);
});

test('清单为空 / 为 null 时不抛异常，只是报不通过', () => {
  for (const bad of [null, undefined, {}, { schema: 1, parts: [], fasteners: [] }]) {
    const res = runChecks(bad, NODES);
    assert.ok(res.length >= 10);
    assert.ok(res.every((r) => typeof r.ok === 'boolean'));
  }
  // 空清单里没有左脚踏，M-08 必须揪出来（教学要害不许缺）
  const res = runChecks({ schema: 1, parts: [], fasteners: [] }, NODES);
  assert.equal(res.find((r) => r.code === 'M-08').ok, false);
  assert.match(res.find((r) => r.code === 'M-08').detail, /左脚踏/);
});

// ── 格式常量 ────────────────────────────────────────────
test('枚举常量与文件头注释里写的格式一致', () => {
  assert.deepEqual(INSTALL_KINDS, ['slide', 'drop', 'press', 'thread', 'hinge', 'clip']);
  assert.deepEqual(ORDERS, ['cross', 'seq', 'any']);
  assert.equal(resolve(HERE, '..', 'public/models/CarbonFrameBike.glb'), DEFAULT_MODEL);
});
