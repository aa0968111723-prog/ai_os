# Agent Visual Reliability & Execution Plan (P0)

> 狀態：Proposed  
> 日期：2026-08-11  
> 相關：`docs/TRUE_AGENT_ROADMAP.md`、`docs/AI_AGENT_CAPABILITY_GAP_AUDIT.md`、`docs/AI代理架構與維運.md`、`docs/AGENT_WORKBENCH_UPGRADE.md`

## 目標

解決兩個核心體感問題：
1. **視覺化不足** — 使用者感覺不到 AI 正在執行
2. **提示詞有時無法真正執行** — 規劃後因 missingInformation / 未知引用 / 失敗解釋不足而卡住或失敗，缺少可行動修復路徑

本文件是 **P0 可交付 PR 的執行規格**，可直接交給終端機或 coding agent 實作；本版補上可執行 predicate、AgentQuestion 契約、持久化狀態轉移、failure/event schema 與 backward compatibility。

---

## PR 序列總覽

| 順序 | 分支建議 | 標題 | 優先級 |
|------|----------|------|--------|
| **PR-1** | `feat/agent-failure-clarification-hud` | feat(agent): failure explanation + forced clarification + safe replan + HUD polish | **P0** |
| PR-2 | `feat/agent-realtime-ux-hardening` | feat(agent): realtime agent UX hardening | P0/P1 |
| PR-3 | `feat/agent-dag-canvas` | feat(agent-ui): interactive DAG canvas + step detail | P1 |
| PR-4 | `feat/agent-edit-step-kinds` | feat(agent): expand edit step kinds (reorder / update / trim) | P1 |
| PR-5 | `feat/agent-theater-mode` | feat(agent): theater mode (reveal / flash / goTo + synthetic cursor) | P2 |

---

## PR-1 詳細執行規格（本 PR 範圍）

### 終端機指令

> Implementation branch 必須從長期存在的主線 ref 建立；不要依賴可能被刪除的暫時 `claude/*` branch。

```bash
git fetch origin
git checkout -b feat/agent-failure-clarification-hud origin/main

# 先確認 baseline；若 main 本身不綠，先記錄既有 failure，避免把舊錯誤算成本 PR 回歸
npm run typecheck
npm test
npm run test:client:coverage
npm run build
npm run audit:high
```

### 範圍

**要做：**
- 規劃結果符合下方 forced-clarification predicate 時，**強制進入 AgentQuestion 澄清**，不直接給殘缺計畫核准。
- 澄清答案若會改變 plan / references / execution target，必須 **replan → awaiting_approval**，不得回答後直接續跑舊 plan。
- 步驟 / run 失敗時，UI 顯示**結構化失敗說明卡**（原因 + 建議 + 一鍵帶原因重新規劃）。
- `AgentActivityHud` 強化：清楚顯示 waiting 類型、卡點與建議，保留緊急停止。
- 前後端、polling、realtime、persisted event 使用同一份 observable contract。

**不做：**
- Theater Mode、DAG 畫布、新 step kinds、白板。
- 不重做已存在的 realtime broadcast。
- 不把 planning clarification 硬塞進「執行中 step question」的舊 resume 行為；兩者 lifecycle 必須明確分流。

---

## Forced Clarification：可執行判定契約

### 1. Planner output 必須產生可機器判定的 issue

新增或正規化為共享型別（名稱可依既有 schema 調整，但語義不可漂移）：

```ts
type PlanningIssueCode =
  | "missing_required_field"
  | "unresolved_reference"
  | "ambiguous_reference"
  | "ambiguous_date_time"
  | "permission_required"
  | "destructive_scope_unclear"
  | "cost_confirmation_required"
  | "unsupported_step_kind";

interface PlanningIssue {
  code: PlanningIssueCode;
  field?: string;
  reference?: string;
  userMessage: string;
  blocking: boolean;
  candidates?: Array<{ id: string; label: string }>;
}
```

### 2. 強制澄清 predicate

```ts
needsForcedClarification = planningIssues.some((issue) => issue.blocking === true)
```

以下情況 **blocking = true**：

| Case | 判定 | 行為 |
|------|------|------|
| 必填欄位缺失 | 執行該 step 所需 project / scene / shot / asset / model 等沒有值，且無安全唯一預設 | 問使用者 |
| 未知引用 | 使用者點名的 entity 在 ACL 範圍內查不到 | 問使用者或提供重新選擇，不猜 |
| 多重引用 | Resolver 得到 2+ 合理候選，無唯一可信匹配 | `entity_picker` / 對應 picker |
| 模糊日期時間 | 動作依賴具體日期時間，但文字只有「明天晚上」「下週」且時區／日界會影響結果 | `date` / text 澄清 |
| 權限不足 | 需要重新登入、額外 scope 或更高權限 | `waiting_permission` |
| 破壞範圍不清 | remove / overwrite / reorder 等操作的 target set 不能唯一決定 | confirm / picker |
| 成本確認必要 | 動作會扣點且現有產品規則要求明確確認 | confirm / model_choice |
| 不支援 step kind | planner 產生 Runner 不支援的 kind | 不得核准；重新規劃或明確失敗 |

以下通常 **blocking = false**：
- 純顯示文案可以用安全 fallback
- 可由 trusted resolver 唯一決定的 entity
- 不影響 side effect 的風格偏好缺省值

不得使用自由文字「看起來資訊不足」作為唯一判定；判定要來自可測試的 issue code / resolver result。

---

## Planning-time AgentQuestion 契約

沿用現有 `shared/agentQuestions.ts` 的 `AgentQuestionDefinition`：

```ts
interface AgentQuestionDefinition {
  questionType: AgentQuestionType;
  title: string;
  description: string;
  required: boolean;
  options: AgentQuestionOption[];
  allowCustom: boolean;
  defaultOption?: string;
  context: {
    reason: string;
    slot?: AgentContextSlotName;
    entityType?: "project" | "scene" | "shot" | "person" | "asset" | "model";
    candidateCount?: number;
    currentUrl?: string;
    highRisk?: boolean;
    requiresLogin?: boolean;
    allowAgentDecision?: boolean;
    facts?: string[];
  };
}
```

### Payload 例 1：多個場景候選

```ts
{
  questionType: "scene_picker",
  title: "你要修改哪一個場景？",
  description: "我找到兩個可能符合『咖啡店那一幕』的場景，需要你選一個後才能安全規劃。",
  required: true,
  allowCustom: false,
  options: [
    { id: "scene-a", label: "SCENE 03・午後咖啡店" },
    { id: "scene-b", label: "SCENE 08・雨夜咖啡店" }
  ],
  context: {
    reason: "場景引用有多個候選",
    slot: "sceneId",
    entityType: "scene",
    candidateCount: 2,
    facts: ["不會在你選擇前修改任何場景"]
  }
}
```

### Payload 例 2：模糊日期

```ts
{
  questionType: "date",
  title: "請確認要使用的日期",
  description: "『下週五』會影響排程結果，請指定確切日期。",
  required: true,
  allowCustom: true,
  options: [],
  context: {
    reason: "日期無法唯一決定",
    facts: ["會以使用者時區解析"]
  }
}
```

---

## 澄清狀態機：禁止跳過 approval

### 現況約束

現有 `suspendAgentRunForQuestion` 只接受 `running` / `waiting` run，而 `answerAgentQuestion` 的既有執行中問答路徑會把可繼續的 run 恢復成 `running`。這適合 **runtime step question**，但不適合 **planning-time missingInformation**。

因此 PR-1 必須明確拆成兩條 lifecycle：

### A. Runtime step question（既有語義）

`running → waiting_* → answer → running / stopped`

保留現有行為。

### B. Planning-time clarification（本 PR 新增）

`planning → needs_clarification → waiting_* → answer_received → replanning → awaiting_approval → approve → running`

規則：
1. Planning-time clarification **不得呼叫會要求 run 已是 running/waiting 的 suspend path**。
2. 建立 question 時，run 必須持久化為既有 waiting status 之一：
   - `waiting_user_input`
   - `waiting_confirmation`
   - `waiting_permission`
3. question / planning issue 要能標記 `phase = planning`（可放在安全 data/context 或明確 schema），使 answer handler 能分流。
4. planning answer 完成後，**重新執行 planner / reference resolver**，建立全新的 corrected plan。
5. corrected plan 必須回到 `awaiting_approval`；不得直接 `running`。
6. 舊的 incomplete steps 不得被偷偷 resume；需要以新 plan 取代或 version 化保存。
7. replan 仍有 blocking issue 時再次出 question，但要有最大輪數 / cycle guard，避免無限追問。

建議 guard：同一 run planning clarification 最多 3 輪；超過則轉成結構化 failed / manual intervention，不可無限燒 token。

---

## Run status 與 HUD mapping

不要新增第二套 persisted status。沿用現有：

```text
waiting_user_input
waiting_confirmation
waiting_permission
awaiting_approval
running
...
```

Presentation layer 可統一：

| Persisted status | HUD 標籤 | CTA |
|---|---|---|
| `waiting_user_input` | 等你補充 | 回答 |
| `waiting_confirmation` | 等你確認 | 確認 |
| `waiting_permission` | 需要權限 | 處理權限 |
| `awaiting_approval` | 待你過目 | 檢視計畫 |
| `running` | 執行中 | 查看進度 |

若 `agentOverview` 目前只暴露舊的粗粒度 `waiting`，必須明確決定：
- 要嘛 overview 正規化所有 `waiting_* → waiting`，並另外提供 `waitingReason / waitingKind`；
- 要嘛 overview 直接傳原始 waiting status，HUD 全面支援。

不可出現 backend persist `waiting_user_input` 但 HUD 只 filter `waiting` 而整個 run 消失的情況。

---

## Structured Failure / Event Contract

### Failure reason

```ts
type AgentFailureCategory =
  | "missing_input"
  | "reference"
  | "permission"
  | "quota"
  | "dependency"
  | "conflict"
  | "upstream"
  | "validation"
  | "unknown";

interface AgentFailureReason {
  code: string;
  category: AgentFailureCategory;
  userMessage: string;
  retryable: boolean;
  recommendedAction?: "answer" | "replan" | "retry" | "request_permission" | "add_quota" | "contact_support";
  sourceRef?: string;
}
```

### Event payload

新增 event type 時沿用既有 agentEvents table / eventKey idempotency 模式；至少定義：

```ts
interface AgentObservableEventData {
  schemaVersion: 1;
  runId: string;
  stepId?: string;
  projectId: string;
  reason?: AgentFailureReason;
  questionId?: string;
  phase?: "planning" | "execution";
  sequence?: number;
}
```

建議事件：
- `run_needs_clarification`
- `planning_question_answered`
- `run_replanned_after_clarification`
- `step_failed_explained`
- `run_failed_explained`

event name 可配合現有命名慣例調整，但 producer / persisted event / polling DTO / realtime consumer / UI test 必須一起更新。

### `AgentDagProgress.reason: string` 對應規則

- structured `reason` 是 source of truth。
- `AgentDagProgress.reason` 只存 / 顯示 `reason.userMessage` 的安全摘要。
- 舊資料只有 string 時：UI 仍顯示 string，category = `unknown`，不可嘗試從自由文字反推權限／額度等安全結論。

---

## 建議修改檔案

| 檔案 | 改動方向 |
|------|----------|
| `shared/agentQuestions.ts` | planning issue / phase 若需要共享型別，沿用現有 AgentQuestionDefinition，不另造第二套 question schema |
| `server/services/agentPlanning.ts` | 產生 machine-readable planning issues + forced-clarification predicate |
| `server/services/agentCore.ts` | planning-time question 建立、replan、回 `awaiting_approval`；失敗寫 structured error/event |
| `server/services/agentQuestionCore.ts` | 保留 runtime resume；新增或分流 planning answer path，禁止 planning answer 直接回 running |
| `client/src/components/AgentCard.tsx` | 失敗解釋卡；active planning question 優先顯示澄清 UI |
| `client/src/components/AgentQuestionCard.tsx` | 支援 planning phase 文案與答完後「重新規劃中／待核准」狀態 |
| `client/src/app/components/AgentActivityHud.tsx` | 支援所有 waiting_* 或明確 normalized waiting DTO |
| `shared/agentEvents.ts` / event core | structured reason / event payload 契約；不記錄 CoT |
| team assistant overview / polling DTO | 保證 clarification run 不會因 status filter 消失 |

---

## 行為紅線

- 不保存、不展示模型私密 chain-of-thought。
- 花點數／改資料的動作仍須使用者確認。
- planning clarification 回答後不得跳過 approval。
- 失敗解釋只放 observable、結構化原因（kind、依賴、引用失敗、權限、點數等）。
- 任何 candidate 都必須來自 ACL-filtered trusted resolver；不能把 LLM 猜的 ID 當 option。
- unknown status / event / step kind fail-closed。
- 前後端契約不漂移。
- 手機 390px 可用。

---

## Backward compatibility / rollout

### Feature flag

建議以單一 server-side flag 控制 planning forced clarification，例如 `AGENT_PLANNING_CLARIFICATION_V1`（實際命名依專案慣例）。關閉時回到舊 planning 行為；**但不能關掉既有安全確認門檻**。

### 舊資料 fixture

至少新增：
- pre-change plan fixture：沒有 `planningIssues` / structured reason
- pre-change `agent_run` fixture：只有舊 status / string reason
- pre-change event fixture：沒有 `schemaVersion`

驗證：新 server / 新 UI 仍可讀、可顯示、可跑支援中的 lifecycle。

### Multi-replica / rollback

- 新舊 replica 同時存在時，event consumer 遇到未知欄位要忽略額外欄位，不崩潰。
- planning question answer / replan 必須有 advisory lock / revision guard / idempotency，避免兩個 replica 重複重規劃。
- rollback 後舊 binary 至少能忽略新增 event data，不可因 schema 擴充讀不回 run。

---

## 驗收標準

- [ ] 每種 blocking planning issue 都有 unit test：missing field / unknown ref / ambiguous ref / ambiguous date / permission / destructive scope / cost / unsupported kind。
- [ ] 非 blocking issue 不會無謂追問。
- [ ] planning clarification 會建立合法 `AgentQuestionDefinition`，options 來自 trusted resolver。
- [ ] planning run 進入既有 `waiting_*` status，HUD / overview 仍可見。
- [ ] 回答 planning question 後會 **replan → awaiting_approval**，不會直接 running。
- [ ] runtime step question 的既有 `waiting_* → running` 行為不被破壞。
- [ ] 步驟／run 失敗時 AgentCard 顯示 structured reason + 建議 +「帶此原因重新規劃」。
- [ ] 舊只有 `reason: string` 的資料仍能安全顯示。
- [ ] clarification cycle guard 生效，不會無限追問。
- [ ] stop 在 waiting / replanning / awaiting_approval 都可用。
- [ ] pre-change plan + pre-change agent_run fixture 通過。
- [ ] feature flag off 能安全回退。
- [ ] typecheck / test / client coverage / build / audit:high 通過；若 baseline 原本失敗，PR body 明確列出 baseline failure 與本 PR 無新增 regression 證據。

---

## 建議 PR 標題與 Body

**標題**

```text
feat(agent): failure explanation + forced clarification + safe replan + HUD polish
```

**Body**

````markdown
## 問題
使用者有時覺得代理「聽不懂」或「規劃了卻無法真正執行」。常見原因是：
- 規劃結果含 blocking missing information / 未知引用 / 日期模糊，卻仍直接進入待核准
- planning-time question 與 runtime question lifecycle 混在一起，容易回答後跳過重新核准
- 失敗時只有籠統錯誤，缺少可行動的解釋與修復路徑
- 跨頁時難以知道目前卡在哪、為什麼在等

## 範圍
- machine-readable planning issues + forced clarification predicate
- planning clarification：answer → replan → awaiting_approval
- structured failure/event contract
- AgentCard / AgentQuestionCard / AgentActivityHud waiting UX
- old plan / old run backward compatibility

## 不在範圍
- Theater mode、DAG 畫布、新 step kinds、白板
- 不重做 realtime broadcast

## 行為不變證據
- runtime question 既有 resume semantics 保留
- 正常可執行計畫仍走 planning → awaiting_approval → approve → Runner
- 不新增自動寫入；確認門檻維持
- 事件仍不記錄 CoT / 完整 prompt

## 驗證

```bash
npm run typecheck
npm test
npm run test:client:coverage
npm run build
npm run audit:high
```

## 相關
- docs/product/agent-visual-reliability-p0-plan.md
- docs/product/agent-optimization-master-roadmap.md
- docs/AI_AGENT_CAPABILITY_GAP_AUDIT.md
- docs/TRUE_AGENT_ROADMAP.md
````

---

## 後續 PR 簡要

- **PR-2**：不是重做 broadcast；強化既有 realtime 的 sequence、stale event drop、reconnect recovery、push/poll merge、latency telemetry。
- **PR-3**：`shared/agentDag.ts` 做成互動畫布，加入 large-DAG / invalid-DAG / accessibility fallback。
- **PR-4**：嚴格依架構文件擴充 reorder / update，加入 revision / conflict / idempotency / rollback。
- **PR-5**：reveal / flashAnchor / goTo + 可選合成游標 + 全域急停；不得搶焦點或干擾真人操作。

---

## 設計原則提醒

1. 可驗證動作優先，拒絕黑盒 CoT。
2. 使用者主權：隨時可停，高風險寫入需確認。
3. 成本意識：多輪澄清需可量測並有 cycle guard。
4. 向後相容：舊計畫與既有 agent_runs 繼續可讀可跑。
5. 測量驅動：記錄「提示詞 → 澄清 → replan → approval → 最終成功」完整漏斗。
