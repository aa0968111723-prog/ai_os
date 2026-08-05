# nvidia-nim#qwen2.5-72b

> 審計：R4 · index **#185** · static+research · 2026-08-05  
> slug：`nvidia-nim__qwen2.5-72b`（**正名**；bulk 誤檔 `nvidia-nim#qwen2.5-72b.md` 僅 stub）  
> **非 fal OpenAPI**——`endpoint: nvidia-nim` → `nimSubmit`／NVIDIA integrate API。  
> **未**改 verified／points。零 live（無 `NVIDIA_NIM_API_KEY`）。

## 1. 身分

| 項 | 值 |
|----|-----|
| index | **185** |
| 站內 id | `nvidia-nim#qwen2.5-72b` |
| endpoint | **`nvidia-nim`** |
| NIM model 字串 | **`qwen/qwen2.5-72b-instruct`**（`llmInput`／`NVIDIA_MODELS.qwen2_5_72b`） |
| label | Qwen2.5 72B(中文) |
| category / kind | **llm** · text |
| tier | **economy** |
| points（目錄） | **0** |
| cost | `免費(NVIDIA NIM 免費額度)` |
| verified | **false** |
| needs | 無 |
| recommended | false |
| strengths | 阿里通義開源檔;中文語感第一梯隊、繁中穩定 |
| bestFor | 中文金句、弘法文案、中文改寫潤飾 |
| 供應商 | 阿里 **Qwen2.5 72B Instruct** via NIM |
| 舊相容 | `fal-ai/any-llm#qwen2.5-72b`（LEGACY；同 model 字串） |
| 工作流 | 多 preset「摘金句」步綁本 id |
| 情境 | **中文金句** winner（runner-up Llama 70B） |

**一句話**：**中文語感第一梯隊** 的站內 LLM——金句／弘法文案主力；目錄 **0 點**，估點 **floor 1**（NIM 共債）。

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
| 字串對齊 | `qwen2_5_72b` ≡ input | **綠** |
| LEGACY any-llm | 同 `qwen/qwen2.5-72b-instruct`（endpoint 不同） |
| 本環境 | 無 KEY → 未 live |
| 生成台 | `nimSubmit`／`nimStatus` |
| 結論 | **ready-static-only** |

### 站內 input

```ts
input: llmInput("qwen/qwen2.5-72b-instruct")
// → { model: "qwen/qwen2.5-72b-instruct", prompt }
```

| 檢查 | 結果 |
|------|------|
| model + prompt | **綠** |
| 幽靈欄 | 無 |

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 中文 | 通義系；目錄標繁中穩定；金句／弘法文案定位 |
| vs 70B | 70B＝後端預設／英文平衡；本檔＝中文場景首選 |
| vs R1／405B | 非長鏈推理／非最大寫作檔；中文短文與金句勝出 |
| 工作流 | 「從內容擷取 20 字內金句」模板多處綁定 |
| 額度 | NIM 免費層 RPM／試用上限 |

---

## 5. 站內扣點／退點

```
estimatePointsFor → 1
→ reserveQuota(1)
→ nimSubmit({ model: "qwen/qwen2.5-72b-instruct", prompt })
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
| 中文金句情境 | ✅ | **winner** |
| 工作流摘金句 | ✅ | 多 preset |
| 後端自動預設 | ❌ | 預設 70B 非本 id |
| fal 模型頁 | ❌ | 非 fal |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 中文金句／弘法文案 | ✅ | bestFor · 情境首選 |
| 中文改寫潤飾 | ✅ | strengths |
| 日常英文短標 | △ | 70B 亦可 |
| 長鏈腳本拆解 | △ | R1 |
| 無 NIM KEY | ❌ | 不可用 |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| `shared/models.ts` | #185 · workflow · 情境 pick |
| `server/services/nvidia-nim.ts` | `qwen2_5_72b` |
| LEGACY | `fal-ai/any-llm#qwen2.5-72b` |
| bulk stub | `cards/nvidia-nim#qwen2.5-72b.md`（誤 404；以本卡為準） |
| 姊妹 | `nvidia-nim__llama-3.1-70b.md`（#184） |

---

## 9. 建議動作

- [x] 正名九章卡；澄清非 fal 404  
- [x] model 字串與 `NVIDIA_MODELS` 一致  
- [x] 維持 verified=false；不改 points  
- [ ] **P0**（全 NIM）：顯示 0 vs 估點 floor 1  
- [ ] **L2**（有 NIM KEY）：繁中金句短 prompt  
- [ ] 清理 bulk `#` 誤檔  

**L0 結論：** 契約綠；中文場景定位清楚；扣點共債仍開。  
**未做：** live、改 points、改 verified。
