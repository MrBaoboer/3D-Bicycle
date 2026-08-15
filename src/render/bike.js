/**
 * 整车：加载 GLB，把 757 个节点按名字索引起来，供上层按零件名取用。
 *
 * 这个模型是一台真车的数字孪生，零件名是德文真实型号
 * （Vorbau_Hope_FR_35mm = Hope FR 35mm 把立，Pedal_Funn_Bigfoot_le = 左脚踏）。
 * 上层一律只认名字，不认节点下标 —— 换一份模型或换一档压缩变体，
 * 下标会漂，名字不会。
 *
 * 素材许可见 assets/CREDITS.md（CC BY-SA 4.0）。
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// public/ 下的东西由 Vite 原样发到站点根，不参与打包 ——
// 必须走 BASE_URL 拼路径，不能用 import.meta.url（那会让 rolldown 试图把 12MB 打进产物）
const MODEL_URL = `${import.meta.env.BASE_URL}models/CarbonFrameBike.glb`;

/**
 * 这三片是给 iOS AR QuickLook 垫的假阴影贴片，在网页里是三块糊在车底的黑面。
 * 上游资产自带，加载后立刻摘掉。
 */
const DROP = ['Shadows'];

/**
 * 上游模型的静止姿态里，整个前端绕转向轴向左打了 40.212°。
 * 那是给渲染出图摆的姿势，装配说明书要把它扶正 —— 否则前轮不在中垂面上，
 * 前轴也不是横向（实测 [-0.585, 0.274, -0.764]），装前轮那一步的方向会整个歪掉。
 *
 * 转向轴取把立节点的局部 +Z（离铅垂 25.01°，即头管角 65°）。
 * 扶正后两条判据同时成立：前轮心 Z 由 31.94 mm 归到 -0.7 mm；
 * 前轴由上面那个斜向量变成 [0.0004, 0.0009, -1]，正横向。
 */
const STEER = {
  node: 'Lenker',                          // 转向总成的根：Lenker → Federung → RadVorn
  axisFrom: 'Vorbau_Hope_FR_35mm',         // 转向轴 = 把立节点的局部 +Z
  angleDeg: -40.212,
};

export class Bike {
  constructor(scene) {
    this.scene = scene;
    /** @type {Map<string, THREE.Object3D>} 名字 → 节点（同名取第一个） */
    this.byName = new Map();
    /** @type {THREE.Object3D|null} */
    this.root = null;
    this.clip = null;
    this.mixer = null;
    /** @type {Map<THREE.Material, {hex:number, i:number}>} 高亮前的自发光原值 */
    this._glow = new Map();
  }

  async load(onProgress) {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(MODEL_URL, (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    });

    this.root = gltf.scene;
    this.gltf = gltf;

    // AR 假阴影先摘掉，再建索引 —— 免得它们混进零件表
    for (const name of DROP) {
      const n = this.root.getObjectByName(name);
      if (n) n.removeFromParent();
    }

    let meshes = 0;
    this.root.traverse((o) => {
      if (o.name && !this.byName.has(o.name)) this.byName.set(o.name, o);
      if (o.isMesh) {
        meshes++;
        o.castShadow = true;
        o.receiveShadow = true;
        // 上游有几处材质双面开着，开着会让辐条与刹车油管出现自阴影噪点
        if (Array.isArray(o.material)) o.material.forEach((m) => { m.side = THREE.FrontSide; });
        else if (o.material) o.material.side = THREE.FrontSide;
      }
    });

    this.#unsteer();

    // 车轮着地：把包围盒底面压到 y = 0，之后所有取景与行程都以地面为基准
    const box = new THREE.Box3().setFromObject(this.root);
    this.root.position.y -= box.min.y;
    this.bounds = new THREE.Box3().setFromObject(this.root);
    this.size = this.bounds.getSize(new THREE.Vector3());
    this.center = this.bounds.getCenter(new THREE.Vector3());

    // 上游那条 Holobike_Loop 是作者做的爆炸展开动画，356 条通道。
    // 这里只把它挂上不播 —— 每个零件「装上去之前在哪儿」正存在这条动画里，
    // 装配方向由 core/ 从中反推，不手写。
    if (gltf.animations?.length) {
      this.clip = gltf.animations[0];
      this.mixer = new THREE.AnimationMixer(this.root);
    }

    this.scene.add(this.root);
    this.stats = { nodes: this.byName.size, meshes, animations: gltf.animations?.length || 0 };
    return this;
  }

  /**
   * 把前端绕转向轴扶正，见 STEER 的注释。
   * 旋转要在**父空间**里绕一个过支点的轴做：先把支点与轴变换进父空间，
   * 平移分量绕支点转，再把旋转左乘到自身四元数上。
   * 直接写 node.rotation 只会绕节点自己的原点转，前轮会甩出去。
   */
  #unsteer() {
    const node = this.byName.get(STEER.node);
    const ref = this.byName.get(STEER.axisFrom);
    if (!node || !ref) return;
    this.root.updateMatrixWorld(true);

    const m = ref.matrixWorld.elements;
    const axisW = new THREE.Vector3(m[8], m[9], m[10]).normalize();   // 把立局部 +Z
    const pivotW = ref.getWorldPosition(new THREE.Vector3());

    const inv = node.parent.matrixWorld.clone().invert();
    const pivot = pivotW.clone().applyMatrix4(inv);
    const axis = axisW.clone().transformDirection(inv).normalize();
    const q = new THREE.Quaternion().setFromAxisAngle(axis, THREE.MathUtils.degToRad(STEER.angleDeg));

    node.position.sub(pivot).applyQuaternion(q).add(pivot);
    node.quaternion.premultiply(q);
    node.updateMatrixWorld(true);
    this.steered = true;
  }

  /**
   * 清单里存的是**原始 GLB 节点名**（含空格，如 "Lenker 1"），
   * 而 GLTFLoader 加载时会过一道 PropertyBinding.sanitizeNodeName：
   * 空白转下划线、`[ ] . : /` 直接删掉。于是运行时叫 "Lenker_1"。
   *
   * 两边必须各自保持原样：清单存原始名，才能被 tools/check-manifest.mjs
   * 拿 GLB 离线逐条对账；运行时查表前现做同样的净化。
   * 图省事把清单改成净化名的话，校验器就再也发现不了「模型改名」这类走散。
   */
  static sanitize(name) {
    return String(name).replace(/\s/g, '_').replace(/[[\]./:]/g, '');
  }

  /** 按名字取节点；取不到就抛 —— 名字写错要当场炸，不要静默返回 undefined */
  get(name) {
    const o = this.byName.get(name) ?? this.byName.get(Bike.sanitize(name));
    if (!o) throw new Error(`[bike] 模型里没有名为 "${name}" 的节点`);
    return o;
  }

  /** 按名字前缀取一组（辐条、同规格螺丝这类成批的件） */
  all(prefix) {
    const out = [];
    for (const [k, v] of this.byName) if (k.startsWith(prefix)) out.push(v);
    return out;
  }

  has(name) { return this.byName.has(name) || this.byName.has(Bike.sanitize(name)); }

  /** 某个子树的世界包围盒 —— 取景与吸附判定都要用 */
  boundsOf(name) {
    return new THREE.Box3().setFromObject(this.get(name));
  }

  /**
   * 待装件的呼吸高亮。走 emissive 而不是换材质：
   * 换材质会丢掉这台车最值钱的东西 —— 碳纹、阳极氧化的各向异性、胎侧字。
   * 材质是共用的（同一材质挂在多个网格上），所以要按材质记原值，别按网格记。
   */
  highlight(names, color = 0xd8642a, strength = 0.16) {
    const list = Array.isArray(names) ? names : [names];
    for (const name of list) {
      if (!this.has(name)) continue;
      this.get(name).traverse((o) => {
        if (!o.isMesh) return;
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of ms) {
          if (!m) continue;
          if (!this._glow.has(m)) {
            this._glow.set(m, { hex: m.emissive?.getHex() ?? 0x000000, i: m.emissiveIntensity ?? 1 });
          }
          if (!m.emissive) continue;
          if (strength <= 0) {
            const o0 = this._glow.get(m);
            m.emissive.setHex(o0.hex);
            m.emissiveIntensity = o0.i;
          } else {
            m.emissive.setHex(color);
            m.emissiveIntensity = strength;
          }
        }
      });
    }
  }

  clearHighlights() {
    for (const [m, o] of this._glow) {
      m.emissive?.setHex(o.hex);
      m.emissiveIntensity = o.i;
    }
    this._glow.clear();
  }

  setVisible(name, on) { this.get(name).visible = on; }

  dispose() {
    this.root?.traverse((o) => {
      o.geometry?.dispose?.();
      const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of ms) {
        for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) {
          m[k]?.dispose?.();
        }
        m.dispose();
      }
    });
    this.root?.removeFromParent();
  }
}
