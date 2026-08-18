/** 极简补间与缓动 —— 全片动画的统一时基 */

/** 只留有调用方的缓动。没在这套画面上用过的曲线不留，免得被当成试过的选项挑走 */
export const Ease = {
  linear: (t) => t,
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  /**
   * 五次平滑（smootherstep）—— 两头速度与**加速度都为零**。
   * 运镜专用：inOutCubic 的中段速度是平均值的三倍，一段一百度的环绕会在中间
   * 甩到一百八十度每秒；这一条峰值只有 1.875 倍，起停也不会有那一下顿挫。
   */
  smoother: (t) => t * t * t * (t * (t * 6 - 15) + 10),
};

/**
 * prefers-reduced-motion。CSS 侧由 base.css 的 @media 关掉；这一条给 JS 驱动的
 * 持续动效用（方向箭头的呼吸、镜头缓动）。每次读实时值，系统设置改了不必刷新。
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
 * 等一会儿。被 cancelAll 取消时**不会**兑现 —— `await wait(...)` 之后的代码
 * 就此打住，翻页时上一步排在后面的动作才不会落到下一步的画面上。
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
