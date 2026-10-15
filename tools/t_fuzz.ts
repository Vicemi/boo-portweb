// Plays the game like a (random) player through reachable quest states: tsx tools/t_fuzz.ts [seeds] [steps]
// Each run builds a quest state by applying random enabled rows of the quest tables, starts in a random map from a save with that state, then walks to random doors / npcs with
// real keys, talks, opens doors and so on, checking after every action that the game is alive (no Lua errors, input or fade not stuck, the player can move).
import { mkGame, settle, status, NL, type Play } from './lib_play';
import { Bot } from './lib_bot';
import { savePng } from './node_host';

const seeds = +(process.argv[2] ?? 3), steps = +(process.argv[3] ?? 25);
const maps = ['flat_16_main', 'flat_16_workshop', 'hall_1', 'hall_2', 'hall_3', 'hall_4', 'flat_14_main', 'flat_14_workshop', 'flat_15_main', 'flat_12_main', 'flat_12_basement', 'flat_11_main', 'flat_10_main', 'flat_9_main', 'flat_8_main', 'flat_7_main', 'flat_7_workshop', 'flat_6_main', 'flat_13_main', 'basement_1_main', 'basement_2_main', 'basement_3_main'];
let problems = 0;

function rng(seed: number): () => number { let s = seed * 2654435761 >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

const BOOT = (map: string): string => ['package.loaded["development"] = true', 'ENABLE_SOUNDS=true ENABLE_GHOSTS=true ENABLE_PERSISTANCE=true ENABLE_SCREEN=false', `MAP_TO_LOAD="${map}"`, 'loadfile("src/start.lua")()'].join(NL);

/** applies random enabled rows of Entities.csv to the quest state (a list of inputs) and returns it */
function questState(r: () => number, n: number): string[] {
  const p = mkGame({ boot: BOOT('flat_16_main') });
  p.run(`
    local has = function(x) return Utils:findStringInArray(g_QuestM.inputsObtained, x) end
    function ROW_OK(row)
      for k, list in pairs(row.input) do for _, inp in ipairs(list) do
        if string.find(inp, "no:") then if has(string.sub(inp, 4)) then return false end elseif not has(inp) then return false end
      end end
      return true
    end
    function ENABLED()
      local out = {}
      for name, rows in pairs(g_QuestM.triggers) do for i, row in ipairs(rows) do
        local rr = row.hasOptions and (math.random() < 0.7 and row.yesRow or row.noRow) or row
        if rr and rr.input and ROW_OK(rr) and (#rr.add > 0 or next(rr.add) ~= nil) then out[#out + 1] = rr end
      end end
      return out
    end
    function APPLY(row)
      for k, list in pairs(row.add) do for _, x in ipairs(list) do Utils:addStringInArray(g_QuestM.inputsObtained, x) end end
      for k, list in pairs(row.rmv) do for _, x in ipairs(list) do Utils:removeStringInArray(g_QuestM.inputsObtained, x) end end
    end`);
  for (let i = 0; i < n; i++) {
    p.run('math.randomseed(' + Math.floor(r() * 1e6) + ')');
    if (!p.run('local e = ENABLED() if #e == 0 then return false end APPLY(e[math.random(1, #e)]) return true')) break;
  }
  return (p.run('return table.concat(g_QuestM.inputsObtained, ",")') as string).split(',').filter(Boolean);
}

function alive(p: Play, why: string, bot: Bot): string | null {
  if (p.errors().length) return 'LUA ERROR ' + p.errors()[0];
  settle(p, 1500);
  if (p.q('g_PlayerM.pauseInput')) return 'input still paused after 1500 ticks (' + why + ')';
  if (p.q('g_StageM.dialog_manager:isDialogOpen()')) return 'dialog stuck open';
  if (p.q('g_HUD.curtainSprite.alpha') > 0) return 'curtain stuck';
  // can the player move at all?
  // (a ghost may be knocking the player back for a moment: try a few times)
  let moved = false;
  for (let attempt = 0; attempt < 3 && !moved; attempt++) {
    if (attempt) { p.tick(60); settle(p); }
    const a = bot.pos();
    for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) { p.hold(k, 4); const b = bot.pos(); if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) > 0.5) { moved = true; break; } }
  }
  const a = bot.pos();
  if (!moved) return 'player cannot move at ' + a.x + ',' + a.y;
  return null;
}

for (let seed = 1; seed <= seeds; seed++) {
  const r = rng(seed);
  const inputs = questState(r, Math.floor(r() * 60));
  const map = maps[Math.floor(r() * maps.length)];
  // a save with that state, then the game continues from it
  const first = mkGame({ boot: BOOT('flat_16_main') });
  first.run(`g_Persistance.saved[Persistance.ITEMS_OBTAINED] = {${inputs.map(x => `"${x}"`).join(',')}} g_Persistance:saveGame()`);
  const p = mkGame({ store: first.store, boot: BOOT(map) });
  const bot = new Bot(p);
  const log: string[] = [];
  let msg: string | null = alive(p, 'start', bot);
  p.run('math.randomseed(' + seed + ')');
  for (let s = 0; s < steps && !msg; s++) {
    try {
      const cur: string = p.run('return g_StageM:getCurrentMapName()');
      const doors = bot.doors();
      const npcs: string[] = (p.run('local t = {} for k, v in pairs(g_StageM.npc_manager.entCreated) do t[#t+1] = k end table.sort(t) return table.concat(t, ",")') as string).split(',').filter(Boolean);
      const targets: { kind: string; id: string }[] = [...doors.map(id => ({ kind: 'door', id })), ...npcs.map(id => ({ kind: 'npc', id }))];
      if (!targets.length) break;
      const t = targets[Math.floor(r() * targets.length)];
      let rect;
      if (t.kind === 'door') rect = bot.doorRect(t.id);
      else rect = { x: p.run(`return g_StageM.npc_manager.entCreated["${t.id}"].p.x`) - 30, y: p.run(`return g_StageM.npc_manager.entCreated["${t.id}"].p.y`) - 30, w: 60, h: 40 };
      if (t.kind === 'door') p.run(`g_QuestM:addToInputObtainedTable(g_StageM.door_manager.doors["${t.id}"].unlock_item)`);
      const ok = bot.walkToRect(rect);
      log.push(`${cur}:${t.kind}:${t.id}${ok ? '' : '(no path)'}`);
      if (ok) {
        const n = 1 + Math.floor(r() * 3);
        for (let k = 0; k < n; k++) { p.press('KeyS', 2, 3 + Math.floor(r() * 12)); if (r() < 0.2) p.press('KeyA', 2, 3); }
        // answer dialogs with random options
        for (let k = 0; k < 4; k++) { if (p.q('g_StageM.dialog_manager:isDialogOpen()')) { if (r() < 0.5) p.press('ArrowDown', 2, 2); settle(p, 30); } }
        p.tick(10 + Math.floor(r() * 60));
      }
      msg = alive(p, log[log.length - 1], bot);
    } catch (e) { msg = 'EXCEPTION ' + String(e).split(NL)[0]; }
  }
  if (msg) {
    problems++;
    console.log(`seed ${seed} map ${map}: ${msg}`);
    console.log('  state:', status(p));
    console.log('  actions:', log.join(' > '));
    console.log('  inputs:', inputs.join(','));
    try { savePng(p.g.render(), `research/soak/fuzz_${seed}.png`); } catch { /* none */ }
  } else console.log(`seed ${seed} map ${map}: ok (${log.length} actions, ${inputs.length} inputs)`);
}
console.log('problems', problems);
