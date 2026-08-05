# fal-ai/flux-pro/v1.1-ultra

> 審計：R1 · index **#14** · static+research · 2026-08-05（升 thin→九章）  
> slug：`fal-ai__flux-pro__v1.1-ultra`  
> OpenAPI **200**（本輪直拉）→ 端點活躍；**!needs**。  
> L2 歷史 **success**（budget 已計 +2）；**未**自動改 verified（禁）。  
> **未**改 points／input（P0 image_size→aspect_ratio 已修）。

## 1. 身分

| 項 | 值 |
|----|-----|
| index | **14** |
| 站內 id | `fal-ai/flux-pro/v1.1-ultra` |
| endpoint | **同 id**（活躍） |
| label | FLUX1.1 [pro] ultra |
| category / kind | **text-to-image** · image |
| tier | **flagship** |
| points（執行時） | **2**（`$0.06/張` → realPricePoints） |
| cost | `$0.06/張(可達 4MP/2K)` |
| verified | **false**（目錄；L2 已成功 → **建議人工 true**，本輪不改） |
| needs | **無** |
| recommended | false |
| strengths | 上代旗艦高解析檔;約 10 秒出 4MP、寫實人像質感極佳 |
| bestFor | 海報主圖、印刷級莊嚴人像與志工紀實 |
| 供應商 | BFL FLUX1.1 [pro] ultra · fal |
| 姊妹 | flux-2/pro、flux-2、flux/dev、flux-pro-trainer／ultra-finetuned |

**一句話**：**FLUX1.1 Pro ultra** 上代高解析旗艦 t2i——required `prompt`；站內 `aspect_ratio` 三比例 **綠**；`$0.06/張 → 2 點`；**無** `image_size`（已修）。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| points | **2** |
| cost | **$0.06／張**（可達 4MP/2K） |
| `parseRealCost` | usdMid=**0.06** · multiplier=**1**（每張） |
| `realPricePoints` | `0.06 × 31 = 1.86` → **floor 2** |
| 預設 aspect_ratio（官方） | **16:9**（站內覆寫 format） |
| 預設 safety_tolerance | **2**（1–6 字串 enum） |
| 預設 output_format | **jpeg** |
| 預設 num_images | **1**（max 4） |
| 預設 raw / enhance_prompt | **false** |

### 校準對照

| 設定 | USD | NT$ | vs 2 點 |
|------|-----|-----|---------|
| **1 張 × $0.06** | 0.06 | 1.86 | **floor 2**（略高估 ≈） |
| num_images=4 | ×4 費 | | 扁平 2 **P2** |
| 4MP 宣稱 | 仍 $0.06/張 | | 固定價，非 MP |

**結論：** **維持 points=2**；旗艦固定價地板合理。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| L0 契約 | **ok**（P0-FIXED：`image_size`→`aspect_ratio`） |
| fal OpenAPI | **200** `FluxProV11UltraInput`／`FluxProV11UltraOutput` |
| about | FLUX1.1 [pro] ultra 高解析 t2i；raw／enhance_prompt 可選 |
| required | **`prompt` only** |
| output | **images[]** + timings／seed／has_nsfw／prompt |
| L2 live | **success** · req `019fd07d-bc2b-7090-8867-4d7b667ff44f` · jpg artifact · +2 TWD |
| 結論 | **ready**（靜態綠 + 歷史 live；verified 待人工） |

### 站內 input

```ts
input: (p, f) => ({ prompt: p, aspect_ratio: aspect(f) }),
// aspect = (f) => f  → ProjectFormat 原樣
```

| format | aspect_ratio | OpenAPI enum |
|--------|--------------|--------------|
| 16:9 | `16:9` | ✅ |
| 9:16 | `9:16` | ✅ |
| 1:1 | `1:1` | ✅ |

| 欄 | 站內 | 官方 | 備註 |
|----|------|------|------|
| prompt | ✅ | required | |
| aspect_ratio | ✅ | enum 含站內三比例；def 16:9 | **健康**（P0 已修） |
| image_size | ❌ | **schema 無** | 舊 input 曾誤用 → broken P0-FIXED |
| raw | 未送 | def false | 更自然；**P2** 未暴露 |
| enhance_prompt | 未送 | def false | **P2** 未暴露 |
| safety_tolerance | 未送 | def "2" | |
| seed | 未送 | optional | |
| num_images | 未送 | def 1 max 4 | 點數未×張 **P2** |
| image_url / image_prompt_strength | 未送 | 可選圖提示 | 非站內 needs 路徑 |

### OpenAPI 摘要（本輪 200）

- **required**: `prompt`
- **aspect_ratio**: `21:9`｜`16:9`｜`4:3`｜`3:2`｜`1:1`｜`2:3`｜`3:4`｜`9:16`｜`9:21`；def **16:9**
- **num_images**: 1–4，def **1**
- **output_format**: jpeg｜png，def **jpeg**
- **safety_tolerance**: "1"–"6"，def **"2"**
- **raw** / **enhance_prompt**: bool，def false
- **image_url** + **image_prompt_strength** (0–1, def 0.1)
- **無** `image_size`／`loras`／steps／guidance

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 定位 | BFL **FLUX1.1 Pro ultra** 高解析旗艦；上代但實用 4MP |
| vs flux-2/pro | FLUX.2 新旗艦；本檔固定 $0.06、偏寫實人像 |
| vs imagen4 ultra | 對照軸「寫實人像」runner-up（shared/models 選型） |
| raw | 官方「較少處理、更自然」——站內未開 |

---

## 5. 站內扣點／退點

```
realPricePoints → 2
→ reserveQuota(2)
→ falSubmit("fal-ai/flux-pro/v1.1-ultra", { prompt, aspect_ratio })
→ 失敗 refund(2)
```

| 檢查 | 結果 |
|------|------|
| 2 點 vs $0.06 | **合理**（1.86→floor 2） |
| L2 success | 證據在 budget |
| verified false | **本輪不改**（禁自動 true） |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| 生成台 text-to-image | ✅ | flagship |
| pickIds 高解析組 | ✅ | 與 imagen4 ultra、nano-banana-2 |
| recommended | ❌ | |
| LoRA / needs | ❌ | 無；finetuned 另端 |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 海報主圖／印刷人像 | ✅ | bestFor |
| 志工紀實寫實 | ✅ | strengths |
| 中文字卡 | ⚠ | 生態研究：中文字不可靠，純畫面 |
| 極致最新旗艦 | △ | → flux-2/pro 或 nano-banana-pro |
| 批量 4 張 | ⚠ | 點數未×張數 |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| `shared/models.ts` | #14 · aspect · points2 · verified false |
| OpenAPI 本輪 | prompt；aspect_ratio enum；無 image_size |
| budget.json | L2 success 019fd07d-bc2b… · +2 TWD |
| broken.json | P0-FIXED image_size→aspect_ratio |
| fal 模型頁 | https://fal.ai/models/fal-ai/flux-pro/v1.1-ultra |

---

## 9. 建議動作

- [x] 升 thin→九章；OpenAPI 直核  
- [x] aspect 三比例 **綠**；P0 契約已修不重開  
- [x] L2 歷史 success 入卡  
- [x] **維持** points=2；**不**自動 verified true  
- [ ] **人工：** verified false→true（已有 live 證據）  
- [ ] **P2：** raw／enhance_prompt UI 可選；num_images 動態估點  
- [ ] 不需再 live  

**裁決：維持**（契約綠；已 live；verified 待人工）
