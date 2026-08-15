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

export class Bike {
  constructor(scene) {
    this.scene = scene;
    /** @type {Map<string, THREE.Object3D>} 名字 → 节点（同名取第一个） */
    this.byName = new Map();
    /** @type {THREE.Object3D|null} */
    this.root = null;
    this.clip = null;
    this.mixer = null;
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

  /** 按名字取节点；取不到就抛 —— 名字写错要当场炸，不要静默返回 undefined */
  get(name) {
    const o = this.byName.get(name);
    if (!o) throw new Error(`[bike] 模型里没有名为 "${name}" 的节点`);
    return o;
  }

  /** 按名字前缀取一组（辐条、同规格螺丝这类成批的件） */
  all(prefix) {
    const out = [];
    for (const [k, v] of this.byName) if (k.startsWith(prefix)) out.push(v);
    return out;
  }

  has(name) { return this.byName.has(name); }

  /** 某个子树的世界包围盒 —— 取景与吸附判定都要用 */
  boundsOf(name) {
    return new THREE.Box3().setFromObject(this.get(name));
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
