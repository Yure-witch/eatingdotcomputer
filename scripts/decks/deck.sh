#!/bin/zsh
# deck.sh <src.key> <outdir>: open Keynote, write layout.tsv and png/ into outdir
pgrep -x Keynote >/dev/null || { open -a Keynote; sleep 8; }
osascript "${0:h}/deck.applescript" "$1" "$2/png" > "$2/layout.tsv"
