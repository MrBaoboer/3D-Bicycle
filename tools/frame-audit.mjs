/**
 * 取景对账：逐步量「画面上真正看得见的那一块」。
 *
 *   npm run build && node tools/frame-audit.mjs [画幅宽 画幅高]
 *
 * 冒烟走查回答的是「有没有崩、有没有裁边」，这一条回答的是「好不好看」：
 * 主体占了可用画面的几成、偏心多少、有没有出画幅。
 * 改了 steps/util.js 的取景常量（PAD / MIN_SPAN / CTX_BIAS）或某一步的机位之后，
 * 拿它前后对一遍 —— 只看截图会漏掉「小了一成」这种量级的退化。
 *
 * 量的是渲染结果，不是几何意图：把画布缩样读回来，找非背景像素的外接框。
 * **必须在同一个任务里先 render 再取样** —— 画布没开 preserveDrawingBuffer，
 * 合成之后那块缓冲就归零了，读回来永远是全黑。
 */

import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { serve } from './serve.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const W = +(process.argv[2] || 1440);
const H = +(process.argv[3] || 900);

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('dist/ 里没有 index.html —— 先跑 npm run build');
  process.exit(1);
}

const { server, port } = await serve(DIST);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

try {
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#cover[data-ready="1"]', { timeout: 180000 });
  await page.click('#cv-go');
  await page.waitForTimeout(1500);
  const guide = await page.$('.sheet .btn-primary');
  if (guide) { await guide.click(); await page.waitForTimeout(500); }

  const rows = await page.evaluate(async () => {
    const c = window.__ctx, e = window.__engine;
    const N = 180;
    const measure = () => {
      const s = c.stage;
      s.renderer.render(s.scene, s.camera);              // 同一个任务里先渲染再取样
      const h = Math.max(1, Math.round((N * innerHeight) / innerWidth));
      const cv = document.createElement('canvas');
      cv.width = N; cv.height = h;
      const x = cv.getContext('2d', { willReadFrequently: true });
      x.drawImage(s.canvas, 0, 0, N, h);
      const d = x.getImageData(0, 0, N, h).data;
      const bg = [d[0], d[1], d[2]];                     // 左上角一定是背景
      let x0 = N, y0 = h, x1 = -1, y1 = -1, on = 0;
      for (let p = 0; p < N * h; p++) {
        const i = p * 4;
        if (Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) < 14) continue;
        on += 1;
        const px = p % N, py = (p / N) | 0;
        if (px < x0) x0 = px; if (px > x1) x1 = px;
        if (py < y0) y0 = py; if (py > y1) y1 = py;
      }
      if (x1 < 0) return null;
      return {
        x0: (x0 / N) * innerWidth, x1: ((x1 + 1) / N) * innerWidth,
        y0: (y0 / h) * innerHeight, y1: ((y1 + 1) / h) * innerHeight,
        fill: on / (N * h),
      };
    };

    const out = [];
    for (let i = 0; i < e.steps.length; i++) {
      await e.go(i);
      for (let k = 0; k < 200; k++) {
        if (!e.busy && c.stage.camera.position.distanceTo(c.stage.recommend.pos) < 0.02) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      await new Promise((r) => setTimeout(r, 200));
      out.push({
        id: e.steps[i].id, title: e.steps[i].title,
        whole: !!e.steps[i].showAll, box: measure(), safe: { ...c.hud._safe },
        vw: innerWidth, vh: innerHeight,
      });
    }
    return out;
  });

  console.log(`\n取景对账 · 画幅 ${W}×${H}\n`);
  console.log('  步骤            竖占  横占  覆盖   偏心 x,y      备注');
  console.log('  ' + '─'.repeat(62));
  let cut = 0;
  for (const r of rows) {
    if (!r.box) { console.log(`  ${r.id.padEnd(4)} 画面全空`); continue; }
    const { box: b, safe: s } = r;
    const freeH = r.vh - s.top - s.bottom;
    const freeW = r.vw - (s.right || 0) - (s.left || 0);
    const fillV = (b.y1 - b.y0) / freeH;
    const fillH = (b.x1 - b.x0) / freeW;
    const offX = ((b.x0 + b.x1) / 2 - (r.vw - (s.right || 0) + (s.left || 0)) / 2) / freeW;
    const offY = ((b.y0 + b.y1) / 2 - (s.top + r.vh - s.bottom) / 2) / freeH;
    // 整车那几张是成品照，必须完整落在画幅内；近景漫出画幅是正常的
    const edge = b.x0 < 2 || b.y0 < 2 || b.x1 > r.vw - 2 || b.y1 > r.vh - 2;
    const note = r.whole ? (edge ? '整车照贴边了' : '整车照 ✓') : '';
    if (r.whole && edge) cut += 1;
    console.log(
      `  ${r.id.padEnd(4)} ${String(r.title).padEnd(9)} ${fillV.toFixed(2)}  ${fillH.toFixed(2)}  `
      + `${String(Math.round(b.fill * 100)).padStart(3)}%  ${(offX >= 0 ? '+' : '') + offX.toFixed(2)},`
      + `${(offY >= 0 ? '+' : '') + offY.toFixed(2)}   ${note}`);
  }
  console.log(`\n  ${errors.length ? `控制台报错 ${errors.length} 条：${[...new Set(errors)][0]}` : '控制台干净'}`);
  console.log(cut ? `  整车照有 ${cut} 张贴边\n` : '  整车照都完整\n');
  process.exitCode = cut || errors.length ? 1 : 0;
} finally {
  await browser.close();
  server.close();
}
