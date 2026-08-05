# fal-ai/elevenlabs/speech-to-text#keyterms

> 審計：R4 · index **#202** · static+research · 2026-08-05  
> slug：`fal-ai__elevenlabs__speech-to-text__keyterms`（**正名**；bulk 誤檔 `…speech-to-text#keyterms.md` 僅 stub）  
> **endpoint 覆寫** → **`fal-ai/elevenlabs/speech-to-text/scribe-v2`**（非 V1 path；`#keyterms` 為路由別名）。  
> **needs=audio** → 本輪無 live（無 FAL_KEY）。  
> **未**改 verified／points（目錄 **verified=false** 維持）。

## 1. 身分

| 項 | 值 |
|----|-----|
| index | **202** |
| 站內 id | `fal-ai/elevenlabs/speech-to-text#keyterms` |
| endpoint | **`fal-ai/elevenlabs/speech-to-text/scribe-v2`** |
| label | Scribe 關鍵詞強化 |
| category / kind | **speech-to-text** · text |
| tier | **economy** |
| points（目錄） | **2** |
| cost | `$0.008/分(≈$0.48/小時)` |
| verified | **false**（目錄；無 live 不升） |
| needs | **audio** |
| recommended | false |
| strengths | 提示專有名詞(佛學術語)提升辨識 |
| bestFor | 術語密集的開示(提示詞欄填術語、逗號分隔) |
| sourceHint | 音訊檔網址 |
| 姊妹 | Scribe V1（#197 rec）、scribe-v2（#204）、Whisper 系 |

**一句話**：**Scribe v2 + keyterms**——使用者 prompt 拆成專有名詞表，提升佛學術語等密集稿辨識；endpoint 已指 v2。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| 目錄 points | **2** |
| cost | `$0.008/分` |
| 估值（×1 分） | $0.008 × 31 ≈ **0.25** → floor 與 2 點敘事（校準多以 **10 分** 典型） |
| 校準 | 約 10 分級 **≈**；**1 小時級嚴重低估**（$0.48×31≈15 元 vs 2 點）→ **P2 扁平共債** |
| `estimatePointsFor` | 扁平 **2** |

**結論：** 維持 2；不自動改。與 #197／#204 同 STT 長檔風險。

---

## 3. 連通與生成

| 項目 | 結果 |
|------|------|
| L0 契約 | **ok** |
| fal OpenAPI | `…/scribe-v2` bulk **200** |
| required | `audio_url` |
| props（bulk） | `audio_url`, `language_code`, `diarize`, `tag_audio_events`, **`keyterms`** |
| 站內 input | `audio_url` + `language_code: "zho"` + **`keyterms[]` from prompt** |
| keyterms 對齊 | OpenAPI 有欄 → **綠** |
| L2 | 未跑 |
| 結論 | **ready-static-only** |

### 站內 input

```ts
input: (p, _f, s) => ({
  audio_url: s,
  language_code: "zho",
  keyterms: p
    ? p.split(/[,、，]/).map((t) => t.trim()).filter(Boolean)
    : undefined,
})
```

| 檢查 | 結果 |
|------|------|
| endpoint ≠ id path | **綠**（刻意指 v2；註解 W2） |
| prompt 語意覆寫 | 提示詞＝**術語列表**，非全文指令 |
| 空 prompt | keyterms **undefined**（仍可跑，等同一般 v2） |
| 分隔 | 英文逗號／頓號／中文逗號 |

---

## 4. 底層邏輯

| 面向 | 說明 |
|------|------|
| 為何獨立 id | 產品暴露「填術語」工作流；同一 v2 引擎 |
| vs #204 scribe-v2 | v2 全功能預設；本檔強制 keyterms 解析路徑 |
| vs #197 V1 | V1 可能較貴；本檔不走 V1 |
| 空 keyterms | 退化為 zho 轉寫，仍 2 點 |

---

## 5. 站內扣點／退點

```
estimatePointsFor → 2
→ reserveQuota(2)
→ falSubmit("fal-ai/elevenlabs/speech-to-text/scribe-v2",
    { audio_url, language_code: "zho", keyterms? })
→ 失敗 refund(2)
```

| 檢查 | 結果 |
|------|------|
| flat 2 vs 長檔分計 | **P2** |
| verified false | **正確**（待 live） |

---

## 6. 暴露面

| 通路 | 暴露 | 備註 |
|------|:----:|------|
| 生成台 speech-to-text | ✅ | economy |
| 術語密集 niche | ✅ | bestFor |
| recommended | ❌ | V1 仍 rec；新案宜 v2 |
| 情境 sc 字幕 | △ | pick 主軸在 scribe-v2／V1／whisper |

---

## 7. 情境

| 情境 | 適配 | 說明 |
|------|:----:|------|
| 佛學術語密集開示 | ✅ | bestFor |
| 專有名詞列表已知 | ✅ | prompt 填詞 |
| 一般多人座談 | △ | 直接 scribe-v2 |
| 無術語可填 | △ | 仍可跑但無強化 |
| 無音訊 | ❌ | needs=audio |

---

## 8. 文件

| 來源 | 用途 |
|------|------|
| `shared/models.ts` | #202 · endpoint→scribe-v2 · keyterms split |
| fal 模型頁 | https://fal.ai/models/fal-ai/elevenlabs/speech-to-text/scribe-v2 |
| 姊妹 | `fal-ai__elevenlabs__speech-to-text.md`（#197）· `…__scribe-v2.md`（#204 bulk） |
| bulk stub | `cards/fal-ai__elevenlabs__speech-to-text#keyterms.md`（`#` 誤名；以本卡為準） |

---

## 9. 建議動作

- [x] 正名九章卡；澄清 endpoint=scribe-v2 + keyterms  
- [x] 維持 points=2；**維持 verified=false**  
- [ ] **P2**：長檔扁平估點（STT 共債）  
- [ ] **L2**：有 KEY + 短音 + 術語表  
- [ ] 同型正名：#203 wizper#draft  
- [ ] 清理 bulk `#` 誤檔  

**L0 結論：** 契約綠；術語工作流清楚；估點與 verified 待實測。  
**未做：** live、改 points、改 verified。
