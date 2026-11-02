// Unit test: codec round-trip + decoder against known-good byte layout
const fs = require('fs');
const src = fs.readFileSync('D:/pentest_learn/pbmobile/cheat/pbmobile_cheat.user.js', 'utf8');

// extract the codec functions by evaluating the IIFE body pieces we need
// simpler: re-implement the harness by pulling functions via regex-free eval of a shim
const shim = `
var TD = new TextDecoder(), TE = new TextEncoder();
${src.slice(src.indexOf('function parseEnts'), src.indexOf('// ---------------------------------------------------------------- matematika'))}
return { decodeSt, decodeStClient, encodeSt };
`;
const codec = new Function(shim)();

// ---- test 1: client-format round trip (what the game sends) ----
const msg = {
  t: 'st',
  ts: 1234567890.5,
  ents: [
    { id: 'abc123', p: [10.5, 2.25, -30.75], y: 1.5708, pi: -0.35, c: 1, g: 0, mv: [0.5, -0.75], r: 1, w: '508001' },
    { id: 'x', p: [0, 0, 0], y: 0, pi: 0, c: 0, g: 1, mv: [0, 0], r: 0, w: 12345 }
  ]
};
const buf = codec.encodeSt(msg);
console.log('encoded bytes:', buf.byteLength);
const back = codec.decodeStClient(buf);
console.log('roundtrip msgs:', back.length);
console.log('ts match:', Math.abs(back[0].ts - msg.ts) < 0.001);
console.log('ent count:', back[0].ents.length);
const e0 = back[0].ents[0];
console.log('id:', e0.id, '| p:', e0.p.map(v => v.toFixed(2)).join(','), '| y:', e0.y.toFixed(4), '| pi:', e0.pi.toFixed(4));
console.log('flags c/g/r:', e0.c, e0.g, e0.r, '| mv:', e0.mv, '| w:', e0.w);
const e1 = back[0].ents[1];
console.log('ent2 w (numeric):', e1.w, typeof e1.w);

// ---- test 2: server-format decode (with from) ----
// build server format manually: [1][fromLen][from][ts][cnt]{ent}
function buildServer(from, ts, ents) {
  const parts = [];
  const head = [1];
  const fb = new TextEncoder().encode(from);
  head.push(fb.length);
  const tsBuf = new ArrayBuffer(8);
  new DataView(tsBuf).setFloat64(0, ts, true);
  const total = 2 + fb.length + 8 + 1 + ents.reduce((a, e) => {
    const ib = new TextEncoder().encode(e.id);
    return a + 1 + ib.length + 20 + 3 + (typeof e.w === 'number' ? 5 : 2 + new TextEncoder().encode(e.w).length);
  }, 0);
  const out = new Uint8Array(total);
  let n = 0;
  out[n++] = 1; out[n++] = fb.length; out.set(fb, n); n += fb.length;
  new DataView(out.buffer).setFloat64(n, ts, true); n += 8;
  out[n++] = ents.length;
  for (const e of ents) {
    const ib = new TextEncoder().encode(e.id);
    out[n++] = ib.length; out.set(ib, n); n += ib.length;
    const dv = new DataView(out.buffer);
    dv.setFloat32(n, e.p[0], true); dv.setFloat32(n + 4, e.p[1], true); dv.setFloat32(n + 8, e.p[2], true);
    dv.setFloat32(n + 12, e.y, true); dv.setFloat32(n + 16, e.pi, true); n += 20;
    out[n++] = (e.c ? 1 : 0) | (e.g ? 2 : 0) | (e.r ? 4 : 0);
    out[n++] = Math.round(e.mv[0] * 100); out[n++] = Math.round(e.mv[1] * 100);
    if (typeof e.w === 'number') { out[n++] = 1; dv.setUint32(n, e.w, true); n += 4; }
    else { const wb = new TextEncoder().encode(e.w); out[n++] = 0; out[n++] = wb.length; out.set(wb, n); n += wb.length; }
  }
  return out.buffer;
}
const srv = buildServer('player42', 999.25, [
  { id: 'player42', p: [1.5, 0, -2.5], y: 3.14159, pi: 0.1, c: 0, g: 1, mv: [1, 0], r: 0, w: 'AK47' },
  { id: 'bot7', p: [5, 0, 5], y: 0, pi: 0, c: 0, g: 1, mv: [0, -1], r: 1, w: 777 }
]);
const sm = codec.decodeSt(srv);
console.log('\nserver decode:', sm.length, 'msg | from:', sm[0].from, '| ents:', sm[0].ents.length);
console.log('from ent:', sm[0].ents[0].id, sm[0].ents[0].p, 'w:', sm[0].ents[0].w);
console.log('bot ent:', sm[0].ents[1].id, 'w:', sm[0].ents[1].w);

// ---- test 3: batch format ----
function buildBatch(list) {
  const enc = new TextEncoder();
  const msgs = list.map(([from, ts, ents]) => {
    const b = new Uint8Array(buildServer(from, ts, ents));
    const len = b.length;
    const out = new Uint8Array(2 + len);
    new DataView(out.buffer).setUint16(0, len, true);
    out.set(b, 2);
    return out;
  });
  const total = 3 + msgs.reduce((a, m) => a + m.length, 0);
  const out = new Uint8Array(total);
  out[0] = 2;
  new DataView(out.buffer).setUint16(1, msgs.length, true);
  let n = 3;
  for (const m of msgs) { out.set(m, n); n += m.length; }
  return out.buffer;
}
const batch = buildBatch([
  ['p1', 100, [{ id: 'p1', p: [1, 1, 1], y: 0, pi: 0, c: 0, g: 1, mv: [0, 0], r: 0, w: 'A' }]],
  ['p2', 200, [{ id: 'p2', p: [2, 2, 2], y: 0, pi: 0, c: 0, g: 1, mv: [0, 0], r: 0, w: 'B' }]]
]);
const bm = codec.decodeSt(batch);
console.log('\nbatch decode:', bm.length, 'msgs |', bm.map(m => m.from + ':' + m.ents[0].id).join(', '));
console.log('\nALL CODEC TESTS DONE');
