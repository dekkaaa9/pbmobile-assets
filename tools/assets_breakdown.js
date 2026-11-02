// assets_breakdown.js — isi folder site/assets/ per subfolder (API endpoint).
'use strict';
const fs = require('fs');
const path = require('path');
const A = path.resolve(__dirname, '..', 'site', 'assets');

const MB = (b) => (b / 1048576).toFixed(1) + ' MB';
const DESC = {
  anims:   'animasi karakter / senjata',
  mapimg:  'gambar peta (thumbnail map select)',
  mesh:    'mesh statis: gedung, peta, lingkungan, showroom',
  showcam: 'kamera showcase showroom (1 file)',
  skinned: 'model karakter ber-skin (karakter + skin)',
  sound:   'audio: SFC, suara senjata, langkah kaki',
  stage:   'data stage / arena',
  tex:     'tekstur .webp (terbesar, dipakai semua model)',
  weapon:  'model senjata',
};

let tb = 0, tf = 0;
const rows = [];
for (const d of fs.readdirSync(A, { withFileTypes: true })) {
  if (!d.isDirectory()) continue;
  let b = 0, n = 0, biggest = 0, bn = '';
  const walk = (x) => {
    let e; try { e = fs.readdirSync(x, { withFileTypes: true }); } catch (_) { return; }
    for (const f of e) {
      const p = path.join(x, f.name);
      if (f.isDirectory()) { walk(p); continue; }
      const s = fs.statSync(p).size; b += s; n++;
      if (s > biggest) { biggest = s; bn = f.name; }
    }
  };
  walk(path.join(A, d.name));
  tb += b; tf += n;
  rows.push({ name: d.name, n, b, biggest, bn });
}

rows.sort((x, y) => y.b - x.b);
console.log('site/assets/  =  ' + tf + ' file,  ' + MB(tb) + '\n');
console.log('  folder     file      ukuran   terbesar     isi');
console.log('  ---------- --------- -------- ----------- ----------------------------------------');
for (const r of rows) {
  console.log('  ' + r.name.padEnd(10) + ' ' + String(r.n).padStart(8) + ' ' +
    MB(r.b).padStart(8) + ' ' + MB(r.biggest).padStart(11) + '  ' + (DESC[r.name] || '-'));
}
console.log('  ---------- --------- -------- -----------');
console.log('  TOTAL      ' + String(tf).padStart(8) + ' ' + MB(tb).padStart(8));
console.log('\n  file terbesar keseluruhan: ' + rows[0].name + '/' + rows[0].bn + '  ' + MB(rows[0].biggest));
console.log('  catatan: file TANPA ekstensi = format PBM1 (header 8 byte + nama part + mesh binary)');
console.log('          client baca lewat pb.js -> PB.loadStatic / loadSkinned / loadWeapon');
console.log('          URL asli: pbmobile.app/a/<api>/<hash>  -- hash = md5-ish dari path PBM1');
