# fal-ai/qwen-3-tts/text-to-speech/0.6b

> 審計：R5 · index **#217** · 模式 **static+research（零 live / 禁止 --yes）** · 2026-08-05  
> slug：`fal-ai__qwen-3-tts__text-to-speech__0.6b` · 單一真相：`shared/models.ts`

## 1. 身分

| 欄位 | 值 |
|------|-----|
| **index** | 217 |
| **id** | `fal-ai/qwen-3-tts/text-to-speech/0.6b` |
| **endpoint** | 同 id（`endpointOf`＝id，無 alias） |
| **label** | Qwen 3 TTS(輕量) |
| **category** | `text-to-speech` |
| **tier** | `economy` |
| **kind** | `audio` |
| **verified** | **`false`**（目錄 ⚠︎） |
| **needs** | 無（免來源） |
| **recommended** | `false` |
| **strengths** | Qwen3 輕量版;更快更省,中文仍遠勝傳統合成音 |
| **bestFor** | 草稿旁白、社群短影音口白 |
| **供應商／底層** | 阿里 **Qwen3-TTS Custom-Voice 0.6B**（OpenAPI `x-fal-metadata.about`＝「Custom Voice 06B」；HF 線上同族 12Hz 0.6B）via fal.ai |
| **角色定位** | 中文 TTS **經濟輕量檔**；日更量產軸 **runner-up**（winner＝1.7b）；比 1.7b（$0.09／旗艦 3 點）更省、比 Kokoro（$0.02／budget）貴一檔但品質高一截 |

**L0 靜態契約：** **ok**  
- 必填欄完整；`category ∈ CATEGORIES`；id 唯一；與 1.7b／clone-voice 為獨立端點。  
- `input: (p) => ({ text: p })` 存在且可呼叫 → 樣例 `{ text: "…" }`。

**一句話：** 中文短口白／草稿的省錢主力——契約與官方 required=`text` 對齊；聲線／語種／風格 prompt 上游有、站內未暴露。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| **points（目錄扁平）** | **2** |
| **cost** | **`$0.07/千字`** |
| **官方價與單位** | fal 模型頁／explore 公開：**$0.07 per 1000 characters**（WebSearch 快照與 `docs/fal生態研究.md` ✅已查證一致；learn 總表 $0.09 多指 1.7B 主線，勿混） |
| **匯率假設** | USD×**31** ≈ NT$（`USD_TO_TWD`／`audit-model-pricing` 同基準） |
| **估值 NT$（假設）** | 500 字 ≈ NT$1.09；**1000 字 ≈ NT$2.17**；2000 字 ≈ NT$4.34；5000 字 ≈ NT$10.85 |
| **動態估點 `estimatePoints`** | cost 含 `$…/千字` → `ttsUsdPerKChar`＝**0.07**；有 `promptChars`：`max(1, round(0.07×31×chars/1000))`；無字數 → 扁平 **2** |
| **例（rate=31）** | 100–300 字→**1**；500→**1**；**1000→2**；1500→3；2000→4；5000→11；8000 最壞工作流→**17** |
| **`parseRealCost`／校準表** | usdMid=0.070；multiplier=null → 表列 **需人工**（腳本不對「/千字」套固定單次用量）— `docs/點數校準報告.md` 經濟列 Qwen 3 TTS(輕量) |
| **校準判定** | **≈（動態路徑）**／表列「需人工」不代表錯價；扁平 2≈千字緩衝（2.17→2 點四捨五入） |

**結論：** **不建議改 points**。真正扣點走 `estimatePoints`＋字元長度，與官方按字計費同向。長稿勿只信扁平 2。

---

## 3. 連通與生成

| 項目 | 結果 | 說明 |
|------|------|------|
| **L0 靜態契約** | **ok** | input 必填對齊 OpenAPI |
| **OpenAPI Queue** | **HTTP 200** | `GET …/openapi.json?endpoint_id=fal-ai/qwen-3-tts/text-to-speech/0.6b` → openapi **3.0.4**；`Qwen3TtsTextToSpeech06bInput`／`Output` |
| **模型頁 HTML** | 本回合 curl／fetch **429** | **不計連通失敗**（schema 已通；公開標價 $0.07/1k chars 與 WebSearch／生態研究交叉） |
| **dry-run probe** | 乾跑會列入 fal 端點計畫 | **未** `--yes` |
| **live probe** | **未跑** | 本回合零 live；**禁止 `--yes`**；`FAL_KEY` 亦未設 |
| **結論** | **ready-static-only** | 文件＋契約就緒；待 L1 空輸入探＋可選 L4 真生成後可升 ready／建議 verified |

**輸出契約（OpenAPI）：** `Qwen3TtsTextToSpeech06bOutput.audio` → `AudioFile`（例 mp3，`sample_rate` 24000，含 `url`／`duration`）。站內 `extractResult` 認 `result.audio`／`audio_file`／`audio_url` → **對得上**。

**x-fal-metadata：** `endpointId`＝本 id；`category`=`text-to-speech`（與站內一致）；playground／documentation URL 齊；about＝「Custom Voice 06B」。

---

## 4. 底層邏輯

### 4.1 模型能力（公開資料）

- **Qwen3-TTS 家族** 多語可控 TTS；本端點為 **0.6B Custom-Voice** 生成線（非 clone-voice、非 voice-design）。  
- **預設聲線 enum（9）：** `Vivian`、`Serena`、`Uncle_Fu`、`Dylan`、`Eric`、`Ryan`、`Aiden`、`Ono_Anna`、`Sohee`（OpenAPI examples 預設示例 **Vivian**；各聲主要語種見 [Qwen3-TTS custom-voice 文檔](https://github.com/QwenLM/Qwen3-TTS)）。  
- **語言 `language`：** Auto／English／Chinese／Spanish／French／German／Italian／Japanese／Korean／Portuguese／Russian；**default `Auto`**。  
- **風格 `prompt`（可選）：** 引導語氣／情緒（例 `"Very happy."`）；**若提供 speaker embedding 則忽略** voice 與 style prompt。  
- **克隆接線：** `speaker_voice_embedding_file_url` ← **`fal-ai/qwen-3-tts/clone-voice/0.6b`** 產出的 **safetensors embedding**（非 raw mp3）；可選 `reference_text` 改善克隆品質。  
- **採樣旋鈕：** `temperature`／`top_p`／`top_k`／`repetition_penalty`、subtalker 系列、`max_new_tokens`（default **200**，max 8192）。  
- **與 1.7b：** Input 形狀幾乎同構；1.7b 克隆描述寫 `clone-voice`（無 `/0.6b` 後綴）；價 1.7b＝$0.09、本檔＝$0.07；站內 1.7b 標旗艦／本檔經濟。

### 4.2 官方 OpenAPI vs 站內

| 官方 property | 約束 | 站內 | 備註 |
|---------------|------|------|------|
| **`text`** | string **required** | ✅ `input(p)→{ text: p }` | 唯一送出欄；契約正確 |
| `prompt` | optional 風格引導 | ❌ 未送 | **非**正文欄（勿與 MiniMax 2.6 的 required `prompt` 搞混） |
| `voice` | enum 9 聲／null | ❌ 未送 | 吃上游 default／示例行為；**待 live 確認預設聲** |
| `language` | default **Auto** | ❌ 未送 | Auto 對中文稿通常可接受 |
| `speaker_voice_embedding_file_url` | optional URL | ❌ 未送 | 兩步克隆未產品化 |
| `reference_text` | optional | ❌ | 隨 embedding |
| `temperature`／`top_*`／subtalker／`repetition_penalty` | 有 default | ❌ | 功能降級非契約錯 |
| **`max_new_tokens`** | default **200**，max 8192 | ❌ | **長稿截斷風險**（見 4.3） |

- **required 對齊：** 僅 `text` ↔ 站內只送 `text` → **無缺必填 → 無 422 風險**（對照 #216 MiniMax 2.6 曾 `text`≠`prompt`）。  
- **幽靈欄：** 無。  
- **世界觀／卡片錨點：** `WORLDVIEW_INJECT_CATEGORIES`／`CARD_ANCHOR_CATEGORIES` **刻意排除 TTS** → 選角色卡會 warning「不會使用設定卡」（合理）。  
- **negative／seed allowlist：** TTS 不適用。

### 4.3 風險／落差

1. **`max_new_tokens` default 200：** 上游以 codec token 上限生成；長旁白若未顯式抬高可能**提早截斷**——站內未送 → **待 live 用長中文稿驗證**；P2 可依稿長推 default 或固定較高值（≤8192）。  
2. **聲線／語種／風格未暴露：** bestFor「社群短影音口白」仍成立（Auto＋預設聲），但 strengths「更快更省」可體現、無法在站內選 Vivian vs Uncle_Fu 或寫「沉穩開示」。  
3. **克隆管線斷層：** 官方 0.6b TTS 要 **embedding URL**（來自 `clone-voice/0.6b`）；站內另有 `clone-voice/1.7b` 條目且 input 送 `audio_url`（推定未親驗，見 models 註解）——**與本 TTS 端點無直接串接**。  
4. **verified=false：** `modelIsOperationallyReady` 否 → 助手自動選模不會優先本 id（手動台可選）。  
5. **learn 文案 $0.09：** 易與本檔 $0.07 混淆；目錄／生態已分檔正確。

### 4.4 與家族站內條目

| id | 角色 | points／cost | 本卡關係 |
|----|------|--------------|----------|
| `…/text-to-speech/1.7b` | 旗艦中文量產 | 3／$0.09 | 更高品質兄弟；sc 日更 **winner** |
| `…/text-to-speech/0.6b` | **本卡** 經濟輕量 | 2／$0.07 | 日更 **runner-up** |
| `…/clone-voice/1.7b` | 克隆（推定） | 3／推估 | 獨立條目；非本 input |

---

## 5. 站內扣點／退點

| 環節 | 行為 |
|------|------|
| 估點 | `generationCore` → `estimatePointsFor(model, { promptChars: positivePrompt.length, usdToTwdRate })` |
| 動態 | `ttsUsdPerKChar` 解析到 **0.07** → 按字；否則扁平 **2** |
| 扣點 | `reserveQuota(…, est, …)`；成功 `pointsActual` 對齊 est（BYOK 可 0） |
| 退點 | 失敗／陳屍回收 `refund` 與 est 對稱 |
| UI 顯示 | 目錄扁平 **2**；有 prompt 時估點可隨字數 1→17（8000 字工作流最壞） |
| 工作流 | 含「按千字」TTS 步以 **8000 字**估總點，避免低估斷鏈 |

**一致性：** 顯示／預留／退點同一 `estimatePoints` 路徑 → **架構 ok**。  
**本模無 live 對帳：** 未驗證 fal 帳單字元計數（空白／標點／中英混排）是否與 `prompt.length` 一致 → **待 L4／月帳單抽樣**。

---

## 6. 分詞／輸入

| 項 | 說明 |
|----|------|
| 必填 | 使用者稿 → `positivePrompt` → 送 **`text`**；空稿應被生成表單擋下 |
| 欄位名 | 官方／站內皆 **`text`**（不是 MiniMax 2.6 的 `prompt`；不是 Kokoro 的 `prompt`+voice） |
| 長度 | OpenAPI 未標 text max chars；實務受 **`max_new_tokens`** 與上游超時影響 |
| 估點字數 | JS 字串 **length**（UTF-16 code unit） |
| needs | 無 → 缺來源攔截 **不適用** |
| 注入 | 不注入世界觀／卡片 → 寫什麼唸什麼 |
| 建議腳本形 | 中文短旁白／金句／短影音口白；語種可交給 Auto 或日後顯式 `language: "Chinese"` |
| 可選（未接） | `voice`、`language`、`prompt`（風格）、embedding、採樣、`max_new_tokens` |

---

## 7. 情境與可用性

| 情境 | 適配 | 原因 |
|------|:----:|------|
| 草稿旁白／內部預覽 | ✅ | bestFor；比 1.7b 省、比 Kokoro 自然 |
| 社群短影音中文口白 | ✅ | sc「中文旁白日更量產(省)」**pickIds[1]**；showdown 日更軸 **runner-up** |
| 日更量產品質優先 | △ | 應用 **1.7b**（winner）；本檔再省一檔 |
| 見證／開示情感旗艦 | △／❌ 主力 | 應 MiniMax 2.6 HD；本檔非 flagship |
| 固定會方聲線克隆 | ❌ 站內斷 | 需 clone-voice embedding 兩步；未接 |
| 多講者對談 | ❌ | 無 S1/S2 契約；用 Dia／VibeVoice／EL dialogue |
| 助手自動挑選 | ❌ | `verified=false` → 非 operational ready |
| 手動台選模 | ✅ | text-to-speech 清單；economy 2 點檔 |
| recommended | 否 | 合理（未 verified；主力敘事在 1.7b） |

**文案審（L6）：** strengths／bestFor **對位**；playbook 與 showdown 已正確把 0.6b 當「再省」而非中文第一梯隊。可選 follow-up：help 註明預設聲／Auto 語種、長稿可能受 token 上限影響。

---

## 8. MCP／文件

| 項 | 結果 |
|----|------|
| Playground | `https://fal.ai/models/fal-ai/qwen-3-tts/text-to-speech/0.6b` |
| API 文檔 | `https://fal.ai/models/fal-ai/qwen-3-tts/text-to-speech/0.6b/api` |
| OpenAPI | `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/qwen-3-tts/text-to-speech/0.6b`（本回合 **200**） |
| MCP | `generate_into_scene` 等走同一 `submitGenerationCore`／目錄模型；**可調用**（權限＋點數允許時） |
| 助手 | 偏好 verified；本 id 多為手動或未強制 verified 的候選 |
| 檢視者 | 唯讀，不送生成 |

---

## 9. 建議動作

- [x] **維持** id／endpoint／category／**points=2**／**cost `$0.07/千字`**／`input→{ text }`（必填契約已對齊官方；估點動態正確）  
- [ ] **調 points** — **不需要**（扁平 2≈千字；動態按字已覆蓋；勿為校準表「需人工」誤改）  
- [ ] **修 input/id** — **非阻擋**；無 422 風險。可選 **P2 follow-up**：  
  - 預設 `language: "Chinese"`（中文旁白情境）或維持 Auto  
  - 暴露 `voice` 下拉（Vivian／Serena／Uncle_Fu…）  
  - 可選風格 `prompt`（與正文 `text` 分欄，避免使用者把全文塞錯鍵）  
  - 長稿抬 `max_new_tokens`（驗證後再改，避免無腦 8192 拖慢／加價副作用）  
  - 兩步克隆：站內接 `clone-voice/0.6b` → embedding → 本端點（與現有 1.7b clone 條目分開審）  
- [ ] **verified true** — **僅建議，勿擅自改**：待 L1 `--yes` 空探＋ L4 最小中文短句 live 成功後再人工開  
- [ ] **下架或隱藏** — 不需要；保留作中文經濟口白  
- [ ] **Live 佇列（可選，控費）**  
  - 估點：`npx tsx scripts/verify-models.ts --probe "fal-ai/qwen-3-tts/text-to-speech/0.6b"`  
  - 真跑（單次、需 FAL_KEY）：加 `--yes`；建議短中文句  
  - 另測（控費）：長稿是否截斷（`max_new_tokens`）、省略 voice 的預設聲、顯式 `language: Chinese`

### 本回合狀態燈（供 `_index`）

| L0 | L1 | L2 live | 建議 |
|----|----|---------|------|
| ✅ | 📄 OpenAPI | 未跑 | **維持**（ready-static-only；價 $0.07 對齊；旋鈕／max_tokens／克隆為 P2；live 後再 verified） |

### 研究來源（static+research）

- `shared/models.ts`（entry #217、estimatePoints、ttsUsdPerKChar、SCENARIO 日更 pick、showdown runner-up）  
- `server/services/generationCore.ts`／`fal.ts`（估點、扣點、`extractResult`→audio）  
- fal OpenAPI `Qwen3TtsTextToSpeech06bInput`／`Output`（HTTP 200）  
- 公開標價：$0.07／1000 characters（模型頁快照＋explore Alibaba 列表）；1.7b＝$0.09 對照  
- 站內：`docs/fal生態研究.md`、`docs/點數校準報告.md`、`docs/模型目錄.md`、`docs/模型指南研究補遺.md`  

**未做：** 任何 `--yes` live、任何改 `verified`／`points` 寫入 `models.ts`。
