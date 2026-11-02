// find_missing.js — client asli mereferensikan banyak file. Kita harvest SEMUA
// URL dari index.html + modul JS, cek mana yang 404 di server lokal, supaya
// tahu persis file apa yang belum ter-mirror.
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, 'site');
const PORT = Number(process.env.PORT || 8787);

// file yang akan di-scan untuk referensi
const scanFiles = [
  'index.html', 'cc.js',
  'static/client.js', 'static/i18n.js', 'static/social.js',
  'static/premium.js', 'static/perfil.js', 'static/vip.js', 'static/pass.js',
  'static/crate.js', 'static/clan.js', 'static/tour.js',
  'static/v37/v37.js', 'static/v37/option.js', 'static/v37/showroom.js',
  'static/game/pb.js', 'static/game/net.js', 'static/game/bundle.js',
];

// pola path yang dirujuk client
const PATTERNS = [
  /["'`](\/static\/[A-Za-z0-9_\-./]+\.(?:js|json|png|jpg|webp|mp3|wav|ogg|css|html|webmanifest))["'`]/gi,
  /["'`](\/rml\/[A-Za-z0-9_\-./]+)["'`]/gi,
  /["'`](\/a\/[a-z]+\/[0-9a-f]{16})["'`]/gi,
  /["'`](\/sectors\/[A-Za-z0-9_\-./]+)["'`]/gi,
  /["'`](\/api\/[A-Za-z0-9_\-./]+)["'`]/gi,
  /["'`](\/[A-Za-z0-9_\-]+\.json)["'`]/gi,
];

function harvest() {
  const set = new Set();
  for (const f of scanFiles) {
    const p = path.join(SITE, f);
    if (!fs.existsSync(p)) continue;
    const s = fs.readFileSync(p, 'utf8');
    for (const re of PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(s))) {
        let u = m[1];
        // buang query string
        u = u.split('?')[0];
        if (/\.js$|\.json$|\.png$|\.jpg$|\.webp$|\.mp3$|\.wav$|\.ogg$|\.css$|\.html$|\.webmanifest$|\.txt$/.test(u) ||
            /^\/rml\//.test(u) || /^\/sectors\//.test(u) || /^\/api\//.test(u)) set.add(u);
      }
    }
  }
  return [...set].sort();
}

function check(url) {
  return new Promise((res) => {
    http.get('http://localhost:' + PORT + url, { timeout: 15000 }, r => {
      res({ url, status: r.statusCode, len: Number(r.headers['content-length'] || 0) });
      r.resume();
    }).on('timeout', function () { this.destroy(); res({ url, status: 0, len: 0 }); })
      .on('error', () => res({ url, status: 0, len: 0 }));
  });
}

(async () => {
  const urls = harvest();
  console.log('URL yang direferensikan client:', urls.length);
  const results = [];
  const q = urls.slice();
  async function w() {
    while (q.length) results.push(await check(q.shift()));
  }
  await Promise.all(Array.from({ length: 12 }, w));

  const ok = results.filter(r => r.status === 200);
  const bad = results.filter(r => r.status !== 200);
  console.log('OK  :', ok.length);
  console.log('BAD :', bad.length);
  console.log('\n=== yang 404 / gagal ===');
  for (const r of bad) console.log('  ' + String(r.status).padStart(4) + '  ' + r.url);

  fs.writeFileSync(path.join(ROOT, 'missing_urls.json'), JSON.stringify(bad, null, 1));
  console.log('\ntulis ke missing_urls.json');
})();
