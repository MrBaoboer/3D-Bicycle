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
    /** @type {Map<THREE.Mesh, THREE.Material|THREE.Material[]>} 高亮前那份共用材质 */
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
        // 不设 castShadow / receiveShadow：这一份不投影，理由见 render/stage.js
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

    /*
     * 上游那条 Holobike_Loop 是作者做的爆炸展开动画，356 条通道。**一帧也不播。**
     * 曾经以为可以从中反推每一件的装配方向，实测不成立（座管脱离方向几乎纯横向，
     * 而立管轴是斜的；左右脚踏还朝同一侧飞出）—— 那是给镜头看的摊开展示。
     * 装配方向一律取自几何轴，写在 assets/bike.manifest.json 里。
     * 只在统计里报一下它还在，免得后来的人以为模型被换过。
     */
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

  has(name) { return this.byName.has(name) || this.byName.has(Bike.sanitize(name)); }

  /**
   * 某个子树的世界包围盒 —— 取景与吸附判定都要用。
   *
   * **先自己刷一遍矩阵。** `Box3.setFromObject()` 内部走的是
   * `updateWorldMatrix(false, false)`：既不回头刷祖先，也不往下刷子树，
   * 只把自己那一格算新。而取景是在首帧渲染之前算的，那时谁也没刷过矩阵 ——
   * 量一个刚被 `slide.park()` 挪过位的**组节点**，子网格拿到的还是父节点的旧矩阵，
   * 量出来的就是它挪之前在哪儿。
   */
  boundsOf(name) {
    const o = this.get(name);
    o.updateWorldMatrix(true, true);
    return new THREE.Box3().setFromObject(o);
  }

  /**
   * 待装件的呼吸高亮。走 emissive 而不是换材质：
   * 换材质会丢掉这台车最值钱的东西 —— 碳纹、阳极氧化的各向异性、胎侧字。
   *
   * **必须先把材质复制一份给这几块网格。** 上游的材质是全车共用的：
   * 主车架、两条摇臂、前叉用的是同一份碳纤维材质，直接改它的 emissive，
   * 「点亮左摇臂」会把整台车一起烧成橙色，看着像整车都在待装。
   * 复制的是同型号同参数的材质，GL program 仍然复用，不会引起重编译。
   */
  highlight(names, color = 0xd8642a, strength = 0.16) {
    const list = Array.isArray(names) ? names : [names];
    for (const name of list) {
      if (!this.has(name)) continue;
      this.get(name).traverse((o) => {
        if (!o.isMesh || !o.material) return;
        if (strength <= 0) { this.#unglow(o); return; }
        if (!this._glow.has(o)) {
          this._glow.set(o, o.material);
          o.material = Array.isArray(o.material)
            ? o.material.map((m) => m.clone())
            : o.material.clone();
        }
        for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
          if (!m.emissive) continue;
          m.emissive.setHex(color);
          m.emissiveIntensity = strength;
        }
      });
    }
  }

  /** 把这块网格换回它原来那份共用材质，复制出来的那份就地释放 */
  #unglow(mesh) {
    const orig = this._glow.get(mesh);
    if (!orig) return;
    for (const m of (Array.isArray(mesh.material) ? mesh.material : [mesh.material])) m.dispose();
    mesh.material = orig;
    this._glow.delete(mesh);
  }

  clearHighlights() {
    for (const mesh of [...this._glow.keys()]) this.#unglow(mesh);
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
