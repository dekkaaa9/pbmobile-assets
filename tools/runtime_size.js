// runtime_size.js — hitung ukuran SEBENERNYA yang dibutuhkan buat nge-host
// client (tanpa export olahan). Jawab pertanyaan: "VPS berapa GB?"
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
const mb = (b) => (b / 1048576).toFixed(1) + ' MB';

// apa yang benar-benar dibutuhkan client saat runtime?
//  - index.html + semua /static/*
//  - /a/<api>/<hash>  (CDN aset)
//  - home.json goods.json build.json robots.txt
//  - /rml/*  (fonts, namecards, patentes)
// TIDAK dibutuhkan: export/ (glb, webp, maps — olahan buat analisis),
//                   debug.html, bundle.readable.js
const NEED = [
  'index.html', 'cc.js', 'home.json', 'goods.json', 'build.json', 'robots.txt',
  'static', 'assets', 'rml',
];

let needN = 0, needB = 0;
for (const k of NEED) {
  const p = path.join(SITE, k);
  if (!fs.existsSync(p)) continue;
  const files = fs.statSync(p).isDirectory() ? walk(p, []) : [{ p, size: fs.statSync(p).size }];
  const b = files.reduce((s, f) => s + f.size, 0);
  needN += files.length; needB += b;
  console.log('  ' + k.padEnd(14) + String(files.length).padStart(7) + ' file  ' + mb(b).padStart(11));
}
console.log('  ' + '-'.repeat(48));
console.log('  ' + 'RUNTIME'.padEnd(14) + String(needN).padStart(7) + ' file  ' + mb(needB).padStart(11));

// yang bisa dibuang
const all = walk(SITE, []);
const total = all.reduce((s, f) => s + f.size, 0);
console.log('\n  total site/   : ' + all.length + ' file  ' + mb(total));
console.log('  bisa dibuang  : ' + (all.length - needN) + ' file  ' + mb(total - needB));
console.log('    (export/ = glb+webp+maps olahan, debug.html, bundle.readable.js)');

// rekomendasi disk
console.log('\n=== REKOMENDASI DISK VPS ===');
const gb = needB / 1073741824;
console.log('  butuh runtime      : ' + gb.toFixed(2) + ' GB');
console.log('  + OS + Node + swap  : ~2 GB');
console.log('  + ruang tumbuh     : ~5 GB (aset & peta baru)');
console.log('  => AMAN            : 20 GB SSD (cukup), 40 GB (lega), 200 GB (kantor)');
