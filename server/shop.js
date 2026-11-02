'use strict';
// ============================================================
//  shop.js — katalog + ekonomi, dibaca dari goods.json ASLI
//  (source: "Shop.dat" di pbmobile.app).
//
//  Bentuk data (dari client.js `goodsOf`):
//    goods[itemId] = [[offerId, days, gold, cash, mark], ...]
//      days = 0 -> permanen; 1/3/30 -> sewa
//      gold = harga currency premium (PB Coin)
//      cash = harga GP (currency gratisan)
//    sets[setId] = {items:[[itemId,days],...], gold, cash, mark, name}
//    slot[itemId] = nomor slot (1 = senjata utama, 2..5 = kit, dst)
//    name[itemId] = nama tampilan
//
//  Kontrak RPC (dari client.js):
//    {t:"buy",    goods:<offerId>, cash:<bool>, to?:<nick>} -> {acct} | {err}
//    {t:"buyset", set:<setId>,     cash:<bool>}             -> {acct} | {err}
//    {t:"pshop"}                                           -> {bundles:[...]}
// ============================================================

const fs = require('fs');
const path = require('path');

const DAY = 86400000;

class Shop {
  constructor(file) {
    this.file = file;
    this.goods = {}; this.sets = {}; this.slot = {}; this.name = {}; this.added = {};
    this._byOffer = new Map();   // offerId -> {item, days, gold, cash, mark}
    this.version = 0;
    this._load();
  }

  _load() {
    try {
      const j = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.goods = j.goods || {};
      this.sets = j.sets || {};
      this.slot = j.slot || {};
      this.name = j.name || {};
      this.added = j.added || {};
      this.version = j.version || 0;
    } catch (e) {
      console.warn('[shop] gagal baca ' + this.file + ':', e.message);
      return;
    }
    // indeks offer -> item, biar `buy` O(1). `g` = offerId (dikirim client
    // sebagai `goods`), jadi entri ini self-describing.
    for (const item of Object.keys(this.goods)) {
      for (const o of this.goods[item]) {
        if (!Array.isArray(o) || o.length < 4) continue;
        this._byOffer.set(String(o[0]), {
          g: o[0], item, days: o[1] | 0, gold: o[2] | 0, cash: o[3] | 0, mark: o[4] | 0,
        });
      }
    }
  }

  // ---------- lookup ----------
  offers(itemId) {
    return (this.goods[String(itemId)] || []).map(o => ({
      g: o[0], days: o[1] | 0, gold: o[2] | 0, cash: o[3] | 0, mark: o[4] | 0,
    }));
  }
  offer(offerId) { return this._byOffer.get(String(offerId)) || null; }
  set(setId) { return this.sets[String(setId)] || null; }
  nameOf(itemId) { return this.name[String(itemId)] || ('Item ' + itemId); }
  slotOf(itemId) { return this.slot[String(itemId)] || '1'; }
  addedAt(itemId) { return this.added[String(itemId)] || 0; }

  // item permanen (days=0) yang harganya gold — bahan loja premium
  permanentGold(limit) {
    const out = [];
    for (const item of Object.keys(this.goods)) {
      for (const o of this.goods[item]) {
        if ((o[1] | 0) === 0 && (o[2] | 0) > 0) { out.push({ item, g: o[0], gold: o[2] | 0 }); break; }
      }
    }
    return out.slice(0, limit || 400);
  }

  // ---------- ekonomi ----------
  /**
   * Beli 1 offer. `useCash` true = bayar GP (acct.cash), false = PB Coin (acct.gold).
   * Return {ok:true, item, days} atau {err:"..."}.
   */
  buy(acct, offerId, useCash) {
    const o = this.offer(offerId);
    if (!o) return { err: 'Item não encontrado na loja.' };

    // harga harus cocok sama currency yang dipakai client
    if (useCash) {
      if (!o.cash) return { err: 'Este item não é vendido em CASH.' };
      if ((acct.cash || 0) < o.cash) return { err: 'CASH insuficiente.' };
      acct.cash -= o.cash;
    } else {
      if (!o.gold) return { err: 'Este item não é vendido em GOLD.' };
      if ((acct.gold || 0) < o.gold) return { err: 'GOLD insuficiente.' };
      acct.gold -= o.gold;
    }

    const until = this._grant(acct, o.item, o.days);
    return { ok: true, item: o.item, days: o.days, until };
  }

  /** Beli 1 set (bundel beberapa item sekaligus). */
  buySet(acct, setId, useCash) {
    const s = this.set(setId);
    if (!s) return { err: 'Conjunto não encontrado.' };
    if (useCash) {
      if (!s.cash) return { err: 'Este conjunto não é vendido em CASH.' };
      if ((acct.cash || 0) < s.cash) return { err: 'CASH insuficiente.' };
      acct.cash -= s.cash;
    } else {
      if (!s.gold) return { err: 'Este conjunto não é vendido em GOLD.' };
      if ((acct.gold || 0) < s.gold) return { err: 'GOLD insuficiente.' };
      acct.gold -= s.gold;
    }
    const got = [];
    for (const [item, days] of (s.items || [])) {
      const until = this._grant(acct, item, days | 0);
      got.push({ item, days: days | 0, until });
    }
    return { ok: true, set: setId, items: got };
  }

  /**
   * Kasih item ke akun. `days` 0 = permanen.
   * Sewa yang diulang diperpanjang dari expiry yang paling jauh.
   * Return expiry (0 = permanen).
   */
  _grant(acct, itemId, days) {
    const cur = acct.owned[String(itemId)];
    const curUntil = (typeof cur === 'number' ? cur : 0);
    if (!days) { acct.owned[String(itemId)] = 0; return 0; }        // permanen
    const base = Math.max(Date.now(), curUntil > Date.now() ? curUntil : 0);
    const until = base + days * DAY;
    acct.owned[String(itemId)] = until;
    return until;
  }

  /** Hapus item yang sewanya udah kedaluwarsa. Return jumlah yang dihapus. */
  sweepExpired(acct) {
    const now = Date.now();
    let n = 0;
    for (const k of Object.keys(acct.owned || {})) {
      const v = acct.owned[k];
      if (typeof v === 'number' && v > 0 && v <= now) { delete acct.owned[k]; n++; }
    }
    return n;
  }

  /** Masih punya item ini (dan belum kedaluwarsa)? */
  has(acct, itemId) {
    const v = (acct.owned || {})[String(itemId)];
    if (v === undefined) return false;
    if (typeof v === 'number' && v > 0 && v <= Date.now()) return false;
    return true;
  }

  // ---------- loja premium (bundles) ----------
  /**
   * Bundel buat `pshop`. Client (premiumVitrine) baca:
   *   b.items[], b.was, b.price, b.tag, b.crate
   *   dan butuh hero item yang slot-nya BUKAN "item".
   * Disusun dari offer gold permanen asli di goods.json.
   */
  bundles() {
    const pool = this.permanentGold(400);
    if (!pool.length) return [];
    const out = [];
    const push = (tag, items, disc) => {
      const heroes = items.filter(x => this.slotOf(x.item) !== 'item');
      if (!heroes.length) return;
      const price = items.reduce((s, x) => s + x.gold, 0);
      const was = Math.round(price / (1 - disc));
      out.push({ items: items.map(x => x.item), price, was, tag, crate: false });
    };
    // kelompok per slot supaya bundelnya masuk akal (senjata utama, sekunder, dll)
    const bySlot = new Map();
    for (const p of pool) {
      const sl = this.slotOf(p.item);
      if (!bySlot.has(sl)) bySlot.set(sl, []);
      bySlot.get(sl).push(p);
    }
    let i = 0;
    for (const [, list] of bySlot) {
      if (out.length >= 8) break;
      const pick = list.slice(0, 3);
      if (pick.length < 2) continue;
      push(['LANÇAMENTO', 'NOVO', 'OFERTA', 'PACOTE'][i++ % 4], pick, 0.15);
    }
    return out;
  }
}

function loadShop(siteDir) {
  const f = path.join(siteDir, 'goods.json');
  return new Shop(f);
}

module.exports = { Shop, loadShop };
