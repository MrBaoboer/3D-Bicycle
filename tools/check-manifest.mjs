/**
 * 清单 × 模型 对账：assets/bike.manifest.json ↔ public/models/CarbonFrameBike.glb。
 * 两边走散（节点改名、向量长度不是 1、needs 成环）不会在浏览器里报错，
 * 只表现为装配异常，所以在 Node 里逐条对账，对不上退 1。
 * 不依赖 three 与浏览器：GLB 只解容器的 JSON 块，够拿到全部节点名。
 *
 *   npm run verify        # 或 node tools/check-manifest.mjs [清单路径] [模型路径]
 */

/*
 * bike.manifest.json（schema 1）里校验代码读不出的语义：
 *   长度一律用模型单位（与 GLB 坐标同一套），pitch 用 mm，turns 是拧到位的圈数
 *  （动画按它转）。顶层 model 仅作记录，实际路径由命令行决定。
 *   install.kind：slide 推入 / drop 落入 / press 压入 / thread 旋入 / hinge 翻合 / clip 卡扣；
 *   install.dir 从预备位指向最终位；gap 是预备位沿 -dir 的退让距离；snap 是吸附阈值。
 *   pivot 是转轴（point 轴上一点、axis 轴向），kind 为 thread / hinge 时必填。
 *   紧固件：tool 代号 hex-N / torx-TN / wrench-N / hand；point 是螺栓头中心；
 *   group 同一组一起拧；order：cross 对角交叉 / seq 按数组先后 / any 无所谓。
 */

import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

// ── 枚举（格式的一部分，改这里等于改格式）────────────────────────────
export const INSTALL_KINDS = ['slide', 'drop', 'press', 'thread', 'hinge', 'clip'];
export const THREADS = ['left', 'right'];
export const ORDERS = ['cross', 'seq', 'any'];
/** order 为 cross 的组的下限：交叉拧法至少 4 颗，且必须成对 */
export const CROSS_MIN = 4;

// ══ 纯函数：不碰文件系统、不看 process，单测直接喂值 ══════════════════

/**
 * 解 GLB 容器，只取 JSON 块。
 * GLB：12 字节头（magic / version / length）+ 若干块（length / type / data，4 字节对齐）。
 */
export function readGlbJson(bytes) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (buf.byteLength < 12) throw new Error(`GLB 太短：${buf.byteLength} 字节，头部就要 12 字节`);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const magic = dv.getUint32(0, true);
  if (magic !== 0x46546c67) throw new Error(`不是 GLB：magic=0x${magic.toString(16)}，期望 0x46546c67`);
  const version = dv.getUint32(4, true);
  if (version !== 2) throw new Error(`GLB 版本 ${version}，期望 2`);
  const total = Math.min(dv.getUint32(8, true), buf.byteLength);

  let off = 12;
  while (off + 8 <= total) {
    const len = dv.getUint32(off, true);
    const type = dv.getUint32(off + 4, true);
    const end = off + 8 + len;
    if (end > total) throw new Error(`GLB 块越界：块尾 ${end} > 文件 ${total}`);
    if (type === 0x4e4f534a) {                       // 'JSON'
      return JSON.parse(new TextDecoder().decode(buf.subarray(off + 8, end)));
    }
    off = end + ((4 - (len % 4)) % 4);
  }
  throw new Error('GLB 里没有 JSON 块');
}

/**
 * 全部节点名 → 出现次数。
 * 计次而不是只收进 Set：这份模型里 "Rahmen"、"Lenker" 之类重名不止一处，
 * 清单指过去时是有歧义的，报告里要说得出来。
 */
export function collectNodeNames(gltf) {
  const counts = new Map();
  for (const n of gltf?.nodes || []) {
    if (typeof n?.name !== 'string' || !n.name) continue;
    counts.set(n.name, (counts.get(n.name) || 0) + 1);
  }
  return counts;
}

/** 向量长度；不是 3 个有限数就返回 NaN（交给调用方判） */
export function vecLength(v) {
  if (!Array.isArray(v) || v.length !== 3) return NaN;
  if (!v.every((x) => typeof x === 'number' && Number.isFinite(x))) return NaN;
  return Math.hypot(v[0], v[1], v[2]);
}

/** 是不是单位向量（默认容差 1e-3） */
export function isUnitVector(v, tol = 1e-3) {
  const len = vecLength(v);
  return Number.isFinite(len) && Math.abs(len - 1) <= tol;
}

/** 按 key 分组，保持首次出现的顺序 */
export function groupBy(list, keyFn) {
  const out = new Map();
  for (const item of list || []) {
    const k = keyFn(item);
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(item);
  }
  return out;
}

/** 把 { id: [deps] } 或 Map 归一成 Map<string, string[]>，只保留指向已知节点的边 */
function normalizeGraph(deps) {
  const raw = deps instanceof Map ? deps : new Map(Object.entries(deps || {}));
  const known = new Set(raw.keys());
  const g = new Map();
  for (const [id, list] of raw) {
    g.set(id, (Array.isArray(list) ? list : []).filter((d) => known.has(d)));
  }
  return g;
}

/** 悬空引用：deps 里指向未知 id 的边，返回 [{ from, to }] */
export function missingRefs(deps) {
  const raw = deps instanceof Map ? deps : new Map(Object.entries(deps || {}));
  const known = new Set(raw.keys());
  const out = [];
  for (const [id, list] of raw) {
    for (const d of Array.isArray(list) ? list : []) {
      if (!known.has(d)) out.push({ from: id, to: d });
    }
  }
  return out;
}

/**
 * 拓扑排序。输入 { id: [前置 id] }，输出 { order, cycles }：order 是前置在前的
 * 合法安装序（有环时只含排得出的部分），cycles 每环一条路径，形如 ['a','b','a']。
 * 指向未知 id 的边直接忽略（归 missingRefs 报）——缺引用与成环各报各的，不互相盖掉。
 */
export function topoSort(deps) {
  const g = normalizeGraph(deps);
  const ids = [...g.keys()].sort();

  // Kahn：入度 = 尚未满足的前置件数
  const indeg = new Map(ids.map((id) => [id, g.get(id).length]));
  const queue = ids.filter((id) => indeg.get(id) === 0);
  const order = [];
  while (queue.length) {
    queue.sort();                                  // 输出稳定，便于 diff
    const id = queue.shift();
    order.push(id);
    for (const other of ids) {
      if (!g.get(other).includes(id)) continue;
      const left = indeg.get(other) - 1;
      indeg.set(other, left);
      if (left === 0) queue.push(other);
    }
  }

  return { order, cycles: order.length === ids.length ? [] : findCycles(g, ids) };
}

/** Tarjan 求强连通分量，再在每个分量里找一条真实回路，报出来才看得懂 */
function findCycles(g, ids) {
  const index = new Map(); const low = new Map();
  const onStack = new Set(); const stack = [];
  const sccs = []; let counter = 0;

  const strongconnect = (v) => {
    index.set(v, counter); low.set(v, counter); counter += 1;
    stack.push(v); onStack.add(v);
    for (const w of g.get(v)) {
      if (!index.has(w)) { strongconnect(w); low.set(v, Math.min(low.get(v), low.get(w))); }
      else if (onStack.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
    }
    if (low.get(v) === index.get(v)) {
      const comp = [];
      let w;
      do { w = stack.pop(); onStack.delete(w); comp.push(w); } while (w !== v);
      sccs.push(comp);
    }
  };
  for (const id of ids) if (!index.has(id)) strongconnect(id);

  const cycles = [];
  for (const comp of sccs) {
    const selfLoop = comp.length === 1 && g.get(comp[0]).includes(comp[0]);
    if (comp.length < 2 && !selfLoop) continue;
    cycles.push(cyclePath(g, comp.slice().sort()));
  }
  return cycles.sort((a, b) => a.join().localeCompare(b.join()));
}

/** 在一个强连通分量里 DFS 找一条从 start 回到 start 的路径 */
function cyclePath(g, comp) {
  const inComp = new Set(comp);
  const start = comp[0];
  const path = [start];
  const seen = new Set([start]);
  const walk = (v) => {
    for (const w of g.get(v)) {
      if (!inComp.has(w)) continue;
      if (w === start) return true;
      if (seen.has(w)) continue;
      seen.add(w); path.push(w);
      if (walk(w)) return true;
      path.pop();
    }
    return false;
  };
  walk(start);
  return [...path, start];
}

/** 环路径 → 'a 需要 b 需要 a' */
export function formatCycle(cycle) {
  return (cycle || []).join(' 需要 ');
}

/**
 * 解规格串：M14x1.25 / M6×1 / m5 X 0.8 / M4（无螺距）。
 * 认不出返回 null —— 认不出就是清单写错了，别猜。
 */
export function parseSpec(text) {
  if (typeof text !== 'string') return null;
  const m = /^m(\d+(?:\.\d+)?)(?:\s*[x×*]\s*(\d+(?:\.\d+)?))?$/i.exec(text.trim());
  if (!m) return null;
  return { nominal: Number(m[1]), pitch: m[2] === undefined ? null : Number(m[2]) };
}

/** id 同时含 pedal 与 left/li/l 的，按左脚踏校验 */
export function isLeftPedalId(id) {
  if (typeof id !== 'string') return false;
  return /pedal/i.test(id) && /(^|[-_ ])(left|li|l)([-_ ]|$)/i.test(id);
}

/** id 同时含 pedal 与 right/re/r 的，按右脚踏校验 */
export function isRightPedalId(id) {
  if (typeof id !== 'string') return false;
  return /pedal/i.test(id) && /(^|[-_ ])(right|re|r)([-_ ]|$)/i.test(id);
}

/** 旋合长度的上下限（mm）—— 见 threadProblems */
export const ENGAGE_MM = [3, 30];

/**
 * 旋合长度 turns × pitch 要在常识范围内。turns 与 pitch 各自为正由 M-01 管，
 * 这一条管两者的乘积：少于 3 mm 夹不住东西，多于 30 mm 没有那么长的螺纹孔，
 * 两头都是数填错了的信号，画面上只表现为螺栓转一下就停或转个不停。
 */
export function threadProblems(fasteners) {
  const out = [];
  for (const f of fasteners || []) {
    const mm = (f?.turns ?? 0) * (f?.pitch ?? 0);
    if (!Number.isFinite(mm) || mm < ENGAGE_MM[0] || mm > ENGAGE_MM[1]) {
      out.push(`${f?.id}：旋合长度 turns × pitch 期望 ${ENGAGE_MM[0]}–${ENGAGE_MM[1]} mm，`
        + `实得 ${Number.isFinite(mm) ? mm.toFixed(2) : JSON.stringify(mm)}`);
    }
  }
  return out;
}

/** 交叉拧紧的组：偶数颗、不少于 CROSS_MIN，且同组 order 一致 */
export function crossGroupProblems(fasteners) {
  const out = [];
  const groups = groupBy(fasteners || [], (f) => f?.group);
  for (const [group, list] of groups) {
    const kinds = new Set(list.map((f) => f?.order));
    if (kinds.size > 1) {
      out.push(`分组 ${group}：期望同组 order 一致，实得 ${[...kinds].join(' / ')}`);
    }
    const cross = list.filter((f) => f?.order === 'cross');
    if (!cross.length) continue;
    if (cross.length < CROSS_MIN) {
      out.push(`分组 ${group}：order 为 cross，期望不少于 ${CROSS_MIN} 颗，实得 ${cross.length} 颗`);
    } else if (cross.length % 2 !== 0) {
      out.push(`分组 ${group}：order 为 cross，期望偶数颗（对角成对），实得 ${cross.length} 颗`);
    }
  }
  return out;
}

// ══ 逐条断言 ═══════════════════════════════════════════════════════════

const listOf = (v) => (Array.isArray(v) ? v : []);
const isStr = (v) => typeof v === 'string' && v.length > 0;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const short = (v) => JSON.stringify(v) ?? String(v);

/** 攒够一批问题再抛，一次看全，不用改一处跑一遍 */
function raise(problems) {
  if (problems.length) throw new Error(problems.join('\n      '));
}

/**
 * 跑全部断言。manifest 是解析好的对象，nodeNames 是 Map<节点名, 出现次数>。
 * 不读文件，方便直接喂假数据。
 */
export function runChecks(manifest, nodeNames = new Map()) {
  const results = [];
  const check = (code, title, fn) => {
    let ok, detail = '';
    try {
      const r = fn();
      if (typeof r === 'string') { ok = true; detail = r; }
      else { ok = !!r; }
    } catch (e) {
      ok = false; detail = e.message;
    }
    results.push({ code, title, ok, detail });
    return ok;
  };

  const parts = listOf(manifest?.parts);
  const fasteners = listOf(manifest?.fasteners);

  check('M-01', '清单结构完整：字段齐全、类型正确、id 全局唯一、枚举取值合法', () => {
    const p = [];
    if (manifest?.schema !== 1) p.push(`顶层 schema：期望 1，实得 ${short(manifest?.schema)}`);
    if (!Array.isArray(manifest?.parts)) p.push(`顶层 parts：期望数组，实得 ${short(manifest?.parts)}`);
    if (!Array.isArray(manifest?.fasteners)) p.push(`顶层 fasteners：期望数组，实得 ${short(manifest?.fasteners)}`);

    const seen = new Map();
    const claim = (id, where) => {
      if (!isStr(id)) { p.push(`${where}：id 期望非空字符串，实得 ${short(id)}`); return; }
      if (seen.has(id)) p.push(`id ${id} 重复：${seen.get(id)} 与 ${where} 撞名`);
      else seen.set(id, where);
    };

    parts.forEach((it, i) => {
      const at = `parts[${i}]`;
      claim(it?.id, at);
      const tag = isStr(it?.id) ? it.id : at;
      if (!isStr(it?.name)) p.push(`${tag}：name 期望非空中文名，实得 ${short(it?.name)}`);
      const nodes = it?.nodes;
      if (!Array.isArray(nodes) || !nodes.length || !nodes.every(isStr)) {
        p.push(`${tag}：nodes 期望至少一个非空字符串，实得 ${short(nodes)}`);
      }
      const ins = it?.install;
      if (!ins || typeof ins !== 'object') {
        p.push(`${tag}：install 期望对象，实得 ${short(ins)}`);
      } else {
        if (!INSTALL_KINDS.includes(ins.kind)) {
          p.push(`${tag}.install.kind：期望 ${INSTALL_KINDS.join('/')}，实得 ${short(ins.kind)}`);
        }
        if (!Number.isFinite(vecLength(ins.dir))) {
          p.push(`${tag}.install.dir：期望 3 个有限数，实得 ${short(ins.dir)}`);
        }
        if (!isNum(ins.gap) || ins.gap <= 0) p.push(`${tag}.install.gap：期望正数，实得 ${short(ins.gap)}`);
        if (!isNum(ins.snap) || ins.snap <= 0) p.push(`${tag}.install.snap：期望正数，实得 ${short(ins.snap)}`);
      }
      const needsPivot = ins?.kind === 'thread' || ins?.kind === 'hinge';
      if (it?.pivot === undefined) {
        if (needsPivot) p.push(`${tag}：install.kind 为 ${ins.kind}，期望给出 pivot，实得缺省`);
      } else if (!it.pivot || typeof it.pivot !== 'object') {
        p.push(`${tag}.pivot：期望对象，实得 ${short(it.pivot)}`);
      } else {
        if (!Number.isFinite(vecLength(it.pivot.point))) {
          p.push(`${tag}.pivot.point：期望 3 个有限数，实得 ${short(it.pivot.point)}`);
        }
        if (!Number.isFinite(vecLength(it.pivot.axis))) {
          p.push(`${tag}.pivot.axis：期望 3 个有限数，实得 ${short(it.pivot.axis)}`);
        }
      }
      if (!Array.isArray(it?.fasten) || !it.fasten.every(isStr)) {
        p.push(`${tag}.fasten：期望字符串数组（可为空），实得 ${short(it?.fasten)}`);
      }
      if (!Array.isArray(it?.needs) || !it.needs.every(isStr)) {
        p.push(`${tag}.needs：期望字符串数组（可为空），实得 ${short(it?.needs)}`);
      }
    });

    fasteners.forEach((f, i) => {
      const at = `fasteners[${i}]`;
      claim(f?.id, at);
      const tag = isStr(f?.id) ? f.id : at;
      if (!isStr(f?.name)) p.push(`${tag}：name 期望非空中文名，实得 ${short(f?.name)}`);
      if (!isStr(f?.tool)) p.push(`${tag}.tool：期望非空字符串，实得 ${short(f?.tool)}`);
      if (!isNum(f?.pitch) || f.pitch <= 0) p.push(`${tag}.pitch：期望正数（mm），实得 ${short(f?.pitch)}`);
      if (!isNum(f?.turns) || f.turns <= 0) p.push(`${tag}.turns：期望正数，实得 ${short(f?.turns)}`);
      if (!Number.isFinite(vecLength(f?.axis))) p.push(`${tag}.axis：期望 3 个有限数，实得 ${short(f?.axis)}`);
      if (!Number.isFinite(vecLength(f?.point))) p.push(`${tag}.point：期望 3 个有限数，实得 ${short(f?.point)}`);
      if (!isStr(f?.group)) p.push(`${tag}.group：期望非空字符串，实得 ${short(f?.group)}`);
      if (!ORDERS.includes(f?.order)) {
        p.push(`${tag}.order：期望 ${ORDERS.join('/')}，实得 ${short(f?.order)}`);
      }
    });

    raise(p);
    return `${parts.length} 个 BOM 件 · ${fasteners.length} 颗紧固件 · ${seen.size} 个 id 互不相撞`;
  });

  check('M-02', '清单引用的每个 glTF 节点名都真实存在于 GLB 中', () => {
    const p = [];
    const dup = [];
    let refs = 0;
    for (const it of parts) {
      for (const name of listOf(it?.nodes)) {
        refs += 1;
        const n = nodeNames.get(name) || 0;
        if (n === 0) {
          const near = [...nodeNames.keys()]
            .filter((k) => isStr(name) && k.toLowerCase().startsWith(String(name).slice(0, 4).toLowerCase()))
            .slice(0, 3);
          p.push(`${it?.id}：节点 ${short(name)} 在 GLB 中不存在`
            + `${near.length ? `（模型里形近的有 ${near.join('、')}）` : ''}`);
        } else if (n > 1) {
          dup.push(`${name}×${n}`);
        }
      }
    }
    raise(p);
    return `${refs} 处引用全部命中（模型共 ${nodeNames.size} 个有名节点）`
      + `${dup.length ? ` · 注意重名：${[...new Set(dup)].join('、')}，指过去有歧义` : ''}`;
  });

  check('M-03', '每个 install.dir 都是单位向量（容差 1e-3）', () => {
    const p = [];
    for (const it of parts) {
      const dir = it?.install?.dir;
      if (isUnitVector(dir)) continue;
      const len = vecLength(dir);
      p.push(`${it?.id}.install.dir=${short(dir)}：期望长度 1±1e-3，`
        + `实得 ${Number.isFinite(len) ? len.toFixed(6) : '不是 3 个有限数'}`);
    }
    raise(p);
    return `${parts.length} 个就位方向长度全为 1 —— 动画位移不会被向量长度悄悄缩放`;
  });

  check('M-04', '每个 pivot.axis 与紧固件 axis 都是单位向量（容差 1e-3）', () => {
    const p = [];
    let n = 0;
    const one = (label, v) => {
      n += 1;
      if (isUnitVector(v)) return;
      const len = vecLength(v);
      p.push(`${label}=${short(v)}：期望长度 1±1e-3，`
        + `实得 ${Number.isFinite(len) ? len.toFixed(6) : '不是 3 个有限数'}`);
    };
    for (const it of parts) if (it?.pivot) one(`${it?.id}.pivot.axis`, it.pivot.axis);
    for (const f of fasteners) one(`${f?.id}.axis`, f?.axis);
    raise(p);
    return `${n} 条转轴 / 拧入轴长度全为 1 —— 旋转角度不会被轴长带偏`;
  });

  check('M-05', 'needs 指向的件与 fasten 指向的紧固件都存在', () => {
    const partIds = new Set(parts.map((it) => it?.id).filter(isStr));
    const fastIds = new Set(fasteners.map((f) => f?.id).filter(isStr));
    const p = [];
    let needCount = 0, fastCount = 0;
    for (const it of parts) {
      for (const d of listOf(it?.needs)) {
        needCount += 1;
        if (!partIds.has(d)) p.push(`${it?.id}.needs：指向 ${short(d)}，但 parts 里没有这个 id`);
        if (d === it?.id) p.push(`${it?.id}.needs：把自己列成了前置件`);
      }
      for (const d of listOf(it?.fasten)) {
        fastCount += 1;
        if (!fastIds.has(d)) p.push(`${it?.id}.fasten：指向 ${short(d)}，但 fasteners 里没有这个 id`);
      }
    }
    const used = new Set(parts.flatMap((it) => listOf(it?.fasten)));
    const orphan = [...fastIds].filter((id) => !used.has(id));
    if (orphan.length) p.push(`没有任何件用到的紧固件：${orphan.join('、')}`);
    raise(p);
    return `${needCount} 条前置引用 + ${fastCount} 条紧固件引用全部落地，无孤儿紧固件`;
  });

  check('M-06', '整张前置依赖图无环（可拓扑排序）', () => {
    const deps = new Map(parts.filter((it) => isStr(it?.id)).map((it) => [it.id, listOf(it.needs)]));
    const { order, cycles } = topoSort(deps);
    if (cycles.length) {
      raise(cycles.map((c) => `成环：${formatCycle(c)} —— 分步流程会卡在这里，永远等不到前置件`));
    }
    if (order.length !== deps.size) {
      throw new Error(`拓扑排序只排出 ${order.length} 件，期望 ${deps.size} 件`);
    }
    const head = order.slice(0, 4).join(' → ');
    return `${order.length} 件可排成一条合法装配序：${head}${order.length > 4 ? ' → …' : ''}`;
  });

  check('M-07', `每颗紧固件的旋合长度 turns × pitch 在 ${ENGAGE_MM[0]}–${ENGAGE_MM[1]} mm 之间`, () => {
    raise(threadProblems(fasteners));
    const rows = fasteners.map((f) => `${f.id} ${(f.turns * f.pitch).toFixed(1)} mm`);
    return `${fasteners.length} 颗紧固件旋进去的深度都在常识范围内`
      + `${rows.length ? `（如 ${rows.slice(0, 3).join('、')}）` : ''}`;
  });

  check('M-08', 'thread 只能 left/right，且左脚踏必须是 left（反牙）', () => {
    const p = [];
    for (const f of fasteners) {
      if (!THREADS.includes(f?.thread)) {
        p.push(`${f?.id}.thread：期望 ${THREADS.join('/')}，实得 ${short(f?.thread)}`);
      }
    }
    const left = fasteners.filter((f) => isLeftPedalId(f?.id));
    const right = fasteners.filter((f) => isRightPedalId(f?.id));
    if (!left.length) {
      p.push(`左脚踏：期望有一颗 id 形如 pedal-left 的紧固件（这一条是本项目的教学要害），实得未找到`);
    }
    for (const f of left) {
      if (f.thread !== 'left') p.push(`${f.id}：左脚踏期望 thread 为 left（反牙），实得 ${short(f.thread)}`);
    }
    for (const f of right) {
      if (f.thread !== 'right') p.push(`${f.id}：右脚踏期望 thread 为 right，实得 ${short(f.thread)}`);
    }
    raise(p);
    return `${fasteners.length} 颗牙向合法 · 左脚踏 ${left.map((f) => f.id).join('、')} 为反牙，`
      + `顺时针是松 —— 装反了当场啃坏曲柄螺纹`;
  });

  check('M-09', `同 group 且 order 为 cross 的紧固件是偶数颗且不少于 ${CROSS_MIN} 颗`, () => {
    raise(crossGroupProblems(fasteners));
    const groups = groupBy(fasteners, (f) => f?.group);
    const cross = [...groups].filter(([, list]) => list.some((f) => f?.order === 'cross'));
    return cross.length
      ? `交叉拧紧 ${cross.length} 组：${cross.map(([g, l]) => `${g}×${l.length}`).join('、')}`
      : `${groups.size} 个分组，没有 order 为 cross 的组`;
  });

  check('M-10', '每个 install 满足 0 < snap < gap（吸附阈值小于退让距离）', () => {
    const p = [];
    for (const it of parts) {
      const { gap, snap } = it?.install || {};
      if (!isNum(gap) || !isNum(snap)) continue;         // 类型问题归 M-01 报
      if (!(snap < gap)) {
        p.push(`${it?.id}.install：期望 snap < gap，实得 snap=${snap} ≮ gap=${gap}`
          + ` —— 预备位就在吸附范围内，零件会自己吸上去，装配动作没了`);
      }
    }
    raise(p);
    return `${parts.length} 个件的预备位都在吸附范围之外`;
  });

  check('M-11', '写了 spec 的紧固件，其螺距与 spec 解析结果一致', () => {
    const p = [];
    let n = 0;
    for (const f of fasteners) {
      if (f?.spec === undefined) continue;
      n += 1;
      const s = parseSpec(f.spec);
      if (!s) { p.push(`${f?.id}.spec：期望形如 M14x1.25，实得 ${short(f.spec)}`); continue; }
      if (s.pitch !== null && s.pitch !== f?.pitch) {
        p.push(`${f.id}：spec ${f.spec} 解出螺距 ${s.pitch}，与 pitch 字段 ${short(f.pitch)} 对不上`);
      }
    }
    raise(p);
    return n ? `${n} 颗紧固件写了 spec，公称与螺距对得上` : '没有紧固件写 spec（该字段可选）';
  });

  return results;
}

export function formatReport(res) {
  const pass = res.filter((r) => r.ok).length;
  const lines = res.map((r) =>
    `${r.ok ? '✓' : '✗'} [${r.code}] ${r.title}${r.detail ? `\n      ${r.detail}` : ''}`);
  return { pass, total: res.length, text: lines.join('\n') };
}

// ══ 命令行 ═════════════════════════════════════════════════════════════

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
export const DEFAULT_MANIFEST = resolve(ROOT, 'assets/bike.manifest.json');
export const DEFAULT_MODEL = resolve(ROOT, 'public/models/CarbonFrameBike.glb');

function main(argv) {
  const manifestPath = resolve(argv[0] || DEFAULT_MANIFEST);
  const modelPath = resolve(argv[1] || DEFAULT_MODEL);

  const rule = '═'.repeat(74);
  console.log(rule);
  console.log('  《自行车 · 开箱组装》装配清单 × 整车模型  逐条对账');
  console.log(rule);
  console.log(`  清单  ${manifestPath}`);
  console.log(`  模型  ${modelPath}\n`);

  let manifest, nodeNames;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    console.log(`✗ [M-00] 清单可读且是合法 JSON\n      ${e.message}`);
    console.log(`\n${'─'.repeat(74)}\n  0 / 1 项通过 —— 先把清单写出来再对账\n${rule}`);
    return 1;
  }
  try {
    const gltf = readGlbJson(readFileSync(modelPath));
    nodeNames = collectNodeNames(gltf);
  } catch (e) {
    console.log(`✗ [M-00] 模型可读且是合法 GLB\n      ${e.message}`);
    console.log(`\n${'─'.repeat(74)}\n  0 / 1 项通过\n${rule}`);
    return 1;
  }

  const size = (statSync(modelPath).size / 1048576).toFixed(2);
  console.log(`✓ [M-00] 清单与模型都读到了`);
  console.log(`      清单 schema ${manifest?.schema} · 模型 ${size} MB / ${nodeNames.size} 个有名节点\n`);

  const res = runChecks(manifest, nodeNames);
  const { pass, total, text } = formatReport(res);
  console.log(text);
  console.log(`\n${'─'.repeat(74)}`);
  console.log(`  ${pass} / ${total} 项通过`);
  console.log(rule);
  return pass === total ? 0 : 1;
}

const invoked = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invoked) process.exit(main(process.argv.slice(2)));
