/**
 * 装配清单 —— assets/bike.manifest.json 的运行时读法。
 *
 * 那份 JSON 是全片唯一的事实来源：装哪一件、沿哪个方向推进去、拧几颗、每颗转几圈。
 * 上层一律从这里取，不各自 import 一遍 —— 否则「裸数组转向量」「id 写错怎么办」
 * 这类活会散落到每个调用点，各写各的。
 *
 * 只做三件事：
 *
 * **取不到就抛。** id 是写死在步骤里的常量，写错是 bug 不是运行时状态；
 * 返回 undefined 只会让错误漂到十几帧之后的某个 NaN 上，那时已经看不出是谁的错。
 *
 * **裸数组转成 Vector3，同名挂在同一层的 `.v` 里**（`install.v.dir`、`pivot.v.point`、
 * 紧固件 `f.v.axis`）。清单对象是 Vite 的 JSON 模块，全站共用一份，就地改它等于改所有人，
 * 所以原始数组原样留着，向量另存一份。向量本身冻起来：同一个实例要发给四个原语，
 * 谁顺手 negate 一下，别处的方向就跟着反了 —— 要改先 clone()。
 * 长度也不替它归一化：dir 填成 [0, 0, 1.2] 是清单的错，`npm run verify` 会当场报出来，
 * 这里悄悄改好反而把错藏住。
 *
 * **按 needs 排出一条合法装配序。**
 *
 * 节点名保持**原始 GLB 名**（含空格，如 "Lenker 1"）。净化是 render/bike.js 的事，
 * 清单存原始名，tools/check-manifest.mjs 才能拿 GLB 离线逐条对账。
 *
 * 分层上这里破了「core 不碰 three」一条：只借 Vector3 这一个纯数学类型，不碰场景。
 *
 * **不在这里 import 那份 JSON。** 裸导入 .json 是 Vite 的写法，Node 解析不了，
 * 于是整个模块在 node:test 里 import 不进来 —— 对角配对、拓扑排序这些最容易写错、
 * 也最难在浏览器里断言的纯逻辑就一条都测不了。清单由 main.js 读进来交给构造函数。
 */

import { Vector3 } from 'three';

/** 裸数组 → 冻结的 Vector3 */
const vec = (a) => Object.freeze(new Vector3(a[0], a[1], a[2]));

/**
 * 对角配对的容差，单位是「组半径的几分之几」。
 * 中心对称布置下对称点与实际点重合（面盖那四颗实测偏差为 0）；
 * 偏出四分之一半径，说明这组根本不是对角布置，配出来的对不能信。
 */
const CROSS_TOL = 0.25;

/**
 * 浅拷一层再冻上，向量另挂到 `.v` —— 原始 JSON 对象一个字节都不动。
 * nodes / fasten / needs 这几个数组仍与清单共用（冻它们就等于改原对象了），
 * 所以对外一律发副本，见 nodesOf()。
 */
function prepPart(raw) {
  const out = {
    ...raw,
    install: Object.freeze({ ...raw.install, v: Object.freeze({ dir: vec(raw.install.dir) }) }),
  };
  if (raw.pivot) {
    out.pivot = Object.freeze({
      ...raw.pivot,
      v: Object.freeze({ point: vec(raw.pivot.point), axis: vec(raw.pivot.axis) }),
    });
  }
  return Object.freeze(out);
}

function prepFastener(raw) {
  return Object.freeze({
    ...raw,
    v: Object.freeze({ axis: vec(raw.axis), point: vec(raw.point) }),
  });
}

export class Bom {
  #partById = new Map();
  #fastenerById = new Map();
  /** @type {Map<string, object[]>} 组名 → 该组紧固件（清单书写顺序） */
  #groups = new Map();
  #order = null;

  constructor(src) {
    // 格式版本对不上就别往下走：字段含义变了，下面每一处取值都是猜的
    if (src?.schema !== 1) {
      throw new Error(`[bom] 清单 schema 期望 1，实得 ${JSON.stringify(src?.schema)}`);
    }

    /** @type {ReadonlyArray<object>} BOM 件，清单书写顺序 */
    this.parts = Object.freeze((src.parts ?? []).map(prepPart));
    /** @type {ReadonlyArray<object>} 紧固件，清单书写顺序 */
    this.fasteners = Object.freeze((src.fasteners ?? []).map(prepFastener));

    for (const p of this.parts) this.#partById.set(p.id, p);
    for (const f of this.fasteners) {
      this.#fastenerById.set(f.id, f);
      if (!this.#groups.has(f.group)) this.#groups.set(f.group, []);
      this.#groups.get(f.group).push(f);
    }

    Object.freeze(this);
  }

  /** 这份清单里一共几件、几颗。封面与文档要报数，别各数各的 */
  get counts() { return { parts: this.parts.length, fasteners: this.fasteners.length }; }

  /** 按 id 取件 */
  part(id) {
    const p = this.#partById.get(id);
    if (!p) throw new Error(`[bom] 清单里没有 id 为 "${id}" 的件（有 ${[...this.#partById.keys()].join('、')}）`);
    return p;
  }

  /** 按 id 取紧固件 */
  fastener(id) {
    const f = this.#fastenerById.get(id);
    if (!f) throw new Error(`[bom] 清单里没有 id 为 "${id}" 的紧固件（有 ${[...this.#fastenerById.keys()].join('、')}）`);
    return f;
  }

  /** 该件对应的 glTF 节点名（原始名，含空格），交给 bike.get() 去净化 */
  nodesOf(partId) {
    return [...this.part(partId).nodes];
  }

  /**
   * 同组紧固件，清单书写顺序，含传进来的这一颗。副本，随便排。
   * 传紧固件 id 或组名都认 —— 撞名时按 id 解（清单里 axle-front 恰好两者同名，
   * 两条路给出同一组）。
   */
  groupOf(idOrGroup) {
    const f = this.#fastenerById.get(idOrGroup);
    return [...this.#group(f ? f.group : idOrGroup)];
  }

  /**
   * 一条合法装配序，返回件 id。
   *
   * needs 只管硬约束：A 排在 B 前面，仅当 B 需要 A。同时就绪的按**清单书写顺序**取 ——
   * 那是作者定的讲述顺序（先前轮、再车把……），拓扑排序没理由把它打乱。
   */
  order() {
    if (!this.#order) this.#order = this.#topo();
    return [...this.#order];
  }

  /**
   * 一组交叉拧紧的紧固件按对角两两配对，返回 **id 对** `[[a, b], [c, d]]`。
   *
   * 判据就是「对角」二字的字面意思：每对连线穿过组的几何中心，
   * 即一颗关于中心的对称点落在配对的那一颗上。四颗面盖螺丝按此配出
   * 上左↔下右、上右↔下左，正是拧面盖时手要交替去的两条对角线。
   *
   * **返回的是 id 不是紧固件对象。** 早先返回对象，而唯一的调用方
   * （`interact/screw.js` 的 `_mate`）拿它跟一个 id 字符串比 —— 恒不相等，
   * 于是「对角配对」在运行时等于不存在：每一颗第二手都被判成没按对角，
   * 结尾自检永远多出一行「面盖有一颗没按对角顺序上」，而用户什么也没做错。
   * 对外只发 id，这一类错就没有地方再犯。
   */
  crossPairs(group) {
    const list = this.#group(group);
    const odd = list.filter((f) => f.order !== 'cross');
    if (odd.length) {
      throw new Error(`[bom] 分组 ${group} 里 ${odd.map((f) => f.id).join('、')} 的 order 不是 cross，没有对角可言`);
    }
    if (list.length < 4 || list.length % 2 !== 0) {
      throw new Error(`[bom] 分组 ${group} 有 ${list.length} 颗，对角配对要求偶数颗且不少于 4 颗`);
    }

    const center = new Vector3();
    for (const f of list) center.add(f.v.point);
    center.divideScalar(list.length);
    const radius = Math.max(...list.map((f) => f.v.point.distanceTo(center)));

    const rest = [...list];
    const mirror = new Vector3();
    const pairs = [];
    while (rest.length) {
      const f = rest.shift();
      mirror.copy(center).multiplyScalar(2).sub(f.v.point);   // f 关于中心的对称点
      let at = 0;
      let best = Infinity;
      rest.forEach((g, i) => {
        const d = g.v.point.distanceTo(mirror);
        if (d < best) { best = d; at = i; }
      });
      if (best > radius * CROSS_TOL) {
        throw new Error(`[bom] 分组 ${group}：${f.id} 找不到对角的那一颗（最近的也差 ${best.toFixed(4)}，组半径 ${radius.toFixed(4)}）`);
      }
      pairs.push(Object.freeze([f.id, rest.splice(at, 1)[0].id]));
    }
    return pairs;
  }

  /** 这一颗的对角是哪一颗；组里没有它就返回 null */
  crossMate(group, id) {
    for (const [a, b] of this.crossPairs(group)) {
      if (a === id) return b;
      if (b === id) return a;
    }
    return null;
  }

  #group(name) {
    const list = this.#groups.get(name);
    if (!list) throw new Error(`[bom] 没有名为 "${name}" 的紧固件分组（有 ${[...this.#groups.keys()].join('、')}）`);
    return list;
  }

  /**
   * Kahn 拓扑排序：每轮取第一件「前置全装完」的。
   * 一轮下来谁都不就绪，剩下的这些就是在互相等 —— 分步流程会永远卡在那儿，当场抛。
   */
  #topo() {
    const ids = this.parts.map((p) => p.id);
    const needs = new Map(this.parts.map((p) => [p.id, p.needs ?? []]));
    for (const [id, list] of needs) {
      for (const n of list) {
        if (!needs.has(n)) throw new Error(`[bom] ${id}.needs 指向 "${n}"，清单里没有这个件`);
      }
    }

    const done = new Set();
    const out = [];
    while (out.length < ids.length) {
      const next = ids.find((id) => !done.has(id) && needs.get(id).every((n) => done.has(n)));
      if (!next) {
        const stuck = ids.filter((id) => !done.has(id)).join('、');
        throw new Error(`[bom] needs 成环，排不出装配序：${stuck} 互相等着`);
      }
      done.add(next);
      out.push(next);
    }
    return out;
  }
}

