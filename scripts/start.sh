#!/bin/sh
# AI Director OS 容器啟動（平台中立，目前用 Zeabur）。
# 正式啟動先套用已提交、已審核的版本化 migration，再以唯讀 drift gate 驗證。
# migration runner 具 PostgreSQL advisory lock；未知舊庫、ledger 異常或 drift 一律拒絕啟動。
#
# 這兩道閘門刻意讓失敗變成「服務不啟動」而不是「服務帶病啟動」：新程式配舊 schema
# 會安靜地寫壞資料，比服務起不來難發現得多。要診斷失敗原因請看下方 [db] 開頭的輸出，
# 它會印出 ledger 狀態（empty-unmigrated / legacy-untracked / pending / ready / invalid）。

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

echo "[start] 套用已版本化的 pending migrations…"
if ! npm run db:migrate; then
  echo "[start] ⚠ migration 未完成；為避免新程式搭配舊 schema，本服務拒絕啟動"
  echo "[start]   state=legacy-untracked：既有 DB 還沒納管——先備份，再依 runbook 執行 db:adopt"
  echo "[start]   Failed query 是 CREATE UNIQUE INDEX：該表有重複列，migration 必須先去重再建索引"
  echo "[start]   state=invalid：ledger 與檔案不符，需人工處理，本程序不會自行猜測修復"
  exit 78
fi

echo "[start] 唯讀檢查 migration ledger 與 schema drift…"
if ! npm run db:check; then
  echo "[start] ⚠ migration 後資料庫仍未達可啟動狀態；服務拒絕啟動"
  exit 78
fi

exec node dist/index.js
