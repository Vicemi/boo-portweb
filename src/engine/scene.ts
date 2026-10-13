// The scene graph of the original engine: render nodes, the renderables (textures, sprites, fills, lines, text, tile maps, layered maps) and the vectors.
import { LuaTable, type LuaValue } from '../lua/value';
import { LObj } from './luabind';
import { Framebuffer, Texture } from './gfx';

export function num(v: LuaValue, d = 0): number { return typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v)) ? Number(v) : d; }

// ============================================================================================================================================ Vector2f
export class Vec2 extends LObj {
  static luaName = 'Vector2f';
  constructor(public x = 0, public y = 0) { super(); }
  static of(v: LuaValue): { x: number; y: number } {
    if (v instanceof Vec2) return v;
    if (v instanceof LuaTable) return { x: num(v.get('x')), y: num(v.get('y')) };
    return { x: 0, y: 0 };
  }
}
LObj.bind(Vec2, {
  get: { x: (s: Vec2) => s.x, y: (s: Vec2) => s.y },
  set: { x: (s: Vec2, v) => { s.x = num(v); }, y: (s: Vec2, v) => { s.y = num(v); } },
  methods: { set: (s: Vec2, o) => { const p = Vec2.of(o); s.x = p.x; s.y = p.y; return s; } },
});

// ============================================================================================================================================ renderables
export interface DrawCtx { fb: Framebuffer }

export abstract class Renderable extends LObj {
  static luaName = 'Renderable2d';
  abstract draw(ctx: DrawCtx, ox: number, oy: number): void;
}

/** the Lua-visible Texture: it is also a renderable (a node can show a texture directly) */
export class TextureObj extends Renderable {
  static luaName = 'Texture';
  constructor(public tex: Texture) { super(); }
  get w(): number { return this.tex.w; }
  get h(): number { return this.tex.h; }
  draw(ctx: DrawCtx, ox: number, oy: number): void { ctx.fb.blit(this.tex.bitmap(), 0, 0, this.tex.w, this.tex.h, ox, oy); }
}
LObj.bind(TextureObj, { get: { w: (s: TextureObj) => s.tex.w, h: (s: TextureObj) => s.tex.h } });

export class Sprite extends Renderable {
  static luaName = 'Sprite';
  x = 0; y = 0; w = 0; h = 0; trans_x = 0; trans_y = 0;
  constructor(public texture: TextureObj) { super(); this.w = texture.w; this.h = texture.h; }
  draw(ctx: DrawCtx, ox: number, oy: number): void {
    ctx.fb.blit(this.texture.tex.bitmap(), this.x, this.y, this.w, this.h, Math.round(ox + this.trans_x), Math.round(oy + this.trans_y));
  }
}
LObj.bind(Sprite, {
  get: {
    x: (s: Sprite) => s.x, y: (s: Sprite) => s.y, w: (s: Sprite) => s.w, h: (s: Sprite) => s.h, trans_x: (s: Sprite) => s.trans_x, trans_y: (s: Sprite) => s.trans_y,
    texture: (s: Sprite) => s.texture,
  },
  set: {
    x: (s: Sprite, v) => { s.x = num(v); }, y: (s: Sprite, v) => { s.y = num(v); }, w: (s: Sprite, v) => { s.w = num(v); }, h: (s: Sprite, v) => { s.h = num(v); },
    trans_x: (s: Sprite, v) => { s.trans_x = num(v); }, trans_y: (s: Sprite, v) => { s.trans_y = num(v); },
    texture: (s: Sprite, v) => { s.texture = v; },
  },
});

export class Fill extends Renderable {
  static luaName = 'Fill';
  x = 0; y = 0; w = 0; h = 0; color = 0; alpha = 1;
  draw(ctx: DrawCtx, ox: number, oy: number): void { ctx.fb.fillRect(ox + this.x, oy + this.y, this.w, this.h, this.color & 0xffffff, this.alpha); }
}
LObj.bind(Fill, {
  get: { x: (s: Fill) => s.x, y: (s: Fill) => s.y, w: (s: Fill) => s.w, h: (s: Fill) => s.h, color: (s: Fill) => s.color, alpha: (s: Fill) => s.alpha },
  set: {
    x: (s: Fill, v) => { s.x = num(v); }, y: (s: Fill, v) => { s.y = num(v); }, w: (s: Fill, v) => { s.w = num(v); }, h: (s: Fill, v) => { s.h = num(v); },
    color: (s: Fill, v) => { s.color = num(v) >>> 0; }, alpha: (s: Fill, v) => { s.alpha = num(v); },
  },
});

/** a line (the original drew the shapes for debugging only; the game never turns that on) */
export class Line extends Renderable {
  static luaName = 'Line';
  from = new Vec2(); to = new Vec2(); w = 0; h = 0;
  constructor(a?: LuaValue, b?: LuaValue) { super(); if (a !== undefined) { const p = Vec2.of(a); this.from = new Vec2(p.x, p.y); } if (b !== undefined) { const p = Vec2.of(b); this.to = new Vec2(p.x, p.y); } }
  draw(): void { /* debug only */ }
}
LObj.bind(Line, { get: { from: (s: Line) => s.from, to: (s: Line) => s.to, w: (s: Line) => s.w, h: (s: Line) => s.h }, set: { from: (s: Line, v) => { s.from = v; }, to: (s: Line, v) => { s.to = v; } } });

// ============================================================================================================================================ render nodes
export class RenderChildren extends LObj {
  static luaName = 'RenderNodeChildren';
  items: Renderable[] = [];
  addChild(r: Renderable): void { if (!this.items.includes(r)) this.items.push(r); }
  removeChild(r: Renderable): void { const i = this.items.indexOf(r); if (i >= 0) this.items.splice(i, 1); }
}
LObj.bind(RenderChildren, {
  methods: {
    add_child: (s: RenderChildren, r: Renderable) => { s.addChild(r); },
    add_child_after: (s: RenderChildren, r: Renderable, after: Renderable) => {
      if (s.items.includes(r)) return;
      const i = s.items.indexOf(after);
      if (i < 0) s.items.push(r); else s.items.splice(i + 1, 0, r);
    },
    remove_child: (s: RenderChildren, r: Renderable) => { s.removeChild(r); },
  },
});

export class RenderNode extends Renderable {
  static luaName = 'RenderNode';
  p = new Vec2();
  enabled = true;
  absolute = false;
  renderable: Renderable | null = null;
  foreign: Vec2 | null = null;
  children = new RenderChildren();
  id = '';
  get w(): number { return 0; }
  get h(): number { return 0; }
  draw(ctx: DrawCtx, ox: number, oy: number): void {
    if (!this.enabled) return;
    let x = (this.absolute ? 0 : ox) + this.p.x, y = (this.absolute ? 0 : oy) + this.p.y;
    if (this.foreign !== null) { x += this.foreign.x; y += this.foreign.y; }
    if (this.renderable !== null) this.renderable.draw(ctx, x, y);
    const items = this.children.items;
    for (let i = 0; i < items.length; i++) items[i].draw(ctx, x, y);
  }
  /** position on the screen (for the sort of the layered renderables) */
  localY(): number { return this.p.y + (this.foreign !== null ? this.foreign.y : 0); }
}
LObj.bind(RenderNode, {
  get: {
    p: (s: RenderNode) => s.p, enabled: (s: RenderNode) => s.enabled, absolute: (s: RenderNode) => s.absolute, children: (s: RenderNode) => s.children,
    renderable: (s: RenderNode) => s.renderable ?? undefined, foreign_pos: (s: RenderNode) => s.foreign ?? undefined, id: (s: RenderNode) => s.id, w: () => 0, h: () => 0,
  },
  set: {
    p: (s: RenderNode, v) => { const q = Vec2.of(v); s.p.x = q.x; s.p.y = q.y; },
    enabled: (s: RenderNode, v) => { s.enabled = v !== undefined && v !== false; }, absolute: (s: RenderNode, v) => { s.absolute = v !== undefined && v !== false; },
    foreign_pos: (s: RenderNode, v) => { s.foreign = v instanceof Vec2 ? v : null; }, id: (s: RenderNode, v) => { s.id = String(v ?? ''); },
    renderable: (s: RenderNode, v) => { s.renderable = v instanceof Renderable ? v : null; },
  },
  methods: {
    set_renderable: (s: RenderNode, r) => { s.renderable = r instanceof Renderable ? r : null; },
    clear_foreign_pos: (s: RenderNode) => { s.foreign = null; },
  },
});

// ============================================================================================================================================ layered map
/** the world: tile layers (`base`) and the sprites of the entities that live in each layer, drawn from the lowest layer up; inside a layer by their y */
export class LayeredRenderable extends Renderable {
  static luaName = 'LayeredRenderable';
  base = new Map<number, Renderable>();
  layers = new Map<number, RenderNode[]>();
  w = 0; h = 0;
  addRenderable(layer: number, n: RenderNode): void {
    let l = this.layers.get(layer);
    if (!l) { l = []; this.layers.set(layer, l); }
    if (!l.includes(n)) l.push(n);
  }
  removeRenderable(layer: number, n: RenderNode): void {
    const l = this.layers.get(layer);
    if (!l) return;
    const i = l.indexOf(n);
    if (i >= 0) l.splice(i, 1);
  }
  resort(): void {
    for (const l of this.layers.values()) {
      // a stable insertion sort by the y of the node (the arrays are almost sorted from frame to frame)
      for (let i = 1; i < l.length; i++) {
        const v = l[i], key = v.localY();
        let j = i - 1;
        while (j >= 0 && l[j].localY() > key) { l[j + 1] = l[j]; j--; }
        l[j + 1] = v;
      }
    }
  }
  draw(ctx: DrawCtx, ox: number, oy: number): void {
    const ids = new Set<number>([...this.base.keys(), ...this.layers.keys()]);
    const sorted = [...ids].sort((a, b) => a - b);
    for (const id of sorted) {
      const b = this.base.get(id);
      if (b) b.draw(ctx, ox, oy);
      const l = this.layers.get(id);
      if (l) for (let i = 0; i < l.length; i++) l[i].draw(ctx, ox, oy);
    }
  }
}
LObj.bind(LayeredRenderable, {
  get: { w: (s: LayeredRenderable) => s.w, h: (s: LayeredRenderable) => s.h },
  methods: {
    add_renderable: (s: LayeredRenderable, layer, n: RenderNode) => { s.addRenderable(num(layer), n); },
    remove_renderable: (s: LayeredRenderable, layer, n: RenderNode) => { s.removeRenderable(num(layer), n); },
    set_base: (s: LayeredRenderable, layer, r) => { if (r instanceof Renderable) s.base.set(num(layer), r); else s.base.delete(num(layer)); },
    resort: (s: LayeredRenderable) => { s.resort(); },
  },
});
