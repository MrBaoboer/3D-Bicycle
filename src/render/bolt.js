/**
 * 程序化螺丝与工具。
 *
 * **为什么要自己造螺丝**：模型里把立 Vorbau_Hope_FR_35mm 是一整块焊死网格
 * （单连通块 532 三角形），面盖那四颗螺丝根本没被单独建模，也切不出来。
 * 而「四颗按对角顺序拧」是本项目三个签名交互之一 —— 只能补建。
 * 补了螺丝，顺手把工具也程序化，省掉一整套外部素材。
 *
 * 统一约定，摆位与拧入动画都依赖它：
 *   · **螺栓**：轴向沿 +Z，头部在 +Z 端，螺纹伸向 −Z，原点落在头部底面（贴合面）。
 *     于是「原点放在零件表面」就是拧到底的样子，退出多少就沿 +Z 抬多少。
 *   · **工具**：作用端在原点，沿 −Z 插入螺栓，柄伸向 +Z。
 *     调用方写零件表面的坐标即可，不必反推一个抵消工具长度的偏移。
 */

import * as THREE from 'three';

/*
 * 三种材质全模块共用，module 级常量。
 *
 * 原先每颗螺丝各建一份：MeshStandardMaterial 的 GL program 于是被反复编译与删除，
 * 而面盖那一步一次要摆四颗 —— 卡顿正好落在「该开始拧了」的那一刻。
 * 几何仍然每次重建（它便宜），材质留着，所以 dispose 只释放几何。
 */
const MATS = {
  steel: new THREE.MeshStandardMaterial({ color: 0xb9bfc4, roughness: 0.32, metalness: 0.92 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x2f3237, roughness: 0.45, metalness: 0.75 }),
  alu: new THREE.MeshStandardMaterial({ color: 0xd6d9dd, roughness: 0.5, metalness: 0.85 }),
  grip: new THREE.MeshStandardMaterial({ color: 0xd8642a, roughness: 0.75, metalness: 0.05 }),
};

/** ISO 标准件的头部尺寸（毫米）。查表，不要现推 */
const HEAD = {
  //        头径   头高   内六角对边
  5: { d: 8.5, h: 5.0, hex: 4 },
  6: { d: 10.0, h: 6.0, hex: 5 },
  8: { d: 13.0, h: 8.0, hex: 6 },
  14: { d: 22.0, h: 9.0, hex: 6 },   // 桶轴：头大、内六角仍是 6
};

const MM = 0.001;   // 本项目 1 单位 = 1 米，标准件表是毫米

/**
 * 头部的内六角凹孔。
 * 用 Shape 的 holes 挖出来再挤出 —— 真的是个洞，受光正确。
 * 拿一块深色面片贴在头上假装凹孔，得到的读数恰好相反：不透光的实体压在表面上，
 * 眼睛读出来是凸起。
 */
function headWithSocket(rHead, hHead, acrossFlats, bevel = 0) {
  const outer = new THREE.Shape();
  outer.absarc(0, 0, rHead, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  const r = acrossFlats / Math.sqrt(3);          // 对边距 → 外接圆半径
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) hole.moveTo(x, y); else hole.lineTo(x, y);
  }
  hole.closePath();
  outer.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(outer, {
    depth: hHead, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2,
    curveSegments: 24,
  });
  // 凹孔只挖到头高的六成，底下要有肉 —— 挖穿了就成了空心管
  const floor = new THREE.Mesh(
    new THREE.CylinderGeometry(r * 1.02, r * 1.02, hHead * 0.4, 6),
    MATS.dark,
  );
  floor.rotation.x = Math.PI / 2;
  floor.position.z = hHead * 0.2;
  return { geo: g, floor };
}

/**
 * 一颗螺栓。
 * @param {'socket'|'button'|'countersunk'} kind 头型
 * @param {number} m 公称直径（毫米），见 HEAD 表
 * @param {number} lenMm 螺纹段长度（毫米）
 */
export function bolt(kind = 'socket', m = 5, lenMm = 12) {
  const spec = HEAD[m] || HEAD[5];
  const rHead = (spec.d / 2) * MM;
  const hHead = spec.h * MM;
  const rShaft = (m / 2) * MM;
  const len = lenMm * MM;
  const g = new THREE.Group();

  if (kind === 'countersunk') {
    // 90° 沉头：一个倒锥台，大端朝 +Z
    const head = new THREE.Mesh(
      new THREE.CylinderGeometry(rHead, rShaft, hHead, 24),
      MATS.steel,
    );
    head.rotation.x = Math.PI / 2;
    head.position.z = hHead / 2;
    g.add(head);
    const { floor } = headWithSocket(rHead, hHead, spec.hex * MM);
    floor.position.z = hHead * 0.55;
    g.add(floor);
    // 沉头的内六角要另外挖：锥台上不好直接布尔，用一个深色六棱柱压进去示意
    const hex = new THREE.Mesh(
      new THREE.CylinderGeometry(spec.hex * MM / Math.sqrt(3), spec.hex * MM / Math.sqrt(3), hHead * 0.66, 6),
      MATS.dark,
    );
    hex.rotation.x = Math.PI / 2;
    hex.position.z = hHead * 0.68;
    g.add(hex);
  } else {
    const bevel = kind === 'button' ? rHead * 0.28 : rHead * 0.06;
    const { geo, floor } = headWithSocket(rHead, hHead, spec.hex * MM, bevel);
    const head = new THREE.Mesh(geo, MATS.steel);
    g.add(head, floor);
    if (kind === 'button') {
      // 圆头：头顶盖一枚球冠，接缝压在倒角上看不出来
      const cap = new THREE.Mesh(
        new THREE.SphereGeometry(rHead * 1.05, 24, 10, 0, Math.PI * 2, 0, Math.PI * 0.42),
        MATS.steel,
      );
      cap.rotation.x = -Math.PI / 2;
      cap.position.z = hHead * 0.62;
      g.add(cap);
    }
  }

  // 螺纹段：一根光杆加一圈浅螺旋槽示意。真做螺纹几何在这个尺度上纯属浪费面数
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(rShaft, rShaft, len, 20),
    MATS.steel,
  );
  shaft.rotation.x = Math.PI / 2;
  shaft.position.z = -len / 2;
  g.add(shaft);

  const turns = Math.max(3, Math.round(lenMm / 1.2));
  const pts = [];
  for (let i = 0; i <= turns * 12; i++) {
    const t = i / (turns * 12);
    const a = t * turns * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * rShaft * 1.005, Math.sin(a) * rShaft * 1.005, -t * len));
  }
  const helix = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), turns * 12, rShaft * 0.09, 5, false),
    MATS.dark,
  );
  g.add(helix);

    g.userData.spec = { kind, m, lenMm, hex: spec.hex };
  return g;
}

/** L 形内六角扳手。作用端在原点沿 −Z，长柄伸向 +Z */
export function hexKey(mm = 5) {
  const r = (mm / Math.sqrt(3)) * MM;
  const long = mm * 18 * MM;
  const short = long * 0.35;
  const g = new THREE.Group();

  const arm = new THREE.Mesh(new THREE.CylinderGeometry(r, r, long, 6), MATS.steel);
  arm.rotation.x = Math.PI / 2;
  arm.position.z = long / 2;
  g.add(arm);

  const head = new THREE.Mesh(new THREE.CylinderGeometry(r, r, short, 6), MATS.steel);
  head.rotation.z = Math.PI / 2;
  head.position.set(short / 2, 0, long);
  g.add(head);

  const ball = new THREE.Mesh(new THREE.SphereGeometry(r * 1.05, 12, 8), MATS.steel);
  ball.position.z = -r * 0.2;
  g.add(ball);

    return g;
}

/** 15 mm 薄口脚踏扳手。开口在原点，柄伸向 +X */
export function pedalWrench() {
  const g = new THREE.Group();
  const th = 3.2 * MM;
  const openW = 15 * MM;

  const jaw = new THREE.Shape();
  const R = 13 * MM;
  jaw.absarc(0, 0, R, Math.PI * 0.22, Math.PI * 1.78, false);
  const cut = new THREE.Path();
  cut.moveTo(R, openW / 2);
  cut.lineTo(-openW * 0.1, openW / 2);
  cut.lineTo(-openW * 0.1, -openW / 2);
  cut.lineTo(R, -openW / 2);
  cut.closePath();
  jaw.holes.push(cut);
  const head = new THREE.Mesh(
    new THREE.ExtrudeGeometry(jaw, { depth: th, bevelEnabled: false, curveSegments: 20 }),
    MATS.steel,
  );
  head.position.z = -th / 2;
  g.add(head);

  const handle = new THREE.Mesh(new THREE.BoxGeometry(150 * MM, 11 * MM, th), MATS.steel);
  handle.position.set(-80 * MM, 0, 0);
  g.add(handle);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(70 * MM, 13 * MM, th * 1.3), MATS.grip);
  grip.position.set(-120 * MM, 0, 0);
  g.add(grip);

    return g;
}

const TOOL_MAKERS = {
  'hex-4': () => hexKey(4),
  'hex-5': () => hexKey(5),
  'hex-6': () => hexKey(6),
  'wrench-15': () => pedalWrench(),
};

const Z = new THREE.Vector3(0, 0, 1);

/**
 * 场景里的螺丝与工具管理器（ctx.bolts）。
 *
 * 摆位：把螺栓的 +Z 对齐到 **−axis** —— 清单里的 axis 是「拧入方向」，
 * 而螺栓的螺纹伸向自身 −Z，所以头朝外就是 +Z 对着 −axis。
 * 用 setFromUnitVectors，不要凑欧拉角：两个轴一起写下去，
 * 圆柱的轴向会被欧拉合成顺序带偏，整颗螺丝歪着长出来。
 */
export class Bolts {
  /**
   * @param {THREE.Scene} scene
   * @param {{fastener(id:string):object}} [bom] 有它才能按 id 取件 —— 见 spawn()
   */
  constructor(scene, bom = null) {
    this.scene = scene;
    this.bom = bom;
    /** @type {Map<string, THREE.Object3D>} */
    this.items = new Map();
    /** @type {Map<string, THREE.Object3D>} */
    this.tools = new Map();
  }

  /**
   * id 与紧固件对象都收。
   *
   * 契约（docs/CONTRACT.md）写的是 `spawn(fastenerId)`，而步骤脚本手头常常已经有
   * 那个对象了 —— 两种都认，调用方不必为此各写一次查表。
   */
  #fastener(x) {
    if (typeof x !== 'string') return x;
    if (!this.bom) throw new Error(`[bolts] 传的是紧固件 id "${x}"，但这个 Bolts 没接清单，查不了`);
    return this.bom.fastener(x);
  }

  /** 按清单里的紧固件把螺栓摆到位。传 id 或紧固件对象都行 */
  spawn(idOrFastener) {
    const f = this.#fastener(idOrFastener);
    if (this.items.has(f.id)) return this.items.get(f.id);
    const kind = /Senkkopf|countersunk|沉头/.test(f.name) ? 'countersunk'
      : /桶轴|axle/.test(f.id) ? 'button' : 'socket';
    const m = Number((f.spec || 'M5').match(/M(\d+)/)?.[1] || 5);
    const o = bolt(kind, m, kind === 'button' ? 24 : 12);

    const axis = f.v ? f.v.axis : new THREE.Vector3(...f.axis);
    const point = f.v ? f.v.point : new THREE.Vector3(...f.point);
    o.quaternion.setFromUnitVectors(Z, axis.clone().normalize().negate());
    o.position.copy(point);
    o.userData.seatPos = point.clone();
    o.userData.axis = axis.clone().normalize();
    o.name = `bolt:${f.id}`;

    this.scene.add(o);
    this.items.set(f.id, o);
    return o;
  }

  get(id) { return this.items.get(id); }

  /**
   * 进给：0 = 完全退出（沿 −axis 退开一个螺纹长度），1 = 拧到底。
   * 拧入方向是 axis，所以退出就是沿 −axis 抬起来。
   */
  setSeated(id, ratio) {
    const o = this.items.get(id);
    if (!o) return;
    const back = (1 - Math.max(0, Math.min(1, ratio))) * 0.018;
    o.position.copy(o.userData.seatPos).addScaledVector(o.userData.axis, -back);
  }

  /** 让螺栓绕自身轴转到某个角度（弧度），拧的动画用 */
  setSpin(id, rad) {
    const o = this.items.get(id);
    if (!o) return;
    const q = new THREE.Quaternion().setFromAxisAngle(o.userData.axis, rad);
    o.quaternion.setFromUnitVectors(Z, o.userData.axis.clone().negate()).premultiply(q);
  }

  /**
   * 取一件工具，同一件复用 —— 每次新建会把 GL program 反复编译一遍。
   * 建出来先藏着；要摆到画面上走 useTool()。
   */
  tool(kind) {
    if (this.tools.has(kind)) return this.tools.get(kind);
    const make = TOOL_MAKERS[kind] || TOOL_MAKERS['hex-5'];
    const o = make();
    o.visible = false;
    this.scene.add(o);
    this.tools.set(kind, o);
    return o;
  }

  /**
   * 亮出这一件，其余收起。
   *
   * 工具同时是「该拧的是这一颗」的标记，比任何箭头都直白 —— 它不出现，
   * 拧螺丝那几步就只剩一颗孤零零的螺栓头，看不出手该搭在哪儿。
   * 一次只留一件在场上：换螺栓时若不收，上一把扳手会留在原地当障碍物。
   */
  useTool(kind) {
    const o = this.tool(kind);
    for (const t of this.tools.values()) t.visible = t === o;
    return o;
  }

  hideTools() { for (const t of this.tools.values()) t.visible = false; }

  remove(id) {
    const o = this.items.get(id);
    if (!o) return;
    o.removeFromParent();
    o.traverse((n) => n.geometry?.dispose?.());   // 材质是共用的，绝不能 dispose
    this.items.delete(id);
  }

  clear() { for (const id of [...this.items.keys()]) this.remove(id); }

  dispose() {
    this.clear();
    for (const t of this.tools.values()) {
      t.removeFromParent();
      t.traverse((n) => n.geometry?.dispose?.());
    }
    this.tools.clear();
  }
}
