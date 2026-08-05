# fal-ai/f5-tts

> 審計：R5 · index **#222** · 模式 **static+research（零 live / 禁止 --yes）** · 2026-08-05  
> slug：`fal-ai__f5-tts` · 單一真相：`shared/models.ts`  
> **已修 input 422 風險**（見 §3／§9）：補 required **`model_type: "F5-TTS"`**；**已修** `extractResult` 認 **AudioFile 形 `audio_url`**。  
> 未改 `verified`／`points`／`cost` 數值。

## 1. 身分

| 欄位 | 值 |
|------|-----|
| **index** | 222 |
| **id** | `fal-ai/f5-tts` |
| **endpoint** | 同 id（`endpointOf`＝id，無 alias） |
| **label** | F5-TTS(克隆) |
| **category** | `text-to-speech`（站內）；OpenAPI **`x-fal-metadata.category`＝`text-to-audio`** |
| **tier** | `economy` |
| **kind** | `audio` |
| **verified** | **`false`**（目錄 ⚠︎） |
| **needs** | **`audio`**（參考樣音；OpenAPI required `ref_audio_url`） |
| **recommended** | `false` |
| **sourceHint** | 參考樣音網址(mp3/wav) |
| **strengths** | 參考音克隆式 TTS;中英雙語、可商用、便宜 |
| **bestFor** | 預算型克隆旁白、英文為主稿件 |
| **供應商／底層** | **SWivid / F5-TTS**（Flow Matching DiT；可選 **E2-TTS** Flat-UNet）via fal.ai |
| **角色定位** | 經濟 **每次帶樣音即時 zero-shot 克隆合成**；**非** sc-voice-clone／sc-term-tts pick；與 Index TTS／Dia clone 同型、價更省、偏草稿／英稿 |

**L0 靜態契約（修後）：** **ok**  
- 必填欄完整；`category ∈ CATEGORIES`；id 唯一。  
- `input: (p,_f,s) => ({ gen_text: p, ref_audio_url: s, model_type: "F5-TTS" })` → 樣例含三 required。  
- **修前：** 僅 `{ gen_text, ref_audio_url }` → **缺 `model_type`（無 default）→ 必 422**。

**一句話：** 用一段參考音 **零樣本克隆** 朗讀 `gen_text`（**最多 5000 字**），官方 **$0.05／千字**；站內扁平 **2 點≈千字**，動態估點已接 `ttsUsdPerKChar`；**必須有樣音**。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| **points（目錄扁平）** | **2** |
| **cost** | **`$0.05/千字`** |
| **官方價與單位** | fal 模型頁／playground 文案：**$0.05 per 1,000 characters**（「Your request will cost $0.05 per 1000 character」；WebSearch 2026-08 快照與 `docs/fal生態研究.md` ✅已查證一致） |
| **匯率假設** | USD×**31** ≈ NT$（`USD_TO_TWD`／`audit-model-pricing` 同基準） |
| **估值 NT$（假設）** | 100 字 ≈ NT$0.16；**500 字 ≈ NT$0.78**；**1000 字 ≈ NT$1.55**；2000 字 ≈ NT$3.10；5000 字上限 ≈ NT$7.75；工作流 8000 字最壞 ≈ NT$12.4 |
| **`parseRealCost`** | usdMid=**0.05**；單位「／千字」→ multiplier=**null** → **`realPricePoints`=null** → **保留手填 2**（腳本表列「需人工」） |
| **`ttsUsdPerKChar`** | cost 首報價 `$0.05/千字` → 快取 **0.05** |
| **`estimatePoints`** | 有 `promptChars`：`max(1, round(0.05×31×chars/1000))` → 100–500→**1**；1000→**2**；2000→**3**；5000→**8**；8000→**12**；無字→扁平 **2** |
| **`docs/點數校準報告.md`** | 經濟列 F5：**需人工**（千字單位不套固定單次） |
| **校準判定** | **≈（動態路徑）**；扁平 2 ≈ **~1000 字** 基準，短稿實扣常 1、長稿抬高 |

**結論：**  
- **不建議改扁平 points／cost**（已對齊官方 $0.05/千字；動態估點正確）。  
- 表列「需人工」≠標價錯；真正扣點走 `estimatePoints`＋字元。  
- 與 ElevenLabs Turbo 同價帶（$0.05/千字），但本模 **強制克隆樣音**、品質定位草稿／英稿。

---

## 3. 連通與生成

| 項目 | 結果 | 說明 |
|------|------|------|
| **L0（修後）** | **ok** | 三 required 齊 |
| **OpenAPI Queue** | **HTTP 200** | `GET …/openapi.json?endpoint_id=fal-ai/f5-tts` → openapi **3.0.4**；`F5TtsInput`／`F5TtsOutput` |
| **模型頁 HTML** | 本回合 curl／WebFetch 遇 **429** | **不計連通失敗**；標價以 WebSearch 快照＋生態研究交叉 |
| **L1 歷史** | 端點曾 **連通 200** | `docs/fal端點連通報告.md`：`✅ 連通(誤排佇列已取消)` |
| **dry-run probe** | 可列 fal 計畫 | **未** `--yes` |
| **live probe** | **未跑** | 本回合零 live；**禁止 `--yes`**；`needs: audio` → `verify-models --probe` 預設拒探 |
| **結論** | **ready-static-only** | 契約＋抽取已修；待 L4 帶樣音最小句後可升 ready／建議 verified |

### 🔴 研究發現並已修復：input 缺 `model_type`

| | 舊站內 | OpenAPI F5TtsInput |
|--|--------|---------------------|
| 正文 | ✅ `gen_text` | **required** `gen_text`（**max 5000 chars**） |
| 參考聲 | ✅ `ref_audio_url` | **required** `ref_audio_url` |
| 模型變體 | ❌ 未送 | **required** `model_type` ∈ `F5-TTS` \| `E2-TTS`（**無 default**） |
| 後果 | 缺一 required → **必 422** | |

**本輪改碼**（`shared/models.ts`）：

```ts
// 審計 #222：OpenAPI required=`gen_text`+`ref_audio_url`+`model_type`
input: (p, _f, s) => ({ gen_text: p, ref_audio_url: s, model_type: "F5-TTS" }),
```

- 預設 **`F5-TTS`**（與 label／底模一致）；**E2-TTS** 未暴露 UI（P2 可選）。  
- `needs: "audio"` 既有 → 缺樣音生成前攔截。

### 🔴 研究發現並已修復：輸出 `audio_url` 為 File 物件

| | OpenAPI F5TtsOutput | 修前 `extractResult` |
|--|---------------------|----------------------|
| 主鍵 | **`audio_url`** → **`AudioFile`**（required `url`；例 `audio/wav`） | 僅 `typeof audio_url === "string"`；**不** `urlOf(audio_url)` |
| 後果 | 成功 200 亦可能 **「無法解析模型輸出」** | |

**本輪改碼**（`server/services/fal.ts`）：media 鏈加入 `urlOf(result.audio_url)`；字串形仍走原分支。  
**測試：** `fal.test.ts` 新增「audio_url 為 AudioFile 物件（F5-TTS OpenAPI）」。

### OpenAPI 摘要（2026-08-05）

**Input `F5TtsInput`（order：gen_text → ref_audio_url → ref_text → model_type → remove_silence）**

| property | 約束 | 站內（修後） |
|----------|------|--------------|
| **`gen_text`** | string **required**；**≤5000** | ✅ `positivePrompt` |
| **`ref_audio_url`** | string **required** | ✅ `sourceUrl`＋needs audio |
| **`model_type`** | enum **required** `F5-TTS` \| `E2-TTS` | ✅ 固定 `"F5-TTS"` |
| `ref_text` | optional string default `""`；空則上游 **ASR** 轉寫樣音 | ❌ 未送（吃 ASR） |
| `remove_silence` | boolean default **true** | ❌ 吃 default |

**Output：** required **`audio_url`** → AudioFile（`url`／`content_type` 預設 wav／`file_name`／`file_size`）

**x-fal-metadata：** endpointId 本 id；category=**`text-to-audio`**（站內仍 `text-to-speech` 可接受）；about=「Text To Speech」；playground／documentation 齊。

---

## 4. 底層邏輯

### 4.1 模型能力（公開資料）

- **F5-TTS**（論文／GitHub SWivid/F5-TTS）：Flow Matching + DiT／ConvNeXt V2；**zero-shot voice clone**（單段參考音、無需 fine-tune）。  
- **E2-TTS**：同端點 `model_type` 第二變體（Flat-UNet）；站內未暴露。  
- **語言：** 公開權重／Emilia 訓練敘事 **中英**；fal 文案強調 reference-audio cloning、性價比。  
- **`ref_text`：** 提供樣音逐字稿可改善對齊；未提供則跑 ASR（多一層誤差／延遲）。  
- **`remove_silence`：** 預設去靜音。  
- **計費：** 按 **`gen_text` 字元** $0.05/千字（非樣音秒、非產出秒）。  
- **授權注意：** 開源預訓練標 **CC-BY-NC**（Emilia 資料）— 與 strengths「**可商用**」可能衝突；**fal API 商用條款 ≠ 權重 NC 授權**。產品文案宜改「fal 按用量商用 API」或拿掉「可商用」，並提醒**克隆真人需同意**。

### 4.2 官方 OpenAPI vs 站內（修後）

| 官方 | 站內 | 備註 |
|------|------|------|
| required `gen_text` | ✅ | 非 `text`／`prompt`（與 Index／MiniMax 鍵名不同） |
| required `ref_audio_url` | ✅ + needs | 鍵名 **非** `audio_url` |
| required `model_type` | ✅ 固定 F5-TTS | **已修** |
| optional `ref_text` | ❌ | 品質旋鈕未接；長／嘈雜樣音風險 |
| optional `remove_silence` | ❌ | default true |
| output AudioFile `audio_url` | ✅（修後 extract） | **已修** |
| fal category text-to-audio | 站內 text-to-speech | 目錄分組 OK |

- **幽靈欄：** 無。  
- **世界觀／卡片錨點：** TTS **排除**注入 → 寫什麼唸什麼；選角色卡 warning「不會使用設定卡」（合理；音色靠音訊）。  
- **negative／seed：** 不適用。

### 4.3 風險／落差

1. **修前 422（已修）：** 缺 `model_type`。  
2. **修前解析失敗（已修）：** File 形 `audio_url`。  
3. **P2 — `ref_text` 未暴露：** 中文／專有名詞樣音靠 ASR 易錯 → 克隆相似度下降。  
4. **P2 — E2-TTS 未暴露：** A/B 變體無法選。  
5. **P2 — gen_text 5000 上限：** 站內未截斷提示；超長上游拒。  
6. **L6 文案：** 「可商用」vs 權重 CC-BY-NC；中文「可用但自然度不如 MiniMax/Qwen」生態研究已寫，strengths 未強調草稿定位。  
7. **verified=false：** 助手不優先；無 sc pick → 手動台才會點到（合理）。  
8. **probe：** `needs` → 勿當免來源經濟檔硬探。

### 4.4 與家族／情境配方

| id／配方 | 角色 | 與本卡 |
|----------|------|--------|
| Index TTS 2 (#218) | 中文術語／對嘴旗艦（按秒） | 同「每次帶樣音」；欄位 `prompt`/`audio_url`；價／定位不同 |
| MiniMax voice-clone (#219) | 付費註冊 `custom_voice_id` | 永久 ID；本模每次樣音、按字合成 |
| Qwen clone-voice (#220) | embedding 註冊 | 產物 safetensors；本模直接出音 |
| Dia voice-clone (#225) | 英文對話克隆 | 型態近；本模通用旁白 |
| Zonos (#228) | 經濟克隆 | 價未明列 |
| sc-voice-clone / sc-term-tts | 配方 | **不含**本 id |
| showdown 專屬聲線 | winner MiniMax / runner Qwen | 本模不在軸上 |

---

## 5. 站內扣點／退點

| 環節 | 行為 |
|------|------|
| 估點 | `ttsUsdPerKChar`=0.05 → 有 `promptChars` 動態；否則扁平 **2** |
| 扣點 | `reserveQuota(…, est, …)`；成功 `pointsActual` 對齊 est（BYOK 可 0） |
| 退點 | 失敗／陳屍 `refund` 與 est 對稱（含解析失敗路徑） |
| UI 顯示 | 目錄 **2**；送出前依字數估點應顯示動態值（與 Turbo 等同路徑） |
| 缺來源 | `needs: audio` → 生成前 BAD_REQUEST，**不應**進 fal |
| 工作流 | 含本步時 8000 字最壞 **+12 點**（非扁平 2）— 與千字 TTS 設計一致 |

**一致性：** 顯示／預留／退點同一 `estimatePoints` → **架構對稱 ok**。  
**帳單：** fal 按 gen_text 字元；與站內動態同向。**本模無 live 對帳。**

---

## 6. 分詞／輸入

| 項 | 說明 |
|----|------|
| 必填正文 | 使用者稿 → `positivePrompt` → **`gen_text`**（**≤5000**；不是 `text`/`prompt`） |
| 必填來源 | 素材庫音訊／URL → **`ref_audio_url`** |
| 固定 | **`model_type: "F5-TTS"`** |
| 空稿／無音 | 表單／`generationCore` 應擋 |
| 估點字數 | `prompt.length`＝朗讀字元（TTS 不注入世界觀） |
| 注入 | 不注入世界觀／卡片 |
| 建議腳本形 | 短中／英旁白；參考音用乾淨人聲短段；可選後續接 `ref_text` 提升中文對齊 |
| 可選（未接） | `ref_text`、`remove_silence`、`model_type=E2-TTS` |

---

## 7. 情境與可用性

| 情境 | 適配 | 原因 |
|------|:----:|------|
| 預算試某個聲音風格 | ✅ | bestFor；按字便宜、即時出音 |
| 英文為主克隆旁白 | ✅ | 定位英稿／草稿 |
| 中文日更口白（免上傳） | ❌ | needs audio；用 Qwen 0.6b／1.7b |
| 中文術語／對嘴旗艦 | ❌ 主力 | Index TTS 2 或 MiniMax HD |
| 固定會方永久聲線 | ❌ | MiniMax voice-clone（voice_id） |
| 試克隆再升級正式版 | △ | 可；Qwen embedding／MiniMax 更「註冊型」 |
| 多講者對談 | ❌ | VibeVoice／Dia |
| 助手自動挑選 | ❌ | verified=false |
| 手動台 | ✅ | 需選音訊來源 |
| recommended | 否 | 合理（未 verified；中文非旗艦） |

**文案審（L6）：**  
- bestFor「預算型克隆旁白、英文為主稿件」**對**。  
- strengths「中英雙語」可留；「**可商用**」建議改「fal API 按量計費」或加註權重 NC／授權自審。  
- 生態研究：「中文可用但自然度與情感不如 MiniMax/Qwen，適合草稿」— 目錄 strengths 可補「草稿／試聲」。

---

## 8. MCP／文件

| 項 | 結果 |
|----|------|
| Playground | `https://fal.ai/models/fal-ai/f5-tts` |
| API 文檔 | `https://fal.ai/models/fal-ai/f5-tts/api` |
| OpenAPI | `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/f5-tts`（本回合 **200**） |
| 標價 | **$0.05／1000 characters** |
| MCP | `generate_into_scene` 等同路徑；**可調**但須帶 audio 來源與點數 |
| 助手 | 偏好 verified；本 id 非配方主力 |
| 檢視者 | 唯讀，不送生成 |
| 連通史 | `docs/fal端點連通報告.md` 已標連通 |
| 生態／校準／清查 | 生態 ✅ $0.05/千字；校準需人工列＝千字機制；清查需素材實測 |

---

## 9. 建議動作

- [x] **修 input** — 補 **`model_type: "F5-TTS"`**（防 422）  
- [x] **修 extractResult** — `urlOf(result.audio_url)`＋單元測試（File 形輸出）  
- [x] **維持** points=**2**、cost **`$0.05/千字`**、verified=**false**、needs=**audio**、id／endpoint／category  
- [ ] **調 points** — **不需要**（動態估點已對齊千字價；扁平 2≈千字）  
- [ ] **verified true** — **僅建議，勿擅自改**：待 L4 短樣音＋短 `gen_text` 成功抽出 wav/mp3 URL 後再人工開  
- [ ] **下架或隱藏** — 不需要；修後為有效經濟 zero-shot 克隆 TTS  
- [ ] **文案／P2 產品**  
  - strengths 弱化或加註「可商用」（權重 CC-BY-NC vs fal API）  
  - 可選暴露 `ref_text`（中文品質）、`model_type`（E2）、`remove_silence`  
  - help：gen_text ≤5000；需乾淨樣音  
- [ ] **Live 佇列（可選，控費）**  
  - 估點：`npx tsx scripts/verify-models.ts --probe "fal-ai/f5-tts"`（needs → 可能拒探）  
  - 真跑：站內上傳短樣音 + 短英文／中文句；**單次**、需 FAL_KEY；**禁止批次 --yes**  
  - 對帳：字元×$0.05/千字 vs 動態扣點；JSON 含 `audio_url.url`

### 本回合狀態燈（供 `_index`）

| L0 | L1 | L2 live | 建議 |
|----|----|---------|------|
| ✅（已修 model_type） | 📄OpenAPI | 未跑(needs) | **已修** input＋extract；**維持** points=2／$0.05/千字／verified=false；ready-static-only |

### 研究來源（static+research）

- `shared/models.ts`（entry #222、ttsUsdPerKChar／estimatePoints、sc／showdown 無本 id）  
- `server/services/fal.ts`／`fal.test.ts`（extractResult AudioFile）  
- fal OpenAPI `F5TtsInput`／`F5TtsOutput`／`AudioFile`（HTTP 200）  
- 公開標價：**$0.05 per 1,000 characters**；F5-TTS GitHub（F5/E2、CC-BY-NC 權重敘事）  
- 站內：`docs/fal生態研究.md`、`docs/點數校準報告.md`、`docs/fal端點連通報告.md`、`docs/模型目錄.md`、#218／#220 卡對照  

**未做：** 任何 `--yes` live、任何改 `verified`／`points`／`cost` 數值（僅修 input `model_type`＋extractResult）。
