# 匯入規格（給終端機 / 管理員）

## 目標儲存（必須系統層）

1. **全站資料庫** `scope=site`（若尚未建立，先建表 `公共Agent素材庫`）
2. 或 **系統 knowledge 表**（無 projectId / projectId=null）
3. 或 **內建 prompt catalog** 供助手與 MCP 讀取

## 建議表結構（全站）

| 欄位 | 類型 | 說明 |
|------|------|------|
| key | text unique | 冪等鍵，如 `public.prompt.style.handdrawn` |
| category | text | knowledge / prompt / character / scene / prop / qc |
| title | text | 顯示標題 |
| content | text | 正文或 JSON |
| tags | text[] | 可搜尋標籤 |
| updated_at | timestamptz | |

## CLI 行為

```bash
npx tsx scripts/import-public-agent-fuel.ts --dry-run
npx tsx scripts/import-public-agent-fuel.ts --apply
```

- `--dry-run`：只列將寫入的 key
- `--apply`：寫入系統層；已存在 key 則更新 content
- **不可** 接受 `--projectId` 指向一般使用者專案

## 驗收

- [ ] 匯入後使用者專案 storage 無新增
- [ ] MCP `list_databases` 可見全站表或系統表
- [ ] 助手在無專案上下文也能讀到公共配方
- [ ] 重複執行匯入不產生重複列
