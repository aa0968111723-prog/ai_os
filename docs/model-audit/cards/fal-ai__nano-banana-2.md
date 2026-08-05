# fal-ai/nano-banana-2

> slug: `fal-ai__nano-banana-2` · 審計 #5 · R1 static+research · 2026-08-05  
> 本輪 **零 live／禁止 `--yes`**；未改 `verified`／`points`。  
> **可註**：L 角色 live probe 已在 budget 成功（`budget.json` · `pointsEst=3` · `twdEst=3.0` · status=success · spentTwd 累計含本模）。

## 1. 身分

| 欄位 | 值 |
|------|-----|
| 站內 id | `fal-ai/nano-banana-2` |
| 實際 endpoint | **同 id**（無 `endpoint` 覆寫；`endpointOf` → 自身） |
| label | Nano Banana 2(Google) |
| category / tier / kind | `text-to-image` · `flagship` · `image` |
| verified | **true**（目錄已查證；OpenAPI 本輪 200；L live 已成功） |
| needs | 無（純文生圖） |
| recommended | 否（`undefined`／非 recommended 旗標） |
| strengths | Gemini 3.1 Flash Image;推理式生成、文字準確、風格多變 |
| bestFor | 寫實人物場景、需要準確理解複雜指令的畫面 |
| 廠商 | Google **Gemini 3.1 Flash Image**（產品別名 Nano Banana 2）via fal.ai |
| MODELS 序 | index **4**（文生圖第五條；審計總表 #5） |

**一句話**：Google 多模態 Flash 影像旗艦——先理解口語／敘事指令再渲染；寫實人物與複雜多條件畫面幾乎一鍵到位；中文短標題可用，密集長中文字卡仍次於 Qwen／Seedream／GPT Image。

## 2. 數值

| 項目 | 值 |
|------|-----|
| points | **3** |
| cost（目錄字串） | `$0.06–0.16/張(依解析度)` |
| 官方價與單位（fal 生態／姊妹 edit 頁交叉） | **基準 1K ≈ $0.08／張**；**0.5K ×0.75 ≈ $0.06**；**2K ×1.5 ≈ $0.12**；**4K ×2 ≈ $0.16**；可選 web search +$0.015、high thinking +$0.002（edit 頁同系敘事） |
| 估值 NT$（USD_TO_TWD=31） | 範圍中值 **$0.110** × 31 = **3.41** → 四捨五入 **3** 點 |
| 校準判定 | **≈**（`docs/點數校準報告.md` 旗艦列 3.4 ≈；本機 `realPricePoints`／`estimatePoints` 皆回 **3**） |
| estimatePoints | 扁平 **3**（非 TTS 動態；長 prompt 仍 3；**未**依 resolution 動態估點） |

**數值落差（文件／產品級，非契約破）**

- 站內不送 `resolution` → 吃官方 default **`1K`** → 真實帳單 ≈ **$0.08**（≈ NT$2.5），扁平 **3** 點略偏高但落在「≈」與旗艦安全墊可接受區。
- 若未來暴露 **4K** 而不升點 → **低估**（$0.16 ≈ 5 點）；暴露 **0.5K** 而不降點 → 小幅高估。
- `num_images` 1–4：站內不送 → 1 張；暴露多圖須 ×N 估點。
- cost 字串用範圍中值估點合理；P2 可改寫成 `$0.08/張(1K; 0.5K×0.75、2K×1.5、4K×2)` 與 edit 姊妹對齊。
- **本輪禁止改 points**（維持 3）。

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| 靜態契約 L0 | **ok** |
| endpointOf | `getModel` → endpoint 即 id ✓ |
| input 16:9 | `{ prompt, aspect_ratio: "16:9" }` |
| input 9:16 | `{ prompt, aspect_ratio: "9:16" }` |
| input 1:1 | `{ prompt, aspect_ratio: "1:1" }` |
| OpenAPI 對齊 | Queue OpenAPI 2026-08-05 拉取 **HTTP 200**：`NanoBanana2Input` required 僅 `prompt`；`aspect_ratio` enum 含站內三比例；**無** `negative_prompt`／steps／guidance／`image_size` |
| supportsNegativePrompt | **false** ✓（schema 無；`NEGATIVE_PROMPT_SUPPORTED` 未收——正確） |
| supportsSeed | **false**（站內 `SEED_SUPPORTED` 未收；**官方 OpenAPI 有可選 `seed`** → 消融／系列重現未暴露） |
| dry-run probe | 本輪未跑 `verify-models`（R1 研究） |
| live probe | **已成功**（L 角色；`budget.json` 2026-08-05T04:03:34Z · status=success · twdEst=3.0；**非本輪 R1 發起**） |
| 結論 | **ready**（契約綠 + verified true + live OK；進階 seed／resolution 未 allowlist） |

### OpenAPI 摘要（`GET …/openapi.json?endpoint_id=fal-ai/nano-banana-2`）

- Paths：`POST /fal-ai/nano-banana-2`（queue）、status／cancel／result。
- Metadata：`category: text-to-image`；about：「Gemini 3.1 Flash Image is a text-to-image model that generates images from text descriptions.」；playground／docs 與 id 一致。
- Input（`x-fal-order-properties`）：`prompt`、`num_images`、`seed`、`aspect_ratio`、`output_format`、`safety_tolerance`、`sync_mode`、`system_prompt`、`resolution`、`limit_generations`、`enable_web_search`、`thinking_level`。
  - `prompt`：**required** string，minLength 3、maxLength 50000。
  - `aspect_ratio`：default **`auto`**；enum  
    `auto|21:9|16:9|3:2|4:3|5:4|1:1|4:5|3:4|2:3|9:16|4:1|1:4|8:1|1:8`（含極端比；描述支援 extreme ratios）。
  - `resolution`：default **`1K`**；enum `0.5K|1K|2K|4K`。
  - `num_images`：1–4，default 1。
  - `seed`：integer \| null（可選）。
  - `output_format`：jpeg|png|webp，default **png**。
  - `safety_tolerance`：`"1"`…`"6"`，default **`"4"`**（1 最嚴、6 最寬）。
  - `system_prompt`：可選，maxLength 50000（Gemini system instruction）。
  - `thinking_level`：`minimal|high` \| null（省略＝關閉 thinking）。
  - `enable_web_search`：boolean，default false。
  - `limit_generations`：boolean，default true（實驗；限制每輪只 1 張，忽略 prompt 內「多圖」指令）。
  - `sync_mode`：boolean，default false。
- **無** `negative_prompt`、`num_inference_steps`、`guidance_scale`、`image_size`（勿誤送 → 防 422）。
- Output：`images[]`（url…）、`description`（required）。
- 站內 `input()` 只送 `prompt` + `aspect_ratio`（格式字串原樣）；其餘吃官方預設（1K、1 張、safety 4、png、無 thinking／web search）。

## 4. 底層

| 面向 | 說明 |
|------|------|
| 架構 | **多模態 LLM 渲染**（`modelMechanics` family `mllm-render`）：先理解意圖再出圖；**非**經典 SD U-Net／可調 steps·CFG 管線 |
| 條件／文字 | Gemini 3.1 Flash Image；口語、長句、多條件指令吃得動；輸出常帶 **SynthID** 類隱形浮水印（產品敘事） |
| 解析度 | `resolution` 0.5K–4K；default 1K；4K 為原生高解析（非事後 upscale 敘事） |
| 站內 encoder | `shared/textEncoders.ts`：`/nano-banana|gemini/` → profile **`gemini-image`**／sentencepiece；**limitTokens 未公開** → 站內不可量 token（`measured: false`） |
| 負向 | schema **無** negative → 世界觀禁忌僅自正向移出，**不**注入 `negative_prompt` |
| input 組裝 | `(p, f) => ({ prompt: p, aspect_ratio: aspect(f) })`；`aspect = (f) => f` → 直接傳 `"16:9"`／`"9:16"`／`"1:1"`（**非** `image_size` preset 名） |
| 送出路徑 | `generationCore` → `endpointOf`（= id）→ `falSubmit`；不送 seed／resolution／thinking |
| 與官方差異 | 官方 default `aspect_ratio: "auto"`；站內依專案格式強制三比例（產品覆寫，enum 合法）。官方有 seed／resolution／system_prompt／thinking／web_search／num_images，站內日常 UI 未暴露 |
| 家族 | T2I 本卡；Edit `fal-ai/nano-banana-2/edit`（$0.08/1K）；Pro `fal-ai/nano-banana-pro`（$0.15）；Pro Edit；v1 Edit `fal-ai/nano-banana/edit`（經濟） |

## 5. 站內點數路徑

```
UI / MCP generate_into_scene / agent
  → prepare（estimatePoints(model, { promptChars, usdToTwdRate })）
  → est = 3（本模扁平；realPricePoints("$0.06–0.16/張…") → mid 0.11 → 3）
  → member 且 est ≥ 組 approvalThreshold → awaiting_approval（不扣點）
  → 否則 insert generations(pointsEst=est) + reserveQuota(user, group, est, …, genId)
  → falSubmit(endpointOf)  // = fal-ai/nano-banana-2
  → 失敗 refund(…, pointsEst, …)
  → BYOK 個人 fal key：略過平台扣點與核准門檻
```

| 檢查 | 結果 |
|------|------|
| 顯示點數 | catalog／UI 用 `model.points`＝3（載入時 `realPricePoints` 覆寫後仍 3） |
| 扣點／退點 | 同 `pointsEst`＝`estimatePoints` → 一致 |
| 與 cost 校準 | 範圍中值 $0.11×31≈3.4 → 3 點 ≈；預設 1K 實帳 ~$0.08 時略偏高 |
| verified true | 目錄已標查證；live 已成功；失敗仍應走既有 refund（勿略過退點） |

## 6. 暴露面

| 通路 | 是否暴露 | 備註 |
|------|:--------:|------|
| 模型選擇器（文生圖 flagship） | ✅ | MODELS 文生圖第 5 條；無 needs |
| `model_catalog` 同步 | ✅ | id = endpoint；points=3／verified=true |
| tRPC generation | ✅ | modelId 即全路徑 id |
| MCP `generate_into_scene`／`submit_generation` | ✅ | 同上；工具層不暴露 seed／resolution／thinking |
| scenarioPlaybook `portrait` | ✅ | modelIds[1]（FLUX.2 pro 後） |
| Scene recipe `sc-portrait` | ✅ | pickIds[2]（Imagen 4 Ultra → FLUX1.1 ultra → 本模） |
| Workflow `wf/brand-storyboard-flagship` | ✅ | step「生成主圖」；下一步 edit 統一調性 |
| Style showdown「複雜指令理解」 | △ | winner/runner 為 **Pro**／GPT Image；本模同家族 Flash 檔 |
| negative_prompt | ❌ | schema 無；勿加入 allowlist |
| seed（消融／系列） | ❌ | 官方有、`SEED_SUPPORTED` 未收 |
| resolution／thinking／web_search／system_prompt／num_images／safety／format UI | ❌ | 吃預設 |
| 自訂 width×height | ❌ | 僅 aspect_ratio 字串 |
| 來源圖 | ❌ 本端點 | 編輯／多參考走 `…/edit`（最多 14 參考） |

**MCP 陷阱**：無 endpoint 別名，傳 id 即可；**勿**傳 Edit 路徑當 T2I；**勿**誤送 `image_size` 或 `negative_prompt`（schema 無／非本模欄位）；**勿**與 `nano-banana-pro` 混用估點（Pro 扁平 5）。

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 寫實莊嚴人物寫真／志工紀實感 | ✅ 首選梯隊 | bestFor；`sc-portrait`；playbook `portrait` |
| 複雜口語／多條件敘事畫面 | ✅ | mllm 理解力；「禪堂晨光下…」類幾乎一鍵 |
| 品牌繪本／系列主圖（旗艦工作流） | ✅ | `wf/brand-storyboard-flagship` 生成步 |
| 中文短標題／招牌字 | ✅ 可用 | Google 系前段；密集長段仍次 Qwen |
| 中文金句卡・書法密集長段 | △／❌ | 改 Qwen／Seedream／GPT Image |
| 電影光影宣傳主視覺天花板 | △ | 可用；showdown 偏 FLUX.2 pro／本系 **Pro** |
| 日常大量草稿 | △ | 3 點偏貴 → schnell／dev／Sana |
| 系列重現（同 seed） | △ | 官方支援；站內未 allowlist |
| 要改既有圖／多參考合成 | ❌ 本端點 | 走 `fal-ai/nano-banana-2/edit` |
| 最高規 4K／極限指令 | △ | 升 `nano-banana-pro` 或暴露 resolution（估點須同步） |

bestFor **恰當**；使用者可在文生圖旗艦列表選到；無需來源提示。

## 8. 文件

| 來源 | 用途 |
|------|------|
| fal Queue OpenAPI | `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/nano-banana-2`（本輪 curl **200**；`NanoBanana2Input`／Output） |
| fal 模型頁 | https://fal.ai/models/fal-ai/nano-banana-2（HTML 常被 Vercel checkpoint 擋；定價以生態＋姊妹 edit 頁＋第三方交叉） |
| fal API 文件 | https://fal.ai/models/fal-ai/nano-banana-2/api |
| 姊妹 edit 定價敘事 | https://fal.ai/models/fal-ai/nano-banana-2/edit（$0.08/1K；2K×1.5、4K×2、0.5K×0.75） |
| 站內 | `shared/models.ts` L274–278（目錄／`aspect_ratio` input）；`textEncoders.ts` gemini-image；`modelMechanics.ts` mllm-render；`scenarioPlaybook.ts` portrait；`WORKFLOW_PRESETS` brand-storyboard；`SCENARIO_RECIPES` sc-portrait；`generationCore.ts` |
| 清查／生態 | `docs/fal生態研究.md` Nano Banana 2 列；`docs/模型目錄.md`；`docs/research/model-deep-dive-2026-08/文生圖逐一研究.md` #5；`站內落差與修復建議.md`（cost 範圍 vs 基準 ~$0.08） |
| 點數 | `docs/點數校準報告.md`（$0.110 中值 → 3.4 → 3 ≈） |
| 審計預算 | `docs/model-audit/budget.json` live_probe success；`ROUND-LOG.md`「nano-banana-2 live OK」 |

## 9. 建議動作

- [x] **維持** id＝endpoint 全路徑（無別名改寫）
- [x] **維持** points=3（範圍中值校準 ≈；本輪禁止改 points）
- [x] **維持** verified=true（OpenAPI 存活＋目錄已查證＋L live 成功）
- [x] **維持** 不送 negative／不暴露 steps／guidance（schema 無）
- [x] **維持** 三比例 `aspect_ratio` 字串（enum 內；與 `image_size` 族分開——正確）
- [x] **註記 live**：budget 已成功；R1 本輪不重跑、不加 `--yes`
- [ ] **可選 P2 cost 文案**：改為 `$0.08/張(1K; 0.5K $0.06、2K $0.12、4K $0.16)`，與 edit 姊妹一致（估點若改錨 0.08 會變 2——需產品決策是否連動 points）
- [ ] **可選 P2**：將本 id 加入 `SEED_SUPPORTED`（OpenAPI 已有 `seed`）——消融／系列主圖可固定噪聲
- [ ] **可選 P3**：進階面板 `resolution`（1K 草稿／4K 成品）——**必須**動態估點，否則 4K 倒貼
- [ ] **可選 P3**：文案引導「複雜口語敘事 → Nano Banana 2；最高規 → Pro；密集中文字卡 → Qwen」
- [ ] **勿**在未改估點前暴露 `num_images`>1 或強制 4K
- [ ] **勿**誤送 `image_size`／`negative_prompt` 或把 Edit endpoint 當 T2I modelId
- [ ] **勿**把本模當中文長海報第一主力（bestFor 已正確偏寫實／指令）

**L0 結論**：靜態契約綠（endpoint／三比例 `aspect_ratio`／無 negative 正確／扁平 3 點與範圍中值校準一致／verified 合理）。L2 live 已由 budget 證明成功。剩餘為 seed allowlist、resolution 動態估點產品債、以及 cost 基準錨可選精煉（非阻塞）。
