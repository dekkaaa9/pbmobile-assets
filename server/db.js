'use strict';
// ============================================================
//  db.js — persistence JSON. Sengaja BUKAN SQLite:
//  box target cuma ~953 MB RAM dan `node:sqlite` di Node 22 masih
//  butuh flag --experimental-sqlite. JSON store cukup buat clone
//  pribadi, nggak ada dependency, dan aman kalau proses mati.
// ============================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Starter kit — mirror dari client.js: START_KIT=["k2","k5","m7","k400",
// "508001","redbulls","acidpol"]. Item ini gratis punya tiap akun baru.
const START_KIT = ['k2', 'k5', 'm7', 'k400', '508001', 'redbulls', 'acidpol'];

class DB {
  constructor(file) {
    this.file = file;
    this.data = { accounts: {}, nextId: 1, matches: [], sessions: {} };
    this._t = null;
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.file)) {
        const raw = fs.readFileSync(this.file, 'utf8');
        const j = JSON.parse(raw);
        if (j && typeof j === 'object') {
          this.data.accounts = j.accounts || {};
          this.data.nextId = j.nextId || 1;
          this.data.matches = j.matches || [];
          this.data.sessions = j.sessions || {};
        }
      }
    } catch (e) {
      console.warn('[db] gagal baca ' + this.file + ', mulai baru:', e.message);
    }
  }

  save() {
    if (this._t) return;
    this._t = setTimeout(() => {
      this._t = null;
      this.flush();
    }, 250);
  }

  flush() {
    const dir = path.dirname(this.file);
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
    const tmp = this.file + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.warn('[db] gagal tulis:', e.message);
    }
  }

  // ---- akun ----
  // key: login lowercase (ID yang diketik pemain di MASUK/DAFTAR)
  getAccount(nick) { return this.data.accounts[String(nick).toLowerCase()] || null; }

  /** Cari akun by nick tampilan (bisa beda dari login). */
  findByNick(nick) {
    const n = String(nick).trim().toLowerCase();
    for (const a of Object.values(this.data.accounts)) {
      if (String(a.nick || '').trim().toLowerCase() === n) return a;
    }
    return null;
  }

  /** Cari by login dulu, fallback ke nick tampilan. */
  resolve(nick) { return this.getAccount(nick) || this.findByNick(nick); }

  // ---- password (scrypt + salt acak, compare constant-time) ----
  hashPw(pw) {
    const salt = crypto.randomBytes(16).toString('hex');
    return 'scrypt:' + salt + ':' + crypto.scryptSync(String(pw), salt, 32).toString('hex');
  }
  checkPw(pw, stored) {
    if (typeof stored !== 'string') return false;
    const p = stored.split(':');
    if (p.length !== 3 || p[0] !== 'scrypt') return false;
    let h, b;
    try {
      h = crypto.scryptSync(String(pw), p[1], 32);
      b = Buffer.from(p[2], 'hex');
    } catch (_) { return false; }
    return h.length === b.length && crypto.timingSafeEqual(h, b);
  }
  setPassword(a, pw) { a.pw = this.hashPw(pw); a.pwAt = Date.now(); this.save(); return a; }

  // ---- sesi (tok -> account id) biar resume/reconnect nggak logout ----
  // Sengaja TIDAK dihapus pas socket tutup: client simpan tok di
  // sessionStorage dan kirim `resume` pas reload/reconnect.
  // Di-cap biar nggak tumbuh terus kalau ada yang bikin banyak sesi.
  setSession(tok, acct) {
    this.data.sessions[tok] = acct.id;
    const ks = Object.keys(this.data.sessions);
    if (ks.length > 500) for (const k of ks.slice(0, ks.length - 500)) delete this.data.sessions[k];
    this.save();
    return tok;
  }
  getSession(tok) {
    const id = this.data.sessions[tok];
    if (!id) return null;
    for (const a of Object.values(this.data.accounts)) if (a.id === id) return a;
    return null;
  }
  delSession(tok) { delete this.data.sessions[tok]; this.save(); }

  /**
   * Bikin akun baru. `opts` = { login, pw, email } — kalau `pw` diisi,
   * akun ini punya kredensial dan bisa dipakai login lagi (alur DAFTAR).
   * Tanpa `pw` = akun warisan/auto (legacy), nggak bisa login sampai
   * diadopsi lewat setPassword().
   */
  createAccount(nick, opts) {
    const k = String(nick).toLowerCase();
    let a = this.data.accounts[k];
    if (a) return a;
    const o = opts || {};
    a = {
      id: 'u' + (this.data.nextId++),
      login: String(nick),
      nick: String(nick),
      email: String(o.email || '').slice(0, 80),
      pw: o.pw ? this.hashPw(o.pw) : '',
      created: Date.now(),
      lastLogin: Date.now(),
      cash: 50000,        // GP
      gold: 0,            // cash premium
      level: 1,
      xp: 0,
      rank: 0,
      kills: 0,
      deaths: 0,
      wins: 0,
      matches: 0,
      headshots: 0,
      playtime: 0,
      owned: Object.fromEntries(START_KIT.map(x => [x, true])),  // itemId -> true
      equip: { 1: 'k2', red: 'redbulls', blue: 'acidpol' },      // slot -> itemId
      // ranking / progresi
      rp: 0,               // pontos de ranking (RANKEADA)
      peakRp: 0,           // melhor da temporada
      rkGot: [],           // patentes cuja recompensa já foi pega
      losses: 0,
      // sosial / cosmetic
      notes: [],           // inbox
      blocks: [],          // bloqueados
      titles: [],          // títulos possuídos
      titleEq: null,       // título equipado
      nickStyle: null,     // {c,f}
      units: {},           // itens de clã (contador)
      // passe de missões
      mpassStart: 0,
      mpassEarned: 0,
      settings: null,
      missions: {},
      daily: {},
      banned: false,
      staff: false,
    };
    this.data.accounts[k] = a;
    this.save();
    return a;
  }

  touch(a) { a.lastLogin = Date.now(); this.save(); return a; }

  allAccounts() { return Object.values(this.data.accounts); }

  recordMatch(m) {
    this.data.matches.push(m);
    if (this.data.matches.length > 500) this.data.matches.splice(0, this.data.matches.length - 500);
    this.save();
  }

  top(field, n) {
    return this.allAccounts()
      .filter(a => !a.banned)
      .sort((x, y) => (y[field] || 0) - (x[field] || 0))
      .slice(0, n || 100)
      .map(a => ({ nick: a.nick, v: a[field] || 0 }));
  }
}

module.exports = { DB };
