# Aios Assistant Brain v2 — 修復契約

## 目標

修掉目前 AI 調度最核心的產品問題：**有能力、但理解錯、選錯工具、該執行時只回文字、尚未完成卻顯示完成。**

產品標準固定為：

`UNDERSTAND → GROUND → RESOLVE → ACT → VERIFY → CONTINUE`

而不是：

`keyword / regex → 猜功能 → 回文字`

Conversation is Home。Tools are Workers。Pages are Views。

---

## 已確認的 CURRENT HEAD 根因

### 1. Global Assistant 的預設模型路徑仍可能落到 NIM

`server/routers/globalAssistant.ts` 目前使用：

```ts
const qualityMode = input.mode ?? "nim";
```

而 `client/src/components/assistantStream.ts` 的 site-assistant SSE request 並沒有傳 `mode`。

結果：使用者以為 AI 調度是高品質總指揮，實際自然語言理解可能走免費 NIM。

### 2. Drive / File / Folder shortcut 依賴 `activeProjectId`

`AICreativeCopilot` 目前只有在 `activeProjectId` 存在時，才會把 Drive / file / folder intent 直接打開 Universal Intake mini workspace。

因此使用者在 Dashboard / 全站入口說：

> 從 Google Drive 選資料加入目前專案

如果 page context 沒有 projectId，就可能掉回普通問答，而不是補 project context 後執行。

### 3. WAITING 被誤標成 COMPLETED

Drive / File / Folder mini workspace 尚在等待使用者選來源時，Assistant message 仍可能被標成：

```ts
runStatus: "completed"
```

這造成 UI 顯示「Aios 已完成」，但實際只是在準備開始。

硬規則：

- 選 Project：WAITING_USER_INPUT
- 選 Drive/File：WAITING_USER_INPUT
- 等確認：WAITING_CONFIRMATION
- Tool 已開始：RUNNING
- Tool result + verification 成功：COMPLETED

### 4. Capability Registry 與 Global Assistant executable action surface 不一致

共用 Capability Registry 已有：

- `import_local_file`
- `import_url`
- `import_google_drive`
- `import_folder`
- `import_external_result`
- `attach_asset_to_project`
- `attach_asset_to_scene`
- `attach_asset_to_shot`
- `classify_asset`

但 Global Assistant 的 site action schema 仍只覆蓋部分動作，例如 `import_url`，造成「能力表說會、聊天主迴圈卻叫不到」。

硬規則：Capability Registry 必須成為 execution source of truth，不得另維護一份功能不完整的手寫 action 清單。

### 5. Regex classifier 只能是 Fast Hint，不能是最終語意

`shared/assistantExecution.ts` 的 `ASK / DIRECT / AGENT / PLAN / WATCH` 可以保留作低延遲 UX routing hint，但不能決定最後執行語意。

模糊、多輪、指代、修正語句必須進 semantic resolver。

---

## P0 — 必須完成

### A. Main Orchestrator

建立一個真正的「主理解層」。

優先使用高品質模型做：

- Goal understanding
- source / target resolution
- referent resolution
- missing slot detection
- capability selection
- completion decision

若 OpenAI MCP / GPT-5.6 路徑已配置，優先重用現有 bridge，不要建立第二套 OpenAI client。

背景大量生成、分類、Project Agent、Campaign 仍可使用既有模型策略；主 orchestrator 不等於所有工作都由最貴模型執行。

### B. GoalFrame

新增 typed + schema-validated GoalFrame，至少表達：

```ts
intent
operation
objectType
source
target
scope
referents
constraints
desiredOutcome
missingSlots
understandingConfidence
sourceConfidence
entityConfidence
capabilityConfidence
continuationOfGoalId
```

至少支援：

- QUERY
- EXECUTE
- CREATE
- IMPORT
- MODIFY
- ANALYZE
- ORGANIZE
- GENERATE
- CONTINUE
- CONFIRM
- CORRECT

以及：

- COUNT
- LIST
- FIND
- READ
- IMPORT
- ATTACH
- CREATE
- UPDATE
- GENERATE
- COMPARE
- VERIFY

### C. Active Conversation Goal

不能把每一則 user message 都視為新的 request。

需要保存 bounded active goal state：

```ts
goalId
status
goalFrame
resolvedSlots
missingSlots
lastAction
pendingQuestion
resultRefs
```

下列訊息優先判斷為 continuation / correction / confirmation：

- 對
- 不是那個
- 第二個
- 北藝那個
- 就是剛才那個
- 已經匯入了
- 不是 Drive，是 Photos
- 繼續
- 那就做
- 可以
- 這些 / 那批 / 剛才那些

### D. Working Project Resolution

「目前專案」不能只等於 page route projectId。

解析優先序：

1. 使用者明確指定 project
2. Active Goal project
3. recent verified action project
4. Assistant current working project
5. page context project
6. 唯一 ACL-filtered candidate
7. 多個候選 → Human-in-the-loop project picker

不得 silent substitute。

### E. Source Grounding

正式區分：

- REMOTE SOURCE
- IMPORTED ASSET
- CANONICAL LIBRARY RESOURCE
- PROJECT USAGE / CONTEXT BINDING

Source 至少辨識：

- AIOS_LIBRARY
- PROJECT_ASSETS
- GOOGLE_DRIVE
- GOOGLE_PHOTOS
- LOCAL_FILE
- LOCAL_FOLDER
- URL
- EXTERNAL_AI
- EXTERNAL_EDITOR
- UNKNOWN_CLOUD

「雲端」沒有 context 時不能自行等於 Project Asset Library。

### F. Evidence Scope

所有 factual answer，尤其 COUNT / LIST / EXISTS / IMPORTED，必須帶 evidence scope。

例如：

`64` 若來自 Project Asset Library，只能說：

> Aios 目前這個專案有 64 項素材。

不能說：

> Google Photos 裡有 64 項。

除非真的讀過 Google Photos remote listing。

若 provenance 能證明 42 項從該 Google Photos source 匯入，可說：

> Aios 可以確認其中 42 項是從這個 Google Photos 來源帶入。

### G. Capability Matcher

Goal resolved 後才匹配 Capability。

例如：

```text
COUNT + PROJECT_ASSETS
→ read_assets

COUNT + GOOGLE_PHOTOS_REMOTE
→ capability unavailable（若無 listing connector）

COUNT + IMPORTED_FROM_SOURCE
→ provenance query

IMPORT + GOOGLE_DRIVE + PROJECT
→ import_google_drive

ATTACH + ASSET_SET + SHOT
→ attach_asset_to_shot
```

不得因句子含「加入」就直接硬選 import。

### H. Capability Registry = Source of Truth

移除 / 收斂重複 action catalog。

Global Assistant 不應再維護一份與 `ASSISTANT_CAPABILITIES` 漂移的 capability surface。

至少讓以下 capability 真正可被主調度觸發：

- import_local_file
- import_url
- import_google_drive
- import_folder
- import_external_result
- attach_asset_to_project
- attach_asset_to_scene
- attach_asset_to_shot
- classify_asset
- prepare_external_generation
- prepare_editing_handoff

### I. Answer is not Success

只要 DesiredOutcome 需要 WRITE / IMPORT / CREATE / MODIFY / ATTACH / ORGANIZE / GENERATE：

**文字回答永遠不能讓 run = completed。**

必須拿到：

`real tool result + verification`

才能 COMPLETED。

### J. Waiting is not Success

修掉所有「等待使用者操作但 UI 顯示完成」的路徑。

尤其：

- Drive picker
- file picker
- folder picker
- project picker
- model picker
- confirmation
- permission
- login / takeover

### K. No Silent Substitution

硬性禁止：

- Google Photos remote count → Project asset count
- Firefly → fal.ai
- Scene 03 → current Scene
- remote source → imported copy
- user requested editor/provider → another provider

做不到就說做不到，並提供真實替代方式。

### L. Continue After Clarification

Human-in-the-loop 回答後必須：

- same goal
- same run where architecture allows
- update resolved slot
- resume current task

不能回：

> 好的，請再告訴我要做什麼。

---

## P0 Golden Flows

### Flow 1 — Drive without page project context

User：

> 從 Google Drive 選資料加入目前專案

Expected：

1. 解析為 IMPORT / GOOGLE_DRIVE
2. resolve working project
3. 若 project 不唯一 → Project Picker
4. 使用者選 project
5. 顯示「等待你選 Google Drive 資料」而非「已完成」
6. 開 Drive mini workspace
7. 選檔後 Universal Intake
8. verification
9. 回原 conversation：`✓ 已加入 N 項`

### Flow 2 — Cloud count ambiguity

User：

> 雲端內有多少素材？

沒有 active source：

Expected：問來源，不回答 Project Asset count。

### Flow 3 — Google Photos unsupported remote count

User：

> 這個 Google Photos 裡有多少素材？

如果目前沒有 Google Photos listing capability：

Expected：

> 我知道你要查的是 Google Photos 來源本身的素材數量，但目前無法直接驗證完整遠端清單。

可提供：

- 查看已匯入 Aios 的數量
- 選 Google Drive / file

不得假造 count。

### Flow 4 — Correction

Assistant：

> 你指 Google Drive 嗎？

User：

> 不是，是 Google Photos。

Expected：CORRECT active goal source，re-match capability，繼續原 goal。

### Flow 5 — Recent result referent

Previous verified result：64 imported assetIds。

User：

> 把這些整理一下。

Expected：resolve `這些` → typed recent result → `classify_asset` → job registered → verified status。

### Flow 6 — Attach recent assets

User：

> 把這些放到 Shot 3。

Expected：

recent assetIds + real Shot 3 → `attach_asset_to_shot` → read-back verification。

---

## UI 原則

### 禁止這句作為一般 fallback

> 我不太確定，可以換個問法再問一次。

改成：

> 我還缺一個資訊：你說的「目前專案」是指哪一個？

然後顯示 trusted backend options。

### 第一層只顯示可觀察理解，不顯示 CoT

可以顯示：

> 我理解你要做的是：從 Google Drive 選資料加入目前專案。

> 還缺：目標專案。

不能顯示 private reasoning。

### Completion card

只有 verified completion 才能顯示：

`Aios 已完成`

等待狀態要顯示：

- 等你選擇
- 等你確認
- 需要權限
- 正在處理

---

## 模型策略

主 orchestrator 必須可明確配置高品質模型，不得 silent default 到 NIM。

若 `OPENAI_API_KEY` / OpenAI MCP 已配置：

- 優先重用 `openaiMcpBridge`
- 不另造第二套 OpenAI Responses client
- 寫入仍走既有 MCP approval / ACL / audit

若 OpenAI 未配置：

- fallback 必須顯式且可觀測
- 不得讓 UI 誤以為正在使用高品質 orchestrator

背景 worker / generation / campaign 不需要全部改用同一模型。

---

## Telemetry

只記錄可公開稽核欄位：

- goal.intent
- goal.operation
- continuationType
- resolvedSourceType
- resolvedTargetType
- capabilityId
- missingSlotCount
- evidenceScope
- verificationStatus
- orchestratorProvider
- orchestratorModel
- fallbackOccurred

不要保存 chain-of-thought。

---

## Regression Tests

至少新增：

- assistantGoalFrame.test.ts
- assistantContinuation.test.ts
- assistantSourceGrounding.test.ts
- assistantCapabilityMatch.test.ts
- assistantCompletionSemantics.test.ts
- assistantWorkingProject.test.ts
- globalAssistant execution regression
- AICreativeCopilot waiting-state regression
- Universal Intake handoff regression

必測句子：

- 雲端有幾個？
- Drive 有幾個？
- Photos 有幾個？
- 這些有幾個？
- 不是 Drive
- 對
- 第二個
- 已經匯入了
- 那就整理
- 放到第三鏡
- 剛才那批
- 剛建立的專案
- 從 Google Drive 選資料加入目前專案

禁止用「再補十幾條 regex」通過測試。

---

## Validation

```bash
npm run typecheck
npm test
npm run test:client
npm run build
npm run check:boundaries
npm run check:ui-primitives
npm run check:hooks
npm run db:check
```

若有 migration：

- additive only
- 使用 CURRENT 下一號
- fresh PostgreSQL 全 migrations
- schema drift none

最後真實 UI 跑 mobile 390×844 與 desktop 1280×900。

---

## Done Definition

只有以下全部成立，這個 PR 才能離開 Draft：

- [ ] 「從 Google Drive 選資料加入目前專案」不再只回文字
- [ ] 沒有 project context 時會正確補問 project
- [ ] Drive/File/Folder picker 不再顯示「已完成」
- [ ] verified tool result 前不得顯示 COMPLETED
- [ ] Capability Registry 與 executable tool surface 不再漂移
- [ ] 「雲端」不明時不亂猜來源
- [ ] Google Photos remote / imported count 明確分開
- [ ] 「對 / 不是 / 第二個 / 這些」能承接 active goal
- [ ] correction 會修改原 goal，不建立無關新任務
- [ ] recent typed result 可直接成為下一個 action 的 input
- [ ] 有 Tool 就真的執行，不只提供教學
- [ ] 做不到時說清楚 capability boundary，不 silent substitute
- [ ] Conversation 持續保留，不因 action 自動跳頁
- [ ] 手機 UI 不再出現誤導性的完成卡
- [ ] 所有 tests / build / guards 通過
