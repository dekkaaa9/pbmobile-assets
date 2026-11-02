'use strict';
// ============================================================
//  index.js — entry point server clone PB Mobile.
//
//    node server/index.js [--port 8787] [--host 0.0.0.0]
//
//  Rute:
//    GET  /<apa aja>      -> statis dari site/
//    WS   /ws             -> lobby  (semua pesan JSON)
//    WS   /b2?k=<key>     -> battle (CUMA frame biner `st`)
//
//  ZERO dependency luar. Cuma butuh Node >= 18.
// ============================================================

const http = require('http');
const path = require('path');
const fs = require('fs');
const { WsServer } = require('./wssrv');
const { createStatic } = require('./static');
const { Lobby } = require('./lobby');

// ---- argumen ----
const args = process.argv.slice(2);
function arg(name, def) {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}

const PORT = parseInt(arg('port', process.env.PORT || '8787'), 10);
const HOST = arg('host', process.env.HOST || '0.0.0.0');
const SITE = path.resolve(__dirname, '..', 'site');
const DATA = path.resolve(__dirname, '..', 'data');

if (!fs.existsSync(SITE)) {
  console.error('[fatal] folder site/ tidak ada: ' + SITE);
  console.error('        Extract site-runtime.tar.gz dulu di folder pbmobile/.');
  process.exit(1);
}
try { fs.mkdirSync(DATA, { recursive: true }); } catch (_) {}

// ---- HTTP + statis ----
const serveStatic = createStatic(SITE, { index: ['index.html'] });

const server = http.createServer((req, res) => {
  // rute eksplisit /jogo -> jogo.html (game page; kalau nggak ada, index)
  const p = (req.url || '/').split('?')[0];
  if (p === '/jogo' || p === '/jogo/') {
    const f = path.join(SITE, 'jogo.html');
    if (fs.existsSync(f)) { req.url = '/jogo.html' + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''); }
  }
  serveStatic(req, res, () => { res.writeHead(404); res.end('not found'); });
});

// ---- WebSocket ----
const wss = new WsServer();
// PB_DB bisa dipakai buat nunjuk file DB lain (tes isolasi, staging).
const dbFile = process.env.PB_DB ? path.resolve(process.env.PB_DB) : path.join(DATA, 'pb.json');
const lobby = new Lobby({ dbFile });

wss.on('/ws', (conn, req) => {
  lobby.attach(conn, req);
});

wss.on('/b2', (conn, req) => {
  const q = new URLSearchParams((req.url || '').split('?')[1] || '');
  const key = q.get('k') || '';
  // attachBattle sudah: cari battle + sesi pemilik key + daftarkan ke battle.sockets
  if (!lobby.attachBattle(conn, key)) return;
});

// alias path battle lain yang mungkin dipakai client
wss.on('/b1', (conn) => { conn.close(1008, 'use /b2'); });

server.on('upgrade', (req, sock, head) => {
  try { wss.handleUpgrade(req, sock, head); }
  catch (e) { console.error('[ws] upgrade gagal:', e.message); try { sock.destroy(); } catch (_) {} }
});

// ---- jalan ----
server.listen(PORT, HOST, () => {
  const addr = server.address();
  console.log('');
  console.log('  ============================================');
  console.log('   PBMobile clone server');
  console.log('  ============================================');
  console.log('   HTTP   http://' + HOST + ':' + addr.port);
  console.log('   WS     ws://' + HOST + ':' + addr.port + '/ws');
  console.log('   WS     ws://' + HOST + ':' + addr.port + '/b2?k=<key>');
  console.log('   Game   http://' + HOST + ':' + addr.port + '/jogo');
  console.log('   Aset   ' + SITE);
  console.log('   Data   ' + DATA);
  console.log('   Senjata ' + lobby.weapons.length + ' termuat');
  console.log('  ============================================');
  console.log('');
  console.log('   Buka di browser, klik JOGAR, bikin/ masuk sala,');
  console.log('   klik INICIAR -> game mulai.');
  console.log('');
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error('[fatal] port ' + PORT + ' sudah dipakai. Pakai --port lain.');
  else console.error('[fatal]', e.message);
  process.exit(1);
});

// ---- shutdown bersih ----
function shutdown() {
  console.log('\n[shutdown] menutup...');
  try { lobby.db.flush(); } catch (_) {}
  try { server.close(); } catch (_) {}
  setTimeout(() => process.exit(0), 300);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = { server, lobby };
