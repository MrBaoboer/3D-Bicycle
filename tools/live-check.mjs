/**
 * 线上对账：两处地址发的是不是同一份产物。判据是入口 JS 的内容哈希文件名
 *（assets/index-XXXX.js），两处一致才算同一份。只看返回 200 不够：落后一个
 * 版本的部署照样 200、标题也一样。两条发布链路各走各的，一条掉队不会有
 * 任何报错。见 docs/DEVELOPMENT.md「部署」。
 *
 *   npm run live
 */

const SITES = [
  ['Vercel', 'https://build-bike.vercel.app/'],
  ['GitHub Pages', 'https://mrbaoboer.github.io/3D-Bike-Builder/'],
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
  console.error('  「Vercel」对不上：看 https://vercel.com/masterbao66s-projects/3d-bicycle');
  console.error('  「GitHub Pages」对不上：看 .github/workflows/deploy.yml 的运行记录');
  process.exit(1);
}
console.log(`\n✓ 两处同步，都是 ${hashes[0]}`);
