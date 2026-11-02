// verify_beautify.js — buktikan bundle.readable.js adalah bundle.js yang sama,
// cuma diformat ulang. Cara: tokenize keduanya dengan scanner yang sama, lalu
// bandingkan urutan token. Kalau identik, beautify murni whitespace.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const KW_REGEX = /^(return|typeof|instanceof|in|of|new|delete|void|do|else|case|yield|await)$/;
function scanString(s, i) {
  const q = s[i]; let j = i + 1;
  while (j < s.length) {
    if (s[j] === '\\') { j += 2; continue; }
    if (s[j] === q) return j + 1;
    if (s[j] === '\n') return j;
    j++;
  }
  return s.length;
}
function scanLine(s, i) { let j = i + 2; while (j < s.length && s[j] !== '\n') j++; return j; }
function scanBlock(s, i) { let j = i + 2; while (j < s.length && !(s[j] === '*' && s[j + 1] === '/')) j++; return Math.min(s.length, j + 2); }
function scanRegex(s, i) {
  let j = i + 1, inClass = false;
  while (j < s.length) {
    const d = s[j];
    if (d === '\\') { j += 2; continue; }
    if (d === '\n') return -1;
    if (d === '[') inClass = true; else if (d === ']') inClass = false;
    else if (d === '/' && !inClass) { j++; while (j < s.length && /[a-z]/i.test(s[j])) j++; return j; }
    j++;
  }
  return -1;
}
function scanExpr(s, i) {
  let j = i, depth = 0;
  while (j < s.length) {
    const c = s[j];
    if (c === '\\') { j += 2; continue; }
    if (c === '"' || c === "'") { j = scanString(s, j); continue; }
    if (c === '`') { j = scanTemplate(s, j); continue; }
    if (c === '/' && s[j + 1] === '/') { j = scanLine(s, j); continue; }
    if (c === '/' && s[j + 1] === '*') { j = scanBlock(s, j); continue; }
    if (c === '{') { depth++; j++; continue; }
    if (c === '}') { if (depth === 0) return j + 1; depth--; j++; continue; }
    j++;
  }
  return s.length;
}
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

function tokens(s) {
  const out = [];
  let i = 0, last = '';
  const regexOk = () => {
    if (!last) return true;
    if (/[)\]]$/.test(last)) return false;
    if (/^[A-Za-z_$][\w$]*$/.test(last)) return KW_REGEX.test(last);
    return true;
  };
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (c === '/' && s[i + 1] === '/') { const j = scanLine(s, i); out.push(['cmt', s.slice(i, j)]); last = 'cmt'; i = j; continue; }
    if (c === '/' && s[i + 1] === '*') { const j = scanBlock(s, i); out.push(['cmt', s.slice(i, j)]); last = 'cmt'; i = j; continue; }
    if (c === '/' && regexOk()) { const j = scanRegex(s, i); if (j > 0) { out.push(['regex', s.slice(i, j)]); last = 'regex'; i = j; continue; } }
    if (c === '"' || c === "'") { const j = scanString(s, i); out.push(['str', s.slice(i, j)]); last = 'str'; i = j; continue; }
    if (c === '`') { const j = scanTemplate(s, i); out.push(['tpl', s.slice(i, j)]); last = 'tpl'; i = j; continue; }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1; while (j < s.length && /[\w$]/.test(s[j])) j++;
      const v = s.slice(i, j); out.push(['id', v]); last = v; i = j; continue;
    }
    if (/[\d.]/.test(c)) {
      let j = i + 1; while (j < s.length && /[\w.]/.test(s[j])) j++;
      out.push(['num', s.slice(i, j)]); last = 'num'; i = j; continue;
    }
    out.push(['punc', c]); last = c; i++;
  }
  return out;
}

const a = tokens(fs.readFileSync(path.join(ROOT, 'site/static/game/bundle.js'), 'utf8'));
const b = tokens(fs.readFileSync(path.join(ROOT, 'site/static/game/bundle.readable.js'), 'utf8'));

console.log('token source     :', a.length);
console.log('token readable   :', b.length);

if (a.length !== b.length) {
  console.log('JUMLAH TOKEN BEDA');
  // cari perbedaan pertama
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1]) {
      console.log('beda pertama di token ' + i + ':');
      console.log('  src : ' + JSON.stringify(a[i]));
      console.log('  rdbl: ' + JSON.stringify(b[i]));
      console.log('  konteks src : ' + JSON.stringify(a.slice(Math.max(0, i - 4), i + 4)));
      console.log('  konteks rdbl: ' + JSON.stringify(b.slice(Math.max(0, i - 4), i + 4)));
      break;
    }
  }
} else {
  let diff = 0, first = -1;
  for (let i = 0; i < a.length; i++) {
    if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1]) { diff++; if (first < 0) first = i; }
  }
  if (diff === 0) {
    console.log('\n*** IDENTIK — beautify murni whitespace, tidak ada kode yang berubah ***');
  } else {
    console.log('\n' + diff + ' token berbeda, pertama di ' + first);
    console.log('  src : ' + JSON.stringify(a[first]));
    console.log('  rdbl: ' + JSON.stringify(b[first]));
  }
}
