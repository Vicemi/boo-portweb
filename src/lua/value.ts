// Values of the Lua 5.1 virtual machine.
//   nil -> undefined, boolean, number (double), string (JS string whose chars are BYTES 0..255), LuaTable, LuaClosure, NativeFunction, Userdata, Thread
// Strings are byte strings like in Lua: text read from files is kept as latin1 and decoded as UTF-8 only where it is drawn.

export type LuaValue = any;
/** a native function that returns undefined returns NO values; to return exactly one nil it returns this */
export const NIL1: LuaValue[] = [undefined];
export type NativeFunction = ((...args: LuaValue[]) => LuaValue) & { luaName?: string };

export class LuaError extends Error {
  value: LuaValue;
  traceback: string;
  constructor(value: LuaValue, traceback = '') {
    super(typeof value === 'string' ? value : 'lua error');
    this.value = value;
    this.traceback = traceback;
  }
}

/** a table: array part (keys 1..n) + insertion ordered hash part that supports `next` without searching */
export class LuaTable {
  arr: LuaValue[] = [];                       // arr[i-1] is the value of key i (trailing nils are trimmed)
  hkeys: LuaValue[] = [];
  hvals: LuaValue[] = [];
  hmap: Map<LuaValue, number> | null = null;  // key -> slot in hkeys / hvals (created with the first hash key)
  dead = 0;                                   // slots of the hash part whose value is nil (kept so `next` keeps working while a loop clears fields)
  meta: LuaTable | null = null;
  id = 0;
  static counter = 0;

  constructor(narr = 0) {
    if (narr > 0) this.arr = new Array<LuaValue>();
  }

  get(key: LuaValue): LuaValue {
    if (typeof key === 'number') {
      const a = this.arr;
      if (key > 0 && key <= a.length && (key | 0) === key) return a[key - 1];
    }
    const m = this.hmap;
    if (m === null) return undefined;
    const i = m.get(key);
    return i === undefined ? undefined : this.hvals[i];
  }

  getStr(key: string): LuaValue {
    const m = this.hmap;
    if (m === null) return undefined;
    const i = m.get(key);
    return i === undefined ? undefined : this.hvals[i];
  }

  set(key: LuaValue, value: LuaValue): void {
    if (typeof key === 'number') {
      const a = this.arr;
      const n = a.length;
      if (key > 0 && (key | 0) === key) {
        if (key <= n) {
          a[key - 1] = value;
          if (value === undefined && key === n) { // trim trailing nils
            let k = n - 1;
            while (k > 0 && a[k - 1] === undefined) k--;
            a.length = k;
          }
          return;
        }
        if (key === n + 1) {
          if (value === undefined) { this.hashRemove(key); return; }
          a.push(value);
          if (this.hmap !== null && this.hmap.size > this.dead) this.migrate();
          return;
        }
      }
    } else if (key === undefined) throw new LuaError('table index is nil');
    else if (typeof key === 'number' && key !== key) throw new LuaError('table index is NaN');
    this.hashSet(key, value);
  }

  private hashSet(key: LuaValue, value: LuaValue): void {
    let m = this.hmap;
    if (m === null) {
      if (value === undefined) return;
      m = this.hmap = new Map();
    }
    const i = m.get(key);
    if (i !== undefined) {
      if (value === undefined) { if (this.hvals[i] !== undefined) this.dead++; }
      else if (this.hvals[i] === undefined) this.dead--;
      this.hvals[i] = value;
      return;
    }
    if (value === undefined) return;
    if (this.dead > 32 && this.dead > (this.hkeys.length >> 1)) this.compact();
    m.set(key, this.hkeys.length);
    this.hkeys.push(key);
    this.hvals.push(value);
  }

  private hashRemove(key: LuaValue): void {
    const m = this.hmap;
    if (m === null) return;
    const i = m.get(key);
    if (i !== undefined && this.hvals[i] !== undefined) { this.hvals[i] = undefined; this.dead++; }
  }

  /** after pushing key n+1 into the array part, the following keys that live in the hash part join it */
  private migrate(): void {
    const a = this.arr, m = this.hmap!;
    for (;;) {
      const i = m.get(a.length + 1);
      if (i === undefined || this.hvals[i] === undefined) return;
      a.push(this.hvals[i]);
      this.hvals[i] = undefined; this.dead++;
    }
  }

  private compact(): void {
    const k: LuaValue[] = [], v: LuaValue[] = [], m = new Map<LuaValue, number>();
    for (let i = 0; i < this.hkeys.length; i++) {
      if (this.hvals[i] === undefined) continue;
      m.set(this.hkeys[i], k.length); k.push(this.hkeys[i]); v.push(this.hvals[i]);
    }
    this.hkeys = k; this.hvals = v; this.hmap = m; this.dead = 0;
  }

  /** the length operator: the border at the end of the array part */
  length(): number {
    const n = this.arr.length;
    if (n > 0) return n;
    if (this.hmap !== null && this.hmap.size > this.dead) {   // keys 1.. stored in the hash part (set before the array part existed)
      let k = 0;
      while (this.get(k + 1) !== undefined) k++;
      return k;
    }
    return 0;
  }

  /** `next`: returns [key, value] after `key` (undefined = start) or undefined at the end */
  next(key: LuaValue): [LuaValue, LuaValue] | undefined {
    const a = this.arr;
    let ai = -1, hs = 0;                      // ai: where the array part continues, hs: where the hash part continues
    if (key === undefined) { ai = 0; hs = 0; }
    else if (typeof key === 'number' && key >= 1 && (key | 0) === key && key <= a.length) { ai = key; hs = 0; }
    else {
      const si = this.hmap === null ? undefined : this.hmap.get(key);
      if (si !== undefined) hs = si + 1;
      else if (typeof key === 'number' && key >= 1 && (key | 0) === key) { ai = a.length; hs = 0; }   // (the array part shrank during the loop)
      else throw new LuaError("invalid key to 'next'");
    }
    if (ai >= 0) for (let i = ai; i < a.length; i++) if (a[i] !== undefined) return [i + 1, a[i]];
    for (let i = hs; i < this.hkeys.length; i++) if (this.hvals[i] !== undefined) return [this.hkeys[i], this.hvals[i]];
    return undefined;
  }
}

export class Proto {
  source = '';
  lineDefined = 0;
  lastLine = 0;
  nups = 0;
  numparams = 0;
  isVararg = 0;
  maxstack = 0;
  code: Int32Array = new Int32Array(0);
  k: LuaValue[] = [];
  p: Proto[] = [];
  lineinfo: Int32Array = new Int32Array(0);
  locvars: { name: string; startpc: number; endpc: number }[] = [];
  upvalueNames: string[] = [];
}

export class UpVal {
  // open: v lives in stack[idx]; closed: v holds the value
  stack: LuaValue[] | null;
  idx: number;
  v: LuaValue;
  constructor(stack: LuaValue[] | null, idx: number) { this.stack = stack; this.idx = idx; this.v = undefined; }
  get(): LuaValue { return this.stack === null ? this.v : this.stack[this.idx]; }
  set(x: LuaValue): void { if (this.stack === null) this.v = x; else this.stack[this.idx] = x; }
  close(): void { if (this.stack !== null) { this.v = this.stack[this.idx]; this.stack = null; } }
}

export class LuaClosure {
  proto: Proto;
  upvals: UpVal[];
  env: LuaTable;
  constructor(proto: Proto, upvals: UpVal[], env: LuaTable) { this.proto = proto; this.upvals = upvals; this.env = env; }
}

/** an object of the host (engine) seen from Lua: it answers the index operations itself */
export abstract class Userdata {
  meta: LuaTable | null = null;
  abstract lget(key: LuaValue): LuaValue;
  abstract lset(key: LuaValue, value: LuaValue): void;
  tostring(): string { return 'userdata'; }
}

export function type(v: LuaValue): string {
  switch (typeof v) {
    case 'undefined': return 'nil';
    case 'boolean': return 'boolean';
    case 'number': return 'number';
    case 'string': return 'string';
    case 'function': return 'function';
    default:
      if (v instanceof LuaTable) return 'table';
      if (v instanceof LuaClosure) return 'function';
      if (v instanceof Userdata) return 'userdata';
      if (v !== null && v.isThread) return 'thread';
      return 'userdata';
  }
}

/** number -> string like C's "%.14g" */
export function numToStr(n: number): string {
  if (n !== n) return n < 0 ? '-nan' : (Object.is(n, NaN) ? 'nan' : 'nan');
  if (n === Infinity) return 'inf';
  if (n === -Infinity) return '-inf';
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return n === 0 && 1 / n < 0 ? '-0' : String(n);
  return fmtG(n, 14, false);
}

/** C's %g (precision p, `alt` = '#' flag keeps trailing zeros) */
export function fmtG(n: number, p: number, alt: boolean): string {
  if (n !== n) return 'nan';
  if (n === Infinity) return 'inf';
  if (n === -Infinity) return '-inf';
  if (p === 0) p = 1;
  if (n === 0) return (1 / n < 0 ? '-0' : '0') + (alt && p > 1 ? '.' + '0'.repeat(p - 1) : '');
  const e = Math.floor(Math.log10(Math.abs(n)));
  let exp = Number(n.toExponential(p - 1).split('e')[1]);
  void e;
  let s: string;
  if (exp < -4 || exp >= p) {
    s = n.toExponential(p - 1);
    let [mant, ex] = s.split('e');
    if (!alt && mant.includes('.')) mant = mant.replace(/0+$/, '').replace(/\.$/, '');
    const en = Number(ex);
    s = mant + 'e' + (en < 0 ? '-' : '+') + String(Math.abs(en)).padStart(2, '0');
  } else {
    s = n.toFixed(Math.max(0, p - 1 - exp));
    if (!alt && s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  }
  return s;
}

/** string -> number the way Lua converts (decimal, hex 0x.., spaces around); undefined if it is not a number */
export function strToNum(s: string): number | undefined {
  const t = s.trim();
  if (t === '') return undefined;
  if (/^[-+]?0[xX][0-9a-fA-F]+$/.test(t)) {
    const neg = t[0] === '-';
    const v = parseInt(t.replace(/^[-+]/, ''), 16);
    return neg ? -v : v;
  }
  if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return Number(t);
  if (/^[-+]?(inf|infinity)$/i.test(t) || /^[-+]?nan$/i.test(t)) return undefined;
  return undefined;
}
