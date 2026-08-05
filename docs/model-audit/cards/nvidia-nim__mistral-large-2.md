# nvidia-nim#mistral-large-2

> 審計：R4 · index **#186** · static+research · 2026-08-05  
> slug：`nvidia-nim__mistral-large-2`（**正名**；bulk 誤檔 `nvidia-nim#mistral-large-2.md` 僅 stub）  
> **非 fal OpenAPI**——`endpoint: nvidia-nim` → `nimSubmit`／NVIDIA integrate API。  
> **未**改 verified／points。零 live（無 `NVIDIA_NIM_API_KEY`）。

## 1. 身分

| 項 | 值 |
|----|-----|
| index | **186** |
| 站內 id | `nvidia-nim#mistral-large-2` |
| endpoint | **`nvidia-nim`** |
| NIM model 字串 | **`mistralai/mistral-large-2-instruct`**（`llmInput`／`NVIDIA_MODELS.mistralLarge`） |
| label | Mistral Large 2 |
| category / kind | **llm** · text |
| tier | **economy** |
| points（目錄） | **0** |
| cost | `免費(NVIDIA NIM 免費額度)` |
| verified | **false** |
| needs | 無 |
| recommended | false |
| strengths | 歐系旗艦;多語能力佳、風格精煉 |
| bestFor | 多語版本文案、翻譯初稿 |
| 供應商 | **Mistral Large 2 Instruct** via NIM |
| 姊妹 | Qwen（中文）、70B（預設）、405B（寫作旗艦） |

**一句話**：**多語／翻譯** 向的 economy LLM——歐系精煉風格；目錄 **0 點**，估點 **floor 1**（NIM 共債）。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| 目錄 points | **0** |
| cost | 免費(NVIDIA NIM 免費額度) |
| `parseRealCost` | 無 $ → 不機械覆寫 |
| `estimatePoints`／`estimatePointsFor` | **1**（floor） |
| 校準 | 顯示 **0** vs 扣點 **≥1** → **P0**（#181–187 共債） |

**結論：** 維持 0；不自動改 points。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| L0 契約 | **ok** |
| fal OpenAPI | **N/A**（bulk fal404 **誤判**） |
| NIM | `POST …/chat/completions` |
| 字串對齊 | `mistralLarge` ≡ input | **綠** |
| 本環境 | 無 KEY → 未 live |
| 生成台 | `nimSubmit`／`nimStatus` |
| 結論 | **ready-static-only** |

### 站內 input

```ts
input: llmInput("mistralai/mistral-large-2-instruct")
// → { model: "mistralai/mistral-large-2-instruct", prompt }
```

| 檢查 | 結果 |
|------|------|
| model + prompt | **綠** |
| 幽靈欄 | 無 |

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 定位 | 多語能力、風格精煉；翻譯初稿／多語版本文案 |
| vs Qwen | 中文首選 Qwen；本檔偏歐系多語 |
| vs 70B | 70B＝後端預設日常；本檔＝多語場景手動選 |
| 額度 | NIM 免費層 RPM／試用上限 |

---

## 5. 站內扣點／退點

```
estimatePointsFor → 1
→ reserveQuota(1)
→ nimSubmit({ model: "mistralai/mistral-large-2-instruct", prompt })
→ 失敗 refund(1)
```

| 檢查 | 結果 |
|------|------|
| 目錄 0 vs 扣 1 | **P0** |
| verified false | 正確 |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| 生成台 LLM | ✅ | economy |
| 情境 pick 首選 | △ | 未見專屬 winner 軸（多語可手選） |
| 後端自動預設 | ❌ | 70B |
| fal 模型頁 | ❌ | 非 fal |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 多語版本文案／翻譯初稿 | ✅ | bestFor |
| 中文金句 | △ | Qwen 更貼 |
| 日常標題改寫 | △ | 70B recommended |
| 無 NIM KEY | ❌ | 不可用 |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| `shared/models.ts` | #186 |
| `server/services/nvidia-nim.ts` | `mistralLarge` |
| `docs/模型目錄.md` | economy 列 |
| bulk stub | `cards/nvidia-nim#mistral-large-2.md`（誤 404；以本卡為準） |
| 姊妹 | `nvidia-nim__qwen2.5-72b.md` · `nvidia-nim__llama-3.1-70b.md` |

---

## 9. 建議動作

- [x] 正名九章卡；澄清非 fal 404  
- [x] model 字串與 `NVIDIA_MODELS` 一致  
- [x] 維持 verified=false；不改 points  
- [ ] **P0**（全 NIM）：顯示 0 vs 估點 floor 1  
- [ ] **L2**（有 NIM KEY）：多語短 prompt  
- [ ] 清理 bulk `#` 誤檔  

**L0 結論：** 契約綠；多語定位清楚；扣點共債仍開。  
**未做：** live、改 points、改 verified。
