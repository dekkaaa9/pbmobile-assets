const fs = require('fs');
const b = fs.readFileSync('D:/pentest_learn/pbmobile/js/game_bundle.js', 'utf8');

function ctx(pattern, before = 200, after = 400, limit = 5) {
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

console.log('===== Ka definition =====');
ctx('Ka=', 300, 200, 5);
console.log('\n===== Ka in conditions =====');
ctx('Ka&&', 200, 300, 5);
console.log('\n===== window.G full block =====');
ctx('window\\.G=\\{', 100, 900, 1);
