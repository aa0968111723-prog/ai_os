# fal-ai/any-llm/vision#gemini-2.5-flash

> 審計：R4 · index **#195** · static+research · 2026-08-05  
> slug：`fal-ai__any-llm__vision__gemini-2.5-flash`（**正名**；bulk 誤檔 `fal-ai__any-llm__vision#gemini-2.5-flash.md` 僅 stub）  
> 共用 endpoint **`fal-ai/any-llm/vision`** + `model` 選擇器。  
> **本檔＝`DB_VISION_MODEL_ID` 預設**；**sc-caption 情境 winner**。  
> **needs=image** → 本輪無 live（無 FAL_KEY）。  
> **未**改 verified／points（目錄 **verified=false** 維持）。

## 1. 身分

| 項 | 值 |
|----|-----|
| index | **195** |
| 站內 id | `fal-ai/any-llm/vision#gemini-2.5-flash` |
| endpoint | **`fal-ai/any-llm/vision`**（`#` 後為路由別名，非 path） |
| fal model 字串 | **`google/gemini-2.5-flash`**（`llmVisionInput`） |
| label | Gemini 2.5 Flash 視覺 |
| category / kind | **vision** · text |
| tier | **economy** |
| points（目錄） | **1** |
| cost | `$0.01/次` |
| verified | **false**（目錄；無 live 不升） |
| needs | **image** |
| recommended | false（生成台非 recommended；**DB 預設**另軌） |
| strengths | 高性價比看圖;繁中描述自然、中文字辨識佳 |
| bestFor | 素材庫批量看圖生繁中描述 |
| sourceHint | 要理解的圖片 |
| 姊妹 | Pro（#188 升檔）、Claude（#189）、GPT-5（#190）、Moondream（#191 recommended） |

**一句話**：**站內預設看圖引擎**——Gemini 2.5 Flash via any-llm/vision；批量繁中描述／中文辨識佳；sc-caption winner。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| 目錄 points | **1** |
| cost | `$0.01/次` |
| 估值 NT$ | $0.01 × 31 ≈ **0.31** → floor **1** |
| 校準 | **≈**（略墊高；安全側） |
| `estimatePointsFor` | 扁平 **1** |

**結論：** 維持 points=1；不自動改。批量場景每張 1 點需產品層注意額度。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| L0 契約 | **ok** |
| fal OpenAPI | endpoint `fal-ai/any-llm/vision` bulk **200** |
| required（bulk） | `prompt` |
| props（bulk） | `system_prompt`, `prompt`, `priority`, `temperature`, `image_urls`, `max_tokens`, `reasoning`, `model` |
| 站內 input | `model` + `prompt` + **`image_url`**（單數） |
| 形狀風險 | OpenAPI **`image_urls`** vs 站內 **`image_url`** → **P1 共債**（any-llm/vision 全家） |
| L2 | 未跑（needs + 無 KEY） |
| 結論 | **ready-static-only** |

### 站內 input

```ts
input: llmVisionInput("google/gemini-2.5-flash")
// → { model: "google/gemini-2.5-flash",
//     prompt: prompt || "請詳細描述這張圖片(繁體中文)",
//     image_url: sourceUrl }
```

| 檢查 | 結果 |
|------|------|
| model 字串 | **綠**（Google Gemini 2.5 Flash） |
| 預設繁中 prompt | **綠**（契合 sc-caption） |
| needs=image | sourceUrl 必填 |
| 幽靈欄 | 無 |

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 架構 | fal **any-llm/vision** 閘道；`model` 選 Flash |
| vs Pro | Flash＝批量／性價比；Pro＝更深推理升檔（sc-caption pick[1]） |
| vs Moondream | Moondream＝生成台 recommended；Flash＝**DB 媒體庫自動描述預設** |
| 資料庫 | `databaseMedia.ts` → `DB_VISION_MODEL_ID` 預設本 id |
| 情境 | `sc-caption` pickIds[0]＝本檔 |

---

## 5. 站內扣點／退點

```
estimatePointsFor → 1
→ reserveQuota(1)
→ falSubmit("fal-ai/any-llm/vision", { model: "google/gemini-2.5-flash", prompt, image_url })
→ 失敗 refund(1)
```

| 檢查 | 結果 |
|------|------|
| 1 點 vs $0.01 | **≈** |
| verified false | **正確**（待 live；DB 路徑亦依此） |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| 生成台 vision | ✅ | economy |
| **DB 自動看圖** | ✅ | **`DB_VISION_MODEL_ID` 預設** |
| 情境 sc-caption | ✅ | **winner**（首選） |
| recommended | ❌ | Moondream Next |
| env 覆寫 | ✅ | `DB_VISION_MODEL_ID` |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 素材庫批量繁中描述 | ✅ | bestFor · sc-caption |
| 中文字辨識 | ✅ | strengths |
| 深度看圖推理 | △ | 升 Pro |
| 圖表嚴謹轉寫 | △ | Claude |
| 無圖 | ❌ | needs=image |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| `shared/models.ts` | #195 · sc-caption pick |
| `server/services/databaseMedia.ts` | `DB_VISION_MODEL_ID` 預設 |
| fal 模型頁 | https://fal.ai/models/fal-ai/any-llm/vision |
| 姊妹 | `…__gemini-2.5-pro.md`（#188） |
| bulk stub | `cards/fal-ai__any-llm__vision#gemini-2.5-flash.md`（`#` 誤名；以本卡為準） |

---

## 9. 建議動作

- [x] 正名九章卡（`#` → `__` slug）  
- [x] 標註 DB 預設 + sc-caption winner  
- [x] 維持 points=1；**維持 verified=false**  
- [ ] **P1**（any-llm/vision 共債）：live 核 `image_url` vs `image_urls`——**DB 路徑高優先**  
- [ ] **L2**：確認後再考慮 verified（影響素材庫自動建檔）  
- [ ] 同型正名：#200–203 whisper/wizper/elevenlabs `#`  
- [ ] 清理 bulk `#` 誤檔  

**L0 結論：** 契約綠；產品關鍵路徑（DB＋sc-caption）；image 欄共債對批量路徑尤要緊。  
**未做：** live、改 points、改 verified。

**any-llm/vision 正名收斂：** #188 Pro · #189 Claude · #190 GPT-5 · **#195 Flash** 齊。
