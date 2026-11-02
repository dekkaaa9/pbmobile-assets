# PBMobile - clone

Isi repo ini **cuma yang dibutuhin buat clone-nya**: kode client, server, dan
dokumentasi. **Aset 1,26 GB ada di [Releases](releases)**, bukan di git - supaya
repo tetap ringan dan clone cepet.

---

## Isi repo

```
pbmobile/
├── site/
│   ├── index.html            entry point client (lobby)
│   ├── jogo.html             halaman game (HUD)
│   ├── cc.js                 loader awal
│   ├── debug.html            halaman tes (showroom 3D, buat verifikasi aset)
│   ├── pb-web.html  pb-ios.html  point-blank-mobile.html
│   ├── home.json  goods.json  build.json     data asli (goods.json = katalog Shop.dat)
│   └── static/               27 MB - KODE CLIENT
│       ├── game/bundle.js            1 MB   logika game (obfuscated)
│       ├── game/bundle.readable.js   1,5 MB versi beautify (30.504 baris)
│       ├── game/pb.js                loader aset + assetUrl()
│       ├── game/net.js               WebSocket lobby + battle
│       ├── game/weapons.json         6.109 senjata
│       ├── game/weapon_anims.json    674 karakter
│       └── vendor/three.min.js
├── server/                   SERVER FASE 2 - lobby + battle + bot, nol dependensi
│   ├── index.js              entry point (HTTP + routing WS)
│   ├── lobby.js              protokol lobby: room, chat, matchmaking, RPC
│   ├── battle.js             simulasi battle: codec `st`, hit, skor, semua mode
│   ├── bots.js               AI musuh (6 profil senjata, 3 tingkat kesulitan)
│   ├── codec.js              port persis codec binary `st` (2 arah)
│   ├── wssrv.js              WebSocket server RFC 6455 buatan sendiri
│   ├── db.js                 penyimpanan akun (JSON, atomic write, scrypt)
│   ├── config.js             mode, peta, rumus damage/recoil, level, ladder rank
│   ├── shop.js               katalog + ekonomi dari goods.json asli (Shop.dat)
│   ├── static.js             penyaji file statis + Range
│   ├── test_codec.js         tes codec (88 assertion)
│   ├── test_integration.js   tes end-to-end (116 assertion)
│   ├── test_akun.js          tes akun DAFTAR/MASUK (42 assertion, live)
│   └── test_shop.js          tes shop/ekonomi/ranking (96 assertion, live)
├── tools/                    cuma 3 script yang dibutuhin build/run
│   ├── local_server.js       jalanin clone offline (port 8787)
│   ├── build_release.js      bikin 2 tarball buat GitHub Release
│   └── repo_audit.js         audit isi repo
├── VPS.md                    panduan deploy ke VPS + Cloudflare Tunnel
├── PROTOKOL.md               protokol lobby + battle lengkap (kontrak server)
├── GITHUB.md                 cara upload & struktur repo/release
└── .gitignore
```

**Yang NGGAK ada di repo** (ada di Release):

| Folder | Ukuran | Isi |
|---|---|---|
| `site/assets/` | 1,22 GB | 12.692 file - mesh, tekstur, skinned, anim, sound, weapon |
| `site/rml/` | 3,8 MB | font + namecard |
| `site/export/` | 811 MB | 8.707 file - GLB (340), WebP (8.286), maps (35), sound (38) |

---

## Cara pakai

### 1. Download aset

Ambil 2 file dari https://github.com/dekkaaa9/pbmobile-assets/releases/tag/v1.0

```bash
tar -xzf site-runtime.tar.gz          # -> folder site/ (lengkap, langsung jalan)
tar -xzf site-export.tar.gz -C site   # -> folder site/export/ (opsional, buat analisis)
```

### 2. Jalanin lokal (offline, statis doang)

```bash
node tools/local_server.js
# buka http://localhost:8787
```

Server-nya **pure static** - nol request keluar. Showroom 3D langsung render
dengan tekstur penuh, sama persis kayak di pbmobile.app.

### 3. Jalanin server multiplayer (Fase 2)

```bash
node server/index.js --port 8787
# buka http://localhost:8787 -> DAFTAR/MASUK -> JOGAR -> bikin/join sala -> INICIAR
```

Butuh **nol `npm install`** - WebSocket server, codec, dan DB semuanya bikin
sendiri. Butuh `site/` yang udah diekstrak (Release `site-runtime.tar.gz`).

Buka di beberapa browser/tab buat tes mabar. Bot otomatis jadi lawan kalau
sala diisi `bots: [n, n]`.

**Akun:** server nggak ada guest login. Pertama kali buka, klik **DAFTAR** ->
isi ID (3-16 char), e-mail, senha (4-16) -> **CADASTRAR**. Akun + password
(scrypt) disimpan di `data/pb.json`, jadi bisa **MASUK** lagi kapan aja.
Akun baru langsung dapat starter kit: `k2`, `k5`, `m7`, `k400`, chara
`redbulls`/`acidpol`. Detail + tabel errornya: **`PROTOKOL.md` §2b**.

---

## Multiplayer (mabar)

**Udah ada.** `server/` implementasi Fase 2 lengkap, nol dependensi npm:

| Bagian | File | Isi |
|---|---|---|
| Lobby | `server/lobby.js` | handshake `hello`/`resume`, `welcome`(`bin:true`), room list, join/create/cfg/start, chat, matchmaking (quick play / BR / ranked), RPC, heartbeat `pg` 5 s, **akun: DAFTAR/MASUK + `authfail`** |
| Battle | `server/battle.js` | codec binary `st` 20 Hz, roster `game`, hit client-authoritative, respawn 3 s, skor, 14 mode asli, bom, BR zone, P2P relay |
| Bot | `server/bots.js` | 6 profil senjata, aim & reaksi diskala `dif` 1-3, strafe, cari target |
| Codec | `server/codec.js` | port persis `k()`/`E()` dari `net.js` - dua arah, clamp i8 |
| WS | `server/wssrv.js` | RFC 6455 buatan sendiri: handshake SHA1, masking, fragmentasi, control frame |
| DB | `server/db.js` | JSON store, atomic tmp+rename, flush debounce, **password scrypt + salt, sesi `tok`** |
| Shop | `server/shop.js` | baca `site/goods.json` asli (`Shop.dat`): 710 item / 1914 offer, harga CASH & GOLD, set, bundel premium, sewa + expiry |

### Shop, ekonomi & ranking

Shop-nya **bukan karangan** — dibaca langsung dari `site/goods.json` PB asli
(`source: "Shop.dat"`): 710 item, 1914 offer, 10 set, nama & slot asli.

- **CASH (GP)** = currency gratisan, offer-nya **sewa** 1/3/30 hari. Akun baru
  dapat 50000 GP.
- **GOLD (PB Coin)** = currency premium, offer-nya **permanen**. Akun baru 0 —
  didapat dari menang partida (`5 + floor(kills/5)` per vitória).
- `owned[item]` nyimpen **expiry** (`0` = permanen), sewa kedaluwarsa dibuang
  otomatis tiap login.
- Ranking 6 tier (Bronze → Mestre), 100 poin per divisi, dari `rkEmblem` +
  `rkNext` di bundle. RP naik kalau menang, turun kalau kalah, dan **nggak
  berubah** di treino / partida lawan bot.
- Progresi (`result`): EXP, CASH, GOLD, RP, level, kills/deaths/headshots/wins.

Kontrak lengkap + rumusnya: **`PROTOKOL.md` §2c**.

### Tes

```bash
node server/test_codec.js        # 88 assertion - codec biner dua arah
node server/test_integration.js  # 116 assertion - boot server, mainin flow lengkap
node server/test_akun.js         # 42 assertion - DAFTAR/MASUK/resume ke server LIVE
node server/test_shop.js         # 96 assertion - shop/ekonomi/ranking/nick/sosial/result
```

`test_akun.js` nembak server produksi (default: tunnel trycloudflare), jadi
nggak butuh `npm install` dan nggak nyentuh DB lokal.

Detail kontraknya ada di **`PROTOKOL.md`**. Deploy ke VPS: **`VPS.md`**.

### Kenapa desainnya gini

- **Box kecil (~953 MB RAM)** -> DB JSON bukan PostgreSQL, state in-memory bukan
  Redis, satu proses Node buat lobby + battle.
- **Nol dependensi** -> `node server/index.js` langsung jalan, nggak ada
  `npm install` yang bisa gagal di VPS.
- **Hit registration client-authoritative** -> `battle.js` cuma nerima `hit`,
  nggak simulasi peluru. Cuma ada sanity cap (jarak 250, dmg 200).
- **`srly` URL absolut** -> server kirim `wss://<host>/b2`, client pakai apa
  adanya. Nggak perlu patch kode client pas deploy di belakang tunnel.

### Anti-cheat client - jangan diutak-atik

`bundle.js` punya 4 lapis deteksi (`Rc`/`Lc`/`Cc`/`Ic`). Jangan pernah:

- patch prototype `WebSocket`, `Canvas2D`, `requestAnimationFrame`, `Object`,
  `Storage`, `WeakMap`, `Map`, `Function.toString`
- hook `z.render`
- nambah global baru di `window`
- kirim input event sintetis
- ubah material mesh / `renderOrder`

UI cheat harus tetap pakai `data-pb`, dan teks UI harus hindari regex `Ac`
sama daftar nama global `Tc`.

---

## Status

| Fitur | Status |
|---|---|
| Mirror aset 1,2 GB (12.692 file) | ✅ selesai |
| Decode format PBM1 (header + mesh + part) | ✅ selesai |
| Export GLB (340) + WebP (8.286) + maps (35) | ✅ selesai |
| `bundle.js` de-obfuscate (30.504 baris) | ✅ selesai |
| Protokol lobby (~50 tipe pesan) | ✅ terpetakan |
| Protokol battle (codec `st`, 20 Hz) | ✅ terpetakan |
| Anti-cheat client (Rc/Lc/Cc/Ic) | ✅ terpetakan |
| Client jalan 100% offline | ✅ selesai |
| **Server Fase 2 (lobby + battle + bot)** | ✅ selesai - `node server/index.js` |
| **Akun: DAFTAR / MASUK (scrypt + sesi)** | ✅ selesai - `PROTOKOL.md` §2b |
| **Shop + ekonomi + ranking (data asli)** | ✅ selesai - `PROTOKOL.md` §2c |
| Deploy publik VPS + tunnel | 📖 panduan di `VPS.md` |

---

## Catatan teknis

- **`bundle.js` cek `document.currentScript`** - harus dilayani dari path
  `/static/game/bundle.js`, kalau nggak client `location.replace("/")`.
- **`site/export/` nggak diminta client** - itu olahan buat analisis/Blender.
- **File di `site/assets/` tanpa ekstensi** = format PBM1. Nama file = hash dari
  path PBM1 asli. CDN asli ngabaikin query string, cuma path yang menentukan aset.
- **`time` di room = MENIT**, bukan detik. Client: `timeLimit = 60 * time`.
- **14 mode asli** (dari tabel `bundle.js`): dm, bomb, destroy, elim, defense,
  royale, escape, tutorial, cross, extort, gungame, kconf, dom, zombie.
  Nggak ada `tdm`/`sniper`/`knife` - kalau dikirim, client fallback ke `dm`.
- **`kill` event wajib bawa `score:[a,b]`** - handler di `bundle.js` baca
  `e.score[0]` tanpa guard, kalau nggak ada client lempar TypeError.
- **`fx` `k:"shot"` wajib bawa `o:[x,y,z]` dan `d:[dx,dy,dz]`** - dipakai
  `Vector3.fromArray()`, kalau undefined client crash. Efek darah dirender lokal
  oleh penembak, jadi server nggak kirim itu.
- **`window.G` cuma ada di localhost** (`Ka` true). `location.hostname` nggak
  bisa dipalsuin.

---

## Disclaimer

Aset dan kode game ini properti **PB/Garena**. Repo ini dibuat buat keperluan
riset reverse engineering & pendidikan. Jangan dipakai komersial tanpa izin.
