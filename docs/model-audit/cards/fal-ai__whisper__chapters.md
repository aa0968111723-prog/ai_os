# fal-ai/whisper#chapters

> 審計：R4 · index **#201** · static+research · 2026-08-05  
> slug：`fal-ai__whisper__chapters`（**正名**；bulk 誤檔 `fal-ai__whisper#chapters.md` 僅 stub）  
> 共用 endpoint **`fal-ai/whisper`**；差異在 **`chunk_level: "word"`**（非獨立 chapters API）。  
> **needs=audio** → 本輪無 live（無 FAL_KEY）。  
> **未**改 verified／points。

## 1. 身分

| 項 | 值 |
|----|-----|
| index | **201** |
| 站內 id | `fal-ai/whisper#chapters` |
| endpoint | **`fal-ai/whisper`**（`#chapters` 為路由別名） |
| label | Whisper 長檔分段 |
| category / kind | **speech-to-text** · text |
| tier | **economy** |
| points（目錄） | **2** |
| cost | `同 Whisper`（≈$0.0008/運算秒） |
| verified | **true**（目錄既有；本輪無新 live 不覆寫） |
| needs | **audio** |
| recommended | false |
| strengths | 長錄音自動分段落(word 級時間戳) |
| bestFor | 一小時以上開示的結構化整理 |
| 姊妹 | base（#198 segment）、translate（#200）、Wizper、Scribe |

**一句話**：Whisper **word 級 chunk** 變體——細時間戳便於長檔對軸／結構化；產品名「chapters」≠獨立章節模型。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| 目錄 points | **2** |
| cost | 同 Whisper |
| 校準 | 短檔 **≈**；**長錄音（bestFor 一小時+）實價可能 ≫ 2 點** → **P2 扁平共債**（#198–201） |
| `estimatePointsFor` | 扁平 **2** |

**結論：** 維持 2；不自動改。長檔產品路徑與估點矛盾最尖銳（本檔 bestFor 即長檔）。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| L0 契約 | **ok** |
| fal OpenAPI | `fal-ai/whisper` bulk **200** |
| required | `audio_url` |
| props | 含 `task`、`language`、`chunk_level` 等 |
| 站內 input | `audio_url` + `task=transcribe` + `language=zh` + **`chunk_level=word`** |
| 欄位對齊 | OpenAPI 有 `chunk_level` → **綠** |
| L2 | 未跑 |
| 結論 | **ready-static-only** |

### 站內 input

```ts
input: (_p, _f, s) => ({
  audio_url: s,
  task: "transcribe",
  language: "zh",
  chunk_level: "word",
})
```

| 檢查 | 結果 |
|------|------|
| vs base #198 | base 用 `chunk_level: "segment"`；本檔 **`word`** |
| language=zh | 中文開示主場 |
| 幽靈欄 | 無 |

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 命名 | id「chapters」＝產品語意（長檔分段／對軸）；實作＝**word timestamps** |
| vs base | segment 級較粗；word 級利精確 scrub／精修字幕 |
| vs translate | 本檔源語（zh）轉寫，不英譯 |
| 長檔風險 | bestFor 一小時+ 與 flat 2 點衝突 → 引導 Scribe 或接受帳單 |

---

## 5. 站內扣點／退點

```
estimatePointsFor → 2
→ reserveQuota(2)
→ falSubmit("fal-ai/whisper", { audio_url, task, language, chunk_level: "word" })
→ 失敗 refund(2)
```

| 檢查 | 結果 |
|------|------|
| flat 2 vs 長檔 | **P2** |
| verified true | 目錄既有；不改 |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| 生成台 speech-to-text | ✅ | economy |
| recommended | ❌ | Scribe |
| 情境 | △ | 長開示整理 niche |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 一小時+ 開示結構化／對軸 | ✅ | bestFor（估點風險） |
| 精準 word 時間戳字幕 | ✅ | chunk_level=word |
| 國際英文字幕 | ❌ | 用 #200 translate |
| 高準商用長稿 | △ | Scribe |
| 無音訊 | ❌ | needs=audio |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| `shared/models.ts` | #201 · `chunk_level: "word"` |
| fal 模型頁 | https://fal.ai/models/fal-ai/whisper |
| 姊妹 | `fal-ai__whisper__translate.md`（#200） |
| bulk stub | `cards/fal-ai__whisper#chapters.md`（`#` 誤名；以本卡為準） |

---

## 9. 建議動作

- [x] 正名九章卡；澄清「chapters」＝word chunk 非獨立 API  
- [x] 維持 points=2；不改 verified  
- [ ] **P2**：長檔扁平估點（本檔最相關）  
- [ ] 同型正名：#202 keyterms · #203 wizper#draft  
- [ ] 清理 bulk `#` 誤檔  

**L0 結論：** 契約綠；word 級定位清楚；長檔估點共債尖銳。  
**未做：** live、改 points、改 verified。
