// takes every door of every map: tsx tools/doors.ts [ticks]   (changeMap like the door does, then plays on and reports Lua errors / a stuck loading)
import { readdirSync, readFileSync } from 'node:fs';
import { Game } from '../src/engine/game';
import { folderFiles, CanvasRasterizer } from './node_host';
const ROOT = 'F:/Games/Boo-PortWeb/Boo.activity';
const ticks = +(process.argv[2] ?? 300);
const rast = new CanvasRasterizer();
const jobs: [string, string][] = [];
for (const f of readdirSync(ROOT + '/assets/maps').filter(f => f.endsWith('.tmx') && !f.startsWith('_'))) {
  const t = readFileSync(ROOT + '/assets/maps/' + f, 'latin1');
  for (const m of t.matchAll(/name="to" value="([^"]*)"/g)) jobs.push([f.replace('.tmx', ''), m[1]]);
}
for (const [from, to] of jobs) {
  const [map, door] = to.split(':');
  const g = new Game({ files: folderFiles(ROOT), rast, print: () => {}, userRead: () => undefined, userWrite: () => {} });
  const script = `package.loaded["development"] = true\nENABLE_SOUNDS=true ENABLE_GHOSTS=true ENABLE_PERSISTANCE=true ENABLE_SCREEN=false\nMAP_TO_LOAD="${from}"\nloadfile("src/start.lua")()\nlocal n=0\nclass("Dr")(Component)\nfunction Dr:__init() Component.__init(self) end\nfunction Dr:update() n=n+1 if n==20 then g_StageM:changeMap("${map}", ${door ? `"${door}"` : 'nil'}, nil) end end\nlocal node=LogicNode() game:get_system("logic").main:add_updatable(node) node:add_component(Dr())\n`;
  let status = 'ok';
  try {
    g.boot(new TextEncoder().encode(script));
    for (let i = 0; i < ticks; i++) g.tick();
    const r = g.L.pcall((g.L as any).globals.get('g_StageM') ? (await import('../src/lua/compile')).compileChunk(g.L, 'error(tostring(g_StageM:getCurrentMapName()))', '=q') : undefined, []);
    const cur = r.ok ? '?' : String(r.err).replace(/^.*?: /, '');
    if (cur !== map) status = `STUCK at ${cur}`;
  } catch (e) { status = 'FAIL ' + String(e).split('\n').slice(0, 2).join(' | '); }
  const errs = [...new Set(g.errors.map(x => x.split('\n').slice(0, 2).join(' | ')))];
  console.log(`${from} -> ${to}`.padEnd(40), status, errs.slice(0, 2).join(' ## '));
}
