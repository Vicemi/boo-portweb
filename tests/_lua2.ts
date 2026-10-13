import { Game } from '../src/engine/game';
import { folderFiles, CanvasRasterizer } from '../tools/node_host';
import { compileChunk } from '../src/lua/compile';
const g = new Game({ files: folderFiles('F:/Games/Boo-PortWeb/boo-portweb/research/deb/usr/share/boo-trojanchicken'), rast: new CanvasRasterizer(), print: (s) => console.log(s) });
try { g.boot(); } catch (e) { console.log('boot failed'); }
const fn = compileChunk(g.L, process.argv[2], '=t');
const r = g.L.pcall(fn, []);
if (!r.ok) console.log('ERR', r.err);
