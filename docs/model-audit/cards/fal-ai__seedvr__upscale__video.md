# fal-ai/seedvr/upscale/video

> 審計：R4 · index **#164** · static+research · **零 live** · 2026-08-05  
> slug：`fal-ai__seedvr__upscale__video` · 單一真相：`shared/models.ts`

## 1. 身分

| 欄位 | 值 |
|------|-----|
| id / endpoint | `fal-ai/seedvr/upscale/video`（`endpointOf` = id，無 alias） |
| label | SeedVR2 影片放大(字節) |
| category | `video-to-video`（影片轉影片） |
| tier | **economy** |
| kind | `video` |
| points | **12** |
| cost | `$0.001/百萬像素(寬×高×幀數);點數以 6 秒 1080p 30fps 估` |
| verified | **false** |
| recommended | **false** |
| needs | **video**（要放大的影片網址） |
| secondaryNeeds | （無） |
| sourceHint | 要放大的影片網址 |
| strengths | 擴散式放大單價極低、可到 4K;批次修復划算 |
| bestFor | 整批歷史影音放大;Topaz 留成品 |
| 供應商／底層 | **ByteDance SeedVR2** via fal.ai（group `seedvr2`／Upscale Video；tags `upscale`；license **commercial**） |
| 角色定位 | 站內 **影片超分經濟檔**（vs 旗艦 `fal-ai/topaz/upscale/video`、輕量 `fal-ai/video-upscaler`）；`sc-video-restore` pickIds **第二順位** |

**一句話**：來源影片 **空間超分**（video → video，可 2×／目標 720p–2160p）；官方按 **輸出** 寬×高×幀數 的百萬像素計費 **$0.001/MP**；站內固定 **12 點** ≈ 6 秒 1080p30 輸出。

**L0 靜態契約：** **ok**  
- 必填欄齊；`category ∈ CATEGORIES`；id 唯一；`input` 可呼叫。  
- `needs=video` + `input → { video_url }` 與 OpenAPI required（僅 `video_url`）對齊。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| points（目錄扁平） | **12** |
| cost 字串 | `$0.001/百萬像素(寬×高×幀數);點數以 6 秒 1080p 30fps 估` |
| 官方價（fal 模型頁） | **$0.001 per megapixel of video data (width × height × frames)** |
| 計費性質 | **輸出** 總像素量（官方例：1920×1080×121 幀 ≈ **$0.25**） |
| `parseRealCost` | usdMid=**0.001**；影片 MP → multiplier=**null** → unitNote「影片按總像素×幀數計費，需人工換算」 |
| `realPricePoints` | **null**（不機械覆寫；保留人工 12） |
| 匯率 | USD×**31** ≈ NT$ |
| 校準報告列 | SeedVR2 影片放大 ⚠︎ · 12 · 判定 **需人工** |

### 2.1 粗估（$0.001／輸出 MP，匯率 31）

| 輸出假設 | 約 MP | USD | 約 NT$ | vs 固定 12 點 |
|----------|------|-----|--------|---------------|
| **6s 1080p 30fps**（cost 文案基準） | **373.2** | **0.373** | **11.57** | **≈12 對齊** |
| 6s 720p 30fps | 165.9 | 0.166 | 5.14 | 固定偏貴 |
| 6s 1080p 24fps | 298.6 | 0.299 | 9.26 | 略偏貴 |
| 6s 4K 30fps（2160p） | 1493 | 1.493 | 46.3 | **偏低 ~34 點** |
| 10s 4K 30fps（生態研究「≈$2.5」） | 2488 | 2.488 | 77.1 | 偏低嚴重 |
| 60s 1080p 30fps | 3732 | 3.73 | 116 | 長片倒掛 |
| **預設 factor=2**：源 1080p → 出 4K 6s30 | 1493 | 1.493 | 46.3 | **站內仍扣 12 → 平台吃虧** |
| 預設 factor=2：源 720p → 出 1440p 6s30 | 663.6 | 0.664 | 20.6 | 偏低 ~9 點 |

**解讀**

1. **points=12** 在數學上 **等於** `round(1920×1080×30×6 / 1e6 × $0.001 × 31)` → **round(11.57)=12**。文案「6 秒 1080p 30fps」與點數 **一致**。  
2. 官方計費是 **輸出** 尺寸（模型頁例證）；cost 寫「寬×高×幀數」未明示 in/out——建議文案補 **「按輸出」**。  
3. 站內 `input` **只傳 `video_url`** → fal 預設 `upscale_mode=factor`、`upscale_factor=2` → **常見 1080p 源會變 4K**，真實帳單 ≈ **46 點等值**，固定 12 **嚴重低估**。  
4. 與 **Topaz**（$0.01–0.08/秒）：同 6s→1080p Topaz 約 **$0.12（~4 點）**、→4K 約 **$0.48（~15 點）**；SeedVR 同條件 **$0.37 / $1.49**。**「比 Topaz 省」在 1080p／4K 實價上不成立**（見 §6／§8）。

**結論（L2 定價）：** 官方 $0.001/MP **已查證**；**points=12 對 6s1080p30 輸出基準正確**；**勿改 points**（本回合禁止）。風險在 **預設 2×** 與 **長片／4K** 固定點倒掛，以及產品文案「批次更省」需校正。

**本回合禁止改 `models.ts` 的 points／verified**。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| 靜態契約 L0 | **ok** — id／category／needs／`input(_,_,s)→{video_url}` |
| OpenAPI Queue | **HTTP 200** · `GET …/openapi.json?endpoint_id=fal-ai/seedvr/upscale/video` · openapi **3.0.4** |
| 平台 metadata | **HTTP 200** · `api.fal.ai/v1/models?endpoint_id=…` · status **active** · display_name **SeedVR2** · category video-to-video · tags `upscale` · license **commercial** · updated **2026-05-26** · description「Upscale your videos using SeedVR2 with **temporal consistency**!」 |
| 模型頁定價 | **$0.001 per megapixel**（width × height × frames）；例 1920×1080×121 ≈ **$0.25** |
| dry-run probe | `verify-models.ts --probe "fal-ai/seedvr/upscale/video"` → **拒探**：「需要來源輸入(影片)…請在站內以素材實測」（符合 needs 鐵律） |
| L1 空 `{}` --yes | **未跑**（零 live；**禁止 --yes**） |
| L2 live 生成 | **未跑**（需片源；6s1080p 亦有實費 ≈$0.37 起，2×/4K 更高） |
| 結論 | **ready-static-only**（契約＋OpenAPI＋active＋官方價已查；待素材 live 後可升 ready／verified） |

---

## 4. 底層邏輯

### 4.1 能力（公開資料）

- **SeedVR2**（字節／ByteDance 系經 fal 托管）：**擴散式影片超分**，強調 **時序一致性（temporal consistency）**，非單純幀內插值。  
- 與 **Topaz Video Upscale**：Topaz 業界標準升頻＋可倍幀（Proteus/Apollo 系），按 **秒×目標解析度** 計費；SeedVR2 按 **輸出總 MP**，可指定 factor 1–10 或目標 720p–2160p。  
- 與 **RIFE**（`fal-ai/rife/video`）：RIFE 主打 **時間軸補幀**；SeedVR 主打 **空間解析度**——修復流水線常「先超分再補幀」或反序，視素材而定。  
- 與 **輕量** `fal-ai/video-upscaler`（$0.1/秒）：SeedVR 細節／時序定位更高，但 MP 計費在高解析可能更貴。  
- 姊妹端點：`fal-ai/seedvr/upscale/image`（影像 $0.001/MP，站內 verified=true、1 點）。

### 4.2 站內 input 組裝

```ts
// shared/models.ts
input: (_p, _f, s) => ({ video_url: s })
```

| 行為 | 說明 |
|------|------|
| prompt / format | **忽略**（超分不吃文案與畫幅旋鈕） |
| 來源 | `s` → **`video_url`**（唯一必填） |
| 可選旋鈕 | 站內 **不暴露** mode／factor／target／noise／seed／output_* |

`prepareGenerationRequest`：缺 `needs` → BAD_REQUEST（需要來源…）。

### 4.3 官方 OpenAPI `SeedvrUpscaleVideoInput` 對照

| Property | 約束 | Required | Default | 站內 | 備註 |
|----------|------|----------|---------|------|------|
| `video_url` | string | **是** | — | ✅ | 來源影片 URL |
| `upscale_mode` | enum：`target` \| `factor` | 否 | **`factor`** | ❌ 預設 | **target** 時用目標解析度；**factor** 時用倍率 |
| `upscale_factor` | number **1–10** | 否 | **2** | ❌ 預設 | mode=factor 時乘到寬高 |
| `target_resolution` | enum：`720p`/`1080p`/`1440p`/`2160p` | 否 | **1080p** | ❌ | 僅 mode=`target` 時生效 |
| `seed` | int \| null | 否 | — | ❌ | 可重現性 |
| `noise_scale` | number **0–1**，step 0.001 | 否 | **0.1** | ❌ | 生成噪聲尺度 |
| `output_format` | `X264 (.mp4)` / `VP9 (.webm)` / `PRORES4444 (.mov)` / `GIF (.gif)` | 否 | **X264 (.mp4)** | ❌ 預設 | |
| `output_quality` | `low`/`medium`/`high`/`maximum` | 否 | **high** | ❌ 預設 | |
| `output_write_mode` | `fast`/`balanced`/`small` | 否 | **balanced** | ❌ | |
| `sync_mode` | boolean | 否 | **false** | ❌ | true 時 data URI、不進 request history |

**Output `SeedvrUpscaleVideoOutput`：** required **`video`**（File）+ **`seed`**（integer）。

**Queue：** `https://queue.fal.run` · paths `/fal-ai/seedvr/upscale/video`（POST）+ status／cancel／result。

### 4.4 與官方差異／風險

1. **預設 2× vs 估點 1080p：** 只丟 `video_url` 時 factor=2；1080p 源→4K 帳單 ≈ **4×** 估點 → **P1 產品／毛利風險**。  
2. **未暴露 target／factor：** 使用者無法在站內鎖 1080p 或 2× 意圖；成本不可預期。  
3. **「比 Topaz 省／批次划算」文案：** 在常見 1080p／4K 輸出下 **SeedVR 單價高於 Topaz**——strengths／bestFor／`sc-video-restore` why 需改（見 §8）。  
4. **扁平 12 點：** 無 `estimatePoints` 解析度／幀數係數；長片與 4K 倒掛。  
5. **`verified=false`：** 助手 requireVerified 時不自動選；手動／情境 recipe 可選。  
6. **擴散式風格：** 影像姊妹註「乾淨、略帶 AI 感」——影片亦可能不如 Topaz「照片級自然」；成品鏡頭仍宜 Topaz。

### 4.5 分詞／文字塔

不適用（無 T5／CLIP 條件；非文生）。世界觀／卡片錨點不應影響超分輸出（prompt 被丟棄）。缺來源攔截見 generationCore：`model.needs && !sourceUrl && !sourceAssetId` → BAD_REQUEST。

---

## 5. 站內點數

| 項目 | 說明 |
|------|------|
| 估點 | 扁平 **points=12**（`realPricePoints` null；`estimatePoints` 退回 12×匯率比） |
| 扣點 | `reserveQuota(…, est)`；成功 `pointsActual` 對齊 est（BYOK 可 0） |
| 退點 | 失敗／回收 `refund`；與 est 對稱 |
| UI | 模型卡 12；cost 已述 6s1080p30 基準——**未警告預設 2×** |
| 與官方 | 官方按 **輸出 MP** 浮動；12 ≈ **6s1080p30 輸出**；**預設 2×／4K／長片平台吃虧** |
| 本回合 | **未改 points**；未跑真扣點 e2e |

**建議（可選 follow-up，非本卡必改碼）：**  
1. **修 input（P1）**：預設改 `upscale_mode: "target", target_resolution: "1080p"`，使行為與 12 點基準一致；或暴露 factor／target 給進階 UI。  
2. **points 維持 12**（1080p 輸出基準）或另案做 **輸出 MP estimatePoints**（需知輸出解析×幀數）。  
3. UI 標明：預設 2×、4K／長片實費遠高於 12 點。

---

## 6. 情境與可用性

| 情境 | 適配 | 原因 |
|------|------|------|
| 整批歷史影音粗修／打量 | △／✅ | 有時序一致；**成本未必低於 Topaz**——比對實價後再選 |
| 關鍵成品升 4K 上架 | △ | 品質可試；**成本與自然度優先 Topaz** |
| AI 生成 720p→1080p | ✅ | target 1080p 時與 12 點較接近；現預設 2× 需注意 |
| 只補幀不升解析 | ❌ | 用 RIFE |
| 對嘴／改內容／restyle | ❌ | 非 lipsync／edit |
| 無片源純文生 | ❌ | needs=video |
| 助手 requireVerified 自動選 | ❌ | verified=false |
| 手動選模／`sc-video-restore` | ✅ | recipe 第二順位；需片源 |

**可用性／文案（L6）**

- sourceHint 清楚；OpenAPI／active 正常。  
- **strengths「單價極低」「批次修復划算」**、**bestFor「Topaz 留成品」**、recipe why「整批先用 SeedVR2 省成本」——相對 Topaz **1080p／4K 實價偏貴**，易誤導 → **建議改正**（§8）。  
- 目錄 ⚠︎（未 verified）合理，待 live。  
- playbook `video-restore` 目前 modelIds 僅 Topaz+RIFE（**未列 SeedVR**），與 `SCENARIO_RECIPES` pickIds（Topaz+SeedVR）**不一致**——可另案對齊。

---

## 7. MCP / 文件

| 項目 | 結果 |
|------|------|
| MCP `find_model` | 目錄同源；關鍵詞「SeedVR／影片放大／超分／升 4K」可命中 |
| MCP `submit_generation` | 可調；**必須** `source_url`（影片）；prompt 可佔位（模型忽略） |
| MCP 火力 | 同站內：僅 `video_url`；無 factor／target |
| Playground | https://fal.ai/models/fal-ai/seedvr/upscale/video |
| API 文件 | https://fal.ai/models/fal-ai/seedvr/upscale/video/api |
| OpenAPI | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/seedvr/upscale/video |
| 本回合 HTTP | OpenAPI **200**；metadata **200 active**；模型頁 HTML 曾 **429**（反爬），定價以搜尋摘要＋既有生態研究交叉 **$0.001/MP** |

---

## 8. 建議動作

- [x] **維持 id／endpoint／category／needs／input 形狀** — `video_url` 與 OpenAPI required 一致  
- [x] **points=12** — **6s1080p30 輸出** 實價對齊；本回合 **不改 points**  
- [ ] **修 input（P1 建議）** — 預設 `upscale_mode: "target", target_resolution: "1080p"`（對齊估點）；可選暴露 `upscale_factor`／`noise_scale`／`seed`  
- [ ] **調文案** — cost 補「**按輸出**」；strengths／bestFor／`sc-video-restore` why **勿寫「比 Topaz 省」**（1080p／4K 實價 SeedVR 更高）；可改「擴散時序一致／可試風格」或「特定低解析路徑再比價」  
- [ ] **verified true** — **勿擅自改**；待 L2 站內短片 live 成功後人工開  
- [ ] **下架或隱藏** — **否**；端點 active，超分能力有效  
- [ ] **長片／4K estimatePoints** — 另案（依輸出 MP 或秒×解析）  
- [ ] **Live 佇列（可選，控費）** — 最短低清片源 + 建議顯式 target 1080p；估 **≥ NT$ 數元～十數元**；**禁止本回合 --yes**  
- [ ] **playbook 對齊** — `scenarioPlaybook` video-restore 與 recipe pickIds 是否納入 SeedVR 另議  

**總建議標籤（寫入 _index）：** `維持`（ready-static-only；12≈6s1080p30輸出；預設2×毛利風險；文案勿寫比Topaz省）

### 本回合狀態燈（供 `_index`）

| L0 | L1 | L2 live | 建議 |
|----|----|---------|------|
| ✅ | 📄 OpenAPI | 未跑 | **維持**（12 點基準對；input 預設／文案 follow-up） |

---

## 9. 來源

1. `shared/models.ts` — `fal-ai/seedvr/upscale/video`（~1564–1570）、`fal-ai/seedvr/upscale/image`、`fal-ai/topaz/upscale/video`、`parseRealCost`／影片 MP 分支、`sc-video-restore`  
2. `docs/model-audit/models-index.json` — index **164**  
3. `docs/fal生態研究.md` — SeedVR2 Video Upscaler 已查證、$0.001/MP、10s4K≈$2.5  
4. `docs/點數校準報告.md` — SeedVR2 影片 · 12 · **需人工**  
5. `docs/模型目錄.md`／`docs/模型清查清單.md` — ⚠︎ 未驗證  
6. fal OpenAPI（本回合 curl **200**）— `SeedvrUpscaleVideoInput`／`Output`（required 僅 video_url；預設 factor=2、quality high）  
7. fal metadata API — status **active**、display_name SeedVR2、temporal consistency  
8. fal 模型頁搜尋摘要 — **$0.001 per megapixel**；例 1920×1080×121 ≈ $0.25  
9. `scripts/verify-models.ts --probe`（**無 --yes**）— needs 拒探  
10. `server/services/generationCore.ts` — 來源攔截、扣退點路徑  
11. `shared/scenarioPlaybook.ts` — video-restore 現列 Topaz+RIFE（與 recipe 差一截）  

**未做：** FAL_KEY live 生成、空輸入 L1 `--yes`、站內真扣點 e2e、改 `verified`／`points` 寫入 `models.ts`。
