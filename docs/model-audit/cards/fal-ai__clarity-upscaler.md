# fal-ai/clarity-upscaler

> 審計：R2 · index **#60** · 模式 **static+research（零 live）** · 2026-08-05  
> slug：`fal-ai__clarity-upscaler`  
> 禁止改 `verified`／`points`（本卡僅建議）· **禁止 `--yes`**

## 1. 身分

| 項 | 值 |
|----|-----|
| **index** | 60 |
| **id** | `fal-ai/clarity-upscaler` |
| **endpoint** | `fal-ai/clarity-upscaler`（`endpointOf` = id，無 alias） |
| **label** | Clarity 創意放大 |
| **category** | `image-to-image` |
| **tier** | `flagship`（旗艦） |
| **kind** | `image` |
| **verified** | `true`（目錄已標；本回合**未** live 覆核） |
| **needs** | `image`（必填來源：要放大的圖） |
| **recommended** | `false` |
| **sourceHint** | 要放大的圖 |
| **strengths** | 社群最紅創意放大;放大同時補生細節到交付級 |
| **bestFor** | AI 圖放大 4K/印刷;含中文字的圖建議改用 Thera 忠實放大 |
| **vendor** | Clarity Upscaler（SD 系生成式超分 + ControlNet tile；fal Queue 託管） |

**一句話**：**生成式創意放大器**——必填 `image_url`，以 denoise（`creativity`）與 ControlNet（`resemblance`）在「補細節 vs 忠於原圖」間權衡；站內固定送 **`creativity: 0.35`**（對齊官方預設、偏保守防中文亂碼）。按 **$0.03/MP** 計費，**目標 4K（~8MP）實價約 $0.24 ≈ 7–8 點**，但目錄 **points=1** 與情境「AI 圖放大到 4K」嚴重低估。

## 2. 數值

| 項目 | 值 | 來源／算法 |
|------|-----|------------|
| **points（目錄）** | **1** | `shared/models.ts` 手填；`realPricePoints` 覆寫後仍 1 |
| **cost（目錄）** | `$0.03/MP(放大到 4K 約 $0.24/張)` | 括號已自承 4K 實價 |
| **官方／生態價** | **$0.03 / megapixel** | `docs/fal生態研究.md` ✅已查證；與 cost 主句一致 |
| **parseRealCost** | `usdMid=0.03` · `multiplier=1` · `×1MP（16:9 標準輸出 ≈ 1MP）` | 機械解析**只取 1MP 基準**，忽略括號 4K 敘述 |
| **realPricePoints** | `max(1, round(0.03 × 1 × 31))` = `round(0.93)` = **1** | `USD_TO_TWD=31` |
| **estimatePoints()** | **1**（扁平） | UI／扣點／退點同口徑 |
| **校準報告** | **≈**（1 點 vs 估 0.9） | `docs/點數校準報告.md` 列「Clarity 創意放大」——**僅在 1MP 假設下 ≈** |
| **4K 實算（~8.3MP）** | USD ≈ **$0.249** · NT$ ≈ **7.7** · 合理點數 **≈ 8** | 3840×2160；與 cost 括號／生態「7–8 點」一致 |
| **預設 2×、來源 1MP** | 輸出 ≈ **4MP** · USD **$0.12** · NT$ ≈ **3.7** · 合理點數 **≈ 4** | OpenAPI `upscale_factor` default **2**（面積 ×4） |

**風險（未改 points）**：

1. **主情境倒掛（P0 計價）**：`sc-ai-upscale`／bestFor 皆寫「AI 圖放大到 4K/印刷」，目錄 cost 亦寫「4K 約 $0.24/張」，但 **扣 1 點**（≈ NT$1）→ 平台在 4K 路徑上約 **虧 6–7 點／張**。校準表「≈」是 **1MP 錯基準**，不能當 4K 安全背書。
2. **MP 進位／來源尺寸敏感**：站內不送 `upscale_factor` → 吃預設 2。小圖（≤0.25MP 輸入 → ~1MP 出）才接近 1 點；分鏡／海報常見 1MP+ 來源 → 帳單 4 點起跳。
3. **cost 字串內自相矛盾**：主句 $0.03/MP 正確；括號 4K $0.24 正確；**points=1 與括號衝突**——產品文案已揭示低估，數值層未跟上。
4. **與姊妹檔對照**：Topaz 影像放大（#61）points=**2**（按輸出 MP 分級，$0.08/24MP 起）；Recraft Creative Upscale 單價 $0.25 → **8 點**。Clarity 4K 實價與 Recraft Creative 同量級，卻標 1 點——**不合理**。

## 3. 連通與生成

| 項目 | 結果 | 說明 |
|------|------|------|
| **L0 靜態契約** | **ok** | id 唯一；`needs/points/cost/tier/verified/strengths/bestFor/sourceHint/input` 齊 |
| **OpenAPI Queue** | **HTTP 200 · schema 有效** | `GET …/openapi.json?endpoint_id=fal-ai/clarity-upscaler` → `ClarityUpscalerInput`／`ClarityUpscalerOutput`；`x-fal-metadata.endpointId=fal-ai/clarity-upscaler` |
| **平台 metadata** | **HTTP 200 · active** | `api.fal.ai/v1/models?endpoint_id=…` · display_name **Clarity Upscaler** · category image-to-image · tags `upscaling` · license **commercial** · updated **2026-05-06** · description「high very fidelity」 |
| **L1 批次 probe** | **本輪未重跑** | 禁止 `--yes`；`docs/fal端點連通報告.md` 精簡表未列本 id；**非** 404 紀錄；OpenAPI＋metadata 雙 200 |
| **dry-run verify** | **拒絕（正確）** | `npx tsx scripts/verify-models.ts --probe "fal-ai/clarity-upscaler"` → needs=image 擋下；**未**加 `--yes` |
| **L2／L4 live** | **未跑** | 須站內素材或合法 `image_url` 單次生成；**禁止** 空跑 `--yes` |
| **輸出解析** | **契約 OK** | OpenAPI 回 `image`（必填）+ `seed` + `timings`；`extractResult` 支援 `result.image.url` |
| **結論** | **ready-static-only** | schema／required／input 對齊；**points 與 4K 主情境嚴重低估**（見 §2／§9）；live 品質與真實 MP 帳單待有圖實測 |

### OpenAPI 摘要（2026-08-05 本輪 curl）

- **required**：`["image_url"]`
- **order**：`image_url` → `prompt` → `upscale_factor` → `negative_prompt` → `creativity` → `resemblance` → `guidance_scale` → `num_inference_steps` → `seed` → `enable_safety_checker`
- **prompt**：string，default **`masterpiece, best quality, highres`**
- **upscale_factor**：number，default **2**，min 1，max **4**
- **negative_prompt**：default `(worst quality, low quality, normal quality:2)`
- **creativity**：number，default **0.35**，0–1（描述：denoise strength；越高越偏離 *prompt*）
- **resemblance**：number，default **0.6**，0–1（ControlNet 強度；越高越貼原圖）
- **guidance_scale**：default **4**，0–20
- **num_inference_steps**：default **18**，4–50
- **seed**：optional integer ≥0
- **enable_safety_checker**：default **true**
- **Output**：`image` + `seed` + `timings`（皆 required）
- **Queue**：`https://queue.fal.run` · paths `/fal-ai/clarity-upscaler` + status／cancel／result

## 4. 底層邏輯

### 4.1 產品能力（官方／生態）

- **定位**：社群最紅的 **SD 底生成式放大器**——放大同時 **補生** 皮膚／材質／微細節，把 AI 分鏡／海報／縮圖拉到交付級（4K／印刷）。
- **creativity vs resemblance**（生態敘事）：creativity 低＝較乾淨忠實；creativity 高＝補細節但易偏離原圖（含 **中文字重繪成亂碼**）。resemblance 高＝ControlNet 鎖原結構。
- **OpenAPI 語意註記**：schema 寫 creativity 越高越偏離 *prompt*（denoise）；產品／社群常把它理解成「對原圖的創造力」。站內固定 0.35＝官方 default，屬保守檔（註解：產品建議 #13 防中文亂碼）——**正確產品決策**。
- **vs 忠實型**：字卡／中文細字應走 **Thera／AuraSR／Topaz Standard**，非本模。
- **vs 舊版**：`fal-ai/creative-upscaler` 定位重疊且較舊；新專案優先 Clarity。
- **vs Crystal**（`clarityai/crystal-upscaler`）：Crystal 人像特化；Clarity 通用創意放大。

### 4.2 站內 `input()` 組裝

```ts
// shared/models.ts ~L718–725
// 產品建議 #13 保守檔:creativity 壓低,防中文字被重繪成亂碼
input: (_p, _f, s) => ({ image_url: s, creativity: 0.35 }),
```

| 官方 property | 站內 | 備註 |
|---------------|------|------|
| `image_url` | ✅ `s` | 與 `needs:image`、缺來源攔截一致 |
| `creativity` | ✅ **0.35** | 對齊 OpenAPI default；保守防中文亂碼 |
| `prompt` | ❌ 丟棄 `_p` | 吃官方 default「masterpiece…」；使用者提示**不進** payload |
| `upscale_factor` | ❌ 不送 | 吃預設 **2**（最大可 4） |
| `resemblance` | ❌ 不送 | 吃 **0.6** |
| `negative_prompt` | ❌ 不送 | 吃官方 default 品質負向 |
| `guidance_scale`／`num_inference_steps` | ❌ | 4／18 |
| `seed` | ❌ | schema 有；**不在** `SEED_SUPPORTED` |
| `enable_safety_checker` | ❌ | true |
| 畫幅 `f` | ❌ `_f` 忽略 | 無 aspect；尺寸＝來源 × upscale_factor |

### 4.3 架構／分詞

- `modelMechanicsFor` → **family: `unknown`**（未收錄 Clarity 專節）。
- `textEncoderProfileFor` → unknown；站內提示窗對 payload **預設無語意作用**（prompt 未映射）。
- 實務：使用者應上傳**要放大的 AI 圖**，不是只寫「放大到 4K」；若未來暴露 prompt，可描述材質（skin pores, fabric weave）輔助補細節。

### 4.4 已知契約／文案缺口

1. **points=1 vs 4K 主情境（P0）**：cost 括號、生態研究、配方 why 皆指向 4K／$0.24，扣點卻 1——**建議調點**（§9）。
2. **parseRealCost 1MP 基準誤導校準表**：MP 放大器應用「典型輸出 MP」或「來源×factor²」估點，不宜套文生圖 1MP。
3. **prompt 可選能力未暴露（P3）**：生成式放大器本可吃描述性 prompt；現全丟棄，僅靠 default + creativity。
4. **seed／negative 未進 allowlist（P3）**：schema 完整支援；批次可重現與品質負向可後補。
5. **upscale_factor 未暴露（P2）**：印刷 4× 需 factor=4 時面積 ×16，帳單暴衝；UI 無倍率旋鈕也無估點連動。
6. **strengths 未寫「生成式／中文風險」**：bestFor 有 Thera 提示；strengths 偏行銷「交付級」，風險靠 bestFor／配方 why。

## 5. 點數路徑

| 步驟 | 行為 |
|------|------|
| 估點 | `estimatePoints` → **1**（`realPricePoints`→1） |
| 預覽 | `prepareGenerationRequest` 只組裝、**不扣點** |
| 缺來源 | needs=image 且無來源 → `BAD_REQUEST`（sourceHint：要放大的圖） |
| 扣點 | `reserveQuota(…, est=1)` |
| 失敗／無成品 | 退點 |
| BYOK | 平台點數可為 0（既有路徑；本卡未 live） |
| 供應商實帳 | 按**輸出** MP × $0.03（與站內 1 點**脫鉤**） |

**一致性（站內帳本）**：顯示 1 ＝ 目錄 points ＝ reserve／refund——**內部自洽**。  
**一致性（對 fal 成本）**：**不自洽**——4K／預設 2× 常規用途下平台大幅補貼。L2 校準「≈」僅在錯誤 1MP 假設下成立 → **建議調 points**，非維持。

## 6. 暴露面

| 面 | 是否暴露 | 說明 |
|----|----------|------|
| 模型目錄／工作台選模 | ✅ | `image-to-image` · flagship · 可搜 label／id |
| 情境配方 | ✅ | **`sc-ai-upscale`** pickIds[0]（主選）；pick[1]=Topaz image |
| 工作流 presets | ❌（未見硬編碼） | 無固定步綁本 id |
| MCP `find_model` | ✅ | 全 MODELS 可查 |
| MCP `submit_generation` | ✅ | 與網頁同路徑；**必須**來源圖 |
| 助手代操 | ❌ | `needs` → 助手策略不代操 i2i 來源模（正確） |
| 負向提示 UI | ❌ | schema 有；`supportsNegativePrompt` **false** |
| Seed UI | ❌ | schema 有；`supportsSeed` **false** |
| `verify-models --probe` | ❌ | needs 拒絕；**禁止** `--yes` 空跑 |

**誤用面**：

- 當「字卡／書法／精細中文 4K」→ **Thera／AuraSR**（`sc-text-upscale`），非本模（即使 creativity=0.35 仍有生成式風險）。
- 當「印刷級要自然無 AI 塑膠感」→ **Topaz**（`sc-print-upscale` 敘事／本配方備選）。
- 當「人像極致臉部微細節」→ **Crystal**（`clarityai/crystal-upscaler`）。
- 當「只要便宜粗放」→ **ESRGAN／SeedVR2 image／Recraft Crisp**。
- 期待「我打的提示詞會影響放大」→ 現況 **prompt 丟棄**。
- 無來源圖 → needs／助手雙擋。

## 7. 情境與可用性

| 情境 | 適配 | 說明 |
|------|:----:|------|
| AI 分鏡／海報放大到交付級（補細節） | ✅ | bestFor／`sc-ai-upscale` 核心；**注意實價 ≫ 1 點** |
| 含中文字的字卡／海報 | ⚠→❌ | bestFor 已導 Thera；creativity 0.35 僅降風險非消除 |
| 印刷級「自然無塑膠感」 | △ | 可；更穩選 Topaz |
| 大量批次粗放 | ❌ 貴 | 應用 ESRGAN／SeedVR2／Crisp |
| 老照片修復 | ❌ | photo-restoration／CodeFormer |
| 無來源圖 | ❌ | needs 攔截 |
| 中文長提示 | n/a | prompt 不進 payload |

**recommended=false**：合理——垂直放大器，由 **`sc-ai-upscale` 主選**導流即可，不必進全域 recommended。  
**配方文案**：why 寫「Clarity 放大同時補生細節…」正確；UI 若顯示「旗艦・1 點」會讓志工以為 4K 印刷只要 1 點——**與 cost 括號矛盾，應隨調點修正**。

## 8. 文件

| 資源 | URL／路徑 | 狀態 |
|------|-----------|------|
| fal Playground | https://fal.ai/models/fal-ai/clarity-upscaler | 公開頁存在；HTML 常被挑戰擋爬 |
| fal API | https://fal.ai/models/fal-ai/clarity-upscaler/api | 文件入口 |
| OpenAPI Queue | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/clarity-upscaler | **本機 200**，`ClarityUpscalerInput` 完整 |
| 平台 metadata | `https://api.fal.ai/v1/models?endpoint_id=fal-ai/clarity-upscaler` | **200** · status **active** · commercial |
| Queue base | `https://queue.fal.run` | OpenAPI servers |
| 站內目錄 | `docs/模型目錄.md` | 旗艦 · **1 點** · $0.03/MP(4K≈$0.24) · 情境表同 |
| 生態研究 | `docs/fal生態研究.md` §放大與修復 | ✅ $0.03/MP；4K≈$0.24≈**7–8 點**；中文警告 |
| 點數校準 | `docs/點數校準報告.md` | ≈（**1MP 基準**；對 4K **無效**） |
| 端點連通總表 | `docs/fal端點連通報告.md` | 本輪精簡表未列；無 404 |
| 結果抽取 | `server/services/fal.ts` `extractResult` | 支援 `image.url` |
| 站內註冊 | `shared/models.ts` L718–725 | input：`image_url` + `creativity:0.35` |
| 情境配方 | `SCENARIO_RECIPES` **`sc-ai-upscale`** | pick[0]=本 id；pick[1]=Topaz |

## 9. 建議動作

| 優先 | 動作 | 說明 |
|------|------|------|
| **P0** | **建議調 points → 4（基準）或 8（4K 敘事）** | **基準 4**：預設 `upscale_factor=2` × 典型 AI 圖 ~1MP 輸入 → ~4MP 出 → $0.12 ≈ NT$3.7 → **4 點**。**敘事 8**：與 cost 括號／生態「4K≈$0.24≈7–8 點」對齊。二選一後同步 `docs/模型目錄.md` 情境表「1 點」文案。**本卡不改碼**。 |
| **P0** | 校準腳本／`parseRealCost` 認知 | MP 放大器勿默認 ×1MP；至少註記「估點僅 1MP，實際隨輸出 MP」 |
| — | **維持** verified=true | 本回合零 live；OpenAPI＋metadata active＋生態 ✅；不因未 live 改 false |
| — | **維持** id＝endpoint、`needs=image`、`creativity:0.35` | required 對齊；保守 creativity 正確 |
| — | **維持** `sc-ai-upscale` 主選 | 能力定位正確；調點後更名副其實 |
| P2 | UI：倍率／預估 MP 提示 | 暴露或至少說明「預設 2×；4K 帳單約 $0.24」 |
| P3 | 可選：映射 `prompt`（使用者描述材質） | 現 `_p` 丟棄；生成式放大器可受惠 |
| P3 | 可選：`SEED_SUPPORTED`／`NEGATIVE_PROMPT_SUPPORTED` 收本 id | schema 已有；input 透傳 |
| 後續 live | 站內上傳 ~1MP AI 圖 → 確認扣點、輸出約 2× 邊長、中文 A/B（0.35 vs 更高 creativity） | **勿** `verify-models --probe --yes`；走 generate |
| 後續 L1 | `probe-fal-endpoints` 對 i2i | 預期缺 image_url → 422＝連通 |

### 勾選摘要（審計結論）

- [ ] **維持**（點數與 4K 主情境／cost 括號衝突——**不**勾維持 points）
- [x] **調 points** — **建議 4（預設 2×／~1MP 源）或 8（4K 敘事）**；本回合僅建議、未改 `models.ts`
- [ ] 修 input/id（required＋creativity 已正確；prompt／factor 為可選增強）
- [ ] verified 變更（禁止本回合改；現為 true）
- [ ] 下架或隱藏

**總評**：目錄契約與官方 OpenAPI **required／creativity 預設對齊良好**，`sc-ai-upscale` 主選定位正確，輸出 `image` 可解析，needs 守門正確，保守 `creativity:0.35` 是正確的中文風險緩解。主要殘差：**points=1 對旗艦 4K／印刷主情境嚴重偏便宜**（cost 字串與生態研究已自證 $0.24／張），校準表 1MP「≈」誤導，倍率／prompt／seed 未暴露，live 未跑。結論：**建議調 points**，列 **ready-static-only**（連通契約就緒；計價待人審調點）。

---

### 本回合證據清單

1. OpenAPI Queue 2026-08-05：`endpoint_id=fal-ai/clarity-upscaler` → HTTP 200 · `ClarityUpscalerInput`（required `image_url`；creativity default **0.35**；upscale_factor default **2** max 4）／`ClarityUpscalerOutput`（image+seed+timings）  
2. fal metadata API：status **active**、display_name Clarity Upscaler、tags upscaling、license commercial、updated 2026-05-06  
3. `shared/models.ts` L718–725 + `parseRealCost`／`realPricePoints`／`estimatePoints` 本機 tsx → 皆 **1**；input 固定 creativity 0.35  
4. `SCENARIO_RECIPES` **`sc-ai-upscale`** pickIds[0]=本 id；`SEED_SUPPORTED`／`NEGATIVE_PROMPT_SUPPORTED` 不含  
5. `docs/fal生態研究.md`：$0.03/MP、4K≈$0.24≈**7–8 點**、中文 creativity 警告  
6. `docs/點數校準報告.md`：≈ 於 1MP 假設；`docs/模型目錄.md` 情境表標「1 點」  
7. dry-run：`verify-models.ts --probe` → needs=image 正確拒絕；**未**使用 `--yes`  
