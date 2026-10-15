// times the map loads (Lua part + first render with the image decoding): tsx tools/t_load.ts
import { readdirSync } from 'node:fs';
import { mkMap, ROOT } from './lib_play';
const maps = readdirSync(ROOT + '/assets/maps').filter(f => f.endsWith('.tmx') && !f.startsWith('_')).map(f => f.replace('.tmx', ''));
const p = mkMap('flat_16_main');
p.tick(60);
for (const m of maps) {
  let t0 = performance.now();
  p.run(`g_StageM:realChangeMap("${m}", nil, nil, nil)`);
  const tLua = performance.now() - t0;
  t0 = performance.now();
  p.g.render();
  const tFirst = performance.now() - t0;
  t0 = performance.now();
  for (let i = 0; i < 10; i++) { p.tick(1); p.g.render(); }
  const tSteady = (performance.now() - t0) / 10;
  t0 = performance.now(); for (let i = 0; i < 10; i++) p.tick(1); const tTick = (performance.now() - t0) / 10;
  console.log(m.padEnd(18), `lua ${tLua.toFixed(0)} ms  first render ${tFirst.toFixed(0)} ms  steady tick+render ${tSteady.toFixed(1)} ms  tick only ${tTick.toFixed(1)} ms`);
}
console.log(p.errors());
