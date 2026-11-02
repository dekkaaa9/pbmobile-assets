'use strict';
// ============================================================
//  db.js — persistence JSON. Sengaja BUKAN SQLite:
//  box target cuma ~953 MB RAM dan `node:sqlite` di Node 22 masih
//  butuh flag --experimental-sqlite. JSON store cukup buat clone
//  pribadi, nggak ada dependency, dan aman kalau proses mati.
// ============================================================

const fs = require('fs');
const path = require('path');

class DB {
  constructor(file) {
    this.file = file;
    this.data = { accounts: {}, nextId: 1, matches: [] };
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
  // key: nick lowercase
  getAccount(nick) { return this.data.accounts[String(nick).toLowerCase()] || null; }

  createAccount(nick) {
    const k = String(nick).toLowerCase();
    let a = this.data.accounts[k];
    if (a) return a;
    a = {
      id: 'u' + (this.data.nextId++),
      nick: String(nick),
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
      owned: {},          // itemId -> true
      equip: {},          // slot -> itemId
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
