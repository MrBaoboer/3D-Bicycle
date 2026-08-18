/**
 * README 与文档的截图，从构建产物实拍：起 dist/、走到那一步、等镜头到位再截。
 * 每一张都能用这条命令原样复现，界面改动后重跑一次即与文档对齐。
 *
 *   npm run build && node tools/shots.mjs
 */

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { serve } from './serve.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const OUT = join(ROOT, 'docs', 'shots');

const DESK = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
// README 页首那张：宽幅、不带界面。16:10 整幅当页首太高，一屏读不完
const HERO = { width: 1600, height: 780 };

/** 等镜头走到位 */
const settled = (page) => page.waitForFunction(() => {
  const s = window.__ctx.stage;
  return !window.__engine.busy && s.camera.position.distanceTo(s.recommend.pos) < 0.02;
}, null, { timeout: 40000 }).catch(() => {});

/**
 * 打开页面，读完模型，停在封面。
 * 1.5 倍像素密度：README 的图按 880 px 宽显示，2160 px 原图足够；
 * 2 倍单张近两兆，而截图要进版本库。
 */
async function open(browser, viewport, port, theme = 'light') {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1.5 });
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#cover[data-ready="1"]', { timeout: 180000 });
  if (theme !== 'light') {
    await page.evaluate((t) => window.__ctx.hud.setTheme(t), theme);
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(600);
  return page;
}

/** 掀掉封面，收掉首次进入的那张「怎么操作」 */
async function enter(page) {
  await page.click('#cv-go');
  await page.waitForTimeout(1600);
  const guide = await page.$('.sheet .btn-primary');
  if (guide) { await guide.click(); await page.waitForTimeout(600); }
}

/** 走到某一步，把这一步的活演完 */
async function at(page, id, { finish = true } = {}) {
  await page.evaluate((s) => window.__engine.goToStep(s), id);
  await settled(page);
  if (finish) {
    await page.evaluate(async () => {
      const e = window.__engine;
      for (let k = 0; k < 10 && e.pending; k++) {
        await e.finishPending();
        await new Promise((r) => setTimeout(r, 80));
      }
    });
  }
  await page.waitForTimeout(900);
}

/**
 * 藏掉全部界面，把画面还给车，再留一圈余白。顶栏底栏走 `data-quiet`（同时把
 * 两条排除出安全区，stage 重新取景用满整幅）；改 dataset 不触发 ResizeObserver，
 * 要补发一次 resize。标注圆点每帧被 `updateSpots` 重写 `style.display`，藏不住，
 * 只能整个摘掉。`dist` 是取景距离的下限，乘上 pad 后盖过 fit 算出的值，画面推远一档。
 */
async function bare(page, pad = 1.18) {
  await page.evaluate((k) => {
    const c = window.__ctx, hud = document.querySelector('.hud');
    c.hud.clearSpots();
    hud.querySelector('.topbar').dataset.quiet = '1';
    hud.querySelector('.foot').dataset.quiet = '1';
    for (const el of hud.querySelectorAll('.nav, .side, .tag')) el.style.display = 'none';
    dispatchEvent(new Event('resize'));
    const s = c.stage;
    s.setRecommended({ ...s._lastFrame, dist: s.recommend.dist * k }, { keepUser: true });
    s.snapToRecommended();
  }, pad);
  await settled(page);
  await page.waitForTimeout(600);
}

const shot = (page, name) => page.screenshot({ path: join(OUT, `${name}.png`) });

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('dist/ 里没有 index.html —— 先跑 npm run build');
  process.exit(1);
}
await mkdir(OUT, { recursive: true });
const { server, port } = await serve(DIST);
const browser = await chromium.launch();

try {
  /*
   * ── 01 门面：装完的整车，宽幅，不带界面 ──
   * 不用封面：那是读模型时的挡板，车在毛玻璃后面糊成一团。
   * 不用摊开态：位移按 16:10 算，铺到 20:9 会中间挤成一团、右边孤零零一件；
   * 整车横过来只是余白更宽，正合橱窗的用途。
   */
  let page = await open(browser, HERO, port);
  await enter(page);
  await at(page, 'A1');
  await bare(page);
  await shot(page, '01-hero');
  await page.close();

  // ── 02 拆开看看：二十七个大件各自停在它该来的那一侧 ──
  page = await open(browser, DESK, port);
  await enter(page);
  await at(page, 'A2');
  await shot(page, '02-exploded');

  /*
   * ── 03 四颗面盖螺丝：一对对角已拧上，第三颗拧到一半 ──
   * 不能靠等时机撞这一帧：自动拧一颗只要一秒出头，截图本身就要一百毫秒。
   * 头两颗自动拧完，第三颗直接转到旋合行程的六成停住。
   */
  await at(page, 'D2', { finish: false });
  await page.evaluate(async () => {
    const c = window.__ctx;
    await c.screw.autoRun('stem-face-a');
    await c.screw.autoRun('stem-face-b');
    const f = c.bom.fastener('stem-face-c');
    c.screw._use('stem-face-c');
    c.screw._turn(f.turns * Math.PI * 2 * 0.6);
  });
  await page.waitForTimeout(700);
  await shot(page, '03-cross-tighten');

  // ── 05 出门前自检：三十四行逐条对账。要先把全程走完，所以留在这一页最后 ──
  await page.evaluate(async () => {
    const c = window.__ctx, e = window.__engine;
    await c.hud.onRestart();
    await new Promise((r) => setTimeout(r, 400));
    for (let i = 0; i < e.steps.length; i++) {
      await e.go(i);
      await new Promise((r) => setTimeout(r, 60));
      for (let k = 0; k < 10 && e.pending; k++) {
        await e.finishPending();
        await new Promise((r) => setTimeout(r, 30));
      }
    }
  });
  await at(page, 'H4');
  await shot(page, '05-tally');
  await page.close();

  // ── 04 深色：左脚踏反牙那一步。一张图同时说清签名交互与深色主题 ──
  page = await open(browser, DESK, port, 'dark');
  await enter(page);
  await at(page, 'H3');
  await shot(page, '04-dark');
  await page.close();

  // ── 06 手机竖屏：界面退到四周，中间整片留给车 ──
  page = await open(browser, PHONE, port);
  await enter(page);
  await at(page, 'F2', { finish: false });
  await shot(page, '06-mobile');
  await page.close();

  console.log(`截好了 → ${OUT}`);
} finally {
  await browser.close();
  server.close();
}
