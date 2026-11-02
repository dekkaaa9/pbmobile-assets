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

console.log('===== outgoing st send: h.send({t:"st" =====');
ctx('send\\(\\{t:"st"', 600, 400, 3);

console.log('\n\n===== spawn handler (team info) =====');
ctx('on\\("spawn"', 100, 700, 2);

console.log('\n\n===== Ye.s definition / self player =====');
ctx('s=\\{', 0, 0, 0); // skip
ctx('Ye=\\{', 200, 600, 3);

console.log('\n\n===== fc( get player by id =====');
ctx('function fc\\(', 50, 400, 2);

console.log('\n\n===== join/room/team lobby messages =====');
ctx('on\\("join"', 100, 400, 2);
ctx('on\\("room"', 100, 400, 2);
ctx('"team"', 150, 250, 4);
