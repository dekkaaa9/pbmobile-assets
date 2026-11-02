const fs = require('fs');
const b = fs.readFileSync('D:/pentest_learn/pbmobile/js/game_bundle.js', 'utf8');

function ctx(pattern, before = 200, after = 450, limit = 3) {
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

console.log('===== Ye.s= assignments =====');
ctx('Ye\\.s=', 250, 250, 6);
console.log('\n===== joined handler Gc(ent) =====');
ctx('on\\("joined"', 50, 300, 1);
console.log('\n===== weapon stats fields (dmg/rate/range) =====');
ctx('rate:', 150, 150, 4);
console.log('\n===== Ye.W / Ye.inv weapon =====');
ctx('Ye\\.W=', 150, 200, 4);
console.log('\n===== weapons.json fetch =====');
ctx('weapons?\\.json', 150, 200, 3);
