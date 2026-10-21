#!/usr/bin/env bash
# ZotLLM im Hintergrund starten und Oberfläche öffnen (macOS/Linux)
set -euo pipefail
cd "$(dirname "$0")"
[ -x .venv/bin/python ] || ./install.sh
nohup .venv/bin/python -m zotllm serve --quiet --open >/dev/null 2>&1 &
echo "ZotLLM läuft (PID $!)."
