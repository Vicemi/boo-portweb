import { readFileSync } from 'node:fs';
import { parseTmx } from '../src/engine/tmx';
import { CollisionMap, CollisionSystem, Collidable, AABB, COLLISION } from '../src/engine/collision';
import { Vec2 } from '../src/engine/scene';
const tmx = parseTmx(readFileSync('F:/Games/Boo-PortWeb/Boo.activity/assets/maps/_flat_test.tmx', 'utf8'));
const col = tmx.layers.find(l => l.name === 'collisions')!;
const sys = COLLISION.sys = new CollisionSystem();
const mapC = new Collidable(); mapC.shape = new CollisionMap(col.width, col.height, Uint8Array.from(col.data)); mapC.category = 8; mapC.pos = new Vec2(0, 0); sys.add(mapC);
const c = new Collidable(); c.shape = new AABB(-0.5, -0.5, 0.5, 0.5); c.category = 1; c.mask = 8; c.pos = new Vec2(0, 0); sys.add(c);
const lines = readFileSync('research/probe/ray_expected.txt', 'utf8').split('\n').filter(l => l);
let bad = 0, stuck = 0;
const cellOf = (x: number, y: number) => `${Math.floor(x / 30)},${Math.floor(y / 30)}`;
const byCell: Record<string, number> = {};
for (const l of lines) {
  const [x, y, dx, dy, px, py, r] = l.split(' ');
  c.pos.x = +x; c.pos.y = +y;
  if (sys.stuck(c)) { stuck++; continue; }
  const hit = sys.stop(c, +dx, +dy);
  const ok = Math.abs(c.pos.x - +px) < 2e-3 && Math.abs(c.pos.y - +py) < 2e-3 && String(hit) === r;
  if (!ok) { bad++; byCell[cellOf(+x, +y)] = (byCell[cellOf(+x, +y)] ?? 0) + 1; if (bad <= 60) console.log(`from (${x},${y}) d(${dx},${dy}): got (${c.pos.x.toFixed(3)},${c.pos.y.toFixed(3)}) ${hit}, want (${px},${py}) ${r}`); }
}
console.log(`stuck ${stuck}, mismatches ${bad} / ${lines.length - stuck}`);
