/**
 * 从 GLB 的 accessor min/max 直接取每个网格节点的包围盒 —— 不解二进制。
 * 再按位置/尺寸把匿名的 Object_NN 归类成自行车零件。
 */
import { readFileSync } from 'node:fs';

const buf = readFileSync(process.argv[2]);
let off = 12;
let g = null;
const total = buf.readUInt32LE(8);
while (off < total) {
  const len = buf.readUInt32LE(off);
  const type = buf.readUInt32LE(off + 4);
  if (type === 0x4e4f534a) g = JSON.parse(new TextDecoder().decode(buf.subarray(off + 8, off + 8 + len)));
  off += 8 + len + ((4 - (len % 4)) % 4);
}

const { nodes, meshes, accessors } = g;

// 父级变换（Sketchfab 一般在这里塞一个 Y-up 修正）
for (const n of nodes) {
  if (n.matrix || n.rotation || n.scale || n.translation) {
    console.log(`节点变换 "${n.name}":`,
      JSON.stringify({ m: n.matrix, r: n.rotation, s: n.scale, t: n.translation }));
  }
}

const items = [];
const walk = (i) => {
  const n = nodes[i];
  if (n.mesh !== undefined) {
    const p = meshes[n.mesh].primitives[0];
    const acc = accessors[p.attributes.POSITION];
    const idx = p.indices !== undefined ? accessors[p.indices] : acc;
    const [x0, y0, z0] = acc.min;
    const [x1, y1, z1] = acc.max;
    items.push({
      name: n.name, mat: p.material,
      tri: Math.floor(idx.count / 3),
      min: [x0, y0, z0], max: [x1, y1, z1],
      c: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2],
      size: [x1 - x0, y1 - y0, z1 - z0],
    });
  }
  for (const c of n.children || []) walk(c);
};
for (const r of g.scenes[0].nodes) walk(r);

// 整车包围盒
const all = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
for (const it of items) for (let k = 0; k < 3; k++) {
  all.min[k] = Math.min(all.min[k], it.min[k]);
  all.max[k] = Math.max(all.max[k], it.max[k]);
}
const span = all.max.map((v, k) => v - all.min[k]);
const f2 = (n) => n.toFixed(2).padStart(7);
console.log(`\n整车包围盒  min=[${all.min.map(f2)}]  max=[${all.max.map(f2)}]`);
console.log(`尺寸 X=${span[0].toFixed(2)} Y=${span[1].toFixed(2)} Z=${span[2].toFixed(2)}`);

// 最长轴 = 轴距方向；第二长 = 高度；最短 = 车宽
const axes = span.map((v, i) => ({ i, v })).sort((a, b) => b.v - a.v);
const [AX, AY, AZ] = [axes[0].i, axes[1].i, axes[2].i];  // 长 / 高 / 宽
console.log(`推断：轴距轴=${'XYZ'[AX]}  高度轴=${'XYZ'[AY]}  车宽轴=${'XYZ'[AZ]}`);
console.log(`若整车按 1.8 m 长计，单位换算 ≈ ${(1800 / span[AX]).toFixed(1)} mm/单位\n`);

// 按"长轴位置"分前后，按"宽轴位置"分左右
const lo = all.min[AX], hi = all.max[AX];
const bandOf = (v) => (v - lo) / (hi - lo);
const wMid = (all.min[AZ] + all.max[AZ]) / 2;

items.sort((a, b) => a.c[AX] - b.c[AX]);
console.log('前后位置(0=一端 1=另一端) | 左右 | 面数 | 材质 | 尺寸(长×高×宽) | 名字');
console.log('─'.repeat(96));
for (const it of items) {
  const side = Math.abs(it.c[AZ] - wMid) < span[AZ] * 0.06 ? ' 中 '
    : it.c[AZ] > wMid ? ' 右 ' : ' 左 ';
  console.log(
    `${bandOf(it.c[AX]).toFixed(3)}  |${side}| ${String(it.tri).padStart(6)} | m${String(it.mat).padStart(2)} `
    + `| ${it.size.map((s) => s.toFixed(2).padStart(6)).join(' ')} | ${it.name}`,
  );
}

// 材质分组：同材质的往往是同类零件
const byMat = new Map();
for (const it of items) {
  if (!byMat.has(it.mat)) byMat.set(it.mat, []);
  byMat.get(it.mat).push(it);
}
console.log('\n── 按材质分组 ──');
for (const [m, list] of [...byMat].sort((a, b) => a[0] - b[0])) {
  const nm = g.materials[m]?.name || '(无名)';
  console.log(`m${String(m).padStart(2)} "${nm}"  ${list.length} 件, ${list.reduce((n, x) => n + x.tri, 0).toLocaleString()} 面`);
}
