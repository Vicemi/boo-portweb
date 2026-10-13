// The native part of the ghosts (TC::Ghost of the original): the movement AI, the choice of the animation direction and the helpers that ghost.lua calls.
// Reconstructed from the disassembly of the original (research/ghost_asm_annot.txt: Ghost::update, walk_movement, goto_position, getCardinal, changeAnim...).
// The Lua class `ghost` derives from GhostComponentBase; every attribute of the native class (state, type, speed, oldp, ...) is a plain field of the instance.
import { LuaTable, type LuaValue, type NativeFunction } from '../lua/value';
import { LObj } from './luabind';
import { Vec2, num } from './scene';
import { Entity, lua } from './logic';
import { CollidableComponent, COLLISION } from './collision';
import type { RenderComponent } from './anim';

/** the global `delta` of the original: 1 / 33 (seconds per logic step) as a float */
const DT = Math.fround(1 / 33);
const f32 = Math.fround;

const str = (v: LuaValue): string => (typeof v === 'string' ? v : '');
const vecOf = (s: LuaTable, k: string): Vec2 => { const v = s.get(k); return v instanceof Vec2 ? v : new Vec2(); };

/** the ghosts that repel each other (native_side:add_ghost / remove_ghost) */
export class NativeSide extends LObj {
  static luaName = 'LuaExtensions';
  ghosts: Entity[] = [];
}
LObj.bind(NativeSide, {
  methods: {
    add_ghost: (s: NativeSide, e) => { if (e instanceof Entity && !s.ghosts.includes(e)) s.ghosts.push(e); },
    remove_ghost: (s: NativeSide, e) => { const i = s.ghosts.indexOf(e as Entity); if (i >= 0) s.ghosts.splice(i, 1); },
  },
});
export const NATIVE_SIDE = new NativeSide();

function player(): Entity | null {
  const L = lua();
  const fn = L.globals.get('get_player');
  if (fn === undefined) return null;
  const r = L.callArr(fn, []);
  return r[0] instanceof Entity ? r[0] : null;
}

function setState(self: LuaTable, name: string): void {
  const L = lua();
  const fn = L.index(self, 'setState');
  if (fn !== undefined) L.callArr(fn, [self, name]);
}

/** moves the ghost to (x, y): through its collidable (sliding along walls) or directly */
function moveTo(self: LuaTable, e: Entity, x: number, y: number): void {
  const col = self.get('__collidable');
  if (col instanceof CollidableComponent) {
    const oldp = vecOf(self, 'oldp');
    COLLISION.sys.slide(col.collidable, f32(x - oldp.x), f32(y - oldp.y));
  } else { e.p.y = f32(y); e.p.x = f32(x); }
}

function setPosition(self: LuaTable, x: number, y: number): void {
  const e = self.get('parent') as Entity | undefined;
  if (e) moveTo(self, e, x, y);
}

function walkMovement(self: LuaTable): void {
  const e = self.get('parent') as Entity | undefined;
  if (!e) return;
  const speed = vecOf(self, 'speed'), repel = vecOf(self, 'repel_speed');
  let ttc = f32(num(self.get('timeToChangeDirection')) - DT);
  let sinSign = num(self.get('sinSign'));
  if (ttc < 0) { speed.x = f32(-speed.x); sinSign = f32(-sinSign); ttc = 2; self.set('sinSign', sinSign); }
  self.set('timeToChangeDirection', ttc);
  const x = e.p.x + speed.x * DT + repel.x;
  const y = 2 * Math.sin(sinSign * ttc) + e.p.y + repel.y;
  moveTo(self, e, x, y);
}

/** walks towards `target` (speed = 15000 * d / |d|^2, like the original); when it is closer than ~45 px it switches to `newState` */
function gotoPosition(self: LuaTable, tx: number, ty: number, newState: string): void {
  const e = self.get('parent') as Entity | undefined;
  if (!e) return;
  const dx = f32(tx - e.p.x), dy = f32(ty - e.p.y);
  const d2 = f32(dx * dx + dy * dy);
  if (d2 > 2000) {
    const speed = vecOf(self, 'speed'), repel = vecOf(self, 'repel_speed');
    speed.y = f32(dy / d2 * 150 * 100); speed.x = f32(100 * (dx / d2 * 150));
    moveTo(self, e, e.p.x + speed.x * DT + repel.x, e.p.y + speed.y * DT + repel.y);
  } else if (newState !== '') setState(self, newState);
}

function getCardinal(self: LuaTable): string {
  const e = self.get('parent') as Entity | undefined;
  if (!e) return 'e';
  const st = str(self.get('state'));
  if (st === 'scared' || st === 'damage' || st === 'S_DIE') {
    const pl = player();
    return pl && e.p.x > pl.p.x ? 'w' : 'e';
  }
  const oldp = vecOf(self, 'oldp');
  if (oldp.x > e.p.x && Math.abs(oldp.x - e.p.x) > 0.01) return 'w';
  return 'e';
}

function changeAnim(self: LuaTable, name: string, cb: LuaValue): void {
  self.set('currentAnim', name);
  const card = getCardinal(self);
  self.set('cardinal', card);
  const render = self.get('__render') as RenderComponent | undefined;
  const hasCb = cb !== undefined && cb !== false;
  self.set('animation_has_callback', hasCb);
  if (!render || typeof render.animator?.play !== 'function') return;
  const wrapped: LuaValue = hasCb ? ((() => { self.set('animation_has_callback', false); lua().callArr(cb, []); }) as NativeFunction) : undefined;
  render.animator.play(name + '_' + card, !hasCb, wrapped);
}

function canBeScared(self: LuaTable): boolean {
  const st = str(self.get('state'));
  return st !== 'S_DIE' && st !== 'freeze';
}
function canBeHurt(self: LuaTable): boolean {
  const st = str(self.get('state'));
  return st === 'walk' || st === 'S_CHASE' || st === 'S_PATROLLING' || st === 'S_PUTTING_BOMB' || st === 'scared' || st === 'GO_BACK_TO_ORIGIN';
}

/** the push that ghosts give each other so they do not pile up */
function calculateRepel(self: LuaTable): void {
  const e = self.get('parent') as Entity | undefined;
  if (!e) return;
  const rwc = vecOf(self, 'repel_when_close'), rs = vecOf(self, 'repel_speed');
  let rx = 0, ry = 0;
  for (const o of NATIVE_SIDE.ghosts) {
    if (o === e) continue;
    let ax = f32(e.p.x - o.p.x), ay = f32(e.p.y - o.p.y);
    const len2 = f32(ax * ax + ay * ay), len = Math.sqrt(len2);
    if (len2 < 0.01) { ax = rwc.x; ay = rwc.y; } else { ax = f32(ax / len); ay = f32(ay / len); }
    const k = 10000 / (len2 * 20 + 200);
    rx += ax * k; ry += ay * k;
  }
  const oldx = rs.x, oldy = rs.y;
  rs.x = f32(oldx * 0.9 + (rx - oldx) * 0.1);
  rs.y = f32(oldy * 0.9 + (ry - oldy) * 0.1);
}

function update(self: LuaTable): void {
  const e = self.get('parent') as Entity | undefined;
  if (!e) return;
  const st = str(self.get('state'));
  if (st === 'init' || st === 'pause' || st === 'S_RESPAWN' || st === 'S_DIE') return;
  calculateRepel(self);
  const pl = player();
  if (!pl) return;
  const px = pl.p.x, py = pl.p.y;
  const dist = f32(Math.hypot(px - e.p.x, py - e.p.y));
  const type = str(self.get('type'));
  const start = vecOf(self, 'start_pos'), repel = vecOf(self, 'repel_speed');
  const sd = (): number => Math.hypot(px - e.p.x, py - e.p.y);
  if (type === 'blocker') {
    if (st === 'S_STAND' || st === 'walk') { if (dist <= 220) setState(self, 'S_CHASE'); }
    else if (st === 'S_CHASE') {
      const fromOrigin = Math.hypot(e.p.x - start.x, e.p.y - start.y);
      if (220 < fromOrigin) setState(self, 'GO_BACK_TO_ORIGIN'); else gotoPosition(self, px, py, '');
    } else if (st === 'GO_BACK_TO_ORIGIN') gotoPosition(self, start.x, start.y, 'S_STAND');
  } else if (type === 'mocker') {
    if (st === 'walk') { if (dist > 250) walkMovement(self); else setState(self, 'S_CHASE'); }
    else if (st === 'S_STAND') setPosition(self, e.p.x + repel.x, e.p.y + repel.y);
    else if (st === 'S_CHASE') { if (230 < sd()) setState(self, 'disappears'); else gotoPosition(self, px, py, ''); }
  } else if (type === 'chaser') {
    if (st === 'walk') { if (sd() <= 250) setState(self, 'S_CHASE'); else walkMovement(self); }
    else if (st === 'S_STAND') setPosition(self, e.p.x + repel.x, e.p.y + repel.y);
    else if (st === 'S_CHASE') gotoPosition(self, px, py, '');
  } else if (type === 'bomber') {
    if (st === 'S_PATROLLING') { const fn = lua().index(self, 'bomberUpdate'); if (fn !== undefined) lua().callArr(fn, [self]); }
  }
  // the animation looks to the side it moves to
  const card = getCardinal(self);
  if (card !== str(self.get('cardinal')) && !self.get('animation_has_callback')) changeAnim(self, str(self.get('currentAnim')), undefined);
  const oldp = vecOf(self, 'oldp');
  oldp.x = e.p.x; oldp.y = e.p.y;
}

/** the fields every instance of a ghost starts with, and the methods of the native class */
export function ghostInit(self: LuaTable): void {
  for (const k of ['start_pos', 'repel_speed', 'repel_when_close', 'speed', 'oldp']) self.set(k, new Vec2());
  for (const k of ['type', 'state', 'initState', 'original_state', 'orig_initial_state', 'cardinal', 'currentAnim']) self.set(k, '');
  for (const k of ['sinSign', 'start_hp', 'hp', 'timeToChangeDirection']) self.set(k, 0);
  self.set('animation_has_callback', false);
}

export const ghostMethods: Record<string, NativeFunction> = {
  update: (s: LuaTable) => { update(s); },
  walk_movement: (s: LuaTable) => { walkMovement(s); },
  setPosition: (s: LuaTable, v) => { const p = Vec2.of(v); setPosition(s, p.x, p.y); },
  getCardinal: (s: LuaTable) => getCardinal(s),
  changeAnim: (s: LuaTable, name, cb) => { changeAnim(s, str(name), cb); },
  canBeScared: (s: LuaTable) => canBeScared(s),
  canBeHurt: (s: LuaTable) => canBeHurt(s),
  bomberUpdate: () => { /* the Lua class overrides it */ },
  setState: () => { /* the Lua class overrides it */ },
};
