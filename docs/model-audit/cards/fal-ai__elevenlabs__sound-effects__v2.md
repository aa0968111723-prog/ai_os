# fal-ai/elevenlabs/sound-effects/v2

> 審計：R5 · index **#234** · static+research · 2026-08-05（升 thin stub→九章）  
> slug：`fal-ai__elevenlabs__sound-effects__v2`  
> OpenAPI **200**（本輪直拉 queue openapi）；**!needs** 但無 FAL_KEY → 零 live。  
> 目錄 **verified=true**（歷史）— **本輪不改** verified／points。

## 1. 身分

| 項 | 值 |
|----|-----|
| index | **234** |
| 站內 id | `fal-ai/elevenlabs/sound-effects/v2` |
| endpoint | **同 id** |
| label | ElevenLabs 音效 v2 |
| category / kind | **text-to-audio** · audio |
| tier | **economy** |
| points（目錄） | **1** |
| cost | **`≈$0.01/次`** |
| verified | **true**（目錄既有；本輪無新 live 複驗） |
| needs | **無** |
| recommended | false |
| strengths | 描述即得音效(鐘聲、翻書、腳步) |
| bestFor | 剪輯用單發音效 |
| 姊妹 | Cassette 音效（#235 更便宜）、ACE-Step、ThinkSound／Hunyuan Foley（影加音） |

**一句話**：**ElevenLabs SFX v2** 文字→單發音效——required **`text`** 綠；≈\$0.01/次≈1 點；可選時長／loop 未站內送。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| 目錄 points | **1** |
| cost | ≈**$0.01／次** |
| 換算 | 0.01×31≈**NT$0.31** → 扁平 **1** 為下限（略高估但可接受） |
| 動態 | 無千字／秒 parse → flat **1** |
| `estimatePointsFor` | 扁平 **1** |

**結論：** **維持 points=1**；不自動改。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| L0 契約 | **ok** |
| fal OpenAPI | **200** `ElevenlabsSoundEffectsV2Input` / `…Output` |
| required | **`text` only** |
| optional | `loop`, `duration_seconds`（0.5–22）, `prompt_influence`（0–1 def 0.3）, `output_format` |
| output | **`audio`**（MP3 File） |
| L2 | **live success** · `019fd085` |
| 結論 | **ready-static-only** |

### 站內 input

```ts
input: (p) => ({ text: p }),
```

| 檢查 | 結果 |
|------|------|
| `text` | **綠** required（描述音效，**非** prompt 欄名） |
| duration / loop / influence | 不送 → 時長由上游自估；loop=false；influence=0.3 |
| 幽靈欄 | 無 `prompt` 誤送（正確用 **text**） |

### OpenAPI 對照（本輪 200）

| 官方 | 站內 | 備註 |
|------|------|------|
| `text` required | ✅ | 音效描述 |
| `duration_seconds` 0.5–22 optional | 未送 | None＝optimal from prompt |
| `loop` def false | 未送 | 無縫循環可接 |
| `prompt_influence` 0–1 def 0.3 | 未送 | |
| `output_format` def mp3_44100_128 | 未送 | |
| output `audio` | ✅ | |

**P2 產品：** 時長／loop 未暴露——剪輯若要固定 N 秒或循環床需 API 層。

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 定位 | ElevenLabs **SFX v2** text→sound effect（非音樂歌） |
| vs Cassette | Cassette 更便宜≈\$0.005；EL 品牌／品質向 |
| vs 音樂端點 | 勿與 Music／Lyria 混用——本檔單發 SFX |
| 欄名 | 用 **`text`** 不是 prompt（與多數 TTM 不同） |

---

## 5. 站內扣點／退點

```
estimatePointsFor → 1
→ reserveQuota(1)
→ falSubmit("fal-ai/elevenlabs/sound-effects/v2", { text })
→ 失敗 refund(1)
```

| 檢查 | 結果 |
|------|------|
| ≈\$0.01 ↔ 1 | **可接受**（下限） |
| verified true | 歷史標註；**本輪不改** |
| !needs | 可進經濟 live（本輪無 KEY） |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| 生成台 text-to-audio | ✅ | economy |
| recommended | ❌ | |
| 時長／loop UI | ❌ | API 有未接 |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 剪輯單發音效（鐘、腳步、翻書） | ✅ | bestFor |
| 需固定 2–10 秒 | △ | 可設 duration_seconds；站內未送 |
| 無縫循環環境音 | △ | loop=true 未接 |
| 完整歌曲／BGM | ❌ | → Music 系 |
| 極省批量試做 | △ | → Cassette #235 |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| `shared/models.ts` | #234 · input text |
| OpenAPI 本輪 | required text；duration 0.5–22 |
| fal 模型頁 | https://fal.ai/models/fal-ai/elevenlabs/sound-effects/v2 |

---

## 9. 建議動作

- [x] 升 stub→完整九章；OpenAPI 直核  
- [x] 確認 `{ text }` **綠**；維持 1／verified 不改  
- [ ] **P2 產品：** 可選 `duration_seconds`／`loop`  
- [ ] **L2**（有 KEY）：短中文或英文描述探活複驗  

**L0 結論：** 契約最簡綠；SFX 定位清楚；旋鈕待產品。  
**未做：** live、改 points、改 verified。

## L2 live（2026-08-05）

| 項 | 值 |
|----|-----|
| requestId | `019fd085-9daf-75d3-83a9-08ff3fe226d6` |
| 結果 | **success** · mp3 |
| artifact | https://v3b.fal.media/files/b/0aa51508/2cMMcbOd3Gg2l5vAprA-U_sound_effect.mp3 |
| pointsEst | 1 |
| verified | 目錄已 true；**本輪不改** |
