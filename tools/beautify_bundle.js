// beautify3.js — js-beautify mengorupsi template literal bersarang (`${` -> `$ {`).
// Solusi: ekstrak SEMUA template literal jadi placeholder sebelum beautify,
// lalu restore setelah. Placeholder adalah identifier biasa sehingga js-beautify
// tidak pernah menyentuh isi template.
//
// Scanner WAJIB rekursif dan paham:
//   - regex literal (kalau tidak, regex ber-quote bikin desync)
//   - string, komentar
//   - template literal bersarang, dan `{}` DI DALAM `${...}` (object literal)
//     yang harus di-balance, bukan dianggap penutup `${`
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'site/static/game/bundle.js');
const OUT = path.join(ROOT, 'site/static/game/bundle.readable.js');

const beautify = require(path.join(ROOT, 'tools/node_modules/js-beautify/js/lib/beautify.js')).js_beautify;
const src = fs.readFileSync(SRC, 'utf8');

const PFX = '__PBTPL_';
if (src.includes(PFX)) { console.log('FATAL: prefix tabrakan di source'); process.exit(1); }

const KW_REGEX = /^(return|typeof|instanceof|in|of|new|delete|void|do|else|case|yield|await)$/;

// ---- scanner primitif ----
function scanString(s, i) {           // s[i] adalah quote
  const q = s[i];
  let j = i + 1;
  while (j < s.length) {
    if (s[j] === '\\') { j += 2; continue; }
    if (s[j] === q) return j + 1;
    if (s[j] === '\n') return j;
    j++;
  }
  return s.length;
}
function scanLineComment(s, i) { let j = i + 2; while (j < s.length && s[j] !== '\n') j++; return j; }
function scanBlockComment(s, i) {
  let j = i + 2;
  while (j < s.length && !(s[j] === '*' && s[j + 1] === '/')) j++;
  return Math.min(s.length, j + 2);
}
function scanRegex(s, i, last) {      // s[i] === '/'
  let j = i + 1, inClass = false;
  while (j < s.length) {
    const d = s[j];
    if (d === '\\') { j += 2; continue; }
    if (d === '\n') return -1;        // bukan regex
    if (d === '[') inClass = true;
    else if (d === ']') inClass = false;
    else if (d === '/' && !inClass) { j++; while (j < s.length && /[a-z]/i.test(s[j])) j++; return j; }
    j++;
  }
  return -1;
}
// scan isi ${ ... } — kembalikan index SETELAH '}' penutup
function scanExpr(s, i) {
  let j = i, depth = 0;
  while (j < s.length) {
    const c = s[j];
    if (c === '\\') { j += 2; continue; }
    if (c === '"' || c === "'") { j = scanString(s, j); continue; }
    if (c === '`') { j = scanTemplate(s, j); continue; }
    if (c === '/' && s[j + 1] === '/') { j = scanLineComment(s, j); continue; }
    if (c === '/' && s[j + 1] === '*') { j = scanBlockComment(s, j); continue; }
    if (c === '{') { depth++; j++; continue; }
    if (c === '}') {
      if (depth === 0) return j + 1;
      depth--; j++; continue;
    }
    j++;
  }
  return s.length;
}
// scan template literal — s[i] === '`', kembalikan index SETELAH '`' penutup
function scanTemplate(s, i) {
  let j = i + 1;
  while (j < s.length) {
    const c = s[j];
    if (c === '\\') { j += 2; continue; }
    if (c === '`') return j + 1;
    if (c === '$' && s[j + 1] === '{') { j = scanExpr(s, j + 2); continue; }
    j++;
  }
  return s.length;
}

// ---- proteksi: ganti tiap template literal dengan placeholder ----
function protect(s) {
  const tpls = [];
  let out = '';
  let i = 0;
  let last = '';
  const regexOk = () => {
    if (!last) return true;
    if (/[)\]]$/.test(last)) return false;
    if (/^[A-Za-z_$][\w$]*$/.test(last)) return KW_REGEX.test(last);
    return true;
  };
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      let j = i; while (j < s.length && /[ \t\n\r]/.test(s[j])) j++;
      out += ' '; i = j; continue;
    }
    if (c === '/' && s[i + 1] === '/') { const j = scanLineComment(s, i); out += s.slice(i, j); last = 'cmt'; i = j; continue; }
    if (c === '/' && s[i + 1] === '*') { const j = scanBlockComment(s, i); out += s.slice(i, j); last = 'cmt'; i = j; continue; }
    if (c === '/' && regexOk()) {
      const j = scanRegex(s, i, last);
      if (j > 0) { out += s.slice(i, j); last = 'regex'; i = j; continue; }
    }
    if (c === '"' || c === "'") { const j = scanString(s, i); out += s.slice(i, j); last = 'str'; i = j; continue; }
    if (c === '`') {
      const j = scanTemplate(s, i);
      tpls.push(s.slice(i, j));
      out += PFX + (tpls.length - 1) + '__';
      last = 'tpl'; i = j; continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1; while (j < s.length && /[\w$]/.test(s[j])) j++;
      last = s.slice(i, j); out += last; i = j; continue;
    }
    out += c; last = c; i++;
  }
  return { protectedSrc: out, tpls };
}

const { protectedSrc, tpls } = protect(src);
console.log('template literal diekstrak:', tpls.length);

const pretty = beautify(protectedSrc, {
  indent_size: 2, indent_char: ' ', max_preserve_newlines: 2,
  preserve_newlines: true, break_chained_methods: false,
  space_in_paren: false,
});

let out = pretty.replace(new RegExp(PFX + '(\\d+)__', 'g'), (m, idx) => tpls[Number(idx)]);
const leftover = (out.match(new RegExp(PFX + '\\d+__', 'g')) || []).length;
console.log('placeholder tersisa (harus 0):', leftover);

fs.writeFileSync(OUT, out, 'utf8');
console.log('output: ' + (out.length / 1024).toFixed(1) + ' KB, ' + out.split('\n').length + ' baris');

const cnt = (t, re) => (t.match(re) || []).length;
let allOk = true;
for (const [name, re] of [
  ['function', /\bfunction\b/g], ['class', /\bclass\b/g], ['arrow', /=>/g],
  ['try{', /\btry\s*\{/g], ['backtick', /`/g],
]) {
  const a = cnt(src, re), b = cnt(out, re);
  if (a !== b) allOk = false;
  console.log('  ' + name.padEnd(10) + ' src=' + String(a).padStart(5) + ' out=' + String(b).padStart(5) + (a === b ? '  OK' : '  BEDA'));
}
console.log(allOk ? 'STRUKTUR KONSISTEN' : 'ADA PERBEDAAN');
