// gh_size_check.js — cek apakah site/ aman di-push ke GitHub.
// Batas GitHub: 100 MB per file (hard), repo disarankan < 1 GB, soft limit 5 GB.
'use strict';
const fs = require('fs');
const path = require('path');
const SITE = path.resolve(__dirname, '../site');

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
const MB = 1048576;

// distribusi
const over100 = all.filter(f => f.size > 100 * MB);
const over50 = all.filter(f => f.size > 50 * MB && f.size <= 100 * MB);
const over10 = all.filter(f => f.size > 10 * MB && f.size <= 50 * MB);
const rest = all.filter(f => f.size <= 10 * MB);

console.log('=== DISTRIBUSI UKURAN FILE (site/) ===');
console.log('  > 100 MB (DITOLAK GitHub) : ' + String(over100.length).padStart(6) +
  '  ' + (over100.reduce((a, c) => a + c.size, 0) / MB).toFixed(1) + ' MB');
console.log('  50-100 MB (warning)       : ' + String(over50.length).padStart(6) +
  '  ' + (over50.reduce((a, c) => a + c.size, 0) / MB).toFixed(1) + ' MB');
console.log('  10-50 MB                  : ' + String(over10.length).padStart(6) +
  '  ' + (over10.reduce((a, c) => a + c.size, 0) / MB).toFixed(1) + ' MB');
console.log('  <= 10 MB                  : ' + String(rest.length).padStart(6) +
  '  ' + (rest.reduce((a, c) => a + c.size, 0) / MB).toFixed(1) + ' MB');
console.log('  ' + '-'.repeat(56));
console.log('  TOTAL                     : ' + String(all.length).padStart(6) +
  '  ' + (all.reduce((a, c) => a + c.size, 0) / MB).toFixed(1) + ' MB');

// 15 file terbesar
console.log('\n=== 15 FILE TERBESAR ===');
all.sort((a, b) => b.size - a.size);
for (const f of all.slice(0, 15)) {
  const rel = path.relative(SITE, f.p).replace(/\\/g, '/');
  console.log('  ' + (f.size / MB).toFixed(2).padStart(9) + ' MB  ' + rel);
}

// rekomendasi: pisahkan kode vs aset
const isAsset = (rel) => rel.startsWith('assets/') || rel.startsWith('export/') || rel.startsWith('rml/');
const code = all.filter(f => !isAsset(path.relative(SITE, f.p).replace(/\\/g, '/')));
const assets = all.filter(f => isAsset(path.relative(SITE, f.p).replace(/\\/g, '/')));
console.log('\n=== PISAHAN KODE vs ASET ===');
console.log('  KODE  : ' + String(code.length).padStart(6) + ' file  ' +
  (code.reduce((a, c) => a + c.size, 0) / MB).toFixed(1) + ' MB');
console.log('  ASET  : ' + String(assets.length).padStart(6) + ' file  ' +
  (assets.reduce((a, c) => a + c.size, 0) / MB).toFixed(1) + ' MB');

console.log('\n=== VONIS ===');
if (over100.length) {
  console.log('  ADA ' + over100.length + ' file > 100 MB -> git push NORMAL AKAN GAGAL.');
} else {
  console.log('  Nggak ada file > 100 MB -> batas per-file aman.');
}
const totalGB = all.reduce((a, c) => a + c.size, 0) / 1073741824;
if (totalGB > 1) {
  console.log('  Total ' + totalGB.toFixed(2) + ' GB -> DI ATAS rekomendasi 1 GB GitHub.');
  console.log('  Perlu dipisah: repo kode (kecil) + aset via Releases/LFS/R2.');
} else {
  console.log('  Total ' + totalGB.toFixed(2) + ' GB -> masih dalam rekomendasi.');
}
