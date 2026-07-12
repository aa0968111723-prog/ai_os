#!/bin/sh
echo "[start] 嘗試推送 Drizzle schema..."
node_modules/.bin/drizzle-kit push --force > /tmp/drizzle.log 2>&1 && echo "[start] ✅ Schema 推送成功" || echo "[start] ⚠️ Schema 推送失敗或略過（可能 DB 尚未就緒），重試部署會自動重試"
cat /tmp/drizzle.log
echo "[start] 啟動應用伺服器..."
node dist/index.js
