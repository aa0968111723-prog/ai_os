#!/usr/bin/env bash
# 本機複刻 CI 的 e2e 流程（每套重置 DB → 顯式 migrate/check → 重啟伺服器）。
# 用法：bash scripts/run-e2e-local.sh [suite ...]；不帶參數＝跑全部套件。
set -u

export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres"
export PORT="3199"
export E2E_MOCK="1"
export MOCK_BILLING="1"
export SEED_ADMIN_EMAIL="admin@aidirector.local"
export SEED_ADMIN_PASSWORD="test-admin-123"
export RATE_LIMIT_SECRET="local-e2e-rate-limit-secret-000000000000000000000000000000"
export MCP_API_KEY="test-mcp-key"
export ALLOW_LEGACY_MCP_ADMIN_KEY="1"

SUITES=("$@")
if [ "${#SUITES[@]}" -eq 0 ]; then
  SUITES=(auth models phase2 phase3 phase4 messages databases mcp push export)
fi

FAILED=()
for suite in "${SUITES[@]}"; do
  echo "==================== e2e-$suite ===================="
  PGPASSWORD=postgres psql -h localhost -U postgres -d postgres \
    -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE;' -q
  if ! npm run db:migrate || ! npm run db:check; then
    echo "✘ e2e-$suite migration/check 失敗"
    FAILED+=("$suite(migration)")
    continue
  fi
  setsid npx tsx server/index.ts > "/tmp/server-$suite.log" 2>&1 &
  SERVER_PID=$!
  READY=0
  for i in $(seq 1 90); do
    if curl -sf http://localhost:3199/api/ready 2>/dev/null | grep -q '"boot":"ready'; then
      READY=1; break
    fi
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
      echo "伺服器行程已死，啟動 log："; cat "/tmp/server-$suite.log"; break
    fi
    sleep 1
  done
  if [ "$READY" -ne 1 ]; then
    echo "90 秒內未就緒，啟動 log："; tail -30 "/tmp/server-$suite.log"
    FAILED+=("$suite(boot)")
  else
    if python3 "scripts/e2e-$suite.py"; then
      echo "✔ e2e-$suite 通過"
    else
      echo "✘ e2e-$suite 失敗，伺服器 log："; tail -40 "/tmp/server-$suite.log"
      FAILED+=("$suite")
    fi
  fi
  /bin/kill -TERM -- "-$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
done

echo "==================== 總結 ===================="
if [ "${#FAILED[@]}" -eq 0 ]; then
  echo "✅ 全部 e2e 套件通過（${SUITES[*]}）"
  exit 0
else
  echo "❌ 失敗套件：${FAILED[*]}"
  exit 1
fi
