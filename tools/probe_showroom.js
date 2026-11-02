// probe_showroom.js — cari gimana showroom stage di-load, path asetnya apa
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, 'site');

const files = ['static/v37/showroom.js', 'static/game/pb.js', 'static/client.js',
  'static/game/bundle.js'];

for (const f of files) {
  const p = path.join(SITE, f);
  if (!fs.existsSync(p)) continue;
  const s = fs.readFileSync(p, 'utf8');

  const pats = [
    [/showroom/gi, 'showroom'],
    [/["'`]stage["'`]/g, 'stage'],
    [/MAP_V/g, 'MAP_V'],
    [/sr10/g, 'sr10'],
    [/Showroom/g, 'Showroom'],
  ];
  for (const [re, label] of pats) {
    re.lastIndex = 0;
    let m, n = 0;
    while ((m = re.exec(s)) && n < 8) {
      const a = Math.max(0, m.index - 250), b = Math.min(s.length, m.index + 250);
      console.log('=== ' + f + ' [' + label + '] @' + m.index + ' ===');
      console.log('  ...' + s.slice(a, b).replace(/\n/g, ' ') + '...');
      console.log('');
      n++;
    }
  }
}
