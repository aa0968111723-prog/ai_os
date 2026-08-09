# 資料中心（Unified Data Hub）— Current State Audit 2026-08

> 本文是「資料中心」重構的 **P0 契約文件**。
> 它記錄的是 **重構開始當下 repo 真實的實作**（HEAD `ff1dbac`），
> 不是願景、不是規劃、也不是舊 PR 的殘留描述。
>
> 後續任何 Data Hub 改動，都必須先確認沒有違反本文第 14 節的四條不變量。

---

## 1. 現有資料 domain（底層真相表）

站內「使用者的資料」其實散在四個彼此獨立的 domain，各有各的擁有者、生命週期與權限模型：

| Domain | 主表 | 擁有者維度 | 軟刪除 | AI 讀取路徑 |
| --- | --- | --- | --- | --- |
| 結構化資料表 | `data_tables` / `data_rows` | scope：personal / group / team / global | `data_tables.deleted_at` | MCP 三工具 + 團隊助手；受 `agent_access` 節制 |
| 資料表文件 | `data_files`（掛 `table_id`） | 隨所屬 `data_tables` | 無（硬刪） | MCP `read_database_file`；受所屬表 `agent_access` 節制 |
| 專案知識庫 | `knowledge`（掛 `project_id` + `group_id`） | 組 | `knowledge.deleted_at` | `buildKnowledgeContext()` 直接注入 LLM |
| 專案素材庫 | `assets`（掛 `project_id` + `group_id`） | 組 | `assets.deleted_at` | 生成來源；圖片可經 `describeImageAsset` 產生 AI 可讀描述 |

外部來源憑證另存於 integrations domain：

| 表 | 用途 |
| --- | --- |
| `user_integrations` | 每人自己的 `google-drive`（OAuth refresh token）／`notion`（integration token）／`api`（自訂連線） |
| `external_accounts` | Adobe 之類的雙 token OAuth 帳號連結 |
| `user_ai_provider_keys` | BYOK（目前只有 fal） |
| `google_calendar_connections` | 日曆同步（與 Drive 是**獨立**連線、獨立 scope） |

**關鍵事實：外部來源憑證不是資料。** `user_integrations` 裡有一列，只代表「這個人可以去自己的
Google/Notion 挑東西」，跟「站內有什麼內容」「AI 讀得到什麼」完全無關。

---

## 2. 現有 routes（tRPC）

| Router | 主要 procedure |
| --- | --- |
| `databases` | `list` `get` `create` `update` `remove` `listRows` `addRow` `updateRow` `removeRow` `importData` `linkedToProject` `createBoundToProject` `listFiles` `getFileText` `importUrl` `importDriveFile` `refreshFile` `removeFile` `setFileMeta` `classifyFile` `stats` `sendFileToProject` |
| `knowledge` | `list` `get` `add` `update` `remove` `restore` `purge` `listVersions` `restoreVersion` `injectPreview` `importDriveFile` `addFromAsset` `describeImageAsset` |
| `integrations` | `list` `setNotion` `addApi` `fetchApi` `remove` `listDriveFiles` `listNotionPages` `removeGoogleDrive` `removeNotion` |
| `projects` | `assets`（素材清單）等 |

新增的 `dataHub` router 是 **facade**：它只組裝以上既有 service 的結果，
不重寫任何 ACL、匯入、憑證或注入邏輯。

Express（非 tRPC，瀏覽器重導）：

- `GET /api/integrations/google-drive/start`
- `GET /api/integrations/google-drive/callback`

---

## 3. Schema 摘要（與本次相關的欄位）

```
data_tables(id, scope, owner_id, group_id, team_id, name, description,
            fields jsonb, member_writable, agent_access, created_by, deleted_at, ...)
data_files(id, table_id, name, mime, size_bytes, storage_path, source_url,
           text_content, category, ai_description, uploaded_by, created_at)
data_rows(id, table_id, data jsonb, created_by, updated_by, ...)

knowledge(id, project_id, group_id, kind, title, content, summary,
          source_asset_id, pinned, created_by, deleted_at, created_at)

assets(id, project_id, group_id, kind, title, url, tags, is_ai_generated,
       storage_path, mime, size_bytes, uploaded_by, locked, deleted_at, ...)

user_integrations(id, user_id, kind, name, secret_enc, base_url, auth_header,
                  meta, status, last_error, last_used_at, created_at)
```

**本次重構沒有新增、修改或刪除任何資料表欄位。** 見第 15 節。

---

## 4. ACL（權限）現況

### 4.1 結構化資料表 — `server/services/databaseAcl.ts`

單一真相，tRPC 與 MCP 共用：

- `personal`：**只有擁有者本人**。超級管理員也看不到。
- `group`：組成員可讀；寫列＝`memberWritable` 或組長以上或建立者。
- `team`：團隊任一組成員可讀；管理＝團隊管理員或建立者。
- `global`：全站登入者可讀；管理限超級管理員。

`resolveAgentAccess()` 在人的權限上**再疊一層** `agent_access`（none/read/write），
只會更嚴、不會放寬，且 `canManage` 一律 false。

### 4.2 知識庫 / 素材庫 — 組隔離

`knowledge` 與 `assets` 都掛 `group_id`，讀寫一律先 `requireGroup(auth, groupId)`；
寫入另需 `assertProjectEditable()`（2.3 檢視者不可寫）。

**沒有 per-resource 的 AI 開關**——知識庫的東西一旦在專案裡，就會被
`buildKnowledgeContext()` 注入該專案的 AI。這是本次「AI 權限模型不統一」的根源。

### 4.3 外部來源

`user_integrations` 只查 `user_id = 自己`，憑證原文永不回前端。

---

## 5. AI context flow

```
專案 AI（assistant / director / agentCore）
  └─ buildKnowledgeContext(projectId, { budgetChars, mode, preferIds, includeCards })
       ├─ knowledge（isNull(deleted_at)，pinned 優先）
       ├─ 角色定裝卡 / 場景設定卡 / 素材設定卡（cardAnchors）
       └─ 預算：KNOWLEDGE_INJECT_BUDGET_DEFAULT，超過即截斷並回報 truncated

團隊助手 / MCP 代理
  └─ resolveAgentAccess(auth, table)   ← databaseAcl，逐表把關
       ├─ list_databases / query_database / read_database_file
       └─ agent_access = none 的表，連清單都不出現
```

`KnowledgeContextMeta` 已誠實回報 `totalContentChars / includedChars / truncated`，
**不可為了 source selector 而改成 silent truncate**。

---

## 6. Google Drive flow（現況）

```
/api/integrations/google-drive/start
  → buildDriveAuthUrl(userId)   state = HMAC(userId|expiresAt)
  → Google consent（scope: drive.readonly）
  → /api/integrations/google-drive/callback
  → verifyIntegrationState() 且 state.userId === 登入者
  → saveGoogleDrive(userId, refreshToken, email)
  → redirect("/integrations?gdrive=connected")     ← 問題點
```

之後：

- `integrations.listDriveFiles`（限流、只回 metadata、記審計）
- `databases.importDriveFile` → `driveImportCore.importDrivePickedFileToTable`
- `knowledge.importDriveFile` → `fetchDrivePickedFile` → 抽文字入知識庫

**問題點**：callback 永遠落在 `/integrations`。使用者從「專案 → 加入資料 → Google」
出發，授權完成後被丟到一個跟他原本意圖無關的設定頁，必須自己走回去。
這正是 Golden Path 1 斷掉的地方。

## 7. Notion flow（現況）

`integrations.setNotion`（個人 token，先驗證再收）→ `integrations.listNotionPages`
（只回 metadata）→ 選中後由 `databases.importUrl` 以 `notion.so/<id>` 走官方 API 抽文字。

**沒有** `knowledge.importNotionPage`——Notion 只能進資料表文件區，不能直接進專案知識庫。

## 8. Data Table flow

建表（自訂欄位）→ 列資料 CRUD → CSV/TSV/JSON 批次匯入（冪等鍵）→ 文件層上傳／網址匯入。
專案關聯**僅靠** `project` 型別欄位：`databases.linkedToProject` 掃「可見表中 project 欄
值等於此 projectId」的列。整張表無法「整份提供給某專案」。

## 9. Project Knowledge flow

貼上文字 / 上傳 txt-md / Drive 選檔轉存 / 由素材轉知識 → `knowledge` 表 → 自動注入專案 AI。
`kind` 四選一（transcript / testimony / script / note），`pinned` 提高注入優先序。

## 10. Asset flow

`/api/upload` 或生成產出 → `assets` → 可 `describeImageAsset` 產生 AI 可讀描述，
或 `knowledge.addFromAsset` 轉成知識。`databases.sendFileToProject` 可把資料表文件
**實體複製**一份進素材庫（兩邊生命週期獨立）。

## 11. MCP / Agent relationship

MCP 對外工具契約由 `server/services/databaseMcp.ts` + `mcpCatalog` 定義，
權限一律走 `resolveAgentAccess`。**本次不改任何 MCP 工具名稱、參數或行為。**

## 12. Mobile navigation 現況

- 底部分頁列：今日 / 專案 / AI 工作 / 筆記排程
- 「更多」面板：工作（動畫創作室・靈感頻道・私訊）／說明／下載
- `databases`、`integrations`、`mcp` **不在**手機「更多」面板（見 `navigationItems.ts` 註解），
  只在桌機使用者選單。路由與深連結全部保留。

## 13. 已知 UX 破碎點（本次要解的）

1. **同一件事三個名字**：`/databases` 頁內自稱「資料庫」，導覽叫「資料庫」，
   其他頁面連結文字叫「知識與資料」，doc 叫「資料中心」。
2. **首屏是工程 KPI**：「10 資料庫 / 64 資料列 / 10 AI 可使用」——
   一般創作者不知道「資料列」是什麼，也不在乎。
3. **沒有全站「＋加入資料」**：加資料的入口分散在資料表詳頁、知識庫卡、素材庫卡、整合頁。
4. **OAuth 斷點**：連完 Google 掉到 `/integrations`，原本的意圖遺失。
5. **連接 ≠ 匯入 ≠ 綁專案 ≠ AI 可讀** 這四件事在 UI 上長得太像，使用者以為連了就好了。
6. **AI 權限文案是工程語言**：「AI 可查可寫」「agentAccess」對創作者沒有意義。
7. **專案關聯只有 project link field 一條路**，而且這條規則不容易被發現。
8. **手機來源卡片是水平大卡**，390px 會被裁切。

## 14. ★ 四條不變量（Invariants）— 永遠不可被 UI 或 backend 混為一談

> 這四條是本次重構的安全底線。任何一條被打破，就是資料外洩或權限放寬。

### I1. Connection ≠ Imported

`user_integrations` 有一列，只代表「這個人可以去自己的 Google/Notion 挑東西」。
它**不代表**站內有任何內容，也**不代表** AI 可以搜尋整顆 Drive。
`listDriveFiles` / `listNotionPages` 只回 **metadata**，且必須由使用者明確勾選才會抓內容。

### I2. Imported ≠ Project Bound

內容進了站（`data_files` / `data_tables` / `knowledge` / `assets`），
不代表某個專案就能用它。專案能不能用，看的是：
`knowledge.project_id` / `assets.project_id` / `data_rows` 的 project link field。

### I3. Project Bound ≠ AI Readable

資料綁在專案上，不代表 AI 讀得到。結構化表另受 `agent_access` 節制
（`none` 時連 MCP 清單都不出現）；文件沒有可讀文字時 AI 也讀不到。

### I4. AI Readable ≠ AI Writable

AI 讀得到不代表能寫。寫入必須同時滿足
`agent_access = 'write'` **且** 操作者本人 `canWriteRows`。
`resolveAgentAccess()` 的 `canManage` 恆為 false——結構調整永遠只留給網頁端的人。

**推論（同樣不可違反）**：

- 聚合搜尋不得因為「只回標題」就放寬 ACL——**標題本身就是敏感 metadata**。
- `personal` scope 的資料表永遠不得進入任何共享 AI context（團隊助手 / 組 AI / MCP 團隊路徑）。
- 中斷來源連線只刪憑證，**不刪**已匯入站內的內容。

## 15. Migration 風險與本次策略

此 repo 的 migration 有 hash / revision / legacy adoption bridge / drift check
（`scripts/db/check.ts`、`scripts/db/migrate.ts`、`scripts/db/adopt.ts`）。
偷改已發布 migration 會造成 production history mismatch。

**本次策略：P0–P3 零 schema migration。**
`dataHub` 是純 facade——它只 SELECT 既有表。
未來若要做 `project_data_bindings`（整份 resource 綁專案），必須：

1. additive-only（新表，不動舊表）；
2. dual read（新表 + 既有 project link field 同時支援）；
3. 第一支 migration 不刪 legacy；
4. 跑 migration safety tests。

## 16. 相容性需求（本次必須保住）

- 既有 URL：`/databases`、`/integrations`、`/p/:id#sec-knowledge` 等深連結全部保留。
- tRPC procedure 名稱：**一個都不改**（只新增 `dataHub.*`）。
- MCP 工具契約：不動。
- `buildKnowledgeContext` 的預算 / 優先序 / 截斷回報：不動。
- Google / Notion OAuth 與加密：不動（只在 state 裡**加簽**一個 returnTo，見下）。
- `databaseAcl` / `projectAcl`：不動，facade 一律呼叫它們。

---

## 17. 本次（P0–P3）交付範圍

| Phase | 內容 | 狀態 |
| --- | --- | --- |
| P0 | 本文件 + 四條不變量 | 完成 |
| P1 | `/databases` 收斂為「資料中心」；導覽命名統一；KPI 人話化 | 完成 |
| P2 | 全站統一「＋加入資料」（AddDataSheet）；OAuth 回到原本 flow | 完成 |
| P3 | `dataHub` facade（summary / list / search / sources）＋統一搜尋 | 完成 |
| P4 | `project_data_bindings`：整份資源提供給專案（additive migration + dual read） | 完成 |
| P5 | AI source awareness：本次依據 + 「只用這幾份」限制 | 完成 |
| P6 | 來源譜系（provider / external id / modified / last synced）與誠實顯示 | 完成 |

## 18. P4–P6 補充契約（2026-08 第二批）

### 18.1 migration 0052（唯一一支）

`drizzle/0052_data_hub_bindings_and_lineage.sql`：純新增，12 句全部 `IF NOT EXISTS`。
新表 `project_data_bindings` 的欄位全部寫在 `CREATE TABLE` 裡（legacy bridge 比對整表 DDL）；
`data_files` 四個、`knowledge` 五個 nullable 來源欄位。

> 這支原本編為 0051，與 base branch 併入的 `0051_collab_revisions` 撞號後改編 0052。
> 改的是**自己這支尚未合併、還沒被任何資料庫套用過**的 migration，不是別人已發布的那一支
> ——後者無論如何都不能動。檔案內容一個位元組都沒改，所以 sha256 與改號前相同。

同步更新的三處（少一處就會紅）：
`drizzle/meta/_journal.json`（idx 52、when 嚴格遞增）、
`server/db/migrationRevisions.ts`（檔案 sha256）、
`server/db/migrationState.test.ts` 的 `alreadyPresent` 計數（逐句複核後 +12，
與 base 的 0051 各佔一項：`8 + 33 + 17 + 3 + 7 + 12`）。

`data_files` 與 `knowledge` 都建在 `0000` baseline（bridge 前綴）裡，不是 post-bridge
建立的表，所以不適用 0025／0049 那條「新欄要一併補寫回原 `CREATE TABLE`」的規則。
**未動** `LEGACY_ADOPTION_PENDING_TAGS`（前綴檢查，尾端新增不影響）。

已在真實 PostgreSQL 跑過完整 `scripts/ci-migration-test.sh`，且 `db:check` 回報
`schema drift: none`——手寫 SQL 與 Drizzle 定義完全一致。

**警告：`npm run db:generate` 在此 repo 不可用。** snapshot 只到 0016，
它會把 0017 之後全部重新產生一支巨大 migration。所有 migration 都是手寫的。

### 18.2 綁定的第五條規則（延伸 §14）

> **Project Bound ≠ Visible**

綁定只回答「這份資源算不算這個專案的」。「這個人看不看得到」永遠仍由 `databaseAcl`
逐表重新解析。任何讀取端都必須先 `listVisibleTables(auth)` 再與綁定取交集——
**絕不可** `SELECT ... WHERE tableId IN (bound)`，那會同時繞過 ACL 與軟刪除過濾。

且 **personal 範圍的表永遠不可綁**（`services/projectDataBindings.bindableDenyReason`）。
`resolveTableAccess(auth, personalTable).canRead` 對擁有者是 true，所以單純的
「可讀就可綁」會讓個人私有清單經專案助手外洩給整組人。那個 `case "personal"`
不可以被「簡化」掉，`projectDataBindings.test.ts` 已釘死。

### 18.3 dual read 清單（新增讀取端必須全部照顧）

| 位置 | 作用 |
| --- | --- |
| `server/routers/databases.ts` `linkedToProject` | 專案卡；綁定表標 `boundWhole`，預覽列一次批次查 |
| `server/services/dataHub.ts` `projectLinkedTableIds` | 資料中心的專案過濾 |
| `server/services/databaseMcp.ts` `listMcpDatabases` | MCP `linkedOnly`；附 `boundToProject`，不灌進 `linkedRowCount` |
| `client/.../ProjectDatabasesCard.tsx` | AI 狀態文案要計入 `boundAiReadableTableCount` |

### 18.4 來源譜系的誠實規則（P6）

- 有記錄用記錄，沒記錄（舊列）才從網址推斷；推斷值不得蓋掉匯入當下的事實。
- 措辭是「最後讀取」不是「最後同步」——站內**沒有背景同步**，這一版也不做。
- 「來源有更新」只在來源修改時刻與本站讀取時刻**都有記錄**時才顯示。判斷不出來一律不顯示。
- `source_provider` 不在白名單內視同沒記錄（髒資料不當來源顯示）。

### 18.5 AI source awareness 的邊界（P5）

- `onlyIds` 是**限制**不是排序：沒選的即使預算還有剩也不進。
- 刻意**不**學 `script_only` 在找不到時退回全部——使用者說「只用這幾份」，
  退回全部等於偷偷用了他沒選的資料。
- 限制**不放寬預算**：選中的一樣會被 hard limit 截斷，且 `truncated` 誠實回報到 UI。

## 19. 仍未做（下一階段）

- **背景同步**：目前只有「使用者按重新整理」。自動同步必須先解決
  source of truth／本地修改／衝突／同步方向四件事（§32），不可為了畫面做假同步。
- **AI 智慧整理**（原 P6 的 smart organization）：分類建議需要真的分析，
  目前不做——寧可沒有，也不 hardcode 假的分析結果（§31）。
- **綁定其他資源種類**：`resource_kind` 欄位已留 text，目前只寫入 `table`
  （knowledge／asset 本來就有 `project_id`，document 權限跟隨所屬表）。

---

## 20. Folder Import 2.0 / Library Resource / Context Engine（2026-08 第三批）

> 本節記錄的是**在既有 Intelligence Library 1.0 之上**繼續完成的部分。
> 沒有重做 classification / embedding / hybrid search / review queue / face cluster /
> people / dedupe / entity graph / processing queue——全部延伸既有實作。

### 20.1 migration 0059（唯一一支）

`drizzle/0059_library_folder_import_and_context.sql`：純新增，22 句全部 `IF NOT EXISTS`
（6 張新表 + 16 個索引）。沒有任何 `ALTER` 既有欄位、沒有 `UPDATE`／`DELETE`、沒有資料搬移。

同步更新的三處（少一處就會紅）：`drizzle/meta/_journal.json`（idx 59）、
`server/db/migrationRevisions.ts`（sha256）、`server/db/migrationState.test.ts` 的
`alreadyPresent`（逐句複核後 +22）。已在真實 PostgreSQL 跑過 `scripts/ci-migration-test.sh`
與 `db:check`（`schema drift: none`）。

新表：

| 表 | 回答的問題 |
| --- | --- |
| `library_resources` | 「這份原始資料在 Library 裡的 canonical 指標是哪一列」 |
| `library_resource_usages` | 「哪些專案在**引用**它」（不複製 bytes） |
| `folder_import_sessions` | 「這次資料夾匯入的狀態與進度」 |
| `folder_import_entries` | 「每個檔案的相對路徑、差異狀態、上傳結果」 |
| `context_bindings` | 「Project / Scene / Shot 各自要用哪些資料、扮演什麼角色」 |
| `context_resolution_runs` | 「這次 AI 實際用了哪些 context」（Source Trace） |

### 20.2 為什麼不改 `assets.project_id`

`assets.project_id` 仍是 NOT NULL，本次**刻意不動**——全站對 assets 的既有語意
（生成、版本、交付、回收桶）都建立在它上面。

改採 canonical 指標層：`library_resources` 記住「哪一列**實體持有** bytes」
（`home_project_id` + `resource_kind`/`resource_id`），其他專案透過
`library_resource_usages` 與 `context_bindings` 引用同一份。因此：

- binary bytes 不重複（只有一列 asset 持有 storage_path）
- Intelligence Analysis 不重複（`asset_intelligence` 仍以 carrier 為唯一鍵）
- Source Trace 不重複（`intelligence_data_sources` 掛在同一個 intelligence 上）

### 20.3 第六條規則（延伸 §14 與 §18.2）

> **Context Bound ≠ Visible**

`context_bindings` 只回答「這份資料算不算這個 scope 的」。讀取端一律
`listVisibleContextBindings()`——先解出這個人看得到什麼，再與 binding 取交集。
**絕不可** `SELECT ... WHERE resourceId IN (bound)`。

且 **personal 範圍的表永遠不可綁**（`services/contextBindings.contextTableDenyReason`），
與 `projectDataBindings.bindableDenyReason` 同一條規則，兩邊的測試各自釘死。

### 20.4 AI 建議永不自動升級

`context_bindings.source = 'AI_SUGGESTED'` 的列**不會**因為被用過、被檢索到、
或被繼承而變成 `USER_CONFIRMED`。唯一的升級路徑是使用者的明確動作
（`projectContext.confirmSuggestion` / `acceptSuggestions`）。
判準集中在 `shared/projectContext.isConfirmedContextSource()`。

### 20.5 「只用這幾份」的邊界（修正一個既有缺口）

`assistant.ask` 原本無條件呼叫 `retrieveIntelligenceContext` 檢索整個 Library——
即使使用者已經用 `onlyKnowledgeIds` 說「只用這三份」。知識庫被限制住了，
Intelligence 檢索卻沒有，等於偷偷用了他沒選的資料。

現在助手改走 `resolveContext()`，並在 `onlyKnowledgeIds` 有值時
`allowGlobalRetrieval: false`。`buildKnowledgeContextWithMeta` 的預算、`onlyIds` 嚴格
限制與 `truncated` 回報完全不動。

### 20.6 進度誠實（Folder Import）

`shared/folderImport.folderImportProgress()` 刻意回**四段**（掃描／上傳／AI 已理解／
需要確認），而且不提供任何「整體百分比」。「AI 已理解」的分母是**已上傳數**、
資料來自 `asset_intelligence.analysis_status`，不是把上傳進度換個標籤。

`MISSING`（來源檔案消失）只標記、只顯示，**永遠不自動刪除站內資料**——
與「中斷來源連線不刪已匯入內容」同一條原則。

### 20.7 本機路徑隱私

三層防線，任何一層單獨失效都還擋得住：

1. `shared/folderImport.normalizeRelativePath()` 拒收絕對路徑與 `..`
2. `routers/folderImport` 與 `/api/upload` 各自再驗一次
3. Tauri 原生端只回 `rootId` + 顯示名 + 相對路徑；絕對路徑存在
   `FolderRootState`（rootId → PathBuf），永遠不進 WebView；
   `client/src/platform/desktopBridge.sanitizeDesktopScan()` 是最後一道閘門

### 20.8 仍未做

- **桌面端 byte 上傳與 watcher**：原生已有 `pick_import_folder` / `scan_import_folder` /
  `forget_import_folder`（可掃描、可重新比對、記得來源根目錄），但**尚未**由原生端上傳檔案內容，
  也**沒有** watcher。目前桌面版仍以瀏覽器的資料夾選取上傳 bytes。
- **generation prompt 注入**：生成端目前只落 Context Source Trace
  （`context_resolution_runs`，含 generationId），**尚未**把 Primary Reference 寫進
  prompt 組裝——那條路徑有既有的錨點機制與測試，另案處理。
- **byte-range resumable upload**：目前是檔案層級續傳（已完成的檔案不重傳），
  不是單檔斷點續傳。
