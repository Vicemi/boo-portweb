// Shared helpers for the playthrough tools: a headless game with the real menus, scripted keys, Lua queries and a stuck detector
import { Game } from '../src/engine/game';
import { folderFiles, CanvasRasterizer } from './node_host';
import { compileChunk } from '../src/lua/compile';

export const ROOT = 'F:/Games/Boo-PortWeb/Boo.activity';
export const NL = String.fromCharCode(10);
const rast = new CanvasRasterizer();

export interface Play {
  g: Game;
  store: Map<string, string>;
  /** runs Lua code; returns the first result (or throws the Lua error) */
  run(code: string): any;
  /** evaluates a Lua expression */
  q(expr: string): any;
  tick(n?: number): void;
  /** presses a key for `hold` ticks (default 2) then releases it and waits `after` ticks */
  press(code: string, hold?: number, after?: number): void;
  hold(code: string, ticks: number): void;
  errors(): string[];
}

export function mkGame(opts: { store?: Map<string, string>; boot?: string | null; sounds?: boolean } = {}): Play {
  const store = opts.store ?? new Map<string, string>();
  const g = new Game({ files: folderFiles(ROOT), rast, userRead: (p) => store.get(p), userWrite: (p, d) => { store.set(p, d); }, print: () => {} });
  g.boot(opts.boot === null || opts.boot === undefined ? undefined : new TextEncoder().encode(opts.boot));
  const run = (code: string): any => {
    const r = g.L.pcall(compileChunk(g.L, code, '=play'), []);
    if (!r.ok) throw new Error(String(r.err) + NL + r.traceback);
    return r.r[0];
  };
  const p: Play = {
    g, store, run,
    q: (e) => run('return ' + e),
    tick(n = 1) { for (let i = 0; i < n; i++) g.tick(); },
    press(code, hold = 2, after = 2) { g.input.keyDown(code); p.tick(hold); g.input.keyUp(code); p.tick(after); },
    hold(code, ticks) { g.input.keyDown(code); p.tick(ticks); g.input.keyUp(code); },
    errors: () => [...new Set(g.errors.map(x => x.split(NL).slice(0, 3).join(' | ')))],
  };
  return p;
}

/** a game that skips the menus: the given map, with persistence on, optionally with quest inputs already obtained */
export function mkMap(map: string, inputs: string[] = [], store?: Map<string, string>): Play {
  const boot = [
    'package.loaded["development"] = true',
    'ENABLE_SOUNDS=true ENABLE_GHOSTS=true ENABLE_PERSISTANCE=true ENABLE_SCREEN=false',
    `MAP_TO_LOAD="${map}"`,
    'loadfile("src/start.lua")()',
    ...inputs.map(i => `g_QuestM:addToInputObtainedTable("${i}")`),
  ].join(NL);
  return mkGame({ boot, store });
}

/** compact description of what the game is doing now */
export function status(p: Play): string {
  try {
    return p.run(`
      local s = {}
      s[#s+1] = tostring(g_StageM and g_StageM:getCurrentMapName())
      if g_PlayerM then
        local pp = g_PlayerM:getPosition()
        s[#s+1] = string.format("pos=%d,%d", pp.x, pp.y)
        s[#s+1] = "pause=" .. tostring(g_PlayerM.pauseInput) .. " dead=" .. tostring(g_PlayerM.dead)
      end
      if g_StageM and g_StageM.dialog_manager then s[#s+1] = "dlg=" .. tostring(g_StageM.dialog_manager:isDialogOpen()) end
      if g_HUD then s[#s+1] = string.format("curtain=%.2f", g_HUD.curtainSprite.alpha) end
      s[#s+1] = "page=" .. tostring(g_ScreenM and g_ScreenM:get_current_page())
      return table.concat(s, " ")`);
  } catch (e) { return 'status error ' + String(e).slice(0, 80); }
}

/** lets the cutscenes and dialogs that a map starts with finish (presses the talk key while a dialog is open) */
export function settle(p: Play, max = 900): void {
  for (let t = 0; t < max; t++) {
    const busy = p.q('g_PlayerM.pauseInput') || p.q('g_StageM.dialog_manager:isDialogOpen()') || p.q('g_HUD.curtainSprite.alpha') > 0;
    if (!busy) return;
    if (p.q('g_StageM.dialog_manager:isDialogOpen()') && t % 8 === 0) { p.g.input.keyDown('KeyS'); p.tick(1); p.g.input.keyUp('KeyS'); } else p.tick(1);
  }
}
