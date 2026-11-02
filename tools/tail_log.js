// tail_log.js — baca server.log dari posisi terakhir, tampilkan request baru
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const LOG = path.join(ROOT, 'server.log');
const MARK = path.join(ROOT, '.logmark');

let pos = 0;
if (fs.existsSync(MARK)) pos = Number(fs.readFileSync(MARK, 'utf8')) || 0;
const st = fs.statSync(LOG);
if (pos > st.size) pos = 0;
const fd = fs.openSync(LOG, 'r');
const len = st.size - pos;
const buf = Buffer.alloc(len);
fs.readSync(fd, buf, 0, len, pos);
fs.closeSync(fd);
fs.writeFileSync(MARK, String(st.size));

const txt = buf.toString('utf8');
const lines = txt.split('\n').filter(Boolean);
console.log('baris baru: ' + lines.length);

const bad = lines.filter(l => /404/.test(l));
console.log('404 baru: ' + bad.length);
for (const l of bad) console.log('  ' + l);

// ringkasan per kategori
const cats = {};
for (const l of lines) {
  const m = l.match(/GET (\S+)/);
  if (!m) continue;
  const u = m[1].split('?')[0];
  const cat = u.startsWith('/a/') ? '/a/' + u.split('/')[2]
    : u.startsWith('/static/') ? '/static/' + u.split('/')[2]
      : u.startsWith('/rml/') ? '/rml/' + u.split('/')[2]
        : u;
  cats[cat] = cats[cat] || { n: 0, bad: 0 };
  cats[cat].n++;
  if (/404/.test(l)) cats[cat].bad++;
}
console.log('\n=== ringkasan ===');
for (const k of Object.keys(cats).sort()) {
  console.log('  ' + k.padEnd(30) + ' ' + String(cats[k].n).padStart(4) + ' req, ' + cats[k].bad + ' 404');
}
