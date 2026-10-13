// Tiled maps: the tile layers become renderables, the "collisions" layer the collision map
import { LuaTable } from '../lua/value';
import { LObj } from './luabind';
import { Renderable, type DrawCtx } from './scene';
import { Texture } from './gfx';
import { CollisionMap, TILE } from './collision';
import { parseTmx, type Tmx, type TmxLayer } from './tmx';

export interface TilesetTex { firstgid: number; tilew: number; tileh: number; cols: number; tex: Texture }

/** one layer of tiles, drawn as a whole */
export class TileMap extends Renderable {
  static luaName = 'TileMap';
  constructor(public layer: TmxLayer, public tilesets: TilesetTex[], public w: number, public h: number, public tw: number, public th: number) { super(); }
  draw(ctx: DrawCtx, ox: number, oy: number): void {
    const { layer, tilesets, tw, th } = this;
    const fb = ctx.fb;
    // only the cells that can be on the screen
    const c0 = Math.max(0, Math.floor(-ox / tw) - 3), c1 = Math.min(layer.width - 1, Math.ceil((fb.cx1 - ox) / tw) + 1);
    const r0 = Math.max(0, Math.floor(-oy / th) - 8), r1 = Math.min(layer.height - 1, Math.ceil((fb.cy1 - oy) / th) + 8);
    for (let cy = r0; cy <= r1; cy++) {
      for (let cx = c0; cx <= c1; cx++) {
        const gid = layer.data[cy * layer.width + cx];
        if (gid === 0) continue;
        let ts: TilesetTex | null = null;
        for (let i = tilesets.length - 1; i >= 0; i--) if (tilesets[i].firstgid <= gid) { ts = tilesets[i]; break; }
        if (!ts) continue;
        const idx = gid - ts.firstgid;
        const sx = (idx % ts.cols) * ts.tilew, sy = Math.floor(idx / ts.cols) * ts.tileh;
        // tiles taller than the cell grow upwards from the bottom of their cell
        const dx = ox + cx * tw, dy = oy + (cy + 1) * th - ts.tileh;
        const bm = ts.tex.bitmap();
        if (bm) fb.blit(bm, sx, sy, ts.tilew, ts.tileh, Math.round(dx), Math.round(dy));
      }
    }
  }
}
LObj.bind(TileMap, { get: { w: (s: TileMap) => s.w, h: (s: TileMap) => s.h } });

export class MapData extends LObj {
  static luaName = 'MapData';
  renderables = new LuaTable();
  constructor(public collision: CollisionMap, public width: number, public height: number) { super(); }
}
LObj.bind(MapData, {
  get: { renderables: (s: MapData) => s.renderables, collidable: (s: MapData) => s.collision, width: (s: MapData) => s.width, height: (s: MapData) => s.height },
  methods: { get_collidable: (s: MapData) => s.collision },
});

export function buildMap(tmx: Tmx, tex: (source: string, trans: string | null, w: number, h: number) => Texture): MapData {
  const tilesets: TilesetTex[] = tmx.tilesets.map(t => ({
    firstgid: t.firstgid, tilew: t.tilew, tileh: t.theight, cols: Math.max(1, Math.floor(t.imgw / t.tilew)),
    tex: tex(t.image, t.trans, t.imgw, t.imgh),
  }));
  const wpx = tmx.width * tmx.tilew, hpx = tmx.height * tmx.tileh;
  let collision = new CollisionMap(tmx.width, tmx.height, new Uint8Array(tmx.width * tmx.height));
  const data = new MapData(collision, wpx, hpx);
  for (const l of tmx.layers) {
    if (l.name === 'collisions') {
      const tiles = new Uint8Array(l.width * l.height);
      const first = tmx.tilesets.find(t => t.name === 'collisions')?.firstgid ?? 1;
      for (let i = 0; i < tiles.length; i++) { const g = l.data[i]; if (g >= first && g < first + 5) tiles[i] = g - first + 1; }
      collision = new CollisionMap(l.width, l.height, tiles);
      data.collision = collision;
      continue;
    }
    const key = Number(l.props.layer !== undefined ? l.props.layer : l.name);
    if (isNaN(key)) continue;
    data.renderables.set(key, new TileMap(l, tilesets, wpx, hpx, tmx.tilew, tmx.tileh));
  }
  return data;
}
export { parseTmx, TILE };
