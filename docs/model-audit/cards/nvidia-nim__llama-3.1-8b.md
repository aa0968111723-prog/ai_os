# nvidia-nim#llama-3.1-8b

> 審計：R4 · index **#187** · static+research · 2026-08-05  
> slug：`nvidia-nim__llama-3.1-8b`（**正名**；bulk 誤檔 `nvidia-nim#llama-3.1-8b.md` 僅 stub）  
> **非 fal OpenAPI**——`endpoint: nvidia-nim` → `nimSubmit`／NVIDIA integrate API。  
> **NIM 最後一檔 LLM**；`checkNimStatus` 健康檢查用此 8B。  
> **未**改 verified／points。零 live（無 `NVIDIA_NIM_API_KEY`）。

## 1. 身分

| 項 | 值 |
|----|-----|
| index | **187** |
| 站內 id | `nvidia-nim#llama-3.1-8b` |
| endpoint | **`nvidia-nim`** |
| NIM model 字串 | **`meta/llama-3.1-8b-instruct`**（`llmInput`／`NVIDIA_MODELS.llama3_8b`） |
| label | Llama 3.1 8B |
| category / kind | **llm** · text |
| tier | **budget** |
| points（目錄） | **0** |
| cost | `免費(NVIDIA NIM 免費額度)` |
| verified | **false** |
| needs | 無 |
| recommended | false |
| strengths | 最低成本文字生成;速度極快 |
| bestFor | 大量簡單任務(標籤、分類) |
| 供應商 | Meta **Llama 3.1 8B Instruct** via NIM |
| 姊妹 | 70B（預設／recommended）、405B（寫作）、Qwen（中文） |

**一句話**：**最低成本／最快** budget LLM——標籤分類與大量簡單任務；目錄 **0 點**，估點 **floor 1**（NIM 共債）。

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
| 字串對齊 | `llama3_8b` ≡ input | **綠** |
| 健康檢查 | `checkNimStatus` **固定**呼叫本 model（`maxTokens: 10`） |
| 本環境 | 無 KEY → 未 live |
| 生成台 | `nimSubmit`／`nimStatus` |
| 結論 | **ready-static-only** |

### 站內 input

```ts
input: llmInput("meta/llama-3.1-8b-instruct")
// → { model: "meta/llama-3.1-8b-instruct", prompt }
```

| 檢查 | 結果 |
|------|------|
| model + prompt | **綠** |
| 幽靈欄 | 無 |

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 定位 | 最低成本、速度極快；大量簡單任務（標籤、分類） |
| vs 70B | 70B＝日常主力／後端預設；本檔＝budget 吞吐 |
| vs 405B | 405B 寫作品質；本檔不適長文／精修 |
| 維運 | `scripts/check-nim.ts`／`checkNimStatus` 用 8B 探 ping（成本最低） |
| 額度 | NIM 免費層 RPM／試用上限 |

---

## 5. 站內扣點／退點

```
estimatePointsFor → 1
→ reserveQuota(1)
→ nimSubmit({ model: "meta/llama-3.1-8b-instruct", prompt })
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
| 生成台 LLM | ✅ | budget |
| 情境 pick 首選 | ❌ | 未見 winner 軸 |
| 後端自動預設 | ❌ | 70B |
| 維運 checkNimStatus | ✅ | 探 ping 專用 |
| fal 模型頁 | ❌ | 非 fal |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 標籤／分類／短標大量吞吐 | ✅ | bestFor |
| 標題改寫日常 | △ | 70B recommended 更穩 |
| 長鏈推理／寫作旗艦 | ❌ | R1／405B |
| 中文金句 | ❌ | Qwen |
| 無 NIM KEY | ❌ | 不可用 |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| `shared/models.ts` | #187 · tier budget |
| `server/services/nvidia-nim.ts` | `llama3_8b` · `checkNimStatus` |
| `docs/模型目錄.md` | 最低成本列 |
| bulk stub | `cards/nvidia-nim#llama-3.1-8b.md`（誤 404；以本卡為準） |
| 姊妹 | `nvidia-nim__llama-3.1-70b.md` · `nvidia-nim__mistral-large-2.md` |

---

## 9. 建議動作

- [x] 正名九章卡；澄清非 fal 404  
- [x] model 字串與 `NVIDIA_MODELS` 一致  
- [x] 維持 verified=false；不改 points  
- [ ] **P0**（全 NIM #181–187）：顯示 0 vs 估點 floor 1  
- [ ] **L2**（有 NIM KEY）：短標籤／分類 prompt  
- [ ] 清理 bulk `#` 誤檔  

**L0 結論：** 契約綠；budget 定位清楚；NIM LLM 段 **#181–187 正名齊**；扣點共債仍開。  
**未做：** live、改 points、改 verified。
