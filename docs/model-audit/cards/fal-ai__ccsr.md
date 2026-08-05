# fal-ai/ccsr

> 審計：R2 · index **#63** · 模式 **static+research（零 live）** · 2026-08-05  
> slug：`fal-ai__ccsr`  
> 禁止改 `verified`／`points`（本卡僅建議）· **禁止 `--yes`**

## 1. 身分

| 項 | 值 |
|----|-----|
| **index** | 63 |
| **id** | `fal-ai/ccsr` |
| **endpoint** | `fal-ai/ccsr`（`endpointOf` = id，無 alias） |
| **label** | CCSR 忠實超解析 |
| **category** | `image-to-image` |
| **tier** | `economy`（經濟） |
| **kind** | `image` |
| **verified** | `false`（目錄已標；本回合**未** live 覆核；**禁止**本卡改碼） |
| **needs** | `image`（必填來源：要放大的圖） |
| **recommended** | `false`（MODELS 未顯式設 true） |
| **sourceHint** | 要放大的圖 |
| **strengths** | 內容忠實超解析;低幻覺、比純 GAN 更漂亮的中間選項 |
| **bestFor** | 要保留當事人真實樣貌的高品質放大 |
| **vendor** | **CCSR**（Content Consistent Super-Resolution；擴散系內容一致超分；fal Queue 託管） |

**一句話**：**內容忠實的擴散系超解析**——必填 `image_url`，官方預設 **`scale=2`**（max **4**）、**`steps=50`**、色校正 **`color_fix_type=adain`**、tile 預設關；**免提示詞**。站內只送 `image_url`。目錄 **points=2**、cost「查不到精確價(推估按 MP)」；官頁摘要顯示**按計算秒**計費（精確 $/秒本輪未鎖定）——介於純 GAN（AuraSR／ESRGAN）與創意重繪（Clarity／SUPIR）之間的中間檔。

## 2. 數值

| 項目 | 值 | 來源／算法 |
|------|-----|------------|
| **points（目錄）** | **2** | `shared/models.ts` 手填；`realPricePoints` **null** → **不**覆寫 |
| **cost（目錄）** | `查不到精確價(推估按 MP)` | 無 `$` 金額；單位為**推估** |
| **parseRealCost** | `usdMid=null` · `multiplier=null` · `單位「無 $ 金額」` | 本機 tsx 2026-08-05 |
| **realPricePoints** | **null** | 無法機械換算 |
| **estimatePoints()** | **2**（扁平） | UI／扣點／退點同口徑 |
| **生態研究交叉價** | 查不到精確價（推估按 MP）🔸推定 | `docs/fal生態研究.md` 與目錄一致 |
| **官頁摘要（搜尋）** | *Your request will cost $0 per compute second* | 公開頁摘要→**計費軸是計算秒**，非固定 MP；`$0` 多半為顯示精度／未鎖定，**不能**當免費背書 |
| **校準判定** | **需人工** | `docs/點數校準報告.md`「CCSR 忠實超解析 ⚠︎」 |

**風險（未改 points）**：

1. **計價單位不明**：目錄／生態寫「推估按 MP」，官頁摘要寫 **compute second**——二者衝突；`parseRealCost` 兩種都抓不到 `$` 數字 → **無法機械校準**。
2. **預設 `steps=50` 偏重**：比 Clarity default 18、多數 GAN 單前向重很多；若真為算秒計費，大圖 + tile + 高 steps 可輕易超過「2 點」緩衝——**points=2 是人工下限／敘事緩衝，非合同單價**。
3. **`scale` 預設 2、最大 4**：面積 ×4～×16；站內不送 scale → 吃 **2×**（與 AuraSR 固定 4× 不同）。使用者若以為「SOTA 就會 4×」會失望——**非 bug，是 default**。
4. **與姊妹檔**：AuraSR **2** 點（算秒、固定 4×）；ESRGAN **1** 點（算秒）；Thera **1** 點（$0.0021/MP）；Clarity **1** 點但 4K 實價嚴重低估。CCSR 標 2 作「比 GAN 貴一點的中間檔」**合理敘事**，**不構成改 points 的充分條件**（先要 live 帳單）。
5. 註解「首跑校準」仍待 L2——**本卡不改 points**。

## 3. 連通與生成

| 項目 | 結果 | 說明 |
|------|------|------|
| **L0 靜態契約** | **ok** | id 唯一；`needs/points/cost/tier/verified/strengths/bestFor/sourceHint/input` 齊 |
| **OpenAPI Queue** | **HTTP 200 · schema 有效** | `GET …/openapi.json?endpoint_id=fal-ai/ccsr` → `CcsrInput`／`CcsrOutput`；`x-fal-metadata.endpointId=fal-ai/ccsr` |
| **平台 metadata** | **HTTP 200 · active** | `api.fal.ai/v1/models?endpoint_id=…` · display_name **CCSR Upscaler** · category image-to-image · tags `upscaling` · description **SOTA Image Upscaler** · updated **2026-01-26** · date 2024-05-05 |
| **L1 批次 probe** | **本輪未重跑** | 禁止 `--yes`；`docs/fal端點連通報告.md` 精簡表未列本 id；**非** 404 紀錄；OpenAPI＋metadata 雙 200 |
| **dry-run verify** | **拒絕（正確）** | `npx tsx scripts/verify-models.ts --probe "fal-ai/ccsr"` → needs=image 擋下；**未**加 `--yes` |
| **L2／L4 live** | **未跑** | 須站內素材或合法 `image_url` 單次生成；**禁止** 空跑 `--yes` |
| **輸出解析** | **契約 OK** | OpenAPI 回 `image`（必填）+ `seed`（必填）；`extractResult` 支援 `result.image.url`（`server/services/fal.ts`） |
| **結論** | **ready-static-only** | schema／required／input 對齊；算秒／MP 實帳與品質（vs AuraSR／Thera）待有圖實測；verified 維持 false 等 L2 |

### OpenAPI 摘要（2026-08-05 本輪 curl）

- **required**：`["image_url"]`
- **order**：`image_url` → `scale` → `tile_diffusion` → `tile_diffusion_size` → `tile_diffusion_stride` → `tile_vae` → `tile_vae_decoder_size` → `tile_vae_encoder_size` → `steps` → `t_max` → `t_min` → `color_fix_type` → `seed`
- **scale**：number，default **2**，min **1**，max **4**（邊長倍率；非目標 MP API）
- **steps**：integer，default **50**，min 10，max 100（越高越好、越慢）
- **t_max**／**t_min**：number，default **0.6667**／**0.3333**（uniform sampling 起迄；CCSR 非均勻時間步策略）
- **color_fix_type**：enum **`none`｜`wavelet`｜`adain`**，default **`adain`**
- **tile_diffusion**：enum **`none`｜`mix`｜`gaussian`**，default **`none`**（大圖 patch 採樣）
- **tile_diffusion_size**／**stride**：default **1024**／**512**
- **tile_vae**：boolean，default **false**；encoder/decoder size default **1024**／**226**
- **seed**：optional integer｜null（可重現；不同 seed 略有差異）
- **Output**：`image`（Image：url 必填 + 可選 width/height/…）+ **`seed`**（integer，required）
- **無** `prompt`／`negative_prompt`／`guidance_scale`／`upscale_factor` 別名
- **Queue**：`https://queue.fal.run` · paths `/fal-ai/ccsr` + status／cancel／result

## 4. 底層邏輯

### 4.1 產品能力（官方／生態）

- **定位**：**Content Consistent Super-Resolution（CCSR）**——擴散（+ 一致性約束）超分，號稱 **SOTA 內容忠實**：放大同時維持原內容與細節、**低幻覺**；生態放在「比純 GAN 更漂亮、又不像 Clarity／SUPIR 亂改」的**中間選項**。
- **學術／社群**：CCSR／CCSRv2（TIP 路線）強調 content consistency、細節穩定；ComfyUI 亦有影像／影片 upscale workflow。對**見證／當事人真實樣貌**比重度生成修復更合適。
- **vs AuraSR（#62）**：AuraSR＝GigaGAN 固定 4×、免步驟；CCSR＝可調 scale 1–4、steps 重、有 seed／色校正／tile——更「擴散味」，理論上細節更豐、算時更長。
- **vs ESRGAN（#58）**：ESRGAN 更省、可 face；CCSR 品質敘事更高、無 face 開關。
- **vs Thera**：字卡／書法零走樣首選仍是 Thera；CCSR 未進 `sc-text-upscale`（見 §6）。
- **vs Clarity（#60）／SUPIR（#64）**：Clarity／SUPIR 生成式補畫／重建；CCSR 強調**不亂改內容**——弘法見證、證件感人像優先 CCSR 而非 SUPIR。
- **中文字**：生態「—」未特別背書；屬忠實型相對安全，但**非**文字專用（細字首選 Thera）。擴散步數高時仍可能有輕微紋理幻覺——待 live。

### 4.2 站內 `input()` 組裝

```ts
// shared/models.ts ~L743–751
// 價格文件查不到(推估按 MP),首跑校準
input: (_p, _f, s) => ({ image_url: s }),
```

| 官方 property | 站內 | 備註 |
|---------------|------|------|
| `image_url` | ✅ `s` | 與 `needs:image`、缺來源攔截一致 |
| `scale` | ❌ 不送 | 吃 **default 2**（max 4） |
| `steps` | ❌ 不送 | 吃 **50**（算時敏感） |
| `t_max`／`t_min` | ❌ 不送 | 吃 0.6667／0.3333 |
| `color_fix_type` | ❌ 不送 | 吃 **adain** |
| `tile_*` | ❌ 不送 | tile 關；超大圖可能 OOM／品質差風險 |
| `seed` | ❌ 不送 | 隨機；**亦不在** `SEED_SUPPORTED` |
| 提示詞 `p` | ❌ 丟棄 | **免提示詞** |
| 畫幅 `f` | ❌ `_f` 忽略 | 無 aspect；尺寸＝來源 × scale |

### 4.3 架構／分詞

- `modelMechanicsFor` → **family: `unknown`**（未收錄 CCSR 專節；可接受）。
- `textEncoderProfileFor` → unknown；提示窗對 payload **無語意作用**。
- 實務：使用者應上傳**要放大的圖**，不是寫「忠實超解析 4K」文字（倍率靠 `scale`，站內固定吃 2）。

### 4.4 已知契約／文案缺口

1. **cost「推估按 MP」vs 官頁 compute second**（P2）：單位敘事衝突；應對帳後改 cost 字串（**改字串不必改 points**）。
2. **strengths「比純 GAN 更漂亮」未在站內可驗證**（預期）：零 live；待 A/B vs AuraSR。
3. **seed 有 schema、無 UI／allowlist**（P3）：`SEED_SUPPORTED` 不含本 id；若產品要可重現放大，可加名單並暴露。
4. **steps=50 未暴露**（P3）：品質／成本旋鈕；降 steps 可省算時但可能傷細節。
5. **scale 未暴露**（P3）：預設 2 vs 文案「超解析」易被讀成 4×。
6. **verified=false**（預期）：needs=image、零 live；L2 後再議（**本卡不改**）。
7. **不在任何 SCENARIO_RECIPES pickIds**（P3）：中間檔定位清楚，但使用者不易從情境導流發現。

## 5. 點數路徑

| 步驟 | 行為 |
|------|------|
| 估點 | `estimatePoints` → **2**（`realPricePoints` null → 手填 2） |
| 預覽 | `prepareGenerationRequest` 只組裝、**不扣點** |
| 缺來源 | needs=image 且無來源 → `BAD_REQUEST`（sourceHint：要放大的圖） |
| 扣點 | `reserveQuota(…, est=2)` |
| 失敗／無成品 | 退點 |
| BYOK | 平台點數可為 0（既有路徑；本卡未 live） |
| 供應商實帳 | **疑似 GPU 計算秒**（官頁摘要）；與站內 2 點在「大圖 + steps=50 + tile」路徑可能脫鉤 |

**一致性（站內帳本）**：顯示 2 ＝ 目錄 points ＝ reserve／refund——**內部自洽**。  
**一致性（對 fal 成本）**：**需人工**；**建議維持 2**，待 live 帳單對帳後再議。

## 6. 暴露面

| 面 | 是否暴露 | 說明 |
|----|----------|------|
| 模型目錄／工作台選模 | ✅ | `image-to-image` · economy · 可搜 label／id |
| 情境配方 | ❌ | **無** pickIds 命中（`sc-text-upscale`／`sc-ai-upscale`／`sc-portrait-upscale`／`sc-print-upscale` 皆無） |
| 工作流 presets | ❌（未見硬編碼） | 無固定步綁本 id |
| MCP `find_model` | ✅ | 全 MODELS 可查 |
| MCP `submit_generation` | ✅ | 與網頁同路徑；**必須**來源圖 |
| 助手 `assistantModel` | ❌ | needs → **null／undefined**（正確擋代操） |
| `pickGenerateModel(ccsr)` | 退回 | 本機實測退 **`fal-ai/flux/dev`**（非 i2i） |
| `listAssistantGenerateModels` | ❌ | 不在助手代操白名單 |
| 負向提示 UI | ❌ | schema 無；allowlist 無（正確） |
| Seed UI | ❌ | schema **有** seed；**不在** `SEED_SUPPORTED`（與 Clarity 有 seed 且 allowlist 策略類似——本模刻意未收） |
| scale／steps／tile UI | ❌ | 全吃 OpenAPI 預設 |
| `verify-models --probe` | ❌ | needs 拒絕；**禁止** `--yes` 空跑 |

**誤用面**：

- 當「字卡／書法絕對零走樣」→ **Thera**（`sc-text-upscale`），非本模預設路徑。
- 當「AI 圖要補生細節到 4K 印刷」→ **Clarity／Topaz**，非本模。
- 當「糊到救不回要重建」→ **SUPIR**（接受二次創作）；本模是忠實中間檔。
- 當「最省粗放」→ **ESRGAN 1 點**。
- 期待「提示詞會改臉／修臉」→ prompt **丟棄**；無 face 開關。
- 期待「預設 4×」→ **default scale=2**。
- 無來源圖 → needs／助手雙擋。

## 7. 情境與可用性

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 保留當事人真實樣貌的高品質放大 | ✅ | bestFor 核心；低幻覺中間檔 |
| 生成圖「要比 GAN 漂亮、不要 Clarity 亂改」 | ✅ | 生態中間定位 |
| 中文字卡／書法 | △ | 相對安全但非首選；Thera 主、AuraSR 次 |
| 人像特寫極致臉部微細節 | △ | Crystal／Topaz face 更專；本模通用忠實 |
| AI 圖印刷級補細節 | ❌ | Clarity／Topaz／Recraft Creative |
| 極破損重建 | ❌ | SUPIR／photo-restoration |
| 大量最省粗放 | △ | ESRGAN 1 點更省 |
| 無來源圖 | ❌ | needs 攔截 |
| 中文長提示 | n/a | prompt 不進 payload |

**recommended=false**：合理——垂直中間放大器，未進情境配方；靠目錄自選即可。

## 8. 文件

| 資源 | URL／路徑 | 狀態 |
|------|-----------|------|
| fal Playground | https://fal.ai/models/fal-ai/ccsr | 公開頁存在；HTML 常被挑戰擋爬（本輪 429） |
| fal API | https://fal.ai/models/fal-ai/ccsr/api | 文件入口 |
| OpenAPI Queue | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/ccsr | **本機 200**，`CcsrInput` 完整 |
| 平台 metadata | `https://api.fal.ai/v1/models?endpoint_id=fal-ai/ccsr` | **200** · status **active** · tags upscaling · updated 2026-01-26 |
| Queue base | `https://queue.fal.run` | OpenAPI servers |
| 站內目錄 | `docs/模型目錄.md` | 經濟 · **2 點** · ⚠︎ · 忠實中間選項 |
| 生態研究 | `docs/fal生態研究.md` §放大與修復 | 🔸推定；SOTA 內容忠實、低幻覺 |
| 點數校準 | `docs/點數校準報告.md` | **需人工**（無 $） |
| 清查清單 | `docs/模型清查清單.md` | 需圖片；探測模式不受理 |
| 端點連通總表 | `docs/fal端點連通報告.md` | 本輪精簡表未列；無 404 |
| 結果抽取 | `server/services/fal.ts` `extractResult` | 支援 `image.url` |
| 站內註冊 | `shared/models.ts` L743–751 | input 僅 `image_url`；註「首跑校準」 |
| 姊妹卡 | `…__aura-sr.md`（#62）、`…__esrgan.md`（#58）、`…__clarity-upscaler.md`（#60）、`…__topaz__upscale__image.md`（#61） | 忠實 GAN／粗放／創意／印刷對照 |

## 9. 建議動作

| 優先 | 動作 | 說明 |
|------|------|------|
| — | **維持** points=2、tier=economy | 無 $ 不可機械換算；2＝中間檔人工緩衝；校準需人工 |
| — | **維持** verified=false | 本回合零 live；OpenAPI＋metadata active 足以 ready-static；**升 true 待 L2** |
| — | **維持** id＝endpoint、`needs=image`、`input: { image_url }` | required 對齊；免提示正確 |
| P2 | 對帳 cost 單位 | 確認 **$/計算秒** 或 **$/MP** 後改 cost 字串；**改字串不必改 points** |
| P2 | live 帳單樣本 | 小圖（~0.25–1MP）預設 2×／steps=50 實付 vs 扣 2 點；必要時再建議調點 |
| P3 | 可選：暴露 `scale`（2｜4） | 對齊「超解析」預期；4× 須提示算時／成本 |
| P3 | 可選：`SEED_SUPPORTED` 收錄 + UI | schema 有 seed；要可重現工作流時再開 |
| P3 | 可選：steps 保守預設或 UI | 50 偏重；產品可測 20–30 品質／成本 |
| P3 | 可選：情境配方 | 例如 `sc-portrait-upscale` 或新建「忠實高品質中間檔」pick 本 id（Crystal 主、CCSR 次） |
| 後續 live | 站內上傳人像小圖 → 確認扣 2、輸出約 2×、與 AuraSR A/B | **勿** `verify-models --probe --yes` |
| 後續 L1 | 環境允許時 `probe-fal-endpoints` 對 i2i | 預期缺 image_url → 422＝連通 |

### 勾選摘要（審計結論）

- [x] **維持**（點數／id／主 input 映射；verified 維持 false）
- [ ] 調 points
- [ ] 修 input/id（required 已正確；scale／seed／steps 為可選產品增強）
- [ ] verified 變更（禁止本回合改；現為 false，升 true 待 live）
- [ ] 下架或隱藏

**總評**：目錄契約與官方 OpenAPI **required 對齊良好**，免提示、只送 `image_url` 正確；輸出 `image`+`seed` 可解析，needs／助手／probe 守門正確。**points=2** 為價未知下的人工緩衝（校準需人工），內部帳本自洽。主要殘差：**cost 單位（MP vs 算秒）未鎖定**、預設 steps=50 算時風險、scale／seed 未暴露、未入情境配方、verified 待 live、零 live。結論：**維持**，列 **ready-static-only**。

---

### 本回合證據清單

1. OpenAPI Queue 2026-08-05：`endpoint_id=fal-ai/ccsr` → HTTP 200 · `CcsrInput`（required `image_url`；`scale` default **2** max **4**；`steps` default **50**；`color_fix_type` default **adain**；tile 預設關；`seed` optional）／`CcsrOutput`（`image`+`seed` required）  
2. fal metadata API：status **active**、display_name **CCSR Upscaler**、tags upscaling、description SOTA Image Upscaler、updated 2026-01-26  
3. `shared/models.ts` L743–751 + `parseRealCost`／`realPricePoints`／`estimatePoints` 本機 tsx → points **2**、realPricePoints **null**、input 僅 `image_url`  
4. `SCENARIO_RECIPES` **無**本 id；`SEED_SUPPORTED`／`NEGATIVE_PROMPT_SUPPORTED` 不含；`assistantModel` → null；`pickGenerateModel` → `fal-ai/flux/dev`  
5. `verify-models --probe "fal-ai/ccsr"`（**無** `--yes`）→ needs=image 正確拒絕  
6. `docs/點數校準報告.md`：需人工；`docs/fal生態研究.md` CCSR 列 🔸推定；`docs/模型目錄.md` 經濟 2 點 ⚠︎  
7. 公開頁搜尋摘要：計費軸 **compute second**（精確費率未鎖定；與目錄「推估 MP」衝突 → P2）  
