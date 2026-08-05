# fal-ai/ideogram/v3

> slug: `fal-ai__ideogram__v3` · 審計 #7 · R1 static+research · 2026-08-05  
> 本輪 **零 live／禁止 `--yes`**；未改 `verified`／`points`。  
> **可註**：budget 無本 id 歷史 live；姊妹 remix／replace-bg／character 另卡。

## 1. 身分

| 欄位 | 值 |
|------|-----|
| 站內 id | `fal-ai/ideogram/v3` |
| 實際 endpoint | **同 id**（無 `endpoint` 覆寫；`endpointOf` → 自身） |
| label | Ideogram v3 |
| category / tier / kind | `text-to-image` · `economy` · `image` |
| verified | **false**（目錄未標查證；OpenAPI 本輪 **200**；**無** L2 live） |
| needs | 無（純文生圖） |
| recommended | 否（`undefined`／非 recommended 旗標） |
| strengths | 文字排版之王;海報級字型渲染、設計感強 |
| bestFor | 金句卡、活動海報、含大量文字的社群圖 |
| 廠商 | **Ideogram V3** via fal.ai（閉源；MagicPrompt／style presets） |
| MODELS 序 | index **6**（文生圖第七條；審計總表 **#7**） |

**一句話**：Ideogram 系**文字排版／設計海報**經濟主力——英文／拉丁字體與版面美學強；站內 `sc-design-poster` 首選與 showdown「排版/設計/英文海報」**winner**。**P1 契約**：站內送 `aspect_ratio`，官方只認 **`image_size`** → 專案 16:9／9:16 可能永遠落 default **`square_hd`**。繁中長字卡勿當主力（playbook 鐵律 → Qwen／Seedream／GPT Image）；旗艦工作流 `wf/quote-card-flagship` 卻用本模出繁中——產品債。

## 2. 數值

| 項目 | 值 |
|------|-----|
| points | **2** |
| cost（目錄字串） | `$0.03–0.09/張` |
| 官方價與單位（fal 生態／檔位） | **TURBO $0.03**／**BALANCED $0.06**（OpenAPI default）／**QUALITY $0.09** 每張 |
| 估值 NT$（USD_TO_TWD=31） | 範圍中值 **$0.060** × 31 = **1.86** → 四捨五入 **2** 點 |
| 校準判定 | **≈**（`docs/點數校準報告.md` 經濟 Ideogram v3：估值 NT$1.9，≈） |
| estimatePoints | 扁平 **2**（`realPricePoints` 自 cost 覆寫；`parseRealCost` → usdMid=0.06、multiplier=1；非 TTS 動態） |

**數值落差（文件／產品級，非契約破）**

- 站內不送 `rendering_speed` → 吃官方 default **BALANCED** → 真實帳單 ≈ **$0.06**（與中值估點對齊）✓。
- 若未來暴露 **TURBO** 而不降點 → 小幅高估（$0.03≈1 點）；暴露 **QUALITY** 而不升點 → 低估（$0.09≈3 點）。
- `num_images` 1–8：站內不送 → 1 張；暴露多圖須 ×N 估點。
- `expand_prompt` default **true**（MagicPrompt）— 可能改寫提示；費用敘事併入當檔 rendering_speed（站內未關）。
- cost 用範圍中值合理；P2 可寫 `$0.06/張(BALANCED; TURBO $0.03、QUALITY $0.09)`。
- **本輪禁止改 points**（維持 2）。

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| 靜態契約 L0 | **部分綠**（endpoint／id 一致、points 校準≈；**input 欄位名錯**） |
| endpointOf | `getModel` → endpoint 即 id ✓（**非** v4 的 `fal-ai/` 前綴 404 問題） |
| input 16:9 | `{ prompt, aspect_ratio: "16:9" }` ← **官方 schema 無此欄** |
| input 9:16 | `{ prompt, aspect_ratio: "9:16" }` ← 同上 |
| input 1:1 | `{ prompt, aspect_ratio: "1:1" }` ← 同上；官方 default 本為 square |
| OpenAPI 對齊 | Queue OpenAPI 2026-08-05 拉取 **HTTP 200**：`IdeogramV3Input` required 僅 `prompt`；尺寸欄 = **`image_size`**；**有** `negative_prompt`；**有** `seed` |
| supportsNegativePrompt | **false**（allowlist **刻意不收** Ideogram；但 OpenAPI **有** `negative_prompt` default `""` → 可選補收） |
| supportsSeed | **false**（`SEED_SUPPORTED` 未收；OpenAPI **有** `seed`） |
| dry-run probe | 本輪未跑 `verify-models`（R1 研究） |
| live probe | **本輪未跑**（禁止 `--yes`）；budget **無**本 id 成功紀錄 |
| 結論 | **ready-static-with-gap**：端點存活 + 點數合理；**P1 必修** `input()` → `image_size`；L2 後再考慮 `verified=true` |

### OpenAPI 摘要（`GET …/openapi.json?endpoint_id=fal-ai/ideogram/v3`）

- Paths：`POST /fal-ai/ideogram/v3`（queue）、status／cancel／result。
- openapi **3.0.4**；Queue base `https://queue.fal.run`
- **x-fal-metadata**：endpointId=`fal-ai/ideogram/v3`；category=`text-to-image`；about: *Ideogram V3*；playground／docs 與 id 一致。
- Schema：`IdeogramV3Input`（title `BaseTextToImageInputV3`）／`IdeogramV3Output`（title `OutputV3`）
- **x-fal-order-properties（input）**：  
  `image_urls`, `rendering_speed`, `color_palette`, `style_codes`, `style`, `expand_prompt`, `num_images`, `seed`, `sync_mode`, `style_preset`, `prompt`, `image_size`, `negative_prompt`
- Input 要點：
  - `prompt`：**required** string
  - **`image_size`**：default **`square_hd`**；enum  
    `square_hd|square|portrait_4_3|portrait_16_9|landscape_4_3|landscape_16_9` **或** `{width,height}`（寬高 exclusiveMin 0、max 14142）
  - **無 `aspect_ratio`**（全 schema 字串搜尋 false）
  - `rendering_speed`：`TURBO|BALANCED|QUALITY`，default **`BALANCED`**
  - `expand_prompt`：boolean，default **true**（MagicPrompt）
  - `negative_prompt`：string，default `""`（「prompt 描述優先於 negative」）
  - `seed`：integer \| null
  - `num_images`：1–8，default 1
  - `style`：`AUTO|GENERAL|REALISTIC|DESIGN` \| null（不可與 `style_codes` 並用）
  - `style_preset`：62 種字串 enum \| null（如 `TRAVEL_POSTER`、`EDITORIAL`、`MINIMAL_ILLUSTRATION`…）
  - `style_codes`：8 字元 hex 陣列 \| null
  - `image_urls`：風格參考圖陣列 \| null（總量 ≤10MB；JPEG/PNG/WebP）
  - `color_palette`：preset 名（`EMBER|FRESH|…|ULTRAMARINE`）或 RGB members
  - `sync_mode`：boolean，default false
- Output required：`images[]`（File.url…）+ `seed`
- 站內 `input()` 只送 `prompt` + **`aspect_ratio`**（非法欄）→ 尺寸吃 **`square_hd`**；其餘吃預設（BALANCED、MagicPrompt on、1 張、style 空）。

### 全 properties 對照

| 官方 property | 型別 / 約束 | 預設 | 站內 `input()` | 備註 |
|---------------|-------------|------|----------------|------|
| `prompt` | string **required** | — | ✅ 送出 | 唯一必填 |
| `image_size` | ImageSize 或 enum | square_hd | ❌ **未送** | **P1：應映射三比例** |
| `aspect_ratio` | — | — | ✅ 誤送 `"16:9"` 等 | **schema 不存在**；多半被忽略 |
| `rendering_speed` | TURBO\|BALANCED\|QUALITY | BALANCED | ❌ | 檔位價 |
| `expand_prompt` | boolean | true | ❌ | MagicPrompt |
| `negative_prompt` | string | `""` | ❌ | allowlist 未收；OpenAPI 有 |
| `seed` | int \| null | — | ❌ | SEED 未收 |
| `num_images` | int 1–8 | 1 | ❌ | |
| `style` | AUTO\|GENERAL\|REALISTIC\|DESIGN | — | ❌ | 設計海報可 DESIGN |
| `style_preset` | 62 presets | — | ❌ | 可選 P3 UI |
| `style_codes` | hex[] | — | ❌ | 互斥 style |
| `image_urls` | url[] | — | ❌ | 風格參考；非 needs=image |
| `color_palette` | preset／members | — | ❌ | |
| `sync_mode` | boolean | false | ❌ | |

### 三比例 input（本機求值 vs 建議）

| format | 現況 body | 建議 body |
|--------|-----------|-----------|
| 1:1 | `{"prompt":"…","aspect_ratio":"1:1"}` | `{"prompt":"…","image_size":"square_hd"}` |
| 16:9 | `{"prompt":"…","aspect_ratio":"16:9"}` | `{"prompt":"…","image_size":"landscape_16_9"}` |
| 9:16 | `{"prompt":"…","aspect_ratio":"9:16"}` | `{"prompt":"…","image_size":"portrait_16_9"}` |

```ts
// shared/models.ts 現況（P1 錯欄）
input: (p, f) => ({ prompt: p, aspect_ratio: aspect(f) }),
// 建議（與 FLUX imageSize 同一 helper）
input: (p, f) => ({ prompt: p, image_size: imageSize(f) }),
// imageSize: 9:16→portrait_16_9、1:1→square_hd、其餘→landscape_16_9
```

## 4. 底層

| 面向 | 說明 |
|------|------|
| 架構 | **設計／排版特化**（`modelMechanics` family `layout-specialized`）：畫面內文字＋版面結構最佳化；**非**經典 SD steps·CFG 公開管線 |
| 條件／文字 | Ideogram 閉源文字塔；**MagicPrompt**（`expand_prompt` default on）可擴寫提示 |
| 風格 | `style` 四型 + 62 `style_preset` + `style_codes` + 可選 `image_urls` 風格參考 + `color_palette` |
| 解析度 | `image_size` preset 或自訂寬高；default square_hd |
| 檔位 | `rendering_speed` 影響 denoising 步數／品質／單價（Turbo 快便宜、Quality 精緻） |
| 站內 encoder | `shared/textEncoders.ts`：`/ideogram/` → profile **`ideogram`**／sentencepiece 標記；**limitTokens 未公開** → `measured: false` |
| 負向 | schema **有** `negative_prompt`；站內 allowlist **刻意不收**（註：Ideogram 列在「刻意不收」清單）— OpenAPI 已確認有欄 → **P2 可補 allowlist** |
| input 組裝 | `(p, f) => ({ prompt: p, aspect_ratio: aspect(f) })`；`aspect = (f) => f` → 直接傳 `"16:9"` 等字串 |
| 送出路徑 | `generationCore` → `endpointOf`（= id）→ `falSubmit("fal-ai/ideogram/v3", …)` |
| 與官方差異 | **欄名錯**（aspect_ratio vs image_size）；不送 style／rendering_speed／expand_prompt=false；seed／negative 未 allowlist |
| 家族 | T2I 本卡；旗艦 `fal-ai/ideogram/v4`（**endpoint slug 404 風險**，另卡）；remix `…/v3/remix`；replace-bg；character；remove-background |

## 5. 站內點數路徑

```
UI / MCP generate_into_scene / agent
  → prepare（estimatePoints(model, { promptChars, usdToTwdRate })）
  → est = 2（本模扁平；realPricePoints("$0.03–0.09/張") → mid 0.06 → 2）
  → member 且 est ≥ 組 approvalThreshold → awaiting_approval（不扣點）
  → 否則 insert generations(pointsEst=est) + reserveQuota(user, group, est, …, genId)
  → falSubmit(endpointOf)  // = fal-ai/ideogram/v3
  → 失敗 refund(…, pointsEst, …)
  → BYOK 個人 fal key：略過平台扣點與核准門檻
```

| 檢查 | 結果 |
|------|------|
| 顯示點數 | catalog／UI 用 `model.points`＝2（載入時 realPricePoints 覆寫後仍 2） |
| 扣點／退點 | 同 `pointsEst`＝`estimatePoints` → 一致 |
| 與 cost 校準 | $0.06×31≈1.86 → 2 點 ≈；預設 BALANCED 實帳對齊中值 |
| verified false | 助手 **不可**代操首選本模；失敗仍應走既有 refund（勿略過退點） |
| 本輪 | **禁止**改 points／verified；**禁止** `--yes` live |

## 6. 暴露面

| 通路 | 是否暴露 | 備註 |
|------|:--------:|------|
| 模型選擇器（文生圖 economy） | ✅ | MODELS 文生圖第 7 條；無 needs；**非** recommended |
| `model_catalog` 同步 | ✅ | id = endpoint；points=2；verified=false |
| tRPC generation | ✅ | modelId 即全路徑 id |
| MCP `generate_into_scene`／`submit_generation` | ✅ | 可點名；openWorld；**助手因 verified=false 不代操** |
| Scene recipe `sc-design-poster` | ✅ | **pickIds[0]** 首選（英文排版海報） |
| Style showdown「排版/設計/英文海報」 | ✅ | **winnerId**；runner = v4 |
| Workflow `wf/quote-card-flagship` | ⚠️ | 步驟「生成文字卡」→ **本 id + 繁中模板**（與 playbook「Ideogram 勿中文」衝突） |
| Workflow `wf/quote-card-economy` | ❌ 本 id | 經濟金句卡他模 |
| scenarioPlaybook `quote-card` | ❌ 本 id | 正確導 Qwen／GPT Image |
| negative_prompt | ❌ | OpenAPI 有；allowlist 無 |
| seed（消融／系列） | ❌ | 官方有；SEED 未收 |
| rendering_speed／style／style_preset／MagicPrompt UI | ❌ | 吃預設 BALANCED + expand on |
| 自訂 width×height | ❌ | 且現況連 preset 都沒正確送 |
| 來源圖 | ❌ 本端點 | 風格參考 `image_urls` 未暴露；remix／character 另端點 |

**MCP 陷阱**：傳 id `fal-ai/ideogram/v3` 即可（無別名）；**現況**即使用正確 id，**畫幅欄無效**直到修 `input()`；**勿**與 `fal-ai/ideogram/v4` 混用（v4 另有 endpoint 404 風險）；**勿**把繁中金句卡當本模主力；**勿**未改估點前暴露 `num_images`>1 或強制 QUALITY。

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 英文／拉丁字體海報、設計感社群圖 | ✅ **首選** | bestFor；`sc-design-poster`；showdown winner |
| 金句卡（**英文**）／活動英文主視覺 | ✅ | 排版之王定位 |
| 繁中金句卡・書法密集長段 | ❌ | playbook 鐵律；改 Qwen／Seedream／GPT Image |
| `wf/quote-card-flagship` 繁中路徑 | ⚠️ 錯配 | 工作流用本模出繁中 → 應改 Qwen 或改模板為英文 |
| 16:9／9:16 專案畫幅 | 🔴 現況 | aspect_ratio 無效 → 多半 square_hd |
| 系列重現（同 seed） | △ | 官方支援；站內未 allowlist |
| 需禁忌硬控 negative | △ | schema 有；allowlist 未開 → 只能移出正向 |
| 風格 preset／色盤控制 | △ | 官方強；站內未暴露 |
| 正式中文長版海報 | ❌ | sc-cn-poster／Seedream／Qwen Pro |
| 圖生圖 remix／換背景／角色一致 | ❌ 本端點 | 走 v3/remix、replace-background、character |
| 助手代操 | ❌ | verified=false |

bestFor 文案偏「金句卡」**過寬**（未標英文）— 與 strengths「文字排版」及中文避雷不一致；**英文排版海報**才是精準定位。

## 8. 文件

| 來源 | 用途 |
|------|------|
| fal Queue OpenAPI | `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/ideogram/v3`（本輪 curl **200**；`IdeogramV3Input`／`image_size`／negative／seed） |
| fal 模型頁 | https://fal.ai/models/fal-ai/ideogram/v3 |
| fal API 文件 | https://fal.ai/models/fal-ai/ideogram/v3/api |
| 站內 | `shared/models.ts` L288–292（目錄／誤用 `aspect_ratio`）；`NEGATIVE` 刻意不收註解 L120–121；`SEED_SUPPORTED` 未收；`textEncoders.ts` ideogram；`modelMechanics.ts` layout-specialized；`SCENARIO_RECIPES` sc-design-poster；`STYLE_SHOWDOWNS` winner；`WORKFLOW_PRESETS` quote-card-flagship；`generationCore` 路徑 |
| 既有研究 | `docs/research/model-deep-dive-2026-08/文生圖逐一研究.md` #7；`站內落差與修復建議.md` P1 aspect_ratio vs image_size、P2 檔位價 |
| 清查／生態 | `docs/fal生態研究.md` Ideogram v3 列（Turbo/Default/Quality）；`docs/模型目錄.md`；`docs/模型清查清單.md` |
| 點數 | `docs/點數校準報告.md`（$0.060 中值 → 1.9 ≈）；本機 `realPricePoints`／`estimatePoints` → **2** |
| 姊妹卡 | `docs/model-audit/cards/fal-ai__ideogram__v4.md`（v4 契約精簡、endpoint 404） |
| live | budget **無**本 id；本輪禁止 `--yes` |

## 9. 建議動作

- [x] **維持** id＝endpoint 全路徑 `fal-ai/ideogram/v3`（OpenAPI／metadata 一致；**勿**改成去前綴）
- [x] **維持** points=2（BALANCED 中值校準 ≈；本輪禁止改 points）
- [x] **維持** verified=false 至 L2 live 成功後再升
- [x] **維持** 常規不暴露 style 全家桶／num_images（簡化 OK）
- [x] **註記** 零 live／禁止 `--yes`；endpoint 靜態存活
- [ ] **P1 必修**：`input()` 改 `(p,f)=>({ prompt:p, image_size: imageSize(f) })` + 單測三比例 → 消除 square 死畫幅
- [ ] **P1 文案**：bestFor 收斂為「**英文**金句卡／設計海報／拉丁字排版社群圖」；中文導 Qwen
- [ ] **P1 產品**：`wf/quote-card-flagship` 繁中步驟改 `qwen-image-2`（或 Pro），或模板改英文——消除與 playbook 矛盾
- [ ] **P2**：OpenAPI 已確認 → 可將本 id 加入 `NEGATIVE_PROMPT_SUPPORTED`（禁忌硬控）；加入 `SEED_SUPPORTED`（消融／系列）
- [ ] **P2 cost 文案**：`$0.06/張(BALANCED; TURBO $0.03、QUALITY $0.09)`
- [ ] **P3**：進階面板 `rendering_speed`（須動態估點 1／2／3）與可選 `style=DESIGN`／常用 `style_preset`
- [ ] **P3**：可選關 `expand_prompt: false`（要提示詞一字不改時）
- [ ] **L2**：有 KEY 時 `verify-models --probe`（**勿**本輪 `--yes`）；成功後再 `verified=true`
- [ ] **勿**把本模當中文長字卡第一主力
- [ ] **勿**與 v4 混 endpoint；v4 另修 slug
- [ ] **勿**未改估點前暴露 QUALITY 或 `num_images`>1

**L0 結論**：endpoint／OpenAPI **200**、點數扁平 **2≈**、無 needs——**可連通骨架綠**。**L1 契約缺口 P1**：`aspect_ratio` 非官方欄、應改 `image_size`（否則 16:9／9:16 專案失真）。**L2** 未跑。剩餘：negative／seed allowlist 可選補齊、旗艦金句工作流中文錯配、bestFor 英文收斂。無 P0 端點 404（對照 v4）。
