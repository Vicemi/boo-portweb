// The packed game files in the browser: core.pak is needed to start, late.pak keeps downloading while the game runs
import type { FileSource } from '../engine/assets';

type Entry = [number, number, number, number?, number?];

export class WebFiles implements FileSource {
  index: Record<string, Entry> = {};
  paks: (Uint8Array | null)[] = [null, null];
  async load(base: string, onProgress: (f: number) => void): Promise<Promise<void>> {
    this.index = await (await fetch(`${base}/index.json`)).json();
    this.paks[0] = await download(`${base}/core.pak`, onProgress);
    // the rest comes in the background
    return download(`${base}/late.pak`).then((b) => { this.paks[1] = b; }).catch((e) => console.warn('late.pak failed', e));
  }
  read(path: string): Uint8Array | null {
    const e = this.index[path];
    if (!e) return null;
    const pak = this.paks[e[0]];
    return pak ? pak.subarray(e[1], e[1] + e[2]) : null;
  }
  imageSize(path: string): [number, number] | null {
    const e = this.index[path];
    return e && e[3] !== undefined ? [e[3], e[4]!] : null;
  }
}

async function download(url: string, onProgress?: (f: number) => void): Promise<Uint8Array> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  const total = Number(r.headers.get('content-length')) || 0;
  const reader = r.body!.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.length;
    if (total) onProgress?.(Math.min(1, got / total));
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  onProgress?.(1);
  return out;
}
