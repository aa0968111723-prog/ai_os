# fal-ai/flux/schnell

> slug: `fal-ai__flux__schnell` · 審計 #8 · R1 static+research · 2026-08-05  
> 本輪 **零 live／禁止 `--yes`**；未改 `verified`／`points`。  
> **可註**：L 角色 live probe 已在 budget 成功（`budget.json` · `modelId=fal-ai/flux/schnell` · `pointsEst=1` · `twdEst=1.0` · `usdEst=0.003` · status=success · at≈2026-08-05T03:38:30Z · requestId `019fd000-06cb-7df3-a27b-1dbf6b755d8c`）。

## 1. 身分

| 欄位 | 值 |
|------|-----|
| 站內 id | `fal-ai/flux/schnell` |
| 實際 endpoint | **同 id**（無 `endpoint` 覆寫；`endpointOf` → 自身） |
| label | FLUX.1 [schnell] |
| category / tier / kind | `text-to-image` · `economy` · `image` |
| verified | **true**（目錄已查證；OpenAPI 本輪 200；L live 已成功） |
| needs | 無（純文生圖） |
| recommended | 否（`undefined`／非 recommended 旗標；日常主力在 `flux/dev`） |
| strengths | 1–2 秒出圖;快速迭代找方向 |
| bestFor | 大量試構圖、腦力激盪期 |
| 廠商 | Black Forest Labs **FLUX.1 [schnell]**（12B 蒸餾／turbo）via fal.ai |
| MODELS 序 | index **7**（文生圖第八條；審計總表 **#8**） |

**一句話**：BFL FLUX.1 **蒸餾秒級**檔——1–4 步、約 1–2 秒、$0.003/MP 的大量試方向專用；站內 **verified**、showdown「最省/秒級試方向」**winner**、`sc-fast-explore` 首選；定方向後應升 `flux/dev`／旗艦；**文字弱**、T5 窗口僅 **256**。

## 2. 數值

| 項目 | 值 |
|------|-----|
| points | **1** |
| cost（目錄字串） | `$0.003/MP` |
| 官方價與單位（目錄／校準／fal 生態） | **$0.003 per megapixel** |
| 估值 NT$（USD_TO_TWD=31，×1MP） | $0.003 × 31 = **0.093** → 四捨五入後下限 **1** 點 |
| 校準判定 | **≈**（`docs/點數校準報告.md` 經濟 FLUX.1 [schnell]：估值 NT$0.1，≈） |
| estimatePoints | 扁平 **1**（`realPricePoints` 自 cost 覆寫；非 TTS 動態；長 prompt 仍 1） |
| 本機校驗 | `parseRealCost` → usdMid=0.003、×1MP；`realPricePoints`／`estimatePoints` 皆 **1** |

**數值落差（文件／產品級，非契約破）**

- 實價約 **0.1 元**、站內下限 **1 點** → 平台略墊高（≈），安全側；與 live `usdEst=0.003`／`twdEst=1.0` 對齊。
- 站內三比例 preset（`landscape_16_9`／`portrait_16_9`／`square_hd`）多落 ≈1MP 進位 → **1 點合理**。
- 官方 default 尺寸 `landscape_4_3`；站內橫幅統一 **16:9**（產品覆寫）。
- 若未來暴露自訂 `width×height` 且面積 >1MP 而不動態估點 → **帳單低估**（現 `input()` 僅 preset 名，無缺口）。
- `num_images` 1–4：站內不送 → 1 張；暴露多圖須 ×N 估點。
- **本輪禁止改 points**（維持 1）。

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| 靜態契約 L0 | **ok** |
| endpointOf | `getModel` → endpoint 即 id ✓ |
| input 16:9 | `{ prompt, image_size: "landscape_16_9" }` |
| input 9:16 | `{ prompt, image_size: "portrait_16_9" }` |
| input 1:1 | `{ prompt, image_size: "square_hd" }` |
| OpenAPI 對齊 | Queue OpenAPI 2026-08-05 拉取 **200**：`FluxSchnellInput` required 僅 `prompt`；`image_size` enum 含站內三 preset；**無** `negative_prompt` |
| supportsNegativePrompt | **false** ✓（OpenAPI 無欄；allowlist 正確排除主端點） |
| supportsSeed | **true** ✓（OpenAPI 有 `seed`；`SEED_SUPPORTED` 已收——消融可固定噪聲；常規 `input()` **不送** seed） |
| dry-run probe | 本輪環境無 `FAL_KEY` 時 `verify-models --probe` 拒跑（僅估點路徑）；**未**加 `--yes` |
| live probe | **本輪未跑**（禁止 `--yes`）；**可註** L 已在 budget 成功（1 點／$0.003） |
| 結論 | **ready**（契約綠 + verified true + 歷史 live OK） |

### OpenAPI 摘要（`GET …/openapi.json?endpoint_id=fal-ai/flux/schnell`）

- Paths：`POST /fal-ai/flux/schnell`（queue）、status／cancel／result。
- **x-fal-metadata**：endpointId=`fal-ai/flux/schnell`；category=`text-to-image`；about: *FLUX.1 [schnell], turbo mode for next generation text-to-image model FLUX.*
- Schema 名：`FluxSchnellInput`（title `SchnellTextToImageInput`）／`FluxSchnellOutput`
- openapi **3.0.4**；Queue base `https://queue.fal.run`
- Input 可選：
  - `image_size`：default **`landscape_4_3`**；enum `square_hd|square|portrait_4_3|portrait_16_9|landscape_4_3|landscape_16_9` **或** `ImageSize{width,height}`（寬高 exclusiveMin 0、max 14142）
  - `num_inference_steps`：1–**12**，default **4**（蒸餾；dev 為 1–50／28）
  - `guidance_scale`：1–20，default **3.5**（CFG）
  - `seed`：int \| null
  - `num_images`：1–4，default 1
  - `enable_safety_checker`：boolean，default **true**
  - `output_format`：jpeg\|png，default jpeg
  - `acceleration`：none\|regular\|high，default **none**
  - `sync_mode`：boolean，default false
- **無** `negative_prompt`
- Output required：`images[]`（url…）+ `timings` + `seed` + `has_nsfw_concepts` + `prompt`
- 站內 `input()` 只送 `prompt` + **preset** `image_size`；其餘吃官方預設（steps=**4**、CFG=3.5、num=1、safety=true、acceleration=none）。

### 全 properties 對照

| 官方 property | 型別 / 約束 | 預設 | 站內 `input()` | 備註 |
|---------------|-------------|------|----------------|------|
| `prompt` | string **required** | — | ✅ 送出 | 唯一必填 |
| `image_size` | ImageSize 或 enum | landscape_4_3 | ✅ enum 映射 | 三比例皆在 enum 內 |
| `num_inference_steps` | int 1–**12** | **4** | ❌ 不送 | 蒸餾預設 4 步（vs dev 28） |
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
| 架構 | **12B rectified flow transformer**（與 dev 同族）；**蒸餾 turbo** → 典型 **1–4** 步、亞秒～2 秒 |
| 雙流 | Double-Stream（圖／文各權重、串接注意力）→ Single-Stream（共用權重）→ 丟文 token → VAE 解碼 |
| 文字塔 | **T5-XXL** 逐字語意（窗口 **256**，末格 EOS——蒸餾壓半）+ **CLIP-L** 整句 pooled |
| 站內 encoder | `shared/textEncoders.ts`：`^fal-ai/flux/schnell` → profile **`flux1-schnell`**／tokenizer `t5`／`limitTokens: 256`（須排在通用 `flux1` 規則前）→ `measurePromptBudget` **可量測** |
| 站內 mechanics | `modelMechanicsFor` → **`family: flux-dual-stream`**（regex `^fal-ai/flux(/|-pro|-lora|-kontext)` 含本 id）；stages: encoder → double-stream → single-stream → latent → decode |
| 典型步數 | OpenAPI default **4**（max 12）；dev ~28；pro 系另檔 |
| CFG | default **3.5**；站內未暴露 |
| 負向 | 主端點 **無** `negative_prompt`（誤送易 422）→ 禁忌只能移出正向；LoRA 端點 `fal-ai/flux-lora` 才收 |
| 計費底層 | fal **$0.003/MP**（家族最便宜檔之一） |
| input 組裝 | `(p, f) => ({ prompt: p, image_size: imageSize(f) })` |
| 送出路徑 | `generationCore` → `endpointOf`（= id）→ `falSubmit("fal-ai/flux/schnell", …)` |
| 與官方差異 | 官方 default `landscape_4_3`；站內橫幅統一 **16:9**（產品覆寫，合法） |
| 家族 | 文生圖本卡（turbo）；姊妹 `fal-ai/flux/dev`（日常主力／recommended）；i2i／redux 在 dev 支線；LoRA `fal-ai/flux-lora`；Kontext 編輯系；FLUX.2 另族 |

## 5. 站內點數路徑

```
UI / MCP generate_into_scene / agent
  → prepare（estimatePoints(model, { promptChars, usdToTwdRate })）
  → est = 1（本模扁平；realPricePoints 自 cost $0.003/MP → max(1, round(0.093))=1）
  → member 且 est ≥ 組 approvalThreshold → awaiting_approval（不扣點）
  → 否則 insert generations(pointsEst=est) + reserveQuota(user, group, est, …, genId)
  → falSubmit(endpointOf)  // = fal-ai/flux/schnell
  → 失敗 refund(…, pointsEst, …)
  → BYOK 個人 fal key：略過平台扣點與核准門檻
```

| 檢查 | 結果 |
|------|------|
| 顯示點數 | catalog／UI 用 `model.points`＝1 |
| 扣點／退點 | 同 `pointsEst`＝`estimatePoints` → 一致 |
| 與 cost 校準 | $0.003×31≈0.09 → 1 點 ≈（下限墊高） |
| verified true | 已人審；L live OK；本輪不回退 |
| live 帳單註記 | budget `usdEst=0.003`／`twdEst=1.0`／`pointsEst=1` 與 1MP 假設對齊 |

## 6. 暴露面

| 通路 | 是否暴露 | 備註 |
|------|:--------:|------|
| 模型選擇器（文生圖 economy） | ✅ | MODELS 文生圖第 8 條；無 needs；**非** recommended |
| `model_catalog` 同步 | ✅ | id = endpoint；points=1；verified true |
| tRPC generation | ✅ | modelId 即本 id |
| MCP `generate_into_scene` / `submit_generation` | ✅ | 不需 source；openWorld；扣點＋核准 |
| 助手／agent 預設 | △ | balanced 首選為 **flux/dev**（recommended）；`preferredId=schnell` 時可強制（測試有斷言） |
| Scene recipe `sc-fast-explore` | ✅ | **pickIds[0]**（快速大量試構圖） |
| 工作流 `wf/draft-minimal` | ✅ | 步驟「概念圖」＋ Kokoro 旁白（極簡兩步 2 點） |
| Style showdown「最省/秒級試方向」 | ✅ | **winnerId**；runner = `fal-ai/sana` |
| 日常分鏡草稿 recipe | ❌ 本 id | `sc-storyboard-draft` 用 flux/dev |
| 禁忌 negative_prompt | ❌ | schema／allowlist 皆無（主端點） |
| seed UI（一般生成） | ❌ | 官方有；常規 input 不送；**消融**可走 SEED allowlist |
| steps／guidance／acceleration UI | ❌ | 吃 4／3.5／none；可選 P3 暴露 steps（1–12） |
| 自訂 width×height | ❌ | 僅 preset 名 |
| num_images | ❌ | 吃 1 |

**MCP 陷阱**：傳 id `fal-ai/flux/schnell` 即可（無 endpoint 別名）；**禁止**自拼 `negative_prompt`（422 風險）；勿擅自 `num_images`>1（估點仍 1）；長 prompt 注意 T5 **256** 截斷（比 dev 512 短半）；勿與 `flux/dev` 混當「質感草稿」——本模只適試方向。

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 大量試構圖／秒級刷方向 | ✅ **首選** | bestFor；`sc-fast-explore`；showdown winner |
| 提案前概念驗證（最低成本工作流） | ✅ | `wf/draft-minimal` 概念圖步 |
| 腦力激盪後定調 | △→升檔 | 方向對了換 **flux/dev** 或旗艦重生成 |
| 日常分鏡草稿（仍要質感） | △ | 1 點可但 **dev** 更適合（recommended） |
| 正式宣傳主視覺／電影光影 | ❌ | 用 FLUX.2 pro／Nano Banana／Imagen 等 |
| 中文長字卡／密集海報 | ❌ | 文字弱（僅構圖佔位）→ Qwen／Seedream／GPT Image |
| 系列重現（同 seed） | △ | SEED allowlist 有；一般 UI 未暴露 seed |
| 圖生圖／Redux 變體 | ❌ 本端點 | 走 `flux/dev/image-to-image`／`flux/dev/redux` |
| 超長敘事 prompt | ⚠ | T5 256 易截；改 dev（512）或縮 prompt |

bestFor **恰當**；使用者在文生圖經濟檔、快速試構圖 recipe、showdown 最省軸皆可選到；無需來源提示。

## 8. 文件

| 來源 | 用途 |
|------|------|
| fal Queue OpenAPI | `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/flux/schnell`（本輪 curl **200**；`FluxSchnellInput`／steps4／CFG3.5） |
| fal 模型頁 | https://fal.ai/models/fal-ai/flux/schnell |
| fal API 文件 | https://fal.ai/models/fal-ai/flux/schnell/api |
| 站內 | `shared/models.ts` L296–300；`SEED_SUPPORTED` 含本 id（L192）；`NEGATIVE` 不含主端點；`textEncoders.ts` flux1-schnell（256）；`modelMechanics.ts` flux-dual-stream；`SCENARIO_RECIPES` sc-fast-explore；`WORKFLOW_PRESETS` wf/draft-minimal；`STYLE_SHOWDOWNS` sh-image 最省軸；`generationCore` 路徑 |
| 既有研究 | `docs/research/model-deep-dive-2026-08/文生圖逐一研究.md` #8；`docs/fal生態研究.md` FLUX.1 [schnell] 列；`docs/模型底層邏輯與運作流程.md` 1–4 步蒸餾 |
| 清查／目錄 | `docs/模型清查清單.md`、`docs/模型目錄.md` 經濟檔 |
| 點數 | `docs/點數校準報告.md`（$0.003/MP → 0.1 ≈）；`realPricePoints` 本機 1 |
| 姊妹卡 | `docs/model-audit/cards/fal-ai__flux__dev.md`（日常主力／28 步／T5 512） |
| live | `docs/model-audit/budget.json` entries · flux/schnell success · pointsEst=1 · usdEst=0.003 |
| ROUND | `docs/model-audit/ROUND-LOG.md` · L flux/schnell live OK · spentTwd≈1 |

## 9. 建議動作

- [x] **維持** id＝endpoint `fal-ai/flux/schnell`（無別名）
- [x] **維持** points=1（1MP 校準 ≈；下限墊高；本輪禁止改 points）
- [x] **維持** verified=true（L live 已成功；不回退）
- [x] **維持** recommended **不**升本模（秒級試方向 ≠ 日常主力；主力留 `flux/dev`）
- [x] **維持** 不送 negative（官方 schema 無；allowlist 正確）
- [x] **維持** 常規 input 僅 prompt + image_size（steps=4／CFG 吃預設合理）
- [x] **維持** SEED allowlist 收錄（消融需要）
- [x] **註記 live**：budget 已成功；R1 本輪不重跑、不加 `--yes`
- [x] 九章卡 + `_index` #8 + heartbeat
- [ ] **可選 P3**：一般 UI 暴露 seed（系列試方向可重現）
- [ ] **可選 P3**：acceleration=`regular`／steps 1–12 進階旋鈕（品質／延遲 A/B；現 4 步最穩速）
- [ ] **可選 P2**：cost 文案補「×輸出 MP；站內 preset≈1MP；實價≈0.1 元、點數下限 1」
- [ ] **可選 P2**：UI 提示「長 prompt 易截於 256 token；定稿請換 flux/dev」
- [ ] **勿**為主端點加 negative_prompt UI
- [ ] **勿**把字卡／中文海報／正式主視覺導到本模
- [ ] **勿**本輪改 points／verified／跑 `--yes`

**L0 結論**：靜態契約綠（endpoint／input 三比例／allowlist／點數扁平一致）。**L1** OpenAPI 200 全欄對齊（steps max 12／default 4 為與 dev 關鍵差）。**L2** 歷史 live 成功（budget usdEst=0.003）。剩餘為可選 UX（seed／acceleration／256-token 提示）與分流教育，無 P0 契約債。
