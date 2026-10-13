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

function userFiles(): Record<string, string> {
  const out: Record<string, string> = {};
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i)!; if (k.startsWith(PREFIX)) out[k.slice(PREFIX.length)] = localStorage.getItem(k)!; } } catch { /* no storage */ }
  return out;
}

export function startBoo(canvas: HTMLCanvasElement, base: string): BooController {
  const state = { progress: 0, loaded: false, error: null as string | null, exited: false };
  const audio = new WebAudio(`${base}/sounds`);
  const mem = new Map<string, string>(Object.entries(userFiles()));   // fallback when the storage is not available
  const hostSave = savedFromHost();   // desktop version: the save of the installation folder wins
  if (hostSave) for (const [k, v] of Object.entries(hostSave)) { mem.set(k, v); try { localStorage.setItem(PREFIX + k, v); } catch { /* full */ } }
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
        userWrite: (p, d) => { mem.set(p, d); try { localStorage.setItem(PREFIX + p, d); } catch { /* full */ } },
        print: (s) => { if (import.meta.env.DEV) console.log(s); },
      });
      g.onExit = () => { state.exited = true; };
      g.boot();
      game = g;
      stopAutosave = startAutosave(ctl);
      state.loaded = true;
      if (import.meta.env.DEV) (window as unknown as { __boo: Game }).__boo = g;
      const ctx = canvas.getContext('2d')!;
      let last = performance.now(), acc = 0;
      const frame = (now: number): void => {
        if (stopped) return;
        raf = requestAnimationFrame(frame);
        acc += Math.min(250, now - last); last = now;
        let ticks = 0;
        while (acc >= TICK_MS && ticks < 6) { g.tick(); acc -= TICK_MS; ticks++; }
        if (ticks === 0) return;
        const fb = g.render();
        ctx.putImageData(new ImageData(fb.data, fb.w, fb.h), 0, 0);
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
