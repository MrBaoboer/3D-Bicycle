/**
 * 六章十三步 —— 从纸箱到能骑走。
 *
 * 这台车是直邮到家的全避震山地车：出厂时后轮、传动、刹车都装好了，
 * 到家要动手的就是四件 —— 前轮、车把、座管、脚踏。真实情况正是如此。
 *
 * 每一步是一份声明加两个钩子，形状见 docs/CONTRACT.md。
 * 翻页永远不被拦住：螺丝没拧完也能往前走，底部那一个任务按钮与导航互不相干。
 */

import {
  AIM_BIKE, FIT_BIKE, AIM_FRONT, FIT_FRONT, AIM_BAR, FIT_BAR,
  AIM_STEM, FIT_STEM, AIM_SEAT, FIT_SEAT, AIM_PEDAL_L, AIM_PEDAL_R, FIT_PEDAL,
  Junk, installPart, torqueRow,
} from './util.js';

/** 把一件从装配位退到预备位，摆出「还没装」的样子 */
function detach(ctx, partId) {
  const p = ctx.bom.part(partId);
  for (const name of ctx.bom.nodesOf(partId)) {
    const o = ctx.bike.get(name);
    if (!o.userData.homePos) o.userData.homePos = o.position.clone();
    o.position.copy(o.userData.homePos).addScaledVector(p.install.v.dir, -p.install.gap);
  }
}

/** 复位到装配位 */
function reattach(ctx, partId) {
  for (const name of ctx.bom.nodesOf(partId)) {
    const o = ctx.bike.get(name);
    if (o.userData.homePos) o.position.copy(o.userData.homePos);
  }
}

export function acts(ctx) {
  const junk = new Junk(ctx.stage.scene);

  return [
    // ══════════════ 开箱 ══════════════
    {
      id: 'A1', phase: 0,
      title: '车到了',
      cam: { az: 38, el: 14, target: AIM_BIKE, fit: FIT_BIKE, snap: true },
      cue: { ico: 'box', text: '拖动画面转一圈，先看看这台车' },
      note: {
        title: '直邮到家的车，装好了多少',
        spec: [
          ['出厂已装', '车架、后轮、传动、刹车、避震'],
          ['到家要装', '前轮、车把、座管、左右脚踏'],
          ['随车工具', '4 / 5 / 6 mm 内六角，15 mm 脚踏扳手'],
        ],
        body: '整车在厂里装好再拆掉四件装箱 —— 拆的正是最占地方、也最不怕装错的那几件。'
          + '所以到家这一遍不是「造一台车」，是把厂里拆掉的四件按原样装回去。',
      },
    },
    {
      id: 'A2', phase: 0,
      title: '先把撑块取掉',
      cam: { az: 150, el: 10, target: AIM_FRONT, fit: FIT_FRONT },
      cue: { ico: 'warn', text: '前叉之间那块塑料撑块，<em>必须先取掉</em>' },
      note: {
        title: '它是干什么的',
        body: '运输时前叉之间垫一块塑料，防止两条叉腿被压变形。'
          + '它卡在前轮的位置上 —— 不取，前轮根本放不进去。'
          + '每年都有人拿着轮子在那儿较劲，就为这块两块钱的塑料。',
      },
      task: {
        label: '取掉了',
        onClick(c, engine) { c.sfx.play('TICK'); engine.done(); },
      },
    },

    // ══════════════ 前轮 ══════════════
    {
      id: 'B1', phase: 1,
      title: '前轮抬进前叉',
      cam: { az: 150, el: 8, target: AIM_FRONT, fit: FIT_FRONT },
      cue: { ico: 'drag', text: '<em>把前轮往上抬</em>，让轮轴落进叉腿末端的槽' },
      note: {
        title: '碟片要对准卡钳',
        body: '抬起来之前先看一眼：刹车碟得从卡钳的两片来令片之间穿过去。'
          + '对不准就硬推，会把来令片顶歪。',
      },
      async enter(c, engine) {
        detach(c, 'front-wheel');
        await installPart(c, 'front-wheel', {
          hint: '顺着叉腿往上抬，不是横着推',
          onDone: () => { c.hud.toast('轮轴到底了'); engine.done(); },
        });
      },
      exit(c) { c.slide.cancel(); },
    },
    {
      id: 'B2', phase: 1,
      title: '桶轴穿进去',
      cam: { az: 120, el: 12, target: AIM_FRONT, fit: FIT_FRONT },
      cue: { ico: 'screw', text: '<em>绕着轴心画圈</em>，把桶轴拧进去' },
      note: {
        title: '桶轴不是快拆',
        spec: [['规格', 'Boost 15 × 110 mm'], torqueRow(ctx.bom.fastener('axle-front'))],
        body: '桶轴是一根穿过花鼓、拧进对面叉腿的螺杆，比老式快拆刚性高得多。'
          + '拧到规定扭矩就停 —— 它的作用是夹紧，不是越紧越安全。',
      },
      async enter(c, engine) {
        const f = c.bom.fastener('axle-front');
        c.bolts.spawn(f);
        c.hud.setTorqueGauge({ nm: 0, min: f.torque[0], max: f.torque[1], strip: f.strip });
        c.screw.begin({
          fastenerId: 'axle-front',
          onProgress: (nm) => c.hud.setTorqueGauge({ nm, min: f.torque[0], max: f.torque[1], strip: f.strip }),
          onTight: (nm) => {
            c.state.fastened = { ...c.state.fastened, 'axle-front': nm };
            c.hud.toast(`到了 ${nm.toFixed(1)} N·m`);
            engine.done();
          },
          onStrip: () => {
            c.state.stripped = { ...c.state.stripped, 'axle-front': true };
            c.hud.toast('拧过头了 —— 叉腿上的螺纹是铝的，滑丝就换叉腿');
          },
        });
        c.hud.setAlts([{ label: '帮我拧上', ico: 'wrench', onClick: () => c.screw.autoRun('axle-front') }]);
      },
      exit(c) { c.screw.cancel(); c.hud.setTorqueGauge(null); },
    },

    // ══════════════ 车把 ══════════════
    {
      id: 'C1', phase: 2,
      title: '车把放进托座',
      cam: { az: 65, el: 16, target: AIM_BAR, fit: FIT_BAR },
      cue: { ico: 'drag', text: '<em>把车把往后推</em>，坐进把立的托座' },
      note: {
        title: '先对中',
        body: '车把中间有一圈刻度，让它左右等长再压面盖。'
          + '偏了骑起来会一直觉得身子是歪的，而这件事装的时候两秒，回头再调要拆四颗螺丝。',
      },
      async enter(c, engine) {
        detach(c, 'handlebar');
        await installPart(c, 'handlebar', {
          hint: '往车身方向推，不是往上抬',
          onDone: () => engine.done(),
        });
      },
      exit(c) { c.slide.cancel(); },
    },
    {
      id: 'C2', phase: 2,
      title: '四颗面盖螺丝',
      cam: { az: 100, el: 10, target: AIM_STEM, fit: FIT_STEM },
      cue: { ico: 'screw', text: '<em>按对角顺序</em>拧，四颗分两轮' },
      note: {
        title: '为什么必须对角',
        spec: [
          ['工具', '4 mm 内六角'],
          torqueRow(ctx.bom.fastener('stem-face-a')),
          ['缝隙', '上下均匀'],
        ],
        body: '一颗拧死再拧下一颗，面盖会被拽歪，上下两条缝就一宽一窄 —— '
          + '受力全压在窄的那边，碳纤维车把会被压出裂纹。'
          + '对角交叉、分两轮上到规定扭矩，面盖才是平的贴上去。',
      },
      async enter(c, engine) {
        for (const f of c.bom.groupOf('stem-face')) c.bolts.spawn(f);
        c.hud.setBoltRow(c.bom.groupOf('stem-face').map((f) => ({ id: f.id, name: f.name, state: 'pending' })));
        c.screw.beginGroup({
          group: 'stem-face',
          onEach: (id, { orderOk, nm }) => {
            c.state.fastened = { ...c.state.fastened, [id]: nm };
            if (!orderOk && c.state.crossOrderOk !== false) {
              c.state.crossOrderOk = false;
              c.hud.toast('这颗不是上一颗的对角 —— 缝隙会走偏');
            }
            c.hud.setBoltRow(c.bom.groupOf('stem-face').map((f) => ({
              id: f.id, name: f.name,
              state: c.state.fastened[f.id] ? 'tight' : 'pending',
            })));
          },
          onAll: () => {
            if (c.state.crossOrderOk === null) c.state.crossOrderOk = true;
            c.hud.toast(c.state.crossOrderOk ? '四颗都到位，缝隙是匀的' : '拧上了，但顺序走偏过');
            engine.done();
          },
        });
        c.hud.setAlts([{ label: '帮我拧上', ico: 'wrench', onClick: () => c.screw.autoRunGroup('stem-face') }]);
      },
      exit(c) { c.screw.cancel(); c.hud.setBoltRow(null); },
    },

    // ══════════════ 座管 ══════════════
    {
      id: 'D1', phase: 3,
      title: '座管插进立管',
      cam: { az: 55, el: 12, target: AIM_SEAT, fit: FIT_SEAT },
      cue: { ico: 'drag', text: '<em>顺着立管往下压</em>，插过最小插入线' },
      note: {
        title: '最小插入线',
        spec: [['插入深度', '不得浅于管上刻线'], ['装配膏', '碳纤维专用，不是黄油']],
        body: '座管上刻着一条线，那是「至少要插到这里」。'
          + '插浅了，立管口就成了一个杠杆支点 —— 骑起来的力全集中在那一圈，车架会从那儿裂开。'
          + '这条线不是建议。',
      },
      async enter(c, engine) {
        detach(c, 'seatpost');
        await installPart(c, 'seatpost', {
          hint: '顺着立管的方向压下去',
          onDone: () => engine.done(),
        });
      },
      exit(c) { c.slide.cancel(); },
    },

    // ══════════════ 脚踏 ══════════════
    {
      id: 'E1', phase: 4,
      title: '右脚踏：正牙',
      cam: { az: 20, el: 14, target: AIM_PEDAL_R, fit: FIT_PEDAL },
      cue: { ico: 'rotate', text: '<em>朝车头方向</em>拧 —— 右边是正牙' },
      note: {
        title: '两边都是「朝车头拧紧」',
        spec: [['牙向', '右脚踏 正牙'], ['工具', '15 mm 扳手'], torqueRow(ctx.bom.fastener('pedal-right-spindle'))],
        body: '记不住哪边是反牙没关系，记这一条就够：'
          + '**站在那一侧，把扳手朝车头方向压，就是拧紧。** 左右都成立。',
      },
      async enter(c, engine) {
        const f = c.bom.fastener('pedal-right-spindle');
        detach(c, 'pedal-right');
        c.hud.setTorqueGauge({ nm: 0, min: f.torque[0], max: f.torque[1], strip: f.strip });
        c.screw.begin({
          fastenerId: 'pedal-right-spindle',
          onProgress: (nm) => c.hud.setTorqueGauge({ nm, min: f.torque[0], max: f.torque[1], strip: f.strip }),
          onTight: (nm) => {
            c.state.fastened = { ...c.state.fastened, 'pedal-right-spindle': nm };
            c.state.installed = { ...c.state.installed, 'pedal-right': true };
            engine.done();
          },
        });
        c.hud.setAlts([{ label: '帮我拧上', ico: 'wrench', onClick: () => c.screw.autoRun('pedal-right-spindle') }]);
      },
      exit(c) { c.screw.cancel(); c.hud.setTorqueGauge(null); },
    },
    {
      id: 'E2', phase: 4,
      title: '左脚踏：反牙',
      cam: { az: 200, el: 14, target: AIM_PEDAL_L, fit: FIT_PEDAL },
      cue: { ico: 'rotate', text: '照样<em>朝车头方向</em>拧 —— 但这边的牙是反的' },
      note: {
        title: '为什么偏偏左边是反的',
        spec: [['牙向', '左脚踏 反牙（左旋）'], torqueRow(ctx.bom.fastener('pedal-left-spindle'))],
        body: '踩踏时脚踏轴在曲柄孔里滚，滚的方向恰好会把正牙越拧越松。'
          + '左边做成反牙，这个「越骑越松」就变成了「越骑越紧」。'
          + '拧反了会啃坏曲柄上的铝螺纹 —— 那是要换曲柄的。',
      },
      async enter(c, engine) {
        const f = c.bom.fastener('pedal-left-spindle');
        detach(c, 'pedal-left');
        c.hud.setTorqueGauge({ nm: 0, min: f.torque[0], max: f.torque[1], strip: f.strip });
        c.screw.begin({
          fastenerId: 'pedal-left-spindle',
          onProgress: (nm) => c.hud.setTorqueGauge({ nm, min: f.torque[0], max: f.torque[1], strip: f.strip }),
          onWrongWay: () => {
            c.state.wrongThread += 1;
            c.hud.toast('拧不动了 —— 左边是反牙，往另一边转才是紧');
            c.hud.setNote({
              title: '刚才那下就是滑丝的开始',
              body: '左脚踏顺时针是**松**。真车上硬拧两圈，曲柄孔里的铝螺纹就被钢轴啃掉了，'
                + '之后拧什么都咬不住。',
            });
          },
          onTight: (nm) => {
            c.state.fastened = { ...c.state.fastened, 'pedal-left-spindle': nm };
            c.state.installed = { ...c.state.installed, 'pedal-left': true };
            engine.done();
          },
        });
        c.hud.setAlts([{ label: '帮我拧上', ico: 'wrench', onClick: () => c.screw.autoRun('pedal-left-spindle') }]);
      },
      exit(c) { c.screw.cancel(); c.hud.setTorqueGauge(null); },
    },

    // ══════════════ 出门前 ══════════════
    {
      id: 'F1', phase: 5,
      title: '出门前自检',
      cam: { az: 38, el: 14, target: AIM_BIKE, fit: FIT_BIKE },
      cue: { ico: 'check', text: '拧过的每一颗，都在这儿' },
      enter(c) {
        const rows = c.bom.fasteners.map((f) => {
          const nm = c.state.fastened[f.id];
          const bad = c.state.stripped[f.id];
          return `<div class="chk ${bad ? 'bad' : nm ? 'ok' : 'miss'}">
            <span>${f.name}</span><i></i>
            <b>${bad ? '滑丝' : nm ? `${nm.toFixed(1)} N·m` : '没拧'}</b></div>`;
        }).join('');
        const notes = [];
        if (c.state.wrongThread > 0) notes.push(`左脚踏往反方向拧过 ${c.state.wrongThread} 次`);
        if (c.state.crossOrderOk === false) notes.push('面盖没按对角顺序');
        c.hud.dock({
          body: `<div class="checklist">${rows}</div>`
            + (notes.length ? `<p class="chk-note">${notes.join('；')}</p>` : ''),
        });
      },
      exit(c) { c.hud.closeOverlays(); },
    },
    {
      id: 'F2', phase: 5,
      title: '可以骑了',
      cam: { az: 90, el: 6, target: AIM_BIKE, fit: FIT_BIKE },
      cue: { ico: 'bike', text: '还剩最后一件事' },
      note: {
        title: '骑五十公里，回来复紧一遍',
        body: '新装的接合面会「坐实」一点点，几次受力之后螺栓的预紧力会掉。'
          + '第一次长距离之后把这几颗按同样的扭矩再过一遍 —— 之后就可以忘掉它们了。',
      },
      enter(c) { c.sfx.play('SUCCESS', { gain: 0.7 }); },
    },
  ].map((s) => ({ ...s, _junk: junk }));
}

/** 顶部章节名，按 phase 取 */
export const PHASES = ['开箱', '前轮', '车把', '座管', '脚踏', '出门前'];
