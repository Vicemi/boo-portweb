import { mkGame, status } from './lib_play';
import { savePng } from './node_host';
const p = mkGame();
console.log('t0', status(p));
for (let i = 0; i < 4; i++) { p.press('Space', 2, 4); console.log('open', i, status(p)); }
p.press('Space', 2, 4); console.log('slot1', status(p));
p.press('Space', 2, 4); console.log('continue', status(p));
p.tick(20); console.log('loading', status(p));
p.tick(20); console.log('after load', status(p));
savePng(p.g.render(), 'research/boot/m1.png');
for (let i = 0; i < 6; i++) { p.press('Space', 2, 10); console.log('intro', i, status(p)); }
p.tick(100); console.log('ingame', status(p));
savePng(p.g.render(), 'research/boot/m2.png');
console.log(p.errors(), [...p.store.keys()]);
