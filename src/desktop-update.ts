// Updates of the desktop version. The host (desktop/player) looks for a newer release of the repository on GitHub and calls these functions: a window with
// the changelog (the description of the release) and the buttons to download it. After an update, the first start shows "what's new" (whatsNew: true).
// The web version does not need this: it is always the latest one when the page is reloaded.
import { toHost } from './desktop';

interface UpdateInfo { version: string; current?: string; name?: string; body?: string; size?: number; whatsNew?: boolean }

declare global {
  interface Window {
    __booUpdate?: (info: UpdateInfo) => void;
    __booUpdateProgress?: (v: number) => void;
    __booUpdateNone?: (current: string) => void;
    __booUpdateError?: (msg: string) => void;
  }
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** a small subset of Markdown (headings, lists, bold, code, links as plain text) for the description of the release */
export function renderChangelog(md: string): string {
  const out: string[] = [];
  let list = false;
  const inline = (t: string): string => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  for (const raw of md.replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd();
    const li = /^\s*[-*]\s+(.*)$/.exec(line);
    if (li) { if (!list) { out.push('<ul>'); list = true; } out.push('<li>' + inline(li[1]) + '</li>'); continue; }
    if (list) { out.push('</ul>'); list = false; }
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    if (h) out.push('<h3>' + inline(h[1]) + '</h3>');
    else if (line.trim()) out.push('<p>' + inline(line) + '</p>');
  }
  if (list) out.push('</ul>');
  return out.join('');
}

const CSS = [
  '.boo-up{position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.72);padding:1rem;font:15px/1.45 "Segoe UI",system-ui,sans-serif}',
  '.boo-up>div{width:min(34rem,100%);max-height:100%;display:flex;flex-direction:column;background:#1f1a13;color:#f1e6c8;border:1px solid #4a3c28;border-radius:14px;padding:18px 20px;box-shadow:0 12px 50px #000a}',
  '.boo-up h2{margin:0;color:#e8b84a;font-size:19px}.boo-up .sub{color:#a89c82;font-size:13px;margin:2px 0 10px}',
  '.boo-up .log{overflow:auto;background:#14100c;border:1px solid #3a2f20;border-radius:9px;padding:6px 14px;max-height:46vh;margin-bottom:12px}',
  '.boo-up .log h3{margin:10px 0 2px;font-size:14.5px;color:#e8b84a}.boo-up .log p{margin:6px 0}.boo-up .log ul{margin:6px 0;padding-left:20px}.boo-up code{background:#2c2418;padding:0 4px;border-radius:4px}',
  '.boo-up .row{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}',
  '.boo-up button{background:#2c2418;color:#f1e6c8;border:1px solid #4a3c28;border-radius:8px;padding:8px 14px;font:600 14px "Segoe UI",system-ui;cursor:pointer}',
  '.boo-up button:hover{border-color:#e8b84a}.boo-up button.go{background:#c4372a;border-color:#e5584a;color:#fff}.boo-up button:disabled{opacity:.55;cursor:default}',
  '.boo-up .bar{height:9px;background:#0f0c08;border-radius:99px;overflow:hidden;border:1px solid #3a2f20;margin:4px 0 12px}',
  '.boo-up .bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#c8a24a,#f0d27a)}.boo-up .err{color:#ff9b8f;margin:0 0 10px}',
].join('\n');

let box: HTMLDivElement | null = null;
const closeBox = (): void => { box?.remove(); box = null; };
function open(inner: string): HTMLDivElement {
  closeBox();
  if (!document.getElementById('boo-up-css')) { const st = document.createElement('style'); st.id = 'boo-up-css'; st.textContent = CSS; document.head.appendChild(st); }
  const el = document.createElement('div');
  el.className = 'boo-up';
  el.innerHTML = '<div>' + inner + '</div>';
  document.body.appendChild(el);
  box = el;
  return el;
}
const mb = (n?: number): string => (n ? ' (' + (n / 1048576).toFixed(1) + ' MB)' : '');

export function installUpdateUi(): void {
  window.__booUpdate = (info: UpdateInfo) => {
    const log = renderChangelog(info.body || '') || '<p>Esta versión no tiene descripción.</p>';
    if (info.whatsNew) {
      const el = open('<h2>¡Juego actualizado a la versión ' + esc(info.version) + '!</h2><div class="sub">' + esc(info.name || '') + ' · Novedades</div><div class="log">' + log + '</div><div class="row"><button class="go" id="up-ok">Entendido</button></div>');
      el.querySelector('#up-ok')!.addEventListener('click', closeBox);
      return;
    }
    const el = open('<h2>Hay una actualización disponible</h2><div class="sub">Versión ' + esc(info.version) + (info.current ? ' (tienes la ' + esc(info.current) + ')' : '') + esc(mb(info.size)) + (info.name ? ' · ' + esc(info.name) : '') + '</div>'
      + '<div class="log">' + log + '</div><div id="up-err" class="err"></div><div class="bar" id="up-bar" style="display:none"><i id="up-fill"></i></div>'
      + '<div class="row"><button id="up-skip">Omitir esta versión</button><button id="up-page">Ver en GitHub</button><button id="up-later">Más tarde</button><button class="go" id="up-dl">Descargar e instalar</button></div>');
    const q = (id: string): HTMLElement => el.querySelector('#' + id) as HTMLElement;
    q('up-later').addEventListener('click', closeBox);
    q('up-skip').addEventListener('click', () => { toHost('update_skip'); closeBox(); });
    q('up-page').addEventListener('click', () => toHost('update_page'));
    q('up-dl').addEventListener('click', () => {
      (q('up-dl') as HTMLButtonElement).disabled = true; q('up-dl').textContent = 'Descargando…';
      q('up-err').textContent = ''; q('up-bar').style.display = 'block';
      toHost('update_download');
    });
  };
  window.__booUpdateProgress = (v: number) => {
    const f = document.getElementById('up-fill'); if (f) f.style.width = Math.round(v * 100) + '%';
    if (v >= 1) { const b = document.getElementById('up-dl'); if (b) b.textContent = 'Abriendo el instalador…'; }
  };
  window.__booUpdateNone = (current: string) => {
    const el = open('<h2>Todo al día</h2><div class="sub">Tienes la última versión (' + esc(current) + ').</div><div class="row"><button class="go" id="up-ok">Aceptar</button></div>');
    el.querySelector('#up-ok')!.addEventListener('click', closeBox);
  };
  window.__booUpdateError = (msg: string) => {
    const e = document.getElementById('up-err');
    if (e) {
      e.textContent = msg;
      const b = document.getElementById('up-dl') as HTMLButtonElement | null;
      if (b) { b.disabled = false; b.textContent = 'Descargar e instalar'; }
      const bar = document.getElementById('up-bar'); if (bar) bar.style.display = 'none';
      return;
    }
    const el = open('<h2>No se pudo buscar actualizaciones</h2><div class="sub">Revisa tu conexión a internet.</div><div class="err">' + esc(msg) + '</div><div class="row"><button class="go" id="up-ok">Aceptar</button></div>');
    el.querySelector('#up-ok')!.addEventListener('click', closeBox);
  };
}
