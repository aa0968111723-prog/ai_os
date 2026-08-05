# fal-ai/hunyuan-video

> 審計：R · index **#125** · static+research · 2026-08-05  
> slug：`fal-ai__hunyuan-video`  
> **本輪已修 input**：`aspect_ratio` 僅 `16:9`\|`9:16` → **1:1 映射 16:9** 防 422。  
> **本輪已修 allowlist**：初代 OpenAPI **無** `negative_prompt` → 自 `NEGATIVE_PROMPT_SUPPORTED` 移除（1.5 仍保留）。  
> **未**改 verified／points。零 live。禁止 `--yes`。

## 1. 身分

| 項 | 值 |
|----|-----|
| 站內 id / endpoint | `fal-ai/hunyuan-video`（`endpointOf` 同字串，無 alias） |
| label | Hunyuan Video(騰訊開源) |
| category / kind | **text-to-video** · video |
| tier | **budget** |
| points | **12** |
| cost | `$0.40/支` |
| verified | **true**（既有；本輪未改） |
| needs | 無 |
| recommended | false |
| strengths | 騰訊開源大模型;動態自然、開源生態豐 |
| bestFor | 日常空鏡、抽象動態;自訓 LoRA 底模 |
| 供應商 | 騰訊混元 · fal 託管 queue |
| 姊妹 | 1.5 t2v `fal-ai/hunyuan-video-v1.5/text-to-video`（$0.075/秒·12 點）；i2v `fal-ai/hunyuan-video-image-to-video`；LoRA 訓練 `…-lora-training` |

**一句話**：混元 **初代** 文生影片——**固定 $0.40/支**、預設 **720p／129 幀**；開源 LoRA 生態底模；**1:1 曾會 422**（已修）。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| points | **12** |
| cost（目錄） | `$0.40/支` |
| `parseRealCost` | usdMid=**0.40** · multiplier **×1**（/支） |
| `realPricePoints` | `0.40 × 1 × 31 = 12.4` → **round 12** |
| `estimatePoints` | 扁平 **12** |
| 校準 | **≈** 對固定支價 |

### 幀／解析（OpenAPI 預設；站內不送 → 吃預設）

| 項 | OpenAPI | 估點影響 |
|----|---------|----------|
| `num_frames` | enum **`129`\|`85`**，default **129** | 固定兩檔；非按秒 |
| `resolution` | `480p`\|`580p`\|`720p`，default **`720p`** | 目錄固定支價 → 升解析不改站內扣點 |
| `pro_mode` | default **false**（35 steps；true→55） | 品質開關；價仍 $0.40/支（目錄） |
| 約秒數 | 129 幀@常見 24fps ≈ **5.4s** | 與「/支」計價對齊 |

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| 靜態契約（L0） | **ok** — MODELS 唯一 id、category、input 必填 |
| OpenAPI Queue | **HTTP 200** · `…?endpoint_id=fal-ai/hunyuan-video` · `HunyuanVideoInput`／`…Output` |
| metadata | status **active** · display_name「Hunyuan Video」· category text-to-video · commercial |
| live | **未跑**（無 FAL_KEY；禁止本輪 --yes） |
| 結論 | **ready-static-only**（契約＋OpenAPI 綠；1:1 已修；verified 既有 true 維持） |

### OpenAPI 摘要（2026-08-05 拉取）

- **Queue**：`https://queue.fal.run` · POST `/fal-ai/hunyuan-video`
- **required**：`prompt`
- **properties**：`prompt` · `seed` · `num_frames`（`129`\|`85`）· `aspect_ratio`（**`16:9`\|`9:16` only**）· `resolution` · `pro_mode` · `enable_safety_checker`
- **無** `negative_prompt`（與 1.5 不同）
- **Output**：`video`（File）+ `seed`（required）

### 三比例（修後）

| format | body `aspect_ratio` | schema |
|--------|---------------------|--------|
| 16:9 | `16:9` | ✅ |
| 9:16 | `9:16` | ✅ |
| 1:1 | **映射 `16:9`** | ✅ 防 422（方圖專案得橫幅片） |

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 產品 | 騰訊 Hunyuan Video **初代**——按支、開源權重、LoRA 訓練鏈入口 |
| 站內 mechanics | 影片族；文字窗 `video-closed` |
| input（修後） | `{ prompt, aspect_ratio }` 合法二值；**不**送 resolution／frames／pro_mode → 吃 **720p + 129 幀 + 35 steps** |
| negative | schema **無**；本輪 **已**移出 `NEGATIVE_PROMPT_SUPPORTED`（禁忌只移出正向） |
| seed | schema 有；`SEED_SUPPORTED` **未**收 → 消融不可固定噪聲（可選 P2） |
| 中文 | 提示理解好；**畫面內中文字卡不可靠** |
| vs 1.5 | 1.5 按秒 $0.075、鎖 480p／121 幀；初代固定 $0.40、預設 720p——同級 12 點、解析度初代較高 |

---

## 5. 站內扣點／退點

```
estimatePoints → realPricePoints("$0.40/支") → 0.40×1×31 → 12
→ falSubmit("fal-ai/hunyuan-video", { prompt, aspect_ratio })
→ 失敗 refund(12)
```

| 檢查 | 結果 |
|------|------|
| 顯示／扣／退 | 三者皆 **12** → 內部一致 |
| 對 $0.40/支 | **≈** 對齊 |
| verified true | 失敗仍應 refund |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| t2v 選擇器 | ✅ | budget 檔 |
| MCP | ✅ | modelId＝目錄 id |
| resolution／frames UI | ❌ | 吃預設 720p／129 |
| seed 消融 | △ | schema 有、allowlist 無 |
| 1:1 專案 | △ | 修後得 **16:9 片** |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 日常空鏡／抽象動態 | ✅ | bestFor |
| 自訓 LoRA 底模推論 | ✅ | 開源生態 |
| 莊嚴療癒慢運鏡 | △ | 可；情境表 runner-up 多為 1.5／Luma |
| 720p 成片草稿 | ✅ | 預設 720p |
| 方圖 1:1 成片 | △ | 映射橫幅 |
| 畫面內中文大字 | ❌ | 不可靠 |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| OpenAPI | `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/hunyuan-video`（本輪 **200**） |
| Platform API | `…/v1/models?endpoint_id=…` → status **active** |
| Playground | https://fal.ai/models/fal-ai/hunyuan-video |
| 目錄／生態 | `docs/模型目錄.md`、`docs/fal生態研究.md`（$0.40/支 已查證） |
| 站內碼 | `shared/models.ts` #125 列（本輪 1:1 映射＋neg allowlist） |

---

## 9. 建議動作

- [x] **修 input**：`1:1` → `aspect_ratio: "16:9"` 防 422  
- [x] **修 allowlist**：初代移出 `NEGATIVE_PROMPT_SUPPORTED`（schema 無）  
- [x] **維持** id／endpoint／points=12／verified=true  
- [ ] **可選 P2**：`SEED_SUPPORTED` 加本 id  
- [ ] **可選 P3**：UI 標「預設 720p／~129 幀」；pro_mode 暴露  
- [ ] **L2**（有 KEY）：最小 prompt + 16:9 live 出片  

**L0 結論**：端點 active、OpenAPI 綠、**P0 1:1 已修**、neg 幽靈欄已清；points 對支價 ≈。  
**未做：** live、改 points、改 verified。
