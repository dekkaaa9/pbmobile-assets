// ==UserScript==
// @name         Pusat Kendali
// @namespace    pbmobile.local
// @version      1.3
// @description  Panel kendali pertandingan
// @match        https://pbmobile.app/*
// @match        https://*.pbmobile.app/*
// @match        https://pbmobile.ch/*
// @match        https://*.pbmobile.ch/*
// @match        https://pointblankmobile.es/*
// @match        https://*.pointblankmobile.es/*
// @match        https://pbmobile-th.online/*
// @match        https://*.pbmobile-th.online/*
// @run-at       document-start
// ==/UserScript==

/*
 * Pusat Kendali v1.3 — klien bantu buat pertandingan online.
 *
 * RIWAYAT BUG (biar nggak diulang):
 *  v1.0 — hook dipasang di DOMContentLoaded; game udah konek duluan → buta total.
 *  v1.1 — hook dipasang di document-start + jalur onmessage & addEventListener +
 *         RTCDataChannel. TAPI tetap nol: nggak ada baris "ws ..." di log sama
 *         sekali → socket/worker/transport game jalan di luar jangkauan hook.
 *  v1.2 — diagnosa diperluas (log selalu nyala, realm iframe, fetch/xhr/sse/
 *         worker/webtransport, tag toString lintas realm). Hasil dari user:
 *         "t0 rs=loading", "frame=top", "iframe=0" → injeksi TEPAT WAKTU dan
 *         game di window utama. Tapi tetap nol → berarti bukan soal timing.
 *  v1.3 — dugaan utama: socket game dibuat SEBELUM script ini jalan (mis. lewat
 *         <script> di <head> yang jalan sebelum userscript), jadi Proxy telat.
 *         Yang ditambah: pantau lifecycle socket (open/close/error) + diagnosa
 *         "ws n/m [host] · frame" di status. Kalau m=0 → konfirmasi socket
 *         dibuat sebelum hook. Solusi untuk kasus itu ada di panduan
 *         (CARA-PAKAI.md → bagian "Kalau m=0").
 *
 * Aturan anti-curang yang tetap dijaga:
 *  - Nol variabel global baru (semua dalam IIFE)
 *  - Nol patch prototype (WebSocket/Canvas/rAF/Object/Storage/WeakMap/Map/Function.toString utuh)
 *  - Hook per-instance / Proxy konstruktor saja — prototype tetap native
 *  - Proyeksi dihitung sendiri (pos+yaw+pitch dari aliran st) — renderer nggak di-hook
 *  - Kanvas overlay + panel pakai data-pb — dikecualikan dari hitungan layer & scan teks
 *  - Nol event input sintetis — pencatat input palsu tetap 0
 *  - Fungsi kirim game (NETC) nggak disentuh — snapshot jaringan aman
 *  - Listener game TIDAK dibungkus ulang; kita tambah listener sendiri
 *
 * Codec biner "st" diport 1:1 dari bundle game:
 *  - server->klien: [1][fromLen][from][ts:f64][cnt:u8]{ents}
 *  - klien->server: [1][ts:f64][cnt:u8]{ents}   (tanpa from — server yang menyuntik)
 *  - entitas: [idLen][id][x,y,z,yaw,pitch:f32][flags:u8][mvx,mvz:i8][w: 0|len|str | 1|u32]
 */

(function () {
'use strict';

// ---------------------------------------------------------------- konfigurasi
var KEY = 'pbmob_cfg_v1';
var DEF = {
  esp:  { on: true,  box: true,  name: true,  dist: true,  hp: true,  wep: true,  line: false },
  aim:  { on: false, fov: 6,     point: 1,    mode: 1,     range: 150 },
  trig: { on: false, fov: 20,    range: 120,  dmg: 0,      interval: 0, head: 1 },
  dmg:  { on: false, factor: 8 },
  spd:  { on: false, factor: 1.25, pos: false },
  ui:   { open: true, log: false }
};
var cfg = load();

function load() {
  try {
    var raw = localStorage.getItem(KEY);
    if (!raw) return JSON.parse(JSON.stringify(DEF));
    var o = JSON.parse(raw);
    var d = JSON.parse(JSON.stringify(DEF));
    for (var k in d) if (o[k] && typeof o[k] === 'object') for (var k2 in d[k]) if (typeof o[k][k2] !== 'undefined') d[k][k2] = o[k][k2];
    return d;
  } catch (e) { return JSON.parse(JSON.stringify(DEF)); }
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) {} }

// ---------------------------------------------------------------- konstanta
var EYE = 1.648, EYE_C = 1.101, HEAD_Y = 1.75, AIM_CHEST = 1.2, AIM_HEAD = 1.65;
var STALE_MS = 1200, DROP_MS = 5000;

// ---------------------------------------------------------------- state
var self = { id: null, team: null, p: null, y: 0, pi: 0, c: 0, w: null, hp: 100, dead: false };
var players = {};          // id -> {id,p,y,pi,c,g,r,mv,w,ts,team,hp,name,dead}
var myTeam = null, roster = {};
var lobbyWs = null, battleWs = null, battleCh = null;
var lastHit = { dmg: 0, w: null, t: 0, interval: 120 };
var lastTrig = 0, lastHitLog = 0, aimTarget = null, rmbDown = false;
var weaponNames = null, weaponFetching = false;

// jejak internal — WeakMap/WeakSet, nol tanda di objek game
var KIND = new WeakMap();      // socket/channel -> 'ws' | 'rtc'
var seenEv = new WeakSet();    // dedupe event yang masuk lewat 2 jalur
var stLoggedUp = new WeakSet();   // biar log st↑ nggak spam
var stLoggedDown = new WeakSet(); // biar log st↓ nggak spam
var hookedObj = new WeakSet(); // guard anti dobel-hook
var hookedFrame = new WeakSet();
var sockList = [];             // semua socket/channel yang ke-hook (buat diagnosa)
var typeCount = {};

// ---------------------------------------------------------------- log debug
// SELALU disimpan ke buffer (walau toggle mati) — biar info boot & event awal
// nggak kelewat waktu user nyalain "Catatan pesan" di tengah match.
var bootLines = [], dbgLines = [], logEl = null;
function log(s) {
  try {
    dbgLines.push(s);
    if (dbgLines.length > 40) dbgLines.shift();
    if (cfg.ui.log) {
      console.log('[pk]', s);
      renderLog();
    }
  } catch (e) { }
}
function bootLog(s) {
  try {
    bootLines.push(s);
    if (bootLines.length > 8) bootLines.shift();
  } catch (e) { }
}
function renderLog() {
  if (!logEl) return;
  var s = bootLines.join('\n');
  if (dbgLines.length) s += (s ? '\n' : '') + dbgLines.slice(-8).join('\n');
  logEl.textContent = s;
}

// ---------------------------------------------------------------- codec
var TD = new TextDecoder(), TE = new TextEncoder();

// cek tipe pakai tag toString — aman lintas realm (iframe punya ArrayBuffer sendiri)
function isAB(x) { return Object.prototype.toString.call(x) === '[object ArrayBuffer]'; }
function isBlob(x) { return Object.prototype.toString.call(x) === '[object Blob]'; }

function parseEnts(dv, u8, n, cnt) {
  var ents = [];
  for (var i = 0; i < cnt; i++) {
    var il = u8[n]; n += 1;
    var id = TD.decode(u8.subarray(n, n + il)); n += il;
    var x = dv.getFloat32(n, true), y = dv.getFloat32(n + 4, true), z = dv.getFloat32(n + 8, true);
    var yw = dv.getFloat32(n + 12, true), pt = dv.getFloat32(n + 16, true);
    n += 20;
    var s = u8[n]; n += 1;
    var mvx = dv.getInt8(n); n += 1;
    var mvz = dv.getInt8(n); n += 1;
    var w;
    if (u8[n] === 0) { n += 1; var wl = u8[n]; n += 1; w = TD.decode(u8.subarray(n, n + wl)); n += wl; }
    else { n += 1; w = dv.getUint32(n, true); n += 4; }
    ents.push({ id: id, p: [x, y, z], y: yw, pi: pt, c: s & 1, g: (s >> 1) & 1, mv: [mvx / 100, mvz / 100], r: (s >> 2) & 1, w: w });
  }
  return { ents: ents, n: n };
}

// server -> klien (dengan from)
function decodeSt(buf) {
  try {
    var dv = new DataView(buf), u8 = new Uint8Array(buf), out = [];
    function one(off) {
      var fl = u8[off + 1];
      var from = TD.decode(u8.subarray(off + 2, off + 2 + fl));
      var n = off + 2 + fl;
      var ts = dv.getFloat64(n, true); n += 8;
      var cnt = dv.getUint8(n); n += 1;
      var r = parseEnts(dv, u8, n, cnt);
      out.push({ t: 'st', ts: ts, from: from, ents: r.ents });
      return r.n;
    }
    if (u8[0] === 1) one(0);
    else if (u8[0] === 2) {
      var cnt = dv.getUint16(1, true), n = 3;
      for (var i = 0; i < cnt; i++) {
        var len = dv.getUint16(n, true);
        n += 2;
        one(n);
        n += len;
      }
    }
    return out;
  } catch (e) { return []; }
}

// klien -> server (tanpa from)
function decodeStClient(buf) {
  try {
    var dv = new DataView(buf), u8 = new Uint8Array(buf);
    if (u8[0] === 2) return decodeSt(buf);
    if (u8[0] !== 1) return [];
    var n = 1;
    var ts = dv.getFloat64(n, true); n += 8;
    var cnt = dv.getUint8(n); n += 1;
    var r = parseEnts(dv, u8, n, cnt);
    return [{ t: 'st', ts: ts, ents: r.ents }];
  } catch (e) { return []; }
}

// cek hasil decode bukan sampah — jaga-jaga kalau binary di socket itu bukan "st"
function plausible(msgs) {
  if (!msgs || !msgs.length || msgs.length > 64) return false;
  for (var i = 0; i < msgs.length; i++) {
    var m = msgs[i];
    if (!m || !m.ents || !m.ents.length || m.ents.length > 40) return false;
    for (var j = 0; j < m.ents.length; j++) {
      var e = m.ents[j];
      if (!e || typeof e.id !== 'string' || e.id.length < 1 || e.id.length > 40) return false;
      if (!/^[\x20-\x7e]+$/.test(e.id)) return false;
      var p = e.p;
      if (!p || !isFinite(p[0]) || !isFinite(p[1]) || !isFinite(p[2])) return false;
      if (p[0] < -5000 || p[0] > 5000 || p[1] < -500 || p[1] > 2000 || p[2] < -5000 || p[2] > 5000) return false;
      if (!isFinite(e.y) || !isFinite(e.pi) || e.pi < -2 || e.pi > 2) return false;
    }
  }
  return true;
}

// coba dua format; serverFirst = true buat data masuk (format dengan from)
function decodeStAny(buf, serverFirst) {
  var a = serverFirst ? decodeSt(buf) : decodeStClient(buf);
  if (plausible(a)) return a;
  var b = serverFirst ? decodeStClient(buf) : decodeSt(buf);
  if (plausible(b)) return b;
  return [];
}

function encodeSt(msg) {
  var ents = (msg.ents || []).slice(0, 40);
  var enc = ents.map(function (e) {
    return [TE.encode(String(e.id)).slice(0, 40), (typeof e.w === 'number') ? null : TE.encode(String(e.w == null ? '' : e.w)).slice(0, 255)];
  });
  var size = 10;
  for (var i = 0; i < enc.length; i++) size += 1 + enc[i][0].length + 23 + (enc[i][1] ? 2 + enc[i][1].length : 5);
  var buf = new ArrayBuffer(size), dv = new DataView(buf), u8 = new Uint8Array(buf), s = 0;
  dv.setUint8(s++, 1);
  dv.setFloat64(s, +msg.ts || 0, true); s += 8;
  dv.setUint8(s++, ents.length);
  var cl = function (v) { return Math.max(-127, Math.min(127, Math.round(100 * (+v || 0)))); };
  ents.forEach(function (e, i) {
    var idb = enc[i][0], wb = enc[i][1], p = e.p || [0, 0, 0], mv = e.mv || [0, 0];
    dv.setUint8(s++, idb.length); u8.set(idb, s); s += idb.length;
    var vals = [p[0], p[1], p[2], e.y, e.pi];
    for (var k = 0; k < 5; k++) { dv.setFloat32(s, +vals[k] || 0, true); s += 4; }
    dv.setUint8(s++, (e.c ? 1 : 0) | (e.g ? 2 : 0) | (e.r ? 4 : 0));
    dv.setInt8(s++, cl(mv[0])); dv.setInt8(s++, cl(mv[1]));
    if (wb) { dv.setUint8(s++, 0); dv.setUint8(s++, wb.length); u8.set(wb, s); s += wb.length; }
    else { dv.setUint8(s++, 1); dv.setUint32(s, e.w >>> 0, true); s += 4; }
  });
  return buf;
}

// ambil ArrayBuffer bersih dari apa pun yang dikirim (ArrayBuffer / view)
function toBuf(data) {
  if (isAB(data)) return data;
  if (data && isAB(data.buffer) && typeof data.byteLength === 'number') {
    if (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength) return data.buffer;
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  }
  return null;
}

// ---------------------------------------------------------------- matematika
function fovRad() { return (cfg.aim.fov || 6) * Math.PI / 180; }
function eyePos() {
  var p = self.p || [0, 0, 0];
  return [p[0], p[1] + (self.c ? EYE_C : EYE), p[2]];
}
function aimAt(x, y, z) {
  var e = eyePos();
  var dx = x - e[0], dy = y - e[1], dz = z - e[2];
  var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  // konvensi game: yaw = atan2(-dx, -dz), pitch = asin(dy / |d|)  (r = jarak 3D)
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.asin(Math.max(-1, Math.min(1, dy / Math.max(0.001, d)))) };
}
function dist3(a, b) { var dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2]; return Math.sqrt(dx * dx + dy * dy + dz * dz); }
function isEnemy(pl) {
  if (pl.id === self.id) return false;
  if (myTeam != null && pl.team != null) return pl.team !== myTeam;
  return true; // tim tak diketahui = anggap musuh (DM/FFA)
}
function alivePlayers() {
  var now = performance.now(), out = [];
  for (var id in players) {
    var pl = players[id];
    if (now - pl.ts > DROP_MS) { delete players[id]; continue; }
    if (pl.dead) continue;
    out.push(pl);
  }
  return out;
}

// ---------------------------------------------------------------- proyeksi
var VW = 0, VH = 0;
function makeProjector() {
  var e = eyePos();
  var sy = Math.sin(self.y), cy = Math.cos(self.y), sp = Math.sin(self.pi), cp = Math.cos(self.pi);
  var right = [cy, 0, -sy], up = [sy * sp, cp, cy * sp], back = [sy * cp, -sp, cy * cp];
  var f = 1 / Math.tan((baseFov() * Math.PI / 180) / 2), asp = VW / Math.max(1, VH);
  return function (x, y, z) {
    var dx = x - e[0], dy = y - e[1], dz = z - e[2];
    var cx = dx * right[0] + dy * right[1] + dz * right[2];
    var cyy = dx * up[0] + dy * up[1] + dz * up[2];
    var cz = dx * back[0] + dy * back[1] + dz * back[2];
    if (cz > -0.1) return null;
    return { x: ((cx * f / asp) / -cz + 1) / 2 * VW, y: (1 - (cyy * f) / -cz) / 2 * VH, d: -cz };
  };
}
function baseFov() {
  try { var o = JSON.parse(localStorage.getItem('pbweb_opts') || '{}'); return Math.min(80, Math.max(35, +o.fov || 70)); }
  catch (e) { return 70; }
}

// ---------------------------------------------------------------- pesan lobby
function onLobbyMsg(m) {
  if (!m || typeof m !== 'object' || !m.t) return;
  var c = (typeCount[m.t] = (typeCount[m.t] || 0) + 1);
  if (c <= 2) log('msg ' + m.t);
  switch (m.t) {
    case 'game':
      players = {}; roster = {}; aimTarget = null; myTeam = null;
      if (m.you) self.id = String(m.you);
      var ents = (m.game && m.game.ents) || m.ents || [];
      for (var i = 0; i < ents.length; i++) {
        var en = ents[i];
        if (en && en.id != null) {
          roster[String(en.id)] = { team: (en.team == null ? null : en.team), name: en.name || null };
          if (String(en.id) === self.id && en.team != null) myTeam = en.team;
        }
      }
      if (myTeam == null && m.team != null) myTeam = m.team;
      break;
    case 'spawn':
      if (m.id != null) {
        var sp = players[String(m.id)];
        if (sp) { sp.dead = false; sp.hp = 100; sp.ts = performance.now(); }
        if (String(m.id) === self.id) { self.dead = false; self.hp = 100; }
      }
      break;
    case 'hp':
      if (m.id != null && m.hp != null) {
        var hp = players[String(m.id)];
        if (hp) { hp.hp = m.hp; if (m.hp <= 0) hp.dead = true; }
        if (String(m.id) === self.id) { self.hp = m.hp; if (m.hp <= 0) self.dead = true; }
      }
      break;
    case 'kill':
      if (m.victim != null) {
        var v = players[String(m.victim)];
        if (v) { v.dead = true; v.hp = 0; }
        if (String(m.victim) === self.id) { self.dead = true; self.hp = 0; }
      }
      break;
    case 'gone':
      if (m.id != null) delete players[String(m.id)];
      break;
    case 'joined':
      if (m.ent && m.ent.id != null) {
        roster[String(m.ent.id)] = { team: (m.ent.team == null ? null : m.ent.team), name: m.ent.name || null };
      }
      break;
    case 'cfswap':
      var nr = {};
      for (var id2 in roster) { var r2 = roster[id2]; nr[id2] = { team: (r2.team == null ? null : r2.team ^ 1), name: r2.name }; }
      roster = nr;
      if (myTeam != null) myTeam = myTeam ^ 1;
      for (var id3 in players) if (players[id3].team != null) players[id3].team ^= 1;
      break;
    case 'ktag':
      if (m.id != null && m.team != null) {
        var tg = players[String(m.id)];
        if (tg) tg.team = m.team;
      }
      break;
  }
  // roster -> players (nama/tim yang diketahui)
  for (var pid in roster) {
    var pl = players[pid];
    if (pl) { pl.team = roster[pid].team; if (roster[pid].name) pl.name = roster[pid].name; }
  }
}

// ---------------------------------------------------------------- hook transport
function openState(s) {
  if (!s) return false;
  return s.readyState === 1 || s.readyState === 'open';
}

// jalur penerima: properti onmessage (kalau game pakai ini) + listener sendiri
// (kalau game pakai addEventListener). Listener game TIDAK dibungkus — kita
// cuma nambah listener sendiri, jadi removeEventListener milik game aman.
function hookRecv(obj, isBattle) {
  var gameFn = null;
  try {
    Object.defineProperty(obj, 'onmessage', {
      configurable: true,
      get: function () { return gameFn; },
      set: function (fn) {
        gameFn = function (ev) {
          try { onRecv(obj, ev, isBattle); } catch (e) { }
          if (typeof fn === 'function') fn.call(this, ev);
        };
      }
    });
  } catch (e) { }
  try {
    obj.addEventListener('message', function (ev) {
      try { onRecv(obj, ev, isBattle); } catch (e) { }
    });
  } catch (e) { }
}

function hookSocket(ws, url, tag) {
  if (hookedObj.has(ws)) return;      // guard anti dobel-hook
  hookedObj.add(ws);
  var isBattle = /\/b[12](\?|$)/.test(url) || url.indexOf('?k=') >= 0 || url.indexOf('/battle') >= 0;
  KIND.set(ws, 'ws');
  sockList.push(ws);
  if (isBattle) battleWs = ws;
  else if (!lobbyWs) lobbyWs = ws;
  log((tag ? tag + ' ' : '') + 'ws ' + url);

  // kirim — properti own (prototype tetap native)
  var origSend = ws.send.bind(ws);
  ws.send = function (data) {
    try { data = onSend(ws, data, isBattle); } catch (e) { }
    return origSend(data);
  };

  hookRecv(ws, isBattle);
  watchSocket(ws, url, isBattle);
}

// Pantau lifecycle socket: nangkap frame battle PERTAMA (yang bawa state
// sendiri) dan deteksi socket yang mati waktu loading match. Ini yang bikin
// "Ruang: — / ID sendiri: —" walau socket-nya udah ke-hook.
function watchSocket(ws, url, isBattle) {
  try {
    ws.addEventListener('open', function () {
      log('ws-open ' + (isBattle ? 'battle ' : 'lobby ') + String(url).slice(0, 60));
    });
  } catch (e) { }
  try {
    ws.addEventListener('close', function () {
      if (ws === battleWs) battleWs = null;
      if (ws === lobbyWs) lobbyWs = null;
      log('ws-close ' + (isBattle ? 'battle' : 'lobby'));
    });
  } catch (e) { }
  try {
    ws.addEventListener('error', function () {
      log('ws-error ' + (isBattle ? 'battle' : 'lobby'));
    });
  } catch (e) { }
}

// RTCDataChannel (battle P2P) — diperlakukan sama seperti socket battle
function hookChannel(ch, label) {
  if (hookedObj.has(ch)) return;
  hookedObj.add(ch);
  KIND.set(ch, 'rtc');
  sockList.push(ch);
  if (!battleCh) battleCh = ch;
  log('rtc "' + label + '"');

  var origSend = ch.send.bind(ch);
  ch.send = function (data) {
    try { data = onSend(ch, data, true); } catch (e) { }
    return origSend(data);
  };

  hookRecv(ch, true);
}

// Hook satu realm (window utama atau iframe same-origin).
// Semua lewat Proxy konstruktor / Proxy apply — prototype & toString tetap native.
function hookRealm(win, tag) {
  if (!win) return;
  // WebSocket
  try {
    if (win.WebSocket) {
      var P = new Proxy(win.WebSocket, {
        construct: function (t, args, nt) {
          var ws = Reflect.construct(t, args, nt || t);
          try { hookSocket(ws, String(args[0] || ''), tag); } catch (e) { }
          return ws;
        }
      });
      win.WebSocket = P;
    }
  } catch (e) { }

  // RTCPeerConnection -> createDataChannel + channel masuk dari peer
  try {
    var RTC = win.RTCPeerConnection || win.webkitRTCPeerConnection;
    if (RTC) {
      var PR = new Proxy(RTC, {
        construct: function (t, args, nt) {
          var pc = Reflect.construct(t, args, nt || t);
          try {
            var oc = pc.createDataChannel.bind(pc);
            pc.createDataChannel = function (label, init) {
              var ch = oc(label, init);
              try { hookChannel(ch, String(label || '')); } catch (e) { }
              return ch;
            };
            try {
              pc.addEventListener('datachannel', function (ev) {
                try { if (ev && ev.channel) hookChannel(ev.channel, 'in'); } catch (e) { }
              });
            } catch (e) { }
          } catch (e) { }
          return pc;
        }
      });
      if (win.RTCPeerConnection) win.RTCPeerConnection = PR;
      else win.webkitRTCPeerConnection = PR;
    }
  } catch (e) { }

  // Worker / SharedWorker — log + intip pesannya (jaringan bisa jalan di worker)
  ['Worker', 'SharedWorker'].forEach(function (name) {
    try {
      if (!win[name]) return;
      var PW = new Proxy(win[name], {
        construct: function (t, args, nt) {
          var w = Reflect.construct(t, args, nt || t);
          try {
            log((tag ? tag + ' ' : '') + name.toLowerCase() + ' ' + String(args[0] || '').slice(0, 90));
            try {
              w.addEventListener('message', function (ev) {
                try {
                  var d = ev && ev.data;
                  var prev = isAB(d) ? ('bin:' + d.byteLength)
                    : (d && isAB(d.buffer) ? 'view:' + d.byteLength
                    : (typeof d === 'string' ? d.slice(0, 60) : typeof d));
                  log('worker↓ ' + prev);
                } catch (e) { }
              });
            } catch (e) { }
          } catch (e) { }
          return w;
        }
      });
      win[name] = PW;
    } catch (e) { }
  });

  // fetch — Proxy apply (toString tetap native); log URL yang mencurigakan
  try {
    if (win.fetch) {
      var nf = new Proxy(win.fetch, {
        apply: function (t, thisArg, args) {
          try {
            var u = args[0];
            var s = typeof u === 'string' ? u : (u && u.url) || '';
            if (/\/b[12]\b|battle|wss?:|socket|\?k=/i.test(String(s))) log('fetch ' + String(s).slice(0, 90));
          } catch (e) { }
          return t.apply(thisArg, args);
        }
      });
      win.fetch = nf;
    }
  } catch (e) { }

  // XHR — Proxy construct + open per-instance (prototype tetap native)
  try {
    if (win.XMLHttpRequest) {
      var PX = new Proxy(win.XMLHttpRequest, {
        construct: function (t, args, nt) {
          var x = Reflect.construct(t, args, nt || t);
          try {
            var ox = x.open.bind(x);
            x.open = function (m, u) {
              try {
                if (/\/b[12]\b|battle|wss?:|socket|\?k=/i.test(String(u || ''))) log('xhr ' + String(u).slice(0, 90));
              } catch (e) { }
              return ox.apply(null, arguments);
            };
          } catch (e) { }
          return x;
        }
      });
      win.XMLHttpRequest = PX;
    }
  } catch (e) { }

  // EventSource — log + terima pesan
  try {
    if (win.EventSource) {
      var PE = new Proxy(win.EventSource, {
        construct: function (t, args, nt) {
          var es = Reflect.construct(t, args, nt || t);
          try {
            log('sse ' + String(args[0] || '').slice(0, 90));
            hookRecv(es, true);
          } catch (e) { }
          return es;
        }
      });
      win.EventSource = PE;
    }
  } catch (e) { }

  // WebTransport — log dulu (protokolnya beda, ditangani kalau memang dipakai)
  try {
    if (win.WebTransport) {
      var PT = new Proxy(win.WebTransport, {
        construct: function (t, args, nt) {
          var wt = Reflect.construct(t, args, nt || t);
          try { log('webtransport ' + String(args[0] || '').slice(0, 90)); } catch (e) { }
          return wt;
        }
      });
      win.WebTransport = PT;
    }
  } catch (e) { }
}

// iframe same-origin: hook realm-nya juga (game bisa jalan di dalam iframe)
function hookIframes() {
  try {
    var list = document.querySelectorAll('iframe');
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      if (hookedFrame.has(f)) continue;
      hookedFrame.add(f);
      var src = '(tanpa-src)';
      try { src = f.src || f.getAttribute('src') || '(srcdoc/kosong)'; } catch (e) { }
      var cw = null;
      try { cw = f.contentWindow; } catch (e) { }
      if (!cw) { log('iframe? ' + src); continue; }
      try {
        void cw.document;   // lempar kalau cross-origin
        log('iframe ' + src.slice(0, 70));
        hookRealm(cw, 'iframe');
      } catch (e) {
        log('iframe-xorigin ' + src.slice(0, 70));
      }
    }
  } catch (e) { }
}

// ---------------------------------------------------------------- kirim / terima
function onSend(sock, data, isBattle) {
  var buf = toBuf(data);
  if (buf) {
    // biner = kanal pertandingan (st). Klien cuma kirim format TANPA from.
    var msgs = decodeStClient(buf);
    if (!plausible(msgs) || msgs.length !== 1) return data; // bukan st / batch — jangan ambil risiko
    var dirty = false;
    var ents = msgs[0].ents || [];
    for (var j = 0; j < ents.length; j++) {
      var e = ents[j];
      // identitas sendiri dikunci dari frame battle masuk (handleBinary).
      // Sebelum kekunci, jangan asal nempel — cukup pantau.
      if (!self.id) { self._seen = (self._seen || 0) + 1; continue; }
      if (e.id === self.id) {
        // tangkap state asli SEBELUM modifikasi apapun
        if (!self.id) self.id = e.id;
        self.p = e.p.slice(); self.y = e.y; self.pi = e.pi; self.c = e.c; self.w = e.w;
        var origP = e.p.slice();
        if (cfg.spd.on) {
          var f = cfg.spd.factor;
          e.mv = [Math.max(-1.27, Math.min(1.27, e.mv[0] * f)), Math.max(-1.27, Math.min(1.27, e.mv[1] * f))];
          if (cfg.spd.pos && self._lp) {
            e.p = [self._lp[0] + (origP[0] - self._lp[0]) * f, origP[1], self._lp[2] + (origP[2] - self._lp[2]) * f];
          }
          dirty = true;
        }
        if (cfg.aim.on && aimActive() && aimTarget && !self.dead) {
          var a = aimAt(aimTarget.p[0], aimTarget.p[1] + (cfg.aim.point ? AIM_HEAD : AIM_CHEST), aimTarget.p[2]);
          e.y = a.yaw; e.pi = a.pitch;
          dirty = true;
        }
        self._lp = origP;
      }
    }
    if (!stLoggedUp.has(sock)) {
      stLoggedUp.add(sock);
      log('st↑ ' + (KIND.get(sock) || '?') + ' ' + ents.length + ' ent' + (dirty ? ' (mod)' : ''));
    }
    if (dirty) return encodeSt(msgs[0]);
    return data;
  }
  // teks = kanal lobby (JSON)
  if (typeof data === 'string' && data.charAt(0) === '{') {
    if (isBattle) { hitLog(data); return data; }   // socket battle: cuma hit yang relevan
    var m = null;
    try { m = JSON.parse(data); } catch (e) { return data; }
    if (m && m.t === 'hit') {
      if (cfg.dmg.on) {
        m.dmg = Math.round((+m.dmg || 0) * cfg.dmg.factor);
        m.head = true;
        return JSON.stringify(m);
      }
    }
  }
  return data;
}

function hitLog(txt) {
  var m = null;
  try { m = JSON.parse(txt); } catch (e) { return; }
  if (m && m.t === 'hit') {
    var now = performance.now();
    if (lastHit.t && now - lastHit.t < 3000) lastHit.interval = Math.max(40, Math.min(2000, now - lastHit.t));
    lastHit.dmg = m.dmg; lastHit.w = m.w; lastHit.t = now;
    if (cfg.dmg.on) { m.dmg = Math.round((+m.dmg || 0) * cfg.dmg.factor); m.head = true; }
    if (now - lastHitLog > 1500) { lastHitLog = now; log('hit↑ ' + (m.target || '?') + ' dmg=' + m.dmg); }
  }
}

function onRecv(sock, ev, isBattle) {
  if (!ev || seenEv.has(ev)) return;   // event yang sama lewat 2 jalur — proses sekali
  seenEv.add(ev);
  var d = ev.data;
  if (isBlob(d)) {                      // binaryType 'blob'
    try { d.arrayBuffer().then(function (b) { handleBinary(sock, b, isBattle); }, function () { }); } catch (e) { }
    return;
  }
  var buf = toBuf(d);
  if (buf) { handleBinary(sock, buf, isBattle); return; }
  if (typeof d === 'string' && d.charAt(0) === '{') handleText(sock, d, isBattle);
}

function handleBinary(sock, buf, isBattle) {
  var msgs = decodeStAny(buf, true);    // server kirim format DENGAN from
  if (!plausible(msgs)) return;
  var kind = KIND.get(sock);
  if (kind === 'ws' && (!battleWs || !openState(battleWs))) battleWs = sock;
  if (kind === 'rtc' && (!battleCh || !openState(battleCh))) battleCh = sock;
  if (!stLoggedDown.has(sock)) {
    stLoggedDown.add(sock);
    log('st↓ ' + (kind || '?') + ' ' + msgs.length + ' msg');
  }
  var now = performance.now();
  for (var i = 0; i < msgs.length; i++) {
    var msg = msgs[i];
    var ents = msg.ents || [];
    for (var j = 0; j < ents.length; j++) {
      var e = ents[j];
      // frame battle PERTAMA yang bawa state sendiri = identitas kita.
      // Sebelum ini self.id null → onSend cuma nebak "entitas pertama" dan bisa
      // salah nempel posisi orang lain. Begitu ketemu, kunci.
      if (!self.id && !self._selfLocked) {
        self._selfLocked = true;
        self.id = e.id;
        self.p = e.p.slice();
        self.y = e.y; self.pi = e.pi; self.c = e.c; self.w = e.w;
        log('self=' + e.id + ' (dari frame battle)');
      }
      if (e.id === self.id) continue;
      var pl = players[e.id];
      if (!pl) { pl = players[e.id] = { id: e.id, p: e.p, y: e.y, pi: e.pi, c: e.c, g: e.g, r: e.r, mv: e.mv, w: e.w, ts: now, team: null, hp: 100, name: null, dead: false }; }
      else { pl.p = e.p; pl.y = e.y; pl.pi = e.pi; pl.c = e.c; pl.g = e.g; pl.r = e.r; pl.mv = e.mv; pl.w = e.w; pl.ts = now; }
      if (roster[e.id]) { pl.team = roster[e.id].team; if (roster[e.id].name) pl.name = roster[e.id].name; }
    }
  }
}

function handleText(sock, txt, isBattle) {
  var m = null;
  try { m = JSON.parse(txt); } catch (e) { return; }
  if (!m || !m.t) return;
  if (m.t === 'game' || m.t === 'spawn' || m.t === 'hp' || m.t === 'kill' || m.t === 'gone' || m.t === 'joined' || m.t === 'cfswap' || m.t === 'ktag') {
    // socket yang benar-benar membawa pesan lobby = socket lobby (bukan battle)
    if (!isBattle && KIND.get(sock) === 'ws' && lobbyWs !== sock && sock !== battleWs) lobbyWs = sock;
    onLobbyMsg(m);
  }
}

// ---------------------------------------------------------------- aimbot
function aimActive() {
  if (cfg.aim.mode === 0) return true;      // selalu
  return rmbDown;                            // saat tahan klik kanan
}
function findAimTarget() {
  if (!self.p || self.dead) return null;
  var e = eyePos();
  var sy = Math.sin(self.y), cy = Math.cos(self.y), sp = Math.sin(self.pi), cp = Math.cos(self.pi);
  var fwd = [-cp * sy, sp, -cp * cy];
  var maxAng = fovRad(), best = null, bestScore = Infinity;
  var list = alivePlayers();
  for (var i = 0; i < list.length; i++) {
    var pl = list[i];
    if (!isEnemy(pl)) continue;
    var ay = cfg.aim.point ? AIM_HEAD : AIM_CHEST;
    var dx = pl.p[0] - e[0], dy = (pl.p[1] + ay) - e[1], dz = pl.p[2] - e[2];
    var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > cfg.aim.range || d < 0.5) continue;
    var dot = (dx * fwd[0] + dy * fwd[1] + dz * fwd[2]) / d;
    var ang = Math.acos(Math.max(-1, Math.min(1, dot)));
    if (ang > maxAng) continue;
    var score = ang * 500 + d;
    if (score < bestScore) { bestScore = score; best = pl; }
  }
  return best;
}

// ---------------------------------------------------------------- triggerbot
function trigInterval() {
  if (cfg.trig.interval > 0) return cfg.trig.interval;
  return lastHit.interval || 120;
}
function trigDmg() {
  if (cfg.trig.dmg > 0) return cfg.trig.dmg;
  if (lastHit.dmg > 0 && performance.now() - lastHit.t < 8000) return lastHit.dmg;
  return 30;
}
// pilih transport buat kirim hit: lobby dulu, fallback ke battle ws / channel
function pickHitSock() {
  if (openState(lobbyWs)) return lobbyWs;
  if (openState(battleWs)) return battleWs;
  if (openState(battleCh)) return battleCh;
  return null;
}
function triggerTick(now) {
  if (!cfg.trig.on || !self.id || !self.p || self.dead) return;
  if (now - lastTrig < trigInterval()) return;
  var proj = makeProjector();
  var best = null, bestD = Infinity;
  var list = alivePlayers();
  for (var i = 0; i < list.length; i++) {
    var pl = list[i];
    if (!isEnemy(pl)) continue;
    if (dist3(self.p, pl.p) > cfg.trig.range) continue;
    var s = proj(pl.p[0], pl.p[1] + AIM_CHEST, pl.p[2]);
    if (!s) continue;
    var d = Math.hypot(s.x - VW / 2, s.y - VH / 2);
    if (d < cfg.trig.fov && d < bestD) { bestD = d; best = pl; }
  }
  if (best) {
    var sk = pickHitSock();
    if (!sk) return;
    try {
      sk.send(JSON.stringify({ t: 'hit', target: best.id, from: self.id, dmg: trigDmg(), head: cfg.trig.head ? 1 : 0, helm: 0, w: (lastHit.w != null ? lastHit.w : self.w) }));
      lastTrig = now;
      if (now - lastHitLog > 2000) { lastHitLog = now; log('hit→ ' + best.id); }
    } catch (e) { }
  }
}

// ---------------------------------------------------------------- ESP
var cv = null, ctx = null;
function ensureCanvas() {
  if (cv || !document.body) return;
  cv = document.createElement('canvas');
  cv.setAttribute('data-pb', '1');
  cv.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:9998';
  document.body.appendChild(cv);
  ctx = cv.getContext('2d');
  resize();
}
function resize() {
  if (!cv) return;
  cv.width = window.innerWidth; cv.height = window.innerHeight;
  VW = cv.width; VH = cv.height;
}
function fetchWeapons() {
  if (weaponNames || weaponFetching) return;
  weaponFetching = true;
  try {
    fetch('/static/game/weapons.json').then(function (r) { return r.json(); }).then(function (j) {
      weaponNames = {};
      var ws = (j && j.weapons) || [];
      for (var i = 0; i < ws.length; i++) if (ws[i] && ws[i].id != null) weaponNames[String(ws[i].id)] = ws[i].name || String(ws[i].id);
    }).catch(function () { });
  } catch (e) { }
}
function drawESP() {
  if (!ctx) return;
  ctx.clearRect(0, 0, VW, VH);
  if (!cfg.esp.on || !self.p) return;
  var proj = makeProjector();
  var now = performance.now();
  var list = alivePlayers();
  for (var i = 0; i < list.length; i++) {
    var pl = list[i];
    var enemy = isEnemy(pl);
    var col = enemy ? '#ff4646' : (pl.team != null && myTeam != null ? '#46c046' : '#ffb02e');
    var feet = proj(pl.p[0], pl.p[1], pl.p[2]);
    if (!feet) continue;
    var headH = pl.c ? 1.35 : HEAD_Y;
    var head = proj(pl.p[0], pl.p[1] + headH, pl.p[2]);
    var hy = head ? head.y : Math.max(0, feet.y - 260);
    var h = Math.max(12, feet.y - hy);
    var w = h * 0.52;
    var x0 = feet.x - w / 2;
    var alpha = now - pl.ts > STALE_MS ? 0.35 : 1;
    ctx.globalAlpha = alpha;
    if (cfg.esp.box) {
      ctx.strokeStyle = col; ctx.lineWidth = 1.4;
      ctx.strokeRect(x0, hy, w, h);
      ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 1;
      ctx.strokeRect(x0 - 1, hy - 1, w + 2, h + 2);
    }
    if (cfg.esp.hp) {
      var hpv = Math.max(0, Math.min(100, pl.hp == null ? 100 : pl.hp));
      var bh = h * hpv / 100;
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(x0 - 5, hy, 3, h);
      ctx.fillStyle = hpv > 50 ? '#5fd35f' : (hpv > 20 ? '#e8c53a' : '#e84a3a');
      ctx.fillRect(x0 - 5, hy + (h - bh), 3, bh);
    }
    ctx.font = '700 11px Tahoma, Arial, sans-serif';
    ctx.textAlign = 'center';
    var ty = hy - 6;
    if (cfg.esp.name) {
      var nm = pl.name || pl.id;
      ctx.fillStyle = 'rgba(0,0,0,.6)';
      var tw = ctx.measureText(nm).width;
      ctx.fillRect(feet.x - tw / 2 - 3, ty - 10, tw + 6, 13);
      ctx.fillStyle = col; ctx.fillText(nm, feet.x, ty);
      ty -= 14;
    }
    if (cfg.esp.wep) {
      var wn = (weaponNames && weaponNames[String(pl.w)]) || (pl.w == null ? '' : String(pl.w));
      if (wn) { ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillText(wn, feet.x, ty); ty -= 13; }
    }
    if (cfg.esp.dist) {
      ctx.fillStyle = 'rgba(255,255,255,.7)';
      ctx.fillText(Math.round(dist3(eyePos(), pl.p)) + 'm', feet.x, feet.y + 13);
    }
    if (cfg.esp.line) {
      ctx.strokeStyle = col; ctx.globalAlpha = alpha * 0.5; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(VW / 2, VH); ctx.lineTo(feet.x, feet.y); ctx.stroke();
      ctx.globalAlpha = alpha;
    }
    if (aimTarget && aimTarget.id === pl.id) {
      ctx.strokeStyle = '#ffff40'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(feet.x, hy + h / 2, Math.max(8, w * 0.7), 0, Math.PI * 2); ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
}

// ---------------------------------------------------------------- UI
var panel = null, statusEl = null;
function el(tag, style, txt) {
  var e = document.createElement(tag);
  if (style) e.style.cssText = style;
  if (txt != null) e.textContent = txt;
  return e;
}
function buildUI() {
  if (panel || !document.body) return;
  panel = el('div', 'position:fixed;top:12px;left:12px;z-index:9999;width:212px;font:600 11px Tahoma,Arial,sans-serif;color:#dfe6ee;background:rgba(12,16,22,.92);border:1px solid #2a3442;border-radius:5px;box-shadow:0 4px 18px #000a;user-select:none');
  panel.setAttribute('data-pb', '1');
  var hdr = el('div', 'padding:6px 9px;background:linear-gradient(#22304a,#16202f);border-bottom:1px solid #2a3442;border-radius:5px 5px 0 0;cursor:move;display:flex;justify-content:space-between;align-items:center');
  hdr.appendChild(el('span', null, 'Pusat Kendali'));
  var hint = el('small', 'opacity:.55;font-size:9px', 'v1.3 [Insert]');
  hdr.appendChild(hint);
  panel.appendChild(hdr);
  var body = el('div', 'padding:7px 9px;display:flex;flex-direction:column;gap:5px');
  panel.appendChild(body);

  function chk(key, label, sub) {
    var l = el('label', 'display:flex;align-items:center;gap:6px;cursor:pointer');
    var c = document.createElement('input');
    c.type = 'checkbox'; c.checked = !!get2(cfg, key);
    c.onchange = function () { set2(cfg, key, c.checked); save(); };
    l.appendChild(c);
    l.appendChild(el('span', null, label));
    body.appendChild(l);
    if (sub) { var s = el('div', 'padding-left:20px;display:flex;flex-wrap:wrap;gap:2px 10px;opacity:.85;font-size:10px'); sub(s); body.appendChild(s); }
    return c;
  }
  function subChk(parent, key, label) {
    var l = el('label', 'display:flex;align-items:center;gap:4px;cursor:pointer');
    var c = document.createElement('input');
    c.type = 'checkbox'; c.checked = !!get2(cfg, key);
    c.onchange = function () { set2(cfg, key, c.checked); save(); };
    l.appendChild(c); l.appendChild(el('span', null, label));
    parent.appendChild(l);
  }
  function slider(key, label, min, max, step, fmt) {
    var row = el('div', 'display:flex;align-items:center;gap:6px;font-size:10px;opacity:.9');
    row.appendChild(el('span', 'width:74px;opacity:.75', label));
    var v = el('span', 'width:34px;text-align:right', fmt(get2(cfg, key)));
    var s = document.createElement('input');
    s.type = 'range'; s.min = min; s.max = max; s.step = step; s.value = get2(cfg, key);
    s.style.flex = '1';
    s.oninput = function () { set2(cfg, key, +s.value); v.textContent = fmt(+s.value); save(); };
    row.appendChild(s); row.appendChild(v);
    body.appendChild(row);
  }

  chk('esp.on', 'Bantuan Visual', function (s) {
    subChk(s, 'esp.box', 'Kotak'); subChk(s, 'esp.name', 'Nama'); subChk(s, 'esp.dist', 'Jarak');
    subChk(s, 'esp.hp', 'Nyawa'); subChk(s, 'esp.wep', 'Senjata'); subChk(s, 'esp.line', 'Garis');
  });
  chk('aim.on', 'Bantuan Bidikan', function (s) {
    var l = el('label', 'display:flex;align-items:center;gap:4px;cursor:pointer;width:100%');
    var c = document.createElement('input'); c.type = 'checkbox'; c.checked = cfg.aim.mode === 0;
    c.onchange = function () { cfg.aim.mode = c.checked ? 0 : 1; save(); };
    l.appendChild(c); l.appendChild(el('span', null, 'Selalu aktif (tanpa tahan)'));
    s.appendChild(l);
    var l2 = el('label', 'display:flex;align-items:center;gap:4px;cursor:pointer;width:100%');
    var c2 = document.createElement('input'); c2.type = 'checkbox'; c2.checked = !!cfg.aim.point;
    c2.onchange = function () { cfg.aim.point = c2.checked ? 1 : 0; save(); };
    l2.appendChild(c2); l2.appendChild(el('span', null, 'Bidik kepala'));
    s.appendChild(l2);
  });
  slider('aim.fov', 'Sudut bidik', 1, 60, 1, function (v) { return v + ''; });
  slider('aim.range', 'Jangkauan', 10, 300, 5, function (v) { return v + ''; });
  chk('trig.on', 'Tembak Otomatis');
  slider('trig.fov', 'Presisi', 4, 80, 2, function (v) { return v + 'px'; });
  slider('trig.range', 'Jarak tembak', 10, 250, 5, function (v) { return v + ''; });
  slider('trig.dmg', 'Damage tetap', 0, 500, 5, function (v) { return v ? v + '' : 'auto'; });
  chk('dmg.on', 'Pengganda Damage');
  slider('dmg.factor', 'Pengali', 1, 50, 1, function (v) { return 'x' + v; });
  chk('spd.on', 'Dorongan Gerak');
  slider('spd.factor', 'Intensitas', 1, 1.27, 0.01, function (v) { return 'x' + v.toFixed(2); });
  var l3 = el('label', 'display:flex;align-items:center;gap:6px;cursor:pointer;opacity:.75');
  var c3 = document.createElement('input'); c3.type = 'checkbox'; c3.checked = !!cfg.ui.log;
  c3.onchange = function () {
    cfg.ui.log = c3.checked; save();
    if (logEl) { logEl.style.display = c3.checked ? '' : 'none'; renderLog(); }
    if (c3.checked) log('log nyala');
  };
  l3.appendChild(c3); l3.appendChild(el('span', null, 'Catatan pesan'));
  body.appendChild(l3);

  statusEl = el('div', 'padding:5px 9px;border-top:1px solid #2a3442;font-size:9px;opacity:.7;line-height:1.5');
  body.appendChild(statusEl);

  // baris log debug — cuma kelihatan kalau "Catatan pesan" nyala.
  // Isinya: info boot (readyState/frame/iframe) + 8 event terakhir.
  logEl = el('div', 'padding:0 9px 6px;font-size:9px;opacity:.55;line-height:1.5;white-space:pre-wrap;max-height:96px;overflow:hidden;word-break:break-all');
  logEl.style.display = cfg.ui.log ? '' : 'none';
  body.appendChild(logEl);
  renderLog();

  // geser panel
  var drag = null;
  hdr.addEventListener('mousedown', function (e) {
    drag = { x: e.clientX, y: e.clientY, l: panel.offsetLeft, t: panel.offsetTop };
    e.preventDefault();
  });
  window.addEventListener('mousemove', function (e) {
    if (!drag) return;
    panel.style.left = Math.max(0, drag.l + e.clientX - drag.x) + 'px';
    panel.style.top = Math.max(0, drag.t + e.clientY - drag.y) + 'px';
  });
  window.addEventListener('mouseup', function () { drag = null; });

  document.body.appendChild(panel);
  applyUIOpen();
}
function applyUIOpen() {
  if (!panel) return;
  panel.style.display = cfg.ui.open ? '' : 'none';
}
function get2(o, path) { var p = path.split('.'); var v = o; for (var i = 0; i < p.length; i++) v = v[p[i]]; return v; }
function set2(o, path, val) { var p = path.split('.'); var v = o; for (var i = 0; i < p.length - 1; i++) v = v[p[i]]; v[p[p.length - 1]] = val; }

// ---------------------------------------------------------------- input (hanya observasi)
window.addEventListener('mousedown', function (e) { if (e.button === 2) rmbDown = true; }, true);
window.addEventListener('mouseup', function (e) { if (e.button === 2) rmbDown = false; }, true);
window.addEventListener('contextmenu', function (e) { if (cfg.aim.on || cfg.trig.on) e.preventDefault(); });
window.addEventListener('keydown', function (e) {
  if (e.code === 'Insert') { cfg.ui.open = !cfg.ui.open; save(); applyUIOpen(); }
}, true);
window.addEventListener('resize', resize);

// ---------------------------------------------------------------- loop utama
var lastStatus = 0, lastFrameScan = 0;
function loop() {
  requestAnimationFrame(loop);
  try {
    if (!cv && document.body) ensureCanvas();
    var now = performance.now();
    if (now - lastFrameScan > 2000) { lastFrameScan = now; hookIframes(); }
    if (cfg.aim.on && aimActive()) aimTarget = findAimTarget();
    else aimTarget = null;
    triggerTick(now);
    drawESP();
    if (statusEl && now - lastStatus > 250) {
      lastStatus = now;
      var n = 0; for (var id in players) n++;
      var wsN = 0, wsOpen = 0, wsUrls = [];
      for (var k in sockList) {
        wsN++;
        if (openState(sockList[k])) wsOpen++;
        try { wsUrls.push(String(sockList[k].url || '?').replace(/^wss?:\/\//, '').split('/')[0]); } catch (e) { wsUrls.push('?'); }
      }
      statusEl.textContent = 'Ruang: ' + (openState(battleWs) ? 'WS' : (openState(battleCh) ? 'RTC' : '—')) +
        ' · Pemain: ' + n +
        (self.id ? ' · ID sendiri: ok' : ' · ID sendiri: —') +
        (myTeam != null ? ' · Tim: ' + (myTeam ? 'biru' : 'merah') : '') +
        '\nws ' + wsOpen + '/' + wsN + (wsUrls.length ? ' [' + wsUrls.slice(0, 2).join(' ') + ']' : '') +
        ' · frame ' + (window.top === window.self ? 'top' : 'iframe');
    }
  } catch (e) { }
}

// ---------------------------------------------------------------- boot
// CATAT timing injeksi SEBELUM hook apa pun — ini kunci diagnosa:
// readyState 'loading' = script jalan di document-start (hook lebih dulu dari game)
// readyState 'complete'/'interactive' = script jalan terlambat (hook kalah cepat)
bootLog('t0 rs=' + document.readyState);
bootLog('frame=' + (window.top === window.self ? 'top' : 'iframe') + ' host=' + location.host);

// 1) Hook realm utama SEGERA — sebelum script game jalan sedikit pun.
hookRealm(window, null);

// 2) Listener input bisa dipasang sekarang (window sudah ada).
// 3) UI + kanvas nunggu body siap.
function boot() {
  ensureCanvas();
  buildUI();
  fetchWeapons();
  requestAnimationFrame(loop);
  try {
    bootLog('iframe=' + document.querySelectorAll('iframe').length +
      ' script=' + document.scripts.length +
      ' canvas=' + (document.querySelector('canvas') ? 1 : 0));
  } catch (e) { }
  renderLog();
}

if (document.body) boot();
else document.addEventListener('DOMContentLoaded', boot);

})();
