## PBMobile clone — source + aset

Repo ini isinya **kode + dokumentasi doang**. Aset 1,26 GB ada di 2 file di bawah.

### File

| File | Ukuran | Isi |
|---|---|---|
| `site-runtime.tar.gz` | 723 MB | `site/` lengkap kecuali `export/` — **tinggal di-serve, langsung jalan** |
| `site-export.tar.gz` | 539 MB | `site/export/` — GLB (340), WebP (8.286), maps (35), sound (38). Buat analisis/Blender, client nggak minta |

Dipisah 2 file karena `site/` utuh 2,05 GB, lebih dari limit GitHub 2 GB per file.

### Cara pakai

```bash
git clone https://github.com/dekkaaa9/pbmobile-assets.git
cd pbmobile-assets

# download 2 file di atas, lalu:
tar -xzf site-runtime.tar.gz          # -> folder site/ (lengkap, bisa jalan)
tar -xzf site-export.tar.gz -C site   # -> folder site/export/ (opsional)

node tools/local_server.js
# buka http://localhost:8787
```

Kalau cuma mau baca kode / reverse engineering, `site-runtime.tar.gz` nggak perlu —
`site/static/game/` udah ada di repo.

### Isi

- `site/static/game/bundle.js` — logika game 1 MB (obfuscated), versi beautify 30.504 baris
- `site/static/game/pb.js` — loader aset + `assetUrl()`
- `site/static/game/net.js` — WebSocket lobby + battle
- `site/static/game/weapons.json` — 6.109 senjata
- `site/assets/` — 12.692 file PBM1 (mesh, tekstur, skinned, anim, sound, weapon)
- `tools/` — 50 script build/deploy/analisis
- `PROTOKOL.md` — protokol lobby (~50 tipe pesan) + battle (codec `st`, 20 Hz) lengkap

### Status

Client jalan 100% offline. **Server multiplayer belum ada** — semuanya udah
terpetakan di `PROTOKOL.md`.

---

Aset & kode game properti PB/Garena. Buat riset & edukasi.
