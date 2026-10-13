// plays every dialog of the game and checks it finishes: tsx tools/dialogs.ts
import { readFileSync } from 'node:fs';
import { Game } from '../src/engine/game';
import { folderFiles, CanvasRasterizer } from './node_host';
import { compileChunk } from '../src/lua/compile';
const ROOT = 'F:/Games/Boo-PortWeb/Boo.activity';
const csv = readFileSync(ROOT + '/assets/quests/boo_quests - Dialogs.csv', 'latin1').split('\n').map(l => l.split(',')[0]).filter(x => x.startsWith('D_'));
const ids = [...new Set(csv)];
const g = new Game({ files: folderFiles(ROOT), rast: new CanvasRasterizer(), print: () => {}, userRead: () => undefined, userWrite: () => {} });
g.boot(new TextEncoder().encode('package.loaded["development"]=true ENABLE_SOUNDS=false ENABLE_GHOSTS=false ENABLE_PERSISTANCE=false ENABLE_SCREEN=false MAP_TO_LOAD="flat_16_main" loadfile("src/start.lua")()'));
for (let i = 0; i < 60; i++) g.tick();
const run = (code: string) => g.L.pcall(compileChunk(g.L, code, '=d'), []);
let bad = 0;
for (const id of ids) {
  run(`DONE=false local d=g_QuestM:getDialog("${id}") if d then g_StageM.dialog_manager:showDialog(d, function() DONE=true end, "player") else DONE=true end`);
  let done = false;
  for (let t = 0; t < 4000 && !done; t++) {
    if (t % 6 === 0) g.input.keyDown('KeyS'); if (t % 6 === 3) g.input.keyUp('KeyS');
    g.tick();
    if (t % 20 === 0) { const r = run('error(tostring(DONE))'); done = !r.ok && String(r.err).endsWith('true'); }
  }
  if (!done) { bad++; console.log('STUCK', id); run('g_StageM.currentStage.dialog_manager:finish() g_StageM.dialog_manager:setDialogOpen(false) ingame_main:resume()'); }
}
console.log('dialogs', ids.length, 'stuck', bad, 'errors', g.errors.length, g.errors.slice(0, 3).map(e => e.split('\n')[0]));
