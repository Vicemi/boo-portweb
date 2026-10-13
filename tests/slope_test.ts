import { readFileSync } from 'node:fs';
import { parseTmx } from '../src/engine/tmx';
import { CollisionMap, CollisionSystem, Collidable, AABB, COLLISION } from '../src/engine/collision';
import { Vec2 } from '../src/engine/scene';

const tmx = parseTmx(readFileSync('F:/Games/Boo-PortWeb/Boo.activity/assets/maps/_flat_test.tmx', 'utf8'));
const col = tmx.layers.find(l => l.name === 'collisions')!;
const sys = COLLISION.sys = new CollisionSystem();
const mapC = new Collidable(); mapC.shape = new CollisionMap(col.width, col.height, Uint8Array.from(col.data)); mapC.category = 8; mapC.pos = new Vec2(0, 0); sys.add(mapC);
const cases = JSON.parse(readFileSync('research/probe/slope_cases.json', 'utf8'));
const exp = readFileSync('research/probe/slope_expected.txt', 'utf8').split('\n').filter(l => /^(slide|stop) /.test(l));
let bad = 0, stuckBad = 0;
cases.forEach((cs: any, i: number) => {
  const c = new Collidable(); c.shape = new AABB(...(cs.box as [number, number, number, number])); c.category = 1; c.mask = 8; c.pos = new Vec2(cs.x, cs.y); sys.add(c);
  const stuck = sys.stuck(c);
  let r: string;
  if (cs.kind === 'slide') { const v = sys.slide(c, cs.dx, cs.dy); r = `(${v.x.toFixed(4)},${v.y.toFixed(4)})`; } else r = String(sys.stop(c, cs.dx, cs.dy));
  sys.remove(c);
  const got = `${cs.kind} ${c.pos.x.toFixed(4)} ${c.pos.y.toFixed(4)} 0.0000 ${r}`;
  if (stuck && got !== exp[i]) { stuckBad++; return; }
  if (got !== exp[i]) { bad++; if (bad <= 12) console.log(`#${i} ${JSON.stringify(cs)}\n   got ${got}\n  want ${exp[i]}`); }
});
console.log(`stuck-start mismatches: ${stuckBad}`);
console.log(bad ? `${bad} / ${cases.length} mismatches` : 'all match');
