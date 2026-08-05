# fal-ai/hunyuan-video-v1.5/text-to-video

> 審計：R3 · index **#117** · static+research · 2026-08-05  
> slug：`fal-ai__hunyuan-video-v1.5__text-to-video`  
> **本輪已修 input**：`aspect_ratio` 僅 `16:9`\|`9:16` → **1:1 映射 16:9** 防 422。  
> **未**改 verified／points。零 live。

## 1. 身分

| 項 | 值 |
|----|-----|
| 站內 id / endpoint | `fal-ai/hunyuan-video-v1.5/text-to-video`（`endpointOf` 同字串，無 alias） |
| label | Hunyuan Video 1.5(騰訊) |
| category / kind | **text-to-video** · video |
| tier | **economy** |
| points | **12** |
| cost | `$0.075/秒;按秒計費,點數為 6 秒基準` |
| verified | **true**（既有；本輪未改） |
| needs | 無 |
| recommended | false |
| strengths | Hunyuan 升級版;畫質與時序穩定度提升 |
| bestFor | 莊嚴療癒風的空景與慢運鏡 |
| 供應商 | 騰訊混元 · fal 託管 queue |
| 姊妹 | 初代 t2v `fal-ai/hunyuan-video`（$0.40/支）；i2v `fal-ai/hunyuan-video-image-to-video` |

**一句話**：混元 Video **1.5** 文生影片——**鎖定 480p**、約 **121 幀** 經濟檔；站內療癒空鏡 runner-up；**1:1 曾會 422**（已修）。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| points | **12** |
| cost（目錄） | `$0.075/秒;…6 秒基準` |
| `parseRealCost` | `$0.075` × **`PRICE_VIDEO_SECONDS=5`** = **0.375 USD** |
| `usdUnitToPoints` | `0.375 × 31 ≈ 11.625` → **round 12** |
| `estimatePoints` | 扁平 **12** |
| 若真用 6s 文案 | `0.075×6×31 ≈ 13.95` → **14**（與 12 差 2） |
| 校準 | **≈**（對 5s 機械假設）；文案「6 秒基準」與估點 **5s** 脫鉤 → **P1 文案** |

### 時長／幀

| 項 | OpenAPI | 估點影響 |
|----|---------|----------|
| `num_frames` | default **121**、min1、**max 121** | 實質固定 121 幀 |
| 約秒數 | 24fps ≈ **5.0s**；16fps ≈ 7.6s | 與 5s 估點對齊若 ≈24fps |
| `resolution` | **const `480p`** only | 無 720p／1080p 溢價路徑 |

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| 靜態契約（L0） | **ok** — MODELS 唯一 id、category、input 必填 |
| OpenAPI Queue | **HTTP 200** · `…?endpoint_id=fal-ai/hunyuan-video-v1.5/text-to-video` · `HunyuanVideoV15TextToVideoInput`／`…Output` |
| metadata | status **active** · display_name「Hunyuan Video V1.5」· category text-to-video |
| 死 path 抽樣 | `fal-ai/hunyuan-video/v1.5/…`、`hunyuan-video-v1.5/…`（無 fal-ai）→ **404**；正確 id 即目錄 path |
| live | **未跑**（無 FAL_KEY；禁止本輪 --yes） |
| 結論 | **ready-static-only**（契約＋OpenAPI 綠；1:1 已修；verified 既有 true 維持） |

### OpenAPI 摘要（2026-08-05 拉取）

- **Queue**：`https://queue.fal.run` · POST `/fal-ai/hunyuan-video-v1.5/text-to-video`
- **required**：`prompt`
- **order**：prompt → negative_prompt → num_inference_steps → seed → aspect_ratio → resolution → num_frames → enable_prompt_expansion
- `aspect_ratio`：`16:9`\|`9:16` only，default `16:9`（**無 1:1**）
- `resolution`：`const: "480p"`，default `480p`（**鎖死 480p**）
- `num_frames`：1–**121**，default **121**
- `num_inference_steps`：1–50，default **28**
- `negative_prompt`：string，default `""`（站內 **已**收 allowlist）
- `seed`：integer \| null（schema 有；`SEED_SUPPORTED` **未**收 → 消融不可固定噪聲）
- `enable_prompt_expansion`：default **true**
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
| 產品 | 騰訊 Hunyuan Video **1.5**——相對初代改**按秒**、畫質／時序升級 |
| 站內 mechanics | 影片族（`hunyuan-video` 正則）· 文字窗 `video-closed` |
| input（修後） | `{ prompt, aspect_ratio }` 合法二值；**不**送 resolution／frames／steps → 吃 **480p + 121 幀 + steps28 + expansion on** |
| negative | schema 有；`NEGATIVE_PROMPT_SUPPORTED` **已列** |
| seed | schema 有；allowlist 無 → 可選 P2 |
| 中文 | 提示理解好；**畫面內中文字卡不可靠**（全 t2v 通病） |
| vs 初代 | `fal-ai/hunyuan-video` 固定 **$0.40/支** 亦 12 點——1.5 在 5s@0.075 同級扣點、解析度更低但世代較新 |

---

## 5. 站內扣點／退點

```
estimatePoints → realPricePoints("$0.075/秒") → 0.075×5×31 → 12
→ falSubmit("fal-ai/hunyuan-video-v1.5/text-to-video", { prompt, aspect_ratio })
→ 失敗 refund(12)
```

| 檢查 | 結果 |
|------|------|
| 顯示／扣／退 | 三者皆 **12** → 內部一致 |
| 對 5s@480p | **≈** 對齊 |
| 對文案「6 秒」 | 實扣 12 vs 應 ≈14 → **文案債**（非估點 bug） |
| verified true | 失敗仍應 refund |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| t2v 選擇器 | ✅ | economy 檔 |
| 情境「唯美療癒空鏡」 | ✅ | runner-up（winner Luma Ray 2） |
| MCP | ✅ | modelId＝目錄 id |
| resolution／frames UI | ❌ | 鎖死預設 |
| seed 消融 | △ | schema 有、allowlist 無 |
| 1:1 專案 | △ | 修後得 **16:9 片**（產品可接受） |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 莊嚴／療癒空景慢運鏡 | ✅ | bestFor；情境表 runner-up |
| 控成本草稿 t2v | ✅ | 480p 經濟；12 點級 |
| 720p／1080p 成片 | ❌ | schema 僅 480p → 換 Wan／Seedance／Hailuo |
| 方圖 1:1 成片 | △ | 映射橫幅；勿期待真 1:1 |
| 長於 ~5s | ❌ | frames max 121 |
| 畫面內中文大字 | ❌ | 不可靠 |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| OpenAPI | `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/hunyuan-video-v1.5/text-to-video`（本輪 **200**） |
| Platform API | `…/v1/models?endpoint_id=…` → status **active** |
| Playground | https://fal.ai/models/fal-ai/hunyuan-video-v1.5/text-to-video |
| 目錄／生態 | `docs/模型目錄.md`、`docs/fal生態研究.md`（$0.075/秒 已查證） |
| 站內碼 | `shared/models.ts` #117 列（本輪 1:1 映射） |

---

## 9. 建議動作

- [x] **修 input**：`1:1` → `aspect_ratio: "16:9"` 防 422  
- [x] **維持** id／endpoint／points=12／verified=true／negative allowlist  
- [ ] **P1**：cost 文案「6 秒基準」改「5 秒基準」或與 `PRICE_VIDEO_SECONDS` 對齊說明  
- [ ] **可選 P2**：`SEED_SUPPORTED` 加本 id（schema 有 seed）  
- [ ] **可選 P3**：UI 標「僅 480p／約 5s」；strengths 勿暗示高解析  
- [ ] **L2**（有 KEY）：最小 prompt + 16:9 live 出片校幀率與實帳  

**L0 結論**：端點 active、OpenAPI 綠、**P0 1:1 已修**；points 對 5s 機械價 ≈。  
**未做：** live、改 points、改 verified。
