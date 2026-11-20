#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
PID=$ROOT/mybi.pid
[ -f "$PID" ] && kill -0 "$(cat "$PID")" 2>/dev/null || { echo "Not running"; rm -f "$PID"; exit 0; }
kill "$(cat "$PID")"
for _ in $(seq 15); do kill -0 "$(cat "$PID")" 2>/dev/null || { rm -f "$PID"; echo "Stopped"; exit 0; }; sleep 1; done
kill -9 "$(cat "$PID")"; rm -f "$PID"; echo "Killed"
