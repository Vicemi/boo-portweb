// checks that the arrival point of every door (and the start point of every map) is not inside the collision map
import { readdirSync } from 'node:fs';
import { mkMap, ROOT } from './lib_play';
const maps = readdirSync(ROOT + '/assets/maps').filter(f => f.endsWith('.tmx') && !f.startsWith('_')).map(f => f.replace('.tmx', ''));
for (const m of maps) {
  const p = mkMap(m);
  p.tick(5);
  const col = p.run('return g_PlayerM.playerCollidableComponent.collidable');
  const ids: string[] = p.run('local t = {} for k, v in pairs(g_StageM.door_manager.doors) do t[#t+1] = k end return table.concat(t, ",")').split(',').filter(Boolean);
  const out: string[] = [];
  const check = (name: string, x: number, y: number): void => {
    p.run(`g_PlayerM.player.p.x = ${x} g_PlayerM.player.p.y = ${y}`);
    if (p.g.collision.stuck(col)) out.push(`${name}@${x},${y}`);
  };
  const s = p.run('return g_PlayerM.player.p.x'), sy = p.run('return g_PlayerM.player.p.y');
  check('start', s, sy);
  for (const id of ids) {
    const x = p.run(`return g_StageM.door_manager.doors["${id}"].startPos.x`), y = p.run(`return g_StageM.door_manager.doors["${id}"].startPos.y`);
    check('door_' + id, x, y);
  }
  console.log(m.padEnd(18), out.length ? 'STUCK ' + out.join(' ') : 'ok', p.errors().join(' ## '));
}
