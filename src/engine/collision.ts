// Collision shapes, the tile collision map, the collision system (collide / slide / stop / push) and the triggers.
// The numbers (1 unit of skin, tile shapes, push factors) were measured in the original engine with research/probe/probe_{tiles,collide,push*,trigger}.lua
import { LuaTable, type LuaValue } from '../lua/value';
import { LObj } from './luabind';
import { Vec2, num } from './scene';
import { NativeComponent, Entity, lua } from './logic';
import type { LogicNode } from './logic';

export interface Rect { x0: number; y0: number; x1: number; y1: number }

// ============================================================================================================================================ shapes
export abstract class Shape extends LObj {
  static luaName = 'Shape';
  abstract aabb(): Rect;
}
LObj.bind(Shape, { methods: { get_AABB: (s: Shape) => { const r = s.aabb(); return new AABB(r.x0, r.y0, r.x1, r.y1); } } });

export class AABB extends Shape {
  static luaName = 'AABB';
  constructor(public min_x = 0, public min_y = 0, public max_x = 0, public max_y = 0) { super(); }
  /** AABB(w, h) is centered on the origin; AABB(x0, y0, x1, y1) is explicit */
  static make(a: LuaValue[]): AABB {
    if (a.length >= 4) return new AABB(num(a[0]), num(a[1]), num(a[2]), num(a[3]));
    if (a.length >= 2) { const w = num(a[0]), h = num(a[1]); return new AABB(-w / 2, -h / 2, w / 2, h / 2); }
    return new AABB();
  }
  aabb(): Rect { return { x0: this.min_x, y0: this.min_y, x1: this.max_x, y1: this.max_y }; }
}
LObj.bind(AABB, {
  get: {
    min_x: (s: AABB) => s.min_x, min_y: (s: AABB) => s.min_y, max_x: (s: AABB) => s.max_x, max_y: (s: AABB) => s.max_y,
    width: (s: AABB) => s.max_x - s.min_x, height: (s: AABB) => s.max_y - s.min_y,
  },
  set: {
    min_x: (s: AABB, v) => { s.min_x = num(v); }, min_y: (s: AABB, v) => { s.min_y = num(v); },
    max_x: (s: AABB, v) => { s.max_x = num(v); }, max_y: (s: AABB, v) => { s.max_y = num(v); },
  },
});

export class Polygon extends Shape {
  static luaName = 'Polygon';
  verts: { x: number; y: number }[] = [];
  constructor(v?: LuaValue) {
    super();
    if (v instanceof LuaTable) for (let i = 1; i <= v.length(); i++) this.verts.push(Vec2.of(v.get(i)));
  }
  aabb(): Rect {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of this.verts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    return this.verts.length ? { x0, y0, x1, y1 } : { x0: 0, y0: 0, x1: 0, y1: 0 };
  }
}
LObj.bind(Polygon, { get: { vertices: (s: Polygon) => { const t = new LuaTable(); s.verts.forEach((p, i) => t.set(i + 1, new Vec2(p.x, p.y))); return t; } } });

// ============================================================================================================================================ the tile map
export const TILE = 30;
type Pt = [number, number];
/** solid area of each tile type of the "collisions" tileset, in cell coordinates (measured in the original) */
const TILE_POLYS: Record<number, Pt[]> = {
  1: [[0, 0], [30, 0], [30, 30], [0, 30]],
  2: [[30, 0], [30, 30], [0, 30]],          // x + y >= 30
  3: [[0, 0], [30, 30], [0, 30]],           // x <= y
  4: [[0, 0], [30, 0], [30, 30]],           // x >= y
  5: [[0, 0], [30, 0], [0, 30]],            // x + y <= 30
};

/** a convex solid in world coordinates; `rect` is set when it is an axis aligned box */
export interface Solid { pts: Pt[]; rect: Rect | null }

export class CollisionMap extends Shape {
  static luaName = 'CollisionMap';
  constructor(public cols: number, public rows: number, public tiles: Uint8Array) { super(); }
  aabb(): Rect { return { x0: 0, y0: 0, x1: this.cols * TILE, y1: this.rows * TILE }; }
  /** the solids of the cells that touch `r` (a world rect), for a map placed at (ox, oy) */
  solids(r: Rect, ox: number, oy: number, out: Solid[]): void {
    const c0 = Math.max(0, Math.floor((r.x0 - ox) / TILE)), c1 = Math.min(this.cols - 1, Math.floor((r.x1 - ox) / TILE));
    const r0 = Math.max(0, Math.floor((r.y0 - oy) / TILE)), r1 = Math.min(this.rows - 1, Math.floor((r.y1 - oy) / TILE));
    for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) {
      const t = this.tiles[cy * this.cols + cx];
      if (t === 0) continue;
      const poly = TILE_POLYS[t];
      if (!poly) continue;
      const bx = ox + cx * TILE, by = oy + cy * TILE;
      out.push({ pts: poly.map(([x, y]) => [bx + x, by + y] as Pt), rect: t === 1 ? { x0: bx, y0: by, x1: bx + TILE, y1: by + TILE } : null });
    }
  }
}
LObj.bind(CollisionMap, { get: { width: (s: CollisionMap) => s.cols, height: (s: CollisionMap) => s.rows } });

// ============================================================================================================================================ geometry
function rectSolid(r: Rect): Solid { return { pts: [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]], rect: r }; }

/** strict overlap of a rect and a convex solid (touching is not overlapping) */
function overlaps(a: Rect, s: Solid): boolean {
  if (s.rect) { const b = s.rect; return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0; }
  const pa: Pt[] = [[a.x0, a.y0], [a.x1, a.y0], [a.x1, a.y1], [a.x0, a.y1]];
  // axes: the x and y axes and the edge normals of the solid
  const axes: Pt[] = [[1, 0], [0, 1]];
  for (let i = 0; i < s.pts.length; i++) {
    const p = s.pts[i], q = s.pts[(i + 1) % s.pts.length];
    axes.push([q[1] - p[1], -(q[0] - p[0])]);
  }
  for (const [ax, ay] of axes) {
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const p of pa) { const v = p[0] * ax + p[1] * ay; if (v < a0) a0 = v; if (v > a1) a1 = v; }
    for (const p of s.pts) { const v = p[0] * ax + p[1] * ay; if (v < b0) b0 = v; if (v > b1) b1 = v; }
    if (a1 <= b0 + 1e-9 || b1 <= a0 + 1e-9) return false;
  }
  return true;
}

export interface Hit { t: number; nx: number; ny: number }

/** first contact of the box `a` moving by (dx, dy) against a convex solid: t in [0, 1) and the surface normal, or null.
 *  The original does a separating-axis sweep over the x and y axes and the normals of the edges of the solid; an axis on which the two shapes already overlap
 *  does not limit the movement at all (so a box that overlaps a tile in x at the start can still hit its bottom side after it has moved away in x). */
export function sweep(a: Rect, dx: number, dy: number, s: Solid): Hit | null {
  const pa: Pt[] = [[a.x0, a.y0], [a.x1, a.y0], [a.x1, a.y1], [a.x0, a.y1]];
  const axes: Pt[] = [[1, 0], [0, 1]];
  if (!s.rect) {
    for (let i = 0; i < s.pts.length; i++) {
      const p = s.pts[i], q = s.pts[(i + 1) % s.pts.length];
      const ex = q[0] - p[0], ey = q[1] - p[1];
      if (ex !== 0 && ey !== 0) { const l = Math.hypot(ex, ey); axes.push([ey / l, -ex / l]); }
    }
  }
  let tIn = -Infinity, tOut = Infinity, nx = 0, ny = 0;
  for (const [ax, ay] of axes) {
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const p of pa) { const v = p[0] * ax + p[1] * ay; if (v < a0) a0 = v; if (v > a1) a1 = v; }
    for (const p of s.pts) { const v = p[0] * ax + p[1] * ay; if (v < b0) b0 = v; if (v > b1) b1 = v; }
    if (a0 < b1 - 1e-9 && b0 < a1 - 1e-9) continue;               // overlapping on this axis: no limit
    const v = dx * ax + dy * ay;
    if (Math.abs(v) < 1e-12) return null;
    let enter: number, exit: number, sgn: number;
    if (a1 <= b0 + 1e-9) { if (v < 0) return null; enter = (b0 - a1) / v; exit = (b1 - a0) / v; sgn = -1; }
    else { if (v > 0) return null; enter = (b1 - a0) / v; exit = (b0 - a1) / v; sgn = 1; }
    if (enter > tIn) { tIn = enter; nx = ax * sgn; ny = ay * sgn; }
    if (exit < tOut) tOut = exit;
  }
  if (tIn === -Infinity || tIn >= tOut || tIn >= 1 - 1e-9 || tOut <= 0) return null;
  return { t: Math.max(0, tIn), nx, ny };
}

// ============================================================================================================================================ collidables
let collidableIds = 1;
export class Collidable extends LObj {
  static luaName = 'Collidable';
  id = collidableIds++;
  category = -1;
  mask = -1;
  pos: Vec2 | null = null;
  shape: Shape | null = null;
  owner: CollidableComponent | null = null;
  /** world rect */
  rect(): Rect {
    const r = this.shape ? this.shape.aabb() : { x0: 0, y0: 0, x1: 0, y1: 0 };
    const p = this.pos;
    return p ? { x0: r.x0 + p.x, y0: r.y0 + p.y, x1: r.x1 + p.x, y1: r.y1 + p.y } : r;
  }
  /** the solids this collidable offers to the others */
  solids(r: Rect, out: Solid[]): void {
    const p = this.pos;
    if (!p || !this.shape) return;
    if (this.shape instanceof CollisionMap) this.shape.solids(r, p.x, p.y, out);
    else out.push(rectSolid(this.rect()));
  }
}
LObj.bind(Collidable, {
  get: {
    id: (s: Collidable) => s.id, category: (s: Collidable) => s.category, mask: (s: Collidable) => s.mask,
    pos: (s: Collidable) => s.pos ?? undefined, shape: (s: Collidable) => s.shape ?? undefined,
  },
  set: {
    category: (s: Collidable, v) => { s.category = num(v) | 0; }, mask: (s: Collidable, v) => { s.mask = num(v) | 0; },
  },
  methods: {
    set_pos: (s: Collidable, p) => { s.pos = p instanceof Vec2 ? p : null; },
    set_shape: (s: Collidable, sh) => { s.shape = sh instanceof Shape ? sh : null; },
  },
});

export class Collision extends LObj {
  static luaName = 'Collision';
  constructor(public other: Collidable) { super(); }
}
LObj.bind(Collision, { get: { collidable: (s: Collision) => s.other } });

export const SKIN = 1;
const MAX_ITER = 4;

export class CollisionSystem extends LObj {
  static luaName = 'CollisionSystem';
  list: Collidable[] = [];
  add(c: Collidable): void { if (!this.list.includes(c)) this.list.push(c); }
  remove(c: Collidable): void { const i = this.list.indexOf(c); if (i >= 0) this.list.splice(i, 1); }

  private relevant(c: Collidable, area: Rect, out: Solid[], owners?: (Collidable | null)[]): void {
    for (const o of this.list) {
      if (o === c || !o.pos || (c.mask & o.category) === 0) continue;
      const before = out.length;
      o.solids(area, out);
      if (owners) for (let i = before; i < out.length; i++) owners.push(o);
    }
  }

  collide(c: Collidable): LuaTable {
    const res = new LuaTable();
    if (!c.pos) return res;
    const r = c.rect();
    let n = 0;
    for (const o of this.list) {
      if (o === c || !o.pos || (c.mask & o.category) === 0) continue;
      const solids: Solid[] = [];
      o.solids(r, solids);
      if (solids.some(s => overlaps(r, s))) res.set(++n, new Collision(o));
    }
    return res;
  }

  /** the first contact of c moving by (dx, dy): the hit, the solid's owner */
  firstHit(c: Collidable, dx: number, dy: number): { hit: Hit; owner: Collidable } | null {
    const r = c.rect();
    const area: Rect = { x0: Math.min(r.x0, r.x0 + dx) - 1, y0: Math.min(r.y0, r.y0 + dy) - 1, x1: Math.max(r.x1, r.x1 + dx) + 1, y1: Math.max(r.y1, r.y1 + dy) + 1 };
    const solids: Solid[] = [];
    const owners: (Collidable | null)[] = [];
    this.relevant(c, area, solids, owners);
    let best: { hit: Hit; owner: Collidable } | null = null;
    for (let i = 0; i < solids.length; i++) {
      const h = sweep(r, dx, dy, solids[i]);
      if (h && (best === null || h.t < best.hit.t)) best = { hit: h, owner: owners[i]! };
    }
    return best;
  }

  /** a collidable that starts inside something moves freely (the original does not try to get it out) */
  stuck(c: Collidable): boolean { return this.collide(c).length() > 0; }

  /** moves c by (dx, dy) sliding along what it touches; returns the displacement that happened */
  slide(c: Collidable, dx: number, dy: number): Vec2 {
    const p = c.pos;
    if (!p) return new Vec2(0, 0);
    const sx = p.x, sy = p.y;
    if (this.stuck(c)) { p.x = Math.fround(p.x + dx); p.y = Math.fround(p.y + dy); return new Vec2(dx, dy); }
    for (let it = 0; it < MAX_ITER && (dx !== 0 || dy !== 0); it++) {
      const f = this.firstHit(c, dx, dy);
      if (!f) { p.x = Math.fround(p.x + dx); p.y = Math.fround(p.y + dy); break; }
      const { t, nx, ny } = f.hit;
      const len = Math.hypot(dx, dy);
      const back = Math.min(SKIN, t * len);     // it never goes back further than where it started
      p.x = Math.fround(p.x + dx * t - (dx / len) * back);
      p.y = Math.fround(p.y + dy * t - (dy / len) * back);
      let rx = dx * (1 - t), ry = dy * (1 - t);
      const dn = rx * nx + ry * ny;
      rx -= nx * dn; ry -= ny * dn;
      dx = rx; dy = ry;
    }
    return new Vec2(Math.fround(p.x - sx), Math.fround(p.y - sy));
  }

  /** moves c by (dx, dy) and stops at the first contact: true if it hit something */
  stop(c: Collidable, dx: number, dy: number): boolean {
    const p = c.pos;
    if (!p) return false;
    const f = this.stuck(c) ? null : this.firstHit(c, dx, dy);
    if (!f) { p.x = Math.fround(p.x + dx); p.y = Math.fround(p.y + dy); return false; }
    const len = Math.hypot(dx, dy);
    const back = Math.min(SKIN, f.hit.t * len);
    p.x = Math.fround(p.x + dx * f.hit.t - (dx / len) * back);
    p.y = Math.fround(p.y + dy * f.hit.t - (dy / len) * back);
    return true;
  }

  /** the player moves by (dx, dy) pushing a PushableComponent entity it touches. The factors are fitted to the original (probe_push*): while the gap g to the box
   *  is below a third of the push d the player advances d/4 and the box (5d - 7g)/16; otherwise the player advances d/2 and the box (d - g)/4 */
  push(c: Collidable, dx: number, dy: number): boolean {
    const p = c.pos;
    if (!p) return false;
    const f = this.stuck(c) ? null : this.firstHit(c, dx, dy);
    if (!f) { p.x = Math.fround(p.x + dx); p.y = Math.fround(p.y + dy); return false; }
    const owner = f.owner.owner;
    const pushable = owner && owner.parent ? owner.parent.comps.some(k => k instanceof PushableComponent) : false;
    if (!pushable || !owner) {
      const len = Math.hypot(dx, dy);
      const back = Math.min(SKIN, f.hit.t * len);
      p.x = Math.fround(p.x + dx * f.hit.t - (dx / len) * back);
      p.y = Math.fround(p.y + dy * f.hit.t - (dy / len) * back);
      const rx = dx * (1 - f.hit.t), ry = dy * (1 - f.hit.t);
      const dn = rx * f.hit.nx + ry * f.hit.ny;
      this.slide(c, rx - f.hit.nx * dn, ry - f.hit.ny * dn);
      return false;
    }
    const d = Math.abs(dx * f.hit.nx + dy * f.hit.ny);     // push along the contact normal
    const g = f.hit.t * d;
    let pf: number, bd: number;
    if (3 * g < d) { pf = 0.25; bd = (5 * d - 7 * g) / 16; } else { pf = 0.5; bd = (d - g) / 4; }
    // the box moves against the normal of the contact
    this.slide(f.owner, -f.hit.nx * bd, -f.hit.ny * bd);
    this.slide(c, dx * pf, dy * pf);
    return true;
  }
}
LObj.bind(CollisionSystem, {
  methods: {
    add_collidable: (s: CollisionSystem, c) => { if (c instanceof Collidable) s.add(c); },
    remove_collidable: (s: CollisionSystem, c) => { if (c instanceof Collidable) s.remove(c); },
    collide: (s: CollisionSystem, c) => (c instanceof Collidable ? s.collide(c) : new LuaTable()),
    collide_and_slide: (s: CollisionSystem, c, d) => { const v = Vec2.of(d); return c instanceof Collidable ? s.slide(c, v.x, v.y) : new Vec2(); },
    collide_and_stop: (s: CollisionSystem, c, d) => { const v = Vec2.of(d); return c instanceof Collidable ? s.stop(c, v.x, v.y) : false; },
  },
});

export const COLLISION: { sys: CollisionSystem } = { sys: new CollisionSystem() };

export class CollidableComponent extends NativeComponent {
  static luaName = 'CollidableComponent';
  collidable = new Collidable();
  constructor(shape: LuaValue) {
    super();
    this.compId = 'collidable';
    this.collidable.owner = this;
    if (shape instanceof Shape) this.collidable.shape = shape;
  }
  addToGame(): void {
    if (this.parent) this.collidable.pos = this.parent.p;
    COLLISION.sys.add(this.collidable);
  }
  removeFromGame(): void {
    this.collidable.pos = null;
    COLLISION.sys.remove(this.collidable);
  }
}
LObj.bind(CollidableComponent, {
  get: { collidable: (s: CollidableComponent) => s.collidable },
  methods: {
    set_category: (s: CollidableComponent, v) => { s.collidable.category = num(v) | 0; },
    set_mask: (s: CollidableComponent, v) => { s.collidable.mask = num(v) | 0; },
    collide_and_slide: (s: CollidableComponent, d) => { const v = Vec2.of(d); return COLLISION.sys.slide(s.collidable, v.x, v.y); },
    collide_and_stop: (s: CollidableComponent, d) => { const v = Vec2.of(d); return COLLISION.sys.stop(s.collidable, v.x, v.y); },
    collide_and_push: (s: CollidableComponent, d) => { const v = Vec2.of(d); return COLLISION.sys.push(s.collidable, v.x, v.y); },
  },
});

export class PushableComponent extends NativeComponent {
  static luaName = 'PushableComponent';
  constructor() { super(); this.compId = 'pushable'; }
}
LObj.bind(PushableComponent, {
  methods: {
    push: (s: PushableComponent, d) => {
      const c = s.parent?.comps.find(k => k instanceof CollidableComponent) as CollidableComponent | undefined;
      const v = Vec2.of(d);
      if (c) COLLISION.sys.slide(c.collidable, v.x, v.y);
    },
  },
});

// ============================================================================================================================================ triggers
const triggerables: Triggerable[] = [];

function worldRect(shape: Shape | null, e: Entity | null): Rect {
  const r = shape ? shape.aabb() : { x0: 0, y0: 0, x1: 0, y1: 0 };
  return e ? { x0: r.x0 + e.p.x, y0: r.y0 + e.p.y, x1: r.x1 + e.p.x, y1: r.y1 + e.p.y } : r;
}

/** an area that reports to the triggerables that enter and leave it. The detection happens after the components of its logic node have updated */
export class Trigger extends NativeComponent {
  static luaName = '_Trigger';
  constructor(public logic: LogicNode, public shape: Shape | null) { super(); this.compId = 'trigger'; }
  addToGame(): void { this.logic.addPost(this); }
  removeFromGame(): void { this.logic.removePost(this); }
  detect(): void {
    const r = worldRect(this.shape, this.parent);
    for (const tb of triggerables.slice()) {
      const inside = tb.inside.has(this);
      const now = tb.parent !== null && overlaps(worldRect(tb.shape, tb.parent), rectSolid(r));
      if (now && !inside) { tb.inside.add(this); tb.fire('enter', this); }
      else if (!now && inside) { tb.inside.delete(this); tb.fire('leave', this); }
    }
  }
}

export class Triggerable extends NativeComponent {
  static luaName = '_Triggerable';
  inside = new Set<Trigger>();
  constructor(public shape: Shape | null) { super(); this.compId = 'triggerable'; }
  addToGame(): void { if (!triggerables.includes(this)) triggerables.push(this); }
  removeFromGame(): void {
    const i = triggerables.indexOf(this);
    if (i >= 0) triggerables.splice(i, 1);
    this.inside.clear();
  }
  fire(name: 'enter' | 'leave', t: Trigger): void {
    const f = this.lget(name);
    if (f !== undefined) lua().callArr(f, [this, t]);
  }
}
LObj.bind(Triggerable, { get: { enter: (s: Triggerable) => s.fields?.get('enter'), leave: (s: Triggerable) => s.fields?.get('leave') } });

/** the constructors that Lua sees */
export const collisionGlobals: Record<string, (...a: LuaValue[]) => LuaValue> = {
  AABB: (...a) => AABB.make(a),
  Polygon: (v) => new Polygon(v),
  Collidable: () => new Collidable(),
  CollidableComponent: (shape) => new CollidableComponent(shape),
  PushableComponent: () => new PushableComponent(),
  _Trigger: (logic, shape) => new Trigger(logic as LogicNode, shape instanceof Shape ? shape : null),
  _Triggerable: (shape) => new Triggerable(shape instanceof Shape ? shape : null),
};
