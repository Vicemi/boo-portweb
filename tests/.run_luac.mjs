// tests/run_luac.ts
import { readFileSync } from "node:fs";

// src/lua/value.ts
var NIL1 = [void 0];
var LuaError = class extends Error {
  value;
  traceback;
  constructor(value, traceback = "") {
    super(typeof value === "string" ? value : "lua error");
    this.value = value;
    this.traceback = traceback;
  }
};
var LuaTable = class {
  arr = [];
  // arr[i-1] is the value of key i (trailing nils are trimmed)
  hkeys = [];
  hvals = [];
  hmap = null;
  // key -> slot in hkeys / hvals (created with the first hash key)
  dead = 0;
  // slots of the hash part whose value is nil (kept so `next` keeps working while a loop clears fields)
  meta = null;
  id = 0;
  static counter = 0;
  constructor(narr = 0) {
    if (narr > 0) this.arr = new Array();
  }
  get(key) {
    if (typeof key === "number") {
      const a = this.arr;
      if (key > 0 && key <= a.length && (key | 0) === key) return a[key - 1];
    }
    const m = this.hmap;
    if (m === null) return void 0;
    const i = m.get(key);
    return i === void 0 ? void 0 : this.hvals[i];
  }
  getStr(key) {
    const m = this.hmap;
    if (m === null) return void 0;
    const i = m.get(key);
    return i === void 0 ? void 0 : this.hvals[i];
  }
  set(key, value) {
    if (typeof key === "number") {
      const a = this.arr;
      const n = a.length;
      if (key > 0 && (key | 0) === key) {
        if (key <= n) {
          a[key - 1] = value;
          if (value === void 0 && key === n) {
            let k = n - 1;
            while (k > 0 && a[k - 1] === void 0) k--;
            a.length = k;
          }
          return;
        }
        if (key === n + 1) {
          if (value === void 0) {
            this.hashRemove(key);
            return;
          }
          a.push(value);
          if (this.hmap !== null && this.hmap.size > this.dead) this.migrate();
          return;
        }
      }
    } else if (key === void 0) throw new LuaError("table index is nil");
    else if (typeof key === "number" && key !== key) throw new LuaError("table index is NaN");
    this.hashSet(key, value);
  }
  hashSet(key, value) {
    let m = this.hmap;
    if (m === null) {
      if (value === void 0) return;
      m = this.hmap = /* @__PURE__ */ new Map();
    }
    const i = m.get(key);
    if (i !== void 0) {
      if (value === void 0) {
        if (this.hvals[i] !== void 0) this.dead++;
      } else if (this.hvals[i] === void 0) this.dead--;
      this.hvals[i] = value;
      return;
    }
    if (value === void 0) return;
    if (this.dead > 32 && this.dead > this.hkeys.length >> 1) this.compact();
    m.set(key, this.hkeys.length);
    this.hkeys.push(key);
    this.hvals.push(value);
  }
  hashRemove(key) {
    const m = this.hmap;
    if (m === null) return;
    const i = m.get(key);
    if (i !== void 0 && this.hvals[i] !== void 0) {
      this.hvals[i] = void 0;
      this.dead++;
    }
  }
  /** after pushing key n+1 into the array part, the following keys that live in the hash part join it */
  migrate() {
    const a = this.arr, m = this.hmap;
    for (; ; ) {
      const i = m.get(a.length + 1);
      if (i === void 0 || this.hvals[i] === void 0) return;
      a.push(this.hvals[i]);
      this.hvals[i] = void 0;
      this.dead++;
    }
  }
  compact() {
    const k = [], v = [], m = /* @__PURE__ */ new Map();
    for (let i = 0; i < this.hkeys.length; i++) {
      if (this.hvals[i] === void 0) continue;
      m.set(this.hkeys[i], k.length);
      k.push(this.hkeys[i]);
      v.push(this.hvals[i]);
    }
    this.hkeys = k;
    this.hvals = v;
    this.hmap = m;
    this.dead = 0;
  }
  /** the length operator: the border at the end of the array part */
  length() {
    const n = this.arr.length;
    if (n > 0) return n;
    if (this.hmap !== null && this.hmap.size > this.dead) {
      let k = 0;
      while (this.get(k + 1) !== void 0) k++;
      return k;
    }
    return 0;
  }
  /** `next`: returns [key, value] after `key` (undefined = start) or undefined at the end */
  next(key) {
    const a = this.arr;
    let ai = -1, hs = 0;
    if (key === void 0) {
      ai = 0;
      hs = 0;
    } else if (typeof key === "number" && key >= 1 && (key | 0) === key && key <= a.length) {
      ai = key;
      hs = 0;
    } else {
      const si = this.hmap === null ? void 0 : this.hmap.get(key);
      if (si !== void 0) hs = si + 1;
      else if (typeof key === "number" && key >= 1 && (key | 0) === key) {
        ai = a.length;
        hs = 0;
      } else throw new LuaError("invalid key to 'next'");
    }
    if (ai >= 0) {
      for (let i = ai; i < a.length; i++) if (a[i] !== void 0) return [i + 1, a[i]];
    }
    for (let i = hs; i < this.hkeys.length; i++) if (this.hvals[i] !== void 0) return [this.hkeys[i], this.hvals[i]];
    return void 0;
  }
};
var Proto = class {
  source = "";
  lineDefined = 0;
  lastLine = 0;
  nups = 0;
  numparams = 0;
  isVararg = 0;
  maxstack = 0;
  code = new Int32Array(0);
  k = [];
  p = [];
  lineinfo = new Int32Array(0);
  locvars = [];
  upvalueNames = [];
};
var UpVal = class {
  // open: v lives in stack[idx]; closed: v holds the value
  stack;
  idx;
  v;
  constructor(stack, idx) {
    this.stack = stack;
    this.idx = idx;
    this.v = void 0;
  }
  get() {
    return this.stack === null ? this.v : this.stack[this.idx];
  }
  set(x) {
    if (this.stack === null) this.v = x;
    else this.stack[this.idx] = x;
  }
  close() {
    if (this.stack !== null) {
      this.v = this.stack[this.idx];
      this.stack = null;
    }
  }
};
var LuaClosure = class {
  proto;
  upvals;
  env;
  constructor(proto, upvals, env) {
    this.proto = proto;
    this.upvals = upvals;
    this.env = env;
  }
};
var Userdata = class {
  meta = null;
  tostring() {
    return "userdata";
  }
};
function type(v) {
  switch (typeof v) {
    case "undefined":
      return "nil";
    case "boolean":
      return "boolean";
    case "number":
      return "number";
    case "string":
      return "string";
    case "function":
      return "function";
    default:
      if (v instanceof LuaTable) return "table";
      if (v instanceof LuaClosure) return "function";
      if (v instanceof Userdata) return "userdata";
      if (v !== null && v.isThread) return "thread";
      return "userdata";
  }
}
function numToStr(n) {
  if (n !== n) return n < 0 ? "-nan" : Object.is(n, NaN) ? "nan" : "nan";
  if (n === Infinity) return "inf";
  if (n === -Infinity) return "-inf";
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return n === 0 && 1 / n < 0 ? "-0" : String(n);
  return fmtG(n, 14, false);
}
function fmtG(n, p, alt) {
  if (n !== n) return "nan";
  if (n === Infinity) return "inf";
  if (n === -Infinity) return "-inf";
  if (p === 0) p = 1;
  if (n === 0) return (1 / n < 0 ? "-0" : "0") + (alt && p > 1 ? "." + "0".repeat(p - 1) : "");
  const e = Math.floor(Math.log10(Math.abs(n)));
  let exp = Number(n.toExponential(p - 1).split("e")[1]);
  void e;
  let s;
  if (exp < -4 || exp >= p) {
    s = n.toExponential(p - 1);
    let [mant, ex] = s.split("e");
    if (!alt && mant.includes(".")) mant = mant.replace(/0+$/, "").replace(/\.$/, "");
    const en = Number(ex);
    s = mant + "e" + (en < 0 ? "-" : "+") + String(Math.abs(en)).padStart(2, "0");
  } else {
    s = n.toFixed(Math.max(0, p - 1 - exp));
    if (!alt && s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  }
  return s;
}
function strToNum(s) {
  const t = s.trim();
  if (t === "") return void 0;
  if (/^[-+]?0[xX][0-9a-fA-F]+$/.test(t)) {
    const neg = t[0] === "-";
    const v = parseInt(t.replace(/^[-+]/, ""), 16);
    return neg ? -v : v;
  }
  if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return Number(t);
  if (/^[-+]?(inf|infinity)$/i.test(t) || /^[-+]?nan$/i.test(t)) return void 0;
  return void 0;
}

// src/lua/vm.ts
var YIELD = { yield: true };
var Frame = class {
  cl;
  regs;
  pc = 0;
  varargs = EMPTY;
  openUps = null;
  top = 0;
  // end of a multiple result (CALL with C=0, VARARG with B=0)
  retA = 0;
  // where the results go in the caller: register and count (-1 = all)
  retN = 0;
  boundary = false;
  // returned to a native caller (vm.call)
  tail = false;
  resumeA = -1;
  resumeN = 0;
  // pending CALL of a yield
  constructor(cl, regs) {
    this.cl = cl;
    this.regs = regs;
  }
};
var EMPTY = [];
var Thread = class {
  isThread = true;
  frames = [];
  status = "suspended";
  fn;
  started = false;
  nativeDepth = 0;
  yielded = [];
  constructor(fn) {
    this.fn = fn;
  }
};
var MAX_FRAMES = 6e3;
var LuaState = class {
  globals = new LuaTable();
  registry = new LuaTable();
  stringMeta = null;
  main = new Thread(void 0);
  cur = this.main;
  loaded = new LuaTable();
  /** a hook for the host to find the source line of an error */
  constructor() {
    this.main.status = "running";
    this.globals.set("_G", this.globals);
  }
  // ------------------------------------------------------------------------------------------------------------------------------ errors
  where(level = 1) {
    const fr = this.cur.frames;
    const f = fr[fr.length - level];
    if (!f) return "";
    const p = f.cl.proto;
    const line = p.lineinfo.length ? p.lineinfo[Math.max(0, f.pc - 1)] : 0;
    return `${chunkName(p.source)}:${line}: `;
  }
  rt(msg) {
    throw new LuaError(this.where() + msg, this.traceback());
  }
  traceback() {
    const out2 = [];
    const fr = this.cur.frames;
    for (let i = fr.length - 1, n = 0; i >= 0 && n < 25; i--, n++) {
      const p = fr[i].cl.proto;
      const line = p.lineinfo.length ? p.lineinfo[Math.max(0, fr[i].pc - 1)] : 0;
      out2.push(`  ${chunkName(p.source)}:${line}: in function <${chunkName(p.source)}:${p.lineDefined}>`);
    }
    return out2.join("\n");
  }
  // ------------------------------------------------------------------------------------------------------------------------------ metatables
  getmeta(v) {
    if (v instanceof LuaTable) return v.meta;
    if (typeof v === "string") return this.stringMeta;
    if (v instanceof Userdata) return v.meta;
    return null;
  }
  index(obj, key) {
    for (let loop = 0; loop < 100; loop++) {
      let h;
      if (obj instanceof LuaTable) {
        const v = obj.get(key);
        if (v !== void 0) return v;
        const m = obj.meta;
        if (m === null) return void 0;
        h = m.getStr("__index");
        if (h === void 0) return void 0;
      } else if (obj instanceof Userdata) {
        const v = obj.lget(key);
        if (v !== void 0) return v;
        const m = obj.meta;
        if (m === null) return void 0;
        h = m.getStr("__index");
        if (h === void 0) return void 0;
      } else {
        const m = this.getmeta(obj);
        h = m === null ? void 0 : m.getStr("__index");
        if (h === void 0) this.rt(`attempt to index a ${type(obj)} value`);
      }
      if (typeof h === "function" || h instanceof LuaClosure) return this.call1(h, obj, key);
      obj = h;
    }
    return this.rt("loop in gettable");
  }
  setindex(obj, key, val) {
    for (let loop = 0; loop < 100; loop++) {
      let h;
      if (obj instanceof LuaTable) {
        const m = obj.meta;
        if (m === null) {
          this.rawsetChecked(obj, key, val);
          return;
        }
        h = m.getStr("__newindex");
        if (h === void 0 || obj.get(key) !== void 0) {
          this.rawsetChecked(obj, key, val);
          return;
        }
      } else if (obj instanceof Userdata) {
        const m = obj.meta;
        h = m === null ? void 0 : m.getStr("__newindex");
        if (h === void 0) {
          obj.lset(key, val);
          return;
        }
      } else {
        const m = this.getmeta(obj);
        h = m === null ? void 0 : m.getStr("__newindex");
        if (h === void 0) this.rt(`attempt to index a ${type(obj)} value`);
      }
      if (typeof h === "function" || h instanceof LuaClosure) {
        this.call(h, obj, key, val);
        return;
      }
      obj = h;
    }
    this.rt("loop in settable");
  }
  rawsetChecked(t, key, val) {
    if (key === void 0) this.rt("table index is nil");
    if (typeof key === "number" && key !== key) this.rt("table index is NaN");
    t.set(key, val);
  }
  // ------------------------------------------------------------------------------------------------------------------------------ calls from native code
  /** calls any callable value; returns the array of results */
  call(fn, ...args) {
    return this.callArr(fn, args);
  }
  call1(fn, ...args) {
    const r = this.callArr(fn, args);
    return r.length ? r[0] : void 0;
  }
  callArr(fn, args) {
    if (typeof fn === "function") {
      const r = fn(...args);
      if (r === YIELD) this.rt("attempt to yield across metamethod/C-call boundary");
      return r === void 0 ? EMPTY : Array.isArray(r) ? r : [r];
    }
    if (fn instanceof LuaClosure) {
      const th = this.cur;
      const depth = th.frames.length;
      this.pushFrame(th, fn, args, 0, -1, true);
      th.nativeDepth++;
      try {
        return this.run(th, depth);
      } finally {
        th.nativeDepth--;
        if (th.frames.length > depth) {
          for (let i = th.frames.length - 1; i >= depth; i--) closeFrame(th.frames[i]);
          th.frames.length = depth;
        }
      }
    }
    const h = this.getmeta(fn)?.getStr("__call");
    if (h !== void 0) return this.callArr(h, [fn, ...args]);
    return this.rt(`attempt to call a ${type(fn)} value`);
  }
  pushFrame(th, cl, args, retA, retN, boundary) {
    if (th.frames.length >= MAX_FRAMES) this.rt("stack overflow");
    const p = cl.proto;
    const regs = new Array(p.maxstack);
    const np = p.numparams;
    const na = args.length;
    for (let i = 0; i < np; i++) regs[i] = i < na ? args[i] : void 0;
    const f = new Frame(cl, regs);
    if (p.isVararg) {
      f.varargs = na > np ? args.slice(np) : EMPTY;
      if (p.isVararg & 4) {
        const t = new LuaTable();
        for (let i = 0; i < f.varargs.length; i++) t.set(i + 1, f.varargs[i]);
        t.set("n", f.varargs.length);
        regs[np] = t;
      }
    }
    f.retA = retA;
    f.retN = retN;
    f.boundary = boundary;
    th.frames.push(f);
    return f;
  }
  /** the entry point: a closure is called with arguments (used by the host for the chunks it loads) */
  pcall(fn, args) {
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
      if (e instanceof RangeError) return { ok: false, err: "stack overflow", traceback: "" };
      throw e;
    }
  }
  // ------------------------------------------------------------------------------------------------------------------------------ arithmetic
  tonumber(v) {
    if (typeof v === "number") return v;
    if (typeof v === "string") return strToNum(v);
    return void 0;
  }
  arith(op, a, b) {
    const x = this.tonumber(a), y = this.tonumber(b);
    if (x !== void 0 && y !== void 0) {
      switch (op) {
        case 12:
          return x + y;
        case 13:
          return x - y;
        case 14:
          return x * y;
        case 15:
          return x / y;
        case 16:
          return x - Math.floor(x / y) * y;
        case 17:
          return Math.pow(x, y);
        case 18:
          return -x;
      }
    }
    const ev = ["__add", "__sub", "__mul", "__div", "__mod", "__pow", "__unm"][op - 12];
    let h = this.getmeta(a)?.getStr(ev);
    if (h === void 0) h = this.getmeta(b)?.getStr(ev);
    if (h !== void 0) return this.call1(h, a, b);
    const bad = typeof a === "number" || typeof a === "string" && strToNum(a) !== void 0 ? b : a;
    return this.rt(`attempt to perform arithmetic on a ${type(bad)} value`);
  }
  concat(a, b) {
    const ta = typeof a, tb = typeof b;
    if ((ta === "string" || ta === "number") && (tb === "string" || tb === "number")) return (ta === "number" ? numToStr(a) : a) + (tb === "number" ? numToStr(b) : b);
    let h = this.getmeta(a)?.getStr("__concat");
    if (h === void 0) h = this.getmeta(b)?.getStr("__concat");
    if (h !== void 0) return this.call1(h, a, b);
    const bad = ta === "string" || ta === "number" ? b : a;
    return this.rt(`attempt to concatenate a ${type(bad)} value`);
  }
  eq(a, b) {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (a instanceof LuaTable || a instanceof Userdata) {
      if (b === a) return true;
      if (a instanceof LuaTable && !(b instanceof LuaTable) || a instanceof Userdata && !(b instanceof Userdata)) return false;
      const ma = this.getmeta(a)?.getStr("__eq");
      if (ma === void 0) return false;
      const mb = this.getmeta(b)?.getStr("__eq");
      if (ma !== mb) return false;
      const r = this.call1(ma, a, b);
      return r !== void 0 && r !== false;
    }
    return false;
  }
  lt(a, b) {
    const ta = typeof a, tb = typeof b;
    if (ta === "number" && tb === "number") return a < b;
    if (ta === "string" && tb === "string") return a < b;
    return this.compareMeta("__lt", a, b, false);
  }
  le(a, b) {
    const ta = typeof a, tb = typeof b;
    if (ta === "number" && tb === "number") return a <= b;
    if (ta === "string" && tb === "string") return a <= b;
    return this.compareMeta("__le", a, b, true);
  }
  compareMeta(ev, a, b, isLe) {
    if (typeof a !== typeof b) this.rt(`attempt to compare ${type(a)} with ${type(b)}`);
    let h = this.getmeta(a)?.getStr(ev);
    const hb = this.getmeta(b)?.getStr(ev);
    if (h === void 0 || h !== hb) {
      if (isLe) {
        const lt = this.getmeta(a)?.getStr("__lt");
        if (lt !== void 0 && lt === this.getmeta(b)?.getStr("__lt")) {
          const r2 = this.call1(lt, b, a);
          return !(r2 !== void 0 && r2 !== false);
        }
      }
      this.rt(`attempt to compare two ${type(a)} values`);
    }
    const r = this.call1(h, a, b);
    return r !== void 0 && r !== false;
  }
  len(v) {
    if (typeof v === "string") return v.length;
    if (v instanceof LuaTable) return v.length();
    if (v instanceof Userdata) {
      const r = v.lget("__len");
      if (typeof r === "number") return r;
    }
    return this.rt(`attempt to get length of a ${type(v)} value`);
  }
  tostring(v) {
    switch (typeof v) {
      case "undefined":
        return "nil";
      case "boolean":
        return v ? "true" : "false";
      case "number":
        return numToStr(v);
      case "string":
        return v;
    }
    const h = this.getmeta(v)?.getStr("__tostring");
    if (h !== void 0) {
      const r = this.call1(h, v);
      if (typeof r !== "string") this.rt("'__tostring' must return a string");
      return r;
    }
    if (v instanceof LuaTable) {
      if (!v.id) v.id = ++LuaTable.counter;
      return "table: 0x" + (16777216 + v.id * 8).toString(16).padStart(8, "0");
    }
    if (v instanceof LuaClosure) return "function: 0x" + idOf(v).toString(16).padStart(8, "0");
    if (typeof v === "function") return "function: builtin: 0x" + idOf(v).toString(16).padStart(8, "0");
    if (v instanceof Userdata) return v.tostring();
    if (v && v.isThread) return "thread: 0x" + idOf(v).toString(16).padStart(8, "0");
    return "userdata";
  }
  // ------------------------------------------------------------------------------------------------------------------------------ coroutines
  newThread(fn) {
    return new Thread(fn);
  }
  /** resumes a coroutine; returns [true, ...values] or [false, error] */
  resume(th, args) {
    if (th.status === "dead") return [false, "cannot resume dead coroutine"];
    if (th.status === "running") return [false, "cannot resume non-suspended coroutine"];
    if (th.status === "normal") return [false, "cannot resume non-suspended coroutine"];
    const prev = this.cur;
    prev.status = "normal";
    th.status = "running";
    this.cur = th;
    try {
      let out2;
      if (!th.started) {
        th.started = true;
        const fn = th.fn;
        if (typeof fn === "function") {
          const r2 = fn(...args);
          out2 = r2 === void 0 ? [] : Array.isArray(r2) ? r2 : [r2];
          th.status = "dead";
          return [true, ...out2];
        }
        if (!(fn instanceof LuaClosure)) {
          const h = this.getmeta(fn)?.getStr("__call");
          if (h === void 0) throw new LuaError("attempt to call a " + type(fn) + " value");
        }
        this.pushFrame(th, fn, args, 0, -1, true);
      } else {
        const f = th.frames[th.frames.length - 1];
        this.storeResults(f, f.resumeA, f.resumeN, args);
      }
      const r = this.run(th, 0);
      if (r === YIELD) {
        th.status = "suspended";
        return [true, ...th.yielded];
      }
      th.status = "dead";
      return [true, ...r];
    } catch (e) {
      th.status = "dead";
      if (e instanceof LuaError) return [false, e.value];
      if (e instanceof RangeError) return [false, "stack overflow"];
      throw e;
    } finally {
      this.cur = prev;
      prev.status = "running";
    }
  }
  storeResults(f, a, n, vals) {
    const regs = f.regs;
    if (n < 0) {
      for (let i = 0; i < vals.length; i++) regs[a + i] = vals[i];
      f.top = a + vals.length;
    } else {
      for (let i = 0; i < n; i++) regs[a + i] = i < vals.length ? vals[i] : void 0;
    }
  }
  // ------------------------------------------------------------------------------------------------------------------------------ the interpreter
  /** runs the thread until the frame at depth `stopDepth` returns; gives its results (or YIELD) */
  run(th, stopDepth) {
    const frames = th.frames;
    let f = frames[frames.length - 1];
    let cl = f.cl;
    let proto = cl.proto;
    let code = proto.code;
    let k = proto.k;
    let regs = f.regs;
    let pc = f.pc;
    for (; ; ) {
      const i = code[pc++];
      f.pc = pc;
      const a = i >>> 6 & 255;
      switch (i & 63) {
        case 0:
          regs[a] = regs[i >>> 23];
          break;
        case 1:
          regs[a] = k[i >>> 14];
          break;
        case 2:
          regs[a] = i >>> 23 !== 0;
          if ((i >>> 14 & 511) !== 0) pc++;
          break;
        case 3: {
          const b = i >>> 23;
          for (let j = a; j <= b; j++) regs[j] = void 0;
          break;
        }
        case 4:
          regs[a] = cl.upvals[i >>> 23].get();
          break;
        case 5: {
          const key = k[i >>> 14];
          const env = cl.env;
          const v = env.getStr(key);
          regs[a] = v !== void 0 || env.meta === null ? v : this.index(env, key);
          break;
        }
        case 6: {
          const t = regs[i >>> 23];
          const c = i >>> 14 & 511;
          const key = c >= 256 ? k[c - 256] : regs[c];
          if (t instanceof LuaTable) {
            const v = t.get(key);
            regs[a] = v !== void 0 || t.meta === null ? v : this.index(t, key);
          } else regs[a] = this.index(t, key);
          break;
        }
        case 7: {
          const key = k[i >>> 14];
          const env = cl.env;
          if (env.meta === null) env.set(key, regs[a]);
          else this.setindex(env, key, regs[a]);
          break;
        }
        case 8:
          cl.upvals[i >>> 23].set(regs[a]);
          break;
        case 9: {
          const t = regs[a];
          const b = i >>> 23, c = i >>> 14 & 511;
          const key = b >= 256 ? k[b - 256] : regs[b];
          const val = c >= 256 ? k[c - 256] : regs[c];
          if (t instanceof LuaTable && t.meta === null) {
            if (key === void 0) this.rt("table index is nil");
            if (typeof key === "number" && key !== key) this.rt("table index is NaN");
            t.set(key, val);
          } else this.setindex(t, key, val);
          break;
        }
        case 10:
          regs[a] = new LuaTable();
          break;
        case 11: {
          const t = regs[i >>> 23];
          const c = i >>> 14 & 511;
          const key = c >= 256 ? k[c - 256] : regs[c];
          regs[a + 1] = t;
          if (t instanceof LuaTable) {
            const v = t.get(key);
            regs[a] = v !== void 0 || t.meta === null ? v : this.index(t, key);
          } else regs[a] = this.index(t, key);
          break;
        }
        case 12: {
          const b = i >>> 23, c = i >>> 14 & 511;
          const x = b >= 256 ? k[b - 256] : regs[b], y = c >= 256 ? k[c - 256] : regs[c];
          regs[a] = typeof x === "number" && typeof y === "number" ? x + y : this.arith(12, x, y);
          break;
        }
        case 13: {
          const b = i >>> 23, c = i >>> 14 & 511;
          const x = b >= 256 ? k[b - 256] : regs[b], y = c >= 256 ? k[c - 256] : regs[c];
          regs[a] = typeof x === "number" && typeof y === "number" ? x - y : this.arith(13, x, y);
          break;
        }
        case 14: {
          const b = i >>> 23, c = i >>> 14 & 511;
          const x = b >= 256 ? k[b - 256] : regs[b], y = c >= 256 ? k[c - 256] : regs[c];
          regs[a] = typeof x === "number" && typeof y === "number" ? x * y : this.arith(14, x, y);
          break;
        }
        case 15: {
          const b = i >>> 23, c = i >>> 14 & 511;
          const x = b >= 256 ? k[b - 256] : regs[b], y = c >= 256 ? k[c - 256] : regs[c];
          regs[a] = typeof x === "number" && typeof y === "number" ? x / y : this.arith(15, x, y);
          break;
        }
        case 16: {
          const b = i >>> 23, c = i >>> 14 & 511;
          const x = b >= 256 ? k[b - 256] : regs[b], y = c >= 256 ? k[c - 256] : regs[c];
          regs[a] = this.arith(16, x, y);
          break;
        }
        case 17: {
          const b = i >>> 23, c = i >>> 14 & 511;
          const x = b >= 256 ? k[b - 256] : regs[b], y = c >= 256 ? k[c - 256] : regs[c];
          regs[a] = typeof x === "number" && typeof y === "number" ? Math.pow(x, y) : this.arith(17, x, y);
          break;
        }
        case 18: {
          const x = regs[i >>> 23];
          regs[a] = typeof x === "number" ? -x : this.arith(18, x, x);
          break;
        }
        case 19: {
          const x = regs[i >>> 23];
          regs[a] = x === void 0 || x === false;
          break;
        }
        case 20:
          regs[a] = this.len(regs[i >>> 23]);
          break;
        case 21: {
          const b = i >>> 23, c = i >>> 14 & 511;
          let acc = regs[c];
          for (let j = c - 1; j >= b; j--) acc = this.concat(regs[j], acc);
          regs[a] = acc;
          break;
        }
        case 22:
          pc += (i >>> 14) - 131071;
          break;
        case 23: {
          const b = i >>> 23, c = i >>> 14 & 511;
          const x = b >= 256 ? k[b - 256] : regs[b], y = c >= 256 ? k[c - 256] : regs[c];
          const r = x === y || (typeof x === "object" || typeof y === "object" ? this.eq(x, y) : false);
          if (r === (a !== 0)) pc += (code[pc] >>> 14) - 131071 + 1;
          else pc++;
          break;
        }
        case 24: {
          const b = i >>> 23, c = i >>> 14 & 511;
          const x = b >= 256 ? k[b - 256] : regs[b], y = c >= 256 ? k[c - 256] : regs[c];
          const r = typeof x === "number" && typeof y === "number" ? x < y : this.lt(x, y);
          if (r === (a !== 0)) pc += (code[pc] >>> 14) - 131071 + 1;
          else pc++;
          break;
        }
        case 25: {
          const b = i >>> 23, c = i >>> 14 & 511;
          const x = b >= 256 ? k[b - 256] : regs[b], y = c >= 256 ? k[c - 256] : regs[c];
          const r = typeof x === "number" && typeof y === "number" ? x <= y : this.le(x, y);
          if (r === (a !== 0)) pc += (code[pc] >>> 14) - 131071 + 1;
          else pc++;
          break;
        }
        case 26: {
          const x = regs[a];
          const isFalse2 = x === void 0 || x === false;
          if (isFalse2 !== ((i >>> 14 & 511) !== 0)) pc++;
          else pc += (code[pc] >>> 14) - 131071 + 1;
          break;
        }
        case 27: {
          const x = regs[i >>> 23];
          const isFalse2 = x === void 0 || x === false;
          if (isFalse2 !== ((i >>> 14 & 511) !== 0)) pc++;
          else {
            regs[a] = x;
            pc += (code[pc] >>> 14) - 131071 + 1;
          }
          break;
        }
        case 28:
        // CALL
        case 29: {
          const b = i >>> 23, c = i >>> 14 & 511;
          const fn = regs[a];
          let args;
          if (b === 0) {
            args = regs.slice(a + 1, f.top);
          } else if (b === 1) args = EMPTY;
          else {
            args = new Array(b - 1);
            for (let j = 1; j < b; j++) args[j - 1] = regs[a + j];
          }
          const nres = c - 1;
          const reuse = (i & 63) === 29 && !f.boundary && f.openUps === null;
          let target = null;
          let targs = args;
          if (fn instanceof LuaClosure) target = fn;
          else if (typeof fn !== "function") {
            const h = this.getmeta(fn)?.getStr("__call");
            if (h === void 0) this.rt(`attempt to call a ${type(fn)} value`);
            if (h instanceof LuaClosure) {
              target = h;
              targs = [fn, ...args];
            } else {
              const r2 = h(fn, ...args);
              this.nativeResults(th, f, a, nres, r2, pc);
              if (r2 === YIELD) return YIELD;
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
            cl = target;
            proto = cl.proto;
            code = proto.code;
            k = proto.k;
            regs = f.regs;
            pc = 0;
            break;
          }
          const r = fn(...args);
          this.nativeResults(th, f, a, nres, r, pc);
          if (r === YIELD) return YIELD;
          break;
        }
        case 30: {
          const b = i >>> 23;
          let vals;
          if (b === 1) vals = EMPTY;
          else if (b === 0) vals = regs.slice(a, f.top);
          else {
            vals = new Array(b - 1);
            for (let j = 0; j < b - 1; j++) vals[j] = regs[a + j];
          }
          const res = this.finishFrame(th, f, vals);
          if (res.done) return res.vals;
          f = res.f;
          cl = f.cl;
          proto = cl.proto;
          code = proto.code;
          k = proto.k;
          regs = f.regs;
          pc = f.pc;
          break;
        }
        case 31: {
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
        case 32: {
          let init = regs[a], limit = regs[a + 1], step = regs[a + 2];
          if (typeof init !== "number") {
            const n = this.tonumber(init);
            if (n === void 0) this.rt("'for' initial value must be a number");
            init = n;
          }
          if (typeof limit !== "number") {
            const n = this.tonumber(limit);
            if (n === void 0) this.rt("'for' limit must be a number");
            limit = n;
          }
          if (typeof step !== "number") {
            const n = this.tonumber(step);
            if (n === void 0) this.rt("'for' step must be a number");
            step = n;
          }
          regs[a] = init - step;
          regs[a + 1] = limit;
          regs[a + 2] = step;
          pc += (i >>> 14) - 131071;
          break;
        }
        case 33: {
          const c = i >>> 14 & 511;
          const fn = regs[a];
          const r = typeof fn === "function" ? fn(regs[a + 1], regs[a + 2]) : this.callArr(fn, [regs[a + 1], regs[a + 2]]);
          if (c === 1 && !Array.isArray(r)) regs[a + 3] = r;
          else {
            const vals = r === void 0 ? EMPTY : Array.isArray(r) ? r : [r];
            for (let j = 0; j < c; j++) regs[a + 3 + j] = j < vals.length ? vals[j] : void 0;
          }
          const first = regs[a + 3];
          if (first !== void 0) {
            regs[a + 2] = first;
            pc += (code[pc] >>> 14) - 131071 + 1;
          } else pc++;
          break;
        }
        case 34: {
          let n = i >>> 23;
          let c = i >>> 14 & 511;
          if (n === 0) n = f.top - a - 1;
          if (c === 0) c = code[pc++];
          const t = regs[a];
          const off = (c - 1) * 50;
          for (let j = 1; j <= n; j++) t.set(off + j, regs[a + j]);
          break;
        }
        case 35:
          if (f.openUps !== null) closeUps(f, a);
          break;
        case 36: {
          const p = proto.p[i >>> 14];
          const ups = new Array(p.nups);
          for (let j = 0; j < p.nups; j++) {
            const pi = code[pc++];
            if ((pi & 63) === 0) {
              const idx = pi >>> 23;
              let ou = f.openUps;
              if (ou === null) ou = f.openUps = [];
              let found;
              for (let q = 0; q < ou.length; q++) if (ou[q].idx === idx) {
                found = ou[q];
                break;
              }
              if (!found) {
                found = new UpVal(regs, idx);
                ou.push(found);
              }
              ups[j] = found;
            } else ups[j] = cl.upvals[pi >>> 23];
          }
          regs[a] = new LuaClosure(p, ups, cl.env);
          break;
        }
        case 37: {
          const b = i >>> 23;
          const va = f.varargs;
          if (b === 0) {
            for (let j = 0; j < va.length; j++) regs[a + j] = va[j];
            f.top = a + va.length;
          } else for (let j = 0; j < b - 1; j++) regs[a + j] = j < va.length ? va[j] : void 0;
          break;
        }
        default:
          throw new LuaError("bad opcode " + (i & 63));
      }
    }
  }
  /** the results of a native function called from the bytecode go to the registers (or the thread yields) */
  nativeResults(th, f, a, nres, r, pc) {
    if (r === YIELD) {
      if (th.nativeDepth > 0 || th === this.main) this.rt("attempt to yield across metamethod/C-call boundary");
      f.resumeA = a;
      f.resumeN = nres;
      f.pc = pc;
      return;
    }
    const regs = f.regs;
    if (nres === 1) regs[a] = r === void 0 ? void 0 : Array.isArray(r) ? r[0] : r;
    else if (nres === 0) {
    } else {
      const vals = r === void 0 ? EMPTY : Array.isArray(r) ? r : [r];
      if (nres < 0) {
        for (let j = 0; j < vals.length; j++) regs[a + j] = vals[j];
        f.top = a + vals.length;
      } else for (let j = 0; j < nres; j++) regs[a + j] = j < vals.length ? vals[j] : void 0;
    }
  }
  /** a frame returns: results go to the caller (a Lua frame or the native caller) */
  finishFrame(th, f, vals) {
    if (f.openUps !== null) closeUps(f, 0);
    th.frames.pop();
    if (f.boundary) return { done: true, vals };
    const caller = th.frames[th.frames.length - 1];
    let n = f.retN;
    const a = f.retA;
    const regs = caller.regs;
    if (n === 1) regs[a] = vals.length ? vals[0] : void 0;
    else if (n < 0) {
      for (let j = 0; j < vals.length; j++) regs[a + j] = vals[j];
      caller.top = a + vals.length;
    } else for (let j = 0; j < n; j++) regs[a + j] = j < vals.length ? vals[j] : void 0;
    return { done: false, f: caller };
  }
  // ------------------------------------------------------------------------------------------------------------------------------ loading chunks
  /** a closure of a precompiled function, with the global table as its environment */
  closureOf(p, env = this.globals) {
    const ups = [];
    for (let i = 0; i < p.nups; i++) ups.push(new UpVal(null, 0));
    return new LuaClosure(p, ups, env);
  }
};
function closeUps(f, level) {
  const ou = f.openUps;
  if (ou === null) return;
  let w = 0;
  for (let i = 0; i < ou.length; i++) {
    const u = ou[i];
    if (u.idx >= level) u.close();
    else ou[w++] = u;
  }
  ou.length = w;
  if (w === 0) f.openUps = null;
}
function closeFrame(f) {
  if (f.openUps !== null) closeUps(f, 0);
}
function chunkName(source) {
  if (source.startsWith("=")) return source.slice(1, 60);
  if (source.startsWith("@")) {
    const s = source.slice(1);
    return s.length <= 59 ? s : "..." + s.slice(s.length - 56);
  }
  const nl = source.indexOf(String.fromCharCode(10));
  let len = source.length;
  const room = 60 - 15;
  if (len < room && nl < 0) return `[string "${source}"]`;
  if (nl >= 0) len = nl;
  if (len > room) len = room;
  return `[string "${source.slice(0, len)}..."]`;
}
var ids = /* @__PURE__ */ new WeakMap();
var idCounter = 8192;
function idOf(o) {
  let v = ids.get(o);
  if (!v) {
    v = idCounter += 24;
    ids.set(o, v);
  }
  return v;
}

// src/lua/strlib.ts
var L_ESC = 37;
var MAXCAPTURES = 32;
var CAP_UNFINISHED = -1;
var CAP_POSITION = -2;
var MatchState = class {
  constructor(L2, src, pat) {
    this.L = L2;
    this.src = src;
    this.pat = pat;
  }
  L;
  src;
  pat;
  level = 0;
  capStart = [];
  capLen = [];
  depth = 0;
  err(msg) {
    throw new LuaError(this.L.where() + msg);
  }
};
function classEnd(ms, p) {
  const pat = ms.pat;
  if (p >= pat.length) ms.err("malformed pattern (ends with '%')");
  const c = pat.charCodeAt(p++);
  if (c === L_ESC) {
    if (p >= pat.length) ms.err("malformed pattern (ends with '%')");
    return p + 1;
  }
  if (c === 91) {
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
function isalpha(c) {
  return c >= 65 && c <= 90 || c >= 97 && c <= 122;
}
function isdigit(c) {
  return c >= 48 && c <= 57;
}
function islower(c) {
  return c >= 97 && c <= 122;
}
function isupper(c) {
  return c >= 65 && c <= 90;
}
function isspace(c) {
  return c === 32 || c >= 9 && c <= 13;
}
function iscntrl(c) {
  return c < 32 || c === 127;
}
function ispunct(c) {
  return c >= 33 && c <= 47 || c >= 58 && c <= 64 || c >= 91 && c <= 96 || c >= 123 && c <= 126;
}
function isalnum(c) {
  return isalpha(c) || isdigit(c);
}
function isxdigit(c) {
  return isdigit(c) || c >= 65 && c <= 70 || c >= 97 && c <= 102;
}
function matchClass(c, cl) {
  let res;
  const lower = cl | 32;
  switch (lower) {
    case 97:
      res = isalpha(c);
      break;
    // a
    case 99:
      res = iscntrl(c);
      break;
    // c
    case 100:
      res = isdigit(c);
      break;
    // d
    case 108:
      res = islower(c);
      break;
    // l
    case 112:
      res = ispunct(c);
      break;
    // p
    case 115:
      res = isspace(c);
      break;
    // s
    case 117:
      res = isupper(c);
      break;
    // u
    case 119:
      res = isalnum(c);
      break;
    // w
    case 120:
      res = isxdigit(c);
      break;
    // x
    case 122:
      res = c === 0;
      break;
    // z
    default:
      return cl === c;
  }
  if (isalpha(cl) && isupper(cl)) res = !res;
  return res;
}
function matchBracketClass(ms, c, p, ec) {
  const pat = ms.pat;
  let sig = true;
  if (pat.charCodeAt(p + 1) === 94) {
    sig = false;
    p++;
  }
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
function singleMatch(ms, s, p, ep) {
  if (s >= ms.src.length) return false;
  const c = ms.src.charCodeAt(s);
  const pc = ms.pat.charCodeAt(p);
  switch (pc) {
    case 46:
      return true;
    case L_ESC:
      return matchClass(c, ms.pat.charCodeAt(p + 1));
    case 91:
      return matchBracketClass(ms, c, p, ep - 1);
    default:
      return pc === c;
  }
}
function matchBalance(ms, s, p) {
  if (p + 1 >= ms.pat.length) ms.err("unbalanced pattern");
  if (s >= ms.src.length || ms.src.charCodeAt(s) !== ms.pat.charCodeAt(p)) return -1;
  const b = ms.pat.charCodeAt(p), e = ms.pat.charCodeAt(p + 1);
  let cont = 1;
  while (++s < ms.src.length) {
    const c = ms.src.charCodeAt(s);
    if (c === e) {
      if (--cont === 0) return s + 1;
    } else if (c === b) cont++;
  }
  return -1;
}
function maxExpand(ms, s, p, ep) {
  let i = 0;
  while (singleMatch(ms, s + i, p, ep)) i++;
  while (i >= 0) {
    const res = doMatch(ms, s + i, ep + 1);
    if (res !== -1) return res;
    i--;
  }
  return -1;
}
function minExpand(ms, s, p, ep) {
  for (; ; ) {
    const res = doMatch(ms, s, ep + 1);
    if (res !== -1) return res;
    if (singleMatch(ms, s, p, ep)) s++;
    else return -1;
  }
}
function startCapture(ms, s, p, what) {
  if (ms.level >= MAXCAPTURES) ms.err("too many captures");
  ms.capStart[ms.level] = s;
  ms.capLen[ms.level] = what;
  ms.level++;
  const res = doMatch(ms, s, p);
  if (res === -1) ms.level--;
  return res;
}
function endCapture(ms, s, p) {
  let l = -1;
  for (let level = ms.level - 1; level >= 0; level--) if (ms.capLen[level] === CAP_UNFINISHED) {
    l = level;
    break;
  }
  if (l < 0) ms.err("invalid pattern capture");
  ms.capLen[l] = s - ms.capStart[l];
  const res = doMatch(ms, s, p);
  if (res === -1) ms.capLen[l] = CAP_UNFINISHED;
  return res;
}
function checkCapture(ms, l) {
  l -= 49;
  if (l < 0 || l >= ms.level || ms.capLen[l] === CAP_UNFINISHED) ms.err("invalid capture index");
  return l;
}
function matchCapture(ms, s, l) {
  l = checkCapture(ms, l);
  const len = ms.capLen[l];
  if (ms.src.length - s >= len && ms.src.substr(ms.capStart[l], len) === ms.src.substr(s, len)) return s + len;
  return -1;
}
function doMatch(ms, s, p) {
  if (++ms.depth > 200) ms.err("pattern too complex");
  try {
    const pat = ms.pat;
    for (; ; ) {
      if (p >= pat.length) return s;
      const pc = pat.charCodeAt(p);
      switch (pc) {
        case 40:
          if (pat.charCodeAt(p + 1) === 41) return startCapture(ms, s, p + 2, CAP_POSITION);
          return startCapture(ms, s, p + 1, CAP_UNFINISHED);
        case 41:
          return endCapture(ms, s, p + 1);
        case 36:
          if (p + 1 === pat.length) return s === ms.src.length ? s : -1;
          break;
        case L_ESC: {
          const nc = pat.charCodeAt(p + 1);
          if (nc === 98) {
            s = matchBalance(ms, s, p + 2);
            if (s !== -1) {
              p += 4;
              continue;
            }
            return -1;
          }
          if (nc === 102) {
            p += 2;
            if (pat.charCodeAt(p) !== 91) ms.err("missing '[' after '%f' in pattern");
            const ep2 = classEnd(ms, p);
            const prev = s === 0 ? 0 : ms.src.charCodeAt(s - 1);
            const cur = s < ms.src.length ? ms.src.charCodeAt(s) : 0;
            if (!matchBracketClass(ms, prev, p, ep2 - 1) && matchBracketClass(ms, cur, p, ep2 - 1)) {
              p = ep2;
              continue;
            }
            return -1;
          }
          if (isdigit(nc)) {
            s = matchCapture(ms, s, nc);
            if (s !== -1) {
              p += 2;
              continue;
            }
            return -1;
          }
          break;
        }
        default:
          break;
      }
      const ep = classEnd(ms, p);
      const epc = ep < pat.length ? pat.charCodeAt(ep) : 0;
      if (!singleMatch(ms, s, p, ep)) {
        if (epc === 42 || epc === 63 || epc === 45) {
          p = ep + 1;
          continue;
        }
        return -1;
      }
      switch (epc) {
        case 63: {
          const res = doMatch(ms, s + 1, ep + 1);
          if (res !== -1) return res;
          p = ep + 1;
          continue;
        }
        case 43:
          return maxExpand(ms, s + 1, p, ep);
        // '+'
        case 42:
          return maxExpand(ms, s, p, ep);
        // '*'
        case 45:
          return minExpand(ms, s, p, ep);
        // '-'
        default:
          s++;
          p = ep;
          continue;
      }
    }
  } finally {
    ms.depth--;
  }
}
function getOneCapture(ms, i, s, e) {
  if (i >= ms.level) {
    if (i === 0) return ms.src.substring(s, e);
    ms.err("invalid capture index");
  }
  const l = ms.capLen[i];
  if (l === CAP_UNFINISHED) ms.err("unfinished capture");
  if (l === CAP_POSITION) return ms.capStart[i] + 1;
  return ms.src.substr(ms.capStart[i], l);
}
function pushCaptures(ms, s, e, wholeIfNone) {
  const n = ms.level === 0 && wholeIfNone ? 1 : ms.level;
  const out2 = [];
  for (let i = 0; i < n; i++) out2.push(getOneCapture(ms, i, s, e));
  return out2;
}
function checkStr(L2, v, n, fname) {
  if (typeof v === "string") return v;
  if (typeof v === "number") return numToStr(v);
  throw new LuaError(`${L2.where()}bad argument #${n} to '${fname}' (string expected, got ${v === void 0 ? "no value" : typeName(v)})`);
}
function checkNum(L2, v, n, fname) {
  const x = L2.tonumber(v);
  if (x === void 0) throw new LuaError(`${L2.where()}bad argument #${n} to '${fname}' (number expected, got ${v === void 0 ? "no value" : typeName(v)})`);
  return x;
}
function optNum(L2, v, n, fname, d) {
  return v === void 0 ? d : checkNum(L2, v, n, fname);
}
function typeName(v) {
  if (v === void 0) return "nil";
  if (typeof v === "boolean") return "boolean";
  if (typeof v === "number") return "number";
  if (typeof v === "string") return "string";
  if (v instanceof LuaTable) return "table";
  if (typeof v === "function" || v?.proto) return "function";
  return "userdata";
}
function posrelat(pos, len) {
  if (pos >= 0) return pos;
  if (-pos > len) return 0;
  return len + pos + 1;
}
function strFindAux(L2, find, s0, p0, init0, plain0) {
  const fname = find ? "find" : "match";
  const s = checkStr(L2, s0, 1, fname), p = checkStr(L2, p0, 2, fname);
  let init = posrelat(optNum(L2, init0, 3, fname, 1), s.length) - 1;
  if (init < 0) init = 0;
  else if (init > s.length) init = s.length;
  if (find && (plain0 !== void 0 && plain0 !== false || !/[\^$*+?.(\[%-]/.test(p))) {
    const idx = s.indexOf(p, init);
    if (idx < 0) return NIL1;
    return [idx + 1, idx + p.length];
  }
  const ms = new MatchState(L2, s, p);
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
function addValue(L2, ms, out2, s, e, repl) {
  let r;
  switch (typeof repl === "object" && repl instanceof LuaTable ? "table" : typeof repl) {
    case "number":
    case "string": {
      const rs = typeof repl === "number" ? numToStr(repl) : repl;
      let res = "";
      for (let i = 0; i < rs.length; i++) {
        const c = rs.charCodeAt(i);
        if (c !== L_ESC) {
          res += rs[i];
          continue;
        }
        i++;
        const d = rs.charCodeAt(i);
        if (!isdigit(d)) {
          res += rs[i];
          continue;
        }
        if (d === 48) res += ms.src.substring(s, e);
        else {
          const v = getOneCapture(ms, d - 49, s, e);
          res += typeof v === "number" ? numToStr(v) : v;
        }
      }
      out2.push(res);
      return;
    }
    case "table": {
      const cap = getOneCapture(ms, 0, s, e);
      r = L2.index(repl, cap);
      break;
    }
    default: {
      const caps = pushCaptures(ms, s, e, true);
      r = L2.call1(repl, ...caps);
      break;
    }
  }
  if (r === void 0 || r === false) out2.push(ms.src.substring(s, e));
  else if (typeof r === "string") out2.push(r);
  else if (typeof r === "number") out2.push(numToStr(r));
  else throw new LuaError(L2.where() + "invalid replacement value (a " + typeName(r) + ")");
}
function pad(s, width, left, zero) {
  if (s.length >= width) return s;
  if (left) return s + " ".repeat(width - s.length);
  if (zero) {
    const m = /^[-+ ]/.exec(s);
    const sign = m ? m[0] : "";
    return sign + "0".repeat(width - s.length) + s.slice(sign.length);
  }
  return " ".repeat(width - s.length) + s;
}
function format(L2, args) {
  const fmt = checkStr(L2, args[0], 1, "format");
  let out2 = "";
  let argn = 0;
  for (let i = 0; i < fmt.length; i++) {
    const c = fmt[i];
    if (c !== "%") {
      out2 += c;
      continue;
    }
    i++;
    if (fmt[i] === "%") {
      out2 += "%";
      continue;
    }
    let flags = "";
    while ("-+ #0".includes(fmt[i]) && i < fmt.length) flags += fmt[i++];
    let width = "";
    while (isdigit(fmt.charCodeAt(i))) width += fmt[i++];
    let prec = "";
    let hasPrec = false;
    if (fmt[i] === ".") {
      hasPrec = true;
      i++;
      while (isdigit(fmt.charCodeAt(i))) prec += fmt[i++];
    }
    const conv = fmt[i];
    argn++;
    const arg = args[argn];
    const w = width ? parseInt(width, 10) : 0;
    const pr = hasPrec ? prec ? parseInt(prec, 10) : 0 : -1;
    const left = flags.includes("-"), zero = flags.includes("0") && !left, plus = flags.includes("+"), space = flags.includes(" "), alt = flags.includes("#");
    const signed = (s, neg) => (neg ? "-" : plus ? "+" : space ? " " : "") + s;
    switch (conv) {
      case "c":
        out2 += pad(String.fromCharCode(checkNum(L2, arg, argn + 1, "format") & 255), w, left, false);
        break;
      case "d":
      case "i": {
        let n = Math.trunc(checkNum(L2, arg, argn + 1, "format"));
        let digits = String(Math.abs(n));
        if (pr >= 0) digits = digits.padStart(pr, "0");
        out2 += pad(signed(digits, n < 0), w, left, zero && pr < 0);
        break;
      }
      case "u": {
        const n = Math.trunc(checkNum(L2, arg, argn + 1, "format"));
        out2 += pad(String(n < 0 ? n + 4294967296 : n), w, left, zero);
        break;
      }
      case "o":
      case "x":
      case "X": {
        let n = Math.trunc(checkNum(L2, arg, argn + 1, "format"));
        if (n < 0) n += 4294967296;
        let s = n.toString(conv === "o" ? 8 : 16);
        if (conv === "X") s = s.toUpperCase();
        if (pr >= 0) s = s.padStart(pr, "0");
        if (alt && n !== 0) s = (conv === "o" ? "0" : conv === "x" ? "0x" : "0X") + s;
        out2 += pad(s, w, left, zero && pr < 0);
        break;
      }
      case "e":
      case "E":
      case "f":
      case "F":
      case "g":
      case "G": {
        const n = checkNum(L2, arg, argn + 1, "format");
        const p = pr < 0 ? 6 : pr;
        let s;
        const neg = n < 0 || n === 0 && 1 / n < 0;
        const a = Math.abs(n);
        if (!isFinite(a)) s = a !== a ? "nan" : "inf";
        else if (conv === "f" || conv === "F") s = a.toFixed(p);
        else if (conv === "e" || conv === "E") {
          const [m, e] = a.toExponential(p).split("e");
          s = m + "e" + (Number(e) < 0 ? "-" : "+") + String(Math.abs(Number(e))).padStart(2, "0");
        } else s = fmtG(a, p, alt);
        if (conv === "E" || conv === "G") s = s.toUpperCase();
        if (alt && p === 0 && (conv === "f" || conv === "e")) s = s.replace(/^(\d+)/, "$1.");
        out2 += pad(signed(s, neg), w, left, zero && isFinite(a));
        break;
      }
      case "s": {
        let s = checkStr(L2, arg, argn + 1, "format");
        if (pr >= 0) s = s.substring(0, pr);
        out2 += pad(s, w, left, false);
        break;
      }
      case "q": {
        const s = checkStr(L2, arg, argn + 1, "format");
        let r = '"';
        for (let j = 0; j < s.length; j++) {
          const ch = s[j];
          if (ch === '"' || ch === "\\" || ch === "\n") r += "\\" + ch;
          else if (ch === "\r") r += "\\r";
          else if (ch === "\0") r += "\\000";
          else r += ch;
        }
        out2 += r + '"';
        break;
      }
      default:
        throw new LuaError(L2.where() + `invalid option '%${conv ?? ""}' to 'format'`);
    }
  }
  return out2;
}
function installString(L2) {
  const S = new LuaTable();
  const reg = (name, fn) => {
    fn.luaName = name;
    S.set(name, fn);
  };
  reg("len", (s) => checkStr(L2, s, 1, "len").length);
  reg("sub", (s0, i0, j0) => {
    const s = checkStr(L2, s0, 1, "sub");
    const l = s.length;
    let i = posrelat(checkNum(L2, i0, 2, "sub"), l);
    let j = posrelat(optNum(L2, j0, 3, "sub", -1), l);
    if (i < 1) i = 1;
    if (j > l) j = l;
    return i <= j ? s.substring(i - 1, j) : "";
  });
  reg("upper", (s) => checkStr(L2, s, 1, "upper").replace(/[a-z]/g, (c) => c.toUpperCase()));
  reg("lower", (s) => checkStr(L2, s, 1, "lower").replace(/[A-Z]/g, (c) => c.toLowerCase()));
  reg("rep", (s, n) => {
    const str = checkStr(L2, s, 1, "rep");
    const k = checkNum(L2, n, 2, "rep");
    return k > 0 ? str.repeat(Math.floor(k)) : "";
  });
  reg("reverse", (s) => checkStr(L2, s, 1, "reverse").split("").reverse().join(""));
  reg("byte", (s0, i0, j0) => {
    const s = checkStr(L2, s0, 1, "byte");
    const l = s.length;
    const i = posrelat(optNum(L2, i0, 2, "byte", 1), l);
    let j = j0 === void 0 ? i : posrelat(checkNum(L2, j0, 3, "byte"), l);
    const lo = Math.max(i, 1), hi = Math.min(j, l);
    const out2 = [];
    for (let k = lo; k <= hi; k++) out2.push(s.charCodeAt(k - 1));
    return out2;
  });
  reg("char", (...a) => {
    let r = "";
    for (let i = 0; i < a.length; i++) {
      const c = checkNum(L2, a[i], i + 1, "char");
      if (c < 0 || c > 255) throw new LuaError(L2.where() + `bad argument #${i + 1} to 'char' (invalid value)`);
      r += String.fromCharCode(c);
    }
    return r;
  });
  reg("format", (...a) => format(L2, a));
  reg("find", (s, p, i, plain) => strFindAux(L2, true, s, p, i, plain));
  reg("match", (s, p, i) => strFindAux(L2, false, s, p, i, void 0));
  const gmatch = (s0, p0) => {
    const s = checkStr(L2, s0, 1, "gmatch"), p = checkStr(L2, p0, 2, "gmatch");
    let pos = 0;
    const it = () => {
      const ms = new MatchState(L2, s, p);
      for (let src = pos; src <= s.length; src++) {
        ms.level = 0;
        const e = doMatch(ms, src, 0);
        if (e !== -1) {
          pos = e === src ? e + 1 : e;
          return pushCaptures(ms, src, e, true);
        }
      }
      pos = s.length + 1;
      return void 0;
    };
    return it;
  };
  reg("gmatch", gmatch);
  reg("gfind", gmatch);
  reg("gsub", (s0, p0, repl, max0) => {
    const s = checkStr(L2, s0, 1, "gsub"), p = checkStr(L2, p0, 2, "gsub");
    const tr = typeof repl;
    if (!(tr === "number" || tr === "string" || tr === "function" || repl instanceof LuaTable || repl && repl.proto))
      throw new LuaError(L2.where() + "bad argument #3 to 'gsub' (string/function/table expected)");
    const anchor = p.charCodeAt(0) === 94;
    const pi = anchor ? 1 : 0;
    const max = max0 === void 0 ? s.length + 1 : checkNum(L2, max0, 4, "gsub");
    const ms = new MatchState(L2, s, p);
    const out2 = [];
    let n = 0, src = 0;
    while (n < max) {
      ms.level = 0;
      const e = doMatch(ms, src, pi);
      if (e !== -1) {
        n++;
        addValue(L2, ms, out2, src, e, repl);
      }
      if (e !== -1 && e > src) src = e;
      else if (src < s.length) out2.push(s[src++]);
      else break;
      if (anchor) break;
    }
    if (src < s.length) out2.push(s.substring(src));
    return [out2.join(""), n];
  });
  L2.globals.set("string", S);
  L2.loaded.set("string", S);
  const meta = new LuaTable();
  meta.set("__index", S);
  L2.stringMeta = meta;
}

// src/lua/undump.ts
var Reader = class {
  constructor(b, sizeInt, sizeT, little) {
    this.b = b;
    this.sizeInt = sizeInt;
    this.sizeT = sizeT;
    this.little = little;
  }
  b;
  sizeInt;
  sizeT;
  little;
  pos = 0;
  byte() {
    return this.b[this.pos++];
  }
  int() {
    let v = 0;
    if (this.little) for (let i = 0; i < this.sizeInt; i++) v |= this.b[this.pos + i] << 8 * i;
    else for (let i = 0; i < this.sizeInt; i++) v = v << 8 | this.b[this.pos + i];
    this.pos += this.sizeInt;
    return v;
  }
  sizeT_() {
    let v = 0;
    if (this.little) for (let i = this.sizeT - 1; i >= 0; i--) v = v * 256 + this.b[this.pos + i];
    else for (let i = 0; i < this.sizeT; i++) v = v * 256 + this.b[this.pos + i];
    this.pos += this.sizeT;
    return v;
  }
  num() {
    const dv = new DataView(this.b.buffer, this.b.byteOffset + this.pos, 8);
    this.pos += 8;
    return dv.getFloat64(0, this.little);
  }
  str() {
    const n = this.sizeT_();
    if (n === 0) return void 0;
    let s = "";
    for (let i = 0; i < n - 1; i++) s += String.fromCharCode(this.b[this.pos + i]);
    this.pos += n;
    return s;
  }
};
function func(r, parentSource) {
  const f = new Proto();
  f.source = r.str() ?? parentSource;
  f.lineDefined = r.int();
  f.lastLine = r.int();
  f.nups = r.byte();
  f.numparams = r.byte();
  f.isVararg = r.byte();
  f.maxstack = r.byte();
  const n = r.int();
  f.code = new Int32Array(n);
  for (let i = 0; i < n; i++) f.code[i] = r.little ? r.b[r.pos] | r.b[r.pos + 1] << 8 | r.b[r.pos + 2] << 16 | r.b[r.pos + 3] << 24 : r.b[r.pos] << 24 | r.b[r.pos + 1] << 16 | r.b[r.pos + 2] << 8 | r.b[r.pos + 3], r.pos += 4;
  const nk = r.int();
  f.k = new Array(nk);
  for (let i = 0; i < nk; i++) {
    const t = r.byte();
    switch (t) {
      case 0:
        f.k[i] = void 0;
        break;
      case 1:
        f.k[i] = r.byte() !== 0;
        break;
      case 3:
        f.k[i] = r.num();
        break;
      case 4:
        f.k[i] = r.str() ?? "";
        break;
      default:
        throw new LuaError("bad constant type in precompiled chunk");
    }
  }
  const np = r.int();
  f.p = new Array(np);
  for (let i = 0; i < np; i++) f.p[i] = func(r, f.source);
  const nl = r.int();
  f.lineinfo = new Int32Array(nl);
  for (let i = 0; i < nl; i++) f.lineinfo[i] = r.int();
  const nv = r.int();
  for (let i = 0; i < nv; i++) f.locvars.push({ name: r.str() ?? "", startpc: r.int(), endpc: r.int() });
  const nu = r.int();
  for (let i = 0; i < nu; i++) f.upvalueNames.push(r.str() ?? "");
  return f;
}
function isBytecode(bytes) {
  return bytes.length > 4 && bytes[0] === 27 && bytes[1] === 76 && bytes[2] === 117 && bytes[3] === 97;
}
function undump(bytes) {
  if (!isBytecode(bytes)) throw new LuaError("bad binary format (not a precompiled chunk)");
  if (bytes[4] !== 81) throw new LuaError("bad binary format (version mismatch)");
  const little = bytes[6] === 1, sizeInt = bytes[7], sizeT = bytes[8];
  if (bytes[9] !== 4 || bytes[10] !== 8) throw new LuaError("bad binary format (unsupported sizes)");
  const r = new Reader(bytes, sizeInt, sizeT, little);
  r.pos = 12;
  return func(r, "=?");
}

// src/lua/lib.ts
function argErr(L2, n, fname, msg) {
  throw new LuaError(`${L2.where()}bad argument #${n} to '${fname}' (${msg})`);
}
function checkTable(L2, v, n, fname) {
  if (v instanceof LuaTable) return v;
  return argErr(L2, n, fname, `table expected, got ${v === void 0 ? "no value" : typeName(v)}`);
}
var isFalse = (v) => v === void 0 || v === false;
var GlibcRand = class {
  r = [];
  i = 0;
  constructor(seed) {
    this.seed(seed);
  }
  seed(seed) {
    seed = seed >>> 0;
    if (seed === 0) seed = 1;
    const r = new Array(34);
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
    for (let k = 0; k < 310; k++) this.next();
  }
  next() {
    const a = this.r;
    const n = a.length;
    const v = a[n - 31] + a[n - 3] | 0;
    a.push(v);
    if (a.length > 4096) a.splice(0, a.length - 64);
    return v >>> 1;
  }
};
function openLibs(L2, host2) {
  const G = L2.globals;
  const def = (t, name, fn) => {
    fn.luaName = name;
    t.set(name, fn);
  };
  const lib = (name) => {
    const t = new LuaTable();
    G.set(name, t);
    L2.loaded.set(name, t);
    return t;
  };
  const callable = (v) => typeof v === "function" || v instanceof LuaClosure;
  def(G, "print", (...a) => {
    host2.print(a.map((v) => L2.tostring(v)).join("	"));
  });
  def(G, "type", (...a) => {
    if (a.length === 0) argErr(L2, 1, "type", "value expected");
    return type(a[0]);
  });
  def(G, "tostring", (v) => L2.tostring(v));
  def(G, "tonumber", (v, base) => {
    if (base === void 0 || base === 10 && typeof v !== "string") return L2.tonumber(v) ?? NIL1;
    const b = checkNum(L2, base, 2, "tonumber");
    const s = checkStr(L2, v, 1, "tonumber").trim().toLowerCase();
    if (!/^-?[0-9a-z]+$/.test(s)) return NIL1;
    const neg = s[0] === "-";
    let n = 0;
    for (const ch of neg ? s.slice(1) : s) {
      const d2 = parseInt(ch, 36);
      if (isNaN(d2) || d2 >= b) return NIL1;
      n = n * b + d2;
    }
    return neg ? -n : n;
  });
  def(G, "assert", (...a) => {
    if (isFalse(a[0])) throw new LuaError(a.length > 1 && a[1] !== void 0 ? a[1] : L2.where() + "assertion failed!");
    return a;
  });
  def(G, "error", (msg, level) => {
    const lv = level === void 0 ? 1 : level;
    if (typeof msg === "string" && lv > 0) throw new LuaError(L2.where(lv) + msg, L2.traceback());
    throw new LuaError(msg, L2.traceback());
  });
  def(G, "pcall", (f, ...args) => {
    if (f === void 0 && args.length === 0) argErr(L2, 1, "pcall", "value expected");
    const r = L2.pcall(f, args);
    return r.ok ? [true, ...r.r] : [false, r.err];
  });
  def(G, "xpcall", (f, handler) => {
    const r = L2.pcall(f, []);
    if (r.ok) return [true, ...r.r];
    return [false, ...L2.callArr(handler, [r.err])];
  });
  def(G, "select", (n, ...a) => {
    if (n === "#") return a.length;
    const i = checkNum(L2, n, 1, "select");
    if (i < 0) {
      const k = a.length + i;
      if (k < 0) argErr(L2, 1, "select", "index out of range");
      return a.slice(k);
    }
    if (i === 0) argErr(L2, 1, "select", "index out of range");
    return a.slice(i - 1);
  });
  const unpack = (t, i, j) => {
    checkTable(L2, t, 1, "unpack");
    const a = optNum(L2, i, 2, "unpack", 1);
    const b = j === void 0 ? t.length() : checkNum(L2, j, 3, "unpack");
    const out2 = [];
    for (let k = a; k <= b; k++) out2.push(t.get(k));
    return out2;
  };
  def(G, "unpack", unpack);
  def(G, "next", (t, k) => {
    checkTable(L2, t, 1, "next");
    const r = t.next(k);
    return r === void 0 ? NIL1 : r;
  });
  const nextFn = G.get("next");
  def(G, "pairs", (t) => {
    checkTable(L2, t, 1, "pairs");
    return [nextFn, t, void 0];
  });
  const ipairsIter = (t, i) => {
    const n = i + 1;
    const v = t instanceof LuaTable && t.meta === null ? t.get(n) : L2.index(t, n);
    return v === void 0 ? void 0 : [n, v];
  };
  def(G, "ipairs", (t) => {
    checkTable(L2, t, 1, "ipairs");
    return [ipairsIter, t, 0];
  });
  def(G, "rawget", (t, k) => checkTable(L2, t, 1, "rawget").get(k) ?? NIL1);
  def(G, "rawset", (t, k, v) => {
    L2.rawsetChecked(checkTable(L2, t, 1, "rawset"), k, v);
    return t;
  });
  def(G, "rawequal", (a, b) => a === b);
  def(G, "getmetatable", (v) => {
    const m = L2.getmeta(v);
    if (m === null) return NIL1;
    const p = m.getStr("__metatable");
    return p !== void 0 ? p : m;
  });
  def(G, "setmetatable", (t, m) => {
    checkTable(L2, t, 1, "setmetatable");
    if (m !== void 0 && !(m instanceof LuaTable)) argErr(L2, 2, "setmetatable", "nil or table expected");
    if (t.meta?.getStr("__metatable") !== void 0) throw new LuaError(L2.where() + "cannot change a protected metatable");
    t.meta = m === void 0 ? null : m;
    return t;
  });
  def(G, "collectgarbage", (opt) => {
    if (opt === "count") return [8192 + Math.random() * 0, 0];
    return 0;
  });
  def(G, "gcinfo", () => 8192);
  const frameOf = (f, fname) => {
    if (typeof f === "number") {
      const frames = L2.cur.frames;
      if (f === 0) return L2.globals;
      const fr = frames[frames.length - f];
      if (!fr) argErr(L2, 1, fname, "invalid level");
      return fr.cl;
    }
    return f;
  };
  def(G, "getfenv", (f) => {
    if (f === void 0) f = 1;
    if (f === 0) return G;
    const c = frameOf(f, "getfenv");
    return c instanceof LuaClosure ? c.env : G;
  });
  def(G, "setfenv", (f, t) => {
    checkTable(L2, t, 2, "setfenv");
    const c = frameOf(f, "setfenv");
    if (c instanceof LuaClosure) c.env = t;
    else throw new LuaError(L2.where() + "'setfenv' cannot change environment of given object");
    return c;
  });
  const loadChunk = (data, name) => {
    if (isBytecode(Uint8Array.from(data.slice(0, 5), (c) => c.charCodeAt(0)))) {
      const bytes = new Uint8Array(data.length);
      for (let i = 0; i < data.length; i++) bytes[i] = data.charCodeAt(i);
      return L2.closureOf(undump(bytes));
    }
    if (!host2.compile) throw new LuaError("no compiler for text chunks");
    return host2.compile(data, name);
  };
  def(G, "loadstring", (s, name) => {
    const str = checkStr(L2, s, 1, "loadstring");
    try {
      return loadChunk(str, name ?? str);
    } catch (e) {
      if (e instanceof LuaError) return [void 0, e.value];
      throw e;
    }
  });
  def(G, "load", (f, name) => {
    let src = "";
    if (typeof f === "string") src = f;
    else for (; ; ) {
      const p = L2.call1(f);
      if (p === void 0 || p === "") break;
      src += p;
    }
    try {
      return loadChunk(src, name ?? "=(load)");
    } catch (e) {
      if (e instanceof LuaError) return [void 0, e.value];
      throw e;
    }
  });
  def(G, "loadfile", (fname) => {
    const data = host2.readFile(fname);
    if (data === void 0) return [void 0, `cannot open ${fname}`];
    try {
      return loadChunk(data, "@" + fname);
    } catch (e) {
      if (e instanceof LuaError) return [void 0, e.value];
      throw e;
    }
  });
  def(G, "dofile", (fname) => {
    const data = host2.readFile(fname);
    if (data === void 0) throw new LuaError(`cannot open ${fname}`);
    return L2.callArr(loadChunk(data, "@" + fname), []);
  });
  const co = lib("coroutine");
  def(co, "create", (f) => {
    if (!callable(f)) argErr(L2, 1, "create", "Lua function expected");
    return L2.newThread(f);
  });
  def(co, "resume", (th, ...a) => {
    if (!(th && th.isThread)) argErr(L2, 1, "resume", "coroutine expected");
    return L2.resume(th, a);
  });
  def(co, "yield", (...a) => {
    L2.cur.yielded = a;
    return YIELD;
  });
  def(co, "status", (th) => th.status);
  def(co, "running", () => L2.cur === L2.main ? void 0 : L2.cur);
  def(co, "wrap", (f) => {
    const th = L2.newThread(f);
    return ((...a) => {
      const r = L2.resume(th, a);
      if (r[0] === true) return r.slice(1);
      const e = r[1];
      throw new LuaError(typeof e === "string" && !/^[^\n]*:\d+:/.test(e) ? L2.where() + e : e);
    });
  });
  const T = lib("table");
  T.set("insert", ((...args) => {
    const t = checkTable(L2, args[0], 1, "insert");
    const e = t.length() + 1;
    if (args.length === 2) {
      L2.rawsetChecked(t, e, args[1]);
      return;
    }
    if (args.length !== 3) throw new LuaError(L2.where() + "wrong number of arguments to 'insert'");
    const pos = checkNum(L2, args[1], 2, "insert");
    for (let i = e; i > pos; i--) t.set(i, t.get(i - 1));
    L2.rawsetChecked(t, pos, args[2]);
  }));
  def(T, "remove", (t, p) => {
    checkTable(L2, t, 1, "remove");
    const e = t.length();
    const pos = p === void 0 ? e : checkNum(L2, p, 2, "remove");
    if (e === 0) return void 0;
    if (pos < 1 || pos > e + 1) return void 0;
    const v = t.get(pos);
    for (let i = pos; i < e; i++) t.set(i, t.get(i + 1));
    t.set(e, void 0);
    return v;
  });
  def(T, "concat", (t, sep0, i0, j0) => {
    checkTable(L2, t, 1, "concat");
    const sep = sep0 === void 0 ? "" : checkStr(L2, sep0, 2, "concat");
    const i = optNum(L2, i0, 3, "concat", 1);
    const j = j0 === void 0 ? t.length() : checkNum(L2, j0, 4, "concat");
    const parts = [];
    for (let k = i; k <= j; k++) {
      const v = t.get(k);
      if (typeof v === "string") parts.push(v);
      else if (typeof v === "number") parts.push(numToStr(v));
      else throw new LuaError(L2.where() + `invalid value (at index ${k}) in table for 'concat'`);
    }
    return parts.join(sep);
  });
  def(T, "getn", (t) => checkTable(L2, t, 1, "getn").length());
  def(T, "maxn", (t) => {
    checkTable(L2, t, 1, "maxn");
    let m = 0;
    for (let n = t.next(void 0); n !== void 0; n = t.next(n[0])) if (typeof n[0] === "number" && n[0] > m) m = n[0];
    return m;
  });
  def(T, "foreach", (t, f) => {
    for (let n = t.next(void 0); n !== void 0; n = t.next(n[0])) {
      const r = L2.call1(f, n[0], n[1]);
      if (r !== void 0) return r;
    }
  });
  def(T, "foreachi", (t, f) => {
    const n = t.length();
    for (let i = 1; i <= n; i++) {
      const r = L2.call1(f, i, t.get(i));
      if (r !== void 0) return r;
    }
  });
  def(T, "setn", () => {
    throw new LuaError("'setn' is obsolete");
  });
  def(T, "sort", (t, comp) => {
    checkTable(L2, t, 1, "sort");
    const n = t.length();
    if (comp !== void 0 && !callable(comp)) argErr(L2, 2, "sort", "function expected");
    const lt = (a, b) => {
      if (comp !== void 0) {
        const r = L2.call1(comp, a, b);
        return r !== void 0 && r !== false;
      }
      return L2.lt(a, b);
    };
    const geti = (i) => t.get(i);
    const seti = (i, v) => t.set(i, v);
    const auxsort = (l, u) => {
      while (l < u) {
        let a = geti(l), b = geti(u);
        if (lt(b, a)) {
          seti(l, b);
          seti(u, a);
        }
        if (u - l === 1) break;
        const i0 = Math.floor((l + u) / 2);
        a = geti(i0);
        b = geti(l);
        if (lt(a, b)) {
          seti(i0, b);
          seti(l, a);
        } else {
          b = geti(u);
          if (lt(b, a)) {
            seti(i0, b);
            seti(u, a);
          }
        }
        if (u - l === 2) break;
        const P2 = geti(i0);
        b = geti(u - 1);
        seti(i0, b);
        seti(u - 1, P2);
        let i = l, j = u - 1;
        for (; ; ) {
          while (lt(geti(++i), P2)) {
            if (i > u) throw new LuaError(L2.where() + "invalid order function for sorting");
          }
          while (lt(P2, geti(--j))) {
            if (j < l) throw new LuaError(L2.where() + "invalid order function for sorting");
          }
          if (j < i) break;
          const x2 = geti(i), y2 = geti(j);
          seti(i, y2);
          seti(j, x2);
        }
        const x = geti(u - 1), y = geti(i);
        seti(u - 1, y);
        seti(i, x);
        let ii, jj;
        if (i - l < u - i) {
          jj = l;
          ii = i - 1;
          l = i + 1;
        } else {
          jj = i + 1;
          ii = u;
          u = i - 1;
        }
        auxsort(jj, ii);
      }
    };
    auxsort(1, n);
  });
  const M = lib("math");
  const m1 = (name, f) => def(M, name, (x) => f(checkNum(L2, x, 1, name)));
  m1("abs", Math.abs);
  m1("ceil", Math.ceil);
  m1("floor", Math.floor);
  m1("sqrt", Math.sqrt);
  m1("sin", Math.sin);
  m1("cos", Math.cos);
  m1("tan", Math.tan);
  m1("asin", Math.asin);
  m1("acos", Math.acos);
  m1("atan", Math.atan);
  m1("sinh", Math.sinh);
  m1("cosh", Math.cosh);
  m1("tanh", Math.tanh);
  m1("exp", Math.exp);
  m1("log", Math.log);
  m1("log10", Math.log10);
  m1("deg", (x) => x * (180 / Math.PI));
  m1("rad", (x) => x * (Math.PI / 180));
  def(M, "atan2", (y, x) => Math.atan2(checkNum(L2, y, 1, "atan2"), checkNum(L2, x, 2, "atan2")));
  def(M, "pow", (x, y) => Math.pow(checkNum(L2, x, 1, "pow"), checkNum(L2, y, 2, "pow")));
  def(M, "fmod", (x, y) => checkNum(L2, x, 1, "fmod") % checkNum(L2, y, 2, "fmod"));
  def(M, "modf", (x) => {
    const n = checkNum(L2, x, 1, "modf");
    const ip = n >= 0 ? Math.floor(n) : Math.ceil(n);
    return [ip, isFinite(n) ? n - ip : 0];
  });
  def(M, "frexp", (x) => {
    let n = checkNum(L2, x, 1, "frexp");
    if (n === 0 || !isFinite(n)) return [n, 0];
    let e = Math.max(-1023, Math.floor(Math.log2(Math.abs(n))) + 1);
    let m = n * Math.pow(2, -e);
    while (Math.abs(m) < 0.5) {
      m *= 2;
      e--;
    }
    while (Math.abs(m) >= 1) {
      m /= 2;
      e++;
    }
    return [m, e];
  });
  def(M, "ldexp", (m, e) => checkNum(L2, m, 1, "ldexp") * Math.pow(2, checkNum(L2, e, 2, "ldexp")));
  def(M, "min", (...a) => {
    let r = checkNum(L2, a[0], 1, "min");
    for (let i = 1; i < a.length; i++) {
      const v = checkNum(L2, a[i], i + 1, "min");
      if (v < r) r = v;
    }
    return r;
  });
  def(M, "max", (...a) => {
    let r = checkNum(L2, a[0], 1, "max");
    for (let i = 1; i < a.length; i++) {
      const v = checkNum(L2, a[i], i + 1, "max");
      if (v > r) r = v;
    }
    return r;
  });
  M.set("pi", Math.PI);
  M.set("huge", Infinity);
  let rng = new GlibcRand(1);
  const RAND_MAX = 2147483647;
  const rand = () => rng.next() % RAND_MAX / RAND_MAX;
  def(M, "random", (m, n) => {
    const r = rand();
    if (m === void 0) return r;
    const lo = n === void 0 ? 1 : checkNum(L2, m, 1, "random");
    const up = n === void 0 ? checkNum(L2, m, 1, "random") : checkNum(L2, n, 2, "random");
    if (lo > up) argErr(L2, n === void 0 ? 1 : 2, "random", "interval is empty");
    return Math.floor(r * (up - lo + 1)) + lo;
  });
  def(M, "randomseed", (s) => {
    rng = new GlibcRand(Math.floor(checkNum(L2, s, 1, "randomseed")));
  });
  const O = lib("os");
  const t0 = Date.now();
  def(O, "time", (t) => {
    if (t instanceof LuaTable) {
      const g = (k, d2) => {
        const v = t.get(k);
        if (v === void 0) {
          if (d2 === void 0) throw new LuaError(L2.where() + `field '${k}' missing in date table`);
          return d2;
        }
        return Number(v);
      };
      return Math.floor(new Date(g("year"), g("month") - 1, g("day"), g("hour", 12), g("min", 0), g("sec", 0)).getTime() / 1e3);
    }
    return Math.floor(Date.now() / 1e3);
  });
  def(O, "clock", () => (Date.now() - t0) / 1e3);
  def(O, "difftime", (a, b) => checkNum(L2, a, 1, "difftime") - optNum(L2, b, 2, "difftime", 0));
  def(O, "getenv", () => NIL1);
  def(O, "remove", (f) => host2.removeFile(checkStr(L2, f, 1, "remove")) ? true : [void 0, `${f}: No such file or directory`, 2]);
  def(O, "rename", (a, b) => {
    const d2 = host2.readFile(a);
    if (d2 === void 0) return [void 0, `${a}: No such file or directory`, 2];
    host2.writeFile(b, d2);
    host2.removeFile(a);
    return true;
  });
  def(O, "tmpname", () => "/tmp/lua_" + Math.floor(Math.random() * 1e9).toString(36));
  def(O, "exit", () => {
    throw new LuaError("os.exit");
  });
  def(O, "setlocale", () => "C");
  def(O, "date", (fmt0, time0) => {
    let fmt = fmt0 === void 0 ? "%c" : checkStr(L2, fmt0, 1, "date");
    let d2 = new Date((time0 === void 0 ? Date.now() / 1e3 : checkNum(L2, time0, 2, "date")) * 1e3);
    let utc = false;
    if (fmt.startsWith("!")) {
      utc = true;
      fmt = fmt.slice(1);
    }
    const g = {
      Y: utc ? d2.getUTCFullYear() : d2.getFullYear(),
      m: (utc ? d2.getUTCMonth() : d2.getMonth()) + 1,
      d: utc ? d2.getUTCDate() : d2.getDate(),
      H: utc ? d2.getUTCHours() : d2.getHours(),
      M: utc ? d2.getUTCMinutes() : d2.getMinutes(),
      S: utc ? d2.getUTCSeconds() : d2.getSeconds(),
      w: utc ? d2.getUTCDay() : d2.getDay()
    };
    if (fmt.startsWith("*t")) {
      const t = new LuaTable();
      t.set("year", g.Y);
      t.set("month", g.m);
      t.set("day", g.d);
      t.set("hour", g.H);
      t.set("min", g.M);
      t.set("sec", g.S);
      t.set("wday", g.w + 1);
      const jan1 = new Date(g.Y, 0, 1);
      t.set("yday", Math.floor((new Date(g.Y, g.m - 1, g.d).getTime() - jan1.getTime()) / 864e5) + 1);
      t.set("isdst", false);
      return t;
    }
    const p2 = (n) => String(n).padStart(2, "0");
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    return fmt.replace(/%(.)/g, (_m, c) => {
      switch (c) {
        case "Y":
          return String(g.Y);
        case "y":
          return p2(g.Y % 100);
        case "m":
          return p2(g.m);
        case "d":
          return p2(g.d);
        case "H":
          return p2(g.H);
        case "M":
          return p2(g.M);
        case "S":
          return p2(g.S);
        case "p":
          return g.H < 12 ? "AM" : "PM";
        case "I":
          return p2(g.H % 12 || 12);
        case "A":
          return days[g.w];
        case "a":
          return days[g.w].slice(0, 3);
        case "B":
          return months[g.m - 1];
        case "b":
          return months[g.m - 1].slice(0, 3);
        case "j":
          return String(Math.floor((new Date(g.Y, g.m - 1, g.d).getTime() - new Date(g.Y, 0, 1).getTime()) / 864e5) + 1).padStart(3, "0");
        case "c":
          return `${days[g.w].slice(0, 3)} ${months[g.m - 1].slice(0, 3)} ${String(g.d).padStart(2, " ")} ${p2(g.H)}:${p2(g.M)}:${p2(g.S)} ${g.Y}`;
        case "x":
          return `${p2(g.m)}/${p2(g.d)}/${p2(g.Y % 100)}`;
        case "X":
          return `${p2(g.H)}:${p2(g.M)}:${p2(g.S)}`;
        case "%":
          return "%";
        default:
          return "%" + c;
      }
    });
  });
  const IO = lib("io");
  class LFile extends Userdata {
    constructor(path, data, mode) {
      super();
      this.path = path;
      this.data = data;
      this.mode = mode;
    }
    path;
    data;
    mode;
    pos = 0;
    closed = false;
    dirty = false;
    lget(key) {
      return fileMethods.get(key);
    }
    lset() {
    }
    tostring() {
      return this.closed ? "file (closed)" : "file (0x" + (16384 + this.path.length).toString(16) + ")";
    }
  }
  const fileMethods = new LuaTable();
  const fdef = (name, fn) => def(fileMethods, name, fn);
  const flush = (f) => {
    if (f.dirty && f.mode !== "r") {
      host2.writeFile(f.path, f.data);
      f.dirty = false;
    }
  };
  fdef("write", (f, ...a) => {
    if (f.mode === "r") return [void 0, "Bad file descriptor", 9];
    for (const v of a) {
      const s = typeof v === "number" ? numToStr(v) : checkStr(L2, v, 2, "write");
      if (f.mode.startsWith("a")) f.pos = f.data.length;
      f.data = f.data.slice(0, f.pos) + s + f.data.slice(f.pos + s.length);
      f.pos += s.length;
      f.dirty = true;
    }
    return f;
  });
  fdef("close", (f) => {
    flush(f);
    f.closed = true;
    return true;
  });
  fdef("flush", (f) => {
    flush(f);
    return f;
  });
  fdef("seek", (f, whence, off) => {
    const o = optNum(L2, off, 3, "seek", 0);
    f.pos = whence === "set" ? o : whence === "end" ? f.data.length + o : f.pos + o;
    return f.pos;
  });
  const readOne = (f, fmt) => {
    if (typeof fmt === "number") {
      if (f.pos >= f.data.length) return void 0;
      const r = f.data.substr(f.pos, fmt);
      f.pos += r.length;
      return r;
    }
    const s = typeof fmt === "string" ? fmt.replace(/^\*/, "") : "l";
    if (s[0] === "a") {
      const r = f.data.slice(f.pos);
      f.pos = f.data.length;
      return r;
    }
    if (s[0] === "n") {
      const m = /^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(f.data.slice(f.pos));
      if (!m) return void 0;
      f.pos += m[0].length;
      return Number(m[0]);
    }
    if (f.pos >= f.data.length) return void 0;
    let e = f.data.indexOf("\n", f.pos);
    let line;
    if (e < 0) {
      line = f.data.slice(f.pos);
      f.pos = f.data.length;
    } else {
      line = f.data.slice(f.pos, s[0] === "L" ? e + 1 : e);
      f.pos = e + 1;
    }
    return line;
  };
  fdef("read", (f, ...fmts) => fmts.length === 0 ? readOne(f, "l") : fmts.map((x) => readOne(f, x)));
  fdef("lines", (f) => (() => readOne(f, "l")));
  fileMethods.set("__index", fileMethods);
  const openFile = (path, mode) => {
    const m = mode.replace("b", "");
    if (m.startsWith("r")) {
      const d2 = host2.readFile(path);
      if (d2 === void 0) return [void 0, `${path}: No such file or directory`, 2];
      return new LFile(path, d2, m);
    }
    if (m.startsWith("a")) {
      const f2 = new LFile(path, host2.readFile(path) ?? "", m);
      f2.pos = f2.data.length;
      f2.dirty = true;
      flush(f2);
      return f2;
    }
    const f = new LFile(path, "", m);
    f.dirty = true;
    flush(f);
    return f;
  };
  def(IO, "open", (path, mode) => openFile(checkStr(L2, path, 1, "open"), mode === void 0 ? "r" : checkStr(L2, mode, 2, "open")));
  def(IO, "close", (f) => {
    if (f instanceof LFile) {
      flush(f);
      f.closed = true;
    }
    return true;
  });
  def(IO, "write", (...a) => {
    const t = a.map((v) => typeof v === "number" ? numToStr(v) : String(v)).join("");
    if (host2.write) host2.write(t);
    else host2.print(t);
  });
  def(IO, "read", () => void 0);
  def(IO, "lines", (path) => {
    const f = openFile(path, "r");
    if (!(f instanceof LFile)) throw new LuaError(L2.where() + `${path}: No such file or directory`);
    return (() => readOne(f, "l"));
  });
  def(IO, "type", (f) => f instanceof LFile ? f.closed ? "closed file" : "file" : void 0);
  installString(L2);
  const P = lib("package");
  P.set("path", "./?.lua");
  P.set("cpath", "");
  P.set("loaded", L2.loaded);
  P.set("preload", new LuaTable());
  L2.loaded.set("_G", G);
  def(P, "seeall", (m) => {
    let mt = m.meta;
    if (mt === null) {
      mt = new LuaTable();
      m.meta = mt;
    }
    mt.set("__index", G);
  });
  def(G, "module", (name, ...opts) => {
    const n = checkStr(L2, name, 1, "module");
    let t = L2.loaded.get(n);
    if (!(t instanceof LuaTable)) {
      let cur = G;
      const parts = n.split(".");
      for (let i = 0; i < parts.length; i++) {
        let nx = cur.get(parts[i]);
        if (!(nx instanceof LuaTable)) {
          nx = new LuaTable();
          cur.set(parts[i], nx);
        }
        cur = nx;
      }
      t = cur;
      L2.loaded.set(n, t);
    }
    if (t.get("_NAME") === void 0) {
      t.set("_M", t);
      t.set("_NAME", n);
      const dot = n.lastIndexOf(".");
      t.set("_PACKAGE", dot < 0 ? "" : n.slice(0, dot + 1));
    }
    const fr = L2.cur.frames[L2.cur.frames.length - 1];
    if (fr) fr.cl.env = t;
    for (const o of opts) if (callable(o)) L2.callArr(o, [t]);
    return void 0;
  });
  def(G, "require", (name) => {
    const n = checkStr(L2, name, 1, "require");
    const loaded = L2.loaded.get(n);
    if (loaded !== void 0) return loaded;
    const pre = P.get("preload").get(n);
    let loader = pre;
    const tried = [];
    if (loader === void 0) {
      const fname = n.replace(/\./g, "/");
      for (const tpl of String(P.get("path")).split(";")) {
        if (!tpl) continue;
        const path = tpl.replace(/\?/g, fname);
        const data = host2.readFile(path);
        if (data !== void 0) {
          try {
            loader = loadChunk(data, "@" + path);
          } catch (e) {
            if (e instanceof LuaError) throw new LuaError(`error loading module '${n}' from file '${path}':
	${e.value}`);
            throw e;
          }
          break;
        }
        tried.push(`
	no file '${path}'`);
      }
    }
    if (loader === void 0) throw new LuaError(L2.where() + `module '${n}' not found:
	no field package.preload['${n}']${tried.join("")}`);
    const r = L2.call1(loader, n);
    if (r !== void 0) L2.loaded.set(n, r);
    if (L2.loaded.get(n) === void 0) L2.loaded.set(n, true);
    return L2.loaded.get(n);
  });
  G.set("_VERSION", "Lua 5.1");
  G.set("table", T);
  def(G, "newproxy", () => new LuaTable());
  const d = lib("debug");
  def(d, "traceback", (msg) => (msg === void 0 ? "" : String(msg)) + "\nstack traceback:\n" + L2.traceback());
  def(d, "getinfo", (f) => {
    const t = new LuaTable();
    t.set("currentline", 0);
    t.set("source", "=?");
    t.set("short_src", "?");
    t.set("what", "Lua");
    void f;
    return t;
  });
  def(d, "sethook", () => void 0);
  def(d, "gethook", () => void 0);
  def(d, "getmetatable", (v) => L2.getmeta(v) ?? void 0);
  def(d, "setmetatable", (v, m) => {
    if (v instanceof LuaTable) v.meta = m ?? null;
    return v;
  });
  def(d, "getlocal", () => void 0);
  def(d, "getupvalue", () => void 0);
}

// src/lua/compile.ts
var KEYWORDS = /* @__PURE__ */ new Set(["and", "break", "do", "else", "elseif", "end", "false", "for", "function", "if", "in", "local", "nil", "not", "or", "repeat", "return", "then", "true", "until", "while"]);
function lex(src, chunk) {
  const toks = [];
  let i = 0, line = 1;
  const err = (m) => {
    throw new LuaError(`${chunk}:${line}: ${m}`);
  };
  const n = src.length;
  const longBracket = (start) => {
    let j = start + 1, lvl = 0;
    while (src[j] === "=") {
      lvl++;
      j++;
    }
    return src[j] === "[" ? { level: lvl, end: j + 1 } : null;
  };
  const readLong = (from, lvl) => {
    const close = "]" + "=".repeat(lvl) + "]";
    const e = src.indexOf(close, from);
    if (e < 0) err("unfinished long string");
    let s = src.slice(from, e);
    for (const ch of s) if (ch === "\n") line++;
    if (s.startsWith("\r\n")) s = s.slice(2);
    else if (s[0] === "\n") s = s.slice(1);
    return { s, end: e + close.length };
  };
  if (src.startsWith("#")) while (i < n && src[i] !== "\n") i++;
  while (i < n) {
    const c = src[i];
    if (c === "\n") {
      line++;
      i++;
      continue;
    }
    if (c === " " || c === "	" || c === "\r") {
      i++;
      continue;
    }
    if (c === "-" && src[i + 1] === "-") {
      i += 2;
      if (src[i] === "[") {
        const lb = longBracket(i);
        if (lb) {
          const r = readLong(lb.end, lb.level);
          i = r.end;
          continue;
        }
      }
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++;
      const w = src.slice(i, j);
      toks.push(KEYWORDS.has(w) ? { t: w, line } : { t: "name", v: w, line });
      i = j;
      continue;
    }
    if (/[0-9]/.test(c) || c === "." && /[0-9]/.test(src[i + 1] ?? "")) {
      let j = i;
      if (c === "0" && (src[i + 1] === "x" || src[i + 1] === "X")) {
        j = i + 2;
        while (/[0-9a-fA-F]/.test(src[j] ?? "")) j++;
      } else {
        while (/[0-9]/.test(src[j] ?? "")) j++;
        if (src[j] === ".") {
          j++;
          while (/[0-9]/.test(src[j] ?? "")) j++;
        }
        if (src[j] === "e" || src[j] === "E") {
          j++;
          if (src[j] === "+" || src[j] === "-") j++;
          while (/[0-9]/.test(src[j] ?? "")) j++;
        }
      }
      const v = strToNum(src.slice(i, j));
      if (v === void 0) err(`malformed number near '${src.slice(i, j)}'`);
      toks.push({ t: "number", v, line });
      i = j;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1, s = "";
      for (; ; ) {
        if (j >= n || src[j] === "\n") err("unfinished string");
        const d = src[j];
        if (d === c) {
          j++;
          break;
        }
        if (d === "\\") {
          j++;
          const e = src[j];
          const map = { n: "\n", t: "	", r: "\r", a: "\x07", b: "\b", f: "\f", v: "\v", "\\": "\\", '"': '"', "'": "'", "\n": "\n" };
          if (e === "\n") line++;
          if (e in map) {
            s += map[e];
            j++;
          } else if (/[0-9]/.test(e)) {
            let k = 0, v = 0;
            while (k < 3 && /[0-9]/.test(src[j] ?? "")) {
              v = v * 10 + Number(src[j]);
              j++;
              k++;
            }
            if (v > 255) err("escape sequence too large");
            s += String.fromCharCode(v);
          } else {
            s += e;
            j++;
          }
        } else {
          s += d;
          j++;
        }
      }
      toks.push({ t: "string", v: s, line });
      i = j;
      continue;
    }
    if (c === "[") {
      const lb = longBracket(i);
      if (lb) {
        const startLine = line;
        const r = readLong(lb.end, lb.level);
        toks.push({ t: "string", v: r.s, line: startLine });
        i = r.end;
        continue;
      }
    }
    const three = src.substr(i, 3), two = src.substr(i, 2);
    if (three === "...") {
      toks.push({ t: "...", line });
      i += 3;
      continue;
    }
    if (["==", "~=", "<=", ">=", ".."].includes(two)) {
      toks.push({ t: two, line });
      i += 2;
      continue;
    }
    if ("+-*/%^#<>=(){}[];:,.".includes(c)) {
      toks.push({ t: c, line });
      i++;
      continue;
    }
    err(`unexpected symbol near '${c}'`);
  }
  toks.push({ t: "eof", line });
  return toks;
}
var Box = class {
  constructor(v) {
    this.v = v;
  }
  v;
};
var Act = class {
  constructor(parent) {
    this.parent = parent;
  }
  parent;
  slots = [];
  varargs = [];
};
var BREAK = 1;
var FuncState = class {
  constructor(parent) {
    this.parent = parent;
  }
  parent;
  names = [];
  nslots = 0;
  blocks = [];
  isVararg = false;
  declare(name) {
    const slot = this.nslots++;
    this.names.push({ name, slot });
    return slot;
  }
  lookup(name) {
    for (let i = this.names.length - 1; i >= 0; i--) if (this.names[i].name === name) return this.names[i].slot;
    return -1;
  }
  open() {
    this.blocks.push(this.names.length);
  }
  close() {
    this.names.length = this.blocks.pop();
  }
};
function compileChunk(L2, src, chunkname) {
  const name = chunkname.startsWith("=") || chunkname.startsWith("@") ? chunkname.slice(1) : `[string "${chunkname.split("\n")[0].slice(0, 40)}"]`;
  const toks = lex(src, name);
  let p = 0;
  let fs = new FuncState(null);
  fs.isVararg = true;
  const err = (m, tk = toks[p]) => {
    throw new LuaError(`${name}:${tk.line}: ${m} near '${tk.v ?? tk.t}'`);
  };
  const peek = () => toks[p].t;
  const accept = (t) => {
    if (toks[p].t === t) {
      p++;
      return true;
    }
    return false;
  };
  const expect = (t) => {
    if (toks[p].t !== t) err(`'${t}' expected`);
    return toks[p++];
  };
  const nameTok = () => {
    if (toks[p].t !== "name") err("<name> expected");
    return toks[p++].v;
  };
  const resolve = (nm) => {
    let d = 0;
    for (let f = fs; f; f = f.parent, d++) {
      const s = f.lookup(nm);
      if (s >= 0) return { depth: d, slot: s };
    }
    return null;
  };
  const getVar = (nm) => {
    const r = resolve(nm);
    if (!r) return () => L2.index(L2.globals, nm);
    const { depth, slot } = r;
    if (depth === 0) return (a) => a.slots[slot].v;
    return (a) => {
      let x = a;
      for (let i = 0; i < depth; i++) x = x.parent;
      return x.slots[slot].v;
    };
  };
  const setVar = (nm) => {
    const r = resolve(nm);
    if (!r) return (_a, v) => L2.setindex(L2.globals, nm, v);
    const { depth, slot } = r;
    return (a, v) => {
      let x = a;
      for (let i = 0; i < depth; i++) x = x.parent;
      x.slots[slot].v = v;
    };
  };
  const one = (e) => e.single;
  const BINPRI = {
    or: [1, 1],
    and: [2, 2],
    "<": [3, 3],
    ">": [3, 3],
    "<=": [3, 3],
    ">=": [3, 3],
    "~=": [3, 3],
    "==": [3, 3],
    "..": [9, 8],
    "+": [6, 6],
    "-": [6, 6],
    "*": [7, 7],
    "/": [7, 7],
    "%": [7, 7],
    "^": [10, 9]
  };
  const UNARY_PRI = 8;
  function primaryExp() {
    const t = toks[p];
    if (t.t === "name") {
      p++;
      const g = getVar(t.v);
      return { single: g };
    }
    if (t.t === "(") {
      p++;
      const e = expr(0);
      expect(")");
      return { single: e.single };
    }
    return err("unexpected symbol");
  }
  function callArgs() {
    const t = toks[p];
    if (t.t === "string") {
      p++;
      const s = t.v;
      return () => [s];
    }
    if (t.t === "{") {
      const tb = tableCons();
      return (a) => [tb.single(a)];
    }
    if (t.t !== "(") err("function arguments expected");
    p++;
    if (accept(")")) return () => [];
    const list = exprList();
    expect(")");
    return list;
  }
  function suffixedExp() {
    let e = primaryExp();
    for (; ; ) {
      const t = toks[p];
      if (t.t === ".") {
        p++;
        const k = nameTok();
        const base = e.single;
        e = { single: (a) => L2.index(base(a), k) };
      } else if (t.t === "[") {
        p++;
        const k = expr(0).single;
        expect("]");
        const base = e.single;
        e = { single: (a) => L2.index(base(a), k(a)) };
      } else if (t.t === ":") {
        p++;
        const m = nameTok();
        const args = callArgs();
        const base = e.single;
        const multi = (a) => {
          const o = base(a);
          const f = L2.index(o, m);
          return L2.callArr(f, [o, ...args(a)]);
        };
        e = { single: (a) => multi(a)[0], multi };
      } else if (t.t === "(" || t.t === "string" || t.t === "{") {
        const args = callArgs();
        const base = e.single;
        const multi = (a) => L2.callArr(base(a), args(a));
        e = { single: (a) => multi(a)[0], multi };
      } else return e;
    }
  }
  function tableCons() {
    expect("{");
    const items = [];
    while (peek() !== "}") {
      if (peek() === "[") {
        p++;
        const k = expr(0).single;
        expect("]");
        expect("=");
        const v = expr(0).single;
        items.push((a, t) => L2.rawsetChecked(t, k(a), v(a)));
      } else if (peek() === "name" && toks[p + 1].t === "=") {
        const k = nameTok();
        p++;
        const v = expr(0).single;
        items.push((a, t) => t.set(k, v(a)));
      } else {
        const e = expr(0);
        const last = peek() === "}" || peek() !== "," && peek() !== ";";
        if (e.multi && toks[p].t === "}") {
          const m = e.multi;
          items.push((a, t, st) => {
            for (const x of m(a)) t.set(st.n++, x);
          });
        } else {
          const s = e.single;
          items.push((a, t, st) => {
            t.set(st.n++, s(a));
          });
        }
        void last;
      }
      if (!accept(",") && !accept(";")) break;
    }
    expect("}");
    return { single: (a) => {
      const t = new LuaTable();
      const st = { n: 1 };
      for (const it of items) it(a, t, st);
      return t;
    } };
  }
  function functionBody(isMethod, lineDef) {
    const nf = new FuncState(fs);
    fs = nf;
    nf.open();
    const params = [];
    if (isMethod) params.push(nf.declare("self"));
    expect("(");
    if (peek() !== ")") {
      do {
        if (accept("...")) {
          nf.isVararg = true;
          break;
        }
        params.push(nf.declare(nameTok()));
      } while (accept(","));
    }
    expect(")");
    const body = block();
    expect("end");
    nf.close();
    fs = nf.parent;
    const nslots2 = nf.nslots;
    void lineDef;
    return {
      single: (a0) => {
        const a = new Act(a0.parent);
        a.slots = a0.slots.slice();
        a.varargs = a0.varargs;
        const fn2 = (...args) => {
          const act = new Act(a);
          for (let i = 0; i < nslots2; i++) act.slots[i] = new Box(void 0);
          for (let i = 0; i < params.length; i++) act.slots[params[i]].v = args[i];
          if (nf.isVararg) act.varargs = args.slice(params.length);
          const r = body(act);
          return r !== void 0 && typeof r === "object" ? r.ret : void 0;
        };
        return fn2;
      }
    };
  }
  function simpleExp() {
    const t = toks[p];
    switch (t.t) {
      case "number":
        p++;
        {
          const v = t.v;
          return { single: () => v };
        }
      case "string":
        p++;
        {
          const v = t.v;
          return { single: () => v };
        }
      case "nil":
        p++;
        return { single: () => void 0 };
      case "true":
        p++;
        return { single: () => true };
      case "false":
        p++;
        return { single: () => false };
      case "...":
        p++;
        {
          if (!fs.isVararg) err("cannot use '...' outside a vararg function");
          return { single: (a) => a.varargs[0], multi: (a) => a.varargs };
        }
      case "{":
        return tableCons();
      case "function":
        p++;
        return functionBody(false, t.line);
      default:
        return suffixedExp();
    }
  }
  function expr(limit) {
    let left;
    const t = toks[p];
    if (t.t === "not" || t.t === "-" || t.t === "#") {
      p++;
      const o = expr(UNARY_PRI).single;
      if (t.t === "not") left = { single: (a) => {
        const v = o(a);
        return v === void 0 || v === false;
      } };
      else if (t.t === "-") left = { single: (a) => {
        const v = o(a);
        return typeof v === "number" ? -v : L2.arith(18, v, v);
      } };
      else left = { single: (a) => L2.len(o(a)) };
    } else left = simpleExp();
    for (; ; ) {
      const op = toks[p].t;
      const pri = BINPRI[op];
      if (!pri || pri[0] <= limit) break;
      p++;
      const right = expr(pri[1]).single;
      const l = left.single;
      switch (op) {
        case "or":
          left = { single: (a) => {
            const v = l(a);
            return v !== void 0 && v !== false ? v : right(a);
          } };
          break;
        case "and":
          left = { single: (a) => {
            const v = l(a);
            return v === void 0 || v === false ? v : right(a);
          } };
          break;
        case "==":
          left = { single: (a) => L2.eq(l(a), right(a)) };
          break;
        case "~=":
          left = { single: (a) => !L2.eq(l(a), right(a)) };
          break;
        case "<":
          left = { single: (a) => L2.lt(l(a), right(a)) };
          break;
        case ">":
          left = { single: (a) => {
            const x = l(a), y = right(a);
            return L2.lt(y, x);
          } };
          break;
        case "<=":
          left = { single: (a) => L2.le(l(a), right(a)) };
          break;
        case ">=":
          left = { single: (a) => {
            const x = l(a), y = right(a);
            return L2.le(y, x);
          } };
          break;
        case "..":
          left = { single: (a) => L2.concat(l(a), right(a)) };
          break;
        case "+":
          left = { single: (a) => L2.arith(12, l(a), right(a)) };
          break;
        case "-":
          left = { single: (a) => L2.arith(13, l(a), right(a)) };
          break;
        case "*":
          left = { single: (a) => L2.arith(14, l(a), right(a)) };
          break;
        case "/":
          left = { single: (a) => L2.arith(15, l(a), right(a)) };
          break;
        case "%":
          left = { single: (a) => L2.arith(16, l(a), right(a)) };
          break;
        case "^":
          left = { single: (a) => L2.arith(17, l(a), right(a)) };
          break;
      }
    }
    return left;
  }
  function exprList() {
    const es = [expr(0)];
    while (accept(",")) es.push(expr(0));
    const last = es[es.length - 1];
    const head = es.slice(0, -1).map(one);
    if (last.multi) {
      const m = last.multi;
      return (a) => {
        const out2 = head.map((h) => h(a));
        for (const x of m(a)) out2.push(x);
        return out2;
      };
    }
    const s = last.single;
    return (a) => {
      const out2 = head.map((h) => h(a));
      out2.push(s(a));
      return out2;
    };
  }
  function block() {
    fs.open();
    const stats = [];
    for (; ; ) {
      const t = peek();
      if (t === "return") {
        p++;
        let vals = () => [];
        if (peek() !== "end" && peek() !== "eof" && peek() !== "else" && peek() !== "elseif" && peek() !== "until" && peek() !== ";") vals = exprList();
        accept(";");
        const v = vals;
        stats.push((a) => ({ ret: v(a) }));
        break;
      }
      if (t === "break") {
        p++;
        accept(";");
        stats.push(() => BREAK);
        break;
      }
      if (t === "end" || t === "eof" || t === "else" || t === "elseif" || t === "until") break;
      const s = statement();
      if (s) stats.push(s);
    }
    fs.close();
    return (a) => {
      for (let i = 0; i < stats.length; i++) {
        const r = stats[i](a);
        if (r !== void 0) return r;
      }
      return void 0;
    };
  }
  function statement() {
    const t = toks[p];
    switch (t.t) {
      case ";":
        p++;
        return null;
      case "if": {
        p++;
        const conds = [], bodies = [];
        conds.push(expr(0).single);
        expect("then");
        bodies.push(block());
        let els = null;
        for (; ; ) {
          if (accept("elseif")) {
            conds.push(expr(0).single);
            expect("then");
            bodies.push(block());
          } else if (accept("else")) {
            els = block();
            expect("end");
            break;
          } else {
            expect("end");
            break;
          }
        }
        return (a) => {
          for (let i = 0; i < conds.length; i++) {
            const c = conds[i](a);
            if (c !== void 0 && c !== false) return bodies[i](a);
          }
          return els ? els(a) : void 0;
        };
      }
      case "while": {
        p++;
        const c = expr(0).single;
        expect("do");
        const b = block();
        expect("end");
        return (a) => {
          for (; ; ) {
            const v = c(a);
            if (v === void 0 || v === false) return void 0;
            const r = b(a);
            if (r === BREAK) return void 0;
            if (r !== void 0) return r;
          }
        };
      }
      case "do": {
        p++;
        const b = block();
        expect("end");
        return b;
      }
      case "for": {
        p++;
        const n1 = nameTok();
        if (peek() === "=") {
          p++;
          const e1 = expr(0).single;
          expect(",");
          const e2 = expr(0).single;
          let e3 = null;
          if (accept(",")) e3 = expr(0).single;
          expect("do");
          fs.open();
          const slot = fs.declare(n1);
          const b2 = block();
          fs.close();
          expect("end");
          return (a) => {
            const init = L2.tonumber(e1(a)), lim = L2.tonumber(e2(a)), st = e3 ? L2.tonumber(e3(a)) : 1;
            if (init === void 0) L2.rt("'for' initial value must be a number");
            if (lim === void 0) L2.rt("'for' limit must be a number");
            if (st === void 0) L2.rt("'for' step must be a number");
            for (let i = init; st > 0 ? i <= lim : i >= lim; i += st) {
              a.slots[slot] = new Box(i);
              const r = b2(a);
              if (r === BREAK) break;
              if (r !== void 0) return r;
            }
            return void 0;
          };
        }
        const names = [n1];
        while (accept(",")) names.push(nameTok());
        expect("in");
        const list = exprList();
        expect("do");
        fs.open();
        const slots = names.map((n) => fs.declare(n));
        const b = block();
        fs.close();
        expect("end");
        return (a) => {
          const init = list(a);
          const f = init[0], s = init[1];
          let ctl = init[2];
          for (; ; ) {
            const r = L2.callArr(f, [s, ctl]);
            if (r[0] === void 0) break;
            ctl = r[0];
            for (let i = 0; i < slots.length; i++) a.slots[slots[i]] = new Box(r[i]);
            const rr = b(a);
            if (rr === BREAK) break;
            if (rr !== void 0) return rr;
          }
          return void 0;
        };
      }
      case "repeat": {
        p++;
        fs.open();
        const stats = [];
        for (; ; ) {
          const tt = peek();
          if (tt === "until") break;
          if (tt === "return") {
            p++;
            let vals = () => [];
            if (peek() !== "until") vals = exprList();
            accept(";");
            const v = vals;
            stats.push((a) => ({ ret: v(a) }));
            break;
          }
          if (tt === "break") {
            p++;
            stats.push(() => BREAK);
            break;
          }
          if (tt === "eof") err("'until' expected");
          const s = statement();
          if (s) stats.push(s);
        }
        expect("until");
        const c = expr(0).single;
        fs.close();
        return (a) => {
          for (; ; ) {
            for (let i = 0; i < stats.length; i++) {
              const r = stats[i](a);
              if (r === BREAK) return void 0;
              if (r !== void 0) return r;
            }
            const v = c(a);
            if (v !== void 0 && v !== false) return void 0;
          }
        };
      }
      case "function": {
        p++;
        const first = nameTok();
        let target = null;
        let isMethod = false;
        const path = [];
        while (peek() === "." || peek() === ":") {
          const sep = toks[p++].t;
          path.push(nameTok());
          if (sep === ":") {
            isMethod = true;
            break;
          }
        }
        const fe = functionBody(isMethod, t.line).single;
        if (path.length === 0) {
          const st = setVar(first);
          return (a) => {
            st(a, fe(a));
            return void 0;
          };
        }
        const base = getVar(first);
        return (a) => {
          let o = base(a);
          for (let i = 0; i < path.length - 1; i++) o = L2.index(o, path[i]);
          L2.setindex(o, path[path.length - 1], fe(a));
          return void 0;
        };
        void target;
      }
      case "local": {
        p++;
        if (accept("function")) {
          const nm = nameTok();
          const slot = fs.declare(nm);
          const fe = functionBody(false, t.line).single;
          return (a) => {
            a.slots[slot] = new Box(void 0);
            a.slots[slot].v = fe(a);
            return void 0;
          };
        }
        const names = [nameTok()];
        while (accept(",")) names.push(nameTok());
        let list = () => [];
        if (accept("=")) list = exprList();
        const slots = names.map((n) => fs.declare(n));
        return (a) => {
          const vals = list(a);
          for (let i = 0; i < slots.length; i++) a.slots[slots[i]] = new Box(vals[i]);
          return void 0;
        };
      }
      default: {
        const e = suffixedExp();
        if (peek() === "=" || peek() === ",") {
          const targets = [];
          const addTarget = (ex) => {
            if (ex.kind === "var") {
              const st = setVar(ex.name);
              targets.push(st);
            } else {
              const b = ex.base, k = ex.key;
              targets.push(() => void 0);
              void b;
              void k;
            }
          };
          void addTarget;
          p = startOfStatement(t);
          const tlist = [];
          const parseTarget = () => {
            const nm = toks[p];
            if (nm.t !== "name") err("syntax error");
            p++;
            let cur = getVar(nm.v);
            let lastBase = null, lastKey = null;
            let plain = nm.v;
            for (; ; ) {
              if (peek() === ".") {
                p++;
                const k = nameTok();
                lastBase = cur;
                const kk = k;
                lastKey = () => kk;
                const b = cur;
                cur = (a) => L2.index(b(a), kk);
                plain = null;
              } else if (peek() === "[") {
                p++;
                const k = expr(0).single;
                expect("]");
                lastBase = cur;
                lastKey = k;
                const b = cur;
                cur = (a) => L2.index(b(a), k(a));
                plain = null;
              } else if (peek() === ":" || peek() === "(" || peek() === "string" || peek() === "{") {
                if (peek() === ":") {
                  p++;
                  const m2 = nameTok();
                  const args = callArgs();
                  const b = cur;
                  cur = (a) => {
                    const o = b(a);
                    return L2.call1(L2.index(o, m2), o, ...args(a));
                  };
                } else {
                  const args = callArgs();
                  const b = cur;
                  cur = (a) => L2.call1(b(a), ...args(a));
                }
                plain = null;
                lastBase = null;
                lastKey = null;
              } else break;
            }
            if (plain !== null) {
              const st = setVar(plain);
              tlist.push({ set: st });
            } else if (lastBase && lastKey) {
              const lb = lastBase, lk = lastKey;
              tlist.push({ set: () => void 0, prep: (a) => {
                const o = lb(a), k = lk(a);
                return (v) => L2.setindex(o, k, v);
              } });
            } else err("syntax error");
          };
          parseTarget();
          while (accept(",")) parseTarget();
          expect("=");
          const vals = exprList();
          return (a) => {
            const setters = tlist.map((tg) => tg.prep ? tg.prep(a) : (v) => tg.set(a, v));
            const vs = vals(a);
            for (let i = 0; i < setters.length; i++) setters[i](vs[i]);
            return void 0;
          };
        }
        if (!e.multi) err("syntax error");
        const m = e.multi;
        return (a) => {
          m(a);
          return void 0;
        };
      }
    }
  }
  const startOfStatement = (tok) => toks.indexOf(tok);
  const main = block();
  if (peek() !== "eof") err("'<eof>' expected");
  const nslots = fs.nslots;
  const fn = (...args) => {
    const act = new Act(null);
    for (let i = 0; i < nslots; i++) act.slots[i] = new Box(void 0);
    act.varargs = args;
    const r = main(act);
    return r !== void 0 && typeof r === "object" ? r.ret : void 0;
  };
  void numToStr;
  return fn;
}

// tests/run_luac.ts
var out = "";
var L = new LuaState();
var host = {
  readFile: (p) => {
    try {
      return readFileSync(p, "latin1");
    } catch {
      return void 0;
    }
  },
  writeFile: () => false,
  removeFile: () => false,
  print: (t) => {
    out += t + "\n";
  },
  write: (t) => {
    out += t;
  },
  compile: (src, name) => compileChunk(L, src, name)
};
openLibs(L, host);
for (const f of process.argv.slice(2)) {
  const bytes = readFileSync(f);
  let fn;
  if (isBytecode(new Uint8Array(bytes))) fn = L.closureOf(undump(new Uint8Array(bytes)));
  else fn = compileChunk(L, bytes.toString("latin1"), "@" + f);
  const r = L.pcall(fn, []);
  if (!r.ok) out += "ERROR: " + (typeof r.err === "string" ? r.err : String(r.err)) + "\n" + r.traceback + "\n";
}
process.stdout.write(Buffer.from(out, "latin1"));
