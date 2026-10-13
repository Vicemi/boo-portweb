import { Game } from '../src/engine/game';
import { folderFiles, CanvasRasterizer } from '../tools/node_host';
import { compileChunk } from '../src/lua/compile';
const g = new Game({ files: folderFiles('x'), rast: new CanvasRasterizer() });
const fn = compileChunk(g.L, process.argv[2], '=t');
const r = g.L.pcall(fn, []);
if (!r.ok) console.log('ERR', r.err);
