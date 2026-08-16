/**
 * 图标
 *
 * 同一套线稿：24 格、1.25 描边、圆头圆角、只吃 currentColor，颜色与大小由外层决定。
 * 不用 emoji —— 每个系统画得都不一样，尺寸也压不住这套界面。
 *
 * 只出这一版说明书用得上的那些。加图标之前先问一句：现有的哪个说不清这件事？
 */

const S = {
  // ── 导航与状态 ──
  'arrow-left':  '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
  'arrow-right': '<path d="M9.5 5.5 16 12l-6.5 6.5"/>',
  menu:  '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  check: '<path d="M5 12.6 9.4 17 19 7.4"/>',
  warn:  '<path d="M12 3.8 21.4 19.6H2.6z"/><path d="M12 9.6v4.4"/><circle cx="12" cy="17" r=".9"/>',

  // ── 手势：画面怎么动、零件怎么动 ──
  drag:   '<path d="M3.6 12h4M16.4 12h4"/><path d="M6.6 9 3.6 12l3 3M17.4 9l3 3-3 3"/><circle cx="12" cy="12" r="2.4"/>',
  rotate: '<path d="M17.2 6.8A7.4 7.4 0 1 1 19.4 12"/><path d="M16.9 9.5 19.4 12l2.5-2.5"/>',

  // ── 工具与紧固 ──
  screw:  '<path d="M8.6 3.8h6.8v3.4H8.6z"/><path d="M9.8 7.2h4.4v8.2L12 20.4l-2.2-5z"/><path d="M9.8 10.4h4.4M9.8 13.2h4.4"/>',
  wrench: '<path d="M17.5 2.8A4.7 4.7 0 0 0 13.1 10.2l-6.4 6.4a1.9 1.9 0 0 0 2.7 2.7l6.4-6.4a4.7 4.7 0 0 0 5.8-6L18 6.4z"/>',
  torque: '<path d="M4.4 17.4a8.6 8.6 0 1 1 15.2 0"/><path d="M12.6 15.3 15.9 9.8"/><circle cx="12" cy="16.4" r="1.2"/>',

  // ── 设置与说明 ──
  sound: '<path d="M5 9.5h3l4-3.2v11.4l-4-3.2H5z"/><path d="M15.5 9.4a3.6 3.6 0 0 1 0 5.2"/><path d="M17.9 7a7 7 0 0 1 0 10"/>',
  theme: '<circle cx="12" cy="12" r="8.2"/>'
       + '<path d="M12 3.8v16.4M14.6 5.4 12 8M17.6 7.4 12 13M18.6 10.6 12 17.2M18.4 14.6 14.6 18.4"/>',
  help:  '<circle cx="12" cy="12" r="8.6"/><path d="M9.7 9.6a2.4 2.4 0 1 1 2.3 2.9v1.6"/><circle cx="12" cy="16.4" r=".9"/>',

  // ── 从头再来 ──
  box:  '<path d="M3.4 7.6 12 3.4l8.6 4.2v8.8L12 20.6l-8.6-4.2z"/><path d="M3.4 7.6 12 11.8l8.6-4.2M12 11.8v8.8"/>'
      + '<path d="M7.7 5.5 16.3 9.7"/>',
};

/**
 * 图标的 HTML 片段。尺寸随外层 font-size 走。
 * @param {keyof S} name
 * @param {string} [cls] 追加的类名
 */
export function icon(name, cls = '') {
  const d = S[name];
  if (!d) return '';
  return `<svg class="ico${cls ? ` ${cls}` : ''}" viewBox="0 0 24 24" stroke-width="1.25"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}
