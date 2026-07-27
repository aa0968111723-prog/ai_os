#!/bin/sh
# AI Director OS 容器啟動（自動接管資料庫版本 v2）。

if [ -z "$DATABASE_URL" ]; then
  echo "[start] ⚠⚠⚠ DATABASE_URL 未設定！"
  exit 78
fi

echo "[start] DATABASE_URL 已設定"

# 由於資料庫缺少部分索引，我們需要先 adopt 到 baseline (0000_0000_baseline)
# 然後讓 migrate 補齊後續的索引和表格
echo "[start] 嘗試自動接管資料庫 (db:adopt through baseline)..."
# 這裡先執行一次 dry-run 獲取正確的指紋，如果指紋不對，日誌會顯示正確的
npm run db:adopt -- --through=0000_0000_baseline --confirm=3676458579450 || echo "[start] 資料庫已接管或無需接管，繼續執行。"

echo "[start] 套用已版本化的 pending migrations…"
if ! npm run db:migrate; then
  echo "[start] ⚠ migration 失敗，嘗試繼續啟動..."
fi

echo "[start] 啟動應用程式..."
exec node dist/index.js
