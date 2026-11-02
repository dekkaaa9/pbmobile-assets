// measure_git.js — ukur BIAYA NYATA kalau 2 GB langsung di-git.
// Eksperimen: init -> add (semua, bypass .gitignore) -> commit -> ukur.
'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);

const sh = (cmd, opts = {}) => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
const secs = (ms) => (ms / 1000).toFixed(1) + ' s';
const dirSize = (d) => {
  let t = 0;
  const walk = (x) => {
    let e; try { e = fs.readdirSync(x, { withFileTypes: true }); } catch (err) { return; }
    for (const f of e) {
      const p = path.join(x, f.name);
      if (f.isDirectory()) walk(p);
      else { try { t += fs.statSync(p).size; } catch (err) {} }
    }
  };
  walk(d); return t;
};

// --- 0. baseline ---
const siteSize = dirSize(path.join(ROOT, 'site'));
console.log('=== BASELINE ===');
console.log('  site/ : ' + (siteSize / 1048576).toFixed(0) + ' MB');

// simpan .gitignore sementara (pindah biar add semua)
const gi = path.join(ROOT, '.gitignore');
const giBak = gi + '.bak';
if (fs.existsSync(gi)) fs.renameSync(gi, giBak);

try {
  // --- 1. init ---
  console.log('\n=== git init ===');
  let t0 = Date.now();
  sh('git init -b main');
  sh('git config core.autocrlf false');
  sh('git config core.longpaths true');
  console.log('  ' + secs(Date.now() - t0));

  // --- 2. add (semua, paksa) ---
  console.log('\n=== git add -A -f  (semua 2 GB, bypass .gitignore) ===');
  t0 = Date.now();
  sh('git add -A -f');
  const addMs = Date.now() - t0;
  const nFiles = sh('git diff --cached --name-only').split('\n').filter(x => x.trim()).length;
  console.log('  waktu : ' + secs(addMs));
  console.log('  file  : ' + nFiles);

  // --- 3. commit ---
  console.log('\n=== git commit ===');
  t0 = Date.now();
  sh('git -c user.name=t -c user.email=t@t commit -q -m "semua 2GB"');
  const commitMs = Date.now() - t0;
  console.log('  waktu : ' + secs(commitMs));

  // --- 4. ukur .git ---
  console.log('\n=== UKURAN HASIL ===');
  const gitSize = dirSize(path.join(ROOT, '.git'));
  const workSize = dirSize(ROOT) - gitSize;
  console.log('  working tree : ' + (workSize / 1048576).toFixed(0) + ' MB');
  console.log('  .git/        : ' + (gitSize / 1048576).toFixed(0) + ' MB  <-- salinan internal');
  console.log('  TOTAL disk   : ' + ((workSize + gitSize) / 1048576).toFixed(0) + ' MB');

  // --- 5. git status (operasi paling sering) ---
  console.log('\n=== git status (5x, operasi paling sering dipakai) ===');
  const times = [];
  for (let i = 0; i < 5; i++) {
    const s = Date.now();
    sh('git status --porcelain');
    times.push((Date.now() - s) / 1000);
  }
  console.log('  ' + times.map(x => x.toFixed(1) + 's').join(', '));
  console.log('  rata-rata : ' + (times.reduce((a, b) => a + b, 0) / times.length).toFixed(1) + ' s');

  // --- 6. clone test (simulasi orang lain / mesin lain) ---
  console.log('\n=== git clone (simulasi orang lain) ===');
  const cloneDir = path.join(require('os').tmpdir(), 'git_clone_test');
  try { fs.rmSync(cloneDir, { recursive: true, force: true }); } catch (e) {}
  t0 = Date.now();
  try {
    sh(`git clone -q --no-hardlinks "${ROOT}" "${cloneDir}"`, { timeout: 1800000 });
    const cloneMs = Date.now() - t0;
    console.log('  waktu : ' + secs(cloneMs));
    console.log('  ukuran: ' + (dirSize(cloneDir) / 1048576).toFixed(0) + ' MB');
    global.__cloneMs = cloneMs;
  } catch (e) {
    console.log('  gagal/timeout: ' + String(e.message).slice(0, 200));
  }

  // --- ringkasan ---
  console.log('\n=== RINGKASAN BIAYA (kalau langsung git semua) ===');
  console.log('  git add    : ' + secs(addMs) + '   (sekali aja, tapi tiap nambah aset = ulangi)');
  console.log('  git commit : ' + secs(commitMs));
  console.log('  git status : ' + (times.reduce((a, b) => a + b, 0) / times.length).toFixed(1) + ' s  <-- TIAP KALI lu ketik git status');
  console.log('  disk ekstra: ' + (gitSize / 1048576).toFixed(0) + ' MB buat .git/');
  if (global.__cloneMs) console.log('  clone      : ' + secs(global.__cloneMs) + ' buat orang lain');
} finally {
  // pulaukan .gitignore
  if (fs.existsSync(giBak)) fs.renameSync(giBak, gi);
}
