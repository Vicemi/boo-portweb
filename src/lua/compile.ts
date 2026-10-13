// A compiler for Lua 5.1 SOURCE text (loadstring / load). The game only uses it for data (the save files and JSON are chunks like `return {...}`),
// so the chunks are compiled to JS closures instead of bytecode. The functions it creates are native functions for the VM.
import { LuaTable, LuaError, numToStr, strToNum, type LuaValue, type NativeFunction } from './value';
import type { LuaState } from './vm';

// ------------------------------------------------------------------------------------------------------------------------------------ lexer
type Tok = { t: string; v?: any; line: number };
const KEYWORDS = new Set(['and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'if', 'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while']);

function lex(src: string, chunk: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0, line = 1;
  const err = (m: string): never => { throw new LuaError(`${chunk}:${line}: ${m}`); };
  const n = src.length;
  const longBracket = (start: number): { level: number; end: number } | null => {
    let j = start + 1, lvl = 0;
    while (src[j] === '=') { lvl++; j++; }
    return src[j] === '[' ? { level: lvl, end: j + 1 } : null;
  };
  const readLong = (from: number, lvl: number): { s: string; end: number } => {
    const close = ']' + '='.repeat(lvl) + ']';
    const e = src.indexOf(close, from);
    if (e < 0) err('unfinished long string');
    let s = src.slice(from, e);
    for (const ch of s) if (ch === '\n') line++;
    if (s.startsWith('\r\n')) s = s.slice(2); else if (s[0] === '\n') s = s.slice(1);
    return { s, end: e + close.length };
  };
  if (src.startsWith('#')) while (i < n && src[i] !== '\n') i++;
  while (i < n) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (c === '-' && src[i + 1] === '-') {
      i += 2;
      if (src[i] === '[') { const lb = longBracket(i); if (lb) { const r = readLong(lb.end, lb.level); i = r.end; continue; } }
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++;
      const w = src.slice(i, j);
      toks.push(KEYWORDS.has(w) ? { t: w, line } : { t: 'name', v: w, line });
      i = j; continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i;
      if (c === '0' && (src[i + 1] === 'x' || src[i + 1] === 'X')) { j = i + 2; while (/[0-9a-fA-F]/.test(src[j] ?? '')) j++; }
      else {
        while (/[0-9]/.test(src[j] ?? '')) j++;
        if (src[j] === '.') { j++; while (/[0-9]/.test(src[j] ?? '')) j++; }
        if (src[j] === 'e' || src[j] === 'E') { j++; if (src[j] === '+' || src[j] === '-') j++; while (/[0-9]/.test(src[j] ?? '')) j++; }
      }
      const v = strToNum(src.slice(i, j));
      if (v === undefined) err(`malformed number near '${src.slice(i, j)}'`);
      toks.push({ t: 'number', v, line }); i = j; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1, s = '';
      for (;;) {
        if (j >= n || src[j] === '\n') err('unfinished string');
        const d = src[j];
        if (d === c) { j++; break; }
        if (d === '\\') {
          j++;
          const e = src[j];
          const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', f: '\f', v: '\v', '\\': '\\', '"': '"', "'": "'", '\n': '\n' };
          if (e === '\n') line++;
          if (e in map) { s += map[e]; j++; }
          else if (/[0-9]/.test(e)) { let k = 0, v = 0; while (k < 3 && /[0-9]/.test(src[j] ?? '')) { v = v * 10 + Number(src[j]); j++; k++; } if (v > 255) err('escape sequence too large'); s += String.fromCharCode(v); }
          else { s += e; j++; }
        } else { s += d; j++; }
      }
      toks.push({ t: 'string', v: s, line }); i = j; continue;
    }
    if (c === '[') {
      const lb = longBracket(i);
      if (lb) { const startLine = line; const r = readLong(lb.end, lb.level); toks.push({ t: 'string', v: r.s, line: startLine }); i = r.end; continue; }
    }
    const three = src.substr(i, 3), two = src.substr(i, 2);
    if (three === '...') { toks.push({ t: '...', line }); i += 3; continue; }
    if (['==', '~=', '<=', '>=', '..'].includes(two)) { toks.push({ t: two, line }); i += 2; continue; }
    if ('+-*/%^#<>=(){}[];:,.'.includes(c)) { toks.push({ t: c, line }); i++; continue; }
    err(`unexpected symbol near '${c}'`);
  }
  toks.push({ t: 'eof', line });
  return toks;
}

// ------------------------------------------------------------------------------------------------------------------------------------ runtime structures
class Box { constructor(public v: LuaValue) {} }
class Act {
  slots: Box[] = [];
  varargs: LuaValue[] = [];
  constructor(public parent: Act | null) {}
}
type Expr = (a: Act) => LuaValue;
type Multi = (a: Act) => LuaValue[];
type Stat = (a: Act) => number | undefined | { ret: LuaValue[] };    // undefined = go on, BREAK = break, {ret} = return
const BREAK = 1;

class FuncState {
  names: { name: string; slot: number }[] = [];
  nslots = 0;
  blocks: number[] = [];
  isVararg = false;
  constructor(public parent: FuncState | null) {}
  declare(name: string): number { const slot = this.nslots++; this.names.push({ name, slot }); return slot; }
  lookup(name: string): number {
    for (let i = this.names.length - 1; i >= 0; i--) if (this.names[i].name === name) return this.names[i].slot;
    return -1;
  }
  open(): void { this.blocks.push(this.names.length); }
  close(): void { this.names.length = this.blocks.pop()!; }
}

export function compileChunk(L: LuaState, src: string, chunkname: string): NativeFunction {
  const name = chunkname.startsWith('=') || chunkname.startsWith('@') ? chunkname.slice(1) : `[string "${chunkname.split('\n')[0].slice(0, 40)}"]`;
  const toks = lex(src, name);
  let p = 0;
  let fs: FuncState = new FuncState(null);
  fs.isVararg = true;
  const err = (m: string, tk = toks[p]): never => { throw new LuaError(`${name}:${tk.line}: ${m} near '${tk.v ?? tk.t}'`); };
  const peek = (): string => toks[p].t;
  const accept = (t: string): boolean => { if (toks[p].t === t) { p++; return true; } return false; };
  const expect = (t: string): Tok => { if (toks[p].t !== t) err(`'${t}' expected`); return toks[p++]; };
  const nameTok = (): string => { if (toks[p].t !== 'name') err('<name> expected'); return toks[p++].v; };

  // variable access: (depth, slot) of an enclosing function
  const resolve = (nm: string): { depth: number; slot: number } | null => {
    let d = 0;
    for (let f: FuncState | null = fs; f; f = f.parent, d++) { const s = f.lookup(nm); if (s >= 0) return { depth: d, slot: s }; }
    return null;
  };
  const getVar = (nm: string): Expr => {
    const r = resolve(nm);
    if (!r) return () => L.index(L.globals, nm);
    const { depth, slot } = r;
    if (depth === 0) return (a) => a.slots[slot].v;
    return (a) => { let x = a; for (let i = 0; i < depth; i++) x = x.parent!; return x.slots[slot].v; };
  };
  const setVar = (nm: string): ((a: Act, v: LuaValue) => void) => {
    const r = resolve(nm);
    if (!r) return (_a, v) => L.setindex(L.globals, nm, v);
    const { depth, slot } = r;
    return (a, v) => { let x = a; for (let i = 0; i < depth; i++) x = x.parent!; x.slots[slot].v = v; };
  };

  // ---- expressions
  type E = { single: Expr; multi?: Multi };
  const one = (e: E): Expr => e.single;
  const BINPRI: Record<string, [number, number]> = {
    or: [1, 1], and: [2, 2], '<': [3, 3], '>': [3, 3], '<=': [3, 3], '>=': [3, 3], '~=': [3, 3], '==': [3, 3],
    '..': [9, 8], '+': [6, 6], '-': [6, 6], '*': [7, 7], '/': [7, 7], '%': [7, 7], '^': [10, 9],
  };
  const UNARY_PRI = 8;

  function primaryExp(): E {
    const t = toks[p];
    if (t.t === 'name') { p++; const g = getVar(t.v); return { single: g }; }
    if (t.t === '(') { p++; const e = expr(0); expect(')'); return { single: e.single }; }
    return err('unexpected symbol');
  }

  function callArgs(): Multi {
    const t = toks[p];
    if (t.t === 'string') { p++; const s = t.v; return () => [s]; }
    if (t.t === '{') { const tb = tableCons(); return (a) => [tb.single(a)]; }
    if (t.t !== '(') err('function arguments expected');
    p++;
    if (accept(')')) return () => [];
    const list = exprList();
    expect(')');
    return list;
  }

  function suffixedExp(): E {
    let e = primaryExp();
    for (;;) {
      const t = toks[p];
      if (t.t === '.') {
        p++; const k = nameTok(); const base = e.single;
        e = { single: (a) => L.index(base(a), k) };
      } else if (t.t === '[') {
        p++; const k = expr(0).single; expect(']'); const base = e.single;
        e = { single: (a) => L.index(base(a), k(a)) };
      } else if (t.t === ':') {
        p++; const m = nameTok(); const args = callArgs(); const base = e.single;
        const multi: Multi = (a) => { const o = base(a); const f = L.index(o, m); return L.callArr(f, [o, ...args(a)]); };
        e = { single: (a) => multi(a)[0], multi };
      } else if (t.t === '(' || t.t === 'string' || t.t === '{') {
        const args = callArgs(); const base = e.single;
        const multi: Multi = (a) => L.callArr(base(a), args(a));
        e = { single: (a) => multi(a)[0], multi };
      } else return e;
    }
  }

  function tableCons(): E {
    expect('{');
    const items: ((a: Act, t: LuaTable, state: { n: number }) => void)[] = [];
    while (peek() !== '}') {
      if (peek() === '[') {
        p++; const k = expr(0).single; expect(']'); expect('='); const v = expr(0).single;
        items.push((a, t) => L.rawsetChecked(t, k(a), v(a)));
      } else if (peek() === 'name' && toks[p + 1].t === '=') {
        const k = nameTok(); p++; const v = expr(0).single;
        items.push((a, t) => t.set(k, v(a)));
      } else {
        const e = expr(0);
        const last = peek() === '}' || (peek() !== ',' && peek() !== ';');
        if (e.multi && (toks[p].t === '}' )) { const m = e.multi; items.push((a, t, st) => { for (const x of m(a)) t.set(st.n++, x); }); }
        else { const s = e.single; items.push((a, t, st) => { t.set(st.n++, s(a)); }); }
        void last;
      }
      if (!accept(',') && !accept(';')) break;
    }
    expect('}');
    return { single: (a) => { const t = new LuaTable(); const st = { n: 1 }; for (const it of items) it(a, t, st); return t; } };
  }

  function functionBody(isMethod: boolean, lineDef: number): E {
    const nf = new FuncState(fs);
    fs = nf;
    nf.open();
    const params: number[] = [];
    if (isMethod) params.push(nf.declare('self'));
    expect('(');
    if (peek() !== ')') {
      do {
        if (accept('...')) { nf.isVararg = true; break; }
        params.push(nf.declare(nameTok()));
      } while (accept(','));
    }
    expect(')');
    const body = block();
    expect('end');
    nf.close();
    fs = nf.parent!;
    const nslots = nf.nslots;
    void lineDef;
    return {
      single: (a0) => {
        // the closure keeps the variables (boxes) that exist now: a loop makes a new one for every iteration
        const a = new Act(a0.parent);
        a.slots = a0.slots.slice(); a.varargs = a0.varargs;
        const fn: NativeFunction = (...args: LuaValue[]) => {
          const act = new Act(a);
          for (let i = 0; i < nslots; i++) act.slots[i] = new Box(undefined);
          for (let i = 0; i < params.length; i++) act.slots[params[i]].v = args[i];
          if (nf.isVararg) act.varargs = args.slice(params.length);
          const r = body(act);
          return r !== undefined && typeof r === 'object' ? r.ret : undefined;
        };
        return fn;
      },
    };
  }

  function simpleExp(): E {
    const t = toks[p];
    switch (t.t) {
      case 'number': p++; { const v = t.v; return { single: () => v }; }
      case 'string': p++; { const v = t.v; return { single: () => v }; }
      case 'nil': p++; return { single: () => undefined };
      case 'true': p++; return { single: () => true };
      case 'false': p++; return { single: () => false };
      case '...': p++; { if (!fs.isVararg) err("cannot use '...' outside a vararg function"); return { single: (a) => a.varargs[0], multi: (a) => a.varargs }; }
      case '{': return tableCons();
      case 'function': p++; return functionBody(false, t.line);
      default: return suffixedExp();
    }
  }

  function expr(limit: number): E {
    let left: E;
    const t = toks[p];
    if (t.t === 'not' || t.t === '-' || t.t === '#') {
      p++;
      const o = expr(UNARY_PRI).single;
      if (t.t === 'not') left = { single: (a) => { const v = o(a); return v === undefined || v === false; } };
      else if (t.t === '-') left = { single: (a) => { const v = o(a); return typeof v === 'number' ? -v : L.arith(18, v, v); } };
      else left = { single: (a) => L.len(o(a)) };
    } else left = simpleExp();
    for (;;) {
      const op = toks[p].t;
      const pri = BINPRI[op];
      if (!pri || pri[0] <= limit) break;
      p++;
      const right = expr(pri[1]).single;
      const l = left.single;
      switch (op) {
        case 'or': left = { single: (a) => { const v = l(a); return v !== undefined && v !== false ? v : right(a); } }; break;
        case 'and': left = { single: (a) => { const v = l(a); return v === undefined || v === false ? v : right(a); } }; break;
        case '==': left = { single: (a) => L.eq(l(a), right(a)) }; break;
        case '~=': left = { single: (a) => !L.eq(l(a), right(a)) }; break;
        case '<': left = { single: (a) => L.lt(l(a), right(a)) }; break;
        case '>': left = { single: (a) => { const x = l(a), y = right(a); return L.lt(y, x); } }; break;
        case '<=': left = { single: (a) => L.le(l(a), right(a)) }; break;
        case '>=': left = { single: (a) => { const x = l(a), y = right(a); return L.le(y, x); } }; break;
        case '..': left = { single: (a) => L.concat(l(a), right(a)) }; break;
        case '+': left = { single: (a) => L.arith(12, l(a), right(a)) }; break;
        case '-': left = { single: (a) => L.arith(13, l(a), right(a)) }; break;
        case '*': left = { single: (a) => L.arith(14, l(a), right(a)) }; break;
        case '/': left = { single: (a) => L.arith(15, l(a), right(a)) }; break;
        case '%': left = { single: (a) => L.arith(16, l(a), right(a)) }; break;
        case '^': left = { single: (a) => L.arith(17, l(a), right(a)) }; break;
      }
    }
    return left;
  }

  /** a list of expressions; the last one may give several values */
  function exprList(): Multi {
    const es: E[] = [expr(0)];
    while (accept(',')) es.push(expr(0));
    const last = es[es.length - 1];
    const head = es.slice(0, -1).map(one);
    if (last.multi) { const m = last.multi; return (a) => { const out = head.map((h) => h(a)); for (const x of m(a)) out.push(x); return out; }; }
    const s = last.single;
    return (a) => { const out = head.map((h) => h(a)); out.push(s(a)); return out; };
  }

  // ---- statements
  function block(): Stat {
    fs.open();
    const stats: Stat[] = [];
    for (;;) {
      const t = peek();
      if (t === 'return') {
        p++;
        let vals: Multi = () => [];
        if (peek() !== 'end' && peek() !== 'eof' && peek() !== 'else' && peek() !== 'elseif' && peek() !== 'until' && peek() !== ';') vals = exprList();
        accept(';');
        const v = vals;
        stats.push((a) => ({ ret: v(a) }));
        break;
      }
      if (t === 'break') { p++; accept(';'); stats.push(() => BREAK); break; }
      if (t === 'end' || t === 'eof' || t === 'else' || t === 'elseif' || t === 'until') break;
      const s = statement();
      if (s) stats.push(s);
    }
    fs.close();
    return (a) => {
      for (let i = 0; i < stats.length; i++) { const r = stats[i](a); if (r !== undefined) return r; }
      return undefined;
    };
  }

  function statement(): Stat | null {
    const t = toks[p];
    switch (t.t) {
      case ';': p++; return null;
      case 'if': {
        p++;
        const conds: Expr[] = [], bodies: Stat[] = [];
        conds.push(expr(0).single); expect('then'); bodies.push(block());
        let els: Stat | null = null;
        for (;;) {
          if (accept('elseif')) { conds.push(expr(0).single); expect('then'); bodies.push(block()); }
          else if (accept('else')) { els = block(); expect('end'); break; }
          else { expect('end'); break; }
        }
        return (a) => {
          for (let i = 0; i < conds.length; i++) { const c = conds[i](a); if (c !== undefined && c !== false) return bodies[i](a); }
          return els ? els(a) : undefined;
        };
      }
      case 'while': {
        p++; const c = expr(0).single; expect('do'); const b = block(); expect('end');
        return (a) => {
          for (;;) { const v = c(a); if (v === undefined || v === false) return undefined; const r = b(a); if (r === BREAK) return undefined; if (r !== undefined) return r; }
        };
      }
      case 'do': { p++; const b = block(); expect('end'); return b; }
      case 'for': {
        p++;
        const n1 = nameTok();
        if (peek() === '=') {
          p++;
          const e1 = expr(0).single; expect(','); const e2 = expr(0).single;
          let e3: Expr | null = null;
          if (accept(',')) e3 = expr(0).single;
          expect('do');
          fs.open();
          const slot = fs.declare(n1);
          const b = block();
          fs.close();
          expect('end');
          return (a) => {
            const init = L.tonumber(e1(a)), lim = L.tonumber(e2(a)), st = e3 ? L.tonumber(e3(a)) : 1;
            if (init === undefined) L.rt("'for' initial value must be a number");
            if (lim === undefined) L.rt("'for' limit must be a number");
            if (st === undefined) L.rt("'for' step must be a number");
            for (let i = init!; st! > 0 ? i <= lim! : i >= lim!; i += st!) {
              a.slots[slot] = new Box(i);
              const r = b(a);
              if (r === BREAK) break;
              if (r !== undefined) return r;
            }
            return undefined;
          };
        }
        const names = [n1];
        while (accept(',')) names.push(nameTok());
        expect('in');
        const list = exprList();
        expect('do');
        fs.open();
        const slots = names.map((n) => fs.declare(n));
        const b = block();
        fs.close();
        expect('end');
        return (a) => {
          const init = list(a);
          const f = init[0], s = init[1];
          let ctl = init[2];
          for (;;) {
            const r = L.callArr(f, [s, ctl]);
            if (r[0] === undefined) break;
            ctl = r[0];
            for (let i = 0; i < slots.length; i++) a.slots[slots[i]] = new Box(r[i]);
            const rr = b(a);
            if (rr === BREAK) break;
            if (rr !== undefined) return rr;
          }
          return undefined;
        };
      }
      case 'repeat': {
        p++;
        // the condition sees the locals of the body
        fs.open();
        const stats: Stat[] = [];
        for (;;) {
          const tt = peek();
          if (tt === 'until') break;
          if (tt === 'return') { p++; let vals: Multi = () => []; if (peek() !== 'until') vals = exprList(); accept(';'); const v = vals; stats.push((a) => ({ ret: v(a) })); break; }
          if (tt === 'break') { p++; stats.push(() => BREAK); break; }
          if (tt === 'eof') err("'until' expected");
          const s = statement(); if (s) stats.push(s);
        }
        expect('until');
        const c = expr(0).single;
        fs.close();
        return (a) => {
          for (;;) {
            for (let i = 0; i < stats.length; i++) { const r = stats[i](a); if (r === BREAK) return undefined; if (r !== undefined) return r; }
            const v = c(a);
            if (v !== undefined && v !== false) return undefined;
          }
        };
      }
      case 'function': {
        p++;
        const first = nameTok();
        let target: { get: Expr; set: (a: Act, v: LuaValue) => void } | null = null;
        let isMethod = false;
        const path: string[] = [];
        while (peek() === '.' || peek() === ':') { const sep = toks[p++].t; path.push(nameTok()); if (sep === ':') { isMethod = true; break; } }
        const fe = functionBody(isMethod, t.line).single;
        if (path.length === 0) { const st = setVar(first); return (a) => { st(a, fe(a)); return undefined; }; }
        const base = getVar(first);
        return (a) => {
          let o = base(a);
          for (let i = 0; i < path.length - 1; i++) o = L.index(o, path[i]);
          L.setindex(o, path[path.length - 1], fe(a));
          return undefined;
        };
        void target;
      }
      case 'local': {
        p++;
        if (accept('function')) {
          const nm = nameTok();
          const slot = fs.declare(nm);
          const fe = functionBody(false, t.line).single;
          return (a) => { a.slots[slot] = new Box(undefined); a.slots[slot].v = fe(a); return undefined; };
        }
        const names = [nameTok()];
        while (accept(',')) names.push(nameTok());
        let list: Multi = () => [];
        if (accept('=')) list = exprList();
        const slots = names.map((n) => fs.declare(n));    // (declared after the expressions are compiled: they do not see the new locals)
        return (a) => {
          const vals = list(a);
          for (let i = 0; i < slots.length; i++) a.slots[slots[i]] = new Box(vals[i]);
          return undefined;
        };
      }
      default: {
        // assignment or call
        const e = suffixedExp();
        if (peek() === '=' || peek() === ',') {
          const targets: ((a: Act, v: LuaValue) => void)[] = [];
          const addTarget = (ex: { kind: string; base?: Expr; key?: Expr; name?: string }): void => {
            if (ex.kind === 'var') { const st = setVar(ex.name!); targets.push(st); }
            else { const b = ex.base!, k = ex.key!; targets.push(() => undefined); void b; void k; }
          };
          void addTarget;
          // re-parse the target list: the first one was already parsed as an expression, so it is rebuilt from the tokens
          p = startOfStatement(t);
          const tlist: { set: (a: Act, v: LuaValue) => void; prep?: (a: Act) => (v: LuaValue) => void }[] = [];
          const parseTarget = (): void => {
            const nm = toks[p];
            if (nm.t !== 'name') err('syntax error');
            p++;
            let cur: Expr = getVar(nm.v);
            let lastBase: Expr | null = null, lastKey: Expr | null = null;
            let plain: string | null = nm.v;
            for (;;) {
              if (peek() === '.') { p++; const k = nameTok(); lastBase = cur; const kk = k; lastKey = () => kk; const b = cur; cur = (a) => L.index(b(a), kk); plain = null; }
              else if (peek() === '[') { p++; const k = expr(0).single; expect(']'); lastBase = cur; lastKey = k; const b = cur; cur = (a) => L.index(b(a), k(a)); plain = null; }
              else if (peek() === ':' || peek() === '(' || peek() === 'string' || peek() === '{') {
                // a call inside the target (f().x = ...): only the part before the last index counts
                if (peek() === ':') { p++; const m = nameTok(); const args = callArgs(); const b = cur; cur = (a) => { const o = b(a); return L.call1(L.index(o, m), o, ...args(a)); }; }
                else { const args = callArgs(); const b = cur; cur = (a) => L.call1(b(a), ...args(a)); }
                plain = null; lastBase = null; lastKey = null;
              } else break;
            }
            if (plain !== null) { const st = setVar(plain); tlist.push({ set: st }); }
            else if (lastBase && lastKey) { const lb = lastBase, lk = lastKey; tlist.push({ set: () => undefined, prep: (a) => { const o = lb(a), k = lk(a); return (v) => L.setindex(o, k, v); } }); }
            else err('syntax error');
          };
          parseTarget();
          while (accept(',')) parseTarget();
          expect('=');
          const vals = exprList();
          return (a) => {
            const setters = tlist.map((tg) => (tg.prep ? tg.prep(a) : (v: LuaValue) => tg.set(a, v)));
            const vs = vals(a);
            for (let i = 0; i < setters.length; i++) setters[i](vs[i]);
            return undefined;
          };
        }
        if (!e.multi) err('syntax error');
        const m = e.multi!;
        return (a) => { m(a); return undefined; };
      }
    }
  }
  const startOfStatement = (tok: Tok): number => toks.indexOf(tok);

  const main = block();
  if (peek() !== 'eof') err("'<eof>' expected");
  const nslots = fs.nslots;
  const fn: NativeFunction = (...args: LuaValue[]) => {
    const act = new Act(null);
    for (let i = 0; i < nslots; i++) act.slots[i] = new Box(undefined);
    act.varargs = args;
    const r = main(act);
    return r !== undefined && typeof r === 'object' ? r.ret : undefined;
  };
  void numToStr;
  return fn;
}
