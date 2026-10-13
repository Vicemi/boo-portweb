import sys,struct
d=sys.argv[1]
times=[l.split() for l in open(d+'/times.txt')]
prev=None
for i,t in times:
    f=open(d+'/f%s.xwd'%i,'rb').read()
    hs=struct.unpack('>I',f[0:4])[0]; nc=struct.unpack('>I',f[76:80])[0]; bpl=struct.unpack('>I',f[48:52])[0]
    off=hs+nc*12
    ys=[]
    for y in range(75+370,75+430):
        row=off+y*bpl
        for x in range(100+195,100+210):
            p=row+x*4
            b,g,r=f[p],f[p+1],f[p+2]
            if r>200 and g>200 and b<120: ys.append(y-75)
    pos=round(sum(ys)/len(ys)) if ys else None
    if pos!=prev: print('%s t=%.2f arrow_y=%s'%(i,float(t),pos)); prev=pos
