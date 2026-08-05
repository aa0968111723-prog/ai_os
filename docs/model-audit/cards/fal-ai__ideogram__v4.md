---
depth: v2
model_id: fal-ai/ideogram/v4
label: Ideogram v4
endpoint_station: fal-ai/ideogram/v4
endpoint_official: ideogram/v4
category: text-to-image
tier: flagship
points: 1
verified: false
recommended: false
researched: 2026-08-05
openapi: https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=ideogram/v4
openapi_station_slug: "GET …?endpoint_id=fal-ai/ideogram/v4 → HTTP 404"
playground: https://fal.ai/models/ideogram/v4
documentation: https://fal.ai/models/ideogram/v4/api
---

# Ideogram v4 · `fal-ai/ideogram/v4`

## 0. 總覽

| 項 | 值 |
|----|-----|
| 站內 id | `fal-ai/ideogram/v4` |
| 站內 `endpointOf` | **同 id**（無 `endpoint` 覆寫）→ 會打 `queue.fal.run/fal-ai/ideogram/v4` |
| **官方 endpointId** | **`ideogram/v4`**（無 `fal-ai/` 前綴） |
| OpenAPI（站內 slug） | **HTTP 404** |
| OpenAPI（官方 slug） | **HTTP 200** · schema `V4Input` / `V4Output` |
| 類別 / tier / kind | `text-to-image` · **flagship** · `image` |
| 點數 / 官方成本 | **1 點** · **$0.015/MP**（Balanced 預設；Turbo $0.0075、Quality $0.025）；約 1MP≈$0.015、1080p(~2MP)≈$0.03 |
| verified / recommended | **false** / false |
| needs | 無（純文生圖） |
| 底層家族（站內） | `layout-specialized` — 設計／排版特化 |
| 文字塔 profile | `ideogram` / sentencepiece 標記 / **窗口未公開（站內）** |
| 負向提示 | OpenAPI **無** `negative_prompt`；站內 allowlist 亦未收 → 禁忌只能移出正向 |
| Seed | OpenAPI **有** `seed`；站內 `SEED_SUPPORTED` **未收** |
| 站內 `input()` | `{ prompt, aspect_ratio }` |
| 官方主尺寸欄 | **`image_size`**（enum 或 `{width,height}`），**無** `aspect_ratio` |
| 生成／助手 | 目錄可挑、MCP 可點名；**助手因 `verified:false` 不可代操**（→ `flux/dev`） |

**一句話定位：** Ideogram 系排版／文字渲染旗艦新版（fal 文案 V4.0q／Ideogram-4），按 **MP** 計費、比 v3 更便宜（1 點 vs 2 點）；英文海報／設計感社群圖主力之一。**兩項 P0：** (1) 站內 endpoint 多了 `fal-ai/` 前綴 → OpenAPI 404、提交大概率失敗；(2) 站內送 `aspect_ratio`，官方只認 `image_size` → 畫幅可能永遠落 `square_hd`。中文字卡勿當主力（改 Qwen／Seedream）。

**情境交叉（站內）：**

| 來源 | 角色 |
|------|------|
| `SCENARIO_RECIPES` `sc-design-poster` | **pickIds[1]**（次於 v3，先於 Recraft V3）— 設計感／英文排版海報 |
| `STYLE_SHOWDOWNS` `sh-image` 軸「排版/設計/英文海報」 | **runnerUpId**；winner = `fal-ai/ideogram/v3` |
| 工作流 | 金句旗艦工作流目前點 **v3** 非本 id；本 id 主要出現在 recipe／PK |
| 姊妹 | `fal-ai/ideogram/v3`（economy·2 點·OpenAPI 存活）；character／remix／remove-bg 等同系 |

**交叉結論（情境 × 契約 × 分詞）：**

| 情境 | 適配 | 原因 |
|------|------|------|
| 英文海報／字體設計感 | ⚠️ 產品意圖 ✅、執行 🔴 | recipe/PK 有位；endpoint slug 錯 + 尺寸欄名錯 |
| 繁中金句卡 | ❌ | 中文非整段字卡勿主力；playbook 鐵律 |
| 需禁忌硬控 | ❌ | schema **無** negative |
| 16:9／9:16 專案畫幅 | 🔴 | `aspect_ratio` 不在 OpenAPI |
| 助手代操 | ❌ | `verified:false` |
| 直接對 fal 手動打 API | ✅ 若用 `ideogram/v4` + `image_size` | 官方契約可用 |

---

## 1. 底層邏輯

### 1.1 家族與管線（站內 `modelMechanicsFor`）

- **family**: `layout-specialized`
- **label**: 設計／排版特化
- **conditioning**: 官方未公開

階段：

1. **文字塔編碼** — Ideogram（未公開）；站內不猜 token 上限。  
2. **文字與版面特化** — 畫面內文字與版面結構最佳化。

**Caveat：** 閉源 API 表面；不公開骨幹細節。外部生態另有 **Ideogram 4.0 開源權重 ~9.3B**（Ideogram 官方 blog 參數表含 max text tokens 2048 等）——**那是開源權重敘事**，與 fal 上架的 **V4.0q 託管 API** 是否同一後端未在本回合證實，**不得**把 2048 填進站內 encoder 窗口。

### 1.2 官方能力邊界（Queue OpenAPI `V4Input`）

| 能力 | 說明 |
|------|------|
| 必填 | 僅 `prompt` |
| 品質／速度 | `rendering_speed`: `TURBO` \| `BALANCED`(default) \| `QUALITY` — 文案：較快檔用較少 denoising steps |
| 加速 | `acceleration`: `none`(default) \| `low` \| `regular` \| `high` |
| 提示擴寫 | `expansion_model`: `None` \| `Medium`(default) \| `Large` — None 關擴寫且跳過其費；Large = Magic Prompt 最高品質 |
| 尺寸 | **`image_size`** preset 或 `{width,height}`；default **`square_hd`**；x-fal 寬高 512–3840、multiple_of 16 |
| 多圖 | `num_images` 1–4，default 1 |
| 安全 | `enable_safety_checker` default **true** |
| 輸出格式 | `output_format`: `jpeg`(default) \| `png` |
| 可重現 | `seed` optional int \| null |
| 同步 | `sync_mode` default false |
| **無** | `negative_prompt`、`style` / `style_preset` / `style_codes`、`color_palette`、`image_urls`、`aspect_ratio`、`expand_prompt`（v3 布林） |

相對 **v3**（`fal-ai/ideogram/v3`）：v4 契約**大幅精簡**（去 style 全家桶與 negative）；新增 `acceleration` / `expansion_model` 三檔 / `output_format` / `enable_safety_checker`；`num_images` 上限 4（v3 為 8）；**計費改 /MP**。

### 1.3 Queue OpenAPI 摘要

- **有效 URL**: `GET https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=ideogram/v4`（本機 2026-08-05，openapi **3.0.4**）
- **無效 URL（站內）**: `…?endpoint_id=fal-ai/ideogram/v4` → **404 null**
- **servers**: `https://queue.fal.run`
- **Input**: `V4Input`（title `TextToImageInput`）
- **Output**: `V4Output`（title `IdeogramV4Output`）
- **x-fal-metadata**: `endpointId=ideogram/v4`；playground `https://fal.ai/models/ideogram/v4`；about: *Generate an image from a text prompt using Ideogram-4.*
- **x-fal-order-properties（input）**:  
  `prompt`, `expansion_model`, `image_size`, `rendering_speed`, `acceleration`, `num_images`, `seed`, `sync_mode`, `enable_safety_checker`, `output_format`

### 1.4 商用／授權

- fal 落地頁定位：海報、logo、typography、realism／stylized；native 2K 能力敘事。  
- 開源權重授權與商業條款需獨立核（deep-dive 已標「授權需再確認」）；**本卡不臆測 license**。  
- 託管 API 使用以 fal 當期條款為準。

---

## 2. 分詞器／文字塔

| 項 | 站內實測／設定 |
|----|----------------|
| profile key | `ideogram`（`shared/textEncoders.ts`，`/ideogram/`） |
| label | Ideogram（未公開） |
| tokenizer 標記 | `sentencepiece`（**未內建真實 SP 模型**） |
| 公開窗口（站內） | **無**（禁止填假數字） |
| OpenAPI `prompt` | string，無 min/maxLength |
| 可量測 | **否**（`encoder.measured: false`） |

### 2.1 `measurePromptBudget`（id=`fal-ai/ideogram/v4`）

| 樣本 | 字元 | measured | totalTokens | segment status | overflows |
|------|------:|:--------:|------------:|----------------|:---------:|
| 短英：Minimal zen poster… Peace | 64 | **false** | `null` | `unmeasured` | false |
| 繁中海報敘事 | 63 | **false** | `null` | `unmeasured` | false |
| 長英：`very `×200 + poster… | 1040 | **false** | `null` | `unmeasured` | false |

**結論：** UI／trace 只顯示**字數**；不可顯示假 token。實務：英文為主、畫面內文字用引號寫清；中文長句改 Qwen。`expansion_model` 預設 **Medium** 可能擴寫提示——站內未暴露、亦未關成 `None`。

外部開源表若列 max text tokens 2048：**僅供對照，未寫入站內 profile**。

---

## 3. 站內契約 vs 官方 schema

### 3.1 目錄契約（`shared/models.ts`）

```ts
{
  id: "fal-ai/ideogram/v4",
  label: "Ideogram v4",
  category: "text-to-image",
  tier: "flagship",
  kind: "image",
  points: 1,
  cost: "$0.015/MP(Balanced 預設;Turbo $0.0075、Quality $0.025);約 1MP≈$0.015、1080p(~2MP)≈$0.03",
  verified: false,
  strengths: "排版龍頭新版;維持字型排版優勢並拉近寫實度",
  bestFor: "精緻英文海報、設計感社群圖(中文勿當主力)",
  input: (p, f) => ({ prompt: p, aspect_ratio: aspect(f) }),
  // 無 endpoint 覆寫 → endpointOf === id
}
```

`aspect(f)` → 字面 `"1:1"` / `"16:9"` / `"9:16"`。  
同檔 `imageSize(f)` → `square_hd` / `landscape_16_9` / `portrait_16_9`（多數文生圖用；**本模型未用**）。

### 3.2 三比例 input（站內實測）

| ProjectFormat | 站內 `input()` | 官方應送 | 契約判定 |
|---------------|----------------|----------|----------|
| `1:1` | `{ prompt, aspect_ratio: "1:1" }` | `image_size: "square_hd"`（或 `square`） | 🔴 **欄位名錯誤**；比例字串不在 OpenAPI |
| `16:9` | `{ prompt, aspect_ratio: "16:9" }` | `image_size: "landscape_16_9"` | 🔴 同上 |
| `9:16` | `{ prompt, aspect_ratio: "9:16" }` | `image_size: "portrait_16_9"` | 🔴 同上 |

官方 default `image_size` = **`square_hd`**。未知欄 `aspect_ratio` 若被忽略 → **所有專案畫幅可能都出方圖**。  
（與 v3 卡同一類 P0；v4 亦然。）

### 3.3 OpenAPI 全 properties 對照（Input · `V4Input`）

required：`["prompt"]`。本機拉取 2026-08-05，`endpoint_id=ideogram/v4`。

| # | 欄位 | 型別／約束 | 預設 | 站內 | 落差／備註 |
|---|------|------------|------|------|------------|
| 1 | `prompt` | string **required** | — | ✅ `p` | 唯一必填 |
| 2 | `image_size` | enum **或** `ImageSize{width,height}` | `square_hd` | ❌ **未送** | 站內改送不存在的 `aspect_ratio` |
| 3 | `expansion_model` | `None`\|`Medium`\|`Large` | `Medium` | ❌ | 吃預設擴寫＋可能加費 |
| 4 | `rendering_speed` | `TURBO`\|`BALANCED`\|`QUALITY` | `BALANCED` | ❌ | 計價關鍵（/MP 分檔） |
| 5 | `acceleration` | `none`\|`low`\|`regular`\|`high` | `none` | ❌ | |
| 6 | `num_images` | int 1–4 | 1 | ❌ | 站內一次一張語意 |
| 7 | `seed` | int \| null | — | ❌ | 不在 `SEED_SUPPORTED` |
| 8 | `sync_mode` | boolean | false | ❌ | queue OK |
| 9 | `enable_safety_checker` | boolean | true | ❌ | |
| 10 | `output_format` | `jpeg`\|`png` | `jpeg` | ❌ | |

**不存在於 Queue OpenAPI、站內卻送出的欄：**

| 欄位 | 站內 | 風險 |
|------|------|------|
| `aspect_ratio` | ✅ 三比例皆送 | **未知欄**；可能被忽略 → 尺寸失效；若嚴格校驗則 422 |

**v3 有、v4 已移除（勿再假設）：**  
`negative_prompt`, `style`, `style_preset`, `style_codes`, `image_urls`, `color_palette`, `expand_prompt`

**`image_size` 完整 enum：**  
`square_hd` | `square` | `portrait_4_3` | `portrait_16_9` | `landscape_4_3` | `landscape_16_9`  
+ 物件 `{ width, height }`（exclusiveMin 0、max 14142，schema default 各 512；x-fal 建議 512–3840、multiple_of 16）

### 3.4 OpenAPI Output · `V4Output`

| 欄位 | 型別 | required | 說明 |
|------|------|----------|------|
| `images` | `ImageFile[]` | ✅ | 生成圖；`url` required；可選 content_type / file_name / file_size / width / height |
| `timings` | object number map | ✅ | |
| `seed` | integer | ✅ | 實際 seed |
| `has_nsfw_concepts` | boolean[] | ✅ | 每張是否 NSFW 概念 |
| `prompt` | string | ✅ | 實際使用的 prompt（可能經 expansion） |

### 3.5 Queue paths（官方 `ideogram/v4`）

| Method | Path | 用途 |
|--------|------|------|
| POST | `/ideogram/v4` | 提交 |
| GET | `/ideogram/v4/requests/{request_id}/status` | 狀態 |
| GET | `/ideogram/v4/requests/{request_id}` | 結果 → `V4Output` |
| PUT | `/ideogram/v4/requests/{request_id}/cancel` | 取消 |

Auth：`Authorization` header（apiKeyAuth，Fal Key）。

**站內實際會 POST：** `/fal-ai/ideogram/v4`（因 `endpointOf` = id）→ 與官方 path **不一致**。

### 3.6 契約總評

| 維度 | 狀態 |
|------|------|
| **endpoint slug** | 🔴 **P0**：`fal-ai/ideogram/v4` OpenAPI 404；官方 `ideogram/v4` |
| 核心尺寸參數名 | 🔴 **P0**：`aspect_ratio` vs `image_size` |
| negative | ⚪ schema **無** — 不可補 allowlist |
| seed | 🟡 schema 有、消融 allowlist 未收 |
| expansion / speed / acceleration | ⚪ 吃預設（Medium + BALANCED + none） |
| 世界觀正向 | ✅ 文生圖注入類別 |
| 世界觀禁忌 | ⚠️ 無法走 negative |

**建議修正（本回合未 apply-fixes，僅記錄）：**

```ts
// 1) 校正 endpoint（擇一）
//    A. entry 加 endpoint: "ideogram/v4"（保留目錄 id 相容）
//    B. 全域 rename id → ideogram/v4（波及 recipe/PK/測試，較大）
// 2) 尺寸對齊
input: (p, f) => ({ prompt: p, image_size: imageSize(f) }),
// 3) 可選：SEED_SUPPORTED 加入本 id（消融）
// 4) 勿把 negative 加入 allowlist（schema 無此欄）
```

---

## 4. MCP

| 工具 | 與本模型關係 |
|------|----------------|
| `find_model` | keyword「Ideogram／排版／海報／poster」、`tier=flagship` 可命中；回傳 points=1、verified=false |
| `submit_generation` | `modelId: "fal-ai/ideogram/v4"` + `projectId` + `prompt`；**不需** `source_url` |
| `generate_into_scene` | 同分鏡路徑；世界觀＋扣點＋核准與網頁同源 |
| 世界觀 | 自動注入；禁忌**不會**進 negative（schema 亦無） |
| 點數 | `estimatePoints` = **1**（扁平） |
| **風險** | 即使 body 修對，**endpoint 前綴錯誤**仍可能整單失敗；外部 agent 自拼應打 `ideogram/v4` + `image_size` |

**MCP 建議呼叫形狀（站內 id 仍為現況）：**

```json
{
  "projectId": "<uuid>",
  "modelId": "fal-ai/ideogram/v4",
  "prompt": "Minimal event poster, bold geometric sans headline \"AWAKEN\", cream and indigo, generous whitespace, print-ready layout"
}
```

修復後期望 fal body 概念：`{ "prompt": "…", "image_size": "landscape_16_9" }`，endpoint **`ideogram/v4`**。

---

## 5. AI 代理／助手

| 路徑 | 行為（本回合實測） |
|------|-------------------|
| `modelIsOperationallyReady` | **false**（verified false） |
| `assistantModel(本 id)` | **null / undefined** |
| `pickGenerateModel(本 id)` | **退回** `fal-ai/flux/dev` |
| `listAssistantGenerateModels()` | **不含**本 id |
| 網頁挑選器／目錄 | 仍可手動選 |
| recipe `sc-design-poster` | pickIds 含本 id → 規劃可寫入，**執行層** endpoint／verified 雙重風險 |
| 風格 PK runner-up | 文件層有效；執行層受 slug + verified 限制 |
| Agent runner | 未 ready 模型通常擋 |

**助手策略（未來 verified + slug 修復後）：** 英文畫面描述 + 引號內文字；繁中標題改 Qwen；可提示關閉擴寫（`expansion_model: None`）以控費／控文案漂移（進階參數接上後）。

---

## 6. 生成可用性

| 項 | 狀態 |
|----|------|
| 官方 fal endpoint | **`ideogram/v4` 存在**（OpenAPI 200、models API status active） |
| 站內提交 endpoint | **`fal-ai/ideogram/v4` → OpenAPI 404** → **可用性極低** |
| 站內 verified | **false**（失敗退點保護） |
| needs / 來源圖 | 無 |
| 預設畫幅（官方） | `square_hd` |
| 站內畫幅意圖 | 專案比例，但參數名疑失效 |
| 提示擴寫 | 預設 Medium |
| 多圖 | 預設 1；上限 4 未暴露 |
| live-probe | 未做（無 FAL_KEY 同意；且站內 slug 已知 404） |
| 歷史連通 | `docs/fal端點連通報告.md` 曾標暫時性 5xx／逾時（舊探測） |
| 替代 | **`fal-ai/ideogram/v3`**（endpoint 存活、同排版定位、2 點）；或 Recraft V3 |

**不適用：** 繁中密集字卡；需保證非方圖輸出（修 input 前）；需 negative；助手一鍵代操；**在未改 endpoint 前的任何生產流量**。

---

## 7. 點數校準

| 項 | 值 |
|----|-----|
| 目錄 `points` | **1** |
| 目錄 `cost` | $0.015/MP（Balanced）；Turbo $0.0075；Quality $0.025；1MP≈$0.015、1080p~2MP≈$0.03 |
| `docs/點數校準報告.md` | 旗艦 · Ideogram v4 ⚠� · 1 點 · USD 中值 **0.015** · 用量假設 ×1MP · 估值 NT$ **0.5** · 判定 **≈** |
| 預設檔 | 不傳 `rendering_speed` → **BALANCED** @ $0.015/MP |
| 高解析風險 | 若實際輸出接近 **2K 原生**（宣傳語）或 1080p ~2MP → 供應商費 ≈$0.03 → 點數估 **1 可能偏低**（≈ NT$0.9 級）；**2K 方圖 ~4MP** 時更明顯 |
| `num_images`>1 | 若暴露，扁平 1 點會低估 |
| `expansion_model` | 官方描述 Large／擴寫「有費」——目錄未拆；吃預設 Medium 時點數假設可能略樂觀 |

**校準結論：** 以 **1MP + BALANCED** 假設與 1 點 **對齊**；產品若預設更高解析或 Quality／多圖，需改 **動態 /MP 估點** 或提高 points。Turbo 多收、Quality／大圖少收是主要偏差方向。

---

## 8. 測試與修復

### 8.1 已有覆蓋（間接）

| 區域 | 狀態 |
|------|------|
| `promptTokens.test.ts` | 曾用本 id 測 measure（unmeasured 路徑） |
| `aiModelPolicy.test.ts` | preferredId 本 id → 因未 verified 退平衡首選 |
| UI 測試 | creation-workbench 面板 mock 含 Ideogram v4 標籤 |
| 情境／PK | `sc-design-poster`、`sh-image` runner-up |
| negative/seed allowlist | 刻意不收 Ideogram（v4 schema 亦無 negative） |
| 專屬 input／endpoint 契約測試 | **無** |

### 8.2 建議回歸（≥1；本回合不改碼）

1. **P0 endpoint 存活（最高價值）**  
   ```ts
   // 概念：endpointOf(getModel("fal-ai/ideogram/v4")) === "ideogram/v4"
   // 或 OpenAPI: fal-ai/ideogram/v4 → 404 且 ideogram/v4 → 200 的契約測試（mock/fixture）
   ```
2. **P0 三比例 input**  
   - 修復後：`input("x","1:1"|"16:9"|"9:16")` →  
     `{ prompt:"x", image_size: "square_hd"|"landscape_16_9"|"portrait_16_9" }`  
   - assert **keys ⊆** `V4Input` properties（**不得**含 `aspect_ratio`）。
3. **P1 seed allowlist**（schema 有）：`supportsSeed(v4)===true` 若產品要消融。  
4. **P1 recipe 安全**：`sc-design-poster` 在 slug 未修前可暫以 **v3** 為唯一可執行 pick，或標 verified 閘。  
5. **P2 verified**：endpoint+input 修復並首跑成功後再 `verified:true`。

### 8.3 修復優先級

| 級 | 項 | 說明 |
|----|-----|------|
| **P0** | `endpoint: "ideogram/v4"`（或 rename id） | 否則 queue 路徑錯誤／OpenAPI 404 |
| **P0** | `input()` → `image_size: imageSize(f)` | 否則 16:9/9:16 可能全方圖 |
| **P1** | `SEED_SUPPORTED` 收錄 | 消融可固定噪聲 |
| **P1** | recipe／文案：標「執行前需 slug 修復」或暫降權 | 避免旗艦位誤導 |
| **P2** | 暴露 `rendering_speed` / `expansion_model` | 進階面板 + 動態估點 |
| **P2** | verified 認證 | 助手／代理解鎖 |
| **—** | negative allowlist | **不要**（schema 無） |

### 8.4 本回合

- **未** apply-fixes（worker 預設；endpoint 改動屬產品決策，非單純 input 422 熱修）。  
- **未** live 生成。  
- 卡 depth **v2** 完成。

---

## 9. 來源

1. OpenAPI Queue：`https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=ideogram/v4`（本機 2026-08-05，`V4Input` 全 10 properties）；同日 `endpoint_id=fal-ai/ideogram/v4` → **404**
2. fal models API 摘要：`endpoint_id=ideogram/v4`，display_name *Ideogram V4.0 Text to Image*，status active（2026-07-06 updated 標記）
3. 站內目錄：`/workspaces/ai_os/shared/models.ts`（entry、`aspect`/`imageSize`、`endpointOf`、negative/seed allowlist、`sc-design-poster`、`STYLE_SHOWDOWNS`）
4. 文字塔／量測：`shared/textEncoders.ts`、`server/services/promptTokens.ts`
5. 力學：`shared/modelMechanics.ts`（layout-specialized）
6. 生成：`server/services/generationCore.ts`（`falSubmit(endpointOf(model), …)`）
7. 助手／政策：`server/routers/assistant.ts`、`server/services/aiModelPolicy.ts`（本回合 operational false、pick→flux/dev）
8. MCP：`server/services/mcp.ts`（`find_model` / `submit_generation`）
9. 點數：`docs/點數校準報告.md`（Ideogram v4 ⚠︎ · 1 點 · 0.015/MP）
10. 前序：`docs/research/model-deep-dive-2026-08/文生圖逐一研究.md` #16、`站內落差與修復建議.md`、`docs/fal生態研究.md`、姊妹卡 `fal-ai__ideogram__v3.md`、Ideogram 4.0 開源 blog（僅外部參數敘事，非 fal schema）

---

**depth v2 checklist**

- [x] OpenAPI 全 properties 對照表（10 input + output + queue paths）
- [x] 站內 slug 404 vs 官方 slug 200 已記錄
- [x] 三比例 input
- [x] measurePromptBudget 短／長（unmeasured 誠實）
- [x] MCP / 助手代理 / 情境交叉
- [x] 點數校準（/MP + 高解析假設）
- [x] §8 建議回歸 ≥1 + P0–P2
- [x] 無 live-probe；無不必要 apply-fixes
- [x] 中文風險已標；未填假 token 窗口
