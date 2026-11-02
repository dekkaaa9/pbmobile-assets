// export_stage.js — turn the 34 mirrored raw-JSON stage assets into clean,
// ready-to-use map manifests under site/export/maps/.
//
// Each stage file is { stage:{...}, entities:[...] } where entities carry
// pos / rot / quat / scale and a `kind` of unknown(world root) | respawn |
// trigger | prop. Referenced scene/collision resources are resolved to their
// /a/mesh/<hash> URLs via assetUrl() so they can be fetched directly.
'use strict';
const fs = require('fs');
const path = require('path');
const { readContainer } = require('./pbm.js');

const ROOT = path.resolve(__dirname, '..');
const ASSETS = path.join(ROOT, 'site', 'assets');
const OUT = path.join(ROOT, 'site', 'export', 'maps');

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

// build hash -> mirrored-file index for mesh/skinned/weapon
function buildMeshIndex() {
  const idx = new Map();
  for (const api of ['mesh', 'skinned', 'weapon']) {
    const dir = path.join(ASSETS, api);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) idx.set(api + '/' + f, api + '/' + f);
  }
  return idx;
}

function main() {
  const dir = path.join(ASSETS, 'stage');
  const files = fs.readdirSync(dir);
  fs.mkdirSync(OUT, { recursive: true });
  const index = [];

  for (const f of files) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const st = j.stage || {};
    const ents = j.entities || [];

    const pick = k => ents.filter(e => e.kind === k);
    const world = ents.find(e => e.kind === 'unknown');

    const map = {
      source: f,
      name: st.name || path.basename(f),
      world: st.world || null,
      sky: st.sky || null,
      collision: st.cols || null,
      insVersion: st.ins_version != null ? st.ins_version : null,
      source2: st.source || null,
      counts: {
        entities: ents.length,
        respawn: pick('respawn').length,
        trigger: pick('trigger').length,
        prop: pick('prop').length,
        resources: (st.rsc || []).length,
        textures: (st.textures || []).length,
      },
      // resolved CDN URLs for the map's own scene assets
      assets: {
        world: st.world ? assetUrl('mesh', { path: st.world }) : null,
        sky: st.sky ? assetUrl('mesh', { path: st.sky }) : null,
        colHero: st.cols && st.cols.hero ? assetUrl('mesh', { path: st.cols.hero }) : null,
        colHit: st.cols && st.cols.hit ? assetUrl('mesh', { path: st.cols.hit }) : null,
        colLight: st.cols && st.cols.light ? assetUrl('mesh', { path: st.cols.light }) : null,
      },
      worldRoot: world ? {
        name: world.name, pos: world.pos, quat: world.quat, scale: world.scale,
        respath: world.orig && world.orig.respath,
      } : null,
      spawns: pick('respawn').map(e => ({
        id: e.id, name: e.name, pos: e.pos, quat: e.quat, team: e.team,
      })),
      triggers: pick('trigger').map(e => ({
        id: e.id, name: e.name, res: e.res, pos: e.pos, quat: e.quat,
        scale: e.scale, size: e.size, layer: e.layer, visible: e.visible,
        trig: e.orig && e.orig.trig, clsname: e.orig && e.orig.clsname,
      })),
      props: pick('prop').map(e => ({
        id: e.id, name: e.name, res: e.res, obj: e.obj, pos: e.pos,
        rot: e.rot, quat: e.quat, scale: e.scale, size: e.size,
        layer: e.layer, visible: e.visible,
      })),
      resources: (st.rsc || []).map(r => ({ path: r.path, type: r.type, tname: r.tname, style: r.style })),
      textures: (st.textures || []).map(t => ({ path: t.path, name: t.name })),
    };

    const safe = (st.name || path.basename(f)).replace(/[^\w.\- ]+/g, '_');
    const out = path.join(OUT, safe + '.json');
    fs.writeFileSync(out, JSON.stringify(map, null, 1));
    index.push({
      name: map.name, file: path.basename(out), source: f,
      ...map.counts, world: map.world,
    });
  }

  index.sort((a, b) => a.name.localeCompare(b.name));
  fs.writeFileSync(path.join(OUT, '_index.json'), JSON.stringify(index, null, 1));

  console.log('maps exported:', index.length);
  const w = Math.max(...index.map(i => i.name.length));
  for (const i of index) {
    console.log('  ' + i.name.padEnd(w) +
      '  spawns=' + String(i.respawn).padStart(2) +
      ' trig=' + String(i.trigger).padStart(3) +
      ' props=' + String(i.prop).padStart(3) +
      ' rsc=' + String(i.resources).padStart(3) +
      ' tex=' + String(i.textures).padStart(3));
  }
}

main();
