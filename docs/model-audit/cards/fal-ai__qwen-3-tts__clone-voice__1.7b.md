# fal-ai/qwen-3-tts/clone-voice/1.7b

> 審計：B9 回寫 · index **#220** · **static 契約修**（零 live / 禁止 --yes）· 2026-08-05  
> slug：`fal-ai__qwen-3-tts__clone-voice__1.7b` · 單一真相：`shared/models.ts`  
> **⚠ 非端到端 TTS**：OpenAPI required 僅 `audio_url`；output 是 **`speaker_embedding`（safetensors）** 非 audio。  
> **勿 verified true**（尚未 live 串 Qwen TTS 閉環）。

## 1. 身分

| 欄位 | 值 |
|------|-----|
| **index** | 220 |
| **id** | `fal-ai/qwen-3-tts/clone-voice/1.7b` |
| **endpoint** | 同 id（`endpointOf`＝id，無 alias） |
| **label** | Qwen 3 語音克隆 |
| **category** | 站內 `text-to-speech`；OpenAPI **`audio-to-audio`** |
| **tier** | `economy` |
| **kind** | `audio` |
| **verified** | **`false`**（B9 維持；勿開） |
| **needs** | **`audio`**（樣音） |
| **points** | **1**（B9：官方 \$0.0008/分 → floor 1） |
| **cost** | **`$0.0008/分(參考樣音長度；上限5分；產出 embedding 非音檔)`** |
| **strengths** | ⚠非端到端TTS：樣音→speaker embedding(safetensors)，需再接 Qwen TTS；非一次出克隆旁白 |
| **bestFor** | 低成本註冊聲線 embedding（再另步合成旁白） |
| **sourceHint** | 參考樣音網址(mp3/wav；建議≤5分乾淨人聲) |
| **角色定位** | 經濟 **embedding 註冊**；`sc-voice-clone` pickIds[1]；showdown runner-up |

**L0 靜態契約（B9 後）：** **ok**  
- `input: (p,_f,s) => ({ audio_url: s, reference_text?: p })` — **只送 required `audio_url`**；有 prompt 才附 optional `reference_text`（樣音逐字稿，**非旁白**）。  
- **已刪幽靈 `text`**。  
- 產物：**speaker_embedding**；`extractResult` B9 已認（比照 LoRA 回說明文字＋URL，**不當 media**）。

**一句話：** 用短樣音換 **speaker embedding**（幾乎免費）；**不是**端到端克隆旁白 TTS。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| **points** | **1**（B9 已寫入；`realPricePoints` \$0.0008×1分×31→floor 1） |
| **cost** | **`$0.0008/分…`**（廢舊「~\$0.09/千字」） |
| **官方** | \$0.0008 per minute（樣音長度；上限 5 分） |
| **量產旁白** | 另計 Qwen TTS 1.7b/0.6b 千字價 |

---

## 3. 連通

| 項目 | 結果 |
|------|------|
| OpenAPI Queue | **HTTP 200** · `Qwen3TtsCloneVoice17bInput` required=`[audio_url]`；Output required=`[speaker_embedding]` |
| L2 live | **未跑**；禁止 `--yes` |
| 結論 | **ready-static-only**／**非端到端產品** |

### OpenAPI vs 站內（B9）

| 欄位 | OpenAPI | 站內 |
|------|---------|------|
| `audio_url` | required | ✅ |
| `reference_text` | optional | ✅ prompt 非空才送 |
| 幽靈 `text` | 無 | ❌ **已刪** |
| `speaker_embedding` | File required | ✅ extractResult 說明文字 |

---

## 4. 底層

- **兩段式：** (1) 本端點樣音→embedding；(2) `…/text-to-speech/1.7b|0.6b` 的 `speaker_voice_embedding_file_url` 合成。  
- 站內 TTS 條目**尚未暴露** embedding 引用欄 → **產品閉環仍開**。  
- 姊妹：`clone-voice/0.6b` 同構、站內未列。

---

## 5–7. 扣點／輸入／情境

- 估點：扁平 **1**（不再誤吃 ttsUsdPerKChar 千字）。  
- 缺樣音：`needs=audio` 擋站內。  
- 助手：verified=false 不優先；配方仍可點到。  
- bestFor／strengths 已改「embedding 註冊／非端到端」。

---

## 8. 文件

- Playground：https://fal.ai/models/fal-ai/qwen-3-tts/clone-voice/1.7b  
- OpenAPI：`endpoint_id=fal-ai/qwen-3-tts/clone-voice/1.7b`（200）

---

## 9. 建議動作

- [x] **input 只送 audio_url**（＋可選 reference_text）  
- [x] **cost/points→1**；strengths **非端到端 TTS** 警告  
- [x] **extractResult** 認 `speaker_embedding`  
- [x] **broken** 註記非端到端；**verified 維持 false**  
- [ ] 產品閉環：Qwen TTS 暴露 `speaker_voice_embedding_file_url`＋UI 兩步  
- [ ] live 對帳（控費、禁止批次 --yes）後再考慮 verified  

**總建議：** `維持·非端到端TTS·embedding管線·points=1·verified=false·ready-static-only`

| L0 | L1 | L2 | 建議 |
|----|----|-----|------|
| ✅required | 📄200 | 未跑 | 非端到端；勿 verified true |

**B9 已寫入 models.ts／fal.ts；未 live、未 verified true。**
