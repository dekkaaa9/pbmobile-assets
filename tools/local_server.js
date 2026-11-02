// local_server.js — server lokal buat nge-boot client ASLI (bundle.js apa adanya)
// dari file yang sudah di-mirror. Ini buat menjawab: "berapa banyak server yang
// benar-benar dibutuhkan?"
//
// Yang disediakan:
//   1. static file   site/            -> /
//   2. aset CDN      site/assets/<api>/<hash> -> /a/<api>/<hash>
//   3. API stub      /home.json /goods.json /build.json (dari mirror)
//   4. lobby WS stub /ws  (balas pesan minimal biar client nggak crash)
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, 'site');
const ASSETS = path.join(SITE, 'assets');
const PORT = Number(process.env.PORT || 8787);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.wav': 'audio/wav',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

function send(res, code, body, headers) {
  const h = Object.assign({ 'Cache-Control': 'no-store' }, headers || {});
  res.writeHead(code, h);
  res.end(body);
}
function sendFile(res, file) {
  const ext = path.extname(file).toLowerCase();
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'not found');
    send(res, 200, buf, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': buf.length,
    });
  });
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = decodeURIComponent(u.pathname);
  const log = (extra) => console.log((new Date().toISOString().slice(11, 19)) + '  ' +
    req.method + ' ' + p + (extra ? '  ' + extra : ''));

  // CORS biar gampang di-debug dari browser
  res.setHeader('Access-Control-Allow-Origin', '*');

  // 1. CDN aset: /a/<api>/<hash>
  const am = p.match(/^\/a\/([a-z]+)\/([0-9a-f]{16})$/i);
  if (am) {
    const f = path.join(ASSETS, am[1], am[2]);
    if (fs.existsSync(f)) { log('-> asset ' + am[1]); return sendFile(res, f); }
    log('-> 404 asset');
    return send(res, 404, 'asset not found');
  }

  // 2. API stub — pakai file mirror kalau ada
  const apiFiles = {
    '/home.json': 'home.json', '/goods.json': 'goods.json',
    '/build.json': 'build.json', '/robots.txt': 'robots.txt',
  };
  if (apiFiles[p] && fs.existsSync(path.join(SITE, apiFiles[p]))) {
    log('-> mirror ' + apiFiles[p]);
    return sendFile(res, path.join(SITE, apiFiles[p]));
  }

  // 3. static
  let file = path.join(SITE, p);
  if (p === '/' || p === '') file = path.join(SITE, 'index.html');
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (fs.existsSync(file) && fs.statSync(file).isFile()) { log('-> static'); return sendFile(res, file); }

  log('-> 404');
  send(res, 404, 'not found: ' + p);
});

// ---- lobby WS stub (tanpa dependensi) ----
// Upgrade handshake manual + frame parser minimal, cukup buat balas pesan teks.
server.on('upgrade', (req, socket) => {
  const u = new URL(req.url, 'http://x');
  console.log('WS upgrade: ' + u.pathname + (u.search || ''));
  const key = req.headers['sec-websocket-key'];
  const accept = require('crypto').createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n');

  const sendMsg = (obj) => {
    const payload = Buffer.from(JSON.stringify(obj));
    const len = payload.length;
    let header;
    if (len < 126) header = Buffer.from([0x81, len]);
    else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(len, 2); }
    else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
    try { socket.write(Buffer.concat([header, payload])); } catch (e) {}
  };

  // balas apa aja dengan objek kosong supaya client nggak crash
  let buf = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    // parse frame sederhana (client selalu mask, teks/binary)
    while (buf.length >= 2) {
      const opcode = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f;
      let off = 2;
      if (len === 126) { if (buf.length < 4) break; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) break; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      let mask;
      if (masked) { if (buf.length < off + 4) break; mask = buf.slice(off, off + 4); off += 4; }
      if (buf.length < off + len) break;
      const payload = buf.slice(off, off + len);
      if (masked) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      buf = buf.slice(off + len);
      if (opcode === 8) { try { socket.end(); } catch (e) {} return; }
      if (opcode === 9) { try { socket.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload])); } catch (e) {} continue; }
      if (opcode === 1 || opcode === 2) {
        let txt = payload.toString('utf8');
        console.log('  WS recv: ' + txt.slice(0, 200));
        try {
          const msg = JSON.parse(txt);
          console.log('  WS t=' + (msg && msg.t));
          // balas minimal supaya client lanjut
          sendMsg({ t: 'pong' });
        } catch (e) {
          console.log('  WS (bukan JSON)');
        }
      }
    }
  });
  socket.on('error', () => {});
  socket.on('close', () => console.log('WS close'));
});

server.listen(PORT, () => {
  console.log('local server: http://localhost:' + PORT);
  console.log('  static  : ' + SITE);
  console.log('  assets  : ' + ASSETS);
  console.log('  api stub: /home.json /goods.json /build.json');
  console.log('  ws stub : /ws (balas {t:"pong"})');
});
