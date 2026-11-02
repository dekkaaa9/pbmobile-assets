// make_debug.js — bikin site/debug.html: salinan index.html dengan hook error
// di paling atas <head>, supaya exception asli (bukan "Erro: undefined") kerekam.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, 'site');

const src = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');

const HOOK = `<script>
window.__ERRS = [];
window.addEventListener('error', function (e) {
  window.__ERRS.push({
    kind: 'error', msg: e.message, src: e.filename, line: e.lineno, col: e.colno,
    stack: e.error && e.error.stack ? String(e.error.stack).slice(0, 2000) : null,
    name: e.error && e.error.name, errStr: e.error ? String(e.error).slice(0, 500) : null
  });
  try { console.log('__ERR__ ' + JSON.stringify(window.__ERRS[window.__ERRS.length - 1])); } catch (x) {}
}, true);
window.addEventListener('unhandledrejection', function (e) {
  const r = e.reason;
  window.__ERRS.push({
    kind: 'rejection',
    msg: r && r.message, name: r && r.name,
    stack: r && r.stack ? String(r.stack).slice(0, 2000) : null,
    errStr: r ? String(r).slice(0, 500) : null
  });
  try { console.log('__REJ__ ' + JSON.stringify(window.__ERRS[window.__ERRS.length - 1])); } catch (x) {}
});
// bungkus console.error supaya objek Error ikut terekam lengkap
(function () {
  const orig = console.error;
  console.error = function () {
    try {
      for (const a of arguments) {
        if (a instanceof Error) {
          window.__ERRS.push({ kind: 'console.error', msg: a.message, name: a.name, stack: String(a.stack).slice(0, 2000) });
          orig.call(console, '__CONSOLE_ERR__ ' + a.name + ': ' + a.message);
          if (a.stack) orig.call(console, String(a.stack).slice(0, 2000));
          continue;
        }
      }
    } catch (x) {}
    return orig.apply(console, arguments);
  };
})();
<\/script>
`;

const out = src.replace('<head>', '<head>\n' + HOOK);
if (out === src) { console.log('GAGAL: <head> tidak ditemukan'); process.exit(1); }
fs.writeFileSync(path.join(SITE, 'debug.html'), out, 'utf8');
console.log('tulis site/debug.html (' + out.length + ' bytes)');
