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

  setSteps(list) {
    this.steps = list;
    this.byId = new Map(list.map((s, i) => [s.id, i]));
    this.ctx.hud.setChapters(list);
  }

  get current() { return this.steps[this.index]; }

  goToStep(id) {
    const i = this.byId.get(id);
    if (i !== undefined) return this.go(i);
    return undefined;
  }

  async next() { if (this.index < this.steps.length - 1) await this.go(this.index + 1); }
  async back() { if (this.index > 0) await this.go(this.index - 1); }

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

      ctx.hud.setStep(i, this.steps.length, s.title);
      if (s.task) ctx.hud.setTask(s.task.label, () => s.task.onClick(ctx, this));
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
      if (s.cue) ctx.hud.setCue(s.cue.text, s.cue.ico);
      if (s.enter) await s.enter(ctx, this);
    } catch (e) {
      console.error(`[step ${this.steps[i]?.id}]`, e);
    } finally {
      this.busy = false;
    }
  }

  /** 任务做完了：收起任务按钮，让右边那枚箭头亮一下 */
  done() {
    this.ctx.hud.setTask(null);
    this.ctx.hud.setAlts([]);
    this.ctx.hud.readyNext();
  }
}
