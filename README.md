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
│   ├── home.json  goods.json  build.json     stub API
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
│   ├── db.js                 penyimpanan akun (JSON, atomic write)
│   ├── config.js             mode, peta, rumus damage/recoil, level
│   ├── static.js             penyaji file statis + Range
│   ├── test_codec.js         tes codec (88 assertion)
│   └── test_integration.js   tes end-to-end (84 assertion)
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
# buka http://localhost:8787 -> klik JOGAR -> bikin/join sala -> INICIAR
```

Butuh **nol `npm install`** - WebSocket server, codec, dan DB semuanya bikin
sendiri. Butuh `site/` yang udah diekstrak (Release `site-runtime.tar.gz`).

Buka di beberapa browser/tab buat tes mabar. Bot otomatis jadi lawan kalau
sala diisi `bots: [n, n]`.

---

## Multiplayer (mabar)

**Udah ada.** `server/` implementasi Fase 2 lengkap, nol dependensi npm:

| Bagian | File | Isi |
|---|---|---|
| Lobby | `server/lobby.js` | handshake `hello`/`resume`, `welcome`(`bin:true`), room list, join/create/cfg/start, chat, matchmaking (quick play / BR / ranked), RPC, heartbeat `pg` 5 s |
| Battle | `server/battle.js` | codec binary `st` 20 Hz, roster `game`, hit client-authoritative, respawn 3 s, skor, 14 mode asli, bom, BR zone, P2P relay |
| Bot | `server/bots.js` | 6 profil senjata, aim & reaksi diskala `dif` 1-3, strafe, cari target |
| Codec | `server/codec.js` | port persis `k()`/`E()` dari `net.js` - dua arah, clamp i8 |
| WS | `server/wssrv.js` | RFC 6455 buatan sendiri: handshake SHA1, masking, fragmentasi, control frame |
| DB | `server/db.js` | JSON store, atomic tmp+rename, flush debounce |

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
