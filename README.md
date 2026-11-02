# PBMobile — clone offline

Mirror statis **pbmobile.app** (Point Blank Mobile versi browser) yang bisa jalan
sepenuhnya dari disk lokal / VPS sendiri — **nggak ada satu pun request ke
pbmobile.app** saat runtime.

Isi repo ini **cuma yang dibutuhin buat clone-nya**: kode client, script, dan
dokumentasi. **Aset 1,26 GB ada di [Releases](releases)**, bukan di git — supaya
repo tetap ringan dan clone cepet.

---

## Isi repo

```
pbmobile/
├── site/
│   ├── index.html            entry point client
│   ├── cc.js                 loader awal
│   ├── debug.html            halaman tes (showroom 3D, buat verifikasi aset)
│   ├── pb-web.html  pb-ios.html  pb-mobile.html
│   ├── home.json  goods.json  build.json     stub API
│   └── static/               27 MB — KODE CLIENT
│       ├── game/bundle.js            1 MB   logika game (obfuscated)
│       ├── game/bundle.readable.js   1,5 MB versi beautify (30.504 baris)
│       ├── game/pb.js                loader aset + assetUrl()
│       ├── game/net.js               WebSocket lobby + battle
│       ├── game/weapons.json         6.109 senjata
│       ├── game/weapon_anims.json    674 karakter
│       └── vendor/three.min.js
├── tools/                    script build / deploy / analisis
├── deploy/                   script deploy VPS
├── PROTOKOL.md               protokol lobby + battle lengkap
├── LAPORAN.md                laporan security assessment
├── GITHUB.md                 cara upload & struktur repo/release
└── .gitignore
```

**Yang NGGAK ada di repo** (ada di Release):

| Folder | Ukuran | Isi |
|---|---|---|
| `site/assets/` | 1,22 GB | 12.692 file — mesh, tekstur, skinned, anim, sound, weapon |
| `site/rml/` | 3,8 MB | font + namecard |
| `site/export/` | 811 MB | 8.707 file — GLB (340), WebP (8.286), maps (35), sound (38) |

---

## Cara pakai

### 1. Download aset

Ambil 2 file dari https://github.com/dekkaaa9/pbmobile-assets/releases/tag/v1.0

```bash
tar -xzf site-runtime.tar.gz          # -> folder site/ (lengkap, langsung jalan)
tar -xzf site-export.tar.gz -C site   # -> folder site/export/ (opsional, buat analisis)
```

### 2. Jalanin lokal

```bash
node tools/local_server.js
# buka http://localhost:8787
```

Server-nya **pure static** — nol request keluar. Showroom 3D langsung render
dengan tekstur penuh, sama persis kayak di pbmobile.app.

### 3. (Opsional) Deploy ke VPS

Lihat `GITHUB.md` dan `deploy/`.

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
| **Server multiplayer (lobby + battle)** | ⬜ belum — lihat `PROTOKOL.md` |

Server multiplayer belum ditulis. Semua yang dibutuhin udah kesimpen di
`PROTOKOL.md`: handshake, token `{u,k}` buat WS battle, format pesan, rumus
damage, rumus recoil, dan konstelasi senjata.

---

## Catatan teknis

- **`bundle.js` cek `document.currentScript`** — harus dilayani dari path
  `/static/game/bundle.js`, kalau nggak client `location.replace("/")`.
- **`site/export/` nggak diminta client** — itu olahan buat analisis/Blender.
- **File di `site/assets/` tanpa ekstensi** = format PBM1. Nama file = hash dari
  path PBM1 asli. CDN asli ngabaikin query string, cuma path yang menentukan aset.
- **Hit registration client-authoritative** — server clone nggak wajib validasi peluru.
- **`window.G` cuma ada di localhost** (`Ka` true). `location.hostname` nggak bisa dipalsuin.

---

## Disclaimer

Aset dan kode game ini properti **PB/Garena**. Repo ini dibuat buat keperluan
riset reverse engineering & pendidikan. Jangan dipakai komersial tanpa izin.
