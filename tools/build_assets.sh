#!/usr/bin/env bash
# Copy the chosen Tripo outputs into game/assets/models with web-friendly textures (resized, WebP).
#   tools/build_assets.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GT="$ROOT/tools/render/node_modules/.bin/gltf-transform"
OUT="$ROOT/game/assets/models"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT"

pick() { ls "$ROOT"/out/tripo/"$1"/tripo-out/*/model.glb | head -1; }

build() {  # build NAME SRC SIZE
  local name="$1" src="$2" size="$3"
  "$GT" resize "$src" "$TMP/$name.r.glb" --width "$size" --height "$size" >/dev/null
  "$GT" webp "$TMP/$name.r.glb" "$OUT/$name.glb" --quality 90 >/dev/null
  printf '%-18s %6.1f MB -> %5.1f MB  (%s)\n' "$name.glb" "$(stat -f%z "$src" | awk '{print $1/1e6}')" \
    "$(stat -f%z "$OUT/$name.glb" | awk '{print $1/1e6}')" "${src#$ROOT/}"
}

build heroine      "$(pick heroine_anim)"     2048
build boss_p1      "$(pick boss_v2_anim)"     2048
build boss_p2      "$(pick boss_v1_anim)"     2048
build knight       "$(pick player_v1_f_anim)" 1024
build boss_sword   "$(pick boss_sword)"       1024
build player_sword "$(pick player_sword)"     1024
