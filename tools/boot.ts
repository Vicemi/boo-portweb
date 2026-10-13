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
const g = new Game({ files: folderFiles(process.env.ROOT ?? ROOT), rast: new CanvasRasterizer(), userRead: (p) => store.get(p), userWrite: (p, d) => { store.set(p, d); }, print: (s) => console.log(s) });
if (process.env.TRACE_REQ) { const rq = g.L.globals.get('require'); g.L.globals.set('require', (...a: any[]) => { console.log('require', a[0]); return g.L.callArr(rq, a); }); }
if (process.env.START) { const { readFileSync } = await import('node:fs'); g.boot(new Uint8Array(readFileSync(process.env.START))); } else g.boot();
const soak = +(process.env.SOAK ?? 0);
let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pad = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyX', 'KeyS', 'KeyA', 'KeyZ', 'Space'];
let held = '';
for (let i = 1; i <= total; i++) {
  if (soak && i > soak && i % 12 === 0) { if (held) { g.input.keyUp(held); held = ''; } if (rnd() < 0.8) { held = pad[Math.floor(rnd() * pad.length)]; g.input.keyDown(held); } }
  for (const k of keys) { if (k.t === i) g.input.keyDown(k.c); if (k.t + 2 === i) g.input.keyUp(k.c); }
  g.tick();
  if (shots.has(i)) { savePng(g.render(), `research/boot/t${i}.png`); console.log('shot', i); }
}
if (process.env.EVAL) { const { compileChunk } = await import('../src/lua/compile'); const r = g.L.pcall(compileChunk(g.L, process.env.EVAL, '=eval'), []); console.log('eval:', r.ok ? r.r : r.err); }
if (process.env.DUMP) { const { writeFileSync } = await import('node:fs'); writeFileSync(process.env.DUMP_TO ?? 'research/boot/dump.txt', store.get(process.env.DUMP) ?? '', 'latin1'); }
console.log('store keys:', [...store.keys()].join(','));
console.log('ticks done, errors:', g.errors.length);
for (const e of new Set(g.errors.map(x => x.split(String.fromCharCode(10)).slice(0, 3).join(' | ')))) console.log('ERR', e);
