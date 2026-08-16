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

const shot = (page, name) => page.screenshot({ path: join(OUT, `${name}.png`) });

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('dist/ 里没有 index.html —— 先跑 npm run build');
  process.exit(1);
}
await mkdir(OUT, { recursive: true });
const { server, port } = await serve(DIST);
const browser = await chromium.launch();

try {
  // ── 01 封面：读完模型、车摆进右半边的那一刻 ──
  let page = await open(browser, DESK, port);
  await shot(page, '01-cover');
  await enter(page);

  // ── 02 拆开看看：二十七个大件各自停在它该来的那一侧 ──
  await at(page, 'A2');
  await shot(page, '02-exploded');

  // ── 03 主转点轴：近景带着周围的车架，看得出这是车上的哪儿 ──
  await at(page, 'B1', { finish: false });
  await shot(page, '03-pivot');

  /*
   * 04 四颗面盖螺丝：两颗到位、第三颗正好走进绿区的那一刻。
   *
   * 不能靠「跑起来再等几秒」撞这一帧 —— 扭矩落在绿区只有一两百毫秒，
   * 而截图本身就要一百毫秒，十次有九次拍到的是两次拧紧之间那个 0.0。
   * 所以头两颗照常自动拧完，第三颗直接按扭矩曲线反解出角度、一次转到位：
   * nm = strip · load^2.6，load = (progress − 旋到底的角度) / 加载行程。
   * 拍出来的这一帧是算准的，不是撞上的。
   */
  await at(page, 'D2', { finish: false });
  await page.evaluate(async () => {
    const c = window.__ctx;
    await c.screw.autoRun('stem-face-a');
    await c.screw.autoRun('stem-face-b');
    const f = c.bom.fastener('stem-face-c');
    const TAU = Math.PI * 2;
    const load = Math.pow(5.4 / f.strip, 1 / 2.6);      // 目标区间 5–6 N·m，取 5.4
    c.screw._use('stem-face-c');
    c.screw._turn(f.turns * TAU + 1.25 * TAU * load);
  });
  await page.waitForTimeout(700);
  await shot(page, '04-cross-tighten');

  // ── 05 出门前自检：三十四行逐条对账 ──
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

  // ── 06 深色：左脚踏反牙那一步 ──
  page = await open(browser, DESK, port, 'dark');
  await enter(page);
  await at(page, 'H3');
  await shot(page, '06-dark');
  await page.close();

  // ── 07 手机竖屏：界面退到四周，中间整片留给车 ──
  page = await open(browser, PHONE, port);
  await enter(page);
  await at(page, 'F2', { finish: false });
  await shot(page, '07-mobile');
  await page.close();

  console.log(`截好了 → ${OUT}`);
} finally {
  await browser.close();
  server.close();
}
