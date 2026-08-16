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
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { serve } from './serve.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const SHOTS = join(ROOT, '.shots', 'smoke');
const wantShots = process.argv.includes('--shots');
const headed = process.argv.includes('--headed');

const PATIENCE = process.env.CI ? 4 : 1;
const tmo = (ms) => ms * PATIENCE;

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

  // ── 对角拧紧真的在判 ──
  //
  // 这是三个签名交互之一，而它曾经整个失效过：bom.crossPairs 发的是紧固件对象，
  // screw._mate 拿它跟 id 字符串比，恒不相等 —— 于是「这一颗是不是上一颗的对角」
  // 恒假，每一组的第二、第四颗都被判成拧错，结尾自检永远多报一行，
  // 而用户完全是按对角拧的。上一版冒烟只查了「四颗都记上账」，一句没问顺序，
  // 所以整整一版没人发现。这一条两头都要过：拧对了要认，拧错了要抓。
  const cross = await page.evaluate(async () => {
    const c = window.__ctx, e = window.__engine;
    const run = async (order) => {
      await c.hud.onRestart();
      await new Promise((r) => setTimeout(r, 400));
      await e.goToStep('D2');
      await new Promise((r) => setTimeout(r, 700));
      for (const id of order) {
        await c.screw.autoRun(id);
        await new Promise((r) => setTimeout(r, 150));
      }
      return c.state.crossOrderOk;
    };
    return {
      // 上左 → 下右 → 上右 → 下左：两条对角线各走一遍
      good: await run(['stem-face-a', 'stem-face-b', 'stem-face-c', 'stem-face-d']),
      // 上左 → 上右：相邻的两颗，面盖会被拽歪
      bad: await run(['stem-face-a', 'stem-face-c', 'stem-face-b', 'stem-face-d']),
    };
  });
  check(`${label}-对角`, '按对角拧算通过，拧相邻的当场记下不合格',
    cross.good === true && cross.bad === false, JSON.stringify(cross));

  // ── 拆开那一步，二十七件每一件都得看得见 ──
  //
  // 这一步唯一的任务是回答「这台车由多少东西组成」，那就得真的数得出来。
  // 上一版沿装配方向一律退同样一段，而二十七件里十五件都是从侧面装的 ——
  // 它们全落到左右两个平面上摞成两摞，实测二十三件在屏幕上露不到三成，
  // 而所有断言照样通过：摊是摊开了，看还是看不见。
  //
  // 判据取像素：整幅渲染两次（有这一件 / 没这一件），差出来的就是它露在最前面的部分。
  // 影子要先关掉 —— 换一个投影件会让整张阴影贴图重采样，逐像素差里混进一大片噪点。
  const seen = await page.evaluate(async () => {
    const c = window.__ctx, e = window.__engine;
    await e.goToStep('A2');
    for (let k = 0; k < 300; k++) {
      if (!e.busy && c.stage.camera.position.distanceTo(c.stage.recommend.pos) < 0.02) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    await new Promise((r) => setTimeout(r, 400));
    const s = c.stage;
    const shadowWas = s.renderer.shadowMap.enabled;
    const groundWas = s.ground.visible;
    s.renderer.shadowMap.enabled = false;
    s.ground.visible = false;
    const N = 480;
    const h = Math.max(1, Math.round((N * innerHeight) / innerWidth));
    const cv = document.createElement('canvas');
    cv.width = N; cv.height = h;
    const x = cv.getContext('2d', { willReadFrequently: true });
    const grab = () => {
      s.renderer.render(s.scene, s.camera);
      x.clearRect(0, 0, N, h);
      x.drawImage(s.canvas, 0, 0, N, h);
      return x.getImageData(0, 0, N, h).data;
    };
    const setVis = (id, on) => { for (const n of c.bom.nodesOf(id)) c.bike.setVisible(n, on); };
    const full = grab();
    const out = [];
    for (const p of c.bom.parts) {
      setVis(p.id, false);
      const off = grab();
      setVis(p.id, true);
      let front = 0;
      for (let i = 0; i < full.length; i += 4) {
        if (Math.abs(full[i] - off[i]) + Math.abs(full[i + 1] - off[i + 1])
          + Math.abs(full[i + 2] - off[i + 2]) > 12) front += 1;
      }
      out.push({ name: p.name, front });
    }
    s.renderer.shadowMap.enabled = shadowWas;
    s.ground.visible = groundWas;
    out.sort((a, b) => a.front - b.front);
    return out;
  });
  const hidden = seen.filter((p) => p.front < 6);
  const median = seen[Math.floor(seen.length / 2)].front;
  check(`${label}-摊开`, '拆开那一步二十七件每一件都露得出来',
    seen.length === 27 && hidden.length === 0 && median >= 35,
    hidden.length ? `看不见：${hidden.map((p) => `${p.name} ${p.front}px`).join('、')}`
      : `最小 ${seen[0].front}px · 中位 ${median}px · 最大 ${seen[26].front}px`);

  // ── 整车那几张不许裁边 ──
  //
  // 声明 showAll 的四步（首屏成品照、爆炸图、出门前自检、收尾）画的都是整台车，
  // 它必须完整落在画幅里 —— 这几张同时也是 README 的截图。
  // 早先它们用一对手写的取景常量，把整车半高报小了一成多 ——
  // 于是打开页面第一眼，后轮下缘就被切掉九十来像素，而全部断言照样通过。
  // 判据取渲染结果：把画布缩样读回来，非背景像素的外接框不许贴到画幅四边。
  // 量之前先把地面收掉 —— 这一条要判的是「车有没有被切掉」，
  // 而影子铺得比车宽得多（摊开那一步尤其），把它算进去等于在判影子。
  const whole = await page.evaluate(async () => {
    const c = window.__ctx, e = window.__engine;
    const groundWas = c.stage.ground.visible;
    c.stage.ground.visible = false;
    const out = [];
    for (let i = 0; i < e.steps.length; i++) {
      if (!e.steps[i].showAll) continue;
      await e.go(i);
      for (let k = 0; k < 120; k++) {
        if (!e.busy && c.stage.camera.position.distanceTo(c.stage.recommend.pos) < 0.02) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      await new Promise((r) => setTimeout(r, 250));
      const s = c.stage;
      s.renderer.render(s.scene, s.camera);
      const N = 160;
      const h = Math.max(1, Math.round((N * innerHeight) / innerWidth));
      const g2 = document.createElement('canvas');
      g2.width = N; g2.height = h;
      const x = g2.getContext('2d', { willReadFrequently: true });
      x.drawImage(s.canvas, 0, 0, N, h);
      const d = x.getImageData(0, 0, N, h).data;
      const bg = [d[0], d[1], d[2]];
      let x0 = N, y0 = h, x1 = -1, y1 = -1;
      for (let p = 0; p < N * h; p++) {
        const i4 = p * 4;
        if (Math.abs(d[i4] - bg[0]) + Math.abs(d[i4 + 1] - bg[1]) + Math.abs(d[i4 + 2] - bg[2]) < 14) continue;
        const px = p % N, py = (p / N) | 0;
        if (px < x0) x0 = px; if (px > x1) x1 = px;
        if (py < y0) y0 = py; if (py > y1) y1 = py;
      }
      out.push({ id: e.steps[i].id, x0, y0, x1: N - 1 - x1, y1: h - 1 - y1, N, h });
    }
    c.stage.ground.visible = groundWas;
    return out;
  });
  // 缩样一格约等于画幅的 1/160，留一格容差
  const cut = whole.filter((w) => w.x0 < 1 || w.y0 < 1 || w.x1 < 1 || w.y1 < 1);
  check(`${label}-整车`, '整车那四张（成品照、爆炸图、自检、收尾）完整落在画幅内',
    whole.length === 4 && cut.length === 0,
    cut.length ? cut.map((w) => `${w.id} 贴边`).join('、') : `${whole.length} 张`);

  // ── 摊开那一步：指到哪件，报哪件的名字 ──
  //
  // 摊开只回答了「有多少」。指哪儿说哪儿，才回答得了「都是些什么」。
  // 取样点用每件自己那几块网格的投影中心 —— 不是包围盒中心：
  // 油管、座管这类件的节点原点离它的几何有一米远，拿盒中心去指会指到空处。
  const spots = await page.evaluate(async () => {
    const c = window.__ctx, e = window.__engine, s = c.stage;
    await e.goToStep('A2');
    for (let k = 0; k < 300; k++) {
      if (!s.shot && !e.busy) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    await new Promise((r) => setTimeout(r, 400));
    const cam = s.camera;
    cam.updateMatrixWorld(true);
    const out = [];
    for (const p of c.bom.parts) {
      let sx = 0, sy = 0, n = 0;
      for (const nm of c.bom.nodesOf(p.id)) {
        c.bike.get(nm).traverse((o) => {
          if (!o.isMesh || !o.geometry) return;
          if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
          const v = o.geometry.boundingSphere.center.clone().applyMatrix4(o.matrixWorld).project(cam);
          sx += (v.x * 0.5 + 0.5) * innerWidth;
          sy += (0.5 - v.y * 0.5) * innerHeight;
          n += 1;
        });
      }
      if (n) out.push({ name: p.name, x: Math.round(sx / n), y: Math.round(sy / n) });
    }
    return out;
  });
  let named = 0;
  const wrong = [];
  for (const sp of spots) {
    if (sp.x < 2 || sp.x > viewport.width - 2 || sp.y < 2 || sp.y > viewport.height - 2) continue;
    await page.mouse.move(sp.x, sp.y);
    await page.waitForTimeout(tmo(60));
    const got = await page.evaluate(() => {
      const el = document.querySelector('.tag');
      return el.hidden ? null : el.textContent;
    });
    if (!got) continue;
    named += 1;
    // 报出来的必须是清单里真有的名字（指到别的件上也算对：那一像素本来就是那件在前面）
    const real = await page.evaluate((t) => window.__ctx.bom.parts.some((p) => p.name === t), got);
    if (!real) wrong.push(`${sp.name}→${got}`);
  }
  const cleared = await page.evaluate(async () => {
    await window.__engine.next();
    await new Promise((r) => setTimeout(r, 600));
    return document.querySelector('.tag').hidden;
  });
  check(`${label}-认件`, '摊开那一步指到哪件报哪件的名字，翻页就收起',
    named >= 16 && wrong.length === 0 && cleared,
    wrong.length ? `报了清单里没有的名字：${wrong.join('、')}`
      : `${named} / ${spots.length} 处报出名字 · 翻页后${cleared ? '已收起' : '还挂着'}`);

  // ── 运镜：不许跳切，而且要绕过去不是穿过去 ──
  //
  // 这一份说明书全靠「同一台车，镜头挪过去」把二十九步串成一件事。
  // 一步一跳切，看的人每一步都得重新找一遍「这是车上的哪儿」。
  //
  // 两条判据：
  //   排了一趟   每次换步都得排出一段有时长的运镜（除非两步机位本来就一样），
  //              而不是把相机瞬间摆过去；
  //   走的是弧   全程离主体最近时，不许比两头那个较近的距离还近。
  //              绕着转过去的话这个比值恒在 1.0 往上（中段还会往外鼓一点）；
  //              世界坐标直线插值转半圈时相机笔直穿过整台车，它会掉到零附近。
  //              **判距离而不是判路程**：路程要逐帧累加，帧率一低就把弧量成了直线
  //              （实测线上跑出过 1.02，紧贴阈值），而距离只要采到中段就一定露馅。
  // 外加：每一趟都要**分毫不差地落在**这一步该在的机位上，否则「最佳姿态」是空话。
  const flight = await page.evaluate(async () => {
    const c = window.__ctx, e = window.__engine, s = c.stage;
    const wrap = (d) => ((d % 360) + 540) % 360 - 180;
    const azOf = (i) => e.steps[i].cam?.az ?? 0;

    /*
     * 逐帧采样，而不是等 go() 回来再读一次 shot。
     * go() 会 await 这一步的 enter()，而「拆开看看」的 enter 要演两秒六 ——
     * 等它回来时那趟运镜早跑完了，shot 已经置空，读出来是「时长 0」，
     * 看着就像跳切，其实是量晚了。
     */
    const hop = async (i) => {
      let dur = 0;
      let stop = false;
      const d0 = s.camera.position.distanceTo(s.controls.target);
      let minR = d0;
      const tick = () => {
        if (stop) return;
        if (s.shot) dur = Math.max(dur, s.shot.dur);
        minR = Math.min(minR, s.camera.position.distanceTo(s.controls.target));
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      await e.go(i);
      for (let k = 0; k < 300; k++) {
        if (!s.shot && !e.busy) break;
        await new Promise((r) => setTimeout(r, 25));
      }
      await new Promise((r) => setTimeout(r, 120));
      stop = true;
      const d1 = s.camera.position.distanceTo(s.controls.target);
      return {
        id: e.steps[i].id,
        dur,
        // 全程离主体最近时还剩两头那个较近值的几成 —— 绕过去是 1.0 往上，穿过去会掉到零附近
        clear: minR / Math.max(1e-6, Math.min(d0, d1)),
        land: s.camera.position.distanceTo(s.recommend.pos),
      };
    };

    const out = [];
    // 正着走一遍，再倒着走一遍 —— 两个方向都要顺
    for (const dir of ['fwd', 'back']) {
      const order = dir === 'fwd'
        ? [...Array(e.steps.length).keys()]
        : [...Array(e.steps.length).keys()].reverse();
      await e.goToStep(e.steps[order[0]].id);
      await new Promise((r) => setTimeout(r, 700));
      for (let n = 1; n < order.length; n++) {
        const turn = Math.abs(wrap(azOf(order[n]) - azOf(order[n - 1])));
        out.push({ dir, turn, ...(await hop(order[n])) });
      }
    }
    return out;
  });
  const jumped = flight.filter((f) => f.dur < 0.4);
  const missed = flight.filter((f) => f.land > 0.01);
  const chord = flight.filter((f) => f.turn > 60 && f.clear < 0.9);
  check(`${label}-运镜`, '换步一律走一段运镜，转得多时绕过去，且分毫不差地落在该到的机位上',
    flight.length === (total - 1) * 2 && jumped.length === 0
      && missed.length === 0 && chord.length === 0,
    [
      jumped.length ? `跳切 ${jumped.map((f) => `${f.id}(${f.dur.toFixed(2)}s)`).join('、')}` : '',
      missed.length ? `没落到位 ${missed.map((f) => `${f.id}(${f.land.toFixed(3)}m)`).join('、')}` : '',
      chord.length ? `穿过去了 ${chord.map((f) => `${f.id}(离主体剩 ${f.clear.toFixed(2)})`).join('、')}` : '',
    ].filter(Boolean).join(' · ')
      || `${flight.length} 趟 · 最长 ${Math.max(...flight.map((f) => f.dur)).toFixed(2)}s`
        + ` · 大转弯离主体最近 ${Math.min(...flight.filter((f) => f.turn > 60).map((f) => f.clear)).toFixed(2)}`);

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
    // 等到这一步真的铺完。固定睡几百毫秒是不行的：「拆开看看」进场要演两秒多，
    // 睡醒时引擎还忙着，这时按下的那一下会被攒起来晚一点才补 ——
    // 断言在补上之前读数，看着就像方向键失灵，而它其实工作得好好的
    const idle = async () => {
      for (let k = 0; k < 200; k++) {
        if (!e.busy) return;
        await new Promise((r) => setTimeout(r, 50));
      }
    };
    const press = async (key) => {
      dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 120));
      await idle();
      await new Promise((r) => setTimeout(r, 120));
      return e.index;
    };
    await e.goToStep('A1');
    await idle();
    const at0 = e.index;
    const at1 = await press('ArrowRight');
    const at2 = await press('ArrowLeft');
    return { at0, at1, at2 };
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
