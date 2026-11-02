# PBMobile.app — Full Security Assessment
**Tanggal:** 2 November 2026
**Target:** https://pbmobile.app (PBMobile — browser FPS "Point Blank" private server)
**Metode:** Passive & light-active recon (OSINT, header/TLS analysis, client JS reverse-engineering, WebSocket protocol probing, endpoint enumeration). Tidak ada eksploitasi destruktif, tidak ada brute-force, tidak ada gangguan layanan.

---

## 1. Ringkasan Eksekutif

PBMobile adalah private server Point Blank berbasis browser (game "Piercing Blow Web") dengan ~1.700 pemain online. Infrastruktur: **Cloudflare** (WAF/CDN) → **nginx 1.18.0** → backend **Python** (server.py/webpush.py) di **Oracle Cloud**. Game client kompleks (lobby V37 + three.js) dengan protokol game custom **JSON-over-WebSocket**.

**Postur keamanan: menengah.** Cloudflare + Turnstile + SRI di game bundle + auth server-side di admin commands adalah poin plus. Tapi: **nol security headers**, **origin node terbuka tanpa WAF** (nginx EOL + 7 port TCP), **stack disclosure** (Python, nginx version), **upload token di URL query**, dan **guest access penuh ke lobby**.

---

## 2. Infrastruktur & Stack

| Komponen | Detail |
|---|---|
| CDN/WAF | Cloudflare (proxied, colo SIN, TLS 1.2/1.3, HTTP/2 + h3) |
| Origin node | `149.33.27.134` = `sgd.pbmobile.app` (grey-cloud DNS, **tanpa Cloudflare**) |
| Web server | **nginx/1.18.0 (Ubuntu)** — EOL sejak 2021, banner versi terbuka |
| Backend | **Python** — bocor dari komentar `sw.js`: "server.py", "webpush.py" |
| Hosting | Oracle Cloud (self-disclosed di privacy policy) |
| Domain saudara | `pbmobile.ch`, `pointblankmobile.es`, `pbmobile-th.online` |
| Frontend | Vanilla JS + three.js; lobby client 288KB, game bundle 1MB |
| Bahasa | pt-BR, en, id, th, vi (auto by CF-IPCountry) |

### Port terbuka di origin node (149.33.27.134)
`22` (SSH), `80`, `443`, `8766` (WS dev port — hardcoded di net.js), `3000` (Node default), `8080`, `9222` (Chrome DevTools?!).
- Port 8766/3000/8080/9222 accept TCP tapi tidak respons ke probe generik (mungkin firewall tarpit atau service internal). **Perlu investigasi lanjutan.**
- Node ini grey-clouded → **bypass total Cloudflare WAF/rate-limit** kalau ditarget langsung.

---

## 3. Security Headers — SEMUA HILANG

Response `https://pbmobile.app/` hanya punya `cache-control`, `Report-To`, `Nel` (default CF). Yang **tidak ada**:

- ❌ `Strict-Transport-Security` (HSTS) — SSL strip risk
- ❌ `Content-Security-Policy` — **kritis**: session token disimpan di sessionStorage, tanpa CSP = XSS langsung curi session
- ❌ `X-Frame-Options` / `frame-ancestors` — clickjacking possible
- ❌ `X-Content-Type-Options` — MIME sniffing
- ❌ `Referrer-Policy`
- ❌ `Permissions-Policy`

**Catatan:** request ke origin node via `--resolve` tetap lewat CF upstream (CF-RAY header muncul) — jadi HTTP-level CF bypass tidak trivial untuk domain utama, tapi node `sgd.pbmobile.app` sendiri tetap exposed langsung.

---

## 4. Autentikasi & Session

**Handshake WebSocket** (`wss://pbmobile.app/ws`):
```json
{"t":"hello"|"resume","sid":"...","tok":"...","nick":"...","plat":"pc|mobile",
 "cross":0,"dev":"<UUID>","fp":"<hash>","sts":1,"bin":1,"bk":"<battle key>"}
```
- Server balas `welcome` → `{sid, tok, acct, edge, bin}`. Guest dapat `acct:null` tapi **sid langsung aktif**.
- **Guest access penuh**: room list, lobby chat global, spectate match ("watch without an account") — tanpa akun/Turnstile.
- `sid` = 16-hex, `tok` di sessionStorage. **Turnstile** (sitekey `0x4AAAAAAFW0hJ-oqPGHAxOY`) hanya di login modal.
- **Device ID** (`pbweb_dev`) = persistent UUID di localStorage — tracking lintas session.
- **Fingerprint** = FNV-1a hash dari: GPU renderer (WebGL UNMASKED), screen res, DPR, hardwareConcurrency, deviceMemory, timezone, language, platform.

### Temuan auth:
1. **No rate limiting** pada session creation — 10 rapid hello semua 200 OK.
2. **Resume dengan sid/tok palsu** → server diam-diam bikin session baru (tidak ada error/lockout). Bukan vuln langsung, tapi menunjukkan tidak ada anomaly detection di path ini.
3. Admin commands (`admin`, `admban`, `vip_adm`, `tour_admin`) dari guest → **diem total, tidak dieksekusi** → auth server-side jalan (bagus).
4. Malformed JSON → diem, no crash, no stack trace (parser lenient tapi aman).
5. Staff tiers: `gm` (ADMIN) / `self` (GM) / `MOD` — dikirim server via `ACCT.staff`; panel admin cuma di-gate client-side (UI), tapi eksekusi command jelas divalidasi server.

---

## 5. Peta Protokol (WebSocket JSON)

~200 tipe pesan terpetakan. Kategori utama:

| Kategori | Contoh `t:` |
|---|---|
| Lobby/rooms | `rooms, join, create, leave, kick, owner, reqhost, watch, observe` |
| Chat/sosial | `chat, whisper, wchat, friend, unfriend, block, note_send, dm_*, grp_*` |
| Ekonomi | `buy, buyset, pbuy, pix, cpay, crate_open, pass_buy, mpass_buy, vip_buy, clan_buy, gold` |
| Clan | `clan_create, clan_manage, clan_kick, clan_role, clan_buy, ...` (15+ types) |
| Tournament | `tour, tour_reg, tour_admin, tour_checkin` |
| Admin/staff | `admin, admban, vip_adm, tour_admin, chatmod, acflag` |
| Anti-cheat | `jserr, kcskip, acshot` |
| Reports | `den, denlist, denvote, Reportar, vip_report` |
| Game | `fireBolt, frag, hit, plant, disarm, heal, spawnme, ktake` |

**Battle server**: `wss://<host>/b1` atau `/b2` dengan key `k` (di sessionStorage `pbweb_battle`) — match terpisah dari lobby server.
**Edge regional**: user timezone Indonesia di-redirect ke `wss://sgd.pbmobile.app/` atau `jkd.pbmobile.app/`.

### Info exposure di protokol:
- **Lobby chat global** broadcast ke semua client termasuk guest (spam/abuse surface).
- **`mid` sequential** (e.g., 20970) — message ID predictable.
- **Room list** expose `host` (session ID host), `hostNick`, dan array `ban` (ID akun yang di-ban di room itu).
- Server kirim `pg` ping dengan timestamp (clock sync).

---

## 6. HTTP Endpoints

| Endpoint | Status | Catatan |
|---|---|---|
| `/home.json` | 200 | **Stats server + top-100 leaderboard lengkap** (nick, rank, exp, kills, deaths, wins, card, nc, fx) |
| `/goods.json` | 200 | Katalog shop (source: `Shop.dat` — format PB original) |
| `/build.json` | 200 | Versi build: `202610310110` |
| `/static/prefetch.json` | 200 | Manifest aset: 3.976 item, 480MB |
| `/report` | POST only | GET 404, PUT/DELETE 501; tanpa auth → `{"error":"pedido invalido"}` (aman) |
| `/clip?k=<key>` | POST | Upload video klip denúncia (webm) |
| `/acshot?k=<key>` | POST | Upload screenshot anti-cheat |
| `/gmproof?tok=`, `/ncup?tok=`, `/cxup?tok=`, `/pfup?tok=` | upload | **Token di URL query** → risiko leakage via access log/referer |
| `/cdn-cgi/trace` | 200 | CF debug: IP asli, geo, TLS info |
| `/api/` | 403 | Closed ("forbidden") |
| `/sw.js` | 200 | Service worker; **komentar bocor stack Python** |
| `robots.txt` | 200 | Disallow `/api/`, `/clip/` (info minor) |
| `/a/<hash>` | 404* | CDN aset (FNV-1a hash path); no directory listing |

**Tidak ditemukan**: `.env`, `.git`, `package.json`, `config.json`, backup files, `/.htaccess`, `server-status` — bersih.

---

## 7. Anti-Cheat & Ekonomi

- Server klaim validasi tiap tembakan & gerakan; match records (posisi + shots) disimpan untuk analisis.
- Screenshot otomatis via `/acshot`, klip via `/clip`; **komunitas voting** (`denvote`) di tab Denúncias.
- **WhatsApp alert integration** (`wa_admin.js`): alert anti-hack ke grup WA admin; perintah `BANIR 123` / `IGNORAR 123` / `PROVAS 123`. Nomor admin WA publik: **+55 19 98367-5300** (self-published di legal.html).
- Ekonomi: PB Coin (premium), cash, gold, token (crates); payment: **PIX**, **crypto** (wallet address ditampilkan di UI shop), reseller WhatsApp.
- Battle pass, VIP, crates, clan tournaments — semua via protokol WS di atas.

---

## 8. Temuan (Prioritas)

### 🔴 Tinggi
1. **Origin node exposed tanpa WAF**: `sgd.pbmobile.app` → nginx/1.18.0 (EOL) langsung ke internet, port 22/8766/3000/8080/9222 terbuka. Satu RCE di nginx/node = akses penuh. Firewall port, update nginx, tutup 9222/3000/8080 kalau tidak dipakai.
2. **Zero security headers**: tanpa CSP + token di sessionStorage, satu XSS = session hijack massal. Minimal: CSP ketat, HSTS, XFO, XCTO.

### 🟡 Sedang
3. **Stack disclosure**: nginx version banner, `server.py`/`webpush.py` di komentar sw.js, `/build.json`, `/home.json` statistik internal. Matikan server_tokens, hapus komentar, minimalisasi endpoint info.
4. **Upload token di URL query** (`?tok=`, `?k=`): bisa kepeleset ke access log Cloudflare, referer, history. Pindah ke header/body.
5. **Guest access penuh ke lobby**: chat global tanpa akun → surface spam/harassment/scraping. Pertimbangkan minimal Turnstile untuk WS hello.
6. **No rate limiting WS session creation**: mudah bikin ribuan guest session (resource abuse). Tambah rate limit per-IP di /ws.
7. **Sequential message ID** (`mid`) di chat + room `ban` array + `host` session ID di room list — enumerasi & scraping trivial.

### 🟢 Rendah
8. SRI cuma di game bundle.js & CF beacon — script lobby lain (client.js dll) tanpa integrity.
9. `robots.txt` disclose path sensitif (`/api/`, `/clip/`).
10. Versi `i18n.js` beda antar halaman (`v=...110` vs `v=...140`) — cache inconsistency minor.
11. Halaman SEO statis (5 halaman) — surface minimal, aman.

### ✅ Yang sudah baik
- Cloudflare WAF + Turnstile di login
- SRI di bundle game
- Auth server-side di admin commands (silent reject untuk non-staff)
- TRACE disabled, method restriction di /report
- Tidak ada stack trace/error leak
- Tidak ada file sensitif terekspos (.env/.git/backup)
- WS wajib TLS di produksi
- Password di-hash server-side (klaim), anti-cheat server-side shot validation

---

## 9. Rekomendasi Prioritas

1. **Firewall origin node**: tutup 22 (atau IP-whitelist), 3000, 8080, 9222, 8766 dari publik; update nginx ke versi supported; `server_tokens off`.
2. **Security headers**: CSP (default-src 'self'; connect-src wss://pbmobile.app), HSTS max-age 1 tahun + preload, XFO DENY, XCTO nosniff, Referrer-Policy strict-origin.
3. **Rate limiting** di `/ws` handshake + `/report` + `/clip` per-IP (Cloudflare Rate Limiting Rules atau origin-side).
4. **Pindah token upload** dari query string ke header Authorization/body.
5. **Minimalisasi info**: hapus komentar stack di sw.js, tutup `/build.json` & `/cdn-cgi/trace` (kalau tidak dipakai client), matikan banner versi.
6. **Anomaly detection**: flag resume dengan sid/tok invalid berulang dari IP yang sama.

---

## 10. Lampiran — File Terkumpul

- `D:\pentest_learn\pbmobile\js\` — 19 client JS bundles (client.js 288KB, bundle.js 1MB, dll)
- `D:\pentest_learn\pbmobile\ws_recon.js` — script probe WS (hello/resume/malformed/admin)
- `D:\pentest_learn\pbmobile\ws_origin.js` — probe port origin
