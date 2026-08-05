# fal-ai/wan/v2.5/text-to-video

> 審計：R3 · index **#115** · 模式 **static+research（零 live）** · 2026-08-05  
> slug：`fal-ai__wan__v2.5__text-to-video`  
> **本輪已修** `endpoint`：`fal-ai/wan/v2.5/…` OpenAPI **404** → **`fal-ai/wan-25/text-to-video`**（`endpointOf`）。**未**改 `verified`／`points`。**禁止 `--yes`**

## 1. 身分

| 項 | 值 |
|----|-----|
| id（目錄／UI） | `fal-ai/wan/v2.5/text-to-video`（穩定 id，保留歷史字串） |
| **endpoint（送 fal）** | **`fal-ai/wan-25/text-to-video`**（本輪寫入 `MODELS[].endpoint`；`endpointOf` 優先） |
| label | Wan 2.5(開源) |
| category / kind | **text-to-video** · video |
| tier | **economy** |
| points | **8** |
| cost（目錄） | `480p $0.05/秒、720p $0.10/秒、1080p $0.15/秒(預設 1080p);按秒計費,點數為 6 秒基準` |
| verified | **true**（既有；本回合**未**改。OpenAPI 實端 **200** 已證存在；出片仍缺 live） |
| needs | 無（純文生，無來源素材） |
| recommended | **false**（models-index） |
| strengths | Wan 新一代;畫質提升並加入原生音訊,仍親民價 |
| bestFor | 開源價又要帶音效的療癒 B-roll |
| 供應商 | Alibaba **WAN 2.5** · fal 託管 queue（GA：`wan-25`；同構 preview：`wan-25-preview`） |
| 姊妹（fal 存在／本目錄） | **i2v** `fal-ai/wan-25/image-to-video`（OpenAPI 200 · **未**收錄）；preview t2v／i2v；前代 **2.2 A14B** t2v／i2v／lora；**2.1** `wan-t2v`／`wan-i2v`；目錄 **#116 Wan 2.6** 本輪抽樣 OpenAPI **亦 404**（同型 slug 推定債，另卡） |

**一句話**：Wan 開源新一代文生影片——**站內 id 保留 `…/v2.5/…`，實際 queue 打 `wan-25`**；價帶 480p $0.05／720p $0.10／1080p $0.15 每秒；扁平 **8 點**只對齊 **480p×5s**，與 OpenAPI **預設 1080p×5s（≈$0.75／~23 點）**嚴重脫鉤（P0）。音訊：schema 有 **`audio_url`（使用者 BGM）**，**無** `generate_audio`；「原生音訊」須 live 對質。

## 2. 數值

| 項目 | 值 |
|------|-----|
| points | **8** |
| cost（目錄） | 上表；明寫「預設 1080p」與「6 秒基準」 |
| 官方價（模型頁摘要 + 生態交叉） | **480p $0.05/秒 · 720p $0.10/秒 · 1080p $0.15/秒**（[wan-25-preview 文生頁定價句](https://fal.ai/models/fal-ai/wan-25-preview/text-to-video) 與目錄一致；本環境 HTML **429**） |
| 解析／`parseRealCost` | 取**首個** `$0.05` → `usdMid: 0.05` · `multiplier: ×5`（`PRICE_VIDEO_SECONDS`）· unitNote「×5 秒（單鏡假設）」 |
| `realPricePoints` | `0.05 × 5 × 31 = 7.75` → **round 8**（與目錄／校準報告 **7.8 ≈** 一致） |
| `estimatePoints`（扁平） | **8**（與 prompt 長度無關；**不**隨 duration／resolution／audio_url 變動） |
| 估值 NT$（1 點≈NT$1） | **≈ NT$7.8**（480p·5s 機械） |
| 時長／解析假設（站內實際送出） | 僅 `prompt` + `aspect_ratio` → 吃 OpenAPI 預設 **`duration:"5"` + `resolution:"1080p"`** |
| 校準判定 | 對 **480p·5s**：**≈**；對 **官方 default 1080p·5s**：**嚴重低估（P0）**；cost「6 秒基準」與機械 5s／官方 default 5s **三方不一致**（文件債） |

**階梯示意（官方秒價 × 秒 ×31；非站內扣點）**

| 設定 | 約 USD | 約 NT$（×31） | vs 固定 8 點 |
|------|--------|---------------|--------------|
| **480p · 5s**（機械估點錨） | 0.25 | **~7.8** | **≈** |
| 480p · 6s（cost「6 秒」文案） | 0.30 | ~9.3 | 輕度低估 |
| 480p · 10s（enum 可選） | 0.50 | ~15.5 | 低估 ~半 |
| 720p · 5s | 0.50 | ~15.5 | 低估 ~半 |
| **1080p · 5s（OpenAPI default）** | **0.75** | **~23.3** | **嚴重低估 ~3×** |
| 1080p · 10s | 1.50 | ~46.5 | 災難級低估 |

**文件債**：cost 寫「點數為 **6** 秒基準」且「預設 **1080p**」，但 `parseRealCost` 吃 **首價 480p** × **5s** → 8。與 Veo Lite／Hailuo 02 等同族「文案秒數／解析 vs 機械首價」債同型，本檔因 default 1080p **最嚴重**。

**對照家族**：Wan 2.2 A14B t2v 12 點（無原生音敘事）；Kling 2.6 Pro 有聲檔 11 點；Veo 3.1 旗艦 31 點。Recipe `sc-t2v-sound` 第三選本檔——endpoint 修好後可送 queue，但仍吃 1080p default 倒貼風險。

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| 靜態契約（L0） | **ok** — `MODELS` 唯一 id、category∈CATEGORIES、必填欄齊、`needs` 無；**本輪**補 `endpoint` |
| OpenAPI（目錄 path 字串） | **HTTP 404** · `endpoint_id=fal-ai/wan/v2.5/text-to-video`（證實舊寫法不可用） |
| OpenAPI（`endpointOf`） | **HTTP 200** · `endpoint_id=fal-ai/wan-25/text-to-video` · schema **`Wan25TextToVideoInput`**／**`Wan25TextToVideoOutput`** · `x-fal-metadata.endpointId` 同 · category=`text-to-video` |
| 同構 preview | `fal-ai/wan-25-preview/text-to-video` **200**（欄位同構） |
| dry-run probe | 本環境 **無 FAL_KEY**；`verify-models.ts --probe` 僅能估點路徑，**未**送 queue |
| 歷史連通 | `docs/fal端點連通報告.md` **無**本 id；`docs/fal生態研究.md` 🔸推定 slug——本輪以 OpenAPI 定案 **`wan-25`** |
| playground／模型頁 | https://fal.ai/models/fal-ai/wan-25/text-to-video · API …/api（本環境 HTML **429**；OpenAPI 可讀） |
| live probe（L4） | **未跑**（R3 static+research；**禁止 `--yes`**） |
| 結論 | **ready-static-only** — endpoint 已對齊、schema／base 價可研；**估點 P0 未解**；無 live 出片 |

### OpenAPI 摘要（2026-08-05 · `fal-ai/wan-25/text-to-video`）

- **Queue**：`https://queue.fal.run` · paths 含 submit／status／cancel／result
- **required**：僅 `prompt`
- **properties**（`x-fal-order-properties`）：
  - `prompt` — string，minLength 1；**Supports Chinese and English, max 1500 characters**
  - `audio_url` — string｜null；**使用者提供 BGM**（WAV/MP3、3–30s、≤15MB；長則截、短則後段靜音）— **不是** `generate_audio` 開關
  - `aspect_ratio` — enum **`16:9`｜`9:16`｜`1:1`**，default **`16:9`**
  - `resolution` — enum **`480p`｜`720p`｜`1080p`**，default **`1080p`**
  - `duration` — enum **`"5"`｜`"10"`**，default **`"5"`**
  - `negative_prompt` — string｜null，default `""`；Max **500** characters
  - `enable_prompt_expansion` — boolean，**default true**（短 prompt 改寫、耗時↑）
  - `seed` — integer｜null
  - `enable_safety_checker` — boolean，default **true**
- **Output**：`video`（File）+ `seed`（required）+ `actual_prompt`（optional，expansion 後）
- **about**（metadata）：*Best visual quality and motion stability；480p and 1080p；AR 16:9/9:16/1:1；5 or 10s；processing 1–3 min* — **about 未寫「原生音訊」**（與 strengths／blog 行銷需 live 對質）
- **無**：`generate_audio`／`image_url`／`camera_*`／`num_frames`

## 4. 底層邏輯

### 4.1 站內力學

| 層 | 說明 |
|----|------|
| `modelMechanicsFor` | **family: `dit`** ·「時序 DiT（Diffusion Transformer）」— path 命中 `fal-ai/wan…` |
| 文字塔 | `textEncoderProfileFor` → **`wan` / umT5**，窗口 **512**（中英多語；id 與 endpoint 皆命中 wan 正則） |
| 條件／時間 | 潛空間 patch + 時序一致性；開源 Wan 系；2.5 行銷強調畫質／穩定／（爭議）音畫 |
| 輸出 | OpenAPI：`video` + `seed` + optional `actual_prompt` |

### 4.2 站內 `input()` vs 官方

站內（`shared/models.ts` 約 L1165–1173，**修後**）：

```ts
// 審計 #115：OpenAPI 404 於 fal-ai/wan/v2.5/… → 實端點 fal-ai/wan-25/text-to-video
id: "fal-ai/wan/v2.5/text-to-video",
endpoint: "fal-ai/wan-25/text-to-video",
input: (p, f) => ({ prompt: p, aspect_ratio: aspect(f) })
// aspect = (f) => f  → 送出 "16:9" | "9:16" | "1:1"
```

三比例快照：

| format | 站內 body | OpenAPI `wan-25` |
|--------|-----------|------------------|
| `16:9` | `{ prompt, aspect_ratio: "16:9" }` | ✅ enum |
| `9:16` | `{ prompt, aspect_ratio: "9:16" }` | ✅ |
| `1:1` | `{ prompt, aspect_ratio: "1:1" }` | ✅（優於缺 1:1 的 Luma／部分 Hailuo） |

| 能力 | 站內 | 官方 `wan-25` | 備註 |
|------|------|---------------|------|
| **endpoint** | **`wan-25`（本輪已修）** | 同 | 修前打 `…/v2.5/…` 必 404 |
| `prompt` | ✅ 必送 | ✅ required ≤1500 | 站內無專屬 cap；超長應 UI／注入截斷 |
| `aspect_ratio` | ✅ 三比例 | ✅ 全在 enum | **契約健康** |
| `duration` | ❌ 不送 | 預設 **`"5"`** | 與 `PRICE_VIDEO_SECONDS=5` 對齊；cost「6 秒」錯；10s 未暴露 |
| `resolution` | ❌ 不送 | 預設 **`1080p`** | **P0 估點**：扣 8、實費 ~23 點級 |
| `negative_prompt` | allowlist **有**（以 **id** 鍵） | schema **有** | ✅ 正確；禁忌可注入 |
| `seed` | `SEED_SUPPORTED` **有**（以 **id** 鍵） | schema **有** | ✅ 消融可鎖噪聲 |
| `audio_url` | ❌ 不送 | 可選 BGM | 產品未串「指定配樂」；≠ 自動原生對白 |
| `enable_prompt_expansion` | ❌ 不送 | 預設 true | 吃官方（短句會被 LLM 改寫；`actual_prompt` 回傳） |
| `enable_safety_checker` | ❌ 不送 | 預設 true | 合理 |

**契約健康度（修後）**：**endpoint 層已通**；參數層 aspect 三比例 + neg／seed allowlist **優於**多個商業 t2v。殘差在 **未送 resolution／duration** 導致估點與 default 脫鉤（P0），非 422 型契約破。

### 4.3 generationCore 路徑（修後）

```
estimatePoints → 8（扁平）
→ reserveQuota(8)
→ falSubmit(endpointOf= "fal-ai/wan-25/text-to-video", { prompt, aspect_ratio })
→ 不送 resolution → 1080p · 5s ≈ $0.75（平台只收 8 點 → 倒貼，P0）
→ 失敗 refund(8)
→ supportsNegativePrompt(id) → 可附加 negative_prompt
→ supportsSeed(id) → 消融可寫 seed
```

- BYOK：自備 key 時點數可為 0（平台 key 才扣 est）— 通用規則  

### 4.4 與姊妹對照

| | **#115 本檔（修後）** | wan-25 i2v（未收錄） | 2.2 A14B t2v | #116 目錄 2.6 |
|--|----------------------|---------------------|--------------|---------------|
| OpenAPI | **200**（endpoint） | 200 | 200 | **404**（目錄 path） |
| 站內 endpoint 映射 | ✅ `wan-25` | — | id=endpoint | 待核 |
| 計價敘事 | 首價 480p→8；default 1080p | 同價帶推定 | $0.04–0.08/秒→12 | 目錄 16 點 |
| 音訊 | `audio_url`；原生？live | 有 `audio_url` | 無音為主 | 文案音畫一體 |
| aspect | 三比例全合法 | 跟圖 | 依 schema | 待核 |

## 5. 站內點數

| 項 | 說明 |
|----|------|
| 目錄 points | **8** |
| 預估／扣點 | `estimatePoints` = 8；與 prompt 字數無關 |
| UI | 挑選器／Recipe `sc-t2v-sound` 顯示 8 點 |
| 退點 | 生成失敗 terminal + 帳本退點；本回合**未**做 L5 |
| BYOK | 通用：自備 key 可不扣平台點 |
| 與官方 | **480p·5s ≈8**；**default 1080p·5s ≈23** → 若不送 `resolution:"480p"` 或動態估點，**平台嚴重倒貼** |
| 建議 | 本回合 **維持 8**；後續三選一：（A）`input` 明送 `resolution:"480p"`（+ 可選 `duration:"5"`）維持經濟敘事；（B）改錨 1080p·5s → points **~23**；（C）按 resolution×duration 動態估點 |

## 6. 情境與可用性

| 情境 | 適配 | 說明 |
|------|------|------|
| 開源價有聲 B-roll（bestFor／Recipe） | △ | endpoint 已通；「原生音」未 live；default 1080p 成本 ≠ 8 點 |
| 療癒空鏡／場景片（純畫面） | ✅ | 畫質／穩定 about 主軸；比 2.2 新一代 |
| `sc-t2v-sound` 第三選 | △ 可送 | pickIds 用 **id**（正確）；實打 `wan-25`；估點仍 P0 |
| 指定 BGM 成片 | △ schema 可、站內未暴露 | 需 `audio_url` + 素材可公網 |
| 畫面內中文字 | ❌ | 影片族通病；字卡另做 |
| 中文提示 | ✅ | OpenAPI 明寫 Chinese and English；umT5 |
| 精確 1:1 社群 | ✅ | 官方有 1:1 |
| 10 秒長鏡 | △ 官方可、站內未暴露 | 開 UI 前必須聯動估點（480p≈16／1080p≈47） |
| 1080p 成片 | △ 官方 default | 與 8 點經濟定位衝突——須估點或降解析 |
| 手動選模 | ✅ | category text-to-video，needs 無 |
| 助手／代理 | ✅ 可被選 | `verified:true` → operational ready；**recommended:false** + economy 8，budget 下可競爭；倒貼風險見 P0 |
| MCP | ✅ | `find_model` 命中 **id**；`submit_generation` 帶 modelId=目錄 id 即可（endpointOf 轉換） |

**文案一致性**：strengths「原生音訊」vs OpenAPI about **未列音訊**、僅 `audio_url`——**P1 文案／live 對質**。

## 7. MCP / 文件

| 項 | 值 |
|----|-----|
| MCP `find_model` | category=`text-to-video`、keyword「Wan／2.5／開源／有聲」、tier=economy、points=8 |
| MCP `submit_generation` | body：`projectId` + `modelId`=`fal-ai/wan/v2.5/text-to-video` + `prompt`；aspect 由專案 format；**勿**裸開 10s／默認 1080p 而不改估點 |
| 文件（現場） | [fal 模型頁 wan-25](https://fal.ai/models/fal-ai/wan-25/text-to-video) |
| OpenAPI（現場） | `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/wan-25/text-to-video` |
| 定價摘要 | 480p **$0.05**/s · 720p **$0.10**/s · 1080p **$0.15**/s |
| Blog | [Wan 2.5 Preview on fal](https://blog.fal.ai/wan-2-5-preview-is-now-available-on-fal/)（原生音訊行銷；歷史 slug `wan-25-preview`） |

**建議 MCP 形狀**：

```json
{
  "projectId": "<uuid>",
  "modelId": "fal-ai/wan/v2.5/text-to-video",
  "prompt": "清晨寺院石階，薄霧緩移，低角度慢推，木魚與遠鐘隱約，寫實柔光，無人無字幕"
}
```

（若產品堅持經濟 8 點，provider 層應再帶 `"resolution":"480p"`——站內 `input()` 尚未做。）

## 8. 建議動作

- [x] **修 endpoint** — 已寫 `endpoint: "fal-ai/wan-25/text-to-video"`（id 保留 `…/v2.5/…`）；`NEGATIVE_PROMPT`／`SEED` allowlist 以 **id** 為鍵，**無需**改字串
- [x] **維持** points=8、verified=true、recommended=false（本回合不改 points／verified 字面）
- [ ] **P0 估點對齊 default** — 三選一或組合：  
  1. `input` 明送 `resolution: "480p"`（+ 可選 `duration: "5"`）維持 points=8 經濟敘事；  
  2. points 改錨 1080p·5s → **~23**；  
  3. 按 resolution×duration 動態 `estimatePoints`  
- [ ] 調 points — 見上；**本回合不需要**為通 endpoint 而改 8  
- [ ] 修 input 參數形狀 — aspect **已健康**；補 resolution／duration 策略見 P0  
- [ ] 下架或隱藏 — **否**  
- [ ] 文案 — strengths「原生音訊」改為「可接 audio_url／是否內建環境音待 live」或 live 證實後保留  
- [ ] cost 字串 — 去掉錯誤「6 秒基準」→「5 秒@錨定解析」；若錨 480p 勿同時強調預設 1080p 而不改點  
- [ ] L1 有效 probe — 有 FAL_KEY：`{}` 對 **`fal-ai/wan-25/text-to-video`** 期望 **422 OK_VALIDATED**（勿 --yes 生成）  
- [ ] L4 live — 控費：先 **480p·5s** 單次（≈$0.25／8 點敘事）；禁止默認 1080p 無預算確認  
- [ ] 評估收錄 **wan-25 i2v**（fal 已通）作有首格路徑  
- [ ] 同批檢查 **#116 Wan 2.6**（本輪抽樣 OpenAPI 亦 404）— 可能同型 slug 債  
- [ ] 同步 `models-index.json` 的 `endpoint` 欄（現仍可能殘舊 path；以 `models.ts` 為準）

**優先級（僅建議）**

| 級 | 項 |
|----|-----|
| **P0** | 預設 1080p 與扁平 8 點脫鉤：明送 480p **或** 調點／動態估點 |
| P1 | 原生音訊 live 對質；cost「6 秒／預設 1080p」文案 |
| P2 | 暴露 duration 10s／resolution UI 時必須聯動估點；可選 `audio_url` 產品路徑 |
| P3 | 收錄 wan-25 i2v；清理 wan-25-preview vs GA 文件；#116 slug |
| — | aspect 三比例 **無需改**；neg／seed allowlist **已正確** |

## 9. 來源

1. OpenAPI Queue 2026-08-05：`endpoint_id=fal-ai/wan/v2.5/text-to-video` → **404**  
2. OpenAPI Queue 2026-08-05：`endpoint_id=fal-ai/wan-25/text-to-video` → `Wan25TextToVideoInput`／Output 全表 + `x-fal-metadata`（about、playgroundUrl）  
3. 同構抽樣：`fal-ai/wan-25/image-to-video`、`fal-ai/wan-25-preview/text-to-video`（200）；`fal-ai/wan/v2.6/text-to-video`（404）  
4. 公開定價句：[wan-25-preview text-to-video](https://fal.ai/models/fal-ai/wan-25-preview/text-to-video) — 480p $0.05／720p $0.10／1080p $0.15 per second  
5. Blog：[Wan 2.5 Preview is now available on fal](https://blog.fal.ai/wan-2-5-preview-is-now-available-on-fal/)（原生音訊行銷；歷史 slug `wan-25-preview`）  
6. 站內：`shared/models.ts`（entry ~L1165 `endpoint` 修、NEGATIVE／SEED allowlist、`sc-t2v-sound`、`parseRealCost`／`PRICE_VIDEO_SECONDS=5`／`USD_TO_TWD=31`、`endpointOf`）  
7. `shared/modelMechanics.ts`、`shared/textEncoders.ts`（dit／umT5 wan）  
8. `docs/點數校準報告.md`（Wan 2.5 列 7.8 ≈）、`docs/fal生態研究.md`（🔸推定 slug）、`docs/模型目錄.md`、`docs/模型指南研究補遺.md`  
9. 模型頁 HTML 本環境 429 — 定價以 OpenAPI + 搜尋快照／目錄交叉；**未** live 出片  

---

**R3 checklist（#115）**

- [x] L0 靜態契約  
- [x] OpenAPI／定價研究（舊 path 404；`wan-25` 200；無 `--yes` live）  
- [x] 點數校準對照（480p·5s≈8；default 1080p·5s≈23）  
- [x] input vs schema（aspect 三比例健康；resolution／duration 未送）  
- [x] MCP／助手／Recipe／情境交叉  
- [x] **修** `endpoint` → `fal-ai/wan-25/text-to-video`  
- [x] 九章卡 + `_index` #115 + heartbeat  
- [x] **未**改 verified／points；**未** live 扣費；**禁止 `--yes`**  
