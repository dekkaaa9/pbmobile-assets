'use strict';
// ============================================================
//  bots.js — musuh bot. Server-side, jadi yang nembak player
//  adalah server (kirim `hp` lalu `kill`). Player nembak bot
//  lewat `hit` biasa (client-authoritative).
// ============================================================

const { Ent } = require('./battle');

const WEAPONS = {
  rifle:   { dmg: 24, rate: 0.11, range: 90,  spread: 0.035, auto: true },
  smg:     { dmg: 18, rate: 0.07, range: 60,  spread: 0.05,  auto: true },
  sniper:  { dmg: 95, rate: 1.4,  range: 200, spread: 0.005, auto: false },
  shotgun: { dmg: 12, rate: 0.9,  range: 25,  spread: 0.09,  auto: false },
  pistol:  { dmg: 22, rate: 0.2,  range: 50,  spread: 0.04,  auto: false },
  knife:   { dmg: 55, rate: 0.5,  range: 3,   spread: 0.01,  auto: false },
};

class Bots {
  constructor(battle, counts, dif) {
    this.battle = battle;
    this.dif = dif || 1;
    this.list = [];
    const room = battle.room;
    const total = (counts && counts[0] || 0) + (counts && counts[1] || 0);
    const mode = room.mode;
    const names = ['Ghost', 'Falcon', 'Raven', 'Cobra', 'Tiger', 'Viper', 'Wolf', 'Hawk',
      'Sniper', 'Rush', 'Blaze', 'Storm', 'Frost', 'Iron', 'Shadow', 'Reaper'];

    for (let i = 0; i < total; i++) {
      const team = mode === 'dm' || mode === 'royale' ? 0 : (i < (counts[0] || 0) ? 0 : 1);
      const w = this.pickWeapon(mode, dif);
      const e = new Ent({
        id: 'bot' + i + '_' + Math.random().toString(36).slice(2, 7),
        nick: names[i % names.length] + (i >= names.length ? i : ''),
        team, bot: true, owned: null, w: w,
      });
      e._map = room.map;
      e.botW = w;
      e.botSkill = 0.25 + 0.18 * dif;      // peluang kena
      e.botAim = 0.3 + 0.2 * dif;          // ketepatan
      e.target = null;
      e.nextShot = 0;
      e.nextThink = 0;
      e.wander = [Math.random() * 40 - 20, Math.random() * 40 - 20];
      e.stuck = 0;
      this.list.push(e);
      battle.ents.set(e.id, e);
    }
  }

  pickWeapon(mode, dif) {
    if (mode === 'sniper') return 'sniper';
    if (mode === 'knife') return 'knife';
    if (mode === 'royale') return ['rifle', 'smg', 'shotgun'][Math.floor(Math.random() * 3)];
    const pool = dif >= 3 ? ['rifle', 'sniper', 'smg'] : ['rifle', 'smg', 'pistol', 'shotgun'];
    return pool[Math.floor(Math.random() * pool.length)];
  }

  spawn() {
    for (const e of this.list) e.spawn();
  }

  // ---------- AI ----------
  tick(dt, battle) {
    const t = Date.now();
    for (const e of this.list) {
      if (e.dead) continue;

      // pilih target tiap 0.5 s
      if (t > e.nextThink) {
        e.nextThink = t + 400 + Math.random() * 300;
        e.target = this.findTarget(e, battle);
      }
      const tgt = e.target;
      if (!tgt || tgt.dead) { this.wander(e, dt); continue; }

      const dx = tgt.p[0] - e.p[0], dy = tgt.p[1] - e.p[1], dz = tgt.p[2] - e.p[2];
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const w = WEAPONS[e.botW] || WEAPONS.rifle;

      // hadap ke target
      const wantYaw = Math.atan2(-dx, -dz);
      e.y = approachAngle(e.y, wantYaw, dt * 6);
      e.pi = clamp(Math.atan2(dy, Math.max(1, Math.sqrt(dx * dx + dz * dz))), -1.4, 1.4);

      // gerak: maju kalau jauh, mundur/menghindar kalau terlalu dekat
      let mx = 0, mz = 0;
      if (dist > w.range * 0.7) { mx = dx / dist; mz = dz / dist; }
      else if (dist < w.range * 0.3) { mx = -dx / dist; mz = -dz / dist; }
      else {
        // strafe
        mx = -dz / dist; mz = dx / dist;
        if (Math.random() < 0.01) e.strafeSign = -e.strafeSign || 1;
        mx *= (e.strafeSign || 1); mz *= (e.strafeSign || 1);
      }
      const spd = 6.5;
      e.p[0] += mx * spd * dt;
      e.p[2] += mz * spd * dt;
      e.mv = [mx * spd, mz * spd];
      e.g = (Math.random() < 0.02) ? 1 : 0;

      // tembak
      if (dist < w.range && t > e.nextShot) {
        e.nextShot = t + w.rate * 1000 * (1.4 - 0.3 * this.dif);
        if (Math.random() < e.botSkill) {
          const head = Math.random() < 0.12 + 0.04 * this.dif;
          const dmg = w.dmg * (head ? 6 : 1.2) * (0.75 + Math.random() * 0.5);
          this.shoot(battle, e, tgt, Math.round(dmg * 100) / 100, head);
        }
        // suara/fx tembakan biar client render
        // Handler `fx` remote butuh e.o (origin) & e.d (arah) buat k:"shot".
        // Kalau nggak ada, `new Vector3().fromArray(undefined)` lempar
        // TypeError di client -> game berhenti.
        const tdx = tgt.p[0] - e.p[0], tdy = tgt.p[1] - e.p[1], tdz = tgt.p[2] - e.p[2];
        const tl = Math.sqrt(tdx * tdx + tdy * tdy + tdz * tdz) || 1;
        battle.sendAll({
          t: 'fx', k: 'shot', id: e.id, w: e.botW,
          o: e.p.slice(), d: [tdx / tl, tdy / tl, tdz / tl],
          ts: Date.now(), from: e.id,
        });
      }
    }
  }

  findTarget(e, battle) {
    let best = null, bd = 1e9;
    for (const o of battle.ents.values()) {
      if (o === e || o.dead) continue;
      if (battle.mode.teams && o.team === e.team) continue;
      if (o.bot && !battle.room.seed && Math.random() < 0.5) continue;
      const d = (o.p[0] - e.p[0]) ** 2 + (o.p[2] - e.p[2]) ** 2;
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  wander(e, dt) {
    if (Math.random() < 0.01) e.wander = [Math.random() * 60 - 30, Math.random() * 60 - 30];
    const dx = e.wander[0] - e.p[0], dz = e.wander[1] - e.p[2];
    const d = Math.sqrt(dx * dx + dz * dz) || 1;
    e.p[0] += (dx / d) * 3 * dt;
    e.p[2] += (dz / d) * 3 * dt;
    e.mv = [(dx / d) * 3, (dz / d) * 3];
    e.y = approachAngle(e.y, Math.atan2(-dx, -dz), dt * 3);
  }

  // bot nembak player -> server kirim hp lalu kill
  shoot(battle, bot, target, dmg, head) {
    if (target.bot) {
      // bot vs bot: kurangi hp langsung
      target.hp -= dmg;
      if (target.hp <= 0) {
        target.dead = true; target.hp = 0;
        bot.kills += 1;
        if (battle.mode.teams) battle.score[bot.team] = (battle.score[bot.team] || 0) + 1;
      }
      return;
    }
    const s = target.owned ? battle.lobby.conns.get(target.owned) : null;
    if (!s) return;
    target.hp -= dmg;
    battle.lobby.send(s, { t: 'hp', id: target.id, hp: Math.max(0, target.hp), helm: 0, from: bot.id });
    if (target.hp <= 0) battle.kill(target, bot, head, { w: bot.botW });
  }
}

function approachAngle(a, b, step) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d > step) d = step;
  if (d < -step) d = -step;
  return a + d;
}
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

module.exports = { Bots, WEAPONS };
