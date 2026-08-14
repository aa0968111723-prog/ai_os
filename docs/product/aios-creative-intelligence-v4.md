# Aios Creative Direction Intelligence（v4）— CURRENT 稽核與架構

## Base

- CURRENT default branch：`claude/healing-migration-ai-os-erewp2`
- Base SHA：`6752d59c`（含 PR #723 的 merge `3cf4c188`；其後只有一筆 dependabot #712）
- 分支：`feat/creative-intelligence-v4`（獨立 worktree，未碰主目錄）

## 一、CURRENT 稽核（先審再改）

用 8 個維度各自獨立稽核 ＋ 對抗式覆核（預設立場是「推翻這個發現」）。
**52 項原始發現 → 37 CONFIRMED／7 FALSE POSITIVE／3 DEFERRED。**

### PR #723 宣稱 vs 實際

| # | 宣稱 | 判定 | 依據 |
| --- | --- | --- | --- |
| 1 | v2 真相與 #722 一致 | ✅ 真 | `git diff 1a11a5b0 3cf4c188` 確認 v2 確實寫 `{styles:[label]}`，v3 改成家族感知選擇 |
| 2 | variants 不覆蓋 current pointer | ⚠️ **部分真** | 入口與完成回填都對，但 `generation.decideCost` 全欄覆寫 `params` 會把 `preserveScenePointer` 洗掉 |
| 3 | partial failure 是真的 | ⚠️ **部分真** | 伺服器 `Promise.allSettled` 逐 slot 回報是真的；但批次身分只活在 React state，reload 就沒了 |
| 4 | retry／idempotency 安全 | ⚠️ **部分真** | 冪等重播沒有租戶範圍；`reserveQuota` 對同一 generationId 不冪等 |
| 5 | approved Shot 被保護 | ⚠️ **部分真** | `advanceGeneration` 的回填有擋；`setVisualFromAsset` 完全沒有檢查 |
| 6 | Mixed State 全由 persisted truth 推導 | ⚠️ **部分真** | 確實是純投影，但分群鍵用顯示名稱，會把不同的鏡折成假的 uniform |
| 7 | Style/Look/Scene/Character 語意一致 | ⚠️ **部分真** | 見下方「三層」一節 |
| 8 | 390px 可用 | ⚠️ **部分真** | CSS 寫了 44px 與單欄，但底部面板蓋住分頁列、也蓋住它自己叫出來的工作室 |

### 這一輪修掉的 CURRENT 缺陷

| 嚴重度 | 缺陷 | 位置 |
| --- | --- | --- |
| P1 | `decideCost` 只挑兩個欄位重建 `params`，弄丟 `preserveScenePointer`／`ablation`／`bench`。核准後的變體完成會**靜默蓋掉這一鏡的現用畫面** | `server/routers/generation.ts` |
| P1 | 冪等重播只用 id 查生成列，沒有租戶範圍 | `server/services/generationCore.ts` ×2（一般路徑＋待核路徑） |
| P1 | `reserveQuota` 對 generationId 不冪等；`refund` 卻是冪等的 ⇒ 扣兩次退一次 | `server/services/points.ts` |
| P1 | `setVisualFromAsset` 沒有 approved 檢查 | `server/routers/scenes.ts` |
| P1 | 分鏡中心的 `SceneStudio` 沒有 `key`，換鏡沿用上一鏡的變體冪等鍵 | `client/.../StoryboardStage.tsx` |
| P1 | Mixed State 用顯示名稱分群：卡片查不到名字／同名不同卡都會變成假的 uniform | `client/.../visualCreativeState.ts` |
| P1 | 手機底部面板蓋住分頁列（z-52 vs 44）、蓋住 SceneStudio（modal-scrim z-50）、無 `--kb-inset` | `client/src/styles.css` |
| P2 | 批次套用中途失敗不 invalidate，畫面停在舊值 | `client/.../VisualChoiceTray.tsx` |
| P2 | Style 卡防呆比 `styles[0]`，但 `styles` 是 `[look, texture?]` 且順序不保證 ⇒ 可能把 Style 清成 `[]` 卻顯示「已採用」 | `client/.../VisualChoiceTray.tsx` |
| P2 | 移除最後一張卡會讓該鏡改吃生成台的全域勾選（`resolveSceneCards` fallback），使用者無從得知 | `client/.../VisualChoiceTray.tsx` |
| P3 | 變體輪詢被「等待成本核准」的批次釘在 4 秒 | `client/.../SceneStudio.tsx` |
| P3 | 契約測試是 source-grep，對上述 P1 完全隱形 | `server/routers/scenes.variants.contract.test.ts` |

## 二、Creative Direction 架構

### 一個 Direction 是什麼

**對這一鏡既有 direction 欄位的一份 delta，加一句自然語言指示。**

```
CreativeDirection
  ├─ camera?:      Partial<ShotCamera>       ← 既有欄位，不新增 schema
  ├─ performance?: Partial<ShotPerformance>  ← 既有欄位
  ├─ action?:      string                    ← 既有欄位
  ├─ instruction?: string                    ← 自然語言
  └─ keep?:        CreativeKeepFamily[]      ← Reference Lock
```

`shared/creativeDirections.ts` 用**白名單**限制只准動 `Camera / Lighting / Action / Performance`
（`DIRECTION_CAMERA_KEYS` ＋ `DIRECTION_PERFORMANCE_KEYS`）。因此「保持角色臉／造型／場景／
專案 Style」**在結構上成立**——方向根本寫不進那些欄位，不是靠一句提示詞求模型幫忙。
`sanitizeDirection` 是這條界線的執行期守門，同時也是送出邊界（見下）。

### 生成時發生什麼

```
scenes.generateVariants({ batchId, variants: [{ clientRequestId, direction }, ...] })
  └─ 每個 slot 各自：
       compileDirection(scene, direction)            ← 虛擬套用，Shot 一個位元組都不動
       → virtual scene { camera, performance, action }
       → buildShotContextPrompt(virtualScene, model) ← 既有的 compiler，不重建
       → + formatDirectionContext(compiled)          ← 只補方向名／保持／那句話
       → executeGenerationCommand({ id, preserveScenePointer: true, creative, shotDirection })
            └─ 既有的 ACL／Policy／估點／核准門檻／額度／provider 路由／退點狀態機
  └─ Promise.allSettled → 逐 slot 回報
```

刻意**不共用一份 prompt**：共用就退回成 v3 的「同一 prompt ×3」，這一輪的重點就沒了。

### 血緣與批次：沒有新表、沒有 migration

方向、批次、血緣、送出當下的指標，全部落在既有的 `generations.params.__aiosSourceMeta`：

```ts
creative: { batchId, directionId, directionLabel, keep?, parentAssetId?, batchSize? }
scenePointerAtSubmit?: string
```

- jsonb 加欄位不需要 migration；
- 重試沿用 `params` ⇒ 方向與血緣自動跟著重試走（`generation.retry` 明確轉交）；
- 送 provider 前整個 `__aiosSourceMeta` 會被 `splitGenerationSourceMeta` 剝掉。

`shared/sceneVersions.ts` 把它投影成 `SceneVersion.creative` ＋ `parentIndex`
（`parentAssetId` → 使用者看得到的版次），並用 `groupVisualVariantBatches` 分群。
**批次狀態因此完全由持久化真相推導**，reload 之後仍講得出「A 成功／B 失敗／C 等待核准」。

刻意沿用既有 `assetRevisions`／`sourceAssetId`／source metadata 的概念，
**沒有新增 `asset_versions` 表，也沒有第二個 candidate 資料表**。

## 三、三層：Project / Scene / Shot

CURRENT 的資料模型**已經**能表達這三層，這一輪只是不去弄髒它：

| 層 | 真相欄位 | 誰寫 |
| --- | --- | --- |
| Project — 整體視覺識別 | `projects.worldview.styles`（`[look, texture?]`，家族互斥） | Style 卡（明確說「設為專案主風格」） |
| Scene — 環境方向 | `story_scenes.environment`（天氣／時間／氛圍）＋ `scene_presets`（色板／光線） | 場景卡與場標頭 |
| Shot — 暫時 delta | `scenes.camera` / `performance` / `action` / `prompt` | **Creative Direction 只動這一層** |

白名單保證方向永遠寫不到上面兩層。這是「不為了概念先加 schema」的具體做法。

## 四、相依感知的過時判定

`continuitySnapshot` 新增 optional 的 `shotDirection`（version 維持 1，舊快照照樣 parse）。
**刻意不進 fingerprint**——指紋的用途是「這批卡片參考是不是同一組」，把逐鏡鏡頭語言
算進去會讓既有的重試／沿用判斷在每次調鏡頭時失效。

於是區別講得出來：

| 改了什麼 | 畫面過時？ | 為什麼 |
| --- | --- | --- |
| Camera／Lighting／Composition／Angle | ✅ | 在 `shotDirection` 裡，逐欄比對 |
| Action／Performance | ✅ | 同上 |
| 角色外觀／造型 Look／場景色板／道具外觀 | ✅ | v1 就有的卡片漂移 |
| **配音 / 環境音 / 配樂 / 對白** | ❌ | **刻意不在快照裡** |

沒綁任何卡片的純寫景鏡本來拿不到快照（`buildContinuitySnapshot` 回 `null`），
補了 `emptyContinuitySnapshot` 空殼，讓鏡頭語言漂移不依賴卡片存在。

## 五、併發：人類優先

送出時把「這一鏡當下的現用畫面」記進 `scenePointerAtSubmit`；完成回填時把它加進
**同一條原子 where**：

```sql
UPDATE scenes SET asset_id = ?
WHERE id = ? AND deleted_at IS NULL
  AND review_status <> 'approved'
  AND asset_id = <送出當下那一張>     -- ← 新增
```

生成期間有人採用了別的版本 → 條件不成立 → **指標不動**。
生成照常完成、素材照常入庫、版本清單照樣看得到這一版（它就是一個候選）。
舊資料沒有 `scenePointerAtSubmit` → 不加這個條件，維持既有行為。

真 PostgreSQL 驗證見 `server/services/creativeVariantPointer.pg.test.ts`（7 項）。

## 六、Aios 提案：提案 ≠ 已修改

`shared/creativeProposals.ts` 是**純函式**：不回 Promise、不接 db handle、
型別上就不可能寫入。挑選規則保守且可預測（同一鏡每次打開看到一樣的）：

1. 已通過審核的鏡不主動提案；
2. 結構化上沒差的方向排掉（`structurallyDiffers`，不是 `differs`——每個方向都帶自己的
   instruction，用 `differs` 判斷等於「永遠有差」）；
3. `redundantWhen` 資料化的相關性規則（已經是特寫的鏡不再建議「更靠近人物」）；
4. 一個意圖最多貢獻一個提案 ⇒ 三個提案是三個角度。

沿用既有 `registerAssistantFocus`／`selectedEntityIds`，**不重建 Agent**，
也不把資料塞進 `assistantContext`（該層的不變式是「只放指標、不放資料」）。
點提案只會打開單格工作室——沒有任何 mutation，也沒有任何生成請求。

## 七、Context-aware Preview 分層

| Tier | 內容 | 成本 |
| --- | --- | --- |
| 1 | 內建 SVG 構圖圖／色票／姿勢圖（起手包自己指定圖形） | 零 |
| 2 | 專案既有 references（角色／場景／道具卡的 referenceUrl，`lazy` 載入） | 零（既有素材） |
| 3 | 個人化生成預覽 | **未實作**——見「已知限制」 |

`starterPreviewFor` 的路徑契約不變（`/creative-choice/starter-v1/<family>/<id>.webp`），
設計師放圖進去就會取代 SVG，不需要動 React。
新增的守門：起手包**不准**退化成一個點（v3 的反查表對 `intent.*` 命名空間全部落空），
且同一意圖的三個方向預覽圖形必須不同。

## 八、送出邊界（實測踩到的坑）

起手包的方向帶著 `previewResource`（純顯示欄位），而 tRPC schema 是 `.strict()` ⇒
**每一次「產生方向」都被 400 擋掉**，UI 卻沒有任何動靜。
單元測試抓不到（不經 tRPC 邊界），是真的開瀏覽器點下去才露餡的。

修法：`sanitizeDirection` 就是送出邊界（同時也是越權欄位的第二道濾網），
並由 `creativeDirections.test.ts` 斷言「清乾淨之後必須真的通過伺服器那份 schema」。

## 九、測試

| 檔案 | 內容 |
| --- | --- |
| `shared/creativeDirections.test.ts`（17） | 虛擬套用、白名單、送出邊界、方向多樣性 |
| `shared/creativeDirectionPresets.test.ts`（11） | 起手包結構、Reference Lock、多樣性、預覽不准退化成一個點 |
| `shared/creativeVariantLifecycle.test.ts`（29） | params 往返、`decideCost` 攤平 meta、partial failure 三態、reload 一致、血緣版次、相依感知、提案不寫入、重試沿用批次 |
| `server/services/creativeVariantPointer.pg.test.ts`（7，真 PG） | 變體不動指標、人類優先、approved 不回填、冪等 |
| `server/services/creativeVariantCost.pg.test.ts`（5，真 PG） | 同一把鍵只扣一次、並行重送、扣一次退一次淨額歸零 |
| `client/.../visualCreativeState.test.ts`（10） | Mixed State 用 id 而非顯示名稱分群 |
| `client/.../SceneStudio.test.tsx`（39） | 方向送出 payload、方向可取消勾選、Adopt 旗標、A/B 只掛一個媒體元素 |

`scenes.variants.contract.test.ts` 保留但改成**只斷言結構**（沒有第二條管線／第二個表），
並在檔頭寫明「字串在不等於不變式成立」。

## 十、已知限制

1. **`parentAssetId` 是血緣標記，不是生成輸入。** 這一批走「重畫」模型（`isSceneRegenModel`，
   沒有圖片輸入槽），所以「接續 V2 的想法」不會以 V2 為底重繪。UI 已經照這個事實措辭。
   要以某張圖為底改，是「以這版修正」（image-to-image）那條路。
2. **Reference Lock 對這類模型是「白名單 ＋ 一句提示詞」，不是像素級保證。**
   方向確實寫不進角色／造型／場景欄位（結構保證），但 regen 模型沒有 reference image 槽，
   所以臉會不會變仍取決於模型。Compare 卡片顯示的「保持」是方向的**宣告**。
3. **Tier 3 個人化預覽未實作**——刻意留白，避免「打開面板就偷偷花點數」。
4. **`scenes.update` / `setCards` 仍無伺服器端 approved 守衛。** 這是刻意的界線：
   §17 保護的是「團隊審過的那張畫面」，那兩支都改不了 `assetId`；改綁定只會讓畫面
   被連戲檢查標成過時，那是正確的行為。
5. **Direct Manipulation（點角色→Character、點背景→Scene）未實作。** CURRENT 的標注層
   是座標留言，沒有語意分割；硬做會變成猜。先不做。
6. **自訂方向 UI 未實作。** 伺服器 schema 已經接受任意 delta ＋ 500 字自由指示，
   但 SceneStudio 目前只送得出內建的 12 個方向。這是 UI 缺口，不是架構缺口。
7. **本機 pg 測試需要 Docker。** 未啟動時 `*.pg.test.ts` 依既有慣例 skip。


---

# #725 RED TEAM RECONCILIATION

對象：PR #725《Visual Creative UX v2/v3 上線前獨立審查》（docs-only，已 merge，
文件在 `docs/product/aios-visual-creative-ux-v3-production-review.md`）。

**規則：不把 P0 偷偷改叫 P1。** 每一條都以 CURRENT code 重新驗證，
並附上真正可執行的回歸測試或瀏覽器量測。

## P0

### P0-1 `<SceneStudio>` 沒有 `key`：寫錯鏡、對錯鏡花錢、假成功

| | |
| --- | --- |
| **Original severity** | P0 |
| **CURRENT status** | **FIXED**（兩層都補） |
| **Fix** | ① `client/src/features/storyboard-center/StoryboardStage.tsx` 加 `key={studioShot.id}`（比照 `SceneList.tsx`）。② `server/services/generationCore.ts` 的冪等重播查詢補上租戶＋分鏡範圍——**一般路徑與 awaiting_approval 路徑各一處**；撞號改回 `CONFLICT`，不再把跨鏡重用的鍵回報成一次成功送出。 |
| **Regression test** | `client/src/components/SceneStudio.test.tsx` →「#725 P0-1 跨鏡狀態隔離」4 項：A 的草稿不出現在 B、B 的生成帶 B 的 sceneId 與 B 的提示詞、B 的變體用全新冪等鍵與 batchId、A 的批次狀態不出現在 B。**以真的重新渲染證明，不是 grep `key=`。** |
| **Evidence** | **Mutation test**：拿掉 `key` → 紅 3 項，正好對應 red team 點名的三個傷害。還原 → 全綠。<br>**FLOW B**（瀏覽器，用真的 ShotNavigator 換鏡）：`switched=true leakedDraft=false A鏡輸入框已卸載=true B鏡生成數=1 A鏡生成數=0`。 |

> 補充：批次狀態這一項在 v4 是**架構上**不可能外洩的——批次由 `generations.params` 的
> `batchId` 分群推導，不再是 React state。所以第 4 項測試即使拿掉 `key` 也是綠的。

### P0-2 成本核准會清掉 `preserveScenePointer`

| | |
| --- | --- |
| **Original severity** | P0（無成本門檻時 red team 自評降為 P1） |
| **CURRENT status** | **FIXED** |
| **Fix** | `server/routers/generation.ts` 的核准分支改成 `storeGenerationSourceMeta(submitParams, { ...splitParams.meta, secondarySourceUrl, usedUserKey })`。攤平既有 meta 而不是只挑兩個欄位重建——同時救回 `ablation`／`bench` 的 `runId`（消融／競技場的分組鍵只存在 params 裡）。 |
| **Regression test** | `server/services/creativeVariantPointer.pg.test.ts` →「#725 P0-2 核准後變體仍不得移動指標」2 項，**真 PostgreSQL**：變體 → `awaiting_approval` → 核准 → 完成 → 斷言 `scenes.assetId` 未變；核准不得動 `sceneRole`。這正是 red team 交接清單第一條要求的測試。 |
| **Evidence** | **Mutation test**：拿掉 `...splitParams.meta` → 紅 2 項。還原 → 全綠。<br>**FLOW D**（瀏覽器＋DB）：`核准後 preserveScenePointer=true 完成後 current 未動=true 明確 Adopt 生效=true`。 |

### P0-3 手機：選擇面板蓋在所有 modal 之上

| | |
| --- | --- |
| **Original severity** | P0 |
| **CURRENT status** | **FIXED** |
| **Fix** | `client/src/styles.css` `@media (max-width: 820px)`：`z-index: 52 → 43`（低於 `.mobile-nav` 的 44 與 `.modal-scrim` 的 50）；底緣從 `inset: auto 0 0` 改為抬到 `--chrome-bottom + safe-bottom + kb-inset`，面板停在分頁列上方而不是壓在它身上；面板內有 textarea，補 `--kb-inset` 讓鍵盤不蓋掉輸入框與套用列。Compare 全螢幕加上下安全區、header 置頂、關閉鍵 44px。 |
| **Regression test** | FLOW E（`scripts/e2e-ui/creative-golden-flows.mjs`）。 |
| **Evidence** | **真瀏覽器量測，非讀 CSS**（red team 自己標明它的結論來自讀 CSS 計算）：<br>`分頁列可觸及=true (tray z=43, bar z=44)`、`modal在最上層=true (scrim z=50)`、`Compare未被面板蓋=true`、`關閉鍵=44x44`、`關閉後無殘留=true`、`無橫向溢出=true`。<br>用 `document.elementFromPoint()` 在 modal 的上／中／下三點量測最上層元素，不是比對 CSS 數值。 |

## P1

| # | Finding | Original | CURRENT status | Fix | Regression test |
| --- | --- | --- | --- | --- | --- |
| 4 | MCP `retry_generation` 是退化版重複實作 | P1 | **FIXED** | 抽出 `server/services/generationRetryInput.ts` 當單一真相，`generation.retry` 與 MCP 兩個入口共用；`signedAssetId` 一併下移到 service 層（`services` 不得 import `routers`） | `generationRetryInput.test.ts` 11 項（含「兩個入口拿到同一份輸入」） |
| 5 | 完成寫入沒有陳舊守衛；`setVisualFromAsset` 不遞增 `rev` | P1 | **FIXED** | `scenePointerAtSubmit` 記在送出當下，完成回填時進**同一條原子 WHERE**；`setVisualFromAsset` 在同步鏡頭語言時推進 `rev` | pg 指標政策 7 項＋FLOW C |
| 6 | `generateVariants` 略過 `assertNoPendingVisual` | P1 | **FIXED** | 補上同一道閘（與 `generateInto`／`refine` 一致） | — |
| 7 | 連戲引擎看不見任何面板寫入 | P1 | **FIXED** | `detectContinuityDrift` 新增 `currentBindings`：比對快照凍住的 id 集合 vs 這一鏡現在綁的 id 集合。換 Look／加減角色／換場景／加減道具都會標過時。用快照裡本來就有的 id，**無新欄位、無 migration** | `creativeVariantLifecycle.test.ts` →「#725 P1-7」7 項 |
| 8 | `refine` 沒帶 `lookIds` | P1 | **FIXED** | 補上（`generateInto`／`generateVariants` 本來就有） | — |
| 9 | 批次套用非原子、錯誤路徑跳過 invalidate | P1 | **FIXED** | `Promise.all` → `Promise.allSettled`（`applyPerShot`），逐鏡回報成功／衝突筆數；**任何情況都 invalidate** | — |
| 10 | 核准路徑寫死 `falSubmit` | P1 | **FIXED** | 比照 `advanceGeneration` 依 `isNimModel`／`isGeminiModel` 分流。原本任何超過門檻的 Gemini／NIM 生成核准後必敗 | `generation.continuity.test.ts` 第 3 項 |
| 11 | 專業模式分鏡板 ~130 鏡撞 header 上限 | P1 | **DEFERRED** | — | — |
| 12 | Look 語意外洩（移除角色留下孤兒 Look） | P1 | **FIXED** | `projectChoiceChange` 回報 `orphanedLookIds`，`VisualChoiceTray` 在同一次套用一併清掉 | `visualCreativeSemantics.test.ts` 4 項 |
| 13 | `registerAssistantPage` 的 cleanup 誤清 `focusLayer` | P1 | **FIXED** | cleanup 只清自己那一層；焦點層有自己的 token 與 cleanup | — |

### P1-11 DEFERRED WITH REASON

**Finding**：`ShotCard.tsx` 每張卡各發一個 `story.shotAssetSuggestions` 查詢，
桌機專業模式預設展開 ⇒ 200 鏡約 25KB query string，超過 Node 預設 16KB header 上限，
連同批的 `props.list` 一起失敗。

**為什麼 DEFER 而不是修**：

1. **Pre-existing on base**，#726 完全沒有觸碰 `ShotCard` 的這條查詢路徑。
2. 修它的正解是**新增伺服器端批次端點**（一次拿整個專案的建議），
   那是新 API ＝ 本次 closeout 明確排除的 scope（「禁止新增功能／新 API」）。
   在收尾 PR 裡順手加一支端點，等於把一個沒有測試預算的新介面塞進 review。
3. 次佳解（viewport gate）會改動分鏡板的載入語意，同樣不屬於本 PR 的責任範圍。

**建議**：獨立處理，與「分鏡板每個影片鏡都掛 `<video preload="metadata">` 無視窗閘門」
（同一份 red team 的 P2）一起做，因為兩者都是「專業模式大量分鏡下的載入策略」。

## 被推翻／不修（採信 red team 自己的更正）

red team 在自己的〈誤報／已驗證安全〉一節推翻了兩條，本 PR 尊重該更正：

- **「approved 保護只在前端」＝框架錯誤**。repo 的不變式是「approved 的素材不會被 **AI 自動**覆蓋」，
  不是「approved 唯讀」；人工在單格工作室按「設為正式版本」是**核准的例外出口**。
  因此 #726 的 `setVisualFromAsset` 守衛只擋「沒有明確承認」的批次路徑
  （`acknowledgeApproved` opt-in），不擋人工採用——並在換圖時把審核狀態退回「需要修改」，
  因為當初通過的是**那一張圖**。
- **「血緣無法重建」＝講得太重**。父素材 id 本來就在 `generations.source_url` 裡，
  真正的缺口只是沒有投影出來。#726 因此**沒有新增表**，
  而是把血緣放進既有的 source meta 並投影成 `SceneVersion.parentIndex`。
