/** 步骤脚本共用工具：取景现算、装配与拧紧的标准铺陈 */

import { Box3, Vector3 } from 'three';

/** 裸数组 / 三个数 → Vector3 */
export const V = (...a) => new Vector3(...(Array.isArray(a[0]) ? a[0] : a));

const DEG = 180 / Math.PI;

/** 角度差归一到 ±180 —— 比「离上一步多远」时不能让 350° 赢过 10° */
const wrapDeg = (d) => ((d % 360) + 540) % 360 - 180;

/**
 * 近景的最近工作距离，写成「画面上至少要看见这么宽的一块车」（米）。
 *
 * 只按主体的包络定距，小件会把镜头拽到贴脸的位置：主转点轴那一步实测机位
 * 只有 260 mm 远，屏幕上是一整片碳纤维编织纹，中间一颗小小的银色螺栓 ——
 * 分辨率很高，可是没人看得出这是车上的哪儿。近景的意义是「看清这一处」，
 * 不是「看清这一丝」，所以它得停在还认得出周围是什么的地方。
 *
 * 260 mm 大约是一只手掌到一根曲柄的尺度，也是这台车上任何一个装配接口
 * 连同它的邻居一起能被认出来的最小范围。
 */
const MIN_SPAN = 0.26;

/*
 * 这里曾经有个 CTX_BIAS：近景一律往整车形心那边偏一档，好把空着的半边填上。
 * 撤掉了 —— 它与「这一步要看的那件东西落在舞台中央」是直接冲突的两件事，
 * 而冲突时后者赢。装件那几步早就不走它了（锚点一钉死就不再偏），
 * 只剩拧螺丝那两步还在偏：面盖四颗在画面上只占 6% 宽，被它推出去 0.16 个半跨度，
 * 读起来就是「这一小撮东西没在中间」。
 *
 * 构图上确实要偏的那几步（车把停在中线略左）改成由步骤自己写 off，
 * 见 aimAt —— 明写的偏移看得见、改得动，自动补偿看不见、也说不清偏了多少。
 */

/**
 * 一件在世界里的形心。三维标注要钉在件身上，而件由一到五个节点组成。
 */
export function partCenter(ctx, partId) {
  const box = new Box3();
  for (const n of ctx.bom.nodesOf(partId)) box.union(ctx.bike.boundsOf(n));
  return box.getCenter(new Vector3());
}

/**
 * 一组世界包围盒 → 这一步的机位目标与取景。
 *
 * 半跨度要**在相机自己的基底里**量，不能拿世界 XYZ 凑。
 * fit 的 {r, h} 被 stage.fitDistance 当成「水平半径」与「垂直半高」独立处理，
 * 而相机是斜着看的：世界 Z 方向的一截会投影成屏幕上的竖直位移，
 * 包围盒的对角线又比任何一条边都长。拿 max(sx,sz)/2 与 sy/2 交差事的结果，
 * 实测二十八步里有十三步被裁掉，最多的一步下缘超出 417 像素。
 * 机位这时已经定了（viewFor 先算），所以把每个盒的八个角投到相机的右向量与上向量上。
 *
 * **必须收一组盒子，不能先并成一个。** 一台自行车是个又扁又空的东西：
 * 把整车并成一个 AABB，那个盒的角落里大半是空气，而撑开画幅的正是这些空角
 * —— 实测整车照按并集算出来的竖向半跨度比车真正的半高大 25%，
 * 于是首屏那台车只占了画幅高度的一半，四周全是灰。
 * 逐网格各算各的，量到的就是零件本身。
 *
 * @param {Box3[]} boxes
 * @param {{az:number, el:number, pad?:number, depth?:number, at?:Vector3, off?:number[]}} o
 *   depth：沿视线的半深要补多少（0–1）。近景补满，整车只补三分之一 ——
 *   主体一大，撑开画幅的那几个角并不在最靠近相机的那一层上，全额补会白白退远一米。
 *   at：对准哪一点，默认整段包络的中点。
 *   off：这一步**故意**要让主体偏出正中多少，以取景半跨度计，[右为正, 上为正]。
 *     不写就是正中 —— 每一步要看的那件东西默认落在舞台中央，偏出去要有人签字。
 */
function aimAt(boxes, { az, el, pad = 1, depth = 1, at = null, off = null }) {
  const all = new Box3();
  for (const b of boxes) if (!b.isEmpty()) all.union(b);
  /*
   * 默认对准整段包络的中点；给了 at 就对准 at，而半跨度仍按新中心重量 ——
   * 于是「主体落在画面正中」与「整段行程都在画面里」两件事同时成立，
   * 代价只是镜头退远一点。
   */
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
   * 明确指定的构图偏移。要的是「主体的中心落在画面 off 那么远的地方」，
   * 所以先按 r' = r / (1 − |off|) 把取景放大，再把机位目标往反方向推 off·r' ——
   * 解出来正好，主体也一寸没被挤出画面。直接推 off·r 会连自己都算不准：
   * 推完取景又大了一圈，占比就不是 off 了。
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
 * 车上挂着的几何，**逐网格**一个世界包围盒。
 *
 * @param {object} ctx
 * @param {{skipParts?:boolean}} [o] skipParts：跳过清单里所有 BOM 件，
 *   量出来的就是「一根光车架」—— A3 那一步画面上剩下的正是它。
 *   `Box3.setFromObject` 不看 visible，所以只能自己走一遍树、遇到要跳的整枝剪掉。
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
 * **先把这一枝的矩阵从祖先一路刷到叶子。** 少了这一句，整套取景是错的，
 * 而且错得很安静 —— 画面上看不出「量错了」，只看得出「构图有点怪」。
 *
 * `Box3.setFromObject()` 内部走的是 `updateWorldMatrix(false, false)`：
 * 只算自己那一格，**既不回头刷祖先，也不往下刷子树**。而清单里登记的二十七个
 * 节点里有二十六个是组节点（只有油管是网格本身），几何全挂在它们的子网格上。
 * 于是 `slide.park(id, 0)` 把组节点挪到预备位之后，下面每张网格拿到的还是
 * 父节点的旧矩阵 —— 量出来的盒**原地不动**。
 *
 * 后果是 frameOf 的 ends[0] 与 ends[1] 一模一样：整段行程塌成一个点，
 * 「量整段行程」与「锚点落在预备位」两条同时失效，镜头对准的是件**装完之后**
 * 在哪儿。实测二十六步里有八步的主体因此在进场那一刻整整偏出一个 gap
 * （后避震偏出可用画面半高的 0.55，上下头碗的行程比画幅还高 19%，贴到脸上），
 * 而 `npm run frames` 量的是整幅画面的非背景像素，正好看不见这一类偏移。
 *
 * 另有一条更早的坑同源：油管那四段的节点原点离它自己的几何有一米远，
 * 祖先矩阵一旧，量出来的盒就退化到原点那一带 —— 「接上油管」于是把镜头
 * 对准了两个轮胎的下沿，油管一根都不在画面里。
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
   * **锚点落在预备位，不是整段行程的中点。**
   *
   * 这一步的取景本来就是按整段行程量的，而件本身常常比行程还小 ——
   * 于是「半个画幅」差不多就等于「半段行程」，件停在行程的哪一头都贴着画幅边。
   * 对准中点的话，向下装的那几件（后避震、把立、座管）进场那一刻就压在画幅上沿。
   *
   * 而**进场那一刻件停在预备位**，那才是用户第一眼看的地方，也正是
   * 「每一步的初始视角要呈现这一步最好的姿态」说的那一眼。所以锚点从预备位
   * 出发、只往装配位挪十分之一：进场时件落在正中（实测二十六步偏心全在 0.18 以内），
   * 装到位之后它落在画幅另一侧靠边处 —— 那时这一步已经讲完了。
   *
   * 半跨度是按锚点重量的，所以整段行程仍然全在画面里，代价是镜头退远一点：
   * 半跨度由 (行程 + 件长)/2 变成 行程 + 件长/2。这一档是认的 ——
   * 「第一眼看见它在中间」比「画幅再紧一成」值钱。
   *
   * ends[0] / ends[1] 这两个盒能不能量准，取决于 nodeBoxes 有没有先刷矩阵。
   * 少了那一句它俩会一模一样，这一整段就静默失效，见 nodeBoxes 的注释。
   */
  const ANCHOR_TO_SEAT = 0.10;
  const anchor = ends[0].isEmpty() || ends[1].isEmpty() ? null
    : ends[0].getCenter(new Vector3()).lerp(ends[1].getCenter(new Vector3()), ANCHOR_TO_SEAT);

  const { target, fit } = aimAt(boxes, { az, el, pad, off, at: anchor });
  return { target, fit };
}

/**
 * 整车的形心、半径，以及每一件在**装配位**上的形心。量一次，之后一直用这一份。
 *
 * 后面那一份是必须缓存的，不能现问。爆炸位移里有一股是「从整车形心指向这一件」，
 * 而 `partCenter()` 报的是件此刻在哪儿 —— 摊开的那两秒里它每帧都在动，
 * 现问就等于拿上一帧的位移再算一次位移，一路复利，实测两秒之内件飞出去几十米，
 * 投影翻到相机背后，屏幕上是一片乱线。
 *
 * 量之前先把所有件按回装配位：这一份是「合装态的几何」，谁也不许在半路上被量。
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
 * 拧螺丝那几步的取景：**框住这一组紧固件本身**。
 *
 * 拿它们所在的那个大件当替身是不行的：面盖四颗长在车把上，而车把横过来 78 cm，
 * 要看的却是中间四厘米见方的面盖 —— 只能靠一个手调的缩放系数硬压，
 * 换个画幅就重新错一次。直接框那几个点，尺度由 MIN_SPAN 兜底，
 * 于是「看清这几颗，同时认得出周围是什么」在任何画幅上都成立。
 *
 * **不往车身那边偏。** 这里原先挂着那一档自动偏置（往整车形心挪，把空着的半边填上），
 * 而这几步要看的东西只有指甲盖那么大：面盖那四颗在画面上只占 6% 宽、10% 高，
 * 被推出去 0.16 个半跨度就等于「这一小撮东西没在中间」，一眼就看得出来。
 * 小主体的构图靠的是它自己在正中，不是靠周围填得满。
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
 * 一条判据：**行程必须在屏幕上是一段看得见的位移**。
 * 正对着装配轴看，件只是慢慢变大；完全垂直于它看，件又常被车架挡住。
 * 所以相机落在件飞来的那一侧，再往车头方向偏开五十来度。
 *
 * 纵向进给（轮子落进勾爪、护板往上贴）另算：那种行程从侧面看最清楚。
 */
export function viewFor(dirArr, { el = 16 } = {}) {
  const d = new Vector3(...dirArr).normalize();
  // 上下进给 —— 从侧前方略微俯看。平视（el 8）时件是贴着车身垂直落下的，
  // 那一段行程在屏幕上几乎重合在一条线上，看不出「落进去」这件事
  if (Math.abs(d.y) > 0.6) return { az: 150, el: 15 };
  const from = d.clone().negate();                          // 件是从这一侧来的
  const az = Math.atan2(from.z, from.x) * DEG;
  // 往车头（方位角 180°）偏 50°，取最短的那一边
  const delta = wrapDeg(180 - az);
  const side = Math.sign(delta || 1);
  /*
   * 件是**顺着车身长轴**来的（从正前或正后推进去，车把就是这样）时，
   * 偏左偏右一样成立 —— 那就把两边都报上去，由 shot() 挑离上一步近的那一侧。
   * 不报的话这五十度往哪边偏就成了 delta 恰好为零时的一个默认符号，
   * 而它能让镜头凭空甩过整台车八十度。
   */
  const free = Math.abs(Math.abs(delta) - 90) > 65;
  return {
    az: Math.round(az + 50 * side),
    el,
    alt: free ? Math.round(az - 50 * side) : undefined,
  };
}

/**
 * 拆开那一步的机位。取景与位移都按它算 —— 顺序不能反，理由见 burstOffset。
 * 偏离正侧面二十来度：正侧面最认得出这是一台自行车，偏一点才看得出左右两件是两件。
 */
export const BURST_VIEW = { az: 112, el: 12 };

/**
 * 爆炸视图摊多开。
 *
 * **横 / 竖** 在屏幕平面里以整车形心为中心各向放大这么多倍，件本身不放大。
 * 横比竖大是因为画幅是十六比九，而自行车的侧影近乎正方 ——
 * 各向同性地摊，左右两大片是空的。
 *
 * **左右 / 高低** 再把件按「从哪一侧装进来」朝屏幕斜着分开这么远（米）。
 * 这台车二十七件里有十五件是从侧面装的，两两成镜像（两条摇臂、两只把套、
 * 两只刹把、两条曲柄、两只脚踏）—— 它们在侧影里严丝合缝地重合，
 * 不单独把它们掰开，屏幕上就永远只看得见一只。
 *
 * 掰开的方向是**斜的**，不是纯左右：镜头站在车的左前方，右侧那几件全在远端，
 * 只往横里推，推出去正好撞上近端那一排（实测右脚踏只露得出三个像素）。
 * 远端往左上、近端往右下，两条对角线上各走各的，谁也不挡谁。
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
 * **在相机自己的屏幕平面里摊，不在世界里摊。** 上一版按世界径向等比放大，
 * 数学上很干净，可屏幕上没用：放大量里有一大截落在视线方向上，
 * 那个方向的位移在画面上等于零。实测二十七件里有二十三件露出率不到三成 ——
 * 摊是摊开了，看还是看不见。
 *
 * 所以位移只发生在屏幕的横竖两个方向上，深度一动不动：件既不会前后穿插，
 * 影子也还落在原来那一带。剩下的就是一次二维仿射放大 ——
 * 原本在屏幕上分得开的两件，放大之后只会更分得开。
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

/**
 * 取景余量。1.0 就是包络刚好贴着画幅四边。
 *
 * 这一档给得很紧是有原因的：主体在屏幕上的**竖向**跨度决定机位距离，
 * 而每一步的主体多半是一条竖直的细长包络（两只头碗加行程、一根座管加行程）。
 * 余量每多一成，主体就小一成，而空出来的那一成是横向的 ——
 * 十六比九的画幅里，那是左右两大片什么也没有的灰。
 * 主体顶到画幅边上时，周围的车身自然把两边填满，画面才像一张说明图。
 */
const PAD = 1.06;

/**
 * 整车的取景。
 *
 * @param {object} ctx
 * @param {{burst?:boolean, bare?:boolean, pad?:number, az?:number, el?:number}} [o]
 *   burst：按爆炸态量 —— 摊开之后的包络比整车大得多，
 *     沿用整车的 fit 会把飞出去的那一圈零件全裁在画面外。
 *   bare：只量光车架（所有 BOM 件都还在箱子里的那一步）。
 */
export function frameWhole(ctx, { burst = false, bare = false, pad, az = 38, el = 14 } = {}) {
  if (burst) burstAll(ctx, 1);
  const boxes = meshBoxes(ctx, { skipParts: bare });
  if (burst) burstReset(ctx);
  /*
   * 摊开那一张多留一点余量：二十七件散在画幅四角，贴边的那几件正是最小的那几件，
   * 切掉一点就等于少了一件，而这一步的全部意思就是「数得出有多少件」。
   *
   * 整车那几张反过来要收紧。取消投影之后地上那一大片影子没有了，
   * 而它原本正好占着车底下那一块 —— 现在同样的余量读起来就是「车缩在中间一小团」。
   * 实测成品照竖向只占到可用画面的 0.71，收到 0.96 之后是 0.76，收尾那张 0.78，
   * 光车架那张 0.87。再往下收，出门前自检那张会顶进底下那块清单里
   * （它的可用画面被清单占掉一截，同样的余量在它身上更紧）。
   * 收得动的底气来自冒烟里那一条：整车四张必须完整落在画幅内，过紧当场报错。
   */
  pad ??= burst ? 1.07 : 0.96;
  // 整车这一档只补三分之一的半深，理由见 aimAt 的 depth
  return aimAt(boxes, { az, el, pad, depth: 0.34 });
}

/**
 * 一步的完整机位。**先定机位，再按这个机位量取景** ——
 * 半跨度是在相机基底里量的，顺序反了就白量。
 */
export function shot(ctx, parts, o = {}) {
  /*
   * 一步装一对镜像件时（两条摇臂、两只把套、两只刹把、两条曲柄），
   * 从左边看还是从右边看**同样成立** —— 它们是对着装进来的。
   * 那就挑离上一步近的那一侧站：`near` 是上一步的方位角。
   *
   * 不挑的话就成了拿 parts[0] 的方向定生死，而那只是清单里的书写顺序。
   * 实测传动那一章因此左右横跳三次：牙盘从右看（220°）、曲柄从左看（140°）、
   * 后拨又回右边（220°）—— 每一步甩过整台车八十度，而传动本来就是一侧的事。
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
 * **绝对不能返回一个「等用户装完才兑现」的 Promise。**
 * 引擎的 go() 会 await 每一步的 enter()，而 enter 的职责只是把这一步铺开；
 * 一旦在里面等用户动手，engine.busy 就永远不落 —— 翻页、冒烟、自动路径全部卡死。
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

/*
 * 这里曾经有个 toolList()，把全车用到的扳手汇成一行挂在「拆开看看」的旁白上。
 * 撤掉了：那一行占着开场唯一一句旁白的位置，而「该拿哪一把」在开场是没用的信息 ——
 * 真正用得上它的时刻是拧到某一颗的那一下，那时各自的说明卡会说。
 */

/**
 * 拧一颗的标准铺陈：开会话，把「帮我拧上」挂上。
 *
 * 四个拧螺丝的步骤这一段本来一字不差地各写了一遍，于是 `onProgress` 的形参
 * 也各写错了一遍。这类活写一次就够。
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
