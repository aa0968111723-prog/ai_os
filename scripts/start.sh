#!/bin/sh
# AI Director OS 容器啟動（平台中立，目前用 Zeabur）。
# 正式啟動只做唯讀 migration/schema gate；絕不在 runtime push DDL。

if [ -z "$DATABASE_URL" ]; then
  echo "[start] ⚠⚠⚠ DATABASE_URL 未設定！"
  echo "[start]     → 到部署平台的服務 Variables 設定 DATABASE_URL（Zeabur：跨服務引用 PostgreSQL 服務的連線字串）"
  echo "[start]     正式服務拒絕以無資料庫狀態啟動"
  exit 78
else
  echo "[start] DATABASE_URL 已設定（$(echo "$DATABASE_URL" | sed 's#^.*@#***@#')）"
fi
# 全站一律真實模式（示範模式已移除；E2E_MOCK=1 僅供自動化測試，正式部署絕不設定）
if [ "$E2E_MOCK" = "1" ]; then
  echo "[start] ⚠ Fal：E2E 測試模式（E2E_MOCK=1）——僅供自動化測試，正式部署請移除此變數"
elif [ -z "$FAL_KEY" ]; then
  echo "[start] ⚠⚠⚠ FAL_KEY 未設定！系統為真實生成模式，媒體生成將全部失敗（自動退點）"
  echo "[start]     → 到部署平台的服務 Variables 填入 fal.ai 金鑰後重新部署"
else
  echo "[start] Fal：真實生成模式（FAL_KEY 已設）"
fi

echo "[start] 唯讀檢查 migration ledger 與 schema drift…"
if ! npm run db:check; then
  echo "[start] ⚠ 資料庫尚未達可啟動狀態；本程序沒有套用任何 DDL"
  echo "[start]   空 DB：先以 release/one-off job 執行 npm run db:migrate"
  echo "[start]   既有 DB：先備份，執行 npm run db:adopt:dry-run，再依 fingerprint adopt"
  exit 78
fi

exec node dist/index.js
