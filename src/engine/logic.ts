// Logic nodes, components and entities (the update side of the engine)
import { LuaTable, LuaClosure, LuaError, type LuaValue } from '../lua/value';
import type { LuaState } from '../lua/vm';
import { LObj, NATIVE } from './luabind';
import { Vec2 } from './scene';

/** milliseconds that every logic update adds to the clock (the waits count in these steps: wait(1000) fires at the 31st update) */
export const TICK_MS = 33;

/** what a node can hold: a component (a Lua object or a native one) */
export interface ComponentRef {
  lua(): LuaValue;
  idOf(): string;
  setParent(e: Entity | null): void;
  start(): void;
  addToGame(): void;
  removeFromGame(): void;
  update(): void;
}

let LUA: LuaState;
export function setLua(L: LuaState): void { LUA = L; }
export function lua(): LuaState { return LUA; }

/** a component written in Lua (`class "X" (Component)`): the engine part of the instance */
export class LuaComponent implements ComponentRef {
  parent: Entity | null = null;
  constructor(public inst: LuaTable) {}
  lua(): LuaValue { return this.inst; }
  idOf(): string { const v = this.inst.get('id'); return typeof v === 'string' ? v : ''; }
  setParent(e: Entity | null): void { this.parent = e; this.inst.set('parent', e ?? undefined); }
  private call(name: string): void {
    const f = LUA.index(this.inst, name);
    if (f !== undefined) LUA.callArr(f, [this.inst]);
  }
  start(): void { this.call('start'); }
  addToGame(): void { this.call('add_to_game'); }
  removeFromGame(): void { this.call('remove_from_game'); }
  update(): void { this.call('update'); }
}

/** a component implemented by the engine (render, collidable, trigger...): it is a Lua-visible object itself */
export abstract class NativeComponent extends LObj implements ComponentRef {
  parent: Entity | null = null;
  compId = '';
  lua(): LuaValue { return this; }
  idOf(): string { return this.compId; }
  setParent(e: Entity | null): void { this.parent = e; }
  start(): void { /* nothing */ }
  addToGame(): void { /* nothing */ }
  removeFromGame(): void { /* nothing */ }
  update(): void { /* nothing */ }
}
LObj.bind(NativeComponent, {
  get: { id: (s: NativeComponent) => s.compId, parent: (s: NativeComponent) => s.parent ?? undefined },
  set: { id: (s: NativeComponent, v) => { s.compId = String(v ?? ''); } },
  methods: {
    add_to_game: (s: NativeComponent) => { s.addToGame(); },
    remove_from_game: (s: NativeComponent) => { s.removeFromGame(); },
    start: (s: NativeComponent) => { s.start(); },
    update: (s: NativeComponent) => { s.update(); },
    clone: (s: NativeComponent) => s,
    object_id: (s: NativeComponent) => objectId(s),
  },
});

let oid = 1;
const oids = new WeakMap<object, number>();
export function objectId(o: object): number { let v = oids.get(o); if (!v) { v = oid++; oids.set(o, v); } return v; }

/** the Lua-visible value (a Lua instance or a native object) -> its engine part */
export function componentOf(v: LuaValue): ComponentRef {
  if (v instanceof NativeComponent) return v;
  if (v instanceof LuaTable) {
    const n = (v as any)[NATIVE];
    if (n) return n as ComponentRef;
  }
  throw new LuaError(LUA.where() + 'a component was expected');
}

// ============================================================================================================================================ logic
export class LogicWait extends LObj {
  static luaName = 'LogicWait';
  elapsed = 0;
  cancelled = false;
  id = '';
  constructor(public ms: number, public cb: LuaValue) { super(); }
}
LObj.bind(LogicWait, {
  get: { id: (s: LogicWait) => s.id },
  set: { id: (s: LogicWait, v) => { s.id = String(v ?? ''); } },
  methods: { cancel: (s: LogicWait) => { s.cancelled = true; } },
});

type Item = LogicNode | ComponentRef;

export class LogicNode extends LObj {
  static luaName = 'LogicNode';
  items: Item[] = [];
  waits: LogicWait[] = [];
  paused = false;
  posts: { detect(): void }[] = [];       // triggers: they look for overlaps after the components of the node have updated
  removed: Set<Item> | null = null;       // items taken out while the node is updating

  add(i: Item): void { if (!this.items.includes(i)) this.items.push(i); }
  remove(i: Item): void {
    const k = this.items.indexOf(i);
    if (k >= 0) this.items.splice(k, 1);
    if (this.removed !== null) this.removed.add(i);
  }

  addPost(t: { detect(): void }): void { if (!this.posts.includes(t)) this.posts.push(t); }
  removePost(t: { detect(): void }): void { const k = this.posts.indexOf(t); if (k >= 0) this.posts.splice(k, 1); }

  update(): void {
    if (this.paused) return;
    const snapshot = this.items.slice();
    this.removed = new Set();
    try {
      for (let i = 0; i < snapshot.length; i++) {
        const it = snapshot[i];
        if (this.removed.has(it)) continue;
        if (it instanceof LogicNode) it.update(); else it.update();
      }
    } finally { this.removed = null; }
    for (const t of this.posts.slice()) t.detect();
    // the waits: they go after the components; the ones created by a callback are processed in the same pass
    for (let i = 0; i < this.waits.length; i++) {
      const w = this.waits[i];
      if (w.cancelled) { this.waits.splice(i--, 1); continue; }
      w.elapsed += TICK_MS;
      if (w.elapsed >= w.ms) {
        this.waits.splice(i--, 1);
        LUA.callArr(w.cb, []);
      }
    }
  }
}
LObj.bind(LogicNode, {
  methods: {
    add_component: (s: LogicNode, c) => { s.add(componentOf(c)); },
    remove_component: (s: LogicNode, c) => { s.remove(componentOf(c)); },
    add_updatable: (s: LogicNode, n) => { if (n instanceof LogicNode) s.add(n); },
    remove_updatable: (s: LogicNode, n) => { if (n instanceof LogicNode) s.remove(n); },
    pause: (s: LogicNode) => { s.paused = true; },
    resume: (s: LogicNode) => { s.paused = false; },
    wait: (s: LogicNode, ms, cb) => { const w = new LogicWait(Number(ms), cb); s.waits.push(w); return w; },
  },
});

// ============================================================================================================================================ entities & stages
export class Entity extends LObj {
  static luaName = 'Entity';
  p = new Vec2();
  dir = new Vec2();
  lastP = new Vec2();
  lastDir = new Vec2();
  comps: ComponentRef[] = [];
  inGame = false;
  constructor(public id: string, public stage: Stage) { super(); }
  addComponent(c: ComponentRef): void {
    if (!this.comps.includes(c)) this.comps.push(c);
    c.setParent(this);
    c.start();
  }
  addToGame(): void { this.inGame = true; for (const c of this.comps.slice()) c.addToGame(); }
  removeFromGame(): void { for (const c of this.comps.slice()) c.removeFromGame(); this.inGame = false; }
}
LObj.bind(Entity, {
  get: {
    id: (s: Entity) => s.id, p: (s: Entity) => s.p, dir: (s: Entity) => s.dir, last_p: (s: Entity) => s.lastP, last_dir: (s: Entity) => s.lastDir,
    game: () => GAME_REF.game,
  },
  set: {
    p: (s: Entity, v) => { const q = Vec2.of(v); s.p.x = q.x; s.p.y = q.y; },
    dir: (s: Entity, v) => { const q = Vec2.of(v); s.dir.x = q.x; s.dir.y = q.y; },
    id: (s: Entity, v) => { s.id = String(v ?? ''); },
  },
  methods: {
    add_component: (s: Entity, c) => { s.addComponent(componentOf(c)); },
    get_component: (s: Entity, id) => { for (const c of s.comps) if (c.idOf() === id) return c.lua(); return undefined; },
    add_to_game: (s: Entity) => { s.addToGame(); },
    remove_from_game: (s: Entity) => { s.removeFromGame(); },
    get_pos_reference: (s: Entity) => s.p,
  },
});

export const GAME_REF: { game: any } = { game: null };

export interface AssetStorageLike { }

export class Stage extends LObj {
  static luaName = 'Stage';
  entities: Entity[] = [];
  children: Stage[] = [];
  inGame = false;
  assetStorage: LObj;
  constructor(public id: string, makeStorage: (stage: Stage) => LObj) { super(); this.assetStorage = makeStorage(this); }
  createEntity(name: string): Entity { const e = new Entity(name, this); this.entities.push(e); return e; }
  addToGame(): void { this.inGame = true; for (const e of this.entities.slice()) e.addToGame(); }
  removeFromGame(): void { for (const e of this.entities.slice()) e.removeFromGame(); this.inGame = false; }
}
