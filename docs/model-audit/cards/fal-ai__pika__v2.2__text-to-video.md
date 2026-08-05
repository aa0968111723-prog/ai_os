# fal-ai/pika/v2.2/text-to-video

> 審計：R3 · index **#118** · static+research · 2026-08-05（升 shallow→九章）  
> slug：`fal-ai__pika__v2.2__text-to-video`  
> OpenAPI **200**（本輪直拉）；**!needs**；零 live（無 KEY）。  
> **未**改 verified／points／models.ts（禁自動改 points）。

## 1. 身分

| 項 | 值 |
|----|-----|
| index | **118** |
| 站內 id | `fal-ai/pika/v2.2/text-to-video` |
| endpoint | **同 id** |
| label | Pika 2.2 |
| category / kind | **text-to-video** · video |
| tier | **economy** |
| points（執行時） | **6**（`realPricePoints` 自 cost 覆寫；字面手填 10 不生效） |
| cost | `$0.2/5秒(720p)、$0.45/5秒(1080p)` |
| verified | **true**（歷史；本輪無 live 複驗） |
| needs | **無** |
| recommended | false |
| strengths | 創意特效與關鍵影格過渡;風格化強 |
| bestFor | 活潑轉場、片頭特效、社群短片 |
| 供應商 | Pika 2.2 · fal queue（about：t2i→i2v 兩段、高品質檔） |
| 姊妹 | Ray-2 Flash、Seedance Lite、Hailuo 02 Standard |

**一句話**：**Pika 2.2** 經濟風格化文生片——required `prompt`；aspect 含 **1:1** 全綠；預設 **720p／5s** 對齊 **$0.2 → 6 點**。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| models.ts 字面 points | **10**（過期手填） |
| 執行時 points | **6**（載入後 `realPricePoints` 覆寫） |
| cost 首價 | **$0.2／5 秒（720p）** |
| `parseRealCost` | usdMid=**0.2** · multiplier=**1**（`/5秒` 固定支，非 ×PRICE_VIDEO_SECONDS） |
| `realPricePoints` | `0.2 × 1 × 31 = 6.2` → **round 6** |
| 1080p 對照 | **$0.45／5 秒** → 0.45×31≈**14**（站內未鎖 1080p） |
| 10s 檔 | 預設未送；若送 duration=10 實費約 **2×** 仍扣 6 → **P2** |

### 校準對照

| 設定 | USD | NT$ | vs 執行時 6 點 |
|------|-----|-----|----------------|
| **5s · 720p（預設／站內）** | 0.20 | 6.2 | **≈** |
| 5s · 1080p | 0.45 | 14.0 | 若誤開 1080 **低估** |
| 10s · 720p | ~0.40 | 12.4 | 若開 10s **低估** |

**結論：** **維持執行時 6**；薄卡／字面 10 為漂移，以 runtime 為準。**不**改 models.ts 字面（會被覆寫；產品若改 cost 即可）。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| L0 契約 | **ok** |
| fal OpenAPI | **200** `PikaV22TextToVideoInput`／`…Output` |
| about | Pika 2.2 T2V；兩段 t2i→i2v |
| required | **`prompt` only** |
| optional | seed、negative_prompt（def ugly…）、aspect_ratio、resolution、duration |
| output | **`video`**（File） |
| L2 | 未跑（無 KEY） |
| 結論 | **ready-static-only**（契約綠） |

### 站內 input

```ts
input: (p, f) => ({ prompt: p, aspect_ratio: aspect(f) }),
// aspect = (f) => f  → "16:9" | "9:16" | "1:1"
```

| format | body | OpenAPI enum |
|--------|------|--------------|
| 16:9 | `"16:9"` | ✅ |
| 9:16 | `"9:16"` | ✅ |
| 1:1 | `"1:1"` | ✅ **綠**（無需映射） |

| 欄 | 站內 | 官方 | 備註 |
|----|------|------|------|
| prompt | ✅ | required | |
| aspect_ratio | ✅ 三比例 | 另含 4:5/5:4/3:2/2:3 | **健康** |
| resolution | 未送 | def **720p**（enum 720p\|1080p） | 對齊 $0.2 |
| duration | 未送 | def **5**（enum 5\|10） | 對齊 5 秒價 |
| negative_prompt | 未送 | def 內建 | 吃官方 |
| seed | 未送 | 可選 | |

### OpenAPI 摘要（本輪 200）

- **required**: `prompt`
- **aspect_ratio**: `16:9`｜`9:16`｜`1:1`｜`4:5`｜`5:4`｜`3:2`｜`2:3`，def `16:9`
- **resolution**: `720p`｜`1080p`，def **`720p`**
- **duration**: integer **5｜10**，def **5**
- **output**: `video` required

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 定位 | 風格化／特效向經濟 t2v（非寫實主力） |
| 管線 | about：text→image→video 兩段 |
| vs Ray-2 Flash | 同價帶 ~6 點；Pika 更俏皮特效 |
| vs Hailuo 02 | Hailuo 偏物理敘事；Pika 偏創意轉場 |
| 時長／解析 | 僅 5/10 與 720/1080 兩檔 |

---

## 5. 站內扣點／退點

```
realPricePoints(cost $0.2/5秒) → 6
→ reserveQuota(6)
→ falSubmit("fal-ai/pika/v2.2/text-to-video", { prompt, aspect_ratio })
→ 失敗 refund(6)
```

| 檢查 | 結果 |
|------|------|
| 6 ≈ $0.2×31 | **對齊**（720p 5s） |
| 字面 points=10 | 被 runtime 覆寫，**非**帳單依據 |
| verified true | 歷史不改 |
| !needs | 可 live（本輪無 KEY） |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| 生成台 text-to-video | ✅ | economy |
| format 三比例 | ✅ | schema 全支援 |
| 1080p／10s UI | ❌ | 未接（避免 points 低估） |
| recommended | ❌ | |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 社群片頭／俏皮特效 | ✅ | bestFor |
| 直式 9:16／方 1:1 | ✅ | aspect 綠 |
| 寫實莊嚴敘事 | △ | → Hailuo／Seedance／Veo |
| 1080p 成片 | △ | 需送 resolution；點數需重校 ~14 |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| `shared/models.ts` | #118 · input prompt+aspect · 字面 points10／cost $0.2 |
| runtime `realPricePoints` | **6** |
| OpenAPI 本輪 | required prompt；aspect 含 1:1；720p／5s 預設 |
| fal 模型頁 | https://fal.ai/models/fal-ai/pika/v2.2/text-to-video |
| 生態研究 | $0.2/5s 720p、$0.45/5s 1080p 已查證 |
| models-index／目錄 | 已列 **6**（與 runtime 一致） |

---

## 9. 建議動作

- [x] 升 shallow→完整九章；OpenAPI 直核  
- [x] 確認 aspect **含 1:1**（無需 P0 映射）  
- [x] 釐清 points：**執行時 6** vs 字面 10 漂移  
- [x] **維持** runtime 6／verified true；**不**自動改 points  
- [ ] **P2：** 若產品開 10s 或 1080p，同步估點或鎖死預設  
- [ ] **P3 衛生：** 字面 points 改 6 減少閱讀混淆（非必須）  
- [ ] L2（有 KEY）：短英文 prompt 探活  

**裁決：維持**（契約綠；預設價點對齊；零 live）

## L2 live（2026-08-05）

| 項 | 值 |
|----|-----|
| requestId | `019fd09a-6bb6-7c43-8951-a32630b31d5f` |
| 結果 | **success** · mp4 |
| artifact | https://v3b.fal.media/files/b/0aa515af/xQ07lwlmwfkIhIzAx883O_tmp5le8dakw.mp4 |
| pointsEst | 6 |
| verified | 目錄 true；**本輪不改** |
