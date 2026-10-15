// Walks to every door of every map with real key presses, uses it, checks the arrival and walks back: tsx tools/t_roundtrip.ts [map...]   (KEYS=0: doors stay locked)
import { readdirSync } from 'node:fs';
import { mkMap, ROOT, status, settle } from './lib_play';
import { Bot } from './lib_bot';

const maps = process.argv.length > 2 ? process.argv.slice(2) : readdirSync(ROOT + '/assets/maps').filter(f => f.endsWith('.tmx') && !f.startsWith('_')).map(f => f.replace('.tmx', ''));
let problems = 0;
const say = (s: string): void => { console.log(s); };
for (const map of maps) {
  const p = mkMap(map);
  p.tick(90);
  const bot = new Bot(p);
  let doors: string[] = [];
  try { doors = bot.doors(); } catch { /* no doors */ }
  for (const id of doors) {
    // fresh game state for every door (some doors need the player to have walked in from a particular place)
    const g = mkMap(map);
    g.tick(90);
    settle(g);
    const b = new Bot(g);
    const to: string = g.run(`return tostring(g_StageM.door_manager.doors["${id}"].otherMap)`);
    const ev: string = g.run(`return tostring(g_StageM.door_manager.doors["${id}"].event)`);
    if (process.env.KEYS !== '0') g.run(`g_QuestM:addToInputObtainedTable(g_StageM.door_manager.doors["${id}"].unlock_item)`);
    const ok = b.walkToRect(b.doorRect(id));
    if (!ok) { say(`${map}:${id} -> ${to}  NO PATH / STUCK  ${status(g)}`); problems++; continue; }
    if (ev === 'action') g.press('KeyS', 2, 2);
    let changed = false;
    for (let t = 0; t < 400 && !changed; t++) { g.tick(1); changed = g.run('return g_StageM:getCurrentMapName()') !== map; }
    const dest = to.split(':')[0];
    const cur = g.run('return g_StageM:getCurrentMapName()');
    if (!changed && g.run(`return g_StageM.door_manager.doors["${id}"].blocked and not g_QuestM:hasItem(g_StageM.door_manager.doors["${id}"].unlock_item)`)) { say(`${map}:${id} locked (ok)`); continue; }
    if (!changed || cur !== dest) { say(`${map}:${id} -> ${to}  DID NOT CHANGE (now ${cur})  ${status(g)}`); problems++; continue; }
    g.tick(40); settle(g);
    const after = status(g);
    // does the player move at all in the new room?
    const b2 = new Bot(g);
    const p0 = b2.pos();
    g.hold('ArrowUp', 6); g.hold('ArrowLeft', 6); g.hold('ArrowDown', 12); g.hold('ArrowRight', 12);
    const p1 = b2.pos();
    const errs = g.errors();
    const moved = Math.abs(p0.x - p1.x) + Math.abs(p0.y - p1.y) > 1;
    const bad = errs.length > 0 || (!moved && !g.q('g_PlayerM.pauseInput'));
    if (bad) problems++;
    say(`${map}:${id} -> ${to} ${bad ? 'PROBLEM' : 'ok'}  ${after}  moved=${moved} ${errs.join(' ## ')}`);
  }
}
console.log('problems', problems);
