#!/bin/sh
# Every 60s: update long-run memory, restart soak/pg if dead, never print secrets.
set -eu
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
DIR=/tmp/aios-soak
mkdir -p "$DIR" "$ROOT/.grok/longrun"
LOG="$DIR/pulse.log"
cd "$ROOT"
if [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT/.env"
  set +a
fi
echo "PULSE_LOOP_START at=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$LOG"
while true; do
  npx tsx "$ROOT/scripts/aios-engineering-pulse.ts" >>"$LOG" 2>&1 || echo "PULSE_FAIL at=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$LOG"
  if [ -x "$ROOT/scripts/aios-longrun-keepalive.sh" ]; then
    # one-shot ensure: start keepalive if missing
    if [ ! -f "$DIR/keepalive.pid" ] || ! kill -0 "$(cat "$DIR/keepalive.pid")" 2>/dev/null; then
      nohup "$ROOT/scripts/aios-longrun-keepalive.sh" >>"$DIR/keepalive.log" 2>&1 &
      echo $! >"$DIR/keepalive.pid"
      echo "KEEPALIVE_RESTART at=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$LOG"
    fi
  fi
  sleep 60
done
