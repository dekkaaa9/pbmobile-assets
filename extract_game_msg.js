const fs = require('fs');
const b = fs.readFileSync('D:/pentest_learn/pbmobile/js/game_bundle.js', 'utf8');

// context before Ye.s.id=s.you to see where s and c come from
const idx = b.indexOf('Ye.s.id=s.you');
console.log(b.slice(idx - 2500, idx + 300));
