// bundle_audit.js — inventaris struktur bundle.js: sistem apa aja yang ada di
// dalam 1 MB kode ter-minify, dan mana yang bisa dipisah/dipakai ulang.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const s = fs.readFileSync(path.join(ROOT, 'site/static/game/bundle.js'), 'utf8');

console.log('ukuran: ' + (s.length / 1024).toFixed(1) + ' KB, ' + s.length + ' char');
console.log('baris: ' + s.split('\n').length);

// ---- hitung konstruksi sintaksis ----
const count = (re) => (s.match(re) || []).length;
console.log('\n=== konstruksi sintaksis ===');
console.log('  function   :', count(/\bfunction\b/g));
console.log('  => (arrow) :', count(/=>/g));
console.log('  class      :', count(/\bclass\s+[\w$]/g));
console.log('  const/let  :', count(/\b(?:const|let|var)\s+[\w$]{1,3}\s*=/g));
console.log('  new X()    :', count(/\bnew\s+[A-Za-z_$][\w$]*/g));
console.log('  .prototype :', count(/\.prototype\./g));
console.log('  try{}      :', count(/\btry\s*\{/g));

// ---- cari nama identifier yang sering dipakai (kandidat sistem) ----
console.log('\n=== identifier paling sering dipakai (top 40) ===');
const freq = {};
const re = /\b([A-Za-z_$][A-Za-z0-9_$]{2,24})\b/g;
let m;
while ((m = re.exec(s))) {
  const w = m[1];
  if (/^(const|let|var|function|return|if|else|for|while|new|this|typeof|instanceof|class|extends|import|export|default|true|false|null|undefined|void|delete|in|of|do|switch|case|break|continue|throw|try|catch|finally|await|async|yield|string|number|boolean|object|symbol|bigint)$/.test(w)) continue;
  freq[w] = (freq[w] || 0) + 1;
}
const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 40);
for (const [w, n] of top) console.log('  ' + w.padEnd(22) + n);

// ---- cari sistem lewat kata kunci domain ----
console.log('\n=== sistem yang terdeteksi (kata kunci domain) ===');
const systems = [
  ['anti-cheat', /\b(?:Ac|Lc|Cc|Rc|Pc|Ic|Sc|bt)\s*[=(]/g],
  ['websocket / net', /\bWebSocket\b|\bRTCDataChannel\b|binaryType|arraybuffer/g],
  ['hit / damage', /\bhit\b|\bdmg\b|\bhead\b|\bhelm\b|\bpenetrat/g],
  ['recoil / spread', /\brecoil\b|\bspread\b|\bch\s*[:=]|\brec\s*[:=]/g],
  ['weapon', /\bweapon\b|\bmag\b|\breserve\b|\breload\b|\bammo\b/gi],
  ['bot / ai', /\bbot\b|\bai\b|\bnpc\b|\btarget\b/gi],
  ['map / spawn', /\bspawn\b|\brespawn\b|\btrigger\b|\bprop\b/gi],
  ['render / three', /\bWebGLRenderer\b|\bScene\b|\bPerspectiveCamera\b|\bMesh\b|\bSkinnedMesh\b/g],
  ['animasi', /\bAnimationClip\b|\bAnimationMixer\b|\bKeyframeTrack\b|\bquaternion\b/gi],
  ['audio', /\bAudioContext\b|\bdecodeAudioData\b|\bcreateBufferSource\b|\bwebkitAudioContext\b/g],
  ['ui / hud', /\bhud\b|\bminimap\b|\bscoreboard\b|\bkillfeed\b/gi],
  ['mode / misi', /\binfect|\bdino|\bc4\b|\bmission\b|\bsector\b|\bround\b/gi],
  ['shop / ekonomi', /\bshop\b|\bgoods\b|\bcurrency\b|\binventory\b|\bunlock\b/gi],
  ['akun / auth', /\blogin\b|\btoken\b|\bsession\b|\baccount\b|\bregister\b/gi],
  ['lobby', /\blobby\b|\bmatchmaking\b|\bqueue\b|\broom\b/gi],
  ['kamera / input', /\bpointerlock\b|\bmousemove\b|\bkeydown\b|\bsensitivity\b/gi],
  ['fisika / tabrakan', /\bcollision\b|\braycast\b|\bvelocity\b|\bgravity\b/gi],
  ['fx / partikel', /\bparticle\b|\btracer\b|\bmuzzle\b|\bblood\b|\bsmoke\b/gi],
  ['progresi', /\bexp\b|\blevel\b|\brank\b|\bxp\b/gi],
];
for (const [name, re] of systems) {
  const n = count(re);
  console.log('  ' + (n > 0 ? '✓' : '·') + ' ' + name.padEnd(20) + n);
}

// ---- konstanta gameplay yang sudah diketahui ----
console.log('\n=== konstanta gameplay (sampel) ===');
for (const pat of ['1.648', '1.101', '6.695', '4.2', 'headMul', '0.39', '5.5', '1.4']) {
  const i = s.indexOf(pat);
  if (i < 0) { console.log('  ' + pat.padEnd(12) + '(tidak ditemukan)'); continue; }
  console.log('  ' + pat.padEnd(12) + '...' + s.slice(Math.max(0, i - 60), i + 60).replace(/\n/g, ' '));
}

// ---- kelas besar (kandidat modul) ----
console.log('\n=== deklarasi class (kandidat modul) ===');
const reC = /\bclass\s+([A-Za-z_$][\w$]*)/g;
const classes = new Set();
while ((m = reC.exec(s))) classes.add(m[1]);
console.log('  ' + [...classes].sort().join(', '));

// ---- nama fungsi besar (minified, 1-3 huruf) — hitung berapa aja ----
console.log('\n=== contoh struktur: 300 char dari awal bundle ===');
console.log(s.slice(0, 300));
