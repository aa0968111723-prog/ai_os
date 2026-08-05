# fal-ai/flux-2/pro

> slug: `fal-ai__flux-2__pro` · 審計 #1 · R1 static+research · 2026-08-05  
> 零 live；未改 `verified`／`points`。

## 1. 身分

| 欄位 | 值 |
|------|-----|
| 站內 id | `fal-ai/flux-2/pro` |
| 實際 endpoint | `fal-ai/flux-2-pro`（`endpointOf` 覆寫；連字號） |
| label | FLUX.2 [pro] |
| category / tier / kind | `text-to-image` · `flagship` · `image` |
| verified | **false**（註解：id 斜線相容舊紀錄；呼叫走 endpoint；首跑後再翻 true） |
| needs | 無（純文生圖） |
| recommended | 否（`undefined`／非 recommended 旗標） |
| strengths | Black Forest Labs 最新旗艦；構圖與光影頂級、提示詞遵循極準 |
| bestFor | 正式成品分鏡、需要高質感的宣傳主視覺 |
| 廠商 | Black Forest Labs（BFL）via fal.ai |
| MODELS 序 | index 0（文生圖首條） |

**一句話**：BFL 零設定生產旗艦——高質感寫實／電影光影主視覺；英文短標題可用，中文長字卡請改 Qwen／Seedream／GPT Image。

## 2. 數值

| 項目 | 值 |
|------|-----|
| points | **1** |
| cost（目錄字串） | `$0.03/MP` |
| 官方價與單位（模型頁／既有研究） | **首 1MP $0.03**；之後每額外 1MP（進位）**$0.015** |
| 估值 NT$（USD_TO_TWD=31，×1MP） | $0.03 × 31 ≈ **NT$0.93** → 四捨五入 1 點 |
| 校準判定 | **≈**（`docs/點數校準報告.md`；pricing 黃金例 `["fal-ai/flux-2/pro", 1]`） |
| estimatePoints | 扁平 1（非按字／非動態 MP；長 prompt 仍 1） |

**數值落差（文件級，非契約破）**：cost 簡寫成線性 `$0.03/MP`，未標「首 MP + 半價額外」；現站內三比例 preset 多落 ≤1MP 進位，1 點合理。若未來開自訂 2MP+ 尺寸，固定 1 點會倒貼。

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| 靜態契約 L0 | **ok** |
| endpointOf | `getModel` → `endpoint: "fal-ai/flux-2-pro"` ✓ |
| input 16:9 | `{ prompt, image_size: "landscape_16_9" }` |
| input 9:16 | `{ prompt, image_size: "portrait_16_9" }` |
| input 1:1 | `{ prompt, image_size: "square_hd" }` |
| OpenAPI 對齊 | Queue OpenAPI 2026-08-05 拉取：`Flux2ProInput` required 僅 `prompt`；`image_size` enum 含站內三 preset；**無** `negative_prompt`／steps／guidance |
| supportsNegativePrompt | false ✓ |
| supportsSeed | false（站內未暴露；官方有可選 `seed`） |
| dry-run probe | 本輪未跑 `verify-models` |
| live probe | **未跑**（R1 零 live） |
| 結論 | **ready-static-only**（契約綠；verified 仍 false，待 L2 首跑） |

### OpenAPI 摘要（`GET …/openapi.json?endpoint_id=fal-ai/flux-2-pro`）

- Paths：`POST /fal-ai/flux-2-pro`（queue）、status／cancel／result。
- Input 可選：`image_size`（default `landscape_4_3`；x-fal：multiple_of 16、邊 256–2560、**max_area 4_194_304＝4MP**）、`seed`、`safety_tolerance` 1–5（default 2）、`enable_safety_checker`（default true）、`output_format` jpeg|png、`sync_mode`。
- Output：`images[]`（url…）、`seed`。
- 站內未送：seed／safety／format／sync → 吃官方預設。

## 4. 底層

| 面向 | 說明 |
|------|------|
| 架構 | 潛空間 **rectified flow** transformer；非經典 DDPM U-Net |
| 文字塔 | **Mistral-3 系 24B VLM**（FLUX.2 家族；取代 FLUX.1 的 T5+CLIP） |
| 站內 encoder | `shared/textEncoders.ts`：`^fal-ai/flux-2` → profile `flux2`／sentencepiece；**limitTokens 未公開** → 站內不可量 token |
| Pro 定位 | **零設定**生產檔：OpenAPI 無 `num_inference_steps`／`guidance_scale`／`acceleration`（可調檔見 flex） |
| input 組裝 | `(p, f) => ({ prompt: p, image_size: imageSize(f) })`；`imageSize`：9:16→portrait_16_9、1:1→square_hd、其餘→landscape_16_9 |
| 送出路徑 | `generationCore` → `endpointOf(model)` → `falSubmit("fal-ai/flux-2-pro", …)` |
| 與官方差異 | 官方 default 尺寸 `landscape_4_3`；站內橫幅統一 **16:9**（產品覆寫，可接受） |
| 家族 | [pro] 本卡；[flex] 可調；[dev] `fal-ai/flux-2`；Edit `fal-ai/flux-2/pro/edit`；LoRA `fal-ai/flux-2/lora` |

## 5. 站內點數路徑

```
UI / MCP generate_into_scene / agent
  → prepare（estimatePointsFor(model, { promptChars, usdToTwdRate })）
  → est = 1（本模扁平）
  → member 且 est ≥ 組 approvalThreshold → awaiting_approval（不扣點）
  → 否則 insert generations(pointsEst=est) + reserveQuota(user, group, est, …, genId)
  → falSubmit(endpointOf)
  → 失敗 refund(…, pointsEst, …)
  → BYOK 個人 fal key：略過平台扣點與核准門檻
```

| 檢查 | 結果 |
|------|------|
| 顯示點數 | catalog／UI 用 `model.points`＝1 |
| 扣點／退點 | 同 `pointsEst`＝`estimatePointsFor` → 一致 |
| 與 cost 校準 | 1MP 假設 ≈ NT$0.9 → 1 點 ≈ |
| verified false | 既有保護：首跑失敗應退點（勿改 verified 直至 live 成功） |

## 6. 暴露面

| 通路 | 是否暴露 | 備註 |
|------|:--------:|------|
| 模型選擇器（文生圖 flagship） | ✅ | `MODELS` 首條；無 needs |
| `model_catalog` 同步 | ✅ | `catalog.syncCatalog` 寫 id + endpointOf + points/verified |
| tRPC generation | ✅ | `modelId: "fal-ai/flux-2/pro"`（**非** endpoint 字串） |
| MCP `generate_into_scene` | ✅ | 同上 modelId；世界觀注入後走同一 `model.input()` |
| Scene recipe `sc-hero-visual` | ✅ | pickIds[0] |
| Style showdown 構圖/光影/質感 | ✅ | winner |
| scenarioPlaybook `portrait` | ✅ | modelIds 首選 |
| seed／safety UI | ❌ | 官方有、站內未暴露 |
| negative_prompt | ❌ | schema 無；allowlist 正確排除 |
| 自訂 width×height | ❌ | 僅 preset 名 |

**MCP 陷阱**：傳 `fal-ai/flux-2-pro` 當 modelId 會 `getModel` 失敗；必須用站內 id `fal-ai/flux-2/pro`。

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 正式宣傳主視覺／定調圖 | ✅ 首選 | bestFor、sc-hero-visual、showdown winner |
| 莊嚴人物寫真／志工紀實 | ✅ | playbook portrait；師父本人應改真實照+編輯 |
| 日常草稿／量產試錯 | △ | 可；經濟檔 FLUX.1 dev／schnell 更省 |
| 中文長字卡／密集海報 | ❌ | 中文長句仍弱 → Qwen／Seedream／GPT Image |
| 系列重現（同 seed） | △ | 官方支援 seed；站內未暴露 |
| 風格 LoRA | ❌ 本端點 | 走 `flux-2/lora` + trainer |

bestFor **恰當**；使用者可在文生圖旗艦列表選到；無需來源提示。

## 8. 文件

| 來源 | 用途 |
|------|------|
| fal Queue OpenAPI | `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/flux-2-pro`（本輪 curl 200；`Flux2ProInput`／4MP x-fal） |
| fal 模型頁 | https://fal.ai/models/fal-ai/flux-2-pro |
| fal API 文件 | https://fal.ai/models/fal-ai/flux-2-pro/api |
| BFL FLUX.2 技術文 | https://bfl.ai/blog/flux-2 |
| 站內 | `shared/models.ts` L243–251；`textEncoders.ts` flux2；`scenarioPlaybook.ts`；`generationCore.ts`；`mcpWriteExpansion.ts` |
| 既有深度卡 | `docs/research/model-cards/fal-ai__flux-2__pro.md`（depth v2） |
| 清查／生態 | `docs/模型清查清單.md`、`docs/fal生態研究.md`、`docs/research/model-deep-dive-2026-08/文生圖逐一研究.md` #1 |
| 點數 | `docs/點數校準報告.md`、`shared/models.pricing.test.ts` |

## 9. 建議動作

- [x] **維持** id 斜線 + endpoint 連字號（相容舊 generation 列）
- [x] **維持** points=1（1MP 校準 ≈；本輪禁止改 points）
- [x] **維持** 不送 negative／不暴露 steps（官方 pro schema 無）
- [ ] **L2 live**：`verify-models --probe "fal-ai/flux-2/pro"`（單寫者加鎖；成功後人審再 `verified: true`）
- [ ] **cost 文案**（可選 P2）：改為 `$0.03/首MP, +$0.015/額外MP` 與 edit 端點對齊
- [ ] **可選暴露 seed**（P3）：系列主視覺重現
- [ ] **勿**為 pro 加 guidance/steps UI（那是 flex）
- [ ] **勿**把 endpoint 字串當 modelId 寫進 MCP 範例

**L0 結論**：靜態契約綠（endpoint／input／allowlist／點數扁平一致）。剩餘為 verified 待 live、cost 簡寫文件債。
