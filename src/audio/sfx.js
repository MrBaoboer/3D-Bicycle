/**
 * 音效引擎 —— 实时程序合成，一个音频文件都不载
 *
 * 不用采样，是因为这里的声音必须可参数化：棘轮空转的咔哒要能随手腕越转越快，
 * 螺纹旋进要随进给深度往上走，同一记扭力咔要能按扳手规格升降两个半音。
 * 固定采样做不到，而且十几个 wav 比这个文件大两个数量级。
 *
 * 合成方法是物理导向的：撞击 = 一记宽带瞬态 + 一组指数衰减的模态；
 * 摩擦、气流是带通噪声加包络。这不是「像」，这就是这些声音的产生方式。
 *
 * 与木作那套最要紧的区别在衰减比：木头内耗大，高次模态先死，所以听着钝；
 * 钢内耗极低，各阶衰减时间差不多，泛音一起响到最后 —— 金属味就是从这儿来的。
 * 改配方时别只动频率，衰减比动错了，扭力扳手立刻变成敲木头。
 *
 * 排程一律走 AudioContext.currentTime。setTimeout 的抖动有几十毫秒，
 * 一串棘轮咔哒会被抖成烂泥。
 */

/** 半音 → 频率倍率（基频由每个音自己给，这里只出倍率） */
export const semi = (n) => Math.pow(2, n / 12);

/** 主总线音量。静音是把它推到 0，不是拆图 */
const MASTER = 0.85;

/**
 * 切后台停掉、回来要接着放的循环音。
 * 打气这一步的气流声是跟着动画走的，人回来动画还在放，声音就得接上；
 * 若调用方是「按住才打气」，指针早已 cancel，那时它根本不在 _loops 里。
 */
const RESUMED_LOOPS = new Set(['AIR_PUMP']);

class SFXEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.bus = null;
    this.masterGain = null;
    this.noiseBuf = null;
    this._loops = new Map();
    this._held = null;
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

    // 主总线：限幅 + 总音量。拧一串螺栓时几个音会叠在一起，不压会糊。
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 22;
    comp.ratio.value = 5;
    comp.attack.value = 0.003;
    comp.release.value = 0.14;
    const master = ctx.createGain();
    master.gain.value = this.enabled ? MASTER : 0;
    comp.connect(master).connect(ctx.destination);
    this.bus = comp;
    this.masterGain = master;

    // 白噪声缓冲（2 s，循环取用）—— 摩擦、气流、撞击瞬态都从这里取
    const n = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;

    return ctx;
  }

  setEnabled(v) {
    this.enabled = v;
    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(v ? MASTER : 0, this.ctx.currentTime, 0.05);
    }
  }

  get t() { return this.ctx ? this.ctx.currentTime : 0; }

  // ── 基元 ──────────────────────────────────────────

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

  /**
   * 带通滤过的噪声：摩擦、气流、撞击瞬态都用它。
   * @param {object} o.am 浅调幅 { rate, depth } —— 黏滑、过牙、活塞往复这类周期性
   */
  bandNoise(t, {
    f = 1200, q = 2.4, dur = 0.12, gain = 0.3,
    attack = 0.004, sweepTo = null, type = 'bandpass', decayShape = 2.2, am = null,
  } = {}) {
    const ctx = this.ctx;
    const { out } = this._noise(t, dur, 1);
    const bp = ctx.createBiquadFilter();
    bp.type = type;
    bp.frequency.setValueAtTime(f, t);
    bp.Q.value = q;
    // 上扫下扫都走这一条：流速升高（打气）往上，能量泄掉（滑动）往下
    if (sweepTo) bp.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), t + dur);
    const g = ctx.createGain();
    const end = t + dur * decayShape;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    if (am) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = am.rate ?? 14;
      const la = ctx.createGain();
      la.gain.value = gain * (am.depth ?? 0.4);
      lfo.connect(la).connect(g.gain);
      lfo.start(t);
      lfo.stop(end + 0.05);
    }
    out.connect(bp).connect(g).connect(this.bus);
    return g;
  }

  /**
   * 模态组：一组指数衰减的正弦。
   * @param {number[]} ratios 相对基频的模态比（自由-自由细长件弯曲近似 1 : 2.76 : 5.4 : 8.9）
   * @param {number[]} decays 各模态衰减时间（秒）—— 金属给得平，越平越金属
   */
  modes(t, {
    f0 = 700, ratios = [1, 2.76, 5.4], decays = [0.18, 0.1, 0.06],
    amps = [1, 0.5, 0.25], gain = 0.3, detune = 0, wave = 'sine', attack = 0.003,
  } = {}) {
    const ctx = this.ctx;
    ratios.forEach((r, i) => {
      const osc = ctx.createOscillator();
      osc.type = wave;
      const f = f0 * r * (1 + (Math.random() - 0.5) * detune);
      osc.frequency.setValueAtTime(f, t);
      const g = ctx.createGain();
      const amp = gain * (amps[i] ?? 0.3);
      const dec = decays[i] ?? decays[decays.length - 1];
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(amp, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
      osc.connect(g).connect(this.bus);
      osc.start(t);
      osc.stop(t + dec + 0.05);
    });
  }

  /** 低频冲击：质量被挡住的那一下（落进勾爪、插到底、活塞磕缸底） */
  thump(t, { f = 92, drop = 40, dur = 0.42, gain = 0.5 } = {}) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, drop), t + dur * 0.7);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.bus);
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

  /** 循环音，返回停止函数 */
  loop(id, o = {}) {
    const ctx = this.ensure();
    if (!ctx || !this.enabled) return () => {};
    const fn = LOOPS[id];
    if (!fn) return () => {};
    this.stopLoop(id);
    const stop = fn(this, o);
    this._loops.set(id, { stop, o });
    return () => { stop(); this._loops.delete(id); };
  }

  stopLoop(id) {
    const r = this._loops.get(id);
    if (r) { r.stop(); this._loops.delete(id); }
  }

  /** 切后台：循环音全停，只记下回来该接上的那些 */
  suspendLoops() {
    this._held = [...this._loops.entries()].filter(([id]) => RESUMED_LOOPS.has(id));
    for (const [, r] of this._loops) r.stop();
    this._loops.clear();
  }

  resumeLoops() {
    const held = this._held || [];
    this._held = null;
    for (const [id, r] of held) this.loop(id, r.o);
  }
}

// ══════════════════════════════════════════════════════════
// 音效表
//
// 只保留装车时手底下真会发出的声音：钢件、螺纹、气。
// 界面本身几乎不出声 —— 一步一记轻触足够，多了就成了噪音。
// ══════════════════════════════════════════════════════════

const RECIPES = {
  // ── 工具 ──────────────────────────────────────────

  /**
   * 棘轮扳手空转：棘爪每越过一个齿就被弹簧压回去，磕在下一个齿面上。
   * 声音全在瞬态 —— 3.6 kHz 是钢片对齿面那一下，1.9 kHz 是扳手头（实心钢块，20 ms 就没）。
   * 手腕是加速的，所以齿间隔按 accel 递减；下限 22 ms 是棘爪弹回来的时间，再快就不真了。
   * @param {object} o { count 齿数, accel 每齿间隔倍率(<1 越转越快), spacing 首个间隔 }
   */
  RATCHET: (S, t, p, g, o = {}) => {
    const n = Math.max(1, Math.round(o.count ?? 7));
    const accel = o.accel ?? 0.9;
    let dt = 0;
    let step = o.spacing ?? 0.075;
    for (let i = 0; i < n; i++) {
      // 每齿力道不一样，±15% —— 完全等响的咔哒一听就是电子音
      const v = 0.85 + Math.random() * 0.3;
      const q = p * (0.97 + Math.random() * 0.06);
      S.bandNoise(t + dt, { f: 3600 * q, q: 2.2, dur: 0.006, gain: 0.09 * g * v, attack: 0.0008 });
      S.modes(t + dt, {
        f0: 1900 * q, ratios: [1, 2.7], decays: [0.02, 0.013],
        amps: [1, 0.35], gain: 0.07 * g * v, attack: 0.0012,
      });
      dt += step;
      step = Math.max(0.022, step * accel);
    }
  },

  /**
   * 螺纹旋进：牙侧互相刮擦，是一连串极小的黏-滑。噪声主体 2.2 kHz（加工纹路的尺度）。
   * 进给越深、啮合圈数越多、接触刚度越高，所以整段是个上扫，且起点随 depth 抬高；
   * 每转一圈过一次牙，用 ~13 Hz 的浅调幅表现，这就是「沙沙」的节律来源。
   * @param {object} o { depth 0..1 进给深度, dur }
   */
  THREAD_TURN: (S, t, p, g, o = {}) => {
    const depth = Math.min(1, Math.max(0, o.depth ?? 0));
    const dur = o.dur ?? 0.34;
    const f0 = 2200 * p * (1 + depth * 0.35);
    S.bandNoise(t, {
      f: f0, q: 1.6, dur, gain: 0.07 * g,
      sweepTo: f0 * 1.5, attack: dur * 0.15, decayShape: 1.1,
      am: { rate: 13 + depth * 6, depth: 0.5 },
    });
  },

  /**
   * 扭力扳手到点 —— 全片最要紧的一记。凸轮越过死点，扳手头「折」一下磕在挡块上：
   *  · 0–2 ms  钢对钢的硬碰撞，重心 5.2 kHz，「脆」全靠这一下，起音 0.6 ms
   *  · 之后    筒身弯曲模态 1 : 2.76 : 5.4 : 8.9，衰减时间给得几乎一样平 ——
   *            钢的内耗极低，泛音陪着基频一起响完，这是金属味的唯一来源
   *  · 190 Hz  手握着筒身，低频被掌心吃掉大半，只留一记短促的推力
   *  · +14 ms  凸轮复位磕回原位，弱一个数量级，别盖过正音
   */
  TORQUE_CLICK: (S, t, p, g) => {
    S.bandNoise(t, { f: 5200 * p, q: 0.9, dur: 0.008, gain: 0.34 * g, attack: 0.0006 });
    S.bandNoise(t, { f: 2600 * p, q: 3.0, dur: 0.02, gain: 0.18 * g, attack: 0.001 });
    S.modes(t, {
      f0: 1180 * p, ratios: [1, 2.76, 5.4, 8.9], decays: [0.13, 0.12, 0.1, 0.085],
      amps: [1, 0.72, 0.5, 0.3], gain: 0.32 * g, detune: 0.012, attack: 0.0012,
    });
    S.thump(t, { f: 190 * p, drop: 110, dur: 0.07, gain: 0.12 * g });
    S.modes(t + 0.014, {
      f0: 1180 * p, ratios: [1, 2.76, 5.4], decays: [0.05, 0.045, 0.035],
      amps: [1, 0.5, 0.3], gain: 0.06 * g, attack: 0.0012,
    });
  },

  // ── 装配 ──────────────────────────────────────────

  /**
   * 快拆手柄压过死点、贴到叉腿上。此刻整套件正被夹紧 ——
   * 夹紧就是大阻尼，所以没有余音：高频只剩 1.1 kHz 的钝响（不是扭力扳手那种 5 kHz 的脆），
   * 主体两个 300 Hz 上下的模态 60 ms 内压没，再加一记 120 Hz 的压紧推力。
   */
  QR_SNAP: (S, t, p, g) => {
    S.bandNoise(t, { f: 1100 * p, q: 1.0, dur: 0.016, gain: 0.2 * g, attack: 0.0015, sweepTo: 520 * p });
    S.modes(t, {
      f0: 300 * p, ratios: [1, 2.3], decays: [0.06, 0.04],
      amps: [1, 0.35], gain: 0.26 * g, attack: 0.002,
    });
    S.thump(t, { f: 120 * p, drop: 62, dur: 0.13, gain: 0.3 * g });
  },

  /**
   * 零件滑到位坐实（前轮落进勾爪、座管插到底）：
   * 先是贴合面的一小段滑动摩擦，中心从 1.5 kHz 往下走（接触面越贴越多，高频先没）；
   * 末端质量被挡住 —— 100→50 Hz 的低频冲击，加车架回应的 340 Hz 中频模态；
   * 座管那一路还有管腔里的空气被挤出来，所以再叠一层低通气流。
   * @param {object} o { slide 滑动段时长 }
   */
  SEAT_IN: (S, t, p, g, o = {}) => {
    const slide = o.slide ?? 0.1;
    S.bandNoise(t, {
      f: 1500 * p, q: 0.9, dur: slide, gain: 0.05 * g,
      sweepTo: 800 * p, attack: slide * 0.4, decayShape: 1.15,
    });
    // 低频只给到这个量：再多就压住总线，把后面那记扭力咔一起吃掉
    const s = t + slide;
    S.thump(s, { f: 100 * p, drop: 50, dur: 0.24, gain: 0.17 * g });
    S.modes(s, {
      f0: 340 * p, ratios: [1, 2.6, 4.9], decays: [0.1, 0.06, 0.04],
      amps: [1, 0.35, 0.14], gain: 0.11 * g,
    });
    S.bandNoise(s, { f: 420 * p, q: 0.7, dur: 0.09, gain: 0.05 * g, sweepTo: 220 * p, attack: 0.012 });
  },

  /**
   * 方向错了 —— 不给「失败音」。物理上就是零件顶住了：本该滑进去的面互相抵着，
   * 敲上去发闷、不响。两个相差约 4.5 Hz 的模态叠一起，慢慢拍一下，
   * 听感是「没对上」而不是「你错了」。起音留到 12 ms（不是咔），刺不着人；
   * 音高从头到尾不动，绝不下行 —— 一下行就成了游戏机的失败提示。
   */
  WRONG: (S, t, p, g) => {
    S.modes(t, {
      f0: 302 * p, ratios: [1, 1.015], decays: [0.3, 0.28],
      amps: [1, 0.9], gain: 0.11 * g, attack: 0.012,
    });
    S.bandNoise(t, { f: 520 * p, q: 0.8, dur: 0.06, gain: 0.03 * g, attack: 0.012, sweepTo: 300 * p });
  },

  // ── 界面：只有两记 ────────────────────────────────

  /** 最小的一记：指甲弹在铝管上 —— 只有高次，只有 20 ms，一点低频都不留 */
  TICK: (S, t, p, g) => {
    S.modes(t, {
      f0: 2300 * p, ratios: [1, 2.4], decays: [0.022, 0.014],
      amps: [1, 0.3], gain: 0.06 * g, attack: 0.0015,
    });
  },

  /** 比 TICK 厚一点，用在按下去有位移的控件上：多一层 40 ms 的中频模态当「身体」 */
  TAP: (S, t, p, g) => {
    S.modes(t, {
      f0: 1250 * p, ratios: [1, 2.76, 5.4], decays: [0.04, 0.028, 0.018],
      amps: [1, 0.34, 0.12], gain: 0.075 * g, attack: 0.0015,
    });
    S.thump(t, { f: 150 * p, drop: 96, dur: 0.05, gain: 0.05 * g });
  },

  // ── 气 ────────────────────────────────────────────

  /**
   * 打气一下（推程）：空气挤过单向阀那个小孔，是湍流噪声，峰值 1.4 kHz；
   * 活塞越推越快，流速升、噪声重心跟着上到 2.2 kHz —— 所以这里的扫频是往上的。
   * 底下垫一层 300 Hz 的筒身鼓风，到底时活塞磕缸底，补一记 150 Hz 闷响。
   * @param {object} o { dur 一程时长 }
   */
  AIR_PUMP: (S, t, p, g, o = {}) => {
    const dur = o.dur ?? 0.26;
    S.bandNoise(t, {
      f: 1400 * p, q: 0.8, dur, gain: 0.09 * g,
      sweepTo: 2200 * p, attack: dur * 0.45, decayShape: 1.05,
    });
    S.bandNoise(t, {
      f: 300 * p, q: 0.6, dur: dur * 0.9, gain: 0.04 * g,
      attack: dur * 0.5, decayShape: 1.05,
    });
    S.thump(t + dur * 0.92, { f: 150 * p, drop: 70, dur: 0.1, gain: 0.1 * g });
  },
};

/**
 * 调用方顺手的别名（第二项是增益倍率）。
 * 只在这里换名字和轻重，别在这儿造新音 —— 新音要有物理来由，写进 RECIPES。
 */
const ALIASES = {
  WHEEL_SEAT: ['SEAT_IN', 1.1],    // 整只前轮落进勾爪，比座管沉
  POST_SEAT: ['SEAT_IN', 0.8],
  LEVER_CLOSE: ['QR_SNAP', 1],
  BOLT_TURN: ['THREAD_TURN', 1],
  TORQUE_OK: ['TORQUE_CLICK', 1],
  STEP_NEXT: ['TICK', 1],
  UI_TICK: ['TICK', 1],
  UI_TAP: ['TAP', 1],
};

/**
 * 有意静音：名字留着，免得日后以为是漏了。
 * 这些都是提示音而不是声音 —— 装车现场没有「叮」，也没有胜利小号。
 */
const MUTED = new Set([
  'HOVER', 'BEEP', 'CHIME', 'POP', 'WHOOSH', 'SWIPE',
  'ERROR', 'ALERT', 'FANFARE', 'SUCCESS', 'ACHIEVEMENT', 'COMPLETE',
]);

// ── 循环音 ──
const LOOPS = {
  /**
   * 连续打气：一推一拉。
   * 不排队、不用定时器 —— 整个周期由图里的 LFO 驱动：
   * 正弦抬正后取四次方，得到前陡后缓的一口气（推程猛、回程松），
   * 同一路信号也去推带通中心频率，流速快的时候声音自然亮起来。
   * 底噪 0.012 是活塞密封圈一路漏的那点气，人松手前不该完全安静。
   * @param {object} o { period 一推一拉的周期(秒), gain }
   */
  AIR_PUMP: (S, o = {}) => {
    const ctx = S.ctx, t = ctx.currentTime;
    const period = Math.max(0.25, o.period ?? 0.85);
    const amp = o.gain ?? 1;
    const { out, src } = S._noise(t, 3600, 1);

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1300;
    bp.Q.value = 0.8;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.01 * amp, t + 0.25);

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 1 / period;
    const shaper = ctx.createWaveShaper();
    const N = 1024;
    const curve = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const x = (i / (N - 1)) * 2 - 1;
      curve[i] = Math.pow((x + 1) / 2, 4); // 0..1，峰窄谷宽
    }
    shaper.curve = curve;

    const puff = ctx.createGain();
    puff.gain.value = 0.055 * amp; // 按住不放的声音，均方值要低于任何一记单发音
    const bright = ctx.createGain();
    bright.gain.value = 1100; // 中心频率随气流从 1.3 kHz 推到 2.4 kHz

    lfo.connect(shaper);
    shaper.connect(puff).connect(g.gain);
    shaper.connect(bright).connect(bp.frequency);
    lfo.start(t);
    out.connect(bp).connect(g).connect(S.bus);

    return () => {
      try {
        const now = ctx.currentTime;
        g.gain.cancelScheduledValues(now);
        g.gain.setTargetAtTime(0.0001, now, 0.08);
        src.stop(now + 0.4);
        lfo.stop(now + 0.4);
      } catch { /* 已停止 */ }
    };
  },
};

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
