// Host for tests and tools in Node: files from a folder, glyphs from @napi-rs/canvas, PNG output
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { join } from 'node:path';
import type { FileSource } from '../src/engine/assets';
import type { GlyphRasterizer, RasterGlyph } from '../src/engine/text';
import type { Framebuffer } from '../src/engine/gfx';

export function folderFiles(root: string): FileSource {
  return { read: (p) => { const f = join(root, p); return existsSync(f) ? new Uint8Array(readFileSync(f)) : null; } };
}

export class CanvasRasterizer implements GlyphRasterizer {
  registerFont(family: string, data: Uint8Array): void { if (!GlobalFonts.has(family)) GlobalFonts.register(Buffer.from(data), family); }
  glyph(family: string, size: number, code: number, ascent: number): RasterGlyph {
    const ch = String.fromCharCode(code);
    const pad = Math.ceil(size);
    const w = Math.ceil(size * 2) + pad * 2, h = Math.ceil(size * 2) + pad * 2;
    const c = createCanvas(w, h);
    const g = c.getContext('2d');
    g.font = `${size}px "${family}"`;
    g.textBaseline = 'alphabetic';
    const adv = Math.round(g.measureText(ch).width);
    g.fillStyle = '#fff';
    const baseY = pad + Math.ceil(size);
    g.fillText(ch, pad, baseY);
    const img = g.getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (img[(y * w + x) * 4 + 3] > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    void ascent;
    if (x1 < 0) return { advance: adv, w: 0, h: 0, left: 0, top: 0, mask: null };
    const gw = x1 - x0 + 1, gh = y1 - y0 + 1;
    const mask = new Uint8Array(gw * gh);
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) mask[y * gw + x] = img[((y0 + y) * w + x0 + x) * 4 + 3];
    return { advance: adv, w: gw, h: gh, left: x0 - pad, top: baseY - y0, mask };
  }
}

export function savePng(fb: Framebuffer, path: string): void {
  const c = createCanvas(fb.w, fb.h);
  const g = c.getContext('2d');
  const id = g.createImageData(fb.w, fb.h);
  id.data.set(fb.data);
  g.putImageData(id, 0, 0);
  writeFileSync(path, c.toBuffer('image/png'));
}
