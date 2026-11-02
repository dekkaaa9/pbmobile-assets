// verify_all.js — decode every mirrored PBM1 asset and validate it against its
// own header (bounds, index range, weight sums, bone range). Reports a summary
// per api type and writes failures to verify_fail.txt.
'use strict';
const fs = require('fs');
const path = require('path');
const { readContainer, readMesh, classify } = require('./pbm.js');

const ASSETS = path.resolve(__dirname, '..', 'site', 'assets');
const OUT = path.resolve(__dirname, '..', 'verify_report.txt');

function check(file) {
  const buf = fs.readFileSync(file);
  const c = readContainer(buf);
  if (!c) return { skip: 'no-container' };
  const kind = classify(c.header);
  if (!c.header.parts) return { kind, skip: 'no-parts' };
  let mesh;
  try { mesh = readMesh(buf); } catch (e) { return { kind, err: 'decode: ' + e.message }; }
  const b = c.header.bounds;
  let mn = [1e30, 1e30, 1e30], mx = [-1e30, -1e30, -1e30];
  let badIdx = 0, badW = 0, maxBone = -1;
  const skel = c.header.skeleton ? c.header.skeleton.length : 0;
  for (const p of mesh.parts) {
    for (let i = 0; i < p.nv; i++) {
      for (let k = 0; k < 3; k++) {
        const v = p.positions[i * 3 + k];
        if (!isFinite(v)) return { kind, err: 'non-finite position' };
        if (v < mn[k]) mn[k] = v;
        if (v > mx[k]) mx[k] = v;
      }
    }
    for (let i = 0; i < p.ni; i++) if (p.indices[i] >= p.nv) badIdx++;
    if (p.weights) {
      for (let i = 0; i < p.nv; i++) {
        const s = p.weights[i * 4] + p.weights[i * 4 + 1] + p.weights[i * 4 + 2] + p.weights[i * 4 + 3];
        if (Math.abs(s - 1) > 0.03) badW++;
      }
    }
    if (p.boneIdx) for (const x of p.boneIdx) if (x > maxBone) maxBone = x;
  }
  const boundsOk = b && mn.every((v, k) => Math.abs(v - b[0][k]) < 2e-3) && mx.every((v, k) => Math.abs(v - b[1][k]) < 2e-3);
  const boneOk = !skel || maxBone < skel;
  const errs = [];
  if (b && !boundsOk) errs.push('bounds mismatch got [' + mn.map(v => v.toFixed(3)) + ']-[' + mx.map(v => v.toFixed(3)) + '] want [' + b[0].map(v => v.toFixed(3)) + ']-[' + b[1].map(v => v.toFixed(3)) + ']');
  if (badIdx) errs.push(badIdx + ' out-of-range indices');
  if (badW) errs.push(badW + ' bad weight sums');
  if (!boneOk) errs.push('bone index ' + maxBone + ' >= skeleton ' + skel);
  return { kind, errs: errs.length ? errs.join('; ') : null, nv: mesh.parts.reduce((a, p) => a + p.nv, 0), tris: mesh.parts.reduce((a, p) => a + p.ni, 0) / 3 };
}

function main() {
  const apis = fs.readdirSync(ASSETS).filter(d => fs.statSync(path.join(ASSETS, d)).isDirectory());
  const lines = [];
  const grand = {};
  let total = 0, bad = 0;
  for (const api of apis) {
    const dir = path.join(ASSETS, api);
    const files = fs.readdirSync(dir);
    const stat = { n: 0, ok: 0, bad: 0, tris: 0, bytes: 0, kinds: {} };
    const fails = [];
    for (const f of files) {
      const full = path.join(dir, f);
      stat.n++; stat.bytes += fs.statSync(full).size; total++;
      let r;
      try { r = check(full); } catch (e) { r = { err: 'throw: ' + e.message }; }
      if (r.skip) { stat.ok++; continue; }
      stat.kinds[r.kind] = (stat.kinds[r.kind] || 0) + 1;
      if (r.err) { stat.bad++; bad++; fails.push(f + ': ' + r.err); }
      else { stat.ok++; stat.tris += r.tris || 0; }
    }
    grand[api] = stat;
    lines.push('=== ' + api + ' ===  files=' + stat.n + ' ok=' + stat.ok + ' bad=' + stat.bad +
      ' tris=' + Math.round(stat.tris) + ' MB=' + (stat.bytes / 1048576).toFixed(1) +
      ' kinds=' + JSON.stringify(stat.kinds));
    for (const f of fails.slice(0, 10)) lines.push('   FAIL ' + f);
    if (fails.length > 10) lines.push('   ... +' + (fails.length - 10) + ' more');
  }
  lines.push('');
  lines.push('TOTAL files=' + total + ' bad=' + bad);
  const txt = lines.join('\n');
  fs.writeFileSync(OUT, txt);
  console.log(txt);
}

main();
