# Phone AI × Animation Production — 智慧修復閉環完整實作計畫

> Status: implementation plan after merged #782, #783 and #784.
>
> Product goal: 讓手機上的 Aios AI 助手能直接理解動畫 Production Board / Review Queue 的真實狀態，幫使用者從「發現問題」一路走到「規劃修復 → 明確確認成本 → 執行既有 targeted repair → Compare → Adopt → Review Queue 縮小」，而不是只回答文字或把人丟回桌面工作台。

---

## 0. 為什麼現在做這一層

#782 已經完成 Phone AI Assistant Action-First v2：

- 手機有 Context Capsule；
- Answer / Proposal / Progress / Result / Clarify 卡片；
- verified work progress；
- typed context resolution；
- capability routing；
- 不建立第二套 Assistant；
- 不顯示 chain-of-thought；
- 仍走既有 ACL / approval / points / idempotency / Candidate → Adopt 邊界。

#783 已經把 #775 的動畫一致性堆疊真正落到最新 default：

- Temporal State / Sequence Lock；
- Motion / Physics continuity；
- cross-shot previous/end-frame propagation；
- Style DNA；
- real multimodal output judge；
- immutable consistency evaluations；
- keyframe-first staged plan；
- dimension-aware targeted repair；
- Animation Production Board；
- Review Queue；
- focused previous/current/candidate/next comparison；
- server-selected primary next action；
- 20 / 100 / 300-shot bounded performance；
- Candidate / Compare / explicit Adopt 不變。

#784 則把 migration bridge 的 partial-index predicate 差異收斂，讓目前 migration head 可安全通過既有 adoption/forward migration 流程。

現在兩邊已經各自成熟，但手機 AI 與動畫 Production runtime 仍是「相鄰」而不是「一條完成流程」。

目前使用者可能已經能在手機問：

> 哪些鏡頭有問題？

但產品真正應該做到的是：

```text
使用者一句話
→ Assistant 解析目前 Project / Sequence / Shot scope
→ 讀 Production Board / Review Queue 真實投影
→ 用人話說明問題
→ 使用者說「幫我修這三鏡」
→ 系統產生 server-authoritative targeted repair plan
→ 手機顯示會重做哪幾鏡、哪個 stage、為什麼、估計成本
→ 使用者明確確認
→ 既有 generation command / approval / points / idempotency 執行
→ Candidate 完成
→ 手機 Compare
→ 使用者 explicit Adopt
→ Board / Queue 重新投影
→ 問題數真的縮小
```

這一層完成後，手機才真正成為「動畫製作遙控器」，而不是只是一個能看狀態的聊天入口。

---

# 1. 最終產品目標

手機使用者不需要知道以下技術名詞：

- generation consistency evaluation
- evidence fingerprint
- packet dependency
- Style DNA
- Sequence Lock
- ShotMotionContract
- asset revision lineage
- stale dependency
- provider capability downgrade

手機只需要回答六件事：

1. **哪裡有問題？**
2. **為什麼？**
3. **會影響哪些鏡頭？**
4. **可以只修那些地方嗎？**
5. **會花多少、會重做哪些 stage？**
6. **修完後我要不要採用？**

理想手機對話：

```text
你：這一幕還有什麼問題？

Aios：
3 鏡需要處理

• Shot 04 人物外觀偏移
• Shot 05 左右手持物與上一鏡不一致
• Shot 08 畫風陰影偏離目前 Style

[幫我規劃修復]

→

Aios：
會修 3 鏡，不動其他 17 鏡

Shot 04：重做關鍵影格
Shot 05：只重做影片動作
Shot 08：重做關鍵影格

預估：42 點
目前版本全部保留，生成完成後需要你逐鏡採用。

[查看明細] [確認執行]
```

完成後：

```text
Aios：
3 / 3 已產生候選

Shot 04：可比較
Shot 05：可比較
Shot 08：可比較

[開始檢查]
```

採用後：

```text
Aios：
已採用 3 個修復版本
Review Queue：5 → 2

剩下：
• Shot 11 道具外觀需確認
• Shot 14 evaluator 尚未檢查
```

---

# 2. 核心架構原則

## 2.1 不建立第二套 Production Board

手機不得自己重新計算動畫狀態。

必須直接使用 #783 已有的 server-authoritative projection / lifecycle / review findings。

Phone card 只能做：

```text
server truth
→ compact phone projection
→ display
```

不能做：

```text
client 重新讀 shots + generations + evaluations
→ 自己拼另一個「手機一致性狀態」
```

## 2.2 不建立 AssistantV3

沿用 #782 的：

- existing global Assistant runtime
- active goal
- page-aware context
- phone assistant bridge
- action/result/progress projection
- confirmation interaction

新增的只是「動畫 Production capability adapter / projection」，不是新 agent runtime。

## 2.3 不建立第二套 Repair Engine

#783 已有 dimension-aware targeted repair。

手機助手不可自己推測：

- 哪一鏡要重做；
- 重做 image 還是 video；
- 哪些 reference 要加強；
- 是否能 reuse keyframe。

Assistant 應要求 server 的 repair planner 回傳正式 plan。

## 2.4 Candidate / Compare / Adopt 不得被 AI 繞過

任何修復完成後：

- Candidate 仍是 Candidate；
- current 不自動換；
- high-confidence blocker / evaluator finding 仍照現有規則；
- 手機 AI 不可以說「已修好」直到有 verified output；
- 手機 AI 不可以自動 Adopt。

## 2.5 不隱藏付費 cascade

如果修復涉及：

```text
keyframe
→ visual evaluation
→ i2v
→ motion evaluation
```

手機 UI 必須在執行前告訴使用者實際會發生的付費 generation stage。

Evaluation 若依現有政策不計點，可分開標示，不得把多個 generation call 包成一顆看不出成本的按鈕。

---

# 3. Phone Production Context

擴充 #782 的 Context Capsule，不新增資料來源。

## 3.1 Capsule 最多顯示

```text
百日夢島
第 2 幕
Shot 05
連戲需確認
```

或在 sequence scope：

```text
百日夢島
第 2 幕
20 鏡 · 3 鏡需處理
```

## 3.2 Context resolution 優先級

自然語言：

- 「這一鏡」 → active shot
- 「這一幕」 → active sequence / story scene
- 「這三鏡」 → immediately preceding review selection / assistant result IDs
- 「剛剛那些」 → active goal result references
- 「只修人物」 → filter current findings by dimension
- 「第二個不要」 → remove second item from current proposed repair selection

所有 target 必須落成 typed IDs 後才能寫入。

模糊情況：

```text
你：修掉那個畫風問題

如果目前有 3 個 style findings：
→ Clarify card
→ 不執行
```

---

# 4. Phone Animation Summary Projection

新增一個**compact projection**，來源只能是既有 Production Board / Review Queue truth。

建議形狀（名稱以 baseline audit 後現有型別為準）：

```ts
interface PhoneAnimationSummary {
  projectId: string;
  sequenceId?: string;
  selectedShotId?: string;

  counts: {
    totalShots: number;
    needsReview: number;
    repairable: number;
    blocked: number;
    notChecked: number;
  };

  topFindings: Array<{
    shotId: string;
    shotLabel: string;
    dimension: string;
    severity: string;
    reason: string;
    repairable: boolean;
  }>;

  nextAction?: {
    kind: string;
    label: string;
    shotIds: string[];
  };
}
```

限制：

- 不回 raw evaluator JSON；
- 不回完整 evidence bundle；
- 不回所有 packet；
- 不回 300 鏡的全量 detail；
- 預設只回 top actionable findings + counts；
- 詳情按需 lazy fetch。

---

# 5. 手機卡片設計

沿用 #782 的 card language，不建立另一套 design system。

## 5.1 Production Summary Card

```text
動畫檢查
3 鏡需要處理

人物 1
連戲 1
畫風 1

[查看問題]
```

## 5.2 Finding Card

```text
Shot 05 · 連戲
左右手持物與上一鏡不一致

上一鏡：右手持圖
這一鏡：左手持圖

[加入修復]
```

不顯示 confidence 小數。

可以顯示：

- 高可信
- 需確認
- 證據不足
- 尚未檢查

## 5.3 Repair Proposal Card

```text
修復計畫
3 鏡

Shot 04 · 關鍵影格
人物外觀偏移

Shot 05 · 影片
動作 / 持物連戲

Shot 08 · 關鍵影格
畫風偏移

其他 17 鏡不動

[查看成本]
```

## 5.4 Cost / Approval Card

```text
執行前確認

2 次關鍵影格生成
1 次影片生成
預估 42 點

目前版本不會被覆蓋。
完成後會產生 Candidate，需要你再採用。

[確認執行]
```

## 5.5 Generation Progress Card

只顯示 verified events：

```text
修復進度
✓ Shot 04 關鍵影格完成
◉ Shot 05 影片生成中
✓ Shot 08 關鍵影格完成

2 / 3 已完成
```

禁止：

```text
AI 正在深入思考人物一致性… 63%
```

## 5.6 Compare Card

手機不需要完整 desktop compare workbench 才能做第一層裁決。

最小 Compare：

```text
Shot 05

[現用版本] ⇄ [修復候選]

修復目標：
✓ 右手持物延續
✓ 動作方向一致

[保留現用] [查看候選]
```

進一步點「查看候選」才 lazy load focused comparison surface。

## 5.7 Adopt Result Card

```text
Shot 05 已採用修復版本

Review Queue
3 → 2

[下一個問題]
```

這個 `3 → 2` 必須來自重新抓 server projection 後的 verified state，不可在 client 自己 `count - 1`。

---

# 6. Assistant Intent / Capability Mapping

需要讓既有 Assistant 能理解動畫 production 語句，但不得另建一份完全平行的 intent engine。

建議能力：

```text
animation_review_summary
animation_list_findings
animation_plan_repair
animation_execute_repair
animation_compare_candidate
animation_adopt_candidate
animation_keep_current
animation_next_review_item
```

實際名稱應 baseline audit 現有 capability registry 後決定。

## 6.1 Read-only intents

以下可直接執行：

- 「這幕還有什麼問題？」
- 「哪些鏡頭人物不一致？」
- 「還有幾鏡沒檢查？」
- 「為什麼 Shot 5 被標紅？」

## 6.2 Proposal intents

以下只能先產生 proposal：

- 「幫我修這三鏡」
- 「只修人物跟畫風」
- 「把所有連戲問題處理掉」

先取得 server repair plan，不能直接 generation。

## 6.3 Costful execution intents

以下必須 explicit confirm：

- 「開始修」
- 「照這個計畫執行」
- 「重做這三鏡」

必須先有：

- exact shot IDs
- repair stages
- estimated point cost
- model / capability downgrade（若現有計畫有）
- approval requirement

## 6.4 Human decision intents

以下為 current pointer 寫入，保持現有 Adopt boundary：

- 「採用這版」
- 「這張可以」
- 「用修好的」

若手機 context 有多個 Candidate，必須 clarify，不能猜。

---

# 7. Repair Selection Semantics

## 7.1 預設不是「全部修」

使用者說：

> 幫我修一下

在目前 shot context 時，可以 scope 到 selected Shot。

在 sequence context 且有多鏡問題時，必須先回 proposal：

```text
目前有 7 鏡需處理。
要全部規劃，還是只處理高優先的 3 鏡？
```

不要直接發 7 鏡 paid generation。

## 7.2 支援 dimension filter

例如：

```text
只修人物
只修連戲
畫風先不要
不要動配音
```

Selection 必須基於 persisted finding IDs / shot IDs / dimension，而不是文字模糊比對後直接寫。

## 7.3 Targeted means targeted

Repair plan 必須顯示 untouched scope：

```text
修復 3 鏡
不動 17 鏡
不動配音
不動已採用的 Shot 01 / 02
```

這會讓使用者真正相信「不是整部重跑」。

---

# 8. 手機 Compare / Adopt 閉環

## 8.1 Compare queue

修復完成後，把 Candidate 依：

1. blocker / high severity
2. current active shot
3. sequence order

排序給使用者。

## 8.2 一次處理一鏡

手機不要預設出現 6 張比較圖。

流程：

```text
Shot 04
→ 比較
→ Adopt / Keep
→ 下一鏡
```

## 8.3 Keep current 不是失敗

使用者可以說：

> 原本比較好

Assistant 應走既有 keep/review semantics，不刪 Candidate，不假裝 repair 失敗。

## 8.4 Adopt 後重新評估 queue

Adopt 成功後：

- 重新投影 board；
- downstream continuity / stale 若因此改變，依 server truth 顯示；
- 不在前端自行假設 queue 一定 -1。

有可能：

```text
3 → 4
```

如果採用這鏡使下一鏡需要 continuity review，手機必須誠實顯示。

---

# 9. 首屏與效能限制

#782 已經明確控制 Phone payload / API，因此這支不能把 Production Board 變成手機首屏的大查詢來源。

## 9.1 不得新增首頁 N+1

若要在手機首頁顯示：

```text
動畫：3 鏡需處理
```

應優先把極小 counts 併入既有 `phone.home` / `phone.project` projection，而不是額外打一支完整 board query。

## 9.2 Detail 按需取得

第一屏只需要 counts / next action。

使用者點「查看問題」後再 fetch compact findings。

## 9.3 不載入完整 ProjectPage

看到 Finding Card / Repair Card 不得下載完整 desktop workbench。

Focused compare / manual shot edit 才可 lazy load相關 chunk。

## 9.4 Performance budget

驗收至少記錄：

- `/dashboard` phone transferred JS
- `/p/:id` first navigation JS
- `/dashboard` API count
- `/p/:id` API count
- 打開 review details 新增 API 數
- 打開 focused compare 新增 chunk

不得讓 #782 的核心 bundle 明顯退化。

---

# 10. Durable resume

#782 已知邊界：硬重新整理後，手機卡片需要第一次打開 Assistant 才從 durable assistant state rehydrate。

本次可以順便把 Animation repair active goal 做成更好的 resume，但不能用輪詢解決。

建議：

將極小 active production goal summary 合入既有 phone projection：

```text
activeRepairGoal?: {
  goalId: string;
  state: "proposal" | "awaiting_confirmation" | "running" | "review_ready";
  affectedShotCount: number;
}
```

這不是新的 goal truth；只是 existing durable Assistant/Agent state 的 projection。

硬重新整理後即可顯示：

```text
你有 3 鏡修復結果待檢查
[繼續]
```

---

# 11. Error / Partial Success

## 11.1 Partial generation failure

```text
3 鏡修復
2 鏡完成
1 鏡失敗
```

不得把整批標成 failed 並丟掉成功 Candidate。

## 11.2 Evaluator unavailable

顯示：

```text
Shot 05 候選已生成
視覺一致性尚未檢查
```

不可顯示「一致」。

## 11.3 Approval waiting

```text
等待你確認 24 點生成
```

而不是假進度「正在生成」。

## 11.4 Capability downgrade

例如模型不能使用 previous-frame reference：

```text
這次可以生成，但模型無法使用上一鏡參考圖。
連戲穩定性可能較低。
```

如果現有 repair planner 已建議替代 model，仍不得 silent switch。

---

# 12. Security / Rights / Cost

所有 animation AI actions 必須沿用現有：

- project/group ACL
- execution rights revalidation
- commercial-rights blockers
- quota / points
- approval threshold
- idempotency
- CAS / human-first pointer protection
- Candidate → explicit Adopt

手機 Assistant 只是新的 orchestration surface，不是新的授權邊界。

---

# 13. Implementation Stack

建議拆 4 支 Draft PR，全部從當時最新 default 建立；若執行環境只能單 branch，可用 4 個清楚 commit boundary，但最後 PR body 必須逐層列出。

## PR-A — Phone Animation Projection + Findings UX

Scope：

- baseline audit existing Production Board / Review Queue APIs and types
- compact phone animation summary
- Production Summary / Finding cards
- context capsule integration
- read-only assistant capabilities：summary / findings / why
- no new generation

Definition of Done：

- 手機問「這幕有什麼問題」得到 server truth
- dimension / shot IDs 可追溯
- no raw evaluator dump
- no ProjectPage eager load
- desktop tree zero phone leakage

## PR-B — Repair Planning + Cost Confirmation

Scope：

- assistant capability → existing targeted repair planner
- typed repair selection / dimension filter
- Repair Proposal Card
- untouched scope summary
- paid stage / points / approval disclosure
- ambiguous selection clarification

Definition of Done：

- 「只修人物跟連戲」會選對 findings
- repair plan shot IDs 與 server planner 完全一致
- before execution 可看 stage / cost / untouched shots
- no generation before confirmation

## PR-C — Verified Execution + Compare / Adopt Loop

Scope：

- execution bridge to existing generation command
- verified progress events
- partial success
- Candidate-ready result cards
- compact compare queue
- focused compare lazy handoff
- explicit Adopt / Keep Current
- re-fetch board after decision

Definition of Done：

- paid execution 不繞過 existing approval / idempotency
- no silent Adopt
- partial success survives
- Adopt 後 queue count 來自 fresh server truth
- downstream new finding can increase queue and UI remains truthful

## PR-D — Durable Resume + Full Phone Golden Acceptance

Scope：

- compact active repair goal in existing phone projection if justified
- hard-refresh resume
- 360 / 390 / 430 browser golden flows
- 768 / 820 / 1024 / 1280 / 1440 desktop regression
- API / bundle budget
- Axe / keyboard / touch target checks
- PostgreSQL integration where state mutation matters

Definition of Done：

- refresh during proposal/running/review-ready can resume
- no polling added
- 44px minimum touch targets
- no horizontal overflow
- no serious/critical Axe findings
- phone shell does not download full workspace until focused handoff

---

# 14. Required Golden Flows

## Flow A — 問問題

1. 手機進動畫專案。
2. 問「這一幕還有什麼問題？」
3. 回 3 個真實 findings。
4. 點某個 finding 可看到人話原因。
5. 不載完整工作台。

## Flow B — 只規劃，不執行

1. 「幫我修人物跟連戲，畫風先不要。」
2. 只選 identity/look/temporal/physics 對應 findings。
3. Server repair planner 回 exact shot IDs / stages。
4. 顯示 untouched shots。
5. 在確認前 generation count 不增加。

## Flow C — Paid repair

1. 使用者確認。
2. 正確 approval/points gate。
3. progress 只由 verified events 更新。
4. 3 鏡中 2 成功、1 失敗時保留兩個 Candidate。
5. 成本顯示與 ledger 一致。

## Flow D — Compare + Adopt

1. Candidate ready。
2. 手機逐鏡 Compare。
3. Shot 04 Adopt。
4. Shot 05 Keep Current。
5. Shot 08 Adopt。
6. current pointer 只在兩次 Adopt 改變。
7. Candidate 不因 Keep 被刪除。

## Flow E — Queue truth

1. 初始 queue = 3。
2. Adopt 後 server 重新投影。
3. 若下一鏡被 continuity impact，queue 可能 = 2 或 3，不寫死 decrement。
4. 手機顯示 fresh truth。

## Flow F — Refresh resume

在：

- repair proposal
- awaiting approval
- running
- review ready

各 refresh 一次，能從 durable truth 回到正確位置。

---

# 15. Machine-verifiable Acceptance

最低要求：

### Projection

- counts = server board counts
- top findings are bounded
- no raw evaluator payload
- `not_checked` preserved

### Targeting

- exact finding IDs / shot IDs
- dimension filters deterministic
- ambiguous destructive/write target stops

### Cost / approval

- same point estimation truth as existing generation path
- no hidden stage
- no generation before confirmation

### Execution

- idempotent retry
- partial success preserved
- Candidate does not move current

### Decision

- Adopt uses existing path
- Keep uses existing human review semantics
- fresh board projection after decision

### Performance

- phone summary does not create per-shot N+1
- 100 / 300 shots return compact summary with bounded query count
- first screen payload budget recorded

---

# 16. Browser Acceptance

Phone：

- 360×800
- 390×844
- 430×932

Must prove：

- Context Capsule readable
- Summary card fits one column
- finding reason not clipped
- Repair Proposal has one primary CTA
- Cost confirmation cannot be bypassed
- Compare is usable one-handed
- all interactive targets >=44px except documented inline exceptions
- no horizontal overflow
- keyboard does not cover composer/confirmation

Desktop regression：

- 768×1024
- 820×1180
- 1024×1366
- 1280×800
- 1440×900

Must prove：

- phone production cards absent
- desktop Production Board unchanged except explicitly shared server improvements
- desktop Assistant launcher ownership unchanged
- no duplicate Assistant surface

---

# 17. Non-goals

本計畫明確不做：

- AssistantV3
- ProductionBoardV2
- ConsistencyEngineV2
- 第二套 repair planner
- 第二份 workflow state table
- 自動 Adopt
- 自動把所有 finding 一次修掉
- 背景自動花點數重生成
- 手機完整複製 desktop animation workspace
- 自動訓練角色模型
- claim 100% face consistency / physical correctness
- 重寫 #783 evaluator
- 重寫 #782 phone shell

---

# 18. Product Language

優先使用：

- `3 鏡需要處理`
- `人物外觀偏移`
- `前後不連貫`
- `左右手持物不同`
- `畫風偏移`
- `尚未檢查`
- `只修這 3 鏡`
- `其他 17 鏡不動`
- `會產生候選版本`
- `需要你採用後才會替換目前版本`

避免：

- `AI 自動修好了`
- `100% 一致`
- `物理正確`
- `模型已鎖定`（若 reference 沒實際 attached）
- `已完成`（只有 proposal / queued 時）

---

# 19. Final Definition of Done

這個計畫完成的標準不是多幾張手機卡，而是以下流程全部成立：

1. 手機 AI 能知道目前動畫專案 / 幕 / Shot。
2. 手機問「哪裡有問題」時讀的是 Production Board server truth。
3. Finding 以人物可懂語言呈現，不暴露技術內臟。
4. 使用者可以以自然語言篩選要修的 dimensions。
5. Repair target 來自既有 persisted findings / planner，不猜。
6. 使用者執行前看得到 exact shots / stages / estimated points。
7. 任何付費 generation 都需現有 confirmation / approval gate。
8. Progress 只顯示 verified work events。
9. Partial failure 不吃掉成功 Candidate。
10. 修復結果仍是 Candidate，不 silent Adopt。
11. 手機可逐鏡 Compare。
12. Adopt / Keep 都走既有人類決策路徑。
13. Adopt 後 Review Queue 重新從 server truth 投影。
14. Queue 可以上升或下降，UI 不做假算術。
15. Hard refresh 能恢復 active repair goal，而不新增 polling。
16. 不建第二套 Assistant / Board / Repair / Canon / continuity truth。
17. 不為手機首屏載入完整 Project workbench。
18. 360 / 390 / 430 可完整走完流程。
19. 768+ 桌面產品模式無回歸。
20. 100 / 300-shot 專案仍保持 bounded query / compact payload。

最終使用者應該可以只拿手機說：

> 「這幕哪裡有問題？人物跟連戲先修，畫風不要。照這個計畫執行。好了給我一個一個看。」

然後 Aios 真正完成：

```text
理解 scope
→ 找真實 finding
→ 規劃 targeted repair
→ 顯示成本
→ 人確認
→ 真實執行
→ Candidate
→ Compare
→ Adopt / Keep
→ Queue 收斂
```

這才算 Phone AI 與 Animation Production 真正接成一條閉環。

---

# 20. Execution Instruction

實作者開始前必須：

1. 以最新 default（至少含 #782 / #783 / #784）為基準；
2. 先盤點 #782 的 Phone Assistant projection / bridge / card ownership；
3. 盤點 #783 Production Board / Review Queue / repair planner / staged generation / compare / Adopt exact APIs；
4. 不因計畫名稱自行新增平行 runtime；
5. 每一層先 reuse，再只補缺少的 adapter / projection；
6. 所有 paid action 走現有 execution command；
7. 不呼叫未授權 paid provider 做測試；
8. 不 auto-merge、不 force-push；
9. 最後必須回報實際 PR 號、測試、payload/API budget、PG/browser evidence，以及真正 external blocker。
