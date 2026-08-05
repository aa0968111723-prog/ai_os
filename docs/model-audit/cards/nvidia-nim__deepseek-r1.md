# nvidia-nim#deepseek-r1

> 審計：R4 · index **#181** · static+research · 2026-08-05  
> slug：`nvidia-nim__deepseek-r1`（**正名**；bulk 誤檔 `nvidia-nim#deepseek-r1.md` 僅 stub）  
> **非 fal OpenAPI**——`endpoint: nvidia-nim` → `nimSubmit`／NVIDIA integrate API。  
> **未**改 verified／points。零 live（無 NIM KEY 於本 shell）。

## 1. 身分

| 項 | 值 |
|----|-----|
| index | **181** |
| 站內 id | `nvidia-nim#deepseek-r1` |
| endpoint | **`nvidia-nim`**（全 LLM 族共用；**不是** fal path） |
| NIM model 字串 | **`deepseek-ai/deepseek-r1`**（`llmInput`／`NVIDIA_MODELS.deepseekR1`） |
| label | DeepSeek R1 |
| category / kind | **llm** · text |
| tier | **flagship** |
| points（目錄） | **0** |
| cost | `免費(NVIDIA NIM 免費額度)` |
| verified | **false** |
| needs | 無 |
| recommended | false |
| strengths | 深度推理鏈旗艦;複雜任務拆解、長鏈邏輯最強 |
| bestFor | 腳本結構規劃、需要想清楚再答的複雜任務 |
| 供應商 | DeepSeek R1 via **NVIDIA NIM**（OpenAI 相容 chat/completions） |
| 舊相容 | `fal-ai/any-llm#deepseek-r1`（LEGACY；model=`deepseek/deepseek-r1`） |
| 情境 | **腳本結構規劃** winner（runner-up Llama 405B） |

**一句話**：整站 LLM 遷移 NIM 後的 **推理旗艦**——輸入 `{ model, prompt }`，佇列由記憶體模擬；目錄標 **0 點／免費額度**，但估點有 **floor 1**（見 §2／§5）。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| 目錄 points | **0** |
| cost | 免費(NVIDIA NIM 免費額度) |
| `parseRealCost` | 無 $ → usdMid=null → 不機械覆寫 |
| `estimatePoints` / `estimatePointsFor` | `Math.max(1, round(0 × rate/31))` → **1** |
| 區段註解 | 「短任務…**固定扣 1 點**與原 any-llm 同口徑」 |
| 校準 | 目錄 **0** vs 實扣路徑 **≥1** → **P0 顯示／扣點落差** |

**結論：** **不**自動改 points（禁令）；產品需決定：要「真 0」則估點／reserve 應允許 0；要「固定 1」則目錄應顯示 1。本卡維持現況並標債。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| L0 契約 | **ok** — id 唯一、endpoint=`nvidia-nim`、`input` 可呼叫 |
| fal OpenAPI | **N/A**（不走 queue.fal.run；bulk stub 寫 fal 404／下架 **誤判**） |
| NIM 客戶端 | `server/services/nvidia-nim.ts`：`POST {NVIDIA_NIM_ENDPOINT}/chat/completions` |
| 預設 host | `https://integrate.api.nvidia.com/v1` |
| 金鑰 | `NVIDIA_NIM_API_KEY`（未設 → `NimServiceError` 人話提示） |
| 本環境 | **無 KEY** → 未跑 `check-nim.ts`／live |
| 生成台路徑 | `isNimModel` → `nimSubmit`／`nimStatus`（記憶體佇列，重啟孤兒由陳屍清掃） |
| 結論 | **ready-static-only**（契約綠；活線待 NIM KEY） |

### 站內 input

```ts
const llmInput = (model: string) => (prompt: string) => ({ model, prompt });
// →
input: llmInput("deepseek-ai/deepseek-r1")
// body: { model: "deepseek-ai/deepseek-r1", prompt: "<user text>" }
```

`nimSubmit` 將 `prompt` 轉 chat `messages`（user）；支援推理欄 `reasoning_content`（OpenAI 相容）。

| 檢查 | 結果 |
|------|------|
| required 形 | model + prompt | **綠** |
| 幽靈 fal 欄 | 無 | OK |
| 422 風險 | 不適用 fal schema；NIM 4xx 不重試 | 金鑰／額度另案 |

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 推理 | R1 長鏈 CoT；輸出可能含 reasoning 摘要 |
| 中文 | 強；簡體傾向——產繁中需提示「繁體中文、台灣用語」 |
| vs 405B | R1 勝結構拆解；405B 勝長文寫作質感（情境分工） |
| 後端預設 | 自動 LLM（導演／助手）預設 **70B**（`NIM_DEFAULT_MODEL`），**不是** R1 |
| 額度 | NIM 免費層：試用次數＋RPM 上限 → `NimServiceError` 人話 |
| 重試 | 5xx／網路最多 3 次；額度／4xx 不重試 |

---

## 5. 站內扣點／退點

```
estimatePointsFor → 1（floor）
→ reserveQuota(1) …
→ nimSubmit({ model: "deepseek-ai/deepseek-r1", prompt })
→ 失敗 refund(1)
```

| 檢查 | 結果 |
|------|------|
| 目錄顯示 0 | 與 est=1 **不一致**（P0） |
| 與註解「固定 1 點」 | 估點路徑 **吻合** |
| BYOK／mock | 另規；本卡不展開 |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| 生成台 LLM 選擇器 | ✅ | flagship |
| 腳本結構規劃情境 | ✅ | winner |
| 導演／助手自動 LLM | △ | 預設 70B，非本 id |
| MCP | ✅ | modelId 含 `#` |
| fal playground | ❌ | 非 fal 模型頁 |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 複雜腳本／長鏈拆解 | ✅ | bestFor |
| 正式長文潤飾 | △ | 可；405B 更偏寫作 |
| 中文金句 | △ | Qwen2.5-72B 情境首選 |
| 大量極短標籤 | ❌ | 用 8B budget |
| 離線無 NIM KEY | ❌ | 服務不可用 |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| 站內碼 | `shared/models.ts` #181；`server/services/nvidia-nim.ts` |
| 自檢 | `npx tsx scripts/check-nim.ts` |
| 目錄 | `docs/模型目錄.md` DeepSeek R1 |
| 生態（舊 fal any-llm） | `docs/fal生態研究.md` DeepSeek R1 列 |
| bulk stub | `cards/nvidia-nim#deepseek-r1.md`（誤 404；以本卡為準） |
| NVIDIA | build.nvidia.com／integrate API 文件 |

---

## 9. 建議動作

- [x] 正名九章卡 `nvidia-nim__deepseek-r1.md`；澄清 **非 fal 404**  
- [x] 確認 input `deepseek-ai/deepseek-r1` 與 `NVIDIA_MODELS` 一致  
- [x] **維持** verified=false；**不**改 points 數值  
- [ ] **P0**：對齊「顯示 0」vs「估點／扣點 floor 1」（改顯示或改估點允許 0）  
- [ ] **P1**：區段註解「固定扣 1 點」與 `points: 0` 同步文案  
- [ ] **L2**（有 `NVIDIA_NIM_API_KEY`）：`check-nim.ts` + 生成台最小 prompt  
- [ ] 清理 bulk 誤檔或改 redirect 註記  

**L0 結論：** NIM 契約綠；bulk 404 判定作廢；**扣點 floor 1** 為主要產品債。  
**未做：** live、改 points、改 verified。
