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
  begin({ ids, onHover }) {
    /*
     * 网格 → 件 的对照表现建一次。每次移动都从 bom 反查的话，
     * 一次悬停要跑二十七件 × 各自的节点树，指针一动就是一轮全树遍历。
     */
    const owner = new Map();
    const meshes = [];
    for (const id of ids) {
      const name = this.ctx.bom.part(id).name;
      for (const n of this.ctx.bom.nodesOf(id)) {
        this.ctx.bike.get(n).traverse((o) => {
          if (!o.isMesh) return;
          owner.set(o, { id, name });
          meshes.push(o);
        });
      }
    }
    this.session = { owner, meshes, onHover };
    return this.session;
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
      const hit = this.ray.intersectObjects(this.session.meshes, false)[0];
      this.#report(hit ? this.session.owner.get(hit.object) : null, ev.clientX, ev.clientY);
    });
  }

  /** 名字没变就只挪位置，不重写文本 —— 每帧改 textContent 会让读屏一直播报 */
  #report(hit, x, y) {
    if (!this.session) return;
    this._last = hit?.id ?? null;
    this.session.onHover?.(hit ?? null, x, y);
  }
}
