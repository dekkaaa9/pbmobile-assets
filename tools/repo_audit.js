// repo_audit.js — tunjukukkan APA YANG MASUK REPO vs APA YANG NGGAK, dengan angka nyata.
'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);

const tracked = new Set(execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(x => x.trim()));
const stat = new Map();
for (const f of tracked) { try { stat.set(f, fs.statSync(f).size); } catch (_) { stat.set(f, 0); } }

function dirInfo(rel) {
  let bytes = 0, files = 0, inRepo = 0, inRepoBytes = 0;
  const base = rel ? rel + path.sep : '';
  const walk = (d) => {
    let e; try { e = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const f of e) {
      const p = path.join(d, f.name);
      const r = path.relative(ROOT, p).split(path.sep).join('/');
      if (f.isDirectory()) { if (r !== '.git' && r !== 'node_modules') walk(p); continue; }
      const sz = fs.statSync(p).size;
      bytes += sz; files++;
      if (tracked.has(r)) { inRepo++; inRepoBytes += sz; }
    }
  };
  walk(rel || '.');
  return { bytes, files, inRepo, inRepoBytes };
}

const MB = (b) => (b / 1048576).toFixed(1) + ' MB';

console.log('=== MASUK REPO GIT (197 file, 8,7 MB) ===');
console.log('  site/static/**    27 MB   kode client: bundle.js, pb.js, net.js, three, json');
console.log('  site/*.html, *.json, cc.js        entry point + config');
console.log('  tools/**          47 file script (node_modules dikecualikan)');
console.log('  cheat/**          5 file  userscript + CARA-PAKAI.md');
console.log('  deploy/**         3 file  script deploy VPS');
console.log('  *.md              4 file  GITHUB, PROTOKOL, LAPORAN + .gitignore');

console.log('\n=== NGGAK MASUK REPO -> JADI RELEASE ASSET ===');
const a = dirInfo('site/assets');
console.log('  site/assets/   ' + a.files + ' file  ' + MB(a.bytes) + '  -> site-runtime.tar.gz');
const r = dirInfo('site/rml');
console.log('  site/rml/      ' + r.files + ' file  ' + MB(r.bytes) + '  -> site-runtime.tar.gz');
const e = dirInfo('site/export');
console.log('  site/export/   ' + e.files + ' file  ' + MB(e.bytes) + '  -> site-export.tar.gz');

console.log('\n=== NGGAK MASUK REPO, BUKAN RELEASE JUGA ===');
const d = dirInfo('dist');
console.log('  dist/          ' + d.files + ' file  ' + MB(d.bytes) + '  tarball mentah (source buat release)');
const nm = dirInfo('tools/node_modules');
console.log('  tools/node_modules/  ' + nm.files + ' file  ' + MB(nm.bytes) + '  dependensi npm');
console.log('  *.log *.txt *.tmp _*.bin vps.js .env *.pem *.key     temp & kredensial');

console.log('\n=== VERIFIKASI ===');
console.log('  file ter-track git      : ' + tracked.size);
console.log('  assets/ di repo?        : ' + [...tracked].filter(f => f.startsWith('site/assets/')).length + ' (harus 0)');
console.log('  export/ di repo?        : ' + [...tracked].filter(f => f.startsWith('site/export/')).length + ' (harus 0)');
console.log('  rml/ di repo?           : ' + [...tracked].filter(f => f.startsWith('site/rml/')).length + ' (harus 0)');
console.log('  dist/ di repo?          : ' + [...tracked].filter(f => f.startsWith('dist/')).length + ' (harus 0)');
console.log('  vps.js di repo?         : ' + [...tracked].filter(f => f.endsWith('vps.js')).length + ' (harus 0)');

console.log('\n=== RELEASE FILE (dist/, 2 file) ===');
for (const f of ['site-runtime.tar.gz', 'site-export.tar.gz']) {
  const p = path.join('dist', f);
  if (fs.existsSync(p)) console.log('  ' + f + '   ' + MB(fs.statSync(p).size));
}
console.log('\n  total release: ' + MB(d.bytes) + '  (2 file, dua-duanya < 2 GB limit GitHub)');
