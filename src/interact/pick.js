/**
 * 指到哪件，报哪件的名字。
 *
 * 「拆开看看」那一步摊开二十七个大件，而摊开本身只回答了「有多少」，
 * 没回答「都是些什么」。二十七个名字全标出来是一屏的浮字，
 * 什么也读不成 —— 指哪儿说哪儿，一次只说一个，才是这一屏该有的密度。
 *
 * 与 slide / screw 的分工：那两个把指针变成**动作**，这一个只是问一句「这是什么」，
 * 从不改场景，也从不夺走轨道控制 —— 摊开的车照样可以按住拖着转。
 */

import * as THREE from 'three';

/** 触屏没有悬停，改成点一下报名字，再点别处收起 */
const COARSE = () => matchMedia('(pointer: coarse)').matches;

export class Pick {
  /** @param {{stage:any, bike:any, bom:any}} ctx */
  constructor(ctx) {
    this.ctx = ctx;
    this.ray = new THREE.Raycaster();
    this.ptr = new THREE.Vector2();
    this.session = null;
    this._queued = false;
    this._last = null;
    this._bind();
  }

  _bind() {
    const c = this.ctx.stage.canvas;
    this._move = (e) => this.#onMove(e);
    this._leave = () => this.#report(null, 0, 0);
    this._tap = (e) => { if (COARSE()) this.#onMove(e); };
    c.addEventListener('pointermove', this._move);
    c.addEventListener('pointerleave', this._leave);
    c.addEventListener('pointerdown', this._tap);
  }

  dispose() {
    const c = this.ctx.stage.canvas;
    c.removeEventListener('pointermove', this._move);
    c.removeEventListener('pointerleave', this._leave);
    c.removeEventListener('pointerdown', this._tap);
  }

  /**
   * 开一次会话。
   * @param {object} o
   * @param {string[]} o.ids 参与命中的件 id
   * @param {(hit:{id:string,name:string}|null, x:number, y:number)=>void} o.onHover
   */
  begin({ ids, fallback = null, onHover } = {}) {
    /*
     * 网格 → 件 的对照表现建一次。每次移动都从 bom 反查的话，
     * 一次悬停要跑二十七件 × 各自的节点树，指针一动就是一轮全树遍历。
     *
     * **求交对着整车，不是只对着这几件。** 车架不在 BOM 里（它是底座，
     * 不是要装的件），只挂 BOM 件的话，指到车架上什么也不报 ——
     * 而画面上大半是它。整车都可命中，认不出主的就报 fallback。
     */
    const owner = new Map();
    for (const id of ids ?? this.ctx.bom.parts.map((p) => p.id)) {
      const name = this.ctx.bom.part(id).name;
      for (const n of this.ctx.bom.nodesOf(id)) {
        this.ctx.bike.get(n).traverse((o) => { if (o.isMesh) owner.set(o, { id, name }); });
      }
    }
    this.session = { owner, fallback, onHover };
    return this.session;
  }

  /** 命中的这块网格属于哪一件 —— 顺着祖先往上找，找不到就是底座 */
  #own(mesh) {
    const s = this.session;
    for (let o = mesh; o; o = o.parent) {
      const hit = s.owner.get(o);
      if (hit) return hit;
    }
    return s.fallback ? { id: '', name: s.fallback } : null;
  }

  cancel() {
    if (!this.session) return;
    this.session.onHover?.(null, 0, 0);
    this.session = null;
    this._last = null;
  }

  #onMove(e) {
    if (!this.session || this.ctx.hud?.modalOpen) return;
    this._pending = e;
    // 每帧最多问一次。指针事件一秒能来一百多个，而这是一次几百个网格的求交
    if (this._queued) return;
    this._queued = true;
    requestAnimationFrame(() => {
      this._queued = false;
      const ev = this._pending;
      if (!ev || !this.session) return;
      const r = this.ctx.stage.canvas.getBoundingClientRect();
      this.ptr.set(
        ((ev.clientX - r.left) / r.width) * 2 - 1,
        -((ev.clientY - r.top) / r.height) * 2 + 1,
      );
      this.ray.setFromCamera(this.ptr, this.ctx.stage.camera);
      const hit = this.ray.intersectObject(this.ctx.bike.root, true)
        .find((h) => h.object.visible && h.object.isMesh);
      this.#report(hit ? this.#own(hit.object) : null, ev.clientX, ev.clientY);
    });
  }

  /** 名字没变就只挪位置，不重写文本 —— 每帧改 textContent 会让读屏一直播报 */
  #report(hit, x, y) {
    if (!this.session) return;
    this._last = hit?.id ?? null;
    this.session.onHover?.(hit ?? null, x, y);
  }
}
