#!/bin/sh
set -eu

test -f /input/F0101.pdf
test "$(stat -c %s /input/F0101.pdf)" = 891618
printf '%s  %s\n' \
  01db90e015c39a9502b99969ce04f27825265203bc8728da6141d7b6d2b1ef54 \
  /input/F0101.pdf | sha256sum -c -s -
test "$(pdftotext -v 2>&1 | head -n 1)" = "pdftotext version 25.12.0"

/opt/pz006-venv/bin/python /review/run_worker.py
node --import tsx /review/run_verifier.ts
