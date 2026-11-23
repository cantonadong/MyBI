#!/usr/bin/env bash
# Installs MyBI under one root folder (<root>/app = MyBI).
# Everything (Python, caches, data) stays inside <root>; no apt, no system changes. Safe to re-run to update.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
APP=$ROOT/app
T=$ROOT/tools
export UV_INSTALL_DIR=$T/bin UV_CACHE_DIR=$T/uv-cache UV_PYTHON_INSTALL_DIR=$T/python UV_NO_MODIFY_PATH=1
mkdir -p "$T/bin"

echo "== Python"
[ -x "$T/bin/uv" ] || curl -LsSf https://astral.sh/uv/install.sh | sh
[ -x "$ROOT/venv/bin/python" ] || "$T/bin/uv" venv "$ROOT/venv" --python 3.12
"$T/bin/uv" pip install --python "$ROOT/venv/bin/python" -r "$APP/backend/pyproject.toml"
# DuckDB 2.x wheels need AVX2 (crash with "Illegal instruction" otherwise); older CPUs get the last 1.x line.
grep -qw avx2 /proc/cpuinfo || "$T/bin/uv" pip install --python "$ROOT/venv/bin/python" "duckdb<2"

echo "== Query core"
# Prebuilt by MyQuery's GitHub Actions from the same source as the Windows DLL; nothing is compiled here.
curl -fL --proto '=https' -o "$APP/libmyquery_core.so.tmp" https://github.com/cantonadong/MyQuery/releases/download/core/libmyquery_core.so
mv "$APP/libmyquery_core.so.tmp" "$APP/libmyquery_core.so"  # rename, not overwrite, so a running server keeps its loaded copy

if [ ! -f "$ROOT/.env" ]; then
  cat > "$ROOT/.env" <<EOF
PORT=8000
MYBI_ADMIN_USER=admin
MYBI_ADMIN_PASSWORD=$(head -c 18 /dev/urandom | base64 | tr -d '/+=')
MYBI_SCHEDULER=true
EOF
  chmod 600 "$ROOT/.env"
  echo "Created $ROOT/.env (login: admin / see MYBI_ADMIN_PASSWORD)"
fi
echo "== Done. Start with: bash $APP/deploy/linux/start.sh"
