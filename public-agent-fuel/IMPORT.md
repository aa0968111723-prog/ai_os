# 終端機匯入說明

## 目標
將本目錄內容匯入 **系統共享 / 全站** 空間，**不佔用使用者專案空間**。

## 建議步驟

```bash
# 1. 拉取分支
git fetch origin
git checkout feat/public-agent-fuel-system-import

# 2. （示例）使用管理員腳本匯入到系統資料庫
# 實際命令依你們的 import pipeline 調整
npx tsx scripts/import-public-fuel.ts --source ./public-agent-fuel --scope system

# 或
./public-agent-fuel/scripts/import-to-system.sh
```

## 重要約束

- `--scope system` 或相等參數：必須寫入全站/系統層
- 絕不傳入 `projectId` 屬於使用者的專案
- 匯入後驗證 MCP `list_databases` 與 `list_knowledge` 在系統範圍可見

## 內容清單

請參見 `knowledge/`、`prompts/` 目錄。
