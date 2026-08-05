# fal-ai/kling-video/v2.6/pro/image-to-video

> 審計：R3 · index **#129** · static+research · 2026-08-05（升 thin→九章）  
> slug：`fal-ai__kling-video__v2.6__pro__image-to-video`  
> OpenAPI **200**（本輪直拉）→ 端點活躍；**needs=image**。  
> **P0-FIXED**：站內 `image_url` → **`start_image_url`**；並送 **`generate_audio: false`**（官方 def true＝2× 價）。  
> verified 目錄已 **true**（本輪**不**改）；L2 需素材 **未**跑；**未**改 points。

## 1. 身分

| 項 | 值 |
|----|-----|
| index | **129** |
| 站內 id | `fal-ai/kling-video/v2.6/pro/image-to-video` |
| endpoint | **同 id**（活躍） |
| label | Kling 2.6 Pro(圖生) |
| category / kind | **image-to-video** · video |
| tier | **flagship** |
| points（執行時） | **11**（關音 ≈5s 基準） |
| cost | `$0.07/秒(關音訊)、$0.14/秒(開音訊);按秒計費,點數為 6 秒基準` |
| verified | **true**（目錄既有；本輪不改） |
| needs | **image** |
| recommended | false |
| strengths | i2v 動作流暢與運鏡頂級;原生音效/人聲支援中英 |
| bestFor | 分鏡圖轉電影感鏡頭、對外形象片 |
| sourceHint | 作為首格的圖(素材庫或網址) |
| 供應商 | Kling V2.6 Pro · fal |
| 姊妹 | v2.5-turbo pro i2v、v3 pro i2v、v2.6 pro t2v、veo3.1 i2v |

**一句話**：**Kling 2.6 Pro 圖生片**——required `prompt`+**`start_image_url`**；duration 5｜10；音訊可 2×；站內關音 + 欄位已修。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| points | **11** |
| cost | **$0.07／秒** 關音 · **$0.14／秒** 開音 |
| 預設 duration（官方） | **"5"**（enum 5｜10；字串） |
| 預設 generate_audio | **true**（站內覆寫 **false**） |
| 負向 | def `blur, distort, and low quality`；站內 allowlist 有本 id |

### 校準對照

| 設定 | USD | NT$ | vs points=11 |
|------|-----|-----|--------------|
| **5s 關音 $0.07** | 0.35 | 10.85 | **≈11** ✅ |
| 6s 關音（cost 文案基準） | 0.42 | 13.02 | 文案說 6s 但 schema def **5** **P2** |
| 5s 開音 $0.14 | 0.70 | 21.7 | 若開音未調點 **低估 P1** |
| 10s 關音 | 0.70 | 21.7 | duration 未暴露 **P2** |

**結論：** **維持 points=11**（對齊 5s 關音）；開音／10s 須動態估點後再談。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| L0 契約 | **P0-FIXED**（本輪） |
| fal OpenAPI | **200** `KlingVideoV26ProImageToVideoInput` |
| about | 最新代 i2v；可原生音訊（中英） |
| required | **`prompt` + `start_image_url`** |
| output | **video**（File） |
| L2 live | **未跑**（needs=image） |
| 結論 | **ready-static**（欄位已修；verified 已 true） |

### 站內 input（修後）

```ts
input: (p, _f, s) => ({
  prompt: p,
  start_image_url: s,
  generate_audio: false,
}),
```

| 欄 | 修前 | 修後 | 官方 | 備註 |
|----|------|------|------|------|
| prompt | ✅ | ✅ | required | |
| start_image_url | ❌ 誤送 `image_url` | ✅ | required | **P0**；v2.5 才是 image_url |
| generate_audio | 未送→true | **false** | def true | 對齊 1× 價／points |
| duration | 未送 | 未送 | def "5" | **P2** 無 10s UI |
| negative_prompt | allowlist | 可經 Neg 路徑 | def 有 | |
| end_image_url / voice_ids | ❌ | ❌ | optional | **P2** |

### OpenAPI 摘要（本輪 200）

- **required**: `prompt`, `start_image_url`
- **duration**: `"5"`｜`"10"`，def **`"5"`**
- **generate_audio**: bool，def **true**（中英語音；他語轉英）
- **negative_prompt**: max 2500
- **end_image_url** / **voice_ids**（`<<<voice_1>>>` 標記）
- start 圖：≥300px、AR 0.4–2.5、≤10MB
- **無** `image_url`（與 v2.5-turbo 不同）

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 定位 | 旗艦 i2v：運鏡／動作；可選原生音 |
| vs v2.5 turbo | turbo 用 **image_url**；本檔 **start_image_url** |
| vs v3 pro | 亦 start_image_url；多 shot／elements |
| vs Veo 3.1 | 場景：形象片關鍵鏡 Veo 首選；量大控本用本檔 |

---

## 5. 站內扣點／退點

```
realPricePoints → 11
→ reserveQuota(11)
→ falSubmit(..., { prompt, start_image_url, generate_audio:false })
→ 失敗 refund(11)
```

| 檢查 | 結果 |
|------|------|
| 11 ≈ 5s 關音 | **合理** |
| 開音 2× | 已關；若 UI 開音須改點 **P1** |
| needs=image | 無圖不進 L |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| 生成台 image-to-video | ✅ | 需首格圖 |
| sc-hero-shot / sc-witness-emotion | ✅ | pickIds |
| negative_prompt allowlist | ✅ | |
| 音訊／10s／尾幀 UI | ❌ | **P2** |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 分鏡圖→電影感鏡頭 | ✅ | bestFor |
| 人物情緒特寫 | ✅ | runner-up vs Hailuo |
| 要原生對白音效 | △ | 現關音；開則價 2× |
| 無圖純文 | ❌ | → t2v 端 |
| 日更量產 | △ | 11 點偏旗艦；日常 Wan |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| `shared/models.ts` | #129 · **start_image_url** · generate_audio false · points11 |
| OpenAPI 本輪 | required prompt+start_image_url；audio def true |
| broken.json | **P0-FIXED** 本輪 |
| fal 模型頁 | https://fal.ai/models/fal-ai/kling-video/v2.6/pro/image-to-video |

---

## 9. 建議動作

- [x] 升 thin→九章；OpenAPI 直核  
- [x] **P0** 修 `image_url`→`start_image_url`  
- [x] 關 `generate_audio` 對齊 points  
- [x] **維持** points=11；**不**改 verified  
- [ ] **P2：** duration 5/10、開音開關＋動態估點  
- [ ] **P2：** cost 文案「6 秒基準」vs schema def 5  
- [ ] L2 需圖素材再跑  

**裁決：維持＋P0 契約已修**（needs；verified 已 true）
