import sys,struct
d=sys.argv[1]
times=[l.split() for l in open(d+'/times.txt')]
res=[]
for i,t in times:
    f=open(d+'/f%s.xwd'%i,'rb').read()
    hs=struct.unpack('>I',f[0:4])[0]; nc=struct.unpack('>I',f[76:80])[0]; bpl=struct.unpack('>I',f[48:52])[0]
    off=hs+nc*12
    cnt=0
    for y in range(75+345,75+450,1):
        row=off+y*bpl
        for x in range(100+190,100+560,1):
            p=row+x*4
            b,g,r=f[p],f[p+1],f[p+2]
            if r>150 and g>150 and b<110: cnt+=1
    res.append((float(t),cnt))
t0=res[0][0]
print('\n'.join('%.3f %d'%(t-t0,c) for t,c in res))
