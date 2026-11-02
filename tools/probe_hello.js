// probe_hello.js — ekstrak bentuk persis pesan handshake lobby (`hello`/`resume`)
// dan cari pesan lobby yang membawa {u, k} (endpoint battle).
'use strict';
const fs = require('fs');
const path = require('path');
const s = fs.readFileSync(path.resolve(__dirname, '../site/static/game/net.js'), 'utf8');

// 1. handshake hello/resume
const i = s.indexOf('"resume"');
console.log('=== HANDSHAKE LOBBY (hello / resume) ===');
console.log(s.slice(Math.max(0, i - 500), i + 1400));
console.log('');

// 2. cari tempat C(...) dipanggil (penerima {u,k})
console.log('\n=== SIAPA KIRIM {u,k} KE C() ===');
let j = -1, n = 0;
while ((j = s.indexOf('C(', j + 1)) >= 0 && n < 12) {
  const ctx = s.slice(Math.max(0, j - 300), j + 120);
  if (/^C\(/.test(s.slice(j)) || /[^a-zA-Z_$]C\(/.test(ctx.slice(-40))) {
    console.log('  @' + j + ': ...' + ctx.replace(/\n/g, ' ') + '...');
    console.log('');
    n++;
  }
}

// 3. cari "battle" sebagai tipe pesan
console.log('\n=== PESAN LOBBY BERTIPE battle ===');
j = -1; n = 0;
while ((j = s.indexOf('battle', j + 1)) >= 0 && n < 10) {
  console.log('  @' + j + ': ...' + s.slice(Math.max(0, j - 260), j + 200).replace(/\n/g, ' ') + '...');
  console.log('');
  n++;
}
