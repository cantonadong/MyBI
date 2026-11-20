#!/usr/bin/env bash
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
PID=$ROOT/mybi.pid
set -a; . "$ROOT/.env"; set +a
if [ -f "$PID" ] && kill -0 "$(cat "$PID")" 2>/dev/null; then echo "Running (pid $(cat "$PID"))"; else echo "Not running"; fi
curl -s "http://127.0.0.1:${PORT:-8000}/api/health" -u "$MYBI_ADMIN_USER:$MYBI_ADMIN_PASSWORD"; echo
tail -n 20 "$ROOT/app/data/logs/server.log" 2>/dev/null
