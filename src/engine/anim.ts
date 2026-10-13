// Animations and the render components (a node that shows images or plays animations at the position of its entity)
import { LuaTable, type LuaValue } from '../lua/value';
import { LObj } from './luabind';
import { Renderable, RenderNode, LayeredRenderable } from './scene';
import { NativeComponent, LogicNode, TICK_MS, lua } from './logic';

export class Frame extends LObj {
  static luaName = '_Frame';
  constructor(public anim: Renderable, public ms: number) { super(); }
}

let animIds = 0x9a35000;
export class Animation extends LObj {
  static luaName = '_Animation';
  frames: Frame[] = [];
  id = (animIds += 128);
  constructor(public times: number) { super(); }
  total(): number { let t = 0; for (const f of this.frames) t += f.ms; return t; }
}
LObj.bind(Animation, {
  methods: {
    set_frames: (s: Animation, t) => {
      s.frames = [];
      if (t instanceof LuaTable) for (let i = 1; i <= t.length(); i++) { const f = t.get(i); if (f instanceof Frame) s.frames.push(f); }
    },
  },
});

/** plays the animations of a name -> animation table on a render node */
export class Animator {
  anims = new Map<string, Animation>();
  current: Animation | null = null;
  playing = false;
  loop = false;
  elapsed = 0;
  cb: LuaValue = undefined;
  constructor(public node: RenderNode) {}

  setAnimations(t: LuaValue): void {
    this.anims.clear();
    if (t instanceof LuaTable) for (let n = t.next(undefined); n !== undefined; n = t.next(n[0])) if (n[1] instanceof Animation) this.anims.set(String(n[0]), n[1]);
  }
  play(name: string, loop: boolean, cb?: LuaValue): void {
    const a = this.anims.get(name);
    if (!a) return;                                               // ("animation not found": the original only warns)
    this.current = a; this.playing = true; this.loop = loop; this.elapsed = 0; this.cb = cb;
    this.show(0);
  }
  stop(): void { this.playing = false; this.current = null; this.cb = undefined; }
  private show(i: number): void { const f = this.current?.frames[i]; if (f) this.node.renderable = f.anim; }
  update(): void {
    const a = this.current;
    if (!this.playing || !a) return;
    this.elapsed += TICK_MS;
    const total = a.total();
    if (this.elapsed > total) {
      if (this.loop && total > 0) this.elapsed %= total;
      else {
        // finished: the last frame stays on the screen
        this.playing = false; this.current = null;
        const cb = this.cb; this.cb = undefined;
        if (cb !== undefined) lua().callArr(cb, []);
        return;
      }
    }
    let cum = 0;
    for (let i = 0; i < a.frames.length; i++) { cum += a.frames[i].ms; if (this.elapsed <= cum) { this.show(i); return; } }
    this.show(a.frames.length - 1);
  }
  currentId(): number { return this.current ? this.current.id : 0; }
  idOf(name: string): number { return this.anims.get(name)?.id ?? 0; }
}

export class AnimationManager extends LObj {
  static luaName = '_AnimationManager';
  animator: Animator;
  constructor(node: RenderNode) { super(); this.animator = new Animator(node); }
}
LObj.bind(AnimationManager, {
  methods: {
    set_animations: (s: AnimationManager, t) => { s.animator.setAnimations(t); },
    play: (s: AnimationManager, name, loop, cb) => { s.animator.play(String(name), loop !== undefined && loop !== false, cb); },
    update: (s: AnimationManager) => { s.animator.update(); },
    get_animation_id: (s: AnimationManager, n) => s.animator.idOf(String(n)),
    get_current_animation_id: (s: AnimationManager) => s.animator.currentId(),
  },
});

export class RenderComponent extends NativeComponent {
  static luaName = '_RenderComponent';
  node = new RenderNode();
  images = new Map<string, Renderable>();
  animator: Animator;
  constructor(public parentNode: RenderNode | null, public logic: LogicNode) { super(); this.compId = 'render'; this.animator = new Animator(this.node); }
  addToGame(): void {
    if (this.parentNode) this.parentNode.children.addChild(this.node);
    this.node.foreign = this.parent ? this.parent.p : null;
    this.logic.add(this);
  }
  removeFromGame(): void {
    if (this.parentNode) this.parentNode.children.removeChild(this.node);
    this.logic.remove(this);
  }
  update(): void { this.animator.update(); }
}
LObj.bind(RenderComponent, {
  get: { render_node: (s: RenderComponent) => s.node },
  methods: {
    set_images: (s: RenderComponent, t) => {
      s.images.clear();
      if (t instanceof LuaTable) for (let n = t.next(undefined); n !== undefined; n = t.next(n[0])) if (n[1] instanceof Renderable) s.images.set(String(n[0]), n[1]);
    },
    set_animations: (s: RenderComponent, t) => { s.animator.setAnimations(t); },
    set_image: (s: RenderComponent, name) => {
      s.animator.stop();
      const r = s.images.get(String(name));
      if (r) s.node.renderable = r;
    },
    play: (s: RenderComponent, name, loop, cb) => { s.animator.play(String(name), loop !== undefined && loop !== false, cb); },
    stop: (s: RenderComponent) => { s.animator.stop(); },
    clear: (s: RenderComponent) => { s.animator.stop(); s.node.renderable = null; },
    get_animation_id: (s: RenderComponent, n) => s.animator.idOf(String(n)),
    get_current_animation_id: (s: RenderComponent) => s.animator.currentId(),
  },
});

export class LayeredRenderComponent extends RenderComponent {
  static luaName = '_LayeredRenderComponent';
  constructor(public layered: LayeredRenderable, public layer: number, logic: LogicNode) { super(null, logic); }
  addToGame(): void {
    this.layered.addRenderable(this.layer, this.node);
    this.node.foreign = this.parent ? this.parent.p : null;
    this.logic.add(this);
  }
  removeFromGame(): void {
    this.layered.removeRenderable(this.layer, this.node);
    this.logic.remove(this);
  }
  changeLayer(layer: number): void {
    if (this.layered && this.layer !== layer) {
      const was = this.layered.layers.get(this.layer)?.includes(this.node);
      this.layered.removeRenderable(this.layer, this.node);
      this.layer = layer;
      if (was) this.layered.addRenderable(layer, this.node);
    } else this.layer = layer;
  }
}
LObj.bind(LayeredRenderComponent, { methods: { change_layer: (s: LayeredRenderComponent, l) => { s.changeLayer(Number(l)); } } });
