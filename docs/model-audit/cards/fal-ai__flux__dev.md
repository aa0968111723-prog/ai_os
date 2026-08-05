# fal-ai/flux/dev

> slug: `fal-ai__flux__dev` · 審計 #6 · R1 static+research · 2026-08-05  
> 本輪 **零 live／禁止 `--yes`**；未改 `verified`／`points`。  
> **可註**：L 角色 live probe 已在 budget 成功（`budget.json` · `modelId=fal-ai/flux/dev` · `pointsEst=1` · `twdEst=1.0` · `usdEst=0.025` · status=success · at≈2026-08-05T03:47Z）。

## 1. 身分

| 欄位 | 值 |
|------|-----|
| 站內 id | `fal-ai/flux/dev` |
| 實際 endpoint | **同 id**（無 `endpoint` 覆寫；`endpointOf` → 自身） |
| label | FLUX.1 [dev] |
| category / tier / kind | `text-to-image` · `economy` · `image` |
| verified | **true**（目錄已查證；OpenAPI 本輪 200；L live 已成功） |
| needs | 無（純文生圖） |
| recommended | **true**（站內日常主力／balanced 助手預設首選） |
| strengths | 開源界標竿;品質/成本平衡點、生態最豐(LoRA 可搭) |
| bestFor | 日常分鏡草稿、可訓練專屬風格後搭配使用 |
| 廠商 | Black Forest Labs **FLUX.1 [dev]**（12B 開源權重）via fal.ai |
| MODELS 序 | index **5**（文生圖第六條；審計總表 #6） |

**一句話**：BFL FLUX.1 開源界標竿——品質／成本平衡的日常主力；站內 **recommended + verified**，助手 balanced 預設首選；中文長字卡弱 → 字卡改 Qwen／Seedream／GPT Image。

## 2. 數值

| 項目 | 值 |
|------|-----|
| points | **1** |
| cost（目錄字串） | `$0.025/MP` |
| 官方價與單位（目錄／校準／fal 生態） | **$0.025 per megapixel** |
| 估值 NT$（USD_TO_TWD=31，×1MP） | $0.025 × 31 = **0.775** → 四捨五入 **1** 點（下限 1） |
| 校準判定 | **≈**（`docs/點數校準報告.md` 經濟 FLUX.1 [dev]：估值 NT$0.8，≈） |
| estimatePoints | 扁平 **1**（`realPricePoints` 自 cost 覆寫；非 TTS 動態；長 prompt 仍 1） |

**數值落差（文件／產品級，非契約破）**

- 站內三比例 preset（`landscape_16_9`／`portrait_16_9`／`square_hd`）多落 ≈1MP 進位 → **1 點合理**。
- 官方 default 尺寸 `landscape_4_3`；站內橫幅統一 **16:9**（產品覆寫）。
- 若未來暴露自訂 `width×height` 且面積 >1MP 而不動態估點 → **帳單低估**（現 `input()` 僅 preset 名，無缺口）。
- `num_images` 1–4：站內不送 → 1 張；暴露多圖須 ×N 估點。
- 實價 0.775 元級、下限 1 點 → 平台略墊高（≈），安全側。
- **本輪禁止改 points**（維持 1）。

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| 靜態契約 L0 | **ok** |
| endpointOf | `getModel` → endpoint 即 id ✓ |
| input 16:9 | `{ prompt, image_size: "landscape_16_9" }` |
| input 9:16 | `{ prompt, image_size: "portrait_16_9" }` |
| input 1:1 | `{ prompt, image_size: "square_hd" }` |
| OpenAPI 對齊 | Queue OpenAPI 2026-08-05 拉取 **200**：`FluxDevInput` required 僅 `prompt`；`image_size` enum 含站內三 preset；**無** `negative_prompt` |
| supportsNegativePrompt | **false** ✓（OpenAPI 無欄；allowlist 正確排除主端點） |
| supportsSeed | **true** ✓（OpenAPI 有 `seed`；`SEED_SUPPORTED` 已收——消融可固定噪聲；常規 `input()` **不送** seed） |
| dry-run probe | 本輪未跑 `verify-models` |
| live probe | **本輪未跑**（禁止 `--yes`）；**可註** L 已在 budget 成功（1 點／$0.025） |
| 結論 | **ready**（契約綠 + verified true + 歷史 live OK） |

### OpenAPI 摘要（`GET …/openapi.json?endpoint_id=fal-ai/flux/dev`）

- Paths：`POST /fal-ai/flux/dev`（queue）、status／cancel／result。
- **x-fal-metadata**：endpointId=`fal-ai/flux/dev`；category=`text-to-image`；about: *FLUX.1 [dev], next generation text-to-image model.*
- Schema 名：`FluxDevInput` / `FluxDevOutput`
- openapi **3.0.4**；Queue base `https://queue.fal.run`
- Input 可選：
  - `image_size`：default **`landscape_4_3`**；enum `square_hd|square|portrait_4_3|portrait_16_9|landscape_4_3|landscape_16_9` **或** `ImageSize{width,height}`（寬高 exclusiveMin 0、max 14142）
  - `num_inference_steps`：1–50，default **28**
  - `guidance_scale`：1–20，default **3.5**（CFG）
  - `seed`：int \| null
  - `num_images`：1–4，default 1
  - `enable_safety_checker`：boolean，default **true**
  - `output_format`：jpeg\|png，default jpeg
  - `acceleration`：none\|regular\|high，default **none**
  - `sync_mode`：boolean，default false
- **無** `negative_prompt`
- Output required：`images[]`（url…）+ `timings` + `seed` + `has_nsfw_concepts` + `prompt`
- 站內 `input()` 只送 `prompt` + **preset** `image_size`；其餘吃官方預設（steps=28、CFG=3.5、num=1、safety=true、acceleration=none）。

### 全 properties 對照

| 官方 property | 型別 / 約束 | 預設 | 站內 `input()` | 備註 |
|---------------|-------------|------|----------------|------|
| `prompt` | string **required** | — | ✅ 送出 | 唯一必填 |
| `image_size` | ImageSize 或 enum | landscape_4_3 | ✅ enum 映射 | 三比例皆在 enum 內 |
| `num_inference_steps` | int 1–50 | 28 | ❌ 不送 | 吃 ~28 步 |
| `guidance_scale` | number 1–20 | 3.5 | ❌ 不送 | CFG 預設 |
| `seed` | int \| null | — | ❌ 不送 | SEED allowlist **有**；消融路徑另送 |
| `num_images` | int 1–4 | 1 | ❌ 不送 | |
| `enable_safety_checker` | boolean | true | ❌ | 吃預設 |
| `output_format` | jpeg\|png | jpeg | ❌ | |
| `acceleration` | none\|regular\|high | none | ❌ | 加速旋鈕未暴露 |
| `sync_mode` | boolean | false | ❌ | |
| `negative_prompt` | — | — | **不存在** | allowlist 正確 |

### 三比例 input（本機求值）

| format | body |
|--------|------|
| 1:1 | `{"prompt":"…","image_size":"square_hd"}` |
| 16:9 | `{"prompt":"…","image_size":"landscape_16_9"}` |
| 9:16 | `{"prompt":"…","image_size":"portrait_16_9"}` |

```ts
// shared/models.ts 現況（正確）
input: (p, f) => ({ prompt: p, image_size: imageSize(f) }),
// imageSize: 9:16→portrait_16_9、1:1→square_hd、其餘→landscape_16_9
```

## 4. 底層

| 面向 | 說明 |
|------|------|
| 架構 | **12B rectified flow transformer**；非經典 DDPM U-Net |
| 雙流 | Double-Stream（圖／文各權重、串接注意力）→ Single-Stream（共用權重）→ 丟文 token → VAE 解碼 |
| 文字塔 | **T5-XXL** 逐字語意（窗口 **512**，末格 EOS）+ **CLIP-L** 整句 pooled（不逐字對齊） |
| 站內 encoder | `shared/textEncoders.ts`：`^fal-ai/flux(/|-pro|-lora|-kontext)` → profile **`flux1`**／tokenizer `t5`／`limitTokens: 512` → `measurePromptBudget` **可量測** |
| 站內 mechanics | `modelMechanicsFor` → **`family: flux-dual-stream`**；stages: encoder → double-stream → single-stream → latent → decode |
| 典型步數 | ~**28**（OpenAPI default；schnell 1–4 蒸餾；pro 系另檔） |
| CFG | default **3.5**；過高易過飽和；站內未暴露 |
| 負向 | 主端點 **無** `negative_prompt`（條件注入與舊式 CFG 假設不同；誤送易 422）→ 禁忌只能移出正向；LoRA 端點 `fal-ai/flux-lora` 才收 |
| 計費底層 | fal **$0.025/MP** |
| input 組裝 | `(p, f) => ({ prompt: p, image_size: imageSize(f) })` |
| 送出路徑 | `generationCore` → `endpointOf`（= id）→ `falSubmit("fal-ai/flux/dev", …)` |
| 與官方差異 | 官方 default `landscape_4_3`；站內橫幅統一 **16:9**（產品覆寫，合法） |
| 家族 | 文生圖本卡；schnell `fal-ai/flux/schnell`；i2i `fal-ai/flux/dev/image-to-image`；redux `fal-ai/flux/dev/redux`；LoRA `fal-ai/flux-lora`；Kontext 編輯系；FLUX.2 另族（Mistral-3 VLM 文字塔） |

## 5. 站內點數路徑

```
UI / MCP generate_into_scene / agent
  → prepare（estimatePoints(model, { promptChars, usdToTwdRate })）
  → est = 1（本模扁平；realPricePoints 自 cost $0.025/MP → max(1, round(0.775))=1）
  → member 且 est ≥ 組 approvalThreshold → awaiting_approval（不扣點）
  → 否則 insert generations(pointsEst=est) + reserveQuota(user, group, est, …, genId)
  → falSubmit(endpointOf)  // = fal-ai/flux/dev
  → 失敗 refund(…, pointsEst, …)
  → BYOK 個人 fal key：略過平台扣點與核准門檻
```

| 檢查 | 結果 |
|------|------|
| 顯示點數 | catalog／UI 用 `model.points`＝1 |
| 扣點／退點 | 同 `pointsEst`＝`estimatePoints` → 一致 |
| 與 cost 校準 | $0.025×31≈0.78 → 1 點 ≈ |
| verified true | 已人審；L live OK；本輪不回退 |
| live 帳單註記 | budget `usdEst=0.025`／`twdEst=1.0` 與 1MP 假設對齊 |

## 6. 暴露面

| 通路 | 是否暴露 | 備註 |
|------|:--------:|------|
| 模型選擇器（文生圖 economy） | ✅ | MODELS 第六條；`recommended: true` |
| `model_catalog` 同步 | ✅ | id = endpoint；points=1；verified true |
| tRPC generation | ✅ | modelId 即本 id |
| MCP `generate_into_scene` / `submit_generation` | ✅ | 不需 source；openWorld；扣點＋核准 |
| 助手／agent 預設 | ✅ | `selectAiGenerationModel` balanced：**verified+recommended** 權重最高 → 測試斷言首選本 id |
| Scene recipe `sc-storyboard-draft` | ✅ | pickIds[0]（日常分鏡草稿主力） |
| scenarioPlaybook `portrait` | ✅ | 第三選（寫實草稿） |
| 工作流 `wf/full-short-economy` | ✅ | 步驟「定調圖」 |
| 工作流 `wf/quote-card-economy` | ✅ | 步驟「生成底圖」（注意：字卡本體弱中文，僅底圖） |
| Style showdown | △ | 非「構圖光影」winner（那是 FLUX.2 pro）；日常草稿軸不在 showdown 主表 |
| 禁忌 negative_prompt | ❌ | schema／allowlist 皆無（主端點） |
| seed UI（一般生成） | ❌ | 官方有；常規 input 不送；**消融**可走 SEED allowlist |
| steps／guidance／acceleration UI | ❌ | 吃 28／3.5／none；可選 P3 暴露 |
| 自訂 width×height | ❌ | 僅 preset 名 |
| num_images | ❌ | 吃 1 |

**MCP 陷阱**：傳 id `fal-ai/flux/dev` 即可（無 endpoint 別名）；**禁止**自拼 `negative_prompt`（422 風險）；勿擅自 `num_images`>1（估點仍 1）。

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 日常分鏡草稿／量大迭代（仍要質感） | ✅ 首選 | bestFor；sc-storyboard-draft；recommended |
| 寫實人物／場景草稿 | ✅ | playbook portrait 第三選；正式寫真升 flagship |
| 訓練專屬風格後掛 LoRA 出圖 | ✅ 搭配 | 本端點本身不掛 LoRA → `flux-lora` + trainer |
| 正式宣傳主視覺／電影光影天花板 | △ | 可；旗艦請用 FLUX.2 [pro]／Nano Banana Pro |
| 秒級大量試方向 | △ | 1 點可但 **schnell**（$0.003/MP）更省更快 |
| 中文長字卡／密集海報 | ❌ | 文字（尤其中文）明顯弱 → Qwen／Seedream／GPT Image |
| 系列重現（同 seed） | △ | SEED allowlist 有；一般 UI 未暴露 seed |
| 圖生圖／Redux 變體 | ❌ 本端點 | 走 `flux/dev/image-to-image`／`flux/dev/redux` |

bestFor **恰當**；使用者在文生圖經濟檔、助手預設、scene recipe 皆可選到；無需來源提示。

## 8. 文件

| 來源 | 用途 |
|------|------|
| fal Queue OpenAPI | `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/flux/dev`（本輪 curl **200**；`FluxDevInput`／steps28／CFG3.5） |
| fal 模型頁 | https://fal.ai/models/fal-ai/flux/dev |
| fal API 文件 | https://fal.ai/models/fal-ai/flux/dev/api |
| 站內 | `shared/models.ts` L281–286；`SEED_SUPPORTED` 含本 id；`NEGATIVE` 不含主端點；`textEncoders.ts` flux1；`modelMechanics.ts` flux-dual-stream；`scenarioPlaybook.ts` portrait；`aiModelPolicy.ts`／test 預設；`generationCore` 路徑 |
| 既有研究 | `docs/research/model-deep-dive-2026-08/文生圖逐一研究.md` #6；`docs/fal生態研究.md` FLUX.1 [dev] 列；`docs/模型底層邏輯與運作流程.md` flow／雙流／CFG |
| 清查／目錄 | `docs/模型清查清單.md`、`docs/模型目錄.md` 經濟檔 |
| 點數 | `docs/點數校準報告.md`（$0.025/MP → 0.8 ≈）；`realPricePoints` 本機 1 |
| live | `docs/model-audit/budget.json` entries · flux/dev success · pointsEst=1 · usdEst=0.025 |
| ROUND | `docs/model-audit/ROUND-LOG.md` · L flux/dev live OK |

## 9. 建議動作

- [x] **維持** id＝endpoint `fal-ai/flux/dev`（無別名）
- [x] **維持** points=1（1MP 校準 ≈；本輪禁止改 points）
- [x] **維持** verified=true（L live 已成功；不回退）
- [x] **維持** recommended=true（日常主力／助手 balanced 首選）
- [x] **維持** 不送 negative（官方 schema 無；allowlist 正確）
- [x] **維持** 常規 input 僅 prompt + image_size（steps/CFG 吃預設合理）
- [x] **維持** SEED allowlist 收錄（消融需要）
- [ ] **可選 P3**：一般 UI 暴露 seed（系列主視覺重現）；勿與消融路徑衝突
- [ ] **可選 P3**：acceleration=`regular` 作為進階預設（品質／延遲權衡需 A/B；現 none 最穩）
- [ ] **可選 P2**：cost 文案補「×輸出 MP；站內 preset≈1MP」
- [ ] **勿**為主端點加 negative_prompt UI（那是 flux-lora／SD 系）
- [ ] **勿**把字卡／中文海報任務導到本模（導 Qwen／Seedream）
- [ ] **勿**本輪改 points／verified／跑 `--yes`

**L0 結論**：靜態契約綠（endpoint／input 三比例／allowlist／點數扁平一致）。**L1** OpenAPI 200 全欄對齊。**L2** 歷史 live 成功（budget）。剩餘為可選 UX 旋鈕（seed／acceleration）與字卡分流教育，無 P0 契約債。
