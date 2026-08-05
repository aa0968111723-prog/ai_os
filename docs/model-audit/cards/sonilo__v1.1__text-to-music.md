# sonilo/v1.1/text-to-music

> 審計：R5 · index **#239** · static+research · 2026-08-05（升 thin stub→九章）  
> slug：`sonilo__v1.1__text-to-music`  
> OpenAPI **200**；**!needs**；R 禁 --yes → 零 live。  
> **未**改 verified／points。

## 1. 身分

| 項 | 值 |
|----|-----|
| index | **239** |
| 站內 id | `sonilo/v1.1/text-to-music` |
| endpoint | **同 id**（`sonilo/` 第三方） |
| label | Sonilo V1.1 商用配樂 |
| category / kind | **text-to-audio** · audio |
| tier | **economy** |
| points（目錄） | **7** |
| cost | `$0.0025/秒`（預設 90 秒≈`$0.225`） |
| verified | **false** |
| needs | **無** |
| recommended | false |
| strengths | 商用授權安全、精準時長、單一提示詞即可生成完整配樂 |
| bestFor | 活動影片、Podcast、短片背景配樂 |
| 姊妹 | Lyria2、EL Music、MiniMax Music 系、ACE-Step |

**一句話**：**Sonilo V1.1** 商用配樂——required `prompt`；站內 **duration=90** · **num_samples=1**；按秒計費 → points **7** 對齊 90s。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| 目錄 points | **7** |
| cost | **$0.0025／秒** · 帳單「每秒每 sample 一單位」 |
| 站內預設 | duration **90** · samples **1** → 0.0025×90=$0.225 |
| USD→TWD | 0.225×31≈**NT$7.0** → points **7** **對齊** |
| 最長 | duration max **600** → $1.5／次 若 UI 開滿（**P2** 估點未動態） |
| `estimatePointsFor` | 扁平 **7**（未隨 duration 變） |

**結論：** **維持 points=7**（對預設 90s）；長時長低估為 **P2**。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| L0 契約 | **ok** |
| fal OpenAPI | **200** `V11TextToMusicInput` / `…Output` |
| required | **`prompt` only** |
| optional | `duration`（1–600 def 90）、`num_samples`（1–3 def 1） |
| output | **`audio`**（首軌預覽）+ **`audios`** 陣列 |
| L2 | 未跑（估 7；優先 ≤3 經濟檔） |
| 結論 | **ready-static-only** |

### 站內 input

```ts
input: (p) => ({ prompt: p, duration: 90, num_samples: 1 }),
```

| 檢查 | 結果 |
|------|------|
| `prompt` | **綠** required |
| `duration: 90` | **綠** 範圍內；對齊估點 7 |
| `num_samples: 1` | **綠** |
| 幽靈欄 | 無 |

### OpenAPI 對照

| 官方 | 站內 | 備註 |
|------|------|------|
| `prompt` required | ✅ | |
| `duration` 1–600 | ✅ **90** | 計費錨 |
| `num_samples` 1–3 | ✅ **1** | 多 sample 線性加價 |
| output audio + audios | extract 認 audio ✅ | |

**P2 產品：** duration／samples 未暴露 UI；改長時 flat7 低估。

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 定位 | **商用授權** 安全配樂；精準秒數 |
| vs Lyria2 | Lyria 鎖 ~30s／$0.10；Sonilo 可 1–600s 按秒 |
| vs ACE-Step | ACE 極省但授權／品質不同 |
| 輸出 | AAC/m4a 系 File |

---

## 5. 站內扣點／退點

```
estimatePointsFor → 7
→ reserveQuota(7)
→ falSubmit({ prompt, duration:90, num_samples:1 })
→ 失敗 refund(7)
```

| 檢查 | 結果 |
|------|------|
| 7 ↔ $0.225@90s | **對齊** |
| verified false | **正確** |
| !needs | 可 live；估 7＜80 |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| 生成台 text-to-audio | ✅ | economy |
| duration UI | ❌ | 寫死 90 |
| recommended | ❌ | |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 活動／Podcast 約 90s BGM | ✅ | bestFor |
| 需商用授權敘事 | ✅ | strengths |
| 10s 極短試聽 | △ | 可降 duration；UI 未開、points 仍 7 |
| 10 分鐘長片 | △ | max 600；points 嚴重低估 **P2** |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| `shared/models.ts` | #239 · duration90 · samples1 · points7 |
| OpenAPI 本輪 | required prompt；計費 per-second |
| fal 模型頁 | https://fal.ai/models/sonilo/v1.1/text-to-music |

---

## 9. 建議動作

- [x] 升 stub→完整九章；OpenAPI 直核  
- [x] 確認 prompt+duration+num_samples **綠**；7↔90s 對齊  
- [ ] **P2：** 動態估點＝ceil(duration×samples×0.0025×31)  
- [ ] L2 可選（估 7）  
- [x] **維持** points=7；**不**改 verified  

**裁決：維持**（契約綠、價點對預設對齊）
