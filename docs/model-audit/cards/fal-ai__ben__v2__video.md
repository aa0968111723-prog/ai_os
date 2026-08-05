# fal-ai/ben/v2/video

> 審計：R4 · index **#165** · static+research · **零 live** · 2026-08-05  
> slug：`fal-ai__ben__v2__video` · 單一真相：`shared/models.ts`

## 1. 身分

| 欄位 | 值 |
|------|-----|
| id / endpoint | `fal-ai/ben/v2/video`（`endpointOf` = id，無 alias） |
| label | BEN2 影片去背 |
| category | `video-to-video`（影片轉影片） |
| tier | **economy** |
| kind | `video` |
| points | **5** |
| cost | `$0.001/百萬像素(幾乎零成本);點數以 6 秒 720p 30fps 估` |
| verified | **false** |
| recommended | **false** |
| needs | **video**（要去背的影片網址） |
| secondaryNeeds | （無） |
| sourceHint | 要去背的影片網址 |
| strengths | 自動去背/綠幕效果;單價極低的去背主力 |
| bestFor | 人物去背合成到禪堂、金句字卡 |
| 供應商／底層 | **BEN2（Background Erase Network v2）** via fal.ai（group `ben-v2`／Background Remover (video)；tags `segmentation`／`background removal`；display_name **Ben-Video-Bg-Rm**） |
| 角色定位 | 站內 **影片去背經濟檔**（vs 旗艦 `bria/video/background-removal/v3`、高速 `bria/…/realtime`、商用 `veed/video-background-removal`）；`sc-video-bg` pickIds **第二順位** |
| 姊妹端點 | `fal-ai/ben/v2/image`（圖片去背，$0.025/MP，站內 verified=true、1 點） |

**一句話**：來源影片 **背景移除**（video → video）；可輸出 **真透明 webm（VP9 alpha）** 或 **RGB 純色底**；官方 **$0.001／MP**（寬×高×幀）；站內固定 **5 點** ≈ 6 秒 720p 30fps。

**L0 靜態契約：** **ok**  
- 必填欄齊；`category ∈ CATEGORIES`；id 唯一；`input` 可呼叫。  
- `needs=video` + `input → { video_url }` 與 OpenAPI required（僅 `video_url`）對齊。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| points（目錄扁平） | **5** |
| cost 字串 | `$0.001/百萬像素(幾乎零成本);點數以 6 秒 720p 30fps 估` |
| 官方價（fal 模型頁） | **$0.001 per megapixel**（搜尋摘要 2026-08 與生態研究一致） |
| 計費性質 | 影片 **寬×高×幀數** 總 MP（與 SeedVR 影片同單位語意；以輸入／處理像素量為準） |
| `parseRealCost` | usdMid=**0.001**；影片 MP → multiplier=**null** → unitNote「影片按總像素×幀數計費，需人工換算」 |
| `realPricePoints` | **null**（不機械覆寫；保留人工 5） |
| 匯率 | USD×**31** ≈ NT$ |
| 校準報告列 | BEN2 影片去背 ⚠︎ · 5 · 判定 **需人工** |

### 2.1 粗估（$0.001／MP，匯率 31）

| 假設 | 約 MP | USD | 約 NT$ | vs 固定 5 點 |
|------|------|-----|--------|---------------|
| **6s 720p 30fps**（cost 文案基準） | **165.9** | **0.166** | **5.14** | **≈5 對齊** |
| 6s 720p 24fps | 132.7 | 0.133 | 4.11 | 略偏貴 |
| 10s 720p 30fps（生態研究「≈9 點」） | 276.5 | 0.276 | 8.57 | **≈9；固定 5 偏低** |
| 6s 1080p 30fps | 373.2 | 0.373 | 11.57 | **偏低 ~7 點** |
| 6s 4K 30fps | 1493 | 1.493 | 46.3 | **嚴重偏低** |
| 60s 720p 30fps | 1659 | 1.659 | 51.4 | 長片倒掛 |
| 每秒 720p30 | 27.65 | 0.0276 | 0.86 | — |

**解讀**

1. **points=5** 在數學上 **等於** `round(1280×720×30×6 / 1e6 × $0.001 × 31)` → **round(5.14)=5**。文案「6 秒 720p 30fps」與點數 **一致**。  
2. cost 寫「**幾乎零成本**」對 **短片低解析** 尚可（數美分～一角美元級），但 6s720p 已 **$0.17／~5 點**，10s 即 ~9 點等值——**不宜當「免費感」文案**。  
3. 與同賽道：**Bria** `…/background-removal` 與 **realtime** 官方摘要 **$0.0042/秒** → 6 秒 ≈ **$0.025（~1 點）**，**低於** BEN2 720p 實價；**VEED** 約 **$0.015–0.0225／30 幀**（30fps≈每秒）亦常 **低於或接近** BEN2 720p。故「**單價極低的去背主力**」在 720p+ **不成立**——BEN2 真正差異化是 **webm alpha／RGB 純色底**，不是全場最便宜。  
4. 扁平 5 點：**1080p／4K／長片** 平台吃虧；無 `estimatePoints` 解析度×時長係數。

**結論（L2 定價）：** 官方 $0.001/MP **已查證**；**points=5 對 6s720p30 基準正確**；**勿改 points**（本回合禁止）。風險在 **長片／高解析固定點倒掛**、文案「幾乎零成本／極低主力」相對 Bria realtime 易誤導。

**本回合禁止改 `models.ts` 的 points／verified**。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| 靜態契約 L0 | **ok** — id／category／needs／`input(_,_,s)→{video_url}` |
| OpenAPI Queue | **HTTP 200** · `GET …/openapi.json?endpoint_id=fal-ai/ben/v2/video` · openapi **3.0.4** |
| 平台 metadata | **HTTP 200** · `api.fal.ai/v1/models?endpoint_id=…` · status **active** · display_name **Ben-Video-Bg-Rm** · category video-to-video · tags `segmentation`／`background removal` · group **ben-v2**／Background Remover (video) · updated **2026-04-21** · description「A model for high quality and **smooth** background removal for videos.」 |
| 模型頁定價 | **$0.001 per megapixel**（模型頁摘要；HTML 直抓曾 **429**） |
| dry-run probe | `verify-models.ts --probe "fal-ai/ben/v2/video"` → **拒探**：「需要來源輸入(影片)…請在站內以素材實測」（符合 needs 鐵律） |
| L1 空 `{}` --yes | **未跑**（零 live；**禁止 --yes**） |
| L2 live 生成 | **未跑**（需片源；6s720p 亦有實費 ≈$0.17 起） |
| 結論 | **ready-static-only**（契約＋OpenAPI＋active＋官方價已查；待素材 live 後可升 ready／verified） |

---

## 4. 底層邏輯

### 4.1 能力（公開資料）

- **BEN2** = *Background Erase Network* 第二代：**影片自動去背／分割**，強調品質與 **時序平滑（smooth）**；非生成式重繪主體。  
- **差異化輸出（OpenAPI 明文）**  
  - `output_format=webm` → **真透明**（VP9 + alpha）——剪輯軟體當圖層疊加的關鍵。  
  - `output_format=mp4`（**預設**）→ **不支援透明**，透明區會渲成 **黑底**。  
  - `background_color: [R,G,B]` → 指定純色底（例綠幕 `[0,255,0]`）；未提供則背景透明（但 mp4 仍會把透明當黑）。  
- 與 **Bria VRMBG 3.0**／**VEED**：Bria 偏商用授權＋talking-head 穩；VEED 有 edge refinement／綠幕專端；BEN2 賣點是 **alpha webm 與 RGB 底可控**。  
- 與 **BiRefNet v2 video**：同為開源系分割；長片時序／產品包裝以 Bria／VEED／BEN 各有定位。  
- 圖片姊妹：`fal-ai/ben/v2/image`（$0.025/MP，非 $0.001——**圖／影單價不同**）。

### 4.2 站內 input 組裝

```ts
// shared/models.ts
input: (_p, _f, s) => ({ video_url: s })
```

| 行為 | 說明 |
|------|------|
| prompt / format | **忽略**（去背不吃文案與畫幅旋鈕） |
| 來源 | `s` → **`video_url`**（唯一必填） |
| 可選旋鈕 | 站內 **不暴露** `output_format`／`background_color`／`seed` |

`prepareGenerationRequest`：缺 `needs` → BAD_REQUEST（需要來源…）。

### 4.3 官方 OpenAPI `BenV2VideoInput` 對照

| Property | 約束 | Required | Default | 站內 | 備註 |
|----------|------|----------|---------|------|------|
| `video_url` | string | **是** | — | ✅ | 來源影片 URL |
| `background_color` | int[3] RGB 0–255 \| null | 否 | **null**（透明語意） | ❌ | 例 `[0,0,0]`；綠幕常用 `[0,255,0]` |
| `output_format` | enum：`mp4` \| `webm` | 否 | **`mp4`** | ❌ 預設 | **webm 才真透明**；mp4 透明→黑 |
| `seed` | int \| null | 否 | — | ❌ | 可重現性 |

**Output `BenV2VideoOutput`：** required **`video`**（File）+ **`seed`**（integer）。

**Queue：** `https://queue.fal.run` · paths `/fal-ai/ben/v2/video`（POST）+ status／cancel／result。

### 4.4 與官方差異／風險

1. **預設 mp4＝無 alpha（P1 產品）：** 只丟 `video_url` 時 output=mp4 → 透明區 **黑底**；bestFor「合成到禪堂／字卡」使用者常期待透明層——**站內預設與情境文案衝突**。  
2. **未暴露 webm／RGB：** 無法在 UI 選「透明 webm」或「純綠底虛擬綠幕」。  
3. **「極低成本／幾乎零成本」文案：** 720p+ 實價常 **高於** Bria realtime（$0.0042/s）；strengths／`sc-video-bg` why「日常量大先用 BEN2 **省**」在 720p 短片上 **相對 Bria realtime（站內 1 點）不省**。  
4. **扁平 5 點：** 無解析×時長 `estimatePoints`；1080p／長片倒掛。  
5. **`verified=false`：** 助手 requireVerified 時不自動選；手動／`sc-video-bg` 可選。  
6. **playbook 落差：** `scenarioPlaybook`「人物去背合成」列 `fal-ai/bria/video/background-removal`＋nano-banana edit，**未列 BEN2**；recipe `sc-video-bg` 則有 Bria v3＋BEN2——決策層不一致。

### 4.5 分詞／文字塔

不適用（無 T5／CLIP 條件；非文生）。世界觀／卡片錨點不應影響去背輸出（prompt 被丟棄）。缺來源攔截見 generationCore：`model.needs && !sourceUrl && !sourceAssetId` → BAD_REQUEST。

---

## 5. 站內點數

| 項目 | 說明 |
|------|------|
| 估點 | 扁平 **points=5**（`realPricePoints` null；`estimatePoints` 退回 5×匯率比） |
| 扣點 | `reserveQuota(…, est)`；成功 `pointsActual` 對齊 est（BYOK 可 0） |
| 退點 | 失敗／回收 `refund`；與 est 對稱 |
| UI | 模型卡 5；cost 已述 6s720p30 基準——**未警告預設 mp4 無透明、長片／1080p 實費** |
| 與官方 | 官方按 **總 MP** 浮動；5 ≈ **6s720p30**；**1080p／4K／長片平台吃虧** |
| 本回合 | **未改 points**；未跑真扣點 e2e |

**建議（可選 follow-up，非本卡必改碼）：**  
1. **修 input（P1）**：預設 `output_format: "webm"`（對齊合成情境）；或暴露 format／`background_color` 給進階 UI。  
2. **points 維持 5**（720p 短片基準）或另案做 **MP／秒 estimatePoints**。  
3. UI／strengths：改強調 **透明 webm／RGB 底**，勿寫「全場最便宜」。

---

## 6. 情境與可用性

| 情境 | 適配 | 原因 |
|------|------|------|
| 講者去背疊金句／禪堂（要透明層） | △／✅ | **能力有**（webm）；**站內預設 mp4 無 alpha** → 須改 input 或後製當黑底遮罩 |
| 輸出純綠底進任意 NLE | △ | 需 `background_color=[0,255,0]`——站內未暴露 |
| 日常大量試錯去背 | △ | 有時序平滑；**成本未必低於 Bria realtime（1 點）** |
| 對外正式成品、版權敏感 | △ | 優先 Bria v3（recipe 第一順位）／商用 VEED |
| 真綠幕 chroma key | ❌ 非主力 | 用 `veed/…/green-screen` |
| 對嘴／超分／補幀 | ❌ | 非 lipsync／upscale／RIFE |
| 無片源純文生 | ❌ | needs=video |
| 助手 requireVerified 自動選 | ❌ | verified=false |
| 手動選模／`sc-video-bg` | ✅ | recipe 第二順位；需片源 |

**可用性／文案（L6）**

- sourceHint 清楚；OpenAPI／active 正常。  
- **strengths「單價極低的去背主力」**、**cost「幾乎零成本」**、**sc-video-bg why「日常…BEN2 省」**——相對 Bria realtime／部分 VEED 路徑 **易誤導** → **建議改正**（§8）。  
- 目錄 ⚠︎（未 verified）合理，待 live。  
- playbook vs recipe 去背列表 **不一致**——可另案對齊。

---

## 7. MCP / 文件

| 項目 | 結果 |
|------|------|
| MCP `find_model` | 目錄同源；關鍵詞「BEN2／影片去背／透明 webm／綠幕」可命中 |
| MCP `submit_generation` | 可調；**必須** `source_url`（影片）；prompt 可佔位（模型忽略） |
| MCP 火力 | 同站內：僅 `video_url`；無 format／RGB／seed |
| Playground | https://fal.ai/models/fal-ai/ben/v2/video |
| API 文件 | https://fal.ai/models/fal-ai/ben/v2/video/api |
| OpenAPI | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/ben/v2/video |
| 本回合 HTTP | OpenAPI **200**；metadata **200 active**；模型頁／API HTML 曾 **429**（反爬），定價以搜尋摘要＋生態研究交叉 **$0.001/MP** |

---

## 8. 建議動作

- [x] **維持 id／endpoint／category／needs／input 形狀** — `video_url` 與 OpenAPI required 一致  
- [x] **points=5** — **6s720p30** 實價對齊；本回合 **不改 points**  
- [ ] **修 input（P1 建議）** — 預設 `output_format: "webm"`（對齊合成／透明）；可選暴露 `background_color`／`seed`  
- [ ] **調文案** — cost 弱化「幾乎零成本」；strengths 改「**可真透明 webm／RGB 底**；720p 短片經濟」；`sc-video-bg` why **勿寫「比 Bria 省」**（相對 realtime 站內 1 點常更貴）  
- [ ] **verified true** — **勿擅自改**；待 L2 站內短片 live 成功後人工開  
- [ ] **下架或隱藏** — **否**；端點 active，去背＋alpha 能力有效  
- [ ] **長片／高解析 estimatePoints** — 另案（依總 MP 或秒×解析）  
- [ ] **Live 佇列（可選，控費）** — 最短低清片源；建議顯式 webm；估 **≥ NT$ 數元**；**禁止本回合 --yes**  
- [ ] **playbook 對齊** — `scenarioPlaybook` 去背列是否納入 BEN2／Bria v3 另議  

**總建議標籤（寫入 _index）：** `維持`（ready-static-only；5≈6s720p30；預設mp4無alpha；文案勿寫全場最便宜）

### 本回合狀態燈（供 `_index`）

| L0 | L1 | L2 live | 建議 |
|----|----|---------|------|
| ✅ | 📄 OpenAPI | 未跑 | **維持**（5 點基準對；預設 format／文案 follow-up） |

---

## 9. 來源

1. `shared/models.ts` — `fal-ai/ben/v2/video`（~1572–1578）、`fal-ai/ben/v2/image`、`sc-video-bg`、`parseRealCost`／影片 MP 分支  
2. `docs/model-audit/models-index.json` — index **165**  
3. `docs/fal生態研究.md` — BEN v2 影片已查證、$0.001/MP、720p30≈$0.028/秒、webm alpha／RGB 底  
4. `docs/點數校準報告.md` — BEN2 影片去背 · 5 · **需人工**  
5. `docs/模型目錄.md`／`docs/模型清查清單.md` — ⚠︎ 未驗證  
6. fal OpenAPI（本回合 curl **200**）— `BenV2VideoInput`／`Output`（required 僅 video_url；預設 output_format=**mp4**；webm 真透明說明）  
7. fal metadata API — status **active**、display_name Ben-Video-Bg-Rm、smooth background removal  
8. fal 模型頁搜尋摘要 — **$0.001 per megapixel**  
9. `scripts/verify-models.ts --probe`（**無 --yes**）— needs 拒探  
10. `server/services/generationCore.ts` — 來源攔截、扣退點路徑  
11. `shared/scenarioPlaybook.ts` — 去背 playbook 現列 Bria 基礎＋nano-banana（與 recipe 差一截）  

**未做：** FAL_KEY live 生成、空輸入 L1 `--yes`、站內真扣點 e2e、改 `verified`／`points` 寫入 `models.ts`。
