/**
 * 逐张贴图对比：原件的 JPEG/PNG 尺寸 vs KTX2 变体的尺寸与 Basis 模式。
 * KTX2 有两种模式，画质差一个档：
 *   ETC1S（supercompression = BasisLZ 1）—— 小，块状伪影明显
 *   UASTC（supercompression = Zstd 2，DFD colorModel 166）—— 大，接近原图
 */
import { readFileSync } from 'node:fs';

function parseGLB(file) {
  const buf = readFileSync(file);
  let off = 12; let g = null; let bin = null;
  const total = buf.readUInt32LE(8);
  while (off < total) {
    const len = buf.readUInt32LE(off);
    const t = buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (t === 0x4e4f534a) g = JSON.parse(new TextDecoder().decode(data));
    if (t === 0x004e4942) bin = data;
    off += 8 + len + ((4 - (len % 4)) % 4);
  }
  return { g, bin, total };
}

const viewOf = (g, bin, bv) => {
  const v = g.bufferViews[bv];
  return bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength);
};

/** PNG IHDR / JPEG SOF 里读宽高 */
function imageSize(b) {
  if (b[0] === 0x89 && b[1] === 0x50) return { fmt: 'PNG', w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i < b.length - 9) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { fmt: 'JPEG', h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
      }
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  return { fmt: '?', w: 0, h: 0 };
}

const SC = { 0: '无', 1: 'BasisLZ → ETC1S', 2: 'Zstd', 3: 'ZLIB' };
const CM = { 163: 'ETC1S', 166: 'UASTC' };

/*
 * KTX2 头（12 字节标识之后，全部小端 uint32）：
 *   12 vkFormat · 16 typeSize · 20 pixelWidth · 24 pixelHeight · 28 pixelDepth
 *   32 layerCount · 36 faceCount · 40 levelCount · 44 supercompressionScheme
 *   48 dfdByteOffset · 52 dfdByteLength · 56 kvdByteOffset · …
 * DFD 基本块的 colorModel 在 dfdByteOffset + 4（跳过 dfdTotalSize）+ 5 处。
 */
function ktx2Info(b) {
  const w = b.readUInt32LE(20), h = b.readUInt32LE(24);
  const levels = b.readUInt32LE(40);
  const sc = b.readUInt32LE(44);
  const dfdOff = b.readUInt32LE(48);
  let colorModel = -1;
  if (dfdOff > 0 && dfdOff + 12 < b.length) colorModel = b[dfdOff + 4 + 5];
  return { w, h, levels, sc, mode: CM[colorModel] || `colorModel=${colorModel}` };
}

for (const file of process.argv.slice(2)) {
  const { g, bin, total } = parseGLB(file);
  console.log(`\n═══ ${file.split(/[\\/]/).pop()}  ${(total / 1048576).toFixed(2)} MB ═══`);
  let px = 0; let bytes = 0;
  const rows = [];
  for (const [i, im] of (g.images || []).entries()) {
    const b = viewOf(g, bin, im.bufferView);
    bytes += b.length;
    if (im.mimeType === 'image/ktx2' || (b[0] === 0xab && b[1] === 0x4b)) {
      const k = ktx2Info(b);
      px += k.w * k.h;
      rows.push(`  #${String(i).padStart(2)}  ${String(k.w).padStart(4)}×${String(k.h).padEnd(4)}  `
        + `${String(k.levels).padStart(2)} mip  ${k.mode.padEnd(6)}  ${SC[k.sc] || k.sc}`
        + `  ${(b.length / 1024).toFixed(0).padStart(5)} KB`);
    } else {
      const s = imageSize(b);
      px += s.w * s.h;
      rows.push(`  #${String(i).padStart(2)}  ${String(s.w).padStart(4)}×${String(s.h).padEnd(4)}  `
        + `${s.fmt.padEnd(16)}${(b.length / 1024).toFixed(0).padStart(5)} KB`);
    }
  }
  console.log(rows.join('\n'));
  console.log(`  贴图共 ${g.images.length} 张，${(px / 1e6).toFixed(1)} 兆像素，${(bytes / 1048576).toFixed(2)} MB`);
}
