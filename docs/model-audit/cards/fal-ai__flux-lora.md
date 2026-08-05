# fal-ai/flux-lora

> slug: `fal-ai__flux-lora` · 審計 **#28** · R1 static+research · 2026-08-05  
> 本輪 **零 live／禁止 `--yes`**；未改 `verified`／`points`。  
> **needs=zip**（來源＝訓練成果 LoRA `.safetensors` URL，非任意 zip 上傳語意——UI 以 sourceHint 為準）。

## 1. 身分

| 欄位 | 值 |
|------|-----|
| 站內 id | `fal-ai/flux-lora` |
| 實際 endpoint | **同 id**（無 alias） |
| label | FLUX.1 掛 LoRA 生圖 |
| category / tier / kind | `text-to-image` · `economy` · `image` |
| verified | **true**（目錄；本輪無 live 覆核） |
| needs | **`zip`**（實為 LoRA 權重 URL；`sourceHint`：訓練成果 `.safetensors`） |
| recommended | 否 |
| strengths | 掛載訓練成果生圖的標準端點;fast-training/人像/turbo/krea 成果都在這用 |
| bestFor | 用自家風格 LoRA 出圖(提示詞須含觸發詞) |
| 廠商 | Black Forest Labs **FLUX.1 [dev]** + LoRA via fal.ai |
| MODELS 序 | 0-based index **27**（審計總表 **#28**） |

**一句話**：FLUX.1 掛自訓／社群 LoRA 的標準推論端——訓練器「另一半」；**必須**提供 `loras[].path`（站內 needs 擋空跑）；提示詞含觸發詞。

## 2. 數值

| 項目 | 值 |
|------|-----|
| points | **1** |
| cost（目錄字串） | `$0.035/MP` |
| 官方價 | **$0.035 per megapixel**（與 flux/dev 同級略高） |
| 估值 NT$（×1MP） | $0.035 × 31 = **1.085** → **1** 點 |
| 校準判定 | **≈** |
| estimatePoints | 扁平 **1** |

**數值落差**

- preset ≈1MP → 1 點合理；大圖自訂 WH 未暴露。
- `num_images` 1–4：不送 → 1。
- LoRA 檔本身**不**另計（與 flux-2/lora 逾 2GB 加價敘事不同）。
- **本輪禁止改 points**。

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| 靜態契約 L0 | **ok**（input 形狀） |
| endpointOf | 同 id ✓ |
| OpenAPI | **HTTP 200** · `FluxLoraInput` |
| required（官方） | 僅 **`prompt`**（`loras` 官方 default `[]`，**非** required） |
| 站內 needs | **`zip`** → 無 source 拒跑（產品強制掛 LoRA；比官方更嚴） |
| input 16:9 | `{ prompt, image_size: "landscape_16_9", loras: [{ path: s, scale: 1 }] }` |
| input 9:16 | `… portrait_16_9 …` |
| input 1:1 | `… square_hd …` |
| loras 項 | `LoraWeight`：**required `path`**；`scale` default 1，0–4 |
| supportsNegativePrompt | 站內 allowlist **true**；但 OpenAPI **無** `negative_prompt` 鍵 → **P1 矛盾**（見 §9） |
| supportsSeed | **true** ✓（schema 有 seed；allowlist 已收） |
| dry-run / live | **未跑**（needs；R1 零 live） |
| 結論 | **ready-static-only**（loras 結構綠；negative allowlist 與 schema 不一致） |

### OpenAPI 摘要（`GET …/openapi.json?endpoint_id=fal-ai/flux-lora`）

- Paths：`POST /fal-ai/flux-lora` …
- **x-fal-metadata**：about: *FLUX.1 [dev], next generation text-to-image model.*
- Schema：`FluxLoraInput`／`FluxLoraOutput`；`LoraWeight`
- **required**：`prompt`
- 可選：
  - `image_size`：default **`landscape_4_3`**（站內改 16:9／square_hd 等）
  - `loras`：array default `[]`；item `{ path` required, `scale` 0–4 default 1 `}`
  - `num_inference_steps`：default **28**，1–50
  - `guidance_scale`：default **3.5**，0–35
  - `seed`：integer 或 null
  - `acceleration`：`none`|`regular`，default none
  - `num_images`：1–4，default 1
  - `output_format`：jpeg|png，default **jpeg**
  - `enable_safety_checker`：default true
  - `sync_mode`：default false
- **無** `negative_prompt`（本輪 Queue OpenAPI 全 properties 確認；與研究「頁面有列」衝突——以 OpenAPI 為準寫契約）
- 站內：`input(p,f,s) => ({ prompt, image_size, loras: [{ path: s, scale: 1 }] })`；`generationCore` 在 allowlist 下**可能**另注 `negative_prompt`。

## 4. 底層

| 面向 | 說明 |
|------|------|
| 基座 | FLUX.1 **[dev]**（12B）+ 執行時合併 LoRA 權重 |
| 條件 | 與 flux/dev 同系（T5／CLIP 敘事）；中文長字卡弱 |
| LoRA | 多顆可 merge（站內目前只送 1 顆 scale=1） |
| 預設 | steps 28、CFG 3.5、acceleration none |
| input | 來源 URL → `loras[0].path`；觸發詞須在 **prompt** |
| 送出 | needs 擋空 source；助手因 needs 不代操（`assistantModel` 跳過） |
| 家族 | 本卡；`flux-2/lora`；SDXL `fal-ai/lora`；訓練器 fast-training／portrait／turbo／krea |

## 5. 站內點數路徑

```
UI（需選 LoRA 來源）/ MCP（需 sourceUrl）
  → needs 檢查：無 source → BAD_REQUEST
  → est = 1
  → reserveQuota(…, 1, …)
  → falSubmit("fal-ai/flux-lora") + loras[{path,scale:1}]
  → 失敗 refund
```

| 檢查 | 結果 |
|------|------|
| 顯示／扣點 | 1 一致 |
| 校準 | $0.035×31≈1.09 → 1 ≈ |
| 空 source | 拒跑不扣／或進 prepare 前失敗 |

## 6. 暴露面

| 通路 | 是否暴露 | 備註 |
|------|:--------:|------|
| 模型選擇器 | ✅ | needs=zip → UI 要來源 |
| tRPC generation | ✅ | 需 sourceUrl／asset |
| MCP | ✅ | 需帶來源；漏則錯誤 |
| 助手代操 | ❌ | needs → `assistantModel` undefined |
| 訓練器連動 | △ 產品 | 目錄有 trainer；資產自動回填屬另案 |
| seed | ✅ allowlist | 消融用 |
| negative_prompt | ⚠ | allowlist 有、OpenAPI 無 |
| 多 LoRA／scale UI | ❌ | 固定 1 顆 scale=1 |
| steps／CFG／acceleration | ❌ | 吃預設 |

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 自家風格／人物 LoRA 出圖 | ✅ **首選** | bestFor；觸發詞必備 |
| 訓練後接推論 | ✅ | 與 fast-training／portrait 配套 |
| 無 LoRA 純文生圖 | ❌ | 用 flux/dev；本端 needs 擋 |
| 中文長字卡 | ❌ | FLUX 底弱 → Qwen |
| 禁忌硬控 | ⚠ | allowlist 與 schema 矛盾 → 見 §9 |
| 多風格疊加 | △ | 官方可多 loras；站內只 1 |

## 8. 文件

| 來源 | 用途 |
|------|------|
| fal Queue OpenAPI | `…?endpoint_id=fal-ai/flux-lora`（**200**；`FluxLoraInput`） |
| fal 模型頁／API | https://fal.ai/models/fal-ai/flux-lora |
| 站內 | `shared/models.ts` needs+input；`generationCore` needs／negative；`models.test.ts` neg=true |
| 研究 | `文生圖逐一研究.md` #28；`fal生態研究.md` LoRA 推論 |
| 測試 | `assistant.test.ts`：flux-lora 不進助手代操 |

## 9. 建議動作

- [x] **維持** id＝endpoint；`loras: [{ path: s, scale: 1 }]`；points=1；needs 強制來源
- [ ] **P1（契約風險）**：Queue OpenAPI **無** `negative_prompt`，但 `NEGATIVE_PROMPT_SUPPORTED` **含**本 id → 有禁忌時 `generationCore` 會注入額外欄。建議擇一：  
  - (A) L2 實測：注入是否 422；若忽略則可維持；  
  - (B) 移出 allowlist + 改 `models.test.ts` 期望（與 AuraFlow 先例一致，**以 schema 為準**）  
  本輪 **未**改 allowlist（避免無 live 證據誤修；且非「required 未送」型 P0）。
- [ ] **P2**：needs 標籤 `zip` 易誤解 → 產品改 `lora`／沿用 sourceHint 文案
- [ ] **P3**：可選多 LoRA／scale UI
- [ ] **L2 live**（需合法 safetensors URL；單寫者加鎖；有 KEY 才跑）
- [ ] **勿**空 loras 當純 flux/dev（產品應引導換模）
- [ ] **勿**改 verified／points

**L0 結論**：endpoint／image_size／loras 結構綠；needs 比官方嚴屬產品。**唯一契約疑點**為 negative allowlist vs OpenAPI 無欄（P1）。其餘待 live。
