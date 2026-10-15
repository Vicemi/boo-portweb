// A small PNG decoder (8 and 16 bit, all color types, interlacing). It ignores gamma / color profiles on purpose: the original engine (SDL_image) does too,
// while a browser would change the colors.
import { inflate } from 'fflate';
import { unzlibSync } from 'fflate';

export interface Bitmap { w: number; h: number; data: Uint8ClampedArray }   // RGBA, not premultiplied

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** 8 bit samples (all the images of the game): the scanlines are unfiltered in place and converted without per-pixel closures. Returns the new read position */
function decode8(raw: Uint8Array, rp: number, out: Uint8ClampedArray, w: number, x0: number, y0: number, dx: number, dy: number, pw: number, ph: number,
  stride: number, channels: number, bpp: number, ctype: number, palette: Uint8Array | null, trns: Uint8Array | null): number {
  const tr = trns && trns.length >= 6 && ctype === 2 ? [(trns[0] << 8) | trns[1], (trns[2] << 8) | trns[3], (trns[4] << 8) | trns[5]] : null;
  const tg = trns && trns.length >= 2 && ctype === 0 ? (trns[0] << 8) | trns[1] : -1;
  for (let y = 0; y < ph; y++) {
    const ft = raw[rp++];
    const s = rp, pv = y > 0 ? s - stride - 1 : -1;      // start of this scanline and of the previous (already unfiltered) one
    rp += stride;
    switch (ft) {
      case 1: for (let i = bpp; i < stride; i++) raw[s + i] = (raw[s + i] + raw[s + i - bpp]) & 255; break;
      case 2: if (pv >= 0) for (let i = 0; i < stride; i++) raw[s + i] = (raw[s + i] + raw[pv + i]) & 255; break;
      case 3: for (let i = 0; i < stride; i++) raw[s + i] = (raw[s + i] + (((i >= bpp ? raw[s + i - bpp] : 0) + (pv >= 0 ? raw[pv + i] : 0)) >> 1)) & 255; break;
      case 4: for (let i = 0; i < stride; i++) raw[s + i] = (raw[s + i] + paeth(i >= bpp ? raw[s + i - bpp] : 0, pv >= 0 ? raw[pv + i] : 0, i >= bpp && pv >= 0 ? raw[pv + i - bpp] : 0)) & 255; break;
    }
    const py = y0 + y * dy;
    let d = (py * w + x0) * 4;
    const step = dx * 4;
    if (ctype === 6) {
      if (dx === 1) out.set(raw.subarray(s, s + stride), d);
      else for (let x = 0, k = s; x < pw; x++, k += 4, d += step) { out[d] = raw[k]; out[d + 1] = raw[k + 1]; out[d + 2] = raw[k + 2]; out[d + 3] = raw[k + 3]; }
    } else if (ctype === 2) {
      for (let x = 0, k = s; x < pw; x++, k += 3, d += step) {
        const r = raw[k], g = raw[k + 1], b = raw[k + 2];
        out[d] = r; out[d + 1] = g; out[d + 2] = b;
        out[d + 3] = tr && r === tr[0] && g === tr[1] && b === tr[2] ? 0 : 255;
      }
    } else if (ctype === 3) {
      for (let x = 0, k = s; x < pw; x++, k++, d += step) {
        const i = raw[k];
        out[d] = palette![i * 3]; out[d + 1] = palette![i * 3 + 1]; out[d + 2] = palette![i * 3 + 2];
        out[d + 3] = trns && i < trns.length ? trns[i] : 255;
      }
    } else if (ctype === 4) {
      for (let x = 0, k = s; x < pw; x++, k += 2, d += step) { const v = raw[k]; out[d] = v; out[d + 1] = v; out[d + 2] = v; out[d + 3] = raw[k + 1]; }
    } else {
      for (let x = 0, k = s; x < pw; x++, k++, d += step) { const v = raw[k]; out[d] = v; out[d + 1] = v; out[d + 2] = v; out[d + 3] = v === tg ? 0 : 255; }
    }
  }
  void channels;
  return rp;
}

export function decodePng(buf: Uint8Array): Bitmap {
  if (buf[0] !== 0x89 || buf[1] !== 0x50) throw new Error('not a PNG');
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let pos = 8;
  let w = 0, h = 0, depth = 8, ctype = 6, interlace = 0;
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (pos < buf.length) {
    const len = dv.getUint32(pos);
    const type = String.fromCharCode(buf[pos + 4], buf[pos + 5], buf[pos + 6], buf[pos + 7]);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { w = dv.getUint32(pos + 8); h = dv.getUint32(pos + 12); depth = buf[pos + 16]; ctype = buf[pos + 17]; interlace = buf[pos + 20]; }
    else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') trns = body;
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  let total = 0;
  for (const c of idat) total += c.length;
  const z = new Uint8Array(total);
  let o = 0;
  for (const c of idat) { z.set(c, o); o += c.length; }
  const raw = unzlibSync(z);
  const channels = ctype === 0 ? 1 : ctype === 2 ? 3 : ctype === 3 ? 1 : ctype === 4 ? 2 : 4;
  const bpp = Math.max(1, (channels * depth) >> 3);
  const out = new Uint8ClampedArray(w * h * 4);

  const passes = interlace
    ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]]
    : [[0, 0, 1, 1]];
  let rp = 0;
  for (const [x0, y0, dx, dy] of passes) {
    const pw = Math.ceil((w - x0) / dx), ph = Math.ceil((h - y0) / dy);
    if (pw <= 0 || ph <= 0) continue;
    const stride = (pw * channels * depth + 7) >> 3;
    if (depth === 8) { rp = decode8(raw, rp, out, w, x0, y0, dx, dy, pw, ph, stride, channels, bpp, ctype, palette, trns); continue; }
    let prev = new Uint8Array(stride);
    for (let y = 0; y < ph; y++) {
      const ft = raw[rp++];
      const line = raw.slice(rp, rp + stride);
      rp += stride;
      switch (ft) {
        case 1: for (let i = bpp; i < stride; i++) line[i] = (line[i] + line[i - bpp]) & 255; break;
        case 2: for (let i = 0; i < stride; i++) line[i] = (line[i] + prev[i]) & 255; break;
        case 3: for (let i = 0; i < stride; i++) line[i] = (line[i] + (((i >= bpp ? line[i - bpp] : 0) + prev[i]) >> 1)) & 255; break;
        case 4: for (let i = 0; i < stride; i++) line[i] = (line[i] + paeth(i >= bpp ? line[i - bpp] : 0, prev[i], i >= bpp ? prev[i - bpp] : 0)) & 255; break;
      }
      // pixels of this line
      for (let x = 0; x < pw; x++) {
        let r = 0, g = 0, b = 0, a = 255;
        const sample = (idx: number): number => {            // sample number `idx` of the line, scaled to 8 bit
          if (depth === 8) return line[idx];
          if (depth === 16) return line[idx * 2];
          const per = 8 / depth, byte = line[(idx / per) | 0], shift = 8 - depth * ((idx % per) + 1);
          return (byte >> shift) & ((1 << depth) - 1);
        };
        const sample16 = (idx: number): number => (depth === 16 ? (line[idx * 2] << 8) | line[idx * 2 + 1] : sample(idx));
        if (ctype === 0) {
          const v = sample(x);
          const s = depth < 8 ? Math.round((v * 255) / ((1 << depth) - 1)) : v;
          r = g = b = s;
          if (trns && trns.length >= 2) { const tv = (trns[0] << 8) | trns[1]; if (sample16(x) === tv) a = 0; }
        } else if (ctype === 2) {
          r = sample(x * 3); g = sample(x * 3 + 1); b = sample(x * 3 + 2);
          if (trns && trns.length >= 6) { const tr = (trns[0] << 8) | trns[1], tg = (trns[2] << 8) | trns[3], tb = (trns[4] << 8) | trns[5]; if (sample16(x * 3) === tr && sample16(x * 3 + 1) === tg && sample16(x * 3 + 2) === tb) a = 0; }
        } else if (ctype === 3) {
          const i = sample(x);
          r = palette![i * 3]; g = palette![i * 3 + 1]; b = palette![i * 3 + 2];
          if (trns && i < trns.length) a = trns[i];
        } else if (ctype === 4) { r = g = b = sample(x * 2); a = sample(x * 2 + 1); }
        else { r = sample(x * 4); g = sample(x * 4 + 1); b = sample(x * 4 + 2); a = sample(x * 4 + 3); }
        const px = x0 + x * dx, py = y0 + y * dy;
        const d = (py * w + px) * 4;
        out[d] = r; out[d + 1] = g; out[d + 2] = b; out[d + 3] = a;
      }
      prev = line;
    }
  }
  void inflate;
  return { w, h, data: out };
}

/** PNG header only: width and height */
export function pngSize(buf: Uint8Array): [number, number] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return [dv.getUint32(16), dv.getUint32(20)];
}
