// Sound in the browser (Web Audio): each sound file is fetched and decoded the first time it is needed (or by the background preload)
import type { AudioBackend, Voice } from '../engine/audio';

interface Handle { url: string; music: boolean; buffer: AudioBuffer | null; loading: Promise<void> | null }

export class WebAudio implements AudioBackend {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  muted = false;
  constructor(private base: string) { this.ensure(); }
  private ensure(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(this.ctx.destination);
    }
  }
  /** needs a user gesture on most browsers */
  unlock(): void {
    this.ensure();
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }
  setMuted(m: boolean): void { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 1; }
  load(path: string, _data: Uint8Array | null, isMusic: boolean): Handle {
    return { url: `${this.base}/${path.replace(/^assets\/sounds\//, '')}`, music: isMusic, buffer: null, loading: null };
  }
  private cache = new Map<string, Promise<AudioBuffer | null>>();
  fetchBuffer(h: Handle): Promise<void> {
    if (h.buffer) return Promise.resolve();
    let p = this.cache.get(h.url);
    if (!p) {
      p = (async () => {
        try {
          const data = await (await fetch(h.url)).arrayBuffer();
          return this.ctx ? await this.ctx.decodeAudioData(data) : null;
        } catch (e) { console.warn('sound failed', h.url, e); return null; }
      })();
      this.cache.set(h.url, p);
    }
    return p.then((b) => { h.buffer = b; });
  }
  play(handle: unknown, loop: boolean, volume: number): Voice {
    const h = handle as Handle;
    const st = { stopped: false, ended: false, gain: null as GainNode | null, src: null as AudioBufferSourceNode | null, vol: volume };
    const start = (): void => {
      const ctx = this.ctx;
      if (!ctx || !h.buffer || st.stopped) return;
      const src = ctx.createBufferSource();
      src.buffer = h.buffer; src.loop = loop;
      const gain = ctx.createGain(); gain.gain.value = st.vol;
      src.connect(gain); gain.connect(this.master!);
      src.onended = () => { st.ended = true; };
      src.start();
      st.src = src; st.gain = gain;
    };
    if (!this.ctx) { st.ended = true; return { stop() { /* */ }, setVolume() { /* */ }, finished: () => true }; }
    if (h.buffer) start(); else void this.fetchBuffer(h).then(start);
    return {
      stop: () => { st.stopped = true; try { st.src?.stop(); } catch { /* not started */ } },
      setVolume: (v: number) => { st.vol = v; if (st.gain) st.gain.gain.value = v; },
      finished: () => st.ended || st.stopped,
    };
  }
}
