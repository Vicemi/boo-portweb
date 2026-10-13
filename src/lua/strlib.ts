// The string library of Lua 5.1 (a port of lstrlib.c: same patterns, same formatting)
import { LuaTable, LuaError, NIL1, numToStr, fmtG, type LuaValue, type NativeFunction } from './value';
import type { LuaState } from './vm';

const L_ESC = 37; // '%'
const SPECIALS = '^$*+?.([%-';
const MAXCAPTURES = 32;
const CAP_UNFINISHED = -1, CAP_POSITION = -2;

class MatchState {
  src: string;
  pat: string;
  level = 0;
  capStart: number[] = [];
  capLen: number[] = [];
  depth = 0;
  constructor(public L: LuaState, src: string, pat: string) { this.src = src; this.pat = pat; }
  err(msg: string): never { throw new LuaError(this.L.where() + msg); }
}

function classEnd(ms: MatchState, p: number): number {
  const pat = ms.pat;
  if (p >= pat.length) ms.err('malformed pattern (ends with \'%\')');
  const c = pat.charCodeAt(p++);
  if (c === L_ESC) {
    if (p >= pat.length) ms.err("malformed pattern (ends with '%')");
    return p + 1;
  }
  if (c === 91) { // '['
    if (pat.charCodeAt(p) === 94) p++;
    do {
      if (p >= pat.length) ms.err("malformed pattern (missing ']')");
      const cc = pat.charCodeAt(p++);
      if (cc === L_ESC && p < pat.length) p++;
    } while (pat.charCodeAt(p) !== 93 || p >= pat.length);
    return p + 1;
  }
  return p;
}

function isalpha(c: number): boolean { return (c >= 65 && c <= 90) || (c >= 97 && c <= 122); }
function isdigit(c: number): boolean { return c >= 48 && c <= 57; }
function islower(c: number): boolean { return c >= 97 && c <= 122; }
function isupper(c: number): boolean { return c >= 65 && c <= 90; }
function isspace(c: number): boolean { return c === 32 || (c >= 9 && c <= 13); }
function iscntrl(c: number): boolean { return c < 32 || c === 127; }
function ispunct(c: number): boolean { return (c >= 33 && c <= 47) || (c >= 58 && c <= 64) || (c >= 91 && c <= 96) || (c >= 123 && c <= 126); }
function isalnum(c: number): boolean { return isalpha(c) || isdigit(c); }
function isxdigit(c: number): boolean { return isdigit(c) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102); }

function matchClass(c: number, cl: number): boolean {
  let res: boolean;
  const lower = cl | 32;
  switch (lower) {
    case 97: res = isalpha(c); break;      // a
    case 99: res = iscntrl(c); break;      // c
    case 100: res = isdigit(c); break;     // d
    case 108: res = islower(c); break;     // l
    case 112: res = ispunct(c); break;     // p
    case 115: res = isspace(c); break;     // s
    case 117: res = isupper(c); break;     // u
    case 119: res = isalnum(c); break;     // w
    case 120: res = isxdigit(c); break;    // x
    case 122: res = c === 0; break;        // z
    default: return cl === c;
  }
  if (isalpha(cl) && isupper(cl)) res = !res;
  return res;
}

function matchBracketClass(ms: MatchState, c: number, p: number, ec: number): boolean {
  const pat = ms.pat;
  let sig = true;
  if (pat.charCodeAt(p + 1) === 94) { sig = false; p++; }
  while (++p < ec) {
    if (pat.charCodeAt(p) === L_ESC) {
      p++;
      if (matchClass(c, pat.charCodeAt(p))) return sig;
    } else if (pat.charCodeAt(p + 1) === 45 && p + 2 < ec) {
      p += 2;
      if (pat.charCodeAt(p - 2) <= c && c <= pat.charCodeAt(p)) return sig;
    } else if (pat.charCodeAt(p) === c) return sig;
  }
  return !sig;
}

function singleMatch(ms: MatchState, s: number, p: number, ep: number): boolean {
  if (s >= ms.src.length) return false;
  const c = ms.src.charCodeAt(s);
  const pc = ms.pat.charCodeAt(p);
  switch (pc) {
    case 46: return true;
    case L_ESC: return matchClass(c, ms.pat.charCodeAt(p + 1));
    case 91: return matchBracketClass(ms, c, p, ep - 1);
    default: return pc === c;
  }
}

function matchBalance(ms: MatchState, s: number, p: number): number {
  if (p + 1 >= ms.pat.length) ms.err("unbalanced pattern");
  if (s >= ms.src.length || ms.src.charCodeAt(s) !== ms.pat.charCodeAt(p)) return -1;
  const b = ms.pat.charCodeAt(p), e = ms.pat.charCodeAt(p + 1);
  let cont = 1;
  while (++s < ms.src.length) {
    const c = ms.src.charCodeAt(s);
    if (c === e) { if (--cont === 0) return s + 1; }
    else if (c === b) cont++;
  }
  return -1;
}

function maxExpand(ms: MatchState, s: number, p: number, ep: number): number {
  let i = 0;
  while (singleMatch(ms, s + i, p, ep)) i++;
  while (i >= 0) {
    const res = doMatch(ms, s + i, ep + 1);
    if (res !== -1) return res;
    i--;
  }
  return -1;
}

function minExpand(ms: MatchState, s: number, p: number, ep: number): number {
  for (;;) {
    const res = doMatch(ms, s, ep + 1);
    if (res !== -1) return res;
    if (singleMatch(ms, s, p, ep)) s++;
    else return -1;
  }
}

function startCapture(ms: MatchState, s: number, p: number, what: number): number {
  if (ms.level >= MAXCAPTURES) ms.err('too many captures');
  ms.capStart[ms.level] = s;
  ms.capLen[ms.level] = what;
  ms.level++;
  const res = doMatch(ms, s, p);
  if (res === -1) ms.level--;
  return res;
}

function endCapture(ms: MatchState, s: number, p: number): number {
  let l = -1;
  for (let level = ms.level - 1; level >= 0; level--) if (ms.capLen[level] === CAP_UNFINISHED) { l = level; break; }
  if (l < 0) ms.err('invalid pattern capture');
  ms.capLen[l] = s - ms.capStart[l];
  const res = doMatch(ms, s, p);
  if (res === -1) ms.capLen[l] = CAP_UNFINISHED;
  return res;
}

function checkCapture(ms: MatchState, l: number): number {
  l -= 49;
  if (l < 0 || l >= ms.level || ms.capLen[l] === CAP_UNFINISHED) ms.err('invalid capture index');
  return l;
}

function matchCapture(ms: MatchState, s: number, l: number): number {
  l = checkCapture(ms, l);
  const len = ms.capLen[l];
  if (ms.src.length - s >= len && ms.src.substr(ms.capStart[l], len) === ms.src.substr(s, len)) return s + len;
  return -1;
}

function doMatch(ms: MatchState, s: number, p: number): number {
  if (++ms.depth > 200) ms.err('pattern too complex');
  try {
    const pat = ms.pat;
    for (;;) {
      if (p >= pat.length) return s;
      const pc = pat.charCodeAt(p);
      switch (pc) {
        case 40: // '('
          if (pat.charCodeAt(p + 1) === 41) return startCapture(ms, s, p + 2, CAP_POSITION);
          return startCapture(ms, s, p + 1, CAP_UNFINISHED);
        case 41: // ')'
          return endCapture(ms, s, p + 1);
        case 36: // '$'
          if (p + 1 === pat.length) return s === ms.src.length ? s : -1;
          break;
        case L_ESC: {
          const nc = pat.charCodeAt(p + 1);
          if (nc === 98) { // %b
            s = matchBalance(ms, s, p + 2);
            if (s !== -1) { p += 4; continue; }
            return -1;
          }
          if (nc === 102) { // %f
            p += 2;
            if (pat.charCodeAt(p) !== 91) ms.err("missing '[' after '%f' in pattern");
            const ep = classEnd(ms, p);
            const prev = s === 0 ? 0 : ms.src.charCodeAt(s - 1);
            const cur = s < ms.src.length ? ms.src.charCodeAt(s) : 0;
            if (!matchBracketClass(ms, prev, p, ep - 1) && matchBracketClass(ms, cur, p, ep - 1)) { p = ep; continue; }
            return -1;
          }
          if (isdigit(nc)) {
            s = matchCapture(ms, s, nc);
            if (s !== -1) { p += 2; continue; }
            return -1;
          }
          break;
        }
        default: break;
      }
      // default case: single char class with an optional repetition
      const ep = classEnd(ms, p);
      const epc = ep < pat.length ? pat.charCodeAt(ep) : 0;
      if (!singleMatch(ms, s, p, ep)) {
        if (epc === 42 || epc === 63 || epc === 45) { p = ep + 1; continue; }
        return -1;
      }
      switch (epc) {
        case 63: { // '?'
          const res = doMatch(ms, s + 1, ep + 1);
          if (res !== -1) return res;
          p = ep + 1; continue;
        }
        case 43: return maxExpand(ms, s + 1, p, ep); // '+'
        case 42: return maxExpand(ms, s, p, ep);     // '*'
        case 45: return minExpand(ms, s, p, ep);     // '-'
        default: s++; p = ep; continue;
      }
    }
  } finally {
    ms.depth--;
  }
}

function getOneCapture(ms: MatchState, i: number, s: number, e: number): LuaValue {
  if (i >= ms.level) {
    if (i === 0) return ms.src.substring(s, e);
    ms.err('invalid capture index');
  }
  const l = ms.capLen[i];
  if (l === CAP_UNFINISHED) ms.err('unfinished capture');
  if (l === CAP_POSITION) return ms.capStart[i] + 1;
  return ms.src.substr(ms.capStart[i], l);
}

function pushCaptures(ms: MatchState, s: number, e: number, wholeIfNone: boolean): LuaValue[] {
  const n = ms.level === 0 && wholeIfNone ? 1 : ms.level;
  const out: LuaValue[] = [];
  for (let i = 0; i < n; i++) out.push(getOneCapture(ms, i, s, e));
  return out;
}

function checkStr(L: LuaState, v: LuaValue, n: number, fname: string): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return numToStr(v);
  throw new LuaError(`${L.where()}bad argument #${n} to '${fname}' (string expected, got ${v === undefined ? 'no value' : typeName(v)})`);
}
function checkNum(L: LuaState, v: LuaValue, n: number, fname: string): number {
  const x = L.tonumber(v);
  if (x === undefined) throw new LuaError(`${L.where()}bad argument #${n} to '${fname}' (number expected, got ${v === undefined ? 'no value' : typeName(v)})`);
  return x;
}
function optNum(L: LuaState, v: LuaValue, n: number, fname: string, d: number): number { return v === undefined ? d : checkNum(L, v, n, fname); }
function typeName(v: LuaValue): string {
  if (v === undefined) return 'nil';
  if (typeof v === 'boolean') return 'boolean';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'string') return 'string';
  if (v instanceof LuaTable) return 'table';
  if (typeof v === 'function' || v?.proto) return 'function';
  return 'userdata';
}

function posrelat(pos: number, len: number): number {
  if (pos >= 0) return pos;
  if (-pos > len) return 0;
  return len + pos + 1;
}

function strFindAux(L: LuaState, find: boolean, s0: LuaValue, p0: LuaValue, init0: LuaValue, plain0: LuaValue): LuaValue {
  const fname = find ? 'find' : 'match';
  const s = checkStr(L, s0, 1, fname), p = checkStr(L, p0, 2, fname);
  let init = posrelat(optNum(L, init0, 3, fname, 1), s.length) - 1;
  if (init < 0) init = 0; else if (init > s.length) init = s.length;
  if (find && ((plain0 !== undefined && plain0 !== false) || !/[\^$*+?.(\[%-]/.test(p))) {
    const idx = s.indexOf(p, init);
    if (idx < 0) return NIL1;
    return [idx + 1, idx + p.length];
  }
  const ms = new MatchState(L, s, p);
  const anchor = p.charCodeAt(0) === 94;
  let pi = anchor ? 1 : 0;
  let s1 = init;
  do {
    ms.level = 0;
    const e = doMatch(ms, s1, pi);
    if (e !== -1) {
      if (find) return [s1 + 1, e, ...pushCaptures(ms, -1, -1, false)];
      return pushCaptures(ms, s1, e, true);
    }
    s1++;
  } while (s1 <= s.length && !anchor);
  return NIL1;
}

function addValue(L: LuaState, ms: MatchState, out: string[], s: number, e: number, repl: LuaValue): void {
  let r: LuaValue;
  switch (typeof repl === 'object' && repl instanceof LuaTable ? 'table' : typeof repl) {
    case 'number':
    case 'string': {
      const rs = typeof repl === 'number' ? numToStr(repl) : repl as string;
      let res = '';
      for (let i = 0; i < rs.length; i++) {
        const c = rs.charCodeAt(i);
        if (c !== L_ESC) { res += rs[i]; continue; }
        i++;
        const d = rs.charCodeAt(i);
        if (!isdigit(d)) { res += rs[i]; continue; }
        if (d === 48) res += ms.src.substring(s, e);
        else {
          const v = getOneCapture(ms, d - 49, s, e);
          res += typeof v === 'number' ? numToStr(v) : v;
        }
      }
      out.push(res);
      return;
    }
    case 'table': {
      const cap = getOneCapture(ms, 0, s, e);
      r = L.index(repl, cap);
      break;
    }
    default: { // function
      const caps = pushCaptures(ms, s, e, true);
      r = L.call1(repl, ...caps);
      break;
    }
  }
  if (r === undefined || r === false) out.push(ms.src.substring(s, e));
  else if (typeof r === 'string') out.push(r);
  else if (typeof r === 'number') out.push(numToStr(r));
  else throw new LuaError(L.where() + 'invalid replacement value (a ' + typeName(r) + ')');
}

// ---- string.format -------------------------------------------------------------------------------------------------------------------------------
function pad(s: string, width: number, left: boolean, zero: boolean): string {
  if (s.length >= width) return s;
  if (left) return s + ' '.repeat(width - s.length);
  if (zero) {
    const m = /^[-+ ]/.exec(s);
    const sign = m ? m[0] : '';
    return sign + '0'.repeat(width - s.length) + s.slice(sign.length);
  }
  return ' '.repeat(width - s.length) + s;
}

export function format(L: LuaState, args: LuaValue[]): string {
  const fmt = checkStr(L, args[0], 1, 'format');
  let out = '';
  let argn = 0;
  for (let i = 0; i < fmt.length; i++) {
    const c = fmt[i];
    if (c !== '%') { out += c; continue; }
    i++;
    if (fmt[i] === '%') { out += '%'; continue; }
    let flags = '';
    while ('-+ #0'.includes(fmt[i]) && i < fmt.length) flags += fmt[i++];
    let width = '';
    while (isdigit(fmt.charCodeAt(i))) width += fmt[i++];
    let prec = '';
    let hasPrec = false;
    if (fmt[i] === '.') { hasPrec = true; i++; while (isdigit(fmt.charCodeAt(i))) prec += fmt[i++]; }
    const conv = fmt[i];
    argn++;
    const arg = args[argn];
    const w = width ? parseInt(width, 10) : 0;
    const pr = hasPrec ? (prec ? parseInt(prec, 10) : 0) : -1;
    const left = flags.includes('-'), zero = flags.includes('0') && !left, plus = flags.includes('+'), space = flags.includes(' '), alt = flags.includes('#');
    const signed = (s: string, neg: boolean): string => (neg ? '-' : plus ? '+' : space ? ' ' : '') + s;
    switch (conv) {
      case 'c': out += pad(String.fromCharCode(checkNum(L, arg, argn + 1, 'format') & 255), w, left, false); break;
      case 'd': case 'i': {
        let n = Math.trunc(checkNum(L, arg, argn + 1, 'format'));
        let digits = String(Math.abs(n));
        if (pr >= 0) digits = digits.padStart(pr, '0');
        out += pad(signed(digits, n < 0), w, left, zero && pr < 0);
        break;
      }
      case 'u': {
        const n = Math.trunc(checkNum(L, arg, argn + 1, 'format'));
        out += pad(String(n < 0 ? n + 4294967296 : n), w, left, zero);
        break;
      }
      case 'o': case 'x': case 'X': {
        let n = Math.trunc(checkNum(L, arg, argn + 1, 'format'));
        if (n < 0) n += 4294967296;
        let s = n.toString(conv === 'o' ? 8 : 16);
        if (conv === 'X') s = s.toUpperCase();
        if (pr >= 0) s = s.padStart(pr, '0');
        if (alt && n !== 0) s = (conv === 'o' ? '0' : conv === 'x' ? '0x' : '0X') + s;
        out += pad(s, w, left, zero && pr < 0);
        break;
      }
      case 'e': case 'E': case 'f': case 'F': case 'g': case 'G': {
        const n = checkNum(L, arg, argn + 1, 'format');
        const p = pr < 0 ? 6 : pr;
        let s: string;
        const neg = n < 0 || (n === 0 && 1 / n < 0);
        const a = Math.abs(n);
        if (!isFinite(a)) s = a !== a ? 'nan' : 'inf';
        else if (conv === 'f' || conv === 'F') s = a.toFixed(p);
        else if (conv === 'e' || conv === 'E') { const [m, e] = a.toExponential(p).split('e'); s = m + 'e' + (Number(e) < 0 ? '-' : '+') + String(Math.abs(Number(e))).padStart(2, '0'); }
        else s = fmtG(a, p, alt);
        if (conv === 'E' || conv === 'G') s = s.toUpperCase();
        if (alt && p === 0 && (conv === 'f' || conv === 'e')) s = s.replace(/^(\d+)/, '$1.');
        out += pad(signed(s, neg), w, left, zero && isFinite(a));
        break;
      }
      case 's': {
        let s = checkStr(L, arg, argn + 1, 'format');
        if (pr >= 0) s = s.substring(0, pr);
        out += pad(s, w, left, false);
        break;
      }
      case 'q': {
        const s = checkStr(L, arg, argn + 1, 'format');
        let r = '"';
        for (let j = 0; j < s.length; j++) {
          const ch = s[j];
          if (ch === '"' || ch === '\\' || ch === '\n') r += '\\' + ch;
          else if (ch === '\r') r += '\\r';
          else if (ch === '\0') r += '\\000';
          else r += ch;
        }
        out += r + '"';
        break;
      }
      default:
        throw new LuaError(L.where() + `invalid option '%${conv ?? ''}' to 'format'`);
    }
  }
  return out;
}

export function installString(L: LuaState): void {
  const S = new LuaTable();
  const reg = (name: string, fn: NativeFunction): void => { fn.luaName = name; S.set(name, fn); };
  reg('len', (s) => checkStr(L, s, 1, 'len').length);
  reg('sub', (s0, i0, j0) => {
    const s = checkStr(L, s0, 1, 'sub');
    const l = s.length;
    let i = posrelat(checkNum(L, i0, 2, 'sub'), l);
    let j = posrelat(optNum(L, j0, 3, 'sub', -1), l);
    if (i < 1) i = 1;
    if (j > l) j = l;
    return i <= j ? s.substring(i - 1, j) : '';
  });
  reg('upper', (s) => checkStr(L, s, 1, 'upper').replace(/[a-z]/g, (c) => c.toUpperCase()));
  reg('lower', (s) => checkStr(L, s, 1, 'lower').replace(/[A-Z]/g, (c) => c.toLowerCase()));
  reg('rep', (s, n) => { const str = checkStr(L, s, 1, 'rep'); const k = checkNum(L, n, 2, 'rep'); return k > 0 ? str.repeat(Math.floor(k)) : ''; });
  reg('reverse', (s) => checkStr(L, s, 1, 'reverse').split('').reverse().join(''));
  reg('byte', (s0, i0, j0) => {
    const s = checkStr(L, s0, 1, 'byte');
    const l = s.length;
    const i = posrelat(optNum(L, i0, 2, 'byte', 1), l);
    let j = j0 === undefined ? i : posrelat(checkNum(L, j0, 3, 'byte'), l);
    const lo = Math.max(i, 1), hi = Math.min(j, l);
    const out: number[] = [];
    for (let k = lo; k <= hi; k++) out.push(s.charCodeAt(k - 1));
    return out;
  });
  reg('char', (...a) => {
    let r = '';
    for (let i = 0; i < a.length; i++) {
      const c = checkNum(L, a[i], i + 1, 'char');
      if (c < 0 || c > 255) throw new LuaError(L.where() + `bad argument #${i + 1} to 'char' (invalid value)`);
      r += String.fromCharCode(c);
    }
    return r;
  });
  reg('format', (...a) => format(L, a));
  reg('find', (s, p, i, plain) => strFindAux(L, true, s, p, i, plain));
  reg('match', (s, p, i) => strFindAux(L, false, s, p, i, undefined));
  const gmatch: NativeFunction = (s0, p0) => {
    const s = checkStr(L, s0, 1, 'gmatch'), p = checkStr(L, p0, 2, 'gmatch');
    let pos = 0;
    const it: NativeFunction = () => {
      const ms = new MatchState(L, s, p);
      for (let src = pos; src <= s.length; src++) {
        ms.level = 0;
        const e = doMatch(ms, src, 0);
        if (e !== -1) {
          pos = e === src ? e + 1 : e;
          return pushCaptures(ms, src, e, true);
        }
      }
      pos = s.length + 1;
      return undefined;
    };
    return it;
  };
  reg('gmatch', gmatch);
  reg('gfind', gmatch);
  reg('gsub', (s0, p0, repl, max0) => {
    const s = checkStr(L, s0, 1, 'gsub'), p = checkStr(L, p0, 2, 'gsub');
    const tr = typeof repl;
    if (!(tr === 'number' || tr === 'string' || tr === 'function' || repl instanceof LuaTable || (repl && repl.proto)))
      throw new LuaError(L.where() + "bad argument #3 to 'gsub' (string/function/table expected)");
    const anchor = p.charCodeAt(0) === 94;
    const pi = anchor ? 1 : 0;
    const max = max0 === undefined ? s.length + 1 : checkNum(L, max0, 4, 'gsub');
    const ms = new MatchState(L, s, p);
    const out: string[] = [];
    let n = 0, src = 0;
    while (n < max) {
      ms.level = 0;
      const e = doMatch(ms, src, pi);
      if (e !== -1) { n++; addValue(L, ms, out, src, e, repl); }
      if (e !== -1 && e > src) src = e;
      else if (src < s.length) out.push(s[src++]);
      else break;
      if (anchor) break;
    }
    if (src < s.length) out.push(s.substring(src));
    return [out.join(''), n];
  });
  L.globals.set('string', S);
  L.loaded.set('string', S);
  const meta = new LuaTable();
  meta.set('__index', S);
  L.stringMeta = meta;
}

export { checkStr, checkNum, optNum, typeName };
