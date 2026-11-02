// probe_lux.js — cek 4 tekstur `lux` (lighting map) mesh showroom:
// ada di disk? hidup upstream?
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, 'site');
const { assetUrl } = require(path.join(ROOT, 'tools/asset_url.js'));

const LUX = [
  'World/PumpkinHollow/Textures/PH_objectLightingMap.i3i',
  'World/PumpkinHollow/Textures/PH_BottomLightingMap.i3i',
  'World/PumpkinHollow/Textures/PH_wallLightingMap.i3i',
  'World/PumpkinHollow/Textures/PH_alphaLightingMap.i3i',
];

function head(u) {
  return new Promise(res => {
    const r = https.request('https://pbmobile.app' + u, { method: 'GET', timeout: 60000 }, resp => {
      resp.resume(); resp.on('end', () => res(resp.statusCode));
    });
    r.on('timeout', function () { this.destroy(); res(0); });
    r.on('error', () => res(0));
    r.end();
  });
}

(async () => {
  const miss = [];
  for (const p of LUX) {
    const u = assetUrl('tex', { path: p });
    const hash = u.match(/\/a\/tex\/([0-9a-f]{16})/)[1];
    const f = path.join(SITE, 'assets/tex', hash);
    const onDisk = fs.existsSync(f);
    const sz = onDisk ? fs.statSync(f).size : 0;
    let st = '-';
    if (!onDisk) { st = await head(u); if (st === 200) miss.push({ path: p, hash, url: u }); }
    console.log('  ' + (onDisk ? 'ADA  ' : 'HILANG') + '  ' + hash + '  ' +
      (onDisk ? (sz / 1024).toFixed(1) + ' KB' : '[' + st + ']') + '  ' + p);
  }
  console.log('\nperlu diunduh: ' + miss.length);
  fs.writeFileSync(path.join(ROOT, 'lux_missing.json'), JSON.stringify(miss, null, 1));
  if (miss.length) console.log('tulis lux_missing.json');
})();
