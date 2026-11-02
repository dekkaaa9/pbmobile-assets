// fetch_sound.js — the game's 7th asset api is "sound" (Web Audio .wav),
// fetched with the same assetUrl() scheme:
//     fetch("/" === t[0] ? t : assetUrl("sound", { path: t }))
//
// Sound paths in bundle.js are built four ways, all resolved here:
//   1. full literals            "sound/weapon/handgun/k5/wm_k5_fire.wav"
//   2. te + "<rel>"             te = "sound/weapon/assaultrifle/"
//   3. a  + "<rel>"             a  = "sound/weapon/common/"
//   4. nt(x) = "sound/weapon/c4/wm_c4_" + x + ".wav"
//      x in {button, installed, disarmed, explosion, take}
//   5. radio voice: "sound/voice/radio/" + (man|women) + "auto_e1.wav"
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, 'site');
const SNDDIR = path.join(SITE, 'assets', 'sound');
const SNDOUT = path.join(SITE, 'export', 'sound');
const CONC = Number(process.env.CONC || 12);

function assetUrl(api, a) {
  const t = JSON.stringify(a || {}).toLowerCase();
  const MAP_V = { nport: 'zep1', showroom: 'sr10', library: 'nk5' };
  for (const e in MAP_V) if (t.includes(e)) { a = Object.assign({ mv: MAP_V[e] }, a); break; }
  const n = new URLSearchParams(Object.entries(Object.assign({ v: '1' }, a)).sort(
    (e, a2) => e[0] < a2[0] ? -1 : e[0] > a2[0] ? 1 : 0)).toString();
  const o = api + '?' + n;
  let r = 2166136261, i = 2671212586;
  for (let e = 0; e < o.length; e++) {
    const a2 = o.charCodeAt(e);
    r = Math.imul(r ^ a2, 16777619) >>> 0;
    i = Math.imul(i ^ a2, 16777619) >>> 0;
  }
  return '/a/' + api + '/' + r.toString(16).padStart(8, '0') + i.toString(16).padStart(8, '0');
}

function harvest() {
  const s = fs.readFileSync(path.join(SITE, 'static', 'game', 'bundle.js'), 'utf8');
  const set = new Set();
  const add = p => { if (p && /\.wav$/i.test(p)) set.add(p); };

  // 1. full literals starting with sound/
  let m;
  const reL = /["'](sound\/[A-Za-z0-9_\-./]+\.wav)["']/gi;
  while ((m = reL.exec(s))) add(m[1]);

  // 2/3. base + relative  (te = assaultrifle, a = common)
  const bases = { te: 'sound/weapon/assaultrifle/', a: 'sound/weapon/common/' };
  const reC = /\b(te|a)\s*\+\s*["']([A-Za-z0-9_\-./]+\.wav)["']/gi;
  while ((m = reC.exec(s))) add(bases[m[1]] + m[2]);

  // 4. c4 suffixes from nt("x") calls
  const reN = /\bnt\(\s*["']([A-Za-z0-9_\-]+)["']\s*\)/gi;
  while ((m = reN.exec(s))) add('sound/weapon/c4/wm_c4_' + m[1] + '.wav');

  // 5. radio voice: "sound/voice/radio/" + (man/mv_ | women/wv_) + "auto_e1.wav"
  add('sound/voice/radio/man/mv_auto_e1.wav');
  add('sound/voice/radio/women/wv_auto_e1.wav');

  return [...set].sort();
}

function get(url, dest) {
  return new Promise((res, rej) => {
    https.get(url, { timeout: 120000 }, r => {
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

async function main() {
  const paths = harvest();
  console.log('sound paths:', paths.length);
  for (const p of paths) console.log('  ' + p);

  fs.mkdirSync(SNDDIR, { recursive: true });
  fs.mkdirSync(SNDOUT, { recursive: true });
  const have = new Set(fs.existsSync(SNDDIR) ? fs.readdirSync(SNDDIR) : []);
  const jobs = paths.map(p => ({ p, h: assetUrl('sound', { path: p }).split('/').pop() }));
  const q = jobs.filter(j => !have.has(j.h));
  console.log('\nalready mirrored:', jobs.length - q.length, ' to download:', q.length);

  let ok = 0; const failed = [];
  const queue = q.slice();
  async function worker() {
    while (queue.length) {
      const j = queue.shift();
      try { await get('https://pbmobile.app/a/sound/' + j.h, path.join(SNDDIR, j.h)); ok++; }
      catch (e) { failed.push(j.p + ' (' + e.message + ')'); }
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  console.log('downloaded ok=' + ok + ' fail=' + failed.length);

  const index = {}; let copied = 0, bytes = 0;
  for (const j of jobs) {
    const src = path.join(SNDDIR, j.h);
    if (!fs.existsSync(src)) continue;
    const rel = j.p.replace(/\//g, '__');
    const dst = path.join(SNDOUT, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    index[j.h] = { path: j.p, file: rel };
    copied++; bytes += fs.statSync(src).size;
  }
  fs.writeFileSync(path.join(SNDOUT, '_index.json'), JSON.stringify({ byHash: index, failed }, null, 1));
  console.log('materialised=' + copied + ' MB=' + (bytes / 1048576).toFixed(2));
  if (failed.length) console.log('failed:\n  ' + failed.join('\n  '));
}

main().catch(e => { console.log('FATAL', e && e.stack || e); process.exit(1); });
