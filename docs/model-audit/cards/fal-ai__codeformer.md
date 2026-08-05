# fal-ai/codeformer

> 審計：R2 · index **#55** · 層級 **static + research（零 live）** · 日期 2026-08-05  
> slug：`fal-ai__codeformer`  
> 禁止改 `verified`／`points`（本卡僅建議）

## 1. 身分

| 項 | 值 |
|----|-----|
| **index** | 55 |
| **id** | `fal-ai/codeformer` |
| **endpoint** | `fal-ai/codeformer`（`endpointOf` = id，無 alias） |
| **label** | 臉部修復 CodeFormer |
| **category** | `image-to-image` |
| **tier** | `budget`（最低成本） |
| **kind** | `image` |
| **verified** | `true`（目錄已標；本回合**未** live 覆核） |
| **needs** | `image`（必填來源：要修復的老照片） |
| **recommended** | `false` |
| **sourceHint** | 要修復的老照片 |
| **strengths** | 修復模糊/老舊照片的臉部細節與清晰度 |
| **bestFor** | 早年開示低清老照片修臉,救回紀念影片素材 |
| **vendor** | CodeFormer（開源盲臉修復；fal 託管 Queue 端點） |

**一句話**：上傳人臉／舊照，做**盲臉修復**（可調 fidelity：忠於原臉 vs 更平滑）並內建 **2× 升頻**；按 **$0.0021/MP** 計費，單張常遠低於 1 點下限，是老照片精修鏈裡最便宜的「只修臉」工具。

## 2. 數值

| 項目 | 值 | 來源／算法 |
|------|-----|------------|
| **points（目錄）** | **1** | `shared/models.ts`；載入時 `realPricePoints` 覆寫 |
| **cost（目錄）** | `$0.0021/百萬像素(每張約 $0.002,<1點)` | 與 fal 公開標價一致 |
| **官方價（fal）** | **$0.0021 / megapixel** | fal 模型頁：「Your request will cost $0.0021 per megapixel」；~476 次／$1（512² 輸入級） |
| **parseRealCost** | `usdMid=0.0021` · `multiplier=1` · `×1MP（16:9 標準輸出 ≈ 1MP）` | 本機 `npx tsx` 讀 shared；取字串**第一個** `$` 金額 |
| **realPricePoints** | `max(1, round(0.0021 × 1 × 31))` = `round(0.0651)` = **1** | `USD_TO_TWD=31` |
| **估值 NT$** | ≈ **0.07**／1MP（約 $0.002／張敘述） | 0.0021×31 |
| **estimatePoints()** | **1**（扁平，非 TTS 動態） | 與 UI／扣點同口徑 |
| **校準判定** | **≈** | `docs/點數校準報告.md`：1 點 vs 估 0.1 → 下限 1 點偏貴緩衝（對站友善） |

**風險（未改 points）**：

- 官方預設 **`upscale_factor=2`**（線性 2× → 面積約 4×）。512² 輸入 → ~1024² ≈ 1MP，帳單 ≈ $0.0021，遠低於 1 點。
- 若來源已是高解析（例：3000×4000 再 2× → 約 24MP），USD ≈ $0.05（≈ NT$1.6）→ **仍約 1～2 點**；再大才可能實帳單 > 1 點。站內 `input()` **不送** `upscale_factor`，吃官方預設 2。
- 校準表手填 `usdMid=0.002` 略低於機械解析 `0.0021`；兩者四捨五入後仍 **1 點**，無 points 差。
- cost 括號「每張約 $0.002」是 1MP 級敘述，**非**固定張價；MP 計費屬正確單位。

## 3. 連通與生成

| 項目 | 結果 | 說明 |
|------|------|------|
| **L0 靜態契約** | **ok** | id 唯一；`category∈CATEGORIES`；`needs/points/cost/tier/verified/strengths/bestFor/sourceHint/input` 齊；非 verified=false 清單 |
| **OpenAPI Queue** | **200 · schema 有效** | `GET https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/codeformer` → `CodeformerInput` / `CodeformerOutput`；`x-fal-metadata.endpointId=fal-ai/codeformer` |
| **L1 批次 probe** | **環境暫態** | 當前 `docs/fal端點連通報告.md` 全表 252 端點均 ⏳ 5xx/逾時（含本 id）——**非本端點獨有 404**；歷史成功紀錄與 OpenAPI 並存。本回合 **禁止 `--yes`**，未重跑 `probe-fal-endpoints.ts --yes` |
| **dry-run probe** | 計畫可印 | 腳本乾跑會列出含本端點之 fal 唯一端點；不連網 |
| **L4 live probe** | **未跑** | `needs=image` → `verify-models --probe` **禁止**（需來源圖）；須站內素材或合法 `image_url` 單次生成 |
| **輸出解析** | **契約 OK** | OpenAPI 回 `image`（單物件）+ `seed`；`extractResult` 已支援 `result.image.url`（`server/services/fal.ts` + 單測） |
| **結論** | **ready-static-only** | 契約＋官方 schema＋計價對得上；佇列 live 與成品臉部品質待有來源圖之 live |

## 4. 底層邏輯

### 4.1 產品能力（官方）

- **定位**：transformer 系**盲臉修復**——在品質與身分保留間用單一 **fidelity** 權重取捨；內建 face upscale／可選 only_center_face。
- **必填**：僅 `image_url`（OpenAPI `required: ["image_url"]`）。
- **fidelity**（number，預設 **0.5**）：fidelity factor 權重——偏高較忠於原臉，偏低較平滑／「漂亮」。
- **upscale_factor**（number，預設 **2**，minimum 1）：整圖升頻倍率。
- **face_upscale**（boolean，預設 true）、**aligned**（false）、**only_center_face**（false）。
- **seed**（integer | null）：可重現。
- **輸出**：`image`（url / content_type / 寬高等）+ `seed`；示例 PNG／JPEG 皆見。
- **OpenAPI 文案瑕疵**：`image_url` description 寫 “relighting”——屬文件 copy-paste 噪音，以模型名 CodeFormer 與 playground 行為為準。

### 4.2 站內 `input()` 組裝

```ts
// shared/models.ts
// 產品建議 #13 保守檔:fidelity 偏高以忠於本人樣貌
input: (_p, _f, s) => ({ image_url: s, fidelity: 0.7 }),
```

| 官方 property | 站內 | 備註 |
|---------------|------|------|
| `image_url` | ✅ `s`（來源圖 URL） | 與 `needs:image`、缺來源攔截一致 |
| `fidelity` | ✅ 固定 **0.7** | 高於官方預設 0.5 → 偏「忠於本人」；**忽略**使用者 prompt `_p` |
| `upscale_factor` | ❌ 不送 | 吃預設 **2** |
| `face_upscale` / `aligned` / `only_center_face` | ❌ 不送 | 吃 true / false / false |
| `seed` | ❌ 不送 | 不在 `SEED_SUPPORTED`（雖 OpenAPI 有欄） |
| 畫幅 `f` | ❌ `_f` 忽略 | 輸出尺寸跟來源 × upscale，無 aspect 旋鈕 |
| `negative_prompt` | 無此欄 | 不在 `NEGATIVE_PROMPT_SUPPORTED` |
| 提示詞 `p` | ❌ 丟棄 | **免提示詞**工具；空字串與有字串 payload 相同 |

### 4.3 架構／分詞（站內圖解）

- `modelMechanicsFor` → **family: `unknown`**（未收錄 CodeFormer 專用圖解）。
- `textEncoderProfileFor` → 不適用（無文生條件；提示窗字數無語意作用）。
- 實務：使用者應上傳**有人臉**的舊照／壓縮糊臉；非「用文字描述修復」。

### 4.4 已知契約缺口

1. **歷史註解過時**：`// fal生態研究:端點待確認(🔸推定)` 仍留在 `models.ts`；本回合 OpenAPI 200 + 官方 $0.0021/MP 已查證，註解可後續清掉（不改行為）。
2. **fidelity 不可調**：固定 0.7 符合弘法「尊重本人樣貌」；若要「更漂亮／更平滑」需改碼或未來三檔 UI（產品建議 #13）。
3. **upscale 不可關**：預設 2× 會放大並按 **輸出 MP** 計費；超大原圖帳單上升，但 1 點下限在常規用法仍寬裕。
4. **提示詞無效**：UI 若仍顯示通用 prompt 框，易誤導——宜標「免提示詞／只修臉」。

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

**一致性**：UI 顯示 1 點 ＝ 目錄 points ＝ reserve／refund 的 est；L2 校準 **≈**（偏低成本被 1 點下限抬高），**建議維持 1 點**（不在本回合改 points）。

## 6. 暴露面

| 面 | 是否暴露 | 說明 |
|----|----------|------|
| 模型目錄／工作台選模 | ✅ | `image-to-image` · budget · 可搜 label／id |
| 情境配方 | ✅ | `SCENARIO_RECIPES` **`sc-old-photo`**「老照片修復」**pickIds[2]**（主選一鍵 photo-restoration） |
| 備援配方同卡 | ✅ | pick[0]=`fal-ai/image-editing/photo-restoration`、pick[1]=`fal-ai/image-apps-v2/photo-restoration` |
| 工作流 presets | ❌（未見專步） | 無以本 id 為固定步的 WORKFLOW_PRESET 硬編碼（以 grep 為準） |
| MCP `find_model` | ✅ | 全 `MODELS` 可查；category=image-to-image |
| MCP `submit_generation` | ✅ | 與網頁同 `executeGenerationCommand`；**必須**來源圖 |
| 負向提示 UI | ❌ | 不在 allowlist |
| Seed／消融 | ❌ | 不在 `SEED_SUPPORTED` |
| 檢視者 | 擋寫 | 專案 generate 權限／MCP write scope 既有守衛 |
| 封存專案 | 擋生成 | `assertProjectAllows`／MCP archived 守衛 |

**誤用面**：

- 當「全圖去刮痕／上色／補殘缺」一鍵修復 → 應走 `photo-restoration`；本模**主修臉**。
- 當「含中文字卡放大」→ 應走 Thera／AuraSR；本模不動字卡語意，但升頻邊界仍可能影響銳利度。
- 無人臉的風景／產品圖 → 修復收益低或無意義。
- 無來源圖時被助手亂挑 → 正確被 needs 攔截。

## 7. 情境與可用性

| 情境 | 適配 | 說明 |
|------|------|------|
| 老照片修復（`sc-old-photo`） | **備選 ✅** | pick[2]；一鍵綜合修復之後的「只要臉更清」省錢檔 |
| 早年開示／紀念影片糊臉 | ✅ | bestFor 一致；fidelity 0.7 偏保留身分 |
| 精修鏈：CodeFormer → DDColor → Thera | ✅ | `docs/fal生態研究.md` 推薦鏈；整鏈常仍 ≤ 數點 |
| 僅去背／換背景 | ❌ | 錯模 |
| 創意重繪臉（換年齡／性別） | ❌ | 非編輯模；用 Flux/Qwen Edit 等 |
| 印刷級人像微細節 | ⚠️ 次選 | 更高階可 `clarityai/crystal-upscaler`；本模偏修復受損臉 |
| 中文長提示 | n/a | prompt 不進 payload |

**recommended=false**：合理——垂直「修臉」工具，由 `sc-old-photo` 與精修鏈導流即可，不必進全域 recommended。

## 8. 文件

| 資源 | URL／路徑 | 狀態 |
|------|-----------|------|
| fal Playground | https://fal.ai/models/fal-ai/codeformer | 公開頁存在；標價 **$0.0021/MP**；內建 2×；瀏覽器／爬蟲偶發 Vercel 429 |
| fal API 文件 | https://fal.ai/models/fal-ai/codeformer/api | CodeFormer 修復說明 |
| OpenAPI Queue | https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/codeformer | **本機拉取 200**，schema 完整 |
| Queue base | `https://queue.fal.run` | OpenAPI servers |
| 站內目錄 | `docs/模型目錄.md` | 最低成本 · 1 點 · $0.0021/MP · 來源提示正確 |
| 生態研究 | `docs/fal生態研究.md` §放大與修復 | ✅已查證 $0.0021/MP；fidelity 保守建議；tier 文案「經濟／最低成本」與 MODELS **budget** 對齊以 MODELS 為準 |
| 點數校準 | `docs/點數校準報告.md` | ≈（1 點 vs ~0.1 估值） |
| 端點連通總表 | `docs/fal端點連通報告.md` | 本輪環境全表 ⏳ 5xx；**非 404**；OpenAPI 仍 200 |
| 底層總論 | `docs/模型底層邏輯與運作流程.md` | 無 CodeFormer 專節 |
| 結果抽取 | `server/services/fal.ts` `extractResult` | 支援 `image.url` |

## 9. 建議動作

| 優先 | 動作 | 說明 |
|------|------|------|
| — | **維持** points=1、cost=`$0.0021/百萬像素…`、tier=budget | 與 fal $0.0021/MP、realPricePoints=1、校準≈ 一致 |
| — | **維持** verified 現值（已 true） | 本回合零 live；OpenAPI＋計價已交叉；不建議僅因批次 5xx 改 false |
| — | **維持** `input`：`image_url` + `fidelity: 0.7` | 映射正確；0.7 符合產品保守檔 |
| 低 | 可選：刪／改 `models.ts`「端點待確認」註解 | 文件衛生 |
| 低 | 可選：UI 標「免提示詞・只修臉・fidelity 保守」 | 減少 prompt 誤用 |
| 低 | 可選：暴露 fidelity 三檔（保守 0.8／標準 0.5／平滑 0.3） | 對齊產品建議 #13；非必須 |
| 後續 live | 站內上傳糊臉舊照 → 確認扣 1 點、臉清晰且身分可辨 | needs 禁止 `--probe`；走 generate 單次 |
| 後續 L1 | 環境恢復後 `probe-fal-endpoints.ts --yes --only image-to-image` | 預期缺 image_url → 422＝連通；勿與全表 5xx 混淆為 404 |

### 勾選摘要（審計結論）

- [x] **維持**（點數／id／主 input 映射）
- [ ] 調 points
- [ ] 修 input/id（`image_url` + `fidelity` 已正確）
- [ ] verified 變更（禁止本回合改；現為 true）
- [ ] 下架或隱藏

**總評**：目錄契約與官方 OpenAPI／$0.0021/MP **對齊良好**，1 點為合理下限緩衝，情境配方備選定位正確，輸出 `image` 可被站內解析。主要殘差是 **L1 批次環境暫態、live 未跑、歷史註解過時、進階參數未暴露**。結論：**維持**，列 **ready-static-only**。
