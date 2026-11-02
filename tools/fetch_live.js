// fetch_live.js — mirror 255 aset yang masih hidup upstream (dari still_live.json)
// supaya client jalan 100% offline, nol request ke pbmobile.app.
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, 'site');
const CONC = Number(process.env.CONC || 8);

const live = JSON.parse(fs.readFileSync(path.join(ROOT, 'still_live.json'), 'utf8'));
console.log('target: ' + live.length + ' file');

function get(url, dest) {
  return new Promise((res, rej) => {
    https.get(url, { timeout: 180000 }, r => {
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
  let ok = 0, skip = 0, bytes = 0; const failed = [];
  const q = live.slice();
  async function worker() {
    while (q.length) {
      const u = q.shift();
      const rel = u.replace(/^\//, '');
      const dest = path.join(SITE, rel.startsWith('a/') ? 'assets' + rel.slice(1) : rel);
      if (fs.existsSync(dest)) { skip++; continue; }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      try {
        await get('https://pbmobile.app' + u, dest);
        const sz = fs.statSync(dest).size;
        bytes += sz; ok++;
      } catch (e) { failed.push(u + ' (' + e.message + ')'); }
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  console.log('ok=' + ok + ' skip(sudah ada)=' + skip + ' fail=' + failed.length);
  console.log('total diunduh: ' + (bytes / 1048576).toFixed(1) + ' MB');
  if (failed.length) console.log('gagal:\n  ' + failed.join('\n  '));
})();
