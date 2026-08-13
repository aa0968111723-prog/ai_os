# Aios Creative OS 全面深度盤點與實作收斂 — 2026-08

> Status: IMPLEMENTATION_REQUIRED
> Date: 2026-08-13
> PR: #707
> Branch: `feat/aios-gemini-omni-creative-agent`
> Product focus: **Agentic Creative Operating System**
> Scope: 全方位創作、自動化、模型調用、分鏡、圖像、影片、聲音、粗剪、交付
> Explicit non-goal: **本輪不做 Deep Research 產品功能**
>
> 本文件不是第三份「想法文件」。它的用途是把 repo CURRENT TRUTH、外部產品研究、已有能力、缺口、重用路徑、實作順序、測試與 Ready Gate 收斂成 **PR #707 必須照著做的第三份 Implementation Contract**。
>
> **不能只寫 docs、不能只做 mockup、不能只接 provider。必須落 production code + tests + integration evidence。**

---

## 0. 先修正一個已經改變的前提：#706 已合併

PR #707 建立時，#706（Agent × Backend Database 深度整合）仍在進行，因此前兩份 contract 把它寫成「open dependency」。

現在這個前提已失效：

- default branch 已合併 #706。
- default 目前包含 #706 的 Agent/DB runtime 與相關修復。
- #707 branch 目前仍從舊 merge-base `13f73a9...` 分出去。
- 盤點當下 #707 相對 default **behind 29 commits / ahead 2 commits**，兩個 ahead commit 都只是 contract docs。

### 0.1 P0：任何 production implementation 前先同步 CURRENT DEFAULT

執行者第一件事：

```text
sync current default into feat/aios-gemini-omni-creative-agent
→ resolve conflicts
→ re-run repo audit on CURRENT HEAD
→ only then implement
```

要求：

- 不 force-push。
- 不丟掉本 PR 三份 contract。
- 不把 #706 DB runtime 複製一份到 #707。
- 若 #706 已新增可用 Agent DB / capability / resolver，直接重用。
- 同步後把新的 merge-base / HEAD 與 conflict disposition 記到 PR body/comment。

這不是 housekeeping；若跳過，#707 很可能在 29 個 commit 以前的 API 上實作，最後再大衝突。

---

# Part A — 產品研究結論：Aios 不該照抄任何一個競品

## 1. 市場正在收斂的五個模式

本輪只把外部產品當「產品機制研究」，不是要求 Aios 仿 UI。

### Google Flow：Agent + Project-aware Canvas + Storyboard + References

值得吸收：

- Agent 理解專案，而不是只理解單輪 prompt。
- image/video/reference 混合在同一個可適應創作空間。
- Storyboard Studio 把 script / cast / storyboard 串在一起。
- 自然語言可做 iterative edit，且可擴到整個 project。
- Characters / references 是一級資產。

Aios 對應：

```text
Project truth
+ Assistant context
+ StoryboardStage
+ Creative Bible
+ selection-aware edit
+ project-wide Agent goal
```

### Adobe Firefly Boards + Timeline：探索空間與線性完成空間分離

值得吸收：

- Boards 適合 references / ideas / storyboard / generative exploration。
- Timeline 適合把 clips 真正整理成 linear video。
- Board 產物能直接進剪輯，而不是「下載再失聯」。
- reference image/video 是 composition / style / character consistency 的正式輸入。

Aios 對應：

```text
Storyboard / Resource / Bible
→ generated shot assets
→ existing StoryboardTimeline / timeline truth
→ Delivery / external editing
```

### ElevenCreative Flows + Studio：非破壞局部重跑 + Agent 權限模式

值得吸收：

- complex multi-modal chain 可以背景執行。
- 改 voice 不需要整支片重生。
- Agent 可以幫忙搭/跑流程，但使用者可隨時接管。
- approve each / auto-run / cost-threshold 是非常清楚的自治權模型。
- linear Studio 與 generative Flow 是兩個不同工作面。

Aios 對應：

```text
Agent durable run
+ dependency-aware invalidation
+ partial recompute
+ existing approval/billing
+ Creator manual override
+ current timeline
```

### Runway References：故事一致性靠 reusable references，不靠反覆文字描述

值得吸收：

- character / location / object reference 是 reusable identity。
- 一個角色跨 lighting / location / treatment 仍要維持辨識一致。
- reference 可以多個組合，不等於只放一張「角色圖」。

Aios 對應：

```text
Character / Scene / Prop / Style Bible
→ verified references
→ context compiler
→ every affected generation
```

### 結論：Aios 最適合的產品形狀

不是：

```text
ChatGPT clone + 30 AI buttons
```

也不是預設：

```text
ComfyUI / node graph
```

而是：

```text
Story / Shot-centric Visual Workspace
+ persistent Creative Bible
+ Selection-aware Aios
+ Agent-run automation
+ hidden-by-default Model Router
+ non-destructive versions
+ real Timeline / Delivery
```

**作品是主要 UI；Aios 是遍佈作品上下文的操作層。**

---

# Part B — CURRENT REPO TRUTH：其實已經有很多骨架，不要重做

## 2. Story-first 已經是正式產品骨架

CURRENT repo 已有：

```text
故事 → 分鏡 → 製作 → 成片
```

而且 Story-first refactor 已經把：

- Story workspace
- AI parse
- story scenes
- shots
- character / scene / prop / look refs
- shot inheritance
- generation context
- continuity/outdated impact
- delivery

串起來。

### PR #707 的任務不是「發明新創作系統」

而是把上述已存在能力 **收斂成 Aios 能真正自動操作的一條生產線**。

---

## 3. StoryboardStage 已經是 Visual Workspace 的前身

現有 `client/src/features/storyboard-center/StoryboardStage.tsx` 已有：

- story scene grouping
- ShotCard grid
- simple / pro mode
- continuity warning
- multi-select shots
- SceneStudio
- ResourceDock
- `registerAssistantFocus`

### 實作決策

**擴充，不重寫。**

把它升級成：

```text
CreativePipeline
+ StoryboardStage
+ Selection Summary
+ Scoped Aios Prompt Bar
+ Live Run Strip/Panel
+ ResourceDock → Bible view
+ Versions / Issues side sheet
```

不要另開一個 `NewCreativeStoryboardPage` 再做一套相同資料。

---

## 4. ShotCard 已經是作品的核心 entity

現有 ShotCard 已經能表示：

- title / duration
- prompt / action / dialogue / voiceover
- asset
- character refs
- scene refs
- props
- camera
- performance
- looks
- generation state
- narration / ambience / review
- continuity warning
- multi-select
- drag/drop external asset

### PR #707 真正該加的不是更多表單

要加的是 **Agent-visible state / action / issue / lineage**：

每張卡可以進一步顯示：

```text
#08 角色登場
[thumbnail]

Image ✓
Video ● generating
Voice ✓
Audio ○
Review ○

⚠ 角色 Reference 已更新，這版可能過時
V3 selected · Gemini Image

[修這一鏡] [做成影片] [版本]
```

並且按動作直接建立 scoped Agent/Generation action，不是只把使用者送回聊天框。

---

## 5. Selection-aware context 已經存在，不要造第二個 Selection Store

`client/src/lib/assistantContext.ts` 已經有：

- page layer
- focus layer
- `entityId`
- `selectedEntityIds`
- `activeTab`
- `recentAction`
- stale cleanup token
- current project awareness

而 StoryboardStage 已經把 picked shots 註冊進去。

### 修正前一份 contract

先前 proposed `CreativeSelectionScope` 不應成為另一套平行 store。

正確做法：

```text
assistantContext
→ extend wire schema only when truly needed
→ backend re-resolves selected IDs
→ ACL / project membership / current revision re-check
→ Agent tools execute
```

### Selection precedence

保留：

```text
explicit current selection
> active creative goal target
> current page/focus
> project default
```

但每次 write 前仍要重新 resolve，避免 stale UI scope 寫錯 Shot。

---

## 6. ResourceDock 已經是 Creative Bible 的前身

現在 ResourceDock 已有：

- assets
- characters
- scene presets
- props
- knowledge
- multi-shot apply

ProjectPage 另已有：

- CharacterCards
- CharacterLooks
- ScenePresetCards
- PropCards
- Worldview
- KnowledgeBase
- assets

### 正確的 Creative Bible

不是再開一個新資料庫。

而是做一個 **project creative memory projection**：

```text
Character Bible
  ← character + looks + verified reference assets + decisions

Scene Bible
  ← scenePreset + story scene environment + refs + continuity notes

Prop Bible
  ← props + ownership + recurring refs

Style Bible
  ← worldview + representative refs + decisions

Voice/Audio Bible
  ← voice decisions + existing audio assets + scene speech/music conventions
```

### Bible 每項至少有

- stable identity
- verified references
- current selected/master-like reference
- constraints
- used-in shots
- last changed
- affected shots when changed

「master reference」若需要新增概念，優先 metadata/decision/flag，不先新增大型 parallel schema。

---

## 7. shotCompletion 已經是 Visual Pipeline 的最重要 single source of truth

`shared/shotCompletion.ts` 已經從真實 pointers/status 推導：

- image
- video
- voice
- audio
- review

以及 project completion / delivery issues。

### Visual Project Pipeline 應該建立在這上面

不要存：

```text
hasImage=true
hasVideo=true
stageProgress=74
```

正確是 bounded projection：

```text
stories/story parse truth
+ character/scene reference readiness
+ shotCompletion
+ generation status
+ active agent run
+ timeline/delivery readiness
```

回：

```ts
CreativeProjectStatus {
  stages
  issues
  activeRuns
  suggestedActions
  budgetBlockers
  providerBlockers
}
```

這是 **read projection，不是另一份 source-of-truth table**。

---

## 8. Scene versions 已經存在，不要急著造 asset_versions

`shared/sceneVersions.ts` 已經明確採：

```text
generations history
+ scenes current pointers
= versions projection
```

並已處理：

- current
- candidate
- generating
- awaiting approval
- failed
- model
- prompt
- sourceUrl
- points
- external asset

### PR #707 要補的是 lineage metadata，不是重做版本系統

需要補的話，用最小 additive metadata 表示：

- parentAssetId / sourceAssetId
- parentGenerationId
- edit intent
- context/reference fingerprint
- provider interaction id
- quality/QC outcome

Selected version 仍由 scene current pointer 當真相。

### UI

做 A/B compare / version stack：

```text
V1 superseded
V2 candidate
V3 current
  └ Video V1
  └ Video V2 current
```

若 video 建在 Image V3 上，Image current 改成 V2 時，Video 應標 **stale/downstream impact**，不能靜默假裝還是最新。

---

## 9. Timeline / Rough Cut 其實已經有真正基礎

Repo 已有：

- `shared/timeline.ts`
- `client/src/features/animation-studio/StoryboardTimeline.tsx`
- preview render
- Adobe timeline export
- external editing roundtrip

時間軸已採 frame truth 與 trim semantics。

### #707 不要只做「rough cut readiness 文字」

應把 Agent 產出真正接進：

```text
selected shot visual/video
+ duration/trim
+ narration
+ ambience/SFX
+ music spans
→ existing timeline layout
→ preview / delivery
```

不要另造一套 Timeline。

---

## 10. Audio 必須從「附加功能」升成一級創作軌

前兩份 contract 寫了 image/video/audio，但不夠完整。

CURRENT repo 已有：

- narration / voiceover
- dialogue
- ambience
- SFX semantics
- music markers / spans
- timeline lanes

### Aios Creative OS 應把聲音拆成

```text
Dialogue / Voice
Narration
Ambience
SFX
Music / Score
(optional later: lipsync)
```

例：

> 幫第一幕補完聲音。

Aios 應先盤點：

```text
哪幾鏡有 dialogue / voiceover
哪些需要 ambience
哪些有 music span
哪些畫面已有影片原生音訊
```

再只生成缺的，不把已有軌重做。

---

## 11. aiModelPolicy 已經是 Auto Model Router 基礎

`server/services/aiModelPolicy.ts` 已有：

- balanced / quality / budget / speed
- maxPoints
- category
- source kind
- minimum tier
- verified / healthy
- allowlist
- alternatives
- selection reason

### 正確方向：升級，不新建 router

一般使用者 policy 對應：

```text
最佳品質 → quality
快速 → speed
省成本 → budget
自動平衡 → balanced
免費優先 → free_only policy gate + compatible free route
```

### Router 還應加入 capability-aware factors

不是只看 category / tier / points：

- reference input support
- edit vs generate
- image-to-video vs text-to-video
- subject consistency suitability
- scene / prop reference count
- aspect ratio
- desired duration
- native audio requirement
- previous interaction/edit continuation support
- provider health
- expected latency if measured
- user explicit provider choice

### Policy first, model second

```text
free_only / max_points / approval
→ task capability
→ provider readiness
→ model ranking
```

不得先選最強模型再想辦法繞預算。

---

## 12. generationCommand 已經是生成 side effect 正門

`server/services/generationCommand.ts` 已有：

- project state guard
- group/project ACL
- Policy Engine
- billing path
- existing generationCore
- context trace

### Gemini integration 的硬規則

```text
Assistant / Agent
→ capability / step
→ executeGenerationCommand
→ generationCore/provider adapter
→ storage
→ asset
→ scene binding
→ read-back receipt
```

禁止：

```text
assistant.ts → Gemini fetch → return base64
```

Gemini 只是新的 provider adapter。

---

## 13. AI Project Roles / Playbooks 已經是「多專業能力」的好骨架

現有角色：

- director
- storyboard
- generate
- continuity
- voice
- QA

而且 repo 很清楚地寫著：

> role 是心智/規劃標籤，不是假 AI 成員，不是第二 runtime。

這正好符合 Aios。

### 視覺化可以把它呈現成「Aios 正在做哪種工作」

例如：

```text
導演整理     ✓
分鏡規劃     ✓
生成         7/12
連戲檢查     3/12
聲音         0/12
品管         waiting
```

但後端仍是一份 agent_run。

### 建議擴充 playbook，而不是加假 agents

可能新增/擴充：

- `playbook.creation.scene-to-roughcut.v1`
- `playbook.continuity.repair.v1`
- `playbook.audio.complete.v1`
- `playbook.delivery.finish.v1`

這些仍只由既有 step kinds / Agent Runner 執行。

---

# Part C — 真正還缺什麼

## 14. 缺口 1：缺一個 Creative Project State Projection

目前資料很多，但 UI / Agent 想知道「整支作品做到哪」仍要跨多個 query 自己拼。

### 實作

在 server 建 bounded projection（名稱依 repo convention）：

```ts
interface CreativeProjectStatus {
  projectId: string;
  stages: CreativeStageStatus[];
  shotSummary: {
    total: number;
    missingImage: number;
    missingVideo: number;
    missingVoice: number;
    missingAudio: number;
    reviewPending: number;
    generating: number;
    failed: number;
  };
  continuityIssues: CreativeIssue[];
  activeRuns: CreativeRunSummary[];
  blockers: CreativeBlocker[];
  suggestedActions: CreativeSuggestedAction[];
  timeline: {
    totalFrames: number;
    totalSec: number;
    roughCutReady: boolean;
  };
}
```

來源只能是既有 truth。

### 不存 aggregate progress table

因為 pointer/generation 改了會 drift。

---

## 15. 缺口 2：Dynamic Capabilities 現在還只是 keyword selection

`assistantCapabilityRegistry` 現在主要依：

```text
page terms + intent terms → filter MCP_TOOLS
```

這不足以回答：

> 「Aios 現在真的能替我做什麼？」

### 要新增 Applicability Layer

MCP registry 仍是工具 single source of truth，但多一層 **action applicability evaluator**：

輸入：

- page/focus
- selected IDs
- project status
- ACL
- provider readiness
- budget/free policy
- current jobs
- project gaps

輸出：

```ts
{
  actionId: "complete_missing_storyboard_images",
  label: "生成剩餘 5 張分鏡圖",
  available: true,
  estimatedTargets: 5,
  reason: "5 shots are missing visual assets",
  requiresApproval: true,
  promptTemplate: "把剩下 5 張分鏡圖完成",
}
```

不可顯示目前做不到的 action。

---

## 16. 缺口 3：需要 Prompt/Context Compiler，不只是「模型路由」

全自動創作成敗最關鍵不是模型名字，而是送進模型的 context 是否一致。

### 每次 Shot generation 前，建 structured context pack

重用現有 `contextResolver`，收斂成：

```ts
CreativeGenerationContext {
  projectStyle
  storyScene
  shot
  characters[]
  looks[]
  locationRefs[]
  props[]
  adjacentShotRefs[]
  currentAsset?
  userInstruction
  outputIntent
  constraints
}
```

### 編譯成 provider input 前要有 fingerprint

例如：

```text
contextFingerprint = hash(
  style revision
  + scene environment revision
  + shot revision
  + selected references
  + user instruction
)
```

用途：

- 判斷產物是否 outdated
- bounded retry 不重複做同一 context
- explainability（哪個 reference 參與）
- downstream invalidation

這不是拿來顯示 chain-of-thought。

---

## 17. 缺口 4：Reference Hierarchy / Continuity Policy 要正式化

建議順序：

```text
Project Style Bible
→ Scene Environment / Scene Bible
→ Character/Look/Prop verified refs
→ Shot overrides
→ current selected source asset
→ user current instruction
```

### Identity consistency

角色 generation 必須知道：

- identity reference
- outfit/look
- expression instruction
- what must not drift

### Environment consistency

場景 generation 必須知道：

- location reference
- time/weather/lighting
- recurring objects

### Prop consistency

反覆出現的關鍵道具不能只靠 prompt 名字。

---

## 18. 缺口 5：Continuity/QC 必須變成可執行回路

現在已有 continuity/outdated check，但「全自動完成」需要更完整的 QC loop。

### 可驗證 QC 項

每個 Shot 可有：

- character reference present
- look/outfit reference present
- scene reference present
- prop reference present
- asset generated
- downstream video based on current image
- required voice present
- required ambience/SFX present
- duration valid
- review state
- output not stale

如果未來有 VLM 自動比較，可新增 `automated observation`，但 **QA final approval 不得被一個不透明分數取代**。

### Auto-repair gate

只有同時滿足：

```text
repair is reversible
AND within budget
AND no required human approval
AND target scope is current
```

才自動修。

否則顯示 issue + proposed fix。

---

## 19. 缺口 6：Dependency-aware partial recompute

這是讓 Aios 真正比「批量生圖工具」更強的核心。

### 例 1：只改 voice

```text
voice changed
→ voice generation stale
→ captions/lipsync maybe stale
→ image/video 不重生
```

### 例 2：換角色 Look

```text
look changed
→ only shots using that character/look marked impacted
→ existing image/video marked stale as appropriate
→ user/Aios chooses bounded rerender targets
```

### 例 3：切回 Image V2

```text
selected image changes V3 → V2
→ videos whose parent was V3 = downstream stale
→ do not silently keep status green
```

### 例 4：改鏡長

```text
duration changed
→ timeline recompute
→ narration/audio may need timing review
→ unrelated character refs unchanged
```

可以重用既有 impact/outdated logic，擴成 typed dependency impact。

---

## 20. 缺口 7：Aios Run 需要「創作 phase」視覺，不只 generic step list

Runner 不要重做，但 UI 可以把既有 steps/events 投影成 phase：

```text
準備
  ✓ 讀故事
  ✓ 取得 References

分鏡
  ✓ 12 Shots ready

生成
  ● Image 7/12
  ○ Video 2/12

聲音
  ○ Voice 0/8
  ○ Ambience 0/12
  ○ Music 0/1 span

檢查
  ○ Continuity
  ○ Review

組裝
  ○ Rough Cut
```

### 每個 target 都要能看狀態

不要只顯示：

```text
「正在生成內容...」
```

要顯示：

```text
Shot 03 done
Shot 04 failed_retryable
Shot 05 queued
```

---

## 21. 缺口 8：自治權 / 花費控制要直接進創作 UX

不要只把 approval 當「後端安全機制」。

### 三個使用者理解得懂的模式

```text
自動完成
- 可逆/免費/已允許範圍自動做
- 超過門檻停下問

協作模式
- 重要生成前確認
- 小型可逆操作可自動

逐步確認
- 每個外部/付費 side effect 都先確認
```

實作需映射既有 approval / policy / max points，不另造 billing。

### Run budget

可設定：

- max total points per goal
- optional max per generation
- free_only

UI 顯示：

```text
本次預估 34 點
已用 12
剩餘 22
預計還有 5 次生成
```

只能使用實際 ledger/estimates，不瞎算。

---

## 22. 缺口 9：人與 Agent 同時編輯的衝突處理

Aios 長任務期間，使用者或隊友可能手動改同一 Shot。

### 不允許 last-write-wins 把人改動蓋掉

對高風險 creative writes 加 revision/fingerprint check：

```text
plan/read at rev 12
human edits → rev 13
agent write based on rev 12
→ conflict / re-resolve
→ not overwrite
```

已有 plan `baseRevision`、scene update/協作相關機制可優先延伸。

UI 要說：

```text
Shot 08 在 Aios 執行期間被更新，我沒有覆蓋它。
[重新讀取後繼續]
```

---

## 23. 缺口 10：Run-level Change Set / Undo

Aios 做 20 個步驟後，使用者要知道 **到底改了什麼**。

### 完成摘要不是文章，而是 change set

```text
新增 5 Shots
生成 5 Images
重生 2 Images
切換 1 個 selected version
新增 4 Voice assets
沒有刪除任何既有版本
```

### Undo

只有既有 domain 支援可逆時才給：

- pointer rollback
- soft-delete restore
- version selection restore
- story undo

不要做假的 universal transaction rollback。

---

## 24. 缺口 11：產出應該從 Shot 一直追到 Delivery

建立一個可追的 media lineage：

```text
Story excerpt
→ Shot
→ Image V3
→ Video V2
→ Voice V1
→ Audio V1
→ Timeline placement
→ Delivery/export
```

每段要能回到：

- generation ID
- model/provider
- selected refs
- cost
- created time
- run ID
- user/agent source

這同時解決 debug、使用者信任、版本切回、錯誤恢復。

---

## 25. 缺口 12：Production Finish 應進入 Aios 能力範圍

Aios 的「全方位創作」不能在 video generation 就停。

但也不需要重做 Premiere。

### Aios 至少能做

- reorder shots（依既有守門）
- set/adjust duration where permitted
- identify missing clips
- fill voice/ambience/music
- choose selected version
- build rough-cut readiness
- trigger preview render / existing render path if available
- prepare Adobe/external editing handoff
- evaluate delivery readiness

### 一句話

> 把第一幕整理成可以看的粗剪。

應該是合法 Agent goal。

---

# Part D — Full Creative Loop

## 26. Aios 應支援的完整創作循環

```text
1. Intent
   使用者：我要做一支 90 秒療癒動畫

2. Understand
   讀故事、專案、Bible、已有素材

3. Structure
   Story → Scene → Shot

4. Visualize
   references → storyboard images

5. Animate
   selected image/reference → shot videos

6. Sound
   dialogue / narration / ambience / SFX / music

7. QC
   consistency / missing / stale / failures

8. Repair
   bounded retry / regenerate impacted only

9. Assemble
   selected versions → timeline / rough cut

10. Review
    human approval / changes

11. Deliver
    preview / export / external editor

12. Continue
    next scene / next act / next version
```

任何一步都必須可從 persisted project state 接著做。

---

## 27. 使用者不應該需要知道模型

預設語言：

```text
「高品質完成」
「快速草稿」
「省成本」
「免費優先」
```

而不是：

```text
gemini-3.1-flash-image
omni
veo
kling
fal endpoint
```

模型詳情在 Advanced/Pro 層展開。

---

## 28. 但模型選擇必須可追

每個生成結果小字即可：

```text
Gemini Image · 8s · 2 pts
```

展開：

- provider
- model
- why selected
- alternatives
- source references
- cost
- generation ID

「自動」不是「不可解釋」。

---

# Part E — UI 收斂

## 29. Desktop 最終建議不是固定三欄，而是 responsive compositional workspace

三個核心面：

### A. Project / Bible context

- 可收合
- 角色/場景/風格/道具/聲音
- 不要永遠佔 30% 寬

### B. Work surface

依 stage 切：

- Story
- Storyboard
- Shot Studio
- Timeline
- Delivery

### C. Aios

可以是：

- persistent prompt bar
- active run panel
- compact action palette
- mobile sheet

**不要再讓一個巨大聊天歷史把作品擠小。**

---

## 30. Aios Prompt Bar 是控制面，不只是訊息輸入

至少顯示：

```text
Scope: 第一幕 · 3 Shots
Mode: 自動完成
Policy: 品質優先 · 上限 30 點
```

輸入：

> 全部改成黃昏，但人物不要變。

後端收到的是：

```text
user instruction
+ structured selection pointers
+ active goal
+ policy
```

不是只收到一串文字。

---

## 31. Aios「能做什麼」改成 Action Palette

不要長清單。

排序原則：

1. can fix a current blocker
2. completes current stage
3. acts on current selection
4. continues active run
5. adjacent creative step

例如 Storyboard 畫面：

```text
[完成剩餘 5 張分鏡]
[把選中 3 鏡做成影片]
[修復 2 個連戲問題]
[補聲音]
```

如果 provider/budget 不允許，就不顯示成可直接執行。

---

## 32. 視覺化「思考」的唯一正確做法

顯示：

- planned actions
- reads/sources
- tool executions
- generation progress
- receipts
- blockers
- result diff

不顯示 private chain-of-thought。

例：

```text
✓ 讀取故事 v8
✓ 取得娜美定裝 2 張
✓ 建立 Shot 08
● Gemini Image generation #g123
○ 綁定到 Shot 08
○ 連戲檢查
```

---

## 33. Mobile ~390px

順序：

```text
Pipeline compact row
→ current work surface
→ sticky scoped prompt bar
→ bottom tabs/sheets:
   Bible | Aios | Versions | Issues
```

### 必須驗收

- 多選至少可用 checkbox/selection mode
- prompt scope 不被截到看不懂
- run progress 不擋住 Shot preview
- 44px touch
- keyboard/screen-reader labels
- 無橫向 overflow

---

# Part F — Implementation Map：建議直接改哪些既有檔

## 34. Client — 優先擴充

### `client/src/pages/ProjectPage.tsx`

責任：

- mount CreativePipeline summary
- current stage handoff
- mobile layout shell
- avoid duplicate Stage systems

### `client/src/features/storyboard-center/StoryboardStage.tsx`

責任：

- current selection source
- selection summary
- scoped Aios bar integration
- current run/status view
- multi-shot actions

### `client/src/features/storyboard-center/ShotCard.tsx`

責任：

- generation/QC state
- current version marker
- stale/downstream warning
- direct Aios action entry

### `client/src/features/storyboard-center/ResourceDock.tsx`

責任：

- evolve to Bible-aware dock/sheet
- verified/master refs
- affected shot count
- maintain existing batch apply

### `client/src/components/AICreativeCopilot.tsx`

責任：

- keep conversation/history
- reuse current events/receipts/run state
- stop being the only place where Agent can be used
- share composer/action execution with scoped prompt surface

### `client/src/components/SceneStudio.tsx`

責任：

- default auto model policy
- advanced explicit model override
- version compare
- refine/regen through new provider router
- lineage/context display

### `client/src/features/animation-studio/StoryboardTimeline.tsx`

責任：

- reflect current selected shot assets
- expose stale/missing states
- Agent target selection/handoff if useful

### `client/src/features/delivery/DeliveryRoom.tsx`

責任：

- remove hardcoded “one fixed batch model” default behavior
- route batch through auto model policy/Agent
- finish/retry/missing actions
- delivery readiness

---

## 35. Shared — 優先擴充

### `shared/assistantContext*`

- extend current pointer model, not new store

### `shared/shotCompletion.ts`

- keep per-shot source of truth
- add compatible helpers for creative pipeline / stale semantics if needed

### `shared/sceneVersions.ts`

- keep version projection
- add lineage/stale fields only as required

### `shared/animationContracts.ts`

- align asset roles/selection/dependency semantics

### `shared/timeline.ts`

- no duplicate time system

### `shared/sceneMusic.ts`

- reuse music span semantics

### `shared/assistantCapabilityRegistry.ts`

- retain registry source
- add applicability/action projection separately

### `shared/aiProjectRoles.ts` + `shared/rolePlaybooks.ts`

- extend Creative OS playbooks
- still one runtime

### `shared/plan.ts`

- only add step kinds if generic existing kinds cannot represent the action AND Runner implementation lands in same PR
- do not add schema-only dead kinds

---

## 36. Server — 優先擴充

### `server/services/aiModelPolicy.ts`

- capability-aware routing
- free-only integration
- external provider readiness
- explainable fallback

### `server/services/generationCommand.ts`

- remain side-effect gate
- integrate provider-agnostic generation metadata/lineage

### `server/services/contextResolver.ts`

- Creative context pack + fingerprint
- verified reference selection

### `server/services/agentCore.ts` / `agentRunner.ts`

- reuse durable run
- creative playbooks and steps
- bounded concurrency
- retry/conflict handling

### `server/routers/assistant.ts` / `globalAssistant.ts`

- understand scoped creative operations
- do not implement provider calls inline

### `server/services/mcp*`

- keep capability single source of truth
- add only missing creative tools that are executable and ACL-protected

### project/story/scenes routers/services

- use existing scene create/update/bind/version paths
- only extract reusable core functions if Agent currently cannot call them without router coupling

---

# Part G — Expanded Golden Flow Matrix

## 37. GF-C1：一句故事 → 可看的 Storyboard

User:

> 幫我把第一幕做成分鏡。

Pass：

- structured scenes/shots persisted
- ShotCard appears without reload hacks
- image jobs created
- generated assets bind correct shots
- reload remains
- no duplicate shot on retry

---

## 38. GF-C2：一句話 → 第一幕 Rough Cut

User:

> 把第一幕做成可以看的粗剪，30 點內。

Pass：

- inspect existing assets first
- only fill missing pieces
- storyboard images where needed
- shot videos under budget/approval
- voice/audio only where needed
- timeline uses current selected assets
- exact partial state if 30-point cap reached
- no “completed” unless readiness verified

---

## 39. GF-C3：多選 Shot 批量改時間/光線

Select 3 shots:

> 全部改黃昏，人物跟構圖不要變。

Pass：

- only selected IDs targeted
- reference-aware edit/regenerate
- new versions
- old versions preserved
- per-shot result
- failed one does not make whole run falsely complete

---

## 40. GF-C4：角色換裝，只重做受影響鏡頭

User changes Character Look.

Pass：

- impacted shots detected
- unaffected shots remain green
- images/videos that depend on old look marked stale
- user sees impact before costly rerender
- rerender uses new look refs

---

## 41. GF-C5：切回舊 Image，downstream Video 變 stale

Pass：

- current pointer changes
- old image becomes current
- video built from another parent is marked impacted/stale
- no silent green status
- user can regenerate video from selected image

---

## 42. GF-C6：只改旁白，不重生影片

User:

> 旁白最後一句改掉，其他都不要動。

Pass：

- only relevant text/audio changes
- video/image unchanged
- voice new version
- timing issue surfaced if duration changes materially

---

## 43. GF-C7：補整幕聲音

User:

> 幫第一幕把缺的聲音補齊。

Pass：

- narration/dialogue/ambience/SFX/music needs inspected
- existing tracks reused
- generated missing only
- music span semantics respected
- no duplicate audio generation on retry

---

## 44. GF-C8：Provider batch 中途故障

Inject 429 / 5xx / timeout.

Pass：

- completed shots remain completed
- failed shot retry bounded
- no double billing
- no duplicate assets
- UI says partial/retrying/failed truthfully

---

## 45. GF-C9：Storage 成功前不能 completed

Inject provider success + storage fail.

Pass：

- run not completed
- no dangling current pointer
- retry path safe

---

## 46. GF-C10：Attach fail

Inject asset persisted + scene binding fail.

Pass：

- asset preserved
- run shows partial/fixable
- retry only attach when safe, not regenerate/pay again

---

## 47. GF-C11：Human edit collision

Agent reads Shot 08, human changes it before Agent writes.

Pass：

- conflict detected
- Agent does not overwrite
- asks/re-resolves
- no false completion

---

## 48. GF-C12：Reload / close tab / reconnect

Pass：

- run continues/restores from durable state
- visual workspace restores run status
- no duplicate generations
- selection may reset safely, but active goal target remains durable

---

## 49. GF-C13：免費優先

User:

> 免費模式把能做的都做完。

Pass：

- no paid fallback
- finishes free-capable steps
- shows blocked paid-only steps as blocked, not failed/completed
- offers explicit alternatives

---

## 50. GF-C14：Auto-under-threshold

Policy: single action <= X points may auto-run.

Pass：

- cheap allowed steps run
- expensive one pauses
- no hidden split intended solely to bypass threshold

---

## 51. GF-C15：External editor roundtrip

Pass：

- selected project assets/timeline handoff through existing integration
- return/import keeps provenance
- Aios can review/link returned result
- does not silently replace project source assets without user action

---

## 52. GF-C16：Final delivery readiness

User:

> 這支片還差什麼才能交付？

Pass：

- answer comes from shotCompletion/timeline/delivery truth
- missing items are actionable
- “全部完成” only if actual required tracks/review satisfy contract

---

# Part H — Performance / Scale / Reliability

## 53. Batch generation concurrency

不要 `Promise.all(30 shots)` 無限制灌 provider。

需：

- bounded concurrency
- provider-specific/rate-limit-aware queue
- cancellation
- retry/backoff
- per-target idempotency

---

## 54. Polling

現在 SceneStudio / other surfaces 已有 polling。

新增 Visual Workspace 不可再讓：

```text
20 ShotCards × versions polling
+ Agent panel polling
+ Pipeline polling
+ Delivery polling
```

爆成 N+1。

### 優先

- aggregate creative status
- existing event stream where available
- query invalidation on known writes
- active-run fast polling only
- idle slow/no polling

---

## 55. Media rendering

- lazy load thumbnail
- video preload metadata or none where appropriate
- do not auto-play 12 videos simultaneously
- signed URL expiry refresh through existing query path
- no base64 in React state for persistent assets

---

# Part I — Security / Billing / Provenance

## 56. Every write

必須：

1. current identity
2. group/project ACL
3. selected entity belongs to project
4. source asset visibility
5. project state
6. provider/model ready
7. cost/policy gate
8. idempotency
9. execution
10. persisted read-back
11. receipt

---

## 57. Prompt/context data minimization

Provider payload 只送生成必要內容。

不要因為 Agent 有 DB 能力就把：

- whole custom DB
- unrelated notes
- members
- private messages

全部丟給 provider。

---

## 58. Provenance

對 AI / imported/external edited asset 至少保留可追來源。

UI 可說：

```text
AI generated
Imported
External edited
```

不要保證「copyright safe」除非真的有對應可驗證授權資料。

---

# Part J — Test Matrix

## 59. Pure/Unit

必測：

- creative stage projection
- action applicability
- selection precedence
- stale selection rejection
- model policy free/max points
- context fingerprint deterministic
- dependency impact
- version lineage
- selected uniqueness
- downstream stale
- partial recompute
- run phase projection
- completion guards

---

## 60. Server Integration

必測：

- story → scenes
- Agent create/update shot under ACL
- image gen → asset → bind → read-back
- video gen → asset → bind → lineage
- audio missing-only
- budget stop
- approval pause
- retry idempotency
- provider success/storage fail
- storage success/attach fail
- concurrent human update conflict
- reconnect/resume

---

## 61. Client

必測：

- Pipeline from server truth
- Storyboard selection
- multi-select
- PromptBar scope
- dynamic action palette
- run phase status
- per-shot partial fail
- version compare/select
- stale downstream warning
- Bible tabs/ref counts
- delivery integration
- 390px
- keyboard/a11y

---

## 62. Existing regressions

至少：

```text
AICreativeCopilot
StoryboardStage / ShotCard
SceneStudio
DeliveryRoom
Animation Studio timeline
assistant context
agent runner
agent DB tools (#706)
generation billing
MCP catalog
story parser
external intake/editing
collaboration relevant writes
```

---

## 63. Mandatory commands

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

若 DB migration：

```text
npm run db:migrate:dry-run
npm run db:check
npm run verify:database-runtime
npm run verify:agent-db-integrity
```

Gemini/live provider 缺 key：

```text
BLOCKED_BY_EXTERNAL_DEPENDENCY
```

不可 mock 之後寫 live PASS。

---

# Part K — 實作順序，避免做很久但仍「感覺沒變強」

## Phase 0 — Sync & Converge

- sync #706 merged default
- update paths/interfaces
- resolve overlap
- baseline tests

## Phase 1 — Creative State + Selection + Action Palette

- CreativeProjectStatus projection
- reuse assistantContext selection
- project-gap action applicability
- Visual Pipeline
- scoped prompt/action surface

**完成這一步，Aios 就會開始「知道作品現在在哪」。**

## Phase 2 — Storyboard Agent E2E

- story/scene/shot context
- structured planning
- create shots via existing write core
- Gemini Image/provider route
- asset bind/read-back
- per-shot progress

**完成這一步，「把第一幕做成分鏡」會真的長出作品。**

## Phase 3 — Bible + Continuity + Versions

- Bible projection
- verified refs
- context fingerprint
- version lineage
- stale/downstream impact
- repair flow

## Phase 4 — Video + Audio

- selected shot → video
- video edit/regeneration semantics
- voice/dialogue/ambience/SFX/music missing-only
- retries/cost gates

## Phase 5 — Rough Cut / Finish

- selected versions → existing Timeline
- finish gaps
- preview/render/handoff
- Delivery integration

## Phase 6 — Hardening

- conflict injection
- provider failure
- billing idempotency
- reload/resume
- mobile/a11y
- two fresh-eye rounds

---

# Part L — Ready Gate 2.0

PR #707 保持 Draft，直到下列全部符合，或誠實標示 external-blocked：

## Base / architecture

- [ ] synced current default containing #706
- [ ] no second Agent runtime
- [ ] no second DB ACL
- [ ] no second generation ledger/storage
- [ ] no second selection store
- [ ] no redundant version source of truth
- [ ] no duplicate timeline model

## Creative state / visual UX

- [ ] persisted CreativeProjectStatus projection
- [ ] Visual Project Pipeline
- [ ] Storyboard remains central work surface
- [ ] current selection feeds Aios scope
- [ ] scoped Prompt Bar / Action Palette
- [ ] Creative Bible projection
- [ ] per-shot versions/lineage
- [ ] live Agent phases + target progress
- [ ] blocked/partial/failure truthfully represented

## Agent execution

- [ ] story → shots
- [ ] shots → images
- [ ] consistency/ref repair
- [ ] images → video
- [ ] audio missing-only completion
- [ ] timeline / rough-cut readiness
- [ ] delivery gap analysis
- [ ] durable reconnect/resume

## Model/cost

- [ ] aiModelPolicy extended, not duplicated
- [ ] quality/speed/budget/free policies
- [ ] free_only hard gate
- [ ] max points hard gate
- [ ] approval threshold cannot be bypassed
- [ ] fallback is explicit/explainable

## Correctness

- [ ] no false completion
- [ ] no duplicate billing
- [ ] no duplicate assets on retry
- [ ] no wrong-shot write
- [ ] no human-edit overwrite
- [ ] no silently stale downstream media

## Finish

- [ ] timeline uses existing frame truth
- [ ] narration/ambience/music semantics integrated
- [ ] external editing / delivery existing paths reused

## UX

- [ ] default mode does not require model IDs
- [ ] creator can manually override Agent
- [ ] pro mode can inspect provider/model/cost/lineage
- [ ] ~390px usable
- [ ] accessibility checks

## Validation

- [ ] required unit/integration/client tests
- [ ] typecheck
- [ ] build
- [ ] integrity checks
- [ ] two fresh-eye rounds: Creator + Failure/Concurrency
- [ ] live provider evidence honest

---

# Part M — 明確 Non-goals

本 PR 不做：

- Deep Research product mode
- default node graph / ComfyUI clone
- new full NLE/Premiere replacement
- new collaboration engine
- fake multi-agent employee accounts
- custom model training pipeline
- massive schema rewrite for “future flexibility”
- separate creative database detached from existing project/scene/assets

---

# Part N — 最後產品驗收句

以下一句話如果還做不到，PR #707 就不能把「全方位創作代理」宣稱完成：

> **「Aios，把這個故事的第一幕做成一個可以看的粗剪；人物保持一致，30 點內，缺的聲音也補上。完成後告訴我哪些地方還需要我決定。」**

Aios 應該：

```text
讀現有作品
→ 不重做已有內容
→ 建/補 Shots
→ 選 References
→ 選合適模型
→ 生成缺少 Images
→ 檢查/修復一致性
→ 生成所需 Videos
→ 補 Voice / Ambience / SFX / Music
→ 選 current versions
→ 組成 existing Timeline rough cut
→ 停在需要人的 approval/creative decision
→ read-back verify
→ 回一份可操作的 Change Set / Remaining Issues
```

而不是回一段「建議你接下來可以……」。

**這就是 PR #707 的最終產品標準。**

---

## Research references（官方產品資料，僅作產品機制研究）

- Google Flow — https://labs.google/fx/tools/flow
- Adobe Firefly workspace / Boards / Timeline — https://helpx.adobe.com/firefly/
- Adobe Firefly storyboard workflow — https://helpx.adobe.com/firefly/how-to/create-commercial-storyboard-firefly-boards.html
- ElevenCreative Flows — https://elevenlabs.io/docs/eleven-creative/products/flows
- ElevenCreative Studio — https://elevenlabs.io/docs/eleven-creative/products/studio
- Runway Gen-4 / References — https://runwayml.com/research/introducing-runway-gen-4

外部產品會持續變；實作決策仍以 **Aios CURRENT repo truth + 使用者產品目標** 為優先。