/**
 * 舞台：渲染器 / 相机 / 光照 / 轨道控制
 *
 * Y 轴向上（glTF 规范，不动 DEFAULT_UP），1 单位 = 1 米，标定见 docs/DEVELOPMENT.md。
 * 取景按声明现算：每一步给出必须完整看到的范围（`fit`），装不下时相机后退，
 * 界面占掉的边一并计入 —— 少了这条，窄画幅上主体裁边。
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Ease, reducedMotion } from '../util/tween.js';

/** 角度差归一到 ±180 —— 运镜要走最短的那一边，不能绕远路转 300° */
const wrapDeg = (d) => ((d % 360) + 540) % 360 - 180;

/** 轨道坐标 → 世界坐标 */
function orbit(target, az, el, dist) {
  const ar = (az * Math.PI) / 180;
  const er = (el * Math.PI) / 180;
  return new THREE.Vector3(
    target.x + dist * Math.cos(er) * Math.cos(ar),
    target.y + dist * Math.sin(er),
    target.z + dist * Math.cos(er) * Math.sin(ar),
  );
}

/** 整车尺度（米，轴距 1.155 m）：运镜时长里「目标点挪了多远」按它折算 */
const SCENE_SPAN = 1.2;

/**
 * 屏幕上的动静小于这个数就直接落位，不动画。0.06 约合主体平移 3%、旋转 5° 或缩放 3%，
 * 这个量级看不出来，为它跑动画只会让人以为有什么变了。
 */
const TINY = 0.06;

/** 中段外扩只给转角超过此值的运镜；小幅调整不鼓 */
const BULGE_FROM = 40;

/**
 * 三档画质预算。抗锯齿三档都开：32 根辐条、整条链、几十颗螺丝全是高对比细边，
 * 镜头又长期缓慢环绕，省不得。
 */
const TIERS = {
  low: { antialias: true, maxPixelRatio: 1.5 },
  mid: { antialias: true, maxPixelRatio: 1.75 },
  high: { antialias: true, maxPixelRatio: 2 },
};

/** 按设备能力粗分档：显存与核数都探不到时，宁可给低的 */
export function detectTier() {
  const mem = navigator.deviceMemory || 4;
  const cores = navigator.hardwareConcurrency || 4;
  const coarse = matchMedia('(pointer: coarse)').matches;
  if (mem <= 4 || cores <= 4) return 'low';
  if (coarse || mem <= 8) return 'mid';
  return 'high';
}

export class Stage {
  /** @param {HTMLCanvasElement} canvas @param {'low'|'mid'|'high'} tier */
  constructor(canvas, tier = 'high') {
    this.canvas = canvas;
    this.tier = TIERS[tier] ? tier : 'high';
    const q = TIERS[this.tier];
    this.quality = q;

    // Timer 而非 Clock（Clock 自 r183 起废弃）。connect(document) 接上页面可见性：
    // 标签页切走再回来时计时器归零，那一帧不会甩出一个几十秒的 dt。
    this.timer = new THREE.Timer();
    this.timer.connect(document);

    const renderer = new THREE.WebGLRenderer({
      canvas, antialias: q.antialias, powerPreference: 'high-performance', stencil: false,
    });
    renderer.setPixelRatio(Math.min(devicePixelRatio, q.maxPixelRatio));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    /*
     * 不投影：自行车的影子是一大片辐条、链条交织的噪点，近景里抢视线。
     * 连带的光照与取景调整见 docs/DEVELOPMENT.md「不投影」。
     */
    this.renderer = renderer;

    this.scene = new THREE.Scene();

    // 环境光照走 PMREM + RoomEnvironment，不引外部 HDR 文件。
    // 这台车大面积是阳极氧化铝与碳纤维清漆，没有环境反射就是一块死板的塑料。
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = 1.0;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.01, 200);
    this.camera.position.set(2.4, 1.4, 3.0);

    // ── 布光 ──
    this.key = new THREE.DirectionalLight(0xfff4e6, 2.2);
    this.key.position.set(3, 5, 4);
    this.scene.add(this.key, this.key.target);

    this.fill = new THREE.DirectionalLight(0xcfe0f0, 0.7);
    this.fill.position.set(-4, 2, -1);
    this.scene.add(this.fill);

    this.rim = new THREE.DirectionalLight(0xffffff, 1.1);
    this.rim.position.set(-2, 3, -5);
    this.scene.add(this.rim);

    /*
     * 底光。不投影，向下那一面全靠它交代形体：下半色要亮且偏冷，
     * 压暗的话底面糊成一团。
     */
    this.ambient = new THREE.HemisphereLight(0xdfe8f2, 0x8a8f96, 0.6);
    this.scene.add(this.ambient);

    const controls = new OrbitControls(this.camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.enablePan = false;
    controls.rotateSpeed = 0.8;
    controls.zoomSpeed = 0.9;
    this.controls = controls;

    /** 界面遮住的四条边（像素）—— 取景按剩下那块画面算 */
    this.safe = { top: 0, bottom: 0, left: 0, right: 0 };

    /**
     * 本步该停在哪儿。**用轨道坐标记**（目标点 + 方位角 + 仰角 + 距离），
     * `pos` 只是它在世界里的投影，留着给「到位了没有」这类判断用。
     */
    this.recommend = {
      target: new THREE.Vector3(), az: 45, el: 18, dist: 3,
      pos: this.camera.position.clone(), enabled: true,
    };
    /** 正在走的那一次运镜；走完置空 */
    this.shot = null;
    this.userTook = false;
    controls.addEventListener('start', () => { this.userTook = true; this.shot = null; });

    // resize 合并到下一帧：手机上地址栏收起、软键盘进出会连着来十几次
    this._onResize = () => {
      if (this._resizeRaf) return;
      this._resizeRaf = requestAnimationFrame(() => { this._resizeRaf = 0; this.resize(); });
    };
    addEventListener('resize', this._onResize);
    this.resize();

    /** @type {Set<(dt:number,t:number)=>void>} */
    this.updaters = new Set();
    this.running = false;
  }

  resize() {
    const w = this.canvas.clientWidth || innerWidth;
    const h = this.canvas.clientHeight || innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this._lastFrame) this.setRecommended(this._lastFrame, { keepUser: true, layout: true });
  }

  /** 界面遮挡变了（底栏变高、说明卡摊开）就重新取景，否则主体会被界面盖住 */
  setSafeArea({ top = 0, bottom = 0, left = 0, right = 0 }) {
    const s = this.safe;
    if (s.top === top && s.bottom === bottom && s.left === left && s.right === right) return;
    this.safe = { top, bottom, left, right };
    // 动手的时候不重新取景：提示文字每换一行安全区就变，机位会一直缓慢地飘
    if (this.held) return;
    if (this._lastFrame) this.setRecommended(this._lastFrame, { keepUser: true, layout: true });
  }

  /**
   * 画面中真正可用的那一块：占整幅的比例（决定退多远）与中心偏移（决定主体往哪挪）。
   * 四条边各算各的 —— 宽屏上右侧说明卡占约 300 px，只算上下两条边，卡片会压在主体上。
   */
  #viewport() {
    const w = this.canvas.clientWidth || innerWidth || 1;
    const h = this.canvas.clientHeight || innerHeight || 1;
    /*
     * 可用区下限。0.46 由手机拧面盖一步定住：竖屏 844 px 里界面实占 440 px；
     * 下限给高（如 0.62），主体就会越进被遮的读数区。
     */
    const freeH = Math.max(h * 0.46, h - this.safe.top - this.safe.bottom);
    const freeW = Math.max(w * 0.46, w - this.safe.left - this.safe.right);
    return {
      fracV: freeH / h,
      fracH: freeW / w,
      // 机位目标往留白多的那一边挪，主体就往另一边让 —— 正好落进可用区的正中
      lift: (this.safe.bottom - this.safe.top) / (2 * h),
      shift: (this.safe.right - this.safe.left) / (2 * w),
    };
  }

  /**
   * 装下这一块需要多远。水平与垂直各算一次取远者，各按自己那一侧的可用区 ——
   * 竖屏的水平视场只有十来度，只按垂直算横向必裁边。
   * `d` 是主体沿视线的半深，近景不能省：主体深度与机位距离同量级时，
   * 离相机最近的那层投影明显更宽（主转点轴一步宽四成）。需要的距离 = 中心距离 + 半深。
   */
  fitDistance({ r = 0, h = r, d = 0 }) {
    const view = this.#viewport();
    const vHalf = (this.camera.fov * Math.PI) / 360;
    const hHalf = Math.atan(Math.tan(vHalf) * this.camera.aspect);
    const vFree = Math.atan(Math.tan(vHalf) * view.fracV);
    const hFree = Math.atan(Math.tan(hHalf) * view.fracH);
    return Math.max(h / Math.tan(vFree), r / Math.tan(hFree)) + d;
  }

  /**
   * 设定本步推荐机位。
   * @param {{az?:number, el?:number, dist?:number, target?:THREE.Vector3,
   *          ease?:number, fit?:{r:number,h?:number}}} o
   *   fit 声明这一步必须完整看到的范围；装不下就把相机往后拉，只拉远不拉近。
   * @param {{keepUser?:boolean, layout?:boolean}} [mode] keepUser：拿旧声明重算距离
   *   （画幅或界面变了），不清 userTook —— 清了的话界面一变，
   *   镜头就从用户刚转好的角度溜回推荐位。
   *   layout：界面变化引起的重新让位，不是换步：走快档、不外扩。
   */
  setRecommended(o = {}, { keepUser = false, layout = false } = {}) {
    const { az = 45, el = 18, dist, target = new THREE.Vector3(), ease = 1.0, fit } = o;
    this._lastFrame = { ...o, target };
    const t = target.clone();

    /*
     * dist 是取景意图的下限，fit 只把相机再往后推。
     * 没声明 dist 时由 fit 独自定距 —— 套默认值会把近景钉在整车距离上，fit 从不拉近。
     */
    const fitD = fit ? this.fitDistance(fit) * 1.06 : undefined;
    const d = fitD !== undefined ? Math.max(dist ?? 0, fitD) : (dist ?? 3);

    const ar = (az * Math.PI) / 180;
    const view = this.#viewport();

    /*
     * 把主体挪进可用区正中：机位目标往留白多的那边推，主体往反方向让。
     * 竖向用世界 +Y；横向必须用相机自己的右向量 ——
     * 世界 X 斜看时带纵深分量，拿它推会把主体推近或推远。
     */
    const vSpan = 2 * d * Math.tan((this.camera.fov * Math.PI) / 360);
    t.y -= vSpan * view.lift;
    // 屏幕右方在世界里的样子：normalize(世界上 × 视线反向)，与 frameOf 量半跨度用的是同一组基底
    const right = new THREE.Vector3(Math.sin(ar), 0, -Math.cos(ar));
    t.addScaledVector(right, vSpan * this.camera.aspect * view.shift);

    this.recommend.target.copy(t);
    this.recommend.az = az;
    this.recommend.el = el;
    this.recommend.dist = d;
    this.recommend.pos.copy(orbit(t, az, el, d));
    if (!keepUser) this.userTook = false;
    this.cameraEase = ease;
    this.key.target.position.copy(t);
    this.#beginShot(ease, { layout });
  }

  /** 相机此刻的轨道坐标（相对 controls.target） */
  #poseNow() {
    const target = this.controls.target.clone();
    const v = this.camera.position.clone().sub(target);
    const dist = Math.max(v.length(), 1e-4);
    return {
      target,
      az: (Math.atan2(v.z, v.x) * 180) / Math.PI,
      el: (Math.asin(Math.max(-1, Math.min(1, v.y / dist))) * 180) / Math.PI,
      dist,
    };
  }

  /**
   * 排一次运镜：从此刻的机位走到推荐机位。
   *
   * 在轨道坐标里插值，不在世界坐标里 —— 世界坐标直线走的是弦不是弧，
   * 隔 180° 的两步会让相机穿过整台车。方位角走最短的一边；距离等比推拉
   * （等差在长距离推近时前慢后猛）；大转角中段把距离外鼓一点避开车身。
   * 时长按这一趟的幅度现算。屏幕上看不出的位移（TINY）直接落位；
   * 界面引起的重新取景走快档、不外扩。详见 docs/DEVELOPMENT.md「换步的运镜」。
   * @param {number} ease 步骤声明的时长系数
   * @param {{layout?:boolean}} [o] layout：界面变化引起的重新让位，不是换步
   */
  #beginShot(ease = 1, { layout = false } = {}) {
    const from = this.#poseNow();
    const to = {
      target: this.recommend.target.clone(),
      az: this.recommend.az,
      el: this.recommend.el,
      dist: this.recommend.dist,
    };
    const dAz = wrapDeg(to.az - from.az);
    const dEl = to.el - from.el;
    const zoom = Math.abs(Math.log(Math.max(to.dist, 1e-3) / Math.max(from.dist, 1e-3)));

    /*
     * 动静折算成「占画面几成」，不按世界尺度：同样挪 4 cm，
     * 整车照上看不出，螺栓近景里是半个画面。
     */
    const span = 2 * to.dist * Math.tan((this.camera.fov * Math.PI) / 360);
    const move = from.target.distanceTo(to.target) / Math.max(span, 1e-4);
    const screen = Math.abs(dAz) / 90 + Math.abs(dEl) / 45 + zoom / 0.5 + move;

    // 看不出来的就直接落位。这一档不是「跳切」—— 按定义它在屏幕上就不可见
    if (screen < TINY) { this.shot = null; this.snapToRecommended(); return; }

    const effort = Math.abs(dAz) / 180 + Math.abs(dEl) / 60 + zoom / 1.6
      + from.target.distanceTo(to.target) / SCENE_SPAN;
    // 用户要求减少动效时几乎直接换过去 —— 一秒多的环绕对前庭敏感的人是负担。
    // 但仍留 0.2 秒：硬切一帧就是这一条要避免的「跳」
    /*
     * 纠版式不能把正在走的那一趟掐短：动手的步骤在 enter() 里摆出螺丝排，
     * 安全区当场变一次，不防的话一趟一秒四的环绕会被压成 0.32 秒。
     * 快档只对原本没在走的那一次生效。
     */
    const running = this.shot && !this.shot.layout
      ? Math.max(0, this.shot.dur - this.shot.t)
      : 0;
    const slow = reducedMotion();
    const dur = slow ? 0.2
      : layout ? Math.max(0.32, running)
        : Math.max(0.45, Math.min(1.7, (0.45 + 0.8 * effort) / (ease || 1)));
    this.shot = {
      from,
      to,
      dAz,
      t: 0,
      dur,
      layout,
      // 外扩只给大转角；BULGE_FROM 以下不鼓
      bulge: slow || layout || Math.abs(dAz) < BULGE_FROM
        ? 0
        : Math.min(0.3, 0.3 * (Math.abs(dAz) - BULGE_FROM) / (180 - BULGE_FROM)),
    };
  }

  snapToRecommended() {
    this.shot = null;
    this.camera.position.copy(this.recommend.pos);
    this.controls.target.copy(this.recommend.target);
    this.controls.update();
  }

  /**
   * 动手的步骤冻住「界面变了就重新取景」—— 手上对位时画面不能自己飘；
   * 引擎每翻一步解开一次。
   * 晚冻两帧：螺丝排在同一个 enter() 里才摆出来，ResizeObserver 下一帧才回调，
   * 立刻冻上，那一次让位就永远算不进取景。
   */
  hold(on) {
    this._holdWanted = !!on;
    if (!on) { this.held = false; return; }
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (this._holdWanted) this.held = true;
    }));
  }

  /**
   * 走这一趟运镜。用户一碰画面就作废（`shot` 在 controls 的 start 上被置空）——
   * 转到哪儿停在哪儿；不做松手自动缓回，那会干扰动手对位。
   */
  update(dt) {
    const s = this.shot;
    if (s && this.recommend.enabled && !this.userTook) {
      s.t = Math.min(s.dur, s.t + dt);
      const k = Ease.smoother(s.t / s.dur);
      const target = s.from.target.clone().lerp(s.to.target, k);
      const az = s.from.az + s.dAz * k;
      const el = s.from.el + (s.to.el - s.from.el) * k;
      // 等比推拉，再叠一个中段外扩：两头都是 0，落点分毫不差
      const dist = s.from.dist * Math.pow(s.to.dist / s.from.dist, k)
        * (1 + s.bulge * Math.sin(Math.PI * k));
      this.camera.position.copy(orbit(target, az, el, dist));
      this.controls.target.copy(target);
      if (s.t >= s.dur) this.shot = null;
    }
    this.controls.update();
  }

  start() {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this._raf = requestAnimationFrame(loop);
      this.timer.update();
      const raw = this.timer.getDelta();
      // 特效与箭头按 50 ms 封顶：它们是逐帧积分的，一帧跳太多会把状态走过头
      const dt = Math.min(raw, 0.05);
      // 补间按真实流逝时间走（封顶 250 ms）。补间是纯插值不会走过头，
      // 跟着 dt 的 50 ms 封顶走，低帧率下动画会整段拖慢
      const slow = Math.min(raw, 0.25);
      const t = this.timer.getElapsed();
      // 运镜同走 250 ms 档：dt 压到 50 ms 的话，低帧率下换一步要几秒才到位
      this.update(slow);
      // 单个 updater 抛错不能连坐这一帧剩下的更新 —— 记录，继续走
      for (const u of this.updaters) {
        try { u(dt, t, slow); } catch (e) { console.error('[updater]', e); }
      }
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  stop() { this.running = false; cancelAnimationFrame(this._raf); }

  setTheme(theme) {
    const dark = theme === 'dark';
    this.scene.background = new THREE.Color(dark ? 0x14161a : 0xeceef2);
    // 深色下底光要收，不然黑车身在深底上没有轮廓；浅色下要给足，那是唯一的底面照明
    this.ambient.intensity = dark ? 0.34 : 0.6;
    this.scene.environmentIntensity = dark ? 0.7 : 1.0;
  }

  dispose() {
    this.stop();
    cancelAnimationFrame(this._resizeRaf);
    removeEventListener('resize', this._onResize);
    this.timer.dispose();
    this.controls.dispose();
    this.envRT?.dispose();
    this.renderer.dispose();
  }
}
