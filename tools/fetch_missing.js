// fetch_missing.js — ambil file yang direferensikan client tapi belum ter-mirror.
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, 'site');
const CONC = Number(process.env.CONC || 6);

function get(url, dest) {
  return new Promise((res, rej) => {
    https.get(url, { timeout: 120000 }, r => {
      if (r.statusCode !== 200) { r.resume(); return rej(new Error('HTTP ' + r.statusCode)); }
      const tmp = dest + '.part';
      const out = fs.createWriteStream(tmp);
      r.pipe(out);
      out.on('finish', () => out.close(() => { fs.renameSync(tmp, dest); res(); }));
      out.on('error', e => { try { fs.unlink(tmp, () => {}); } catch (_) {} rej(e); });
    }).on('timeout', function () { this.destroy(); }).on('error', e => {
      try { fs.unlink(dest + '.part', () => {}); } catch (_) {}
      rej(e);
    });
  });
}

// daftar file yang diketahui hilang + tambahan dari console log browser
const FILES = [
  '/static/game/accessories.json',
  '/static/game/ranks.json',
  '/static/game/titles.json',
  '/static/hud.html',
  '/static/icon-180.png',
  '/static/icon-192.png',
  '/static/sound/menu_bgm.mp3',
  '/static/v37/atlas/ui_source01.png',
  '/static/v37/crate/token.png',
  '/static/v37/skin/shop_tab_blank.png',
  '/static/v37/screens/_index.js',
  '/static/v37/screens/ready_root.js',
  '/rml/fonts/Rajdhani-SemiBold.ttf',
  '/rml/namecards/manifest.txt',
  '/static/i18n.js',
];

(async () => {
  let ok = 0; const failed = [];
  const q = FILES.slice();
  async function worker() {
    while (q.length) {
      const u = q.shift();
      const dest = path.join(SITE, u.replace(/^\//, ''));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      try {
        await get('https://pbmobile.app' + u, dest);
        const sz = fs.statSync(dest).size;
        console.log('  OK   ' + u.padEnd(46) + (sz / 1024).toFixed(1) + ' KB');
        ok++;
      } catch (e) {
        console.log('  FAIL ' + u.padEnd(46) + e.message);
        failed.push(u + ' (' + e.message + ')');
      }
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  console.log('\nok=' + ok + ' fail=' + failed.length);
  if (failed.length) console.log('failed:\n  ' + failed.join('\n  '));
})();
