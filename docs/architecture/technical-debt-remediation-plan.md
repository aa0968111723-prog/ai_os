# Aios 技術債清理計畫

> 狀態：In progress（首批 TD-00～03／07 見 `feat/td-core-policy-command-worker` 與 `td-00-baseline-report.md`）
> 
> 適用範圍：`aa0968111723-prog/ai_os`
> 
> 原則：不重寫產品、不停止功能開發，以小型、可回退、可驗證的 PR 逐步收斂架構。

## 1. 目的

Aios 已具備專案、生成、工作流、AI 代理、筆記、排程、人類任務、資料庫、MCP、推播、團隊與稽核等能力。現階段主要風險不是缺少功能，而是相同商業規則分散在前端、Router、Runner、MCP 與背景服務中。

本計畫的目標是建立四個不可繞過的核心：

1. **Policy Engine**：統一團隊、組別、專案、成本與工具權限。
2. **Command Layer**：所有重要寫入與生成入口走同一條業務管線。
3. **Project State Machine**：統一 active、paused、archived 等生命週期限制。
4. **Worker Boundary**：分離 HTTP 啟動、背景執行與排程責任。

完成後，直接操作、工作流、AI 代理、MCP 與排程應得到一致的權限、核准、扣點、稽核與通知結果。

## 2. 不在本計畫中的事項

- 不重寫 React、tRPC、Drizzle 或 PostgreSQL 技術棧。
- 不一次拆成微服務。
- 不在同一 PR 同時改權限、資料庫與 UI。
- 不因重構改變既有產品文案、生成結果或正常使用流程。
- 不移除現有相容路徑，除非已有遷移期與回退方案。

## 3. 技術債優先級

| 優先級 | 項目 | 主要風險 | 第一個交付物 |
|---|---|---|---|
| P0 | 統一權限政策 | 多入口規則不一致、越權、UI/API 不一致 | `PolicyContext`、`Action`、政策矩陣測試 |
| P0 | 統一生成與寫入 Command | 工作流、代理或 MCP 漏掉核准、扣點、稽核 | `executeGenerationCommand` |
| P0 | 專案生命週期守衛 | 封存專案仍可寫入或扣點 | `assertProjectAllows` |
| P0 | SSRF 防護驗證 | 文件匯入可能連到內網或 metadata | DNS/IP pinning 測試與修復 |
| P1 | 前端 App Shell 拆分 | 導覽、團隊入口、Session 與通知互相牽動 | `AppShell`、`AppRoutes`、資料化導覽 |
| P1 | 後端 bootstrap 拆分 | 啟動檔承擔 HTTP、健康檢查、上傳、Worker | `createApp`、`readiness`、`workers` |
| P1 | 團隊 capability 模型 | `admin/leader/member` 無法表達真實治理 | 舊角色到 capability 的相容映射 |
| P1 | Web/Worker 執行邊界 | 多 replica 重複執行、Web 流量拖累工作 | `PROCESS_ROLE` |
| P1 | Schema 領域拆分 | migration 衝突、完整性與索引難檢查 | schema modules 與 orphan report |
| P1 | 成本帳務分離 | 點數混合預估、實際成本、額度與預算 | cost ledger 設計文件與相容欄位 |
| P2 | ADR 與架構契約 | 關鍵決策只存在程式碼長註解 | `docs/adr/*` |
| P2 | Import boundary | 頁面、Router、Runner 可跨層直接依賴 | 自動化依賴檢查 |

## 4. 執行順序

### Phase 0：建立基線與安全回歸

**目標：** 在重構前先證明目前行為，避免「整理架構」時改壞權限或成本治理。

交付：

- 建立角色 × 入口 × 專案狀態 × 成本門檻的政策矩陣。
- 覆蓋（與 checklist §3 一致，缺一不可列為 TD-00 完成）：
  - Web / tRPC direct
  - REST（若部署暴露 `/api/v1`；否則在報告標示「未部署／延期」並寫明理由）
  - MCP
  - workflow runner
  - agent runner
  - approval resume
  - schedule / background resume
- 重新驗證既有滲透測試的重要發現，至少包含：
  - 登入 IP 限流不可被偽造 XFF 繞過。
  - 匯入 URL 的 DNS 解析、redirect 與私有網段阻擋。
  - 工作流與代理無法繞過成本核准門檻。
  - 封存專案不能進行生成與其他重要寫入。
- 記錄目前測試數、coverage、build 時間、主要 bundle 與 CI 時間。

退出條件：

- 所有 P0 行為都有可失敗的測試，不只依靠人工驗證。
- 上列多入口覆蓋已有測試或已文件化延期項（不得默默省略）。
- 發現中的已修項目標示為 verified，不確定項目維持 open，不以推測關閉。

### Phase 1：Policy Engine

**目標：** 讓所有入口問同一個問題，而不是各自判斷 `isAdmin`、`leader` 或 `member`。

建議 API：

```ts
export type PolicyAction =
  | "team.view"
  | "team.manage"
  | "group.manage_members"
  | "project.view"
  | "project.edit"
  | "generation.submit"
  | "generation.approve"
  | "agent.dispatch"
  | "task.create"
  | "schedule.create"
  | "note.create"
  | "note.append"
  | "database.read"
  | "database.write"
  | "audit.view";

/**
 * source 語意（跨入口測試與稽核必須一致）：
 * - web：瀏覽器經 tRPC / SSE 的直接操作（tRPC direct 歸此類，不另開 "trpc"）
 * - rest：對外 REST /api/v1 金鑰或 session 入口
 * - mcp：外部 AI 經 MCP 工具
 * - workflow / agent：背景 Runner 以發起人身分續跑
 * - system：排程、resume、內部維運（無人類當下點擊）
 */
export interface PolicyContext {
  actorId: string;
  teamId?: string;
  groupId?: string;
  projectId?: string;
  source: "web" | "rest" | "mcp" | "workflow" | "agent" | "system";
  estimatedPoints?: number;
}

export type PolicyDecision = {
  allowed: boolean;
  requiresApproval: boolean;
  reason?: string;
};

// 契約示意：實作時放在模組內並有函式本體；此處以型別表達不可破壞的回傳形狀。
export type EvaluatePolicy = (
  action: PolicyAction,
  context: PolicyContext,
) => Promise<PolicyDecision>;
```

Phase 2 第一批 Command 與 `PolicyAction` 的對應（禁止默默重用 `project.edit` 而失去核准／稽核語意）：

| Command | PolicyAction |
|---|---|
| `executeGenerationCommand` | `generation.submit`（必要時再走 `generation.approve`） |
| `createProjectTaskCommand` | `task.create` |
| `writeProjectDatabaseCommand` | `database.write` |
| `createScheduleCommand` | `schedule.create` |
| `createOrAppendNoteCommand` | `note.create` / `note.append` |

遷移方式：

1. 將現有角色轉為 capability，不先改資料庫。
2. 後端先採用政策層；前端只能用後端回傳 capability 控制顯示。
3. 保留舊 helper 作為 adapter，禁止再新增新的角色判斷。
4. 每移轉一個領域，補入口一致性測試。

退出條件：

- 前端主要導覽不再自行拼 `isAdmin || isLeader`。
- Web/tRPC、REST、workflow、agent、MCP 與 system resume 對相同行為取得相同政策結果。
- 政策拒絕與需核准的原因可稽核。

### Phase 2：Command Layer

**目標：** 重要寫入只有一條正式入口。

第一批 Command：

- `executeGenerationCommand`
- `createProjectTaskCommand`
- `writeProjectDatabaseCommand`
- `createScheduleCommand`
- `createOrAppendNoteCommand`

每個 Command 固定執行：

1. 載入 actor 與租戶脈絡。
2. 驗證專案與資源歸屬。
3. 驗證專案生命週期。
4. 呼叫 Policy Engine。
5. 計算成本與核准需求。
6. 寫入主要資料與 idempotency。
7. 建立 audit/event。
8. 發送通知或佇列工作。

限制：

- Runner 不得直接呼叫 provider 或跨領域低階資料操作。
- Router 只做輸入驗證、呼叫 Command 與傳回結果。
- MCP 工具不得有獨立商業邏輯副本。

退出條件：

- 所有生成入口共用同一個 Command。
- 成本核准、額度與稽核測試只需要維護一套核心案例，再以 transport contract 驗證各入口。

### Phase 3：Project State Machine

**目標：** 專案狀態成為所有寫入的共同守衛。

建議狀態：

```ts
type ProjectState = "active" | "paused" | "archived";
```

建議規則：

- `active`：允許依權限操作。
- `paused`：可讀、可審核與恢復；禁止新生成與自動派工。
- `archived`：唯讀；只允許匯出、查詢與恢復。

建立：

```ts
assertProjectAllows(project, action);
```

退出條件：

- 所有專案綁定 mutation 都有 state guard。
- archived 專案在 Web、MCP、workflow、agent 均無法寫入或扣點。

### Phase 4：前端 App Shell 與導覽

**目標：** 將路由、Session、組別、通知與導覽從單一 `App.tsx` 拆開。

建議結構：

```text
client/src/app/
├── AppShell.tsx
├── AppRoutes.tsx
├── AppHeader.tsx
├── navigation/
│   ├── navigationItems.ts
│   ├── PrimaryNavigation.tsx
│   └── AccountMenu.tsx
├── organization/
│   ├── OrganizationContext.tsx
│   └── GroupSwitcher.tsx
├── notifications/
│   ├── PendingApprovalMenu.tsx
│   └── DirectMessageBadge.tsx
└── session/
    ├── SessionGate.tsx
    └── ChangePasswordDialog.tsx
```

導覽項目資料化並使用 capability：

```ts
{
  key: "team",
  label: "成員與組別",
  href: "/team",
  capability: "team.view",
}
```

退出條件：

- 團隊管理不再依賴帳號選單中的零散 JSX 條件。
- 管理員、組長、一般成員的導覽都有 contract test。
- App shell 拆分不更動後端權限真相來源。

### Phase 5：後端 Bootstrap 與 Worker Boundary

**目標：** 將 HTTP 與背景處理責任分離，但暫時保留同一 repository 與部署映像。

建議結構：

```text
server/
├── bootstrap/
│   ├── createApp.ts
│   ├── middleware.ts
│   ├── routes.ts
│   ├── readiness.ts
│   └── shutdown.ts
├── workers/
│   ├── generation.worker.ts
│   ├── workflow.worker.ts
│   ├── agent.worker.ts
│   └── export.worker.ts
└── index.ts
```

啟動角色（**單值**；三選一，不可在同一 env 重複宣告同一 key）：

```env
# 僅 HTTP／API（不領背景工作）
PROCESS_ROLE=web

# 僅背景 Runner（不對外提供應用路由）
# PROCESS_ROLE=worker

# 單一實例同時兼 Web + Worker（開發／小部署預設）
# PROCESS_ROLE=all
```

退出條件：

- Web process 不需要啟動 Runner。
- Worker process 不提供公開應用路由。
- readiness 清楚區分 Web 與 Worker 必要元件。
- rolling deploy 與多 replica 不會重複執行同一工作。

### Phase 6：資料庫與帳務完整性

**目標：** 先建立可觀察性，再逐步補完整性約束，避免一次 migration 破壞資料。

順序：

1. Schema 依領域拆檔，但保持匯出 API 相容。
2. 產生 orphan、duplicate、invalid state 報告。
3. 修復既有資料。
4. 逐表新增 foreign key、unique、check 與必要索引。
5. 將預估成本、預留點數、實際 provider 成本與結算點數分離。

退出條件：

- 新增多租戶表必須有清楚的 team/group/project ownership。
- 關鍵關聯有 DB-level constraint 或文件化的例外理由。
- 成本報表可區分 estimated、reserved、actual、settled。

## 5. PR 拆分建議

| PR | 標題建議 | 範圍 |
|---|---|---|
| TD-00 | `test: 建立技術債治理基線與跨入口政策矩陣` | 只加測試與報告 |
| TD-01 | `refactor(authz): 建立統一 Policy Engine` | 新政策層與 adapter |
| TD-02 | `refactor(generation): 所有生成入口統一走 Command` | direct/workflow/agent/MCP |
| TD-03 | `fix(project-policy): 統一專案生命週期寫入守衛` | paused/archived |
| TD-04 | `security(import): 強化 DNS、redirect 與私網 SSRF 防護` | 匯入網路層 |
| TD-05a | `refactor(authz): 導入 capability 模型與舊角色相容映射` | 後端 capability；不改 UI |
| TD-05b | `feat(team-ui): 依 capability 恢復團隊入口分層` | 僅前端；依賴 TD-05a 已合併 |
| TD-06 | `refactor(client-shell): 拆分 App Shell 與資料化導覽` | 前端結構 |
| TD-07 | `refactor(server): 分離 bootstrap、readiness 與 worker` | 後端結構 |
| TD-08 | `refactor(db): schema 領域拆分與完整性報告` | 不先加破壞性 FK |
| TD-09 | `feat(cost): 分離預估、預留、實際與結算成本` | 帳務模型 |
| TD-10 | `chore(architecture): 加入 ADR 與 import boundary` | 長期防回歸 |

## 6. 每個技術債 PR 的硬性規則

- 一個 PR 只處理一個架構邊界（後端政策／Command／Worker／schema／前端 shell 等擇一為主）。
- **TD-05a／TD-05b 刻意拆成兩個 PR**：capability 真相來源先落地，團隊 UI 再消費；若未來有「必須同 PR 改兩層」的例外，PR 說明須寫清依賴、驗收與回退，且 checklist §1 須勾選跨邊界理由。
- 優先新增 adapter，再遷移 caller，最後刪除舊路徑。
- 不允許無測試的大型移動或重新命名。
- 不允許以「內部呼叫」為理由跳過權限、核准、生命週期、額度或稽核。
- 不允許只修 Web 而忽略 REST、MCP、workflow、agent、approval resume 與 schedule／background resume（見 checklist §3）。
- 資料庫 migration 必須提供 dry-run、回退與現有資料檢查。
- 重大安全修復必須加入可重現回歸測試。
- PR 說明必須列出：行為不變證據、風險、回退方式、未涵蓋範圍。

## 7. Codex 執行契約

Codex 處理後續 PR 時必須：

1. 先讀本文件與對應領域現有測試。
2. 先建立或確認失敗測試，再修改實作。
3. 搜尋所有 transport：Web、REST、MCP、workflow、agent、worker。
4. 不以複製現有 helper 的方式建立第二份規則。
5. 不順便處理無關 UI、文案或 schema。
6. 保留向後相容 adapter，除非 PR 有完整 caller 清單。
7. 執行 typecheck、server/shared tests、client tests、build 與相關 E2E。
8. 在 PR 內列出尚未遷移的 caller 與下一個 PR。

## 8. 成功衡量

### 安全與一致性

- 相同 actor/action 在不同 transport 的政策結果一致。
- 任何重要寫入都可追溯 actor、source、resource 與決策原因。
- P0 滲透案例都有 CI 回歸測試。

### 可維護性

- `App.tsx` 與 `server/index.ts` 僅保留組裝責任。
- Router 與 Runner 不再包含重複的角色與成本治理邏輯。
- 新增 transport 不需要重新實作整套商業規則。

### 部署韌性

- Web 與 Worker 可獨立啟動與診斷。
- 多 replica 下工作不重複，關機可排空。
- Schema migration 不在一般 App 啟動流程中隱性執行。

### 開發效率

- 權限或成本規則修改只需改一個核心並更新矩陣測試。
- 團隊導覽不再因 App shell 修改而消失。
- 技術債 PR 可在小範圍內審查與回退。

## 9. 第一個後續 PR

本計畫合併後，第一個實作 PR 應為 **TD-00：技術債治理基線與跨入口政策矩陣**。

TD-00 不改產品行為，只將以下現況鎖進測試：

- Web/tRPC direct、REST（若存在）、MCP、workflow、agent、approval resume、schedule／background resume 的生成與重要寫入政策一致性。
- 成本門檻核准一致性（含 workflow／agent／MCP 不可繞過）。
- active/paused/archived 專案寫入規則。
- 管理員、組長、成員的導覽與後端能力對照。
- XFF 與 URL import SSRF 的安全回歸。

未覆蓋的入口必須在 PR 說明標為 open／延期，不得標為已驗證。

只有在 TD-00 穩定後，才開始 TD-01 Policy Engine。