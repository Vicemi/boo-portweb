import tarfile, io, sys, lzma, gzip
f=open(r'F:\Games\Boo-PortWeb\Boo-MG.deb','rb').read()
assert f[:8]==b'!<arch>\n'
pos=8
while pos<len(f):
    name=f[pos:pos+16].decode().strip(); size=int(f[pos+48:pos+58]); data=f[pos+60:pos+60+size]; pos+=60+size+(size&1)
    print(name,size)
    def op(d):
        for dec in (lzma.decompress, gzip.decompress, lambda x:x):
            try: return dec(d)
            except Exception: pass
    if name.startswith('control.tar') or name.startswith('data.tar'):
        t=tarfile.open(fileobj=io.BytesIO(op(data)))
        names=t.getnames(); print(len(names)); print('\n'.join(names[:25]))
        for m in t.getmembers():
            if m.name.endswith('control'): print(t.extractfile(m).read().decode())
