# fal-ai/flux/dev/image-to-image

> slug: `fal-ai__flux__dev__image-to-image` · 審計 #38 · R static+research · 2026-08-05  
> 本輪 **零 live／禁止 `--yes`**；未改 `verified`／`points`。  
> recommended **true**（圖生圖經濟主力／草圖升成品）。

## 1. 身分

| 欄位 | 值 |
|------|-----|
| 站內 id | `fal-ai/flux/dev/image-to-image` |
| 實際 endpoint | **同 id**（無 `endpoint` 覆寫；`endpointOf` → 自身） |
| label | FLUX.1 [dev] 圖生圖 |
| category / tier / kind | `image-to-image` · `economy` · `image` |
| verified | **true**（目錄已查證；OpenAPI 本輪 200；metadata **active**） |
| needs | **image**（必填底圖） |
| recommended | **true** |
| sourceHint | 作為底圖的圖 |
| strengths | 以草圖/舊圖為底重繪;強度可控 |
| bestFor | 草稿升級成品、風格轉換 |
| 廠商 | Black Forest Labs **FLUX.1 [dev]** 圖生圖端點 via fal.ai |
| MODELS 序 | index **37**（審計總表 **#38**） |

**一句話**：BFL FLUX.1 **dev 圖生圖**——必填 `image_url`+`prompt`，站內固定 **strength=0.85**（官方 default **0.95**）；$0.025/MP → **1 點**；**recommended** 草圖／舊圖升成品主力；無 `image_size`（輸出跟來源構圖走 latent 重繪）；**無** `negative_prompt`。

## 2. 數值

| 項目 | 值 |
|------|-----|
| points | **1** |
| cost（目錄字串） | `$0.025/MP` |
| 官方價與單位 | **$0.025 per megapixel**（與文生圖 flux/dev 同價） |
| 估值 NT$（USD_TO_TWD=31，×1MP） | $0.025 × 31 = **0.775** → 四捨五入 **1** 點 |
| 校準判定 | **≈**（`docs/點數校準報告.md` 經濟 FLUX.1 [dev] 圖生圖：估值 NT$0.8，≈） |
| parseRealCost | usdMid=**0.025**、multiplier=**1**、×1MP |
| realPricePoints | **1** |
| estimatePoints | 扁平 **1** |

**數值落差（文件／產品級，非契約破）**

- 計費按**輸出 MP**；底圖解析度高時可能 >1MP → 實帳高於 1 點（站內不動態估 MP）。
- 站內 **strength=0.85** vs 官方 default **0.95**（文案：「Higher strength values are better for this model」）——產品刻意略保守，保留更多底圖結構；**非 bug**。
- i2i **無** `image_size`：畫幅跟來源圖，非站內三比例 preset。
- `num_images` 1–4：站內不送 → 1 張。
- **本輪禁止改 points**（維持 1）。

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| 靜態契約 L0 | **ok** |
| endpointOf | id 自身 ✓ |
| OpenAPI Queue | **HTTP 200** · `FluxDevImageToImageInput`／`FluxDevImageToImageOutput` |
| 平台 metadata | **active** · display_name「FLUX.1 [dev]」· category image-to-image · tags style transfer · updated 2026-06-24 |
| required | **`image_url` + `prompt`** |
| 站內 input | `{ prompt, image_url: s, strength: 0.85 }` ✓ 覆蓋 required |
| supportsNegativePrompt | **false** ✓（schema 無；allowlist 正確排除） |
| supportsSeed | **true** ✓（schema 有；`SEED_SUPPORTED` 已收；常規 input **不送**） |
| dry-run probe | needs=image 擋下；**未**加 `--yes` |
| live probe | **本輪未跑**（禁止 `--yes`；needs 需真圖） |
| 輸出解析 | `images[]` → `extractResult` 支援 `images[0].url` |
| 結論 | **ready-static**（契約綠；L2 待有圖 live） |

### OpenAPI 摘要（`GET …/openapi.json?endpoint_id=fal-ai/flux/dev/image-to-image`）

- Paths：`POST /fal-ai/flux/dev/image-to-image` + status／cancel／result
- openapi **3.0.4**；Queue base `https://queue.fal.run`
- Schema：`FluxDevImageToImageInput`／`FluxDevImageToImageOutput`／`Image`
- **無** `image_size`／`negative_prompt`／`width`/`height` 獨立欄

| 官方 property | 型別 / 約束 | 預設 | 站內 `input()` | 備註 |
|---------------|-------------|------|----------------|------|
| `image_url` | string **required** | — | ✅ `s` | 底圖 URL |
| `prompt` | string **required** | — | ✅ `p` | 重繪方向 |
| `strength` | number 0.01–1 | **0.95** | ✅ **0.85** | 站內略低於官方；越高越偏提示／離底圖 |
| `num_inference_steps` | int 10–50 | **40** | ❌ | 比文生圖 dev default 28 **更高** |
| `guidance_scale` | number 1–20 | 3.5 | ❌ | CFG |
| `seed` | int \| null | — | ❌ | SEED allowlist 有 |
| `num_images` | int 1–4 | 1 | ❌ | |
| `enable_safety_checker` | boolean | true | ❌ | |
| `output_format` | jpeg\|png | jpeg | ❌ | |
| `acceleration` | none\|regular\|high | none | ❌ | |
| `sync_mode` | boolean | false | ❌ | |
| `negative_prompt` | — | — | **不存在** | 正確 |

### 三比例 input（本機求值）

| format | body |
|--------|------|
| 任意 | `{"prompt":"…","image_url":"…","strength":0.85}` |

`_f` 忽略——無 aspect／image_size 欄。

```ts
// shared/models.ts（正確）
input: (p, _f, s) => ({ prompt: p, image_url: s, strength: 0.85 }),
```

## 4. 底層

| 面向 | 說明 |
|------|------|
| 架構 | 與 `flux/dev` 同族 **12B rectified flow**；i2i 以底圖 latent + noise 強度（strength）混合後去噪 |
| 文字塔 | T5-XXL 窗口 **512** + CLIP-L；`textEncoderProfileFor` → **`flux1`** |
| 站內 mechanics | `modelMechanicsFor` → **`family: flux-dual-stream`**（regex 含 `flux/dev` 路徑） |
| 典型步數 | OpenAPI default **40**（文生圖 dev=28；i2i 更重） |
| strength | 站內 **0.85**；草圖升成品適中；近複製可降、大改風可升（UI 未暴露） |
| 負向 | **無** negative_prompt |
| 計費 | fal **$0.025/MP** |
| 送出路徑 | `generationCore` → `falSubmit("fal-ai/flux/dev/image-to-image", …)` |
| 家族 | 文生圖 `flux/dev`；turbo `flux/schnell`；redux `flux/dev/redux`；LoRA `flux-lora`；Kontext 編輯系 |

## 5. 站內點數路徑

```
UI / MCP
  → prepare（estimatePoints → 1）
  → needs=image 且無來源 → BAD_REQUEST（sourceHint）
  → reserveQuota(…, 1)
  → falSubmit(endpointOf)  // = fal-ai/flux/dev/image-to-image
  → 失敗 refund(1)
  → BYOK：略過平台扣點
```

| 檢查 | 結果 |
|------|------|
| 顯示／扣／退 | 皆 **1** 一致 |
| 與 cost 校準 | $0.025×31≈0.78 → 1 點 ≈ |
| verified true | 目錄已標；本輪不回退、不改 |
| live | 本輪未跑；budget 無本 id 條目 |

## 6. 暴露面

| 通路 | 是否暴露 | 備註 |
|------|:--------:|------|
| 模型選擇器（image-to-image economy） | ✅ | recommended |
| `model_catalog`／MCP find_model | ✅ | |
| tRPC／MCP submit_generation | ✅ | **必須**來源圖 |
| 助手 `assistantModel` | ❌ | needs → 擋代操（測試斷言） |
| scenarioPlaybook `photo-restore` | ✅ | 老照片修復復活 |
| scenarioPlaybook `sketch-to-final` | ✅ | 手繪分鏡→成品 |
| SCENARIO_RECIPES pickIds | △ | 未見獨立 sc-* 以本 id 為 pick[0]；playbook 有 |
| 禁忌 negative_prompt | ❌ | schema／allowlist 皆無 |
| seed UI（一般） | ❌ | 消融可走 SEED allowlist |
| strength UI | ❌ | 固定 0.85 |
| steps／guidance／acceleration | ❌ | 吃 40／3.5／none |

**MCP 陷阱**：必須傳來源圖；**禁止**自拼 `negative_prompt`；勿假設 `image_size`；strength 固定 0.85 不能靠 prompt 改。

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 手繪草圖／分鏡升成品 | ✅ **首選** | recommended；sketch-to-final |
| 舊圖風格轉換 | ✅ | bestFor |
| 老照片輕修（低幻覺期待） | △ | playbook 暫代；真修復另走 photo-restoration／CCSR |
| 局部精修／換背景角色一致 | △→升檔 | Kontext／Nano Banana Edit／Qwen Edit |
| 中文長字卡重繪 | ❌ | 文字弱 → Qwen／Seedream 編輯系 |
| 無底圖純文生 | ❌ | needs=image；改 `flux/dev` |
| 系列可重現 | △ | SEED 有；UI 未暴露 |

bestFor **恰當**；recommended **合理**。

## 8. 文件

| 來源 | 用途 |
|------|------|
| fal Queue OpenAPI | `…/openapi.json?endpoint_id=fal-ai/flux/dev/image-to-image`（本輪 **200**） |
| fal 模型頁 | https://fal.ai/models/fal-ai/flux/dev/image-to-image |
| fal API | https://fal.ai/models/fal-ai/flux/dev/image-to-image/api |
| 平台 metadata | active · style transfer · 2026-06-24 |
| 站內 | `shared/models.ts` L535–540；`SEED_SUPPORTED` 含本 id；`NEGATIVE` 不含；textEncoders flux1；mechanics flux-dual-stream |
| 點數 | `docs/點數校準報告.md` 圖生圖列 ≈；realPricePoints=1 |
| 生態 | `docs/fal生態研究.md` FLUX.1 [dev] 圖生圖 · recommended |
| 姊妹卡 | `fal-ai__flux__dev.md`（文生）；`fal-ai__flux__schnell.md`；`fal-ai__flux__dev__redux.md` |

## 9. 建議動作

- [x] **維持** id＝endpoint、needs=image、points=1、recommended=true
- [x] **維持** verified=true（目錄；本輪不改；L2 有圖後可再證）
- [x] **維持** input：`prompt`+`image_url`+`strength:0.85`（required 對齊）
- [x] **維持** 不送 negative（schema 無）
- [x] **維持** SEED allowlist 收錄
- [x] 九章卡 + `_index` #38
- [ ] **可選 P3**：UI 暴露 strength（0.5／0.85／0.95 三檔）
- [ ] **可選 P3**：一般 UI 暴露 seed
- [ ] **可選 P2**：cost 註「×輸出 MP；大圖可能 >1 點實帳」
- [ ] **勿**本輪改 points／verified／跑 `--yes`
- [ ] **無 P0 契約洞**（required 齊、無誤送欄）

**L0 結論**：靜態契約綠。**L1** OpenAPI 200 全欄對齊（strength 產品覆寫 0.85 vs 0.95 合法）。**L2** 未跑。剩餘 UX（strength／seed）與大圖 MP 帳單敘事，無 P0 契約債。
