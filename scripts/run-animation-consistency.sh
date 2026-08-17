#!/usr/bin/env bash
# 動畫組多鏡頭一致性 e2e 的本機跑法：獨立 DB + 假生成伺服器（不動開發用的資料庫）。
#
#   bash scripts/run-animation-consistency.sh
#
# 可覆寫：DATABASE_URL（預設用獨立的 aios_anim_e2e 庫）、PORT（預設 3299）。
# 需要本機 psql；DB 需先存在（建法：sudo -u postgres createdb aios_anim_e2e）。
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# 預設用獨立的 e2e 庫。⚠ 安全閘門：若外部（例如殘留在 shell 的）DATABASE_URL 指向
# 開發用資料庫，這支會 DROP SCHEMA——絕不能誤刪。DB 名稱不含 e2e/test/anim 一律拒跑。
export DATABASE_URL="${ANIM_E2E_DATABASE_URL:-postgres://postgres:postgres@127.0.0.1:5432/aios_anim_e2e}"
DB_NAME="$(printf '%s' "$DATABASE_URL" | sed -E 's#^.*/([^/?]+)(\?.*)?$#\1#')"
case "$DB_NAME" in
  *e2e*|*test*|*anim*) : ;;
  *) echo "[anim-e2e] ✘ 拒絕在非 e2e 資料庫上 DROP SCHEMA：'$DB_NAME'。請用 aios_anim_e2e（或設 ANIM_E2E_DATABASE_URL）。"; exit 1 ;;
esac
export PORT="${ANIM_E2E_PORT:-3299}"
export E2E_PORT="$PORT"
export E2E_MOCK="${E2E_MOCK:-1}"
export E2E_MOCK_DELAY_MS="${E2E_MOCK_DELAY_MS:-300}"
export SEED_ADMIN_EMAIL="${SEED_ADMIN_EMAIL:-admin@aidirector.local}"
export SEED_ADMIN_PASSWORD="${SEED_ADMIN_PASSWORD:-test-admin-123}"
export RATE_LIMIT_SECRET="${RATE_LIMIT_SECRET:-anim-e2e-rate-limit-secret-0000000000000000000000000000}"

echo "[anim-e2e] DB=$(echo "$DATABASE_URL" | sed 's#^.*@#***@#')  PORT=$PORT"

echo "[anim-e2e] 重置 schema…"
PGPASSWORD="${PGPASSWORD:-postgres}" psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q \
  -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE;' || {
  echo "[anim-e2e] ✘ 無法連上 DB。請先建立：sudo -u postgres createdb aios_anim_e2e"; exit 1; }

echo "[anim-e2e] migrate + check…"
npm run db:migrate >/tmp/anim-e2e-migrate.log 2>&1 && npm run db:check >/tmp/anim-e2e-check.log 2>&1 || {
  echo "[anim-e2e] ✘ migration/check 失敗"; tail -20 /tmp/anim-e2e-migrate.log /tmp/anim-e2e-check.log; exit 1; }

# 清掉可能佔埠的舊行程
for pid in $(ss -ltnp 2>/dev/null | awk -v p=":$PORT" '$4 ~ p {print}' | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | sort -u); do
  kill "$pid" 2>/dev/null || true
done
sleep 1

echo "[anim-e2e] 啟動假生成伺服器…"
setsid npx tsx server/index.ts >/tmp/anim-e2e-server.log 2>&1 &
SERVER_PID=$!

if ! bash "$ROOT/scripts/wait-api-ready.sh" "http://127.0.0.1:${PORT}" 90; then
  echo "[anim-e2e] ✘ 伺服器 90 秒內未就緒，啟動 log："; tail -40 /tmp/anim-e2e-server.log
  /bin/kill -TERM -- "-$SERVER_PID" 2>/dev/null || true
  exit 1
fi

echo "[anim-e2e] 執行測試腳本…"
python3 "$ROOT/scripts/e2e-animation-consistency.py"
RC=$?

/bin/kill -TERM -- "-$SERVER_PID" 2>/dev/null || true
wait "$SERVER_PID" 2>/dev/null || true

if [ "$RC" -eq 0 ]; then
  echo "[anim-e2e] ✅ 全部通過"
else
  echo "[anim-e2e] ❌ 有斷言失敗（見上方），伺服器 log 末段："; tail -30 /tmp/anim-e2e-server.log
fi
exit "$RC"
