import os, subprocess, sys
SRC = r'F:\Games\Boo-PortWeb\Boo.activity'
OUT = r'F:\Games\Boo-PortWeb\boo-portweb\research\lua'
jar = r'F:\Games\Boo-PortWeb\boo-portweb\research\tools\unluac.jar'
bad = []
n = 0
for base, _, fs in os.walk(SRC):
    for f in fs:
        if not f.endswith('.lua'):
            continue
        p = os.path.join(base, f)
        rel = os.path.relpath(p, SRC)
        out = os.path.join(OUT, rel)
        os.makedirs(os.path.dirname(out), exist_ok=True)
        head = open(p, 'rb').read(4)
        if head[:4] != b'\x1bLua':
            open(out, 'wb').write(open(p, 'rb').read())   # already source
            n += 1
            continue
        r = subprocess.run(['java', '-jar', jar, p], capture_output=True)
        if r.returncode != 0 or not r.stdout:
            bad.append((rel, r.stderr.decode('utf-8', 'replace')[:200]))
        open(out, 'wb').write(r.stdout)
        n += 1
print(n, 'files; failures:', len(bad))
for b in bad: print(b)
