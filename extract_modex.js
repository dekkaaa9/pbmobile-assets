const fs = require('fs');
const b = fs.readFileSync('D:/pentest_learn/pbmobile/js/game_bundle.js', 'utf8');

// HUDO return value: find "return{" after window.HUDO= within the IIFE
const idx = b.indexOf('window.HUDO=');
const seg = b.slice(idx, idx + 40000);
const m = /return\s*\{[^}]{0,2000}\}\s*\}\)\(\)/.exec(seg);
if (m) {
  console.log('=== HUDO return ===');
  console.log(m[0].slice(0, 2000));
} else {
  // fallback: find hoNick positioning code
  console.log('no clean return; searching hoNick positioning');
  const m2 = /hoNick[^;]{0,600}/.exec(seg);
  if (m2) console.log(m2[0]);
}

// MODEX.GG: extract the IIFE that defines window.MODEX
const idx2 = b.indexOf('window.MODEX={GG:');
console.log('\n=== MODEX at', idx2, '===');
console.log(b.slice(idx2 - 6000, idx2 + 500));
