// test_integration.js — boot server, mainkan flow lengkap pakai WS client mini.
'use strict';
const http = require('http');
const net = require('net');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const { encodeSt, encodeStBatch, decodeSt, decodeStSrv } = require('./codec');

const SITE = path.resolve(__dirname, '..', 'site');
const PORT = 8899;
const BASE = 'http://127.0.0.1:' + PORT;

let pass = 0, fail = 0;
const LOG = [];
// watchdog: kalau hang, lapor posisi terakhir lalu keluar
const LAST = { where: 'awal' };
const WD = setTimeout(() => {
  try {
    require('fs').writeSync(2, '\n[WATCHDOG] HANG di: ' + LAST.where + '\n');
    require('fs').writeSync(2, LOG.slice(-25).join('\n') + '\n');
  } catch (_) {}
  process.exit(2);
}, 90000);
WD.unref && WD.unref();

function ok(cond, msg) {
  if (cond) { pass++; LOG.push('  ok   ' + msg); }
  else { fail++; LOG.push('  FAIL ' + msg); }
}
function log(...a) {
  LAST.where = a.join(' ');
  LOG.push(...a);
  try { require('fs').writeSync(1, a.join(' ') + '\n'); } catch (_) {}
}
function section(t) { log(''); log('=== ' + t + ' ==='); }

// ---------- WS client mini (RFC 6455) ----------
class WsClient {
  constructor(port, pathname) {
    this.port = port; this.pathname = pathname;
    this.buf = Buffer.alloc(0); this.frames = [];
    this.ready = false; this.closed = false;
    this._waiters = [];
    this.all = [];      // SEMUA pesan JSON yang pernah masuk (nggak pernah dihapus)
  }
  connect(timeout = 4000) {
    return new Promise((resolve, reject) => {
      const key = crypto.randomBytes(16).toString('base64');
      this.sock = net.connect(this.port, '127.0.0.1', () => {
        this.sock.write(
          'GET ' + this.pathname + ' HTTP/1.1\r\n' +
          'Host: 127.0.0.1:' + this.port + '\r\n' +
          'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
          'Sec-WebSocket-Key: ' + key + '\r\n' +
          'Sec-WebSocket-Version: 13\r\n\r\n');
      });
      let handshake = Buffer.alloc(0);
      this.sock.on('data', (d) => {
        if (!this.ready) {
          handshake = Buffer.concat([handshake, d]);
          const idx = handshake.indexOf('\r\n\r\n');
          if (idx < 0) return;
          const head = handshake.slice(0, idx).toString();
          if (!/101/.test(head.split('\r\n')[0])) { reject(new Error('handshake gagal: ' + head.split('\r\n')[0])); return; }
          this.ready = true;
          const rest = handshake.slice(idx + 4);
          if (rest.length) this._onData(rest);
          resolve(this);
        } else this._onData(d);
      });
      this.sock.on('error', (e) => { if (!this.ready) reject(e); });
      this.sock.on('close', () => { this.closed = true; });
      setTimeout(() => { if (!this.ready) reject(new Error('timeout handshake')); }, timeout);
    });
  }
  _onData(d) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    while (this.buf.length >= 2) {
      const b0 = this.buf[0], b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0, op = b0 & 0x0f;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      if (this.buf.length < off + len) return;
      const payload = this.buf.subarray(off, off + len);
      this.buf = this.buf.subarray(off + len);
      if (op === 8) { this.closed = true; continue; }
      if (op === 9 || op === 10) continue;
      const f = { op, payload: Buffer.from(payload) };
      this.frames.push(f);
      // simpan JSON juga di `all` — buat cek pesan yang sudah dikonsumsi waitFor
      if (op === 1) {
        try { this.all.push(JSON.parse(f.payload.toString('utf8'))); } catch (_) {}
      }
      this._drain();
    }
  }
  _drain() {
    const w = this._waiters;
    this._waiters = [];
    for (const fn of w) fn();
  }
  sendJson(o) { this._send(1, Buffer.from(JSON.stringify(o), 'utf8')); }
  sendBin(b) { this._send(2, Buffer.isBuffer(b) ? b : Buffer.from(b)); }
  _send(op, payload) {
    const mask = crypto.randomBytes(4);
    let header;
    const len = payload.length;
    if (len < 126) { header = Buffer.alloc(2); header[0] = 0x80 | op; header[1] = 0x80 | len; }
    else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x80 | op; header[1] = 0x80 | 126; header.writeUInt16BE(len, 2); }
    else { header = Buffer.alloc(10); header[0] = 0x80 | op; header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(len), 2); }
    const masked = Buffer.allocUnsafe(len);
    for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i & 3];
    this.sock.write(Buffer.concat([header, mask, masked]));
  }
  // tunggu pesan JSON sesuai predicate, tunggu sampai `ms`
  waitFor(pred, ms = 4000) {
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      const check = () => {
        for (let i = 0; i < this.frames.length; i++) {
          const f = this.frames[i];
          if (f.op !== 1) continue;
          let j = null;
          try { j = JSON.parse(f.payload.toString('utf8')); } catch (_) {}
          if (j && pred(j)) { this.frames.splice(i, 1); return resolve(j); }
        }
        if (Date.now() - t0 > ms) return reject(new Error('timeout tunggu pesan'));
        this._waiters.push(check);
        // jaring pengaman: kalau nggak ada data masuk lagi, tetap jalan
        setTimeout(check, 250);
      };
      check();
    });
  }
  async nextJson(ms = 4000) { return this.waitFor(() => true, ms); }
  close() { try { this.sock.destroy(); } catch (_) {} }
}

// ---------- HTTP helper ----------
function get(p) {
  return new Promise((resolve, reject) => {
    http.get(BASE + p, (res) => {
      let b = Buffer.alloc(0);
      res.on('data', (d) => { b = Buffer.concat([b, d]); });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    }).on('error', reject);
  });
}

// ---------- MAIN ----------
(async () => {
  log('=== boot server ===');
  // set env supaya db di temp
  process.env.PB_DB = path.join(require('os').tmpdir(), 'pbtest_' + Date.now() + '.json');

  // paksa port test sebelum index.js baca argv
  process.argv = [process.argv[0], path.resolve(__dirname, 'index.js'), '--port', String(PORT)];
  const { server, lobby } = require('./index.js');
  await new Promise((r) => setTimeout(r, 700));

  try {
    // ---- 1. HTTP statis ----
    log('=== 1. HTTP statis ===');
    const home = await get('/');
    ok(home.status === 200, 'GET / -> 200');
    ok(/<html/i.test(home.body.toString('utf8')), 'index.html berisi html');
    ok(/text\/html/.test(home.headers['content-type'] || ''), 'content-type html');

    const jogo = await get('/jogo');
    ok(jogo.status === 200, 'GET /jogo -> 200');
    ok(/bundle\.js/.test(jogo.body.toString('utf8')), '/jogo muat bundle.js');

    const netjs = await get('/static/game/net.js');
    ok(netjs.status === 200, 'GET /static/game/net.js -> 200');

    const missing = await get('/ngawur-ngawur.js');
    ok(missing.status === 404, 'file ngawur -> 404');

    // traversal harus ditolak
    const trav = await get('/../../package.json');
    ok(trav.status === 403 || trav.status === 404, 'traversal ditolak (' + trav.status + ')');

    // ---- 2. WS lobby handshake ----
    log('=== 2. WS lobby handshake ===');
    const a = new WsClient(PORT, '/ws');
    await a.connect();
    ok(true, 'upgrade /ws berhasil');

    a.sendJson({ t: 'hello', nick: 'TestPemain', plat: 'pc', sts: 1, bin: 1 });
    const w = await a.waitFor(m => m.t === 'welcome', 5000);
    ok(!!w, 'dapat welcome');
    ok(w.bin === true, 'welcome.bin === true (gate battle WS)');
    ok(typeof w.sid === 'string' && w.sid.length > 4, 'welcome.sid ada');
    ok(!!w.acct, 'welcome.acct ada');
    ok(w.acct.nick === 'TestPemain', 'acct.nick benar');

    // ---- 3. rooms ----
    log('=== 3. rooms ===');
    a.sendJson({ t: 'rooms', srv: 'am' });
    const rooms = await a.waitFor(m => m.t === 'rooms', 5000);
    ok(Array.isArray(rooms.list), 'rooms.list array');
    ok(rooms.list.length >= 6, 'ada room bawaan (' + rooms.list.length + ')');
    ok(rooms.list.every(r => r.map && r.mode), 'tiap room punya map+mode');
    const seedRoom = rooms.list.find(r => r.title === 'Treino contra bots');
    ok(!!seedRoom, 'room seed ada');

    // ---- 4. bikin room sendiri ----
    log('=== 4. create room ===');
    a.sendJson({ t: 'create', room: { title: 'Room Tes', mode: 'elim', map: 'NPort', kills: 50, time: 10, bots: [2, 2], dif: 2 } });
    const rm = await a.waitFor(m => m.t === 'room', 5000);
    ok(!!rm && !!rm.room, 'dapat room setelah create');
    ok(rm.room.mode === 'elim', 'mode elim');
    ok(rm.room.map === 'NPort', 'map NPort');
    ok(rm.room.kills === 50, 'kills 50');
    ok(rm.room.time === 10, 'time 10 menit');
    ok(rm.room.members.length === 1, 'satu anggota');
    ok(rm.room.members[0].nick === 'TestPemain', 'anggota = TestPemain');

    // ---- 5. start match ----
    log('=== 5. start match ===');
    a.sendJson({ t: 'start' });
    const st = await a.waitFor(m => m.t === 'start', 5000);
    ok(!!st, 'dapat sinyal start');

    // ---- 6. ingame -> game payload ----
    log('=== 6. ingame -> game ===');
    a.sendJson({ t: 'ingame' });
    const g = await a.waitFor(m => m.t === 'game', 8000);
    ok(!!g, 'dapat game payload');
    ok(!!g.game, 'game.game ada');
    ok(g.game.mode === 'elim', 'game.mode elim');
    ok(Array.isArray(g.game.ents), 'game.ents array');
    ok(g.game.ents.length >= 1, 'ada ent (player+bot)');
    ok(typeof g.you === 'string', 'you = ent id');
    const myEnt = g.game.ents.find(e => e.id === g.you);
    ok(!!myEnt, 'ent sendiri ada di daftar');
    ok(g.game.ents.some(e => e.bot), 'ada bot di ent list');

    // ---- 6b. srly (URL battle WS buat client) ----
    log('=== 6b. srly ===');
    const sess0 = [...lobby.conns.values()].find(s => s.nick === 'TestPemain');
    ok(!!sess0 && !!sess0.battleKey, 'sesi punya battleKey (buat cek srly)');
    // `srly` dikirim bersamaan dengan `game`. Cek di semua pesan yang masuk.
    const srlyMsg = a.all.find(m => m.t === 'srly');
    ok(!!srlyMsg, 'dapat srly');
    ok(!!srlyMsg && typeof srlyMsg.u === 'string' && /^wss?:\/\//.test(srlyMsg.u),
      'srly.u URL absolut (' + (srlyMsg && srlyMsg.u) + ')');
    ok(!!srlyMsg && srlyMsg.u.endsWith('/b2'), 'srly.u mengarah ke /b2');
    ok(!!srlyMsg && srlyMsg.k === sess0.battleKey, 'srly.k = battleKey pemain');
    // start TIDAK BOLEH bawa `battle` (kalau ada, client simpan pbweb_battle
    // dan URL srly dilewatkan transform edge yang nggak kita kontrol)
    const startMsgs = a.all.filter(m => m.t === 'start');
    ok(startMsgs.length >= 1, 'dapat start (' + startMsgs.length + ')');
    ok(startMsgs.every(m => !m.battle), 'start TANPA field battle');

    // ---- 7. loaded -> loadp ----
    log('=== 7. loaded -> loadp ===');
    a.sendJson({ t: 'loaded' });
    const lp = await a.waitFor(m => m.t === 'loadp', 5000);
    ok(!!lp, 'dapat loadp');
    // ---- 8. battle WS connect (jalur nyata lewat index.js) ----
    log('=== 8. battle WS /b2 ===');
    const sess = [...lobby.conns.values()].find(s => s.nick === 'TestPemain');
    ok(!!sess, 'sesi terdaftar di lobby');
    ok(!!sess.battleKey, 'sesi punya battleKey unik (' + (sess && sess.battleKey) + ')');
    const battle = lobby.battles.get(sess.battleKey);
    ok(!!battle, 'battle terdaftar');
    ok(battle.sockets.size === 0, 'belum ada socket battle terdaftar');

    const c2 = new WsClient(PORT, '/b2?k=' + encodeURIComponent(sess.battleKey));
    await c2.connect();
    ok(true, 'upgrade /b2 berhasil');
    await new Promise(r => setTimeout(r, 300));
    ok(battle.sockets.has(sess.sid), 'socket battle terdaftar di battle.sockets');
    ok(battle.sockets.get(sess.sid) !== null, 'socket battle bukan null');

    // key salah harus ditolak
    const bad = new WsClient(PORT, '/b2?k=ngawur');
    let badRejected = false;
    try {
      await bad.connect();
      await new Promise(r => setTimeout(r, 400));
      badRejected = bad.closed;
    } catch (_) { badRejected = true; }
    ok(badRejected, 'key ngawur ditolak');

    // ---- 8b. server kirim `st` frame biner ----
    log('=== 8b. server kirim st frame ===');
    // tunggu frame biner dari server (battle + bot pasti ada)
    let gotBin = null;
    for (let i = 0; i < 100 && !gotBin; i++) {
      await new Promise(r => setTimeout(r, 100));
      gotBin = c2.frames.find(f => f.op === 2);
    }
    ok(!!gotBin, 'dapat frame biner `st` dari server');
    if (gotBin) {
      const dec = decodeStSrv(gotBin.payload);
      ok(dec.length === 1, 'satu frame per paket');
      ok(dec[0].ents.length >= 1, 'frame berisi ent (' + (dec[0] && dec[0].ents.length) + ')');
      ok(dec[0].ents.some(e => e.id === g.you), 'frame berisi ent kita sendiri');
      ok(dec[0].ents.some(e => e.id.startsWith('bot')), 'frame berisi bot');
      // byte0 harus 1 (single frame, format E)
      ok(gotBin.payload[0] === 1, 'byte0 = 1 (single frame)');
    }

    // ---- 8c. kirim posisi ke server ----
    log('=== 8c. client kirim st frame ===');
    const TE = new TextEncoder();
    function buildSt(ents, ts) {
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
      dv.setUint8(c++, 1);
      dv.setFloat64(c, ts, true); c += 8;
      dv.setUint8(c++, ents.length);
      for (const m of meta) {
        const e = m.e, p = e.p || [0, 0, 0], mv = e.mv || [0, 0];
        dv.setUint8(c++, m.id.length); u8.set(m.id, c); c += m.id.length;
        for (const v of [p[0], p[1], p[2], e.y, e.pi]) dv.setFloat32(c, +v || 0, true), c += 4;
        dv.setUint8(c++, (e.c ? 1 : 0) | (e.g ? 2 : 0) | (e.r ? 4 : 0));
        dv.setInt8(c++, Math.max(-127, Math.min(127, Math.round(100 * mv[0]))));
        dv.setInt8(c++, Math.max(-127, Math.min(127, Math.round(100 * mv[1]))));
        if (m.wb) { dv.setUint8(c++, 0); dv.setUint8(c++, m.wb.length); u8.set(m.wb, c); c += m.wb.length; }
        else { dv.setUint8(c++, 1); dv.setUint32(c, e.w >>> 0, true); c += 4; }
      }
      return Buffer.from(buf);
    }
    const myEntId = g.you;
    c2.sendBin(buildSt([{ id: myEntId, p: [7.5, 1.5, -3.25], y: 1.1, pi: -0.2, c: 1, g: 0, r: 0, mv: [0.5, 0.5], w: 1001 }], Date.now()));
    await new Promise(r => setTimeout(r, 600));
    const moved = battle.bySid.get(sess.sid);
    ok(!!moved, 'ent pemain ada');
    ok(moved && Math.abs(moved.p[0] - 7.5) < 0.01, 'posisi X terupdate (' + (moved && moved.p[0]) + ')');
    ok(moved && Math.abs(moved.p[2] - -3.25) < 0.01, 'posisi Z terupdate (' + (moved && moved.p[2]) + ')');
    ok(moved && Math.abs(moved.y - 1.1) < 1e-6, 'yaw terupdate');
    ok(moved && Math.abs(moved.pi - -0.2) < 1e-6, 'pitch terupdate (' + (moved && moved.pi) + ')');

    // posisi terkirim balik ke semua pemain di frame BERIKUTNYA
    // (buang frame lama dulu, baru tunggu yang baru)
    c2.frames.length = 0;
    let echoed = null;
    for (let i = 0; i < 40 && !echoed; i++) {
      await new Promise(r => setTimeout(r, 100));
      // ambil frame TERBARU
      const bins = c2.frames.filter(x => x.op === 2);
      if (!bins.length) continue;
      const d = decodeStSrv(bins[bins.length - 1].payload);
      const e2 = d[0].ents.find(x => x.id === myEntId);
      if (e2) echoed = e2;
    }
    ok(!!echoed && Math.abs(echoed.p[0] - 7.5) < 0.01, 'posisi di-echo balik di frame st (' + (echoed && echoed.p[0]) + ')');
    ok(!!echoed && Math.abs(echoed.y - 1.1) < 1e-6, 'yaw di-echo balik');

    // ---- 9. hit registration ----
    log('=== 9. hit + kill ===');
    // tunggu pemain hidup (bot mungkin sudah nembak dia)
    const me = battle.bySid.get(sess.sid);
    for (let i = 0; i < 60 && me.dead; i++) await new Promise(r => setTimeout(r, 100));
    ok(!me.dead, 'pemain hidup (sudah respawn kalau mati)');

    // cari bot TIM LAWAN yang masih hidup
    let enemy = null;
    for (let i = 0; i < 80 && !enemy; i++) {
      enemy = [...battle.ents.values()].find(e => e.bot && !e.dead && e.team !== me.team);
      if (!enemy) await new Promise(r => setTimeout(r, 100));
    }
    ok(!!enemy, 'ada bot tim lawan hidup');
    if (enemy) {
      ok(enemy.team !== me.team, 'bot memang tim lawan (' + enemy.team + ' vs ' + me.team + ')');
      // pastikan bot ada dalam jarak tembak
      enemy.p = [me.p[0] + 5, me.p[1], me.p[2] + 5];
      a.sendJson({ t: 'hit', target: enemy.id, from: myEntId, dmg: 45, head: false, helm: 0, w: 1001 });
      const hp = await a.waitFor(m => m.t === 'hp' && m.id === enemy.id, 5000);
      ok(!!hp, 'dapat hp event untuk bot');
      ok(hp.hp === 55, 'hp bot 100-45=55 (' + hp.hp + ')');

      // bunuh bot
      a.sendJson({ t: 'hit', target: enemy.id, from: myEntId, dmg: 200, head: true, helm: 0, w: 1001 });
      const kill = await a.waitFor(m => m.t === 'kill' && m.victim === enemy.id, 6000);
      ok(!!kill, 'dapat kill event');
      ok(kill.head === true, 'kill headshot');
      const killer = battle.ents.get(kill.killer);
      ok(!!killer && killer.kills >= 1, 'killer dapat 1 kill (' + (killer && killer.kills) + ')');

      // ---- FIELD WAJIB: handler `kill` di bundle.js baca e.score[0]/[1]
      // TANPA guard. Kalau `score` nggak ada -> TypeError -> client mati.
      ok(Array.isArray(kill.score) && kill.score.length === 2,
        'kill.score array[2] (' + JSON.stringify(kill.score) + ')');
      ok(typeof kill.score[0] === 'number' && typeof kill.score[1] === 'number',
        'kill.score berisi angka');

      // ---- FIELD WAJIB: handler `fx` k:"shot" baca e.o & e.d lewat
      // Vector3.fromArray(). Kalau undefined -> TypeError -> client mati.
      const shotFx = a.all.find(m => m.t === 'fx' && m.k === 'shot');
      if (shotFx) {
        ok(Array.isArray(shotFx.o) && shotFx.o.length === 3, 'fx.shot.o array[3]');
        ok(Array.isArray(shotFx.d) && shotFx.d.length === 3, 'fx.shot.d array[3]');
        ok(shotFx.o.concat(shotFx.d).every(Number.isFinite), 'fx.shot o/d semua angka finite');
      } else ok(true, 'fx.shot (nggak ada di test ini, cek bot)');

      // ---- `hp` harus bawa `from` (dibaca saat hp turun buat diri sendiri)
      const hpAny = a.all.find(m => m.t === 'hp');
      if (hpAny) ok(hpAny.from !== undefined, 'hp.from ada (' + hpAny.from + ')');

      // friendly fire harus DITOLAK
      const mate = [...battle.ents.values()].find(e => e.bot && !e.dead && e.team === me.team);
      if (mate) {
        const hpBefore = mate.hp;
        mate.p = [me.p[0] + 3, me.p[1], me.p[2] + 3];
        a.sendJson({ t: 'hit', target: mate.id, from: myEntId, dmg: 50, head: false, helm: 0, w: 1001 });
        await new Promise(r => setTimeout(r, 400));
        ok(Math.abs(mate.hp - hpBefore) < 0.01, 'friendly fire ditolak');
      } else ok(true, 'friendly fire ditolak (nggak ada teman buat tes)');

      // jarak kelewat jauh harus DITOLAK (anti nonsense)
      const far = [...battle.ents.values()].find(e => e.bot && !e.dead && e.team !== me.team);
      if (far) {
        const hpBefore = far.hp;
        far.p = [me.p[0] + 400, me.p[1], me.p[2] + 400];
        a.sendJson({ t: 'hit', target: far.id, from: myEntId, dmg: 50, head: false, helm: 0, w: 1001 });
        await new Promise(r => setTimeout(r, 400));
        ok(Math.abs(far.hp - hpBefore) < 0.01, 'hit dari jarak >250 ditolak');
      }
    }

    // ---- 10. chat ----
    log('=== 10. chat ===');
    a.sendJson({ t: 'chat', text: 'hai semua' });
    const chat = await a.waitFor(m => m.t === 'chat' && m.text === 'hai semua', 5000);
    ok(!!chat, 'dapat chat');
    ok(chat.nick === 'TestPemain', 'chat nick benar');

    // ---- 11. pg heartbeat ----
    log('=== 11. heartbeat pg ===');
    const pg = await a.waitFor(m => m.t === 'pg', 8000);
    ok(!!pg, 'dapat pg dari server');

    // ---- 11b. timer battle = MENIT -> DETIK ----
    // REGRESI: dulu `timeLeft = room.time` (3) padahal client pakai
    // `timeLimit = 60 * time`. Battle berakhir 3 detik setelah mulai.
    log('=== 11b. timer battle (menit -> detik) ===');
    ok(Math.abs(battle.timeLeft - rm.room.time * 60) < 30,
      'timeLeft ≈ ' + rm.room.time + ' menit = ' + battle.timeLeft.toFixed(1) + ' detik');
    ok(battle.timeLeft > 60, 'battle nggak berakhir < 1 menit (' + battle.timeLeft.toFixed(1) + 's)');
    ok(g.game.timeLimit === rm.room.time * 60,
      'game.timeLimit dikirim dalam detik (' + g.game.timeLimit + ')');
    ok(!battle.over, 'battle masih jalan setelah ' + Math.round(battle.elapsed) + 's');

    // royale: `kills:1` = last-man-standing, BUKAN limit kill.
    // REGRESI: dulu battle royale berakhir di tembakan pertama.
    log('=== 11c. royale nggak berakhir di kill pertama ===');    {
      const rq = await a.waitFor(m => m.t === 'room', 5000).catch(() => null);
      a.sendJson({ t: 'create', room: { title: 'Royale', mode: 'royale', map: 'Wilderness', kills: 1, time: 10, bots: [0, 5], dif: 2 } });
      const rroy = await a.waitFor(m => m.t === 'room', 5000);
      ok(rroy.room.mode === 'royale', 'room royale dibuat');
      a.sendJson({ t: 'start' });
      await a.waitFor(m => m.t === 'start', 5000);
      a.sendJson({ t: 'ingame' });
      const groy = await a.waitFor(m => m.t === 'game', 8000);
      ok(groy.game.mode === 'royale', 'game royale payload');
      const royBattle = [...lobby.battles.values()].find(b => b.room.mode === 'royale');
      ok(!!royBattle, 'battle royale terdaftar');
      if (royBattle) {
        ok(royBattle.timeLeft === 10 * 60, 'royale timeLeft = 10 menit = 600 detik');
        ok(!royBattle.over, 'royale nggak over tepat setelah mulai');
        const victim = groy.game.ents.find(e => e.bot);
        if (victim) {
          a.sendJson({ t: 'hit', target: victim.id, from: groy.you, dmg: 200, head: true, helm: 0, w: 1001 });
          await new Promise(r => setTimeout(r, 600));
          ok(!royBattle.over, 'royale TETAP jalan setelah 1 kill (bukan limit kill)');
        }
      }
      a.sendJson({ t: 'leavegame' });
      await new Promise(r => setTimeout(r, 300));
    }

    // ---- 12. spawnme setelah mati ----
    log('=== 12. respawn ===');
    if (enemy) {
      // bunuh diri: hit diri sendiri nggak boleh, jadi pakai kill lewat bot nanti.
      // skip — respawn sudah diuji lewat kill bot.
      ok(true, 'respawn diuji lewat alur bot (skip)');
    }

    // ---- 12b. bot mati HARUS respawn ----
    // REGRESI: bots.js `shoot()` dulu set `target.dead = true` TANPA
    // `respawnAt`. Loop respawn di battle.tick() butuh `e.dead && e.respawnAt`,
    // jadi bot mati permanen -> battle kosong, nggak ada yang nembak pemain.
    log('=== 12b. bot mati harus respawn ===');
    {
      const botsInBattle = [...battle.ents.values()].filter(e => e.bot);
      ok(botsInBattle.length === 4, 'ada ' + botsInBattle.length + ' bot di battle');
      // bunuh satu bot lewat hit pemain (jalur battle.kill -> respawnAt ke-set)
      const victim = botsInBattle.find(e => !e.dead && e.team !== me.team) || botsInBattle[0];
      if (victim) {
        // Tes "jarak >250 ditolak" di section 9 mindarin satu bot 400 unit dan
        // nggak dikembalikan. Kalau bot itu kepilih jadi victim, SEMUA hit
        // ditolak distance cap. Jadi paksa victim nempel di pemain tiap ronde.
        let kv = null;
        for (let i = 0; i < 20 && !victim.dead; i++) {
          victim.p = [me.p[0] + 5, me.p[1], me.p[2] + 5];
          if (!me.dead) {
            a.sendJson({ t: 'hit', target: victim.id, from: g.you, dmg: 200, head: true, helm: 0, w: 1001 });
          }
          kv = await a.waitFor(m => m.t === 'kill' && m.victim === victim.id, 800).catch(() => null);
          if (!victim.dead) await new Promise(r => setTimeout(r, 700));
        }
        ok(victim.dead === true, 'bot ' + victim.id.slice(0, 8) + ' mati (lewat hit pemain)');
        if (victim.dead) {
          ok(victim.respawnAt > Date.now(), 'victim.respawnAt di-set (' + victim.respawnAt + ') — bukan 0');
          // tunggu respawn (3 detik + tick)
          let back = false;
          for (let i = 0; i < 80 && !back; i++) {
            await new Promise(r => setTimeout(r, 150));
            back = !victim.dead && victim.hp > 0;
          }
          ok(back, 'bot RESPAWN setelah mati (hp=' + victim.hp + ') — bug respawn permanen udah ilang');
        }
      }
      // bot vs bot: paksa lewat API internal buat pastikan jalur kill() dipakai
      const b2 = [...battle.ents.values()].filter(e => e.bot && !e.dead);
      if (b2.length >= 2) {
        const [x, y] = b2;
        x.hp = 1;
        battle.bots.shoot(battle, y, x, 50, false);
        ok(x.dead === true, 'bot vs bot: target mati');
        ok(x.respawnAt > Date.now(), 'bot vs bot: respawnAt ke-set lewat battle.kill()');
        let back2 = false;
        for (let i = 0; i < 80 && !back2; i++) {
          await new Promise(r => setTimeout(r, 150));
          back2 = !x.dead && x.hp > 0;
        }
        ok(back2, 'bot vs bot: target RESPAWN');
      }
    }

    // ---- 13. leavegame ----
    log('=== 13. leavegame ===');
    a.sendJson({ t: 'leavegame' });
    await new Promise(r => setTimeout(r, 400));
    const gone = battle.bySid.get(sess.sid);
    ok(!gone, 'ent hilang setelah leavegame');

    // ---- 14. cleanup battle nggak ninggalin entri stale ----
    // REGRESI: cleanup() cuma delete `battles.delete(this.key)`, entri
    // "<battleKey>.<sid>" per pemain nyangkut -> memory leak.
    log('=== 14. cleanup battle ===');
    {
      const stale = [...lobby.battles.entries()].filter(([k, b]) => b === battle);
      ok(stale.length > 0, 'masih ada ' + stale.length + ' entri battle di map (sebelum cleanup)');
      battle.cleanup();
      await new Promise(r => setTimeout(r, 100));
      const after = [...lobby.battles.entries()].filter(([k, b]) => b === battle);
      ok(after.length === 0, 'SEMUA entri battle dihapus (' + after.length + ' sisa) — nggak ada leak');
    }

  } catch (e) {
    fail++;
    LOG.push('  FAIL EXCEPTION: ' + e.message);
    LOG.push(e.stack);
  } finally {
    console.log(LOG.join('\n'));
    console.log('');
    console.log('HASIL: ' + pass + ' lulus, ' + fail + ' gagal');
    try { server.close(); } catch (_) {}
    try { lobby.db.flush(); } catch (_) {}
    setTimeout(() => process.exit(fail ? 1 : 0), 400);
  }
})();
