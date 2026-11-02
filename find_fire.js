const fs = require('fs');
const b = fs.readFileSync('D:/pentest_learn/pbmobile/js/game_bundle.js', 'utf8');

function ctx(pattern, before = 200, after = 400, limit = 3) {
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

console.log('===== mousedown / fire input =====');
ctx('"mousedown"', 250, 350, 3);
console.log('\n===== Uc (st send rate) =====');
ctx('Uc=', 150, 150, 3);
console.log('\n===== qt( fire function def =====');
ctx('function qt\\(', 50, 500, 1);
ctx('qt=','async function qt', 0, 0, 0);
console.log('\n===== bs.sens default / options =====');
ctx('sens', 150, 200, 5);
