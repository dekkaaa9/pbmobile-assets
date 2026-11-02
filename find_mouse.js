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

console.log('===== mousemove / movementX handling =====');
ctx('movementX', 300, 300, 4);
console.log('\n===== pointerlock =====');
ctx('pointerlock', 150, 250, 3);
console.log('\n===== camera.rotation / rotation.order =====');
ctx('camera\\.rotation', 200, 250, 5);
ctx('rotation\\.order', 150, 150, 3);
console.log('\n===== yaw/pitch application =====');
ctx('\\.yaw=', 200, 250, 5);
ctx('\\.pitch=', 200, 250, 5);
