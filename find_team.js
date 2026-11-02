const fs = require('fs');
const b = fs.readFileSync('D:/pentest_learn/pbmobile/js/game_bundle.js', 'utf8');

function ctx(pattern, before = 300, after = 500, limit = 4) {
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

console.log('===== all t:"st" occurrences =====');
ctx('t:"st"', 350, 350, 6);

console.log('\n\n===== team: field in messages =====');
ctx('team:', 200, 200, 6);

console.log('\n\n===== h.on handlers list =====');
const handlers = [...b.matchAll(/\.on\("([a-z_0-9]+)"/g)].map(m => m[1]);
console.log([...new Set(handlers)].sort().join(', '));
