# fal-ai/flux-2-trainer/edit

> 審計：R5 · index **#249** · static+research · 2026-08-05（升 thin stub→九章）  
> slug：`fal-ai__flux-2-trainer__edit`  
> bulk OpenAPI **200**；本輪未重拉。  
> **needs=zip** · points=**230** → 禁經濟 live。  
> **未**改 verified／points。

## 1. 身分

| 項 | 值 |
|----|-----|
| index | **249** |
| 站內 id | `fal-ai/flux-2-trainer/edit` |
| endpoint | **同 id** |
| label | FLUX.2 編輯訓練器 |
| category / kind | **training** · text |
| tier | **flagship** |
| points（目錄） | **230** |
| cost | `$0.009/步` |
| verified | **true**（歷史） |
| needs | **zip** |
| recommended | false |
| strengths | 訓練「編輯行為」(前後對圖);客製修圖模型 |
| bestFor | 固定修圖流程自動化 |
| sourceHint | 前後對照圖包 zip 網址 |
| 姊妹 | #248 flux-2-trainer |

**一句話**：**FLUX.2 編輯 LoRA 訓練**——bulk required **`image_data_url`**；站內 **`images_data_url`** → **P0 同 #248**。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| 目錄 points | **230** |
| cost | $0.009/步 |
| `estimatePointsFor` | 扁平 **230** |

**結論：** **維持 points=230**。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| OpenAPI bulk | **200** · required **`image_data_url`** |
| 站內 input | `images_data_url` + `trigger_word` |
| training probe | 本輪 P **ok** |
| L2 | 未跑 |
| 結論 | **ready-static-with-caveat** |

### 站內 input

```ts
input: (p, _f, s) => ({ images_data_url: s, trigger_word: p.trim() || "EDIT" }),
```

**P0：** `images_data_url` vs bulk `image_data_url`（與 #248 同系）。

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 定位 | 前後對圖訓練 **編輯行為** LoRA |
| vs #248 | #248 風格／人物；本檔修圖流程 |

---

## 5–7. 扣點／暴露／情境

- needs=zip · 高點 → 站內素材訓練  
- probe 不受理  
- bestFor：固定修圖自動化  

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| `shared/models.ts` | #249 |
| bulk OpenAPI | image_data_url |
| fal 模型頁 | https://fal.ai/models/fal-ai/flux-2-trainer/edit |

---

## 9. 建議動作

- [x] 升 stub→完整九章  
- [ ] **P0：** 與 #248 一併核欄名  
- [x] **維持** points／verified  

**裁決：維持＋P0 欄名待核**
