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
    ctx.hud.onJump = (i) => this.go(i);

    addEventListener('keydown', (e) => {
      if (!ctx.hud.navVisible || ctx.hud.modalOpen) return;
      // 焦点落在控件上时不接管：空格是按钮的激活键，不是翻页键
      if (e.target instanceof Element
        && e.target.closest('button, a, input, select, textarea, [role="menu"]')) return;
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); this.next(); }
      if (e.key === 'ArrowLeft') this.back();
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

  goToStep(id) {
    const i = this.byId.get(id);
    if (i !== undefined) return this.go(i);
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
    if (this.busy) return;
    if (await this.finishPending()) return;
    if (this.index < this.steps.length - 1) await this.go(this.index + 1);
  }

  async back() { if (this.index > 0) await this.go(this.index - 1); }

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
        // dist 不给默认值：声明了 fit 的步骤由 fit 定距（见 stage.setRecommended），
        // 塞一个默认值会把每一处近景都钉在整车距离上
        ctx.stage.setRecommended({
          az: s.cam.az ?? 45, el: s.cam.el ?? 16, dist: s.cam.dist,
          target: s.cam.target ? new THREE.Vector3(...s.cam.target) : undefined,
          ease: s.cam.ease ?? 1,
          fit: s.cam.fit,
        });
        if (s.cam.snap) ctx.stage.snapToRecommended();
      }
      if (s.note) ctx.hud.setNote(s.note);
      if (s.enter) await s.enter(ctx, this);
    } catch (e) {
      console.error(`[step ${this.steps[i]?.id}]`, e);
    } finally {
      this.busy = false;
    }
  }

  /**
   * 从头再来。
   *
   * 不能只调 go(0) —— 已经在第一步时 go() 会当场返回（`i === this.index`），
   * 于是「从头再来」在第一步上按下去毫无反应，而那正是最容易被按的时候。
   * 先把游标挪开，让这一趟一定跑完整的收尾与重铺。
   */
  async restart() {
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
