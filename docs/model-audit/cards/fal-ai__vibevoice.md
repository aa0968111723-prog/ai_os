# fal-ai/vibevoice

> 審計：R5 · index **#223** · 模式 **static+research（零 live / 禁止 --yes）** · 2026-08-05  
> slug：`fal-ai__vibevoice` · 單一真相：`shared/models.ts`  
> **已修 input 422 風險**（見 §3／§9）：OpenAPI required **`script`+`speakers`**；補預設雙中文 `speakers`。  
> 未改 `verified`／`points`／`cost` 數值。

## 1. 身分

| 欄位 | 值 |
|------|-----|
| **index** | 223 |
| **id** | `fal-ai/vibevoice` |
| **endpoint** | 同 id（`endpointOf`＝id，無 alias） |
| **label** | VibeVoice 多講者 |
| **category** | `text-to-speech`（站內＝OpenAPI `x-fal-metadata.category`） |
| **tier** | `economy` |
| **kind** | `audio` |
| **verified** | **`false`**（目錄 ⚠︎） |
| **needs** | 無（免來源；純文／腳本生語音；可選每講者 `audio_url` 未接） |
| **recommended** | `false` |
| **strengths** | 微軟原生多講者(至 4 人)長對話;按分鐘計超省 |
| **bestFor** | 對談短劇、Podcast 式開示問答 |
| **供應商／底層** | **Microsoft VibeVoice ~1.5B** via fal.ai（OpenAPI about＝「Generate speech from text using VibeVoice」；姊妹 `fal-ai/vibevoice/7b` 為高品質版） |
| **角色定位** | 經濟 **原生多講者長對話 TTS**（按**產出分鐘**計費）；showdown「多人對談」軸 **runner 位由 7B 扛 winner**、本檔為同族省錢 1.5B；與 Dia（`[S1]`/`[S2]`、按千字、英文主場）並存 |

**L0 靜態契約（修後）：** **ok**  
- 必填欄完整；`category ∈ CATEGORIES`；id 唯一。  
- `input: (p) => ({ script: p, speakers: [{ preset: "Bowen [ZH]" }, { preset: "Xinran [ZH]" }] })` → 樣例含兩 required。  
- **修前：** 僅 `{ script: p }`（或部分僅單 speaker）→ **缺 `speakers` 必 422**；單 speaker 對雙人腳本不對齊。

**一句話：** 把帶 **`Speaker N:`** 前綴的腳本合成多講者長對話音訊（最多 4 人）；官方 **$0.04／產出分鐘**（四捨五入到 15 秒）；站內扁平 **1 點≈1 分鐘**；契約鍵名是 **`script`+`speakers`**，**不是** `text`／`prompt`。

---

## 2. 數值

| 項目 | 值 |
|------|-----|
| **points（目錄扁平）** | **1** |
| **cost** | **`$0.04/分鐘(四捨五入到 15 秒)`** |
| **官方價與單位** | fal 模型頁／learn／7b 姊妹頁交叉：**$0.04 per generated minute**, rounded to nearest **15 seconds**；**$1 ≈ 25 分鐘**（WebSearch 2026-07/08 快照與 `docs/fal生態研究.md` ✅已查證一致） |
| **匯率假設** | USD×**31** ≈ NT$（`USD_TO_TWD`／`audit-model-pricing` 同基準） |
| **估值 NT$（假設）** | **1 分鐘** ≈ $0.04×31 = **NT$1.24** → 四捨五入 **1 點**；15 秒檔最低計費單位 ≈ NT$0.31；**5 分** ≈ NT$6.2；**10 分** ≈ NT$12.4；**25 分（$1）** ≈ NT$31 |
| **`parseRealCost`** | usdMid=**0.04**；單位「／分鐘」→ `priceMinutesFor(text-to-speech)`=**1** → multiplier=**1** → **`realPricePoints`=1**（載入時覆寫與手填一致） |
| **`ttsUsdPerKChar`** | **不命中**（首報價單位是「分鐘」非「千字」） |
| **`estimatePoints`** | 無動態時長 → 一律扁平 **1**（送出前不知產出秒數） |
| **`docs/點數校準報告.md`** | 經濟列 VibeVoice 多講者：usdMid 0.040、×1 分鐘、估值 1.2、判定 **≈** |
| **校準判定** | **≈**（扁平 1 ≈ 約 1 分鐘緩衝）；**長對話嚴重低估**（10 分實費 ~12 點卻只扣 1）— 見 §5 |

**結論：**  
- **不建議改扁平 points／cost**（已對齊官方 $0.04/分×1 分假設；校準 ≈）。  
- **P2 產品債：** 按產出分鐘計費卻無 `duration` 回寫動態扣點 → 長 Podcast 平台倒貼；與千字 TTS 的 `ttsUsdPerKChar` 路徑不同，需另設計「按秒／分」估點或事後調帳（**本輪不改 points**）。  
- 四捨五入 15 秒：最短一檔仍按 0.25 分計費（官方）；站內下限 1 點已覆蓋短檔。

---

## 3. 連通與生成

| 項目 | 結果 | 說明 |
|------|------|------|
| **L0（修後）** | **ok** | `script`+`speakers` 齊 |
| **OpenAPI Queue** | **HTTP 200** | `GET …/openapi.json?endpoint_id=fal-ai/vibevoice` → openapi **3.0.4**；`VibevoiceInput`／`VibevoiceOutput`／`VibeVoiceSpeaker`／`File` |
| **模型頁 HTML** | 本回合 WebFetch 遇 **Vercel checkpoint／429** | **不計連通失敗**；標價以 WebSearch＋生態研究＋ OpenAPI 交叉 |
| **L1 歷史** | 端點曾 **連通 200** | `docs/fal端點連通報告.md`：`✅ 連通(誤排佇列已取消)` |
| **dry-run probe** | 可列 fal 計畫 | **未** `--yes` |
| **live probe** | **未跑** | 本回合零 live；**禁止 `--yes`** |
| **結論** | **ready-static-only** | 契約已修；待 L4 最小雙人腳本後可升 ready／建議 verified |

### 🔴 研究發現並已修復：input 缺 required `speakers`

| | 舊站內（修前） | OpenAPI `VibevoiceInput` |
|--|----------------|---------------------------|
| 正文／腳本 | ✅ `script` | **required** `script`（**maxLength 90000**） |
| 講者列表 | ❌ 未送（或僅單 preset） | **required** `speakers`（array of `VibeVoiceSpeaker`） |
| 後果 | 缺 required → **必 422**；單槽對雙人腳本不對齊 | |

**對照教訓（同 R5 TTS 族）：**

| 模型 | 正文鍵 | 常見死契約 |
|------|--------|------------|
| MiniMax speech-2.6-hd (#216) | **`prompt`**（非 `text`） | 送 `text`→422；`output_format` default hex→extract 無 URL |
| Qwen-3-tts 0.6b (#217) | **`text`** | 契約 ok；`prompt` 是**風格**可選欄勿當正文 |
| F5-TTS (#222) | **`gen_text`** | 缺 required **`model_type`**→422；`audio_url` 為 File 物件 |
| **VibeVoice (#223)** | **`script`** | 缺 required **`speakers`**→422 |

**本輪改碼**（`shared/models.ts` #223）：

```ts
// 審計 #223：OpenAPI required=`script`+`speakers`
input: (p) => ({
  script: p,
  speakers: [{ preset: "Bowen [ZH]" }, { preset: "Xinran [ZH]" }],
}),
```

- 預設 **雙中文** preset，對齊 bestFor「開示問答／對談」；官方 playground example 為 `Frank [EN]`／`Carter [EN]`。  
- 可選 `audio_url` 每槽克隆、`seed`／`cfg_scale` **未暴露**（P2）。  
- **未**改 points／verified／cost；**未**動 #224（7b 另卡，已有同型註解／input 殘跡時勿混審）。

### 輸出契約

| OpenAPI `VibevoiceOutput` | 站內 `extractResult` |
|---------------------------|----------------------|
| required **`audio`** → **`File`**（`url` 等） | ✅ `urlOf(result.audio)` |
| `duration`／`sample_rate`／`generation_time`／`rtf` | 未入庫（僅媒體 URL）；duration 可用於未來按分對帳 |

例：`audio.url` → mp3；example duration ≈ 9.46s、sample_rate 24000、rtf≈0.53。

**x-fal-metadata：** endpointId＝本 id；category=**`text-to-speech`**；playground／documentation 齊。

### OpenAPI 摘要（2026-08-05）

**Input `VibevoiceInput`（order：script → speakers → seed → cfg_scale）**

| property | 約束 | 站內（修後） |
|----------|------|--------------|
| **`script`** | string **required**；**≤90000**；可 `Speaker X:` 多講者前綴 | ✅ `positivePrompt` |
| **`speakers`** | array **required**；items=`VibeVoiceSpeaker` | ✅ 預設 2×ZH preset |
| `seed` | optional int／null | ❌ 未送 |
| `cfg_scale` | number 1–2，default **1.3** | ❌ 吃 default |

**`VibeVoiceSpeaker`：**

| property | 約束 | 說明 |
|----------|------|------|
| `preset` | enum，default **`Alice [EN]`** | 有 `audio_url` 時忽略 preset |
| `audio_url` | optional string／null | 參考樣音 URL → 該槽克隆 |

**preset enum（8）：**  
`Alice [EN]` · `Carter [EN]` · `Frank [EN]` · `Mary [EN] (Background Music)` · `Maya [EN]` · `Anchen [ZH] (Background Music)` · **`Bowen [ZH]`** · **`Xinran [ZH]`**

**Output：** required `audio`（File）+ `duration` + `sample_rate` + `generation_time` + `rtf`

---

## 4. 底層邏輯

### 4.1 模型能力（公開資料）

- **Microsoft VibeVoice**（fal 標 1.5B 級經濟檔）：長篇、富表現力、**原生多聲線**（最多 **4** 講者）TTS。  
- **腳本格式：** `Speaker 0: …\nSpeaker 1: …`（空格＋冒號；索引自 0）— **異於** Dia 的 `[S1]`/`[S2]`、異於 EL dialogue 的分行+voice_id。  
- **每槽音色：** preset **或** `audio_url` 樣音匹配（克隆感；站內未接上傳→固定 preset）。  
- **CFG：** `cfg_scale` 1–2（default 1.3）提高貼稿。  
- **語言：** enum 明示 EN／ZH preset；生態研究「多語含中文；中文品質中上，長對話省錢是賣點」。  
- **計費：** **產出音訊分鐘** $0.04（**非**字元、非 RTF／generation_time）；15 秒進位。  
- **姊妹：** `fal-ai/vibevoice/7b`（#224，更高品質、points=2、價推估）；`fal-ai/vibevoice/0.5b` 公開另有 $0.02/分檔（**站內未登錄**）。

### 4.2 官方 OpenAPI vs 站內（修後）

| 官方 | 站內 | 備註 |
|------|------|------|
| required `script` | ✅ | **非** `text`／`prompt`／`gen_text` |
| required `speakers` | ✅ 雙 ZH preset | **已修**；長度固定 2，4 人腳本需 P2 擴 |
| optional `seed` | ❌ | 可重現性未接 |
| optional `cfg_scale` | ❌ | default 1.3 |
| speaker.`audio_url` | ❌ | 無 needs；無法每角上傳樣音 |
| speaker preset 可選 | 固定 Bowen／Xinran | 無 UI 換 Alice／Frank／BGM 聲 |
| output File `audio` | ✅ extract | 對齊 #216/#217 的 audio 物件路徑 |
| fal category text-to-speech | 站內同 | OK |

- **幽靈欄：** 無。  
- **世界觀／卡片錨點：** TTS **排除**注入 → 寫什麼唸什麼；選角色卡 warning「不會使用設定卡」（合理；音色靠 speakers）。  
- **negative／seed allowlist：** seed 上游有、站內未送；negative 不適用。

### 4.3 風險／落差

1. **修前 422（已修）：** 缺 `speakers`。  
2. **腳本格式無 UI 引導：** 使用者若寫成 Dia 的 `[S1]` 或純旁白，多講者切換可能失敗或全併一聲——help／placeholder 宜示「Speaker 0:／Speaker 1:」。  
3. **speakers 長度固定 2：** 3–4 人腳本槽不足；1 人腳本多送一槽通常可接受。P2：依 `Speaker N` 解析動態建 speakers。  
4. **長內容扣點倒貼：** 扁平 1 點 vs 實費 $0.04×分鐘；10 分鐘對談 ≈12 點成本只扣 1——**財務 P2**。  
5. **預設僅中文 preset：** 英文對談用 Bowen/Xinran 非最佳；P2 可依稿語種或 UI 選 preset。  
6. **克隆未產品化：** 官方支援每槽 `audio_url`，站內無 needs／多來源映射。  
7. **verified=false：** 助手不優先；showdown 多人對談 winner 是 **7b**，本檔靠手動台或 7b 不可用時備援。  
8. **description vs required：** schema 文案寫 speakers「If not provided, will be inferred」，但 `required` 仍含 `speakers`——**以 required 為準**（同 F5 `model_type` 教訓）。

### 4.4 與家族／情境配方

| id／配方 | 角色 | 與本卡 |
|----------|------|--------|
| `fal-ai/vibevoice/7b` (#224) | 多講者高品質 | 同契約形；showdown **winner**；價／points 較高 |
| `fal-ai/dia-tts` (#213) | 英文雙人＋非語言 | 按千字；`[S1]`/`[S2]`；runner-up |
| EL text-to-dialogue v3 (#226) | 旗艦多人 | 站內拆行+voice；貴 |
| MiniMax 2.6 HD (#216) | 單聲中文情感旁白 | 非多講者 |
| Qwen 0.6b／1.7b | 單聲中文量產 | 非多講者 |
| sc 多人對談 pick | `vibevoice/7b`、EL、Dia | **不含**本 1.5B id（合理） |

---

## 5. 站內扣點／退點

| 環節 | 行為 |
|------|------|
| 估點 | `estimatePoints`：非千字 TTS → `realPricePoints`＝**1** 或扁平 **1** |
| 扣點 | `reserveQuota(…, est=1, …)`；成功 `pointsActual` 對齊 est（BYOK 可 0） |
| 退點 | 失敗／陳屍 `refund` 與 est 對稱 |
| UI 顯示 | 目錄 **1**；無時長動態 |
| 缺來源 | needs 無 → 不攔截 |
| 工作流 | 本步固定 +1（**不**吃 8000 字最壞抬點——因非 `ttsUsdPerKChar`） |

**一致性：** 顯示／預留／退點同一 est → **架構對稱 ok**，但 est **≠** 官方按產出分鐘的真實成本（長稿）。  
**帳單：** fal 按 **audio duration** 進位 15 秒；站內無視 `duration` 回傳。**本模無 live 對帳。**

---

## 6. 分詞／輸入

| 項 | 說明 |
|----|------|
| 必填正文 | 使用者稿 → `positivePrompt` → **`script`**（**≤90000**） |
| 必填講者 | 站內固定 **`speakers`** 兩槽 ZH preset |
| 欄位名 | **`script`**（不是 `text`/`prompt`/`gen_text`） |
| 建議腳本形 | `Speaker 0: …\nSpeaker 1: …`（可至 Speaker 3）；勿用 Dia 的 `[S1]` |
| 空稿 | 表單／generationCore 應擋 |
| 估點字數 | **不影響**扣點（按分扁平 1） |
| 注入 | 不注入世界觀／卡片 |
| 可選（未接） | `seed`、`cfg_scale`、每槽 `preset` 選擇、`audio_url` 樣音 |

**範例（官方同構、中文化）：**

```
Speaker 0: 今天我們來談談日常修行的起點。
Speaker 1: 好，我想從早晚課的節奏開始說。
```

---

## 7. 情境與可用性

| 情境 | 適配 | 原因 |
|------|:----:|------|
| 對談短劇／Podcast 式開示問答 | ✅ | bestFor；原生多講者＋按分極省 |
| 長內容多人敘事（省錢） | ✅ | $0.04/分；注意站內只扣 1 點 |
| 正式對外高品質多人 | △ | 升 **7b**（showdown winner） |
| 英文雙人＋笑聲等非語言 | △／❌ 主力 | Dia 更對位（英文＋`(laughs)`） |
| 單人中文情感旁白 | ❌ 主力 | MiniMax 2.6／Qwen；本檔為對話取向 |
| 每角克隆真人樣音 | ❌ 站內斷 | 官方有 audio_url；未接 |
| 助手自動挑選 | ❌ | verified=false；sc 不 pick 本 id |
| 手動台 | ✅ | economy 1 點；需自備 Speaker 前綴腳本 |
| recommended | 否 | 合理（未 verified；7b 優先） |

**文案審（L6）：**  
- strengths／bestFor **對位**。  
- 可補：腳本需 `Speaker N:`；中文可用但「品質中上、長對話省錢」；正式檔建議 7b。

---

## 8. MCP／文件

| 項 | 結果 |
|----|------|
| Playground | `https://fal.ai/models/fal-ai/vibevoice` |
| API 文檔 | `https://fal.ai/models/fal-ai/vibevoice/api` |
| OpenAPI | `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/vibevoice`（本回合 **200**） |
| 標價 | **$0.04／generated minute**（15 秒進位；$1≈25 分） |
| MCP | `generate_into_scene` 等同路徑；**可調**（傳 modelId 全路徑＋腳本即可） |
| **MCP 陷阱** | 勿送 `text`/`prompt` 當正文；勿省略 `speakers`；勿期望 `[S1]` 語法 |
| 助手 | 偏好 verified；多人軸推 7b／Dia／EL |
| 檢視者 | 唯讀，不送生成 |
| 連通史 | `docs/fal端點連通報告.md` 已標連通 |
| 生態／校準／清查 | 生態 ✅ $0.04/分；校準 ≈（×1 分）；清查 probe 指令可乾跑 |

---

## 9. 建議動作

- [x] **修 input** — 補 required **`speakers`**（預設 `Bowen [ZH]`＋`Xinran [ZH]`）防 422  
- [x] **維持** points=**1**、cost **`$0.04/分鐘(四捨五入到 15 秒)`**、verified=**false**、id／endpoint／category  
- [ ] **調 points** — **不需要**改扁平 1（≈1 分官方）；若要貼近長對談真實成本 → **另開**「按秒／分 TTS 動態估點」專案（P2），勿只把手填改大  
- [ ] **verified true** — **僅建議，勿擅自改**：待 L4 雙人短中文腳本成功抽出 `audio.url` 後再人工開  
- [ ] **下架或隱藏** — 不需要；修後為有效經濟多講者檔  
- [ ] **文案／P2 產品**  
  - UI placeholder／help：`Speaker 0:`／`Speaker 1:` 格式（對照 Dia `[S1]`）  
  - 動態 `speakers` 長度（解析最大 Speaker N，上限 4）  
  - 暴露 preset 下拉（EN／ZH／BGM）；可選每槽上傳 → `audio_url`  
  - 可選 `cfg_scale`／`seed`  
  - 長對話扣點：讀 output `duration` 事後調帳或預估時長  
- [ ] **Live 佇列（可選，控費）**  
  - 估點：`npx tsx scripts/verify-models.ts --probe "fal-ai/vibevoice"`  
  - 真跑：短雙人中文腳本 **單次**、需 FAL_KEY；**禁止批次 --yes**  
  - 對帳：duration 進位 15 秒 ×$0.04 vs 站內 1 點；JSON 含 `audio.url`

### 本回合狀態燈（供 `_index`）

| L0 | L1 | L2 live | 建議 |
|----|----|---------|------|
| ✅（已修 speakers） | 📄OpenAPI | 未跑 | **已修** input；**維持** points=1／$0.04/分／verified=false；ready-static-only；長稿扣點 P2 |

### 研究來源（static+research）

- `shared/models.ts`（entry #223、parseRealCost／realPricePoints／estimatePoints、sc／showdown 多人軸）  
- `server/services/fal.ts`（extractResult → `audio` File）  
- fal OpenAPI `VibevoiceInput`／`VibevoiceOutput`／`VibeVoiceSpeaker`／`File`（HTTP 200）  
- 公開標價：**$0.04 per generated minute**（15s round）；F5／2.6／Qwen 卡契約教訓對照  
- 站內：`docs/fal生態研究.md`、`docs/點數校準報告.md`、`docs/fal端點連通報告.md`、`docs/模型目錄.md`、#213／#216／#217／#222 卡  

**未做：** 任何 `--yes` live、任何改 `verified`／`points`／`cost` 數值（僅修 input `speakers` 雙預設）。

## L2 live（2026-08-05）

| 項 | 值 |
|----|-----|
| requestId | `019fd07f-6bfe-7310-a96c-020cdc12de51` |
| 結果 | **failed 422** — 2 speakers provided, but expected 1 from script |
| 原因 | 站內固定 `speakers: [Bowen, Xinran]`；探測／單句文無多講者標記 |
| 建議 P0 | 單講者時只送 1 speaker；或 script 強制雙人標籤格式 |
| verified | **維持 false** |
