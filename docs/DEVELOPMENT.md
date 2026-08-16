# 开发与维护

## 环境

Node `^22.13.0 || >=24.0.0`。浏览器要 WebGL 2：Chrome / Edge 111+、Safari 16.4+、Firefox 113+。

```bash
npm install
```

```bash
npm run dev
```

<http://localhost:5174>。

## 命令

| | 做什么 | 耗时量级 |
|---|---|---|
| `npm run lint` | ESLint 扁平配置，只开 recommended | 秒 |
| `npm test` | `node:test`，42 项：清单校验器 + 装配清单读取层 | 秒 |
| `npm run verify` | 清单 × GLB 离线逐条对账，11 项 | 秒 |
| `npm run build` | Vite 8（rolldown） | 十几秒 |
| `npm run check:code` | 以上四条 | 半分钟 |
| `npm run smoke` | Playwright 双画幅真装一遍，98 项 | 三五分钟 |
| `npm run check` | `check:code` + `smoke` | 两分钟 |
| `npm run model` | 打印整车装配树 | 秒 |

`npm run smoke -- --shots` 每一步都截图到 `.shots/smoke/`；不加只在失败时截那一张。
`--headed` 开着浏览器跑，排查用。

### 冒烟走查要真的把车装一遍

它不是「翻页看标题」。每一步查：可达、有标题、声明了 `cam.fit`、
**这一步瞄的那个点投影后落在界面没遮住的那块画面里**、画面不是纯色。
然后**从头到尾把整台车装一遍**（走的正是用户那条路：一步步按「下一步」，
每一步把剩下的活按「一下一件」演完），再对账：
每一件精确落回装配位（偏差 < 0.01 mm）、二十七件七颗都记上账、自检三十四行报「全部到位」、
在场件数一路只增不减（从零开始装的骨架）、四颗面盖要按四下第五下才翻页。

两处踩过的坑写在 `tools/smoke.mjs` 的文件头，改它之前先读：

- 判「画面不是纯色」不能直接 `drawImage` WebGL 画布。没开 `preserveDrawingBuffer`
  时那块缓冲在合成后就清了，读回来永远全黑 —— 十一步全部假失败，
  而真正的报错混在里面没人看得见。要在同一个任务里先 `render()` 再取样。
- 断言「镜头没对着空处」要投影**步骤声明的 `cam.target`**，
  不能投 `controls.target`：后者是让位之后的机位目标，按定义就在画幅正中，
  那样这一条永远只是在测「中点在中间」。

## 目录

```
assets/    bike.manifest.json 装配清单 · CREDITS.md 第三方素材署名
public/    models/CarbonFrameBike.glb  整车（12 MB，第三方素材）
src/
  core/    bom 清单读取 · state 状态                  不碰 three
  render/  stage 舞台 · bike 整车 · bolt 程序化螺丝与工具 · fx 特效
  interact/slide 推入 · screw 旋入与扭矩
  audio/   sfx 程序合成音效（不加载音频文件）
  ui/      hud 界面 · icons 图标 · guides 三维箭头 · styles/ 四份 CSS
  app/     engine 分步引擎
  steps/   acts 八章二十九步 · util 取景现算与共用工具
tools/     校验、单测、冒烟、模型分析脚本
docs/      CONTRACT.md 模块契约（改接口先改它）· shots/ README 用的截图
.analysis/ 开发期探针，不进版本库 —— 见下
```

分层与 ctx 键表见 [CONTRACT.md](CONTRACT.md)，那是唯一权威。

### 四份 CSS 各管什么

`tokens.css` 令牌（颜色、字号、间距、层级 —— **颜色只在这一处定义**）→
`base.css` 重置与无障碍 → `styles.css` 画布与封面 → `chrome.css` 常驻界面 →
`surfaces.css` 覆盖层与摆在里面的组件。

组件一律只引用语义令牌，不写颜色值。曾经有过两套并行的界面 CSS
（一套按 `#topbar`/`#bottom` 写、另一套按 `.topbar`/`.bottombar` 写），
同名令牌在两个文件里取值不同，靠 import 顺序决定谁赢 ——
改一个颜色只有一半地方跟着变。**别再开第二处令牌。**

## 开发期探针（`.analysis/`）

不进版本库，专门回答「现在到底是多少」。与 `tools/` 的分工：
那边是回归门禁，这边是量尺。

```bash
node .analysis/probe.mjs .analysis/p-frame.js       # 每步该框多大、机位偏了多少
node .analysis/probe.mjs .analysis/p-seat.js        # 各件退让方向与到位偏差
node .analysis/probe.mjs .analysis/p-seat-surface.js # 每颗螺栓埋进网格多少毫米
node .analysis/probe.mjs .analysis/p-cam.js         # 安全区、推荐距离与实际距离
node .analysis/probe.mjs .analysis/p-a11y.js        # 键盘、焦点、ARIA
node .analysis/shots.mjs A1 C2 E2                   # 四画幅 × 深浅两主题截图
```

`probe.mjs` 起 headless Chromium 打开 dev server，把文件内容当函数体在页内跑。
需要 dev server 已经在 5174 上跑着，或用 `PROBE_URL` 指到别处。

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

标定用 Hope 200 mm 刹车碟做主标尺（前后两片实测 200.22 mm），花鼓 150 / 110 mm 交叉验证。
**不要用轮胎标称尺寸标定** —— 胎的标称本来就不准，实测后胎 683.9 mm 对标称 707 mm 差了 3%。

## 世界方向 ≠ 局部方向

清单给的 `install.dir`、`pivot.axis`、紧固件 `axis` 都是**世界方向**，
而每个件的父级基底都不是单位阵：前轮挂在 `Federung → Lenker` 下，
脚踏挂在 `Kurbel_X01_DH → Pedale` 下，座管的父级是一个 90° 旋转。

把世界向量直接加到 `object.position` 上，件会沿一个完全无关的方向跑掉
（实测前轮横着飞出 19 cm，到位后停在离真正装配位 190 mm 的地方）。
换算只有 `interact/slide.js` 的 `#rig()` 做对过一次 ——
**步骤脚本一律走 `ctx.slide.park(partId, u)`**，不要自己拿 `install.dir` 加减。

「装配位」只认节点第一次被看到时的位置（记在 `userData.homePos`）。
拿「现在在哪儿」当装配位的话，一个已经退到预备位的件再被备一次，
记下的就是预备位，于是每备一次就再偏一个 gap。

## 那条动画不能用来反推装配方向

模型自带 12.02 秒、356 通道的 `Holobike_Loop`，是爆炸展开，t=0 为合装态。
一度看上去可以直接反推装配方向，**实测不成立**：扣掉车架漂移、在车架局部系逐件量过之后，
座管的脱离方向是 [0.210, 0, −0.978]（几乎纯横向），而立管轴是 [0.514, 0.858, 0]；
左右脚踏也朝同一侧飞出，而真实脚踏沿曲柄轴反向旋入。

那是给镜头看的摊开展示。装配方向一律取自**几何轴**（立管轴、转向轴、前轴、曲柄轴）。
动画目前只挂上不播。

## 把立面盖螺丝是补建的

`Vorbau_Hope_FR_35mm` 是一整块焊死网格（单连通块 532 三角形），面盖螺丝没被单独建模。
而「四颗按对角顺序拧」是本项目三个签名交互之一，所以这四颗由 `render/bolt.js` 程序化生成，
位置与轴向写在清单的 `stem-face-*` 里。

**它们的 `point` 必须落在面盖真正的外表面上。** 早先那组坐标埋进网格里 13.9 mm，
四颗螺栓整个看不见，而 `npm run verify` 查不出来（它不做光线求交）。
复查走 `.analysis/p-seat-surface.js`。

## 取景：现算，不写常量

每一步的机位与取景都由 `steps/util.js` 的 `shot()` 从几何现推，
先按装配方向定机位（`viewFor`），再按那个机位量取景（`frameOf`）。
顺序不能反 —— 半跨度是在**相机自己的基底**里量的。

早先这些是二十来个手写常量，实测有六个是错的（桶轴那一步框大了六倍、
面盖那一步的中心被工具带偏），而且每加一步就要再手量一次。

三条判据，缺一条就有步骤被裁：

1. **量整段行程**，不是件的静态包围盒。只框装配位的话，件在起手那一头会飘到画面外
   （前轮的行程包络比它自己高 34%）。
2. **在相机基底里量**。`fit` 的 `{r,h}` 被当成水平半径与垂直半高独立处理，
   而相机是斜着看的，包围盒的对角线比任何一条边都长。拿世界 XYZ 凑的结果：
   二十八步里十三步被裁，最多一步下缘超出 417 像素。
3. **补上主体的半深** `fit.d`。近景里主体深度与机位距离同量级 ——
   主转点轴那一步主体长 211 mm 而机位只有 190 mm 远，最靠近相机的那个角
   实际只有九十来毫米远，投影出来比按中心算的宽四成，右边整整裁掉 100 像素。
   判据要落在离相机最近的那一层上。

复量走 `.analysis/p-fit.js`：它把每一步包络的八个角投到屏幕上，
报出谁被裁掉了多少像素。四种画幅目前都是 0。

## 界面遮住多少画面

`ui/hud.js` 每次布局变化都量一次顶栏与底栏，写进 `--bar-h`，
并把上下两条边报给 `stage.setSafeArea()`，三维据此让位与退远。

算「底部占了多少」时有两道判据，缺一不可：**贴底**（下沿离屏幕底不超过一条底部条）
与**挡道**（与画面横向中间那一半有重叠）。
少了前者，一个摆在右上角的读数区会被算成「底部占了 632 像素」，主体被整个顶出画面；
少了后者，缩在右下角的扭矩表会让整车无谓地往上挤 270 像素。

## 弱机上的镜头

`stage` 的主循环给补间与特效的 `dt` 封顶 50 ms，给相机缓动的另封顶 250 ms。
缓动系数 `1 − 0.001^(dt·ease)` 按真实流逝时间复合本来是帧率无关的，
可 dt 一旦被压到 50 ms，软件渲染那档（实测 2–3 fps）每秒只推进 0.1 秒的量，
换一步要好几秒才到位 —— 越卡的机器镜头越慢，正好反了。

## 部署

产物纯静态，`base: './'`，放任何子路径下都不用改配置（已在 `/bike-manual/` 下实测）。
仓库带了 `.github/workflows/deploy.yml`（GitHub Pages）；
也可以把 `dist/` 丢给任何静态托管。

生产产物注入一条 CSP，见 `vite.config.js`。改它之后**必须重跑 `npm run smoke`**：
`connect-src` 少放 `blob:` 的话，GLTFLoader 取不到贴图，而页面看上去还是「能开」。
CSP 只进构建产物，不进 index.html —— 开发期 Vite 靠动态 `<style>` 注样式。

`vercel.json` 另外发一组安全响应头。缓存分两档：
`/assets/` 里的产物带内容哈希，给一年 immutable；
`/models/` 下那份 GLB **文件名固定、没有哈希**，所以只给七天 ——
标成 immutable 的话，换了模型也刷不掉浏览器里那份旧的。
