#!/bin/bash
# runs a probe script INSIDE the original engine (it replaces src/start.lua): probe.sh <script.lua> <seconds> [xdotool keys to send, space separated, one per second]
cd /root/boo
export LD_LIBRARY_PATH=/root/boo/lib-i386 SDL_AUDIODRIVER=dummy DISPLAY=:99
cp /mnt/f/Games/Boo-PortWeb/boo-portweb/research/probe/$1 src/start.lua
rm -f /root/probe_out.txt /root/probe_keys.txt
pkill Xvfb; pkill -f "./boo 0 1 1"
Xvfb :99 -screen 0 800x600x24 >/dev/null 2>&1 &
sleep 1.5
./boo 0 1 1 > /root/boo_out.txt 2>&1 &
BP=$!
sleep 1
xdotool mousemove 400 300
WID=$(xdotool search --onlyvisible --class . 2>/dev/null | head -1)
[ -n "$WID" ] && xdotool windowfocus $WID
SECS=$2; shift; shift
for k in "$@"; do sleep 1.3; echo "$(date +%s.%N) send $k" >> /root/probe_keys.txt; xdotool keydown $k; sleep 0.2; xdotool keyup $k; done
sleep $SECS
kill $BP; pkill Xvfb
cp /root/probe_out.txt /mnt/f/Games/Boo-PortWeb/boo-portweb/research/probe/last_out.txt 2>/dev/null; cp /root/probe_keys.txt /mnt/f/Games/Boo-PortWeb/boo-portweb/research/probe/last_keys.txt 2>/dev/null

