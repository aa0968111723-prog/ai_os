# fal-ai/wan-t2v

> 審計：R3 · index **#124** · static+research · 2026-08-05（升 thin stub→九章）  
> slug：`fal-ai__wan-t2v`  
> OpenAPI **200**（本輪直拉）；**!needs**；零 live（無 KEY）。  
> **P0-FIXED**：`1:1` → `aspect_ratio: "16:9"`（schema 無 1:1）。  
> **未**改 verified／points。

## 1. 身分

| 項 | 值 |
|----|-----|
| index | **124** |
| 站內 id | `fal-ai/wan-t2v` |
| endpoint | **同 id**（活躍） |
| label | Wan 2.1(開源) |
| category / kind | **text-to-video** · video |
| tier | **budget** |
| points（執行時） | **6**（`$0.2/支` → realPricePoints） |
| cost | `$0.2/支(1.3B 480p);wan-pro 版 $0.8/5秒` |
| verified | **true**（歷史；本輪無 live 複驗） |
| needs | **無** |
| recommended | false |
| strengths | 前代開源輕量版極省;品質基本堪用 |
| bestFor | 最省的開源試鏡頭、既有 2.1 LoRA |
| 供應商 | Wan T2V · fal queue |
| 姊妹 | Wan 2.5／2.6、ltx-video、Kling 1.6 std |

**一句話**：**Wan 2.1 開源預算 t2v**——端點 `fal-ai/wan-t2v` 活躍；aspect **僅 16:9｜9:16**；**1:1 已映射 16:9**；預設 **720p** 與 cost「480p」敘事有落差。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| points | **6** |
| cost 首價 | **$0.2／支**（文案錨 1.3B **480p**） |
| `parseRealCost` | usdMid=**0.2** · multiplier=**1**（／支） |
| `realPricePoints` | `0.2 × 1 × 31 = 6.2` → **round 6** |
| OpenAPI 預設解析 | **`720p`**（enum 480p｜580p｜720p） |
| 幀／秒 | num_frames def **81**（81–100）；fps def **16** → ~5s 級 |

### 校準對照

| 設定 | 約 USD | NT$ | vs 6 點 |
|------|--------|-----|---------|
| **$0.2／支（cost 480p 敘事）** | 0.20 | 6.2 | **≈** |
| 預設 **720p** 實費 | **未知**（若高於 0.2） | ? | **P2 可能低估** |
| wan-pro $0.8/5s（文案） | 0.80 | 24.8 | 他檔；非本 id |

**結論：** **維持 points=6**；**P2** 預設 720p vs 文案 480p 待帳單。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| L0 契約（修後） | **ok** |
| fal OpenAPI | **200** `WanT2vInput`／`WanT2vOutput` |
| 備援 slug | `fal-ai/wan/v2.1/1.3b/text-to-video` → **404**（註解過時） |
| required | **`prompt` only** |
| output | **`video`** + **`seed`** |
| L2 | 未跑（無 KEY） |
| 結論 | **ready-static-only**（修後 aspect 綠） |

### 站內 input（本輪 P0-FIXED）

```ts
// 原：aspect(f) → 1:1 送 "1:1" → schema 無 → 必 422
input: (p, f) => ({ prompt: p, aspect_ratio: f === "1:1" ? "16:9" : f }),
```

| format | 修後 body | OpenAPI |
|--------|-----------|---------|
| 16:9 | `"16:9"` | ✅ |
| 9:16 | `"9:16"` | ✅ |
| 1:1 | **`"16:9"`**（映射） | ✅ 防 422；**非真方圖** |

| 欄 | 站內 | 官方 | 備註 |
|----|------|------|------|
| prompt | ✅ | required | |
| aspect_ratio | ✅ 修後 | **僅** 16:9｜9:16 | **無 1:1** |
| resolution | 未送 | def **720p** | 非 cost 480p |
| num_frames／fps | 未送 | 81／16 | ~5s |
| turbo_mode | 未送 | def false | |
| negative_prompt | 未送 | 長預設 | 吃官方 |

### OpenAPI 摘要（本輪 200）

- **required**: `prompt`
- **aspect_ratio**: **`9:16`｜`16:9` only**，def `16:9`
- **resolution**: `480p`｜`580p`｜`720p`，def **`720p`**
- **num_frames**: 81–100，def **81**
- **frames_per_second**: 5–24，def **16**
- **num_inference_steps**: 2–40，def 30
- **turbo_mode** / **enable_prompt_expansion** / **enable_safety_checker**: bool
- **output**: `video` + `seed`

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 定位 | 前代 Wan **開源輕量** 最省試鏡 |
| vs Wan 2.5/2.6 | 新版畫質／音訊更強、價更高 |
| vs ltx-video | 同「最省試鏡頭」情境軸 |
| 1:1 | **無原生方圖**；映射橫式 |

---

## 5. 站內扣點／退點

```
realPricePoints → 6
→ reserveQuota(6)
→ falSubmit("fal-ai/wan-t2v", { prompt, aspect_ratio })  // 1:1→16:9
→ 失敗 refund(6)
```

| 檢查 | 結果 |
|------|------|
| 6 ≈ $0.2×31 | **對齊文案** |
| 720p 預設 | **P2** 實費風險 |
| verified true | 歷史不改 |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| 生成台 text-to-video | ✅ | budget |
| 9:16 | ✅ | |
| 1:1 專案 | ⚠ | **出 16:9**（映射） |
| resolution UI | ❌ | 未鎖 480p |
| recommended | ❌ | |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 最省開源試鏡頭 | ✅ | bestFor |
| 既有 2.1 LoRA | ✅ | 敘事 |
| 真 1:1 方片 | ❌ | schema 無 |
| 720p 成片價敏感 | △ | 應送 resolution=480p 對齊 cost |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| `shared/models.ts` | #124 · **P0-FIXED** 1:1→16:9 |
| OpenAPI 本輪 | aspect 僅兩比例；def 720p |
| 死鏈備援 | `…/wan/v2.1/1.3b/text-to-video` **404** |
| fal 模型頁 | https://fal.ai/models/fal-ai/wan-t2v |

---

## 9. 建議動作

- [x] 升 stub→九章；OpenAPI 直核  
- [x] **P0-FIXED**：1:1 → `16:9`  
- [x] 確認活躍端 `fal-ai/wan-t2v`；備援 slug 404  
- [x] **維持** points=6／verified  
- [ ] **P2：** cost 標 480p 但 default 720p — 鎖 `resolution:"480p"` 或改 cost  
- [ ] **P2 產品：** UI 標「1:1 以 16:9 出片」  
- [ ] L2（有 KEY）：短 prompt 探活  

**裁決：維持＋P0 已修 aspect**（零 live；points 不改）

## L2 live（2026-08-05）

| 項 | 值 |
|----|-----|
| requestId | `019fd09f-cd28-7901-95a9-74277fc605df` |
| 結果 | **success** · mp4 |
| artifact | https://v3b.fal.media/files/b/0aa515b4/mWzIkEkIxaZ621WtIN34w_00RFsOEI.mp4 |
| pointsEst | 6 |
| verified | 目錄 true；**本輪不改** |
