# fal-ai/seedvr/upscale/image

> 審計：R2 · index **#66** · static+research · 2026-08-05（升 thin→九章）  
> slug：`fal-ai__seedvr__upscale__image`  
> OpenAPI **200**（本輪直拉）→ 端點活躍；**needs=image**。  
> verified 目錄已 **true**（本輪**不**改）；L2 需素材 **未**跑。  
> **未**改 points／input。

## 1. 身分

| 項 | 值 |
|----|-----|
| index | **66** |
| 站內 id | `fal-ai/seedvr/upscale/image` |
| endpoint | **同 id**（活躍） |
| label | SeedVR2 影像放大 |
| category / kind | **image-to-image** · image |
| tier | **economy** |
| points（執行時） | **1**（`$0.001/MP` → floor） |
| cost | `$0.001/MP(seamless 版 $0.0025/MP)` |
| verified | **true**（目錄既有；本輪不改） |
| needs | **image** |
| recommended | false |
| strengths | 可到 10K 超大輸出、極便宜;風格偏乾淨略帶 AI 感 |
| bestFor | 展場大圖、印刷跨頁的省錢放大;精細中文字搭 Thera |
| sourceHint | 要放大的圖 |
| 供應商 | SeedVR2 · fal（字節系） |
| 姊妹 | seedvr/upscale/video、topaz/upscale/image、thera |

**一句話**：**SeedVR2 影像放大**——required **`image_url`**；站內只送 URL、預設 **factor=2**；`$0.001/MP → 1 點` floor；**無 L2**（needs）。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| points | **1** |
| cost | **$0.001／MP**（cost 字串另提 seamless $0.0025／MP＝**他端**） |
| `parseRealCost` | usdMid≈**0.001** · per MP |
| `realPricePoints` | `0.001 × 31 × MP` → 小圖 **floor 1**；大圖仍常 1 |
| 預設 upscale_mode | **factor** |
| 預設 upscale_factor | **2**（1–10） |
| 預設 target_resolution | **1080p**（mode=target 時） |
| 預設 noise_scale | **0.1** |
| 預設 output_format | **jpg** |

### 校準對照

| 設定 | USD | NT$ | vs 1 點 |
|------|-----|-----|---------|
| 1MP × $0.001 | 0.001 | 0.03 | **floor 1**（高估多） |
| 4MP ×2 倍輸出量級 | 仍極低 | | 1 點仍寬 |
| factor=10 → 極大 | 依輸出 MP | | 扁平 1 **P2** 風險 |

**結論：** **維持 points=1**；經濟放大地板。極限 10× 大圖若實價上漲需再核 **P2**。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| L0 契約 | **ok** |
| fal OpenAPI | **200** `SeedvrUpscaleImageInput`／Output |
| about | Upscale Image |
| required | **`image_url` only** |
| output | **image**（單檔）+ seed |
| L2 live | **未跑**（needs=image；審計 L 路徑不送素材） |
| 結論 | **ready-static**（契約綠；verified 已 true） |

### 站內 input

```ts
input: (_p, _f, s) => ({ image_url: s }),
```

| 欄 | 站內 | 官方 | 備註 |
|----|------|------|------|
| image_url | ✅ | required | needs=image |
| upscale_mode | 未送 | def **factor** | |
| upscale_factor | 未送 | def **2** max 10 | **P2** 未暴露 |
| target_resolution | 未送 | 720p–2160p | mode=target 才用 |
| noise_scale | 未送 | def 0.1 | |
| output_format | 未送 | png｜jpg｜webp def jpg | |
| seed | 未送 | optional | |
| prompt／format | ❌ | 無 | 非 t2i |

### OpenAPI 摘要（本輪 200）

- **required**: `image_url`
- **upscale_mode**: `target`｜`factor`，def **factor**
- **upscale_factor**: 1–10，def **2**（mode=factor）
- **target_resolution**: 720p｜1080p｜1440p｜2160p，def 1080p（mode=target）
- **noise_scale**: 0–1，def 0.1
- **output_format**: png｜jpg｜webp，def **jpg**
- **無** prompt／aspect_ratio／image_size

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 定位 | 省錢大圖放大；可到高解析（敘事 10K） |
| vs Topaz | 場景 pick 並列；Topaz 偏品質／商用 |
| vs Thera | bestFor：精細中文 → Thera；本檔偏整圖便宜放大 |
| seamless | cost 字串提及＝**另一計價／端點**，本 id 非 seamless |

---

## 5. 站內扣點／退點

```
realPricePoints → 1
→ reserveQuota(1)
→ falSubmit("fal-ai/seedvr/upscale/image", { image_url })
→ 失敗 refund(1)
```

| 檢查 | 結果 |
|------|------|
| 1 點 floor vs $0.001/MP | **偏保守、可接受** |
| needs=image | 無 source 不可跑 |
| verified true | **維持**（不改） |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| 生成台 image-to-image | ✅ | 需上傳圖 |
| 放大場景 pickIds | ✅ | 與 topaz |
| recommended | ❌ | |
| factor／target UI | ❌ | 全走預設 2× |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 展場／印刷大圖省錢 | ✅ | bestFor |
| 精細中文字卡放大 | △ | → Thera（bestFor 已註） |
| 人像極致臉部 | △ | → Crystal |
| 自訂 4×／8× | △ | UI 未接 factor **P2** |
| 無圖純文 | ❌ | needs=image |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| `shared/models.ts` | #66 · image_url · points1 · verified true · needs image |
| OpenAPI 本輪 | image_url；factor def2 max10；target 模式 |
| fal 模型頁 | https://fal.ai/models/fal-ai/seedvr/upscale/image |

---

## 9. 建議動作

- [x] 升 thin→九章；OpenAPI 直核  
- [x] required `image_url` **綠**；站內契約對齊  
- [x] **維持** points=1；**不**改 verified（已 true）  
- [ ] **P2：** 暴露 upscale_factor／target_resolution；大 factor 動態估點  
- [ ] **P2：** cost 字串 seamless 易誤解 → 註「他端」或拆模型  
- [ ] L2 需有圖素材人工／fixture 再跑  

**裁決：維持**（契約綠；needs；verified 已 true）
