#!/bin/bash
# keyseq.sh <initial sleep> <gap> <keys...> : taps the keys (0.25 s) with a gap between them on display :99
export DISPLAY=:99
sleep $1; GAP=$2; shift; shift
for k in "$@"; do xdotool keydown $k; sleep 0.25; xdotool keyup $k; sleep $GAP; done
