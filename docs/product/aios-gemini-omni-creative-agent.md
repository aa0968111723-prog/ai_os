# Aios × Gemini Omni 多模態創作代理 — Implementation Contract

> Status: IMPLEMENTATION_REQUIRED
> Date: 2026-08-13
> Branch: `feat/aios-gemini-omni-creative-agent`
> Base: `claude/healing-migration-ai-os-erewp2`
> Delivery: **只在本 PR 持續實作；不要另開 PR、不要 auto-merge、不要 force-push。**

## 0. 任務目標

把目前偏「聊天 + 固定快捷功能」的 Aios，升級成真正可執行的 **multimodal creative agent**。

使用者不應該需要知道模型 ID、API、prompt 格式或工具名稱。使用者只要用自然語言說：

- 「把這個故事做成第一幕分鏡」
- 「把剩下 5 張分鏡補完」
- 「第三鏡角色長得不一致，幫我修掉」
- 「把這張分鏡做成影片」
- 「延續上一個工作，把第一幕做完」

Aios 必須能：

1. 讀目前頁面與 project context。
2. 讀故事、角色、分鏡、素材、生成紀錄、必要的自訂資料庫。
3. 拆解多步任務並選擇正確工具。
4. 依能力選 Gemini reasoning / Gemini Image / Gemini Omni 或既有 provider。
5. 實際建立／修改分鏡與生成素材。
6. 將成品寫回既有 project / scene / asset / generation 資料模型。
7. 做 read-back verification，只有真的完成才顯示完成。
8. 長任務可續跑、可查進度、可停止、可重試且不重複扣款／重複寫入。
9. UI 顯示「目前頁面下 Aios 真正能直接幫你做什麼」，而不是固定功能清單。

本 PR 不接受「只有 Gemini API demo」、「只多一個 Gemini 按鈕」、「只回傳 prompt」、「只寫 docs」作為完成。

---

## 1. 現有架構必須重用

先完整盤點 CURRENT HEAD，再動手。至少要讀：

- `server/routers/assistant.ts`
- `server/routers/globalAssistant.ts`
- `server/services/assistantCore.ts`
- `server/services/agentCore.ts`
- `server/services/agentRunner.ts`
- `server/services/llmProvider.ts`
- `server/services/generationCommand.ts`
- `server/services/generationCore.ts`
- `server/services/mcp.ts`
- `server/services/mcpWriteExpansion.ts`
- `server/services/storage.ts`
- `shared/assistantCapabilityRegistry.ts`
- `shared/assistantCapabilityMaturity.ts`
- `shared/assistantExecution.ts`
- `shared/assistantPageContext.ts`
- `shared/mcpCatalog.ts`
- `shared/modelBase.ts`
- `shared/models.ts`
- `shared/externalTools.ts`
- `docs/product/aios-agent-long-running-tasks.md`
- `docs/AI_AGENT_CAPABILITY_GAP_AUDIT.md`

另外先檢查 open PR #706 的實際 changed files，避免同時重寫 Agent × DB 深度整合區塊。若有衝突：

- 不要複製 #706 的 database runtime。
- 以 adapter / interface 方式接既有能力。
- 在 PR body 記錄 dependency / conflict risk。
- 不得為了避衝突偷偷建立第二套資料庫權限或 Agent runtime。

### 禁止重做

不得另外再造：

- 第二套 Agent runner
- 第二套 project ACL
- 第二套 generation ledger
- 第二套 asset storage
- 第二套點數／billing
- 第二套 MCP registry
- 第二套 scene/storyboard domain model
- 第二套 long-running task DB

Gemini 必須接進既有系統，而不是旁邊蓋一個平行產品。

---

## 2. 正確總架構

```text
User
  ↓
Aios Assistant / Agent
  ↓
Page + Project Context
  ↓
Intent / Planner / Orchestrator
  ↓
Capability Registry
  ↓
Creative Tool Layer
  ├─ project.read
  ├─ storyboard.plan
  ├─ storyboard.create
  ├─ storyboard.update
  ├─ media.analyze
  ├─ image.generate
  ├─ image.edit
  ├─ video.generate
  ├─ video.edit
  ├─ asset.attach_to_shot
  ├─ generation.status
  └─ project.verify
       ↓
Provider Router
  ├─ Gemini reasoning
  ├─ Gemini 3.1 Flash Image
  ├─ Gemini Omni Flash (preview)
  ├─ existing fal.ai providers
  ├─ existing NVIDIA NIM
  └─ future providers
       ↓
Existing generation / storage / ledger / DB
```

**Aios 是總控。Gemini 是 provider，不是產品主架構。**

---

## 3. Gemini Provider Layer

新增清楚、可替換的 provider adapter。建議路徑（可依 CURRENT HEAD 微調，但責任必須分離）：

```text
server/services/ai/providers/gemini/
  config.ts
  interactionsClient.ts
  image.ts
  omni.ts
  types.ts
  errors.ts
```

若 repo 已有更適合的 provider 目錄，沿用既有 convention，不要為了符合本文件硬搬檔案。

### 3.1 Secrets / config

後端 env：

```text
GEMINI_API_KEY=
GEMINI_IMAGE_MODEL=gemini-3.1-flash-image
GEMINI_OMNI_MODEL=gemini-omni-flash-preview
GEMINI_CREATIVE_ENABLED=0
```

要求：

- API key 永遠不得出現在 client bundle、tRPC response、logs、trace payload。
- `GEMINI_CREATIVE_ENABLED` 預設關閉；沒有 key 時 capability 必須 truthful degrade。
- model id 必須 env-overridable，不得散落 hardcode。
- Omni 是 preview，UI / capability maturity 必須標示 preview / external dependency，不得假裝 GA。

### 3.2 API surface

Gemini provider 至少要提供：

```ts
interface GeminiCreativeProvider {
  generateImage(input: GenerateImageInput): Promise<CreativeMediaResult>;
  editImage(input: EditImageInput): Promise<CreativeMediaResult>;
  generateVideo(input: GenerateVideoInput): Promise<CreativeMediaResult>;
  editVideo(input: EditVideoInput): Promise<CreativeMediaResult>;
}
```

必要欄位至少包含：

- prompt
- aspect ratio
- optional reference images
- optional source video / previous interaction id（影片編輯）
- project / user audit context（不可送敏感不必要資訊給 provider）
- cancellation signal / timeout
- provider interaction id
- model id
- output mime type
- output bytes / safe temporary representation
- provider usage metadata（若 API 有回）

禁止把 base64 成品直接永久塞進 DB JSON。

### 3.3 官方 API 現況（2026-08-13）

實作前重新確認 Google 官方文件；目前基準：

- Gemini Image stable: `gemini-3.1-flash-image`
- Gemini Omni preview: `gemini-omni-flash-preview`
- 兩者走 Gemini Interactions API
- Gemini Image 可做 image generation / editing
- Omni 可做 text/image → video，並用 `previous_interaction_id` 做 conversational video editing
- Omni 目前是 preview，輸出為短影片；不得把它當永久唯一影片 backend

Primary docs:

- https://ai.google.dev/gemini-api/docs/image-generation
- https://ai.google.dev/gemini-api/docs/omni
- https://ai.google.dev/gemini-api/docs/video
- https://ai.google.dev/gemini-api/docs/pricing

如果官方 API 已變，依當天官方文件更新 adapter；不要憑記憶猜 schema。

---

## 4. 不要讓 Assistant 直接呼叫 Provider

錯誤：

```text
assistant.ts → fetch Gemini → 回 base64
```

正確：

```text
assistant/agent → capability/tool → generation command/job
→ provider router → Gemini
→ storage → generation record → asset
→ optional scene binding → verification receipt
```

所有 side effect 必須走既有 ACL、billing、idempotency、audit、asset storage。

---

## 5. Creative Tool Layer

在既有 MCP / Agent capability single source of truth 擴充，而不是寫死在 UI。

至少需要下列「語意能力」，實際 tool name 可遵循現有命名 convention：

### Read / analysis

- `analyze_creative_context`
- `analyze_media`
- `get_storyboard_gaps`
- `get_character_references`

### Storyboard writes

- `plan_storyboard`
- `create_storyboard_shots`
- `update_storyboard_shot`

### Generation writes

- `generate_storyboard_image`
- `edit_storyboard_image`
- `generate_shot_video`
- `edit_shot_video`
- `attach_generated_asset_to_shot`

### Verification

- `verify_storyboard_shot`
- `verify_generation_attachment`

若現有 tool 已能完成相同事情，就**重用／擴充現有 tool**，不要因名稱不同重造。

### 工具規則

每個 write tool 都必須：

1. re-resolve current user identity
2. re-check group / project ACL
3. validate scene belongs to project
4. validate source asset belongs to visible scope
5. validate model/provider is currently available
6. estimate / reserve cost via existing billing flow
7. use idempotency key
8. write audit / trace
9. execute side effect
10. read back persisted result
11. return an execution receipt

不得只因 provider HTTP 200 就宣稱「完成」。

---

## 6. Storyboard Agent：第一條真正端到端 Golden Flow

必須先打通這條，不要先做 40 個散功能。

### 使用者

> 幫我把這個故事做成第一幕分鏡。

### Aios 應執行

```text
1. resolve current page/project
2. get project status
3. read relevant story/script knowledge
4. read character / scene references
5. inspect existing storyboard (avoid duplicate shots)
6. produce structured storyboard plan
7. ask only for genuinely missing blocking input
8. create shots through existing scene write path
9. generate one image per selected shot through Gemini Image
10. persist each generation + asset in existing stores
11. attach generated asset to correct shot
12. read back shot + asset
13. retry bounded failed generations (no duplicate billing)
14. return truthful summary:
    - created N shots
    - generated M images
    - failed K
    - waiting W
    - exact next action
```

### Structured shot contract

Planner output不得用 free-form paragraph 當資料層。至少：

```ts
interface PlannedShot {
  ordinal: number;
  title: string;
  durationSec?: number;
  voiceover?: string;
  visualDescription: string;
  camera?: {
    shotSize?: string;
    angle?: string;
    movement?: string;
  };
  characters?: string[];
  referenceAssetIds?: string[];
  generationPrompt: string;
}
```

欄位需映射回既有 `shared/story.ts` / scene schema，不得另造不相容 storyboard DB。

---

## 7. Character / Scene Consistency

第二個 Golden Flow：

> 第 8 鏡角色跟前面長得不一樣，幫我修掉。

Aios 必須：

1. resolve target shot #8
2. read current shot image
3. find character master references / strongest recent verified references
4. preserve requested composition unless user asked to change
5. call image edit/regeneration with references
6. create new asset version; do not silently destroy old asset
7. attach new version to shot
8. read back
9. mark previous version recoverable / retain lineage according to existing asset design
10. report what changed

若目前資料模型沒有 master reference 概念：

- 先優先重用既有 asset metadata / project decision / database references。
- 需要 migration 時才新增最小欄位／table；不可大爆炸式重構 schema。

---

## 8. Gemini Omni：Shot → Video

第三個 Golden Flow：

> 把第三鏡做成影片。

流程：

```text
resolve scene #3
→ require verified image or sufficient prompt
→ collect character/scene refs
→ create generation job
→ Gemini Omni generate video
→ store output in existing object storage
→ create generation record + asset
→ attach to scene visual slot using existing binding semantics
→ read back
→ receipt
```

### Conversational edit

> 第三鏡鏡頭靠近一點，角色不要笑，其他不要變。

若上一支影片有可用 Gemini interaction id，優先使用 Omni conversational editing；interaction id 應存在 generation metadata / provider metadata，不能只活在 request memory。

若 interaction id 不可用，降級為 reference-based regeneration，且 UI 誠實標示「重新生成」而不是「原片編輯」。

---

## 9. 長任務 / Job / Retry

影片生成、批次 storyboard generation 都不得把整個生命週期綁在一個 HTTP request。

重用現有 durable agent runner / generation runtime。

要求：

- queued / running / done / failed / awaiting_approval / stopped 等既有狀態一致化
- crash / reconnect 後可查狀態
- bounded retry
- provider 429/5xx 有 backoff
- cancellation 可阻止後續步驟
- 同一 idempotency key 不得重複建立 generation / asset / 扣款
- provider success 但 storage fail 時不可把任務顯示 completed
- storage success 但 scene attach fail 時要呈現 partial/waiting 或可重試狀態，不可 false complete

必須沿用 `docs/product/aios-agent-long-running-tasks.md` 的 durable 原則。

---

## 10. Billing / Cost Safety

Gemini Omni 是付費外部 provider。不得因「AI 自己覺得需要」就偷偷燒錢。

最低要求：

- provider pricing / point conversion 必須有 single source of truth
- UI 能看到預估成本或點數
- existing approval threshold 必須生效
- free-only / max-points / no-paid-fallback 語意不可被繞過
- retry 不得重複計費（provider 真實重送造成成本時要有明確 policy）
- failed generation 的 refund / reconciliation 與既有 generation ledger 一致
- 不可直接在 `assistant.ts` 扣點

若當前 pricing engine 尚不能正確表示 Gemini usage，先做 capability blocked/degraded，不准以「0 點」假裝免費上線。

---

## 11. Storage / Security

Gemini output 必須進既有 storage 層。

要求：

- server-side decode base64 / remote payload
- MIME allowlist
- output size limits
- no arbitrary user-supplied URL fetch without existing SSRF guard
- generated media URLs use existing signed/private access pattern
- no raw provider URL exposed long-term if it bypasses access control
- no secrets in logs
- trace body should redact large base64 / binary
- cross-tenant sourceAssetId / sceneId tests mandatory

---

## 12. Capability Maturity / Honest UX

更新 `shared/assistantCapabilityMaturity.ts` 或 CURRENT HEAD 對應 single source。

至少區分：

- `DECLARED_ONLY`
- `UNIT_VERIFIED`
- `STAGING_VERIFIED`
- `BLOCKED_BY_EXTERNAL_DEPENDENCY`
- preview-provider status（依現有 maturity model 表達）

不能因寫完 adapter 就宣稱 live verified。

沒有 `GEMINI_API_KEY` 或 feature flag 關閉時：

- Assistant 不應提議「我可以直接幫你生成」後又失敗。
- dynamic capability 應降級到既有 fal provider 或顯示不可用。

---

## 13. 「能做什麼」改成 Dynamic Capability UX

目前工作台不應再用固定 5 個功能代表 Agent 全能力。

保留首頁大方向快捷入口（加入資料 / 繼續目前工作 / 做影片 / 安排工作），但「能做什麼」內容改為依：

- page type
- project state
- missing assets
- unfinished agent run
- storyboard progress
- provider availability
- permission
- budget policy

動態生成。

### Storyboard page example

```text
Aios 看見你正在編輯《白日夢島》分鏡

現在可以直接幫你：
- 完成剩餘 5 張分鏡
- 檢查角色一致性
- 把選中分鏡做成影片
- 整理未關聯素材
- 繼續上一個創作任務
```

### Assets page example

```text
- 整理未分類素材
- 找重複素材
- 關聯到分鏡
- 分析圖片內容
- 找缺少素材
```

### UI requirements

- mobile first，約 390px 實測
- 不一次塞 20–30 個 chip
- default 3–5 個最相關 direct actions
- 可展開查看更多
- capability 不可用時不要假按鈕
- running task 顯示真實進度 / waiting reason
- 沒有 verified completion 不可寫「Aios 已完成」

---

## 14. Assistant Planning / Tool Selection

Assistant 的 system/tool instructions 要加入以下核心原則：

1. **先理解 current page + active goal，再選工具。**
2. 能直接做就不要只教使用者怎麼做。
3. 生成前先讀 project/storyboard/reference context，避免 blind generation。
4. 多步任務可用 agent plan / durable run，不硬塞在單次 ask。
5. 付費／外部／破壞性動作遵循既有 confirmation / approval policy。
6. 只使用 capability registry 內目前可用工具，不幻覺 tool。
7. provider 選擇由 router / policy 決定，不讓 LLM 任意填未知 model id。
8. 完成前要求 verification receipt。
9. partial success 要列出成功 / 失敗 / waiting，不得全包成 completed。

---

## 15. Provider Routing Policy

建立／擴充 provider selection policy，不把 Gemini 寫死成唯一模型。

建議語意：

```ts
selectCreativeProvider({
  capability: "image.generate" | "image.edit" | "video.generate" | "video.edit",
  preference,
  budget,
  requiredCapabilities,
  sourceTypes,
  providerHealth,
})
```

預設策略：

- storyboard image: Gemini Image 在 enabled + healthy + budget allowed 時可優先
- short video: Omni 在 enabled + healthy + budget allowed 時可優先
- feature 不支援／provider down：走既有 model policy fallback
- explicit free-only：不得 fallback 到 Omni
- explicit provider/model choice：除非 unavailable，不得偷偷換更貴 provider

---

## 16. Minimal Data Additions

先重用既有 generation / asset metadata。

只有缺少下列資訊且無法用現有欄位安全表示時才 migration：

- provider interaction id
- source generation lineage
- version / replaced-by lineage
- reference-role metadata

不要一開始新增 8 張 table。

若 CURRENT HEAD 已經有 `agent_runs / agent_steps / generations / assets / scenes` 等，就全部重用。

---

## 17. Tests — 不可省略

### Unit

- Gemini response parser
- Gemini error sanitizer
- feature flag / no-key behavior
- model env override
- image response mime + size validation
- Omni previous interaction id propagation
- provider routing: free-only / budget / unavailable / explicit provider
- idempotency
- capability registry selection by page type

### Security

- API key never serialized
- cross-tenant scene id denied
- cross-tenant asset id denied
- URL / SSRF existing guard still enforced
- over-size media rejected
- unsupported MIME rejected

### Agent semantic

Traditional Chinese at least：

- 「幫我把第一幕做成分鏡」
- 「剩下的分鏡幫我補完」
- 「第三鏡做成影片」
- 「角色不一樣，修第三鏡就好」
- 「延續剛剛的工作」
- 「只用免費模型」
- 「最多花 20 點」
- 「先不要生成，只幫我規劃」

要覆蓋：ASK / PLAN / AGENT / continuation / budget constraint。

### Integration

最低需要能證明：

```text
story → planned shots → persisted scenes
scene → generation → persisted asset → attach → read-back
```

Gemini live key 缺少時可以 mock provider，但只能標 `MOCK/UNIT VERIFIED`；不能寫成 live pass。

### Live (有 credentials 才跑)

- 1 image generation
- 1 image edit
- 1 Omni text-to-video
- 1 Omni image-to-video
- 1 conversational video edit
- persisted asset read-back
- billing / generation ledger read-back
- stop / retry behavior

Provider live 測試產物不得污染正式使用者專案；用 dedicated test project。

---

## 18. Required Gates

完成前至少執行：

```bash
npm run typecheck
npm test
npm run test:client
npm run build
npm run check:boundaries
npm run check:hooks
npm run scan:agent-integrity
```

若此 PR 有 migration：

```bash
npm run db:migrate:dry-run
npm run db:check
npm run verify:database-runtime
npm run verify:agent-db-integrity
```

若本機沒有 Postgres / Gemini credentials：

- 明確標 `BLOCKED_BY_EXTERNAL_DEPENDENCY`
- 不偽造 PASS
- 保留 exact command 讓下一個環境可重跑

---

## 19. Golden Acceptance Matrix

PR 不能 Ready until 至少達到：

| Flow | Expected |
|---|---|
| 故事 → 第一幕分鏡 | 可建立結構化 shots，不重複建立既有鏡頭 |
| 批次生成分鏡圖 | 每張有 generation + asset + shot link |
| 單鏡角色一致性修正 | 新版本可 read-back，舊版不被不可逆抹掉 |
| Shot → Omni video | 有 durable job、asset、shot link、receipt |
| Omni 對話式 edit | 有 previous interaction id 時可延續；沒有則誠實降級 |
| 付費限制 | free-only / max-points 不被繞過 |
| 無 Gemini key | capability truthful degrade，不 false complete |
| provider failure | failed/waiting 狀態正確，可 bounded retry |
| storage failure | 不得 completed |
| attach failure | 不得 completed，能 retry |
| reload/reconnect | 可找回 agent/generation 狀態 |
| mobile 390px | 動態能力與進度可操作，不溢出 |

---

## 20. Fresh-eye Requirement

完成主實作後，至少做兩輪 fresh-eye review：

### Round 1

以「第一次使用、不知道模型名」的創作者視角，從工作台完成：

`故事 → 分鏡 → 圖 → 影片`

修掉 P0/P1。

### Round 2

換成「中途接手已有半成品專案」：

- 已有一半分鏡
- 有幾張外部 AI 匯入圖
- 有一個 running/failed generation
- 角色 reference 不完整

確認 Aios 不重做、不亂寫、不假完成。

兩輪都要把發現與修正摘要寫進 PR body。

---

## 21. Scope Discipline

### 可以改

- Agent / Assistant orchestration
- capability registry / maturity
- generation provider adapter / router
- storage integration necessary glue
- minimal schema changes when proven necessary
- dynamic Aios capability UI
- tests / docs / scripts directly relevant to this feature

### 不要改

- unrelated visual redesign
- unrelated database architecture
- unrelated auth system
- unrelated community / collaboration features
- unrelated model catalog cleanup
- arbitrary naming refactor
- mass formatting
- dependencies unless implementation truly needs it

看到 unrelated bug：記 PR note / issue candidate，不要順手重構半個網站。

---

## 22. Completion Definition

本 PR 的完成不是「Gemini 能回應」。

完成定義是：

> **Aios 能從使用者自然語言 + 當前專案脈絡，自行規劃並透過既有安全／計費／儲存／Agent runtime，建立分鏡、生成或修改圖片、把單鏡做成影片，寫回專案並驗證結果；UI 只呈現當下真正可執行的能力，沒有 false completion。**

完成後 PR body 必須列：

1. Architecture before / after
2. Files changed by responsibility
3. Gemini model / API version actually used
4. Feature flag and env vars
5. Billing behavior
6. Security / ACL behavior
7. Golden flow evidence
8. Unit/integration/live test matrix
9. BLOCKED_BY_EXTERNAL_DEPENDENCY items
10. Fresh-eye round 1/2 findings
11. Known limitations
12. Exact commands to reproduce certification

**不要 auto-merge。使用者核准後才合併。**
