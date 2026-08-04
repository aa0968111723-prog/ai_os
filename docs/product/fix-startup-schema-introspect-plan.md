# 修復計畫：Zeabur 開機 CrashLoop（schema introspect / DrizzleQueryError）

> 狀態：**待終端機實作**（本 PR 僅計畫）  
> 分支：`plan/fix-startup-schema-introspect` → base `claude/healing-migration-ai-os-erewp2`  
> 症狀來源：2026-08-04 Zeabur Runtime log（Deployment 已移驗，分支 healing-migration…）

---

## 1. 症狀（使用者截圖）

```text
[db] no pending migrations; applied=36; pending=0; public_tables=71
[db] state=ready; applied=36; pending=0; public_tables=71
[i] Pulling schema from database...
ERROR  DrizzleQueryError: Failed query: SELECT conname AS primary_key …
[start] ⚠ migration 未完成；為避免新程式搭配舊 schema，本服務拒絕啟動
… Unhealthy: Startup probe failed → Back-off restarting
```

- 容器**有**跑到 `start.sh`（不是空 runtime log / 不是 build 失敗）。
- `db:migrate` **ledger 已 ready**（36 筆 = journal idx 0–35，含 `0035_community_likes`）。
- 失敗點在 **migrate 成功後的 schema drift 檢查**，不是「還有 pending migration」。
- start.sh 印的 1) legacy-untracked / 2) UNIQUE INDEX / 3) state=invalid 是**通用提示**，**不是**這次的主因。

---

## 2. 失敗路徑（程式對照）

```
scripts/start.sh
  → npm run db:migrate          # scripts/db/migrate.ts
       loadMigrationManifest()
       inspectMigrationState()  → kind=ready, applied=36  ✅
       drizzle migrator         → no pending             ✅
       inspectSchemaDrift(db)   → pushSchema(schema, db) ❌ 拋例外
  → exit 78 → CrashLoop
```

關鍵程式：

| 檔案 | 角色 |
|------|------|
| `scripts/db/migrate.ts` | migrate 後**強制** `inspectSchemaDrift`；有 statement **或拋錯**都讓 migrate 失敗 |
| `scripts/db/check.ts` | start 第二關，同樣呼叫 `inspectSchemaDrift` |
| `server/db/migrationState.ts` → `inspectSchemaDrift` | `import("drizzle-kit/api").pushSchema(schema, database)` |
| `drizzle-kit` ^0.31.4 | 內部 introspect 發出 `SELECT conname AS primary_key …` |

`ensure.ts` 的 runtime gate 也走同一套，但目前正式路徑是 start.sh 的 migrate+check 先掛。

---

## 3. 根因假設（依優先序排查）

### H1 — drizzle-kit introspect 對這顆 Postgres / 某張表拋錯（最可能）

`pushSchema` 在「Pulling schema」階段就炸，**還沒**產出 drift statements。  
常見觸發：

- 某張 public 表的 constraint / 主鍵定義異常（無 PK、重複 constraint 名、壞掉的 index）
- PG 版本與 drizzle-kit 0.31 的 catalog SQL 不相容
- 權限不足以讀 `pg_constraint` / `pg_class`（較少見，通常連 migrate 也會掛）

### H2 — schema.ts 與 live DB 嚴重不一致，introspect 路徑踩到 bug

ledger ready 只代表「migration 檔 hash 對齊」，**不保證** `server/db/schema/*` 與 live 一致。  
若缺表定義或多餘定義，理論上應回 statements，但少數 drizzle-kit bug 會直接 throw。

### H3 — 次要：log 被通用錯誤訊息誤導

`start.sh` 在 `db:migrate` 非零時**一律**印三種常見原因，容易誤判成 invalid ledger。  
修復時可一併改善錯誤輸出（見 §6）。

---

## 4. 診斷步驟（終端機先做，再改 code）

### 4.1 取得完整錯誤

從 Zeabur Runtime log 複製 **整段** `DrizzleQueryError`（含 `Failed query:` 完整 SQL、`params:`、stack）。  
若只有一行摘要，在 one-off 對同一 `DATABASE_URL` 跑：

```bash
npm run db:check
# 或
npm run db:migrate:dry-run
```

### 4.2 確認 ledger

```sql
SELECT id, hash, created_at
FROM drizzle.__drizzle_migrations
ORDER BY created_at, id;
```

預期：36 列；`created_at` 必須能對上目前映像 `drizzle/meta/_journal.json` 的 `when`（見 journal idx 0–35）。  
若多出 journal 沒有的 `created_at` → 才是真正的 `state=invalid`（另走 docs/資料庫遷移.md §七）。

### 4.3 主鍵 / constraint 健康檢查

```sql
-- 沒有 primary key 的 user table（可能讓 introspect 異常）
SELECT c.relname AS table_name
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
  AND NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    WHERE con.conrelid = c.oid AND con.contype = 'p'
  )
ORDER BY 1;

-- 重複 constraint 名稱
SELECT conname, count(*)
FROM pg_constraint
GROUP BY conname
HAVING count(*) > 1;

-- 列出 public 主鍵
SELECT c.relname, con.conname
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND con.contype = 'p'
ORDER BY 1;
```

### 4.4 本機複現 introspect

連同一 DB（或 staging 還原）：

```bash
npm run db:check
```

若可加一段暫時 debug（**不要合進 main 除非有用**）：在 `inspectSchemaDrift` 外層 log `error.cause` / 完整 query。

---

## 5. 修復策略

### 5.A 資料面（若 4.3 找到壞表）

- **缺 PK 的表**：若屬本專案 migration 建立的表，新增 forward migration 補 PK（`ALTER TABLE … ADD PRIMARY KEY`），**禁止**改已發布的舊 migration 檔。
- **髒 constraint**：在備份後以受審 SQL 清理；寫進 runbook，不要在 start.sh 自動修。

### 5.B 程式面（introspect 拋錯時的行為）

目前：`inspectSchemaDrift` 直接 throw → migrate 失敗 → 通用訊息誤導。

建議改動（擇一或組合）：

1. **`inspectSchemaDrift` 包 try/catch**  
   - 捕獲後回傳明確錯誤：`SchemaDriftInspectError`，訊息含完整 Failed query。  
   - `migrate.ts` / `check.ts` / `start.sh` 辨識此錯誤，**不要**再印 legacy-untracked / invalid 通用三條（或標成「若錯誤是…才看」）。

2. **對齊 schema.ts 與 0034/0035**  
   確認：
   - `server/db/schema/projects.ts` 有 `noteComments`（0034）
   - `server/db/schema/community.ts` 有 likes 相關定義（0035）
   - `schema/index.ts` 有 export  
   缺定義會造成 drift statements；通常不該讓 introspect throw，但應一併對齊避免下一關失敗。

3. **drizzle-kit 版本**  
   若確認是 kit bug：查 0.31.x changelog / 升 patch；升版需跑 `db:check` + migration 測試，不可只為過閘盲目大升。

4. **切勿**為了開機成功而：
   - 在 start 呼叫 `pushSchema.apply()`
   - 跳過 drift 檢查（除非 feature flag 且僅限緊急 hotfix，並開後續必修 ticket）

### 5.C start.sh 錯誤訊息（小改，建議同 PR）

當 migrate log 已出現 `DrizzleQueryError` / `Pulling schema` 時，優先提示：

```text
[start] schema introspect 失敗（drizzle-kit pushSchema），不是 pending migration。
[start] 請貼完整 Failed query，並查 docs/product/fix-startup-schema-introspect-plan.md
```

---

## 6. 建議實作順序（終端 checklist）

```
[ ] 1. 收集完整 DrizzleQueryError + 跑 §4 SQL
[ ] 2. 若有缺 PK / 髒 constraint → forward migration + 備份後套用
[ ] 3. 核對 schema noteComments / community_likes 與 journal 0034/0035
[ ] 4. 改進 inspectSchemaDrift / migrate.ts / start.sh 錯誤輸出（可測）
[ ] 5. 本機或 staging：npm run db:migrate && npm run db:check 全綠
[ ] 6. 部署 healing 分支 → Runtime 出現 [db] APPLIED 與 server 監聽 log
[ ] 7. 開實作 PR（feat/fix-startup-schema-introspect），本 plan PR 可關閉或合併文件
```

---

## 7. 驗收

- [ ] Zeabur Runtime：**無** CrashLoop；有 `[db] APPLIED` 或 `OK: migration history…`
- [ ] `npm run db:check` exit 0
- [ ] 若 introspect 再失敗：log 清楚寫「schema introspect」，不再只顯示 state=invalid 三條
- [ ] 無自動 DDL / 無跳過 drift 的隱藏後門（除非有註明的緊急 flag 且預設關）

---

## 8. 與其他計畫的關係

| PR / 文件 | 關係 |
|-----------|------|
| #396 BYOK Phase 2 計畫 | **無關**；服務先要能開機 |
| `docs/資料庫遷移.md` §七 invalid ledger | 僅當 ledger 真的有未知 `created_at` 時適用；**本次 log 顯示 ready** |
| `patches/byok-phase2-decideCost.patch` | 無關 |

---

## 9. 回滾

- 僅文件：關閉本 PR 即可。
- 實作若引入「跳過 drift」flag：預設必須 off；出事關 flag 即回嚴格模式。
- 資料修復 migration：依 `docs/資料庫遷移.md` 備份與 forward-fix，禁止改寫已套用 SQL 檔。
