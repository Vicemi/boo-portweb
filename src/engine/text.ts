// Fonts and text. The original draws TrueType fonts with SDL_ttf (Latin-1 strings, 8 bit anti-aliased glyphs, integer advances); a host provides the
// rasterizer (a canvas), the layout (wrapping, alignments) is the engine's own.
import { LObj } from './luabind';
import { Renderable, Vec2, num, type DrawCtx } from './scene';

/** what the host offers to draw glyphs */
export interface GlyphRasterizer {
  /** a canvas-like factory is enough: the host registers the font bytes under `family` and rasterizes single glyphs */
  registerFont(family: string, data: Uint8Array): void;
  /** the glyph of char code `code` (Latin-1) as an alpha mask, `advance` in pixels, positioned relative to the pen at the baseline */
  glyph(family: string, size: number, code: number, ascent: number): RasterGlyph;
}
export interface RasterGlyph { advance: number; w: number; h: number; left: number; top: number; mask: Uint8Array | null }

export interface FontMetrics { ascent: number; descent: number; height: number; lineSkip: number }

/** the metrics of a font like SDL_ttf computes them (from the hhea table, scaled to the size, rounded up) */
export function ttfMetrics(data: Uint8Array, size: number): FontMetrics {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const n = dv.getUint16(4);
  let head = 0, hhea = 0, os2 = 0;
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16;
    const tag = String.fromCharCode(data[o], data[o + 1], data[o + 2], data[o + 3]);
    const off = dv.getUint32(o + 8);
    if (tag === 'head') head = off; else if (tag === 'hhea') hhea = off; else if (tag === 'OS/2') os2 = off;
  }
  void os2;
  const upm = dv.getUint16(head + 18);
  const asc = dv.getInt16(hhea + 4), desc = dv.getInt16(hhea + 6), gap = dv.getInt16(hhea + 8);
  const scale = size / upm;
  const ascent = Math.ceil(asc * scale - 1e-9), descent = Math.ceil(desc * scale - 1e-9);   // descent is negative
  const height = ascent - descent + 1;
  const lineSkip = Math.ceil((asc - desc + gap) * scale - 1e-9);
  return { ascent, descent, height, lineSkip };
}

export class Font extends LObj {
  static luaName = 'Font';
  static counter = 0;
  family: string;
  metrics: FontMetrics;
  constructor(public path: string, public size: number, public data: Uint8Array, public rast: GlyphRasterizer, family: string) {
    super();
    this.family = family;
    this.metrics = ttfMetrics(data, size);
  }
  private cache = new Map<number, RasterGlyph>();
  glyph(code: number): RasterGlyph {
    let g = this.cache.get(code);
    if (!g) { g = this.rast.glyph(this.family, this.size, code, this.metrics.ascent); this.cache.set(code, g); }
    return g;
  }
  width(s: string): number { let w = 0; for (let i = 0; i < s.length; i++) w += this.glyph(s.charCodeAt(i) & 255).advance; return w; }
}

export class Text extends Renderable {
  static luaName = 'Text';
  p = new Vec2();
  width = 0; height = 0;
  h_alignment = 0; v_alignment = 0;
  private text = '';
  private lines: string[] | null = null;
  constructor(public font: Font, public color: number) { super(); }
  setText(s: string): void { this.text = s; this.lines = null; }
  getText(): string { return this.text; }
  invalidate(): void { this.lines = null; }

  /** greedy word wrap of every paragraph (a "\n" starts a new line) into the width of the box */
  layout(): string[] {
    if (this.lines) return this.lines;
    const out: string[] = [];
    const max = this.width;
    for (const para of this.text.split('\n')) {
      if (para === '') { out.push(''); continue; }
      const words = para.split(' ');
      let cur = '';
      for (const w of words) {
        const trial = cur === '' ? w : cur + ' ' + w;
        if (cur !== '' && max > 0 && this.font.width(trial) > max) { out.push(cur); cur = w; } else cur = trial;
      }
      out.push(cur);
    }
    this.lines = out;
    return out;
  }

  draw(ctx: DrawCtx, ox: number, oy: number): void {
    if (this.text === '') return;
    const lines = this.layout();
    const m = this.font.metrics;
    const total = lines.length * m.height;
    let y = oy + this.p.y;
    if (this.v_alignment === 1) y += Math.floor((this.height - total) / 2);
    else if (this.v_alignment === 2) y += this.height - total;
    const r = (this.color >>> 24) & 255, g = (this.color >>> 16) & 255, b = (this.color >>> 8) & 255;
    const rgb = (r << 16) | (g << 8) | b;
    for (const line of lines) {
      const lw = this.font.width(line);
      let x = ox + this.p.x;
      if (this.h_alignment === 1) x += Math.floor((this.width - lw) / 2);
      else if (this.h_alignment === 2) x += this.width - lw;
      for (let i = 0; i < line.length; i++) {
        const gl = this.font.glyph(line.charCodeAt(i) & 255);
        if (gl.mask) ctx.fb.blitMask(gl.mask, gl.w, gl.h, x + gl.left, y + m.ascent - gl.top, rgb);
        x += gl.advance;
      }
      y += m.height;
    }
  }
}
LObj.bind(Text, {
  get: {
    p: (s: Text) => s.p, w: (s: Text) => s.width, h: (s: Text) => s.height, width: (s: Text) => s.width, height: (s: Text) => s.height,
    h_alignment: (s: Text) => s.h_alignment, v_alignment: (s: Text) => s.v_alignment,
  },
  set: {
    p: (s: Text, v) => { const q = Vec2.of(v); s.p.x = q.x; s.p.y = q.y; },
    w: (s: Text, v) => { s.width = num(v); s.invalidate(); }, h: (s: Text, v) => { s.height = num(v); },
    width: (s: Text, v) => { s.width = num(v); s.invalidate(); }, height: (s: Text, v) => { s.height = num(v); },
    h_alignment: (s: Text, v) => { s.h_alignment = num(v) | 0; }, v_alignment: (s: Text, v) => { s.v_alignment = num(v) | 0; },
  },
  methods: {
    set_text: (s: Text, t) => { s.setText(String(t ?? '')); },
    get_text: (s: Text) => s.getText(),
    get_glyphs_height: (s: Text) => s.font.metrics.height,
  },
});

export class TextFactory extends LObj {
  static luaName = 'TextFactory';
}
LObj.bind(TextFactory, { methods: { get_text: (_s: TextFactory, font, color) => new Text(font as Font, num(color) >>> 0) } });
