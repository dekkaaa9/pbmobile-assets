// Test projecao + aim math (replicando a logica do cheat)
const VW = 1920, VH = 1080;

function makeProjector(self, baseFov) {
  var e = [self.p[0], self.p[1] + (self.c ? 1.101 : 1.648), self.p[2]];
  var sy = Math.sin(self.y), cy = Math.cos(self.y), sp = Math.sin(self.pi), cp = Math.cos(self.pi);
  var right = [cy, 0, -sy], up = [sy * sp, cp, cy * sp], back = [sy * cp, -sp, cy * cp];
  var f = 1 / Math.tan((baseFov * Math.PI / 180) / 2), asp = VW / VH;
  return function (x, y, z) {
    var dx = x - e[0], dy = y - e[1], dz = z - e[2];
    var cx = dx * right[0] + dy * right[1] + dz * right[2];
    var cyy = dx * up[0] + dy * up[1] + dz * up[2];
    var cz = dx * back[0] + dy * back[1] + dz * back[2];
    if (cz > -0.1) return null;
    return { x: ((cx * f / asp) / -cz + 1) / 2 * VW, y: (1 - (cyy * f) / -cz) / 2 * VH, d: -cz };
  };
}
function aimAt(self, x, y, z) {
  var e = [self.p[0], self.p[1] + (self.c ? 1.101 : 1.648), self.p[2]];
  var dx = x - e[0], dy = y - e[1], dz = z - e[2];
  var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.asin(Math.max(-1, Math.min(1, dy / Math.max(0.001, d)))) };
}

const self0 = { p: [0, 0, 0], y: 0, pi: 0, c: 0 };
const proj = makeProjector(self0, 70);

// 1. enemy dead ahead -> center
let s = proj(0, 0, -10);
console.log('ahead   ->', s.x.toFixed(1), s.y.toFixed(1), '(expect ~960, 540) dist', s.d.toFixed(1));

// 2. enemy to the right (world +X) -> screen right
s = proj(5, 0, -10);
console.log('right   ->', s.x.toFixed(1), s.y.toFixed(1), '(expect x>960)');

// 3. enemy above -> screen up
s = proj(0, 5, -10);
console.log('above   ->', s.x.toFixed(1), s.y.toFixed(1), '(expect y<540)');

// 4. behind -> null
s = proj(0, 0, 10);
console.log('behind  ->', s, '(expect null)');

// 5. yawed 90deg (yaw=+PI/2 -> forward=(-1,0,0), looking toward -X): enemy at -X should be ahead
const self90 = { p: [0, 0, 0], y: Math.PI / 2, pi: 0, c: 0 };
const proj90 = makeProjector(self90, 70);
s = proj90(-10, 0, 0);
console.log('yaw90, enemy at -X ->', s.x.toFixed(1), s.y.toFixed(1), '(expect ~center)');
// 5b. mouse-right convention: yaw negative -> forward +X
const selfNeg = { p: [0, 0, 0], y: -Math.PI / 2, pi: 0, c: 0 };
const projNeg = makeProjector(selfNeg, 70);
s = projNeg(10, 0, 0);
console.log('yaw-90, enemy at +X ->', s.x.toFixed(1), s.y.toFixed(1), '(expect ~center; mouse right = yaw--)');

// 6. aimAt conventions
const a1 = aimAt(self0, 0, 0, -10);
console.log('\naim ahead   -> yaw', a1.yaw.toFixed(3), 'pitch', a1.pitch.toFixed(3), '(expect 0, negativo: alvo abaixo do olho)');
const a2 = aimAt(self0, 10, 0, -10);
console.log('aim right   -> yaw', a2.yaw.toFixed(3), '(expect -0.785 = -45deg, game: yaw-=movementX)');
const a3 = aimAt(self0, 0, 10, -10);
console.log('aim up      -> pitch', a3.pitch.toFixed(3), '(expect +0.697 = atan(8.352/10))');

// 7. round-trip: aimAt then project a point along that aim -> should be centered
const tgt = [7, 3, -12];
const aa = aimAt(self0, tgt[0], tgt[1], tgt[2]);
const selfAim = { p: [0, 0, 0], y: aa.yaw, pi: aa.pitch, c: 0 };
const projAim = makeProjector(selfAim, 70);
s = projAim(tgt[0], tgt[1], tgt[2]);
console.log('\naim->project roundtrip (raso)  ->', s.x.toFixed(1), s.y.toFixed(1), '(expect ~960,540)');

// 7b. steep angle round-trip (target high above)
const tgt2 = [2, 14, -6];
const aa2 = aimAt(self0, tgt2[0], tgt2[1], tgt2[2]);
const selfAim2 = { p: [0, 0, 0], y: aa2.yaw, pi: aa2.pitch, c: 0 };
const projAim2 = makeProjector(selfAim2, 70);
s = projAim2(tgt2[0], tgt2[1], tgt2[2]);
console.log('aim->project roundtrip (íngreme) ->', s.x.toFixed(1), s.y.toFixed(1), '(expect ~960,540)');

// 8. forward vector convention check (game: ms(yaw,pitch) = (-cp*sy, sp, -cp*cy))
const y = 0.3, p = -0.2, cy2 = Math.cos(y), sy2 = Math.sin(y), cp2 = Math.cos(p), sp2 = Math.sin(p);
const fwd = [-cp2 * sy2, sp2, -cp2 * cy2];
console.log('fwd(yaw=.3,pitch=-.2):', fwd.map(v => v.toFixed(3)).join(','));
console.log('normalized len:', Math.hypot(...fwd).toFixed(3));
