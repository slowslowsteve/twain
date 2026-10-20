#!/usr/bin/env bash
# Cross-compile Twain for the Ableton Move (aarch64 Linux) via Docker,
# mirroring schwung's own toolchain (debian:bookworm + gcc-aarch64-linux-gnu)
# so the .so links against the same glibc as the rest of the ecosystem.
#
# Outputs:
#   build/modules/overtake/twain/dsp.so + module.json + ui.js
#   build/twain-module.tar.gz
set -euo pipefail
cd "$(dirname "$0")/.."

IMAGE=smack-build   # same toolchain image the smack builds use
CFLAGS="-O3 -g -shared -fPIC -Wall -Wextra -Iinclude"

if ! docker image inspect "$IMAGE" &>/dev/null; then
    docker build -t "$IMAGE" - <<'EOF'
FROM debian:bookworm
RUN apt-get update && apt-get install -y gcc-aarch64-linux-gnu binutils-aarch64-linux-gnu file && rm -rf /var/lib/apt/lists/*
EOF
fi

rm -rf build/modules/overtake/twain
mkdir -p build/modules/overtake/twain
cp modules/overtake/twain/module.json build/modules/overtake/twain/
cp src/ui_twain.js build/modules/overtake/twain/ui.js
cp src/twain_projects.mjs src/twain_project_identity.mjs build/modules/overtake/twain/

# Compile AND tar inside the container: macOS bsdtar embeds AppleDouble
# (._*) xattr entries that Linux tar extracts as real files — the schwung
# installer then reads entries[0] = "._twain" and fails. GNU tar in the
# container produces clean archives.
docker run --rm -v "$PWD":/w -w /w "$IMAGE" bash -c "
    set -e
    aarch64-linux-gnu-gcc $CFLAGS -DMARK_TRACKS=4 -DMARK_REQUIRE_FULL_CAPACITY -DMARK_TWAIN src/mark_core.c src/twain_core.c src/twain_gen.c \
        -o build/modules/overtake/twain/dsp.so -lm -lpthread -ldl
    file build/modules/overtake/twain/dsp.so
    aarch64-linux-gnu-readelf -h build/modules/overtake/twain/dsp.so | grep -q AArch64
    aarch64-linux-gnu-readelf --dyn-syms --wide build/modules/overtake/twain/dsp.so | grep -q move_plugin_init_v2
    tar --owner=0 --group=0 -czf build/twain-module.tar.gz -C build/modules/overtake twain
    echo 'tarball contents:'
    tar -tzf build/twain-module.tar.gz
"

for member in twain/module.json twain/dsp.so twain/ui.js twain/twain_projects.mjs twain/twain_project_identity.mjs; do
    tar -tzf build/twain-module.tar.gz "$member" >/dev/null
done
if tar -tzf build/twain-module.tar.gz | grep -Eq '(^|/)(\._|\.DS_Store)'; then
    echo "Unexpected macOS metadata in build/twain-module.tar.gz" >&2
    exit 1
fi

echo "Built: build/twain-module.tar.gz"
