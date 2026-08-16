/*
 * 开箱装车 · 3D 分步交互说明书
 * Copyright © 2026 MrBaoboer
 *
 * 代码许可见 LICENSE；整车模型是第三方素材，另行署名与授权，见 assets/CREDITS.md。
 */

import './styles.css';
import * as THREE from 'three';

import { Stage, detectTier } from './render/stage.js';
import { Bike } from './render/bike.js';

const cover = document.getElementById('cover');
const coverBar = document.getElementById('cover-bar');
const coverMsg = document.getElementById('cover-msg');
const coverAct = document.getElementById('cover-act');

const progress = (p, msg) => {
  coverBar.style.width = `${Math.round(p * 100)}%`;
  if (msg) coverMsg.textContent = msg;
};
const frame = () => new Promise((r) => setTimeout(r, 16));

async function main() {
  const tier = detectTier();
  const stage = new Stage(document.getElementById('stage'), tier);
  stage.setTheme(matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

  /*
   * WebGL 上下文可能被系统回收（移动端切后台常见）—— 不处理就是永久黑屏。
   * preventDefault() 之后浏览器会尝试恢复，three 会把资源按需重传。
   */
  stage.canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    stage.stop();
    cover.hidden = false;
    cover.classList.remove('gone');
    coverMsg.classList.add('bad');
    coverMsg.textContent = '浏览器回收了图形资源，正在找回画面';
  });
  stage.canvas.addEventListener('webglcontextrestored', () => {
    stage.resize();
    stage.start();
    coverMsg.classList.remove('bad');
    cover.classList.add('gone');
  });

  progress(0.1, '正在拆包装');
  await frame();

  const bike = new Bike(stage.scene);
  await bike.load((p) => progress(0.1 + p * 0.75, '正在把车搬进来'));

  progress(0.9, '正在架好');
  await frame();

  // 取景：整车包围盒换算成一个包围球，交给 fit 决定该退多远。
  // 这一步之后所有机位都声明 fit，窄画幅上自己后退 —— 别在这里写死距离。
  const r = Math.max(bike.size.x, bike.size.z) / 2;
  const h = bike.size.y / 2;
  stage.setRecommended({
    az: 38, el: 14,
    target: new THREE.Vector3(bike.center.x, bike.center.y, bike.center.z),
    fit: { r, h },
  });
  stage.snapToRecommended();

  // 着色器提前编译。不编，全部 program 会挤在封面化开那一刻的第一帧里。
  try {
    await stage.renderer.compileAsync(stage.scene, stage.camera);
  } catch (e) {
    console.warn('[precompile]', e);
  }

  stage.start();

  // 冒烟测试与开发期探针要读这些
  window.__stage = stage;
  window.__bike = bike;
  console.info('[bike]', bike.stats, '包围盒', bike.size.toArray().map((v) => v.toFixed(3)).join(' × '));

  progress(1);
  cover.dataset.ready = '1';
  coverMsg.hidden = true;
  coverAct.hidden = false;
  coverAct.innerHTML = '<button class="btn btn-primary" id="cv-go">开始装车</button>';
  coverAct.querySelector('#cv-go').addEventListener('click', () => {
    cover.classList.add('gone');
    setTimeout(() => { cover.hidden = true; }, 1000);
  });
}

main().catch((e) => {
  console.error(e);
  coverMsg.hidden = false;
  coverMsg.textContent = '三维画面没能启动';
  coverMsg.classList.add('bad');
  coverAct.hidden = false;
  coverAct.innerHTML = `
    <button class="btn btn-primary" id="cv-retry">重新加载</button>
    <p class="cover-msg">这一页需要 WebGL 2。刷新一次通常就好。</p>`;
  coverAct.querySelector('#cv-retry').addEventListener('click', () => location.reload());
});
