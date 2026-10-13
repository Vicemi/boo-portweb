#!/bin/bash
# runs a probe script and grabs raw frames as fast as possible: cap.sh <script.lua> <seconds> <outdir>   (frames: <outdir>/fN.xwd + times.txt)
cd /root/boo
export LD_LIBRARY_PATH=/root/boo/lib-i386 SDL_AUDIODRIVER=dummy DISPLAY=:99
cp /mnt/f/Games/Boo-PortWeb/boo-portweb/research/probe/$1 src/start.lua
rm -f /root/probe_out.txt
pkill Xvfb; pkill -f "./boo 0 1 1"
Xvfb :99 -screen 0 800x600x24 >/dev/null 2>&1 &
sleep 1.5
./boo 0 1 1 > /root/boo_out.txt 2>&1 &
BP=$!
OUT=$3; rm -rf $OUT; mkdir -p $OUT
END=$(( $(date +%s) + $2 ))
i=0
while [ $(date +%s) -lt $END ]; do
  xwd -root -silent -display :99 > $OUT/f$i.xwd
  echo "$i $(date +%s.%N)" >> $OUT/times.txt
  i=$((i+1))
done
kill $BP; pkill Xvfb
cp /root/probe_out.txt /mnt/f/Games/Boo-PortWeb/boo-portweb/research/probe/last_out.txt 2>/dev/null
