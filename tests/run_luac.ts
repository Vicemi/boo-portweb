// runs precompiled Lua 5.1 chunks (or Lua source through the text compiler) with the VM and prints what they print: node tests/.run_luac.mjs file...
import { readFileSync } from 'node:fs';
import { LuaState } from '../src/lua/vm';
import { openLibs, type Host } from '../src/lua/lib';
import { compileChunk } from '../src/lua/compile';
import { undump, isBytecode } from '../src/lua/undump';

let out = '';
const L = new LuaState();
const host: Host = {
  readFile: (p) => { try { return readFileSync(p, 'latin1'); } catch { return undefined; } },
  writeFile: () => false,
  removeFile: () => false,
  print: (t) => { out += t + '\n'; },
  write: (t) => { out += t; },
  compile: (src, name) => compileChunk(L, src, name),
};
openLibs(L, host);
for (const f of process.argv.slice(2)) {
  const bytes = readFileSync(f);
  let fn;
  if (isBytecode(new Uint8Array(bytes))) fn = L.closureOf(undump(new Uint8Array(bytes)));
  else fn = compileChunk(L, bytes.toString('latin1'), '@' + f);
  const r = L.pcall(fn, []);
  if (!r.ok) out += 'ERROR: ' + (typeof r.err === 'string' ? r.err : String(r.err)) + '\n' + r.traceback + '\n';
}
process.stdout.write(Buffer.from(out, 'latin1'));
