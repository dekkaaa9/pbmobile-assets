const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, 'site');

function dirStats(p) {
  if (!fs.existsSync(p)) return { files: 0, mb: 0 };
  let files = 0, bytes = 0;
  const walk = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else { files++; bytes += fs.statSync(f).size; }
    }
  };
  walk(p);
  return { files, mb: bytes / 1048576 };
}

const rows = [];
const add = (label, p) => {
  const s = dirStats(p);
  rows.push([label, s.files, s.mb]);
};

add('site/ (code + html)', path.join(SITE));
add('site/assets/ (raw /a/ mirror)', path.join(SITE, 'assets'));
add('site/export/tex/ (.webp)', path.join(SITE, 'export', 'tex'));
add('site/export/glb/ (.glb)', path.join(SITE, 'export', 'glb'));
add('site/export/maps/ (stage json)', path.join(SITE, 'export', 'maps'));

console.log('section'.padEnd(34), 'files'.padStart(7), 'MB'.padStart(9));
console.log('-'.repeat(52));
for (const [l, f, mb] of rows) console.log(l.padEnd(34), String(f).padStart(7), mb.toFixed(1).padStart(9));

// breakdown by api
console.log('\n--- site/assets by api ---');
for (const api of fs.readdirSync(path.join(SITE, 'assets'))) {
  const s = dirStats(path.join(SITE, 'assets', api));
  console.log('  ' + api.padEnd(12), String(s.files).padStart(6), s.mb.toFixed(1).padStart(9) + ' MB');
}
console.log('\n--- site/export/glb by api ---');
for (const api of fs.readdirSync(path.join(SITE, 'export', 'glb')).filter(d => fs.statSync(path.join(SITE, 'export', 'glb', d)).isDirectory())) {
  const s = dirStats(path.join(SITE, 'export', 'glb', api));
  console.log('  ' + api.padEnd(12), String(s.files).padStart(6), s.mb.toFixed(1).padStart(9) + ' MB');
}

// glb manifest totals
const man = JSON.parse(fs.readFileSync(path.join(SITE, 'export', 'glb', 'manifest.json'), 'utf8'));
let tris = 0, verts = 0, parts = 0, files = 0;
for (const api of Object.keys(man)) for (const f of Object.keys(man[api])) {
  const e = man[api][f];
  if (e && !e.empty && !e.error) { tris += e.tris; verts += e.verts; parts += e.parts; files++; }
}
console.log('\nGLB totals: files=' + files + ' parts=' + parts + ' verts=' + verts + ' tris=' + Math.round(tris));

// map index
const maps = JSON.parse(fs.readFileSync(path.join(SITE, 'export', 'maps', '_index.json'), 'utf8'));
console.log('maps: ' + maps.length);
