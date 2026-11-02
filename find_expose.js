const fs = require('fs');
const b = fs.readFileSync('D:/pentest_learn/pbmobile/js/game_bundle.js', 'utf8');

function ctx(pattern, before = 150, after = 450, limit = 4) {
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

console.log('===== window.__THREE__ =====');
ctx('window\\.__THREE__', 100, 300, 2);
console.log('\n===== window.HUDO =====');
ctx('window\\.HUDO', 100, 400, 2);
console.log('\n===== window.MODEX =====');
ctx('window\\.MODEX', 100, 500, 2);
console.log('\n===== window.GAME_READY =====');
ctx('window\\.GAME_READY', 100, 200, 3);
console.log('\n===== setAnimationLoop / renderer z =====');
ctx('setAnimationLoop', 200, 200, 3);
console.log('\n===== F= camera creation =====');
ctx('F=new ', 150, 250, 6);
