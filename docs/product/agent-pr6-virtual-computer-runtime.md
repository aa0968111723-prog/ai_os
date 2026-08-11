# PR-6：AI 工作電腦 / Virtual Computer Runtime

> 狀態：Proposed  
> 日期：2026-08-11  
> 類型：架構／產品規格（本 PR 僅文件，不導入 runtime dependency）  
> 關聯：PR #625 Agent Optimization Master Roadmap、AgentActivityHud、agentRunner、realtime、CreationAction / approval gates

## 為什麼要獨立成 PR-6

AI OS 現有代理主要擅長「站內可驗證工具」與背景 Runner；但大量創作工作發生在外部網站／外部 AI SaaS，例如生成圖片、影片、聲音、簡報、素材管理與其他第三方工作台。

若每個外部 AI 都直接做 API、模型清單、點數、金鑰、計價與供應商特化，AI OS 會快速承擔大量整合與維運成本。

PR-6 的方向是新增一層 **Computer Runtime**：

- 能以隔離的雲端 Browser / Desktop 幫使用者操作外部工作環境。
- 使用者可在 AI OS 內即時觀看、暫停、接管、交回 AI、停止。
- API / MCP / AI OS native tool 永遠優先；只有缺少可靠 API/DOM 能力時才退到 Computer Use。
- 外部生成成果可安全回收並掛回 AI OS 的 Project / Scene / Shot / Asset。
- 不讓 AI 直接碰使用者真實電腦作為第一階段方案。

---

## 一句話目標

> 使用者只要說「幫我去外部工具完成這個工作」，AI OS 自己選擇 Native Tool、Browser Runtime、Virtual Desktop 或 Human Takeover，並把結果帶回專案。

---

## 核心 UX

```text
使用者
  ↓
AI OS Agent
  ↓
Runtime Router
  ├─ Native Tool / API / MCP
  ├─ Virtual Browser
  ├─ Virtual Desktop
  └─ Human Takeover
        ↓
外部工作完成
        ↓
Artifact Ingestion
        ↓
AI OS Project / Scene / Shot / Asset
```

使用者不需要理解底層 provider，只看到一個「AI 工作電腦」：

```text
┌─────────────────────────────────────────────┐
│ AI 工作電腦                           ● LIVE │
├─────────────────────────────────────────────┤
│                                             │
│            [即時 Browser / Desktop]         │
│                                             │
│ AI 正在：上傳 Shot #08 首幀                │
│                                             │
├─────────────────────────────────────────────┤
│ 4 / 18 步 · 正在等待外部生成                │
│ [暫停 AI] [我來操作] [停止任務]             │
└─────────────────────────────────────────────┘
```

Human Takeover：

1. AI 遇到登入、2FA、敏感輸入、第三方阻擋或需要使用者判斷。
2. Runner 進入 `waiting_user_input` / 對應 waiting 狀態。
3. UI 顯示「需要你接管」。
4. 使用者取得 control lease，AI 的滑鼠／鍵盤動作立即凍結。
5. 使用者操作完成後按「交回 AI」。
6. AI 重新擷取可觀察狀態後繼續，不假設畫面仍停在原位置。

---

## 技術決策：四層執行優先級

任何任務都必須由 Runtime Router 依以下順序選擇執行方式：

1. **AI OS Native Tool / API / MCP** — 最可靠、最快、最可審計。
2. **DOM / Playwright Browser Automation** — 可用 selector、role、DOM state 驗證時使用。
3. **Vision Computer Use** — 只有無穩定 DOM、Canvas、特殊 GUI、桌面 App 等情境才使用 screenshot + mouse/keyboard。
4. **Human Takeover** — 登入、2FA、CAPTCHA、付款、條款、主觀判斷或自動化無法安全繼續時使用。

### 禁止

- 不得為了「看起來像真人操作」而刻意不用 API / DOM。
- 不得用脆弱 DOM click 來繞過既有 ACL / approval gate。
- 不得自動處理或繞過 CAPTCHA / anti-bot challenge。
- 不得自動接受第三方新條款、付款、購買、公開發布、永久刪除等高風險動作。

---

## Provider-agnostic 架構

PR-6 不把 AI OS 綁死在 E2B、Browserbase 或任何單一供應商。

```ts
export type ComputerRuntimeKind = "browser" | "desktop";

export interface ComputerRuntimeProvider {
  createSession(input: CreateComputerSessionInput): Promise<ComputerSessionHandle>;
  getSession(sessionId: string): Promise<ComputerSessionSnapshot>;
  pauseSession(sessionId: string): Promise<void>;
  resumeSession(sessionId: string): Promise<void>;
  terminateSession(sessionId: string): Promise<void>;
  getLiveView(sessionId: string): Promise<LiveViewDescriptor>;
  listArtifacts(sessionId: string): Promise<RuntimeArtifact[]>;
}

export interface BrowserRuntimeDriver {
  navigate(input: { sessionId: string; url: string }): Promise<ObservedResult>;
  inspect(input: { sessionId: string }): Promise<BrowserObservation>;
  act(input: BrowserAction): Promise<ObservedResult>;
}

export interface DesktopRuntimeDriver {
  screenshot(sessionId: string): Promise<DesktopScreenshot>;
  act(input: DesktopAction): Promise<ObservedResult>;
}
```

Provider adapter 第一階段可評估：

- Browser Runtime：Browserbase 或自架 Playwright worker。
- Desktop Runtime：E2B Desktop 或後續自架隔離 VM/container desktop。
- Vision action planner：必須包在 AI OS 自己的安全 policy / confirmation gate 後面；不可讓模型直接擁有無限制 I/O 權限。

### Provider capability references（截至 2026-08-11）

- E2B Computer Use：Linux desktop sandbox、screenshot、mouse/keyboard、VNC streaming  
  https://e2b.dev/docs/use-cases/computer-use
- Browserbase Session Live View：可嵌入、即時觀看／控制、human-in-the-loop  
  https://docs.browserbase.com/platform/browser/observability/session-live-view
- Browserbase Browser Session：可由 Playwright / Stagehand / Puppeteer / Selenium 連線  
  https://docs.browserbase.com/platform/browser/getting-started/using-browser-session
- Playwright：Chromium / Firefox / WebKit automation  
  https://playwright.dev/docs/browsers
- OpenAI Responses computer tool：提供 computer action / screenshot tool-call contract，可作 vision computer-use adapter  
  https://platform.openai.com/docs/api-reference/responses-streaming

上述是 adapter 候選，不是硬編碼產品依賴。

---

## Session 狀態機

Computer Session 與 Agent Run 分開持久化，但必須可互相關聯。

```text
requested
  ↓
provisioning
  ↓
ready
  ↓
agent_control
  ├─ paused
  ├─ waiting_human
  │     ↓
  │  human_control
  │     ↓
  │  agent_control
  ├─ importing_artifacts
  ↓
completed

任何非終態
  ├─ failed
  ├─ stopped
  └─ expired
```

### 重要語意

- `agent_control` 與 `human_control` **互斥**。
- 同一 session 永遠只有一個 active input lease。
- 使用者接管時 server 必須先 revoke agent lease，再回傳 human lease 成功。
- 「交回 AI」時 AI 必須重新 observe，不得從接管前的 screenshot 直接續動作。
- Stop 是高優先級控制訊號：必須取消 queued action、future navigation、download/import job 與 provider session。

---

## Control Lease 契約

避免 AI 與真人同時搶滑鼠／鍵盤。

```ts
export interface ComputerControlLease {
  sessionId: string;
  holder: "agent" | "human" | "none";
  holderUserId?: string;
  leaseVersion: number;
  acquiredAt: string;
  expiresAt?: string;
}
```

每個 mutable action 都要帶：

```ts
{
  sessionId,
  leaseVersion,
  actionId,
  expectedSessionRevision,
}
```

server 端若 lease/revision 不符：

- 回 `409 CONFLICT`。
- 不執行動作。
- client / agent 必須重新 observe。

---

## 建議資料模型

### `computer_sessions`

```text
id
run_id
step_id
project_id
group_id
user_id
runtime_kind            browser | desktop
provider                 provider adapter key
provider_session_ref     encrypted / opaque ref
status
control_holder
lease_version
session_revision
current_url              nullable / sanitized
current_app              nullable
started_at
last_activity_at
expires_at
ended_at
termination_reason
created_at
updated_at
```

### `computer_actions`

只保存可觀察／可審計資料，不保存私密 CoT。

```text
id
session_id
run_id
step_id
action_id                globally unique idempotency key
sequence
actor_type               agent | human | system
action_kind              navigate | click | type | key | scroll | drag | upload | download | wait | takeover | release
safe_target               sanitized semantic target
status                    requested | running | completed | failed | cancelled
risk_level                low | medium | high
approval_id               nullable
result_summary            sanitized
error_code                nullable
started_at
completed_at
```

敏感 typed text：

- 密碼、token、信用卡、OTP 等不得進 `safe_target` / action log。
- 若由使用者在 Live View 輸入，AI OS 只記錄「human sensitive input occurred」，不記內容。

### `computer_artifacts`

```text
id
session_id
project_id
source_url_sanitized
provider_file_ref
filename
mime_type
size_bytes
sha256
scan_status
import_status
asset_id
scene_id
shot_id
created_at
```

---

## Agent Plan / Step 整合

不建議一開始讓 planner 生成幾百個 `click(x,y)`。

Planner 只生成語意層 step：

```text
open_external_workspace
perform_browser_task
perform_desktop_task
wait_for_human_takeover
collect_external_artifacts
import_artifacts_to_project
```

Computer Runtime 內部再拆成 action loop。

### 示例

```json
{
  "kind": "perform_browser_task",
  "goal": "使用使用者已登入的外部影片工具生成 Shot #08",
  "projectId": "...",
  "targetSceneId": "...",
  "inputAssetIds": ["..."],
  "outputContract": {
    "artifactType": "video",
    "attachTo": "shot"
  },
  "requiresApproval": true
}
```

不要把 provider 名稱直接寫進 planner domain contract；provider 由 Runtime Router 決定。

---

## 外部網站登入／Credential 策略

### 第一階段：Human delegated login

最安全且最快落地：

1. 建立 Browser / Desktop Session。
2. 導航到外部服務。
3. 需要登入時切 `waiting_human`。
4. 使用者在 Live View 自己登入／2FA。
5. AI OS 不讀取或保存密碼內容。
6. 登入成功後交回 AI。

### 後續：Persisted Auth Context

如果 provider 支援持久 session/context，可新增：

- 使用者明確選擇「記住這個登入」。
- AI OS 只保存 encrypted opaque context reference。
- 不把第三方 raw cookie / token 暴露給 LLM。
- 使用者可在設定中 revoke。
- 需有最後使用時間、來源服務、scope、失效處理。

---

## Live View 安全規格

Live View URL 很可能本身具有控制能力，不應當普通 URL 任意傳給前端或 LLM。

AI OS 應提供：

```text
provider live view
      ↓
server-side session broker
      ↓
short-lived signed access token
      ↓
AI OS embedded viewer
```

要求：

- token 綁 userId / groupId / sessionId。
- 短 TTL。
- server 每次發 token 前重新檢查 ACL。
- takeover 權限與 read-only watch 權限分開。
- provider secret / API key 不到 browser client。
- session ended 後 live token 全部失效。

---

## 網路與網站安全邊界

Computer Runtime 本質上具備外部網路能力，必須視為高權限執行環境。

### 預設策略

- 預設 deny private network / metadata endpoints / localhost services。
- 防 SSRF：不得存取雲端 metadata IP、內網 CIDR、AI OS private service endpoints。
- URL scheme allowlist：`https:` 為主；特殊 scheme 額外核准。
- 可配置 domain allowlist / denylist。
- redirect 後重新驗證 destination。
- 外部下載先進 quarantine，不直接進專案資產庫。
- 檔案需驗 MIME、size、hash、malware scan，再 import。

### 第三方條款

每個 adapter / workflow 必須遵守第三方服務條款與允許的自動化方式。被服務拒絕、出現 CAPTCHA、條款頁或機器人驗證時應 fail-safe / human takeover，不設計繞過機制。

---

## 高風險操作 Confirmation Gate

即使使用者已核准整體 agent plan，下列外部動作仍需 step-up confirmation：

- 付款／購買／升級訂閱。
- 發送 email / 私訊 / 公開貼文。
- 公開發布影片／圖片／文章。
- 永久刪除第三方資料。
- 接受法律條款／授權。
- 修改帳戶安全設定。
- 下載或上傳高敏感檔案。
- 將資料分享給新的第三方 domain。

Computer Runtime 必須沿用 PR #625 的 approval / waiting / structured failure contract，不得自創繞過路徑。

---

## Artifact 回收流程

```text
外部生成完成
  ↓
Runtime 偵測候選 artifact
  ↓
下載到 quarantine
  ↓
MIME / size / sha256 / malware scan
  ↓
建立 computer_artifact
  ↓
寫入 AI OS object storage
  ↓
建立 Asset
  ↓
依 outputContract 掛回 Project / Scene / Shot
  ↓
agent event: artifact_imported
```

### 必須解決

- 重複下載不得產生重複資產：以 actionId + hash 做 idempotency。
- session 中斷後可重新掃描 provider download state，但不能重複扣點／重複 import。
- 所有 asset 都保留來源 provenance：`source = external_computer_runtime`、sessionId、provider/service label、import timestamp。

---

## 與 PR #625 Realtime / HUD 整合

Computer Runtime 不建立第二套進度系統。

沿用 agent event stream：

```text
computer:provisioning
computer:ready
computer:agent_control
computer:waiting_human
computer:human_control
computer:agent_control_restored
computer:action_started
computer:action_completed
computer:action_failed
computer:artifact_detected
computer:artifact_imported
computer:stopping
computer:stopped
computer:expired
```

共用 observable event payload：

```ts
{
  eventId,
  runId,
  stepId,
  projectId,
  eventType,
  status,
  sequence,
  occurredAt,
  summary,
  reason?: {
    code,
    category,
    userMessage,
    retryable,
    recommendedAction
  },
  computer?: {
    sessionId,
    runtimeKind,
    controlHolder,
    safeUrl,
    actionKind
  }
}
```

禁止放：

- raw password / token / cookie / OTP
- private model CoT
- full sensitive form contents
- provider API secrets

HUD 顯示例：

```text
AI 工作電腦 · Browser
正在外部影片工具生成 Shot #08
6 / 18 步
[觀看] [我來操作] [停止]
```

---

## Stop 語意

使用者按 Stop 後必須：

1. `run` 標記 stopping / stopped（依現有 contract）。
2. revoke agent/human input lease。
3. cancel 尚未送出的 action queue。
4. 阻止新的 download / upload / navigation。
5. 中止 artifact import job；已完成 atomic import 不反向破壞。
6. terminate provider session。
7. 寫 `computer:stopped` observable event。
8. UI 在有限時間內收到 stop acknowledgement。

provider terminate 失敗時：

- run 仍保持 stopped，不得讓 AI 繼續 action。
- 背景 cleanup retry 只做資源回收，不恢復任務。
- telemetry 記錄 leaked-session risk。

---

## Timeout / Cost Guard

虛擬瀏覽器／桌面是計時資源，不能無限掛著。

需要：

- session TTL。
- max idle duration。
- max wall-clock duration。
- max action count。
- max screenshot / model-loop count。
- max downloaded bytes。
- project / user concurrent session limit。
- provider cost telemetry。

到上限時：

- 可安全等待使用者 → `waiting_user_input` + 顯示延長選項。
- 無法安全等待 → stop + structured reason。

---

## Failure taxonomy

至少支援：

```text
COMPUTER_PROVISION_FAILED
COMPUTER_SESSION_EXPIRED
COMPUTER_SESSION_DISCONNECTED
COMPUTER_CONTROL_CONFLICT
COMPUTER_PROVIDER_RATE_LIMIT
COMPUTER_NAVIGATION_BLOCKED
COMPUTER_UNSAFE_DESTINATION
COMPUTER_LOGIN_REQUIRED
COMPUTER_HUMAN_TAKEOVER_REQUIRED
COMPUTER_CHALLENGE_REQUIRED
COMPUTER_ELEMENT_NOT_FOUND
COMPUTER_UI_CHANGED
COMPUTER_ACTION_TIMEOUT
COMPUTER_DOWNLOAD_FAILED
COMPUTER_UPLOAD_FAILED
COMPUTER_ARTIFACT_NOT_FOUND
COMPUTER_ARTIFACT_SCAN_FAILED
COMPUTER_IMPORT_FAILED
COMPUTER_STOP_CLEANUP_FAILED
```

每個 failure 都走 PR #625 structured `reason`，不能只丟 raw Error string 給 UI。

---

## Browser 與 Desktop 的分流規則

### 優先 Browser Runtime

適用：

- 第三方 AI SaaS。
- Canva / Notion / Drive 等 Web App。
- 可用 DOM / accessibility tree / Playwright 操作。
- 上傳／下載可以透過 browser API 完成。

### 升級 Virtual Desktop

只有以下需求才開 Desktop：

- 原生 Linux GUI app。
- 多個桌面程式互相拖拉／搬檔。
- 網頁高度依賴 Canvas 且 DOM automation 不可靠。
- 需要 OS file manager / clipboard / desktop-level interaction。

Runtime Router 必須記錄「為什麼從 browser 升級 desktop」的 observable reason，方便成本與可靠性分析。

---

## Human Interaction Safety

- 真人正在輸入、拖曳、選檔或處理 modal 時，agent action queue 必須 pause。
- takeover 不搶 focus。
- AI 不得偽造真人 cursor；若顯示 AI cursor，視覺必須明確標示 AI。
- human-control 狀態下不做背景 click/type。
- 使用者交回控制後，AI 必須重新 observe + validate task context。
- prefers-reduced-motion 時停用非必要 cursor 動畫／鏡頭追蹤。

---

## 隱私與資料保留

預設：

- Session ephemeral。
- screenshot 只在執行需要時短暫保留；是否持久化需獨立設定。
- action audit 留存 sanitized semantic summary，而不是完整畫面與輸入內容。
- recording 若供應商預設開啟，產品必須揭露並提供 retention policy；高敏感 workflow 可選擇停用或縮短保留。
- 使用者可刪除 persisted auth context / session history（依產品資料政策）。

---

## Implementation PR 拆分

PR-6 本文件不要一次做完所有層，建議拆：

### PR-6A — Browser Runtime Foundation（P0）

- `ComputerRuntimeProvider` shared contract。
- 第一個 Browser provider adapter。
- session create / stop / TTL。
- Live View watch-only。
- basic Playwright navigate / inspect / act。
- Agent run / event / HUD integration。
- 不做 persisted login。
- 不做 desktop。

### PR-6B — Human Takeover + Auth Delegation（P0/P1）

- control lease。
- watch ↔ human-control ↔ agent-control。
- sensitive input redaction。
- login / 2FA waiting flow。
- reconnect / stale lease recovery。

### PR-6C — Artifact Ingestion（P1）

- download quarantine。
- MIME/hash/scan。
- idempotent Asset import。
- Project / Scene / Shot mapping。
- provenance。

### PR-6D — Virtual Desktop + Vision Computer Use（P1/P2）

- Desktop provider adapter。
- screenshot / click / type / key / scroll / drag。
- vision action planner adapter。
- Browser → Desktop escalation。
- desktop live view。
- stricter cost / action-loop guard。

### PR-6E — Persisted Auth Context（P2，可選）

- explicit opt-in。
- encrypted opaque context refs。
- revoke UI。
- service-scoped reuse。
- security review 後才開。

---

## 建議程式位置

以下只是方向，實作前 coding agent 必須先盤點 repo 現況，不得盲目建立重複服務：

```text
shared/computerRuntime.ts
shared/computerEvents.ts
server/services/computerRuntime/
server/services/computerRuntime/provider.ts
server/services/computerRuntime/browserProvider.ts
server/services/computerRuntime/desktopProvider.ts
server/services/computerRuntime/policy.ts
server/services/computerRuntime/artifacts.ts
server/services/computerRuntime/controlLease.ts
server/routers/computerRuntime.ts
client/src/features/computer-runtime/
client/src/features/computer-runtime/ComputerLiveView.tsx
client/src/features/computer-runtime/ComputerRuntimeCard.tsx
```

如果現有 `agentRunner` / realtime / asset ingestion 已有可複用 service，優先擴充，不另造平行系統。

---

## Branch 規則

不要硬編碼假設 repo 有 `main`。

實作前先取得目前 GitHub default branch / durable integration branch，再切功能分支：

```bash
git fetch origin
# BASE_BRANCH 必須以當下 repo default branch / 維護中的 durable integration branch 為準
git checkout -b feat/agent-computer-runtime "origin/${BASE_BRANCH}"
```

本規格建立時（2026-08-11）repo default branch 為：

```text
claude/healing-migration-ai-os-erewp2
```

若未來 repository default branch 改名，文件不得迫使工程師使用已不存在的 ref。

---

## 測試矩陣

### Unit

- Runtime Router selection。
- policy allow/deny。
- state machine。
- control lease version / conflict。
- action idempotency。
- redaction。
- artifact dedupe。

### Integration

- provider session create / terminate。
- provider failure → structured reason。
- realtime ordering / duplicate event。
- stop during navigation。
- stop during download。
- stop during human takeover。
- expired session cleanup。

### E2E

1. 建立 browser session。
2. AI navigate 到測試網站。
3. UI 看到 live view。
4. user takeover。
5. agent input 被拒絕。
6. user release。
7. agent re-observe 後繼續。
8. 下載測試 artifact。
9. import 成 Asset。
10. Stop 後 provider session 終止。

### Security

- private IP / metadata SSRF。
- malicious redirect。
- forged live-view token。
- expired token。
- cross-group session access。
- action replay。
- stale lease。
- secret leakage in logs/events。
- malicious downloaded file。
- provider callback / URL injection。

### Multi-replica

- Agent action 在 replica A，takeover 在 replica B。
- stop 在 B，A 的 queued action 不得再執行。
- lease/version 必須透過 durable shared state 協調，不能只放 process memory。

---

## Feature Flags / Rollout

```text
computer_runtime_enabled
computer_browser_enabled
computer_human_takeover_enabled
computer_artifact_ingestion_enabled
computer_desktop_enabled
computer_persisted_auth_enabled
```

Rollout：

1. internal admin only。
2. allowlisted test group。
3. Browser watch-only。
4. Browser agent control。
5. Human takeover。
6. Artifact import。
7. Desktop pilot。
8. wider rollout。

任何階段可關閉 provider adapter，而不影響 AI OS 原有 native Agent Runner。

---

## Observability / SLO

至少量測：

- session provisioning p50 / p95。
- task success rate。
- browser → desktop escalation rate。
- human takeover rate。
- action retry rate。
- element-not-found / UI-changed rate。
- average session duration。
- provider cost / successful task。
- stop acknowledgement latency。
- leaked session cleanup count。
- artifact import success rate。
- clarification / takeover 後完成率。

第一版不要為了追求「100% 自動化」犧牲安全與成功率；Human Takeover 是正式能力，不是失敗。

---

## 驗收標準（PR-6A Foundation）

- [ ] 有 provider-agnostic shared contract，不讓 Agent domain 直接依賴特定 vendor SDK type。
- [ ] 可以建立一個隔離 Browser Runtime session。
- [ ] AI OS 能取得安全的 embedded Live View。
- [ ] Browser automation 優先使用 DOM / Playwright，而非 screenshot 點座標。
- [ ] session 與 run / project / user / group 正確綁定且 ACL fail-closed。
- [ ] 使用者可以跨頁看到 HUD 狀態與停止。
- [ ] Stop 能禁止後續 action 並終止 provider session。
- [ ] action/event 不記錄 password / token / cookie / OTP / CoT。
- [ ] TTL / idle timeout / concurrency / action loop guard 有測試。
- [ ] provider failure 映射 structured failure code。
- [ ] private network / metadata endpoint 被阻擋。
- [ ] feature flag 關閉時原 Agent 行為完全不變。
- [ ] old plan / old `agent_run` fixture 仍可讀可跑。
- [ ] multi-replica stop / lease 不依賴單 process memory。
- [ ] typecheck / unit / integration / security tests / build 通過。

---

## 明確不在 PR-6A 範圍

- 直接控制使用者本機 Windows / macOS。
- 自動處理 CAPTCHA。
- 自動輸入使用者密碼／OTP。
- 支付／購買自動核准。
- 任意網站 unrestricted browsing。
- persisted auth context。
- 完整 Desktop vision loop。
- 在 planner 中生成 pixel-level click plan。

---

## 最終產品定位

AI OS 的核心不是「內建最多 AI 模型」，而是成為創作工作的 orchestration layer：

```text
AI OS 內部能力
       +
使用者自己的外部工具 / 外部 AI 訂閱
       +
AI 工作電腦
       +
Human Takeover
       +
Project / Scene / Shot / Asset 回收
```

讓 AI 從「告訴使用者怎麼做」進一步變成「在受控、可觀看、可停止、可接管的隔離工作環境裡把工作完成」。
