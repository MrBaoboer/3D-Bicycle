/**
 * 三维方向箭头 —— 「该往哪儿拖」。
 *
 * 没有这一枚，画面上就只是一堆零件：三维拖拽不是不学就会的事。
 * 箭头做成呼吸的，静止的箭头会被当成模型的一部分。
 */

import * as THREE from 'three';
import { reducedMotion } from '../util/tween.js';

const MAT = new THREE.MeshBasicMaterial({
  color: 0xd8642a, transparent: true, opacity: 0.85, depthTest: false,
});

/**
 * 一枚箭头：锥头 + 杆，轴向 +Y（ConeGeometry 的默认朝向），由外部旋到目标方向。
 *
 * 比例是要紧的。上一版锥头直径 0.60·len 而高只有 0.45·len —— 宽过了高，
 * 配上一根几乎看不见的细杆，从任何角度看都是一枚蘑菇，读不出「朝那边」。
 * 现在锥头高 0.34、直径 0.26（高比直径 1.3 : 1，是个尖的锥），
 * 杆占掉全长三分之二 —— 方向是靠这根杆说出来的，锥头只负责说清哪一头是前。
 */
function makeArrow(len = 0.05) {
  const g = new THREE.Group();
  const head = new THREE.Mesh(new THREE.ConeGeometry(len * 0.13, len * 0.34, 24), MAT);
  head.position.y = len * 0.83;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(len * 0.042, len * 0.042, len * 0.66, 14), MAT);
  shaft.position.y = len * 0.33;
  g.add(head, shaft);
  // 压在零件之上 —— 箭头指的方向常常正对着要插进去的孔，被挡住就白指了
  g.traverse((o) => { o.renderOrder = 6; });
  return g;
}

const UP = new THREE.Vector3(0, 1, 0);

export class Arrows {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.items = [];
    scene.add(this.group);
    this.t = 0;
  }

  /** @param {{pos:THREE.Vector3, dir:THREE.Vector3, len?:number}[]} list */
  set(list) {
    this.clear();
    for (const it of list) {
      const len = it.len ?? 0.05;
      const a = makeArrow(len);
      a.position.copy(it.pos);
      a.quaternion.setFromUnitVectors(UP, it.dir.clone().normalize());
      a.userData.base = it.pos.clone();
      a.userData.dir = it.dir.clone().normalize();
      this.group.add(a);
      this.items.push(a);
    }
  }

  clear() {
    for (const a of this.items) {
      a.removeFromParent();
      a.traverse((o) => o.geometry?.dispose?.());
    }
    this.items.length = 0;
  }

  /**
   * 沿自身方向来回一点点。幅度取箭头长度的比例，远近都看得出在动。
   *
   * 用户要求减少动效时停在最亮的那一帧，不是停在半透明处 ——
   * 这一枚箭头是「往哪儿使劲」的唯一答案，先得看得清，其次才是会不会动。
   */
  update(dt) {
    if (!this.items.length) return;
    if (reducedMotion()) {
      for (const a of this.items) {
        a.position.copy(a.userData.base);
        a.children.forEach((c) => { c.material.opacity = 0.9; });
      }
      return;
    }
    this.t += dt;
    const k = (Math.sin(this.t * 3.4) * 0.5 + 0.5);
    for (const a of this.items) {
      a.position.copy(a.userData.base).addScaledVector(a.userData.dir, k * 0.012);
      a.children.forEach((c) => { c.material.opacity = 0.55 + k * 0.35; });
    }
  }

  dispose() { this.clear(); this.group.removeFromParent(); }
}
