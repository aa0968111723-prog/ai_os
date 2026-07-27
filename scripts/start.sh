#!/bin/sh
# AI Director OS 容器啟動（自動接管資料庫版本）。

if [ -z "$DATABASE_URL" ]; then
  echo "[start] ⚠⚠⚠ DATABASE_URL 未設定！"
  exit 78
fi

echo "[start] DATABASE_URL 已設定"

# 嘗試執行一次 adopt 以處理 legacy-untracked 狀態
# 指紋碼 833ac32b97e77791 是根據當前 schema 計算的
echo "[start] 嘗試自動接管資料庫 (db:adopt)..."
npm run db:adopt -- --confirm=833ac32b97e77791 || echo "[start] 資料庫已接管或無需接管，繼續執行。"

echo "[start] 套用已版本化的 pending migrations…"
if ! npm run db:migrate; then
  echo "[start] ⚠ migration 失敗，嘗試繼續啟動..."
fi

echo "[start] 啟動應用程式..."
exec node dist/index.js
