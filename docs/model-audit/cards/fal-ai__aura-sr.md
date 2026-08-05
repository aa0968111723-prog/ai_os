# fal-ai/aura-sr

> 審計：R2 · index **#62** · 模式 **static+research（零 live）** · 2026-08-05  
> slug：`fal-ai__aura-sr`  
> 禁止改 `verified`／`points`（本卡僅建議）· **禁止 `--yes`**

## 1. 身分

| 項 | 值 |
|----|-----|
| **index** | 62 |
| **id** | `fal-ai/aura-sr` |
| **endpoint** | `fal-ai/aura-sr`（`endpointOf` = id，無 alias） |
| **label** | AuraSR 忠實放大 |
| **category** | `image-to-image` |
| **tier** | `economy`（經濟） |
| **kind** | `image` |
| **verified** | `false`（目錄已標；本回合**未** live 覆核；**禁止**本卡改碼） |
| **needs** | `image`（必填來源：要放大的圖） |
| **recommended** | `false` |
| **sourceHint** | 要放大的圖 |
| **strengths** | fal 自研 GigaGAN 4x 忠實放大;不改臉不改字、少假影 |
| **bestFor** | 人物照、中文字卡的安全放大日常主力 |
| **vendor** | fal 自研 **AuraSR**（GigaGAN 系 4× 超解析；fal Queue 託管） |

**一句話**：免提示詞的 **固定 4× 忠實超解析**——必填 `image_url`，官方 **`upscale_factor` const=4**、checkpoint 預設 **v1**、重疊拼貼預設關；按**計算秒**計費，目錄敘事「約每張 1–2 點」、**points=2**。站內只送 `image_url`，不改臉不改字，是 `sc-text-upscale` 的經濟次選（主選 Thera）。

## 2. 數值

| 項目 | 值 | 來源／算法 |
|------|-----|------------|
| **points（目錄）** | **2** | `shared/models.ts` 手填；`realPricePoints` **null** → **不**覆寫 |
| **cost（目錄）** | `按計算秒計費(約每張 1–2 點)` | 無 `$` 金額 |
| **parseRealCost** | `usdMid=null` · `multiplier=null` · `單位「無 $ 金額」` | 本機 tsx 2026-08-05 |
| **realPricePoints** | **null** | 無法機械換算秒→張 |
| **estimatePoints()** | **2**（扁平） | UI／扣點／退點同口徑 |
| **生態研究交叉價** | 按計算秒（未見固定 MP 價，約每張 1–2 點）✅已查證 | `docs/fal生態研究.md` 與目錄一致 |
| **校準判定** | **需人工** | `docs/點數校準報告.md`「AuraSR 忠實放大 ⚠︎」 |

**風險（未改 points）**：

1. **計費單位是 GPU 計算秒**，非固定張價；超大圖 + `overlapping_tiles=true`（OpenAPI：去接縫但**推理時間約 ×2**）會拉長算時，理論上可突破 2 點——站內**不送** overlapping／checkpoint，吃預設（重疊關、v1），常規單張多半落在「1–2 點」敘事區間。
2. **無 `$` 字串** → 無法 `realPricePoints` 機械校準；括號「約每張 1–2 點」是產品敘事，非 contract 保證。
3. **固定 4× 面積 ×16**：來源若已是高解析（例如 2MP→32MP 輸出），算時與儲存成本高於小圖——points 仍扁平 2，屬緩衝假設，待 live 帳單對帳。
4. **與姊妹檔**：ESRGAN budget **1** 點（算秒、$0.00x/秒可解析但需人工）；Thera **1** 點（$0.0021/MP）；本模 **2** 點作「比 ESRGAN 材質更好、比 Thera 略貴的日常忠實檔」合理，**不構成改 points 的充分條件**。

## 3. 連通與生成

| 項目 | 結果 | 說明 |
|------|------|------|
| **L0 靜態契約** | **ok** | id 唯一；`needs/points/cost/tier/verified/strengths/bestFor/sourceHint/input` 齊 |
| **OpenAPI Queue** | **HTTP 200 · schema 有效** | `GET …/openapi.json?endpoint_id=fal-ai/aura-sr` → `AuraSrInput`／`AuraSrOutput`；`x-fal-metadata.endpointId=fal-ai/aura-sr` |
| **平台 metadata** | **HTTP 200 · active** | `api.fal.ai/v1/models?endpoint_id=…` · display_name **AuraSR** · category image-to-image · tags `upscaling`,`high-res` · license **commercial** · updated **2026-05-05** · date 2024-04-11 |
| **L1 批次 probe** | **本輪未重跑** | 禁止 `--yes`；`docs/fal端點連通報告.md` 精簡表未列本 id；**非** 404 紀錄；OpenAPI＋metadata 雙 200 |
| **dry-run verify** | **拒絕（正確）** | `npx tsx scripts/verify-models.ts --probe "fal-ai/aura-sr"` → needs=image 擋下；**未**加 `--yes` |
| **L2／L4 live** | **未跑** | 須站內素材或合法 `image_url` 單次生成；**禁止** 空跑 `--yes` |
| **輸出解析** | **契約 OK** | OpenAPI 回 `image`（必填）+ `timings`；`extractResult` 支援 `result.image.url`（`server/services/fal.ts`） |
| **結論** | **ready-static-only** | schema／required／input 對齊；算秒實帳與 v1/v2 品質差待有圖實測；verified 維持 false 等 L2 |

### OpenAPI 摘要（2026-08-05 本輪 curl）

- **required**：`["image_url"]`
- **order**：`image_url` → `upscale_factor` → `overlapping_tiles` → `checkpoint`
- **upscale_factor**：integer，**`const: 4`**，default **4**（描述 *More coming soon*——**固定 4× 邊長**，非 ESRGAN 可調 scale）
- **overlapping_tiles**：boolean，default **false**（true 去接縫、**推理時間約加倍**）
- **checkpoint**：enum **`v1`｜`v2`**，default **`v1`**（examples 常列 v2 在前，但 schema default 仍是 v1）
- **Output**：`image`（Image：url 必填 + 可選 width/height/…）+ `timings`（map，required）
- **無** `prompt`／`negative_prompt`／`seed`／`num_inference_steps`／`guidance_scale`／`face`
- **Queue**：`https://queue.fal.run` · paths `/fal-ai/aura-sr` + status／cancel／result

## 4. 底層邏輯

### 4.1 產品能力（官方／生態）

- **定位**：fal 自研 **GigaGAN 系** 超解析——**純放大、非生成式重繪**；生態敘事：v2 保留真實材質紋理、比 Real-ESRGAN **少假影**；免提示、「只是變大、最像原圖」時的**最佳性價比日常主力**。
- **固定 4×**：與 strengths「GigaGAN 4x」一致（不像 ESRGAN「x4plus 權重名」卻 default scale=2）。輸出邊長＝來源 ×4，面積 ×16。
- **中文字安全**：不重繪內容 → 字卡／書法推薦忠實型之一（`sc-text-upscale` pickIds[1]）；首選仍是 **Thera**（任意倍率、數學無鋸齒）。
- **vs Real-ESRGAN（#58）**：ESRGAN 更便宜（1 點）、可調 scale／face；AuraSR 材質／假影敘事更佳、固定 4×。
- **vs Clarity／Creative（#60 等）**：不創意補畫；含中文勿走高 creativity。
- **vs Topaz（#61）**：Topaz 印刷級自然感、按輸出 MP 分級；AuraSR 經濟日常 4×。
- **vs SeedVR2 image**：SeedVR2 極省／可到 10K、略帶 AI 感；「最貼原圖」選 AuraSR（生態 why 一致）。
- **vs Thera**：字卡首選 Thera（1 點）；AuraSR 人像／通用忠實 4× 與字卡次選。

### 4.2 站內 `input()` 組裝

```ts
// shared/models.ts ~L736–741
input: (_p, _f, s) => ({ image_url: s }),
```

| 官方 property | 站內 | 備註 |
|---------------|------|------|
| `image_url` | ✅ `s` | 與 `needs:image`、缺來源攔截一致 |
| `upscale_factor` | ❌ 不送 | 吃 **const／default 4**（無法改） |
| `overlapping_tiles` | ❌ 不送 | 吃 **false** → 可能有接縫、算時較短 |
| `checkpoint` | ❌ 不送 | 吃 **v1**（生態推 v2 材質——**產品未對齊敘事**，見 P3） |
| 提示詞 `p` | ❌ 丟棄 | **免提示詞** |
| 畫幅 `f` | ❌ `_f` 忽略 | 無 aspect 旋鈕；尺寸＝來源 ×4 |
| `seed`／`negative_prompt` | 無此欄 | 不在 SEED／NEGATIVE allowlist（正確） |

### 4.3 架構／分詞

- `modelMechanicsFor` → **family: `unknown`**（未收錄 AuraSR 專節；可接受）。
- `textEncoderProfileFor` → unknown；提示窗對 payload **無語意作用**。
- 實務：使用者應上傳**要放大的圖**，不是寫「放大到 4K」文字（倍率固定 4，非目標解析度 API）。

### 4.4 已知契約／文案缺口

1. **checkpoint 預設 v1 vs 生態「v2 材質更好」**（P3）：站內與 OpenAPI default 皆 v1；若產品文案強調 v2，應顯式送 `checkpoint: "v2"` 或 UI 開關。
2. **overlapping 未暴露**（P3）：大圖接縫風險；開則算時 ×2，與扁平 2 點假設衝突——若暴露須提示。
3. **cost 無 `$` 秒價**（P2）：無法機械校準；官頁被挑戰擋爬，未能本輪補精確 $/計算秒。
4. **verified=false**（預期）：needs=image、零 live；L2 有圖後再議升 true（**本卡不改**）。
5. **「日常主力」vs recommended=false**：合理——靠 `sc-text-upscale` 導流，不必全域 recommended。

## 5. 點數路徑

| 步驟 | 行為 |
|------|------|
| 估點 | `estimatePoints` → **2**（`realPricePoints` null → 手填 2） |
| 預覽 | `prepareGenerationRequest` 只組裝、**不扣點** |
| 缺來源 | needs=image 且無來源 → `BAD_REQUEST`（sourceHint：要放大的圖） |
| 扣點 | `reserveQuota(…, est=2)` |
| 失敗／無成品 | 退點 |
| BYOK | 平台點數可為 0（既有路徑；本卡未 live） |
| 供應商實帳 | 依 **GPU 計算秒**（+ overlapping 約 ×2）；與站內 2 點在超大圖路徑可能脫鉤 |

**一致性（站內帳本）**：顯示 2 ＝ 目錄 points ＝ reserve／refund——**內部自洽**。  
**一致性（對 fal 成本）**：**需人工**；敘事 1–2 點／張在預設（無重疊、固定 4×）下合理，**建議維持 2**，待 live 帳單對帳。

## 6. 暴露面

| 面 | 是否暴露 | 說明 |
|----|----------|------|
| 模型目錄／工作台選模 | ✅ | `image-to-image` · economy · 可搜 label／id |
| 情境配方 | ✅ | **`sc-text-upscale`** pickIds[1]（Thera 主、本模次、Crisp 第三） |
| 工作流 presets | ❌（未見硬編碼） | 無固定步綁本 id |
| MCP `find_model` | ✅ | 全 MODELS 可查 |
| MCP `submit_generation` | ✅ | 與網頁同路徑；**必須**來源圖 |
| 助手 `assistantModel` | ❌ | `needs` → **undefined**（正確擋代操） |
| `pickGenerateModel(aura-sr)` | 退回 | 本機實測退 **`fal-ai/flux/dev`**（非 i2i） |
| 負向提示／Seed UI | ❌ | schema 無；allowlist 無 |
| checkpoint／overlapping UI | ❌ | 吃 OpenAPI 預設 v1／false |
| `verify-models --probe` | ❌ | needs 拒絕；**禁止** `--yes` 空跑 |

**誤用面**：

- 當「字卡／書法絕對零走樣」→ **Thera 主選**；本模次選仍安全。
- 當「AI 圖要補生細節到 4K 印刷」→ **Clarity／Topaz**，非本模。
- 當「大量最省粗放」→ **ESRGAN／SeedVR2／Recraft Crisp**。
- 當「人像極致臉部微細節」→ **Crystal／Topaz face**。
- 期待「提示詞會改內容／臉」→ prompt **丟棄**；本模不重繪。
- 期待「可調 2×／8×」→ **const 4 only**。
- 無來源圖 → needs／助手雙擋。

## 7. 情境與可用性

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 中文字卡／書法忠實放大 | ✅ 次選 | **`sc-text-upscale`** pick[1]；不重繪字；首選 Thera |
| 人物照安全 4× | ✅ | bestFor 核心；不改臉 |
| 生成圖「只要變大不要幻覺」 | ✅ | 日常忠實；vs SeedVR2「更貼原圖」 |
| AI 圖印刷級補細節 | ❌ | Clarity／Topaz／Recraft Creative |
| 印刷級自然無塑膠 | △ | Topaz 主場；本模經濟替代 |
| 大量批次最省粗放 | △ | ESRGAN 1 點更省；本模 2 點 |
| 老照片綜合修復 | ❌ | photo-restoration／CodeFormer |
| 目標任意倍率／無鋸齒字邊 | △ | Thera 任意倍率更準 |
| 無來源圖 | ❌ | needs 攔截 |
| 中文長提示 | n/a | prompt 不進 payload |

**recommended=false**：合理——垂直忠實放大器，由 **`sc-text-upscale`** 導流即可。  
**配方 why**：「Thera … 含字放大首選」——本模為次選備援，與 OpenAPI 忠實定位一致。

## 8. 文件

| 資源 | URL／路徑 | 狀態 |
|------|-----------|------|
| fal Playground | https://fal.ai/models/fal-ai/aura-sr | 公開頁存在；HTML 常被挑戰擋爬（本輪 429） |
| fal API | https://fal.ai/models/fal-ai/aura-sr/api | 文件入口 |
| OpenAPI Queue | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/aura-sr | **本機 200**，`AuraSrInput` 完整 |
| 平台 metadata | `https://api.fal.ai/v1/models?endpoint_id=fal-ai/aura-sr` | **200** · status **active** · commercial · updated 2026-05-05 |
| Queue base | `https://queue.fal.run` | OpenAPI servers |
| 站內目錄 | `docs/模型目錄.md` | 經濟 · **2 點** · ⚠︎ · 字卡情境次選 |
| 生態研究 | `docs/fal生態研究.md` §放大與修復 | ✅ 端點；算秒、v2 材質、中文安全 |
| 點數校準 | `docs/點數校準報告.md` | **需人工**（無 $） |
| 清查清單 | `docs/模型清查清單.md` | 需圖片；探測模式不受理 |
| 端點連通總表 | `docs/fal端點連通報告.md` | 本輪精簡表未列；無 404 |
| 結果抽取 | `server/services/fal.ts` `extractResult` | 支援 `image.url` |
| 站內註冊 | `shared/models.ts` L736–741 | input 僅 `image_url` |
| 情境配方 | `SCENARIO_RECIPES` **`sc-text-upscale`** | pickIds[1] |
| 姊妹卡 | `docs/model-audit/cards/fal-ai__esrgan.md`（#58）、`…__clarity-upscaler.md`（#60）、`…__topaz__upscale__image.md`（#61） | 忠實／創意／印刷對照 |

## 9. 建議動作

| 優先 | 動作 | 說明 |
|------|------|------|
| — | **維持** points=2、tier=economy、cost 算秒敘事 | 無 $ 不可機械換算；2＝敘事區間上沿緩衝；校準需人工 |
| — | **維持** verified=false | 本回合零 live；OpenAPI＋metadata active 足以 ready-static；**升 true 待 L2** |
| — | **維持** id＝endpoint、`needs=image`、`input: { image_url }` | required 對齊；免提示正確 |
| — | **維持** `sc-text-upscale` 次選定位 | Thera 主／AuraSR 次／Crisp 三 正確 |
| P2 | 對帳 cost | 若官頁可得精確 **$/計算秒**，補字串以利日後校準；**改字串不必改 points** |
| P3 | 可選：default `checkpoint: "v2"` | 生態：v2 材質／少假影；須 live A/B 與算時回歸後再改 |
| P3 | 可選：UI 暴露 overlapping_tiles | 大圖去縫；須標「約 ×2 算時／可能超 2 點敘事」 |
| P3 | 可選：文案註「固定 4×」 | 避免使用者以為可選 2×／目標 4K |
| 後續 live | 站內上傳小圖 → 確認扣 2、輸出約 4×、可選 v1/v2 A/B | **勿** `verify-models --probe --yes` |
| 後續 L1 | 環境允許時 `probe-fal-endpoints` 對 i2i | 預期缺 image_url → 422＝連通 |

### 勾選摘要（審計結論）

- [x] **維持**（點數／id／主 input 映射；verified 維持 false）
- [ ] 調 points
- [ ] 修 input/id（required 已正確；checkpoint／overlapping 為可選產品增強）
- [ ] verified 變更（禁止本回合改；現為 false，升 true 待 live）
- [ ] 下架或隱藏

**總評**：目錄契約與官方 OpenAPI **required 對齊良好**，固定 4× 與 strengths「GigaGAN 4x」一致，輸出 `image` 可解析，needs／助手／probe 守門正確，`sc-text-upscale` 次選定位正確。**points=2** 為算秒人工緩衝（校準需人工），內部帳本自洽。主要殘差：**checkpoint 吃 v1 與生態 v2 敘事落差**、overlapping 未暴露、無精確 $/秒、verified 待 live、零 live。結論：**維持**，列 **ready-static-only**。

---

### 本回合證據清單

1. OpenAPI Queue 2026-08-05：`endpoint_id=fal-ai/aura-sr` → HTTP 200 · `AuraSrInput`（required `image_url`；`upscale_factor` **const 4**；`overlapping_tiles` default false；`checkpoint` default **v1**）／`AuraSrOutput`（`image`+`timings`）  
2. fal metadata API：status **active**、display_name AuraSR、tags upscaling/high-res、license commercial、updated 2026-05-05  
3. `shared/models.ts` L736–741 + `parseRealCost`／`realPricePoints`／`estimatePoints` 本機 tsx → points **2**、realPricePoints **null**、input 僅 `image_url`  
4. `SCENARIO_RECIPES` **`sc-text-upscale`** pickIds[1]；SEED／NEGATIVE allowlist 不含；`assistantModel` → undefined；`pickGenerateModel` → `fal-ai/flux/dev`  
5. `verify-models --probe "fal-ai/aura-sr"`（**無** `--yes`）→ needs=image 正確拒絕  
6. `docs/點數校準報告.md`：需人工；`docs/fal生態研究.md` AuraSR 列；`docs/模型目錄.md` 經濟 2 點 ⚠︎  
