#!/bin/sh
# AI Director OS 容器啟動（Railway）：建表與種子都在伺服器內自動處理（server/db/ensure.ts），
# 這裡只做開機前的環境自檢，log 全中文——在 Railway 的 Deploy Logs 直接可讀。

if [ -z "$DATABASE_URL" ]; then
  echo "[start] ⚠⚠⚠ DATABASE_URL 未設定！"
  echo "[start]     → 到 Railway App 服務的 Variables 按「Add Reference」引用 Postgres 的 DATABASE_URL"
  echo "[start]     伺服器仍會啟動（健康檢查可過），但登入與所有資料操作都會失敗"
else
  echo "[start] DATABASE_URL 已設定（$(echo "$DATABASE_URL" | sed 's#^.*@#***@#')）"
fi
if [ -z "$FAL_KEY" ] || [ "$FAL_MOCK" = "1" ]; then
  echo "[start] Fal：假生成模式（不花錢）——要真實生成請設 FAL_KEY 並移除 FAL_MOCK"
else
  echo "[start] Fal：真實生成模式"
fi

exec node dist/index.js
