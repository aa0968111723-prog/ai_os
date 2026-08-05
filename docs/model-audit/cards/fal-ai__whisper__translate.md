# fal-ai/whisper#translate

> 審計：R4 · index **#200** · static+research · 2026-08-05  
> slug：`fal-ai__whisper__translate`（**正名**；bulk 誤檔 `fal-ai__whisper#translate.md` 僅 stub）  
> 共用 endpoint **`fal-ai/whisper`** + `task: "translate"`（非獨立 path）。  
> **needs=audio** → 本輪無 live（無 FAL_KEY）。  
> **未**改 verified／points。

## 1. 身分

| 項 | 值 |
|----|-----|
| index | **200** |
| 站內 id | `fal-ai/whisper#translate` |
| endpoint | **`fal-ai/whisper`**（`#translate` 為路由別名） |
| label | Whisper 翻譯(→英) |
| category / kind | **speech-to-text** · text |
| tier | **economy** |
| points（目錄） | **2** |
| cost | `同 Whisper`（≈$0.0008/運算秒；長錄音依運算時間） |
| verified | **true**（目錄既有；本輪無新 live 不覆寫） |
| needs | **audio** |
| recommended | false |
| strengths | 轉錄同時翻成英文 |
| bestFor | 國際版字幕初稿 |
| 姊妹 | base Whisper（#198）、chapters（#201）、Wizper（#199）、Scribe（#197 recommended） |

**一句話**：Whisper **task=translate** 變體——源語語音 → **英文** 字幕／逐字稿初稿；扣點與 base 同 flat 2。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| 目錄 points | **2** |
| cost | 同 Whisper（運算秒計，非音訊長度） |
| 校準 | 短檔 **≈**；**長錄音實際 USD 可能 ≫ 2 點** → **P2 估點扁平共債**（#198 同源） |
| `estimatePointsFor` | 扁平 **2**（不依時長） |

**結論：** 維持 points=2；不自動改。產品側長檔應提示改 Scribe 或接受帳單風險。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| L0 契約 | **ok** |
| fal OpenAPI | endpoint `fal-ai/whisper` bulk **200** |
| required | `audio_url` |
| props（bulk） | `num_speakers`, `language`, `prompt`, **`task`**, `diarize`, `chunk_level`, `audio_url`, `batch_size` |
| 站內 input | `{ audio_url, task: "translate" }` |
| `task` 對齊 | OpenAPI 有 `task` → **綠** |
| L2 | 未跑（needs + 無 KEY） |
| 結論 | **ready-static-only** |

### 站內 input

```ts
input: (_p, _f, s) => ({ audio_url: s, task: "translate" })
```

| 檢查 | 結果 |
|------|------|
| audio_url | **綠** required |
| task=translate | **綠**（Whisper 官方 task 枚舉：transcribe｜translate） |
| 幽靈欄 | 無（不送 language／diarize 等） |

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 架構 | 同一 Whisper large-v3 端點；`task=translate` 強制輸出英文 |
| vs base #198 | base 預設 transcribe（源語）；本檔＝英譯 |
| vs chapters #201 | chapters＝分段；本檔＝翻譯 |
| vs Scribe | Scribe＝商用準、多語、分講者；國際字幕可 Scribe 後另譯 |
| 產物 | 英文字幕初稿，非雙語對照 |

---

## 5. 站內扣點／退點

```
estimatePointsFor → 2
→ reserveQuota(2)
→ falSubmit("fal-ai/whisper", { audio_url, task: "translate" })
→ 失敗 refund(2)
```

| 檢查 | 結果 |
|------|------|
| flat 2 vs 長檔實價 | **P2 風險**（同 #198） |
| verified true | 目錄既有；本輪不改 |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| 生成台 speech-to-text | ✅ | economy |
| 情境字幕 winner | △ | 多以 Scribe／base Whisper 為主 |
| recommended | ❌ | ElevenLabs Scribe |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 國際版英文字幕初稿 | ✅ | bestFor |
| 源語精確逐字稿 | ❌ | 用 base transcribe |
| 長開示高準商用 | △ | Scribe 更穩；本檔長檔估點偏低 |
| 無音訊 | ❌ | needs=audio |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| `shared/models.ts` | #200 · `task: "translate"` |
| fal 模型頁 | https://fal.ai/models/fal-ai/whisper |
| bulk stub | `cards/fal-ai__whisper#translate.md`（`#` 誤名；以本卡為準） |
| 姊妹 | `fal-ai__whisper.md`（#198 bulk） |

---

## 9. 建議動作

- [x] 正名九章卡（`#` → `__` slug）  
- [x] 澄清 `task=translate` 與 endpoint 共用  
- [x] 維持 points=2；不改 verified  
- [ ] **P2**（Whisper 系）：長檔扁平估點 vs 運算秒實價  
- [ ] 同型正名：#201 chapters · #202 keyterms · #203 wizper#draft  
- [ ] 清理 bulk `#` 誤檔  

**L0 結論：** 契約綠；翻譯變體定位清楚；長檔估點共債開。  
**未做：** live、改 points、改 verified。
