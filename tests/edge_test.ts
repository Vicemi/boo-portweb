// the ring of solid cells around a map, measured on the original (research/probe/probe_edge3.lua, flat_16_main 34x39 cells)
import { readFileSync } from 'node:fs';
import { parseTmx } from '../src/engine/tmx';
import { CollisionMap, CollisionSystem, Collidable, AABB, COLLISION } from '../src/engine/collision';
import { Vec2 } from '../src/engine/scene';

const tmx = parseTmx(readFileSync('F:/Games/Boo-PortWeb/Boo.activity/assets/maps/flat_16_main.tmx', 'utf8'));
const col = tmx.layers.find(l => l.name === 'collisions')!;
const first = tmx.tilesets.find(t => t.name === 'collisions')!.firstgid;
const tiles = Uint8Array.from(col.data, g => (g >= first && g < first + 5 ? g - first + 1 : 0));
const sys = COLLISION.sys = new CollisionSystem();
const m = new Collidable(); m.shape = new CollisionMap(col.width, col.height, tiles); m.category = 8; m.pos = new Vec2(0, 0); sys.add(m);
const a = new Collidable(); a.shape = new AABB(-25, -35, 25, -5); a.category = 1; a.mask = 8; a.pos = new Vec2(0, 0); sys.add(a);
const hit = (x: number, y: number): number => { a.pos!.x = x; a.pos!.y = y; return sys.collide(a).length() > 0 ? 1 : 0; };
// [x, y, overlap] from the original (the player box is [x-25, x+25] x [y-35, y-5])
const cases: [number, number, number][] = [
  [300, -25, 0], [300, -20, 1], [300, -100, 0],
  [-55, 900, 0], [-50, 900, 1], [-120, 900, 0],
  [300, 1175, 0], [300, 1180, 1], [300, 1230, 1], [300, 1235, 0],
  [1070, 900, 1], [1075, 900, 0], [1140, 900, 0],
  [1060, 1215, 1], [-40, -20, 1], [-40, 1215, 1], [1060, -20, 1],
];
let bad = 0;
for (const [x, y, want] of cases) if (hit(x, y) !== want) { bad++; console.log(`MISMATCH at (${x},${y}): got ${1 - want}, want ${want}`); }
// walking down through the door cells of the last row stops at the frame
a.pos!.x = 468; a.pos!.y = 1135;
for (let i = 0; i < 30; i++) sys.slide(a, 0, 10);
if (Math.abs(a.pos!.y - 1174) > 1.01) { bad++; console.log('door walk ended at', a.pos!.y, 'want 1174-1175'); }
console.log(bad === 0 ? 'all match' : `${bad} mismatches`);
process.exitCode = bad === 0 ? 0 : 1;
