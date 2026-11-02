// speedtest_upload.js — ukur kecepatan upload ke VPS via plink stdin.
// Ini menentukan strategi transfer 1,22 GB aset.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { put } = require('./vps.js');

const MB = 50;
const local = path.join(os.tmpdir(), 'speedtest.bin');

console.log('bikin ' + MB + ' MB file acak...');
fs.writeFileSync(local, crypto.randomBytes(MB * 1024 * 1024));
console.log('upload...');

const t0 = Date.now();
const r = put(local, '/root/speedtest.bin');
const ms = Date.now() - t0;

if (r.ok) {
  const secs = ms / 1000;
  const mbps = MB / secs;
  console.log('OK  ' + MB + ' MB dalam ' + secs.toFixed(1) + ' s');
  console.log('kecepatan : ' + mbps.toFixed(2) + ' MB/s');
  console.log('estimasi 1220 MB : ' + (1220 / mbps / 60).toFixed(1) + ' menit');
  console.log('estimasi 1220 MB (base64 +33%) : ' + (1220 * 1.37 / mbps / 60).toFixed(1) + ' menit');
} else {
  console.log('GAGAL: ' + r.out.slice(0, 500));
}
try { fs.unlinkSync(local); } catch (e) {}
