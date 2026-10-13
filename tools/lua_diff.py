"""differential test of the Lua VM: every tests/lua/*.lua runs in real Lua 5.1 (lupa) and in the VM of the project (as bytecode and as source through the
text compiler); the printed output must be identical.   usage: python tools/lua_diff.py [name-filter]"""
import glob, os, subprocess, sys
from lupa import lua51

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
bundle = os.path.join(ROOT, 'tests', '.run_luac.mjs')
subprocess.run('npx esbuild tests/run_luac.ts --bundle --platform=node --format=esm --outfile=tests/.run_luac.mjs --log-level=error', shell=True, check=True)


def runtime():
    return lua51.LuaRuntime(unpack_returned_tuples=True, encoding='latin-1')


def ref(src):
    L = runtime()
    out = []
    ts = L.eval('tostring')
    L.globals().__w = lambda s: out.append(s)
    L.globals().print = lambda *a: out.append('\t'.join(ts(x) for x in a) + '\n')
    L.execute('io.write = function(...) local t = {} for i = 1, select("#", ...) do t[#t+1] = tostring((select(i, ...))) end __w(table.concat(t)) end')
    fn = L.eval('loadstring')(src)
    try:
        fn()
    except Exception as e:  # noqa
        out.append('ERROR: ' + str(e) + '\n')
    return ''.join(out)


def dump(src):
    L = runtime()
    fn = L.eval('loadstring')(src)
    return L.eval('string.dump')(fn).encode('latin-1')


flt = sys.argv[1] if len(sys.argv) > 1 else ''
bad = 0
for f in sorted(glob.glob('tests/lua/*.lua')):
    if flt not in f:
        continue
    src = open(f, encoding='latin-1').read()
    expected = ref(src)
    luac = f + 'c'
    open(luac, 'wb').write(dump(src))
    first_line = src.splitlines()[0] if src else ''
    modes = [('bytecode', luac)] + ([] if 'bytecode-only' in first_line else [('source', f)])
    for label, path in modes:
        r = subprocess.run(['node', bundle, path], capture_output=True)
        got = r.stdout.decode('latin-1') + (r.stderr.decode('latin-1') if r.returncode else '')
        if got != expected:
            bad += 1
            print('MISMATCH', f, label)
            e, g = expected.split('\n'), got.split('\n')
            for i in range(max(len(e), len(g))):
                if i >= len(e) or i >= len(g) or e[i] != g[i]:
                    print('  line', i + 1)
                    print('  expected:', e[i] if i < len(e) else '<none>')
                    print('  got:     ', g[i] if i < len(g) else '<none>')
                    break
        else:
            print('ok', f, label)
    os.remove(luac)
sys.exit(1 if bad else 0)
