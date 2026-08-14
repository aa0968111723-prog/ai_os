# AIOS Production Consistency Closure Master Plan

## 0. Purpose

AIOS 已完成 production-wide consistency 的核心地基：Project Consistency Graph、immutable Shot Context Packet、Candidate/explicit Adopt、Team Canon、Scene Package、Character Slots、provider-aware reference mixing、cross-shot continuity、Project UX 與 hardening。

本計畫不是再建立一套一致性架構，而是完成最後的 production closure：

> 讓同一份故事一路經過 Image → Video → Voice → Ambience/SFX/Music → Timeline → Delivery 後，仍然維持同一批人物、Look、場景、道具、視覺風格、聲線、聲音世界與可追溯血緣。

底層可以很深，但 Project/Story UX 必須維持 Invisible Complexity。

---

## 1. Verified baseline and mandatory reconciliation gate

建立本計畫時已核對 GitHub：

- #752 merged：production-wide consistency umbrella plan
- #753 merged：graph / packet / preflight / continuity / Candidate-Adopt / delivery blockers runtime
- #754 merged：Team Canon → Canon-to-Shot → Project UX master plan
- #756 merged 到 default：Team Canon foundation
- #757 顯示 merged，但 base 是 `agent/team-canon-pr-a`
- #758 顯示 merged，但 base 是 `agent/team-canon-pr-b`
- #759 顯示 merged，但 base 是 `agent/team-canon-pr-c`
- default 與 `agent/team-canon-pr-d` 目前仍 diverged；不得把 GitHub UI 的「merged」誤判為 #757～#759 已全部進 default
- #755 是獨立大型 Storyboard 100–300 鏡 scaling/query-fanout 主線

### FC-00 — Stack landing reconciliation

任何 runtime 實作開始前，必須先確認最新 default 是否真正包含 #757～#759 的 unique commits。

若尚未包含：

1. 不得從舊 default 重做 #757～#759。
2. 逐支比較 default 與 PR-B/PR-C/PR-D heads。
3. 用安全、可 review 的方式把缺少的 unique commits forward-port / retarget / landing 到最新 default。
4. 保留既有 migration 0074→0076、Scene Package、Character Slots、Reference Mixer、Continuity、Project UX、Hardening 語意。
5. 完成後重新跑 typecheck、affected tests、migration chain 與最小 browser smoke。

只有 FC-00 確認 default 已真正包含 #756～#759 全部能力後，才進入本計畫後續 implementation PR。

---

## 2. Non-negotiable architecture rules

不得建立第二套 consistency source of truth。

所有新增能力必須延續並消費既有：

- Team Canon + immutable versions
- Project Canon Pin
- Scene Package
- Character Slots
- Shot Context Packet
- Candidate / explicit Adopt
- generation lineage
- targeted stale propagation
- delivery blockers
- `creativeContext.workspace` server-authoritative projection

禁止新增 competing：

- Style manager truth
- Voice manager truth
- Audio consistency database
- Timeline consistency database
- AI memory database
- client-side consistency calculator

若既有 schema/records 可以表達，優先擴充既有資料模型、dependency projection 或 immutable snapshots。

---

## 3. P0 — Approval resume execution-rights revalidation

#759 已誠實留下限制：cost approval 等待期間若 Canon `generationAllowed` / reuse rights 被撤回，resume 可能仍沿用送出時 frozen adapter/params。

必須在真正送 provider 前做 execution-time revalidation，至少重新確認：

- Canon entry/version 仍存在
- version 未 archived/revoked
- generationAllowed 仍允許
- reuseScope / project access 仍合法
- adapter/reference asset rights 仍合法
- tenant/project membership 仍合法

規則：

- Shot Context Packet 仍是 frozen historical intent，不得整包偷偷 rebuild
- execution rights 是送 provider 當下必須重驗的 mutable authorization layer
- 權限失效時不得 call provider、不得 silent fallback、不得多扣成本
- 回傳 structured blocker + audit event
- duplicate approval/resume 必須 idempotent
- concurrency 下不得穿透 revocation

---

## 4. P0 — Style Canon becomes a real consumer

目前 style 可出現在 Scene Package/Canon 語意，但必須完成真正 runtime consumption。

需要讓 Project / Sequence / Scene / Shot style 經由既有 canonical dependency 流進：

Canon/pin → Scene Package → Shot Packet → provider preparation/reference mixer → generation metadata → Candidate evaluation → Adopt → downstream lineage。

至少覆蓋：

- visual style identity
- palette
- lighting language
- illustration/rendering language
- camera language
- negative style constraints

不得只把 style 拼成 prompt 字串就宣稱完成。

若 provider 支援 style reference / image reference / LoRA / negative prompt，應由 capability matrix 誠實選擇；不支援時輸出 structured downgrade/warning，不得假稱已鎖定。

---

## 5. P0 — Voice Canon and durable voice identity

角色聲線必須成為真正的 canonical dependency，而不是每次靠角色名稱重新選 voice。

Character Canon 可指向 durable Voice descriptor/version，至少包含：

- provider/model
- voice/speaker ID
- language/locale
- optional reference asset
- generation rights
- version/provenance

流程：

Character Canon → active Voice version → dialogue/narration intent → voice generation → audio asset → Candidate/current → lineage → Timeline。

更新 Voice 時只 stale 真正依賴舊 Voice version 的 audio/timeline artifacts，不得全專案 stale。

---

## 6. P0 — Scene/Sequence Sound World

Scene/Sequence 應能共用 canonicalized sound world，例如：

- ambience identity
- environmental tone
- music world
- instrumentation
- SFX language
- mood/loudness intent

Scene Package 應凍結本場的 sound-world dependency，後續 audio generation / selected assets / Timeline 都應可追到同一份 dependency。

不得每一鏡重新生成互不相關的 ambience 而仍宣稱一致。

---

## 7. P0 — Full media lineage closure

把現有 image/video lineage 延伸成完整 production lineage：

Script revision
→ Scene Package
→ Shot Context Packet
→ adopted image
→ generated video
→ dialogue/narration
→ voice asset
→ ambience/SFX/music
→ timeline clip/selection
→ delivery

每個 downstream artifact 必須能回答：

- parent asset / source selection
- originating Shot Packet / Scene Package
- Canon/version dependencies
- current/candidate relationship
- provider/model/parameter snapshot
- rights status
- stale status

不得依賴檔名、UI 狀態或 prompt 文字推測 lineage。

---

## 8. P0 — Targeted downstream stale propagation

dependency 改變時，只 stale 真正依賴它的 downstream artifacts。

例：

- Look 更新 → 使用該 Look 的 shot image → dependent video → corresponding timeline clips
- Voice 更新 → 使用該 voice version 的 voice clips → dependent timeline segments
- Sound World 更新 → dependent ambience/music/SFX → timeline
- Style 更新 → 使用舊 style dependency 的 visual artifacts
- adopted image 更新 → 以舊 image 為 parent 的 image-to-video artifact

禁止「改一個角色/設定 → 整個 Story 全 stale」。

current 舊成果必須保留；新結果走 Candidate → explicit Adopt。

---

## 9. P1 — Durable Prop state continuity

#757 已有 prop ownership/preflight 與 script-authorized transfer detection，但目前仍明確留下「轉手不可靠地改 heldProp」限制。

完成 durable prop state：

- acquire
- give
- receive
- drop
- lose
- break
- open/close
- consume
- transform

例：藏寶圖由角色 A 交給 B，下一鏡 B 查看地圖時，continuity start state 應能繼承真正 holder/owner state。

若 recipient/target 無法可靠解析：

- 不准猜
- 產生 structured unresolved state
- 交由既有 Project/Story confirmation flow 解決

script-authorized change 與 unintended drift 必須分開。

---

## 10. P1 — Multi-character identity routing

#757 capability matrix 已誠實標示目前 multi-character identity support，而不是假裝 provider 一定能鎖多人。

下一步不能只停在 warning；建立 provider-aware routing policy：

1. 根據 Shot character slots + required reference roles 計算需求。
2. 若目前模型能力不足，優先選可用且已配置、符合權限/成本政策的 capability-compatible model。
3. 若無可靠模型，降級 reference strategy並明確 warning。
4. 必要時要求使用者確認或使用 bounded staged composition strategy。
5. 不得偷偷把四個身份 reference 全塞進只可靠支援單人的模型並宣稱一致。

不得自動呼叫未授權 paid provider。

---

## 11. P1 — Server-authoritative Project Consistency Scorecard

擴充既有 `creativeContext.workspace` / consistency projection，不另建 competing score service。

至少覆蓋：

- Identity
- Look
- Scene
- Prop
- Style
- Continuity
- Voice
- Sound World
- Lineage
- Delivery readiness

狀態至少支援：

- OK
- warning
- blocker
- stale
- unresolved
- capability downgrade

每個 finding 可回傳真正 `affectedShotIds` / artifact IDs 與 repair reason。

不要把所有維度粗暴平均成一個沒有診斷價值的百分比。

---

## 12. UX — Invisible Complexity repair flow

不得新增頂層「一致性管理中心」。

維持現有 Project/Story workspace：

第一層只顯示人話，例如：

- `18 / 20 鏡一致`
- `2 鏡需要確認`
- `1 段聲音需要更新`
- `角色聲線已套用`
- `場景聲音已延續`

點開後才顯示：

問題 → 受影響鏡頭/素材 → 原因 → 建議修復 → Candidate → Compare → explicit Adopt。

一般 UX 不直接暴露 fingerprint、packet UUID、adapter rank、LoRA weight 或 raw lineage graph。

不得 silent regenerate / silent Adopt / silent Promote / silent Canon upgrade。

---

## 13. Full-script golden acceptance scenario

建立固定、可重跑的 production acceptance fixture，至少包含：

- 4 個主要角色
- 山嵐
- 淺水灣海灘
- 街頭
- 仁濟安老院
- 音樂挑戰
- 單人、雙人、多人團體鏡
- 下雨/濕衣 continuity
- 合法換裝
- Prop 轉手
- Image generation lineage
- Image-to-video lineage
- Character voice
- ambience
- SFX
- music intent/assets
- Timeline selection
- Delivery blockers

必須驗證：

1. identity 跨場景不亂變
2. Look 未授權不漂移
3. 合法換裝不被誤判
4. 場景 identity 與 environment state 分離
5. 濕衣 continuity 延續
6. Prop holder/state 正確或明確 unresolved
7. Voice identity 不亂換
8. Sound World 不無故漂移
9. I2V 不因 fallback 換人
10. Canon 更新只 stale 真依賴內容
11. Timeline 不使用 stale/unapproved selection
12. Delivery 阻擋真正不可交付內容
13. rights 在 approval resume 前撤回時 provider 不被呼叫

付費 generation/training 不得為了測試而擅自執行。可以用 deterministic provider adapters/fixtures 驗證 lineage、routing 與 rights；若真外部 provider 是唯一驗收條件，標記 `BLOCKED_BY_EXTERNAL_DEPENDENCY`。

---

## 14. Testing and evidence

Implementation 必須包含：

- unit tests
- PostgreSQL integration tests
- migration 0000→latest
- CAS/concurrency tests
- idempotency tests
- rights revocation/resume tests
- targeted stale propagation tests
- lineage tests
- Candidate/Adopt tests
- browser E2E
- 390 / 430 / 1280 / 1440 viewport evidence
- full-script golden acceptance results

不得只用 mock DB 宣稱 migration/concurrency 已完成。

---

## 15. Performance boundary with #755

本計畫不得搶 #755 的大型 Storyboard 100–300 鏡 transport/query/render scaling scope。

允許：

- 不新增明顯 N+1
- 為本功能加 bounded batch read/write
- 記錄新的 performance blocker

不允許：

- 在本 stack 全面重構 large-board transport/render architecture
- 改寫 #755 的 authoritative scaling plan

若 golden acceptance 發現 100+ shot scaling 問題，記錄 evidence 並交由 #755 主線處理。

---

## 16. Recommended implementation stack

完成 FC-00 後，從真正包含 #756～#759 的最新 default 建立 bounded stacked Draft PR：

### PR-A — Execution rights + Style/Voice/Sound runtime closure

- approval resume rights revalidation
- Style Canon consumption
- Voice Canon consumption
- Sound World consumption
- capability/downgrade contracts

### PR-B — Full media lineage + targeted downstream stale

- image/video/audio/timeline/delivery lineage
- dependency edges
- targeted artifact staleness
- current preservation + Candidate/Adopt

### PR-C — Prop continuity + multi-character routing + repair UX

- durable prop state
- unresolved transfer confirmation
- provider-aware multi-character routing
- consistency scorecard projection
- invisible-complexity repair UX

### PR-D — PostgreSQL/browser/full-script hardening

- real PG evidence
- concurrency/idempotency adversarial tests
- 390/430/1280/1440 evidence
- golden full-script acceptance
- final audit and confirmed finding fixes

若 audit 顯示更好的 bounded split，可調整，但不得把全部內容塞進單一巨大 PR。

---

## 17. Definition of Done

只有在以下成立才算完成：

> 使用者把同一份故事做到圖片、影片、聲音與 Timeline，系統仍能指出每個結果依賴哪個 Character、Look、Scene、Prop、Style、Voice、Sound World、Scene Package 與 Shot Packet。

並且：

> 改一個 Canon 只影響真正依賴它的內容；舊 current 不被偷偷替換；新成果遵守 Candidate → explicit Adopt；rights 撤回可在真正 execution 前生效。

最終驗收不是「資料庫有 consistency 欄位」，而是：

> 不看 prompt，只看完整 storyboard + rough cut + audio，仍能辨認這是同一批人物、同一世界、同一視覺風格與同一聲音語言完成的連續作品。

---

## 18. Safety / execution rules

- docs plan PR 本身不得修改 runtime/schema/UI
- implementation 全部 Draft
- no auto-merge
- no force-push
- no direct default push
- no fake generation/training
- no second source of truth
- no silent Adopt/Promote/upgrade
- no project-wide indiscriminate stale
- no unauthorized paid provider calls
- 任務大也不得停在 TODO/scaffold；持續做到每支 PR 的 Definition of Done，除非是真外部 blocker

---

## 19. Short execution instruction

> 完整執行本 PR 的 `docs/plans/AIOS_PRODUCTION_CONSISTENCY_CLOSURE_MASTER_PLAN.md`。先做 FC-00，確認 #757～#759 的 unique commits 真正 landing 到最新 default；不得把 stacked PR 的「merged」誤認為已進 default。之後從完整最新 default 建 PR-A～PR-D stacked Draft implementation PR，完成 execution-rights revalidation、Style/Voice/Sound runtime、full-media lineage、targeted stale、Prop continuity、multi-character routing、server-authoritative scorecard、Project repair UX、真 PostgreSQL/browser/full-script hardening。嚴守 no second truth、no fake provider、no silent Adopt/Promote、no auto-merge/force-push，且不要搶 #755 scaling scope。最後只回報實際 PR numbers、base/head、PASS/BLOCKED evidence、remaining P0/P1 與真正外部 blocker。