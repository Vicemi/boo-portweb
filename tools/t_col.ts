// tsx tools/t_col.ts <map>  ascii dump of the collision grid with the doors, start and objects marked
import { readFileSync } from 'node:fs';
import { parseTmx } from '../src/engine/tmx';
import { ROOT } from './lib_play';
const map = process.argv[2];
const text = readFileSync(`${ROOT}/assets/maps/${map}.tmx`, 'latin1');
const tmx = parseTmx(text);
const col = tmx.layers.find(l => l.name === 'collisions')!;
const first = tmx.tilesets.find(t => t.name === 'collisions')?.firstgid ?? 1;
const grid: string[][] = [];
for (let y = 0; y < col.height; y++) { const r: string[] = []; for (let x = 0; x < col.width; x++) { const g = col.data[y * col.width + x]; r.push(g >= first && g < first + 5 ? '#12345'[g - first + 1] ?? '#' : '.'); } grid.push(r); }
const mark = (x: number, y: number, w: number, h: number, ch: string): void => {
  for (let yy = Math.floor(y / 30); yy <= Math.floor((y + Math.max(h, 1) - 1) / 30); yy++) for (let xx = Math.floor(x / 30); xx <= Math.floor((x + Math.max(w, 1) - 1) / 30); xx++) if (grid[yy]?.[xx] !== undefined) grid[yy][xx] = grid[yy][xx] === '.' ? ch : grid[yy][xx].toLowerCase() === grid[yy][xx] ? ch : '*';
};
for (const m of text.matchAll(/<object name="([^"]*)"(?: gid="\d+")? x="(-?[\d.]+)" y="(-?[\d.]+)"(?: width="([\d.]+)" height="([\d.]+)")?/g)) {
  const [, n, x, y, w, h] = m;
  const ch = n.startsWith('door_') ? n.slice(5, 6).toUpperCase() : n === 'start' ? 'S' : n.startsWith('tri_') ? 't' : 'o';
  mark(+x, +y, +(w ?? 0), +(h ?? 0), ch);
}
console.log(map, col.width + 'x' + col.height);
console.log('    ' + [...Array(col.width).keys()].map(i => i % 10).join(''));
grid.forEach((r, i) => console.log(String(i).padStart(3) + ' ' + r.join('')));
