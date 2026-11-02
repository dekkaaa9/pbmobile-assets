const fs = require('fs');
const b = fs.readFileSync('D:/pentest_learn/pbmobile/js/game_bundle.js', 'utf8');

function ctx(pattern, before = 250, after = 400, limit = 4) {
  const re = new RegExp(pattern, 'g');
  let m, n = 0;
  while ((m = re.exec(b)) && n < limit) {
    const s = Math.max(0, m.index - before);
    console.log(`\n--- [${m.index}] ---`);
    console.log(b.slice(s, m.index + after));
    n++;
  }
  if (n === 0) console.log('(none)');
}

console.log('===== Ye.trigger= (fire press) =====');
ctx('Ye\\.trigger=', 300, 300, 4);
console.log('\n===== Zs( release =====');
ctx('function Zs\\(', 50, 300, 1);
console.log('\n===== pointerdown =====');
ctx('"pointerdown"', 200, 300, 3);
console.log('\n===== mousedown window =====');
ctx('addEventListener\\("mousedown"', 200, 350, 3);
