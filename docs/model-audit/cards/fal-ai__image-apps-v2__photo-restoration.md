# fal-ai/image-apps-v2/photo-restoration

> 審計：R2 · index **#57** · 模式 **static+research（零 live）** · 2026-08-05  
> slug：`fal-ai__image-apps-v2__photo-restoration`  
> 禁止改 `verified`／`points`（本卡僅建議）

## 1. 身分

| 項 | 值 |
|----|-----|
| **index** | 57 |
| **id** | `fal-ai/image-apps-v2/photo-restoration` |
| **endpoint** | 同 id（無 alias） |
| **label** | 老照片修復(Gemini 版) |
| **category** | `image-to-image` |
| **tier** | `economy` |
| **kind** | `image` |
| **verified** | **`false`**（目錄 ⚠︎；OpenAPI 本輪已實取，待有來源圖 live 後人審） |
| **needs** | `image` |
| **recommended** | `false` |
| **sourceHint** | 要修復的老照片 |
| **strengths** | Gemini 路線修復；破損缺角重建力更強（生成式，中文題字風險高） |
| **bestFor** | image-editing 版修不好時的第二選擇 |
| **vendor** | fal **image-apps-v2** App 化修復（Gemini／Nano-Banana 影像路線敘事） |

**一句話**：與一鍵 image-editing 版同價的 **Gemini 路線**老照修復——缺角／撕裂重建更強，但生成式改動與中文題字風險更高；`sc-old-photo` **pickIds[1]** 備援。

## 2. 數值

| 項目 | 值 | 來源／算法 |
|------|-----|------------|
| **points（目錄）** | **1** | `shared/models.ts`（註解：價格文件曾查不到，推估 1–3 點） |
| **cost（目錄）** | `$0.04/張` | 與 image-editing 版對齊的**目錄寫死**價 |
| **官方價交叉** | 生態研究標 **🔸推定**／校準表仍用 0.04 | 精確官方頁價本環境未 HTML 核；**未改 points** |
| **realPricePoints** | `round(0.04×31)=round(1.24)=**1**` | 若真價偏離 $0.04 需重校 |
| **estimatePoints** | **1** 扁平 | |
| **校準判定** | **≈（假設 cost 真）** | `docs/點數校準報告.md` 1.2≈1；**首跑應對帳** |

**風險（未改 points）**：

- 註解自承「價格文件查不到」卻寫 $0.04——若實際為 Gemini 計價區間，1 點可能倒貼或高估。
- 官方 `enhance_resolution` default **true**（4K 向輸出敘事）；若高解析加價而站內固定 1 點，有低估風險。
- 本輪**禁止**改 points；建議 L2 有圖實測後對 request cost。

## 3. 連通與生成

| 項目 | 結果 | 說明 |
|------|------|------|
| **L0 靜態契約** | **ok** | id 唯一；needs=image；input 僅 image_url；欄位齊 |
| **OpenAPI Queue** | **HTTP 200** | `ImageAppsV2PhotoRestorationInput`／`Output`；required **`["image_url"]`** |
| **L1 歷史 probe** | **⏳ 暫時性** | `docs/fal端點連通報告.md` 列暫時性(5xx/逾時)；環境性，非 404 |
| **live / probe 腳本** | **未跑** | needs=image → `verify-models --probe` **拒絕**；無 FAL_KEY |
| **結論** | **ready-static-only** | schema 存在且與 input 對齊；verified 仍 false 合理 |

### OpenAPI 摘要（2026-08-05 本輪 curl）

- **required**：`image_url`（Old or damaged photo URL）
- **order**：`image_url` → `enhance_resolution` → `fix_colors` → `remove_scratches` → `aspect_ratio`
- **enhance_resolution**：bool default **true**
- **fix_colors**：bool default **true**
- **remove_scratches**：bool default **true**
- **aspect_ratio**：`$ref AspectRatio` — object `{ ratio: enum 1:1|16:9|9:16|4:3|3:4 }`，ratio default **1:1**（描述另寫「4K output；default 4:3 classic」— **描述與 schema default 不一致**，以 schema default 1:1 為準）
- **Output**：`images[]` only（**無** seed 欄，異於 image-editing 版）
- **無** `prompt`／`guidance_scale`／`num_inference_steps`／`seed`（與 image-editing 版 schema **不同族**）

## 4. 底層邏輯

### 4.1 產品能力

- **定位**：App 化一鍵老照修復——刮痕、撕裂、褪色；生成式重建缺角能力強（生態敘事）。
- **對照 image-editing 版（#56）**：
  | | image-editing | image-apps-v2（本卡） |
  |--|---------------|----------------------|
  | 路線 | 任務型修復管線 | Gemini／App 路線 |
  | tier | flagship | economy |
  | verified | true | **false** |
  | 可調 | guidance／steps／safety／seed | enhance／fix_colors／remove_scratches／aspect |
  | 站內 | 僅 image_url | 僅 image_url（三開關全吃 default true） |

### 4.2 站內 `input()`

```ts
input: (_p, _f, s) => ({ image_url: s })
```

| 官方 | 站內 | 備註 |
|------|------|------|
| `image_url` | ✅ | |
| 使用者 prompt | ❌ 忽略 | 免提示詞 |
| `enhance_resolution` 等 | ❌ 全 true | 無法「只修刮痕不上色」 |
| `aspect_ratio` | ❌ | 無法對齊 ProjectFormat；官方 4K 向 ratio |
| seed | 無 | |

### 4.3 已知缺口

1. **verified false** + 價推定：優先有圖 live 對帳。
2. **三開關未暴露**：重度生成預設全開 → 中文題字／五官改動風險高於「保守」路徑。
3. **aspect 未映射**；schema default 與 description 4:3 矛盾。
4. 與 #56 同 cost 字串但供應商路線不同——勿假設帳單行為完全相同。

## 5. 站內點數路徑

```
需來源圖 → estimatePoints=1 → reserveQuota(1)
  → falSubmit("fal-ai/image-apps-v2/photo-restoration", { image_url })
  → 失敗 refund(1)
```

| 檢查 | 結果 |
|------|------|
| 顯示／扣／退 | 1 一致 |
| verified false | 首跑失敗應退點；**勿**自動翻 true |

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| 選擇器 i2i economy | ✅ | needs 攔截 |
| catalog / tRPC / MCP | ✅ | |
| `sc-old-photo` | ✅ | **pickIds[1]** |
| 三開關／aspect UI | ❌ | |
| `verify-models --probe` | ❌ | needs=image |

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| image-editing 修不好的缺角／撕裂 | ✅ 次選 | bestFor |
| 一般泛黃刮痕 | △ | 優先 #56 一鍵 |
| 含中文題字／匾額 | ⚠ 高風險 | 生成式；校對或改忠實鏈 |
| 必須忠於本人五官 | ⚠ | 偏重建；可 CodeFormer 高 fidelity |
| 無來源圖 | ❌ | |

## 8. 文件

| 來源 | 用途 |
|------|------|
| fal Queue OpenAPI | `endpoint_id=fal-ai/image-apps-v2/photo-restoration`（本輪 200） |
| 模型頁 | https://fal.ai/models/fal-ai/image-apps-v2/photo-restoration |
| 站內 | `shared/models.ts` L696–702；sc-old-photo pick[1] |
| 姊妹卡 | `cards/fal-ai__image-editing__photo-restoration.md` #56 |
| 生態／校準 | `docs/fal生態研究.md`；`docs/點數校準報告.md`；`docs/模型清查清單.md` ⚠ |

## 9. 建議動作

- [x] **維持** id＝endpoint、points=1（價未實核前不改）
- [x] **維持** verified=false（禁止本輪自動 true）
- [x] **維持** input 僅 image_url
- [ ] **有圖 live**：站內素材實測 + 對 fal 帳單是否 ≈$0.04
- [ ] **P2 UI**：可關 `fix_colors`／`enhance_resolution` 做「保守」檔
- [ ] **P2 文案**：標「生成式備援、題字高風險」；預設推 #56
- [ ] **P3**：`aspect_ratio: { ratio: aspect(f) }`（注意 enum 無 21:9）
- [ ] **勿** `verify-models --probe`（needs）
- [ ] 價核後若不符 $0.04 → **人審**改 cost／points 並註記

**L0 結論**：OpenAPI 綠、input 對齊 required；與 #56 不同 schema 族。剩餘：verified／真實單價／三開關產品化。
