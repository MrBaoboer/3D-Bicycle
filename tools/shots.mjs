/**
 * README 与文档里的截图，从**构建产物**里实拍。
 *
 *   npm run build && node tools/shots.mjs
 *
 * 不是效果图，也不是开发服务器上顺手截的一张 —— 起 dist/、走到那一步、
 * 等镜头到位再按快门。README 上每一张图都能用这条命令原样复现，
 * 界面改了之后重跑一次就对得上，不会出现「文档里还是三版之前的样子」。
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
// README 顶上那一张：宽幅、不带界面，只有车。16:10 的整幅截图当页首太高，
// 一屏读不完就失去了「一眼看见」的意思
const HERO = { width: 1600, height: 780 };

/** 等镜头走到位 */
const settled = (page) => page.waitForFunction(() => {
  const s = window.__ctx.stage;
  return !window.__engine.busy && s.camera.position.distanceTo(s.recommend.pos) < 0.02;
}, null, { timeout: 40000 }).catch(() => {});

/**
 * 打开页面，读完模型，停在封面。
 * 1.5 倍像素密度：GitHub 上 README 的图按 880 px 宽显示，2160 px 的原图已经绰绰有余，
 * 而 2 倍出来的一张封面就有近两兆 —— 截图是要进版本库的。
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
 * 藏掉全部界面，把整幅画面还给车，再留一圈余白。
 *
 * 顶栏与底栏走应用自带的 `data-quiet` —— 它同时把这两条排除出安全区，
 * 于是 stage 会重新取景、用满整幅。改 dataset 不触发 ResizeObserver，补发一次 resize。
 * 标注圆点每帧都由 `updateSpots` 重写 `style.display`，藏不住，得整个摘掉。
 *
 * 取景是按「看得清」定的，贴边贴得紧。门面那张要的是橱窗，所以把距离再推远一档：
 * `dist` 是取景距离的下限，给足了它就盖过 fit 算出来的那个数。
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
   *
   * 早先这里截的是封面 —— 读模型那几秒的挡板，车在毛玻璃后面糊成一团。
   * 那是「还没开始」的样子，放在 README 第一屏等于先给人看一张失焦的图。
   *
   * 摊开态试过，宽幅里不成立：那二十七件的位移是按 16:10 算的，
   * 铺到 20:9 上就散了 —— 中间挤成一团，右边孤零零飘着一件。
   * 整车是一个整体，横过来只是四周余白更宽，正好是橱窗要的样子。
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
   * ── 03 四颗面盖螺丝：一对对角已经拧上，第三颗正拧到一半 ──
   *
   * 不能靠「跑起来再等几秒」撞这一帧 —— 自动拧一颗只要一秒出头，
   * 而截图本身就要一百毫秒。所以头两颗照常自动拧完，
   * 第三颗直接转到旋合行程的六成、停在那儿：拍出来的是算准的，不是撞上的。
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
