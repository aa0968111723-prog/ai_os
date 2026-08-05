# fal-ai/wan-vace-14b/outpainting

> 審計：R4 · index **#169** · static+research · **零 live** · 2026-08-05  
> slug：`fal-ai__wan-vace-14b__outpainting` · 單一真相：`shared/models.ts`  
> **禁止 --yes**／needs=video 拒探。未改 points／verified。

## 1. 身分

| 欄位 | 值 |
|------|-----|
| id / endpoint | `fal-ai/wan-vace-14b/outpainting`（`endpointOf` = id，**無** alias） |
| label | Wan VACE 影片外擴 |
| category | `video-to-video`（影片轉影片） |
| tier | **economy** |
| kind | `video` |
| points | **9** |
| cost | `依 Wan 秒計費(≈$0.04–0.08/秒);按秒計費,點數為 6 秒基準` |
| verified | **false** |
| recommended | **false** |
| needs | **video**（要外擴的影片網址） |
| secondaryNeeds | （無） |
| sourceHint | 要外擴的影片網址 |
| strengths | 補出畫面外內容、改變畫幅比例 |
| bestFor | 舊 4:3 開示外擴 16:9、直橫式互轉 |
| 供應商／底層 | **Wan 2.1 VACE 14B**（阿里 Wan-AI 系可控影片）via fal；group `wan-vace-14b`／**Outpainting**；tags `image-to-video`／`video-to-video`／`text-to-video`；license **commercial** |
| 角色定位 | 站內 **影片畫幅外擴／reframe** 經濟檔；情境卡 **`sc-reframe-vertical` 第一順位**（橫式→直式 Shorts；靜態用 `fal-ai/bria/expand`） |
| 姊妹端點（同 group） | `…/inpainting`、`…/depth`、基底 `fal-ai/wan-vace-14b`、`fal-ai/wan-vace`（全能可控）；另有 apps：`wan-vace-apps/video-edit`、`…/long-reframe` |

**一句話**：來源影片 **往指定邊外補內容**（outpaint／改畫幅），靠 `prompt`＋`video_url`＋`expand_*` 邊與 `expand_ratio`；官方按 **輸出秒×解析**（480p $0.04／580p $0.06／720p $0.08，**以 16fps 算秒**）；站內固定 **9 點** ≈ 中價 $0.06×**5 秒**。

**L0 靜態契約：** **ok（形狀）／⚠ 行為缺口**  
- 必填欄齊；`category ∈ CATEGORIES`；id 唯一；`input` 可呼叫。  
- OpenAPI **required = `prompt` + `video_url`** ↔ 站內 `{ video_url: s, prompt: p }` **形狀對齊**。  
- ⚠ 站內 **不送** `expand_left|right|top|bottom`／`expand_ratio`／`match_input_num_frames`／`aspect_ratio`——見 §4（**P0 產品風險**）。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| points（目錄扁平） | **9** |
| cost 字串 | `≈$0.04–0.08/秒`；文案寫 **6 秒基準** |
| 官方價（fal 模型頁搜尋摘要 2026-08） | **720p $0.08／580p $0.06／480p $0.04 per video second**；**Video seconds @ 16 frames/s** |
| 計費性質 | **按秒×解析度**（與 Wan 2.2 族同級距）；非 MP |
| `parseRealCost` | usdMid=**0.06**（(0.04+0.08)/2）；`/秒` → multiplier=**`PRICE_VIDEO_SECONDS=5`** → unitNote「×5 秒（單鏡假設）」 |
| `realPricePoints` | **round(0.06×5×31)=round(9.3)=9** → 與目錄 **一致**（載入時覆寫仍 9） |
| `estimatePoints` | 扁平 **9**（**不**隨片長／解析／expand 變動） |
| 匯率 | USD×**31** ≈ NT$ |
| 校準報告列 | Wan VACE 影片外擴 ⚠︎ · 9 · usdMid 0.060 · ×5s · 估值 **9.3** · 判定 **≈** |

### 2.1 粗估（官方分檔秒價 ×31）

| 假設 | USD | 約 NT$／點 | vs 固定 9 |
|------|-----|------------|-----------|
| **5s × mid $0.06**（機械估點） | **0.30** | **9.3** | **≈9 對齊** |
| 5s × 480p $0.04 | 0.20 | 6.2 | 固定略偏貴 |
| 5s × 580p $0.06 | 0.30 | 9.3 | **≈** |
| 5s × 720p $0.08 | 0.40 | 12.4 | **偏低 ~3 點** |
| 6s × mid（cost 文案基準） | 0.36 | 11.2 | 文案 6s vs 機械 5s **文案債** |
| 預設 **81 幀 ÷ 16fps ≈ 5.06s** × mid | 0.304 | 9.4 | **≈9** |
| 15s × mid（若 match 長片） | 0.90 | 27.9 | **嚴重偏低** |
| 30s × 720p | 2.40 | 74.4 | 長片倒掛 |

**解讀**

1. **points=9** ＝中價秒費×**5 秒**機械換算，**校準 ≈**；與校準報告一致。  
2. cost 寫「**6 秒基準**」但 `PRICE_VIDEO_SECONDS=5` → 估值差 ~2 點級——**文案債**，非必須改 points。  
3. 官方預設輸出約 **81 幀 @ 16fps ≈ 5s**，與 5 秒估點 **巧合對齊**；一旦 `match_input_num_frames=true` 或長片，扁平 9 **平台吃虧（P0 估點脫鉤）**。  
4. resolution 預設 **auto**（可到 720p）；720p 實價 5s≈12 點，固定 9 略低估。  
5. 與 **Bria Expand**（圖、$0.023/次、1 點）：影片 reframe 才用本模；靜態首格用 Bria——recipe 分工正確。

**結論（L2 定價）：** 官方秒價 **已查證**；$0.04–0.08 區間與 cost 一致；**points=9 ≈ mid×5s**；**本回合勿改 points**。風險在 **長片／720p 固定點** 與 **input 預設可能根本不擴邊**（§4）。

**本回合禁止改 `models.ts` 的 points／verified。**

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| 靜態契約 L0 | **ok** — id／category／needs／`input → {video_url, prompt}` 雙 required 形狀 |
| OpenAPI Queue | **HTTP 200** · `GET …/openapi.json?endpoint_id=fal-ai/wan-vace-14b/outpainting` · openapi **3.0.4** · schema `WanVace14bOutpaintingInput`／`Output` |
| 平台 metadata | **HTTP 200** · status **active** · display_name **Wan VACE 14B** · category video-to-video · license **commercial** · updated **2026-04-21** · group Outpainting · date 2025-06-18 |
| 模型頁 HTML | 本輪 **429**（反爬）；定價依搜尋摘要＋生態研究交叉 |
| dry-run probe | `verify-models.ts --probe "fal-ai/wan-vace-14b/outpainting"` → **拒探**：「需要來源輸入(影片)…站內以素材實測」（符合 needs 鐵律） |
| L1 空 `{}` --yes | **未跑**（零 live；**禁止 --yes**） |
| L2 live 生成 | **未跑**（需片源；預設 ~5s 亦有實費 ≈$0.20–0.40） |
| 姊妹 OpenAPI 抽樣 | `wan-vace-14b`／`…/inpainting`／`…/depth`／`wan-vace` 皆 **200** |
| 結論 | **ready-static-only**（端點存活＋契約形狀綠＋價對齊；**行為預設有 P0 缺口**；待素材 live） |

---

## 4. 底層邏輯

### 4.1 能力（公開資料）

- **VACE**（Video All-in-one Creation and Editing，Wan 2.1 14B）：可控影片生成／編輯；outpainting 端點專門 **往畫外補內容、改畫幅**。  
- 典型用法：舊 **4:3 → 16:9** 補兩側；**16:9 → 9:16** 補上下（Shorts／Reels）；提示詞描述補區內容（天空、禪堂延伸、虛化背景等）。  
- 與 **Bria Expand**：Bria＝**單張圖** 授權安全擴圖；本模＝**整段影片** 時序外擴。  
- 與 **wan-vace-apps/long-reframe**：apps 線有長片 reframe 定價（摘要 $0.08／**2 秒** 等）——本卡端點為 **14B outpainting 直端**，計費為 **$0.04–0.08／秒 @16fps**。  
- 解析上限 **720p**（enum 無 1080p）；fps 預設 **16**（可 5–30；可 match 輸入）。

### 4.2 站內 input 組裝

```ts
// shared/models.ts
input: (p, _f, s) => ({ video_url: s, prompt: p })
```

| 行為 | 說明 |
|------|------|
| prompt | ✅ 必填——描述外擴區應長什麼 |
| video_url | ✅ 來源片 |
| format `f` | **丟棄**（`_f`）— **不**映射 `aspect_ratio` |
| expand_*／ratio | **不送** → 吃 OpenAPI 預設 |
| match_input_* | **不送** → 幀數／fps **不**跟輸入 |

`prepareGenerationRequest`：缺 video → BAD_REQUEST。  
Output：`video`（VideoFile.url）— `extractResult` 吃 `video.url` **OK**（非陣列；與 #167 VEED 不同）。

### 4.3 官方 OpenAPI `WanVace14bOutpaintingInput` 對照

| Property | 約束 | Required | Default | 站內 | 備註 |
|----------|------|----------|---------|------|------|
| `prompt` | string | **是** | — | ✅ | 外擴內容描述；英文例較長 cinematic |
| `video_url` | string | **是** | — | ✅ | 來源影片 |
| `expand_left` | bool | 否 | **false** | ❌ | **指定左邊擴** |
| `expand_right` | bool | 否 | **false** | ❌ | 右 |
| `expand_top` | bool | 否 | **false** | ❌ | 上 |
| `expand_bottom` | bool | 否 | **false** | ❌ | 下 |
| `expand_ratio` | 0–1 | 否 | **0.25** | ❌ | 各指定邊加 **25%** 尺寸 |
| `aspect_ratio` | `auto`/`16:9`/`1:1`/`9:16` | 否 | **auto** | ❌ | 目標比例；站內 format 未接 |
| `num_frames` | int；schema min **17** max **241**；文案寫 81–241 | 否 | **81** | ❌ | ⚠ min 與 description 不一致 |
| `match_input_num_frames` | bool | 否 | **false** | ❌ | false→固定 ~81 幀，**非整片** |
| `frames_per_second` | 5–30 \| null | 否 | **16** | ❌ | 官方計費秒以 16fps 為準 |
| `match_input_frames_per_second` | bool | 否 | **false** | ❌ | |
| `resolution` | auto/240p–**720p** | 否 | **auto** | ❌ | **無 1080p** |
| `guidance_scale` | 1–10 | 否 | 5 | ❌ | |
| `num_inference_steps` | 2–50 | 否 | 30 | ❌ | |
| `sampler` | unipc/dpm++/euler | 否 | unipc | ❌ | |
| `negative_prompt` | string | 否 | 長預設（含 **letterboxing, borders, black bars**…） | ❌ 不送 | fal 預設仍生效；站內 **未**列入 `NEGATIVE_PROMPT_SUPPORTED` |
| `enable_prompt_expansion` | bool | 否 | false | ❌ | |
| `ref_image_urls` | string[] | 否 | — | ❌ | 參考圖 |
| `first_frame_url` / `last_frame_url` | string\|null | 否 | — | ❌ | 首尾幀錨 |
| `seed` | int\|null | 否 | — | ❌ | 未入 `SEED_SUPPORTED` |
| `acceleration` | none/low/regular | 否 | regular | ❌ | |
| `video_quality` / `video_write_mode` | enum | 否 | high / balanced | ❌ | |
| `enable_safety_checker` | bool | 否 | false | ❌ | |
| 插幀／downsample 等 | 多項 | 否 | film／0… | ❌ | 進階時序 |

**Output `WanVace14bOutpaintingOutput`：** required **`video`** + **`prompt`** + **`seed`**；可選 `frames_zip`。

**Queue：** `https://queue.fal.run` · POST `/fal-ai/wan-vace-14b/outpainting` + status／cancel／result。

### 4.4 與官方差異／風險（P0／P1）

1. **P0 — 四邊 expand 預設全 false**  
   說明：`expand_ratio` 只作用在 **指定 sides**。站內只丟 prompt+video → **可能完全不擴邊**，使用者以為「外擴」卻得到近原畫／無 reframe 效果。  
   **建議修 input（另案 PR）：** 依 format 開邊，例：  
   - 目標 **9:16**（直式）：`expand_top=true, expand_bottom=true`（必要時 left/right）  
   - 目標 **16:9**：`expand_left=true, expand_right=true`  
   - 或四邊 true + `expand_ratio` 可調；並送 `aspect_ratio`。

2. **P0 — 幀數不跟輸入**  
   `match_input_num_frames=false` + `num_frames=81` → 約 **5 秒** 片段，**非整段開示**。長片 reframe 需 `match_input_num_frames: true`（或 auto_downsample）並另做 **按秒 estimatePoints**。

3. **P1 — format 未映射 aspect_ratio**  
   `input` 丟棄 `f`；專案 9:16／16:9 旋鈕不進 fal。

4. **P1 — negative_prompt 未 allowlist**  
   schema 有欄；世界觀禁忌 **不會** 經 `supportsNegativePrompt` 注入（fal 內建 neg 仍擋 letterbox 等）。可選把本 id 加入 `NEGATIVE_PROMPT_SUPPORTED`（另案、需消融）。

5. **P1 — 扁平 9 點 vs 720p／長片**  
   與 lucy／seedvr 同族估點脫鉤。

6. **num_frames 文案 vs schema min**  
   description「81–241」但 minimum=**17**——文件噪音，不影響站內（未送）。

### 4.5 分詞／文字塔

- 有 **prompt**（外擴語意）→ 世界觀／卡片錨點 **可能注入**（video-to-video + 自訂 input 有 p）。  
- 禁忌詞：**不會** 走 negative（未 allowlist）；正向塞「不要黑邊」可能反效果——應靠 expand 邊與預設 neg。  
- 缺來源攔截：`model.needs && !sourceUrl && !sourceAssetId` → BAD_REQUEST。

---

## 5. 站內點數

| 項目 | 說明 |
|------|------|
| 估點 | 扁平 **9**（`realPricePoints` 自 cost 中價×5s 覆寫後仍 9） |
| 扣點 | `reserveQuota(…, est=9)`；成功 `pointsActual` 對齊 |
| 退點 | 失敗／回收 `refund(9)` 對稱 |
| UI | 模型卡 9；cost 述 Wan 秒費；**未**警告「預設可能不擴邊／僅 ~5s」 |
| 與官方 | 官方秒×解析浮動；9 ≈ **mid×5s** 或 **81 幀@16fps**；長片／720p 低估 |
| 本回合 | **未改 points**；未跑真扣點 e2e |

**建議 follow-up（非本卡必改碼）：**  
1. **修 input P0**（expand 邊 + aspect + 建議 `match_input_num_frames: true` 或明示短樣片）。  
2. 長片 **estimatePoints** 按秒（知解析後用 0.04/0.06/0.08）。  
3. cost 文案「6 秒」→「約 5 秒（81 幀@16fps）／機械估點」可選對齊。

---

## 6. 情境與可用性

| 情境 | 適配 | 原因 |
|------|:----:|------|
| 舊 4:3 開示補成 16:9 | △／✅ | **能力在**；現 input **未開左右 expand** → 站內一鍵可能無效 |
| 橫式→直式 Shorts（`sc-reframe-vertical`） | △／✅ | recipe 首選；需 **上下 expand + aspect 9:16**——站內未送 |
| 靜態縮圖／首格擴圖 | ❌ | 用 **Bria Expand**（recipe 第二） |
| 整段 10 分開示一次外擴 | ❌／⚠ | 預設 ~5s；長片成本遠超 9 點 |
| 1080p 輸出 | ❌ | 上限 **720p** |
| 無片純文生 | ❌ | needs=video |
| 局部 inpaint 換物 | ❌ | 用 `…/inpainting` 或 Lucy Edit |
| 助手 requireVerified 自動選 | ❌ | verified=false |
| 手動／情境 recipe | ✅ 可選 | **sc-reframe-vertical** 已掛；verified ⚠ 合理 |

**可用性／文案（L6）**

- strengths／bestFor 與產品定位 **正確**；生態研究「舊 4:3→16:9」一致。  
- **誤導風險**：使用者選「影片外擴」期望 reframe，但預設四邊 false → **效果可能不符合 bestFor**——應修 input 或 UI 強制選邊。  
- sourceHint 清楚；目錄 ⚠︎（未 verified）合理。  
- recommended=false 但進 recipe 第一順位——可接受（情境導流）；修好 expand 前 recipe **why 偏樂觀**。

---

## 7. MCP / 文件

| 項目 | 結果 |
|------|------|
| MCP `find_model` | 目錄同源；「Wan VACE／影片外擴／outpaint／改畫幅／4:3」可命中 |
| MCP `submit_generation` | 可調；**必須** `source_url`（影片）+ 有意義 **prompt** |
| MCP 火力 | 同站內：僅 video_url+prompt；**同樣缺 expand 邊** |
| Playground | https://fal.ai/models/fal-ai/wan-vace-14b/outpainting |
| API 文件 | https://fal.ai/models/fal-ai/wan-vace-14b/outpainting/api |
| OpenAPI | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/wan-vace-14b/outpainting |
| 本回合 HTTP | OpenAPI **200**；metadata **200 active**；模型頁 **429**；官方秒價搜尋摘要 ✅ |

---

## 8. 建議動作

- [x] **維持 id／endpoint／category／needs／points=9／verified=false** — 端點 active；9≈mid×5s；**本回合不改 points／verified**  
- [x] **input 形狀維持雙 required** — `prompt`+`video_url` 與 OpenAPI 一致  
- [ ] **P0 修 input** — 依目標畫幅開啟 `expand_left/right/top/bottom`（至少對 recipe 直式開 top+bottom、橫式開 left+right）；送 `aspect_ratio`（map 自 format）；建議 `match_input_num_frames: true` 或產品標「僅短樣 ~5s」  
- [ ] **P0 估點脫鉤（長片）** — 另案按秒×解析 estimatePoints；或硬上限秒數  
- [ ] **P1 文案** — cost「6 秒基準」對齊機械 5s／81 幀；UI 提示「需指定擴邊／預設短片」  
- [ ] **P2** — `NEGATIVE_PROMPT_SUPPORTED`／`SEED_SUPPORTED` 可選納入本 id  
- [ ] **verified true** — **勿擅自改**；須 input 行為修完 + 站內短片 live 成功後人工開  
- [ ] **下架或隱藏** — **否**；能力與 commercial 定位有效；阻塞在 **預設參數** 非 slug 死亡  
- [ ] **Live 佇列（可選，控費）** — 最短片 + 顯式 expand 兩邊；估 **$0.20–0.40／~5s**；**禁止本回合 --yes**  
- [ ] **recipe** — `sc-reframe-vertical` 在 P0 修好前 why 可降調「需正確擴邊參數」

**總建議標籤（寫入 _index）：** `P0 修 input（expand_* 預設全 false 不擴邊；幀數~5s）；9≈mid×5s；ready-static-only`

### 本回合狀態燈（供 `_index`）

| L0 | L1 | L2 live | 建議 |
|----|----|---------|------|
| ✅（形狀）⚠ 行為 | 📄 OpenAPI active | 未跑（needs） | **P0 修 input（expand 邊）**；points 維持 9 |

---

## 9. 來源

1. `shared/models.ts` — `fal-ai/wan-vace-14b/outpainting`（~1614–1622）、`sc-reframe-vertical`、`parseRealCost`／`PRICE_VIDEO_SECONDS=5`／`USD_TO_TWD=31`、`NEGATIVE_PROMPT_SUPPORTED`（未列本 id）  
2. `docs/model-audit/models-index.json` — index **169** · slug `fal-ai__wan-vace-14b__outpainting`  
3. `docs/fal生態研究.md` — Wan VACE 14B 外擴 ✅已查證；舊 4:3→16:9；`fal-ai/wan-vace` $0.20/支  
4. `docs/點數校準報告.md` — Wan VACE 影片外擴 · 9 · **≈**（usdMid 0.060×5s→9.3）  
5. `docs/模型目錄.md`／`docs/模型清查清單.md` — ⚠︎ 未驗證；需影片素材實測  
6. fal OpenAPI（本回合 curl **200**）— `WanVace14bOutpaintingInput`／`Output`（required prompt+video_url；expand_* 預設 false；num_frames 81；fps 16；resolution≤720p）  
7. fal metadata API — status **active**、display_name Wan VACE 14B、license **commercial**、group Outpainting  
8. fal 模型頁搜尋摘要 — **$0.08／$0.06／$0.04 per video second**（720／580／480；**16fps**）  
9. `scripts/verify-models.ts --probe`（**無 --yes**）— needs 拒探  
10. `server/services/fal.ts` `extractResult` — `video.url` 物件形狀 **OK**  
11. `server/services/generationCore.ts` — 來源攔截、扣退點路徑  
12. 對照：`fal-ai/bria/expand`（靜態擴圖）、`decart/lucy-edit`（#168 改片）、`wan-vace-apps/long-reframe`（長片 reframe 定價另線）

**未做：** FAL_KEY live 生成、空輸入 L1 `--yes`、站內真扣點 e2e、改 `verified`／`points`／`input` 寫入 `models.ts`（P0 修 input **僅記錄**，另案 PR）。
