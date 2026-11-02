// local_state.js — ukuran seberapa lokal client-nya sekarang:
//   1. berapa file sudah ada di disk per kategori
//   2. path 404 di log: mana yang MATI upstream vs mana yang BELUM ter-mirror
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, 'site');
const LOG = path.join(ROOT, 'server.log');

// ---- 1. inventaris disk ----
function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const all = walk(SITE, []);
let bytes = 0;
for (const f of all) bytes += fs.statSync(f).size;

const byCat = {};
for (const f of all) {
  const rel = path.relative(SITE, f).replace(/\\/g, '/');
  let cat;
  if (rel.startsWith('assets/')) cat = 'assets/' + rel.split('/')[1];
  else if (rel.startsWith('static/')) cat = 'static/' + rel.split('/')[1];
  else if (rel.startsWith('export/')) cat = 'export';
  else cat = '(root)';
  byCat[cat] = byCat[cat] || { n: 0, b: 0 };
  byCat[cat].n++;
  byCat[cat].b += fs.statSync(f).size;
}
console.log('=== ISI DISK site/ ===');
console.log('  total: ' + all.length + ' file, ' + (bytes / 1048576).toFixed(1) + ' MB');
for (const k of Object.keys(byCat).sort()) {
  console.log('  ' + k.padEnd(24) + String(byCat[k].n).padStart(6) + ' file  ' + (byCat[k].b / 1048576).toFixed(1).padStart(8) + ' MB');
}

// ---- 2. path 404 di log ----
const log = fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8') : '';
const set = new Set();
const re = /GET (\S+)\s+->\s+404/g;
let m;
while ((m = re.exec(log))) {
  let u = m[1].split('?')[0];
  if (u.startsWith('/cdn-cgi/')) continue;
  set.add(u);
}
const urls = [...set].sort();
const missing = urls.filter(u => {
  const rel = u.replace(/^\//, '');
  const dest = path.join(SITE, rel.startsWith('a/') ? 'assets' + rel.slice(1) : rel);
  return !fs.existsSync(dest);
});
console.log('\n=== PATH 404 DI LOG ===');
console.log('  distinct        : ' + urls.length);
console.log('  sudah ada di disk: ' + (urls.length - missing.length));
console.log('  belum ada       : ' + missing.length);

// ---- 3. cek upstream: mana yang mati beneran ----
function head(u) {
  return new Promise(res => {
    const r = https.request('https://pbmobile.app' + u, { method: 'GET', timeout: 60000 }, resp => {
      resp.resume();
      resp.on('end', () => res(resp.statusCode));
    });
    r.on('timeout', function () { this.destroy(); res(0); });
    r.on('error', () => res(0));
    r.end();
  });
}
(async () => {
  console.log('\n=== CEK UPSTREAM (yang belum ada di disk) ===');
  const dead = [], live = [];
  const q = missing.slice();
  async function w() {
    while (q.length) {
      const u = q.shift();
      const st = await head(u);
      if (st === 200) live.push(u); else dead.push(u + ' [' + st + ']');
    }
  }
  await Promise.all(Array.from({ length: 6 }, w));
  console.log('  MASIH HIDUP di pbmobile.app (bisa di-mirror): ' + live.length);
  for (const u of live) console.log('    ' + u);
  console.log('  MATI upstream (nggak bisa didapat): ' + dead.length);
  for (const u of dead) console.log('    ' + u);
  fs.writeFileSync(path.join(ROOT, 'still_live.json'), JSON.stringify(live, null, 1));
})();
