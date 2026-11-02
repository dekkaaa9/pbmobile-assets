// inventory.js — inventaris lengkap site/: apa aja yang sudah ada di disk,
// dikelompokkan per kategori. Buat jawab "udah lengkap belum?"
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, 'site');

function walk(dir, out) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else { try { out.push({ p, size: fs.statSync(p).size }); } catch (err) {} }
  }
  return out;
}

const all = walk(SITE, []);
const byTop = {};
for (const f of all) {
  const rel = path.relative(SITE, f.p).replace(/\\/g, '/');
  const top = rel.includes('/') ? rel.split('/')[0] : '(root)';
  const sub = rel.includes('/') ? rel.split('/').slice(0, 2).join('/') : '(root)';
  byTop[sub] = byTop[sub] || { n: 0, bytes: 0 };
  byTop[sub].n++; byTop[sub].bytes += f.size;
}

const kb = (b) => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : (b / 1024).toFixed(0) + ' KB';

console.log('=== INVENTARIS site/ ===\n');
const keys = Object.keys(byTop).sort();
let totN = 0, totB = 0;
for (const k of keys) {
  const v = byTop[k];
  totN += v.n; totB += v.bytes;
  console.log('  ' + k.padEnd(34) + String(v.n).padStart(7) + ' file  ' + kb(v.bytes).padStart(11));
}
console.log('  ' + '-'.repeat(66));
console.log('  ' + 'TOTAL'.padEnd(34) + String(totN).padStart(7) + ' file  ' + kb(totB).padStart(11));

// ---- cek spesifik: source code client ----
console.log('\n=== SOURCE CODE CLIENT (JS/HTML) ===');
const codeExt = new Set(['.js', '.html', '.css', '.json', '.webmanifest', '.txt']);
const code = all.filter(f => codeExt.has(path.extname(f.p).toLowerCase()));
const codeByDir = {};
for (const f of code) {
  const rel = path.relative(SITE, f.p).replace(/\\/g, '/');
  const d = rel.includes('/') ? rel.split('/').slice(0, 2).join('/') : '(root)';
  codeByDir[d] = codeByDir[d] || { n: 0, bytes: 0 };
  codeByDir[d].n++; codeByDir[d].bytes += f.size;
}
for (const k of Object.keys(codeByDir).sort()) {
  console.log('  ' + k.padEnd(34) + String(codeByDir[k].n).padStart(6) + ' file  ' + kb(codeByDir[k].bytes).padStart(11));
}
console.log('  ' + '-'.repeat(66));
console.log('  ' + 'TOTAL kode'.padEnd(34) + String(code.length).padStart(6) + ' file  ' + kb(code.reduce((a, c) => a + c.size, 0)).padStart(11));

// ---- file kunci ----
console.log('\n=== FILE KUNCI ===');
const key = [
  'index.html', 'cc.js', 'debug.html',
  'static/game/bundle.js', 'static/game/bundle.readable.js',
  'static/game/pb.js', 'static/game/net.js',
  'static/vendor/three.min.js',
  'static/game/weapons.json', 'static/game/weapon_anims.json',
  'static/game/charas.json', 'static/game/ai.json',
  'static/prefetch.json', 'home.json', 'goods.json', 'build.json',
];
for (const k of key) {
  const p = path.join(SITE, k);
  if (fs.existsSync(p)) console.log('  OK    ' + k.padEnd(38) + kb(fs.statSync(p).size).padStart(11));
  else console.log('  HILANG ' + k);
}

// ---- aset biner ----
console.log('\n=== ASET BINER (mirror /a/) ===');
const AD = path.join(SITE, 'assets');
if (fs.existsSync(AD)) {
  const apis = fs.readdirSync(AD, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort();
  for (const a of apis) {
    const files = walk(path.join(AD, a), []);
    console.log('  /a/' + a.padEnd(12) + String(files.length).padStart(7) + ' file  ' + kb(files.reduce((s, f) => s + f.size, 0)).padStart(11));
  }
}

// ---- export olahan ----
console.log('\n=== EXPORT OLAHAN ===');
const EX = path.join(SITE, 'export');
if (fs.existsSync(EX)) {
  for (const d of fs.readdirSync(EX, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort()) {
    const files = walk(path.join(EX, d), []);
    console.log('  export/' + d.padEnd(12) + String(files.length).padStart(7) + ' file  ' + kb(files.reduce((s, f) => s + f.size, 0)).padStart(11));
  }
}
