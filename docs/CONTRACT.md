# 模块契约

各模块只认这份契约，不互相 import 单例。改这里等于改所有人。

## 分层（只允许向下依赖，没有回指）

```
core/       清单、状态                      不碰 three（只借 Vector3 这一个纯数学类型）
  ↓
render/     舞台、整车、程序化螺丝与工具、特效
interact/   把指针变成装配动作
audio/      声音                            谁也不认识
  ↓
ui/         界面组件                        认识 DOM 与 three 的向量，不认识自行车
  ↓
app/        分步引擎                        只认识「一步长什么样」
  ↓
steps/      步骤内容                        通过 ctx 取用以上全部
```

`main.js` 是唯一的组装处，也是唯一读那份清单 JSON 的地方。

**界面层不许自带内容。** 章节名由 `steps/` 提供，`hud.setChapters(steps, phases)`
的第二个参数是必传的 —— 界面自己存一份的话，两边会各存一套，
多出来的那一章会被静默并进上一章，而顶部那条进度轨看不出这件事。

## 坐标与单位

- **Y 轴向上**（glTF 规范），+Z 是车的左侧，−X 是车头
- **1 单位 = 1 米**（Hope 200 mm 刹车碟标定，前后实测 200.22 mm）
- 整车底面已压到 y = 0，前把已扶正 −40.212°
- 清单 `assets/bike.manifest.json` 里的坐标就是这套世界坐标

**清单给的方向都是世界方向，而模型里每个件的父级基底都不是单位阵**
（实测前轮挂在 `Federung → Lenker` 下、脚踏挂在 `Kurbel → Pedale` 下）。
把世界向量直接加到 `object.position` 上，前轮会横着飞出去 19 cm。
换算到父空间这件事只有 `interact/slide.js` 做对过一次，别处一律走 `ctx.slide.park()`。

## ctx：全片共享的那一个对象

| 键 | 是什么 | 常用的 |
|---|---|---|
| `stage` | 舞台 | `setRecommended({az,el,dist,target,fit})` · `snapToRecommended()` · `setSafeArea({top,bottom,left,right})` · `hold(bool)` · `setTheme()` · `updaters` |
| `bike` | 整车 | `get(name)` · `has(name)` · `boundsOf(name)` · `highlight(name,color,strength)` · `clearHighlights()` |
| `bom` | 清单 | `part(id)` · `fastener(id)` · `groupOf(idOrGroup)` · `crossPairs(group)` · `crossMate(group,id)` · `order()` · `parts` · `fasteners` · `counts` |
| `bolts` | 程序化螺丝与工具 | `spawn(idOrFastener)` · `useTool(kind)` · `hideTools()` · `remove(id)` · `clear()` |
| `slide` | 一自由度推入 | `begin({partId,onSeat,onAll,wrongHint,sound})` · `park(partId,u)` · `burst(partId,世界位移)` · `cancel()` · `autoSeat(partId?)` |
| `screw` | 旋入与扭矩 | `begin({fastenerId,onProgress,onTight,onStrip,onWrongWay})` · `beginGroup({group,onProgress,onEach,onAll})` · `cancel()` · `autoRun(id?)` · `autoRunNext()` |
| `hud` | 界面 | `setCue()` · `setNote()` · `setTask()` · `setAlts()` · `toast()` · `dock()` · `sheet()` · `addSpot()` · `setTorqueGauge()` · `setBoltRow()` · `setChapters()` · `setStep()` · `readyNext()` |
| `sfx` | 声音 | `play(name,{gain,pitch,delay})` · `setEnabled()`。只有四种：`THREAD_TURN` `TORQUE_CLICK` `SEAT_IN` `WRONG`（另两个别名 `WHEEL_SEAT` `POST_SEAT` 只是 `SEAT_IN` 的轻重档） |
| `guides` | 三维方向箭头 | `set([{pos,dir,len}])` · `clear()` |
| `state` | 状态 | 直接读写；只有偏好落盘 |
| `engine` | 引擎自身 | `done()` · `go(i)` · `jump(i)` · `goToStep(id)` · `next()` · `back()` · `restart()` · `pending` · `steps` |
| `build` | 此刻车上该有哪些件 | `plan(steps)` · `applyAt(i,{all})` · `stepOf(partId)` |
| `fx` | 粒子与提示环 | `ring(pos,axis,{r1})` · `spark(pos)` |
| `tier` | 画质档 | `'low' \| 'mid' \| 'high'` |

### 几处容易写反的签名

- `screw` 的 `onProgress` 收的是**一整个对象** `{id, phase, depth, turns, nm, zone}`，
  不是一个数。四个步骤曾各自写成 `(nm) => …` 再 `nm.toFixed()`，于是一转就抛。
  步骤脚本别自己接这个钩子，走 `steps/util.js` 的 `fasten()` / `fastenGroup()`。
- **`bom.crossPairs(group)` 发的是 id 对，不是紧固件对象。** 曾经发对象，
  而唯一的调用方拿它跟一个 id 字符串比 —— 恒不相等，「对角配对」在运行时等于不存在，
  每一组的第二、第四颗都被判成拧错。要问「谁是谁的对角」走 `crossMate(group, id)`。
- `bolts.spawn()` 收 id 或紧固件对象都行；`u` 在 `slide.park(partId, u)` 里
  **0 是预备位、1 是装配位**。
- `fx.ring()` 的半径要按被标记那件东西的尺度给。默认值是给 M5 螺栓头的，
  拿它去标整只轮子会画出一个盖住半屏的圈。
- `stage.updaters` 的回调收 `(dt, t, slow)`：`dt` 封顶 50 ms 给逐帧积分的东西
  （特效、箭头），`slow` 封顶 250 ms 给补间。补间用 `dt` 的话，弱机上整段动画会拖长几倍。

## 一步长什么样

```js
{
  id: 'D2', phase: 3,                       // phase 是章节名数组的下标
  installs: ['handlebar'],                  // 这一步装上哪些件
  fastens: ['stem-face-a', 'stem-face-b'],  // 这一步拧哪些紧固件
  showAll: false,                           // true = 不管装配计划，整车全present
  title: '四颗面盖螺丝',
  cam: shot(ctx, ['handlebar'], { cam: { az: 170, el: 26 } }),
  cue: '按对角顺序拧，四颗分两轮',            // 一行纯文字，没有图标也没有 HTML
  note: { title: '为什么必须对角', spec: [['扭矩', '5–6 N·m']], body: '…', foot: '…' },
  task: { label: '取掉了', onClick(c, engine) { … } },   // 需要手动确认时才有
  enter(c, engine) { … },
  exit(c) { … },
}
```

**`installs` 是整份课程的骨架。** 从零开始装，靠的就是它：
`app/build.js` 据此现推「走到第 i 步时车上该有哪些件」——
还没轮到的不在场、正在装的在场但由这一步自己摆、装过的回到装配位。
漏声明一件，它就会从头到尾挂在画面上，「从零开始」当场失效。

`installs` 与 `fastens` 也是出门前自检的依据：每一行靠它连回对应的步骤，
点一下就跳回去。少了它，那一行只是一句「还没装」，帮不上任何忙。

`cam` 一律由 `steps/util.js` 现算，**不写常量**。四个入口，按这一步在讲什么挑：

| | 用在哪 | 框住什么 |
|---|---|---|
| `shot(ctx, parts, o)` | 推入一件的步骤 | 这几件从预备位到装配位扫过的整段行程包络 |
| `frameBolts(ctx, group, o)` | 拧螺丝的步骤 | 那几颗紧固件本身（不是它们长在的那个大件） |
| `frameWhole(ctx, o)` | 整车四张 | 全车逐网格的包络；`bare` 只量光车架，`burst` 量摊开态 |
| `viewFor(dir, o)` | `shot` 内部 | 只定机位，不定取景 |

### 摊开那一步

`burstOffset(ctx, partId, k)` 给出每一件相对装配位的世界位移，`slide.burst()` 负责摆位。
**位移只发生在相机的屏幕平面里**（横、竖两个方向），深度一动不动 ——
按世界径向摊很干净，可放大量里有一大截落在视线方向上，那个方向在画面上等于零位移。
另加一股「按从哪一侧装进来」的斜向分开，把左右成对的那五组掰开。
机位与位移共用 `BURST_VIEW` 的 az/el，**两边必须一致**，否则算的是另一个平面。

`shot()` 先按装配方向反推机位（`viewFor`），再按那个机位量取景（`frameOf`）。
**顺序不能反** —— 半跨度是在相机自己的基底里量的。

`shot()` 还收一个 `near`（上一步站在哪个方位）。一步装一对镜像件、
或者件是顺着车身长轴推进来的时候，站左站右同样成立 —— 那就挑离上一步近的那一侧。
`steps/acts.js` 里那个 `near` 游标负责把它顺着列表传下去，手写机位的那几步用 `at()` 也要带上。

### 换步的运镜

机位过渡由 `stage` 统一排，步骤只声明「停在哪儿」，**没有「直接跳过去」这一档**。

- 在**轨道坐标**里插值（目标点 / 方位角 / 仰角 / 距离），不在世界坐标里。
  世界坐标直线插值走的是弦不是弧：左右脚踏那两步隔着一百多度，
  相机会笔直穿过整台车。
- 方位角走最短的一边；距离按**等比**推拉；中段把距离往外鼓一点
  （转得越多鼓得越高）—— 既避开中途蹭到车身，读起来也正是真人换机位的样子。
- 缓动用 `Ease.smoother`（五次平滑，两头速度与加速度都为零）。
  `inOutCubic` 中段速度是平均值的三倍，一段一百度的环绕会甩到 180 °/s。
- 时长按「这一趟有多远」现算，0.45–1.7 s。步骤可以用 `cam.ease` 拉长
  （`ease: 0.55` 就是拉长到约两倍，「拆开看看」用它与两秒六的摊开同步）。
- 用户一碰画面，这一趟当场作废 —— 转到哪儿就停在哪儿。

**拧螺丝的步骤，机位必须正对螺栓轴、从螺栓头那一侧看。** 两条都是硬要求：
看不到螺栓头就无从下手；而旋入靠指针绕轴画圈读角度，轴一旦躺进屏幕平面
（`|视线·轴| < 0.3`），拖拽平面几乎与视线平行，交点跑到几十米外，
角度随手抖跳几十度。这一条由 `viewFor()` 从清单的 axis 反推，个别步骤在 `shot(..., {cam})` 里手工压过。

## 翻页：一下演一件

翻页永远不被拦住，但**「下一步」在这一步还有活没干完时，先演一件，不翻页**：
两条摇臂要按两下，四颗面盖螺丝要按四下，做完之后再按一下才走。

一口气把整步演完是不行的 —— 四颗螺丝在一两秒里连着转完，
「对角、分两轮」这件要看的事根本来不及看清。判据见 `engine.pending`
与 `engine.finishPending()`，两者都只认 ctx 里各原语的 `session.pending`。

**上一下还没走完时按的那一下要攒着**（最多四下），忙完一下一下补上。
「拆开看看」那一步进场要演一秒多，而连按两下方向键是最自然不过的事 ——
丢掉的那一下读起来就是键盘失灵。直接跳步（`engine.jump()`）会把攒下的清空。

### 键盘的让位规矩

空格与方向键不一样，按同一条处理过一次，代价是用鼠标点完「下一步」之后
方向键整个失灵（焦点正在那枚按钮上）：

- **空格**是按钮的激活键，焦点落在任何控件上都得让开；
- **方向键**在按钮上没有默认动作，只让给自己要用方向键的那些 ——
  进度轨、菜单、文本框。它们各自把事件 `preventDefault()`，引擎认那一下就够。

## 交互原语的共同约定

三条铁律，四个原语一律遵守：

1. **只有一个合法方向**，错误方向阻尼回弹并说明为什么，绝不允许自由 6DoF。
2. **按下即夺权，松手才交还**轨道控制。中途设回 `controls.enabled = true`，
   剩下半程会变成转镜头。
3. **每个原语都有自动路径**（`autoSeat` / `autoRun`），跳过的只是手感，
   该看到、该听到的一样不少。连续失败三次自动把「帮我装上」摆出来。

## 三处必须让手指记住的手感

| | 在哪 | 要点 |
|---|---|---|
| 左脚踏反牙 | `pedal-left-spindle`，`thread: "left"` | 允许拧错。往正牙方向拧满两圈才发涩、停住、回退半圈，并说明「左边是反的」 |
| 面盖对角顺序 | `stem-face` 四颗，`order: "cross"` | 不拦，只把 `orderOk` 交给步骤脚本，并记进 `state.crossOrderOk`，结尾自检要提。判定走 `bom.crossMate()`，冒烟里正反两条都断言 |
| 扭矩到点 | 全部 | 拧到底后继续转 = 加载，弧表从绿走到黄再到红，到点「咔」一声；过了滑丝 |

## 清单里两条不显眼但要紧的约定

- **`install.kind`** 分 `slide`（推入）与 `thread`（旋入）。
  `thread` 的件意味着它的紧固件就长在件上（脚踏轴），
  `interact/screw.js` 据此不再另画一颗程序化螺栓 —— 否则画面上会多出一颗
  现实中不存在的螺母，还跟着件一起被拖走。
- **`point` 必须落在螺栓头真正贴合的那张面上。** 埋进网格里的话螺栓整颗看不见，
  而 `npm run verify` 查不出这一条（它不做光线求交）。复查走
  `.analysis/p-seat-surface.js`：沿拧入方向打一条射线，报出每颗埋了多少毫米。
