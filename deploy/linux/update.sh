#!/usr/bin/env bash
# Updates this server to GitHub main: code, query core, Python packages, then restarts and checks health.
# Data, reports, .env and keys are gitignored, so they are never touched.
# Wrapped in a function so bash reads the whole script before `git pull` can replace this file.
main() {
  set -euo pipefail
  local app
  app=$(cd "$(dirname "$0")/../.." && pwd)
  echo "== Code"
  git -C "$app" pull --ff-only
  git -C "$app" log -1 --format='Now at %h %s (%cd)'
  bash "$app/deploy/linux/install.sh"
  bash "$app/deploy/linux/stop.sh"
  bash "$app/deploy/linux/start.sh"
}
main "$@"
