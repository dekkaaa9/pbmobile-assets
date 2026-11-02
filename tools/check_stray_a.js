// check_stray_a.js — direktori site/a/ adalah sisa bug path lama
// (/a/<api>/<hash> salah simpan ke site/a/ instead of site/assets/).
// Cek: mana yang UNIK (belum ada di assets/) dan mana yang duplikat.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, 'site');

function walk(dir, out) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const strayDir = path.join(SITE, 'a');
const assetsDir = path.join(SITE, 'assets');
if (!fs.existsSync(strayDir)) { console.log('tidak ada site/a/ — bersih'); process.exit(0); }

const stray = walk(strayDir, []);
console.log('site/a/ : ' + stray.length + ' file');

// peta api -> set hash yang sudah ada di assets/
const have = {};
for (const api of fs.readdirSync(assetsDir)) {
  const d = path.join(assetsDir, api);
  if (!fs.statSync(d).isDirectory()) continue;
  have[api] = new Set(fs.readdirSync(d));
}

const uniq = [], dup = [];
for (const f of stray) {
  const rel = path.relative(strayDir, f).replace(/\\/g, '/');
  const m = rel.match(/^([a-z]+)\/([0-9a-f]{16})$/i);
  if (!m) { uniq.push({ rel, why: 'nama tidak dikenali' }); continue; }
  const api = m[1], hash = m[2];
  if (have[api] && have[api].has(hash)) dup.push(rel);
  else uniq.push({ rel, api, hash });
}

console.log('  duplikat (sudah ada di assets/): ' + dup.length);
console.log('  UNIK (belum ada di assets/)    : ' + uniq.length);

if (uniq.length) {
  console.log('\n--- file UNIK ---');
  const byApi = {};
  for (const u of uniq) { const k = u.api || '?'; (byApi[k] = byApi[k] || []).push(u); }
  for (const k of Object.keys(byApi).sort()) {
    console.log('  ' + k + ' (' + byApi[k].length + '):');
    byApi[k].slice(0, 10).forEach(u => console.log('      ' + u.rel));
    if (byApi[k].length > 10) console.log('      ... +' + (byApi[k].length - 10));
  }
  // tulis daftar buat dipindah
  const moves = uniq.filter(u => u.api).map(u => ({
    from: path.join(SITE, 'a', u.api, u.hash),
    to: path.join(SITE, 'assets', u.api, u.hash),
    api: u.api, hash: u.hash,
    size: fs.statSync(path.join(SITE, 'a', u.api, u.hash)).size
  }));
  fs.writeFileSync(path.join(ROOT, 'stray_moves.json'), JSON.stringify(moves, null, 1));
  console.log('\ntulis stray_moves.json (' + moves.length + ' file buat dipindah)');
}
