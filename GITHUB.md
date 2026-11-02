# Cara upload ke GitHub

Repo ini **dipisah dua**: yang di-**git** cuma kode + dokumen (8,7 MB), yang
besar (aset 2 GB) lewat **Release**. Alasannya sederhana: GitHub nolak file
> 100 MB, dan repo > 1 GB bikin clone/status lemot. Aset juga nggak pernah
berubah, jadi nggak ada untungnya di-versioning.

---

## Isi repo vs Release

```
REPO GIT (8,7 MB, 196 file)          RELEASE v1.0 (2 file, 1,26 GB)
├── site/static/**     kode client   ├── site-runtime.tar.gz   723 MB
├── site/*.html                     │    site/ lengkap KECUALI export/
├── site/*.json                     │    -> bisa langsung di-serve & jalan
├── site/cc.js                      │
├── tools/**          script        ├── site-export.tar.gz    539 MB
├── cheat/**          userscript    │    site/export/
├── deploy/**         deploy VPS    │    -> GLB, WebP, maps (hasil olahan)
└── *.md              dokumentasi   └── client NGGAK minta ini; buat analisis
```

**Yang NGGAK diupload sama sekali** (`.gitignore`): `tools/node_modules/`,
`site/assets/`, `site/rml/`, `site/export/`, `dist/`, `*.log`, `*.txt`,
`*.tmp`, `vps.js`, `.env`, `*.pem`, `*.key`

> Repo sudah siap — 196 file ter-track, `.git` 8,7 MB. Tinggal push.

---

## Langkah 1 — bikin repo + push

```powershell
cd D:\pentest_learn\pbmobile

# bikin repo Private langsung dari CLI (butuh GitHub CLI: winget install GitHub.cli)
gh repo create pbmobile-clone --private --source=. --push

# --- ATAU manual kalau nggak pakai gh ---
# 1. Bikin repo di https://github.com/new  -> nama: pbmobile-clone -> Private
#    JANGAN centang "Add a README"
# 2. Lalu:
git remote add origin https://github.com/USERNAME_LU/pbmobile-clone.git
git push -u origin main
```

Pas diminta login pakai **Personal Access Token**, bukan password:
<https://github.com/settings/tokens> → scope `repo`

---

## Langkah 2 — upload Release (aset)

Repo push cuma 8,7 MB, jadi cepat. Aset 1,26 GB upload lewat Release:

```powershell
# tag dulu
git tag v1.0
git push origin v1.0

# bikin release + upload 2 file aset
gh release create v1.0 `
  dist/site-runtime.tar.gz `
  dist/site-export.tar.gz `
  --title "v1.0 - source + aset lengkap" `
  --notes "site-runtime.tar.gz = client lengkap (tinggal serve). site-export.tar.gz = hasil olahan GLB/WebP/maps."
```

Upload 1,26 GB koneksi 1,1 MB/s ≈ **20 menit**. Jangan tutup terminal.

---

## Langkah 3 — cara orang lain pakai

```bash
git clone https://github.com/USERNAME_LU/pbmobile-clone.git
cd pbmobile-clone

# download 2 file dari https://github.com/USERNAME_LU/pbmobile-clone/releases/tag/v1.0
tar -xzf site-runtime.tar.gz        # -> folder site/
tar -xzf site-export.tar.gz -C site # -> folder site/export/

node tools/local_server.js          # buka http://localhost:8787
```

Kalau cuma mau baca kode / reverse engineering, `site-runtime.tar.gz` nggak
perlu — `site/static/game/` sudah ada di repo.

---

## Kalau nanti mau update aset

Jangan commit ulang aset ke git. Cuma ganti file di `dist/` lalu:

```powershell
gh release upload v1.0 dist/site-runtime.tar.gz --clobber
gh release upload v1.0 dist/site-export.tar.gz --clobber
```

---

## Catatan

- Repo **Private** — aset & kode ini properti PB/Garena. Jangan di-public.
- `tools/build_release.js` dipakai buat generate ulang 2 tarball di `dist/`.
