// What the original engine exposed to Lua with luabind: native objects, native classes that Lua classes derive from, and the Lua-side `class` function.
import { LuaTable, LuaClosure, LuaError, Userdata, NIL1, type LuaValue, type NativeFunction } from '../lua/value';
import type { LuaState } from '../lua/vm';

export type Method = (self: any, ...args: LuaValue[]) => LuaValue;

interface Members {
  methods: Record<string, Method>;
  get: Record<string, (self: any) => LuaValue>;
  set: Record<string, (self: any, v: LuaValue) => void>;
}

/** an object of the host seen from Lua. Properties and methods are declared on the JS class with `bind`; any other field a script writes is kept in `fields` */
export class LObj extends Userdata {
  fields: LuaTable | null = null;
  static members: Members = { methods: {}, get: {}, set: {} };
  static bind(cls: typeof LObj, spec: Partial<Members>): void {
    // every class has its own table that inherits from the one of its parent class
    if (!Object.prototype.hasOwnProperty.call(cls, 'members')) {
      const parent = (Object.getPrototypeOf(cls) as typeof LObj).members;
      cls.members = { methods: Object.create(parent.methods), get: Object.create(parent.get), set: Object.create(parent.set) };
    }
    Object.assign(cls.members.methods, spec.methods ?? {});
    Object.assign(cls.members.get, spec.get ?? {});
    Object.assign(cls.members.set, spec.set ?? {});
  }
  private get M(): Members { return (this.constructor as typeof LObj).members; }
  lget(key: LuaValue): LuaValue {
    if (typeof key === 'string') {
      const m = this.M;
      const g = m.get[key];
      if (g !== undefined) return g(this);
      const f = m.methods[key];
      if (f !== undefined) return f;
    }
    return this.fields === null ? undefined : this.fields.get(key);
  }
  lset(key: LuaValue, value: LuaValue): void {
    if (typeof key === 'string') {
      const s = this.M.set[key];
      if (s !== undefined) { s(this, value); return; }
    }
    if (this.fields === null) this.fields = new LuaTable();
    this.fields.set(key, value);
  }
  tostring(): string { return `${(this.constructor as any).luaName ?? 'userdata'}: 0x${(0x30000000 + objId(this) * 16).toString(16)}`; }
}
const ids = new WeakMap<object, number>();
let idc = 1;
export function objId(o: object): number { let v = ids.get(o); if (!v) { v = idc++; ids.set(o, v); } return v; }

/** the `native` part of an instance of a Lua class that derives from a native class */
export const NATIVE = '__native';

export class Luabind {
  constructor(public L: LuaState) {}

  /** a table that works as a native base class for `class("X")(Base)`: its methods and its constructor (`Base.__init(self, ...)`) are native */
  nativeBase(name: string, init: (self: LuaTable, ...args: LuaValue[]) => void, methods: Record<string, Method> = {}, getters: Record<string, (self: LuaTable) => LuaValue> = {}): LuaTable {
    const C = new LuaTable();
    C.set('__name', name);
    C.set('__init', ((self: LuaTable, ...a: LuaValue[]) => { init(self, ...a); }) as NativeFunction);
    for (const [k, f] of Object.entries(methods)) C.set(k, f as NativeFunction);
    (C as any).isClass = true;
    (C as any).nativeGetters = getters;
    this.setupClassTable(C, null);
    this.L.globals.set(name, C);
    return C;
  }

  /** the metatable machinery of a class table: calling it makes an instance; indexing an instance finds fields, methods of the class chain and native properties */
  setupClassTable(C: LuaTable, base: LuaTable | null): void {
    const L = this.L;
    const meta = new LuaTable();
    (C as any).base = base;
    meta.set('__call', ((cls: LuaTable, ...args: LuaValue[]) => {
      const inst = new LuaTable();
      inst.meta = instanceMeta(cls);
      const init = L.index(cls, '__init');
      if (init !== undefined) L.callArr(init, [inst, ...args]);
      return inst;
    }) as NativeFunction);
    meta.set('__index', ((cls: LuaTable, key: LuaValue) => {
      // members of the base classes
      for (let b = (cls as any).base as LuaTable | null; b; b = (b as any).base) {
        const v = b.get(key);
        if (v !== undefined) return v;
      }
      return undefined;
    }) as NativeFunction);
    C.meta = meta;
    const inheritedMeta = base ? (base as any).instMeta as LuaTable | undefined : undefined;
    void inheritedMeta;
    const instMeta = new LuaTable();
    (C as any).instMeta = instMeta;
    // instances: field -> class chain -> native property getters of the bases
    instMeta.set('__index', ((inst: LuaTable, key: LuaValue) => {
      for (let c: LuaTable | null = C; c; c = (c as any).base) {
        const v = c.get(key);
        if (v !== undefined) return v;
        const g = (c as any).nativeGetters?.[key as string];
        if (g !== undefined) return g(inst);
      }
      return undefined;
    }) as NativeFunction);
    // metamethods defined in the class (or inherited): the instance metatable must have them directly
    syncMeta(C);
  }

  /** `class "Name" (Base)` */
  install(): void {
    const L = this.L;
    L.globals.set('class', ((name: string) => {
      const env = callerEnv(L);
      const C = new LuaTable();
      C.set('__name', name);
      (C as any).isClass = true;
      this.setupClassTable(C, null);
      env.set(name, C);
      const stage2 = ((_stage: any, ...bases: LuaTable[]) => {
        const first = bases.length ? bases[0] : null;
        if (first !== null && !(first instanceof LuaTable)) throw new LuaError(L.where() + 'class: base must be a class');
        (C as any).base = first;
        for (let i = 1; i < bases.length; i++) throw new LuaError(L.where() + 'multiple inheritance is not supported');
        syncMeta(C);
        return C;
      }) as NativeFunction;
      // `class "X"` alone returns something that can still be called with the bases; the table itself is already registered
      const proxy = new LuaTable();
      const pm = new LuaTable();
      pm.set('__call', stage2 as NativeFunction);
      pm.set('__index', ((_p: LuaTable, k: LuaValue) => C.get(k)) as NativeFunction);
      proxy.meta = pm;
      return proxy;
    }) as NativeFunction);
  }
}

function callerEnv(L: LuaState): LuaTable {
  const fr = L.cur.frames;
  const f = fr[fr.length - 1];
  return f ? f.cl.env : L.globals;
}

const META_EVENTS = ['__add', '__sub', '__mul', '__div', '__mod', '__pow', '__unm', '__concat', '__eq', '__lt', '__le', '__call', '__tostring', '__len'];
/** metamethods are looked up directly in the instance metatable: copy those that the class chain defines */
export function syncMeta(C: LuaTable): void {
  const im = (C as any).instMeta as LuaTable | undefined;
  if (!im) return;
  for (const ev of META_EVENTS) {
    let v: LuaValue;
    for (let c: LuaTable | null = C; c && v === undefined; c = (c as any).base) v = c.get(ev);
    im.set(ev, v);
  }
}

function instanceMeta(cls: LuaTable): LuaTable {
  const im = (cls as any).instMeta as LuaTable;
  syncMeta(cls);                 // (methods like __tostring are usually defined after the `class` call)
  return im;
}

export { NIL1, LuaClosure };
