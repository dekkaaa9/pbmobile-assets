// fetch_extras.js — close the remaining gaps in the mirror:
//   1. the 11 /static/game/*.json data files referenced by bundle.js
//   2. map loading images + minimap thumbs
//   3. all sound/ .wav assets, resolving the two base prefixes
//      (te = "sound/weapon/assaultrifle/", a = "sound/weapon/common/")
//      plus the c4 family whose name is built by concatenation.
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, 'site');
const GAMEDIR = path.join(SITE, 'static', 'game');
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

// ---------- 1. static JSON + images ----------
async function fetchStatics() {
  const jsons = [
    '/static/game/charas.json', '/static/game/nickpalette.json',
    '/static/game/tagrules.json', '/static/game/fx/effects.json',
    '/static/game/recoil_extra.json', '/static/game/ai.json',
    '/static/game/mission_objs.json', '/static/game/break_objs.json',
    '/static/game/sectors/index.json',
  ];
  let ok = 0, fail = 0;
  for (const u of jsons) {
    const dest = path.join(SITE, u.replace('/static/', 'static/'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    try { await get('https://pbmobile.app' + u, dest); ok++; console.log('  OK  ' + u + '  ' + fs.statSync(dest).size + 'B'); }
    catch (e) { fail++; console.log('  FAIL ' + u + ' ' + e.message); }
  }
  // loading images + minimap thumbs (tex api for .i3i, plain for .jpg/.png)
  const images = [
    ['tex', 'World/TinyTown/Images_NoText/Load_TinyTown.i3i'],
    ['tex', 'World/Wilderness/Images_NoText/Load_Wilderness.i3i'],
    ['tex', 'World/Historic_Site/Images_NoText/Load_Historic_Site.i3i'],
  ];
  const imgOut = path.join(SITE, 'export', 'loading');
  fs.mkdirSync(imgOut, { recursive: true });
  for (const [api, p] of images) {
    try {
      const dest = path.join(imgOut, path.basename(p).replace(/\.[^.]+$/, '') + '.webp');
      await get('https://pbmobile.app' + assetUrl(api, { path: p }), dest);
      console.log('  OK  loading ' + path.basename(dest));
    } catch (e) { console.log('  FAIL loading ' + p + ' ' + e.message); }
  }
  for (const u of ['/static/game/hud/minimap/thumb_PumpkinHollow.jpg',
                   '/static/game/hud/br_time.png', '/static/v37/atlas/hud.png']) {
    const dest = path.join(SITE, u.replace('/static/', 'static/'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    try { await get('https://pbmobile.app' + u, dest); console.log('  OK  ' + u); }
    catch (e) { console.log('  FAIL ' + u + ' ' + e.message); }
  }
  console.log('statics: ok=' + ok + ' fail=' + fail);
}

// ---------- 2. sounds ----------
function soundPaths() {
  const s = fs.readFileSync(path.join(GAMEDIR, 'bundle.js'), 'utf8');
  const set = new Set();
  const add = p => { if (p && /\.wav$/i.test(p)) set.add(p); };

  // full literals
  let m;
  const reL = /["']((?:sound\/)?[A-Za-z0-9_\-./]{2,140}\.wav)["']/gi;
  while ((m = reL.exec(s))) {
    let p = m[1];
    if (!/^sound\//i.test(p)) p = 'sound/weapon/' + p;
    add(p);
  }
  // base + relative
  const bases = { te: 'sound/weapon/assaultrifle/', a: 'sound/weapon/common/' };
  const reC = /\b(te|a)\s*\+\s*["']([A-Za-z0-9_\-./]+\.wav)["']/gi;
  while ((m = reC.exec(s))) add(bases[m[1]] + m[2]);
  // c4 family: "sound/weapon/c4/wm_c4_" + <suffix>
  const c4 = 'sound/weapon/c4/wm_c4_';
  for (const suf of ['1.wav', '2.wav', '3.wav', 'beep.wav', 'plant.wav', 'defuse.wav',
                     'loop.wav', 'explode.wav', 'tick.wav', 'set.wav', 'activate.wav']) add(c4 + suf);
  // voice / ambient / character literals already covered by reL
  return [...set].sort();
}

async function fetchSounds() {
  const paths = soundPaths();
  console.log('\nsound paths:', paths.length);
  fs.mkdirSync(SNDDIR, { recursive: true });
  fs.mkdirSync(SNDOUT, { recursive: true });
  const have = new Set(fs.existsSync(SNDDIR) ? fs.readdirSync(SNDDIR) : []);
  const jobs = paths.map(p => ({ p, h: assetUrl('sound', { path: p }).split('/').pop() }));
  const q = jobs.filter(j => !have.has(j.h));
  console.log('already mirrored:', jobs.length - q.length, ' to download:', q.length);

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
    const dst = path.join(SNDOUT, j.p.replace(/\//g, '__'));
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    index[j.h] = { path: j.p, file: j.p.replace(/\//g, '__') };
    copied++; bytes += fs.statSync(src).size;
  }
  fs.writeFileSync(path.join(SNDOUT, '_index.json'), JSON.stringify({ byHash: index, failed }, null, 1));
  console.log('materialised=' + copied + ' MB=' + (bytes / 1048576).toFixed(2));
  if (failed.length) console.log('failed (' + failed.length + '):\n  ' + failed.join('\n  '));
}

(async () => {
  console.log('=== static json + images ===');
  await fetchStatics();
  console.log('\n=== sounds ===');
  await fetchSounds();
})().catch(e => { console.log('FATAL', e && e.stack || e); process.exit(1); });
