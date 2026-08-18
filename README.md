<div align="center">

# 从零装一台车

**一台全避震山地车，从一根车架装到能骑走的三维分步说明书**

<p>
<a href="https://build-bike.vercel.app"><b>▶ 打开看看</b></a>
&nbsp;&nbsp;·&nbsp;&nbsp;
<a href="#在本地跑">在本地跑</a>
&nbsp;&nbsp;·&nbsp;&nbsp;
<a href="docs/DEVELOPMENT.md">开发与维护</a>
</p>

<img src="docs/shots/01-hero.png" alt="装完的整车">

<p><sub><b>8</b> 章 <b>29</b> 步 &nbsp;&nbsp;·&nbsp;&nbsp; <b>27</b> 个大件 &nbsp;&nbsp;·&nbsp;&nbsp; <b>7</b> 颗螺丝 &nbsp;&nbsp;·&nbsp;&nbsp; 装一遍十来分钟</sub></p>

</div>

<br>

## 怎么用

打开网页就能上手，不用注册，不用安装。键盘也能走完全程，焦点圈与读屏播报都在。

| | |
|---|---|
| **翻页** | <kbd>←</kbd> <kbd>→</kbd>，或画面两侧的翻页键 |
| **装一件** | 顺着箭头把件拖到位。方向只有一个，拖错了会被弹回来 |
| **拧一颗** | 按住螺栓绕圈拧，转一圈进一个螺距，转满就到底，一声「咔」 |
| **认零件** | 指到哪件，画面上就报哪件的名字 |
| **不想动手** | 点「帮我装上」替你演完。连着失败三次，它会自己出现 |
| **退出去** | <kbd>Esc</kbd> 逐层关掉说明卡与菜单 |

活还没干完就按「下一步」，它不翻页，先替你演一件 ——
四颗面盖螺丝要按四下，第五下才翻页。

<br>

<table>
<tr>
<td width="50%">
<img src="docs/shots/02-exploded.png" alt="二十七个大件摊开"><br>
<sub>开场把二十七个大件按装配顺序倒着摊开，再一件一件长回去。</sub>
</td>
<td width="50%">
<img src="docs/shots/03-cross-tighten.png" alt="按对角顺序拧四颗面盖螺丝"><br>
<sub>面盖那四颗要按对角顺序拧。跳过不拦，但会提示，并计入结尾自检。</sub>
</td>
</tr>
<tr>
<td>
<img src="docs/shots/04-dark.png" alt="左脚踏反牙 · 深色主题"><br>
<sub>左脚踏是反牙。往正牙方向拧满两圈才发涩、停住、回退半圈，再告诉你为什么。</sub>
</td>
<td>
<img src="docs/shots/05-tally.png" alt="出门前自检"><br>
<sub>装完逐条对账，二十七件七颗一条不落。每一行都能点回它所属的那一步。</sub>
</td>
</tr>
</table>

<br>

## 手机与平板

<div align="center">
<img src="docs/shots/06-mobile.png" width="300" alt="手机竖屏">
</div>

竖屏、横屏、平板各有一档版式。界面退到四周，中间整片留给车。

<br>

## 在本地跑

需要 Node `^22.13 || >=24`，浏览器要 WebGL 2（Chrome / Edge 111+、Safari 16.4+、Firefox 113+）。

```bash
npm install && npm run dev
```

打开 <http://localhost:5174>。其余命令与开发约定见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)。

## 已知限制

- 首屏要读一份 12 MB 的整车模型，第一次打开有十来秒加载条
- 螺纹连接只做了七处（面盖四颗、桶轴、左右脚踏轴）。其余大件走「推到位」——
  模型里没有它们各自的螺栓，不凭空造
- 进度不存档：刷新即从头开始
- 界面只有中文

## 参与

哪一步走不下去、哪个数不对，[开个 Issue](https://github.com/MrBaoboer/3D-Bike-Builder/issues) 就行，
订正工程数据（规格、螺距、装配顺序）尤其欢迎。
怎么改见 [CONTRIBUTING.md](CONTRIBUTING.md)，另有
[行为准则](CODE_OF_CONDUCT.md) &nbsp;·&nbsp;
[安全上报](SECURITY.md) &nbsp;·&nbsp;
[商业授权](COMMERCIAL.md)。

## 许可

| | 范围 | 许可 |
|---|---|---|
| 代码 | `src/` `tools/` `index.html` 构建配置 | **AGPL-3.0** |
| 内容 | 课程编排、文案、装配清单、程序化螺栓与工具几何、音效配方、设计令牌 | **CC BY-NC-SA 4.0** |
| 整车模型 | `public/models/CarbonFrameBike.glb` 与含它画面的截图 | **CC BY-SA 4.0**，第三方 |

整车模型是第三方素材（署名见 [assets/CREDITS.md](assets/CREDITS.md)），维护者无权转授。
要自己部署或商用，先看 [COMMERCIAL.md](COMMERCIAL.md)。
