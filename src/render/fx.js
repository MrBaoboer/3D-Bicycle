/**
 * 提示性特效：到位的涟漪环、拧到点的火花。
 *
 * 都做成加色混合、不写深度 —— 它们是画在零件之上的提示，不是场景里的物体。
 * 一旦参与深度排序，藏在车架后面的那次「到位」就看不见了。
 */

import * as THREE from 'three';

const RING_MAT = new THREE.MeshBasicMaterial({
  color: 0xd8642a, transparent: true, opacity: 0.9,
  blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, side: THREE.DoubleSide,
});

const SPARK_MAT = new THREE.PointsMaterial({
  color: 0xffd9a0, size: 0.006, transparent: true, opacity: 0.9,
  blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
});

const UP = new THREE.Vector3(0, 1, 0);

export class Fx {
  constructor(scene, tier = 'high') {
    this.scene = scene;
    this.tier = tier;
    this.rings = [];
    this.sparks = [];
  }

  /**
   * 一圈扩散的环，用于「这里到位了」。axis 是环所在平面的法线。
   * r1 由调用方按被标记那件东西的尺度给 —— 拧螺丝那几步的取景只有十几厘米宽，
   * 一个固定 90 mm 的环会盖住半个画面。
   */
  ring(pos, axis = UP, { r0 = 0.002, r1 = 0.03, dur = 0.55 } = {}) {
    const geo = new THREE.RingGeometry(1, 1.06, 40);
    const m = new THREE.Mesh(geo, RING_MAT.clone());
    m.position.copy(pos);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis.clone().normalize());
    m.renderOrder = 8;
    this.scene.add(m);
    this.rings.push({ m, geo, t: 0, dur, r0, r1 });
    return m;
  }

  /** 一小撮火花，用于拧到底的那一下 */
  spark(pos, n = 14) {
    if (this.tier === 'low') n = 6;
    const p = new Float32Array(n * 3);
    const v = [];
    for (let i = 0; i < n; i++) {
      p[i * 3] = pos.x; p[i * 3 + 1] = pos.y; p[i * 3 + 2] = pos.z;
      v.push(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.2, Math.random() - 0.5)
        .normalize().multiplyScalar(0.25 + Math.random() * 0.35));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const pts = new THREE.Points(geo, SPARK_MAT.clone());
    pts.renderOrder = 8;
    this.scene.add(pts);
    this.sparks.push({ pts, geo, v, t: 0, dur: 0.5 });
  }

  update(dt) {
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const k = r.t / r.dur;
      if (k >= 1) {
        r.m.removeFromParent(); r.geo.dispose(); r.m.material.dispose();
        this.rings.splice(i, 1);
        continue;
      }
      const s = r.r0 + (r.r1 - r.r0) * (1 - Math.pow(1 - k, 3));
      r.m.scale.setScalar(s);
      r.m.material.opacity = 0.9 * (1 - k);
    }
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.t += dt;
      const k = s.t / s.dur;
      if (k >= 1) {
        s.pts.removeFromParent(); s.geo.dispose(); s.pts.material.dispose();
        this.sparks.splice(i, 1);
        continue;
      }
      const arr = s.geo.attributes.position.array;
      for (let j = 0; j < s.v.length; j++) {
        s.v[j].y -= 2.6 * dt;                        // 火花是有重量的，要落下来
        arr[j * 3] += s.v[j].x * dt;
        arr[j * 3 + 1] += s.v[j].y * dt;
        arr[j * 3 + 2] += s.v[j].z * dt;
      }
      s.geo.attributes.position.needsUpdate = true;
      s.pts.material.opacity = 0.9 * (1 - k);
    }
  }

  dispose() {
    for (const r of this.rings) { r.m.removeFromParent(); r.geo.dispose(); r.m.material.dispose(); }
    for (const s of this.sparks) { s.pts.removeFromParent(); s.geo.dispose(); s.pts.material.dispose(); }
    this.rings.length = 0; this.sparks.length = 0;
  }
}
