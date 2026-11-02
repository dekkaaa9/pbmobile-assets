# Cara upload ke GitHub

Panduan lengkap buat upload **source code + aset** PB Mobile ke GitHub.
Jalankan perintah ini sendiri di PowerShell dari `D:\pentest_learn\pbmobile`.

---

## 0. Vonis ukuran (kenapa nggak bisa langsung `git add .`)

Gua ukur dulu:

| Metrik | Angka | Keterangan |
|---|---|---|
| File > 100 MB | **0** | ✅ batas hard GitHub aman |
| File terbesar | 36 MB | aman |
| **Total `site/`** | **2,05 GB** | ⚠️ di atas rekomendasi 1 GB GitHub |
| Kode doang (102 file) | 63 MB | ✅ kecil |
| Runtime yang beneran dibutuhkan | 1,25 GB / 12.867 file | — |
| Tarball runtime (`dist/`) | 723 MB | ✅ di bawah limit Release 2 GB |

GitHub nggak nolak 2 GB, tapi repo jadi berat: clone lambat, `git status` lambat,
dan GitHub kasih warning. **Jadi dipisah:** kode di git, aset di Release.

---

## 1. ⚠️ Bikin repo PRIVATE — ini penting

Isi repo ini **kode dan aset copyrighted Point Blank / Garena**. Kalau lu bikin
**public**, itu redistribusi — repo lu kena DMCA takedown dan semua kerjaan lu
ilang. Private repo punya limit ukuran yang sama tapi nggak ada risiko itu.

Di halaman "Create a new repository" GitHub, pilih **Private**, BUKAN Public.

---

## 2. Siapkan repo (kode doang)

`.gitignore` sudah gua siapin — dia nge-exclude `site/assets/`, `site/export/`,
`site/rml/`, `tools/node_modules/`, `*.log`, dan `vps.js` (ada kredensial).

Cek dulu apa yang mau masuk (harusnya ~28 MB):

```powershell
cd D:\pentest_learn\pbmobile

# install git dulu kalau belum: https://git-scm.com/download/win
git --version

# init
git init -b main

# lihat apa yang akan di-track (harusnya site/static/**, *.md, tools/**, cheat/**)
git add -A --dry-run
```

Kalau daftarnya udah bener (nggak ada `site/assets/`), lanjut:

```powershell
git add -A
git status --short | Measure-Object -Line    # hitung file yang masuk

git -c user.name="Rabitszz" -c user.email="EMAIL_LU@contoh.com" commit -m "PB Mobile clone: source, tools, docs"
```

Ganti `EMAIL_LU@contoh.com` pakai email GitHub lu.

---

## 3. Push ke GitHub

Bikin repo baru di https://github.com/new (nama: `pbmobile-clone`, **Private**),
terus:

```powershell
git remote add origin https://github.com/USERNAME_LU/pbmobile-clone.git
git push -u origin main
```

`USERNAME_LU` ganti pakai username GitHub lu. Nanti diminta login — pakai
**Personal Access Token**, bukan password GitHub (password udah nggak didukung).

Buat token di: https://github.com/settings/tokens → scope `repo`.

---

## 4. Upload aset sebagai Release (723 MB)

Ini bagian aset-nya. GitHub Release ngizinkan file sampai **2 GB** dan **nggak
ngitung ke ukuran repo** — repo tetap ramping.

### Pakai GitHub CLI (paling gampang)

Install: https://cli.github.com/ (`winget install GitHub.cli`)

```powershell
gh auth login
gh release create v1.0-assets dist\site_runtime.tar.gz `
  --repo USERNAME_LU/pbmobile-clone `
  --title "Aset runtime v1.0" `
  --notes "site/ runtime: 12.867 file, 1.25 GB. Ekstrak ke root repo."
```

### Atau lewat web (nggak perlu install apa-apa)

1. Buka repo → tab **Releases** → **Create a new release**
2. Tag: `v1.0-assets`, title: `Aset runtime v1.0`
3. Drag `dist\site_runtime.tar.gz` ke kotak "Attach binaries"
4. **Publish release**

---

## 5. Verifikasi

```powershell
# cek isi repo (harusnya ringan)
git ls-files | Measure-Object -Line

# cek tarball utuh sebelum upload
certutil -hashfile dist\site_runtime.tar.gz MD5
# harus sama dengan: 7cf809f2a29f1bcd28f0a4ac3f45f0db
```

---

## 6. Buat orang lain (atau lu di mesin lain) — cara pakai

```bash
git clone https://github.com/USERNAME_LU/pbmobile-clone.git
cd pbmobile-clone

# unduh aset dari release, ekstrak
# (lewat web: Releases -> v1.0-assets -> site_runtime.tar.gz)
tar -xzf site_runtime.tar.gz

# jalanin
node tools/local_server.js        # http://localhost:8787
```

---

## 7. Alternatif kalau cara di atas nggak cocok

| Cara | Cocok buat | Catatan |
|---|---|---|
| **Release tarball** (rekomendasi) | backup + distribusi | repo ramping, aset 1 file 723 MB |
| **Git LFS** | mau aset di-track satu-satu | free tier cuma **1 GB storage + 1 GB bandwidth/bln** — 2 GB nggak muat gratis, $5/bln buat 50 GB |
| **Cloudflare R2** | hosting aset + serving | **10 GB gratis, nol biaya egress** — paling pas kalau mau deploy, bukan backup |
| **Push langsung 2 GB** | males pisah | jalan sampai 5 GB, tapi clone/status jadi lambat |

---

## 8. Jangan pernah commit ini

`.gitignore` udah nutup, tapi dobel-check:

- `tools/vps.js` — **udah gua bersihin**, password-nya nggak ada di file lagi (baca dari env `VPS_PASS`)
- `tools/node_modules/` — 7,7 MB dependensi, nggak perlu
- `*.log`, `*.txt` — output sementara
- `dist/` — tarball, masuk ke Release aja

Cek terakhir sebelum push:

```powershell
git ls-files | Select-String -Pattern "vps\.js|node_modules|\.log$|\.txt$"
```

Kalau ada yang muncul, `git rm --cached <file>` dulu.
