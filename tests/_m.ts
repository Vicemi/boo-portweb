import { readFileSync } from 'node:fs';
import { parseTmx } from '../src/engine/tmx';
const t = parseTmx(readFileSync('F:/Games/Boo-PortWeb/boo-portweb/research/deb/usr/share/boo-trojanchicken/assets/maps/flat_16_main.tmx', 'latin1'));
console.log(t.width, t.height, t.tilesets.map(s => `${s.firstgid}:${s.name}:${s.tilew}x${s.theight}:${s.image}`).join('\n'));
for (const l of t.layers) console.log(l.name, JSON.stringify(l.props), l.data.filter(v => v).length, 'visible', l.visible);
