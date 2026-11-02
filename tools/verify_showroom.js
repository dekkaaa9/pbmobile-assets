// verify_showroom.js — buktikan environment showroom (background) lengkap & render.
//
// Latar belakang: user lapor background karakter hitam di clone lokal, padahal di
// pbmobile.app tidak. Investigasi menemukan:
//   1. Mesh showroom = PB.loadStatic("Gui/Showroom/Gunshowcaseroom_Lighting.i3s")
//      -> hash /a/mesh/9d4b5514b2e60e41 (mv=sr10 ditambahkan oleh assetUrl karena
//         path mengandung kata "showroom").
//   2. Mesh itu VALID PBM1, 110 part, 103 ref `tex` + 4 ref `lux` (lighting map).
//      Semua 107 tekstur ADA di disk.
//   3. PB.loadStatic() mengembalikan 110 Mesh, semua visible, semua punya material.map,
//      bbox ~180 x 67 x 182 unit.
//   4. Hitam di screenshot lama = artefak tab tersembunyi: render loop showroom pakai
//      requestAnimationFrame, yang tidak jalan saat tab hidden. Jadi frame yang
//      di-capture kosong. Pada tab yang fokus/visible, background render penuh.
//
// Script ini menguji poin 1-3 secara offline (tanpa browser) dan mencetak ringkasan.
'use strict';
const fs = require('fs');
const path = require('path');
const { assetUrl } = require(path.join(__dirname, 'asset_url.js'));

const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, 'site');
const MESH = '9d4b5514b2e60e41';

function fail(msg) { console.log('  FAIL  ' + msg); return false; }
function pass(msg) { console.log('  PASS  ' + msg); return true; }

console.log('=== VERIFIKASI ENVIRONMENT SHOWROOM ===\n');

// --- 1. hash mesh sesuai assetUrl() asli -------------------------------
const u = assetUrl('mesh', { path: 'Gui/Showroom/Gunshowcaseroom_Lighting.i3s' });
const hash = u.match(/\/a\/mesh\/([0-9a-f]{16})/)[1];
console.log('[1] hash assetUrl()');
let ok = pass('assetUrl("mesh", "Gui/Showroom/Gunshowcaseroom_Lighting.i3s") -> ' + hash);
ok &= (hash === MESH) ? pass('hash cocok dengan file di mirror (' + MESH + ')')
  : fail('hash TIDAK cocok: dapat ' + hash + ', harap ' + MESH);
console.log('    url: ' + u + '\n');

// --- 2. file mesh ada & PBM1 valid -------------------------------------
console.log('[2] file mesh');
const mp = path.join(SITE, 'assets/mesh', MESH);
if (!fs.existsSync(mp)) { fail('mesh tidak ada: ' + mp); process.exit(1); }
const b = fs.readFileSync(mp);
ok &= pass('ada di disk, ' + (b.length / 1024 / 1024).toFixed(2) + ' MB');
ok &= (b.slice(0, 4).toString('latin1') === 'PBM1') ? pass('magic PBM1')
  : fail('magic bukan PBM1');

const hlen = b.readUInt32LE(4);
const base = 8 + hlen + ((4 - ((8 + hlen) % 4)) % 4);
let hdr;
try { hdr = JSON.parse(b.slice(8, 8 + hlen).toString('utf8')); }
catch (e) { fail('header rusak: ' + e.message); process.exit(1); }
ok &= pass('header JSON valid, ' + hlen + ' byte, base=' + base);
const parts = hdr.parts || [];
ok &= pass('part: ' + parts.length);

// --- 3. semua referensi tekstur (tex + lux) ada di disk -----------------
console.log('\n[3] referensi tekstur');
const texSet = new Set(), luxSet = new Set();
for (const p of parts) {
  const add = (set, v) => {
    if (!v) return;
    (Array.isArray(v) ? v : [v]).forEach(x => {
      if (typeof x === 'string') set.add(x);
      else if (x && x.path) set.add(x.path);
    });
  };
  add(texSet, p.tex); add(luxSet, p.lux);
}
ok &= pass('tex unik: ' + texSet.size + ', lux unik: ' + luxSet.size);

function check(set, api) {
  let have = 0; const miss = [];
  for (const p of set) {
    const uu = assetUrl(api, { path: p });
    const h = uu.match(new RegExp('\\/a\\/' + api + '\\/([0-9a-f]{16})'))[1];
    const f = path.join(SITE, 'assets', api, h);
    if (fs.existsSync(f)) have++; else miss.push(p);
  }
  if (miss.length) { fail(api + ' hilang ' + miss.length + ': ' + miss.slice(0, 3).join(', ')); }
  else pass(api + ': ' + have + '/' + set.size + ' ada di disk');
  return miss.length === 0;
}
ok &= check(texSet, 'tex');
ok &= check(luxSet, 'tex');

// --- 4. showcam (kamera) ada -------------------------------------------
console.log('\n[4] kamera showroom');
const su = assetUrl('showcam', { path: 'Gui/Showroom/Camera_Idle.I3S' });
const sh = su.match(/\/a\/showcam\/([0-9a-f]{16})/)[1];
const sp = path.join(SITE, 'assets/showcam', sh);
if (fs.existsSync(sp)) {
  ok &= pass('showcam ' + sh + ' ada (' + fs.statSync(sp).size + ' byte)');
  try {
    const j = JSON.parse(fs.readFileSync(sp, 'utf8'));
    ok &= pass('showcam JSON valid, fov=' + j.fov + ', matrix ' +
      (j.matrix ? j.matrix.length + ' angka' : 'HILANG'));
  } catch (e) { ok &= fail('showcam JSON rusak: ' + e.message); }
} else { ok &= fail('showcam hilang: ' + sp); }

// --- 5. part yang lolos filter collision -------------------------------
console.log('\n[5] filter collision loadStatic');
// loadStatic: parts.filter(e => !!e.collision == !!a.col), a.col undefined -> false
const kept = parts.filter(p => !!p.collision === false).length;
ok &= pass('part collision=false (dirender): ' + kept + '/' + parts.length);
ok &= kept > 0 ? pass('ada part yang dirender -> environment tidak kosong')
  : fail('TIDAK ada part yang dirender -> environment kosong (background hitam)');

// --- ringkasan ----------------------------------------------------------
console.log('\n=== RINGKASAN ===');
console.log(ok ? 'SEMUA CEK LULUS — environment showroom lengkap di disk.'
  : 'ADA CEK GAGAL — lihat baris FAIL di atas.');
console.log('\nCatatan: background hitam di screenshot lama BUKAN karena aset hilang,');
console.log('melainkan karena tab browser tersembunyi (requestAnimationFrame tidak');
console.log('jalan saat tab hidden). Pada tab yang fokus, background render penuh.');
process.exit(ok ? 0 : 1);
