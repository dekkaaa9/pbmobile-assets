const fs = require('fs');
const b = fs.readFileSync('D:/pentest_learn/pbmobile/js/game_bundle.js', 'utf8');

function ctx(pattern, before = 100, after = 600, limit = 2) {
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

console.log('===== on("hp") =====');
ctx('on\\("hp"', 50, 400, 2);
console.log('\n===== on("go") =====');
ctx('on\\("go"', 50, 700, 2);
console.log('\n===== on("game") =====');
ctx('on\\("game"', 50, 500, 2);
console.log('\n===== on("kill") =====');
ctx('on\\("kill"', 50, 400, 2);
console.log('\n===== on("ktag") =====');
ctx('on\\("ktag"', 50, 300, 2);
console.log('\n===== on("end") =====');
ctx('on\\("end"', 50, 300, 1);
console.log('\n===== on("round") =====');
ctx('on\\("round"', 50, 300, 1);
console.log('\n===== on("touch") =====');
ctx('on\\("touch"', 50, 300, 1);
console.log('\n===== on("hide") =====');
ctx('on\\("hide"', 50, 300, 1);
