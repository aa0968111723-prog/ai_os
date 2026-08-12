#!/bin/sh
# Restart the live DB soak if the process dies before PASS.
# Does not fake elapsed time. A restart starts a new wall-clock run.
set -eu
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
DIR=/tmp/aios-soak
mkdir -p "$DIR"
PIDFILE="$DIR/db-soak-120.pid"
LOG="$DIR/db-soak-120.log"
REPORT=/tmp/aios-db-soak-report.json
cd "$ROOT"

# Load local .env keys without printing values.
if [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT/.env"
  set +a
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL_PRESENT=false" >>"$LOG"
  exit 78
fi

start_soak() {
  SOAK_MINUTES="${SOAK_MINUTES:-1440}" SOAK_TICK_MS="${SOAK_TICK_MS:-10000}" \
    nohup npx tsx "$ROOT/scripts/agent-db-soak.ts" >>"$LOG" 2>&1 &
  echo $! >"$PIDFILE"
  echo "SOAK_STARTED pid=$! at=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$LOG"
}

alive() {
  [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null
}

passed() {
  [ -f "$REPORT" ] && python3 - <<'PY'
import json
from pathlib import Path
p=Path("/tmp/aios-db-soak-report.json")
try:
    d=json.loads(p.read_text())
except Exception:
    raise SystemExit(1)
raise SystemExit(0 if d.get("pass") is True else 1)
PY
}

if ! alive; then
  start_soak
fi

while true; do
  if passed; then
    echo "SOAK_PASS at=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$LOG"
    exit 0
  fi
  if ! alive; then
    echo "SOAK_RESTART at=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$LOG"
    start_soak
  fi
  sleep 30
done
