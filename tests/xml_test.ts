// the native xml parser builds the same tables as the Lua one of the game, over every tmx file
import { readdirSync, readFileSync } from 'node:fs';
import { Game } from '../src/engine/game';
import { folderFiles, CanvasRasterizer } from './../tools/node_host';
import { compileChunk } from '../src/lua/compile';

const ROOT = 'F:/Games/Boo-PortWeb/Boo.activity';
const g = new Game({ files: folderFiles(ROOT), rast: new CanvasRasterizer(), print: () => {}, userRead: () => undefined, userWrite: () => {} });
(g as any).patches = {};     // keep the original Lua parser
g.boot(new TextEncoder().encode('package.loaded["development"]=true ENABLE_SCREEN=false MAP_TO_LOAD="flat_16_main" ENABLE_GHOSTS=false loadfile("src/start.lua")()'));
const run = (code: string): any => { const r = g.L.pcall(compileChunk(g.L, code, '=x'), []); if (!r.ok) throw new Error(String(r.err)); return r.r[0]; };
run(`require("xml_parser.xml_parser")
LUA_PARSE = XL.from_string
local function ser(t, out)
  if type(t) ~= "table" then out[#out + 1] = string.format("%q", tostring(t)) return end
  out[#out + 1] = "{"
  for i = 1, #t do ser(t[i], out) out[#out + 1] = "," end
  for k, v in next, t do
    if not (type(k) == "number" and k >= 1 and k <= #t) then out[#out + 1] = tostring(k) .. "=" ser(v, out) out[#out + 1] = ";" end
  end
  out[#out + 1] = "}"
end
function SER(x) local o = {} ser(x, o) return table.concat(o) end`);
let bad = 0, n = 0;
for (const f of readdirSync(ROOT + '/assets/maps').filter(f => f.endsWith('.tmx'))) {
  g.opts.files.read('assets/maps/' + f);
  const a = run(`local f = io.open("assets/maps/${f}") local s = f:read("*all") f:close()
    local x = XL:new() LUA_PARSE(x, s) local y = XL:new() __xml_parse(y, s) return SER(x.xml) == SER(y.xml)`);
  n++;
  if (a !== true) { bad++; console.log('DIFF', f); }
}
// text nodes, comments and a prolog
const extra = `local s = '<?xml version="1.0"?><a x="1" y=\\'2\\'> hi <b/> <c k="v">t</c><!-- c --></a>' local x = XL:new() LUA_PARSE(x, s) local y = XL:new() __xml_parse(y, s) return SER(x.xml) == SER(y.xml)`;
n++; if (run(extra) !== true) { bad++; console.log('DIFF extra'); }
void readFileSync;
console.log(`${n} documents, ${bad} differ`);
process.exitCode = bad ? 1 : 0;
