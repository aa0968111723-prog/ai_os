# fal-ai/mmaudio-v2

> 審計：R5 · index **#242** · static+research · 2026-08-05（升 thin stub→九章）  
> slug：`fal-ai__mmaudio-v2`  
> OpenAPI **200**；**needs=video** → 探測不受理；零 live。  
> **未**改 verified／points。

## 1. 身分

| 項 | 值 |
|----|-----|
| index | **242** |
| 站內 id | `fal-ai/mmaudio-v2` |
| endpoint | **同 id** |
| label | MMAudio V2(影片配音) |
| category / kind | **text-to-audio** · audio（產品掛本類；fal meta 亦標 video-to-video） |
| tier | **budget** |
| points（目錄） | **1** |
| cost | `$0.001/秒` |
| verified | **false** |
| needs | **video** |
| recommended | false |
| strengths | 分析畫面自動生成對時音效/環境音/Foley |
| bestFor | 無聲 AI 影片補同步環境音 |
| sourceHint | 要配音的影片網址(mp4) |
| 姊妹 | #243 text-to-audio 純文版、ThinkSound、Hunyuan Foley |

**一句話**：**MMAudio V2 影生音**——required `video_url`+`prompt`；輸出 **video**（帶音）；needs=video 正確。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| 目錄 points | **1** |
| cost | **$0.001／秒** |
| 預設 duration | def **8**（1–30）→ $0.008 |
| flat 1 | 預設足夠；30s 仍 ~NT$1 |
| `estimatePointsFor` | 扁平 **1** |

**結論：** **維持 points=1**。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| L0 契約 | **ok** |
| fal OpenAPI | **200** `MmaudioV2Input` / `…Output` |
| required | **`video_url` + `prompt`** |
| optional | negative、seed、steps、duration、cfg、mask_away_clip |
| output | **`video`**（帶生成音的影片——非純 audio） |
| kind 站內 | **audio** — extract 需能認 video URL（**P2** 產品／extract） |
| L2 | 未跑（needs） |
| 結論 | **ready-static-only**（站內素材） |

### 站內 input

```ts
input: (p, _f, s) => ({ video_url: s, prompt: p }),
```

| 檢查 | 結果 |
|------|------|
| `video_url` | **綠** ← source |
| `prompt` | **綠** |
| duration 等 | 不送 → 預設 8s |

### OpenAPI 對照

| 官方 | 站內 | 備註 |
|------|------|------|
| `video_url` required | ✅ needs=video | |
| `prompt` required | ✅ | |
| output `video` | ⚠ kind=audio | 成品是影片；站內 kind 命名／預覽 **P2** |

**P1 文件：** fal meta category=`video-to-video`；站內 category=`text-to-audio`（產品選擇可接受，需文件註）。

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 定位 | 看畫面生 **對時** 環境音／Foley 並嵌回片 |
| vs #243 | #243 無片純文；本檔 **要 video** |
| vs ThinkSound | 同影生音向 |

---

## 5. 站內扣點／退點

```
estimatePointsFor → 1
→ falSubmit({ video_url, prompt })
→ 失敗 refund(1)
```

| 檢查 | 結果 |
|------|------|
| needs=video | 經濟 live **不進**（正確） |
| verified false | **正確** |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| 生成台 text-to-audio | ✅ | 來源欄影片 |
| probe | ❌ | needs 擋 |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 無聲 AI 片補環境音 | ✅ | bestFor |
| 無影片純描述 | ❌ | → #243 |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| `shared/models.ts` | #242 · needs=video · video_url+prompt |
| OpenAPI 本輪 | required 雙欄；output video |
| fal 模型頁 | https://fal.ai/models/fal-ai/mmaudio-v2 |

---

## 9. 建議動作

- [x] 升 stub→完整九章；OpenAPI 直核  
- [x] needs=video 與 required 對齊  
- [ ] **P2：** kind=audio vs output video；extract／預覽  
- [x] **維持** points=1；**不**改 verified  

**裁決：維持**
