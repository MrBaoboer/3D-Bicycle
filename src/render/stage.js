/**
 * 舞台：渲染器 / 相机 / 光照 / 轨道控制
 *
 * **Y 轴向上，1 单位 = 1 米。** glTF 规范就规定 Y-up，模型是按这个导出的，
 * 所以这里不动 `THREE.Object3D.DEFAULT_UP` —— 改了反而要在加载后补一次旋转。
 * 尺度由 Hope 200 mm 刹车碟标定，见 docs/DEVELOPMENT.md。
 *
 * 取景不靠手调距离：每一步声明「必须完整看到多大一块」（`fit`），
 * 画幅装不下时相机自己后退，界面占掉哪几条边也一并算进去。
 * 少了这一条，手机上主体一定裁边。
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

/**
 * 整车的尺度（米），运镜时长里「目标点挪了多远」按它折算。
 * 这台车轴距 1.155 m —— 目标点横跨整台车算一趟大的，挪个把厘米不算。
 */
const SCENE_SPAN = 1.2;

/**
 * 屏幕上的动静小于这个数就不动画，直接落位。
 * 0.06 大致相当于：主体在画面上挪不到百分之三、或者转不到五度、或者缩放不到三个点。
 * 这个量级的位移看不出来，而为它跑半秒动画只会让人以为「有什么变了」。
 */
const TINY = 0.06;

/** 转过这么多度才值得在中段把镜头往外鼓一下；以下的只是多余的呼吸 */
const BULGE_FROM = 40;

/**
 * 三档画质预算。
 *
 * 这台车有 32 根一根根建出来的辐条、一整条链、几十颗倒角螺丝 ——
 * 高对比细边到处都是，镜头又一直在缓慢环绕，抗锯齿不能省。
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
     * **不投影。** 这一份要看的是零件与零件怎么接上，而一台自行车投在地上的影子
     * 是一大片辐条、链条、叉腿交织的噪点，面积常常比主体本身还大 ——
     * 近景步骤里它就摊在主体旁边，眼睛先被它勾过去。
     * 去掉之后主体浮在一块干净的台面上，边缘一清二楚。
     *
     * 顺带省掉每帧一张 2048² 的阴影贴图与一整趟投影渲染。
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
     * 底光。没有影子之后，向下那一面完全靠它交代形体 ——
     * 半球光的下半色原本压得很暗（0x3a3630），是为了让影子显得有分量；
     * 影子不在了，那一档就只剩「底下糊成一团」。抬亮并转冷一点，
     * 底面的转折才读得出来。
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

  /**
   * 界面遮住了多少画面。底部那条常驻栏一变高、右边那张说明卡一摊开，
   * 取景就得重算 —— 否则车会坐在字上，或者半个车被卡片盖住。
   */
  setSafeArea({ top = 0, bottom = 0, left = 0, right = 0 }) {
    const s = this.safe;
    if (s.top === top && s.bottom === bottom && s.left === left && s.right === right) return;
    this.safe = { top, bottom, left, right };
    // 动手的时候不重新取景：提示文字每换一行安全区就变，机位会一直缓慢地飘
    if (this.held) return;
    if (this._lastFrame) this.setRecommended(this._lastFrame, { keepUser: true, layout: true });
  }

  /**
   * 画面中真正可用的那一块。
   *
   * 两件事：可用区占整幅的比例（决定要退多远），以及可用区的中心相对
   * 整幅中心偏了多少（决定主体要往哪边挪）。四条边各算各的 ——
   * 右边那张说明卡在宽屏上占掉 300 px，只算上下两条边的话，
   * 「为什么」卡片会正好压在这一步要看的那个零件上。
   */
  #viewport() {
    const w = this.canvas.clientWidth || innerWidth || 1;
    const h = this.canvas.clientHeight || innerHeight || 1;
    /*
     * 下限：界面再厚也不能把主体挤成一枚邮票，但也不能高到装不下。
     * 0.46 这一档是被手机上拧面盖那一步定住的：竖屏 844 px 里，
     * 顶栏加上螺丝排、扭矩表、旁白与按钮实测占掉 440 px，真正空着的只剩 46%。
     * 下限给到 0.62 的话，取景按 62% 算距离，主体就一定越过读数的上沿 ——
     * 画面上方空着一大片，而要拧的那几颗压在读数边上。
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
   * 装下这一块需要多远。
   *
   * 竖屏手机的水平视场只有十来度 —— 按垂直视场调好的距离，横过来一定裁边。
   * 两个方向各算一次，取远的那个，而且各按**自己那一侧的可用区**算。
   *
   * `d` 是主体沿视线方向的半深，可省。**近景不能省**：
   * 主转点轴那一步主体长 211 mm 而机位只有 190 mm 远，最靠近相机的那个角
   * 实际只有九十来毫米远，投影出来比按中心算的宽四成，右边整整裁掉 100 像素。
   * 判据要落在**离相机最近的那一层**上，于是需要的距离就是「中心该有的距离 + 半深」。
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
   * @param {{keepUser?:boolean, layout?:boolean}} [mode] keepUser：只是拿旧声明重算距离
   *   （画幅变了、界面高度变了），不能清掉 userTook —— 否则用户刚转到顺手的角度，
   *   随便哪行提示换个字数，镜头就自己溜回去。
   *   layout：这一次是界面变了要重新让位，不是换步。走快档、不鼓 —— 它是纠版式，
   *   不是叙事的一部分，慢悠悠地飘过去反而像画面自己在动。
   */
  setRecommended(o = {}, { keepUser = false, layout = false } = {}) {
    const { az = 45, el = 18, dist, target = new THREE.Vector3(), ease = 1.0, fit } = o;
    this._lastFrame = { ...o, target };
    const t = target.clone();

    /*
     * dist 是「宽画幅下的取景意图」，fit 是「必须完整看到多大一块」。
     * 声明了 dist 就以它为下限，fit 只把相机再往后推 —— 宽屏上的取景意图原样保留。
     * **没声明 dist 时由 fit 独自定距**：否则近景步骤会被一个默认值钉在整车距离上，
     * 而 fit 从不拉近，把立特写就永远是一张整车照。
     */
    const fitD = fit ? this.fitDistance(fit) * 1.06 : undefined;
    const d = fitD !== undefined ? Math.max(dist ?? 0, fitD) : (dist ?? 3);

    const ar = (az * Math.PI) / 180;
    const view = this.#viewport();

    /*
     * 把主体挪进可用区的正中。机位目标往留白多的那一边推，主体就往反方向让。
     * 竖向靠世界 +Y 就够；横向必须用**相机自己的右向量** ——
     * 世界 X 在斜看时既有横向分量也有纵深分量，拿它推会把主体推近或推远。
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
   * **在轨道坐标里走，不在世界坐标里走。** 世界坐标直线插值的问题不是不平滑，
   * 而是它走的是弦不是弧：左脚踏与右脚踏这两步隔着 180°，直线插值让相机
   * 笔直穿过整台车。改成方位角、仰角、距离各自插值，相机就是绕着主体转过去的。
   *
   * 三条细节：
   *  · 方位角走**最短的那一边**（归一到 ±180），否则会绕远路转 300°；
   *  · 距离按**几何插值**（等比），不是等差 —— 从 5 m 推到 0.3 m 时等差插值
   *    前半程几乎不动、后半程猛扑；
   *  · 转得多的时候，中段把距离往外鼓一点：避开中途蹭到车身，
   *    读起来也正是真人换机位的样子 —— 先退开，转过去，再推进。
   *
   * 时长按「这一趟有多远」现算：小幅调整半秒收，转半圈一秒七。
   *
   * **走不动的就别走。** 镜头动是有代价的：读的人会以为「有什么变了」而重新找一遍。
   * 所以两处克制：
   *   看不出来的位移直接落位，一帧都不animate（下面的 TINY）；
   *   界面自己引起的重新取景（说明卡摊开、读数出现、转屏）只用来纠版式，
   *     不是叙事的一部分 —— 走快档，也不鼓。
   * 中段外扩同样只留给真的绕过半个车身那几趟，小幅调整时它只是一次多余的呼吸。
   *
   * @param {number} ease 步骤声明的时长系数
   * @param {{layout?:boolean}} [o] layout：这一次只是界面变了要重新让位，不是换步
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
     * 这一趟在**屏幕上**有多大动静。全按世界尺度算是不行的：
     * 目标点挪 4 cm，在整车照上什么也看不出，在一颗螺栓的近景里却是半个画面。
     * 折算成「占画面的几成」，判据才在近景与全景上都成立。
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
     * 界面引起的重新取景不能把**正在走的那一趟**掐短。
     * 动手的那几步会在 enter() 里摆出扭矩表与螺丝排，安全区当场变一次，
     * 于是一趟一秒四的环绕被一次纠版式压成 0.32 秒 —— 落点是对的，
     * 可那一下看着就是「走到一半突然赶过去」。
     * 快档只对「原本就没在走」的那一次生效。
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
      // 只有真的要绕过去时才鼓。BULGE_FROM 以下这一下只是多余的呼吸
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
   * 动手的步骤里连「界面高度变了重新取景」也冻住 —— 手上对位时画面不能自己飘。
   * 引擎每翻一步解开一次。
   *
   * **但要晚冻两帧。** 扭矩表与那一排螺丝是这一步 `enter()` 里才摆出来的，
   * 它们占掉底下一大条；而 hold 是同一个 enter 里同步调的，
   * 立刻冻上就意味着这一条永远算不进取景 —— 实测手机上拧面盖那一步，
   * 主体被压在读数上沿的一线，上面空着大半屏。ResizeObserver 下一帧才回调，
   * 让那一次让位先落地，再冻。
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
   * 转到哪儿就停在哪儿，不做「松手几秒自动缓回」，那在动手对位时是灾难。
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
      /*
       * 补间另给一档 250 ms。补间是纯插值，跳多远都不会走过头，
       * 而按 50 ms 封顶的代价很实在：弱机上（headless 软件渲染实测十来帧）
       * 每秒只推进 0.5 秒的量，一段一秒的展开要演两秒多；软件渲染那档更慢六倍。
       * 越是卡的机器动画越长，正好反了。
       */
      const slow = Math.min(raw, 0.25);
      const t = this.timer.getElapsed();
      /*
       * 相机的缓动另给一档 250 ms 的上限。
       * 缓动系数是 1 − 0.001^(dt·ease)，按真实流逝的时间复合本来是帧率无关的；
       * 可 dt 一旦被压到 50 ms，弱机上（实测软件渲染只有 2–3 fps）每秒就只推进
       * 0.1–0.15 秒的量，换一步要几秒才到位 —— 越是卡的机器，镜头越慢。
       */
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
