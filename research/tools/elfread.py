import struct,sys
data=open('F:/Games/Boo-PortWeb/Boo.activity/boo','rb').read()
phoff=struct.unpack_from('<I',data,28)[0]; phentsize,phnum=struct.unpack_from('<HH',data,42)
segs=[]
for i in range(phnum):
    t,off,va,pa,fsz,msz,fl,al=struct.unpack_from('<8I',data,phoff+i*phentsize)
    if t==1: segs.append((va,off,fsz,msz))
def rd(va,n):
    for v,o,f,m in segs:
        if v<=va<v+f: return data[o+va-v:o+va-v+n]
    return None
def cstr(va):
    b=rd(va,64); 
    return b.split(b'\0')[0].decode('latin1') if b else None
def f32(va): 
    b=rd(va,4); return struct.unpack('<f',b)[0] if b else None
def u32(va):
    b=rd(va,4); return struct.unpack('<I',b)[0] if b else None
if __name__=='__main__':
    for a in sys.argv[1:]:
        kind=a[0]; va=int(a[1:],16)
        print(a, cstr(va) if kind=='s' else f32(va) if kind=='f' else u32(va))
