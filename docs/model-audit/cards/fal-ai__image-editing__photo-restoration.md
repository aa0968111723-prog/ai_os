# fal-ai/image-editing/photo-restoration

> 審計：R2 · index **#56** · 層級 **static + research（零 live）** · 日期 2026-08-05  
> slug：`fal-ai__image-editing__photo-restoration`  
> 禁止改 `verified`／`points`（本卡僅建議）

## 1. 身分

| 項 | 值 |
|----|-----|
| **index** | 56 |
| **id** | `fal-ai/image-editing/photo-restoration` |
| **endpoint** | `fal-ai/image-editing/photo-restoration`（`endpointOf` = id，無 alias） |
| **label** | 老照片修復(一鍵) |
| **category** | `image-to-image` |
| **tier** | `flagship`（旗艦） |
| **kind** | `image` |
| **verified** | `true`（目錄已標；本回合**未** live 覆核） |
| **needs** | `image`（必填來源：要修復的老照片） |
| **recommended** | `false`（未設 `recommended: true`） |
| **sourceHint** | 要修復的老照片 |
| **strengths** | 一鍵修老照:去刮痕污漬、去模糊、補殘缺並上色;免提示詞 |
| **bestFor** | 泛黃老照、先人遺照救援(中文題字修後請校對) |
| **vendor** | fal image-editing 任務型修復管線（Queue 端點；非獨立開源品牌名） |

**一句話**：上傳泛黃／刮痕／殘缺舊照，**免提示詞**一鍵去瑕疵、去模糊、補殘缺並常順帶上色；固定 **$0.04／張**，站內 1 點，是 `sc-old-photo` 老照片救援的**首選**。

## 2. 數值

| 項目 | 值 | 來源／算法 |
|------|-----|------------|
| **points（目錄）** | **1** | `shared/models.ts`；載入時 `realPricePoints` 覆寫 |
| **cost（目錄）** | `$0.04/張` | 與 fal 公開標價一致 |
| **官方價（fal）** | **$0.04 / image** | 模型頁：「Your request will cost $0.04 per image」；OpenAPI about：Restore and enhance old or damaged photos |
| **parseRealCost** | `usdMid=0.04` · `multiplier=1` · `×1（每次一件）` | 本機 `npx tsx` 讀 shared |
| **realPricePoints** | `max(1, round(0.04 × 1 × 31))` = `round(1.24)` = **1** | `USD_TO_TWD=31` |
| **估值 NT$** | ≈ **1.24**／次 | 0.04×31 |
| **estimatePoints()** | **1**（扁平，非 TTS 動態） | 與 UI／扣點同口徑 |
| **校準判定** | **≈** | `docs/點數校準報告.md`：旗艦「老照片修復(一鍵)」1 點 vs 估 1.2 → 四捨五入符合 |

**風險（未改 points）**：

- 計價單位為**固定張價**（非 MP）；步數／guidance 不改變官方「per image」敘述——與站內 1 點扁平估點一致。
- 若未來官方改按 MP 或高解析加價，需重跑 L2；本回合以 $0.04/image 為準。
- 同價位備選 `fal-ai/image-apps-v2/photo-restoration` 目錄亦寫 $0.04/張但 **verified=false**（Gemini 路線）；本卡只審 image-editing 版。

## 3. 連通與生成

| 項目 | 結果 | 說明 |
|------|------|------|
| **L0 靜態契約** | **ok** | id 唯一；`category∈CATEGORIES`；`needs/points/cost/tier/verified/strengths/bestFor/sourceHint/input` 齊；**不在** verified=false 清查清單（對照 Gemini 版在清查表） |
| **OpenAPI Queue** | **200 · schema 有效** | `GET https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/image-editing/photo-restoration` → `ImageEditingPhotoRestorationInput` / `ImageEditingPhotoRestorationOutput`；`x-fal-metadata.endpointId` 吻合 |
| **L1 批次 probe** | **當前報告未列** | 現存 `docs/fal端點連通報告.md` 僅抽樣文生影片 32 端點，**無**本 id；本回合 **禁止 `--yes`**，未跑 `probe-fal-endpoints.ts --yes` |
| **dry-run probe** | 計畫可印 | 腳本乾跑會列出含本端點之 fal 唯一端點；不連網 |
| **L4 live probe** | **未跑** | `needs=image` → `verify-models --probe` **禁止**（需來源圖）；須站內素材或合法 `image_url` 單次生成 |
| **輸出解析** | **契約 OK** | OpenAPI 回 `images[]` + `seed`；`extractResult` **優先** `result.images[0].url`（`server/services/fal.ts`） |
| **結論** | **ready-static-only** | 契約＋官方 schema＋$0.04 計價對得上；佇列 live 與中文題字保真待有來源圖之 live |

## 4. 底層邏輯

### 4.1 產品能力（官方）

- **定位**：任務型 **photo restoration**——修復／增強老舊或受損照片（去瑕疵、上色等）；playground／about：「Restore and enhance old or damaged photos.」
- **必填**：僅 `image_url`（OpenAPI `required: ["image_url"]`；description：URL of the old or damaged photo to restore）。
- **guidance_scale**（number，0–20，預設 **3.5**）：CFG；schema 文案殘留「stick to your prompt」——**實際 schema 無 prompt 欄**，屬文件噪音，以「免提示詞修復」產品行為為準。
- **num_inference_steps**（integer，1–50，預設 **30**）。
- **safety_tolerance**（enum `"1"`…`"6"`，預設 `"2"`）：1 最嚴、6 最寬。
- **output_format**（`jpeg` | `png`，預設 **jpeg**）。
- **aspect_ratio**（可選：`21:9`…`9:21` 或 null）：可改輸出畫幅；不送則由服務端依來源／預設決定。
- **seed**（integer | null）：可重現。
- **sync_mode**（boolean，預設 false）：true 時以 data URI 回傳且不進 history。
- **輸出**：`images[]`（Image：url 等）+ `seed`（皆 required）。

### 4.2 站內 `input()` 組裝

```ts
// shared/models.ts
input: (_p, _f, s) => ({ image_url: s }),
```

| 官方 property | 站內 | 備註 |
|---------------|------|------|
| `image_url` | ✅ `s`（來源圖 URL） | 與 `needs:image`、缺來源攔截一致 |
| `guidance_scale` | ❌ 不送 | 吃預設 **3.5** |
| `num_inference_steps` | ❌ 不送 | 吃預設 **30** |
| `safety_tolerance` | ❌ 不送 | 吃預設 `"2"` |
| `output_format` | ❌ 不送 | 吃預設 **jpeg** |
| `aspect_ratio` | ❌ `_f` 忽略 | 分鏡 16:9／9:16 **不進** payload |
| `seed` | ❌ 不送 | 不在 `SEED_SUPPORTED`（雖 OpenAPI 有欄） |
| `sync_mode` | ❌ 不送 | 預設 false（佇列＋可查 history） |
| 提示詞 `p` | ❌ 丟棄 | **免提示詞**；空字串與有字串 payload 相同 |
| `negative_prompt` | 無此欄 | 不在 `NEGATIVE_PROMPT_SUPPORTED` |

### 4.3 架構／分詞（站內圖解）

- `modelMechanicsFor` → **family: `unknown`**（未收錄 image-editing 修復專用圖解）。
- `textEncoderProfileFor` → 不適用（無文生條件；提示窗字數無語意作用）。
- 實務：使用者應上傳**受損／泛黃舊照 URL**；非「用文字描述怎麼修」。

### 4.4 已知契約缺口

1. **中文題字／匾額**：生成式修復可能重繪改字——bestFor 已警示「修後請校對」；重要文字應人工核對或改走更忠實鏈（Thera 放大等，修完後）。
2. **比例未暴露**：OpenAPI 有 `aspect_ratio`，站內 `_f` 未映射；輸出畫幅不可用分鏡旋鈕控制。
3. **進階旋鈕未暴露**：guidance／steps／safety／format／seed 全吃預設——符合「一鍵」定位；進階用戶無法調。
4. **提示詞 UI 誤導**：若工作台仍顯示通用 prompt 框，易讓人以為可寫「只修臉不改背景」——實際忽略 `p`。
5. **guidance 文案噪音**：OpenAPI 描述仍寫 prompt／CFG 慣用語，與無 prompt 欄矛盾；以 required 欄與產品定位為準。

## 5. 點數路徑

| 步驟 | 行為 |
|------|------|
| 估點 | `estimatePoints(model)` → **1**（與 `realPricePoints` 一致） |
| 預覽 | `prepareGenerationRequest` 只組裝、**不扣點** |
| 缺來源 | `needs=image` 且無 `sourceUrl`／`sourceAssetId`／卡片參考圖 → `BAD_REQUEST`「此模型需要來源:要修復的老照片」 |
| 審核門檻 | 高成本審核路徑用同一 `est`（本模 1 點通常直接過） |
| 扣點 | `reserveQuota(userId, groupId, est=1, …, gen.id)` 與 generation 列同交易 |
| 送出失敗 | fal submit 失敗 → 退點（`failed.refunded`） |
| 供應商 failed／無成品 | CAS → failed + 退點 |
| BYOK 個人 key | 平台點數可為 0（既有 byok 路徑）；本卡未 live 驗證 |
| E2E_MOCK | 測試可不扣點；正式模式對稱扣退 |

**一致性**：UI 顯示 1 點 ＝ 目錄 points ＝ reserve／refund 的 est；L2 校準 **≈**，**建議維持 1 點**（不在本回合改 points）。

## 6. 暴露面

| 面 | 是否暴露 | 說明 |
|----|----------|------|
| 模型目錄／工作台選模 | ✅ | `image-to-image` · flagship · 可搜 label／id |
| 情境配方 | ✅ | `SCENARIO_RECIPES` **`sc-old-photo`**「老照片修復」**pickIds[0]**（首選） |
| 同組備援 | ✅ | pick[1]=`fal-ai/image-apps-v2/photo-restoration`、pick[2]=`fal-ai/codeformer` |
| 上色情境 | ✅ | **`sc-colorize`** pickIds[1]（主選 DDColor；本模作「修＋上色」備援） |
| 工作流 presets | ❌（未見專步） | 無以本 id 為固定步的 WORKFLOW_PRESET 硬編碼（以 grep 為準） |
| MCP `find_model` | ✅ | 全 `MODELS` 可查；category=image-to-image |
| MCP `submit_generation` | ✅ | 與網頁同 `executeGenerationCommand`；**必須**來源圖 |
| 負向提示 UI | ❌ | 不在 allowlist |
| Seed／消融 | ❌ | 不在 `SEED_SUPPORTED` |
| 全域 recommended | ❌ | `recommended` 未開；靠情境卡導流 |
| 檢視者 | 擋寫 | 專案 generate 權限／MCP write scope 既有守衛 |
| 封存專案 | 擋生成 | `assertProjectAllows`／MCP archived 守衛 |

**誤用面**：

- 當「只修臉、不動全圖」→ 應走 `fal-ai/codeformer`；本模是**全圖綜合修復**。
- 當「只上色、不動結構」→ 應走 `fal-ai/ddcolor`；本模可能重繪細節。
- 當「含中文字卡忠實放大」→ 應走 Thera／AuraSR；本模非 upscaler 主場且有改字風險。
- 無人臉風景舊掃描仍可用（去刮痕／清晰度），但勿期待人像專精級保真。
- 無來源圖時被助手亂挑 → 正確被 needs 攔截。

## 7. 情境與可用性

| 情境 | 適配 | 說明 |
|------|------|------|
| 老照片修復（`sc-old-photo`） | **首選 ✅** | pick[0]；strengths／bestFor／配方 why 一致 |
| 泛黃／刮痕／殘缺先人遺照 | ✅ | 產品核心；免提示詞志工友好 |
| 黑白遺照上色（`sc-colorize`） | ⚠️ 備選 | pick[1]；主選 DDColor 更忠實；本模可能同時改畫 |
| 精修鏈：本模 → CodeFormer → Thera | ✅ | 生態研究推薦：一鍵粗修後可再修臉／忠實放大 |
| 僅去背／換背景 | ❌ | 錯模 |
| 商品情境擺拍 | ❌ | 走 Bria Product Shot |
| 印刷級 AI 圖放大 | ❌ | Clarity／Topaz；非 restoration |
| 中文長提示控制修復 | n/a | prompt 不進 payload |

**recommended=false**：可接受——垂直「老照救援」由 `sc-old-photo` 導流即可；若產品要提升目錄曝光，可另議開 `recommended: true`（**非本回合改碼**）。tier=**flagship** 合理（任務型旗艦體驗），點數仍經濟 1 點。

## 8. 文件

| 資源 | URL／路徑 | 狀態 |
|------|-----------|------|
| fal Playground | https://fal.ai/models/fal-ai/image-editing/photo-restoration | 公開頁存在；標價 **$0.04/image**；瀏覽器／爬蟲偶發 Vercel challenge（429） |
| fal API 文件 | https://fal.ai/models/fal-ai/image-editing/photo-restoration/api | Restore and enhance old or damaged photos |
| OpenAPI Queue | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/image-editing/photo-restoration | **本機拉取 200**，schema 完整 |
| Queue base | `https://queue.fal.run` | OpenAPI servers |
| 站內目錄 | `docs/模型目錄.md` | 旗艦 · 1 點 · $0.04/張 · 來源提示正確 |
| 生態研究 | `docs/fal生態研究.md` §放大與修復 | ✅已查證 $0.04/張；一鍵免提示；中文題字校對警示；表內「經濟」標籤與 MODELS **flagship** 不一致處——**以 MODELS flagship 為準** |
| 點數校準 | `docs/點數校準報告.md` | ≈（1 點 vs 估 1.2） |
| 端點連通總表 | `docs/fal端點連通報告.md` | **未列本端點**（當前抽樣為文生影片） |
| 底層總論 | `docs/模型底層邏輯與運作流程.md` | 無本端點專節 |
| 結果抽取 | `server/services/fal.ts` `extractResult` | 支援 `images[0].url` |
| 姊妹端點 | `fal-ai/image-apps-v2/photo-restoration` | Gemini 路線備選；verified=false；另卡 |

## 9. 建議動作

| 優先 | 動作 | 說明 |
|------|------|------|
| — | **維持** points=1、cost=`$0.04/張`、tier=flagship | 與 fal $0.04/image、realPricePoints=1、校準≈ 一致 |
| — | **維持** verified 現值（已 true） | 本回合零 live；OpenAPI＋計價已交叉；不建議僅因 L1 未列改 false |
| — | **維持** `input`：僅 `image_url` | 映射正確；免提示詞一鍵定位正確 |
| 低 | 可選：UI 標「免提示詞・全圖修復・含字請校對」 | 減少 prompt 誤用與中文題字期望落差 |
| 低 | 可選：暴露 `aspect_ratio` ← 站內畫幅 `f` | 分鏡比例一致；非必須 |
| 低 | 可選：全域 `recommended: true` | 生態研究列優先；現靠 `sc-old-photo` 已可達 |
| 後續 live | 站內上傳泛黃刮痕舊照 → 確認扣 1 點、去瑕疵／上色與中文題字是否漂移 | needs 禁止 `--probe`；走 generate 單次 |
| 後續 L1 | `probe-fal-endpoints.ts --yes --only image-to-image` 納入本端點 | 預期缺 image_url → 422＝連通 |

### 勾選摘要（審計結論）

- [x] **維持**（點數／id／主 input 映射）
- [ ] 調 points
- [ ] 修 input/id（`image_url` 已正確；無 id 錯誤）
- [ ] verified 變更（禁止本回合改；現為 true）
- [ ] 下架或隱藏

**總評**：目錄契約與官方 OpenAPI／$0.04 per image **對齊良好**，1 點 **≈**，`sc-old-photo` 首選定位正確，輸出 `images[]` 可被站內解析。主要殘差是 **L1 抽樣未列、live 未跑、比例／進階參數未暴露、中文題字生成風險**。結論：**維持**，列 **ready-static-only**。
