import { useEffect, useRef, useState } from 'react';
import { startBoo, type BooController } from '../web/host';
import { isDesktop } from '../desktop';
import { installUpdateUi } from '../desktop-update';

/** a round button of the phone gamepad: it keeps a game key down while the finger is on it */
function Pad({ ctl, code, label, cls }: { ctl: React.RefObject<BooController | null>; code: string; label: string; cls: string }) {
  return (
    <button className={'boo-pad ' + cls} aria-label={label}
      onPointerDown={(e) => { e.preventDefault(); (e.target as HTMLElement).setPointerCapture(e.pointerId); ctl.current?.audio.unlock(); ctl.current?.key(code, true); }}
      onPointerUp={() => ctl.current?.key(code, false)} onPointerCancel={() => ctl.current?.key(code, false)}
      onContextMenu={(e) => e.preventDefault()}>{label}</button>
  );
}

/** the 600x450 screen of the game, scaled to the window, plus the loading bar, the buttons and (on touch screens) the gamepad */
export default function BooGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const ctlRef = useRef<BooController | null>(null);
  const [progress, setProgress] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exited, setExited] = useState(false);
  const [mute, setMute] = useState(false);
  const [info, setInfo] = useState(false);
  const [full, setFull] = useState(false);
  const [touch, setTouch] = useState(false);
  const [portrait, setPortrait] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const canFull = typeof document !== 'undefined' && !!document.fullscreenEnabled;

  useEffect(() => {
    if (isDesktop()) installUpdateUi();
    const ctl = startBoo(canvasRef.current!, import.meta.env.BASE_URL.replace(/\/$/, '') + '/game');
    ctlRef.current = ctl;
    if (import.meta.env.DEV) (window as unknown as { __ctl: BooController }).__ctl = ctl;
    const id = window.setInterval(() => { setProgress(ctl.state.progress); setLoaded(ctl.state.loaded); setError(ctl.state.error); setExited(ctl.state.exited); }, 100);
    return () => { window.clearInterval(id); ctl.stop(); };
  }, []);
  useEffect(() => {
    const onChange = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    const q = window.matchMedia('(orientation: portrait) and (max-width: 900px)');
    const f = () => setPortrait(q.matches);
    f(); q.addEventListener('change', f);
    const t = () => setTouch(true);
    window.addEventListener('touchstart', t, { once: true, passive: true });
    return () => { document.removeEventListener('fullscreenchange', onChange); q.removeEventListener('change', f); window.removeEventListener('touchstart', t); };
  }, []);

  const toggleFull = () => {
    if (document.fullscreenElement) { void document.exitFullscreen?.(); return; }
    void stageRef.current?.requestFullscreen?.();
    try { void (window.screen as unknown as { orientation?: { lock?: (o: string) => Promise<void> } }).orientation?.lock?.('landscape'); } catch { /* unsupported */ }
  };
  const saveProgress = () => {
    const blob = new Blob([ctlRef.current!.exportSave()], { type: 'application/json' });
    const a = document.createElement('a');
    const d = new Date();
    a.href = URL.createObjectURL(blob);
    a.download = `boo-progreso-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    setNote('Progreso guardado en el archivo ' + a.download);
  };
  const loadProgress = async (file: File | undefined) => {
    if (!file) return;
    try {
      const n = ctlRef.current!.importSave(await file.text());
      setNote(`Progreso cargado (${n} archivos). Reiniciando…`);
      setTimeout(() => location.reload(), 800);
    } catch (e) { setNote((e as Error).message); }
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="boo-stage" ref={stageRef}>
      <canvas ref={canvasRef} className="boo-canvas" width={600} height={450} tabIndex={0} aria-label="Boo" />
      {!loaded && !error && (
        <div className="boo-loading"><span>Cargando… {Math.round(progress * 100)}%</span><div className="boo-bar"><i style={{ width: `${progress * 100}%` }} /></div></div>
      )}
      {error && <div className="boo-loading"><span>No se pudo cargar el juego.</span><small>{error}</small></div>}
      {exited && <div className="boo-loading" onPointerDown={() => location.reload()}><span>Juego cerrado</span><small>Toca o pulsa para volver a empezar</small></div>}
      {touch && loaded && (
        <div className="boo-gamepad">
          <div className="boo-dpad">
            <Pad ctl={ctlRef} code="ArrowUp" label="▲" cls="up" /><Pad ctl={ctlRef} code="ArrowLeft" label="◀" cls="lf" />
            <Pad ctl={ctlRef} code="ArrowRight" label="▶" cls="rt" /><Pad ctl={ctlRef} code="ArrowDown" label="▼" cls="dn" />
          </div>
          <div className="boo-actions">
            <Pad ctl={ctlRef} code="Space" label="OK" cls="a1" /><Pad ctl={ctlRef} code="KeyS" label="S" cls="a2" /><Pad ctl={ctlRef} code="KeyA" label="A" cls="a3" />
          </div>
        </div>
      )}
      {portrait && loaded && (
        <div className="boo-rotate" onPointerDown={(e) => { (e.currentTarget as HTMLElement).style.display = 'none'; }}>
          <div>↻<br />Gira el teléfono para jugar mejor<br /><small>(toca para continuar así)</small></div>
        </div>
      )}
      {!isDesktop() && <div className="boo-tools">
        {touch && <button className="boo-btn" aria-label="Menú / Escape" onPointerDown={(e) => { e.preventDefault(); ctlRef.current?.audio.unlock(); ctlRef.current?.key('Escape', true); }} onPointerUp={() => ctlRef.current?.key('Escape', false)}>☰</button>}
        {canFull && <button className="boo-btn" aria-label="Pantalla completa" onClick={toggleFull}>{full ? '✕' : '⛶'}</button>}
        <button className="boo-btn" aria-label={mute ? 'Activar sonido' : 'Silenciar'} onClick={() => { const c = ctlRef.current!; c.audio.setMuted(!c.audio.muted); setMute(c.audio.muted); c.audio.unlock(); }}>{mute ? '🔇' : '🔊'}</button>
        <button className="boo-btn" aria-label="Guardar progreso en un archivo" title="Guardar progreso en un archivo" onClick={saveProgress}>💾</button>
        <button className="boo-btn" aria-label="Cargar progreso desde un archivo" title="Cargar progreso desde un archivo" onClick={() => fileRef.current?.click()}>📂</button>
        <button className="boo-btn" aria-label="Créditos" onClick={() => setInfo(true)}>i</button>
      </div>}
      <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => void loadProgress(e.target.files?.[0])} />
      {note && <div className="boo-note" role="status" onClick={() => setNote(null)}>{note}</div>}
      {info && (
        <div className="boo-modal" onClick={() => setInfo(false)}>
          <div className="boo-card" onClick={(e) => e.stopPropagation()}>
            <h1>Boo</h1>
            <p>Un juego de <b>Trojan Chicken</b> para las laptops XO del programa Plan Ceibal / One Laptop per Child (actividad Sugar).</p>
            <p>Controles: flechas para moverte, <b>S</b> para hablar / avanzar los diálogos, <b>A</b> para el flash, <b>Espacio</b> o <b>X</b> para elegir en los menús, <b>Esc</b> o <b>Z</b> para volver. Tu progreso se guarda en este navegador (con 💾 y 📂 puedes llevarlo a un archivo).</p>
            <p>Versión recreada por <b><a href="https://vicemi.dev" target="_blank" rel="noreferrer">Vicemi Dev (vicemi.dev)</a></b>: el motor se reescribió en TypeScript y ejecuta el código Lua original del juego, con todos sus recursos originales.</p>
            <button className="boo-close" onClick={() => setInfo(false)}>Cerrar</button>
          </div>
        </div>
      )}
    </div>
  );
}
