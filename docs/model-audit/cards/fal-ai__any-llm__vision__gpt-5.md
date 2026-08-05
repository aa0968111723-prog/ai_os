# fal-ai/any-llm/vision#gpt-5

> 審計：R4 · index **#190** · static+research · 2026-08-05  
> slug：`fal-ai__any-llm__vision__gpt-5`（**正名**；bulk 誤檔 `fal-ai__any-llm__vision#gpt-5.md` 僅 stub）  
> 共用 endpoint **`fal-ai/any-llm/vision`** + `model` 選擇器（非獨立 fal 模型路徑）。  
> **needs=image** → 本輪無 live（無 FAL_KEY）。  
> **未**改 verified／points（目錄 **verified=false** 維持）。

## 1. 身分

| 項 | 值 |
|----|-----|
| index | **190** |
| 站內 id | `fal-ai/any-llm/vision#gpt-5` |
| endpoint | **`fal-ai/any-llm/vision`**（`#` 後為路由別名，非 path） |
| fal model 字串 | **`openai/gpt-5`**（`llmVisionInput`） |
| label | GPT-5 視覺 |
| category / kind | **vision** · text |
| tier | **flagship** |
| points（目錄） | **1** |
| cost | `$0.01/次` |
| verified | **false**（目錄；無 live 不升） |
| needs | **image** |
| recommended | false |
| strengths | 視覺問答全能 |
| bestFor | 看圖回答特定問題 |
| sourceHint | 要理解的圖片 |
| 姊妹 | Gemini Pro（#188 verified）、Claude（#189 verified）、Flash（#195）、Moondream（#191 recommended） |

**一句話**：**視覺問答全能** 旗艦 VLM——GPT-5 via any-llm/vision；適看圖回答特定問題；目錄未 verified。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| 目錄 points | **1** |
| cost | `$0.01/次` |
| 估值 NT$ | $0.01 × 31 ≈ **0.31** → floor **1** |
| 校準 | **≈**（略墊高；安全側） |
| `estimatePointsFor` | 扁平 **1** |

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
| 形狀風險 | OpenAPI **`image_urls`** vs 站內 **`image_url`** → **P1 共債**（#188–195 any-llm/vision） |
| model 可用性 | `openai/gpt-5` 是否在 any-llm/vision 策展 enum → **待 live**（verified false 合理） |
| L2 | 未跑（needs + 無 KEY） |
| 結論 | **ready-static-only** |

### 站內 input

```ts
input: llmVisionInput("openai/gpt-5")
// → { model: "openai/gpt-5",
//     prompt: prompt || "請詳細描述這張圖片(繁體中文)",
//     image_url: sourceUrl }
```

| 檢查 | 結果 |
|------|------|
| model 字串 | 契約形狀 **綠**；後端是否認 `openai/gpt-5` **待 L2** |
| 預設繁中 prompt | **綠** |
| needs=image | sourceUrl 必填路徑 |
| 幽靈欄 | 無 |

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 架構 | fal **any-llm/vision** 多模型閘道；`model` 選 OpenAI GPT-5 |
| vs Gemini Pro | Pro＝繁中描述／難字；GPT-5＝問答全能（目錄定位） |
| vs Claude | Claude＝圖表／文件轉寫嚴謹；GPT-5＝特定問題 VQA |
| vs Moondream | Moondream＝recommended 經濟；本檔＝旗艦未驗證 |
| 風險 | OpenRouter／fal 策展清單變動 → model slug 可能 4xx（故 verified false） |

---

## 5. 站內扣點／退點

```
estimatePointsFor → 1
→ reserveQuota(1)
→ falSubmit("fal-ai/any-llm/vision", { model: "openai/gpt-5", prompt, image_url })
→ 失敗 refund(1)
```

| 檢查 | 結果 |
|------|------|
| 1 點 vs $0.01 | **≈** |
| verified false | **正確**（待 live） |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| 生成台 vision | ✅ | flagship |
| 情境 pick 專屬 | △ | 未見獨立 sc winner |
| DB 預設看圖 | ❌ | 預設 Flash |
| recommended | ❌ | Moondream Next |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 看圖回答特定問題 | ✅ | bestFor |
| 視覺問答全能 | ✅ | strengths |
| 圖表嚴謹轉寫 | △ | Claude 更貼 |
| 繁中批量描述 | △ | Flash／Gemini Pro |
| 無圖 | ❌ | needs=image |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| `shared/models.ts` | #190 · `llmVisionInput("openai/gpt-5")` |
| fal 模型頁 | https://fal.ai/models/fal-ai/any-llm/vision |
| 姊妹卡 | `fal-ai__any-llm__vision__gemini-2.5-pro.md` · `…__claude-sonnet-4.5.md` |
| bulk stub | `cards/fal-ai__any-llm__vision#gpt-5.md`（`#` 誤名；以本卡為準） |

---

## 9. 建議動作

- [x] 正名九章卡（`#` → `__` slug）  
- [x] 澄清共用 endpoint + model 選擇器  
- [x] 維持 points=1；**維持 verified=false**  
- [ ] **P1**（any-llm/vision 共債）：live 核 `image_url` vs `image_urls`  
- [ ] **L2**：確認 `openai/gpt-5` 在 vision 閘道可用後再考慮 verified  
- [ ] 同型正名：#195 Flash  
- [ ] 清理 bulk `#` 誤檔  

**L0 結論：** 契約形狀綠；model 可用性與 image 欄共債待實測；verified false 合理。  
**未做：** live、改 points、改 verified。
