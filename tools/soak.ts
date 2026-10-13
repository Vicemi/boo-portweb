// plays every map for a while with random keys and reports the Lua errors: tsx tools/soak.ts [ticks] [map...]
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { Game } from '../src/engine/game';
import { folderFiles, CanvasRasterizer, savePng } from './node_host';

const ROOT = 'F:/Games/Boo-PortWeb/Boo.activity';
const ticks = +(process.argv[2] ?? 1500);
const maps = process.argv.length > 3 ? process.argv.slice(3) : readdirSync(ROOT + '/assets/maps').filter(f => f.endsWith('.tmx') && !f.startsWith('_')).map(f => f.replace('.tmx', ''));
mkdirSync('research/soak', { recursive: true });
const rast = new CanvasRasterizer();
const pad = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyS', 'KeyA', 'KeyX'];
for (const map of maps) {
  const store = new Map<string, string>();
  const g = new Game({ files: folderFiles(ROOT), rast, userRead: (p) => store.get(p), userWrite: (p, d) => { store.set(p, d); }, print: () => {} });
  const script = `package.loaded["development"] = true\nENABLE_SOUNDS=true ENABLE_GHOSTS=true ENABLE_PERSISTANCE=true ENABLE_SCREEN=false\nMAP_TO_LOAD="${map}"\nlocal f = loadfile("src/start.lua") f()\n`;
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  let status = 'ok';
  try {
    g.boot(new TextEncoder().encode(script));
    let held = '';
    for (let i = 1; i <= ticks; i++) {
      if (i % 10 === 0) { if (held) { g.input.keyUp(held); held = ''; } if (rnd() < 0.85) { held = pad[Math.floor(rnd() * pad.length)]; g.input.keyDown(held); } }
      g.tick();
      if (i === ticks) savePng(g.render(), `research/soak/${map}.png`);
    }
  } catch (e) { status = 'BOOT FAIL ' + String(e).split('\n').slice(0, 2).join(' | '); }
  const errs = [...new Set(g.errors.map(x => x.split('\n').slice(0, 2).join(' | ')))];
  console.log(map.padEnd(18), status, errs.length ? errs.slice(0, 3).join('  ##  ') : '');
}
