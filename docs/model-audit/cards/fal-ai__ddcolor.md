# fal-ai/ddcolor

> 審計：R2 · index **#59** · 層級 **static + research（零 live）** · 日期 2026-08-05  
> slug：`fal-ai__ddcolor`  
> 禁止改 `verified`／`points`（本卡僅建議）

## 1. 身分

| 項 | 值 |
|----|-----|
| **index** | 59 |
| **id** | `fal-ai/ddcolor` |
| **endpoint** | `fal-ai/ddcolor`（`endpointOf` = id，無 alias） |
| **label** | DDColor 上色 |
| **category** | `image-to-image` |
| **tier** | `economy`（經濟） |
| **kind** | `image` |
| **verified** | `true`（目錄已標；本回合**未** live 覆核） |
| **needs** | `image`（必填來源：要上色的黑白照片） |
| **recommended** | `false`（模型物件無 `recommended: true`） |
| **sourceHint** | 要上色的黑白照片 |
| **strengths** | 黑白照上色專用;只加色不動細節,忠實低風險 |
| **bestFor** | 黑白遺照/老照重獲色彩;中文題字安全 |
| **vendor** | DDColor（開源影像上色／recolor；fal 託管 Queue「Recolor Image」） |

**一句話**：上傳黑白（或去色）照片，做 **DDColor AI 上色**——分析臉／衣物／天空／植被推測真實色彩，**只加色、不重繪細節**；按 **$0.001／MP** 計費，常規 1MP 級遠低於 1 點下限，是 `sc-colorize`「黑白遺照上色」**主選**。

## 2. 數值

| 項目 | 值 | 來源／算法 |
|------|-----|------------|
| **points（目錄）** | **1** | `shared/models.ts`；載入時 `realPricePoints` 覆寫 |
| **cost（目錄）** | `$0.001/MP` | 與 fal 模型頁現行標價一致 |
| **官方價（fal）** | **$0.001 / megapixel** | 模型頁：「Your request will cost $0.001 per megapixel」（公開摘要 2026-08；本環境 HTML 可能 429） |
| **parseRealCost** | `usdMid=0.001` · `multiplier=1` · `×1MP（16:9 標準輸出 ≈ 1MP）` | 本機 `npx tsx` 讀 shared；取字串第一個 `$` 金額 |
| **realPricePoints** | `max(1, round(0.001 × 1 × 31))` = `round(0.031)` = **1** | `USD_TO_TWD=31` |
| **估值 NT$** | ≈ **0.03**／1MP | 0.001×31 |
| **estimatePoints()** | **1**（扁平） | 與 UI／扣點同口徑 |
| **校準判定** | **≈** | `docs/點數校準報告.md`：1 點 vs 估 0.0（機械四捨五入）→ 下限 1 點偏貴緩衝（對站友善） |

**風險（未改 points）**：

- 計費單位為 **輸出／處理 MP**（非固定張價）。超大原圖（例：6000×4000 ≈ 24MP）USD ≈ $0.024（≈ NT$0.74）→ **仍約 1 點**；再大才可能實帳單逼近／略超 1 點。
- 官方 schema **無** upscale／scale 欄——輸出尺寸跟來源（上色不改變解析度敘事），MP 風險主要來自**大原圖**而非倍率膨脹。
- cost 字串簡潔 `$0.001/MP`，無「每張約…」括號敘述；1 點下限是產品緩衝，**非**契約「永遠 $0.001」。
- 生態研究／目錄均標 **✅已查證 $0.001/MP**，與本回合官方摘要一致。

## 3. 連通與生成

| 項目 | 結果 | 說明 |
|------|------|------|
| **L0 靜態契約** | **ok** | id 唯一；`category∈CATEGORIES`；`needs/points/cost/tier/verified/strengths/bestFor/sourceHint/input` 齊；verified=true 非灰名單 |
| **OpenAPI Queue** | **200 · schema 有效** | `GET https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/ddcolor` → openapi **3.0.4**；`DdcolorInput`／`DdcolorOutput`；`x-fal-metadata.endpointId=fal-ai/ddcolor`；about：**Recolor Image** |
| **L1 批次 probe** | **環境暫態／報告未列** | 現存 `docs/fal端點連通報告.md` 無本 id 列；同輪他卡多為 5xx／逾時暫態——**非本端點獨有 404**。本回合 **禁止 `--yes`**，未重跑 `probe-fal-endpoints.ts --yes` |
| **dry-run probe** | 計畫可印 | `verify-models`／端點清單含本 id；不連網 |
| **L4 live probe** | **未跑** | `needs=image` → `verify-models --probe` **禁止**（需來源圖）；須站內素材或合法 `image_url` 單次生成。**禁止 `--yes`** |
| **輸出解析** | **契約 OK** | OpenAPI 回 `image`（單物件，required）；`extractResult` 支援 `result.image.url`（`server/services/fal.ts`） |
| **結論** | **ready-static-only** | 契約＋官方 schema＋$0.001/MP 對得上；佇列 live 與上色品質／題字保真待有來源圖之 live |

## 4. 底層邏輯

### 4.1 產品能力（官方 OpenAPI）

- **定位**：**黑白／去色影像 AI 上色（recolor）**——推測真實色彩、盡量保留亮度與結構；生態研究敘事：臉／衣物／天空／植被語意著色，**不動細節重繪**。
- **必填**：僅 `image_url`（`required: ["image_url"]`）。
- **`seed`**（integer，可選）：「seed to be used for generation」——可重現著色隨機性；**非** required。
- **輸出**：`image`（url / content_type / file_name / file_size / width / height）；示例 512×512 PNG。
- **無** `prompt`／`negative_prompt`／`guidance`／`scale`／`upscale`——**免提示詞**垂直工具。
- **OpenAPI 文案瑕疵**：`image_url` description 寫 “relighting”——屬 copy-paste 噪音（與 CodeFormer 等同型），以模型名 **DDColor**、about **Recolor Image**、playground 行為為準。

### 4.2 站內 `input()` 組裝

```ts
// shared/models.ts
input: (_p, _f, s) => ({ image_url: s }),
```

| 官方 property | 站內 | 備註 |
|---------------|------|------|
| `image_url` | ✅ `s`（來源圖 URL） | 與 `needs:image`、缺來源攔截一致 |
| `seed` | ❌ 不送 | OpenAPI 有欄；**不在** `SEED_SUPPORTED` → UI 無 seed 旋鈕 |
| 畫幅 `f` | ❌ `_f` 忽略 | 無 aspect 旋鈕；輸出尺寸 ≈ 來源 |
| 提示詞 `p` | ❌ 丟棄 | 免提示詞；空字串與有字串 payload 相同 |
| `negative_prompt` | 無此欄 | 不在 `NEGATIVE_PROMPT_SUPPORTED` |

### 4.3 架構／分詞（站內圖解）

- `modelMechanicsFor` → **family: `unknown`**（未收錄 DDColor 專用圖解）。
- `textEncoderProfileFor` → 不適用（無文生條件；提示窗字數無語意作用）。
- 實務：使用者應上傳**黑白／去色**照片；非「用文字描述要什麼顏色」。

### 4.4 已知契約／產品缺口

1. **seed 未暴露**：OpenAPI 支援 seed，站內不送且不在 `SEED_SUPPORTED`——同一張圖每次色調可能微變；若需可重現批次，可後續 allowlist（低優先）。
2. **提示詞無效**：UI 若仍顯示通用 prompt 框，易誤導——宜標「免提示詞／只上色」。
3. **非修復器**：不去除刮痕、不補殘缺、不修臉——受損黑白照應先 `photo-restoration`／CodeFormer 再進本模（生態研究推薦鏈）。
4. **已上色彩圖**：再送本模可能重估色相或無益；產品語境應鎖定「黑白來源」。
5. **sc-old-photo 未列本 id**：一鍵修復配方只到 photo-restoration ×2 + CodeFormer；上色主場在 **`sc-colorize`**——合理分流，無需硬塞 old-photo。

## 5. 點數路徑

| 步驟 | 行為 |
|------|------|
| 估點 | `estimatePoints(model)` → **1**（`realPricePoints=1`） |
| 預覽 | `prepareGenerationRequest` 只組裝、**不扣點** |
| 缺來源 | `needs=image` 且無 `sourceUrl`／`sourceAssetId`／卡片參考圖 → `BAD_REQUEST`「此模型需要來源:要上色的黑白照片」 |
| 審核門檻 | 高成本審核用同一 `est`（本模 1 點通常直接過） |
| 扣點 | `reserveQuota(…, est=1, …, gen.id)` 與 generation 列同交易 |
| 送出失敗 | fal submit 失敗 → 退點 |
| 供應商 failed／無成品 | CAS → failed + 退點 |
| BYOK 個人 key | 平台點數可為 0（既有 byok 路徑）；本卡未 live 驗證 |
| E2E_MOCK | 測試可不扣點；正式模式對稱扣退 |

**一致性**：UI 顯示 1 點 ＝ 目錄 points ＝ reserve／refund 的 est；L2 校準 **≈**（極低成本被 1 點下限抬高），**建議維持 1 點**（不在本回合改 points）。

## 6. 暴露面

| 面 | 是否暴露 | 說明 |
|----|----------|------|
| 模型目錄／工作台選模 | ✅ | `image-to-image` · economy · 可搜 label「DDColor」／id |
| 情境配方 | ✅ | **`sc-colorize`**「黑白遺照上色」**pickIds[0]**（主選） |
| 備援同卡 | ✅ | pick[1]=`fal-ai/image-editing/photo-restoration`（修＋上色一鍵） |
| 老照片綜合配方 | ❌ 本 id 不在 | `sc-old-photo` 用 photo-restoration／CodeFormer |
| 風格 PK | ❌ | `STYLE_SHOWDOWNS` 未見 |
| 工作流 presets | ❌ | 無以本 id 為固定步的 `WORKFLOW_PRESET`（grep） |
| MCP `find_model` | ✅ | 全 `MODELS` 可查；category=image-to-image |
| MCP `submit_generation` | ✅ | 與網頁同 `executeGenerationCommand`；**必須**來源圖 |
| 負向提示 UI | ❌ | 無此欄 |
| Seed／消融 | ❌ | 不在 `SEED_SUPPORTED`（雖 OpenAPI 有 seed） |
| 檢視者 | 擋寫 | 專案 generate 權限／MCP write scope 既有守衛 |
| 封存專案 | 擋生成 | `assertProjectAllows`／MCP archived 守衛 |

**誤用面**：

- 當「一鍵去刮痕＋補殘缺＋上色」→ 應走 `fal-ai/image-editing/photo-restoration`；本模**只上色**。
- 當「只修臉、要 fidelity」→ 應走 CodeFormer；本模不做人臉重建。
- 當「放大到 4K／印刷」→ 應走 Thera／Topaz／Clarity；本模不升頻。
- 當「只上色、不動結構」卻選 photo-restoration → 可能重繪細節；**應走本模**（姊妹卡已標）。
- 彩圖／已上色圖再送 → 收益低或色相偏移。
- 無來源圖時被助手亂挑 → 正確被 needs 攔截。

## 7. 情境與可用性

| 情境 | 適配 | 說明 |
|------|------|------|
| 黑白遺照上色（`sc-colorize`） | **主選 ✅** | pickIds[0]；why 文案與 strengths／bestFor 一致 |
| 清晰黑白照翻彩（檔案室整批） | ✅ | $0.001/MP 幾乎免費；1 點下限仍可整批 |
| 精修鏈：CodeFormer → **DDColor** → Thera | ✅ | `docs/fal生態研究.md` 推薦鏈；本模為上色中段 |
| 老照片綜合修復（`sc-old-photo`） | ⚠️ 非主場 | 配方未列；損傷照應先修復再上色 |
| 中文字卡／題字安全 | ✅ 敘事 | 只加色不動結構；**live 未驗證**題字像素級保真 |
| 創意換色／風格化上色 | ❌ | 無 prompt 控色；要風格用編輯模 |
| 人像換背景／去背 | ❌ | 錯模 |
| 中文長提示 | n/a | prompt 不進 payload |

**recommended=false**：合理——垂直「上色」工具，已由 **`sc-colorize` 主選**導流，不必進全域 recommended。

## 8. 文件

| 資源 | URL／路徑 | 狀態 |
|------|-----------|------|
| fal Playground | https://fal.ai/models/fal-ai/ddcolor | 公開頁存在；標價 **$0.001/megapixel**；about Recolor Image |
| fal API 文件 | https://fal.ai/models/fal-ai/ddcolor/api | `image_url` + 可選 `seed` |
| OpenAPI Queue | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/ddcolor | **本機拉取 200**，schema 完整 |
| Queue base | `https://queue.fal.run` | paths `/fal-ai/ddcolor` + status／cancel／result |
| 站內目錄 | `docs/模型目錄.md` | 經濟 · 1 點 · $0.001/MP · 來源提示正確 |
| 生態研究 | `docs/fal生態研究.md` §放大與修復 | ✅已查證 $0.001/MP；忠實上色敘事；中文題字安全 |
| 點數校準 | `docs/點數校準報告.md` | ≈（1 點 vs ~0.0 估值） |
| 端點連通總表 | `docs/fal端點連通報告.md` | **本 id 未列**；OpenAPI 仍 200；非 404 證據 |
| 底層總論 | `docs/模型底層邏輯與運作流程.md` | 無 DDColor 專節 |
| 結果抽取 | `server/services/fal.ts` `extractResult` | 支援 `image.url` |
| 姊妹卡 | `cards/fal-ai__image-editing__photo-restoration.md` #56 | 標「只上色→走 ddcolor」 |
| 姊妹卡 | `cards/fal-ai__codeformer.md` #55 | 精修鏈中段引用 DDColor |

## 9. 建議動作

| 優先 | 動作 | 說明 |
|------|------|------|
| — | **維持** points=1、cost=`$0.001/MP`、tier=economy | 與 fal $0.001/MP、realPricePoints=1、校準≈ 一致 |
| — | **維持** verified 現值（已 true） | 本回合零 live；OpenAPI＋官方標價已交叉；不建議僅因批次未列／5xx 改 false |
| — | **維持** `input`：`image_url: s` | 必填映射正確；免提示詞工具無其他必填 |
| — | **維持** `sc-colorize` 主選定位 | pick[0] 正確；勿與 sc-old-photo 混淆 |
| 低 | 可選：UI 標「免提示詞・只上色・不動結構」 | 減少 prompt 誤用 |
| 低 | 可選：SEED_SUPPORTED 收本 id + input 透傳 seed | 批次可重現；非必須 |
| 低 | 可選：OpenAPI `image_url` “relighting” 文案噪音僅文件認知 | 不改碼 |
| 後續 live | 站內上傳清晰黑白小圖 → 確認扣 1 點、得上色圖、題字結構可辨 | needs 禁止裸 `--probe`；走 generate 單次；**禁止本審計 `--yes`** |
| 後續 L1 | 環境恢復後 `probe-fal-endpoints.ts --yes --only image-to-image` | 預期缺 image_url → 422＝連通；勿與全表 5xx 混淆為 404 |

### 勾選摘要（審計結論）

- [x] **維持**（點數／id／主 input 映射／情境主選）
- [ ] 調 points
- [ ] 修 input/id（`image_url` 已正確）
- [ ] verified 變更（禁止本回合改；現為 true）
- [ ] 下架或隱藏

**總評**：目錄契約與官方 OpenAPI／**$0.001 per megapixel** **對齊良好**；1 點為合理下限緩衝；`sc-colorize` 主選定位正確；輸出 `image` 可被站內解析。主要殘差是 **L1 未列／環境暫態、live 未跑、seed 未暴露、提示 UI 可能誤導**。結論：**維持**，列 **ready-static-only**。

---

### 本回合證據清單

1. OpenAPI Queue 2026-08-05：`endpoint_id=fal-ai/ddcolor` → HTTP 200 · `DdcolorInput`（required `image_url`；可選 `seed`）／`DdcolorOutput`（required `image`）；about Recolor Image  
2. fal 公開定價摘要：**$0.001／megapixel**（模型頁；與目錄／生態研究／校準表一致）  
3. `shared/models.ts` id 段 + `parseRealCost`／`realPricePoints`／`estimatePoints` 本機 tsx → 皆 1  
4. `SCENARIO_RECIPES` **`sc-colorize`** pickIds[0]=本 id；`SEED_SUPPORTED` 不含；`extractResult` 支援 `image.url`  
5. `docs/點數校準報告.md`／`docs/fal生態研究.md`／姊妹卡 #55／#56 交叉  
