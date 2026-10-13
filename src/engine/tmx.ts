// Reader of the Tiled (.tmx, csv) maps of the game: tile layers with their `layer` property, tilesets and the "collisions" layer
export interface TmxTileset { firstgid: number; name: string; tilew: number; theight: number; image: string; trans: string | null; imgw: number; imgh: number }
export interface TmxLayer { name: string; width: number; height: number; props: Record<string, string>; data: number[]; visible: boolean; opacity: number }
export interface Tmx { width: number; height: number; tilew: number; tileh: number; tilesets: TmxTileset[]; layers: TmxLayer[] }

function attrs(tag: string): Record<string, string> {
  const o: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:-]+)="([^"]*)"/g)) o[m[1]] = m[2];
  return o;
}

export function parseTmx(text: string): Tmx {
  const head = attrs(/<map\b[^>]*>/.exec(text)![0]);
  const tilesets: TmxTileset[] = [];
  for (const m of text.matchAll(/<tileset\b([^>]*)>\s*<image\b([^>]*)\/>/g)) {
    const a = attrs(m[1]), i = attrs(m[2]);
    tilesets.push({ firstgid: +a.firstgid, name: a.name ?? '', tilew: +a.tilewidth, theight: +a.tileheight, image: i.source, trans: i.trans ?? null, imgw: +i.width, imgh: +i.height });
  }
  const layers: TmxLayer[] = [];
  for (const m of text.matchAll(/<layer\b([^>]*)>([\s\S]*?)<\/layer>/g)) {
    const a = attrs(m[1]);
    const props: Record<string, string> = {};
    for (const p of m[2].matchAll(/<property\b([^>]*)\/>/g)) { const q = attrs(p[1]); props[q.name] = q.value; }
    const d = /<data\b[^>]*>([\s\S]*?)<\/data>/.exec(m[2]);
    const data = d ? d[1].split(',').map(s => parseInt(s.trim(), 10) || 0) : [];
    layers.push({ name: a.name, width: +a.width, height: +a.height, props, data, visible: a.visible !== '0', opacity: a.opacity ? +a.opacity : 1 });
  }
  return { width: +head.width, height: +head.height, tilew: +head.tilewidth, tileh: +head.tileheight, tilesets, layers };
}
