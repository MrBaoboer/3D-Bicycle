# 开发与维护

## 环境

Node `^22.13.0 || >=24.0.0`。浏览器要 WebGL 2：Chrome / Edge 111+、Safari 16.4+、Firefox 113+。

```bash
npm install
npm run dev          # http://localhost:5174
```

## 命令

| | 做什么 | 耗时量级 |
|---|---|---|
| `npm run lint` | ESLint 扁平配置，只开 recommended | 秒 |
| `npm test` | `node:test`，测清单校验里的纯函数 | 秒 |
| `npm run verify` | 清单 × 模型逐条对账，11 项 | 秒 |
| `npm run build` | Vite 8（rolldown） | 十几秒 |
| `npm run check:code` | 以上四条 | 半分钟 |
| `npm run smoke` | Playwright 双画幅走完全部步骤 | 分钟级 |
| `npm run check` | `check:code` + `smoke` | 分钟级 |
| `npm run model` | 打印整车装配树 | 秒 |

`npm run smoke -- --shots` 每一步都截图到 `.shots/smoke/`；不加只在失败时截那一张。
`--headed` 开着浏览器跑，排查用。

## 目录

```
assets/    bike.manifest.json 装配清单 · CREDITS.md 第三方素材署名
public/    models/CarbonFrameBike.glb  整车（12 MB，第三方素材）
src/
  core/    bom 清单读取 · state 状态          不碰 three
  render/  stage 舞台 · bike 整车 · bolt 程序化螺丝与工具 · fx 特效
  interact/slide 滑入 · screw 旋入与扭矩
  audio/   sfx 程序合成音效（不加载音频文件）
  ui/      hud 界面 · icons 图标 · guides 三维箭头 · styles/ 五份 CSS
  app/     engine 分步引擎
  steps/   acts 六章十三步 · util 取景常量与共用工具
tools/     校验、单测、冒烟、模型分析脚本
docs/      CONTRACT.md 模块契约（改接口先改它）
```

分层与 ctx 键表见 [CONTRACT.md](CONTRACT.md)，那是唯一权威。

## 模型

`public/models/CarbonFrameBike.glb`，12 MB，第三方素材（CC BY-SA 4.0，见 `assets/CREDITS.md`）。

选未压缩的 `glTF-Binary` 而非上游同目录 3.24 MB 的 `glTF-Draco-KTX2`：后者 KTX2 走 ETC1S 档，
而这份资产 11 张贴图有 7 张是法线贴图，ETC1S 的码本按感知颜色优化，压方向向量会在曲面上
留下着色不连续。低配档要减体积应另用 **UASTC** 自行转制，不要用上游的 ETC1S。

加载时做两件不可省的事，都在 `render/bike.js`：

1. **摘掉 `Shadows` 组** —— 那是给 iOS AR QuickLook 垫的三片假阴影，网页里是糊在车底的黑面。
2. **扶正前把 −40.212°** —— 上游静止姿态里前端绕转向轴打死了一个角。
   扶正后两条判据同时成立：前轮心 Z 由 31.94 mm 归到 −0.7 mm，
   前轴由 [−0.585, 0.274, −0.764] 变成 [0.0004, 0.0009, −1]。
   旋转要在**父空间里绕过支点的轴**做 —— 直接写 `node.rotation` 只会绕节点自身原点转，前轮会甩出去。

## 名字会走散

清单存的是**原始 GLB 节点名**（含空格，如 `"Lenker 1"`），而 `GLTFLoader` 加载时会过一道
`PropertyBinding.sanitizeNodeName`：空白转下划线、`[ ] . : /` 删掉，于是运行时叫 `Lenker_1`。

**清单必须存原始名**，才能被 `tools/check-manifest.mjs` 拿 GLB 离线逐条对账；
运行时查表前由 `Bike.sanitize()` 现做同样的净化。图省事反过来把清单改成净化名，
校验器就再也发现不了「模型改名」这类走散。

## 单位与坐标

Y 轴向上（glTF 规范），+Z 是车的左侧，−X 是车头，**1 单位 = 1 米**。
整车底面压到 y = 0。清单里的坐标就是这套世界坐标。

标定用 Hope 200mm 刹车碟做主标尺（前后两片实测 200.22 mm），花鼓 150 / 110 mm 交叉验证。
**不要用轮胎标称尺寸标定** —— 胎的标称本来就不准，实测后胎 683.9 mm 对标称 707 mm 差了 3%。

## 那条动画不能用来反推装配方向

模型自带 12.02 秒、356 通道的 `Holobike_Loop`，是爆炸展开，t=0 为合装态。
一度看上去可以直接反推装配方向，**实测不成立**：扣掉车架漂移、在车架局部系逐件量过之后，
座管的脱离方向是 [0.210, 0, −0.978]（几乎纯横向），而立管轴是 [0.514, 0.858, 0]；
左右脚踏也朝同一侧飞出，而真实脚踏沿曲柄轴反向旋入。

那是给镜头看的摊开展示。装配方向一律取自**几何轴**（立管轴、转向轴、前轴、曲柄轴）。
动画留作「拆开看看」的观赏用途。

## 把立面盖螺丝是补建的

`Vorbau_Hope_FR_35mm` 是一整块焊死网格（单连通块 532 三角形），面盖螺丝没被单独建模。
而「四颗按对角顺序拧」是本项目三个签名交互之一，所以这四颗由 `render/bolt.js` 程序化生成，
位置与轴向写在清单的 `stem-face-*` 里。

## 取景

每一步都要声明 `cam.fit`（这一步必须完整看到多大一块），画幅装不下时相机自动后退。
省掉它，手机上立刻裁边。取值在 `steps/util.js` 的 `FIT_*`，是从各零件子树的
世界包围盒实测出来的，不是估的。

`fit` **只会把相机推远，不会拉近** —— 近景必须显式给小 `dist`。
