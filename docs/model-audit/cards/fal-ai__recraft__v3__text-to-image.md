# fal-ai/recraft/v3/text-to-image

> 審計：R1 · index **#17** · static+research · 2026-08-05（升 thin→九章）  
> slug：`fal-ai__recraft__v3__text-to-image`  
> OpenAPI **200**（本輪直拉）→ 端點活躍；**!needs**。  
> L2 歷史 **success**（budget 已計 +1）；**未**自動改 verified（禁）。  
> **未**改 points／input。

## 1. 身分

| 項 | 值 |
|----|-----|
| index | **17** |
| 站內 id | `fal-ai/recraft/v3/text-to-image` |
| endpoint | **同 id**（活躍） |
| label | Recraft V3 |
| category / kind | **text-to-image** · image |
| tier | **economy** |
| points（執行時） | **1**（`$0.04/張` raster；向量 **2×**） |
| cost | `$0.04/張(向量 $0.08)` |
| verified | **false**（L2 已成功 → **建議人工 true**，本輪不改） |
| needs | **無** |
| recommended | false |
| strengths | 設計導向;長段文字、向量 SVG、品牌風格一致批量產 |
| bestFor | 可無限放大的字標/logo、印刷向量海報 |
| 供應商 | Recraft · fal |
| 姊妹 | recraft/v4.1、ideogram/v3｜v4 |

**一句話**：**Recraft V3** 設計導向 t2i——required `prompt`；`imageSize` 三比例 **綠**；預設 `style=realistic_image`（**非**向量）；`$0.04→1 點`；向量 style **2× 價未暴露**。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| points | **1** |
| cost | **$0.04／張**（vector style **$0.08**） |
| `parseRealCost` | usdMid=**0.04** · multiplier=**1** |
| `realPricePoints` | `0.04 × 31 = 1.24` → **floor 1** |
| 預設 image_size（官方） | **square_hd**（站內覆寫 format） |
| 預設 style | **realistic_image** |
| 預設 enable_safety_checker | **false** |
| colors / style_id | 可選；站內未送 |

### 校準對照

| 設定 | USD | NT$ | vs 1 點 |
|------|-----|-----|---------|
| **raster 1 張 × $0.04** | 0.04 | 1.24 | **floor 1** ≈ |
| vector_illustration* | 0.08 | 2.48 | 仍 1 點 **低估** |
| 站內實際（無 style） | 0.04 | 1.24 | 走 raster 預設 |

**結論：** **維持 points=1**（站內不送 style→raster）；若日後開向量 style 須動態估點 **P1**。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| L0 契約 | **ok** |
| fal OpenAPI | **200** `RecraftV3TextToImageInput`／Output |
| about | 設計／品牌／文字；style 枚舉極多；向量 2× |
| required | **`prompt` only** |
| output | **images[]**（File url） |
| L2 live | **success** · req `019fd06f-4127-7983-8415-7b6b9fc8ae51` · webp · +1 TWD |
| 結論 | **ready**（靜態綠 + 歷史 live；verified 待人工） |

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
| image_size | ✅ | presets + {w,h}；def square_hd | **健康** |
| style | ❌ | def **realistic_image**；含 vector_* | **未暴露** → bestFor「向量」**落差 P1** |
| colors | ❌ | RGB 陣列 | 品牌色 **P2** |
| style_id | ❌ | uuid 自訂風格 | **P2** |
| enable_safety_checker | 未送 | def false | |

### OpenAPI 摘要（本輪 200）

- **required**: `prompt`
- **image_size**: square_hd｜square｜portrait_4_3｜portrait_16_9｜landscape_4_3｜landscape_16_9 或 ImageSize{w,h}
- **style**: 極多 enum（realistic_image／digital_illustration／vector_illustration 及子風格）；def **realistic_image**；**Vector images cost 2X**
- **colors**: RGBColor[] def []
- **style_id**: optional uuid4
- **enable_safety_checker**: bool def false
- **無** aspect_ratio／steps／guidance／num_images

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 定位 | 設計／排版／品牌物料；非寫實旗艦 |
| vs Ideogram | 同「設計感海報」場景 pick；Ideogram 偏英文字型 |
| vs v4.1 | 新版更準；本檔仍經濟 raster 預設 |
| 向量 | 官方 style 前綴 `vector_illustration/*` 才 2×；站內永遠 raster 除非改 input |

---

## 5. 站內扣點／退點

```
realPricePoints → 1
→ reserveQuota(1)
→ falSubmit("fal-ai/recraft/v3/text-to-image", { prompt, image_size })
→ 失敗 refund(1)
```

| 檢查 | 結果 |
|------|------|
| 1 點 vs $0.04 | **合理** |
| 向量 2× 未接 | 點數仍 1 → **勿開 style 向量而無估點** |
| L2 success | budget 有證 |
| verified false | **本輪不改** |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| 生成台 text-to-image | ✅ | economy |
| sc-design-poster pickIds | ✅ | 與 ideogram v3/v4 |
| recommended | ❌ | |
| style／向量 UI | ❌ | **落差** |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 英文設計感海報 | ✅ | 場景選型 |
| logo／無限放大向量 | △ | **站內無 style=vector** → 敘事超前 **P1** |
| 品牌色一致 | △ | colors 未接 **P2** |
| 寫實人像 | △ | 預設 realistic 可，但非主力賣點 |
| 中文長字 | ⚠ | 優先 Qwen／Seedream 系 |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| `shared/models.ts` | #17 · imageSize · points1 · verified false |
| OpenAPI 本輪 | prompt；image_size；style 2× 註記 |
| budget.json | L2 success 019fd06f-4127… |
| fal 模型頁 | https://fal.ai/models/fal-ai/recraft/v3/text-to-image |

---

## 9. 建議動作

- [x] 升 thin→九章；OpenAPI 直核  
- [x] imageSize **綠**；L2 歷史 success 入卡  
- [x] **維持** points=1；**不**自動 verified true  
- [ ] **人工：** verified false→true  
- [ ] **P1 文案／功能：** bestFor「向量 SVG」vs 站內無 vector style；若開 style 向量須 2× 估點  
- [ ] **P2：** colors／style_id UI  
- [ ] 不需再 live  

**裁決：維持**（契約綠；已 live；向量敘事 P1）
