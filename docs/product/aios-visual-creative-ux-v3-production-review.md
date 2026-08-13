# Visual Creative UX v2/v3 — 獨立上線前審查（Production Red Team）

審查對象：已 merge 的 **#722**（Visual Creative UX v2）與 **#723**（v3 mixed state and real variants，merge commit `3cf4c188`）。

- **Base SHA**：`6752d59c`（CURRENT default `claude/healing-migration-ai-os-erewp2`）
- **審查方式**：另開 pristine worktree 審查。原因見〈審查方法〉。
- **本 PR 不含任何程式碼修改**，只有這份文件。修法建議在最後一節，交由主線實作者決定。

審查問題只有一個：**這套東西現在上 production，最可能在哪裡出事？**

不採信 PR body、完成報告、測試摘要、「已驗證」。所有結論回到 CURRENT CODE / DATA FLOW / TESTS。

---

## 審查方法

- 117 個 agent 分 21 個面向平行審查，每一條 finding 再交由**獨立的反方 agent 嘗試推翻**（預設「推不倒就算誤報」）。最終 55 條存活、45 條被推翻。以下只列去重後真正有價值的。
- 另開 pristine worktree 的理由：審查期間另一個 session 正在同一個 worktree 寫同一個任務的實作（3 分鐘內新增 4 個未追蹤檔）。在被寫入中的 worktree 審查等於審一個移動標的——實測有一個 agent 讀到對方**未提交的修正**，差點把一個真 bug 判成不存在。
- Baseline（base SHA，未修改）：
  - `npm run typecheck` PASS
  - `npm run test:client` PASS（206 files / 1821 tests）
  - `npm test` 2838 passed，1 failed＝`server/services/gemini.test.ts` 既有的 Windows-only 路徑斷言（與 #723 PR body 記載一致）

---

## P0 — 上線阻斷

### P0-1 `<SceneStudio>` 沒有 `key`：寫錯鏡、對錯鏡花錢、假成功

`client/src/features/storyboard-center/StoryboardStage.tsx:174-187` 在固定位置渲染 `<SceneStudio>` 且**沒有 `key`**，而 `ShotNavigator` 是就地換 `sceneId`。同型別、同位置、無 key ⇒ React 保留全部 component state。

`client/src/components/SceneList.tsx:1118` 有 `key={studioScene.id}`——**另一個呼叫端是對的**，新介面漏了。

SceneStudio 全檔只有一個 `useEffect`（`:222`，變體自動開啟比較），**沒有任何依 `sceneId` 重置的邏輯**。

三個獨立傷害：

1. **寫錯鏡（資料損壞）**
   `const prompt = promptDraft ?? data?.prompt ?? ""`（`:397`）。存檔送出 `{ sceneId, prompt, expectedRev: data?.rev, baseline: { prompt: data?.prompt } }`（`:651`、`:334-337`）——用的是**第 B 鏡的 rev 與第 B 鏡自己的現值當 baseline**。於是樂觀併發守衛看到的是一筆「乾淨、無衝突」的寫入並接受它：**第 A 鏡的文字被寫進第 B 鏡，沒有衝突卡、沒有提示，A 的編輯同時消失**。
   `voiceover`（`:922`）、`dialogue`（`:942`）、`action`（`:676`）、`music`、`ambience` 同樣。

2. **對錯鏡花錢**
   同一個殘留的 `prompt` 變數餵給 `regen`（`:853`）與 `generateVariants`（`:884`）——**用第 A 鏡的未存草稿，付費生成第 B 鏡的畫面**。

3. **假成功（點了等於沒點，但顯示生成中）**
   殘留的 `variantBatch` 拿 A 的 `generationIds` 去比對 B 的版本 ⇒ `matched = []` ⇒ `settled` 永遠 false ⇒ `autoOpened` 永遠不翻 ⇒ `:880` 的輪替守衛不觸發 ⇒ 在 B 鏡按「產生 3 個變體」**重送 A 的三個 UUID**。伺服器端冪等短路只用 generations 主鍵、不檢查 scene/project：

   ```ts
   if (input.id && isUniqueViolation(err)) {
     const [existing] = await db.select()...where(eq(generations.id, input.id));
     if (existing) return existing;                    // generationCore.ts:811-814
   }
   ```

   三個 slot 全部回傳 A 鏡的既有列且 `ok: true`，UI 顯示 B 鏡「Variants 生成中」，但 `select count(*) from generations where scene_id = <B>` 完全沒變。使用者在等一個不存在的批次。殘留的 batch 同時把版本輪詢釘在 4 秒（`:192`）。

**建議修法**：`StoryboardStage.tsx:175` 加 `key={studioShot.id}`（比照 `SceneList.tsx:1118`）。保險起見再加 `useEffect(..., [sceneId])` 重置全部草稿、`variantBatch`、`compareAssetIds`、`variantRequestIds`。伺服器端冪等短路應斷言既有列的 `sceneId`/`projectId` 與請求相符，否則丟 `BAD_REQUEST`——不能把跨鏡重用的鍵回報成一次成功送出。

---

### P0-2 成本核准會清掉 `preserveScenePointer`：核准後的變體會蓋掉現用畫面

`server/routers/generation.ts:881-889` 在核准分支重寫 `params`：

```ts
params: storeGenerationSourceMeta(submitParams, {
  secondarySourceUrl: refreshedSecondaryUrl,
  usedUserKey: usedUserKey || splitParams.meta.usedUserKey || undefined,
}),
```

`splitParams.meta`（`:853` 就在作用域內）沒有被展開。而 `submitParams` 早已被 `splitGenerationSourceMeta` 刪掉 `__aiosSourceMeta` 鍵（`shared/generationSourceMeta.ts:52-53`），且 `storeGenerationSourceMeta` 在所有欄位皆為 falsy 時原樣回傳（`:39`）——**整個 meta 鍵被抹除**。

於是完成時 `server/services/generationCore.ts:1029` 判斷 `undefined !== true` 成立，`:1047-1056` 的 `UPDATE scenes SET asset_id` 照跑。三個變體依完成順序輪流覆蓋，最後完成的成為現用。**使用者從未採用任何一版，原本的畫面就被換掉了**——正是 #723 宣稱要保證的不變式。

同一行也一併丟掉 `ablation` 與 `bench` 的 `runId`，而 `generation.ts:355` 與 `:464` 正是用
`params->'__aiosSourceMeta'->'ablation'->>'runId'` 撈同組資料——**被核准的那一筆會從自己的消融／競技場比較集裡消失**，量測結果靜默失真。

反證這個不變式是已知的：重試路徑 `generation.ts:523` 明確有 `preserveScenePointer: meta.preserveScenePointer`。`decideCost` 是唯一從零重建 meta 的地方。

**觸發前提**：該組有設定 `approvalThresholdPoints`（`server/db/schema/auth.ts:51`，只有 `quota.ts:219` 會寫），且送出者是一般 `member`。沒設門檻時這條路是暗的——此時降為 P1。

**建議修法**：
```ts
params: storeGenerationSourceMeta(submitParams, {
  ...splitParams.meta,
  secondarySourceUrl: refreshedSecondaryUrl,
  usedUserKey: usedUserKey || splitParams.meta.usedUserKey || undefined,
})
```

---

### P0-3 手機：選擇面板蓋在所有 modal 之上

`client/src/styles.css:10006-10007`，`@media (max-width: 820px)`：

```css
.visual-creative-inspector { position: fixed; z-index: 52; inset: auto 0 0; ... max-height: min(82dvh, 720px); }
```

而 `.modal-scrim` 是 `z-index: 50`（`:2418`）。兩者同時掛載（`StoryboardStage.tsx:172` 與 `:174`）。

結果：在 390px 手機上，**從選擇面板自己的按鈕打開的單格工作室，會被面板蓋住**。

---

## P1

| # | Finding | 位置 |
|---|---|---|
| 4 | **MCP `retry_generation` 是退化版重複實作**：只帶 `projectId/modelId/prompt/sourceUrl/sceneId`。丟掉 `preserveScenePointer`（重試失敗的變體 → 變成會移動指標的生成）與 `sceneRole`（重試失敗的旁白 → 落入 `else` 分支，**把音訊素材寫進 `scenes.assetId`**，正是 `scenes.ts:1216` 註解警告的破圖情形）。也丟掉全部卡片錨點 | `mcpWriteExpansion.ts:864-873`（對照正確版 `generation.ts:518-527`）、`generationCore.ts:1032-1037` |
| 5 | **完成寫入沒有陳舊守衛**（Scenario A/D）：`UPDATE scenes SET asset_id` 的 WHERE 沒有比對送出當下的指標。人在送出後按了「設為正式版本」，會被稍後完成的生成靜默還原。且 `setVisualFromAsset` 不走 `applyWithRevision`、**不遞增 `rev`**——畫面指標完全在樂觀併發系統之外 | `generationCore.ts:1047-1056`；`scenes.ts:571` |
| 6 | **`generateVariants` 是唯一略過 `assertNoPendingVisual` 的畫面生成入口**（實測：`generateInto` 1 次、`generateVariants` 0 次）。單飛守衛只存在於前端，重新整理或第二個分頁就能對同一鏡再送一批要付費的工作 | `scenes.ts:1268` vs `:1227` |
| 7 | **連戲／過時引擎看不見任何面板寫入**：`detectContinuityDrift` 只迭代**凍結快照**並比對卡片**內容文字**，從不比對該鏡當下的 `characterIds`/`lookIds`/`scenePresetIds`。換 Look、加減角色、換場景——#722/#723 的全部意義——都不會標「畫面過時」。`camera`/`performance`/`action` 根本不在快照裡 | `shared/continuity.ts:105-143` |
| 8 | **`refine` 沒有帶 `lookIds`**：每次「再變體」都丟失該鏡的造型錨點。`generateInto`（`:1247`）與 `generateVariants`（`:1298`）都有帶 | `scenes.ts` refine 區塊 |
| 9 | **批次套用非原子**：`Promise.all` 一筆衝突就整組 reject，但已提交的寫入仍然成立；而且錯誤路徑會**跳過** `listByProject.invalidate()`，畫面繼續顯示寫入前的資料與過期的 rev，導致之後每次重試都失敗 | `VisualChoiceTray.tsx:209/230/239/249`、`:263`、`:277` |
| 10 | **核准路徑寫死 `falSubmit`**：`advanceGeneration` 是依 `nim_`/`gemini_` 前綴分流的，核准路徑卻沒有。**任何超過門檻的 Gemini/NIM 變體，在組長核准後必定失敗** | `generation.ts:~901` vs `generationCore.ts:949-953` |
| 11 | **專業模式分鏡板在約 130 鏡以上直接壞掉**：`ShotCard.tsx:228` 每張卡各發一個 `shotAssetSuggestions` 查詢，`enabled: mode === "pro" && detailsOpen`，而 `preferDetailsOpen` 回傳 `pro && !mobile`——**桌機專業模式預設全開**。tRPC 把它們批成單一 GET，200 鏡約 25 KB，超過 Node 預設 16 KB header 上限，連同批的 `props.list` 一起失敗，綁定的卡片名靜默變成 placeholder | `ShotCard.tsx:69-77, 228-231` |
| 12 | **Look 語意外洩**：移除角色後，它的 Look 仍留在該鏡——顯示為現況、生成時被忽略、任何 UI 都刪不掉，而且角色一回來就復活。另外當 `lookOwnerById` 不完整時，同角色的置換會靜默失效，該鏡留下**同一角色兩套 Look**，生成時依 SQL 未排序結果挑一個 | `visualCreativeSemantics.ts:72-99` |
| 13 | **`registerAssistantPage` 的 cleanup 連 `focusLayer` 一起清掉**，與它自己 `:172-174` 的註解（兩層獨立、頁面捲動不該清掉打開中的分鏡）矛盾。v4 的 Aios 提案接縫正好依賴這個 focus | `assistantContext.ts:163-169` |

---

## P2（只列高價值）

**金額**
- Provider 已接單但回應遺失 → 使用者被退點、該列標 failed、`requestId` 從未持久化，**fal 帳單照計**；而 UI 建議的「再試一次」會買到第二個工作。
- Gemini/Veo 的工作狀態放在**單一 process 的 Map**，但 runner 是全域輪詢所有 queued 列——重啟或第二個 replica 會把一個仍在執行、仍在燒 Google 配額的生成判失敗並退點。
- `actualPoints` 把 `awaiting_approval`（明確標註「未扣點」）以完整 `pointsEst` 計入，「實際淨花費」高報。

**真相／UX**
- 變體批次真相（狀態、比較集、失敗數、成本行）只活在 `useState`，工作室也不是 URL 可定址：F5／關閉／切換就消失，但真實工作仍在跑、點數仍被佔用。
- `autoOpened` 一旦卡住（成本待核，或殘留批次被帶到另一鏡），4 秒輪詢無上限持續。
- 前端寫入閘門忽略 `awaiting_approval`（`isGenerating` 只看 `generating`），按鈕仍可按，但伺服器 `assertNoPendingVisual` 會回 CONFLICT——該是禁用按鈕，不是丟錯誤。
- **#723 的兩支 contract test 是「讀原始碼字串」測試**（`readFileSync` + `toContain`），不執行 router、不碰 DB。行為就算反了、死了、無法到達也照樣通過。`generationCore.test.ts:133-142` 同一模式。

**資料**
- 採用變體不會重置 `trimStartMs`/`trimEndMs`（`setVisualFromAsset` 只寫素材 id）——時間軸／匯出會在新素材不存在的幀位切。
- Scene 家族沿用單值的 Asset 規則，`scenePresetIds` 一律被換成單一 id，靜默摧毀合法的多場景綁定（`MAX_GENERATE_SCENE_PRESETS = 4`）——**而且單元測試把這個破壞寫成了期望值**。
- `continuityCheck.ts:87-92` 的 Map 以 `generationId` 為鍵：兩個鏡共用同一素材時會碰撞，**只有其中一鏡會被檢查**。
- Mixed 投影會把不同的 id 集合塌縮成同一顯示字串（`names()` 靜默丟棄查不到的 id），真的不同的鏡被報成一致。
- 尚未落地的素材以 `landState: 'landed'` 插入。

**其他**
- `generateVariants` 直接把 `rejection.message` 回給前端，繞過專門用來擋內部錯誤外洩的 tRPC `errorFormatter`。
- `compareOpen` 可能為 true 但對話框未渲染（它在 `tab === "versions"` 內），焦點陷阱被拆掉：焦點跳到背景、body 捲動解鎖、Escape 被吞。
- 分鏡板每個影片鏡都掛一個 `<video preload="metadata">` 且無視窗可見性閘門：200 鏡＝200 個媒體元素與 200 個 range request。（補充：無 autoplay、非 `preload="auto"` 這點是對的；問題只在規模下沒有 viewport gate。）

---

## 誤報／已驗證安全

**兩條是本審查自己先前的誤判，被反方 agent 推翻，這裡更正：**

- ~~「approved 保護只在前端，是 P1 缺口」~~ — **框架錯誤**。這個 repo 記載的不變式是「**approved 的素材不會被 AI 自動覆蓋**」（`server/db/schema/projects.ts:272`、`ShotCard.tsx:342`），不是「approved 唯讀」。`generationCore.ts:1063` 明確指定人工在單格工作室按「設為正式版本」是**核准的例外出口**。在 `setVisualFromAsset` 加守衛反而會破壞既定流程。真正成立的只有 **AI 自動化路徑**的繞過（見 P1-4）。
- ~~「血緣無法重建」~~ — **講得太重**。父素材 UUID 本來就是 `generations.source_url` 的字面子字串，而 `signedAssetId()`（`generation.ts:27-29`）是既有的生產程式碼、`generation.retry` 已經在用。真正的缺口只是**沒有投影出來**。

**被推翻的資安疑慮（好消息）**：`persistGeminiPayload` 並未把 `GEMINI_API_KEY` 轉送到任意 URL；冪等鍵碰撞不會回傳其他租戶的生成列；封存專案並非可透過面板寫入。

**確認正確、請勿「修」**：
- `preserveScenePointer` 的儲存／還原往返是真的；變體確實不移動 `scenes.assetId`（前提是沒走 P0-2 的核准路徑）。
- 指標回填的 approved 守衛是伺服器端、且原子地寫在 WHERE 條件裡（無 TOCTOU）。
- 同鍵冪等是真的：id 即 generations 主鍵，唯一鍵衝突 catch 回既有列，不重複扣點。
- **provider 成功 → 儲存失敗**處理正確：done 翻轉、素材寫入、分鏡回填在**同一個交易**內，且對 `status IN (queued, running)` 做 CAS；素材寫入失敗整筆 rollback，該列留在 queued/running 等下次輪詢重試，**不會被標成完成**。
- Provider 回報完成但無輸出 → 標失敗並退點。
- **Scenario B（選取漂移）安全**：`VisualChoiceTray.tsx:191-193` 在任何 await 之前就用 `snapshotOperationTargets` 同步凍結目標 id。
- 跨專案 id 注入被擋：`assertGenerationEntityIds`、`characterLooks.projectId` 檢查、`asset.projectId === scene.projectId`。
- `projects.updateWorldview` 是伺服器端合併（`{...current, ...input.worldview}`），面板只送 `{ styles }` 不會清掉其他欄位。
- 390px CSS 用的是不會溢出的 `minmax(0, 1fr)` / `minmax(min(300px, 100%), 1fr)`、`min-width: 0`、44px 觸控高度、安全區 inset。

---

## 給主線實作者的交接

### 先修（P0）

1. `StoryboardStage.tsx:175` 加 `key={studioShot.id}`（比照 `SceneList.tsx:1118`）。一行，同時解掉寫錯鏡、對錯鏡花錢、假成功三件事。
2. `generation.ts:885` 展開既有 meta：`storeGenerationSourceMeta(submitParams, { ...splitParams.meta, secondarySourceUrl, usedUserKey })`。
3. `styles.css:10007` 的 `z-index` 必須低於 `.modal-scrim`（50），或 modal 開啟時不渲染面板。

### 再修（P1）

4. `mcpWriteExpansion.ts:864` 補 `sceneRole` + `preserveScenePointer` + 卡片 id；更好的做法是與 `generation.retry:518-527` 共用同一個重試建構函式。
5. `generationCore.ts:1047` 在 WHERE 加上對送出當下 `asset_id` 的 CAS。
6. `scenes.ts:1268` 為 `generateVariants` 補 `assertNoPendingVisual`。
7. `scenes.ts` 的 refine 補 `lookIds`。
8. `VisualChoiceTray.tsx:209+` 改 `allSettled`，回報成功/失敗筆數，且**任何情況都要** invalidate。
9. `generation.ts` 核准分支比照 `advanceGeneration` 依 provider 分流。
10. `ShotCard.tsx:230` 不要每卡一查詢：改伺服器端批次，或以視窗可見性閘門。
11. `assistantContext.ts:165` 頁面 cleanup 不可清 `focusLayer`。

### 不要重建（直接沿用這些既有模組）

- **Direction 表示法**：`shared/story.ts` 的 `shotCameraSchema` / `shotPerformanceSchema` / `mergeShotDirection` / `describeDirectionChange` / `formatShotDirection` / `SHOT_DIRECTION_FIELD_LABEL`。一個 Direction ＝ 對 `camera` + `performance` + `action` 的一份 delta，**只在生成當下虛擬套用**。不需要新 schema。
- **三層已經存在且已經分離**，就在 `buildShotContextPrompt`（`scenes.ts:197-219`）：Project ＝ generationCore 錨點層 + `worldview.styles`；Scene ＝ `storyScenes.environment`；Shot ＝ `scenes.camera/performance/action`。不要加第四層。
- **版本真相不變**：`generations`、`assets`、`scenes.assetId`、`shared/sceneVersions.ts` 投影。不要第二套 candidate store，不要 `asset_versions` 表。
- **血緣**：不要開新表。父素材 id 已在 `generations.source_url`，用既有的 `signedAssetId()` 取出並**投影到 `SceneVersion`**。（加固選項：真的加一個 `sourceAssetId` 欄位，因為 `source_url` 是會過期的簽名網址，而且素材未落地時它是外部 URL、根本不含 id。）
- **Reference Lock 的結構性保證只來自錨點層**（`cardAnchors` / `formatCharacterAnchor`）與參考圖。提示詞裡寫一句「臉不要改」不是保證——UI 要誠實說明這個界線。

### v4 契約要點

1. 「三個不同方向」要能事後稽核，delta 就必須被持久化。建議放進 `generations.params.__aiosSourceMeta`（沿用 `preserveScenePointer` 的既有先例），才能證明 A/B/C 真的不同。純提示詞文字無法驗證。
2. **優先權**：Direction delta 逐欄勝過 Shot 現況，走 `mergeShotDirection`。**陷阱**：缺鍵＝不動這欄，空字串＝清掉這欄。一個 Direction 絕不可以對它根本不在意的欄位送出 `""`。
3. 被 Lock 的家族必須在**型別層**就排除在 delta 之外，不能只在 UI 過濾。
4. 「改 Camera → 圖／影過時」**沒有現成引擎可沿用**（見 P1-7）。要讓 `continuitySnapshot` + `detectContinuityDrift` 帶上 camera/performance/action，這是**新工作**，不是重用。

### 必須補的回歸測試

現有的 contract test 是讀字串的 grep，**不能算覆蓋**。

- DB 層：變體 → `awaiting_approval` → `decideCost` 核准 → advance → 斷言 `scenes.assetId` **未變**。
- MCP 重試失敗變體：指標不動。MCP 重試失敗旁白：音訊**不得**落進 `scenes.assetId`。
- 生成完成 vs 人工採用：人的指標要贏。
- ShotNavigator A→B 帶未存草稿：B 的 prompt 不被動到、沒有生成使用 A 的文字、在 B 重送變體會建立 `scene_id = B` 的列。
- 批次套用遇到一筆 rev 衝突：回報筆數與 DB 相符，且畫面有重新抓取。
- 綁定置換（面板把 Look A 換成 B）：該鏡要被報為過時。
- 採用長度不同的變體：trim 要被重置或明確警告使用者。
- `awaiting_approval`：不計入 `actualPoints`；輪詢要退避。

---

## 已知限制

- 本審查是**靜態＋測試層**分析：此 checkout 沒有 `DATABASE_URL`，也沒有 provider 憑證，因此**所有 DB 層與 provider 層的行為都未實機執行**。凡是需要真實資料庫或真實 provider 才能證實的情境（實際扣點、實際覆蓋、實際退款對帳），狀態為 `BLOCKED_BY_EXTERNAL_DEPENDENCY`，本文以程式碼路徑推導並標明推導依據，未宣稱已實測。
- 390px 與桌機的結論來自**閱讀 CSS 規則並計算**，非瀏覽器截圖驗證。
- 審查對象是 `6752d59c`。審查期間另一個 session 正在 `feat/creative-intelligence-v4` 上動同一批檔案（其未提交的工作區已含 P0-2 的修正）。**凡是該分支已經動過的檔案，請以該分支的最新內容重新確認後再開單。**
