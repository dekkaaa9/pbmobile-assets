// pbm.js — decoder/CLI for PBMobile asset formats.
//
// Container (mesh / skinned / weapon / anims / tex):
//   [0..3]  magic "PBM1"
//   [4..7]  u32 headerLen (LE)
//   [8..8+headerLen]  UTF-8 JSON header
//   [base..] binary payload, where
//       base = 8 + headerLen + ((4 - ((8 + headerLen) % 4)) % 4)   <-- 4-byte aligned
//   All per-part offsets (pos/nrm/uv/uv2/si/sw/idx) are BYTE offsets from `base`.
//
// Attribute encoding (mirrors the game's own loader in pb.js):
//   position : f32 x3, or Int16 quantized when part.pq is present
//              pq = [offX,offY,offZ, scaleX,scaleY,scaleZ]
//              value = pq[c] + (int16 + 32768) * pq[3 + c]
//   normal   : f32 x3 (never quantized)
//   uv/uv2   : f32 x2, or Int16 quantized when part.uq / part.u2q present
//   skinIndex: u16 x4 per vertex
//   skinWeight: f32 x4 per vertex
//   index    : u16 x ni when part.i16, else u32 x ni
//
// stage assets are raw JSON (no container): { stage:{...}, entities:[...] }
//
// Usage:
//   node pbm.js info  <file>
//   node pbm.js dump  <file> [outDir]
//   node pbm.js tex   <file>
//   node pbm.js stage <file>
'use strict';
const fs = require('fs');
const path = require('path');

const MAGIC = 'PBM1';

function readContainer(buf) {
  if (buf.length < 8) return null;
  if (buf.slice(0, 4).toString('latin1') !== MAGIC) return null;
  const hlen = buf.readUInt32LE(4);
  const header = JSON.parse(buf.slice(8, 8 + hlen).toString('utf8'));
  const base = 8 + hlen + ((4 - ((8 + hlen) % 4)) % 4);
  return { header, hlen, base };
}

function classify(header) {
  if (header.parts && header.parts[0]) {
    if (header.parts[0].si !== undefined) return 'skinned';
    if (header.parts[0].bone !== undefined) return 'weapon';
    return 'mesh';
  }
  if (header.chr || header.charaAnims) return 'anims';
  return 'unknown';
}

// Dequantize Int16 -> Float32 exactly like the game's `l()` helper.
function dequant(buf, byteOff, count, comps, q) {
  const src = new Int16Array(buf.buffer, buf.byteOffset + byteOff, count * comps);
  const out = new Float32Array(count * comps);
  for (let i = 0; i < out.length; i++) {
    const c = i % comps;
    out[i] = q[c] + (src[i] + 32768) * q[comps + c];
  }
  return out;
}

function readMesh(buf) {
  const c = readContainer(buf);
  if (!c) throw new Error('not a PBM1 container');
  const { header, base } = c;
  const kind = classify(header);
  const out = { kind, header, base, parts: [] };
  for (const p of header.parts) {
    const part = {
      name: p.name, tex: p.tex, rmask: p.rmask, lux: p.lux, fx: p.fx,
      color: p.color, alpha: !!p.alpha, blend: p.blend, cull: p.cull,
      collision: !!p.collision, cd: p.cd, nv: p.nv, ni: p.ni, bone: p.bone,
      quantized: { pos: !!p.pq, uv: !!p.uq, uv2: !!p.u2q, i16: !!p.i16 },
      positions: null, normals: null, uvs: null, uv2: null, indices: null,
      boneIdx: null, weights: null,
    };
    part.positions = p.pq
      ? dequant(buf, base + p.pos, p.nv, 3, p.pq)
      : new Float32Array(buf.buffer, buf.byteOffset + base + p.pos, 3 * p.nv);
    if (p.nrm != null) {
      part.normals = new Float32Array(buf.buffer, buf.byteOffset + base + p.nrm, 3 * p.nv);
    }
    if (p.uv != null) {
      part.uvs = p.uq
        ? dequant(buf, base + p.uv, p.nv, 2, p.uq)
        : new Float32Array(buf.buffer, buf.byteOffset + base + p.uv, 2 * p.nv);
    }
    if (p.uv2 != null) {
      part.uv2 = p.u2q
        ? dequant(buf, base + p.uv2, p.nv, 2, p.u2q)
        : new Float32Array(buf.buffer, buf.byteOffset + base + p.uv2, 2 * p.nv);
    }
    if (p.si != null) {
      part.boneIdx = new Uint16Array(buf.buffer, buf.byteOffset + base + p.si, 4 * p.nv);
      part.weights = new Float32Array(buf.buffer, buf.byteOffset + base + p.sw, 4 * p.nv);
    }
    part.indices = p.i16
      ? new Uint16Array(buf.buffer, buf.byteOffset + base + p.idx, p.ni)
      : new Uint32Array(buf.buffer, buf.byteOffset + base + p.idx, p.ni);
    out.parts.push(part);
  }
  return out;
}

function safeName(s) { return String(s || 'part').replace(/[^\w.\-]+/g, '_'); }

function writeOBJ(mesh, outDir, base) {
  fs.mkdirSync(outDir, { recursive: true });
  const lines = ['# PBMobile export: ' + base, '# kind: ' + mesh.kind, '# parts: ' + mesh.parts.length];
  const mtl = ['# PBMobile materials'];
  let vBase = 1;
  for (const p of mesh.parts) {
    const safe = safeName(p.name);
    mtl.push('newmtl ' + safe);
    if (p.tex) mtl.push('# map: ' + p.tex);
    if (p.rmask) mtl.push('# specularMap: ' + p.rmask);
    if (p.lux) mtl.push('# lightMap: ' + p.lux);
    mtl.push('Kd ' + (p.color ? p.color.slice(0, 3).map(x => (+x).toFixed(4)).join(' ') : '1 1 1'));
    if (p.alpha) mtl.push('d 0.5');
    mtl.push('');
    lines.push('o ' + safe);
    lines.push('usemtl ' + safe);
    for (let i = 0; i < p.nv; i++) {
      lines.push('v ' + p.positions[i * 3].toFixed(6) + ' ' + p.positions[i * 3 + 1].toFixed(6) + ' ' + p.positions[i * 3 + 2].toFixed(6));
    }
    if (p.uvs) {
      for (let i = 0; i < p.nv; i++) {
        lines.push('vt ' + p.uvs[i * 2].toFixed(6) + ' ' + (1 - p.uvs[i * 2 + 1]).toFixed(6));
      }
    }
    if (p.normals) {
      for (let i = 0; i < p.nv; i++) {
        lines.push('vn ' + p.normals[i * 3].toFixed(6) + ' ' + p.normals[i * 3 + 1].toFixed(6) + ' ' + p.normals[i * 3 + 2].toFixed(6));
      }
    }
    for (let i = 0; i < p.ni; i += 3) {
      const a = p.indices[i] + vBase, b = p.indices[i + 1] + vBase, cc = p.indices[i + 2] + vBase;
      lines.push('f ' + a + '/' + a + '/' + a + ' ' + b + '/' + b + '/' + b + ' ' + cc + '/' + cc + '/' + cc);
    }
    vBase += p.nv;
  }
  fs.writeFileSync(path.join(outDir, base + '.obj'), lines.join('\n'));
  fs.writeFileSync(path.join(outDir, base + '.mtl'), mtl.join('\n'));
  fs.writeFileSync(path.join(outDir, base + '.json'), JSON.stringify({
    kind: mesh.kind,
    bounds: mesh.header.bounds,
    stats: mesh.header.stats,
    rootBone: mesh.header.rootBone !== undefined ? mesh.header.rootBone : null,
    bodyMtx: mesh.header.bodyMtx || null,
    lods: mesh.header.lods || null,
    skeleton: mesh.header.skeleton || null,
    parts: mesh.parts.map(p => ({
      name: p.name, tex: p.tex, rmask: p.rmask, lux: p.lux, fx: p.fx ? true : false,
      color: p.color, alpha: p.alpha, blend: p.blend, cull: p.cull,
      collision: p.collision, cd: p.cd, nv: p.nv, ni: p.ni, bone: p.bone,
      quantized: p.quantized,
    })),
  }, null, 2));
}

function main() {
  const [cmd, file, extra] = process.argv.slice(2);
  if (!cmd || !file) {
    console.log('usage: node pbm.js <info|dump|tex|stage> <file> [out]');
    process.exit(1);
  }
  const buf = fs.readFileSync(file);
  const base = path.basename(file).replace(/\.[^.]+$/, '');

  if (cmd === 'info') {
    const c = readContainer(buf);
    if (!c) {
      if (buf.slice(0, 1).toString() === '{') {
        const j = JSON.parse(buf.toString('utf8'));
        console.log('format: stage (raw JSON)');
        console.log('top keys:', Object.keys(j).join(', '));
        for (const k of Object.keys(j)) {
          const v = j[k];
          console.log('  ' + k + ': ' + (Array.isArray(v) ? 'array[' + v.length + ']' : typeof v));
        }
        return;
      }
      console.log('format: unknown, bytes=' + buf.length);
      return;
    }
    const kind = classify(c.header);
    console.log('format: PBM1/' + kind);
    console.log('header bytes:', c.hlen, ' payload base:', c.base, ' payload bytes:', buf.length - c.base);
    console.log('top keys:', Object.keys(c.header).join(', '));
    if (c.header.parts) {
      let nv = 0, ni = 0, q = 0, i16 = 0;
      for (const p of c.header.parts) { nv += p.nv; ni += p.ni; if (p.pq) q++; if (p.i16) i16++; }
      console.log('parts:', c.header.parts.length, ' verts:', nv, ' indices:', ni, ' tris:', ni / 3);
      console.log('quantized parts:', q, ' i16-index parts:', i16);
      console.log('bounds:', JSON.stringify(c.header.bounds));
      console.log('stats:', JSON.stringify(c.header.stats));
      if (c.header.skeleton) console.log('skeleton bones:', c.header.skeleton.length);
      if (c.header.lods) console.log('lods:', JSON.stringify(c.header.lods));
      if (c.header.bodyMtx) console.log('bodyMtx:', JSON.stringify(c.header.bodyMtx));
    }
    if (c.header.chr) console.log('chr entries:', Object.keys(c.header.chr).length);
    if (c.header.charaAnims) console.log('charaAnims entries:', Object.keys(c.header.charaAnims).length);
    return;
  }

  if (cmd === 'dump') {
    const mesh = readMesh(buf);
    const outDir = extra || path.join(path.dirname(file), base + '_out');
    writeOBJ(mesh, outDir, base);
    let nv = 0, ni = 0;
    for (const p of mesh.parts) { nv += p.nv; ni += p.ni; }
    console.log('wrote ' + path.join(outDir, base + '.obj') + ' (+ .mtl, .json)');
    console.log('kind:', mesh.kind, 'parts:', mesh.parts.length, 'verts:', nv, 'tris:', ni / 3);
    return;
  }

  if (cmd === 'tex') {
    const c = readContainer(buf);
    if (!c) { console.log('not a PBM1 container, bytes=' + buf.length); return; }
    console.log(JSON.stringify({ kind: 'tex', header: c.header, payloadBytes: buf.length - c.base, base: c.base }, null, 2));
    return;
  }

  if (cmd === 'stage') {
    const j = JSON.parse(buf.toString('utf8'));
    console.log('top keys:', Object.keys(j).join(', '));
    if (j.stage) {
      console.log('stage keys:', Object.keys(j.stage).join(', '));
      for (const k of Object.keys(j.stage)) {
        const v = j.stage[k];
        console.log('  stage.' + k + ': ' + (Array.isArray(v) ? 'array[' + v.length + ']' : typeof v));
      }
    }
    const items = j.entities || [];
    console.log('entities:', items.length);
    const kinds = {}, res = {};
    for (const n of items) {
      const k = n.kind || n.type || '?';
      kinds[k] = (kinds[k] || 0) + 1;
      if (n.res) res[n.res] = (res[n.res] || 0) + 1;
    }
    console.log('kinds:', JSON.stringify(kinds));
    console.log('unique resources:', Object.keys(res).length);
    return;
  }

  console.log('unknown command: ' + cmd);
}

if (require.main === module) main();
module.exports = { readContainer, readMesh, writeOBJ, classify, dequant };
