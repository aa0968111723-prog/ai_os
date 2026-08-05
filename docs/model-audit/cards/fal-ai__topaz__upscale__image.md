# fal-ai/topaz/upscale/image

> 審計：R2 · index **#61** · 模式 **static+research（零 live）** · 2026-08-05  
> slug：`fal-ai__topaz__upscale__image`  
> 禁止改 `verified`／`points`（本卡僅建議）· **禁止 `--yes`**

## 1. 身分

| 項 | 值 |
|----|-----|
| **index** | 61 |
| **id** | `fal-ai/topaz/upscale/image` |
| **endpoint** | `fal-ai/topaz/upscale/image`（`endpointOf` = id，無 alias） |
| **label** | Topaz 影像放大 |
| **category** | `image-to-image` |
| **tier** | `flagship`（旗艦） |
| **kind** | `image` |
| **verified** | `true`（目錄已標；本回合**未** live 覆核） |
| **needs** | `image`（必填來源：要放大的圖） |
| **recommended** | `false`（未在 MODELS 顯式設 true） |
| **sourceHint** | 要放大的圖 |
| **strengths** | 業界標準照片級放大;自然無 AI 塑膠感,印刷首選 |
| **bestFor** | 海報、展場輸出等印刷級大尺寸放大 |
| **vendor** | Topaz Labs（照片級超分／增強家族；fal Queue 託管） |

**一句話**：**印刷級照片放大器**——必填 `image_url`，官方預設 **`model=Standard V2`**、**`upscale_factor=2`**、**`face_enhancement=true`**；按**輸出 MP 分級**計費（基準 ≤24MP **$0.08／張**）。站內只送 `image_url`，吃全套預設；**points=2** 錨在 24MP 基準，與校準 **≈** 一致。

## 2. 數值

| 項目 | 值 | 來源／算法 |
|------|-----|------------|
| **points（目錄）** | **2** | `shared/models.ts` 手填；`realPricePoints` 覆寫後仍 2 |
| **cost（目錄）** | `按輸出解析度分級:≤24MP $0.08/張、≤48MP $0.16/張、≤96MP $0.32/張,最高 512MP $1.36/張(基準 24MP $0.08)` | 分級階梯完整 |
| **生態研究交叉價** | 約 **$0.05／24MP 起**（鏡站；文案註「fal 官方價未直接查到」） | `docs/fal生態研究.md`；與目錄 **$0.08** 有落差 |
| **parseRealCost** | `usdMid=0.08` · `multiplier=1` · `×1（每次一件）` | 只取字串**第一個** `$0.08`；**忽略**後續 48／96／512MP 階梯 |
| **realPricePoints** | `max(1, round(0.08 × 1 × 31))` = `round(2.48)` = **2** | `USD_TO_TWD=31` |
| **estimatePoints()** | **2**（扁平） | UI／扣點／退點同口徑 |
| **校準報告** | **≈**（2 點 vs 估 2.5） | `docs/點數校準報告.md`「Topaz 影像放大」 |
| **4K 輸出（~8.3MP）** | 落在 **≤24MP** 檔 → USD **$0.08** · 合理點數 **2** | 與 points **對齊**（對比 Clarity 4K 嚴重低估） |
| **預設 2×、來源 ~1MP** | 輸出 ~4MP ≤24MP → **$0.08 → 2 點** | 主路徑安全 |
| **預設 2×、來源 ~12MP 相機檔** | 輸出 ~48MP → 官方 **$0.16** · 合理 **≈5 點**；站內仍扣 **2** | 高解析源風險（見下） |

**階梯實算（Standard 基準價，×31 後四捨五入）：**

| 輸出檔 | USD | NT$ | 合理點 | 站內扣 |
|--------|-----|-----|--------|--------|
| ≤24MP | $0.08 | 2.48 | **2** | **2** ✅ |
| ≤48MP | $0.16 | 4.96 | **5** | 2 ⚠ |
| ≤96MP | $0.32 | 9.92 | **10** | 2 ⚠ |
| 最高 512MP | $1.36 | 42.16 | **42** | 2 ⚠ |

**模型倍率（OpenAPI 描述）**：新增生成系權重帳單高於 base——**Wonder 3.5 ×2**、**Bloom 2 ×8**。站內不送 `model` → 吃 **Standard V2（×1）**，現況**不**觸發倍率。

**風險（未改 points）**：

1. **主情境對齊良好（與 Clarity 對照）**：`sc-print-upscale`／bestFor「印刷級大尺寸」、4K／典型 2× AI 圖皆落在 ≤24MP → **2 點合理**；不像 Clarity points=1 vs 4K $0.24。
2. **高解析源 × factor 階梯風險（P2 計價）**：12MP 原圖預設 2× → ~48MP → 實帳 $0.16，平台扣 2 點約 **虧 ~3 點／張**；`upscale_factor` 最大 **4** 時面積 ×16，更容易跳檔。
3. **parseRealCost 只錨首個 $0.08**：階梯與模型倍率無法機械反映；校準表「≈」僅對 **24MP 基準**有效。
4. **生態 $0.05 vs 目錄 $0.08**：鏡站較低；以目錄階梯＋校準表為準；後續可對帳（**不構成改 points 的充分條件**）。
5. **face_enhancement 預設 true**：人像印刷有利；純風景／字卡亦可能多做臉部路徑（算力／風格微差），站內無法關。

## 3. 連通與生成

| 項目 | 結果 | 說明 |
|------|------|------|
| **L0 靜態契約** | **ok** | id 唯一；`needs/points/cost/tier/verified/strengths/bestFor/sourceHint/input` 齊 |
| **OpenAPI Queue** | **HTTP 200 · schema 有效** | `GET …/openapi.json?endpoint_id=fal-ai/topaz/upscale/image` → `TopazUpscaleImageInput`／`TopazUpscaleImageOutput`；`x-fal-metadata.endpointId=fal-ai/topaz/upscale/image` · about **Upscale Image** |
| **平台 metadata** | **HTTP 200 · active** | `api.fal.ai/v1/models?endpoint_id=…` · display_name **Topaz** · category image-to-image · tags `image-to-image` · license **commercial** · updated **2026-05-26** · description「powerful and accurate topaz image enhancer」 |
| **L1 批次 probe** | **本輪未重跑** | 禁止 `--yes`；`docs/fal端點連通報告.md` 精簡表未列本 id；**非** 404 紀錄；OpenAPI＋metadata 雙 200 |
| **dry-run verify** | **拒絕（正確）** | `npx tsx scripts/verify-models.ts --probe "fal-ai/topaz/upscale/image"` → needs=image 擋下；**未**加 `--yes` |
| **L2／L4 live** | **未跑** | 須站內素材或合法 `image_url` 單次生成；**禁止** 空跑 `--yes` |
| **輸出解析** | **契約 OK** | OpenAPI 回 `image`（`File`：required `url` + content_type／file_name／file_size）；`extractResult` 支援 `result.image.url` |
| **結論** | **ready-static-only** | schema／required／input 對齊；**基準檔 points≈**；高階梯／生成系 model 毛利風險待 UI 或 live 對帳 |

### OpenAPI 摘要（2026-08-05 本輪 curl）

- **required**：`["image_url"]`
- **order**：`image_url` → `model` → `upscale_factor` → `crop_to_fill` → `output_format` → `subject_detection` → `face_enhancement` → `face_enhancement_creativity` → `face_enhancement_strength` → `sharpen` → `denoise` → `fix_compression` → `strength` → `creativity` → `texture` → `prompt` → `autoprompt` → `color_preservation` → `detail` → `enhancement_strength`
- **model**：string enum，default **`Standard V2`**  
  Precision：`Standard V2`、`High Fidelity V2`、`Low Resolution V2`、`CGI`、`Text Refine`  
  Generative：`Wonder 3.5`、`Wonder 3`、`Wonder`、`Standard MAX`、`Redefine`、`Recovery V2`、`Recovery`  
  Creative：`Bloom 2`  
  （描述：Wonder 3.5 **2×** 價、Bloom 2 **8×** 價）
- **upscale_factor**：number，default **2**，min 1，max **4**
- **face_enhancement**：boolean，default **true**（standard enhance／Recovery V2）
- **face_enhancement_creativity**：default **0**；**face_enhancement_strength**：default **0.8**
- **subject_detection**：`All`｜`Foreground`｜`Background`，default **All**
- **output_format**：`jpeg`｜`png`，default **jpeg**
- **crop_to_fill**：default **false**
- **prompt**：僅 **Redefine**（max 1024）；**autoprompt**：Redefine／Bloom 2
- **creativity／texture／denoise／sharpen／fix_compression／strength／detail／enhancement_strength／color_preservation**：依 model 子集適用
- **Output**：`image` only（**無** seed）
- **Queue**：`https://queue.fal.run` · paths `/fal-ai/topaz/upscale/image` + status／cancel／result

## 4. 底層邏輯

### 4.1 產品能力（官方／生態）

- **定位**：Topaz Labs **照片級超分／增強**——強調自然、少「AI 塑膠感」，印刷／展場交付首選；與站內 `fal-ai/topaz/upscale/video` 同門。
- **家族分層**（OpenAPI 文案）：
  - **Precision（Standard V2 等）**：多數實拍／生成圖的忠實放大；Text Refine 偏字形銳利。
  - **Generative（Wonder／Redefine／Recovery…）**：補細節、救極低清；帳單可加價。
  - **Creative（Bloom 2）**：AI 生成圖創意放大；**8×** base 價。
- **vs Clarity**：Clarity 是 SD 底**生成式**補細節（creativity 風險改中文）；Topaz Standard 偏**照片增強**，中文相對較安全（生成系 model 仍有改字風險）。
- **vs Thera／AuraSR**：字卡／書法首選仍 `sc-text-upscale`；Topaz Text Refine 可作備援但站內未選 model。
- **vs SeedVR2 image**：SeedVR2 極省／可到 10K，略帶 AI 感；Topaz 留關鍵印刷成品（`sc-print-upscale` why 一致）。
- **vs Crystal**：Crystal 人像微細節特化；Topaz 為通用印刷旗艦（`sc-portrait-upscale` 備選）。

### 4.2 站內 `input()` 組裝

```ts
// shared/models.ts ~L727–732
input: (_p, _f, s) => ({ image_url: s }),
```

| 官方 property | 站內 | 備註 |
|---------------|------|------|
| `image_url` | ✅ `s` | 與 `needs:image`、缺來源攔截一致 |
| `model` | ❌ 不送 | 吃 **Standard V2**（印刷敘事正確） |
| `upscale_factor` | ❌ 不送 | 吃預設 **2**（最大 4） |
| `face_enhancement` | ❌ 不送 | 吃 **true**（人像友善） |
| `face_enhancement_*` | ❌ | creativity 0／strength 0.8 |
| `output_format` | ❌ | jpeg |
| `subject_detection` | ❌ | All |
| `prompt`／`creativity`／`autoprompt` 等 | ❌ | 僅生成系；`_p` **丟棄**（Standard 不需 prompt） |
| 畫幅 `f` | ❌ `_f` 忽略 | 尺寸＝來源 × factor；無 aspect |
| `seed` | 無此欄 | 不在 `SEED_SUPPORTED`（正確） |
| `negative_prompt` | 無此欄 | 不在 `NEGATIVE_PROMPT_SUPPORTED`（正確） |

### 4.3 架構／分詞

- `modelMechanicsFor` → **family: `unknown`**（未收錄 Topaz 專節）。
- `textEncoderProfileFor` → unknown；提示窗對 payload **無語意作用**（Standard 路徑）。
- 實務：上傳**要放大的圖**；若未來暴露 Redefine／Bloom，才需把 `_p` 映射到 `prompt`。

### 4.4 已知契約／文案缺口

1. **高階梯扁平 2 點（P2）**：48MP／96MP／512MP 與 Bloom 8× 無法反映；主情境 ≤24MP 仍 **維持 2** 合理。
2. **倍率未暴露（P2）**：印刷要 4× 時帳單／品質無 UI 旋鈕；估點也不連動。
3. **model 未暴露（P3）**：Text Refine／High Fidelity／Recovery 等能力鎖在預設外；字卡精修、極低清救援需改碼或進階 UI。
4. **生態 $0.05 vs 目錄 $0.08（P3 對帳）**：不改 points；可統一文件口徑。
5. **strengths 未寫「預設 Standard V2 + face 開」**：敘事「無 AI 塑膠感」在 Standard 成立；若日後改 default model 需重審文案。

## 5. 點數路徑

| 步驟 | 行為 |
|------|------|
| 估點 | `estimatePoints` → **2**（`realPricePoints`→2） |
| 預覽 | `prepareGenerationRequest` 只組裝、**不扣點** |
| 缺來源 | needs=image 且無來源 → `BAD_REQUEST`（sourceHint：要放大的圖） |
| 扣點 | `reserveQuota(…, est=2)` |
| 失敗／無成品 | 退點 |
| BYOK | 平台點數可為 0（既有路徑；本卡未 live） |
| 供應商實帳 | 依**輸出 MP 階梯**（+ 可選 model 倍率）；與站內 2 點在 **>24MP** 脫鉤 |

**一致性（站內帳本）**：顯示 2 ＝ 目錄 points ＝ reserve／refund——**內部自洽**。  
**一致性（對 fal 成本）**：**基準 ≤24MP 自洽（≈）**；高階梯／Bloom 不自洽 → **建議維持 2**，另以 UI 警告或後續動態估點處理，**非**本回合調高全站錨點。

## 6. 暴露面

| 面 | 是否暴露 | 說明 |
|----|----------|------|
| 模型目錄／工作台選模 | ✅ | `image-to-image` · flagship · 可搜 label／id |
| 情境配方 | ✅ | **`sc-print-upscale`** pickIds[0]（主選）；**`sc-ai-upscale`** pick[1]；**`sc-portrait-upscale`** pick[1] |
| 工作流 presets | ❌（未見硬編碼） | 無固定步綁本 id |
| MCP `find_model` | ✅ | 全 MODELS 可查 |
| MCP `submit_generation` | ✅ | 與網頁同路徑；**必須**來源圖 |
| 助手代操 | ❌ | `needs` → 助手策略不代操 i2i 來源模（正確） |
| 負向提示 UI | ❌ | schema 無通用 negative；allowlist 無 |
| Seed UI | ❌ | schema 無 seed |
| `verify-models --probe` | ❌ | needs 拒絕；**禁止** `--yes` 空跑 |

**誤用面**：

- 當「字卡／書法／精細中文 4K」→ **Thera／AuraSR／Recraft Crisp**（`sc-text-upscale`），非本模主敘事（Standard 相對安全但仍非文字專用）。
- 當「AI 圖要補生細節到交付」→ **Clarity**（`sc-ai-upscale` 主選）；本模為備選「更自然少塑膠」。
- 當「人像極致臉部微細節」→ **Crystal** 主選；本模備選。
- 當「整批超大跨頁省錢」→ **SeedVR2 image**。
- 期待「我打的提示詞會影響」→ 現況 **prompt 丟棄**（Redefine 未啟用）。
- 無來源圖 → needs／助手雙擋。

## 7. 情境與可用性

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 印刷級大尺寸／展場（自然無塑膠感） | ✅ | bestFor／**`sc-print-upscale` 主選**；≤24MP 2 點合理 |
| AI 圖放大到 4K／印刷 | ✅ 備選 | `sc-ai-upscale` pick[1]；主選 Clarity 補細節 |
| 人像特寫極致放大 | ✅ 備選 | `sc-portrait-upscale` pick[1]；face_enhancement 預設開 |
| 含中文字字卡 | ⚠ 次選 | Standard 比創意型安全；首選 Thera |
| 大量批次粗放 | ❌ 貴 | ESRGAN／SeedVR2／Crisp |
| 老照片綜合修復 | ❌ | photo-restoration／CodeFormer |
| 無來源圖 | ❌ | needs 攔截 |
| 中文長提示 | n/a | prompt 不進 payload（Standard） |

**recommended=false**：合理——垂直印刷放大器，由 **`sc-print-upscale` 主選**（及另外兩配方備選）導流即可，不必進全域 recommended。  
**配方文案**：why「Topaz 業界標準照片級放大、自然無 AI 感，印刷首選」與 OpenAPI Standard V2 預設一致。

## 8. 文件

| 資源 | URL／路徑 | 狀態 |
|------|-----------|------|
| fal Playground | https://fal.ai/models/fal-ai/topaz/upscale/image | 公開頁存在；HTML 常被 Vercel 挑戰擋爬 |
| fal API | https://fal.ai/models/fal-ai/topaz/upscale/image/api | 文件入口 |
| OpenAPI Queue | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/topaz/upscale/image | **本機 200**，`TopazUpscaleImageInput` 完整 |
| 平台 metadata | `https://api.fal.ai/v1/models?endpoint_id=fal-ai/topaz/upscale/image` | **200** · status **active** · commercial · updated 2026-05-26 |
| Queue base | `https://queue.fal.run` | OpenAPI servers |
| 站內目錄 | `docs/模型目錄.md` | 旗艦 · **2 點** · 分級價 · 情境表三處引用 |
| 生態研究 | `docs/fal生態研究.md` §放大與修復 | ✅ 端點；價約 $0.05/24MP（鏡站）· Standard 中文較安全 |
| 點數校準 | `docs/點數校準報告.md` | **≈**（2 vs 2.5；錨 $0.08） |
| 端點連通總表 | `docs/fal端點連通報告.md` | 本輪精簡表未列；無 404 |
| 結果抽取 | `server/services/fal.ts` `extractResult` | 支援 `image.url`（File schema） |
| 站內註冊 | `shared/models.ts` L727–732 | input 僅 `image_url` |
| 情境配方 | `SCENARIO_RECIPES` **`sc-print-upscale`**／`sc-ai-upscale`／`sc-portrait-upscale` | 主選＋兩備選 |
| 姊妹卡 | `docs/model-audit/cards/fal-ai__clarity-upscaler.md`（#60） | 對照 4K 計價落差 |

## 9. 建議動作

| 優先 | 動作 | 說明 |
|------|------|------|
| — | **維持** points=2、cost 分級字串、tier=flagship | 基準 ≤24MP $0.08 → realPricePoints=2；校準 **≈**；4K／典型 2× 主情境對齊 |
| — | **維持** verified=true | 本回合零 live；OpenAPI＋metadata active＋生態收錄；不因未 live 改 false |
| — | **維持** id＝endpoint、`needs=image`、`input: { image_url }` | required 對齊；Standard V2 預設符合印刷敘事 |
| — | **維持** 三配方定位 | print 主選／ai 備選／portrait 備選正確 |
| P2 | UI：輸出 MP／來源×factor 提示 | 「預設 2×；輸出 >24MP 實帳可能 $0.16+，平台仍扣 2 點」——避免高解析源 silently 補貼 |
| P2 | 可選：暴露 `upscale_factor`（1–4） | 印刷倍率可選；估點仍可扁平或階梯表 |
| P3 | 可選：進階 model 檔（Standard／Text Refine／High Fidelity） | 字卡與專業片；Bloom／Wonder 須連動估點（×2／×8） |
| P3 | 對帳 cost | 生態 $0.05 vs 目錄 $0.08；**改字串不必改 points**（除非官方錨改） |
| 後續 live | 站內上傳 ~1MP 圖 → 確認扣 2、輸出約 2×、臉部增強體感 | **勿** `verify-models --probe --yes`；走 generate |
| 後續 L1 | `probe-fal-endpoints` 對 i2i | 預期缺 image_url → 422＝連通 |

### 勾選摘要（審計結論）

- [x] **維持**（點數／id／主 input 映射；基準檔 ≈）
- [ ] 調 points（主情境 ≤24MP **不需**調；高階梯屬風險註記非全站調高）
- [ ] 修 input/id（required 已正確；model／factor 為可選增強）
- [ ] verified 變更（禁止本回合改；現為 true）
- [ ] 下架或隱藏

**總評**：目錄契約與官方 OpenAPI **required／Standard V2 預設對齊良好**，`sc-print-upscale` 主選定位正確，輸出 `image`（File.url）可解析，needs 守門正確。**points=2** 錨 24MP 基準與 4K／日常 2× 路徑一致（對比 #60 Clarity 4K 低估），校準 **≈**。主要殘差：高解析源跳檔與生成系 model 倍率未反映、倍率／model UI 未暴露、生態鏡站價與目錄 $0.08 待對帳、live 未跑。結論：**維持**，列 **ready-static-only**。

---

### 本回合證據清單

1. OpenAPI Queue 2026-08-05：`endpoint_id=fal-ai/topaz/upscale/image` → HTTP 200 · `TopazUpscaleImageInput`（required `image_url`；model default **Standard V2**；upscale_factor default **2** max 4；face_enhancement default **true**；Wonder 3.5 2×／Bloom 2 8× 價註）／`TopazUpscaleImageOutput`（image File）  
2. fal metadata API：status **active**、display_name Topaz、license commercial、updated 2026-05-26  
3. `shared/models.ts` L727–732 + `parseRealCost`／`realPricePoints`／`estimatePoints` 本機 tsx → 皆 **2**；input 僅 `image_url`  
4. `SCENARIO_RECIPES` **`sc-print-upscale`** pick[0]；`sc-ai-upscale`／`sc-portrait-upscale` pick[1]；SEED／NEGATIVE allowlist 不含  
5. `docs/點數校準報告.md`：≈（2 vs 2.5）；`docs/fal生態研究.md` Topaz Image 列；`docs/模型目錄.md` 旗艦 2 點  
6. 姊妹 #60 Clarity：4K 實價 ~$0.24 對照本模 4K 仍 ≤24MP $0.08  
7. dry-run：`verify-models.ts --probe` → needs=image 正確拒絕；**未**使用 `--yes`  
