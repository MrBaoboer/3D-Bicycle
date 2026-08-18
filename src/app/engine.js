/**
 * 分步引擎。一步 = 一份声明：机位、提示、笔记、进入与退出。
 * 引擎把上一步收干净、再铺开下一步，步骤不带清场逻辑。
 * 翻页永远不被拦住：螺丝没拧完也可以往前走；
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
     * 键盘翻页。空格与方向键的让位规矩不同：空格是按钮的激活键，焦点在任何
     * 控件上都得让开；方向键在按钮上没有默认动作，只让给自己要用方向键的
     * 控件（进度轨、菜单、文本框）—— 它们各自 preventDefault，这里认
     * defaultPrevented 即可。两键合并处理会让「点完下一步后方向键失灵」。
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
   * @param {string[]} phases 章节名，步骤的 phase 是这个数组的下标。必传：
   *   界面层不自带章节名，两边各存一份时多出的章会被静默并进上一章，
   *   进度轨看不出这件事。
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
   * 攒着未补的翻页一并作废 —— 否则跳过去之后画面还会自己再走几步。
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
   * 往下一步。这一步还有没做完的动手活时，一下只演一件且不翻页：
   * 一口气演完的话，四颗面盖螺丝在一两秒里连着转完，「对角、分两轮」
   * 来不及看清。见 docs/DEVELOPMENT.md「翻页：一下演一件」。
   */
  async next() {
    // 忙时按的这一下要攒着：丢掉的那一下读起来就是「键盘失灵」
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
   * 演这一步剩下的一件。演了返回 true，调用方据此不翻页。
   * 走各原语自己的降级路径，与手拖共用同一条代码，该看该听的一样不少。
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

      // 在场件集合按步现推。必须排在 enter 之前：这一步要装的那件得先在场，
      // enter 才能把它摆到预备位
      ctx.build?.applyAt(i, { all: !!s.showAll });

      ctx.hud.setStep(i, this.steps.length, s.title);
      if (s.task) ctx.hud.setTask(s.task.label, () => s.task.onClick(ctx, this));
      if (s.cue) ctx.hud.setCue(s.cue);
      if (s.cam) {
        /*
         * dist 不给默认值：声明了 fit 的步骤由 fit 定距（见 stage.setRecommended），
         * 默认值会把每一处近景都钉在整车距离上。
         * 步骤之间没有跳切这一档，一律走 stage 的运镜 ——
         * 全片靠「同一台车，镜头挪过去」把二十九步串成一件事。
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
       * 指到哪件报哪件的名字，每一步都挂，除非步骤声明 noPick。
       * 第一步不挂：已有四枚带说明的圆点，再跟名字牌是同一处两套注释。
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
   * 从头再来。不能只调 go(0)：已在第一步时 go() 因 `i === this.index` 当场返回，
   * 按下去毫无反应。先把游标挪开，保证这一趟跑完整的收尾与重铺。
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
