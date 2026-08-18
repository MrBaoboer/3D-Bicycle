/** 步骤脚本共用工具：取景现算、装配与拧紧的标准铺陈 */

import { Box3, Vector3 } from 'three';

/** 裸数组 / 三个数 → Vector3 */
export const V = (...a) => new Vector3(...(Array.isArray(a[0]) ? a[0] : a));

const DEG = 180 / Math.PI;

/** 角度差归一到 ±180 —— 比「离上一步多远」时不能让 350° 赢过 10° */
const wrapDeg = (d) => ((d % 360) + 540) % 360 - 180;

/*
 * 近景的最近工作距离：画面上至少要看见这么宽的一块车（米）。
 * 只按主体包络定距的话，小件会把镜头拽到贴脸 —— 满屏碳纹里一颗小螺栓，
 * 认不出这是车上的哪儿。260 mm 是任何一个装配接口连同邻居
 * 一起能被认出来的最小范围。
 */
const MIN_SPAN = 0.26;

/**
 * 一件在世界里的形心。三维标注要钉在件身上，而件由一到五个节点组成。
 */
export function partCenter(ctx, partId) {
  const box = new Box3();
  for (const n of ctx.bom.nodesOf(partId)) box.union(ctx.bike.boundsOf(n));
  return box.getCenter(new Vector3());
}

/**
 * 一组世界包围盒 → 机位目标与取景。
 *
 * 半跨度在相机基底里量（把每个盒的八个角投到右向量与上向量上），
 * 不拿世界 XYZ 凑 —— 相机是斜着看的，fit 的 {r,h} 又按水平/垂直独立处理，
 * 拿世界轴凑会成片裁掉画面。收一组盒子而不是先并成一个：
 * 整车并集的角落大半是空气，撑开画幅的正是这些空角。
 *
 * @param {Box3[]} boxes
 * @param {{az:number, el:number, pad?:number, depth?:number, at?:Vector3, off?:number[]}} o
 *   depth：沿视线的半深补多少（0–1）。近景补满，整车只补三分之一 ——
 *   主体一大，撑开画幅的角并不在最靠近相机的那一层上，全额补会白白退远。
 *   at：对准哪一点，默认整段包络的中点。
 *   off：这一步故意让主体偏出正中多少，以取景半跨度计，[右为正, 上为正]。
 *     不写就是正中，偏出去要明写。
 */
function aimAt(boxes, { az, el, pad = 1, depth = 1, at = null, off = null }) {
  const all = new Box3();
  for (const b of boxes) if (!b.isEmpty()) all.union(b);
  // 给了 at 就对准 at，半跨度仍按新中心重量 —— 「主体在正中」与
  // 「整段行程都在画面里」同时成立，代价是镜头退远一点
  const c = at ? at.clone() : all.getCenter(new Vector3());

  const ar = (az * Math.PI) / 180;
  const er = (el * Math.PI) / 180;
  const eye = new Vector3(Math.cos(er) * Math.cos(ar), Math.sin(er), Math.cos(er) * Math.sin(ar));
  const fwd = eye.clone().negate();
  const right = new Vector3().crossVectors(fwd, new Vector3(0, 1, 0)).normalize();
  const up = new Vector3().crossVectors(right, fwd).normalize();

  let hr = 0;
  let hu = 0;
  let hd = 0;
  const v = new Vector3();
  for (const box of boxes) {
    if (box.isEmpty()) continue;
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) {
          v.set(x, y, z).sub(c);
          hr = Math.max(hr, Math.abs(v.dot(right)));
          hu = Math.max(hu, Math.abs(v.dot(up)));
          hd = Math.max(hd, Math.abs(v.dot(fwd)));   // 沿视线的半深，交给 fitDistance 顶开
        }
      }
    }
  }
  let r = Math.max(MIN_SPAN / 2, hr * pad);
  let h = Math.max(MIN_SPAN / 2, hu * pad);

  /*
   * 构图偏移：先按 r' = r / (1 − |off|) 放大取景，再把机位目标反向推 off·r'，
   * 主体的中心正好落在画面 off 处、又一寸不被挤出画面。
   * 直接推 off·r 不行 —— 推完取景又大了一圈，占比就不是 off 了。
   */
  if (off) {
    const [ox, oy] = off;
    if (ox) { r /= 1 - Math.min(0.6, Math.abs(ox)); c.addScaledVector(right, -ox * r); }
    if (oy) { h /= 1 - Math.min(0.6, Math.abs(oy)); c.addScaledVector(up, -oy * h); }
  }

  return {
    az,
    el,
    target: [+c.x.toFixed(4), +c.y.toFixed(4), +c.z.toFixed(4)],
    fit: { r, h, d: hd * depth },
  };
}

/**
 * 车上挂着的几何，逐网格一个世界包围盒。
 *
 * @param {object} ctx
 * @param {{skipParts?:boolean}} [o] skipParts：跳过清单里所有 BOM 件，
 *   量出来的就是一根光车架。`Box3.setFromObject` 不看 visible，
 *   所以只能自己走一遍树、遇到要跳的整枝剪掉。
 */
function meshBoxes(ctx, { skipParts = false } = {}) {
  ctx.bike.root.updateMatrixWorld(true);
  const skip = new Set();
  if (skipParts) {
    for (const p of ctx.bom.parts) {
      for (const n of ctx.bom.nodesOf(p.id)) skip.add(ctx.bike.get(n));
    }
  }
  const out = [];
  const stack = [ctx.bike.root];
  while (stack.length) {
    const o = stack.pop();
    if (skip.has(o)) continue;
    if (o.isMesh && o.geometry) {
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      out.push(new Box3().copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld));
    }
    for (const child of o.children) stack.push(child);
  }
  return out;
}

/**
 * 一个节点子树下每张网格各一个世界包围盒。
 *
 * 量之前必须把这一枝的矩阵从祖先一路刷到叶子（updateWorldMatrix(true, true)）。
 * `Box3.setFromObject()` 只重算自己那一格：清单节点几乎全是组节点，
 * park 挪的是组节点，子网格拿到的还是旧矩阵 —— 位移一点也量不到，
 * 「量整段行程」静默失效。取景跑在首帧渲染之前，没有别人替这里刷。
 * 详见 docs/DEVELOPMENT.md「量几何之前先自己刷矩阵」。
 */
function nodeBoxes(ctx, name) {
  const root = ctx.bike.get(name);
  root.updateWorldMatrix(true, true);
  const out = [];
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    out.push(new Box3().setFromObject(o));
  });
  return out.length ? out : [ctx.bike.boundsOf(name)];
}

/**
 * 这一步该框多大、镜头对哪儿 —— 现算，不写常量。
 * 量的是这几件从预备位到装配位扫过的整段包络：只框装配位，
 * 件在起手那一头会飘到画面外（前轮的行程包络比它自己高 34%）。
 *
 * @param {object} ctx
 * @param {string[]} parts 件 id
 * @param {{pad?:number, extra?:Vector3[], off?:number[]}} [o] extra：还要框进去的世界坐标点；
 *   off：这一步故意让主体偏出正中多少，见 aimAt
 */
export function frameOf(ctx, parts, { pad = PAD, extra = [], az = 45, el = 16, off = null } = {}) {
  const boxes = [];
  const ends = [new Box3(), new Box3()];
  for (const id of parts) {
    for (const u of [0, 1]) {
      ctx.slide.park(id, u);
      for (const n of ctx.bom.nodesOf(id)) {
        const bs = nodeBoxes(ctx, n);
        boxes.push(...bs);
        for (const b of bs) ends[u].union(b);
      }
    }
    ctx.slide.park(id, 1);
  }
  for (const p of extra) boxes.push(new Box3().setFromPoints([p]));

  /*
   * 锚点落在预备位（往装配位挪十分之一），不是整段行程的中点。
   * 件常常比行程还小，对准中点的话它停在行程哪一头都贴着画幅边；
   * 而进场那一刻件停在预备位，那才是「初始视角」的那一眼。
   * 半跨度按锚点重量，整段行程仍全在画面里，代价是画幅大一点
   * （半跨度由 (行程+件长)/2 变成 行程+件长/2）。
   * ends 两个盒量得准不准，取决于 nodeBoxes 有没有先刷矩阵。
   */
  const ANCHOR_TO_SEAT = 0.10;
  const anchor = ends[0].isEmpty() || ends[1].isEmpty() ? null
    : ends[0].getCenter(new Vector3()).lerp(ends[1].getCenter(new Vector3()), ANCHOR_TO_SEAT);

  const { target, fit } = aimAt(boxes, { az, el, pad, off, at: anchor });
  return { target, fit };
}

/**
 * 整车形心、半径，以及每一件在装配位上的形心。量一次，一直用这一份。
 *
 * 装配位形心必须缓存：爆炸位移里有一股是「从整车形心指向这一件」，
 * 摊开的两秒里件每帧都在动，现问就是拿上一帧的位移再算位移，一路复利。
 * 量之前先把所有件按回装配位 —— 这一份是合装态的几何。
 */
let _bike = null;
function bikeRef(ctx) {
  if (!_bike) {
    for (const p of ctx.bom.parts) ctx.slide.park(p.id, 1);
    ctx.bike.root.updateMatrixWorld(true);
    const box = new Box3().setFromObject(ctx.bike.root);
    _bike = {
      center: box.getCenter(new Vector3()),
      radius: box.getSize(new Vector3()).length() / 2,
      homes: new Map(ctx.bom.parts.map((p) => [p.id, partCenter(ctx, p.id)])),
    };
  }
  return _bike;
}

/**
 * 拧螺丝那几步的取景：框住这一组紧固件本身，不拿它们长在的大件当替身
 * （面盖四颗长在 78 cm 宽的车把上，要看的却是四厘米见方的面盖）。
 * 尺度由 MIN_SPAN 兜底。不往车身那边偏：这几步的主体只有指甲盖大
 * （画面上约 6% 宽），小主体的构图靠它自己在正中，不靠周围填得满。
 *
 * @param {object} ctx
 * @param {string} group 紧固件分组名（单颗的传它自己的 id 也认）
 */
export function frameBolts(ctx, group, { az, el, off = null } = {}) {
  const boxes = ctx.bom.groupOf(group).map(
    (f) => new Box3().setFromCenterAndSize(f.v.point.clone(), new Vector3(0.02, 0.02, 0.02)),
  );
  return aimAt(boxes, { az, el, off });
}

/**
 * 从装配方向反推一个能看清这段行程的机位。
 *
 * 判据：行程必须在屏幕上是一段看得见的位移。正对装配轴看，件只是慢慢变大；
 * 完全垂直看，件又常被车架挡住。所以相机落在件飞来的那一侧，
 * 再往车头方向偏开五十来度。纵向进给（轮子落进勾爪）另算：侧面看最清楚。
 */
export function viewFor(dirArr, { el = 16 } = {}) {
  const d = new Vector3(...dirArr).normalize();
  // 上下进给从侧前方略俯看。平视时件贴着车身垂直落下，
  // 行程在屏幕上重合成一条线，看不出「落进去」
  if (Math.abs(d.y) > 0.6) return { az: 150, el: 15 };
  const from = d.clone().negate();                          // 件是从这一侧来的
  const az = Math.atan2(from.z, from.x) * DEG;
  // 往车头（方位角 180°）偏 50°，取最短的那一边
  const delta = wrapDeg(180 - az);
  const side = Math.sign(delta || 1);
  // 件顺着车身长轴来的（车把）时两侧等价，把 alt 也报上去，
  // 由 shot() 挑离上一步近的那一侧 —— 不报的话偏向哪边只是个默认符号，
  // 能让镜头凭空甩过整台车八十度
  const free = Math.abs(Math.abs(delta) - 90) > 65;
  return {
    az: Math.round(az + 50 * side),
    el,
    alt: free ? Math.round(az - 50 * side) : undefined,
  };
}

/**
 * 拆开那一步的机位。取景与位移都按它算，两边必须一致（见 burstOffset）。
 * 偏离正侧面二十来度：正侧面最认得出这是一台自行车，偏一点才看得出左右两件是两件。
 */
export const BURST_VIEW = { az: 112, el: 12 };

/*
 * 爆炸视图摊多开。横/竖：在屏幕平面里以整车形心为中心各向放大的倍数
 * （横比竖大 —— 画幅十六比九，车的侧影近乎正方）。
 * 左右/高低：按「从哪一侧装进来」再朝屏幕斜着分开的距离（米）——
 * 十五件侧装件两两成镜像，在侧影里严丝合缝地重合，不掰开就永远只看得见一只。
 * 掰开方向是斜的：镜头站在左前方，右侧件全在远端，纯横向推会撞上近端那一排。
 */
const BURST_H = 1.95;
const BURST_V = 1.72;
const BURST_SIDE = 0.26;
const BURST_SIDE_V = 0.13;

/** az/el → 相机的右向量与上向量。与 aimAt 量半跨度用的是同一组基底 */
function camBasis({ az, el }) {
  const ar = (az * Math.PI) / 180;
  const er = (el * Math.PI) / 180;
  const eye = new Vector3(Math.cos(er) * Math.cos(ar), Math.sin(er), Math.cos(er) * Math.sin(ar));
  const fwd = eye.clone().negate();
  const right = new Vector3().crossVectors(fwd, new Vector3(0, 1, 0)).normalize();
  return { right, up: new Vector3().crossVectors(right, fwd).normalize() };
}

/**
 * 爆炸态里这一件相对装配位的世界位移。
 *
 * 在相机的屏幕平面里摊，不按世界径向摊：径向放大有一大截落在视线方向上，
 * 那个方向的位移在画面上等于零。位移只发生在屏幕横竖两个方向，深度不动 ——
 * 件不前后穿插，剩下的是一次二维仿射放大，屏幕上分得开的只会更分得开。
 *
 * @param {number} k 0 是合装，1 是摊满
 */
export function burstOffset(ctx, partId, k = 1) {
  const { center, homes } = bikeRef(ctx);
  const { right, up } = camBasis(BURST_VIEW);
  const d = homes.get(partId).clone().sub(center);
  // 从哪一侧装进来的：沿车身左右轴的分量定正负，非侧装件为 0
  const side = Math.sign(new Vector3(...ctx.bom.part(partId).install.dir).normalize().dot(right));
  return right.clone()
    .multiplyScalar(d.dot(right) * (BURST_H - 1) - side * BURST_SIDE)
    .addScaledVector(up, d.dot(up) * (BURST_V - 1) - side * BURST_SIDE_V)
    .multiplyScalar(k);
}

/** 把整车摊到 k（0 合装，1 摊满） */
export function burstAll(ctx, k) {
  for (const p of ctx.bom.parts) ctx.slide.burst(p.id, burstOffset(ctx, p.id, k));
}

/** 收回合装态 */
export function burstReset(ctx) {
  for (const p of ctx.bom.parts) ctx.slide.park(p.id, 1);
}

/*
 * 取景余量。1.0 是包络贴着画幅四边。给得紧：主体的竖向跨度决定机位距离，
 * 余量每多一成主体就小一成，而空出来的是十六比九画幅里左右两片灰。
 * 主体顶到画幅边时，周围的车身自然把两边填满。
 */
const PAD = 1.06;

/**
 * 整车的取景。
 *
 * @param {object} ctx
 * @param {{burst?:boolean, bare?:boolean, pad?:number, az?:number, el?:number}} [o]
 *   burst：按爆炸态量 —— 沿用整车的 fit 会把飞出去的那一圈零件裁在画面外。
 *   bare：只量光车架（所有 BOM 件都还在箱子里的那一步）。
 */
export function frameWhole(ctx, { burst = false, bare = false, pad, az = 38, el = 14 } = {}) {
  if (burst) burstAll(ctx, 1);
  const boxes = meshBoxes(ctx, { skipParts: bare });
  if (burst) burstReset(ctx);
  /*
   * 摊开那张多留余量：贴边的正是最小的那几件，切掉一点就少数一件。
   * 整车那几张收紧到 0.96：场景不投影，车底下没有影子占位，
   * 余量松了读起来就是「车缩在中间一小团」。过紧有冒烟兜底 ——
   * 整车四张必须完整落在画幅内。
   */
  pad ??= burst ? 1.07 : 0.96;
  // 整车这一档只补三分之一的半深，理由见 aimAt 的 depth
  return aimAt(boxes, { az, el, pad, depth: 0.34 });
}

/**
 * 一步的完整机位。先定机位，再按这个机位量取景 ——
 * 半跨度是在相机基底里量的，顺序反了就白量。
 */
export function shot(ctx, parts, o = {}) {
  /*
   * 一步装一对镜像件时（摇臂、把套、刹把、曲柄），从哪边看同样成立，
   * 就挑离上一步近的那一侧站（near 是上一步的方位角）。
   * 不挑的话是拿 parts[0] 的书写顺序定生死，相邻几步会左右横跳。
   */
  const dirs = o.dir ? [o.dir] : parts.map((id) => ctx.bom.part(id).install.dir);
  const views = [];
  for (const d of dirs) {
    const v = viewFor(d, o);
    views.push({ az: v.az, el: v.el, ...(o.cam || {}) });
    if (v.alt !== undefined) views.push({ az: v.alt, el: v.el, ...(o.cam || {}) });
  }
  const view = o.near === undefined ? views[0]
    : views.reduce((a, b) => (Math.abs(wrapDeg(b.az - o.near)) < Math.abs(wrapDeg(a.az - o.near)) ? b : a));
  return { ...view, ...frameOf(ctx, parts, { ...o, az: view.az, el: view.el }) };
}

// ══════════════ 装配 ══════════════

/**
 * 装配一件（或一组同时装的件）的标准流程：亮起目标 → 交给 slide → 到位收尾。
 *
 * 不能返回「等用户装完才兑现」的 Promise：引擎的 go() 会 await enter()，
 * 在里面等用户动手，engine.busy 就永远不落 —— 翻页、冒烟、自动路径全部卡死。
 * 到位之后要做什么，走 onDone 回调。
 */
export function installPart(ctx, partId, { onDone, hint, sound, glow = 0.1 } = {}) {
  const ids = Array.isArray(partId) ? partId : [partId];
  for (const id of ids) {
    ctx.slide.park(id, 0);
    ctx.bike.highlight(ctx.bom.nodesOf(id), 0xd8642a, glow);
  }
  ctx.slide.begin({
    partId: ids,
    wrongHint: hint,
    sound,
    glow,
    onAll: () => {
      for (const id of ids) ctx.bike.highlight(ctx.bom.nodesOf(id), 0xd8642a, 0);
      onDone?.();
    },
  });
}

// ══════════════ 拧紧 ══════════════

/** 工具行：拧这一颗该拿哪一把 */
export const toolRow = (f) => ['工具', TOOL_NAME[f.tool] ?? f.tool];

/** 工具代号 → 人话 */
const TOOL_NAME = {
  'hex-4': '4 mm 内六角',
  'hex-5': '5 mm 内六角',
  'hex-6': '6 mm 内六角',
  'wrench-15': '15 mm 扳手',
};

/**
 * 拧一颗的标准铺陈：开会话，挂上「帮我拧上」。
 * 步骤脚本一律走这里，不自接 screw 的钩子（onProgress 收的是对象，容易接错）。
 */
export function fasten(ctx, fastenerId, hooks = {}) {
  const f = ctx.bom.fastener(fastenerId);
  ctx.screw.begin({
    fastenerId,
    onProgress: hooks.onProgress,
    onTight: hooks.onTight,
    onWrongWay: hooks.onWrongWay,
  });
  ctx.hud.setAlts([{ label: '帮我拧上', ico: 'wrench', onClick: () => ctx.screw.autoRun(fastenerId) }]);
  return f;
}

/** 同上，一组交叉拧紧的（面盖那四颗） */
export function fastenGroup(ctx, group, hooks = {}) {
  ctx.screw.beginGroup({
    group,
    onEach: hooks.onEach,
    onAll: hooks.onAll,
  });
  ctx.hud.setAlts([{ label: '帮我拧上', ico: 'wrench', onClick: () => ctx.screw.autoRun() }]);
}
