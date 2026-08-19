/**
 * 界面层。全屏三维，界面退到四周，没有底部实底条 —— 画面是主角。
 * 覆盖层两种形态：卷 sheet 盖住画面讲一件事；坞 dock 停在底部让出画面。
 * 这一层不认识自行车，只收字符串、数字和三维里的一个点。
 * 整层 DOM 由本文件生成，index.html 只留画布与封面。
 */

import * as THREE from 'three';
import { icon } from './icons.js';

/**
 * 怎么操作。前四条首次进入就给，带 full 的留给右上角的完整版；
 * touch 是触屏机型的替换句。keys 画成键帽，ico 画成圆图标 ——
 * 混成一种，「转画面」会长得像键盘上有个「转」键。
 */
const GUIDE = [
  { keys: ['arrow-left', 'arrow-right'], t: '翻到上一步、下一步。键盘 <em>←</em> <em>→</em> 一样管用',
    touch: '点画面左右两边的箭头，翻到上一步、下一步' },
  { ico: 'rotate', t: '按住画面拖，换个角度看；滚轮缩放。转到哪儿就停在哪儿',
    touch: '按住画面拖，换个角度看；双指开合缩放。转到哪儿就停在哪儿' },
  { ico: 'drag', t: '零件顺着箭头指的方向拖，快到位会自己吸住' },
  { ico: 'screw', t: '螺丝按住绕圈拧，拧到底就上好了',
    touch: '螺丝按住绕圈拧，拧到底就上好了' },
  { ico: 'menu', t: '深色与声音在右上角那枚按钮里', full: true },
  { ico: 'wrench', t: '不想自己动手，按「帮我装上」自动做完 —— 该看的、该听的一样不少', full: true },
];

/**
 * 把一份行动声明渲染成按钮。
 * @param {{label:string, kind?:'primary'|'quiet'|'text', ico?:string, id?:string,
 *          disabled?:boolean, hidden?:boolean, on?:Function}} a
 */
function actionHTML(a, i) {
  const cls = a.kind === 'primary' ? 'btn btn-primary'
    : a.kind === 'text' ? 'btn btn-text'
      : 'btn btn-quiet';
  return `<button type="button" class="${cls}" data-act="${i}"
    ${a.id ? `id="${a.id}"` : ''} ${a.disabled ? 'disabled' : ''} ${a.hidden ? 'hidden' : ''}
    >${a.ico ? icon(a.ico) : ''}<span>${a.label}</span></button>`;
}

function bindActions(root, list) {
  root.querySelectorAll('[data-act]').forEach((b) => {
    const a = list[+b.dataset.act];
    if (a?.on) b.addEventListener('click', (e) => a.on(e, b));
  });
}

/** 键帽：认得的名字画成线稿图标，认不得的直接印字 */
const cap = (name) => `<span class="kbd">${icon(name) || name}</span>`;

/** 一行「怎么操作」左边那一栏 */
const guideMark = (r) => (r.keys
  ? r.keys.map(cap).join('')
  : `<span class="guide-ico">${icon(r.ico)}</span>`);

/** 螺丝的三种状态。图标不是装饰：只靠颜色分，色觉障碍读不出来 */
const BOLT = {
  pending: { t: '还没上', ico: '' },
  threading: { t: '正在拧', ico: 'screw' },
  tight: { t: '拧上了', ico: 'check' },
};

/** 「面盖螺丝 · 上左」在一排四颗里只印得下「上左」，全名留给读屏 */
const shortName = (s) => String(s || '').split('·').pop().trim();

/*
 * 常驻界面骨架：顶部章节与步名（只读）、两侧翻页、右侧列读数与「为什么」、
 * 底部一句旁白加需要时才出现的次要行动，都不带底色。
 * 旁白是唯一一处常驻文字 —— 该说的话由动画说，文字只点一下「现在看哪儿」。
 */
const SHELL = `
<header class="topbar" data-quiet="0">
  <nav class="rail" aria-label="章节"></nav>
  <div class="toprow">
    <p class="where"><span class="stepno"></span><span class="steptitle"></span></p>
    <div class="toptools">
      <button type="button" class="chip note-tab" aria-controls="hud-note"
              aria-expanded="false" hidden></button>
      <button type="button" class="icon-btn btn-menu" aria-label="设置与帮助"
              aria-haspopup="true" aria-expanded="false"></button>
    </div>
  </div>
</header>

<button type="button" class="nav nav-prev" aria-label="上一步"></button>
<button type="button" class="nav nav-next" aria-label="下一步"></button>

<div class="side">
  <aside class="note scroll" id="hud-note" aria-label="这一步的原理" hidden></aside>
  <div class="readout" hidden>
    <ul class="bolts" role="list" hidden></ul>
  </div>
</div>

<div class="tag" role="status" aria-live="polite" hidden></div>
<div class="toast" role="status" aria-live="polite" hidden></div>
<p class="sr-only sr-step" role="status" aria-live="polite"></p>

<footer class="foot" data-quiet="0">
  <div class="actions">
    <div class="alts"></div>
  </div>
  <p class="cue" role="status" aria-live="polite"></p>
</footer>

<div class="overlay" hidden></div>`;

export class HUD {
  /** @param {object} state core/state.js 那个对象；界面只读写偏好那几项 */
  constructor(state) {
    this.state = state;

    const root = document.createElement('div');
    root.className = 'hud';
    root.id = 'hud';
    root.innerHTML = SHELL;
    document.body.appendChild(root);
    this.root = root;

    const q = (sel) => root.querySelector(sel);
    this.el = {
      root,
      topbar: q('.topbar'), chapters: q('.rail'), stepno: q('.stepno'), steptitle: q('.steptitle'),
      cue: q('.cue'), menu: q('.btn-menu'),
      side: q('.side'),
      note: q('.note'), noteTab: q('.note-tab'), toast: q('.toast'), tag: q('.tag'), srStep: q('.sr-step'),
      readout: q('.readout'), bolts: q('.bolts'),
      foot: q('.foot'), alts: q('.alts'),
      prev: q('.nav-prev'), next: q('.nav-next'),
      overlay: q('.overlay'),
      cover: document.getElementById('cover'),
    };

    this.spots = [];
    this.steps = [];
    this._safe = { top: 0, bottom: 0, left: 0, right: 0 };
    this._chrome = true;
    this._menu = null;
    this._tip = null;
    this._note = null;
    this._noteOpen = false;
    this._boltKey = '';
    this._escape = null;
    this._returnFocus = null;
    this._base = null;
    this._top = null;
    this._toastTimer = null;
    this._readyTimer = null;
    this._barH = -1;

    this.el.menu.innerHTML = icon('menu');
    this.el.prev.innerHTML = icon('arrow-left');
    this.el.next.innerHTML = icon('arrow-right');

    this.el.prev.addEventListener('click', () => this.onPrev?.());
    this.el.next.addEventListener('click', () => this.onNext?.());
    this.el.menu.addEventListener('click', (e) => { e.stopPropagation(); this.toggleMenu(); });
    this.el.noteTab.addEventListener('click', () => this.toggleNote());

    // Esc 一次退一层：先收菜单，再关最上面那一层覆盖层
    addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (this._menu) { this.closeMenu(); return; }
      if (this._escape) { const fn = this._escape; this._escape = null; fn(); }
    });

    // 四周这几件一变大小，三维的取景就得跟着让位。说明卡也在列 ——
    // 它在宽屏上占掉右边 300 px，不观察它的话，摊开卡片那一下车不会让开
    this._ro = new ResizeObserver(() => this.#syncSafe());
    this._ro.observe(this.el.topbar);
    this._ro.observe(this.el.foot);
    this._ro.observe(this.el.readout);
    this._ro.observe(this.el.note);
    addEventListener('resize', () => { this.#syncSafe(); this.#layoutNote(); });
    // 手机横过来时 resize 未必先到，orientationchange 补一道
    addEventListener('orientationchange', () => { this.#syncSafe(); this.#layoutNote(); });

    this.#paintTheme();
  }

  // ══════════════ 让位 ══════════════

  /**
   * 量出界面实际占掉的四条边，交给 stage.setSafeArea —— 三维据此让位。
   * 判据一律用几何而不是元素身份，理由见 docs/DEVELOPMENT.md「界面遮住多少画面」。
   */
  #syncSafe() {
    const vh = innerHeight;
    // 用 getClientRects 判「有没有被画出来」：常驻件都是 fixed 定位，offsetParent 一律为 null
    const box = (el) => (el && !el.hidden && el.getClientRects().length ? el.getBoundingClientRect() : null);

    let top = 0;
    const tb = box(this.el.topbar);
    if (tb && this.el.topbar.dataset.quiet !== '1') top = tb.bottom;

    // 底部那一条实测多高 —— 坞与窄屏读数据此叠在它上面，而不是压上去
    const bar = this.el.foot.dataset.quiet === '1' ? null : box(this.el.foot);
    const barH = bar ? Math.round(vh - bar.top) : 0;
    if (barH !== this._barH) {
      this._barH = barH;
      document.documentElement.style.setProperty('--bar-h', `${barH}px`);
    }

    let bottom = barH;
    /*
     * 叠在底部条上、又挡着主体的（坞、窄屏读数区）也算进 bottom。
     * 两道判据缺一不可：贴底（下沿离屏幕底不超过一条底部条再加一点，
     * 否则右上角的读数区也会被算成「底部占了几百像素」）；
     * 挡道（与画面横向中间那一半有重叠，否则缩在角落的也让主体无谓上移）。
     */
    const reach = barH + 24;
    const midL = innerWidth * 0.25;
    const midR = innerWidth * 0.75;
    const rise = (el) => {
      const r = box(el);
      if (!r || !r.height || vh - r.bottom > reach) return;
      if (r.right < midL || r.left > midR) return;
      bottom = Math.max(bottom, vh - r.top);
    };
    if (bar) rise(this.el.readout);
    this.el.overlay.querySelectorAll('.dock').forEach(rise);

    /*
     * 右边那一列：贴着右缘、且高得能挡住主体，才算占边。窄屏上它横铺在底部、
     * 左沿落在屏幕左半边，这一条自然不成立（已算进 bottom，再算会让车横着缩一半）。
     * 让位量按「卡片高 ÷ 可用画面高」折算：从头到脚的侧栏全额让位，
     * 右上角一张小卡只让它真正占着的那一档 —— 全额算会把主体推离屏幕中线。
     */
    const freeH = Math.max(1, vh - top - bottom);
    let right = 0;
    for (const el of [this.el.note, this.el.readout]) {
      const r = box(el);
      if (!r || !r.height) continue;
      if (r.left < innerWidth * 0.6 || innerWidth - r.right > 48) continue;
      if (r.height < vh * 0.12) continue;
      right = Math.max(right, (innerWidth - r.left) * Math.min(1, r.height / freeH));
    }

    const next = { top: Math.round(top), bottom: Math.round(bottom), left: 0, right: Math.round(right) };
    const p = this._safe;
    if (next.top === p.top && next.bottom === p.bottom && next.right === p.right) return;
    this._safe = next;
    this.onSafeArea?.(next);
  }

  // ══════════════ 章节 ══════════════

  /**
   * 用步骤表铺出顶部章节导航：每一章一段，每一步一格，格子都能点。
   * @param {object[]} steps
   * @param {string[]} names 章节名，由内容层提供，必传 ——
   *   界面自带一份就是两套账，对不上的章会被静默并掉
   */
  setChapters(steps, names) {
    if (!Array.isArray(names) || !names.length) {
      throw new Error('[hud] setChapters 需要章节名；界面层不自带一份');
    }
    this.steps = steps;
    this.phases = names;
    const byPhase = names.map(() => []);
    steps.forEach((s, i) => {
      const p = s.phase ?? 0;
      if (p >= names.length) throw new Error(`[hud] 第 ${i + 1} 步 ${s.id} 的 phase 是 ${p}，但只有 ${names.length} 章`);
      byPhase[p].push({ i, s });
    });

    // 整条轨只占一个 Tab 位，轨内用方向键走格子（roving tabindex）——
    // 二十九个格子各占一位，键盘用户要按二十九下才够得着「下一步」
    this.el.chapters.innerHTML = byPhase.map((list, p) => `
      <div class="ch" data-p="${p}">
        <div class="ch-ticks">${list.map(({ i, s }) => `
          <button class="tick" type="button" data-i="${i}" tabindex="${i === 0 ? 0 : -1}"
                  aria-label="第 ${i + 1} 步 ${s.title}"></button>`).join('')}
        </div>
        <span class="ch-nm">${names[p]}</span>
      </div>`).join('');

    // 方向键在轨内走格子。这里不会跟「方向键翻页」打架 —— 引擎那一条
    // 见焦点落在按钮上就不接管，正是为这种控件留的
    this.el.chapters.addEventListener('keydown', (e) => {
      const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1
        : e.key === 'Home' ? 'first' : e.key === 'End' ? 'last' : 0;
      if (!dir || !e.target.closest('.tick')) return;
      e.preventDefault();
      const ticks = [...this.el.chapters.querySelectorAll('.tick')];
      const at = ticks.indexOf(e.target);
      const to = dir === 'first' ? 0 : dir === 'last' ? ticks.length - 1
        : Math.min(ticks.length - 1, Math.max(0, at + dir));
      ticks[to]?.focus();
    });

    // 每一章按步数分宽度 —— 宽窄本身就是进度。
    // 只能走 CSSOM：产物 CSP 是 style-src 'self'，模板里的 style="…" 会被挡下
    this.el.chapters.querySelectorAll('.ch').forEach((el, p) => {
      el.style.flexGrow = String(byPhase[p].length || 1);
    });

    this.el.chapters.addEventListener('click', (e) => {
      const t = e.target.closest('.tick');
      if (t) this.onJump?.(+t.dataset.i);
    });
    // 悬停与键盘焦点都报出步名 —— 格子只有 2px 高，看不出哪一格是哪一步
    for (const ev of ['pointerover', 'focusin']) {
      this.el.chapters.addEventListener(ev, (e) => {
        const t = e.target.closest('.tick');
        if (t) this.#showTip(t);
      });
    }
    for (const ev of ['pointerout', 'focusout']) {
      this.el.chapters.addEventListener(ev, (e) => {
        if (e.target.closest('.tick')) this.#hideTip();
      });
    }
  }

  #showTip(tick) {
    this.#hideTip();
    const s = this.steps[+tick.dataset.i];
    if (!s) return;
    const tip = document.createElement('div');
    tip.className = 'tick-tip';
    tip.innerHTML = `<b>${String(+tick.dataset.i + 1).padStart(2, '0')}</b>${s.title}`;
    this.root.appendChild(tip);
    const r = tick.getBoundingClientRect();
    tip.style.left = `${Math.min(Math.max(r.left + r.width / 2, 80), innerWidth - 80)}px`;
    tip.style.top = `${r.bottom + 8}px`;
    this._tip = tip;
  }

  #hideTip() { this._tip?.remove(); this._tip = null; }

  /** 高亮当前所在的章与步 */
  setStep(index, total, title) {
    this.el.stepno.textContent = index >= 0 ? `${String(index + 1).padStart(2, '0')}／${total}` : '';
    this.el.steptitle.textContent = title || '';
    // 顶栏的变化读屏看不见 —— 单独报一句
    this.el.srStep.textContent = index >= 0 ? `第 ${index + 1} 步，共 ${total} 步：${title || ''}` : '';
    // 格子的三种状态只有明暗之分 —— 名字里带上状态，当下那一格挂 aria-current
    this.el.chapters.querySelectorAll('.tick').forEach((t) => {
      const i = +t.dataset.i;
      const state = i < index ? 'done' : i === index ? 'now' : 'next';
      t.dataset.state = state;
      t.setAttribute('aria-label',
        `第 ${i + 1} 步 ${this.steps[i]?.title || ''}，${state === 'done' ? '已走过' : state === 'now' ? '当前' : '还没到'}`);
      // Tab 进来时落在当下这一格，不是永远落在第一格
      t.tabIndex = state === 'now' ? 0 : -1;
      if (state === 'now') t.setAttribute('aria-current', 'step');
      else t.removeAttribute('aria-current');
    });
    const phase = this.steps[index]?.phase ?? 0;
    this.el.chapters.querySelectorAll('.ch').forEach((ch) => {
      const p = +ch.dataset.p;
      ch.dataset.on = p === phase ? '1' : '0';
      ch.dataset.done = p < phase ? '1' : '0';
    });
    this.el.prev.disabled = index <= 0;
    this.el.next.disabled = index >= total - 1;
  }

  // ══════════════ 提示与短讯 ══════════════

  /**
   * 底部那一行旁白。它是读屏用户唯一听得到「现在该做什么」的 live region；
   * 拧螺丝的计数一步里能改十几次，计数类更新传 quiet ——
   * 照常写进 DOM 给眼睛看，写的那一下关掉播报。
   * @param {string} text
   * @param {{quiet?:boolean}} [o]
   */
  setCue(text, { quiet = false } = {}) {
    const e = this.el.cue;
    e.setAttribute('aria-live', quiet ? 'off' : 'polite');
    e.textContent = text || '';
    e.hidden = !text;
  }

  /**
   * 画面中上方一句话，说完就走。
   * @param {string} text
   * @param {{dur?:number, tone?:'go'|'stop'}} [o] tone 只有两种：到位了、出问题了。
   *   两者都另加一枚图标 —— 只靠红绿分，色觉障碍读到的是同一句话
   */
  toast(text, { dur = 2600, tone } = {}) {
    clearTimeout(this._toastTimer);
    const e = this.el.toast;
    e.hidden = false;
    e.className = `toast${tone ? ` ${tone}` : ''}`;
    e.innerHTML = (tone ? icon(tone === 'go' ? 'check' : 'warn') : '') + `<span>${text}</span>`;
    e.style.animation = 'none'; void e.offsetWidth; e.style.animation = '';
    this._toastTimer = setTimeout(() => { e.hidden = true; }, dur);
  }

  /**
   * 跟着指针走的一枚小标签：把光标下那件东西叫什么说出来。
   * 传 null 收起。
   *
   * @param {string|null} text
   * @param {number} x @param {number} y 视口坐标
   */
  tag(text, x = 0, y = 0) {
    const el = this.el.tag;
    if (!text) {
      if (!el.hidden) { el.hidden = true; el.textContent = ''; }
      return;
    }
    // 名字没变就只挪位置。每帧重写 textContent 会让读屏把同一个名字念个不停
    if (el.textContent !== text) el.textContent = text;
    el.hidden = false;
    // 贴在光标右下；快顶到右缘或下缘时翻到另一侧，别被屏幕裁掉
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const flipX = x + 16 + w > innerWidth - 8;
    const flipY = y + 14 + h > innerHeight - 8;
    el.style.left = `${Math.max(8, flipX ? x - 16 - w : x + 16)}px`;
    el.style.top = `${Math.max(8, flipY ? y - 14 - h : y + 14)}px`;
  }

  // ══════════════ 知识卡片 ══════════════

  /** @param {null | {title?:string, spec?:Array<[string,string]>, body?:string, foot?:string}} n */
  setNote(n) {
    const { note, noteTab } = this.el;
    if (!n) {
      note.hidden = true; noteTab.hidden = true; note.innerHTML = '';
      this._note = null; this._noteOpen = false;
      this.#dropNoteRect();
      return;
    }
    const spec = (n.spec || []).length
      ? `<div class="note-spec">${n.spec.map(([k, v]) =>
        `<div class="sp"><span>${k}</span><i></i><b>${v}</b></div>`).join('')}</div>`
      : '';
    note.innerHTML = [
      n.title ? `<div class="note-hd">${n.title}</div>` : '',
      spec,
      n.body ? `<p>${n.body}</p>` : '',
      n.foot ? `<div class="note-foot">${n.foot}</div>` : '',
    ].join('');

    this._note = n;
    noteTab.hidden = false;
    this.#layoutNote(true);
    note.style.animation = 'none'; void note.offsetWidth; note.style.animation = '';
  }

  /**
   * 宽屏默认摊开，窄屏默认收着 —— 手机上它一摊开就吃掉半块画面。
   * 换画幅要重判，否则转屏之后卡片僵在上一档的状态。
   */
  #layoutNote(reset = false) {
    if (!this._note) return;
    const narrow = matchMedia('(max-width: 720px)').matches;
    if (reset || this._noteNarrow !== narrow) this._noteOpen = !narrow;
    this._noteNarrow = narrow;
    this.el.note.hidden = !this._noteOpen;
    this.#paintNoteTab();
    this.#dropNoteRect();
  }

  /** 窄屏那枚开合钮。标签固定写「为什么」—— 卡片标题会把顶栏的步名挤没 */
  #paintNoteTab() {
    const b = this.el.noteTab;
    b.innerHTML = icon('help') + '<span>为什么</span>';
    b.dataset.on = this._noteOpen ? '1' : '0';
    b.setAttribute('aria-expanded', String(this._noteOpen));
    b.setAttribute('aria-label', `${this._noteOpen ? '收起' : '展开'}这一步的原理：${this._note?.title || ''}`);
  }

  toggleNote() {
    this._noteOpen = !this._noteOpen;
    this.el.note.hidden = !this._noteOpen;
    this.#paintNoteTab();
    this.#dropNoteRect();
  }

  // ══════════════ 底部行动 ══════════════

  /** 这一步的活演完了：右边那枚箭头亮一下，告诉你可以走了 */
  readyNext() {
    const b = this.el.next;
    b.classList.remove('ready'); void b.offsetWidth; b.classList.add('ready');
    clearTimeout(this._readyTimer);
    this._readyTimer = setTimeout(() => b.classList.remove('ready'), 4200);
  }

  /** 次要行动一律无框文字，最多两个 —— 「帮我装上」这类降级入口都在这儿 */
  setAlts(list) {
    const box = this.el.alts;
    box.innerHTML = '';
    for (const a of (list || []).slice(0, 2)) {
      const b = document.createElement('button');
      b.className = 'btn btn-text';
      b.type = 'button';
      b.innerHTML = (a.ico ? icon(a.ico) : '') + `<span>${a.label}</span>`;
      b.addEventListener('click', () => a.onClick?.(b));
      box.appendChild(b);
    }
  }

  /**
   * 一排螺丝状态点。面盖四颗那一步靠它交代「哪颗拧过了、哪颗还空着」。
   * @param {Array<{id:string, name:string, state:'pending'|'threading'|'tight'}>} list
   */
  setBoltRow(list) {
    const ul = this.el.bolts;
    if (!list?.length) {
      if (!ul.hidden) { ul.hidden = true; ul.innerHTML = ''; this._boltKey = ''; this.#syncReadout(); }
      return;
    }
    const key = list.map((b) => b.id).join('|');
    if (key !== this._boltKey) {
      this._boltKey = key;
      // role="list" 必须补：CSS 去掉列表符号后 Safari 不再当列表播报，
      // 而「四颗里的第二颗」正是这一排的意思
      ul.innerHTML = list.map((b) =>
        `<li class="bolt"><i class="bolt-dot"></i><span class="bolt-nm">${shortName(b.name)}</span></li>`).join('');
      ul.setAttribute('aria-label', `${list.length} 颗螺丝`);
      ul.hidden = false;
      this.#syncReadout();
    }
    const items = ul.children;
    list.forEach((b, i) => {
      const li = items[i];
      const s = BOLT[b.state] ? b.state : 'pending';
      if (!li || li.dataset.state === s) return;
      li.dataset.state = s;
      li.querySelector('.bolt-dot').innerHTML = BOLT[s].ico ? icon(BOLT[s].ico) : '';
      li.setAttribute('aria-label', `${b.name}，${BOLT[s].t}`);
    });
  }

  #syncReadout() {
    this.el.readout.hidden = !this._chrome || this.el.bolts.hidden;
    this.#syncSafe();
  }

  // ══════════════ 更多菜单 ══════════════

  toggleMenu() {
    if (this._menu) { this.closeMenu(); return; }
    const toggles = [
      { k: 'theme', ico: 'theme', label: '深色', theme: true },
      { k: 'sound', ico: 'sound', label: '声音' },
    ];
    const read = (t) => (t.theme ? this.state.theme === 'dark' : !!this.state[t.k]);

    const m = document.createElement('div');
    m.className = 'menu';
    m.setAttribute('role', 'menu');
    m.innerHTML = `<button role="menuitem" data-k="help">${icon('help')}<span>怎么操作</span></button>`
      + '<div class="sep"></div>'
      + toggles.map((t) => `<button role="menuitemcheckbox" aria-checked="${read(t)}" data-k="${t.k}">
          ${icon(t.ico)}<span>${t.label}</span><i class="sw"></i></button>`).join('')
      + '<div class="sep"></div>'
      + `<button role="menuitem" data-k="restart">${icon('box')}<span>从头再来</span></button>`;

    this.root.appendChild(m);
    this._menu = m;
    this.el.menu.setAttribute('aria-expanded', 'true');
    m.querySelector('button')?.focus();

    // 上下移焦；Tab 移出菜单即收起
    m.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const bs = [...m.querySelectorAll('button')];
      const i = bs.indexOf(document.activeElement);
      bs[(i + (e.key === 'ArrowDown' ? 1 : bs.length - 1)) % bs.length]?.focus();
    });
    m.addEventListener('focusout', (e) => {
      if (this._menu === m && !m.contains(e.relatedTarget)) this.closeMenu();
    });

    m.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const t = toggles.find((x) => x.k === b.dataset.k);
      if (t) {
        const v = !read(t);
        if (t.theme) this.setTheme(v ? 'dark' : 'light');
        else { this.state[t.k] = v; }
        b.setAttribute('aria-checked', String(v));
        if (t.k === 'sound') this.onSound?.(v);
        return;
      }
      this.closeMenu();
      if (b.dataset.k === 'help') this.guide({ full: true });
      if (b.dataset.k === 'restart') this.#confirmRestart();
    });

    // 点到菜单以外才收起。判定要排除菜单自身：pointerdown 摘掉菜单后，
    // 随后的 click 就落不到开关上了
    this._away = (e) => { if (!m.contains(e.target)) this.closeMenu(); };
    addEventListener('pointerdown', this._away, true);
  }

  closeMenu() {
    if (!this._menu) return;
    // 先置空再移除：移除会同步触发 focusout，那里还会再调一次 closeMenu
    const m = this._menu;
    this._menu = null;
    const hadFocus = m.contains(document.activeElement);
    m.remove();
    this.el.menu.setAttribute('aria-expanded', 'false');
    if (this._away) { removeEventListener('pointerdown', this._away, true); this._away = null; }
    // 焦点若还在菜单里，关掉后送回菜单按钮 —— 否则直接掉到 body
    if (hadFocus) this.el.menu.focus();
  }

  /**
   * 从头再来要过一道确认：装一遍十来分钟，菜单里一次误点不该把它清干净。
   * 工具与脚本仍直接调 onRestart —— 确认只拦人手。
   */
  #confirmRestart() {
    const done = () => this.hideOverlay();
    this.sheet({
      top: true,
      title: '从头再来？',
      lede: '这一遍的进度会清掉，从第一步重新开始。',
      actions: [
        { label: '接着装', on: done },
        { label: '从头再来', kind: 'primary', on: () => { done(); this.onRestart?.(); } },
      ],
      onEsc: done,
    });
  }

  setTheme(mode) {
    const v = mode === 'dark' ? 'dark' : 'light';
    this.state.theme = v;
    this.#paintTheme();
    this.onTheme?.(v);
  }

  #paintTheme() {
    const v = this.state.theme === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = v;
    // 地址栏配色跟着令牌走，不写死两个色值 —— 改 --paper 时这里自己跟上
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim();
    if (bg) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
  }

  // ══════════════ 怎么操作 ══════════════

  /**
   * 第一次进来给四条，右上角菜单里给六条。
   * @param {{full?:boolean, label?:string, onClose?:Function}} o
   */
  guide({ full = false, label = '知道了', onClose } = {}) {
    const rows = GUIDE.filter((r) => full || !r.full);
    const touch = matchMedia('(pointer: coarse)').matches;
    const done = () => { this.hideOverlay(); onClose?.(); };
    this.sheet({
      top: true,                 // 盖在这一步自己的坞上面，收起时把它交还
      title: '怎么操作',
      body: `<div class="guide">${rows.map((r) => `
        <div class="guide-row">
          <div class="guide-k">${guideMark(r)}</div>
          <div class="guide-t">${(touch && r.touch) || r.t}</div>
        </div>`).join('')}</div>`,
      actions: [{ label, kind: 'primary', on: done }],
      onEsc: done,
    });
  }

  // ══════════════ 三维锚定标注 ══════════════

  /**
   * 钉在模型上的一枚圆点，点开摊出一张小签。
   * @param {THREE.Vector3} pos 世界坐标
   * @param {string} text 签上的话
   */
  addSpot(pos, text, { sub, badge = '', ico, color, onClick, active = false } = {}) {
    const el = document.createElement('button');
    el.className = 'spot';
    el.type = 'button';
    el.innerHTML = ico ? icon(ico) : `<span>${badge}</span>`;
    if (color) el.style.color = color;
    el.setAttribute('aria-pressed', String(active));
    el.setAttribute('aria-label', text);

    const lb = document.createElement('div');
    lb.className = 'spot-label';
    lb.innerHTML = `${text}${sub ? `<small>${sub}</small>` : ''}`;
    lb.style.display = active ? '' : 'none';

    this.root.append(el, lb);
    el.inert = this.modalOpen;
    const h = { el, lb, pos: pos.clone(), active };
    el.addEventListener('click', () => {
      h.active = !h.active;
      // 一次只摊开一张：几张签只差几十像素，后点开的还会被更早创建的压在下面
      if (h.active) {
        for (const s of this.spots) {
          if (s === h || !s.active) continue;
          s.active = false;
          s.el.setAttribute('aria-pressed', 'false');
          s.lb.style.display = 'none';
        }
      }
      el.setAttribute('aria-pressed', String(h.active));
      lb.style.display = h.active ? '' : 'none';
      onClick?.(h.active, h);
    });
    this.spots.push(h);
    return h;
  }

  clearSpots() {
    for (const s of this.spots) { s.el.remove(); s.lb.remove(); }
    this.spots = [];
  }

  /** 知识卡片那张纸的矩形变了（换步、折叠、改画幅）—— 下一帧重新量 */
  #dropNoteRect() { this._noteRect = undefined; }

  updateSpots(camera) {
    if (!this.spots.length) return;
    // 知识卡片不透明且层级压过标注，它的实际矩形要当成右边界。
    // 量一次就存着：本函数每帧要写十几个 style，再读布局就是每帧一次强制重排
    if (this._noteRect === undefined) {
      this._noteRect = (!this.el.note.hidden && this.el.note.getClientRects().length)
        ? this.el.note.getBoundingClientRect() : null;
    }
    const nb = this._noteRect;
    /*
     * 标注层级压过底部界面（否则它指的东西被糊掉），代价是也压过底部那排行动 ——
     * 投影落进界面占掉的边里时要藏起来，不然会替按钮把点击吃掉。
     * 藏了不卡步骤：翻页从来不被拦。
     */
    const ceil = this._safe.top + 8;
    const floor = innerHeight - this._safe.bottom - 8;
    const v = new THREE.Vector3();
    for (const s of this.spots) {
      v.copy(s.pos).project(camera);
      const x = (v.x * 0.5 + 0.5) * innerWidth;
      const y = (-v.y * 0.5 + 0.5) * innerHeight;
      const behind = v.z > 1 || y < ceil || y > floor;
      s.el.style.display = behind ? 'none' : '';
      s.lb.style.display = behind || !s.active ? 'none' : '';
      s.el.style.left = `${x}px`; s.el.style.top = `${y}px`;
      // 签贴近右缘时翻到左侧展开，并夹在视口里 —— 不夹，窄屏上这句话会被屏幕边裁掉。
      // 纵向与知识卡片重叠时，右边界收到卡片的左沿
      const limit = (nb && y > nb.top - 24 && y < nb.bottom + 24) ? nb.left - 12 : innerWidth;
      const flip = x > limit - 200;
      s.lb.dataset.side = flip ? 'left' : 'right';
      s.lb.style.left = `${flip ? x - 14 : x + 14}px`;
      s.lb.style.top = `${Math.min(Math.max(y, 56), innerHeight - 72)}px`;
    }
  }

  // ══════════════ 覆盖层 ══════════════

  /*
   * 覆盖层分两层：底层归这一步自己（各种坞），上层归随时盖上来的「怎么操作」。
   * 上层收起时底层原样回来 —— 否则在坞是唯一前进入口的步骤里看一眼帮助，
   * 回来坞就没了。onGone 在层被收起、被同层顶掉或整个清空时调一次：
   * 上层可以被另一个上层直接顶掉，不通知的话它会以为自己还开着。
   */
  showOverlay(html, { veil = true, onMount, onEsc, onGone, top = false } = {}) {
    // 每一层各记各的「从哪儿来的」：收起时焦点要回到打开它的那个控件，而不是掉到 body 上
    const layer = { html, veil, onMount, onEsc, onGone, from: document.activeElement };
    const gone = top ? [this._top] : [this._top, this._base];
    if (top) this._top = layer;
    else { this._base = layer; this._top = null; }
    for (const l of gone) l?.onGone?.();
    return this.#paintOverlay();
  }

  #paintOverlay() {
    const layer = this._top || this._base;
    const o = this.el.overlay;
    if (!layer) return this.#dropOverlay();
    if (o.hidden) this._returnFocus = document.activeElement;
    o.querySelectorAll('.dock').forEach((d) => this._ro.unobserve(d));
    o.hidden = false;
    o.className = `overlay ${layer.veil ? 'veil' : 'bare'}`;
    o.innerHTML = layer.html;
    this._escape = layer.onEsc || null;
    layer.onMount?.(o);
    // 卷盖住了画面，焦点跟着进去；坞不夺焦点，手还在画面上
    if (layer.veil) {
      (o.querySelector('.btn-primary:not([hidden]):not(:disabled)')
        || o.querySelector('button:not([hidden]):not(:disabled)'))?.focus();
    }
    const dock = o.querySelector('.dock');
    if (dock) this._ro.observe(dock);
    // 卷盖住了画面，背后那些还能被 Tab 走到的按钮就不该再存在
    this.#setChromeInert(layer.veil);
    this.#syncSafe();
    return o;
  }

  #dropOverlay() {
    const o = this.el.overlay;
    if (o.hidden) return o;
    o.querySelectorAll('.dock').forEach((d) => this._ro.unobserve(d));
    o.hidden = true;
    o.innerHTML = '';
    this.#setChromeInert(false);
    this._escape = null;
    this.#handBack(this._returnFocus);
    this._returnFocus = null;
    this.#syncSafe();
    return o;
  }

  /**
   * 模态打开时，背后的常驻界面退出无障碍树与 Tab 序列。
   * 封面与三维标注也在名单里：封面化开的那一秒、以及挂在覆盖层之后的标注按钮，
   * 都还够得着 Tab。
   */
  #setChromeInert(on) {
    for (const el of [this.el.topbar, this.el.foot, this.el.readout,
      this.el.note, this.el.noteTab, this.el.cover]) {
      if (el) el.inert = on;
    }
    for (const s of this.spots) s.el.inert = on;
  }

  /**
   * 卷：盖住画面的一页。
   * aria-label 走标题；没有标题的卷自己传 label —— 一个没名字的 dialog，读屏只会报「对话框」。
   */
  sheet({ eyebrow, title, lede, body, actions = [], veil = true, label, top, onMount, onEsc } = {}) {
    const name = label || title || eyebrow;
    const html = `<div class="sheet scroll" role="dialog" aria-modal="true"
      ${name ? `aria-label="${name.replace(/<[^>]+>/g, '')}"` : ''}>
      ${eyebrow ? `<p class="eyebrow">${eyebrow}</p>` : ''}
      ${title ? `<h2 class="sheet-title">${title}</h2>` : ''}
      ${lede ? `<p class="sheet-lede">${lede}</p>` : ''}
      ${body ? `<div class="sheet-body">${body}</div>` : ''}
      ${actions.length ? `<div class="sheet-act">${actions.map(actionHTML).join('')}</div>` : ''}
    </div>`;
    return this.showOverlay(html, {
      veil, onEsc, top,
      onMount: (o) => { bindActions(o, actions); onMount?.(o); },
    });
  }

  /** 坞：停在底部的一排控件，画面完整让出来 */
  dock({ body, actions = [], hint, top, onMount, onEsc } = {}) {
    const html = `<div class="dock">
      ${body || ''}
      ${actions.length ? `<div class="dock-row">${actions.map(actionHTML).join('')}</div>` : ''}
      ${hint ? `<p class="dock-hint">${hint}</p>` : ''}
    </div>`;
    return this.showOverlay(html, {
      veil: false, onEsc, top,
      onMount: (o) => { bindActions(o, actions); onMount?.(o); },
    });
  }

  /**
   * 焦点交还给打开这一层的控件；它可能已经不在了（首次进入的引导卷
   * 由封面打开，收起时封面正在化开）—— 那就交给「下一步」，不掉回 body。
   */
  #handBack(from) {
    if (from?.isConnected && !from.disabled && !from.hidden) { from.focus(); return; }
    if (!this.el.next.hidden && !this.el.next.disabled) this.el.next.focus();
  }

  /** 收起最上面那一层；底下压着的那一步自己的坞会原样回来 */
  hideOverlay() {
    if (this._top) {
      const l = this._top;
      this._top = null;
      this.#paintOverlay();
      l.onGone?.();
      this.#handBack(l.from);
      return;
    }
    const l = this._base;
    this._base = null;
    this.#dropOverlay();
    l?.onGone?.();
  }

  /** 两层一起收干净 —— 翻页时用 */
  closeOverlays() {
    const gone = [this._top, this._base];
    this._top = null;
    this._base = null;
    this.#dropOverlay();
    for (const l of gone) l?.onGone?.();
  }

  /** 设置菜单摊着 —— 此时方向键在菜单里用，不该在背后翻页 */
  get menuOpen() { return !!this._menu; }

  get overlayOpen() { return !this.el.overlay.hidden; }

  /** 盖住画面的那一种。此时方向键不该在背后翻页 */
  get modalOpen() { return this.overlayOpen && this.el.overlay.classList.contains('veil'); }

  /**
   * 整层界面退场，只剩车 —— 封面还挡着的那一段走这一档。
   * 两枚翻页各自 fixed 在屏幕两侧，也要一并收起。
   */
  showChrome(v) {
    this._chrome = !!v;
    this.el.topbar.hidden = !v;
    this.el.foot.hidden = !v;
    this.el.prev.hidden = !v;
    this.el.next.hidden = !v;
    if (!v) { this.setNote(null); this.clearSpots(); }
    this.#syncReadout();
  }

  get navVisible() { return !this.el.foot.hidden; }
}
