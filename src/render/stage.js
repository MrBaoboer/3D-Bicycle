/**
 * 舞台：渲染器 / 相机 / 光照 / 轨道控制
 *
 * 与榫卯灯笼那套的两处关键差别：
 *  · **Y 轴向上**。glTF 规范就规定 Y-up，模型是按这个导出的，
 *    所以这里不动 THREE.Object3D.DEFAULT_UP —— 改了反而要在加载后补一次旋转。
 *  · 单位是模型单位，不是毫米。真实比例由 calibration 标定后写进 core/scale.js，
 *    取景与行程一律走那个换算，不在这里写死数字。
 *
 * 取景沿用灯笼验过的做法：每一步声明「必须完整看到多大一块」，
 * 画幅装不下时相机自己后退 —— 少了这一条，手机上主体一定裁边。
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/**
 * 三档画质预算。
 *
 * 这台车有 32 根一根根建出来的辐条、一整条链、几十颗倒角螺丝 ——
 * 高对比细边到处都是，镜头又一直在缓慢环绕，抗锯齿不能省。
 */
const TIERS = {
  low: { antialias: true, maxPixelRatio: 1.5, shadow: 0 },
  mid: { antialias: true, maxPixelRatio: 1.75, shadow: 1024 },
  high: { antialias: true, maxPixelRatio: 2, shadow: 2048 },
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
    renderer.shadowMap.enabled = q.shadow > 0;
    renderer.shadowMap.type = THREE.PCFShadowMap;
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
    this.key.castShadow = q.shadow > 0;
    if (q.shadow) {
      this.key.shadow.mapSize.set(q.shadow, q.shadow);
      this.key.shadow.camera.near = 0.5;
      this.key.shadow.camera.far = 20;
      const s = 1.6;
      Object.assign(this.key.shadow.camera, { left: -s, right: s, top: s, bottom: -s });
      this.key.shadow.bias = -0.0006;
      this.key.shadow.normalBias = 0.02;
    }
    this.scene.add(this.key, this.key.target);

    this.fill = new THREE.DirectionalLight(0xcfe0f0, 0.7);
    this.fill.position.set(-4, 2, -1);
    this.scene.add(this.fill);

    this.rim = new THREE.DirectionalLight(0xffffff, 1.1);
    this.rim.position.set(-2, 3, -5);
    this.scene.add(this.rim);

    this.ambient = new THREE.HemisphereLight(0xdfe8f2, 0x3a3630, 0.45);
    this.scene.add(this.ambient);

    // ── 地面：只接影，不抢戏 ──
    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.ShadowMaterial({ opacity: 0.22 }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    const controls = new OrbitControls(this.camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.enablePan = false;
    controls.rotateSpeed = 0.8;
    controls.zoomSpeed = 0.9;
    this.controls = controls;

    /** 界面遮住的上下边（像素）—— 取景按剩下那块画面算 */
    this.safe = { top: 0, bottom: 0 };

    this.recommend = { pos: this.camera.position.clone(), target: new THREE.Vector3(), enabled: true };
    this.userTook = false;
    controls.addEventListener('start', () => { this.userTook = true; });

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
    if (this._lastFrame) this.setRecommended(this._lastFrame, { keepUser: true });
  }

  /**
   * 界面遮住了多少画面。底部那条常驻栏一变高，取景就得重算 ——
   * 否则车会坐在字上。
   */
  setSafeArea({ top = 0, bottom = 0 }) {
    if (this.safe.top === top && this.safe.bottom === bottom) return;
    this.safe = { top, bottom };
    // 动手的时候不重新取景：提示文字每换一行安全区就变，机位会一直缓慢地飘
    if (this.held) return;
    if (this._lastFrame) this.setRecommended(this._lastFrame, { keepUser: true });
  }

  /** 画面中真正可用的那一块：高度占比与中心相对整幅的偏移 */
  #viewport() {
    const h = this.canvas.clientHeight || innerHeight || 1;
    // 下限 0.62：界面再厚也不能把主体挤成一枚邮票
    const free = Math.max(h * 0.62, h - this.safe.top - this.safe.bottom);
    return { frac: free / h, lift: (this.safe.bottom - this.safe.top) / (2.4 * h) };
  }

  /**
   * 装下这一块需要多远。
   *
   * 竖屏手机的水平视场只有十来度 —— 按垂直视场调好的距离，横过来一定裁边。
   * 两个方向各算一次，取远的那个。
   *
   * `d` 是主体沿视线方向的半深，可省。**近景不能省**：
   * 主转点轴那一步主体长 211 mm 而机位只有 190 mm 远，最靠近相机的那个角
   * 实际只有九十来毫米远，投影出来比按中心算的宽四成，右边整整裁掉 100 像素。
   * 判据要落在**离相机最近的那一层**上，于是需要的距离就是「中心该有的距离 + 半深」。
   */
  fitDistance({ r = 0, h = r, d = 0 }) {
    const vHalf = (this.camera.fov * Math.PI) / 360;
    const hHalf = Math.atan(Math.tan(vHalf) * this.camera.aspect);
    const vFree = Math.atan(Math.tan(vHalf) * this.#viewport().frac);
    return Math.max(h / Math.tan(vFree), r / Math.tan(hHalf)) + d;
  }

  /**
   * 设定本步推荐机位。
   * @param {{az?:number, el?:number, dist?:number, target?:THREE.Vector3,
   *          ease?:number, fit?:{r:number,h?:number}}} o
   *   fit 声明这一步必须完整看到的范围；装不下就把相机往后拉，只拉远不拉近。
   * @param {{keepUser?:boolean}} [mode] keepUser：只是拿旧声明重算距离（画幅变了、
   *   界面高度变了），不能清掉 userTook —— 否则用户刚转到顺手的角度，
   *   随便哪行提示换个字数，镜头就自己溜回去。
   */
  setRecommended(o = {}, { keepUser = false } = {}) {
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

    // 底部那条压掉一截画面 —— 把主体整体抬起来
    t.y -= 2 * d * Math.tan((this.camera.fov * Math.PI) / 360) * this.#viewport().lift;

    const ar = (az * Math.PI) / 180, er = (el * Math.PI) / 180;
    this.recommend.pos.set(
      t.x + d * Math.cos(er) * Math.cos(ar),
      t.y + d * Math.sin(er),
      t.z + d * Math.cos(er) * Math.sin(ar),
    );
    this.recommend.target.copy(t);
    if (!keepUser) this.userTook = false;
    this.cameraEase = ease;
    this.key.target.position.copy(t);
  }

  snapToRecommended() {
    this.camera.position.copy(this.recommend.pos);
    this.controls.target.copy(this.recommend.target);
    this.controls.update();
  }

  /** 动手的步骤里连「界面高度变了重新取景」也冻住。引擎每翻一步解开一次。 */
  hold(on) { this.held = !!on; }

  /**
   * 相机只在用户没碰过的时候走向推荐机位。
   * 转到哪儿就停在哪儿 —— 不做「松手几秒自动缓回」，那在动手对位时是灾难。
   */
  update(dt) {
    if (this.recommend.enabled && !this.userTook) {
      const k = 1 - Math.pow(0.001, dt * (this.cameraEase ?? 1));
      this.camera.position.lerp(this.recommend.pos, k);
      this.controls.target.lerp(this.recommend.target, k);
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
      // 补间与特效按 50 ms 封顶：一帧跳太多会把插值走过头，弹一下再回来
      const dt = Math.min(raw, 0.05);
      const t = this.timer.getElapsed();
      /*
       * 相机的缓动另给一档 250 ms 的上限。
       * 缓动系数是 1 − 0.001^(dt·ease)，按真实流逝的时间复合本来是帧率无关的；
       * 可 dt 一旦被压到 50 ms，弱机上（实测软件渲染只有 2–3 fps）每秒就只推进
       * 0.1–0.15 秒的量，换一步要几秒才到位 —— 越是卡的机器，镜头越慢。
       */
      this.update(Math.min(raw, 0.25));
      // 单个 updater 抛错不能连坐这一帧剩下的更新 —— 记录，继续走
      for (const u of this.updaters) {
        try { u(dt, t); } catch (e) { console.error('[updater]', e); }
      }
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  stop() { this.running = false; cancelAnimationFrame(this._raf); }

  setTheme(theme) {
    const dark = theme === 'dark';
    this.scene.background = new THREE.Color(dark ? 0x14161a : 0xeceef2);
    this.ground.material.opacity = dark ? 0.35 : 0.22;
    this.ambient.intensity = dark ? 0.28 : 0.45;
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
