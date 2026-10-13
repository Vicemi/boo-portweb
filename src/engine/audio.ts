// Sound: the mixer, sounds and the playables the game controls. The host provides the actual playing (Web Audio, or nothing in tests).
import { LObj } from './luabind';
import { num } from './scene';

export interface Voice { stop(): void; setVolume(v: number): void; finished(): boolean }
export interface AudioBackend {
  /** prepares a sound from its file; returns an opaque handle */
  load(path: string, data: Uint8Array | null, isMusic: boolean): unknown;
  play(handle: unknown, loop: boolean, volume: number): Voice;
  /** called once per logic step (the null backend uses it as its clock) */
  tick?(ms: number): void;
}

export class Mixer extends LObj {
  static luaName = 'System';
  enabled = true;
  constructor(public backend: AudioBackend) { super(); }
}

export class SoundObj extends LObj {
  static luaName = 'Sound';
  constructor(public path: string, public isMusic: boolean, public handle: unknown) { super(); }
}

export class Playable extends LObj {
  static luaName = 'Playable';
  voice: Voice | null = null;
  volume = 1;
  constructor(public mixer: Mixer, public sound: SoundObj | null) { super(); }
  play(loop: boolean, volume: number): void {
    if (this.voice) this.voice.stop();
    this.volume = volume;
    this.voice = this.sound && this.mixer.enabled ? this.mixer.backend.play(this.sound.handle, loop, volume) : null;
  }
  stop(): void { if (this.voice) { this.voice.stop(); this.voice = null; } }
  setVolume(v: number): void { this.volume = v; if (this.voice) this.voice.setVolume(v); }
}
LObj.bind(Playable, {
  methods: {
    play: (s: Playable, loop, vol) => { s.play(loop !== undefined && loop !== false, num(vol, 1)); },
    stop: (s: Playable) => { s.stop(); },
    set_volume: (s: Playable, v) => { s.setVolume(num(v, 1)); },
    get_current_volume: (s: Playable) => s.volume,
    finished: (s: Playable) => (s.voice ? s.voice.finished() : true),
  },
});

/** no sound (tests, or sound disabled) */
export class NullAudio implements AudioBackend {
  load(): unknown { return null; }
  play(): Voice { return { stop() { /* nothing */ }, setVolume() { /* nothing */ }, finished: () => true }; }
}
