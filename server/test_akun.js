// test_akun.js — tes alur DAFTAR / MASUK / resume end-to-end lewat WS asli.
// Zero-dep: WS client tangan sendiri (TLS + framing).
'use strict';
const crypto = require('crypto');
const tls = require('tls');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { DB } = require('../server/db');

// ---------- WS client minimal ----------
class Ws {
  constructor(host, port, pathname) {
    this.host = host; this.port = port; this.pathname = pathname;
    this.buf = Buffer.alloc(0); this.all = []; this.ready = false; this.closed = false;
  }
  connect(timeout = 15000) {
    return new Promise((res, rej) => {
      const key = crypto.randomBytes(16).toString('base64');
      this.sock = tls.connect({ host: this.host, port: this.port, servername: this.host }, () => {
        this.sock.write('GET ' + this.pathname + ' HTTP/1.1\r\nHost: ' + this.host + '\r\n' +
          'Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ' + key + '\r\n' +
          'Sec-WebSocket-Version: 13\r\nOrigin: https://' + this.host + '\r\n\r\n');
      });
      let hs = Buffer.alloc(0);
      this.sock.on('data', (d) => {
        if (!this.ready) {
          hs = Buffer.concat([hs, d]);
          const i = hs.indexOf('\r\n\r\n');
          if (i < 0) return;
          const head = hs.slice(0, i).toString();
          if (!/ 101 /.test(head.split('\r\n')[0])) { rej(new Error('handshake: ' + head.split('\r\n')[0])); return; }
          this.ready = true;
          const rest = hs.slice(i + 4);
          if (rest.length) this._d(rest);
          res(this);
        } else this._d(d);
      });
      this.sock.on('error', (e) => { if (!this.ready) rej(e); });
      this.sock.on('close', () => { this.closed = true; });
      setTimeout(() => { if (!this.ready) rej(new Error('timeout handshake')); }, timeout);
    });
  }
  _d(d) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    while (this.buf.length >= 2) {
      const op = this.buf[0] & 0x0f;
      let len = this.buf[1] & 0x7f, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      if (this.buf.length < off + len) return;
      const p = Buffer.from(this.buf.subarray(off, off + len));
      this.buf = this.buf.subarray(off + len);
      if (op === 8) { this.closed = true; continue; }
      if (op === 9) {
        const mask = crypto.randomBytes(4);
        const h = Buffer.alloc(2); h[0] = 0x80 | 10; h[1] = 0x80 | p.length;
        const m = Buffer.allocUnsafe(p.length);
        for (let i = 0; i < p.length; i++) m[i] = p[i] ^ mask[i & 3];
        this.sock.write(Buffer.concat([h, mask, m])); continue;
      }
      if (op === 10) continue;
      if (op === 1) { try { this.all.push(JSON.parse(p.toString('utf8'))); } catch (_) {} }
    }
  }
  send(o) {
    const payload = Buffer.from(JSON.stringify(o), 'utf8');
    const mask = crypto.randomBytes(4);
    const len = payload.length;
    let h;
    if (len < 126) { h = Buffer.alloc(2); h[0] = 0x80 | 1; h[1] = 0x80 | len; }
    else if (len < 65536) { h = Buffer.alloc(4); h[0] = 0x80 | 1; h[1] = 0x80 | 126; h.writeUInt16BE(len, 2); }
    else { h = Buffer.alloc(10); h[0] = 0x80 | 1; h[1] = 0x80 | 127; h.writeBigUInt64BE(BigInt(len), 2); }
    const m = Buffer.allocUnsafe(len);
    for (let i = 0; i < len; i++) m[i] = payload[i] ^ mask[i & 3];
    this.sock.write(Buffer.concat([h, mask, m]));
  }
  close() { try { this.sock.destroy(); } catch (_) {} }
  // tunggu pesan dgn t tertentu; balikin Error{auth:true} kayak client
  waitT(t, ms = 8000) {
    return new Promise((res) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        for (const m of this.all) if (m.t === t) { clearInterval(iv); return res(m); }
        if (this.closed || Date.now() - t0 > ms) {
          clearInterval(iv);
          const af = this.all.find(x => x.t === 'authfail');
          if (af) return res(Object.assign(new Error(af.text), { auth: true }));
          return res(null);
        }
      }, 60);
    });
  }
}

// ---------- harness ----------
let pass = 0, fail = 0;
const L = [];
function ok(c, m) { if (c) { pass++; L.push('  ok   ' + m); } else { fail++; L.push('  FAIL ' + m); } }
function sec(t) { L.push(''); L.push('=== ' + t + ' ==='); }

const HOST = process.argv[2] || 'lookup-preparation-represented-muze.trycloudflare.com';
const rnd = () => 't' + crypto.randomBytes(4).toString('hex');

async function hello(o) {
  const ws = await new Ws(HOST, 443, '/ws').connect();
  ws.send(Object.assign({ t: 'hello', plat: 'pc', sts: 1, bin: 1 }, o));
  const w = await ws.waitT('welcome');
  return { ws, w };
}

(async () => {
  L.push('target: wss://' + HOST + '/ws');

  // ---------- 1. DAFTAR ----------
  sec('DAFTAR (register)');
  const id1 = rnd(), pw1 = 'rahasia123', em1 = id1 + '@mail.com';
  let r = await hello({ login: id1, pw: pw1, register: true, email: em1 });
  ok(r.w && r.w.acct, 'welcome.acct diterima');
  ok(r.w && r.w.acct && r.w.acct.id, 'acct.id ada: ' + (r.w && r.w.acct && r.w.acct.id));
  ok(r.w && r.w.acct && r.w.acct.login === id1, 'acct.login = ID yang didaftarin');
  ok(r.w && r.w.acct && r.w.acct.name === id1, 'acct.name = ID (dipakai S.nick)');
  ok(r.w && r.w.bin === true, 'bin:true (gate battle WS)');
  ok(r.w && !!r.w.tok, 'tok dikirim (buat resume)');
  const owned = r.w && r.w.acct && r.w.acct.owned || {};
  ok(Object.keys(owned).length === 7, 'starter kit 7 item: ' + Object.keys(owned).join(','));
  const eq = r.w && r.w.acct && r.w.acct.equip || {};
  ok(eq[1] === 'k2', 'equip slot 1 = k2 (bukan undefined -> nggak jatuh ke m4a1)');
  ok(eq.red === 'redbulls' && eq.blue === 'acidpol', 'equip red/blue chara valid (S.chara nggak jadi undefined)');
  const tok1 = r.w && r.w.tok, sid1 = r.w && r.w.sid;
  r.ws.close();

  // ---------- 2. DAFTAR duplikat ----------
  sec('DAFTAR duplikat ditolak');
  r = await hello({ login: id1, pw: 'lain2345', register: true, email: 'x@mail.com' });
  ok(r.w instanceof Error, 'welcome DITOLAK');
  ok(r.w instanceof Error && r.w.auth === true, 'error.auth = true (client tampilin di lgErr)');
  ok(/já está em uso/i.test(r.w && r.w.message || ''), 'pesan: ' + (r.w && r.w.message));
  if (r.ws) r.ws.close();

  // ---------- 3. validasi input ----------
  sec('Validasi input DAFTAR');
  const bad = [
    ['ID kekurangan', { login: 'ab', pw: 'rahasia1', register: true, email: 'a@b.co' }, /3 a 16/],
    ['ID karakter aneh', { login: 'ab!cd', pw: 'rahasia1', register: true, email: 'a@b.co' }, /3 a 16/],
    ['senha kekurangan', { login: rnd(), pw: '123', register: true, email: 'a@b.co' }, /4 caracteres/],
    ['email ngawur', { login: rnd(), pw: 'rahasia1', register: true, email: 'bukan-email' }, /e-mail válido/],
  ];
  for (const [nama, o, re] of bad) {
    const x = await hello(o);
    ok(x.w instanceof Error && re.test(x.w && x.w.message || ''), nama + ' -> "' + (x.w && x.w.message) + '"');
    if (x.ws) x.ws.close();
  }

  // ---------- 4. MASUK benar ----------
  sec('MASUK (login)');
  r = await hello({ login: id1, pw: pw1 });
  ok(r.w && r.w.acct, 'password bener -> welcome');
  ok(r.w && r.w.acct && r.w.acct.id === (await (async () => { const q = await hello({ login: id1, pw: pw1 }); q.ws.close(); return q.w && q.w.acct && q.w.acct.id; })()), 'akun yang sama kepilih');
  if (r.ws) r.ws.close();

  // ---------- 5. MASUK salah ----------
  sec('MASUK ditolak');
  r = await hello({ login: id1, pw: 'salahbanget' });
  ok(r.w instanceof Error && r.w.auth === true, 'password salah -> authfail');
  ok(/Senha incorreta/i.test(r.w && r.w.message || ''), 'pesan: ' + (r.w && r.w.message));
  if (r.ws) r.ws.close();

  r = await hello({ login: rnd(), pw: 'rahasia1' });
  ok(r.w instanceof Error && r.w.auth === true, 'ID nggak ada -> authfail');
  ok(/não encontrado/i.test(r.w && r.w.message || ''), 'pesan: ' + (r.w && r.w.message));
  if (r.ws) r.ws.close();

  r = await hello({ login: '', pw: '' });
  ok(r.w instanceof Error && r.w.auth === true, 'ID kosong -> authfail');
  if (r.ws) r.ws.close();

  // ---------- 6. RESUME pakai tok ----------
  sec('RESUME (reconnect / reload)');
  const ws = await new Ws(HOST, 443, '/ws').connect();
  ws.send({ t: 'resume', sid: sid1, tok: tok1, nick: id1, plat: 'pc', sts: 1, bin: 1 });
  const w2 = await ws.waitT('welcome');
  ok(w2 && w2.acct, 'resume dgn tok valid -> welcome (nggak logout)');
  ok(w2 && w2.acct && w2.acct.login === id1, 'akun yang sama balik');
  ws.close();

  // tok ngawur -> harus minta login, BUKAN bikin akun baru
  const ws2 = await new Ws(HOST, 443, '/ws').connect();
  ws2.send({ t: 'resume', sid: 'sngawur', tok: 'tokngawur', nick: id1, plat: 'pc', sts: 1, bin: 1 });
  const w3 = await ws2.waitT('welcome');
  ok(w3 instanceof Error, 'tok ngawur ditolak (nggak auto-bikin akun)');
  ws2.close();

  // ---------- 7. unit: hash password ----------
  sec('Unit: hash password');
  const f = path.join(os.tmpdir(), 'pb_akun_' + rnd() + '.json');
  const db = new DB(f);
  const a = db.createAccount('Hash' + rnd(), { login: 'x', pw: 'rahasia123', email: 'h@m.co' });
  ok(a.pw && a.pw.startsWith('scrypt:'), 'format scrypt:salt:hash');
  ok(db.checkPw('rahasia123', a.pw), 'password bener lolos');
  ok(!db.checkPw('rahasia124', a.pw), 'password beda ditolak');
  ok(!db.checkPw('', a.pw), 'password kosong ditolak');
  ok(!db.checkPw('rahasia123', ''), 'stored kosong ditolak');
  ok(!db.checkPw('rahasia123', 'bukan:format:benar'), 'format ngawur ditolak');
  // salt acak: password sama -> hash beda (anti rainbow table)
  const a2 = db.createAccount('Hash' + rnd(), { login: 'x', pw: 'rahasia123', email: 'h2@m.co' });
  ok(a2.pw !== a.pw, 'password sama -> hash beda (salt acak)');
  // persistensi
  db.flush();
  const db2 = new DB(f);
  const b = db2.getAccount(a.login);
  ok(!!b, 'akun bertahan setelah restart (JSON flush)');
  ok(db2.checkPw('rahasia123', b.pw), 'password bertahan setelah restart');
  ok(!!db2.getSession('ngawur') === false, 'sesi ngawur -> null');
  db2.setSession('tokx', b);
  ok(db2.getSession('tokx') && db2.getSession('tokx').id === b.id, 'sesi tokx -> akun b');
  db2.flush();
  const db3 = new DB(f);
  ok(db3.getSession('tokx') && db3.getSession('tokx').id === b.id, 'sesi bertahan setelah restart');
  // legacy account (tanpa pw) -> bisa diadopsi
  const leg = db3.createAccount('Legacy' + rnd());
  ok(!leg.pw, 'akun legacy tanpa pw');
  db3.setPassword(leg, 'baru1234');
  ok(db3.checkPw('baru1234', leg.pw), 'adopsi: password bisa di-set');
  try { fs.unlinkSync(f); } catch (_) {}

  // ---------- 8. regresi: hello polos (guest) harus tetap jalan ----------
  sec('Regresi: hello polos / tanpa register');
  r = await hello({ nick: 'Guest' + rnd() });
  ok(r.w instanceof Error, 'hello polos TANPA login ditolak (sekarang butuh akun)');
  ok(/Digite seu ID|não encontrado/i.test(r.w && r.w.message || ''), 'pesan jelas: ' + (r.w && r.w.message));
  if (r.ws) r.ws.close();

  console.log(L.join('\n'));
  console.log('\n================ HASIL ================');
  console.log('PASS: ' + pass + '   FAIL: ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log(L.join('\n')); console.log('\nSUITE ERROR: ' + (e && e.stack || e)); process.exit(1); });
