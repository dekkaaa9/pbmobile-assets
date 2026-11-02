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

console.log('===== hit message send (full) =====');
ctx('t:"hit"', 500, 200, 3);

console.log('\n\n===== spawnme / arm / disarm sends =====');
ctx('t:"spawnme"', 150, 150, 2);
ctx('t:"disarm"', 200, 200, 2);

console.log('\n\n===== own state send: how ents built for self =====');
ctx('R\\(\\{t:"st"', 400, 300, 3);

console.log('\n\n===== NET_MS / st send rate =====');
ctx('"st",\\{', 300, 400, 3);
