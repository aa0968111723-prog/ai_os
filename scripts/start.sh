#!/bin/sh
# AI Director OS 啟動修復腳本 v5
echo "----------------------------------------"
echo "[MANUS] 啟動腳本 v5 執行中..."
echo "[MANUS] 時間: $(date)"

# 強制接管資料庫
echo "[MANUS] 執行 db:adopt --through=bridge..."
npm run db:adopt -- --through=bridge --confirm=833ac32b97e77791 || echo "[MANUS] Adopt 警告: 繼續執行..."

# 執行遷移
echo "[MANUS] 執行 db:migrate..."
npm run db:migrate || echo "[MANUS] Migrate 警告: 繼續啟動..."

# 啟動應用
echo "[MANUS] 啟動應用程式..."
echo "----------------------------------------"
exec node dist/index.js
