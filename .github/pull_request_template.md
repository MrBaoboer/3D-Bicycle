## 改了什么

<!-- 一句话说清。不用罗列文件，diff 里都有 -->

## 为什么

<!-- 修的是什么问题，或者解决了什么麻烦 -->

## 怎么验的

<!--
这一段最要紧。至少要有：

    npm run check:code

动了三维、步骤、界面版式的，再加：

    npm run smoke

改了取景就跑一遍 `node .analysis/probe.mjs .analysis/p-fit.js`，
把「裁掉 0 步」贴上来。
改了外观就附一张截图（`node .analysis/shots.mjs <步骤id>` 直接出图）。
-->

---

- [ ] `npm run check:code` 过了
- [ ] 动了三维 / 步骤 / 版式的，本地 `npm run smoke` 也过了
- [ ] 改了清单的，`npm run verify` 过了
- [ ] 没有新增运行时依赖（新增请在上面说明理由）
- [ ] 明白本项目分三层授权，且同意 [CONTRIBUTING.md](../CONTRIBUTING.md) 结尾那一段
