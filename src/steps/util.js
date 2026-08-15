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
export const FIT_BIKE = { r: 1.025, h: 0.594 };

export const AIM_FRONT = [-0.567, 0.427, 0];
export const FIT_FRONT = { r: 0.490, h: 0.490 };

/**
 * 车把与把立。**必须用把立自己那块网格 `Vorbau_Hope_FR_35mm_27679`**，
 * 不能用同名的父节点 —— 那棵子树连车把带前叉一并算进去，
 * 量出来的中心会往下沉六七厘米，镜头就对到车架上去了。
 */
export const AIM_BAR = [-0.235, 1.069, 0];
export const FIT_BAR = { r: 0.454, h: 0.100 };

/**
 * 面盖那一步瞄的是**四颗螺丝的形心**，不是把立本体中心 ——
 * 这一步的主角是螺丝，把立只是它们所在的那块铁。
 * 形心 = 清单里 stem-face-* 四个 point 的平均。
 */
export const AIM_STEM = [-0.252, 1.063, 0];
export const FIT_STEM = { r: 0.105, h: 0.090 };

export const AIM_SEAT = [0.306, 0.867, 0];
export const FIT_SEAT = { r: 0.165, h: 0.198 };

export const AIM_CRANK = [0.184, 0.399, 0];
export const FIT_CRANK = { r: 0.215, h: 0.137 };

export const AIM_PEDAL_L = [0.108, 0.356, 0.068];
export const AIM_PEDAL_R = [0.260, 0.443, -0.123];
export const FIT_PEDAL = { r: 0.155, h: 0.098 };

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
 *
 * **绝对不能返回一个「等用户装完才兑现」的 Promise。**
 * 引擎的 go() 会 await 每一步的 enter()，而 enter 的职责只是把这一步铺开；
 * 一旦在里面等用户动手，engine.busy 就永远不落 —— 翻页、冒烟、自动路径全部卡死。
 * 到位之后要做什么，走 onDone 回调。
 */
export function installPart(ctx, partId, { onDone, hint } = {}) {
  const part = ctx.bom.part(partId);
  ctx.bike.highlight(ctx.bom.nodesOf(partId), 0xd8642a, 0.16);
  ctx.slide.begin({
    partId,
    wrongHint: hint,
    onAll: () => {
      ctx.bike.highlight(ctx.bom.nodesOf(partId), 0xd8642a, 0);
      ctx.state.installed = { ...ctx.state.installed, [partId]: true };
      onDone?.(part);
    },
  });
  return part;
}
