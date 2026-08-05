# fal-ai/qwen-image-max/text-to-image

> slug: `fal-ai__qwen-image-max__text-to-image` · 審計 **#22** · R1 static+research · 2026-08-05  
> 本輪 **零 live／禁止 `--yes`**；未改 `verified`／`points`。

## 1. 身分

| 欄位 | 值 |
|------|-----|
| 站內 id | `fal-ai/qwen-image-max/text-to-image` |
| 實際 endpoint | **同 id**（無 `endpoint` 覆寫；`endpointOf` → 自身） |
| label | Qwen Image Max |
| category / tier / kind | `text-to-image` · `flagship` · `image` |
| verified | **true**（目錄已標；本輪僅 static+OpenAPI，**未**本輪 live 覆核） |
| needs | 無（純文生圖） |
| recommended | 否 |
| strengths | 通義頂配檔;質感構圖再拉高,中文渲染頂級 |
| bestFor | 最講究的中文設計成品,Pro 不夠時的天花板 |
| 廠商 | 阿里通義 **Qwen-Image-Max** via fal.ai |
| MODELS 序 | 0-based index **21**（審計總表 **#22**） |

**一句話**：通義文生圖 **頂配天花板**——與 Pro 同價位敘事（$0.075／2 點）但定位更高保真；中文長版／書法成品在 Pro 仍不夠時升級。

## 2. 數值

| 項目 | 值 |
|------|-----|
| points | **2** |
| cost（目錄字串） | `$0.075/張` |
| 官方價與單位（目錄／生態／研究 #22） | **固定 $0.075／張**（非 MP；與 Qwen Image 2.0 Pro 同列） |
| 估值 NT$（USD_TO_TWD=31，×1 張） | $0.075 × 31 = **2.325** → 四捨五入 **2** 點 |
| 校準判定 | **≈**（與 Pro 同價；校準旗艦列） |
| estimatePoints | 扁平 **2** |

**數值落差（文件／產品級）**

- 目錄與 Pro 同為 **$0.075／2 點**——產品差異在品質檔位敘事，**非**站內計點差。
- `num_images` 1–4：站內不送 → 1 張；暴露多圖須 ×N。
- OpenAPI `prompt` **maxLength 800**（字元；比 Pro 卡常寫的長提示更緊）→ 超長中文海報可能被截／422；產品宜控長。
- **本輪禁止改 points**（維持 2）。

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| 靜態契約 L0 | **ok** |
| endpointOf | `getModel` → endpoint 即 id ✓ |
| input 16:9 | `{ prompt, image_size: "landscape_16_9" }` |
| input 9:16 | `{ prompt, image_size: "portrait_16_9" }` |
| input 1:1 | `{ prompt, image_size: "square_hd" }` |
| OpenAPI 對齊 | Queue OpenAPI 2026-08-05 **HTTP 200**：`QwenImageMaxTextToImageInput` required 僅 `prompt`；`image_size` enum 含站內三 preset；**有** `negative_prompt`（max 500）／`seed`／`enable_prompt_expansion` |
| supportsNegativePrompt | **true** ✓（allowlist 已收；單元測試覆蓋） |
| supportsSeed | **true** ✓（`SEED_SUPPORTED` 已收） |
| dry-run / live probe | **未跑**（R1 零 live） |
| 結論 | **ready-static-only**（契約綠；目錄 verified=true 但本輪無 live 覆核） |

### OpenAPI 摘要（`GET …/openapi.json?endpoint_id=fal-ai/qwen-image-max/text-to-image`）

- Paths：`POST /fal-ai/qwen-image-max/text-to-image`（queue）、status／cancel／result。
- **x-fal-metadata**：endpointId 同 id；about: *Generate images from text using Qwen Image Max.*
- Schema：`QwenImageMaxTextToImageInput`／Output
- **required**：`prompt`（string；description：中英；**Max 800 characters**）
- 可選：
  - `negative_prompt`：default `""`，max **500**（或 null）
  - `image_size`：default **`square_hd`**；enum `square_hd|square|portrait_4_3|portrait_16_9|landscape_4_3|landscape_16_9` 或 `{width,height}`
  - `enable_prompt_expansion`：default **true**
  - `seed`：integer 或 null
  - `enable_safety_checker`：default true
  - `sync_mode`：default false
  - `num_images`：1–4，default 1
  - `output_format`：jpeg|png|webp，default **png**
- **無** `num_inference_steps`／`guidance_scale`／`acceleration`（與 Qwen Image 2 Pro 公開 schema 欄位集合同構；勿誤傳 steps → 422）
- 站內 `input()` 只送 prompt + image_size；`generationCore` 在 allowlist 下另注 `negative_prompt`。

## 4. 底層

| 面向 | 說明 |
|------|------|
| 架構 | Qwen-Image **Max** 文生圖檔（統一生成家族；本端點無 image_url） |
| 條件編碼 | Qwen-VL 系 VLM（站內 profile `qwen-image` 經 `/^fal-ai\/qwen-image/` 匹配含 Max） |
| 生成骨幹 | 與 2.0 系同敘事：MMDiT／圖文 token 擴散（marketing；閉源細節未公開） |
| 提示擴寫 | 預設 `enable_prompt_expansion=true`（字卡精準場景可能改寫措辭） |
| 提示長度 | OpenAPI 明文 **prompt max 800 字元**——比「~1000 tokens」learn 文更硬；站內未截斷 |
| input 組裝 | `(p, f) => ({ prompt: p, image_size: imageSize(f) })` |
| 送出路徑 | `generationCore` → falSubmit(id)；禁忌 → `negative_prompt` |
| 與官方差異 | 官方 default `square_hd`；站內橫幅 **16:9** |
| 家族 | Max 本卡；Standard `qwen-image-2/text-to-image`（1 點）；Pro `qwen-image-2/pro/…`（2 點）；Edit／Trainer 另端 |

## 5. 站內點數路徑

```
UI / MCP / agent
  → prepare → est = 2（$0.075×31≈2.3）
  → reserveQuota(…, 2, …)
  → falSubmit("fal-ai/qwen-image-max/text-to-image")
  → 失敗 refund(…, 2, …)
```

| 檢查 | 結果 |
|------|------|
| 顯示／扣點／退點 | 皆 2 → 一致 |
| 與 cost 校準 | $0.075×31≈2.3 → 2 ≈ |
| verified true | 目錄已 true；本輪無 live 覆核，失敗仍應走退點 |

## 6. 暴露面

| 通路 | 是否暴露 | 備註 |
|------|:--------:|------|
| 模型選擇器（文生圖 flagship） | ✅ | 無 needs |
| tRPC / MCP 生成 | ✅ | id 全路徑 |
| Scene recipe `sc-cn-poster` | ✅ | **pickIds[2]**（Pro → Seedream v5 → **Max**） |
| Style showdown 國風 | ❌ | winner 混元、runner-up Pro；Max 不在軸上 |
| 禁忌 negative_prompt | ✅ | allowlist + generationCore |
| seed | ✅ | SEED_SUPPORTED；日常 UI 不強制 |
| enable_prompt_expansion | ❌ | 吃預設 true |
| num_images／output_format／自訂 WH | ❌ | 固定 1 張、png、preset |
| steps／guidance UI | ❌ | schema 無 |

**MCP 陷阱**：勿與 `qwen-image-2/pro` 路徑混淆（同價不同 id）；`sc-cn-poster` 第三順位。

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 最講究中文設計成品／Pro 不夠時 | ✅ 首選定位 | bestFor；天花板檔 |
| 中文長版海報（交付） | ✅ | `sc-cn-poster` pickIds[2] |
| 書法／密集字 | ✅ | 與 Qwen 系同優勢 |
| 日常草稿／量產 | △ | 貴；用 Standard 1 點 |
| 國風水墨第一選 | △ | recipe 首選混元 |
| 寫實人像宣傳 | △ | 非賣點 → Imagen／FLUX.2 pro |
| 系列 seed 重現 | △ | schema＋allowlist 有；UI 未暴露 |

bestFor **恰當**；無需來源。

## 8. 文件

| 來源 | 用途 |
|------|------|
| fal Queue OpenAPI | `…?endpoint_id=fal-ai/qwen-image-max/text-to-image`（本輪 **200**；`QwenImageMaxTextToImageInput`） |
| fal 模型頁／API | https://fal.ai/models/fal-ai/qwen-image-max/text-to-image （及 `/api`） |
| 站內 | `shared/models.ts`（目錄／allowlist）；`textEncoders.ts` qwen-image；`SCENARIO_RECIPES` sc-cn-poster |
| 研究 | `docs/research/model-deep-dive-2026-08/文生圖逐一研究.md` #22；姊妹卡 Pro／Standard |
| 測試 | `shared/models.test.ts`：`supportsNegativePrompt(qwen-image-max)=true` |

## 9. 建議動作

- [x] **維持** id＝endpoint；imageSize；points=2；negative／seed allowlist
- [ ] **L2 live** 覆核（目錄 verified=true 但本輪無 live；建議 L 佇列加鎖 probe）
- [ ] **可選 P2**：字卡進階關 `enable_prompt_expansion`（防擴寫改金句）
- [ ] **可選 P2**：站內 prompt 長度守衛（OpenAPI max **800** 字元）
- [ ] **可選 P3**：`textEncoders` label 對齊新世代 VLM 命名
- [ ] **勿**未改估點前暴露 `num_images`>1
- [ ] **勿**把 Max id 當 Pro／Standard 寫進 MCP 範例

**L0 結論**：靜態契約綠。剩餘：live 覆核、prompt_expansion／800 字元產品債。
