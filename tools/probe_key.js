// probe_key.js — cari asal key `k` buat battle WebSocket di net.js.
// Pertanyaan: k datang dari mana? lobby WS? HTTP? sessionStorage?
'use strict';
const fs = require('fs');
const path = require('path');
const s = fs.readFileSync(path.resolve(__dirname, '../site/static/game/net.js'), 'utf8');

const pats = [
  ['"?k="', '" ?k=" literal'],
  ['new WebSocket', 'konstruktor WebSocket'],
  ['pbweb_battle', 'sessionStorage pbweb_battle'],
  ['sessionStorage', 'semua sessionStorage'],
  ['/b1', 'path /b1'],
  ['/b2', 'path /b2'],
  ['binaryType', 'binaryType'],
];

for (const [needle, label] of pats) {
  const idxs = [];
  let i = -1;
  while ((i = s.indexOf(needle, i + 1)) >= 0) idxs.push(i);
  console.log('=== ' + label + '  (' + idxs.length + 'x) ===');
  for (const i of idxs.slice(0, 4)) {
    console.log('  @' + i + ': ...' + s.slice(Math.max(0, i - 450), i + 350).replace(/\n/g, ' ') + '...');
    console.log('');
  }
}
