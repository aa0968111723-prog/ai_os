# Aios Visual Creative Workspace — Implementation Contract

> Status: IMPLEMENTATION_REQUIRED
> Date: 2026-08-13
> Branch: `feat/aios-gemini-omni-creative-agent`
> Companion contract: `docs/product/aios-gemini-omni-creative-agent.md`
> Delivery: **必須在 PR #707 直接實作；不是研究報告、不是 mockup-only、不是 docs-only。不要另開 PR、不要 auto-merge、不要 force-push。**

## 0. 產品定位

Aios 的目標不是「更強的聊天機器人」，而是 **Agentic Creative Operating System**：

> 使用者負責說明想要什麼；Aios 負責把作品真正做出來。

核心方向：

- 全方位創作
- 自動化
- 自動模型調用
- 故事 → 分鏡 → 圖像 → 影片 → 音訊 → 成品
- 角色／場景／風格一致性
- 自動補缺漏、重試、驗證、寫回
- 使用者永遠看得到「作品正在被完成」

本輪 **不做 Deep Research 產品功能**。研究型代理先緩；PR #707 聚焦 Creative Agent + Visual Workspace。

---

## 1. 關鍵 UX 原則

### 1.1 作品是主角，AI 不是主角

錯誤方向：

```text
大聊天框
→ AI 回一大段文字
→ 一堆固定快捷按鈕
→ 使用者再自己去找分鏡／素材／生成頁
```

正確方向：

```text
作品／Storyboard／Timeline 在中央
+ Aios 全域指令列
+ 即時 Agent 執行狀態
+ 可見 Creative Bible
+ 可見生成版本與 lineage
```

### 1.2 不把 Aios 做成 ComfyUI

預設介面不得要求一般使用者理解：

- model id
- endpoint
- sampler
- node graph
- provider API
- prompt schema

Node/workflow graph 只能出現在「專業模式」，而且不是本 PR 的 P0。

### 1.3 不暴露 private chain-of-thought

需要視覺化的是 **工作狀態、可驗證動作、來源與結果**：

```text
✓ 已讀取故事
✓ 已建立 12 個鏡頭
● 正在生成 Shot 03
○ 等待角色一致性檢查
○ 尚未開始影片生成
```

不要顯示模型私有 reasoning / chain-of-thought。

---

## 2. 三種操作模式

必須讓 UI 在同一套底層 Agent 能力上提供三個層級。

### 2.1 自動完成模式（Default）

適合不想選模型、不想調參數的人。

例：

> 幫我把第一幕完成。

Aios 自行：

- 讀 project context
- 找故事／角色／場景／風格
- 補分鏡
- 選模型
- 生成圖
- 檢查一致性
- 失敗重試
- 轉影片
- 寫回
- 回報完成／失敗／等待

### 2.2 創作者模式

使用者控制作品，不控制底層技術。

可控制：

- Shot
- Camera
- 角色
- 場景
- 版本
- Storyboard
- Timeline
- 採用／退回／重生

Aios 隱藏 provider 技術細節，但仍自動選模型。

### 2.3 專業模式

展開：

- provider / model
- cost estimate
- quality / speed / budget policy
- generation params
- asset lineage
- workflow detail

注意：專業模式仍必須沿用同一套 ACL / billing / generation / verification，不可另造平行 runtime。

---

## 3. Visual Project Pipeline

在 project workspace 頂部或主要視覺區提供 live pipeline：

```text
故事 → 角色 → 場景 → 分鏡 → 圖像 → 影片 → 音訊 → 成品
```

每個 stage 至少提供：

- status: not_started / partial / ready / blocked / failed
- completed / total
- missing count
- actionable next step

例如：

```text
故事        ✓ Ready
角色        ✓ 4/4
場景        ✓ 7/7
分鏡        8/12
圖像        7/12
影片        2/12
音訊        0/12
成品        0%
```

### 3.1 Pipeline 不能是假進度

進度必須來自 persisted project truth：

- scenes
- generations
- assets
- bindings
- agent runs
- tasks

禁止用前端 timer 假跑進度。

### 3.2 Pipeline 可操作

點「分鏡 8/12」應進入 storyboard 範圍；Aios prompt scope 同步更新。

點「影片 2/12」應能看到缺哪幾鏡、哪些 generating / failed。

---

## 4. Storyboard-first Workspace

中央主工作區以 **Storyboard / Shot Cards** 為第一優先，而不是聊天歷史。

每張 Shot Card 至少可顯示：

- shot ordinal
- title
- visual thumbnail / placeholder
- duration
- status
- current image/video asset
- consistency warning
- generation state
- selected version marker

### 4.1 Shot 狀態

至少：

- planned
- image_missing
- generating_image
- image_ready
- consistency_warning
- generating_video
- video_ready
- failed
- blocked

### 4.2 Shot selection

支援：

- 單選 Shot
- 多選 Shot
- 選一幕／scene group
- 選整個 project

選取後 Aios Prompt Bar scope 必須立即變化。

### 4.3 典型操作

單選 Shot #8：

> 角色不要笑，鏡頭再近一點。

多選 3 個 Shot：

> 全部改成黃昏。

整幕：

> 把這一幕剩下的分鏡全部補完。

---

## 5. Selection-aware Aios Prompt Bar

Aios 不再只是獨立聊天泡泡。

實作 persistent / context-aware prompt bar，明確顯示：

```text
目前作用範圍：
白日夢島 / 第一幕 / Shot 08
```

或：

```text
目前作用範圍：3 個已選 Shot
```

### 5.1 Scope contract

Prompt request 需要帶 structured scope：

```ts
interface CreativeSelectionScope {
  projectId: string;
  sceneIds?: string[];
  assetIds?: string[];
  selectedEntityType?: "project" | "scene" | "asset" | "character" | "style" | "timeline";
  pageType: string;
}
```

不得只靠自然語言猜「這個」、「第三個」。

### 5.2 Scope precedence

優先順序：

1. explicit selected entity
2. active creative goal
3. current page context
4. project default

需避免導航後 scope 漂移造成錯寫。

---

## 6. Creative Bible

Visual Workspace 必須讓使用者看得到專案的「創作記憶」。

至少包含：

- Character Bible
- Scene Bible
- Style Bible
- Prop / Important Objects
- Voice / Audio identity

### 6.1 Character Bible

每個角色可顯示：

- master reference(s)
- alternate verified references
- outfit
- facial / identity constraints
- current appearance summary
- used-in-shots count

### 6.2 Scene Bible

包含：

- location references
- time of day
- weather
- lighting
- recurring props
- continuity notes

### 6.3 Style Bible

至少：

- visual style summary
- palette / lighting descriptors
- aspect ratio
- forbidden drift notes
- representative references

### 6.4 優先重用現有資料模型

不要因本文件就新增巨大新 schema。

先盤點並重用：

- assets metadata
- worldview
- knowledge
- project decisions
- custom database refs
- scene metadata

只有 CURRENT HEAD 無法表示必要資料時，才做最小 migration。

---

## 7. Live Agent Execution Visualisation

使用者送出：

> 把第一幕做完。

UI 必須建立可見的 execution view，而不是只顯示 spinner。

例如：

```text
Aios 正在完成第一幕

✓ 讀取故事
✓ 找到 4 個角色參考
✓ 建立 12 個 Shot
● 生成分鏡圖 7/12
○ 一致性檢查 3/12
○ 轉影片 0/12
```

### 7.1 狀態來自真實 Agent events

優先重用：

- agent events
- generation status
- execution receipts
- agent run steps

不得再造 frontend-only fake event stream。

### 7.2 支援操作

執行中至少允許：

- Stop
- Retry failed
- Continue
- Open result
- View pending approval

### 7.3 完成標準

只有 read-back verified side effects 才能標完成。

若：

- provider done 但 storage failed
- storage done 但 scene attach failed
- 生成成功但 DB write failed

UI 都不能顯示「Aios 已完成」。

---

## 8. Dynamic “Aios 現在能做什麼”

現有固定功能清單要改成 project/page-aware capability surface。

Storyboard page 可能顯示：

- 補齊缺少分鏡
- 生成剩餘分鏡圖
- 檢查角色一致性
- 把選中 Shot 做成影片
- 修復失敗鏡頭

Assets page 可能顯示：

- 整理未分類素材
- 找重複素材
- 關聯到 Shot
- 找出缺少素材的 Shot

Project page 可能顯示：

- 繼續上一個工作
- 完成第一幕
- 檢查專案缺漏
- 建立 rough cut

### 8.1 來源

必須由：

- page context
- project status
- capability registry
- user ACL
- provider readiness
- billing policy

動態計算。

禁止顯示實際不可執行的 capability。

---

## 9. Auto Model Router

Aios 預設幫使用者選模型。

一般模式只讓使用者選 policy：

- 最佳品質
- 快速
- 省成本
- 免費優先

然後 Router 根據：

- task type
- input modality
- reference requirement
- consistency requirement
- quality target
- speed target
- free_only
- max_points
- provider readiness

選模型。

### 9.1 UI 顯示

結果卡可顯示小型 metadata：

```text
Gemini Image · 8s · 2 points
```

但不要在一般模式先要求選 model id。

### 9.2 不得繞過付費限制

- free_only 必須硬限制
- max_points 必須硬限制
- approval threshold 必須硬限制
- explicit provider choice 不可被悄悄替換成更貴模型

---

## 10. Asset / Shot Version Graph

每個 Shot 的生成結果必須保留 lineage，不要全部散落素材庫。

概念：

```text
Shot 08
 ├─ Image V1  rejected
 ├─ Image V2  rejected
 ├─ Image V3  selected
 │    ├─ Video V1
 │    └─ Video V2 selected
 └─ Alternative B
```

### 10.1 至少要能查

- parent asset / source asset
- provider/model
- prompt revision
- selected / rejected
- createdAt
- generationId
- attached scene

### 10.2 不破壞舊版本

「重生」預設建立新版本，不 silently overwrite previous asset。

### 10.3 Restore

如果現有 storage / binding 設計允許，提供 restore previous version；若 CURRENT HEAD 不支援，在本 PR 至少保留 lineage 和 selected version，不要假做 restore。

---

## 11. Storyboard → Video → Rough Cut

本 PR 不只要做到「生成單張圖」。

核心 Golden Flow 必須讓使用者看到：

```text
Story
→ Planned Shots
→ Storyboard Images
→ Shot Videos
→ Audio slots
→ Rough Cut state
```

### 11.1 Rough Cut 不需要重做完整 NLE

若現有產品已有 timeline/editor，接入現有 editor。

若沒有完整 NLE，本 PR 先做到：

- shot ordering
- current selected video per shot
- duration
- narration/audio slots
- rough-cut readiness

不要為本 PR 造一套 Premiere。

---

## 12. Error / Blocked / Partial UX

Creative Agent 一定會遇到外部 provider failure。

所有視覺 UI 必須區分：

- generating
- queued
- blocked_by_approval
- blocked_by_missing_input
- provider_unavailable
- failed_retryable
- failed_terminal
- partial_success
- verified_complete

禁止把 `partial_success` 當 completed。

### 12.1 可行替代方案

例如 Omni unavailable：

```text
Gemini Omni 暫時不可用。
可改用：
- 現有 fal video provider
- 只完成 storyboard images
- 等待 Omni 恢復
```

但不得自動偷偷改用更貴方案。

---

## 13. Responsive / Mobile

Visual Workspace 要支援約 390px 手機寬度。

### Desktop

建議：

```text
Creative Bible | Main Canvas / Storyboard | Aios execution
```

### Mobile

不可硬塞三欄。

改成：

```text
Pipeline
Storyboard
Prompt Bar

底部 sheet / tabs：
Bible | Aios | Versions
```

要求：

- touch target >= 44px
- shot card 可選
- prompt scope 看得懂
- execution progress 不遮住作品
- 不水平爆版

---

## 14. Accessibility

至少：

- 所有 shot/action controls 可 keyboard focus
- thumbnail 有 alt / label
- status 不只靠顏色
- progress 有 textual value
- buttons 有明確 aria label
- pending / completed 變化可被 screen reader 感知

---

## 15. Implementation integration points

CURRENT HEAD 先找現有元件，優先擴充，不要全部重寫。

至少盤點：

- `client/src/components/AICreativeCopilot*`
- current project workspace / storyboard components
- current scene cards
- AgentRunCard
- generation result components
- asset library
- assistant page context
- assistant capability registry
- assistant events
- model selection UI

### 15.1 建議元件責任

可依 repo convention 調整名稱，但責任需清楚：

```text
CreativeWorkspace
CreativePipeline
StoryboardGrid
ShotCard
CreativeBiblePanel
CreativePromptBar
AgentExecutionPanel
AssetVersionPanel
ModelPolicyPicker
```

### 15.2 資料 contract

前端不能自行拼湊 7 個 query 才算狀態。

後端提供 bounded structured project creative status，至少含：

```ts
interface CreativeProjectStatus {
  projectId: string;
  stages: Array<{
    id: string;
    status: string;
    completed: number;
    total: number;
    missing: number;
  }>;
  activeRun?: unknown;
  selectedScope?: unknown;
  suggestedActions: unknown[];
}
```

可透過既有 `get_project_status` / project intelligence 擴充，不一定新 endpoint。

---

## 16. Golden Flows — 必須端到端

### GF-V1：故事 → 可見分鏡

使用者：

> 把第一幕做成分鏡。

驗收：

- central storyboard 自動出現 Shot Cards
- persisted scene exists
- image jobs visibly progress
- done assets attached to correct shot
- refresh 後仍存在

### GF-V2：選 Shot → 修改

使用者選 Shot 08：

> 角色不要笑，其他不要變。

驗收：

- prompt scope = Shot 08
- read current asset
- use references
- create new version
- attach selected version
- old version preserved

### GF-V3：多選批量改風格／時間

選 3 Shots：

> 全部改成黃昏。

驗收：

- only selected shots affected
- bounded parallel generation
- progress per shot
- partial failure truthful

### GF-V4：一鍵「完成第一幕」

驗收：

- missing shots planned/created
- images generated
- consistency check
- failed shots retried bounded
- videos scheduled only per budget/approval
- exact completion summary

### GF-V5：Shot → Video

驗收：

- generated video attached to same shot
- version lineage preserved
- generation status survives reload

### GF-V6：Aios 續作

關閉面板／reload 後：

> 繼續剛才的第一幕。

驗收：

- active goal restored from durable state
- does not duplicate existing shots/assets
- continues remaining steps

### GF-V7：免費限制

使用者：

> 免費模式把第一幕做完。

驗收：

- paid provider never silently used
- UI clearly shows blocked / free fallback choices

---

## 17. Testing requirements

除了 companion contract 原本的 tests，新增：

### Unit

- pipeline status derivation
- selection scope resolution
- capability suggestions by page
- model policy routing
- version lineage
- false-completion guards

### Client

- storyboard shot selection
- multi-select
- scope-aware prompt bar
- dynamic capability cards
- Agent execution states
- partial failure
- mobile layout

### Integration

- story → scenes
- scene → image → asset → attach → read-back
- selected shot edit → version → read-back
- shot → video durable job
- reload/reconnect

### Regression

- existing AICreativeCopilot flows
- project ACL
- generation billing
- MCP capability list
- current storyboard/editor

### Commands

至少：

```text
npm run typecheck
npm test
npm run test:client
npm run build
npm run check:boundaries
npm run check:hooks
npm run check:ui-primitives
npm run scan:agent-integrity
```

有 DB migration 時：

```text
npm run db:migrate:dry-run
npm run db:check
npm run verify:database-runtime
npm run verify:agent-db-integrity
```

外部 provider live test 缺 key 時標 `BLOCKED_BY_EXTERNAL_DEPENDENCY`，不可 mock 後宣稱 live PASS。

---

## 18. Fresh-eye QA

實作完成後至少兩輪：

### Round 1 — Creator perspective

檢查：

- 我能不能不懂模型就完成作品？
- 我是否看得懂 Aios 現在在做什麼？
- 我是否知道哪個 Shot 出錯？
- 我是否能直接修改作品，而不是一直聊天？

### Round 2 — Failure perspective

注入：

- provider timeout
- 429
- storage fail
- scene attach fail
- duplicate retry
- reload
- stale selection
- out-of-budget

不得發現 false completion / duplicate billing / wrong-shot write。

---

## 19. Ready Gate

PR #707 保持 Draft，直到 companion contract + 本文件都滿足。

至少：

- [ ] Visual Project Pipeline 已接 persisted truth
- [ ] Storyboard 是主要創作工作區，不只文字回答
- [ ] Selection-aware Aios Prompt Bar 可用
- [ ] Character / Scene / Style Bible 有實體 UI 與資料來源
- [ ] Live Agent execution 真實顯示
- [ ] Dynamic capabilities 依 page/project 變化
- [ ] Auto Model Router 尊重 free/cost policy
- [ ] Asset/Shot version lineage 可查
- [ ] Storyboard → image → video 核心流程端到端
- [ ] refresh/reconnect 不丟工作
- [ ] mobile ~390px 可操作
- [ ] no false completion
- [ ] no duplicate billing/write
- [ ] 兩輪 fresh-eye 無新 P0/P1
- [ ] typecheck/tests/build required gates pass

---

## 20. 明確禁止的收尾方式

以下任何一種都 **不算完成**：

- 只更新設計稿
- 只新增 mock component
- 只改「能做什麼」文字
- 只加 Gemini provider 但沒有 Agent 工具
- 只生成圖片但不寫回 Shot
- 只回傳 storyboard JSON 但不建立 scenes
- 只做 dashboard 而沒有真實進度
- 只做 spinner
- 只完成 desktop 不測 mobile
- 只用 mock provider 就宣稱 production ready
- 只寫 docs

最後必須交付 **production code + tests + validation evidence + PR update**。
