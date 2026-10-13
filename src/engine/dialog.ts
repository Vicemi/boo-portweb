// The dialog box of the original (a native class): lines typed letter by letter, advanced with the action key, and two-option questions.
// The timing is a first version: it gets verified against the original (research/probe).
import { LObj } from './luabind';
import { RenderNode, Vec2, num } from './scene';
import { Font, Text } from './text';
import { LogicNode, NativeComponent, Stage, lua } from './logic';
import type { Game } from './game';
import type { LuaValue } from '../lua/value';

export const CHARS_PER_TICK = 1;

class DialogUpdater extends NativeComponent {
  constructor(public d: DialogManager) { super(); }
  update(): void { this.d.update(); }
}

export class DialogManager extends LObj {
  static luaName = 'DialogManager';
  node = new RenderNode();
  text: Text;
  options: Text[] = [];
  textW = 400; textH = 100;
  color = 0xffffffff; colorSelected = 0xffffffff;
  full = '';
  shown = 0;
  cb: LuaValue = undefined;
  optCb: LuaValue = undefined;
  selected = 0;
  active = false;
  updater: DialogUpdater;
  constructor(public game: Game, public stage: Stage, public font: Font, public render: RenderNode, public logic: LogicNode) {
    super();
    this.text = new Text(font, this.color);
    this.node.children.addChild(this.text);
    render.children.addChild(this.node);
    this.updater = new DialogUpdater(this);
    logic.add(this.updater);
  }
  setPos(x: number, y: number): void { this.text.p.x = x; this.text.p.y = y; }
  start(): void { this.active = true; this.node.enabled = true; }
  finish(): void { this.active = false; this.full = ''; this.text.setText(''); this.cb = undefined; this.optCb = undefined; for (const o of this.options) this.node.children.removeChild(o); this.options = []; }
  line(t: string, cb: LuaValue): void {
    this.full = t; this.shown = 0; this.cb = cb; this.optCb = undefined;
    this.text.width = this.textW; this.text.height = this.textH; this.text.color = this.color;
    this.text.setText('');
  }
  ask(t: string, a: string, b: string, cb: LuaValue): void {
    this.line(t, undefined);
    this.optCb = cb; this.selected = 0;
    for (const o of this.options) this.node.children.removeChild(o);
    this.options = [a, b].map((s, i) => { const x = new Text(this.font, this.color); x.setText(s); x.width = this.textW; x.height = 24; x.p.x = this.text.p.x; x.p.y = this.text.p.y + this.textH + i * 26; this.node.children.addChild(x); return x; });
  }
  update(): void {
    if (!this.active || this.full === '') return;
    const inp = this.game.input;
    if (this.shown < this.full.length) {
      this.shown = Math.min(this.full.length, this.shown + CHARS_PER_TICK);
      if (inp.inputs.get('action_1')!.pressed) this.shown = this.full.length;
      this.text.setText(this.full.slice(0, this.shown));
      return;
    }
    if (this.optCb !== undefined) {
      if (inp.inputs.get('up')!.pressed) this.selected = 0;
      if (inp.inputs.get('down')!.pressed) this.selected = 1;
      this.options.forEach((o, i) => { o.color = i === this.selected ? this.colorSelected : this.color; });
      if (inp.inputs.get('action_1')!.pressed) { const cb = this.optCb; this.optCb = undefined; lua().callArr(cb, [this.selected + 1]); }
      return;
    }
    if (inp.inputs.get('action_1')!.pressed) { const cb = this.cb; this.cb = undefined; if (cb !== undefined) lua().callArr(cb, []); }
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
    line: (s: DialogManager, t, cb) => { s.line(String(t ?? ''), cb); },
    options: (s: DialogManager, t, a, b, cb) => { s.ask(String(t ?? ''), String(a ?? ''), String(b ?? ''), cb); },
  },
});
void Vec2;
