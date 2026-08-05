# fal-ai/elevenlabs/music

> 審計：R5 · index **#231** · static+research · 2026-08-05（升 thin stub→九章）  
> slug：`fal-ai__elevenlabs__music`  
> OpenAPI **200**（本輪直拉 queue openapi）；**!needs** 但無 FAL_KEY → 零 live。  
> W2 已把 points 從偏低校到 **74**（約 3 分鐘＠\$0.80/分）；**本輪不改** points／verified。

## 1. 身分

| 項 | 值 |
|----|-----|
| index | **231** |
| 站內 id | `fal-ai/elevenlabs/music` |
| endpoint | **同 id** |
| label | ElevenLabs Music |
| category / kind | **text-to-audio** · audio |
| tier | **flagship** |
| points（目錄） | **74** |
| cost | 約 **\$0.80/分**（近期降價中，以 fal 現場為準）；點數以 **3 分鐘**估 |
| verified | **false** |
| needs | **無** |
| recommended | false |
| strengths | 授權資料訓練(版權安全);結構化歌曲 |
| bestFor | 對外發布影片的配樂(版權安心) |
| 姊妹 | Lyria 2（#230 器樂氛圍、3 點）、MiniMax Music（經濟完整曲）、Stable Audio 2.5 |
| 情境 | sc 配樂 pick 常與 Lyria2 並列 |

**一句話**：**ElevenLabs Music** 授權向旗艦歌曲——站內送 `prompt`；OpenAPI **無硬 required**（prompt **或** composition_plan 路徑）；**74 點≈3 分鐘**高單價。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| 目錄 points | **74** |
| cost | ≈\$0.80／分；註明「3 分鐘估、更長更高」 |
| 換算 | 0.80×3×31≈**NT\$74.4** → 與 **74** **≈ 對齊**（W2 校準註） |
| 動態估點 | 非千字 TTS 表；**扁平 74**（不隨 `music_length_ms` 變） |
| 短曲風險 | 預設若 ≪3 分 → **高估**扣點（使用者付 74 可能只生成更短） |
| 長曲風險 | \>3 分 → flat **低估**（**P2** 雙向） |
| `estimatePointsFor` | 扁平 **74** |

**結論：** **維持 74**；不自動改。理想＝依 `music_length_ms` 動態估點（B9 待做）。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| L0 契約 | **ok**（送 prompt） |
| fal OpenAPI | **200** `ElevenlabsMusicInput` / `ElevenlabsMusicOutput` |
| required（schema） | **無**（`required` undefined）— 實際需 **prompt 或 composition_plan** 之一（文件語意） |
| props | `prompt`, `composition_plan`, `force_instrumental`, `output_format`, `music_length_ms`, `respect_sections_durations` |
| output | **`audio`**（MP3 File） |
| L2 | 未跑（無 KEY） |
| 結論 | **ready-static-only** |

### 站內 input

```ts
input: (p) => ({ prompt: p }),
```

| 檢查 | 結果 |
|------|------|
| `prompt` | **綠**（常用路徑；anyOf） |
| `composition_plan` | 未接 — 進階分段／歌詞結構 |
| `music_length_ms` | 未送 — 長度由上游預設（3s–600s 可設） |
| `force_instrumental` | 未送 → 預設 false（可能含人聲） |
| `output_format` | 未送 → 預設 `mp3_44100_128` |
| 幽靈欄 | 無 |

### OpenAPI 對照（本輪 200）

| 官方 | 站內 | 備註 |
|------|------|------|
| `prompt` anyOf | ✅ | 與 composition_plan 二選一語意 |
| `composition_plan` | ❌ 未暴露 | 需 styles+sections+lyrics 結構 |
| `music_length_ms` | ❌ | 3000–600000 ms |
| `force_instrumental` | ❌ | 器樂保證 |
| output `audio` | ✅ | |

**P2 產品：** 時長／器樂／composition_plan 未接 → 扣 74 點卻難控長度與是否含人聲。

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 定位 | ElevenLabs **授權訓練** 音樂生成；對外發布版權安心 |
| vs Lyria2 | Lyria 器樂氛圍 3 點；本檔結構化歌曲＋高價 |
| vs MiniMax Music | MiniMax 經濟完整曲 recommended；本檔旗艦授權向 |
| 兩路徑 | 簡單 prompt **或** 完整 `MusicCompositionPlan`（sections／歌詞／風格） |

---

## 5. 站內扣點／退點

```
estimatePointsFor → 74
→ reserveQuota(74)
→ falSubmit("fal-ai/elevenlabs/music", { prompt })
→ 失敗 refund(74)
```

| 檢查 | 結果 |
|------|------|
| 3 分＠\$0.80 ↔ 74 | **≈** |
| 時長未綁 music_length_ms | **P2** 高估／低估雙向 |
| verified false | **正確**（無 live） |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| 生成台 text-to-audio | ✅ | flagship · 高點 |
| sc 配樂 pick | ✅ | 與 Lyria2 |
| recommended | ❌ | economy 線推 MiniMax Music |
| 時長／器樂 UI | ❌ | API 有未接 |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 對外影片配樂（版權安心） | ✅ | bestFor |
| 結構化多段歌曲＋歌詞 | △ | 需 composition_plan（站內未接） |
| 純器樂 BGM | △ | force_instrumental 未送 |
| 低成本 demo | ❌ | → MiniMax Music points=1 |
| 禪修氛圍床 | △ | → Lyria2 更省更貼 |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| `shared/models.ts` | #231 · W2 校準註 · input prompt · 74 點 |
| OpenAPI 本輪 | 無 hard required；prompt/plan 雙路徑 |
| fal 模型頁 | https://fal.ai/models/fal-ai/elevenlabs/music |
| 姊妹 | #230 Lyria2 · MiniMax Music |

---

## 9. 建議動作

- [x] 升 stub→完整九章；OpenAPI 直核  
- [x] 確認 prompt 路徑可用；維持 74／verified=false  
- [ ] **P2**：`music_length_ms` 綁動態估點（短曲少扣、長曲多扣）  
- [ ] **P2 產品**：暴露 force_instrumental／長度／composition_plan  
- [ ] **L2**（有 KEY）：短 prompt＋可控 length 探活（注意單次成本）  

**L0 結論：** 契約最小綠；價點 3 分基準合理；時長與進階 plan 缺口明顯。  
**未做：** live、改 points、改 verified、接 length。
