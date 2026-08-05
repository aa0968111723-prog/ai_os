# fal-ai/recraft/v4.1/text-to-image

> slug: `fal-ai__recraft__v4.1__text-to-image` · 審計 **#18** · R1 static+research · 2026-08-05  
> 本輪 **零 live／禁止 `--yes`**；未改 `verified`／`points`。

## 1. 身分

| 欄位 | 值 |
|------|-----|
| 站內 id | `fal-ai/recraft/v4.1/text-to-image` |
| 實際 endpoint | **同 id**（無 `endpoint` 覆寫；`endpointOf` → 自身） |
| label | Recraft V4.1 |
| category / tier / kind | `text-to-image` · `economy` · `image` |
| verified | **false**（目錄 ⚠︎；OpenAPI 本輪 200，待 L2 首跑再翻） |
| needs | 無（純文生圖） |
| recommended | 否 |
| strengths | Recraft 新版;提示控制更準、構圖乾淨,品牌/編輯設計取向 |
| bestFor | 品牌系統化活動主視覺、編輯風排版物料 |
| 廠商 | Recraft **V4.1** via fal.ai |
| MODELS 序 | 0-based index **17**（審計總表 **#18**） |

**一句話**：Recraft 設計／品牌取向新版——構圖乾淨、提示控制準；**$0.04／張**經濟檔；中文長字卡勿當主力（改 Qwen／Seedream）。

## 2. 數值

| 項目 | 值 |
|------|-----|
| points | **1** |
| cost（目錄字串） | `$0.04/張(Pro $0.25)` |
| 官方價與單位（目錄／生態研究） | **$0.04／張** 基準；註記 Pro **$0.25**（站內**未**暴露 Pro 檔位參數） |
| 估值 NT$（USD_TO_TWD=31，×1 張） | $0.04 × 31 = **1.24** → 四捨五入 **1** 點 |
| 校準判定 | **≈**（略高於 1 元；下限 1 點） |
| estimatePoints | 扁平 **1**（`realPricePoints` 自 `$0.04/張` 機械換算） |

**數值落差（文件／產品級，非契約破）**

- cost 字串含 **Pro $0.25**；本輪 OpenAPI **無** style／quality／model 檔位欄可切 Pro → 站內固定吃 **$0.04** 基準，1 點合理。
- 若未來暴露 Pro 路徑而不改估點 → **嚴重倒貼**（約 8 點級）。
- `colors`／`background_color` 可選；站內不送 → 不影響計價。
- **本輪禁止改 points**（維持 1）。

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| 靜態契約 L0 | **ok** |
| endpointOf | `getModel` → endpoint 即 id ✓ |
| input 16:9 | `{ prompt, image_size: "landscape_16_9" }` |
| input 9:16 | `{ prompt, image_size: "portrait_16_9" }` |
| input 1:1 | `{ prompt, image_size: "square_hd" }` |
| OpenAPI 對齊 | Queue OpenAPI 2026-08-05 拉取 **HTTP 200**：`RecraftV41TextToImageInput` required 僅 `prompt`；`image_size` enum 含站內三 preset |
| supportsNegativePrompt | **false** ✓（schema **無** `negative_prompt`；allowlist 未收） |
| supportsSeed | **false** ✓（schema **無** `seed`） |
| dry-run / live probe | **未跑**（R1 零 live；禁止 `--yes`） |
| 結論 | **ready-static-only**（契約綠；verified 仍 false） |

### OpenAPI 摘要（`GET …/openapi.json?endpoint_id=fal-ai/recraft/v4.1/text-to-image`）

- Paths：`POST /fal-ai/recraft/v4.1/text-to-image`（queue）、status／cancel／result。
- **x-fal-metadata**：endpointId=`fal-ai/recraft/v4.1/text-to-image`；category=`text-to-image`；about: *Recraft V4 1*；playground／api 同路徑。
- Schema：`RecraftV41TextToImageInput`／`RecraftV41TextToImageOutput`
- **required**：`prompt`（string，minLength 1，maxLength **10000**）
- 可選：
  - `image_size`：default **`square_hd`**；enum `square_hd|square|portrait_4_3|portrait_16_9|landscape_4_3|landscape_16_9` 或 `{width,height}`
  - `colors`：`RGBColor[]` default `[]`（偏好色板）
  - `background_color`：`RGBColor | null`
  - `enable_safety_checker`：default **true**
- **無** `style`／`style_id`（與 V3 大量 style enum **不同**——V4.1 公開 schema 收斂為色板控制）
- **無** `negative_prompt`／`seed`／`num_images`／steps／CFG
- 站內 `input()` 只送 `prompt` + `image_size`；其餘吃官方預設。

## 4. 底層

| 面向 | 說明 |
|------|------|
| 架構 | Recraft 閉源設計／編輯取向文生圖（V4.1）；品牌系統、編輯風排版 |
| 條件編碼 | 未公開（站內 `textEncoders`：`/recraft/` → profile `recraft`，label「未公開」） |
| 解析度 | preset 或自訂 WH；官方 default `square_hd`；站內橫幅 **16:9** |
| 色板控制 | schema 暴露 `colors`／`background_color`（品牌色一致性）；站內**未**暴露 |
| 與 V3 差異 | V3 有大量 `style` enum＋向量 SVG 敘事（cost 註向量 2×）；V4.1 公開 API **無 style／vector 欄**，改走色板 |
| input 組裝 | `(p, f) => ({ prompt: p, image_size: imageSize(f) })` |
| 送出路徑 | `generationCore` → `endpointOf`（= id）→ `falSubmit`；禁忌只能移出正向（無 negative） |
| 家族 | 本卡 V4.1；姊妹 `fal-ai/recraft/v3/text-to-image`；upscale `fal-ai/recraft/upscale/crisp` |

## 5. 站內點數路徑

```
UI / MCP generate_into_scene / agent
  → prepare（estimatePointsFor → realPricePoints 自 $0.04/張 → 1）
  → insert generations(pointsEst=1) + reserveQuota(…, 1, …)
  → falSubmit("fal-ai/recraft/v4.1/text-to-image")
  → 失敗 refund(…, 1, …)
  → BYOK：略過平台扣點
```

| 檢查 | 結果 |
|------|------|
| 顯示點數 | catalog／UI 用 `model.points`＝1（或 realPrice 覆寫後仍 1） |
| 扣點／退點 | 同 `pointsEst`＝1 → 一致 |
| 與 cost 校準 | $0.04×31≈1.24 → 1 點 ≈ |
| verified false | 首跑失敗應退點；勿改 verified 直至 L2 成功 |

## 6. 暴露面

| 通路 | 是否暴露 | 備註 |
|------|:--------:|------|
| 模型選擇器（文生圖 economy） | ✅ | MODELS 可選；無 needs |
| `model_catalog` 同步 | ✅ | id = endpoint |
| tRPC generation | ✅ | modelId 全路徑 |
| MCP `generate_into_scene` / `submit_generation` | ✅ | 工具層不暴露 colors／bg |
| Scene recipe `sc-design-poster` | ❌ | 現 pickIds 為 ideogram v3／v4／recraft **v3**（**未**含 V4.1） |
| Style showdown 排版軸 | ❌ | runner-up 為 ideogram v4，非本 id |
| colors／background_color | ❌ | 官方有、站內不送 |
| negative／seed | ❌ | schema 無 |
| Pro $0.25 檔 | ❌ | 無對應 schema 欄；cost 僅註記 |

**MCP 陷阱**：傳完整 id；勿與 `recraft/v3` 混淆；勿假設 style enum 仍可用。

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 品牌系統化活動主視覺 | ✅ | bestFor；構圖乾淨、編輯風 |
| 編輯風排版物料（英文／混排） | ✅ | 設計取向 |
| 可無限放大 logo／向量 | △ | V3 向量敘事更強；V4.1 schema 無 vector style |
| 繁中金句卡／密集中文 | ❌ 勿主力 | 中文改 Qwen／Seedream |
| 需禁忌硬控 | ❌ | 無 negative_prompt |
| 系列同 seed 重現 | ❌ | schema 無 seed |
| 品牌色鎖定 | △ 產品 | 官方有 colors；站內未暴露 |

bestFor **恰當**；使用者可在文生圖經濟列表選到；**非** design-poster recipe 首選（仍是 Ideogram／Recraft V3）。

## 8. 文件

| 來源 | 用途 |
|------|------|
| fal Queue OpenAPI | `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/recraft/v4.1/text-to-image`（本輪 curl **200**；`RecraftV41TextToImageInput`） |
| fal 模型頁 | https://fal.ai/models/fal-ai/recraft/v4.1/text-to-image（HTML 常被 Vercel checkpoint 擋） |
| fal API | https://fal.ai/models/fal-ai/recraft/v4.1/text-to-image/api |
| 站內 | `shared/models.ts`；`textEncoders.ts` recraft；姊妹卡 `fal-ai__recraft__v3__text-to-image.md` |
| 清查／生態 | `docs/fal生態研究.md`、`docs/模型目錄.md`、`docs/research/model-deep-dive-2026-08/文生圖逐一研究.md` #18 |

## 9. 建議動作

- [x] **維持** id＝endpoint 全路徑；`imageSize(f)` 與 OpenAPI enum 對齊
- [x] **維持** points=1（$0.04×31≈1.24 ≈；本輪禁止改 points）
- [x] **維持** 不送 negative／seed（schema 無）
- [ ] **L2 live**：`verify-models --probe "fal-ai/recraft/v4.1/text-to-image"`（單寫者加鎖；成功後人審再 `verified: true`）
- [ ] **可選 P2**：暴露 `colors`／`background_color` 供品牌色（產品）
- [ ] **可選 P3**：`sc-design-poster` 是否納入 V4.1 為 pick（與 V3 取捨）
- [ ] **勿**在未證實 schema 前假設 V3 的 style／vector 參數可套到 V4.1
- [ ] **勿**暴露 Pro $0.25 而未改估點

**L0 結論**：靜態契約綠（endpoint／三比例 image_size／扁平 1 點）。剩餘為 verified 待 live、色板未暴露、recipe 未掛 V4.1。
