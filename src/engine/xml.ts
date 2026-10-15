// Native replacement of XL:from_string of the original (src/xml_parser/xml_parser.lua): the game parses the whole tmx file again for every manager of a map (about 30 times
// per map change), which made the interpreted version half of the load time. It builds the same tables (same fields, same order) as the Lua code.
import { LuaTable, LuaError, type LuaValue } from '../lua/value';

const TAG = /<(\/?)([A-Za-z0-9:]+)([\s\S]*?)(\/?)>/g;      // "<(%/?)([%w:]+)(.-)(%/?)>"
const ATTR = /([A-Za-z0-9]+)=(["'])([\s\S]*?)\2/g;          // "(%w+)=([\"'])(.-)%2"
const BLANK = /^[ \t\n\v\f\r]*$/;

function attrs(s: string): LuaTable {
  const t = new LuaTable();
  ATTR.lastIndex = 0;
  for (let m = ATTR.exec(s); m; m = ATTR.exec(s)) t.set(m[1], m[3]);
  return t;
}

function node(tag: string, attr: string): LuaTable {
  const t = new LuaTable();
  t.set('tag', tag);
  t.set('attr', attrs(attr));
  return t;
}

const push = (t: LuaTable, v: LuaValue): void => { t.set(t.length() + 1, v); };

/** parses `s` into the tree the Lua parser builds and stores it in `self.xml` */
export function xmlFromString(self: LuaValue, s: string): void {
  const stack: LuaTable[] = [new LuaTable()];
  let top = stack[0];
  let i = 0;
  TAG.lastIndex = 0;
  for (;;) {
    TAG.lastIndex = i;
    const m = TAG.exec(s);
    if (!m) break;
    const text = s.slice(i, m.index);
    if (!BLANK.test(text)) push(top, text);
    const [all, c, tag, attr, empty] = m;
    if (empty === '/') push(top, node(tag, attr));
    else if (c === '') { top = node(tag, attr); stack.push(top); }
    else {
      const toclose = stack.pop()!;
      top = stack[stack.length - 1];
      if (stack.length < 1) throw new LuaError('nothing to close with ' + tag);
      if (toclose.get('tag') !== tag) throw new LuaError('trying to close ' + toclose.get('tag') + ' with ' + tag);
      push(top, toclose);
    }
    i = m.index + all.length;
  }
  const text = s.slice(i);
  if (!BLANK.test(text)) push(stack[stack.length - 1], text);
  if (stack.length > 1) throw new LuaError('unclosed ' + stack[stack.length - 1].get('tag'));
  (self as LuaTable).set('xml', stack[0]);
}
