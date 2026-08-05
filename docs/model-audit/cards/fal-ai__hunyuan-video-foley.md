# fal-ai/hunyuan-video-foley

> 審計：R5 · index **#247** · static+research · 2026-08-05（升 thin stub→九章）  
> slug：`fal-ai__hunyuan-video-foley`  
> OpenAPI 本輪直拉 **SSL 失敗**；沿用 bulk-all OpenAPI **200** 快照（required `video_url`+`text_prompt`）。  
> **needs=video** → 零 live。**未**改 verified／points。

## 1. 身分

| 項 | 值 |
|----|-----|
| index | **247** |
| 站內 id | `fal-ai/hunyuan-video-foley` |
| endpoint | **同 id** |
| label | 混元 Foley 影生音效 |
| category / kind | **text-to-audio** · audio |
| tier | **flagship** |
| points（目錄） | **2** |
| cost | `$0.01/秒`；點數為 **6 秒基準** |
| verified | **false** |
| needs | **video** |
| recommended | false |
| strengths | 騰訊高保真 Foley;動作與聲音對位準,評測勝同類 |
| bestFor | 正式成品音效層:倒水、開門、腳步擬音 |
| sourceHint | 要擬音的影片網址 |
| 姊妹 | ThinkSound、MMAudio V2 |

**一句話**：**混元 Foley**——bulk OpenAPI required **`video_url`+`text_prompt`**；站內送 **`prompt`** → **P0 欄名錯**。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| 目錄 points | **2** |
| cost | **$0.01／秒** · 6s 基準 → $0.06 ≈ NT$1.9 → **2** 貼邊 |
| 更長片 | 扁平 2 低估 **P2** |
| `estimatePointsFor` | 扁平 **2** |

**結論：** **維持 points=2**（對 6s 錨）；長片 P2。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| L0 契約 | **P0 斷**（欄名） |
| fal OpenAPI | bulk **200**；本輪 SSL 未重核 |
| required（bulk） | **`video_url`**, **`text_prompt`** |
| props（bulk） | steps、guidance、negative、seed… |
| L2 | 未跑（needs + 契約） |
| 結論 | **broken-contract** 至修 `text_prompt` |

### 站內 input（現況）

```ts
input: (p, _f, s) => ({ prompt: p, video_url: s }),
```

| 檢查 | 結果 |
|------|------|
| `video_url` | ✅ |
| `text_prompt` | ❌ 送成 **`prompt`** |

### 建議修法（本輪不改碼）

```ts
input: (p, _f, s) => ({ text_prompt: p, video_url: s }),
```

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 定位 | 騰訊 **旗艦 Foley** 影生音 |
| vs ThinkSound | Think required 僅 video_url；本檔另要 text_prompt |
| 6s 錨 | cost 文案明確 |

---

## 5. 站內扣點／退點

```
→ falSubmit({ prompt, video_url }) // 可能 422 缺 text_prompt
→ refund
```

| 檢查 | 結果 |
|------|------|
| needs=video | 不進 live probe |
| verified false | **正確** |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| 生成台 | ✅ | 一鍵風險 422 |
| probe | ❌ | needs |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 正式 Foley 層 | △ | 修欄名後 |
| 現況 | ❌ | 欄名錯 |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| `shared/models.ts` | #247 · **prompt** 錯欄 |
| bulk OpenAPI 快照 | required text_prompt+video_url |
| fal 模型頁 | https://fal.ai/models/fal-ai/hunyuan-video-foley |
| 本輪 | SSL 未重拉；待網路恢復複核 |

---

## 9. 建議動作

- [x] 升 stub→完整九章  
- [ ] **P0：** `prompt`→`text_prompt`  
- [ ] 網路恢復後 OpenAPI 重核  
- [x] **維持** points=2；**不**改 verified  

**裁決：維持＋P0 契約斷裂**
