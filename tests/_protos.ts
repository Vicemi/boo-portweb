import { readFileSync } from 'node:fs';
import { undump } from '../src/lua/undump';
const names = 'MOVE LOADK LOADBOOL LOADNIL GETUPVAL GETGLOBAL GETTABLE SETGLOBAL SETUPVAL SETTABLE NEWTABLE SELF ADD SUB MUL DIV MOD POW UNM NOT LEN CONCAT JMP EQ LT LE TEST TESTSET CALL TAILCALL RETURN FORLOOP FORPREP TFORLOOP SETLIST CLOSE CLOSURE VARARG'.split(' ');
const p = undump(new Uint8Array(readFileSync(process.argv[2])));
const want = +process.argv[3];
const walk = (q: any): void => {
  if (q.lineDefined === want) {
    q.code.forEach((i: number, n: number) => console.log(q.lineinfo[n], names[i & 63], (i >>> 6) & 255, (i >>> 23), (i >>> 14) & 511, i >>> 14));
    console.log('K', JSON.stringify(q.k));
  }
  q.p.forEach(walk);
};
walk(p);
