/**
 * 全局状态。
 *
 * 分两类，界线很清楚：
 *   偏好 PREFS —— 深色、声音、字幕这些「这台设备上我习惯怎么用」，跨会话留着；
 *   进度 RUN   —— 装到哪一步、哪几颗拧到位了，**每次打开都从头开始**。
 *
 * 装一遍车十来分钟。半截存档换来的是一次「你上次停在……」的提问，
 * 而这个问题在你刚打开页面、还没想好要不要动手的时候，是纯粹的干扰。
 */

const KEY = 'bike.v1.state';

/** 跨会话保留 */
const PREFS = {
  theme: 'light',
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

/**
 * 取一份全新的进度。
 *
 * **必须现拷一层。** `{ ...RUN }` 只复制引用，于是 `state.installed` 一开始
 * 就是 `RUN.installed` 本人；哪一处顺手写了 `state.installed[id] = true`
 * （原来 slide 到位时正是这么写的），这份模板就被就地改脏了，
 * 之后每一次「从头再来」都从脏模板复制 —— 装过的件永远清不掉。
 */
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
  if (s.theme !== 'dark') s.theme = 'light';
  return s;
}

const listeners = new Set();
const PREF_KEYS = new Set(Object.keys(PREFS));

/**
 * 只有偏好落盘。进度本来就「下次打开一律不再读取」，写它没有任何用处。
 * 顺带解决一个实际问题：拧螺丝时进度每帧都在变，不合并的话每帧写一次盘。
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
