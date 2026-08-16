/**
 * 冒烟走查：起构建产物 → 双画幅走完全程 → 逐条断言。
 *
 *   node tools/smoke.mjs [--shots] [--headed]
 *
 * 这一层要抓的是**在浏览器里才会现形**的那类错：契约漂移、取景对空、
 * 交互原语根本没跑起来。所以它必须真的把车装一遍，而不只是翻页看标题。
 *
 * 上一版有两处教训，都写在这儿免得再犯：
 *
 *   · 判「画面不是纯色」曾用 drawImage 读 WebGL 画布。没开 preserveDrawingBuffer 时
 *     那块缓冲在合成后就被清掉了，读回来永远是全黑 —— 十一步全部假失败，
 *     而真正的报错混在里面没人看得见。现在改成：同一个任务里先 render 再 drawImage。
 *   · 它从头到尾没碰过拧螺丝那条路。于是四个步骤 enter() 一进去就抛 TypeError，
 *     冒烟照样报「步骤可达」。现在四个交互原语都要真的走一遍并对账。
 *
 * CI 比开发机慢一个量级，所有等待都要过 tmo()。
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

/**
 * 画面的明暗跨度。**必须在同一个任务里先渲染再取样** ——
 * 画布没开 preserveDrawingBuffer，合成之后那块缓冲就归零了。
 */
const spread = (page) => page.evaluate(() => {
  const s = window.__ctx.stage;
  s.renderer.render(s.scene, s.camera);
  const g = document.createElement('canvas');
  g.width = 64; g.height = 40;
  const x = g.getContext('2d');
  x.drawImage(s.canvas, 0, 0, 64, 40);
  const d = x.getImageData(0, 0, 64, 40).data;
  let min = 255, max = 0;
  for (let i = 0; i < d.length; i += 4) {
    const l = d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722;
    if (l < min) min = l;
    if (l > max) max = l;
  }
  return max - min;
});

/** 等镜头走到位。弱机上缓动按真实时间跑，得给够 */
const settled = (page) => page.waitForFunction(() => {
  const s = window.__ctx.stage;
  return !window.__engine.busy && s.camera.position.distanceTo(s.recommend.pos) < 0.02;
}, null, { timeout: tmo(25000) });

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
  const guide = await page.$('.sheet .btn-primary');
  if (guide) { await guide.click(); await page.waitForTimeout(tmo(400)); }

  const total = await page.evaluate(() => window.__engine.steps.length);
  check(`${label}-STEPS`, '步骤表非空', total > 0, `${total} 步`);

  // ── 逐步走查 ──
  if (wantShots) await mkdir(SHOTS, { recursive: true });
  for (let i = 0; i < total; i++) {
    await page.evaluate((n) => window.__engine.go(n), i);
    await settled(page).catch(() => {});
    await page.waitForTimeout(tmo(200));

    const info = await page.evaluate(() => {
      const s = window.__engine.current;
      const st = window.__ctx.stage;
      /*
       * 这一步声明要看的那个点，投到屏幕上落在哪儿：落进界面遮住的那两条边里，
       * 或者干脆在画幅外，就说明镜头对着空处。
       *
       * 必须用步骤声明的 cam.target，不能用 controls.target —— 后者是让位之后
       * 的机位目标，按定义就落在画幅正中，那样这一条永远只是在测「中点在中间」。
       */
      const t = st.controls.target.clone().set(...s.cam.target).project(st.camera);
      const px = { x: (t.x * 0.5 + 0.5) * innerWidth, y: (0.5 - t.y * 0.5) * innerHeight };
      const safe = window.__ctx.hud._safe || { top: 0, bottom: 0 };
      return {
        id: s?.id,
        title: s?.title,
        hasFit: !!s?.cam?.fit,
        aimVisible: px.x > 0 && px.x < innerWidth && px.y > safe.top && px.y < innerHeight - safe.bottom,
        camGap: +st.camera.position.distanceTo(st.recommend.pos).toFixed(3),
      };
    });
    const sp = await spread(page);
    const ok = !!info.id && !!info.title && info.hasFit && info.aimVisible && sp > 12;
    check(`${label}-S${String(i).padStart(2, '0')}`,
      `第 ${i + 1} 步 ${info.id || '?'} ${info.title || ''}`,
      ok,
      ok ? '' : `fit=${info.hasFit} 取景点在画面内=${info.aimVisible} 明暗差=${sp.toFixed(1)} 镜头残差=${info.camGap}`);
    if (wantShots || !ok) {
      await mkdir(SHOTS, { recursive: true });
      await page.screenshot({ path: join(SHOTS, `${label}-${String(i).padStart(2, '0')}-${info.id}.png`) });
    }
  }

  // ── 四个交互原语真的跑一遍 ──
  //
  // 走的是降级路径（autoSeat / autoRun），它与手拖共用同一条代码路径，
  // 只是把指针换成补间 —— 手感测不了，别的全测得了。
  const slideIn = async (step, part) => {
    await page.evaluate((s) => window.__engine.goToStep(s), step);
    await settled(page).catch(() => {});
    return page.evaluate(async (p) => {
      try {
        await window.__ctx.slide.autoSeat(p);
        await new Promise((r) => setTimeout(r, 900));
        return { ok: !!window.__ctx.state.installed[p] };
      } catch (e) { return { ok: false, err: String(e) }; }
    }, part);
  };
  for (const [step, part, name] of [
    ['B2', 'swingarm-left', '摇臂套上转点轴'],
    ['C2', 'fork', '前叉穿过头管'],
    ['D1', 'handlebar', '车把推入托座'],
    ['F2', 'front-wheel', '前轮推入前叉'],
    ['H1', 'seatpost', '座管压入立管'],
  ]) {
    const r = await slideIn(step, part);
    check(`${label}-推-${part}`, `装配原语：${name}`, r.ok, r.err || '');
  }

  const screwIn = async (step, ids) => {
    await page.evaluate((s) => window.__engine.goToStep(s), step);
    await settled(page).catch(() => {});
    return page.evaluate(async ([list]) => {
      try {
        await window.__ctx.screw.autoRun();
        await new Promise((r) => setTimeout(r, 1200));
        const st = window.__ctx.state;
        return { ok: list.every((id) => typeof st.fastened[id] === 'number'), got: st.fastened };
      } catch (e) { return { ok: false, err: String(e) }; }
    }, [ids]);
  };
  for (const [step, ids, name] of [
    ['F3', ['axle-front'], '桶轴上扭矩'],
    ['D2', ['stem-face-a', 'stem-face-b', 'stem-face-c', 'stem-face-d'], '面盖四颗按对角上扭矩'],
    ['H2', ['pedal-right-spindle'], '右脚踏正牙旋入'],
    ['H3', ['pedal-left-spindle'], '左脚踏反牙旋入'],
  ]) {
    const r = await screwIn(step, ids);
    check(`${label}-拧-${step}`, `旋入原语：${name}`, r.ok, r.err || JSON.stringify(r.got || {}));
  }

  // ── 从头到尾装完整台车 ──
  //
  // 走的正是用户的那条路：一步步往下按，每一步把剩下的活按「一下一件」演完。
  // 装完之后对账三件事：每一件精确落回装配位、二十七件七颗全记上账、自检报全部到位。
  const done = await page.evaluate(async () => {
    const c = window.__ctx, e = window.__engine;
    await c.hud.onRestart();
    await new Promise((r) => setTimeout(r, 400));
    for (let i = 0; i < e.steps.length; i++) {
      await e.go(i);
      await new Promise((r) => setTimeout(r, 120));
      // 一下一件，最多按十下 —— 任何一步的活都不该多于这个数
      for (let k = 0; k < 10 && e.pending; k++) {
        await e.finishPending();
        await new Promise((r) => setTimeout(r, 60));
      }
    }
    await e.goToStep('H4');
    await new Promise((r) => setTimeout(r, 700));
    let worst = 0;
    for (const p of c.bom.parts) {
      for (const n of c.bom.nodesOf(p.id)) {
        const o = c.bike.get(n);
        if (!o.userData.homePos) continue;
        worst = Math.max(worst, o.position.distanceTo(o.userData.homePos));
      }
    }
    return {
      装上的件: Object.keys(c.state.installed).length,
      拧过的螺丝: Object.keys(c.state.fastened).length,
      最大归位偏差毫米: +(worst * 1000).toFixed(2),
      自检结语: document.querySelector('.dock-hint')?.textContent?.trim() || '',
      自检行数: document.querySelectorAll('.tally-row').length,
    };
  });
  check(`${label}-归位`, '装完后每一件都精确落在装配位',
    done.最大归位偏差毫米 < 0.01, `最大偏差 ${done.最大归位偏差毫米} mm`);
  check(`${label}-记账`, '二十七个件与七颗螺丝都记上了账',
    done.装上的件 === 27 && done.拧过的螺丝 === 7,
    `件 ${done.装上的件}/27 · 螺丝 ${done.拧过的螺丝}/7`);
  check(`${label}-自检`, '出门前自检列全三十四行并报「全部到位」',
    done.自检行数 === 34 && done.自检结语.includes('全部到位'),
    `${done.自检行数} 行 · 「${done.自检结语}」`);

  // ── 从零开始装：在场的件数一路只增不减 ──
  //
  // 这是整份课程的骨架。哪一件在第几步出现由步骤自己声明的 installs 现推，
  // 一旦某一步漏声明，它就会从头到尾挂在画面上 —— 而那正是「从零开始」失效的样子。
  const grow = await page.evaluate(async () => {
    const c = window.__ctx, e = window.__engine;
    const seq = [];
    for (let i = 0; i < e.steps.length; i++) {
      await e.go(i);
      await new Promise((r) => setTimeout(r, 90));
      let on = 0;
      for (const p of c.bom.parts) if (c.bike.get(c.bom.nodesOf(p.id)[0]).visible) on += 1;
      seq.push({ id: e.steps[i].id, on, all: !!e.steps[i].showAll });
    }
    return seq;
  });
  const build = grow.filter((g) => !g.all);
  const mono = build.every((g, i) => i === 0 || g.on >= build[i - 1].on);
  check(`${label}-从零`, '从一根车架开始，在场件数一路只增不减',
    mono && build[0].on === 0 && build[build.length - 1].on === 27,
    `起 ${build[0]?.on} → 终 ${build[build.length - 1]?.on} · 单调 ${mono}`);

  // ── 「下一步」一下只演一件 ──
  const oneAtATime = await page.evaluate(async () => {
    const e = window.__engine;
    // 先归零 —— 上面那一遍已经把这四颗拧完了，不重置就无从观察「一下一件」
    await window.__ctx.hud.onRestart();
    await new Promise((r) => setTimeout(r, 400));
    await e.goToStep('D2');                       // 面盖四颗
    await new Promise((r) => setTimeout(r, 700));
    const at = e.index;
    const seen = [];
    for (let k = 0; k < 4; k++) {
      await e.next();
      await new Promise((r) => setTimeout(r, 400));
      seen.push({ idx: e.index, left: window.__ctx.screw.session?.pending.size ?? null });
    }
    await e.next();
    await new Promise((r) => setTimeout(r, 600));
    return { at, seen, after: e.index };
  });
  const steps4 = oneAtATime.seen;
  check(`${label}-一下一件`, '四颗面盖要按四下，每下只拧一颗，第五下才翻页',
    steps4.every((x) => x.idx === oneAtATime.at)
      && steps4.map((x) => x.left).join(',') === '3,2,1,0'
      && oneAtATime.after === oneAtATime.at + 1,
    JSON.stringify(oneAtATime));

  // ── 主题 ──
  const theme = await page.evaluate(async () => {
    const read = () => ({
      root: document.documentElement.dataset.theme,
      bg: `#${window.__ctx.stage.scene.background.getHexString()}`,
    });
    window.__ctx.hud.setTheme('dark');
    await new Promise((r) => setTimeout(r, 200));
    const dark = read();
    window.__ctx.hud.setTheme('light');
    await new Promise((r) => setTimeout(r, 200));
    return { dark, light: read() };
  });
  check(`${label}-主题`, '深浅两套主题都换得动，三维背景跟着换',
    theme.dark.root === 'dark' && theme.light.root === 'light' && theme.dark.bg !== theme.light.bg,
    `深 ${theme.dark.bg} · 浅 ${theme.light.bg}`);

  // ── 键盘 ──
  const kb = await page.evaluate(async () => {
    const e = window.__engine;
    await e.goToStep('A1');
    await new Promise((r) => setTimeout(r, 400));
    const at0 = e.index;
    dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 700));
    const at1 = e.index;
    dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 700));
    return { at0, at1, at2: e.index };
  });
  check(`${label}-键盘`, '方向键前进与后退',
    kb.at0 === 0 && kb.at1 === 1 && kb.at2 === 0, JSON.stringify(kb));

  check(`${label}-CLEAN`, '控制台没有报错与 4xx/5xx',
    errors.length === 0, [...new Set(errors)].slice(0, 3).join(' | '));

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
