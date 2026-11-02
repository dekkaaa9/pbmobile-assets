# PROTOKOL PB Mobile — lobby + battle

Dokumen ini memetakan **kontrak server**: apa yang client kirim, apa yang server
harus balas. Semua dibaca dari `site/static/game/net.js` (sumber kebenaran) dan
`bundle.js`. Ini yang lu butuh buat nulis server clone — bukan kode/aset client
(sudah 100% ada).

---

## 1. Koneksi

### Lobby WS
```js
// net.js
const url = "https:" === location.protocol
  ? "wss://" + location.host + "/ws"          // produksi
  : "ws://" + location.hostname + ":" + (netport || 8766);   // dev lokal
```
- Override manual: `localStorage.pbweb_edge` (harus cocok `/^wss:\/\/[\w.-]+\/ws$/`)
- Redirect zona waktu Asia/Jakarta/Pontianak/Makassar/Jayapura → `sgd`/`jkd.pbmobile.app`
- `binaryType = "arraybuffer"`

### Battle WS
```js
// net.js — fungsi O()
new WebSocket(
  (/^wss:\/\//.test(t.u) ? t.u : r() + t.u) + "?k=" + encodeURIComponent(t.k)
);
e.binaryType = "arraybuffer";
```
- `t = {u, k}` — **url dan key dua-duanya datang dari SERVER**, bukan dari client
- Reconnect: maks 8×, backoff `1500 * n` ms, **skip** kalau close code `4001`/`4003`
- Gate: `O()` langsung `return` kalau `!v` — dan `v = !!a.bin` dari pesan `welcome`.
  **Jadi kalau server nggak kirim `bin:true` di `welcome`, battle WS nggak pernah dibuat.**

---

## 2. Handshake lobby (client → server)

Pesan pertama, dikirim di `onopen`:

```js
{
  t:     sid ? "resume" : "hello",
  sid:   sessionStorage.pbweb_sid,          // null pada koneksi pertama
  tok:   sessionStorage.pbweb_tok,          // null pada koneksi pertama
  nick:  login || nick,
  plat:  "pc" | "mobile",                   // dari UA + pointer:coarse + touch
  cross: localStorage.pbweb_cross === "1",
  dev:   <info device>,
  fp:    <fingerprint>,
  sts:   1,
  bin:   1,                                  // client dukung frame biner
  bk:    <backup key dari pbweb_battle>      // opsional
  ...i                                        // field tambahan dari pemanggil
}
```

`resume` dipakai kalau `pbweb_sid` sudah ada di sessionStorage (reconnect).

### 2b. Akun — DAFTAR / MASUK

Modal login (`client.js`, `loginModal(e)` dengan `e` = mode register) mengirim
lewat `connect()` → `NETC.connect()` → field di-spread ke pesan `hello`:

```js
// DAFTAR (tombol CADASTRAR)
{ t:"hello", login:"<id>", pw:"<senha>", register:true, email:"<a@b.co>",
  ref, src, ts:"", nick:"<id>", plat, sts:1, bin:1 }

// MASUK (tombol ENTRAR)
{ t:"hello", login:"<id>", pw:"<senha>", nick:"<id>", plat, sts:1, bin:1 }
```

Batasan input (dari HTML modal): `lgId` maxlength **16**, `lgPw` maxlength **16**,
`lgEm` maxlength **80**. Client sudah validasi email + `pw === pw2`; server
validasi ulang karena client bisa dipalsukan.

**Aturan server (`lobby.js` `doHello`):**

| Jalur | Kondisi | Hasil |
|---|---|---|
| `resume` + `sid`/`tok` cocok | sesi masih ada, atau `tok` ada di `db.sessions` | `welcome` (nggak logout) |
| `register:true` | ID 3–16 char `[A-Za-z0-9_.-]`, senha 4–16, email valid, ID belum dipakai | akun baru + `welcome` |
| `register:true` | ID sudah ada | `authfail` "Este ID já está em uso. Escolha outro." |
| login | ID ada & `pw` cocok | `welcome` |
| login | ID ada & `pw` beda | `authfail` "Senha incorreta." |
| login | ID nggak ada | `authfail` "ID não encontrado. Clique em \"Cadastre-se grátis\"." |
| login | akun **warisan** (ada di DB tapi `pw` kosong) | **adopsi**: `pw` di-set, lanjut `welcome` |
| tanpa `login` sama sekali | — | `authfail` "Digite seu ID." |

**Kenapa `authfail` dan bukan error HTTP:** di `net.js`,

```js
if ("authfail" === a.t) { clearTimeout(k); t.close();
  return u(Object.assign(new Error(a.text), { auth: !0 })) }   // tolak promise
```

`connect()` di `client.js` menangkapnya: `catch(e){ if (e.auth) return e.message }`,
dan `h()` menaruh string itu di `o("lgErr").textContent` — jadi pesan Portugis
langsung kelihatan di kotak login.

**Akun baru dapat starter kit** (mirror `START_KIT` di `client.js`):
`owned = {k2, k5, m7, k400, 508001, redbulls, acidpol}` dan
`equip = {1:"k2", red:"redbulls", blue:"acidpol"}`. Tanpa ini `applyAcct()`
bikin `S.weapon`/`S.chara` jadi `undefined` — `S.chara` khususnya hilang karena
`S.chara = (…) ? e.equip.blue : e.equip.red`.

**Password:** `scrypt` + salt acak 16 byte, format `scrypt:<salt>:<hash>`,
dibandingin pakai `crypto.timingSafeEqual`. Disimpan di `data/pb.json`
(bukan di memori) jadi bertahan pas server restart.

**Sesi:** tiap `welcome` bikin `tok` acak 12 byte dan dipetakan ke `account.id`
di `db.sessions` (di-cap 500 entri). Sengaja **tidak** dihapus pas socket tutup —
client simpan `tok` di sessionStorage dan kirim `resume` waktu reload/reconnect.

---

## 3. Pesan lobby (server → client)

Dari dispatcher `t.onmessage` di `net.js`:

| `t` | Isi | Efek di client |
|---|---|---|
| `welcome` | `{sid, tok, bin, edge, ...}` | simpan `pbweb_sid`/`pbweb_tok`; **`v = !!bin`** (buka gate battle WS); apply `edge`; emit event `welcome` |
| `authfail` | `{text}` | tutup socket, tolak promise dengan `auth:true` |
| `srly` | `{u, k}` | **`C(a)` → buka battle WS** dengan `?k=` |
| `start` | `{battle:{u,k}, room}` | simpan `pbweb_battle = {room, u, k}` |
| `battle` | `{battle:{u,k}, room}` | simpan + **`location.reload()`** (maks 2×, dihitung via `pbweb_bat_n`) |
| `pg` | `{s}` | ping → client balas `{"t":"po","s":<s>}` |
| `sts` | `{l:[...]}` | batch: tiap elemen di-emit sebagai event sendiri |
| `close` | — | event `close` |

**Heartbeat:** server kirim `pg`, client balas `po`. Client juga punya interval 2 s:
kalau nggak ada pesan masuk selama >7 s **dan** `document.hidden === false`, socket
ditutup paksa (→ reconnect).

**Frame biner di lobby:** kalau `typeof data !== "string"`, di-parse pakai decoder
yang sama dengan battle (`E()`) dan di-emit sebagai event `st`.

---

## 4. Protokol battle (biner, 20 Hz)

### Client → server: `st`
Tanpa field `from` (server yang inject). Struktur per entitas:

```js
{ t:"st", ts, from, ents:[{ id, p:[x,y,z], y:yaw, pi:pitch, c, g, mv:[vx,vz], r, w }] }
```
- `p` posisi, `y` yaw, `pi` pitch, `c` bitfield (`c&1` crouch, `c>>1&1` ?, `c>>2&1` ?),
  `g` bitfield, `mv` kecepatan (dibagi 100), `r` bitfield, `w` weapon item id

### Server → client: `st`
```js
// decoder E() di net.js
if (1 === n[0]) o.push(r(0));                       // 1 entitas
else if (2 === n[0]) {                               // batch
  const t = e.getUint16(1, true); let n = 3;
  for (let a = 0; a < t; a++) {
    const t = e.getUint16(n, true); n += 2;
    o.push(r(n)); n += t;
  }
}
```

### Hit registration (JSON, di socket battle)
```js
// bundle.js
h.send({ t:"hit", target:e.id, from:n.id, dmg:t, head:!!i, helm:r?1:0,
         w:(o||n.W||n.wp||{}).item })
```
**Client-authoritative** — server asli percaya nilai `dmg` dari client. Untuk clone
single-player/lawan-bot, nggak perlu validasi server-side.

### Damage
```js
part = t.part || (t.head ? "head" : "body");
rate = (e.chara.cat.dmgRate || We)[part] || 1;
dmg  = part === "head" ? rate : rate * Math.max(0, 1 + (e.c.def[part] || 0));
if (dmg > 0 && dmg < 1) dmg = 1;
```

### Recoil
```js
v = Math.min(v + rec.vA * vF * (1 + 0.01 * WeaponReact), rec.vMax);
h = (2 * Math.random() - 1) * rec.hA * hF * (1 + 0.01 * WeaponReact);
if (|deg(hStart - yaw) + h| > rec.hMax) h = -h;   // clamp
```

---

## 5. Yang masih perlu dikonfirmasi (butuh sesi login)

Ini daftar **lengkap** hal yang nggak bisa dibaca dari kode client:

| # | Hal | Kenapa perlu akun |
|---|---|---|
| 1 | Isi persis `dev` dan `fp` di handshake | dihitung client, tapi bentuk pastinya cuma kelihatan di wire |
| 2 | ~~Isi lengkap pesan `welcome`~~ | **SUDAH ADA** — lihat §2b; server kita kirim `acct` lengkap + `tok` |
| 3 | Bentuk persis `{u,k}` dari `srly` | **SUDAH ADA** — `srly.u` absolut (`ws://<host>/b2`), `srly.k` = key battle |
| 4 | ±50 tipe pesan lobby lain yang beredar saat main | dispatcher-nya ada di `bundle.js`, tapi nama tipe & payload asli cuma kelihatan live |
| 5 | Frame `st` biner asli saat match jalan | validasi codec yang sudah didekode |

> **Penting:** semua di atas **mempercepat** pembuatan server, bukan blocker.
> Kontrak inti (handshake, `welcome`, `srly`, `st`, `hit`) sudah lengkap di atas.

---

## 6. Endpoint yang sudah dipetakan

| Endpoint | Status |
|---|---|
| `wss://<host>/ws` | lobby WS |
| `wss://<host>/b2` | battle WS — **terverifikasi 101 tanpa auth** (probe manual) |
| `wss://<host>/b1` | 404 |
| `/home.json` | 919 online, 808 asia, 92 room, top-100 |
| `/goods.json` | 199.937 B katalog toko |
| `/build.json` | `{"v":"202610310110"}` |
| `/static/prefetch.json` | 3.976 aset, 480 MB |
| `/a/<api>/<hash>` | CDN aset — **abaikan query string**, cuma hash yang menentukan |
| `/api/` | 403 |
| `/cdn-cgi/trace` | colo SIN |
