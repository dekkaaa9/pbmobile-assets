// upload_site.js — upload tarball site/ ke VPS secara chunked.
// Setiap chunk di-upload via plink stdin (base64), lalu digabung & diekstrak.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { runp, put } = require('./vps.js');

const TARBALL = path.resolve(__dirname, '../dist/site_runtime.tar.gz');
const REMOTE_DIR = '/root/pbmobile';
const CHUNK = 32 * 1024 * 1024;   // 32 MB per chunk

(async () => {
  if (!fs.existsSync(TARBALL)) { console.error('tarball tidak ada: ' + TARBALL); process.exit(1); }
  const total = fs.statSync(TARBALL).size;
  const nChunks = Math.ceil(total / CHUNK);
  console.log('tarball : ' + (total / 1048576).toFixed(1) + ' MB');
  console.log('chunk   : ' + nChunks + ' x ' + (CHUNK / 1048576) + ' MB');
  console.log('target  : ' + REMOTE_DIR + '/site_runtime.tar.gz\n');

  // siapkan direktori remote
  let r = runp(`mkdir -p ${REMOTE_DIR}/chunks && rm -f ${REMOTE_DIR}/chunks/* && echo READY`);
  if (!/READY/.test(r.out)) { console.error('gagal siapkan direktori: ' + r.out); process.exit(1); }
  console.log('direktori remote siap\n');

  const fd = fs.openSync(TARBALL, 'r');
  const buf = Buffer.alloc(CHUNK);
  const t0 = Date.now();
  let uploaded = 0;

  for (let i = 0; i < nChunks; i++) {
    const n = fs.readSync(fd, buf, 0, CHUNK, i * CHUNK);
    const chunk = buf.slice(0, n);
    const tmp = path.join(os.tmpdir(), 'chunk_' + i);
    fs.writeFileSync(tmp, chunk);

    const res = put(tmp, `${REMOTE_DIR}/chunks/c${String(i).padStart(4, '0')}`);
    try { fs.unlinkSync(tmp); } catch (e) {}

    if (!res.ok) {
      console.error('\nGAGAL upload chunk ' + i + ': ' + res.out.slice(0, 300));
      process.exit(1);
    }
    uploaded += n;
    const pct = (uploaded / total * 100);
    const el = (Date.now() - t0) / 1000;
    const mbps = uploaded / 1048576 / el;
    const eta = ((total - uploaded) / 1048576) / (mbps || 1);
    process.stdout.write(`\r  chunk ${String(i + 1).padStart(3)}/${nChunks}  ` +
      `${pct.toFixed(1).padStart(5)}%  ${(uploaded / 1048576).toFixed(0).padStart(4)} MB  ` +
      `${mbps.toFixed(2)} MB/s  ETA ${eta.toFixed(0)}s   `);
  }
  fs.closeSync(fd);
  console.log('\n\nsemua chunk terupload');

  // gabung + verifikasi ukuran
  console.log('menggabungkan chunk di remote...');
  r = runp(`cd ${REMOTE_DIR} && cat chunks/c* > site_runtime.tar.gz && ` +
    `stat -c '%s' site_runtime.tar.gz && md5sum site_runtime.tar.gz`,
    { timeout: 600000 });
  const lines = r.out.trim().split('\n').filter(x => x.trim());
  const remoteSize = Number(lines[0]);
  const remoteMd5 = (lines[1] || '').split(' ')[0];

  const crypto = require('crypto');
  const localMd5 = crypto.createHash('md5').update(fs.readFileSync(TARBALL)).digest('hex');

  console.log('  ukuran lokal   : ' + total);
  console.log('  ukuran remote  : ' + remoteSize);
  console.log('  md5 lokal      : ' + localMd5);
  console.log('  md5 remote     : ' + remoteMd5);
  if (remoteSize !== total || remoteMd5 !== localMd5) {
    console.error('\nVERIFIKASI GAGAL — tarball rusak/terpotong');
    process.exit(1);
  }
  console.log('\nVERIFIKASI OK — tarball utuh');

  // ekstrak
  console.log('mengekstrak...');
  r = runp(`cd ${REMOTE_DIR} && rm -rf site && mkdir site && ` +
    `tar -xzf site_runtime.tar.gz -C site && ` +
    `echo "files: $(find site -type f | wc -l)" && du -sh site`,
    { timeout: 900000 });
  console.log(r.out);

  // bersihin chunk
  runp(`rm -rf ${REMOTE_DIR}/chunks && echo cleaned`);
  console.log('chunk dibersihkan');
})().catch(e => { console.error('ERROR: ' + e.message); process.exit(1); });
