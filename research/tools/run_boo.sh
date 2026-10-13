#!/bin/bash
# runs the ORIGINAL game (native i386 binary) in WSL under Xvfb and saves a screenshot: run_boo.sh <seconds> <out.png>
cd /root/boo
rm -f lib-i386/libstdc++.so.6
export LD_LIBRARY_PATH=/root/boo/lib-i386
export SDL_AUDIODRIVER=dummy
SECS=${1:-12}
OUT=${2:-/root/shot1.png}
Xvfb :99 -screen 0 800x600x24 >/dev/null 2>&1 &
XP=$!
sleep 2
export DISPLAY=:99
./boo 0 1 1 > /root/boo_out.txt 2>&1 &
BP=$!
sleep $SECS
import -window root $OUT 2>&1 | head -2
kill $BP $XP 2>/dev/null
head -30 /root/boo_out.txt
ls -la $OUT
