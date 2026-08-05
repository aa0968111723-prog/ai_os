# fal-ai/flux-2-trainer

> 審計：R5 · index **#248** · static+research · 2026-08-05（升 thin stub→九章）  
> slug：`fal-ai__flux-2-trainer`  
> OpenAPI 本輪 **timeout**；沿用 bulk **200** 快照。  
> **needs=zip** · points=**248** → 禁 live（估點≥80 且遠超經濟檔）。  
> **未**改 verified／points。

## 1. 身分

| 項 | 值 |
|----|-----|
| index | **248** |
| 站內 id | `fal-ai/flux-2-trainer` |
| endpoint | **同 id** |
| label | FLUX.2 訓練器 |
| category / kind | **training** · text |
| tier | **flagship** |
| points（目錄） | **248** |
| cost | `$8/千步`（V2 版 `$5/千步`） |
| verified | **true**（歷史） |
| needs | **zip** |
| recommended | false |
| strengths | 最新 FLUX.2 基底;風格/人物/主題客製 |
| bestFor | 打造「本會專屬視覺風格」模型 |
| sourceHint | 訓練圖包 zip 網址(10–30 張圖) |

**一句話**：**FLUX.2 LoRA 訓練**——bulk required **`image_data_url`**；站內 **`images_data_url`** → **P0 欄名疑義**；貴、需 zip。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| 目錄 points | **248** |
| cost | $8/千步；V2 $5/千步 |
| 對照 | 高額訓練；**不**進經濟 live |
| `estimatePointsFor` | 扁平 **248** |

**結論：** **維持 points=248**（無本輪帳單證據不改）。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| fal OpenAPI | bulk **200**；本輪 timeout 未重核 |
| required（bulk） | **`image_data_url`**（單數 image） |
| props（bulk） | learning_rate、default_caption、output_lora_format、steps… |
| training probe | 本輪 P cat **ok**（空輸入連通） |
| L2 | 未跑（needs+高點） |
| 結論 | **ready-static-with-caveat** |

### 站內 input

```ts
input: (p, _f, s) => ({ images_data_url: s, trigger_word: p.trim() || "STYLE" }),
```

| 檢查 | 結果 |
|------|------|
| `images_data_url` | bulk 快照為 **`image_data_url`** → **P0 對照** |
| `trigger_word` | bulk props 未列於 required 摘要；可能 optional／別名 |

**P0：** 確認官方欄名 `image_data_url` vs `images_data_url`（差一個 s）；錯則訓練 422。本輪 SSL/timeout 未重核——**優先重拉 OpenAPI**。

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 定位 | FLUX.2 基底 **LoRA 訓練** |
| 觸發詞 | prompt 當 trigger_word |
| 產物 | LoRA 檔 → 生成端掛載 |

---

## 5. 站內扣點／退點

```
estimatePointsFor → 248
→ reserveQuota(248)
→ falSubmit({ images_data_url, trigger_word })
```

| 檢查 | 結果 |
|------|------|
| needs=zip | 探測模式不受理 |
| points 248 | softStop 內可但 **非**經濟優先 |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| 訓練台 | ✅ | zip 來源 |
| probe --yes | ❌ | needs + 貴 |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 專屬風格 LoRA | ✅ | bestFor |
| 無 zip | ❌ | |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| `shared/models.ts` | #248 · images_data_url |
| bulk OpenAPI | required image_data_url |
| fal 模型頁 | https://fal.ai/models/fal-ai/flux-2-trainer |
| P training 輪 | 端點連通 ok |

---

## 9. 建議動作

- [x] 升 stub→完整九章  
- [ ] **P0：** OpenAPI 重核 `image_data_url` vs `images_data_url`  
- [x] **維持** points=248；verified 不改  

**裁決：維持＋P0 欄名待核**
