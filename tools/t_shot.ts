// tsx tools/t_shot.ts <map> <x> <y> [out.png] [inputs comma]   puts the player there and takes a picture
import { mkMap } from './lib_play';
import { savePng } from './node_host';
const [map, x, y, out = 'research/boot/shot.png', inp = ''] = process.argv.slice(2);
const p = mkMap(map, inp ? inp.split(',') : []);
p.tick(80);
p.run(`g_PlayerM.player.p.x = ${x} g_PlayerM.player.p.y = ${y}`);
p.tick(40);
savePng(p.g.render(), out);
console.log(p.errors());
