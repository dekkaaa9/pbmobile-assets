const m = require('./pbm.js');
const fs = require('fs');
function verify(file, label) {
  const mesh = m.readMesh(fs.readFileSync(file));
  console.log('=== ' + label + ' (' + mesh.kind + ') ===');
  let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  let badN = 0, badUV = 0, badIdx = 0, badW = 0;
  for (const p of mesh.parts) {
    for (let i = 0; i < p.nv; i++) {
      for (let k = 0; k < 3; k++) {
        const v = p.positions[i * 3 + k];
        if (!isFinite(v)) badN++;
        if (v < mn[k]) mn[k] = v;
        if (v > mx[k]) mx[k] = v;
      }
      if (p.normals) {
        const len = Math.hypot(p.normals[i * 3], p.normals[i * 3 + 1], p.normals[i * 3 + 2]);
        if (len < 0.9 || len > 1.1) badN++;
      }
      if (p.uvs && !isFinite(p.uvs[i * 2])) badUV++;
    }
    for (let i = 0; i < p.ni; i++) if (p.indices[i] >= p.nv) badIdx++;
    if (p.weights) {
      for (let i = 0; i < p.nv; i++) {
        const s = p.weights[i * 4] + p.weights[i * 4 + 1] + p.weights[i * 4 + 2] + p.weights[i * 4 + 3];
        if (Math.abs(s - 1) > 0.02) badW++;
      }
    }
  }
  console.log('  computed min:', mn.map(v => v.toFixed(4)).join(','));
  console.log('  computed max:', mx.map(v => v.toFixed(4)).join(','));
  console.log('  header   min:', mesh.header.bounds[0].map(v => v.toFixed(4)).join(','));
  console.log('  header   max:', mesh.header.bounds[1].map(v => v.toFixed(4)).join(','));
  const ok = mn.every((v, k) => Math.abs(v - mesh.header.bounds[0][k]) < 1e-3) &&
             mx.every((v, k) => Math.abs(v - mesh.header.bounds[1][k]) < 1e-3);
  console.log('  BOUNDS MATCH:', ok);
  console.log('  bad positions:', badN, ' bad uv:', badUV, ' bad idx:', badIdx, ' bad weight-sums:', badW);
  if (mesh.parts[0].boneIdx) {
    const sk = mesh.header.skeleton;
    let maxB = 0;
    for (const p of mesh.parts) for (const b of p.boneIdx) if (b > maxB) maxB = b;
    console.log('  max bone index:', maxB, 'skeleton size:', sk ? sk.length : 'none', maxB < (sk ? sk.length : 0) ? 'OK' : 'OUT OF RANGE');
  }
}
verify('site/_s_weapon.bin', 'weapon m4a1');
verify('site/_s_skinned.bin', 'skinned glove');
verify('site/_big_mesh.bin', 'big map mesh');
