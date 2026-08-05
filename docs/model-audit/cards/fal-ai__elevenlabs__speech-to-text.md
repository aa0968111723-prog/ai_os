# fal-ai/elevenlabs/speech-to-text

> slug: `fal-ai__elevenlabs__speech-to-text` · 審計 #197 · R static+research · 2026-08-05  
> 本輪 **零 live／禁止 `--yes`**；未改 `verified`／`points`。  
> recommended **true**（STT 旗艦／開示逐字稿）。

## 1. 身分

| 欄位 | 值 |
|------|-----|
| 站內 id | `fal-ai/elevenlabs/speech-to-text` |
| 實際 endpoint | **同 id** |
| label | ElevenLabs Scribe |
| category / tier / kind | `speech-to-text` · `flagship` · `text` |
| verified | **true**（目錄；OpenAPI 200；metadata **active** · group **Scribe V1**） |
| needs | **audio** |
| recommended | **true** |
| sourceHint | 音訊檔網址(mp3/wav/m4a) |
| strengths | 商用最準梯隊;自動分講者、97+ 語言;長錄音實際費用最低 |
| bestFor | 開示錄音、多人座談逐字稿 |
| 廠商 | **ElevenLabs Scribe（V1 端點）** via fal.ai |
| MODELS 序 | index **196**（審計總表 **#197**） |

**一句話**：ElevenLabs **Scribe V1** 端點——必填 `audio_url`；站內固定 `language_code: "zho"`，吃預設 **diarize=true**／**tag_audio_events=true**；目錄 **2 點**、cost 標 **$0.008/分**（與 v2 同字串）；生態曾載 V1 為 **$0.03/分**——**價碼敘事待對帳**（P2）；新案更建議 **scribe-v2**。

## 2. 數值

| 項目 | 值 |
|------|-----|
| points | **2** |
| cost（目錄） | `$0.008/分(約 $0.48/小時)` |
| parseRealCost | usdMid=**0.008**、multiplier=**1**（×1 分）→ realPricePoints 路徑 |
| 校準報告 | ×**10 分鐘**典型 → 估值 **2.5**，判定 **≈**（points=2） |
| estimatePoints | **2**（扁平；**不**依音訊分鐘動態） |

**數值落差**

1. **長錄音**：實帳按**音訊分鐘**；站內固定扣 2 → 10 分鐘級「≈」，**1 小時級嚴重低估**（$0.48×31≈15 元 vs 2 點）——STT 類共通問題。
2. **V1 vs $0.008**：fal metadata group=**Scribe V1**；`docs/fal生態研究.md` 曾記 V1 **$0.03/分**、V2 **$0.008/分**。目錄把本 id 標成 $0.008（註「目錄錯誤修正」）——若平台仍按 V1 價，則 **cost 字串可能偏樂觀**（P2 對帳）。
3. strengths「長錄音實際費用最低」在「與 Whisper 運算秒比」敘事下常成立；若實為 $0.03/分則應改文案。
4. **本輪不改 points**。

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| L0 | **ok** |
| OpenAPI | **200** · `ElevenlabsSpeechToTextInput`／`Output` |
| metadata | **active** · ElevenLabs Speech to Text · group **Scribe V1** · tags speech · updated 2026-04-21 |
| required | **`audio_url`** |
| 站內 input | `{ audio_url: s, language_code: "zho" }` ✓ |
| negative／seed | n/a |
| live | **未跑**（needs=audio） |
| 輸出 | required `text` + `language_code` + `language_probability` + `words[]`；extractResult → `result.text` |
| 結論 | **ready-static** |

### OpenAPI 摘要

| 官方 property | 型別 | 預設 | 站內 | 備註 |
|---------------|------|------|------|------|
| `audio_url` | string **required** | — | ✅ | |
| `language_code` | string \| null | — | ✅ **`zho`** | ISO 639-3 中文；可加速／約束辨識 |
| `diarize` | boolean | **true** | ❌ | 自動分講者 |
| `tag_audio_events` | boolean | **true** | ❌ | 笑聲／掌聲等 |

**無** keyterms（關鍵詞屬 **scribe-v2**／`#keyterms` 變體）。

```ts
input: (_p, _f, s) => ({ audio_url: s, language_code: "zho" }),
// prompt 丟棄——STT 不吃文生提示
```

## 4. 底層

| 面向 | 說明 |
|------|------|
| 能力 | 商用 ASR；多語；字級／詞級 `words`；講者分離（diarize） |
| vs v2 | `…/scribe-v2`：更新、更便宜敘事、32 講者、keyterms；recipe **sc-transcribe** pick[0] 已是 v2 |
| 中文 | 準；出稿可能簡體 → OpenCC＋術語校對（playbook tip） |
| encoder／mechanics | unknown（非生成式文字窗） |
| 家族 | whisper／wizper／原生 fal speech-to-text；`#keyterms`→scribe-v2 endpoint |

## 5. 站內點數路徑

```
→ needs=audio 守門
→ estimatePoints = 2
→ reserveQuota(2) → falSubmit → refund(2)
```

長檔實帳與 2 點脫鉤風險：P2。

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| STT 選擇器 flagship | ✅ | recommended |
| `sc-transcribe` | ✅ | pickIds **第二**（首位 scribe-v2） |
| playbook `transcribe` | ✅ | modelIds 含本 id |
| language_code UI | ❌ | 固定 zho |
| diarize 開關 | ❌ | 吃 true |
| keyterms | ❌ | 本端點無；用 `#keyterms`／v2 |

**MCP 陷阱**：必須音訊 URL；prompt 無效；長檔估點仍 2。

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 開示／座談逐字稿 | ✅ | bestFor |
| 佛學術語密集 | △ | 升 **#keyterms**／v2 |
| 最新最準上游 | △→v2 | sc-transcribe 已主推 v2 |
| 只要時間軸字幕 | △ | Whisper chunk_level |
| 無音訊 | ❌ | needs |

recommended **合理**（穩定 V1 路徑）；產品敘事可引導新案 v2。

## 8. 文件

| 來源 | 用途 |
|------|------|
| OpenAPI | 本 id · **200** |
| 模型頁 | https://fal.ai/models/fal-ai/elevenlabs/speech-to-text |
| metadata | Scribe **V1** · active |
| 站內 | models.ts L1874–1880；sc-transcribe；playbook |
| 點數 | 校準 ≈2.5（×10 分） |
| 生態 | fal生態研究 STT 節 · V1/V2 價差討論 |
| 姊妹 | `…__scribe-v2.md`；`…#keyterms.md`；whisper |

## 9. 建議動作

- [x] **維持** id、needs=audio、input audio_url+zho、points=2、recommended
- [x] **維持** verified（不改）
- [x] 九章卡 + `_index` #197
- [ ] **P2**：對帳 V1 實價（$0.008 vs $0.03）；必要時改 cost／strengths 文案（**改字串不必改 points**）
- [ ] **P2**：長錄音動態估點或 UI 警示「每 N 分加點」
- [ ] **P3**：UI 文案引導新案優先 scribe-v2
- [ ] **勿** `--yes`／改 verified／points
- [ ] **無 P0 契約洞**（required 齊）

**L0/L1**：綠。**價碼與長檔估點**為 P2。無 P0 契約破洞。
