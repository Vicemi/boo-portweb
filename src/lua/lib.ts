// The standard library of Lua 5.1: base, table, math, os, io, coroutine, package (module / require)
import { LuaTable, LuaClosure, LuaError, Userdata, NIL1, numToStr, strToNum, type as luaType, type LuaValue, type NativeFunction } from './value';
import { LuaState, Thread, YIELD } from './vm';
import { installString, checkStr, checkNum, optNum, typeName } from './strlib';
import { undump, isBytecode } from './undump';

/** what the VM needs from the host: files (the game reads its scripts and data synchronously) and the clock */
export interface Host {
  readFile(path: string): string | undefined;                       // bytes as a latin1 string
  writeFile(path: string, data: string): boolean;
  removeFile(path: string): boolean;
  print(text: string): void;                                       // a line (print adds the newline itself)
  write?(text: string): void;                                      // text without newline (io.write)
  compile?: (source: string, chunkname: string) => LuaValue;        // text of a chunk -> function (provided by the parser)
}

function argErr(L: LuaState, n: number, fname: string, msg: string): never {
  throw new LuaError(`${L.where()}bad argument #${n} to '${fname}' (${msg})`);
}
function checkTable(L: LuaState, v: LuaValue, n: number, fname: string): LuaTable {
  if (v instanceof LuaTable) return v;
  return argErr(L, n, fname, `table expected, got ${v === undefined ? 'no value' : typeName(v)}`);
}
const isFalse = (v: LuaValue): boolean => v === undefined || v === false;

// the generator of rand() of glibc (TYPE_3), so that math.random gives the same numbers as the original game for the same seed
class GlibcRand {
  private r: number[] = [];
  private i = 0;
  constructor(seed: number) { this.seed(seed); }
  seed(seed: number): void {
    seed = seed >>> 0;
    if (seed === 0) seed = 1;
    const r = new Array<number>(34);
    r[0] = seed | 0;
    for (let i = 1; i < 31; i++) {
      const hi = Math.floor(r[i - 1] / 127773), lo = r[i - 1] % 127773;
      let w = 16807 * lo - 2836 * hi;
      if (w < 0) w += 2147483647;
      r[i] = w;
    }
    this.r = [];
    for (let i = 0; i < 31; i++) this.r.push(r[i] | 0);
    this.i = 0;
    // the first 310 outputs are discarded
    for (let k = 0; k < 310; k++) this.next();
  }
  next(): number {
    // r[n] = r[n-31] + r[n-3]
    const a = this.r;
    const n = a.length;
    const v = (a[n - 31] + a[n - 3]) | 0;
    a.push(v);
    if (a.length > 4096) a.splice(0, a.length - 64);
    return (v >>> 1);
  }
}

export function openLibs(L: LuaState, host: Host): void {
  const G = L.globals;
  const def = (t: LuaTable, name: string, fn: NativeFunction): void => { fn.luaName = name; t.set(name, fn); };
  const lib = (name: string): LuaTable => { const t = new LuaTable(); G.set(name, t); L.loaded.set(name, t); return t; };
  const callable = (v: LuaValue): boolean => typeof v === 'function' || v instanceof LuaClosure;

  // ================================================================================================================================ base
  def(G, 'print', (...a) => { host.print(a.map((v) => L.tostring(v)).join('\t')); });
  def(G, 'type', (...a) => { if (a.length === 0) argErr(L, 1, 'type', 'value expected'); return luaType(a[0]); });
  def(G, 'tostring', (v) => L.tostring(v));
  def(G, 'tonumber', (v, base) => {
    if (base === undefined || base === 10 && typeof v !== 'string') return L.tonumber(v) ?? NIL1;
    const b = checkNum(L, base, 2, 'tonumber');
    const s = checkStr(L, v, 1, 'tonumber').trim().toLowerCase();
    if (!/^-?[0-9a-z]+$/.test(s)) return NIL1;
    const neg = s[0] === '-';
    let n = 0;
    for (const ch of neg ? s.slice(1) : s) {
      const d = parseInt(ch, 36);
      if (isNaN(d) || d >= b) return NIL1;
      n = n * b + d;
    }
    return neg ? -n : n;
  });
  def(G, 'assert', (...a) => {
    if (isFalse(a[0])) throw new LuaError(a.length > 1 && a[1] !== undefined ? a[1] : L.where() + 'assertion failed!');
    return a;
  });
  def(G, 'error', (msg, level) => {
    const lv = level === undefined ? 1 : level;
    if (typeof msg === 'string' && lv > 0) throw new LuaError(L.where(lv) + msg, L.traceback());
    throw new LuaError(msg, L.traceback());
  });
  def(G, 'pcall', (f, ...args) => {
    if (f === undefined && args.length === 0) argErr(L, 1, 'pcall', 'value expected');
    const r = L.pcall(f, args);
    return r.ok ? [true, ...r.r] : [false, r.err];
  });
  def(G, 'xpcall', (f, handler) => {
    const r = L.pcall(f, []);
    if (r.ok) return [true, ...r.r];
    return [false, ...L.callArr(handler, [r.err])];
  });
  def(G, 'select', (n, ...a) => {
    if (n === '#') return a.length;
    const i = checkNum(L, n, 1, 'select');
    if (i < 0) { const k = a.length + i; if (k < 0) argErr(L, 1, 'select', 'index out of range'); return a.slice(k); }
    if (i === 0) argErr(L, 1, 'select', 'index out of range');
    return a.slice(i - 1);
  });
  const unpack: NativeFunction = (t, i, j) => {
    checkTable(L, t, 1, 'unpack');
    const a = optNum(L, i, 2, 'unpack', 1);
    const b = j === undefined ? t.length() : checkNum(L, j, 3, 'unpack');
    const out: LuaValue[] = [];
    for (let k = a; k <= b; k++) out.push(t.get(k));
    return out;
  };
  def(G, 'unpack', unpack);
  def(G, 'next', (t, k) => {
    checkTable(L, t, 1, 'next');
    const r = t.next(k);
    return r === undefined ? NIL1 : r;
  });
  const nextFn = G.get('next');
  def(G, 'pairs', (t) => { checkTable(L, t, 1, 'pairs'); return [nextFn, t, undefined]; });
  const ipairsIter: NativeFunction = (t, i) => {
    const n = (i as number) + 1;
    const v = t instanceof LuaTable && t.meta === null ? t.get(n) : L.index(t, n);
    return v === undefined ? undefined : [n, v];
  };
  def(G, 'ipairs', (t) => { checkTable(L, t, 1, 'ipairs'); return [ipairsIter, t, 0]; });
  def(G, 'rawget', (t, k) => checkTable(L, t, 1, 'rawget').get(k) ?? NIL1);
  def(G, 'rawset', (t, k, v) => { L.rawsetChecked(checkTable(L, t, 1, 'rawset'), k, v); return t; });
  def(G, 'rawequal', (a, b) => a === b);
  def(G, 'getmetatable', (v) => {
    const m = L.getmeta(v);
    if (m === null) return NIL1;
    const p = m.getStr('__metatable');
    return p !== undefined ? p : m;
  });
  def(G, 'setmetatable', (t, m) => {
    checkTable(L, t, 1, 'setmetatable');
    if (m !== undefined && !(m instanceof LuaTable)) argErr(L, 2, 'setmetatable', 'nil or table expected');
    if (t.meta?.getStr('__metatable') !== undefined) throw new LuaError(L.where() + 'cannot change a protected metatable');
    t.meta = m === undefined ? null : m;
    return t;
  });
  def(G, 'collectgarbage', (opt) => {
    if (opt === 'count') return [8192 + Math.random() * 0, 0];
    return 0;
  });
  def(G, 'gcinfo', () => 8192);
  const frameOf = (f: LuaValue, fname: string): LuaClosure | NativeFunction => {
    if (typeof f === 'number') {
      const frames = L.cur.frames;
      if (f === 0) return L.globals as any;
      const fr = frames[frames.length - f];
      if (!fr) argErr(L, 1, fname, 'invalid level');
      return fr.cl;
    }
    return f;
  };
  def(G, 'getfenv', (f) => {
    if (f === undefined) f = 1;
    if (f === 0) return G;
    const c = frameOf(f, 'getfenv');
    return c instanceof LuaClosure ? c.env : G;
  });
  def(G, 'setfenv', (f, t) => {
    checkTable(L, t, 2, 'setfenv');
    const c = frameOf(f, 'setfenv');
    if (c instanceof LuaClosure) c.env = t;
    else throw new LuaError(L.where() + "'setfenv' cannot change environment of given object");
    return c;
  });

  // ---- loading code
  const loadChunk = (data: string, name: string): LuaValue => {
    if (isBytecode(Uint8Array.from(data.slice(0, 5), (c) => c.charCodeAt(0)))) {
      const bytes = new Uint8Array(data.length);
      for (let i = 0; i < data.length; i++) bytes[i] = data.charCodeAt(i);
      return L.closureOf(undump(bytes));
    }
    if (!host.compile) throw new LuaError('no compiler for text chunks');
    return host.compile(data, name);
  };
  def(G, 'loadstring', (s, name) => {
    const str = checkStr(L, s, 1, 'loadstring');
    try { return loadChunk(str, name ?? str); } catch (e) { if (e instanceof LuaError) return [undefined, e.value]; throw e; }
  });
  def(G, 'load', (f, name) => {
    let src = '';
    if (typeof f === 'string') src = f;
    else for (;;) { const p = L.call1(f); if (p === undefined || p === '') break; src += p; }
    try { return loadChunk(src, name ?? '=(load)'); } catch (e) { if (e instanceof LuaError) return [undefined, e.value]; throw e; }
  });
  def(G, 'loadfile', (fname) => {
    const data = host.readFile(fname);
    if (data === undefined) return [undefined, `cannot open ${fname}`];
    try { return loadChunk(data, '@' + fname); } catch (e) { if (e instanceof LuaError) return [undefined, e.value]; throw e; }
  });
  def(G, 'dofile', (fname) => {
    const data = host.readFile(fname);
    if (data === undefined) throw new LuaError(`cannot open ${fname}`);
    return L.callArr(loadChunk(data, '@' + fname), []);
  });

  // ================================================================================================================================ coroutine
  const co = lib('coroutine');
  def(co, 'create', (f) => { if (!callable(f)) argErr(L, 1, 'create', 'Lua function expected'); return L.newThread(f); });
  def(co, 'resume', (th, ...a) => {
    if (!(th && th.isThread)) argErr(L, 1, 'resume', 'coroutine expected');
    return L.resume(th as Thread, a);
  });
  def(co, 'yield', (...a) => { L.cur.yielded = a; return YIELD; });
  def(co, 'status', (th) => (th as Thread).status);
  def(co, 'running', () => (L.cur === L.main ? undefined : L.cur));
  def(co, 'wrap', (f) => {
    const th = L.newThread(f);
    return ((...a: LuaValue[]) => {
      const r = L.resume(th, a);
      if (r[0] === true) return r.slice(1);
      const e = r[1];
      throw new LuaError(typeof e === 'string' && !/^[^\n]*:\d+:/.test(e) ? L.where() + e : e);
    }) as NativeFunction;
  });

  // ================================================================================================================================ table
  const T = lib('table');
  T.set('insert', ((...args: LuaValue[]) => {
    const t = checkTable(L, args[0], 1, 'insert');
    const e = t.length() + 1;
    if (args.length === 2) { L.rawsetChecked(t, e, args[1]); return; }
    if (args.length !== 3) throw new LuaError(L.where() + "wrong number of arguments to 'insert'");
    const pos = checkNum(L, args[1], 2, 'insert');
    for (let i = e; i > pos; i--) t.set(i, t.get(i - 1));
    L.rawsetChecked(t, pos, args[2]);
  }) as NativeFunction);
  def(T, 'remove', (t, p) => {
    checkTable(L, t, 1, 'remove');
    const e = t.length();
    const pos = p === undefined ? e : checkNum(L, p, 2, 'remove');
    if (e === 0) return undefined;                  // (5.1: an empty table gives nothing)
    if (pos < 1 || pos > e + 1) return undefined;
    const v = t.get(pos);
    for (let i = pos; i < e; i++) t.set(i, t.get(i + 1));
    t.set(e, undefined);
    return v;
  });
  def(T, 'concat', (t, sep0, i0, j0) => {
    checkTable(L, t, 1, 'concat');
    const sep = sep0 === undefined ? '' : checkStr(L, sep0, 2, 'concat');
    const i = optNum(L, i0, 3, 'concat', 1);
    const j = j0 === undefined ? t.length() : checkNum(L, j0, 4, 'concat');
    const parts: string[] = [];
    for (let k = i; k <= j; k++) {
      const v = t.get(k);
      if (typeof v === 'string') parts.push(v);
      else if (typeof v === 'number') parts.push(numToStr(v));
      else throw new LuaError(L.where() + `invalid value (at index ${k}) in table for 'concat'`);
    }
    return parts.join(sep);
  });
  def(T, 'getn', (t) => checkTable(L, t, 1, 'getn').length());
  def(T, 'maxn', (t) => {
    checkTable(L, t, 1, 'maxn');
    let m = 0;
    for (let n = t.next(undefined); n !== undefined; n = t.next(n[0])) if (typeof n[0] === 'number' && n[0] > m) m = n[0];
    return m;
  });
  def(T, 'foreach', (t, f) => {
    for (let n = t.next(undefined); n !== undefined; n = t.next(n[0])) { const r = L.call1(f, n[0], n[1]); if (r !== undefined) return r; }
  });
  def(T, 'foreachi', (t, f) => {
    const n = t.length();
    for (let i = 1; i <= n; i++) { const r = L.call1(f, i, t.get(i)); if (r !== undefined) return r; }
  });
  def(T, 'setn', () => { throw new LuaError("'setn' is obsolete"); });
  def(T, 'sort', (t, comp) => {
    checkTable(L, t, 1, 'sort');
    const n = t.length();
    if (comp !== undefined && !callable(comp)) argErr(L, 2, 'sort', 'function expected');
    const lt = (a: LuaValue, b: LuaValue): boolean => {
      if (comp !== undefined) { const r = L.call1(comp, a, b); return r !== undefined && r !== false; }
      return L.lt(a, b);
    };
    // the same quicksort as ltablib.c (so that equal elements end up in the same order as in the original)
    const geti = (i: number): LuaValue => t.get(i);
    const seti = (i: number, v: LuaValue): void => t.set(i, v);
    const auxsort = (l: number, u: number): void => {
      while (l < u) {
        let a = geti(l), b = geti(u);
        if (lt(b, a)) { seti(l, b); seti(u, a); }
        if (u - l === 1) break;
        const i0 = Math.floor((l + u) / 2);
        a = geti(i0); b = geti(l);
        if (lt(a, b)) { seti(i0, b); seti(l, a); }
        else { b = geti(u); if (lt(b, a)) { seti(i0, b); seti(u, a); } }
        if (u - l === 2) break;
        const P = geti(i0);
        b = geti(u - 1); seti(i0, b); seti(u - 1, P);
        let i = l, j = u - 1;
        for (;;) {
          while (lt(geti(++i), P)) { if (i > u) throw new LuaError(L.where() + 'invalid order function for sorting'); }
          while (lt(P, geti(--j))) { if (j < l) throw new LuaError(L.where() + 'invalid order function for sorting'); }
          if (j < i) break;
          const x = geti(i), y = geti(j); seti(i, y); seti(j, x);
        }
        const x = geti(u - 1), y = geti(i); seti(u - 1, y); seti(i, x);
        let ii: number, jj: number;
        if (i - l < u - i) { jj = l; ii = i - 1; l = i + 1; } else { jj = i + 1; ii = u; u = i - 1; }
        auxsort(jj, ii);
      }
    };
    auxsort(1, n);
  });

  // ================================================================================================================================ math
  const M = lib('math');
  const m1 = (name: string, f: (x: number) => number): void => def(M, name, (x) => f(checkNum(L, x, 1, name)));
  m1('abs', Math.abs); m1('ceil', Math.ceil); m1('floor', Math.floor); m1('sqrt', Math.sqrt);
  m1('sin', Math.sin); m1('cos', Math.cos); m1('tan', Math.tan); m1('asin', Math.asin); m1('acos', Math.acos); m1('atan', Math.atan);
  m1('sinh', Math.sinh); m1('cosh', Math.cosh); m1('tanh', Math.tanh); m1('exp', Math.exp); m1('log', Math.log); m1('log10', Math.log10);
  m1('deg', (x) => x * (180 / Math.PI)); m1('rad', (x) => x * (Math.PI / 180));
  def(M, 'atan2', (y, x) => Math.atan2(checkNum(L, y, 1, 'atan2'), checkNum(L, x, 2, 'atan2')));
  def(M, 'pow', (x, y) => Math.pow(checkNum(L, x, 1, 'pow'), checkNum(L, y, 2, 'pow')));
  def(M, 'fmod', (x, y) => checkNum(L, x, 1, 'fmod') % checkNum(L, y, 2, 'fmod'));
  def(M, 'modf', (x) => { const n = checkNum(L, x, 1, 'modf'); const ip = n >= 0 ? Math.floor(n) : Math.ceil(n); return [ip, isFinite(n) ? n - ip : 0]; });
  def(M, 'frexp', (x) => {
    let n = checkNum(L, x, 1, 'frexp');
    if (n === 0 || !isFinite(n)) return [n, 0];
    let e = Math.max(-1023, Math.floor(Math.log2(Math.abs(n))) + 1);
    let m = n * Math.pow(2, -e);
    while (Math.abs(m) < 0.5) { m *= 2; e--; }
    while (Math.abs(m) >= 1) { m /= 2; e++; }
    return [m, e];
  });
  def(M, 'ldexp', (m, e) => checkNum(L, m, 1, 'ldexp') * Math.pow(2, checkNum(L, e, 2, 'ldexp')));
  def(M, 'min', (...a) => { let r = checkNum(L, a[0], 1, 'min'); for (let i = 1; i < a.length; i++) { const v = checkNum(L, a[i], i + 1, 'min'); if (v < r) r = v; } return r; });
  def(M, 'max', (...a) => { let r = checkNum(L, a[0], 1, 'max'); for (let i = 1; i < a.length; i++) { const v = checkNum(L, a[i], i + 1, 'max'); if (v > r) r = v; } return r; });
  M.set('pi', Math.PI); M.set('huge', Infinity);
  let rng = new GlibcRand(1);
  const RAND_MAX = 2147483647;
  const rand = (): number => (rng.next() % RAND_MAX) / RAND_MAX;
  def(M, 'random', (m, n) => {
    const r = rand();
    if (m === undefined) return r;
    const lo = n === undefined ? 1 : checkNum(L, m, 1, 'random');
    const up = n === undefined ? checkNum(L, m, 1, 'random') : checkNum(L, n, 2, 'random');
    if (lo > up) argErr(L, n === undefined ? 1 : 2, 'random', 'interval is empty');
    return Math.floor(r * (up - lo + 1)) + lo;
  });
  def(M, 'randomseed', (s) => { rng = new GlibcRand(Math.floor(checkNum(L, s, 1, 'randomseed'))); });

  // ================================================================================================================================ os
  const O = lib('os');
  const t0 = Date.now();
  def(O, 'time', (t) => {
    if (t instanceof LuaTable) {
      const g = (k: string, d?: number): number => { const v = t.get(k); if (v === undefined) { if (d === undefined) throw new LuaError(L.where() + `field '${k}' missing in date table`); return d; } return Number(v); };
      return Math.floor(new Date(g('year'), g('month') - 1, g('day'), g('hour', 12), g('min', 0), g('sec', 0)).getTime() / 1000);
    }
    return Math.floor(Date.now() / 1000);
  });
  def(O, 'clock', () => (Date.now() - t0) / 1000);
  def(O, 'difftime', (a, b) => checkNum(L, a, 1, 'difftime') - optNum(L, b, 2, 'difftime', 0));
  def(O, 'getenv', () => NIL1);
  def(O, 'remove', (f) => (host.removeFile(checkStr(L, f, 1, 'remove')) ? true : [undefined, `${f}: No such file or directory`, 2]));
  def(O, 'rename', (a, b) => {
    const d = host.readFile(a);
    if (d === undefined) return [undefined, `${a}: No such file or directory`, 2];
    host.writeFile(b, d); host.removeFile(a); return true;
  });
  def(O, 'tmpname', () => '/tmp/lua_' + Math.floor(Math.random() * 1e9).toString(36));
  def(O, 'exit', () => { throw new LuaError('os.exit'); });
  def(O, 'setlocale', () => 'C');
  def(O, 'date', (fmt0, time0) => {
    let fmt = fmt0 === undefined ? '%c' : checkStr(L, fmt0, 1, 'date');
    let d = new Date((time0 === undefined ? Date.now() / 1000 : checkNum(L, time0, 2, 'date')) * 1000);
    let utc = false;
    if (fmt.startsWith('!')) { utc = true; fmt = fmt.slice(1); }
    const g = {
      Y: utc ? d.getUTCFullYear() : d.getFullYear(), m: (utc ? d.getUTCMonth() : d.getMonth()) + 1, d: utc ? d.getUTCDate() : d.getDate(),
      H: utc ? d.getUTCHours() : d.getHours(), M: utc ? d.getUTCMinutes() : d.getMinutes(), S: utc ? d.getUTCSeconds() : d.getSeconds(), w: utc ? d.getUTCDay() : d.getDay(),
    };
    if (fmt.startsWith('*t')) {
      const t = new LuaTable();
      t.set('year', g.Y); t.set('month', g.m); t.set('day', g.d); t.set('hour', g.H); t.set('min', g.M); t.set('sec', g.S); t.set('wday', g.w + 1);
      const jan1 = new Date(g.Y, 0, 1); t.set('yday', Math.floor((new Date(g.Y, g.m - 1, g.d).getTime() - jan1.getTime()) / 86400000) + 1); t.set('isdst', false);
      return t;
    }
    const p2 = (n: number): string => String(n).padStart(2, '0');
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return fmt.replace(/%(.)/g, (_m, c: string) => {
      switch (c) {
        case 'Y': return String(g.Y); case 'y': return p2(g.Y % 100); case 'm': return p2(g.m); case 'd': return p2(g.d);
        case 'H': return p2(g.H); case 'M': return p2(g.M); case 'S': return p2(g.S); case 'p': return g.H < 12 ? 'AM' : 'PM';
        case 'I': return p2(g.H % 12 || 12); case 'A': return days[g.w]; case 'a': return days[g.w].slice(0, 3);
        case 'B': return months[g.m - 1]; case 'b': return months[g.m - 1].slice(0, 3); case 'j': return String(Math.floor((new Date(g.Y, g.m - 1, g.d).getTime() - new Date(g.Y, 0, 1).getTime()) / 86400000) + 1).padStart(3, '0');
        case 'c': return `${days[g.w].slice(0, 3)} ${months[g.m - 1].slice(0, 3)} ${String(g.d).padStart(2, ' ')} ${p2(g.H)}:${p2(g.M)}:${p2(g.S)} ${g.Y}`;
        case 'x': return `${p2(g.m)}/${p2(g.d)}/${p2(g.Y % 100)}`; case 'X': return `${p2(g.H)}:${p2(g.M)}:${p2(g.S)}`;
        case '%': return '%'; default: return '%' + c;
      }
    });
  });

  // ================================================================================================================================ io (a small virtual file system)
  const IO = lib('io');
  class LFile extends Userdata {
    pos = 0; closed = false; dirty = false;
    constructor(public path: string, public data: string, public mode: string) { super(); }
    lget(key: LuaValue): LuaValue { return fileMethods.get(key); }
    lset(): void { /* read only */ }
    tostring(): string { return this.closed ? 'file (closed)' : 'file (0x' + (0x4000 + this.path.length).toString(16) + ')'; }
  }
  const fileMethods = new LuaTable();
  const fdef = (name: string, fn: NativeFunction): void => def(fileMethods, name, fn);
  const flush = (f: LFile): void => { if (f.dirty && f.mode !== 'r') { host.writeFile(f.path, f.data); f.dirty = false; } };
  fdef('write', (f: LFile, ...a) => {
    if (f.mode === 'r') return [undefined, 'Bad file descriptor', 9];
    for (const v of a) {
      const s = typeof v === 'number' ? numToStr(v) : checkStr(L, v, 2, 'write');
      if (f.mode.startsWith('a')) f.pos = f.data.length;
      f.data = f.data.slice(0, f.pos) + s + f.data.slice(f.pos + s.length);
      f.pos += s.length; f.dirty = true;
    }
    return f;
  });
  fdef('close', (f: LFile) => { flush(f); f.closed = true; return true; });
  fdef('flush', (f: LFile) => { flush(f); return f; });
  fdef('seek', (f: LFile, whence, off) => {
    const o = optNum(L, off, 3, 'seek', 0);
    f.pos = whence === 'set' ? o : whence === 'end' ? f.data.length + o : f.pos + o;
    return f.pos;
  });
  const readOne = (f: LFile, fmt: LuaValue): LuaValue => {
    if (typeof fmt === 'number') { if (f.pos >= f.data.length) return undefined; const r = f.data.substr(f.pos, fmt); f.pos += r.length; return r; }
    const s = typeof fmt === 'string' ? fmt.replace(/^\*/, '') : 'l';
    if (s[0] === 'a') { const r = f.data.slice(f.pos); f.pos = f.data.length; return r; }
    if (s[0] === 'n') { const m = /^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(f.data.slice(f.pos)); if (!m) return undefined; f.pos += m[0].length; return Number(m[0]); }
    if (f.pos >= f.data.length) return undefined;
    let e = f.data.indexOf('\n', f.pos);
    let line: string;
    if (e < 0) { line = f.data.slice(f.pos); f.pos = f.data.length; } else { line = f.data.slice(f.pos, s[0] === 'L' ? e + 1 : e); f.pos = e + 1; }
    return line;
  };
  fdef('read', (f: LFile, ...fmts) => (fmts.length === 0 ? readOne(f, 'l') : fmts.map((x) => readOne(f, x))));
  fdef('lines', (f: LFile) => (() => readOne(f, 'l')) as NativeFunction);
  fileMethods.set('__index', fileMethods);
  const openFile = (path: string, mode: string): LuaValue => {
    const m = mode.replace('b', '');
    if (m.startsWith('r')) {
      const d = host.readFile(path);
      if (d === undefined) return [undefined, `${path}: No such file or directory`, 2];
      return new LFile(path, d, m);
    }
    if (m.startsWith('a')) { const f = new LFile(path, host.readFile(path) ?? '', m); f.pos = f.data.length; f.dirty = true; flush(f); return f; }
    const f = new LFile(path, '', m); f.dirty = true; flush(f); return f;
  };
  def(IO, 'open', (path, mode) => openFile(checkStr(L, path, 1, 'open'), mode === undefined ? 'r' : checkStr(L, mode, 2, 'open')));
  def(IO, 'close', (f) => { if (f instanceof LFile) { flush(f); f.closed = true; } return true; });
  def(IO, 'write', (...a) => { const t = a.map((v) => (typeof v === 'number' ? numToStr(v) : String(v))).join(''); if (host.write) host.write(t); else host.print(t); });
  def(IO, 'read', () => undefined);
  def(IO, 'lines', (path) => { const f = openFile(path, 'r'); if (!(f instanceof LFile)) throw new LuaError(L.where() + `${path}: No such file or directory`); return (() => readOne(f, 'l')) as NativeFunction; });
  def(IO, 'type', (f) => (f instanceof LFile ? (f.closed ? 'closed file' : 'file') : undefined));

  // ================================================================================================================================ string
  installString(L);

  // ================================================================================================================================ package, module, require
  const P = lib('package');
  P.set('path', './?.lua');
  P.set('config', '/\n;\n?\n!\n-\n');
  P.set('cpath', '');
  P.set('loaded', L.loaded);
  P.set('preload', new LuaTable());
  L.loaded.set('_G', G);
  def(P, 'seeall', (m) => {
    let mt = (m as LuaTable).meta;
    if (mt === null) { mt = new LuaTable(); (m as LuaTable).meta = mt; }
    mt.set('__index', G);
  });
  def(G, 'module', (name, ...opts) => {
    const n = checkStr(L, name, 1, 'module');
    let t = L.loaded.get(n);
    if (!(t instanceof LuaTable)) {
      // a global table (dots make nested tables)
      let cur: LuaTable = G;
      const parts = n.split('.');
      for (let i = 0; i < parts.length; i++) {
        let nx = cur.get(parts[i]);
        if (!(nx instanceof LuaTable)) { nx = new LuaTable(); cur.set(parts[i], nx); }
        cur = nx;
      }
      t = cur;
      L.loaded.set(n, t);
    }
    if (t.get('_NAME') === undefined) {
      t.set('_M', t); t.set('_NAME', n);
      const dot = n.lastIndexOf('.');
      t.set('_PACKAGE', dot < 0 ? '' : n.slice(0, dot + 1));
    }
    const fr = L.cur.frames[L.cur.frames.length - 1];
    if (fr) fr.cl.env = t;
    for (const o of opts) if (callable(o)) L.callArr(o, [t]);
    return undefined;
  });
  def(G, 'require', (name) => {
    const n = checkStr(L, name, 1, 'require');
    const loaded = L.loaded.get(n);
    if (loaded !== undefined) return loaded;
    const pre = (P.get('preload') as LuaTable).get(n);
    let loader: LuaValue = pre;
    const tried: string[] = [];
    if (loader === undefined) {
      const fname = n.replace(/\./g, '/');
      for (const tpl of String(P.get('path')).split(';')) {
        if (!tpl) continue;
        const path = tpl.replace(/\?/g, fname);
        const data = host.readFile(path);
        if (data !== undefined) {
          try { loader = loadChunk(data, '@' + path); } catch (e) { if (e instanceof LuaError) throw new LuaError(`error loading module '${n}' from file '${path}':\n\t${e.value}`); throw e; }
          break;
        }
        tried.push(`\n\tno file '${path}'`);
      }
    }
    if (loader === undefined) throw new LuaError(L.where() + `module '${n}' not found:\n\tno field package.preload['${n}']${tried.join('')}`);
    const r = L.call1(loader, n);
    if (r !== undefined) L.loaded.set(n, r);
    if (L.loaded.get(n) === undefined) L.loaded.set(n, true);
    return L.loaded.get(n);
  });

  G.set('_VERSION', 'Lua 5.1');
  // a few globals of the compat mode of the original build (LUA_COMPAT_*)
  G.set('table', T);
  def(G, 'newproxy', () => new LuaTable());
  const d = lib('debug');
  def(d, 'traceback', (msg) => (msg === undefined ? '' : String(msg)) + '\nstack traceback:\n' + L.traceback());
  def(d, 'getinfo', (f) => { const t = new LuaTable(); t.set('currentline', 0); t.set('source', '=?'); t.set('short_src', '?'); t.set('what', 'Lua'); void f; return t; });
  def(d, 'sethook', () => undefined);
  def(d, 'gethook', () => undefined);
  def(d, 'getmetatable', (v) => L.getmeta(v) ?? undefined);
  def(d, 'setmetatable', (v, m) => { if (v instanceof LuaTable) v.meta = m ?? null; return v; });
  def(d, 'getlocal', () => undefined);
  def(d, 'getupvalue', () => undefined);
}

export { strToNum };
