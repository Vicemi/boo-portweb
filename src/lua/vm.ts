// The Lua 5.1 virtual machine: executes the bytecode of the game (precompiled with luac 5.1, 32 bit) like the original interpreter does.
// Calls between Lua functions do not use the JS stack (so coroutines can yield from any depth of Lua calls); native functions are plain JS functions.
import { LuaTable, LuaClosure, LuaError, Proto, UpVal, Userdata, type LuaValue, type NativeFunction, numToStr, strToNum, type as luaType } from './value';

export const YIELD = { yield: true };           // returned by coroutine.yield: the VM suspends the running thread

export class Frame {
  cl: LuaClosure;
  regs: LuaValue[];
  pc = 0;
  varargs: LuaValue[] = EMPTY;
  openUps: UpVal[] | null = null;
  top = 0;                                     // end of a multiple result (CALL with C=0, VARARG with B=0)
  retA = 0;                                    // where the results go in the caller: register and count (-1 = all)
  retN = 0;
  boundary = false;                            // returned to a native caller (vm.call)
  tail = false;
  resumeA = -1; resumeN = 0;                   // pending CALL of a yield
  constructor(cl: LuaClosure, regs: LuaValue[]) { this.cl = cl; this.regs = regs; }
}
const EMPTY: LuaValue[] = [];

export class Thread {
  isThread = true;
  frames: Frame[] = [];
  status: 'suspended' | 'running' | 'normal' | 'dead' = 'suspended';
  fn: LuaValue;
  started = false;
  nativeDepth = 0;
  yielded: LuaValue[] = [];
  constructor(fn: LuaValue) { this.fn = fn; }
}

type Meta = LuaTable | null;

const MAX_FRAMES = 6000;

export class LuaState {
  globals = new LuaTable();
  registry = new LuaTable();
  stringMeta: LuaTable | null = null;
  main = new Thread(undefined);
  cur: Thread = this.main;
  loaded = new LuaTable();
  /** a hook for the host to find the source line of an error */
  constructor() {
    this.main.status = 'running';
    this.globals.set('_G', this.globals);
  }

  // ------------------------------------------------------------------------------------------------------------------------------ errors
  where(level = 1): string {
    const fr = this.cur.frames;
    const f = fr[fr.length - level];
    if (!f) return '';
    const p = f.cl.proto;
    const line = p.lineinfo.length ? p.lineinfo[Math.max(0, f.pc - 1)] : 0;
    return `${chunkName(p.source)}:${line}: `;
  }
  rt(msg: string): never { throw new LuaError(this.where() + msg, this.traceback()); }
  traceback(): string {
    const out: string[] = [];
    const fr = this.cur.frames;
    for (let i = fr.length - 1, n = 0; i >= 0 && n < 25; i--, n++) {
      const p = fr[i].cl.proto;
      const line = p.lineinfo.length ? p.lineinfo[Math.max(0, fr[i].pc - 1)] : 0;
      out.push(`  ${chunkName(p.source)}:${line}: in function <${chunkName(p.source)}:${p.lineDefined}>`);
    }
    return out.join('\n');
  }

  // ------------------------------------------------------------------------------------------------------------------------------ metatables
  getmeta(v: LuaValue): Meta {
    if (v instanceof LuaTable) return v.meta;
    if (typeof v === 'string') return this.stringMeta;
    if (v instanceof Userdata) return v.meta;
    return null;
  }

  index(obj: LuaValue, key: LuaValue): LuaValue {
    for (let loop = 0; loop < 100; loop++) {
      let h: LuaValue;
      if (obj instanceof LuaTable) {
        const v = obj.get(key);
        if (v !== undefined) return v;
        const m = obj.meta;
        if (m === null) return undefined;
        h = m.getStr('__index');
        if (h === undefined) return undefined;
      } else if (obj instanceof Userdata) {
        const v = obj.lget(key);
        if (v !== undefined) return v;
        const m = obj.meta;
        if (m === null) return undefined;
        h = m.getStr('__index');
        if (h === undefined) return undefined;
      } else {
        const m = this.getmeta(obj);
        h = m === null ? undefined : m.getStr('__index');
        if (h === undefined) this.rt(`attempt to index a ${luaType(obj)} value`);
      }
      if (typeof h === 'function' || h instanceof LuaClosure) return this.call1(h, obj, key);
      obj = h;
    }
    return this.rt("loop in gettable");
  }

  setindex(obj: LuaValue, key: LuaValue, val: LuaValue): void {
    for (let loop = 0; loop < 100; loop++) {
      let h: LuaValue;
      if (obj instanceof LuaTable) {
        const m = obj.meta;
        if (m === null) { this.rawsetChecked(obj, key, val); return; }
        h = m.getStr('__newindex');
        if (h === undefined || obj.get(key) !== undefined) { this.rawsetChecked(obj, key, val); return; }
      } else if (obj instanceof Userdata) {
        const m = obj.meta;
        h = m === null ? undefined : m.getStr('__newindex');
        if (h === undefined) { obj.lset(key, val); return; }
      } else {
        const m = this.getmeta(obj);
        h = m === null ? undefined : m.getStr('__newindex');
        if (h === undefined) this.rt(`attempt to index a ${luaType(obj)} value`);
      }
      if (typeof h === 'function' || h instanceof LuaClosure) { this.call(h, obj, key, val); return; }
      obj = h;
    }
    this.rt("loop in settable");
  }

  rawsetChecked(t: LuaTable, key: LuaValue, val: LuaValue): void {
    if (key === undefined) this.rt('table index is nil');
    if (typeof key === 'number' && key !== key) this.rt('table index is NaN');
    t.set(key, val);
  }

  // ------------------------------------------------------------------------------------------------------------------------------ calls from native code
  /** calls any callable value; returns the array of results */
  call(fn: LuaValue, ...args: LuaValue[]): LuaValue[] { return this.callArr(fn, args); }

  call1(fn: LuaValue, ...args: LuaValue[]): LuaValue { const r = this.callArr(fn, args); return r.length ? r[0] : undefined; }

  callArr(fn: LuaValue, args: LuaValue[]): LuaValue[] {
    if (typeof fn === 'function') {
      const r = fn(...args);
      if (r === YIELD) this.rt('attempt to yield across metamethod/C-call boundary');
      return r === undefined ? EMPTY : Array.isArray(r) ? r : [r];
    }
    if (fn instanceof LuaClosure) {
      const th = this.cur;
      const depth = th.frames.length;
      this.pushFrame(th, fn, args, 0, -1, true);
      th.nativeDepth++;
      try {
        return this.run(th, depth) as LuaValue[];
      } finally {
        th.nativeDepth--;
        if (th.frames.length > depth) { for (let i = th.frames.length - 1; i >= depth; i--) closeFrame(th.frames[i]); th.frames.length = depth; }
      }
    }
    const h = this.getmeta(fn)?.getStr('__call');
    if (h !== undefined) return this.callArr(h, [fn, ...args]);
    return this.rt(`attempt to call a ${luaType(fn)} value`);
  }

  private pushFrame(th: Thread, cl: LuaClosure, args: LuaValue[], retA: number, retN: number, boundary: boolean): Frame {
    if (th.frames.length >= MAX_FRAMES) this.rt('stack overflow');
    const p = cl.proto;
    const regs = new Array<LuaValue>(p.maxstack);
    const np = p.numparams;
    const na = args.length;
    for (let i = 0; i < np; i++) regs[i] = i < na ? args[i] : undefined;
    const f = new Frame(cl, regs);
    if (p.isVararg) {
      f.varargs = na > np ? args.slice(np) : EMPTY;
      if (p.isVararg & 4) {                         // the old `arg` table of 5.0 (LUA_COMPAT_VARARG)
        const t = new LuaTable();
        for (let i = 0; i < f.varargs.length; i++) t.set(i + 1, f.varargs[i]);
        t.set('n', f.varargs.length);
        regs[np] = t;
      }
    }
    f.retA = retA; f.retN = retN; f.boundary = boundary;
    th.frames.push(f);
    return f;
  }

  /** the entry point: a closure is called with arguments (used by the host for the chunks it loads) */
  pcall(fn: LuaValue, args: LuaValue[]): { ok: true; r: LuaValue[] } | { ok: false; err: LuaValue; traceback: string } {
    const th = this.cur;
    const depth = th.frames.length;
    const nd = th.nativeDepth;
    try {
      return { ok: true, r: this.callArr(fn, args) };
    } catch (e) {
      th.nativeDepth = nd;
      for (let i = th.frames.length - 1; i >= depth; i--) closeFrame(th.frames[i]);
      th.frames.length = depth;
      if (e instanceof LuaError) return { ok: false, err: e.value, traceback: e.traceback };
      if (e instanceof RangeError) return { ok: false, err: 'stack overflow', traceback: '' };
      throw e;
    }
  }

  // ------------------------------------------------------------------------------------------------------------------------------ arithmetic
  tonumber(v: LuaValue): number | undefined {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') return strToNum(v);
    return undefined;
  }

  arith(op: number, a: LuaValue, b: LuaValue): LuaValue {
    const x = this.tonumber(a), y = this.tonumber(b);
    if (x !== undefined && y !== undefined) {
      switch (op) {
        case 12: return x + y;
        case 13: return x - y;
        case 14: return x * y;
        case 15: return x / y;
        case 16: return x - Math.floor(x / y) * y;
        case 17: return Math.pow(x, y);
        case 18: return -x;
      }
    }
    const ev = ['__add', '__sub', '__mul', '__div', '__mod', '__pow', '__unm'][op - 12];
    let h = this.getmeta(a)?.getStr(ev);
    if (h === undefined) h = this.getmeta(b)?.getStr(ev);
    if (h !== undefined) return this.call1(h, a, b);
    const bad = (typeof a === 'number' || (typeof a === 'string' && strToNum(a) !== undefined)) ? b : a;
    return this.rt(`attempt to perform arithmetic on a ${luaType(bad)} value`);
  }

  concat(a: LuaValue, b: LuaValue): LuaValue {
    const ta = typeof a, tb = typeof b;
    if ((ta === 'string' || ta === 'number') && (tb === 'string' || tb === 'number')) return (ta === 'number' ? numToStr(a) : a) + (tb === 'number' ? numToStr(b) : b);
    let h = this.getmeta(a)?.getStr('__concat');
    if (h === undefined) h = this.getmeta(b)?.getStr('__concat');
    if (h !== undefined) return this.call1(h, a, b);
    const bad = (ta === 'string' || ta === 'number') ? b : a;
    return this.rt(`attempt to concatenate a ${luaType(bad)} value`);
  }

  eq(a: LuaValue, b: LuaValue): boolean {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (a instanceof LuaTable || a instanceof Userdata) {
      if (b === a) return true;
      if ((a instanceof LuaTable && !(b instanceof LuaTable)) || (a instanceof Userdata && !(b instanceof Userdata))) return false;
      const ma = this.getmeta(a)?.getStr('__eq');
      if (ma === undefined) return false;
      const mb = this.getmeta(b)?.getStr('__eq');
      if (ma !== mb) return false;
      const r = this.call1(ma, a, b);
      return r !== undefined && r !== false;
    }
    return false;
  }

  lt(a: LuaValue, b: LuaValue): boolean {
    const ta = typeof a, tb = typeof b;
    if (ta === 'number' && tb === 'number') return a < b;
    if (ta === 'string' && tb === 'string') return a < b;
    return this.compareMeta('__lt', a, b, false);
  }
  le(a: LuaValue, b: LuaValue): boolean {
    const ta = typeof a, tb = typeof b;
    if (ta === 'number' && tb === 'number') return a <= b;
    if (ta === 'string' && tb === 'string') return a <= b;
    return this.compareMeta('__le', a, b, true);
  }
  private compareMeta(ev: string, a: LuaValue, b: LuaValue, isLe: boolean): boolean {
    if (typeof a !== typeof b) this.rt(`attempt to compare ${luaType(a)} with ${luaType(b)}`);
    let h = this.getmeta(a)?.getStr(ev);
    const hb = this.getmeta(b)?.getStr(ev);
    if (h === undefined || h !== hb) {
      if (isLe) {                                   // 5.1: a <= b is not (b < a) with __lt
        const lt = this.getmeta(a)?.getStr('__lt');
        if (lt !== undefined && lt === this.getmeta(b)?.getStr('__lt')) { const r = this.call1(lt, b, a); return !(r !== undefined && r !== false); }
      }
      this.rt(`attempt to compare two ${luaType(a)} values`);
    }
    const r = this.call1(h, a, b);
    return r !== undefined && r !== false;
  }

  len(v: LuaValue): number {
    if (typeof v === 'string') return v.length;
    if (v instanceof LuaTable) return v.length();
    if (v instanceof Userdata) { const r = v.lget('__len'); if (typeof r === 'number') return r; }
    return this.rt(`attempt to get length of a ${luaType(v)} value`);
  }

  tostring(v: LuaValue): string {
    switch (typeof v) {
      case 'undefined': return 'nil';
      case 'boolean': return v ? 'true' : 'false';
      case 'number': return numToStr(v);
      case 'string': return v;
    }
    const h = this.getmeta(v)?.getStr('__tostring');
    if (h !== undefined) {
      const r = this.call1(h, v);
      if (typeof r !== 'string') this.rt("'__tostring' must return a string");
      return r;
    }
    if (v instanceof LuaTable) { if (!v.id) v.id = ++LuaTable.counter; return 'table: 0x' + (0x1000000 + v.id * 8).toString(16).padStart(8, '0'); }
    if (v instanceof LuaClosure) return 'function: 0x' + (idOf(v)).toString(16).padStart(8, '0');
    if (typeof v === 'function') return 'function: builtin: 0x' + (idOf(v)).toString(16).padStart(8, '0');
    if (v instanceof Userdata) return v.tostring();
    if (v && v.isThread) return 'thread: 0x' + idOf(v).toString(16).padStart(8, '0');
    return 'userdata';
  }

  // ------------------------------------------------------------------------------------------------------------------------------ coroutines
  newThread(fn: LuaValue): Thread { return new Thread(fn); }

  /** resumes a coroutine; returns [true, ...values] or [false, error] */
  resume(th: Thread, args: LuaValue[]): LuaValue[] {
    if (th.status === 'dead') return [false, 'cannot resume dead coroutine'];
    if (th.status === 'running') return [false, 'cannot resume non-suspended coroutine'];
    if (th.status === 'normal') return [false, 'cannot resume non-suspended coroutine'];
    const prev = this.cur;
    prev.status = 'normal';
    th.status = 'running';
    this.cur = th;
    try {
      let out: LuaValue[];
      if (!th.started) {
        th.started = true;
        const fn = th.fn;
        if (typeof fn === 'function') { const r = fn(...args); out = r === undefined ? [] : Array.isArray(r) ? r : [r]; th.status = 'dead'; return [true, ...out]; }
        if (!(fn instanceof LuaClosure)) {
          const h = this.getmeta(fn)?.getStr('__call');
          if (h === undefined) throw new LuaError('attempt to call a ' + luaType(fn) + ' value');
        }
        this.pushFrame(th, fn as LuaClosure, args, 0, -1, true);
      } else {
        // the pending CALL of coroutine.yield gets the values of the resume
        const f = th.frames[th.frames.length - 1];
        this.storeResults(f, f.resumeA, f.resumeN, args);
      }
      const r = this.run(th, 0);
      if (r === YIELD) { th.status = 'suspended'; return [true, ...th.yielded]; }
      th.status = 'dead';
      return [true, ...(r as LuaValue[])];
    } catch (e) {
      th.status = 'dead';
      if (e instanceof LuaError) return [false, e.value];
      if (e instanceof RangeError) return [false, 'stack overflow'];
      throw e;
    } finally {
      this.cur = prev;
      prev.status = 'running';
    }
  }

  private storeResults(f: Frame, a: number, n: number, vals: LuaValue[]): void {
    const regs = f.regs;
    if (n < 0) {
      for (let i = 0; i < vals.length; i++) regs[a + i] = vals[i];
      f.top = a + vals.length;
    } else {
      for (let i = 0; i < n; i++) regs[a + i] = i < vals.length ? vals[i] : undefined;
    }
  }

  // ------------------------------------------------------------------------------------------------------------------------------ the interpreter
  /** runs the thread until the frame at depth `stopDepth` returns; gives its results (or YIELD) */
  run(th: Thread, stopDepth: number): LuaValue[] | typeof YIELD {
    const frames = th.frames;
    let f = frames[frames.length - 1];
    let cl = f.cl;
    let proto = cl.proto;
    let code = proto.code;
    let k = proto.k;
    let regs = f.regs;
    let pc = f.pc;

    for (;;) {
      const i = code[pc++];
      f.pc = pc;
      const a = (i >>> 6) & 0xff;
      switch (i & 0x3f) {
        case 0: // MOVE
          regs[a] = regs[i >>> 23];
          break;
        case 1: // LOADK
          regs[a] = k[i >>> 14];
          break;
        case 2: // LOADBOOL
          regs[a] = (i >>> 23) !== 0;
          if (((i >>> 14) & 0x1ff) !== 0) pc++;
          break;
        case 3: { // LOADNIL
          const b = i >>> 23;
          for (let j = a; j <= b; j++) regs[j] = undefined;
          break;
        }
        case 4: // GETUPVAL
          regs[a] = cl.upvals[i >>> 23].get();
          break;
        case 5: { // GETGLOBAL
          const key = k[i >>> 14];
          const env = cl.env;
          const v = env.getStr(key);
          regs[a] = v !== undefined || env.meta === null ? v : this.index(env, key);
          break;
        }
        case 6: { // GETTABLE
          const t = regs[i >>> 23];
          const c = (i >>> 14) & 0x1ff;
          const key = c >= 256 ? k[c - 256] : regs[c];
          if (t instanceof LuaTable) {
            const v = t.get(key);
            regs[a] = v !== undefined || t.meta === null ? v : this.index(t, key);
          } else { if (!(t instanceof Userdata) && this.getmeta(t) === null) this.rt(`attempt to index ${callName(f, pc - 1, i >>> 23)}a ${luaType(t)} value`); regs[a] = this.index(t, key); }
          break;
        }
        case 7: { // SETGLOBAL
          const key = k[i >>> 14];
          const env = cl.env;
          if (env.meta === null) env.set(key, regs[a]); else this.setindex(env, key, regs[a]);
          break;
        }
        case 8: // SETUPVAL
          cl.upvals[i >>> 23].set(regs[a]);
          break;
        case 9: { // SETTABLE
          const t = regs[a];
          const b = (i >>> 23), c = (i >>> 14) & 0x1ff;
          const key = b >= 256 ? k[b - 256] : regs[b];
          const val = c >= 256 ? k[c - 256] : regs[c];
          if (t instanceof LuaTable && t.meta === null) {
            if (key === undefined) this.rt('table index is nil');
            if (typeof key === 'number' && key !== key) this.rt('table index is NaN');
            t.set(key, val);
          } else this.setindex(t, key, val);
          break;
        }
        case 10: // NEWTABLE
          regs[a] = new LuaTable();
          break;
        case 11: { // SELF
          const t = regs[i >>> 23];
          const c = (i >>> 14) & 0x1ff;
          const key = c >= 256 ? k[c - 256] : regs[c];
          regs[a + 1] = t;
          if (t instanceof LuaTable) {
            const v = t.get(key);
            regs[a] = v !== undefined || t.meta === null ? v : this.index(t, key);
          } else { if (!(t instanceof Userdata) && this.getmeta(t) === null) this.rt(`attempt to index ${callName(f, pc - 1, i >>> 23)}a ${luaType(t)} value`); regs[a] = this.index(t, key); }
          break;
        }
        case 12: { // ADD
          const b = i >>> 23, c = (i >>> 14) & 0x1ff;
          const x = b >= 256 ? k[b - 256] : regs[b], y = c >= 256 ? k[c - 256] : regs[c];
          regs[a] = typeof x === 'number' && typeof y === 'number' ? x + y : this.arith(12, x, y);
          break;
        }
        case 13: { // SUB
          const b = i >>> 23, c = (i >>> 14) & 0x1ff;
          const x = b >= 256 ? k[b - 256] : regs[b], y = c >= 256 ? k[c - 256] : regs[c];
          regs[a] = typeof x === 'number' && typeof y === 'number' ? x - y : this.arith(13, x, y);
          break;
        }
        case 14: { // MUL
          const b = i >>> 23, c = (i >>> 14) & 0x1ff;
          const x = b >= 256 ? k[b - 256] : regs[b], y = c >= 256 ? k[c - 256] : regs[c];
          regs[a] = typeof x === 'number' && typeof y === 'number' ? x * y : this.arith(14, x, y);
          break;
        }
        case 15: { // DIV
          const b = i >>> 23, c = (i >>> 14) & 0x1ff;
          const x = b >= 256 ? k[b - 256] : regs[b], y = c >= 256 ? k[c - 256] : regs[c];
          regs[a] = typeof x === 'number' && typeof y === 'number' ? x / y : this.arith(15, x, y);
          break;
        }
        case 16: { // MOD
          const b = i >>> 23, c = (i >>> 14) & 0x1ff;
          const x = b >= 256 ? k[b - 256] : regs[b], y = c >= 256 ? k[c - 256] : regs[c];
          regs[a] = this.arith(16, x, y);
          break;
        }
        case 17: { // POW
          const b = i >>> 23, c = (i >>> 14) & 0x1ff;
          const x = b >= 256 ? k[b - 256] : regs[b], y = c >= 256 ? k[c - 256] : regs[c];
          regs[a] = typeof x === 'number' && typeof y === 'number' ? Math.pow(x, y) : this.arith(17, x, y);
          break;
        }
        case 18: { // UNM
          const x = regs[i >>> 23];
          regs[a] = typeof x === 'number' ? -x : this.arith(18, x, x);
          break;
        }
        case 19: { // NOT
          const x = regs[i >>> 23];
          regs[a] = x === undefined || x === false;
          break;
        }
        case 20: // LEN
          regs[a] = this.len(regs[i >>> 23]);
          break;
        case 21: { // CONCAT
          const b = i >>> 23, c = (i >>> 14) & 0x1ff;
          let acc = regs[c];
          for (let j = c - 1; j >= b; j--) {
            const x = regs[j], tx = typeof x, ta = typeof acc;
            if (!((tx === 'string' || tx === 'number') && (ta === 'string' || ta === 'number')) && this.getmeta(x)?.getStr('__concat') === undefined && this.getmeta(acc)?.getStr('__concat') === undefined) {
              const badReg = (tx === 'string' || tx === 'number') ? c : j;
              this.rt(`attempt to concatenate ${callName(f, pc - 1, badReg < j + 1 && badReg === j ? j : badReg)}a ${luaType(badReg === j ? x : acc)} value`);
            }
            acc = this.concat(x, acc);
          }
          regs[a] = acc;
          break;
        }
        case 22: // JMP
          pc += (i >>> 14) - 131071;
          break;
        case 23: { // EQ
          const b = i >>> 23, c = (i >>> 14) & 0x1ff;
          const x = b >= 256 ? k[b - 256] : regs[b], y = c >= 256 ? k[c - 256] : regs[c];
          const r = x === y || (typeof x === 'object' || typeof y === 'object' ? this.eq(x, y) : false);
          if (r === (a !== 0)) pc += (code[pc] >>> 14) - 131071 + 1; else pc++;
          break;
        }
        case 24: { // LT
          const b = i >>> 23, c = (i >>> 14) & 0x1ff;
          const x = b >= 256 ? k[b - 256] : regs[b], y = c >= 256 ? k[c - 256] : regs[c];
          const r = typeof x === 'number' && typeof y === 'number' ? x < y : this.lt(x, y);
          if (r === (a !== 0)) pc += (code[pc] >>> 14) - 131071 + 1; else pc++;
          break;
        }
        case 25: { // LE
          const b = i >>> 23, c = (i >>> 14) & 0x1ff;
          const x = b >= 256 ? k[b - 256] : regs[b], y = c >= 256 ? k[c - 256] : regs[c];
          const r = typeof x === 'number' && typeof y === 'number' ? x <= y : this.le(x, y);
          if (r === (a !== 0)) pc += (code[pc] >>> 14) - 131071 + 1; else pc++;
          break;
        }
        case 26: { // TEST
          const x = regs[a];
          const isFalse = x === undefined || x === false;
          if (isFalse === (((i >>> 14) & 0x1ff) !== 0)) pc++; else pc += (code[pc] >>> 14) - 131071 + 1;
          break;
        }
        case 27: { // TESTSET
          const x = regs[i >>> 23];
          const isFalse = x === undefined || x === false;
          if (isFalse === (((i >>> 14) & 0x1ff) !== 0)) pc++;
          else { regs[a] = x; pc += (code[pc] >>> 14) - 131071 + 1; }
          break;
        }
        case 28: // CALL
        case 29: { // TAILCALL
          const b = i >>> 23, c = (i >>> 14) & 0x1ff;
          const fn = regs[a];
          let args: LuaValue[];
          if (b === 0) { args = regs.slice(a + 1, f.top); } else if (b === 1) args = EMPTY; else { args = new Array(b - 1); for (let j = 1; j < b; j++) args[j - 1] = regs[a + j]; }
          const nres = c - 1;
          // a tail call reuses the frame when it can (the RETURN that follows in the bytecode handles the other cases)
          const reuse = (i & 0x3f) === 29 && !f.boundary && f.openUps === null;
          let target: LuaClosure | null = null;
          let targs = args;
          if (fn instanceof LuaClosure) target = fn;
          else if (typeof fn !== 'function') {
            const h = this.getmeta(fn)?.getStr('__call');
            if (h === undefined) this.rt(`attempt to call ${callName(f, pc - 1, a)}a ${luaType(fn)} value`);
            if (h instanceof LuaClosure) { target = h; targs = [fn, ...args]; }
            else {
              const r = h(fn, ...args);
              this.nativeResults(th, f, a, nres, r, pc);
              if (r === YIELD) return YIELD;
              break;
            }
          }
          if (target !== null) {
            if (reuse) {
              const ra = f.retA, rn = f.retN;
              frames.pop();
              f = this.pushFrame(th, target, targs, ra, rn, false);
            } else {
              f = this.pushFrame(th, target, targs, a, nres, false);
            }
            cl = target; proto = cl.proto; code = proto.code; k = proto.k; regs = f.regs; pc = 0;
            break;
          }
          const r = (fn as NativeFunction)(...args);
          this.nativeResults(th, f, a, nres, r, pc);
          if (r === YIELD) return YIELD;
          break;
        }
        case 30: { // RETURN
          const b = i >>> 23;
          let vals: LuaValue[];
          if (b === 1) vals = EMPTY;
          else if (b === 0) vals = regs.slice(a, f.top);
          else { vals = new Array(b - 1); for (let j = 0; j < b - 1; j++) vals[j] = regs[a + j]; }
          const res = this.finishFrame(th, f, vals);
          if (res.done) return res.vals!;
          f = res.f!; cl = f.cl; proto = cl.proto; code = proto.code; k = proto.k; regs = f.regs; pc = f.pc;
          break;
        }
        case 31: { // FORLOOP
          const step = regs[a + 2];
          const idx = regs[a] + step;
          const limit = regs[a + 1];
          if (step > 0 ? idx <= limit : idx >= limit) {
            pc += (i >>> 14) - 131071;
            regs[a] = idx;
            regs[a + 3] = idx;
          }
          break;
        }
        case 32: { // FORPREP
          let init = regs[a], limit = regs[a + 1], step = regs[a + 2];
          if (typeof init !== 'number') { const n = this.tonumber(init); if (n === undefined) this.rt("'for' initial value must be a number"); init = n; }
          if (typeof limit !== 'number') { const n = this.tonumber(limit); if (n === undefined) this.rt("'for' limit must be a number"); limit = n; }
          if (typeof step !== 'number') { const n = this.tonumber(step); if (n === undefined) this.rt("'for' step must be a number"); step = n; }
          regs[a] = init - step; regs[a + 1] = limit; regs[a + 2] = step;
          pc += (i >>> 14) - 131071;
          break;
        }
        case 33: { // TFORLOOP
          const c = (i >>> 14) & 0x1ff;
          const fn = regs[a];
          const r = typeof fn === 'function' ? fn(regs[a + 1], regs[a + 2]) : this.callArr(fn, [regs[a + 1], regs[a + 2]]);
          if (c === 1 && !Array.isArray(r)) regs[a + 3] = r;
          else {
            const vals = r === undefined ? EMPTY : Array.isArray(r) ? r : [r];
            for (let j = 0; j < c; j++) regs[a + 3 + j] = j < vals.length ? vals[j] : undefined;
          }
          const first = regs[a + 3];
          if (first !== undefined) { regs[a + 2] = first; pc += (code[pc] >>> 14) - 131071 + 1; } else pc++;
          break;
        }
        case 34: { // SETLIST
          let n = i >>> 23;
          let c = (i >>> 14) & 0x1ff;
          if (n === 0) n = f.top - a - 1;
          if (c === 0) c = code[pc++];
          const t = regs[a] as LuaTable;
          const off = (c - 1) * 50;
          for (let j = 1; j <= n; j++) t.set(off + j, regs[a + j]);
          break;
        }
        case 35: // CLOSE
          if (f.openUps !== null) closeUps(f, a);
          break;
        case 36: { // CLOSURE
          const p = proto.p[i >>> 14];
          const ups: UpVal[] = new Array(p.nups);
          for (let j = 0; j < p.nups; j++) {
            const pi = code[pc++];
            if ((pi & 0x3f) === 0) { // MOVE: capture a local of this function
              const idx = pi >>> 23;
              let ou = f.openUps;
              if (ou === null) ou = f.openUps = [];
              let found: UpVal | undefined;
              for (let q = 0; q < ou.length; q++) if (ou[q].idx === idx) { found = ou[q]; break; }
              if (!found) { found = new UpVal(regs, idx); ou.push(found); }
              ups[j] = found;
            } else ups[j] = cl.upvals[pi >>> 23];   // GETUPVAL
          }
          regs[a] = new LuaClosure(p, ups, cl.env);
          break;
        }
        case 37: { // VARARG
          const b = i >>> 23;
          const va = f.varargs;
          if (b === 0) { for (let j = 0; j < va.length; j++) regs[a + j] = va[j]; f.top = a + va.length; }
          else for (let j = 0; j < b - 1; j++) regs[a + j] = j < va.length ? va[j] : undefined;
          break;
        }
        default:
          throw new LuaError('bad opcode ' + (i & 0x3f));
      }
    }
  }

  /** the results of a native function called from the bytecode go to the registers (or the thread yields) */
  private nativeResults(th: Thread, f: Frame, a: number, nres: number, r: LuaValue, pc: number): void {
    if (r === YIELD) {
      if (th.nativeDepth > 0 || th === this.main) this.rt('attempt to yield across metamethod/C-call boundary');
      f.resumeA = a; f.resumeN = nres; f.pc = pc;
      return;
    }
    const regs = f.regs;
    if (nres === 1) regs[a] = r === undefined ? undefined : Array.isArray(r) ? r[0] : r;
    else if (nres === 0) { /* no results wanted */ }
    else {
      const vals = r === undefined ? EMPTY : Array.isArray(r) ? r : [r];
      if (nres < 0) { for (let j = 0; j < vals.length; j++) regs[a + j] = vals[j]; f.top = a + vals.length; }
      else for (let j = 0; j < nres; j++) regs[a + j] = j < vals.length ? vals[j] : undefined;
    }
  }

  /** a frame returns: results go to the caller (a Lua frame or the native caller) */
  private finishFrame(th: Thread, f: Frame, vals: LuaValue[]): { done: boolean; vals?: LuaValue[]; f?: Frame } {
    if (f.openUps !== null) closeUps(f, 0);
    th.frames.pop();
    if (f.boundary) return { done: true, vals };
    const caller = th.frames[th.frames.length - 1];
    let n = f.retN;
    const a = f.retA;
    const regs = caller.regs;
    if (n === 1) regs[a] = vals.length ? vals[0] : undefined;
    else if (n < 0) { for (let j = 0; j < vals.length; j++) regs[a + j] = vals[j]; caller.top = a + vals.length; }
    else for (let j = 0; j < n; j++) regs[a + j] = j < vals.length ? vals[j] : undefined;
    return { done: false, f: caller };
  }

  // ------------------------------------------------------------------------------------------------------------------------------ loading chunks
  /** a closure of a precompiled function, with the global table as its environment */
  closureOf(p: Proto, env: LuaTable = this.globals): LuaClosure {
    const ups: UpVal[] = [];
    for (let i = 0; i < p.nups; i++) ups.push(new UpVal(null, 0));
    return new LuaClosure(p, ups, env);
  }
}

function closeUps(f: Frame, level: number): void {
  const ou = f.openUps;
  if (ou === null) return;
  let w = 0;
  for (let i = 0; i < ou.length; i++) {
    const u = ou[i];
    if (u.idx >= level) u.close(); else ou[w++] = u;
  }
  ou.length = w;
  if (w === 0) f.openUps = null;
}
function closeFrame(f: Frame): void { if (f.openUps !== null) closeUps(f, 0); }

/** luaO_chunkid: how the source of a chunk is shown in messages */
export function chunkName(source: string): string {
  if (source.startsWith('=')) return source.slice(1, 60);
  if (source.startsWith('@')) { const s = source.slice(1); return s.length <= 59 ? s : '...' + s.slice(s.length - 56); }
  const nl = source.indexOf(String.fromCharCode(10));
  let len = source.length;
  const room = 60 - 15;
  if (len < room && nl < 0) return `[string "${source}"]`;
  if (nl >= 0) len = nl;
  if (len > room) len = room;
  return `[string "${source.slice(0, len)}..."]`;
}

const ids = new WeakMap<object, number>();
let idCounter = 0x2000;
function idOf(o: object): number {
  let v = ids.get(o);
  if (!v) { v = (idCounter += 0x18); ids.set(o, v); }
  return v;
}

/** "global 'x' (" style description of the called register for error messages (like luaG_typeerror) */
function callName(f: Frame, pc: number, reg: number): string {
  const p = f.cl.proto, code = p.code;
  const act = p.locvars.filter(l => l.startpc <= pc && pc < l.endpc);
  if (reg < act.length) return `local '${act[reg].name}' `;
  const kname = (rk: number): string | null => { const v = rk & 256 ? p.k[rk & 255] : null; return typeof v === 'string' ? v : null; };
  for (let j = pc - 1; j >= 0; j--) {
    const i = code[j], op = i & 0x3f, a = (i >>> 6) & 0xff;
    if (a !== reg) continue;
    if (op === 5) return `global '${String(p.k[i >>> 14])}' `;
    if (op === 6) { const n = kname((i >>> 14) & 0x1ff); return n ? `field '${n}' ` : ''; }
    if (op === 11) { const n = kname((i >>> 14) & 0x1ff); return n ? `method '${n}' ` : ''; }
    if (op === 4) return `upvalue '${p.upvalueNames[i >>> 23] ?? '?'}' `;
    if (op === 0) { const lv = p.locvars.filter(l => l.startpc <= j && j < l.endpc)[i >>> 23]; return lv ? `local '${lv.name}' ` : ''; }
    return '';
  }
  return '';
}
