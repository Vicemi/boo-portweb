// Pixels: textures, the 600x450 frame buffer and the blits of the original (SDL 1.2: the same alpha formula, color key, clipping)
import type { Bitmap } from './png';

export const SCREEN_W = 600, SCREEN_H = 450;

export class Framebuffer {
  w = SCREEN_W; h = SCREEN_H;
  data = new Uint8ClampedArray(SCREEN_W * SCREEN_H * 4);
  /** the clip rectangle: nothing outside is drawn */
  cx0 = 0; cy0 = 0; cx1 = SCREEN_W; cy1 = SCREEN_H;

  clear(r = 0, g = 0, b = 0): void {
    const d = this.data;
    for (let i = 0; i < d.length; i += 4) { d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; }
  }

  /** a part (sx, sy, sw, sh) of a bitmap at (dx, dy); `alpha` 0..255 scales the alpha of the pixels */
  blit(bmp: Bitmap, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, alpha = 255): void {
    // clip the source rectangle to the bitmap
    if (sx < 0) { dx -= sx; sw += sx; sx = 0; }
    if (sy < 0) { dy -= sy; sh += sy; sy = 0; }
    if (sx + sw > bmp.w) sw = bmp.w - sx;
    if (sy + sh > bmp.h) sh = bmp.h - sy;
    // clip to the screen
    if (dx < this.cx0) { const k = this.cx0 - dx; sx += k; sw -= k; dx = this.cx0; }
    if (dy < this.cy0) { const k = this.cy0 - dy; sy += k; sh -= k; dy = this.cy0; }
    if (dx + sw > this.cx1) sw = this.cx1 - dx;
    if (dy + sh > this.cy1) sh = this.cy1 - dy;
    if (sw <= 0 || sh <= 0) return;
    const src = bmp.data, dst = this.data, W = this.w;
    for (let y = 0; y < sh; y++) {
      let s = ((sy + y) * bmp.w + sx) * 4;
      let d = ((dy + y) * W + dx) * 4;
      for (let x = 0; x < sw; x++, s += 4, d += 4) {
        let a = src[s + 3];
        if (alpha !== 255) a = (a * alpha + 127) / 255 | 0;
        if (a === 0) continue;
        if (a === 255) { dst[d] = src[s]; dst[d + 1] = src[s + 1]; dst[d + 2] = src[s + 2]; continue; }
        const dr = dst[d], dg = dst[d + 1], db = dst[d + 2];
        dst[d] = dr + (((src[s] - dr) * a) >> 8);
        dst[d + 1] = dg + (((src[s + 1] - dg) * a) >> 8);
        dst[d + 2] = db + (((src[s + 2] - db) * a) >> 8);
      }
    }
  }

  /** a rectangle of one color with alpha 0..1 */
  fillRect(x: number, y: number, w: number, h: number, rgb: number, alpha: number): void {
    let x0 = Math.max(this.cx0, Math.round(x)), y0 = Math.max(this.cy0, Math.round(y));
    const x1 = Math.min(this.cx1, Math.round(x + w)), y1 = Math.min(this.cy1, Math.round(y + h));
    if (x1 <= x0 || y1 <= y0) return;
    const a = Math.max(0, Math.min(255, Math.round(alpha * 255)));
    if (a === 0) return;
    const r = (rgb >> 16) & 255, g = (rgb >> 8) & 255, b = rgb & 255;
    const dst = this.data, W = this.w;
    for (let y = y0; y < y1; y++) {
      let d = (y * W + x0) * 4;
      for (let x = x0; x < x1; x++, d += 4) {
        if (a === 255) { dst[d] = r; dst[d + 1] = g; dst[d + 2] = b; continue; }
        const dr = dst[d], dg = dst[d + 1], db = dst[d + 2];
        dst[d] = dr + (((r - dr) * a) >> 8);
        dst[d + 1] = dg + (((g - dg) * a) >> 8);
        dst[d + 2] = db + (((b - db) * a) >> 8);
      }
    }
  }
}

/** an image of the game: its size is known right away, the pixels are decoded when it is first drawn */
export class Texture {
  bmp: Bitmap | null = null;
  constructor(public path: string, public w: number, public h: number, private loader: () => Bitmap, public colorKey: number | null = null) {}
  bitmap(): Bitmap {
    if (this.bmp === null) {
      const b = this.loader();
      if (this.colorKey !== null) {
        const k = this.colorKey, d = b.data;
        for (let i = 0; i < d.length; i += 4) if (d[i] === ((k >> 16) & 255) && d[i + 1] === ((k >> 8) & 255) && d[i + 2] === (k & 255)) d[i + 3] = 0;
      }
      this.bmp = b;
    }
    return this.bmp;
  }
}
