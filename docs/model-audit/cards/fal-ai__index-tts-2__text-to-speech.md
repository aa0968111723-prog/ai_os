# fal-ai/index-tts-2/text-to-speech

> 審計：R5 · index **#218** · 模式 **static+research（零 live / 禁止 --yes）** · 2026-08-05  
> slug：`fal-ai__index-tts-2__text-to-speech` · 單一真相：`shared/models.ts`  
> **已修 input 422 風險**（見 §3／§9）：`text` → **`prompt`** + required **`audio_url`** + `needs: audio`；未改 `verified`／`points`。

## 1. 身分

| 欄位 | 值 |
|------|-----|
| **index** | 218 |
| **id** | `fal-ai/index-tts-2/text-to-speech` |
| **endpoint** | 同 id（`endpointOf`＝id，無 alias） |
| **label** | Index TTS 2.0(中文可控) |
| **category** | `text-to-speech` |
| **tier** | `flagship` |
| **kind** | `audio` |
| **verified** | **`false`**（目錄 ⚠︎） |
| **needs** | **`audio`**（修後；OpenAPI required 參考聲） |
| **recommended** | `false` |
| **sourceHint** | 參考聲線樣音網址(mp3/wav; zero-shot 音色) |
| **strengths** | 拼音校正破音字+精準時長控制;WER 最低、咬字最準 |
| **bestFor** | 影片對嘴配音、佛學術語密集稿 |
| **供應商／底層** | **IndexTeam / 嗶哩嗶哩 IndexTTS2**（零樣本自迴歸 TTS；情感與時長可控論文線）via fal.ai |
| **角色定位** | 中文 **術語／咬字／對嘴時長** 旗艦；`sc-term-tts` pickIds[0]；showdown 軸「咬字/術語/對嘴時長」**winner**（runner-up＝MiniMax 02 HD） |

**L0 靜態契約（修後）：** **ok**  
- 必填欄完整；`category ∈ CATEGORIES`；id 唯一。  
- `input: (p,_f,s) => ({ prompt: p, audio_url: s })` 可呼叫 → 樣例 `{ prompt, audio_url }`。  
- **修前：** `{ text: p }` 且無 needs → **必 422**（缺 `audio_url`＋錯鍵 `text`）。

**一句話：** 要固定聲線＋中文術語／對嘴向配音的 zero-shot TTS——**必須上傳參考樣音**；官方按**產出音訊秒**計費 $0.002/s；站內扁平 1 點≈5 秒假設，長旁白實價會高於扣點。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| **points（目錄扁平）** | **1** |
| **cost** | **`$0.002/秒(≈$0.12/分),按秒計費`** |
| **官方價與單位** | fal 模型頁／learn：**$0.002 per generated audio second**（WebSearch 快照與 `docs/fal生態研究.md` ✅已查證一致） |
| **匯率假設** | USD×**31** ≈ NT$（`USD_TO_TWD`／`audit-model-pricing` 同基準） |
| **估值 NT$（假設）** | 5 秒 ≈ NT$0.31；**15 秒 ≈ NT$0.93**；30 秒 ≈ NT$1.86；**60 秒 ≈ NT$3.72**；120 秒 ≈ NT$7.44 |
| **`parseRealCost`** | usdMid=**0.002**；unit `/秒` 且 category≠`text-to-audio` → multiplier=**`PRICE_VIDEO_SECONDS`（5）**（與影片單鏡假設同路徑） |
| **`realPricePoints`** | `round(0.002×5×31)=round(0.31)=`**1** → 與目錄扁平 **一致（機械覆寫後仍 1）** |
| **動態估點 `estimatePoints`** | **無** per-k-char 快取（cost 首單位是「秒」不是「千字」）→ **一律扁平 1**；**不**隨字數／產出秒數上升 |
| **`docs/點數校準報告.md`** | 文字轉語音列：**≈**（0.3→1）；表列非「需人工」 |
| **校準判定** | **≈（短片／≤~15 秒）**；**長旁白偏便宜（站內低估）**——60 秒實價約 4 點、仍扣 1 |

**結論：**  
- **不建議為「對齊校準表」改扁平 points**（1 已對 5 秒基準）。  
- **P2 風險：** 按秒 TTS 沒有像千字 TTS 的 `promptChars` 動態估點；長開示／長旁白會**嚴重低收**。可選 follow-up：估點改依「預估秒數」（字數×語速）或回填實際 `duration` 後補差（產品級，非本卡必做）。  
- 與按字旗艦比：1 分旁白 ≈ $0.12 ≈ MiniMax $0.10/千字 下 ~300–400 字量級，短對嘴極省、長稿不一定更省。

---

## 3. 連通與生成

| 項目 | 結果 | 說明 |
|------|------|------|
| **L0（修後）** | **ok** | required 對齊 OpenAPI |
| **OpenAPI Queue** | **HTTP 200** | `GET …/openapi.json?endpoint_id=fal-ai/index-tts-2/text-to-speech` → openapi **3.0.4**；`IndexTts2TextToSpeechInput`／`Output` |
| **模型頁 HTML** | 本回合未依賴 HTML | schema＋公開標價交叉足夠；WebSearch 模型頁確認 $0.002/audio-sec |
| **L1 歷史** | 端點曾 **連通 200** | `docs/fal端點連通報告.md`：`✅ 連通(誤排佇列已取消)` |
| **dry-run probe** | 可列入 fal 端點計畫 | **未** `--yes` |
| **live probe** | **未跑** | 本回合零 live；**禁止 `--yes`**；且修後 **`needs: audio`** → `verify-models --probe` 預設拒探（需站內素材） |
| **結論** | **ready-static-only** | 契約已修；待 L1 空探（仍會缺必填 422＝連通）＋ L4 帶樣音最小中文句後可升 ready／建議 verified |

### 🔴 研究發現並已修復：input 欄位

| | 舊站內 | OpenAPI Index TTS 2 | 對照 F5／voice-clone |
|--|--------|---------------------|---------------------|
| 正文欄 | `{ text: p }` | **required `prompt`** | F5=`gen_text`；clone 多 `text` |
| 參考聲 | 未送、無 needs | **required `audio_url`** | F5=`ref_audio_url` + needs audio |
| 後果 | 缺兩必填 → **必 422** | | |

**本輪改碼**（`shared/models.ts`）：

```ts
// 審計 #218：OpenAPI required=`audio_url`+`prompt`（非 text）
needs: "audio",
sourceHint: "參考聲線樣音網址(mp3/wav; zero-shot 音色)",
input: (p, _f, s) => ({ prompt: p, audio_url: s }),
```

- `prompt`：滿足 required 正文（**勿**再送 `text`）。  
- `audio_url`：zero-shot **音色**參考（與 `emotional_audio_url` 情感參考分開）。  
- `needs: "audio"`：生成前攔截缺來源（`generationCore`），避免白白 422／誤扣。

### OpenAPI 摘要（2026-08-05）

- **required：** `audio_url`、`prompt`  
- **order：** audio_url → prompt → emotional_audio_url → strength → emotional_strengths → should_use_prompt_for_emotion → emotion_prompt  
- **可選情感：**  
  - `emotional_audio_url`：情感風格參考音  
  - `strength` 0–1 default **1**（情感遷移強度）  
  - `emotional_strengths`：happy／angry／sad／afraid／disgusted／melancholic／surprised／calm（各 0–1）  
  - `should_use_prompt_for_emotion` default **false**；true 時用 `prompt`（或 `emotion_prompt`）抽情感並覆寫 strengths  
  - `emotion_prompt`：自然语言情感描述（須搭配 should_use…）  
- **Output：** `audio` → `File`（`url` required；例 mp3）  
- **x-fal-metadata：** endpointId 本 id；category=`text-to-speech`；about=「Generate」；playground／documentation URL 齊  

**輸出抽取：** 站內 `extractResult` 認 `result.audio`／`audio_file`／`audio_url` → **對得上**（File.url）。

---

## 4. 底層邏輯

### 4.1 模型能力（公開資料）

- **IndexTTS2**（論文／GitHub index-tts）：零樣本自迴歸 TTS；**中英**；情感與音色可分離；可選 **speech token 數**做**固定時長**（對嘴／配音）。  
- **fal 表面：** 僅暴露音色參考 + 文本 + 情感旋鈕；**未**暴露 `speech_token_num`／顯式秒數欄 → 站內／API **無法直接「卡進 N 秒」**；時長賣點在論文／本地權重，**fal 產品化未接**。  
- **拼音／破音：** 生態文案與 Index 系列中文可控敘事（標點停頓、多音字）——**無**獨立 OpenAPI 欄；若支援則寫在 `prompt` 正文（待 live／官方腳本慣例確認）。  
- **計費：** 依**產出音訊秒** $0.002，非按字。  
- **角色：** 站內 `sc-term-tts` 與 showdown「咬字/術語/對嘴時長」winner——產品意圖是佛學術語＋對嘴；修後路徑變成「**有樣音的克隆式配音**」，與「內建聲線直接唸」的 MiniMax／Qwen **使用型態不同**。

### 4.2 官方 OpenAPI vs 站內（修後）

| 官方 property | 約束 | 站內 | 備註 |
|---------------|------|------|------|
| **`audio_url`** | string **required** | ✅ `sourceUrl` → `audio_url` | needs audio 攔截 |
| **`prompt`** | string **required** | ✅ `positivePrompt` → `prompt` | **已修**（原錯 `text`） |
| `emotional_audio_url` | optional | ❌ | 情感參考音未接 |
| `strength` | 0–1，default 1 | ❌ | 吃 default |
| `emotional_strengths` | 8 維 0–1 | ❌ | 賣點未產品化 |
| `should_use_prompt_for_emotion` | default false | ❌ | |
| `emotion_prompt` | optional | ❌ | 須搭 should_use… |
| （時長 token 數） | **schema 無** | — | fal 未暴露；strengths「精準時長」**過度承諾** |

- **required 對齊（修後）：** `prompt`＋`audio_url` → **無缺必填 → 無 422 風險**（有來源時）。  
- **幽靈欄：** 無。  
- **世界觀／卡片錨點：** TTS **刻意排除**注入 → 寫什麼唸什麼；選角色卡會 warning「不會使用設定卡」（合理；音色改靠音訊來源）。  
- **negative／seed allowlist：** 不適用。

### 4.3 風險／落差

1. **修前 422（已修）：** `text`≠`prompt` 且缺 `audio_url`。  
2. **時長控制未接：** strengths／bestFor／sc-term 強調「精準時長／對嘴」——**fal 無對應欄**；使用者無法指定秒數；僅能靠稿長與模型自由時長。文案宜降調或等上游加欄。  
3. **情感旋鈕全未暴露：** 情感參考音／向量／文本情感均在上游，站內只有 default 行為（通常跟音色參考的韻律／情緒）。  
4. **按秒估點扁平：** 長旁白 1 點 vs 實價 4–7 點 → 毛利風險（P2）。  
5. **verified=false：** 助手自動選模不優先；但 **sc-term-tts 仍 pick 本 id**——手動／配方路徑可選到，需有樣音。  
6. **與「免來源中文旁白」混淆：** 使用者若期望像 MiniMax 選聲線就唸，會被 needs 擋——help／sourceHint 需講清「要參考音」。  
7. **probe 腳本：** `!needs` 才 live probe；本模需素材路徑，勿當免來源經濟檔硬探。

### 4.4 與家族／情境配方

| id／配方 | 角色 | 與本卡 |
|----------|------|--------|
| `sc-term-tts` | 術語密集・對嘴 | pickIds[0]=本 id |
| showdown 咬字軸 | winner=本 id | runner-up MiniMax 02 HD |
| MiniMax 2.6 HD (#216) | 情感中文免來源旗艦 | 無 needs；正文鍵 `prompt` 同名不同產品 |
| F5-TTS (#222) | 經濟克隆 | needs audio；欄位 `gen_text`/`ref_audio_url` |
| MiniMax voice-clone | 建可複用 voice_id | 高價 47 點；型態不同 |

---

## 5. 站內扣點／退點

| 環節 | 行為 |
|------|------|
| 估點 | `estimatePointsFor(model, { promptChars })` → **無** ttsUsdPerKChar → **扁平 1**（與字數無關） |
| 扣點 | `reserveQuota(…, est=1, …)`；成功 `pointsActual` 對齊 est（BYOK 可 0） |
| 退點 | 失敗／陳屍 `refund` 與 est 對稱 |
| UI 顯示 | 目錄 **1**；長稿亦顯示 1（**低估實成本**） |
| 工作流 | 本步固定 +1（8000 字最壞路徑**不會**抬高本模——與千字 TTS 不同） |
| 缺來源 | `needs: audio` → 生成前 BAD_REQUEST，**不應**進 fal |

**一致性：** 顯示／預留／退點同為 1 → **架構對稱 ok**。  
**商業風險：** fal 帳單按產出秒；站內不回讀 duration 補差 → **長音低收**待 L4／月帳單抽樣。

---

## 6. 分詞／輸入

| 項 | 說明 |
|----|------|
| 必填正文 | 使用者稿 → `positivePrompt` → 送 **`prompt`**（不是 `text`） |
| 必填來源 | 素材庫音訊／URL → `audio_url`（音色 zero-shot） |
| 空稿／無音 | 表單／`generationCore` 應擋下 |
| 長度 | OpenAPI 未標 prompt max chars；實務受上游超時與費用（秒）影響 |
| 估點字數 | **不影響**本模 points |
| 注入 | 不注入世界觀／卡片 |
| 建議腳本形 | 中文術語密集旁白／對嘴句；參考音用乾淨人聲樣段 |
| 可選（未接） | emotional_*、strength、emotion_prompt、時長 token |

---

## 7. 情境與可用性

| 情境 | 適配 | 原因 |
|------|:----:|------|
| 佛學術語密集稿（有樣音） | ✅ | bestFor／sc-term；咬字軸 winner |
| 影片對嘴配音（有目標聲） | △／✅ | 音色可克隆；**秒數無法 API 鎖定** → 對嘴仍可能要後製調速或重跑 |
| 見證／開示情感旗艦（免來源） | ❌ 主力 | 應用 MiniMax 2.6 HD；本模強制樣音 |
| 日更短口白免上傳 | ❌ | needs audio；用 Qwen 0.6b／1.7b |
| 固定會方聲線量產 | △ | 每次帶同一參考音可；長期聲線 ID 更適 MiniMax clone |
| 英文預算旁白 | △ | 模型支援英；站內定位中文術語 |
| 多講者對談 | ❌ | 無 S1/S2；用 Dia／VibeVoice |
| 助手自動挑選 | ❌ | verified=false |
| 手動台／配方 sc-term | ✅ | 需選音訊來源 |
| recommended | 否 | 合理（未 verified；旋鈕／時長未接） |

**文案審（L6）：**  
- bestFor「對嘴配音」在 fal **缺時長 API** 下偏樂觀——建議改「有參考聲的術語密集／角色一致旁白」或接時長後再恢復。  
- strengths「精準時長控制」對 **fal 站內現況過度承諾**；「WER／咬字」待 live 驗證。  
- `docs/fal生態研究.md` 敘事仍有價值作能力背景，但應註「fal 未暴露 duration token」。

---

## 8. MCP／文件

| 項 | 結果 |
|----|------|
| Playground | `https://fal.ai/models/fal-ai/index-tts-2/text-to-speech` |
| API 文檔 | `https://fal.ai/models/fal-ai/index-tts-2/text-to-speech/api` |
| OpenAPI | `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/index-tts-2/text-to-speech`（本回合 **200**） |
| llms.txt／標價 | $0.002／generated audio second；required audio_url＋prompt |
| MCP | `generate_into_scene` 等同路徑；**可調**但須帶 audio 來源與點數 |
| 助手 | 偏好 verified；配方仍可指向本 id |
| 檢視者 | 唯讀，不送生成 |
| 連通史 | `docs/fal端點連通報告.md` 已標連通 |

---

## 9. 建議動作

- [x] **修 input／needs** — `text` → **`prompt`** + **`audio_url`**；**`needs: "audio"`** + sourceHint（防 422；對齊 F5／clone 產品型態）  
- [x] **維持** points=**1**、cost `$0.002/秒…`、verified=**false**、id／endpoint／category（禁止自動 verified true）  
- [ ] **調 points** — **短期不需要**（5 秒基準 ≈）；**P2** 考慮長旁白動態／事後依 duration 補點，避免 60s 只扣 1  
- [ ] **verified true** — **僅建議，勿擅自改**：待 L4 最小中文＋樣音成功、`audio.url` 可抽後再人工開  
- [ ] **下架或隱藏** — 不需要；修後為有效克隆式中文旗艦  
- [ ] **文案／P2 產品**  
  - 弱化或加註「精準時長」：fal 無 token／秒數參數  
  - help：必填參考音；情感可選參數未接  
  - 可選暴露 emotional_audio_url／emotion_prompt／strengths  
  - 若上游加 duration API 再接對嘴秒數  
- [ ] **Live 佇列（可選，控費）**  
  - 估點：`npx tsx scripts/verify-models.ts --probe "fal-ai/index-tts-2/text-to-speech"`（needs → 可能拒探）  
  - 真跑：站內上傳短樣音 + 短中文術語句；**單次**、需 FAL_KEY；**禁止批次 --yes**  
  - 對帳：回傳 duration 秒 × $0.002 vs 扣 1 點  

### 本回合狀態燈（供 `_index`）

| L0 | L1 | L2 live | 建議 |
|----|----|---------|------|
| ✅（已修） | 📄 OpenAPI | 未跑(needs) | **已修 input**＋**維持** points=1／verified=false（ready-static-only；長旁白估點與時長 API 為 P2） |

### 研究來源（static+research）

- `shared/models.ts`（entry #218、estimatePoints、parseRealCost×5s、sc-term-tts、showdown winner）  
- `server/services/generationCore.ts`／`fal.ts`（needs 攔截、估點、audio 抽取）  
- fal OpenAPI `IndexTts2TextToSpeechInput`／`Output`（HTTP 200）  
- 公開標價：$0.002／generated audio second；IndexTTS2 論文／GitHub（時長 token、情感分離）  
- 站內：`docs/fal生態研究.md`、`docs/點數校準報告.md`、`docs/fal端點連通報告.md`、`docs/模型目錄.md`  

**未做：** 任何 `--yes` live、任何改 `verified`／`points` 數值（僅修 input／needs／sourceHint）。
