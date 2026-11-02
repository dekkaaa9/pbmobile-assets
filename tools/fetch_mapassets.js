// fetch_mapassets.js — the 34 map manifests reference 161 distinct /a/mesh/<hash>
// assets (world / sky / colHero / colHit / colLight). 112 are live on the CDN but
// only 56 were mirrored (the mirror was built from prefetch.json, which uses a
// different hash scheme). This downloads every live-but-missing map asset —
// most importantly the collision meshes (colHero = player collision,
// colHit = bullet hit collision, colLight = light collision).
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const MDIR = path.join(ROOT, 'site/assets/mesh');
const OUT = path.join(ROOT, 'site/export/mesh_extra');
const CONC = Number(process.env.CONC || 8);

function get(url, dest) {
  return new Promise((res, rej) => {
    https.get(url, { timeout: 180000 }, r => {
      if (r.statusCode !== 200) { r.resume(); return rej(new Error('HTTP ' + r.statusCode)); }
      const tmp = dest + '.part';
      const out = fs.createWriteStream(tmp);
      r.pipe(out);
      out.on('finish', () => out.close(() => { fs.renameSync(tmp, dest); res(); }));
      out.on('error', e => { try { fs.unlink(tmp, () => {}); } catch (_) {} rej(e); });
    }).on('timeout', function () { this.destroy(); }).on('error', e => {
      try { fs.unlink(dest + '.part', () => {}); } catch (_) {}
      rej(e);
    });
  });
}
function head(url) {
  return new Promise((res) => {
    const req = https.request(url, { method: 'HEAD', timeout: 20000 }, r => {
      res({ s: r.statusCode, len: Number(r.headers['content-length'] || 0) });
      r.resume();
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => res({ s: 0, len: 0 }));
    req.end();
  });
}

async function main() {
  const dir = path.join(ROOT, 'site/export/maps');
  const real = fs.readdirSync(dir).filter(f => f.endsWith('.json') && f !== '_index.json');

  // hash -> {maps:Set, roles:Set}
  const info = new Map();
  for (const f of real) {
    const m = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const map = f.replace('.json', '');
    for (const role of Object.keys(m.assets || {})) {
      const raw = String(m.assets[role]);
      if (!raw || raw === 'null' || raw === 'undefined') continue;
      const h = raw.split('/').pop();
      if (!info.has(h)) info.set(h, { maps: new Set(), roles: new Set() });
      info.get(h).maps.add(map);
      info.get(h).roles.add(role);
    }
  }
  console.log('distinct map asset hashes:', info.size);

  fs.mkdirSync(MDIR, { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });
  const have = new Set(fs.readdirSync(MDIR));

  // probe liveness
  const hashes = [...info.keys()];
  const live = [], dead = [];
  const queue = hashes.slice();
  async function prober() {
    while (queue.length) {
      const h = queue.shift();
      const r = await head('https://pbmobile.app/a/mesh/' + h);
      (r.s === 200 ? live : dead).push({ h, s: r.s, len: r.len });
    }
  }
  await Promise.all(Array.from({ length: CONC }, prober));
  console.log('live=' + live.length + ' dead=' + dead.length);

  const todo = live.filter(x => !have.has(x.h));
  console.log('live but not mirrored:', todo.length,
              '| total MB=' + (todo.reduce((a, b) => a + b.len, 0) / 1048576).toFixed(1));

  let ok = 0; const failed = [];
  const q = todo.slice();
  async function worker() {
    while (q.length) {
      const x = q.shift();
      try {
        await get('https://pbmobile.app/a/mesh/' + x.h, path.join(MDIR, x.h));
        ok++;
        if (ok % 10 === 0) console.log('  ...' + ok + '/' + todo.length);
      } catch (e) { failed.push(x.h + ' (' + e.message + ')'); }
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  console.log('downloaded ok=' + ok + ' fail=' + failed.length);

  // index the newly available map assets by role
  const index = {};
  let bytes = 0;
  for (const [h, v] of info) {
    const src = path.join(MDIR, h);
    if (!fs.existsSync(src)) continue;
    bytes += fs.statSync(src).size;
    index[h] = { roles: [...v.roles], maps: [...v.maps].sort() };
  }
  fs.writeFileSync(path.join(OUT, '_index.json'), JSON.stringify(index, null, 1));
  console.log('map assets now available: ' + Object.keys(index).length +
              ' | total MB=' + (bytes / 1048576).toFixed(1));
  if (failed.length) console.log('failed:', failed.slice(0, 10).join(' | '));
  if (dead.length) console.log('dead (not on server): ' + dead.length +
    ' | sample: ' + dead.slice(0, 6).map(d => d.h + '(' + d.s + ')').join(', '));
}

main().catch(e => { console.log('FATAL', e && e.stack || e); process.exit(1); });
