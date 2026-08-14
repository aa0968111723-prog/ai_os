# VISIBLE WORKSPACE HANDOFF CONTRACT（給 #728）

> #728 = Aios Visible Creative Workspace ＋ Starter Pack Asset Bible，目前是
> prototype / fixture / presentation contract。
>
> **這份文件不建立任何新 API。** 它只回答一個問題：#728 merge/sync 之後，
> 要顯示「方向、候選、成本、血緣、目前用哪一版」時，**該去讀 CURRENT 的哪裡**。
>
> 凡是 CURRENT 已經足夠的，直接寫怎麼讀。真的缺的，只記成
> `INTEGRATION REQUIREMENT`，**不在 #726 最後一刻擴 scope**。

寫作基準：PR #726 HEAD（`feat/creative-intelligence-v4`）。

---

## 0. 一句話

**一個 Shot 的整個創作工作區，都可以從 `scenes.versions` 這一支查詢畫出來。**
不需要第二個 API、不需要第二個 candidate store。

```ts
const { data } = trpc.scenes.versions.useQuery({ sceneId });
// data.versions: SceneVersion[]   ← 每一版的全部展示欄位
// data.assetId                    ← current pointer
// data.camera / performance       ← 這一鏡現在的鏡頭語言（方向 delta 的基準）
```

批次分群用 `shared/sceneVersions.ts` 的純函式，不必自己 group：

```ts
import { groupVisualVariantBatches } from "@shared/sceneVersions";
const batches = groupVisualVariantBatches(versions.filter(v => v.role === "visual"));
```

---

## 1. CreativeDirection presentation fields

| #728 需要 | CURRENT 來源 | 型別 | 備註 |
| --- | --- | --- | --- |
| `directionId` | `SceneVersion.creative.directionId` | `string` | 穩定 id；起手包是 `closer` / `low-backlight` 等 |
| short label | `SceneVersion.creative.directionLabel` | `string` | **已是人話**（「低機位強逆光」），直接顯示，不必回查起手包 |
| `changes[]` | `compileDirection(base, direction).changes` | `string[]` | 純函式，`shared/creativeDirections.ts`；輸出如 `["鏡別 中景→特寫"]` |
| `keep[]` | `SceneVersion.creative.keep` | `string[]` | 家族 id；中文標籤用 `CREATIVE_KEEP_LABEL` |

**要畫「這個方向做了什麼」而不只是標籤時**，`changes[]` 需要一個基準：

```ts
import { compileDirection } from "@shared/creativeDirections";
import { findCreativeIntent } from "@shared/creativeDirectionPresets";

const base = { camera: data.camera, performance: data.performance, action: data.action };
const compiled = compileDirection(base, direction);   // direction 來自起手包或 #728 自己的來源
compiled.changes;              // ["鏡別 中景→特寫", "運鏡 －→緩推"]
compiled.structurallyDiffers;  // 這個方向對這一鏡是不是真的有差
```

⚠️ **`changes[]` 是相對於「現在的 Shot」算出來的**，不是相對於生成當時。
若 #728 要顯示「這一版生成時做了什麼」，用 `generations.continuitySnapshot.shotDirection`
（凍結值）而不是重新 compile——見 §8。

---

## 2. generation → direction linkage

三個 id 都在同一個物件上，不需要 join：

```ts
version.generationId          // string | null（null = 外部帶入的素材）
version.creative?.directionId // string | undefined
version.creative?.batchId     // string | undefined
```

`creative` 的持久化位置是 `generations.params.__aiosSourceMeta.creative`
（`shared/generationSourceMeta.ts` 的 `GenerationCreativeMeta`），
由 `scenes.versions` 投影出來。**送 provider 前整段會被剝掉**，不會污染提示詞。

---

## 3. candidate state

`SceneVersion.state`（`shared/sceneVersions.ts` 的 `SceneVersionState`）：

| state | 意思 | 已扣點？ |
| --- | --- | --- |
| `current` | 這一鏡現在用的就是它 | 是 |
| `candidate` | 已完成、可一鍵切回 | 是 |
| `generating` | queued 或 running | 是（預留） |
| `awaiting_approval` | 成本審核中 | **否**（未扣點、未送 provider） |
| `failed` | 失敗或被駁回 | 已退點 |

`refunded` 不是獨立 state——退點反映在 `version.points`（見 §7）。

批次層級的彙總（`VisualVariantBatch`）：
`successes` / `failed` / `generating` / `awaitingApproval` / `settled` / `missing`。
`settled` 的定義是「沒有任何一個在 generating 或 awaiting_approval」——
**等待核准不算結算**，不要對使用者謊稱這批跑完了。

---

## 4. current pointer

```ts
data.assetId                    // scenes.assetId，唯一真相
version.isCurrent               // 投影出來的布林
version.canSetCurrent           // 可否一鍵切成現用（有落地素材、不是現用、status=done）
```

改變它只有一條路：`trpc.scenes.setVisualFromAsset`。

```ts
setVisual.mutate({
  sceneId, assetId,
  acknowledgeApproved: true,   // 已通過審核的鏡要換畫面必須明確承認（會退回「需要修改」）
  syncShotDirection: true,     // 一併把產生它的那個方向的鏡頭語言還原回 Shot
});
```

⚠️ **這兩個旗標只有在「人正看著這一鏡、看得到 diff」時才該帶。**
批次操作一律不帶——否則會用一張圖的凍結設定覆寫 N 鏡的鏡頭語言（#725 P0 的變形）。
回傳值帶 `adoptedDirection: string[]`，#728 應該把它顯示出來（不要靜默寫入）。

---

## 5. candidate / current relationship

```
generations（每一次生成，逐筆真相）
   └─ assets（落地成品，meta.generationId 回連）
        └─ scenes.assetId（current pointer，結構上保證同一 role 至多一個）
```

`shared/sceneVersions.ts` 的 `buildSceneVersions()` 就是這三者的投影。
**沒有 `asset_versions` 表，也沒有第二個 candidate store**，請不要新增。

---

## 6. lineage / parentAssetId

```ts
version.creative?.parentAssetId // 使用者是從哪一版接著想的（uuid）
version.parentIndex             // 換算成使用者看得到的版次：3 表示「從 V3 延伸」
```

`parentIndex` 由 `buildSceneVersions` 在編完版次之後回填；父版被回收時是 `null`
（不謊報版次）。

⚠️ **`parentAssetId` 是血緣標記，不是生成輸入。** 變體走 regen 模型（`isSceneRegenModel`，
沒有圖片輸入槽），所以「接續 V2」不會以 V2 為底重繪。#726 的 UI 已照這個事實措辭
（「接續 V2 的想法（重新生成，不以該圖為底）」）。**#728 不要把它畫成「以這張圖改」。**
真正以某張圖為底的是 `scenes.refine`（image-to-image），那條路有 `sourceAssetId`。

---

## 7. actual settled cost

```ts
version.points        // 這一版的淨點數 = (pointsActual ?? pointsEst) - pointsRefunded
batch.actualPoints    // 該批次所有版本的 points 加總
```

計算在 `shared/sceneVersions.ts` 的 `pointsOf()`，與帳本同口徑（淨消耗）。

⚠️ **已知限制（#725 P2，未修）**：`awaiting_approval` 的列尚未扣點，但 `pointsOf`
會用 `pointsEst` 計入，於是「實際淨花費」在有待核列時**高報**。
若 #728 要顯示成本，建議自己排除 `state === "awaiting_approval"` 的列，
或見 §11 的 `INTEGRATION REQUIREMENT #2`。

---

## 8. reference lock truth / strength

```ts
version.creative?.keep   // 這個方向**宣告**保持哪些家族
```

**這是宣告，不是像素級保證**，#728 的用字必須誠實：

- **結構上成立的部分**：`shared/creativeDirections.ts` 的白名單
  （`DIRECTION_CAMERA_KEYS` + `DIRECTION_PERFORMANCE_KEYS`）讓 Direction 在型別與
  執行期都寫不進角色／造型／場景／Style 欄位。這一半是真的。
- **不成立的部分**：變體走的 regen 模型沒有 reference image 槽，
  所以「臉會不會變」最終取決於模型。keep 只是把「我們沒有動那些欄位」講給使用者聽。

真正的像素級錨定來自 `continuitySnapshot.referenceAssetIds`（有參考圖的路徑）。
若 #728 要畫「鎖定強度」，可讀 `generations.continuitySnapshot`：
`referenceAssetIds.length > 0` ＝ 有真的參考圖；`locked` ＝ 使用者要求凍結。
→ 這需要一個投影，見 §11 的 `INTEGRATION REQUIREMENT #1`。

---

## 9. partial failure state

完全由持久化真相推導，**reload 後仍一致**：

```ts
const batch = groupVisualVariantBatches(visualVersions)[0];
batch.successes / batch.failed / batch.generating / batch.awaitingApproval
batch.requested   // 送出時寫進 meta 的 batchSize
batch.missing     // requested - 實際落庫數
version.error     // 逐版的失敗原因
```

**唯一推不出來的**：「送出當下就失敗、連生成列都沒建起來」的 slot
（伺服器會刪掉待生成列，DB 沒有痕跡）。#726 的 UI 明說那一類重新整理後看不到。
#728 若要顯示，只能沿用同樣的誠實作法——不要假造一個 placeholder。

---

## 10. reload reconstruction source

**唯一來源就是 `trpc.scenes.versions.useQuery({ sceneId })`。**

不需要 localStorage、不需要 URL state、不需要在前端保存批次身分。
`batchId` 住在 `generations.params` 裡，所以同一批在任何一次查詢都湊得回來。

輪詢節奏：`data.summary.generating` 為 true 時加快（#726 用 4s/20s）。
⚠️ 不要用「批次還沒自動開過 Compare」當輪詢條件——那會讓卡在等待核准的批次
無限期高頻輪詢（#725 P2 已記錄的實際缺陷）。

---

## 11. INTEGRATION REQUIREMENTS（CURRENT 真的缺的投影）

以下是 **#728 需要、但 CURRENT 沒有投影出來** 的東西。
**刻意不在 #726 實作**（那會是最後一刻擴 scope），登記在此供 #728 決定。

### IR-1 — reference lock 的「實際強度」未投影
`SceneVersion` 有 `creative.keep`（宣告），但沒有
「這次生成實際掛了幾張參考圖 / 快照有沒有鎖」。
資料**已經在** `generations.continuitySnapshot`（`referenceAssetIds`、`locked`），
只是 `scenes.versions` 沒有 select 它。
**成本**：在 `server/routers/scenes.ts` 的 versions query 多 select 一欄並投影兩個布林/數字。
**不需要 migration。**

### IR-2 — `points` 把未扣點的待核列計入
見 §7。`pointsOf()` 對 `awaiting_approval` 用 `pointsEst`，導致成本高報。
**成本**：`shared/sceneVersions.ts` 的 `pointsOf` 加一個 status 判斷，
或 `SceneVersion` 多一個 `settledPoints` 欄位。屬 #725 P2，#726 未修。

### IR-3 — 起手包 Asset Bible 的 binary 尚未存在
`shared/visualChoicePreviewManifest.ts` 的路徑契約已經穩定：
`/creative-choice/starter-v1/<family>/<id>.webp`，缺圖時走 SVG/色票 fallback。
**#728 的 Starter Pack 只要把檔案放到那個路徑就會生效，不需要改 React。**
契約與 fallback 的測試在 `shared/creativeDirectionPresets.test.ts`
（含「預覽不准退化成一個點」與「同一意圖的三個方向預覽必須不同」）。

### IR-4 — 自訂方向沒有 UI（伺服器已就緒）
`creativeDirectionSchema` 已經接受任意 camera/performance/action delta ＋ 500 字自由指示，
`scenes.generateVariants` 也照收。**缺的只有 UI**——#726 的 SceneStudio 目前只送得出
內建 12 個方向。#728 若要做「自由描述方向」，不需要動伺服器。
⚠️ 送出前**必須**過 `sanitizeDirection()`：schema 是 `.strict()`，
夾帶顯示欄位（例如 `previewResource`）會被 400 擋掉（#726 實際踩過）。

---

## 12. 不要做的事

1. **不要新增 `asset_versions` 或第二個 candidate 表。** 版本真相是
   `generations` + `assets` + `scenes.assetId` 三者的投影。
2. **不要新建 selection store。** 焦點走既有的 `registerAssistantFocus`
   （`client/src/lib/assistantContext.ts`），該層的不變式是「只放指標、不放資料」。
3. **不要在 presentation 層寫 durable truth。** 提案 ≠ 已修改：
   `shared/creativeProposals.ts` 是純函式，型別上就不可能寫入。只有
   `generateVariants`（花錢）與 `setVisualFromAsset`（改指標）會寫。
4. **不要為 #728 造第二套 API。** 上面每一欄都已經在 `scenes.versions` 裡；
   真的缺的只有 §11 那四條，且都是「多投影一個既有欄位」等級。
