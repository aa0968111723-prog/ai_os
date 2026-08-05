# fal-ai/flux-2

> 審計：R1 · index **#13** · static+research · 2026-08-05（升 shallow→九章）  
> slug：`fal-ai__flux-2`  
> OpenAPI **200**（本輪直拉）→ 端點活躍（銷「推定」）；**!needs**。  
> L2 歷史 **success**（budget 已計 +1）；**未**自動改 verified（禁）。  
> **未**改 points／input。

## 1. 身分

| 項 | 值 |
|----|-----|
| index | **13** |
| 站內 id | `fal-ai/flux-2` |
| endpoint | **同 id**（活躍；`flux-2/dev` 等別名 **404**） |
| label | FLUX.2 [dev] |
| category / kind | **text-to-image** · image |
| tier | **economy** |
| points（執行時） | **1**（`$0.012/MP` → realPricePoints floor） |
| cost | `$0.012/MP` |
| verified | **false**（目錄；L2 已成功 → **建議人工 true**，本輪不改） |
| needs | **無** |
| recommended | false |
| strengths | FLUX.2 開源檔;品質接近 pro 但便宜過半、可搭 LoRA |
| bestFor | 日常分鏡草稿新主力、專屬風格 LoRA 基底 |
| 供應商 | BFL FLUX.2 [dev] · fal |
| 姊妹 | flux-2-flex、flux-2/pro、flux/dev、flux/schnell |

**一句話**：**FLUX.2 dev** 經濟開源檔 t2i——required `prompt`；imageSize **三比例綠**；`$0.012/MP → 1 點`；**本端點 schema 無 loras**（「可搭 LoRA」敘事 **P1**）。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| points | **1** |
| cost | **$0.012／MP** |
| `parseRealCost` | usdMid=**0.012** · multiplier=**1**（≈1MP） |
| `realPricePoints` | `0.012 × 31 = 0.372` → **floor 1** |
| 預設 steps | num_inference_steps def **28**（4–50） |
| 預設 guidance | guidance_scale def **2.5**（0–20） |
| 預設 acceleration | **regular** |
| 預設 image_size（官方） | landscape_4_3（站內覆寫） |

### 校準對照

| 設定 | USD | NT$ | vs 1 點 |
|------|-----|-----|---------|
| **≈1MP × $0.012** | 0.012 | 0.37 | **floor 1**（略高估） |
| 2MP | 0.024 | 0.74 | 仍 1 點 ≈ |
| num_images=4 | ×4 費 | | 扁平 1 **P2** |

**結論：** **維持 points=1**；經濟檔地板合理。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| L0 契約 | **ok** |
| fal OpenAPI | **200** `Flux2Input`／`Flux2Output` |
| about | FLUX.2 [dev] t2i；realism／text／native editing 敘事 |
| required | **`prompt` only** |
| output | **images[]** + timings／seed／has_nsfw／prompt |
| L2 live | **success** · req `019fd062-41ce-7eb2-ab26-39410152c123` · png artifact · +1 TWD |
| 結論 | **ready**（靜態綠 + 歷史 live；verified 待人工） |

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
| image_size | ✅ | 512–2048；presets | **健康** |
| loras | ❌ | **schema 無** | strengths「可搭 LoRA」**落差** |
| num_inference_steps／guidance | 未送 | def 28／2.5 | |
| acceleration | 未送 | def regular | |
| num_images | 未送 | def 1 max 4 | |

### OpenAPI 摘要（本輪 200）

- **required**: `prompt`
- **image_size**: square_hd｜square｜portrait_*｜landscape_* 或 ImageSize；def landscape_4_3
- **num_inference_steps**: 4–50，def **28**
- **guidance_scale**: 0–20，def **2.5**
- **acceleration**: none｜regular｜high，def regular
- **num_images**: 1–4，def 1
- **output_format**: jpeg｜png｜webp，def **png**
- **無** `loras` 陣列

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 定位 | FLUX.2 **dev** 開源經濟檔；日常草稿 |
| vs flex | flex 標可調細節上限、較貴（2 點） |
| vs pro | pro 旗艦一鍵；本檔便宜 |
| LoRA | 本 id **非** LoRA 推論端；需另端或敘事修正 |

---

## 5. 站內扣點／退點

```
realPricePoints → 1
→ reserveQuota(1)
→ falSubmit("fal-ai/flux-2", { prompt, image_size })
→ 失敗 refund(1)
```

| 檢查 | 結果 |
|------|------|
| 1 點 floor vs $0.012 | **合理** |
| L2 success | 證據在 budget |
| verified false | **本輪不改**（禁自動 true） |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| 生成台 text-to-image | ✅ | economy |
| LoRA 來源欄 | ❌ | needs 無；schema 無 |
| recommended | ❌ | |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 日常分鏡草稿 | ✅ | bestFor |
| 專屬 LoRA 基底 | △ | **本端點無 loras** → 另端／修文案 |
| 主視覺極致 | △ | → flex／pro |
| 批量 4 張 | ⚠ | 點數未×張數 |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| `shared/models.ts` | #13 · imageSize · points1 · verified false |
| OpenAPI 本輪 | prompt；無 loras；acceleration 等 |
| budget.json | L2 success 019fd062-41ce… |
| fal 模型頁 | https://fal.ai/models/fal-ai/flux-2 |

---

## 9. 建議動作

- [x] 升 shallow→九章；OpenAPI 直核；銷推定  
- [x] imageSize **綠**；L2 歷史 success 入卡  
- [x] **維持** points=1；**不**自動 verified true  
- [ ] **人工：** verified false→true（已有 live 證據）  
- [ ] **P1 文案：** strengths「可搭 LoRA」vs schema 無 loras  
- [ ] **P2：** num_images 動態估點  
- [ ] 不需再 live  

**裁決：維持**（契約綠；已 live；verified 待人工）
