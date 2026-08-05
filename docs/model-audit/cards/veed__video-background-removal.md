# veed/video-background-removal

> 審計：R4 · index **#167** · static+research · **零 live** · 2026-08-05  
> slug：`veed__video-background-removal` · 單一真相：`shared/models.ts`

## 1. 身分

| 欄位 | 值 |
|------|-----|
| id / endpoint | `veed/video-background-removal`（`endpointOf` = id，無 alias；非 `fal-ai/*` 命名空間） |
| label | VEED 影片去背(商用) |
| category | `video-to-video`（影片轉影片） |
| tier | **economy** |
| kind | `video` |
| points | **4** |
| cost | `$0.015–0.0225/30幀(30fps≈每秒);按秒計費,點數為 6 秒基準` |
| verified | **false** |
| recommended | **false** |
| needs | **video**（要去背的影片網址） |
| secondaryNeeds | （無） |
| sourceHint | 要去背的影片網址 |
| strengths | 商用等級去背,穩定 |
| bestFor | 對外正式合成的穩定去背 |
| 供應商／底層 | **VEED** commercial video rembg via fal.ai（display_name **Video Background Removal**；license **commercial**；group `video-background-removal`／Video To Video；OpenAPI title **GeneralRembgInput**） |
| 角色定位 | 去背家族 **商用授權＋邊緣精修** 檔（vs 旗艦 `bria/…/v3`、高速 `bria/…/realtime` 1 點、經濟 BEN2 5 點、預算 Fast 2 點）；**未**進 `sc-video-bg` pickIds（該卡：v3 → BEN2） |
| 姊妹端點 | `veed/video-background-removal/fast`（#174，半價預覽）、`…/green-screen`（#175，真綠幕 chroma key） |

**一句話**：無綠幕 **影片自動去背**（video → video，預設 **VP9 + alpha**）；官方 **$0.015–0.0225／30 幀**（30fps≈每秒；開邊緣精修取上限）；站內固定 **4 點** ≈ **6 秒＠上限**。

**L0 靜態契約：** **ok**  
- 必填欄齊；`category ∈ CATEGORIES`；id 唯一；`input` 可呼叫。  
- `needs=video` + `input → { video_url }` 與 OpenAPI required（僅 `video_url`）對齊。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| points（目錄扁平） | **4** |
| cost 字串 | `$0.015–0.0225/30幀(30fps≈每秒);按秒計費,點數為 6 秒基準` |
| 官方價（fal 生態研究 ✅已查證） | **$0.015–0.0225／30 幀**（30fps 下≈每秒；**開邊緣精修取上限**） |
| 計費性質 | **按幀批（30 幀一檔）**；等價於 30fps 時 **按秒** 浮動；長片／高 fps 費用上升 |
| `parseRealCost` | usdMid=**0.01875**；multiplier=**null** → unitNote「單位「/30幀」需人工換算」 |
| `realPricePoints` | **null**（不機械覆寫；保留人工 4） |
| 匯率 | USD×**31** ≈ NT$ |
| 校準報告列 | VEED 影片去背(商用) ⚠︎ · 4 · 判定 **需人工** |

### 2.1 粗估（30fps；每秒＝$0.015–0.0225）

| 假設 | USD（低–高） | 約 NT$ | vs 固定 4 點 |
|------|--------------|--------|---------------|
| 1s | 0.015–0.0225 | 0.46–0.70 | 偏貴緩衝 |
| **6s（cost 文案基準）** | **0.090–0.135** | **2.79–4.19** | **上限 refine ≈4 對齊**；中價 ~3.5 |
| 10s（生態「約 5–7 點」） | 0.150–0.225 | 4.65–6.97 | **固定 4 偏低** |
| 30s | 0.45–0.675 | 14.0–20.9 | 長片倒掛 |
| 60s | 0.90–1.35 | 27.9–41.9 | 嚴重倒掛 |
| Fast 姊妹 6s | 0.048–0.072 | 1.5–2.2 | 站內 Fast=2 ≈ 中高 |
| 綠幕 6s @$0.025/30幀 | 0.15 | 4.65 | 站內 5 ≈ |
| Bria realtime 6s @$0.0042/s | 0.025 | 0.78 | 站內 1；**遠低於 VEED** |
| BEN2 6s720p30 @$0.001/MP | ~0.166 | ~5.1 | 站內 5；常 **高於** VEED 上限 |

**解讀**

1. **points=4** 在數學上對齊 **6 秒 × 上限 $0.0225／秒 × 31** → **round(4.185)=4**（預設 `refine_foreground_edges=true` 取上限合理）。中價 round(3.49)=**3**——固定 4 略偏保守，**可接受**。  
2. 生態研究「10 秒片約 5–7 點」與上表一致；**扁平 4 對 10s+ 低估**——文案已寫「按秒計費、6 秒基準」，誠實度 OK，無時長 `estimatePoints`。  
3. 舊總表另列「約 $0.1/秒級」屬**過時粗估**；以去背專表 **$0.015–0.0225/30幀 ✅已查證** 與目錄 cost 為準。  
4. 相對 **Bria realtime（1 點）**：VEED 約 **4–6×** 單價——賣點是 **commercial license + edge refine + 預設 alpha**，不是最便宜。  
5. 相對 **BEN2（5 點／MP）**：同長 720p 時 VEED 常 **更省**；BEN2 差異化是可選 RGB 底與 MP 計費。

**結論（L2 定價）：** 官方區間 **已查證**；**points=4 對 6s＠上限 refine 正確**；**勿改 points**（本回合禁止）。風險在 **長片固定點倒掛**、`parseRealCost` 無法機械換算「/30幀」。

**本回合禁止改 `models.ts` 的 points／verified**。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| 靜態契約 L0 | **ok** — id／category／needs／`input(_,_,s)→{video_url}` |
| OpenAPI Queue | **HTTP 200** · `GET …/openapi.json?endpoint_id=veed/video-background-removal` · openapi **3.0.4** · info title「Queue OpenAPI for veed/video-background-removal」**1.0.0** |
| 平台 metadata | **HTTP 200** · `api.fal.ai/v1/models?endpoint_id=…` · status **active** · display_name **Video Background Removal** · description「Remove background from any video with people and objects. **No green screen needed.**」 · license **commercial** · kind **inference** · updated **2026-07-17** · date **2025-11-28** · group **video-background-removal**／Video To Video · tags `[]` |
| 模型頁 HTML | **HTTP 429**（反爬）— **不計連通失敗**（schema+metadata 已通） |
| dry-run probe | `verify-models.ts --probe "veed/video-background-removal"` → **拒探**：「需要來源輸入(影片)…請在站內以素材實測」（符合 needs 鐵律） |
| L1 空 `{}` --yes | **未跑**（零 live；**禁止 --yes**） |
| L2 live 生成 | **未跑**（需片源；6s 約 **$0.09–0.14／NT$3–4** 級） |
| 結論 | **ready-static-only**（契約＋OpenAPI＋active＋價對齊）；**站內回傳解析有 P0 缺口**（見 §4.4）→ live 前須先修 `extractResult` |

**歷史：** 生態研究 ✅已查證；`docs/fal端點連通報告.md` 未必單列本 id；本回合 schema 200 + status active 支持「端點活著」。

---

## 4. 底層邏輯

### 4.1 能力（公開資料）

- **VEED commercial general rembg**：任意人物／物件影片去背，**無需綠幕**（metadata 明文）。  
- **邊緣精修（edge refinement）**：`refine_foreground_edges` 預設 **true**——品質取向、對應定價上限。  
- **主體假設**：`subject_is_person` 預設 **true**；物件去背應傳 **false**（站內未暴露）。  
- **輸出編碼**  
  - 預設 **`output_codec=vp9`** → **單一影片含 alpha**（webm 系，例 output content_type `video/webm`）——合成圖層友好。  
  - **`h264`** → **兩支**（rgb + alpha）；說明寫「H264 is recommended for better RGB quality」。  
- **license commercial**——對外商用敘事與 strengths「商用等級」一致。  
- 真綠幕請走姊妹 **`…/green-screen`**（spill suppression）；本端是通用 AI 分割，非 chroma key。

### 4.2 站內 input 組裝

```ts
// shared/models.ts
input: (_p, _f, s) => ({ video_url: s })
```

| 行為 | 說明 |
|------|------|
| prompt / format | **忽略**（去背不吃文案與畫幅旋鈕） |
| 來源 | `s` → **`video_url`**（唯一必填） |
| 可選旋鈕 | 站內 **不暴露** `output_codec`／`refine_foreground_edges`／`subject_is_person` → 全走官方預設（**vp9 + refine on + person**） |

`prepareGenerationRequest`：缺 `needs` → BAD_REQUEST（需要來源…）。

### 4.3 官方 OpenAPI `VideoBackgroundRemovalInput`（title: GeneralRembgInput）對照

| Property | 約束 | Required | Default | 站內 | 備註 |
|----------|------|----------|---------|------|------|
| `video_url` | string (uri), minLength 1, maxLength 2083 | **是** | — | ✅ | 來源影片 URL |
| `output_codec` | enum：`vp9` \| `h264` | 否 | **`vp9`** | ❌ 預設 | vp9＝單檔 alpha；h264＝rgb+alpha 雙檔 |
| `refine_foreground_edges` | boolean | 否 | **true** | ❌ | 邊緣品質；影響取價上限敘事 |
| `subject_is_person` | boolean | 否 | **true** | ❌ | 非人物主體應 false |

**Output `VideoBackgroundRemovalOutput`（GeneralRembgOutput）：** required **`video`**＝**`File[]`（array）**（非單一 File 物件）。  
例：`[{ content_type: "video/webm", url: "…_output.webm" }]`。h264 時可 **長度 2**。

**Queue：** paths `/veed/video-background-removal`（POST）+ `/…/requests/{request_id}` status／cancel／result。

**姊妹：** Fast 同 Input 形狀（`FastGeneralRembgInput`）；Green-screen 換 `spill_suppression_strength`（無 refine／subject 旗標）。

### 4.4 與官方差異／風險

1. **P0 — `extractResult` 不認 `video: File[]`：**  
   OpenAPI／範例皆為 **陣列**；`server/services/fal.ts` 的 `urlOf(result.video)` 只吃 **`{url}` 物件**。本機驗證：  
   `extractResult({ video: [{ url: "…" }] })` → **`{}`** → 佇列完成後站內會 **「無法解析模型輸出」** 並走失敗／退點。  
   **fast／green-screen 同家族同病。** 修法建議：`video` 若 `Array.isArray` → 取 `[0].url`（h264 雙檔可另議第二檔）。  
2. **未暴露 codec／refine／subject：** 預設 vp9+alpha+refine 對「合成到禪堂」其實合理；物件去背無法關 person 假設。  
3. **定價 6s 基準：** 4 點 ≈ 上限；**≥10s 平台吃虧**（生態 5–7 點）。  
4. **`sc-video-bg` 未列本 id：** bestFor「對外正式」與 recipe（Bria v3→BEN2）不一致——商用 VEED 僅手動選模。  
5. **playbook「人物去背合成」** 列 `fal-ai/bria/video/background-removal`＋nano-banana edit，**未列** VEED／Bria v3／BEN2——決策層三份列表互不完全。  
6. **`verified=false`：** 助手 requireVerified 時不自動選；手動可選。  
7. **舊文案 $0.1/秒級：** 勿再引用；以 $0.015–0.0225/30幀 為準。

### 4.5 分詞／文字塔

不適用（無 T5／CLIP 條件；非文生）。世界觀／卡片錨點不應影響去背輸出（prompt 被丟棄）。缺來源攔截見 generationCore：`model.needs && !sourceUrl && !sourceAssetId` → BAD_REQUEST。

---

## 5. 站內點數

| 項目 | 說明 |
|------|------|
| 估點 | 扁平 **points=4**（`realPricePoints` null；`estimatePoints` 退回 4×匯率比） |
| 扣點 | `reserveQuota(…, est)`；成功 `pointsActual` 對齊 est（BYOK 可 0） |
| 退點 | 失敗／回收 `refund`；與 est 對稱——**含 extract 解析失敗路徑** |
| UI | 模型卡 4；cost 已述 6 秒基準——**未警告長片／未暴露 refine 關斷** |
| 與官方 | 官方按 **30 幀檔** 浮動；4 ≈ **6s＠上限 refine**；**長片／高 fps 平台吃虧** |
| 本回合 | **未改 points**；未跑真扣點 e2e |

**建議（可選 follow-up，非本卡必改 models.ts）：**  
1. **P0 修 `extractResult`** 支援 `video` 陣列（家族三端點共用）。  
2. **points 維持 4**（6s 上限基準）或另案做 **秒數 estimatePoints**。  
3. 可選暴露 `subject_is_person`／`output_codec`（進階）；預設可維持。  
4. recipe／playbook 是否納入商用 VEED 另議。

---

## 6. 情境與可用性

| 情境 | 適配 | 原因 |
|------|------|------|
| 對外正式合成、要 **commercial license** | ✅ 主場 | strengths／bestFor；license commercial |
| 講者去背疊禪堂／金句（要透明層） | ✅ 能力 | 預設 **vp9 alpha**；但 **P0 解析** 修好前站內拿不到 URL |
| 品質取向、邊緣要乾淨 | ✅ | refine 預設 on；對應價上限 |
| 日常大量試錯 | △／❌ | 改 **Bria realtime（1）** 或 **VEED Fast（2）** |
| 旗艦時序穩、talking-head 天花板 | △ | recipe 首選 **Bria v3**；VEED 為商用備援 |
| 真綠幕 chroma key | ❌ | 用 `…/green-screen` |
| 非人物主體（產品／法器） | △ | 需 `subject_is_person=false`——站內未暴露 |
| 要 RGB 純色底虛擬綠幕 | △／❌ | BEN2 `background_color`；本模無該旋鈕 |
| 對嘴／超分／補幀 | ❌ | 非 lipsync／upscale／RIFE |
| 無片源純文生 | ❌ | needs=video |
| 助手 requireVerified 自動選 | ❌ | verified=false |
| 手動選模 | ✅ 可選 | **不在** `sc-video-bg` pickIds |

**可用性／文案（L6）**

- sourceHint 清楚；OpenAPI／active／commercial 正常。  
- strengths「商用等級去背,穩定」與 license **一致**；未誤導「最便宜」。  
- bestFor「對外正式」與 **sc-video-bg 未收錄** 略張——文案可選改「商用授權備援／邊緣精修」或把 id 納入 recipe。  
- cost／6 秒基準與 4 點 **對齊**——無需改價文案。  
- 目錄 ⚠︎（未 verified）合理；**更關鍵是 extract P0**，否則 live 必失敗。

---

## 7. MCP / 文件

| 項目 | 結果 |
|------|------|
| MCP `find_model` | 目錄同源；關鍵詞「VEED／影片去背／background removal／商用去背」可命中 |
| MCP `submit_generation` | 可調；**必須** `source_url`（影片）；prompt 可佔位（模型忽略） |
| MCP 火力 | 同站內：僅 `video_url`；無 codec／refine／subject；**同 extract 陣列風險** |
| Playground | https://fal.ai/models/veed/video-background-removal |
| API 文件 | https://fal.ai/models/veed/video-background-removal/api |
| OpenAPI | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=veed/video-background-removal |
| 本回合 HTTP | OpenAPI **200**；metadata **200 active**；模型頁 HTML **429**；定價依生態研究 **$0.015–0.0225/30幀** ✅ |

---

## 8. 建議動作

- [x] **維持 points／cost** — **4** ≈ 6s × **$0.0225**（refine 上限）×31；中價略偏貴可接受；**本回合不改 points**  
- [x] **維持 id／endpoint／category／needs／input 形狀** — `video_url` 與 OpenAPI required 一致  
- [ ] **P0 修 `extractResult`** — `video` 為 **File[]** 時取 `[0].url`（含 fast／green-screen）；否則站內 live **必**「無法解析」  
- [ ] **修 input（P2 可選）** — 暴露 `subject_is_person`（物件去背）；可選 `output_codec`／`refine_foreground_edges`  
- [ ] **verified true** — **勿擅自改**；須 **先修 extract** 再 L4 站內短片 live 成功後人工開  
- [ ] **下架或隱藏** — **否**；端點 active、商用去背定位清楚；阻塞在解析非 slug 死亡  
- [ ] **情境卡（可選）** — `sc-video-bg` 是否加入本 id 作「商用授權」第三順位；playbook 對齊 Bria v3／BEN2／VEED  
- [ ] **長片 estimatePoints** — 另案（×秒或 ×幀批）  
- [ ] **Live 佇列（可選，控費）** — **extract 修好後** 最短片源；估 **≥ NT$ 數元～4／6s**；**禁止本回合 --yes**  

**總建議標籤（寫入 _index）：** `修 extractResult（video[]）；4≈6s@上限 refine；ready-static-only`

### 本回合狀態燈（供 `_index`）

| L0 | L1 | L2 live | 建議 |
|----|----|---------|------|
| ✅ | 📄 OpenAPI | 未跑 | **修 extractResult（video[]）**（points 維持 4） |

---

## 9. 來源

1. `shared/models.ts` — `veed/video-background-removal`（~1588–1596）、fast／green-screen／Bria v3／realtime／BEN2、`sc-video-bg`、`parseRealCost`／`realPricePoints`／`USD_TO_TWD=31`  
2. `docs/model-audit/models-index.json` — index **167** · slug `veed__video-background-removal`  
3. `docs/fal生態研究.md` — Veed 影片去背 **$0.015–0.0225/30幀** ✅已查證；10s≈5–7 點；edge refinement；與 Bria 互備  
4. `docs/點數校準報告.md` — VEED 影片去背(商用) 4／**需人工**（usdMid 0.019、/30幀）  
5. `docs/模型目錄.md`／`docs/模型清查清單.md` — ⚠︎ 未驗證；需影片素材實測  
6. fal OpenAPI（本回合 curl **200**）— `VideoBackgroundRemovalInput`／`Output`（required 僅 video_url；預設 vp9／refine true／person true；**video: File[]**）  
7. fal metadata API — status **active**、display_name Video Background Removal、license **commercial**、no green screen needed  
8. `scripts/verify-models.ts --probe`（**無 --yes**）— needs 拒探  
9. `server/services/fal.ts` `extractResult` — 本機驗證 **陣列 video → 空結果**（P0）  
10. `server/services/generationCore.ts` — 來源攔截、扣退點路徑  
11. 同賽道卡 `docs/model-audit/cards/fal-ai__ben__v2__video.md`（#165）— 定價／alpha 對照  
12. 姊妹 OpenAPI 抽樣 — fast／green-screen 同 `video` 陣列輸出形狀  

**未做：** FAL_KEY live 生成、空輸入 L1 `--yes`、站內真扣點 e2e、改 `verified`／`points` 寫入 `models.ts`、實際提交 extractResult 修補 PR（僅記錄 P0）。
