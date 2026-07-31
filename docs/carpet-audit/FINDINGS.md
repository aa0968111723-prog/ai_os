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

## 2026-07-31 · `e2e.models` 實機 ✅ pass

**E2E：模型目錄／多模態生成（mock）** · 22/22

文生圖／圖生圖／LLM／TTS／STT／交付／自檢全綠。

---

## 2026-07-31T06:02:43.402Z · `ui.workbench` ❌ fail

**UI：創作工作台／技能選單** · kind=`ui-playwright` · cycle=0 · cursor→19

Detail: `exit=1`

---

## 2026-07-31 · `ui.workbench` ❌ fail（基建）

**UI：創作工作台／技能選單** · kind=`ui-playwright`

### Findings

#### [medium] CARPET-UI-PLAYWRIGHT-MISSING: 環境缺 playwright 套件

- **File**: `scripts/e2e-ui/verify-workbench.mjs`
- **Evidence**: `ERR_MODULE_NOT_FOUND: Cannot find package 'playwright'`
- **Consequence**: 所有 `ui-*` Playwright 區塊無法實機執行，地毯 UI 覆蓋空洞
- **Fix**: 確保 `npm ci` 含 devDependencies；`npx playwright install chromium`；本機已補裝

---

## 2026-07-31T06:07:15.077Z · `ui.agent` ❌ fail

**UI：代理卡生命週期** · kind=`ui-playwright` · cycle=0 · cursor→20

Detail: `exit=1`

---

## 2026-07-31 · `ui.agent` ❌ fail（基建）

**UI：代理卡生命週期** · kind=`ui-playwright`

### Findings

#### [medium] CARPET-UI-CHROMIUM-SIGTRAP: Playwright Chromium 啟動即 SIGTRAP

- **File**: `scripts/e2e-ui/verify-agent.mjs`
- **Evidence**: `browserType.launch` → chrome_crashpad_handler / `signal=SIGTRAP`；executable 已能找到（`~/.cache/ms-playwright/chromium-1208/.../chrome`）
- **Consequence**: 所有 UI Playwright 區塊在本 codespace 無法實機跑（缺系統 library 或 sandbox 限制）
- **Fix**: `npx playwright install-deps`（需 root）或改用已備 `/opt/pw-browsers` 映像；e2e-ui 已支援 `PW_CHROMIUM` 覆寫路徑

---

## 2026-07-31T06:08:42.024Z · `ui.routes` ❌ fail

**UI：全路由 × 多 viewport 基線** · kind=`ui-playwright` · cycle=0 · cursor→21

Detail: `exit=1 needs TEST_EMAIL/TEST_PW`

---

## 2026-07-31 · `ui.routes` ❌ fail（基建）

**UI：全路由 × 多 viewport 基線** · kind=`ui-playwright`

### Findings

#### [low] CARPET-UI-ROUTES-CREDS: 缺 TEST_EMAIL/TEST_PW 即 fail-closed

- **File**: `scripts/e2e-ui/audit-routes.mjs`
- **Evidence**: `缺少 UI 巡覽測試環境變數：TEST_EMAIL, TEST_PW`
- **Consequence**: carpet 未注入帳密時整格紅燈（設計為 fail-closed，非產品 bug）
- **Fix**: run-next 對 ui-playwright 預設帶入 SEED_ADMIN_*；下輪可重跑 `--force-id=ui.routes`

---

## 2026-07-31T06:09:46.669Z · `ui.breakpoints` ❌ fail

**UI：MOB-04 水平溢出斷言** · kind=`ui-playwright` · cycle=0 · cursor→22

Detail: `exit=1`

---

## 2026-07-31 · `ui.breakpoints` ❌ fail（基建）

**UI：MOB-04 水平溢出斷言** · kind=`ui-playwright`

### Findings

#### [medium] CARPET-UI-PW-BROWSER-MISMATCH: Playwright 版本與 browser cache 不一致

- **File**: `scripts/e2e-ui/audit-breakpoints.mjs`
- **Evidence**: 需要 `chromium_headless_shell-1234`，本機 cache 為 `chromium-1208`；且腳本未走 `PW_CHROMIUM` 覆寫
- **Consequence**: MOB-04 / 部分 UI 審計無法在本 codespace 跑
- **Fix**: `npx playwright install` 對齊 package 版；audit-breakpoints/routes 改用 `PW_CHROMIUM` 或 chromium.launch 預設

---

## 2026-07-31T06:10:41.070Z · `ui.golden` ❌ fail

**UI：黃金路徑全旅程** · kind=`ui-playwright` · cycle=0 · cursor→23

Detail: `exit=1`

---

## 2026-07-31 · `ui.golden` ❌ fail（基建）

**UI：黃金路徑全旅程** · 同 `CARPET-UI-CHROMIUM-SIGTRAP`（chromium-1208 launch → SIGTRAP）。非產品缺陷。

---

## 2026-07-31T06:11:38.768Z · `folder.client-components` ✅ pass

**區塊：client/components 目錄** · kind=`folder-scan` · cycle=0 · cursor→24

Detail: `65 entries under client/src/components/`

---

## 2026-07-31T06:12:40.627Z · `folder.client-pages` ✅ pass

**區塊：client/pages 目錄** · kind=`folder-scan` · cycle=0 · cursor→25

Detail: `21 entries under client/src/pages/`

---

## 2026-07-31T06:13:41.693Z · `folder.server-services` ✅ pass

**區塊：server/services 目錄** · kind=`folder-scan` · cycle=0 · cursor→26

Detail: `149 entries under server/services/`

---

## 2026-07-31T06:14:44.127Z · `folder.server-routers` ✅ pass

**區塊：server/routers 目錄** · kind=`folder-scan` · cycle=0 · cursor→27

Detail: `46 entries under server/routers/`

---

## 2026-07-31T06:25:39.165Z · `folder.shared` ✅ pass

**區塊：shared 契約** · kind=`folder-scan` · cycle=1 · cursor→0

Detail: `39 entries under shared/`

---

## 2026-07-31T06:26:40.751Z · `e2e.auth` ❌ fail

**E2E：登入／邀請／角色／多組隔離** · kind=`e2e-py` · cycle=1 · cursor→2

Detail: `exit=1`

---

## 2026-07-31 · `e2e.auth` ❌ fail（地毯流程）

**E2E：登入／邀請／角色／多組隔離** · kind=`e2e-py`

### Findings

#### [medium] CARPET-E2E-NO-DB-RESET: e2e-auth 非冪等，DB 有殘留帳號即崩潰

- **File**: `scripts/e2e-auth.py:43-44`；`scripts/carpet-audit/run-next.mjs` e2e-py 分支
- **Evidence**: `admin.invite` 對已存在 `azhe@example.com` 回 `inviteUrl: null, attached: true` → `token = inv["inviteUrl"].split` → `AttributeError`
- **Consequence**: 第二輪起 carpet 跑 `e2e.auth` 必紅（非產品 ACL 回歸）；`scripts/run-e2e-local.sh` 每套件前會 reset DB，carpet 未做
- **Fix**: run-next 在 e2e-py 前可選 `CARPET_E2E_RESET_DB=1` 走 drop schema + migrate + 重啟 seed；或 e2e-auth 對 attached 路徑改用既有密碼登入

對照：同腳本在 clean DB 下曾 **43/43** 全過（WAVE-0）。

---

