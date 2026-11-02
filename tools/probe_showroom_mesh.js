// probe_showroom_mesh.js — periksa mesh showroom: valid PBM1? texRef-nya apa?
// mana yang ada di disk, mana yang mati upstream?
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, 'site');
const { assetUrl } = require(path.join(ROOT, 'tools/asset_url.js'));

const HASH = '9d4b5514b2e60e41';
const p = path.join(SITE, 'assets/mesh', HASH);

if (!fs.existsSync(p)) { console.log('MESH TIDAK ADA: ' + p); process.exit(1); }
const b = fs.readFileSync(p);
console.log('size      : ' + b.length + ' bytes');
console.log('magic     : ' + JSON.stringify(b.slice(0, 4).toString('latin1')));

const hlen = b.readUInt32LE(4);
const base = 8 + hlen + ((4 - ((8 + hlen) % 4)) % 4);
console.log('headerLen : ' + hlen);
console.log('base      : ' + base);

let hdr;
try { hdr = JSON.parse(b.slice(8, 8 + hlen).toString('utf8')); }
catch (e) { console.log('HEADER RUSAK: ' + e.message); process.exit(1); }
console.log('hdr keys  : ' + Object.keys(hdr).join(', '));

const parts = hdr.parts || [];
console.log('parts     : ' + parts.length);

// kumpulkan semua referensi tekstur
const texSet = new Set();
for (const pt of parts) {
  const t = pt.tex || pt.texs || pt.textures || pt.t;
  if (!t) continue;
  const arr = Array.isArray(t) ? t : [t];
  for (const x of arr) {
    if (typeof x === 'string') texSet.add(x);
    else if (x && x.path) texSet.add(x.path);
  }
}
console.log('texRefs   : ' + texSet.size);

// cek tiap tekstur: hash -> ada di disk?
function head(u) {
  return new Promise(res => {
    const r = https.request('https://pbmobile.app' + u, { method: 'GET', timeout: 60000 }, resp => {
      resp.resume(); resp.on('end', () => res(resp.statusCode));
    });
    r.on('timeout', function () { this.destroy(); res(0); });
    r.on('error', () => res(0));
    r.end();
  });
}

(async () => {
  const list = [...texSet];
  const have = [], miss = [];
  for (const t of list) {
    const u = assetUrl('tex', { path: t });
    const hash = u.match(/\/a\/tex\/([0-9a-f]{16})/)[1];
    const f = path.join(SITE, 'assets/tex', hash);
    if (fs.existsSync(f)) have.push({ path: t, hash, size: fs.statSync(f).size });
    else miss.push({ path: t, hash, url: u });
  }
  console.log('\n=== TEKSTUR ===');
  console.log('  ada di disk : ' + have.length);
  console.log('  HILANG      : ' + miss.length);

  console.log('\n--- HILANG (cek upstream) ---');
  const q = miss.slice();
  const dead = [], live = [];
  async function w() {
    while (q.length) {
      const m = q.shift();
      const st = await head(m.url);
      if (st === 200) { live.push(m); console.log('  HIDUP  ' + m.hash + '  ' + m.path); }
      else { dead.push(m); console.log('  MATI   ' + m.hash + '  ' + m.path + ' [' + st + ']'); }
    }
  }
  await Promise.all(Array.from({ length: 6 }, w));

  console.log('\nringkasan: ' + have.length + ' ada, ' + live.length + ' hidup-belum-diunduh, ' + dead.length + ' mati');
  fs.writeFileSync(path.join(ROOT, 'showroom_missing.json'),
    JSON.stringify({ live, dead }, null, 1));
  console.log('tulis showroom_missing.json');
})();
