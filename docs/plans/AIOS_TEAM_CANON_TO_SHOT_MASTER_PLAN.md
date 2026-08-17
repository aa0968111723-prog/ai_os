# AIOS Team Canon → Canon-to-Shot → Project UX Master Plan

> 本文件是 PR #752 / #753 之後的下一階段 authoritative execution plan。
> 目標不是再增加零碎功能，而是把「團隊長期可重用的一致性資料 → 腳本 → 多場景／多角色／混合素材分鏡生成 → 圖影聲 → 極簡 Project UX」完整閉環。

## 0. Execution contract

這不是純研究任務。實作代理必須先讀 repo 規範、#752、#753 最終 diff 與目前 default HEAD，之後實際建立 runtime code、migration、tests、browser evidence 與 stacked Draft PR，持續做到 Definition of Done。

禁止：

- 建立第二套資料真相或第二個 AI 記憶資料庫
- 重做 #753 已有的 graph / packet / preflight / candidate / adopt / delivery semantics
- mock / fake generation / setTimeout 假完成
- evaluation silent-adopt
- training completed 後 silent-promote
- provider capability 不足卻宣稱「一致性已鎖定」
- ProjectPage 另算一套 readiness / consistency truth
- 將 project-private 或 rights 未核准素材自動升級成 Team training data
- 為求方便把所有人物、場景、風格塞進一個巨型模型

若 #753 已 merge，所有 runtime implementation 從最新 default HEAD 開始；若 default 後續已變更，先 reconciliation，再實作，不得依賴舊 SHA。

---

# 1. Product north star

Aios 必須從「單一 Project 一致性」升級成「團隊長期創作記憶」。

```text
Team Canon
  ↓
Approved references / training datasets / model candidates
  ↓
Immutable Canon Versions
  ↓
Project Pinning
  ↓
Script Canon Binding
  ↓
Scene Package
  ↓
Shot Composition + Character Slots
  ↓
Provider-aware Mixed Reference Generation
  ↓
Consistency Evaluation
  ↓
Candidate → Explicit Adopt
  ↓
Cross-shot / Cross-scene Continuity
  ↓
Image → Video → Voice / Audio → Timeline → Delivery
```

團隊建立一次人物、場景、道具、風格、聲線與世界素材後，未來每一個新腳本都應能重複使用同一 Canon，而不是 copy 出互相漂移的新角色。

核心原則：

> **Reuse by reference / pin, not copy.**

---

# 2. Team Canon

先盤點並最大化重用既有 schema / services：characters、looks、scene presets、props、assets、knowledge、training manifests/jobs/model versions、rights、ACL、creative context。

只有現有模型無法正確表達時才做 additive migration。

至少支援以下 Canon 類型：

- Character
- Character Look
- Scene
- Prop
- Style
- Voice
- Sound World

每個 Canon 需要：

- stable canonical ID
- owner team / scope
- provenance
- lifecycle status
- rights / reuse readiness
- approved references
- production version
- candidate versions
- archived versions
- createdBy / updatedBy / timestamps

## Canon Version

Canon Version 必須 immutable：

- version ID
- parent version
- deterministic fingerprint
- reference IDs
- dataset fingerprint（若有 training）
- adapter/model linkage
- evaluation summary
- created reason
- promote / rollback history

不得把 V7 原地修改成另一個東西；必須新增 V8。

---

# 3. Training as Canon enhancement

Training 不是獨立工程頁，而是 Canon 的增強能力：

```text
Canon
→ approved assets
→ dataset candidate
→ review
→ immutable dataset manifest
→ durable training job
→ model candidate
→ evaluation
→ human promote
→ production Canon version
```

沿用既有 training architecture，不建立第二套 jobs / versions。

模組化支援：

- Character Identity
- Character Look
- Scene Identity
- Style
- Voice

一般 UX 不顯示 epoch / learning rate / rank 等工程設定；放在 Advanced diagnostics。

一般成員只看到：素材數量、可用／待確認／不建議、是否可「加強一致性」、Production 與 Candidate 比較、Promote。

Training 完成不得自動 Promote。

---

# 4. Project Canon Pinning

Project 不 copy Team Canon，而是 durable pin/reference：

```text
Project 白日夢島
魯夫 → Character Canon #001 / V7
娜美 → Character Canon #002 / V4
索隆 → Character Canon #003 / V6
淺水灣 → Scene Canon #023 / V3
仁濟安老院 → Scene Canon #031 / V2
藏寶圖 → Prop Canon #016 / V5
白日夢島風格 → Style Canon #004 / V6
```

支援：

- PINNED：固定 version
- UPDATE_AVAILABLE：Team 有新版，但 Project 不 silent-update

例如 Team 魯夫 V7 → V8：

- 顯示目前 Project 使用 V7
- 顯示新版 V8
- 計算 affected scenes / shots / current media
- 顯示 regeneration scope
- 原 current 保留
- 升級後只 stale 真正依賴舊版本的 Shot
- 新生成結果進 Candidate，不直接替換 current

---

# 5. Script → Canon Binding

腳本 mention 必須 durable 綁定 project-pinned Canon：

```text
「魯夫和娜美拿著藏寶圖來到淺水灣」

魯夫 → pinned Character Canon
娜美 → pinned Character Canon
藏寶圖 → pinned Prop Canon
淺水灣 → pinned Scene Canon
```

需求：

- revision-aware
- reload-safe
- provenance-aware
- ambiguous mention → pending confirmation
- explicit user correction wins
- reparse 不可任意換 canonical ID
- edit 只 invalidates 真正相關 dependency

修改一個 Character Look 不得 stale 全專案，只 stale 使用該 Look 的 Shot。

---

# 6. Scene Package

不要讓每個 Shot 從零重新理解整個場景。

建立／完成 Scene Package：

- Scene Canon + pinned version
- environment state
- time / weather / lighting
- active characters
- active looks
- props + ownership/state
- style
- sound world
- camera language
- narrative goal
- entry continuity
- exit constraints
- fingerprint / stale status / version history

Scene Package 可供該 Scene 下所有 Shots 繼承，並凍結進 Shot Context Packet。

---

# 7. Shot Composition Engine

Shot 的 domain model 應為：

```text
Scene Package
+ Previous Shot End State
+ Current Shot Delta
```

而不是 giant prompt。

至少結構化表達：

- framing / camera
- active characters
- positions
- poses
- gaze
- actions / interactions
- expressions
- props / owners / states
- environment delta
- start/end continuity
- explicit script-authorized change

Shot compiler 最後才把 provider-independent intent 轉成 provider payload。

---

# 8. Multi-character Character Slots

多角色不能只把 N 張圖無差別餵 provider。

建立 Character Slot abstraction：

- canonical character ID/version
- active Look/version
- identity refs
- Look refs
- frame position
- pose
- expression
- action
- owned props
- reference priority

必須降低：

- face swap
- clothes swap
- wrong prop owner
- missing character
- accidental duplicate character
- cross-character reference contamination

若 provider 不支援真正 multi-character identity conditioning，preflight 必須真實 downgrade 或 block high-consistency mode，不能 UI 假稱已鎖定。

---

# 9. Scene / Prop / Style / Continuity / Composition Slots

延續 #752 reference roles：

- identity
- look
- scene
- prop
- style
- composition
- continuity

每份 reference 必須帶：

- role
- canonical source/version
- priority
- provider-independent weight intent
- rights readiness
- provenance

同 role 多個 PRIMARY 衝突要在 provider submit 前 preflight。

---

# 10. Provider-aware Reference Mixer

上層 domain 不綁單一生成模型 API。

```text
Shot Intent
→ Reference Requirements
→ Provider Capability Matrix
→ Provider Adapter
→ Provider Payload
```

capability 至少描述：

- max references
- multi-character support
- identity adapter support
- style adapter support
- scene reference support
- image-to-video support
- seed support
- control/composition support
- async job semantics

不同 provider 可用 native multi-ref / LoRA / identity conditioning / image refs / structure controls / previous adopted frame；但上層仍使用同一 Shot Intent。

必要能力不支援時，不可宣稱完整一致。

---

# 11. Cross-shot / Cross-scene continuity

深化 #753 continuity，至少支援：

Character：position、costume、wetness、dirt、injury、emotion、held/equipped props。

Prop：owner、location、visible/damaged state。

Scene：weather、time、environment state。

```text
Project continuity
  ↓
Scene continuity
  ↓
Shot continuity
```

Shot N end-state → Shot N+1 start-state。

必須區分：

- UNINTENTIONAL_DRIFT
- SCRIPT_AUTHORIZED_CHANGE

例如「魯夫脫掉紅外套」是合法狀態改變，不得報 clothing drift。

time_jump、montage、flashback、dream、explicit costume change 可解除／轉換部分 continuity constraints。

---

# 12. Evaluation → Candidate → Adopt

Generation success != Shot completion。

每個 Candidate 對 frozen Shot Packet 分維度評估：

- character identity
- Character Look
- Scene identity
- prop correctness / ownership
- style
- composition
- continuity
- completeness

Findings 使用 stable machine codes，例如：

- character_identity_drift
- look_mismatch
- scene_mismatch
- missing_prop
- wrong_prop_owner
- continuity_position_break
- continuity_costume_break
- style_drift

Evaluation 不得改 current。

流程固定：

```text
Generate
→ Candidate
→ Evaluate
→ Compare
→ Explicit Human Adopt
→ Current
→ extract end-state
→ downstream dependency update
```

old Candidate/current 必須可追溯。

---

# 13. Image → Video → Audio → Timeline → Delivery

一致性必須貫穿產線：

- Image：完整 Shot Packet
- Video：只能由 adopted/current image 或 explicit parent 生成
- Voice：綁 Character Canon voice ID/version
- Ambience：Scene Sound World
- Music：Project / Sequence style
- SFX：Shot event
- Timeline：只用 selected current versions

Delivery blockers 至少：missing current、stale、unapproved、rights blocked、missing parent、broken lineage、A/V linkage error。

---

# 14. Project UX — Invisible Complexity

底層可以深，Project UX 必須非常簡單。

普通創作者主要只理解：

```text
故事
↓
確認少數問題
↓
分鏡
↓
修正異常
↓
成果
```

不要建立新的頂層「Canon 管理中心」「Consistency Graph」「Adapter」「Fingerprint」「Training Engineering」頁。

角色、Look、場景、道具、素材、知識應成為 Story context，而不是互相競爭的管理入口。

目標首屏：

```text
白日夢島
✓ 可以繼續製作 · 3 項待確認 · 2 鏡需要修正

故事
[ screenplay ]

Scene 03 / 淺水灣
魯夫 · 娜美 · 藏寶圖
✓ 素材已準備

Storyboard
01 ✓   02 ✓   03 ⚠   04 ✓

[繼續製作]
```

同時只允許一個 visually-primary CTA，由 server `nextAction` 驅動。

---

# 15. ProjectPage architecture

實際瘦身 ProjectPage：

ProjectPage 只負責：

- route
- permissions
- current selection
- minimal orchestration

以既有 `creativeContext.workspace` 為 server-side authoritative projection；擴充它，不另做 competing projection。

建議消費層：

- StorySurface
- ContextDrawer / mobile sheet
- ResultDrawer / repair
- Project Assistant

禁止 ProjectPage 同時自己 query 多套 entities 再 client-side 重算 readiness/consistency。

Projection 回傳 summary / IDs / states / nextActions；大素材與詳細歷史點開再 fetch。避免 N+1、重複 request、過度 polling。

---

# 16. UX detail

## First-screen status

邏輯仍分開：

- world completeness
- visual coverage
- generation readiness
- consistency health

但第一層只顯示人話，不製造單一假百分比。

## Shot Card

預設只顯示：thumbnail、Shot number、一行描述、status、必要 repair action。

prompt/model/seed/adapter/fingerprint/packet JSON/cost/reference details 全部移到 Advanced。

## Training UX

只顯示素材 readiness、是否可加強、Production vs Candidate、比較與 Promote。

---

# 17. Mobile / accessibility

必須驗證：390、430、1280、1440。

要求：

- 44px targets
- mobile 一次一個主要工作面
- Drawer / Bottom Sheet
- focus restore / scroll restore
- no accidental horizontal overflow
- keyboard navigation
- visible focus
- meaningful ARIA/status
- focus trap
- reduced motion
- status 不只靠顏色

---

# 18. Durability / concurrency / rights

所有 training、batch generation、evaluation、repair、video generation 都必須 durable；reload/deep-link 後不消失。

處理 duplicate callback、double Adopt/Promote、retry、approval resume、multiple tabs、stale packet submit、late callback。

Old Candidate 不得覆蓋 newer current。

Team Canon 跨專案 reuse 必須尊重：ownership、team scope、allowed reuse scope、training allowed、generation allowed、rights readiness。

Project-private asset 不得自動進 Team Canon / Team training manifest。

---

# 19. Performance

量測並避免：

- first-load query explosion
- duplicated requests
- N+1
- oversized workspace projection
- idle polling
- repeated large asset payload

Heavy drawers lazy load；projection 只傳必要 summary/IDs/state。

---

# 20. Required tests

## Unit

- Canon version immutability
- Project pinning
- Canon upgrade impact
- Scene Package
- Character Slots
- reference conflict
- provider capability fallback
- continuity inheritance
- script-authorized change
- evaluation
- Candidate/Adopt
- Promote/rollback

## Integration

- PostgreSQL migration
- Team Canon → Project Pin
- Project Pin → Script Binding
- Script → Scene Package → Shot Packet
- Adopt → next continuity
- Canon upgrade → targeted stale
- reload durability

## UI

- first-screen compact truth
- single CTA
- ContextDrawer
- Shot finding repair
- training candidate compare
- mobile interaction

## E2E

不授權付費 provider 時測到 provider boundary，不得 fake success。

失敗需分類：

- PRE_EXISTING_BASELINE
- REGRESSION_FROM_THIS_PR
- BLOCKED_BY_ENVIRONMENT
- BLOCKED_BY_EXTERNAL_DEPENDENCY

---

# 21. Adventure acceptance scenario

至少用以下故事驗收：

Characters：魯夫、娜美、索隆、騙人布。

Scenes：山嵐、淺水灣、街頭、仁濟安老院、音樂挑戰。

Props：藏寶圖、愛心、清潔工具、樂器。

驗證：

1. 團隊取得藏寶圖。
2. 下雨後抵達淺水灣，衣服濕。
3. 前往街頭，identity 不變，濕度合理延續。
4. 到仁濟安老院，加入索隆的 multi-character shot，不得互換身份／服裝／道具。
5. 某角色明確換裝，屬 script-authorized change，不得誤報 drift。

通過標準：不看 prompt，只看整套 storyboard / rough cut，仍像同一批人物在同一世界持續冒險，而不是每一鏡重新抽卡。

---

# 22. Required PR stack

不要把所有 runtime 塞進一支巨大 PR。

從最新 default 建立 stacked Draft implementation PR：

### PR-A — Team Canon foundation

Team Canon、immutable versions、Project Pinning、training integration、upgrade impact、rights/ACL。

### PR-B — Canon-to-Shot composition

Script Canon Binding closure、Scene Package、Character/Scene/Prop/Style/Continuity slots、provider-aware reference mixer、continuity/evaluation/adopt integration。

### PR-C — Invisible Complexity Project UX

Story-first Project UX、server projection、single CTA、Context/Result Drawer、Shot repair、training compare、mobile。

### PR-D — Hardening

PostgreSQL integration、browser E2E、performance、accessibility、concurrency/idempotency、regression fixes。

每支：Draft、coherent、reviewable、independently tested；no auto-merge、no force push、no direct default push。

不要在 PR-A 完成後停下來詢問。若沒有真正 external blocker，繼續 PR-B → PR-C → PR-D。

---

# 23. Definition of Done

只有以下全部成立才算完成：

1. Team characters/scenes/props/styles/voices 真正可跨專案 reuse。
2. reuse 是 pin/reference，不是 copy。
3. Canon version immutable。
4. Training output 是 Candidate，不 silent Promote。
5. Project 可固定 Canon version。
6. Team 新版可計算 affected Projects/Scenes/Shots。
7. Script mention durable bind Canon。
8. Scene Package 真實參與 Shot compilation。
9. Multi-character 使用 Character Slots。
10. mixed references 有明確 roles/priorities。
11. Provider capability 真實控制 generation strategy。
12. continuity 跨 Shot / Scene。
13. script-authorized changes 不誤判。
14. output 有 structured consistency findings。
15. Candidate 必須 explicit Adopt。
16. Image → Video → Audio → Timeline 保持 lineage。
17. ProjectPage 實際瘦身，不只是換 CSS。
18. 首屏簡單易懂且只有一個主要 CTA。
19. mobile 可完成主要流程。
20. reload 後 durable state 正確。
21. rights/ACL 不被繞過。
22. 無第二套 truth。
23. 無 fake generation/training。
24. 相關 unit/integration/UI checks 通過或被誠實標註 blocker。
25. 建立完整 Draft PR stack 與 evidence。

---

# 24. Final execution message for coding agent

交給 Claude / Fable / Codex 時只需：

> **完整執行本 PR 的 `docs/plans/AIOS_TEAM_CANON_TO_SHOT_MASTER_PLAN.md`。先讀 #752、#753 與最新 default diff，從最新 default 建立 PR-A～PR-D stacked Draft implementation PR，持續做到 Definition of Done。不得停在規劃、不得建立第二套資料真相、不得 fake generation/training、不得 silent Adopt/Promote、不得 auto-merge/force-push。完成後只回報實際 PR numbers、PASS/BLOCKED evidence 與真正外部 blocker。**

最重要的產品原則：

> 團隊把人物、場景、道具、風格、聲音與素材建立一次並持續累積 approved references / training 成果；每個新故事直接引用同一 Team Canon。腳本自動綁定，分鏡自動繼承，多角色、多場景、多 provider、混合素材生成仍保持 identity / world / continuity；普通成員只需要寫故事、確認少數問題、看分鏡、修正異常、繼續製作。

**底層可以非常深，UX 必須非常簡單。**
