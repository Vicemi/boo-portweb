import { readFileSync } from 'node:fs';
import { parseTmx } from '../src/engine/tmx';
import { CollisionMap, CollisionSystem, Collidable, AABB, COLLISION } from '../src/engine/collision';
import { Vec2 } from '../src/engine/scene';
const tmx = parseTmx(readFileSync('F:/Games/Boo-PortWeb/Boo.activity/assets/maps/' + (process.argv[6] ?? '_flat_test') + '.tmx', 'utf8'));
const col = tmx.layers.find(l => l.name === 'collisions')!;
const sys = COLLISION.sys = new CollisionSystem();
const mapC = new Collidable(); mapC.shape = new CollisionMap(col.width, col.height, Uint8Array.from(col.data)); mapC.category = 8; mapC.pos = new Vec2(0, 0); sys.add(mapC);
const c = new Collidable(); c.shape = new AABB(-25, -35, 25, -5); c.category = 1; c.mask = 8; c.pos = new Vec2(+process.argv[2], +process.argv[3]); sys.add(c);
let dx = +process.argv[4], dy = +process.argv[5];
for (let it = 0; it < 6; it++) {
  const f = sys.firstHit(c, dx, dy);
  console.log(it, 'pos', c.pos.x, c.pos.y, 'd', dx, dy, 'hit', f && f.hit);
  if (!f) { c.pos.x += dx; c.pos.y += dy; break; }
  const len = Math.hypot(dx, dy), t = f.hit.t;
  c.pos.x += dx * t - dx / len; c.pos.y += dy * t - dy / len;
  let rx = dx * (1 - t), ry = dy * (1 - t); const dn = rx * f.hit.nx + ry * f.hit.ny; dx = rx - f.hit.nx * dn; dy = ry - f.hit.ny * dn;
}
console.log(c.pos.x, c.pos.y);
