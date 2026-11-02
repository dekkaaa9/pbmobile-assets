// fetch_404.js — parse server.log, kumpulkan semua URL yang 404, lalu ambil
// dari pbmobile.app. Ini menutup gap file yang direferensikan client asli.
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, 'site');
const LOG = path.join(ROOT, 'server.log');
const CONC = Number(process.env.CONC || 6);

// ---- parse log ----
const log = fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8') : '';
const re = /GET (\S+)\s+->\s+(404|404 asset)/g;
const set = new Set();
let m;
while ((m = re.exec(log))) {
  let u = m[1];
  // buang query string (?v=...)
  u = u.split('?')[0];
  if (u.startsWith('/cdn-cgi/')) continue;   // cloudflare, nggak bisa di-mirror
  set.add(u);
}
const urls = [...set].sort();
console.log('URL 404 di server.log:', urls.length);

// ---- cek mana yang sudah ada sekarang ----
const todo = urls.filter(u => {
  const dest = path.join(SITE, u.replace(/^\//, ''));
  return !fs.existsSync(dest);
});
console.log('belum ada di disk:', todo.length);
for (const u of urls) {
  const dest = path.join(SITE, u.replace(/^\//, ''));
  console.log('  ' + (fs.existsSync(dest) ? 'ADA ' : 'HILANG') + '  ' + u);
}

// ---- fetch ----
function get(url, dest) {
  return new Promise((res, rej) => {
    https.get(url, { timeout: 120000 }, r => {
      if (r.statusCode !== 200) { r.resume(); return rej(new Error('HTTP ' + r.statusCode)); }
      const tmp = dest + '.part';
      const out = fs.createWriteStream(tmp);
      r.pipe(out);
      out.on('finish', () => out.close(() => { fs.renameSync(tmp, dest); res(); }));
      out.on('error', e => { try { fs.unlinkSync(tmp); } catch (_) {} rej(e); });
    }).on('timeout', function () { this.destroy(); }).on('error', e => {
      try { fs.unlinkSync(dest + '.part'); } catch (_) {}
      rej(e);
    });
  });
}

(async () => {
  let ok = 0; const failed = [];
  const q = todo.slice();
  async function worker() {
    while (q.length) {
      const u = q.shift();
      // /a/<api>/<hash> -> site/assets/<api>/<hash>  (server baca dari assets/)
      const rel = u.replace(/^\//, '');
      const dest = path.join(SITE, rel.startsWith('a' + path.sep) ? 'assets' + rel.slice(1) : rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      try {
        await get('https://pbmobile.app' + u, dest);
        const sz = fs.statSync(dest).size;
        console.log('  OK   ' + u.padEnd(52) + (sz / 1024).toFixed(1) + ' KB');
        ok++;
      } catch (e) {
        console.log('  FAIL ' + u.padEnd(52) + e.message);
        failed.push(u + ' (' + e.message + ')');
      }
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  console.log('\nok=' + ok + ' fail=' + failed.length);
  if (failed.length) console.log('gagal:\n  ' + failed.join('\n  '));
})();
