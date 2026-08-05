# fal-ai/esrgan

> 審計：R2 · index **#58** · 模式 **static+research（零 live）** · 2026-08-05  
> slug：`fal-ai__esrgan`  
> 禁止改 `verified`／`points`（本卡僅建議）· **禁止 `--yes`**

## 1. 身分

| 項 | 值 |
|----|-----|
| **index** | 58 |
| **id** | `fal-ai/esrgan` |
| **endpoint** | `fal-ai/esrgan`（`endpointOf` = id，無 alias） |
| **label** | Real-ESRGAN 放大 |
| **category** | `image-to-image` |
| **tier** | `budget`（最低成本） |
| **kind** | `image` |
| **verified** | `true`（目錄已標；本回合**未** live 覆核） |
| **needs** | `image`（必填來源：要放大的圖） |
| **recommended** | `false` |
| **sourceHint** | 要放大的圖 |
| **strengths** | 經典 4x 放大;face_enhance 可順帶 GFPGAN 修臉,全站最便宜之一 |
| **bestFor** | 大量舊素材粗放大+修臉的省錢首選 |
| **vendor** | Real-ESRGAN 家族（開源超解析；fal 託管 Queue；可選臉部強化） |

**一句話**：免提示詞的**經典超解析放大器**——必填 `image_url`，官方預設 `scale=2` + `RealESRGAN_x4plus`；按**計算秒**計費，單張通常遠低於 1 點下限。站內目前只送 `image_url`（**未**開 `face`），故「放大+修臉」是產品敘事，**不是**現況 payload 行為。

## 2. 數值

| 項目 | 值 | 來源／算法 |
|------|-----|------------|
| **points（目錄）** | **1** | `shared/models.ts` 手填；`parseRealCost` 對「/計算秒」**multiplier=null** → **不**被 `realPricePoints` 覆寫 |
| **cost（目錄）** | `$0.00111/計算秒(每張<1點)` | 載入後 points 仍為 1 |
| **parseRealCost** | `usdMid=0.00111` · `multiplier=null` · `單位「/計算秒」需人工換算` | 與 `docs/點數校準報告.md`「需人工」一致 |
| **realPricePoints** | **null** | 無法機械換算秒→張 |
| **estimatePoints()** | **1**（扁平） | UI／扣點／退點同口徑 |
| **生態研究交叉價** | **$0.000575/計算秒**（✅已查證敘述） | `docs/fal生態研究.md` 與目錄 **$0.00111** **不一致**（約 1.9×） |
| **校準判定** | **需人工／≈ 下限 1 點** | 無論 0.000575 或 0.00111／秒，常規單張 GPU 秒數通常使 USD ≪ NT$1 → 1 點為緩衝 |

**風險（未改 points）**：

- 計費單位是 **GPU 計算秒**，非固定張價；超大圖 + 高 `scale`（官方 max **8**）+ `face=true` 會拉長算時，理論上可突破 1 點——但站內不送 scale／face，吃預設，實務極難超。
- 目錄 cost **$0.00111** 與生態研究 **$0.000575** 雙源衝突；兩者皆使「每張 <1 點」敘述大致成立，**不構成改 points 的充分條件**（仍建議後續對帳）。
- 括號「每張<1點」是產品敘事，非 contract 保證。

## 3. 連通與生成

| 項目 | 結果 | 說明 |
|------|------|------|
| **L0 靜態契約** | **ok** | id 唯一；`needs/points/cost/tier/verified/strengths/bestFor/sourceHint/input` 齊 |
| **OpenAPI Queue** | **HTTP 200 · schema 有效** | `GET …/openapi.json?endpoint_id=fal-ai/esrgan` → `EsrganInput`／`EsrganOutput`；`x-fal-metadata.endpointId=fal-ai/esrgan` |
| **L1 批次 probe** | **本輪未重跑** | 禁止 `--yes`；當前 `docs/fal端點連通報告.md` 精簡表未列本 id（以影片等子集為主）；**非**本端點 404 紀錄 |
| **dry-run verify** | **拒絕（正確）** | `npx tsx scripts/verify-models.ts --probe "fal-ai/esrgan"` → needs=image 擋下；**未**加 `--yes` |
| **L2／L4 live** | **未跑** | 須站內素材或合法 `image_url` 單次生成 |
| **輸出解析** | **契約 OK** | OpenAPI 回 `image`（單物件）；`extractResult` 支援 `result.image.url`（`server/services/fal.ts` + 單測） |
| **結論** | **ready-static-only** | schema 與 input required 對齊；live 品質／真實秒數帳單待有圖實測 |

### OpenAPI 摘要（2026-08-05 本輪 curl）

- **required**：`["image_url"]`
- **order**：`image_url` → `scale` → `tile` → `face` → `model` → `output_format`
- **scale**：number，default **2**，min 1，max **8**
- **model**：enum default **`RealESRGAN_x4plus`**  
  另：`RealESRGAN_x2plus`、`RealESRGAN_x4plus_anime_6B`、`RealESRGAN_x4_v3`、`RealESRGAN_x4_wdn_v3`、`RealESRGAN_x4_anime_v3`
- **tile**：integer default **0**（OOM 時可設 200/400）
- **face**：boolean default **false**（描述 *Upscaling a face*；生態敘事對應 GFPGAN 臉部強化——**欄位名是 `face`，不是 `face_enhance`**）
- **output_format**：`png`｜`jpeg`，default **png**
- **Output**：`image` only（**無** seed）
- **無** `prompt`／`negative_prompt`／`seed`／`num_inference_steps`／`guidance_scale`

## 4. 底層邏輯

### 4.1 產品能力（官方）

- **定位**：Real-ESRGAN **純超解析**（非生成式重繪主路徑）——把既有像素放大並銳化；可選 `face` 做人臉路徑強化。
- **「4x」語意**：權重名 `RealESRGAN_x4plus` 指**網路訓練倍率／族系**；OpenAPI **預設 `scale=2`**，並非一送就 4× 邊長。strengths「經典 4x」易被讀成預設 4×——**以 schema default=2 為準**。
- **忠實 vs 創意**：相對 Clarity／Creative Upscaler，本模偏**忠實放大**；細小中文字銳利度一般，字卡首選仍是 Thera／AuraSR（`sc-text-upscale`）。
- **輸出**：單張 `image`（url／寬高／content_type 等 Image schema）。

### 4.2 站內 `input()` 組裝

```ts
// shared/models.ts ~L704–710
input: (_p, _f, s) => ({ image_url: s }),
```

| 官方 property | 站內 | 備註 |
|---------------|------|------|
| `image_url` | ✅ `s` | 與 `needs:image`、缺來源攔截一致 |
| `scale` | ❌ 不送 | 吃預設 **2** |
| `model` | ❌ 不送 | 吃 **RealESRGAN_x4plus** |
| `face` | ❌ 不送 | 吃 **false** → **不會** GFPGAN 修臉 |
| `tile` | ❌ 不送 | 0 |
| `output_format` | ❌ 不送 | png |
| 提示詞 `p` | ❌ 丟棄 | **免提示詞** |
| 畫幅 `f` | ❌ `_f` 忽略 | 無 aspect 旋鈕；尺寸＝來源 × scale |
| `seed`／`negative_prompt` | 無此欄 | 不在 SEED／NEGATIVE allowlist（正確） |

### 4.3 架構／分詞

- `modelMechanicsFor` → **family: `unknown`**（未收錄 ESRGAN 專節）。
- `textEncoderProfileFor` → unknown；提示窗對 payload **無語意作用**。
- 實務：使用者應上傳**要放大的圖**，不是寫「放大到 4K」文字。

### 4.4 已知契約／文案缺口

1. **strengths 欄位名錯誤**：寫 `face_enhance`，官方 OpenAPI 為 **`face`**（P2 文案衛生）。
2. **bestFor「粗放大+修臉」vs 現況**：未送 `face:true`，現況只有粗放大；修臉需改 input 或暴露開關（P2 產品）。
3. **「經典 4x」vs default scale=2**：文案易誤導（P3）。
4. **cost 雙源**：$0.00111（目錄）vs $0.000575（生態研究）——應對帳後統一 cost 字串（P2；**不改 points**）。
5. **不在任何 SCENARIO_RECIPES pickIds**：`sc-ai-upscale`／`sc-text-upscale`／`sc-portrait-upscale`／`sc-print-upscale`／`sc-old-photo` 皆未收本 id——省錢粗放大量需使用者自選或未來補配方。

## 5. 點數路徑

| 步驟 | 行為 |
|------|------|
| 估點 | `estimatePoints` → **1**（`realPricePoints` null → 手填 1） |
| 預覽 | `prepareGenerationRequest` 只組裝、**不扣點** |
| 缺來源 | needs=image 且無來源 → `BAD_REQUEST`（sourceHint：要放大的圖） |
| 扣點 | `reserveQuota(…, est=1)` |
| 失敗／無成品 | 退點 |
| BYOK | 平台點數可為 0（既有路徑；本卡未 live） |

**一致性**：顯示 1 ＝ 目錄 points ＝ reserve／refund。L2 校準屬「算秒需人工」，**建議維持 1 點**下限。

## 6. 暴露面

| 面 | 是否暴露 | 說明 |
|----|----------|------|
| 模型目錄／工作台選模 | ✅ | `image-to-image` · budget · 可搜 label／id |
| 情境配方 | ❌ | 無 pickIds 命中本 id |
| 工作流 presets | ❌（未見硬編碼） | 無固定步綁本 id |
| MCP `find_model` | ✅ | 全 MODELS 可查 |
| MCP `submit_generation` | ✅ | 與網頁同路徑；**必須**來源圖 |
| 助手 `assistantModel` | ❌ | `needs` → **null**（正確擋代操） |
| `pickGenerateModel(esrgan)` | 退回 | 本機實測退 **`fal-ai/flux/dev`**（非 i2i） |
| `listAssistantGenerateModels` | ❌ | i2i／needs 不在助手代操白名單策略內 |
| 負向提示／Seed UI | ❌ | schema 無；allowlist 無 |
| `verify-models --probe` | ❌ | needs 拒絕；**禁止** `--yes` 空跑 |

**誤用面**：

- 當「字卡／書法忠實 4K」→ 應 `sc-text-upscale`（Thera／AuraSR），非本模。
- 當「創意補細節到印刷」→ Clarity／Topaz。
- 當「只修臉不放大」→ CodeFormer。
- 期待「開 face 修臉」→ 現況 **false**，需產品改碼。
- 無來源圖時助手亂挑 → needs／assistant 雙擋。

## 7. 情境與可用性

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 大量舊素材批次粗放大 | ✅ | bestFor 核心；1 點下限對站友善 |
| 放大順便修臉 | △ 文案有、payload 無 | 須 `face:true` 才接近敘事 |
| 字卡／中文細字放大 | ⚠ 次選 | 相對安全（非重繪），鋭利度一般；首選 Thera |
| AI 圖印刷級補細節 | ❌ 弱 | 走 Clarity／Topaz |
| 老照片綜合修復 | ❌ | 走 photo-restoration／CodeFormer |
| 無來源圖 | ❌ | needs 攔截 |
| 中文長提示 | n/a | prompt 不進 payload |

**recommended=false**：合理——垂直便宜放大器，由目錄自選即可；未進情境配方不影響 L0。

## 8. 文件

| 資源 | URL／路徑 | 狀態 |
|------|-----------|------|
| fal Playground | https://fal.ai/models/fal-ai/esrgan | 公開頁存在；HTML 常被 Vercel 挑戰擋爬 |
| fal API | https://fal.ai/models/fal-ai/esrgan/api | 文件入口 |
| OpenAPI Queue | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/esrgan | **本機 200**，`EsrganInput` 完整 |
| Queue base | `https://queue.fal.run` | OpenAPI servers |
| 站內目錄 | `docs/模型目錄.md` | 最低成本 · 1 點 · $0.00111/計算秒 |
| 生態研究 | `docs/fal生態研究.md` §放大與修復 | 標 $0.000575/計算秒 ✅；**face_enhance** 敘事（欄位應為 `face`） |
| 點數校準 | `docs/點數校準報告.md` | 需人工（計算秒） |
| 端點連通總表 | `docs/fal端點連通報告.md` | 本輪精簡表未列；無 404 清單命中 |
| 結果抽取 | `server/services/fal.ts` `extractResult` | 支援 `image.url` |
| 站內註冊 | `shared/models.ts` L704–710 | input 僅 image_url |

## 9. 建議動作

| 優先 | 動作 | 說明 |
|------|------|------|
| — | **維持** points=1、tier=budget、id＝endpoint | 算秒不可機械換算；1 點下限合理 |
| — | **維持** verified=true | 本回合零 live；OpenAPI＋歷史生態 ✅；不因未 live 改 false |
| — | **維持** `input`：`{ image_url: s }` | required 對齊；進階參數可後補 |
| P2 | 文案：`face_enhance` → **`face`** | strengths／生態研究用語對齊 OpenAPI |
| P2 | 產品：若堅持「粗放大+修臉」 | `input` 加 `face: true`，或 UI 開關（預設可關以省算時） |
| P2 | 對帳 cost | 統一 $0.00111 vs $0.000575；**改字串不必改 points** |
| P3 | strengths 補「預設 scale=2」 | 避免「經典 4x」被讀成預設 4 倍邊長 |
| P3 | 可選：`sc-bulk-upscale` 配方 | pick 本 id 作省錢批次粗放 |
| 後續 live | 站內上傳小圖 → 確認扣 1、輸出約 2×、可選 face A/B | **勿** `verify-models --probe --yes` |
| 後續 L1 | 環境允許時 `probe-fal-endpoints` 對 i2i | 預期缺 image_url → 422＝連通 |

### 勾選摘要（審計結論）

- [x] **維持**（點數／id／主 input 映射）
- [ ] 調 points
- [ ] 修 input/id（required 已正確；face 為可選產品增強）
- [ ] verified 變更（禁止本回合改；現為 true）
- [ ] 下架或隱藏

**總評**：目錄契約與官方 OpenAPI **required 對齊良好**，1 點為合理算秒下限緩衝，輸出 `image` 可解析，助手／probe 對 needs 守門正確。主要殘差：**文案 face_enhance≠face、修臉未進 payload、scale 預設 2 vs「4x」敘事、cost 雙源、未入情境配方、live 未跑**。結論：**維持**，列 **ready-static-only**。
