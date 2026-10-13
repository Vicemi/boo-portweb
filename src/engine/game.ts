// The game object: the systems (logic, renderer, input, collision, mixer), the stages and the globals that the Lua code of the original expects
import { LuaTable, type LuaValue, type NativeFunction } from '../lua/value';
import { LuaState } from '../lua/vm';
import { openLibs, type Host } from '../lua/lib';
import { compileChunk } from '../lua/compile';
import { undump, isBytecode } from '../lua/undump';
import { Luabind, LObj, NATIVE } from './luabind';
import { Framebuffer, Texture } from './gfx';
import { Vec2, RenderNode, Fill, Line, Sprite, LayeredRenderable, TextureObj, num } from './scene';
import { LogicNode, LuaComponent, Stage, Entity, GAME_REF, setLua } from './logic';
import { Frame, Animation, AnimationManager, RenderComponent, LayeredRenderComponent } from './anim';
import { collisionGlobals, COLLISION, CollisionSystem } from './collision';
import { InputSystem } from './input';
import { Mixer, Playable, NullAudio, type AudioBackend, SoundObj } from './audio';
import { TextFactory, Font, type GlyphRasterizer } from './text';
import { AssetStorage, type FileSource, type Services } from './assets';
import { DialogManager } from './dialog';
import { ghostInit, ghostMethods, NATIVE_SIDE } from './ghost';

export interface GameOptions {
  files: FileSource;
  rast: GlyphRasterizer;
  audio?: AudioBackend;
  /** user files (saves): read / write by path */
  userRead?: (path: string) => string | undefined;
  userWrite?: (path: string, data: string) => void;
  print?: (s: string) => void;
}

class LogicSystem extends LObj {
  static luaName = 'Logic';
  main = new LogicNode();
  after: LuaValue[] = [];
}
LObj.bind(LogicSystem, { get: { main: (s: LogicSystem) => s.main }, methods: { call_after_frame: (s: LogicSystem, f) => { s.after.push(f); } } });

class RenderSystem extends LObj {
  static luaName = 'Renderer';
  main = new RenderNode();
}
LObj.bind(RenderSystem, { get: { main: (s: RenderSystem) => s.main } });

LObj.bind(Stage, {
  get: { id: (s: Stage) => s.id, asset_storage: (s: Stage) => s.assetStorage },
  methods: {
    add_to_game: (s: Stage) => { s.addToGame(); },
    remove_from_game: (s: Stage) => { s.removeFromGame(); },
    create_entity: (s: Stage, name) => s.createEntity(String(name ?? '')),
    get_entity: (s: Stage, name) => s.entities.find(e => e.id === name),
    release_entity: (s: Stage, e) => { const i = s.entities.indexOf(e as Entity); if (i >= 0) s.entities.splice(i, 1); },
  },
});

export class Game extends LObj {
  static luaName = 'Game';
  L = new LuaState();
  fb = new Framebuffer();
  logic = new LogicSystem();
  renderer = new RenderSystem();
  input = new InputSystem();
  collision = new CollisionSystem();
  mixer: Mixer;
  svc: Services;
  mainStage: Stage;
  textFactory = new TextFactory();
  rgb565 = true;
  exited = false;
  frame = 0;
  errors: string[] = [];
  onExit?: () => void;

  constructor(public opts: GameOptions) {
    super();
    GAME_REF.game = this;
    COLLISION.sys = this.collision;
    setLua(this.L);
    this.mixer = new Mixer(opts.audio ?? new NullAudio());
    this.svc = { files: opts.files, rast: opts.rast, mixer: this.mixer, textures: new Map<string, Texture>(), fonts: new Map<string, Font>() };
    this.mainStage = this.makeStage('main');
    this.install();
  }

  makeStage(id: string): Stage {
    const st = new Stage(id, () => new AssetStorage(this.svc));
    return st;
  }

  private install(): void {
    const L = this.L;
    const o = this.opts;
    const dec = (b: Uint8Array): string => { let s = ''; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192)); return s; };
    const host: Host = {
      readFile: (p) => {
        const u = o.userRead?.(p);
        if (u !== undefined) return u;
        const b = o.files.read(p.replace(/^\.\//, ''));
        return b ? dec(b) : undefined;
      },
      writeFile: (p, d) => { o.userWrite?.(p, d); return true; },
      removeFile: () => false,
      print: (t) => (o.print ?? console.log)(t),
      write: (t) => (o.print ?? console.log)(t),
      compile: (src, name) => compileChunk(L, src, name),
    };
    openLibs(L, host);
    new Luabind(L).install();
    const lb = new Luabind(L);
    const G = L.globals;
    const f = (name: string, fn: NativeFunction): void => { G.set(name, fn); };

    // base classes of the components written in Lua
    const nop = (): void => { /* default implementation */ };
    const common = {
      add_to_game: nop, remove_from_game: nop, start: nop, update: nop, clone: (s: LuaTable) => s,
      object_id: (s: LuaTable) => (s as any).oid ?? ((s as any).oid = ++Game.oids),
    };
    lb.nativeBase('Component', (self: LuaTable) => { (self as any)[NATIVE] = new LuaComponent(self); }, common);
    lb.nativeBase('GhostComponentBase', (self: LuaTable) => { (self as any)[NATIVE] = new LuaComponent(self); ghostInit(self); }, { ...common, ...ghostMethods });
    G.set('native_side', NATIVE_SIDE);

    G.set('game', this);
    f('LogicNode', () => new LogicNode());
    f('RenderNode', () => new RenderNode());
    f('Vector2f', (x, y) => new Vec2(num(x), num(y)));
    f('Fill', () => new Fill());
    f('Line', (a, b) => new Line(a, b));
    f('Sprite', (t) => { if (!(t instanceof TextureObj)) throw new Error('Sprite: a texture was expected'); return new Sprite(t); });
    f('LayeredRenderable', () => new LayeredRenderable());
    f('_RenderComponent', (parent, logic) => new RenderComponent(parent instanceof RenderNode ? parent : null, logic as LogicNode));
    f('_LayeredRenderComponent', (layered, layer, logic) => new LayeredRenderComponent(layered as LayeredRenderable, num(layer), logic as LogicNode));
    f('_AnimationManager', (node) => new AnimationManager(node as RenderNode));
    f('_Animation', (times) => new Animation(num(times, 1)));
    f('_Frame', (r, ms) => new Frame(r, num(ms)));
    f('Playable', (mixer, sound) => new Playable(mixer as Mixer, sound instanceof SoundObj ? sound : null));
    f('DialogManager', (stage, font, render, logic) => new DialogManager(this, stage as Stage, font as Font, render as RenderNode, logic as LogicNode));
    for (const [k, fn] of Object.entries(collisionGlobals)) f(k, fn as NativeFunction);

    G.set('save_dir', 'saves');
    f('encrypt_file', (name, data) => { o.userWrite?.(String(name), String(data ?? '')); });
    f('decrypt_file', (name) => o.userRead?.(String(name)));
    f('yea_doit', () => ''); f('yea_doit2', () => '');   // (signatures for the online scores of the original)
    f('score_client_post', () => { /* the online scores of the original are gone */ });
    f('score_client_get', () => { /* idem */ });
    f('class_info', () => undefined);
    f('class_names', () => new LuaTable());
  }
  static oids = 0;

  /** fixes of the original game, applied (once) when the module that has the code is loaded */
  private patches: Record<string, string> = {
    // basement_3 leads to "boss:a" but the boss room has no doors: the original fails to load it. It uses the start point of the room instead
    'stage_manager.stage_manager': [
      'local sm = stage_manager',
      'local orig = sm.setPlayerStartPosition',
      'sm.setPlayerStartPosition = function(self, aDoorID, aStartPos, aObject)',
      '  if aDoorID and not aStartPos and self.door_manager and not self.door_manager.doors[aDoorID] then aDoorID = nil end',
      '  return orig(self, aDoorID, aStartPos, aObject)',
      'end',
    ].join(String.fromCharCode(10)),
  };
  private installPatches(): void {
    const L = this.L;
    const realRequire = L.globals.get('require');
    L.globals.set('require', ((name: LuaValue) => {
      const r = L.callArr(realRequire, [name]);
      const code = typeof name === 'string' ? this.patches[name] : undefined;
      if (code) {
        delete this.patches[name as string];
        const res = L.pcall(compileChunk(L, code, '=patch'), []);
        if (!res.ok) this.errors.push('patch ' + String(name) + ': ' + String(res.err));
      }
      return r;
    }) as NativeFunction);
  }

  /** runs src/start.lua (bytecode of the original) */
  boot(script?: Uint8Array): void {
    this.installPatches();
    const b = script ?? this.opts.files.read('src/start.lua');
    if (!b) throw new Error('src/start.lua not found');
    const fn = isBytecode(b) ? this.L.closureOf(undump(b)) : compileChunk(this.L, new TextDecoder('latin1').decode(b), '@src/start.lua');
    const r = this.L.pcall(fn, []);
    if (!r.ok) throw new Error('start.lua: ' + (typeof r.err === 'string' ? r.err : String(r.err)) + '\n' + r.traceback);
  }

  /** a stage that is a child of the main one */
  allStages(): Stage[] {
    const out: Stage[] = [];
    const walk = (s: Stage): void => { out.push(s); for (const c of s.children) walk(c); };
    walk(this.mainStage);
    return out;
  }

  /** one logic step of the original (33 ms) */
  tick(): void {
    if (this.exited) return;
    this.frame++;
    this.input.update();
    try { this.logic.main.update(); } catch (e) { this.report(e); }
    const after = this.logic.after; this.logic.after = [];
    for (const fn of after) { try { this.L.callArr(fn, []); } catch (e) { this.report(e); } }
    for (const s of this.allStages()) if (s.inGame) for (const e of s.entities) { e.lastP.x = e.p.x; e.lastP.y = e.p.y; e.lastDir.x = e.dir.x; e.lastDir.y = e.dir.y; }
    this.mixer.backend.tick?.(33);
  }

  private report(e: unknown): void {
    const msg = e instanceof Error ? (e as any).value !== undefined ? String((e as any).value) + '\n' + ((e as any).traceback ?? '') : e.stack ?? e.message : String(e);
    this.errors.push(msg);
    (this.opts.print ?? console.error)('[lua error] ' + msg);
  }

  render(): Framebuffer {
    this.fb.clear(0, 0, 0);
    this.renderer.main.draw({ fb: this.fb }, 0, 0);
    if (this.rgb565) this.fb.quantize565();
    return this.fb;
  }
}
LObj.bind(Game, {
  get: { main_stage: (s: Game) => s.mainStage, text_factory: (s: Game) => s.textFactory },
  methods: {
    get_system: (s: Game, name) => {
      switch (String(name)) {
        case 'logic': return s.logic;
        case 'renderer': return s.renderer;
        case 'input': return s.input;
        case 'collision': return s.collision;
        case 'mixer': return s.mixer;
        default: return undefined;
      }
    },
    exit: (s: Game) => { s.exited = true; s.onExit?.(); },
    disable_sound: (s: Game) => { s.mixer.enabled = false; },
    enable_sound: (s: Game) => { s.mixer.enabled = true; },
    get: () => undefined,
  },
});

// Stage.create_stage / release_stage need the game (the asset storage): they are added here
LObj.bind(Stage, {
  methods: {
    create_stage: (s: Stage, name) => { const g = GAME_REF.game as Game; const c = g.makeStage(String(name ?? '')); s.children.push(c); return c; },
    release_stage: (s: Stage, c) => { const i = s.children.indexOf(c as Stage); if (i >= 0) { s.children.splice(i, 1); (c as Stage).removeFromGame(); } },
  },
});
