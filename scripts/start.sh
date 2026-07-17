#!/bin/sh
# AI Director OS 容器啟動（平台中立，目前用 Zeabur）：建表與種子都在伺服器內自動處理（server/db/ensure.ts），
# 這裡只做開機前的環境自檢，log 全中文——在部署平台（Zeabur 等）的 Deploy Logs 直接可讀。

if [ -z "$DATABASE_URL" ]; then
  echo "[start] ⚠⚠⚠ DATABASE_URL 未設定！"
  echo "[start]     → 到部署平台的服務 Variables 設定 DATABASE_URL（Zeabur：跨服務引用 PostgreSQL 服務的連線字串）"
  echo "[start]     伺服器仍會啟動（健康檢查可過），但登入與所有資料操作都會失敗"
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

exec node dist/index.js
