# fal-ai/any-llm/vision#gemini-2.5-pro

> 審計：R4 · index **#188** · static+research · 2026-08-05  
> slug：`fal-ai__any-llm__vision__gemini-2.5-pro`（**正名**；bulk 誤檔 `fal-ai__any-llm__vision#gemini-2.5-pro.md` 僅 stub）  
> 共用 endpoint **`fal-ai/any-llm/vision`** + `model` 選擇器（非獨立 fal 模型路徑）。  
> **needs=image** → 本輪無 live（無 FAL_KEY；且 needs 不進經濟 L）。  
> **未**改 verified／points。

## 1. 身分

| 項 | 值 |
|----|-----|
| index | **188** |
| 站內 id | `fal-ai/any-llm/vision#gemini-2.5-pro` |
| endpoint | **`fal-ai/any-llm/vision`**（`#` 後為路由別名，非 path） |
| fal model 字串 | **`google/gemini-2.5-pro`**（`llmVisionInput`） |
| label | Gemini 2.5 Pro 視覺 |
| category / kind | **vision** · text |
| tier | **flagship** |
| points（目錄） | **1** |
| cost | `$0.01/次` |
| verified | **true**（目錄既有；本輪無新 live 證據、**不**覆寫） |
| needs | **image** |
| recommended | false |
| strengths | 看圖推理最強之一;繁中描述自然 |
| bestFor | 素材整理描述、畫面內容盤點 |
| sourceHint | 要理解的圖片 |
| 姊妹 | Flash（#195 批量）、Claude Sonnet（#189）、GPT-5（#190）、Moondream（#191 recommended） |

**一句話**：**旗艦看圖推理**——Gemini 2.5 Pro via any-llm/vision；繁中描述自然；OCR 難字補救／深度看圖升檔。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| 目錄 points | **1** |
| cost | `$0.01/次` |
| 估值 NT$ | $0.01 × 31 ≈ **0.31** → floor **1** |
| 校準 | **≈**（略墊高；安全側） |
| `estimatePointsFor` | 扁平 **1**（非動態 MP） |

**結論：** 維持 points=1；不自動改。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| L0 契約 | **ok** |
| fal OpenAPI | endpoint `fal-ai/any-llm/vision` bulk **200** |
| required（bulk） | `prompt` |
| props（bulk） | `system_prompt`, `prompt`, `priority`, `temperature`, `image_urls`, `max_tokens`, `reasoning`, `model` |
| 站內 input | `model` + `prompt` + **`image_url`**（單數） |
| 形狀風險 | OpenAPI 列 **`image_urls`** 複數；站內送 **`image_url`** → **P1 待 live 核**（422 否） |
| L2 | 未跑（needs + 無 KEY） |
| 結論 | **ready-static-only**（契約綠；欄位單複數待實測） |

### 站內 input

```ts
input: llmVisionInput("google/gemini-2.5-pro")
// → { model: "google/gemini-2.5-pro",
//     prompt: prompt || "請詳細描述這張圖片(繁體中文)",
//     image_url: sourceUrl }
```

| 檢查 | 結果 |
|------|------|
| model 字串 | **綠**（Google Gemini 2.5 Pro） |
| 預設繁中 prompt | **綠** |
| needs=image | sourceUrl 必填路徑 |
| 幽靈欄 | 無多餘 |

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 架構 | fal **any-llm/vision** 多模型閘道；以 `model` 選後端 VLM |
| vs Flash | Flash＝批量／性價比；Pro＝更深推理、難字 OCR 補救 |
| vs Moondream | Moondream＝recommended 經濟多任務；Pro＝旗艦品質 |
| vs GOT-OCR | GOT＝專用 OCR winner；Pro＝手稿／難字 runner-up（sc OCR） |
| 知識庫 | `knowledge.ts` 取 queue 同步路徑；body 由 `entry.input()` |

---

## 5. 站內扣點／退點

```
estimatePointsFor → 1
→ reserveQuota(1)
→ falSubmit("fal-ai/any-llm/vision", { model, prompt, image_url })
→ 失敗 refund(1)
```

| 檢查 | 結果 |
|------|------|
| 1 點 vs $0.01 | **≈** |
| verified true | 目錄既有；本輪不改 |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| 生成台 vision | ✅ | flagship |
| 情境 sc-caption | ✅ | pick（Flash 優先、Pro 升檔） |
| 情境 OCR 難字 | ✅ | pickIds runner-up |
| DB 預設看圖 | ❌ | 預設 **Flash**（`DB_VISION_MODEL_ID`） |
| recommended | ❌ | Moondream Next |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 素材整理／畫面盤點 | ✅ | bestFor |
| 繁中看圖描述（深度） | ✅ | strengths |
| 手稿／難字 OCR 補救 | ✅ | sc OCR pick |
| 素材庫批量建檔 | △ | Flash 更省 |
| 無圖（缺 source） | ❌ | needs=image |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| `shared/models.ts` | #188 · `llmVisionInput` · sc-caption / OCR pick |
| `server/routers/knowledge.ts` | any-llm/vision 佇列路徑註解 |
| `server/services/databaseMedia.ts` | 預設看圖 id（Flash 非本檔） |
| fal 模型頁 | https://fal.ai/models/fal-ai/any-llm/vision |
| bulk stub | `cards/fal-ai__any-llm__vision#gemini-2.5-pro.md`（`#` 誤名；以本卡為準） |

---

## 9. 建議動作

- [x] 正名九章卡（`#` → `__` slug）  
- [x] 澄清共用 endpoint + model 選擇器  
- [x] 維持 points=1；不改 verified  
- [ ] **P1**：live 核 `image_url` vs OpenAPI `image_urls`（有 KEY + 測試圖）  
- [ ] 同型正名：#189 Claude · #190 GPT-5 · #195 Flash  
- [ ] 清理 bulk `#` 誤檔  

**L0 結論：** 契約與情境定位清楚；旗艦看圖升檔合理；單複數 image 欄待實測。  
**未做：** live、改 points、改 verified。
