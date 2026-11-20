#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
APP=$ROOT/app
PID=$ROOT/mybi.pid
if [ -f "$PID" ] && kill -0 "$(cat "$PID")" 2>/dev/null; then echo "Already running (pid $(cat "$PID"))"; exit 0; fi
set -a; . "$ROOT/.env"; set +a
mkdir -p "$APP/data/logs"
cd "$APP"
nohup "$ROOT/venv/bin/python" -m uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port "${PORT:-8000}" \
  >> "$APP/data/logs/server.log" 2>&1 < /dev/null &
echo $! > "$PID"
for _ in $(seq 30); do
  curl -fs "http://127.0.0.1:${PORT:-8000}/api/health" -u "$MYBI_ADMIN_USER:$MYBI_ADMIN_PASSWORD" >/dev/null && { echo "Started (pid $(cat "$PID")) on port ${PORT:-8000}"; exit 0; }
  kill -0 "$(cat "$PID")" 2>/dev/null || break
  sleep 1
done
echo "Failed to start; last log lines:"; tail -n 30 "$APP/data/logs/server.log"; exit 1
