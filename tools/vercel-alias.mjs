/**
 * 把主地址 3d-bicycle.vercel.app 指到本次提交的生产部署。
 *
 *   npm run alias            # 本地手工补一次，走本机已登录的 CLI
 *   VERCEL_TOKEN=... npm run alias
 *
 * 为什么要有这条脚本 —— 主地址进不了本项目的域名表：
 *
 *   vercel domains add 3d-bicycle.vercel.app 3d-bicycle
 *   → alias_conflict: already assigned to another project (400)
 *
 * `--force` 移不动，把别名整条删掉再加也是同一句报错，所以不是别名占着自己，
 * 是这个名字在 Vercel 那边另有归属记录。能做的只剩「别名」这一层：
 * 别名指的是某一个具体部署，不跟着生产走 —— 发一次得指一次，这就是那个人。
 * 详细原委见 docs/DEVELOPMENT.md。
 *
 * 两条路：CI 里有 VERCEL_TOKEN，走 REST API，能按 commit SHA 等到那次部署；
 * 本地没有 token，走本机已登录的 vercel CLI，取最新那条生产部署。
 */

import { spawnSync } from 'node:child_process';

const API = 'https://api.vercel.com';

const TOKEN = process.env.VERCEL_TOKEN;
const TEAM = process.env.VERCEL_TEAM_ID || 'team_vaeHo1nlj6zTqPe3ihjhvo5D';
const PROJECT = process.env.VERCEL_PROJECT_ID || 'prj_MxEdWddiIvyZbNfvupbHKshaq9eY';
const SCOPE = process.env.VERCEL_SCOPE || 'masterbao66s-projects';
const PROJECT_NAME = process.env.VERCEL_PROJECT_NAME || '3d-bicycle';
const ALIAS = process.env.VERCEL_ALIAS || '3d-bicycle.vercel.app';

/** 只认这个 commit 的部署；留空表示「拿最新那条」。手工补时用不上 */
const WANT_SHA = (process.env.MATCH_SHA || '').trim();

/** Vercel 那边排队加构建一分多钟，给到十分钟够宽 */
const TIMEOUT_MS = Number(process.env.ALIAS_TIMEOUT_MS || 10 * 60 * 1000);
const POLL_MS = 10_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── REST API 那条路（CI） ───────────────────────────────────────────────

async function api(path, init = {}) {
  const url = `${API}${path}${path.includes('?') ? '&' : '?'}teamId=${TEAM}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  // 把 Vercel 的原话带出来，比「请求失败」有用得多
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${path} → ${body?.error?.message || `HTTP ${res.status}`}`);
  return body;
}

/** v6 叫 state，别处叫 readyState —— 两个都认 */
const stateOf = (d) => d.readyState || d.state;

/** 等到目标部署 READY。接口按创建时间倒序返回，第一条就是最新的 */
async function targetViaApi() {
  const deadline = Date.now() + TIMEOUT_MS;
  let said = '';
  for (;;) {
    const { deployments = [] } = await api(
      `/v6/deployments?projectId=${PROJECT}&target=production&limit=20`,
    );
    const d = WANT_SHA
      ? deployments.find((x) => x.meta?.githubCommitSha === WANT_SHA)
      : deployments.find((x) => stateOf(x) === 'READY');
    const state = d && stateOf(d);

    if (d && state === 'READY') return { id: d.uid, url: `https://${d.url}` };
    // 构建自己就没成，指过去只会把一个坏版本挂到主地址上
    if (state === 'ERROR' || state === 'CANCELED') {
      throw new Error(`那次生产部署是 ${state}，没有可指的产物 —— 先看构建日志`);
    }
    if (Date.now() >= deadline) {
      const wanted = WANT_SHA ? `${WANT_SHA.slice(0, 7)} 的生产部署` : 'READY 的生产部署';
      throw new Error(`等了 ${Math.round(TIMEOUT_MS / 60000)} 分钟没等到${wanted}（当前 ${state || '还没出现'}）`);
    }

    const now = state || '还没出现';
    if (now !== said) {
      console.log(`等生产部署… ${now}`);
      said = now;
    }
    await sleep(POLL_MS);
  }
}

const pointViaApi = (t) =>
  api(`/v2/deployments/${t.id}/aliases`, { method: 'POST', body: JSON.stringify({ alias: ALIAS }) });

// ── CLI 那条路（本地手工补） ─────────────────────────────────────────────

function vercel(...args) {
  // 拼成一整条命令再交给 shell：Windows 上 npx 是 .cmd，不走 shell 起不来，
  // 而带 shell 又传 args 数组会触发 DEP0190。这里的词都是写死的或正则抠出来的
  // URL，没有外来输入，拼串是安全的。
  const r = spawnSync(['npx', 'vercel', ...args, '--scope', SCOPE].join(' '), {
    encoding: 'utf8',
    shell: true,
  });
  if (r.error) throw r.error;
  // CLI 把表格打在 stderr 上，两股都得收
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  if (r.status !== 0) {
    const hint = /not logged in|credentials|forbidden/i.test(out) ? '（先跑 npx vercel login）' : '';
    throw new Error(`vercel ${args[0]} 没跑通${hint}：${out.trim()}`);
  }
  return out;
}

function targetViaCli() {
  // --environment production 只留生产那些，省得再去认「Production」这个词
  const table = vercel('ls', PROJECT_NAME, '--environment', 'production');
  // 表格新的在上；只认已经 Ready 的那条 —— 还在构建的指过去是空的
  const line = table.split('\n').find((l) => l.includes('Ready') && l.includes('.vercel.app'));
  const url = line?.match(/https:\/\/[a-z0-9.-]+\.vercel\.app/)?.[0];
  if (!url) throw new Error('没在 vercel ls 的输出里找到 Ready 的生产部署');
  return { id: null, url };
}

const pointViaCli = (t) => vercel('alias', 'set', t.url, ALIAS);

// ── 校验 ────────────────────────────────────────────────────────────────

/**
 * 入口 JS 的内容哈希文件名，取不到返回 null。
 * 和 tools/live-check.mjs 同一个判据：它由构建按内容算出，一样才是同一份产物。
 */
async function buildOf(url) {
  // 边缘可能还存着上一版的 index.html，绕开缓存再问一次
  const res = await fetch(`${url}/?_=${Date.now()}`, { cache: 'no-store', redirect: 'follow' });
  if (!res.ok) return null;
  return (await res.text()).match(/assets\/index-([A-Za-z0-9_-]+)\.js/)?.[1] ?? null;
}

/** 别名生效到边缘要几秒，给它几次机会 */
async function sameBuild(want) {
  for (let i = 0; i < 6; i++) {
    if ((await buildOf(`https://${ALIAS}`)) === want) return true;
    await sleep(5000);
  }
  return false;
}

// ── 跑起来 ──────────────────────────────────────────────────────────────

const how = TOKEN ? 'API' : 'CLI';
const target = TOKEN ? await targetViaApi() : targetViaCli();
console.log(`目标部署（走 ${how}）：${target.url}`);

if (TOKEN) await pointViaApi(target);
else pointViaCli(target);

// 写接口返回 200 不等于主地址真的发这一份。这条脚本要是骗了人，
// 下一个发现的就是访客 —— 所以指完再比一次入口 JS 的内容哈希。
const want = await buildOf(target.url);
if (!want) {
  console.error(`✗ ${target.url} 取不到入口 JS，没法校验 —— 页面结构变了？`);
  process.exit(1);
}
if (!(await sameBuild(want))) {
  console.error(`✗ ${ALIAS} 指过去了，但发的不是 ${want} —— 别名没落到 ${target.url}`);
  process.exit(1);
}

console.log(`✓ ${ALIAS} → ${target.url}（入口 JS ${want}）`);
