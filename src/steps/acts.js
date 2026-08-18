/**
 * 八章二十九步：整车从零组装。第二步画面上只剩主车架，
 * 后三角、前端、操控、传动、轮组、刹车逐件长上去，
 * 顺序由清单的 needs 约束，`npm run verify` 的拓扑排序作证。
 *
 * 文案只有三处：步名（顶栏）、一行旁白（底部）、少数「为什么」卡片。
 * 卡片只出现在物理原因看不见的地方：反牙、对角、最小插入线。
 * 步骤的形状与四个取景入口见 docs/DEVELOPMENT.md；取景一律现算，不写常量。
 */

import {
  V, shot, frameWhole, frameBolts, burstOffset, burstReset, BURST_VIEW,
  installPart, partCenter, toolRow, fasten, fastenGroup,
} from './util.js';
import { tween, Ease } from '../util/tween.js';

/** 顶部章节名，按 phase 取。这是唯一一份 —— 界面层不自带 */
export const PHASES = ['开箱', '后三角', '前端', '操控', '传动', '轮组', '刹车', '上路'];

/*
 * 拆开那一步的总时长与错峰占比：二十七件分八层剥，层间要留得出看清一层的间隔。
 * 错峰占六成，剩下四成是单件自己的飞行 —— 太短甩，太长拖。
 */
const BURST_TIME = 2.6;
const BURST_STAGGER = 0.6;

const clamp01 = (x) => Math.max(0, Math.min(1, x));

/** 推入一件的标准步骤：取景现算、亮起、拖到位 */
const push = (ctx, { id, phase, title, cue, parts, hint, note, dir, cam, pad, off, sound, glow, near }) => ({
  id,
  phase,
  title,
  installs: parts,
  cam: shot(ctx, parts, { dir, cam, pad, off, near }),
  cue,
  note,
  enter(c, engine) {
    installPart(c, parts, { hint, sound, glow, onDone: () => engine.done() });
  },
  exit(c) { c.slide.cancel(); for (const p of parts) c.slide.park(p, 1); },
});

export function acts(ctx) {
  /*
   * 上一步站在哪个方位。传给 shot()：一步装一对镜像件时挑近的那一侧站。
   * 列表是顺着写下来的，一个游标够用。
   */
  let near;
  const P = (o) => {
    const s = push(ctx, { ...o, near });
    near = s.cam.az;
    return s;
  };
  /** 手写机位的步骤也要把游标带上，否则链子断在它们身上 */
  const at = (cam) => { near = cam.az; return cam; };

  return [
    // ══════════════ 开箱 ══════════════
    {
      id: 'A1',
      phase: 0,
      title: '装完是这样',
      showAll: true,
      // 已经钉了四枚带说明的圆点，不再挂跟随指针的名字牌
      noPick: true,
      /*
       * 开箱三步共用同一个机位（BURST_VIEW）：三步说的是同一台车的三种状态 ——
       * 装好的、摊开的、只剩车架的。镜头不动，变的只有车，
       * 「它是由这些东西组成的」这句话才立得住。
       */
      cam: at(frameWhole(ctx, { ...BURST_VIEW })),
      cue: '拖动画面转一圈，点标号认四处要点',
      enter(c) {
        const marks = [
          ['fork', '前叉', '连着头碗与前轮'],
          ['handlebar', '车把', '四颗面盖螺丝要对角上'],
          ['chainring', '传动', '牙盘、曲柄、链条、后拨'],
          ['rear-wheel', '轮组', '桶轴穿过花鼓，把整只轮子夹住'],
        ];
        marks.forEach(([id, name, sub], i) => {
          c.hud.addSpot(partCenter(c, id), name, { sub, badge: String(i + 1) });
        });
      },
    },
    {
      /*
       * 拆开看看：不教操作，只回答「这台车由多少东西组成」。
       * 摊开的几何见 util.js 的 burstOffset；时间上按装配顺序倒着走 ——
       * 最后装上的先飞出去，车架最后剩下。一层层剥才看得出层次，
       * 也正好接住下一步「从一根车架开始」。
       */
      id: 'A2',
      phase: 0,
      title: '拆开看看',
      showAll: true,
      // 机位与位移共用 BURST_VIEW 的 az/el：位移是在这个机位的屏幕平面里算的。
      // ease 0.55 把运镜拉长到与两秒六的摊开同步 —— 边摊边绕，视差即立体感
      cam: at({ ...frameWhole(ctx, { burst: true, ...BURST_VIEW }), ease: 0.55 }),
      // 不挂说明卡：一行旁白说得完。工具改在用到它的那一步卡上讲
      cue: `${ctx.bom.counts.parts} 个大件、${ctx.bom.counts.fasteners} 颗螺丝 · `
        + `${matchMedia('(pointer: coarse)').matches ? '点' : '指'}到哪件，报哪件的名字`,
      async enter(c, engine) {
        // 每一件的出场时刻：装得越晚，飞得越早。没人装的（车架这类底座）当第 0 步
        const last = engine.steps.length - 1;
        const startOf = new Map(c.bom.parts.map((p) => {
          const at = c.build?.stepOf(p.id) ?? 0;
          return [p.id, (1 - at / last) * BURST_STAGGER];
        }));

        // 第二个参数是未过缓动的线性进度 —— 错峰按真实时间排，不按缓动后的
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
      // 画面上只剩光车架，取景就量它；机位仍是开箱这一章那一个
      cam: at(frameWhole(ctx, { bare: true, ...BURST_VIEW })),
      cue: '其余还在箱子里，接下来一件一件长上去',
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
      /*
       * 避震是一整根。模型按悬挂动画的需要把它拆在两个父级下，
       * 清单里四个节点归成一件（见清单 shock 的 note），
       * 否则上眼那一截会一直算车架的，光车架照上挂着半根避震。
       */
      id: 'B3',
      phase: 1,
      title: '后避震',
      parts: ['shock'],
      cue: '上眼落进车架的座，下眼落进连杆的座',
      hint: '顺着避震自己的轴压下去',
      note: {
        title: '它是被两颗螺栓穿住的',
        spec: [['眼距 × 行程', '200 × 57 mm']],
        body: '避震两端各有一个眼孔：上眼对进主车架的避震座，下眼对进摇臂那根连杆，'
          + '各穿一颗贯穿螺栓拧死 —— 它不是卡上去、也不是压进去的。'
          + '眼孔里是衬套，拧死之后两头仍然能摆：后轮每动一次，避震就绕着这两颗螺栓转一点。'
          + '<em>模型里没有这两颗螺栓，这一步演到落进两个座为止。</em>'
          + '行程只要 57 mm，是因为后轮的 160 mm 靠摇臂放大 —— 短杆、大杠杆比。',
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
      cue: '两只碗从上下两头压进头管',
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
      /*
       * 站正侧方那一档（az 105），不用 viewFor 报的前四分之三位：
       * 车把是顺着车身长轴往后坐进托座的，侧方才能把「往后推」
       * 画成一段实实在在的横移，顺带摆平托座、舵管、把立的关系；
       * 前四分之三位上这段行程大半落在纵深里，看着像车把在慢慢变大。
       * 正对车把（az 90）是端着看，屏幕上只剩 9% 宽。
       * off 左上偏一档：车头朝左，右边留给落点；此刻车上的东西全在车把下方，
       * 不抬高的话上半幅全空、前叉又被切在画幅外。
       */
      cam: { az: 105, el: 14 },
      off: [-0.13, 0.14],
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
        spec: [toolRow(ctx.bom.fastener('stem-face-a'))],
        body: '一颗拧死再拧下一颗，面盖会被拽歪，上下两条缝一宽一窄 —— '
          + '受力全压在窄的那边，碳纤维车把从那儿裂。',
      },
      enter(c, engine) {
        const paint = () => c.hud.setBoltRow(c.bom.groupOf('stem-face').map((f) => ({
          id: f.id,
          name: f.name,
          state: c.state.fastened[f.id] ? 'tight' : 'pending',
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
      exit(c) { c.screw.cancel(); c.hud.setBoltRow(null); },
    },
    P({
      id: 'D3',
      phase: 3,
      title: '两只刹把',
      parts: ['lever-left', 'lever-right'],
      cue: '刹把从两端滑上车把',
      pad: 1.1,
    }),
    P({
      id: 'D4',
      phase: 3,
      title: '两只把套',
      parts: ['grip-left', 'grip-right'],
      cue: '把套从两端推到底',
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
      cue: '后轮抬进摇臂末端的勾爪',
      hint: '顺着摇臂往上抬',
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
      cue: '前轮抬进前叉的勾爪',
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
        spec: [['规格', 'Boost 15 × 110 mm'], toolRow(ctx.bom.fastener('axle-front'))],
        body: '它是一根穿过花鼓、拧进对面叉腿的螺杆，拧到底就把整只轮子夹住了 —— '
          + '作用是夹紧，不是越紧越安全。',
      },
      enter(c, engine) {
        fasten(c, 'axle-front', {
          onTight: () => { c.hud.toast('桶轴到底了', { tone: 'go' }); engine.done(); },
        });
      },
      exit(c) { c.screw.cancel(); },
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
      // 油管是两根细黑管贴在黑车架上，取景又是整个前端 —— 常规 0.1 的自发光
      // 在这个画幅上等于没亮。亮成两条橙线，「走到哪儿」才看得见
      glow: 0.45,
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
        spec: [toolRow(ctx.bom.fastener('pedal-right-spindle'))],
        body: '记不住哪边反牙没关系：<em>站在那一侧，把扳手朝车头方向压，就是拧紧。</em>',
      },
      enter(c, engine) {
        c.slide.park('pedal-right', 0);
        fasten(c, 'pedal-right-spindle', {
          // 脚踏轴不是独立螺栓 —— 它长在脚踏上，整只脚踏跟着旋进去
          onProgress: (p) => c.slide.park('pedal-right', p.depth),
          onTight: () => {
            c.slide.park('pedal-right', 1);
            c.state.installed = { ...c.state.installed, 'pedal-right': true };
            c.hud.toast('右边拧到底了', { tone: 'go' });
            engine.done();
          },
        });
      },
      exit(c) { c.screw.cancel(); c.slide.park('pedal-right', 1); },
    },
    {
      id: 'H3',
      phase: 7,
      title: '左脚踏：反牙',
      installs: ['pedal-left'],
      fastens: ['pedal-left-spindle'],
      // 与右脚踏对称，各站自己那一侧的前四分之三位。这一步讲「朝车头方向拧」，
      // 车头得在画面里；站车尾侧看得更清，但与上一步隔着 180°
      cam: at(shot(ctx, ['pedal-left'], { cam: { az: 125, el: 18 }, pad: 1.45 })),
      cue: '照样朝车头方向拧 —— 但这边的牙是反的',
      note: {
        title: '为什么偏偏左边是反的',
        spec: [['牙向', '左旋'], toolRow(ctx.bom.fastener('pedal-left-spindle'))],
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
          onTight: () => {
            c.slide.park('pedal-left', 1);
            c.state.installed = { ...c.state.installed, 'pedal-left': true };
            c.hud.toast('两边都拧上了', { tone: 'go' });
            engine.done();
          },
        });
      },
      exit(c) { c.screw.cancel(); c.slide.park('pedal-left', 1); },
    },
    {
      id: 'H4',
      phase: 7,
      title: '出门前自检',
      showAll: true,
      // 回到开箱那一个机位：首尾同一个视角，上一步刚从左脚踏过来，只要转十几度
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
 * 出门前自检：二十七件装没装、七颗拧了没有。每一行都能点回它所属的那一步 ——
 * 归属从步骤声明的 installs / fastens 现推，不另抄对照表。
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
    const on = !!c.state.fastened[f.id];
    if (!on) left += 1;
    rows.push({
      col: 1,
      id: f.id,
      name: f.name,
      tone: on ? 'ok' : 'miss',
      val: on ? '拧上了' : '没拧',
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
  // 表头带「几件里好了几件」：三十四行装不进一屏，列要滚，没有计数读不出全貌
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

  // 结语要与备注对得上：有备注时不说「全部到位」，两句话不能互相拆台
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
