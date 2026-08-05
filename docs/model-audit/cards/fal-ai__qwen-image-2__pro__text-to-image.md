# fal-ai/qwen-image-2/pro/text-to-image

> slug: `fal-ai__qwen-image-2__pro__text-to-image` · 審計 #2 · R1 static+research · 2026-08-05  
> 零 live；未改 `verified`／`points`。

## 1. 身分

| 欄位 | 值 |
|------|-----|
| 站內 id | `fal-ai/qwen-image-2/pro/text-to-image` |
| 實際 endpoint | **同 id**（無 `endpoint` 覆寫；`endpointOf` → 自身） |
| label | Qwen Image 2.0 Pro |
| category / tier / kind | `text-to-image` · `flagship` · `image` |
| verified | **false**（目錄 ⚠︎；OpenAPI 本輪已實取，待 L2 首跑再翻） |
| needs | 無（純文生圖） |
| recommended | 否（`undefined`／非 recommended 旗標） |
| strengths | 阿里通義最高保真檔;中文渲染上限最高之一,長段中文、書法字、直排都穩 |
| bestFor | 正式交付的中文長版海報、書法字與密集中文並存的主視覺 |
| 廠商 | 阿里通義 Qwen-Image-2.0 **Pro** via fal.ai |
| MODELS 序 | index 1（文生圖第二條，緊接 FLUX.2 pro） |

**一句話**：通義旗艦保真檔——正式交付的中文長版海報／書法／密集字卡；草稿先用 Standard（1 點），定稿再升 Pro（2 點）。

## 2. 數值

| 項目 | 值 |
|------|-----|
| points | **2** |
| cost（目錄字串） | `$0.075/張(原生 2K)` |
| 官方價與單位（OpenAPI／生態研究／既有 depth 卡） | **固定 $0.075／張**（非 MP；原生可至 ~2048²） |
| 估值 NT$（USD_TO_TWD=31，×1 張） | $0.075 × 31 = **2.325** → 四捨五入 **2** 點 |
| 校準判定 | **≈**（`docs/點數校準報告.md` 旗艦列；本機 `realPricePoints`／`estimatePoints` 皆回 2） |
| estimatePoints | 扁平 2（非 TTS 動態；長 prompt 仍 2） |

**數值落差（文件級）**：`num_images` 官方 1–4，帳單按張；站內不送 → 固定 1 張／次，2 點合理。若未來暴露多圖而不 ×N 估點會倒貼。

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| 靜態契約 L0 | **ok** |
| endpointOf | `getModel` → endpoint 即 id（無連字號 alias）✓ |
| input 16:9 | `{ prompt, image_size: "landscape_16_9" }` |
| input 9:16 | `{ prompt, image_size: "portrait_16_9" }` |
| input 1:1 | `{ prompt, image_size: "square_hd" }` |
| OpenAPI 對齊 | Queue OpenAPI 2026-08-05 拉取 200：`QwenImage2ProTextToImageInput` required 僅 `prompt`；`image_size` enum 含站內三 preset；**有** `negative_prompt`（max 500）／`seed`／`enable_prompt_expansion` |
| supportsNegativePrompt | **true** ✓（allowlist 已收） |
| supportsSeed | **true** ✓（消融／進階路徑；日常 UI 不強制） |
| dry-run probe | 本輪未跑 `verify-models` |
| live probe | **未跑**（R1 零 live） |
| 結論 | **ready-static-only**（契約綠；verified 仍 false，待 L2 首跑） |

### OpenAPI 摘要（`GET …/openapi.json?endpoint_id=fal-ai/qwen-image-2/pro/text-to-image`）

- Paths：`POST /fal-ai/qwen-image-2/pro/text-to-image`（queue）、status／cancel／result。
- Input 可選：`negative_prompt`（default `""`，string max 500）、`image_size`（default `square_hd`；enum `square_hd|square|portrait_4_3|portrait_16_9|landscape_4_3|landscape_16_9` 或 `{width,height}`；總像素約 512²–2048²）、`enable_prompt_expansion`（default **true**）、`seed`（0–2147483647）、`enable_safety_checker`（default true）、`sync_mode`（default false）、`num_images` 1–4（default 1）、`output_format` jpeg|png|webp（default png）。
- Output：`images[]`（url…）、`seed`。
- **無** `num_inference_steps`／`guidance_scale`／`acceleration`（Pro 零設定；勿依 learn 家族文誤傳 → 防 422）。
- 站內 `input()` 只送 prompt + image_size；`generationCore` 在 allowlist 下另注 `negative_prompt`；其餘吃官方預設。

## 4. 底層

| 面向 | 說明 |
|------|------|
| 架構 | **統一生成＋編輯** 家族；本端點僅 **text-to-image**（無 image_url） |
| 條件編碼 | **Qwen3-VL 系 VLM**（marketing：~8B frozen condition encoder）——長提示、中英混排、對話式指令；非 CLIP-77 |
| 生成骨幹 | **MMDiT／單流圖文 token** 擴散解碼（marketing：~7B） |
| 解析度 | **原生 2K** 級；schema 總像素區間約 512²–2048² |
| 站內 encoder | `shared/textEncoders.ts`：`/^fal-ai\/qwen-image/` → profile `qwen-image`；label 仍寫 **Qwen2.5-VL**（2.0 世代宜對齊 Qwen3-VL）；**limitTokens 未公開** → 站內不可量 token（`measured: false`） |
| 提示空間（外部） | fal learn：**~1000 tokens**；字卡建議雙引號包要渲染的字串 |
| 提示擴寫 | 預設 `enable_prompt_expansion=true`（LLM 優化；字卡精準場景可能改寫措辭） |
| input 組裝 | `(p, f) => ({ prompt: p, image_size: imageSize(f) })`；9:16→portrait_16_9、1:1→square_hd、其餘→landscape_16_9 |
| 送出路徑 | `generationCore` → `endpointOf`（= id）→ `falSubmit`；禁忌 → `negative_prompt` |
| 與官方差異 | 官方 default 尺寸 `square_hd`；站內橫幅統一 **16:9**（產品覆寫，可接受） |
| 家族 | Pro 本卡；Standard `fal-ai/qwen-image-2/text-to-image`（$0.035／1 點）；Edit `fal-ai/qwen-image-2/edit`；Max `fal-ai/qwen-image-max/text-to-image`；Trainer `qwen-image-2512-trainer` |

## 5. 站內點數路徑

```
UI / MCP generate_into_scene / agent
  → prepare（estimatePointsFor(model, { promptChars, usdToTwdRate })）
  → est = 2（本模扁平；realPricePoints 自 cost 機械換算）
  → member 且 est ≥ 組 approvalThreshold → awaiting_approval（不扣點）
  → 否則 insert generations(pointsEst=est) + reserveQuota(user, group, est, …, genId)
  → falSubmit(endpointOf)  // = fal-ai/qwen-image-2/pro/text-to-image
  → 失敗 refund(…, pointsEst, …)
  → BYOK 個人 fal key：略過平台扣點與核准門檻
```

| 檢查 | 結果 |
|------|------|
| 顯示點數 | catalog／UI 用 `model.points`＝2 |
| 扣點／退點 | 同 `pointsEst`＝`estimatePoints` → 一致 |
| 與 cost 校準 | $0.075×31≈2.3 → 2 點 ≈ |
| verified false | 既有保護：首跑失敗應退點（勿改 verified 直至 live 成功） |

## 6. 暴露面

| 通路 | 是否暴露 | 備註 |
|------|:--------:|------|
| 模型選擇器（文生圖 flagship） | ✅ | MODELS 第二條；無 needs |
| `model_catalog` 同步 | ✅ | id = endpoint；points/verified |
| tRPC generation | ✅ | modelId 即 `fal-ai/qwen-image-2/pro/text-to-image` |
| MCP `generate_into_scene` / `submit_generation` | ✅ | 同上；工具層不暴露進階欄 |
| Scene recipe `sc-cn-poster` | ✅ | **pickIds[0]**（中文長版海報首選） |
| Scene recipe `sc-guofeng` | ✅ | pickIds[1]（混元優先，Pro 次選） |
| scenarioPlaybook `quote-card` | ✅ | modelIds[1]（Standard 量產 → Pro／GPT 成品） |
| Style showdown 國風 | ✅ | runner-up（winner 混元） |
| 禁忌 negative_prompt | ✅ | allowlist + generationCore 注入 |
| seed（消融） | ✅ | SEED_SUPPORTED；日常 UI 不強制 |
| enable_prompt_expansion | ❌ | 吃預設 true |
| num_images／output_format／自訂 WH | ❌ | 固定 1 張、png、preset 名 |
| steps／guidance UI | ❌ | 官方 Pro schema 無 |

**MCP 陷阱**：無 endpoint 別名，傳 id 即可；勿誤傳 Standard 路徑當 Pro。

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 正式交付中文長版海報／密集字 | ✅ 首選 | bestFor、`sc-cn-poster` pickIds[0] |
| 書法字／直排／金句成品 | ✅ | playbook quote-card 升檔；字卡用引號包文字 |
| 國風／水墨／禪意大圖 | ✅ 次選 | `sc-guofeng`；首選混元 |
| 日常草稿／量產試錯 | △ | 可；經濟檔 **Standard（1 點）** 更省 |
| 寫實人像／宣傳光影主視覺 | △ | 可用非第一賣點 → FLUX.2 pro／Imagen／Nano Banana |
| 系列重現（同 seed） | △ | 官方＋allowlist 支援；站內日常 UI 未暴露 |
| 需來源圖編輯改字 | ❌ 本端點 | 走 `qwen-image-2/edit` 等 |

bestFor **恰當**；使用者可在文生圖旗艦列表選到；無需來源提示。

## 8. 文件

| 來源 | 用途 |
|------|------|
| fal Queue OpenAPI | `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/qwen-image-2/pro/text-to-image`（本輪 curl 200；`QwenImage2ProTextToImageInput`） |
| fal 模型頁 | https://fal.ai/models/fal-ai/qwen-image-2/pro/text-to-image（HTML 常被 Vercel checkpoint 擋；定價以生態＋OpenAPI 交叉） |
| fal API 文件 | https://fal.ai/models/fal-ai/qwen-image-2/pro/text-to-image/api |
| fal learn | https://fal.ai/learn/tools/how-to-use-qwen-image-2（Qwen3-VL+DiT、~1000 token、Standard vs Pro、字卡引號） |
| 站內 | `shared/models.ts`（目錄／allowlist／input）；`textEncoders.ts` qwen-image；`generationCore.ts` negative；`scenarioPlaybook.ts`；`SCENARIO_RECIPES` |
| 既有深度卡 | `docs/research/model-cards/fal-ai__qwen-image-2__pro__text-to-image.md`（depth v2） |
| 清查／生態 | `docs/fal生態研究.md`、`docs/research/model-deep-dive-2026-08/文生圖逐一研究.md` #2 |
| 點數 | `docs/點數校準報告.md`（$0.075 → 2.3 → 2 ≈） |

## 9. 建議動作

- [x] **維持** id＝endpoint 全路徑（無別名改寫）
- [x] **維持** points=2（$0.075 校準 ≈；本輪禁止改 points）
- [x] **維持** negative／seed allowlist（OpenAPI 已確認有欄）
- [x] **維持** 不送 steps／guidance（Pro schema 無）
- [ ] **L2 live**：`verify-models --probe "fal-ai/qwen-image-2/pro/text-to-image"`（單寫者加鎖；成功後人審再 `verified: true`）
- [ ] **可選** 字卡進階：暴露或預設關 `enable_prompt_expansion`（P2；防擴寫改掉金句措辭）
- [ ] **可選** `textEncoders` label 對齊 **Qwen3-VL** + 文件級 `documentedLimitTokens: 1000`（P3 顯示債）
- [ ] **可選** UI 文案「草稿 Standard → 定稿 Pro」（產品引導，非契約）
- [ ] **勿**在未改估點前暴露 `num_images`>1（帳單×張、站內扁平 2 會倒貼）
- [ ] **勿**把 Standard id 當 Pro 寫進 MCP／recipe 範例

**L0 結論**：靜態契約綠（endpoint／三比例 input／negative+seed allowlist／扁平 2 點一致）。剩餘為 verified 待 live、prompt_expansion 與 encoder label 文件／產品債。
