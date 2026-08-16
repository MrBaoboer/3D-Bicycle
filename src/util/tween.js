/** 极简补间与缓动 —— 全片动画的统一时基 */

/** 只留在用的这几条。没有生产者的缓动一律不留 —— 留着的下场是有人照着挑一条，
 *  而它从来没在这套画面上试过 */
export const Ease = {
  linear: (t) => t,
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
};

/**
 * 用户要求「减少动效」。
 *
 * CSS 那一侧已由 base.css 的 @media 关掉了；这一条给 JS 驱动的动效用 ——
 * 方向箭头的呼吸、镜头缓动这类**持续不停**的运动，CSS 管不到。
 * 每次读实时值，用户在系统里改了设置不必刷新页面。
 */
export const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const running = new Set();

export function tick(dt) {
  for (const tw of [...running]) tw._step(dt);
}

class Tween {
  constructor(dur, onUpdate, { ease = Ease.inOutCubic, delay = 0, onDone } = {}) {
    this.dur = Math.max(1e-4, dur);
    this.onUpdate = onUpdate;
    this.ease = ease;
    this.delay = delay;
    this.onDone = onDone;
    this.t = 0;
    this.done = false;
    running.add(this);
  }
  _step(dt) {
    if (this.done) return;
    if (this.delay > 0) { this.delay -= dt; return; }
    this.t = Math.min(this.dur, this.t + dt);
    const k = this.ease(this.t / this.dur);
    // 回调抛错不能拦住 finish()：否则这个 tween 永不兑现、每帧再抛，
    // 还会把同一帧里排在后面的所有 updater 一起打断 —— 记录，然后继续走
    try {
      this.onUpdate(k, this.t / this.dur);
    } catch (e) {
      console.error('[tween]', e);
    }
    if (this.t >= this.dur) this.finish();
  }
  finish() {
    if (this.done) return;
    this.done = true;
    running.delete(this);
    this.onDone?.();
  }
  cancel() { this.done = true; running.delete(this); }
}

/** @returns {Promise<void>} */
export function tween(dur, onUpdate, opts = {}) {
  return new Promise((resolve) => {
    new Tween(dur, onUpdate, { ...opts, onDone: () => { opts.onDone?.(); resolve(); } });
  });
}

const waits = new Set();

/**
 * 等一会儿。
 * 被 cancelAll 取消时**不会**兑现 —— 于是 `await wait(...)` 之后的那些代码
 * 就此打住。翻页时这一条很要紧：上一步排在后面的动作不该落到下一步的画面上。
 */
export const wait = (s) => new Promise((resolve) => {
  const rec = { id: 0 };
  rec.id = setTimeout(() => { waits.delete(rec); resolve(); }, s * 1000);
  waits.add(rec);
});

/** 掐断所有在跑的动画与等待 */
export function cancelAll() {
  for (const t of [...running]) t.cancel();
  for (const w of waits) clearTimeout(w.id);
  waits.clear();
}
