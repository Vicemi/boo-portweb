// Starts the game in a canvas: files, fonts, sound, saves, the fixed 33 ms logic step and the keyboard
import { Game } from '../engine/game';
import { TICK_MS } from '../engine/logic';
import { WebFiles } from './files';
import { WebRasterizer } from './rast';
import { WebAudio } from './webaudio';
import { savedFromHost, startAutosave } from '../desktop';

export interface BooController {
  state: { progress: number; loaded: boolean; error: string | null; exited: boolean };
  key(code: string, down: boolean): void;
  audio: WebAudio;
  exportSave(): string;
  importSave(text: string): number;
  stop(): void;
}

const PREFIX = 'boo:save:';
const FONTS = ['assets/hud/zombieguts.ttf', 'assets/menus/registry_font.ttf', 'assets/dialogs/font.ttf', 'assets/font/font.ttf'];

const BACKUP = 'boo:bak:';   // the previous version of every save file (a second copy that is never read as a save)
/** a save written by the game is a Lua table: anything else (empty, cut, wrong file) must never replace a good save */
const looksSaved = (k: string, v: unknown): v is string => typeof v === 'string' && (!k.endsWith('.lua') || (v.length > 20 && v.trimStart().startsWith('return')));

function store(k: string, v: string): void {
  try {
    const old = localStorage.getItem(PREFIX + k);
    if (old !== null && old !== v && looksSaved(k, old)) { try { localStorage.setItem(BACKUP + k, old); } catch { /* full: the backup is optional */ } }
    localStorage.setItem(PREFIX + k, v);
  } catch { /* storage full or blocked: the copy in memory is still used */ }
}

function userFiles(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i)!; if (k.startsWith(PREFIX)) out[k.slice(PREFIX.length)] = localStorage.getItem(k)!; }
    // a save that is damaged is replaced by its backup, when that one is good
    for (const k of Object.keys(out)) if (!looksSaved(k, out[k])) { const b = localStorage.getItem(BACKUP + k); if (b !== null && looksSaved(k, b)) out[k] = b; }
  } catch { /* no storage */ }
  return out;
}

export function startBoo(canvas: HTMLCanvasElement, base: string): BooController {
  const state = { progress: 0, loaded: false, error: null as string | null, exited: false };
  const audio = new WebAudio(`${base}/sounds`);
  const mem = new Map<string, string>(Object.entries(userFiles()));   // fallback when the storage is not available
  const hostSave = savedFromHost();   // desktop version: the save of the installation folder wins
  if (hostSave) for (const [k, v] of Object.entries(hostSave)) if (looksSaved(k, v)) { mem.set(k, v); store(k, v); }
  let stopAutosave = (): void => { /* none */ };
  let game: Game | null = null;
  let raf = 0, stopped = false;
  const ctl: BooController = {
    state, audio,
    key(code, down) { if (!game) return; if (down) game.input.keyDown(code); else game.input.keyUp(code); },
    exportSave() { return JSON.stringify({ game: 'boo', format: 1, saved: new Date().toISOString(), files: Object.fromEntries(mem) }, null, 1); },
    importSave(text) {
      let o: { game?: string; format?: number; files?: Record<string, unknown> };
      try { o = JSON.parse(text); } catch { throw new Error('No es un archivo de progreso válido'); }
      if (o.game !== 'boo' || o.format !== 1 || !o.files) throw new Error('No es un archivo de progreso de este juego');
      let n = 0;
      for (const [k, v] of Object.entries(o.files)) {
        if (typeof v !== 'string' || !/^[\w.\-/]+$/.test(k) || k.includes('..')) throw new Error('El archivo de progreso está dañado');
        mem.set(k, v); try { localStorage.setItem(PREFIX + k, v); } catch { /* full */ }
        n++;
      }
      return n;
    },
    stop() { stopped = true; cancelAnimationFrame(raf); stopAutosave(); },
  };

  void (async () => {
    try {
      const files = new WebFiles();
      const rastP = new WebRasterizer();
      const late = await files.load(`${base}`, (f) => { state.progress = f; });
      void late;
      await rastP.preload(FONTS.map((p) => ({ family: 'boo-' + p.replace(/[^\w]/g, '_'), data: files.read(p)! })));
      const g = new Game({
        files, rast: rastP, audio,
        userRead: (p) => mem.get(p),
        userWrite: (p, d) => { if (!looksSaved(p, d)) return; mem.set(p, d); store(p, d); },
        print: (s) => { if (import.meta.env.DEV) console.log(s); },
      });
      g.onExit = () => { state.exited = true; };
      g.boot();
      game = g;
      stopAutosave = startAutosave(ctl);
      // write everything again when the page hides or closes (a write that failed earlier gets another chance)
      const flush = (): void => { for (const [k, v] of mem) store(k, v); };
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
      window.addEventListener('pagehide', flush);
      state.loaded = true;
      if (import.meta.env.DEV) (window as unknown as { __boo: Game }).__boo = g;
      const ctx = canvas.getContext('2d')!;
      let image: ImageData | null = null;   // one ImageData over the frame buffer, reused every frame
      let last = performance.now(), acc = 0;
      const frame = (now: number): void => {
        if (stopped) return;
        raf = requestAnimationFrame(frame);
        acc += Math.min(250, now - last); last = now;
        let ticks = 0;
        while (acc >= TICK_MS && ticks < 6) { g.tick(); acc -= TICK_MS; ticks++; }
        if (ticks === 0) return;
        const fb = g.render();
        image ??= new ImageData(fb.data, fb.w, fb.h);
        ctx.putImageData(image, 0, 0);
      };
      raf = requestAnimationFrame(frame);
    } catch (e) {
      console.error(e);
      state.error = String(e);
    }
  })();

  const onKey = (down: boolean) => (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Enter', 'Escape', 'KeyX', 'KeyS', 'KeyA', 'KeyZ', 'KeyC', 'Numpad1', 'Numpad2', 'Numpad3', 'Numpad4', 'Numpad6', 'Numpad7', 'Numpad8', 'Numpad9'].includes(e.code)) e.preventDefault();
    if (down) audio.unlock();
    if (e.repeat) return;
    ctl.key(e.code, down);
  };
  window.addEventListener('keydown', onKey(true));
  window.addEventListener('keyup', onKey(false));
  window.addEventListener('blur', () => game?.input.releaseAll());
  return ctl;
}
