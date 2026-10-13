// The asset storage of a stage: textures, fonts, sounds and tiled maps, read from the files of the game
import { LObj } from './luabind';
import { Texture } from './gfx';
import { decodePng, pngSize } from './png';
import { TextureObj } from './scene';
import { Font, type GlyphRasterizer } from './text';
import { SoundObj, type Mixer } from './audio';
import { buildMap, parseTmx } from './tilemap';

export interface FileSource {
  /** the bytes of a file, or null when it does not exist or has not been downloaded yet */
  read(path: string): Uint8Array | null;
  /** the size of an image that may not be downloaded yet */
  imageSize?(path: string): [number, number] | null;
}

export interface Services {
  files: FileSource;
  rast: GlyphRasterizer;
  mixer: Mixer;
  textures: Map<string, Texture>;
  fonts: Map<string, Font>;
}

export function normPath(p: string): string {
  const out: string[] = [];
  for (const part of p.replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop(); else out.push(part);
  }
  return out.join('/');
}

export class AssetStorage extends LObj {
  static luaName = 'AssetStorage';
  constructor(public svc: Services) { super(); }

  texture(path: string, trans: string | null = null): Texture {
    const p = normPath(path);
    const key = p + (trans ? '|' + trans : '');
    let t = this.svc.textures.get(key);
    if (!t) {
      const bytes = this.svc.files.read(p);
      const size = bytes ? pngSize(bytes) : this.svc.files.imageSize?.(p) ?? null;
      if (!size) throw new Error('texture not found: ' + p);
      const [w, h] = size;
      const ck = trans ? parseInt(trans, 16) : null;
      t = new Texture(p, w, h, () => { const b = this.svc.files.read(p); return b ? decodePng(b) : null; }, ck);
      this.svc.textures.set(key, t);
    }
    return t;
  }
}
LObj.bind(AssetStorage, {
  methods: {
    load_texture: (s: AssetStorage, path) => new TextureObj(s.texture(String(path))),
    load_font: (s: AssetStorage, path, size) => {
      const p = normPath(String(path)), n = Number(size) | 0;
      const key = p + '@' + n;
      let f = s.svc.fonts.get(key);
      if (!f) {
        const bytes = s.svc.files.read(p);
        if (!bytes) throw new Error('font not found: ' + p);
        const family = 'boo-' + p.replace(/[^\w]/g, '_');
        s.svc.rast.registerFont(family, bytes);
        f = new Font(p, n, bytes, s.svc.rast, family);
        s.svc.fonts.set(key, f);
      }
      return f;
    },
    load_sound: (s: AssetStorage, path, isMusic) => {
      const p = normPath(String(path));
      const music = isMusic !== undefined && isMusic !== false;
      return new SoundObj(p, music, s.svc.mixer.backend.load(p, s.svc.files.read(p), music));
    },
    load_tiled_map: (s: AssetStorage, path) => {
      const p = normPath(String(path));
      const bytes = s.svc.files.read(p);
      if (!bytes) throw new Error('map not found: ' + p);
      let text = '';
      for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
      const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
      return buildMap(parseTmx(text), (source, trans) => s.texture(dir ? dir + '/' + source : source, trans));
    },
  },
});
