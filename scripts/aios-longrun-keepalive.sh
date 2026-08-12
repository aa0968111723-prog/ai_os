#!/bin/sh
# Keep local Postgres + 2h soak alive across chat disconnects.
# Never prints secrets. Does not fake elapsed time.
set -eu
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
DIR=/tmp/aios-soak
mkdir -p "$DIR"
LOG="$DIR/keepalive.log"
cd "$ROOT"

ensure_pg() {
  if python3 -c 'import socket;s=socket.socket();s.settimeout(0.4);s.connect(("127.0.0.1",5432));s.close()' 2>/dev/null; then
    return 0
  fi
  echo "PG_DOWN restarting aios-pg at=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$LOG"
  docker start aios-pg >/dev/null 2>&1 || true
  i=0
  while [ "$i" -lt 30 ]; do
    if python3 -c 'import socket;s=socket.socket();s.settimeout(0.4);s.connect(("127.0.0.1",5432));s.close()' 2>/dev/null; then
      echo "PG_UP at=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$LOG"
      return 0
    fi
    i=$((i + 1))
    sleep 1
  done
  echo "PG_STILL_DOWN at=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$LOG"
  return 1
}

ensure_loop() {
  if [ -f "$DIR/loop.pid" ] && kill -0 "$(cat "$DIR/loop.pid")" 2>/dev/null; then
    return 0
  fi
  echo "LOOP_START at=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$LOG"
  nohup "$ROOT/scripts/agent-db-soak-loop.sh" >>"$DIR/loop.log" 2>&1 &
  echo $! >"$DIR/loop.pid"
}

echo "KEEPALIVE_START at=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$LOG"
while true; do
  ensure_pg || true
  ensure_loop || true
  sleep 20
done
