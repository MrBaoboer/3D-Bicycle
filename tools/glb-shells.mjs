/**
 * 连通块分析：把 GLB 里的三角形按"共享顶点"并查集分组。
 * 焊死的网格只会得到一两个巨块；建模时各件独立的会得到几十上百个壳。
 * 这一条决定「能不能程序化拆件」。
 */
import { readFileSync } from 'node:fs';

const buf = readFileSync(process.argv[2]);
let off = 12; let g = null; let bin = null;
const total = buf.readUInt32LE(8);
while (off < total) {
  const len = buf.readUInt32LE(off);
  const type = buf.readUInt32LE(off + 4);
  const data = buf.subarray(off + 8, off + 8 + len);
  if (type === 0x4e4f534a) g = JSON.parse(new TextDecoder().decode(data));
  if (type === 0x004e4942) bin = data;
  off += 8 + len + ((4 - (len % 4)) % 4);
}

const CT = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function read(ai) {
  const a = g.accessors[ai];
  const bv = g.bufferViews[a.bufferView];
  const T = CT[a.componentType];
  const n = NC[a.type];
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const stride = bv.byteStride;
  if (stride && stride !== n * T.BYTES_PER_ELEMENT) {
    const out = new T(a.count * n);
    for (let i = 0; i < a.count; i++) {
      const src = new T(bin.buffer, bin.byteOffset + base + i * stride, n);
      out.set(src, i * n);
    }
    return out;
  }
  return new T(bin.buffer, bin.byteOffset + base, a.count * n);
}

// 收集全部 primitive
const prims = [];
for (const m of g.meshes) for (const p of m.primitives) prims.push(p);

let shellTotal = 0;
const shells = [];

for (const [pi, p] of prims.entries()) {
  const pos = read(p.attributes.POSITION);
  const idx = p.indices !== undefined ? read(p.indices) : null;
  const nTri = idx ? idx.length / 3 : pos.length / 9;
  const nVert = pos.length / 3;

  // 位置去重（量化到 1e-5）—— 索引不同但坐标相同的顶点要算作连着
  const key = new Map();
  const canon = new Int32Array(nVert);
  const q = (v) => Math.round(v * 100000);
  for (let i = 0; i < nVert; i++) {
    const k = `${q(pos[i * 3])},${q(pos[i * 3 + 1])},${q(pos[i * 3 + 2])}`;
    let c = key.get(k);
    if (c === undefined) { c = i; key.set(k, i); }
    canon[i] = c;
  }

  // 并查集
  const par = new Int32Array(nVert);
  for (let i = 0; i < nVert; i++) par[i] = canon[i];
  const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  const uni = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) par[ra] = rb; };

  for (let t = 0; t < nTri; t++) {
    const a = idx ? idx[t * 3] : t * 3;
    const b = idx ? idx[t * 3 + 1] : t * 3 + 1;
    const c = idx ? idx[t * 3 + 2] : t * 3 + 2;
    uni(canon[a], canon[b]); uni(canon[b], canon[c]);
  }

  // 每块的三角数与包围盒
  const group = new Map();
  for (let t = 0; t < nTri; t++) {
    const a = idx ? idx[t * 3] : t * 3;
    const r = find(canon[a]);
    let s = group.get(r);
    if (!s) { s = { tri: 0, min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] }; group.set(r, s); }
    s.tri++;
    for (const v of [a, idx ? idx[t * 3 + 1] : t * 3 + 1, idx ? idx[t * 3 + 2] : t * 3 + 2]) {
      for (let k = 0; k < 3; k++) {
        const val = pos[v * 3 + k];
        if (val < s.min[k]) s.min[k] = val;
        if (val > s.max[k]) s.max[k] = val;
      }
    }
  }
  shellTotal += group.size;
  for (const s of group.values()) shells.push({ prim: pi, ...s });
  console.log(`primitive #${pi}: ${nTri.toLocaleString()} 三角形, ${nVert.toLocaleString()} 顶点 → **${group.size} 个连通块**`);
}

shells.sort((a, b) => b.tri - a.tri);
console.log(`\n合计 ${shellTotal} 个连通块\n`);
console.log('  三角形 | 尺寸 X×Y×Z | 中心 X,Y,Z');
console.log('─'.repeat(70));
for (const s of shells.slice(0, 40)) {
  const size = s.max.map((v, k) => (v - s.min[k]).toFixed(3).padStart(6));
  const c = s.max.map((v, k) => ((v + s.min[k]) / 2).toFixed(3).padStart(7));
  console.log(`${String(s.tri).padStart(8)} | ${size.join(' ')} | ${c.join(' ')}`);
}
if (shells.length > 40) {
  const rest = shells.slice(40);
  console.log(`… 另有 ${rest.length} 块，合计 ${rest.reduce((n, s) => n + s.tri, 0).toLocaleString()} 三角形`);
}
