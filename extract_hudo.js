const fs = require('fs');
const b = fs.readFileSync('D:/pentest_learn/pbmobile/js/game_bundle.js', 'utf8');

// HUDO module: find its full definition
const idx = b.indexOf('window.HUDO=');
console.log('=== HUDO at', idx, '===');
console.log(b.slice(idx, idx + 3000));
