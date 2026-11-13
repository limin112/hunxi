#!/usr/bin/env bash
# Build the 火焰山 · 牛魔 models: copy the chosen Tripo outputs into game/assets/models with web-friendly textures
# (resized, WebP). Same recipe as tools/build_assets.sh.
#
#   tools/build_niumo_assets.sh            build niumo_bull.glb, niumo_monkey.glb (niumo_staff.glb: see below)
#   tools/build_niumo_assets.sh --verify   build, then render contact sheets / clip lists into game/test/out/niumo/assets/
#
# Sources (out/tripo/, see out/tripo/niumo_*/make.json and rig.log for the task ids):
#   niumo_bull    P2 image-to-model (concept/niumo_d_bull_front.png) -> rig v3.0 mixamo -> retarget idle/walk/run
#   niumo_monkey  P2 image-to-model (concept/niumo_d_monkey_front.png) -> rig v3.0 mixamo -> retarget idle/walk/run
#   niumo_staff   NOT from Tripo any more: the image-to-model result (out/tripo/niumo_staff) came out as two parallel
#                 bars (a ladder). The game uses monkey.js createStaff(); the GLB is that rod baked by
#                 `cd game && node test/niumo_monkey.mjs bakestaff`. BUILD_TRIPO_STAFF=1 restores the old Tripo build.
# pick() takes the pinned task folder when it exists, else the newest model.glb under out/tripo/<dir>/.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GT="$ROOT/tools/render/node_modules/.bin/gltf-transform"
OUT="$ROOT/game/assets/models"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT"

pick() {  # pick DIR [PINNED_TASK_FOLDER]
  local pinned="$ROOT/out/tripo/$1/tripo-out/${2:-none}/model.glb"
  if [[ -n "${2:-}" && -f "$pinned" ]]; then echo "$pinned"; return; fi
  ls -t "$ROOT"/out/tripo/"$1"/tripo-out/*/model.glb 2>/dev/null | head -1
}

build() {  # build NAME SRC SIZE
  local name="$1" src="$2" size="$3"
  [[ -f "$src" ]] || { echo "missing source for $name.glb ($src)" >&2; exit 1; }
  "$GT" resize "$src" "$TMP/$name.r.glb" --width "$size" --height "$size" >/dev/null
  "$GT" webp "$TMP/$name.r.glb" "$OUT/$name.glb" --quality 90 >/dev/null
  printf '%-18s %6.1f MB -> %5.1f MB  (%s)\n' "$name.glb" "$(stat -f%z "$src" | awk '{print $1/1e6}')" \
    "$(stat -f%z "$OUT/$name.glb" | awk '{print $1/1e6}')" "${src#$ROOT/}"
}

build niumo_bull   "$(pick niumo_bull_anim   PINNED_BULL)"   2048
build niumo_monkey "$(pick niumo_monkey_anim PINNED_MONKEY)" 2048
if [[ -n "${BUILD_TRIPO_STAFF:-}" ]]; then build niumo_staff "$(pick niumo_staff PINNED_STAFF)" 1024; fi

if [[ "${1:-}" == "--verify" ]]; then
  SHEETS="$ROOT/game/test/out/niumo/assets"
  RENDER="$ROOT/tools/render/render_glb.mjs"
  mkdir -p "$SHEETS"
  for n in niumo_bull niumo_monkey niumo_staff; do
    node "$RENDER" "$OUT/$n.glb" "$SHEETS/$n.png" --views front,q,side,back --label "$n.glb"
  done
  for n in niumo_bull niumo_monkey; do
    node "$RENDER" "$OUT/$n.glb" "$SHEETS/$n.png" --anim list
    for clip in idle walk run; do
      node "$RENDER" "$OUT/$n.glb" "$SHEETS/${n}_$clip.png" --anim "$clip" --times 0,0.25,0.5,0.75 --views q,side --cell 300x450 --label "$n.glb  $clip"
    done
  done
fi
