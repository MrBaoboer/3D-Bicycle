/**
 * 线上对账：三处地址发的是不是同一份产物。
 *
 *   npm run live
 *
 * 判据是入口 JS 的**内容哈希文件名**（`assets/index-XXXX.js`）——
 * 它由构建按内容算出，几处一样才是同一份产物。
 * 只看「打得开 / 返回 200」是不够的：曾经线上主地址整整落后一个版本，
 * 而两边都返回 200，标题也一样，肉眼看不出来。
 *
 * 为什么需要这一条：三处是两条独立的发布链路加一条别名，
 * 一条慢一步、一条挂了、或者域名指错了部署，都不会有人报错。
 * 主地址那条尤其要盯 —— 它不在 Vercel 项目的域名表里，不会自动跟随，
 * 靠 .github/workflows/vercel-alias.yml 发一次指一次，那条工作流没跑就会掉队。
 */

const SITES = [
  ['Vercel 主', 'https://3d-bicycle.vercel.app/'],
  ['Vercel 自带', 'https://3d-bicycle-tau.vercel.app/'],
  ['GitHub Pages', 'https://mrbaoboer.github.io/3D-Bicycle/'],
];

/** 入口 JS 的内容哈希文件名；取不到就返回 null（页面结构变了或根本没发出来） */
async function buildOf(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) return { status: res.status, hash: null };
  const html = await res.text();
  const m = html.match(/assets\/index-([A-Za-z0-9_-]+)\.js/);
  return { status: res.status, hash: m ? m[1] : null };
}

const rows = [];
for (const [name, url] of SITES) {
  try {
    const { status, hash } = await buildOf(url);
    rows.push({ name, url, status, hash });
  } catch (e) {
    rows.push({ name, url, status: 0, hash: null, err: String(e.message || e) });
  }
}

/** 终端里中日韩字符占两列，按字符数补空格会错位 */
const WIDE = /[⺀-鿿가-힣！-｠]/;
const width = (s) => [...s].reduce((n, c) => n + (WIDE.test(c) ? 2 : 1), 0);

const w = Math.max(...rows.map((r) => width(r.name)));
for (const r of rows) {
  const pad = ' '.repeat(w - width(r.name));
  console.log(`${r.name}${pad}  HTTP ${r.status || '—'}  ${r.hash ?? (r.err || '取不到入口 JS')}  ${r.url}`);
}

const hashes = [...new Set(rows.map((r) => r.hash))];
const bad = rows.filter((r) => r.status !== 200 || !r.hash);
if (bad.length) {
  console.error(`\n✗ ${bad.map((r) => r.name).join('、')} 没有正常发出产物`);
  process.exit(1);
}
if (hashes.length > 1) {
  console.error('\n✗ 发的不是同一份产物 —— 有一条掉队了');
  console.error('  只有「Vercel 主」对不上：别名没跟上，跑 npm run alias 立刻补；');
  console.error('    要它以后自动跟，去配 VERCEL_TOKEN，见 .github/workflows/vercel-alias.yml');
  console.error('  「Vercel 自带」也对不上：构建那一路的问题，');
  console.error('    看 https://vercel.com/masterbao66s-projects/3d-bicycle');
  console.error('  「GitHub Pages」对不上：看 .github/workflows/deploy.yml 的运行记录');
  process.exit(1);
}
console.log(`\n✓ 三处同步，都是 ${hashes[0]}`);
