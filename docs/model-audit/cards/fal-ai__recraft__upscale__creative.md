# fal-ai/recraft/upscale/creative

> 審計：R2 · index **#69** · 模式 **static+research（零 live）** · 2026-08-05  
> slug：`fal-ai__recraft__upscale__creative`  
> 禁止改 `verified`／`points`（本卡僅建議）· **禁止 `--yes`**  
> 姊妹 **#68** crisp 已有卡 → 本回合**不**重寫 crisp

## 1. 身分

| 項 | 值 |
|----|-----|
| **index** | 69 |
| **id** | `fal-ai/recraft/upscale/creative` |
| **endpoint** | `fal-ai/recraft/upscale/creative`（`endpointOf` = id，無 alias） |
| **label** | Recraft 創意放大 |
| **category** | `image-to-image` |
| **tier** | `economy`（經濟） |
| **kind** | `image` |
| **verified** | `true`（目錄已標；本回合**未** live 覆核；**禁止**本卡改碼） |
| **needs** | `image`（必填來源：要放大的主視覺） |
| **recommended** | `false` |
| **sourceHint** | 要放大的主視覺 |
| **strengths** | 生成式創意放大;大幅補細節、品質高但單價貴 |
| **bestFor** | 要印大圖的主視覺;含中文字有改字風險不建議 |
| **vendor** | **Recraft** Creative Upscale（生成式清晰／補細節；fal Queue；與 crisp 同 group `fal-ai/recraft/upscale`） |

**一句話**：**固定單價的生成式高階放大器**——必填 `image_url`（schema 註 **Must be in PNG format**），無倍率／prompt 旋鈕；官方 **$0.25／張** → 站內 **points=8**（`0.25×31≈7.75` 四捨五入）與校準 **≈** 一致。適合少數主視覺；**字卡勿用**。

## 2. 數值

| 項目 | 值 | 來源／算法 |
|------|-----|------------|
| **points（目錄）** | **8** | `shared/models.ts`；`realPricePoints` 覆寫後仍 8 |
| **cost（目錄）** | `$0.25/張` | 固定張價 |
| **官方／生態價** | **$0.25／張** | `docs/fal生態研究.md` ✅已查證 |
| **parseRealCost** | `usdMid=0.25` · `multiplier=1` · `×1（每次一件）` | 本機 tsx 2026-08-05 |
| **realPricePoints** | `max(1, round(0.25 × 1 × 31))` = `round(7.75)` = **8** | `USD_TO_TWD=31` |
| **estimatePoints()** | **8**（扁平） | UI／扣點／退點同口徑 |
| **校準報告** | **≈**（8 點 vs 估 7.8） | `docs/點數校準報告.md`「Recraft 創意放大」 |

**風險（未改 points）**：

1. **張價固定 → 點數對齊良好**：與 Clarity #60（MP 價卻扣 1）對照，本模 **8 點 ≈ $0.25** 正確，**不構成改 points 的條件**。
2. **單價高不適合批量**：bestFor／生態已警示；產品勿放進大量配方。
3. **生成式字卡風險**：strengths 已寫；與 crisp（非生成、$0.004）定位互補。
4. **PNG 格式約束（契約）**：OpenAPI 描述 *Must be in PNG format*——站內素材若為 JPEG／WebP，可能 4xx／品質異常；**非**缺 required 欄（P0 不成立），屬 **P2 產品／上傳** 風險。

## 3. 連通與生成

| 項目 | 結果 | 說明 |
|------|------|------|
| **L0 靜態契約** | **ok** | id 唯一；欄位齊 |
| **OpenAPI Queue** | **HTTP 200 · schema 有效** | `RecraftUpscaleCreativeInput`／`RecraftUpscaleCreativeOutput`；`x-fal-metadata.endpointId=fal-ai/recraft/upscale/creative` · about **Creative Upscale Image** |
| **平台 metadata** | **HTTP 200 · active** | display_name **Recraft Creative Upscale** · tags `upscaling` · license **commercial** · updated **2026-04-21** · date 2025-05-07 · group `fal-ai/recraft/upscale` |
| **L1 批次 probe** | **本輪未重跑** | 禁止 `--yes`；OpenAPI＋metadata 雙 200 |
| **dry-run verify** | **拒絕（正確）** | `--probe` → needs=image；**未**加 `--yes` |
| **L2／L4 live** | **未跑** | needs=image；**禁止** `--yes` |
| **輸出解析** | **契約 OK** | Output `image`（File：url…）；`extractResult` 支援 `result.image.url` |
| **結論** | **ready-static-only** | required／input／點數對齊；PNG 約束與生成品質待 live |

### OpenAPI 摘要（2026-08-05 本輪 curl）

- **required**：`["image_url"]`
- **order**：`sync_mode` → `image_url` → `enable_safety_checker`
- **image_url**：string；描述 **The URL of the image to be upscaled. Must be in PNG format.**
- **sync_mode**：boolean，default **false**（true 則 data URI、歷史不可用）
- **enable_safety_checker**：boolean，default **false**
- **Output**：`image`（File，$ref）required
- **無** `prompt`／`scale`／`upscale_factor`／`seed`／`creativity`
- **Queue**：`https://queue.fal.run` · paths `/fal-ai/recraft/upscale/creative` + status／cancel／result

## 4. 底層邏輯

### 4.1 產品能力（官方／生態）

- **定位**：Recraft **生成式**創意放大——提高解析、更銳利乾淨、大幅補細節；單價高（$0.25），留給正式對外主視覺。
- **vs Crisp**（#68）：Crisp 非生成、$0.004／張、字卡安全、budget 1 點；Creative 生成、貴、字有風險。
- **vs Clarity**（#60）：Clarity 按 MP、可調 creativity／factor；本模固定張價、API 極簡。
- **vs Topaz**（#61）：Topaz 照片級自然感、階梯價；本模偏「更銳更乾淨」的生成補細節。

### 4.2 站內 `input()` 組裝

```ts
// shared/models.ts ~L798–804
input: (_p, _f, s) => ({ image_url: s }),
```

| 官方 property | 站內 | 備註 |
|---------------|------|------|
| `image_url` | ✅ `s` | 與 needs 一致；**未**強制 PNG 轉換 |
| `sync_mode` | ❌ 不送 | 吃 **false**（正確：保留 request history／CDN URL） |
| `enable_safety_checker` | ❌ 不送 | 吃 **false**（官方 default） |
| 提示詞 `p` | ❌ 丟棄 | schema 無 prompt |
| 畫幅 `f` | ❌ 忽略 | 無 aspect 旋鈕 |

**P0 input 判定**：**無需修**——required 僅 `image_url`。PNG 約束屬素材／預處理層，非缺欄 422。

### 4.3 架構／分詞

- family **unknown**；提示對 payload 無作用。
- 使用者應上傳**主視覺圖**（理想 PNG），不是寫「印大圖」文字。

### 4.4 已知契約／文案缺口

1. **PNG only（P2）**：schema 明文；站內未轉換／未在 sourceHint 標「PNG」。
2. **safety_checker 預設關**：與多數 fal 模型預設 true 不同；產品若在意安全可顯式送 true（會否改帳單未知）。
3. **無情境配方**：未進 `sc-ai-upscale`（Clarity／Topaz）；合理——單價 8 點、非日常。
4. **verified=true 零 live**：本卡不改。

## 5. 點數路徑

| 步驟 | 行為 |
|------|------|
| 估點 | `estimatePoints` → **8** |
| 缺來源 | needs=image → BAD_REQUEST（sourceHint：要放大的主視覺） |
| 扣點 | `reserveQuota(…, est=8)` |
| 供應商實帳 | **固定 $0.25／成功請求**（與輸出尺寸無關——與 MP 價模型不同） |

**一致性**：站內 8 ＝ realPricePoints ＝ 校準 ≈——**對 fal 成本良好**。

## 6. 暴露面

| 面 | 是否暴露 | 說明 |
|----|----------|------|
| 模型目錄／工作台 | ✅ | image-to-image · economy · 8 點 |
| 情境配方 | ❌ | 無 pickIds |
| MCP find／submit | ✅ | submit 必須來源圖 |
| 助手代操 | ❌ | needs 擋 |
| Seed／負向／倍率 UI | ❌ | schema 無 |
| verify probe | ❌ | needs 拒絕；禁止 `--yes` |

**誤用面**：

- 字卡／中文細字 → **Crisp／Thera／AuraSR**，勿本模。
- 日常大量銳化 → **Crisp $0.004**。
- 人像極致臉 → **Crystal**。
- 印刷自然無塑膠 → **Topaz**。
- JPEG 來源未轉 PNG → 可能失敗（P2）。

## 7. 情境與可用性

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 少數主視覺印大圖 | ✅ | bestFor 核心；$0.25 值得 |
| AI 圖補細節交付 | ✅ | 生成式 |
| 中文字卡 | ❌ | 改字風險 |
| 批量銳化 | ❌ | 用 Crisp |
| 人像旗艦 | △ | Crystal 更專 |
| 無來源圖 | ❌ | needs |

## 8. 文件

| 資源 | URL／路徑 | 狀態 |
|------|-----------|------|
| fal Playground | https://fal.ai/models/fal-ai/recraft/upscale/creative | 公開 |
| OpenAPI | `…?endpoint_id=fal-ai/recraft/upscale/creative` | **200** |
| metadata | api.fal.ai/v1/models?endpoint_id=… | **active** · commercial · 2026-04-21 |
| 生態研究 | `docs/fal生態研究.md` | ✅ $0.25/張 |
| 校準 | `docs/點數校準報告.md` | **≈** 8 vs 7.8 |
| 姊妹卡 | `fal-ai__recraft__upscale__crisp.md`（#68） | 非生成對照 |
| 站內註冊 | `shared/models.ts` L798–804 | input 僅 image_url |

## 9. 建議動作

| 優先 | 動作 | 說明 |
|------|------|------|
| — | **維持** points=8、tier=economy、cost `$0.25/張` | 機械對齊；**不改 points** |
| — | **維持** input `{ image_url }`、needs=image | **無 P0 input** |
| — | **維持** verified 目錄 true；本回合不改 | 待 L2 覆核 |
| P2 | sourceHint／UI 註「建議 PNG」 | 對齊 OpenAPI *Must be in PNG format* |
| P3 | 可選：上傳管線自動轉 PNG | 降 4xx 率 |
| P3 | 勿加入 sc-text-upscale | 生成式字卡危險 |
| 後續 live | 合法 PNG 主視覺單次 → 確認扣 8、輸出可解析 | **勿** `--yes` |

### 勾選摘要

- [x] **維持**（點數／input／id）
- [ ] 調 points
- [ ] 修 input/id（**無 P0**）
- [ ] verified 變更
- [ ] 下架

**總評**：OpenAPI 極簡、required 對齊、**points=8 與 $0.25 精準 ≈**。殘差：PNG 約束未產品化、零 live、無配方（可接受）。結論：**維持** · ready-static-only · **P0：無**。

---

### 本回合證據清單

1. OpenAPI 2026-08-05：required `image_url`；sync_mode default false；enable_safety_checker default false；Output `image`；PNG 描述  
2. metadata：active · Recraft Creative Upscale · upscaling · commercial · updated 2026-04-21  
3. 本機 tsx：realPricePoints **8**、input 僅 image_url  
4. verify-models --probe（無 `--yes`）→ needs 拒絕  
5. 校準 ≈；生態 $0.25/張；#68 crisp 卡已存在故跳過  
