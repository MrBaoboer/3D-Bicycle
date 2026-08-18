/** 装配树概览：折叠掉叶子 Shape_*，按组汇总面数与件数 */
import { readFileSync } from 'node:fs';

const buf = readFileSync(process.argv[2]);
const maxDepth = Number(process.argv[3] || 4);
let off = 12; let g = null;
const total = buf.readUInt32LE(8);
while (off < total) {
  const len = buf.readUInt32LE(off);
  const t = buf.readUInt32LE(off + 4);
  if (t === 0x4e4f534a) g = JSON.parse(new TextDecoder().decode(buf.subarray(off + 8, off + 8 + len)));
  off += 8 + len + ((4 - (len % 4)) % 4);
}
const { nodes, meshes, accessors } = g;
const triOf = (mi) => meshes[mi].primitives.reduce((n, p) => {
  const a = p.indices !== undefined ? accessors[p.indices] : accessors[p.attributes.POSITION];
  return n + Math.floor(a.count / 3);
}, 0);

// 每棵子树的面数与叶子数
const memo = new Map();
function agg(i) {
  if (memo.has(i)) return memo.get(i);
  const n = nodes[i];
  let tri = n.mesh !== undefined ? triOf(n.mesh) : 0;
  let leaves = n.mesh !== undefined ? 1 : 0;
  for (const c of n.children || []) { const r = agg(c); tri += r.tri; leaves += r.leaves; }
  const r = { tri, leaves };
  memo.set(i, r);
  return r;
}

const print = (i, d) => {
  const n = nodes[i];
  const { tri, leaves } = agg(i);
  if (/^Shape_/.test(n.name || '')) return;
  const kids = (n.children || []).filter((c) => !/^Shape_/.test(nodes[c].name || ''));
  const pad = '  '.repeat(d);
  console.log(`${pad}${(n.name || `#${i}`).padEnd(52 - d * 2)} ${String(tri).padStart(7)} 面  ${String(leaves).padStart(3)} 件`);
  if (d >= maxDepth) {
    if (kids.length) console.log(`${pad}  … 还有 ${kids.length} 个子组`);
    return;
  }
  for (const c of kids) print(c, d + 1);
};

console.log('零件组'.padEnd(50) + '   面数   件数');
console.log('─'.repeat(72));
for (const r of g.scenes[0].nodes) print(r, 0);

const t = g.scenes[0].nodes.reduce((s, i) => s + agg(i).tri, 0);
const l = g.scenes[0].nodes.reduce((s, i) => s + agg(i).leaves, 0);
console.log('─'.repeat(72));
console.log(`合计 ${t.toLocaleString()} 面 / ${l} 个网格件 / ${nodes.length} 个节点`);
