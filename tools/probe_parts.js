// probe_parts.js — dump struktur part mesh showroom: field apa aja yang ada,
// di mana referensi tekstur sebenarnya disimpan.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const HASH = '9d4b5514b2e60e41';
const b = fs.readFileSync(path.join(ROOT, 'site/assets/mesh', HASH));
const hlen = b.readUInt32LE(4);
const hdr = JSON.parse(b.slice(8, 8 + hlen).toString('utf8'));

console.log('hdr keys: ' + Object.keys(hdr).join(', '));
console.log('parts: ' + hdr.parts.length);
console.log('\n=== PART[0] (semua field) ===');
console.log(JSON.stringify(hdr.parts[0], null, 1).slice(0, 2500));

// kumpulkan union semua key di semua part
const keys = new Set();
for (const p of hdr.parts) for (const k of Object.keys(p)) keys.add(k);
console.log('\n=== UNION KEY semua part ===');
console.log([...keys].sort().join(', '));

// cari field yang isinya string mirip path tekstur
console.log('\n=== FIELD yang mengandung string path ===');
const pathFields = {};
for (const p of hdr.parts) {
  for (const k of Object.keys(p)) {
    const v = p[k];
    const strs = [];
    const collect = (x) => {
      if (typeof x === 'string' && /\.i3[ias]|\.png|\.webp|^inline:/i.test(x)) strs.push(x);
      else if (Array.isArray(x)) x.forEach(collect);
      else if (x && typeof x === 'object') Object.values(x).forEach(collect);
    };
    collect(v);
    if (strs.length) { pathFields[k] = pathFields[k] || new Set(); strs.forEach(s => pathFields[k].add(s)); }
  }
}
for (const k of Object.keys(pathFields).sort()) {
  console.log('  ' + k + ' (' + pathFields[k].size + ' unik):');
  [...pathFields[k]].slice(0, 6).forEach(s => console.log('      ' + s));
  if (pathFields[k].size > 6) console.log('      ... +' + (pathFields[k].size - 6));
}
