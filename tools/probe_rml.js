// probe_rml.js — cari gimana client membangun path /rml/ (clanmark, gen, items)
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, 'site');

const files = [
  'static/client.js', 'static/game/bundle.js', 'static/game/pb.js',
  'static/social.js', 'static/premium.js', 'static/clan.js',
  'static/crate.js', 'static/tour.js', 'static/vip.js', 'static/pass.js',
  'static/perfil.js', 'static/v37/v37.js', 'static/v37/option.js',
  'static/v37/showroom.js', 'static/v37/screens/_index.js',
  'static/v37/screens/ready_root.js', 'index.html',
];

for (const f of files) {
  const p = path.join(SITE, f);
  if (!fs.existsSync(p)) continue;
  const s = fs.readFileSync(p, 'utf8');
  const found = new Set();
  // literal "/rml/..."
  let re = /["'`](\/rml\/[^"'`]*)["'`]/g;
  let m;
  while ((m = re.exec(s))) found.add('LITERAL  ' + m[1]);
  // konstruksi: "rml/" + sesuatu
  re = /["'`](\/?rml\/)["'`]/g;
  while ((m = re.exec(s))) found.add('PREFIX   ' + m[1]);
  if (found.size) {
    console.log('=== ' + f);
    for (const u of [...found].sort()) console.log('   ' + u);
  }
}

// juga cari di server.log: path /rml/ apa aja yang di-request client
const log = fs.existsSync(path.join(ROOT, 'server.log'))
  ? fs.readFileSync(path.join(ROOT, 'server.log'), 'utf8') : '';
const req = new Set();
re = /GET (\/rml\/\S*)/g;
while ((m = re.exec(log))) req.add(m[1].split('?')[0]);
console.log('\n=== /rml/ yang di-request client (dari server.log) ===');
for (const u of [...req].sort()) console.log('   ' + u);
