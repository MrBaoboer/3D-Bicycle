/**
 * 音效引擎 —— 实时程序合成，不加载音频文件。采样给不了这里要的参数化：
 * 旋进要随进给深度上走、「到底」要按螺栓规格升降半音、坐实要随行程变轻重。
 * 合成是物理导向的：撞击 = 宽带瞬态 + 一组指数衰减的模态；摩擦 = 带通噪声加包络；
 * 过牙 = 一串微黏滑瞬态，不是调幅 —— 正弦调幅听着是电台杂音，颗粒才是牙。
 * 金属味有两个来源：衰减比要平（钢的内耗极低，泛音陪着基频响完），
 * 模态要成对失谐几音分（实件没有数学上干净的单频，双频拍出来的那点漂才像实物）。
 * 干信号一律再走一条合成的小房间混响（约 0.35 s，双声道去相关）——
 * 没有空间的撞击声是示波器，不是车间。
 * 排程一律走 AudioContext.currentTime：setTimeout 抖动几十毫秒，会把过牙抖成烂泥。
 */

/** 半音 → 频率倍率（基频由每个音自己给，这里只出倍率） */
export const semi = (n) => Math.pow(2, n / 12);

/** 主总线音量。静音是把它推到 0，不是拆图 */
const MASTER = 0.85;

/** 混响送出量。只到「能感到房间在」为止 —— 再大，四颗连拧就糊成一锅 */
const ROOM_SEND = 0.16;

/** ±rand：逐次触发的微差。同一记音完全复读两遍，耳朵立刻听出是机器 */
const jit = (x) => 1 + (Math.random() - 0.5) * 2 * x;

class SFXEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.bus = null;
    this.masterGain = null;
    this.noiseBuf = null;
  }

  /** 首次用户手势后才能创建 AudioContext（浏览器自动播放策略） */
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    const ctx = new AC();
    this.ctx = ctx;

    // 白噪声缓冲（2 s，循环取用）—— 摩擦、气流、撞击瞬态、混响 IR 都从这里取
    const n = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;

    /*
     * 总线：干湿并联 → 限幅 → 总音量。
     * 干路保脆（撞击的 0.6 ms 起音混响给不了），湿路给空间；
     * 限幅在合流之后 —— 拧一串螺栓时几个音叠在一起，不压会糊。
     */
    const mix = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 22;
    comp.ratio.value = 5;
    comp.attack.value = 0.003;
    comp.release.value = 0.14;
    const master = ctx.createGain();
    master.gain.value = this.enabled ? MASTER : 0;
    mix.connect(comp);
    const send = ctx.createGain();
    send.gain.value = ROOM_SEND;
    const room = ctx.createConvolver();
    room.buffer = this._roomIR(ctx);
    mix.connect(send).connect(room).connect(comp);
    comp.connect(master).connect(ctx.destination);
    this.bus = mix;
    this.masterGain = master;

    return ctx;
  }

  /**
   * 小房间脉冲响应：6 ms 预延迟 + 指数衰减噪声，单极低通收高频（墙面吸声），
   * 左右两声道各自独立取噪声 —— 去相关就是立体声宽度的全部来源。
   */
  _roomIR(ctx) {
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * 0.35);
    const pre = Math.floor(sr * 0.006);
    const ir = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let lp = 0;
      for (let i = pre; i < len; i++) {
        const env = Math.exp(-3.2 * (i - pre) / (len - pre));
        lp = 0.74 * lp + 0.26 * (Math.random() * 2 - 1);   // ≈3 kHz 单极低通
        d[i] = lp * env;
      }
    }
    return ir;
  }

  setEnabled(v) {
    this.enabled = v;
    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(v ? MASTER : 0, this.ctx.currentTime, 0.05);
    }
  }

  get t() { return this.ctx ? this.ctx.currentTime : 0; }

  // ── 基元 ──────────────────────────────────────────

  /** 出口：轻微随机声像（±0.14）。件在手边不在正中，全部居中反而假 */
  _out(pan = (Math.random() - 0.5) * 0.28) {
    const ctx = this.ctx;
    if (!ctx.createStereoPanner) return this.bus;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(this.bus);
    return p;
  }

  /** 噪声源（随机起点与轻微变速，避免同一段噪声反复出现听出周期） */
  _noise(t, dur, gain = 1) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
    return { src, out: g };
  }

  /** 带通滤过的噪声：摩擦、气流、撞击瞬态都用它 */
  bandNoise(t, {
    f = 1200, q = 2.4, dur = 0.12, gain = 0.3,
    attack = 0.004, sweepTo = null, type = 'bandpass', decayShape = 2.2, out = null,
  } = {}) {
    const ctx = this.ctx;
    const { out: src } = this._noise(t, dur, 1);
    const bp = ctx.createBiquadFilter();
    bp.type = type;
    bp.frequency.setValueAtTime(f, t);
    bp.Q.value = q;
    // 上扫下扫都走这一条：旋进接触刚度升高往上，滑动能量泄掉往下
    if (sweepTo) bp.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), t + dur);
    const g = ctx.createGain();
    const end = t + dur * decayShape;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    src.connect(bp).connect(g).connect(out || this._out());
    return g;
  }

  /**
   * 模态组：一组指数衰减的正弦，每阶用一对失谐几音分的振荡器 ——
   * 单频是音叉，双频拍出来的慢漂才像一块真钢。
   * @param {number[]} ratios 相对基频的模态比（自由-自由细长件弯曲近似 1 : 2.76 : 5.4 : 8.9）
   * @param {number[]} decays 各模态衰减时间（秒）—— 金属给得平，越平越金属
   * @param {number} stretch 非谐拉伸：高阶模态按 (1 + stretch·i²) 上抬，实件的板壳都偏高
   */
  modes(t, {
    f0 = 700, ratios = [1, 2.76, 5.4], decays = [0.18, 0.1, 0.06],
    amps = [1, 0.5, 0.25], gain = 0.3, detune = 0, stretch = 0.004,
    wave = 'sine', attack = 0.003, pairCents = 6, out = null,
  } = {}) {
    const ctx = this.ctx;
    const dst = out || this._out();
    ratios.forEach((r, i) => {
      const f = f0 * r * (1 + stretch * i * i) * (1 + (Math.random() - 0.5) * detune);
      const amp = gain * (amps[i] ?? 0.3) * jit(0.12);
      const dec = (decays[i] ?? decays[decays.length - 1]) * jit(0.1);
      for (const side of [-1, 1]) {
        const osc = ctx.createOscillator();
        osc.type = wave;
        osc.frequency.setValueAtTime(f * semi(side * pairCents / 100), t);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(amp * 0.5, t + attack);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
        osc.connect(g).connect(dst);
        osc.start(t);
        osc.stop(t + dec + 0.05);
      }
    });
  }

  /**
   * 共鸣器：噪声打进高 Q 带通，出来是带噪芯的衰减单音 ——
   * 车架、座管这类空腔件的「嗡」用它，比纯正弦多一层敲上去的糙。
   * 带通峰值增益恒为 1，Q 越高通过的噪声能量越少（≈ −10·lg Q），
   * 按带宽补回来，gain 才与其他基元同一个标尺 —— 不补，q 24 等于静音。
   */
  ring(t, { f = 320, q = 26, dur = 0.18, gain = 0.2, attack = 0.002, out = null } = {}) {
    const ctx = this.ctx;
    const { out: src } = this._noise(t, dur, 1);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f;
    bp.Q.value = q;
    const g = ctx.createGain();
    const lvl = gain * Math.sqrt(0.32 * q * ctx.sampleRate / f);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(lvl, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp).connect(g).connect(out || this._out());
  }

  /**
   * 微瞬态串：n 记 3–6 ms 的窄带小气口，时刻带抖动 ——
   * 过牙、棘轮、颗粒摩擦的质感全在这里。规律到毫秒级反而假：真牙没有节拍器。
   */
  grains(t, {
    n = 8, span = 0.3, f = 3200, spread = 0.35, q = 5, gain = 0.06, out = null,
  } = {}) {
    const dst = out || this._out();
    for (let i = 0; i < n; i++) {
      const at = t + (span * i / n) * jit(0.5);
      this.bandNoise(at, {
        f: f * (1 + (Math.random() - 0.5) * 2 * spread),
        q: q * jit(0.3),
        dur: 0.004 + Math.random() * 0.003,
        gain: gain * (0.4 + Math.random() * 0.6),
        attack: 0.0008,
        out: dst,
      });
    }
  }

  /** 低频冲击：质量被挡住的那一下（落进勾爪、插到底） */
  thump(t, { f = 92, drop = 40, dur = 0.42, gain = 0.5, out = null } = {}) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, drop), t + dur * 0.7);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(out || this._out(0));
    osc.start(t); osc.stop(t + dur + 0.05);
  }

  // ── 对外 ──────────────────────────────────────────

  /**
   * @param {string} id 音效编号
   * @param {object} o  { pitch: 半音偏移, gain, delay: 秒, ...各音自己的参数 }
   */
  play(id, o = {}) {
    if (!this.enabled || MUTED.has(id)) return;
    const ctx = this.ensure();
    if (!ctx) return;
    let name = id, scale = 1;
    if (!RECIPES[name] && ALIASES[name]) [name, scale] = ALIASES[name];
    const fn = RECIPES[name];
    if (!fn) return; // 未定义的编号与 MUTED 一样当没听见，不往控制台里丢东西
    const t = ctx.currentTime + (o.delay || 0) + 0.001;
    fn(this, t, semi(o.pitch || 0), (o.gain ?? 1) * scale, o);
  }
}

// ══════════════════════════════════════════════════════════
// 音效表
//
// 只收装车时手底下真会发出的那四种：过牙、拧到底、坐实、顶住。
// 界面本身不出声 —— 装车现场没有「叮」。没有调用方的音不留，
// 免得被当成还在用的东西改来改去。
// ══════════════════════════════════════════════════════════

const RECIPES = {
  /**
   * 螺纹旋进：牙侧互相刮擦，是一连串极小的黏-滑。三层：
   *  · 摩擦底 —— 2 kHz 带通噪声，随进给上扫（啮合圈数越多、接触刚度越高）
   *  · 颗粒 —— 十来记 3 kHz 上下的微瞬态，深度越深越密、越亮，这才是「牙」
   *  · 手感 —— 240 Hz 一点点共鸣，工具握在手里的那点闷
   * @param {object} o { depth 0..1 进给深度, dur }
   */
  THREAD_TURN: (S, t, p, g, o = {}) => {
    const depth = Math.min(1, Math.max(0, o.depth ?? 0));
    const dur = o.dur ?? 0.34;
    const out = S._out();
    const f0 = 1900 * p * (1 + depth * 0.35);
    S.bandNoise(t, {
      f: f0, q: 1.4, dur, gain: 0.13 * g,
      sweepTo: f0 * 1.4, attack: dur * 0.18, decayShape: 1.1, out,
    });
    S.grains(t, {
      n: Math.round(7 + depth * 6), span: dur * 0.85,
      f: 3100 * p * (1 + depth * 0.25), spread: 0.4,
      gain: 0.2 * g, out,
    });
    S.ring(t, { f: 240 * p, q: 8, dur: dur * 0.6, gain: 0.045 * g, attack: 0.02, out });
  },

  /**
   * 拧到底那一记。螺栓端面磕到座面，整根钢件一起响：
   *  · 0–2 ms  钢对钢的硬碰撞，重心 5.2 kHz，起音 0.6 ms —— 「脆」全靠这一下
   *  · 之后    杆身弯曲模态 1 : 2.76 : 5.4 : 8.9，衰减几乎一样平，
   *            每阶成对失谐 6 音分 —— 平是金属，拍着漂是「一块真的金属」
   *  · 7 kHz   高 Q 短鸣，扳手口与螺栓头那声「锃」
   *  · 190 Hz  手握着工具，低频被掌心吃掉大半，只留一记短促的推力
   *  · +14 ms  一记弱一个数量级的回响 —— 机构里总有第二件东西跟着颤
   */
  SNUG_CLICK: (S, t, p, g) => {
    g *= jit(0.1);
    const out = S._out();
    S.bandNoise(t, { f: 5200 * p, q: 0.9, dur: 0.007, gain: 0.34 * g, attack: 0.0006, out });
    S.bandNoise(t, { f: 2600 * p, q: 3.0, dur: 0.018, gain: 0.17 * g, attack: 0.001, out });
    S.modes(t, {
      f0: 1180 * p, ratios: [1, 2.76, 5.4, 8.9], decays: [0.13, 0.12, 0.1, 0.085],
      amps: [1, 0.72, 0.5, 0.3], gain: 0.34 * g, detune: 0.012, attack: 0.0012, out,
    });
    S.ring(t, { f: 7000 * p, q: 22, dur: 0.05, gain: 0.05 * g, attack: 0.0008, out });
    S.thump(t, { f: 190 * p, drop: 110, dur: 0.07, gain: 0.12 * g, out });
    S.modes(t + 0.014 * jit(0.3), {
      f0: 1180 * p, ratios: [1, 2.76, 5.4], decays: [0.05, 0.045, 0.035],
      amps: [1, 0.5, 0.3], gain: 0.05 * g, attack: 0.0012, out,
    });
  },

  // ── 装配 ──────────────────────────────────────────

  /**
   * 零件滑到位坐实（前轮落进勾爪、座管插到底）：
   * 先是贴合面的滑动摩擦 —— 1.5 kHz 往下走的噪声底，加一层稀疏颗粒（涂过油的
   * 面也不是绸子）；末端质量被挡住：100→50 Hz 低频冲击、车架空腔 330 Hz
   * 带噪共鸣、一层管腔排气的低通气流。
   * @param {object} o { slide 滑动段时长 }
   */
  SEAT_IN: (S, t, p, g, o = {}) => {
    const slide = o.slide ?? 0.1;
    const out = S._out();
    S.bandNoise(t, {
      f: 1500 * p, q: 0.9, dur: slide, gain: 0.045 * g,
      sweepTo: 800 * p, attack: slide * 0.4, decayShape: 1.15, out,
    });
    if (slide > 0.12) {
      S.grains(t, { n: Math.round(slide * 22), span: slide * 0.9, f: 2400 * p, gain: 0.02 * g, out });
    }
    // 低频只给到这个量：再多就压住总线，把后面那记「到底」一起吃掉
    const s = t + slide;
    S.thump(s, { f: 100 * p, drop: 50, dur: 0.24, gain: 0.17 * g, out });
    S.ring(s, { f: 330 * p * jit(0.04), q: 24, dur: 0.16, gain: 0.13 * g, out });
    S.ring(s, { f: 620 * p * jit(0.04), q: 18, dur: 0.09, gain: 0.05 * g, out });
    S.bandNoise(s, { f: 420 * p, q: 0.7, dur: 0.09, gain: 0.05 * g, sweepTo: 220 * p, attack: 0.012, out });
  },

  /**
   * 方向错了 —— 不给「失败音」。物理上是零件顶住：本该滑进去的面互相抵着，
   * 敲上去发闷。两记 210 Hz 的低 Q 钝叩（第二记轻三成、隔 90 ms），
   * 中间垫一小段闷摩擦；音高从头到尾不动 —— 一下行就成了游戏机的失败提示。
   */
  WRONG: (S, t, p, g) => {
    const out = S._out();
    const knock = (at, k) => {
      S.thump(at, { f: 130 * p, drop: 90, dur: 0.09, gain: 0.16 * g * k, out });
      S.ring(at, { f: 210 * p, q: 9, dur: 0.14, gain: 0.19 * g * k, attack: 0.004, out });
      S.bandNoise(at, { f: 900 * p, q: 1.2, dur: 0.02, gain: 0.08 * g * k, attack: 0.002, out });
    };
    knock(t, 1);
    knock(t + 0.09 * jit(0.15), 0.7);
    S.bandNoise(t, { f: 520 * p, q: 0.8, dur: 0.06, gain: 0.04 * g, attack: 0.012, sweepTo: 300 * p, out });
  },
};

/**
 * 调用方顺手的别名（第二项是增益倍率）。
 * 只在这里换名字和轻重，别在这儿造新音 —— 新音要有物理来由，写进 RECIPES。
 */
const ALIASES = {
  WHEEL_SEAT: ['SEAT_IN', 1.1],    // 整只轮子落进勾爪，比座管沉
  POST_SEAT: ['SEAT_IN', 0.8],     // 座管滑进立管，管腔里的气被挤出来，轻
};

/** 有意静音：名字留着，免得日后以为是漏配。这些是提示音不是声音，按设计一概不出 */
const MUTED = new Set([
  'HOVER', 'BEEP', 'CHIME', 'POP', 'WHOOSH', 'SWIPE',
  'ERROR', 'ALERT', 'FANFARE', 'SUCCESS', 'ACHIEVEMENT', 'COMPLETE',
]);
export const SFX = new SFXEngine();

/** 首个用户手势时解锁音频（浏览器自动播放策略） */
export function unlockAudio() {
  const go = () => {
    SFX.ensure();
    removeEventListener('pointerdown', go);
    removeEventListener('keydown', go);
  };
  addEventListener('pointerdown', go, { once: false });
  addEventListener('keydown', go, { once: false });
}
