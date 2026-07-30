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
  # 只有在 migrate 失敗、且營運者明確於平台 Variables 授權時，才走 legacy 納管。
  # 平台上沒有 one-off job，也無法對崩潰重試中的容器開 shell，所以既有 runbook 的
  # 「dry-run 檢視 → 帶 fingerprint 確認」兩步驟改由兩個變數表達，確認關卡原封不動：
  #   1. 只設 DB_ADOPT_LEGACY_THROUGH → 只跑 dry-run，印出 state、drift 與該用的 fingerprint
  #   2. 再把該 fingerprint 設進 DB_ADOPT_LEGACY_CONFIRM → 才真正寫入 ledger
  # 納管只寫 migration ledger，不對 public 資料表執行任何 DDL；bridge 會逐條核對 live schema
  # 必須與已審核的版本完全相符，任何非預期差異一律拒絕。
  # 因為這段只在 migrate 失敗時才進來，納管完成後變數留著也不會再觸發——但仍建議移除。
  if [ -z "$DB_ADOPT_LEGACY_THROUGH" ]; then
    echo "[start] ⚠ migration 未完成；為避免新程式搭配舊 schema，本服務拒絕啟動"
    echo "[start]   常見原因與對應處理（詳見 docs/資料庫遷移.md）："
    echo "[start]   1) state=legacy-untracked：既有 DB 還沒納管——先備份，再設 DB_ADOPT_LEGACY_THROUGH=0001_managed_indexes 重新部署"
    echo "[start]   2) Failed query 是 CREATE UNIQUE INDEX：該表有重複列——migration 必須先去重再建索引（0001 / 0005 已含確定性 DELETE）"
    echo "[start]   3) state=invalid +「資料庫含本版程式不認識的 migration：created_at=…」："
    echo "[start]      → 版本錯位：DB ledger 已有較新 migration 紀錄，但目前映像的 journal 還不認識它們。"
    echo "[start]      → 優先解法：部署包含那些 migration 檔案的最新映像（讓 journal 與 ledger 對齊）。"
    echo "[start]      → 若必須留在本映像：先 pg_dump 備份，再手動刪除 ledger 中不認識的 created_at 列後重試。"
    echo "[start]      → 本程序不會自行猜測修復 invalid ledger。"
    exit 78
  fi

  if [ -z "$DB_ADOPT_LEGACY_CONFIRM" ]; then
    echo "[start] DB_ADOPT_LEGACY_THROUGH 已設；先執行 dry-run（不寫入任何東西）…"
    npm run db:adopt -- --dry-run --through="$DB_ADOPT_LEGACY_THROUGH" || true
    echo "[start] ⚠ 以上為 dry-run，資料庫未被更動。請先備份，確認上方 state 與 drift 無誤後，"
    echo "[start]   把 log 中 --confirm= 後面那組 fingerprint 設進 DB_ADOPT_LEGACY_CONFIRM 再重新部署"
    echo "[start]   注意：若 state 已是 invalid（有不認識的 created_at），adopt 不會執行；請先處理版本錯位。"
    exit 78
  fi

  echo "[start] 執行已確認的 legacy 納管（只寫 migration ledger，不動 public 資料表）…"
  if ! npm run db:adopt -- --through="$DB_ADOPT_LEGACY_THROUGH" --confirm="$DB_ADOPT_LEGACY_CONFIRM"; then
    echo "[start] ⚠ 納管未通過驗證，沒有寫入任何 ledger；服務拒絕啟動"
    echo "[start]   fingerprint 不符請重跑 dry-run 取得最新值；state 不是 legacy-untracked 表示不該用納管"
    echo "[start]   若 state=invalid，請改走「部署對齊映像」或「備份後清理未知 ledger 列」路徑"
    exit 78
  fi

  echo "[start] 納管完成，重新套用 pending migrations…"
  if ! npm run db:migrate; then
    echo "[start] ⚠ 納管後 migration 仍未完成；服務拒絕啟動"
    exit 78
  fi
  echo "[start] 納管流程結束——請到平台 Variables 移除 DB_ADOPT_LEGACY_THROUGH 與 DB_ADOPT_LEGACY_CONFIRM"
fi

echo "[start] 唯讀檢查 migration ledger 與 schema drift…"
if ! npm run db:check; then
  echo "[start] ⚠ migration 後資料庫仍未達可啟動狀態；服務拒絕啟動"
  exit 78
fi

exec node dist/index.js
