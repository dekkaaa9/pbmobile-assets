// probe_err.js — cari dari mana "Erro: undefined" berasal
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, 'site');

const files = ['static/client.js', 'static/v37/v37.js', 'static/game/bundle.js',
  'static/game/pb.js', 'static/social.js', 'static/v37/screens/_index.js',
  'static/v37/screens/ready_root.js', 'index.html'];

for (const f of files) {
  const p = path.join(SITE, f);
  if (!fs.existsSync(p)) continue;
  const s = fs.readFileSync(p, 'utf8');
  const lines = s.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (/Erro/.test(lines[i])) {
      const a = Math.max(0, i - 3), b = Math.min(lines.length, i + 4);
      console.log('=== ' + f + ' baris ' + (i + 1) + ' ===');
      for (let k = a; k < b; k++) console.log('  ' + (k + 1) + '| ' + lines[k].slice(0, 400));
      console.log('');
    }
  }
}
