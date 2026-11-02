// export_glb.js — convert mirrored PBM1 mesh/skinned/weapon assets to glTF 2.0
// binary (.glb) so they load directly in three.js / any glTF viewer.
//
// Node hierarchies mirror the game's own loaders in pb.js exactly:
//
//   mesh (static)            weapon                        skinned (character)
//   ---------------          -------                        -------------------
//   Group(name)              Group("weapon")                Group("chara")
//    └ Mesh(part)..            └ Group(bodyMtx)               └ Group(rotX=-90°)
//                                 ├ Bone(local)..                ├ Bone(local)..
//                                 └ Mesh(part)..                 └ SkinnedMesh(part)..
//                                                            (skin: JOINTS_0/WEIGHTS_0,
//                                                             inverseBindMatrices = inv[])
//
// Output layout:
//   site/export/glb/<api>/<hash>.glb
//   site/export/glb/manifest.json   (per-file: kind, tris, bounds, skeleton, texRefs)
'use strict';
const fs = require('fs');
const path = require('path');
const { readContainer, readMesh, classify } = require('./pbm.js');

const ROOT = path.resolve(__dirname, '..');
const ASSETS = path.join(ROOT, 'site', 'assets');
const OUTROOT = path.join(ROOT, 'site', 'export', 'glb');

const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function normTex(p) { return String(p || '').split('\\').join('/'); }
// must match flatten() in fetch_tex.js so the materialised .webp filenames line up.
// GLBs live in site/export/glb/<api>/, textures in site/export/tex/ -> ../../tex/
function texUri(p) {
  return '../../tex/' + normTex(p).replace(/\//g, '__').replace(/\.i3[is]$/i, '')
    .replace(/^inline:/, 'inline_').replace(/#/g, '@') + '.webp';
}
function safeName(s) { return String(s || 'node').replace(/[^\w.\- ]+/g, '_'); }

// column-major mat4 -> glTF node {matrix} (same layout, so a straight copy)
function mat4(m) { return Array.from(m); }

class BinBuilder {
  constructor() { this.chunks = []; this.len = 0; }
  add(buf) {
    const start = this.len;
    this.chunks.push(buf);
    this.len += buf.length;
    const rem = this.len % 4;
    if (rem) { const z = Buffer.alloc(4 - rem); this.chunks.push(z); this.len += z.length; }
    return start;
  }
  concat() { return Buffer.concat(this.chunks); }
}

function exportGlb(file, outFile) {
  const buf = fs.readFileSync(file);
  const c = readContainer(buf);
  if (!c) throw new Error('not PBM1');
  const mesh = readMesh(buf);
  const kind = mesh.kind;
  if (!mesh.parts.length) return null;
  const head = mesh.header;

  const bin = new BinBuilder();
  const bufferViews = [];
  const accessors = [];
  const materials = [];
  const textures = [];
  const images = [];
  const samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }];
  const nodes = [];
  const primitives = [];
  const skins = [];

  function addAccessor(typed, compType, type, count, target, minMax) {
    const raw = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    const off = bin.add(raw);
    const bvi = bufferViews.length;
    const bv = { buffer: 0, byteOffset: off, byteLength: raw.length };
    if (target) bv.target = target;
    bufferViews.push(bv);
    const acc = { bufferView: bvi, componentType: compType, count, type };
    if (minMax) { acc.min = minMax[0]; acc.max = minMax[1]; }
    const ai = accessors.length;
    accessors.push(acc);
    return ai;
  }

  function addMaterial(p) {
    if (!p.tex) return undefined;
    const col = p.color || [1, 1, 1, 1];
    const mat = {
      name: safeName(p.name),
      pbrMetallicRoughness: {
        baseColorFactor: [col[0], col[1], col[2], col[3] != null ? col[3] : 1],
        metallicFactor: 0,
        roughnessFactor: 0.85,
      },
    };
    const ti = textures.length;
    textures.push({ source: images.length, sampler: 0 });
    images.push({ uri: texUri(p.tex), name: normTex(p.tex) });
    mat.pbrMetallicRoughness.baseColorTexture = { index: ti };
    if (p.rmask) {
      const ri = textures.length;
      textures.push({ source: images.length, sampler: 0 });
      images.push({ uri: texUri(p.rmask), name: normTex(p.rmask) });
      mat.pbrMetallicRoughness.metallicRoughnessTexture = { index: ri };
    }
    if (p.lux) {
      const li = textures.length;
      textures.push({ source: images.length, sampler: 0 });
      images.push({ uri: texUri(p.lux), name: normTex(p.lux) });
      mat.occlusionTexture = { index: li };
    }
    if (p.alpha) mat.alphaMode = 'BLEND';
    if (p.cull === false) mat.doubleSided = true;
    materials.push(mat);
    return materials.length - 1;
  }

  // ---- build one primitive per part, all under a single mesh ----
  for (const p of mesh.parts) {
    const attrs = {};
    {
      const mn = [1e30, 1e30, 1e30], mx = [-1e30, -1e30, -1e30];
      for (let i = 0; i < p.nv; i++) for (let k = 0; k < 3; k++) {
        const v = p.positions[i * 3 + k];
        if (v < mn[k]) mn[k] = v;
        if (v > mx[k]) mx[k] = v;
      }
      attrs.POSITION = addAccessor(p.positions, 5126, 'VEC3', p.nv, 34962, [mn, mx]);
    }
    if (p.normals) attrs.NORMAL = addAccessor(p.normals, 5126, 'VEC3', p.nv, 34962);
    if (p.uvs) attrs.TEXCOORD_0 = addAccessor(p.uvs, 5126, 'VEC2', p.nv, 34962);
    if (p.uv2) attrs.TEXCOORD_1 = addAccessor(p.uv2, 5126, 'VEC2', p.nv, 34962);
    if (p.boneIdx && p.weights) {
      attrs.JOINTS_0 = addAccessor(p.boneIdx, 5123, 'VEC4', p.nv, 34962);
      attrs.WEIGHTS_0 = addAccessor(p.weights, 5126, 'VEC4', p.nv, 34962);
    }
    const idxAcc = addAccessor(p.indices,
      p.indices instanceof Uint16Array ? 5123 : 5125, 'SCALAR', p.ni, 34963);
    const prim = { attributes: attrs, indices: idxAcc, mode: 4 };
    const mi = addMaterial(p);
    if (mi !== undefined) prim.material = mi;
    primitives.push(prim);
  }

  // ---- node hierarchy ----
  const skel = head.skeleton || [];
  let boneNodes = [];
  let partNodes = [];
  let rootIdx = 0;

  if (kind === 'mesh') {
    // Group(name) -> Mesh(part)..
    rootIdx = nodes.length;
    nodes.push({ name: safeName(path.basename(file)), children: [] }); // reserve root slot
    const kids = [];
    mesh.parts.forEach((p) => {
      const ni = nodes.length;
      nodes.push({ mesh: 0, name: safeName(p.name) });
      kids.push(ni);
      partNodes.push(ni);
    });
    nodes[rootIdx].children = kids;
  } else if (kind === 'weapon') {
    // Group("weapon") -> Group(bodyMtx) -> Bone(local).. -> Mesh(part)..
    rootIdx = nodes.length;
    nodes.push({ name: 'weapon', children: [] });
    const bodyIdx = nodes.length;
    nodes.push({ name: 'body', matrix: mat4(head.bodyMtx || [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]), children: [] });
    nodes[rootIdx].children.push(bodyIdx);

    boneNodes = skel.map((b, i) => {
      const ni = nodes.length;
      nodes.push({ name: safeName(b.name), matrix: mat4(b.local), children: [] });
      return ni;
    });
    skel.forEach((b, i) => {
      const parent = b.parent >= 0 ? boneNodes[b.parent] : bodyIdx;
      nodes[parent].children.push(boneNodes[i]);
    });
    mesh.parts.forEach((p) => {
      const ni = nodes.length;
      nodes.push({ mesh: 0, name: safeName(p.name) });
      const parent = (p.bone != null && boneNodes[p.bone] != null) ? boneNodes[p.bone] : bodyIdx;
      nodes[parent].children.push(ni);
      partNodes.push(ni);
    });
  } else {
    // skinned: Group("chara") -> Group(rotX=-90°) -> Bone(local).. + SkinnedMesh(part)..
    rootIdx = nodes.length;
    nodes.push({ name: 'chara', children: [] });
    const modelIdx = nodes.length;
    nodes.push({
      name: 'model',
      rotation: [-0.7071067811865476, 0, 0, 0.7071067811865476],
      children: [],
    });
    nodes[rootIdx].children.push(modelIdx);

    boneNodes = skel.map((b) => {
      const ni = nodes.length;
      nodes.push({ name: safeName(b.name), matrix: mat4(b.local), children: [] });
      return ni;
    });
    skel.forEach((b, i) => {
      const parent = b.parent >= 0 ? boneNodes[b.parent] : modelIdx;
      nodes[parent].children.push(boneNodes[i]);
    });
    mesh.parts.forEach((p) => {
      const ni = nodes.length;
      nodes.push({ mesh: 0, name: safeName(p.name), skin: 0 });
      nodes[modelIdx].children.push(ni);
      partNodes.push(ni);
    });

    // skin: inverseBindMatrices straight from skeleton inv[]
    const inv = skel.map(b => b.inv || [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    const flat = new Float32Array(inv.length * 16);
    inv.forEach((m, i) => { for (let k = 0; k < 16; k++) flat[i * 16 + k] = m[k]; });
    const ibm = addAccessor(flat, 5126, 'MAT4', inv.length);
    const rootBone = skel.findIndex(b => b.parent < 0);
    skins.push({
      inverseBindMatrices: ibm,
      joints: boneNodes.slice(),
      skeleton: rootBone >= 0 ? boneNodes[rootBone] : (boneNodes[0] != null ? boneNodes[0] : modelIdx),
      name: 'root',
    });

    // boneRefs: attachment points (Groups parented to a bone, optional offset)
    for (const ref of head.boneRefs || []) {
      const ri = nodes.length;
      const n = { name: safeName(ref.name), children: [] };
      if (ref.offset) n.matrix = mat4(ref.offset);
      nodes.push(n);
      const bi = ref.boneName
        ? skel.findIndex(b => String(b.name).toLowerCase() === String(ref.boneName).toLowerCase())
        : (ref.bone != null ? ref.bone : -1);
      const parent = (bi >= 0 && boneNodes[bi] != null) ? boneNodes[bi] : modelIdx;
      nodes[parent].children.push(ri);
    }
  }

  // ---- glTF JSON ----
  const gltf = {
    asset: { version: '2.0', generator: 'pbmobile-mirror export_glb.js' },
    scene: 0,
    scenes: [{ name: safeName(path.basename(file)), nodes: [rootIdx] }],
    nodes,
    meshes: [{ name: safeName(path.basename(file)), primitives }],
    accessors,
    bufferViews,
    buffers: [{ byteLength: bin.len }],
    samplers,
  };
  if (materials.length) gltf.materials = materials;
  if (textures.length) gltf.textures = textures;
  if (images.length) gltf.images = images;
  if (skins.length) gltf.skins = skins;

  // ---- assemble GLB ----
  let jsonBuf = Buffer.from(JSON.stringify(gltf), 'utf8');
  const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
  if (jsonPad) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]);

  const binBuf = bin.concat();
  const binPad = (4 - (binBuf.length % 4)) % 4;
  const binFinal = binPad ? Buffer.concat([binBuf, Buffer.alloc(binPad)]) : binBuf;

  const total = 12 + 8 + jsonBuf.length + 8 + binFinal.length;
  const out = Buffer.alloc(total);
  let o = 0;
  out.writeUInt32LE(0x46546c67, o); o += 4;
  out.writeUInt32LE(2, o); o += 4;
  out.writeUInt32LE(total, o); o += 4;
  out.writeUInt32LE(jsonBuf.length, o); o += 4;
  out.write('JSON', o, 'ascii'); o += 4;
  jsonBuf.copy(out, o); o += jsonBuf.length;
  out.writeUInt32LE(binFinal.length, o); o += 4;
  out.write('BIN\0', o, 'ascii'); o += 4;
  binFinal.copy(out, o);

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, out);

  return {
    kind,
    parts: mesh.parts.length,
    verts: mesh.parts.reduce((a, p) => a + p.nv, 0),
    tris: mesh.parts.reduce((a, p) => a + p.ni, 0) / 3,
    bytes: out.length,
    bounds: mesh.header.bounds,
    skeleton: skel.length,
    boneRefs: (head.boneRefs || []).length,
    bodyMtx: head.bodyMtx || null,
    lods: head.lods || null,
    texRefs: [...new Set(mesh.parts.map(p => p.tex).filter(Boolean).map(normTex))],
    rmaskRefs: [...new Set(mesh.parts.map(p => p.rmask).filter(Boolean).map(normTex))],
    luxRefs: [...new Set(mesh.parts.map(p => p.lux).filter(Boolean).map(normTex))],
  };
}

function main() {
  const only = process.env.ONLY;
  const EXPORTABLE = new Set(['mesh', 'skinned', 'weapon']);
  const apis = fs.readdirSync(ASSETS).filter(d => fs.statSync(path.join(ASSETS, d)).isDirectory());
  let manifest = {};
  const mpath = path.join(OUTROOT, 'manifest.json');
  try { manifest = JSON.parse(fs.readFileSync(mpath, 'utf8')); } catch (e) {}
  let n = 0, bad = 0;
  for (const api of apis) {
    if (only && api !== only) continue;
    if (!EXPORTABLE.has(api)) continue;
    const dir = path.join(ASSETS, api);
    const files = fs.readdirSync(dir);
    manifest[api] = manifest[api] || {};
    for (const f of files) {
      const src = path.join(dir, f);
      const dst = path.join(OUTROOT, api, f + '.glb');
      try {
        const info = exportGlb(src, dst);
        if (!info) { manifest[api][f] = { empty: true }; continue; }
        manifest[api][f] = info;
        n++;
      } catch (e) {
        bad++;
        manifest[api][f] = { error: String(e.message).slice(0, 200) };
      }
    }
    console.log(api + ': ' + files.length + ' files');
  }
  fs.mkdirSync(OUTROOT, { recursive: true });
  fs.writeFileSync(mpath, JSON.stringify(manifest, null, 1));
  console.log('exported=' + n + ' bad=' + bad);
}

if (require.main === module) main();
module.exports = { exportGlb };
