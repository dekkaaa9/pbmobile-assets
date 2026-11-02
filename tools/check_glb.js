// check_glb.js — validate exported .glb files: header, chunk layout, JSON
// parse, accessor/bufferView bounds, node hierarchy sanity, and skin wiring.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const GLBROOT = path.join(ROOT, 'site', 'export', 'glb');
const MANIFEST = path.join(GLBROOT, 'manifest.json');

const NCTYPE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function parseGlb(buf) {
  if (buf.length < 12) throw new Error('too short');
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('bad magic');
  const version = buf.readUInt32LE(4);
  const total = buf.readUInt32LE(8);
  if (version !== 2) throw new Error('version ' + version);
  if (total !== buf.length) throw new Error('length ' + total + ' != ' + buf.length);
  let o = 12;
  const chunks = [];
  while (o < buf.length) {
    const clen = buf.readUInt32LE(o); o += 4;
    const ctype = buf.toString('ascii', o, o + 4); o += 4;
    if (o + clen > buf.length) throw new Error('chunk overrun');
    chunks.push({ type: ctype, data: buf.slice(o, o + clen) });
    o += clen;
  }
  if (chunks.length < 2) throw new Error('expected 2 chunks, got ' + chunks.length);
  if (chunks[0].type !== 'JSON') throw new Error('first chunk ' + chunks[0].type);
  if (chunks[1].type !== 'BIN\0') throw new Error('second chunk ' + chunks[1].type);
  return { json: JSON.parse(chunks[0].data.toString('utf8')), bin: chunks[1].data };
}

function validate(file) {
  const buf = fs.readFileSync(file);
  const { json, bin } = parseGlb(buf);
  const errs = [];
  const warn = [];

  if (!json.asset || json.asset.version !== '2.0') errs.push('bad asset.version');
  if (!json.meshes || !json.meshes.length) errs.push('no meshes');
  if (!json.accessors || !json.accessors.length) errs.push('no accessors');
  if (!json.bufferViews || !json.bufferViews.length) errs.push('no bufferViews');
  if (!json.buffers || json.buffers[0].byteLength !== bin.length) {
    errs.push('buffer.byteLength ' + (json.buffers && json.buffers[0] && json.buffers[0].byteLength) + ' != bin ' + bin.length);
  }

  // accessor <-> bufferView bounds
  json.accessors.forEach((a, i) => {
    if (a.bufferView === undefined) return;
    const bv = json.bufferViews[a.bufferView];
    if (!bv) { errs.push('acc' + i + ' missing bufferView'); return; }
    const cs = NCTYPE[a.componentType];
    const nc = NCOMP[a.type];
    if (!cs || !nc) { errs.push('acc' + i + ' bad type'); return; }
    const need = a.count * cs * nc;
    if (bv.byteOffset + need > bin.length) errs.push('acc' + i + ' overruns BIN');
    if (bv.byteLength < need) errs.push('acc' + i + ' bufferView too small (' + bv.byteLength + ' < ' + need + ')');
    if (a.type === 'VEC3' && a.min && a.max) {
      for (let k = 0; k < 3; k++) if (!(a.min[k] <= a.max[k])) errs.push('acc' + i + ' min>max');
    }
  });

  // primitives
  let prims = 0, tris = 0;
  for (const m of json.meshes || []) {
    for (const p of m.primitives || []) {
      prims++;
      if (p.attributes.POSITION === undefined) errs.push('primitive without POSITION');
      if (p.indices === undefined) errs.push('primitive without indices');
      else {
        const a = json.accessors[p.indices];
        if (a) tris += a.count / 3;
      }
      if (p.material !== undefined && !json.materials[p.material]) errs.push('bad material ref');
      if (p.attributes.JOINTS_0 !== undefined) {
        const j = json.accessors[p.attributes.JOINTS_0];
        const w = json.accessors[p.attributes.WEIGHTS_0];
        if (!w) errs.push('JOINTS_0 without WEIGHTS_0');
        if (j && w && j.count !== w.count) errs.push('JOINTS_0/WEIGHTS_0 count mismatch');
      }
    }
  }

  // node hierarchy: every referenced node exists, no cycles, single root
  const N = (json.nodes || []).length;
  const seen = new Set();
  const visit = (i, depth) => {
    if (i < 0 || i >= N) { errs.push('node index out of range: ' + i); return; }
    if (seen.has(i)) { errs.push('cycle/duplicate node ' + i); return; }
    if (depth > 512) { errs.push('hierarchy too deep'); return; }
    seen.add(i);
    for (const ch of json.nodes[i].children || []) visit(ch, depth + 1);
  };
  for (const s of json.scenes || []) for (const r of s.nodes || []) visit(r, 0);
  const unreachable = [];
  for (let i = 0; i < N; i++) if (!seen.has(i)) unreachable.push(i);
  if (unreachable.length) warn.push(unreachable.length + ' unreachable node(s)');

  // skins
  for (const s of json.skins || []) {
    if (s.inverseBindMatrices !== undefined) {
      const a = json.accessors[s.inverseBindMatrices];
      if (a && a.count !== s.joints.length) errs.push('skin IBM count ' + a.count + ' != joints ' + s.joints.length);
    }
    for (const j of s.joints) if (j < 0 || j >= N) errs.push('skin joint out of range ' + j);
    if (s.skeleton !== undefined && (s.skeleton < 0 || s.skeleton >= N)) errs.push('skin skeleton out of range');
  }

  // nodes referencing meshes/skins
  (json.nodes || []).forEach((n, i) => {
    if (n.mesh !== undefined && !json.meshes[n.mesh]) errs.push('node ' + i + ' bad mesh ref');
    if (n.skin !== undefined && !json.skins[n.skin]) errs.push('node ' + i + ' bad skin ref');
  });

  // images referenced by textures exist on disk (relative to the glb dir)
  const missingTex = [];
  for (const im of json.images || []) {
    if (!im.uri) continue;
    const p = path.join(path.dirname(file), im.uri);
    if (!fs.existsSync(p)) missingTex.push(im.uri);
  }
  if (missingTex.length) warn.push(missingTex.length + ' missing texture file(s): ' + missingTex.slice(0, 3).join(', '));

  return { errs, warn, prims, tris, accessors: json.accessors.length, nodes: N, bin: bin.length };
}

function main() {
  const man = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  let files = 0, bad = 0, prims = 0, tris = 0, warned = 0;
  const fails = [];
  for (const api of Object.keys(man)) {
    for (const f of Object.keys(man[api])) {
      if (man[api][f] && man[api][f].empty) continue; // 0-part source, no glb written
      const p = path.join(GLBROOT, api, f + '.glb');
      if (!fs.existsSync(p)) { bad++; fails.push(api + '/' + f + ': missing file'); continue; }
      files++;
      let r;
      try { r = validate(p); } catch (e) { bad++; fails.push(api + '/' + f + ': ' + e.message); continue; }
      if (r.errs.length) { bad++; fails.push(api + '/' + f + ': ' + r.errs.slice(0, 3).join('; ')); }
      else { prims += r.prims; tris += r.tris; if (r.warn.length) warned++; }
    }
  }
  console.log('glb files=' + files + ' bad=' + bad + ' primitives=' + prims + ' tris=' + Math.round(tris) + ' warned=' + warned);
  if (fails.length) {
    console.log('--- failures (first 25) ---');
    for (const f of fails.slice(0, 25)) console.log('  ' + f);
    fs.writeFileSync(path.join(ROOT, 'glb_fail.txt'), fails.join('\n'));
  }
}

if (require.main === module) main();
module.exports = { parseGlb, validate };
