# PBMobile — clone 

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

---

## Deploy ke VPS (biar bisa dibuka orang)

Client ini butuh **dua** hal: (a) file statis dilayani via HTTP, dan (b) WebSocket
ke server lobby + battle. Bagian (a) udah beres. Bagian (b) lihat
[Multiplayer](#multiplayer-mabar) di bawah.

### 1. Siapkan VPS

Ubuntu 22.04, minimal **1 vCPU / 1 GB RAM / 10 GB disk**. Nggak perlu GPU — semua
rendering di browser.

```bash
apt update && apt install -y nodejs npm
node -v    # minimal 18
```

### 2. Taruh aset + kode

```bash
mkdir -p /opt/pbmobile && cd /opt/pbmobile

# dari lokal:
scp site-runtime.tar.gz root@IP_VPS:/opt/pbmobile/
scp site-export.tar.gz  root@IP_VPS:/opt/pbmobile/     # opsional

# di VPS:
tar -xzf site-runtime.tar.gz          # -> site/
tar -xzf site-export.tar.gz -C site   # -> site/export/  (opsional)

git clone https://github.com/dekkaaa9/pbmobile-assets.git /opt/pbmobile/repo
cp -r /opt/pbmobile/repo/tools /opt/pbmobile/
cp -r /opt/pbmobile/repo/deploy /opt/pbmobile/
```

### 3. Jalanin server statis

```bash
cd /opt/pbmobile
setsid nohup node tools/local_server.js > server.log 2>&1 &
curl -sI http://localhost:8787/index.html | head -1     # harus 200
```

`setsid nohup` dipakai karena container/VPS kecil sering nggak ada systemd.
Alternatif: `pm2 start tools/local_server.js` kalau mau auto-restart.

### 4. Buka ke publik

VPS biasanya nggak bisa bind port 80/443 langsung (di belakang NAT / Railway edge).
Solusi paling gampang: **Cloudflare Tunnel** — gratis, HTTPS otomatis, nggak perlu
buka port.

```bash
# install
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
  -o /usr/local/bin/cloudflared && chmod +x /usr/local/bin/cloudflared

# quick tunnel (dapat URL *.trycloudflare.com, ganti tiap restart)
setsid nohup cloudflared tunnel --url http://localhost:8787 > tunnel.log 2>&1 &
sleep 5 && grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' tunnel.log | head -1
```

URL hasil grep itu yang dibagi ke orang. WebSocket lolos otomatis karena
cloudflared proxy `Upgrade: websocket`.

> Buat domain tetap (nggak ganti tiap restart), bikin named tunnel +
> `cloudflared tunnel route dns`. Butuh akun Cloudflare + domain sendiri.

### 5. Titip client ke hostname tunnel

Client bangun URL WebSocket dari `location` sendiri, jadi kalau lu buka lewat
`https://xxx.trycloudflare.com`, dia otomatis nyambung ke host itu — **nggak perlu
patch kode**. Yang perlu dipastiin cuma server lobby+battle dengerin di path yang
sama (`/b2` buat battle WS, lihat `PROTOKOL.md`).

---

## Multiplayer (mabar)

**Belum ada.** Server lobby + battle belum ditulis. Yang udah beres:

- Protokol lobby lengkap — handshake `hello`/`resume`, `welcome`/`srly`/`start`,
  ~50 tipe pesan, heartbeat `pg`/`po`
- Protokol battle lengkap — codec binary `st` 20 Hz, roster `game`, pesan `hit`
  (`{t:"hit",target,from,dmg,head,helm,w}`)
- Rumus damage, rumus recoil, konstelasi 6.109 senjata
- Token flow `{u,k}` buat WS battle

Semua kesimpen di **`PROTOKOL.md`** — itu kontrak lengkap buat nulis server-nya.

**Yang perlu dibikin:**

```
server/
├── lobby.js       WebSocket /b1 — hello, room list, matchmaking, inventory
├── battle.js      WebSocket /b2?k=... — codec st, roster, hit, skor, respawn
├── db.js          SQLite — akun, inventory, rank, history
└── bot.js         AI musuh buat tes solo sebelum ada pemain asli
```

Catatan penting buat yang mau lanjutin:

- **Hit registration client-authoritative** — server clone nggak wajib validasi
  peluru, jadi `battle.js` bisa simpel: terima `st`, broadcast ke room, terima `hit`.
- **Box kecil (953 MB RAM)** → SQLite bukan PostgreSQL, state in-memory bukan Redis,
  satu proses Node buat lobby + battle.
- **Anti-cheat client** (`Rc`/`Lc`/`Cc`/`Ic` di `bundle.js`) cek regex teks,
  canvas layer, dan global — jangan patch prototype WebSocket/Canvas2D/rAF.

Sampai server-nya ada, yang bisa dilakuin sekarang: **showroom, inventory, shop,
kustomisasi karakter, dan tes mode 3D** — semuanya udah jalan offline.

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
damage, rumus recoil, dan konstelasi senjata. Lihat
[Multiplayer (mabar)](#multiplayer-mabar) buat rencana server-nya.

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
