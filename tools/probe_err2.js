// probe_err2.js — cari mekanisme layar error di client.js
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, 'site');

const s = fs.readFileSync(path.join(SITE, 'static/client.js'), 'utf8');
const lines = s.split('\n');

// cari kata kunci terkait error screen
const KEYS = ['errEl', 'errBox', 'showErr', 'fatal', 'crash', 'boot', 'catch(',
  'addEventListener("error"', 'onerror', 'unhandledrejection', 'reportError'];

for (const k of KEYS) {
  const idx = [];
  for (let i = 0; i < lines.length; i++) if (lines[i].includes(k)) idx.push(i);
  if (!idx.length) continue;
  console.log('=== "' + k + '" — ' + idx.length + ' baris ===');
  for (const i of idx.slice(0, 3)) {
    const a = Math.max(0, i - 2), b = Math.min(lines.length, i + 6);
    for (let j = a; j < b; j++) console.log('  ' + (j + 1) + '| ' + lines[j].slice(0, 500));
    console.log('  ---');
  }
}
