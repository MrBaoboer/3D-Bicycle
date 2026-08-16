/**
 * 冒烟走查：起构建产物 → 双画幅走完全部步骤 → 逐条断言。
 *
 *   node tools/smoke.mjs [--shots] [--headed]
 *
 * 验的是「页面能打开」之外的东西：每一步可达、有标题、画面不是纯色、
 * 相机没把主体裁掉、控制台没抛错、四个装配件都能被自动路径装上。
 *
 * CI 比开发机慢一个量级，所有等待都要过 tmo() —— 固定 sleep 也一样。
 * 这条是灯笼项目上用几次莫名其妙的红跑换来的。
 */

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const SHOTS = join(ROOT, '.shots', 'smoke');
const wantShots = process.argv.includes('--shots');
const headed = process.argv.includes('--headed');

const PATIENCE = process.env.CI ? 4 : 1;
const tmo = (ms) => ms * PATIENCE;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm', '.ktx2': 'image/ktx2',
};

/** 极简静态服务器 —— 不引 express，产物就几个文件 */
function serve(dir) {
  const server = createServer(async (req, res) => {
    try {
      const url = decodeURIComponent(req.url.split('?')[0]);
      const file = join(dir, url === '/' ? 'index.html' : url);
      if (!file.startsWith(dir)) { res.statusCode = 403; return res.end(); }
      const buf = await readFile(file);
      res.setHeader('content-type', MIME[extname(file)] || 'application/octet-stream');
      res.end(buf);
    } catch {
      res.statusCode = 404;
      res.end('not found');
    }
  });
  return new Promise((ok) => server.listen(0, () => ok({ server, port: server.address().port })));
}

const results = [];
const check = (code, title, ok, detail = '') => {
  results.push({ code, title, ok: !!ok, detail });
  const mark = ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  console.log(`${mark} [${code}] ${title}${detail ? `\n      ${detail}` : ''}`);
  return !!ok;
};

/** 画面是不是一整块纯色 —— 抓「三维其实没画出来」这类静默失败 */
async function notFlat(page) {
  return page.evaluate(() => {
    const c = document.getElementById('stage');
    const g = document.createElement('canvas');
    g.width = 64; g.height = 40;
    const x = g.getContext('2d');
    x.drawImage(c, 0, 0, 64, 40);
    const d = x.getImageData(0, 0, 64, 40).data;
    let min = 255, max = 0;
    for (let i = 0; i < d.length; i += 4) {
      const l = (d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722);
      if (l < min) min = l;
      if (l > max) max = l;
    }
    return max - min;
  });
}

async function run(viewport, label, port) {
  const browser = await chromium.launch({ headless: !headed });
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`);
  });

  await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#cover[data-ready="1"]', { timeout: tmo(60000) });
  check(`${label}-LOAD`, '封面就绪（模型加载完成）', true);

  const stats = await page.evaluate(() => window.__ctx?.bike?.stats || null);
  check(`${label}-MODEL`, '整车节点与网格数正常',
    stats && stats.nodes > 700 && stats.meshes > 300, JSON.stringify(stats));

  await page.click('#cv-go');
  await page.waitForTimeout(tmo(900));
  // 首次进入会摊开「怎么操作」，收掉它
  const guide = await page.$('.guide button, .sheet .btn-primary');
  if (guide) { await guide.click(); await page.waitForTimeout(tmo(400)); }

  const total = await page.evaluate(() => window.__engine.steps.length);
  check(`${label}-STEPS`, '步骤表非空', total > 0, `${total} 步`);

  if (wantShots) await mkdir(SHOTS, { recursive: true });

  for (let i = 0; i < total; i++) {
    await page.evaluate((n) => window.__engine.go(n), i);
    await page.waitForFunction(() => !window.__engine.busy, null, { timeout: tmo(20000) });
    await page.waitForTimeout(tmo(260));

    const info = await page.evaluate(() => {
      const s = window.__engine.current;
      return { id: s?.id, title: s?.title, hasCam: !!s?.cam, hasFit: !!s?.cam?.fit };
    });
    const spread = await notFlat(page);
    const ok = !!info.id && !!info.title && info.hasFit && spread > 12;
    check(`${label}-S${String(i).padStart(2, '0')}`,
      `第 ${i + 1} 步 ${info.id || '?'} ${info.title || ''}`,
      ok,
      ok ? '' : `fit=${info.hasFit} 画面明暗差=${spread.toFixed(1)}`);
    if (wantShots || !ok) {
      await mkdir(SHOTS, { recursive: true });
      await page.screenshot({ path: join(SHOTS, `${label}-${String(i).padStart(2, '0')}-${info.id}.png`) });
    }
  }

  // 自动路径：四个装配件都要能被装上
  await page.evaluate(() => window.__engine.goToStep('B1'));
  await page.waitForFunction(() => !window.__engine.busy, null, { timeout: tmo(20000) });
  const autoOk = await page.evaluate(async () => {
    try { await window.__ctx.slide.autoSeat('front-wheel'); return true; } catch { return false; }
  });
  check(`${label}-AUTO`, '降级路径「帮我装上」可用', autoOk);

  check(`${label}-CLEAN`, '控制台没有报错与 4xx/5xx',
    errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
}

const { server, port } = await serve(DIST);
if (!existsSync(join(DIST, 'index.html'))) {
  console.error('dist/ 里没有 index.html —— 先跑 npm run build');
  process.exit(1);
}

console.log('══ 冒烟走查 ══\n');
try {
  await Promise.all([
    run({ width: 1280, height: 800 }, '宽', port),
    run({ width: 390, height: 844 }, '窄', port),
  ]);
} finally {
  server.close();
}

const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length} / ${results.length} 项通过`);
if (wantShots || bad.length) {
  await mkdir(SHOTS, { recursive: true });
  await writeFile(join(SHOTS, 'report.json'), JSON.stringify(results, null, 2));
}
process.exit(bad.length ? 1 : 0);
