/**
 * 整车：加载 GLB，把节点按名字索引，供上层按零件名取用。
 * 零件名是德文真实型号（Vorbau_Hope_FR_35mm = Hope FR 35mm 把立）。
 * 上层只认名字不认下标 —— 换模型或换压缩变体时下标会漂，名字不会。
 * 素材许可见 assets/CREDITS.md（CC BY-SA 4.0）。
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// public/ 下的东西由 Vite 原样发到站点根，不参与打包 ——
// 必须走 BASE_URL 拼路径，不能用 import.meta.url（那会让 rolldown 试图把 12MB 打进产物）
const MODEL_URL = `${import.meta.env.BASE_URL}models/CarbonFrameBike.glb`;

/** iOS AR QuickLook 的假阴影贴片，网页里是糊在车底的黑面 —— 加载后摘掉 */
const DROP = ['Shadows'];

/**
 * 上游静止姿态里整个前端绕转向轴向左打了 40.212°，须扶正 ——
 * 否则前轮不在中垂面上、前轴不是横向，装前轮那一步的方向整个歪掉。
 * 转向轴取把立节点的局部 +Z（头管角 65°）。扶正判据见 docs/DEVELOPMENT.md「模型」。
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
    this.#bakeSkinned();

    // 车轮着地：把包围盒底面压到 y = 0，之后所有取景与行程都以地面为基准
    const box = new THREE.Box3().setFromObject(this.root);
    this.root.position.y -= box.min.y;
    this.bounds = new THREE.Box3().setFromObject(this.root);
    this.size = this.bounds.getSize(new THREE.Vector3());
    this.center = this.bounds.getCenter(new THREE.Vector3());

    /*
     * 上游的 Holobike_Loop 是给镜头看的爆炸展开动画：一帧也不播，
     * 也不能用来反推装配方向（左右脚踏朝同一侧飞出）—— 方向一律取几何轴，
     * 写在 assets/bike.manifest.json。统计里报它还在，免得误以为模型被换过。
     */
    this.scene.add(this.root);
    this.stats = { nodes: this.byName.size, meshes, animations: gltf.animations?.length || 0 };
    return this;
  }

  /**
   * 把前端绕转向轴扶正（见 STEER）。旋转在父空间里绕过支点的轴做 ——
   * 直接写 node.rotation 只绕节点自身原点转，前轮会甩出去。
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
   * 蒙皮烘焙。上游把四根刹车油管绑在悬挂骨架上（为那段一帧不播的循环动画），
   * 蒙皮网格的顶点真身在骨骼变换之后 —— 而 Box3、屏幕拾取、取景量的都是
   * 裸顶点 × matrixWorld，对蒙皮件得到的是差着近一米的绑定姿态：
   * 油管的取景框到幻影、箭头钉在空处、容差拾取采样落空，全是这一个根。
   * 动画既然永不播放，骨骼就是常量 —— 把当前姿态一次性烘进顶点、换成普通
   * 网格，此后全站的几何量法对它与对别的件再无分别。
   * 必须排在 #unsteer 之后：扶正会动骨骼的祖先，先烘就把没扶正的姿态焊死了。
   */
  #bakeSkinned() {
    const swaps = [];
    this.root.updateMatrixWorld(true);
    this.root.traverse((o) => { if (o.isSkinnedMesh) swaps.push(o); });
    const v = new THREE.Vector3();
    const p2 = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (const s of swaps) {
      s.skeleton.update();                     // 首帧渲染之前 boneMatrices 还没人算过
      const geo = s.geometry.clone();
      const pos = geo.attributes.position;
      const nrm = geo.attributes.normal;
      geo.computeBoundingSphere();
      // 法线走差分：蒙皮是仿射变换，skin(p+εn)−skin(p) 精确等于旋转后的 εn
      const eps = Math.max(1e-6, geo.boundingSphere.radius * 1e-3);
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        if (nrm) {
          n.fromBufferAttribute(nrm, i);
          p2.copy(v).addScaledVector(n, eps);
          s.applyBoneTransform(i, p2);
        }
        s.applyBoneTransform(i, v);
        pos.setXYZ(i, v.x, v.y, v.z);
        if (nrm) {
          n.copy(p2).sub(v).normalize();
          nrm.setXYZ(i, n.x, n.y, n.z);
        }
      }
      geo.deleteAttribute('skinIndex');
      geo.deleteAttribute('skinWeight');
      // 顶点全换过了，包围体必须重算 —— 射线的粗筛用它，留着旧的会滤掉真命中
      geo.computeBoundingBox();
      geo.computeBoundingSphere();

      const plain = new THREE.Mesh(geo, s.material);
      plain.name = s.name;
      plain.renderOrder = s.renderOrder;
      plain.userData = s.userData;
      plain.position.copy(s.position);
      plain.quaternion.copy(s.quaternion);
      plain.scale.copy(s.scale);
      s.parent.add(plain);
      s.removeFromParent();
      s.geometry.dispose();
      if (this.byName.get(s.name) === s) this.byName.set(s.name, plain);
    }
  }

  /**
   * GLTFLoader 会过一道 PropertyBinding.sanitizeNodeName（空白转下划线，
   * `[ ] . : /` 删掉），而清单存的是原始 GLB 节点名 —— 查表前现做同样的净化。
   * 清单侧不能改存净化名，否则 tools/check-manifest.mjs 拿 GLB 对不上账。
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
   * 某个子树的世界包围盒。量之前先刷祖先与整棵子树的矩阵 ——
   * `Box3.setFromObject()` 只刷自己那一格，而取景跑在首帧渲染之前，矩阵一旧，
   * 量出来的是挪位之前的盒。见 docs/DEVELOPMENT.md「量几何之前先自己刷矩阵」。
   */
  boundsOf(name) {
    const o = this.get(name);
    o.updateWorldMatrix(true, true);
    return new THREE.Box3().setFromObject(o);
  }

  /**
   * 待装件的高亮。走 emissive 不换材质 —— 换材质会丢掉碳纹与阳极氧化质感。
   * 改之前先把材质复制给目标网格：上游材质全车共用，直接改 emissive
   * 会把整台车一起点亮。复制同参数材质不引起 GL program 重编译。
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
