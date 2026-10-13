// The dialog box of the original (a native class), measured against the real engine (research/probe/probe_dialog*.lua):
//  - the text is typed one character every 2 logic steps (spaces count); pressing the action key (action_2) while typing makes it type 1 character per step
//  - when the line is complete the action key calls the callback given to `line`; `options` shows two choices with an arrow, up / down select, the action key
//    calls the callback with the 0-based option
//  - the question of `options` is typed like a line; the options are 22 px apart, 14 px under the last line of the question
import { LObj } from './luabind';
import { RenderNode, Sprite, TextureObj, Vec2, num } from './scene';
import { Font, Text } from './text';
import { LogicNode, NativeComponent, Stage, lua } from './logic';
import type { Game } from './game';
import type { LuaValue } from '../lua/value';
import { AssetStorage } from './assets';

class DialogUpdater extends NativeComponent {
  constructor(public d: DialogManager) { super(); }
  update(): void { this.d.update(); }
}

export class DialogManager extends LObj {
  static luaName = 'DialogManager';
  node = new RenderNode();
  text: Text;
  optionTexts: Text[] = [];
  arrow: RenderNode;
  textW = 400; textH = 100;
  color = 0xffffffff; colorSelected = 0xffffffff;
  full = '';
  waiting = false;                 // a line is on screen (even an empty one) and its callback has not been called
  shown = 0;
  wait = 0;
  fast = false;
  cb: LuaValue = undefined;
  optCb: LuaValue = undefined;
  options: string[] = [];
  selected = 0;
  active = false;
  constructor(public game: Game, public stage: Stage, public font: Font, public render: RenderNode, public logic: LogicNode) {
    super();
    this.text = new Text(font, this.color);
    this.node.children.addChild(this.text);
    this.arrow = new RenderNode();
    try { this.arrow.renderable = new Sprite(new TextureObj((stage.assetStorage as AssetStorage).texture('assets/dialogs/dialog_arrow.png'))); } catch { /* no arrow image */ }
    this.arrow.enabled = false;
    this.node.children.addChild(this.arrow);
    render.children.addChild(this.node);
    logic.add(new DialogUpdater(this));
  }
  setPos(x: number, y: number): void { this.text.p.x = x; this.text.p.y = y; }
  start(): void { this.active = true; this.node.enabled = true; }
  finish(): void {
    this.active = false; this.waiting = false; this.full = ''; this.shown = 0; this.text.setText(''); this.cb = undefined; this.optCb = undefined; this.options = [];
    for (const o of this.optionTexts) this.node.children.removeChild(o);
    this.optionTexts = []; this.arrow.enabled = false;
  }
  private begin(t: string): void {
    this.full = t; this.waiting = true; this.shown = 0; this.wait = 0; this.fast = false;
    this.text.width = this.textW; this.text.height = this.textH; this.text.color = this.color;
    this.text.setText('');
    for (const o of this.optionTexts) this.node.children.removeChild(o);
    this.optionTexts = []; this.arrow.enabled = false;
  }
  line(t: string, cb: LuaValue): void { this.begin(t); this.cb = cb; this.optCb = undefined; this.options = []; }
  ask(t: string, a: string, b: string, cb: LuaValue): void {
    this.begin(t); this.cb = undefined; this.optCb = cb; this.options = [a, b]; this.selected = 0;
  }
  private showOptions(): void {
    const lines = this.text.layout().length;
    const y0 = this.text.p.y + lines * this.font.metrics.height + 14;
    this.optionTexts = this.options.map((s, i) => {
      const x = new Text(this.font, this.color);
      x.setText(s); x.width = this.textW; x.height = this.font.metrics.height;
      x.p.x = this.text.p.x + 20; x.p.y = y0 + i * 22;
      this.node.children.addChild(x);
      return x;
    });
    this.arrow.enabled = true;
    this.paintSelection(y0);
  }
  private paintSelection(y0?: number): void {
    this.optionTexts.forEach((o, i) => { o.color = i === this.selected ? this.colorSelected : this.color; });
    const base = y0 ?? this.optionTexts[0].p.y;
    this.arrow.p.x = this.text.p.x; this.arrow.p.y = base + this.selected * 22;
  }
  update(): void {
    if (!this.active || !this.waiting) return;
    const inp = this.game.input.inputs;
    const act = inp.get('action_2')!.down;
    if (this.shown < this.full.length) {
      if (act) this.fast = true;
      this.wait++;
      if (this.fast || this.wait >= 2) { this.wait = 0; this.shown++; this.text.setText(this.full.slice(0, this.shown)); }
      if (this.shown >= this.full.length && this.optCb !== undefined) this.showOptions();
      return;
    }
    if (this.optCb !== undefined) {
      if (this.optionTexts.length === 0) this.showOptions();
      if (inp.get('up')!.down && this.selected > 0) { this.selected--; this.paintSelection(); }
      if (inp.get('down')!.down && this.selected < this.options.length - 1) { this.selected++; this.paintSelection(); }
      if (act) { const cb = this.optCb; this.optCb = undefined; lua().callArr(cb, [this.selected]); }
      return;
    }
    if (act) { const cb = this.cb; this.cb = undefined; this.waiting = false; if (cb !== undefined) lua().callArr(cb, []); }
  }
}
LObj.bind(DialogManager, {
  get: { text_width: (s: DialogManager) => s.textW, text_height: (s: DialogManager) => s.textH, color: (s: DialogManager) => s.color, color_selected: (s: DialogManager) => s.colorSelected },
  set: {
    text_width: (s: DialogManager, v) => { s.textW = num(v); }, text_height: (s: DialogManager, v) => { s.textH = num(v); },
    color: (s: DialogManager, v) => { s.color = num(v) >>> 0; }, color_selected: (s: DialogManager, v) => { s.colorSelected = num(v) >>> 0; },
  },
  methods: {
    set_text_position: (s: DialogManager, x, y) => { s.setPos(num(x), num(y)); },
    start: (s: DialogManager) => { s.start(); },
    finish: (s: DialogManager) => { s.finish(); },
    remove_from_game: (s: DialogManager) => { s.finish(); s.render.children.removeChild(s.node); },
    set_background: () => { /* unused by the game */ },
    set_next: () => { /* unused by the game */ },
    printTable: () => { /* debug */ },
    line: (s: DialogManager, t, cb) => { s.line(String(t ?? ''), cb); },
    options: (s: DialogManager, t, a, b, cb) => { s.ask(String(t ?? ''), String(a ?? ''), String(b ?? ''), cb); },
  },
});
void Vec2;
