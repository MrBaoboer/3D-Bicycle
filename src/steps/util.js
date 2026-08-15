/** 步骤脚本共用工具：取景现算、装配与拧紧的标准铺陈 */

import { Box3, Vector3 } from 'three';

/** 裸数组 / 三个数 → Vector3 */
export const V = (...a) => new Vector3(...(Array.isArray(a[0]) ? a[0] : a));

/** 整车。首尾那两步给的是成品照 */
export const AIM_BIKE = [-0.026, 0.560, 0];
export const FIT_BIKE = { r: 1.025, h: 0.594 };

const DEG = 180 / Math.PI;

/**
 * 一件在世界里的形心。三维标注要钉在件身上，而件由一到五个节点组成。
 */
export function partCenter(ctx, partId) {
  const box = new Box3();
  for (const n of ctx.bom.nodesOf(partId)) box.union(ctx.bike.boundsOf(n));
  return box.getCenter(new Vector3());
}

/**
 * 这一步该框多大、镜头对哪儿 —— **现算，不写常量**。
 *
 * 量的是这几件从预备位到装配位扫过的**整段包络**：只框装配位的话，
 * 件在起手那一头会飘到画面外（前轮的行程包络比它自己高 34%）。
 *
 * 早先这些是二十来个手写常量。二十来个手写的数字里，实测有六个是错的
 * （桶轴那一步框大了六倍、面盖那一步的中心被工具带偏），
 * 而且每加一步就要再手量一次。现在它们从同一份几何里现推，错不了也不会漂。
 *
 * @param {object} ctx
 * @param {string[]} parts 件 id
 * @param {{pad?:number, extra?:Vector3[]}} [o] extra：还要框进去的世界坐标点
 */
export function frameOf(ctx, parts, { pad = 1.18, extra = [], az = 45, el = 16 } = {}) {
  const box = new Box3();
  for (const id of parts) {
    for (const u of [0, 1]) {
      ctx.slide.park(id, u);
      for (const n of ctx.bom.nodesOf(id)) box.union(ctx.bike.boundsOf(n));
    }
    ctx.slide.park(id, 1);
  }
  for (const p of extra) box.expandByPoint(p);
  const c = box.getCenter(new Vector3());

  /*
   * 半跨度要**在相机自己的基底里**量，不能拿世界 XYZ 凑。
   *
   * fit 的 {r, h} 被 stage.fitDistance 当成「水平半径」与「垂直半高」独立处理，
   * 而相机是斜着看的：世界 Z 方向的一截会投影成屏幕上的竖直位移，
   * 包围盒的对角线又比任何一条边都长。拿 max(sx,sz)/2 与 sy/2 交差事的结果，
   * 实测二十八步里有十三步被裁掉，最多的一步下缘超出 417 像素。
   *
   * 机位这时已经定了（viewFor 先算），所以直接把八个角投到相机的右向量与上向量上，
   * 取最大绝对值 —— 这是精确解，不是余量堆出来的。
   */
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
  return {
    target: [+c.x.toFixed(4), +c.y.toFixed(4), +c.z.toFixed(4)],
    /*
     * 竖向多给一成：取景之外，界面还会按上下两条边的高低差把主体整体抬一点
     * （见 stage.setRecommended 的 lift），那一下会吃掉竖向的余量。
     */
    fit: { r: Math.max(0.05, hr * pad), h: Math.max(0.04, hu * pad * 1.12), d: hd },
  };
}

/**
 * 从装配方向反推一个能看清这段行程的机位。
 *
 * 一条判据：**行程必须在屏幕上是一段看得见的位移**。
 * 正对着装配轴看，件只是慢慢变大；完全垂直于它看，件又常被车架挡住。
 * 所以相机落在件飞来的那一侧，再往车头方向偏开五十来度。
 *
 * 纵向进给（轮子落进勾爪、护板往上贴）另算：那种行程从侧面看最清楚。
 */
export function viewFor(dirArr, { el = 16 } = {}) {
  const d = new Vector3(...dirArr).normalize();
  if (Math.abs(d.y) > 0.6) return { az: 150, el: 8 };      // 上下进给 —— 从侧前方看
  const from = d.clone().negate();                          // 件是从这一侧来的
  const az = Math.atan2(from.z, from.x) * DEG;
  // 往车头（方位角 180°）偏 50°，取最短的那一边
  const delta = ((180 - az + 540) % 360) - 180;
  return { az: Math.round(az + 50 * Math.sign(delta || 1)), el };
}

/** 爆炸视图里每件推开多远（米）。整车轴距 1.155 m，这个量级摊得开又不散架 */
export const BURST = 0.32;

/**
 * 整车的取景。explode 给出爆炸态要摊多开 —— 摊开之后的包络比整车大得多，
 * 沿用整车的 fit 会把飞出去的那一圈零件全裁在画面外。
 */
export function frameWhole(ctx, { explode = 0, pad = 1.0, az = 38, el = 14 } = {}) {
  if (explode) for (const p of ctx.bom.parts) ctx.slide.explode(p.id, explode);
  ctx.bike.root.updateMatrixWorld(true);
  const box = new Box3().setFromObject(ctx.bike.root);
  if (explode) for (const p of ctx.bom.parts) ctx.slide.park(p.id, 1);

  const c = box.getCenter(new Vector3());
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
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        v.set(x, y, z).sub(c);
        hr = Math.max(hr, Math.abs(v.dot(right)));
        hu = Math.max(hu, Math.abs(v.dot(up)));
        hd = Math.max(hd, Math.abs(v.dot(fwd)));
      }
    }
  }
  /*
   * 整车这一档只补三分之一的半深。近景要按最靠近相机的那一层算（见 fitDistance），
   * 可主体一大，撑开画幅的那几个角并不在最近那一层上，全额补会把镜头白白推远
   * 一米多，摊开的车缩成画面中间一小团。
   */
  return {
    az,
    el,
    target: [+c.x.toFixed(4), +c.y.toFixed(4), +c.z.toFixed(4)],
    fit: { r: hr * pad, h: hu * pad, d: hd * 0.34 },
  };
}

/**
 * 一步的完整机位。**先定机位，再按这个机位量取景** ——
 * 半跨度是在相机基底里量的，顺序反了就白量。
 */
export function shot(ctx, parts, o = {}) {
  const dir = o.dir ?? ctx.bom.part(parts[0]).install.dir;
  const view = { ...viewFor(dir, o), ...(o.cam || {}) };
  return { ...view, ...frameOf(ctx, parts, { ...o, az: view.az, el: view.el }) };
}

// ══════════════ 装配 ══════════════

/**
 * 装配一件（或一组同时装的件）的标准流程：亮起目标 → 交给 slide → 到位收尾。
 *
 * **绝对不能返回一个「等用户装完才兑现」的 Promise。**
 * 引擎的 go() 会 await 每一步的 enter()，而 enter 的职责只是把这一步铺开；
 * 一旦在里面等用户动手，engine.busy 就永远不落 —— 翻页、冒烟、自动路径全部卡死。
 * 到位之后要做什么，走 onDone 回调。
 */
export function installPart(ctx, partId, { onDone, hint } = {}) {
  const ids = Array.isArray(partId) ? partId : [partId];
  for (const id of ids) {
    ctx.slide.park(id, 0);
    ctx.bike.highlight(ctx.bom.nodesOf(id), 0xd8642a, 0.1);
  }
  ctx.slide.begin({
    partId: ids,
    wrongHint: hint,
    onAll: () => {
      for (const id of ids) ctx.bike.highlight(ctx.bom.nodesOf(id), 0xd8642a, 0);
      onDone?.();
    },
  });
}

// ══════════════ 拧紧 ══════════════

/** 扭矩行：把区间写清 */
export const torqueRow = (f) => ['扭矩', `${f.torque[0]}–${f.torque[1]} N·m`];

/** 工具代号 → 人话 */
const TOOL_NAME = {
  'hex-4': '4 mm 内六角',
  'hex-5': '5 mm 内六角',
  'hex-6': '6 mm 内六角',
  'wrench-15': '15 mm 脚踏扳手',
  torque: '扭力扳手',
};

/**
 * 这一遍真正会用到的工具，从清单现数。
 * 手写过一版「4 / 5 / 6 mm 内六角」—— 而这台车一处也没用到 5 mm。
 */
export function toolList(ctx) {
  const used = new Set(ctx.bom.fasteners.map((f) => f.tool));
  const known = Object.keys(TOOL_NAME).filter((k) => used.has(k)).map((k) => TOOL_NAME[k]);
  return [...known, ...[...used].filter((k) => !TOOL_NAME[k])].join('、');
}

/**
 * 拧紧一颗的标准铺陈：摆出扭矩表、开会话、把「帮我拧上」挂上。
 *
 * 四个拧螺丝的步骤这一段本来一字不差地各写了一遍，于是 `onProgress` 的形参
 * 也各写错了一遍 —— 引擎发的是 `{nm, depth, zone, …}` 一整个对象，四处都当成
 * 一个数直接 `toFixed`。这类活写一次就够。
 */
export function fasten(ctx, fastenerId, hooks = {}) {
  const f = ctx.bom.fastener(fastenerId);
  const gauge = (nm) => ctx.hud.setTorqueGauge({
    nm, min: f.torque[0], max: f.torque[1], strip: f.strip,
  });
  gauge(0);
  ctx.screw.begin({
    fastenerId,
    onProgress: (p) => { gauge(p.nm); hooks.onProgress?.(p); },
    onTight: hooks.onTight,
    onStrip: hooks.onStrip,
    onWrongWay: hooks.onWrongWay,
  });
  ctx.hud.setAlts([{ label: '帮我拧上', ico: 'wrench', onClick: () => ctx.screw.autoRun(fastenerId) }]);
  return f;
}

/** 同上，一组交叉拧紧的（面盖那四颗）。扭矩表跟着手上正在拧的那一颗走 */
export function fastenGroup(ctx, group, hooks = {}) {
  const spec = ctx.bom.groupOf(group)[0];
  const gauge = (nm) => ctx.hud.setTorqueGauge({
    nm, min: spec.torque[0], max: spec.torque[1], strip: spec.strip,
  });
  ctx.screw.beginGroup({
    group,
    onProgress: (p) => gauge(p.nm),
    onEach: (id, info) => { gauge(0); hooks.onEach?.(id, info); },
    onAll: hooks.onAll,
  });
  gauge(0);
  ctx.hud.setAlts([{ label: '帮我拧上', ico: 'wrench', onClick: () => ctx.screw.autoRun() }]);
}
