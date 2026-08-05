# clarityai/crystal-upscaler

> 審計：R2 · index **#67** · 模式 **static+research（零 live）** · 2026-08-05  
> slug：`clarityai__crystal-upscaler`  
> 禁止改 `verified`／`points`（本卡僅建議）· **禁止 `--yes`**

## 1. 身分

| 項 | 值 |
|----|-----|
| **index** | 67 |
| **id** | `clarityai/crystal-upscaler` |
| **endpoint** | `clarityai/crystal-upscaler`（`endpointOf` = id，無 alias） |
| **label** | Crystal 人像放大 |
| **category** | `image-to-image` |
| **tier** | `flagship`（旗艦） |
| **kind** | `image` |
| **verified** | `true`（目錄已標；本回合**未** live 覆核；**禁止**本卡改碼） |
| **needs** | `image`（必填來源：人像照片） |
| **recommended** | `false` |
| **sourceHint** | 人像照片 |
| **strengths** | 人像特化放大;皮膚紋理、虹膜、髮絲細節,可到 10K |
| **bestFor** | 法師人像特寫、肖像大圖輸出的極致臉部品質 |
| **vendor** | **Clarity AI** Crystal Upscaler（人像／臉部微細節特化；fal Queue 託管，endpoint 前綴 `clarityai/`） |

**一句話**：**人像特化旗艦放大器**——必填 `image_url`，官方預設 **`scale_factor=2`**、**`creativity=0`**、**`output_format=jpg`**；按 **$0.016/MP** 計費，目錄括號自承 **4K 約 4 點**，但 **points=1** 僅錨在 1MP 機械基準。站內只送 `image_url`；是 **`sc-portrait-upscale`** 主選（Topaz 備選）。

## 2. 數值

| 項目 | 值 | 來源／算法 |
|------|-----|------------|
| **points（目錄）** | **1** | `shared/models.ts` 手填；`realPricePoints` 覆寫後仍 1 |
| **cost（目錄）** | `$0.016/MP(4K 約 4 點)` | 括號已自承 4K 點數 |
| **官方／生態價** | **$0.016 / megapixel** | `docs/fal生態研究.md` ✅已查證；與 cost 主句一致 |
| **parseRealCost** | `usdMid=0.016` · `multiplier=1` · `×1MP（16:9 標準輸出 ≈ 1MP）` | 本機 tsx 2026-08-05；**忽略**括號 4K 敘述 |
| **realPricePoints** | `max(1, round(0.016 × 1 × 31))` = `round(0.496)` = **1** | `USD_TO_TWD=31` |
| **estimatePoints()** | **1**（扁平） | UI／扣點／退點同口徑 |
| **校準報告** | **≈**（1 點 vs 估 0.5） | `docs/點數校準報告.md`「Crystal 人像放大」——**僅在 1MP 假設下 ≈** |
| **4K 輸出（~8.3MP）** | USD ≈ **$0.133** · NT$ ≈ **4.1** · 合理點數 **≈ 4** | 與 cost 括號／生態「4K 約 4 點」一致 |
| **預設 2×、來源 ~1MP** | 輸出 ≈ **4MP** · USD **$0.064** · NT$ ≈ **2.0** · 合理 **≈ 2** | OpenAPI `scale_factor` default **2** |

**風險（未改 points）**：

1. **主情境倒掛（計價，建議調點、本回合不改）**：`sc-portrait-upscale`／bestFor 皆寫「肖像大圖／極致臉部」；cost 括號與生態亦寫 **4K ≈ 4 點**，但 **扣 1 點** → 典型大圖路徑平台約 **虧 1–3 點／張**（4MP～8MP）。校準表「≈」是 **1MP 錯基準**，不能當 4K 安全背書。
2. **scale_factor 上限 200**：官方允許極端倍率（生態「可到 10K／200x」）；站內**不送** scale → 吃預設 2，現況不觸發爆炸帳單。若未來暴露 UI，**必須**動態估點或硬上限。
3. **MP 進位敏感**：人像原檔常 1–12MP；預設 2× 後輸出 4–48MP → 實帳 $0.064–$0.77，站內仍扣 1。
4. **與姊妹檔**：Topaz #61 points=**2**（≤24MP $0.08）；Clarity #60 4K 更貴（$0.03/MP）卻也標 1——Crystal 同屬「旗艦 MP 價 + 扁平 1 點」低估族。**本卡不改 points**（審計禁令）。

## 3. 連通與生成

| 項目 | 結果 | 說明 |
|------|------|------|
| **L0 靜態契約** | **ok** | id 唯一；`needs/points/cost/tier/verified/strengths/bestFor/sourceHint/input` 齊 |
| **OpenAPI Queue** | **HTTP 200 · schema 有效** | `GET …/openapi.json?endpoint_id=clarityai/crystal-upscaler` → `CrystalUpscalerInput`／`CrystalUpscalerOutput`；`x-fal-metadata.endpointId=clarityai/crystal-upscaler` · about **Upscale** |
| **平台 metadata** | **HTTP 200 · active** | display_name **Crystal Upscaler** · category image-to-image · tags `image-to-image` · license **commercial** · updated **2026-05-06** · date 2025-11-25 · description「facial details and portrait photography」 |
| **L1 批次 probe** | **本輪未重跑** | 禁止 `--yes`；OpenAPI＋metadata 雙 200；**非** 404 |
| **dry-run verify** | **拒絕（正確）** | `npx tsx scripts/verify-models.ts --probe "clarityai/crystal-upscaler"` → needs=image 擋下；**未**加 `--yes` |
| **L2／L4 live** | **未跑** | needs=image；須站內素材；**禁止** 空跑 `--yes` |
| **輸出解析** | **契約 OK** | OpenAPI 回 **`images`**（array，required）——`extractResult` 優先讀 `images[0].url`（`server/services/fal.ts`） |
| **結論** | **ready-static-only** | required／input 對齊；**points 與大圖主情境低估**（見 §2／§9）；live 臉部品質與真實 MP 帳單待有圖實測 |

### OpenAPI 摘要（2026-08-05 本輪 curl）

- **required**：`["image_url"]`
- **order**：`output_format` → `scale_factor` → `creativity` → `image_url`
- **image_url**：string（URL to the input image）
- **scale_factor**：number，default **2**，min **1**，max **200**
- **creativity**：number，default **0**，min 0，max **10**（*Creativity level for upscaling*）
- **output_format**：enum **`png`｜`jpg`**，default **`jpg`**
- **Output**：`images`（Image 陣列，required）——**非**單數 `image`
- **無** `prompt`／`negative_prompt`／`seed`／`upscale_factor` 別名（本端用 `scale_factor`）
- **Queue**：`https://queue.fal.run` · paths `/clarityai/crystal-upscaler` + status／cancel／result

## 4. 底層邏輯

### 4.1 產品能力（官方／生態）

- **定位**：Clarity AI **臉部／人像特化**超分——皮膚紋理、虹膜、髮絲微細節；生態敘事：少「恐怖谷」假臉，可到 10K／高倍率；比 CodeFormer 更偏「放大＋精修臉部」而非修損。
- **vs Clarity 通用**（`fal-ai/clarity-upscaler` #60）：Clarity 是 SD 系**生成式**創意放大（creativity denoise）；Crystal 是 **Clarity AI 人像產品**、OpenAPI 無 prompt，creativity 預設 0。
- **vs Topaz**（#61）：Topaz 通用印刷旗艦；Crystal 在 **`sc-portrait-upscale`** 主選、Topaz 備選。
- **vs 忠實型**（Thera／AuraSR／DRCT）：字卡／中文勿用生成／特化臉部路徑；Crystal 人像主場。
- **vs CodeFormer**：CodeFormer 修復受損臉；Crystal 高品質肖像放大。

### 4.2 站內 `input()` 組裝

```ts
// shared/models.ts ~L782–788
input: (_p, _f, s) => ({ image_url: s }),
```

| 官方 property | 站內 | 備註 |
|---------------|------|------|
| `image_url` | ✅ `s` | 與 `needs:image`、缺來源攔截一致 |
| `scale_factor` | ❌ 不送 | 吃 **default 2**（最大 200） |
| `creativity` | ❌ 不送 | 吃 **0**（最保守） |
| `output_format` | ❌ 不送 | 吃 **jpg** |
| 提示詞 `p` | ❌ 丟棄 | schema **無** prompt |
| 畫幅 `f` | ❌ `_f` 忽略 | 尺寸＝來源 × scale_factor |

**P0 input 判定**：**無需修**——required 僅 `image_url`，站內已正確送出。

### 4.3 架構／分詞

- `modelMechanicsFor` → **family: `unknown`**（可接受）。
- 提示窗對 payload **無語意作用**；使用者應上傳**人像照片**，不是只寫「放大臉部」。

### 4.4 已知契約／文案缺口

1. **points=1 vs 4K／大圖主情境（建議調點）**：cost 括號、生態、配方皆指向大圖，扣點 1——見 §9；**本回合禁止改 points**。
2. **scale_factor／creativity 未暴露（P3）**：高倍率與微調 creativity 需產品決策＋動態估點。
3. **verified=true 但本輪零 live**：目錄歷史標 true；本卡**不**改 verified；L2 有圖後再覆核。
4. **輸出 `images[]`**：與多數 upscaler 的 `image` 不同，但 `extractResult` 已支援。

## 5. 點數路徑

| 步驟 | 行為 |
|------|------|
| 估點 | `estimatePoints` → **1**（`realPricePoints` = 1） |
| 預覽 | `prepareGenerationRequest` 只組裝、**不扣點** |
| 缺來源 | needs=image 且無來源 → `BAD_REQUEST`（sourceHint：人像照片） |
| 扣點 | `reserveQuota(…, est=1)` |
| 失敗／無成品 | 退點 |
| BYOK | 平台點數可為 0（既有路徑；本卡未 live） |
| 供應商實帳 | **$0.016 × 輸出 MP**；大圖與站內 1 點脫鉤 |

**一致性（站內帳本）**：顯示 1 ＝ 目錄 points ＝ reserve／refund——**內部自洽**。  
**一致性（對 fal 成本）**：**4K／主情境低估**；建議產品調 points（**本卡不改**）。

## 6. 暴露面

| 面 | 是否暴露 | 說明 |
|----|----------|------|
| 模型目錄／工作台選模 | ✅ | `image-to-image` · flagship · 可搜 label／id |
| 情境配方 | ✅ | **`sc-portrait-upscale`** pickIds[0]（Crystal 主、Topaz 次） |
| 工作流 presets | ❌（未見硬編碼） | 無固定步綁本 id |
| MCP `find_model` | ✅ | 全 MODELS 可查 |
| MCP `submit_generation` | ✅ | 與網頁同路徑；**必須**來源圖 |
| 助手 `assistantModel` | ❌ | `needs` → **undefined**（正確擋代操） |
| 負向提示／Seed UI | ❌ | schema 無；allowlist 無 |
| scale／creativity UI | ❌ | 吃 OpenAPI 預設 2／0 |
| `verify-models --probe` | ❌ | needs 拒絕；**禁止** `--yes` 空跑 |

**誤用面**：

- 當「字卡／書法」→ **Thera／AuraSR／Crisp**，非本模。
- 當「AI 圖通用補細節到 4K」→ **Clarity／Recraft Creative／Topaz**。
- 當「大量最省粗放」→ **ESRGAN／DRCT／SeedVR2**。
- 當「老照片修損」→ CodeFormer／photo-restoration。
- 無來源圖 → needs／助手雙擋。

## 7. 情境與可用性

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 法師／當事人肖像大圖 | ✅ 主選 | **`sc-portrait-upscale`** pick[0] |
| 皮膚／虹膜／髮絲微細節 | ✅ | strengths 核心 |
| 通用印刷無塑膠感 | △ | Topaz 主場；本模備選亦可 |
| AI 圖創意補畫 | △ | Clarity 更通用；本模偏人像 |
| 中文字卡忠實放大 | ❌ | 非主場；走 Thera |
| 大量批次最省 | ❌ | $0.016/MP 旗艦價 |
| 無來源圖 | ❌ | needs 攔截 |

**recommended=false**：合理——垂直人像旗艦，由 **`sc-portrait-upscale`** 導流即可。

## 8. 文件

| 資源 | URL／路徑 | 狀態 |
|------|-----------|------|
| fal Playground | https://fal.ai/models/clarityai/crystal-upscaler | metadata playgroundUrl |
| fal API | https://fal.ai/models/clarityai/crystal-upscaler/api | 文件入口 |
| OpenAPI Queue | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=clarityai/crystal-upscaler | **本機 200**，`CrystalUpscalerInput` 完整 |
| 平台 metadata | `https://api.fal.ai/v1/models?endpoint_id=clarityai/crystal-upscaler` | **200** · status **active** · commercial · updated 2026-05-06 |
| Queue base | `https://queue.fal.run` | OpenAPI servers |
| 站內目錄 | `docs/模型目錄.md` | 旗艦 · **1 點** · 人像情境 |
| 生態研究 | `docs/fal生態研究.md` §放大與修復 | ✅ $0.016/MP、4K≈4 點、人像特化 |
| 點數校準 | `docs/點數校準報告.md` | **≈**（1MP 基準） |
| 結果抽取 | `server/services/fal.ts` `extractResult` | **`images[0].url` 優先** |
| 站內註冊 | `shared/models.ts` L782–788 | input 僅 `image_url` |
| 情境配方 | `SCENARIO_RECIPES` **`sc-portrait-upscale`** | pickIds[0] |
| 姊妹卡 | `…__clarity-upscaler.md`（#60）、`…__topaz__upscale__image.md`（#61）、`…__codeformer.md`（#55） | 創意／印刷／修臉對照 |

## 9. 建議動作

| 優先 | 動作 | 說明 |
|------|------|------|
| — | **維持** id＝endpoint、`needs=image`、`input: { image_url }` | required 對齊；**無 P0 input 修** |
| — | **維持** verified 目錄值（true）；本回合**不改** | 零 live；升／覆核 true 待 L2 |
| — | **維持** `sc-portrait-upscale` 主選 | 與 strengths／OpenAPI 人像定位一致 |
| **建議（非本卡改碼）** | 調 points→**2 或 4** | 預設 2×／1MP 源≈2；4K 主情境≈4；與 cost 括號對齊。**禁止本回合改 points** |
| P3 | 可選：UI 暴露 scale_factor（1–4 合理檔） | 須動態估點；**禁止**裸露 max 200 |
| P3 | 可選：文案註「預設 2×、按輸出 MP」 | 避免使用者以為固定 1 點無限大圖 |
| 後續 live | 站內上傳人像小圖 → 確認輸出約 2×、臉部微細節、扣點 | **勿** `verify-models --probe --yes` |
| 後續 L1 | 環境允許時 probe 缺 image_url → 預期 422 | 連通確認 |

### 勾選摘要（審計結論）

- [x] **維持**（id／主 input 映射；verified 不改；points 不改）
- [ ] 調 points（**建議 2 或 4**，本回合禁改）
- [ ] 修 input/id（**無 P0**；required 已正確）
- [ ] verified 變更（禁止本回合改）
- [ ] 下架或隱藏

**總評**：目錄契約與官方 OpenAPI **required 對齊良好**，輸出 `images[]` 可解析，needs／助手／probe 守門正確，`sc-portrait-upscale` 主選定位正確。**points=1** 在 1MP 機械基準下校準「≈」，但與 **大圖／4K 主情境（≈4 點）** 衝突——建議產品調點，**本卡不改**。結論：**維持**（ready-static-only）；**P0 input：無**。

---

### 本回合證據清單

1. OpenAPI Queue 2026-08-05：`endpoint_id=clarityai/crystal-upscaler` → HTTP 200 · required `image_url`；`scale_factor` default **2** max **200**；`creativity` default **0**；`output_format` default **jpg**；Output **`images`**  
2. fal metadata API：status **active**、display_name Crystal Upscaler、commercial、updated 2026-05-06  
3. `shared/models.ts` L782–788 + `parseRealCost`／`realPricePoints`／`estimatePoints` 本機 tsx → points **1**、input 僅 `image_url`  
4. `SCENARIO_RECIPES` **`sc-portrait-upscale`** pickIds[0]；verify-models --probe（無 `--yes`）→ needs 正確拒絕  
5. `docs/點數校準報告.md`：≈；`docs/fal生態研究.md` Crystal 列；$0.016/MP、4K≈4 點  
