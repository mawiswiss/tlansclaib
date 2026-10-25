#!/bin/sh
# Synthesizes the German test clip as 16 kHz mono WAV. Synthesized speech only.
set -e
out=${1:?usage: make-german.sh OUT.wav}
here=$(dirname "$0")
say -v Anna -f "$here/german.txt" -o "$out.aiff"
afconvert -f WAVE -d LEI16@16000 -c 1 "$out.aiff" "$out"
rm "$out.aiff"
