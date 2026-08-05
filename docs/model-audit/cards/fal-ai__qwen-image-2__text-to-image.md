# fal-ai/qwen-image-2/text-to-image

> slug: `fal-ai__qwen-image-2__text-to-image` · 審計 #9 · R1 static+research · 2026-08-05  
> 本輪 **零 live／禁止 `--yes`**；未改 `verified`／`points`。

## 1. 身分

| 欄位 | 值 |
|------|-----|
| 站內 id | `fal-ai/qwen-image-2/text-to-image` |
| 實際 endpoint | **同 id**（無 `endpoint` 覆寫；`endpointOf` → 自身） |
| label | Qwen Image 2.0 |
| category / tier / kind | `text-to-image` · `economy` · `image` |
| verified | **false**（目錄 ⚠︎；OpenAPI 本輪已實取，待 L2 首跑再翻） |
| needs | 無（純文生圖） |
| recommended | 否（`undefined`／非 recommended 旗標） |
| strengths | 中文文字渲染 SOTA(多篇獨立評測認證);專業排版、海報/資訊圖,亂碼錯字率最低 |
| bestFor | 繁/簡中文金句卡、密集中文海報——中文字卡的第一主力 |
| 廠商 | 阿里通義 **Qwen-Image-2.0 Standard** via fal.ai |
| MODELS 序 | index **8**（0-based；文生圖第九條；審計總表 **#9**） |

**一句話**：通義中文字卡 **經濟主力**——$0.035／張原生 2K、繁簡金句／密集中文海報第一選；量產用本檔（1 點），正式長版海報升 **Pro**（2 點）或 Max。

## 2. 數值

| 項目 | 值 |
|------|-----|
| points | **1** |
| cost（目錄字串） | `$0.035/張(原生 2K)` |
| 官方價與單位（OpenAPI／生態研究／校準報告） | **固定 $0.035／張**（非 MP；原生可至 ~2048²） |
| 估值 NT$（USD_TO_TWD=31，×1 張） | $0.035 × 31 = **1.085** → 四捨五入 **1** 點 |
| 校準判定 | **≈**（`docs/點數校準報告.md` 經濟列：估值 NT$1.1，≈） |
| estimatePoints | 扁平 **1**（`realPricePoints` 自 cost 機械換算；非 TTS 動態；長 prompt 仍 1） |
| 本機校驗 | `parseRealCost` → usdMid=0.035、multiplier=1；`realPricePoints`／`estimatePoints` 皆 **1** |

**數值落差（文件／產品級，非契約破）**

- 實價約 **1.1 元**、站內 **1 點** → 校準 ≈（略貼近成本；Pro 為 $0.075→2）。
- `num_images` 官方 1–4，帳單按張；站內不送 → 固定 1 張／次，1 點合理。若未來暴露多圖而不 ×N 估點會倒貼。
- 站內三比例 preset 名（`landscape_16_9`／`portrait_16_9`／`square_hd`）落在 schema 總像素 512²–2048²；**非 MP 計價**故解析度不影響點數。
- **本輪禁止改 points**（維持 1）。

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| 靜態契約 L0 | **ok** |
| endpointOf | `getModel` → endpoint 即 id（無連字號 alias）✓ |
| input 16:9 | `{ prompt, image_size: "landscape_16_9" }` |
| input 9:16 | `{ prompt, image_size: "portrait_16_9" }` |
| input 1:1 | `{ prompt, image_size: "square_hd" }` |
| OpenAPI 對齊 | Queue OpenAPI 2026-08-05 拉取 **200**：`QwenImage2TextToImageInput` required 僅 `prompt`；`image_size` enum 含站內三 preset；**有** `negative_prompt`（max 500）／`seed`／`enable_prompt_expansion` |
| supportsNegativePrompt | **true** ✓（`NEGATIVE_PROMPT_SUPPORTED` 已收；單元測試覆蓋） |
| supportsSeed | **true** ✓（`SEED_SUPPORTED` 已收；消融／進階路徑；日常 UI 不強制） |
| dry-run probe | 本輪環境無 `FAL_KEY` 時 `verify-models --probe` 拒跑（僅估點路徑）；**未**加 `--yes` |
| live probe | **未跑**（R1 零 live；`budget.json` **無**本 id 歷史） |
| 結論 | **ready-static-only**（契約綠；verified 仍 false，待 L2 首跑） |

### OpenAPI 摘要（`GET …/openapi.json?endpoint_id=fal-ai/qwen-image-2/text-to-image`）

- Paths：`POST /fal-ai/qwen-image-2/text-to-image`（queue）、status／cancel／result。
- **x-fal-metadata**：endpointId=`fal-ai/qwen-image-2/text-to-image`；category=`text-to-image`；about: *Generate images from text using Qwen Image 2.*
- Schema 名：`QwenImage2TextToImageInput`／`QwenImage2TextToImageOutput`
- Input 可選：
  - `negative_prompt`：default `""`，string max **500**（或 null）
  - `image_size`：default **`square_hd`**；enum `square_hd|square|portrait_4_3|portrait_16_9|landscape_4_3|landscape_16_9` 或 `{width,height}`；**總像素約 512²–2048²**
  - `enable_prompt_expansion`：default **true**（LLM 優化提示）
  - `seed`：0–2147483647 或 null
  - `enable_safety_checker`：default true
  - `sync_mode`：default false
  - `num_images`：1–4，default 1
  - `output_format`：jpeg|png|webp，default **png**
- Output required：`images[]`（url…）+ `seed`
- **無** `num_inference_steps`／`guidance_scale`／`acceleration`（與 Pro 公開 schema **欄位集合相同**；差異在品質檔位與定價，勿誤傳 steps → 防 422）
- 站內 `input()` 只送 prompt + image_size；`generationCore` 在 allowlist 下另注 `negative_prompt`；其餘吃官方預設。

**Standard vs Pro（schema）**：本輪 curl 比對，公開 Queue OpenAPI 的 properties **集合一致**（皆無 steps／CFG）。產品差異：Standard **$0.035／1 點**量產；Pro **$0.075／2 點**交付保真。

## 4. 底層

| 面向 | 說明 |
|------|------|
| 架構 | **統一生成＋編輯** 家族；本端點僅 **text-to-image**（無 image_url） |
| 條件編碼 | **Qwen3-VL 系 VLM**（marketing：frozen condition encoder）——長提示、中英混排、對話式指令；非 CLIP-77 |
| 生成骨幹 | **MMDiT／單流圖文 token** 擴散解碼 |
| 解析度 | **原生 2K** 級；schema 總像素區間約 512²–2048² |
| 站內 encoder | `shared/textEncoders.ts`：`/^fal-ai\/qwen-image/` → profile `qwen-image`；label 仍寫 **Qwen2.5-VL**（2.0 世代宜對齊 Qwen3-VL）；**limitTokens 未公開** → 站內不可量 token（`measured: false`） |
| 提示空間（外部） | fal learn：**~1000 tokens**；字卡建議雙引號包要渲染的字串 |
| 提示擴寫 | 預設 `enable_prompt_expansion=true`（LLM 優化；字卡精準場景可能改寫措辭） |
| input 組裝 | `(p, f) => ({ prompt: p, image_size: imageSize(f) })`；9:16→portrait_16_9、1:1→square_hd、其餘→landscape_16_9 |
| 送出路徑 | `generationCore` → `endpointOf`（= id）→ `falSubmit`；禁忌 → `negative_prompt` |
| 與官方差異 | 官方 default 尺寸 `square_hd`；站內橫幅統一 **16:9**（產品覆寫，可接受） |
| 家族 | **Standard 本卡**；Pro `fal-ai/qwen-image-2/pro/text-to-image`（$0.075／2 點）；Edit `fal-ai/qwen-image-2/edit`；Max `fal-ai/qwen-image-max/text-to-image`；Trainer `qwen-image-2512-trainer` |

## 5. 站內點數路徑

```
UI / MCP generate_into_scene / agent
  → prepare（estimatePointsFor(model, { promptChars, usdToTwdRate })）
  → est = 1（本模扁平；realPricePoints 自 cost 機械換算）
  → member 且 est ≥ 組 approvalThreshold → awaiting_approval（不扣點）
  → 否則 insert generations(pointsEst=est) + reserveQuota(user, group, est, …, genId)
  → falSubmit(endpointOf)  // = fal-ai/qwen-image-2/text-to-image
  → 失敗 refund(…, pointsEst, …)
  → BYOK 個人 fal key：略過平台扣點與核准門檻
```

| 檢查 | 結果 |
|------|------|
| 顯示點數 | catalog／UI 用 `model.points`＝1 |
| 扣點／退點 | 同 `pointsEst`＝`estimatePoints` → 一致 |
| 與 cost 校準 | $0.035×31≈1.09 → 1 點 ≈ |
| verified false | 既有保護：首跑失敗應退點（勿改 verified 直至 live 成功） |

## 6. 暴露面

| 通路 | 是否暴露 | 備註 |
|------|:--------:|------|
| 模型選擇器（文生圖 economy） | ✅ | MODELS 第九條（index 8）；無 needs |
| `model_catalog` 同步 | ✅ | id = endpoint；points/verified |
| tRPC generation | ✅ | modelId 即 `fal-ai/qwen-image-2/text-to-image` |
| MCP `generate_into_scene` / `submit_generation` | ✅ | 同上；工具層不暴露進階欄 |
| Scene recipe `sc-quote-card` | ✅ | **pickIds[0]**（中文金句卡・書法字卡首選） |
| scenarioPlaybook `quote-card` | ✅ | **modelIds[0]**（量產 1 點；Pro／GPT 升檔） |
| scenarioPlaybook `quote-motion` | ✅ | modelIds[0]（金句卡動態版靜幀） |
| Style showdown「中文字準(金句/書法)」 | ✅ | **winner**（runner-up Seedream 4.5） |
| WORKFLOW `wf/quote-card-economy` | ⚠ | 現用 **flux/dev** 出底圖——**未**走本模（產品分流債；中文字會弱） |
| WORKFLOW `wf/quote-card-flagship` | ⚠ | 現用 **ideogram/v3**——繁中字卡誤導（見 ideogram 卡 P1） |
| 禁忌 negative_prompt | ✅ | allowlist + generationCore 注入 |
| seed（消融） | ✅ | SEED_SUPPORTED；日常 UI 不強制 |
| enable_prompt_expansion | ❌ | 吃預設 true |
| num_images／output_format／自訂 WH | ❌ | 固定 1 張、png、preset 名 |
| steps／guidance UI | ❌ | 官方 Standard schema 無 |

**MCP 陷阱**：無 endpoint 別名，傳 id 即可；**勿**把 Pro 路徑當 Standard（貴一倍），亦勿把 Standard 當 Pro 寫進交付 recipe。

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 繁/簡中文金句卡・書法字卡 | ✅ **首選** | bestFor、`sc-quote-card` pickIds[0]、showdown winner |
| 密集中文海報／資訊圖（量產） | ✅ | 專業排版；正式長版交付可升 Pro |
| 字卡批量試錯／日更 | ✅ | 1 點經濟檔；字卡用引號包要渲染文字 |
| 正式交付長版密集字主視覺 | △ | 可用；**Pro（2 點）**更穩 |
| 國風／水墨／禪意大圖 | △ | 可用非第一賣點 → 混元／Pro |
| 寫實人像／宣傳光影 | △ | 非賣點 → FLUX.2 pro／Imagen／Nano Banana |
| 英文設計海報／字體設計感 | △ | Ideogram 更對；中文勿用 Ideogram 當主力 |
| 系列重現（同 seed） | △ | 官方＋allowlist 支援；站內日常 UI 未暴露 |
| 需來源圖編輯改字 | ❌ 本端點 | 走 `qwen-image-2/edit`／edit-plus 等 |

bestFor **恰當**；使用者可在文生圖經濟列表、金句 recipe、中文字準 showdown 選到；無需來源提示。  
**產品債**：`wf/quote-card-*` 工作流仍指到 FLUX／Ideogram，與 playbook／showdown「中文字用 Qwen」矛盾——宜改步驟 modelId（見 §9）。

## 8. 文件

| 來源 | 用途 |
|------|------|
| fal Queue OpenAPI | `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/qwen-image-2/text-to-image`（本輪 curl **200**；`QwenImage2TextToImageInput`） |
| fal 模型頁 | https://fal.ai/models/fal-ai/qwen-image-2/text-to-image（HTML 常被 Vercel checkpoint 擋；定價以生態＋OpenAPI 交叉） |
| fal API 文件 | https://fal.ai/models/fal-ai/qwen-image-2/text-to-image/api |
| fal learn | https://fal.ai/learn/tools/how-to-use-qwen-image-2（Qwen3-VL+DiT、~1000 token、Standard vs Pro、字卡引號） |
| 站內 | `shared/models.ts`（目錄／allowlist／input L303–307；SEED L196；NEGATIVE L133）；`textEncoders.ts` qwen-image；`generationCore.ts` negative；`scenarioPlaybook.ts` quote-card／quote-motion；`SCENARIO_RECIPES` sc-quote-card；`STYLE_SHOWDOWNS` 中文字準 winner |
| 既有研究 | `docs/research/model-deep-dive-2026-08/文生圖逐一研究.md` #9；`站內落差與修復建議.md`（negative allowlist 已補） |
| 清查／生態 | `docs/fal生態研究.md` Qwen Image 2.0 列（$0.035）；`docs/模型目錄.md` 經濟檔；`docs/模型清查清單.md` |
| 點數 | `docs/點數校準報告.md`（$0.035 → 1.1 → 1 ≈） |
| 姊妹卡 | `docs/model-audit/cards/fal-ai__qwen-image-2__pro__text-to-image.md`（旗艦 2 點交付檔） |
| live | budget **無**本 id；本輪禁止 `--yes` |

## 9. 建議動作

- [x] **維持** id＝endpoint 全路徑 `fal-ai/qwen-image-2/text-to-image`（無別名改寫）
- [x] **維持** points=1（$0.035 校準 ≈；本輪禁止改 points）
- [x] **維持** negative／seed allowlist（OpenAPI 已確認有欄；測試已綠）
- [x] **維持** 不送 steps／guidance（Standard schema 無）
- [x] **維持** verified=false 至 L2 live 成功後再升
- [x] **註記** 零 live／禁止 `--yes`；endpoint OpenAPI 靜態存活
- [x] 九章卡 + `_index` #9 + heartbeat
- [ ] **L2 live**：`verify-models --probe "fal-ai/qwen-image-2/text-to-image"`（單寫者加鎖；成功後人審再 `verified: true`）——**本輪勿 `--yes`**
- [ ] **P1 產品**：`wf/quote-card-economy` 出圖步驟改本 id（或至少可選 Qwen）；`wf/quote-card-flagship` 繁中步驟改 Pro／本 id——消除與 playbook／showdown 矛盾
- [ ] **可選** 字卡進階：暴露或預設關 `enable_prompt_expansion`（P2；防擴寫改掉金句措辭）
- [ ] **可選** `textEncoders` label 對齊 **Qwen3-VL** + 文件級 `documentedLimitTokens: 1000`（P3 顯示債）
- [ ] **可選** UI 文案「草稿／量產 Standard（1）→ 定稿 Pro（2）」（產品引導）
- [ ] **勿**在未改估點前暴露 `num_images`>1（帳單×張、站內扁平 1 會倒貼）
- [ ] **勿**把 Pro id 當 Standard 寫進 MCP／日更 recipe（雙倍成本）
- [ ] **勿**本輪改 points／verified／跑 `--yes`

**L0 結論**：靜態契約綠（endpoint／三比例 input／negative+seed allowlist／扁平 1 點一致）。**L1** OpenAPI 200 全欄對齊（與 Pro 公開欄位同形、定價檔位不同）。**L2** 未跑。剩餘為 verified 待 live、workflow 金句模板誤指 FLUX／Ideogram（P1 產品）、prompt_expansion 與 encoder label 文件／產品債。

### 本回合狀態燈（供 `_index`）

| L0 | L1 | L2 live | 建議 |
|----|----|---------|------|
| ok | 📄OpenAPI | 未跑 | 維持；L2 後 verified；P1 修 quote-card workflow |

**總建議標籤（寫入 _index）：** `維持`（ready-static-only；points=1≈；中文字卡主力；workflow 債另列）
