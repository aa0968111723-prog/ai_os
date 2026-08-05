# nvidia-nim#llama-3.1-70b

> 審計：R4 · index **#184** · static+research · 2026-08-05  
> slug：`nvidia-nim__llama-3.1-70b`（**正名**；bulk 誤檔 `nvidia-nim#llama-3.1-70b.md` 僅 stub）  
> **非 fal OpenAPI**——`endpoint: nvidia-nim` → `nimSubmit`／NVIDIA integrate API。  
> **本檔＝`NIM_DEFAULT_MODEL`**（導演／助手／彙總後端預設）。  
> **未**改 verified／points。零 live（無 `NVIDIA_NIM_API_KEY`）。

## 1. 身分

| 項 | 值 |
|----|-----|
| index | **184** |
| 站內 id | `nvidia-nim#llama-3.1-70b` |
| endpoint | **`nvidia-nim`** |
| NIM model 字串 | **`meta/llama-3.1-70b-instruct`**（`llmInput`／`NVIDIA_MODELS.llama3_70b`／**`NIM_DEFAULT_MODEL` 預設**） |
| label | Llama 3.1 70B |
| category / kind | **llm** · text |
| tier | **economy** |
| points（目錄） | **0** |
| cost | `免費(NVIDIA NIM 免費額度)` |
| verified | **false** |
| needs | 無 |
| **recommended** | **true**（生成台推薦） |
| strengths | 品質/成本平衡的日常主力(後端自動 LLM 亦預設此檔) |
| bestFor | 標題、短文案、日常改寫 |
| 供應商 | Meta **Llama 3.1 70B Instruct** via NIM |
| 工作流 | 部分 preset「腳本潤飾」步 |
| 情境 | 中文金句等 pick **runner-up**（winner Qwen2.5-72B） |

**一句話**：**整站文字 LLM 預設引擎**——品質／成本平衡；目錄 **0 點**，估點 **floor 1**（NIM 共債）。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| 目錄 points | **0** |
| cost | 免費(NVIDIA NIM 免費額度) |
| `parseRealCost` | 無 $ → 不機械覆寫 |
| `estimatePoints`／`estimatePointsFor` | **1**（floor） |
| 校準 | 顯示 **0** vs 扣點 **≥1** → **P0**（#181–187 共債） |

**結論：** 維持 0；不自動改 points。後端自動呼叫與生成台同一估點規則時亦可能扣 1（依呼叫端是否走 reserveQuota）。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| L0 契約 | **ok** |
| fal OpenAPI | **N/A**（bulk fal404 **誤判**） |
| NIM | `POST …/chat/completions` |
| 字串對齊 | `llama3_70b` ≡ input ≡ `NIM_DEFAULT_MODEL` 後備 | **綠** |
| 環境覆寫 | `NVIDIA_NIM_MODEL` 可整站切預設（**不改**本目錄 id） |
| 本環境 | 無 KEY → 未 live／`check-nim` |
| 生成台 | `nimSubmit`／`nimStatus` |
| 結論 | **ready-static-only**（但後端依賴面最廣） |

### 站內 input

```ts
input: llmInput("meta/llama-3.1-70b-instruct")
// → { model: "meta/llama-3.1-70b-instruct", prompt }
```

| 檢查 | 結果 |
|------|------|
| model + prompt | **綠** |
| 與 `NIM_DEFAULT_MODEL` | 同字串（未設 env 時） | **綠** |

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 定位 | 日常主力；非 405B 寫作天花板、非 R1 長鏈推理 |
| 後端 | 導演建議／拆分鏡／專案助手／留言@／團隊彙總等 **預設** 此 model |
| vs 8B | 8B＝budget 極速；70B＝推薦日常 |
| vs Qwen 72B | 中文金句情境 Qwen 勝；本檔 runner-up |
| 額度 | 高頻後端呼叫最易觸 NIM RPM／試用上限 |
| 重試 | 5xx／網路最多 3 次；額度不重試 |

---

## 5. 站內扣點／退點

```
estimatePointsFor → 1
→ reserveQuota(1)   // 生成台路徑
→ nimSubmit({ model: "meta/llama-3.1-70b-instruct", prompt })
→ 失敗 refund(1)
```

| 檢查 | 結果 |
|------|------|
| 目錄 recommended + 0 點 | 易被理解為「免費無限」；實扣 floor 1 | **P0 文案** |
| 後端助手路徑 | 各 router 自管 mock／扣點；不全等同生成台 | 文件債 |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| 生成台 LLM | ✅ | **recommended** |
| 後端自動 LLM | ✅ | **預設 model**（非目錄 id 字串，是 NIM model 名） |
| 工作流潤飾步 | ✅ | 部分 preset |
| 中文金句情境 | ✅ | runner-up |
| fal 模型頁 | ❌ | 非 fal |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 標題／短文案／日常改寫 | ✅ | bestFor |
| 後端助手預設 | ✅ | `NIM_DEFAULT_MODEL` |
| 正式長文旗艦 | △ | 改 405B |
| 長鏈推理 | △ | R1 |
| 中文金句首選 | △ | Qwen2.5-72B |
| 無 NIM KEY | ❌ | 整站文字服務降級 |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| `shared/models.ts` | #184 · recommended · workflow |
| `server/services/nvidia-nim.ts` | `llama3_70b` · `NIM_DEFAULT_MODEL` |
| `scripts/check-nim.ts` | 連線自檢（探測預設模型） |
| bulk stub | `cards/nvidia-nim#llama-3.1-70b.md`（誤 404；以本卡為準） |
| 姊妹 | `#181` R1 · `#182` 405B · `#187` 8B |

---

## 9. 建議動作

- [x] 正名九章卡；澄清非 fal 404  
- [x] 標註 **NIM_DEFAULT_MODEL** 身份  
- [x] 維持 verified=false／recommended=true／points=0  
- [ ] **P0**（全 NIM）：顯示 0 vs 估點 floor 1  
- [ ] **P1**：後端助手扣點策略與生成台對照文件化  
- [ ] **L2**（有 NIM KEY）：`check-nim.ts` + 生成台短 prompt  
- [ ] 清理 bulk `#` 誤檔  

**L0 結論：** 契約綠；**預設引擎**身份明確；扣點共債仍開。  
**未做：** live、改 points、改 verified。
