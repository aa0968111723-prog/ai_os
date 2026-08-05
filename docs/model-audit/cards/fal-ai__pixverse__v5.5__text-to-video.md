# fal-ai/pixverse/v5.5/text-to-video

> 審計：R3 · index **#121** · static+research · 2026-08-05（升 shallow→九章）  
> slug：`fal-ai__pixverse__v5.5__text-to-video`  
> OpenAPI **200**（本輪直拉）；**!needs**；零 live（無 KEY）。  
> **未**改 verified／points／models.ts。

## 1. 身分

| 項 | 值 |
|----|-----|
| index | **121** |
| 站內 id | `fal-ai/pixverse/v5.5/text-to-video` |
| endpoint | **同 id** |
| label | PixVerse v5.5 |
| category / kind | **text-to-video** · video |
| tier | **economy** |
| points（目錄／執行） | **9**（`realPricePoints` **null** → 手填 9 生效） |
| cost | `$0.15(360/540p)–$0.40(1080p)/5秒;含音 +$0.05` |
| verified | **true**（歷史；本輪無 live 複驗） |
| needs | **無** |
| recommended | false |
| strengths | 多解析度分層、內建特效模板、直式友善 |
| bestFor | 9:16 動態背景、金句卡動態化 |
| 供應商 | PixVerse v5.5 · fal queue（about：Text To Video V5 5） |
| 姊妹 | PixVerse V6（#122）、Pika 2.2、Seedance Lite |

**一句話**：**PixVerse v5.5** 多解析＋特效模板經濟 t2v——required `prompt`；aspect 含 **1:1／9:16 綠**；預設 **720p／5s／無音**；cost 字串難機械解析 → 手填 **9** 點。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| 目錄 points | **9** |
| cost | 上表（**5 秒支價**區間 + 含音 +$0.05） |
| `parseRealCost` | usdMid≈**0.15** · multiplier=**null**（單位句被截斷，**無法**機械換算） |
| `realPricePoints` | **null** → 保留手填 **9** |
| 區間校準 | 低檔 $0.15×31≈**4.7**；高檔 $0.40×31≈**12.4**；9 ≈ **中高** 錨 |
| 站內預設 | resolution def **720p**（cost **未**單列 720p 價）· duration **5** · audio **off** |

### 校準對照（×31，以 5s 支計）

| 設定 | 約 USD | 約 NT$ | vs points=9 |
|------|--------|--------|-------------|
| 5s · 360/540p · 無音（cost 低錨） | 0.15 | 4.7 | 平台**高估 ~2×** |
| 5s · **720p** · 無音（站內預設） | **未知**（文案無） | ? | 待帳單 |
| 5s · 1080p · 無音（cost 高錨） | 0.40 | 12.4 | **低估 ~3** |
| 5s · 任意 · 含音 | +0.05 | +1.6 | 再偏 |
| 8s／10s | 更高 | | **P2** 扁平 9 低估 |

**結論：** **維持 points=9**；**P2** cost 缺 720p 明碼 + parse 失敗；禁自動改 points。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| L0 契約 | **ok** |
| fal OpenAPI | **200** `PixverseV55TextToVideoInput`／`…Output` |
| required | **`prompt` only**（限 **2048 UTF-8 bytes**） |
| optional | aspect_ratio、resolution、duration、negative_prompt、style、seed、generate_audio_switch、generate_multi_clip_switch、thinking_type |
| output | **`video`**（File） |
| L2 | 未跑（無 KEY） |
| 結論 | **ready-static-with-caveat**（價錨／720p 不明） |

### 站內 input

```ts
input: (p, f) => ({ prompt: p, aspect_ratio: aspect(f) }),
```

| format | body | OpenAPI enum |
|--------|------|--------------|
| 16:9 | `"16:9"` | ✅ |
| 9:16 | `"9:16"` | ✅（對齊 bestFor） |
| 1:1 | `"1:1"` | ✅ **綠** |

| 欄 | 站內 | 官方 | 備註 |
|----|------|------|------|
| prompt | ✅ | required · 2048 **bytes** | 中文／emoji 易超 byte 上限 |
| aspect_ratio | ✅ 三比例 | 另 4:3／3:4 | **健康** |
| resolution | 未送 | def **720p**（360–1080） | cost 未寫 720p |
| duration | 未送 | def **`"5"`**（enum 5\|8\|10 **字串**） | 1080p 限 5 或 8s |
| generate_audio_switch | 未送 | def **false** | 無音；+ $0.05 若開 |
| style | 未送 | anime／3d… 可選 | 特效模板未接 UI |
| negative_prompt | 未送 | def `""` | |

### OpenAPI 摘要（本輪 200）

- **required**: `prompt`
- **aspect_ratio**: `16:9`｜`4:3`｜`1:1`｜`3:4`｜`9:16`，def `16:9`
- **resolution**: `360p`｜`540p`｜`720p`｜`1080p`，def **`720p`**
- **duration**: string **`5`｜`8`｜`10`**，def **`5`**（1080p 限 5 或 8）
- **generate_audio_switch**: bool def **false**（BGM／SFX／dialogue）
- **style**: anime｜3d_animation｜clay｜comic｜cyberpunk｜null
- **thinking_type**: enabled｜disabled｜auto｜null
- **output**: `video` required

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 定位 | 多解析分層＋可選風格模板；直式友善 |
| vs V6（#122） | V6 強調原生音＋更高點；v5.5 更經濟、預設無音 |
| vs Pika 2.2 | Pika 特效感；PixVerse 模板／分層價 |
| 時長型別 | duration 為 **字串** enum（非 int）— 若誤送 number 可能 422（站內未送＝安全） |

---

## 5. 站內扣點／退點

```
realPricePoints → null → 手填 points 9
→ reserveQuota(9)
→ falSubmit("fal-ai/pixverse/v5.5/text-to-video", { prompt, aspect_ratio })
→ 失敗 refund(9)
```

| 檢查 | 結果 |
|------|------|
| 9 vs 區間 $0.15–0.40 | 中位偏高；**720p 待核** |
| verified true | 歷史不改 |
| !needs | 可 live（本輪無 KEY） |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| 生成台 text-to-video | ✅ | economy |
| 9:16／1:1 | ✅ | schema 綠 |
| style／音訊／8–10s UI | ❌ | 未接 |
| recommended | ❌ | |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 9:16 動態背景／金句卡 | ✅ | bestFor |
| 方圖 1:1 社群 | ✅ | aspect 綠 |
| 一鍵含 BGM | △ | 需 `generate_audio_switch`；點數未含 +$0.05 |
| 1080p 成片 | △ | 可送 resolution；points 9 **偏低** |
| 寫實莊嚴長鏡 | △ | → Hailuo／Veo |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| `shared/models.ts` | #121 · prompt+aspect · points9 |
| OpenAPI 本輪 | required prompt；aspect 含 1:1／9:16；def 720p／5／無音 |
| fal 模型頁 | https://fal.ai/models/fal-ai/pixverse/v5.5/text-to-video |
| 姊妹卡 #122 V6 | 同家族、更高音畫敘事 |

---

## 9. 建議動作

- [x] 升 shallow→九章；OpenAPI 直核  
- [x] aspect **1:1／9:16 綠**（無需映射）  
- [x] **維持** points=9／verified；不改 input  
- [ ] **P2：** 補 cost 720p 明碼；改寫 cost 使 `parseRealCost` 可解析  
- [ ] **P2：** 長時長／1080p／含音 扁平低估  
- [ ] **P3 產品：** style 模板、音訊開關 UI  
- [ ] L2（有 KEY）：短 prompt 探活  

**裁決：維持**（契約綠；價錨待帳單；零 live）
