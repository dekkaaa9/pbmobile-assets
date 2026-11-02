# Deploy ke VPS (biar bisa dibuka orang)

Client butuh **dua** hal: (a) file statis dilayani via HTTP, dan (b) WebSocket ke
server lobby + battle. Keduanya dilayani satu proses: `node server/index.js`.

Panduan ini buat VPS kecil (1-2 vCPU / ~1 GB RAM, nggak ada systemd). Kalau VPS
lu lebih gede, tahapannya sama - cuma nggak perlu swap dan bisa pakai pm2.

---

## 1. Siapkan VPS

Ubuntu 22.04, minimal **1 vCPU / 1 GB RAM / 10 GB disk**. Nggak perlu GPU - semua
rendering di browser.

```bash
apt update && apt install -y nodejs npm git
node -v    # minimal 18
```

Kalau RAM kecil (< 1 GB), tambah swap 2 GB:

```bash
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
free -h    # pastikan Swap kebaca
```

---

## 2. Taruh aset + kode

```bash
mkdir -p /root/pbmobile && cd /root/pbmobile

# dari lokal Windows (PowerShell):
scp -P PORT dist\site-runtime.tar.gz root@IP_VPS:/root/pbmobile/
scp -P PORT dist\site-export.tar.gz  root@IP_VPS:/root/pbmobile/     # opsional

# di VPS:
tar -xzf site-runtime.tar.gz          # -> site/
tar -xzf site-export.tar.gz -C site   # -> site/export/  (opsional)

git clone https://github.com/dekkaaa9/pbmobile-assets.git /root/pbmobile/repo
cp -r /root/pbmobile/repo/server /root/pbmobile/
```

Verifikasi aset lengkap:

```bash
find /root/pbmobile/site -type f | wc -l    # harus ~12.700
du -sh /root/pbmobile/site                  # harus ~1,26 GB
```

---

## 3. Jalanin server

```bash
cd /root/pbmobile
setsid nohup node server/index.js --port 8787 > server.log 2>&1 &
sleep 2
curl -sI http://localhost:8787/index.html | head -1     # harus 200
curl -sI http://localhost:8787/jogo      | head -1     # harus 200
tail -20 server.log
```

`setsid nohup` dipakai karena container/VPS kecil sering nggak ada systemd, jadi
proses harus lepas dari shell session.

Kalau mau auto-restart, pakai pm2:

```bash
npm install -g pm2
pm2 start server/index.js --name pbmobile -- --port 8787
pm2 save && pm2 startup
```

---

## 4. Buka ke publik

VPS sering nggak bisa bind port 80/443 langsung (di belakang NAT / edge provider).
Solusi paling gampang: **Cloudflare Tunnel** - gratis, HTTPS otomatis, nggak perlu
buka port, dan nge-proxy WebSocket dengan benar.

```bash
# install
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
  -o /usr/local/bin/cloudflared && chmod +x /usr/local/bin/cloudflared

# quick tunnel (dapat URL *.trycloudflare.com, ganti tiap restart)
setsid nohup cloudflared tunnel --url http://localhost:8787 > tunnel.log 2>&1 &
sleep 6 && grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' tunnel.log | head -1
```

URL hasil grep itu yang dibagi ke orang.

**Nggak perlu patch kode client.** `net.js` bangun URL WebSocket dari
`location` sendiri:

```js
r = () => "https:" === location.protocol
  ? "wss://" + location.host + "/ws"
  : "ws://" + location.hostname + ":" + ...
```

Jadi kalau orang buka lewat `https://xxx.trycloudflare.com`, lobby WS otomatis
nyambung ke `wss://xxx.trycloudflare.com/ws`.

Buat battle WS, server kirim pesan `srly` berisi URL absolut
(`wss://<host>/b2`) yang dibangun dari header `Host` request upgrade - termasuk
`X-Forwarded-Host` kalau ada. Jadi path-nya juga bener otomatis.

> Buat domain tetap (nggak ganti tiap restart), bikin named tunnel +
> `cloudflared tunnel route dns`. Butuh akun Cloudflare + domain sendiri.

---

## 5. Verifikasi dari luar

```bash
# dari lokal, ganti URL dengan hasil tunnel:
curl -sI https://xxx.trycloudflare.com/ | head -1
```

Buka `https://xxx.trycloudflare.com` di browser, klik **JOGAR**, bikin sala, klik
**INICIAR**. Yang harus keliatan:

1. `welcome` dengan `bin:true` (gate buat battle WS)
2. Daftar room keisi (8 room bawaan)
3. Habis INICIAR, halaman pindah ke `/jogo`
4. HUD nongol, bot gerak, match jalan

Kalau `/jogo` nggak bisa muat `bundle.js`, cek `server/index.js` - route `/jogo`
harus nge-rewrite ke `jogo.html`.

---

## 6. Troubleshooting

| Gejala | Sebab | Solusi |
|---|---|---|
| `bundle.js` 404 | aset belum diekstrak | `tar -xzf site-runtime.tar.gz` di `site/` |
| WS gagal connect | cloudflared mati | cek `tunnel.log`, restart `cloudflared` |
| Game loading terus | map nggak valid buat mode | `server/config.js` `mapsFor()` - tiap mode punya daftar map sendiri |
| `srly` URL salah host | ada proxy yang nggak forward `Host` | tambahin forwarding `X-Forwarded-Host` |
| OOM / proses mati | RAM habis | tambah swap (tahap 1), kurangi `bots` per room |
| Room kosong semua | seed room gagal | cek `server.log` - `createRoom()` nggak nge-handle exception |

Cek log realtime:

```bash
tail -f /root/pbmobile/server.log
```

Cek proses:

```bash
ps aux | grep '[n]ode server/index.js' | awk '{print $2}'
```

Restart:

```bash
ps aux | grep '[n]ode server/index.js' | awk '{print $2}' | xargs -r kill
cd /root/pbmobile && setsid nohup node server/index.js --port 8787 > server.log 2>&1 &
```

> **Jangan** `pkill -f 'node server'` - pattern-nya bisa kecocok sama command
> shell lu sendiri dan prosesnya ke-kill duluan.

---

## 7. Keamanan

- **Rotasi password root** kalau pernah dipakai lewat chat/shared terminal.
- Migrasi ke SSH key, matiin password auth:

```bash
# di lokal:
ssh-keygen -t ed25519 -f ~/.ssh/pbmobile -N '""'
ssh-copy-id -i ~/.ssh/pbmobile.pub -p PORT root@IP_VPS

# di VPS:
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart sshd    # atau: service ssh restart
```

- Repo-nya **private** - aset PB/Garena, risiko DMCA kalau publik.
- Cloudflare quick tunnel URL itu publik. Siapa aja yang tau URL bisa main.
  Kalau mau dibatasi, pakai named tunnel + Cloudflare Access.
