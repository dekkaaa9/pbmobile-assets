// ws_probe.js — cek di server.log apakah client mencoba upgrade WebSocket,
// dan ke path apa saja.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const LOG = path.join(ROOT, 'server.log');

if (!fs.existsSync(LOG)) { console.log('server.log tidak ada'); process.exit(0); }
const log = fs.readFileSync(LOG, 'utf8');
const lines = log.split('\n');

const ws = lines.filter(l => /WS upgrade|WS close|WS recv|WS t=|WS \(bukan/.test(l));
console.log('=== aktivitas WebSocket (' + ws.length + ' baris) ===');
for (const l of ws.slice(0, 60)) console.log('  ' + l);

// juga hitung total request & 404 terakhir
const gets = lines.filter(l => /^\d\d:\d\d:\d\d\s+GET/.test(l));
const posts = lines.filter(l => /^\d\d:\d\d:\d\d\s+POST/.test(l));
console.log('\ntotal GET : ' + gets.length);
console.log('total POST: ' + posts.length);

// 404 terakhir (setelah semua fetch)
const last404 = lines.filter(l => /404/.test(l));
console.log('total 404 : ' + last404.length);
