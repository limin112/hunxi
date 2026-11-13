#!/usr/bin/env bash
# Generate the concept images with Codex's built-in image_gen tool.
# Needs the Codex CLI logged in with a ChatGPT account:  codex login
#
#   tools/gen_concepts.sh               # boss_front, player_front, keyart in parallel; boss_back once boss_front exists
#   tools/gen_concepts.sh player_front  # only the named prompt(s) from prompts/, in order
#   tools/gen_concepts.sh player_back=concept/player_front.png   # with reference image(s), comma-separated
#
# Output: concept/<name>.png   Logs: out/codex/<name>.log
# An existing concept/<name>.png is renamed to concept/<name>.<timestamp>.png, never overwritten.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/concept"
LOG="$ROOT/out/codex"
mkdir -p "$OUT" "$LOG"

if codex login status 2>&1 | grep -qi "not logged in"; then
  echo "Codex CLI is not logged in. Run:  codex login" >&2
  exit 1
fi

gen() {  # gen NAME [REF1,REF2,...]  (refs: paths relative to the project root or absolute)
  local name="$1" refs="${2:-}"
  local spec="$ROOT/prompts/$name.txt"
  [[ -f "$spec" ]] || { echo "FAIL $name: prompts/$name.txt not found"; return 1; }

  local args=(exec --skip-git-repo-check -s workspace-write -C "$ROOT"
              -c model_reasoning_effort=low -o "$LOG/$name.last.txt")
  local refnote="" count=0 ref
  if [[ -n "$refs" ]]; then
    IFS=',' read -r -a reflist <<<"$refs"
    for ref in "${reflist[@]}"; do
      [[ "$ref" == /* ]] || ref="$ROOT/$ref"
      [[ -f "$ref" ]] || { echo "FAIL $name: reference $ref not found"; return 1; }
      args+=(-i "$ref"); count=$((count + 1))
    done
    refnote="The $count attached image(s) are Image 1..$count in order: use them only as references, do not modify those files."
  fi
  [[ -f "$OUT/$name.png" ]] && mv "$OUT/$name.png" "$OUT/$name.$(date +%Y%m%d-%H%M%S).png"

  echo "...  $name"
  {
    echo "Use your built-in image_gen tool (not the CLI fallback, no API key, no code) to generate exactly ONE image from the spec below. $refnote"
    echo "When it is done, copy the generated file from \$CODEX_HOME/generated_images to: $OUT/$name.png (PNG). Do not create any other files. Reply with only that path."
    echo
    cat "$spec"
  } | codex "${args[@]}" >"$LOG/$name.log" 2>&1

  if [[ -f "$OUT/$name.png" ]]; then
    echo "ok   $name -> concept/$name.png"
  else
    echo "FAIL $name (see out/codex/$name.log)"
    return 1
  fi
}

if [[ $# -gt 0 ]]; then  # args: NAME or NAME=REF1,REF2 ; run in the order given
  rc=0
  for arg in "$@"; do
    name="${arg%%=*}"; refs=""
    [[ "$arg" == *=* ]] && refs="${arg#*=}"
    [[ "$name" == "boss_back" && -z "$refs" ]] && refs="concept/boss_front.png"
    gen "$name" "$refs" || rc=1
  done
  exit $rc
fi

gen boss_front & p_boss=$!
gen player_front & p_player=$!
gen keyart & p_key=$!

rc=0
wait $p_boss || rc=1
if [[ -f "$OUT/boss_front.png" ]]; then
  gen boss_back "$OUT/boss_front.png" || rc=1
else
  echo "skip boss_back (boss_front failed)"; rc=1
fi
wait $p_player || rc=1
wait $p_key || rc=1
exit $rc
