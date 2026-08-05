# fal-ai/yue

> 審計：R5 · index **#244** · static+research · 2026-08-05（升 thin stub→九章）  
> slug：`fal-ai__yue`  
> OpenAPI **200**；R 禁 --yes → 零 live。  
> **未**改 verified／points。

## 1. 身分

| 項 | 值 |
|----|-----|
| index | **244** |
| 站內 id | `fal-ai/yue` |
| endpoint | **同 id** |
| label | YuE(開源演唱) |
| category / kind | **text-to-audio** · audio |
| tier | **economy** |
| points（目錄） | **8** |
| cost | `$0.05/秒`（**推定**）；整首可能高於扣點 |
| verified | **false** |
| needs | **無** |
| recommended | false |
| strengths | 開源歌詞轉歌;中英雙語演唱、結構完整但較慢 |
| bestFor | 開源可控的中文主題曲備援 |
| 姊妹 | DiffRhythm、MiniMax Music、ACE-Step |

**一句話**：**YuE** 開源演唱——required **`lyrics`+`genres`**；站內送 `prompt` → **P0 必 422**；價推定偏高需審慎。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| 目錄 points | **8** |
| cost | **$0.05／秒（推定）** |
| 若真 $0.05/s | 30s≈$1.5≈NT$47 → flat8 **嚴重低估** |
| 文案 | 已警告「整首實際費用可能高於扣點」 |
| `estimatePointsFor` | 扁平 **8** |

**結論：** **維持 points=8**（推定；契約未通前不調）；**P0 價風險** 記。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| L0 契約 | **P0 斷** |
| fal OpenAPI | **200** `YueInput` / `YueOutput` |
| required | **`lyrics` + `genres`** |
| output | **`audio`** |
| L2 | 未跑 |
| 結論 | **broken-contract** |

### 站內 input（現況）

```ts
input: (p) => ({ prompt: p }),
```

| 檢查 | 結果 |
|------|------|
| `prompt` | ❌ schema 無此 required |
| `lyrics` | ❌ 未送（需 [verse]/[chorus]） |
| `genres` | ❌ 未送（空白分隔 genre 串） |

### OpenAPI 對照

| 官方 | 站內 | 備註 |
|------|------|------|
| `lyrics` required | **缺** | 段落標籤 |
| `genres` required | **缺** | space-separated |
| output `audio` | ✅ | |

### 建議修法（本輪不改碼）

```ts
// 最小可跑（品質不保證）：
input: (p) => ({
  lyrics: p.includes("[") ? p : `[verse]\n${p}\n[chorus]\n${p}`,
  genres: "pop vocal",
}),
// 產品：雙欄 歌詞 / 曲風
```

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 定位 | 開源 **歌詞+曲風** 演唱 |
| vs DiffRhythm | 同 lyrics 驅動；YuE 另要 genres |
| 慢 | strengths 寫較慢——L2 需長輪詢 |

---

## 5. 站內扣點／退點

```
→ falSubmit({ prompt }) // 422
→ refund
```

| 檢查 | 結果 |
|------|------|
| verified false | **正確** |
| live | **禁止** 至修 input |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| 生成台 | ✅ | 一鍵 422 |
| genres UI | ❌ | |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 有結構歌詞+曲風 | △ | API 可 |
| 現況單 prompt | ❌ | **必敗** |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| `shared/models.ts` | #244 · 錯 input prompt |
| OpenAPI 本輪 | required lyrics+genres |
| fal 模型頁 | https://fal.ai/models/fal-ai/yue |

---

## 9. 建議動作

- [x] 升 stub→完整九章；OpenAPI 直核  
- [ ] **P0：** input → lyrics + genres  
- [ ] **P0/P1：** 核實 $0.05/s 與 points  
- [x] **維持** points=8；**不**改 verified  

**裁決：維持＋P0 契約斷裂**
