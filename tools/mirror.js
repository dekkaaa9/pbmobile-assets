// mirror.js — download the full PBMobile asset set into site/assets/
// Source of truth: /static/prefetch.json (3976 items, ~480MB)
// Features: concurrency, retry with backoff, resume (skips existing files of
// the right size), progress log, resumable state file.
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, 'site');
const ASSETS = path.join(SITE, 'assets');
const PREFETCH = path.join(SITE, 'static', 'prefetch.json');
const STATE = path.join(ROOT, 'mirror_state.json');
const LOG = path.join(ROOT, 'mirror.log');

const CONC = Number(process.env.CONC || 8);
const RETRIES = 4;
const ONLY = process.env.ONLY || ''; // e.g. ONLY=tex to mirror just one api

function log(msg) {
  const line = new Date().toISOString().slice(11, 19) + ' ' + msg;
  console.log(line);
  fs.appendFileSync(LOG, line + '\n');
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch (e) { return { done: {}, fail: {} }; }
}
function saveState(st) { fs.writeFileSync(STATE, JSON.stringify(st)); }

function head(url) {
  return new Promise((res, rej) => {
    const req = https.request(url, { method: 'HEAD', timeout: 30000 }, r => {
      res({ status: r.statusCode, len: Number(r.headers['content-length'] || 0) });
      r.resume();
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', rej);
    req.end();
  });
}

function download(url, dest, expected) {
  return new Promise((res, rej) => {
    const req = https.get(url, { timeout: 120000 }, r => {
      if (r.statusCode !== 200) { r.resume(); return rej(new Error('HTTP ' + r.statusCode)); }
      const tmp = dest + '.part';
      const out = fs.createWriteStream(tmp);
      let got = 0;
      r.on('data', c => { got += c.length; });
      r.pipe(out);
      out.on('finish', () => {
        out.close(() => {
          if (expected && got !== expected) {
            fs.unlink(tmp, () => {});
            return rej(new Error('size mismatch ' + got + ' != ' + expected));
          }
          fs.renameSync(tmp, dest);
          res(got);
        });
      });
      out.on('error', e => { fs.unlink(tmp, () => {}); rej(e); });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', e => { try { fs.unlink(dest + '.part', () => {}); } catch (_) {} rej(e); });
  });
}

async function withRetry(fn, n) {
  let last;
  for (let i = 0; i < n; i++) {
    try { return await fn(); } catch (e) { last = e; if (i < n - 1) await new Promise(r => setTimeout(r, 800 * (i + 1))); }
  }
  throw last;
}

async function main() {
  const pf = JSON.parse(fs.readFileSync(PREFETCH, 'utf8'));
  let items = pf.items;
  if (ONLY) items = items.filter(x => x.api === ONLY);
  log('mirror start: ' + items.length + ' items' + (ONLY ? ' (api=' + ONLY + ')' : '') + ' conc=' + CONC);

  const st = loadState();
  let ok = 0, skip = 0, fail = 0, bytes = 0;
  const queue = items.slice();

  async function worker() {
    while (queue.length) {
      const it = queue.shift();
      const dest = path.join(ASSETS, it.api, path.basename(it.u));
      const key = it.api + '/' + path.basename(it.u);
      try {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        if (fs.existsSync(dest) && fs.statSync(dest).size === it.bytes) { skip++; st.done[key] = 1; continue; }
        const url = 'https://pbmobile.app' + it.u;
        const n = await withRetry(() => download(url, dest, it.bytes), RETRIES);
        ok++; bytes += n; st.done[key] = 1; delete st.fail[key];
        if (ok % 50 === 0) { log('progress ok=' + ok + ' skip=' + skip + ' fail=' + fail + ' left=' + queue.length); saveState(st); }
      } catch (e) {
        fail++; st.fail[key] = String(e.message || e).slice(0, 120);
        if (fail <= 20) log('FAIL ' + key + ' : ' + st.fail[key]);
      }
    }
  }

  const t0 = Date.now();
  await Promise.all(Array.from({ length: CONC }, worker));
  saveState(st);
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  log('mirror done: ok=' + ok + ' skip=' + skip + ' fail=' + fail + ' bytes=' + (bytes / 1048576).toFixed(1) + 'MB in ' + secs + 's');
  const fails = Object.keys(st.fail);
  if (fails.length) log('remaining failures: ' + fails.length + ' (re-run to retry)');
}

main().catch(e => { log('FATAL ' + (e && e.stack || e)); process.exit(1); });
