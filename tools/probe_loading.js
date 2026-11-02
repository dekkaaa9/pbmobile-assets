// probe_loading.js — cari kode yang mengisi #loading dengan "Erro:"
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, 'site');

const files = ['static/client.js', 'static/v37/v37.js', 'static/game/bundle.js',
  'static/v37/screens/ready_root.js', 'static/v37/screens/_index.js'];

for (const f of files) {
  const p = path.join(SITE, f);
  if (!fs.existsSync(p)) continue;
  const s = fs.readFileSync(p, 'utf8');

  // cari "loading" sebagai id/getElementById
  const pats = [
    /getElementById\(["']loading["']\)/g,
    /["']loading["']/g,
    /loadingEl/g,
  ];
  for (const re of pats) {
    re.lastIndex = 0;
    let m, n = 0;
    while ((m = re.exec(s)) && n < 6) {
      const a = Math.max(0, m.index - 350), b = Math.min(s.length, m.index + 350);
      console.log('=== ' + f + ' @' + m.index + ' ===');
      console.log('  ...' + s.slice(a, b).replace(/\n/g, ' ') + '...');
      console.log('');
      n++;
    }
    if (n) break;
  }
}
