#!/usr/bin/env bash
# Installs MyBI under one root folder (default layout: <root>/app = MyBI, <root>/myquery = MyQuery source).
# Everything (Python, Rust toolchain, caches, data) stays inside <root>; no apt, no system changes.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
APP=$ROOT/app
T=$ROOT/tools
export UV_INSTALL_DIR=$T/bin UV_CACHE_DIR=$T/uv-cache UV_PYTHON_INSTALL_DIR=$T/python UV_NO_MODIFY_PATH=1
export RUSTUP_HOME=$T/rustup CARGO_HOME=$T/cargo
mkdir -p "$T/bin"

echo "== Python"
[ -x "$T/bin/uv" ] || curl -LsSf https://astral.sh/uv/install.sh | sh
[ -x "$ROOT/venv/bin/python" ] || "$T/bin/uv" venv "$ROOT/venv" --python 3.12
"$T/bin/uv" pip install --python "$ROOT/venv/bin/python" -r "$APP/backend/pyproject.toml"
# DuckDB 2.x wheels need AVX2 (crash with "Illegal instruction" otherwise); older CPUs get the last 1.x line.
grep -qw avx2 /proc/cpuinfo || "$T/bin/uv" pip install --python "$ROOT/venv/bin/python" "duckdb<2"

echo "== Query core"
[ -x "$CARGO_HOME/bin/cargo" ] || curl --proto '=https' -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable --no-modify-path
OPENSSL_LIB_DIR=/usr/lib/x86_64-linux-gnu OPENSSL_INCLUDE_DIR=/usr/include \
  "$CARGO_HOME/bin/cargo" build --manifest-path "$ROOT/myquery/Cargo.toml" --lib --release --locked --no-default-features
cp "$ROOT/myquery/target/release/libmyquery_core.so" "$APP/libmyquery_core.so"
# shortcut: drop build output to save disk (VM has little space); rebuilds take a few minutes longer.
rm -rf "$ROOT/myquery/target"

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
