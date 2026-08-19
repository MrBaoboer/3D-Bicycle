/**
 * 一自由度平移装配 —— 前轮、车把、座管
 *
 * 方向、行程、吸附阈值一概来自 assets/bike.manifest.json 的 install 段，
 * 这里不写死任何一个数：清单是单一出处，改那边就等于改了所有步骤。
 *
 * 只有一个合法方向，错误方向阻尼回弹并说明为什么。装车本来就没有第二条路径，
 * 放开成自由 6DoF 只会让人以为自己看错了图。
 */

import * as THREE from 'three';
import { tween, Ease, wait } from '../util/tween.js';

/**
 * 判据一律按 gap 折算，不写绝对距离。
 * 这台车上一件的行程从 60 mm（油管）到 220 mm（座管）差着近四倍 ——
 * 换成一个固定的毫米阈值，行程长的件会一碰就判成方向错，短的则永远判不出来。
 */
const K = {
  MOVED: 0.02,       // 位移超过 gap 的这个比例才算拖过，用来把单纯的点击摘出去
  PERP: 0.35,        // 垂直分量累计超过 gap 的这个比例
  PERP_RATIO: 2.2,   // 且要压过轴向累计这么多倍，才判成方向错了
  RELAX: 0.2,        // 连败三次后吸附放宽到 gap 的这个比例
  BACK: -0.2,        // 允许往预备位后面再拖这么多（比例）—— 到头就顶死不像零件，像墙
};

/** 到位回弹的绝对距离（米）。按比例给的话行程长的件回弹更大，那是弹簧不是插到底 */
const BOUNCE = 0.0015;

/** 运动轴与视线的夹角余弦超过这个数就别接管：拖拽平面近乎平行于视线，落点会满屏乱跳 */
const TOO_ALIGNED = 0.97;

/** 与界面主色同一个橙（styles.css 的 --accent）—— 高亮和按钮说的是同一件事 */
const ACCENT = 0xd8642a;

export class Slide {
  /** @param {{stage:any, bike:any, bom:any, hud:any, sfx:any, guides:any, state:any}} ctx */
  constructor(ctx) {
    this.ctx = ctx;
    this.ray = new THREE.Raycaster();
    this.ptr = new THREE.Vector2();
    /** @type {Map<string, object>} 件 id → 备好的件。父级基底与装配位都不会变，量一次就够 */
    this._rigs = new Map();
    /** 当前这一次装配任务 */
    this.session = null;
    /** 当前这一次拖拽 */
    this.active = null;
    /** 手指还按着没有 —— 交还轨道控制的唯一依据 */
    this.grabbed = false;
    this.#bind();
  }

  #bind() {
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
    this.cancel();
    const c = this.ctx.stage.canvas;
    c.removeEventListener('pointerdown', this._down);
    removeEventListener('pointermove', this._move);
    removeEventListener('pointerup', this._up);
    removeEventListener('pointercancel', this._up);
  }

  /**
   * 开始一次装配。
   * @param {object} o
   * @param {string|string[]} o.partId 清单里的件 id；一步装不止一件时给数组
   * @param {(id:string, seated:number, total:number)=>void} [o.onSeat] 单件到位
   * @param {()=>void} [o.onAll] 全部到位
   * @param {string} [o.wrongHint] 方向错了时说什么
   * @param {string} [o.sound] 坐实时放哪一记，默认 SEAT_IN。
   *   轮子落进勾爪比座管滑进立管沉，两者共用一份配方、只差增益，见 audio/sfx.js 的别名表
   * @param {number} [o.glow] 待装件的自发光强度，默认 0.1（进了吸附范围三倍）。
   *   细长的深色件要调高：两根黑油管贴在黑碳纤维车架上，0.1 那一档等于没亮
   * @param {Object<string,string>} [o.follow] 从动件 → 驱动件。两件在台面上已连成一体
   *   （直装牙盘锁在右曲柄上），从动件不单独拖：抓哪件都驱动整组、同一个 u 走完全程、
   *   一起记账。前提是两件在清单里同 dir 同 gap，飞行中相对位置才不变。
   */
  begin({ partId, onSeat, onAll, wrongHint, sound, glow = 0.1, follow = null } = {}) {
    this.cancel();
    const ids = Array.isArray(partId) ? [...partId] : [partId];
    const items = new Map();
    const owner = new Map();
    for (const id of ids) {
      const rig = this.#rig(id);
      // 备件是缓存的，而 #fail() 会放宽 snap —— 不还原的话，上一次连败三次
      // 放宽的吸附范围会跟着这件一路传到后面每一次装配
      rig.snap = this.ctx.bom.part(id).install.snap;
      items.set(id, rig);
      for (const n of rig.nodes) owner.set(n.obj, id);
    }
    const followers = new Map(Object.entries(follow ?? {}));
    this.session = {
      items, owner, followers, pending: new Set(ids.filter((id) => !followers.has(id))),
      total: ids.length, seated: 0,
      fails: 0, offered: false, onSeat, onAll, wrongHint, sound: sound || 'SEAT_IN', glow,
    };
    for (const rig of items.values()) this.#setU(rig, 0);
    this.#pulse();
    this.#guide();
    // 动手的步骤一开始就把机位钉死，手上对位时画面不能自己漂
    this.ctx.stage.hold(true);
    return this.session;
  }

  /**
   * 收掉这一次装配。没装上的件放回原位 —— 翻页永远不被拦住，
   * 零件不能悬在半空跟着后面的步骤一路走下去。
   */
  cancel() {
    const s = this.session;
    this.session = null;
    this.active = null;
    if (s) {
      for (const id of s.pending) this.#setU(s.items.get(id), 1);
      for (const [f] of s.followers ?? []) this.#setU(s.items.get(f), 1);
      this.ctx.guides?.clear();
    }
    // 翻页可能正落在一次拖拽中间：手指还按着就交还轨道控制，剩下半程会变成转镜头。留给 onUp
    if (!this.grabbed) this.ctx.stage.controls.enabled = true;
  }

  /**
   * 这个节点的**装配位**，只认第一次见到它时的那个值。
   *
   * 不能拿「现在在哪儿」当装配位：一件被摆到预备位之后再备一次件，
   * 记下的就是预备位，于是「装到位」会停在离真正位置一个 gap 的地方，
   * 而且每备一次就再偏一截。加载完成时全车是合装态，那一帧的值才是对的。
   */
  #home(obj) {
    if (!obj.userData.homePos) obj.userData.homePos = obj.position.clone();
    return obj.userData.homePos;
  }

  /**
   * 把一个 BOM 件备好。一件可能对应多个节点（车把是把横、把套、刹把共五个），
   * 整组一起动才不会散架。
   *
   * 位移在各节点**自己的父空间**里算：清单给的是世界方向，而节点挂在
   * 带旋转的父级下面，基底不是单位阵 —— 世界向量直接加到 position 上，
   * 件会沿无关方向飞出车外。用两次 worldToLocal 相减取出世界位移
   * 在父空间里的样子，父级带缩放也算得对。
   */
  #rig(id) {
    const hit = this._rigs.get(id);
    if (hit) return hit;

    const part = this.ctx.bom.part(id);
    if (!part?.install) throw new Error(`[slide] 清单里没有 ${id}，或它缺 install 段`);
    const { dir, gap, snap } = part.install;
    const d = new THREE.Vector3(...dir).normalize();

    const nodes = part.nodes.map((name) => {
      const obj = this.ctx.bike.get(name);
      let step = d.clone();
      // 世界向量 → 父空间向量的线性部分。爆炸视图要沿任意方向推，不只沿装配轴，
      // 所以这里存整个基底而不只是换算好的那一个向量
      let basis = new THREE.Matrix3();
      if (obj.parent) {
        obj.parent.updateWorldMatrix(true, false);
        const o = obj.parent.worldToLocal(new THREE.Vector3());
        step = obj.parent.worldToLocal(d.clone()).sub(o);
        basis.setFromMatrix4(new THREE.Matrix4().copy(obj.parent.matrixWorld).invert());
      }
      return { obj, home: this.#home(obj), step, basis };
    });

    const rig = { id, name: part.name, dir: d, gap, snap, nodes, center: null, half: 0, u: 1 };

    // 形心要在**合装态**下量：件此刻可能正停在预备位，照那个量出来的中心
    // 会把方向箭头再往外推一个 gap，指到车外面去
    this.#setU(rig, 1);
    const box = new THREE.Box3();
    for (const n of nodes) box.union(new THREE.Box3().setFromObject(n.obj));
    rig.center = box.isEmpty()
      ? nodes[0].obj.getWorldPosition(new THREE.Vector3())
      : box.getCenter(new THREE.Vector3());
    // 沿装配方向的半深 —— 箭头要摆在件的前沿之外，不然它就是画在件身上的一道条纹
    if (!box.isEmpty()) {
      const s = box.getSize(new THREE.Vector3());
      rig.half = 0.5 * (Math.abs(s.x * d.x) + Math.abs(s.y * d.y) + Math.abs(s.z * d.z));
    }
    this._rigs.set(id, rig);
    return rig;
  }

  /**
   * 不开会话，只把一件摆在预备位（u=0）与装配位（u=1）之间。
   *
   * 步骤脚本铺场与收场都走这一个入口 —— 换算到父空间这件事只有这里做对过一次，
   * 各处自己拿 install.dir 去加减世界向量，件就会飞到车外面。
   */
  park(partId, u) {
    this.#setU(this.#rig(partId), Math.max(0, Math.min(1, u)));
  }

  /**
   * 把一件从装配位沿**任意世界方向**推开 —— 爆炸视图。
   *
   * 只沿装配方向推不行：十五个侧装件的装配方向全是 ±Z，
   * 一律沿它退同一段，它们会在左右两个平面上摞成两摞。
   * 推去哪儿由 steps/util.js 的 burstOffset 算，这里只负责换算与摆位。
   * 不走 park：那个入口把 u 夹在 [0,1] 里，故意不让件飞出车外。
   *
   * @param {string} partId
   * @param {THREE.Vector3} world 相对装配位的世界位移
   */
  burst(partId, world) {
    const rig = this.#rig(partId);
    const v = new THREE.Vector3();
    for (const n of rig.nodes) {
      n.obj.position.copy(n.home).add(v.copy(world).applyMatrix3(n.basis));
    }
    rig.u = 1;   // 逻辑上仍算「在装配位」，退出时 park(id, 1) 一次归位
  }

  /** u = 1 是装到位，u = 0 是预备位（沿 -dir 退 gap）。整组节点同时写 */
  #setU(rig, u) {
    if (!rig) return;
    rig.u = u;
    const travel = (u - 1) * rig.gap;
    for (const n of rig.nodes) n.obj.position.copy(n.home).addScaledVector(n.step, travel);
  }

  /** 这一件的从动件（连成一体、跟着它动的那几件） */
  #followersOf(id) {
    const s = this.session;
    const out = [];
    for (const [f, drv] of s?.followers ?? []) if (drv === id) out.push(s.items.get(f));
    return out;
  }

  /** 交互路径一律走这里：驱动一件 = 连它的从动件一起写同一个 u */
  #drive(rig, u) {
    this.#setU(rig, u);
    for (const f of this.#followersOf(rig.id)) this.#setU(f, u);
  }

  /**
   * 每件待装的件上钉一枚箭头，指着它该去的方向。
   * 三维拖拽不是不学就会的事，没有这一枚，画面上只是一台缺零件的车。
   * 箭头摆在件身上而不是件身后 —— 前轮直径 0.7 m，摆身后就钉到地底下去了。
   */
  #guide() {
    const s = this.session;
    if (!s) return;
    this.ctx.guides?.set([...s.pending].map((id) => {
      const rig = s.items.get(id);
      /*
       * 尾巴落在件的**前沿**，不是件的形心 —— 压在形心上时箭头有一半埋在件里，
       * 读起来像画在件身上的一道橙条纹，而不是「往这边去」。
       * 但不许越过装配位（大件的半深比行程还长，比如整只前轮），
       * 越过去就成了指着车里面。
       */
      const off = Math.min(0, rig.half - rig.gap);
      return {
        pos: rig.center.clone().addScaledVector(rig.dir, off),
        dir: rig.dir.clone(),
        // 箭头按行程长短定大小。写死 5 cm 的话，它在 0.7 m 的前轮上只有轮径的 7%，
        // 混在辐条与碟片里根本看不出是个箭头 —— 而它是「往哪儿使劲」的唯一答案
        len: Math.max(0.07, rig.gap * 0.7),
      };
    }));
  }

  /** 待装的件亮一层；进了吸附范围再亮一档 —— 那是「松手就上去了」的唯一提示 */
  #pulse(near = null) {
    const s = this.session;
    if (!s) return;
    this.ctx.bike.clearHighlights?.();
    const base = s.glow;
    for (const id of s.pending) {
      for (const rig of [s.items.get(id), ...this.#followersOf(id)]) {
        for (const n of rig.nodes) {
          // 自发光只加到「认得出是同一个零件」为止。再高一档，深色主题下
          // 碳纹与阳极氧化会被烧成一片橙，看着像换了个零件而不是同一个被点亮
          this.ctx.bike.highlight?.(n.obj.name, ACCENT, Math.min(1, id === near ? base * 3 : base));
        }
      }
    }
  }

  #pick(e) {
    const s = this.session;
    const rect = this.ctx.stage.canvas.getBoundingClientRect();
    this.ptr.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.ptr.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.ray.setFromCamera(this.ptr, this.ctx.stage.camera);

    const objs = [];
    for (const [id, rig] of s.items) {
      if (!s.pending.has(s.followers?.get(id) ?? id)) continue;
      for (const n of rig.nodes) objs.push(n.obj);
    }
    const hits = this.ray.intersectObjects(objs, true);
    if (!hits.length) return null;
    // 命中的是子网格，往上走到清单登记的那个节点
    let o = hits[0].object;
    while (o && !s.owner.has(o)) o = o.parent;
    return o ? { id: s.owner.get(o), point: hits[0].point.clone() } : null;
  }

  onDown(e) {
    const s = this.session;
    if (!s || this.active || this.ctx.hud?.modalOpen) return;
    const hit = this.#pick(e);
    if (!hit) return;
    // 抓到从动件（比如牙盘）时，驱动的仍是它连着的那一件
    const rig = s.items.get(s.followers?.get(hit.id) ?? hit.id);

    const cam = this.ctx.stage.camera.getWorldDirection(new THREE.Vector3());
    // 运动轴几乎正对相机：这个角度推与不推屏幕上一个样。
    // 索性不接管指针 —— 这一下顺势成了转镜头，正是他该先做的事
    if (Math.abs(cam.dot(rig.dir)) > TOO_ALIGNED) {
      if (!s.turned) {
        s.turned = true;
        this.ctx.hud?.toast('先转一下画面，这个角度看不出推进去多少');
      }
      return;
    }

    // 拖拽平面：包含运动轴，且尽量正对相机
    const n = cam.clone().addScaledVector(rig.dir, -cam.dot(rig.dir));
    if (n.lengthSq() < 1e-6) {
      n.set(0, 0, 1).addScaledVector(rig.dir, -rig.dir.z);
      if (n.lengthSq() < 1e-6) n.set(1, 0, 0).addScaledVector(rig.dir, -rig.dir.x);
    }

    this.active = {
      rig,
      pointer: e.pointerId,
      plane: new THREE.Plane().setFromNormalAndCoplanarPoint(n.normalize(), hit.point),
      grab: hit.point,
      u0: rig.u,
      along: 0, perp: 0,
      moved: false, warned: false, near: false,
    };
    this.grabbed = true;
    this.ctx.stage.controls.enabled = false;
    e.preventDefault();
  }

  onMove(e) {
    const a = this.active;
    // 第二根手指的 move 不能拿来推零件：双指进来时零件会被甩出去
    if (!a || e.pointerId !== a.pointer) return;
    const rect = this.ctx.stage.canvas.getBoundingClientRect();
    this.ptr.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.ptr.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.ray.setFromCamera(this.ptr, this.ctx.stage.camera);
    const P = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(a.plane, P)) return;

    const rig = a.rig;
    const delta = P.sub(a.grab);
    const along = delta.dot(rig.dir);
    const perp = delta.addScaledVector(rig.dir, -along).length();
    a.along = Math.max(a.along, Math.abs(along));
    a.perp = Math.max(a.perp, perp);
    a.moved = a.moved || a.along > rig.gap * K.MOVED || a.perp > rig.gap * K.MOVED;

    // 方向错了看的是**累计**：手绕一下、抖一下都会让某一帧的垂直分量占上风，
    // 拿瞬时值判，正推的人也会被拦下来
    if (!a.warned && a.perp > rig.gap * K.PERP && a.perp > a.along * K.PERP_RATIO) {
      a.warned = true;
      this.#wrong();
      return;
    }

    const u = Math.max(K.BACK, Math.min(1, a.u0 + along / rig.gap));
    this.#drive(rig, u);

    const near = (1 - u) * rig.gap <= rig.snap;
    if (near !== a.near) {
      a.near = near;
      this.#pulse(near ? rig.id : null);
    }
  }

  async onUp(e) {
    const a = this.active;
    if (a && e && e.pointerId !== a.pointer) return;
    // 松手才交还，且必须排在提前 return 之前 —— 拖歪那一路也要收得回来
    if (this.grabbed) {
      this.grabbed = false;
      this.ctx.stage.controls.enabled = true;
    }
    if (!a) return;
    this.active = null;
    const s = this.session;
    if (!s || !a.moved) return;      // 单纯点击不算一次尝试

    const rig = a.rig;
    if (rig.u >= 1 || (1 - rig.u) * rig.gap <= rig.snap) {
      await this.seat(rig.id);
      return;
    }

    // 每一帧都认一次 session：中途翻页把件放回了原位，滑回去那几帧不能再把它拖下来
    const u0 = rig.u;
    await tween(0.42, (k) => { if (this.session === s) this.#drive(rig, u0 * (1 - k)); },
      { ease: Ease.inOutQuad });
    if (this.session !== s) return;
    this.ctx.hud?.toast('再往前推一点');
    this.#fail();
  }

  /** 方向错了：不给失败音，给一记顶住的闷响 —— 物理上就是两个面互相抵着 */
  async #wrong() {
    const a = this.active;
    this.active = null;      // 手指还按着，轨道控制留到 onUp 再交还
    const s = this.session;
    const rig = a.rig;
    const u0 = rig.u;
    this.ctx.sfx?.play('WRONG');
    await tween(0.3, (k) => { if (this.session === s) this.#drive(rig, u0 * (1 - Ease.outQuad(k))); },
      { ease: Ease.linear });
    if (this.session !== s) return;
    this.ctx.hud?.toast(s.wrongHint || `${rig.name}顺着箭头推进去`);
    this.#fail();
  }

  /** 连着三次没装上就放宽吸附，并主动把「帮我装上」摆出来 —— 别让人卡在这儿 */
  #fail() {
    const s = this.session;
    if (!s || ++s.fails < 3 || s.offered) return;
    s.offered = true;
    for (const id of s.pending) {
      const rig = s.items.get(id);
      rig.snap = Math.max(rig.snap, rig.gap * K.RELAX);
    }
    this.ctx.hud?.setAlts([{ label: '帮我装上', ico: 'wrench', onClick: () => this.autoSeat() }]);
  }

  /**
   * 把某件送到位：补完剩下的插入，末端回弹一点点。
   * 插入音在动作起手时就放 —— 那一记的撞击落在滑动段之后，正好压在坐实那一刻。
   */
  async seat(partId) {
    const s = this.session;
    const rig = s?.items.get(partId);
    if (!rig || !s.pending.has(partId)) return;

    // 只剩一小段就快，autoSeat 走全程就慢：用时间说明还剩多远
    const from = rig.u;
    const dur = 0.18 + 0.42 * (1 - from);
    this.ctx.sfx?.play(s.sound, { slide: dur * 0.9 });
    await tween(dur, (k) => { if (this.session === s) this.#drive(rig, from + (1 - from) * k); },
      { ease: Ease.outCubic });
    if (this.session !== s) return;
    await tween(0.1, (k) => {
      if (this.session === s) this.#drive(rig, 1 - Math.sin(k * Math.PI) * (BOUNCE / rig.gap));
    }, { ease: Ease.linear });
    if (this.session !== s) return;
    this.#drive(rig, 1);

    s.pending.delete(partId);
    s.seated += 1;
    s.fails = 0;
    // 结尾自检按这张表点名，装没装上不看画面看它。从动件跟着一起记账。
    // 整个换掉而不是就地改：状态是 Proxy，就地改不触发落盘与监听
    const booked = { ...this.ctx.state.installed, [partId]: true };
    for (const f of this.#followersOf(partId)) booked[f.id] = true;
    this.ctx.state.installed = booked;
    s.onSeat?.(partId, s.seated, s.total);

    if (s.pending.size) {
      this.#pulse();
      this.#guide();        // 装好的那件收掉箭头，剩下的继续指
      return;
    }
    this.ctx.bike.clearHighlights?.();
    this.ctx.guides?.clear();
    await wait(0.12);
    if (this.session !== s) return;
    s.onAll?.();
  }

  /** 降级路径：不拖也能往下走，自动播放到位 —— 少的只是手感，内容一样不少 */
  async autoSeat(partId) {
    const s = this.session;
    if (!s) return;
    for (const id of partId ? [partId] : [...s.pending]) {
      await this.seat(id);
      if (this.session !== s) return;
      await wait(0.2);
    }
  }
}
