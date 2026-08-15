/**
 * 车上此刻应该有哪些件。
 *
 * 从零开始装，意味着第一步的画面里只该有一根车架。哪一件在第几步出现，
 * 不另存一张表 —— 步骤自己声明 `installs`，这里现推：
 *
 *   还没轮到的      不在场（visible = false）
 *   正在装的那一步  在场，位置交给这一步自己摆（预备位或跟手）
 *   已经装过的      在场，且回到装配位
 *
 * 隐藏走的是节点自身的 visible。three 的可见性是继承的，
 * 所以「曲柄可见、但挂在曲柄下的脚踏不可见」天然成立 ——
 * 左曲柄、右摇臂、前叉下管里各藏着一件要单独装的东西，全靠这一条。
 */

export class Build {
  constructor(ctx) {
    this.ctx = ctx;
    /** @type {Map<string, number>} 件 id → 装它的那一步下标 */
    this.owner = new Map();
    this.steps = [];
  }

  plan(steps) {
    this.steps = steps;
    this.owner.clear();
    steps.forEach((s, i) => {
      for (const id of s.installs ?? []) this.owner.set(id, i);
    });
    return this;
  }

  /** 装这一件的是第几步；没人装（车架这类底座）返回 undefined */
  stepOf(partId) { return this.owner.get(partId); }

  /**
   * 把整车摆成「走到第 i 步」该有的样子。
   * @param {number} i
   * @param {{all?:boolean}} [o] all：不管计划，整车全present（首尾那两步给的是成品照）
   */
  applyAt(i, { all = false } = {}) {
    const { bom, bike, slide } = this.ctx;
    for (const p of bom.parts) {
      const at = this.owner.get(p.id);
      const present = all || at === undefined || at <= i;
      for (const n of bom.nodesOf(p.id)) bike.setVisible(n, present);
      // 已经装过的一律回装配位。正在装的那一步不碰 —— 它自己要摆预备位
      if (present && (all || at !== i)) slide.park(p.id, 1);
    }
  }
}
