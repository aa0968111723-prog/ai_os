# fal-ai/drct-super-resolution

> 審計：R2 · index **#71** · 模式 **static+research（零 live）** · 2026-08-05  
> slug：`fal-ai__drct-super-resolution`  
> 禁止改 `verified`／`points`（本卡僅建議）· **禁止 `--yes`**

## 1. 身分

| 項 | 值 |
|----|-----|
| **index** | 71 |
| **id** | `fal-ai/drct-super-resolution` |
| **endpoint** | `fal-ai/drct-super-resolution`（`endpointOf` = id，無 alias） |
| **label** | DRCT 超解析 |
| **category** | `image-to-image` |
| **tier** | `budget`（最低成本） |
| **kind** | `image` |
| **verified** | `true`（目錄已標；本回合**未** live 覆核；**禁止**本卡改碼） |
| **needs** | `image`（必填來源：要放大的圖） |
| **recommended** | `false` |
| **sourceHint** | 要放大的圖 |
| **strengths** | 較新的 Transformer 忠實放大;性價比佳,中文字安全 |
| **bestFor** | 便宜忠實放大的 A/B 比較備選 |
| **vendor** | **DRCT** Super-Resolution（Transformer 忠實超分；fal Queue 託管） |

**一句話**：**固定 4× 的便宜忠實超解析**——必填 `image_url`，官方 **`upscale_factor` const=4**（不可調）；**$0.0045/MP** → 機械 1MP 基準 **points=1**。站內只送 `image_url`；適合與 ESRGAN／Swin2SR／AuraSR 做 A/B，**中文字安全**（非生成）。

## 2. 數值

| 項目 | 值 | 來源／算法 |
|------|-----|------------|
| **points（目錄）** | **1** | `shared/models.ts`；`realPricePoints` 後仍 1 |
| **cost（目錄）** | `$0.0045/MP` | 無括號階梯 |
| **官方／生態價** | **$0.0045 / megapixel** | `docs/fal生態研究.md` ✅已查證 |
| **parseRealCost** | `usdMid=0.0045` · `multiplier=1` · `×1MP` | 本機 tsx 2026-08-05 |
| **realPricePoints** | `max(1, round(0.0045 × 31))` = `round(0.1395)` = **1** | 下限 1 點 |
| **estimatePoints()** | **1**（扁平） | UI／扣點／退點同口徑 |
| **校準報告** | **≈**（1 點 vs 估 0.1） | `docs/點數校準報告.md`「DRCT 超解析」——1MP 極廉，下限抬到 1 |

**實算情境（固定 4×，面積 ×16）：**

| 來源 | 輸出約 | USD @ $0.0045/MP | NT$ | 合理點 | 站內 |
|------|--------|------------------|-----|--------|------|
| 0.25MP 縮圖 | 4MP | $0.018 | 0.56 | **1** | 1 ✅ |
| 1MP | 16MP | $0.072 | 2.23 | **2** | 1 ⚠ |
| 2MP | 32MP | $0.144 | 4.46 | **4** | 1 ⚠ |

**風險（未改 points）**：

1. **1MP 基準低估大源（P2 計價，非 P0）**：固定 4× 使輸出 MP＝來源×16；常見 1MP 源 → 16MP → 合理約 **2 點**，站內仍 **1**。預算檔毛利薄但單價極低，虧損上限遠小於 Clarity。
2. **校準「≈」靠下限 1**：真實 1MP 輸出成本只有 ~0.14 點——對**小圖**平台偏貴、對**大源 4×**平台偏便宜。
3. **無 $ 階梯／無算秒模糊**：比 AuraSR（算秒）更好機械對帳；**不建議改 points** 除非產品改估點公式為「輸出 MP」。
4. **與姊妹**：ESRGAN 1 點算秒；Thera $0.0021/MP 更便宜且任意倍率；AuraSR 2 點固定 4×。本模定位 **A/B 備選** 正確。

## 3. 連通與生成

| 項目 | 結果 | 說明 |
|------|------|------|
| **L0 靜態契約** | **ok** | id 唯一；欄位齊 |
| **OpenAPI Queue** | **HTTP 200 · schema 有效** | `DrctSuperResolutionInput`／`DrctSuperResolutionOutput`；endpointId=`fal-ai/drct-super-resolution` · about **Run** |
| **平台 metadata** | **HTTP 200 · active** | display_name **DRCT-Super-Resolution** · tags `upscaling`,`high-res` · updated **2026-04-21** · date 2025-02-24（metadata **無** license_type 欄——未宣稱 commercial 字串） |
| **L1** | **本輪未重跑** | 禁止 `--yes`；雙 200 |
| **dry-run verify** | **拒絕（正確）** | needs=image；**未** `--yes` |
| **L2 live** | **未跑** | needs=image |
| **輸出解析** | **契約 OK** | Output `image`（Image）；`extractResult` → `image.url` |
| **結論** | **ready-static-only** | const 4×／input 對齊；大源 MP 毛利待 live 對帳 |

### OpenAPI 摘要（2026-08-05 本輪 curl）

- **required**：`["image_url"]`
- **order**：`upscale_factor` → `image_url`
- **upscale_factor**：integer，**`const: 4`**，default **4**（*Upscaling factor*——**固定 4× 邊長**）
- **image_url**：string（URL of the image to upscale）
- **Output**：`image` only
- **無** prompt／seed／face／overlapping／checkpoint
- **Queue**：`https://queue.fal.run` · `/fal-ai/drct-super-resolution` + status／cancel／result

## 4. 底層邏輯

### 4.1 產品能力（官方／生態）

- **定位**：較新 **Transformer 忠實**超分；生態：ESRGAN／Swin2SR 之外的便宜忠實選項；**中文字安全**。
- **固定 4×**：與 AuraSR 相同「const 4」形態；不能當「目標 4K」API——輸出＝來源×4。
- **vs Thera**：Thera 任意倍率、字卡首選（`sc-text-upscale`）；DRCT 不在配方、作 A/B。
- **vs Swin2SR**：Swin2SR 擅 JPEG 去壓縮（$0.025/MP 更貴）；DRCT 更省。
- **vs ESRGAN**：ESRGAN 可調 scale／face；DRCT 固定 4、無 face。

### 4.2 站內 `input()` 組裝

```ts
// shared/models.ts ~L814–820
input: (_p, _f, s) => ({ image_url: s }),
```

| 官方 property | 站內 | 備註 |
|---------------|------|------|
| `image_url` | ✅ `s` | needs 對齊 |
| `upscale_factor` | ❌ 不送 | 吃 **const／default 4**（送其他值理論上應被 schema 拒） |
| 提示／畫幅 | ❌ | 無語意 |

**P0 input 判定**：**無需修**——required 僅 `image_url`。

### 4.3 架構／分詞

- family **unknown**；免提示詞忠實放大。

### 4.4 已知契約／文案缺口

1. **文案可註「固定 4×」**（P3）：避免使用者期待 2×／目標解析度。
2. **未進 sc-text-upscale**：Thera／AuraSR／Crisp 已滿；DRCT 可作 P3 第四備選。
3. **metadata 無 license_type**：不影響 Queue；商用條款以 fal 頁為準。
4. **verified=true 零 live**：不改。

## 5. 點數路徑

| 步驟 | 行為 |
|------|------|
| 估點 | **1** |
| 缺來源 | needs 擋 |
| 扣點 | reserve 1 |
| 供應商 | **$0.0045 × 輸出 MP**（4× 後） |

**站內帳本自洽**；**對 fal**：小圖安全、大源 4× 略虧（P2）。

## 6. 暴露面

| 面 | 是否暴露 | 說明 |
|----|----------|------|
| 目錄／工作台 | ✅ | budget · 1 點 |
| 情境配方 | ❌ | 無 |
| MCP | ✅ | 需圖 |
| 助手 | ❌ | needs |
| 倍率 UI | ❌ | const 4 |
| probe | ❌ | needs；禁 `--yes` |

**誤用面**：字卡首選仍 Thera；創意補細節走 Clarity／Creative；期待可調 2× → 不行。

## 7. 情境與可用性

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 便宜忠實 4× A/B | ✅ | bestFor |
| 中文字安全放大 | ✅ 次 | 非配方首選 |
| 人像極致 | △ | Crystal／Topaz |
| 生成補細節 | ❌ | 非生成 |
| 任意倍率 | ❌ | const 4；用 Thera |
| 無圖 | ❌ | needs |

## 8. 文件

| 資源 | URL／路徑 | 狀態 |
|------|-----------|------|
| fal Playground | https://fal.ai/models/fal-ai/drct-super-resolution | 公開 |
| OpenAPI | `…?endpoint_id=fal-ai/drct-super-resolution` | **200** |
| metadata | active · upscaling/high-res · 2026-04-21 | 無 license 欄 |
| 生態 | `docs/fal生態研究.md` | ✅ $0.0045/MP |
| 校準 | **≈** 1 vs 0.1 | 下限抬點 |
| 姊妹 | esrgan #58、swin2sr #70、aura-sr #62、thera #65 | 忠實族 |
| 站內 | `shared/models.ts` L814–820 | |

## 9. 建議動作

| 優先 | 動作 | 說明 |
|------|------|------|
| — | **維持** points=1、input image_url、needs | **無 P0**；預算檔合理 |
| — | **維持** verified 目錄值；不改 | 待 L2 |
| P2 | 可選：大圖路徑文案「4× 後按輸出 MP」 | 控預期 |
| P3 | 可選：sc-text-upscale 第四備選 | 與 Thera/Aura/Crisp 並列 |
| P3 | 文案「固定 4×」 | 同 AuraSR |
| live | 小圖 4× 確認扣 1、字邊不重繪 | 禁 `--yes` |

### 勾選摘要

- [x] **維持**
- [ ] 調 points
- [ ] 修 input（**無 P0**）
- [ ] verified 變更
- [ ] 下架

**總評**：schema 極簡、固定 4× 與 strengths 忠實定位一致、點數在 1MP 下限下 **≈**。殘差：大源 4× 略低估、無配方、零 live。結論：**維持** · ready-static-only · **P0：無**。

---

### 本回合證據清單

1. OpenAPI 2026-08-05：required `image_url`；`upscale_factor` **const 4**；Output `image`  
2. metadata：active · DRCT-Super-Resolution · tags upscaling/high-res · updated 2026-04-21  
3. 本機 tsx：points **1**、realPricePoints **1**、input 僅 image_url  
4. verify-models --probe（無 `--yes`）→ needs 拒絕  
5. 生態 $0.0045/MP；校準 ≈  
