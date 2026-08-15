# 模块契约

各模块只认这份契约，不互相 import 单例。改这里等于改所有人。

## 分层（只允许向下依赖，没有回指）

```
core/       尺寸、清单、状态、验算      不碰 three
  ↓
render/     舞台、整车、程序化螺丝与工具
interact/   把指针变成装配动作
audio/      声音                        谁也不认识
  ↓
ui/         界面组件                    认识 DOM 与 three 的向量，不认识自行车
  ↓
app/        分步引擎                    只认识「一步长什么样」
  ↓
steps/      步骤内容                    通过 ctx 取用以上全部
```

`main.js` 是唯一的组装处。

## 坐标与单位

- **Y 轴向上**（glTF 规范），+Z 是车的左侧，−X 是车头
- **1 单位 = 1 米**（Hope 200mm 刹车碟标定，前后实测 200.22mm）
- 整车底面已压到 y = 0，前把已扶正 −40.212°
- 清单 `assets/bike.manifest.json` 里的坐标就是这套世界坐标

## ctx：全片共享的那一个对象

| 键 | 是什么 | 常用的 |
|---|---|---|
| `stage` | 舞台 | `setRecommended({az,el,dist,target,fit})` · `snapToRecommended()` · `hold(bool)` · `updaters` |
| `bike` | 整车 | `get(name)` · `has(name)` · `all(prefix)` · `boundsOf(name)` · `highlight(name,color,strength)` · `clearHighlights()` |
| `bom` | 清单 | `part(id)` · `fastener(id)` · `parts` · `fasteners` |
| `bolts` | 程序化螺丝与工具 | `spawn(fastenerId)` · `tool(kind)` · `remove(id)` |
| `slide` | 一自由度平移装配 | `begin({partId,onSeat,onAll})` · `cancel()` · `autoSeat(partId)` |
| `screw` | 旋入与扭矩 | `begin({fastenerId,onTight,onStrip,onWrongWay})` · `cancel()` · `autoRun(id)` |
| `hud` | 界面 | `setCue()` · `setNote()` · `setTask()` · `setAlts()` · `toast()` · `dock()` · `sheet()` · `addSpot()` · `setChapters()` · `setStep()` · `readyNext()` |
| `sfx` | 声音 | `play(name,{gain,pitch})` · `loop()` · `setEnabled()` |
| `guides` | 三维方向箭头 | `set([{pos,dir}])` · `clear()` |
| `state` | 状态 | 直接读写；只有偏好落盘 |
| `engine` | 引擎自身 | `done()` · `go(i)` · `goToStep(id)` |
| `fx` | 粒子与提示环 | `ring(pos,axis)` · `spark(pos)` |

## 一步长什么样

```js
{
  id: 'C3', phase: 2,                 // phase 决定归到顶部哪一章
  title: '四颗面盖螺丝',
  cam: { az: 120, el: 8, dist: 0.45, target: [-0.25, 1.06, 0], fit: FIT_STEM },
  cue: { ico: 'screw', text: '<em>按对角顺序</em>拧，分两轮' },
  note: { title: '为什么要对角', spec: [['扭矩', '5–6 N·m']], body: '…' },
  task: { label: '拧好了', onClick(c, engine) { … } },   // 需要动手时才有
  async enter(c, engine) { … },
  exit(c) { … },
}
```

`cam.fit` 不是装饰：它声明「这一步必须完整看到多大一块」，画幅装不下时相机自动后退。
省掉它，手机上就会裁边。取值见 `steps/util.js` 的 `FIT_*`。

**翻页永远不被拦住。** 需要动手的步骤把动作放在底部那一个任务按钮上。

## 交互原语的共同约定

三条铁律，四个原语一律遵守：

1. **只有一个合法方向**，错误方向阻尼回弹并说明为什么，绝不允许自由 6DoF。
2. **按下即夺权，松手才交还**轨道控制。中途设回 `controls.enabled = true`，
   剩下半程会变成转镜头 —— 这是灯笼项目上验过的坑。
3. **每个原语都有自动路径**（`autoSeat` / `autoRun`），跳过的只是手感，
   该看到的一样不少。连续失败三次自动把「帮我装上」摆出来。

## 三处必须让手指记住的手感

| | 在哪 | 要点 |
|---|---|---|
| 左脚踏反牙 | `pedal-left-spindle`，`thread: "left"` | 允许拧错。往正牙方向拧两圈就发涩、停住、回退，并说明「左边是反的」 |
| 面盖对角顺序 | `stem-face` 四颗，`order: "cross"` | 顺序错了上下缝隙不均匀，画面上看得见那条缝歪掉 |
| 扭矩到点 | 全部 | 拧到底后继续转 = 加载，弧表从绿走到红，到点「咔」一声；过了滑丝 |
