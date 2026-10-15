// A bot that walks the player around a map with real key presses: grid path planning over the collision map, then steering
import type { Play } from './lib_play';

const STEP = 10;
export interface Rect { x: number; y: number; w: number; h: number }

export class Bot {
  constructor(public p: Play) {}
  get col(): any { return this.p.run('return g_PlayerM.playerCollidableComponent.collidable'); }
  pos(): { x: number; y: number } { return { x: this.p.run('return g_PlayerM.player.p.x'), y: this.p.run('return g_PlayerM.player.p.y') }; }
  mapSize(): { w: number; h: number } { return { w: this.p.run('return g_StageM.map_renderable and 0 or 0') || 0, h: 0 }; }
  /** is the player box free with its position at (x, y)? */
  free(x: number, y: number): boolean {
    const c = this.col, pos = c.pos;
    const sx = pos.x, sy = pos.y;
    pos.x = x; pos.y = y;
    const r = !this.p.g.collision.stuck(c);
    pos.x = sx; pos.y = sy;
    return r;
  }
  doorRect(id: string): Rect {
    const r = (f: string): number => this.p.run(`return g_StageM.door_manager.doors["${id}"].${f}`);
    return { x: r('door.p.x'), y: r('door.p.y'), w: r('width'), h: r('height') };
  }
  doors(): string[] { return (this.p.run('local t = {} for k in pairs(g_StageM.door_manager.doors) do t[#t+1] = k end table.sort(t) return table.concat(t, ",")') as string).split(',').filter(Boolean); }

  /** BFS over a STEP grid to a position where `goal(x, y)` is true; returns the waypoints (or null) */
  plan(goal: (x: number, y: number) => boolean, W = 3000, H = 3000): { x: number; y: number }[] | null {
    const s = this.pos();
    const sx = Math.round(s.x / STEP), sy = Math.round(s.y / STEP);
    const key = (a: number, b: number): number => (b + 400) * 2000 + (a + 400);
    const prev = new Map<number, number>();
    const q: number[][] = [[sx, sy]];
    prev.set(key(sx, sy), -1);
    const cache = new Map<number, boolean>();
    const ok = (a: number, b: number): boolean => { const k = key(a, b); let v = cache.get(k); if (v === undefined) { v = a * STEP > -200 && b * STEP > -200 && a * STEP < W && b * STEP < H && this.free(a * STEP, b * STEP); cache.set(k, v); } return v; };
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (let qi = 0; qi < q.length; qi++) {
      const [a, b] = q[qi];
      if (goal(a * STEP, b * STEP)) {
        const path: { x: number; y: number }[] = [];
        let k = key(a, b);
        while (k !== -1) { const bb = Math.floor(k / 2000) - 400, aa = (k % 2000) - 400; path.push({ x: aa * STEP, y: bb * STEP }); k = prev.get(k)!; }
        return path.reverse();
      }
      for (const [dx, dy] of dirs) {
        const na = a + dx, nb = b + dy;
        if (prev.has(key(na, nb)) || !ok(na, nb)) continue;
        if (dx && dy && (!ok(a + dx, b) || !ok(a, b + dy))) continue;
        prev.set(key(na, nb), key(a, b));
        q.push([na, nb]);
      }
    }
    return null;
  }

  /** follows the waypoints with the arrow keys; returns false if it got stuck */
  follow(path: { x: number; y: number }[], maxTicks = 3000): boolean {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
    let i = 1, ticks = 0, lastMove = 0, last = this.pos();
    const held = new Set<string>();
    const set = (k: string, on: boolean): void => { if (on && !held.has(k)) { this.p.g.input.keyDown(k); held.add(k); } else if (!on && held.has(k)) { this.p.g.input.keyUp(k); held.delete(k); } };
    while (i < path.length && ticks < maxTicks) {
      const me = this.pos();
      const t = path[i];
      const near = path[i];
      if (Math.abs(me.x - near.x) <= 5 && Math.abs(me.y - near.y) <= 5) { i++; continue; }
      const dx = t.x - me.x, dy = t.y - me.y;
      set('ArrowLeft', dx < -3); set('ArrowRight', dx > 3); set('ArrowUp', dy < -3); set('ArrowDown', dy > 3);
      this.p.tick(1); ticks++;
      const now = this.pos();
      if (Math.abs(now.x - last.x) + Math.abs(now.y - last.y) > 0.5) { lastMove = ticks; last = now; }
      if (ticks - lastMove > 40) { keys.forEach(k => set(k, false)); return false; }
      if (this.p.q('g_PlayerM.pauseInput')) { keys.forEach(k => set(k, false)); return false; }
    }
    keys.forEach(k => set(k, false));
    this.p.tick(2);
    return i >= path.length;
  }

  /** walks to a point where the beacon trigger (-20,-40,20,0) overlaps the rectangle */
  walkToRect(r: Rect, preferInside = true): boolean {
    const hit = (x: number, y: number): boolean => x + 20 > r.x && x - 20 < r.x + r.w && y > r.y && y - 40 < r.y + r.h;
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    // among the reachable cells overlapping the rect, take the one closest to its center
    let best: { x: number; y: number } | null = null, bestD = Infinity;
    for (let x = Math.floor(r.x / STEP) * STEP - 20; x <= r.x + r.w + 20; x += STEP) for (let y = Math.floor(r.y / STEP) * STEP; y <= r.y + r.h + 60; y += STEP) {
      if (!hit(x, y) || !this.free(x, y)) continue;
      const d = (x - cx) ** 2 + (y - 20 - cy) ** 2 * (preferInside ? 1 : 0.5);
      if (d < bestD) { bestD = d; best = { x, y }; }
    }
    if (!best) return false;
    const b = best;
    const path = this.plan((x, y) => x === b.x && y === b.y);
    return path ? this.follow(path) : false;
  }
}
