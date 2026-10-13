// takes every door of every map: tsx tools/doors.ts [ticks]   (ALLFLAGS=1: with every flag / item of the quests obtained)
// changeMap like the door does, then plays on and reports Lua errors and a map that did not change
import { readdirSync, readFileSync } from 'node:fs';
import { Game } from '../src/engine/game';
import { folderFiles, CanvasRasterizer } from './node_host';
import { compileChunk } from '../src/lua/compile';

const ROOT = 'F:/Games/Boo-PortWeb/Boo.activity';
const ticks = +(process.argv[2] ?? 300);
const ALL = process.env.ALLFLAGS === '1';
const rast = new CanvasRasterizer();
const NL = String.fromCharCode(10);

const flags = new Set<string>();
for (const f of readdirSync(ROOT + '/assets/quests')) {
  for (const m of readFileSync(ROOT + '/assets/quests/' + f, 'latin1').matchAll(/\b(flag|item|skill)_[a-z0-9_]+/g)) flags.add(m[0]);
}
const flagLua = [...flags].map(f => `g_QuestM:addToInputObtainedTable("${f}")`).join(NL);

const jobs: [string, string][] = [];
for (const f of readdirSync(ROOT + '/assets/maps').filter(f => f.endsWith('.tmx') && !f.startsWith('_'))) {
  const t = readFileSync(ROOT + '/assets/maps/' + f, 'latin1');
  for (const m of t.matchAll(/name="to" value="([^"]*)"/g)) jobs.push([f.replace('.tmx', ''), m[1]]);
}

for (const [from, to] of jobs) {
  const [map, door] = to.split(':');
  const g = new Game({ files: folderFiles(ROOT), rast, print: () => {}, userRead: () => undefined, userWrite: () => {} });
  const script = [
    'package.loaded["development"] = true',
    'ENABLE_SOUNDS=true ENABLE_GHOSTS=true ENABLE_PERSISTANCE=true ENABLE_SCREEN=false',
    `MAP_TO_LOAD="${from}"`,
    'loadfile("src/start.lua")()',
    'local n=0',
    'class("Dr")(Component)',
    'function Dr:__init() Component.__init(self) end',
    `function Dr:update() n=n+1 if n==20 then ${ALL ? flagLua.split(NL).join(' ') : ''} g_StageM:changeMap("${map}", ${door ? `"${door}"` : 'nil'}, nil) end end`,
    'local node=LogicNode() game:get_system("logic").main:add_updatable(node) node:add_component(Dr())',
  ].join(NL);
  let status = 'ok';
  try {
    g.boot(new TextEncoder().encode(script));
    for (let i = 0; i < ticks; i++) g.tick();
    const r = g.L.pcall(compileChunk(g.L, 'error(tostring(g_StageM:getCurrentMapName()))', '=q'), []);
    const cur = r.ok ? '?' : String(r.err).replace(/^.*?: /, '');
    if (cur !== map) status = `STUCK at ${cur}`;
  } catch (e) { status = 'FAIL ' + String(e).split(NL).slice(0, 2).join(' | '); }
  const errs = [...new Set(g.errors.map(x => x.split(NL).slice(0, 2).join(' | ')))];
  console.log(`${from} -> ${to}`.padEnd(40), status, errs.slice(0, 2).join(' ## '));
}
