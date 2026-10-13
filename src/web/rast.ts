// Glyphs in the browser: a canvas draws each character, the engine lays them out (same method as tools/node_host.ts)
import type { GlyphRasterizer, RasterGlyph } from '../engine/text';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export class WebRasterizer implements GlyphRasterizer {
  private known = new Set<string>();
  /** the fonts must be loaded before the game starts: glyphs are made synchronously */
  async preload(fonts: { family: string; data: Uint8Array }[]): Promise<void> {
    for (const f of fonts) {
      const face = new FontFace(f.family, f.data.slice().buffer as ArrayBuffer);
      await face.load();
      document.fonts.add(face);
      this.known.add(f.family);
    }
  }
  registerFont(family: string): void { void family; /* already preloaded */ }
  private canvas(w: number, h: number): { ctx: Ctx; canvas: OffscreenCanvas | HTMLCanvasElement } {
    if (typeof OffscreenCanvas !== 'undefined') { const c = new OffscreenCanvas(w, h); return { ctx: c.getContext('2d', { willReadFrequently: true })!, canvas: c }; }
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    return { ctx: c.getContext('2d', { willReadFrequently: true })!, canvas: c };
  }
  glyph(family: string, size: number, code: number): RasterGlyph {
    const ch = String.fromCharCode(code);
    const pad = Math.ceil(size);
    const w = Math.ceil(size * 2) + pad * 2, h = Math.ceil(size * 2) + pad * 2;
    const { ctx } = this.canvas(w, h);
    ctx.font = `${size}px "${family}"`;
    ctx.textBaseline = 'alphabetic';
    const adv = Math.round(ctx.measureText(ch).width);
    ctx.fillStyle = '#fff';
    const baseY = pad + Math.ceil(size);
    ctx.fillText(ch, pad, baseY);
    const img = ctx.getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (img[(y * w + x) * 4 + 3] > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return { advance: adv, w: 0, h: 0, left: 0, top: 0, mask: null };
    const gw = x1 - x0 + 1, gh = y1 - y0 + 1;
    const mask = new Uint8Array(gw * gh);
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) mask[y * gw + x] = img[((y0 + y) * w + x0 + x) * 4 + 3];
    return { advance: adv, w: gw, h: gh, left: x0 - pad, top: baseY - y0, mask };
  }
}
