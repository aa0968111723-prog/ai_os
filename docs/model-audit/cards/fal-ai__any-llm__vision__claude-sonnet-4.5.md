# fal-ai/any-llm/vision#claude-sonnet-4.5

> 審計：R4 · index **#189** · static+research · 2026-08-05  
> slug：`fal-ai__any-llm__vision__claude-sonnet-4.5`（**正名**；bulk 誤檔 `fal-ai__any-llm__vision#claude-sonnet-4.5.md` 僅 stub）  
> 共用 endpoint **`fal-ai/any-llm/vision`** + `model` 選擇器（非獨立 fal 模型路徑）。  
> **needs=image** → 本輪無 live（無 FAL_KEY）。  
> **未**改 verified／points。

## 1. 身分

| 項 | 值 |
|----|-----|
| index | **189** |
| 站內 id | `fal-ai/any-llm/vision#claude-sonnet-4.5` |
| endpoint | **`fal-ai/any-llm/vision`**（`#` 後為路由別名，非 path） |
| fal model 字串 | **`anthropic/claude-sonnet-4.5`**（`llmVisionInput`） |
| label | Claude Sonnet 4.5 視覺 |
| category / kind | **vision** · text |
| tier | **flagship** |
| points（目錄） | **1** |
| cost | `$0.01/次` |
| verified | **true**（目錄既有；本輪無新 live 證據、**不**覆寫） |
| needs | **image** |
| recommended | false |
| strengths | 細節觀察與文字轉寫嚴謹 |
| bestFor | 圖表解讀、文件照片整理 |
| sourceHint | 要理解的圖片 |
| 姊妹 | Gemini Pro（#188）、GPT-5（#190）、Flash（#195）、Moondream（#191 recommended） |

**一句話**：**細節／轉寫嚴謹** 旗艦 VLM——Claude Sonnet 4.5 via any-llm/vision；圖表與文件照片整理首選之一。

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
| 形狀風險 | OpenAPI **`image_urls`** vs 站內 **`image_url`** → **P1 共債**（同 #188） |
| L2 | 未跑（needs + 無 KEY） |
| 結論 | **ready-static-only** |

### 站內 input

```ts
input: llmVisionInput("anthropic/claude-sonnet-4.5")
// → { model: "anthropic/claude-sonnet-4.5",
//     prompt: prompt || "請詳細描述這張圖片(繁體中文)",
//     image_url: sourceUrl }
```

| 檢查 | 結果 |
|------|------|
| model 字串 | **綠**（Anthropic Claude Sonnet 4.5） |
| 預設繁中 prompt | **綠** |
| needs=image | sourceUrl 必填路徑 |
| 幽靈欄 | 無 |

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 架構 | fal **any-llm/vision** 多模型閘道；`model` 選 Claude |
| vs Gemini Pro | Pro＝繁中描述／難字補救；Claude＝細節觀察、圖表／文件轉寫嚴謹 |
| vs GPT-5 視覺 | GPT-5＝視覺問答全能；Claude＝轉寫／圖表向 |
| vs Moondream | Moondream＝recommended 經濟；Claude＝旗艦品質 |
| 知識庫 | body 由 `entry.input()`；與 #188 同 endpoint |

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
| 情境 pick 專屬 winner | △ | 未見獨立 sc winner（手選） |
| DB 預設看圖 | ❌ | 預設 Flash |
| recommended | ❌ | Moondream Next |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 圖表解讀 | ✅ | bestFor |
| 文件照片／文字轉寫 | ✅ | strengths 嚴謹 |
| 素材畫面盤點 | ✅ | 旗艦可用 |
| 批量素材庫建檔 | △ | Flash／Moondream 更省 |
| 無圖 | ❌ | needs=image |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| `shared/models.ts` | #189 · `llmVisionInput("anthropic/claude-sonnet-4.5")` |
| fal 模型頁 | https://fal.ai/models/fal-ai/any-llm/vision |
| 姊妹卡 | `fal-ai__any-llm__vision__gemini-2.5-pro.md`（#188） |
| bulk stub | `cards/fal-ai__any-llm__vision#claude-sonnet-4.5.md`（`#` 誤名；以本卡為準） |

---

## 9. 建議動作

- [x] 正名九章卡（`#` → `__` slug）  
- [x] 澄清共用 endpoint + model 選擇器  
- [x] 維持 points=1；不改 verified  
- [ ] **P1**（any-llm/vision 共債）：live 核 `image_url` vs `image_urls`  
- [ ] 同型正名：#190 GPT-5 · #195 Flash  
- [ ] 清理 bulk `#` 誤檔  

**L0 結論：** 契約與圖表／文件定位清楚；與 #188 同閘道共債。  
**未做：** live、改 points、改 verified。
