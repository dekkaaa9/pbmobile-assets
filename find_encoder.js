const fs = require('fs');
const b = fs.readFileSync('D:/pentest_learn/pbmobile/js/game_bundle.js', 'utf8');
console.log('LENGTH:', b.length);

function ctx(pattern, before = 250, after = 400, limit = 8) {
  const re = new RegExp(pattern, 'g');
  let m, n = 0;
  while ((m = re.exec(b)) && n < limit) {
    const s = Math.max(0, m.index - before);
    console.log(`\n--- [${m.index}] ---`);
    console.log(b.slice(s, m.index + after));
    n++;
  }
  if (n === 0) console.log('(none)');
  console.log(`total shown: ${n}`);
}

console.log('\n===== setFloat64 writers =====');
ctx('setFloat64', 300, 500, 4);

console.log('\n===== "st" encode: search S(t) call site & definition =====');
// find function definitions named S in bundle scope near R
ctx('function S\\(', 100, 1200, 5);
