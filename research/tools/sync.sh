#!/bin/bash
# copies the helper scripts to /root of WSL (run after editing them)
for f in probe.sh oracle.sh; do tr -d '\r' < /mnt/f/Games/Boo-PortWeb/boo-portweb/research/tools/$f > /root/$f; chmod +x /root/$f; done
