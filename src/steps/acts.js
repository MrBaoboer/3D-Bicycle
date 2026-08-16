/**
 * 从一根车架装到能骑走 —— 八章二十九步。
 *
 * 这一遍是**整车从零组装**，不是「网购车到家补装四件」：
 * 第二步画面上只剩一根主车架，后三角、前叉、操控、传动、轮组、刹车逐件长上去。
 * 装配顺序由清单的 needs 约束，`npm run verify` 的拓扑排序替它作证。
 *
 * 文案只留三处：步名（顶栏）、一句旁白（底部）、以及少数几张「为什么」卡片。
 * 其余交给动画 —— 这一份要让人**看懂**，不是让人读懂。
 * 所以卡片只出现在「物理原因看不见」的地方：反牙、扭矩、对角、最小插入线。
 *
 * 每一步是一份声明加两个钩子，形状见 docs/CONTRACT.md。
 * 取景一律由 shot() 从几何现算，不写常量。
 */

import {
  V, shot, frameWhole, frameBolts, burstOffset, burstReset, BURST_VIEW,
  installPart, partCenter, torqueRow, toolList, fasten, fastenGroup,
} from './util.js';
import { torqueText } from '../core/state.js';
import { tween, Ease } from '../util/tween.js';

/** 顶部章节名，按 phase 取。**这是唯一一份** —— 界面层不再自带一套 */
export const PHASES = ['开箱', '后三角', '前端', '操控', '传动', '轮组', '刹车', '上路'];

/**
 * 拆开那一步摊多久、错峰摊掉其中多少。
 *
 * 2.6 秒不是随手给的：二十七件分八层剥，每层之间要留得出一眼看清的间隔，
 * 而整段又不能长到让人想按下一步。错峰占掉六成 —— 剩下四成是每一件自己飞出去的时间，
 * 太短会甩，太长会拖。
 */
const BURST_TIME = 2.6;
const BURST_STAGGER = 0.6;

const clamp01 = (x) => Math.max(0, Math.min(1, x));

/** 推入一件的标准步骤：取景现算、亮起、拖到位 */
const push = (ctx, { id, phase, title, cue, parts, hint, note, dir, cam, pad, sound, near }) => ({
  id,
  phase,
  title,
  installs: parts,
  cam: shot(ctx, parts, { dir, cam, pad, near }),
  cue,
  note,
  enter(c, engine) {
    installPart(c, parts, { hint, sound, onDone: () => engine.done() });
  },
  exit(c) { c.slide.cancel(); for (const p of parts) c.slide.park(p, 1); },
});

export function acts(ctx) {
  /*
   * 上一步站在哪个方位。传给 shot()，一步装一对镜像件时挑近的那一侧站 ——
   * 见 util.js 的 shot()。列表是顺着写下来的，所以这一个游标够用。
   */
  let near;
  const P = (o) => {
    const s = push(ctx, { ...o, near });
    near = s.cam.az;
    return s;
  };
  /** 手写机位的那几步也要把游标带上，否则链子断在它们身上 */
  const at = (cam) => { near = cam.az; return cam; };

  return [
    // ══════════════ 开箱 ══════════════
    {
      id: 'A1',
      phase: 0,
      title: '装完是这样',
      showAll: true,
      /*
       * 整车这几张也从几何现量。手写的那一对常量把整车半高报小了一成多，
       * 于是首屏第一眼的成品照下缘就切掉一截后轮。
       *
       * 开箱这一章三步**共用同一个机位**（`BURST_VIEW`）。这三步说的是同一台车的
       * 三种状态：装好的、摊开的、只剩车架的 —— 镜头不动，变的只有车，
       * 「它是由这些东西组成的」这句话才立得住。镜头要是每一步都甩过去七十度，
       * 看的人先得重新认一遍这是哪儿，那三张图就成了三张不相干的图。
       */
      cam: at(frameWhole(ctx, { ...BURST_VIEW })),
      cue: '拖动画面转一圈。点标号看看四处要点',
      enter(c) {
        const marks = [
          ['fork', '前叉', '连着头碗与前轮'],
          ['handlebar', '车把', '四颗面盖螺丝要对角上'],
          ['chainring', '传动', '牙盘、曲柄、链条、后拨'],
          ['rear-wheel', '轮组', '桶轴穿过花鼓拧进叉腿'],
        ];
        marks.forEach(([id, name, sub], i) => {
          c.hud.addSpot(partCenter(c, id), name, { sub, badge: String(i + 1) });
        });
      },
    },
    {
      /*
       * 拆开看看。这一步不教任何操作，它只回答一个问题：这台车到底由多少东西组成。
       *
       * 摊开的方式是有讲究的，见 util.js 的 burstOffset：径向等比放大把件彼此分开，
       * 再沿「它是从哪一侧装进来的」反方向推一段，同轴套在一起的那几件才散得开。
       *
       * 时间上**按装配顺序倒着走**：最后装上的先飞出去，车架最后剩下。
       * 一口气全炸开只是一次位移，看不出层次；倒着一层层剥，
       * 眼睛跟得上，而且顺带把「这台车是分几层长起来的」说了一遍 ——
       * 下一步「从一根车架开始」正好接住。
       */
      id: 'A2',
      phase: 0,
      title: '拆开看看',
      showAll: true,
      /*
       * 机位与位移共用同一组 az/el：位移是在这个机位的屏幕平面里算的，两边必须一致。
       * ease 给到 0.55（运镜时长按它拉长）—— 这一趟要与两秒六的摊开同步走完，
       * 摊开的同时镜头绕过去七十来度，那层视差正是「它真的是立体的」这句话。
       */
      cam: at({ ...frameWhole(ctx, { burst: true, ...BURST_VIEW }), ease: 0.55 }),
      /*
       * 这一步不挂说明卡。原先那张卡三行里有两行与底下这句旁白一字不差
       * （二十七件、七颗），只有「工具」一行是新的 —— 而它在宽屏上占掉右边
       * 三百三十二像素，正好是这一步唯一要做的事：把二十七件摊开给人看。
       * 一行旁白说得完的事，不值得用四分之一个画幅去说第二遍。
       */
      cue: `${ctx.bom.counts.parts} 个大件、${ctx.bom.counts.fasteners} 颗要上扭矩的螺丝 · 工具 ${toolList(ctx)}`,
      async enter(c, engine) {
        // 每一件的出场时刻：装得越晚，飞得越早。没人装的（车架这类底座）当第 0 步
        const last = engine.steps.length - 1;
        const startOf = new Map(c.bom.parts.map((p) => {
          const at = c.build?.stepOf(p.id) ?? 0;
          return [p.id, (1 - at / last) * BURST_STAGGER];
        }));

        // 第二个参数是没过缓动的线性进度 —— 错峰要按真实时间排，不能按缓动后的
        await tween(BURST_TIME, (_, t) => {
          for (const p of c.bom.parts) {
            const k = (t - startOf.get(p.id)) / (1 - BURST_STAGGER);
            c.slide.burst(p.id, burstOffset(c, p.id, Ease.outCubic(clamp01(k))));
          }
        }, { ease: Ease.linear });
      },
      exit(c) { burstReset(c); },
    },
    {
      id: 'A3',
      phase: 0,
      title: '从一根车架开始',
      installs: [],
      // 这一步画面上只剩光车架 —— 取景就量它，别的件此刻都还在箱子里。
      // 机位仍是开箱这一章那一个，见 A1
      cam: at(frameWhole(ctx, { bare: true, ...BURST_VIEW })),
      cue: '其余全在箱子里。接下来一件件长上去',
    },

    // ══════════════ 后三角 ══════════════
    P({
      id: 'B1',
      phase: 1,
      title: '主转点轴',
      parts: ['rear-pivot'],
      cue: '轴从左侧穿进主转点',
      hint: '顺着轴线推，不是往上抬',
    }),
    P({
      id: 'B2',
      phase: 1,
      title: '左右摇臂',
      parts: ['swingarm-left', 'swingarm-right'],
      cue: '两条摇臂从两侧套上转点轴',
      hint: '从外往里推',
      pad: 1.1,
    }),
    P({
      id: 'B3',
      phase: 1,
      title: '后避震',
      parts: ['shock'],
      cue: '避震从上方落进两个座',
      hint: '顺着避震自己的轴压下去',
      note: {
        title: '为什么是这根短杆',
        body: '这台车的后轮行程靠摇臂放大，所以避震只需要 57 mm 行程 —— '
          + '短杆、大杠杆比，换来的是后轮 160 mm 的行程。',
      },
    }),
    P({
      id: 'B4',
      phase: 1,
      title: '下护板',
      parts: ['bash-guard'],
      cue: '护板从下方贴上五通',
    }),

    // ══════════════ 前端 ══════════════
    P({
      id: 'C1',
      phase: 2,
      title: '上下头碗',
      parts: ['headset-lower', 'headset-upper'],
      cue: '两只碗从两头压进头管',
      hint: '顺着头管的方向压',
      dir: [-0.4228, -0.9062, 0],
    }),
    P({
      id: 'C2',
      phase: 2,
      title: '前叉穿上来',
      parts: ['fork'],
      cue: '舵管从下往上穿过头管',
      hint: '顺着头管往上，不是往前',
    }),
    P({
      id: 'C3',
      phase: 2,
      title: '把立压下去',
      parts: ['stem'],
      cue: '把立从上方套住舵管',
      hint: '顺着舵管压下去',
    }),

    // ══════════════ 操控 ══════════════
    P({
      id: 'D1',
      phase: 3,
      title: '车把放进托座',
      parts: ['handlebar'],
      cue: '车把往后坐进把立的托座',
      hint: '往车身方向推，不是往上抬',
      note: {
        title: '先对中',
        body: '车把中间有一圈刻度，左右等长再压面盖。'
          + '装的时候两秒，回头再调要拆四颗螺丝。',
      },
    }),
    {
      id: 'D2',
      phase: 3,
      title: '四颗面盖螺丝',
      fastens: ['stem-face-a', 'stem-face-b', 'stem-face-c', 'stem-face-d'],
      cam: at(frameBolts(ctx, 'stem-face', { az: 170, el: 26 })),
      cue: '按对角顺序拧，四颗分两轮',
      note: {
        title: '为什么必须对角',
        spec: [['工具', '4 mm 内六角'], torqueRow(ctx.bom.fastener('stem-face-a'))],
        body: '一颗拧死再拧下一颗，面盖会被拽歪，上下两条缝一宽一窄 —— '
          + '受力全压在窄的那边，碳纤维车把从那儿裂。',
      },
      enter(c, engine) {
        const paint = () => c.hud.setBoltRow(c.bom.groupOf('stem-face').map((f) => ({
          id: f.id,
          name: f.name,
          state: c.state.stripped[f.id] ? 'stripped' : c.state.fastened[f.id] ? 'tight' : 'pending',
        })));
        paint();
        fastenGroup(c, 'stem-face', {
          onEach: (id, { orderOk }) => {
            if (!orderOk) c.hud.toast('这颗不是上一颗的对角 —— 缝隙会走偏', { tone: 'stop' });
            paint();
          },
          onAll: () => {
            const skipped = c.state.crossOrderOk === false;
            c.hud.toast(skipped ? '四颗都上了 —— 但有一颗没接着对角走' : '四颗都到位，上下两条缝是匀的',
              { tone: skipped ? 'stop' : 'go' });
            engine.done();
          },
        });
      },
      exit(c) { c.screw.cancel(); c.hud.setBoltRow(null); c.hud.setTorqueGauge(null); },
    },
    P({
      id: 'D3',
      phase: 3,
      title: '两只把套',
      parts: ['grip-left', 'grip-right'],
      cue: '把套从两端推到底',
      pad: 1.1,
    }),
    P({
      id: 'D4',
      phase: 3,
      title: '两只刹把',
      parts: ['lever-left', 'lever-right'],
      cue: '刹把从两端滑到把套内侧',
      pad: 1.1,
    }),

    // ══════════════ 传动 ══════════════
    P({
      id: 'E1',
      phase: 4,
      title: '牙盘',
      parts: ['chainring'],
      cue: '牙盘贴上曲柄的直装座',
    }),
    P({
      id: 'E2',
      phase: 4,
      title: '左右曲柄',
      parts: ['crank-left', 'crank-right'],
      cue: '两条曲柄从两侧穿进五通',
      hint: '顺着五通轴推进去',
      pad: 1.1,
      note: {
        title: '曲柄相位差 180°',
        body: '两条曲柄必须正好反向。同向的话，一圈里有一段完全踩不上力。',
      },
    }),
    P({
      id: 'E3',
      phase: 4,
      title: '后拨',
      parts: ['derailleur'],
      cue: '后拨挂上尾勾',
    }),

    // ══════════════ 轮组 ══════════════
    P({
      id: 'F1',
      phase: 5,
      title: '后轮进后叉',
      parts: ['rear-wheel'],
      cue: '后轮抬进摇臂末端',
      hint: '顺着叉腿往上抬',
      sound: 'WHEEL_SEAT',
      note: {
        title: '飞轮朝传动侧',
        body: '整轮是成品，飞轮与刹车碟已经在花鼓上。放进去之前先看一眼：'
          + '飞轮那一侧朝右，碟片那一侧朝左。',
      },
    }),
    P({
      id: 'F2',
      phase: 5,
      title: '前轮进前叉',
      parts: ['front-wheel'],
      cue: '前轮抬进叉腿末端的槽',
      hint: '顺着叉腿往上抬，不是横着推',
      sound: 'WHEEL_SEAT',
      note: {
        title: '碟片要对准卡钳',
        body: '刹车碟得从卡钳的两片来令片之间穿过去。对不准就硬推，会把来令片顶歪。',
      },
    }),
    {
      id: 'F3',
      phase: 5,
      title: '桶轴穿进去',
      fastens: ['axle-front'],
      cam: at(frameBolts(ctx, 'axle-front', { az: 105, el: 16 })),
      cue: '绕着轴心画圈，把桶轴拧进去',
      note: {
        title: '桶轴不是快拆',
        spec: [['规格', 'Boost 15 × 110 mm'], torqueRow(ctx.bom.fastener('axle-front'))],
        body: '它是一根穿过花鼓、拧进对面叉腿的螺杆。拧到规定扭矩就停 —— '
          + '作用是夹紧，不是越紧越安全。',
      },
      enter(c, engine) {
        fasten(c, 'axle-front', {
          onTight: (nm) => { c.hud.toast(`${torqueText(nm)}，到了`, { tone: 'go' }); engine.done(); },
          onStrip: () => c.hud.toast('拧过头了 —— 叉腿的螺纹是铝的，滑丝就得换叉腿', { tone: 'stop' }),
        });
      },
      exit(c) { c.screw.cancel(); c.hud.setTorqueGauge(null); },
    },

    // ══════════════ 刹车 ══════════════
    P({
      id: 'G1',
      phase: 6,
      title: '前刹卡钳',
      parts: ['caliper-front'],
      cue: '卡钳骑上碟片，贴住叉腿的座',
    }),
    P({
      id: 'G2',
      phase: 6,
      title: '后刹卡钳',
      parts: ['caliper-rear'],
      cue: '后卡钳同样骑上碟片',
    }),
    P({
      id: 'G3',
      phase: 6,
      title: '接上油管',
      parts: ['hoses'],
      cue: '两根油管从刹把一路走到卡钳',
      pad: 1.05,
    }),
    P({
      id: 'G4',
      phase: 6,
      title: '链条',
      parts: ['chain'],
      cue: '链条绕过牙盘、导轮与后拨',
      note: {
        title: '这台车多一个导轮',
        body: '高转点车架的链条要绕过一只导轮再上飞轮 —— 转点抬高换来更顺的后轮轨迹，'
          + '代价就是这一处多出来的绕行。',
      },
    }),

    // ══════════════ 上路 ══════════════
    P({
      id: 'H1',
      phase: 7,
      title: '座管插进立管',
      parts: ['seatpost'],
      cue: '顺着立管往下压，插过最小插入线',
      hint: '顺着立管的方向压下去',
      sound: 'POST_SEAT',
      note: {
        title: '最小插入线',
        body: '插浅了，立管口就成了一个杠杆支点，车架会从那一圈裂开。这条线不是建议。',
      },
    }),
    {
      id: 'H2',
      phase: 7,
      title: '右脚踏：正牙',
      installs: ['pedal-right'],
      fastens: ['pedal-right-spindle'],
      cam: at(shot(ctx, ['pedal-right'], { cam: { az: 235, el: 18 }, pad: 1.45 })),
      cue: '朝车头方向拧 —— 右边是正牙',
      note: {
        title: '两边都是「朝车头拧紧」',
        spec: [['工具', '15 mm 扳手'], torqueRow(ctx.bom.fastener('pedal-right-spindle'))],
        body: '记不住哪边反牙没关系：<em>站在那一侧，把扳手朝车头方向压，就是拧紧。</em>',
      },
      enter(c, engine) {
        c.slide.park('pedal-right', 0);
        fasten(c, 'pedal-right-spindle', {
          // 脚踏轴不是一颗独立的螺栓 —— 它就长在脚踏上，所以整只脚踏跟着旋进去
          onProgress: (p) => c.slide.park('pedal-right', p.depth),
          onTight: (nm) => {
            c.slide.park('pedal-right', 1);
            c.state.installed = { ...c.state.installed, 'pedal-right': true };
            c.hud.toast(`${torqueText(nm)}，右边好了`, { tone: 'go' });
            engine.done();
          },
        });
      },
      exit(c) { c.screw.cancel(); c.hud.setTorqueGauge(null); c.slide.park('pedal-right', 1); },
    },
    {
      id: 'H3',
      phase: 7,
      title: '左脚踏：反牙',
      installs: ['pedal-left'],
      fastens: ['pedal-left-spindle'],
      // 与右脚踏那一步对称：各自站在自己那一侧的前四分之三位。
      // 站到车尾侧（az 55）也看得见脚踏，但这一步要讲的是「朝车头方向拧」，
      // 车头得在画面里；而且那样与上一步隔着整整 180°，镜头要绕大半台车
      cam: at(shot(ctx, ['pedal-left'], { cam: { az: 125, el: 18 }, pad: 1.45 })),
      cue: '照样朝车头方向拧 —— 但这边的牙是反的',
      note: {
        title: '为什么偏偏左边是反的',
        spec: [['牙向', '左旋'], torqueRow(ctx.bom.fastener('pedal-left-spindle'))],
        body: '踩踏时脚踏轴在曲柄孔里滚，滚的方向恰好把正牙越拧越松。'
          + '左边做成反牙，「越骑越松」就变成了「越骑越紧」。',
      },
      enter(c, engine) {
        c.slide.park('pedal-left', 0);
        fasten(c, 'pedal-left-spindle', {
          onProgress: (p) => c.slide.park('pedal-left', p.depth),
          onWrongWay: () => {
            c.hud.toast('这边转不进去 —— 左脚踏是反牙，往反方向转才是拧紧', { tone: 'stop' });
          },
          onTight: (nm) => {
            c.slide.park('pedal-left', 1);
            c.state.installed = { ...c.state.installed, 'pedal-left': true };
            c.hud.toast(`${torqueText(nm)}，两边都好了`, { tone: 'go' });
            engine.done();
          },
        });
      },
      exit(c) { c.screw.cancel(); c.hud.setTorqueGauge(null); c.slide.park('pedal-left', 1); },
    },
    {
      id: 'H4',
      phase: 7,
      title: '出门前自检',
      showAll: true,
      // 回到开箱那一个机位。首尾同一个视角，一遍装下来是回到原地看同一台车 ——
      // 何况上一步刚从左脚踏那边过来，落在这儿只要转十几度
      cam: at(frameWhole(ctx, { ...BURST_VIEW })),
      cue: '这一遍装到哪儿了，逐条对一下',
      enter(c, engine) { tally(c, engine); },
      exit(c) { c.hud.closeOverlays(); },
    },
    {
      id: 'H5',
      phase: 7,
      title: '可以骑了',
      showAll: true,
      cam: at(frameWhole(ctx, { az: 90, el: 6 })),
      cue: '装完了。骑五十公里回来，把七颗螺丝再过一遍',
    },
  ];
}

/**
 * 出门前自检：二十六件装没装、七颗紧固件拧到多少。
 *
 * 每一行都能点回它所属的那一步 —— 一张只会说「还没装」的清单把人留在原地，
 * 能点回去的清单才是「接下来做什么」。归属关系从步骤自己声明的
 * installs / fastens 里现推，不另抄一份对照表。
 */
function tally(c, engine) {
  const owner = new Map();
  for (const s of engine.steps) {
    for (const id of [...(s.installs ?? []), ...(s.fastens ?? [])]) owner.set(id, s.id);
  }

  const rows = [];
  let left = 0;
  for (const p of c.bom.parts) {
    const on = !!c.state.installed[p.id];
    if (!on) left += 1;
    rows.push({ col: 0, id: p.id, name: p.name, tone: on ? 'ok' : 'miss', val: on ? '装上了' : '还没装' });
  }
  for (const f of c.bom.fasteners) {
    const nm = c.state.fastened[f.id];
    const bad = c.state.stripped[f.id];
    if (nm === undefined) left += 1;
    rows.push({
      col: 1,
      id: f.id,
      name: f.name,
      tone: bad ? 'bad' : nm !== undefined ? 'ok' : 'miss',
      val: bad ? '滑丝' : nm !== undefined ? torqueText(nm) : '没拧',
    });
  }

  const cell = (r, i) => {
    const to = owner.get(r.id);
    const tag = to ? 'button' : 'div';
    return `<${tag} class="tally-row" data-tone="${r.tone}"${to ? ` type="button" data-go="${i}"` : ''}>
      <span class="tally-nm">${r.name}</span><i></i>
      <b class="tally-val">${r.val}</b>
    </${tag}>`;
  };
  /*
   * 每一列的表头带上「几件里好了几件」。三十四行装不进一屏，列是要滚的 ——
   * 没有这个计数，看见的就只是被切掉上下两头的七八行，读不出全貌。
   */
  const col = (n, head) => {
    const list = rows.filter((r) => r.col === n);
    const ok = list.filter((r) => r.tone !== 'miss').length;
    return `<div class="tally-col scroll">
      <p class="tally-hd">${head}<b>${ok}／${list.length}</b></p>`
      + rows.map((r, i) => (r.col === n ? cell(r, i) : '')).join('') + '</div>';
  };

  const marks = [];
  if (c.state.wrongThread > 0) marks.push(`左脚踏往拧松的方向转过 ${c.state.wrongThread} 次`);
  if (c.state.crossOrderOk === false) marks.push('面盖有一颗不是上一颗的对角');
  const stripped = Object.keys(c.state.stripped).length;
  if (stripped) marks.push(`${stripped} 颗拧过头滑丝了`);

  /*
   * 结语要与上面那几行对得上。早先无论有没有备注，装满了就一律报「全部到位。可以骑了。」
   * —— 于是「面盖有一颗没按对角顺序上」的正下方紧跟着一句「全部到位」，
   * 两句话互相拆台，读的人不知道到底该不该骑。
   */
  const hint = left > 0
    ? `还差 ${left} 处。点那一行回到对应的步骤。`
    : marks.length
      ? '都装上了。上面这几处值得回头再看一眼。'
      : '二十七件、七颗，全部到位。可以骑了。';

  c.hud.dock({
    body: `<div class="tally">${col(0, '大件')}${col(1, '紧固件')}</div>`
      + (marks.length ? `<p class="tally-mark">${marks.join('；')}</p>` : ''),
    hint,
    onMount: (root) => {
      root.querySelectorAll('[data-go]').forEach((el) => {
        el.addEventListener('click', () => engine.goToStep(owner.get(rows[+el.dataset.go].id)));
      });
    },
  });
}

/** 三维标注要用到的世界坐标构造器，转出去给别处用 */
export { V };
