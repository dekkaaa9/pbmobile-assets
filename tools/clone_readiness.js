const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const dir = path.join(ROOT, 'site/export/maps');
const real = fs.readdirSync(dir).filter(f => f.endsWith('.json') && f !== '_index.json');

const meshMirror = new Set(fs.readdirSync(path.join(ROOT, 'site/assets/mesh')));
console.log('raw mesh mirror:', meshMirror.size, 'files');

let tot = 0, have = 0, missing = [];
for (const f of real) {
  const m = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const a = m.assets || {};
  for (const k of Object.keys(a)) {
    const url = a[k];
    const h = String(url).split('/').pop();
    tot++;
    if (meshMirror.has(h)) have++;
    else missing.push(f.replace('.json', '') + ':' + k + '=' + h);
  }
}
console.log('map asset refs total=' + tot + ' present=' + have + ' missing=' + missing.length);
if (missing.length) console.log('missing sample:', missing.slice(0, 8).join(' | '));

// how many distinct collision meshes across all maps
const colHashes = new Set();
for (const f of real) {
  const m = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  for (const k of ['colHero', 'colHit', 'colLight']) {
    if (m.assets && m.assets[k]) colHashes.add(String(m.assets[k]).split('/').pop());
  }
}
console.log('distinct collision meshes:', colHashes.size,
            '| present in mirror:', [...colHashes].filter(h => meshMirror.has(h)).length);

// anims: is it already AnimationClip-shaped?
const animDir = path.join(ROOT, 'site/assets/anims');
const af = fs.readdirSync(animDir);
const a0 = JSON.parse(fs.readFileSync(path.join(animDir, af[0]), 'utf8'));
const k0 = Object.keys(a0)[0];
const clip = a0[k0];
console.log('\nanims file', af[0], '| clips=' + Object.keys(a0).length, '| clip[0].name=' + clip.name,
            '| type=' + clip.type, '| duration=' + clip.duration, '| tracks=' + (clip.tracks || []).length);
if (clip.tracks && clip.tracks[0]) {
  const t = clip.tracks[0];
  console.log('  track[0] keys:', Object.keys(t).join(','));
  console.log('  track[0] sample:', JSON.stringify(t).slice(0, 260));
}
// all clip names across all anim files
const names = new Set();
for (const f of af) {
  const j = JSON.parse(fs.readFileSync(path.join(animDir, f), 'utf8'));
  for (const k of Object.keys(j)) names.add(j[k].name || k);
}
console.log('  total distinct animation names:', names.size);
console.log('  sample:', [...names].slice(0, 25).join(', '));

// weapons.json real shape
const w = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/static/game/weapons.json'), 'utf8'));
const wk = Object.keys(w);
console.log('\nweapons.json: object, keys=' + wk.length);
const w0 = w[wk[0]];
console.log('weapon[0] keys:', Object.keys(w0).join(','));
console.log('weapon[0] sample:', JSON.stringify(w0).slice(0, 300));

// charas
const c = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/static/game/charas.json'), 'utf8'));
const cv = c.charas;
console.log('\ncharas: ' + (Array.isArray(cv) ? 'array[' + cv.length + ']' : 'object keys=' + Object.keys(cv).length));
const c0 = Array.isArray(cv) ? cv[0] : cv[Object.keys(cv)[0]];
console.log('chara[0]:', JSON.stringify(c0).slice(0, 300));
const pv = c.parts;
const p0 = Array.isArray(pv) ? pv[0] : pv[Object.keys(pv)[0]];
console.log('part[0]:', JSON.stringify(p0).slice(0, 260));

// ai
const ai = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/static/game/ai.json'), 'utf8'));
console.log('\nai.json: keys=' + Object.keys(ai).join(','));
console.log('ai[1]:', JSON.stringify(ai['1']).slice(0, 320));

// fx/effects.json
const fx = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/static/game/fx/effects.json'), 'utf8'));
console.log('\nfx/effects.json keys:', Object.keys(fx).join(','));
for (const k of Object.keys(fx).slice(0, 4)) {
  const v = fx[k];
  console.log('  ' + k + ':', Array.isArray(v) ? 'array[' + v.length + ']' : typeof v,
              Array.isArray(v) && v[0] ? JSON.stringify(v[0]).slice(0, 150) : '');
}
