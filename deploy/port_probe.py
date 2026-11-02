#!/usr/bin/env python3
# port_probe.py — buka listener di beberapa port umum, biar bisa dites
# reachability dari luar (proxy mana yang di-forward?).
import socket, sys, time, os

PORTS = [80, 443, 3000, 8080, 8000, 8787, 9000, 42405]
socks = []
for p in PORTS:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.bind(("0.0.0.0", p))
        s.listen(8)
        socks.append((p, s))
        print("LISTEN OK   port %d" % p, flush=True)
    except Exception as e:
        print("LISTEN FAIL port %d  (%s)" % (p, e), flush=True)

print("READY", flush=True)
# tahan 180 detik
t0 = time.time()
while time.time() - t0 < 180:
    time.sleep(1)
    # accept dan tutup biar probe dapat koneksi
    for p, s in socks:
        try:
            s.settimeout(0.05)
            c, _ = s.accept()
            c.close()
        except Exception:
            pass
print("DONE", flush=True)
