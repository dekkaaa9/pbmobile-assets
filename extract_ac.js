const fs = require('fs');
const b = fs.readFileSync('D:/pentest_learn/pbmobile/js/game_bundle.js', 'utf8');

// Extract the anti-cheat block: find "function Rc(" and print a big window
const idx = b.indexOf('function Rc(');
console.log('Rc at', idx);
console.log(b.slice(idx - 3000, idx + 4500));
