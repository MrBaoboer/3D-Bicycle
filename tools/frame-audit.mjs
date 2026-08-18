/**
 * 取景对账，逐步量两把尺子：画面 = 全部非背景像素的外接框（渲染结果，不是几何
 * 意图）；主体 = 这一步声明的 installs / fastens 按进场那一刻投影，偏心以可用
 * 画面的半宽 / 半高为 1。只量画面抓不出主体跑偏 —— 主体偏出一个 gap 时，
 * 整幅非背景外接框几乎不动。画面必须在同一个任务里先 render 再取样：没开
 * preserveDrawingBuffer 时缓冲合成后即清，读回来全黑。主体走投影不走像素：
 * 主体常与车身同色同质（黑油管贴黑碳纤维），逐像素分不出哪一块是它。
 *
 *   npm run build && node tools/frame-audit.mjs [画幅宽 画幅高]
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

    /*
     * 主体此刻投在屏幕上的外接框。件量包围盒八个角而不是形心：横贯 78 cm 的
     * 车把形心在中间，画面上却占掉大半幅。紧固件量它自己那个点。
     * 必须在 e.go() 之后量 —— 件停在预备位，那才是用户第一眼看见的位置。
     */
    const subject = (step) => {
      const cam = c.stage.camera;
      cam.updateMatrixWorld(true);
      const V = cam.position.constructor;
      const xs = [], ys = [];
      const add = (p) => {
        const v = p.clone().project(cam);
        xs.push((v.x * 0.5 + 0.5) * innerWidth);
        ys.push((0.5 - v.y * 0.5) * innerHeight);
      };
      for (const id of step.installs ?? []) {
        for (const n of c.bom.nodesOf(id)) {
          const b = c.bike.boundsOf(n);
          if (b.isEmpty()) continue;
          for (const x of [b.min.x, b.max.x]) {
            for (const y of [b.min.y, b.max.y]) {
              for (const z of [b.min.z, b.max.z]) add(new V(x, y, z));
            }
          }
        }
      }
      for (const id of step.fastens ?? []) add(new V(...c.bom.fastener(id).point));
      if (!xs.length) return null;
      return {
        x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys),
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
        whole: !!e.steps[i].showAll, box: measure(), star: subject(e.steps[i]),
        safe: { ...c.hud._safe }, vw: innerWidth, vh: innerHeight,
      });
    }
    return out;
  });

  /*
   * 主体偏心上限。0.30 不是好看的标准，是跑偏的报警线：默认取景把主体摆正中
   *（实际落在 0.1 以内），构图要偏的步骤明写 off（见 steps/util.js），
   * 明写的偏移也不该越过这条线。
   */
  const STAR_MAX = 0.30;

  console.log(`\n取景对账 · 画幅 ${W}×${H}\n`);
  console.log('  步骤            竖占  横占  覆盖   偏心 x,y      主体 x,y      备注');
  console.log('  ' + '─'.repeat(76));
  let cut = 0;
  let stray = 0;
  for (const r of rows) {
    if (!r.box) { console.log(`  ${r.id.padEnd(4)} 画面全空`); continue; }
    const { box: b, safe: s } = r;
    const freeH = r.vh - s.top - s.bottom;
    const freeW = r.vw - (s.right || 0) - (s.left || 0);
    const cx = (r.vw - (s.right || 0) + (s.left || 0)) / 2;
    const cy = (s.top + r.vh - s.bottom) / 2;
    const fillV = (b.y1 - b.y0) / freeH;
    const fillH = (b.x1 - b.x0) / freeW;
    const offX = ((b.x0 + b.x1) / 2 - cx) / freeW;
    const offY = ((b.y0 + b.y1) / 2 - cy) / freeH;
    // 整车那几张是成品照，必须完整落在画幅内；近景漫出画幅是正常的
    const edge = b.x0 < 2 || b.y0 < 2 || b.x1 > r.vw - 2 || b.y1 > r.vh - 2;
    let note = r.whole ? (edge ? '整车照贴边了' : '整车照 ✓') : '';
    if (r.whole && edge) cut += 1;

    // 主体：以可用画面的半宽 / 半高为 1，所以除的是 freeW/2 而不是 freeW
    let star = '   —— ';
    if (r.star) {
      const sx = ((r.star.x0 + r.star.x1) / 2 - cx) / (freeW / 2);
      const sy = ((r.star.y0 + r.star.y1) / 2 - cy) / (freeH / 2);
      star = `${(sx >= 0 ? '+' : '') + sx.toFixed(2)},${(sy >= 0 ? '+' : '') + sy.toFixed(2)}`;
      if (Math.hypot(sx, sy) > STAR_MAX) { stray += 1; note = `主体偏出 ${Math.hypot(sx, sy).toFixed(2)}`; }
    }
    console.log(
      `  ${r.id.padEnd(4)} ${String(r.title).padEnd(9)} ${fillV.toFixed(2)}  ${fillH.toFixed(2)}  `
      + `${String(Math.round(b.fill * 100)).padStart(3)}%  ${(offX >= 0 ? '+' : '') + offX.toFixed(2)},`
      + `${(offY >= 0 ? '+' : '') + offY.toFixed(2)}   ${star.padEnd(12)}  ${note}`);
  }
  console.log(`\n  ${errors.length ? `控制台报错 ${errors.length} 条：${[...new Set(errors)][0]}` : '控制台干净'}`);
  console.log(cut ? `  整车照有 ${cut} 张贴边` : '  整车照都完整');
  console.log(stray ? `  有 ${stray} 步的主体偏出舞台中央超过 ${STAR_MAX}\n`
    : `  每一步的主体都在舞台中央 ${STAR_MAX} 之内\n`);
  process.exitCode = cut || stray || errors.length ? 1 : 0;
} finally {
  await browser.close();
  server.close();
}
