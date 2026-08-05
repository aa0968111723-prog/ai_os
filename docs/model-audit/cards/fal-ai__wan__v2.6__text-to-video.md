# fal-ai/wan/v2.6/text-to-video

> 審計：R3 · index **#116** · 模式 **static+research（零 live）** · 2026-08-05  
> slug：`fal-ai__wan__v2.6__text-to-video`  
> **本輪已修** `endpoint`：目錄 path `fal-ai/wan/v2.6/text-to-video`／`fal-ai/wan-26/…`／`wan/v2.6/text-to-video` 皆 **OpenAPI 404** → 實端點 **`wan/v2.6`**（無 `fal-ai/` 前綴、**無** `/text-to-video` 後綴）。**未**改 `verified`／`points`。**禁止 `--yes`**

## 1. 身分

| 項 | 值 |
|----|-----|
| id（目錄／UI） | `fal-ai/wan/v2.6/text-to-video`（穩定 id，保留歷史字串） |
| **endpoint（送 fal）** | **`wan/v2.6`**（本輪寫入 `MODELS[].endpoint`；`endpointOf` 優先） |
| label | Wan 2.6(開源) |
| category / kind | **text-to-video** · video |
| tier | **economy** |
| points | **16** |
| cost（目錄） | `$0.10/秒(720p)、$0.15/秒(1080p);按秒計費,點數為 6 秒基準` |
| verified | **true**（既有；本回合**未**改。OpenAPI 實端 **200** 已證存在；出片仍缺 live） |
| needs | 無（純文生，無來源素材） |
| recommended | **false**（models-index） |
| strengths | Wan 最新多模態世代;音畫一體、開源質感天花板 |
| bestFor | 正式一點又要控成本的敘事片 |
| 供應商 | Alibaba **WAN 2.6** · fal 託管（partner 命名空間 `wan/…`，**非** `fal-ai/wan-26`） |
| 姊妹（fal 存在／本目錄） | **i2v** `wan/v2.6/image-to-video`（OpenAPI 200 · 目錄 #137）；**r2v** `wan/v2.6/reference-to-video`（200 · **未**收錄）；前代 **2.5** `fal-ai/wan-25/text-to-video`（#115）；**2.2 A14B** t2v；後代 **2.7** `fal-ai/wan/v2.7/text-to-video`（200 · 本目錄未收） |

**一句話**：Wan 開源多鏡頭世代文生影片——**站內 id 保留 `fal-ai/wan/v2.6/text-to-video`，實際 queue 打極短 `wan/v2.6`**；價帶 720p $0.10／1080p $0.15 每秒（**無 480p**）；扁平 **16 點**只對齊 **720p×5s**，與 OpenAPI **預設 1080p×5s（≈$0.75／~23 點）**脫鉤（P0）。音訊：schema 有 **`audio_url`（使用者 BGM）**，**無** `generate_audio`；about **未寫原生對白**——「音畫一體」須 live 對質。

## 2. 數值

| 項目 | 值 |
|------|-----|
| points | **16** |
| cost（目錄） | 上表；明寫「6 秒基準」 |
| 官方價（模型頁摘要 + 生態交叉） | **720p $0.10/秒 · 1080p $0.15/秒**（[fal 模型頁定價句](https://fal.ai/models/wan/v2.6/text-to-video)、[Wan 2.6 落地頁](https://fal.ai/wan-2.6) 與目錄一致；本環境 HTML **429**） |
| 解析／`parseRealCost` | 取**首個** `$0.10` → `usdMid: 0.10` · `multiplier: ×5`（`PRICE_VIDEO_SECONDS`）· unitNote「×5 秒（單鏡假設）」 |
| `realPricePoints` | `0.10 × 5 × 31 = 15.5` → **round 16**（與目錄／校準報告 **15.5 ≈** 一致） |
| `estimatePoints`（扁平） | **16**（與 prompt 長度無關；**不**隨 duration／resolution／audio_url／multi_shots 變動） |
| 估值 NT$（1 點≈NT$1） | **≈ NT$15.5**（720p·5s 機械） |
| 時長／解析假設（站內實際送出） | 僅 `prompt` + `aspect_ratio` → 吃 OpenAPI 預設 **`duration:"5"` + `resolution:"1080p"` + `multi_shots:true`** |
| 校準判定 | 對 **720p·5s**：**≈**；對 **官方 default 1080p·5s**：**低估（P0）**；cost「6 秒基準」與機械 5s／官方 default 5s **三方不一致**（文件債） |

**階梯示意（官方秒價 × 秒 ×31；非站內扣點）**

| 設定 | 約 USD | 約 NT$（×31） | vs 固定 16 點 |
|------|--------|---------------|--------------|
| **720p · 5s**（機械估點錨） | 0.50 | **~15.5** | **≈** |
| 720p · 6s（cost「6 秒」文案） | 0.60 | ~18.6 | 輕度低估 |
| 720p · 10s | 1.00 | ~31 | 低估 ~半 |
| 720p · 15s | 1.50 | ~46.5 | 嚴重低估 |
| **1080p · 5s（OpenAPI default）** | **0.75** | **~23.3** | **低估 ~1.5×** |
| 1080p · 10s | 1.50 | ~46.5 | 嚴重低估 |
| 1080p · 15s | 2.25 | ~69.8 | 災難級低估 |
| **480p** | — | — | **schema 無**（異於 2.5） |

**文件債**：cost 寫「點數為 **6** 秒基準」，但 `parseRealCost` 吃 **首價 720p** × **5s** → 16。與 #115 Wan 2.5 同型；本檔因 **無 480p** 且 default 仍 1080p，P0 幅度小於 2.5（2.5 約 3×；本檔約 1.5×），但 15s 暴露後更危險。

**對照家族**：Wan 2.5 t2v 8 點（480p 錨／有 480p）；Wan 2.2 A14B 12 點；Kling 2.6 Pro 有聲檔 11 點；Veo 3.1 旗艦 31 點。Recipe `sc-t2v-sound` **未**納本檔（第三選仍為 2.5）——合理（2.6 更貴、定位敘事多鏡頭）。

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| 靜態契約（L0） | **ok** — `MODELS` 唯一 id、category∈CATEGORIES、必填欄齊、`needs` 無；**本輪**補 `endpoint` |
| OpenAPI（目錄 path 字串） | **HTTP 404** · `endpoint_id=fal-ai/wan/v2.6/text-to-video` |
| OpenAPI（`wan-26` 類推 2.5） | **HTTP 404** · `fal-ai/wan-26/text-to-video`（**不可**套用 wan-25 命名） |
| OpenAPI（行銷 path） | **HTTP 404** · `wan/v2.6/text-to-video`（網站路由≠queue id） |
| OpenAPI（`endpointOf`） | **HTTP 200** · `endpoint_id=wan/v2.6` · schema **`V26Input`**／**`V26Output`** · `x-fal-metadata.endpointId` 同 · about 明寫 T2V |
| 同構姊妹 | `wan/v2.6/image-to-video` **200**；`wan/v2.6/reference-to-video` **200**；`fal-ai/wan/v2.7/text-to-video` **200**（後代） |
| dry-run probe | 本環境 **無 FAL_KEY**；`verify-models.ts --probe` 僅能估點路徑，**未**送 queue |
| 歷史連通 | `docs/fal生態研究.md` 🔸推定 slug「v2.6…/v2.7… 待確認」——本輪以 OpenAPI 定案 **`wan/v2.6`** |
| playground／模型頁 | https://fal.ai/models/wan/v2.6 · 行銷別名 …/text-to-video（本環境 HTML **429**；OpenAPI 可讀） |
| live probe（L4） | **未跑**（R3 static+research；**禁止 `--yes`**） |
| 結論 | **ready-static-only** — endpoint 已對齊、schema／base 價可研；**估點 P0 未解**；無 live 出片 |

### OpenAPI 摘要（2026-08-05 · `wan/v2.6`）

- **Queue**：`https://queue.fal.run` · paths：`/wan/v2.6`、`…/requests/{id}`、status／cancel
- **required**：僅 `prompt`
- **properties**（`x-fal-order-properties`）：
  - `prompt` — string，minLength 1；**Supports Chinese and English, max 1500 characters**；多鏡頭格式：`Overall. First shot [0-3s] …`
  - `audio_url` — string｜null；**使用者提供 BGM**（WAV/MP3、3–30s、≤15MB；長則截、短則後段靜音）— **不是** `generate_audio` 開關
  - `aspect_ratio` — enum **`16:9`｜`9:16`｜`1:1`｜`4:3`｜`3:4`**，default **`16:9`**
  - `resolution` — enum **`720p`｜`1080p`** only，default **`1080p`**（**無 480p**）
  - `duration` — enum **`"5"`｜`"10"`｜`"15"`**，default **`"5"`**
  - `negative_prompt` — string｜null，default `""`；Max **500** characters
  - `enable_prompt_expansion` — boolean，**default true**
  - `multi_shots` — boolean，**default true**（僅 expansion on 時生效；false=單鏡）
  - `seed` — integer｜null
  - `enable_safety_checker` — boolean，default **true**
- **Output**：`video`（VideoFile）+ `seed`（required）+ `actual_prompt`（optional）
- **about**（metadata）：*Multi-shot with intelligent scene segmentation；720p/1080p；5/10/15s；AR 16:9/9:16/1:1/4:3/3:4；shot type multi/single* — **about 未寫「原生音訊」**
- **無**：`generate_audio`／`image_url`／`camera_*`／`num_frames`

### 死路徑一覽

| 嘗試 | 結果 |
|------|------|
| `fal-ai/wan/v2.6/text-to-video` | **404**（目錄舊 id＝endpoint 時必掛） |
| `fal-ai/wan/v2.6` | **404** |
| `fal-ai/wan-26/text-to-video` | **404**（異於 2.5 的 `wan-25`） |
| `fal-ai/wan-26-preview/…` | **404** |
| `wan/v2.6/text-to-video` | **404**（行銷 URL ≠ queue id） |
| **`wan/v2.6`** | **200** · `V26Input` |

## 4. 底層邏輯

### 4.1 站內力學

| 層 | 說明 |
|----|------|
| `modelMechanicsFor` | **family: `dit`** ·「時序 DiT（Diffusion Transformer）」— path 命中 `…wan…` |
| 文字塔 | `textEncoderProfileFor` → **`wan` / umT5**，窗口 **512**（正則 `^(fal-ai\/wan\|wan\/)` 同時涵蓋 id 與 endpoint） |
| 條件／時間 | 潛空間 patch + 時序一致性；2.6 行銷強調 **multi-shot 智能分鏡**、最長 15s、無 480p |
| 輸出 | OpenAPI：`video` + `seed` + optional `actual_prompt` |

### 4.2 站內 `input()` vs 官方

站內（`shared/models.ts` 約 L1176–1184，**修後**）：

```ts
// 審計 #116：OpenAPI 404 於 fal-ai/wan/v2.6/… 與 wan-26 → 實端點 wan/v2.6
id: "fal-ai/wan/v2.6/text-to-video",
endpoint: "wan/v2.6",
input: (p, f) => ({ prompt: p, aspect_ratio: aspect(f) })
// aspect = (f) => f  → 送出 "16:9" | "9:16" | "1:1"
```

三比例快照：

| format | 站內 body | OpenAPI `wan/v2.6` |
|--------|-----------|---------------------|
| `16:9` | `{ prompt, aspect_ratio: "16:9" }` | ✅ enum |
| `9:16` | `{ prompt, aspect_ratio: "9:16" }` | ✅ |
| `1:1` | `{ prompt, aspect_ratio: "1:1" }` | ✅ |
| （未暴露）`4:3`／`3:4` | — | 官方 enum 有、站內 format 無 |

| 能力 | 站內 | 官方 `wan/v2.6` | 備註 |
|------|------|-----------------|------|
| **endpoint** | **`wan/v2.6`（本輪已修）** | 同 | 修前打 `fal-ai/…/v2.6/text-to-video` 必 404 |
| `prompt` | ✅ 必送 | ✅ required ≤1500 | 站內無專屬 cap；多鏡頭 `[0-3s]` 語法未教練 |
| `aspect_ratio` | ✅ 三比例 | ✅ 全在 enum（另 4:3/3:4） | **契約健康**（三比例） |
| `duration` | ❌ 不送 | 預設 **`"5"`**；可 10／**15** | cost「6 秒」錯；15s 未暴露 |
| `resolution` | ❌ 不送 | 預設 **`1080p`** | **P0 估點**：扣 16、實費 ~23 點級 |
| `multi_shots` | ❌ 不送 | 預設 **true** | 敘事多鏡預設開；短 B-roll 可能過切 |
| `negative_prompt` | allowlist **有**（以 **id** 鍵） | schema **有** | ✅ 正確 |
| `seed` | `SEED_SUPPORTED` **本輪已加** | schema **有** | ✅ 消融可鎖噪聲 |
| `audio_url` | ❌ 不送 | 可選 BGM | 產品未串「指定配樂」；≠ 自動原生對白 |
| `enable_prompt_expansion` | ❌ 不送 | 預設 true | 吃官方（短句改寫；`actual_prompt` 回傳） |
| `enable_safety_checker` | ❌ 不送 | 預設 true | 合理 |

**契約健康度（修後）**：**endpoint 層已通**；參數層 aspect 三比例 + neg／seed allowlist **健康**。殘差在 **未送 resolution／duration／multi_shots** 導致估點與 default 脫鉤（P0），非 422 型契約破。

### 4.3 generationCore 路徑（修後）

```
estimatePoints → 16（扁平）
→ reserveQuota(16)
→ falSubmit(endpointOf= "wan/v2.6", { prompt, aspect_ratio })
→ 不送 resolution → 1080p · 5s ≈ $0.75（平台只收 16 點 → 倒貼 ~7 點級，P0）
→ multi_shots default true（expansion on）
→ 失敗 refund(16)
→ supportsNegativePrompt(id) → 可附加 negative_prompt
→ supportsSeed(id) → 消融可寫 seed（本輪已入 allowlist）
```

- BYOK：自備 key 時點數可為 0（平台 key 才扣 est）— 通用規則  

### 4.4 與姊妹對照

| | **#116 本檔（修後）** | #115 Wan 2.5 | #137 i2v 目錄 | r2v（未收錄） |
|--|----------------------|--------------|---------------|---------------|
| OpenAPI | **200** `wan/v2.6` | 200 `wan-25` | 200 `wan/v2.6/image-to-video` | 200 `…/reference-to-video` |
| 站內 endpoint 映射 | ✅ 極短 id | ✅ `wan-25` | id=endpoint（無 fal-ai/） | — |
| 命名模式 | **partner `wan/`** | **`fal-ai/wan-25`** | 同 2.6 家族 | 同 |
| 解析 | 720p／1080p | 480／720／1080 | 720／1080 | 720／1080 |
| 時長 | 5／10／**15** | 5／10 | 5／10／15 | 5／10（無 15） |
| multi_shots | default true | 無此欄 | 有 | 有 |
| 計價錨 | 720p→16；default 1080p | 480p→8；default 1080p | 目錄 8（參考 2.5 級距，可疑） | — |
| 音訊 | `audio_url`；原生？live | 同 | 文案「原生音訊」 | 不可與 audio_url 併用 |

## 5. 站內點數

| 項 | 說明 |
|----|------|
| 目錄 points | **16** |
| 預估／扣點 | `estimatePoints` = 16；與 prompt 字數無關 |
| UI | 挑選器顯示 16 點；**未**進 `sc-t2v-sound` pickIds |
| 退點 | 生成失敗 terminal + 帳本退點；本回合**未**做 L5 |
| BYOK | 通用：自備 key 可不扣平台點 |
| 與官方 | **720p·5s ≈16**；**default 1080p·5s ≈23** → 若不送 `resolution:"720p"` 或動態估點，**平台倒貼** |
| 建議 | 本回合 **維持 16**；後續三選一：（A）`input` 明送 `resolution:"720p"`（+ 可選 `duration:"5"`）維持經濟敘事；（B）改錨 1080p·5s → points **~23**；（C）按 resolution×duration 動態估點 |

## 6. 情境與可用性

| 情境 | 適配 | 說明 |
|------|------|------|
| 正式一點又控成本的敘事片（bestFor） | △ | endpoint 已通；default 1080p 成本 ≠ 16 點；multi_shots 利多鏡 |
| 多鏡頭短預告／分鏡串 | ✅ | multi_shots default on；prompt 可寫 Shot [0-3s] |
| 開源質感天花板（strengths） | △ | 相對 2.2／2.5 升級；vs 商用 Kling／Veo 仍經濟檔 |
| 有聲原生對白 | △／❌ | schema 僅 `audio_url`；about 未列原生音——**P1 文案／live** |
| 指定 BGM 成片 | △ schema 可、站內未暴露 | 需 `audio_url` + 公網素材 |
| 畫面內中文字 | ❌ | 影片族通病；字卡另做 |
| 中文提示 | ✅ | OpenAPI 明寫 Chinese and English；umT5 |
| 精確 1:1 社群 | ✅ | 官方有 1:1 |
| 4:3／3:4 | △ 官方可、站內 format 無 | 非站內主軸 |
| 10／15 秒長鏡 | △ 官方可、站內未暴露 | 開 UI 前必須聯動估點（720p·15s≈47／1080p·15s≈70） |
| 480p 草稿 | ❌ | **schema 無** → 改用 #115 Wan 2.5 |
| 手動選模 | ✅ | category text-to-video，needs 無 |
| 助手／代理 | ✅ 可被選 | `verified:true` → operational ready；**recommended:false** + economy 16；倒貼見 P0 |
| MCP | ✅ | `find_model` 命中 **id**；`submit_generation` 帶 **目錄 id**（**勿**把 `wan/v2.6` 當 modelId） |

**文案一致性**：strengths「音畫一體」vs OpenAPI about **未列音訊**、僅 `audio_url`——**P1 文案／live 對質**（同 #115 原生音債）。

## 7. MCP / 文件

| 項 | 值 |
|----|-----|
| MCP `find_model` | category=`text-to-video`、keyword「Wan／2.6／開源／多鏡頭」、tier=economy、points=16 |
| MCP `submit_generation` | body：`projectId` + `modelId`=`fal-ai/wan/v2.6/text-to-video` + `prompt`；aspect 由專案 format；**勿**裸開 15s／默認 1080p 而不改估點 |
| 文件（現場） | [fal 模型頁 wan/v2.6](https://fal.ai/models/wan/v2.6) · 行銷 […/text-to-video](https://fal.ai/models/wan/v2.6/text-to-video) · [落地頁](https://fal.ai/wan-2.6) |
| OpenAPI（現場） | `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=wan/v2.6` |
| 定價摘要 | 720p **$0.10**/s · 1080p **$0.15**/s（無 480p） |
| 開發者文 | [Wan 2.6 Developer Guide](https://fal.ai/learn/devs/wan-26-developer-guide-mastering-next-generation-video-generation)（範例曾寫 `wan/v2.6/text-to-video`——**queue OpenAPI 該 path 404**，以 `wan/v2.6` 為準） |

**建議 MCP 形狀**：

```json
{
  "projectId": "<uuid>",
  "modelId": "fal-ai/wan/v2.6/text-to-video",
  "prompt": "莊嚴敘事短片：Overall soft golden hour temple courtyard. Shot 1 [0-3s] Wide establishing shot, incense smoke drifts. Shot 2 [3-5s] Slow push on stone steps, empty, no people no subtitles, cinematic 1080p feel"
}
```

（若產品堅持經濟 16 點，provider 層應再帶 `"resolution":"720p"`——站內 `input()` 尚未做。）

## 8. 建議動作

- [x] **修 endpoint** — 已寫 `endpoint: "wan/v2.6"`（id 保留 `fal-ai/wan/v2.6/text-to-video`）；`NEGATIVE_PROMPT` 以 **id** 為鍵已含本檔
- [x] **SEED_SUPPORTED** — 本輪補本 id（schema 有 seed）
- [x] **維持** points=16、verified=true、recommended=false（本回合不改 points／verified 字面）
- [ ] **P0 估點對齊 default** — 三選一或組合：  
  1. `input` 明送 `resolution: "720p"`（+ 可選 `duration: "5"`）維持 points=16 經濟敘事；  
  2. points 改錨 1080p·5s → **~23**；  
  3. 按 resolution×duration 動態 `estimatePoints`  
- [ ] 調 points — 見上；**本回合不需要**為通 endpoint 而改 16  
- [ ] 修 input 參數形狀 — aspect **已健康**；補 resolution／duration／multi_shots 策略見 P0  
- [ ] 下架或隱藏 — **否**  
- [ ] 文案 — strengths「音畫一體」改為「可接 audio_url／多鏡頭敘事」或 live 證實原生音後保留  
- [ ] cost 字串 — 去掉錯誤「6 秒基準」→「5 秒@錨定解析」；若錨 720p 勿同時強調預設 1080p 而不改點  
- [ ] L1 有效 probe — 有 FAL_KEY：`{}` 對 **`wan/v2.6`** 期望 **422 OK_VALIDATED**（勿 --yes 生成）  
- [ ] L4 live — 控費：先 **720p·5s** 單次（≈$0.50／16 點敘事）；禁止默認 1080p 無預算確認；禁 15s  
- [ ] 評估收錄 **r2v** `wan/v2.6/reference-to-video`；i2v #137 獨立卡審  
- [ ] 同步 `models-index.json` 的 `endpoint` 欄  
- [ ] 文件／教學：開發者文範例 path `…/text-to-video` 與 queue id 落差——站內以 `endpointOf` 為準  

**優先級（僅建議）**

| 級 | 項 |
|----|-----|
| **P0** | 預設 1080p 與扁平 16 點脫鉤：明送 720p **或** 調點／動態估點 |
| P1 | 「音畫一體」live 對質；cost「6 秒」文案 |
| P2 | 暴露 duration 10／15s 與 multi_shots UI 時必須聯動估點；可選 `audio_url` 產品路徑 |
| P3 | 收錄 r2v；4:3／3:4 format；文件 path 澄清 |
| — | aspect 三比例 **無需改**；neg／seed allowlist **已正確** |

## 9. 來源

1. OpenAPI Queue 2026-08-05：`endpoint_id=fal-ai/wan/v2.6/text-to-video` → **404**  
2. OpenAPI Queue 2026-08-05：`endpoint_id=fal-ai/wan-26/text-to-video` → **404**  
3. OpenAPI Queue 2026-08-05：`endpoint_id=wan/v2.6/text-to-video` → **404**  
4. OpenAPI Queue 2026-08-05：`endpoint_id=wan/v2.6` → **200** · `V26Input`／`V26Output` 全表 + `x-fal-metadata`（about、playgroundUrl）  
5. 同構抽樣：`wan/v2.6/image-to-video`、`wan/v2.6/reference-to-video`、`fal-ai/wan/v2.7/text-to-video`（200）；`fal-ai/wan-25/text-to-video`（200，對照）  
6. 公開定價句：[Wan v2.6 T2V 模型頁](https://fal.ai/models/wan/v2.6/text-to-video) — 720p $0.10／1080p $0.15 per second；[落地頁 FAQ](https://fal.ai/wan-2.6)  
7. 開發者文：[Wan 2.6 Developer Guide](https://fal.ai/learn/devs/wan-26-developer-guide-mastering-next-generation-video-generation)（subscribe 範例 path 與 OpenAPI 落差）  
8. 站內：`shared/models.ts`（entry ~L1176 `endpoint` 修、NEGATIVE／SEED allowlist、`parseRealCost`／`PRICE_VIDEO_SECONDS=5`／`USD_TO_TWD=31`、`endpointOf`）  
9. `shared/modelMechanics.ts`、`shared/textEncoders.ts`（dit／umT5 wan，含 `wan/` 前綴）  
10. `docs/點數校準報告.md`（Wan 2.6 列 15.5 ≈）、`docs/fal生態研究.md`（🔸推定）、`docs/模型目錄.md`  
11. 姊妹卡：`docs/model-audit/cards/fal-ai__wan__v2.5__text-to-video.md`（#115）  
12. 模型頁 HTML 本環境 429 — 定價以 OpenAPI + 搜尋快照／目錄交叉；**未** live 出片  

---

**R3 checklist（#116）**

- [x] L0 靜態契約  
- [x] OpenAPI／定價研究（舊 path／wan-26／…/text-to-video 皆 404；`wan/v2.6` 200；無 `--yes` live）  
- [x] 點數校準對照（720p·5s≈16；default 1080p·5s≈23）  
- [x] input vs schema（aspect 三比例健康；resolution／duration／multi_shots 未送）  
- [x] MCP／助手／Recipe／情境交叉  
- [x] **修** `endpoint` → `wan/v2.6`  
- [x] **補** `SEED_SUPPORTED`  
- [x] 九章卡 + `_index` #116 + heartbeat  
- [x] **未**改 verified／points；**未** live 扣費；**禁止 `--yes`**  
