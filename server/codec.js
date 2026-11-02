'use strict';
// ============================================================
//  codec.js — port PERSIS dari net.js: k() (encode) & E() (decode)
//  Dua arah formatnya BEDA:
//    client -> server : {u8:1, f64:ts, u8:n, ents[...]}
//    server -> client : {u8:1, u8:fromLen, from, f64:ts, u8:n, ents[...]}
//  Jangan diubah — client nolak frame yang formatnya salah.
// ============================================================

const TE = new TextEncoder();
const TD = new TextDecoder();

const MAX_ENTS = 40;
const MAX_ID = 40;
const MAX_W = 255;

// ---------- normalisasi input ----------
// Node Buffer itu Uint8Array di atas ArrayBuffer; DataView butuh
// ArrayBuffer + offset + length. Kalau nggak dinormalisasi,
// `new DataView(buf)` gagal total (Buffer bukan ArrayBuffer).
function toViews(buf) {
  if (buf instanceof ArrayBuffer) return { dv: new DataView(buf), u8: new Uint8Array(buf) };
  if (Buffer.isBuffer(buf)) {
    return {
      dv: new DataView(buf.buffer, buf.byteOffset, buf.byteLength),
      u8: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength),
    };
  }
  if (buf instanceof Uint8Array) {
    return {
      dv: new DataView(buf.buffer, buf.byteOffset, buf.byteLength),
      u8: buf,
    };
  }
  throw new TypeError('codec: input bukan ArrayBuffer/Buffer/Uint8Array');
}

// ---------- ENCODE: server -> client (format E) ----------
function encodeSt(msg) {
  const ents = (msg.ents || []).slice(0, MAX_ENTS);
  const fromId = TE.encode(String(msg.from == null ? '' : msg.from)).slice(0, MAX_ID);

  // hitung ukuran
  let size = 1 + 1 + fromId.length + 8 + 1; // type + fromLen + from + ts + count
  const meta = ents.map((e) => {
    const id = TE.encode(String(e.id)).slice(0, MAX_ID);
    const wIsNum = typeof e.w === 'number';
    const wb = wIsNum ? null : TE.encode(String(e.w == null ? '' : e.w)).slice(0, MAX_W);
    size += 1 + id.length + 23 + (wb ? 2 + wb.length : 5);
    return { id, wb, wIsNum, e };
  });

  const buf = new ArrayBuffer(size);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  let c = 0;

  dv.setUint8(c++, 1);                       // single frame
  dv.setUint8(c++, fromId.length);
  u8.set(fromId, c); c += fromId.length;
  dv.setFloat64(c, +msg.ts || 0, true); c += 8;
  dv.setUint8(c++, ents.length);

  const clamp100 = (v) => Math.max(-127, Math.min(127, Math.round(100 * (+v || 0))));

  for (const m of meta) {
    const e = m.e;
    const p = e.p || [0, 0, 0];
    const mv = e.mv || [0, 0];
    dv.setUint8(c++, m.id.length);
    u8.set(m.id, c); c += m.id.length;
    for (const v of [p[0], p[1], p[2], e.y, e.pi]) { dv.setFloat32(c, +v || 0, true); c += 4; }
    dv.setUint8(c++, (e.c ? 1 : 0) | (e.g ? 2 : 0) | (e.r ? 4 : 0));
    dv.setInt8(c++, clamp100(mv[0]));
    dv.setInt8(c++, clamp100(mv[1]));
    if (m.wb) {
      dv.setUint8(c++, 0);
      dv.setUint8(c++, m.wb.length);
      u8.set(m.wb, c); c += m.wb.length;
    } else {
      dv.setUint8(c++, 1);
      dv.setUint32(c, (e.w || 0) >>> 0, true); c += 4;
    }
  }
  return buf;
}

// batch beberapa frame jadi satu (format E, type 2)
function encodeStBatch(msgs) {
  const frames = msgs.map(encodeSt);
  let size = 3;
  for (const f of frames) size += 2 + f.byteLength;
  const buf = new ArrayBuffer(size);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  dv.setUint8(0, 2);
  dv.setUint16(1, frames.length, true);
  let c = 3;
  for (const f of frames) {
    dv.setUint16(c, f.byteLength, true); c += 2;
    u8.set(new Uint8Array(f), c); c += f.byteLength;
  }
  return buf;
}

// ---------- DECODE: client -> server (format k) ----------
function decodeSt(buf) {
  const { dv, u8 } = toViews(buf);
  const out = [];
  const type = u8[0];

  const readFrame = (off) => {
    // format k: u8:1, f64:ts, u8:count, ents...
    const ts = dv.getFloat64(off + 1, true);
    const count = u8[off + 9];
    let n = off + 10;
    const ents = [];
    for (let i = 0; i < count; i++) {
      const idLen = u8[n]; n += 1;
      const id = TD.decode(u8.subarray(n, n + idLen)); n += idLen;
      const f = [];
      for (let k = 0; k < 5; k++) { f.push(dv.getFloat32(n, true)); n += 4; }
      const bits = u8[n]; n += 1;
      const mv0 = dv.getInt8(n); n += 1;
      const mv1 = dv.getInt8(n); n += 1;
      let w;
      if (u8[n] === 0) {
        n += 1;
        const wl = u8[n]; n += 1;
        w = TD.decode(u8.subarray(n, n + wl)); n += wl;
      } else {
        n += 1;
        w = dv.getUint32(n, true); n += 4;
      }
      ents.push({ id, p: [f[0], f[1], f[2]], y: f[3], pi: f[4], c: bits & 1, g: (bits >> 1) & 1, mv: [mv0 / 100, mv1 / 100], r: (bits >> 2) & 1, w });
    }
    out.push({ t: 'st', ts, from: null, ents });
    return n;
  };

  if (type === 1) readFrame(0);
  else if (type === 2) {
    const count = dv.getUint16(1, true);
    let n = 3;
    for (let i = 0; i < count; i++) {
      const len = dv.getUint16(n, true); n += 2;
      n = readFrame(n) ;
      if (len) { /* len reserved, parser maju sendiri */ }
    }
  }
  return out;
}

// ---------- DECODE: server -> client (format E) — buat tes / relay ----------
function decodeStSrv(buf) {
  const { dv, u8 } = toViews(buf);
  const out = [];
  const readFrame = (off) => {
    const fromLen = u8[off + 1];
    const from = TD.decode(u8.subarray(off + 2, off + 2 + fromLen));
    let n = off + 2 + fromLen;
    const ts = dv.getFloat64(n, true);
    const count = u8[n + 8];
    n += 9;
    const ents = [];
    for (let i = 0; i < count; i++) {
      const idLen = u8[n]; n += 1;
      const id = TD.decode(u8.subarray(n, n + idLen)); n += idLen;
      const f = [];
      for (let k = 0; k < 5; k++) { f.push(dv.getFloat32(n, true)); n += 4; }
      const bits = u8[n]; n += 1;
      const mv0 = dv.getInt8(n); n += 1;
      const mv1 = dv.getInt8(n); n += 1;
      let w;
      if (u8[n] === 0) { n += 1; const wl = u8[n]; n += 1; w = TD.decode(u8.subarray(n, n + wl)); n += wl; }
      else { n += 1; w = dv.getUint32(n, true); n += 4; }
      ents.push({ id, p: [f[0], f[1], f[2]], y: f[3], pi: f[4], c: bits & 1, g: (bits >> 1) & 1, mv: [mv0 / 100, mv1 / 100], r: (bits >> 2) & 1, w });
    }
    out.push({ t: 'st', ts, from, ents });
  };
  const type = u8[0];
  if (type === 1) readFrame(0);
  else if (type === 2) {
    const count = dv.getUint16(1, true);
    let n = 3;
    for (let i = 0; i < count; i++) {
      const len = dv.getUint16(n, true); n += 2;
      readFrame(n); n += len;
    }
  }
  return out;
}

module.exports = { encodeSt, encodeStBatch, decodeSt, decodeStSrv, MAX_ENTS };
