#!/usr/bin/env bash
# Start the local server and open the game in the default browser.   ./play.sh   (Ctrl+C to stop)
set -euo pipefail
cd "$(dirname "$0")/game"
[ -d node_modules/three ] || npm install --no-audit --no-fund
PORT="${PORT:-5173}"
NODE="$(command -v node || true)"
if [ -z "$NODE" ] && [ -x "$HOME/.local/bin/node" ]; then NODE="$HOME/.local/bin/node"; fi
if [ -z "$NODE" ]; then echo "找不到 Node.js（需要 20 以上）"; exit 1; fi
"$NODE" serve.mjs "$PORT" &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
sleep 0.6
open "http://127.0.0.1:$PORT/"
echo "游戏已在浏览器打开：http://127.0.0.1:$PORT/   （Ctrl+C 停止服务器）"
wait $SERVER
