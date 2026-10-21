#!/bin/bash
# Build the laptop-only exporter; never installs or writes to Move.
set -euo pipefail
cd "$(dirname "$0")/.."
out=build/twain-export-laptop
mkdir -p "$out"
cc -O3 -Wall -Wextra tools/twain-export/render.c -o "$out/twain-render" -lm
cp tools/twain-export/server.py tools/twain-export/index.html tools/twain-export/README.md tools/twain-export/Open\ Twain\ Export.command "$out/"
chmod +x "$out/twain-render" "$out/Open Twain Export.command"
COPYFILE_DISABLE=1 /usr/bin/ditto -c -k --norsrc --keepParent "$out" build/Twain-Export-Mac.zip
printf 'Built build/Twain-Export-Mac.zip\n'
