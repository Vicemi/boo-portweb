// boots the original game in Node: tsx tools/boot.ts <ticks> [shot ticks...]
import { mkdirSync } from 'node:fs';
import { Game } from '../src/engine/game';
import { folderFiles, CanvasRasterizer, savePng } from './node_host';

const ROOT = 'F:/Games/Boo-PortWeb/boo-portweb/research/deb/usr/share/boo-trojanchicken';
const total = +(process.argv[2] ?? 100);
const shots = new Set(process.argv.slice(3).map(Number));
mkdirSync('research/boot', { recursive: true });
const store = new Map<string, string>();
const g = new Game({ files: folderFiles(ROOT), rast: new CanvasRasterizer(), userRead: (p) => store.get(p), userWrite: (p, d) => { store.set(p, d); }, print: (s) => console.log(s) });
if (process.env.TRACE_REQ) { const rq = g.L.globals.get('require'); g.L.globals.set('require', (...a: any[]) => { console.log('require', a[0]); return g.L.callArr(rq, a); }); }
g.boot();
for (let i = 1; i <= total; i++) {
  g.tick();
  if (shots.has(i)) { savePng(g.render(), `research/boot/t${i}.png`); console.log('shot', i); }
}
console.log('ticks done, errors:', g.errors.length);
