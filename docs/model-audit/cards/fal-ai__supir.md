# fal-ai/supir

> 審計：R2 · index **#64** · static+research · 2026-08-05  
> slug：`fal-ai__supir`  
> 零 live；**未**改 verified／points。needs=image。

## 1. 身分

| 項 | 值 |
|----|-----|
| id / endpoint | `fal-ai/supir`（無 alias；OpenAPI **200**） |
| label | SUPIR 重建放大 |
| category / kind | **image-to-image** · image |
| tier | **flagship** |
| points | **3**（手填；cost 無 `$`） |
| cost | `查不到精確價` |
| verified | **false** |
| needs | **image** |
| recommended | false |
| sourceHint | 極破損/極低清的照片 |
| strengths | 重度生成式修復放大;極破損素材大幅重建(會二次創作,需人工把關) |
| bestFor | 糊到其他工具救不回的最後手段;字卡勿用 |
| vendor | SUPIR（生成式超解析／修復）via fal |

**一句話**：**重度生成式**放大修復——極糊最後手段；會二次創作五官／細節；**字卡禁用**；站內只送 `image_url`，吃官方預設 upscale=2 與預設 a/n prompt。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| points | **3** |
| cost | 查不到精確價（生態：免費試用+付費） |
| `parseRealCost` | 無 `$` → **null** |
| `realPricePoints` | **不覆寫** |
| estimatePoints | 扁平 **3** |
| 校準報告 | **需人工** |

**風險**：`edm_steps` 預設 50（最高 500）、tile 開、大圖可能遠超 3 點——站內未暴露旋鈕，仍吃預設；實帳待 live 對帳。**禁止本輪改 points**。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| L0 | **ok** |
| OpenAPI | **HTTP 200** · `SupirInput`／`SupirOutput` |
| input | `{ image_url: s }` ✅ required |
| prompt | 站內 `_p` **丟棄** → 不送使用者稿；官方 `a_prompt`／`n_prompt` 吃**預設字串** |
| 輸出 | `image` + `seed` → `extractResult` 認 `image.url` ✓ |
| live | **未跑**（needs；無 KEY） |
| 結論 | **ready-static-only** |

### OpenAPI 摘要（2026-08-05）

- **required**：`["image_url"]`
- **order**：image_url → model_type → upscale → tile… → a_prompt → n_prompt → … → seed → per_tile_llava_prompt
- `upscale`：integer，default **2**
- `model_type`：`Q`\|`F`，default **Q**
- `edm_steps`：default **50**（1–500）
- `use_llava`：default **false**（自動 caption；關則空 prompt）
- `a_prompt`：default 長串「hyper detailed…」
- `n_prompt`：default「blurring, dirty…」
- `color_fix_type`：None\|AdaIn\|**Wavelet**
- 大量 stage／CFG／tile 旋鈕（站內皆不送）
- **Output**：`image` + `seed`
- **無** 頂層 `prompt` 必填（additive 用 a_prompt）

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 產品 | SUPIR：**生成式**重建放大，細節豐但會改內容 |
| vs 忠實 | AuraSR／Thera／ESRGAN＝少幻覺；本模＝最後手段 |
| vs Clarity | 皆生成向；SUPIR 更偏破損重建 |
| 站內 | 僅 image_url；**不**把 UI 提示詞接到 a_prompt |
| 中文／字卡 | **高改動風險** → bestFor 已寫勿用 |
| 見證人像 | 慎用並人工把關（生態警告） |

| 官方 | 站內 |
|------|------|
| image_url | ✅ |
| a_prompt／n_prompt | 吃預設（使用者稿未傳） |
| upscale=2 | 不送 |
| seed／llava／tile | 不送 |

---

## 5. 站內扣點／退點

```
estimatePoints → 3
→ needs=image → falSubmit("fal-ai/supir", { image_url })
→ extractResult(image) → 失敗 refund(3)
```

| 檢查 | 結果 |
|------|------|
| 顯示／扣／退 | 一致 3 |
| 實帳 | 未知價；可能低估 |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| i2i 旗艦 | ✅ | needs=image |
| MCP | ✅ | 須來源圖 |
| upscale／steps UI | ❌ | 預設 2×／50 steps |
| 使用者 prompt→a_prompt | ❌ | 丟棄 |

**MCP 陷阱**：勿當字卡放大器；勿期望 prompt 控制（目前未接 a_prompt）。

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 極糊／破損舊照最後手段 | ✅ | bestFor |
| 字卡／中文書法放大 | ❌ | 生成改字 |
| 見證忠於本人 | ⚠ | 二次創作風險 |
| 日常 4× 忠實 | ❌ | AuraSR／Thera |
| 創意補細節 4K | △ | Clarity 更常路線 |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| OpenAPI | `…?endpoint_id=fal-ai/supir`（**200**） |
| Playground | https://fal.ai/models/fal-ai/supir |
| 生態／校準 | 價格 🔸；需人工 3 點 |

---

## 9. 建議動作

- [x] **維持** id／input `{image_url}`／points=3／verified=false  
- [ ] **verified true** — 待有圖 live + 帳單抽樣後人審  
- [ ] **可選 P2**：可選把使用者 prompt 映射 `a_prompt`（或文件標「提示無效」）  
- [ ] **可選 P3**：暴露 upscale／model_type Q\|F；成本警示  
- [ ] **L2**（KEY+素材）：單次 live 對帳秒費  
- [ ] **勿**進 sc-text-upscale  

**L0 結論**：OpenAPI 綠；required 對齊；生成式風險文案正確；價未知扁平 3。  
**未做：** live、改 points／verified。
