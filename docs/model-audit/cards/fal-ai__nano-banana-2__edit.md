# fal-ai/nano-banana-2/edit

> 審計：R · index **#31** · static+research · 2026-08-05（升 thin→九章）  
> slug：`fal-ai__nano-banana-2__edit`  
> OpenAPI **200**；**needs=image** → 零 live。  
> **未**改 verified／points。

## 1. 身分

| 項 | 值 |
|----|-----|
| index | **31** |
| 站內 id | `fal-ai/nano-banana-2/edit` |
| endpoint | **同 id** |
| label | Nano Banana 2 Edit |
| category / kind | **image-to-image** · image |
| tier | **flagship** |
| points（目錄） | **2** |
| cost | `$0.08/張(1K)` |
| verified | **true**（歷史） |
| needs | **image** |
| recommended | false |
| strengths | 免遮罩自然語言編輯;最多 14 張參考圖合成 |
| bestFor | 「把背景換成禪堂」口語修改、多圖合成 |
| sourceHint | 要編輯的圖 |

**一句話**：**Nano Banana 2 Edit**——required **`prompt`**；`image_urls` 條件可選（可改 video/audio/pdf）；站內 `image_urls:[s]` + needs=image。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| 目錄 points | **2** |
| cost | **$0.08／張(1K)** ≈ NT$2.5 → points **2** 貼邊 |
| `estimatePointsFor` | 扁平 **2** |

**結論：** **維持 points=2**。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| fal OpenAPI | **200** `NanoBanana2EditInput` |
| required | **`prompt` only**（minLength 3） |
| image_urls | optional if video_url／audio_url／pdf_url 有一 |
| output | **`images`** + **`description`** |
| L2 | 未跑（needs） |
| 結論 | **ready-static-only** |

### 站內 input

```ts
input: (p, _f, s) => ({ prompt: p, image_urls: [s] }),
```

| 檢查 | 結果 |
|------|------|
| `prompt` | **綠** |
| `image_urls` | **綠** 陣列 |
| multi-ref 最多 14 | 站內只塞 1 張來源 **P2 產品** |

### OpenAPI 對照

| 官方 | 站內 | 備註 |
|------|------|------|
| `prompt` required | ✅ | |
| `image_urls` 條件 | ✅ 有送 | needs=image 合理 |
| thinking_level / resolution / aspect | 未送 | P2 |
| output images+description | extract images ✅ | |

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 定位 | Gemini 系 **免遮罩** 口語編輯 |
| 多模態 | 還可吃 video／audio／pdf 當 context |
| vs FLUX edit | 更偏指令理解；FLUX 更構圖一致 |

---

## 5. 站內扣點／退點

```
estimatePointsFor → 2
→ falSubmit({ prompt, image_urls })
→ 失敗 refund(2)
```

| 檢查 | 結果 |
|------|------|
| needs=image | 不進 !needs live |
| verified true | 歷史；本輪不改 |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| 圖生圖台 | ✅ | flagship |
| 多圖參考 UI | △ | API 多 URL；站內 1 張 |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 口語改背景／物件 | ✅ | bestFor |
| 14 張合成 | △ | 需擴 image_urls |
| 無來源圖 | △ | schema 可用 video/audio/pdf |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| `shared/models.ts` | #31 · image_urls |
| OpenAPI 本輪 | required prompt |
| fal 模型頁 | https://fal.ai/models/fal-ai/nano-banana-2/edit |

---

## 9. 建議動作

- [x] 升 stub→九章；OpenAPI 直核  
- [x] 維持 points=2／needs=image  
- [ ] P2 多參考圖 UI  

**裁決：維持**
