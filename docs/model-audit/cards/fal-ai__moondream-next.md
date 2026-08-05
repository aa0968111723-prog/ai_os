# fal-ai/moondream-next

> slug: `fal-ai__moondream-next` · 審計 #191 · R static+research · 2026-08-05  
> 本輪 **零 live／禁止 `--yes`**；未改 `verified`／`points`。  
> recommended **true**（經濟視覺小鋼炮／批量標注）。

## 1. 身分

| 欄位 | 值 |
|------|-----|
| 站內 id | `fal-ai/moondream-next` |
| 實際 endpoint | **同 id** |
| label | Moondream Next |
| category / tier / kind | `vision` · `economy` · `text` |
| verified | **true**（目錄；OpenAPI 200；metadata **active**） |
| needs | **image** |
| recommended | **true** |
| sourceHint | 要理解的圖片 |
| strengths | 多任務視覺小鋼炮;描述/指認/偵測 |
| bestFor | 批量素材自動標注 |
| 廠商 | **Moondream Next** VLM via fal.ai |
| MODELS 序 | index **190**（審計總表 **#191**） |

**一句話**：輕量多任務 **VLM**——必填 `image_url`+`prompt`；站內空 prompt 回落 **「Describe this image in detail.」**；default `task_type=caption`、`max_tokens=64`；≈$0.005/次 → **1 點**；產出偏**英文**，繁中描述首選 Gemini 視覺。

## 2. 數值

| 項目 | 值 |
|------|-----|
| points | **1** |
| cost | `≈$0.005/次` |
| parseRealCost | usdMid=**0.005**、×1 次 |
| 估值 NT$ | 0.005×31=**0.155** → 下限 **1** 點 |
| 校準判定 | **≈**（報告估值 0.2，≈） |
| realPricePoints | **1** |
| estimatePoints | **1** |

**落差**：實價約 0.15 元、站內 1 點墊高（安全側）。`max_tokens` default **64** 偏短——細描述可能被截（站內不送；P3 可升）。**本輪不改 points**。

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| L0 | **ok** |
| OpenAPI | **200** · `MoondreamNextInput`／`Output` |
| metadata | **active** · MoonDreamNext · multimodal vision · tags multimodal, vision · updated 2026-04-21 |
| required | **`image_url` + `prompt`** |
| 站內 input | `{ image_url: s, prompt: p \|\| "Describe this image in detail." }` ✓ 永不缺 prompt |
| live | **未跑**（needs） |
| 輸出 | required **`output`** string；extractResult → `result.output` |
| 結論 | **ready-static** |

### OpenAPI 摘要

| 官方 property | 型別 / 約束 | 預設 | 站內 | 備註 |
|---------------|-------------|------|------|------|
| `image_url` | string **required** | — | ✅ | |
| `prompt` | string **required** | — | ✅（有預設句） | query／描述指令 |
| `task_type` | `caption`\|`query` | **caption** | ❌ | 吃 caption；有 prompt 時仍送 |
| `max_tokens` | 1–512 | **64** | ❌ | 偏短 |

```ts
input: (p, _f, s) => ({ image_url: s, prompt: p || "Describe this image in detail." }),
```

## 4. 底層

| 面向 | 說明 |
|------|------|
| 能力 | caption／query；生態敘事含指認／偵測／point（本 OpenAPI 僅 caption\|query enum） |
| 產出語 | **英文為主**；繁中建檔 → Gemini 2.5 Flash／Pro 視覺 |
| vs moondream2 | 本卡更強「Next」；moondream2 極小 budget |
| vs Florence-2 | Florence 固定 caption／OCR 路徑；本卡可自由 query |
| encoder／mechanics | unknown |

## 5. 站內點數路徑

```
→ needs=image → estimatePoints=1 → reserveQuota(1) → falSubmit → refund(1)
```

一致。

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| vision economy 選擇器 | ✅ | recommended |
| playbook `asset-catalog` | ✅ | 與 Gemini／Florence OCR 並列 |
| `sc-caption` | ❌ | pick 為 Gemini Flash／Pro（繁中）——正確分流 |
| task_type／max_tokens UI | ❌ | |
| 助手代操 | ❌ | needs 擋 |

**MCP 陷阱**：要圖；空 prompt 會被預設英文描述句；勿期待繁中長文。

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 批量粗標注／篩選 | ✅ **首選** | bestFor；1 點 |
| 繁中素材庫建檔 | △ | 粗標可；精稿 Gemini |
| 圖中中文 OCR | ❌ | Florence OCR／GOT／Gemini |
| 深度看圖推理 | ❌ | any-llm vision 旗艦 |
| 無圖 | ❌ | needs |

recommended **合理**（經濟預篩）。

## 8. 文件

| 來源 | 用途 |
|------|------|
| OpenAPI | 本 id · **200** |
| 模型頁 | https://fal.ai/models/fal-ai/moondream-next |
| metadata | active · 2026-04-21 |
| 站內 | models.ts L1823–1828；playbook asset-catalog |
| 點數 | 校準 ≈ |
| 生態 | fal生態研究 Moondream Next recommended |
| 姊妹 | moondream2；florence-2；any-llm vision |

## 9. 建議動作

- [x] **維持** id、needs、input 預設 prompt、points=1、recommended、verified
- [x] 九章卡 + `_index` #191
- [ ] **可選 P3**：`max_tokens: 256` 固定或 UI（default 64 短）
- [ ] **可選 P3**：task_type=query 當使用者明確提問
- [ ] **可選 P2**：strengths 註「英文為主；繁中建檔用 Gemini」
- [ ] **勿** `--yes`／改 points／verified
- [ ] **無 P0 契約洞**

**L0/L1**：綠。剩餘 UX（token／語系分流教育）。無 P0。
