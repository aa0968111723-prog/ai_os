# fal-ai/stable-audio

> 審計：R5 · index **#245** · static+research · 2026-08-05（升 thin stub→九章）  
> slug：`fal-ai__stable-audio`  
> OpenAPI **200**；**!needs** · L2 **live success**（本輪先前）。  
> **未**改 verified／points。

## 1. 身分

| 項 | 值 |
|----|-----|
| index | **245** |
| 站內 id | `fal-ai/stable-audio` |
| endpoint | **同 id** |
| label | Stable Audio Open(開源) |
| category / kind | **text-to-audio** · audio |
| tier | **budget** |
| points（目錄） | **1** |
| cost | 低(開源版,品質低於 2.5) |
| verified | **false** |
| needs | **無** |
| recommended | false |
| strengths | 開源版文字轉音頻;音效/短氛圍為主 |
| bestFor | 內部音效試做(正式升 2.5) |
| 姊妹 | Stable Audio 2.5（#232）、ACE-Step、Cassette |

**一句話**：**Stable Audio Open**——required `prompt`；預設 **30s**；output **`audio_file`**；L2 live **OK**。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| 目錄 points | **1** |
| cost | 低／未明碼 $ |
| seconds_total | def **30**（0–47） |
| `estimatePointsFor` | 扁平 **1** |

**結論：** **維持 points=1**（無明碼不調）。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| L0 契約 | **ok** |
| fal OpenAPI | **200** `StableAudioInput` / `…Output` |
| required | **`prompt` only** |
| optional | `seconds_start` def0、`seconds_total` def30、`steps` def100 |
| output | **`audio_file`** |
| L2 | **live success** · `019fd074-7be6-7152-bbc2-8475566ddac8` |
| 結論 | **ready-live**（verified 維持 false） |

### 站內 input

```ts
input: (p) => ({ prompt: p }),
```

| 檢查 | 結果 |
|------|------|
| `prompt` | **綠** |
| seconds_* | 不送 → 30s 預設 |

### OpenAPI 對照

| 官方 | 站內 | 備註 |
|------|------|------|
| `prompt` required | ✅ | |
| `seconds_total` 0–47 | 未送 | 預設 30 |
| output `audio_file` | extract ✅（live 取回 wav） | |

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 定位 | 開源 SA；短氛圍／音效／loop |
| vs SA 2.5 | 2.5 旗艦 $0.20/次 points6；本檔 budget |
| steps def 100 | 較慢但品質向 |

---

## 5. 站內扣點／退點

```
estimatePointsFor → 1
→ falSubmit({ prompt })
→ 失敗 refund(1)
```

| 檢查 | 結果 |
|------|------|
| L2 | **成功** · 計 1 點 |
| verified | **維持 false**（禁自動 true） |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| 生成台 text-to-audio | ✅ | budget |
| duration UI | ❌ | 寫死預設 30 |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 內部音效／短氛圍試 | ✅ | bestFor |
| 對外旗艦音質 | ❌ | → SA 2.5／Lyria |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| `shared/models.ts` | #245 · input prompt |
| OpenAPI 本輪 | required prompt；audio_file |
| fal 模型頁 | https://fal.ai/models/fal-ai/stable-audio |

---

## 9. 建議動作

- [x] 升 stub→完整九章  
- [x] L2 live success  
- [x] 維持 points=1；verified 不改  

**裁決：維持**

## L2 live（2026-08-05）

| 項 | 值 |
|----|-----|
| 指令 | `verify-models --probe fal-ai/stable-audio --yes` |
| 輸入 | 「溫暖平靜的鋼琴旋律,慢板」 |
| requestId | `019fd074-7be6-7152-bbc2-8475566ddac8` |
| 結果 | **success** · wav |
| artifact | https://v3b.fal.media/files/b/0aa5149b/kyDtWEWOmaoHfYttfLVF6.wav |
| pointsEst | 1 · budget 已入帳 |
| verified | **維持 false**（禁止自動改 true） |
