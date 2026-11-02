'use strict';
// ============================================================
//  wssrv.js — WebSocket server RFC 6455, ZERO dependency.
//  Cuma butuh node:crypto + node:http. Sengaja nggak pakai `ws`
//  biar server bisa jalan tanpa npm install sama sekali.
//
//  Aturan wajib RFC:
//    - client -> server : frame HARUS di-mask
//    - server -> client : frame TIDAK BOLEH di-mask
// ============================================================

const crypto = require('crypto');
const { EventEmitter } = require('events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const OP = { CONT: 0, TEXT: 1, BIN: 2, CLOSE: 8, PING: 9, PONG: 10 };

class WsConn extends EventEmitter {
  constructor(sock, head) {
    super();
    this.sock = sock;
    this.readyState = 1; // OPEN
    this._buf = head && head.length ? Buffer.from(head) : Buffer.alloc(0);
    this._frag = [];      // fragment buffer
    this._fragOp = 0;
    this._closed = false;
    sock.on('data', (d) => this._onData(d));
    sock.on('error', () => this._destroy());
    sock.on('close', () => this._onClose());
    sock.on('end', () => this._onClose());
    this._parse();
  }

  // ---- parsing ----
  _onData(d) {
    if (this._closed) return;
    this._buf = this._buf.length ? Buffer.concat([this._buf, d]) : d;
    this._parse();
  }

  _parse() {
    while (!this._closed && this._buf.length >= 2) {
      const b0 = this._buf[0];
      const b1 = this._buf[1];
      const fin = (b0 & 0x80) !== 0;
      const op = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;

      if (len === 126) {
        if (this._buf.length < 4) return;
        len = this._buf.readUInt16BE(2); off = 4;
      } else if (len === 127) {
        if (this._buf.length < 10) return;
        const big = this._buf.readBigUInt64BE(2);
        len = Number(big); off = 10;
      }
      let mask;
      if (masked) {
        if (this._buf.length < off + 4) return;
        mask = this._buf.subarray(off, off + 4); off += 4;
      }
      if (this._buf.length < off + len) return;

      let payload = this._buf.subarray(off, off + len);
      if (masked) {
        const out = Buffer.allocUnsafe(len);
        for (let i = 0; i < len; i++) out[i] = payload[i] ^ mask[i & 3];
        payload = out;
      }
      this._buf = this._buf.subarray(off + len);

      // control frames boleh diselipin di tengah fragmentasi
      if (op === OP.CLOSE) { this._handleClose(payload); return; }
      if (op === OP.PING) { this._sendFrame(OP.PONG, payload); continue; }
      if (op === OP.PONG) { this.emit('pong', payload); continue; }

      if (op === OP.CONT) {
        if (!this._fragOp) continue; // kontinuasi tanpa awal — abaikan
        this._frag.push(payload);
        if (fin) {
          const full = Buffer.concat(this._frag);
          const o = this._fragOp; this._frag = []; this._fragOp = 0;
          this._deliver(o, full);
        }
        continue;
      }

      // op = TEXT atau BIN
      if (fin) { this._deliver(op, payload); }
      else { this._fragOp = op; this._frag = [payload]; }
    }
  }

  _deliver(op, payload) {
    if (op === OP.TEXT) this.emit('message', payload.toString('utf8'), false);
    else if (op === OP.BIN) this.emit('message', payload, true);
  }

  _handleClose(payload) {
    let code = 1000, reason = '';
    if (payload && payload.length >= 2) {
      code = payload.readUInt16BE(0);
      reason = payload.subarray(2).toString('utf8');
    }
    if (!this._closed) {
      this._closed = true;
      try { this._sendFrame(OP.CLOSE, payload && payload.length ? payload : Buffer.alloc(0)); } catch (_) {}
    }
    this.readyState = 3;
    try { this.sock.end(); } catch (_) {}
    this.emit('close', code, reason);
  }

  _onClose() {
    if (this._closed) return;
    this._closed = true;
    this.readyState = 3;
    this.emit('close', 1006, '');
  }

  _destroy() {
    if (this._closed) return;
    this._closed = true;
    this.readyState = 3;
    try { this.sock.destroy(); } catch (_) {}
    this.emit('close', 1006, '');
  }

  // ---- writing ----
  _sendFrame(op, payload) {
    if (this._closed || this.sock.destroyed) return;
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.allocUnsafe(2);
      header[0] = 0x80 | op;      // FIN + opcode
      header[1] = len;            // server TIDAK mask
    } else if (len < 65536) {
      header = Buffer.allocUnsafe(4);
      header[0] = 0x80 | op;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.allocUnsafe(10);
      header[0] = 0x80 | op;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    try { this.sock.write(Buffer.concat([header, payload])); }
    catch (_) { this._destroy(); }
  }

  sendText(s) { this._sendFrame(OP.TEXT, Buffer.from(String(s), 'utf8')); }
  sendBin(b) { this._sendFrame(OP.BIN, Buffer.isBuffer(b) ? b : Buffer.from(b)); }
  sendJson(o) { this.sendText(JSON.stringify(o)); }

  ping() { this._sendFrame(OP.PING, Buffer.alloc(0)); }

  close(code = 1000, reason = '') {
    if (this._closed) return;
    const b = Buffer.alloc(2 + Buffer.byteLength(reason));
    b.writeUInt16BE(code, 0);
    b.write(reason, 2);
    this._sendFrame(OP.CLOSE, b);
    this._closed = true;
    this.readyState = 3;
    setTimeout(() => { try { this.sock.end(); } catch (_) {} }, 50);
  }

  get open() { return !this._closed && this.readyState === 1; }
}

// ---- handshake + router ----
class WsServer extends EventEmitter {
  constructor() { super(); this.paths = new Map(); }

  // daftar handler: on(path, (conn, req) => {})
  on(path, fn) { this.paths.set(path, fn); return this; }

  handleUpgrade(req, sock, head) {
    const key = req.headers['sec-websocket-key'];
    if (!key) { sock.destroy(); return; }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    const lines = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      'Sec-WebSocket-Accept: ' + accept,
    ];
    // kalau client minta subprotocol, balas satu (harus cocok)
    const proto = req.headers['sec-websocket-protocol'];
    if (proto) lines.push('Sec-WebSocket-Protocol: ' + String(proto).split(',')[0].trim());
    sock.write(lines.join('\r\n') + '\r\n\r\n');

    const pathname = (req.url || '/').split('?')[0];
    const conn = new WsConn(sock, head);
    const handler = this.paths.get(pathname);
    if (handler) handler(conn, req);
    else { conn.close(1008, 'no route'); return; }
    this.emit('connection', conn, req, pathname);
  }
}

module.exports = { WsServer, WsConn };
