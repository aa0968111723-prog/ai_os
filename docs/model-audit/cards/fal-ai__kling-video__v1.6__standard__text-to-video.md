# fal-ai/kling-video/v1.6/standard/text-to-video

> 審計：R3 · index **#123** · static+research · 2026-08-05（升 shallow→九章）  
> slug：`fal-ai__kling-video__v1.6__standard__text-to-video`  
> OpenAPI **200**（本輪直拉）；**!needs**；零 live（無 KEY）。  
> **未**改 verified／points／models.ts。

## 1. 身分

| 項 | 值 |
|----|-----|
| index | **123** |
| 站內 id | `fal-ai/kling-video/v1.6/standard/text-to-video` |
| endpoint | **同 id** |
| label | Kling 1.6 Standard |
| category / kind | **text-to-video** · video |
| tier | **budget** |
| points（執行時） | **9**（`realPricePoints` 自 cost） |
| cost | `$0.056/秒(standard;pro 約 $0.095/秒);按秒計費,點數為 6 秒基準` |
| verified | **true**（歷史；本輪無 live 複驗） |
| needs | **無** |
| recommended | false |
| strengths | Kling 舊世代低價版;動態仍可用 |
| bestFor | 試鏡頭、抓動作節奏的草稿 |
| 供應商 | Kling 1.6 **std** · fal queue |
| 姊妹 | Kling Pro 系、Wan-t2v、Pika 2.2、Hailuo 02 |

**一句話**：**Kling 1.6 Standard** 預算草稿 t2v——required `prompt`；aspect **16:9／9:16／1:1 全綠**；站內鎖 **duration=`"5"`**；`$0.056×5×31≈9`。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| 目錄／執行 points | **9** |
| cost 首價 | **$0.056／秒**（standard） |
| Pro 對照（文案） | ~$0.095／秒（他端） |
| `parseRealCost` | usdMid=**0.056** · multiplier=`PRICE_VIDEO_SECONDS`=**5** |
| `realPricePoints` | `0.056 × 5 × 31 = 8.68` → **round 9** |
| 站內送出時長 | **`"5"`**（與機械 ×5 **對齊**） |
| cost「6 秒基準」 | 文案 **P2** vs 實際 ×5／input 鎖 5 |

### 校準對照

| 設定 | USD | NT$ | vs 9 點 |
|------|-----|-----|---------|
| **5s × $0.056（站內）** | 0.28 | 8.7 | **≈** |
| 6s × $0.056（cost 文案） | 0.336 | 10.4 | 文案略高 |
| 10s × $0.056 | 0.56 | 17.4 | 若改 duration=10 **低估**（現鎖 5） |

**結論：** **維持 points=9**；時長已鎖 5 → 估點健康。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| L0 契約 | **ok** |
| fal OpenAPI | **200** `KlingVideoV16StandardTextToVideoInput`／`…Output` |
| about | Kling 1.6 (std) Text to Video API |
| required | **`prompt` only**（maxLength **2500**） |
| optional | duration、aspect_ratio、negative_prompt、cfg_scale |
| output | **`video`** |
| L2 | 未跑（無 KEY） |
| 結論 | **ready-static-only**（契約綠） |

### 站內 input

```ts
input: (p, f) => ({ prompt: p, aspect_ratio: aspect(f), duration: "5" }),
```

| format | aspect_ratio | OpenAPI enum |
|--------|--------------|--------------|
| 16:9 | `"16:9"` | ✅ |
| 9:16 | `"9:16"` | ✅ |
| 1:1 | `"1:1"` | ✅ **綠**（無需映射） |

| 欄 | 站內 | 官方 | 備註 |
|----|------|------|------|
| prompt | ✅ | required ≤2500 | |
| aspect_ratio | ✅ 三比例 | **恰** 16:9｜9:16｜1:1 | **完美對齊** |
| duration | ✅ **`"5"`** | enum `"5"`｜`"10"` def `"5"` | 字串；鎖 5 防 10s 低估 |
| negative_prompt | 未送 | def blur… | 吃官方 |
| cfg_scale | 未送 | def **0.5**（0–1） | |

### OpenAPI 摘要（本輪 200）

- **required**: `prompt`
- **duration**: string **`5`｜`10`**，def **`5`**
- **aspect_ratio**: **`16:9`｜`9:16`｜`1:1`**，def `16:9`
- **negative_prompt**: max 2500，def quality 負向
- **cfg_scale**: number 0–1，def 0.5
- **output**: `video` required
- **無** resolution 分檔（std 固定檔）

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 定位 | Kling **舊世代 Standard** 低價草稿／節奏試鏡 |
| vs 新 Kling | 畫質／遵從通常較新版弱；勝在 **budget** |
| vs Wan-t2v | 同 budget 帶；Kling 品牌動態語感 |
| 時長 | 僅 5／10 兩檔；站內**主動鎖 5**（優於多數只吃預設） |

---

## 5. 站內扣點／退點

```
realPricePoints → 9
→ reserveQuota(9)
→ falSubmit("…/kling-video/v1.6/standard/text-to-video",
            { prompt, aspect_ratio, duration: "5" })
→ 失敗 refund(9)
```

| 檢查 | 結果 |
|------|------|
| 9 ≈ $0.056×5×31 | **對齊** |
| duration 鎖 5 | **防 10s 扁平低估** |
| verified true | 歷史不改 |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| 生成台 text-to-video | ✅ | budget |
| 三比例 | ✅ | schema 全支援 |
| 10s 旋鈕 | ❌ | 未接（正確避免虧點） |
| recommended | ❌ | |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 試鏡頭／動作節奏草稿 | ✅ | bestFor |
| 直式／方圖 | ✅ | 1:1／9:16 綠 |
| 旗艦寫實成片 | ❌ | → 新 Kling／Veo／Hailuo Pro |
| 10 秒連續動作 | △ | 需 duration=10 + 重估點 |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| `shared/models.ts` | #123 · prompt+aspect+duration`"5"` · points9 |
| OpenAPI 本輪 | required prompt；aspect 恰三比例；duration 5/10 |
| fal 模型頁 | https://fal.ai/models/fal-ai/kling-video/v1.6/standard/text-to-video |

---

## 9. 建議動作

- [x] 升 shallow→九章；OpenAPI 直核  
- [x] 確認 aspect **全綠**、duration 鎖 5 **對齊估點**  
- [x] **維持** points=9／verified；不改 input  
- [ ] **P2 文案：** cost「6 秒基準」→ 改「5 秒」與 `PRICE_VIDEO_SECONDS`／input 一致  
- [ ] L2（有 KEY）：短 prompt 探活  

**裁決：維持**（契約優；價點對齊；零 live）
