# fal-ai/bria/product-shot

> 審計：R2 · index **#54** · 層級 **static + research（零 live）** · 日期 2026-08-05  
> slug：`fal-ai__bria__product-shot`  
> 禁止改 `verified`／`points`（本卡僅建議）

## 1. 身分

| 項 | 值 |
|----|-----|
| **index** | 54 |
| **id** | `fal-ai/bria/product-shot` |
| **endpoint** | `fal-ai/bria/product-shot`（與 id 同字串，無 alias） |
| **label** | Bria Product Shot(情境商品圖) |
| **category** | `image-to-image` |
| **tier** | `economy` |
| **kind** | `image` |
| **verified** | `true`（目錄已標；本回合**未** live 覆核） |
| **needs** | `image`（必填商品／結緣品來源圖） |
| **recommended** | `false` |
| **sourceHint** | 商品/結緣品照片 |
| **strengths** | 去背+生成攝影棚級情境擺拍;版權安全 |
| **bestFor** | 佛珠/香品/書籍生成莊嚴擺拍圖用於義賣頁 |
| **vendor** | Bria AI（licensed-data 商用安全管線；fal 夥伴端點） |

**一句話**：上傳產品圖＋場景文字（或官方支援的參考背景圖），自動摳產品並置入攝影棚／生活情境；產品像素保真、訓練資料授權合規，適合義賣／結緣頁主視覺。

## 2. 數值

| 項目 | 值 | 來源／算法 |
|------|-----|------------|
| **points（目錄）** | **1** | `shared/models.ts`；載入時 `realPricePoints` 覆寫 |
| **cost（目錄）** | `$0.04/張` | 與 fal 公開標價一致 |
| **官方價（fal）** | **$0.04 / generation** | fal 模型頁「Your request will cost $0.04 per generation」 |
| **Bria 自家 API 對照** | Lifestyle by Text / by Image ≈ **$0.03/image**（Bria 平台價，非 fal 帳單） | bria.ai/pricing；僅供交叉，站內以 fal 為準 |
| **parseRealCost** | `usdMid=0.04` · `multiplier=1` · `×1（每次一件）` | 本機 `npx tsx` 讀 shared |
| **realPricePoints** | `max(1, round(0.04 × 1 × 31))` = `round(1.24)` = **1** | `USD_TO_TWD=31` |
| **估值 NT$** | ≈ **1.24**／次 | 0.04×31 |
| **estimatePoints()** | **1**（扁平，非 TTS 動態） | 與 UI／扣點同口徑 |
| **校準判定** | **≈** | `docs/點數校準報告.md`：1 點 vs 估 1.2 → 四捨五入符合 |

**風險（未改 points）**：

- 官方 `num_results` 預設 1、最大 4；`placement_type=automatic` 時文件寫會回 **num_results × 10** 張。站內 `input()` **不送**這兩欄 → 吃預設（`num_results=1`、`placement_type=manual_placement`、單選 `bottom_center`）→ **帳單仍以「每次請求 $0.04」理解**，但若未來暴露 multi-result，單次 1 點可能低估。
- `fast` 預設 `true`；若改走非 fast，價格頁未拆檔，需再對帳。

## 3. 連通與生成

| 項目 | 結果 | 說明 |
|------|------|------|
| **L0 靜態契約** | **ok** | id 唯一；`category∈CATEGORIES`；`needs/points/cost/tier/verified/strengths/bestFor/sourceHint/input` 齊；`verify-models.ts` 重生清查清單通過；本 id **不在** verified=false 清單 |
| **OpenAPI Queue** | **200 · schema 有效** | `GET https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/bria/product-shot` → `BriaProductShotInput` / `BriaProductShotOutput`；`x-fal-metadata.endpointId` 吻合 |
| **L1 批次 probe** | **未涵蓋** | 既有 `docs/fal端點連通報告.md` 僅抽樣 30 個端點（多為文生圖），**無**本 id 列；本回合 **禁止 `--yes`**，未跑 `probe-fal-endpoints.ts --yes` |
| **dry-run probe** | 計畫可印 | 腳本乾跑會列出含本端點之 252 個 fal 唯一端點；不連網 |
| **L4 live probe** | **未跑** | `needs=image` → `verify-models --probe` **禁止**（需來源圖）；須站內素材或帶合法 `image_url` 的單次生成 |
| **結論** | **ready-static-only** | 契約＋官方 schema 對得上；連通實測與成品品質待有來源圖的 live |

## 4. 底層邏輯

### 4.1 產品能力（官方）

- **定位**：eCommerce / lifestyle product shot——把產品從原圖切出，再依**文字場景**或**參考背景圖**合成新場景；強調**產品本體不被改畫**、licensed data、commercial use。
- **必填**：僅 `image_url`（OpenAPI `required: ["image_url"]`）。
- **場景二選一（互斥）**：`scene_description` **或** `ref_image_url`（文件：either … but not both）。
- **語系**：`scene_description` 官方說明 **English only**，排除特殊字元。
- **版位**：`placement_type` ∈ `original | automatic | manual_placement | manual_padding`；預設 `manual_placement` + `manual_placement_selection=bottom_center`。
- **尺寸**：`shot_size` 預設 `[1000,1000]`（約 1MP 優化）；`original_quality` 僅在 `placement_type=original` 有意義。
- **加速**：`fast` 預設 `true`。
- **輸出**：`images[]`（url / content_type / 可選寬高）；示例為 PNG。

### 4.2 站內 `input()` 組裝

```ts
// shared/models.ts
input: (p, _f, s) => ({ image_url: s, scene_description: p })
```

| 官方 property | 站內 | 備註 |
|---------------|------|------|
| `image_url` | ✅ `s`（來源圖 URL） | 與 `needs:image`、缺來源攔截一致 |
| `scene_description` | ✅ `p`（使用者提示詞） | 參數名已自註解「首跑確認」對上 OpenAPI |
| `ref_image_url` | ❌ 未暴露 | 無法「用參考背景圖」模式；只能文字場景 |
| `placement_type` 等 | ❌ 不送 | 吃官方預設 manual_placement / bottom_center / 1000×1000 |
| `num_results` / `fast` / `optimize_description` | ❌ 不送 | 預設 1 / true / true |
| 畫幅 `f`（16:9 等） | ❌ `_f` 忽略 | 無法用站內比例旋鈕控制 shot_size |
| `negative_prompt` | 無此欄 | 不在 `NEGATIVE_PROMPT_SUPPORTED` |
| `seed` | 無此欄 | 不在 `SEED_SUPPORTED` |

### 4.3 架構／分詞（站內圖解）

- `modelMechanicsFor` → **family: `unknown`**（未收錄 Bria 專用圖解）。
- `textEncoderProfileFor` → 無 bria 專檔；提示窗只顯示字數、**不可**做 T5/CLIP 級 unknown-token 量測。
- 實務上場景語意由 Bria 服務端處理；站內應視 **`scene_description` 為英文短場景句**，而非通用文生圖長 prompt。

### 4.4 已知契約缺口

1. **空提示**：`input("", …)` 會送 `scene_description: ""` 且無 `ref_image_url` → 可能 422 或無意義結果；UI 宜要求非空場景描述（或未來支援 ref 圖）。
2. **中文場景句**：官方 English only；繁中 bestFor 文案對使用者友善，但**直接送中文場景可能弱／無效**——建議工作台英文化或前置翻譯（對齊 Bria 換背景的既有建議）。
3. **比例**：分鏡 16:9／9:16 選擇不會進 payload；輸出偏 1:1 1MP，義賣頁若要橫幅需後製或另走 expand。

## 5. 點數路徑

| 步驟 | 行為 |
|------|------|
| 估點 | `estimatePoints(model)` → **1**（與 `realPricePoints` 一致） |
| 預覽 | `prepareGenerationRequest` 只組裝、**不扣點** |
| 缺來源 | `needs=image` 且無 `sourceUrl`／`sourceAssetId`／卡片參考圖 → `BAD_REQUEST`「此模型需要來源:商品/結緣品照片」 |
| 審核門檻 | 高成本審核路徑用同一 `est`（本模 1 點通常直接過） |
| 扣點 | `reserveQuota(userId, groupId, est=1, …, gen.id)` 與 generation 列同交易 |
| 送出失敗 | fal submit 失敗 → 退點（`failed.refunded`） |
| 供應商 failed／無成品 | CAS → failed + 退點 |
| BYOK 個人 key | 平台點數可為 0（既有 byok 路徑）；本卡未 live 驗證 |
| E2E_MOCK | 測試可不扣點；正式模式對稱扣退 |

**一致性**：UI 顯示 1 點 ＝ 目錄 points ＝ reserve／refund 的 est；L2 校準 **≈**，**建議維持 1 點**（不在本回合改 points）。

## 6. 暴露面

| 面 | 是否暴露 | 說明 |
|----|----------|------|
| 模型目錄／工作台選模 | ✅ | `image-to-image` · economy · 可搜 label／id |
| 情境配方 | ✅ | `SCENARIO_RECIPES` **`sc-product-shot`**「結緣品/義賣商品情境圖」**pickIds[0]** |
| 備援配方同卡 | ✅ | pick[1]=`fal-ai/bria/background/replace`、pick[2]=`pixelcut/background-removal` |
| 工作流 presets | ❌（未見專步） | 無以本 id 為固定步的 WORKFLOW_PRESET 硬編碼（以 grep 為準） |
| MCP `find_model` | ✅ | 全 `MODELS` 可查；category=image-to-image |
| MCP `submit_generation` | ✅ | 與網頁同 `executeGenerationCommand`；**必須** `source_url`／素材 |
| 負向提示 UI | ❌ | 不在 allowlist |
| Seed／消融 | ❌ | 不在 `SEED_SUPPORTED` |
| 檢視者 | 擋寫 | 專案 generate 權限／MCP write scope 既有守衛 |
| 封存專案 | 擋生成 | `assertProjectAllows`／MCP archived 守衛 |

**誤用面**：

- 當「一般圖生圖編輯」或「中文金句場景」會不如 Kontext／Qwen Edit。
- 無來源圖時被助手亂挑 → 正確被 needs 攔截。
- 空 `scene_description` 仍可能送到 fal（前端若未擋）。

## 7. 情境與可用性

| 情境 | 適配 | 說明 |
|------|------|------|
| 結緣品／義賣商品情境圖（`sc-product-shot`） | **首選 ✅** | strengths／bestFor／配方 why 一致；版權安全賣點正確 |
| 佛珠／香品／書籍莊嚴擺拍 | ✅ | 產品保真＋場景生成符合 |
| 僅去背透明 PNG | ⚠️ 次選 | 更應 `fal-ai/bria/background/remove` / BiRefNet；本模會合成新背景 |
| 人物換禪堂背景 | ⚠️ | 配方另有 `sc-bg-replace` 走 Bria 換背景；Product Shot 偏「商品置景」 |
| 中文長提示／字卡 | ❌ | 非文字渲染模；場景句應英文短句 |
| 分鏡比例精準 16:9 | ⚠️ | 站內比例未傳入；預設近方圖 |

**recommended=false**：合理——垂直場景強、非全域日常預設；由情境卡導流即可，不必進全域 recommended。

## 8. 文件

| 資源 | URL／路徑 | 狀態 |
|------|-----------|------|
| fal Playground | https://fal.ai/models/fal-ai/bria/product-shot | 公開頁存在（爬取標價 $0.04/gen；瀏覽器偶發 Vercel challenge） |
| fal API 文件 | https://fal.ai/models/fal-ai/bria/product-shot/api | 描述：Place product in scenery；licensed data；commercial |
| OpenAPI Queue | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/bria/product-shot | **本機拉取 200**，schema 完整 |
| Queue base | `https://queue.fal.run` | OpenAPI servers |
| 站內目錄 | `docs/模型目錄.md` | 經濟 · 1 點 · $0.04/張 · 來源提示正確 |
| 生態研究 | `docs/fal生態研究.md` §產品置景 | ✅已查證 $0.04；場景建議英文（表內 tier 曾寫「旗艦」與目錄 economy 不一致——**以 MODELS economy 為準**） |
| 點數校準 | `docs/點數校準報告.md` | ≈ |
| 端點連通總表 | `docs/fal端點連通報告.md` | **未列本端點**（抽樣範圍外） |
| 底層總論 | `docs/模型底層邏輯與運作流程.md` | 無 Bria Product Shot 專節 |
| Bria 產品頁 | https://bria.ai/product-shots | 商用產品攝影定位 |
| Bria 定價 | https://bria.ai/pricing | Product Shot Lifestyle ≈ $0.03/image（非 fal） |

## 9. 建議動作

| 優先 | 動作 | 說明 |
|------|------|------|
| — | **維持** points=1、cost=`$0.04/張`、tier=economy | 與 fal $0.04、realPricePoints=1、校準≈ 一致 |
| — | **維持** verified 現值（已 true） | 本回合零 live；不建議僅因 OpenAPI 再改動 |
| 低 | 可選：UI／助手提示「場景描述請用英文短句」 | 對齊官方 English only |
| 低 | 可選：空 prompt 前端攔截 | 避免 `scene_description:""` |
| 低 | 可選：暴露 `ref_image_url` 或 `shot_size` | 進階義賣排版；非必須 |
| 後續 live | 站內上傳白底商品圖 → 英文 scene → 確認扣 1 點、產品邊緣與場景 | needs 禁止 `--probe`；走 generate 單次 |
| 後續 L1 | `probe-fal-endpoints.ts --yes --only image-to-image` 納入本端點 | 預期 422 缺 image_url＝連通 |

### 勾選摘要（審計結論）

- [x] **維持**（點數／id／主 input 映射）
- [ ] 調 points
- [ ] 修 input/id（`scene_description` 已正確；無 id 錯誤）
- [ ] verified 變更（禁止本回合改；現為 true）
- [ ] 下架或隱藏

**總評**：目錄契約與官方 OpenAPI **對齊良好**，價格與 1 點 **≈**，情境配方定位正確；主要殘差是 **中文場景／比例未暴露／L1 批次與 live 未跑**。結論：**維持**，列 **ready-static-only**，待有來源圖之 live 後可關閉「首跑確認」類歷史註解。
