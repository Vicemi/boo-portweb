// Loader of precompiled Lua 5.1 chunks (luac). The game ships its code as 32-bit little endian bytecode.
import { Proto, LuaError } from './value';

class Reader {
  pos = 0;
  constructor(public b: Uint8Array, public sizeInt: number, public sizeT: number, public little: boolean) {}
  byte(): number { return this.b[this.pos++]; }
  int(): number {
    let v = 0;
    if (this.little) for (let i = 0; i < this.sizeInt; i++) v |= this.b[this.pos + i] << (8 * i);
    else for (let i = 0; i < this.sizeInt; i++) v = (v << 8) | this.b[this.pos + i];
    this.pos += this.sizeInt;
    return v;
  }
  sizeT_(): number {
    let v = 0;
    if (this.little) for (let i = this.sizeT - 1; i >= 0; i--) v = v * 256 + this.b[this.pos + i];
    else for (let i = 0; i < this.sizeT; i++) v = v * 256 + this.b[this.pos + i];
    this.pos += this.sizeT;
    return v;
  }
  num(): number {
    const dv = new DataView(this.b.buffer, this.b.byteOffset + this.pos, 8);
    this.pos += 8;
    return dv.getFloat64(0, this.little);
  }
  str(): string | undefined {
    const n = this.sizeT_();
    if (n === 0) return undefined;
    let s = '';
    for (let i = 0; i < n - 1; i++) s += String.fromCharCode(this.b[this.pos + i]);
    this.pos += n;
    return s;
  }
}

function func(r: Reader, parentSource: string): Proto {
  const f = new Proto();
  f.source = r.str() ?? parentSource;
  f.lineDefined = r.int();
  f.lastLine = r.int();
  f.nups = r.byte();
  f.numparams = r.byte();
  f.isVararg = r.byte();
  f.maxstack = r.byte();
  const n = r.int();
  f.code = new Int32Array(n);
  for (let i = 0; i < n; i++) f.code[i] = r.little ? (r.b[r.pos] | (r.b[r.pos + 1] << 8) | (r.b[r.pos + 2] << 16) | (r.b[r.pos + 3] << 24)) : ((r.b[r.pos] << 24) | (r.b[r.pos + 1] << 16) | (r.b[r.pos + 2] << 8) | r.b[r.pos + 3]), r.pos += 4;
  const nk = r.int();
  f.k = new Array(nk);
  for (let i = 0; i < nk; i++) {
    const t = r.byte();
    switch (t) {
      case 0: f.k[i] = undefined; break;
      case 1: f.k[i] = r.byte() !== 0; break;
      case 3: f.k[i] = r.num(); break;
      case 4: f.k[i] = r.str() ?? ''; break;
      default: throw new LuaError('bad constant type in precompiled chunk');
    }
  }
  const np = r.int();
  f.p = new Array(np);
  for (let i = 0; i < np; i++) f.p[i] = func(r, f.source);
  const nl = r.int();
  f.lineinfo = new Int32Array(nl);
  for (let i = 0; i < nl; i++) f.lineinfo[i] = r.int();
  const nv = r.int();
  for (let i = 0; i < nv; i++) f.locvars.push({ name: r.str() ?? '', startpc: r.int(), endpc: r.int() });
  const nu = r.int();
  for (let i = 0; i < nu; i++) f.upvalueNames.push(r.str() ?? '');
  return f;
}

export function isBytecode(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x1b && bytes[1] === 0x4c && bytes[2] === 0x75 && bytes[3] === 0x61;
}

export function undump(bytes: Uint8Array): Proto {
  if (!isBytecode(bytes)) throw new LuaError('bad binary format (not a precompiled chunk)');
  if (bytes[4] !== 0x51) throw new LuaError('bad binary format (version mismatch)');
  const little = bytes[6] === 1, sizeInt = bytes[7], sizeT = bytes[8];
  if (bytes[9] !== 4 || bytes[10] !== 8) throw new LuaError('bad binary format (unsupported sizes)');
  const r = new Reader(bytes, sizeInt, sizeT, little);
  r.pos = 12;
  return func(r, '=?');
}
