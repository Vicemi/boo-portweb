import { readFileSync } from 'node:fs';
import { CollisionSystem, Collidable, CollidableComponent, PushableComponent, AABB, COLLISION } from '../src/engine/collision';
import { Entity, Stage } from '../src/engine/logic';
import { LObj } from '../src/engine/luabind';

const sys = COLLISION.sys = new CollisionSystem();
const stage = new Stage('s', () => new LObj());
const P = stage.createEntity('player'), B = stage.createEntity('box');
const pc = new CollidableComponent(new AABB(-25, -35, 25, -5)); P.addComponent(pc); pc.collidable.category = 1; pc.collidable.mask = 8;
const bc = new CollidableComponent(new AABB(-30, -50, 30, -5)); B.addComponent(bc); B.addComponent(new PushableComponent());
P.addToGame(); B.addToGame();
let bad = 0, n = 0;
for (const f of ['push2', 'push3']) {
  for (const l of readFileSync(`research/probe/${f}_expected.txt`, 'utf8').split('\n')) {
    const m = /^g=([-\d.]+) d=\(([-\d.]+),([-\d.]+)\) ret=(\w+) dP=\(([-\d.]+),([-\d.]+)\) dB=\(([-\d.]+),([-\d.]+)\)/.exec(l);
    if (!m) continue;
    const [g, dx, dy] = [+m[1], +m[2], +m[3]];
    B.p.x = 400; B.p.y = 300; P.p.x = 345 - g; P.p.y = 300;
    const ret = sys.push(pc.collidable, dx, dy);
    n++;
    const got = [P.p.x - (345 - g), P.p.y - 300, B.p.x - 400, B.p.y - 300];
    const want = [+m[5], +m[6], +m[7], +m[8]];
    if (String(ret) !== m[4] || got.some((v, i) => Math.abs(v - want[i]) > 2e-4)) { bad++; if (bad < 15) console.log(l, '\n  got', ret, got.map(v => v.toFixed(4)).join(' ')); }
  }
}
console.log(bad ? `${bad}/${n} push mismatches` : `all ${n} push cases match`);
