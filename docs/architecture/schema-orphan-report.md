# Schema orphan report（TD-08）

> 狀態：Implemented  
> 目的：在尚未加破壞性 foreign key 前，先建立**可觀測性**——用計數報告常見「子列指到不存在父列」的狀況。  
> 原則：**軟性、best-effort、不擋 CI、不修資料**。

## 1. 背景

目前多數業務關聯只在應用層維護（Drizzle schema 欄位 + 服務邏輯），DB 尚未全面加 FK。  
Phase 6 的順序是：先拆 schema 模組 → **產生 orphan 報告** → 修復既有資料 → 再逐表加約束。

本腳本只做第 2 步的報告；**不會**刪列、不會 `ALTER TABLE`、不會把 orphan 當建置失敗。

## 2. 如何執行

```bash
# 本機／staging（需可連 Postgres）
export DATABASE_URL='postgres://user:pass@host:5432/dbname'
npm run report:orphans

# 等價
npx tsx scripts/report-schema-orphans.ts
```

### 無資料庫時（CI／本機未設 env）

```bash
unset DATABASE_URL   # 或未 export
npm run report:orphans
# 輸出：skip no DATABASE_URL
# exit code：0
```

因此可安全放進非 DB job，不會因缺連線而紅燈。

## 3. 行為摘要

| 條件 | 行為 | exit |
|---|---|---|
| 未設 `DATABASE_URL` | 印 `skip no DATABASE_URL` | 0 |
| 有 URL，連線失敗 | 印 `FAILED` | 1 |
| 有 URL，表不存在 | 該檢查 `SKIP`（缺表） | 0（整份報告仍成功） |
| 有 URL，單筆 SQL 失敗 | 該檢查 `SKIP`（query failed） | 0 |
| 有 URL，orphan 計數 > 0 | 印 `HIT` + 計數 | **0**（僅報告） |

## 4. 涵蓋的 orphan 模式（摘錄）

實作清單以 `scripts/report-schema-orphans.ts` 的 `CHECKS` 為準。常見項目：

| id | 意義 |
|---|---|
| `assets_missing_project` | `assets.project_id` 在 `projects` 不存在 |
| `assets_missing_group` | `assets.group_id` 在 `groups` 不存在 |
| `cost_ledger_missing_generation` | `cost_ledger.generation_id` 非 null 但 `generations` 無此列 |
| `generations_missing_project` | 生成列掛到已消失專案 |
| `scenes_missing_project` / `scenes_missing_asset` | 分鏡缺專案，或 `asset_id` 懸空 |
| `group_members_missing_*` | 成員列指到已刪組／使用者 |
| `agent_events_missing_run` | 代理事件缺 `agent_runs` |
| `data_rows_missing_table` / `data_files_missing_table` | 列／檔案缺父資料庫 |

不掃 JSONB 內嵌 id、不掃「業務上允許的 null 引用」以外的語意錯誤（例如 status enum 非法值——可另開 invalid-state 報告）。

## 5. 解讀與後續

1. **HIT 計數 = 0**：目前樣本乾淨，可考慮在後續 PR 為該關聯加 FK（仍需 dry-run + 回退）。  
2. **HIT 計數 > 0**：先用 ad-hoc SQL 抽樣確認是否為歷史髒資料或預期「父刪子留」語意；修資料後再加約束。  
3. 修復與加 FK 屬 **TD-08 之後／Phase 6 後段**，不在本腳本範圍。

範例抽樣（staging）：

```sql
-- assets 缺專案
SELECT a.id, a.project_id, a.title, a.created_at
FROM assets a
WHERE NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = a.project_id)
LIMIT 50;

-- cost_ledger 指到已刪 generation
SELECT c.id, c.generation_id, c.delta, c.reason, c.created_at
FROM cost_ledger c
WHERE c.generation_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM generations g WHERE g.id = c.generation_id)
LIMIT 50;
```

## 6. 與相關文件

- 計畫：`docs/architecture/technical-debt-remediation-plan.md`（Phase 6、TD-08）
- Schema 模組：`server/db/schema/*`（匯出相容 `server/db/schema.ts`）
- 遷移工具：`npm run db:check` / `db:migrate`（與 orphan 報告獨立）

## 7. 維護

新增高價值邏輯 FK 時：

1. 在 `CHECKS` 加一筆（`id`、`label`、`tables`、`sql`）。  
2. 更新本文件表格。  
3. 保持「缺表／查詢失敗 → SKIP、報告完成 → exit 0」。
