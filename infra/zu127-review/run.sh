#!/bin/sh
set -eu

test -f /input/F0152.pdf
test "$(stat -c %s /input/F0152.pdf)" = 6359136
printf '%s  %s\n' \
  99ec972d7dfe5039fca922e3120bd5e486f2a26518f78044d0850992c028e7af \
  /input/F0152.pdf | sha256sum -c -s -
test "$(pdftotext -v 2>&1 | head -n 1)" = "pdftotext version 25.12.0"

python3 /review/run_worker.py
node --import tsx /review/run_verifier.ts
