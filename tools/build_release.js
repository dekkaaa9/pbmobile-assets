// build_release.js — bikin 2 tarball buat 1 GitHub Release.
//   1) site-runtime.tar.gz  = site/ lengkap KECUALI export/  (bisa langsung jalan)
//   2) site-export.tar.gz   = site/export/                   (GLB/WebP/maps hasil olahan)
// Alasan dipisah: site/ utuh 2,05 GB > limit GitHub Release 2 GB per file.
'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);
const MB = (b) => (b / 1048576).toFixed(1) + ' MB';

function dirSize(d) {
  let t = 0, n = 0;
  const walk = (x) => {
    let e; try { e = fs.readdirSync(x, { withFileTypes: true }); } catch (_) { return; }
    for (const f of e) {
      const p = path.join(x, f.name);
      if (f.isDirectory()) walk(p);
      else { try { t += fs.statSync(p).size; n++; } catch (_) {} }
    }
  };
  walk(d); return { bytes: t, files: n };
}

const tar = (cmd) => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

console.log('=== UKURAN SUMBER ===');
const site = dirSize('site');
console.log('  site/            : ' + MB(site.bytes) + '  (' + site.files + ' file)');
const exp = dirSize('site/export');
console.log('  site/export/     : ' + MB(exp.bytes) + '  (' + exp.files + ' file)');
console.log('  site/ - export/  : ' + MB(site.bytes - exp.bytes) + '  <-- ini yang masuk runtime');

fs.mkdirSync('dist', { recursive: true });

console.log('\n=== 1/2  site-runtime.tar.gz (site/ tanpa export/) ===');
let t0 = Date.now();
tar('tar -czf dist/site-runtime.tar.gz --exclude=export site');
console.log('  selesai ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s -> ' +
  MB(fs.statSync('dist/site-runtime.tar.gz').size));

console.log('\n=== 2/2  site-export.tar.gz (site/export/) ===');
t0 = Date.now();
tar('tar -czf dist/site-export.tar.gz -C site export');
console.log('  selesai ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s -> ' +
  MB(fs.statSync('dist/site-export.tar.gz').size));

// verifikasi jumlah entry
console.log('\n=== VERIFIKASI ENTRY ===');
const nRuntime = tar('tar -tzf dist/site-runtime.tar.gz').split('\n').filter(x => x.trim()).length;
const nExport = tar('tar -tzf dist/site-export.tar.gz').split('\n').filter(x => x.trim()).length;
console.log('  site-runtime.tar.gz : ' + nRuntime + ' entry');
console.log('  site-export.tar.gz  : ' + nExport + ' entry');

// cek tidak ada yang bocor / hilang
const bad = tar('tar -tzf dist/site-runtime.tar.gz').split('\n').filter(l => l.startsWith('site/export/')).length;
console.log('  export/ di runtime  : ' + bad + '  (harus 0)');

console.log('\n=== HASIL ===');
for (const f of ['site-runtime.tar.gz', 'site-export.tar.gz']) {
  const s = fs.statSync(path.join('dist', f)).size;
  const ok = s < 2 * 1024 * 1024 * 1024 ? 'OK <2GB' : 'LEBIH 2GB!!';
  console.log('  dist/' + f + '  ' + MB(s) + '  ' + ok);
}
console.log('\nCara pakai buat yang download:');
console.log('  tar -xzf site-runtime.tar.gz   -> folder site/ (tinggal serve)');
console.log('  tar -xzf site-export.tar.gz -C site/   -> nambah folder site/export/');
