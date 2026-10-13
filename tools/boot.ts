// boots the original game in Node: tsx tools/boot.ts <ticks> [shot ticks...]
import { mkdirSync } from 'node:fs';
import { Game } from '../src/engine/game';
import { folderFiles, CanvasRasterizer, savePng } from './node_host';

const ROOT = 'F:/Games/Boo-PortWeb/boo-portweb/research/deb/usr/share/boo-trojanchicken';
const total = +(process.argv[2] ?? 100);
const args = process.argv.slice(3);
const shots = new Set(args.filter(a => /^\d+$/.test(a)).map(Number));
// key events: <tick>:<code>  (press at that tick, release 2 ticks later)
const keys = args.filter(a => a.includes(':')).map(a => { const [t, c] = a.split(':'); return { t: +t, c }; });
mkdirSync('research/boot', { recursive: true });
const store = new Map<string, string>();
const g = new Game({ files: folderFiles(ROOT), rast: new CanvasRasterizer(), userRead: (p) => store.get(p), userWrite: (p, d) => { store.set(p, d); }, print: (s) => console.log(s) });
if (process.env.TRACE_REQ) { const rq = g.L.globals.get('require'); g.L.globals.set('require', (...a: any[]) => { console.log('require', a[0]); return g.L.callArr(rq, a); }); }
g.boot();
for (let i = 1; i <= total; i++) {
  for (const k of keys) { if (k.t === i) g.input.keyDown(k.c); if (k.t + 2 === i) g.input.keyUp(k.c); }
  g.tick();
  if (shots.has(i)) { savePng(g.render(), `research/boot/t${i}.png`); console.log('shot', i); }
}
if (process.env.EVAL) { const { compileChunk } = await import('../src/lua/compile'); const r = g.L.pcall(compileChunk(g.L, process.env.EVAL, '=eval'), []); console.log('eval:', r.ok ? r.r : r.err); }
console.log('ticks done, errors:', g.errors.length);
