/** 极简补间与缓动 —— 全片动画的统一时基 */

export const Ease = {
  linear: (t) => t,
  inQuad: (t) => t * t,
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inCubic: (t) => t * t * t,
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outBack: (t) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2),
  outElastic: (t) => (t === 0 || t === 1 ? t
    : Math.pow(2, -9 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
  /** M1 引火：指数曲线 —— 前 0.9 s 只到 30%，最后 0.3 s 冲到 100%。
   *  线性曲线会让点亮显得平淡，这是「点亮感」的关键。 */
  ignite: (t) => Math.pow(t, 3.6),
};

/**
 * 用户要求「减少动效」。
 *
 * CSS 那一侧已由 base.css 的 @media 关掉了；这一条给 JS 驱动的动效用 ——
 * 封面自转、挂灯摆动、火焰跳动这类**持续不停**的运动，CSS 管不到。
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

/** 数值弹簧（用于拖拽阻尼与回弹） */
export class Spring {
  constructor(value = 0, { stiffness = 170, damping = 22 } = {}) {
    this.value = value; this.target = value; this.v = 0;
    this.k = stiffness; this.d = damping;
  }
  step(dt) {
    const a = this.k * (this.target - this.value) - this.d * this.v;
    this.v += a * dt;
    this.value += this.v * dt;
    return this.value;
  }
}
