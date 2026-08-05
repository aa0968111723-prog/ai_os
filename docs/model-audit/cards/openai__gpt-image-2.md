# openai/gpt-image-2

> slug: `openai__gpt-image-2` · 審計 #3 · R1 static+research · 2026-08-05  
> 零 live；未改 `verified`／`points`。`image_size` 已改 preset／`imageSize()`（**禁止 WxH 字串**；live 422 已修）。

## 1. 身分

| 欄位 | 值 |
|------|-----|
| 站內 id | `openai/gpt-image-2` |
| 實際 endpoint | **同 id**（無 `endpoint` 覆寫；`endpointOf` → 自身） |
| label | GPT Image 2(OpenAI) |
| category / tier / kind | `text-to-image` · `flagship` · `image` |
| verified | **true**（目錄已翻；本輪未再 live） |
| needs | 無（純文生圖） |
| recommended | 否（`undefined`／非 recommended 旗標） |
| strengths | fal 官方夥伴端點;跨拉丁與 CJK 字元級文字準確、複雜指令理解強 |
| bestFor | 要求文字逐字精準的對外物料、中英並存的字卡 |
| 廠商 | OpenAI **GPT Image 2 / ChatGPT Images 2.0** via fal **官方夥伴 proxy**（alpha） |
| MODELS 序 | index 2（文生圖第三條，#3） |

**一句話**：OpenAI 下一代影像旗艦（fal 託管）——跨拉丁／CJK **字元級**文字與複雜指令是賣點；單價高（預設 high ≈ 5 點），留給對外正式字卡，不當日常草稿。

## 2. 數值

| 項目 | 值 |
|------|-----|
| points | **5** |
| cost（目錄字串） | `$0.158/張(fal 預設 high 1080p;medium≈$0.04、4k high≈$0.40);點數以預設 high 檔估` |
| 官方價與單位（size×quality） | 錨：**1920×1080 · high ≈ $0.158／張**；medium≈$0.04；4K high≈$0.40；域約 $0.01–0.41 |
| 估值 NT$（USD_TO_TWD=31） | $0.158 × 31 ≈ **4.9** → 四捨五入 **5** 點 |
| 校準判定 | **≈**（`docs/點數校準報告.md` 旗艦列；`estimatePoints`／`realPricePoints` 皆 5） |
| estimatePoints | 扁平 **5**（與 promptChars 無關） |

**數值落差（文件／產品級，非本輪改點）**

- 未送 `quality` → 吃官方 default **high** → 與 5 點錨一致。
- 若未來暴露 4K／大自訂尺寸而不動態估點 → **低估**；若暴露 medium 而不降點 → **高估**。
- `num_images` 1–4：站內不送 → 1 張；暴露多圖須 ×N 估點。
- **本輪禁止改 points**（維持 5）。

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| 靜態契約 L0 | **ok** |
| endpointOf | `getModel` → endpoint 即 id ✓ |
| input 16:9 | `{ prompt, image_size: "landscape_16_9" }` |
| input 9:16 | `{ prompt, image_size: "portrait_16_9" }` |
| input 1:1 | `{ prompt, image_size: "square_hd" }` |
| OpenAPI 對齊 | Queue OpenAPI 2026-08-05 拉取 **200**：`GptImage2Input` required 僅 `prompt`；`image_size` **anyOf** `{width,height}` **或** enum preset（含站內三 preset）／`auto`；**禁止** `"1536x1024"` 這類 **WxH 字串** |
| supportsNegativePrompt | **false** ✓（OpenAPI 無欄；allowlist 未收） |
| supportsSeed | **false** ✓（OpenAPI 無 `seed`） |
| dry-run probe | 本輪未跑 `verify-models` |
| live probe | **未跑**（R1 零 live；歷史：**WxH 字串 → 422**，已改 `imageSize()`） |
| 結論 | **ready-static-only**（契約綠＋verified true；本輪無新 live 證據） |

### OpenAPI 摘要（`GET …/openapi.json?endpoint_id=openai/gpt-image-2`）

- Paths：`POST /openai/gpt-image-2`（queue）、status／cancel／result。
- **x-fal-metadata**：endpointId=`openai/gpt-image-2`；category=`text-to-image`；hosting 敘事 next-gen／至約 4K。
- Input 可選：
  - `image_size`：default `landscape_4_3`；enum `square_hd|square|portrait_4_3|portrait_16_9|landscape_4_3|landscape_16_9|auto` **或** `ImageSize{width,height}`（邊 multiple of 16、max edge 3840、AR≤3:1、總像素 655,360–8,294,400）
  - `quality`：`auto|low|medium|high`，default **`high`**
  - `num_images` 1–4（default 1）
  - `output_format` jpeg|png|webp（default png）
  - `sync_mode` boolean（default false）
- `prompt`：minLength 2、**maxLength 32000**
- **無** `negative_prompt`／`seed`／`num_inference_steps`／`guidance_scale`／`enable_safety_checker`
- Output：`images[]`（`url` required…）；無 FLUX 式 seed／nsfw 欄。
- 站內 `input()` 只送 `prompt` + **preset** `image_size`；其餘吃預設（quality=high）。

### 契約教訓（P0 已修）

| 送法 | 合法？ | 結果 |
|------|:------:|------|
| `image_size: "landscape_16_9"`（`imageSize(f)`） | ✅ | 期望 200 路徑 |
| `image_size: { width: 1920, height: 1080 }` | ✅ | 物件分支 |
| `image_size: "1536x1024"` / `"1024x1024"` | ❌ | **live HTTP 422**（歷史） |

```ts
// shared/models.ts 現況（正確）
// OpenAPI preset only; WxH string live 422
input: (p, f) => ({ prompt: p, image_size: imageSize(f) }),
```

## 4. 底層

| 面向 | 說明 |
|------|------|
| 架構 | **多模態 LLM 系影像生成**（非 U-Net／非 FLUX 雙流）；閉源；旋鈕主為 quality＋image_size |
| 條件 | 長提示（schema 至 32000 字元）、多語字元級文字、版面／字卡指令 |
| 解析度 | 靈活至約 **4K**（物件尺寸約束見上） |
| 計費底層 | fal **text tokens + image tokens**；quality／解析度顯著改變 image token；預設 high 最貴 |
| 站內 encoder | `shared/textEncoders.ts`：`/gpt-image|openai/` → profile `gpt-image`；label「OpenAI 影像模型（未公開）」；**limitTokens undefined** → `measurePromptBudget` **`measured: false`** |
| 負向／seed | schema 無 → 禁忌只能移出正向；不可 seed 消融 |
| input 組裝 | `(p, f) => ({ prompt: p, image_size: imageSize(f) })`；9:16→portrait_16_9、1:1→square_hd、其餘→landscape_16_9 |
| 送出路徑 | `generationCore` → `endpointOf`（= id）→ `falSubmit`；**不**注入 `negative_prompt` |
| 與官方差異 | 官方 default 尺寸 `landscape_4_3`；站內橫幅統一 **16:9** preset（產品覆寫，可接受） |
| 家族 | 文生圖本卡；Edit `openai/gpt-image-2/edit`（#46，本卡不覆蓋） |

## 5. 站內點數路徑

```
UI / MCP generate_into_scene / agent
  → prepare（estimatePointsFor(model, { promptChars, usdToTwdRate })）
  → est = 5（本模扁平；realPricePoints 自 cost 機械換算）
  → member 且 est ≥ 組 approvalThreshold → awaiting_approval（不扣點）
  → 否則 insert generations(pointsEst=est) + reserveQuota(user, group, est, …, genId)
  → falSubmit(endpointOf)  // = openai/gpt-image-2
  → 失敗 refund(…, pointsEst, …)
  → BYOK 個人 fal key：略過平台扣點與核准門檻
```

| 檢查 | 結果 |
|------|------|
| 顯示點數 | catalog／UI 用 `model.points`＝5 |
| 扣點／退點 | 同 `pointsEst`＝`estimatePoints` → 一致 |
| 與 cost 校準 | $0.158×31≈4.9 → 5 點 ≈（預設 high 1080p 錨） |
| verified true | 已人審翻 true；本輪零 live 不回退 |

## 6. 暴露面

| 通路 | 是否暴露 | 備註 |
|------|:--------:|------|
| 模型選擇器（文生圖 flagship） | ✅ | MODELS 第三條；無 needs |
| `model_catalog` 同步 | ✅ | id = endpoint；points=5；verified true |
| tRPC generation | ✅ | modelId 即 `openai/gpt-image-2` |
| MCP `generate_into_scene` / `submit_generation` | ✅ | 同上；不需 source；openWorld；扣點＋核准 |
| Scene recipe `sc-quote-card` | ✅ | pickIds[2]（Qwen Standard → Seedream → **本模型**） |
| scenarioPlaybook `quote-card` | ✅ | modelIds 含本 id（成品零錯字升檔） |
| scenarioPlaybook `poster` | ✅ | 零錯字對外正式物 |
| Style showdown「複雜指令理解」 | ✅ | **runnerUp**（winner Nano Banana Pro） |
| 禁忌 negative_prompt | ❌ | schema／allowlist 皆無 |
| seed | ❌ | schema 無 |
| quality／num_images／custom WH 物件 | ❌ | 吃 high／1／preset 名 |
| steps／guidance UI | ❌ | schema 無；勿誤送 → 422 |

**MCP 陷阱**：無 endpoint 別名，傳 id 即可；**禁止**自拼 `"WxH"` `image_size`、`negative_prompt`、`seed`、steps／CFG。

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 對外正式字卡／中英並存／逐字零錯 | ✅ 旗艦 | bestFor；playbook quote-card／poster |
| 複雜多條件、敘事型指令 | ✅ 強 | showdown runner-up |
| 大量試構圖／草稿 | ❌ | 5 點／張 → Qwen Standard／FLUX schnell |
| 世界觀禁忌硬控（negative） | ⚠️ 弱 | 無 negative；禁忌移出正向＋文案約束 |
| 系列同 seed 重現 | ❌ | schema 無 seed |
| 需來源圖編輯 | ❌ 本端點 | 走 `openai/gpt-image-2/edit` |

bestFor **恰當**；使用者可在文生圖旗艦列表選到；無需來源提示。`pickGenerateModel` 預設**不是**本模（成本定位正確）。

## 8. 文件

| 來源 | 用途 |
|------|------|
| fal Queue OpenAPI | `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=openai/gpt-image-2`（本輪 curl **200**；`GptImage2Input`） |
| fal 模型頁 | https://fal.ai/models/openai/gpt-image-2 |
| fal API 文件 | https://fal.ai/models/openai/gpt-image-2/api |
| 站內 | `shared/models.ts` L259–266（preset input 註解 WxH 422）；`textEncoders.ts` gpt-image；`scenarioPlaybook.ts`；`SCENARIO_RECIPES` sc-quote-card；`STYLE_SHOWDOWNS` |
| 既有深度卡 | `docs/research/model-cards/openai__gpt-image-2.md`（depth v2；歷史仍記 WxH 現況——**以本審計卡＋現碼為準**） |
| 清查／生態 | `docs/fal生態研究.md`、`docs/research/model-deep-dive-2026-08/文生圖逐一研究.md` #3 |
| 點數 | `docs/點數校準報告.md`（$0.158 → 4.9 → 5 ≈） |
| e2e | `scripts/e2e-phase2.py` 用本 id 測 generation 核准閘（mock） |

## 9. 建議動作

- [x] **維持** id＝endpoint（無別名）
- [x] **維持** points=5（$0.158 high 1080p 校準 ≈；**本輪禁止改 points**）
- [x] **維持** `image_size: imageSize(f)` presets（**不可** WxH 字串；live 422 已修）
- [x] **維持** 不送 negative／seed／steps／guidance（schema 無）
- [x] **維持** verified=true（已人審；本輪不回退）
- [ ] **可選 L2 再 probe**（單寫者加鎖）：`verify-models --probe "openai/gpt-image-2"` 確認 preset 路徑非 422（非本輪、需 FAL_KEY）
- [ ] **可選** 暴露 `quality`（low/medium/high）+ 動態點數（P2；否則永遠 high 帳單）
- [ ] **可選** 字卡場景鎖定物件尺寸 `{1920,1080}` 對齊價表錨（**物件**非字串）
- [ ] **可選** 單測鎖三比例禁止 `/^\d+x\d+$/`（防回歸）
- [ ] **勿**把本模當 DEFAULT_IMAGE_MODEL／大量草稿預設
- [ ] **勿**在未改估點前暴露 `num_images`>1 或 4K 自訂大圖

**L0 結論**：靜態契約綠（endpoint／三比例 **preset** input／無 negative·seed／扁平 5 點一致）。歷史 P0（WxH→422）已修；剩餘為 quality 檔位產品債與可選回歸 live。
