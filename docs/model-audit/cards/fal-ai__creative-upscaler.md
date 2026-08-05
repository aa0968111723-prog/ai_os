# fal-ai/creative-upscaler

> 審計：R2 · index **#72** · 模式 **static+research（零 live）** · 2026-08-05  
> slug：`fal-ai__creative-upscaler`  
> 禁止改 `verified`／`points`（本卡僅建議）· **禁止 `--yes`**

## 1. 身分

| 項 | 值 |
|----|-----|
| **index** | 72 |
| **id** | `fal-ai/creative-upscaler` |
| **endpoint** | `fal-ai/creative-upscaler`（`endpointOf` = id，無 alias） |
| **label** | Creative Upscaler(舊版) |
| **category** | `image-to-image` |
| **tier** | `budget`（最低成本） |
| **kind** | `image` |
| **verified** | `false`（目錄已標；本回合**未** live；**禁止**改 true） |
| **needs** | `image`（必填來源：要放大的圖） |
| **recommended** | `false` |
| **sourceHint** | 要放大的圖 |
| **strengths** | fal 早期 SD 創意放大;定位與 Clarity 重疊且較舊 |
| **bestFor** | 相容備援;新專案優先用 Clarity |
| **vendor** | fal 早期 **Creative Upscaler**（SD 1.5／SDXL 生成式超分 + 可選 CCSR 前處理；Queue 託管） |

**一句話**：**舊版 SD 創意放大器（備援）**——必填 `image_url`，預設 **scale=2**、**creativity=0.5**、**model_type=SD_1_5**、可選 BLIP2 自動 prompt；按 **$0.00111／計算秒** 計費 → `realPricePoints=null` → 手填 **points=1**。與 Clarity #60 **定位重疊**；新專案應走 Clarity，本模相容／備援。

## 2. 數值

| 項目 | 值 | 來源／算法 |
|------|-----|------------|
| **points（目錄）** | **1** | 手填；**不可**機械覆寫 |
| **cost（目錄）** | `$0.00111/計算秒` | 算秒 |
| **生態價** | **$0.00111／計算秒** | `docs/fal生態研究.md` ✅已查證 |
| **parseRealCost** | `usdMid=0.00111` · `multiplier=null` · 單位「/計算秒」需人工 | 本機 tsx 2026-08-05 |
| **realPricePoints** | **null** | 無法秒→張 |
| **estimatePoints()** | **1**（扁平手填） | 同口徑 |
| **校準報告** | **需人工** | `docs/點數校準報告.md`「Creative Upscaler(舊版) ⚠︎」 |

**風險（未改 points）**：

1. **算秒不可機械校準**：steps 預設 20、scale 2、creativity 0.5、可選 CCSR 前處理 → 算時變異大；**1 點是人工緩衝**，與 AuraSR 類似。
2. **生成式重、可能比 Clarity 更慢／更貴**：Clarity 有明確 $0.03/MP；本模算秒在大圖＋高 steps 時可能超過 1 點成本。
3. **tier=budget 但能力是生成式創意**：標籤「最低成本」來自算秒單價敘事，**不是**品質／可控性優於 Clarity。
4. **不建議調 points** 直到 live 帳單樣本；**禁止本回合改 points**。

## 3. 連通與生成

| 項目 | 結果 | 說明 |
|------|------|------|
| **L0 靜態契約** | **ok** | id 唯一；欄位齊；verified=false 與 strengths「舊版」一致 |
| **OpenAPI Queue** | **HTTP 200 · schema 有效** | `CreativeUpscalerInput`／`CreativeUpscalerOutput`；endpointId=`fal-ai/creative-upscaler` · about **Generate Image** |
| **平台 metadata** | **HTTP 200 · active** | display_name **Creative Upscaler** · tags `upscaling` · license **commercial** · updated **2026-01-26** · date **2024-02-27**（較舊） |
| **L1** | **本輪未重跑** | 禁止 `--yes`；雙 200 |
| **dry-run verify** | **拒絕（正確）** | needs=image；**未** `--yes` |
| **L2 live** | **未跑** | needs=image |
| **輸出解析** | **契約 OK** | Output `image` + `seed`（皆 required）；`extractResult` → `image.url` |
| **結論** | **ready-static-only** | required 對齊；備援定位正確；算秒實帳與生成品質待 live |

### OpenAPI 摘要（2026-08-05 本輪 curl）

- **required**：`["image_url"]`
- **主要 properties**（有 default 者站內多不送）：
  - **image_url**（必填）
  - **scale**：number default **2**，min 1，max **5**
  - **creativity**：number default **0.5**，0–1（*How much the output can deviate from the original*）
  - **detail**：number default **1**，0–5
  - **shape_preservation**：number default **0.25**，0–3
  - **model_type**：enum **`SD_1_5`｜`SDXL`**，default **`SD_1_5`**
  - **prompt**：string｜null（*If no prompt is provide BLIP2 will be used*）
  - **prompt_suffix**：default ` high quality, highly detailed, high resolution, sharp`
  - **negative_prompt**：長預設（blurry, low resolution…）
  - **num_inference_steps**：default **20**，1–200
  - **guidance_scale**：default **7.5**，0–16
  - **seed**：integer｜null
  - **skip_ccsr**：boolean default **false**（先跑 CCSR 再創意）
  - **enable_safety_checks**：default **true**
  - **override_size_limits**：default **false**
  - **base_model_url**／**additional_lora_url**／**additional_lora_scale**／**additional_embedding_url**：進階
- **Output**：`image` + `seed`
- **Queue**：`https://queue.fal.run` · `/fal-ai/creative-upscaler` + status／cancel／result

## 4. 底層邏輯

### 4.1 產品能力（官方／生態）

- **定位**：fal **早期** SD 創意放大——放大同時補細節；Clarity 出現前的主力；現 **相容備援**。
- **管線**：預設 **不** skip CCSR → 先 CCSR 再 creativity 模型（算時更長）。
- **vs Clarity #60**：Clarity 社群標竿、$0.03/MP、站內固定 creativity 0.35；**新專案優先 Clarity**（目錄 bestFor 一致）。
- **vs Recraft Creative #69**：Recraft 固定 $0.25／張、API 極簡；本模旋鈕多、算秒。
- **字卡**：生成式 → **中文改字風險**（生態已標）。

### 4.2 站內 `input()` 組裝

```ts
// shared/models.ts ~L822–828
input: (_p, _f, s) => ({ image_url: s }),
```

| 官方 property | 站內 | 備註 |
|---------------|------|------|
| `image_url` | ✅ `s` | needs 對齊 |
| `prompt` | ❌ 丟棄 `_p` | null → **BLIP2 自動 caption**（算時／風格不可控） |
| `scale` | ❌ | 吃 **2** |
| `creativity` | ❌ | 吃 **0.5**（比 Clarity 站內 0.35 **更放開**） |
| `model_type` | ❌ | 吃 **SD_1_5** |
| `skip_ccsr` | ❌ | 吃 **false**（會跑 CCSR） |
| `seed`／負向／steps／CFG | ❌ | 吃 default；**不在** SEED allowlist |
| 其餘 lora／embedding | ❌ | 進階不用 |

**P0 input 判定**：**無需修**——required 僅 `image_url`。  
（P3 產品可選：對齊 Clarity 送 `creativity: 0.35` 或映射使用者 prompt——**非缺欄**，本回合不改碼。）

### 4.3 架構／分詞

- family **unknown**；使用者提示**預設不進** payload，改由 BLIP2。
- 實務：上傳要放大的圖；勿依賴提示詞控制。

### 4.4 已知契約／文案缺口

1. **creativity 0.5 vs Clarity 0.35**：舊版預設更「放開」，字卡／人像更易跑偏（P3）。
2. **prompt 未映射**：有 BLIP2 兜底，但不可復現、不可控（P3）。
3. **verified=false**：正確；升 true 待 L2（**禁止本回合改 true**）。
4. **目錄 ⚠ 舊版**：與 strengths／bestFor 一致，勿當主推。

## 5. 點數路徑

| 步驟 | 行為 |
|------|------|
| 估點 | **1**（手填；realPricePoints null） |
| 缺來源 | needs 擋 |
| 扣點 | reserve 1 |
| 供應商 | **$0.00111 × GPU 秒**（CCSR+SD steps 累加） |

**站內自洽**；**對 fal：需人工**（校準表一致）。

## 6. 暴露面

| 面 | 是否暴露 | 說明 |
|----|----------|------|
| 目錄／工作台 | ✅ | budget · ⚠ 舊版文案 |
| 情境配方 | ❌ | 正確——勿導流舊模 |
| MCP | ✅ | 需圖 |
| 助手 | ❌ | needs |
| Seed／prompt UI | ❌ | 未映射 |
| probe | ❌ | needs；禁 `--yes` |

**誤用面**：

- 新專案 AI 圖 4K → **Clarity**，非本模。
- 字卡 → **Thera／AuraSR／Crisp**。
- 人像極致 → **Crystal**。
- 印刷自然 → **Topaz**。
- 期待提示詞精準控細節 → prompt 丟棄、走 BLIP2。

## 7. 情境與可用性

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 相容／備援舊管線 | ✅ | bestFor |
| 新專案主推 | ❌ | 用 Clarity |
| 生成補細節 | △ | 能做但舊；Clarity 優先 |
| 中文字卡 | ❌ | 改字風險 |
| 無圖 | ❌ | needs |

## 8. 文件

| 資源 | URL／路徑 | 狀態 |
|------|-----------|------|
| fal Playground | https://fal.ai/models/fal-ai/creative-upscaler | 公開 |
| OpenAPI | `…?endpoint_id=fal-ai/creative-upscaler` | **200** 完整旋鈕 |
| metadata | active · commercial · updated 2026-01-26 · date 2024-02-27 | 舊 |
| 生態 | `docs/fal生態研究.md` | ✅ 算秒；備援 |
| 校準 | **需人工** | ⚠ |
| 清查 | `docs/模型清查清單.md` | 需圖片；探測不受理 |
| 姊妹 | clarity-upscaler #60、recraft creative #69 | 新舊／張價對照 |
| 站內 | `shared/models.ts` L822–828 | |

## 9. 建議動作

| 優先 | 動作 | 說明 |
|------|------|------|
| — | **維持** id、needs、input image_url、points=1、verified=false | **無 P0 input**；備援定位 |
| — | **維持** 不進情境配方 | 避免導流舊模 |
| P2 | cost 若可得典型秒數，可補括號敘事 | **不改 points** 也可 |
| P3 | 可選：送 `creativity: 0.35` 對齊 Clarity 保守檔 | 防中文亂碼；需 live A/B |
| P3 | 可選：映射 prompt 或明示 BLIP2 | 可控性 |
| P3 | 文案持續標「舊版／優先 Clarity」 | 已有 |
| live | 小圖確認扣 1、輸出可解析、與 Clarity A/B | 禁 `--yes`；**勿**為了 verified 空跑 |

### 勾選摘要

- [x] **維持**（備援；verified 維持 false）
- [ ] 調 points
- [ ] 修 input（**無 P0**）
- [ ] verified 變更（**禁止**升 true）
- [ ] 下架或隱藏（可保留相容；非必須下架）

**總評**：OpenAPI 旋鈕多但 **required 僅 image_url**，站內映射正確；**算秒 → points=1 需人工**；與 Clarity 重疊且較舊——目錄定位正確。結論：**維持** · ready-static-only · **P0：無**。

---

### 本回合證據清單

1. OpenAPI 2026-08-05：required `image_url`；scale default 2；creativity 0.5；model_type SD_1_5；skip_ccsr false；Output image+seed  
2. metadata：active · commercial · date 2024-02-27 · updated 2026-01-26  
3. 本機 tsx：realPricePoints **null**、estimate **1**、input 僅 image_url  
4. verify-models --probe（無 `--yes`）→ needs 拒絕  
5. 生態算秒；校準需人工；Clarity 優先敘事一致  
