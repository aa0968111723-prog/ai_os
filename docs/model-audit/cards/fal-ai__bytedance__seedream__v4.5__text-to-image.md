# fal-ai/bytedance/seedream/v4.5/text-to-image

> slug: `fal-ai__bytedance__seedream__v4.5__text-to-image` · 審計 #4 · R1 static+research · 2026-08-05  
> 零 live；未改 `verified`／`points`。OpenAPI 綠；`input` 僅 `prompt`+`image_size` preset，與 schema 對齊。

## 1. 身分

| 欄位 | 值 |
|------|-----|
| 站內 id | `fal-ai/bytedance/seedream/v4.5/text-to-image` |
| 實際 endpoint | **同 id**（無 `endpoint` 覆寫；`endpointOf` → 自身） |
| label | Seedream 4.5 |
| category / tier / kind | `text-to-image` · `flagship` · `image` |
| verified | **true**（目錄已翻；本輪未再 live） |
| needs | 無（純文生圖） |
| recommended | 否（`undefined`／非 recommended 旗標） |
| strengths | 字節旗艦;深度思考式提示理解、原生 14 語文字渲染、密集版面控制 |
| bestFor | 含中文字的畫面(標題卡、海報)、多元素構圖 |
| 廠商 | ByteDance **Seedream 4.5** via fal.ai |
| MODELS 序 | index 3（文生圖第四條，#4） |

**一句話**：字節旗艦文生圖——原生多語（約 14 語）文字渲染 + 密集版面控制；站內 **1 點**即可出含中文標題的多區塊主視覺，長段落字卡仍讓 Qwen 系優先、零錯字對外正式物升 GPT Image 2。

## 2. 數值

| 項目 | 值 |
|------|-----|
| points | **1** |
| cost（目錄字串） | `$0.04/張` |
| 官方價與單位 | **$0.04 per image**（flat；約 25 張／$1；非 /MP） |
| 估值 NT$（USD_TO_TWD=31） | $0.04 × 31 = **1.24** → 四捨五入 **1** 點 |
| 校準判定 | **≈**（`docs/點數校準報告.md` 旗艦 Seedream 4.5：估值 NT$1.2，≈） |
| estimatePoints | 扁平 **1**（與 promptChars 無關） |

**數值落差（文件／產品級，非本輪改點）**

- flat per image 與「1 點 ≈ NT$1」略低估 0.2 元級，落在 ≈。
- 若未來暴露 `num_images`／`max_images`>1 而不 ×N 估點 → **帳單低估**（站內 input 不送 → 現無缺口）。
- `auto_4K` 若仍 flat $0.04 則點數仍 1；若供應商改按 MP 計需重校 cost 字串。
- **本輪禁止改 points**（維持 1）。

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| 靜態契約 L0 | **ok** |
| endpointOf | `getModel` → endpoint 即 id ✓ |
| input 16:9 | `{ prompt, image_size: "landscape_16_9" }` |
| input 9:16 | `{ prompt, image_size: "portrait_16_9" }` |
| input 1:1 | `{ prompt, image_size: "square_hd" }` |
| OpenAPI 對齊 | Queue OpenAPI 2026-08-05 拉取 **200**：`BytedanceSeedreamV45TextToImageInput` required 僅 `prompt`；`image_size` anyOf `{width,height}` **或** enum preset（含站內三 preset + `auto_2K`/`auto_4K`）；**無** `negative_prompt` |
| supportsNegativePrompt | **false** ✓（OpenAPI 無欄；allowlist 未收） |
| supportsSeed | **false** ✓（官方有 `seed`；`SEED_SUPPORTED` **未收**） |
| dry-run probe | 本輪未跑 `verify-models` |
| live probe | **未跑**（R1 零 live；禁止 `--yes`） |
| 結論 | **ready-static-only**（契約綠＋verified true；本輪無新 live 證據） |

### OpenAPI 摘要（`GET …/openapi.json?endpoint_id=fal-ai/bytedance/seedream/v4.5/text-to-image`）

- Paths：`POST /fal-ai/bytedance/seedream/v4.5/text-to-image`（queue）、status／cancel／result。
- **x-fal-metadata**：endpointId=`fal-ai/bytedance/seedream/v4.5/text-to-image`；category=`text-to-image`；about: Generate images using Bytedance's Seedream 4.5 model.
- Schema 名：`BytedanceSeedreamV45TextToImageInput` / `BytedanceSeedreamV45TextToImageOutput`（title: SeedDream45T2IInput / SeedDream45T2IOutput）
- openapi **3.0.4**；Queue base `https://queue.fal.run`
- Input 可選：
  - `image_size`：default `{width:2048,height:2048}`；examples `auto_2K`；enum `square_hd|square|portrait_4_3|portrait_16_9|landscape_4_3|landscape_16_9|auto_2K|auto_4K` **或** `ImageSize{width,height}`（描述：寬高 1920–4096，或總像素 2560×1440 … 4096×4096）
  - `num_images` 1–6（default 1）— 分開執行的 generation 次數
  - `max_images` 1–6（default 1）— >1 啟用 multi-image；總張數介於 `num_images` 與 `max_images×num_images`
  - `seed` int \| null
  - `sync_mode` boolean（default false）
  - `enable_safety_checker` boolean（default **true**）
- **無** `negative_prompt`／`num_inference_steps`／`guidance_scale`
- Output required：`images[]`（`url`…）+ `seed`
- 站內 `input()` 只送 `prompt` + **preset** `image_size`；其餘吃預設（num=1、safety=true）。

### 全 properties 對照

| 官方 property | 型別 / 約束 | 預設 | 站內 `input()` | 備註 |
|---------------|-------------|------|----------------|------|
| `prompt` | string **required** | — | ✅ 送出 | 唯一必填 |
| `image_size` | ImageSize 或 enum | 2048² | ✅ enum 映射 | 三比例皆在 enum 內 |
| `num_images` | int 1–6 | 1 | ❌ 不送 | |
| `max_images` | int 1–6 | 1 | ❌ 不送 | 避免帳單放大 |
| `seed` | int \| null | — | ❌ 不送 | SEED 未收 |
| `sync_mode` | boolean | false | ❌ | |
| `enable_safety_checker` | boolean | true | ❌ | 吃預設 |
| `negative_prompt` | — | — | **不存在** | allowlist 正確 |

### 三比例 input（本機求值）

| format | body |
|--------|------|
| 1:1 | `{"prompt":"t","image_size":"square_hd"}` |
| 16:9 | `{"prompt":"t","image_size":"landscape_16_9"}` |
| 9:16 | `{"prompt":"t","image_size":"portrait_16_9"}` |

```ts
// shared/models.ts 現況（正確）
input: (p, f) => ({ prompt: p, image_size: imageSize(f) }),
```

## 4. 底層

| 面向 | 說明 |
|------|------|
| 架構 | 字節 **Seedream 4.5**；公開敘述 **DiT + VAE** 擴散系；**生成 + 編輯統一架構**（本卡僅 t2i） |
| 條件 | 正向 `prompt` 為主；無 negative／無公開 steps／CFG 旋鈕 |
| 解析度 | 約 **4MP（2048²）** 級；描述窗 1920–4096 或高解析總像素；enum 含 `auto_2K`／`auto_4K` |
| 計費底層 | fal **flat $0.04/image** |
| 站內 encoder | `shared/textEncoders.ts`：`/seedream|seededit|bytedance/` → profile `seedream`「字節 Seed 系（未公開）」；**limitTokens undefined** → `measurePromptBudget` **`measured: false`** |
| 站內 mechanics | `modelMechanicsFor` 目前 **`family: unknown`**（正則未收 seedream）— P1 缺口 |
| 負向／seed | schema 無 negative → 禁忌只能移出正向；官方有 seed 但站內未收 → 不可 seed 消融 |
| input 組裝 | `(p, f) => ({ prompt: p, image_size: imageSize(f) })`；9:16→portrait_16_9、1:1→square_hd、其餘→landscape_16_9 |
| 送出路徑 | `generationCore` → `endpointOf`（= id）→ `falSubmit`；**不**注入 `negative_prompt` |
| 與官方差異 | 官方 default 尺寸 2048²／example `auto_2K`；站內橫幅統一 **16:9** preset（產品覆寫，合法） |
| 家族 | 文生圖本卡；Edit `fal-ai/bytedance/seedream/v4.5/edit`（#33）；v5 t2i #15（OpenAPI **200**（2026-08-05 覆核），勿當可用） |

## 5. 站內點數路徑

```
UI / MCP generate_into_scene / agent
  → prepare（estimatePointsFor(model, { promptChars, usdToTwdRate })）
  → est = 1（本模扁平；realPricePoints 自 cost $0.04 → 1）
  → member 且 est ≥ 組 approvalThreshold → awaiting_approval（不扣點）
  → 否則 insert generations(pointsEst=est) + reserveQuota(user, group, est, …, genId)
  → falSubmit(endpointOf)  // = fal-ai/bytedance/seedream/v4.5/text-to-image
  → 失敗 refund(…, pointsEst, …)
  → BYOK 個人 fal key：略過平台扣點與核准門檻
```

| 檢查 | 結果 |
|------|------|
| 顯示點數 | catalog／UI 用 `model.points`＝1 |
| 扣點／退點 | 同 `pointsEst`＝`estimatePoints` → 一致 |
| 與 cost 校準 | $0.04×31≈1.24 → 1 點 ≈ |
| verified true | 已人審翻 true；本輪零 live 不回退 |

## 6. 暴露面

| 通路 | 是否暴露 | 備註 |
|------|:--------:|------|
| 模型選擇器（文生圖 flagship） | ✅ | MODELS 第四條；無 needs |
| `model_catalog` 同步 | ✅ | id = endpoint；points=1；verified true |
| tRPC generation | ✅ | modelId 即本 id |
| MCP `generate_into_scene` / `submit_generation` | ✅ | 不需 source；openWorld；扣點＋核准 |
| Scene recipe `sc-quote-card` | ✅ | pickIds[1]（Qwen Standard → **本模型** → GPT Image 2） |
| scenarioPlaybook `poster` | ✅ | **首選** Seedream 4.5 多文字區塊主視覺 |
| Style showdown「中文字準(金句/書法)」 | ✅ | **runnerUp**（winner Qwen Image 2.0） |
| 工作流 `wf/full-short-flagship` | ✅ | 步驟「先出定調圖」= 本 id |
| 禁忌 negative_prompt | ❌ | schema／allowlist 皆無 |
| seed | ❌ | 官方有、站內 SEED 未收 |
| num_images／max_images／auto_2K | ❌ | 吃 1／1／preset 名 |
| steps／guidance UI | ❌ | schema 無；勿誤送 → 422 |

**MCP 陷阱**：無 endpoint 別名，傳 id 即可；**禁止**自拼 `negative_prompt`、日常勿擅自 `num_images`/`max_images`>1（估點仍 1）。

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 含中文標題的活動海報／多文字區塊 | ✅ 主力 | bestFor；playbook poster 首選 |
| 中文金句卡・書法字卡 | ✅ 次選 | sc-quote-card pickIds[1]；SOTA 仍 Qwen |
| 中文字準 PK | ✅ runner-up | STYLE_SHOWDOWNS 中文字準軸 |
| 完整短片定調圖 | ✅ | wf/full-short-flagship 步驟 2 |
| 大量試構圖／草稿 | △ | 1 點可但日常預設仍 FLUX.1 [dev] |
| 世界觀禁忌硬控（negative） | ⚠️ 弱 | 無 negative；禁忌移出正向 |
| 系列同 seed 重現 | ❌ | 站內未開 seed |
| 需來源圖編輯 | ❌ 本端點 | 走 `…/v4.5/edit` |
| 英文設計排版海報 | △ | Ideogram／Recraft 更對「設計感英字」 |
| 最複雜長版中文（recipe 升級檔） | △ | sc-cn-poster 指 Qwen Pro／Seedream **5**／Max；5 端點 404 時回本 id 或 Qwen |

bestFor **恰當**；使用者可在文生圖旗艦列表選到；無需來源提示。`pickGenerateModel` 預設**不是**本模（成本／通用草稿定位正確）。

## 8. 文件

| 來源 | 用途 |
|------|------|
| fal Queue OpenAPI | `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/bytedance/seedream/v4.5/text-to-image`（本輪 curl **200**；`BytedanceSeedreamV45TextToImageInput`） |
| fal 模型頁 | https://fal.ai/models/fal-ai/bytedance/seedream/v4.5/text-to-image |
| fal API 文件 | https://fal.ai/models/fal-ai/bytedance/seedream/v4.5/text-to-image/api |
| ByteDance | https://seed.bytedance.com/en/seedream4_5 — typography／dense text／MagicBench |
| 站內 | `shared/models.ts` L268–272；`textEncoders.ts` seedream；`scenarioPlaybook.ts` poster；`SCENARIO_RECIPES` sc-quote-card；`STYLE_SHOWDOWNS`；WORKFLOW 定調圖 |
| 既有深度卡 | `docs/research/model-cards/fal-ai__bytedance__seedream__v4.5__text-to-image.md`（depth v2） |
| 清查／生態 | `docs/fal生態研究.md`、`docs/模型目錄.md`、`docs/research/model-deep-dive-2026-08/文生圖逐一研究.md` #4 |
| 點數 | `docs/點數校準報告.md`（$0.04 → 1.2 → 1 ≈） |
| 姊妹 | v5 t2i（#15，OpenAPI 404 P0）；v4.5 edit（#33） |

## 9. 建議動作

- [x] **維持** id＝endpoint（無別名）
- [x] **維持** points=1（$0.04 flat 校準 ≈；**本輪禁止改 points**）
- [x] **維持** `image_size: imageSize(f)` presets（三比例 enum 合法）
- [x] **維持** 不送 negative（schema 無）／不送 num_images／max_images
- [x] **維持** verified=true（已人審；本輪不回退）
- [ ] **可選 L2 再 probe**（單寫者加鎖）：`verify-models --probe "fal-ai/bytedance/seedream/v4.5/text-to-image"` 三比例最短中文標題（非本輪、需 FAL_KEY；**禁止本代理 `--yes`**）
- [ ] **P1** `modelMechanicsFor` 收 seedream／bytedance：family 可標 `dit` 或獨立 unified-gen-edit；caveat 無 negative／窗口未公開
- [ ] **P2** 若產品要消融可重現：將本 id 加入 `SEED_SUPPORTED`（僅消融路徑送 seed；日常 input 仍可不送）
- [ ] **P2** 可選旗艦中文檔預設 `auto_2K`（官方 example；非契約錯）
- [ ] **P3** multi-image 能力未產品化——正確（估點複雜）；暴露前必須 ×N 估點
- [ ] **勿**把 Seedream **5**（404）當本模替代而不備援；長中文海報 recipe 應可回落到本 id 或 Qwen
- [ ] **勿**在未改估點前暴露 `num_images`/`max_images`>1

**L0 結論**：靜態契約綠（endpoint＝id／三比例 preset／無 negative／扁平 1 點 ≈）。OpenAPI 200 全 properties 對齊；剩餘為 mechanics 標註、可選 seed allowlist、可選 live 回歸。

**總建議標籤（寫入 _index）：** `維持`（ready-static-only；points=1≈；verified 維持 true；L2 後可再確認 live）

### 本回合狀態燈（供 `_index`）

| L0 | L1 | L2 live | 建議 |
|----|----|---------|------|
| ok | 📄OpenAPI | 未跑 | 維持；L2 後可再確認；P1 mechanics |
