# fal-ai/diffrhythm

> 審計：R5 · index **#240** · static+research · 2026-08-05（升 thin stub→九章）  
> slug：`fal-ai__diffrhythm`  
> OpenAPI **200**；R 禁 --yes → 零 live。  
> **未**改 verified／points。

## 1. 身分

| 項 | 值 |
|----|-----|
| index | **240** |
| 站內 id | `fal-ai/diffrhythm` |
| endpoint | **同 id** |
| label | DiffRhythm(歌詞轉歌) |
| category / kind | **text-to-audio** · audio |
| tier | **budget** |
| points（目錄） | **1** |
| cost | `$0.01/10秒`（≈`$0.001/秒`） |
| verified | **false** |
| needs | **無**（目錄）；可選 `reference_audio_url` |
| recommended | false |
| strengths | 中文歌詞+逐行時間戳;30 秒內生成、最長 285 秒 |
| bestFor | 金句 MV 對字幕/對嘴、多版嘗試 |
| 姊妹 | MiniMax Music、Yue、ACE-Step |

**一句話**：**DiffRhythm** 歌詞→歌——required **`lyrics`**（非 prompt）；站內送 `prompt` → **P0 必 422**。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| 目錄 points | **1** |
| cost | **$0.01／10 秒** ≈ $0.001/s |
| 預設時長 | OpenAPI `music_duration` def **`95s`** → ≈$0.095 ≈ NT$2.9 |
| 最長 | **`285s`** → ≈$0.285 ≈ NT$8.8 |
| flat 1 vs 預設 95s | **低估**（**P2**；修契約後再校） |
| `estimatePointsFor` | 扁平 **1** |

**結論：** **維持 points=1**（契約未通前不調價）；記 P2。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| L0 契約 | **P0 斷** |
| fal OpenAPI | **200** `DiffrhythmInput` / `…Output` |
| required | **`lyrics` only** |
| optional | `reference_audio_url`、`style_prompt`、`music_duration`（95s\|285s）、cfg／scheduler／steps |
| output | **`audio`** |
| L2 | 未跑（input 錯欄名） |
| 結論 | **broken-contract** |

### 站內 input（現況）

```ts
input: (p) => ({ prompt: p }),
```

| 檢查 | 結果 |
|------|------|
| `prompt` | ❌ schema **無** required prompt |
| `lyrics` | ❌ **未送** |

### OpenAPI 對照

| 官方 | 站內 | 備註 |
|------|------|------|
| `lyrics` required | **缺** | 須含 [verse]/[chorus] 段落；例含時間戳 |
| `style_prompt` optional | 未送 | 風格 |
| `reference_audio_url` optional | 未送 | 可當 needs=audio 路徑 |
| `music_duration` 95s\|285s | 未送 | 預設 95s |
| output `audio` | ✅ | |

### 建議修法（本輪不改碼）

```ts
input: (p) => ({ lyrics: p }),  // 最小：欄名對齊；使用者需懂 [verse]/[chorus]
// 或: lyrics: p, style_prompt: "..." 
```

**P0：** 欄名 `prompt`→`lyrics`；文件提示時間戳格式。

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 定位 | **歌詞驅動** 成歌（對字幕／對嘴） |
| vs MiniMax | MiniMax 偏風格+詞；本檔強調 timestamp 歌詞 |
| 參考音 | optional ref URL——非硬 needs |

---

## 5. 站內扣點／退點

```
estimatePointsFor → 1
→ falSubmit({ prompt })  // 缺 lyrics → 422
→ refund
```

| 檢查 | 結果 |
|------|------|
| verified false | **正確** |
| 經濟 live | **禁止** 至修 input |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| 生成台 | ✅ | 一鍵 422 風險 |
| 歌詞格式引導 | ❌ | |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 帶時間戳中文歌詞 MV | △ | API 可；站內欄名錯 |
| 自由散文 prompt | ❌ | 非本模型主場 |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| `shared/models.ts` | #240 · **錯** input prompt |
| OpenAPI 本輪 | required **lyrics** |
| fal 模型頁 | https://fal.ai/models/fal-ai/diffrhythm |

---

## 9. 建議動作

- [x] 升 stub→完整九章；OpenAPI 直核  
- [ ] **P0：** `input` `prompt`→`lyrics`  
- [ ] **P2：** 按 music_duration 估點（95s≈3／285s≈9）  
- [x] **維持** points=1；**不**改 verified  

**裁決：維持＋P0 契約斷裂**（深卡完成）
