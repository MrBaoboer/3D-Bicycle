/**
 * 解 GLB 容器，只读 JSON 块 —— 不依赖 three，不需要 DOM。
 * GLB: 12 字节头（magic/version/length）+ 若干块（length/type/data）。
 */
import { readFileSync } from 'node:fs';

const file = process.argv[2];
const buf = readFileSync(file);

const magic = buf.readUInt32LE(0);
if (magic !== 0x46546c67) throw new Error(`不是 GLB：magic=0x${magic.toString(16)}`);
const total = buf.readUInt32LE(8);

let off = 12;
let json = null;
let binLen = 0;
while (off < total) {
  const len = buf.readUInt32LE(off);
  const type = buf.readUInt32LE(off + 4);
  const data = buf.subarray(off + 8, off + 8 + len);
  if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(data));
  if (type === 0x004e4942) binLen = len;
  off += 8 + len + ((4 - (len % 4)) % 4);
}

const g = json;
const nodes = g.nodes || [];
const meshes = g.meshes || [];
const accessors = g.accessors || [];

const triOf = (mesh) => (mesh.primitives || []).reduce((n, p) => {
  const a = p.indices !== undefined ? accessors[p.indices] : accessors[p.attributes.POSITION];
  return n + Math.floor((a?.count || 0) / 3);
}, 0);

console.log(`\n═══ ${file.split(/[\\/]/).pop()} ═══`);
console.log(`GLB ${(total / 1048576).toFixed(2)} MB（BIN ${(binLen / 1048576).toFixed(2)} MB）`);
console.log(`generator: ${g.asset?.generator || '未标'}   glTF ${g.asset?.version}`);
console.log(`节点 ${nodes.length} · 网格 ${meshes.length} · 材质 ${(g.materials || []).length} · `
  + `贴图 ${(g.images || []).length} · 场景 ${(g.scenes || []).length}`);
if (g.extensionsUsed) console.log(`扩展: ${g.extensionsUsed.join(', ')}`);

// ── 节点树 ──
const childOf = new Set();
for (const n of nodes) for (const c of n.children || []) childOf.add(c);
const roots = (g.scenes?.[0]?.nodes) || nodes.map((_, i) => i).filter((i) => !childOf.has(i));

let totalTri = 0;
const leaves = [];
const walk = (i, depth) => {
  const n = nodes[i];
  const m = n.mesh !== undefined ? meshes[n.mesh] : null;
  const tri = m ? triOf(m) : 0;
  totalTri += tri;
  const hasXform = !!(n.translation || n.rotation || n.scale || n.matrix);
  const tag = m ? `  [${tri.toLocaleString()} 三角形, ${m.primitives.length} prim]` : '';
  console.log(`${'  '.repeat(depth)}${depth ? '└ ' : ''}${n.name ?? `(无名 #${i})`}`
    + `${hasXform ? ' *有自身变换*' : ''}${tag}`);
  if (m) leaves.push({ name: n.name ?? `#${i}`, tri });
  for (const c of n.children || []) walk(c, depth + 1);
};

console.log('\n── 节点树 ──');
for (const r of roots) walk(r, 0);

console.log(`\n合计 ${totalTri.toLocaleString()} 三角形，${leaves.length} 个带网格的节点`);
console.log('\n── 按面数排序的网格节点 ──');
leaves.sort((a, b) => b.tri - a.tri)
  .forEach((l) => console.log(`  ${String(l.tri).padStart(8)}  ${l.name}`));
