// fetch_tex.js — resolve every PBM texture path the game references to its
// /a/tex/<hash> URL (assetUrl FNV-1a dual hash), download whatever is not
// already mirrored, and materialise the whole set as
// site/export/tex/<flattened-path>.webp for the exported GLBs to reference.
//
// Fast path: compute the plain {path} hash and download. On 404, retry with
// cv:1 / cv:2 variants (the TEX_CV override table) before giving up.
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const { readContainer } = require('./pbm.js');

const ROOT = path.resolve(__dirname, '..');
const ASSETS = path.join(ROOT, 'site', 'assets');
const TEXOUT = path.join(ROOT, 'site', 'export', 'tex');
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
  const set = new Set();
  // accepts plain .i3i paths and inline:<path>.i3s#N / inline:<path>.i3i refs
  const RE = /(?:inline:)?[A-Za-z0-9_\-./\\]{3,160}\.i3[is](?:#\d+)?/gi;
  const add = s => {
    if (!s || typeof s !== 'string' || s.length > 200) return;
    if (!/\.i3[is](?:#\d+)?$/i.test(s)) return;
    set.add(s);
  };
  const apis = fs.readdirSync(ASSETS).filter(d => fs.statSync(path.join(ASSETS, d)).isDirectory());
  for (const api of apis) {
    const dir = path.join(ASSETS, api);
    for (const f of fs.readdirSync(dir)) {
      let c;
      try { c = readContainer(fs.readFileSync(path.join(dir, f))); } catch (e) { continue; }
      if (!c || !c.header) continue;
      for (const p of c.header.parts || []) { add(p.tex); add(p.rmask); add(p.lux); }
      for (const r of c.header.boneRefs || []) add(r.tex);
      if (c.header.tex) add(c.header.tex);
    }
  }
  for (const f of ['site/static/game/pb.js', 'site/static/game/bundle.js', 'site/cc.js', 'site/index.html']) {
    let s;
    try { s = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (e) { continue; }
    let m; RE.lastIndex = 0;
    while ((m = RE.exec(s))) add(m[0]);
  }
  for (const f of ['site/static/game/weapons.json', 'site/static/game/weapon_anims.json']) {
    let s;
    try { s = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (e) { continue; }
    let m; RE.lastIndex = 0;
    while ((m = RE.exec(s))) add(m[0]);
  }
  return [...set].sort();
}

// filename-safe flatten: '#' and ':' are illegal on Windows
function flatten(p) {
  return p.replace(/\\/g, '/').replace(/\//g, '__').replace(/\.i3[is]$/i, '')
    .replace(/^inline:/, 'inline_').replace(/#/g, '@');
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
  console.log('candidate texture paths:', paths.length);

  // hash per path (plain form first, cv variants as fallback)
  const jobs = [];
  for (const p of paths) {
    const forms = [...new Set([p, p.replace(/\\/g, '/')])];
    const cands = [];
    for (const form of forms) {
      cands.push(assetUrl('tex', { path: form }).split('/').pop());
      for (const cv of [1, 2]) cands.push(assetUrl('tex', { path: form, cv }).split('/').pop());
    }
    jobs.push({ path: p, cands: [...new Set(cands)] });
  }

  const texDir = path.join(ASSETS, 'tex');
  fs.mkdirSync(texDir, { recursive: true });
  const have = new Set(fs.readdirSync(texDir));
  const resolved = new Map();   // path -> hash
  const unresolved = [];

  const q = jobs.slice();
  let done = 0;
  async function worker() {
    while (q.length) {
      const j = q.shift();
      // already mirrored under one of the candidate hashes?
      const pre = j.cands.find(h => have.has(h));
      if (pre) { resolved.set(j.path, pre); done++; continue; }
      let got = null;
      for (const h of j.cands) {
        try {
          await get('https://pbmobile.app/a/tex/' + h, path.join(texDir, h));
          got = h; break;
        } catch (e) { /* try next candidate */ }
      }
      if (got) { resolved.set(j.path, got); have.add(got); }
      else unresolved.push(j.path);
      done++;
      if (done % 500 === 0) console.log('  ... ' + done + '/' + jobs.length + ' resolved=' + resolved.size + ' unresolved=' + unresolved.length);
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  console.log('resolved=' + resolved.size + ' unresolved=' + unresolved.length);

  // materialise as <flattened>.webp
  fs.mkdirSync(TEXOUT, { recursive: true });
  const usedNames = new Map();
  const index = {};
  let copied = 0, bytes = 0;
  for (const [p, h] of resolved) {
    let name = flatten(p);
    if (usedNames.has(name) && usedNames.get(name) !== h) name = flatten(p) + '_' + h.slice(0, 6);
    usedNames.set(name, h);
    const src = path.join(texDir, h);
    if (!fs.existsSync(src)) continue;
    fs.copyFileSync(src, path.join(TEXOUT, name + '.webp'));
    index[h] = { path: p, file: name + '.webp' };
    copied++; bytes += fs.statSync(src).size;
  }
  fs.writeFileSync(path.join(TEXOUT, '_index.json'), JSON.stringify({ byHash: index, unresolved }, null, 1));
  console.log('materialised=' + copied + ' MB=' + (bytes / 1048576).toFixed(1));
  if (unresolved.length) console.log('unresolved sample:', unresolved.slice(0, 10).join(', '));
}

main().catch(e => { console.log('FATAL', e && e.stack || e); process.exit(1); });
