# fal-ai/hunyuan-image/v3

> slug: `fal-ai__hunyuan-image__v3` · 審計 **#23** · R1 static+research · 2026-08-05  
> 本輪 **零 live／禁止 `--yes`**；未改 `verified`／`points` 字面（見 §2 runtime）。  
> **P0 已修**：`endpoint` 覆寫 → `fal-ai/hunyuan-image/v3/text-to-image`（見 `broken.json` P0-FIXED）。

## 1. 身分

| 欄位 | 值 |
|------|-----|
| 站內 id | `fal-ai/hunyuan-image/v3` |
| 實際 endpoint | **`fal-ai/hunyuan-image/v3/text-to-image`**（`endpoint` 覆寫；`endpointOf` ≠ id） |
| label | Hunyuan Image 3.0(騰訊混元) |
| category / tier / kind | `text-to-image` · `flagship` · `image` |
| verified | **true**（目錄；本輪無 live 覆核） |
| needs | 無 |
| recommended | 否 |
| strengths | 騰訊混元;中文理解與藝術表現強,國風/書法/水墨題材佳 |
| bestFor | 國風禪意大圖、中文文化語境主視覺 |
| 廠商 | 騰訊 **混元 Hunyuan Image 3.0** via fal.ai |
| MODELS 序 | 0-based index **22**（審計總表 **#23**） |

**一句話**：騰訊混元旗艦文生圖——國風／書法／水墨與中文文化語境主視覺首選；**站內 id 短路徑 404，必須走 `…/v3/text-to-image` endpoint 覆寫**。

## 2. 數值

| 項目 | 值 |
|------|-----|
| points（MODELS 字面） | 原始手填曾見 **2**；`realPricePoints` 自 cost 機械覆寫後 **runtime = 3** |
| points（目錄／總表／pin） | **3**（`models.pricing.test.ts` 黃金釘；`_index` #23） |
| cost（目錄字串） | `$0.10/百萬像素(1MP 約一張，按輸出解析度計費)` |
| 官方價與單位 | **$0.10／MP**（按輸出解析度） |
| 估值 NT$（USD_TO_TWD=31，×1MP） | $0.10 × 31 = **3.1** → 四捨五入 **3** 點 |
| 校準判定 | **≈**（1MP 基準） |
| estimatePoints | runtime **3**（`realPricePoints` 解析 `/百萬像素` 類 cost） |

**數值落差**

- 站內 preset（16:9／9:16／1:1 HD 名）多落 ≈1MP 進位 → **3 點合理**。
- 若未來暴露自訂大圖 >1MP 而不動態估點 → **帳單低估**。
- `num_images` 1–4：不送 → 1 張。
- **本輪禁止改 points**（runtime 已 3；字面手填若仍 2 屬顯示債，B9 可對齊字面＝3 但不改計價邏輯）。

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| 靜態契約 L0 | **ok**（endpoint 覆寫後） |
| endpointOf | **`fal-ai/hunyuan-image/v3/text-to-image`** ✓ |
| OpenAPI 站內 id | `?endpoint_id=fal-ai/hunyuan-image/v3` → **HTTP 404** |
| OpenAPI 真 path | `?endpoint_id=fal-ai/hunyuan-image/v3/text-to-image` → **HTTP 200** |
| input 16:9 | `{ prompt, image_size: "landscape_16_9" }` |
| input 9:16 | `{ prompt, image_size: "portrait_16_9" }` |
| input 1:1 | `{ prompt, image_size: "square_hd" }` |
| OpenAPI 對齊 | `HunyuanImageV3TextToImageInput` required 僅 `prompt`；`image_size` enum 含站內三 preset |
| supportsNegativePrompt | **false**（站內 allowlist **未**收）——但 OpenAPI **有** `negative_prompt` → **P1 落差** |
| supportsSeed | **false**（allowlist 未收）——OpenAPI **有** `seed` → **P2** |
| dry-run / live | **未跑**（R1 零 live） |
| 結論 | **ready-static-only**（endpoint 已修；negative 未注入為產品／契約次級債） |

### OpenAPI 摘要（真 path）

- Paths：`POST /fal-ai/hunyuan-image/v3/text-to-image` …
- **x-fal-metadata**：endpointId=`fal-ai/hunyuan-image/v3/text-to-image`；about: *Generate Image V3*；playground 同真 path
- Schema：`HunyuanImageV3TextToImageInput`／Output
- **required**：`prompt`
- 可選：
  - `image_size`：default **`square_hd`**；enum 六 preset 或 `{width,height}`
  - `negative_prompt`：string default `""`
  - `seed`：integer 或 null
  - `num_inference_steps`：default **28**，1–50
  - `guidance_scale`：default **7.5**，1–20
  - `enable_prompt_expansion`：default **false**（與 Qwen 預設 true **相反**）
  - `enable_safety_checker`：default true
  - `output_format`：jpeg|png，default png
  - `num_images`：1–4，default 1
  - `sync_mode`：default false
- 站內只送 prompt + image_size；**不**送 negative（allowlist 漏）→ 世界觀禁忌僅移出正向。

## 4. 底層

| 面向 | 說明 |
|------|------|
| 架構 | 騰訊混元 Image 3.0 文生圖（閉源 API 表面） |
| 文字塔 | 站內 `textEncoders`：`/hunyuan/` → profile `hunyuan`，窗口**未公開** |
| 預設 steps／CFG | 28／7.5（偏標準擴散；站內不暴露） |
| 提示擴寫 | 預設 **關**（`enable_prompt_expansion=false`）——金句措辭較不易被 LLM 改寫 |
| input 組裝 | `(p, f) => ({ prompt: p, image_size: imageSize(f) })` |
| 送出路徑 | `falSubmit(endpointOf)` → **真 path**；id 短路徑不可直打 |
| 家族 | 本卡文生圖；影片／i2v／foley／lora-training 為 hunyuan-video 另系 |

## 5. 站內點數路徑

```
UI / MCP / agent
  → prepare → realPricePoints($0.10/MP) → est = 3
  → reserveQuota(…, 3, …)
  → falSubmit("fal-ai/hunyuan-image/v3/text-to-image")  // 非短 id
  → 失敗 refund(…, 3, …)
```

| 檢查 | 結果 |
|------|------|
| 顯示／扣點 | runtime points／est = **3** 一致 |
| 與 cost 校準 | $0.10×31≈3.1 → 3 ≈ |
| id≠endpoint | catalog 仍顯示短 id；提交走覆寫 ✓ |

## 6. 暴露面

| 通路 | 是否暴露 | 備註 |
|------|:--------:|------|
| 模型選擇器 flagship | ✅ | 無 needs |
| tRPC / MCP | ✅ | modelId 用**短 id**；後端 `endpointOf` 轉真 path |
| Scene recipe `sc-guofeng` | ✅ | **pickIds[0]**（國風首選） |
| Style showdown「國風/水墨/藝術」 | ✅ | **winnerId** |
| negative_prompt 注入 | ❌ | schema 有、allowlist 無 → 禁忌不進 negative |
| seed／steps／CFG／prompt_expansion | ❌ | 日常不暴露；expansion 官方預設 false |
| 短 id 直打 fal | 🔴 | OpenAPI／queue **404**——只能走 endpoint 覆寫 |

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 國風／水墨／禪意大圖 | ✅ **首選** | bestFor、sc-guofeng、showdown winner |
| 中文文化語境主視覺 | ✅ | strengths |
| 書法題材（藝術表現） | ✅ | 字準極限仍可能遜 Qwen 字卡主力 |
| 繁中金句卡第一選 | △ | 字卡 recipe 仍 Qwen；本檔藝術向 |
| 需禁忌硬控 | ⚠ | schema 可、站內未注入 → P1 |
| 英文設計海報 | △ | Ideogram／Recraft 更對 |

## 8. 文件

| 來源 | 用途 |
|------|------|
| fal Queue OpenAPI（真 path） | `…?endpoint_id=fal-ai/hunyuan-image/v3/text-to-image`（**200**） |
| 反例 | `…?endpoint_id=fal-ai/hunyuan-image/v3` → **404** |
| fal 模型頁 | https://fal.ai/models/fal-ai/hunyuan-image/v3/text-to-image |
| 站內 | `shared/models.ts` endpoint 覆寫；`SCENARIO_RECIPES` sc-guofeng；`STYLE_SHOWDOWNS` |
| broken.json | P0-FIXED：endpoint 覆寫 |
| 研究 | `文生圖逐一研究.md` #23；pricing pin 3 點 |

## 9. 建議動作

- [x] **P0-FIXED**：`endpoint: "fal-ai/hunyuan-image/v3/text-to-image"`（短 id 404）
- [x] **維持** `imageSize(f)`；runtime 點數 3≈$0.10/MP
- [ ] **P1**：將 `fal-ai/hunyuan-image/v3` 加入 `NEGATIVE_PROMPT_SUPPORTED`（OpenAPI 有欄；國風 recipe 應吃禁忌）
- [ ] **P2**：可選加入 `SEED_SUPPORTED`（schema 有 seed）
- [ ] **P3**：MODELS 字面 `points` 與 runtime 3 對齊（僅可讀性；禁止本輪當「改價」）
- [ ] **L2 live** 真 path probe（單寫者加鎖）
- [ ] **勿**在文件／MCP 範例教使用者 curl 短 id
- [ ] **勿**改 verified→false 僅因本輪未 live（既有 true 保留；人審覆核）

**L0 結論**：endpoint P0 已修、三比例 input 綠、計點 runtime 3≈。剩餘 negative allowlist 漏（P1）、seed（P2）、live 覆核。
