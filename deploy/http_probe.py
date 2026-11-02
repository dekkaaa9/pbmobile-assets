#!/usr/bin/env python3
# http_probe.py — HTTP responder di banyak port, balas header yang mengidentifikasi
# port. Dipakai buat memastikan proxy beneran FORWARD ke container (bukan cuma
# accept TCP di edge).
import socket, threading, time

PORTS = [80, 443, 3000, 8080, 8000, 8787, 9000, 42405]

def handle(conn, port):
    try:
        conn.settimeout(3)
        try:
            conn.recv(4096)
        except Exception:
            pass
        body = ("PORT_%d_OK\n" % port).encode()
        conn.sendall(b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n" +
                     b"Content-Length: " + str(len(body)).encode() + b"\r\n" +
                     b"Connection: close\r\n\r\n" + body)
    except Exception:
        pass
    finally:
        try: conn.close()
        except Exception: pass

def serve(port):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        s.bind(("0.0.0.0", port)); s.listen(16)
    except Exception as e:
        print("FAIL bind %d: %s" % (port, e), flush=True); return
    print("SERVING %d" % port, flush=True)
    while True:
        try:
            c, _ = s.accept()
            threading.Thread(target=handle, args=(c, port), daemon=True).start()
        except Exception:
            pass

for p in PORTS:
    threading.Thread(target=serve, args=(p,), daemon=True).start()

time.sleep(600)
print("DONE", flush=True)
