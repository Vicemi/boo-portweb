import { readFileSync } from 'node:fs';
import { parseTmx } from '../src/engine/tmx';
import { CollisionMap, CollisionSystem, Collidable, AABB, COLLISION } from '../src/engine/collision';
import { Vec2 } from '../src/engine/scene';

const tmx = parseTmx(readFileSync('F:/Games/Boo-PortWeb/Boo.activity/assets/maps/hall_1.tmx', 'utf8'));
const col = tmx.layers.find(l => l.name === 'collisions')!;
const map = new CollisionMap(col.width, col.height, Uint8Array.from(col.data));
const sys = COLLISION.sys = new CollisionSystem();
const mapC = new Collidable(); mapC.shape = map; mapC.category = 8; mapC.pos = new Vec2(0, 0); sys.add(mapC);
const lines = readFileSync('research/probe/collide_expected.txt', 'utf8').split('\n').filter(l => /^(slide|stop) /.test(l));
let bad = 0;
for (const l of lines) {
  const m = /^(slide|stop) start\(([-\d.]+),([-\d.]+)\) d\(([-\d.]+),([-\d.]+)\) -> p=\(([-\d.]+),([-\d.]+)\) ret=(.*)$/.exec(l)!;
  const [, kind, sx, sy, dx, dy, px, py, ret] = m;
  const c = new Collidable(); c.shape = new AABB(-25, -35, 25, -5); c.category = 1; c.mask = 8; c.pos = new Vec2(+sx, +sy); sys.add(c);
  let r: string;
  if (kind === 'slide') { const v = sys.slide(c, +dx, +dy); r = `(${v.x},${v.y})`; } else r = String(sys.stop(c, +dx, +dy));
  sys.remove(c);
  const ok = Math.abs(c.pos.x - +px) < 1e-3 && Math.abs(c.pos.y - +py) < 1e-3;
  if (!ok) bad++;
  console.log(ok ? 'ok  ' : 'BAD ', l.slice(0, 40), ok ? '' : `got p=(${c.pos.x.toFixed(4)},${c.pos.y.toFixed(4)}) ret=${r} want ${px},${py} ${ret}`);
}
console.log(bad ? `${bad} mismatches` : 'all match');
