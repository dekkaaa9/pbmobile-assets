// test_codec.js — round-trip test codec `st` dua arah.
'use strict';
const { encodeSt, encodeStBatch, decodeSt, decodeStSrv } = require('./codec');

let pass = 0, fail = 0;
function eq(a, b, msg) {
  if (a === b) { pass++; return true; }
  if (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-6) { pass++; return true; }
  fail++;
  console.log('  FAIL ' + msg + ': ' + JSON.stringify(a) + ' != ' + JSON.stringify(b));
  return false;
}

// ---------- 1. server->client round trip ----------
console.log('=== 1. encodeSt -> decodeStSrv ===');
// CATATAN: `mv` disimpan sebagai i8 * 100, jadi range valid cuma +-1.27.
// Nilai di luar itu DI-CLAMP (persis kayak net.js). Test pakai nilai wajar.
{
  const msg = {
    t: 'st', ts: 1730000000123, from: 'b1a2b3c4d5e6f7a8',
    ents: [
      { id: 'p1', p: [12.5, -3.25, 88.125], y: 1.5708, pi: -0.75, c: 1, g: 0, r: 0, mv: [0.75, -0.42], w: 1001 },
      { id: 'p2', p: [-45, 0, 12], y: 0, pi: 0, c: 0, g: 1, r: 1, mv: [0, 0], w: 'm4a1' },
      { id: 'bot3', p: [0, 5, 0], y: 3.14159, pi: 1.4, c: 1, g: 1, r: 1, mv: [1.27, -1.27], w: 0 },
    ],
  };
  const buf = encodeSt(msg);
  const out = decodeStSrv(buf);
  eq(out.length, 1, 'jumlah frame');
  const f = out[0];
  eq(f.from, msg.from, 'from');
  eq(f.ts, msg.ts, 'ts');
  eq(f.ents.length, 3, 'jumlah ent');
  for (let i = 0; i < 3; i++) {
    eq(f.ents[i].id, msg.ents[i].id, 'ent' + i + '.id');
    eq(f.ents[i].p[0], msg.ents[i].p[0], 'ent' + i + '.px');
    eq(f.ents[i].p[1], msg.ents[i].p[1], 'ent' + i + '.py');
    eq(f.ents[i].p[2], msg.ents[i].p[2], 'ent' + i + '.pz');
    eq(f.ents[i].y, msg.ents[i].y, 'ent' + i + '.yaw');
    eq(f.ents[i].pi, msg.ents[i].pi, 'ent' + i + '.pitch');
    eq(f.ents[i].c, msg.ents[i].c, 'ent' + i + '.c');
    eq(f.ents[i].g, msg.ents[i].g, 'ent' + i + '.g');
    eq(f.ents[i].r, msg.ents[i].r, 'ent' + i + '.r');
    eq(f.ents[i].mv[0], msg.ents[i].mv[0], 'ent' + i + '.mv0');
    eq(f.ents[i].mv[1], msg.ents[i].mv[1], 'ent' + i + '.mv1');
    eq(f.ents[i].w, msg.ents[i].w, 'ent' + i + '.w');
  }
  eq(new Uint8Array(buf)[0], 1, 'byte0 single');
}

// ---------- 2. client->server (format k) -> decodeSt ----------
console.log('=== 2. format k (client) -> decodeSt ===');
{
  // encoder format `k` PERSIS kayak net.js
  const TE = new TextEncoder();
  function k(t) {
    const e = (t.ents || []).slice(0, 40);
    const n = e.map(t => [TE.encode(String(t.id)).slice(0, 40), typeof t.w === 'number' ? null : TE.encode(String(t.w == null ? '' : t.w)).slice(0, 255)]);
    let o = 10;
    for (const [t2, e2] of n) o += 1 + t2.length + 23 + (e2 ? 2 + e2.length : 5);
    const r = new ArrayBuffer(o), a = new DataView(r), s = new Uint8Array(r);
    let c = 0;
    a.setUint8(c++, 1);
    a.setFloat64(c, +t.ts || 0, true); c += 8;
    a.setUint8(c++, e.length);
    const i = t => Math.max(-127, Math.min(127, Math.round(100 * (+t || 0))));
    e.forEach((t2, e3) => {
      const [o2, r2] = n[e3];
      const l = t2.p || [0, 0, 0], d = t2.mv || [0, 0];
      a.setUint8(c++, o2.length); s.set(o2, c); c += o2.length;
      for (const e4 of [l[0], l[1], l[2], t2.y, t2.pi]) a.setFloat32(c, +e4 || 0, true), c += 4;
      a.setUint8(c++, (t2.c ? 1 : 0) | (t2.g ? 2 : 0) | (t2.r ? 4 : 0));
      a.setInt8(c++, i(d[0])); a.setInt8(c++, i(d[1]));
      if (r2) { a.setUint8(c++, 0); a.setUint8(c++, r2.length); s.set(r2, c); c += r2.length; }
      else { a.setUint8(c++, 1); a.setUint32(c, t2.w >>> 0, true); c += 4; }
    });
    return r;
  }

  const msg = { t: 'st', ts: 1730000000456, ents: [
    { id: 'sess1', p: [1.5, 2.5, 3.5], y: 0.25, pi: -0.5, c: 1, g: 1, r: 1, mv: [1.23, -1.15], w: 4242 },
    { id: 'sess2', p: [-9, 0, 9], y: 1, pi: 0.9, c: 0, g: 0, r: 0, mv: [0.5, 0.5], w: 'ak47' },
  ] };
  const buf = k(msg);
  const out = decodeSt(buf);
  eq(out.length, 1, 'jumlah frame');
  eq(out[0].ts, msg.ts, 'ts');
  eq(out[0].ents.length, 2, 'jumlah ent');
  for (let i = 0; i < 2; i++) {
    eq(out[0].ents[i].id, msg.ents[i].id, 'ent' + i + '.id');
    eq(out[0].ents[i].p[0], msg.ents[i].p[0], 'ent' + i + '.px');
    eq(out[0].ents[i].y, msg.ents[i].y, 'ent' + i + '.yaw');
    eq(out[0].ents[i].pi, msg.ents[i].pi, 'ent' + i + '.pitch');
    eq(out[0].ents[i].c, msg.ents[i].c, 'ent' + i + '.c');
    eq(out[0].ents[i].g, msg.ents[i].g, 'ent' + i + '.g');
    eq(out[0].ents[i].r, msg.ents[i].r, 'ent' + i + '.r');
    eq(out[0].ents[i].mv[0], msg.ents[i].mv[0], 'ent' + i + '.mv0');
    eq(out[0].ents[i].mv[1], msg.ents[i].mv[1], 'ent' + i + '.mv1');
    eq(out[0].ents[i].w, msg.ents[i].w, 'ent' + i + '.w');
  }
}

// ---------- 3. edge cases ----------
console.log('=== 3. edge cases ===');
{
  const f1 = decodeStSrv(encodeSt({ t: 'st', ts: 1, from: '', ents: [] }));
  eq(f1.length, 1, 'frame kosong');
  eq(f1[0].ents.length, 0, 'ents kosong');

  const longId = 'x'.repeat(60);
  const f2 = decodeStSrv(encodeSt({ t: 'st', ts: 2, from: 'a', ents: [{ id: longId, p: [0, 0, 0], y: 0, pi: 0, w: 1 }] }));
  eq(f2[0].ents[0].id, longId.slice(0, 40), 'id dipotong 40');

  const f3 = decodeStSrv(encodeSt({ t: 'st', ts: 3, from: 'a', ents: [{ id: 'p', p: [0, 0, 0], y: 0, pi: 0, mv: [99, -99], w: 1 }] }));
  eq(f3[0].ents[0].mv[0], 1.27, 'mv0 clamp');
  eq(f3[0].ents[0].mv[1], -1.27, 'mv1 clamp');

  const b = encodeStBatch([
    { t: 'st', ts: 10, from: 'a', ents: [{ id: 'p1', p: [0, 0, 0], y: 0, pi: 0, w: 1 }] },
    { t: 'st', ts: 11, from: 'a', ents: [{ id: 'p2', p: [1, 0, 0], y: 0, pi: 0, w: 1 }] },
    { t: 'st', ts: 12, from: 'a', ents: [{ id: 'p3', p: [2, 0, 0], y: 0, pi: 0, w: 1 }] },
  ]);
  eq(new Uint8Array(b)[0], 2, 'batch byte0 = 2');
  const fb = decodeStSrv(b);
  eq(fb.length, 3, 'batch jumlah');
  eq(fb[0].ents[0].id, 'p1', 'batch f0');
  eq(fb[1].ents[0].id, 'p2', 'batch f1');
  eq(fb[2].ents[0].id, 'p3', 'batch f2');

  const many = [];
  for (let i = 0; i < 40; i++) many.push({ id: 'e' + i, p: [i, 0, 0], y: 0, pi: 0, w: 1 });
  const f4 = decodeStSrv(encodeSt({ t: 'st', ts: 4, from: 'a', ents: many }));
  eq(f4[0].ents.length, 40, '40 ent');

  const f5 = decodeStSrv(encodeSt({ t: 'st', ts: 5, from: 'a', ents: [{ id: 'p', p: [0, 0, 0], y: 0, pi: 0, w: null }] }));
  eq(f5[0].ents[0].w, '', 'w null -> string kosong');

  // ---------- 4. input Node Buffer (jalur nyata dari WS) ----------
  console.log('=== 4. input Node Buffer / Uint8Array ===');
  {
    const msg = { t: 'st', ts: 99, from: 'k', ents: [{ id: 'bp', p: [1, 2, 3], y: 0.5, pi: 0.5, c: 1, g: 1, r: 1, mv: [0.25, -0.25], w: 7 }] };
    const ab = encodeSt(msg);
    const asBuf = Buffer.from(ab);
    eq(Buffer.isBuffer(asBuf), true, 'encodeSt bisa dibungkus Buffer');

    const f1 = decodeStSrv(asBuf);
    eq(f1.length, 1, 'decodeStSrv(Node Buffer) jumlah');
    eq(f1[0].ents[0].id, 'bp', 'decodeStSrv(Node Buffer) id');
    eq(f1[0].ents[0].p[0], 1, 'decodeStSrv(Node Buffer) px');

    const f2 = decodeStSrv(new Uint8Array(ab));
    eq(f2[0].ents[0].p[2], 3, 'decodeStSrv(Uint8Array) pz');

    // buffer dengan offset != 0 (subarray) — kasus paling sering bikin bug
    const padded = Buffer.concat([Buffer.alloc(7, 0xff), asBuf]);
    const sub = padded.subarray(7);
    const f3 = decodeStSrv(sub);
    eq(f3[0].ents[0].id, 'bp', 'decodeStSrv(Buffer dengan offset) id');
    eq(f3[0].ents[0].p[0], 1, 'decodeStSrv(Buffer dengan offset) px');
    eq(f3[0].ents[0].y, 0.5, 'decodeStSrv(Buffer dengan offset) yaw');

    // decodeSt (format client) juga harus terima Buffer
    const TE = new TextEncoder();
    function kClient(ents, ts) {
      let size = 10;
      const meta = ents.map(e => {
        const id = TE.encode(String(e.id)).slice(0, 40);
        const wIsNum = typeof e.w === 'number';
        const wb = wIsNum ? null : TE.encode(String(e.w == null ? '' : e.w)).slice(0, 255);
        size += 1 + id.length + 23 + (wb ? 2 + wb.length : 5);
        return { id, wb, e };
      });
      const buf = new ArrayBuffer(size), dv = new DataView(buf), u8 = new Uint8Array(buf);
      let c = 0;
      dv.setUint8(c++, 1); dv.setFloat64(c, ts, true); c += 8; dv.setUint8(c++, ents.length);
      for (const m of meta) {
        const e = m.e, p = e.p || [0, 0, 0], mv = e.mv || [0, 0];
        dv.setUint8(c++, m.id.length); u8.set(m.id, c); c += m.id.length;
        for (const v of [p[0], p[1], p[2], e.y, e.pi]) dv.setFloat32(c, +v || 0, true), c += 4;
        dv.setUint8(c++, (e.c ? 1 : 0) | (e.g ? 2 : 0) | (e.r ? 4 : 0));
        dv.setInt8(c++, Math.round(100 * mv[0])); dv.setInt8(c++, Math.round(100 * mv[1]));
        if (m.wb) { dv.setUint8(c++, 0); dv.setUint8(c++, m.wb.length); u8.set(m.wb, c); c += m.wb.length; }
        else { dv.setUint8(c++, 1); dv.setUint32(c, e.w >>> 0, true); c += 4; }
      }
      return Buffer.from(buf);
    }
    const f4 = decodeSt(kClient([{ id: 'cp', p: [4, 5, 6], y: 1.5, pi: -1.5, c: 1, g: 0, r: 1, mv: [1, -1], w: 9 }], 1234));
    eq(f4.length, 1, 'decodeSt(Node Buffer) jumlah');
    eq(f4[0].ents[0].id, 'cp', 'decodeSt(Node Buffer) id');
    eq(f4[0].ents[0].p[1], 5, 'decodeSt(Node Buffer) py');
    eq(f4[0].ts, 1234, 'decodeSt(Node Buffer) ts');
  }
}

console.log('');
console.log('HASIL: ' + pass + ' lulus, ' + fail + ' gagal');
process.exit(fail ? 1 : 0);
