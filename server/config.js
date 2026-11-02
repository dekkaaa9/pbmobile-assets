'use strict';
// ============================================================
//  config.js — konstanta game, dibaca dari bundle.js sumber.
//  Jangan diarang angka-nya: client pakai nilai yang sama persis.
// ============================================================

const fs = require('fs');
const path = require('path');

// --- damage rate per body part (bundle.js: `We`) ---
const DMG_RATE = { head: 6, body: 1.2, arm: 0.85, hand: 0.6, leg: 0.85, foot: 0.6 };

// --- setelan default client (bundle.js: `oe`) ---
const DEFAULT_SETTINGS = {
  crosshair: 0, hitEffect: false, fov: 70, sens: 0.5, invert: false,
  blood: true, bgmOn: true, bgm: 60, sfxOn: true, sfx: 100,
  allyName: true, minimap: 0, bulletSmoke: true, bulletTrace: true,
  terrainFx: true, quality: 'auto', fpsCap: 0,
  voiceOn: true, volVoice: 100, voiceKey: 'KeyN', binds: null,
};

// --- rumus damage (bundle.js `Ve`) ---
// part = t.part || (t.head ? "head" : "body")
// rate = (chara.cat.dmgRate || We)[part] || 1
// dmg  = head ? rate : rate * max(0, 1 + def[part])
function calcDamage(weaponPower, hit, dmgRate, def) {
  const part = hit.part || (hit.head ? 'head' : 'body');
  const rate = (dmgRate || DMG_RATE)[part] || 1;
  let dmg = part === 'head' ? rate : rate * Math.max(0, 1 + (def && def[part] || 0));
  dmg = dmg * (weaponPower || 1);
  if (dmg > 0 && dmg < 1) dmg = 1;
  return Math.round(dmg * 100) / 100;
}

// --- rumus recoil (bundle.js) ---
function calcRecoil(rec, v, yaw, vF, weaponReact, rand) {
  const nv = Math.min(v + rec.vA * vF * (1 + 0.01 * weaponReact), rec.vMax);
  let h = (2 * rand() - 1) * rec.hA * hF * (1 + 0.01 * weaponReact);
  return { v: nv, h };
}

// --- mode permainan (TABEL ASLI dari bundle.js) ---
// `win` = batas kill, `time` = MENIT (client: timeLimit = 60 * time),
// `rounds` = mode berbasis ronde, `lockP` = wajib lock player,
// `teams` = mode berbasis tim (dipakai server buat scoring & bot).
const MODES = {
  dm:       { name: 'Deathmatch',     play: 'dm',       teams: false, win: 100, time: 10, rounds: false, lockP: true,  maps: null,                                    def: 'NPort' },
  bomb:     { name: 'Bomb',           play: 'bomb',     teams: true,  win: 5,   time: 3,  rounds: true,  lockP: true,  maps: ['Giran2', 'Breakdown'],                def: 'Downtown' },
  destroy:  { name: 'Destroy',        play: 'destroy',  teams: true,  win: 3,   time: 3,  rounds: true,  lockP: true,  maps: ['Giran2', 'Breakdown'],                def: 'Giran2' },
  elim:     { name: 'Eliminate',      play: 'elim',     teams: true,  win: 5,   time: 3,  rounds: true,  lockP: true,  maps: null,                                    def: 'NPort' },
  defense:  { name: 'Defense',        play: 'defense',  teams: true,  win: 3,   time: 3,  rounds: true,  lockP: true,  maps: ['BlackPanther'],                       def: 'BlackPanther' },
  royale:   { name: 'Battle Royale',  play: 'royale',   teams: false, win: 1,   time: 10, rounds: false, lockP: true,  maps: null,                                    def: 'Wilderness' },
  escape:   { name: 'Escape',         play: 'escape',   teams: true,  win: 100, time: 3,  rounds: false, lockP: true,  maps: ['BreedingNest', 'D_BreakDown', 'D_Uptown'], def: 'BreedingNest' },
  tutorial: { name: 'Tutorial',       play: 'tutorial', teams: false, win: 100, time: 10, rounds: false, lockP: false, maps: ['Tutorial'],                           def: 'Tutorial' },
  cross:    { name: 'Cross-Counter',  play: 'cross',    teams: false, win: 100, time: 10, rounds: false, lockP: false, maps: ['NPort'],                              def: 'NPort' },
  extort:   { name: 'Extortion',      play: 'extort',   teams: true,  win: 3,   time: 10, rounds: true,  lockP: false, maps: ['C_Sandstorm'],                        def: 'C_Sandstorm' },
  gungame:  { name: 'Gun Game',       play: 'gungame',  teams: false, win: 16,  time: 10, rounds: false, lockP: false, maps: null,                                    def: 'Crackdown' },
  kconf:    { name: 'Kill Confirmed', play: 'kconf',    teams: false, win: 50,  time: 10, rounds: false, lockP: false, maps: null,                                    def: 'NPort' },
  dom:      { name: 'Dominação',     play: 'dom',      teams: true,  win: 100, time: 10, rounds: false, lockP: false, maps: ['Library', 'TinyTown'],                def: 'Library' },
  zombie:   { name: 'Infectado',      play: 'zombie',   teams: true,  win: 5,   time: 3,  rounds: true,  lockP: false, maps: null,                                    def: 'Downtown' },
};

// --- peta valid (dari array map bundle.js) ---
const MAPS = [
  'BlackPanther', 'Blowcity', 'Breakdown', 'BreedingNest', 'BurningHall', 'C_Sandstorm',
  'CargoPort', 'Construction', 'Crackdown', 'DSquad', 'D_BreakDown', 'D_Uptown',
  'DesertCamp', 'Downtown', 'Downtown2', 'Giran2', 'Helispot', 'Historic_Site',
  'Hospital', 'Junkyard', 'Kickpoint', 'Library', 'Luxville', 'MachuPichu', 'Metro',
  'NPort', 'NStation', 'Outpost', 'Provence', 'PumpkinHollow', 'RushHour', 'SafeHouse',
  'SandStorm', 'Sentrybase', 'StillRaid', 'Stormtube', 'TinyTown', 'Tutorial',
  'TwoTowers', 'Under23', 'Uptown', 'Wilderness',
];

// map yang boleh dipakai per mode (null = semua)
function mapsFor(modeId) {
  const m = MODES[modeId];
  if (!m || !m.maps) return MAPS;
  return m.maps.filter(x => MAPS.includes(x));
}

// ---- level / xp ----
function levelFromXp(xp) {
  // sederhana: level n butuh 1000 * n xp
  let lvl = 1, need = 1000;
  while (xp >= need && lvl < 100) { xp -= need; lvl++; need = Math.floor(need * 1.15); }
  return lvl;
}

// ---- skema + URL battle WS ----
// Skema koneksi: browser cuma kirim `wss://` dari halaman https, jadi
// header Origin adalah penanda paling reliable. Fallback ke
// x-forwarded-proto (Cloudflare/nginx) lalu socket terenkripsi.
function isSecure(req) {
  if (!req || !req.headers) return false;
  const h = req.headers;
  if (h.origin && /^https:/i.test(h.origin)) return true;
  if (h['x-forwarded-proto'] && /^https$/i.test(String(h['x-forwarded-proto']).split(',')[0].trim())) return true;
  if (h['x-forwarded-ssl'] && /^on$/i.test(String(h['x-forwarded-ssl']))) return true;
  return !!(req.socket && req.socket.encrypted);
}

// URL absolut battle WS buat pesan `srly`.
// Sengaja ABSOLUT: di net.js, kalau `u` mulai dengan `wss://` maka dipakai
// langsung tanpa lewat r() (yang susah ditebak). Kita juga nggak pernah
// kirim `battle` di pesan `start`, jadi flag `p` di client tetap false dan
// URL ini dipakai apa adanya.
function battleUrl(s, path) {
  const host = s.host || 'localhost';
  return (s.secure ? 'wss://' : 'ws://') + host + path;
}

// --- rank ladder ---
// Dari bundle.js `rkEmblem`: 6 tier (indeks 0-5, tabel warna `xe`) dan
// 4 divisi -> `["", "I", "II", "III"][div]`. Dari client.js `rkNext`:
// 100 poin = 1 divisi, tier teratas = "Mestre".
//   div 3 = III (divisi masuk) | 2 = II | 1 = I | 0 = tanpa numeral (max)
// Warna tier (bundle.js `xe` + client.js `o[]` di showRanked):
const RANK_TIERS = [
  { name: 'Bronze',   pts: 0,    color: '#e6a46a' },
  { name: 'Prata',    pts: 300,  color: '#e6ecf2' },
  { name: 'Ouro',     pts: 600,  color: '#ffd76a' },
  { name: 'Platina',  pts: 900,  color: '#8ff0e2' },
  { name: 'Diamante', pts: 1200, color: '#a8c8ff' },
  { name: 'Mestre',   pts: 1500, color: '#e2a6ff' },
];
const RANK_DIV_PTS = 100;          // poin per divisi (dari rkNext)
const RANK_LADDER = RANK_TIERS.map(t => t.name);

/** tier+divisi dari poin ranking. */
function rankFromRp(rp) {
  rp = Math.max(0, rp | 0);
  let ti = 0;
  for (let i = 0; i < RANK_TIERS.length; i++) if (rp >= RANK_TIERS[i].pts) ti = i;
  const t = RANK_TIERS[ti];
  const nextTi = RANK_TIERS[ti + 1] || null;
  const over = rp - t.pts;
  // 0-99 -> III(3), 100-199 -> II(2), 200+ -> I(1); maxed di tier -> 0
  let div = 3 - Math.min(2, Math.floor(over / RANK_DIV_PTS));
  if (!nextTi && over >= 200) div = 0;
  return {
    tier: ti, div, name: t.name, color: t.color,
    base: t.pts, next: nextTi ? nextTi.pts : 0, rp,
  };
}

/** Hadiah per tier buat `rk_me` ([[tierName, kind, itemId, days], ...]). */
function rankRewards() {
  return [
    ['Bronze', 'arma', 'k2', 0],
    ['Prata', 'arma', 'k5', 0],
    ['Ouro', 'arma', 'm7', 0],
    ['Platina', 'beret', '214004', 30],
    ['Diamante', 'arma', 'k400', 0],
    ['Mestre', 'beret', '301043', 0],
  ];
}

// ---- muat weapons.json (6.109 senjata) ----
function loadWeapons() {
  const p = path.resolve(__dirname, '..', 'site', 'static', 'game', 'weapons.json');
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    const arr = Array.isArray(j) ? j : (j.WEAPONS || j.weapons || Object.values(j)[0]);
    if (!Array.isArray(arr)) throw new Error('format tak dikenal');
    return arr;
  } catch (e) {
    console.warn('[config] weapons.json gagal dimuat: ' + e.message);
    return [];
  }
}

function loadWeaponAnims() {
  const p = path.resolve(__dirname, '..', 'site', 'static', 'game', 'weapon_anims.json');
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return {}; }
}

function loadCharas() {
  const p = path.resolve(__dirname, '..', 'site', 'static', 'game', 'charas.json');
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return []; }
}

module.exports = {
  DMG_RATE, DEFAULT_SETTINGS, MODES, MAPS, RANK_LADDER, RANK_TIERS, mapsFor,
  calcDamage, calcRecoil, levelFromXp, isSecure, battleUrl,
  rankFromRp, rankRewards, loadWeapons, loadWeaponAnims, loadCharas,
};
