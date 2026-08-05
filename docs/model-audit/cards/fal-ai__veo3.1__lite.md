# fal-ai/veo3.1/lite

> 審計：R3 · index **#112** · 模式 **static+research（零 live）** · 2026-08-05  
> slug：`fal-ai__veo3.1__lite`  
> 禁止改 `verified`／`points`（本卡僅建議）；**禁止 `--yes`**

## 1. 身分

| 項 | 值 |
|----|-----|
| id / endpoint | `fal-ai/veo3.1/lite`（`endpointOf` 同字串，無 alias） |
| label | Veo 3.1 Lite(Google) |
| category / kind | **text-to-video** · video |
| tier | **economy** |
| points | **5** |
| cost（目錄） | `720p $0.03/秒(無音)–$0.05(含音)、1080p $0.05–0.08/秒;按秒計費,點數為 6 秒基準` |
| verified | **true**（既有；本回合**未**改碼、未觸 live。OpenAPI **200** 已證端點存在；出片仍缺 live） |
| needs | 無（純文生，無來源素材） |
| recommended | **false**（models-index） |
| strengths | Veo 質感的超低價版;含音只要 $0.05/秒 |
| bestFor | 量產日常 B-roll、空鏡、活動預告 |
| 供應商 | Google **Veo 3.1 Lite** · fal 託管 queue（`x-fal-metadata.endpointId`=`fal-ai/veo3.1/lite`） |
| 姊妹 | **Veo 3.1** t2v（31 點／旗艦）；**Veo 3.1 Fast** t2v（16 點／經濟）；**Veo 2** t2v（58–78 點區間依覆寫）；**Veo 3.1 i2v**（31 點）；OpenAPI 另有 **`fal-ai/veo3.1/lite/image-to-video`**（**未**收錄本目錄） |
| models.ts 註解 | 「點數以『無音』中價計 (0.03+0.05)/2」——**與 runtime 不符**：`parseRealCost` 只吃到首個 `$0.03`（無音單價），非中價 0.04；且官方預設 **含音** |

**一句話**：Google Veo **超低價**文生影片——OpenAPI 已通；站內只送 `prompt`+`aspect_ratio`，吃官方預設 **8s · 720p · generate_audio=true**；扁平 **5 點**只對齊 **~$0.03/秒×5s 無音**，對預設實帳單 **嚴重低估**（見 §2／§8）。

## 2. 數值

| 項目 | 值 |
|------|-----|
| points | **5** |
| cost（目錄） | `720p $0.03/秒(無音)–$0.05(含音)、1080p $0.05–0.08/秒;按秒計費,點數為 6 秒基準` |
| 官方價與單位（目錄＋生態研究） | **720p**：**$0.03/秒**（無音）、**$0.05/秒**（含音）；**1080p**：**$0.05–0.08/秒**；按秒計費 |
| 解析／`parseRealCost` | `usdMid: 0.03` · `multiplier: ×5`（`PRICE_VIDEO_SECONDS=5`）· unitNote「×5 秒（單鏡假設）」——字串形如 `$0.03/秒(無音)–$0.05(含音)`，範圍號**不**被認成 `$a–b`，故**只取 0.03** |
| `realPricePoints`／覆寫 | `0.03 × 5 × 31 = 4.65` → **round 5**（與目錄／校準報告 4.6≈ 一致） |
| `estimatePoints`（扁平） | **5**（與 prompt 長度無關；**不**隨 duration／resolution／generate_audio 變動） |
| 估值 NT$（假設 1 點≈NT$1） | **≈ NT$4.6–5.0**（校準報告 4.6 ≈） |
| 時長／解析假設（站內實際送出） | 站內 **不送** `duration`／`resolution`／`generate_audio` → 吃官方預設 **`8s` + `720p` + 音訊開** |
| 校準判定 | 與 **5s@720p 無音** **≈**；與 cost「**6 秒基準**」**不一致**（6s 無音應 ≈6）；與 **官方預設 8s+含音** **嚴重低估**（≈12 點） |

**階梯示意（按目錄 $/秒 × 秒 ×31；非站內扣點）**

| 設定 | 約 USD | 約 NT$（×31） | vs 固定 5 點 |
|------|--------|---------------|--------------|
| **5s · 720p · 無音**（估點假設） | 0.15 | **~5** | **≈** |
| 6s · 720p · 無音（cost 文案「6 秒基準」） | 0.18 | ~6 | 略低估 |
| 4s · 720p · 無音（可送 `duration:"4s"`） | 0.12 | ~4 | 平台略高估 |
| **8s · 720p · 含音（官方 default）** | **0.40** | **~12** | **低估 ~2.5×** |
| 6s · 720p · 含音 | 0.30 | ~9 | 低估 |
| 8s · 720p · 無音 | 0.24 | ~7 | 低估 |
| 8s · **1080p** · 含音（~$0.08/秒） | ~0.64 | ~20 | 嚴重低估 |
| 8s · 1080p · 無音（~$0.05/秒） | 0.40 | ~12 | 低估 |

**文件債（cost／註解）**

1. 寫「點數為 **6** 秒基準」但 `PRICE_VIDEO_SECONDS=5` 且 0.03×5×31→5；0.03×6×31≈**6**。  
2. models.ts 註解「無音中價 (0.03+0.05)/2」→ 理論 0.04×5×31≈**6**，但 `parseRealCost` 實為 **0.03**→5。  
3. **核心**：官方 default **8s + generate_audio=true**，估點卻用 **5s 無音**——顯示／扣點／退點內部一致為 5，但**平台對 fal 帳單倒貼**。

**對照家族（扁平估點錨）**：旗艦 Veo 3.1 ≈$0.20/秒×5→**31**；Fast ≈$0.10/秒×5→**16**；Lite 無音 $0.03/秒×5→**5**（約旗艦 1/6、Fast 1/3）。Lite 是「Veo 乾淨寫實、開源級單價」的量產位；**不是**免費／budget 預覽（LTX 1 點）。

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| 靜態契約（L0） | **ok** — `MODELS` 唯一 id、category∈CATEGORIES、必填欄齊（label/points/cost/tier/verified/strengths/bestFor/input）；`needs` 無；`endpointOf`＝id |
| OpenAPI（研究） | **HTTP 200** · `GET …/openapi.json?endpoint_id=fal-ai/veo3.1/lite` · schema **`Veo31LiteInput`**／**`Veo31LiteOutput`**（title: Veo31LiteTextToVideo*） · `x-fal-metadata.endpointId`=`fal-ai/veo3.1/lite` · category=`text-to-video` |
| Lite i2v 姊妹 OpenAPI | **HTTP 200** · `fal-ai/veo3.1/lite/image-to-video` · `Veo31LiteImageToVideoInput`（required: `prompt`+`image_url`）· **未**入 `MODELS` |
| dry-run probe | 本環境 **無 FAL_KEY**；`verify-models.ts --probe` 退出「無法真實探測」；**未**送 queue |
| 歷史連通 | `docs/fal端點連通報告.md` **未列**本 id；`docs/fal生態研究.md` 標 ✅已查證價；本輪 OpenAPI 升為存在性已證 |
| playground／模型頁 | https://fal.ai/models/fal-ai/veo3.1/lite · API https://fal.ai/models/fal-ai/veo3.1/lite/api（本環境 HTML **429**／Vercel checkpoint；OpenAPI 可讀） |
| live probe（L4） | **未跑**（R3 static+research；**禁止 `--yes`**；預設 8s 含音實費 ~$0.40，不宜當「5 點」硬 live） |
| 結論 | **ready-static-only** — 契約與官方 schema／base 定價字串一致、`verified` 已 true；**估點 vs 預設 8s+含音** 與 **1:1 aspect** 為核心風險；本回合無新 live 出片 |

### OpenAPI 摘要（2026-08-05 本輪 curl）

- **Queue**：`https://queue.fal.run` · paths 含 submit／status／cancel／result  
- **required**：僅 `prompt`  
- **properties**（`x-fal-order-properties`）：
  - `prompt` — string，maxLength **20000**（example：藍鯨深海 cinematic）
  - `aspect_ratio` — enum **`16:9`｜`9:16` 僅此二**，default **`16:9`**（**無 `1:1`／`auto`／`4:3`**）
  - `duration` — enum **`4s`｜`6s`｜`8s`**，default **`8s`**
  - `resolution` — enum **`720p`｜`1080p`**，default **`720p`**（**無 4k**，異於旗艦 Veo 3.1）
  - **`generate_audio`** — boolean，default **`true`**
  - `negative_prompt` — string｜null（可選）
  - `seed` — integer｜null（可選）
  - `auto_fix` — boolean，default **`true`**（違規提示自動改寫重試）
  - `safety_tolerance` — enum **`"1"`…`"6"`**，default **`"4"`**
- **Output**：僅 **`video`**（File）required — **無** seed echo  
- **about 摘要**：lightweight／cost-effective Veo 3.1；支援 720/1080、4/6/8s、16:9 與 9:16、音訊開關  

## 4. 底層邏輯

### 4.1 站內力學

| 層 | 說明 |
|----|------|
| `modelMechanicsFor` | **family: `dit`** ·「時序 DiT（Diffusion Transformer）」— path 命中 `veo` 正則 |
| 文字塔 | `textEncoderProfileFor` → **`video-closed`**（`/kling\|veo\|luma|…/`）·「閉源影片模型（未公開）」；不可量 token 窗口 |
| 條件／時間 | 潛空間 patch + 時序一致性；Lite 為 Veo 3.1 輕量變體，仍可 **joint 原生音訊**（`generate_audio`） |
| 輸出 | OpenAPI：`video` only（**無** output seed） |

### 4.2 站內 `input()` vs 官方

站內（`shared/models.ts` L1141–1147）：

```ts
// 點數以「無音」中價計(0.03+0.05)/2,與 Kling 2.6 等音訊開關型一致;開音訊實際費用較高
input: (p, f) => ({ prompt: p, aspect_ratio: aspect(f) })
// aspect = (f) => f  → 送出 "16:9" | "9:16" | "1:1"
```

三比例快照：

| format | 站內 body | OpenAPI |
|--------|-----------|---------|
| `16:9` | `{ prompt, aspect_ratio: "16:9" }` | `prompt` ✅；`aspect_ratio` ✅ enum |
| `9:16` | `{ prompt, aspect_ratio: "9:16" }` | 同上 ✅ |
| `1:1` | `{ prompt, aspect_ratio: "1:1" }` | **❌ 不在 enum** → 預期 **422／校驗失敗** |

| 能力 | 站內 | 官方 | 備註 |
|------|------|------|------|
| `prompt` | ✅ 必送 | ✅ required | max 20000；世界觀／卡片錨點可注入正向 |
| `aspect_ratio` | ✅ 每請求送專案 format | 僅 16:9／9:16 | **P0：1:1 危險** |
| `duration` | ❌ 不送 | 預設 **`8s`** | **P0**：估點用 5s；實出 8s |
| `resolution` | ❌ 不送 | 預設 **`720p`** | 與低價錨一致；勿誤以為 1080p |
| **`generate_audio`** | ❌ 不送 | 預設 **true** | **P0**：估點用**無音** $0.03；實為**含音** $0.05 |
| `negative_prompt` | 不注入（allowlist **無** Veo） | schema **有** | 禁忌僅自正向移除；可考慮 allowlist（見 §8） |
| `seed` | 不送（SEED allowlist **無**） | schema **有** | 消融無法鎖噪聲；output **無** seed echo |
| `auto_fix`／`safety_tolerance` | 不送 | 預設 true／4 | 合理吃預設 |

**契約健康度**：**形狀半健康、估點危**——16:9／9:16 與 prompt 健康；**1:1 會炸**；**duration=8s + 含音** 使扁平 5 在實帳單上不可靠。`NEGATIVE_PROMPT_SUPPORTED` 註解「刻意不收 Veo」——但 **Lite schema 明確有 `negative_prompt`**，與舊註解部分過時。

### 4.3 generationCore 路徑

```
estimatePoints → 5（扁平；非 TTS 動態）
→ reserveQuota(5)
→ falSubmit("fal-ai/veo3.1/lite", { prompt, aspect_ratio })
→ 失敗 refund(5)
→ 供應商按秒×解析×音訊計費；預設 8s 含音可能使平台成本 ≈ $0.40 ≫ 5 點
```

- 世界觀禁忌：`supportsNegativePrompt===false` → **不會**附加 `negative_prompt`  
- seed：未 allowlist → 消融無法鎖噪聲  
- 1:1 專案：body 仍送 `aspect_ratio:"1:1"` → 供應商側失敗風險高  

### 4.4 與 Veo 3.1／Fast／i2v 對照

| | Veo 3.1（#97 未卡） | Veo 3.1 Fast（#100 未卡） | **Lite（本 #112）** | Lite i2v（未收錄） |
|--|---------------------|---------------------------|---------------------|---------------------|
| id | `fal-ai/veo3.1` | `fal-ai/veo3.1/fast` | **`fal-ai/veo3.1/lite`** | `fal-ai/veo3.1/lite/image-to-video` |
| tier／points | flagship／**31** | economy／**16** | economy／**5** | — |
| 預設 duration（OpenAPI 本輪） | **8s**（同族） | （本輪 fast HTML/連線不穩；族內常見 4/6/8s） | **8s** | **8s** |
| resolution | 720p／1080p／**4k** | 720p／1080p 級 | **720p／1080p only** | 720p／1080p |
| aspect | 16:9／9:16 | 同族 | **16:9／9:16 only** | 同 |
| 原生音訊 | 有（較貴） | 有 | 有（$0.05/秒@720p） | 有 |
| bestFor 重心 | 正式成片＋對白 | 快迭代再升旗艦 | **量產 B-roll／空鏡** | 圖生輕量（未收） |

## 5. 站內點數

| 項 | 說明 |
|----|------|
| 目錄 points | **5**（`realPricePoints` 自 cost 首個 $/秒 0.03 ×5×31 覆寫一致） |
| 預估／扣點 | `estimatePoints` = 5；與 prompt 字數無關 |
| UI | 挑選器／配方／showdown 顯示與 `MODELS[].points` 同源 |
| 退點 | 生成失敗 terminal + 帳本退點；本回合**未**做 L5 真扣點 |
| BYOK | 若走使用者自備 key，點數實際可為 0（平台 key 才扣 est）— 通用規則 |
| 顯示＝扣＝退 | **5 內部一致** |
| 與真實成本 | **僅在 ~5s@720p 無音 時 ≈**；**預設 8s+含音 ≈12 點**、1080p／長秒時平台**低估**；若未來固定 `4s`+無音則略**高估** |
| 組核准 | 5 點經濟檔通常**低於**高額門檻——**風險是帳單倒貼而非門檻**，反而更危險（使用者以為便宜狂跑） |

## 6. 情境與可用性

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 量產日常 B-roll／空鏡 | ✅ | bestFor 本意；Veo 乾淨寫實、單價接近開源 |
| 活動預告（橫／直） | ✅ | 16:9／9:16 官方支援 |
| 含環境音／輕對白、仍控成本 | △ | 官方預設已含音；**估點未反映**；真實 ~$0.05/秒 |
| 正式旗艦成片／關鍵鏡頭 | ❌ | 升 **Veo 3.1** 31 或 Kling O3；Lite 定位量產 |
| 快迭代方向感 | △ | **Fast 16** 質感／速度定位更準；Lite 更偏省錢量產 |
| 社群 **1:1** | ❌ | enum **無 1:1**——會失敗或需改 format |
| 畫面內中文字 | ❌ | 影片族不渲染可靠中文字；字卡另疊（生態研究通病） |
| 圖生影片 | ❌ 本 id | 僅 t2v；外部有 Lite i2v 未收錄；旗艦 i2v 走 `fal-ai/veo3.1/image-to-video` |
| 中文提示理解 | ✅ 可用 | 生態：中文提示可；畫面內中文仍不可靠 |
| Recipe `sc-t2v-sound` | ❌ 未收 | pickIds=Veo 3.1／Kling 2.6 Pro／Wan 2.5——**勿**默默換成 Lite 當「有聲旗艦」 |
| 手動選模 | ✅ | category text-to-video，needs 無；**1:1 專案應避開** |
| 助手／代理 | ✅ 可被選 | `verified:true`；**recommended:false**；budget 偏好下分數尚可，但勿當免費預覽 |
| MCP | ✅ | `find_model` 可命中 keyword「Veo／Lite／B-roll／空鏡」 |

**文案一致性**：strengths／bestFor 與目錄／生態研究「超低價 Veo、量產 B-roll」一致。cost「6 秒基準」與 runtime 5s／5 點**不一致**；註解「無音中價」與 parse **不一致**；**與預設 8s 含音更不一致**——P0／P1 文件＋估點債。

## 7. MCP / 文件

| 項 | 值 |
|----|-----|
| MCP `find_model` | category=`text-to-video`、keyword「Veo／3.1／Lite／B-roll／空鏡／經濟」、tier=economy、points=5 |
| MCP `submit_generation` | 建議 body：`projectId` + `modelId` + `prompt`；專案 format **限 16:9 或 9:16**；**勿**假設 1:1；**勿**假設只扣 5 點就等於 8s 含音帳單 |
| 文件 | [fal 模型頁](https://fal.ai/models/fal-ai/veo3.1/lite) · [API](https://fal.ai/models/fal-ai/veo3.1/lite/api) |
| OpenAPI | `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/veo3.1/lite` |
| Lite i2v（未收錄） | OpenAPI `endpoint_id=fal-ai/veo3.1/lite/image-to-video` |
| 定價摘要 | 720p **$0.03/秒**無音／**$0.05/秒**含音；1080p **$0.05–0.08/秒**；點數錨 **5s@720p 無音→5**；**預設實跑 8s 含音→~$0.40≈12 點** |
| 站內 | `shared/models.ts` L1141–1147；`docs/點數校準報告.md` 4.6≈；`docs/fal生態研究.md` ✅價；`docs/模型目錄.md` 經濟列 |

**建議 MCP 形狀**（控費：短提示、**接受預設 8s 含音但認知實費**；理想應先修 input 固定 duration／音訊後再大量呼叫）：

```json
{
  "projectId": "<uuid>",
  "modelId": "fal-ai/veo3.1/lite",
  "prompt": "清晨山徑薄霧緩移，低角度慢推至石燈籠，遠處鳥鳴與風過松針，柔和側光，寫實空鏡，運鏡平穩，無人無字幕"
}
```

## 8. 建議動作

- [x] **維持** id=`fal-ai/veo3.1/lite`（OpenAPI 證實）
- [x] **維持** points=5 本輪不改（對齊機械換算 0.03×5×31；禁止自動改）
- [x] **維持** verified 既有 true（端點存在；live 仍缺——**禁止**本回合改 verified）
- [ ] 調 points — **建議後續**：若繼續吃預設 **8s+含音** → 應 ≈ **12**（0.05×8×31）；或固定無音短秒後維持 5–6
- [ ] 修 input — **P0**（見下）
- [ ] verified true — **已是 true**；live 後可保留
- [ ] 下架或隱藏 — **否**；量產定位正確，但需修估點／1:1
- [ ] **P0**：`duration` 固定 `"4s"` 或 `"6s"`（貼近 5 點錨）**或** 暴露時長並 **按秒×音訊** 動態 `estimatePoints`（預設 8s 含音 ≈12）
- [ ] **P0**：`generate_audio: false` 對齊無音估點 **或** 估點改含音費率（與註解「開音訊較高」誠實一致）
- [ ] **P0**：`aspect_ratio` — 1:1 時改映射 `16:9`／拒絕送出／UI 禁用（否則 422）
- [ ] **P1**：cost 文案「6 秒基準」→「約 5 秒@720p 無音」或重算；註解「中價 0.04」→「首個 $/秒=無音 0.03」
- [ ] **P2**：可選 `NEGATIVE_PROMPT_SUPPORTED` 收本 id（schema 有；異於舊「Veo 全不收」註解）
- [ ] **P2**：可選 `SEED_SUPPORTED` 收本 id（input 有 seed；output **無** echo——消融僅能鎖請求側）
- [ ] **P3**：是否收錄 `fal-ai/veo3.1/lite/image-to-video` 作經濟 i2v
- [ ] **P3**：解析 UI 聯動估點；1080p 含音 8s ≈20 點量級明示
- [ ] L1 有效 probe — 有 FAL_KEY 時空輸入 `{}` 期望 **422 OK_VALIDATED**（勿 --yes 生成）
- [ ] L4 live — 控費單次：先修 duration／audio 估點，再**人工** `--yes`；現況預設實費 ~$0.40

**優先級（僅建議）**

| 級 | 項 |
|----|-----|
| **P0** | duration／generate_audio 與扁平 5 對齊（固定短秒+無音 **或** 動態估點≈12）；**禁裸送 1:1** |
| **P1** | cost「6 秒基準」與註解「中價」對齊 runtime parse |
| **P2** | negative／seed allowlist 評估；1080p 估點聯動 |
| **P3** | Lite i2v 收錄評估；Recipe **不**把有聲旗艦換成 Lite |
| — | **不**當 LTX 級 1 點預覽；**不**與 Veo 3.1 31 點旗艦混用定位 |

## 9. 來源

1. OpenAPI Queue 2026-08-05：`endpoint_id=fal-ai/veo3.1/lite` → `Veo31LiteInput`／`Output` 全表（duration 4s｜6s｜8s default **8s**、resolution 720p｜1080p default 720p、generate_audio default **true**、aspect **僅** 16:9｜9:16、negative_prompt／seed／auto_fix／safety_tolerance；output **僅 video**）  
2. OpenAPI Lite i2v：`endpoint_id=fal-ai/veo3.1/lite/image-to-video` → required prompt+image_url（**未**收錄）  
3. 姊妹 OpenAPI 抽樣：`fal-ai/veo3.1` aspect／duration 同構（default 8s；旗艦另有 4k）  
4. 定價：目錄 cost 字串 + `parseRealCost`／`realPricePoints`（0.03×5×31=5）；`docs/點數校準報告.md` 4.6≈；模型頁本環境 429  
5. 站內：`shared/models.ts` L1141–1147（entry／input／註解）、`PRICE_VIDEO_SECONDS=5`、SEED／NEGATIVE allowlist（**無**本 id；註解寫刻意不收 Veo）  
6. `shared/modelMechanics.ts`（dit／veo）、`shared/textEncoders.ts`（video-closed）  
7. `server/services/generationCore.ts`（input／negative／seed／quota／refund）  
8. MCP：`server/services/mcp.ts`、`shared/mcpCatalog.ts`；Recipe `sc-t2v-sound` **未**收本 id  
9. `docs/fal生態研究.md`（✅價、量產 B-roll）、`docs/模型目錄.md`、`docs/點數校準報告.md`  
10. 姊妹對照：Veo 3.1／Fast／Veo 2 t2v；Veo 3.1 i2v；未收錄 Lite i2v  

---

**R3 checklist（#112）**

- [x] L0 靜態契約  
- [x] OpenAPI／定價研究（t2v + Lite i2v 姊妹；無 `--yes` live）  
- [x] 點數校準對照（5s 無音≈5；6s 文案債；**預設 8s 含音≈12 低估**）  
- [x] input vs schema 差異（16:9／9:16 健康；**1:1 P0**；duration／audio 預設 P0）  
- [x] MCP／助手／情境交叉（勿當旗艦有聲；modelId 完整 `fal-ai/veo3.1/lite`）  
- [x] 九章卡 + `_index` #112 + heartbeat  
- [x] **未**改 verified／points；**未** live 扣費  
