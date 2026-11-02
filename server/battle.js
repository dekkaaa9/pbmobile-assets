'use strict';
// ============================================================
//  battle.js — simulasi pertempuran.
//
//  ARSITEKTUR PENTING (dari net.js):
//    * Battle WS `/b2` CUMA bawa frame biner `st` (posisi 20 Hz).
//    * SEMUA event JSON (game, spawn, kill, hp, fx, chat...) lewat
//      socket LOBBY `/ws`. Jadi battle perlu referensi ke Lobby.
//
//  Hit registration CLIENT-AUTHORITATIVE — server percaya `dmg`
//  dari client (persis kayak server asli). Bot tetap dihitung server.
// ============================================================

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const { encodeSt, encodeStBatch, decodeSt } = require('./codec');
const { battleUrl } = cfg;

const TICK = 0.05;
const MAX_HP = 100;

function rid(p) { return p + crypto.randomBytes(6).toString('hex'); }

// ---------- spawn point dari export/maps (opsional) ----------
const SPAWN_CACHE = new Map();
function spawnPoints(mapName) {
  if (SPAWN_CACHE.has(mapName)) return SPAWN_CACHE.get(mapName);
  let pts = [];
  const dir = path.resolve(__dirname, '..', 'site', 'export', 'maps');
  try {
    const f = path.join(dir, mapName + '.json');
    if (fs.existsSync(f)) {
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      const arr = j.spawns || j.spawn || j.points || [];
      pts = arr.filter(p => Array.isArray(p) && p.length >= 3).slice(0, 64);
    }
  } catch (_) {}
  if (!pts.length) {
    // fallback: grid acak di sekitar origin
    for (let i = 0; i < 24; i++) {
      const t = (i / 24) * Math.PI * 2;
      pts.push([Math.cos(t) * 22, 0, Math.sin(t) * 22]);
    }
  }
  SPAWN_CACHE.set(mapName, pts);
  return pts;
}

class Ent {
  constructor(o) {
    this.id = o.id;
    this.nick = o.nick || 'bot';
    this.team = o.team || 0;
    this.chara = o.chara || 0;
    this.bot = !!o.bot;
    this.owned = o.owned || null;      // sid pemilik (buat bot: null)
    this.sid = o.sid || null;
    this.p = [0, 0, 0];
    this.y = 0; this.pi = 0;
    this.c = 0; this.g = 0; this.r = 0;
    this.mv = [0, 0];
    this.w = o.w || 0;
    this.hp = MAX_HP;
    this.dead = false;
    this.kills = 0; this.deaths = 0; this.assists = 0; this.score = 0;
    this.headshots = 0;
    this.ready = false;
    this.respawnAt = 0;
    this.ping = this.bot ? 3 : 30 + Math.floor(Math.random() * 40);
    this.plat = this.bot ? 'bot' : 'pc';
    this.nc = 0; this.fx = 0; this.vip = false; this.card = '';
    this.rank = 0;
    this.weapon = o.weapon || null;
    this.ammo = 30; this.reloading = 0;
    this.helmet = { rate: 0, time: 0, slot: null, on: false };
    this.lastHit = new Map();
    this.inv = {};
    this.gg = 0;
    this.killChain = 0;
    this.spawn();
  }

  spawn() {
    const pts = spawnPoints(this._map || 'Downtown');
    const p = pts[Math.floor(Math.random() * pts.length)] || [0, 0, 0];
    this.p = [+p[0].toFixed(2), +(p[1] || 0).toFixed(2), +p[2].toFixed(2)];
    this.y = Math.random() * Math.PI * 2;
    this.pi = 0;
    this.hp = MAX_HP;
    this.dead = false;
    this.mv = [0, 0];
    this.respawnAt = 0;
    this.ammo = 30;
    this.reloading = 0;
  }
}

// ---------- hit ----------
// arah tembakan ternormalisasi dari penembak ke target (buat fx `shot`).
// Diletakkan di scope module: deklarasi function nggak boleh muncul
// telanjang di dalam body class.
function shotDir(from, target) {
  const dx = target.p[0] - from.p[0], dy = (target.p[1] + 1.4) - (from.p[1] + 1.4), dz = target.p[2] - from.p[2];
  const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
  return [dx / l, dy / l, dz / l];
}

class Battle {
  constructor(lobby, room, mode) {
    this.lobby = lobby;
    this.room = room;
    this.mode = mode;
    this.key = rid('b');
    this.ents = new Map();          // entId -> Ent
    this.bySid = new Map();         // sid -> Ent
    this.sockets = new Map();       // sid -> WsConn (battle WS)
    this.score = [0, 0];
    this.timeLeft = room.time;
    this.round = 0;
    this.rounds = mode.rounds || 1;
    this.phase = 'warm';            // warm | live | over
    this.freeze = 5;                // detik countdown
    this.startedAt = Date.now();
    this.elapsed = 0;
    this.tickN = 0;
    this.over = false;
    this.bomb = null;
    this.zones = [];
    this.carrier = null;
    this.itemPos = null;
    this.br = null;
    this.winner = null;
    this.bots = null;
    this.dmgLog = [];
    this._spawn();
  }

  _spawn() {
    // pemain manusia
    for (const m of this.room.members) {
      const e = new Ent({
        id: m.id, nick: m.nick, team: m.team, chara: m.chara,
        sid: m.id, owned: m.id, w: m.weapon || 0, weapon: m.weapon,
      });
      e._map = this.room.map;
      e.rank = m.lvl || 0;
      e.plat = 'pc';
      this.ents.set(e.id, e);
      this.bySid.set(m.id, e);
    }
  }

  setBots(bots) { this.bots = bots; bots.spawn(); }

  // ---------- koneksi battle WS ----------
  // `sid` = sid lobby pemilik socket ini (dari attachBattle di lobby.js)
  attach(conn, sid) {
    if (sid) this.sockets.set(sid, conn);
    conn.on('message', (data, bin) => {
      if (!bin) return;
      try {
        const frames = decodeSt(data);
        for (const f of frames) this.onSt(conn, f);
      } catch (_) {}
    });
    conn.on('close', () => {
      for (const [k, v] of this.sockets) if (v === conn) this.sockets.delete(k);
    });
    conn.on('error', () => {
      for (const [k, v] of this.sockets) if (v === conn) this.sockets.delete(k);
    });
    return conn;
  }

  // ---------- frame `st` dari client ----------
  onSt(conn, frame) {
    // cari pemain dari socket
    let sid = null;
    for (const [k, v] of this.sockets) if (v === conn) { sid = k; break; }
    if (!sid) return;
    const e = this.bySid.get(sid);
    if (!e || e.dead) return;

    for (const ent of frame.ents || []) {
      if (String(ent.id) !== String(e.id)) continue;
      e.p = ent.p; e.y = ent.y; e.pi = ent.pi;
      e.c = ent.c; e.g = ent.g; e.r = ent.r;
      e.mv = ent.mv;
      if (ent.w) e.w = ent.w;
    }
  }

  // ---------- pesan JSON dari lobby socket ----------
  onClientMsg(s, m) {
    const e = this.bySid.get(s.sid);
    switch (m.t) {
      case 'ingame':
      case 'watch':
        if (e) {
          e.ready = true;
          this.lobby.send(s, this.gamePayload(e));
          // kalau pemain masuk setelah match mulai, beri tahu yang lain
          this.sendRoom({ t: 'joined', ent: this.entDescriptor(e) }, s.sid);
          // PENTING: `srly` yang bikin client buka battle WS `/b2?k=`.
          // Dikirim SETELAH `game` supaya client sudah punya konteks.
          this.lobby.send(s, {
            t: 'srly',
            u: battleUrl(s, '/b2'),
            k: s.battleKey,
          });
        }
        return;
      case 'loaded':
        this.loadp(s, 1, 1);
        return;
      case 'spawnme':
        if (e && e.dead) { this.respawn(e); }
        else if (e && !e.dead) { this.lobby.send(s, { t: 'spawn', id: e.id, owned: true }); }
        return;
      case 'leavegame':
        this.playerLeft(s);
        return;
      case 'hit':
        return this.onHit(s, m);
      case 'fx':
        return this.onFx(s, m);
      case 'heal':
        return this.onHeal(s, m);
      case 'mobj':
        return this.onMobj(s, m);
      case 'arm':
        return this.onArm(s, m, true);
      case 'disarm':
        return this.onArm(s, m, false);
      case 'touch':
        return this.onTouch(s, m);
      case 'inp':
        return;
      case 'equip':
        if (e) e.w = m.item || e.w;
        return;
      case 'brjump':
        return this.onBrJump(s, m);
      case 'brland':
        return this.onBrLand(s, m);
      case 'brpick':
        return this.onBrPick(s, m);
      case 'brk':
        return this.onBrk(s, m);
      case 'kcskip':
        return this.lobby.send(s, { t: 'kcskip' });
      case 'ktake':
        return this.lobby.send(s, { t: 'ktake', id: m.id, by: m.by, score: this.score, conf: true });
      case 'p2p':
        return this.onP2p(s, m);
      case 'rtc':
        return this.onP2p(s, m, 'rtc');
      case 'vo':
        return this.onVoice(s, m);
    }
  }

  // ---------- payload `game` (config battle) ----------
  gamePayload(e) {
    return {
      t: 'game',
      you: e ? e.id : null,
      game: {
        map: this.room.map,
        mode: this.room.mode,
        nick: e ? e.nick : '',
        team: e ? e.team : 0,
        kills: this.room.kills,
        time: this.room.time,
        timeLimit: this.timeLeft,
        killLimit: this.room.kills,
        waiting: false,
        bounds: null,
        rnd: { el: this.elapsed, n: this.round },
        gg: cfg.RANK_LADDER,
        ents: [...this.ents.values()].map(x => ({
          id: x.id, nick: x.nick, team: x.team, nc: x.nc, fx: x.fx,
          vip: x.vip, card: x.card, rank: x.rank, kills: x.kills,
          deaths: x.deaths, dead: x.dead, me: e ? x.id === e.id : false,
          ping: x.ping, plat: x.plat, bot: x.bot,
        })),
        tags: [],
        dom: this.mode.teams ? this.zones : null,
        br: this.room.mode === 'royale' ? this.br : null,
        sp: this.room.sp || '',
      },
      score: this.score,
    };
  }

  sendRoom(obj, skip) {
    for (const m of this.room.members) {
      if (skip && m.id === skip) continue;
      const s = this.lobby.conns.get(m.id);
      if (s) this.lobby.send(s, obj);
    }
  }

  sendAll(obj) {
    for (const m of this.room.members) {
      const s = this.lobby.conns.get(m.id);
      if (s) this.lobby.send(s, obj);
    }
  }

  loadp(s, n, of) { this.lobby.send(s, { t: 'loadp', n, of }); }

  // ---------- mulai ----------
  startCountdown() {
    this.phase = 'warm';
    this.freeze = 5;
    this.sendAll({ t: 'go', left: this.freeze });
    setTimeout(() => { if (!this.over) { this.phase = 'live'; this.sendAll({ t: 'go', left: 0 }); } }, this.freeze * 1000);
  }

  // ---------- tick ----------
  tick(dt) {
    if (this.over) return;
    this.elapsed += dt;
    this.tickN++;

    if (this.phase === 'warm') {
      this.freeze -= dt;
      if (this.freeze <= 0) { this.phase = 'live'; this.sendAll({ t: 'go', left: 0 }); }
      return;
    }

    this.timeLeft -= dt;

    // respawn
    const t = Date.now();
    for (const e of this.ents.values()) {
      if (e.dead && e.respawnAt && t >= e.respawnAt) this.respawn(e);
    }

    // bot
    if (this.bots) this.bots.tick(dt, this);

    // royale zone
    if (this.room.mode === 'royale' && this.br) {
      this.br.t = Math.max(0, this.br.t - dt);
      if (this.br.t <= 0 && this.br.r > 6) {
        this.br.r = Math.max(6, this.br.r - 12);
        this.br.t = 20;
        this.sendAll({ t: 'brred', seed: Math.floor(Math.random() * 1e9), in: 7, r: this.br.r });
      }
    }

    // kalah/menang
    this.checkEnd();
  }

  checkEnd() {
    if (this.over) return;
    const mode = this.mode;
    const alive = [...this.ents.values()].filter(e => !e.dead);
    const humans = [...this.ents.values()].filter(e => !e.bot);

    if (this.room.mode === 'royale') {
      const aliveHumans = humans.filter(e => !e.dead);
      if (aliveHumans.length <= 1 && this.elapsed > 3) {
        const w = aliveHumans[0];
        return this.end(w ? w.team : null, 'royale');
      }
    }

    if (mode.teams) {
      if (this.score[0] >= this.room.kills || this.score[1] >= this.room.kills) {
        return this.end(this.score[0] >= this.room.kills ? 0 : 1, 'kills');
      }
    } else {
      for (const e of this.ents.values()) if (e.kills >= this.room.kills) return this.end(null, 'kills', e);
    }

    if (this.timeLeft <= 0) {
      if (mode.teams) {
        const w = this.score[0] === this.score[1] ? null : (this.score[0] > this.score[1] ? 0 : 1);
        return this.end(w, 'time');
      }
      let best = null;
      for (const e of this.ents.values()) if (!best || e.kills > best.kills) best = e;
      return this.end(null, 'time', best);
    }
  }

  end(winTeam, type, bestEnt) {
    if (this.over) return;
    this.over = true;
    this.phase = 'over';
    this.winner = winTeam;

    const rows = [...this.ents.values()].map(e => ({
      id: e.id, nick: e.nick, team: e.team, kills: e.kills, deaths: e.deaths,
      score: e.score, nc: e.nc, fx: e.fx, rank: e.rank, me: !e.bot,
    }));

    this.sendAll({
      t: 'end', ents: rows, score: this.score,
      win: winTeam, type, winNick: bestEnt ? bestEnt.nick : null,
    });
    this.sendAll({ t: 'rend', score: this.score, win: winTeam, type });

    // update akun
    for (const e of this.ents.values()) {
      if (e.bot || !e.owned) continue;
      const s = this.lobby.conns.get(e.owned);
      if (!s || !s.account) continue;
      const a = s.account;
      a.kills += e.kills; a.deaths += e.deaths; a.matches += 1; a.headshots += e.headshots;
      if (winTeam !== null && e.team === winTeam) a.wins += 1;
      if (!this.mode.teams) { if (bestEnt && bestEnt.id === e.id) a.wins += 1; }
      this.lobby.db.save();
    }
    this.lobby.db.recordMatch({
      at: Date.now(), map: this.room.map, mode: this.room.mode,
      score: this.score, players: this.ents.size, win: winTeam,
    });

    this.lobby.log('partida ' + this.key.slice(0, 6) + ' selesai: ' + type + ' win=' + winTeam);
    setTimeout(() => this.cleanup(), 15000);
  }

  cleanup() {
    for (const [sid, c] of this.sockets) { try { c.close(1000, 'end'); } catch (_) {} }
    this.sockets.clear();
    this.lobby.battles.delete(this.key);
    if (this.room.battle === this) this.room.battle = null;
    this.room.state = 'Esperando';
    for (const m of this.room.members) {
      const s = this.lobby.conns.get(m.id);
      if (s) { s.inGame = false; s.battleKey = null; this.lobby.sendRooms(s); }
    }
  }

  // ---------- respawn ----------
  respawn(e) {
    e.spawn();
    const s = e.owned ? this.lobby.conns.get(e.owned) : null;
    if (s) this.lobby.send(s, { t: 'spawn', id: e.id, owned: true });
    this.sendRoom({ t: 'spawn', id: e.id, team: e.team }, e.owned);
  }

  playerLeft(s) {
    const e = this.bySid.get(s.sid);
    if (!e) return;
    this.ents.delete(e.id);
    this.bySid.delete(s.sid);
    this.sockets.delete(s.sid);
    this.sendRoom({ t: 'gone', id: e.id, nick: e.nick, boss: false });
    if (this.room.mode === 'royale') {
      const alive = [...this.ents.values()].filter(x => !x.bot && !x.dead);
      if (alive.length <= 1) this.checkEnd();
    }
  }

  // pemain join mid-game: kirim `joined` dengan deskriptor ent lengkap
  // (handler: Gc(e.ent) bikin entity dari payload ini)
  announceJoin(e) {
    this.sendRoom({ t: 'joined', ent: this.entDescriptor(e) });
  }

  entDescriptor(e) {
    return {
      id: e.id, nick: e.nick, name: e.nick, team: e.team, nc: e.nc, fx: e.fx,
      vip: e.vip, card: e.card, rank: e.rank, chara: e.chara, plat: e.plat,
      ping: e.ping, isBot: e.bot, owned: !!e.owned, kills: e.kills, deaths: e.deaths,
      lvl: e.rank, w: e.w, bot: e.bot,
    };
  }

  // ---------- hit ----------
  onHit(s, m) {
    const from = this.bySid.get(s.sid);
    if (!from || from.dead) return;
    const target = this.ents.get(String(m.target));
    if (!target || target.dead || target.team === from.team) return;

    // jarak wajar (anti nonsense)
    const dx = target.p[0] - from.p[0], dy = target.p[1] - from.p[1], dz = target.p[2] - from.p[2];
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist > 250) return;

    // damage: pakai rumus bundle.js kalau weapon diketahui
    let dmg = +m.dmg || 0;
    if (!(dmg > 0)) return;
    if (dmg > 200) dmg = 200;

    target.hp -= dmg;
    const head = !!m.head;

    // broadcast hp + fx
    // `hp` butuh `from` (handler: t===Ye.s && e.hp<t.hp && e.from && Hs(fc(e.from)))
    this.sendAll({ t: 'hp', id: target.id, hp: Math.max(0, target.hp), helm: m.helm ? 1 : 0, from: from.id });
    // CATATAN: efek darah dirender LOKAL oleh penembak, jadi server TIDAK
    // kirim fx darah. Handler `fx` remote cuma dukung radio/shot/nade/shell;
    // kirim key lain = no-op (buang CPU doang).
    if (m.fx !== false) {
      this.sendAll({
        t: 'fx', k: 'shot', id: from.id, w: m.w || from.w,
        o: from.p.slice(), d: shotDir(from, target),
        ts: Date.now(), from: from.id,
      });
    }

    if (target.hp <= 0) this.kill(target, from, head, m);
  }

  kill(victim, killer, head, m) {
    victim.dead = true;
    victim.hp = 0;
    victim.deaths += 1;
    victim.killChain = 0;
    victim.respawnAt = Date.now() + (this.room.mode === 'royale' ? 1e9 : 3000);

    if (killer && killer !== victim) {
      killer.kills += 1;
      killer.score += 100;
      killer.killChain += 1;
      if (head) { killer.headshots += 1; killer.score += 25; }
      if (this.mode.teams) this.score[killer.team] = (this.score[killer.team] || 0) + 1;
    }

    const ev = {
      t: 'kill', killer: killer ? killer.id : null, victim: victim.id,
      knick: killer ? killer.nick : '', vnick: victim.nick,
      kteam: killer ? killer.team : -1, vteam: victim.team,
      head: !!head, w: m && m.w ? m.w : (killer ? killer.w : 0),
      mine: false, chain: killer ? killer.killChain : 0,
      // WAJIB: handler `kill` di bundle.js baca e.score[0] & e.score[1]
      // tanpa guard. Kalau nggak ada, client lempar TypeError.
      score: this.score.slice(),
      kc: false, wk: 0,
    };
    for (const e of this.ents.values()) {
      const s = e.owned ? this.lobby.conns.get(e.owned) : null;
      if (!s) continue;
      const mine = (killer && killer.id === e.id) || victim.id === e.id;
      this.lobby.send(s, Object.assign({}, ev, { mine }));
    }

    if (this.room.mode === 'royale') {
      const alive = [...this.ents.values()].filter(x => !x.dead);
      this.sendAll({ t: 'brk', id: victim.id, d: alive.length, by: killer ? killer.id : null });
      this.sendAll({ t: 'zlast', id: victim.id });
    }

    this.checkEnd();
  }

  // ---------- efek ----------
  onFx(s, m) {
    const e = this.bySid.get(s.sid);
    if (!e) return;
    this.sendRoom(Object.assign({}, m, { id: e.id }), s.sid);
  }

  onHeal(s, m) {
    const e = this.bySid.get(s.sid);
    const t = this.ents.get(String(m.target));
    if (!e || !t || t.team !== e.team || t.dead) return;
    t.hp = Math.min(MAX_HP, t.hp + 50);
    this.sendAll({ t: 'hp', id: t.id, hp: t.hp });
  }

  onMobj(s, m) { this.sendAll({ t: 'mobj', i: m.i, hp: m.hp != null ? m.hp : 0 }); }

  // ---------- bomba ----------
  onArm(s, m, on) {
    const e = this.bySid.get(s.sid);
    if (!e) return;
    if (on) {
      this.bomb = { by: e.id, team: e.team, pos: e.p.slice(), at: Date.now(), left: 40 };
      this.sendAll({ t: 'arm', id: e.id, on: true });
      this.sendAll({ t: 'planted', pos: this.bomb.pos, left: this.bomb.left });
      setTimeout(() => { if (this.bomb && !this.over) this.explode(); }, this.bomb.left * 1000);
    } else {
      this.sendAll({ t: 'disarm', id: e.id, on: true });
      if (this.bomb) {
        this.bomb = null;
        this.sendAll({ t: 'rend', score: this.score, win: null, type: 'uninstall' });
      }
    }
  }

  explode() {
    if (!this.bomb || this.over) return;
    const t = this.bomb.team;
    this.bomb = null;
    this.sendAll({ t: 'rend', score: this.score, win: t ^ 1, type: 'bombfire' });
    this.end(t ^ 1, 'bomb');
  }

  // ---------- extort / convoy ----------
  onTouch(s, m) {
    const e = this.bySid.get(s.sid);
    if (!e) return;
    this.sendAll({ t: 'touch', id: e.id, p: e.p });
  }

  // ---------- battle royale ----------
  onBrJump(s, m) {
    const e = this.bySid.get(s.sid);
    if (!e) return;
    e.p = m.p ? m.p.slice() : e.p;
    this.sendRoom({ t: 'brjump', id: e.id }, s.sid);
  }
  onBrLand(s, m) {
    const e = this.bySid.get(s.sid);
    if (!e) return;
    this.sendRoom({ t: 'brland', id: e.id }, s.sid);
  }
  onBrPick(s, m) {
    const e = this.bySid.get(s.sid);
    if (!e) return;
    this.sendRoom({ t: 'brpick', id: e.id, item: m.id }, s.sid);
  }
  onBrk(s, m) {
    const e = this.bySid.get(s.sid);
    if (!e) return;
    const t = this.ents.get(String(m.id));
    if (!t || t.dead) return;
    this.kill(t, e, false, m);
  }

  // ---------- p2p / suara ----------
  onP2p(s, m, kind) {
    const to = this.lobby.conns.get(m.to) || [...this.lobby.conns.values()].find(c => c.sid === m.to);
    if (!to) return;
    this.lobby.send(to, { t: kind || 'p2p', from: s.sid, sdp: m.sdp, c: m.c });
  }

  onVoice(s, m) {
    for (const e of this.ents.values()) {
      if (e.owned === s.sid) continue;
      const o = e.owned ? this.lobby.conns.get(e.owned) : null;
      if (o) this.lobby.send(o, { t: 'vo', from: s.sid, d: m.d, n: m.n });
    }
  }

  // ---------- snapshot `st` ----------
  snap() {
    if (this.over || this.phase === 'over') return;
    const ents = [];
    for (const e of this.ents.values()) {
      if (e.dead) continue;
      ents.push({
        id: e.id, p: e.p, y: e.y, pi: e.pi,
        c: e.c, g: e.g, r: e.r, mv: e.mv, w: e.w,
      });
    }
    if (!ents.length) return;
    const buf = encodeSt({ t: 'st', ts: Date.now(), from: this.key, ents });
    for (const [sid, c] of this.sockets) {
      if (c.open) { try { c.sendBin(buf); } catch (_) {} }
    }
  }
}

module.exports = { Battle, Ent, spawnPoints };
