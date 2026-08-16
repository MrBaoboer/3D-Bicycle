/** 步骤脚本共用工具与取景常量 */

import * as THREE from 'three';

export const V = (x, y, z) => new THREE.Vector3(x, y, z);

/**
 * 取景范围（相对该步的镜头目标，单位米）。
 *
 * 每一步都得声明「这一步必须完整看到多大一块」—— 画幅装不下时相机自己后退。
 * 不声明的后果在竖屏上立刻可见：水平视场只有十几度，主体直接被裁掉两边。
 *
 * 下面这些数字不是估的，是加载后从各零件子树的世界包围盒实测出来的
 * （见 git 历史里那次 `fit()` 探针），留了 1.12–1.25 倍余量。
 */
export const AIM_BIKE = [-0.026, 0.560, 0];
export const FIT_BIKE = { r: 1.083, h: 0.627 };

export const AIM_FRONT = [-0.567, 0.536, 0];
export const FIT_FRONT = { r: 0.478, h: 0.600 };

export const AIM_BAR = [-0.312, 0.885, 0];
export const FIT_BAR = { r: 0.442, h: 0.264 };

/** 把立本体特写：用把立自己那块网格，不要用父节点（那棵子树连车把带前叉都算进去） */
export const AIM_STEM = [-0.234, 0.989, 0.016];
export const FIT_STEM = { r: 0.075, h: 0.060 };

export const AIM_SEAT = [0.306, 0.867, 0];
export const FIT_SEAT = { r: 0.161, h: 0.192 };

export const AIM_CRANK = [0.184, 0.399, 0];
export const FIT_CRANK = { r: 0.215, h: 0.137 };

export const AIM_PEDAL_L = [0.108, 0.356, 0.068];
export const FIT_PEDAL = { r: 0.155, h: 0.098 };
export const AIM_PEDAL_R = [0.260, 0.443, -0.123];

/** 参数卡的标准行 */
export const row = (k, v) => [k, v];

/** 扭矩行：把区间与滑丝阈值一并写清 */
export const torqueRow = (f) => ['扭矩', `${f.torque[0]}–${f.torque[1]} N·m`];

/**
 * 一次性场景挂件的清理器。
 * 递归释放：程序化螺丝是 Group，网格挂在组下 —— 只看传进来这一层等于一件都没释放。
 */
export class Junk {
  constructor(scene) { this.scene = scene; this.items = []; }
  add(...o) { this.items.push(...o); return o[0]; }
  clear() {
    for (const o of this.items) {
      if (o.dispose) { o.dispose(); continue; }
      o.removeFromParent?.();
      o.traverse?.((n) => {
        n.geometry?.dispose?.();
        // 材质是模块级共用的（bolt.js 的 MATS），这里绝不能 dispose ——
        // 释放掉之后下一颗螺丝拿到的是已销毁的材质，整个画面变黑
      });
    }
    this.items = [];
  }
}

/**
 * 装配一件的标准流程：亮起目标 → 交给 slide → 到位收尾。
 * 各步只需给 partId 与到位后的话，不必每次重写这十几行。
 */
export async function installPart(ctx, partId, { onDone, hint } = {}) {
  const part = ctx.bom.part(partId);
  ctx.bike.highlight(partId, 0xd8642a, 0.16);
  return new Promise((resolve) => {
    ctx.slide.begin({
      partId,
      wrongHint: hint,
      onAll: () => {
        ctx.bike.highlight(partId, 0xd8642a, 0);
        ctx.state.installed = { ...ctx.state.installed, [partId]: true };
        onDone?.(part);
        resolve(part);
      },
    });
  });
}
