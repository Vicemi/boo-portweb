// The input system: named inputs (`game:get_system("input"):get("action_1")`) with down / pressed / up, fed by key codes
import { LObj } from './luabind';

export class InputObj extends LObj {
  static luaName = 'Input';
  down = false; pressed = false; up = false;
  held = new Set<string>();       // physical keys that are down for this name
  pressEvt = false; releaseEvt = false;
  prevDown = false;
}
LObj.bind(InputObj, { get: { down: (s: InputObj) => s.down, pressed: (s: InputObj) => s.pressed, up: (s: InputObj) => s.up } });

/** the mapping of the original (SDL key names -> DOM `KeyboardEvent.code`) */
export const KEYMAP: Record<string, string[]> = {
  up: ['ArrowUp', 'Numpad8'],
  down: ['ArrowDown', 'Numpad2'],
  left: ['ArrowLeft', 'Numpad4'],
  right: ['ArrowRight', 'Numpad6'],
  action_1: ['Space', 'Enter', 'NumpadEnter', 'KeyX', 'Numpad1'],
  action_2: ['KeyS', 'Numpad3'],
  action_3: ['KeyA', 'Numpad7'],
  action_4: ['KeyZ', 'Numpad9'],
  back: ['KeyS'],
  exit: ['KeyC'],
  menu_exit: ['Escape', 'KeyZ', 'Numpad9'],
};

export class InputSystem extends LObj {
  static luaName = 'BooInput';
  inputs = new Map<string, InputObj>();
  byKey = new Map<string, InputObj[]>();
  constructor() {
    super();
    for (const [name, keys] of Object.entries(KEYMAP)) {
      const o = new InputObj();
      this.inputs.set(name, o);
      for (const k of keys) { const l = this.byKey.get(k) ?? []; l.push(o); this.byKey.set(k, l); }
    }
  }
  keyDown(code: string): void {
    const l = this.byKey.get(code);
    if (!l) return;
    for (const o of l) { if (!o.held.has(code)) o.pressEvt = true; o.held.add(code); }
  }
  keyUp(code: string): void {
    const l = this.byKey.get(code);
    if (!l) return;
    for (const o of l) { if (o.held.delete(code)) o.releaseEvt = true; }
  }
  releaseAll(): void { for (const o of this.inputs.values()) { if (o.held.size) o.releaseEvt = true; o.held.clear(); } }
  /** once per logic step. Measured in the original: `down` is true only on the step the key went down, `pressed` while it is held, `up` only on the step it was released */
  update(): void {
    for (const o of this.inputs.values()) {
      const now = o.held.size > 0;
      o.down = (now && !o.prevDown) || o.pressEvt;
      o.pressed = now || o.pressEvt;
      o.up = (!now && o.prevDown) || o.releaseEvt;
      o.prevDown = now;
      o.pressEvt = false; o.releaseEvt = false;
    }
  }
}
LObj.bind(InputSystem, { methods: { get: (s: InputSystem, name) => s.inputs.get(String(name)) } });
