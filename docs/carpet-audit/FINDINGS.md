# 全站地毯式測試紀錄（Carpet Audit）

> 自動／半自動累積。每格執行後 append。狀態：`.data/carpet-audit/state.json`

| 欄位 | 說明 |
|------|------|
| 循環 | 60s 推進下一區塊 |
| 實機 | e2e-py + Playwright + 單元測試 |
| 記錄 | 本檔 + PR |

---

## 2026-07-31T05:55:30.923Z · `infra.health` ✅ pass

**基礎設施：健康檢查／ready／selftest** · kind=`api` · cycle=0 · cursor→1

Detail: `{"ok":true,"processRole":"all","db":"connected（資料庫已接通）","boot":"ready（初始化完成）","components":{"db":{"ok":true,"note":"connected（資料庫已接通）"},"boot":{"ok":true,"note":"ready（初始化完成）"},"storage":{"ok":true,"note":"ok（本機模式可寫讀）"},"runner":{"ok":true,"note":"ok（生成執行器運作中）"},"provider":{"ok":true,"note":"ok（生成服務`

---

## 2026-07-31T05:55:30.989Z · `static.agent-parallel` ❌ fail

**靜態：代理並行開拍（DAG／MAX_PARALLEL）** · kind=`static-review` · cycle=0 · cursor→16

Detail: `2 finding(s)`

### Findings

#### [high] AGENT-PAR-AUTHZ-SILENT: 並行 generate 路徑權限失敗只 return 不 failRun

- **File**: `server/services/agentRunner.ts`
- **Evidence**: startParallelGenerateBranches: if (authzError) return;
- **Consequence**: 發起人被降權/移出組時，並行支線可能空轉而非明確 failed；與 serial 路徑 failRun 不一致
- **Fix**: if (authzError) { await failRun(...); return; } 或回傳錯誤給 advanceRun 統一收攏

#### [medium] AGENT-PAR-GHOST-GENID: 並行送出 INTERNAL_SERVER_ERROR 後留下幽靈 generationId

- **File**: `server/services/agentRunner.ts`
- **Evidence**: generationId 已寫入 steps 後 catch INTERNAL 直接 return，未清 generationId
- **Consequence**: 步驟卡在 running 直到 30 分鐘 STALE 陳屍回收；期間不再重試送出
- **Fix**: 暫時失敗時清除 generationId 並回 pending，或寫 detail 並排退避重試

---

## 2026-07-31T05:55:31.044Z · `static.acl-routers` ✅ pass

**靜態：routers 寫入守衛 assertProjectEditable** · kind=`static-review` · cycle=0 · cursor→17

Detail: `5 finding(s)`

### Findings

#### [low] ACL-SCAN-agents.ts: router agents.ts 含 mutation 但未出現 assertProjectEditable（需人工確認是否適用）

- **File**: `server/routers/agents.ts`
- **Evidence**: heuristic scan
- **Consequence**: 可能是合法（組級/個人資源）或漏掛
- **Fix**: 人工對照每個 mutation 是否寫專案內容

#### [low] ACL-SCAN-exportJobs.ts: router exportJobs.ts 含 mutation 但未出現 assertProjectEditable（需人工確認是否適用）

- **File**: `server/routers/exportJobs.ts`
- **Evidence**: heuristic scan
- **Consequence**: 可能是合法（組級/個人資源）或漏掛
- **Fix**: 人工對照每個 mutation 是否寫專案內容

#### [low] ACL-SCAN-notes.ts: router notes.ts 含 mutation 但未出現 assertProjectEditable（需人工確認是否適用）

- **File**: `server/routers/notes.ts`
- **Evidence**: heuristic scan
- **Consequence**: 可能是合法（組級/個人資源）或漏掛
- **Fix**: 人工對照每個 mutation 是否寫專案內容

#### [low] ACL-SCAN-schedule.ts: router schedule.ts 含 mutation 但未出現 assertProjectEditable（需人工確認是否適用）

- **File**: `server/routers/schedule.ts`
- **Evidence**: heuristic scan
- **Consequence**: 可能是合法（組級/個人資源）或漏掛
- **Fix**: 人工對照每個 mutation 是否寫專案內容

#### [low] ACL-SCAN-tasks.ts: router tasks.ts 含 mutation 但未出現 assertProjectEditable（需人工確認是否適用）

- **File**: `server/routers/tasks.ts`
- **Evidence**: heuristic scan
- **Consequence**: 可能是合法（組級/個人資源）或漏掛
- **Fix**: 人工對照每個 mutation 是否寫專案內容

---

## 2026-07-31T05:55:31.099Z · `static.security` ✅ pass

**靜態：SSRF／上傳／session／MCP 金鑰** · kind=`static-review` · cycle=0 · cursor→18

Detail: `paths ok, no auto findings`

---

## 2026-07-31 · `e2e.auth` 實機 ✅ pass（clean DB, AUTH_MODE unset）

**E2E：登入／邀請／角色／多組隔離** · 43/43

- 跨組建案／讀取／列表隔離
- 交付包 403 隔離
- 審批狀態機、點數門檻、MCP 審計
- 強制改密碼 tRPC + Express 雙層
- PostgreSQL 登入限流 429

對照：同套件在 `AUTH_MODE=dev` 下隔離 7 項假紅（見 WAVE-0 O1）。

---

