/**
 * 分步引擎
 *
 * 一步 = 一份声明：机位、提示、笔记、进入与退出。
 * 引擎负责把上一步收干净，再把下一步铺开 —— 步骤本身不必操心清场。
 *
 * 翻页永远不被拦住：螺丝没拧完也可以往前走。
 * 需要动手的步骤把动作放在底部那一个任务按钮上，与导航互不相干。
 */

import * as THREE from 'three';
import { cancelAll } from '../util/tween.js';

export class Engine {
  constructor(ctx) {
    this.ctx = ctx;
    ctx.engine = this;
    this.steps = [];
    this.index = -1;
    this.busy = false;

    ctx.hud.onNext = () => this.next();
    ctx.hud.onPrev = () => this.back();
    ctx.hud.onJump = (i) => this.jump(i);

    /*
     * 键盘翻页。
     *
     * 空格与方向键的让位规矩不一样，早先按同一条处理，代价很实在：
     * 只要焦点落在任何一个按钮上，方向键就整个失灵 —— 而用鼠标点一下「下一步」
     * 之后焦点正好就在那枚按钮上，此时按方向键毫无反应，像是键盘坏了。
     *
     *   空格   是按钮的激活键，焦点在任何控件上都得让开；
     *   方向键 在按钮上没有默认动作，只让给**自己要用方向键**的那些：
     *          进度轨（格子之间移焦）、菜单、文本框。它们各自把事件 preventDefault，
     *          这里认那一下就够，不必回头去认具体是谁。
     */
    addEventListener('keydown', (e) => {
      if (!ctx.hud.navVisible || ctx.hud.modalOpen || e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target instanceof Element ? e.target : null;
      if (e.key === ' ') {
        if (el?.closest('button, a, input, select, textarea, [role="menu"]')) return;
        e.preventDefault();
        this.next();
        return;
      }
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      if (ctx.hud.menuOpen || el?.closest('input, select, textarea, [role="menu"]')) return;
      e.preventDefault();
      if (e.key === 'ArrowRight') this.next(); else this.back();
    });
  }

  /**
   * @param {object[]} list 步骤表
   * @param {string[]} phases 章节名，步骤的 phase 就是这个数组的下标。
   *   必传：界面层不该自带一份章节名 —— 它一旦与内容各存一份，
   *   多出来的那一章会被静默并进上一章，而顶部那条进度线看不出这件事。
   */
  setSteps(list, phases) {
    this.steps = list;
    this.byId = new Map(list.map((s, i) => [s.id, i]));
    this.ctx.build?.plan(list);
    this.ctx.hud.setChapters(list, phases);
  }

  get current() { return this.steps[this.index]; }

  /**
   * 直接跳到第 i 步（点进度轨、点自检里的一行）。
   * 意思很明确，所以攒着还没补上的那几下方向键一并作废 ——
   * 否则点着跳过去，画面还会自己再往前走两步。
   */
  jump(i) {
    this._queued = 0;
    return this.go(i);
  }

  goToStep(id) {
    const i = this.byId.get(id);
    if (i !== undefined) return this.jump(i);
    return undefined;
  }

  /**
   * 往下一步。
   *
   * **这一步还有没做完的动手活时，一下只演一件，而且不翻页。**
   * 两条摇臂要按两下，四颗面盖螺丝要按四下，全部做完之后再按一下才走。
   *
   * 一口气把整步演完是不行的：那样四颗螺丝会在一两秒里连着转完，
   * 「对角、分两轮」这件要看的事根本来不及看清。一下一件，节奏由手控制。
   * 而催着人一定要自己拖一遍，又会把不想动手的人卡在原地 ——
   * 「你按一下我演一件」两头都照顾到。
   */
  async next() {
    // 上一下还没走完就先记着，别当没按 —— 「拆开看看」那一步进场要演一秒多，
    // 而连按两下方向键是最自然不过的事。丢掉的那一下读起来就是「键盘失灵」
    if (this.busy) { this.#stash(1); return; }
    if (await this.finishPending()) return;
    if (this.index < this.steps.length - 1) await this.go(this.index + 1);
  }

  async back() {
    if (this.busy) { this.#stash(-1); return; }
    if (this.index > 0) await this.go(this.index - 1);
  }

  /** 攒下这一下。封顶四下 —— 按住不放时按键自动重复一秒能来三十下，不封顶会甩出去半本 */
  #stash(d) { this._queued = Math.max(-4, Math.min(4, (this._queued || 0) + d)); }

  /** 忙的时候攒下的，忙完一下一下补上 */
  #drain() {
    const q = this._queued || 0;
    if (!q) return;
    this._queued = q > 0 ? q - 1 : q + 1;
    if (q > 0) this.next(); else this.back();
  }

  /** 这一步还剩什么没做完 */
  get pending() {
    const { slide, screw, hud } = this.ctx;
    if (slide.session?.pending.size) return 'slide';
    if (screw.session?.pending.size) return 'screw';
    if (hud.hasTask) return 'task';
    return null;
  }

  /**
   * 演这一步剩下的**一件**。演了返回 true —— 调用方据此知道「这一下不翻页」。
   * 走的是各原语自己的降级路径，与手拖共用同一条代码，该看的该听的一样不少。
   */
  async finishPending() {
    const kind = this.pending;
    if (!kind) return false;
    this.busy = true;
    try {
      const { slide, screw, hud } = this.ctx;
      if (kind === 'slide') await slide.autoSeat([...slide.session.pending][0]);
      else if (kind === 'screw') await screw.autoRunNext();
      else hud.runTask();
    } catch (e) {
      console.error('[自动演示]', e);
    } finally {
      this.busy = false;
    }
    // 还剩别的没演完就再亮一次箭头：它此刻的意思是「还有，接着按」
    if (this.pending) this.ctx.hud.readyNext();
    this.#drain();
    return true;
  }

  async go(i) {
    if (i < 0 || i >= this.steps.length || i === this.index) return;
    // 上一步的动画还没跑完也照样翻 —— 取消它，别让用户等
    cancelAll();
    this.busy = true;
    const { ctx } = this;
    const prev = this.current;

    try {
      // ── 收尾 ──
      await prev?.exit?.(ctx);
      ctx.slide.cancel();
      ctx.screw.cancel();
      ctx.pick?.cancel();
      ctx.hud.tag(null);
      ctx.guides.clear();
      ctx.hud.clearSpots();
      ctx.hud.setNote(null);
      ctx.hud.setAlts([]);
      ctx.hud.setTask(null);
      ctx.hud.setCue('');
      ctx.hud.closeOverlays();
      ctx.exitInspect?.();
      ctx.bike.clearHighlights();
      ctx.stage.hold(false);

      // ── 进入 ──
      this.index = i;
      const s = this.current;

      // 车上此刻该有哪些件 —— 从零开始装，第二步的画面里只该剩一根车架。
      // 必须排在 enter 之前：这一步要装的那件得先在场，才谈得上把它摆到预备位
      ctx.build?.applyAt(i, { all: !!s.showAll });

      ctx.hud.setStep(i, this.steps.length, s.title);
      if (s.task) ctx.hud.setTask(s.task.label, () => s.task.onClick(ctx, this));
      if (s.cue) ctx.hud.setCue(s.cue);
      if (s.cam) {
        /*
         * dist 不给默认值：声明了 fit 的步骤由 fit 定距（见 stage.setRecommended），
         * 塞一个默认值会把每一处近景都钉在整车距离上。
         *
         * **没有「直接跳过去」这一档。** 步骤之间一律走 stage 排的那一趟运镜 ——
         * 一步一跳切，看的人得重新找一遍「这是车上的哪儿」，而这份说明书全靠
         * 「同一台车，镜头挪过去」把二十九步串成一件事。
         */
        ctx.stage.setRecommended({
          az: s.cam.az ?? 45, el: s.cam.el ?? 16, dist: s.cam.dist,
          target: s.cam.target ? new THREE.Vector3(...s.cam.target) : undefined,
          ease: s.cam.ease ?? 1,
          fit: s.cam.fit,
        });
      }
      if (s.note) ctx.hud.setNote(s.note);
      if (s.enter) await s.enter(ctx, this);

      /*
       * 指到哪件，报哪件的名字 —— 每一步都挂，除非这一步自己说不要。
       * 第一步不挂：那一步已经钉了四枚带说明的圆点，再跟一个浮动名字牌
       * 就是同一处两套注释。
       */
      if (!s.noPick && !ctx.pick.session) {
        ctx.pick.begin({
          fallback: '车架',
          onHover: (hit, x, y) => ctx.hud.tag(hit?.name ?? null, x, y),
        });
      }
    } catch (e) {
      console.error(`[step ${this.steps[i]?.id}]`, e);
    } finally {
      this.busy = false;
    }
    this.#drain();
  }

  /**
   * 从头再来。
   *
   * 不能只调 go(0) —— 已经在第一步时 go() 会当场返回（`i === this.index`），
   * 于是「从头再来」在第一步上按下去毫无反应，而那正是最容易被按的时候。
   * 先把游标挪开，让这一趟一定跑完整的收尾与重铺。
   */
  async restart() {
    this._queued = 0;
    const at = this.index;
    if (at === 0) {
      await this.current?.exit?.(this.ctx);
      this.index = -1;
    }
    await this.go(0);
  }

  /** 任务做完了：收起任务按钮，让右边那枚箭头亮一下 */
  done() {
    this.ctx.hud.setTask(null);
    this.ctx.hud.setAlts([]);
    this.ctx.hud.readyNext();
  }
}
