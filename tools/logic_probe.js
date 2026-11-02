// logic_probe.js — dari bundle.readable.js, ambil cuplikan logika inti supaya
// kelihatan bentuk aslinya: damage, recoil, movement, hit-registration.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const s = fs.readFileSync(path.join(ROOT, 'site/static/game/bundle.readable.js'), 'utf8');
const lines = s.split('\n');

function show(label, pattern, before = 2, after = 14, max = 2) {
  console.log('\n' + '='.repeat(72));
  console.log('=== ' + label + '  /' + pattern.source + '/');
  console.log('='.repeat(72));
  const re = new RegExp(pattern.source, pattern.flags);
  let n = 0;
  for (let i = 0; i < lines.length && n < max; i++) {
    if (re.test(lines[i])) {
      const a = Math.max(0, i - before), b = Math.min(lines.length, i + after);
      console.log('--- baris ' + (a + 1) + '-' + b + ' ---');
      for (let k = a; k < b; k++) console.log(String(k + 1).padStart(6) + '| ' + lines[k]);
      n++;
    }
  }
  if (n === 0) console.log('(tidak ditemukan)');
}

// hit registration: kirim {t:"hit",target,from,dmg,head,helm,w}
show('HIT REGISTRATION', /t:\s*["']hit["']/);
// damage / head multiplier
show('DAMAGE + HEAD', /headMul|dmgRate/);
// recoil
show('RECOIL', /rec\s*\.\s*vA|vA\s*\*/);
// movement speed
show('MOVEMENT', /botRun|eyeCrouch/);
