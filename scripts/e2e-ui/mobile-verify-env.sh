#!/usr/bin/env bash
# 手機版優化驗證輪：E2E_MOCK 全站環境（依 repo 既有配方；見 DECISIONS.md 驗證輪）
# 用法： bash scripts/e2e-ui/mobile-verify-env.sh <db-name> <port> <asset-dir> <logfile>
set -e
DB="$1"; PORT="$2"; ASSET_DIR="$3"; LOG="$4"

# 容器已由外部確保存在（aios-pg @5433）
export DATABASE_URL="postgresql://postgres:postgres@localhost:5433/${DB}"

# 全新 DB（可重入：已存在就重建 schema）
PGPASSWORD=postgres docker exec aios-pg psql -U postgres -c "DROP DATABASE IF EXISTS ${DB};" > /dev/null
PGPASSWORD=postgres docker exec aios-pg psql -U postgres -c "CREATE DATABASE ${DB};" > /dev/null
npx tsx scripts/db/migrate.ts > /dev/null

mkdir -p "$ASSET_DIR"
NODE_ENV=production \
RATE_LIMIT_SECRET="mobile-verify-rate-limit-secret-0123456789ab" \
SESSION_SECRET="mobile-verify-session-secret-0123456789abcd" \
PORT="$PORT" E2E_MOCK=1 MOCK_BILLING=1 \
SEED_ADMIN_EMAIL=admin@aidirector.local SEED_ADMIN_PASSWORD=test-admin-123 \
MCP_API_KEY=test-mcp-key \
ASSET_DIR="$ASSET_DIR" \
node dist/index.js > "$LOG" 2>&1 &
echo $! > "${LOG}.pid"
echo "server pid $(cat "${LOG}.pid") on :${PORT} (db=${DB})"
