#!/usr/bin/env bash
# 本機複刻 CI 的 e2e 流程（每套重置 DB → 顯式 migrate/check → 重啟伺服器）。
# 用法：bash scripts/run-e2e-local.sh [suite ...]；不帶參數＝跑全部套件。
# 動畫組多鏡頭一致性也可點名：animation-consistency（獨立庫跑法見 run-animation-consistency.sh）。
#
# 可覆寫：DATABASE_URL、PORT、E2E_PORT（預設跟 PORT）。
# 無本機 psql 時，若設 E2E_PSQL_DOCKER=stress-pg（或任意容器名）則用 docker exec 下 SQL。
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:5432/postgres}"
export PORT="${PORT:-3199}"
export E2E_PORT="${E2E_PORT:-$PORT}"
export E2E_MOCK="${E2E_MOCK:-1}"
export MOCK_BILLING="${MOCK_BILLING:-1}"
export SEED_ADMIN_EMAIL="${SEED_ADMIN_EMAIL:-admin@aidirector.local}"
export SEED_ADMIN_PASSWORD="${SEED_ADMIN_PASSWORD:-test-admin-123}"
export RATE_LIMIT_SECRET="${RATE_LIMIT_SECRET:-local-e2e-rate-limit-secret-000000000000000000000000000000}"
export MCP_API_KEY="${MCP_API_KEY:-test-mcp-key}"
export ALLOW_LEGACY_MCP_ADMIN_KEY="${ALLOW_LEGACY_MCP_ADMIN_KEY:-1}"
# e2e-mcp.py 用 E2E_PG_CONTAINER 走 docker exec psql；與 E2E_PSQL_DOCKER 對齊
if [ -n "${E2E_PSQL_DOCKER:-}" ] && [ -z "${E2E_PG_CONTAINER:-}" ]; then
  export E2E_PG_CONTAINER="$E2E_PSQL_DOCKER"
fi
if [ -n "${E2E_PG_CONTAINER:-}" ] && [ -z "${E2E_PSQL_DOCKER:-}" ]; then
  export E2E_PSQL_DOCKER="$E2E_PG_CONTAINER"
fi

reset_db() {
  local sql='DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE;'
  if [ -n "${E2E_PSQL_DOCKER:-}${E2E_PG_CONTAINER:-}" ]; then
    local ctn="${E2E_PSQL_DOCKER:-$E2E_PG_CONTAINER}"
    # 從 DATABASE_URL 取 db name；失敗則用 postgres
    local db
    db=$(python3 - <<'PY'
import os
from urllib.parse import urlparse
u=urlparse(os.environ.get("DATABASE_URL",""))
print((u.path or "/postgres").lstrip("/") or "postgres")
PY
)
    docker exec "$ctn" psql -U postgres -d "$db" -v ON_ERROR_STOP=1 -q -c "$sql"
  else
    PGPASSWORD="${PGPASSWORD:-postgres}" psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "$sql"
  fi
}

kill_port_listeners() {
  local port="$1"
  local pid
  for pid in $(ss -ltnp 2>/dev/null | awk -v p=":$port" '$4 ~ p {print}' | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | sort -u); do
    kill "$pid" 2>/dev/null || true
  done
}

SUITES=("$@")
if [ "${#SUITES[@]}" -eq 0 ]; then
  SUITES=(auth models phase2 phase3 phase4 story messages databases mcp push export team-assistant)
fi

FAILED=()
for suite in "${SUITES[@]}"; do
  echo "==================== e2e-$suite ===================="
  if ! reset_db; then
    echo "✘ e2e-$suite DB reset 失敗"
    FAILED+=("$suite(reset)")
    continue
  fi
  if ! npm run db:migrate || ! npm run db:check; then
    echo "✘ e2e-$suite migration/check 失敗"
    FAILED+=("$suite(migration)")
    continue
  fi
  kill_port_listeners "$PORT"
  sleep 1
  # setsid:npx→tsx→node 是一串子行程,單殺 npx 會留下佔埠孤兒；行程群組可整組收乾淨
  setsid npx tsx server/index.ts > "/tmp/server-$suite.log" 2>&1 &
  SERVER_PID=$!
  if ! bash "$ROOT/scripts/wait-api-ready.sh" "http://127.0.0.1:${PORT}" 90; then
    echo "✘ e2e-$suite boot 失敗，啟動 log："
    tail -40 "/tmp/server-$suite.log" || true
    FAILED+=("$suite(boot)")
  else
    if python3 "scripts/e2e-$suite.py"; then
      echo "✔ e2e-$suite 通過"
    else
      echo "✘ e2e-$suite 失敗，伺服器 log："
      tail -40 "/tmp/server-$suite.log" || true
      FAILED+=("$suite")
    fi
  fi
  /bin/kill -TERM -- "-$SERVER_PID" 2>/dev/null || true
  kill_port_listeners "$PORT"
  wait "$SERVER_PID" 2>/dev/null || true
  sleep 1
done

echo "==================== 總結 ===================="
if [ "${#FAILED[@]}" -eq 0 ]; then
  echo "✅ 全部 e2e 套件通過（${SUITES[*]}）"
  exit 0
else
  echo "❌ 失敗套件：${FAILED[*]}"
  exit 1
fi
