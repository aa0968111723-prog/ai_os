#!/bin/sh
# AI Director OS 容器啟動（自動接管資料庫版本 v4）。

echo "[start] 啟動腳本 v4 開始執行..."

if [ -z "$DATABASE_URL" ]; then
  echo "[start] ⚠⚠⚠ DATABASE_URL 未設定！"
  exit 78
fi

# 強制接管資料庫，不論結果如何都繼續執行
echo "[start] 執行 db:adopt..."
npm run db:adopt -- --through=bridge --confirm=833ac32b97e77791 || echo "[start] Adopt 指令返回非零，繼續..."

# 套用遷移
echo "[start] 執行 db:migrate..."
npm run db:migrate || echo "[start] Migrate 指令返回非零，嘗試直接啟動..."

# 啟動應用
echo "[start] 啟動 node dist/index.js..."
exec node dist/index.js
