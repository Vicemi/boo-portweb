import { readFileSync, readdirSync } from 'node:fs';
import { parseTmx } from '../src/engine/tmx';
const R='F:/Games/Boo-PortWeb/Boo.activity/assets/maps/';
for (const f of readdirSync(R).filter(f=>f.endsWith('.tmx'))) {
  const t=parseTmx(readFileSync(R+f,'latin1')); const c=t.layers.find(l=>l.name==='collisions');
  if(!c){console.log(f,'NO collisions layer');continue;}
  const s=new Set(c.data); console.log(f,[...s].sort((a,b)=>a-b).join(','), t.tilesets.find(x=>x.name==='collisions')?.firstgid);
}
