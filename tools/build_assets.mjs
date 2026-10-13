// Packs the files of the original game for the browser: node tools/build_assets.mjs [path of Boo.activity]
//   public/game/core.pak   the Lua bytecode, data (csv / tmx), fonts and the images the first screens and the first levels need (the game starts with it)
//   public/game/late.pak   the images of the bosses, ghosts and characters (downloaded in the background; an image that has not arrived yet is just not drawn)
//   public/game/index.json path -> [pak, offset, length, width, height]
//   public/game/sounds/    the .ogg files, fetched when they are first played
import { readdirSync, readFileSync, writeFileSync, mkdirSync, statSync, copyFileSync, rmSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';

const ROOT = process.argv[2] ?? 'F:/Games/Boo-PortWeb/Boo.activity';
const OUT = 'public/game';
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT + '/sounds', { recursive: true });

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p); else yield p;
  }
}
const rel = (p) => relative(ROOT, p).replace(/\\/g, '/');

const core = [], late = [];
for (const dir of ['src', 'assets']) {
  for (const f of walk(join(ROOT, dir))) {
    const r = rel(f);
    if (r.endsWith('.ogg')) {
      mkdirSync(dirname(join(OUT, 'sounds', r.replace(/^assets\/sounds\//, ''))), { recursive: true });
      copyFileSync(f, join(OUT, 'sounds', r.replace(/^assets\/sounds\//, '')));
      continue;
    }
    if (r.endsWith('.png') && (r.startsWith('assets/boss/') || r.startsWith('assets/ghosts/') || /^assets\/chars\/npc_/.test(r))) late.push(f); else core.push(f);
  }
}

const index = {};
function pack(name, files, i) {
  const chunks = [];
  let off = 0;
  for (const f of files.sort()) {
    const b = readFileSync(f);
    const r = rel(f);
    const e = [i, off, b.length];
    if (r.endsWith('.png')) e.push(b.readUInt32BE(16), b.readUInt32BE(20));
    index[r] = e;
    chunks.push(b); off += b.length;
  }
  writeFileSync(join(OUT, name), Buffer.concat(chunks));
  console.log(name, files.length, 'files', (off / 1048576).toFixed(1), 'MB');
}
pack('core.pak', core, 0);
pack('late.pak', late, 1);
writeFileSync(join(OUT, 'index.json'), JSON.stringify(index));
console.log('index', Object.keys(index).length, 'entries');
void statSync;
