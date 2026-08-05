# fal-ai/vibevoice/7b

> 審計：R5 · index **#224** · static+research · 2026-08-05（升 thin→九章）  
> slug：`fal-ai__vibevoice__7b`  
> OpenAPI **200**（本輪直拉 queue openapi）；**!needs** 但無 FAL_KEY → 零 live。  
> **P0 speakers 已修**（broken P0-FIXED）；**未**改 verified／points。

## 1. 身分

| 項 | 值 |
|----|-----|
| index | **224** |
| 站內 id | `fal-ai/vibevoice/7b` |
| endpoint | **同 id** |
| label | VibeVoice 7B(多講者) |
| category / kind | **text-to-speech** · audio |
| tier | **economy** |
| points（目錄） | **2** |
| cost | `推估高於 1.5B(按分鐘)`（無精確 $ 字串） |
| verified | **false** |
| needs | 無 |
| recommended | false |
| strengths | VibeVoice 高品質版;多人對談更自然 |
| bestFor | 正式對外的多人敘事音訊 |
| 姊妹 | VibeVoice 1.5B 檔（#223 points=1）、Dia、ElevenLabs dialogue |
| 情境 | 多人對談 **winner**（showdown）；sc pick 首選 |

**一句話**：**VibeVoice 7B** 高品質多講者 TTS——正式對外多人敘事；契約需 **script+speakers**（已修）。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| 目錄 points | **2** |
| cost | 推估高於 1.5B（按分鐘）；**無 parseable $** |
| vs #223 | 1.5B 檔 cost `$0.04/分鐘` points=**1**；本檔 points=**2** 反映「更高品質」 |
| 校準 | 無 $ → 無法機械 realPrice；長稿按分計 vs flat 2 → **P2 低估風險**（同 vibevoice 系） |
| `estimatePointsFor` | 扁平 **2** |

**結論：** 維持 2；不自動改。長稿動態估點待 B9。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| L0 契約 | **ok**（speakers 已補；曾 ⚠input→fixed） |
| fal OpenAPI | **200** `Vibevoice7bInput` |
| required | **`script`**, **`speakers`** |
| props | `script`, `speakers`, `seed`, `cfg_scale` |
| `VibeVoiceSpeaker` | `preset` \| `audio_url` |
| output | `audio` + `duration` + `sample_rate` + `generation_time` + `rtf` |
| L2 | 未跑（無 KEY） |
| 結論 | **ready-static-only** |

### 站內 input

```ts
input: (p) => ({
  script: p,
  speakers: [{ preset: "Bowen [ZH]" }],
})
```

| 檢查 | 結果 |
|------|------|
| script | **綠** required |
| speakers[] | **綠** required（P0 已修） |
| vs #223 | 1.5B 預設 **雙**中文 preset；7B 預設 **單** Bowen |
| seed / cfg_scale | 不送 → 官方預設 |
| 幽靈欄 | 無 text/prompt（正確用 script） |

### 多講者使用注意

- script 建議 **`Speaker N:`** 前綴（N 自 0）；OpenAPI／base 註至多 **4** 講者。  
- 站內 7B 僅 1 preset → 單人敘事穩；多人對談需產品側擴 speakers 或使用者自備 script 約定。  
- 正式「多人」bestFor 與預設單 speaker **略張力**（**P2 產品**）。

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 定位 | 7B＝高品質 VibeVoice；1.5B＝更省 points=1 |
| vs Dia | Dia＝對話／非語言聲；VibeVoice＝微軟系多講者長對話 |
| vs Eleven dialogue | Eleven flagship 情感；本檔 economy 對談 winner |
| 計價 | 按分鐘（姊妹 1.5B 明示）；7B 推估更高 |

---

## 5. 站內扣點／退點

```
estimatePointsFor → 2
→ reserveQuota(2)
→ falSubmit("fal-ai/vibevoice/7b", { script, speakers: [Bowen] })
→ 失敗 refund(2)
```

| 檢查 | 結果 |
|------|------|
| flat 2 vs 長分鐘 | **P2** |
| verified false | **正確** |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| 生成台 TTS | ✅ | economy |
| 多人對談 showdown | ✅ | **winner** |
| sc 多人 pick | ✅ | pickIds[0] |
| recommended | ❌ | |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 正式對外多人敘事 | ✅ | bestFor（擴 speakers 更貼） |
| Podcast／問答對談 | ✅ | showdown winner |
| 單人旁白草稿 | ✅ | 預設單 Bowen |
| 超長稿低成本 | △ | 1.5B points=1；仍有低估 |
| 需克隆特定真人 | ❌ | 非 clone 路徑 |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| `shared/models.ts` | #224 · speakers 註解 |
| OpenAPI | `Vibevoice7bInput` required script+speakers |
| `docs/model-audit/broken.json` | P0-FIXED speakers |
| fal 模型頁 | https://fal.ai/models/fal-ai/vibevoice/7b |
| 姊妹 | #223 `fal-ai/vibevoice` |

---

## 9. 建議動作

- [x] 升 thin→完整九章；OpenAPI 直核 required  
- [x] 確認 P0 speakers 已修、broken FIXED  
- [x] 維持 points=2；verified=false  
- [ ] **P2**：長稿按分 vs flat 估點  
- [ ] **P2 產品**：7B 預設單 speaker vs 多人 bestFor——考慮對齊雙 preset 如 #223  
- [ ] **L2**（有 KEY）：短雙人 script 探活  

**L0 結論：** 契約綠（speakers 齊）；情境 winner 清楚；估點與預設講者數待打磨。  
**未做：** live、改 points、改 verified、改 input speakers 數量。
