'use strict';
// ============================================================
//  static.js — nyajiin folder site/ lewat HTTP.
//  NOL request keluar. Upgrade WebSocket didelegasi ke WsServer.
//
//  Penting: bundle.js cek document.currentScript origin + path
//  (/static/game/bundle.js). Harus dilayani dari path itu.
// ============================================================

const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.wasm': 'application/wasm',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function mimeOf(p) {
  const e = path.extname(p).toLowerCase();
  return MIME[e] || 'application/octet-stream';
}

// path aman: nolak traversal
function safeJoin(root, urlPath) {
  let p = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const full = path.normalize(path.join(root, p));
  const r = path.resolve(root);
  if (full !== r && !full.startsWith(r + path.sep)) return null;
  return full;
}

function createStatic(root, opts) {
  const o = opts || {};
  const indexFiles = o.index || ['index.html'];

  return function serve(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { next(); return; }

    const full = safeJoin(root, req.url || '/');
    if (!full) { res.writeHead(403); res.end('forbidden'); return; }

    let stat;
    try { stat = fs.statSync(full); } catch (_) { stat = null; }

    if (stat && stat.isDirectory()) {
      for (const ix of indexFiles) {
        try {
          const s2 = fs.statSync(path.join(full, ix));
          if (s2.isFile()) return _send(req, res, path.join(full, ix), s2);
        } catch (_) {}
      }
      res.writeHead(404); res.end('not found'); return;
    }

    if (!stat) { res.writeHead(404); res.end('not found'); return; }
    _send(req, res, full, stat);
  };
}

function _send(req, res, file, stat) {
  const headers = {
    'Content-Type': mimeOf(file),
    'Content-Length': stat.size,
    'Cache-Control': 'public, max-age=3600',
    'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff',
  };

  // Range (buat audio/video seek)
  const range = req.headers.range;
  if (range && /^bytes=\d*-\d*$/.test(range)) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m[1] ? parseInt(m[1], 10) : 0;
    let end = m[2] ? parseInt(m[2], 10) : stat.size - 1;
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= stat.size) {
      res.writeHead(416, { 'Content-Range': 'bytes */' + stat.size }); res.end(); return;
    }
    headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + stat.size;
    headers['Content-Length'] = end - start + 1;
    res.writeHead(206, headers);
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, headers);
  if (req.method === 'HEAD') { res.end(); return; }
  const s = fs.createReadStream(file);
  s.on('error', () => { try { res.destroy(); } catch (_) {} });
  s.pipe(res);
}

module.exports = { createStatic, mimeOf };
