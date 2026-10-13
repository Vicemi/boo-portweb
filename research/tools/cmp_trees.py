import os, hashlib, sys
from collections import Counter
A = r'F:\Games\Boo-PortWeb\Boo.activity'
B = r'F:\Games\Boo-PortWeb\boo-portweb\research\deb\usr\share\boo-trojanchicken'


def walk(r):
    out = {}
    for base, _, fs in os.walk(r):
        for f in fs:
            p = os.path.join(base, f)
            out[os.path.relpath(p, r).replace(os.sep, '/')] = p
    return out


a, b = walk(A), walk(B)
print(len(a), len(b))
onlya = [k for k in a if k not in b and not k.startswith(('lib-', 'bin', 'activity'))]
onlyb = [k for k in b if k not in a]
print('only activity', len(onlya), onlya[:20])
print('only deb', len(onlyb), onlyb[:20])
h = lambda p: hashlib.md5(open(p, 'rb').read()).hexdigest()
diff = [k for k in a if k in b and h(a[k]) != h(b[k])]
print('different', len(diff))
print(Counter(k.split('/')[0] + '/' + (k.split('/')[1] if '/' in k else '') for k in diff).most_common(20))
print(diff[:40])
