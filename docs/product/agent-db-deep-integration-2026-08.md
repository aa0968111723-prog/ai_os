# Aios Agent × Backend Database 深度整合實作契約

## 目標

把 Aios 的 AI Agent 真正接到後端資料庫，做到：

`USER GOAL → RESOLVE DATABASE/TABLE/ROW/FIELD → ACL/POLICY → TOOL EXECUTION → POSTGRESQL → READ-BACK VERIFY → EXECUTION RECEIPT → AGENT EVENT/UI`

這不是只做研究或文件。此 PR 是實作工作區，必須一路做到程式碼、測試、缺陷修復、真實 DB 驗證與 push。

## 基準與保護規則

基準 commit：`13f73a9c31c517b842c34332bdbf06002981da6f`。

不得回退近期 production 修復，尤其：

- migration-first startup
- PostgreSQL / Zeabur TLS/runtime probe 修復
- Agent production hardening
- capability certification
- backend dependency readiness
- assistant database evidence retrieval

開始前先：

```bash
pwd
git status --short
git branch --show-current
git log --oneline -15
git diff
git diff --cached
```

不得 `git reset --hard`、`git clean -fd`、`git checkout -- .` 去覆蓋既有工作。

## 必讀區域

至少完整盤點：

- `server/services/agentToolRegistry.ts`
- `server/services/practicalAutonomy.ts`
- `server/services/agentRunner.ts`
- `server/services/agentRunLedger.ts`
- `server/services/agentCapabilityCertification.ts`
- `server/services/databaseMcp.ts`
- `server/services/databaseCommand.ts`
- `server/services/databaseCore.ts`
- `server/services/databaseAcl.ts`
- `server/services/databaseRowSearch.ts`
- `server/services/databaseProjectLinks.ts`
- `server/services/projectDataBindings.ts`
- `server/services/assistantDatabaseEvidence.ts`
- `server/routers/globalAssistant.ts`
- `server/routers/assistant.ts`
- `server/routers/teamAssistant.ts`
- `server/routers/agents.ts`
- `shared/assistantExecution.ts`
- `shared/assistantSemanticResolution.ts`
- `shared/assistantGoalFrame.ts`
- `shared/executionReceipt.ts`
- `shared/agentEvents.ts`
- `client/src/components/AICreativeCopilot.tsx`
- relevant `*.test.ts`, `*.test.tsx`, `scripts/e2e-*`

## P0：正式 Database Agent Capability Layer

把資料庫能力正式接進 server-owned Agent Tool Registry；不要只活在 MCP 或 Global Assistant。

至少具備等價能力：

- `database.list`
- `database.schema`
- `database.query`
- `database.row.get`
- `database.row.add`
- `database.row.update`
- destructive delete 若允許，必須高風險 confirmation + read-back；若產品政策不允許 direct delete，保留為 proposal/confirmed path。

每個 tool 必須有真實 handler、Zod input/output、ACL context、risk、confirmation、idempotency、retry、verification、evidence、availability、handler identity。禁止註冊假 capability。

## P0：共用正式 Database Backend

讀取優先復用既有：

- `listMcpDatabases`
- `getAgentReadableTable`
- `queryMcpDatabase`
- `assistantDatabaseEvidence`
- project binding / project link helpers

寫入必須復用：

- `executeDatabaseWriteCommand`
- `databaseCore` validated paths

Agent 不得另外直接 `db.insert/update/delete` 形成旁路。

## P0：權限與租戶隔離

Agent DB operation 必須重新驗證：

- `userId`
- `groupId`
- `projectId`（若有）
- table visibility
- `resolveAgentAccess`
- `canRead`
- `canWriteRows`
- `agentAccess`
- project state
- membership
- policy engine

沒有權限時不得洩漏 resource 存在性。Client/LLM 傳來的 ID 永遠不是授權依據。

## P0：Database Resource Resolver

使用者不應提供 UUID。

支援自然語言解析：

- 「素材清單」
- 「素材庫」
- 「目前資料表」
- 「這張表」
- 「第三個資料庫」
- 「剛剛那個資料庫」
- 「這個專案的資料」

解析優先級至少考量：

1. explicit ref
2. current selected table/page context
3. project-bound table
4. exact normalized name
5. semantic/lexical match
6. recently used table
7. authorized visibility

多個高置信候選時必須 structured picker / interaction，不准亂猜第一張表。

## P0：Assistant Database Context

讓 page/assistant context 能攜帶目前 database/table：

- databaseId
- databaseName
- selectedTableId
- selectedTableName
- databaseView
- projectId
- groupId

使用者在資料表頁問「這裡有什麼？」時，應直接以 selected table 為上下文，而不是重掃全站。

## P0：查詢與跨庫搜尋

Query 要 bounded、schema-aware、可分頁，至少支援：

- keyword
- field equals/filter
- limit
- offset/cursor
- includeFields
- project context

Cross-database search 流程：authorized tables → candidate table ranking → per-table row retrieval → relevance merge → context budget → source metadata。

不能只 `ORDER BY updated_at DESC LIMIT N`，舊的 exact match 不得被近期無關資料淹掉。

結果需保留 databaseId/databaseName/rowId/score/snippet 等可驗證來源。

## P0：Schema-aware Writes

自然語言欄位名稱要 resolve 成 canonical field key。

值必須依 DataField type 走既有 validation/normalization；不能把所有值都當 string。

欄位不存在時不得 silent discard；不確定就 structured clarification。除非使用者明確要求，不得自行改 schema。

## P0：Verified Write Truth

任何 write 都不能以「SQL 沒 throw」當完成。

ADD：重新讀回 row，驗 tableId 與 canonical values。

UPDATE：重新讀回 row，驗 new values。

DELETE（若實作）：重新確認 row 不存在。

只有 read-back 成功才可：

- `verified = true`
- 建立 ExecutionReceipt
- emit `agent.completed`
- UI 顯示已完成

否則必須是 `unverified` / failed / waiting，禁止假成功。

## P0：Idempotency / Durable Effects

AI retry/reconnect/redeploy 不得重複新增資料。

復用現有：

- `agent_tool_receipts`
- toolCallId
- attemptId
- effectFingerprint
- idempotencyKey
- AgentRunLedger

同一 logical effect retry 必須 exactly-once 或可證明等價。

## P0：ExecutionReceipt + Agent Event

DB write receipt 至少能證明：

- toolId/toolCallId/runId
- tableId/rowId
- operation
- requested effect
- actual effect
- verified
- verifiedAt
- evidence

使用現有 ExecutionReceipt/agent_tool_receipts 架構，不新建第二套 receipt table。

UI 事件顯示真實工作：找到資料庫、查到 N 筆、等待確認、寫入、驗證成功/失敗。不得暴露 private chain-of-thought。

## P1：Global / Project / Team / Agent / MCP 收斂

盤點並盡量共用同一套：

- DB ACL
- resolver
- query semantics
- write command
- verification
- source/evidence

不能出現 MCP 能做、站內 Agent 做不到，或 Global Assistant 能查但 Project Assistant 不能查的無必要分岔。

## P1：Project-aware 與 Recent Coreference

「這個專案的資料」優先 project-bound / linked data。

支援 durable recent refs：

- 「把剛剛那筆改成完成」
- 「把剛才找到的第三筆…」
- 「把那些資料…」

只保存 bounded safe refs（tableId/rowIds/query/timestamp），不要把整張 DB 內容塞入 conversation state。

## P1：Dependency honesty

DB unhealthy 時 DB capabilities 必須 unavailable/degraded；Planner 不得選到後再文字宣稱完成。

保持 `/api/health` liveness 與 `/api/ready` readiness 分工。

## Migration 規則

沒有持久 schema 需求就不要新增 migration。

若必須新增：只新增下一號 migration，不修改已發布 migration；journal/revisions/fresh DB/upgrade DB/db:check/drift 全部通過。正式 runtime 禁止偷跑臨時 DDL。

## 必要測試

### Resolver

- exact/fuzzy name
- selected table wins
- project bound wins
- inaccessible filtered
- ambiguous → interaction
- recent table/ref
- invalid ref

### Query

- keyword
- equals
- pagination/limit
- escaping `%`, `_`, `\\`
- JSONB
- old exact match survives recent unrelated rows
- multi-table
- empty result
- auth isolation

### Write

- add
- update
- invalid field
- read-only agentAccess
- project archived
- policy denied
- idempotent retry
- read-back failure
- receipt/evidence
- no false completion

### Real PostgreSQL integration

不要全部 mock。建立 fixture → Agent tool query/add/update → 直接查 PostgreSQL assert → retry assert no duplicate → cleanup。

### Assistant utterances

至少驗證：

- 「有哪些資料庫？」
- 「素材清單有什麼？」
- 「幫我找書法」
- 「搜尋所有資料庫裡面的書法」
- 「在素材清單新增：標題=王羲之，分類=書法」
- 「把剛剛新增那筆的狀態改成完成」

Assertion 不能只看文字；要驗 capability/tool/table/row/write/receipt/verified completion。

## E2E / Fresh-eye

擴充既有 `e2e-databases.py`、`e2e-global-assistant.py`、`e2e-mcp.py` 或新增 `e2e-agent-database`。

至少覆蓋：list/query/add/update/read-only denied/zero-result honesty。

第一輪測試綠後，再 fresh-eye 測「這裡呢？」「剛剛那個」「第三筆」「最近的」「最早的」「搜尋全部」「只找這個專案」「加一筆」「改一下」「先不要」「取消」「刪掉」，找 wrong DB/row、stale context、duplicate write、ACL bypass、false completion。

## 必跑 gates

環境可用時至少跑：

```bash
npm run typecheck
npm test
npm run test:client
npm run build
npm run check:boundaries
npm run check:hooks
npm run check:ui-primitives
npm run db:check
npm run verify:agent-db-integrity
npm run verify:database-runtime
npm run backend:doctor
```

沒跑過的不得寫 PASS；缺外部依賴就標 `NOT RUN — missing runtime dependency`。

## Git / PR 工作模式

這個 PR 就是唯一工作區：

- 直接在本 PR head branch 實作
- 不另開第二個 implementation PR
- 不 auto-merge
- 不 force-push 覆蓋他人工作
- remote 有新 commit 時先 fetch/reconcile

完成前：`git status`、`git diff --check`、`git diff --stat`、檢查 secrets/debug dumps。

完成後 commit + push 到本 PR branch，更新 PR body/checklist 為真實測試結果。

## Definition of Done

只有以下都成立才算完成：

- Agent 能列/resolve/query authorized DB
- selected/current/project context 正確
- cross-db search 有來源
- add/update 真寫入 PostgreSQL
- Agent ACL + policy 生效
- retry 不重複寫
- write 有 read-back + receipt
- verified 前不得 completed
- tool 真註冊在 Agent runtime
- planner/runner 可執行
- UI 顯示真實狀態
- unit/integration/build gates 真實通過或明確標 external blocker
- 至少兩輪 fresh-eye 無新 P0/P1 才宣稱穩定

## 最終回報

最後更新 PR，包含：

1. Root causes
2. Architecture after
3. Implemented changes
4. Tests（PASS/FAIL/NOT RUN）
5. Production/staging verification
6. Remaining risks
7. Final branch + commit SHA

不要停在計畫。直接做到實作、測試、修復、push。