/**
 * 全局状态，分两类：
 *   偏好 PREFS —— 深色、声音这些设备上的使用习惯，跨会话保留；
 *   进度 RUN   —— 装到哪一步、哪几颗拧到位，**每次打开都从头开始**。
 * 装一遍车十来分钟，不值得为半截存档加一次「上次停在……」的开场提问。
 */

const KEY = 'bike.v1.state';

/** 跨会话保留。theme 留空表示还没手动选过 —— 首次跟随系统偏好 */
const PREFS = {
  theme: '',
  sound: true,
  primed: false,          // 是否看过「怎么操作」
};

/** 这一遍的进度，刷新即归零 */
const RUN = {
  installed: {},          // { 'front-wheel': true, ... }
  fastened: {},           // { 'pedal-left-spindle': true, ... } 拧到底了
  wrongThread: 0,         // 左脚踏拧反的次数 —— 结尾自检要提
  crossOrderOk: null,     // 面盖是否按对角顺序拧的
};

/** 取一份全新的进度。嵌套对象要逐层拷：浅拷贝会让模板被就地改脏，「从头再来」清不干净 */
const freshRun = () => Object.fromEntries(
  Object.entries(RUN).map(([k, v]) => [k, v && typeof v === 'object' ? { ...v } : v]),
);

function load() {
  const s = { ...PREFS, ...freshRun() };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      // 只收偏好。进度一律用默认值 —— 存档里若还留着旧版本的进度，忽略即可
      for (const k of Object.keys(PREFS)) {
        if (saved[k] !== undefined) s[k] = saved[k];
      }
    }
  } catch { /* 隐私模式：用默认值 */ }
  // 没选过就跟随系统。加载期封面靠媒体查询取色，就绪后两边必须一致，
  // 否则系统深色的用户会看着封面从深翻成浅
  if (s.theme !== 'dark' && s.theme !== 'light') {
    s.theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return s;
}

const listeners = new Set();
const PREF_KEYS = new Set(Object.keys(PREFS));

/**
 * 只有偏好落盘：进度下次打开不再读取，写它没有用处。
 * 写盘合并到微任务里 —— 拧螺丝时进度每帧都变，不合并就每帧写一次盘。
 */
let queued = false;
export const state = new Proxy(load(), {
  set(t, k, v) {
    if (t[k] === v) return true;
    t[k] = v;
    for (const fn of listeners) fn(k, v, t);
    if (!PREF_KEYS.has(k) || queued) return true;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      const prefs = {};
      for (const key of PREF_KEYS) prefs[key] = t[key];
      try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* 隐私模式下静默 */ }
    });
    return true;
  },
});

export function onStateChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 从头再来：这一遍的进度归零，偏好一概不动 */
export function resetRun() {
  for (const [k, v] of Object.entries(freshRun())) state[k] = v;
}
