// test_hooks.js — tes end-to-end hook transport (simulasi document-start)
// Jalankan: node test_hooks.js
//
// Membuktikan:
//  1. hook dipasang SEGERA saat script load (bukan nunggu DOMContentLoaded)
//  2. info boot (readyState/frame) TERSIMPAN walau toggle log mati
//  3. socket yang dibuat SETELAH load ke-hook (kirim + terima)
//  4. realm iframe same-origin juga di-hook (socket di dalamnya kepetang)
//  5. jalur kirim: speed hack ngubah vektor mv di pesan st keluar
//  6. jalur terima: pesan st masuk (format server, dengan from) mengisi state
//  7. status line: Ruang: WS · Pemain: 1 · ID sendiri: ok

'use strict';
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------- mock DOM
function mkCtx() {
  const c = {};
  ['clearRect', 'strokeRect', 'fillRect', 'fillText', 'beginPath', 'moveTo',
    'lineTo', 'stroke', 'arc', 'save', 'restore'].forEach(function (m) { c[m] = function () { }; });
  return c;
}
function mkEl(tag) {
  return {
    tagName: tag, children: [], style: {}, _l: {}, textContent: '',
    appendChild: function (c) { this.children.push(c); return c; },
    setAttribute: function () { },
    getAttribute: function () { return null; },
    addEventListener: function (t, f) { (this._l[t] = this._l[t] || []).push(f); },
    removeEventListener: function () { },
    getContext: function () { return mkCtx(); },
    measureText: function () { return { width: 20 }; }
  };
}

const store = {};
global.localStorage = {
  getItem: function (k) { return k in store ? store[k] : null; },
  setItem: function (k, v) { store[k] = String(v); },
  removeItem: function (k) { delete store[k]; }
};
// config: speed hack nyala (faktor 2), log nyala
store['pbmob_cfg_v1'] = JSON.stringify({
  esp: { on: true, box: true, name: true, dist: true, hp: true, wep: true, line: false },
  aim: { on: false, fov: 6, point: 1, mode: 1, range: 150 },
  trig: { on: false, fov: 20, range: 120, dmg: 0, interval: 0, head: 1 },
  dmg: { on: false, factor: 8 },
  spd: { on: true, factor: 2, pos: false },
  ui: { open: true, log: true }
});

// iframe palsu (same-origin) dengan realm WebSocket sendiri
class FakeWS2 {
  constructor(url) { this.url = url; this.readyState = 1; this._l = {}; this.sent = []; }
  send(d) { this.sent.push(d); }
  close() { this.readyState = 3; }
  addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); }
  removeEventListener() { }
  dispatch(t, ev) { (this._l[t] || []).slice().forEach(function (f) { f(ev); }); }
}
const iframeEl = mkEl('iframe');
iframeEl.src = 'https://game.pbmobile.app/client';
const iframeWin = {
  WebSocket: FakeWS2,
  addEventListener: function () { },
  document: { readyState: 'complete' }
};
Object.defineProperty(iframeEl, 'contentWindow', { value: iframeWin, configurable: true });

const body = mkEl('body');
global.document = {
  body: body,
  readyState: 'loading',
  scripts: [],
  createElement: mkEl,
  addEventListener: function () { },
  querySelector: function () { return null; },
  querySelectorAll: function () { return [iframeEl]; }
};

const rafQ = [];
global.window = {
  innerWidth: 1600, innerHeight: 900,
  addEventListener: function () { },
  requestAnimationFrame: function (f) { rafQ.push(f); return rafQ.length; }
};
global.window.top = global.window;
global.window.self = global.window;
global.requestAnimationFrame = global.window.requestAnimationFrame;
global.window.fetch = global.fetch;
class FakeXHR { open(m, u) { this._u = u; } send() { } }
global.XMLHttpRequest = FakeXHR;
global.window.XMLHttpRequest = FakeXHR;
global.location = { host: 'pbmobile.app', hostname: 'pbmobile.app', pathname: '/' };

// waktu palsu — biar bisa lompatin jeda 2 detik buat scan iframe
let fakeNow = 1000;
performance.now = function () { return fakeNow; };

// WebSocket palsu — bisa dikonstruksi, kirim, dan dispatch event
class FakeWS {
  constructor(url) { this.url = url; this.readyState = 1; this._l = {}; this.sent = []; }
  send(d) { this.sent.push(d); }
  close() { this.readyState = 3; }
  addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); }
  removeEventListener(t, f) { if (this._l[t]) this._l[t] = this._l[t].filter(function (x) { return x !== f; }); }
  dispatch(t, ev) { (this._l[t] || []).slice().forEach(function (f) { f(ev); }); }
}
global.WebSocket = FakeWS;
global.window.WebSocket = FakeWS;

// ---------------------------------------------------------------- codec tes
function encEnt(id, p, y, pi, flags, mv, w) {
  const idb = Buffer.from(id, 'latin1');
  const parts = [Buffer.from([idb.length]), idb];
  const f = Buffer.alloc(20);
  f.writeFloatLE(p[0], 0); f.writeFloatLE(p[1], 4); f.writeFloatLE(p[2], 8);
  f.writeFloatLE(y, 12); f.writeFloatLE(pi, 16);
  parts.push(f, Buffer.from([flags]));
  const m = Buffer.alloc(2);
  m.writeInt8(Math.round(mv[0] * 100), 0); m.writeInt8(Math.round(mv[1] * 100), 1);
  parts.push(m);
  if (typeof w === 'string') {
    const wb = Buffer.from(w, 'latin1');
    parts.push(Buffer.from([0, wb.length]), wb);
  } else {
    const wb = Buffer.alloc(5); wb[0] = 1; wb.writeUInt32LE(w >>> 0, 1);
    parts.push(wb);
  }
  return Buffer.concat(parts);
}
function encClient(ts, ents) {
  const head = Buffer.alloc(10);
  head[0] = 1; head.writeDoubleLE(ts, 1); head[9] = ents.length;
  return Buffer.concat([head].concat(ents));
}
function encServer(from, ts, ents) {
  const fb = Buffer.from(from, 'latin1');
  const head = Buffer.alloc(2 + fb.length + 9);
  head[0] = 1; head[1] = fb.length; fb.copy(head, 2);
  head.writeDoubleLE(ts, 2 + fb.length);
  head[2 + fb.length + 8] = ents.length;
  return Buffer.concat([head].concat(ents));
}
function ab(buf) { const u = new Uint8Array(buf.length); for (let i = 0; i < buf.length; i++) u[i] = buf[i]; return u.buffer; }
function decClient(buf) {
  const b = Buffer.from(buf);
  if (b[0] !== 1) throw new Error('bukan st tunggal');
  let n = 9;
  const cnt = b[n]; n += 1;
  const out = [];
  for (let i = 0; i < cnt; i++) {
    const il = b[n]; n += 1;
    const id = b.toString('latin1', n, n + il); n += il;
    const p = [b.readFloatLE(n), b.readFloatLE(n + 4), b.readFloatLE(n + 8)];
    const y = b.readFloatLE(n + 12), pi = b.readFloatLE(n + 16);
    n += 20;
    const flags = b[n]; n += 1;
    const mv = [b.readInt8(n) / 100, b.readInt8(n + 1) / 100];
    n += 2;
    let w;
    if (b[n] === 0) { n += 1; const wl = b[n]; n += 1; w = b.toString('latin1', n, n + wl); n += wl; }
    else { n += 1; w = b.readUInt32LE(n); n += 4; }
    out.push({ id: id, p: p, y: y, pi: pi, flags: flags, mv: mv, w: w });
  }
  return out;
}

// ---------------------------------------------------------------- jalankan script
const file = path.join(__dirname, 'pbmobile_cheat.user.js');
const src = fs.readFileSync(file, 'utf8');

let fail = 0;
function ok(cond, name, extra) {
  console.log((cond ? '  OK   ' : '  FAIL ') + name + (extra !== undefined ? '  -> ' + extra : ''));
  if (!cond) fail++;
}

console.log('== hook dipasang saat load (document-start) ==');
eval(src);
ok(global.window.WebSocket !== FakeWS, 'WebSocket diganti Proxy saat script load');
ok(global.window.fetch !== global.fetch, 'fetch di-hook (Proxy apply)');
ok(Function.prototype.toString.call(global.window.fetch).indexOf('[native code]') >= 0, 'toString fetch tetap native');
ok(global.window.XMLHttpRequest !== FakeXHR, 'XHR di-hook');
const xhr = new global.window.XMLHttpRequest();
ok(xhr instanceof FakeXHR, 'instance XHR tetap asli');
ok(typeof xhr.open === 'function' && xhr.open !== FakeXHR.prototype.open, 'open XHR ke-hook (properti own)');
ok(FakeXHR.prototype.open.toString() === global.window.XMLHttpRequest.prototype.open.toString(), 'prototype open tetap native');

console.log('== socket dibuat SETELAH load -> ke-hook ==');
const ws = new global.window.WebSocket('wss://host/b1?k=RAHASIA');
ok(ws instanceof FakeWS, 'instance tetap WebSocket asli');
ok(typeof ws.send === 'function' && ws.send !== FakeWS.prototype.send, 'send ke-hook (properti own)');
ok(!!Object.getOwnPropertyDescriptor(ws, 'onmessage'), 'onmessage ke-hook');
ok((ws._l.message || []).length >= 1, 'listener message sendiri kepasang');
ok(FakeWS.prototype.send.toString() === global.window.WebSocket.prototype.send.toString(), 'prototype send tetap native');
ok(Function.prototype.toString.call(global.window.WebSocket).indexOf('[native code]') >= 0, 'toString WebSocket tetap native');

console.log('== jalur terima: st masuk (format server) mengisi state ==');
// frame battle PERTAMA yang datang = state sendiri (server kirim posisi kita
// sendiri di entitas pertama). Jadi entitas ini sekaligus nge-lock self.id.
const me = encEnt('pemain01', [10, 5, -20], 1.2, 0.3, 0, [0.5, 0.5], 'ak47');
const foe = encEnt('musuh01', [12, 5, -22], -1.0, 0.1, 0, [0.2, 0], 'm4');
ws.dispatch('message', { data: ab(encServer('pemain01', 1234.6, [me, foe])) });

console.log('== jalur kirim: speed hack ngubah mv (setelah self terkunci) ==');
ws.send(encClient(1236.0, [encEnt('pemain01', [10, 5, -20], 1.2, 0.3, 0, [0.5, 0.5], 'ak47')]));
const back = decClient(ws.sent[ws.sent.length - 1]);
ok(back.length === 1 && back[0].id === 'pemain01', 'entitas utuh setelah encode ulang');
ok(Math.abs(back[0].mv[0] - 1.0) < 0.01 && Math.abs(back[0].mv[1] - 1.0) < 0.01,
  'mv 0.5 -> 1.0 (faktor 2)', JSON.stringify(back[0].mv));
ok(Math.abs(back[0].y - 1.2) < 0.001 && Math.abs(back[0].pi - 0.3) < 0.001, 'yaw/pitch nggak diutak-atik');

console.log('== realm iframe same-origin juga di-hook ==');
fakeNow += 3000;                       // lompatin jeda scan iframe (2 detik)
const frame1 = rafQ.shift(); if (frame1) frame1();
ok(iframeWin.WebSocket !== FakeWS2, 'WebSocket realm iframe diganti Proxy');
const ws2 = new iframeWin.WebSocket('wss://game.pbmobile.app/b1?k=IFRAME');
ok(typeof ws2.send === 'function' && ws2.send !== FakeWS2.prototype.send, 'socket dalam iframe ke-hook');
// entitas pakai id yang sama dengan self.id (state sendiri dipetang dari realm utama)
ws2.send(encClient(1235.0, [encEnt('pemain01', [3, 5, -9], 0.5, -0.2, 0, [0.4, 0.4], 'm4')]));
const back2 = decClient(ws2.sent[ws2.sent.length - 1]);
ok(Math.abs(back2[0].mv[0] - 0.8) < 0.01, 'mv di realm iframe juga dimodifikasi (0.4 -> 0.8)', JSON.stringify(back2[0].mv));

console.log('== loop + status line ==');
for (let i = 0; i < 6; i++) { fakeNow += 100; const f = rafQ.shift(); if (f) f(); }

function findText(node, pred, acc) {
  acc = acc || [];
  if (node && typeof node.textContent === 'string' && pred(node.textContent)) acc.push(node);
  (node && node.children || []).forEach(function (c) { findText(c, pred, acc); });
  return acc;
}
const status = findText(body, function (t) { return t.indexOf('Ruang:') === 0; });
ok(status.length === 1, 'status line kepasang');
const st = status.length ? status[0].textContent : '';
ok(st.indexOf('Ruang: WS') >= 0, 'Ruang: WS (battle socket kedeteksi)', st);
ok(st.indexOf('Pemain: 1') >= 0, 'Pemain: 1 (st masuk keproses)', st);
ok(st.indexOf('ID sendiri: ok') >= 0, 'ID sendiri kepetang dari frame battle', st);
ok(st.indexOf('ws 1/1') >= 0, 'diagnosa ws: socket ke-hook & kebuka', st.replace(/\n/g, ' | '));

console.log('== log debug: info boot + event ==');
const logs = findText(body, function (t) { return t.indexOf('t0 rs=') >= 0; });
ok(logs.length === 1, 'info boot kepetang di log', logs.length ? logs[0].textContent.replace(/\n/g, ' | ') : '');
const lt = logs.length ? logs[0].textContent : '';
ok(lt.indexOf('rs=loading') >= 0, 'readyState tercatat (loading = injeksi tepat waktu)');
ok(lt.indexOf('frame=top') >= 0, 'frame tercatat');
ok(lt.indexOf('iframe=1') >= 0, 'jumlah iframe tercatat');
ok(lt.indexOf('ws wss://') >= 0, 'event ws tercatat');
ok(lt.indexOf('st↓') >= 0, 'event st↓ tercatat');

console.log(fail === 0 ? '\nSEMUA LULUS' : '\nADA ' + fail + ' GAGAL');
process.exit(fail === 0 ? 0 : 1);
