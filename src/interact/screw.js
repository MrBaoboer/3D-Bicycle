/**
 * 旋入与扭矩
 *
 * 两段，以「拧到底」为界：
 *   旋入 —— 绕螺栓轴做圆周拖动，转一圈进一个螺距，转满 turns 圈到底；
 *   扭矩 —— 到底之后继续转就是加载。这一段螺栓几乎不动，扭矩却在陡升：
 *           手指还在走、螺栓不走，「上劲」这件事只能这么说出来。
 *
 * 左脚踏是反牙，这正是本项目要教会的一件事，所以**允许拧错**：
 * 往错方向拧满两圈才停住、发涩、回退半圈，话留给步骤脚本去说。
 * 一上来就拦着不让拧，用户学不到任何东西，只会以为程序坏了。
 *
 * 与 render/bolts.js 的分工（这里只摆位与旋转，不碰几何与材质）：
 *   spawn(id)   这颗螺栓，局部原点 = 螺栓头中心，挂在 stage.scene 下，姿态即就位姿态；
 *   tool(kind)  这件工具，咬合端在原点、机身朝 +Z 生长。
 * 位置一律按清单的 point / axis 现算 —— 不依赖对方把件摆在哪儿，只借它的初始朝向。
 */

import * as THREE from 'three';
import { tween, Ease, wait } from '../util/tween.js';

const TAU = Math.PI * 2;

/**
 * 拧到底之后再转这么多，扭矩就从零走到滑丝。
 * 真扳手上这一段只有几十度，但手指在屏幕上分辨不了几十度 ——
 * 给到一圈多，绿区才有五十来度的宽度，够人听见「咔」再松手。
 */
const LOAD_SPAN = 1.25 * TAU;

/** 扭矩曲线：前段轻快、末段陡升，与 Ease.ignite 同一个路数 */
const LOAD_CURVE = 2.6;

/**
 * 加载段螺栓真正转过的角度，以及它的曲线（越拧越慢）。
 * 手指走一圈多，螺栓只走这么点 —— 「转不动了」全靠这个比例传达。
 */
const LOAD_SPIN = 0.3 * TAU;
const SPIN_CURVE = 0.6;

/** 往错方向拧到这里就停住；停住之后回退半圈 */
const WRONG_LIMIT = 2 * TAU;
const REBOUND = Math.PI;

/**
 * |视线·螺栓轴| 低于这个值就改用切向位移读角度。
 * 螺栓轴几乎躺在屏幕平面里时，拖拽平面与视线接近平行，射线与它的交点会跑到几十米外，
 * 极角随手抖跳几十度 —— 那一档必须换算法。
 */
const EDGE_ON = 0.3;

/** 命中半径（像素）：M5 的螺栓头在屏幕上只有几个像素，按精确命中没人按得中 */
const PICK_PX = 64;

/** 角度差归一到 ±π 之内 —— 极角每转过一圈都要跨一次 ±π，不归一就会跳一整圈 */
const wrap = (d) => d - TAU * Math.round(d / TAU);

const clamp01 = (x) => Math.max(0, Math.min(1, x));

export class Screw {
  /** @param {{stage:any, bom:any, bolts:any, hud:any, sfx:any, state:any, fx?:any}} ctx */
  constructor(ctx) {
    this.ctx = ctx;
    this.ray = new THREE.Raycaster();
    this.ptr = new THREE.Vector2();
    this.session = null;
    this.bolt = null;        // 手上正在拧的那一颗
    this.tool = null;
    this.active = null;      // 一次拖动
    this.grabbed = false;
    this.busy = false;       // 回退与自动播放期间不接手
    /** id → 就位姿态：第一次见到时记下，之后一直拿它当基准，免得把自己转过的角度又叠一遍 */
    this.rest = new Map();
    this._bind();
  }

  _bind() {
    const c = this.ctx.stage.canvas;
    this._down = (e) => this.onDown(e);
    this._move = (e) => this.onMove(e);
    this._up = (e) => this.onUp(e);
    c.addEventListener('pointerdown', this._down);
    addEventListener('pointermove', this._move);
    addEventListener('pointerup', this._up);
    addEventListener('pointercancel', this._up);
  }

  dispose() {
    const c = this.ctx.stage.canvas;
    c.removeEventListener('pointerdown', this._down);
    removeEventListener('pointermove', this._move);
    removeEventListener('pointerup', this._up);
    removeEventListener('pointercancel', this._up);
  }

  // ══ 对外 ═══════════════════════════════════════════════════════════

  /**
   * 拧一颗。
   * @param {object} o
   * @param {string} o.fastenerId
   * @param {(nm:number, id:string)=>void} [o.onTight]    到扭矩下限，「咔」的那一下
   * @param {(id:string)=>void} [o.onStrip]               滑丝。只记下，不作惩罚
   * @param {(id:string)=>void} [o.onWrongWay]            反方向拧满两圈
   * @param {(p:object)=>void} [o.onProgress] { id, phase, depth, turns, nm, zone } —— 喂扭矩表
   */
  begin(o) { return this._open([o.fastenerId], o); }

  /**
   * 拧一组（面盖那四颗）。四颗同时可拧，拧哪一颗由用户按下去决定。
   * @param {object} o
   * @param {string} o.group
   * @param {(id:string, info:{orderOk:boolean, nm:number, stripped:boolean})=>void} [o.onEach]
   * @param {()=>void} [o.onAll]
   *   order 为 cross 时校验对角顺序：**不拦**，只把 orderOk 交给步骤脚本，
   *   并把 ctx.state.crossOrderOk 记成 false。
   */
  beginGroup(o) {
    const ids = this.ctx.bom.fasteners.filter((f) => f.group === o.group).map((f) => f.id);
    return this._open(ids, o);
  }

  cancel() {
    this.session = null;
    this.active = null;
    this.bolt = null;
    this.busy = false;
    if (this.tool) { this.tool.removeFromParent(); this.tool = null; }
    // 翻页可能正好落在一次拖拽中间 —— 手指还按着就交还轨道控制，剩下半程会变成转镜头。留给 onUp
    if (!this.grabbed) this.ctx.stage.controls.enabled = true;
  }

  /**
   * 降级路径：自动拧到扭矩区间中点。跳过的只是手感，该看到、该听到的一样不少。
   * 不给 id 就把这一组剩下的挨个拧完（按对角顺序 —— 示范不能自己拧错）。
   */
  async autoRun(fastenerId) {
    if (!this.session && fastenerId) this._open([fastenerId], {});
    const s = this.session;
    if (!s) return;
    const ids = fastenerId ? [fastenerId] : this._crossOrder([...s.pending]);
    this.busy = true;
    for (const id of ids) {
      if (this.session !== s || !s.pending.has(id)) continue;
      this._use(id);
      const b = s.rigs.get(id);
      const mid = (b.f.torque[0] + b.f.torque[1]) / 2;
      const top = b.feedAngle + LOAD_SPAN * Math.pow(mid / b.f.strip, 1 / LOAD_CURVE);
      const from = b.progress;
      await tween(0.9, (k) => this._turn(from + (b.feedAngle - from) * k), { ease: Ease.inOutQuad });
      await tween(0.5, (k) => this._turn(b.feedAngle + (top - b.feedAngle) * k), { ease: Ease.outQuad });
      this._finish(id);
      await wait(0.25);
    }
    this.busy = false;
  }

  // ══ 会话 ═══════════════════════════════════════════════════════════

  _open(ids, o) {
    this.cancel();
    const list = ids.filter(Boolean);
    const first = this.ctx.bom.fastener(list[0]);
    const s = {
      ...o,
      rigs: new Map(),
      pending: new Set(),
      done: [],
      fails: 0,
      crossOk: true,
      group: o.group ?? first?.group,
      order: first?.order ?? 'any',
    };
    this.session = s;
    for (const id of list) {
      // 上一轮已经拧好的（往回翻又翻回来）就摆着，不能退回去重拧一遍
      if (this.ctx.state.fastened[id] === undefined) this._rig(id);
      else this.ctx.bolts.spawn(id);
    }
    s.total = s.pending.size;
    // 动手的步骤一开始就把机位钉死，手上对位时画面不会自己漂
    this.ctx.stage.hold(true);
    if (s.pending.size) this._use(list.find((id) => s.pending.has(id)));
    else wait(0).then(() => { if (this.session === s) s.onAll?.(); });
    return s;
  }

  /** 备好一颗：算出它的轴、进给量与极角基准，把螺栓摆到还没拧的位置 */
  _rig(id) {
    const f = this.ctx.bom.fastener(id);
    const axis = new THREE.Vector3(...f.axis).normalize();
    const obj = this.ctx.bolts.spawn(id);
    if (!this.rest.has(id)) this.rest.set(id, obj.quaternion.clone());

    // 极角的零向量：取一个与轴不平行的方向去掉轴向分量。u0 × 轴向 的次序定死右手为正
    const u0 = Math.abs(axis.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    u0.addScaledVector(axis, -u0.dot(axis)).normalize();

    const b = {
      f, axis, obj,
      head: new THREE.Vector3(...f.point),
      u0,
      v0: new THREE.Vector3().crossVectors(axis, u0),
      // 右牙顺时针进、左牙逆时针进：把「拧紧」统一成正方向，后面的算术就不必再分两种
      sense: f.thread === 'left' ? -1 : 1,
      feed: (f.turns * f.pitch) / 1000,        // 清单的螺距是 mm，世界单位是 m
      feedAngle: f.turns * TAU,
      rest: this.rest.get(id),
      // 工具的机身朝 +Z 长，掉头对着螺栓头，于是 +Z 转到 −轴向
      toolRest: new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 0, 1), axis.clone().negate(),
      ),
      progress: 0, nm: 0, seated: false, tight: false, stripped: false,
    };
    this.session.rigs.set(id, b);
    this.session.pending.add(id);
    this._place(b);
    return b;
  }

  /** 把工具挪到这一颗上 —— 它同时是「该拧这颗」的标记，比任何箭头都直白 */
  _use(id) {
    const b = this.session?.rigs.get(id);
    if (!b) return;
    this.bolt = b;
    const t = this.ctx.bolts.tool(b.f.tool);
    if (t !== this.tool) { this.tool?.removeFromParent(); this.tool = t; }
    if (t && !t.parent) this.ctx.stage.scene.add(t);
    this._place(b);
    this.ctx.fx?.ring?.(b.obj.position.clone(), b.axis.clone());
  }

  // ══ 一颗的状态 → 画面 ═══════════════════════════════════════════════

  /** 加载量 0..1，1 就是滑丝 */
  _load(b) { return clamp01((b.progress - b.feedAngle) / LOAD_SPAN); }

  _place(b) {
    const seat = Math.max(0, Math.min(b.progress, b.feedAngle));
    const spin = b.progress <= b.feedAngle
      ? b.progress
      : b.feedAngle + LOAD_SPIN * Math.pow(this._load(b), SPIN_CURVE);
    const rot = new THREE.Quaternion().setFromAxisAngle(b.axis, b.sense * spin);
    b.obj.quaternion.copy(b.rest).premultiply(rot);
    b.obj.position.copy(b.head).addScaledVector(b.axis, (seat / b.feedAngle - 1) * b.feed);
    if (this.tool && this.bolt === b) {
      this.tool.position.copy(b.obj.position);
      this.tool.quaternion.copy(b.toolRest).premultiply(rot);
    }
  }

  _report(b) {
    const f = b.f;
    const depth = Math.max(0, Math.min(b.progress, b.feedAngle)) / b.feedAngle;
    const zone = b.stripped ? 'strip'
      : b.nm >= f.torque[1] ? 'over'
        : b.nm >= f.torque[0] ? 'green'
          : depth >= 1 ? 'soft' : 'run';
    this.session?.onProgress?.({
      id: f.id, phase: depth >= 1 ? 'load' : 'run',
      depth, turns: b.progress / TAU, nm: b.nm, zone,
    });
  }

  /**
   * 转到某个角度（正 = 拧紧方向，与牙向无关）。
   * 声音、扭矩、到点、滑丝、拧反全在这一处发生 —— 手拖与自动播放走的是同一条路，
   * 「帮我拧上」于是不会漏掉任何一记该响的声音。
   */
  _turn(next) {
    const b = this.bolt;
    const s = this.session;
    if (!b || !s) return;
    const f = b.f;
    const wrongWay = next <= -WRONG_LIMIT;
    const prev = b.progress;
    b.progress = Math.max(-WRONG_LIMIT, Math.min(next, b.feedAngle + LOAD_SPAN));
    b.nm = f.strip * Math.pow(this._load(b), LOAD_CURVE);
    this._place(b);

    // 每半圈过一次牙就响一记；往错方向拧的那一路压低音高，越拧越涩
    if (Math.floor(prev / Math.PI) !== Math.floor(b.progress / Math.PI)) {
      const depth = clamp01(b.progress / b.feedAngle);
      this.ctx.sfx.play('THREAD_TURN', b.progress < 0
        ? { depth: 1, pitch: -5, gain: 1.2 }
        : { depth, pitch: depth * 3 });
    }
    if (!b.seated && b.progress >= b.feedAngle) {
      b.seated = true;
      this.ctx.sfx.play('SEAT_IN', { gain: 0.3, pitch: 7, slide: 0.03 });
    }
    this._report(b);

    if (!b.tight && b.nm >= f.torque[0]) {
      b.tight = true;
      this.ctx.sfx.play('TORQUE_CLICK');
      this.ctx.fx?.spark?.(b.obj.position.clone());
      s.onTight?.(b.nm, f.id);
    }
    if (!b.stripped && b.nm >= f.strip) {
      b.stripped = true;
      this.ctx.sfx.play('THREAD_TURN', { depth: 1, pitch: -8, gain: 1.4, dur: 0.6 });
      this.ctx.sfx.play('WRONG', { delay: 0.1 });
      s.onStrip?.(f.id);
      this._finish(f.id);            // 牙没了，这一颗到此为止；怎么说由步骤脚本决定
      return;
    }
    if (wrongWay) this._wrongWay();
  }

  /** 拧反了：停住、发涩、回退半圈，然后把话交出去 */
  async _wrongWay() {
    const b = this.bolt;
    const s = this.session;
    if (!b || !s || this.busy) return;
    this.busy = true;
    this.active = null;              // 手指还按着 —— 轨道控制留到 onUp 再交还
    this.ctx.sfx.play('THREAD_TURN', { depth: 1, pitch: -6, gain: 1.3, dur: 0.5 });
    this.ctx.sfx.play('WRONG', { delay: 0.06 });
    this.ctx.state.wrongThread = this.ctx.state.wrongThread + 1;
    s.fails += 1;

    const from = b.progress;
    await tween(0.34, (k) => {
      b.progress = from + REBOUND * k;
      this._place(b);
      this._report(b);
    }, { ease: Ease.outQuad });

    this.busy = false;
    s.onWrongWay?.(b.f.id);
    this._offerHelp();
  }

  /** 这一颗到此为止（拧到点松手，或者滑丝） */
  _finish(id) {
    const s = this.session;
    if (!s || !s.pending.has(id)) return;
    const b = s.rigs.get(id);
    s.pending.delete(id);

    const orderOk = this._orderOk(id);
    s.done.push(id);
    if (!orderOk) { s.crossOk = false; this.ctx.state.crossOrderOk = false; }

    // 滑丝的那一颗照样记进 fastened：它确实拧不动了，步骤的完成计数不该卡在这儿
    this.ctx.state.fastened = { ...this.ctx.state.fastened, [id]: b.nm };
    if (b.stripped) this.ctx.state.stripped = { ...this.ctx.state.stripped, [id]: true };
    this.ctx.fx?.ring?.(b.obj.position.clone(), b.axis.clone());

    s.onEach?.(id, { orderOk, nm: b.nm, stripped: b.stripped, index: s.done.length, total: s.total });

    const next = [...s.pending][0];
    if (next) { this._use(next); return; }
    if (s.order === 'cross' && s.crossOk) this.ctx.state.crossOrderOk = true;
    this.bolt = null;
    if (this.tool) { this.tool.removeFromParent(); this.tool = null; }
    s.onAll?.();
  }

  /** 对角顺序：每一对的头一颗拧哪个都行，第二颗必须是它的对角 */
  _orderOk(id) {
    const s = this.session;
    if (s.order !== 'cross') return true;
    const n = s.done.length;
    if (n % 2 === 0) return true;
    return this._mate(s.done[n - 1]) === id;
  }

  _mate(id) {
    for (const pair of this.ctx.bom.crossPairs(this.session.group) || []) {
      const [a, b] = Array.isArray(pair) ? pair : [pair.a, pair.b];
      if (a === id) return b;
      if (b === id) return a;
    }
    return null;
  }

  _crossOrder(ids) {
    if (this.session.order !== 'cross') return ids;
    const left = new Set(ids);
    const out = [];
    for (const id of ids) {
      if (!left.has(id)) continue;
      left.delete(id); out.push(id);
      const m = this._mate(id);
      if (m && left.has(m)) { left.delete(m); out.push(m); }
    }
    return out;
  }

  _offerHelp() {
    const s = this.session;
    if (!s || s.fails < 3) return;
    this.ctx.hud.setAlts([{ label: '帮我拧上', onClick: () => this.autoRun() }]);
  }

  // ══ 圆周拖动 ═══════════════════════════════════════════════════════

  _cast(e) {
    const r = this.ctx.stage.canvas.getBoundingClientRect();
    this.ptr.set(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1,
    );
    this.ray.setFromCamera(this.ptr, this.ctx.stage.camera);
    return this.ray.ray;
  }

  _px(e) {
    const r = this.ctx.stage.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  _screen(v) {
    const p = v.clone().project(this.ctx.stage.camera);
    const r = this.ctx.stage.canvas.getBoundingClientRect();
    return { x: (p.x * 0.5 + 0.5) * r.width, y: (0.5 - p.y * 0.5) * r.height, behind: p.z > 1 };
  }

  /** 指针离哪颗待拧螺栓的头最近就是哪颗；都够不着时，打中工具也算 */
  _pick(p) {
    let best = null;
    let bestD = PICK_PX;
    for (const id of this.session.pending) {
      const b = this.session.rigs.get(id);
      const c = this._screen(b.obj.position);
      if (c.behind) continue;
      const d = Math.hypot(p.x - c.x, p.y - c.y);
      if (d < bestD) { bestD = d; best = b; }
    }
    if (best) return best;
    return this.tool && this.ray.intersectObject(this.tool, true).length ? this.bolt : null;
  }

  /** 极角：指针在「以螺栓轴为法线、过螺栓头」那个平面上相对轴心的方位 */
  _polar(b, P) {
    const w = P.clone().sub(b.obj.position);
    const x = w.dot(b.u0);
    const y = w.dot(b.v0);
    if (x * x + y * y < 1e-8) return null;    // 指针正压在轴心上，极角没有意义
    return Math.atan2(y, x);
  }

  onDown(e) {
    const s = this.session;
    if (!s || this.busy || this.ctx.hud.modalOpen) return;
    const ray = this._cast(e);
    const p = this._px(e);
    const b = this._pick(p);
    if (!b) return;
    if (b !== this.bolt) this._use(b.f.id);

    // 读角度的方式在按下这一刻定死，中途不换：正转着突然换算法，角度会跳一大截
    const a = { pid: e.pointerId, gained: 0 };
    if (Math.abs(ray.direction.dot(b.axis)) > EDGE_ON) {
      a.plane = new THREE.Plane().setFromNormalAndCoplanarPoint(b.axis, b.obj.position);
      const P = new THREE.Vector3();
      if (!ray.intersectPlane(a.plane, P)) return;
      a.theta = this._polar(b, P);
      if (a.theta === null) return;
    } else {
      // 轴躺在屏幕平面里：拖拽平面几乎与视线平行，交点跑到几十米外。
      // 退化成「沿屏幕切向的位移除以半径」—— 切向由轴的屏幕投影转 90° 得到，
      // 恰好在这一档最稳，而半径取按下处离轴心的距离，手越往外抓转得越细。
      const c = this._screen(b.obj.position);
      const tip = this._screen(b.obj.position.clone().addScaledVector(b.axis, 0.05));
      const A = new THREE.Vector2(tip.x - c.x, tip.y - c.y);
      if (A.lengthSq() < 1e-6) return;
      A.normalize();
      a.tangent = new THREE.Vector2(-A.y, A.x);   // 屏幕 y 朝下，这个方向就是绕轴的右手转向
      a.radius = Math.max(PICK_PX, Math.hypot(p.x - c.x, p.y - c.y));
      a.px = p;
    }

    this.active = a;
    this.grabbed = true;
    this.ctx.stage.controls.enabled = false;      // 按下即夺权
    e.preventDefault();
  }

  onMove(e) {
    const a = this.active;
    const b = this.bolt;
    if (!a || !b || e.pointerId !== a.pid) return;

    let d;
    if (a.plane) {
      const ray = this._cast(e);
      const P = new THREE.Vector3();
      if (!ray.intersectPlane(a.plane, P)) return;
      const th = this._polar(b, P);
      if (th === null) return;
      d = wrap(th - a.theta);
      a.theta = th;
    } else {
      const p = this._px(e);
      d = ((p.x - a.px.x) * a.tangent.x + (p.y - a.px.y) * a.tangent.y) / a.radius;
      a.px = p;
    }

    a.gained += b.sense * d;
    this._turn(b.progress + b.sense * d);
  }

  onUp(e) {
    // 松手才交还 —— 且必须排在提前 return 之前，拧反那一路也要收得回来
    if (this.grabbed && (!this.active || e.pointerId === this.active.pid)) {
      this.grabbed = false;
      this.ctx.stage.controls.enabled = true;
    }
    const a = this.active;
    const b = this.bolt;
    const s = this.session;
    this.active = null;
    if (!a || !b || !s) return;

    if (b.tight || b.stripped) { this._finish(b.f.id); return; }
    if (a.gained < TAU / 4) { s.fails += 1; this._offerHelp(); return; }
    if (b.progress >= b.feedAngle && !s.hinted) {
      s.hinted = true;
      this.ctx.hud.toast('到底了，接着往同一个方向转就上劲');
    }
  }
}
