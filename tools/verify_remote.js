// verify_remote.js — verifikasi ekstraksi site/ di VPS
// Catatan: JANGAN pakai newline (\n) atau variabel shell ($x) di command —
// plink mengirim literal \n dan bash meng-expand $x jadi kosong.
'use strict';
const { runp } = require('./vps.js');

const cmds = [
  'cd /root/pbmobile',
  'echo "=== top-level site/ ==="',
  'ls -la site/',
  'echo "=== hitung file per direktori ==="',
  'echo -n "  static  : "; find site/static -type f | wc -l',
  'echo -n "  assets  : "; find site/assets -type f | wc -l',
  'echo -n "  rml     : "; find site/rml -type f | wc -l',
  'echo -n "  root    : "; find site -maxdepth 1 -type f | wc -l',
  'echo -n "  TOTAL   : "; find site -type f | wc -l',
  'du -sh site',
  'echo "=== file kunci ==="',
  'for f in index.html cc.js home.json goods.json build.json static/game/bundle.js static/game/pb.js static/game/net.js static/vendor/three.min.js; do if [ -f "site/$f" ]; then echo "  OK    $f  $(stat -c %s "site/$f") bytes"; else echo "  HILANG  $f"; fi; done',
  'echo "=== aset per api ==="',
  'for a in anims mapimg mesh showcam skinned sound stage tex weapon; do echo -n "  /a/$a : "; ls site/assets/$a 2>/dev/null | wc -l; done',
  'echo "=== memori & disk ==="',
  'free -m | head -2',
  'df -h / | tail -1',
].join(' ; ');

const r = runp(cmds, { timeout: 600000 });
console.log(r.out);
if (r.out.trim()) console.log('\n[exit ok]');
