# fal-ai/luma-dream-machine/ray-2-flash

> 審計：R3 · index **#119** · 模式 **static+research（零 live）** · 2026-08-05  
> slug：`fal-ai__luma-dream-machine__ray-2-flash`  
> **本輪已修** `aspect_ratio`：OpenAPI 無 `1:1` → `1:1` 映射 `16:9` 防 422。**未**改 verified／points。

## 1. 身分

| 項 | 值 |
|----|-----|
| id / endpoint | `fal-ai/luma-dream-machine/ray-2-flash`（`endpointOf` 同字串，無 alias） |
| label | Luma Ray 2 Flash |
| category / kind | **text-to-video** · video |
| tier | **economy** |
| points | **6** |
| cost（目錄） | `$0.2/支` |
| verified | **true**（既有；本回合**未**改 verified、未觸 live） |
| needs | 無（純文生） |
| recommended | **false** |
| strengths | Ray 2 的平價版;保留 Luma 柔順運鏡美感 |
| bestFor | 意境空鏡的日常主力、快迭代 |
| 供應商 | Luma AI Dream Machine **Ray2 Flash** · fal 託管 queue |
| 姊妹 | 旗艦 t2v `…/ray-2`（16 點）；Flash／旗艦 **i2v**；Modify／Flash Modify（v2v） |

**一句話**：Luma 意境運鏡的 **經濟日常檔**——同家族旗艦的約 2.5 折（$0.2 vs $0.5 base）；預設仍是 **540p／5s**，不是 1080p 成片畫質。

## 2. 數值

| 項目 | 值 |
|------|-----|
| points | **6** |
| cost（目錄） | `$0.2/支` |
| 官方價與單位（OpenAPI description） | **Base 對應預設 540p／5s**；**9s 約 2×**；**720p 2×**、**1080p 4×**（相對同長 base） |
| 解析／`parseRealCost` | `usdMid: 0.2` · `multiplier: ×1（單支）` · unitNote 對齊「/支」 |
| `realPricePoints` | `0.2 × 1 × 31 = 6.2` → **round 6**（與目錄一致） |
| `estimatePoints`（扁平） | **6**（不隨 duration／resolution 變動） |
| 估值 NT$（1 點≈NT$1） | **≈ NT$6.2**（校準報告 6.2 ≈） |
| 站內實際送出 | **不送** `duration`／`resolution` → 官方預設 **`5s` + `540p`** → 恰對 base $0.2 |
| 校準判定 | **≈**（前提：維持預設 540p／5s） |

**階梯示意（官方倍率，非站內扣點）**

| 設定 | 約 USD | 約 NT$（×31） | vs 固定 6 點 |
|------|--------|---------------|---------------|
| 5s · 540p（預設／現況） | 0.20 | 6.2 | **≈** |
| 5s · 720p | ~0.40 | 12.4 | 低估 ~半 |
| 5s · 1080p | ~0.80 | 24.8 | 嚴重低估 |
| 9s · 540p | ~0.40 | 12.4 | 低估 ~半 |
| 9s · 1080p | ~1.60 | 49.6 | 極嚴重低估 |

**對照**：旗艦 Ray-2 `$0.5/5s@540p` → 16 點；本檔 6 點溢價結構合理。

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| 靜態契約（L0，修後） | **ok** — `MODELS` 唯一 id、必填欄齊、input 可呼叫 |
| OpenAPI（研究） | **HTTP 200** · `GET …/openapi.json?endpoint_id=fal-ai/luma-dream-machine/ray-2-flash` · `LumaDreamMachineRay2FlashInput`／`Ray2TextToVideoRequest` |
| dry-run / live | 本環境無 FAL_KEY；**未** `--yes`；L2／L4 **未跑** |
| playground | `https://fal.ai/models/fal-ai/luma-dream-machine/ray-2-flash`（HTML 429；OpenAPI 已交叉） |
| 結論 | **ready-static-only** — 契約修齊；verified 已 true |

## 4. 底層邏輯

### 4.1 站內力學

| 層 | 說明 |
|----|------|
| `modelMechanicsFor` | **family: `dit`** · 時序 DiT（luma 正則） |
| 文字塔 | `textEncoderProfileFor` → **`video-closed`** |
| 輸出 | OpenAPI：`video`（File.url） |

### 4.2 官方 OpenAPI 摘要（2026-08-05）

- **Queue**: `https://queue.fal.run`
- **required**: 僅 `prompt`（minLength **3**，maxLength **5000**）
- **properties**（`x-fal-order-properties`）:
  - `prompt` — string
  - `aspect_ratio` — enum **`16:9`｜`9:16`｜`4:3`｜`3:4`｜`21:9`｜`9:21`**，default `16:9`（**無 1:1**）
  - `loop` — boolean，default **false**
  - `resolution` — enum **`540p`｜`720p`｜`1080p`**，default **`540p`**
  - `duration` — enum **`5s`｜`9s`**，default **`5s`**
- **Output**: `video`（required）
- **無**：`negative_prompt` / `seed` / `image_url` / 原生音訊

### 4.3 站內 `input()` vs 官方

**修前**（`aspect(f)` 直通）：

| format | body | schema |
|--------|------|--------|
| `16:9` | `aspect_ratio: "16:9"` | ✅ |
| `9:16` | `aspect_ratio: "9:16"` | ✅ |
| `1:1` | `aspect_ratio: "1:1"` | ❌ **非法 enum → 422 風險** |

**修後**：

```ts
input: (p, f) => ({ prompt: p, aspect_ratio: f === "1:1" ? "16:9" : f })
```

| format | 修後 body | OpenAPI |
|--------|-----------|---------|
| `16:9` | `{ prompt, aspect_ratio: "16:9" }` | ✅ |
| `9:16` | `{ prompt, aspect_ratio: "9:16" }` | ✅ |
| `1:1` | `{ prompt, aspect_ratio: "16:9" }` | ✅ 映射（社群方形改橫式出片） |

| 能力 | 站內 | 官方 | 備註 |
|------|------|------|------|
| `prompt` | ✅ | required 3–5000 | 過短可能 422 |
| `aspect_ratio` | ✅ 修後三 format 合法 | 無 1:1 | **已 P0 修** |
| `duration`／`resolution` | ❌ 不送 | 預設 5s／540p | 與 6 點校準一致 |
| `loop` | ❌ 不送 | false | 可選 |
| `negative_prompt`／`seed` | 不送 | schema 無 | **正確** |

**契約健康度（修後）**：**優**（16:9／9:16；1:1 安全映射）。殘差：畫質預設 540p 與「旗艦美感」文案易誤判；高解析／9s 未動態估點。

### 4.4 generationCore 路徑

- `model.input` → 上表 body  
- `supportsNegativePrompt===false` → 不附加 negative  
- 扣點扁平 6 → `reserveQuota`  
- endpoint = id → `falSubmit("fal-ai/luma-dream-machine/ray-2-flash", …)`

## 5. 站內點數

| 項 | 說明 |
|----|------|
| 目錄 points | **6**（`realPricePoints` 一致） |
| 預估／扣點 | 扁平 6；與 prompt 無關 |
| 與官方 | base $0.2×31≈6.2 → **≈6**，**無需調點**（預設 5s／540p） |
| BYOK | 自備 key 可 0 點（通用） |

## 6. 情境與可用性

| 情境 | 適配 | 說明 |
|------|------|------|
| 意境空鏡日常迭代（純文字） | ✅ | bestFor 對味；比旗艦 16 點更適合量產試片 |
| 莊嚴療癒（有首格圖） | △ | 配方首選 **i2v** 旗艦／Flash i2v，非本 t2v |
| 原生對白／BGM | ❌ | 無原生音；需後製或改有聲 t2v |
| 畫面內中文字 | ❌ | 影片族不可靠 |
| 社群 1:1 專案 | ⚠️→✅ | 修後改送 16:9（橫式）；非真方形 |
| 手動／助手／MCP | ✅ | verified true；economy 6 點 budget 友好 |

## 7. MCP / 文件

| 項 | 值 |
|----|-----|
| 文件 | [fal 模型頁](https://fal.ai/models/fal-ai/luma-dream-machine/ray-2-flash) |
| OpenAPI | `…/openapi.json?endpoint_id=fal-ai/luma-dream-machine/ray-2-flash` |
| 定價摘要 | base **$0.20／支 @ 540p 5s**；9s 2×；720p 2×、1080p 4× |

```json
{
  "projectId": "<uuid>",
  "modelId": "fal-ai/luma-dream-machine/ray-2-flash",
  "prompt": "Slow cinematic drift over misty mountains at dawn, soft golden light, elegant camera, natural physics, no text"
}
```

## 8. 建議動作

- [x] **已修 input**（1:1→16:9）
- [x] **維持** points=6、cost、verified=true
- [ ] 調 points — **不需要**（預設校準 ≈）
- [ ] verified — **已是 true**；禁止本輪改動
- [ ] 下架 — **否**
- [ ] cost 文案 — **P3**：補「540p 5s 基準；720p／1080p／9s 倍率」
- [ ] 若開高解析／9s — **必須**連動 `estimatePoints`
- [ ] L4 live — 控費：`verify-models.ts --probe` 後人工 `--yes`（約 6 點／~$0.20）

| 級 | 項 |
|----|-----|
| P0 | ~~1:1 非法 enum~~ **已修** |
| P3 | cost 註明 540p／5s 與倍率 |
| — | **不**納 SEED／NEGATIVE allowlist（schema 無） |

## 9. 來源

1. OpenAPI Queue 2026-08-05：`endpoint_id=fal-ai/luma-dream-machine/ray-2-flash`  
2. 定價：OpenAPI description 倍率 + 目錄 `$0.2/支` + 校準報告 6.2 ≈  
3. `shared/models.ts` entry／修後 input  
4. 姊妹卡 `#108` Ray-2；`docs/fal生態研究.md`；`docs/點數校準報告.md`  

---

**R3 checklist（#119）**

- [x] L0 靜態契約  
- [x] OpenAPI 200／定價研究（無 `--yes`）  
- [x] 點數校準（含高解析低估風險）  
- [x] input vs schema（**已修 1:1**）  
- [x] 九章卡 + `_index` + lock heartbeat  
- [x] **未**改 verified／points；**未** live

## L2 live（2026-08-05）

| 項 | 值 |
|----|-----|
| requestId | `019fd095-193e-7c41-a3ad-d17ce77ea855` |
| 結果 | **success** · mp4 |
| artifact | https://v3b.fal.media/files/b/0aa51586/ChbLVamieq0jg2QfjQE6q_output.mp4 |
| pointsEst | 6 |
| verified | 目錄 true；**本輪不改** |
