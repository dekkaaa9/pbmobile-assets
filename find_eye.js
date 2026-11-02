const fs = require('fs');
const b = fs.readFileSync('D:/pentest_learn/pbmobile/js/game_bundle.js', 'utf8');

function ctx(pattern, before = 200, after = 300, limit = 4) {
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

console.log('===== eye height constants =====');
ctx('eye:', 150, 150, 6);
ctx('eyeCrouch', 150, 150, 4);
ctx('eyeH', 150, 150, 3);
console.log('\n===== fs( eye pos function =====');
ctx('function fs\\(', 50, 300, 1);
ctx('fs=e=>', 100, 300, 2);
console.log('\n===== w= config defaults (CFG) =====');
ctx('\\{map:', 100, 500, 2);
