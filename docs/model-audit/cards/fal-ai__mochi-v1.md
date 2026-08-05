# fal-ai/mochi-v1

> 審計：R3 · index **#126** · static+research · 2026-08-05（升 thin stub→九章）  
> slug：`fal-ai__mochi-v1`  
> OpenAPI **200**（本輪直拉）；**!needs**；零 live（無 KEY）。  
> **P0-FIXED**：移除死欄 `aspect_ratio`（schema 無此欄）。  
> **未**改 verified／points。

## 1. 身分

| 項 | 值 |
|----|-----|
| index | **126** |
| 站內 id | `fal-ai/mochi-v1` |
| endpoint | **同 id** |
| label | Mochi 1(Genmo 開源) |
| category / kind | **text-to-video** · video |
| tier | **budget** |
| points（執行時） | **12**（`$0.4/支` → realPricePoints） |
| cost | `$0.4/支` |
| verified | **true**（歷史；本輪無 live 複驗） |
| needs | **無** |
| recommended | false |
| strengths | 開源、動態流暢、寫實傾向;按支平價 |
| bestFor | 寫實空鏡試做;優先序在 Wan/LTX 之後 |
| 供應商 | Genmo Mochi 1 · fal queue |
| 姊妹 | Wan-t2v、LTX、CogVideoX-5B、Hunyuan |

**一句話**：**Mochi 1** 開源寫實向按支 t2v——required 僅 `prompt`；**無 aspect API**；`$0.4 → 12 點`；預設 **163 幀 @30fps**（~5.4s）。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| points | **12** |
| cost | **$0.4／支** |
| `parseRealCost` | usdMid=**0.4** · multiplier=**1** |
| `realPricePoints` | `0.4 × 1 × 31 = 12.4` → **round 12** |
| 預設時長 | num_frames def **163** · 說明 **30 fps** → ≈**5.4s** |
| 最短／最長幀 | 43–163（須 **1+6k**，≥43） |

**結論：** **維持 points=12**；按支價與點數對齊。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| L0 契約（修後） | **ok** |
| fal OpenAPI | **200** `MochiV1Input`／`MochiV1Output` |
| required | **`prompt` only** |
| optional | negative_prompt、seed、enable_prompt_expansion（def **true**）、num_frames |
| output | **`video`** |
| **無** | aspect_ratio／resolution／duration 秒檔 |
| L2 | 未跑（無 KEY） |
| 結論 | **ready-static-only** |

### 站內 input（本輪 P0-FIXED）

```ts
// 原：input: (p, f) => ({ prompt: p, aspect_ratio: aspect(f) })  // schema 無 aspect_ratio
input: (p) => ({ prompt: p }),
```

| 欄 | 修前 | 修後 | OpenAPI |
|----|------|------|---------|
| prompt | ✅ | ✅ | required |
| aspect_ratio | 每請求送 | **不送** | **無此欄** → 死欄／誤導 |

### OpenAPI 摘要（本輪 200）

- **required**: `prompt`
- **negative_prompt**: string，def `""`
- **seed**: int｜null
- **enable_prompt_expansion**: bool，def **true**
- **num_frames**: 43–163，def **163**；須 1+multiple of 6；**30 fps**
- **output**: `video` required

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 定位 | Genmo **開源** 寫實／流暢動態；budget 按支 |
| vs Wan-t2v | Wan 更省（6 點）；Mochi 敘事偏寫實流暢 |
| vs CogVideoX | 同開源檔；Mochi 價 12 點較高 |
| 比例 | **API 不可控**；固定模型側構圖 |

---

## 5. 站內扣點／退點

```
realPricePoints → 12
→ reserveQuota(12)
→ falSubmit("fal-ai/mochi-v1", { prompt })
→ 失敗 refund(12)
```

| 檢查 | 結果 |
|------|------|
| 12 ≈ $0.4×31 | **對齊** |
| verified true | 歷史不改 |
| 修後無死欄 | **綠** |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| 生成台 text-to-video | ✅ | budget |
| 專案 format→比例 | ❌ | **無效**（已不送） |
| num_frames UI | ❌ | 吃預設 163 |
| recommended | ❌ | |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 寫實空鏡試做 | ✅ | bestFor |
| 需嚴格 9:16／1:1 | ❌ | 無 aspect → 換他模 |
| 最省草稿 | △ | → Wan／LTX（更低點） |
| 可調秒數精細控制 | △ | 僅 num_frames 階梯 |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| `shared/models.ts` | #126 · **P0-FIXED** 只送 prompt |
| OpenAPI 本輪 | required prompt；無 aspect |
| fal 模型頁 | https://fal.ai/models/fal-ai/mochi-v1 |

---

## 9. 建議動作

- [x] 升 stub→九章；OpenAPI 直核  
- [x] **P0-FIXED**：去掉 `aspect_ratio`  
- [x] **維持** points=12／verified  
- [ ] **P2 產品：** UI 標「比例不可控」  
- [ ] **P3：** num_frames 旋鈕（43–163）  
- [ ] L2（有 KEY）：短 prompt 探活  

**裁決：維持＋P0 已去死欄**（零 live；points 不改）
