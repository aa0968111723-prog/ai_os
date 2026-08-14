# AIOS Large Storyboard Scaling & Query Fan-out Hardening Plan

> 本計畫是與 PR #754 **可平行執行、不得互相重疊**的專案頁／Storyboard 大型專案可靠性工作。
> 目標不是改產品資訊架構或一致性語意，而是確保 100～300+ 鏡腳本與分鏡在專業模式下不因 per-shot 查詢、request fan-out、header / payload 放大、重複 polling 或過度 render 而失效。

## 0. Execution contract

這不是只寫文件的研究任務。實作代理必須：

1. 先讀 repo 規範、最新 default、PR #726、#752、#753、#754。
2. 在最新 default 建立獨立 implementation branch。
3. 先重現／量測，再實作。
4. 以既有資料真相與既有 ShotCard / Storyboard contract 為基礎，不創造第二套 creative data model。
5. 完成 unit / integration / browser / load evidence。
6. 建立 Draft implementation PR；不得 auto-merge / force-push。

## 1. Why now

PR #726 已明確留下 deferred P1：專業模式分鏡板在大量鏡頭時，每卡獨立讀取 shot asset suggestions，約 130 鏡會形成 request/header fan-out，可能撞 Node 16KB header 限制。

#753 已把 script consistency runtime 合併進 default；#754 正在處理 Team Canon → Canon-to-Shot → Project UX 主線。

因此本任務刻意只做「大型 Storyboard 的 transport / query / rendering scaling」，可與 #754 並行。

## 2. Hard non-conflict boundary with #754

### 本 PR 可以改

- shot asset suggestion 的 read API / batch read API
- query aggregation / batching / cache key
- Storyboard data loading hooks
- ShotCard 的最小資料注入方式（只能為移除 per-card query，不改視覺 IA）
- StoryboardStage 的最小 data plumbing（若必要）
- server query performance / indexes（只有經 EXPLAIN / evidence 證明必要時）
- request count / payload / header / render / scroll performance tests
- large-project fixtures
- browser evidence scripts
- telemetry / dev diagnostics（不得暴露敏感資料）

### 本 PR 禁止改

- Team Canon schema / versioning / project pinning
- consistency training / training manifests / model Promote
- Script → Canon binding 語意
- Scene Package / Character Slots / reference mixer
- Shot Context Packet schema / freeze semantics
- continuity semantics
- Candidate / current / Adopt semantics
- generation provider routing / cost / approval
- rights / ACL policy semantics
- `creativeContext.workspace` 的產品 readiness / nextAction 語意
- ProjectPage IA 大重構
- single primary CTA
- ContextDrawer / ResultDrawer 產品設計
- ShotCard 視覺簡化／狀態文案重設
- mobile Project UX redesign

若發現真正修復必須修改上述 #754 scope，停止該部分，將它列為 `DEPENDENCY_ON_754`，不要自行擴 scope。

## 3. Primary problem statement

大型腳本進入 Storyboard 後，不能出現：

- N shots → N independent suggestion requests
- query key / URL / header 隨 shot 數線性放大
- 130～300 Shot 同時 mount 時大量 RPC burst
- 每卡獨立 polling
- 相同 project/scene 資料被重複下載
- background refetch 導致整個 board 重 render
- 大量 cards 一次渲染造成 scroll / input jank
- 一個 suggestion failure 讓整個 Storyboard error
- reload 後 cache 與 server truth 不一致

目標：

> Storyboard 的網路與 server query 成本，應接近「每頁／每批固定少量請求」，而不是「每個 Shot 一個請求」。

## 4. Phase A — Baseline audit & reproducible evidence

先確認 CURRENT HEAD 的真實實作，不要只相信舊 PR 描述。

必須找到：

- `shotAssetSuggestions` 或等價 endpoint 的實際 router/service
- ShotCard / StoryboardStage / hooks 哪裡呼叫它
- query input 是否包含 projectId / sceneId / shotId
- 是否使用 tRPC batching、HTTP GET URL、headers、cookies
- 是否存在 refetchInterval / polling
- mount 100 / 130 / 200 / 300 Shot 的 request 數
- server DB query 數
- response payload size
- 最大 request URL/header size
- React render 次數／明顯 long task

建立可重現 fixture：

- 20 shots
- 100 shots
- 130 shots
- 200 shots
- 300 shots

不要用 300 份巨大 media bytes；fixture 只需要 realistic metadata / suggestion relations。

記錄 before evidence：

- requests total
- suggestion requests
- DB queries（若可觀測）
- transferred bytes
- first usable board time
- max header / URL bytes（可量測範圍）
- browser errors
- server errors

## 5. Phase B — Define batch read contract

新增或擴充一個 server-side batch read contract。

優先順序：

1. 擴充既有 router/service
2. 重用既有 authorization / filtering / source truth
3. 不建立 parallel suggestion service

API 概念：

```ts
shotAssetSuggestionsBatch({
  projectId,
  shotIds?: string[],
  cursor?: string,
  limit?: number,
})
```

實際命名依 repo convention。

要求：

- server 驗證所有 shotIds 都屬於 project / 可存取 scope
- 不允許跨 project inference
- 回傳以 `shotId` keyed 的 compact map
- missing shot 回傳空集合或 stable missing status，不讓整批 500
- 一個 shot 沒 suggestion 不等於 error
- 有合理 batch size upper bound
- 支援 chunking / pagination（若 300+ ids 仍太大）
- 不把大型 asset payload 放進 response，只回 compact metadata / IDs / preview fields
- stable ordering
- deterministic cache identity

## 6. Avoid GET/header explosion

不得用「把 300 個 shot IDs 全塞 query string」來假裝 batch。

若現有 tRPC transport 對大 input 會放大 URL/header：

- 優先使用符合 repo 架構的 POST / mutation-like read transport / batched body transport（依現有 conventions）
- 或 chunk shotIds into bounded batches

要求實測 300 shot 不撞：

- URL length limit
- Node header limit
- reverse proxy reasonable limits

不要藉此修改全站 server `maxHeaderSize` 來掩蓋問題。

**禁止以提高 header limit 作為主要修法。**

## 7. Phase C — Server query aggregation

Batch endpoint 不能只是 server 內部 `Promise.all(shotIds.map(singleShotQuery))`。

真正目標是 DB 層 aggregation：

```text
1 batch request
→ bounded number of DB queries
→ group by shotId
→ compact response
```

要求：

- 避免 N+1
- 使用 existing indexes first
- 若需新增 index，必須有 query plan / evidence
- project scope 必須進 SQL predicate
- row count / payload 有上限
- SQL/ORM 查詢不因 300 IDs 產生 pathological plan

若資料來源分散在 2～3 張表，可接受少量固定 query；不可回到每 shot 多 query。

## 8. Phase D — Client batching & cache

Storyboard client 不再讓每個 ShotCard 自己發 suggestion query。

目標資料流：

```text
Storyboard data loader
  ↓
visible / requested shot IDs
  ↓
batch query
  ↓
Map<shotId, SuggestionSummary[]>
  ↓
ShotCard props / context selector
```

要求：

- ShotCard 不再 ownership 自己的 network lifecycle（至少 suggestion 這條）
- preserve existing ShotCard visual/API behavior as much as possible
- cache keyed by project + shot + relevant revision
- unrelated shot update 不清空整個 cache
- background refetch 不造成全部 cards rerender
- error isolation per shot
- loading state 不造成 layout shift

若使用 React Query/tRPC cache：

- follow repo conventions
- 不另建 global mutable cache singleton

## 9. Phase E — Visible-window loading (only if evidence requires)

如果 300 Shot 一次載入全部 suggestion metadata 仍造成明顯成本，再加入 visible-window / chunked prefetch。

例如：

- initial first 30～50 shots
- near viewport prefetch next chunk
- scroll 時 bounded concurrency

但不要過度工程。

只有 baseline/evidence 證明「單次 compact 300-shot batch 仍不合理」才做。

## 10. Rendering scaling

檢查 Storyboard 100～300 cards 的 render 行為。

可做：

- memoization
- selector granularity
- stable props
- bounded image loading
- lazy preview loading
- existing list virtualization（若 repo 已有）

若要引入新的 virtualization library，先證明 repo 沒有既有解法，而且 dependency 增加合理。

禁止為 performance 重寫整個 Storyboard UI。

## 11. Polling / realtime

確認 suggestion 是否真的需要 polling。

若資料只在明確 mutation 後變：

- 優先 cache invalidation
- 不要每 ShotCard interval polling

若必須 fallback polling：

- project/board level 一個 bounded poll
- visibility-aware
- tab hidden 降頻／停止
- no overlapping requests

不要改 #754 / #753 的 generation durable semantics。

## 12. Mutation invalidation

列出所有會讓 suggestion 失效的既有 mutation，例如：

- asset attach/remove
- shot visual/current change
- explicit suggestion refresh
- relevant scene binding changes

Batch cache 必須在這些 mutation 後正確 invalidate / patch。

但不得重寫 mutation 的 domain semantics。

## 13. Failure behavior

要求：

- batch 部分 missing 不整批失敗
- network error 顯示 existing retry/empty behavior
- 429/5xx 不觸發 request storm
- request cancellation on project switch
- stale response 不覆蓋 newer project/board state
- project A response 不進 project B cache
- unmounted board 不繼續高頻 refetch

## 14. Security & tenancy

Batch API 特別容易造成 ID enumeration。

必須測：

- project A user + project B shot ID
- unauthorized project
- mixed authorized/unauthorized IDs
- deleted shot
- archived project（依既有 policy）

回應遵守既有 privacy policy；不得因 batch API 洩漏 shot 是否存在。

## 15. Performance acceptance budgets

以下是最低產品驗收方向；若 baseline 架構可達更好，採更嚴格結果。

### 20 shots

- suggestion network requests ≤ 2（理想 1）

### 100 shots

- suggestion network requests 不隨 shot 線性增長
- ≤ 4 bounded requests（若 chunking）

### 200 shots

- ≤ 6 bounded requests（若 chunking）
- no header/URL overflow
- no 431 / invalid header / request too large

### 300 shots

- ≤ 8 bounded requests（若 chunking）
- no per-card polling storm
- board 可操作
- horizontal/vertical scroll 無嚴重卡死

更重要：

- request count O(chunks/pages)，不是 O(shots)
- DB query count O(1) 或 O(fixed sources × chunks)，不是 O(shots)

## 16. Tests

### Unit

- batch input validation
- shot grouping
- batch chunking
- compact response mapping
- cache selector stability
- partial missing handling
- project-switch stale response guard

### Integration / PostgreSQL

若 repo 的 DB 測試環境可用：

- 300 shots batch query
- tenancy isolation
- deleted/missing shot behavior
- query count or explain evidence
- optional index benefit

若 PostgreSQL 不可用：

標記 `BLOCKED_BY_ENVIRONMENT`，不可宣稱 PASS。

### Client

- 100 ShotCards mount 不產生 100 queries
- only relevant cards rerender after one shot suggestion update
- no duplicate background poll
- error isolation

### Browser

至少：

- 390px / 430px
- 1280px / 1440px
- 100 shots
- 200 shots
- 300 shots

本 PR 不重設 mobile UX；只驗證現有 UI 在大型資料下沒有新增 overflow / unusable state。

## 17. Browser evidence

產出 evidence：

- request-count JSON
- payload-size JSON
- screenshots first/middle/end of 300-shot board
- console error capture
- optional performance marks

Before / After 必須能比較。

不得只用 source grep 當 performance proof。

## 18. Regression safety

必須保證：

- 1 shot / 5 shot 小專案行為不退化
- existing ShotCard actions unchanged
- suggestions content semantic unchanged
- no generation path behavior change
- no Candidate/Adopt behavior change
- no cost/points behavior change
- no consistency readiness behavior change

## 19. Files / hotspots to inspect first

至少先核對 CURRENT HEAD：

- `server/routers/story.ts`
- `client/src/features/storyboard-center/ShotCard.tsx`
- `client/src/features/storyboard-center/StoryboardStage.tsx` 或實際 board owner
- suggestion-related hooks / services
- tRPC transport config
- asset suggestion DB access layer
- #726 docs / tests mentioning P1-11

實際 code 已變更時，以 CURRENT HEAD 為準，不要硬套舊檔名。

## 20. PR strategy

這個任務應該只需要 **1 支 Draft implementation PR**，因為 scope 是單一 scaling concern。

若實作超過約 1,500～2,000 meaningful lines 或同時需要 server + virtualization 大改，可拆：

- PR-S1：Batch API + client query consolidation + tests
- PR-S2：render/windowing hardening + browser/load evidence

但不要為了拆 PR 製造人工 dependency。

## 21. Definition of Done

只有以下全部成立才算完成：

1. CURRENT HEAD 的 per-shot suggestion fan-out 已被實際移除或 bounded。
2. 100/200/300 shot request count 有 before/after evidence。
3. 300 shot 不會因 URL/header/input size 失敗。
4. server 不是把 N queries 從 client 搬到 `Promise.all` 而已。
5. DB query 數為 bounded。
6. ShotCard suggestion 語意不變。
7. project/tenant isolation 有 regression tests。
8. reload / project switch 不出現 stale cross-project data。
9. 無新 per-card polling storm。
10. 小專案不退化。
11. 不修改 #754 domain scope。
12. typecheck / relevant client tests / server tests / boundaries checks PASS。
13. 能跑的 browser/load evidence 全部完成。
14. 環境不能跑的項目誠實標 `BLOCKED_BY_ENVIRONMENT`。
15. 建立 Draft PR，PR body 含 before/after metrics。
16. no auto-merge / no force-push / no paid provider call。

## 22. Final report format

完成後只需要回報：

1. 實際 implementation PR number
2. root cause
3. before request/query counts
4. after request/query counts
5. 100/200/300-shot results
6. tests PASS
7. BLOCKED_BY_ENVIRONMENT
8. changed hotspots
9. 是否新增 migration/index
10. 明確聲明未修改 #754 Team Canon / Canon-to-Shot / Project UX semantics

## 23. Product principle

大型腳本是 Aios 的正常使用情境，不是 edge case。

使用者寫 150～300 鏡時，系統應該只是「資料更多」，不能變成「每多一鏡就多一個網路生命週期」。

本任務成功的標準不是畫面看起來不同，而是：

> **同一個 Storyboard UI，在 20 鏡與 300 鏡都保持相同的產品語意，但底層請求、查詢與渲染成本被控制在可預期的 bounded scaling 模型。**
