// The bridge with the desktop version (desktop/ : a Rust program that shows the game in its own window). It is only active inside that window, where the
// host sets window.__BOO_DESKTOP__ and gives window.ipc. The saves live in the installation folder: the host hands the last one to the page before the game
// starts (restoreFromHost) and the page sends every change back (startAutosave). On the web nothing here does anything.
import type { BooController } from './web/host';

declare global {
  interface Window {
    ipc?: { postMessage(message: string): void };
    __BOO_DESKTOP__?: boolean;
    __BOO_SAVE__?: string | null;
    __booSaveNow?: () => void;
    __booSaveAs?: () => void;
    __booImport?: (text: string) => void;
  }
}

export const isDesktop = (): boolean => typeof window !== 'undefined' && !!window.__BOO_DESKTOP__ && !!window.ipc;
export const toHost = (t: string, data?: unknown): void => { try { window.ipc?.postMessage(JSON.stringify({ t, data })); } catch { /* none */ } };

function parseSave(text: string): Record<string, string> {
  const o = JSON.parse(text) as { game?: string; format?: number; files?: Record<string, unknown> };
  if (o.game !== 'boo' || o.format !== 1 || !o.files || typeof o.files !== 'object') throw new Error('not a save');
  const files: Record<string, string> = {};
  for (const [k, v] of Object.entries(o.files)) if (typeof v === 'string' && /^[\w.\-/]+$/.test(k) && !k.includes('..')) files[k] = v;
  return files;
}

/** the save of the installation folder (null when there is none or the page is not in the desktop window) */
export function savedFromHost(): Record<string, string> | null {
  if (!isDesktop() || !window.__BOO_SAVE__) return null;
  try { return parseSave(window.__BOO_SAVE__); } catch { return null; /* damaged file: the game starts clean */ }
}

/** sends the save to the host every time it changes, when the window hides and on demand; returns a function that stops it */
export function startAutosave(ctl: BooController): () => void {
  if (!isDesktop()) return () => {};
  let last = '';
  const snapshot = (): string => { const o = JSON.parse(ctl.exportSave()); delete o.saved; return JSON.stringify(o); };
  const send = (force: boolean): void => {
    const now = snapshot();
    if (!force && now === last) return;
    last = now;
    toHost('save', ctl.exportSave());
  };
  last = snapshot();
  const id = window.setInterval(() => send(false), 10000);
  const onHide = (): void => { if (document.visibilityState === 'hidden') send(false); };
  const onUnload = (): void => send(false);
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('beforeunload', onUnload);
  window.__booSaveNow = () => send(true);
  window.__booSaveAs = () => toHost('saveas', ctl.exportSave());
  window.__booImport = (text: string) => { ctl.importSave(text); location.reload(); };
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'F11') { e.preventDefault(); toHost('fullscreen'); } };
  window.addEventListener('keydown', onKey);
  return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', onHide); window.removeEventListener('beforeunload', onUnload); window.removeEventListener('keydown', onKey); };
}
