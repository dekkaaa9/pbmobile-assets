// asset_url.js — implementasi PERSIS assetUrl() dari pb.js, buat hitung hash
// aset apa saja dari path-nya. Dipakai buat cari aset showroom yang hilang.
'use strict';

const MAP_V = { nport: 'zep1', showroom: 'sr10', library: 'nk5' };

function assetUrl(api, params) {
  const t = JSON.stringify(params || {}).toLowerCase();
  for (const e in MAP_V) if (t.includes(e)) { params = Object.assign({ mv: MAP_V[e] }, params); break; }
  const n = new URLSearchParams(Object.entries(Object.assign({ v: '1' }, params))
    .sort((e, a) => e[0] < a[0] ? -1 : e[0] > a[0] ? 1 : 0)).toString();
  const o = api + '?' + n;
  let r = 2166136261, i = 2671212586;
  for (let e = 0; e < o.length; e++) {
    const a = o.charCodeAt(e);
    r = Math.imul(r ^ a, 16777619) >>> 0;
    i = Math.imul(i ^ a, 16777619) >>> 0;
  }
  return '/a/' + api + '/' + r.toString(16).padStart(8, '0') + i.toString(16).padStart(8, '0') + '?' + n + '&f=2';
}

module.exports = { assetUrl, MAP_V };

// ---- CLI ----
if (require.main === module) {
  const args = process.argv.slice(2);
  if (!args.length) {
    console.log('pakai: node asset_url.js <api> <path> [api path ...]');
    console.log('  node asset_url.js mesh "Gui/Showroom/Gunshowcaseroom_Lighting.i3s"');
    process.exit(0);
  }
  for (let i = 0; i + 1 < args.length; i += 2) {
    const api = args[i], p = args[i + 1];
    const u = assetUrl(api, { path: p });
    const hash = u.match(/\/a\/[a-z]+\/([0-9a-f]{16})/)[1];
    console.log(api.padEnd(10) + ' ' + hash + '  ' + p);
    console.log('           ' + u);
  }
}
