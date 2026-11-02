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

console.log('===== bt.n usage (untrusted event counter) =====');
ctx('bt\\.n', 200, 350, 6);
console.log('\n===== acflag send =====');
ctx('acflag', 300, 300, 4);
console.log('\n===== stopImmediatePropagation uses =====');
ctx('stopImmediatePropagation', 150, 150, 8);
console.log('\n===== xt definition (pointerlock flag) =====');
ctx('xt=', 150, 150, 4);
