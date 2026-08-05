# fal-ai/flux-2-flex

> 審計：R1 · index **#12** · static+research · 2026-08-05（升 shallow→九章）  
> slug：`fal-ai__flux-2-flex`  
> OpenAPI **200**（本輪直拉）→ **端點活躍**（原註「推定」可銷）；**!needs**；零 live（無 KEY）。  
> **未**改 verified／points／models.ts。

## 1. 身分

| 項 | 值 |
|----|-----|
| index | **12** |
| 站內 id | `fal-ai/flux-2-flex` |
| endpoint | **同 id**（活躍；`flux-2/flex` 等別名 **404**） |
| label | FLUX.2 [flex] |
| category / kind | **text-to-image** · image |
| tier | **flagship** |
| points（執行時） | **2**（`$0.05/MP` → realPricePoints） |
| cost | `$0.05/MP` |
| verified | **false** |
| needs | **無** |
| recommended | false |
| strengths | FLUX.2 可調版;可控推論步數與 guidance,質感細節上限最高 |
| bestFor | 主視覺精修、願意微調參數的進階場景 |
| 供應商 | Black Forest Labs FLUX.2 Flex · fal |
| 姊妹 | FLUX.2 pro／dev、FLUX.1 系 |

**一句話**：**FLUX.2 Flex** 可調步數／guidance 旗艦 t2i——required `prompt`；imageSize **三比例綠**；`$0.05/MP → 2 點`；官方可調旋鈕站內**未接**。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| points | **2** |
| cost | **$0.05／MP** |
| `parseRealCost` | usdMid=**0.05** · multiplier=**1**（≈1MP 標準輸出） |
| `realPricePoints` | `0.05 × 1 × 31 = 1.55` → **round 2** |
| 預設 steps | num_inference_steps def **28**（2–50） |
| 預設 guidance | guidance_scale def **3.5**（1.5–10） |
| 預設 image_size（官方） | **landscape_4_3**（站內每次覆寫） |

### 校準對照

| 設定 | USD | NT$ | vs 2 點 |
|------|-----|-----|---------|
| **≈1MP × $0.05** | 0.05 | 1.55 | **≈**（略高估 0.5） |
| 大圖 2MP | 0.10 | 3.1 | 扁平 2 **低估** |
| max area 4MP 級 | 更高 | | **P2** |

**結論：** **維持 points=2**；1MP 錨合理；超大圖扁平風險 **P2**。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| L0 契約 | **ok** |
| fal OpenAPI | **200** `Flux2FlexInput`／`Flux2FlexOutput` |
| 別名 | `fal-ai/flux-2/flex`、`fal-ai/flux/2/flex` → **404** |
| required | **`prompt` only** |
| output | **`images[]`** + seed |
| L2 | 未跑（無 KEY；verified 維持 false） |
| 結論 | **ready-static-only**（端點確認活躍） |

### 站內 input

```ts
input: (p, f) => ({ prompt: p, image_size: imageSize(f) }),
```

| format | image_size | OpenAPI |
|--------|------------|---------|
| 16:9 | `landscape_16_9` | ✅ |
| 9:16 | `portrait_16_9` | ✅ |
| 1:1 | `square_hd` | ✅ |

| 欄 | 站內 | 官方 | 備註 |
|----|------|------|------|
| prompt | ✅ | required | |
| image_size | ✅ 三比例 | 另 4:3／物件尺寸；max_area 4MP | **健康** |
| num_inference_steps | 未送 | def **28** | strengths「可調」**未接 UI** |
| guidance_scale | 未送 | def **3.5** | 同上 |
| output_format | 未送 | def jpeg | |
| safety_tolerance | 未送 | def `"2"` | 1–5 字串 |

### OpenAPI 摘要（本輪 200）

- **required**: `prompt`
- **image_size**: square_hd｜square｜portrait_4_3｜portrait_16_9｜landscape_4_3｜landscape_16_9 或 ImageSize；def **landscape_4_3**；max 2560、area 4MP、×16
- **num_inference_steps**: 2–50，def **28**
- **guidance_scale**: 1.5–10，def **3.5**
- **safety_tolerance**: `"1"`–`"5"`，def `"2"`
- **output_format**: jpeg｜png
- **output**: images[] + seed

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 定位 | FLUX.2 **Flex** = 可調推步／CFG 的細節上限檔 |
| vs pro／dev | pro 更「一鍵旗艦」；dev 更經濟／LoRA；flex 給進階調參 |
| 站內現況 | 只送 prompt+size → **行為接近固定預設 28 步**，未兌現「微調」敘事（**P1 產品**） |

---

## 5. 站內扣點／退點

```
realPricePoints → 2
→ reserveQuota(2)
→ falSubmit("fal-ai/flux-2-flex", { prompt, image_size })
→ 失敗 refund(2)
```

| 檢查 | 結果 |
|------|------|
| 2 ≈ $0.05×31 | **≈** |
| verified false | **正確**（本輪無 live） |
| !needs | 可 live（無 KEY 跳過） |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| 生成台 text-to-image | ✅ | flagship |
| steps／guidance UI | ❌ | 與 strengths 落差 |
| recommended | ❌ | |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 主視覺精修（調參） | △ | API 支援；**站內未接** 旋鈕 |
| 一鍵高質感（預設） | ✅ | 仍可用 def 28 步 |
| 最低成本草稿 | ❌ | → Lightning／schnell |
| 超大圖 >1MP | ⚠ | 點數可能低估 |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| `shared/models.ts` | #12 · 原「端點推定」→ 本輪 **200 確認** |
| OpenAPI 本輪 | prompt；steps/guidance 可調；image_size |
| fal 模型頁 | https://fal.ai/models/fal-ai/flux-2-flex |

---

## 9. 建議動作

- [x] 升 shallow→九章；OpenAPI 直核；銷「推定」疑慮  
- [x] imageSize **三比例綠**  
- [x] **維持** points=2／verified false  
- [ ] **P1 產品：** steps／guidance UI 以兌現 strengths  
- [ ] **P2：** 大圖 MP 動態估點  
- [ ] L2（有 KEY）：短 prompt 探活後再人工 verified  

**裁決：維持**（端點綠；契約綠；零 live；不自動 verified）
