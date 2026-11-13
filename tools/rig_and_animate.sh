#!/usr/bin/env bash
# Rig a finished Tripo generation task and apply preset animations (uses the logged-in tripo CLI).
#
#   tools/rig_and_animate.sh <model_task_id> <name> [spec] [animations...]
#   tools/rig_and_animate.sh d23a0876-... player_v1_f mixamo
#
# spec: mixamo (default) | tripo | unreal | unity | actorcore | vrm
# animations default: preset:idle preset:walk preset:run preset:slash preset:hurt  (max 5, billed each)
# Output: out/tripo/<name>_rig/...  and  out/tripo/<name>_anim/...
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
TASK="$1"; NAME="$2"; SPEC="${3:-mixamo}"; shift $(( $# < 3 ? $# : 3 ))
ANIMS=("$@"); [[ ${#ANIMS[@]} -gt 0 ]] || ANIMS=(preset:idle preset:walk preset:run preset:slash preset:hurt)

last_json() { python3 -I -c 'import json,sys
lines=[l for l in sys.stdin.read().splitlines() if l.startswith("{")]
d=json.loads(lines[-1]); print(d.get("task_id",""))'; }

echo "> rig $TASK (spec=$SPEC)"
rig_out=$(tripo anim rig "$TASK" --spec "$SPEC" --out-format glb -o "out/tripo/${NAME}_rig" --name "${NAME}-rig" --yes --no-open --json)
echo "$rig_out" | tail -1
RIG_ID=$(echo "$rig_out" | last_json)
[[ -n "$RIG_ID" ]] || { echo "rig failed"; exit 1; }

echo "> retarget $RIG_ID: ${ANIMS[*]}"
anim_out=$(tripo anim retarget "$RIG_ID" --animation "${ANIMS[@]}" --out-format glb -o "out/tripo/${NAME}_anim" --name "${NAME}-anim" --yes --no-open --json)
echo "$anim_out" | tail -1
