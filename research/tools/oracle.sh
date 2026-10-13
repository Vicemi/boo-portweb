#!/bin/bash
# runs the ORIGINAL game (native i386 binary) in WSL under Xvfb and plays a script: oracle.sh <outdir> <steps...>
#   steps:  sleep:SECONDS   shot:NAME   key:NAME (xdotool key)   keydown:NAME   keyup:NAME   hold:NAME:SECONDS   type:TEXT
# the screenshots go to <outdir>/NAME.png (the game window is 600x450 inside an 800x600 root: cropped to 600x450 at +100+75)
OUT=$1; shift
mkdir -p $OUT
cd /root/boo
rm -f lib-i386/libstdc++.so.6
export LD_LIBRARY_PATH=/root/boo/lib-i386
export SDL_AUDIODRIVER=${SDL_AUDIODRIVER:-dummy}
pkill Xvfb 2>/dev/null; pkill -f "./boo 0 1 1" 2>/dev/null
Xvfb :99 -screen 0 800x600x24 >/dev/null 2>&1 &
XP=$!
sleep 1.5
export DISPLAY=:99
./boo 0 1 1 > /root/boo_out.txt 2>&1 &
BP=$!
sleep 1
xdotool mousemove 400 300 2>/dev/null
WID=$(xdotool search --onlyvisible --class . 2>/dev/null | head -1)
[ -n "$WID" ] && xdotool windowfocus $WID 2>/dev/null
for step in "$@"; do
  case "$step" in
    sleep:*) sleep ${step#sleep:} ;;
    shot:*) import -window root -crop 600x450+100+75 +repage $OUT/${step#shot:}.png 2>/dev/null ;;
    key:*) xdotool key ${step#key:} ;;
    keydown:*) xdotool keydown ${step#keydown:} ;;
    keyup:*) xdotool keyup ${step#keyup:} ;;
    hold:*) k=${step#hold:}; n=${k%%:*}; s=${k#*:}; xdotool keydown $n; sleep $s; xdotool keyup $n ;;
    type:*) xdotool type ${step#type:} ;;
  esac
done
kill $BP $XP 2>/dev/null
grep -v "libpng" /root/boo_out.txt | head -40
