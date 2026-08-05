# bytedance/seedance-2.0/text-to-video

> 審計：R3 · index **#111** · 模式 **static+research（零 live）** · 2026-08-05  
> slug：`bytedance__seedance-2.0__text-to-video`  
> 禁止改 `verified`／`points`（本卡僅建議）；**禁止 `--yes`**

## 1. 身分

| 項 | 值 |
|----|-----|
| id / endpoint | `bytedance/seedance-2.0/text-to-video`（`endpointOf` 同字串；**無** `fal-ai/` 前綴，與 Seedance 1.x 命名空間不同） |
| label | Seedance 2.0(字節) |
| category / kind | **text-to-video** · video |
| tier | **flagship** |
| points | **47** |
| cost（目錄） | `720p $0.3034/秒、1080p $0.682/秒(標準檔,含音免費);Fast 720p $0.2419/秒;按秒計費,點數為 6 秒基準` |
| verified | **true**（既有；本回合**未**改碼、未觸 live。OpenAPI **200** 已證端點存在；出片仍缺 live） |
| needs | 無（純文生，無來源素材） |
| recommended | **false**（models-index） |
| strengths | 字節最新世代旗艦;寫實與可控性再升級 |
| bestFor | 最高規寫實成片;先小量試跑再定主力 |
| 供應商 | ByteDance Seed **Seedance 2.0** · fal 託管 queue（`x-fal-metadata.endpointId` 同 id） |
| 姊妹 | **1.0 Pro** t2v（19 點／預設 1080p **無音**）；**1.5 Pro** t2v（8 點／720p **含音**）；Lite t2v（6 點）；1.5 Pro i2v；**Fast** 變體 `bytedance/seedance-2.0/fast/text-to-video`（OpenAPI 200，**未**收錄本目錄；僅 480p/720p） |
| models.ts 註解 | 仍寫「slug 推定…暫依 1.0 Pro 估點」——**過時**；OpenAPI 已證、價為按秒（見 §9 建議） |

**一句話**：字節 **2026 最高規寫實** 文生影片——OpenAPI 已通；預設 **720p + duration=`auto` + 含音（免費）**；站內 **47 點**對齊 **720p×$0.3034/秒×5s**（`PRICE_VIDEO_SECONDS`）。**極貴**，且 **auto 時長**使扁平估點可能嚴重低估——勿當日常草稿。

## 2. 數值

| 項目 | 值 |
|------|-----|
| points | **47** |
| cost（目錄） | `720p $0.3034/秒、1080p $0.682/秒(標準檔,含音免費);Fast 720p $0.2419/秒;按秒計費,點數為 6 秒基準` |
| 官方價與單位（目錄＋cost 字串） | **標準檔按秒**：720p **$0.3034/秒**、1080p **$0.682/秒**；**含音不另加價**（OpenAPI：`generate_audio` 說明 cost same regardless）；Fast 720p **$0.2419/秒**（Fast **未**收錄） |
| 解析／`parseRealCost` | `usdMid: 0.3034` · `multiplier: ×5`（`PRICE_VIDEO_SECONDS=5`）· unitNote「×5 秒（單鏡假設）」——取 cost 內**首個** `$…/秒` |
| `realPricePoints`／覆寫 | `0.3034 × 5 × 31 = 47.027` → **round 47**（與目錄一致；runtime 覆寫後仍 47） |
| `estimatePoints`（扁平） | **47**（與 prompt 長度無關；**不**隨 duration／resolution／bitrate／audio 變動） |
| 估值 NT$（假設 1 點≈NT$1） | **≈ NT$47.0**（校準報告 47.0 ≈） |
| 時長／解析假設（站內實際送出） | 站內 **不送** `duration`／`resolution`／`generate_audio`／`bitrate_mode` → 吃官方預設 **`auto` + `720p` + 音訊開 + standard** |
| 校準判定 | 與 **5s@720p standard** **≈**；與 cost 字串「**6 秒基準**」**不一致**（6s 應 ≈56 點）。**auto 時長**下平台可能**嚴重低估** |

**階梯示意（按目錄 $/秒 × 秒 ×31；非站內扣點）**

| 設定 | 約 USD | 約 NT$（×31） | vs 固定 47 點 |
|------|--------|---------------|---------------|
| **5s · 720p · std**（估點假設） | ~1.52 | **~47** | **≈** |
| 4s · 720p · std | ~1.21 | ~38 | 平台高估 |
| **6s · 720p · std**（cost 文案「6 秒基準」） | ~1.82 | **~56** | 低估 ~9 點 |
| 10s · 720p · std | ~3.03 | ~94 | 低估 ~半 |
| **15s · 720p · std**（auto 最長） | ~4.55 | **~141** | **嚴重低估 ~3×** |
| 5s · **1080p** · std | ~3.41 | ~106 | 低估 ~2×（站內不送 → 仍 720p） |
| 5s · 720p · **Fast**（未收錄） | ~1.21 | ~37.5 | — |
| 4k | 目錄**無**公開 $/秒 | 未知 | **禁**預設／UI 裸開 |

**文件債（cost 字串）**：寫「點數為 **6** 秒基準」但 `PRICE_VIDEO_SECONDS=5` 且 0.3034×5×31=47；0.3034×6×31≈**56**。應改文案為「約 5 秒@720p」或改基準並調點（本回合**不改**）。

**對照家族**：1.5 Pro 固定價含音 720p 5s → **8 點**；1.0 Pro 無音 1080p 5s → **19 點**；本檔按秒旗艦 **47 點**≈ 1.5 的 **~6×**、1.0 的 **~2.5×**。含音在 2.0 **不另計費**（異於 1.5 的 token 雙費率）。

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| 靜態契約（L0） | **ok** — `MODELS` 唯一 id、category∈CATEGORIES、必填欄齊（label/points/cost/tier/verified/strengths/bestFor/input）；`needs` 無 |
| OpenAPI（研究） | **HTTP 200** · `GET …/openapi.json?endpoint_id=bytedance/seedance-2.0/text-to-video` · schema **`Seedance20TextToVideoInput`**／**`Seedance20TextToVideoOutput`** · `x-fal-metadata.endpointId`=`bytedance/seedance-2.0/text-to-video` · category=`text-to-video` |
| Fast 姊妹 OpenAPI | **HTTP 200** · `bytedance/seedance-2.0/fast/text-to-video` · `Seedance20FastTextToVideoInput`（resolution 僅 480p/720p；其餘同構）· **未**入 `MODELS` |
| dry-run probe | 本環境 **無 FAL_KEY**；`verify-models.ts --probe` 退出「無法真實探測」；**未**送 queue |
| 歷史連通 | fal 生態研究曾標 🔸推定；**本輪 OpenAPI 升為存在性已證** |
| playground／模型頁 | https://fal.ai/models/bytedance/seedance-2.0/text-to-video · API https://fal.ai/models/bytedance/seedance-2.0/text-to-video/api（本環境 HTML **429**／Vercel checkpoint；OpenAPI 可讀） |
| live probe（L4） | **未跑**（R3 static+research；**禁止 `--yes`**；47 點／~$1.5+ 不宜本輪硬 live） |
| 結論 | **ready-static-only** — 契約與官方 schema／base 定價一致、`verified` 已 true；**估點 vs duration=auto** 為核心風險；本回合無新 live 出片 |

### OpenAPI 摘要（2026-08-05 本輪 curl）

- **Queue**：`https://queue.fal.run` · paths 含 submit／status／cancel／result
- **required**：僅 `prompt`
- **properties**（`x-fal-order-properties`）：
  - `prompt` — string（example：octopus football 敘事切鏡）
  - `resolution` — enum **`480p`｜`720p`｜`1080p`｜`4k`**，default **`720p`**
  - `duration` — enum **`auto`｜`"4"`…`"15"`**，default **`auto`**（模型依 prompt 決定 4–15s）
  - `aspect_ratio` — enum **`auto`｜`21:9`｜`16:9`｜`4:3`｜`1:1`｜`3:4`｜`9:16`**，default **`auto`**
  - **`generate_audio`** — boolean，default **`true`**；**含音費用相同**
  - `bitrate_mode` — **`standard`｜`high`**，default **`standard`**
  - `end_user_id` — string｜null（可選）
- **Output**：`video`（File）+ `seed`（integer，echo）— 皆 required
- **無**：`camera_fixed`／`num_frames`／`negative_prompt`／input 側 `seed`（異於 1.0／1.5 部分欄；**消融無法鎖噪聲**）

## 4. 底層邏輯

### 4.1 站內力學

| 層 | 說明 |
|----|------|
| `modelMechanicsFor` | **family: `dit`** ·「時序 DiT（Diffusion Transformer）」— path 命中 `seedance` 正則 |
| 文字塔 | `textEncoderProfileFor` → **`seedream`**（規則 `/seedream\|seededit\|bytedance/` **先於** `/…\|seedance/` 命中 path 內 `bytedance`）· 標籤「字節 Seed 系（未公開）」；不可量 token 窗口 |
| 條件／時間 | 潛空間 patch + 時序一致性；2.0 為 **joint audio-video**（音效／環境音／對白唇形；且含音**不另計費**） |
| 輸出 | OpenAPI：`video` + `seed` |

### 4.2 站內 `input()` vs 官方

站內（`shared/models.ts` L1138）：

```ts
input: (p, f) => ({ prompt: p, aspect_ratio: aspect(f) })
// aspect = (f) => f  → 送出 "16:9" | "9:16" | "1:1"
```

三比例快照：

| format | 站內 body | OpenAPI |
|--------|-----------|---------|
| `16:9` | `{ prompt, aspect_ratio: "16:9" }` | `prompt` ✅；`aspect_ratio` ✅ enum |
| `9:16` | `{ prompt, aspect_ratio: "9:16" }` | 同上 ✅ |
| `1:1` | `{ prompt, aspect_ratio: "1:1" }` | 同上 ✅（另有官方 `auto`／`21:9`／`4:3`／`3:4` 站內未用） |

| 能力 | 站內 | 官方 | 備註 |
|------|------|------|------|
| `prompt` | ✅ 必送 | ✅ required | |
| `aspect_ratio` | ✅ 每請求送專案 format | ✅ 含 16:9／9:16／**1:1**／auto | **三比例全健康**；覆蓋官方 default auto |
| `duration` | ❌ 不送 | 預設 **`auto`** | **P0**：非固定 5s；與 47 點 5s 假設脫鉤 |
| `resolution` | ❌ 不送 | 預設 **`720p`** | 與 47 點 720p 假設一致；**勿**誤以為 1080p／4k |
| **`generate_audio`** | ❌ 不送 | 預設 **true** | 含音且**免費**；正確可不強送 |
| `bitrate_mode` | ❌ 不送 | 預設 standard | high 可能加檔案／品質；價目未獨立列 |
| input `seed` | schema **無** | — | **不可**加入 `SEED_SUPPORTED`（與 1.5 不同） |
| `negative_prompt` | 不注入 | schema 無 | **正確不送** |
| `camera_fixed`／`num_frames` | — | **無** | 異於 1.0／1.5 部分 API |

**契約健康度**：**形狀優、估點危**——必填 `prompt` 與三站內比例皆在 enum；預設 720p 與 cost 錨定一致；**duration=auto** 使扁平 47 在實帳單上不可靠。`NEGATIVE_PROMPT_SUPPORTED`／`SEED_SUPPORTED` **刻意未收**——與 input schema 一致。

### 4.3 generationCore 路徑

```
estimatePoints → 47（扁平；非 TTS 動態）
→（可能）組核准門檻（高點數 flagship）
→ reserveQuota(47)
→ falSubmit("bytedance/seedance-2.0/text-to-video", { prompt, aspect_ratio })
→ 失敗 refund(47)
→ 供應商按秒×解析計費；auto 時長可能使平台成本 ≫ 47
```

- 世界觀禁忌：`supportsNegativePrompt===false` → **不會**附加 `negative_prompt`  
- seed：schema 無 input seed → 消融無法鎖噪聲  
- endpoint：**必須** `bytedance/…`，**勿**加 `fal-ai/` 當 modelId  

### 4.4 與 1.0 Pro／1.5 Pro／Fast 對照

| | 1.0 Pro（#109） | 1.5 Pro（#110） | **2.0（本 #111）** | 2.0 Fast（未收錄） |
|--|-----------------|-----------------|--------------------|--------------------|
| id 前綴 | `fal-ai/bytedance/…` | `fal-ai/bytedance/…` | **`bytedance/…`** | `bytedance/…/fast/…` |
| 預設 resolution | **1080p** | **720p** | **720p**（可 **4k**） | 720p（**無** 1080p/4k） |
| 原生音訊 | 無欄 | `generate_audio` true（**另計** token） | **true（含音免費）** | 同 2.0 |
| duration | `"2"`…`"12"` 預設 **5** | `"4"`…`"12"` 預設 **5** | **`auto`／4–15** | 同 2.0 |
| 計費 | 約 $0.62/支 | 約 $0.26/支 | **$/秒** | $/秒（較低） |
| points | 19 | 8 | **47** | — |
| input seed | 有（未 allowlist） | 有（未 allowlist） | **無** | 無 |
| bestFor 重心 | 無音 1080p 寫實 | 有聲寫實性價 | **最高規寫實**（先小樣） | 更快／較省 |

## 5. 站內點數

| 項 | 說明 |
|----|------|
| 目錄 points | **47**（`realPricePoints` 自 cost 首個 $/秒 ×5×31 覆寫一致） |
| 預估／扣點 | `estimatePoints` = 47；與 prompt 字數無關 |
| UI | 挑選器／配方／showdown 顯示與 `MODELS[].points` 同源 |
| 退點 | 生成失敗 terminal + 帳本退點；本回合**未**做 L5 真扣點 |
| BYOK | 若走使用者自備 key，點數實際可為 0（平台 key 才扣 est）— 通用規則 |
| 顯示＝扣＝退 | **47 內部一致** |
| 與真實成本 | **僅在 ~5s@720p standard 時 ≈**；**auto／長秒／1080p／4k／high bitrate** 時平台**低估**；4s 時略高估 |
| 組核准 | 47 點 flagship 易觸高額門檻（依站內政策）——產品上合理警示 |

## 6. 情境與可用性

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 最高規寫實成片（純文字） | ✅ 候選 | bestFor 已寫「先小量試跑再定主力」 |
| 有聲寫實 + **含音不另計** | ✅ | 異於 1.5 雙費率；提示可寫環境音／對白 |
| 日常 B-roll／草稿 | ❌ | 用 Lite 6／Wan／1.5 Pro 8 |
| 有聲寫實**中預算** | △ | **1.5 Pro 8 點**更划算；本檔溢價極大 |
| 無聲 **1080p** 極致畫質（舊錨） | △ | 1.0 Pro 19 點仍可；本檔不送 resolution 時吃 **720p** |
| 畫面內中文字 | ❌ | 影片族不渲染可靠中文字；字卡另疊 |
| 圖生影片 | ❌ | 本 id **僅 t2v**；補遺：外部排行 i2v 強但 fal **無** 2.0 i2v 條目 |
| 社群 1:1／直式 9:16 | ✅ | 官方 enum 皆有；站內三比例健康 |
| 中文提示理解 | ✅ | 字節系；生態研究：華語情境詞較懂 |
| Recipe `sc-t2v-sound` | ❌ 未收 | pickIds=Veo 3.1／Kling 2.6 Pro／Wan 2.5——**不應**預設塞 47 點本檔 |
| 手動選模 | ✅ | category text-to-video，needs 無 |
| 助手／代理 | ✅ 可被選 | `verified:true` → operational ready；**recommended:false** + 高點 → budget 偏好下分數低 |
| MCP | ✅ | `find_model` 可命中；`modelId` **必須** `bytedance/seedance-2.0/text-to-video` |

**文案一致性**：strengths／bestFor 與目錄／生態研究「最新世代旗艦、先小樣」一致。cost「6 秒基準」與 runtime 5s／47 點**不一致**——P1 文件債。models.ts「slug 推定」註解**過時**。

## 7. MCP / 文件

| 項 | 值 |
|----|-----|
| MCP `find_model` | category=`text-to-video`、keyword「Seedance／2.0／字節／最高規／寫實」、tier=flagship、points=47 |
| MCP `submit_generation` | 建議 body：`projectId` + `modelId` + `prompt`；**勿**自拼 duration／resolution／4k／bitrate 除非同步改估點；aspect 由專案 format 注入 |
| 文件 | [fal 模型頁](https://fal.ai/models/bytedance/seedance-2.0/text-to-video) · [API](https://fal.ai/models/bytedance/seedance-2.0/text-to-video/api) |
| OpenAPI | `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=bytedance/seedance-2.0/text-to-video` |
| Fast（未收錄） | [Fast 模型頁](https://fal.ai/models/bytedance/seedance-2.0/fast/text-to-video) · OpenAPI endpoint_id 同上 `/fast/` |
| 定價摘要 | 標準 720p **$0.3034/秒**、1080p **$0.682/秒**；Fast 720p **$0.2419/秒**；**含音免費**；點數錨 **5s@720p→47** |
| 站內 | `shared/models.ts` L1133–1139；`docs/點數校準報告.md` 47.0≈；`docs/fal生態研究.md` 🔸→本輪 OpenAPI 已證 |

**建議 MCP 形狀**（控費：短提示、接受預設 720p；**人審後**再考慮固定 duration——站內 input 目前**無法**送 duration）：

```json
{
  "projectId": "<uuid>",
  "modelId": "bytedance/seedance-2.0/text-to-video",
  "prompt": "清晨山寺石階，薄霧緩移，低角度慢推至殿門，遠處鐘聲與風過松枝，陽光丁達爾光柱，寫實電影感，運鏡平穩，無人無字幕"
}
```

## 8. 建議動作

- [x] **維持** id=`bytedance/…`（OpenAPI 證實；**勿**加 `fal-ai/` 當 modelId）
- [x] **維持** points=47 本輪不改（對齊 5s@720p std；禁止自動改）
- [x] **維持** verified 既有 true（端點存在；live 仍缺——**禁止**本回合改 verified）
- [x] **維持** 不送 `generate_audio`（預設 true＝含音免費，合理）
- [ ] 調 points — **本輪不需要**（錨 5s@720p ≈）；若改「6 秒基準」文案為真則應 → **~56** 並聯動 UI
- [ ] 修 input/id — **id 不需修**；**P0** 建議 input 固定 `duration: "5"` **或** 按秒動態估點（避免 auto 倒貼）
- [ ] verified true — **已是 true**；live 後可保留
- [ ] 下架或隱藏 — **否**；**勿**設為日常工作流預設／recommended
- [ ] **P0**：`duration` 固定 `"5"` 或暴露時長並 **按秒×解析** 動態 `estimatePoints`（auto 最長 15s ≈141 點量級）
- [ ] **P1**：cost 文案「6 秒基準」→「約 5 秒@720p 標準檔」或重算 points≈56
- [ ] **P1**：`models.ts` 註解「slug 推定／暫依 1.0 Pro」→「OpenAPI 已證；按秒 720p 錨 5s」
- [ ] **P2**：解析／bitrate UI 聯動估點；**禁**預設 4k；1080p 明示 ~106 點／5s
- [ ] **P3**：是否收錄 Fast（`bytedance/seedance-2.0/fast/text-to-video`，~$0.2419/秒 → 5s≈38 點）作經濟旗艦位
- [ ] **P3**：補 2.0 **i2v** 若 fal 上架（補遺：排行 i2v 強、目錄目前僅 t2v）
- [ ] seed allowlist — **否**（input schema **無** seed）
- [ ] negative — **否**（schema 無）
- [ ] L1 有效 probe — 有 FAL_KEY 時空輸入 `{}` 期望 **422 OK_VALIDATED**（勿 --yes 生成）
- [ ] L4 live — 控費單次：先估點，再**人工** `--yes`；強烈建議先有 duration 固定後再跑（現況 auto 費率不可控）

**優先級（僅建議）**

| 級 | 項 |
|----|-----|
| **P0** | duration 固定 `"5"` **或** 動態估點（auto／長秒倒貼風險） |
| **P1** | cost「6 秒基準」與 runtime 5s／47 對齊；models.ts 過時註解 |
| **P2** | 解析／bitrate UI + 聯動估點；禁裸 4k |
| **P3** | Fast 收錄評估；2.0 i2v 追蹤；Recipe **不**預設本檔 |
| — | **不**納入 SEED／NEGATIVE allowlist |
| — | **不**與 1.5 混淆：本檔極貴、auto 時長、含音免費、id 無 fal-ai/ |

## 9. 來源

1. OpenAPI Queue 2026-08-05：`endpoint_id=bytedance/seedance-2.0/text-to-video` → `Seedance20TextToVideoInput`／`Output` 全表（duration auto｜4–15、resolution 含 4k 預設 720p、generate_audio default true 且 cost same、bitrate_mode、aspect 含 auto；**無** input seed／camera_fixed／num_frames）  
2. OpenAPI Fast：`endpoint_id=bytedance/seedance-2.0/fast/text-to-video` → 同構、resolution 僅 480p/720p（**未**收錄）  
3. 定價：目錄 cost 字串 + `parseRealCost`／`realPricePoints`（0.3034×5×31=47）；`docs/點數校準報告.md` 47.0≈；模型頁本環境 429  
4. 站內：`shared/models.ts` L1133–1139（entry／input／註解）、`PRICE_VIDEO_SECONDS=5`、SEED／NEGATIVE allowlist  
5. `shared/modelMechanics.ts`（dit／seedance）、`shared/textEncoders.ts`（bytedance → seedream）  
6. `server/services/generationCore.ts`（input／negative／seed／quota／refund）  
7. MCP：`server/services/mcp.ts`、`shared/mcpCatalog.ts`；Recipe `sc-t2v-sound` **未**收本 id  
8. `docs/fal生態研究.md`（🔸推定）、`docs/模型目錄.md`、`docs/模型指南研究補遺.md`（無 2.0 i2v）  
9. 姊妹對照：#109 1.0 Pro t2v、#110 1.5 Pro t2v、Lite t2v、1.5 Pro i2v  

---

**R3 checklist（#111）**

- [x] L0 靜態契約  
- [x] OpenAPI／定價研究（標準 + Fast 姊妹；無 `--yes` live）  
- [x] 點數校準對照（5s≈47；6s 文案債；auto 15s≈141 低估）  
- [x] input vs schema 差異（三比例健康；duration=auto P0；無 input seed）  
- [x] MCP／助手／情境交叉（勿預設 Recipe；modelId 無 fal-ai/）  
- [x] 九章卡 + `_index` #111 + heartbeat  
- [x] **未**改 verified／points；**未** live 扣費  
