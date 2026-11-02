# Pusat Kendali — Cara Pakai

Cheat client-side buat pbmobile.app (dan domain saudaranya). Browser-based, jadi cara kerjanya lewat **userscript** (Tampermonkey/Violentmonkey), bukan injector eksternal.

## Install

1. Install extension **Tampermonkey** (Chrome/Edge/Firefox) atau **Violentmonkey**.
2. Buka extension → **Add new script** → hapus template → copy-paste seluruh isi `pbmobile_cheat.user.js` → Save (Ctrl+S).
3. Buka https://pbmobile.app dan main seperti biasa. Panel muncul di kiri-atas.

## Fitur

| Fitur | Cara kerja | Catatan |
|---|---|---|
| **Bantuan Visual** (ESP) | Baca posisi semua pemain dari stream protokol biner battle (20Hz), gambar kotak/nama/nyawa/senjata/jarak di overlay canvas | 100% client-side. Posisi dihitung dari pos+yaw+pitch sendiri (proyeksi matematis, tanpa hook renderer) |
| **Bantuan Bidikan** (silent aim) | Timpa `yaw`/`pitch` di pesan `st` keluar biar mengarah ke target dalam radius "Sudut bidik" | Server lihat aim mengunci ke musuh. Mode: tahan klik kanan (default) atau selalu aktif |
| **Tembak Otomatis** (triggerbot) | Kirim pesan `{t:"hit"}` sintetis ke server waktu musuh ada di dekat crosshair | Pakai dmg & interval senjata yang diamati dari tembakan asli lu sendiri (biar konsisten dengan fire-rate) |
| **Pengganda Damage** | Kalikan `dmg` di pesan `hit` keluar + paksa headshot | **Default OFF.** Kalau server validasi dmg vs stat senjata, ini yang paling gampang kena |
| **Dorongan Gerak** | Kalikan vektor `mv` di pesan `st` keluar (max protocol ±1.27) | Kalau server validasi kecepatan dari delta posisi, efeknya minim |

Tombol **Insert** = show/hide panel. Panel bisa di-drag.

## Setting awal yang disarankan

1. Main 1 match biasa dulu — pastikan ESP muncul (status "Pemain" > 0).
2. Nyalain **Bantuan Bidikan**, Sudut bidik 5-8°, mode tahan RMB.
3. Nyalain **Tembak Otomatis**, Presisi 20px.
4. **Pengganda Damage** — coba di match casual dulu. Kalau damage nggak naik, artinya server validasi → matiin lagi.
5. **Dorongan Gerak** — coba 1.10 dulu.

## Yang sudah diantisipasi (dari analisa anti-cheat client)

Anti-cheat client (jalan tiap 8 detik) ngecek:

- **Layer DOM** → overlay canvas punya atribut `data-pb`, di-exclude dari hitungan
- **Fungsi native di-patch** → nol patch prototype; hook `send` per-instance (properti own), renderer/Canvas/rAF nggak disentuh
- **Global window baru** → semua di dalam IIFE, nol variabel global
- **Input sintetis** → nol event sintetis dikirim (cuma baca event asli buat deteksi RMB)
- **Snapshot `h.send` (NETC)** → fungsi kirim game nggak diubah
- **Snapshot `z.render`** → renderer nggak di-hook; proyeksi dihitung sendiri
- **Scan teks layar** → label UI pakai bahasa Indonesia biasa, nol kata pemicu, panel juga `data-pb`

## Risiko yang tetap ada (di luar kendali client)

- **Screenshot admin (`acshot`)** — server bisa minta screenshot; ESP kelihatan kalau ada yang review manual
- **Validasi server-side** — FAQ server bilang "confere cada tiro e movimento". Kalau server cek line-of-sight, dmg vs stat senjata, atau hit-rate, fitur ofensif bisa ditolak/di-flag
- **Telemetry input** — game kirim stat input asli tiap 60s; main tanpa input sama sekali = pattern bot
- **Ban** — pakai di akun utama adalah risiko lu sendiri

## Debug

Aktifin **Catatan pesan** di panel → muncul baris log kecil di bawah status (dan log lengkap di Console browser, F12 → Console).

**Penting:** log SELALU disimpan diam-diam sejak script load, jadi begitu lu nyalain "Catatan pesan" di tengah match, info boot (readyState, frame, iframe) tetep ada — nggak kelewat.

Isi log yang perlu diperhatiin:

| Baris | Artinya |
|---|---|
| `t0 rs=loading` | script ke-inject SEBELUM DOM siap → hook lebih dulu dari game (ini yang kita mau) |
| `t0 rs=interactive` / `complete` | script ke-inject TERLAMBAT → hook kalah cepat, ini penyebab utama kalau nol |
| `frame=top host=…` | script jalan di window utama (bukan iframe) |
| `iframe=N` | jumlah iframe di halaman (kalau game di dalamnya, realm-nya ikut di-hook) |
| `ws wss://…` | socket WebSocket kedeteksi & ke-hook (harus ada minimal 1) |
| `ws-open …` / `ws-close …` | socket kebuka / ketutup — **`ws-close` pas loading match = socket lama diganti, normal** |
| `iframe ws …` | socket di dalam iframe kedeteksi |
| `rtc "nama"` | data channel WebRTC kebuka → battle jalan P2P |
| `worker …` / `worker↓ …` | game pakai Web Worker; kalau ada `worker↓ bin:…`, jaringan mungkin di dalam worker |
| `fetch …` / `xhr …` / `sse …` | transport non-WebSocket ke URL yang mencurigakan |
| `self=… (dari frame battle)` | identitas kita dikunci dari frame battle pertama yang masuk |
| `st↑ ws 1 ent` | pesan posisi kita sendiri terkirim & kepetang |
| `st↓ ws 1 msg` | pesan posisi pemain lain masuk |
| `msg game` / `msg spawn` / `msg hp` | pesan lobby masuk |
| `hit↑ …` / `hit→ …` | hit terkirim (log / triggerbot) |

Status line di bawah panel:

- **Ruang: WS** = socket battle kedeteksi · **Ruang: RTC** = battle lewat data channel · **—** = belum kedeteksi
- **Pemain: N** = jumlah pemain yang posisinya kebaca (ESP gambar kalau N > 0)
- **ID sendiri: ok** = identitas + posisi sendiri kekunci (ESP & aim butuh ini)
- Baris kedua: `ws <kebuka>/<total> [host] · frame top|iframe` — berapa socket yang ke-hook dan kebuka

Panel sekarang nampilin label versi di header (`v1.3 [Insert]`) — pastikan yang kepasang beneran versi terbaru.

### Kalau status masih "Ruang: — · Pemain: 0"

1. Pastikan header panel nunjukin **v1.3**.
2. Pastikan Tampermonkey nggak nge-block `document-start` (menu script → pastikan nggak ada notif error).
3. Nyalain **Catatan pesan**, main 1 match, terus screenshot panel → kirim ke gua. Yang gua butuh: baris `t0 rs=…`, `frame=…`, `iframe=…`, `ws …`, dan baris kedua status (`ws n/m […]`).

## File

- `pbmobile_cheat.user.js` — cheat (userscript)
- `test_codec.js` — unit test codec binario (round-trip)
- `test_math.js` — unit test proyeksi + konvensi aim
- `test_hooks.js` — unit test hook transport (document-start, jalur kirim/terima, realm iframe)
