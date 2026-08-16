/*
 * 从零装一台山地车 · 3D 分步交互说明书
 * Copyright © 2026 MrBaoboer
 *
 * 代码 AGPL-3.0（见 LICENSE）；课程与文案 CC BY-NC-SA 4.0；
 * 整车模型是第三方素材，CC BY-SA 4.0，另行署名，见 assets/CREDITS.md。三层的界线见 COMMERCIAL.md。
 *
 * 这里是唯一的组装处：new 出每一层，塞进一个共享的 ctx，再把步骤表交给引擎。
 * 步骤脚本不 import 任何单例，需要什么都从 ctx 里拿 —— 换一套渲染或界面时，
 * 改的是这一个文件，不是二十九个步骤。
 */

// 令牌在最前：后面四份都只引用语义名，不写颜色
import './ui/styles/tokens.css';
import './ui/styles/base.css';
import './styles.css';
import './ui/styles/chrome.css';
import './ui/styles/surfaces.css';

import * as THREE from 'three';

import { Stage, detectTier } from './render/stage.js';
import { Bike } from './render/bike.js';
import { Fx } from './render/fx.js';
import { Bolts } from './render/bolt.js';
import { Bom } from './core/bom.js';
import manifest from '../assets/bike.manifest.json';
import { state, resetRun } from './core/state.js';
import { HUD } from './ui/hud.js';
import { Arrows } from './ui/guides.js';
import { SFX, unlockAudio } from './audio/sfx.js';
import { Slide } from './interact/slide.js';
import { Screw } from './interact/screw.js';
import { Engine } from './app/engine.js';
import { Build } from './app/build.js';
import { tick as tickTweens } from './util/tween.js';
import { acts, PHASES } from './steps/acts.js';

const cover = document.getElementById('cover');
const coverBar = document.getElementById('cover-bar');
const coverMsg = document.getElementById('cover-msg');
const coverAct = document.getElementById('cover-act');

const progress = (p, msg) => {
  coverBar.style.width = `${Math.round(p * 100)}%`;
  if (msg) coverMsg.textContent = msg;
};
const frame = () => new Promise((r) => setTimeout(r, 16));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 全片共用的那一份清单。读进来的地方只有这一处，其余一律从 ctx.bom 取 */
const BOM = new Bom(manifest);

async function main() {
  const tier = detectTier();
  const stage = new Stage(document.getElementById('stage'), tier);
  stage.setTheme(state.theme);

  /*
   * WebGL 上下文可能被系统回收（移动端切后台常见）—— 不处理就是永久黑屏。
   * preventDefault() 之后浏览器会尝试恢复，three 会把资源按需重传。
   */
  stage.canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    stage.stop();
    cover.hidden = false;
    cover.classList.remove('gone');
    coverMsg.hidden = false;
    coverMsg.classList.add('bad');
    coverMsg.textContent = '浏览器回收了图形资源，正在找回画面';
  });
  stage.canvas.addEventListener('webglcontextrestored', () => {
    stage.resize();
    stage.start();
    coverMsg.classList.remove('bad');
    cover.classList.add('gone');
    setTimeout(() => { cover.hidden = true; }, 1000);
  });

  // 加载期只报两件事：车还在读（占掉九成时间，进度条说得清）、正在架好。
  // 中间再插几句「正在拆包装」「正在清点随车件」只是花字，读的人一句也来不及看
  await frame();
  const bike = new Bike(stage.scene);
  await bike.load((p) => progress(p * 0.85, '正在把车搬进来'));

  const hud = new HUD(state);
  const fx = new Fx(stage.scene, tier);
  const guides = new Arrows(stage.scene);
  const bolts = new Bolts(stage.scene, BOM);

  /** 全片共享上下文，键表见 docs/CONTRACT.md */
  const ctx = { stage, bike, bom: BOM, bolts, hud, sfx: SFX, fx, guides, state, tier };
  ctx.slide = new Slide(ctx);
  ctx.screw = new Screw(ctx);
  // 「此刻车上该有哪些件」由它按步骤计划现推 —— 从零开始装靠这一层
  ctx.build = new Build(ctx);

  progress(0.9, '正在架好');
  await frame();

  // 着色器提前编译。不编，全部 program 会挤在封面化开那一刻的第一帧里 ——
  // 恰好是整段体验最需要顺的那一下。
  try {
    await stage.renderer.compileAsync(stage.scene, stage.camera);
  } catch (e) {
    console.warn('[precompile]', e);
  }

  const engine = new Engine(ctx);
  engine.setSteps(acts(ctx), PHASES);

  // 界面占掉的上下两条边交给三维 —— 车据此让位与退远
  hud.onSafeArea = (safe) => stage.setSafeArea(safe);
  hud.onSound = (v) => SFX.setEnabled(v);
  hud.onTheme = (v) => stage.setTheme(v);
  hud.onRestart = async () => {
    resetRun();
    bolts.clear();
    await engine.restart();
  };

  // 切到别的标签页时把声音停住。画面走 rAF 本来就停了
  addEventListener('visibilitychange', () => {
    if (document.hidden) SFX.suspendLoops(); else SFX.resumeLoops();
  });

  // ── 主循环 ──
  stage.updaters.add((dt) => {
    tickTweens(dt);
    fx.update(dt);
    guides.update(dt);
    hud.updateSpots(stage.camera);
  });
  stage.start();

  window.__ctx = ctx;
  window.__engine = engine;
  unlockAudio();

  progress(1);
  await sleep(160);
  cover.dataset.ready = '1';
  coverMsg.hidden = true;
  // 读完了，进度条就没有可说的了 —— 留着一条满格的橙线只会跟主按钮抢注意力
  cover.querySelector('.cover-bar').hidden = true;
  coverAct.hidden = false;
  coverAct.innerHTML = `
    <button class="btn btn-primary" id="cv-go">开始装车</button>
    <button class="btn btn-text" id="cv-help">先看怎么操作</button>`;
  coverAct.querySelector('#cv-go').focus();

  const enter = async () => {
    coverAct.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    cover.classList.add('gone');
    setTimeout(() => { cover.hidden = true; }, 1000);
    hud.showChrome(true);
    if (!state.primed) {
      state.primed = true;
      await sleep(420);
      await new Promise((done) => hud.guide({ label: '开始吧', onClose: done }));
    }
    await engine.go(0);
  };
  coverAct.querySelector('#cv-go').addEventListener('click', enter);
  coverAct.querySelector('#cv-help').addEventListener('click', () => hud.guide({ full: true }));
}

main().catch((e) => {
  console.error(e);
  coverMsg.hidden = false;
  coverMsg.textContent = '三维画面没能启动';
  coverMsg.classList.add('bad');
  coverAct.hidden = false;
  coverAct.innerHTML = `
    <button class="btn btn-primary" id="cv-retry">重新加载</button>
    <p class="cover-why">这一页要用 WebGL 2 画三维。刷新一次多半就好；
      还是不行的话，换 Chrome / Edge 111 以上、Safari 16.4 以上、Firefox 113 以上，
      并确认浏览器设置里没有关掉硬件加速。</p>`;
  coverAct.querySelector('#cv-retry').addEventListener('click', () => location.reload());
});

export { THREE };
