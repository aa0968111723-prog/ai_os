# nvidia-nim#llama-3.1-405b

> 審計：R4 · index **#182** · static+research · 2026-08-05  
> slug：`nvidia-nim__llama-3.1-405b`（**正名**；bulk 誤檔 `nvidia-nim#llama-3.1-405b.md` 僅 stub）  
> **非 fal OpenAPI**——`endpoint: nvidia-nim` → `nimSubmit`／NVIDIA integrate API。  
> **未**改 verified／points。零 live（本 shell 無 `NVIDIA_NIM_API_KEY`）。

## 1. 身分

| 項 | 值 |
|----|-----|
| index | **182** |
| 站內 id | `nvidia-nim#llama-3.1-405b` |
| endpoint | **`nvidia-nim`**（LLM 族共用；**不是** fal path） |
| NIM model 字串 | **`meta/llama-3.1-405b-instruct`**（`llmInput`／`NVIDIA_MODELS.llama3_405b`） |
| label | Llama 3.1 405B |
| category / kind | **llm** · text |
| tier | **flagship** |
| points（目錄） | **0** |
| cost | `免費(NVIDIA NIM 免費額度)` |
| verified | **false** |
| needs | 無 |
| recommended | false |
| strengths | Meta 開源最大檔;寫作品質與指令遵循頂尖 |
| bestFor | 正式腳本撰寫、開示摘要、長文彙整 |
| 供應商 | Meta **Llama 3.1 405B Instruct** via NVIDIA NIM |
| 工作流 | 多支 preset 用本 id 做「腳本潤飾／分鏡文案」步 |
| 情境 | 腳本結構規劃 **runner-up**（winner DeepSeek R1） |

**一句話**：NIM 上的 **最大開源寫作旗艦**——`{ model, prompt }` 進 chat/completions；目錄 **0 點**，估點 **floor 1**（同 #181 族債）。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| 目錄 points | **0** |
| cost | 免費(NVIDIA NIM 免費額度) |
| `parseRealCost` | 無 $ → 不機械覆寫 |
| `estimatePoints`／`estimatePointsFor` | `Math.max(1, round(0×…))` → **1** |
| 區段註解 | 短任務「固定扣 1 點」與原 any-llm 同口徑 |
| 校準 | 顯示 **0** vs 實扣路徑 **≥1** → **P0**（全 NIM LLM 共債） |

**結論：** 維持 points=0／不自動改；產品需統一「真免費」或「顯示 1」。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| L0 契約 | **ok** |
| fal OpenAPI | **N/A**（bulk stub 寫 fal 404／下架 **誤判**） |
| NIM | `POST {NVIDIA_NIM_ENDPOINT}/chat/completions` · Bearer `NVIDIA_NIM_API_KEY` |
| 預設 host | `https://integrate.api.nvidia.com/v1` |
| model id | `meta/llama-3.1-405b-instruct` ∈ `NVIDIA_MODELS` |
| 本環境 | 無 KEY → 未 `check-nim`／live |
| 生成台 | `isNimModel` → `nimSubmit`／`nimStatus`（記憶體佇列） |
| 結論 | **ready-static-only** |

### 站內 input

```ts
input: llmInput("meta/llama-3.1-405b-instruct")
// → { model: "meta/llama-3.1-405b-instruct", prompt }
```

| 檢查 | 結果 |
|------|------|
| 形狀 | model + prompt | **綠** |
| 與服務表 | `llama3_405b` 字串一致 | **綠** |
| 幽靈欄 | 無 | OK |

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 能力 | 405B instruct：長文、指令遵循、正式腳本與摘要 |
| vs R1 | R1 偏長鏈推理拆解；405B 偏寫作品質與穩定成文 |
| vs 70B | 70B＝日常／後端預設（`NIM_DEFAULT_MODEL`）；405B＝生成台旗艦選 |
| 中文 | 可用；繁中需提示約束（同族） |
| 延遲／額度 | 大模型較慢、易觸 NIM RPM／試用上限 → `NimServiceError` |
| 工作流 | 多 preset 的「潤飾成畫面描述」步綁本 id（高品質分鏡文） |

---

## 5. 站內扣點／退點

```
estimatePointsFor → 1
→ reserveQuota(1)
→ nimSubmit({ model: "meta/llama-3.1-405b-instruct", prompt })
→ 失敗 refund(1)
```

| 檢查 | 結果 |
|------|------|
| 目錄 0 vs 扣 1 | **P0 不一致**（#181 同） |
| verified false | 正確 |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| 生成台 LLM | ✅ | flagship |
| 工作流腳本潤飾步 | ✅ | 多 preset |
| 腳本結構規劃情境 | ✅ | runner-up |
| 自動導演／助手 | △ | 預設 70B 非本 id |
| fal 模型頁 | ❌ | 非 fal |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 正式腳本／開示摘要 | ✅ | bestFor |
| 分鏡畫面描述潤飾 | ✅ | workflow 綁定 |
| 長鏈邏輯拆解優先 | △ | 情境首選 R1 |
| 中文金句 | △ | Qwen2.5-72B 更貼 |
| 極速大量標籤 | ❌ | 用 8B |
| 無 NIM KEY | ❌ | 不可用 |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| `shared/models.ts` | #182 列、workflow steps |
| `server/services/nvidia-nim.ts` | `llama3_405b` |
| `docs/模型目錄.md` | 旗艦列 |
| bulk stub | `cards/nvidia-nim#llama-3.1-405b.md`（誤 404；以本卡為準） |
| 姊妹卡 | `nvidia-nim__deepseek-r1.md`（#181） |
| 自檢 | `npx tsx scripts/check-nim.ts` |

---

## 9. 建議動作

- [x] 正名九章卡；澄清非 fal 404  
- [x] 確認 model 字串與 `NVIDIA_MODELS` 一致  
- [x] 維持 verified=false；不改 points  
- [ ] **P0**（全 NIM）：顯示 0 vs 估點 floor 1  
- [ ] **L2**（有 NIM KEY）：短繁中 prompt 出文  
- [ ] 清理 bulk `#` 誤檔  

**L0 結論：** 契約綠、寫作旗艦定位清楚；扣點 floor 共債。  
**未做：** live、改 points、改 verified。
