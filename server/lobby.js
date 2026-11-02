'use strict';
// ============================================================
//  lobby.js — protokol lobby lengkap (port dari client.js + net.js)
//
//  Lobby WS `/ws`  : SEMUA pesan JSON (welcome, rooms, chat, game, kill...)
//  Battle WS `/b2` : CUMA frame biner `st` (posisi, 20 Hz)
//
//  Alur main:
//    hello -> welcome(bin:true) -> rooms -> join/create -> start
//    -> client buka /jogo -> kirim ingame -> server kirim game + srly
//    -> client buka /b2?k=... -> st frames -> hit/fx/kill -> end
// ============================================================

const crypto = require('crypto');
const { DB } = require('./db');
const cfg = require('./config');
const { encodeSt, encodeStBatch } = require('./codec');
const { Battle } = require('./battle');
const { Bots } = require('./bots');

const TICK_MS = 50;          // 20 Hz — sama kayak client
const SNAP_MS = 66;          // ~15 Hz broadcast snapshot

function newId(p) { return p + crypto.randomBytes(8).toString('hex'); }
function now() { return Date.now(); }

class Lobby {
  constructor(opts) {
    this.db = new DB(opts.dbFile || require('path').join(__dirname, '..', 'data', 'pb.json'));
    this.weapons = cfg.loadWeapons();
    this.conns = new Map();       // sid -> session
    this.rooms = new Map();       // roomId -> Room
    this.battles = new Map();     // battleKey -> Battle
    this.queue = [];              // matchmaking quick-play
    this.brQueue = [];            // battle royale queue
    this.rankQueue = [];
    this.nextRoomId = 1000;
    this.chatLog = [];
    this.worldChat = [];
    this.groups = new Map();
    this.dms = new Map();
    this.friends = new Map();
    this.stats = { started: now(), online: 0 };
    this._tick = setInterval(() => this.tick(), TICK_MS);
    this._snap = setInterval(() => this.snap(), SNAP_MS);
    this._beat = setInterval(() => this.heartbeat(), 5000);
    this._seedRooms();
  }

  log(...a) { console.log('[lobby]', ...a); }

  // ---------- room bawaan biar ada isi ----------
  // CATATAN: `time` = MENIT (client: timeLimit = 60 * time), `kills` = batas kill.
  _seedRooms() {
    const seed = [
      { title: 'Treino contra bots', mode: 'dm', map: 'Downtown', kills: 30, time: 5, bots: [0, 5], dif: 1 },
      { title: 'Mata-mata rápido', mode: 'dm', map: 'Uptown', kills: 50, time: 5, bots: [3, 3], dif: 2 },
      { title: 'Bomba RED x BLUE', mode: 'bomb', map: 'Downtown', kills: 5, time: 3, bots: [4, 4], dif: 2 },
      { title: 'Dominação', mode: 'dom', map: 'Library', kills: 100, time: 5, bots: [4, 4], dif: 2 },
      { title: 'Kill Confirmed', mode: 'kconf', map: 'NPort', kills: 50, time: 5, bots: [2, 2], dif: 3 },
      { title: 'Battle Royale', mode: 'royale', map: 'Wilderness', kills: 1, time: 10, bots: [0, 0], dif: 2 },
      { title: 'Gun Game', mode: 'gungame', map: 'Crackdown', kills: 16, time: 5, bots: [3, 3], dif: 2 },
      { title: 'Infectado', mode: 'zombie', map: 'Downtown', kills: 5, time: 3, bots: [6, 0], dif: 2 },
    ];
    for (const s of seed) this.createRoom({ ...s, host: null, seed: true });
  }

  // ---------- koneksi ----------
  attach(conn, req) {
    const sid = newId('s');
    const s = {
      sid, conn, nick: '', plat: 'pc', account: null, room: null,
      inGame: false, watching: 0, battleKey: null, entId: null,
      lastSeen: now(), touch: null, alive: true,
      // host & skema dari request upgrade — dipakai buat bikin URL `srly`
      host: (req && req.headers && req.headers.host) || '',
      secure: cfg.isSecure(req),
    };
    this.conns.set(sid, s);
    conn.on('message', (data, bin) => this.onMessage(s, data, bin));
    conn.on('close', () => this.onClose(s));
    conn.on('error', () => {});
    return s;
  }

  send(s, obj) { if (s.conn.open) s.conn.sendJson(obj); }
  sendBin(s, buf) { if (s.conn.open) s.conn.sendBin(buf); }

  broadcast(objs, filter) {
    for (const s of this.conns.values()) {
      if (filter && !filter(s)) continue;
      if (Array.isArray(objs)) { for (const o of objs) this.send(s, o); }
      else this.send(s, objs);
    }
  }

  // ---------- handshake ----------
  onMessage(s, data, bin) {
    s.lastSeen = now();
    if (bin) return this.onBinary(s, data);

    let m;
    try { m = JSON.parse(data); } catch (_) { return; }
    if (!m || typeof m !== 'object') return;

    const t = m.t;

    // --- handshake ---
    if (t === 'hello' || t === 'resume') return this.doHello(s, m);

    // --- heartbeat ---
    if (t === 'po') return;

    // --- belum welcome: tolak ---
    if (!s.ready) { this.send(s, { t: 'authfail', text: 'Sessão inválida. Recarregue a página.' }); return; }

    // --- lobby umum ---
    switch (t) {
      case 'rooms': return this.sendRooms(s);
      case 'join': return this.doJoin(s, m);
      case 'create': return this.doCreate(s, m);
      case 'leave': return this.doLeave(s);
      case 'cfg': return this.doCfg(s, m);
      case 'start': return this.doStart(s);
      case 'chat': return this.doChat(s, m);
      case 'whisper': return this.doWhisper(s, m);
      case 'wchat': return this.doWorldChat(s, m);
      case 'touchcfg': s.touch = m.cfg; return;
      case 'plat': s.plat = m.plat || s.plat; return;
      case 'acflag': return;             // anti-cheat client — diterima, diabaikan
      case 'jserr': return;
      case 'ping': this.send(s, { t: 'pong', s: m.s }); return;
    }

    // --- game (lobby socket bawa event game juga) ---
    if (GAME_MSG.has(t)) return this.onGameMsg(s, m);

    // --- RPC (.call dengan req) ---
    if (typeof m.req === 'number') return this.onRpc(s, m);

    // --- sosial / suara ---
    if (SOCIAL_MSG.has(t)) return this.onSocial(s, m);

    // --- battle royale queue ---
    if (t === 'brq') return this.doBrq(s, m);
    if (t === 'pt_accept') return;
    if (t === 'rk') return this.doRanked(s, m);
  }

  onBinary(s, buf) {
    // battle WS cuma biner; kalau nyasar ke lobby, abaikan
  }

  // ---------- hello / welcome ----------
  doHello(s, m) {
    let nick = String(m.nick || m.login || '').trim().slice(0, 16);
    if (!nick) nick = 'Player' + Math.floor(1000 + Math.random() * 9000);
    s.nick = nick;
    s.plat = m.plat || 'pc';

    // resume: kalau sid/tok cocok, pakai akun yang sama
    let acct = null;
    if (m.t === 'resume' && m.sid) {
      const old = this.conns.get(m.sid);
      if (old && old.account) { acct = old.account; }
    }
    if (!acct) acct = this.db.createAccount(nick);
    s.account = acct;
    this.db.touch(acct);
    s.ready = true;

    // kick sesi lama dengan nick sama (dup)
    for (const o of this.conns.values()) {
      if (o !== s && o.account && o.account.id === acct.id && o.conn.open) {
        this.send(o, { t: 'dup', text: 'Sua conta entrou em outro lugar. Esta sessão foi encerrada.' });
        try { o.conn.close(4001, 'dup'); } catch (_) {}
      }
    }

    this.send(s, {
      t: 'welcome',
      sid: s.sid,
      tok: crypto.randomBytes(12).toString('hex'),
      bin: true,                 // WAJIB true — gate battle WS
      edge: '',
      acct: this.acctPayload(acct),
      accounts: true,
      room: s.room ? this.roomPayload(s.room) : null,
      online: this.conns.size,
      srv: 'am',
      build: '202611010500',
    });

    this.log('hello ' + nick + ' (' + s.sid.slice(0, 6) + ')');
    this.broadcast({ t: 'news', news: { s: now(), t: 'Bem-vindo ao clone!' } }, o => o !== s);
  }

  acctPayload(a) {
    return {
      id: a.id, nick: a.nick, cash: a.cash, gold: a.gold, coin: a.gold,
      level: a.level, xp: a.xp, rank: a.rank,
      kills: a.kills, deaths: a.deaths, wins: a.wins, matches: a.matches,
      headshots: a.headshots, playtime: a.playtime,
      owned: a.owned, equip: a.equip, staff: a.staff,
      clan: a.clan || null, vip: a.vip || null, friends: a.friends || [],
      news: a.news || { s: 0 },
    };
  }

  onClose(s) {
    s.alive = false;
    this.conns.delete(s.sid);
    if (s.room) {
      const r = this.rooms.get(s.room.id);
      if (r) {
        r.members = r.members.filter(x => x.id !== s.sid);
        this.roomTouch(r);
        if (r.battle) r.battle.playerLeft(s);
        if (!r.members.length && !r.seed) this.rooms.delete(r.id);
        else this.broadcastRoom(r);
      }
    }
    this.stats.online = this.conns.size;
    this.log('close ' + s.nick + ' (' + s.sid.slice(0, 6) + ')');
  }

  // ---------- rooms ----------
  createRoom(o) {
    o = o || {};
    const id = o.id || (this.nextRoomId++);
    // validasi mode & map — kalau nggak dikenal, fallback ke dm/Downtown
    // (client juga fallback ke J[0] kalau modeOf gagal, tapi lebih baik
    //  kita kirim yang benar dari awal)
    const mode = cfg.MODES[o.mode] ? o.mode : 'dm';
    const allowed = cfg.mapsFor(mode);
    const map = allowed.includes(o.map) ? o.map : cfg.MODES[mode].def;
    const r = {
      id,
      title: o.title || 'Sala ' + id,
      map,
      mode,
      kills: o.kills != null ? Math.max(1, Math.min(200, +o.kills || 0)) : cfg.MODES[mode].win,
      time: o.time != null ? Math.max(1, Math.min(60, +o.time || 0)) : cfg.MODES[mode].time,
      dif: o.dif || 1,
      pw: o.pw || '',
      lock: o.lock || {},
      obs: o.obs || {},
      joinBlock: o.joinBlock || false,
      balance: o.balance != null ? o.balance : true,
      ban: [], tag: null, state: 'Esperando',
      hostId: o.host || null,
      members: [], bots: o.bots ? o.bots.slice() : [0, 3],
      closed: false, sp: o.sp || '', fun: o.fun || '', event: o.event || null,
      cfr: false, reg: o.reg || 'am', seed: !!o.seed,
      players: o.players || 16,
    };
    this.rooms.set(id, r);
    return r;
  }

  roomPayload(r) {
    return {
      id: r.id, title: r.title, map: r.map, kills: r.kills, time: r.time,
      mode: r.mode, pw: r.pw, lock: r.lock, obs: r.obs, joinBlock: r.joinBlock,
      balance: r.balance, ban: r.ban, tag: r.tag, state: r.state,
      hostId: r.hostId, members: r.members, bots: r.bots, closed: r.closed,
      sp: r.sp, fun: r.fun, event: r.event, cfr: r.cfr, reg: r.reg,
      players: r.players, dif: r.dif,
    };
  }

  sendRooms(s) {
    const list = [...this.rooms.values()].map(r => this.roomPayload(r));
    this.send(s, { t: 'rooms', list, online: this.conns.size, reg: 'am', srv: 'am' });
  }

  broadcastRoom(r) {
    const p = this.roomPayload(r);
    for (const m of r.members) {
      const s = this.conns.get(m.id);
      if (s) this.send(s, { t: 'room', room: p });
    }
    // refresh daftar buat yang di lobby
    for (const s of this.conns.values()) {
      if (!s.room) this.sendRooms(s);
    }
  }

  roomTouch(r) { this.broadcastRoom(r); }

  doJoin(s, m) {
    const r = this.rooms.get(m.id);
    if (!r) { this.send(s, { t: 'error', text: 'Sala não existe mais.' }); return; }
    if (r.closed) { this.send(s, { t: 'error', text: 'Sala fechada.' }); return; }
    if (r.members.length >= r.players) { this.send(s, { t: 'error', text: 'Sala cheia.' }); return; }
    if (s.room) this.doLeave(s);

    const team = r.members.filter(x => x.team === 0).length <= r.members.filter(x => x.team === 1).length ? 0 : 1;
    s.room = r;
    s.entId = s.sid;
    if (!r.hostId) r.hostId = s.sid;
    r.members.push({
      id: s.sid, nick: s.nick, team, chara: s.account.chara || 0,
      weapon: s.account.weapon || 'm4a1', ready: false, lvl: s.account.level,
    });
    r.state = r.members.length > 1 || r.bots[0] + r.bots[1] > 0 ? 'Esperando' : 'Esperando';
    this.broadcastRoom(r);
    this.log(s.nick + ' entrou na sala ' + r.id);
  }

  doCreate(s, m) {
    const o = (m.room && typeof m.room === 'object') ? m.room : {};
    const r = this.createRoom({
      title: o.title || ('Sala de ' + s.nick),
      map: o.map,
      mode: o.mode,
      kills: o.kills, time: o.time, dif: o.dif,
      bots: o.bots || [0, 3], pw: o.pw, host: s.sid,
    });
    this.doJoin(s, { id: r.id });
  }

  doLeave(s) {
    const r = s.room;
    if (!r) return;
    r.members = r.members.filter(x => x.id !== s.sid);
    if (r.battle) r.battle.playerLeft(s);
    s.room = null; s.inGame = false; s.entId = null;
    if (!r.members.length && !r.seed) { this.rooms.delete(r.id); }
    else { if (r.hostId === s.sid) r.hostId = r.members[0] ? r.members[0].id : null; this.broadcastRoom(r); }
    this.sendRooms(s);
  }

  doCfg(s, m) {
    const r = s.room;
    if (!r) return;
    if (r.hostId !== s.sid) { this.send(s, { t: 'error', text: 'Só o host pode mudar.' }); return; }
    if (m.title !== undefined) r.title = String(m.title).slice(0, 40);
    if (m.mode !== undefined && cfg.MODES[m.mode]) {
      r.mode = m.mode;
      // map harus valid buat mode baru
      const allowed = cfg.mapsFor(r.mode);
      if (!allowed.includes(r.map)) r.map = cfg.MODES[r.mode].def;
      // batas kill/waktu balik ke default mode kalau di luar range
      if (r.kills > cfg.MODES[r.mode].win * 2) r.kills = cfg.MODES[r.mode].win;
    }
    if (m.map !== undefined) {
      const allowed = cfg.mapsFor(r.mode);
      if (allowed.includes(m.map)) r.map = m.map;
    }
    if (m.kills !== undefined) r.kills = Math.max(1, Math.min(200, +m.kills || 0));
    if (m.time !== undefined) r.time = Math.max(1, Math.min(60, +m.time || 0));
    if (m.bots !== undefined && Array.isArray(m.bots)) {
      r.bots = m.bots.slice(0, 2).map(x => Math.max(0, Math.min(7, +x || 0)));
    }
    if (m.dif !== undefined) r.dif = Math.max(1, Math.min(3, +m.dif || 1));
    this.broadcastRoom(r);
  }

  doStart(s) {
    const r = s.room;
    if (!r) return;
    if (r.hostId !== s.sid) { this.send(s, { t: 'error', text: 'Só o host pode iniciar.' }); return; }
    this.startMatch(r);
  }

  startMatch(r) {
    if (r.battle) { this.send({ t: 'error', text: 'Partida já começou.' }); return; }
    r.state = 'Jogando';

    const mode = cfg.MODES[r.mode] || cfg.MODES.dm;
    const battle = new Battle(this, r, mode);
    r.battle = battle;
    this.battles.set(battle.key, battle);

    // beri tahu semua anggota: navigasi ke /jogo
    // PENTING: tiap pemain dapat battleKey UNIK (battle.key + '.' + sid)
    // supaya /b2?k= bisa dipetakan ke pemain yang benar.
    // CATATAN: `start` DIKIRIM TANPA field `battle`. Kalau `battle` ada,
    // client nyimpen pbweb_battle dan pas buka /jogo flag `p` jadi true,
    // sehingga URL `srly` dilewatkan fungsi transform edge yang nggak
    // kita kontrol. Tanpa `battle`, URL absolut kita dipakai apa adanya.
    for (const m of r.members) {
      const s = this.conns.get(m.id);
      if (!s) continue;
      s.inGame = true;
      s.battleKey = battle.key + '.' + s.sid;
      this.battles.set(s.battleKey, battle);
      this.send(s, { t: 'start' });
    }

    // bot
    const bots = new Bots(battle, r.bots, r.dif);
    battle.setBots(bots);

    this.broadcastRoom(r);
    this.log('partida ' + battle.key.slice(0, 6) + ' mulai: ' + r.mode + ' / ' + r.map);
    return battle;
  }

  // ---------- chat ----------
  doChat(s, m) {
    const text = String(m.text || '').slice(0, 240);
    if (!text) return;
    const msg = { t: 'chat', nick: s.nick, text, tm: now(), mid: now() % 1000000 };
    if (s.room) { msg.team = m.team ? (this.memberTeam(s) || 0) : false; for (const mm of s.room.members) { const o = this.conns.get(mm.id); if (o) this.send(o, msg); } }
    else this.broadcast(msg);
    this.chatLog.push(msg);
    if (this.chatLog.length > 200) this.chatLog.shift();
  }

  doWorldChat(s, m) {
    const text = String(m.text || '').slice(0, 240);
    if (!text) return;
    this.worldChat.push({ nick: s.nick, text, tm: now() });
    if (this.worldChat.length > 100) this.worldChat.shift();
    this.broadcast({ t: 'wchat', nick: s.nick, text, tm: now() });
  }

  doWhisper(s, m) {
    const to = String(m.to || '');
    const text = String(m.text || '').slice(0, 240);
    const target = [...this.conns.values()].find(o => o.nick.toLowerCase() === to.toLowerCase());
    if (!target) { this.send(s, { t: 'error', text: 'Jogador offline: ' + to }); return; }
    this.send(target, { t: 'chat', nick: s.nick, text, tm: now(), whisper: 'from' });
    this.send(s, { t: 'chat', nick: to, text, tm: now(), whisper: 'to' });
  }

  memberTeam(s) {
    const r = s.room; if (!r) return null;
    const m = r.members.find(x => x.id === s.sid);
    return m ? m.team : null;
  }

  // ---------- matchmaking ----------
  doQuickPlay(s) {
    if (this.queue.includes(s)) return;
    this.queue.push(s);
    if (this.queue.length >= 2) {
      const a = this.queue.shift(), b = this.queue.shift();
      const r = this.createRoom({
        title: 'Quick Play', mode: 'elim', map: 'NPort',
        kills: 5, time: 3, bots: [3, 3], dif: 2, host: a.sid,
      });
      this.doJoin(a, { id: r.id });
      this.doJoin(b, { id: r.id });
      this.startMatch(r);
    }
  }

  doBrq(s, m) {
    const op = m.op || 'join';
    if (op === 'join') {
      if (!this.brQueue.includes(s)) this.brQueue.push(s);
      this.send(s, { t: 'brq', inq: true, n: this.brQueue.length, max: 40, min: 1, left: 0 });
      if (this.brQueue.length >= 8) {
        const ps = this.brQueue.splice(0, 8);
        const r = this.createRoom({
          title: 'BATTLE ROYALE', mode: 'royale', map: 'Wilderness',
          kills: 1, time: 10, bots: [0, 20], dif: 2, host: ps[0].sid,
        });
        for (const p of ps) this.doJoin(p, { id: r.id });
        this.startMatch(r);
      }
    } else {
      this.brQueue = this.brQueue.filter(x => x !== s);
      this.send(s, { t: 'brq', inq: false });
    }
  }

  doRanked(s, m) {
    this.send(s, { t: 'rk_q', inq: true, waited: 0, count: this.rankQueue.length });
    this.rankQueue.push(s);
    if (this.rankQueue.length >= 4) {
      const ps = this.rankQueue.splice(0, 4);
      const r = this.createRoom({
        title: 'RANKEADA', mode: 'bomb', map: 'Giran2',
        kills: 5, time: 3, bots: [0, 0], dif: 3, host: ps[0].sid, reg: 'rk',
      });
      for (const p of ps) this.doJoin(p, { id: r.id });
      this.startMatch(r);
    }
  }

  // ---------- RPC ----------
  onRpc(s, m) {
    const req = m.req;
    const done = (o) => this.send(s, Object.assign({ req, t: m.t }, o));
    const a = s.account;

    switch (m.t) {
      case 'acct': return done({ acct: this.acctPayload(a) });
      case 'equip': {
        const item = String(m.item || '');
        if (item) { a.equip[m.side ? ('Skin' + (m.side === 'red' ? 'Red' : 'Blue')) : 'Weapon'] = item; this.db.save(); }
        return done({ acct: this.acctPayload(a) });
      }
      case 'unequip': { delete a.equip[m.slot]; this.db.save(); return done({ acct: this.acctPayload(a) }); }
      case 'freq_ok': case 'freq_no': return done({ acct: this.acctPayload(a) });
      case 'friends': return done({ list: (a.friends || []).map(n => ({ nick: n, online: [...this.conns.values()].some(c => c.nick === n) })) });
      case 'dm_list': {
        const list = [];
        for (const [k, v] of this.dms) if (v.a === a.id || v.b === a.id) list.push({ peer: v.a === a.id ? v.nb : v.na, unread: v.unread || 0 });
        return done({ list, unread: list.reduce((x, y) => x + (y.unread || 0), 0) });
      }
      case 'dm_hist': {
        const k = [a.id, String(m.nick).toLowerCase()].sort().join('|');
        const d = this.dms.get(k);
        return done({ list: d ? d.msgs.slice(-50) : [] });
      }
      case 'grp_list': return done({ list: [...this.groups.values()] });
      case 'grp_new': {
        const g = { id: newId('g'), name: String(m.name || 'grupo').slice(0, 24), owner: a.id, members: [a.nick] };
        this.groups.set(g.id, g); return done({ gid: g.id });
      }
      case 'cf_top': return done({ list: [] });
      case 'cpay': return done({ pix: null });
      case 'pshop': return done({ bundles: [] });
      case 'pbuy': return done({ err: 'Loja premium desativada no clone.' });
      case 'den': return done({});
      case 'denlist': return done({ list: [], can: null });
      case 'denvote': return done({ res: 'ok' });
      case 'perfil_get': return done({ me: { nick: a.nick, paid: false } });
      case 'perfil_buy': return done({ err: 'Indisponível no clone.' });
      case 'perfil_cancel': return done({ me: {} });
      case 'perfil_send': return done({});
      case 'perfil_fila': return done({ fila: [] });
      case 'perfil_julgar': return done({});
      case 'vip_get': return done({ names: [], charas: [] });
      case 'vip_adm': return done({ err: 'Sem permissão.' });
      case 'vip_off': return done({ err: 'Sem permissão.' });
      case 'clan_accept': return done({ acct: this.acctPayload(a) });
      case 'rinv': return done({});
      default: return done({});
    }
  }

  // ---------- sosial / suara ----------
  onSocial(s, m) {
    const t = m.t;
    if (t === 'gvoa' || t === 'gvo') {
      // relay suara grup — teruskan ke anggota grup
      const g = this.groups.get(m.gid);
      if (g) for (const n of g.members) { const o = [...this.conns.values()].find(c => c.nick === n); if (o && o !== s) this.send(o, { t: 'gvo', gid: m.gid, from: s.sid, d: m.d, n: m.n }); }
      return;
    }
    if (t === 'grtc') {
      const to = this.conns.get(m.to);
      if (to) this.send(to, { t: 'grtc', gid: m.gid, from: s.sid, sdp: m.sdp, c: m.c });
      return;
    }
    if (t === 'gvo_leave') return;
  }

  // ---------- battle socket ----------
  // tiap pemain punya key unik: "<battleKey>.<sid>"
  attachBattle(conn, key) {
    const battle = this.battles.get(key);
    if (!battle) { conn.close(4003, 'bad key'); return null; }
    let sid = null;
    for (const s of this.conns.values()) {
      if (s.battleKey === key && s.conn.open) { sid = s.sid; break; }
    }
    if (!sid) { conn.close(4003, 'no session'); return null; }
    battle.attach(conn, sid);
    return conn;
  }

  // ---------- tick ----------
  tick() {
    for (const b of this.battles.values()) b.tick(TICK_MS / 1000);
    for (const s of this.conns.values()) {
      if (!s.alive) continue;
      if (now() - s.lastSeen > 120000) { try { s.conn.close(4000, 'timeout'); } catch (_) {} }
    }
  }

  snap() {
    for (const b of this.battles.values()) b.snap();
  }

  heartbeat() {
    const s = Math.floor(Math.random() * 1e9);
    for (const c of this.conns.values()) this.send(c, { t: 'pg', s });
    this.stats.online = this.conns.size;
  }

  // ---------- pesan dari battle ----------
  onGameMsg(s, m) {
    const b = this.battles.get(s.battleKey);
    if (!b) return;
    b.onClientMsg(s, m);
  }
}

const GAME_MSG = new Set([
  'ingame', 'watch', 'loaded', 'spawnme', 'leavegame', 'kcskip', 'ktake',
  'equip', 'heal', 'hit', 'fx', 'mobj', 'arm', 'disarm', 'touch', 'inp',
  'brjump', 'brland', 'brpick', 'brk', 'p2p', 'rtc', 'vo',
]);

const SOCIAL_MSG = new Set(['gvoa', 'gvo', 'grtc', 'gvo_leave', 'grtc_leave']);

module.exports = { Lobby };
