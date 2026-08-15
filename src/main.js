/*
 * 开箱装车 · 3D 分步交互说明书
 * Copyright © 2026 MrBaoboer
 *
 * 代码许可见 LICENSE；整车模型是第三方素材，另行署名与授权，见 assets/CREDITS.md。
 *
 * 这里是唯一的组装处：new 出每一层，塞进一个共享的 ctx，再把步骤表交给引擎。
 * 步骤脚本不 import 任何单例，需要什么都从 ctx 里拿 —— 换一套渲染或界面时，
 * 改的是这一个文件，不是十三个步骤。
 */

import './styles.css';
import './ui/styles/tokens.css';
import './ui/styles/base.css';
import './ui/styles/chrome.css';
import './ui/styles/surfaces.css';
import './ui/styles/controls.css';

import * as THREE from 'three';

import { Stage, detectTier } from './render/stage.js';
import { Bike } from './render/bike.js';
import { Fx } from './render/fx.js';
import { Bolts } from './render/bolt.js';
import { BOM } from './core/bom.js';
import { state, resetRun } from './core/state.js';
import { HUD } from './ui/hud.js';
import { Arrows } from './ui/guides.js';
import { SFX, unlockAudio } from './audio/sfx.js';
import { Slide } from './interact/slide.js';
import { Screw } from './interact/screw.js';
import { Engine } from './app/engine.js';
import { tick as tickTweens } from './util/tween.js';
import { acts } from './steps/acts.js';

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

  progress(0.08, '正在拆包装');
  await frame();

  const bike = new Bike(stage.scene);
  await bike.load((p) => progress(0.08 + p * 0.7, '正在把车搬进来'));

  progress(0.82, '正在清点随车件');
  await frame();

  const hud = new HUD(state);
  const fx = new Fx(stage.scene, tier);
  const guides = new Arrows(stage.scene);
  const bolts = new Bolts(stage.scene);

  /** 全片共享上下文，键表见 docs/CONTRACT.md */
  const ctx = { stage, bike, bom: BOM, bolts, hud, sfx: SFX, fx, guides, state, tier };
  ctx.slide = new Slide(ctx);
  ctx.screw = new Screw(ctx);

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
  engine.setSteps(acts(ctx));

  // 界面占掉的上下两条边交给三维 —— 车据此让位与退远
  hud.onSafeArea = (safe) => stage.setSafeArea(safe);
  hud.onSound = (v) => SFX.setEnabled(v);
  hud.onTheme = (v) => stage.setTheme(v);
  hud.onRestart = async () => {
    resetRun();
    bolts.clear();
    await engine.go(0);
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
  coverAct.hidden = false;
  coverAct.innerHTML = `
    <button class="btn btn-primary" id="cv-go">开始装车</button>
    <div class="cover-alt"><button class="btn btn-text" id="cv-help">怎么操作</button></div>`;
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
    <p class="cover-msg">这一页需要 WebGL 2。刷新一次通常就好；反复失败的话，
      换 Chrome / Edge 111 以上、Safari 16.4 以上或 Firefox 113 以上再试。</p>`;
  coverAct.querySelector('#cv-retry').addEventListener('click', () => location.reload());
});

export { THREE };
