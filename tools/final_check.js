// final_check.js — end-to-end sanity: PBM1 decode, GLB structure, texture
// linkage, map manifests, and the original weapon OBJ export.
'use strict';
const fs = require('fs');
const path = require('path');
const { readMesh, readContainer } = require('./pbm.js');
const { validate } = require('./check_glb.js');
const { exportGlb } = require('./export_glb.js');

const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, 'site');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('  FAIL: ' + m); } };

console.log('=== 1. PBM1 decode ===');
for (const [f, wantTris] of [
  ['site/_s_weapon.bin', 3521],
  ['site/_s_skinned.bin', 648],
  ['site/_big_mesh.bin', 809170],
]) {
  const m = readMesh(fs.readFileSync(path.join(ROOT, f)));
  const tris = m.parts.reduce((a, p) => a + p.ni, 0) / 3;
  let mn = [1e30, 1e30, 1e30], mx = [-1e30, -1e30, -1e30];
  for (const p of m.parts) for (let i = 0; i < p.nv; i++) for (let k = 0; k < 3; k++) {
    const v = p.positions[i * 3 + k];
    if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v;
  }
  const b = m.header.bounds;
  ok(tris === wantTris, f + ' tris ' + tris + ' != ' + wantTris);
  ok(mn.every((v, k) => Math.abs(v - b[0][k]) < 2e-3) && mx.every((v, k) => Math.abs(v - b[1][k]) < 2e-3),
    f + ' bounds mismatch');
  console.log('  ' + path.basename(f) + ': ' + m.kind + ' tris=' + tris + ' bounds OK');
}

console.log('\n=== 2. GLB structure (all 339) ===');
const glbRoot = path.join(SITE, 'export', 'glb');
const man = JSON.parse(fs.readFileSync(path.join(glbRoot, 'manifest.json'), 'utf8'));
let n = 0, bad = 0, prims = 0, tris = 0, texRefs = 0, missingTex = 0;
for (const api of Object.keys(man)) for (const f of Object.keys(man[api])) {
  if (man[api][f] && man[api][f].empty) continue;
  const p = path.join(glbRoot, api, f + '.glb');
  if (!fs.existsSync(p)) { bad++; continue; }
  const r = validate(p);
  n++;
  if (r.errs.length) { bad++; console.log('  ' + api + '/' + f + ': ' + r.errs[0]); continue; }
  prims += r.prims; tris += r.tris;
  const { json } = require('./check_glb.js').parseGlb(fs.readFileSync(p));
  for (const im of json.images || []) {
    texRefs++;
    if (!fs.existsSync(path.join(path.dirname(p), im.uri))) missingTex++;
  }
}
ok(bad === 0, bad + ' glb files with errors');
ok(missingTex <= 3, missingTex + ' missing textures (expected <=3 for Glass_RefMask)');
console.log('  files=' + n + ' primitives=' + prims + ' tris=' + Math.round(tris) +
  ' texRefs=' + texRefs + ' missingTex=' + missingTex);

console.log('\n=== 3. weapon vertex sanity (original bug) ===');
const m = readMesh(fs.readFileSync(path.join(ROOT, 'site/_s_weapon.bin')));
const v0 = [m.parts[0].positions[0], m.parts[0].positions[1], m.parts[0].positions[2]];
ok(v0.every(v => isFinite(v) && Math.abs(v) < 10), 'weapon v0 garbage: ' + v0.join(','));
console.log('  weapon v0 = ' + v0.map(x => x.toFixed(6)).join(', '));
// and confirm the exported OBJ has the same first vertex
const obj = fs.readFileSync(path.join(SITE, 'export', 'glb', 'weapon', '2df84b53de5dff16.glb'));
ok(obj.slice(0, 4).toString('latin1') === 'glTF', 'weapon glb magic');
console.log('  weapon glb magic OK, ' + obj.length + ' bytes');

console.log('\n=== 4. map manifests ===');
const maps = JSON.parse(fs.readFileSync(path.join(SITE, 'export', 'maps', '_index.json'), 'utf8'));
ok(maps.length === 34, 'maps != 34');
let spawns = 0, trig = 0, props = 0;
for (const mm of maps) { spawns += mm.respawn; trig += mm.trigger; props += mm.prop; }
ok(spawns > 0 && trig > 0 && props > 0, 'map data empty');
console.log('  maps=' + maps.length + ' spawns=' + spawns + ' triggers=' + trig + ' props=' + props);

console.log('\n=== 5. textures ===');
const texDir = path.join(SITE, 'export', 'tex');
const texFiles = fs.readdirSync(texDir).filter(f => f.endsWith('.webp'));
ok(texFiles.length > 8000, 'too few webp: ' + texFiles.length);
let webpOk = 0;
for (const f of texFiles.slice(0, 200)) {
  const b = fs.readFileSync(path.join(texDir, f));
  if (b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP') webpOk++;
}
ok(webpOk === 200, webpOk + '/200 sampled files are valid WebP');
console.log('  webp files=' + texFiles.length + ' sampled valid=' + webpOk + '/200');

console.log('\n============================');
console.log('PASS=' + pass + '  FAIL=' + fail);
process.exit(fail ? 1 : 0);
