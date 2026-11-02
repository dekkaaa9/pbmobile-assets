// test_shop.js — tes shop, ekonomi, ranking, nick, notes, result.
// Zero-dep: WS client tangan sendiri. Nembak server LIVE (tunnel).
'use strict';
const crypto = require('crypto');
const tls = require('tls');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { DB } = require('../server/db');
const { Shop } = require('../server/shop');
const cfg = require('../server/config');

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
  // RPC: kirim {t, ...} + req, tunggu balikan dgn req sama
  call(o, ms = 10000) {
    return new Promise((res) => {
      const req = Math.floor(Math.random() * 1e9);
      this.send(Object.assign({ req }, o));
      const t0 = Date.now();
      const iv = setInterval(() => {
        for (const m of this.all) if (m.req === req) { clearInterval(iv); return res(m); }
        if (this.closed || Date.now() - t0 > ms) { clearInterval(iv); return res(null); }
      }, 50);
    });
  }
}

// ---------- harness ----------
let pass = 0, fail = 0;
const L = [];
function ok(c, m) { if (c) { pass++; L.push('  ok   ' + m); } else { fail++; L.push('  FAIL ' + m); } }
function sec(t) { L.push(''); L.push('=== ' + t + ' ==='); }

const HOST = process.argv[2] || 'lookup-preparation-represented-muze.trycloudflare.com';
const rnd = () => 's' + crypto.randomBytes(4).toString('hex');

async function login() {
  const ws = await new Ws(HOST, 443, '/ws').connect();
  const id = rnd();
  ws.send({ t: 'hello', login: id, pw: 'rahasia123', register: true, email: id + '@m.co', plat: 'pc', sts: 1, bin: 1 });
  const w = await new Promise((res) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      const x = ws.all.find(m => m.t === 'welcome');
      if (x) { clearInterval(iv); return res(x); }
      if (Date.now() - t0 > 10000) { clearInterval(iv); return res(null); }
    }, 50);
  });
  return { ws, w, id };
}

(async () => {
  L.push('target: wss://' + HOST + '/ws');

  // ================= 1. KATALOG (unit, lokal) =================
  sec('Katalog shop dari goods.json asli');
  const shop = new Shop(path.resolve(__dirname, '..', 'site', 'goods.json'));
  ok(Object.keys(shop.goods).length > 500, 'goods termuat: ' + Object.keys(shop.goods).length + ' item');
  ok(Object.keys(shop.sets).length > 0, 'sets termuat: ' + Object.keys(shop.sets).length);
  ok(shop._byOffer.size > 1500, 'indeks offer: ' + shop._byOffer.size);
  const anyCash = [...shop._byOffer.values()].find(o => o.cash > 0);
  const anyGold = [...shop._byOffer.values()].find(o => o.gold > 0);
  ok(!!anyCash, 'ada offer bayar CASH (GP): ' + JSON.stringify(anyCash));
  ok(!!anyGold, 'ada offer bayar GOLD (PB Coin): ' + JSON.stringify(anyGold));
  ok(anyCash.days > 0, 'offer CASH = sewa (' + anyCash.days + ' hari)');
  ok(anyGold.days === 0, 'offer GOLD = permanen');
  ok(shop.nameOf(anyCash.item).length > 0, 'nama item kebaca: ' + shop.nameOf(anyCash.item));
  ok(!!shop.slotOf(anyCash.item), 'slot item: ' + shop.slotOf(anyCash.item));
  const b = shop.bundles();
  ok(Array.isArray(b) && b.length > 0, 'bundles premium disusun: ' + b.length);
  ok(b.every(x => Array.isArray(x.items) && x.items.length && x.price > 0 && x.was > x.price), 'bundles punya items/price/was (was > price = diskon)');
  ok(b.every(x => x.items.some(i => shop.slotOf(i) !== 'item')), 'tiap bundles punya hero non-consumable');

  // ================= 2. BELI (end-to-end lewat WS) =================
  sec('Beli item pake CASH (GP)');
  const { ws, w, id } = await login();
  ok(!!w && !!w.acct, 'login -> welcome.acct');
  const cash0 = w.acct.cash, gold0 = w.acct.gold;
  ok(cash0 === 50000, 'CASH awal 50000 (dapat ' + cash0 + ')');
  ok(gold0 === 0, 'GOLD awal 0 (dapat ' + gold0 + ')');

  // ambil 1 offer CASH murah
  const cheap = [...shop._byOffer.values()].filter(o => o.cash > 0 && o.cash <= 2000).sort((x, y) => x.cash - y.cash)[0];
  ok(!!cheap, 'offer murah buat tes: ' + JSON.stringify(cheap));

  const rBuy = await ws.call({ t: 'buy', goods: cheap.g, cash: true });
  ok(!!rBuy && !!rBuy.acct, 'buy -> balik acct');
  ok(rBuy.acct.cash === cash0 - cheap.cash, 'CASH berkurang ' + cheap.cash + ' (' + cash0 + ' -> ' + rBuy.acct.cash + ')');
  ok(Object.prototype.hasOwnProperty.call(rBuy.acct.owned, cheap.item), 'item masuk owned: ' + cheap.item);
  ok(!!rBuy.acct.equip, 'equip kebaca');

  // beli gold padahal nggak punya -> harus ditolak
  const rGold = await ws.call({ t: 'buy', goods: anyGold.g, cash: false });
  ok(rGold && rGold.err && /GOLD insuficiente/i.test(rGold.err), 'beli GOLD tanpa saldo ditolak: ' + (rGold && rGold.err));

  // offer ngawur
  const rNf = await ws.call({ t: 'buy', goods: 999999999, cash: true });
  ok(rNf && rNf.err && /não encontrado/i.test(rNf.err), 'offer ngawur ditolak: ' + (rNf && rNf.err));

  // currency nggak cocok: offer CASH tapi minta bayar GOLD
  const rMix = await ws.call({ t: 'buy', goods: cheap.g, cash: false });
  ok(rMix && rMix.err && /GOLD/i.test(rMix.err), 'bayar offer CASH pake GOLD ditolak: ' + (rMix && rMix.err));

  // ================= 3. BELI SET =================
  sec('Beli set (bundel)');
  const setId = Object.keys(shop.sets).find(k => (shop.sets[k].cash || 0) <= 5000);
  ok(!!setId, 'set murah buat tes: ' + setId + ' (' + shop.sets[setId].cash + ' CASH)');
  const rSet = await ws.call({ t: 'buyset', set: setId, cash: true });
  ok(!!rSet && !!rSet.acct, 'buyset -> balik acct');
  ok(rSet.acct.cash === cash0 - cheap.cash - shop.sets[setId].cash,
    'CASH berkurang harga set (' + rSet.acct.cash + ')');
  const setItems = shop.sets[setId].items.map(x => String(x[0]));
  ok(setItems.every(i => Object.prototype.hasOwnProperty.call(rSet.acct.owned, i)),
    'semua item set masuk owned (' + setItems.length + ' item)');

  // ================= 4. EQUIP / UNEQUIP =================
  sec('Equip / unequip');
  const rEq = await ws.call({ t: 'equip', item: cheap.item });
  ok(!!rEq && !!rEq.acct, 'equip -> acct');
  ok(rEq.acct.equip && (rEq.acct.equip.Weapon === String(cheap.item) || rEq.acct.equip['1'] === String(cheap.item)),
    'senjata ke-equip: ' + JSON.stringify(rEq.acct.equip));
  const rUn = await ws.call({ t: 'unequip', slot: 'Weapon' });
  ok(!!rUn && !!rUn.acct, 'unequip -> acct');

  // ================= 5. PREMIUM SHOP =================
  sec('Loja premium (pshop)');
  const rPs = await ws.call({ t: 'pshop' });
  ok(!!rPs && Array.isArray(rPs.bundles), 'pshop -> bundles array');
  ok(rPs.bundles.length > 0, 'bundles nggak kosong (' + rPs.bundles.length + ')');
  ok(rPs.bundles.every(x => x.items && x.items.length && x.price > 0), 'bundles bentuk bener (items/price/was/tag)');
  const rPb = await ws.call({ t: 'pbuy', b: 0 });
  ok(rPb && (rPb.err || rPb.acct), 'pbuy dibalas (err GOLD atau sukses): ' + (rPb && (rPb.err || 'ok')));

  // ================= 6. RANKING =================
  sec('Ranking');
  const rCf = await ws.call({ t: 'cf_top' });
  ok(!!rCf && Array.isArray(rCf.list), 'cf_top -> list array');
  ok(rCf.list.every(x => typeof x.name === 'string' && typeof x.pontos === 'number'), 'cf_top entri punya name+pontos');
  const rRk = await ws.call({ t: 'rk_me' });
  ok(!!rRk && !!rRk.me, 'rk_me -> me');
  ok(rRk.me.tiers.length === 6, 'ladder 6 tier (Bronze..Mestre): ' + rRk.me.tiers.map(t => t[0]).join(','));
  ok(rRk.me.info && typeof rRk.me.info.tier === 'number' && typeof rRk.me.info.div === 'number', 'info.tier/div ada');
  ok(Array.isArray(rRk.top), 'rk_me.top array');
  ok(Array.isArray(rRk.me.rewards) && rRk.me.rewards.length === 6, 'rewards 6 tier');
  ok(typeof rRk.me.rp === 'number' && typeof rRk.me.matches === 'number', 'rp/matches angka');

  // ================= 7. NICK =================
  sec('Nick');
  const rNc = await ws.call({ t: 'nickcheck', nick: 'Nick Baru 123' });
  ok(!!rNc && !rNc.err && rNc.nick === 'Nick Baru 123', 'nickcheck ok: ' + (rNc && rNc.nick));
  const rNc2 = await ws.call({ t: 'nickcheck', nick: 'a' });
  ok(rNc2 && rNc2.err, 'nick kekurangan ditolak: ' + (rNc2 && rNc2.err));
  const rNc3 = await ws.call({ t: 'nickcheck', nick: 'bad!@#' });
  ok(rNc3 && rNc3.err, 'nick karakter aneh ditolak: ' + (rNc3 && rNc3.err));
  const rSn = await ws.call({ t: 'setnick', nick: 'Nick Baru 123' });
  ok(!!rSn && !!rSn.acct && rSn.acct.nick === 'Nick Baru 123', 'setnick -> nick berubah');

  // ================= 8. NOTES + BLOCKS + WHO + TITLES =================
  sec('Sosial');
  const rNt = await ws.call({ t: 'notes' });
  ok(!!rNt && Array.isArray(rNt.list), 'notes -> list array');
  const rBl = await ws.call({ t: 'block', nick: 'Seseorang' });
  ok(!!rBl && Array.isArray(rBl.list) && rBl.list.includes('Seseorang'), 'block -> list');
  const rUb = await ws.call({ t: 'unblock', nick: 'Seseorang' });
  ok(!!rUb && !rUb.list.includes('Seseorang'), 'unblock -> hilang dari list');
  const rWho = await ws.call({ t: 'who', nick: rSn.acct.nick });
  ok(!!rWho && !!rWho.profile && rWho.profile.nick === rSn.acct.nick, 'who -> profile');
  ok(typeof rWho.profile.kills === 'number' && typeof rWho.profile.matches === 'number', 'profile punya kills/matches');
  const rTg = await ws.call({ t: 'title_get' });
  ok(!!rTg && Array.isArray(rTg.list), 'title_get -> list');
  const rTe = await ws.call({ t: 'title_eq', title: 'Nggak Punya' });
  ok(rTe && rTe.err, 'equip title yang nggak dimiliki ditolak: ' + (rTe && rTe.err));

  // ================= 9. RESULT (progresi) =================
  sec('Resultado da partida (progresi)');
  const before = (await ws.call({ t: 'acct' })).acct;
  const rRes = await ws.call({
    t: 'result', mode: 'dm', win: 1, kills: 12, deaths: 4, heads: 5,
    assists: 2, missions: 1, bots: 0, secs: 300,
  });
  ok(!!rRes && !!rRes.result, 'result -> result payload');
  ok(typeof rRes.result.exp === 'number' && rRes.result.exp > 0, 'EXP didapat: +' + (rRes.result && rRes.result.exp));
  ok(typeof rRes.result.cash === 'number' && rRes.result.cash > 0, 'CASH didapat: +' + (rRes.result && rRes.result.cash));
  ok(typeof rRes.result.point === 'number' && rRes.result.point > 0, 'RP didapat (vitória): +' + (rRes.result && rRes.result.point));
  ok(rRes.acct.matches === before.matches + 1, 'matches +1 (' + before.matches + ' -> ' + rRes.acct.matches + ')');
  ok(rRes.acct.kills === before.kills + 12, 'kills +12');
  ok(rRes.acct.deaths === before.deaths + 4, 'deaths +4');
  ok(rRes.acct.headshots === before.headshots + 5, 'headshots +5');
  ok(rRes.acct.wins === before.wins + 1, 'wins +1');
  ok(rRes.acct.cash === before.cash + rRes.result.cash, 'CASH akun = sebelum + hadiah');
  ok(rRes.acct.rp === (before.rp || 0) + rRes.result.point, 'RP akun = sebelum + delta');
  ok(rRes.acct.xp === before.xp + rRes.result.exp, 'XP akun = sebelum + exp');

  // derrota -> RP turun
  const rpBeforeLoss = rRes.acct.rp;
  const rLoss = await ws.call({ t: 'result', mode: 'dm', win: 0, kills: 2, deaths: 9, heads: 0, assists: 0, missions: 0, bots: 0, secs: 200 });
  ok(rLoss.result.point < 0, 'derrota -> RP turun: ' + rLoss.result.point);
  ok(rLoss.acct.rp === rpBeforeLoss + rLoss.result.point, 'RP akun konsisten stlh derrota');
  ok(rLoss.acct.losses === (rRes.acct.losses || 0) + 1, 'losses +1');

  // treino -> EXP & CASH lebih kecil, RP nggak berubah
  const rpBeforeTreino = rLoss.acct.rp;
  const rTreino = await ws.call({ t: 'result', mode: 'dm', win: 1, kills: 12, deaths: 4, heads: 5, assists: 0, missions: 0, bots: 1, secs: 300, treino: 1 });
  ok(rTreino.result.exp < rRes.result.exp, 'treino EXP lebih kecil (' + rTreino.result.exp + ' < ' + rRes.result.exp + ')');
  ok(rTreino.result.point === 0, 'treino RP nggak berubah (0)');
  ok(rTreino.acct.rp === rpBeforeTreino, 'RP akun tetap stlh treino');

  // ================= 10. UNIT: sewa & expiry =================
  sec('Unit: sewa, expiry, sweep');
  const f = path.join(os.tmpdir(), 'pbshop_' + rnd() + '.json');
  const db = new DB(f);
  const acc = db.createAccount('Sewa' + rnd(), { login: 'x', pw: 'rahasia1', email: 'a@b.co' });
  const offerRent = [...shop._byOffer.values()].find(o => o.days > 0 && o.cash > 0);
  acc.cash = 100000;
  const rb = shop.buy(acc, offerRent.g, true);
  ok(rb.ok, 'beli sewa ' + offerRent.days + ' hari ok');
  ok(acc.owned[offerRent.item] > Date.now(), 'expiry di masa depan');
  ok(shop.has(acc, offerRent.item), 'has() = true selagi aktif');
  // paksa kedaluwarsa
  acc.owned[offerRent.item] = Date.now() - 1000;
  ok(!shop.has(acc, offerRent.item), 'has() = false stlh kedaluwarsa');
  const swept = shop.sweepExpired(acc);
  ok(swept === 1, 'sweepExpired hapus 1 item (dapat ' + swept + ')');
  ok(!Object.prototype.hasOwnProperty.call(acc.owned, offerRent.item), 'item hilang dari owned');
  // permanen
  const perm = [...shop._byOffer.values()].find(o => o.days === 0 && o.gold > 0);
  acc.gold = 100000;
  const rp2 = shop.buy(acc, perm.g, false);
  ok(rp2.ok && acc.owned[perm.item] === 0, 'permanen -> owned = 0 (bukan timestamp)');
  ok(shop.has(acc, perm.item), 'permanen has() = true');
  // perpanjang sewa: expiry maju, bukan mundur
  acc.owned[offerRent.item] = Date.now() + 5 * 86400000;
  const t0 = acc.owned[offerRent.item];
  shop.buy(acc, offerRent.g, true);
  ok(acc.owned[offerRent.item] > t0, 'sewa diulang -> expiry maju (' + t0 + ' -> ' + acc.owned[offerRent.item] + ')');
  // saldo nggak cukup
  acc.cash = 0;
  const rPoor = shop.buy(acc, offerRent.g, true);
  ok(rPoor.err && /insuficiente/i.test(rPoor.err), 'saldo kurang ditolak: ' + rPoor.err);
  try { fs.unlinkSync(f); } catch (_) {}

  // ================= 11. UNIT: rankFromRp =================
  sec('Unit: ladder ranking');
  ok(cfg.rankFromRp(0).name === 'Bronze' && cfg.rankFromRp(0).tier === 0, 'rp 0 -> Bronze tier 0');
  ok(cfg.rankFromRp(299).name === 'Bronze', 'rp 299 -> masih Bronze');
  ok(cfg.rankFromRp(300).name === 'Prata' && cfg.rankFromRp(300).tier === 1, 'rp 300 -> Prata');
  ok(cfg.rankFromRp(600).name === 'Ouro', 'rp 600 -> Ouro');
  ok(cfg.rankFromRp(900).name === 'Platina', 'rp 900 -> Platina');
  ok(cfg.rankFromRp(1200).name === 'Diamante', 'rp 1200 -> Diamante');
  ok(cfg.rankFromRp(1500).name === 'Mestre' && cfg.rankFromRp(1500).tier === 5, 'rp 1500 -> Mestre (top)');
  ok(cfg.rankFromRp(99999).name === 'Mestre', 'rp sangat tinggi -> tetap Mestre');
  ok(cfg.rankFromRp(0).div === 3, 'divisi masuk = III (div 3)');
  ok(cfg.rankFromRp(100).div === 2, 'rp 100 -> divisi II (div 2)');
  ok(cfg.rankFromRp(200).div === 1, 'rp 200 -> divisi I (div 1)');
  ok(cfg.rankFromRp(1500).div === 3, 'rp 1500 = masuk Mestre -> III (div 3)');
  ok(cfg.rankFromRp(1700).div === 0, 'Mestre max -> tanpa numeral (div 0)');
  ok(cfg.RANK_TIERS.length === 6, 'RANK_TIERS 6 entri');
  ok(cfg.rankRewards().length === 6, 'rankRewards 6 entri');

  ws.close();
  console.log(L.join('\n'));
  console.log('\n================ HASIL ================');
  console.log('PASS: ' + pass + '   FAIL: ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log(L.join('\n')); console.log('\nSUITE ERROR: ' + (e && e.stack || e)); process.exit(1); });
