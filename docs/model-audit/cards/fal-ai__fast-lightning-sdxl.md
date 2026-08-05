# fal-ai/fast-lightning-sdxl

> 審計：R1 · index **#11** · static+research · 2026-08-05（升 shallow→九章）  
> slug：`fal-ai__fast-lightning-sdxl`  
> OpenAPI **200**（本輪直拉）；**!needs**；L2 歷史 **success**（budget 已計）。  
> **未**改 verified／points／models.ts。

## 1. 身分

| 項 | 值 |
|----|-----|
| index | **11** |
| 站內 id | `fal-ai/fast-lightning-sdxl` |
| endpoint | **同 id** |
| label | SDXL Lightning |
| category / kind | **text-to-image** · image |
| tier | **budget** |
| points（執行時） | **1**（floor；`≈$0.001` → realPricePoints） |
| cost | `≈$0.001/張(按算秒)` |
| verified | **true**（+ L2 出圖成功） |
| needs | **無** |
| recommended | false |
| strengths | 全站最低成本;品質堪用、速度極快 |
| bestFor | 純試驗、佔位圖、教學練習 |
| 供應商 | SDXL Lightning · fal queue |
| 姊妹 | SDXL 系、FLUX schnell、Sana |

**一句話**：**SDXL Lightning** 全站地板價 t2i——required `prompt`；`image_size` 三比例綠；預設 **4 steps**；**1 點** 已 live 驗證。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| points | **1** |
| cost | **≈$0.001／張**（按算秒，約數） |
| `parseRealCost` | usdMid=**0.001** · multiplier=**1** |
| `realPricePoints` | `0.001 × 31 = 0.031` → **floor 1** |
| steps 預設 | num_inference_steps def **4**（enum 1/2/4/8 字串） |
| num_images | def 1（最大 8；多圖扁平 1 點 **P2**） |

**結論：** **維持 points=1**；極廉模型合理地板。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| L0 契約 | **ok** |
| fal OpenAPI | **200** `FastLightningSdxlInput`／`…Output` |
| required | **`prompt` only** |
| image_size | enum presets + ImageSize 物件；def **square_hd** |
| output | **`images[]`** + timings／seed／has_nsfw／prompt |
| L2 live | **success** · req `019fd061-9c39-7d51-8156-1d350c0c02e0` · +1 TWD |
| 結論 | **ready**（靜態綠 + 歷史 live） |

### 站內 input

```ts
input: (p, f) => ({ prompt: p, image_size: imageSize(f) }),
```

| format | image_size | OpenAPI preset |
|--------|------------|----------------|
| 16:9 | `landscape_16_9` | ✅ |
| 9:16 | `portrait_16_9` | ✅ |
| 1:1 | `square_hd` | ✅ |

| 欄 | 站內 | 官方 | 備註 |
|----|------|------|------|
| prompt | ✅ | required | |
| image_size | ✅ 三比例 | 另有 square／4:3 等 | **健康** |
| num_inference_steps | 未送 | def **4**（字串 enum） | Lightning 極少步 |
| num_images | 未送 | def 1 | |
| format | 未送 | def jpeg | |
| enable_safety_checker | 未送 | def true | |

### OpenAPI 摘要（本輪 200）

- **required**: `prompt`
- **image_size**: square_hd｜square｜portrait_4_3｜portrait_16_9｜landscape_4_3｜landscape_16_9 或 `{width,height}`
- **num_inference_steps**: **`"1"`｜`"2"`｜`"4"`｜`"8"`**（**字串**），def **4**
- **num_images**: 1–8，def 1
- **format**: jpeg｜png，def jpeg
- **expand_prompt**／**embeddings**／**safety_checker_version**／seed／sync_mode
- **output**: images[]（Image）

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 定位 | SDXL **Lightning** 少步蒸餾 → 極快極省 |
| vs FLUX schnell | 同 budget 帶；Lightning 更「佔位／試驗」 |
| 品質上限 | 不如 flagship；bestFor 已標試驗／佔位 |
| 步數 | 最多 8；非標準 SDXL 25–50 |

---

## 5. 站內扣點／退點

```
realPricePoints → 1
→ reserveQuota(1)
→ falSubmit("fal-ai/fast-lightning-sdxl", { prompt, image_size })
→ 失敗 refund(1)
```

| 檢查 | 結果 |
|------|------|
| 1 點 floor vs $0.001 | **合理**（低於 1 仍扣 1） |
| verified true | 與 L2 一致 |
| 多圖 8 張 | 仍 1 點 → **P2** 若開 UI |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| 生成台 text-to-image | ✅ | budget |
| format→image_size | ✅ | |
| steps／多圖 UI | ❌ | 吃預設 |
| recommended | ❌ | |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 純試驗／佔位／教學 | ✅ | bestFor |
| 主視覺／商用成片 | ❌ | → FLUX／Imagen 等 |
| 直式 9:16 草稿 | ✅ | portrait_16_9 |
| 批量 8 張同價 | ⚠ | 點數未乘張數 |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| `shared/models.ts` | #11 · imageSize · points1 · verified true |
| OpenAPI 本輪 | prompt；image_size presets；steps 1/2/4/8 |
| budget.json | L2 success 019fd061-9c39… · +1 TWD |
| fal 模型頁 | https://fal.ai/models/fal-ai/fast-lightning-sdxl |

---

## 9. 建議動作

- [x] 升 shallow→九章；OpenAPI 直核  
- [x] 確認 imageSize **三比例綠**  
- [x] 記錄 L2 已 success（不重跑）  
- [x] **維持** points=1／verified true  
- [ ] **P2：** 若開 num_images>1 需動態估點  
- [ ] 不需再 live（已有 artifact）  

**裁決：維持**（契約綠；已 live；地板價正確）
