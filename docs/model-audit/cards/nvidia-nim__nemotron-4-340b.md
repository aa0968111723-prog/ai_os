# nvidia-nim#nemotron-4-340b

> 審計：R4 · index **#183** · static+research · 2026-08-05  
> slug：`nvidia-nim__nemotron-4-340b`（**正名**；bulk 誤檔 `nvidia-nim#nemotron-4-340b.md` 僅 stub）  
> **非 fal OpenAPI**——`endpoint: nvidia-nim` → `nimSubmit`／NVIDIA integrate API。  
> **未**改 verified／points。零 live（無 `NVIDIA_NIM_API_KEY`）。

## 1. 身分

| 項 | 值 |
|----|-----|
| index | **183** |
| 站內 id | `nvidia-nim#nemotron-4-340b` |
| endpoint | **`nvidia-nim`**（LLM 族共用） |
| NIM model 字串 | **`nvidia/nemotron-4-340b-instruct`**（`llmInput`／`NVIDIA_MODELS.nemotron`） |
| label | Nemotron-4 340B |
| category / kind | **llm** · text |
| tier | **flagship** |
| points（目錄） | **0** |
| cost | `免費(NVIDIA NIM 免費額度)` |
| verified | **false** |
| needs | 無 |
| recommended | false |
| strengths | NVIDIA 自家旗艦;指令對齊佳、輸出穩定 |
| bestFor | 腦力激盪、多版本文案 |
| 供應商 | **NVIDIA Nemotron-4 340B Instruct** via NIM |
| 姊妹 | R1（#181 推理）、Llama 405B（#182 寫作）、70B 日常預設 |

**一句話**：NVIDIA **自家** 340B 指令旗艦——穩定對齊、多版本文案；目錄 **0 點**，估點 **floor 1**（NIM 共債）。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| 目錄 points | **0** |
| cost | 免費(NVIDIA NIM 免費額度) |
| `parseRealCost` | 無 $ → 不機械覆寫 |
| `estimatePoints`／`estimatePointsFor` | **1**（`Math.max(1, …)`） |
| 校準 | 顯示 **0** vs 扣點路徑 **≥1** → **P0**（#181–187 共債） |

**結論：** 維持 0／不自動改 points。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| L0 契約 | **ok** |
| fal OpenAPI | **N/A**（bulk「fal 404」**誤判**） |
| NIM | `POST …/chat/completions` · model 上表 |
| 字串對齊 | `NVIDIA_MODELS.nemotron` ≡ 站內 input | **綠** |
| 本環境 | 無 KEY → 未 live |
| 生成台 | `isNimModel` → `nimSubmit`／`nimStatus` |
| 結論 | **ready-static-only** |

### 站內 input

```ts
input: llmInput("nvidia/nemotron-4-340b-instruct")
// → { model: "nvidia/nemotron-4-340b-instruct", prompt }
```

| 檢查 | 結果 |
|------|------|
| model + prompt | **綠** |
| 幽靈欄 | 無 |

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 定位 | NVIDIA 第一方旗艦；指令對齊／輸出穩定敘事 |
| vs R1 | 非長鏈 CoT 專精；偏穩文案與多版本 |
| vs 405B | 同旗艦檔；405B Meta 寫作品質、本檔 NVIDIA 對齊 |
| 後端預設 | 自動 LLM 用 **70B**，非本 id |
| 額度 | NIM 免費層 RPM／試用上限 → `NimServiceError` |

---

## 5. 站內扣點／退點

```
estimatePointsFor → 1
→ reserveQuota(1)
→ nimSubmit({ model: "nvidia/nemotron-4-340b-instruct", prompt })
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
| 生成台 LLM | ✅ | flagship |
| 腳本結構規劃情境 | ❌ | pick 為 R1／405B |
| 自動導演／助手 | △ | 預設 70B |
| fal 模型頁 | ❌ | 非 fal |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 腦力激盪／多版本文案 | ✅ | bestFor |
| 正式長文腳本 | △ | 405B 更常被 workflow 綁定 |
| 長鏈推理拆解 | △ | R1 |
| 中文金句 | △ | Qwen2.5-72B |
| 無 NIM KEY | ❌ | 不可用 |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| `shared/models.ts` | #183 |
| `server/services/nvidia-nim.ts` | `nemotron` |
| `docs/模型目錄.md` | 旗艦列 |
| bulk stub | `cards/nvidia-nim#nemotron-4-340b.md`（誤 404；以本卡為準） |
| 姊妹 | `nvidia-nim__deepseek-r1.md`、`nvidia-nim__llama-3.1-405b.md` |

---

## 9. 建議動作

- [x] 正名九章卡；澄清非 fal 404  
- [x] model 字串與 `NVIDIA_MODELS` 一致  
- [x] 維持 verified=false；不改 points  
- [ ] **P0**（全 NIM）：顯示 0 vs 估點 floor 1  
- [ ] **L2**（有 NIM KEY）：短 prompt 出文  
- [ ] 清理 bulk `#` 誤檔  

**L0 結論：** 契約綠；NIM 扣點共債仍開。  
**未做：** live、改 points、改 verified。
